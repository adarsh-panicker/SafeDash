/**
 * @file ws_server.hpp
 * @brief Lightweight WebSocket Server header for SafeDash Bridge
 *
 * Uses a simple header-only framing implementation to broadcast JSON
 * telemetry to all connected browser clients. For the hackathon,
 * this uses a plain TCP + WebSocket upgrade handshake.
 *
 * Production use should replace with libwebsockets or uWebSockets.
 */

#pragma once

#include <string>
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>
#include <cstdint>

class SafeDashWSServer {
public:
    SafeDashWSServer() : running_(false), port_(0) {}
    ~SafeDashWSServer() { stop(); }

    /** Start the WebSocket server on the given port. Non-blocking. */
    void start(uint16_t port);

    /** Stop the server and close all connections. */
    void stop();

    /** Broadcast a JSON string to all connected clients. */
    void broadcast(const std::string& message);

    /** Returns the number of currently connected clients. */
    size_t client_count() const;

private:
    std::atomic<bool>    running_;
    uint16_t             port_;
    std::thread          accept_thread_;

    struct Client {
        int   fd;
        bool  handshake_done;
    };

    mutable std::mutex   clients_mutex_;
    std::vector<Client>  clients_;

    void accept_loop();
    void client_loop(int fd);
    bool do_ws_handshake(int fd);
    void send_ws_frame(int fd, const std::string& data);
    std::string compute_ws_accept(const std::string& key);
};
