import secrets
import base64
import hashlib
from typing import List, Tuple

"""
Modern MPCAuth 2026 Sharding (Threshold + LLSS Foundations)
Hardened with secrets module and dynamic length handling.
"""

class ThresholdSharder:
    def __init__(self, threshold: int, total_nodes: int):
        self.t = threshold
        self.n = total_nodes
        # Use a large prime (Mersenne prime 2^521 - 1)
        self.prime = 2**521 - 1 

    def shard_secret(self, secret_bytes: bytes, epoch: int = 1) -> dict:
        secret_int = int.from_bytes(secret_bytes, 'big')
        # Use cryptographically secure PRNG for polynomial coefficients
        coeffs = [secret_int] + [secrets.randbits(521) % self.prime for _ in range(self.t - 1)]
        
        shards = []
        for i in range(1, self.n + 1):
            y = 0
            for degree, coeff in enumerate(coeffs):
                y = (y + coeff * pow(i, degree, self.prime)) % self.prime
            shards.append({
                "node_id": i,
                "epoch": epoch,
                "shard": hex(y)
            })
        return {
            "shards": shards,
            "length": len(secret_bytes),
            "threshold": self.t,
            "total_nodes": self.n
        }

    def reconstruct_secret(self, node_shards: List[Tuple[int, int]], original_len: int) -> bytes:
        # Lagrange Interpolation at x=0
        secret = 0
        for i in range(len(node_shards)):
            xi, yi = node_shards[i]
            li = 1
            for j in range(len(node_shards)):
                if i == j: continue
                xj, _ = node_shards[j]
                num = (0 - xj) % self.prime
                den = (xi - xj) % self.prime
                li = (li * num * pow(den, -1, self.prime)) % self.prime
            secret = (secret + yi * li) % self.prime
        
        return secret.to_bytes(original_len, 'big')

def enroll_email(email: str, n: int = 5):
    sharder = ThresholdSharder(3, n)
    result = sharder.shard_secret(email.encode('utf-8'))
    return result

def reconstruct_email(shards_hex: List[str], email_length: int):
    sharder = ThresholdSharder(3, len(shards_hex))
    node_shards = []
    # Use first T shards for reconstruction
    for i, h in enumerate(shards_hex[:3]):
        node_shards.append((i + 1, int(h, 16)))
    reconstructed_bytes = sharder.reconstruct_secret(node_shards, original_len=email_length)
    return reconstructed_bytes.decode('utf-8')
