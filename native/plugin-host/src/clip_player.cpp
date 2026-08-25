#include "clip_player.h"
#include "transport_clock.h"

#include "miniaudio.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace jaswave {
namespace {

struct ClipBuffer {
  std::vector<float> interleaved; // stereo f32
  uint32_t frames{0};
  uint32_t sampleRate{48000};
};

struct ClipVoice {
  std::string clipId;
  uint16_t trackIndex{0};
  int64_t startSample{0};
  int64_t durationSamples{0};
  int64_t sourceOffset{0};
  float gain{1.f};
  float pan{0.f};
  bool active{true};
};

std::mutex gMu;
std::unordered_map<std::string, ClipBuffer> gBuffers;
std::vector<ClipVoice> gVoices;

void toStereo(const float* src, uint32_t frames, uint32_t channels, std::vector<float>& out) {
  out.resize(static_cast<size_t>(frames) * 2u);
  if (channels == 1) {
    for (uint32_t i = 0; i < frames; ++i) {
      out[i * 2] = src[i];
      out[i * 2 + 1] = src[i];
    }
  } else if (channels >= 2) {
    for (uint32_t i = 0; i < frames; ++i) {
      out[i * 2] = src[i * channels];
      out[i * 2 + 1] = src[i * channels + 1];
    }
  } else {
    std::fill(out.begin(), out.end(), 0.f);
  }
}

void resampleLinear(const std::vector<float>& in, uint32_t inFrames, uint32_t inSr, uint32_t outSr,
                    std::vector<float>& out, uint32_t& outFrames) {
  if (inSr == 0 || outSr == 0 || inFrames == 0) {
    out.clear();
    outFrames = 0;
    return;
  }
  if (inSr == outSr) {
    out = in;
    outFrames = inFrames;
    return;
  }
  const double ratio = static_cast<double>(outSr) / static_cast<double>(inSr);
  outFrames = static_cast<uint32_t>(std::max<int64_t>(1, std::llround(inFrames * ratio)));
  out.assign(static_cast<size_t>(outFrames) * 2u, 0.f);
  for (uint32_t i = 0; i < outFrames; ++i) {
    const double srcPos = static_cast<double>(i) / ratio;
    const uint32_t i0 = static_cast<uint32_t>(srcPos);
    const uint32_t i1 = std::min(i0 + 1u, inFrames - 1u);
    const float frac = static_cast<float>(srcPos - static_cast<double>(i0));
    const float l0 = in[i0 * 2];
    const float r0 = in[i0 * 2 + 1];
    const float l1 = in[i1 * 2];
    const float r1 = in[i1 * 2 + 1];
    out[i * 2] = l0 + (l1 - l0) * frac;
    out[i * 2 + 1] = r0 + (r1 - r0) * frac;
  }
}

void renderVoiceInto(const ClipVoice& v, const ClipBuffer& buf, int64_t clockSamples, float* interleaved,
                     uint32_t frames) {
  if (!v.active || !interleaved || frames == 0 || buf.frames == 0) return;
  const int64_t voiceEnd = v.startSample + v.durationSamples;
  const int64_t blockStart = clockSamples;
  const int64_t blockEnd = clockSamples + static_cast<int64_t>(frames);
  if (blockEnd <= v.startSample || blockStart >= voiceEnd) return;

  float gL = v.gain;
  float gR = v.gain;
  if (v.pan < 0.f) gR *= 1.f + v.pan;
  else if (v.pan > 0.f) gL *= 1.f - v.pan;

  for (uint32_t i = 0; i < frames; ++i) {
    const int64_t absS = clockSamples + static_cast<int64_t>(i);
    if (absS < v.startSample || absS >= voiceEnd) continue;
    const int64_t into = absS - v.startSample + v.sourceOffset;
    if (into < 0 || into >= static_cast<int64_t>(buf.frames)) continue;
    const size_t si = static_cast<size_t>(into) * 2u;
    interleaved[i * 2] += buf.interleaved[si] * gL;
    interleaved[i * 2 + 1] += buf.interleaved[si + 1] * gR;
  }
}

} // namespace

bool clip_load_path(const std::string& clipId, const std::string& path, std::string& err) {
  if (clipId.empty() || path.empty()) {
    err = "clipId/path vacíos";
    return false;
  }
  ma_decoder_config cfg = ma_decoder_config_init(ma_format_f32, 0, 0);
  ma_decoder dec{};
  if (ma_decoder_init_file(path.c_str(), &cfg, &dec) != MA_SUCCESS) {
    err = "ma_decoder_init_file falló";
    return false;
  }
  const uint32_t channels = dec.outputChannels ? dec.outputChannels : 2;
  const uint32_t inSr = dec.outputSampleRate ? dec.outputSampleRate : 48000;

  std::vector<float> packed;
  ma_uint64 frameCount = 0;
  if (ma_decoder_get_length_in_pcm_frames(&dec, &frameCount) == MA_SUCCESS && frameCount > 0) {
    packed.resize(static_cast<size_t>(frameCount) * channels);
    ma_uint64 read = 0;
    if (ma_decoder_read_pcm_frames(&dec, packed.data(), frameCount, &read) != MA_SUCCESS || read == 0) {
      ma_decoder_uninit(&dec);
      err = "lectura PCM falló";
      return false;
    }
    packed.resize(static_cast<size_t>(read) * channels);
    frameCount = read;
  } else {
    float tmp[4096 * 8];
    for (;;) {
      ma_uint64 read = 0;
      const ma_result r = ma_decoder_read_pcm_frames(&dec, tmp, 4096, &read);
      if (read == 0) break;
      const size_t old = packed.size();
      packed.resize(old + static_cast<size_t>(read) * channels);
      std::memcpy(packed.data() + old, tmp, static_cast<size_t>(read) * channels * sizeof(float));
      frameCount += read;
      if (r != MA_SUCCESS) break;
    }
  }
  ma_decoder_uninit(&dec);
  if (frameCount == 0 || packed.empty()) {
    err = "archivo vacío";
    return false;
  }

  std::vector<float> stereo;
  toStereo(packed.data(), static_cast<uint32_t>(frameCount), channels, stereo);
  const uint32_t hostSr = static_cast<uint32_t>(std::lround(transport_clock_sample_rate()));
  ClipBuffer buf;
  resampleLinear(stereo, static_cast<uint32_t>(frameCount), inSr, hostSr ? hostSr : inSr, buf.interleaved,
                 buf.frames);
  buf.sampleRate = hostSr ? hostSr : inSr;

  std::lock_guard<std::mutex> lock(gMu);
  gBuffers[clipId] = std::move(buf);
  err.clear();
  return true;
}

bool clip_load_pcm(const std::string& clipId, const float* interleaved, uint32_t frames,
                   uint32_t channels, uint32_t sampleRate, std::string& err) {
  if (clipId.empty() || !interleaved || frames == 0) {
    err = "pcm inválido";
    return false;
  }
  std::vector<float> stereo;
  toStereo(interleaved, frames, channels ? channels : 2, stereo);
  const uint32_t inSr = sampleRate ? sampleRate : 48000;
  const uint32_t hostSr = static_cast<uint32_t>(std::lround(transport_clock_sample_rate()));
  ClipBuffer buf;
  resampleLinear(stereo, frames, inSr, hostSr ? hostSr : inSr, buf.interleaved, buf.frames);
  buf.sampleRate = hostSr ? hostSr : inSr;

  std::lock_guard<std::mutex> lock(gMu);
  gBuffers[clipId] = std::move(buf);
  err.clear();
  return true;
}

void clip_unload(const std::string& clipId) {
  std::lock_guard<std::mutex> lock(gMu);
  gBuffers.erase(clipId);
  gVoices.erase(std::remove_if(gVoices.begin(), gVoices.end(),
                               [&](const ClipVoice& v) { return v.clipId == clipId; }),
                gVoices.end());
}

void clip_unload_all() {
  std::lock_guard<std::mutex> lock(gMu);
  gBuffers.clear();
  gVoices.clear();
}

void clip_schedule(const std::string& clipId, uint16_t trackIndex, int64_t startSample,
                   int64_t durationSamples, int64_t sourceOffsetSamples, float gain, float pan) {
  std::lock_guard<std::mutex> lock(gMu);
  if (gBuffers.find(clipId) == gBuffers.end()) return;
  ClipVoice v;
  v.clipId = clipId;
  v.trackIndex = trackIndex;
  v.startSample = std::max<int64_t>(0, startSample);
  v.durationSamples = std::max<int64_t>(0, durationSamples);
  v.sourceOffset = std::max<int64_t>(0, sourceOffsetSamples);
  v.gain = std::clamp(gain, 0.f, 4.f);
  v.pan = std::clamp(pan, -1.f, 1.f);
  v.active = true;
  gVoices.push_back(std::move(v));
}

void clip_stop_all_scheduled() {
  std::lock_guard<std::mutex> lock(gMu);
  gVoices.clear();
}

void clip_render_stem(uint16_t trackIndex, float* interleavedStereo, uint32_t frames) {
  if (!interleavedStereo || frames == 0) return;
  const int64_t clock = transport_clock_samples();
  std::lock_guard<std::mutex> lock(gMu);
  for (const auto& v : gVoices) {
    if (!v.active || v.trackIndex != trackIndex) continue;
    auto it = gBuffers.find(v.clipId);
    if (it == gBuffers.end()) continue;
    renderVoiceInto(v, it->second, clock, interleavedStereo, frames);
  }
}

void clip_render_mix(float* outL, float* outR, uint32_t frames) {
  if (!outL || !outR || frames == 0) return;
  std::vector<float> tmp(static_cast<size_t>(frames) * 2u, 0.f);
  const int64_t clock = transport_clock_samples();
  {
    std::lock_guard<std::mutex> lock(gMu);
    for (const auto& v : gVoices) {
      if (!v.active) continue;
      auto it = gBuffers.find(v.clipId);
      if (it == gBuffers.end()) continue;
      renderVoiceInto(v, it->second, clock, tmp.data(), frames);
    }
  }
  for (uint32_t i = 0; i < frames; ++i) {
    outL[i] += tmp[i * 2];
    outR[i] += tmp[i * 2 + 1];
  }
}

} // namespace jaswave
