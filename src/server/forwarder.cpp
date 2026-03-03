#include "forwarder.h"
#include "logging.h"

#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <openssl/sha.h>

#include <cstring>
#include <fstream>
#include <sstream>
#include <algorithm>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32")
typedef int socklen_t;
static void close_socket(int fd) { closesocket(fd); }
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
static void close_socket(int fd) { close(fd); }
#endif

// ── Helpers ──────────────────────────────────────────────────────────────────

static std::string sha256_hex(const uint8_t* data, size_t len) {
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(data, len, hash);
    char hex[SHA256_DIGEST_LENGTH * 2 + 1];
    for (int i = 0; i < SHA256_DIGEST_LENGTH; i++)
        snprintf(hex + i * 2, 3, "%02x", hash[i]);
    return std::string(hex, SHA256_DIGEST_LENGTH * 2);
}

static std::string hmac_sha256_hex(const uint8_t* key, size_t key_len,
                                    const uint8_t* data, size_t data_len) {
    unsigned char mac[EVP_MAX_MD_SIZE];
    unsigned int mac_len = 0;
    HMAC(EVP_sha256(), key, (int)key_len, data, data_len, mac, &mac_len);
    char hex[EVP_MAX_MD_SIZE * 2 + 1];
    for (unsigned int i = 0; i < mac_len; i++)
        snprintf(hex + i * 2, 3, "%02x", mac[i]);
    return std::string(hex, mac_len * 2);
}

static std::vector<uint8_t> hex_to_bytes(const std::string& hex) {
    std::vector<uint8_t> bytes;
    bytes.reserve(hex.size() / 2);
    for (size_t i = 0; i + 1 < hex.size(); i += 2) {
        char* end = nullptr;
        unsigned long val = strtoul(hex.substr(i, 2).c_str(), &end, 16);
        bytes.push_back((uint8_t)val);
    }
    return bytes;
}

// Minimal JSON value extraction (no external JSON lib)
static std::string json_get_string(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    auto pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos = json.find(':', pos + search.size());
    if (pos == std::string::npos) return "";
    pos = json.find('"', pos + 1);
    if (pos == std::string::npos) return "";
    auto end = json.find('"', pos + 1);
    if (end == std::string::npos) return "";
    return json.substr(pos + 1, end - pos - 1);
}

static std::vector<std::string> json_get_string_array(const std::string& json, const std::string& key) {
    std::vector<std::string> result;
    std::string search = "\"" + key + "\"";
    auto pos = json.find(search);
    if (pos == std::string::npos) return result;
    auto bracket = json.find('[', pos);
    if (bracket == std::string::npos) return result;
    auto end_bracket = json.find(']', bracket);
    if (end_bracket == std::string::npos) return result;
    std::string arr = json.substr(bracket + 1, end_bracket - bracket - 1);
    size_t p = 0;
    while ((p = arr.find('"', p)) != std::string::npos) {
        auto e = arr.find('"', p + 1);
        if (e == std::string::npos) break;
        result.push_back(arr.substr(p + 1, e - p - 1));
        p = e + 1;
    }
    return result;
}

// ── SMTPForwarder ────────────────────────────────────────────────────────────

SMTPForwarder::SMTPForwarder(const Config& cfg) : cfg_(cfg) {
    load_circuit_hash();
    load_cluster_key();
}

SMTPForwarder::~SMTPForwarder() {
    stop();
}

void SMTPForwarder::load_circuit_hash() {
    if (cfg_.circuit_path.empty()) {
        cfg_.circuit_path = "reference/JesseQ/JQv1/test/bool/AES-non-expanded.txt";
    }
    std::ifstream f(cfg_.circuit_path, std::ios::binary);
    if (!f.is_open()) {
        LOG(ERROR, "Circuit file missing: %s", cfg_.circuit_path.c_str());
        throw std::runtime_error("Circuit file missing: " + cfg_.circuit_path);
    }
    std::vector<uint8_t> contents((std::istreambuf_iterator<char>(f)),
                                   std::istreambuf_iterator<char>());
    expected_circuit_hash_ = sha256_hex(contents.data(), contents.size());
    LOG(INFO, "Forwarder verifier initialized, circuit hash: %s", expected_circuit_hash_.c_str());
}

void SMTPForwarder::load_cluster_key() {
    std::ifstream f(cfg_.cluster_key_path, std::ios::binary);
    if (!f.is_open()) {
        if (!cfg_.allow_insecure) {
            throw std::runtime_error("HMAC key file missing: " + cfg_.cluster_key_path);
        }
        LOG(WARN, "HMAC key file missing, proof verification will fail");
        return;
    }
    cluster_key_ = std::vector<uint8_t>((std::istreambuf_iterator<char>(f)),
                                         std::istreambuf_iterator<char>());
}

bool SMTPForwarder::verify_proof(const uint8_t* ciphertext, int ct_len,
                                  const std::string& circuit_hash,
                                  const std::string& signature_hex,
                                  const std::vector<std::string>& commitments) {
    if (circuit_hash != expected_circuit_hash_) {
        LOG(ERROR, "Circuit hash mismatch");
        return false;
    }
    if (signature_hex.empty() || commitments.empty()) {
        LOG(ERROR, "Missing signature or commitments");
        return false;
    }

    // HMAC signature: HMAC(key, ciphertext || circuit_hash)
    std::vector<uint8_t> msg(ciphertext, ciphertext + ct_len);
    msg.insert(msg.end(), circuit_hash.begin(), circuit_hash.end());

    std::string expected_mac = hmac_sha256_hex(cluster_key_.data(), cluster_key_.size(),
                                                msg.data(), msg.size());
    if (signature_hex != expected_mac) {
        LOG(ERROR, "HMAC signature verification failed");
        return false;
    }

    // Verify chunk commitments
    int chunk_size = ct_len / std::max((int)commitments.size(), 1);
    for (size_t i = 0; i < commitments.size(); i++) {
        int offset = (int)i * chunk_size;
        int len = std::min(chunk_size, ct_len - offset);
        std::string expected = hmac_sha256_hex(cluster_key_.data(), cluster_key_.size(),
                                               ciphertext + offset, len);
        if (commitments[i] != expected) {
            LOG(ERROR, "Commitment %zu verification failed", i);
            return false;
        }
    }

    LOG(INFO, "Proof verified successfully");
    return true;
}

void SMTPForwarder::start() {
    if (running_.load()) return;
    running_ = true;
    listen_thread_ = std::thread(&SMTPForwarder::accept_loop, this);
    LOG(INFO, "SMTP forwarder listening on %s:%d", cfg_.listen_host.c_str(), cfg_.listen_port);
}

void SMTPForwarder::stop() {
    if (!running_.load()) return;
    running_ = false;
    if (listen_fd_ >= 0) {
        close_socket(listen_fd_);
        listen_fd_ = -1;
    }
    if (listen_thread_.joinable()) listen_thread_.join();
    LOG(INFO, "SMTP forwarder stopped");
}

void SMTPForwarder::accept_loop() {
    listen_fd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd_ < 0) {
        LOG(ERROR, "Forwarder: socket() failed");
        return;
    }

    int opt = 1;
    setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(cfg_.listen_port);
    inet_pton(AF_INET, cfg_.listen_host.c_str(), &addr.sin_addr);

    if (bind(listen_fd_, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        LOG(ERROR, "Forwarder: bind() failed on port %d", cfg_.listen_port);
        close_socket(listen_fd_);
        listen_fd_ = -1;
        return;
    }

    listen(listen_fd_, 16);

    while (running_.load()) {
        struct sockaddr_in client_addr = {};
        socklen_t client_len = sizeof(client_addr);
        int client_fd = accept(listen_fd_, (struct sockaddr*)&client_addr, &client_len);
        if (client_fd < 0) {
            if (running_.load()) LOG(DEBUG, "Forwarder: accept() returned %d", client_fd);
            continue;
        }
        // Handle in a detached thread (matching Python's per-connection model)
        std::thread(&SMTPForwarder::handle_client, this, client_fd).detach();
    }
}

void SMTPForwarder::handle_client(int client_fd) {
    LOG(DEBUG, "Forwarder: new client connection");

    // Read until double newline (proof header) then remaining is ciphertext
    std::vector<uint8_t> buf(8192);
    int total = 0;
    int header_end = -1;

    while (total < (int)buf.size() - 1) {
        int n = recv(client_fd, (char*)buf.data() + total, (int)buf.size() - total, 0);
        if (n <= 0) break;
        total += n;
        // Look for \n\n delimiter
        for (int i = 0; i < total - 1; i++) {
            if (buf[i] == '\n' && buf[i + 1] == '\n') {
                header_end = i;
                break;
            }
        }
        if (header_end >= 0) break;
    }

    if (header_end < 0) {
        LOG(ERROR, "Forwarder: no header delimiter found");
        close_socket(client_fd);
        return;
    }

    std::string header_json(buf.begin(), buf.begin() + header_end);
    int ct_offset = header_end + 2;
    int ct_len = total - ct_offset;

    // Read remaining ciphertext
    std::vector<uint8_t> ciphertext(buf.begin() + ct_offset, buf.begin() + total);
    while (ct_len < 4096) {
        int n = recv(client_fd, (char*)buf.data(), (int)buf.size(), 0);
        if (n <= 0) break;
        ciphertext.insert(ciphertext.end(), buf.begin(), buf.begin() + n);
        ct_len += n;
    }

    // Parse proof
    std::string circuit_hash = json_get_string(header_json, "circuit_hash");
    std::string signature = json_get_string(header_json, "signature");
    std::vector<std::string> commitments = json_get_string_array(header_json, "commitments");

    if (!verify_proof(ciphertext.data(), (int)ciphertext.size(),
                      circuit_hash, signature, commitments)) {
        close_socket(client_fd);
        return;
    }

    forward_to_smtp(client_fd, ciphertext.data(), (int)ciphertext.size());
    close_socket(client_fd);
}

void SMTPForwarder::forward_to_smtp(int client_fd, const uint8_t* ciphertext, int ct_len) {
    // Connect to SMTP server
    struct addrinfo hints = {}, *res = nullptr;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    char port_str[8];
    snprintf(port_str, sizeof(port_str), "%d", cfg_.smtp_port);

    if (getaddrinfo(cfg_.smtp_host.c_str(), port_str, &hints, &res) != 0 || !res) {
        LOG(ERROR, "Forwarder: cannot resolve %s", cfg_.smtp_host.c_str());
        return;
    }

    int smtp_fd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (smtp_fd < 0) {
        freeaddrinfo(res);
        LOG(ERROR, "Forwarder: socket() for SMTP failed");
        return;
    }

    if (connect(smtp_fd, res->ai_addr, (int)res->ai_addrlen) < 0) {
        freeaddrinfo(res);
        close_socket(smtp_fd);
        LOG(ERROR, "Forwarder: connect to SMTP %s:%d failed", cfg_.smtp_host.c_str(), cfg_.smtp_port);
        return;
    }
    freeaddrinfo(res);

    // Send ciphertext to SMTP
    send(smtp_fd, (const char*)ciphertext, ct_len, 0);

    // Bidirectional proxy: relay between client and SMTP
    // Use simple blocking alternation (adequate for SMTP protocol)
    fd_set fds;
    char relay_buf[4096];
    struct timeval tv;

    while (true) {
        FD_ZERO(&fds);
        FD_SET(client_fd, &fds);
        FD_SET(smtp_fd, &fds);
        int maxfd = std::max(client_fd, smtp_fd) + 1;
        tv.tv_sec = 30;
        tv.tv_usec = 0;

        int ready = select(maxfd, &fds, nullptr, nullptr, &tv);
        if (ready <= 0) break;

        if (FD_ISSET(client_fd, &fds)) {
            int n = recv(client_fd, relay_buf, sizeof(relay_buf), 0);
            if (n <= 0) break;
            send(smtp_fd, relay_buf, n, 0);
        }
        if (FD_ISSET(smtp_fd, &fds)) {
            int n = recv(smtp_fd, relay_buf, sizeof(relay_buf), 0);
            if (n <= 0) break;
            send(client_fd, relay_buf, n, 0);
        }
    }

    close_socket(smtp_fd);
    LOG(DEBUG, "Forwarder: SMTP session completed");
}
