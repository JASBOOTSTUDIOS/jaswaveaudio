cmake_minimum_required(VERSION 3.25)
project(JasWavePiano VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(VST3_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../plugin-host/third_party/vst3sdk")

# --- Compilar SDK mínimo manualmente (sin add_subdirectory para evitar dataexchange.cpp) ---
set(SDK_BASE_SOURCES
    "${VST3_SDK_DIR}/base/source/baseiids.cpp"
    "${VST3_SDK_DIR}/base/source/fbuffer.cpp"
    "${VST3_SDK_DIR}/base/source/fdebug.cpp"
    "${VST3_SDK_DIR}/base/source/fdynlib.cpp"
    "${VST3_SDK_DIR}/base/source/fobject.cpp"
    "${VST3_SDK_DIR}/base/source/fstreamer.cpp"
    "${VST3_SDK_DIR}/base/source/fstring.cpp"
    "${VST3_SDK_DIR}/base/source/timer.cpp"
    "${VST3_SDK_DIR}/base/source/updatehandler.cpp"
    "${VST3_SDK_DIR}/base/thread/source/fcondition.cpp"
    "${VST3_SDK_DIR}/base/thread/source/flock.cpp"
)

set(SDK_PLUGINIFACE_SOURCES
    "${VST3_SDK_DIR}/pluginterfaces/base/coreiids.cpp"
    "${VST3_SDK_DIR}/pluginterfaces/base/conststringtable.cpp"
    "${VST3_SDK_DIR}/pluginterfaces/base/funknown.cpp"
    "${VST3_SDK_DIR}/pluginterfaces/base/ustring.cpp"
)

set(SDK_COMMON_SOURCES
    "${VST3_SDK_DIR}/public.sdk/source/common/commoniids.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/common/commonstringconvert.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/common/openurl.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/common/pluginview.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/common/readfile.cpp"
)

set(SDK_VST_SOURCES
    "${VST3_SDK_DIR}/public.sdk/source/main/pluginfactory.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/main/moduleinit.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstaudioeffect.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstbus.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstcomponent.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstcomponentbase.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstinitiids.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstparameters.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstsinglecomponenteffect.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/vstpresetfile.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/utility/stringconvert.cpp"
    "${VST3_SDK_DIR}/public.sdk/source/vst/utility/systemtime.cpp"
)

# --- Plugin VST3 ---
add_library(JasWavePiano SHARED
    # Nuestro código
    source/piano_plugin.cpp
    source/piano_entry.cpp
    # DLL entry (Windows)
    "${VST3_SDK_DIR}/public.sdk/source/main/dllmain.cpp"
    # SDK compilado directamente
    ${SDK_BASE_SOURCES}
    ${SDK_PLUGINIFACE_SOURCES}
    ${SDK_COMMON_SOURCES}
    ${SDK_VST_SOURCES}
)

target_include_directories(JasWavePiano PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/source"
    "${VST3_SDK_DIR}"
    "${VST3_SDK_DIR}/base"
    "${VST3_SDK_DIR}/base/thread"
)

target_compile_definitions(JasWavePiano PRIVATE
    NDEBUG
    RELEASE=1
    SMTG_RENAME_ASSERT=1
    $<$<BOOL:${WIN32}>:WIN32>
)

if(WIN32)
    target_link_libraries(JasWavePiano PRIVATE ole32)
endif()

set_target_properties(JasWavePiano PROPERTIES
    OUTPUT_NAME "JasWavePiano"
    PREFIX ""
    SUFFIX ".vst3"
)

set(VST3_INSTALL_DIR "$ENV{LOCALAPPDATA}/Programs/Common/VST3/JasWave")
add_custom_command(TARGET JasWavePiano POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory
    "${CMAKE_BINARY_DIR}/JasWavePiano.vst3/Contents/x86_64-win"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:JasWavePiano>"
    "${CMAKE_BINARY_DIR}/JasWavePiano.vst3/Contents/x86_64-win/JasWavePiano.vst3"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${VST3_INSTALL_DIR}/JasWavePiano.vst3/Contents/x86_64-win"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:JasWavePiano>"
    "${VST3_INSTALL_DIR}/JasWavePiano.vst3/Contents/x86_64-win/JasWavePiano.vst3"
  COMMENT "Packaging and installing JasWavePiano.vst3"
)

install(TARGETS JasWavePiano RUNTIME DESTINATION "VST3")
message(STATUS "JasWavePiano.vst3 → ${VST3_INSTALL_DIR}")
