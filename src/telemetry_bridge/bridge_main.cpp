/**
 * @file bridge_main.cpp
 * @brief SafeDash Telemetry Bridge — Receives from resmgr, streams to UI
 *
 * Runs on both QNX (reads from /dev/vehicle_telemetry UDP pub port) and
 * host simulation mode (reads directly from can_generator UDP stream).
 *
 * Architecture:
 *   UDP port 9150 (from resmgr publisher) → bridge parser → WebSocket → UI
 *
 * In host sim mode (no QNX), reads directly from can_generator on port 9100.
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <csignal>
#include <thread>
#include <atomic>
#include <string>
#include <vector>
#include <chrono>
#include <mutex>

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  pragma comment(lib, "ws2_32.lib")
   using socket_t = SOCKET;
#  define CLOSE_SOCKET(s) closesocket(s)
#  define INVALID_SOCK INVALID_SOCKET
#else
#  include <sys/socket.h>
#  include <netinet/in.h>
#  include <unistd.h>
   using socket_t = int;
#  define CLOSE_SOCKET(s) close(s)
#  define INVALID_SOCK (-1)
#endif

#include "ws_server.hpp"

/* ---------------------------------------------------------------------------
 * Configuration
 * --------------------------------------------------------------------------- */
#ifdef SAFEDASH_HOST_SIM
static constexpr uint16_t LISTEN_PORT  = 9100;  /* Direct from can_generator */
#else
static constexpr uint16_t LISTEN_PORT  = 9150;  /* From resmgr bridge publisher */
#endif
static constexpr uint16_t WS_PORT      = 8080;  /* WebSocket port for UI */
static constexpr size_t   RECV_BUF_SZ  = 65536;

/* ---------------------------------------------------------------------------
 * Globals
 * --------------------------------------------------------------------------- */
static std::atomic<bool>  g_running{true};
static SafeDashWSServer   g_ws_server;

static void handle_signal(int) { g_running = false; }

/* ---------------------------------------------------------------------------
 * UDP receiver loop — runs in its own thread
 * --------------------------------------------------------------------------- */
static void udp_receive_loop()
{
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

    socket_t sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock == INVALID_SOCK) {
        perror("[BRIDGE] socket");
        return;
    }

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons(LISTEN_PORT);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        perror("[BRIDGE] bind");
        CLOSE_SOCKET(sock);
        return;
    }

    printf("[BRIDGE] Listening on UDP port %u\n", LISTEN_PORT);

    std::vector<char> buf(RECV_BUF_SZ);

    while (g_running) {
#ifdef _WIN32
        int n = recv(sock, buf.data(), static_cast<int>(buf.size()) - 1, 0);
#else
        ssize_t n = recv(sock, buf.data(), buf.size() - 1, 0);
#endif
        if (n <= 0) continue;
        buf[n] = '\0';

        /* Forward raw JSON to all connected WebSocket clients */
        g_ws_server.broadcast(std::string(buf.data(), static_cast<size_t>(n)));
    }

    CLOSE_SOCKET(sock);

#ifdef _WIN32
    WSACleanup();
#endif
}

/* ---------------------------------------------------------------------------
 * Main
 * --------------------------------------------------------------------------- */
int main()
{
    printf("SafeDash Telemetry Bridge v1.0\n");
#ifdef SAFEDASH_HOST_SIM
    printf("Mode: Host Simulation (reading from can_generator on port %u)\n", LISTEN_PORT);
#else
    printf("Mode: QNX Target (reading from resmgr publisher on port %u)\n", LISTEN_PORT);
#endif
    printf("WebSocket server on ws://localhost:%u\n\n", WS_PORT);

    signal(SIGINT,  handle_signal);
    signal(SIGTERM, handle_signal);

    /* Start WebSocket server */
    g_ws_server.start(WS_PORT);

    /* Run UDP receiver in a background thread */
    std::thread udp_thread(udp_receive_loop);

    printf("[BRIDGE] Open ui/index.html in your browser to view the dashboard.\n");
    printf("[BRIDGE] Press Ctrl+C to stop.\n\n");

    while (g_running) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    printf("[BRIDGE] Shutting down...\n");
    g_ws_server.stop();
    udp_thread.join();

    return 0;
}
