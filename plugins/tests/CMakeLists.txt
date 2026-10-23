cmake_minimum_required(VERSION 3.25)
project(jaswave_plugin_tests VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 1) Autoverificación numérica del DSP (sin SDK, sin UI)
add_executable(jw_dsp_selftest dsp_selftest.cpp)
if(MSVC)
  target_compile_options(jw_dsp_selftest PRIVATE /O2 /EHsc /W3 /fp:precise)
  target_compile_definitions(jw_dsp_selftest PRIVATE NOMINMAX)
endif()
