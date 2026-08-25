#include "transport_clock.h"

#include <algorithm>
#include <atomic>
#include <cmath>

namespace jaswave {
namespace {

std::atomic<bool> gPlaying{false};
std::atomic<double> gSampleRate{48000.0};
std::atomic<int64_t> gSamples{0};
std::atomic<double> gTempo{120.0};
std::atomic<int> gBeatsPerBar{4};
std::atomic<double> gPpq{0.0};

} // namespace

void transport_clock_set_sample_rate(double sr) {
  if (sr >= 8000.0 && sr <= 192000.0) gSampleRate.store(sr, std::memory_order_relaxed);
}

void transport_clock_set_tempo(double bpm) {
  if (bpm >= 20.0 && bpm <= 400.0) gTempo.store(bpm, std::memory_order_relaxed);
}

void transport_clock_set_beats_per_bar(int beats) {
  if (beats >= 1 && beats <= 32) gBeatsPerBar.store(beats, std::memory_order_relaxed);
}

void transport_clock_set_playing(bool playing) {
  gPlaying.store(playing, std::memory_order_relaxed);
}

void transport_clock_seek_samples(int64_t samples) {
  if (samples < 0) samples = 0;
  gSamples.store(samples, std::memory_order_relaxed);
  const double sr = gSampleRate.load(std::memory_order_relaxed);
  const double tempo = gTempo.load(std::memory_order_relaxed);
  if (sr > 0.0 && tempo > 0.0) {
    const double sec = static_cast<double>(samples) / sr;
    gPpq.store(sec * (tempo / 60.0), std::memory_order_relaxed);
  }
}

void transport_clock_seek_ppq(double ppq) {
  if (ppq < 0.0) ppq = 0.0;
  gPpq.store(ppq, std::memory_order_relaxed);
  const double sr = gSampleRate.load(std::memory_order_relaxed);
  const double tempo = gTempo.load(std::memory_order_relaxed);
  if (sr > 0.0 && tempo > 0.0) {
    const double sec = ppq * 60.0 / tempo;
    gSamples.store(static_cast<int64_t>(std::llround(sec * sr)), std::memory_order_relaxed);
  }
}

void transport_clock_advance(uint32_t frames) {
  if (!gPlaying.load(std::memory_order_relaxed) || frames == 0) return;
  const double sr = gSampleRate.load(std::memory_order_relaxed);
  const double tempo = gTempo.load(std::memory_order_relaxed);
  gSamples.fetch_add(static_cast<int64_t>(frames), std::memory_order_relaxed);
  if (sr > 0.0 && tempo > 0.0) {
    const double dPpq = (static_cast<double>(frames) / sr) * (tempo / 60.0);
    double cur = gPpq.load(std::memory_order_relaxed);
    gPpq.store(cur + dPpq, std::memory_order_relaxed);
  }
}

TransportClockSnapshot transport_clock_snapshot() {
  TransportClockSnapshot s;
  s.playing = gPlaying.load(std::memory_order_relaxed);
  s.sampleRate = gSampleRate.load(std::memory_order_relaxed);
  s.samples = gSamples.load(std::memory_order_relaxed);
  s.tempoBpm = gTempo.load(std::memory_order_relaxed);
  s.beatsPerBar = gBeatsPerBar.load(std::memory_order_relaxed);
  s.ppqPos = gPpq.load(std::memory_order_relaxed);
  s.timelineSec = (s.sampleRate > 0.0) ? static_cast<double>(s.samples) / s.sampleRate : 0.0;
  return s;
}

double transport_clock_sample_rate() { return gSampleRate.load(std::memory_order_relaxed); }
bool transport_clock_playing() { return gPlaying.load(std::memory_order_relaxed); }
int64_t transport_clock_samples() { return gSamples.load(std::memory_order_relaxed); }
double transport_clock_tempo() { return gTempo.load(std::memory_order_relaxed); }
int transport_clock_beats_per_bar() { return gBeatsPerBar.load(std::memory_order_relaxed); }
double transport_clock_ppq() { return gPpq.load(std::memory_order_relaxed); }

} // namespace jaswave
