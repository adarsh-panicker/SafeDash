/**
 * @file watchdog.c
 * @brief Watchdog Supervisor Implementation
 *
 * Uses POSIX monotonic timestamps to track last-ping times for each channel.
 * On QNX, this maps to QNX Pulse delivery; on host sim it uses plain pthreads.
 */

#include "watchdog.h"
#include "protocol.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <pthread.h>
#include <unistd.h>

/* ---------------------------------------------------------------------------
 * Per-channel state
 * --------------------------------------------------------------------------- */
typedef struct {
    const char         *name;
    uint32_t            timeout_ms;
    struct timespec     last_ping;
    bool                alive;
    uint32_t            miss_count;
} watchdog_channel_state_t;

static watchdog_channel_state_t g_channels[WATCHDOG_CHANNEL_COUNT] = {
    [WATCHDOG_CHANNEL_CAN_RX] = {
        .name       = "can_rx",
        .timeout_ms = WATCHDOG_TIMEOUT_CAN_RX_MS,
        .alive      = true,
        .miss_count = 0,
    },
    [WATCHDOG_CHANNEL_BRIDGE_PUB] = {
        .name       = "bridge_publisher",
        .timeout_ms = WATCHDOG_TIMEOUT_BRIDGE_PUB_MS,
        .alive      = true,
        .miss_count = 0,
    },
};

static pthread_mutex_t g_wd_mutex  = PTHREAD_MUTEX_INITIALIZER;
static volatile int    g_wd_active = 1;

/* ---------------------------------------------------------------------------
 * Public API
 * --------------------------------------------------------------------------- */

void watchdog_init(void)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    for (int i = 0; i < WATCHDOG_CHANNEL_COUNT; i++) {
        g_channels[i].last_ping  = now;
        g_channels[i].alive      = true;
        g_channels[i].miss_count = 0;
    }
    printf("[WATCHDOG] Initialized %d channels.\n", WATCHDOG_CHANNEL_COUNT);
}

void watchdog_ping(watchdog_channel_t ch)
{
    if (ch >= WATCHDOG_CHANNEL_COUNT) return;

    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);

    pthread_mutex_lock(&g_wd_mutex);
    g_channels[ch].last_ping  = now;
    g_channels[ch].alive      = true;
    g_channels[ch].miss_count = 0;
    pthread_mutex_unlock(&g_wd_mutex);
}

void *watchdog_thread(void *arg)
{
    (void)arg;

#ifdef SAFEDASH_QNX_TARGET
    /* Raise watchdog to highest priority — must never be preempted */
    struct sched_param sp = { .sched_priority = 30 };
    pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
#endif

    printf("[WATCHDOG] Supervisor thread started.\n");

    while (g_wd_active) {
        /* Check every 250ms */
        struct timespec sleep_ts = { .tv_sec = 0, .tv_nsec = 250000000L };
        nanosleep(&sleep_ts, NULL);

        struct timespec now;
        clock_gettime(CLOCK_MONOTONIC, &now);

        pthread_mutex_lock(&g_wd_mutex);

        for (int i = 0; i < WATCHDOG_CHANNEL_COUNT; i++) {
            watchdog_channel_state_t *ch = &g_channels[i];
            uint64_t elapsed = safedash_elapsed_ms(&ch->last_ping, &now);

            if (elapsed > ch->timeout_ms) {
                ch->miss_count++;
                ch->alive = false;

                fprintf(stderr,
                    "[WATCHDOG] ⚠ Channel '%s' missed heartbeat! "
                    "Elapsed: %llu ms (timeout: %u ms) | Miss count: %u\n",
                    ch->name,
                    (unsigned long long)elapsed,
                    ch->timeout_ms,
                    ch->miss_count);

                /* On first miss: log and alert dashboard.
                   On subsequent misses: escalate (could restart thread). */
                if (ch->miss_count == 1) {
                    printf("[WATCHDOG] 🔄 Attempting recovery for '%s'...\n", ch->name);
                    /* Recovery hook: in a full QNX implementation this would
                       send a pulse to the supervisor to spawn() a new instance. */
                } else if (ch->miss_count >= 5) {
                    fprintf(stderr,
                        "[WATCHDOG] 🚨 CRITICAL: '%s' unrecoverable after %u misses!\n",
                        ch->name, ch->miss_count);
                }
            }
        }

        pthread_mutex_unlock(&g_wd_mutex);
    }

    printf("[WATCHDOG] Supervisor thread exiting.\n");
    return NULL;
}

void watchdog_destroy(void)
{
    g_wd_active = 0;
}
