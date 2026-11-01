# JasWave Vocal Choir – VST3 independiente (coro MIDI de hasta 4 voces con PSOLA que conserva formantes)
cmake_minimum_required(VERSION 3.25)
project(jaswave_vocal_choir VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveVocalChoir SOURCES src/vocal_choir_plugin.cpp)

# Prueba de render offline (solo vocal_choir_dsp.h, sin VST3): NaN, tono por voz, formantes, spread, entrada, CPU.
#   JasWaveVocalChoir_rendertest.exe [salida.wav]
add_executable(JasWaveVocalChoir_rendertest test/render_test.cpp)
target_include_directories(JasWaveVocalChoir_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src" "${JW_PLUGINS_ROOT}/shared-dsp")
target_compile_definitions(JasWaveVocalChoir_rendertest PRIVATE NOMINMAX)
if(MSVC)
  target_compile_options(JasWaveVocalChoir_rendertest PRIVATE /W3 /utf-8 /EHsc /O2 /fp:precise)
endif()
set_target_properties(JasWaveVocalChoir_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
