# JasWave Worship Drums – VST3 instrumento independiente de batería acústica
cmake_minimum_required(VERSION 3.25)
project(jaswave_worship_drums VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveWorshipDrums SOURCES source/worship_drums_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")
