#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace jaswave {

struct AudioConfig {
  int sampleRate = 48000;
  int bufferSize = 256;
  int channels = 2;
};

struct PlaybackTrack {
  std::string id;
  float volume = 0.8f;
  float pan = 0.f;
  bool muted = false;
  bool solo = false;
};

struct PlaybackClip {
  std::string id;
  std::string trackId;
  std::string bufferId;
  double startSec = 0.0;
  double durationSec = 0.0;
  double bufferOffsetSec = 0.0;
};

struct AudioBufferData {
  int sampleRate = 48000;
  int channels = 2;
  std::vector<float> interleaved;
};

struct GraphSnapshot {
  std::vector<PlaybackTrack> tracks;
  std::vector<PlaybackClip> clips;
};

/** Motor de mezcla en tiempo real (hilo de audio). Sin alloc en process(). */
class AudioEngine {
public:
  AudioEngine();
  ~AudioEngine();

  void initialize(const AudioConfig& config);
  void shutdown();

  void loadBuffer(const std::string& id, const float* samples, size_t sampleCount,
                  int sampleRate, int channels);
  void unloadBuffer(const std::string& id);

  void setGraph(GraphSnapshot graph);

  void transportPlay();
  void transportPause();
  void transportStop();
  void transportSeek(double seconds);

  double playheadSeconds() const;
  bool isPlaying() const { return playing_.load(std::memory_order_acquire); }
  int sampleRate() const { return config_.sampleRate; }

  /** Callback de device: escribe frames intercalados stereo. */
  void process(float* interleavedOut, int frames);

  float meterPeak() const { return meterPeak_.load(std::memory_order_relaxed); }

private:
  void ensureDevice();
  void stopDevice();

  AudioConfig config_{};
  std::atomic<bool> playing_{false};
  std::atomic<int64_t> playheadSamples_{0};
  std::atomic<float> meterPeak_{0.f};

  mutable std::mutex controlMu_;
  std::unordered_map<std::string, AudioBufferData> buffers_;
  GraphSnapshot graph_;
  bool deviceRunning_ = false;
};

}  // namespace jaswave
