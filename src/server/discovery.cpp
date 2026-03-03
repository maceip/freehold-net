#include "discovery.h"
#include "logging.h"

#include <cstring>
#include <sstream>
#include <algorithm>
#include <chrono>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
typedef int socklen_t;
static void close_socket(int fd) { closesocket(fd); }
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
static void close_socket(int fd) { close(fd); }
#endif

#include <openssl/sha.h>
#include <openssl/bio.h>
#include <openssl/evp.h>
#include <openssl/buffer.h>

// ── Helpers ──────────────────────────────────────────────────────────────────

static std::string base64_encode(const unsigned char* data, size_t len) {
    BIO* bio = BIO_new(BIO_s_mem());
    BIO* b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    bio = BIO_push(b64, bio);
    BIO_write(bio, data, (int)len);
    BIO_flush(bio);
    BUF_MEM* bptr;
    BIO_get_mem_ptr(bio, &bptr);
    std::string result(bptr->data, bptr->length);
    BIO_free_all(bio);
    return result;
}

// WebSocket accept key: SHA1(client_key + magic) -> base64
static const char* WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB9DC85B11B";

static std::string ws_accept_key(const std::string& client_key) {
    std::string concat = client_key + WS_MAGIC;
    unsigned char sha1[SHA_DIGEST_LENGTH];
    SHA1((const unsigned char*)concat.c_str(), concat.size(), sha1);
    return base64_encode(sha1, SHA_DIGEST_LENGTH);
}

// Minimal JSON value extraction
static std::string json_get_string(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    auto pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos = json.find(':', pos + search.size());
    if (pos == std::string::npos) return "";
    // Skip whitespace
    pos++;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (pos < json.size() && json[pos] == '"') {
        auto end = json.find('"', pos + 1);
        if (end == std::string::npos) return "";
        return json.substr(pos + 1, end - pos - 1);
    }
    // Numeric value
    auto end = json.find_first_of(",} \t\r\n", pos);
    if (end == std::string::npos) end = json.size();
    return json.substr(pos, end - pos);
}

static int json_get_int(const std::string& json, const std::string& key) {
    std::string val = json_get_string(json, key);
    if (val.empty()) return 0;
    try { return std::stoi(val); } catch (...) { return 0; }
}

// ── DiscoveryServer ──────────────────────────────────────────────────────────

DiscoveryServer::DiscoveryServer(const Config& cfg) : cfg_(cfg) {}

DiscoveryServer::~DiscoveryServer() { stop(); }

double DiscoveryServer::now_secs() {
    return std::chrono::duration<double>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

std::string DiscoveryServer::node_key(int party_id, int port) {
    return std::to_string(party_id) + ":" + std::to_string(port);
}

void DiscoveryServer::register_node(int party_id, int port,
                                     const std::string& hostname,
                                     const std::string& status) {
    bool is_new = false;
    {
        std::lock_guard<std::mutex> lock(nodes_mu_);
        std::string key = node_key(party_id, port);
        double now = now_secs();
        auto it = nodes_.find(key);
        if (it != nodes_.end()) {
            it->second.hostname = hostname;
            it->second.status = status;
            it->second.last_seen = now;
        } else {
            nodes_[key] = {party_id, port, hostname, status, now, now, false, ""};
            LOG(INFO, "Discovery: node joined party=%d port=%d host=%s",
                party_id, port, hostname.c_str());
            is_new = true;
        }
    }
    if (is_new) broadcast_topology();
}

void DiscoveryServer::update_relay_status(int party_id, int port,
                                           bool registered,
                                           const std::string& fqdn) {
    {
        std::lock_guard<std::mutex> lock(nodes_mu_);
        std::string key = node_key(party_id, port);
        auto it = nodes_.find(key);
        if (it != nodes_.end()) {
            it->second.relay_registered = registered;
            if (!fqdn.empty()) it->second.relay_fqdn = fqdn;
            LOG(INFO, "Discovery: relay status updated party=%d port=%d registered=%d fqdn=%s",
                party_id, port, registered, fqdn.c_str());
        } else {
            LOG(WARN, "Discovery: update_relay_status for unknown node party=%d port=%d",
                party_id, port);
        }
    }
    broadcast_topology();
}

bool DiscoveryServer::resolve_party(int party_id, std::string& hostname, int& port) {
    std::lock_guard<std::mutex> lock(nodes_mu_);
    for (auto& [k, n] : nodes_) {
        if (n.party_id == party_id && n.status == "online") {
            hostname = n.hostname;
            port = n.port;
            return true;
        }
    }
    return false;
}

std::string DiscoveryServer::topology_json() {
    std::lock_guard<std::mutex> lock(nodes_mu_);
    double now = now_secs();
    std::ostringstream os;
    os << "{\"type\":\"topology\",\"nodes\":[";
    bool first = true;
    for (auto& [k, n] : nodes_) {
        if (!first) os << ",";
        first = false;
        os << "{\"party_id\":" << n.party_id
           << ",\"port\":" << n.port
           << ",\"hostname\":\"" << n.hostname << "\""
           << ",\"status\":\"" << n.status << "\""
           << ",\"uptime\":" << (now - n.joined_at)
           << ",\"relay_registered\":" << (n.relay_registered ? "true" : "false")
           << ",\"relay_fqdn\":\"" << n.relay_fqdn << "\""
           << "}";
    }
    os << "],\"quorum_size\":" << nodes_.size()
       << ",\"threshold\":3"
       << ",\"epoch\":" << (long long)std::time(nullptr) << "}";
    return os.str();
}

void DiscoveryServer::start() {
    if (running_.load()) return;
    running_ = true;
    listen_thread_ = std::thread(&DiscoveryServer::accept_loop, this);
    prune_thread_ = std::thread(&DiscoveryServer::prune_loop, this);
    LOG(INFO, "Discovery server listening on %s:%d", cfg_.listen_host.c_str(), cfg_.listen_port);
}

void DiscoveryServer::stop() {
    if (!running_.load()) return;
    running_ = false;
    if (listen_fd_ >= 0) {
        close_socket(listen_fd_);
        listen_fd_ = -1;
    }
    // Close all WS clients
    {
        std::lock_guard<std::mutex> lock(ws_mu_);
        for (int fd : ws_clients_) close_socket(fd);
        ws_clients_.clear();
    }
    if (listen_thread_.joinable()) listen_thread_.join();
    if (prune_thread_.joinable()) prune_thread_.join();
    LOG(INFO, "Discovery server stopped");
}

void DiscoveryServer::accept_loop() {
    listen_fd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd_ < 0) {
        LOG(ERROR, "Discovery: socket() failed");
        return;
    }
    int opt = 1;
    setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(cfg_.listen_port);
    inet_pton(AF_INET, cfg_.listen_host.c_str(), &addr.sin_addr);

    if (bind(listen_fd_, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        LOG(ERROR, "Discovery: bind() failed on port %d", cfg_.listen_port);
        close_socket(listen_fd_);
        listen_fd_ = -1;
        return;
    }
    listen(listen_fd_, 32);

    while (running_.load()) {
        struct sockaddr_in ca = {};
        socklen_t cl = sizeof(ca);
        int fd = accept(listen_fd_, (struct sockaddr*)&ca, &cl);
        if (fd < 0) {
            if (running_.load()) LOG(TRACE, "Discovery: accept() error");
            continue;
        }
        std::thread(&DiscoveryServer::handle_connection, this, fd).detach();
    }
}

void DiscoveryServer::prune_loop() {
    while (running_.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(cfg_.prune_interval));
        prune_stale();
    }
}

void DiscoveryServer::prune_stale() {
    bool pruned = false;
    {
        std::lock_guard<std::mutex> lock(nodes_mu_);
        double now = now_secs();
        std::vector<std::string> stale;
        for (auto& [k, n] : nodes_) {
            if (now - n.last_seen > cfg_.node_ttl) stale.push_back(k);
        }
        for (auto& k : stale) {
            LOG(INFO, "Discovery: pruning stale node %s", k.c_str());
            nodes_.erase(k);
            pruned = true;
        }
    }
    if (pruned) broadcast_topology();
}

void DiscoveryServer::handle_connection(int fd) {
    // Read HTTP request line + headers
    char buf[4096];
    int total = 0;
    int header_end = -1;

    struct timeval tv;
    tv.tv_sec = 5; tv.tv_usec = 0;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));

    while (total < (int)sizeof(buf) - 1) {
        int n = recv(fd, buf + total, (int)sizeof(buf) - 1 - total, 0);
        if (n <= 0) break;
        total += n;
        buf[total] = '\0';
        if (strstr(buf, "\r\n\r\n")) {
            header_end = (int)(strstr(buf, "\r\n\r\n") - buf);
            break;
        }
    }

    if (header_end < 0) {
        close_socket(fd);
        return;
    }

    std::string headers(buf, header_end);
    std::string request_line;
    auto nl = headers.find("\r\n");
    if (nl != std::string::npos) request_line = headers.substr(0, nl);

    // Extract Content-Length
    int content_length = 0;
    auto cl_pos = headers.find("Content-Length:");
    if (cl_pos == std::string::npos) cl_pos = headers.find("content-length:");
    if (cl_pos != std::string::npos) {
        content_length = std::atoi(headers.c_str() + cl_pos + 16);
    }

    // Body starts after \r\n\r\n
    int body_start = header_end + 4;
    int body_have = total - body_start;
    std::string body;
    if (content_length > 0) {
        body.assign(buf + body_start, std::min(body_have, content_length));
        while ((int)body.size() < content_length) {
            int n = recv(fd, buf, std::min((int)sizeof(buf), content_length - (int)body.size()), 0);
            if (n <= 0) break;
            body.append(buf, n);
        }
    }

    // Route
    if (request_line.find("POST /announce") != std::string::npos) {
        handle_announce(fd, body);
    } else if (request_line.find("GET /health") != std::string::npos) {
        handle_health(fd);
    } else if (request_line.find("GET /nodes") != std::string::npos ||
               request_line.find("GET /topology") != std::string::npos) {
        handle_nodes(fd);
    } else if (request_line.find("GET /resolve") != std::string::npos) {
        // Extract query string
        auto qpos = request_line.find('?');
        std::string query = (qpos != std::string::npos)
            ? request_line.substr(qpos + 1, request_line.find(' ', qpos) - qpos - 1)
            : "";
        handle_resolve(fd, query);
    } else if (request_line.find("GET /ws") != std::string::npos &&
               headers.find("Upgrade: websocket") != std::string::npos) {
        // Extract Sec-WebSocket-Key
        std::string ws_key;
        auto kp = headers.find("Sec-WebSocket-Key:");
        if (kp == std::string::npos) kp = headers.find("sec-websocket-key:");
        if (kp != std::string::npos) {
            auto vs = headers.find_first_not_of(" \t", kp + 18);
            auto ve = headers.find("\r\n", vs);
            ws_key = headers.substr(vs, ve - vs);
        }
        handle_ws_upgrade(fd, ws_key);
        return; // WS keeps fd open
    } else {
        send_http(fd, 404, "{\"error\":\"not found\"}");
    }

    close_socket(fd);
}

void DiscoveryServer::handle_announce(int fd, const std::string& body) {
    int party_id = json_get_int(body, "party_id");
    int port = json_get_int(body, "port");
    std::string hostname = json_get_string(body, "hostname");
    std::string status = json_get_string(body, "status");

    if (party_id == 0 || port == 0) {
        send_http(fd, 400, "{\"error\":\"party_id and port required\"}");
        return;
    }
    if (hostname.empty()) hostname = "127.0.0.1";
    if (status.empty()) status = "online";

    register_node(party_id, port, hostname, status);
    send_http(fd, 200, "{\"status\":\"registered\"}");
    broadcast_topology();
}

void DiscoveryServer::handle_nodes(int fd) {
    send_http(fd, 200, topology_json());
}

void DiscoveryServer::handle_resolve(int fd, const std::string& query) {
    // Parse party=N from query string
    int party_id = 0;
    auto pp = query.find("party=");
    if (pp != std::string::npos) {
        party_id = std::atoi(query.c_str() + pp + 6);
    }

    std::string hostname;
    int port = 0;
    if (resolve_party(party_id, hostname, port)) {
        std::ostringstream os;
        os << "{\"party_id\":" << party_id
           << ",\"hostname\":\"" << hostname << "\""
           << ",\"port\":" << port << "}";
        send_http(fd, 200, os.str());
    } else {
        send_http(fd, 404, "{\"error\":\"party not found\"}");
    }
}

void DiscoveryServer::handle_health(int fd) {
    std::lock_guard<std::mutex> lock(nodes_mu_);
    std::ostringstream os;
    os << "{\"status\":\"ok\",\"nodes\":" << nodes_.size() << "}";
    send_http(fd, 200, os.str());
}

void DiscoveryServer::handle_ws_upgrade(int fd, const std::string& ws_key) {
    std::string accept = ws_accept_key(ws_key);
    std::ostringstream resp;
    resp << "HTTP/1.1 101 Switching Protocols\r\n"
         << "Upgrade: websocket\r\n"
         << "Connection: Upgrade\r\n"
         << "Sec-WebSocket-Accept: " << accept << "\r\n"
         << "Access-Control-Allow-Origin: *\r\n"
         << "\r\n";
    std::string r = resp.str();
    send(fd, r.c_str(), (int)r.size(), 0);

    {
        std::lock_guard<std::mutex> lock(ws_mu_);
        ws_clients_.push_back(fd);
    }
    LOG(INFO, "Discovery: WebSocket client connected");

    // Send current topology
    send_ws_text(fd, topology_json());

    // Keep alive — read frames until close
    while (running_.load()) {
        uint8_t head[2];
        int n = recv(fd, (char*)head, 2, 0);
        if (n <= 0) break;
        int opcode = head[0] & 0x0F;
        if (opcode == 0x8) break; // close frame
        bool masked = (head[1] & 0x80) != 0;
        uint64_t length = head[1] & 0x7F;
        if (length == 126) {
            uint8_t ext[2];
            if (recv(fd, (char*)ext, 2, 0) != 2) break;
            length = (ext[0] << 8) | ext[1];
        } else if (length == 127) {
            uint8_t ext[8];
            if (recv(fd, (char*)ext, 8, 0) != 8) break;
            length = 0;
            for (int i = 0; i < 8; i++) length = (length << 8) | ext[i];
        }
        uint8_t mask[4] = {};
        if (masked && recv(fd, (char*)mask, 4, 0) != 4) break;
        // Consume payload
        std::vector<uint8_t> payload(length);
        size_t read = 0;
        while (read < length) {
            int r2 = recv(fd, (char*)payload.data() + read, (int)(length - read), 0);
            if (r2 <= 0) break;
            read += r2;
        }
        // We don't process client messages, just keep alive
    }

    {
        std::lock_guard<std::mutex> lock(ws_mu_);
        ws_clients_.erase(std::remove(ws_clients_.begin(), ws_clients_.end(), fd),
                          ws_clients_.end());
    }
    LOG(INFO, "Discovery: WebSocket client disconnected");
    close_socket(fd);
}

void DiscoveryServer::broadcast_topology() {
    std::string json = topology_json();
    std::lock_guard<std::mutex> lock(ws_mu_);
    std::vector<int> dead;
    for (int fd : ws_clients_) {
        send_ws_text(fd, json);
    }
}

void DiscoveryServer::send_http(int fd, int status, const std::string& body) {
    const char* status_text = "OK";
    if (status == 400) status_text = "Bad Request";
    else if (status == 404) status_text = "Not Found";

    std::ostringstream resp;
    resp << "HTTP/1.1 " << status << " " << status_text << "\r\n"
         << "Content-Type: application/json\r\n"
         << "Access-Control-Allow-Origin: *\r\n"
         << "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
         << "Access-Control-Allow-Headers: Content-Type\r\n"
         << "Content-Length: " << body.size() << "\r\n"
         << "Connection: close\r\n"
         << "\r\n"
         << body;
    std::string r = resp.str();
    send(fd, r.c_str(), (int)r.size(), 0);
}

void DiscoveryServer::send_ws_text(int fd, const std::string& text) {
    size_t len = text.size();
    std::vector<uint8_t> frame;
    frame.push_back(0x81); // FIN + text opcode
    if (len < 126) {
        frame.push_back((uint8_t)len);
    } else if (len < 65536) {
        frame.push_back(126);
        frame.push_back((uint8_t)(len >> 8));
        frame.push_back((uint8_t)(len & 0xFF));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; i--)
            frame.push_back((uint8_t)(len >> (i * 8)));
    }
    frame.insert(frame.end(), text.begin(), text.end());
    send(fd, (const char*)frame.data(), (int)frame.size(), 0);
}
