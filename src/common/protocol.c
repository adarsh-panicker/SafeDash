/**
 * @file protocol.c
 * @brief JSON Serialization & Protocol Helpers — Implementation
 */

#include "protocol.h"
#include <stdio.h>
#include <string.h>
#include <stdint.h>

/* ---------------------------------------------------------------------------
 * Utility: timespec elapsed helpers
 * --------------------------------------------------------------------------- */

uint64_t safedash_elapsed_ms(const struct timespec *start, const struct timespec *end)
{
    int64_t sec  = (int64_t)(end->tv_sec  - start->tv_sec);
    int64_t nsec = (int64_t)(end->tv_nsec - start->tv_nsec);
    return (uint64_t)((sec * 1000LL) + (nsec / 1000000LL));
}

uint64_t safedash_elapsed_us(const struct timespec *start, const struct timespec *end)
{
    int64_t sec  = (int64_t)(end->tv_sec  - start->tv_sec);
    int64_t nsec = (int64_t)(end->tv_nsec - start->tv_nsec);
    return (uint64_t)((sec * 1000000LL) + (nsec / 1000LL));
}

/* ---------------------------------------------------------------------------
 * Full telemetry → JSON
 * --------------------------------------------------------------------------- */

int safedash_telemetry_to_json(const safedash_telemetry_t *tel,
                               char *buf, size_t buflen)
{
    if (!tel || !buf || buflen == 0) return -1;

    int n = snprintf(buf, buflen,
        "{"
          "\"type\":\"telemetry\","
          "\"safety\":{"
            "\"brake_pressed\":%s,"
            "\"brake_pressure_pct\":%u,"
            "\"abs_active\":%s,"
            "\"airbag_fault\":%s,"
            "\"all_seatbelts_ok\":%s,"
            "\"collision_imminent\":%s"
          "},"
          "\"powertrain\":{"
            "\"speed_kmh\":%.1f,"
            "\"rpm\":%u,"
            "\"gear\":%d,"
            "\"throttle_pct\":%u,"
            "\"engine_temp_c\":%d"
          "},"
          "\"battery\":{"
            "\"soc_pct\":%u,"
            "\"voltage_v\":%.1f,"
            "\"temp_c\":%d,"
            "\"regen_kw\":%.2f"
          "},"
          "\"adas\":{"
            "\"lane_departure_left\":%s,"
            "\"lane_departure_right\":%s,"
            "\"blind_spot_left\":%s,"
            "\"blind_spot_right\":%s,"
            "\"acc_distance_m\":%.1f,"
            "\"speed_limit_kmh\":%u"
          "},"
          "\"comfort\":{"
            "\"odometer_km\":%u,"
            "\"trip_distance_km\":%.1f,"
            "\"fuel_economy\":%.1f,"
            "\"ambient_temp_c\":%d"
          "},"
          "\"stats\":{"
            "\"frame_count\":%llu,"
            "\"error_count\":%llu"
          "}"
        "}",
        /* safety */
        tel->safety.brake_pressed        ? "true" : "false",
        tel->safety.brake_pressure_pct,
        tel->safety.abs_active           ? "true" : "false",
        tel->safety.airbag_fault         ? "true" : "false",
        tel->safety.all_seatbelts_ok     ? "true" : "false",
        tel->safety.collision_imminent   ? "true" : "false",
        /* powertrain */
        (double)tel->powertrain.speed_kmh,
        tel->powertrain.rpm,
        tel->powertrain.gear,
        tel->powertrain.throttle_pct,
        tel->powertrain.engine_temp_c,
        /* battery */
        tel->battery.soc_pct,
        (double)tel->battery.voltage_v,
        tel->battery.temp_c,
        (double)tel->battery.regen_kw,
        /* adas */
        tel->adas.lane_departure_left    ? "true" : "false",
        tel->adas.lane_departure_right   ? "true" : "false",
        tel->adas.blind_spot_left        ? "true" : "false",
        tel->adas.blind_spot_right       ? "true" : "false",
        (double)tel->adas.acc_distance_m,
        tel->adas.speed_limit_kmh,
        /* comfort */
        tel->comfort.odometer_km,
        (double)tel->comfort.trip_distance_km,
        (double)tel->comfort.fuel_economy,
        tel->comfort.ambient_temp_c,
        /* stats */
        (unsigned long long)tel->frame_count,
        (unsigned long long)tel->error_count
    );

    return (n >= 0 && (size_t)n < buflen) ? n : -1;
}

/* ---------------------------------------------------------------------------
 * Safety alert → JSON
 * --------------------------------------------------------------------------- */

int safedash_safety_alert_to_json(const safedash_safety_t *safety,
                                  char *buf, size_t buflen)
{
    if (!safety || !buf || buflen == 0) return -1;

    int n = snprintf(buf, buflen,
        "{"
          "\"type\":\"safety_alert\","
          "\"collision_imminent\":%s,"
          "\"abs_active\":%s,"
          "\"airbag_fault\":%s,"
          "\"brake_pressure_pct\":%u"
        "}",
        safety->collision_imminent ? "true" : "false",
        safety->abs_active         ? "true" : "false",
        safety->airbag_fault       ? "true" : "false",
        safety->brake_pressure_pct
    );

    return (n >= 0 && (size_t)n < buflen) ? n : -1;
}

/* ---------------------------------------------------------------------------
 * System status → JSON
 * --------------------------------------------------------------------------- */

int safedash_system_status_to_json(const char *thread_name,
                                   int priority,
                                   uint64_t latency_us,
                                   char *buf, size_t buflen)
{
    if (!thread_name || !buf || buflen == 0) return -1;

    int n = snprintf(buf, buflen,
        "{"
          "\"type\":\"system_status\","
          "\"thread\":\"%s\","
          "\"qnx_priority\":%d,"
          "\"latency_us\":%llu"
        "}",
        thread_name,
        priority,
        (unsigned long long)latency_us
    );

    return (n >= 0 && (size_t)n < buflen) ? n : -1;
}

/* ---------------------------------------------------------------------------
 * Parse fault injection command
 * --------------------------------------------------------------------------- */

int safedash_parse_fault_cmd(const char *json,
                             safedash_fault_type_t *fault_out,
                             uint8_t *param_out)
{
    if (!json || !fault_out || !param_out) return -1;

    *param_out = 0;

    /* Simple substring matching — avoids heavy JSON lib dependency on target */
    if (strstr(json, "\"cpu_stress\""))         { *fault_out = FAULT_CPU_STRESS;         return 0; }
    if (strstr(json, "\"infotainment_crash\""))  { *fault_out = FAULT_INFOTAINMENT_CRASH;  return 0; }
    if (strstr(json, "\"sensor_dropout\""))      { *fault_out = FAULT_SENSOR_DROPOUT;      return 0; }
    if (strstr(json, "\"memory_pressure\""))     { *fault_out = FAULT_MEMORY_PRESSURE;     return 0; }
    if (strstr(json, "\"adas_alert\""))          { *fault_out = FAULT_ADAS_ALERT;          return 0; }
    if (strstr(json, "\"clear\""))               { *fault_out = FAULT_CLEAR;               return 0; }

    return -1; /* Unknown fault type */
}
