#!/usr/bin/env python3
"""
can_generator.py — Synthetic CAN-Bus Traffic Generator for SafeDash
=====================================================================
Simulates realistic vehicle telemetry across three driving scenarios:
  1. city:     Urban stop-and-go (0–60 km/h, frequent braking)
  2. highway:  Motorway cruising (100–130 km/h, steady state)
  3. sport:    Aggressive driving (0–200 km/h, high RPM)

Outputs frames as either:
  - UDP datagrams (host → QNX QEMU bridge socket)
  - Newline-delimited JSON on stdout (for pipe-based testing)

Usage:
  python can_generator.py --mode highway --output udp --host 127.0.0.1 --port 9100
  python can_generator.py --mode city --output stdout
"""

import argparse
import json
import math
import random
import socket
import struct
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

# ---------------------------------------------------------------------------
# CAN ID Constants (must match can_frames.h)
# ---------------------------------------------------------------------------
CAN_ID = {
    "BRAKE_STATUS":      0x001,
    "AIRBAG_STATUS":     0x002,
    "SEATBELT_STATUS":   0x003,
    "COLLISION_ALERT":   0x004,
    "VEHICLE_SPEED":     0x100,
    "ENGINE_RPM":        0x101,
    "GEAR_POSITION":     0x102,
    "THROTTLE_POSITION": 0x103,
    "ENGINE_TEMP":       0x104,
    "BATTERY_SOC":       0x200,
    "BATTERY_VOLTAGE":   0x201,
    "BATTERY_TEMP":      0x202,
    "REGEN_POWER":       0x203,
    "LANE_DEPARTURE":    0x300,
    "BLIND_SPOT":        0x301,
    "ADAPTIVE_CRUISE":   0x302,
    "TRAFFIC_SIGN":      0x303,
    "ODOMETER":          0x400,
    "TRIP_DISTANCE":     0x401,
    "FUEL_ECONOMY":      0x402,
    "AMBIENT_TEMP":      0x403,
    "PERFORMANCE_DYN":   0x105,
    "TPMS_STATUS":       0x205,
    "NAV_PREVIEW":       0x305,
}

# ---------------------------------------------------------------------------
# Vehicle State
# ---------------------------------------------------------------------------
@dataclass
class VehicleState:
    speed_kmh: float = 0.0
    rpm: int = 800
    gear: int = 0           # -1=R, 0=N, 1-8
    throttle_pct: float = 0.0
    engine_temp_c: float = 20.0
    brake_pct: float = 0.0
    abs_active: bool = False
    soc_pct: float = 85.0
    battery_voltage: float = 400.0
    battery_temp_c: float = 25.0
    regen_kw: float = 0.0
    power_kw: float = 0.0
    g_lat: float = 0.0
    g_long: float = 0.0
    tpms_fl: float = 36.0
    tpms_fr: float = 36.0
    tpms_rl: float = 35.5
    tpms_rr: float = 35.5
    nav_dist_m: int = 450
    nav_heading_deg: int = 315
    lane_dep_left: bool = False
    lane_dep_right: bool = False
    blind_spot_left: bool = False
    blind_spot_right: bool = False
    acc_distance_m: float = 0.0
    speed_limit_kmh: int = 0
    odometer_km: int = 12000
    trip_km: float = 0.0
    ambient_temp_c: float = 18
    frame_count: int = 0

# ---------------------------------------------------------------------------
# Driving Profile Simulators
# ---------------------------------------------------------------------------
def _rpm_from_speed_and_gear(speed_kmh: float, gear: int) -> int:
    """Approximate RPM from speed and gear (simple linear model)."""
    if gear <= 0:
        return 800
    # Gear ratios (approximations)
    ratios = [0, 3.6, 2.1, 1.4, 1.0, 0.76, 0.60, 0.50, 0.42]
    ratio = ratios[min(gear, 8)]
    # ~2000 RPM at 60 km/h in 4th gear (ratio=1.0)
    rpm = int(speed_kmh * ratio * 33.3)
    return max(800, min(rpm, 8000))

def _auto_gear(speed_kmh: float) -> int:
    """Select gear automatically from speed."""
    if speed_kmh < 1:   return 0
    if speed_kmh < 15:  return 1
    if speed_kmh < 30:  return 2
    if speed_kmh < 50:  return 3
    if speed_kmh < 70:  return 4
    if speed_kmh < 95:  return 5
    if speed_kmh < 120: return 6
    if speed_kmh < 150: return 7
    return 8

def simulate_city(state: VehicleState, t: float) -> VehicleState:
    """Stop-and-go city driving pattern."""
    cycle = t % 30.0  # 30-second stop-go cycle
    if cycle < 5:      # Accelerating
        state.speed_kmh = min(60.0, cycle * 12)
        state.throttle_pct = 60.0
        state.brake_pct = 0.0
        state.regen_kw = 0.0
    elif cycle < 15:   # Cruising
        state.speed_kmh = 50.0 + math.sin(cycle) * 5
        state.throttle_pct = 25.0
        state.brake_pct = 0.0
        state.regen_kw = 0.0
    elif cycle < 22:   # Braking to stop
        decel = (cycle - 15) / 7.0
        state.speed_kmh = max(0.0, 50.0 * (1.0 - decel))
        state.brake_pct = 70.0
        state.throttle_pct = 0.0
        state.regen_kw = max(0.0, state.speed_kmh * 0.1)
    else:              # Stopped
        state.speed_kmh = 0.0
        state.throttle_pct = 0.0
        state.brake_pct = 0.0
        state.regen_kw = 0.0
    state.speed_limit_kmh = 50
    state.acc_distance_m = random.uniform(8, 20) if state.speed_kmh > 10 else 0.0
    state.lane_dep_right = random.random() < 0.01  # 1% chance momentary
    return state

def simulate_highway(state: VehicleState, t: float) -> VehicleState:
    """Steady motorway cruising with gentle variations."""
    base_speed = 115.0
    state.speed_kmh = base_speed + math.sin(t * 0.1) * 8 + random.gauss(0, 1)
    state.speed_kmh = max(80.0, min(140.0, state.speed_kmh))
    state.throttle_pct = 30.0 + random.gauss(0, 2)
    state.brake_pct = 0.0
    state.regen_kw = 0.0
    state.speed_limit_kmh = 100
    state.acc_distance_m = random.uniform(50, 120)
    state.lane_dep_left   = random.random() < 0.005
    state.blind_spot_left = random.random() < 0.08  # Truck in adjacent lane
    return state

def simulate_sport(state: VehicleState, t: float) -> VehicleState:
    """Aggressive sport driving profile."""
    cycle = t % 20.0
    if cycle < 7:      # Hard acceleration
        state.speed_kmh = min(200.0, cycle * 28)
        state.throttle_pct = 95.0
        state.brake_pct = 0.0
        state.regen_kw = 0.0
    elif cycle < 12:   # High-speed run
        state.speed_kmh = 180.0 + math.sin(cycle * 2) * 10
        state.throttle_pct = 70.0
        state.brake_pct = 0.0
    elif cycle < 18:   # Hard braking
        decel = (cycle - 12) / 6.0
        state.speed_kmh = max(20.0, 180.0 * (1.0 - decel))
        state.brake_pct = 90.0
        state.abs_active = state.speed_kmh > 50 and state.brake_pct > 80
        state.regen_kw = state.speed_kmh * 0.3
        state.throttle_pct = 0.0
    else:
        state.speed_kmh = 20.0
        state.brake_pct = 20.0
        state.abs_active = False
    state.speed_limit_kmh = 130
    return state

PROFILES = {
    "city":    simulate_city,
    "highway": simulate_highway,
    "sport":   simulate_sport,
}

# ---------------------------------------------------------------------------
# CAN Frame Builder
# ---------------------------------------------------------------------------
def build_frames(state: VehicleState) -> list[dict]:
    """Convert current VehicleState into a list of CAN frame dicts."""
    frames = []

    def frame(can_id: int, payload: bytes) -> dict:
        return {
            "id":        can_id,
            "len":       len(payload),
            "dlc":       len(payload),
            "data":      list(payload),
            "data_hex":  " ".join(f"{b:02X}" for b in payload),
            "timestamp": time.time(),
        }

    # Safety
    frames.append(frame(CAN_ID["BRAKE_STATUS"],
        struct.pack("BB",
            1 if state.brake_pct > 5 else 0,
            int(state.brake_pct))))

    frames.append(frame(CAN_ID["SEATBELT_STATUS"],
        struct.pack("B", 0xFF)))  # All seats belted

    # Powertrain
    frames.append(frame(CAN_ID["VEHICLE_SPEED"],
        struct.pack(">H", int(state.speed_kmh * 10))))  # km/h * 10

    state.gear = _auto_gear(state.speed_kmh)
    state.rpm  = _rpm_from_speed_and_gear(state.speed_kmh, state.gear)
    frames.append(frame(CAN_ID["ENGINE_RPM"],
        struct.pack(">H", state.rpm)))

    frames.append(frame(CAN_ID["GEAR_POSITION"],
        struct.pack("b", state.gear)))

    frames.append(frame(CAN_ID["THROTTLE_POSITION"],
        struct.pack("B", int(state.throttle_pct))))

    # Warm up engine over first 3 minutes
    state.engine_temp_c = min(90.0, state.engine_temp_c + 0.02)
    frames.append(frame(CAN_ID["ENGINE_TEMP"],
        struct.pack(">h", int(state.engine_temp_c))))

    # Battery
    state.soc_pct = max(10.0, state.soc_pct - 0.0003)
    frames.append(frame(CAN_ID["BATTERY_SOC"],
        struct.pack("B", int(state.soc_pct))))

    frames.append(frame(CAN_ID["BATTERY_VOLTAGE"],
        struct.pack(">H", int(state.battery_voltage * 10))))

    frames.append(frame(CAN_ID["REGEN_POWER"],
        struct.pack(">H", int(state.regen_kw * 10))))

    # ADAS
    frames.append(frame(CAN_ID["LANE_DEPARTURE"],
        struct.pack("BB",
            1 if state.lane_dep_left else 0,
            1 if state.lane_dep_right else 0)))

    frames.append(frame(CAN_ID["BLIND_SPOT"],
        struct.pack("BB",
            1 if state.blind_spot_left else 0,
            1 if state.blind_spot_right else 0)))

    frames.append(frame(CAN_ID["ADAPTIVE_CRUISE"],
        struct.pack(">H", int(state.acc_distance_m * 10))))

    frames.append(frame(CAN_ID["TRAFFIC_SIGN"],
        struct.pack("B", state.speed_limit_kmh)))

    # Performance & Dynamic G-Forces (CAN 0x105)
    if state.brake_pct > 5:
        state.power_kw = -round(state.regen_kw, 1)
    else:
        state.power_kw = round((state.throttle_pct / 100.0) * 360.0, 1)

    state.g_long = round(((state.throttle_pct / 100.0) * 0.82) - ((state.brake_pct / 100.0) * 1.05), 2)
    if state.lane_dep_left:
        state.g_lat = -0.38
    elif state.lane_dep_right:
        state.g_lat = 0.38
    else:
        state.g_lat = round(math.sin(state.frame_count * 0.04) * 0.06, 2)

    frames.append(frame(CAN_ID["PERFORMANCE_DYN"],
        struct.pack(">hh", int(state.power_kw * 10), int(state.g_lat * 100))))

    # TPMS 4-Wheel Pressures (CAN 0x205)
    temp_factor = min(2.5, state.speed_kmh * 0.01)
    state.tpms_fl = round(36.0 + temp_factor + random.uniform(-0.1, 0.1), 1)
    state.tpms_fr = round(36.0 + temp_factor + random.uniform(-0.1, 0.1), 1)
    state.tpms_rl = round(35.5 + temp_factor + random.uniform(-0.1, 0.1), 1)
    state.tpms_rr = round(35.5 + temp_factor + random.uniform(-0.1, 0.1), 1)
    frames.append(frame(CAN_ID["TPMS_STATUS"],
        struct.pack("BBBB", int(state.tpms_fl), int(state.tpms_fr), int(state.tpms_rl), int(state.tpms_rr))))

    # Turn-by-Turn Navigation Preview (CAN 0x305)
    state.nav_dist_m = max(50, 600 - int((state.trip_km * 1000) % 600))
    state.nav_heading_deg = int((315 + math.sin(state.frame_count * 0.02) * 25) % 360)
    frames.append(frame(CAN_ID["NAV_PREVIEW"],
        struct.pack(">HH", state.nav_dist_m, state.nav_heading_deg)))

    # Comfort
    state.trip_km += state.speed_kmh / 3600.0 * 0.05  # 50ms tick
    frames.append(frame(CAN_ID["TRIP_DISTANCE"],
        struct.pack(">I", int(state.trip_km * 10))))

    frames.append(frame(CAN_ID["AMBIENT_TEMP"],
        struct.pack("b", state.ambient_temp_c)))

    state.frame_count += len(frames)
    return frames

# ---------------------------------------------------------------------------
# Output Writers
# ---------------------------------------------------------------------------
def write_stdout(frames: list[dict], state: VehicleState):
    """Emit compact JSON telemetry line to stdout."""
    summary = {
        "speed_kmh":    round(state.speed_kmh, 1),
        "rpm":          state.rpm,
        "gear":         state.gear,
        "throttle_pct": round(state.throttle_pct, 1),
        "brake_pct":    round(state.brake_pct, 1),
        "soc_pct":      round(state.soc_pct, 1),
        "regen_kw":     round(state.regen_kw, 2),
        "power_kw":     round(state.power_kw, 1),
        "g_lat":        state.g_lat,
        "g_long":       state.g_long,
        "tpms": {
            "fl": state.tpms_fl, "fr": state.tpms_fr,
            "rl": state.tpms_rl, "rr": state.tpms_rr
        },
        "nav": {
            "dist_m":   state.nav_dist_m,
            "heading":  state.nav_heading_deg,
            "maneuver": "SLIGHT_RIGHT" if state.nav_dist_m < 200 else "STRAIGHT",
            "street":   "QNX Innovation Expressway"
        },
        "abs_active":   state.abs_active,
        "collision":    False,
        "lane_dep_L":   state.lane_dep_left,
        "lane_dep_R":   state.lane_dep_right,
        "bspot_L":      state.blind_spot_left,
        "frame_count":  state.frame_count,
        "ts":           round(time.time(), 3),
    }
    print(json.dumps(summary), flush=True)

def write_udp(frames: list[dict], state: VehicleState, sock: socket.socket, addr: tuple):
    """Serialise and transmit telemetry + CAN frames as a single UDP JSON payload."""
    payload_data = {
        "speed_kmh":    round(state.speed_kmh, 1),
        "rpm":          state.rpm,
        "gear":         state.gear,
        "throttle_pct": round(state.throttle_pct, 1),
        "brake_pct":    round(state.brake_pct, 1),
        "soc_pct":      round(state.soc_pct, 1),
        "regen_kw":     round(state.regen_kw, 2),
        "power_kw":     round(state.power_kw, 1),
        "g_lat":        state.g_lat,
        "g_long":       state.g_long,
        "tpms": {
            "fl": state.tpms_fl, "fr": state.tpms_fr,
            "rl": state.tpms_rl, "rr": state.tpms_rr
        },
        "nav": {
            "dist_m":   state.nav_dist_m,
            "heading":  state.nav_heading_deg,
            "maneuver": "SLIGHT_RIGHT" if state.nav_dist_m < 200 else "STRAIGHT",
            "street":   "QNX Innovation Expressway"
        },
        "abs_active":   state.abs_active,
        "collision":    False,
        "lane_dep_L":   state.lane_dep_left,
        "lane_dep_R":   state.lane_dep_right,
        "bspot_L":      state.blind_spot_left,
        "frame_count":  state.frame_count,
        "ts":           round(time.time(), 3),
        "frames":       frames,
    }
    payload = json.dumps(payload_data).encode()
    try:
        sock.sendto(payload, addr)
    except OSError as e:
        print(f"[WARN] UDP send failed: {e}", file=sys.stderr)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="SafeDash CAN Traffic Generator")
    parser.add_argument("--mode",   choices=["city", "highway", "sport"],
                        default="highway", help="Driving profile")
    parser.add_argument("--output", choices=["stdout", "udp"],
                        default="stdout", help="Output destination")
    parser.add_argument("--host",   default="127.0.0.1")
    parser.add_argument("--port",   type=int, default=9100)
    parser.add_argument("--hz",     type=float, default=20.0,
                        help="Simulation tick rate (Hz, default=20)")
    parser.add_argument("--duration", type=float, default=0,
                        help="Run duration in seconds (0 = infinite)")
    args = parser.parse_args()

    tick_s   = 1.0 / args.hz
    profile  = PROFILES[args.mode]
    state    = VehicleState()
    sock     = None

    if args.output == "udp":
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        print(f"[SafeDash Sim] Sending to UDP {args.host}:{args.port} @ {args.hz}Hz ({args.mode} mode)",
              file=sys.stderr)
    else:
        print(f"[SafeDash Sim] Stdout mode @ {args.hz}Hz ({args.mode} mode)", file=sys.stderr)

    t_start = time.monotonic()
    t       = 0.0

    try:
        while True:
            t_now = time.monotonic() - t_start
            if args.duration > 0 and t_now >= args.duration:
                break

            state = profile(state, t)
            frames = build_frames(state)

            if args.output == "udp" and sock:
                write_udp(frames, state, sock, (args.host, args.port))
            else:
                write_stdout(frames, state)

            t += tick_s
            time.sleep(tick_s)

    except KeyboardInterrupt:
        print("\n[SafeDash Sim] Stopped.", file=sys.stderr)
    finally:
        if sock:
            sock.close()

if __name__ == "__main__":
    main()
