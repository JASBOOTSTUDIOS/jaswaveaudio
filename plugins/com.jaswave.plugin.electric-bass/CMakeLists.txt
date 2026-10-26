# JasWave Electric Bass – VST3 instrumento independiente de bajo eléctrico
cmake_minimum_required(VERSION 3.25)
project(jaswave_electric_bass VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveElectricBass SOURCES source/electric_bass_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")
