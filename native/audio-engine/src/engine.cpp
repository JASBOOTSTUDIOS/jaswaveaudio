#include "jaswave_audio.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <thread>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace jaswave {
namespace {

void setAudioThreadPriority() {
#if defined(_WIN32)
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
#endif
}

std::atomic<AudioEngine*> g_engineForDevice{nullptr};
std::thread g_deviceThread;
std::atomic<bool> g_deviceStop{false};

void deviceThreadMain(int sampleRate, int bufferSize, int channels) {
  setAudioThreadPriority();
  const double frameSec = 1.0 / static_cast<double>(sampleRate);
  const auto sleepUs = static_cast<int64_t>((bufferSize * frameSec) * 1e6 * 0.85);
  std::vector<float> scratch(static_cast<size_t>(bufferSize * channels), 0.f);

  while (!g_deviceStop.load(std::memory_order_acquire)) {
    AudioEngine* eng = g_engineForDevice.load(std::memory_order_acquire);
    if (eng) {
      eng->process(scratch.data(), bufferSize);
    } else {
      std::fill(scratch.begin(), scratch.end(), 0.f);
    }
    // Stub device: avanza playhead fuera del UI. Salida hardware: device_miniaudio.cpp (fase 2).
    std::this_thread::sleep_for(std::chrono::microseconds(std::max<int64_t>(100, sleepUs)));
  }
}

}  // namespace

AudioEngine::AudioEngine() = default;

AudioEngine::~AudioEngine() { shutdown(); }

void AudioEngine::initialize(const AudioConfig& config) {
  std::lock_guard<std::mutex> lock(controlMu_);
  config_ = config;
  if (config_.sampleRate <= 0) config_.sampleRate = 48000;
  if (config_.bufferSize <= 0) config_.bufferSize = 256;
  if (config_.channels <= 0) config_.channels = 2;
  ensureDevice();
}

void AudioEngine::shutdown() {
  stopDevice();
  std::lock_guard<std::mutex> lock(controlMu_);
  buffers_.clear();
  graph_ = {};
  playing_.store(false, std::memory_order_release);
  playheadSamples_.store(0, std::memory_order_release);
}

void AudioEngine::ensureDevice() {
  if (deviceRunning_) return;
  g_deviceStop.store(false, std::memory_order_release);
  g_engineForDevice.store(this, std::memory_order_release);
  g_deviceThread = std::thread(deviceThreadMain, config_.sampleRate, config_.bufferSize, config_.channels);
  deviceRunning_ = true;
}

void AudioEngine::stopDevice() {
  if (!deviceRunning_) return;
  g_deviceStop.store(true, std::memory_order_release);
  g_engineForDevice.store(nullptr, std::memory_order_release);
  if (g_deviceThread.joinable()) g_deviceThread.join();
  deviceRunning_ = false;
}

void AudioEngine::loadBuffer(const std::string& id, const float* samples, size_t sampleCount,
                             int sampleRate, int channels) {
  AudioBufferData data;
  data.sampleRate = sampleRate > 0 ? sampleRate : config_.sampleRate;
  data.channels = channels > 0 ? channels : 1;
  data.interleaved.assign(samples, samples + sampleCount);
  std::lock_guard<std::mutex> lock(controlMu_);
  buffers_[id] = std::move(data);
}

void AudioEngine::unloadBuffer(const std::string& id) {
  std::lock_guard<std::mutex> lock(controlMu_);
  buffers_.erase(id);
}

void AudioEngine::setGraph(GraphSnapshot graph) {
  std::lock_guard<std::mutex> lock(controlMu_);
  graph_ = std::move(graph);
}

void AudioEngine::transportPlay() { playing_.store(true, std::memory_order_release); }

void AudioEngine::transportPause() { playing_.store(false, std::memory_order_release); }

void AudioEngine::transportStop() {
  playing_.store(false, std::memory_order_release);
  playheadSamples_.store(0, std::memory_order_release);
}

void AudioEngine::transportSeek(double seconds) {
  const double s = std::max(0.0, seconds);
  const int64_t samples = static_cast<int64_t>(s * static_cast<double>(config_.sampleRate));
  playheadSamples_.store(samples, std::memory_order_release);
}

double AudioEngine::playheadSeconds() const {
  return static_cast<double>(playheadSamples_.load(std::memory_order_acquire)) /
         static_cast<double>(config_.sampleRate);
}

void AudioEngine::process(float* interleavedOut, int frames) {
  if (!interleavedOut || frames <= 0) return;
  const int ch = config_.channels;
  std::memset(interleavedOut, 0, static_cast<size_t>(frames * ch) * sizeof(float));

  const bool playing = playing_.load(std::memory_order_acquire);
  int64_t ph = playheadSamples_.load(std::memory_order_acquire);

  GraphSnapshot graph;
  std::unordered_map<std::string, AudioBufferData> buffersCopy;
  {
    std::lock_guard<std::mutex> lock(controlMu_);
    graph = graph_;
    buffersCopy = buffers_;
  }

  bool anySolo = false;
  for (const auto& t : graph.tracks) {
    if (t.solo) {
      anySolo = true;
      break;
    }
  }

  float peak = 0.f;
  const double sr = static_cast<double>(config_.sampleRate);

  if (playing) {
    for (int i = 0; i < frames; ++i) {
      const double tSec = static_cast<double>(ph + i) / sr;
      float L = 0.f;
      float R = 0.f;

      for (const auto& clip : graph.clips) {
        if (tSec < clip.startSec || tSec >= clip.startSec + clip.durationSec) continue;

        const PlaybackTrack* trk = nullptr;
        for (const auto& t : graph.tracks) {
          if (t.id == clip.trackId) {
            trk = &t;
            break;
          }
        }
        if (!trk) continue;
        // Solo por encima del mute
        if (anySolo) {
          if (!trk->solo) continue;
        } else if (trk->muted) {
          continue;
        }

        auto bit = buffersCopy.find(clip.bufferId);
        if (bit == buffersCopy.end()) continue;
        const AudioBufferData& buf = bit->second;
        if (buf.interleaved.empty() || buf.channels < 1) continue;

        const double local = (tSec - clip.startSec) + clip.bufferOffsetSec;
        const double srcPos = local * static_cast<double>(buf.sampleRate);
        const int64_t idx = static_cast<int64_t>(srcPos);
        const int64_t framesInBuf = static_cast<int64_t>(buf.interleaved.size() / buf.channels);
        if (idx < 0 || framesInBuf <= 0) continue;
        const int64_t useIdx = idx % framesInBuf;
        const size_t base = static_cast<size_t>(useIdx * buf.channels);
        float sL = buf.interleaved[base];
        float sR = buf.channels > 1 ? buf.interleaved[base + 1] : sL;

        const float vol = std::clamp(trk->volume, 0.f, 1.f);
        const float pan = std::clamp(trk->pan, -1.f, 1.f);
        const float gL = vol * (0.5f * (1.f - pan));
        const float gR = vol * (0.5f * (1.f + pan));
        L += sL * gL;
        R += sR * gR;
      }

      peak = std::max(peak, std::max(std::fabs(L), std::fabs(R)));
      interleavedOut[i * ch + 0] = std::tanh(L);
      if (ch > 1) interleavedOut[i * ch + 1] = std::tanh(R);
    }
    playheadSamples_.store(ph + frames, std::memory_order_release);
  }

  meterPeak_.store(peak, std::memory_order_relaxed);
}

}  // namespace jaswave
