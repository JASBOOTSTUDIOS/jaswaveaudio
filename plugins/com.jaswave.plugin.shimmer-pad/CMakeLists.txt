# JasWave Shimmer Pad – VST3 instrumento independiente de sintetizador ambiental
cmake_minimum_required(VERSION 3.25)
project(jaswave_shimmer_pad VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveShimmerPad SOURCES source/shimmer_pad_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")
