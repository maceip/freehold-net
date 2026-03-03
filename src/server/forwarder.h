#ifndef FORWARDER_H__
#define FORWARDER_H__

#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <functional>

// SMTP forwarder: verifies MPC proof (HMAC-SHA256) then proxies ciphertext
// to smtp.gmail.com:587. Replaces forwarder.py.

class SMTPForwarder {
public:
    struct Config {
        std::string listen_host = "127.0.0.1";
        int listen_port = 5870;
        std::string smtp_host = "smtp.gmail.com";
        int smtp_port = 587;
        std::string circuit_path;
        std::string cluster_key_path = "cluster_verify.key";
        bool allow_insecure = false;
    };

    explicit SMTPForwarder(const Config& cfg);
    ~SMTPForwarder();

    // Start listening in a background thread. Non-blocking.
    void start();
    // Signal stop and join.
    void stop();

private:
    Config cfg_;
    std::string expected_circuit_hash_;
    std::vector<uint8_t> cluster_key_;
    std::atomic<bool> running_{false};
    std::thread listen_thread_;
    int listen_fd_ = -1;

    void load_circuit_hash();
    void load_cluster_key();
    void accept_loop();
    void handle_client(int client_fd);
    bool verify_proof(const uint8_t* ciphertext, int ct_len,
                      const std::string& circuit_hash,
                      const std::string& signature_hex,
                      const std::vector<std::string>& commitments);
    void forward_to_smtp(int client_fd, const uint8_t* ciphertext, int ct_len);
};

#endif // FORWARDER_H__
