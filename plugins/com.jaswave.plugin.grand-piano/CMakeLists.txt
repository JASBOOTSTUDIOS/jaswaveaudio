# JasWave Grand Piano – VST3 instrumento independiente de concierto
cmake_minimum_required(VERSION 3.25)
project(jaswave_grand_piano VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveGrandPiano SOURCES source/grand_piano_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")
