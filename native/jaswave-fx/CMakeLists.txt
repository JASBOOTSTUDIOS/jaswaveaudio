cmake_minimum_required(VERSION 3.25)
project(jaswave_fx VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(VST3_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../plugin-host/third_party/vst3sdk")
if(NOT EXISTS "${VST3_SDK_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "VST3 SDK missing at ${VST3_SDK_DIR}")
endif()

set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_MODULE_INFO OFF CACHE BOOL "" FORCE)

if(NOT TARGET sdk)
  add_subdirectory("${VST3_SDK_DIR}" vst3sdk_fx EXCLUDE_FROM_ALL)
endif()

set(fx_sources
  src/factory.cpp
  src/processor.cpp
  src/controller.cpp
  src/editor.cpp
  "${VST3_SDK_DIR}/public.sdk/source/main/dllmain.cpp"
  "${VST3_SDK_DIR}/public.sdk/source/common/pluginview.cpp"
)

add_library(JasWaveFx MODULE ${fx_sources})
target_include_directories(JasWaveFx PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${VST3_SDK_DIR}"
)
target_link_libraries(JasWaveFx PRIVATE sdk)
if(WIN32)
  target_link_libraries(JasWaveFx PRIVATE comctl32 user32 gdi32)
endif()
target_compile_definitions(JasWaveFx PRIVATE
  $<$<CONFIG:Debug>:DEVELOPMENT=1>
  $<$<CONFIG:Release>:RELEASE=1>
  $<$<CONFIG:RelWithDebInfo>:RELEASE=1>
)
if(MSVC)
  target_compile_options(JasWaveFx PRIVATE /EHsc /MP /W3)
  set_target_properties(JasWaveFx PROPERTIES
    SUFFIX ".vst3"
    OUTPUT_NAME "JasWaveFx"
  )
endif()

# Copia a %LOCALAPPDATA% para desarrollo; el build de release (native/scripts/build-native.mjs)
# lo desactiva: el instalador incluye el bundle de ${CMAKE_BINARY_DIR}.
option(JASWAVE_INSTALL_USER_VST3 "Copiar el bundle a %LOCALAPPDATA%/Programs/Common/VST3/JasWave tras compilar" ON)
set(VST3_INSTALL_DIR "$ENV{LOCALAPPDATA}/Programs/Common/VST3/JasWave")
add_custom_command(TARGET JasWaveFx POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory
    "${CMAKE_BINARY_DIR}/JasWaveFx.vst3/Contents/x86_64-win"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:JasWaveFx>"
    "${CMAKE_BINARY_DIR}/JasWaveFx.vst3/Contents/x86_64-win/JasWaveFx.vst3"
  COMMENT "Packaging JasWaveFx.vst3"
)
if(JASWAVE_INSTALL_USER_VST3)
  add_custom_command(TARGET JasWaveFx POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${VST3_INSTALL_DIR}/JasWaveFx.vst3/Contents/x86_64-win"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "$<TARGET_FILE:JasWaveFx>"
      "${VST3_INSTALL_DIR}/JasWaveFx.vst3/Contents/x86_64-win/JasWaveFx.vst3"
    COMMENT "Installing JasWaveFx.vst3 → ${VST3_INSTALL_DIR}"
  )
endif()

# Tests unitarios de DSP (sin VST3 SDK): respuesta EQ, curva compresor, ceiling limitador.
add_executable(jaswave_fx_dsp_tests
  test/dsp_tests.cpp
  src/dsp.cpp
)
target_include_directories(jaswave_fx_dsp_tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(jaswave_fx_dsp_tests PRIVATE)

include(CTest)
add_test(NAME jaswave_fx_dsp COMMAND jaswave_fx_dsp_tests)

message(STATUS "JasWaveFx.vst3 → ${VST3_INSTALL_DIR}")
