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
# Core Executable
add_executable(mpcauth_server mpcauth_server.cpp)

target_link_libraries(mpcauth_server
    ${EMP_ZK_LIB}
    ${EMP_TOOL_LIB}
    OpenSSL::Crypto
    Threads::Threads
)

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
