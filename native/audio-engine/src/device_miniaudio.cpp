/**
 * Salida hardware con miniaudio (opcional).
 * Por defecto el motor usa device stub en engine.cpp.
 * Para activar: definir JASWAVE_USE_MINIAUDIO=1 y colocar vendor/miniaudio.h
 */
#include "jaswave_audio.hpp"

#if defined(JASWAVE_USE_MINIAUDIO)
#define MINIAUDIO_IMPLEMENTATION
#include "../vendor/miniaudio.h"
// Integración completa en fase 2 — el stub de engine.cpp cubre playhead/mix MVP.
#endif
