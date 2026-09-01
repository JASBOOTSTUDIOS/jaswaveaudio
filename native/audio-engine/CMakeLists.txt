cmake_minimum_required(VERSION 3.16)
project(jaswave_audio LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Prefer node-gyp / binding.gyp for Electron. CMake kept for IDE / CI explorers.
add_library(jaswave_audio_core STATIC src/engine.cpp)
target_include_directories(jaswave_audio_core PUBLIC include)
