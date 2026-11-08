cmake_minimum_required(VERSION 3.18)

# ---------------------------------------------------------------------------
# SafeDash Unit Tests (builds in host simulation mode)
# ---------------------------------------------------------------------------

# Simple CTest-based tests — no heavy test framework dependency

add_executable(test_protocol
    test_protocol.c
)
target_link_libraries(test_protocol safedash_common)
target_include_directories(test_protocol PRIVATE ../src/common)

add_test(NAME ProtocolSerializationTest COMMAND test_protocol)

# If GoogleTest is available, include it
find_package(GTest QUIET)
if(GTest_FOUND)
    add_executable(test_can_handler
        test_can_handler.cpp
    )
    target_link_libraries(test_can_handler safedash_common GTest::gtest_main)
    target_include_directories(test_can_handler PRIVATE ../src/common)
    add_test(NAME CANHandlerTest COMMAND test_can_handler)
endif()
