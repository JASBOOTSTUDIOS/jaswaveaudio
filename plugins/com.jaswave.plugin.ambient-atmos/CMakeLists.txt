# JasWave Ambient Atmos – VST3 instrumento independiente (guitarras/pads/texturas de sostenido infinito + eco de cinta + reverb shimmer)
cmake_minimum_required(VERSION 3.25)
project(jaswave_ambient_atmos VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveAmbientAtmos SOURCES source/ambient_atmos_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")

# Prueba de render offline (solo ambient_atmos_dsp.h, sin VST3): modelado sin banco y, con --samples, bancos reales.
#   JasWaveAmbientAtmos_rendertest.exe <salida.wav> [--samples]
add_executable(JasWaveAmbientAtmos_rendertest test/render_test.cpp)
target_include_directories(JasWaveAmbientAtmos_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/source" "${JW_PLUGINS_ROOT}/shared-dsp")
target_compile_definitions(JasWaveAmbientAtmos_rendertest PRIVATE NOMINMAX)
if(MSVC)
  target_compile_options(JasWaveAmbientAtmos_rendertest PRIVATE /W3 /utf-8 /EHsc /O2 /fp:precise)
endif()
set_target_properties(JasWaveAmbientAtmos_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
