# JasWave Electric Guitar – VST3 instrumento independiente de guitarra eléctrica
cmake_minimum_required(VERSION 3.25)
project(jaswave_electric_guitar VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveElectricGuitar SOURCES source/electric_guitar_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")
