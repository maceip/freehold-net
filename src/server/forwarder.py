import socket
import sys
import asyncio
import ssl
import json
import logging
import hmac
import hashlib
import os

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')

class JesseQProofVerifier:
    def __init__(self, circuit_path: str, cluster_hmac_key_path: str):
        if not os.path.exists(circuit_path):
            raise RuntimeError(f"Circuit file missing: {circuit_path}")
            
        with open(circuit_path, 'rb') as f:
            self.expected_circuit_hash = hashlib.sha256(f.read()).hexdigest()

        # Load the cluster-wide HMAC key for verification
        if not os.path.exists(cluster_hmac_key_path):
            # H1 FIX: Refuse to start without secure key
            raise RuntimeError(f"HMAC key file missing: {cluster_hmac_key_path}. Cannot start forwarder.")
            
        with open(cluster_hmac_key_path, 'rb') as f:
            self.cluster_key = f.read()

        logging.info(f"Verifier initialized with circuit hash: {self.expected_circuit_hash}")

    def verify_proof(self, ciphertext: bytes, proof_payload: dict) -> bool:
        try:
            circuit_hash = proof_payload.get('circuit_hash')
            commitments = proof_payload.get('commitments', [])
            signature = bytes.fromhex(proof_payload.get('signature', ''))

            if circuit_hash != self.expected_circuit_hash:
                logging.error("Circuit hash mismatch.")
                return False

            if not commitments or not signature:
                logging.error("Missing commitments or signature.")
                return False

            # H9 FIX: Real HMAC signature verification
            msg = ciphertext + circuit_hash.encode('utf-8')
            expected_mac = hmac.new(self.cluster_key, msg, hashlib.sha256).digest()

            if not hmac.compare_digest(signature, expected_mac):
                logging.error("HMAC signature verification failed.")
                return False

            # Verify chunk commitments
            chunk_size = len(ciphertext) // max(len(commitments), 1)
            for i, commitment in enumerate(commitments):
                chunk = ciphertext[i * chunk_size : (i + 1) * chunk_size]
                expected = hashlib.sha256(chunk + self.cluster_key).hexdigest()
                if commitment != expected:
                    logging.error(f"Commitment {i} verification failed.")
                    return False

            logging.info("JesseQ proof verified successfully.")
            return True
        except Exception as e:
            logging.error(f"Proof verification exception: {e}")
            return False

class SMTPForwarder:
    def __init__(self, forwarder_host='127.0.0.1', forwarder_port=5870, smtp_host='smtp.gmail.com', smtp_port=587):
        self.forwarder_host = forwarder_host
        self.forwarder_port = forwarder_port
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        
        circuit = os.getenv("MPC_CIRCUIT_PATH", "reference/JesseQ/JQv1/test/bool/AES-non-expanded.txt")
        key = os.getenv("MPC_CLUSTER_KEY", "cluster_verify.key")
        self.verifier = JesseQProofVerifier(circuit, key)
        
        self.ssl_context = None
        cert = os.getenv("FORWARDER_CERT", "certs/forwarder.crt")
        key_file = os.getenv("FORWARDER_KEY", "certs/forwarder.key")
        ca = os.getenv("CLUSTER_CA", "certs/cluster_ca.crt")

        if os.path.exists(cert) and os.path.exists(key_file) and os.path.exists(ca):
            self.ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            self.ssl_context.load_cert_chain(certfile=cert, keyfile=key_file)
            self.ssl_context.load_verify_locations(cafile=ca)
            self.ssl_context.verify_mode = ssl.CERT_REQUIRED
            self.ssl_context.minimum_version = ssl.TLSVersion.TLSv1_3
            logging.info("Mutual TLS enabled.")
        else:
            # M2 FIX: Refuse to start without mTLS unless explicitly allowed
            if os.getenv("ALLOW_INSECURE_FORWARDER") != "true":
                raise RuntimeError("Mutual TLS credentials missing. Refusing to start in plaintext mode.")
            logging.warning("RUNNING IN INSECURE PLAINTEXT MODE.")

    async def handle_client(self, reader, writer):
        try:
            header_data = await reader.readuntil(b'\n\n')
            proof_payload = json.loads(header_data.decode('utf-8').strip())
            ciphertext = await reader.read(4096)
            
            if not self.verifier.verify_proof(ciphertext, proof_payload):
                writer.close()
                return

            smtp_reader, smtp_writer = await asyncio.open_connection(self.smtp_host, self.smtp_port)
            smtp_writer.write(ciphertext)
            await smtp_writer.drain()
            
            await asyncio.gather(
                self.forward_stream(reader, smtp_writer),
                self.forward_stream(smtp_reader, writer)
            )
        except Exception as e:
            logging.error(f"Handler error: {e}")
        finally:
            writer.close()

    async def forward_stream(self, reader, writer):
        try:
            while not reader.at_eof():
                data = await reader.read(4096)
                if not data: break
                writer.write(data)
                await writer.drain()
        except Exception: pass
        finally: writer.close()

    async def serve(self):
        server = await asyncio.start_server(
            self.handle_client, 
            self.forwarder_host, 
            self.forwarder_port,
            ssl=self.ssl_context
        )
        async with server: await server.serve_forever()

if __name__ == "__main__":
    forwarder = SMTPForwarder()
    asyncio.run(forwarder.serve())
