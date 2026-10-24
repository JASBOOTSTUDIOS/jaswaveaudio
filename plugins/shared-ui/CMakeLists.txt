# JasWave UI "Cyber" (Direct2D + DirectWrite) compartida por todos los plugins. Ver DESIGN.md.
add_library(jw_ui STATIC jw_ui.h jw_ui_kit.h jw_ui_plantilla.h jw_recursos.h jw_ui_gfx.cpp jw_ui_widgets.cpp jw_ui_view.cpp)
target_include_directories(jw_ui PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}" "${JW_PLUGINS_ROOT}/shared-dsp" PRIVATE "${JW_VST3_SDK_DIR}")
target_link_libraries(jw_ui PUBLIC sdk jw_license_core PRIVATE d2d1 dwrite windowscodecs comctl32)
target_include_directories(jw_ui PUBLIC "${JW_PLUGINS_ROOT}/shared-license/include")
target_compile_definitions(jw_ui PRIVATE NOMINMAX UNICODE _UNICODE $<$<CONFIG:Debug>:DEVELOPMENT=1> $<$<NOT:$<CONFIG:Debug>>:RELEASE=1>)
if(MSVC)
  target_compile_options(jw_ui PRIVATE /W3 /utf-8 /EHsc /permissive-)
endif()

# Fuentes de hosting mínimas del SDK para la herramienta de capturas (no van en los .vst3)
set(JW_SNAPSHOT_HOST_SOURCES
  "${JW_VST3_SDK_DIR}/public.sdk/source/vst/hosting/hostclasses.cpp"
  "${JW_VST3_SDK_DIR}/public.sdk/source/vst/hosting/pluginterfacesupport.cpp"
  "${JW_VST3_SDK_DIR}/public.sdk/source/vst/hosting/eventlist.cpp"
  "${JW_VST3_SDK_DIR}/public.sdk/source/vst/hosting/parameterchanges.cpp"
  CACHE INTERNAL "")
