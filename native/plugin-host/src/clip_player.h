/**
 * Reproductor de clips de audio nativos (sample-accurate vs transport_clock).
 */
#pragma once

#include <cstdint>
#include <string>

namespace jaswave {

/** Carga WAV/PCM desde archivo (miniaudio decoder) o PCM base64 interleaved f32. */
bool clip_load_path(const std::string& clipId, const std::string& path, std::string& err);
bool clip_load_pcm(const std::string& clipId, const float* interleaved, uint32_t frames,
                   uint32_t channels, uint32_t sampleRate, std::string& err);
void clip_unload(const std::string& clipId);
void clip_unload_all();

/**
 * Programa reproducción relativa al reloj de transporte.
 * startSample / durationSamples en el sample rate del device (host clock).
 */
void clip_schedule(const std::string& clipId, uint16_t trackIndex, int64_t startSample,
                   int64_t durationSamples, int64_t sourceOffsetSamples, float gain, float pan);
void clip_stop_all_scheduled();

/** Suma audio de clips activos al stem interleaved (REPLACE semantics: add into buffer). */
void clip_render_stem(uint16_t trackIndex, float* interleavedStereo, uint32_t frames);
/** Suma todos los clips (legacy / sin graph) al mix L/R. */
void clip_render_mix(float* outL, float* outR, uint32_t frames);

} // namespace jaswave
