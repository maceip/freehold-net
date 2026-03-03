cmake_minimum_required(VERSION 3.10)
project(mpcauth_modern)

set(CMAKE_CXX_STANDARD 17)

# Add compiler hardening flags and optimization per 2026 engineering standards
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=native -O3 -fstack-protector-strong -D_FORTIFY_SOURCE=2")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -pie -fPIE")

# Discovery paths for references
set(JESSEQ_PATH ${CMAKE_CURRENT_SOURCE_DIR}/../../reference/JesseQ/JQv1)
set(LLSS_PATH ${CMAKE_CURRENT_SOURCE_DIR}/../../reference/LLSS-MPC)

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${JESSEQ_PATH}
    ${LLSS_PATH}/delayedresharing
    ${LLSS_PATH}/Protocols
)

# Look for required libraries
find_package(Threads REQUIRED)
# In a full build, we'd use custom FindXXX.cmake for EMP, LLSS, and wolfSSL
find_library(EMP_ZK_LIB NAMES emp-zk PATHS ${JESSEQ_PATH}/build/lib REQUIRED)
find_library(EMP_TOOL_LIB NAMES emp-tool REQUIRED)
find_library(EMP_OT_LIB NAMES emp-ot REQUIRED)
find_library(LLSS_LIB NAMES delayedresharing PATHS ${LLSS_PATH}/build/lib REQUIRED)
find_library(WOLFSSL_LIB NAMES wolfssl REQUIRED)
find_library(CRYPTO_LIB NAMES crypto REQUIRED)

# Core Executable
add_executable(mpcauth_server mpcauth_server.cpp)

# Link all required libraries for the full MPC environment
target_link_libraries(mpcauth_server 
    ${EMP_ZK_LIB}
    ${EMP_TOOL_LIB}
    ${EMP_OT_LIB}
    ${LLSS_LIB}
    ${WOLFSSL_LIB}
    ${CRYPTO_LIB}
    Threads::Threads
)
