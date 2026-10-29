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
  com.jaswave.plugin.vocal-tune
  com.jaswave.plugin.utility-tool
  com.jaswave.plugin.pedal-fix
  com.jaswave.plugin.piano-synth
  com.jaswave.plugin.roles-vst
  com.jaswave.plugin.sampler
  com.jaswave.plugin.ambience)

# Audio Lens: plugin sin terminar desde a81763b (Controller sin createEditor() y bus de tipo incorrecto): no compila.
# Fuera del build conjunto hasta que se complete; activar con -DJW_BUILD_AUDIO_LENS=ON para trabajar en él.
option(JW_BUILD_AUDIO_LENS "Compilar Audio Lens (en desarrollo, no compila)" OFF)
if(JW_BUILD_AUDIO_LENS)
  list(APPEND JW_PLUGIN_DIRS com.jaswave.plugin.audio-lens)
endif()

# Suite de 7 instrumentos independientes (6 + Ambient Atmos; un VST3 por instrumento). Cada uno compila solo y pasa el validator
# del SDK; OFF permite excluirlos si falta tiempo de CI.
option(JW_BUILD_INSTRUMENTS "Compilar la suite de 7 instrumentos" ON)
if(JW_BUILD_INSTRUMENTS)
  list(APPEND JW_PLUGIN_DIRS
    com.jaswave.plugin.grand-piano
    com.jaswave.plugin.worship-drums
    com.jaswave.plugin.electric-bass
    com.jaswave.plugin.electric-guitar
    com.jaswave.plugin.shimmer-pad
    com.jaswave.plugin.strings-section
    com.jaswave.plugin.ambient-atmos)
endif()
foreach(_d ${JW_PLUGIN_DIRS})
  add_subdirectory(${_d})
endforeach()
add_subdirectory(tests)
