# Agregador: compila todos los plugins JasWave independientes, sus herramientas de captura y las
# pruebas.  cmake -S plugins -B plugins/build -G "Visual Studio 18 2026" -A x64
#           cmake --build plugins/build --config Release
# El validador del SDK: cmake --build plugins/build --config Release --target validator
cmake_minimum_required(VERSION 3.25)
project(jaswave_plugins VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/cmake/JasWavePlugins.cmake")
jw_setup_shared()

set(JW_PLUGIN_DIRS
  com.jaswave.plugin.param-eq
  com.jaswave.plugin.bus-compressor
  com.jaswave.plugin.truepeak-limiter
  com.jaswave.plugin.smart-deesser
  com.jaswave.plugin.utility-tool
  com.jaswave.plugin.piano-synth
  com.jaswave.plugin.roles-vst
  com.jaswave.plugin.sampler
  com.jaswave.plugin.ambience
  com.jaswave.plugin.audio-lens
  com.jaswave.plugin.grand-piano
  com.jaswave.plugin.worship-drums
  com.jaswave.plugin.electric-bass
  com.jaswave.plugin.electric-guitar
  com.jaswave.plugin.shimmer-pad
  com.jaswave.plugin.strings-section)
foreach(_d ${JW_PLUGIN_DIRS})
  add_subdirectory(${_d})
endforeach()
add_subdirectory(tests)
