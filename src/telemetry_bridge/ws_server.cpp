/**
 * @file ws_server.cpp
 * @brief Lightweight WebSocket Server Implementation
 *
 * Implements a minimal RFC 6455 WebSocket server sufficient to serve
 * SafeDash's telemetry broadcast to browser UI clients.
 *
 * Supported features:
 *   - Multi-client accept loop
 *   - WebSocket HTTP upgrade handshake (SHA-1 + Base64 via system libs)
 *   - Text frame sending (FIN=1, opcode=0x1, unmasked server→client)
 *   - Graceful close on client disconnect
 *
 * NOT implemented (out of scope for hackathon):
 *   - Receiving frames from clients (fault cmds use separate UDP port)
 *   - Per-message compression (permessage-deflate)
 *   - TLS/wss://
 */

#include "ws_server.hpp"

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  pragma comment(lib, "ws2_32.lib")
#  define CLOSE_FD(fd) closesocket(fd)
   using ssize_t = int;
#else
#  include <sys/socket.h>
#  include <netinet/in.h>
#  include <unistd.h>
#  include <poll.h>
#  define CLOSE_FD(fd) close(fd)
#endif

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <algorithm>
#include <array>
#include <stdexcept>

/* ---------------------------------------------------------------------------
 * Minimal SHA-1 and Base64 (embedded, no external deps)
 * Required for WebSocket handshake Accept key computation.
 * --------------------------------------------------------------------------- */

static void sha1(const uint8_t *data, size_t len, uint8_t out[20]);
static std::string base64_encode(const uint8_t *data, size_t len);

/* ---------------------------------------------------------------------------
 * Public API
 * --------------------------------------------------------------------------- */

void SafeDashWSServer::start(uint16_t port)
{
    if (running_) return;

#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

    port_    = port;
    running_ = true;
    accept_thread_ = std::thread(&SafeDashWSServer::accept_loop, this);
}

void SafeDashWSServer::stop()
{
    if (!running_) return;
    running_ = false;

    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        for (auto &c : clients_) {
            CLOSE_FD(c.fd);
        }
        clients_.clear();
    }

    if (accept_thread_.joinable()) accept_thread_.join();

#ifdef _WIN32
    WSACleanup();
#endif
}

void SafeDashWSServer::broadcast(const std::string& message)
{
    std::lock_guard<std::mutex> lock(clients_mutex_);
    std::vector<int> dead;

    for (auto &c : clients_) {
        if (!c.handshake_done) continue;
        try {
            send_ws_frame(c.fd, message);
        } catch (...) {
            dead.push_back(c.fd);
        }
    }

    /* Remove dead clients */
    clients_.erase(
        std::remove_if(clients_.begin(), clients_.end(),
            [&dead](const Client &c) {
                return std::find(dead.begin(), dead.end(), c.fd) != dead.end();
            }),
        clients_.end());
}

size_t SafeDashWSServer::client_count() const
{
    std::lock_guard<std::mutex> lock(clients_mutex_);
    return clients_.size();
}

/* ---------------------------------------------------------------------------
 * Accept loop
 * --------------------------------------------------------------------------- */

void SafeDashWSServer::accept_loop()
{
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) { perror("[WS] socket"); return; }

    int opt = 1;
#ifdef _WIN32
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR,
               reinterpret_cast<const char*>(&opt), sizeof(opt));
#else
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons(port_);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(server_fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        perror("[WS] bind");
        CLOSE_FD(server_fd);
        return;
    }

    listen(server_fd, 8);
    printf("[WS] Listening on port %u\n", port_);

    while (running_) {
        sockaddr_in client_addr{};
        socklen_t   client_len = sizeof(client_addr);
        int         client_fd  = accept(server_fd,
                                        reinterpret_cast<sockaddr*>(&client_addr),
                                        &client_len);
        if (client_fd < 0) {
            if (running_) perror("[WS] accept");
            continue;
        }

        {
            std::lock_guard<std::mutex> lock(clients_mutex_);
            clients_.push_back({client_fd, false});
        }

        /* Spawn a thread per client to do handshake */
        std::thread(&SafeDashWSServer::client_loop, this, client_fd).detach();
    }

    CLOSE_FD(server_fd);
}

void SafeDashWSServer::client_loop(int fd)
{
    if (!do_ws_handshake(fd)) {
        CLOSE_FD(fd);
        std::lock_guard<std::mutex> lock(clients_mutex_);
        clients_.erase(std::remove_if(clients_.begin(), clients_.end(),
            [fd](const Client &c) { return c.fd == fd; }), clients_.end());
        return;
    }

    /* Mark handshake complete */
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        for (auto &c : clients_) {
            if (c.fd == fd) { c.handshake_done = true; break; }
        }
    }

    printf("[WS] Client connected (fd=%d). Total: %zu\n", fd, client_count());

    /* Keep-alive: drain any frames the client sends (we don't use them) */
    char buf[256];
    while (running_) {
        ssize_t n = recv(fd, buf, sizeof(buf), 0);
        if (n <= 0) break;
    }

    CLOSE_FD(fd);
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        clients_.erase(std::remove_if(clients_.begin(), clients_.end(),
            [fd](const Client &c) { return c.fd == fd; }), clients_.end());
    }
    printf("[WS] Client disconnected (fd=%d)\n", fd);
}

/* ---------------------------------------------------------------------------
 * WebSocket Handshake (RFC 6455)
 * --------------------------------------------------------------------------- */

bool SafeDashWSServer::do_ws_handshake(int fd)
{
    char buf[4096] = {};
    ssize_t n = recv(fd, buf, sizeof(buf) - 1, 0);
    if (n <= 0) return false;

    std::string req(buf, static_cast<size_t>(n));

    /* Extract Sec-WebSocket-Key */
    const std::string key_header = "Sec-WebSocket-Key: ";
    auto pos = req.find(key_header);
    if (pos == std::string::npos) return false;
    pos += key_header.size();
    auto end = req.find("\r\n", pos);
    if (end == std::string::npos) return false;
    std::string ws_key = req.substr(pos, end - pos);

    std::string accept_key = compute_ws_accept(ws_key);

    std::ostringstream response;
    response << "HTTP/1.1 101 Switching Protocols\r\n"
             << "Upgrade: websocket\r\n"
             << "Connection: Upgrade\r\n"
             << "Sec-WebSocket-Accept: " << accept_key << "\r\n"
             << "\r\n";

    std::string resp_str = response.str();
    send(fd, resp_str.c_str(), static_cast<int>(resp_str.size()), 0);
    return true;
}

void SafeDashWSServer::send_ws_frame(int fd, const std::string& data)
{
    size_t payload_len = data.size();
    std::vector<uint8_t> frame;
    frame.reserve(10 + payload_len);

    frame.push_back(0x81); /* FIN=1, opcode=text (0x1) */

    if (payload_len < 126) {
        frame.push_back(static_cast<uint8_t>(payload_len));
    } else if (payload_len < 65536) {
        frame.push_back(126);
        frame.push_back(static_cast<uint8_t>((payload_len >> 8) & 0xFF));
        frame.push_back(static_cast<uint8_t>(payload_len & 0xFF));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; i--) {
            frame.push_back(static_cast<uint8_t>((payload_len >> (8 * i)) & 0xFF));
        }
    }

    frame.insert(frame.end(), data.begin(), data.end());
    send(fd, reinterpret_cast<const char*>(frame.data()),
         static_cast<int>(frame.size()), 0);
}

std::string SafeDashWSServer::compute_ws_accept(const std::string& key)
{
    static const std::string MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    std::string combined = key + MAGIC;
    uint8_t digest[20];
    sha1(reinterpret_cast<const uint8_t*>(combined.c_str()), combined.size(), digest);
    return base64_encode(digest, 20);
}

/* ---------------------------------------------------------------------------
 * SHA-1 (FIPS 180-4) — minimal embedded implementation
 * --------------------------------------------------------------------------- */

static uint32_t rol32(uint32_t v, int n) { return (v << n) | (v >> (32 - n)); }

static void sha1(const uint8_t *data, size_t len, uint8_t out[20])
{
    uint32_t h0=0x67452301, h1=0xEFCDAB89, h2=0x98BADCFE, h3=0x10325476, h4=0xC3D2E1F0;
    uint64_t bit_len = (uint64_t)len * 8;

    std::vector<uint8_t> msg(data, data + len);
    msg.push_back(0x80);
    while (msg.size() % 64 != 56) msg.push_back(0x00);
    for (int i = 7; i >= 0; i--) msg.push_back(static_cast<uint8_t>((bit_len >> (8*i)) & 0xFF));

    for (size_t i = 0; i < msg.size(); i += 64) {
        uint32_t w[80];
        for (int j = 0; j < 16; j++) {
            w[j] = ((uint32_t)msg[i+j*4]   << 24) | ((uint32_t)msg[i+j*4+1] << 16)
                 | ((uint32_t)msg[i+j*4+2] <<  8) |  (uint32_t)msg[i+j*4+3];
        }
        for (int j = 16; j < 80; j++) w[j] = rol32(w[j-3]^w[j-8]^w[j-14]^w[j-16], 1);

        uint32_t a=h0, b=h1, c=h2, d=h3, e=h4;
        for (int j = 0; j < 80; j++) {
            uint32_t f, k;
            if      (j < 20) { f=(b&c)|((~b)&d); k=0x5A827999; }
            else if (j < 40) { f=b^c^d;           k=0x6ED9EBA1; }
            else if (j < 60) { f=(b&c)|(b&d)|(c&d); k=0x8F1BBCDC; }
            else             { f=b^c^d;           k=0xCA62C1D6; }
            uint32_t tmp = rol32(a,5) + f + e + k + w[j];
            e=d; d=c; c=rol32(b,30); b=a; a=tmp;
        }
        h0+=a; h1+=b; h2+=c; h3+=d; h4+=e;
    }
    uint32_t H[5] = {h0, h1, h2, h3, h4};
    for (int i = 0; i < 5; i++) {
        out[i*4+0] = (H[i] >> 24) & 0xFF;
        out[i*4+1] = (H[i] >> 16) & 0xFF;
        out[i*4+2] = (H[i] >>  8) & 0xFF;
        out[i*4+3] =  H[i]        & 0xFF;
    }
}

/* ---------------------------------------------------------------------------
 * Base64 encoder
 * --------------------------------------------------------------------------- */
static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string base64_encode(const uint8_t *data, size_t len)
{
    std::string out;
    out.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t b = (uint32_t)data[i] << 16;
        if (i+1 < len) b |= (uint32_t)data[i+1] << 8;
        if (i+2 < len) b |= (uint32_t)data[i+2];
        out += B64[(b >> 18) & 0x3F];
        out += B64[(b >> 12) & 0x3F];
        out += (i+1 < len) ? B64[(b >>  6) & 0x3F] : '=';
        out += (i+2 < len) ? B64[ b        & 0x3F]  : '=';
    }
    return out;
}
