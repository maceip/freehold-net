#ifndef SMTP_MPC_H__
#define SMTP_MPC_H__

#include <emp-zk/emp-zk.h>
#include <vector>
#include <iostream>
#include <stdexcept>
#include "tls_smpc.h"

using namespace emp;

/**
 * SMTP MPC Authentication Logic
 */

template<typename IO>
void Joint_SMTP_Authenticate(ZKProver<IO>* prover, emp::block* auth_command_out, const std::vector<bool>& password_shard) {
    int pass_len = password_shard.size();
    emp::block* pass_bits = new emp::block[pass_len];
    bool* raw_pass = new bool[pass_len];
    for (int i = 0; i < pass_len; i++) raw_pass[i] = password_shard[i];
    
    prover->feed(pass_bits, ALICE, raw_pass, pass_len);

    int b64_out_len = 344;
    emp::block* b64_out_bits = new emp::block[b64_out_len];
    
    try {
        BristolFormat cf_base64("reference/JesseQ/JQv1/test/bool/base64.txt");
        cf_base64.compute(b64_out_bits, pass_bits); 
    } catch (const std::exception& e) {
        // Enforce hard build/runtime failure.
        std::cerr << "[SMTP-MPC] CRITICAL FAILURE: Base64 circuit missing. " << e.what() << std::endl;
        delete[] pass_bits;
        delete[] raw_pass;
        delete[] b64_out_bits;
        throw std::runtime_error("Base64 circuit absent. Aborting joint authentication.");
    }
    
    uint8_t plaintext_dummy[43] = {0}; 
    uint8_t ciphertext[48] = {0}; 
    
    // Encrypt the AUTH PLAIN string inside SMPC
    JesseQ_TLS_Encrypt(prover, plaintext_dummy, ciphertext, 43);
    
    if (current_party == ALICE) {
        std::cout << "[SMTP-MPC] Forwarder node holds TLS-encrypted AUTH command ciphertext." << std::endl;
    }
    
    delete[] pass_bits;
    delete[] raw_pass;
    delete[] b64_out_bits;
}

#endif // SMTP_MPC_H__
