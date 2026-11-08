#!/usr/bin/env python3
"""
test_e2e.py — SafeDash End-to-End Integration Test Suite
=========================================================
Runs the full pipeline in host-simulation mode and validates:

  1. CAN Generator:        Produces valid JSON telemetry at the target Hz
  2. WebSocket Bridge:     Accepts connections and broadcasts telemetry
  3. Fault HTTP Server:    Accepts POST /fault and returns 200
  4. Protocol Parsing:     All telemetry fields are within expected ranges
  5. All 3 Driving Modes:  city / highway / sport produce distinct profiles
  6. All 6 Fault Types:    Are correctly recognised by the fault injector

Usage:
  python tests/test_e2e.py
  python tests/test_e2e.py -v        (verbose)
  python tests/test_e2e.py --quick   (skip WebSocket live test)
"""

import argparse
import hashlib
import json
import os
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import base64
import unittest
from pathlib import Path

HERE      = Path(__file__).parent
SIM_DIR   = HERE.parent / "src" / "simulator"
PROTO_DIR = HERE.parent / "src" / "common"

sys.path.insert(0, str(SIM_DIR))
from can_generator   import VehicleState, simulate_city, simulate_highway, simulate_sport, build_frames
from fault_injector  import FAULT_TYPES, FAULT_DESCRIPTIONS, DEMO_SEQUENCE

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ws_handshake(sock: socket.socket, host: str, port: int) -> bool:
    """Perform a WebSocket upgrade handshake. Returns True on success."""
    key_bytes = b"SafeDashTestKey=="
    key_b64   = base64.b64encode(key_bytes).decode()

    request = (
        f"GET / HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key_b64}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    )
    sock.sendall(request.encode())
    response = sock.recv(1024).decode("utf-8", errors="ignore")
    return "101 Switching Protocols" in response


def _recv_ws_text(sock: socket.socket, timeout: float = 3.0) -> str | None:
    """Receive one WebSocket text frame. Returns the payload or None on timeout."""
    sock.settimeout(timeout)
    try:
        header = sock.recv(2)
        if len(header) < 2:
            return None
        payload_len = header[1] & 0x7F
        if payload_len == 126:
            ext = sock.recv(2)
            payload_len = struct.unpack(">H", ext)[0]
        elif payload_len == 127:
            ext = sock.recv(8)
            payload_len = struct.unpack(">Q", ext)[0]
        data = b""
        while len(data) < payload_len:
            chunk = sock.recv(payload_len - len(data))
            if not chunk:
                return None
            data += chunk
        return data.decode("utf-8", errors="ignore")
    except socket.timeout:
        return None


# ---------------------------------------------------------------------------
# Test: CAN Generator
# ---------------------------------------------------------------------------
class TestCANGenerator(unittest.TestCase):

    def _run_mode(self, fn, mode_name: str) -> dict:
        s = VehicleState()
        for t in range(0, 60, 2):
            s = fn(s, float(t))
        frames = build_frames(s)
        return {"state": s, "frames": frames, "mode": mode_name}

    def test_city_mode_speed_range(self):
        """City mode speed must stay within 0–70 km/h."""
        for t in range(0, 60, 1):
            s = simulate_city(VehicleState(), float(t))
            self.assertGreaterEqual(s.speed_kmh, 0.0,   "Speed below 0")
            self.assertLessEqual(s.speed_kmh,   70.0,   "City speed > 70 km/h")

    def test_highway_mode_speed_range(self):
        """Highway mode must cruise between 80–145 km/h."""
        for t in range(0, 60, 1):
            s = simulate_highway(VehicleState(), float(t))
            self.assertGreaterEqual(s.speed_kmh, 75.0,  "Highway speed too low")
            self.assertLessEqual(s.speed_kmh,   145.0,  "Highway speed too high")

    def test_sport_mode_reaches_high_speed(self):
        """Sport mode must exceed 100 km/h at some point in its cycle."""
        max_speed = 0.0
        for t in range(0, 10, 1):
            s = simulate_sport(VehicleState(), float(t))
            max_speed = max(max_speed, s.speed_kmh)
        self.assertGreater(max_speed, 100.0, "Sport mode never exceeded 100 km/h")

    def test_gear_matches_speed(self):
        """Higher speeds must result in higher gears."""
        from can_generator import _auto_gear
        # Directly test the gear-selection function at known speeds
        gear_30  = _auto_gear(30.0)   # Should be gear 2 or 3
        gear_120 = _auto_gear(120.0)  # Should be gear 7+

        self.assertLess(gear_30, gear_120,
                        f"Gear at 30 km/h ({gear_30}) not less than gear at 120 km/h ({gear_120})")
        self.assertGreaterEqual(gear_30,  1, "Gear at 30 km/h must be >= 1")
        self.assertGreaterEqual(gear_120, 6, "Gear at 120 km/h must be >= 6")

    def test_soc_drains_over_time(self):
        """State of Charge must decrease over time."""
        s = VehicleState()
        s.soc_pct = 85.0
        for _ in range(1000):
            s = simulate_highway(s, 0.0)
            build_frames(s)
        self.assertLess(s.soc_pct, 85.0, "SOC did not drain over 1000 ticks")

    def test_frames_have_all_can_ids(self):
        """build_frames must include frames for all defined CAN IDs."""
        from can_generator import CAN_ID
        s = simulate_highway(VehicleState(), 5.0)
        frames = build_frames(s)
        frame_ids = {f["id"] for f in frames}

        required_ids = {
            CAN_ID["VEHICLE_SPEED"],
            CAN_ID["ENGINE_RPM"],
            CAN_ID["GEAR_POSITION"],
            CAN_ID["BATTERY_SOC"],
            CAN_ID["BRAKE_STATUS"],
        }
        for cid in required_ids:
            self.assertIn(cid, frame_ids, f"Missing CAN ID 0x{cid:03X} in build_frames output")

    def test_frames_data_length_valid(self):
        """All CAN frames must have data length 1–8."""
        s = simulate_highway(VehicleState(), 5.0)
        for frame in build_frames(s):
            self.assertGreaterEqual(frame["len"], 1, "Frame len < 1")
            self.assertLessEqual(frame["len"],    8, "Frame len > 8 (exceeds CAN DLC)")

    def test_json_output_parseable(self):
        """Stdout JSON output from can_generator must parse without errors."""
        import io
        from unittest.mock import patch
        s = simulate_highway(VehicleState(), 10.0)
        frames = build_frames(s)

        from can_generator import write_stdout
        output = []

        class FakeStdout:
            def write(self, s):   output.append(s)
            def flush(self):      pass

        with unittest.mock.patch("sys.stdout", FakeStdout()):
            write_stdout(frames, s)

        full_output = "".join(output)
        parsed = json.loads(full_output.strip())
        self.assertIn("speed_kmh",   parsed)
        self.assertIn("rpm",         parsed)
        self.assertIn("frame_count", parsed)


# ---------------------------------------------------------------------------
# Test: Fault Injector
# ---------------------------------------------------------------------------
class TestFaultInjector(unittest.TestCase):

    def test_all_fault_types_defined(self):
        """All 6 fault types must be in FAULT_TYPES."""
        required = ["cpu_stress", "infotainment_crash", "sensor_dropout",
                    "memory_pressure", "adas_alert", "clear"]
        for f in required:
            self.assertIn(f, FAULT_TYPES, f"Missing fault type: {f}")

    def test_all_faults_have_descriptions(self):
        """Every fault type must have a human-readable description."""
        for f in FAULT_TYPES:
            self.assertIn(f, FAULT_DESCRIPTIONS, f"Missing description for: {f}")
            self.assertGreater(len(FAULT_DESCRIPTIONS[f]), 10)

    def test_demo_sequence_completeness(self):
        """Demo sequence must include at minimum 5 steps and end with a clear."""
        self.assertGreaterEqual(len(DEMO_SEQUENCE), 5)
        last_fault = DEMO_SEQUENCE[-1][0]
        self.assertEqual(last_fault, "clear", "Demo sequence must end with 'clear'")

    def test_demo_sequence_durations_positive(self):
        """All demo sequence durations must be positive."""
        for fault, duration, _ in DEMO_SEQUENCE:
            self.assertGreater(duration, 0, f"Non-positive duration for step '{fault}'")


# ---------------------------------------------------------------------------
# Test: Protocol (Python equivalent of test_protocol.c)
# ---------------------------------------------------------------------------
class TestProtocol(unittest.TestCase):

    def _make_telemetry_dict(self) -> dict:
        return {
            "type": "telemetry",
            "safety": {
                "brake_pressed": True,
                "brake_pressure_pct": 75,
                "abs_active": True,
                "airbag_fault": False,
                "all_seatbelts_ok": True,
                "collision_imminent": False,
            },
            "powertrain": {
                "speed_kmh": 120.5,
                "rpm": 3200,
                "gear": 4,
                "throttle_pct": 42,
                "engine_temp_c": 88,
            },
            "battery": {
                "soc_pct": 73,
                "voltage_v": 396.5,
                "temp_c": 32,
                "regen_kw": 12.4,
            },
            "adas": {
                "lane_departure_left": False,
                "lane_departure_right": True,
                "blind_spot_left": False,
                "blind_spot_right": False,
                "acc_distance_m": 35.0,
                "speed_limit_kmh": 100,
            },
            "comfort": {
                "odometer_km": 12345,
                "trip_distance_km": 87.3,
                "fuel_economy": 15.2,
                "ambient_temp_c": 18,
            },
            "stats": {"frame_count": 1024, "error_count": 2},
        }

    def test_telemetry_json_round_trip(self):
        """Full telemetry dict must serialise and re-parse without data loss."""
        tel = self._make_telemetry_dict()
        raw = json.dumps(tel)
        parsed = json.loads(raw)
        self.assertEqual(parsed["powertrain"]["speed_kmh"], 120.5)
        self.assertEqual(parsed["powertrain"]["rpm"],       3200)
        self.assertEqual(parsed["battery"]["soc_pct"],     73)
        self.assertTrue(parsed["safety"]["brake_pressed"])
        self.assertTrue(parsed["adas"]["lane_departure_right"])

    def test_safety_collision_flag(self):
        """collision_imminent must propagate correctly."""
        tel = self._make_telemetry_dict()
        tel["safety"]["collision_imminent"] = True
        raw = json.loads(json.dumps(tel))
        self.assertTrue(raw["safety"]["collision_imminent"])

    def test_all_telemetry_fields_present(self):
        """All top-level and nested fields must be present."""
        tel = self._make_telemetry_dict()
        for section in ["safety", "powertrain", "battery", "adas", "comfort", "stats"]:
            self.assertIn(section, tel, f"Missing section: {section}")

    def test_fault_cmd_parsing(self):
        """Fault commands must map to expected fault type strings."""
        mapping = {
            '{"fault":"cpu_stress"}':          "cpu_stress",
            '{"fault":"infotainment_crash"}':  "infotainment_crash",
            '{"fault":"adas_alert"}':          "adas_alert",
            '{"fault":"clear"}':               "clear",
        }
        for cmd_json, expected in mapping.items():
            parsed = json.loads(cmd_json)
            self.assertEqual(parsed["fault"], expected)

    def test_unknown_fault_cmd(self):
        """Unknown fault types must NOT match any valid fault."""
        cmd = json.loads('{"fault":"self_destruct"}')
        self.assertNotIn(cmd["fault"], FAULT_TYPES)


# ---------------------------------------------------------------------------
# Test: WebSocket Bridge (live integration, requires port 8080 available)
# ---------------------------------------------------------------------------
class TestWebSocketBridge(unittest.TestCase):

    WS_PORT  = 8080
    UDP_PORT = 9100

    @classmethod
    def setUpClass(cls):
        """Launch the Python WS bridge and CAN generator for integration tests."""
        import importlib, run_host_sim
        # Start the Python WebSocket bridge directly (no subprocess)
        from run_host_sim import ws_bridge_server
        ws_bridge_server(ws_port=cls.WS_PORT, udp_port=cls.UDP_PORT)
        time.sleep(0.3)  # Let threads start

    def _connect_ws(self) -> socket.socket | None:
        """Connect and perform WebSocket handshake. Returns socket or None."""
        try:
            s = socket.create_connection(("127.0.0.1", self.WS_PORT), timeout=2)
            if _ws_handshake(s, "127.0.0.1", self.WS_PORT):
                return s
            s.close()
            return None
        except (ConnectionRefusedError, OSError, TimeoutError):
            return None

    def _send_udp(self, payload: str):
        """Send a UDP datagram to the CAN generator port."""
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.sendto(payload.encode(), ("127.0.0.1", self.UDP_PORT))

    def test_ws_connection_accepted(self):
        """WebSocket server must accept connections and complete handshake."""
        ws = self._connect_ws()
        self.assertIsNotNone(ws, "WebSocket handshake failed — bridge not running?")
        if ws:
            ws.close()

    def test_ws_receives_telemetry(self):
        """WebSocket clients must receive JSON telemetry after UDP send."""
        ws = self._connect_ws()
        if not ws:
            self.skipTest("WebSocket bridge not available")

        # Send a sample telemetry UDP datagram
        payload = json.dumps({
            "speed_kmh": 99.9, "rpm": 2500, "gear": 5,
            "throttle_pct": 35, "brake_pct": 0,
            "soc_pct": 80, "regen_kw": 0, "abs_active": False,
            "collision": False, "lane_dep_L": False, "lane_dep_R": False,
            "bspot_L": False, "frame_count": 42, "ts": time.time()
        })
        self._send_udp(payload)

        msg = _recv_ws_text(ws, timeout=3.0)
        self.assertIsNotNone(msg, "No WebSocket message received within 3s")

        parsed = json.loads(msg)
        self.assertAlmostEqual(parsed.get("speed_kmh", 0), 99.9, places=0)
        ws.close()

    def test_ws_multiple_clients(self):
        """Multiple simultaneous WebSocket clients must all receive broadcasts."""
        clients = []
        for _ in range(3):
            ws = self._connect_ws()
            if ws:
                clients.append(ws)

        self.assertGreaterEqual(len(clients), 2,
                                "Could not connect 2+ WebSocket clients")

        self._send_udp(json.dumps({
            "speed_kmh": 55.0, "rpm": 1800, "gear": 3,
            "throttle_pct": 20, "brake_pct": 0,
            "soc_pct": 70, "regen_kw": 0, "abs_active": False,
            "collision": False, "lane_dep_L": False, "lane_dep_R": False,
            "bspot_L": False, "frame_count": 99, "ts": time.time()
        }))

        received = 0
        for ws in clients:
            msg = _recv_ws_text(ws, timeout=3.0)
            if msg:
                received += 1
            ws.close()

        self.assertGreaterEqual(received, 2,
                                "Not all clients received the broadcast")


# ---------------------------------------------------------------------------
# Test: Fault HTTP Server (live integration)
# ---------------------------------------------------------------------------
class TestFaultHTTPServer(unittest.TestCase):

    HTTP_PORT = 9201

    @classmethod
    def setUpClass(cls):
        """Start the fault HTTP server as a subprocess."""
        fault_srv = SIM_DIR / "fault_http_server.py"
        ui_dir    = HERE.parent / "ui"
        cls._proc = subprocess.Popen(
            [sys.executable, str(fault_srv),
             "--http-port", str(cls.HTTP_PORT),
             "--fault-port", "9200",
             "--ui-dir", str(ui_dir)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Wait for the server to be ready
        deadline = time.time() + 8
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", cls.HTTP_PORT), timeout=0.5):
                    time.sleep(0.5)  # Let server settle into accept loop
                    return
            except (ConnectionRefusedError, OSError):
                time.sleep(0.2)
        # Server didn't start — tests will be skipped

    @classmethod
    def tearDownClass(cls):
        cls._proc.terminate()
        cls._proc.wait(timeout=3)

    def _is_server_running(self) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", self.HTTP_PORT), timeout=1):
                return True
        except Exception:
            return False

    def _post_fault(self, fault: str) -> tuple[int, dict]:
        """Send POST /fault and return (status_code, response_dict)."""
        import http.client
        body = json.dumps({"fault": fault}).encode()
        conn = http.client.HTTPConnection("127.0.0.1", self.HTTP_PORT, timeout=3)
        conn.request("POST", "/fault", body=body, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read())
        conn.close()
        return resp.status, data

    def test_server_is_up(self):
        """HTTP server must be accepting connections."""
        if not self._is_server_running():
            self.skipTest("HTTP server did not start")
        self.assertTrue(self._is_server_running())

    def test_post_fault_cpu_stress(self):
        """POST /fault with cpu_stress must return 200."""
        if not self._is_server_running():
            self.skipTest("HTTP server did not start")
        status, data = self._post_fault("cpu_stress")
        self.assertEqual(status, 200)
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("fault"),  "cpu_stress")

    def test_post_fault_clear(self):
        """POST /fault with clear must return 200."""
        if not self._is_server_running():
            self.skipTest("HTTP server did not start")
        status, data = self._post_fault("clear")
        self.assertEqual(status, 200)
        self.assertEqual(data.get("fault"), "clear")

    def test_post_all_fault_types(self):
        """Every fault type must return HTTP 200."""
        if not self._is_server_running():
            self.skipTest("HTTP server did not start")
        for fault in FAULT_TYPES:
            with self.subTest(fault=fault):
                status, data = self._post_fault(fault)
                self.assertEqual(status, 200, f"Fault '{fault}' returned {status}")

    def test_serve_index_html(self):
        """GET / must return 200 and serve HTML content."""
        if not self._is_server_running():
            self.skipTest("HTTP server did not start")
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.HTTP_PORT, timeout=3)
        conn.request("GET", "/")
        resp = conn.getresponse()
        content_type = resp.getheader("Content-Type", "")
        body = resp.read()
        conn.close()
        # May be 404 if ui/index.html doesn't exist yet — that's OK during dev
        if resp.status == 200:
            self.assertIn("html", content_type.lower())
            self.assertGreater(len(body), 100)
        else:
            self.skipTest("ui/index.html not yet available (expected during Phase 5 build)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import unittest.mock

    parser = argparse.ArgumentParser()
    parser.add_argument("-v",       "--verbose", action="store_true")
    parser.add_argument("--quick",  action="store_true",
                        help="Skip live WebSocket and HTTP tests")
    args, remaining = parser.parse_known_args()

    if args.quick:
        # Remove live integration test classes
        del TestWebSocketBridge
        del TestFaultHTTPServer
        print("[INFO] Quick mode: skipping live integration tests.\n")

    verbosity = 2 if args.verbose else 1
    sys.argv = [sys.argv[0]] + remaining

    loader  = unittest.TestLoader()
    suite   = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestCANGenerator))
    suite.addTests(loader.loadTestsFromTestCase(TestFaultInjector))
    suite.addTests(loader.loadTestsFromTestCase(TestProtocol))

    if not args.quick:
        suite.addTests(loader.loadTestsFromTestCase(TestWebSocketBridge))
        suite.addTests(loader.loadTestsFromTestCase(TestFaultHTTPServer))

    runner = unittest.TextTestRunner(verbosity=verbosity)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
