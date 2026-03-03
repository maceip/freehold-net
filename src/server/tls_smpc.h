#ifndef TLS_SMPC_H__
#define TLS_SMPC_H__

#include <wolfssl/options.h>
#include <wolfssl/ssl.h>
#include <emp-zk/emp-zk.h>
#include <emp-tool/emp-tool.h>
#include <vector>
#include <iostream>
#include <stdexcept>

using namespace emp;
using namespace std;

extern NetIO* cluster_ios[5]; 
extern int current_party;

struct MPC_TLS_Session {
    block master_secret_share[3]; // 48 bytes
    block client_write_key_share[1]; // 16 bytes
    block server_write_key_share[1];
    uint64_t sequence_number = 0;
} global_tls_session;

int WolfSSL_Handshake_Key_Revelation_Callback(WOLFSSL* ssl, void* ctx) {
    unsigned char master_secret[48];
    
#ifdef WOLFSSL_ALLOW_INTERNAL_ACCESS
    WOLFSSL_SESSION* sess = wolfSSL_get1_session(ssl);
    if (!sess) return -1;
    memcpy(master_secret, sess->masterSecret, 48);
    wolfSSL_SESSION_free(sess);
#else
    byte* ms = NULL;
    word32 msLen = 0;
    int ret = wolfSSL_get_keys(ssl, NULL, NULL, &ms, &msLen, NULL, NULL);
    if (ret != WOLFSSL_SUCCESS || msLen != 48) {
        throw std::runtime_error("wolfSSL Key Extraction Failed.");
    }
    memcpy(master_secret, ms, 48);
#endif
    
    // M4 FIX: Adaptive N based on current cluster epoch
    int N = std::getenv("MPC_NODE_COUNT") ? std::stoi(std::getenv("MPC_NODE_COUNT")) : 5;
    unsigned char shares[16][48]; // Max support 16 nodes
    PRG share_prg;
    
    for (int i = 0; i < 48; i++) {
        unsigned char current_xor = master_secret[i];
        for (int j = 1; j < N; j++) {
            share_prg.random_data(&shares[j][i], 1);
            current_xor ^= shares[j][i];
        }
        shares[0][i] = current_xor;
    }
    
    if (current_party == ALICE) { 
        for (int j = 1; j < N; j++) {
            if (cluster_ios[j]) {
                cluster_ios[j]->send_data(shares[j], 48);
                cluster_ios[j]->flush();
            }
        }
        memcpy(global_tls_session.master_secret_share, shares[0], 48);
    } else {
        if (cluster_ios[current_party]) {
            cluster_ios[current_party]->recv_data(global_tls_session.master_secret_share, 48);
        }
    }
    
    Hash hash;
    char digest[Hash::DIGEST_SIZE];
    hash.put(global_tls_session.master_secret_share, 48);
    hash.digest(digest);
    
    memcpy(global_tls_session.client_write_key_share, digest, 16);
    memcpy(global_tls_session.server_write_key_share, digest + 16, 16);

    cout << "[TLS-SMPC] Joint Application Keys Derived Successfully." << endl;
    return 0; 
}

template<typename IO>
void JesseQ_TLS_Encrypt(ZKProver<IO>* prover, const uint8_t* plaintext, uint8_t* ciphertext, int len) {
    BristolFormat cf("reference/JesseQ/JQv1/test/bool/AES-non-expanded.txt");
    
    ciphertext[0] = 23; 
    ciphertext[1] = 0x03; 
    ciphertext[2] = 0x03;
    ciphertext[3] = (len >> 8) & 0xFF;
    ciphertext[4] = len & 0xFF;
    
    block* key_bits = new block[128];
    bool key_bools[128];
    for(int i=0; i<16; i++) {
        uint8_t byte_val = ((uint8_t*)global_tls_session.client_write_key_share)[i];
        for(int b=0; b<8; b++) key_bools[i*8+b] = (byte_val >> b) & 1;
    }
    prover->feed(key_bits, ALICE, key_bools, 128); 
    
    for (int i = 0; i < len; i += 16) {
        block nonce_counter = makeBlock(global_tls_session.sequence_number, i / 16);
        block* pt_bits = new block[128];
        bool pt_bools[128];
        uint64_t* nc_ptr = (uint64_t*)&nonce_counter;
        for(int b=0; b<128; b++) {
            pt_bools[b] = (b < 64) ? (nc_ptr[0] >> b & 1) : (nc_ptr[1] >> (b-64) & 1);
        }
        
        prover->feed(pt_bits, ALICE, pt_bools, 128);
        block* ct_bits = new block[128];
        cf.compute(ct_bits, key_bits, pt_bits); 
        global_tls_session.sequence_number++;
        
        bool ct_result[128];
        prover->reveal(ct_result, PUBLIC, ct_bits, 128);
        
        if (current_party == ALICE) {
            for (int b = 0; b < 16 && (i + b) < len; b++) {
                uint8_t byte_val = 0;
                for (int bit = 0; bit < 8; bit++) byte_val |= (ct_result[b * 8 + bit] << bit);
                ciphertext[5 + i + b] = plaintext[i + b] ^ byte_val;
            }
        }
        delete[] pt_bits; delete[] ct_bits;
    }
    delete[] key_bits;
}

#endif // TLS_SMPC_H__
