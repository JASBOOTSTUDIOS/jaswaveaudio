# JasWave Electro Drums – VST3 instrumento independiente: caja de ritmos electrónica sintetizada (sin muestras)
cmake_minimum_required(VERSION 3.25)
project(jaswave_electro_drums VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveElectroDrums SOURCES source/electro_drums_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")

# Prueba de render offline (solo el DSP, sin VST3): pico, RMS, duración, f0 del bombo, espectro, choke, clics, NaN, determinismo y CPU
#   JasWaveElectroDrums_rendertest <salida.wav>
add_executable(JasWaveElectroDrums_rendertest test/render_test.cpp)
target_include_directories(JasWaveElectroDrums_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/source" "${JW_PLUGINS_ROOT}/shared-dsp")
target_compile_definitions(JasWaveElectroDrums_rendertest PRIVATE NOMINMAX)
if(MSVC)
  target_compile_options(JasWaveElectroDrums_rendertest PRIVATE /O2 /EHsc /W3 /fp:precise /utf-8)
  target_compile_definitions(JasWaveElectroDrums_rendertest PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()
set_target_properties(JasWaveElectroDrums_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
