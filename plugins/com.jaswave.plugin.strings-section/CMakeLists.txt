# JasWave Strings Section – VST3 instrumento independiente de ensamble de cuerdas
cmake_minimum_required(VERSION 3.25)
project(jaswave_strings_section VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveStringsSection SOURCES source/strings_section_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")
