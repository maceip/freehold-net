#ifndef H3_PROXY_H__
#define H3_PROXY_H__

#include <string>
#include <vector>
#include <map>
#include <thread>
#include <atomic>
#include <mutex>
#include <cstdint>
#include <functional>

// QUIC/H3 reverse proxy using ngtcp2 + nghttp3 + WolfSSL.
//
// Accepts incoming QUIC connections (forwarded from the Freehold relay)
// and proxies HTTP/3 requests to local backend services.
//
// The relay demuxes traffic by port; each backend service has its own
// H3Proxy instance listening on the relay-assigned UDP socket.

struct H3Backend {
    std::string name;
    std::string local_host;
    int local_port;
};

class H3Proxy {
public:
    struct Config {
        std::string bind_host = "0.0.0.0";
        int bind_port = 0;  // 0 = OS-assigned
        std::string cert_path;
        std::string key_path;
        std::vector<H3Backend> backends;
    };

    explicit H3Proxy(const Config& cfg);
    ~H3Proxy();

    void start();
    void stop();

    // Feed a raw QUIC packet received from the relay's demux socket.
    // Called by RelayClient when a non-0x46 packet arrives.
    void feed_packet(const uint8_t* data, int len,
                     const struct sockaddr_in& remote);

    int bound_port() const { return actual_port_; }

private:
    Config cfg_;
    std::atomic<bool> running_{false};
    std::thread event_thread_;
    int udp_fd_ = -1;
    int actual_port_ = 0;

    // ngtcp2 connection state (opaque pointers to avoid header pollution)
    struct ConnectionState;
    std::mutex conns_mu_;
    std::map<uint64_t, ConnectionState*> connections_;

    // WolfSSL context
    void* ssl_ctx_ = nullptr;

    void event_loop();
    void handle_quic_packet(const uint8_t* data, int len,
                             const struct sockaddr_in& remote);
    ConnectionState* get_or_create_conn(const uint8_t* dcid, int dcid_len,
                                         const struct sockaddr_in& remote);
    void proxy_h3_request(ConnectionState* conn, const std::string& path,
                           const std::string& method,
                           const uint8_t* body, int body_len);
    void forward_to_backend(const H3Backend& backend,
                             const std::string& method,
                             const std::string& path,
                             const uint8_t* body, int body_len,
                             std::vector<uint8_t>& response);

    bool init_ssl_ctx();
    void cleanup_connections();
};

#endif // H3_PROXY_H__
