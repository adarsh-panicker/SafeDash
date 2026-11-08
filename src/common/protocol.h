/**
 * @file protocol.h
 * @brief JSON Serialization & Binary Protocol Helpers for SafeDash
 *
 * Provides lightweight functions to serialize safedash_telemetry_t snapshots
 * into JSON strings for transmission over the WebSocket bridge to the UI.
 * No external JSON library dependency — hand-rolled for QNX embedded targets.
 */

#ifndef SAFEDASH_PROTOCOL_H
#define SAFEDASH_PROTOCOL_H

#include "can_frames.h"
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Serialize a full telemetry snapshot into a JSON string.
 *
 * @param tel    Pointer to the telemetry snapshot to serialize.
 * @param buf    Output buffer to write JSON into.
 * @param buflen Size of the output buffer in bytes.
 * @return       Number of bytes written (excluding NUL), or -1 on truncation.
 */
int safedash_telemetry_to_json(const safedash_telemetry_t *tel,
                               char *buf, size_t buflen);

/**
 * @brief Serialize a safety alert into a compact JSON string.
 *
 * @param safety   Safety snapshot.
 * @param buf      Output buffer.
 * @param buflen   Buffer size.
 * @return         Bytes written, or -1 on error.
 */
int safedash_safety_alert_to_json(const safedash_safety_t *safety,
                                  char *buf, size_t buflen);

/**
 * @brief Serialize a system status snapshot (latency, thread info) to JSON.
 *
 * @param thread_name   Name of the reporting thread.
 * @param priority      QNX thread priority (0–255).
 * @param latency_us    Last measured CAN frame processing latency (microseconds).
 * @param buf           Output buffer.
 * @param buflen        Buffer size.
 * @return              Bytes written, or -1 on error.
 */
int safedash_system_status_to_json(const char *thread_name,
                                   int priority,
                                   uint64_t latency_us,
                                   char *buf, size_t buflen);

/**
 * @brief Parse a fault injection JSON command from the UI panel.
 *
 * Expected format: {"fault": "cpu_stress"} or {"fault": "clear"}
 *
 * @param json        Input JSON string.
 * @param fault_out   Output fault type.
 * @param param_out   Optional fault parameter (e.g. CAN ID to silence).
 * @return            0 on success, -1 on parse error.
 */
int safedash_parse_fault_cmd(const char *json,
                             safedash_fault_type_t *fault_out,
                             uint8_t *param_out);

/**
 * @brief Compute elapsed milliseconds between two monotonic timestamps.
 */
uint64_t safedash_elapsed_ms(const struct timespec *start,
                              const struct timespec *end);

/**
 * @brief Compute elapsed microseconds between two monotonic timestamps.
 */
uint64_t safedash_elapsed_us(const struct timespec *start,
                              const struct timespec *end);

#ifdef __cplusplus
}
#endif

#endif /* SAFEDASH_PROTOCOL_H */
