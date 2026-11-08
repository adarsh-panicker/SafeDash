# SafeDash — Real Vehicle Architecture & QNX Production Integration Guide

> **How SafeDash Deploys Into a Real Production Automobile Running QNX SDP 8.0**

This document outlines the exact Tier-1 automotive hardware/software architecture showing how SafeDash integrates with a vehicle's physical Cockpit Domain Controller (CDC) and physical CAN/Ethernet buses.

---

## 1. Physical Hardware & Automotive SoC Architecture

In modern production vehicles (e.g. Porsche, Audi, Ford, Mercedes-Benz, BMW), the digital instrument cluster is powered by an automotive-grade Cockpit Domain Controller (CDC) SoC:
* **Target Automotive SoCs:**
  * Qualcomm Snapdragon Digital Chassis (SA8155P / SA8295P)
  * NXP i.MX 8QuadMax / i.MX 95
  * Renesas R-Car H3 / H4
  * Texas Instruments Jacinto 7 (TDA4VM / DRA829V)

```
                       AUTOMOTIVE VEHICLE NETWORK
  ┌──────────────────────────────────────────────────────────────────┐
  │  Powertrain CAN-FD    ADAS Ethernet (SOME/IP)    Body CAN Bus    │
  └───────────────┬──────────────────────┬─────────────────┬─────────┘
                  │                      │                 │
         [CAN Transceiver]         [100BASE-T1 PHY]  [CAN Transceiver]
                  │                      │                 │
┌─────────────────▼──────────────────────▼─────────────────▼─────────┐
│              AUTOMOTIVE COCKPIT DOMAIN CONTROLLER (SoC)            │
│                 Qualcomm SA8295P / NXP i.MX 8QuadMax               │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │             QNX Neutrino RTOS 8.0 (ISO 26262 ASIL-D)          │  │
│  │                                                              │  │
│  │  [Hardware CAN Driver]             [QNX Network Stack]       │  │
│  │  (dev-can-rcar / dev-can-imx)       (io-pkt-v6-hc)           │  │
│  │                 │                            │               │  │
│  │                 ▼                            ▼               │  │
│  │     SafeDash QNX Resource Manager (/dev/vehicle_telemetry)   │  │
│  │     • Priority 30: Watchdog Supervisor (Pulse Heartbeat)     │  │
│  │     • Priority 28: Hardware CAN Frame Ingestion & Filtering  │  │
│  │     • Priority 25: ASIL-D Safety Alert Dispatch              │  │
│  │     • Priority 10: Infotainment & Telemetry Serializer       │  │
│  │                                                              │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │         QNX Screen Graphics Subsystem (screen)         │  │  │
│  │  │         • OpenGL ES 3.2 / Vulkan Hardware Layer        │  │  │
│  │  │         • Chromium Embedded Framework / WebGL Engine   │  │  │
│  │  └───────────────────────────┬────────────────────────────┘  │  │
│  └──────────────────────────────┼───────────────────────────────┘  │
└─────────────────────────────────┼──────────────────────────────────┘
                                  │ eDP / FPD-Link III / GMSL2
                                  ▼
                 ┌──────────────────────────────────┐
                 │  12.3" CURVED INSTRUMENT CLUSTER │
                 │  (Physical Display Behind Wheel) │
                 │        SafeDash Cockpit UI       │
                 └──────────────────────────────────┘
```

---

## 2. Step-by-Step Production Deployment on QNX

### Step 1: Physical CAN Controller Binding
In a real vehicle, rather than listening to a synthetic UDP port, the QNX Resource Manager binds directly to the vehicle's hardware CAN driver:
```c
// Native QNX production CAN controller binding:
int fd = open("/dev/can0/rx0", O_RDONLY);
struct can_msg msg;
while (running) {
    read(fd, &msg, sizeof(msg));
    can_handle_raw_frame(&msg, &g_telemetry);
}
```

### Step 2: Display Routing via QNX Screen Subsystem
QNX uses the **Screen Graphics Subsystem** (`/etc/system/config/screen.conf`) to map the cluster application to the physical digital cluster panel (Display 0):
```conf
# /etc/system/config/screen.conf
begin display 0
  video-mode = 1920 x 720 @ 60
  format = rgba8888
  cursor = none
end display

begin class safedash-cluster
  display = 0
  pipeline = 1
  format = rgba8888
  order = 1
  usage = direct-to-display
end class
```

### Step 3: ISO 26262 ASIL-D Freedom from Interference (FFI)
To satisfy functional safety audits:
1. **Process Memory Protection:** QNX Neutrino enforces hardware MMU memory separation. Even if an infotainment process faults (`SIGSEGV`), the `safedash_resmgr` memory space is completely untouched.
2. **Adaptive Partitioning Scheduler (APS):**
   * `Safety_Partition`: Guaranteed **60% CPU time** (cannot be starved).
   * `Infotainment_Partition`: Capped at **25% CPU time**.
   * `Diagnostics_Partition`: Capped at **15% CPU time**.
3. **Pulse Watchdog:** If the graphics renderer freezes due to a GPU hang, the QNX watchdog detects the missed heartbeat pulse within 250ms and power-cycles the display pipeline without rebooting the vehicle or dropping CAN logs.

---

## 3. Real Vehicle Hardware Interfaces Supported by SafeDash
* **Physical CAN / CAN-FD:** High-speed powertrain telemetry (Speed, RPM, Torque, Gear, Brake Pressure).
* **Automotive Ethernet (IEEE 802.3bw / 100BASE-T1):** ADAS camera and radar object vectors.
* **LIN Bus (Local Interconnect Network):** Seatbelt buckle switches, ambient light, climate sensor data.
* **OBD-II / UDS (ISO 14229):** On-board diagnostic trouble code reporting.
