cmake_minimum_required(VERSION 3.25)
project(jaswave_param_eq VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(VST3_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../native/plugin-host/third_party/vst3sdk")
if(NOT EXISTS "${VST3_SDK_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "VST3 SDK no encontrado en ${VST3_SDK_DIR}")
endif()

set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_MODULE_INFO OFF CACHE BOOL "" FORCE)

if(NOT TARGET sdk)
  add_subdirectory("${VST3_SDK_DIR}" vst3sdk_eq EXCLUDE_FROM_ALL)
endif()

set(eq_sources
  src/param_eq_plugin.cpp
  "${VST3_SDK_DIR}/public.sdk/source/main/dllmain.cpp"
)

add_library(JasWaveParamEq MODULE ${eq_sources})
target_include_directories(JasWaveParamEq PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${VST3_SDK_DIR}"
)
target_link_libraries(JasWaveParamEq PRIVATE sdk)
if(WIN32)
  target_link_libraries(JasWaveParamEq PRIVATE comctl32 user32 gdi32 gdiplus msimg32)
endif()

if(MSVC)
  target_compile_options(JasWaveParamEq PRIVATE /EHsc /MP /W3)
  set_target_properties(JasWaveParamEq PROPERTIES
    SUFFIX ".vst3"
    OUTPUT_NAME "JasWaveParamEq"
  )
endif()

# Copia automática al bundle local distribuible en plugins/com.jaswave.plugin.param-eq/bin/
set(BUNDLE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/bin/JasWaveParamEq.vst3/Contents/x86_64-win")
add_custom_command(TARGET JasWaveParamEq POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${BUNDLE_DIR}"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:JasWaveParamEq>" "${BUNDLE_DIR}/JasWaveParamEq.vst3"
)
