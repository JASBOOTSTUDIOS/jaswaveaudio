#include "native_metronome.h"
#include "transport_clock.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace jaswave {
namespace {

std::atomic<bool> gEnabled{false};
std::atomic<float> gVolume{0.8f};
std::atomic<int64_t> gLastClickBeat{-1};

constexpr float kTwoPi = 6.28318530718f;

} // namespace

void metronome_set(bool enabled, double bpm, int beatsPerBar, float volume) {
  gEnabled.store(enabled, std::memory_order_relaxed);
  if (bpm > 0.0) transport_clock_set_tempo(bpm);
  if (beatsPerBar > 0) transport_clock_set_beats_per_bar(beatsPerBar);
  metronome_set_volume(volume);
  if (!enabled) gLastClickBeat.store(-1, std::memory_order_relaxed);
}

void metronome_set_enabled(bool enabled) {
  gEnabled.store(enabled, std::memory_order_relaxed);
  if (!enabled) gLastClickBeat.store(-1, std::memory_order_relaxed);
}

void metronome_set_volume(float volume) {
  gVolume.store(std::clamp(volume, 0.f, 1.f), std::memory_order_relaxed);
}

bool metronome_enabled() { return gEnabled.load(std::memory_order_relaxed); }

void metronome_render(float* interleavedStereo, uint32_t frames) {
  if (!interleavedStereo || frames == 0) return;
  if (!gEnabled.load(std::memory_order_relaxed)) return;
  if (!transport_clock_playing()) return;

  const double sr = transport_clock_sample_rate();
  const double tempo = transport_clock_tempo();
  const int bpb = std::max(1, transport_clock_beats_per_bar());
  if (sr < 8000.0 || tempo < 20.0) return;

  const float vol = gVolume.load(std::memory_order_relaxed);
  const double samplesPerBeat = sr * 60.0 / tempo;
  if (samplesPerBeat < 8.0) return;

  const int64_t startSamp = transport_clock_samples();
  const int clickLen = static_cast<int>(std::min(sr * 0.018, 2048.0));

  for (uint32_t i = 0; i < frames; ++i) {
    const int64_t absSamp = startSamp + static_cast<int64_t>(i);
    const double beatExact = static_cast<double>(absSamp) / samplesPerBeat;
    const int64_t beatIdx = static_cast<int64_t>(std::floor(beatExact));
    const double frac = beatExact - static_cast<double>(beatIdx);
    const int samplesIntoBeat = static_cast<int>(frac * samplesPerBeat);

    if (samplesIntoBeat >= 0 && samplesIntoBeat < clickLen) {
      // Evitar doble click si el mismo beat cae en dos bloques (frac noise).
      if (samplesIntoBeat == 0) {
        const int64_t prev = gLastClickBeat.load(std::memory_order_relaxed);
        if (beatIdx == prev) continue;
        gLastClickBeat.store(beatIdx, std::memory_order_relaxed);
      }
      const bool accent = ((beatIdx % bpb) + bpb) % bpb == 0;
      const float freq = accent ? 1800.f : 1000.f;
      const float amp = vol * (accent ? 0.55f : 0.35f);
      const float t = static_cast<float>(samplesIntoBeat) / static_cast<float>(sr);
      const float env = std::exp(-t * 90.f);
      const float s = std::sin(kTwoPi * freq * t) * amp * env;
      interleavedStereo[i * 2 + 0] += s;
      interleavedStereo[i * 2 + 1] += s;
    }
  }
}

} // namespace jaswave
