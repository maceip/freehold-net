#include "smtp_client.h"
#include "logging.h"

#include <openssl/ssl.h>
#include <openssl/evp.h>
#include <openssl/err.h>

#include <cstring>
#include <ctime>
#include <chrono>
#include <string>
#include <vector>

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

static void set_socket_timeout(int fd, int seconds) {
#ifdef _WIN32
    DWORD tv = seconds * 1000;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, (const char*)&tv, sizeof(tv));
#else
    struct timeval tv;
    tv.tv_sec = seconds;
    tv.tv_usec = 0;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
#endif
}

// Read one SMTP response (may be multi-line: "250-..." continues, "250 " ends).
// Returns the 3-digit code, or -1 on error.
static int smtp_read_response(int fd, SSL* ssl, std::string& out) {
    out.clear();
    char buf[1024];
    while (true) {
        int n;
        if (ssl) {
            n = SSL_read(ssl, buf, sizeof(buf) - 1);
        } else {
            n = recv(fd, buf, sizeof(buf) - 1, 0);
        }
        if (n <= 0) return -1;
        buf[n] = '\0';
        out.append(buf, n);

        // Check if the last complete line has "NNN " (space after code = final line)
        // Walk backwards to find last newline
        size_t pos = 0;
        int code = -1;
        while (pos < out.size()) {
            size_t eol = out.find('\n', pos);
            if (eol == std::string::npos) break;
            // Line is out[pos..eol]
            std::string line = out.substr(pos, eol - pos);
            // Strip trailing \r
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.size() >= 4) {
                code = std::atoi(line.substr(0, 3).c_str());
                if (line[3] == ' ') {
                    // Final line
                    LOG(DEBUG, "SMTP <<< %s", out.c_str());
                    return code;
                }
            }
            pos = eol + 1;
        }
        // Haven't seen final line yet, keep reading
    }
}

static bool smtp_send(int fd, SSL* ssl, const std::string& data) {
    LOG(DEBUG, "SMTP >>> %s", data.c_str());
    if (ssl) {
        return SSL_write(ssl, data.c_str(), (int)data.size()) > 0;
    }
    return send(fd, data.c_str(), (int)data.size(), 0) > 0;
}

static std::string base64_encode(const std::string& input) {
    size_t out_len = 4 * ((input.size() + 2) / 3) + 1;
    std::vector<unsigned char> out(out_len);
    int n = EVP_EncodeBlock(out.data(),
                            (const unsigned char*)input.data(),
                            (int)input.size());
    return std::string((char*)out.data(), n);
}

static std::string rfc2822_date() {
    auto now = std::chrono::system_clock::now();
    auto t = std::chrono::system_clock::to_time_t(now);
    struct tm tm_buf;
#ifdef _WIN32
    gmtime_s(&tm_buf, &t);
#else
    gmtime_r(&t, &tm_buf);
#endif
    char buf[64];
    strftime(buf, sizeof(buf), "%a, %d %b %Y %H:%M:%S +0000", &tm_buf);
    return std::string(buf);
}

static std::string iso8601_now() {
    auto now = std::chrono::system_clock::now();
    auto t = std::chrono::system_clock::to_time_t(now);
    struct tm tm_buf;
#ifdef _WIN32
    gmtime_s(&tm_buf, &t);
#else
    gmtime_r(&t, &tm_buf);
#endif
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm_buf);
    return std::string(buf);
}

// ── Main send function ───────────────────────────────────────────────────────

bool send_verification_email(const SmtpConfig& cfg, const VerificationPayload& payload) {
    if (cfg.host.empty() || cfg.to.empty()) {
        LOG(ERROR, "SMTP: host or recipient not configured");
        return false;
    }

    LOG(INFO, "SMTP: Connecting to %s:%d", cfg.host.c_str(), cfg.port);

    // TCP connect
    struct addrinfo hints = {}, *res = nullptr;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    char port_str[8];
    snprintf(port_str, sizeof(port_str), "%d", cfg.port);

    if (getaddrinfo(cfg.host.c_str(), port_str, &hints, &res) != 0 || !res) {
        LOG(ERROR, "SMTP: Cannot resolve %s", cfg.host.c_str());
        return false;
    }

    int fd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (fd < 0) {
        freeaddrinfo(res);
        LOG(ERROR, "SMTP: socket() failed");
        return false;
    }

    if (connect(fd, res->ai_addr, (int)res->ai_addrlen) < 0) {
        freeaddrinfo(res);
        close_socket(fd);
        LOG(ERROR, "SMTP: connect to %s:%d failed", cfg.host.c_str(), cfg.port);
        return false;
    }
    freeaddrinfo(res);

    set_socket_timeout(fd, 10);

    SSL_CTX* ssl_ctx = nullptr;
    SSL* ssl = nullptr;
    std::string resp;
    bool ok = false;

    // Read 220 greeting
    int code = smtp_read_response(fd, nullptr, resp);
    if (code != 220) {
        LOG(ERROR, "SMTP: Expected 220 greeting, got %d", code);
        goto cleanup;
    }

    // EHLO
    if (!smtp_send(fd, nullptr, "EHLO freehold.local\r\n")) goto cleanup;
    code = smtp_read_response(fd, nullptr, resp);
    if (code != 250) {
        LOG(ERROR, "SMTP: EHLO failed with %d", code);
        goto cleanup;
    }

    // STARTTLS
    if (cfg.starttls && resp.find("STARTTLS") != std::string::npos) {
        if (!smtp_send(fd, nullptr, "STARTTLS\r\n")) goto cleanup;
        code = smtp_read_response(fd, nullptr, resp);
        if (code != 220) {
            LOG(ERROR, "SMTP: STARTTLS rejected with %d", code);
            goto cleanup;
        }

        ssl_ctx = SSL_CTX_new(TLS_client_method());
        if (!ssl_ctx) {
            LOG(ERROR, "SMTP: SSL_CTX_new failed");
            goto cleanup;
        }
        ssl = SSL_new(ssl_ctx);
        SSL_set_fd(ssl, fd);
        if (SSL_connect(ssl) <= 0) {
            LOG(ERROR, "SMTP: SSL_connect failed");
            goto cleanup;
        }
        LOG(DEBUG, "SMTP: TLS established");

        // Re-EHLO after STARTTLS
        if (!smtp_send(fd, ssl, "EHLO freehold.local\r\n")) goto cleanup;
        code = smtp_read_response(fd, ssl, resp);
        if (code != 250) {
            LOG(ERROR, "SMTP: Post-STARTTLS EHLO failed with %d", code);
            goto cleanup;
        }
    }

    // AUTH PLAIN
    if (!cfg.user.empty()) {
        // AUTH PLAIN: base64("\0user\0pass")
        std::string plain_str;
        plain_str.push_back('\0');
        plain_str.append(cfg.user);
        plain_str.push_back('\0');
        plain_str.append(cfg.pass);
        std::string auth_cmd = "AUTH PLAIN " + base64_encode(plain_str) + "\r\n";
        if (!smtp_send(fd, ssl, auth_cmd)) goto cleanup;
        code = smtp_read_response(fd, ssl, resp);
        if (code != 235) {
            LOG(ERROR, "SMTP: AUTH PLAIN failed with %d", code);
            goto cleanup;
        }
        LOG(DEBUG, "SMTP: Authenticated");
    }

    // MAIL FROM
    {
        std::string cmd = "MAIL FROM:<" + cfg.from + ">\r\n";
        if (!smtp_send(fd, ssl, cmd)) goto cleanup;
        code = smtp_read_response(fd, ssl, resp);
        if (code != 250) {
            LOG(ERROR, "SMTP: MAIL FROM rejected with %d", code);
            goto cleanup;
        }
    }

    // RCPT TO
    {
        std::string cmd = "RCPT TO:<" + cfg.to + ">\r\n";
        if (!smtp_send(fd, ssl, cmd)) goto cleanup;
        code = smtp_read_response(fd, ssl, resp);
        if (code != 250) {
            LOG(ERROR, "SMTP: RCPT TO rejected with %d", code);
            goto cleanup;
        }
    }

    // DATA
    {
        if (!smtp_send(fd, ssl, "DATA\r\n")) goto cleanup;
        code = smtp_read_response(fd, ssl, resp);
        if (code != 354) {
            LOG(ERROR, "SMTP: DATA rejected with %d", code);
            goto cleanup;
        }

        std::string msg_id = payload.nullifier_hex.substr(0, 16) + "@freehold.local";

        std::string body;
        body += "Subject: [Freehold] Petition Signature Verified\r\n";
        body += "From: <" + cfg.from + ">\r\n";
        body += "To: <" + cfg.to + ">\r\n";
        body += "Message-ID: <" + msg_id + ">\r\n";
        body += "Date: " + rfc2822_date() + "\r\n";
        body += "Content-Type: text/plain; charset=utf-8\r\n";
        body += "\r\n";
        body += "FREEHOLD PETITION SIGNATURE VERIFICATION\r\n";
        body += "=========================================\r\n";
        body += "Identity Commitment (Nullifier): " + payload.nullifier_hex + "\r\n";
        body += "Protocol: Zero-Knowledge SHA-256 via emp-zk\r\n";
        body += "Epoch: " + std::to_string(payload.epoch) + "\r\n";
        body += "Petition: " + payload.petition_ref + "\r\n";
        body += "Timestamp: " + iso8601_now() + "\r\n";
        body += "\r\n";
        body += "This signature was jointly computed by the MPC cluster.\r\n";
        body += "The nullifier proves one-person-one-vote without revealing identity.\r\n";
        body += "\r\n.\r\n";

        if (!smtp_send(fd, ssl, body)) goto cleanup;
        code = smtp_read_response(fd, ssl, resp);
        if (code != 250) {
            LOG(ERROR, "SMTP: Message not accepted, got %d", code);
            goto cleanup;
        }
    }

    // QUIT
    smtp_send(fd, ssl, "QUIT\r\n");
    smtp_read_response(fd, ssl, resp); // 221, don't care if it fails

    ok = true;
    LOG(INFO, "SMTP: Verification email sent to %s", cfg.to.c_str());

cleanup:
    if (ssl) {
        SSL_shutdown(ssl);
        SSL_free(ssl);
    }
    if (ssl_ctx) SSL_CTX_free(ssl_ctx);
    close_socket(fd);
    return ok;
}
