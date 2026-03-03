#!/usr/bin/env bash
#
# Build OpenPetition mpcauth_server and all dependencies on Windows.
# Must be run inside MSYS2 MinGW64 shell (not MSVC — emp-toolkit needs __int128).
# Produces: dist/windows-x86_64/mpcauth_server.exe (single unified binary)
#
# Usage: ./build-scripts/build-windows.sh
# Requirements: MSYS2 with MinGW-w64 toolchain
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${ROOT}/dist/windows-x86_64"
DEPS="${ROOT}/.build-deps"
NPROC=$(nproc 2>/dev/null || echo 4)
MINGW_PREFIX="${MINGW_PREFIX:-/mingw64}"

echo "=== OpenPetition MPC Auth — Windows Build (x86_64, MinGW-w64) ==="
echo "Root: ${ROOT}"
echo "MinGW prefix: ${MINGW_PREFIX}"
echo "Parallel: ${NPROC} jobs"

# Verify we're in MSYS2 MinGW64
if [ -z "${MSYSTEM:-}" ] || [ "${MSYSTEM}" != "MINGW64" ]; then
    echo "ERROR: This script must be run inside MSYS2 MinGW64 shell."
    echo "       Open 'MSYS2 MinGW 64-bit' from Start menu, then run this script."
    exit 1
fi

# ──────────────────────────────────────────────
# 1. System packages (pacman)
# ──────────────────────────────────────────────
install_system_deps() {
    echo "--- Installing system dependencies via pacman ---"
    pacman -S --noconfirm --needed \
        mingw-w64-x86_64-gcc \
        mingw-w64-x86_64-cmake \
        mingw-w64-x86_64-make \
        mingw-w64-x86_64-pkg-config \
        mingw-w64-x86_64-openssl \
        mingw-w64-x86_64-gmp \
        mingw-w64-x86_64-autotools \
        mingw-w64-x86_64-libtool \
        git wget make autoconf automake
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
    cmake -G "MinGW Makefiles" -DBUILD_SHARED_LIBS=ON -DCMAKE_BUILD_TYPE=Release \
          -DCMAKE_INSTALL_PREFIX="${MINGW_PREFIX}" .
    mingw32-make -j"${NPROC}"
    mingw32-make install
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
        --host=x86_64-w64-mingw32 \
        --enable-tls13 \
        --enable-aesgcm \
        --enable-aesctr \
        --enable-hkdf \
        --enable-keygen \
        --enable-opensslextra \
        --enable-quic \
        --enable-static \
        --enable-shared \
        --prefix="${MINGW_PREFIX}"
    make -j"${NPROC}"
    make install
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
        --host=x86_64-w64-mingw32 \
        --with-wolfssl \
        --enable-lib-only \
        --prefix="${MINGW_PREFIX}" \
        PKG_CONFIG_PATH="${MINGW_PREFIX}/lib/pkgconfig"
    make -j"${NPROC}"
    make install
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
        --host=x86_64-w64-mingw32 \
        --enable-lib-only \
        --prefix="${MINGW_PREFIX}"
    make -j"${NPROC}"
    make install
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

    # Patch emp-tool NetIO for MinGW Winsock2 if needed
    if [ "${name}" = "emp-tool" ]; then
        patch_emp_tool_for_mingw
    fi

    cmake -G "MinGW Makefiles" \
          -DCMAKE_BUILD_TYPE=Release \
          -DCMAKE_CXX_FLAGS="-march=x86-64-v2" \
          -DCMAKE_INSTALL_PREFIX="${MINGW_PREFIX}" \
          -DOPENSSL_ROOT_DIR="${MINGW_PREFIX}" .
    mingw32-make -j"${NPROC}"
    mingw32-make install
}

patch_emp_tool_for_mingw() {
    echo "--- Patching emp-tool for MinGW Winsock2 ---"
    local netio_h="emp-tool/io/net_io_channel.h"
    if [ -f "${netio_h}" ] && ! grep -q "ws2_32" "${netio_h}" 2>/dev/null; then
        sed -i '1s/^/#ifdef _WIN32\n#include <winsock2.h>\n#include <ws2tcpip.h>\n#pragma comment(lib, "ws2_32")\n#endif\n/' "${netio_h}"
    fi

    if [ -f "CMakeLists.txt" ] && ! grep -q "ws2_32" "CMakeLists.txt" 2>/dev/null; then
        echo 'if(WIN32)' >> CMakeLists.txt
        echo '  target_link_libraries(emp-tool ws2_32)' >> CMakeLists.txt
        echo 'endif()' >> CMakeLists.txt
    fi
}

# ──────────────────────────────────────────────
# 7. JesseQ v1 (emp-zk)
# ──────────────────────────────────────────────
build_jesseq_v1() {
    echo "--- Building JesseQ v1 (emp-zk) ---"
    cd "${ROOT}/reference/JesseQ/JQv1"
    cmake -G "MinGW Makefiles" \
          -DCMAKE_BUILD_TYPE=Release \
          -DCMAKE_INSTALL_PREFIX="${MINGW_PREFIX}" \
          -DOPENSSL_ROOT_DIR="${MINGW_PREFIX}" .
    mingw32-make -j"${NPROC}"
    mingw32-make install
}

# ──────────────────────────────────────────────
# 8. LLSS-MPC
# ──────────────────────────────────────────────
build_llss_mpc() {
    echo "--- Building LLSS-MPC ---"
    cd "${ROOT}/reference/LLSS-MPC/delayedresharing"
    mkdir -p build && cd build
    cmake -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release ..
    mingw32-make -j"${NPROC}"
}

# ──────────────────────────────────────────────
# 9. mpcauth_server
# ──────────────────────────────────────────────
build_server() {
    echo "--- Building mpcauth_server ---"
    cd "${ROOT}/src/server"
    mkdir -p build && cd build
    cmake -G "MinGW Makefiles" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CXX_FLAGS="-march=x86-64-v2 -O3 -fstack-protector-strong -D_FORTIFY_SOURCE=2" \
        -DCMAKE_INSTALL_PREFIX="${MINGW_PREFIX}" \
        -DOPENSSL_ROOT_DIR="${MINGW_PREFIX}" \
        -DCMAKE_EXE_LINKER_FLAGS="-lws2_32" \
        ..
    mingw32-make -j"${NPROC}"
}

# ──────────────────────────────────────────────
# 10. Bundle release assets
# ──────────────────────────────────────────────
bundle() {
    echo "--- Bundling release ---"
    rm -rf "${DIST}"
    mkdir -p "${DIST}/bin"
    mkdir -p "${DIST}/circuits"
    mkdir -p "${DIST}/lib"
    mkdir -p "${DIST}/certs"

    # Binary
    cp "${ROOT}/src/server/build/mpcauth_server.exe" "${DIST}/bin/"
    strip "${DIST}/bin/mpcauth_server.exe" 2>/dev/null || true

    # Bristol circuits
    for circuit in AES-non-expanded.txt sha256.txt base64.txt; do
        find "${ROOT}/reference/JesseQ" -name "${circuit}" -exec cp {} "${DIST}/circuits/" \; 2>/dev/null || true
    done
    if [ -f "${ROOT}/reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt" ]; then
        cp "${ROOT}/reference/LLSS-MPC/OptimizedCircuits/mpcauth_dynamic.txt" "${DIST}/circuits/"
    fi

    # Runtime DLLs from MinGW
    for dll in libemp-tool.dll libemp-ot.dll libemp-zk.dll libwolfssl.dll libblake3.dll libngtcp2.dll libngtcp2_crypto_wolfssl.dll libnghttp3.dll; do
        find "${MINGW_PREFIX}/bin" "${MINGW_PREFIX}/lib" -name "${dll}*" -exec cp {} "${DIST}/lib/" \; 2>/dev/null || true
    done

    # MinGW runtime DLLs needed by the binary
    for rt_dll in libgcc_s_seh-1.dll libstdc++-6.dll libwinpthread-1.dll; do
        if [ -f "${MINGW_PREFIX}/bin/${rt_dll}" ]; then
            cp "${MINGW_PREFIX}/bin/${rt_dll}" "${DIST}/lib/"
        fi
    done

    # OpenSSL / GMP DLLs
    for dep_dll in libssl-3-x64.dll libcrypto-3-x64.dll libgmp-10.dll; do
        if [ -f "${MINGW_PREFIX}/bin/${dep_dll}" ]; then
            cp "${MINGW_PREFIX}/bin/${dep_dll}" "${DIST}/lib/"
        fi
    done

    # Launcher batch file
    cat > "${DIST}/bin/run-mpcauth.bat" << 'LAUNCHER'
@echo off
setlocal
set "DIR=%~dp0.."
set "PATH=%DIR%\lib;%PATH%"
"%DIR%\bin\mpcauth_server.exe" %*
LAUNCHER

    # PowerShell launcher
    cat > "${DIST}/bin/run-mpcauth.ps1" << 'PSLAUNCHER'
$Dir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:PATH = "$Dir\lib;$env:PATH"
& "$Dir\bin\mpcauth_server.exe" @args
PSLAUNCHER

    # README
    cat > "${DIST}/README.txt" << EOF
OpenPetition MPC Auth Server — Windows x86_64 (MinGW-w64)

Requirements:
  - Windows 10/11 x86_64
  - CPU with AES-NI support (Intel Westmere+ / AMD Bulldozer+)

Usage:
  set CLUSTER_BFT_EPOCH=1
  bin\\run-mpcauth.bat --party 1 --port 5871 --circuit circuits\\sha256.txt --shard <hex>

  Or with PowerShell:
  \$env:CLUSTER_BFT_EPOCH = "1"
  .\\bin\\run-mpcauth.ps1 --party 1 --port 5871 --circuit circuits\\sha256.txt --shard <hex>

Run with --help for all options.

Build Note:
  Built with MSYS2 MinGW-w64 (not MSVC) because emp-toolkit
  requires __int128 and POSIX-compatible socket APIs.
EOF

    echo ""
    echo "=== Windows bundle complete: ${DIST} ==="
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
