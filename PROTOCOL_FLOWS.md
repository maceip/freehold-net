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

Visual explainers for each protocol diagram. Designed to make cryptographic concepts feel intuitive. Use with SDXL, cfg_scale 7-9, steps 30-50.

### Prompt 1 — "How Your Signature Stays Anonymous" (Linear Timeline)

```
"infographic illustration showing how anonymous petition signing works, left
side a person at a laptop typing an email address, the email visually shatters
into five colored glass fragments that float to five separate locked mailboxes
arranged in a pentagon, the mailboxes cooperate to produce a single sealed
golden envelope without any mailbox seeing the original email, the golden
envelope travels along a guarded bridge to a checkpoint tower, the tower stamps
it approved and launches it as a paper airplane to a distant mail server cloud,
clean flat vector style, labeled steps with arrows, teal blue and warm gold
color scheme, white background, educational diagram, --ar 21:9"
```

**Negative:** photo, realistic, blurry, watermark, dark, gritty, 3d render

### Prompt 2 — "The Signing Journey" (State Machine)

```
"illustrated step-by-step journey map as a winding mountain trail, each stop is
a colorful cabin, first cabin at the trailhead has a person entering their email
at a reception desk, second cabin shows a glowing crystal splitting into five
pieces held by different hands, third cabin is a workshop where the pieces power
a machine that produces a sealed letter without anyone reading it, fourth cabin
is a watchtower that checks the letter seal with a magnifying glass then sends
a bird messenger, fifth cabin is a cozy waiting room with someone checking their
phone, sixth cabin is a verification booth with a green checkmark stamp, the
trail forks at the end into a celebration pavilion with confetti or a gentle
detour sign, watercolor hiking map style, warm earth tones, --ar 9:16"
```

**Negative:** photo, realistic, cluttered, dark palette, violence, horror

### Prompt 3 — "Where Your Data Goes" (Data Flow)

```
"educational cutaway poster of a building with four transparent floors, top
floor labeled YOUR BROWSER shows a friendly person putting a letter into a
paper shredder that splits it into five colored strips each going into a
separate pneumatic tube, second floor labeled THE CLUSTER shows five workers
at separate desks each with one strip cooperating through intercoms to build
a locked briefcase without any worker seeing another strip, third floor labeled
THE CHECKPOINT shows a security guard verifying the briefcase has the right
serial number weight and seal, bottom floor labeled THE MAILROOM shows the
approved briefcase being loaded onto a delivery truck, each floor has a simple
one-sentence label explaining what happens, retro science textbook illustration,
muted primary colors, clean annotations, --ar 2:3"
```

**Negative:** photo, realistic, anime, watermark, blurry, dark

### Prompt 4 — "Changing the Guard" (Node Rotation)

```
"split-screen illustration showing a relay team handoff, left side labeled
BEFORE shows five runners in a relay race each carrying a sealed baton fragment
in a different color, right side labeled AFTER shows three new runners receiving
recombined batons through a secure handoff zone in the middle, the key detail
is a glowing golden trophy hovering above the entire scene untouched by any
runner representing the secret that no individual ever possesses, the handoff
zone has a referee ensuring fair transfer, sports illustration style, dynamic
action poses, bright stadium lighting, clean graphic novel linework, --ar 16:9"
```

**Negative:** photo, realistic, dark, horror, blurry, violent

### Prompt 5 — "Who Sees What" (Trust Boundaries)

```
"educational cross-section of a four-story glass building showing privacy zones,
top floor labeled YOU shows a person at a desk who can only see their own screen,
second floor labeled THE SERVERS shows five workers in separate glass offices
each holding one jigsaw piece and none can see the others pieces through frosted
glass walls, third floor labeled THE VERIFIER shows a librarian checking that a
sealed package has the correct stamps and weight without opening it, ground floor
labeled THE MAIL CARRIER shows a postal worker delivering a letter knowing the
address but not whats inside or who wrote it, colored zones green yellow orange
red from bottom to top indicating trust levels, architectural diagram style,
clean pastel palette, informational poster layout, --ar 9:16"
```

**Negative:** photo, realistic, blurry, nsfw, dark, horror, surveillance

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
    "infographic illustration showing how anonymous petition signing works...",
    # paste full prompts from above
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
