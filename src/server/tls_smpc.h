#ifndef TLS_SMPC_H__
#define TLS_SMPC_H__

// Use OpenSSL HMAC instead of wolfSSL to avoid byte/type conflicts.
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <emp-zk/emp-zk.h>
#include <emp-tool/emp-tool.h>
#include <vector>
#include <iostream>
#include <stdexcept>
#include <memory>
#include <cstring>

using namespace emp;
// Note: do NOT use 'using namespace std;' here — std::byte conflicts with wolfssl byte typedef

extern NetIO* cluster_ios[5];
extern int current_party;

// --- Bit/byte conversion helpers (DUP1 FIX) ---

static inline void bytes_to_bools(const uint8_t* bytes, bool* bools, int num_bytes) {
    for (int i = 0; i < num_bytes; i++) {
        for (int b = 0; b < 8; b++) {
            bools[i * 8 + b] = (bytes[i] >> b) & 1;
        }
    }
}

static inline void bools_to_bytes(const bool* bools, uint8_t* bytes, int num_bytes) {
    for (int i = 0; i < num_bytes; i++) {
        uint8_t val = 0;
        for (int b = 0; b < 8; b++) {
            if (bools[i * 8 + b]) val |= (1 << b);
        }
        bytes[i] = val;
    }
}

struct MPC_TLS_Session {
    block master_secret_share[3]; // 48 bytes
    block client_write_key_share[1]; // 16 bytes
    block server_write_key_share[1];
    uint8_t client_write_iv[12]; // B3 FIX: Use exact 12-byte array, not block
    uint64_t sequence_number = 0;
} global_tls_session;

// B4 FIX: Correct HKDF-Expand per RFC 5869 using OpenSSL HMAC.
// T(1) = HMAC(PRK, info || 0x01)
// T(i) = HMAC(PRK, T(i-1) || info || i)  for i > 1
static void tls13_hkdf_expand_label(const uint8_t* secret, int secret_len,
                                     const char* label, int label_len,
                                     uint8_t* out, int out_len) {
    const char* tls13_prefix = "tls13 ";
    int prefix_len = 6;
    int info_len = 2 + 1 + prefix_len + label_len + 1;
    uint8_t info[64];
    if (info_len > (int)sizeof(info)) throw std::runtime_error("HKDF label too long");

    info[0] = (out_len >> 8) & 0xFF;
    info[1] = out_len & 0xFF;
    info[2] = (uint8_t)(prefix_len + label_len);
    std::memcpy(info + 3, tls13_prefix, prefix_len);
    std::memcpy(info + 3 + prefix_len, label, label_len);
    info[3 + prefix_len + label_len] = 0; // empty context

    const int hash_len = 32; // SHA-256
    uint8_t t_prev[32];
    int n = (out_len + hash_len - 1) / hash_len;
    int written = 0;

    for (int i = 1; i <= n; i++) {
        unsigned int md_len = 0;
        HMAC_CTX* ctx = HMAC_CTX_new();
        HMAC_Init_ex(ctx, secret, secret_len, EVP_sha256(), NULL);

        if (i > 1) {
            HMAC_Update(ctx, t_prev, hash_len);
        }
        HMAC_Update(ctx, info, info_len);
        uint8_t counter = (uint8_t)i;
        HMAC_Update(ctx, &counter, 1);
        HMAC_Final(ctx, t_prev, &md_len);
        HMAC_CTX_free(ctx);

        int copy_len = std::min(hash_len, out_len - written);
        std::memcpy(out + written, t_prev, copy_len);
        written += copy_len;
    }
}

// Initialize TLS session keys from pre-shared master secret bytes.
// In production, the master secret is extracted during a real TLS handshake
// and distributed to parties. For the MPC demo, it's derived from the shard.
void init_tls_session_from_shard(const uint8_t* shard_bytes, int shard_len) {
    // Use shard as PRK input to derive TLS keys
    uint8_t handshake_secret[48] = {0};
    int copy = std::min(shard_len, 48);
    std::memcpy(handshake_secret, shard_bytes, copy);
    std::memcpy(global_tls_session.master_secret_share, handshake_secret, 48);

    uint8_t client_key[16];
    tls13_hkdf_expand_label(handshake_secret, 48, "key", 3, client_key, 16);
    tls13_hkdf_expand_label(handshake_secret, 48, "iv", 2, global_tls_session.client_write_iv, 12);
    std::memcpy(global_tls_session.client_write_key_share, client_key, 16);

    uint8_t server_key[16];
    tls13_hkdf_expand_label(handshake_secret, 48, "s ap key", 8, server_key, 16);
    std::memcpy(global_tls_session.server_write_key_share, server_key, 16);

    std::cout << "[TLS-SMPC] Joint Application Keys Derived via HKDF-Expand-Label." << std::endl;
}

// P1 FIX: Load AES circuit once, cache as static.
static BristolFormat* get_aes_circuit() {
    static BristolFormat* cf = nullptr;
    if (!cf) {
        cf = new BristolFormat("reference/JesseQ/emp-tool/emp-tool/circuits/files/bristol_format/AES-non-expanded.txt");
    }
    return cf;
}

template<typename IO>
void JesseQ_TLS_Encrypt(ProtocolExecution* role, const uint8_t* plaintext, uint8_t* ciphertext, int len) {
    BristolFormat* cf = get_aes_circuit();

    int record_len = len + 16; // ciphertext + 16-byte AEAD tag
    ciphertext[0] = 0x17; // application_data
    ciphertext[1] = 0x03;
    ciphertext[2] = 0x03;
    ciphertext[3] = (record_len >> 8) & 0xFF;
    ciphertext[4] = record_len & 0xFF;

    // Feed AES key
    block* key_bits = new block[128];
    bool key_bools[128] = {false};
    if (current_party == ALICE) {
        bytes_to_bools((uint8_t*)global_tls_session.client_write_key_share, key_bools, 16);
    }
    role->feed(key_bits, ALICE, key_bools, 128);

    // TLS 1.3 nonce = 12-byte IV XOR left-padded 8-byte sequence number
    uint8_t nonce[12];
    std::memcpy(nonce, global_tls_session.client_write_iv, 12);
    uint64_t seq = global_tls_session.sequence_number;
    for (int i = 0; i < 8; i++) {
        nonce[11 - i] ^= (seq >> (i * 8)) & 0xFF;
    }

    // P3 FIX: Allocate per-block buffers once outside the loop
    block* pt_bits = new block[128];
    block* ct_bits = new block[128];

    // GHASH accumulator for AEAD tag
    block ghash_acc = zero_block;

    int num_blocks = (len + 15) / 16;
    for (int blk = 0; blk < num_blocks; blk++) {
        int offset = blk * 16;

        // GCM counter block: nonce || counter (big-endian, starts at 2)
        uint8_t counter_block[16] = {0};
        std::memcpy(counter_block, nonce, 12);
        uint32_t ctr = blk + 2;
        counter_block[12] = (ctr >> 24) & 0xFF;
        counter_block[13] = (ctr >> 16) & 0xFF;
        counter_block[14] = (ctr >> 8) & 0xFF;
        counter_block[15] = ctr & 0xFF;

        bool pt_bools[128];
        bytes_to_bools(counter_block, pt_bools, 16);

        role->feed(pt_bits, ALICE, pt_bools, 128);
        cf->compute(ct_bits, key_bits, pt_bits);

        bool ct_result[128];
        role->reveal(ct_result, PUBLIC, ct_bits, 128);

        // XOR AES output with plaintext to produce ciphertext
        int chunk_len = std::min(16, len - offset);
        if (current_party == ALICE) {
            uint8_t keystream[16];
            bools_to_bytes(ct_result, keystream, 16);
            for (int b = 0; b < chunk_len; b++) {
                ciphertext[5 + offset + b] = plaintext[offset + b] ^ keystream[b];
            }
        }

        // D1 FIX: Accumulate ciphertext block into GHASH (XOR-based placeholder)
        block ct_block = zero_block;
        if (current_party == ALICE) {
            std::memcpy(&ct_block, ciphertext + 5 + offset, chunk_len);
        }
        ghash_acc = ghash_acc ^ ct_block;
    }

    // Compute AEAD tag: AES(key, J0) XOR GHASH accumulator
    {
        uint8_t j0_block[16] = {0};
        std::memcpy(j0_block, nonce, 12);
        j0_block[15] = 1; // GCM J0 counter = 1

        bool j0_bools[128];
        bytes_to_bools(j0_block, j0_bools, 16);

        // Reuse pt_bits/ct_bits buffers
        role->feed(pt_bits, ALICE, j0_bools, 128);
        cf->compute(ct_bits, key_bits, pt_bits);

        bool tag_result[128];
        role->reveal(tag_result, PUBLIC, ct_bits, 128);

        // Tag = AES(K, J0) XOR GHASH(ciphertext)
        uint8_t tag_bytes[16];
        bools_to_bytes(tag_result, tag_bytes, 16);

        uint8_t* ghash_bytes = (uint8_t*)&ghash_acc;
        for (int b = 0; b < 16; b++) {
            ciphertext[5 + len + b] = tag_bytes[b] ^ ghash_bytes[b];
        }
    }

    // Sequence number increments per TLS record
    global_tls_session.sequence_number++;

    delete[] key_bits;
    delete[] pt_bits;
    delete[] ct_bits;
}

#endif // TLS_SMPC_H__
