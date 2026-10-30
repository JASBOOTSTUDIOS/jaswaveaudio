# JasWave Strings Section – VST3 instrumento independiente de ensamble de cuerdas
cmake_minimum_required(VERSION 3.25)
project(jaswave_strings_section VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveStringsSection SOURCES source/strings_section_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")

# Prueba de render offline (solo el DSP, sin VST3): afinación, nivel, CPU, clics, DC, WAV 24-bit
add_executable(JasWaveStringsSection_rendertest test/render_test.cpp)
target_include_directories(JasWaveStringsSection_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/source" "${JW_PLUGINS_ROOT}/shared-dsp")
target_compile_definitions(JasWaveStringsSection_rendertest PRIVATE NOMINMAX)
if(MSVC)
  target_compile_options(JasWaveStringsSection_rendertest PRIVATE /W3 /utf-8 /EHsc /permissive- /fp:precise /O2)
endif()
set_target_properties(JasWaveStringsSection_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
