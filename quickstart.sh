#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PIDS=()

cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    echo -e "${GREEN}All processes stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

info()  { echo -e "${CYAN}[*]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Prerequisite checks ──────────────────────────────────────────────
info "Checking prerequisites..."

command -v cmake   >/dev/null 2>&1 || fail "cmake not found"
command -v node    >/dev/null 2>&1 || fail "node not found"
command -v npm     >/dev/null 2>&1 || fail "npm not found"

ok "All prerequisites found"

# ── Step 1: Build C++ server (single unified binary) ─────────────────
info "Building mpcauth_server..."
(
    cd src/server
    cmake -B build
    cmake --build build
)
ok "mpcauth_server built"

# ── Step 2: Start MPC Node 1 ────────────────────────────────────────
# The unified binary includes discovery server, SMTP forwarder, and
# Freehold relay client. No separate Python or Rust processes needed.
info "Starting MPC Node 1 (party=1, all services embedded)..."
CLUSTER_BFT_EPOCH="${CLUSTER_BFT_EPOCH:-1}" \
    ./src/server/build/mpcauth_server \
    --party 1 --port 5871 \
    --circuit reference/JesseQ/batchman/JQv1/sha256.txt \
    --shard 0000000000000000 \
    --relay "${FREEHOLD_RELAY:-relay.stare.network:9999}" &
PIDS+=($!)
ok "MPC Node 1 started (PID ${PIDS[-1]})"

sleep 1

# ── Step 3: Start MPC Node 2 ────────────────────────────────────────
info "Starting MPC Node 2 (party=2)..."
CLUSTER_BFT_EPOCH="${CLUSTER_BFT_EPOCH:-1}" \
    ./src/server/build/mpcauth_server \
    --party 2 --port 5871 \
    --circuit reference/JesseQ/batchman/JQv1/sha256.txt \
    --shard 0000000000000000 \
    --no-relay --no-forwarder \
    --discovery-port 5881 \
    --relay "${FREEHOLD_RELAY:-relay.stare.network:9999}" &
PIDS+=($!)
ok "MPC Node 2 started (PID ${PIDS[-1]})"

# ── Step 4: Start web client ────────────────────────────────────────
info "Installing web client dependencies..."
(cd src/web-client && npm install)
ok "Dependencies installed"

RELAY="${FREEHOLD_RELAY:-relay.stare.network:9999}"
info "Starting Vite dev server (foreground)..."
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  All components running. Press Ctrl+C to stop.${NC}"
echo -e "${GREEN}  Relay: $RELAY${NC}"
echo -e "${GREEN}  Discovery: http://localhost:5880/health${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
(cd src/web-client && npm run dev)
