#ifndef LLSS_MPC_H__
#define LLSS_MPC_H__

#include "../../reference/LLSS-MPC/delayedresharing/Delayedresharing.h"
#include "../../reference/LLSS-MPC/Protocols/Protocols/Protocol.h"
#include "../../reference/LLSS-MPC/Protocols/Protocols/RSSParty.h"

#include <emp-zk/emp-zk.h>
#include <vector>
#include <iostream>
#include <stdexcept>
#include <memory>
#include <cstdlib>

using namespace emp;

extern int current_party;

/**
 * LLSS-MPC Level Transition & Integrity Module
 *
 * M5 FIX: apply_transition_gate accepts ProtocolExecution* (works for both ZKProver and ZKVerifier).
 * L2 FIX: Network IPs read from LLSS_IP_PREV / LLSS_IP_NEXT env vars.
 */

class LLSSContext {
public:
    int current_epoch;
    int threshold;
    std::vector<int> active_nodes;

    delayedresharing::Protocol* llss_protocol = nullptr;

    LLSSContext(int epoch, int t, std::vector<int> nodes, std::string circuit_file)
        : current_epoch(epoch), threshold(t), active_nodes(nodes) {

        // L2 FIX: Read network IPs from environment, with localhost fallback
        const char* env_prev = std::getenv("LLSS_IP_PREV");
        const char* env_next = std::getenv("LLSS_IP_NEXT");
        std::string ip_prev = env_prev ? env_prev : "127.0.0.1";
        std::string ip_next = env_next ? env_next : "127.0.0.1";

        llss_protocol = new delayedresharing::RSSParty<delayedresharing::BooleanValue>(
            current_party,
            circuit_file,
            ip_next,
            ip_prev
        );

        llss_protocol->setup(); // Will throw if network fails
    }

    ~LLSSContext() {
        if (llss_protocol) delete llss_protocol;
    }

    // M5 FIX: Templatized to accept ProtocolExecution* (both ZKProver and ZKVerifier)
    void apply_transition_gate(ProtocolExecution* role, emp::block* new_shard, const emp::block* old_shard, int len) {
        if (!llss_protocol) throw std::runtime_error("LLSS Protocol uninitialized");

        llss_protocol->run();

        // H4 FIX: Populate old_bits from old_shard blocks correctly
        std::unique_ptr<bool[]> old_bits(new bool[len]);
        for (int i = 0; i < len; ++i) {
            int block_idx = i / 128;
            int bit_idx = i % 128;
            uint64_t* ptr = (uint64_t*)&old_shard[block_idx];
            uint64_t val = (bit_idx < 64) ? ptr[0] : ptr[1];
            old_bits[i] = (val >> (bit_idx % 64)) & 1;
        }

        role->feed(new_shard, ALICE, old_bits.get(), len);

        current_epoch++;
        if (!active_nodes.empty()) active_nodes.pop_back();

        std::cout << "[LLSS-MPC] Epoch Advanced to " << current_epoch << std::endl;
    }
};

#endif // LLSS_MPC_H__
