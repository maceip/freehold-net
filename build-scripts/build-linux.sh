#!/usr/bin/env bash
#
# Build OpenPetition mpcauth_server and all dependencies on Linux (x86_64).
# Produces: dist/linux-x86_64/mpcauth_server (static binary + runtime files)
#
# Usage: ./build-scripts/build-linux.sh
# Requirements: Ubuntu 20.04+ / Debian 11+ (apt-get), or RHEL/Fedora (yum)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${ROOT}/dist/linux-x86_64"
DEPS="${ROOT}/.build-deps"
NPROC=$(nproc 2>/dev/null || echo 4)

echo "=== OpenPetition MPC Auth — Linux Build ==="
echo "Root: ${ROOT}"
echo "Parallel: ${NPROC} jobs"

# ──────────────────────────────────────────────
# 1. System packages
# ──────────────────────────────────────────────
install_system_deps() {
    echo "--- Installing system dependencies ---"
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq \
            cmake git build-essential pkg-config \
            libssl-dev libgmp-dev \
            autoconf automake libtool wget
    elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y \
            cmake gcc gcc-c++ make git pkg-config \
            openssl-devel gmp-devel \
            autoconf automake libtool wget
    else
        echo "ERROR: No supported package manager (apt-get or yum)."
        exit 1
    fi
}

# ──────────────────────────────────────────────
# 2. BLAKE3 (C library)
# ──────────────────────────────────────────────
build_blake3() {
    echo "--- Building BLAKE3 ---"
    mkdir -p "${DEPS}" && cd "${DEPS}"
    if [ ! -d "BLAKE3" ]; then
        git clone --depth 1 https://github.com/BLAKE3-team/BLAKE3.git
    fi
    cd BLAKE3/c
    cmake -DBUILD_SHARED_LIBS=ON -DCMAKE_BUILD_TYPE=Release .
    make -j"${NPROC}"
    sudo make install
    sudo ldconfig
}

# ──────────────────────────────────────────────
# 3. wolfSSL
# ──────────────────────────────────────────────
build_wolfssl() {
    echo "--- Building wolfSSL ---"
    mkdir -p "${DEPS}" && cd "${DEPS}"
    if [ ! -d "wolfssl" ]; then
        git clone --depth 1 --branch v5.7.6-stable https://github.com/wolfSSL/wolfssl.git
    fi
    cd wolfssl
    autoreconf -fi
    ./configure \
        --enable-tls13 \
        --enable-aesgcm \
        --enable-aesctr \
        --enable-hkdf \
        --enable-keygen \
        --enable-opensslextra \
        --enable-static \
        --enable-shared \
        --prefix=/usr/local
    make -j"${NPROC}"
    sudo make install
    sudo ldconfig
}

# ──────────────────────────────────────────────
# 4. EMP toolkit (emp-tool, emp-ot)
# ──────────────────────────────────────────────
build_emp_component() {
    local name="$1"
    local branch="${2:-master}"
    echo "--- Building ${name} (branch: ${branch}) ---"
    mkdir -p "${DEPS}" && cd "${DEPS}"
    if [ ! -d "${name}" ]; then
        git clone --depth 1 --branch "${branch}" "https://github.com/emp-toolkit/${name}.git"
    fi
    cd "${name}"
    cmake -DCMAKE_BUILD_TYPE=Release .
    make -j"${NPROC}"
    sudo make install
    sudo ldconfig
}

# ──────────────────────────────────────────────
# 5. JesseQ v1 (emp-zk)
# ──────────────────────────────────────────────
build_jesseq_v1() {
    echo "--- Building JesseQ v1 (emp-zk) ---"
    cd "${ROOT}/reference/JesseQ/JQv1"
    cmake -DCMAKE_BUILD_TYPE=Release .
    make -j"${NPROC}"
    sudo make install
    sudo ldconfig
}

# ──────────────────────────────────────────────
# 6. LLSS-MPC (delayedresharing)
# ──────────────────────────────────────────────
build_llss_mpc() {
    echo "--- Building LLSS-MPC ---"
    cd "${ROOT}/reference/LLSS-MPC/delayedresharing"
    mkdir -p build && cd build
    cmake -DCMAKE_BUILD_TYPE=Release ..
    make -j"${NPROC}"
    # Don't sudo install — just record path for server build
    echo "LLSS lib: $(pwd)"
}

# ──────────────────────────────────────────────
# 7. mpcauth_server
# ──────────────────────────────────────────────
build_server() {
    echo "--- Building mpcauth_server ---"
    cd "${ROOT}/src/server"
    mkdir -p build && cd build
    cmake \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CXX_FLAGS="-march=x86-64-v2 -O3 -fstack-protector-strong -D_FORTIFY_SOURCE=2" \
        ..
    make -j"${NPROC}"
}

# ──────────────────────────────────────────────
# 8. Bundle release assets
# ──────────────────────────────────────────────
bundle() {
    echo "--- Bundling release ---"
    rm -rf "${DIST}"
    mkdir -p "${DIST}/bin"
    mkdir -p "${DIST}/circuits"
    mkdir -p "${DIST}/python"
    mkdir -p "${DIST}/certs"

    # Binary
    cp "${ROOT}/src/server/build/mpcauth_server" "${DIST}/bin/"
    strip "${DIST}/bin/mpcauth_server"

    # Bristol circuits
    for circuit in AES-non-expanded.txt sha256.txt; do
        find "${ROOT}/reference/JesseQ" -name "${circuit}" -exec cp {} "${DIST}/circuits/" \; 2>/dev/null || true
    done
    if [ -f "${ROOT}/reference/JesseQ/JQv1/test/bool/base64.txt" ]; then
        cp "${ROOT}/reference/JesseQ/JQv1/test/bool/base64.txt" "${DIST}/circuits/"
    fi

    # LLSS circuit
    if [ -f "${ROOT}/reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt" ]; then
        cp "${ROOT}/reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt" "${DIST}/circuits/"
    fi

    # Python components
    cp "${ROOT}/src/server/forwarder.py" "${DIST}/python/"
    cp "${ROOT}/src/client/sharding.py" "${DIST}/python/" 2>/dev/null || true
    cp "${ROOT}/src/demo_e2e.py" "${DIST}/python/" 2>/dev/null || true
    cp "${ROOT}/src/enroll_test.py" "${DIST}/python/" 2>/dev/null || true

    # Shared libraries needed at runtime
    mkdir -p "${DIST}/lib"
    for lib in libemp-tool.so libemp-ot.so libemp-zk.so libwolfssl.so libblake3.so; do
        find /usr/local/lib -name "${lib}*" -exec cp {} "${DIST}/lib/" \; 2>/dev/null || true
    done

    # Launcher script
    cat > "${DIST}/bin/run-mpcauth.sh" << 'LAUNCHER'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export LD_LIBRARY_PATH="${DIR}/lib:${LD_LIBRARY_PATH:-}"
exec "${DIR}/bin/mpcauth_server" "$@"
LAUNCHER
    chmod +x "${DIST}/bin/run-mpcauth.sh"

    # Readme
    cat > "${DIST}/README.txt" << 'EOF'
OpenPetition MPC Auth Server — Linux x86_64

Usage:
  export CLUSTER_BFT_EPOCH=1
  export MPC_NODE_COUNT=5
  ./bin/run-mpcauth.sh <party 1|2> <port> <circuit_file> <shard_hex>

Files:
  bin/mpcauth_server    - MPC authentication server binary
  bin/run-mpcauth.sh    - Launcher with LD_LIBRARY_PATH set
  circuits/             - Bristol format circuit files
  lib/                  - Shared libraries (emp-tool, emp-ot, emp-zk, wolfSSL, BLAKE3)
  python/forwarder.py   - SMTP forwarder gateway
  python/sharding.py    - Shamir secret sharing library
  certs/                - Place mTLS certificates here

Environment Variables:
  CLUSTER_BFT_EPOCH       - BFT consensus epoch number
  MPC_NODE_COUNT          - Number of MPC nodes (2-16)
  MPC_CIRCUIT_PATH        - Path to AES circuit file
  MPC_CLUSTER_KEY         - Path to HMAC key file
  FORWARDER_CERT/KEY      - mTLS certificate/key for forwarder
  CLUSTER_CA              - Cluster CA certificate
  LLSS_IP_PREV/NEXT       - LLSS-MPC neighbor IPs
EOF

    echo ""
    echo "=== Linux bundle complete: ${DIST} ==="
    ls -la "${DIST}/bin/"
}

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
install_system_deps
build_blake3
build_wolfssl
build_emp_component "emp-tool" "master"
build_emp_component "emp-ot" "master"
build_jesseq_v1
build_llss_mpc
build_server
bundle

echo ""
echo "Done. Release assets in: ${DIST}"
