#ifndef SMTP_CLIENT_H__
#define SMTP_CLIENT_H__

#include <string>

struct SmtpConfig {
    std::string host;
    int port = 25;
    std::string from = "noreply@freehold.local";
    std::string to;
    std::string user;
    std::string pass;
    bool starttls = true;
};

struct VerificationPayload {
    std::string nullifier_hex;   // 64-char hex SHA-256
    std::string petition_ref;    // e.g. "DEMO-001"
    int epoch = 1;
};

// Send a verification email via SMTP after MPC identity proof.
// Returns true on 250 acceptance, false on any error.
bool send_verification_email(const SmtpConfig& cfg, const VerificationPayload& payload);

#endif // SMTP_CLIENT_H__
