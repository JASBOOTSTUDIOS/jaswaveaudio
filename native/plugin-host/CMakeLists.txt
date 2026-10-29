cmake_minimum_required(VERSION 3.25)

# Runtime de C++ enlazado de forma estatica (/MT): el instalador no puede depender de que la PC destino
# tenga el redistribuible de Visual C++ (sin VCRUNTIME140/MSVCP140 el host no arranca y no hay audio).
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(SMTG_USE_STATIC_CRT ON CACHE BOOL "" FORCE)

project(jaswave_plugin_host LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(JASWAVE_VST3_SDK "Build Steinberg VST3 hosting (audio + editor embed)" ON)

set(VST3_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/vst3sdk" CACHE PATH "Ruta del VST3 SDK (npm run native:sdk)")
set(HAS_VST3_SDK OFF)
if(JASWAVE_VST3_SDK AND EXISTS "${VST3_SDK_DIR}/CMakeLists.txt"
   AND EXISTS "${VST3_SDK_DIR}/public.sdk/source/vst/hosting/module.h"
   AND EXISTS "${VST3_SDK_DIR}/pluginterfaces/vst/ivstaudioprocessor.h"
   AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/vendor/miniaudio.h")
  set(HAS_VST3_SDK ON)
endif()

set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES ON CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)

if(HAS_VST3_SDK)
  add_subdirectory("${VST3_SDK_DIR}" vst3sdk EXCLUDE_FROM_ALL)

  add_executable(jaswave-plugin-host
    src/main.cpp
    src/vst3_slot.cpp
    src/audio_output.cpp
    src/asio_output.cpp
    src/asio_com.c
    src/mix_bus.cpp
    src/midi_winmm.cpp
    src/transport_clock.cpp
    src/native_metronome.cpp
    src/clip_player.cpp
    "${VST3_SDK_DIR}/public.sdk/source/vst/hosting/plugprovider.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/hosting/module_win32.cpp"
  )
  target_compile_definitions(jaswave-plugin-host PRIVATE JASWAVE_HAS_VST3_SDK=1)
  target_include_directories(jaswave-plugin-host PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    "${CMAKE_CURRENT_SOURCE_DIR}/vendor"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../plugins/shared-dsp"
    "${VST3_SDK_DIR}"
  )
  target_link_libraries(jaswave-plugin-host PRIVATE sdk_hosting)
  if(WIN32)
    target_link_libraries(jaswave-plugin-host PRIVATE ole32 oleaut32 uuid winmm)
  endif()
  message(STATUS "jaswave-plugin-host: VST3 audio+editor (miniaudio)")

  # El host no depende de ningún plugin concreto (K1): los plugins JasWave viven en plugins/ y se
  # compilan aparte (native/scripts/build-plugins.mjs) y se entregan bajo demanda.
else()
  add_executable(jaswave-plugin-host src/main.cpp)
  message(STATUS "jaswave-plugin-host: discover-only (SDK/miniaudio missing)")
endif()

install(TARGETS jaswave-plugin-host RUNTIME DESTINATION bin)

# Selftest determinista del DSP propio del host (limitador true-peak del máster). No necesita el SDK:
#   cmake --build <build> --config Release --target jaswave-host-selftest && <build>/Release/jaswave-host-selftest
add_executable(jaswave-host-selftest EXCLUDE_FROM_ALL tests/master_limiter_test.cpp)
target_include_directories(jaswave-host-selftest PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${CMAKE_CURRENT_SOURCE_DIR}/../../plugins/shared-dsp"
)
