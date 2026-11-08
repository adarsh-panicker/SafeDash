#!/usr/bin/env python3
"""
fault_injector.py — SafeDash Fault Injection Tool
===================================================
Sends fault injection commands to the SafeDash telemetry bridge
to simulate system failures and validate QNX fail-safety.

Supported faults:
  cpu_stress          Spawn high-load background threads in the target process
  infotainment_crash  Kill the comfort/infotainment telemetry service thread
  sensor_dropout      Stop emitting frames for a specific CAN ID
  memory_pressure     Allocate large memory slabs to stress the allocator
  adas_alert          Trigger a simulated forward-collision alert
  clear               Reset and clear all active fault injections

Usage:
  python fault_injector.py --fault cpu_stress --host 127.0.0.1 --port 9200
  python fault_injector.py --fault adas_alert
  python fault_injector.py --fault clear
"""

import argparse
import json
import socket
import sys
import time

FAULT_TYPES = [
    "cpu_stress",
    "infotainment_crash",
    "sensor_dropout",
    "memory_pressure",
    "adas_alert",
    "clear",
]

FAULT_DESCRIPTIONS = {
    "cpu_stress":          "Spawns CPU-intensive background computation (priority 5) to test preemption.",
    "infotainment_crash":  "Sends SIGKILL to the comfort/infotainment subsystem thread.",
    "sensor_dropout":      "Stops emitting frames for VEHICLE_SPEED (CAN ID 0x100).",
    "memory_pressure":     "Allocates 256 MB of memory slabs to stress the QNX memory manager.",
    "adas_alert":          "Injects a collision_imminent=true safety alert (highest priority).",
    "clear":               "Clears all active fault injections and restores normal operation.",
}

DEMO_SEQUENCE = [
    ("normal",             10, "Normal driving — baseline metrics."),
    ("infotainment_crash",  5, "Crashing the infotainment subsystem..."),
    ("normal",              8, "Watchdog auto-restarted infotainment. Cluster unaffected."),
    ("cpu_stress",          6, "Injecting 100% CPU background stress..."),
    ("normal",              8, "Safety gauges stay smooth — QNX priority preemption working."),
    ("adas_alert",          3, "Triggering simulated forward collision alert!"),
    ("clear",               5, "Clearing all faults — back to normal."),
]


def send_fault(fault: str, host: str, port: int, param: int = 0):
    """Send a fault injection command to the bridge WebSocket/TCP control port."""
    payload = json.dumps({"fault": fault, "param": param}).encode()

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.sendto(payload, (host, port))

    print(f"[FAULT] Sent '{fault}' (param={param}) -> {host}:{port}")


def run_demo_sequence(host: str, port: int):
    """Execute the full demo fault injection sequence for the hackathon video."""
    print("\n=== SafeDash Demo Fault Injection Sequence ===\n")

    for fault, duration, description in DEMO_SEQUENCE:
        print(f"[{time.strftime('%H:%M:%S')}] {description}")

        if fault != "normal":
            send_fault(fault, host, port)

        # Visual countdown
        for remaining in range(duration, 0, -1):
            sys.stdout.write(f"\r  Waiting {remaining}s...  ")
            sys.stdout.flush()
            time.sleep(1)

        sys.stdout.write("\r                          \r")

        if fault not in ("normal", "clear"):
            # Auto-clear after each individual fault (unless it's the final clear)
            pass

    # Final clear
    send_fault("clear", host, port)
    print("\n[DONE] Demo sequence complete.")


def main():
    parser = argparse.ArgumentParser(description="SafeDash Fault Injector")
    parser.add_argument("--fault",  choices=FAULT_TYPES + ["demo"],
                        default="demo",
                        help="Fault to inject ('demo' runs the full hackathon sequence)")
    parser.add_argument("--host",   default="127.0.0.1")
    parser.add_argument("--port",   type=int, default=9200,
                        help="Bridge control port (default=9200)")
    parser.add_argument("--param",  type=int, default=0,
                        help="Optional fault parameter (e.g. CAN ID for sensor_dropout)")
    parser.add_argument("--list",   action="store_true",
                        help="List all available fault types and exit")
    args = parser.parse_args()

    if args.list:
        print("\nAvailable SafeDash Fault Types:\n")
        for fault, desc in FAULT_DESCRIPTIONS.items():
            print(f"  {fault:<24} {desc}")
        print()
        return

    if args.fault == "demo":
        run_demo_sequence(args.host, args.port)
    else:
        send_fault(args.fault, args.host, args.port, args.param)


if __name__ == "__main__":
    main()
