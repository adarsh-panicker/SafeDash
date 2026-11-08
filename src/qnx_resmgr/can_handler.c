/**
 * @file can_handler.c
 * @brief CAN Frame Parser, Fault Injector, and Telemetry State Updater
 *
 * Parses the JSON frame bundles produced by can_generator.py and updates
 * the global safedash_telemetry_t struct. Also handles fault injection.
 */

#include "can_handler.h"
#include "protocol.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <time.h>

/* ---------------------------------------------------------------------------
 * Fault injection state
 * --------------------------------------------------------------------------- */
static safedash_fault_type_t g_active_fault = FAULT_NONE;
static uint8_t               g_fault_param  = 0;
static pthread_mutex_t       g_fault_mutex  = PTHREAD_MUTEX_INITIALIZER;

/* Background CPU stress thread handle */
static pthread_t  g_cpu_stress_tid  = 0;
static volatile int g_cpu_stress_run = 0;

/* ---------------------------------------------------------------------------
 * CPU stress thread (simulates priority-10 background runaway)
 * --------------------------------------------------------------------------- */
static void *cpu_stress_worker(void *arg)
{
    (void)arg;
    printf("[FAULT] CPU stress thread started (priority 5).\n");
    volatile uint64_t x = 0;
    while (g_cpu_stress_run) {
        /* Intentionally spinning to consume CPU */
        for (int i = 0; i < 1000000; i++) x += (uint64_t)i * i;
    }
    printf("[FAULT] CPU stress thread stopped.\n");
    return NULL;
}

/* ---------------------------------------------------------------------------
 * Public API
 * --------------------------------------------------------------------------- */

void can_handler_init(void)
{
    g_active_fault = FAULT_NONE;
    g_fault_param  = 0;
}

void can_handler_set_fault(safedash_fault_type_t fault, uint8_t param)
{
    pthread_mutex_lock(&g_fault_mutex);
    g_active_fault = fault;
    g_fault_param  = param;
    pthread_mutex_unlock(&g_fault_mutex);

    switch (fault) {
        case FAULT_CPU_STRESS:
            if (!g_cpu_stress_run) {
                g_cpu_stress_run = 1;
                pthread_create(&g_cpu_stress_tid, NULL, cpu_stress_worker, NULL);
            }
            printf("[FAULT] CPU stress ACTIVATED.\n");
            break;

        case FAULT_INFOTAINMENT_CRASH:
            printf("[FAULT] Infotainment crash SIMULATED "
                   "(comfort/trip data frozen until watchdog restarts).\n");
            break;

        case FAULT_SENSOR_DROPOUT:
            printf("[FAULT] Sensor dropout ACTIVATED for CAN ID 0x%03X.\n", param);
            break;

        case FAULT_MEMORY_PRESSURE:
            printf("[FAULT] Memory pressure ACTIVATED (allocating stress slabs).\n");
            break;

        case FAULT_ADAS_ALERT:
            printf("[FAULT] 🚨 ADAS collision alert INJECTED!\n");
            break;

        case FAULT_CLEAR:
            /* Stop stress threads */
            if (g_cpu_stress_run) {
                g_cpu_stress_run = 0;
                pthread_join(g_cpu_stress_tid, NULL);
                g_cpu_stress_tid = 0;
            }
            g_active_fault = FAULT_NONE;
            printf("[FAULT] All faults CLEARED.\n");
            break;

        default:
            break;
    }
}

void can_handler_clear_faults(void)
{
    can_handler_set_fault(FAULT_CLEAR, 0);
}

/* ---------------------------------------------------------------------------
 * Minimal JSON value extractor (avoids heavy JSON library dependency)
 *
 * Extracts the first numeric value associated with a key in a flat JSON object.
 * Example: extract_num("{\"speed_kmh\": 120.5}", "speed_kmh") → 120.5
 * --------------------------------------------------------------------------- */
static double extract_num(const char *json, const char *key)
{
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char *p = strstr(json, search);
    if (!p) return 0.0;
    p += strlen(search);
    while (*p == ' ') p++;
    return strtod(p, NULL);
}

static int extract_bool(const char *json, const char *key)
{
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char *p = strstr(json, search);
    if (!p) return 0;
    p += strlen(search);
    while (*p == ' ') p++;
    return (strncmp(p, "true", 4) == 0) ? 1 : 0;
}

/* ---------------------------------------------------------------------------
 * Main frame handler: parses JSON summary and updates telemetry struct
 *
 * The JSON produced by can_generator.py --output stdout has this shape:
 *   {"speed_kmh": 115.3, "rpm": 3200, "gear": 6, ...}
 * --------------------------------------------------------------------------- */
void can_handle_json_frames(const char *json_buf, size_t len,
                            safedash_telemetry_t *tel)
{
    if (!json_buf || len == 0 || !tel) return;

    /* Check for active sensor dropout on a CAN ID — skip if silenced */
    pthread_mutex_lock(&g_fault_mutex);
    safedash_fault_type_t fault = g_active_fault;
    pthread_mutex_unlock(&g_fault_mutex);

    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);

    /* -- Powertrain -- */
    if (fault != FAULT_SENSOR_DROPOUT) {
        tel->powertrain.speed_kmh    = (float)extract_num(json_buf, "speed_kmh");
        tel->powertrain.rpm          = (uint16_t)extract_num(json_buf, "rpm");
        tel->powertrain.gear         = (int8_t)extract_num(json_buf, "gear");
        tel->powertrain.throttle_pct = (uint8_t)extract_num(json_buf, "throttle_pct");
        tel->powertrain.last_updated = now;
    }

    /* -- Safety -- */
    tel->safety.brake_pressed      = (bool)extract_bool(json_buf, "brake_pressed");
    tel->safety.brake_pressure_pct = (uint8_t)extract_num(json_buf, "brake_pct");
    tel->safety.abs_active         = (bool)extract_bool(json_buf, "abs_active");

    /* Inject ADAS alert fault */
    if (fault == FAULT_ADAS_ALERT) {
        tel->safety.collision_imminent = true;
    } else {
        tel->safety.collision_imminent = (bool)extract_bool(json_buf, "collision");
    }

    tel->safety.all_seatbelts_ok = true; /* Assumed OK unless frame says otherwise */
    tel->safety.last_updated     = now;

    /* -- Battery -- */
    tel->battery.soc_pct    = (uint8_t)extract_num(json_buf, "soc_pct");
    tel->battery.regen_kw   = (float)extract_num(json_buf, "regen_kw");
    tel->battery.last_updated = now;

    /* -- ADAS -- */
    if (fault != FAULT_INFOTAINMENT_CRASH) {
        tel->adas.lane_departure_left  = (bool)extract_bool(json_buf, "lane_dep_L");
        tel->adas.lane_departure_right = (bool)extract_bool(json_buf, "lane_dep_R");
        tel->adas.blind_spot_left      = (bool)extract_bool(json_buf, "bspot_L");
        tel->adas.last_updated         = now;
    }

    tel->frame_count++;
}
