#pragma once
/**
 * Slot hospedado: VST3 o VST2 detrás de la misma API usada por main.cpp.
 */

#include <memory>
#include <string>
#include <vector>

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
    return vst2_ ? vst2_->prepare(sampleRate, blockSize, err) : vst3_->prepare(sampleRate, blockSize, err);
  }
  bool reprepare(double sampleRate, int32_t blockSize, std::string& err) {
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

  void noteOn(int pitch, float velocity, int delaySamples = 0) {
    if (vst2_) vst2_->noteOn(pitch, velocity, delaySamples);
    else vst3_->noteOn(pitch, velocity, delaySamples);
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

  void process(const float* inL, const float* inR, float* outL, float* outR, int frames) {
    if (vst2_) vst2_->process(inL, inR, outL, outR, frames);
    else vst3_->process(inL, inR, outL, outR, frames);
  }
  void process(float* outL, float* outR, int frames) { process(nullptr, nullptr, outL, outR, frames); }

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
  Format format_{Format::Vst3};
  std::unique_ptr<Vst3Slot> vst3_;
  std::unique_ptr<Vst2Slot> vst2_;
};
