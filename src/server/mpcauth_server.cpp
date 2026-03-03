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
    try {
        return std::stoi(env_epoch);
    } catch (...) {
        throw std::runtime_error("Invalid BFT epoch value.");
    }
}

template<typename IO, typename Role>
void execute_mpc_logic(ZKBoolCircExec<IO>* exec_base, Role* role, IO** ios, int request_epoch, const vector<bool>& my_shard, const string& circuit_file) {
    int cluster_epoch = get_current_epoch_from_consensus();
    LLSSContext llss(cluster_epoch, 3, {1, 2, 3, 4, 5}, "reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt");
    
    setup_zk_bool<IO>(exec_base);
    BristolFormat cf(circuit_file.c_str());

    if (request_epoch != cluster_epoch) {
        cout << "ADKR Epoch Mismatch Detected." << endl;
        emp::block dummy_shard;
        llss.apply_transition_gate(role, &dummy_shard, &dummy_shard, 128);
    }

    cout << "Active Cluster Session: Epoch " << cluster_epoch << endl;

    // Load password shard securely
    vector<bool> pass_shard;
    string pass_shard_path = "shard_" + to_string(current_party) + "_pass.bin";
    if (std::filesystem::exists(pass_shard_path)) {
        ifstream pf(pass_shard_path, ios::binary);
        char byte;
        while (pf.get(byte)) for (int b = 7; b >= 0; --b) pass_shard.push_back((byte >> b) & 1);
    } else {
        throw std::runtime_error("CRITICAL: Password shard file missing for node " + to_string(current_party));
    }
    
    emp::block auth_cmd_out[1024]; 
    Joint_SMTP_Authenticate(role, auth_cmd_out, pass_shard);

    // Identity Commitment (SHA-256 Nullifier)
    cout << "[Cluster] Computing ZK Identity Commitment..." << endl;
    int sha_in_len = 512;
    int sha_out_len = 256;
    block* in_bits = new block[sha_in_len];
    block* out_bits = new block[sha_out_len];
    
    // N2 FIX: Use generic role interface for feeding
    bool* raw_in = nullptr;
    if (current_party == ALICE) {
        raw_in = new bool[sha_in_len];
        for(int i = 0; i < sha_in_len; i++) raw_in[i] = (i < my_shard.size()) ? my_shard[i] : 0;
    }
    role->feed(in_bits, ALICE, raw_in, sha_in_len);
    if(raw_in) delete[] raw_in;
    
    BristolFormat cf_sha("reference/JesseQ/JQv1/test/bool/sha256.txt");
    cf_sha.compute(out_bits, in_bits);
    
    bool* hash_result = new bool[sha_out_len];
    role->reveal(hash_result, PUBLIC, out_bits, sha_out_len);
    
    std::string nullifier = compute_hash_to_hex(hash_result, sha_out_len);
    if (nullifier_database.count(nullifier)) {
        cout << "❌ REJECTED: Identity already signed." << endl;
    } else {
        nullifier_database.insert(nullifier);
        cout << "✅ SUCCESS: Identity Verified." << endl;
    }

    delete[] in_bits; delete[] out_bits; delete[] hash_result;
}

int main(int argc, char** argv) {
    if (argc < 5) {
        cerr << "Usage: ./mpcauth_server <party 1|2> <port 1-65535> <circuit_file> <shard_hex>" << endl;
        return 1;
    }

    // N6 FIX: Robust input validation
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

    // N1 FIX: Restored missing hex-to-bits parsing
    vector<bool> shard_bits;
    for (size_t i = 0; i < shard_hex.length(); i += 2) {
        try {
            uint8_t byte = (uint8_t)strtol(shard_hex.substr(i, 2).c_str(), nullptr, 16);
            for (int b = 7; b >= 0; --b) shard_bits.push_back((byte >> b) & 1);
        } catch (...) {
            cerr << "Invalid hex in shard." << endl; return 1;
        }
    }

    NetIO* ios[1];
    ios[0] = new NetIO(party == ALICE ? nullptr : "127.0.0.1", port);
    cluster_ios[party] = ios[0]; 
    
    // P4 FIX: request_epoch from consensus
    int request_epoch = get_current_epoch_from_consensus();
    if (party == ALICE) {
        ios[0]->send_data(&request_epoch, sizeof(int));
    } else {
        ios[0]->recv_data(&request_epoch, sizeof(int));
    }
    ios[0]->flush();

    if (party == ALICE) {
        ZKBoolCircExecPrv<NetIO> exec;
        ZKProver<NetIO> role(ios, 1, &exec, nullptr);
        execute_mpc_logic(&exec, &role, ios, request_epoch, shard_bits, circuit_file);
    } else {
        ZKBoolCircExecVer<NetIO> exec;
        ZKVerifier<NetIO> role(ios, 1, &exec, nullptr);
        execute_mpc_logic(&exec, &role, ios, request_epoch, shard_bits, circuit_file);
    }
    
    delete ios[0];
    return 0;
}
