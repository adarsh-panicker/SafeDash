# SafeDash — Fail-Safe Digital Instrument Cluster for QNX SDP 8.0

> **QNX Global Hackathon 2026 Submission** | Track: Automotive & Mobility / QNX-Specific Technologies

SafeDash is a **fail-safe, mixed-criticality digital instrument cluster and telematics broker** built on **BlackBerry QNX SDP 8.0**. It demonstrates how the QNX Neutrino Microkernel uniquely enables Freedom from Interference (FFI): safety-critical gauges (speedometer, ABS, collision alerts) remain live and responsive even when non-critical infotainment subsystems crash, run out of memory, or consume 100% CPU.

---

## Demo Architecture

```
CAN Generator (Python) ──UDP──▶ /dev/vehicle_telemetry (QNX Resource Manager)
                                    │
                            ┌───────┴────────┐
                     Priority 30         Priority 10
                   Safety Thread     Infotainment Thread
                   (CAN handler,      (trip, climate,
                    ADAS alerts,       media proxy)
                    watchdog)               │
                            └───────┬────────┘
                                    ▼
                           Telemetry Bridge (C++)
                                    │
                                 WebSocket
                                    │
                           SafeDash Dashboard (HTML/JS)
                           ┌────────────────────────┐
                           │  🚗 Speedometer  ⚡ SOC │
                           │  🔄 RPM Gauge  ⚠ ADAS  │
                           │  🧪 Fault Injection Panel│
                           └────────────────────────┘
```

---

## Key QNX SDP 8.0 Features Used

| Feature | Purpose |
|:---|:---|
| **Resource Manager Framework** | `/dev/vehicle_telemetry` as a POSIX character device |
| **Priority-based Preemption** | Safety threads (priority 28–30) always preempt infotainment (priority 10) |
| **Pulse-based Watchdog** | Millisecond-precise subsystem health monitoring with auto-recovery |
| **POSIX Real-Time Timers** | Deterministic 20 Hz telemetry sampling via `CLOCK_MONOTONIC` |
| **Microkernel IPC** | Zero-copy message passing between safety and display subsystems |

---

## Getting Started

### Prerequisites

- **Python 3.10+** (for the CAN simulator and fault injector)
- **CMake 3.18+**
- **A C17/C++17 compiler** (GCC, Clang, or MSVC for host sim mode)
- **QNX SDP 8.0** (for full QNX target build — [get free access here](https://www.qnx.com/account/))

### Host Simulation Mode (No QNX Required)

Build and run SafeDash on your host machine (Linux, macOS, or Windows) to develop and test the full pipeline without a QNX target:

```bash
# 1. Build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build

# 2. Run the telemetry bridge (WebSocket server on port 8080)
./build/safedash_bridge     # Linux/macOS
build\Debug\safedash_bridge.exe  # Windows

# 3. In a second terminal: start the CAN traffic generator
python src/simulator/can_generator.py --mode highway --output udp

# 4. Open the dashboard
# Open ui/index.html in your browser (file:// or via a local HTTP server)

# 5. Optional: inject faults
python src/simulator/fault_injector.py --fault demo
```

### QNX SDP 8.0 Cross-Compile

```bash
# Source your QNX SDP 8.0 environment
source $QNX_SDP_VERSION/qnxsdp-env.sh

# Cross-compile for QNX x86_64
cmake -S . -B build-qnx -DCMAKE_TOOLCHAIN_FILE=scripts/qnx-toolchain.cmake
cmake --build build-qnx

# Transfer to your QEMU VM and run
scp build-qnx/safedash_resmgr qnxuser@qnx-vm:/usr/bin/
scp build-qnx/safedash_bridge  qnxuser@qnx-vm:/usr/bin/
```

---

## Fault Injection Demo

The fault injector simulates real-world embedded system failures:

```bash
# Individual faults
python src/simulator/fault_injector.py --fault cpu_stress
python src/simulator/fault_injector.py --fault infotainment_crash
python src/simulator/fault_injector.py --fault adas_alert
python src/simulator/fault_injector.py --fault clear

# Full demo sequence (for the hackathon video)
python src/simulator/fault_injector.py --fault demo
```

---

## Project Structure

```
safedash-qnx/
├── src/
│   ├── common/          # CAN frame structs, JSON protocol helpers
│   ├── qnx_resmgr/      # QNX Resource Manager, CAN handler, watchdog
│   ├── telemetry_bridge/# C++ UDP→WebSocket bridge
│   └── simulator/       # Python CAN generator & fault injector
├── ui/                  # HTML/CSS/JS digital cockpit dashboard
├── docs/                # Architecture notes & QNX setup guide
├── tests/               # Unit tests for protocol & CAN handler
└── CMakeLists.txt       # Cross-platform build (host sim + QNX cross-compile)
```

---

## Judging Criteria Alignment

| Criterion | SafeDash Approach |
|:---|:---|
| **Technological Implementation** | QNX Resource Manager, priority scheduling, pulse watchdog, POSIX RT timers |
| **Design** | Complete pipeline: simulator → resmgr → bridge → live dashboard; cohesive UX |
| **Potential Impact** | ISO 26262 FFI demonstration; directly applicable to production SDV cockpit designs |
| **Innovation** | Real-time fault injection panel proves safety properties interactively during demo |

---

## License

MIT License — See [LICENSE](LICENSE)

## Author

Built for the **QNX Global Hackathon 2026** by [Your Name].
