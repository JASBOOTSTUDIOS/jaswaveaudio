# JasWave Grand Piano – VST3 instrumento independiente de concierto
cmake_minimum_required(VERSION 3.25)
project(jaswave_grand_piano VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveGrandPiano SOURCES source/grand_piano_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")

# Prueba de render offline (solo el *_dsp.h, sin VST3): plugins/build_grand-piano/.../JasWaveGrandPiano_rendertest.exe <salida.wav>
add_executable(JasWaveGrandPiano_rendertest test/render_test.cpp)
target_include_directories(JasWaveGrandPiano_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/source" "${JW_PLUGINS_ROOT}/shared-dsp")
target_compile_definitions(JasWaveGrandPiano_rendertest PRIVATE NOMINMAX)
if(MSVC)
  target_compile_options(JasWaveGrandPiano_rendertest PRIVATE /W3 /utf-8 /EHsc /permissive- /fp:precise)
endif()
set_target_properties(JasWaveGrandPiano_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
