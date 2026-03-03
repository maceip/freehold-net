#!/usr/bin/env bash
#
# Build OpenPetition mpcauth_server and all dependencies on macOS.
# Supports both x86_64 (Intel) and arm64 (Apple Silicon).
# Produces: dist/macos-{arch}/mpcauth_server (single unified binary)
#
# Usage: ./build-scripts/build-macos.sh
# Requirements: Xcode CLT, Homebrew
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="$(uname -m)"  # x86_64 or arm64
DIST="${ROOT}/dist/macos-${ARCH}"
DEPS="${ROOT}/.build-deps"
NPROC=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)

echo "=== OpenPetition MPC Auth — macOS Build (${ARCH}) ==="
echo "Root: ${ROOT}"
echo "Parallel: ${NPROC} jobs"

# ──────────────────────────────────────────────
# 1. System packages (Homebrew)
# ──────────────────────────────────────────────
install_system_deps() {
    echo "--- Installing system dependencies via Homebrew ---"
    if ! command -v brew >/dev/null 2>&1; then
        echo "ERROR: Homebrew not found. Install from https://brew.sh"
        exit 1
    fi
    brew list openssl  2>/dev/null || brew install openssl
    brew list blake3   2>/dev/null || brew install blake3
    brew list pkg-config 2>/dev/null || brew install pkg-config
    brew list cmake    2>/dev/null || brew install cmake
    brew list gmp      2>/dev/null || brew install gmp
    brew list autoconf 2>/dev/null || brew install autoconf
    brew list automake 2>/dev/null || brew install automake
    brew list libtool  2>/dev/null || brew install libtool
    brew list wget     2>/dev/null || brew install wget

    # Set OpenSSL paths for cmake
    export OPENSSL_ROOT_DIR="$(brew --prefix openssl)"
    export PKG_CONFIG_PATH="${OPENSSL_ROOT_DIR}/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
}

# ──────────────────────────────────────────────
# 2. wolfSSL
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
}

# ──────────────────────────────────────────────
# 3. ngtcp2
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
}

# ──────────────────────────────────────────────
# 4. nghttp3
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
}

# ──────────────────────────────────────────────
# 5. EMP toolkit
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

    local extra_flags=""
    if [ "${ARCH}" = "arm64" ]; then
        extra_flags="-DCMAKE_CXX_FLAGS=-march=armv8-a+crypto"
    else
        extra_flags="-DCMAKE_CXX_FLAGS=-march=x86-64-v2"
    fi

    cmake -DCMAKE_BUILD_TYPE=Release ${extra_flags} \
          -DOPENSSL_ROOT_DIR="$(brew --prefix openssl)" .
    make -j"${NPROC}"
    sudo make install
}

# ──────────────────────────────────────────────
# 6. JesseQ v1 (emp-zk)
# ──────────────────────────────────────────────
build_jesseq_v1() {
    echo "--- Building JesseQ v1 (emp-zk) ---"
    cd "${ROOT}/reference/JesseQ/JQv1"

    local arch_flags=""
    if [ "${ARCH}" = "arm64" ]; then
        arch_flags="-DCMAKE_CXX_FLAGS=-march=armv8-a+crypto"
    fi

    cmake -DCMAKE_BUILD_TYPE=Release ${arch_flags} \
          -DOPENSSL_ROOT_DIR="$(brew --prefix openssl)" .
    make -j"${NPROC}"
    sudo make install
}

# ──────────────────────────────────────────────
# 7. LLSS-MPC
# ──────────────────────────────────────────────
build_llss_mpc() {
    echo "--- Building LLSS-MPC ---"
    cd "${ROOT}/reference/LLSS-MPC/delayedresharing"
    mkdir -p build && cd build
    cmake -DCMAKE_BUILD_TYPE=Release ..
    make -j"${NPROC}"
}

# ──────────────────────────────────────────────
# 8. mpcauth_server
# ──────────────────────────────────────────────
build_server() {
    echo "--- Building mpcauth_server ---"
    cd "${ROOT}/src/server"
    mkdir -p build && cd build

    local arch_flags=""
    if [ "${ARCH}" = "arm64" ]; then
        arch_flags="-march=armv8-a+crypto"
    else
        arch_flags="-march=x86-64-v2"
    fi

    cmake \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CXX_FLAGS="${arch_flags} -O3 -fstack-protector-strong -D_FORTIFY_SOURCE=2" \
        -DOPENSSL_ROOT_DIR="$(brew --prefix openssl)" \
        ..
    make -j"${NPROC}"
}

# ──────────────────────────────────────────────
# 9. Bundle
# ──────────────────────────────────────────────
bundle() {
    echo "--- Bundling release ---"
    rm -rf "${DIST}"
    mkdir -p "${DIST}/bin"
    mkdir -p "${DIST}/circuits"
    mkdir -p "${DIST}/lib"
    mkdir -p "${DIST}/certs"

    # Binary
    cp "${ROOT}/src/server/build/mpcauth_server" "${DIST}/bin/"
    strip "${DIST}/bin/mpcauth_server" 2>/dev/null || true

    # Circuits
    for circuit in AES-non-expanded.txt sha256.txt base64.txt; do
        find "${ROOT}/reference/JesseQ" -name "${circuit}" -exec cp {} "${DIST}/circuits/" \; 2>/dev/null || true
    done
    if [ -f "${ROOT}/reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt" ]; then
        cp "${ROOT}/reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt" "${DIST}/circuits/"
    fi

    # Shared libraries
    for lib in libemp-tool.dylib libemp-ot.dylib libemp-zk.dylib libwolfssl.dylib libblake3.dylib libngtcp2.dylib libngtcp2_crypto_wolfssl.dylib libnghttp3.dylib; do
        find /usr/local/lib -name "${lib}*" -exec cp {} "${DIST}/lib/" \; 2>/dev/null || true
    done

    # Fix dylib rpaths
    if [ -f "${DIST}/bin/mpcauth_server" ]; then
        install_name_tool -add_rpath "@executable_path/../lib" "${DIST}/bin/mpcauth_server" 2>/dev/null || true
    fi

    # Launcher
    cat > "${DIST}/bin/run-mpcauth.sh" << 'LAUNCHER'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export DYLD_LIBRARY_PATH="${DIR}/lib:${DYLD_LIBRARY_PATH:-}"
exec "${DIR}/bin/mpcauth_server" "$@"
LAUNCHER
    chmod +x "${DIST}/bin/run-mpcauth.sh"

    # README
    cat > "${DIST}/README.txt" << EOF
OpenPetition MPC Auth Server — macOS ${ARCH}

Usage:
  export CLUSTER_BFT_EPOCH=1
  ./bin/run-mpcauth.sh --party 1 --port 5871 --circuit circuits/sha256.txt --shard <hex>

Run with --help for all options.
EOF

    echo ""
    echo "=== macOS (${ARCH}) bundle complete: ${DIST} ==="
    ls -la "${DIST}/bin/"
}

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
install_system_deps
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
