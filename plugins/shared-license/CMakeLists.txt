# JasWave – licencias dentro de los VST (L2). Ver plugins/CONTRATO-V5.md §2–§4.
cmake_minimum_required(VERSION 3.25)
if(NOT DEFINED PROJECT_NAME)
  project(jaswave_shared_license LANGUAGES C CXX)
endif()

set(JW_LICENSE_PUBLIC_PEM "${CMAKE_CURRENT_SOURCE_DIR}/keys/licencia_publica.pem" CACHE FILEPATH
    "Clave pública Ed25519 (PEM SPKI) incrustada en los VST")
set(_jw_gen_dir "${CMAKE_CURRENT_BINARY_DIR}/gen")
set(_jw_key_header "${_jw_gen_dir}/jw_license_pubkey.h")
file(MAKE_DIRECTORY "${_jw_gen_dir}")

# En configuración (falla pronto si el PEM no es válido) y en build (si cambia el PEM).
execute_process(
  COMMAND "${CMAKE_COMMAND}" -DPEM=${JW_LICENSE_PUBLIC_PEM} -DOUT=${_jw_key_header} -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/EmbedPublicKey.cmake"
  RESULT_VARIABLE _jw_key_rc)
if(NOT _jw_key_rc EQUAL 0)
  message(FATAL_ERROR "No se pudo incrustar la clave pública de licencias (${JW_LICENSE_PUBLIC_PEM})")
endif()
add_custom_command(
  OUTPUT "${_jw_key_header}"
  COMMAND "${CMAKE_COMMAND}" -DPEM=${JW_LICENSE_PUBLIC_PEM} -DOUT=${_jw_key_header} -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/EmbedPublicKey.cmake"
  DEPENDS "${JW_LICENSE_PUBLIC_PEM}" "${CMAKE_CURRENT_SOURCE_DIR}/cmake/EmbedPublicKey.cmake"
  COMMENT "Incrustando clave pública de licencias")
add_custom_target(jw_license_pubkey DEPENDS "${_jw_key_header}")

# Monocypher (C, BSD-2/CC0)
add_library(jw_monocypher STATIC
  third_party/monocypher/monocypher.c
  third_party/monocypher/monocypher-ed25519.c)
target_include_directories(jw_monocypher PUBLIC third_party/monocypher)
set_target_properties(jw_monocypher PROPERTIES POSITION_INDEPENDENT_CODE ON)

# Núcleo portable: base64url, JSON, verificación jwl1
add_library(jw_license_core STATIC src/json_mini.cpp src/license_core.cpp)
target_include_directories(jw_license_core PUBLIC include)
target_link_libraries(jw_license_core PUBLIC jw_monocypher)
target_compile_features(jw_license_core PUBLIC cxx_std_17)
if(MSVC)
  target_compile_options(jw_license_core PRIVATE /W4 /utf-8)
endif()

if(WIN32)
  foreach(_flavor jw_license jw_license_testing)
    add_library(${_flavor} STATIC src/license_manager_win.cpp "${_jw_key_header}")
    add_dependencies(${_flavor} jw_license_pubkey)
    target_include_directories(${_flavor} PUBLIC include PRIVATE "${_jw_gen_dir}")
    target_link_libraries(${_flavor} PUBLIC jw_license_core winhttp crypt32 shell32 ole32)
    target_compile_definitions(${_flavor} PRIVATE UNICODE _UNICODE)
    if(MSVC)
      target_compile_options(${_flavor} PRIVATE /W4 /utf-8)
    endif()
  endforeach()
  # Solo binarios de prueba (capturas / tests): habilita Manager::testOverride
  target_compile_definitions(jw_license_testing PUBLIC JW_LICENSE_TESTING=1)
endif()
