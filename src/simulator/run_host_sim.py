#!/usr/bin/env python3
"""
run_host_sim.py — SafeDash One-Command Host Simulation Launcher
===============================================================
Launches the complete SafeDash pipeline on your host machine
(no QNX hardware required):

  Process 1: CAN Generator     → UDP port 9100  (vehicle telemetry)
  Process 2: Python WS Bridge  → WebSocket :8080 (browser dashboard)
  Process 3: Fault HTTP Server → HTTP :9201      (UI fault injection)

Then opens the dashboard in your default browser.

Usage:
  python run_host_sim.py
  python run_host_sim.py --mode sport
  python run_host_sim.py --mode city --hz 30 --no-browser
"""

import argparse
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent

# ---------------------------------------------------------------------------
# Lightweight Python WebSocket bridge (replaces the C++ bridge for host sim)
# Reads UDP from can_generator on port 9100 and re-broadcasts via WebSocket.
# ---------------------------------------------------------------------------
def ws_bridge_server(ws_port: int, udp_port: int):
    """
    Pure-Python WebSocket broadcast server for host simulation.
    Reads JSON datagrams from the CAN generator and pushes them to
    all connected browser WebSocket clients.
    """
    import struct, hashlib, base64, threading, select

    WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    clients = []
    clients_lock = threading.Lock()

    def ws_accept_key(key: str) -> str:
        combined = (key.strip() + WS_GUID).encode()
        digest = hashlib.sha1(combined).digest()
        return base64.b64encode(digest).decode()

    def send_ws_text(conn, text: str) -> bool:
        data = text.encode()
        length = len(data)
        header = bytearray()
        header.append(0x81)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header += struct.pack(">H", length)
        else:
            header.append(127)
            header += struct.pack(">Q", length)
        try:
            conn.sendall(bytes(header) + data)
            return True
        except Exception:
            return False

    def handle_client(conn, addr):
        try:
            raw = conn.recv(4096).decode("utf-8", errors="ignore")
            # Find Sec-WebSocket-Key
            key = None
            for line in raw.split("\r\n"):
                if line.lower().startswith("sec-websocket-key:"):
                    key = line.split(":", 1)[1].strip()
            if not key:
                conn.close()
                return
            accept = ws_accept_key(key)
            response = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n"
                "\r\n"
            )
            conn.sendall(response.encode())
            with clients_lock:
                clients.append(conn)
            # Keep connection alive (drain pings and ignore timeouts)
            conn.settimeout(1.0)
            while True:
                try:
                    data = conn.recv(256)
                    if not data:
                        break
                except (socket.timeout, TimeoutError):
                    continue
                except Exception:
                    break
        finally:
            with clients_lock:
                if conn in clients:
                    clients.remove(conn)
            try:
                conn.close()
            except Exception:
                pass

    def accept_loop():
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("0.0.0.0", ws_port))
        srv.listen(8)
        srv.settimeout(1.0)
        print(f"[WS Bridge] WebSocket server on ws://localhost:{ws_port}")
        while True:
            try:
                conn, addr = srv.accept()
                threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()
            except socket.timeout:
                continue
            except Exception as e:
                print(f"[WS Bridge] Accept error: {e}")
                break

    def udp_recv_loop():
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.bind(("0.0.0.0", udp_port))
        udp.settimeout(1.0)
        print(f"[WS Bridge] Reading CAN telemetry from UDP port {udp_port}")
        while True:
            try:
                data, _ = udp.recvfrom(65536)
                msg = data.decode("utf-8", errors="ignore")
                with clients_lock:
                    dead = []
                    for conn in clients:
                        if not send_ws_text(conn, msg):
                            dead.append(conn)
                    for conn in dead:
                        clients.remove(conn)
            except socket.timeout:
                continue
            except Exception as e:
                print(f"[WS Bridge] UDP error: {e}")
                break

    threading.Thread(target=accept_loop, daemon=True).start()
    threading.Thread(target=udp_recv_loop, daemon=True).start()

# ---------------------------------------------------------------------------
# Main Launcher
# ---------------------------------------------------------------------------
def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 5.0) -> bool:
    """Wait until a TCP port is accepting connections."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.3):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.1)
    return False

def main():
    parser = argparse.ArgumentParser(description="SafeDash Host Simulation Launcher")
    parser.add_argument("--mode",       choices=["city", "highway", "sport"], default="highway")
    parser.add_argument("--hz",         type=float, default=20.0)
    parser.add_argument("--ws-port",    type=int,   default=8080)
    parser.add_argument("--http-port",  type=int,   default=9201)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    CAN_GEN  = HERE / "can_generator.py"
    FAULT_SRV = HERE / "fault_http_server.py"

    procs = []

    def cleanup(sig=None, frame=None):
        print("\n[Launcher] Stopping all processes...")
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass
        for p in procs:
            try:
                p.wait(timeout=3)
            except Exception:
                pass
        print("[Launcher] Done.")
        sys.exit(0)

    signal.signal(signal.SIGINT,  cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    print("=" * 55)
    print("  SafeDash — Host Simulation Launcher")
    print("=" * 55)

    # 1. Start Python WebSocket bridge (embedded)
    print(f"\n[1/3] Starting WebSocket bridge on port {args.ws_port}...")
    ws_bridge_server(ws_port=args.ws_port, udp_port=9100)
    time.sleep(0.3)

    # 2. Start CAN generator
    print(f"[2/3] Starting CAN generator ({args.mode} mode @ {args.hz}Hz)...")
    gen_proc = subprocess.Popen(
        [sys.executable, str(CAN_GEN),
         "--mode",   args.mode,
         "--output", "udp",
         "--host",   "127.0.0.1",
         "--port",   "9100",
         "--hz",     str(args.hz)],
        stderr=subprocess.PIPE
    )
    procs.append(gen_proc)
    time.sleep(0.5)

    # 3. Start fault HTTP server
    print(f"[3/3] Starting fault HTTP server on port {args.http_port}...")
    ui_dir = str(ROOT / "ui")
    fault_proc = subprocess.Popen(
        [sys.executable, str(FAULT_SRV),
         "--http-port",  str(args.http_port),
         "--fault-port", "9200",
         "--ui-dir",     ui_dir],
        stderr=subprocess.PIPE
    )
    procs.append(fault_proc)

    # Wait for HTTP server to be ready
    if wait_for_port(args.http_port, timeout=5):
        print(f"\n{'=' * 55}")
        print(f"  [OK] SafeDash is running!")
        print(f"{'=' * 55}")
        print(f"  Dashboard:   http://localhost:{args.http_port}/")
        print(f"  WebSocket:   ws://localhost:{args.ws_port}/")
        print(f"  Fault API:   POST http://localhost:{args.http_port}/fault")
        print(f"  Mode:        {args.mode} @ {args.hz}Hz")
        print(f"{'=' * 55}")
        print(f"\n  Fault injection commands:")
        print(f"    python fault_injector.py --fault demo")
        print(f"    python fault_injector.py --fault cpu_stress")
        print(f"    python fault_injector.py --fault adas_alert")
        print(f"    python fault_injector.py --fault clear")
        print(f"\n  Press Ctrl+C to stop all processes.\n")

        if not args.no_browser:
            time.sleep(0.5)
            webbrowser.open(f"http://localhost:{args.http_port}/")
    else:
        print("[ERROR] HTTP server did not start in time.")

    # Keep running until interrupted
    try:
        while True:
            # Check if child procs are still alive
            for p in procs:
                if p.poll() is not None:
                    print(f"[WARN] A subprocess exited unexpectedly (rc={p.returncode})")
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()

if __name__ == "__main__":
    main()
