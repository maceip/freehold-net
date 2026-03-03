#ifndef DISCOVERY_H__
#define DISCOVERY_H__

#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <thread>
#include <atomic>
#include <ctime>

// Embedded HTTP discovery server. Replaces discovery.py.
// - POST /announce: MPC nodes register themselves
// - GET /nodes: return all known nodes
// - GET /resolve?party=N: lookup a specific party's hostname/port
// - GET /health: cluster health status
// - WebSocket /ws: live topology streaming

struct NodeInfo {
    int party_id;
    int port;
    std::string hostname;
    std::string status;
    double last_seen;
    double joined_at;
    bool relay_registered = false;
    std::string relay_fqdn;
};

class DiscoveryServer {
public:
    struct Config {
        std::string listen_host = "0.0.0.0";
        int listen_port = 5880;
        int node_ttl = 30;        // seconds before stale
        int prune_interval = 10;  // seconds between prune sweeps
    };

    explicit DiscoveryServer(const Config& cfg);
    ~DiscoveryServer();

    void start();
    void stop();

    // Register a node programmatically (used by in-process announcement)
    void register_node(int party_id, int port, const std::string& hostname,
                       const std::string& status = "online");

    // Update relay registration status for a node
    void update_relay_status(int party_id, int port, bool registered,
                             const std::string& fqdn);

    // Resolve a party's hostname/port. Returns false if not found.
    bool resolve_party(int party_id, std::string& hostname, int& port);

    // Build topology JSON string
    std::string topology_json();

private:
    Config cfg_;
    std::atomic<bool> running_{false};
    std::thread listen_thread_;
    std::thread prune_thread_;
    int listen_fd_ = -1;

    std::mutex nodes_mu_;
    std::map<std::string, NodeInfo> nodes_; // key = "party_id:port"

    // WebSocket clients tracked for broadcast
    std::mutex ws_mu_;
    std::vector<int> ws_clients_;

    static std::string node_key(int party_id, int port);
    void accept_loop();
    void prune_loop();
    void handle_connection(int fd);
    void handle_announce(int fd, const std::string& body);
    void handle_nodes(int fd);
    void handle_resolve(int fd, const std::string& query);
    void handle_health(int fd);
    void handle_ws_upgrade(int fd, const std::string& ws_key);
    void prune_stale();
    void broadcast_topology();
    void send_http(int fd, int status, const std::string& body);
    void send_ws_text(int fd, const std::string& text);

    static double now_secs();
};

#endif // DISCOVERY_H__
