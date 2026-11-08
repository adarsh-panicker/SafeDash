cmake_minimum_required(VERSION 3.18)
project(SafeDash VERSION 1.0.0 LANGUAGES C CXX)

# ---------------------------------------------------------------------------
# Toolchain detection: QNX cross-compile vs. host simulation
# ---------------------------------------------------------------------------
if(DEFINED ENV{QNX_HOST})
    message(STATUS "QNX SDP detected — cross-compiling for QNX target")
    set(SAFEDASH_QNX TRUE)
    set(CMAKE_SYSTEM_NAME QNX)
    set(CMAKE_C_COMPILER   "$ENV{QNX_HOST}/usr/bin/qcc")
    set(CMAKE_CXX_COMPILER "$ENV{QNX_HOST}/usr/bin/q++")
    add_compile_definitions(SAFEDASH_QNX_TARGET=1)
else()
    message(STATUS "No QNX_HOST set — building host simulation mode (Linux/macOS/Windows)")
    set(SAFEDASH_QNX FALSE)
    add_compile_definitions(SAFEDASH_HOST_SIM=1)
endif()

# ---------------------------------------------------------------------------
# Language Standards
# ---------------------------------------------------------------------------
set(CMAKE_C_STANDARD   11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED   ON)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# Common compile options
# ---------------------------------------------------------------------------
if(MSVC)
    add_compile_options(/W4 /WX)
else()
    add_compile_options(-Wall -Wextra -Wpedantic -Wno-unused-parameter)
endif()

# ---------------------------------------------------------------------------
# Include directories
# ---------------------------------------------------------------------------
include_directories(
    ${CMAKE_SOURCE_DIR}/src/common
)

# ---------------------------------------------------------------------------
# Common library (shared protocol & CAN definitions)
# ---------------------------------------------------------------------------
add_library(safedash_common STATIC
    src/common/protocol.c
)
target_include_directories(safedash_common PUBLIC src/common)

# ---------------------------------------------------------------------------
# QNX Resource Manager (only built on QNX target)
# ---------------------------------------------------------------------------
if(SAFEDASH_QNX)
    add_executable(safedash_resmgr
        src/qnx_resmgr/resmgr_main.c
        src/qnx_resmgr/can_handler.c
        src/qnx_resmgr/watchdog.c
    )
    target_link_libraries(safedash_resmgr safedash_common socket)
    target_compile_definitions(safedash_resmgr PRIVATE _QNX_SOURCE)
    install(TARGETS safedash_resmgr DESTINATION /usr/bin)
endif()

# ---------------------------------------------------------------------------
# Telemetry Bridge (builds on both QNX and host)
# ---------------------------------------------------------------------------
add_executable(safedash_bridge
    src/telemetry_bridge/bridge_main.cpp
    src/telemetry_bridge/ws_server.cpp
)
target_link_libraries(safedash_bridge safedash_common)
if(NOT MSVC)
    target_link_libraries(safedash_bridge pthread)
endif()
if(SAFEDASH_QNX)
    target_link_libraries(safedash_bridge socket)
    target_compile_definitions(safedash_bridge PRIVATE _QNX_SOURCE)
else()
    # On host-sim, bridge reads from simulator socket instead of /dev/vehicle_telemetry
    target_compile_definitions(safedash_bridge PRIVATE SAFEDASH_HOST_SIM=1)
endif()

# ---------------------------------------------------------------------------
# Host Simulation Mode: safe cross-platform test harness
# ---------------------------------------------------------------------------
if(NOT SAFEDASH_QNX)
    add_executable(safedash_sim_bridge
        src/telemetry_bridge/bridge_main.cpp
        src/telemetry_bridge/ws_server.cpp
    )
    target_link_libraries(safedash_sim_bridge safedash_common)
    if(NOT MSVC)
        target_link_libraries(safedash_sim_bridge pthread)
    endif()
    target_compile_definitions(safedash_sim_bridge PRIVATE SAFEDASH_HOST_SIM=1)
endif()

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
enable_testing()
add_subdirectory(tests)

# ---------------------------------------------------------------------------
# Installation
# ---------------------------------------------------------------------------
install(DIRECTORY ui/ DESTINATION /opt/safedash/ui)
install(TARGETS safedash_bridge DESTINATION /usr/bin)
