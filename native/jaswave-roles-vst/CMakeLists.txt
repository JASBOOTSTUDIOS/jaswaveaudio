cmake_minimum_required(VERSION 3.25)
project(jaswave_roles_vst VERSION 1.0.0 LANGUAGES CXX)

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
  add_subdirectory("${VST3_SDK_DIR}" vst3sdk_roles EXCLUDE_FROM_ALL)
endif()

set(roles_sources
  src/factory.cpp
  src/processor.cpp
  src/controller.cpp
  src/editor.cpp
  "${VST3_SDK_DIR}/public.sdk/source/main/dllmain.cpp"
  "${VST3_SDK_DIR}/public.sdk/source/common/pluginview.cpp"
)

add_library(JasWaveRoles MODULE ${roles_sources})
target_include_directories(JasWaveRoles PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${VST3_SDK_DIR}"
)
target_link_libraries(JasWaveRoles PRIVATE sdk)
if(WIN32)
  target_link_libraries(JasWaveRoles PRIVATE comctl32 user32 gdi32)
endif()
target_compile_definitions(JasWaveRoles PRIVATE
  $<$<CONFIG:Debug>:DEVELOPMENT=1>
  $<$<CONFIG:Release>:RELEASE=1>
  $<$<CONFIG:RelWithDebInfo>:RELEASE=1>
)
if(MSVC)
  target_compile_options(JasWaveRoles PRIVATE /EHsc /MP /W3)
  set_target_properties(JasWaveRoles PROPERTIES
    SUFFIX ".vst3"
    OUTPUT_NAME "JasWaveRoles"
  )
endif()

set(VST3_INSTALL_DIR "$ENV{LOCALAPPDATA}/Programs/Common/VST3/JasWave")
add_custom_command(TARGET JasWaveRoles POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory
    "${CMAKE_BINARY_DIR}/JasWaveRoles.vst3/Contents/x86_64-win"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:JasWaveRoles>"
    "${CMAKE_BINARY_DIR}/JasWaveRoles.vst3/Contents/x86_64-win/JasWaveRoles.vst3"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${VST3_INSTALL_DIR}/JasWaveRoles.vst3/Contents/x86_64-win"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:JasWaveRoles>"
    "${VST3_INSTALL_DIR}/JasWaveRoles.vst3/Contents/x86_64-win/JasWaveRoles.vst3"
  COMMENT "Packaging and installing JasWaveRoles.vst3"
)

message(STATUS "JasWaveRoles.vst3 → ${VST3_INSTALL_DIR}")
