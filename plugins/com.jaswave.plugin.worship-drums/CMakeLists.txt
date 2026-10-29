# JasWave Worship Drums – VST3 instrumento independiente de batería acústica
cmake_minimum_required(VERSION 3.25)
project(jaswave_worship_drums VERSION 1.0.0 LANGUAGES C CXX)
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/JasWavePlugins.cmake")
jw_setup_shared()
jaswave_add_vst3(TARGET JasWaveWorshipDrums SOURCES source/worship_drums_plugin.cpp INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/source")

# Prueba de render offline (solo el DSP, sin VST3): latencia, choke, clics, DC, CPU y WAV del groove
add_executable(JasWaveWorshipDrums_rendertest test/render_test.cpp)
target_include_directories(JasWaveWorshipDrums_rendertest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/source" "${JW_PLUGINS_ROOT}/shared-dsp")
if(MSVC)
  target_compile_options(JasWaveWorshipDrums_rendertest PRIVATE /O2 /EHsc /W3 /fp:precise /utf-8)
  target_compile_definitions(JasWaveWorshipDrums_rendertest PRIVATE NOMINMAX _CRT_SECURE_NO_WARNINGS)
endif()
set_target_properties(JasWaveWorshipDrums_rendertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")

# Prueba de extremo a extremo del VST3 (factoría real, eventos MIDI, parámetros, licencia simulada)
add_executable(JasWaveWorshipDrums_hosttest test/host_test.cpp $<TARGET_OBJECTS:JasWaveWorshipDrums_obj> ${JW_SNAPSHOT_HOST_SOURCES}
               "${JW_VST3_SDK_DIR}/public.sdk/source/main/dllmain.cpp")
target_include_directories(JasWaveWorshipDrums_hosttest PRIVATE "${JW_PLUGINS_ROOT}/shared-dsp" "${JW_PLUGINS_ROOT}/shared-ui"
  "${JW_PLUGINS_ROOT}/shared-license/include" "${JW_VST3_SDK_DIR}")
target_link_libraries(JasWaveWorshipDrums_hosttest PRIVATE sdk jw_ui d2d1 dwrite windowscodecs user32 gdi32 ole32 shell32 comctl32 jw_license_testing)
target_compile_definitions(JasWaveWorshipDrums_hosttest PRIVATE NOMINMAX UNICODE _UNICODE $<$<NOT:$<CONFIG:Debug>>:RELEASE=1>)
if(MSVC)
  target_compile_options(JasWaveWorshipDrums_hosttest PRIVATE /utf-8 /EHsc)
endif()
set_target_properties(JasWaveWorshipDrums_hosttest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
