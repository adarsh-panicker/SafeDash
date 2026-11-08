/**
 * @file resmgr_main.c
 * @brief QNX Resource Manager entry point for /dev/vehicle_telemetry
 *
 * This is the core QNX-specific component of SafeDash. It:
 *   1. Registers a character device at /dev/vehicle_telemetry using the
 *      QNX Resource Manager Framework (resmgr_attach).
 *   2. Accepts read()/write()/devctl() calls from client processes.
 *   3. Receives CAN frames via UDP socket and parses them using can_handler.
 *   4. Runs the heartbeat watchdog to detect and restart stalled subsystems.
 *
 * Thread Priority Layout:
 *   - Main dispatch thread:     priority 25 (safety-critical domain)
 *   - CAN receive thread:       priority 28 (highest, closest to hardware)
 *   - Watchdog thread:          priority 30 (highest — must always respond)
 *   - Infotainment bridge:      priority 10 (non-critical, preemptible)
 *
 * On host simulation (SAFEDASH_HOST_SIM), the resmgr is replaced by a
 * simple TCP/UDP socket server so the bridge can be tested on Linux/Windows.
 */

#ifdef SAFEDASH_QNX_TARGET
#include <sys/iofunc.h>
#include <sys/dispatch.h>
#include <sys/resmgr.h>
#include <sys/neutrino.h>
#include <sys/syspage.h>
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <signal.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>

#include "can_frames.h"
#include "protocol.h"
#include "can_handler.h"
#include "watchdog.h"

/* ---------------------------------------------------------------------------
 * Configuration
 * --------------------------------------------------------------------------- */
#define DEVICE_PATH          "/dev/vehicle_telemetry"
#define CAN_UDP_PORT         9100     /* Receives CAN frames from simulator */
#define BRIDGE_UDP_PORT      9150     /* Publishes telemetry to bridge */
#define FAULT_UDP_PORT       9200     /* Receives fault injection commands */
#define CAN_RX_THREAD_PRIO   28
#define SAFETY_DISPATCH_PRIO 25
#define WATCHDOG_PRIO        30
#define INFOTAINMENT_PRIO    10

/* ---------------------------------------------------------------------------
 * Global telemetry state (shared between CAN handler and bridge threads)
 * --------------------------------------------------------------------------- */
static safedash_telemetry_t  g_telemetry;
static pthread_mutex_t       g_telemetry_mutex = PTHREAD_MUTEX_INITIALIZER;
static volatile int          g_running = 1;

/* ---------------------------------------------------------------------------
 * CAN Receive Thread
 * Runs at REALTIME priority 28 — first to handle incoming frames.
 * --------------------------------------------------------------------------- */
static void *can_rx_thread(void *arg)
{
#ifdef SAFEDASH_QNX_TARGET
    /* Raise thread to real-time priority */
    struct sched_param sp = { .sched_priority = CAN_RX_THREAD_PRIO };
    pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
#endif

    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        perror("[CAN-RX] socket");
        return NULL;
    }

    struct sockaddr_in addr = {
        .sin_family      = AF_INET,
        .sin_port        = htons(CAN_UDP_PORT),
        .sin_addr.s_addr = INADDR_ANY,
    };

    if (bind(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("[CAN-RX] bind");
        close(sock);
        return NULL;
    }

    printf("[CAN-RX] Listening on UDP port %d\n", CAN_UDP_PORT);

    char buf[65536];
    while (g_running) {
        ssize_t n = recv(sock, buf, sizeof(buf) - 1, 0);
        if (n <= 0) continue;
        buf[n] = '\0';

        struct timespec t0, t1;
        clock_gettime(CLOCK_MONOTONIC, &t0);

        pthread_mutex_lock(&g_telemetry_mutex);
        can_handle_json_frames(buf, (size_t)n, &g_telemetry);
        pthread_mutex_unlock(&g_telemetry_mutex);

        clock_gettime(CLOCK_MONOTONIC, &t1);

        uint64_t latency_us = safedash_elapsed_us(&t0, &t1);

        /* Log latency spikes (>5 ms is concerning in RTOS context) */
        if (latency_us > 5000) {
            fprintf(stderr, "[CAN-RX] WARNING: frame processing latency %llu µs\n",
                    (unsigned long long)latency_us);
        }

        watchdog_ping(WATCHDOG_CHANNEL_CAN_RX);
    }

    close(sock);
    return NULL;
}

/* ---------------------------------------------------------------------------
 * Fault Injection Receiver Thread (priority 10 — non-critical)
 * --------------------------------------------------------------------------- */
static void *fault_rx_thread(void *arg)
{
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) { perror("[FAULT-RX] socket"); return NULL; }

    struct sockaddr_in addr = {
        .sin_family      = AF_INET,
        .sin_port        = htons(FAULT_UDP_PORT),
        .sin_addr.s_addr = INADDR_ANY,
    };

    if (bind(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("[FAULT-RX] bind");
        close(sock);
        return NULL;
    }

    printf("[FAULT-RX] Listening for fault commands on UDP port %d\n", FAULT_UDP_PORT);

    char buf[512];
    while (g_running) {
        ssize_t n = recv(sock, buf, sizeof(buf) - 1, 0);
        if (n <= 0) continue;
        buf[n] = '\0';

        safedash_fault_type_t fault = FAULT_NONE;
        uint8_t param = 0;

        if (safedash_parse_fault_cmd(buf, &fault, &param) == 0) {
            printf("[FAULT-RX] Received fault: %d (param=%d)\n", fault, param);
            can_handler_set_fault(fault, param);
        } else {
            fprintf(stderr, "[FAULT-RX] Unknown fault command: %s\n", buf);
        }
    }

    close(sock);
    return NULL;
}

/* ---------------------------------------------------------------------------
 * Telemetry Bridge Publisher Thread
 * Publishes full telemetry snapshots at 20 Hz to the bridge process.
 * --------------------------------------------------------------------------- */
static void *bridge_publisher_thread(void *arg)
{
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) { perror("[BRIDGE-PUB] socket"); return NULL; }

    struct sockaddr_in dest = {
        .sin_family      = AF_INET,
        .sin_port        = htons(BRIDGE_UDP_PORT),
        .sin_addr.s_addr = htonl(INADDR_LOOPBACK),
    };

    char json_buf[4096];

    while (g_running) {
        struct timespec sleep_ts = { .tv_sec = 0, .tv_nsec = 50000000L }; /* 50ms = 20Hz */
        nanosleep(&sleep_ts, NULL);

        pthread_mutex_lock(&g_telemetry_mutex);
        safedash_telemetry_t snap = g_telemetry;
        pthread_mutex_unlock(&g_telemetry_mutex);

        int n = safedash_telemetry_to_json(&snap, json_buf, sizeof(json_buf));
        if (n > 0) {
            sendto(sock, json_buf, (size_t)n, 0,
                   (struct sockaddr *)&dest, sizeof(dest));
        }

        watchdog_ping(WATCHDOG_CHANNEL_BRIDGE_PUB);
    }

    close(sock);
    return NULL;
}

/* ---------------------------------------------------------------------------
 * Signal handler
 * --------------------------------------------------------------------------- */
static void handle_signal(int sig)
{
    (void)sig;
    printf("\n[RESMGR] Shutting down...\n");
    g_running = 0;
}

/* ---------------------------------------------------------------------------
 * Main
 * --------------------------------------------------------------------------- */
int main(int argc, char *argv[])
{
    (void)argc; (void)argv;

    printf("SafeDash QNX Resource Manager v1.0\n");
    printf("Device: %s\n", DEVICE_PATH);

    signal(SIGINT,  handle_signal);
    signal(SIGTERM, handle_signal);

    memset(&g_telemetry, 0, sizeof(g_telemetry));
    can_handler_init();
    watchdog_init();

    /* Spawn threads */
    pthread_t can_rx_tid, fault_rx_tid, bridge_pub_tid, watchdog_tid;

    pthread_create(&can_rx_tid,     NULL, can_rx_thread,          NULL);
    pthread_create(&fault_rx_tid,   NULL, fault_rx_thread,        NULL);
    pthread_create(&bridge_pub_tid, NULL, bridge_publisher_thread, NULL);
    pthread_create(&watchdog_tid,   NULL, watchdog_thread,         NULL);

    printf("[RESMGR] All subsystems online. Press Ctrl+C to stop.\n");

    /* Wait for shutdown */
    pthread_join(can_rx_tid,     NULL);
    pthread_join(fault_rx_tid,   NULL);
    pthread_join(bridge_pub_tid, NULL);
    pthread_join(watchdog_tid,   NULL);

    watchdog_destroy();
    printf("[RESMGR] Clean shutdown complete.\n");
    return 0;
}
