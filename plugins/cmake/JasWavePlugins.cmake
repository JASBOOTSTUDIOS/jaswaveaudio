# =====================================================================================
#  JasWave – infraestructura CMake común de los plugins VST3 independientes (plugins/)
#  Cada plugin la incluye desde su propio CMakeLists.txt (compila solo) y el agregador
#  plugins/CMakeLists.txt la incluye una vez para compilarlos todos.
# =====================================================================================
include_guard(GLOBAL)

get_filename_component(JW_PLUGINS_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)

# --- VST3 SDK -------------------------------------------------------------------------
# Por defecto el SDK del checkout principal (third_party está en .gitignore y no existe en
# worktrees); si no existe, la ruta habitual relativa al repo.
set(_jw_sdk_default "C:/src/jaswave-ia/native/plugin-host/third_party/vst3sdk")
if(NOT EXISTS "${_jw_sdk_default}/CMakeLists.txt")
  get_filename_component(_jw_sdk_default "${JW_PLUGINS_ROOT}/../native/plugin-host/third_party/vst3sdk" ABSOLUTE)
endif()
set(JW_VST3_SDK_DIR "${_jw_sdk_default}" CACHE PATH "Ruta del VST3 SDK (Steinberg)")

option(JW_INSTALL_USER_VST3 "Copiar cada bundle a %LOCALAPPDATA%/Programs/Common/VST3/JasWave tras compilar (desarrollo)" OFF)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

macro(jw_setup_shared)
  if(NOT EXISTS "${JW_VST3_SDK_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "VST3 SDK no encontrado en JW_VST3_SDK_DIR=${JW_VST3_SDK_DIR}. "
                        "Ejecuta `npm run native:sdk` en el checkout principal o pasa -DJW_VST3_SDK_DIR=<ruta>.")
  endif()
  if(NOT TARGET sdk)
    set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
    set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
    set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
    set(SMTG_CREATE_MODULE_INFO OFF CACHE BOOL "" FORCE)
    set(SMTG_ADD_VST3_UTILITIES OFF CACHE BOOL "" FORCE)
    add_subdirectory("${JW_VST3_SDK_DIR}" "${CMAKE_BINARY_DIR}/_vst3sdk" EXCLUDE_FROM_ALL)
  endif()
  if(NOT TARGET jw_license_core)
    add_subdirectory("${JW_PLUGINS_ROOT}/shared-license" "${CMAKE_BINARY_DIR}/_shared-license")
  endif()
  if(NOT TARGET jw_ui)
    add_subdirectory("${JW_PLUGINS_ROOT}/shared-ui" "${CMAKE_BINARY_DIR}/_shared-ui")
  endif()
endmacro()

# jaswave_add_vst3(TARGET <Nombre> SOURCES <...> [INCLUDES <...>])
#  - <Nombre>_obj    : OBJECT library con el código del plugin (incl. factoría)
#  - <Nombre>        : MODULE .vst3 en <build>/VST3/<Config>/<Nombre>.vst3/Contents/x86_64-win/
#  - <Nombre>_snapshot: herramienta de prueba que renderiza el editor a PNG (licencia simulada)
function(jaswave_add_vst3)
  cmake_parse_arguments(JW "" "TARGET" "SOURCES;INCLUDES" ${ARGN})
  set(T ${JW_TARGET})
  add_library(${T}_obj OBJECT ${JW_SOURCES})
  target_include_directories(${T}_obj PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src" ${JW_INCLUDES}
    "${JW_PLUGINS_ROOT}/shared-dsp" "${JW_PLUGINS_ROOT}/shared-ui" "${JW_PLUGINS_ROOT}/shared-license/include"
    "${JW_VST3_SDK_DIR}")
  target_link_libraries(${T}_obj PRIVATE sdk)
  target_compile_definitions(${T}_obj PRIVATE NOMINMAX UNICODE _UNICODE
    $<$<CONFIG:Debug>:DEVELOPMENT=1> $<$<NOT:$<CONFIG:Debug>>:RELEASE=1>)
  if(MSVC)
    target_compile_options(${T}_obj PRIVATE /W3 /utf-8 /EHsc /permissive- /fp:precise)
  endif()

  set(_libs sdk jw_ui d2d1 dwrite windowscodecs user32 gdi32 ole32 shell32 comctl32)
  add_library(${T} MODULE $<TARGET_OBJECTS:${T}_obj> "${JW_VST3_SDK_DIR}/public.sdk/source/main/dllmain.cpp")
  target_include_directories(${T} PRIVATE "${JW_VST3_SDK_DIR}")
  target_link_libraries(${T} PRIVATE ${_libs} jw_license)
  target_compile_definitions(${T} PRIVATE $<$<CONFIG:Debug>:DEVELOPMENT=1> $<$<NOT:$<CONFIG:Debug>>:RELEASE=1>)
  set(_bundle "${CMAKE_BINARY_DIR}/VST3/$<CONFIG>/${T}.vst3")
  set_target_properties(${T} PROPERTIES
    PREFIX "" SUFFIX ".vst3" OUTPUT_NAME "${T}"
    LIBRARY_OUTPUT_DIRECTORY "${_bundle}/Contents/x86_64-win"
    PDB_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/pdb/$<CONFIG>"
    ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib/$<CONFIG>")
  if(MSVC)
    target_link_options(${T} PRIVATE /DEBUG /OPT:REF /OPT:ICF)
  endif()
  if(JW_INSTALL_USER_VST3)
    add_custom_command(TARGET ${T} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_directory "${_bundle}" "$ENV{LOCALAPPDATA}/Programs/Common/VST3/JasWave/${T}.vst3"
      COMMENT "Instalando ${T}.vst3 en %LOCALAPPDATA% (desarrollo)")
  endif()

  add_executable(${T}_snapshot "${JW_PLUGINS_ROOT}/shared-ui/jw_snapshot_main.cpp" $<TARGET_OBJECTS:${T}_obj> ${JW_SNAPSHOT_HOST_SOURCES}
                 "${JW_VST3_SDK_DIR}/public.sdk/source/main/dllmain.cpp")
  target_include_directories(${T}_snapshot PRIVATE "${JW_PLUGINS_ROOT}/shared-dsp" "${JW_PLUGINS_ROOT}/shared-ui" "${JW_VST3_SDK_DIR}")
  target_link_libraries(${T}_snapshot PRIVATE ${_libs} jw_license_testing)
  target_compile_definitions(${T}_snapshot PRIVATE NOMINMAX UNICODE _UNICODE
    $<$<CONFIG:Debug>:DEVELOPMENT=1> $<$<NOT:$<CONFIG:Debug>>:RELEASE=1>)
  if(MSVC)
    target_compile_options(${T}_snapshot PRIVATE /utf-8 /EHsc)
  endif()
  set_target_properties(${T}_snapshot PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tools/$<CONFIG>")
endfunction()
