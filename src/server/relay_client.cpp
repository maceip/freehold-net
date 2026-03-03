#include "relay_client.h"
#include "logging.h"

#include <cstring>
#include <chrono>
#include <algorithm>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
typedef int socklen_t;
static void close_socket(int fd) { closesocket(fd); }
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <fcntl.h>
static void close_socket(int fd) { close(fd); }
#endif

// ── Helpers ──────────────────────────────────────────────────────────────────

static bool resolve_host(const char* host, int port, struct sockaddr_in* out) {
    struct addrinfo hints = {}, *res = nullptr;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    char port_str[8];
    snprintf(port_str, sizeof(port_str), "%d", port);
    if (getaddrinfo(host, port_str, &hints, &res) != 0 || !res) return false;
    memcpy(out, res->ai_addr, sizeof(struct sockaddr_in));
    freeaddrinfo(res);
    return true;
}

// Extract subdomain from relay Neighbors payload.
// The relay sends a list of assigned subdomains. We look for one matching
// our port. Format: series of [port:u16][subdomain_len:u8][subdomain:chars]
static std::string extract_subdomain(const uint8_t* payload, int len, uint16_t our_port) {
    int off = 0;
    while (off + 3 <= len) {
        uint16_t port = (payload[off] << 8) | payload[off + 1];
        uint8_t slen = payload[off + 2];
        off += 3;
        if (off + slen > len) break;
        if (port == our_port) {
            return std::string((const char*)payload + off, slen);
        }
        off += slen;
    }
    return "";
}

// ── RelayClient ──────────────────────────────────────────────────────────────

RelayClient::RelayClient(const Config& cfg) : cfg_(cfg) {
    states_.resize(cfg_.services.size());
    for (size_t i = 0; i < cfg_.services.size(); i++) {
        states_[i].svc = cfg_.services[i];
    }
}

RelayClient::~RelayClient() { stop(); }

void RelayClient::start() {
    if (running_.load()) return;
    running_ = true;

    for (size_t i = 0; i < states_.size(); i++) {
        states_[i].engine_thread = std::thread(&RelayClient::engine_loop, this, (int)i);
        LOG(INFO, "Relay: registering service '%s' on port %d",
            states_[i].svc.name.c_str(), states_[i].svc.relay_port);
    }
}

void RelayClient::stop() {
    if (!running_.load()) return;
    running_ = false;
    for (auto& st : states_) {
        if (st.udp_fd >= 0) {
            close_socket(st.udp_fd);
            st.udp_fd = -1;
        }
        if (st.engine_thread.joinable()) st.engine_thread.join();
    }
    LOG(INFO, "Relay client stopped");
}

std::string RelayClient::get_subdomain(const std::string& service_name) const {
    for (auto& st : states_) {
        if (st.svc.name == service_name) return st.subdomain;
    }
    return "";
}

void RelayClient::engine_loop(int idx) {
    auto& st = states_[idx];

    // Resolve relay address
    struct sockaddr_in relay_addr = {};
    if (!resolve_host(cfg_.relay_host.c_str(), cfg_.relay_port, &relay_addr)) {
        LOG(ERROR, "Relay: cannot resolve %s:%d", cfg_.relay_host.c_str(), cfg_.relay_port);
        return;
    }

    // Create UDP socket
    st.udp_fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (st.udp_fd < 0) {
        LOG(ERROR, "Relay: socket() failed for %s", st.svc.name.c_str());
        return;
    }

    // Bind to ephemeral port
    struct sockaddr_in bind_addr = {};
    bind_addr.sin_family = AF_INET;
    bind_addr.sin_port = 0;
    bind_addr.sin_addr.s_addr = INADDR_ANY;
    if (bind(st.udp_fd, (struct sockaddr*)&bind_addr, sizeof(bind_addr)) < 0) {
        LOG(ERROR, "Relay: bind() failed for %s", st.svc.name.c_str());
        close_socket(st.udp_fd);
        st.udp_fd = -1;
        return;
    }

    // Set recv timeout for polling
    struct timeval tv;
    tv.tv_sec = 5;
    tv.tv_usec = 0;
    setsockopt(st.udp_fd, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));

    // NAT punch: send dummy UDP to relay_ip:registered_port to open
    // port-restricted cone NATs
    struct sockaddr_in nat_addr = relay_addr;
    nat_addr.sin_port = htons(st.svc.relay_port);
    uint8_t dummy = 0;
    sendto(st.udp_fd, (const char*)&dummy, 1, 0,
           (struct sockaddr*)&nat_addr, sizeof(nat_addr));

    // Registration loop: Register -> wait for Challenge -> Confirm
    send_register(st, relay_addr);

    auto last_heartbeat = std::chrono::steady_clock::now();
    uint8_t buf[2048];

    while (running_.load()) {
        struct sockaddr_in from = {};
        socklen_t from_len = sizeof(from);
        int n = recvfrom(st.udp_fd, (char*)buf, sizeof(buf), 0,
                         (struct sockaddr*)&from, &from_len);

        if (n > 0) {
            if (buf[0] == RELAY_MAGIC && n >= 4) {
                // Relay protocol message
                handle_relay_packet(st, buf, n, relay_addr);
            }
            // else: QUIC packet — would be forwarded to H3 proxy
        }

        // Heartbeat every 90 seconds
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - last_heartbeat).count();
        if (st.registered && elapsed >= 90) {
            send_heartbeat(st, relay_addr);
            last_heartbeat = now;
        }

        // Re-register if not yet registered
        if (!st.registered && elapsed >= 10) {
            send_register(st, relay_addr);
        }
    }
}

void RelayClient::handle_relay_packet(ServiceState& st, const uint8_t* data, int len,
                                       const struct sockaddr_in& relay_addr) {
    if (len < 4) return;
    uint8_t type = data[1];

    switch (type) {
        case RELAY_MSG_CHALLENGE: {
            if (len >= 20) {
                // cookie is at offset 4, 16 bytes
                memcpy(st.cookie, data + 4, 16);
                LOG(DEBUG, "Relay: [%s] received challenge", st.svc.name.c_str());
                send_confirm(st, relay_addr);
            }
            break;
        }
        case RELAY_MSG_NEIGHBORS: {
            st.registered = true;
            // Parse subdomain from payload
            if (len > 20) {
                parse_neighbors(st, data + 20, len - 20);
            }
            break;
        }
        default:
            LOG(TRACE, "Relay: [%s] unknown msg type 0x%02x", st.svc.name.c_str(), type);
            break;
    }
}

void RelayClient::parse_neighbors(ServiceState& st, const uint8_t* payload, int len) {
    std::string sub = extract_subdomain(payload, len, st.svc.relay_port);
    if (!sub.empty() && sub != st.subdomain) {
        st.subdomain = sub;
        std::string fqdn = sub + ".stare.network";
        LOG(INFO, "Relay: [%s] assigned subdomain: %s", st.svc.name.c_str(), fqdn.c_str());
        if (cfg_.on_subdomain) {
            cfg_.on_subdomain(st.svc.name, fqdn);
        }
    }
}

void RelayClient::send_relay_msg(int fd, const struct sockaddr_in& addr,
                                  uint8_t type, uint16_t port,
                                  const uint8_t* cookie, const uint8_t* payload,
                                  int payload_len) {
    // Wire: [magic:1][type:1][port:2][cookie:16][payload:N]
    uint8_t buf[2048];
    buf[0] = RELAY_MAGIC;
    buf[1] = type;
    buf[2] = (port >> 8) & 0xFF;
    buf[3] = port & 0xFF;
    if (cookie) {
        memcpy(buf + 4, cookie, 16);
    } else {
        memset(buf + 4, 0, 16);
    }
    int total = 20;
    if (payload && payload_len > 0) {
        int copy = std::min(payload_len, (int)sizeof(buf) - 20);
        memcpy(buf + 20, payload, copy);
        total += copy;
    }
    sendto(fd, (const char*)buf, total, 0, (const struct sockaddr*)&addr, sizeof(addr));
}

void RelayClient::send_register(ServiceState& st, const struct sockaddr_in& relay_addr) {
    LOG(DEBUG, "Relay: [%s] sending Register(port=%d)", st.svc.name.c_str(), st.svc.relay_port);
    send_relay_msg(st.udp_fd, relay_addr, RELAY_MSG_REGISTER, st.svc.relay_port, nullptr, nullptr, 0);
}

void RelayClient::send_confirm(ServiceState& st, const struct sockaddr_in& relay_addr) {
    LOG(DEBUG, "Relay: [%s] sending Confirm", st.svc.name.c_str());
    send_relay_msg(st.udp_fd, relay_addr, RELAY_MSG_CONFIRM, st.svc.relay_port, st.cookie, nullptr, 0);
    st.registered = true;
    LOG(INFO, "Relay: [%s] registered (Confirm sent, port=%d)",
        st.svc.name.c_str(), st.svc.relay_port);
    if (cfg_.on_registered) {
        cfg_.on_registered(st.svc.name, st.svc.relay_port);
    }
}

void RelayClient::send_heartbeat(ServiceState& st, const struct sockaddr_in& relay_addr) {
    LOG(TRACE, "Relay: [%s] heartbeat", st.svc.name.c_str());
    send_relay_msg(st.udp_fd, relay_addr, RELAY_MSG_HEARTBEAT, st.svc.relay_port, st.cookie, nullptr, 0);
}
