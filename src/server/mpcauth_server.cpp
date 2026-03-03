#include <emp-tool/emp-tool.h>
#include <emp-zk/emp-zk.h>
#include <vector>
#include <string>
#include <set>
#include <fstream>
#include <stdexcept>
#include <filesystem>
#include <memory>
#include <thread>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstring>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32")
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif

#include "logging.h"

// Definition of the global log level (declared extern in logging.h)
LogLevel g_log_level = INFO;

#include "forwarder.h"
#include "discovery.h"
#include "relay_client.h"
#include "h3_proxy.h"
#include "smtp_client.h"

using namespace std;
using namespace emp;

int current_party = 1;
NetIO* cluster_ios[5] = {nullptr};

#if ENABLE_LLSS
#include "llss_mpc.h"
#endif
#include "smtp_mpc.h"

// ── CLI Arguments ────────────────────────────────────────────────────────────

struct CLIArgs {
    int party = 0;
    int port = 0;
    string circuit_file;
    string shard_hex;
    string remote_host = "127.0.0.1";
    string relay_host = "relay.stare.network";
    int relay_port = 9999;
    int discovery_port = 5880;
    int forwarder_port = 5870;
    bool no_relay = false;
    bool no_forwarder = false;
    LogLevel log_level = INFO;
    // SMTP email delivery
    string smtp_host;
    int smtp_port = 25;
    string email_from = "noreply@freehold.local";
    string email_to;
    string smtp_user;
    string smtp_pass;
    string petition_ref = "DEMO-001";
    bool no_starttls = false;
};

static void print_usage(const char* prog) {
    fprintf(stderr,
        "Usage: %s [options]\n"
        "\n"
        "Required:\n"
        "  --party <1|2>          Party ID (ALICE=1, BOB=2)\n"
        "  --port <port>          MPC listening port\n"
        "  --circuit <file>       Bristol circuit file path\n"
        "  --shard <hex>          Identity shard as hex string\n"
        "\n"
        "Networking:\n"
        "  --remote <host>        ALICE's address for BOB (default: 127.0.0.1)\n"
        "  --relay <host:port>    Freehold relay (default: relay.stare.network:9999)\n"
        "  --discovery-port <p>   Embedded discovery server port (default: 5880)\n"
        "  --forwarder-port <p>   SMTP forwarder port (default: 5870)\n"
        "  --no-relay             Skip Freehold relay registration\n"
        "  --no-forwarder         Skip SMTP forwarder\n"
        "\n"
        "Email delivery (after MPC verification):\n"
        "  --smtp-host <host>     SMTP server (env: FREEHOLD_SMTP_HOST)\n"
        "  --smtp-port <port>     SMTP port (default: 25, env: FREEHOLD_SMTP_PORT)\n"
        "  --email-from <addr>    From address (default: noreply@freehold.local)\n"
        "  --email-to <addr>      Recipient (env: FREEHOLD_EMAIL_TO)\n"
        "  --smtp-user <user>     SMTP auth user (env: FREEHOLD_SMTP_USER)\n"
        "  --smtp-pass <pass>     SMTP auth pass (env: FREEHOLD_SMTP_PASS)\n"
        "  --petition-ref <ref>   Petition reference (default: DEMO-001)\n"
        "  --no-starttls          Disable STARTTLS\n"
        "\n"
        "Logging:\n"
        "  --quiet                Suppress all output except errors\n"
        "  --verbose              Enable trace-level logging\n"
        "  --log-level <level>    Set log level (TRACE|DEBUG|INFO|WARN|ERROR)\n",
        prog);
}

static bool parse_args(int argc, char** argv, CLIArgs& args) {
    for (int i = 1; i < argc; i++) {
        string arg = argv[i];

        if (arg == "--party" && i + 1 < argc) {
            args.party = atoi(argv[++i]);
        } else if (arg == "--port" && i + 1 < argc) {
            args.port = atoi(argv[++i]);
        } else if (arg == "--circuit" && i + 1 < argc) {
            args.circuit_file = argv[++i];
        } else if (arg == "--shard" && i + 1 < argc) {
            args.shard_hex = argv[++i];
        } else if (arg == "--remote" && i + 1 < argc) {
            args.remote_host = argv[++i];
        } else if (arg == "--relay" && i + 1 < argc) {
            string relay = argv[++i];
            auto colon = relay.rfind(':');
            if (colon != string::npos) {
                args.relay_host = relay.substr(0, colon);
                args.relay_port = atoi(relay.substr(colon + 1).c_str());
            } else {
                args.relay_host = relay;
            }
        } else if (arg == "--discovery-port" && i + 1 < argc) {
            args.discovery_port = atoi(argv[++i]);
        } else if (arg == "--forwarder-port" && i + 1 < argc) {
            args.forwarder_port = atoi(argv[++i]);
        } else if (arg == "--no-relay") {
            args.no_relay = true;
        } else if (arg == "--no-forwarder") {
            args.no_forwarder = true;
        } else if (arg == "--smtp-host" && i + 1 < argc) {
            args.smtp_host = argv[++i];
        } else if (arg == "--smtp-port" && i + 1 < argc) {
            args.smtp_port = atoi(argv[++i]);
        } else if (arg == "--email-from" && i + 1 < argc) {
            args.email_from = argv[++i];
        } else if (arg == "--email-to" && i + 1 < argc) {
            args.email_to = argv[++i];
        } else if (arg == "--smtp-user" && i + 1 < argc) {
            args.smtp_user = argv[++i];
        } else if (arg == "--smtp-pass" && i + 1 < argc) {
            args.smtp_pass = argv[++i];
        } else if (arg == "--petition-ref" && i + 1 < argc) {
            args.petition_ref = argv[++i];
        } else if (arg == "--no-starttls") {
            args.no_starttls = true;
        } else if (arg == "--quiet") {
            args.log_level = ERROR;
        } else if (arg == "--verbose") {
            args.log_level = TRACE;
        } else if (arg == "--log-level" && i + 1 < argc) {
            args.log_level = parse_log_level(argv[++i]);
        } else if (arg == "--help" || arg == "-h") {
            print_usage(argv[0]);
            return false;
        } else {
            // Legacy positional argument support:
            // <party> <port> <circuit> <shard> [remote]
            if (args.party == 0 && isdigit(arg[0])) {
                args.party = atoi(arg.c_str());
            } else if (args.port == 0 && isdigit(arg[0])) {
                args.port = atoi(arg.c_str());
            } else if (args.circuit_file.empty()) {
                args.circuit_file = arg;
            } else if (args.shard_hex.empty()) {
                args.shard_hex = arg;
            } else if (args.remote_host == "127.0.0.1") {
                args.remote_host = arg;
            } else {
                LOG(ERROR, "Unknown argument: %s", arg.c_str());
                print_usage(argv[0]);
                return false;
            }
        }
    }
    return true;
}

static bool validate_args(const CLIArgs& args) {
    if (args.party != ALICE && args.party != BOB) {
        LOG(ERROR, "Party must be 1 (ALICE) or 2 (BOB)");
        return false;
    }
    if (args.port < 1 || args.port > 65535) {
        LOG(ERROR, "Port must be 1-65535");
        return false;
    }
    if (args.circuit_file.empty() || !filesystem::exists(args.circuit_file)) {
        LOG(ERROR, "Circuit file missing or not found: %s", args.circuit_file.c_str());
        return false;
    }
    if (args.shard_hex.empty() || args.shard_hex.length() % 2 != 0) {
        LOG(ERROR, "Shard hex must be non-empty and even length");
        return false;
    }
    return true;
}

// ── Nullifier Database ──────────────────────────────────────────────────────

static const string NULLIFIER_DB_PATH = "nullifier_database.txt";
set<string> nullifier_database;

void load_nullifier_database() {
    if (!filesystem::exists(NULLIFIER_DB_PATH)) return;
    ifstream f(NULLIFIER_DB_PATH);
    string line;
    while (getline(f, line)) {
        if (!line.empty()) nullifier_database.insert(line);
    }
    LOG(DEBUG, "Loaded %zu nullifiers from database", nullifier_database.size());
}

void save_nullifier(const string& nullifier) {
    ofstream f(NULLIFIER_DB_PATH, ios::app);
    f << nullifier << "\n";
    f.flush();
}

// ── Hash Computation ────────────────────────────────────────────────────────

string compute_hash_to_hex(const bool* hash_out, int bit_len) {
    string hex_str;
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

// ── Epoch ───────────────────────────────────────────────────────────────────

int get_current_epoch_from_consensus() {
    const char* env_epoch = getenv("CLUSTER_BFT_EPOCH");
    if (!env_epoch) {
        LOG(WARN, "CLUSTER_BFT_EPOCH not set, defaulting to epoch 1");
        return 1;
    }
    try {
        return stoi(env_epoch);
    } catch (...) {
        LOG(ERROR, "Invalid CLUSTER_BFT_EPOCH value");
        return 1;
    }
}

// ── MPC Logic ───────────────────────────────────────────────────────────────

template<typename IO>
string execute_mpc_logic(IO** ios, int threads, int party, int request_epoch,
                         int cluster_epoch, const vector<bool>& my_shard,
                         const string& circuit_file) {
    setup_zk_bool<IO>(ios, threads, party);

#if ENABLE_LLSS
    LLSSContext llss(cluster_epoch, 3, {1, 2, 3, 4, 5},
                     "reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt");

    if (request_epoch != cluster_epoch) {
        LOG(INFO, "ADKR Epoch Mismatch Detected");
        block dummy_shard;
        llss.apply_transition_gate(ProtocolExecution::prot_exec, &dummy_shard, &dummy_shard, 128);
    }
#else
    if (request_epoch != cluster_epoch) {
        LOG(WARN, "Epoch mismatch but LLSS-MPC not enabled, ignoring");
    }
#endif

    LOG(INFO, "Active cluster session: epoch %d", cluster_epoch);

    // Load password shard
    vector<bool> pass_shard;
    string pass_shard_path = "shard_" + to_string(current_party) + "_pass.bin";
    if (filesystem::exists(pass_shard_path)) {
        ifstream pf(pass_shard_path, ios::binary);
        char byte;
        while (pf.get(byte)) for (int b = 7; b >= 0; --b) pass_shard.push_back((byte >> b) & 1);
    } else {
        throw runtime_error("Password shard file missing for node " + to_string(current_party));
    }

    // Initialize TLS session keys from the identity shard
    {
        int shard_bytes_len = (int)my_shard.size() / 8;
        vector<uint8_t> shard_bytes(shard_bytes_len);
        for (int i = 0; i < shard_bytes_len; i++) {
            uint8_t val = 0;
            for (int b = 0; b < 8; b++) {
                if (my_shard[i * 8 + b]) val |= (1 << b);
            }
            shard_bytes[i] = val;
        }
        init_tls_session_from_shard(shard_bytes.data(), shard_bytes_len);
    }

    uint8_t auth_ciphertext[4096];
    int ct_len = Joint_SMTP_Authenticate<IO>(ProtocolExecution::prot_exec,
                                              auth_ciphertext, sizeof(auth_ciphertext),
                                              pass_shard, circuit_file);
    (void)ct_len;

    // Identity Commitment (SHA-256 Nullifier)
    LOG(INFO, "Computing ZK identity commitment...");
    constexpr int sha_in_len = 512;
    constexpr int sha_out_len = 256;

    unique_ptr<block[]> in_bits(new block[sha_in_len]);
    unique_ptr<block[]> out_bits(new block[sha_out_len]);

    unique_ptr<bool[]> raw_in(new bool[sha_in_len]());
    if (current_party == ALICE) {
        for (int i = 0; i < sha_in_len; i++) raw_in[i] = (i < (int)my_shard.size()) ? my_shard[i] : false;
    }
    ProtocolExecution::prot_exec->feed(in_bits.get(), ALICE, raw_in.get(), sha_in_len);

    BristolFashion cf_sha(circuit_file.c_str());
    cf_sha.compute(out_bits.get(), in_bits.get());

    unique_ptr<bool[]> hash_result(new bool[sha_out_len]);
    ProtocolExecution::prot_exec->reveal(hash_result.get(), PUBLIC, out_bits.get(), sha_out_len);

    string nullifier = compute_hash_to_hex(hash_result.get(), sha_out_len);
    if (nullifier_database.count(nullifier)) {
        LOG(ERROR, "REJECTED: Identity already signed");
        finalize_zk_bool<IO>();
        return "";
    } else {
        nullifier_database.insert(nullifier);
        save_nullifier(nullifier);
        LOG(INFO, "SUCCESS: Identity verified");
    }

    bool cheated = finalize_zk_bool<IO>();
    if (cheated) {
        LOG(ERROR, "Cheating detected by verifier");
        throw runtime_error("ZK proof verification failed: cheating detected.");
    }

    return nullifier;
}

// ── Signal Handling ─────────────────────────────────────────────────────────

static atomic<bool> g_shutdown{false};

static void signal_handler(int sig) {
    (void)sig;
    g_shutdown = true;
}

// ── Main ────────────────────────────────────────────────────────────────────

int main(int argc, char** argv) {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    CLIArgs args;
    if (!parse_args(argc, argv, args)) return 1;

    // Set log level
    g_log_level = args.log_level;

    // Environment variable fallbacks for SMTP config
    if (args.smtp_host.empty()) {
        const char* v = getenv("FREEHOLD_SMTP_HOST");
        if (v) args.smtp_host = v;
    }
    if (args.smtp_port == 25) {
        const char* v = getenv("FREEHOLD_SMTP_PORT");
        if (v) args.smtp_port = atoi(v);
    }
    if (args.email_from == "noreply@freehold.local") {
        const char* v = getenv("FREEHOLD_EMAIL_FROM");
        if (v) args.email_from = v;
    }
    if (args.email_to.empty()) {
        const char* v = getenv("FREEHOLD_EMAIL_TO");
        if (v) args.email_to = v;
    }
    if (args.smtp_user.empty()) {
        const char* v = getenv("FREEHOLD_SMTP_USER");
        if (v) args.smtp_user = v;
    }
    if (args.smtp_pass.empty()) {
        const char* v = getenv("FREEHOLD_SMTP_PASS");
        if (v) args.smtp_pass = v;
    }

    if (!validate_args(args)) {
        print_usage(argv[0]);
        return 1;
    }

    current_party = args.party;
    LOG(INFO, "mpcauth_server starting: party=%d port=%d", args.party, args.port);

    // Parse shard hex to bits
    vector<bool> shard_bits;
    for (size_t i = 0; i < args.shard_hex.length(); i += 2) {
        char* endptr = nullptr;
        unsigned long val = strtoul(args.shard_hex.substr(i, 2).c_str(), &endptr, 16);
        if (endptr == nullptr || *endptr != '\0' || val > 255) {
            LOG(ERROR, "Invalid hex at offset %zu in shard", i);
            return 1;
        }
        uint8_t byte = (uint8_t)val;
        for (int b = 7; b >= 0; --b) shard_bits.push_back((byte >> b) & 1);
    }

    load_nullifier_database();

    // ── Start embedded discovery server ──────────────────────────────────
    DiscoveryServer::Config disc_cfg;
    disc_cfg.listen_port = args.discovery_port;
    DiscoveryServer discovery(disc_cfg);
    discovery.start();

    // ── Start SMTP forwarder ─────────────────────────────────────────────
    unique_ptr<SMTPForwarder> forwarder;
    if (!args.no_forwarder) {
        SMTPForwarder::Config fwd_cfg;
        fwd_cfg.listen_port = args.forwarder_port;
        fwd_cfg.circuit_path = args.circuit_file;
        fwd_cfg.allow_insecure = true; // Allow starting without mTLS certs
        try {
            forwarder = make_unique<SMTPForwarder>(fwd_cfg);
            forwarder->start();
        } catch (const exception& e) {
            LOG(WARN, "Forwarder init failed: %s (continuing without it)", e.what());
            forwarder.reset();
        }
    }

    // ── Start Freehold relay client ──────────────────────────────────────
    unique_ptr<RelayClient> relay;
    string public_hostname = args.remote_host;

    if (!args.no_relay) {
        RelayClient::Config relay_cfg;
        relay_cfg.relay_host = args.relay_host;
        relay_cfg.relay_port = args.relay_port;
        relay_cfg.services = {
            {"mpc-node",   (uint16_t)args.port,           (uint16_t)args.port},
            {"discovery",  (uint16_t)args.discovery_port,  (uint16_t)args.discovery_port},
            {"forwarder",  (uint16_t)args.forwarder_port,  (uint16_t)args.forwarder_port},
        };
        relay_cfg.on_registered = [&](const string& service_name, uint16_t port) {
            LOG(INFO, "Relay registered: %s port=%d", service_name.c_str(), port);
            if (service_name == "mpc-node") {
                discovery.update_relay_status(args.party, args.port, true, "");
            }
        };
        relay_cfg.on_subdomain = [&](const string& service_name, const string& subdomain) {
            LOG(INFO, "Relay assigned subdomain: %s -> %s", service_name.c_str(), subdomain.c_str());
            if (service_name == "mpc-node") {
                public_hostname = subdomain;
                // Self-announce to embedded discovery
                discovery.register_node(args.party, args.port, subdomain, "online");
                discovery.update_relay_status(args.party, args.port, true, subdomain);
            }
        };

        relay = make_unique<RelayClient>(relay_cfg);
        relay->start();
    }

    // ── Self-announce to discovery ───────────────────────────────────────
    discovery.register_node(args.party, args.port, public_hostname, "online");
    LOG(INFO, "Announced to discovery: party=%d port=%d host=%s",
        args.party, args.port, public_hostname.c_str());

    // ── Heartbeat thread ─────────────────────────────────────────────────
    thread heartbeat_thread([&]() {
        while (!g_shutdown.load()) {
            this_thread::sleep_for(chrono::seconds(15));
            if (g_shutdown.load()) break;
            discovery.register_node(args.party, args.port, public_hostname, "online");
        }
    });

    // ── Wait for peer (BOB resolves ALICE via discovery) ─────────────────
    if (args.party == BOB && args.remote_host == "127.0.0.1" && !args.no_relay) {
        // Try to resolve ALICE's public hostname from discovery
        LOG(INFO, "Resolving ALICE's address from discovery...");
        for (int attempt = 0; attempt < 30 && !g_shutdown.load(); attempt++) {
            string alice_host;
            int alice_port = 0;
            if (discovery.resolve_party(ALICE, alice_host, alice_port)) {
                args.remote_host = alice_host;
                LOG(INFO, "Resolved ALICE: %s:%d", alice_host.c_str(), alice_port);
                break;
            }
            this_thread::sleep_for(chrono::seconds(2));
        }
    }

    // ── MPC Network IO ──────────────────────────────────────────────────
    LOG(INFO, "Creating NetIO: party=%d %s port=%d",
        args.party,
        args.party == ALICE ? "listening" : "connecting",
        args.port);

    NetIO* net_ios[1];
    net_ios[0] = new NetIO(args.party == ALICE ? nullptr : args.remote_host.c_str(), args.port);
    cluster_ios[args.party] = net_ios[0];

    // Epoch synchronization
    int cluster_epoch = get_current_epoch_from_consensus();
    int request_epoch = cluster_epoch;
    if (args.party == ALICE) {
        net_ios[0]->send_data(&request_epoch, sizeof(int));
    } else {
        net_ios[0]->recv_data(&request_epoch, sizeof(int));
    }
    net_ios[0]->flush();

    // JesseQ v1 requires BoolIO<NetIO> wrapper
    BoolIO<NetIO>* bool_ios[1];
    bool_ios[0] = new BoolIO<NetIO>(net_ios[0], args.party);

    // ── Execute MPC ─────────────────────────────────────────────────────
    string nullifier;
    try {
        nullifier = execute_mpc_logic<BoolIO<NetIO>>(bool_ios, 1, args.party,
                                                      request_epoch, cluster_epoch,
                                                      shard_bits, args.circuit_file);
    } catch (const exception& e) {
        LOG(ERROR, "MPC execution failed: %s", e.what());
    }

    // ── Email delivery (ALICE only) ─────────────────────────────────────
    if (current_party == ALICE && !args.email_to.empty() &&
        !args.smtp_host.empty() && !nullifier.empty()) {
        SmtpConfig smtp_cfg;
        smtp_cfg.host = args.smtp_host;
        smtp_cfg.port = args.smtp_port;
        smtp_cfg.from = args.email_from;
        smtp_cfg.to = args.email_to;
        smtp_cfg.user = args.smtp_user;
        smtp_cfg.pass = args.smtp_pass;
        smtp_cfg.starttls = !args.no_starttls;

        VerificationPayload payload;
        payload.nullifier_hex = nullifier;
        payload.petition_ref = args.petition_ref;
        payload.epoch = cluster_epoch;

        if (!send_verification_email(smtp_cfg, payload)) {
            LOG(ERROR, "SMTP: Email delivery failed (MPC verification still succeeded)");
        }
    }

    // ── Shutdown ────────────────────────────────────────────────────────
    LOG(INFO, "Shutting down...");
    g_shutdown = true;

    // Announce offline
    discovery.register_node(args.party, args.port, public_hostname, "offline");

    if (heartbeat_thread.joinable()) heartbeat_thread.join();

    delete bool_ios[0];
    delete net_ios[0];

    if (relay) relay->stop();
    if (forwarder) forwarder->stop();
    discovery.stop();

    LOG(INFO, "mpcauth_server exited cleanly");

#ifdef _WIN32
    WSACleanup();
#endif
    return 0;
}
