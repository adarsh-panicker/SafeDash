# SafeDash — QNX SDP 8.0 Toolchain File
# Usage: cmake -S . -B build-qnx -DCMAKE_TOOLCHAIN_FILE=scripts/qnx-toolchain.cmake

set(CMAKE_SYSTEM_NAME QNX)
set(CMAKE_SYSTEM_VERSION 8.0)

# Require QNX_HOST and QNX_TARGET to be set in environment
if(NOT DEFINED ENV{QNX_HOST})
    message(FATAL_ERROR
        "QNX_HOST environment variable is not set.\n"
        "Source your QNX SDP environment first:\n"
        "  source /path/to/qnx800/qnxsdp-env.sh")
endif()

if(NOT DEFINED ENV{QNX_TARGET})
    message(FATAL_ERROR "QNX_TARGET environment variable is not set.")
endif()

set(QNX_HOST    "$ENV{QNX_HOST}")
set(QNX_TARGET  "$ENV{QNX_TARGET}")

# Detect host OS for compiler binary extension
if(CMAKE_HOST_WIN32)
    set(HOST_EXT ".exe")
else()
    set(HOST_EXT "")
endif()

# Default target CPU: x86_64. Override with -DQNX_CPUVARDIR=aarch64le for ARM64
set(QNX_CPUVARDIR "x86_64" CACHE STRING "QNX CPU variant directory (x86_64, aarch64le, armv7le)")

set(CMAKE_C_COMPILER   "${QNX_HOST}/usr/bin/qcc${HOST_EXT}")
set(CMAKE_CXX_COMPILER "${QNX_HOST}/usr/bin/q++${HOST_EXT}")
set(CMAKE_AR           "${QNX_HOST}/usr/bin/qcc-ar${HOST_EXT}")

# CPU-specific flags
if(QNX_CPUVARDIR STREQUAL "x86_64")
    set(QNX_CFLAGS "-Vgcc_ntox86_64")
elseif(QNX_CPUVARDIR STREQUAL "aarch64le")
    set(QNX_CFLAGS "-Vgcc_ntoaarch64le")
elseif(QNX_CPUVARDIR STREQUAL "armv7le")
    set(QNX_CFLAGS "-Vgcc_ntoarmv7le")
else()
    message(FATAL_ERROR "Unknown QNX_CPUVARDIR: ${QNX_CPUVARDIR}")
endif()

set(CMAKE_C_FLAGS_INIT   "${QNX_CFLAGS}")
set(CMAKE_CXX_FLAGS_INIT "${QNX_CFLAGS}")

# Sysroot
set(CMAKE_SYSROOT "${QNX_TARGET}")
set(CMAKE_FIND_ROOT_PATH "${QNX_TARGET}")

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)

message(STATUS "QNX Toolchain:")
message(STATUS "  Host:     ${QNX_HOST}")
message(STATUS "  Target:   ${QNX_TARGET}")
message(STATUS "  CPU:      ${QNX_CPUVARDIR}")
message(STATUS "  CC:       ${CMAKE_C_COMPILER} ${QNX_CFLAGS}")
