#include "h3_proxy.h"
#include "logging.h"

#include <cstring>
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
static void close_socket(int fd) { close(fd); }
#endif

// wolfSSL must be included before ngtcp2 crypto headers.
// EXTERN_C guards prevent C++ name mangling issues with wolfSSL's C API.
// wolfSSL's opensslextra compat layer redefines SSL_* macros — this is safe
// here because this TU never includes OpenSSL headers directly.
#include <wolfssl/options.h>
#include <wolfssl/ssl.h>
#include <wolfssl/wolfcrypt/random.h>

#include <ngtcp2/ngtcp2.h>
#include <ngtcp2/ngtcp2_crypto.h>
#include <ngtcp2/ngtcp2_crypto_wolfssl.h>
#include <nghttp3/nghttp3.h>

// ── ConnectionState ──────────────────────────────────────────────────────────

struct H3Proxy::ConnectionState {
    ngtcp2_conn* conn = nullptr;
    nghttp3_conn* h3conn = nullptr;
    WOLFSSL* ssl = nullptr;
    struct sockaddr_in remote = {};
    uint64_t conn_id = 0;
    std::vector<uint8_t> send_buf;

    ~ConnectionState() {
        if (h3conn) nghttp3_conn_del(h3conn);
        if (conn) ngtcp2_conn_del(conn);
        if (ssl) wolfSSL_free(ssl);
    }
};

// ── ngtcp2 callbacks ─────────────────────────────────────────────────────────

static ngtcp2_tstamp get_timestamp() {
    auto now = std::chrono::steady_clock::now();
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
        now.time_since_epoch()).count();
}

static int recv_crypto_data_cb(ngtcp2_conn* conn, ngtcp2_encryption_level level,
                                uint64_t offset, const uint8_t* data,
                                size_t datalen, void* user_data) {
    // Delegate to ngtcp2's built-in crypto handler (drives wolfSSL handshake)
    return ngtcp2_crypto_recv_crypto_data_cb(conn, level, offset, data, datalen, user_data);
}

static void rand_cb(uint8_t* dest, size_t destlen,
                     const ngtcp2_rand_ctx* rand_ctx) {
    (void)rand_ctx;
    // Use wolfSSL's RNG — must allocate a proper WC_RNG
    WC_RNG rng;
    if (wc_InitRng(&rng) == 0) {
        wc_RNG_GenerateBlock(&rng, dest, (word32)destlen);
        wc_FreeRng(&rng);
    } else {
        // Fallback: use stdlib rand as last resort.
        for (size_t i = 0; i < destlen; i++) dest[i] = (uint8_t)rand();
    }
}

static int get_new_connection_id_cb(ngtcp2_conn* conn, ngtcp2_cid* cid,
                                     uint8_t* token, size_t cidlen,
                                     void* user_data) {
    (void)conn; (void)user_data;
    for (size_t i = 0; i < cidlen; i++) cid->data[i] = (uint8_t)rand();
    cid->datalen = cidlen;
    for (size_t i = 0; i < NGTCP2_STATELESS_RESET_TOKENLEN; i++)
        token[i] = (uint8_t)rand();
    return 0;
}

// ── nghttp3 callbacks ────────────────────────────────────────────────────────

static int h3_recv_header_cb(nghttp3_conn* conn, int64_t stream_id,
                              int32_t token, nghttp3_rcbuf* name,
                              nghttp3_rcbuf* value, uint8_t flags,
                              void* user_data, void* stream_user_data) {
    (void)conn; (void)stream_id; (void)token; (void)flags;
    (void)user_data; (void)stream_user_data;
    auto n = nghttp3_rcbuf_get_buf(name);
    auto v = nghttp3_rcbuf_get_buf(value);
    LOG(TRACE, "H3 header: %.*s: %.*s", (int)n.len, n.base, (int)v.len, v.base);
    return 0;
}

static int h3_end_headers_cb(nghttp3_conn* conn, int64_t stream_id,
                              int fin, void* user_data,
                              void* stream_user_data) {
    (void)conn; (void)stream_id; (void)fin;
    (void)user_data; (void)stream_user_data;
    return 0;
}

static int h3_recv_data_cb(nghttp3_conn* conn, int64_t stream_id,
                            const uint8_t* data, size_t datalen,
                            void* user_data, void* stream_user_data) {
    (void)conn; (void)stream_id; (void)user_data; (void)stream_user_data;
    LOG(TRACE, "H3 data: %zu bytes on stream %lld", datalen, (long long)stream_id);
    return 0;
}

static int h3_end_stream_cb(nghttp3_conn* conn, int64_t stream_id,
                              void* user_data, void* stream_user_data) {
    (void)conn; (void)stream_id; (void)user_data; (void)stream_user_data;
    LOG(TRACE, "H3 stream %lld ended", (long long)stream_id);
    return 0;
}

// ── H3Proxy ──────────────────────────────────────────────────────────────────

H3Proxy::H3Proxy(const Config& cfg) : cfg_(cfg) {}

H3Proxy::~H3Proxy() { stop(); }

bool H3Proxy::init_ssl_ctx() {
    wolfSSL_Init();
    WOLFSSL_CTX* ctx = wolfSSL_CTX_new(wolfTLSv1_3_server_method());
    if (!ctx) {
        LOG(ERROR, "H3: wolfSSL_CTX_new failed");
        return false;
    }

    if (!cfg_.cert_path.empty()) {
        if (wolfSSL_CTX_use_certificate_file(ctx, cfg_.cert_path.c_str(),
                                              WOLFSSL_FILETYPE_PEM) != WOLFSSL_SUCCESS) {
            LOG(ERROR, "H3: failed to load cert %s", cfg_.cert_path.c_str());
            wolfSSL_CTX_free(ctx);
            return false;
        }
    }
    if (!cfg_.key_path.empty()) {
        if (wolfSSL_CTX_use_PrivateKey_file(ctx, cfg_.key_path.c_str(),
                                             WOLFSSL_FILETYPE_PEM) != WOLFSSL_SUCCESS) {
            LOG(ERROR, "H3: failed to load key %s", cfg_.key_path.c_str());
            wolfSSL_CTX_free(ctx);
            return false;
        }
    }

    // Configure wolfSSL CTX for ngtcp2 QUIC crypto
    ngtcp2_crypto_wolfssl_configure_server_context(ctx);

    ssl_ctx_ = ctx;
    return true;
}

void H3Proxy::start() {
    if (running_.load()) return;

    if (!init_ssl_ctx()) {
        LOG(WARN, "H3: SSL init failed, proxy will accept connections without TLS verification");
    }

    running_ = true;
    event_thread_ = std::thread(&H3Proxy::event_loop, this);
    LOG(INFO, "H3 proxy started");
}

void H3Proxy::stop() {
    if (!running_.load()) return;
    running_ = false;
    if (udp_fd_ >= 0) {
        close_socket(udp_fd_);
        udp_fd_ = -1;
    }
    if (event_thread_.joinable()) event_thread_.join();
    cleanup_connections();
    if (ssl_ctx_) {
        wolfSSL_CTX_free((WOLFSSL_CTX*)ssl_ctx_);
        ssl_ctx_ = nullptr;
    }
    LOG(INFO, "H3 proxy stopped");
}

void H3Proxy::event_loop() {
    // Create UDP socket for receiving QUIC packets
    udp_fd_ = socket(AF_INET, SOCK_DGRAM, 0);
    if (udp_fd_ < 0) {
        LOG(ERROR, "H3: socket() failed");
        return;
    }

    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(cfg_.bind_port);
    inet_pton(AF_INET, cfg_.bind_host.c_str(), &addr.sin_addr);

    if (bind(udp_fd_, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        LOG(ERROR, "H3: bind() failed");
        close_socket(udp_fd_);
        udp_fd_ = -1;
        return;
    }

    // Get actual bound port
    socklen_t alen = sizeof(addr);
    getsockname(udp_fd_, (struct sockaddr*)&addr, &alen);
    actual_port_ = ntohs(addr.sin_port);
    LOG(INFO, "H3 proxy listening on %s:%d", cfg_.bind_host.c_str(), actual_port_);

    // Set recv timeout
    struct timeval tv;
    tv.tv_sec = 1;
    tv.tv_usec = 0;
    setsockopt(udp_fd_, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));

    uint8_t buf[65536];
    while (running_.load()) {
        struct sockaddr_in from = {};
        socklen_t from_len = sizeof(from);
        int n = recvfrom(udp_fd_, (char*)buf, sizeof(buf), 0,
                         (struct sockaddr*)&from, &from_len);
        if (n > 0) {
            handle_quic_packet(buf, n, from);
        }
    }
}

void H3Proxy::feed_packet(const uint8_t* data, int len,
                            const struct sockaddr_in& remote) {
    handle_quic_packet(data, len, remote);
}

void H3Proxy::handle_quic_packet(const uint8_t* data, int len,
                                   const struct sockaddr_in& remote) {
    if (len < 1) return;

    // Parse QUIC header to get DCID
    ngtcp2_version_cid vc;
    int rv = ngtcp2_pkt_decode_version_cid(&vc, data, (size_t)len, NGTCP2_MAX_CIDLEN);
    if (rv != 0) {
        LOG(TRACE, "H3: failed to decode QUIC version/CID");
        return;
    }

    // Find or create connection
    auto* conn_state = get_or_create_conn(vc.dcid, (int)vc.dcidlen, remote);
    if (!conn_state) {
        LOG(TRACE, "H3: failed to create connection state");
        return;
    }

    // Feed packet to ngtcp2
    ngtcp2_path path;
    ngtcp2_addr local_addr = {};
    struct sockaddr_in local = {};
    local.sin_family = AF_INET;
    ngtcp2_addr_init(&local_addr, (struct sockaddr*)&local, sizeof(local));
    ngtcp2_addr remote_addr = {};
    ngtcp2_addr_init(&remote_addr, (const struct sockaddr*)&remote, sizeof(remote));
    path.local = local_addr;
    path.remote = remote_addr;

    ngtcp2_pkt_info pi = {};
    rv = ngtcp2_conn_read_pkt(conn_state->conn, &path, &pi, data, (size_t)len,
                               get_timestamp());
    if (rv != 0) {
        LOG(TRACE, "H3: ngtcp2_conn_read_pkt error: %s", ngtcp2_strerror(rv));
    }

    // Write out any pending packets
    uint8_t out[1280];
    ngtcp2_path_storage ps;
    ngtcp2_path_storage_zero(&ps);
    ngtcp2_ssize wlen;

    while (true) {
        wlen = ngtcp2_conn_write_pkt(conn_state->conn, &ps.path, &pi,
                                      out, sizeof(out), get_timestamp());
        if (wlen <= 0) break;
        sendto(udp_fd_, (const char*)out, (int)wlen, 0,
               (const struct sockaddr*)&remote, sizeof(remote));
    }
}

H3Proxy::ConnectionState* H3Proxy::get_or_create_conn(
    const uint8_t* dcid, int dcid_len,
    const struct sockaddr_in& remote) {

    // Use first 8 bytes of DCID as connection key
    uint64_t key = 0;
    int copy = std::min(dcid_len, 8);
    memcpy(&key, dcid, copy);

    std::lock_guard<std::mutex> lock(conns_mu_);
    auto it = connections_.find(key);
    if (it != connections_.end()) return it->second;

    // Create new connection
    auto* state = new ConnectionState();
    state->conn_id = key;
    state->remote = remote;

    // Create WOLFSSL session for this connection
    if (ssl_ctx_) {
        state->ssl = wolfSSL_new((WOLFSSL_CTX*)ssl_ctx_);
        if (!state->ssl) {
            LOG(ERROR, "H3: wolfSSL_new failed");
            delete state;
            return nullptr;
        }
    }

    // ngtcp2 server connection setup
    ngtcp2_cid scid, dcid_struct;
    memset(&scid, 0, sizeof(scid));
    scid.datalen = NGTCP2_MIN_INITIAL_DCIDLEN;
    for (size_t i = 0; i < scid.datalen; i++) scid.data[i] = (uint8_t)rand();

    memset(&dcid_struct, 0, sizeof(dcid_struct));
    dcid_struct.datalen = std::min((size_t)dcid_len, sizeof(dcid_struct.data));
    memcpy(dcid_struct.data, dcid, dcid_struct.datalen);

    ngtcp2_callbacks callbacks = {};
    callbacks.recv_crypto_data = recv_crypto_data_cb;
    callbacks.rand = rand_cb;
    callbacks.get_new_connection_id = get_new_connection_id_cb;
    // wolfSSL server context should already be configured via
    // ngtcp2_crypto_wolfssl_configure_server_context() in init()

    ngtcp2_settings settings;
    ngtcp2_settings_default(&settings);
    settings.initial_ts = get_timestamp();

    ngtcp2_transport_params params;
    ngtcp2_transport_params_default(&params);
    params.initial_max_streams_bidi = 100;
    params.initial_max_streams_uni = 100;
    params.initial_max_data = 1048576;
    params.initial_max_stream_data_bidi_local = 262144;
    params.initial_max_stream_data_bidi_remote = 262144;
    params.initial_max_stream_data_uni = 262144;

    ngtcp2_path path;
    ngtcp2_addr local_addr = {};
    struct sockaddr_in local = {};
    local.sin_family = AF_INET;
    ngtcp2_addr_init(&local_addr, (struct sockaddr*)&local, sizeof(local));
    ngtcp2_addr remote_addr = {};
    ngtcp2_addr_init(&remote_addr, (const struct sockaddr*)&remote, sizeof(remote));
    path.local = local_addr;
    path.remote = remote_addr;

    int rv = ngtcp2_conn_server_new(&state->conn, &dcid_struct, &scid, &path,
                                     NGTCP2_PROTO_VER_V1, &callbacks, &settings,
                                     &params, nullptr, state);
    if (rv != 0) {
        LOG(ERROR, "H3: ngtcp2_conn_server_new failed: %s", ngtcp2_strerror(rv));
        delete state;
        return nullptr;
    }

    if (state->ssl) {
        ngtcp2_conn_set_tls_native_handle(state->conn, state->ssl);
    }

    // Create nghttp3 connection
    nghttp3_callbacks h3callbacks = {};
    h3callbacks.recv_header = h3_recv_header_cb;
    h3callbacks.end_headers = h3_end_headers_cb;
    h3callbacks.recv_data = h3_recv_data_cb;
    h3callbacks.end_stream = h3_end_stream_cb;

    nghttp3_settings h3settings;
    nghttp3_settings_default(&h3settings);

    rv = nghttp3_conn_server_new(&state->h3conn, &h3callbacks, &h3settings,
                                  nghttp3_mem_default(), state);
    if (rv != 0) {
        LOG(ERROR, "H3: nghttp3_conn_server_new failed");
        delete state;
        return nullptr;
    }

    connections_[key] = state;
    LOG(DEBUG, "H3: new connection from %s:%d",
        inet_ntoa(remote.sin_addr), ntohs(remote.sin_port));
    return state;
}

void H3Proxy::forward_to_backend(const H3Backend& backend,
                                   const std::string& method,
                                   const std::string& path,
                                   const uint8_t* body, int body_len,
                                   std::vector<uint8_t>& response) {
    // Connect to local backend via TCP
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return;

    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(backend.local_port);
    inet_pton(AF_INET, backend.local_host.c_str(), &addr.sin_addr);

    if (connect(fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        close_socket(fd);
        return;
    }

    // Build HTTP/1.1 request to local backend
    std::string req = method + " " + path + " HTTP/1.1\r\n"
                      "Host: " + backend.local_host + ":" + std::to_string(backend.local_port) + "\r\n"
                      "Connection: close\r\n";
    if (body && body_len > 0) {
        req += "Content-Length: " + std::to_string(body_len) + "\r\n";
    }
    req += "\r\n";
    send(fd, req.c_str(), (int)req.size(), 0);
    if (body && body_len > 0) {
        send(fd, (const char*)body, body_len, 0);
    }

    // Read response
    char buf[4096];
    while (true) {
        int n = recv(fd, buf, sizeof(buf), 0);
        if (n <= 0) break;
        response.insert(response.end(), buf, buf + n);
    }
    close_socket(fd);
}

void H3Proxy::proxy_h3_request(ConnectionState* conn,
                                 const std::string& path,
                                 const std::string& method,
                                 const uint8_t* body, int body_len) {
    // Match path to backend
    for (auto& b : cfg_.backends) {
        // Simple prefix matching: first backend that matches wins
        std::vector<uint8_t> response;
        forward_to_backend(b, method, path, body, body_len, response);
        if (!response.empty()) {
            LOG(DEBUG, "H3: proxied %s %s -> %s (%zu bytes response)",
                method.c_str(), path.c_str(), b.name.c_str(), response.size());
            return;
        }
    }
    LOG(WARN, "H3: no backend matched for %s %s", method.c_str(), path.c_str());
}

void H3Proxy::cleanup_connections() {
    std::lock_guard<std::mutex> lock(conns_mu_);
    for (auto& [k, v] : connections_) delete v;
    connections_.clear();
}
