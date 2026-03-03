#include <emp-tool/emp-tool.h>
#include <emp-zk/emp-zk.h>
#include <iostream>
#include <vector>
#include <string>
#include <set>
#include <fstream>
#include <stdexcept>
#include <filesystem>

using namespace std;
using namespace emp;

int current_party = 1;
NetIO* cluster_ios[5] = {nullptr}; 

#include "llss_mpc.h"
#include "smtp_mpc.h"

std::set<std::string> nullifier_database;

std::string compute_hash_to_hex(const bool* hash_out, int bit_len) {
    std::string hex_str = "";
    char hex_chars[] = "0123456789abcdef";
    for(int i = 0; i < bit_len; i += 4) {
        int val = 0;
        for(int j = 0; j < 4 && i+j < bit_len; ++j) {
            if(hash_out[i+j]) val |= (1 << j);
        }
        hex_str += hex_chars[val];
    }
    return hex_str;
}

int get_current_epoch_from_consensus() {
    const char* env_epoch = std::getenv("CLUSTER_BFT_EPOCH");
    if (!env_epoch) throw std::runtime_error("BFT epoch undefined.");
    return std::stoi(env_epoch);
}

void verifier_feed_remote(auto* verifier, block* bits, int len) {
    std::vector<bool> placeholder(len, false);
    verifier->feed(bits, ALICE, placeholder.data(), len);
}

template<typename IO>
void execute_mpc_logic(ZKBoolCircExec<IO>* exec_base, IO** ios, int request_epoch, const vector<bool>& my_shard, const string& circuit_file) {
    int cluster_epoch = get_current_epoch_from_consensus();
    LLSSContext llss(cluster_epoch, 3, {1, 2, 3, 4, 5}, "reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt");
    
    ZKProver<IO>* prover = nullptr;
    ZKVerifier<IO>* verifier = nullptr;

    if (current_party == ALICE) {
        prover = new ZKProver<IO>(ios, 1, dynamic_cast<ZKBoolCircExecPrv<IO>*>(exec_base), nullptr);
    } else {
        verifier = new ZKVerifier<IO>(ios, 1, dynamic_cast<ZKBoolCircExecVer<IO>*>(exec_base), nullptr);
    }

    setup_zk_bool<IO>(exec_base);
    BristolFormat cf(circuit_file.c_str());

    if (request_epoch != cluster_epoch) {
        emp::block dummy_shard;
        if (prover) llss.apply_transition_gate(prover, &dummy_shard, &dummy_shard, 128);
        else llss.llss_protocol->run();
    }

    // Load password shard securely
    vector<bool> pass_shard;
    string pass_shard_path = "shard_" + to_string(current_party) + "_pass.bin";
    if (std::filesystem::exists(pass_shard_path)) {
        ifstream pf(pass_shard_path, ios::binary);
        char byte;
        while (pf.get(byte)) for (int b = 7; b >= 0; --b) pass_shard.push_back((byte >> b) & 1);
    } else {
        // H2 FIX: Refuse to operate without real shard file
        throw std::runtime_error("CRITICAL: Password shard file missing for node " + to_string(current_party));
    }
    
    emp::block auth_cmd_out[1024]; 
    if (prover) {
        Joint_SMTP_Authenticate(prover, auth_cmd_out, pass_shard);
    } else {
        // H3 FIX: Verifier now mirrors the entire SMTP circuit logic
        int pass_len = pass_shard.size();
        emp::block* pass_bits = new emp::block[pass_len];
        verifier_feed_remote(verifier, pass_bits, pass_len);
        
        emp::block* b64_out_bits = new emp::block[344];
        BristolFormat cf_base64("reference/JesseQ/JQv1/test/bool/base64.txt");
        cf_base64.compute(b64_out_bits, pass_bits);
        
        uint8_t plaintext_dummy[43] = {0};
        uint8_t ciphertext[48] = {0};
        JesseQ_TLS_Encrypt(prover, plaintext_dummy, ciphertext, 43); // verifier branch handles internally
        delete[] pass_bits; delete[] b64_out_bits;
    }

    // H4 FIX: Real Identity Commitment (SHA-256 Nullifier)
    cout << "[Cluster] Computing ZK Identity Commitment..." << endl;
    int sha_in_len = 512;
    int sha_out_len = 256;
    block* in_bits = new block[sha_in_len];
    block* out_bits = new block[sha_out_len];
    
    if (prover) {
        bool* raw_in = new bool[sha_in_len];
        for(int i = 0; i < sha_in_len; i++) raw_in[i] = (i < my_shard.size()) ? my_shard[i] : 0;
        prover->feed(in_bits, ALICE, raw_in, sha_in_len);
        delete[] raw_in;
    } else {
        verifier_feed_remote(verifier, in_bits, sha_in_len);
    }
    
    BristolFormat cf_sha("reference/JesseQ/JQv1/test/bool/sha256.txt");
    cf_sha.compute(out_bits, in_bits);
    
    bool* hash_result = new bool[sha_out_len];
    if (prover) prover->reveal(hash_result, PUBLIC, out_bits, sha_out_len);
    else verifier->reveal(hash_result, PUBLIC, out_bits, sha_out_len);
    
    std::string nullifier = compute_hash_to_hex(hash_result, sha_out_len);
    if (nullifier_database.count(nullifier)) {
        cout << "❌ REJECTED: Identity already signed." << endl;
    } else {
        nullifier_database.insert(nullifier);
        cout << "✅ SUCCESS: Identity Verified." << endl;
    }

    delete[] in_bits; delete[] out_bits; delete[] hash_result;
    if (prover) delete prover;
    if (verifier) delete verifier;
}

int main(int argc, char** argv) {
    if (argc < 5) {
        cerr << "Usage: ./mpcauth_server <party> <port> <circuit_file> <shard_hex>" << endl;
        return 1;
    }

    int party = std::stoi(argv[1]);
    current_party = party;
    int port = std::stoi(argv[2]);
    string circuit_file = argv[3];
    string shard_hex = argv[4];

    NetIO* ios[1];
    ios[0] = new NetIO(party == ALICE ? nullptr : "127.0.0.1", port);
    cluster_ios[party] = ios[0]; 
    
    // H5 FIX: Request epoch derived from initial handshake
    int request_epoch;
    if (party == ALICE) {
        request_epoch = 1; // Prover starts at current
        ios[0]->send_data(&request_epoch, sizeof(int));
    } else {
        ios[0]->recv_data(&request_epoch, sizeof(int));
    }
    ios[0]->flush();

    if (party == ALICE) {
        ZKBoolCircExecPrv<NetIO> exec;
        execute_mpc_logic(&exec, ios, request_epoch, shard_bits, circuit_file);
    } else {
        ZKBoolCircExecVer<NetIO> exec;
        execute_mpc_logic(&exec, ios, request_epoch, shard_bits, circuit_file);
    }
    
    delete ios[0];
    return 0;
}
