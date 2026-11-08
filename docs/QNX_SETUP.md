# QNX SDP 8.0 — Setup & Development Guide for SafeDash

> This guide walks through obtaining QNX SDP 8.0, setting up the QEMU virtual machine,
> cross-compiling SafeDash, and deploying it to the QNX target.

---

## 1. Getting QNX SDP 8.0 (Free for Hackathon Participants)

BlackBerry QNX provides free non-commercial access via the **QNX Everywhere** program.

### Steps:

1. **Create a myQNX Account** at https://www.qnx.com/account/
2. **Request QNX Everywhere License**:
   - Navigate to the QNX Software Center download page.
   - Click "Get QNX SDP 8.0 — Non-Commercial License".
   - Fill out the brief form; license is typically issued within minutes.
3. **Download QNX Software Center** (the package manager for QNX SDP):
   - For Windows: `QNX_SDP_8.0_Software_Center_Installer.exe`
   - For Linux: `QNX_SDP_8.0_Software_Center_Installer.run`
4. **Install QNX SDP 8.0** via the Software Center GUI or CLI:
   ```bash
   # Linux
   ./sdpinstall.sh --sdpver 8.0.0 --target /opt/qnx800
   # This installs compiler, headers, libraries, and QEMU image
   ```

---

## 2. Setting Up the QNX QEMU Virtual Machine

QNX SDP 8.0 ships with pre-built QEMU x86_64 and ARM64 disk images.

### Prerequisites:
```bash
# Ubuntu/Debian
sudo apt install qemu-system-x86

# macOS (via Homebrew)
brew install qemu
```

### Launch QNX QEMU (x86_64):

```bash
# Source QNX environment
source /opt/qnx800/qnxsdp-env.sh

# Launch QEMU with the QNX disk image
qemu-system-x86_64 \
  -drive file=$QNX_TARGET/armle-v7/usr/lib/boot/qnx-disk.img,format=raw \
  -nographic \
  -m 512M \
  -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=udp::9100-:9100,hostfwd=udp::9150-:9150,hostfwd=udp::9200-:9200 \
  -device virtio-net-pci,netdev=net0
```

> [!IMPORTANT]
> The `-hostfwd` options forward the SafeDash UDP ports from your host machine
> to the QNX QEMU VM. This lets the Python simulator on your host send CAN frames
> directly into the QNX resmgr running inside QEMU.

### SSH Into the VM:

```bash
ssh -p 2222 root@localhost
# Default QNX password: root
```

---

## 3. Cross-Compiling SafeDash for QNX SDP 8.0

```bash
# Source the QNX SDP 8.0 environment
source /opt/qnx800/qnxsdp-env.sh

# Verify toolchain
echo "QNX_HOST: $QNX_HOST"
echo "QNX_TARGET: $QNX_TARGET"

# Configure CMake with QNX toolchain
cmake -S . -B build-qnx \
  -DCMAKE_TOOLCHAIN_FILE=scripts/qnx-toolchain.cmake \
  -DCMAKE_BUILD_TYPE=Release \
  -DQNX_CPUVARDIR=x86_64

# Build
cmake --build build-qnx -j4

# Output binaries:
#   build-qnx/safedash_resmgr   (QNX Resource Manager)
#   build-qnx/safedash_bridge   (Telemetry Bridge)
```

---

## 4. Deploying to the QNX VM

```bash
# Copy binaries to the QEMU VM via SCP
scp -P 2222 build-qnx/safedash_resmgr root@localhost:/usr/bin/
scp -P 2222 build-qnx/safedash_bridge  root@localhost:/usr/bin/

# Make executable
ssh -p 2222 root@localhost "chmod +x /usr/bin/safedash_resmgr /usr/bin/safedash_bridge"
```

---

## 5. Running SafeDash on QNX

### On the QNX VM (via SSH):

```bash
# Terminal 1 — Start the Resource Manager (creates /dev/vehicle_telemetry)
safedash_resmgr &

# Terminal 2 — Start the Telemetry Bridge
safedash_bridge &

# Verify /dev/vehicle_telemetry exists
ls -la /dev/vehicle_telemetry
```

### On your host machine:

```bash
# Terminal 1 — Start the CAN traffic generator (sends UDP to QEMU)
python src/simulator/can_generator.py --mode highway --output udp --host 127.0.0.1 --port 9100

# Terminal 2 — Start the fault HTTP server (serves the UI and forwards faults)
python src/simulator/fault_http_server.py --http-port 9201 --fault-port 9200

# Terminal 3 — Open the dashboard
open http://localhost:9201/           # macOS
start http://localhost:9201/          # Windows
xdg-open http://localhost:9201/       # Linux
```

---

## 6. Verifying QNX Thread Priorities

Inside the QNX VM, verify that SafeDash threads are running at the correct priorities:

```bash
# pidin is the QNX equivalent of ps/top
pidin -p safedash_resmgr sched

# Expected output:
#   safedash_resmgr   can_rx_thread       FIFO priority=28
#   safedash_resmgr   bridge_publisher    RR   priority=10
#   safedash_resmgr   watchdog            FIFO priority=30
#   safedash_resmgr   fault_rx            RR   priority=10
```

---

## 7. Verifying the Resource Manager

```bash
# Check /dev/vehicle_telemetry is registered
ls -la /dev/vehicle_telemetry

# Read raw telemetry snapshot from the device
cat /dev/vehicle_telemetry

# Use devctl to query state (custom ioctl)
safedash_devctl_query /dev/vehicle_telemetry
```

---

## 8. QEMU Raspberry Pi 5 (ARM64) Target

SafeDash also supports cross-compilation for ARM64 (Raspberry Pi 5 with QNX):

```bash
# Build for aarch64le
cmake -S . -B build-qnx-arm \
  -DCMAKE_TOOLCHAIN_FILE=scripts/qnx-toolchain.cmake \
  -DCMAKE_BUILD_TYPE=Release \
  -DQNX_CPUVARDIR=aarch64le

cmake --build build-qnx-arm -j4
```

---

## 9. Troubleshooting

| Problem | Solution |
|:---|:---|
| `qcc: command not found` | Run `source /opt/qnx800/qnxsdp-env.sh` |
| UDP frames not arriving | Check QEMU `-hostfwd` port mappings |
| `/dev/vehicle_telemetry` missing | Confirm `safedash_resmgr` is running |
| Dashboard shows "SIGNAL LOST" | Confirm bridge is running and WS port 8080 is open |
| Watchdog firing on startup | Normal — it clears once CAN frames start arriving |
