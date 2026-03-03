#!/usr/bin/env bash
#
# Build OpenPetition mpcauth_server and all dependencies on Linux (x86_64).
# Produces: dist/linux-x86_64/mpcauth_server (single unified binary)
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
        --enable-quic \
        --enable-static \
        --enable-shared \
        --prefix=/usr/local
    make -j"${NPROC}"
    sudo make install
    sudo ldconfig
}

# ──────────────────────────────────────────────
# 4. ngtcp2 (QUIC library with wolfSSL backend)
# ──────────────────────────────────────────────
build_ngtcp2() {
    echo "--- Building ngtcp2 ---"
    mkdir -p "${DEPS}" && cd "${DEPS}"
    if [ ! -d "ngtcp2" ]; then
        git clone --depth 1 https://github.com/ngtcp2/ngtcp2.git
    fi
    cd ngtcp2
    autoreconf -fi
    ./configure \
        --with-wolfssl \
        --enable-lib-only \
        --prefix=/usr/local \
        PKG_CONFIG_PATH=/usr/local/lib/pkgconfig
    make -j"${NPROC}"
    sudo make install
    sudo ldconfig
}

# ──────────────────────────────────────────────
# 5. nghttp3 (HTTP/3 library)
# ──────────────────────────────────────────────
build_nghttp3() {
    echo "--- Building nghttp3 ---"
    mkdir -p "${DEPS}" && cd "${DEPS}"
    if [ ! -d "nghttp3" ]; then
        git clone --depth 1 https://github.com/ngtcp2/nghttp3.git
    fi
    cd nghttp3
    autoreconf -fi
    ./configure \
        --enable-lib-only \
        --prefix=/usr/local
    make -j"${NPROC}"
    sudo make install
    sudo ldconfig
}

# ──────────────────────────────────────────────
# 6. EMP toolkit (emp-tool, emp-ot)
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
# 7. JesseQ v1 (emp-zk)
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
# 8. LLSS-MPC (delayedresharing)
# ──────────────────────────────────────────────
build_llss_mpc() {
    echo "--- Building LLSS-MPC ---"
    cd "${ROOT}/reference/LLSS-MPC/delayedresharing"
    mkdir -p build && cd build
    cmake -DCMAKE_BUILD_TYPE=Release ..
    make -j"${NPROC}"
    echo "LLSS lib: $(pwd)"
}

# ──────────────────────────────────────────────
# 9. mpcauth_server (single unified binary)
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
# 10. Bundle release assets
# ──────────────────────────────────────────────
bundle() {
    echo "--- Bundling release ---"
    rm -rf "${DIST}"
    mkdir -p "${DIST}/bin"
    mkdir -p "${DIST}/circuits"
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

    # Shared libraries needed at runtime
    mkdir -p "${DIST}/lib"
    for lib in libemp-tool.so libemp-ot.so libemp-zk.so libwolfssl.so libblake3.so libngtcp2.so libngtcp2_crypto_wolfssl.so libnghttp3.so; do
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
  ./bin/run-mpcauth.sh --party 1 --port 5871 --circuit circuits/sha256.txt --shard <hex>

Options:
  --party <1|2>          Party ID (ALICE=1, BOB=2)
  --port <port>          MPC listening port
  --circuit <file>       Bristol circuit file path
  --shard <hex>          Identity shard as hex string
  --remote <host>        ALICE's address for BOB (default: 127.0.0.1)
  --relay <host:port>    Freehold relay (default: relay.stare.network:9999)
  --discovery-port <p>   Discovery server port (default: 5880)
  --forwarder-port <p>   SMTP forwarder port (default: 5870)
  --no-relay             Skip Freehold relay registration
  --no-forwarder         Skip SMTP forwarder
  --quiet                Suppress all output except errors
  --verbose              Enable trace-level logging
  --log-level <level>    Set log level (TRACE|DEBUG|INFO|WARN|ERROR)

Files:
  bin/mpcauth_server    - Unified MPC authentication server binary
  bin/run-mpcauth.sh    - Launcher with LD_LIBRARY_PATH set
  circuits/             - Bristol format circuit files
  lib/                  - Shared libraries
  certs/                - Place mTLS certificates here

Environment Variables:
  CLUSTER_BFT_EPOCH       - BFT consensus epoch number
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
build_ngtcp2
build_nghttp3
build_emp_component "emp-tool" "master"
build_emp_component "emp-ot" "master"
build_jesseq_v1
build_llss_mpc
build_server
bundle

echo ""
echo "Done. Release assets in: ${DIST}"
