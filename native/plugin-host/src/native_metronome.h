/**
 * Metrónomo sample-accurate en el mix del host (ASIO clock).
 */
#pragma once

#include <cstdint>

namespace jaswave {

void metronome_set(bool enabled, double bpm, int beatsPerBar, float volume);
void metronome_set_enabled(bool enabled);
void metronome_set_volume(float volume);
bool metronome_enabled();
/** Suma clicks estéreo al buffer interleaved (L,R,...). Usa transport_clock. */
void metronome_render(float* interleavedStereo, uint32_t frames);

} // namespace jaswave
