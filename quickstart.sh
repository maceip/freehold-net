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
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Prerequisite checks ──────────────────────────────────────────────
info "Checking prerequisites..."

command -v cmake   >/dev/null 2>&1 || fail "cmake not found"
command -v python3 >/dev/null 2>&1 || fail "python3 not found"
command -v node    >/dev/null 2>&1 || fail "node not found"
command -v npm     >/dev/null 2>&1 || fail "npm not found"
command -v cargo   >/dev/null 2>&1 || fail "cargo (Rust) not found — install from https://rustup.rs"

ok "All prerequisites found"

# ── Step 1a: Build C++ server ─────────────────────────────────────────
info "Building C++ MPC server..."
(
    cd src/server
    cmake -B build
    cmake --build build
)
ok "C++ server built"

# ── Step 1b: Build Freehold bridge ────────────────────────────────────
info "Building Freehold bridge (Rust)..."
cargo build --release -p freehold-bridge
ok "Freehold bridge built"

# ── Step 2: Start Discovery Server ───────────────────────────────────
info "Starting node discovery server (port 5880)..."
python3 src/server/discovery.py &
PIDS+=($!)
sleep 1
ok "Discovery server started (PID ${PIDS[-1]})"

# ── Step 3: Start MPC Node 1 ─────────────────────────────────────────
info "Starting MPC Node 1 (party=1)..."
ALLOW_INSECURE_FORWARDER=true ./src/server/build/mpcauth_server 1 5871 &
PIDS+=($!)
ok "MPC Node 1 started (PID ${PIDS[-1]})"

# ── Step 3: Start MPC Node 2 ─────────────────────────────────────────
info "Starting MPC Node 2 (party=2)..."
ALLOW_INSECURE_FORWARDER=true ./src/server/build/mpcauth_server 2 5871 &
PIDS+=($!)
ok "MPC Node 2 started (PID ${PIDS[-1]})"

# ── Step 4: Start Python forwarder ───────────────────────────────────
info "Starting Python SMTP forwarder..."
ALLOW_INSECURE_FORWARDER=true python3 src/server/forwarder.py &
PIDS+=($!)
ok "Forwarder started (PID ${PIDS[-1]})"

# ── Step 5: Start Freehold bridge ──────────────────────────────────────
info "Starting Freehold relay bridge..."
RELAY="${FREEHOLD_RELAY:-freehold.lit.app:9999}"
./target/release/freehold-bridge --relay "$RELAY" &
PIDS+=($!)
sleep 1
ok "Freehold bridge started (PID ${PIDS[-1]}) -> relay $RELAY"

# ── Step 6: Start web client ─────────────────────────────────────────
info "Installing web client dependencies..."
(cd src/web-client && npm install)
ok "Dependencies installed"

info "Starting Vite dev server (foreground)..."
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  All components running. Press Ctrl+C to stop.${NC}"
echo -e "${GREEN}  Relay: $RELAY${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
(cd src/web-client && npm run dev)
