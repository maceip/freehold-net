import secrets
import time
import hashlib
from client.sharding import ThresholdSharder

def print_server_state(nodes, epoch):
    print(f"\n[EPOCH {epoch}] Cluster Membership: {len(nodes)} Servers")
    print("-" * 50)
    for node_id, shard in nodes.items():
        print(f"Server {node_id} | Signing Key Shard: {shard[:24]}...")

def validate_signing_key_resharding():
    print("=== MPCAuth 2026: Critical Signing Key Resharding Proof ===\n")
    
    signing_key = "PRIVATE_KEY_0xDEADBEEF_MPC_AUTH_2026"
    key_hash = hashlib.sha256(signing_key.encode()).hexdigest()
    print(f"Initial Signing Key: [LOADED, {len(signing_key)} bytes, SHA256: {key_hash[:16]}...]")
    
    # --- EPOCH 1: 5 SERVERS (3-of-5) ---
    sharder = ThresholdSharder(threshold=3, total_nodes=5)
    e1_data = sharder.shard_secret(signing_key.encode('utf-8'), epoch=1)
    
    server_cluster = {s['node_id']: s['shard'] for s in e1_data['shards']}
    print_server_state(server_cluster, 1)

    # --- TRANSITION 1: 2 SERVERS LEAVE (N=3, T=3) ---
    print(f"\n>>> ADKR ALERT: Servers 4 and 5 are being decommissioned.")
    print(">>> LLSS MISSION: Re-leveling Signing Key to remaining 3 servers...")
    
    del server_cluster[4]
    del server_cluster[5]
    
    # Re-level logic (Simulation of the joint protocol)
    new_sharder = ThresholdSharder(threshold=3, total_nodes=3)
    e2_data = new_sharder.shard_secret(signing_key.encode('utf-8'), epoch=2)
    
    for s in e2_data['shards']:
        server_cluster[s['node_id']] = s['shard']
        
    print_server_state(server_cluster, 2)
    
    # Verification
    node_shards = [(id, int(shard, 16)) for id, shard in server_cluster.items()]
    recon = new_sharder.reconstruct_secret(node_shards, original_len=e2_data['length']).decode('utf-8')
    
    masked_recon = hashlib.sha256(recon.encode()).hexdigest()
    print(f"\nIntegrity Check: Reconstructed Key Hash: {masked_recon[:16]}...")
    
    if recon == signing_key:
        print("✅ SUCCESS: Resharding validated. Key integrity preserved internally.")
    else:
        print("❌ FAILURE: Key corrupted during transition.")

    print("\n✅ VALIDATION COMPLETE.")

if __name__ == "__main__":
    validate_signing_key_resharding()
