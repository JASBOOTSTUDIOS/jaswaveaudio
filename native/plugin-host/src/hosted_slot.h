#pragma once
/**
 * Slot hospedado: VST3 o VST2 detrás de la misma API usada por main.cpp.
 */

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <algorithm>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

#include "vst2_slot.h"
#include "vst3_slot.h"

class HostedSlot {
public:
  enum class Format { Vst3, Vst2 };

  static bool pathLooksVst2(const std::string& path) {
    if (path.size() < 4) return false;
    const char* e = path.c_str() + path.size() - 4;
    return (e[0] == '.' && (e[1] == 'd' || e[1] == 'D') && (e[2] == 'l' || e[2] == 'L') &&
            (e[3] == 'l' || e[3] == 'L'));
  }

  static std::unique_ptr<HostedSlot> createForPath(const std::string& path) {
    auto s = std::unique_ptr<HostedSlot>(new HostedSlot());
    if (pathLooksVst2(path)) {
      s->format_ = Format::Vst2;
      s->vst2_ = std::make_unique<Vst2Slot>();
    } else {
      s->format_ = Format::Vst3;
      s->vst3_ = std::make_unique<Vst3Slot>();
    }
    return s;
  }

  Format format() const { return format_; }

  bool load(const std::string& path, std::string& err) {
    return vst2_ ? vst2_->load(path, err) : vst3_->load(path, err);
  }
  bool prepare(double sampleRate, int32_t blockSize, std::string& err) {
    sampleRate_.store(sampleRate > 0 ? sampleRate : 48000.0, std::memory_order_relaxed);
    return vst2_ ? vst2_->prepare(sampleRate, blockSize, err) : vst3_->prepare(sampleRate, blockSize, err);
  }
  bool reprepare(double sampleRate, int32_t blockSize, std::string& err) {
    sampleRate_.store(sampleRate > 0 ? sampleRate : 48000.0, std::memory_order_relaxed);
    return vst2_ ? vst2_->reprepare(sampleRate, blockSize, err)
                 : vst3_->reprepare(sampleRate, blockSize, err);
  }
  void suspendForAudioRestart() {
    if (vst2_) vst2_->suspendForAudioRestart();
    else vst3_->suspendForAudioRestart();
  }
  void unload() {
    if (vst2_) vst2_->unload();
    else vst3_->unload();
  }

  void noteOn(int pitch, float velocity, int delaySamples = 0, int32_t lengthSamples = 0) {
    if (vst2_) vst2_->noteOn(pitch, velocity, delaySamples);
    else vst3_->noteOn(pitch, velocity, delaySamples, lengthSamples);
  }
  void noteOff(int pitch, int delaySamples = 0) {
    if (vst2_) vst2_->noteOff(pitch, delaySamples);
    else vst3_->noteOff(pitch, delaySamples);
  }
  void midiCc(int cc, int value, int delaySamples = 0) {
    if (vst2_) vst2_->midiCc(cc, value, delaySamples);
    else vst3_->midiCc(cc, value, delaySamples);
  }
  void allNotesOff() {
    if (vst2_) vst2_->allNotesOff();
    else vst3_->allNotesOff();
  }
  void setParameterNormalized(uint32_t paramId, double normalized) {
    if (vst2_) vst2_->setParameterNormalized(paramId, normalized);
    else vst3_->setParameterNormalized(paramId, normalized);
  }
  std::vector<Vst3ParamDesc> listParameters(int maxCount = 400) {
    return vst2_ ? vst2_->listParameters(maxCount) : vst3_->listParameters(maxCount);
  }
  void setPlaying(bool playing) {
    if (vst2_) vst2_->setPlaying(playing);
    else vst3_->setPlaying(playing);
  }
  void setTransport(bool playing, double tempoBpm, double ppqPos = -1.0) {
    if (vst2_) {
      vst2_->setTransport(playing, tempoBpm, ppqPos);
    } else if (vst3_) {
      vst3_->setTransport(playing, tempoBpm, ppqPos);
    }
  }

  void process(const float* inL, const float* inR, float* outL, float* outR, int frames) {
    const int64_t t0 = now();
    if (vst2_) vst2_->process(inL, inR, outL, outR, frames);
    else vst3_->process(inL, inR, outL, outR, frames);
    recordLoad(now() - t0, frames);
  }

  // ---- Estadísticas de carga por slot (getSlotStats): sin locks ni asignaciones ----
  struct Stats {
    uint64_t blocks{0}, overruns{0};
    double avgLoad{0.0}, maxLoad{0.0};
    uint32_t exceptions{0};
  };
  Stats stats() const {
    Stats s;
    s.blocks = blocks_.load(std::memory_order_relaxed);
    s.overruns = overruns_.load(std::memory_order_relaxed);
    const uint64_t sum = loadSumPpm_.load(std::memory_order_relaxed);
    s.avgLoad = s.blocks ? (static_cast<double>(sum) / 1.0e6) / static_cast<double>(s.blocks) : 0.0;
    s.maxLoad = maxLoadPpm_.load(std::memory_order_relaxed) / 1.0e6;
    s.exceptions = (vst2_ ? vst2_->processExceptions() : vst3_->processExceptions()) - exceptionsBase_.load(std::memory_order_relaxed);
    return s;
  }
  void resetStats() {
    blocks_.store(0, std::memory_order_relaxed);
    overruns_.store(0, std::memory_order_relaxed);
    loadSumPpm_.store(0, std::memory_order_relaxed);
    maxLoadPpm_.store(0, std::memory_order_relaxed);
    exceptionsBase_.store(vst2_ ? vst2_->processExceptions() : vst3_->processExceptions(), std::memory_order_relaxed);
  }
  void process(float* outL, float* outR, int frames) { process(nullptr, nullptr, outL, outR, frames); }

  bool hasSidechainInput() const {
    return vst3_ && vst3_->hasSidechainInput();
  }
  void setSidechainInput(const float* l, const float* r, int frames) {
    if (vst3_) vst3_->setSidechainInput(l, r, frames);
  }
  void clearSidechainInput() {
    if (vst3_) vst3_->clearSidechainInput();
  }

  bool openEditor(std::uintptr_t parentHwnd, int x, int y, int w, int h, std::string& err) {
    return vst2_ ? vst2_->openEditor(parentHwnd, x, y, w, h, err)
                 : vst3_->openEditor(parentHwnd, x, y, w, h, err);
  }
  void setEditorBounds(int x, int y, int w, int h) {
    if (vst2_) vst2_->setEditorBounds(x, y, w, h);
    else vst3_->setEditorBounds(x, y, w, h);
  }
  void closeEditor() {
    if (vst2_) vst2_->closeEditor();
    else vst3_->closeEditor();
  }
  bool hasEditor() const { return vst2_ ? vst2_->hasEditor() : vst3_->hasEditor(); }

  bool getStateChunk(std::vector<uint8_t>& out, std::string& err) {
    if (vst2_) return vst2_->getStateChunk(out, err);
    if (vst3_) return vst3_->getStateChunk(out, err);
    err = "sin slot";
    return false;
  }
  bool setStateChunk(const uint8_t* data, size_t nbytes, std::string& err) {
    if (vst2_) return vst2_->setStateChunk(data, nbytes, err);
    if (vst3_) return vst3_->setStateChunk(data, nbytes, err);
    err = "sin slot";
    return false;
  }

  const std::string& path() const { return vst2_ ? vst2_->path() : vst3_->path(); }
  const std::string& slotId() const { return vst2_ ? vst2_->slotId() : vst3_->slotId(); }
  void setSlotId(std::string id) {
    if (vst2_) vst2_->setSlotId(std::move(id));
    else vst3_->setSlotId(std::move(id));
  }
  bool isPrepared() const { return vst2_ ? vst2_->isPrepared() : vst3_->isPrepared(); }
  int latencySamples() const { return vst2_ ? vst2_->latencySamples() : vst3_->latencySamples(); }
  void waitNotProcessing() {
    if (vst2_) vst2_->waitNotProcessing();
    else vst3_->waitNotProcessing();
  }
  void setMix(float gain, float pan, bool muted) {
    if (vst2_) vst2_->setMix(gain, pan, muted);
    else vst3_->setMix(gain, pan, muted);
  }
  void applyMix(float* outL, float* outR, int frames) const {
    if (vst2_) vst2_->applyMix(outL, outR, frames);
    else vst3_->applyMix(outL, outR, frames);
  }
  void setBypass(bool bypass) {
    if (vst2_) vst2_->setBypass(bypass);
    else vst3_->setBypass(bypass);
  }
  bool isBypassed() const { return vst2_ ? vst2_->isBypassed() : vst3_->isBypassed(); }

private:
  HostedSlot() = default;
  static int64_t now() {
#ifdef _WIN32
    LARGE_INTEGER c;
    QueryPerformanceCounter(&c);
    return c.QuadPart;
#else
    return 0;
#endif
  }
  static double ticksPerSecond() {
#ifdef _WIN32
    static const double f = [] { LARGE_INTEGER q; QueryPerformanceFrequency(&q); return static_cast<double>(q.QuadPart); }();
    return f;
#else
    return 1.0;
#endif
  }
  // load = tiempo de process() / duración real del bloque (frames / sampleRate)
  void recordLoad(int64_t ticks, int frames) {
    if (frames <= 0) return;
    const double blockSec = static_cast<double>(frames) / sampleRate_.load(std::memory_order_relaxed);
    const double load = (static_cast<double>(ticks) / ticksPerSecond()) / blockSec;
    const uint64_t ppm = static_cast<uint64_t>(load * 1.0e6 + 0.5);
    blocks_.fetch_add(1, std::memory_order_relaxed);
    loadSumPpm_.fetch_add(ppm, std::memory_order_relaxed);
    if (load > 1.0) overruns_.fetch_add(1, std::memory_order_relaxed);
    const uint32_t p32 = static_cast<uint32_t>(std::min<uint64_t>(ppm, 0xFFFFFFFFull));
    uint32_t prev = maxLoadPpm_.load(std::memory_order_relaxed);
    while (p32 > prev && !maxLoadPpm_.compare_exchange_weak(prev, p32, std::memory_order_relaxed)) {}
  }
  std::atomic<double> sampleRate_{48000.0};
  std::atomic<uint64_t> blocks_{0}, overruns_{0}, loadSumPpm_{0};
  std::atomic<uint32_t> maxLoadPpm_{0};
  std::atomic<uint32_t> exceptionsBase_{0};
  Format format_{Format::Vst3};
  std::unique_ptr<Vst3Slot> vst3_;
  std::unique_ptr<Vst2Slot> vst2_;
};
