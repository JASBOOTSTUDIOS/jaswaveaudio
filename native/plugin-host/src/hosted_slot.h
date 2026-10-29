#pragma once
/**
 * Slot hospedado exclusivo VST3 64-bit (JasWave DAW).
 * VST2 retirado (ADR-0019): este host solo carga .vst3.
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

#include "vst3_slot.h"

class HostedSlot {
public:
  enum class Format { Vst3 };

  static std::unique_ptr<HostedSlot> createForPath(const std::string& /*path*/) {
    auto s = std::unique_ptr<HostedSlot>(new HostedSlot());
    s->format_ = Format::Vst3;
    s->vst3_ = std::make_unique<Vst3Slot>();
    return s;
  }

  Format format() const { return format_; }

  bool load(const std::string& path, std::string& err) {
    return vst3_ ? vst3_->load(path, err) : false;
  }
  bool prepare(double sampleRate, int32_t blockSize, std::string& err) {
    sampleRate_.store(sampleRate > 0 ? sampleRate : 48000.0, std::memory_order_relaxed);
    return vst3_ ? vst3_->prepare(sampleRate, blockSize, err) : false;
  }
  bool reprepare(double sampleRate, int32_t blockSize, std::string& err) {
    sampleRate_.store(sampleRate > 0 ? sampleRate : 48000.0, std::memory_order_relaxed);
    return vst3_ ? vst3_->reprepare(sampleRate, blockSize, err) : false;
  }
  void suspendForAudioRestart() {
    if (vst3_) vst3_->suspendForAudioRestart();
  }
  void unload() {
    if (vst3_) vst3_->unload();
  }

  void noteOn(int pitch, float velocity, int delaySamples = 0, int32_t lengthSamples = 0, int channel = 0) {
    if (vst3_) vst3_->noteOn(pitch, velocity, delaySamples, lengthSamples, channel);
  }
  void noteOff(int pitch, int delaySamples = 0, int channel = 0) {
    if (vst3_) vst3_->noteOff(pitch, delaySamples, channel);
  }
  void midiCc(int cc, int value, int delaySamples = 0, int channel = 0) {
    if (vst3_) vst3_->midiCc(cc, value, delaySamples, channel);
  }
  void allNotesOff() {
    if (vst3_) vst3_->allNotesOff();
  }
  /** Stop duro: vacía voces y colas (reverb/delay) del plugin sin tocar sus parámetros. Hilo UI. */
  void flushDsp() {
    if (vst3_) vst3_->flushDsp();
  }
  void setParameterNormalized(uint32_t paramId, double normalized) {
    if (vst3_) vst3_->setParameterNormalized(paramId, normalized);
  }
  std::vector<Vst3ParamDesc> listParameters(int maxCount = 400) {
    return vst3_ ? vst3_->listParameters(maxCount) : std::vector<Vst3ParamDesc>{};
  }
  void setPlaying(bool playing) {
    if (vst3_) vst3_->setPlaying(playing);
  }
  void setTransport(bool playing, double tempoBpm, double ppqPos = -1.0) {
    if (vst3_) vst3_->setTransport(playing, tempoBpm, ppqPos);
  }

  void process(const float* inL, const float* inR, float* outL, float* outR, int frames) {
    const int64_t t0 = now();
    if (vst3_) vst3_->process(inL, inR, outL, outR, frames);
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
    s.exceptions = (vst3_ ? vst3_->processExceptions() : 0) - exceptionsBase_.load(std::memory_order_relaxed);
    return s;
  }
  void resetStats() {
    blocks_.store(0, std::memory_order_relaxed);
    overruns_.store(0, std::memory_order_relaxed);
    loadSumPpm_.store(0, std::memory_order_relaxed);
    maxLoadPpm_.store(0, std::memory_order_relaxed);
    exceptionsBase_.store(vst3_ ? vst3_->processExceptions() : 0, std::memory_order_relaxed);
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
    return vst3_ ? vst3_->openEditor(parentHwnd, x, y, w, h, err) : false;
  }
  void setEditorBounds(int x, int y, int w, int h) {
    if (vst3_) vst3_->setEditorBounds(x, y, w, h);
  }
  /** Solo VST3 (los VST propios de JasWave y terceros VST3). */
  bool supportsEmbeddedEditor() const { return vst3_ != nullptr; }
  bool openEditorEmbedded(int x, int y, int w, int h, std::string& err) {
    if (!vst3_) {
      err = "editor embebido solo para VST3";
      return false;
    }
    return vst3_->openEditorEmbedded(x, y, w, h, err);
  }
  void setEmbeddedBounds(int x, int y, int w, int h, bool visible, bool raise) {
    if (vst3_) vst3_->setEmbeddedBounds(x, y, w, h, visible, raise);
  }
  void closeEditor() {
    if (vst3_) vst3_->closeEditor();
  }
  bool hasEditor() const { return vst3_ ? vst3_->hasEditor() : false; }
  void setEditorPinned(bool pinned) { if (vst3_) vst3_->setEditorPinned(pinned); }
  bool editorPinned() const { return vst3_ && vst3_->editorPinned(); }
  void raiseEditorPinned() { if (vst3_) vst3_->raiseEditorPinned(); }
  void setEditorPinVisible(bool visible) { if (vst3_) vst3_->setEditorPinVisible(visible); }
  bool editorTopmost() const { return vst3_ && vst3_->editorTopmost(); }
  std::uintptr_t editorHwnd() const { return vst3_ ? vst3_->editorHwnd() : 0; }
  bool editorEmbedded() const { return vst3_ && vst3_->editorEmbedded(); }
  void setEditorTitle(const std::string& utf8) { if (vst3_) vst3_->setEditorTitle(utf8); }

  bool getStateChunk(std::vector<uint8_t>& out, std::string& err) {
    if (vst3_) return vst3_->getStateChunk(out, err);
    err = "sin slot VST3";
    return false;
  }
  bool setStateChunk(const uint8_t* data, size_t nbytes, std::string& err) {
    if (vst3_) return vst3_->setStateChunk(data, nbytes, err);
    err = "sin slot VST3";
    return false;
  }

  const std::string& path() const { return vst3_ ? vst3_->path() : emptyPath_; }
  const std::string& slotId() const { return vst3_ ? vst3_->slotId() : emptyPath_; }
  void setSlotId(std::string id) {
    if (vst3_) vst3_->setSlotId(std::move(id));
  }
  bool isPrepared() const { return vst3_ ? vst3_->isPrepared() : false; }
  int latencySamples() const { return vst3_ ? vst3_->latencySamples() : 0; }
  void waitNotProcessing() {
    if (vst3_) vst3_->waitNotProcessing();
  }
  void setMix(float gain, float pan, bool muted) {
    if (vst3_) vst3_->setMix(gain, pan, muted);
  }
  void applyMix(float* outL, float* outR, int frames) const {
    if (vst3_) vst3_->applyMix(outL, outR, frames);
  }
  void setBypass(bool bypass) {
    if (vst3_) vst3_->setBypass(bypass);
  }
  bool isBypassed() const { return vst3_ ? vst3_->isBypassed() : false; }

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
  const std::string emptyPath_{""};
};
