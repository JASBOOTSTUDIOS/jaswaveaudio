# JasWave Electric Guitar – VST3 instrumento independiente de guitarra eléctrica
cmake_minimum_required(VERSION 3.25)
project(jaswave_electric_guitar VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveElectricGuitar SOURCES source/electric_guitar_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")

# Prueba de render offline del motor (solo el *_dsp.h, sin VST3): afinación, seguridad, CPU, WAVs
add_executable(JasWaveElectricGuitar_rendertest test/render_test.cpp)
target_include_directories(JasWaveElectricGuitar_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/source" "${JW_PLUGINS_ROOT}/shared-dsp")
target_compile_definitions(JasWaveElectricGuitar_rendertest PRIVATE NOMINMAX)
if(MSVC)
  target_compile_options(JasWaveElectricGuitar_rendertest PRIVATE /W3 /utf-8 /EHsc /permissive-)
endif()
set_target_properties(JasWaveElectricGuitar_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
