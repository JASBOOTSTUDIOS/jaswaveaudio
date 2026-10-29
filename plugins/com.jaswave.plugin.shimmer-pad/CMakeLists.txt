# JasWave Shimmer Pad – VST3 instrumento independiente (pad ambiental worship con reverb shimmer FDN)
cmake_minimum_required(VERSION 3.25)
project(jaswave_shimmer_pad VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveShimmerPad SOURCES source/shimmer_pad_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")

# Prueba de render offline (solo shimmer_pad_dsp.h, sin VST3): barrido NaN, RT60, clics, f0, CPU y WAV de progresion.
#   JasWaveShimmerPad_rendertest.exe <salida.wav>
add_executable(JasWaveShimmerPad_rendertest test/render_test.cpp)
target_include_directories(JasWaveShimmerPad_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/source" "${JW_PLUGINS_ROOT}/shared-dsp")
target_compile_definitions(JasWaveShimmerPad_rendertest PRIVATE NOMINMAX)
if(MSVC)
  target_compile_options(JasWaveShimmerPad_rendertest PRIVATE /W3 /utf-8 /EHsc /O2 /fp:precise)
endif()
set_target_properties(JasWaveShimmerPad_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
