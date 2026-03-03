import json
import os
import sys
import hashlib

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from client.sharding import enroll_email, reconstruct_email

class MockServer:
    def __init__(self, server_id):
        self.server_id = server_id
        self.storage = {} # username -> shard

    def receive_enrollment(self, username, shard):
        print(f"Server {self.server_id} received shard for {username}")
        self.storage[username] = shard

def run_enrollment_demo():
    username = "alice"
    email = "alice@example.com"
    num_servers = 5
    
    # 1. Enrollment (Fixed API: returns dict with length)
    print(f"Enrolling user: {username} with email: {email}")
    enrollment = enroll_email(email, num_servers)
    
    # 2. Distribution
    servers = [MockServer(i) for i in range(num_servers)]
    for i, shard_data in enumerate(enrollment['shards']):
        servers[i].receive_enrollment(username, shard_data['shard'])
    
    print("\nEnrollment completed. Verifying by reconstructing from shards...")
    
    # 3. Collection & Reconstruction (Fixed API: pass length)
    collected_shares = [servers[i].storage[username] for i in range(num_servers)]
    reconstructed = reconstruct_email(collected_shares, email_length=enrollment['length'])
    
    # Print hash for privacy (M1 alignment)
    recon_hash = hashlib.sha256(reconstructed.encode()).hexdigest()[:16]
    original_hash = hashlib.sha256(email.encode()).hexdigest()[:16]
    
    print(f"Reconstructed Hash: {recon_hash}...")
    
    if reconstructed == email:
        print("✅ SUCCESS: Enrollment verified.")
    else:
        print("❌ FAILURE: Reconstruction mismatch.")

if __name__ == "__main__":
    run_enrollment_demo()
