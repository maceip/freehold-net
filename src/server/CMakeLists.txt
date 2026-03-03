cmake_minimum_required(VERSION 3.10)
project(mpcauth_modern)

set(CMAKE_CXX_STANDARD 17)

option(ENABLE_LLSS "Enable LLSS-MPC epoch transitions (requires libOTe/cryptoTools)" OFF)

# Add compiler hardening flags and optimization
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=native -O3 -fstack-protector-strong -D_FORTIFY_SOURCE=2")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -pie -fPIE")

# Discovery paths for references
set(JESSEQ_PATH ${CMAKE_CURRENT_SOURCE_DIR}/../../reference/JesseQ/JQv1)
set(LLSS_PATH ${CMAKE_CURRENT_SOURCE_DIR}/../../reference/LLSS-MPC)

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${JESSEQ_PATH}
)

# Look for required libraries
find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)
find_library(EMP_ZK_LIB NAMES emp-zk REQUIRED)
find_library(EMP_TOOL_LIB NAMES emp-tool REQUIRED)

# QUIC/H3 dependencies — prefer local builds with session-ticket support
find_library(NGTCP2_LIB NAMES ngtcp2
    PATHS /tmp/ngtcp2-install/lib
    NO_DEFAULT_PATH)
if(NOT NGTCP2_LIB)
    find_library(NGTCP2_LIB NAMES ngtcp2 REQUIRED)
endif()

find_library(NGTCP2_CRYPTO_WOLFSSL_LIB NAMES ngtcp2_crypto_wolfssl
    PATHS /tmp/ngtcp2-install/lib
    NO_DEFAULT_PATH)
if(NOT NGTCP2_CRYPTO_WOLFSSL_LIB)
    find_library(NGTCP2_CRYPTO_WOLFSSL_LIB NAMES ngtcp2_crypto_wolfssl REQUIRED)
endif()

find_library(NGHTTP3_LIB NAMES nghttp3 REQUIRED)

find_library(WOLFSSL_LIB NAMES wolfssl
    PATHS /tmp/wolfssl-install/usr/local/lib
    NO_DEFAULT_PATH)
if(NOT WOLFSSL_LIB)
    find_library(WOLFSSL_LIB NAMES wolfssl REQUIRED)
endif()

# Find ngtcp2/nghttp3/wolfssl headers
find_path(NGTCP2_INCLUDE_DIR ngtcp2/ngtcp2.h
    PATHS /tmp/ngtcp2-install/include)
find_path(NGHTTP3_INCLUDE_DIR nghttp3/nghttp3.h)
find_path(WOLFSSL_INCLUDE_DIR wolfssl/ssl.h
    PATHS /tmp/wolfssl-install/usr/local/include)

if(NGTCP2_INCLUDE_DIR)
    include_directories(${NGTCP2_INCLUDE_DIR})
endif()
if(NGHTTP3_INCLUDE_DIR)
    include_directories(${NGHTTP3_INCLUDE_DIR})
endif()
if(WOLFSSL_INCLUDE_DIR)
    include_directories(${WOLFSSL_INCLUDE_DIR})
endif()

# Core Executable — single unified binary
add_executable(mpcauth_server
    mpcauth_server.cpp
    forwarder.cpp
    discovery.cpp
    relay_client.cpp
    h3_proxy.cpp
    smtp_client.cpp
)

target_link_libraries(mpcauth_server
    ${EMP_ZK_LIB}
    ${EMP_TOOL_LIB}
    OpenSSL::SSL
    OpenSSL::Crypto
    Threads::Threads
    ${NGTCP2_LIB}
    ${NGTCP2_CRYPTO_WOLFSSL_LIB}
    ${NGHTTP3_LIB}
    ${WOLFSSL_LIB}
)

# Windows Winsock2
if(WIN32)
    target_link_libraries(mpcauth_server ws2_32)
endif()

if(ENABLE_LLSS)
    include_directories(
        ${LLSS_PATH}/delayedresharing
        ${LLSS_PATH}/Protocols
    )
    find_library(LLSS_LIB NAMES delayedresharing
        PATHS ${LLSS_PATH}/delayedresharing/build
        NO_DEFAULT_PATH)
    if(LLSS_LIB)
        target_link_libraries(mpcauth_server ${LLSS_LIB})
    endif()
    target_compile_definitions(mpcauth_server PRIVATE ENABLE_LLSS=1)
else()
    target_compile_definitions(mpcauth_server PRIVATE ENABLE_LLSS=0)
endif()
