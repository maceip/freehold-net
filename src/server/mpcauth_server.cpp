#include <emp-tool/emp-tool.h>
#include <emp-zk/emp-zk.h>
#include <iostream>
#include <vector>
#include <string>
#include <set>
#include <fstream>
#include <stdexcept>
#include <filesystem>
#include <memory>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <thread>
#include <atomic>
#include <chrono>

using namespace std;
using namespace emp;

int current_party = 1;
NetIO* cluster_ios[5] = {nullptr};

#if ENABLE_LLSS
#include "llss_mpc.h"
#endif
#include "smtp_mpc.h"

// M3 FIX: File-backed nullifier database
static const std::string NULLIFIER_DB_PATH = "nullifier_database.txt";
std::set<std::string> nullifier_database;

void load_nullifier_database() {
    if (!std::filesystem::exists(NULLIFIER_DB_PATH)) return;
    std::ifstream f(NULLIFIER_DB_PATH);
    std::string line;
    while (std::getline(f, line)) {
        if (!line.empty()) nullifier_database.insert(line);
    }
}

void save_nullifier(const std::string& nullifier) {
    std::ofstream f(NULLIFIER_DB_PATH, std::ios::app);
    f << nullifier << "\n";
    f.flush();
}

std::string compute_hash_to_hex(const bool* hash_out, int bit_len) {
    // P4 FIX: Reserve capacity upfront
    std::string hex_str;
    hex_str.reserve(bit_len / 4);
    const char hex_chars[] = "0123456789abcdef";
    for (int i = 0; i < bit_len; i += 4) {
        int val = 0;
        for (int j = 0; j < 4 && i + j < bit_len; ++j) {
            if (hash_out[i + j]) val |= (1 << j);
        }
        hex_str += hex_chars[val];
    }
    return hex_str;
}

int get_current_epoch_from_consensus() {
    const char* env_epoch = std::getenv("CLUSTER_BFT_EPOCH");
    if (!env_epoch) throw std::runtime_error("BFT epoch undefined.");
    try {
        return std::stoi(env_epoch);
    } catch (...) {
        throw std::runtime_error("Invalid BFT epoch value.");
    }
}

// DUP2 FIX: cluster_epoch passed in instead of re-reading env var.
template<typename IO>
void execute_mpc_logic(IO** ios, int threads, int party, int request_epoch,
                       int cluster_epoch, const vector<bool>& my_shard,
                       const string& circuit_file) {
    setup_zk_bool<IO>(ios, threads, party);

#if ENABLE_LLSS
    LLSSContext llss(cluster_epoch, 3, {1, 2, 3, 4, 5},
                     "reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt");

    if (request_epoch != cluster_epoch) {
        cout << "ADKR Epoch Mismatch Detected." << endl;
        emp::block dummy_shard;
        llss.apply_transition_gate(ProtocolExecution::prot_exec, &dummy_shard, &dummy_shard, 128);
    }
#else
    if (request_epoch != cluster_epoch) {
        cerr << "WARNING: Epoch mismatch but LLSS-MPC not enabled. Ignoring." << endl;
    }
#endif

    cout << "Active Cluster Session: Epoch " << cluster_epoch << endl;

    // Load password shard
    vector<bool> pass_shard;
    string pass_shard_path = "shard_" + to_string(current_party) + "_pass.bin";
    if (std::filesystem::exists(pass_shard_path)) {
        ifstream pf(pass_shard_path, std::ios::binary);
        char byte;
        while (pf.get(byte)) for (int b = 7; b >= 0; --b) pass_shard.push_back((byte >> b) & 1);
    } else {
        throw std::runtime_error("CRITICAL: Password shard file missing for node " + to_string(current_party));
    }

    // Initialize TLS session keys from the identity shard
    {
        int shard_bytes_len = (int)my_shard.size() / 8;
        std::vector<uint8_t> shard_bytes(shard_bytes_len);
        for (int i = 0; i < shard_bytes_len; i++) {
            uint8_t val = 0;
            for (int b = 0; b < 8; b++) {
                if (my_shard[i * 8 + b]) val |= (1 << b);
            }
            shard_bytes[i] = val;
        }
        init_tls_session_from_shard(shard_bytes.data(), shard_bytes_len);
    }

    // D2 FIX: Output goes to byte buffer, not unused block array
    uint8_t auth_ciphertext[4096];
    int ct_len = Joint_SMTP_Authenticate<IO>(ProtocolExecution::prot_exec,
                                              auth_ciphertext, sizeof(auth_ciphertext),
                                              pass_shard, circuit_file);
    // TODO: Send auth_ciphertext[0..ct_len] to SMTP forwarder
    (void)ct_len;

    // Identity Commitment (SHA-256 Nullifier)
    cout << "[Cluster] Computing ZK Identity Commitment..." << endl;
    constexpr int sha_in_len = 512;
    constexpr int sha_out_len = 256;

    std::unique_ptr<block[]> in_bits(new block[sha_in_len]);
    std::unique_ptr<block[]> out_bits(new block[sha_out_len]);

    std::unique_ptr<bool[]> raw_in(new bool[sha_in_len]());
    if (current_party == ALICE) {
        for (int i = 0; i < sha_in_len; i++) raw_in[i] = (i < (int)my_shard.size()) ? my_shard[i] : false;
    }
    ProtocolExecution::prot_exec->feed(in_bits.get(), ALICE, raw_in.get(), sha_in_len);

    // Use BristolFashion (2-arg compute) — matches JesseQ's sha256.txt format
    BristolFashion cf_sha("reference/JesseQ/batchman/JQv1/sha256.txt");
    cf_sha.compute(out_bits.get(), in_bits.get());

    std::unique_ptr<bool[]> hash_result(new bool[sha_out_len]);
    ProtocolExecution::prot_exec->reveal(hash_result.get(), PUBLIC, out_bits.get(), sha_out_len);

    std::string nullifier = compute_hash_to_hex(hash_result.get(), sha_out_len);
    if (nullifier_database.count(nullifier)) {
        cerr << "REJECTED: Identity already signed." << endl;
    } else {
        nullifier_database.insert(nullifier);
        save_nullifier(nullifier);
        cout << "SUCCESS: Identity Verified." << endl;
    }

    bool cheated = finalize_zk_bool<IO>();
    if (cheated) {
        cerr << "CRITICAL: Cheating detected by verifier!" << endl;
        throw std::runtime_error("ZK proof verification failed: cheating detected.");
    }
}

// ── Node Discovery Announcement ─────────────────────────────────────────────
// POST to the discovery server so the web UI shows this node in the live topology.
// Uses raw POSIX sockets — no external dependencies.

static std::atomic<bool> heartbeat_running{false};

bool announce_to_discovery(int party_id, int node_port, const char* status = "online",
                           const char* hostname = "127.0.0.1") {
    const char* disc_host = std::getenv("DISCOVERY_HOST");
    const char* disc_port_s = std::getenv("DISCOVERY_PORT");
    const char* host = disc_host ? disc_host : "127.0.0.1";
    int disc_port = disc_port_s ? std::atoi(disc_port_s) : 5880;

    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) return false;

    // Set connect timeout
    struct timeval tv;
    tv.tv_sec = 2; tv.tv_usec = 0;
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    struct sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(disc_port);
    inet_pton(AF_INET, host, &addr.sin_addr);

    if (connect(sock, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        close(sock);
        return false;
    }

    // Build JSON body — include public hostname from Freehold
    char body[512];
    snprintf(body, sizeof(body),
        R"({"party_id":%d,"port":%d,"hostname":"%s","status":"%s"})",
        party_id, node_port, hostname, status);
    int body_len = strlen(body);

    // Build HTTP request
    char request[1024];
    int req_len = snprintf(request, sizeof(request),
        "POST /announce HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n"
        "\r\n"
        "%s",
        host, disc_port, body_len, body);
    if (req_len < 0 || req_len >= (int)sizeof(request)) {
        close(sock);
        return false;
    }

    send(sock, request, strlen(request), 0);

    // Read response (don't need it, just drain)
    char resp[256];
    recv(sock, resp, sizeof(resp), 0);
    close(sock);
    return true;
}

void heartbeat_loop(int party_id, int node_port, const char* hostname) {
    heartbeat_running = true;
    while (heartbeat_running) {
        announce_to_discovery(party_id, node_port, "online", hostname);
        std::this_thread::sleep_for(std::chrono::seconds(15));
    }
    // Send offline on exit
    announce_to_discovery(party_id, node_port, "offline", hostname);
}

int main(int argc, char** argv) {
    if (argc < 5) {
        cerr << "Usage: ./mpcauth_server <party 1|2> <port 1-65535> <circuit_file> <shard_hex> [remote_host]" << endl;
        cerr << "  remote_host: ALICE's address for BOB to connect to (default: 127.0.0.1)" << endl;
        cerr << "               Can be a Freehold subdomain (e.g. abc123.freehold.lit.app)" << endl;
        return 1;
    }

    int party;
    try {
        party = std::stoi(argv[1]);
    } catch (...) {
        cerr << "Invalid party ID." << endl; return 1;
    }
    if (party != ALICE && party != BOB) {
        cerr << "Party must be 1 or 2." << endl; return 1;
    }
    current_party = party;

    int port;
    try {
        port = std::stoi(argv[2]);
    } catch (...) {
        cerr << "Invalid port." << endl; return 1;
    }
    if (port < 1 || port > 65535) {
        cerr << "Port out of range." << endl; return 1;
    }

    string circuit_file = argv[3];
    if (!std::filesystem::exists(circuit_file)) {
        cerr << "Circuit error: " << circuit_file << endl;
        return 1;
    }

    string shard_hex = argv[4];
    if (shard_hex.length() % 2 != 0) {
        cerr << "Shard hex must be even length." << endl;
        return 1;
    }

    // Optional remote host for BOB to connect to ALICE (default: localhost)
    string remote_host = "127.0.0.1";
    if (argc >= 6) {
        remote_host = argv[5];
    }
    // Also check FREEHOLD_MPC_HOST env var (set by freehold-bridge when subdomain assigned)
    const char* env_host = std::getenv("FREEHOLD_MPC_HOST");
    if (env_host && remote_host == "127.0.0.1") {
        remote_host = env_host;
    }

    // B2 FIX: Use endptr to validate hex parsing instead of try/catch on strtol
    vector<bool> shard_bits;
    for (size_t i = 0; i < shard_hex.length(); i += 2) {
        char* endptr = nullptr;
        unsigned long val = strtoul(shard_hex.substr(i, 2).c_str(), &endptr, 16);
        if (endptr == nullptr || *endptr != '\0' || val > 255) {
            cerr << "Invalid hex at offset " << i << " in shard." << endl;
            return 1;
        }
        uint8_t byte = (uint8_t)val;
        for (int b = 7; b >= 0; --b) shard_bits.push_back((byte >> b) & 1);
    }

    load_nullifier_database();

    // Announce to discovery server so the web UI shows this node
    // Use public hostname from Freehold (or localhost fallback)
    const char* public_hostname = (remote_host != "127.0.0.1") ? remote_host.c_str() : "127.0.0.1";
    if (announce_to_discovery(party, port, "online", public_hostname)) {
        cout << "[Discovery] Announced party=" << party << " port=" << port
             << " host=" << public_hostname << endl;
    } else {
        cerr << "[Discovery] Warning: could not reach discovery server." << endl;
    }
    // Start heartbeat thread (announces every 15s, sends offline on exit)
    std::thread hb_thread(heartbeat_loop, party, port, public_hostname);
    hb_thread.detach();

    NetIO* net_ios[1];
    // ALICE listens on all interfaces; BOB connects to remote_host
    net_ios[0] = new NetIO(party == ALICE ? nullptr : remote_host.c_str(), port);
    cluster_ios[party] = net_ios[0];

    // DUP2 FIX: Read epoch once, pass to execute_mpc_logic
    int cluster_epoch = get_current_epoch_from_consensus();
    int request_epoch = cluster_epoch;
    if (party == ALICE) {
        net_ios[0]->send_data(&request_epoch, sizeof(int));
    } else {
        net_ios[0]->recv_data(&request_epoch, sizeof(int));
    }
    net_ios[0]->flush();

    // JesseQ v1 requires BoolIO<NetIO> wrapper for send_bit/recv_bit/get_hash_block
    BoolIO<NetIO>* bool_ios[1];
    bool_ios[0] = new BoolIO<NetIO>(net_ios[0], party);

    execute_mpc_logic<BoolIO<NetIO>>(bool_ios, 1, party, request_epoch, cluster_epoch, shard_bits, circuit_file);

    delete bool_ios[0];

    // Stop heartbeat and announce offline
    heartbeat_running = false;
    announce_to_discovery(party, port, "offline", public_hostname);

    delete net_ios[0];
    return 0;
}
