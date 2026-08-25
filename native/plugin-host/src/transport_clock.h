/**
 * Reloj de transporte global del Plugin Host (samples / PPQ).
 * Un solo reloj para metrónomo, clips y playhead UI.
 */
#pragma once

#include <cstdint>

namespace jaswave {

struct TransportClockSnapshot {
  bool playing{false};
  double sampleRate{48000.0};
  int64_t samples{0};
  double tempoBpm{120.0};
  int beatsPerBar{4};
  double ppqPos{0.0};
  double timelineSec{0.0};
};

void transport_clock_set_sample_rate(double sr);
void transport_clock_set_tempo(double bpm);
void transport_clock_set_beats_per_bar(int beats);
void transport_clock_set_playing(bool playing);
/** Seek absoluto en samples (también actualiza PPQ). */
void transport_clock_seek_samples(int64_t samples);
void transport_clock_seek_ppq(double ppq);
/** Avance en el callback de audio (solo si playing). */
void transport_clock_advance(uint32_t frames);
TransportClockSnapshot transport_clock_snapshot();
double transport_clock_sample_rate();
bool transport_clock_playing();
int64_t transport_clock_samples();
double transport_clock_tempo();
int transport_clock_beats_per_bar();
double transport_clock_ppq();

} // namespace jaswave
