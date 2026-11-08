/**
 * @file watchdog.h
 * @brief QNX Pulse-Based Watchdog Supervisor for SafeDash
 *
 * The watchdog monitors heartbeat pings from each critical subsystem thread.
 * If a thread misses its ping within the configured timeout, the watchdog:
 *   1. Logs the fault event with a monotonic timestamp.
 *   2. Attempts to restart the failed subsystem (if restartable).
 *   3. Pushes a system_status alert to the UI dashboard.
 */

#ifndef SAFEDASH_WATCHDOG_H
#define SAFEDASH_WATCHDOG_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Watchdog channel identifiers — one per supervised thread */
typedef enum {
    WATCHDOG_CHANNEL_CAN_RX     = 0,
    WATCHDOG_CHANNEL_BRIDGE_PUB = 1,
    WATCHDOG_CHANNEL_COUNT      = 2,  /* Must remain last */
} watchdog_channel_t;

/** Watchdog timeout per channel (milliseconds) */
#define WATCHDOG_TIMEOUT_CAN_RX_MS      500U   /* CAN RX must ping every 500ms */
#define WATCHDOG_TIMEOUT_BRIDGE_PUB_MS  1000U  /* Bridge publisher every 1s */

/**
 * @brief Initialize the watchdog supervisor.
 * Must be called before any thread calls watchdog_ping().
 */
void watchdog_init(void);

/**
 * @brief Send a heartbeat ping from the specified channel.
 * @param ch   The watchdog channel corresponding to the calling thread.
 */
void watchdog_ping(watchdog_channel_t ch);

/**
 * @brief The watchdog supervisor thread entry point.
 * Monitors all channels and triggers recovery on timeout.
 */
void *watchdog_thread(void *arg);

/**
 * @brief Clean up watchdog resources.
 */
void watchdog_destroy(void);

#ifdef __cplusplus
}
#endif

#endif /* SAFEDASH_WATCHDOG_H */
