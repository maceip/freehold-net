# OpenPetition Protocol Flows

Temporary reference — different views of the same signing flow.

---

## 1. Linear Timeline

```
Signer                    Cluster (N nodes)                Forwarder              Mail Server
  │                             │                              │                       │
  ├─── "I want to sign" ──────►│                              │                       │
  │                             │                              │                       │
  │                     ┌───────┴───────┐                      │                       │
  │                     │ Shamir split  │                      │                       │
  │                     │ email → shares│                      │                       │
  │                     │ (3-of-5)      │                      │                       │
  │                     └───────┬───────┘                      │                       │
  │                             │                              │                       │
  │                     ┌───────┴───────┐                      │                       │
  │                     │ EMP-ZK joint  │                      │                       │
  │                     │ encrypt OTP   │                      │                       │
  │                     │ + generate    │                      │                       │
  │                     │ ZK proof      │                      │                       │
  │                     └───────┬───────┘                      │                       │
  │                             │                              │                       │
  │                             ├── ciphertext + proof ───────►│                       │
  │                             │                              │                       │
  │                             │                      ┌───────┴───────┐               │
  │                             │                      │ Verify HMAC   │               │
  │                             │                      │ Verify chunks │               │
  │                             │                      │ Verify circuit│               │
  │                             │                      └───────┬───────┘               │
  │                             │                              │                       │
  │                             │                              ├── STARTTLS email ────►│
  │                             │                              │                       │
  │◄──────────────────── OTP arrives in inbox ─────────────────┼───────────────────────┤
  │                             │                              │                       │
  ├─── enter OTP ─────────────►│                              │                       │
  │                             │                              │                       │
  │                     ┌───────┴───────┐                      │                       │
  │                     │ Verify OTP    │                      │                       │
  │                     │ via dist. PRF │                      │                       │
  │                     │               │                      │                       │
  │                     │ Cast nullifier│                      │                       │
  │                     │ to petition   │                      │                       │
  │                     └───────┬───────┘                      │                       │
  │                             │                              │                       │
  │◄── "Signature recorded" ───┤                              │                       │
```

---

## 2. State Machine (per signer)

```
                    ┌─────────┐
                    │  START  │
                    └────┬────┘
                         │ submit email
                         ▼
                  ┌──────────────┐
                  │  SHARDING    │  email → N shares (Shamir 2^521-1)
                  └──────┬───────┘
                         │ shares distributed
                         ▼
                  ┌──────────────┐
                  │  ZK_ENCRYPT  │  EMP-ZK garbled circuit computes
                  │              │  OTP payload without revealing email
                  └──────┬───────┘
                         │ proof + ciphertext ready
                         ▼
                  ┌──────────────┐
                  │  FORWARDING  │  forwarder verifies proof,
                  │              │  relays via mTLS → STARTTLS
                  └──────┬───────┘
                         │ email delivered
                         ▼
                  ┌──────────────┐
                  │  OTP_WAIT    │  signer checks inbox
                  └──────┬───────┘
                         │ OTP entered
                         ▼
                  ┌──────────────┐
                  │  VERIFY      │  distributed PRF validates OTP
                  └──────┬───────┘
                    ┌────┴────┐
                    │         │
                  valid    invalid
                    │         │
                    ▼         ▼
             ┌──────────┐  ┌──────────┐
             │  SIGNED  │  │ REJECTED │
             └──────────┘  └──────────┘
```

---

## 3. Data Flow (what moves where)

```
┌──────────────────────────────────────────────────────────────────────┐
│ SIGNER BROWSER                                                       │
│                                                                      │
│  email plaintext ──► XOR shares ──► [share₁, share₂, ..., shareₙ]  │
│                      (client-side)                                   │
└──────────┬───────────────────────────────────────────────────────────┘
           │ shares travel individually to each node
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ MPC CLUSTER                                                          │
│                                                                      │
│  Node 1: share₁ ──┐                                                 │
│  Node 2: share₂ ──┼──► OT/ZK protocol ──► encrypted_otp + proof    │
│  Node 3: share₃ ──┘    (no node sees       │                        │
│                          plaintext)         │ HMAC(cluster_key, msg) │
│                                             │ chunk commitments      │
│  Epoch state:                               │ circuit hash           │
│    CLUSTER_BFT_EPOCH ──► LLSS resharding    │                        │
│    when nodes join/leave                    │                        │
└─────────────────────────────────────────────┼────────────────────────┘
                                              │ mTLS (TLS 1.3)
                                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ FORWARDER                                                            │
│                                                                      │
│  Receives: { circuit_hash, commitments[], signature } + ciphertext   │
│                                                                      │
│  Checks:                                                             │
│    1. circuit_hash == sha256(circuit_file)         ?                  │
│    2. HMAC(key, ciphertext || circuit_hash) == sig ?                  │
│    3. HMAC(key, chunk_i) == commitment_i           ?                  │
│                                                                      │
│  If all pass ──► proxy to SMTP server via STARTTLS                   │
│  If any fail ──► drop connection                                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Resharding (LLSS epoch transition)

```
EPOCH 1: 5 nodes, threshold 3                EPOCH 2: 3 nodes, threshold 3
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐     ┌─────┐ ┌─────┐ ┌─────┐
│ N1  │ │ N2  │ │ N3  │ │ N4  │ │ N5  │     │ N1' │ │ N2' │ │ N3' │
│ s₁  │ │ s₂  │ │ s₃  │ │ s₄  │ │ s₅  │     │ s₁' │ │ s₂' │ │ s₃' │
└──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘     └─────┘ └─────┘ └─────┘
   │       │       │       │       │              ▲       ▲       ▲
   │       │       │       │       │              │       │       │
   └───────┴───────┴───────┼───────┘              │       │       │
                           │                      │       │       │
              ┌────────────▼────────────┐         │       │       │
              │   LLSS RESHARDING       │         │       │       │
              │                         │         │       │       │
              │  • N4, N5 decommission  ├─────────┴───────┴───────┘
              │  • New polynomial       │   new shares (secret
              │    same secret          │   never materialized)
              │  • BFT epoch 1 → 2     │
              └─────────────────────────┘
```

---

## 5. Trust Boundaries

```
┌─ UNTRUSTED ──────────────────────────────┐
│  Signer's browser                        │
│  (only sees own email, nothing else)     │
└──────────────────────────┬───────────────┘
                           │ shares (each individually meaningless)
┌─ SEMI-TRUSTED ───────────▼───────────────┐
│  Individual MPC nodes                     │
│  (each holds 1 share, can't reconstruct) │
│  (collude < threshold → still safe)      │
└──────────────────────────┬───────────────┘
                           │ encrypted payload + ZK proof
┌─ VERIFIER ───────────────▼───────────────┐
│  Forwarder                                │
│  (sees ciphertext, never plaintext)       │
│  (verifies proof integrity only)          │
└──────────────────────────┬───────────────┘
                           │ STARTTLS
┌─ EXTERNAL ───────────────▼───────────────┐
│  Mail server (Gmail, etc.)                │
│  (sees email address — unavoidable)       │
│  (but doesn't know which petition)        │
└──────────────────────────────────────────┘
```

---

## Stable Diffusion Prompts

Visual companions for each flowchart above. Use with SDXL or SD 1.5, cfg_scale ~7-9, steps 30-50.

### Prompt 1 — Linear Timeline

```
"a whimsical isometric blueprint of a message relay system, a tiny person at a
glowing laptop on the left sends a sealed envelope into a cluster of five
friendly robots standing in a circle, the robots jointly craft a sparkling
cryptographic scroll, a courier owl carries the scroll across a bridge labeled
mTLS to a cozy post office watchtower, the watchtower inspects the seal with a
magnifying glass then launches the letter via paper airplane toward a mailbox on
a distant cloud, soft teal and gold palette, technical illustration meets
storybook art, clean linework, labeled stages floating above each scene,
--ar 21:9"
```

**Negative:** photo, realistic, blurry, watermark, text overlay, dark, gritty

### Prompt 2 — State Machine

```
"a vertical candy-colored flowchart as a board game path, each state is a
distinct floating island connected by rope bridges, START island is a green
hilltop with a mailbox, SHARDING island shows a crystal being split into
rainbow shards by a gentle wizard, ZK_ENCRYPT island is a bubbling alchemist
lab with garbled circuit diagrams on a chalkboard, FORWARDING island is a
lighthouse beaming a verified signal, OTP_WAIT island is a cozy reading nook
with an hourglass, VERIFY island is a judge's podium with a glowing stamp,
SIGNED island is a golden trophy pedestal, REJECTED island is a comically sad
rain cloud, pastel watercolor style, top-down perspective, --ar 9:16"
```

**Negative:** photo, realistic, cluttered, dark palette, violence

### Prompt 3 — Data Flow

```
"a cross-section cutaway diagram of an underground pneumatic tube system, top
floor is a cheerful office where a person feeds a letter into a shredder that
splits it into colored confetti tubes, middle floor is a vault where five
worker bees each hold one confetti piece and collaboratively weave an encrypted
golden capsule without seeing each others pieces, bottom floor is an inspector
fox at a checkpoint desk examining the capsule with UV light and a monocle,
below that a tunnel shoots the approved capsule to a surface-level mailbox,
annotation labels at each floor, retro science poster aesthetic, warm analog
colors, --ar 2:3"
```

**Negative:** photo, realistic, anime, watermark, blurry

### Prompt 4 — Resharding (LLSS Epoch Transition)

```
"a magical garden scene, epoch 1 on the left shows five flower pots each
containing one glowing shard-seed, two of the pots gracefully fade into
translucent ghosts as their essence flows through luminous root networks
underground, epoch 2 on the right shows three new flower pots blooming with
recombined shard-flowers of different colors but the same central light,
a banner between the two epochs reads BFT EPOCH in art nouveau lettering,
the secret golden orb floats untouched above the entire scene connected by
dotted lines to nothing, botanical illustration style, parchment background,
copper and emerald tones, --ar 16:9"
```

**Negative:** photo, realistic, dark, horror, wilting, dead plants

### Prompt 5 — Trust Boundaries

```
"a four-layer wedding cake viewed from the side, each tier is a trust zone,
top tier UNTRUSTED is a small chaotic party with a single guest peeking at
their own invitation, second tier SEMI-TRUSTED is a circle of masked dancers
each holding one puzzle piece and none can see the full picture, third tier
VERIFIER is a calm butler with a magnifying glass inspecting a sealed wax
envelope, bottom tier EXTERNAL is an open sunny courtyard with a traditional
postman delivering mail, glass walls between each tier show what can and cannot
pass through, elegant architectural cross-section, soft cream and navy palette,
technical fashion illustration style, --ar 9:16"
```

**Negative:** photo, realistic, blurry, nsfw, dark, horror

---

### Usage with diffusers (Python)

```python
from diffusers import StableDiffusionXLPipeline
import torch

pipe = StableDiffusionXLPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    torch_dtype=torch.float16,
).to("cuda")

prompts = [
    "a whimsical isometric blueprint of a message relay system...",  # paste full prompt
    # ... etc
]

for i, prompt in enumerate(prompts):
    image = pipe(
        prompt=prompt,
        negative_prompt="photo, realistic, blurry, watermark",
        num_inference_steps=40,
        guidance_scale=8.0,
    ).images[0]
    image.save(f"protocol_flow_{i+1}.png")
```
