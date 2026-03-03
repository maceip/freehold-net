# OpenPetition

An early proof-of-concept for a privacy-preserving petition system. Signers prove corporate-email ownership through zero-knowledge MPC — no server ever sees the plaintext address. This is pre-production research code; expect rough edges.

## Quickstart

```bash
bash quickstart.sh
```

The script checks prerequisites, builds the C++ MPC server, starts two MPC
nodes and the SMTP forwarder in the background, then launches node

## How It Works

A user wants to sign a petition and prove they hold a corporate email — without revealing that email to anyone. The system coordinates four protocols across a cluster of MPC nodes:

```
┌─────────────┐         ┌─────────────┐
│  MPC Node 1 │◄───────►│  MPC Node 2 │    C++ / EMP-ZK + LLSS
│  (party=1)  │  OT/ZK  │  (party=2)  │    Port 5871
└──────┬──────┘         └──────┬──────┘
       │                       │
       └───────────┬───────────┘
                   │ mTLS
          ┌────────▼────────┐
          │    Forwarder    │               Python / asyncio
          │  (SMTP bridge)  │               Port 5870
          └────────┬────────┘
                   │ HTTPS
          ┌────────▼────────┐
          │   Web Client    │               Vite / TypeScript
          │   (browser UI)  │               Port 5173
          └─────────────────┘
```

### 1. Threshold Secret Sharing (Shamir)

The signer's email is split into shares using Shamir's Secret Sharing over a
Mersenne prime field (2^521 - 1). Each MPC node stores one share; no single
node can reconstruct the email. The threshold is configurable (default: 3-of-5).

**Implementation:** `src/client/sharding.py` — `ThresholdSharder`

### 2. JesseQ Zero-Knowledge Proofs (EMP-ZK)

When the cluster needs to jointly send a verification email, it uses EMP-ZK
circuits (oblivious transfer + garbled circuits) to prove that the encrypted
SMTP payload was computed correctly — without revealing the plaintext to any
party. The forwarder verifies these proofs before relaying to the mail server.

**Implementation:** `src/server/mpcauth_server.cpp`, `reference/JesseQ/`

### 3. LLSS Delayed Resharding

When nodes join or leave the cluster, the signing key and email shares must be
re-leveled to the new topology without ever materializing the secret. LLSS
(Locality-preserving Lightweight Secret Sharing) handles this resharding across
BFT epoch transitions.

**Implementation:** `src/server/llss_mpc.h`, `reference/LLSS-MPC/`

### 4. Mutual-TLS SMTP Forwarding

The forwarder bridges MPC-encrypted payloads to real SMTP servers. It enforces
mutual TLS (TLS 1.3) between itself and the MPC nodes, verifies JesseQ proof
payloads including HMAC signatures and chunk commitments, then proxies the
decrypted stream to the mail server over STARTTLS.

**Implementation:** `src/server/forwarder.py`, `src/server/tls_smpc.h`

## Project Structure

```
src/
├── server/
│   ├── mpcauth_server.cpp   # MPC node entry point (EMP-ZK + LLSS)
│   ├── tls_smpc.h           # TLS 1.3 session layer (wolfSSL)
│   ├── llss_mpc.h           # LLSS delayed-resharding protocol
│   ├── smtp_mpc.h           # SMTP-over-MPC encryption
│   ├── forwarder.py         # Proof-verifying SMTP forwarder
│   └── CMakeLists.txt       # cmake build config
├── client/                  # Shamir sharding library
├── web-client/              # Vite + TypeScript browser UI
├── demo_e2e.py              # End-to-end demo script
├── send_mail.py             # Standalone SMTP sender
└── validate_resharding.py   # Resharding validation
reference/
├── JesseQ/                  # EMP-ZK circuit definitions
└── LLSS-MPC/                # LLSS resharding reference
```

## Development

```bash
make lint    # Run all linters (biome, ruff, clang-format)
make fmt     # Auto-format all code
make check   # Lint + format-check (CI-friendly, no writes)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLUSTER_BFT_EPOCH` | `1` | BFT consensus epoch number |
| `MPC_NODE_COUNT` | `5` | Number of MPC nodes in the cluster |
| `MPC_SMTP_USER` | — | SMTP username for mail forwarding |
| `MPC_SMTP_PASS` | — | SMTP password for mail forwarding |
| `MPC_SMTP_SERVER` | `mail.stare.network` | SMTP server hostname |
| `MPC_SMTP_PORT` | `587` | SMTP server port |
| `MPC_CIRCUIT_PATH` | `reference/JesseQ/...` | Path to ZK circuit file |
| `MPC_CLUSTER_KEY` | `cluster_verify.key` | HMAC key for cluster verification |
| `FORWARDER_CERT` | `certs/forwarder.crt` | Forwarder mTLS certificate |
| `FORWARDER_KEY` | `certs/forwarder.key` | Forwarder mTLS private key |
| `CLUSTER_CA` | `certs/cluster_ca.crt` | Cluster CA certificate |
| `ALLOW_INSECURE_FORWARDER` | — | Set to `true` to skip mTLS (dev only) |
| `LLSS_IP_PREV` | — | IP of previous LLSS ring node |
| `LLSS_IP_NEXT` | — | IP of next LLSS ring node |

## License

TBD
