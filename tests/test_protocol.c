/**
 * @file test_protocol.c
 * @brief Unit tests for SafeDash protocol serialization helpers.
 */

#include "protocol.h"
#include "can_frames.h"
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include <stdlib.h>

#define TEST(name) do { \
    printf("  [RUN]  %s\n", #name); \
    test_##name(); \
    printf("  [PASS] %s\n", #name); \
} while(0)

/* -- Helpers ---------------------------------------------------------------- */

static safedash_telemetry_t make_sample_telemetry(void)
{
    safedash_telemetry_t tel;
    memset(&tel, 0, sizeof(tel));

    tel.safety.brake_pressed        = true;
    tel.safety.brake_pressure_pct   = 75;
    tel.safety.abs_active           = true;
    tel.safety.collision_imminent   = false;
    tel.safety.all_seatbelts_ok     = true;

    tel.powertrain.speed_kmh        = 120.5f;
    tel.powertrain.rpm              = 3200;
    tel.powertrain.gear             = 4;
    tel.powertrain.throttle_pct     = 42;
    tel.powertrain.engine_temp_c    = 88;

    tel.battery.soc_pct             = 73;
    tel.battery.voltage_v           = 396.5f;
    tel.battery.temp_c              = 32;
    tel.battery.regen_kw            = 12.4f;

    tel.adas.lane_departure_left    = false;
    tel.adas.lane_departure_right   = true;
    tel.adas.acc_distance_m         = 35.0f;
    tel.adas.speed_limit_kmh        = 100;

    tel.comfort.odometer_km         = 12345;
    tel.comfort.trip_distance_km    = 87.3f;
    tel.comfort.fuel_economy        = 15.2f;
    tel.comfort.ambient_temp_c      = 18;

    tel.frame_count                 = 1024;
    tel.error_count                 = 2;

    return tel;
}

/* -- Tests ------------------------------------------------------------------ */

static void test_telemetry_to_json_basic(void)
{
    safedash_telemetry_t tel = make_sample_telemetry();
    char buf[4096];
    int n = safedash_telemetry_to_json(&tel, buf, sizeof(buf));
    assert(n > 0);
    assert(strstr(buf, "\"type\":\"telemetry\"") != NULL);
    assert(strstr(buf, "\"speed_kmh\":120.5") != NULL);
    assert(strstr(buf, "\"rpm\":3200") != NULL);
    assert(strstr(buf, "\"soc_pct\":73") != NULL);
    assert(strstr(buf, "\"collision_imminent\":false") != NULL);
    assert(strstr(buf, "\"lane_departure_right\":true") != NULL);
    printf("     JSON output (%d bytes): %.120s...\n", n, buf);
}

static void test_telemetry_to_json_buffer_too_small(void)
{
    safedash_telemetry_t tel = make_sample_telemetry();
    char buf[16]; /* Intentionally tiny */
    int n = safedash_telemetry_to_json(&tel, buf, sizeof(buf));
    assert(n == -1); /* Should report truncation */
}

static void test_safety_alert_to_json(void)
{
    safedash_safety_t safety = {0};
    safety.collision_imminent  = true;
    safety.abs_active          = true;
    safety.brake_pressure_pct  = 100;

    char buf[512];
    int n = safedash_safety_alert_to_json(&safety, buf, sizeof(buf));
    assert(n > 0);
    assert(strstr(buf, "\"type\":\"safety_alert\"") != NULL);
    assert(strstr(buf, "\"collision_imminent\":true") != NULL);
}

static void test_system_status_to_json(void)
{
    char buf[256];
    int n = safedash_system_status_to_json("safety_rx", 30, 850, buf, sizeof(buf));
    assert(n > 0);
    assert(strstr(buf, "\"thread\":\"safety_rx\"") != NULL);
    assert(strstr(buf, "\"qnx_priority\":30") != NULL);
    assert(strstr(buf, "\"latency_us\":850") != NULL);
}

static void test_parse_fault_cmd_cpu_stress(void)
{
    safedash_fault_type_t fault;
    uint8_t param;
    int rc = safedash_parse_fault_cmd("{\"fault\":\"cpu_stress\"}", &fault, &param);
    assert(rc == 0);
    assert(fault == FAULT_CPU_STRESS);
}

static void test_parse_fault_cmd_clear(void)
{
    safedash_fault_type_t fault;
    uint8_t param;
    int rc = safedash_parse_fault_cmd("{\"fault\":\"clear\"}", &fault, &param);
    assert(rc == 0);
    assert(fault == FAULT_CLEAR);
}

static void test_parse_fault_cmd_unknown(void)
{
    safedash_fault_type_t fault;
    uint8_t param;
    int rc = safedash_parse_fault_cmd("{\"fault\":\"self_destruct\"}", &fault, &param);
    assert(rc == -1);
}

static void test_elapsed_ms(void)
{
    struct timespec start = { .tv_sec = 10, .tv_nsec = 500000000L }; /* 10.5s */
    struct timespec end   = { .tv_sec = 11, .tv_nsec = 750000000L }; /* 11.75s */
    uint64_t ms = safedash_elapsed_ms(&start, &end);
    assert(ms == 1250);
}

static void test_elapsed_us(void)
{
    struct timespec start = { .tv_sec = 0, .tv_nsec = 0 };
    struct timespec end   = { .tv_sec = 0, .tv_nsec = 850000L }; /* 850 µs */
    uint64_t us = safedash_elapsed_us(&start, &end);
    assert(us == 850);
}

/* -- Main ------------------------------------------------------------------- */

int main(void)
{
    printf("\nSafeDash Protocol Unit Tests\n");
    printf("============================\n\n");

    TEST(telemetry_to_json_basic);
    TEST(telemetry_to_json_buffer_too_small);
    TEST(safety_alert_to_json);
    TEST(system_status_to_json);
    TEST(parse_fault_cmd_cpu_stress);
    TEST(parse_fault_cmd_clear);
    TEST(parse_fault_cmd_unknown);
    TEST(elapsed_ms);
    TEST(elapsed_us);

    printf("\nAll tests passed.\n\n");
    return 0;
}
