# OpenPetition MPCAuth - Gemini CLI Project Context

This project aims to modernize the **MPCAuth** distributed-trust authentication system. It transitions from the legacy **Flock** framework to a high-performance architecture based on **JesseQ**, **emp-zk**, and **wolfSSL**.

## Project Overview
The core goal is to implement a multi-factor authentication (MFA) system where sensitive user data (like email addresses) is never held by any single entity in plaintext. Instead, it is secret-shared across $N$ independent servers. These servers jointly execute cryptographic protocols to communicate with external infrastructure (like SMTP servers) without ever reconstructing the full secret locally.

### Key Technologies
- **JesseQ:** A 2025-optimized Zero-Knowledge Proof (ZKP) framework built on Vector-OLE (VOLE). It replaces the older AGMPC-based protocols for superior performance.
- **emp-toolkit / emp-zk:** The underlying cryptographic library suite for multi-party computation and ZKPs.
- **wolfSSL:** Used for TLS communication, specifically leveraging "handshake key revelation" to allow the MPC cluster to jointly perform TLS handshakes efficiently.
- **Python / C++:** The primary languages used for the orchestration (Python) and heavy cryptographic lifting (C++).

## Architecture
The system consists of four logical layers:
1. **Client Application:** Handles user enrollment by sharding email addresses and distributing them to the MPC servers.
2. **MPC Cluster ($N$ Servers):** Independent nodes that jointly perform computation using JesseQ. They behave as a single "logical client" to the outside world.
3. **Forwarder Node:** One of the MPC servers that handles the physical TCP connection to external services.
4. **External Infrastructure:** Standard, unmodified services (e.g., Gmail/SMTP) that receive TLS-encrypted traffic from the MPC cluster.

## Development Workflow

### Research & References
- **`./reference/flock`**: The legacy implementation (OSDI 2024). Contains the original `mpcauth` C++ code using `emp-agmpc`.
- **`./reference/JesseQ`**: The target framework (IEEE S&P 2025). Provides optimized VOLE-based ZKPs (`JQv1`, `JQv2`).
- **`./goal`**: Detailed requirements and technical specifications for the modernization.

### Key Tasks
- [ ] **Enrollment:** Port the sharding logic from `sharding_helper.py` to a modern client implementation.
- [ ] **JesseQ Integration:** Replace `emp-agmpc` calls with JesseQ `VOLE-ZK` primitives for bitwise logic (AES, SHA-256).
- [ ] **TLS-in-SMPC:** Implement the `wolfSSL` handshake revelation pipeline within the JesseQ execution environment.
- [ ] **SMTP Gateway:** Setup a forwarder that can transmit JesseQ-proven, TLS-encrypted packets to standard SMTP providers.

## Building & Running

### Prerequisites
- **Ubuntu** (recommended for JesseQ/emp-toolkit).
- **Python 3.x**
- **CMake & C++ Build Essentials**
- **wolfSSL** (with MPC hooks enabled).

### TODO: Build Commands
The build process involves compiling the C++ MPC components and installing JesseQ dependencies.
```bash
# General pattern for JesseQ installation
python3 reference/JesseQ/install.py --deps --tool --ot --zk --JQv1 --JQv2

# Building the new MPCAuth components (once implemented)
mkdir build && cd build
cmake ..
make -j
```

## Conventions
- **Cryptographic Integrity:** Never allow sensitive data to exist in plaintext on any single server node.
- **Idiomatic C++:** Follow the patterns established in `emp-toolkit` and `JesseQ`.
- **Surgical Updates:** When modifying reference code, maintain compatibility with the original interfaces where possible to ease migration.
