#pragma once
/**
 * Slot VST3 out-of-process (ADR-0011): load + MIDI + process + editor HWND hijo.
 */

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

struct Vst3MidiEvent {
  enum class Kind { NoteOn, NoteOff, ControlChange };
  Kind kind{};
  int16_t pitch{0};
  float velocity{0};
  int16_t cc{0};
  int16_t ccValue{0};
  int32_t delaySamples{0};
  int32_t lengthSamples{0};
};

struct Vst3ParamDesc {
  uint32_t id{0};
  std::string name;
  std::string shortName;
  std::string unit;
  std::string display;
  double normalized{0};
  double defaultNormalized{0};
  int32_t stepCount{0};
  bool automatable{true};
  bool readOnly{false};
  bool hidden{false};
  bool bypass{false};
  bool programChange{false};
};

class Vst3Slot {
public:
  Vst3Slot();
  ~Vst3Slot();

  Vst3Slot(const Vst3Slot&) = delete;
  Vst3Slot& operator=(const Vst3Slot&) = delete;

  bool load(const std::string& path, std::string& err);
  bool prepare(double sampleRate, int32_t blockSize, std::string& err);
  bool reprepare(double sampleRate, int32_t blockSize, std::string& err);
  /** setProcessing/setActive off sin descargar (cambio de driver). */
  void suspendForAudioRestart();
  void unload();

  void noteOn(int pitch, float velocity, int delaySamples = 0, int32_t lengthSamples = 0);
  void noteOff(int pitch, int delaySamples = 0);
  void midiCc(int cc, int value, int delaySamples = 0);
  /** Sustain off + all notes/sound off + noteOff 0-127. */
  void allNotesOff();
  void setParameterNormalized(uint32_t paramId, double normalized);
  std::vector<Vst3ParamDesc> listParameters(int maxCount = 400);
  void setPlaying(bool playing);
  void setTransport(bool playing, double tempoBpm, double ppqPos = -1.0);

  /** Procesa un bloque. Si inL/inR son null, entrada silenciosa (instrumento). */
  void process(const float* inL, const float* inR, float* outL, float* outR, int frames);
  /** Compat: entrada silenciosa. */
  void process(float* outL, float* outR, int frames) { process(nullptr, nullptr, outL, outR, frames); }

  /** true si el plugin expone bus aux/sidechain de entrada. */
  bool hasSidechainInput() const;
  /** Alimenta el bus sidechain (estéreo) para el próximo process(). */
  void setSidechainInput(const float* l, const float* r, int frames);
  void clearSidechainInput();

  bool openEditor(std::uintptr_t parentHwnd, int x, int y, int w, int h, std::string& err);
  void setEditorBounds(int x, int y, int w, int h);
  void closeEditor();
  bool hasEditor() const;

  /** Persistencia IComponent::getState / setState (y controller si aplica). */
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
