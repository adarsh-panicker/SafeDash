/**
 * @file can_frames.h
 * @brief CAN Bus Frame Definitions for SafeDash QNX Instrument Cluster
 *
 * Defines all CAN message IDs, data layouts, and telemetry structures
 * shared between the QNX Resource Manager, Telemetry Bridge, and Simulator.
 *
 * CAN IDs follow a standard automotive priority scheme:
 *  - 0x001–0x0FF: Safety-critical (ABS, brakes, airbag, collision)
 *  - 0x100–0x1FF: Powertrain (speed, RPM, gear, throttle)
 *  - 0x200–0x2FF: Battery & thermal management
 *  - 0x300–0x3FF: ADAS (lane departure, forward collision, blind spot)
 *  - 0x400–0x4FF: Comfort & infotainment (trip, climate, media)
 */

#ifndef SAFEDASH_CAN_FRAMES_H
#define SAFEDASH_CAN_FRAMES_H

#include <stdint.h>
#include <stdbool.h>
#include <time.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---------------------------------------------------------------------------
 * CAN Message ID Definitions
 * --------------------------------------------------------------------------- */

/* -- Safety Critical (Priority: HIGH) -- */
#define CAN_ID_BRAKE_STATUS         0x001U   /* Brake pedal position & ABS state */
#define CAN_ID_AIRBAG_STATUS        0x002U   /* Airbag deployment readiness */
#define CAN_ID_SEATBELT_STATUS      0x003U   /* Per-seat seatbelt engagement */
#define CAN_ID_COLLISION_ALERT      0x004U   /* Forward collision imminent */

/* -- Powertrain (Priority: MEDIUM-HIGH) -- */
#define CAN_ID_VEHICLE_SPEED        0x100U   /* Wheel speed sensor (km/h) */
#define CAN_ID_ENGINE_RPM           0x101U   /* Engine/motor RPM */
#define CAN_ID_GEAR_POSITION        0x102U   /* Current gear: P/R/N/1-8 */
#define CAN_ID_THROTTLE_POSITION    0x103U   /* Throttle pedal percentage */
#define CAN_ID_ENGINE_TEMP          0x104U   /* Coolant temperature (°C) */
#define CAN_ID_PERFORMANCE_DYN      0x105U   /* G-Forces (lat/long) & Power kW */

/* -- Battery & EV (Priority: MEDIUM) -- */
#define CAN_ID_BATTERY_SOC          0x200U   /* State of charge (%) */
#define CAN_ID_BATTERY_VOLTAGE      0x201U   /* Pack voltage (V * 10) */
#define CAN_ID_BATTERY_TEMP         0x202U   /* Battery pack temperature (°C) */
#define CAN_ID_REGEN_POWER          0x203U   /* Regenerative braking power (kW * 10) */
#define CAN_ID_TPMS_STATUS          0x205U   /* 4-wheel tire pressure (PSI) & temp */

/* -- ADAS (Priority: HIGH when active, LOW otherwise) -- */
#define CAN_ID_LANE_DEPARTURE       0x300U   /* Lane departure warning */
#define CAN_ID_BLIND_SPOT           0x301U   /* Blind spot monitoring (L/R) */
#define CAN_ID_ADAPTIVE_CRUISE      0x302U   /* ACC target vehicle distance (m) */
#define CAN_ID_TRAFFIC_SIGN         0x303U   /* Detected speed limit sign (km/h) */
#define CAN_ID_NAV_PREVIEW          0x305U   /* Turn maneuver, distance (m), heading */

/* -- Comfort & Infotainment (Priority: LOW) -- */
#define CAN_ID_ODOMETER             0x400U   /* Total distance (km) */
#define CAN_ID_TRIP_DISTANCE        0x401U   /* Trip A distance (km * 10) */
#define CAN_ID_FUEL_ECONOMY         0x402U   /* Avg fuel/energy (L/100km * 10 or Wh/km) */
#define CAN_ID_AMBIENT_TEMP         0x403U   /* Outside temperature (°C) */
#define CAN_ID_CLIMATE_STATUS       0x404U   /* HVAC set temperature, fan speed */

/* ---------------------------------------------------------------------------
 * Raw CAN Frame (wire format)
 * --------------------------------------------------------------------------- */

#define CAN_MAX_DATA_LEN  8U

typedef struct {
    uint32_t id;                    /* 11-bit CAN ID (standard frame) */
    uint8_t  len;                   /* Data length code (0–8) */
    uint8_t  data[CAN_MAX_DATA_LEN]; /* Raw payload bytes */
    struct timespec timestamp;      /* Monotonic capture timestamp */
} can_frame_t;

/* ---------------------------------------------------------------------------
 * Decoded Telemetry Structures (populated by can_handler)
 * --------------------------------------------------------------------------- */

/** Safety-critical snapshot — always valid, never NULL after first frame */
typedef struct {
    bool     brake_pressed;         /* true if brake pedal > 5% */
    uint8_t  brake_pressure_pct;    /* 0–100 */
    bool     abs_active;
    bool     airbag_fault;
    bool     all_seatbelts_ok;
    bool     collision_imminent;    /* triggers highest priority alert */
    struct timespec last_updated;
} safedash_safety_t;

/** Powertrain snapshot */
typedef struct {
    float    speed_kmh;             /* 0.0 – 300.0 km/h */
    uint16_t rpm;                   /* 0 – 20000 RPM */
    int8_t   gear;                  /* -1=R, 0=N, 1-8=Drive gears */
    uint8_t  throttle_pct;          /* 0–100 */
    int16_t  engine_temp_c;         /* -40 to 200 °C */
    struct timespec last_updated;
} safedash_powertrain_t;

/** Battery / EV snapshot */
typedef struct {
    uint8_t  soc_pct;               /* 0–100 state of charge */
    float    voltage_v;             /* Pack voltage */
    int16_t  temp_c;                /* Battery temperature */
    float    regen_kw;              /* Current regen power */
    struct timespec last_updated;
} safedash_battery_t;

/** ADAS snapshot */
typedef struct {
    bool     lane_departure_left;
    bool     lane_departure_right;
    bool     blind_spot_left;
    bool     blind_spot_right;
    float    acc_distance_m;        /* 0.0 = no target */
    uint8_t  speed_limit_kmh;       /* 0 = unknown */
    struct timespec last_updated;
} safedash_adas_t;

/** Comfort / Infotainment snapshot */
typedef struct {
    uint32_t odometer_km;
    float    trip_distance_km;
    float    fuel_economy;          /* L/100km or Wh/km depending on vehicle type */
    int8_t   ambient_temp_c;
    uint8_t  hvac_set_temp_c;
    uint8_t  hvac_fan_speed;        /* 0=off, 1–8 */
    struct timespec last_updated;
} safedash_comfort_t;

/** Complete vehicle telemetry state — the master shared structure */
typedef struct {
    safedash_safety_t     safety;
    safedash_powertrain_t powertrain;
    safedash_battery_t    battery;
    safedash_adas_t       adas;
    safedash_comfort_t    comfort;
    uint64_t              frame_count;    /* Total CAN frames processed */
    uint64_t              error_count;    /* Malformed / dropped frames */
} safedash_telemetry_t;

/* ---------------------------------------------------------------------------
 * Telemetry Serialization for IPC & WebSocket Bridge
 * --------------------------------------------------------------------------- */

/** Wire protocol message type tags */
typedef enum {
    MSG_TYPE_FULL_TELEMETRY  = 0x01, /* Full safedash_telemetry_t snapshot */
    MSG_TYPE_SAFETY_ALERT    = 0x02, /* High-priority safety event (immediate push) */
    MSG_TYPE_WATCHDOG_PING   = 0x03, /* Watchdog heartbeat */
    MSG_TYPE_WATCHDOG_PONG   = 0x04, /* Watchdog reply */
    MSG_TYPE_FAULT_INJECT    = 0x05, /* Fault injection command (from UI panel) */
    MSG_TYPE_SYSTEM_STATUS   = 0x06, /* Thread priority & latency diagnostics */
} safedash_msg_type_t;

/** Fault injection types (from UI fault panel → bridge → resmgr) */
typedef enum {
    FAULT_NONE               = 0x00,
    FAULT_CPU_STRESS         = 0x01, /* Spawn CPU-intensive background thread */
    FAULT_INFOTAINMENT_CRASH = 0x02, /* Kill the infotainment/comfort thread */
    FAULT_SENSOR_DROPOUT     = 0x03, /* Silence a specific CAN ID */
    FAULT_MEMORY_PRESSURE    = 0x04, /* Allocate large memory chunks */
    FAULT_ADAS_ALERT         = 0x05, /* Trigger simulated collision alert */
    FAULT_CLEAR              = 0xFF, /* Reset all injected faults */
} safedash_fault_type_t;

/** IPC message header (prepended to all messages on the bridge socket) */
typedef struct {
    uint8_t              type;       /* safedash_msg_type_t */
    uint16_t             payload_len;
    uint8_t              fault_type; /* For MSG_TYPE_FAULT_INJECT */
    uint8_t              fault_param;
    uint32_t             seq;        /* Monotonically increasing sequence number */
} safedash_msg_header_t;

#ifdef __cplusplus
}
#endif

#endif /* SAFEDASH_CAN_FRAMES_H */
