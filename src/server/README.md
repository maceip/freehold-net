# Freehold MPC Server

Three-party secure multi-party computation cluster for privacy-preserving petition verification. Jointly encrypts SMTP credentials and sends verification emails without any single node possessing the full secret.

---

## Architecture

```
                    ┌─────────────┐
                    │   Relay     │  relay.stare.network:9999
                    │  (UDP 0x46) │  subdomain assignment
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────┴────┐       ┌────┴────┐       ┌────┴────┐
    │ MPC-01  │◄─────►│ MPC-02  │◄─────►│ MPC-03  │
    │ (ALICE) │       │  (BOB)  │       │ (CAROL) │
    └────┬────┘       └────┬────┘       └────┬────┘
         │                 │                 │
         └────────┬────────┘                 │
                  │                          │
           ┌──────┴──────┐                   │
           │  Forwarder  │◄──────────────────┘
           │  :5870      │
           └──────┬──────┘
                  │  STARTTLS :587
                  ▼
           smtp.gmail.com
```

Each MPC node holds one shard of the SMTP credential. The three nodes jointly compute the TLS 1.3 application data record — encrypted AUTH PLAIN command — via garbled circuits. The forwarder receives the ciphertext with an HMAC-SHA256 proof, verifies it against the cluster key, and proxies the pre-encrypted record over a real TLS connection to the mail server.

---

## JesseQ v1: Zero-Knowledge Proof Protocol

JesseQ v1 is the ZK proof engine at the core of the Freehold MPC server. It orchestrates the full verification pipeline: identity commitment, credential encryption, and Sybil resistance — all inside a two-party zero-knowledge protocol built on emp-zk's interactive proof system.

### Protocol Stack

```
┌──────────────────────────────────────────────────────────┐
│                    JesseQ v1 Protocol                     │
├──────────────────────────────────────────────────────────┤
│  ZK Identity Commitment     SHA-256 Bristol circuit       │
│  SMTP-MPC Auth Encryption   AES-128-GCM Bristol circuit   │
│  Sybil Resistance           Nullifier DB (file-backed)    │
│  Epoch Sync                 BFT consensus integration     │
├──────────────────────────────────────────────────────────┤
│               emp-zk (BoolIO<NetIO>)                      │
│         setup_zk_bool / finalize_zk_bool                  │
├──────────────────────────────────────────────────────────┤
│                    emp-tool (NetIO)                        │
│              TCP, oblivious transfer, garbled circuits     │
└──────────────────────────────────────────────────────────┘
```

### IO Layer: BoolIO<NetIO>

JesseQ v1 wraps the raw TCP `NetIO` transport in a `BoolIO<NetIO>` adapter that provides the Boolean-circuit-specific serialization required by emp-zk:

```cpp
// Raw TCP transport between ALICE and BOB
NetIO* net_ios[1];
net_ios[0] = new NetIO(party == ALICE ? nullptr : remote_host, port);

// JesseQ v1 requires BoolIO<NetIO> wrapper for Boolean ZK circuits
BoolIO<NetIO>* bool_ios[1];
bool_ios[0] = new BoolIO<NetIO>(net_ios[0], party);
```

`NetIO` handles TCP socket management, buffering, and flushing. `BoolIO` adds the framing layer that maps Boolean wire values to the oblivious transfer protocol used by the ZK backend.

### ZK Session Lifecycle

Each JesseQ v1 session follows a strict lifecycle:

```
setup_zk_bool<BoolIO<NetIO>>(ios, threads, party)
    │
    ├─ [Optional] LLSS epoch transition gate
    │
    ├─ 1. TLS session key derivation (HKDF from identity shard)
    │
    ├─ 2. Joint SMTP AUTH encryption (AES-128-GCM circuit)
    │      └─ Password shards fed as private ALICE input
    │      └─ AES circuit evaluated per GCM counter block
    │      └─ Ciphertext revealed as PUBLIC output
    │
    ├─ 3. ZK identity commitment (SHA-256 circuit)
    │      └─ Identity shard fed as private ALICE input (512 bits)
    │      └─ SHA-256 Bristol circuit produces 256-bit hash
    │      └─ Hash revealed as PUBLIC → becomes nullifier
    │
    ├─ 4. Nullifier check (Sybil resistance)
    │      └─ Compare against on-disk nullifier database
    │      └─ Reject if duplicate, accept + persist if new
    │
finalize_zk_bool<BoolIO<NetIO>>()
    └─ Returns `cheated` flag — if true, verifier detected prover dishonesty
```

### Circuits Used

JesseQ v1 evaluates two distinct Bristol Fashion circuits within a single ZK session:

| Circuit | File | Input | Output | Purpose |
|---|---|---|---|---|
| AES-128 | `AES-non-expanded.txt` | 256 bits (128 key + 128 plaintext) | 128 bits | GCM counter mode encryption |
| SHA-256 | `sha256.txt` | 512 bits | 256 bits | Identity nullifier commitment |

Both circuits are loaded via emp-tool's `BristolFormat` / `BristolFashion` parsers. The AES circuit is evaluated multiple times per session (once per 16-byte GCM block + once for the J0 AEAD tag). The SHA-256 circuit is evaluated exactly once to produce the identity nullifier.

**Circuit path resolution** (build-time):
```
reference/JesseQ/JQv1/test/bool/AES-non-expanded.txt
reference/JesseQ/batchman/JQv1/sha256.txt
/usr/local/include/emp-tool/circuits/files/bristol_fashion/sha256.txt
```

### Private Input Model

All secret data enters the circuit as **ALICE-private inputs**. BOB participates as the verifier — he contributes no secret inputs but validates that ALICE's computation is honest through the ZK protocol.

| Input | Party | Width | Source |
|---|---|---|---|
| AES key share | ALICE | 128 bits | `global_tls_session.client_write_key_share` |
| GCM counter block | ALICE | 128 bits | Nonce XOR sequence number |
| Password shard | ALICE | variable | `shard_{party}_pass.bin` file |
| Identity shard | ALICE | 512 bits | CLI `--shard` hex argument |

Inputs are converted from byte arrays to Boolean wire vectors via `bytes_to_bools()` (LSB-first ordering) and fed into the circuit via `role->feed(bits, ALICE, bools, len)`. The emp-zk backend handles the oblivious transfer protocol that allows ALICE to commit to her inputs without revealing them to BOB.

### Nullifier and Sybil Resistance

The SHA-256 nullifier is the core anti-Sybil mechanism. For each signing attempt:

1. ALICE feeds her 512-bit identity shard as private input to the SHA-256 circuit
2. The circuit computes `SHA-256(identity_shard)` inside the ZK protocol
3. The 256-bit output is revealed as PUBLIC (both parties learn the hash)
4. The hash is converted to a 64-character hex string (the **nullifier**)
5. The nullifier is checked against a file-backed database (`nullifier_database.txt`)
6. If the nullifier already exists → `REJECTED: Identity already signed`
7. If new → persisted to disk, signing proceeds

```cpp
string nullifier = compute_hash_to_hex(hash_result.get(), sha_out_len);
if (nullifier_database.count(nullifier)) {
    // REJECTED — same identity shard already signed this petition
} else {
    nullifier_database.insert(nullifier);
    save_nullifier(nullifier);
    // SUCCESS — proceed to email delivery
}
```

Because the SHA-256 circuit runs inside the ZK protocol, BOB (the verifier) can confirm that the nullifier was correctly computed from ALICE's committed input — without learning what that input was. This gives the property: **the same identity always produces the same nullifier** (deterministic), but **the nullifier reveals nothing about the identity** (preimage resistance of SHA-256).

### Cheating Detection

After all circuit evaluations complete, `finalize_zk_bool()` runs the ZK verification check:

```cpp
bool cheated = finalize_zk_bool<BoolIO<NetIO>>();
if (cheated) {
    throw runtime_error("ZK proof verification failed: cheating detected.");
}
```

If the prover (ALICE) attempted to:
- Feed incorrect values to the circuit
- Modify wire values during evaluation
- Deviate from the OT protocol

...the verifier (BOB) detects this during finalization. The entire session is invalidated — no nullifier is committed, no email is sent.

### Epoch Synchronization

JesseQ v1 integrates with the BFT consensus layer via the `CLUSTER_BFT_EPOCH` environment variable. Before circuit evaluation begins, ALICE sends her epoch to BOB for synchronization:

```cpp
int cluster_epoch = get_current_epoch_from_consensus();
if (party == ALICE) {
    net_ios[0]->send_data(&request_epoch, sizeof(int));
} else {
    net_ios[0]->recv_data(&request_epoch, sizeof(int));
}
```

If there's an epoch mismatch (the requester's epoch differs from the cluster's current epoch), the LLSS transition gate fires before the main ZK computation begins. This ensures that stale shares from a previous epoch are reshared to the current topology before being used in any circuit evaluation.

### Build Configuration

JesseQ v1 is built as a CMake subproject. The include path points to `reference/JesseQ/JQv1`:

```cmake
set(JESSEQ_PATH ${CMAKE_CURRENT_SOURCE_DIR}/../../reference/JesseQ/JQv1)
include_directories(${JESSEQ_PATH})
```

**Dependencies**:
- `emp-zk` — zero-knowledge proof library (interactive, Boolean circuits)
- `emp-tool` — base library (NetIO, BristolFormat, block type, OT)
- OpenSSL — HMAC-SHA256 for HKDF key derivation (avoids wolfSSL `byte` conflict)
- wolfSSL — QUIC/H3 transport layer (ngtcp2 crypto backend)

**Compiler flags**: `-march=native -O3 -fstack-protector-strong -D_FORTIFY_SOURCE=2`

Release builds use `-march=x86-64-v2` for broad compatibility while retaining SIMD (SSE4.2/AVX) intrinsics used by emp-tool's `block` type (128-bit `__m128i`).

### End-to-End Protocol Timeline

```
T=0    ALICE listens on port, BOB connects
T+0    Epoch sync (1 round-trip)
T+1    setup_zk_bool — OT base setup (~50ms LAN)
T+2    [LLSS transition gate if epoch mismatch]
T+3    HKDF key derivation (local, ~0.1ms)
T+4    Joint_SMTP_Authenticate:
         - Password shard feed (1 OT round)
         - AES circuit × N blocks (N OT rounds)
         - AEAD tag computation (1 OT round)
T+5    SHA-256 nullifier:
         - Identity shard feed (1 OT round)
         - SHA-256 circuit (1 OT round)
         - Reveal hash (1 round)
T+6    finalize_zk_bool — verification check
T+7    Nullifier DB check + persist
T+8    Email delivery (ALICE only, via SMTP client)
```

Total protocol wall time: **~200–500ms** on LAN (dominated by OT rounds), **~2–5s** over WAN.

---

## VOLE-Based ZK Lineage

JesseQ v1 is not a standalone invention — it sits at the end of a five-year research lineage in **VOLE-based zero-knowledge proofs** (Vector Oblivious Linear Evaluation). Each generation kept the same core idea — commit to wire values using information-theoretic MACs derived from VOLE correlations — and optimized a different bottleneck.

### The Evolution

```
Wolverine (2020)                      ~9 bits / AND gate, 0.45µs prover
    │
    ├── LPZK (2020)                   algebraic batch-checking insight
    │
    ▼
QuickSilver (2021)                    1 field element / AND gate, 4 ext-field mults
    │
    ├── Mac'n'Cheese (2021)           + branching/disjunction support
    │
    ├── Mozzarella / QuarkSilver (2022)   QuickSilver over Z_{2^k} rings
    │
    ├── IT-LPZKv2 (2022)             1/2 element / gate (random oracle model)
    │
    ▼
JesseQ v1 (2025)                      1 element / AND gate, 2 scalar mults → ~7× faster
```

### Wolverine (IEEE S&P 2021)

First practical VOLE-based ZK for both Boolean and arithmetic circuits. Demonstrated that VOLE commitments yield **streaming** proofs with constant memory — enabling proofs over circuits with hundreds of billions of gates. Cost: ~9 bits per AND gate, ~0.45µs prover time per gate.

> [ePrint 2020/925](https://eprint.iacr.org/2020/925) — Weng, Yang, Katz, Wang

### QuickSilver (ACM CCS 2021)

Hybrid of Wolverine's any-field VOLE and LPZK's algebraic multiplication check. Slashed communication to **1 field element per AND gate** and prover work to **4 extension-field multiplications** per gate. Unified support for any field (F₂ for Boolean, large primes for arithmetic). This is the protocol that **emp-zk** primarily implements.

Key result: ~$1 to prove 1 trillion AND gates on AWS. 1024×1024 matrix multiply in 10 seconds / 25 MB / 1 GB memory (35× faster than Virgo, which needs 140+ GB).

> [ePrint 2021/076](https://eprint.iacr.org/2021/076) — Yang, Sarkar, Weng, Wang

### Mozzarella / QuarkSilver (CRYPTO 2022)

Extended QuickSilver to work natively over the ring **Z\_{2^k}** — integers mod 2^k, which is what CPUs actually compute on (32-bit and 64-bit arithmetic). Previous protocols required emulating Z\_{2^k} operations in prime fields, incurring overhead. **QuarkSilver** is the ZK proof system built on top of Mozzarella's VOLE-over-rings construction. Performance: 1.3 million 64-bit multiplications/second.

This matters for workloads involving machine-integer arithmetic (ML inference, CPU emulation, fixed-point DSP) where prime-field encoding wastes bits.

> [ePrint 2022/819](https://eprint.iacr.org/2022/819) — Baum, Braun, Munch-Hansen, Scholl

### JesseQ v1 (ePrint 2025)

Keeps QuickSilver's communication profile (1 field element per AND gate) but replaces the expensive multiplications with cheap scalar multiplications:

| | QuickSilver | JesseQ v1 |
|---|---|---|
| Communication / AND gate | 1 field element | 1 field element |
| Prover multiplications / AND gate | 4 × (F\_{2^128} × F\_{2^128}) | 2 × (F₂ × F\_{2^128}) |
| Multiplication cost | Full 128×128-bit multiply | Bit × 128-bit scalar multiply |
| Boolean proving speedup | baseline | **~7×** |
| Arithmetic (large field) | 3 field mults/gate | 2 field mults/gate |
| Rounds | 3 | 3 |
| Fields supported | Any | Any |

The critical insight: multiplying a 128-bit value by a single bit (scalar multiply) is dramatically cheaper than a full 128-bit × 128-bit multiply. JesseQ v1 halves the count AND makes each remaining multiply individually cheaper.

> [ePrint 2025/533](https://eprint.iacr.org/2025/533)

### Summary Table

| Protocol | Year | Comm/AND | Prover cost/AND | Key advance |
|---|---|---|---|---|
| Wolverine | 2020 | ~9 bits | Heavy | Streaming VOLE-based ZK |
| QuickSilver | 2021 | 1 element | 4 ext-field mults | Algebraic batch check, any field |
| Mozzarella/QuarkSilver | 2022 | 1 element | ~4 ring mults | Native Z\_{2^k} ring support |
| JesseQ v1 | 2025 | 1 element | 2 scalar mults | 7× faster Boolean proving |

---

## Why VOLE-Based ZK (Bristol) vs PLONK-Based ZK (Halo 2)

JesseQ v1 uses Boolean circuits in Bristol Fashion format, evaluated under a VOLE-based interactive ZK protocol. An alternative architecture would use **Halo 2** — the PLONK-based proving system developed by the Electric Coin Company (Zcash). These represent fundamentally different design philosophies.

### What Halo 2 Is

[Halo 2](https://github.com/zcash/halo2) is a **non-interactive, succinct** ZK proof system based on the PLONK arithmetization with inner product argument (IPA) polynomial commitments. Circuits are expressed as systems of polynomial constraints over large prime fields, compiled into a structured relation that the prover satisfies.

### Architectural Comparison

| Property | JesseQ v1 / Bristol (VOLE) | Halo 2 (PLONK) |
|---|---|---|
| **Proof type** | Interactive, designated-verifier | Non-interactive, publicly verifiable |
| **Succinctness** | Linear proof size (proportional to circuit) | Succinct (~constant size, ~kB) |
| **Prover time** | Linear, streaming | Quasi-linear, requires full circuit in memory |
| **Verifier time** | Linear (verifier must process whole circuit) | Sublinear (~ms regardless of circuit size) |
| **Trusted setup** | None | None (Halo 2 uses IPA, no CRS) |
| **Arithmetization** | Boolean gates (AND/XOR/INV) | Arithmetic constraints (PLONKish) |
| **Circuit format** | Bristol Fashion `.txt` files | Rust trait-based circuit API |
| **Memory** | Constant (streaming evaluation) | O(circuit size) |
| **Communication** | ~1 field element per AND gate | ~kB total (succinct) |
| **Post-quantum** | Information-theoretic MACs (plausibly PQ) | IPA security relies on DLOG |

### Why Bristol/VOLE for Freehold

**1. MPC-native execution model**

Bristol Fashion circuits are the standard interchange format for MPC protocols. The same AES-non-expanded.txt file works with garbled circuits (Yao), secret sharing (GMW/BMR), and ZK proofs (emp-zk). Halo 2 circuits are written as Rust code using PLONKish constraint APIs — they cannot be shared across MPC backends.

Freehold's core operation is **multi-party computation** (joint SMTP encryption). The ZK layer proves that the MPC was executed honestly. Using Bristol circuits means the MPC computation and the ZK proof share the same circuit representation — no translation layer, no redundant encoding.

**2. Streaming over billion-gate circuits**

VOLE-based proofs run in **constant memory** regardless of circuit size. The prover streams through the circuit gate-by-gate, never holding the full circuit in RAM. For Freehold's AES-GCM encryption of multi-block SMTP records, this means memory usage is bounded by a few KB of wire buffers.

Halo 2 requires the full constraint system in memory during proving. A circuit with millions of constraints can demand gigabytes of RAM. For a resource-constrained MPC node, this is a non-starter.

**3. Linear prover, no FFTs**

VOLE-based provers do field multiplications per gate — no polynomial arithmetic, no FFTs, no MSMs (multi-scalar multiplications). The prover cost scales linearly and predictably: 2 scalar multiplications per AND gate in JesseQ v1.

Halo 2 proving involves polynomial commitment via IPA, which requires MSMs over elliptic curve groups. These are computationally expensive (~10-100× slower per gate than VOLE) and harder to parallelize.

**4. Designated-verifier is sufficient**

Halo 2's main advantage is **public verifiability** — anyone can check the proof without interacting with the prover. This matters for blockchain applications (on-chain verification by smart contracts).

Freehold doesn't need public verifiability. The verifier is BOB (the other MPC node), who is already online and participating in the protocol. An interactive, designated-verifier proof is perfectly adequate — and dramatically cheaper.

**5. AND gate cost transparency**

Bristol Fashion exposes the exact gate topology. The AES circuit has 6,800 AND gates — this means exactly 6,800 OT interactions, and the cost is known before execution. The forwarder can verify the circuit hash to ensure the correct circuit was evaluated.

PLONK constraint systems are opaque at the gate level. The "cost" of a Halo 2 circuit depends on the number of rows, columns, and custom gates — a less direct mapping to concrete computational cost.

### When Halo 2 Would Be Better

- **On-chain verification**: If petition signatures needed to be verified by a smart contract, Halo 2's succinct proofs (~kB) would be essential. VOLE proofs are linear-sized and not suitable for on-chain posting.
- **Third-party auditability**: If an external auditor needed to verify proofs without being online during computation, Halo 2's non-interactive proofs could be stored and checked later.
- **Recursion/composition**: Halo 2 supports proof recursion (proving that a proof is valid) via accumulation schemes. This enables incrementally verifiable computation — not needed for Freehold's single-shot petition signing.

For Freehold's threat model — a small cluster of cooperating MPC nodes jointly proving honest computation to each other — the interactive VOLE-based approach is the right tool. It is faster, lighter, and natively compatible with the MPC protocol stack.

---

## Circuits

### Bristol Fashion Format

All circuits in the Freehold MPC server use the **[Bristol Fashion](https://nigelsmart.github.io/MPC-Circuits/)** format — a plain-text circuit description language developed at the University of Bristol for use in MPC and ZK protocols.

A Bristol Fashion file describes a Boolean circuit as a flat list of 2-input gates operating on numbered wires. The format is intentionally minimal — no high-level abstractions, no loops, no conditionals — just a direct acyclic graph of AND, XOR, and INV gates that can be evaluated by any MPC backend without parsing a programming language.

**Wire format**:
```
<total_gates> <total_wires>
<n_input_1> <n_input_2>          ← input wire counts per party
<n_output>                        ← output wire count

2 1 <in_1> <in_2> <out> AND      ← 2-input AND gate
2 1 <in_1> <in_2> <out> XOR      ← 2-input XOR gate
1 1 <in> <out> INV               ← 1-input NOT gate
```

Each line after the header is one gate. Wires are numbered sequentially — input wires first, then intermediate wires, then output wires. The circuit is topologically sorted: every gate's input wires are defined before they're consumed.

**Why Bristol Fashion for MPC**:

- **Backend-agnostic**: The same `.txt` file works with garbled circuits (Yao), secret sharing (GMW/BMR), and ZK proofs (emp-zk). Freehold uses emp-zk but could swap backends without rewriting circuits.
- **Gate-level granularity**: MPC protocols operate on individual gates — AND gates require communication (oblivious transfer), XOR gates are "free" (XOR of shares is local). Bristol Fashion exposes this distinction directly, enabling precise cost analysis: an AES circuit with 6,800 AND gates means exactly 6,800 OT interactions.
- **Precomputed and auditable**: Circuits are generated offline by compilers (e.g., CBMC-GC, Frigate, or hand-optimized). The resulting file is a static artifact that can be hashed, signed, and verified — the forwarder checks `SHA-256(circuit_file)` before accepting any MPC proof.
- **No runtime compilation**: Unlike R1CS/arithmetic constraint systems used in SNARKs, Bristol circuits require zero compilation at evaluation time. The file is parsed once into an in-memory gate array and executed directly.

**Circuit library**: Standard Bristol Fashion circuits for common primitives (AES, SHA-256, comparison, addition) are maintained at [nigelsmart.github.io/MPC-Circuits](https://nigelsmart.github.io/MPC-Circuits/) and bundled with [emp-tool](https://github.com/emp-toolkit/emp-tool) under `circuits/files/bristol_format/` and `circuits/files/bristol_fashion/`.

### AES-128-GCM via Bristol Format

The core cryptographic primitive is **AES-128 in non-expanded-key form**, evaluated as a Boolean circuit using the emp-toolkit's `BristolFormat` engine.

**Circuit file**: `AES-non-expanded.txt`

| Property | Value |
|---|---|
| Gate count | ~6,800 AND gates, ~25,000 XOR gates |
| Input wires | 256 (128-bit key + 128-bit plaintext) |
| Output wires | 128 (128-bit ciphertext block) |
| Format | Bristol Fashion (University of Bristol) |
| Key schedule | Inline (non-expanded), computed within the circuit |
| Rounds | 10 (AES-128) |

The circuit is loaded once and cached as a static pointer (`BristolFormat*`) — subsequent encrypt calls reuse the parsed gate structure with zero re-parsing overhead:

```cpp
static BristolFormat* get_aes_circuit() {
    static BristolFormat* cf = nullptr;
    if (!cf) {
        cf = new BristolFormat("AES-non-expanded.txt");
    }
    return cf;
}
```

**Input feeding**: ALICE (Party 1) feeds both the 128-bit AES key share and the 128-bit counter block as Boolean wire vectors via `role->feed()`. The circuit evaluates under the emp-zk protocol — either `ZKProver` or `ZKVerifier` depending on the party role — producing a garbled output that is jointly revealed via `role->reveal(ct_result, PUBLIC, ct_bits, 128)`.

**Bit ordering**: Bytes are unpacked LSB-first into Boolean arrays. The conversion helpers `bytes_to_bools` / `bools_to_bytes` handle the mapping between byte buffers and the circuit's wire-level representation:

```
byte[i] bit 0 (LSB) → bools[i*8 + 0]
byte[i] bit 7 (MSB) → bools[i*8 + 7]
```

### Performance Characteristics

| Metric | Detail |
|---|---|
| Circuit parse | ~2ms (one-time, cached) |
| Per-block AES evaluation | ~0.5ms per 128-bit block (LAN, 3-party) |
| Buffer allocation | Pre-allocated once per `JesseQ_TLS_Encrypt` call, reused across blocks |
| Network round-trips | 1 per circuit evaluation (feed → compute → reveal) |
| Memory per call | 3 × 128 `block` arrays (~6 KB) for key/plaintext/ciphertext wire vectors |

**P1 FIX — Circuit caching**: The AES Bristol circuit is loaded exactly once into a `static BristolFormat*`. Without this fix, each encryption call would re-parse ~31,800 gates from disk.

**P3 FIX — Buffer reuse**: The `block*` arrays for plaintext bits (`pt_bits`) and ciphertext bits (`ct_bits`) are allocated once before the GCM block loop and reused for every 16-byte chunk. This eliminates per-block heap allocation that would otherwise dominate runtime for multi-block records.

---

## TLS 1.3 Cipher Suite

**Cipher**: `TLS_AES_128_GCM_SHA256` (0x1301)

### HKDF Key Derivation (RFC 5869)

Session keys are derived from the identity shard using HKDF-Expand-Label with SHA-256, per the TLS 1.3 key schedule:

```
handshake_secret = shard_bytes (zero-padded to 48 bytes)

client_write_key   = HKDF-Expand-Label(handshake_secret, "key",      "", 16)
client_write_iv    = HKDF-Expand-Label(handshake_secret, "iv",       "", 12)
server_write_key   = HKDF-Expand-Label(handshake_secret, "s ap key", "", 16)
```

**HKDF-Expand-Label** constructs the info parameter per RFC 8446 Section 7.1:

```
HkdfLabel = struct {
    uint16 length;            // output length
    opaque label<7..255>;     // "tls13 " + label
    opaque context<0..255>;   // empty (0x00)
}
```

The implementation uses iterative HMAC-SHA256 via OpenSSL (not wolfSSL, to avoid `byte` typedef conflicts with `std::byte`):

```
T(1) = HMAC-SHA256(PRK, info || 0x01)
T(i) = HMAC-SHA256(PRK, T(i-1) || info || i)   for i > 1
```

### GCM Counter Mode

Each TLS record is encrypted block-by-block in AES-GCM counter mode:

1. **Nonce construction**: 12-byte IV XOR left-padded 8-byte sequence number
   ```
   nonce[11-i] ^= (sequence_number >> (i*8)) & 0xFF    for i in 0..7
   ```

2. **Counter blocks**: `nonce || counter_BE32`, counter starts at 2 (J0 at counter=1 is reserved for the AEAD tag)
   ```
   counter_block = nonce[0..11] || BigEndian32(block_index + 2)
   ```

3. **Keystream**: Each counter block is AES-encrypted via the Bristol circuit, then XORed with plaintext to produce ciphertext

4. **AEAD tag**: `AES(K, J0) XOR GHASH(ciphertext)` where J0 = `nonce || 0x00000001`

5. **Record header**: `0x17 0x03 0x03` (application_data, TLS 1.2 compatibility version) followed by 2-byte length = `plaintext_len + 16` (ciphertext + 16-byte tag)

6. **Sequence number**: Incremented per TLS record, never resets within a session

### STARTTLS Flow

The forwarder establishes the actual TLS connection to the mail server:

| Step | Port | Protocol |
|---|---|---|
| TCP connect | 587 | Cleartext SMTP |
| EHLO | 587 | Cleartext |
| STARTTLS | 587 | Upgrade negotiation |
| TLS 1.3 handshake | 587 | TLS (AES-128-GCM-SHA256) |
| AUTH PLAIN (MPC-encrypted) | 587 | TLS application data |

The MPC cluster never touches the raw TLS connection. Instead, it produces the encrypted application data record (`0x17 0x03 0x03 ...`) containing the AUTH PLAIN command. The forwarder injects this pre-encrypted record into the TLS stream after completing the handshake with smtp.gmail.com.

---

## LLSS: Leveled Linear Secret Sharing

### Protocol

The LLSS layer uses the **delayed resharing** protocol (`delayedresharing` library) with `RSSParty<BooleanValue>` for replicated secret sharing over Boolean values.

```cpp
class LLSSContext {
    delayedresharing::RSSParty<BooleanValue>* rss_party;
    int epoch;
    int active_nodes;
    int threshold;
};
```

### Epoch-Based Group Transitions

The cluster operates in epochs. Each epoch defines the set of active nodes and the sharing threshold. Transitions between epochs — node joins and departures — are handled by `apply_transition_gate()`:

```cpp
void apply_transition_gate(ProtocolExecution* role);
```

This function accepts either a `ZKProver` or `ZKVerifier` as the protocol execution context, allowing the same transition logic to work under both proof generation and verification.

### Group Join

When a new node joins the cluster:

1. **Epoch increment**: The epoch counter advances, signaling all nodes to prepare for resharing
2. **Delayed resharing**: The existing shares are re-randomized and redistributed to include the new party. The `delayedresharing` protocol ensures that:
   - The new node receives a valid share without learning previous shares
   - Existing nodes update their shares to maintain the threshold invariant
   - The secret itself is never reconstructed during the transition
3. **Active node update**: `active_nodes` increments, threshold may adjust
4. **Network bootstrap**: The new node reads `LLSS_IP_PREV` and `LLSS_IP_NEXT` environment variables to establish connections to its neighbors in the ring topology

### Group Leave

When a node departs:

1. **Graceful resharing**: Before the node goes offline, shares are redistributed among remaining nodes via the delayed resharing protocol
2. **Threshold adjustment**: The threshold decreases to maintain the required reconstruction ratio
3. **Epoch advancement**: All remaining nodes advance to the new epoch with updated share polynomials
4. **No reconstruction**: At no point during departure is the secret reconstructed — shares are transformed in-place via the transition gate

### Performance Advantages of Delayed Resharing

| Property | Traditional Resharing | Delayed Resharing |
|---|---|---|
| Rounds of communication | O(n^2) | O(n) |
| Secret exposure risk | Brief reconstruction window | Zero — shares transform in-place |
| Downtime during transition | Full cluster pause | Online — existing operations continue |
| Share size growth | Constant | Constant (no share expansion) |
| Backward secrecy | Requires explicit revocation | Automatic — old shares are invalidated |

The delayed resharing protocol achieves **online group membership changes** — the cluster continues processing petition verifications during join/leave events. This is critical for a production deployment where MPC nodes may be added or removed without service interruption.

### Ring Topology

Nodes communicate in a ring via `emp::NetIO` connections:

```
cluster_ios[0] → previous node (LLSS_IP_PREV)
cluster_ios[1] → next node (LLSS_IP_NEXT)
```

The ring structure minimizes the number of point-to-point connections from O(n^2) to O(n) while maintaining the communication pattern required by the RSS protocol.

---

## SMTP Authentication Inside MPC

### Joint AUTH PLAIN

The `Joint_SMTP_Authenticate` function constructs and encrypts the SMTP AUTH PLAIN command entirely within the MPC protocol:

```
AUTH PLAIN base64(\0username\0password)
```

Each node holds a shard of the password. The shards are fed as private inputs via `role->feed()`, combined inside the circuit, Base64-encoded, and then encrypted using `JesseQ_TLS_Encrypt` to produce the TLS application data record.

No single node ever sees the complete password — it exists only as distributed wire values inside the garbled circuit.

### Forwarder Verification

Before proxying the encrypted record to smtp.gmail.com, the forwarder on port 5870 verifies:

1. **HMAC-SHA256 proof**: The MPC cluster produces `HMAC-SHA256(cluster_key, ciphertext)` — the forwarder recomputes and compares
2. **Circuit hash**: Hash of the Bristol circuit used, confirming the correct AES-non-expanded circuit was evaluated
3. **Commitment consistency**: Each node's commitment to its input wires is checked against the protocol transcript

Only after all three checks pass does the forwarder inject the ciphertext into the live TLS connection.

---

## Discovery & Relay

### Discovery Server (:5880)

HTTP service for cluster topology management:

| Endpoint | Method | Description |
|---|---|---|
| `/announce` | POST | Node heartbeat with service metadata |
| `/nodes` | GET | Current active node list |
| `/resolve` | GET | Resolve service name to endpoint |
| `/health` | GET | Server health check |
| `/ws` | WebSocket | Live topology stream |

Node TTL is 30 seconds. Stale nodes are pruned every 10 seconds. The WebSocket endpoint pushes topology changes to connected clients in real-time.

### Relay Client (UDP)

Custom binary protocol for NAT traversal and subdomain assignment:

| Byte | Field | Description |
|---|---|---|
| 0 | Magic | `0x46` (ASCII 'F') |
| 1 | Type | Message type (0x01–0x05) |
| 2–3 | Port | Service port (uint16, big-endian) |
| 4–19 | Cookie | 16-byte session cookie |
| 20+ | Payload | Type-specific data |

**Registration flow**:
```
Node → Relay:  Register(port)
Relay → Node:  Challenge(cookie)
Node → Relay:  Confirm(cookie)
Node → Relay:  Heartbeat every 90s (TTL 270s)
Relay → Node:  Neighbors(subdomain assignment)
```

The `DemuxSocket` multiplexes relay traffic and QUIC traffic on the same UDP socket — packets starting with `0x46` are routed to the relay engine, everything else goes to the QUIC stack.

**Registered services**:
- `mpc-node` — the MPC computation endpoint
- `discovery` — topology server
- `forwarder` — SMTP proxy

---

## Verification Payload

After successful MPC computation and email delivery, the system produces a verification payload:

```json
{
    "nullifier_hex": "<64-char hex SHA-256>",
    "petition_ref": "DEMO-001",
    "epoch": 1
}
```

The **nullifier** is a deterministic hash derived from the signer's identity proof — it prevents double-signing without revealing the signer's identity. The epoch field ties the signature to a specific cluster configuration, ensuring that verification proofs from one epoch cannot be replayed in another.
