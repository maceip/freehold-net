#ifndef RELAY_CLIENT_H__
#define RELAY_CLIENT_H__

#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <functional>
#include <cstdint>

// Freehold relay registration protocol (replaces freehold-bridge Rust binary).
//
// Custom binary UDP protocol on relay:
//   Magic byte: 0x46
//   Messages: Register(0x01), Challenge(0x02), Confirm(0x03),
//             Heartbeat(0x04), Neighbors(0x05)
//   Wire: [magic][type][port:u16][cookie:16bytes][payload]
//
// Registration flow:
//   1. Send Register(port) -> relay
//   2. Receive Challenge(cookie) <- relay
//   3. Send Confirm(cookie) -> relay
//   4. Heartbeat every 90s (TTL 270s)
//   5. Neighbors message provides assigned subdomain
//
// The DemuxSocket reads from one UDP socket: packets starting with 0x46
// go to the relay engine; everything else is QUIC traffic.

static constexpr uint8_t RELAY_MAGIC = 0x46;

enum RelayMsgType : uint8_t {
    RELAY_MSG_REGISTER  = 0x01,
    RELAY_MSG_CHALLENGE = 0x02,
    RELAY_MSG_CONFIRM   = 0x03,
    RELAY_MSG_HEARTBEAT = 0x04,
    RELAY_MSG_NEIGHBORS = 0x05,
};

// Callback when a subdomain is assigned by the relay
using SubdomainCallback = std::function<void(const std::string& service_name,
                                              const std::string& subdomain)>;

// Callback when registration is confirmed (Confirm sent to relay)
using RegisteredCallback = std::function<void(const std::string& service_name,
                                               uint16_t port)>;

struct RelayService {
    std::string name;       // "mpc-node", "discovery", "forwarder"
    uint16_t relay_port;    // port registered with relay
    uint16_t local_port;    // local backend port
};

class RelayClient {
public:
    struct Config {
        std::string relay_host = "relay.stare.network";
        int relay_port = 9999;
        std::vector<RelayService> services;
        SubdomainCallback on_subdomain;
        RegisteredCallback on_registered;
    };

    explicit RelayClient(const Config& cfg);
    ~RelayClient();

    void start();
    void stop();

    // Get assigned subdomain for a service (empty if not yet assigned)
    std::string get_subdomain(const std::string& service_name) const;

private:
    Config cfg_;
    std::atomic<bool> running_{false};

    // Per-service state
    struct ServiceState {
        RelayService svc;
        int udp_fd = -1;
        uint8_t cookie[16] = {};
        bool registered = false;
        std::string subdomain;
        std::thread engine_thread;
    };

    std::vector<ServiceState> states_;

    void engine_loop(int idx);
    void send_register(ServiceState& st, const struct sockaddr_in& relay_addr);
    void send_confirm(ServiceState& st, const struct sockaddr_in& relay_addr);
    void send_heartbeat(ServiceState& st, const struct sockaddr_in& relay_addr);
    void handle_relay_packet(ServiceState& st, const uint8_t* data, int len,
                              const struct sockaddr_in& relay_addr);
    void parse_neighbors(ServiceState& st, const uint8_t* payload, int len);

    static void send_relay_msg(int fd, const struct sockaddr_in& addr,
                                uint8_t type, uint16_t port,
                                const uint8_t* cookie, const uint8_t* payload,
                                int payload_len);
};

#endif // RELAY_CLIENT_H__
