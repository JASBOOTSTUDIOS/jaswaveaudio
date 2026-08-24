#pragma once
/**
 * Slot VST2 out-of-process (LoadLibrary + AEffect). Solo x64 en Windows.
 */

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

#include "vst3_slot.h"  // Vst3MidiEvent / Vst3ParamDesc reutilizados

class Vst2Slot {
public:
  Vst2Slot();
  ~Vst2Slot();

  Vst2Slot(const Vst2Slot&) = delete;
  Vst2Slot& operator=(const Vst2Slot&) = delete;

  bool load(const std::string& path, std::string& err);
  bool prepare(double sampleRate, int32_t blockSize, std::string& err);
  bool reprepare(double sampleRate, int32_t blockSize, std::string& err);
  void suspendForAudioRestart();
  void unload();

  void noteOn(int pitch, float velocity, int delaySamples = 0);
  void noteOff(int pitch, int delaySamples = 0);
  void midiCc(int cc, int value, int delaySamples = 0);
  void allNotesOff();
  void setParameterNormalized(uint32_t paramId, double normalized);
  std::vector<Vst3ParamDesc> listParameters(int maxCount = 400);
  void setPlaying(bool playing);

  void process(const float* inL, const float* inR, float* outL, float* outR, int frames);
  void process(float* outL, float* outR, int frames) { process(nullptr, nullptr, outL, outR, frames); }

  bool openEditor(std::uintptr_t parentHwnd, int x, int y, int w, int h, std::string& err);
  void setEditorBounds(int x, int y, int w, int h);
  void closeEditor();
  bool hasEditor() const;
  /** Llamar desde el message pump (effEditIdle). */
  void idleEditor();
  /** Chunk de programa/banco (effGetChunk / effSetChunk). */
  bool getStateChunk(std::vector<uint8_t>& out, std::string& err);
  bool setStateChunk(const uint8_t* data, size_t nbytes, std::string& err);

  const std::string& path() const { return path_; }
  const std::string& slotId() const { return slotId_; }
  void setSlotId(std::string id) { slotId_ = std::move(id); }
  bool isPrepared() const { return prepared_.load(); }
  int latencySamples() const { return latencySamples_; }
  void waitNotProcessing();
  void setMix(float gain, float pan, bool muted);
  void applyMix(float* outL, float* outR, int frames) const;
  void setBypass(bool bypass) { bypass_.store(bypass, std::memory_order_relaxed); }
  bool isBypassed() const { return bypass_.load(std::memory_order_relaxed); }

  static bool isPe64Dll(const std::string& path);

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  std::string path_;
  std::string slotId_;
  std::atomic<bool> prepared_{false};
  std::atomic<bool> inProcess_{false};
  std::atomic<float> mixGain_{1.f};
  std::atomic<float> mixPan_{0.f};
  std::atomic<bool> mixMuted_{false};
  std::atomic<bool> bypass_{false};
  int latencySamples_{0};
};
