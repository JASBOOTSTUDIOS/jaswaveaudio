#pragma once

#include "roles_map.h"
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "pluginterfaces/vst/ivstevents.h"

#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace JasWaveRoles {

// Processor UID: JasW Role Proc
static const Steinberg::FUID kProcessorUid(0x4A617357, 0x526F6C65, 0x50726F63, 0x56335431);
// Controller UID: JasW Role Ctrl
static const Steinberg::FUID kControllerUid(0x4A617357, 0x526F6C65, 0x436E7472, 0x56335431);

enum class OscType : uint8_t { Sine, Triangle, Saw, Square, Noise };

struct Partial {
  OscType type{OscType::Sine};
  float freqHz{440.f};
  float gain{0.f};
  float phase{0.f};
  float detuneCents{0.f};
  bool active{false};
};

struct Voice {
  bool active{false};
  bool releasing{false};
  int16_t pitch{60};
  float velocity{0.f};
  Role role{Role::Default};
  uint64_t age{0};
  float env{0.f};
  float envTarget{0.f};
  float attackInc{0.f};
  float releaseInc{0.f};
  float filterCutoff{2000.f};
  float filterQ{0.7f};
  float filterZ1{0.f};
  float filterZ2{0.f};
  float noiseState{0.f};
  int samplesLeft{0};
  bool oneShot{false};
  std::array<Partial, 3> partials{};
};

class Processor : public Steinberg::Vst::AudioEffect {
public:
  Processor();

  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IAudioProcessor*>(new Processor());
  }

  Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API setBusArrangements(Steinberg::Vst::SpeakerArrangement* inputs,
                                                   Steinberg::int32 numIns,
                                                   Steinberg::Vst::SpeakerArrangement* outputs,
                                                   Steinberg::int32 numOuts) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API canProcessSampleSize(Steinberg::int32 symbolicSampleSize) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API setActive(Steinberg::TBool state) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API setProcessing(Steinberg::TBool state) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API process(Steinberg::Vst::ProcessData& data) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API setState(Steinberg::IBStream* state) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API getState(Steinberg::IBStream* state) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API getControllerClassId(Steinberg::TUID classId) SMTG_OVERRIDE;

private:
  void applyRole(double normalized);
  void noteOn(int16_t pitch, float velocity, int32_t sampleOffset);
  void noteOff(int16_t pitch, int32_t sampleOffset);
  void panicAll();
  void setupVoice(Voice& v, int16_t pitch, float velocity, Role role);
  int32_t allocVoice(Role role);
  void render(float* L, float* R, int32_t numSamples);
  void applyFx(float* L, float* R, int32_t numSamples);
  float nextOsc(Partial& p, float sr);
  float processFilter(Voice& v, float x);
  void ensureFxBuffers(float sr);

  double sampleRate_{48000.0};
  std::atomic<int32_t> activeRole_{static_cast<int32_t>(Role::Default)};
  std::atomic<float> attackN_{0.35f};
  std::atomic<float> releaseN_{0.4f};
  std::atomic<float> cutoffN_{0.55f};
  std::atomic<float> resonanceN_{0.25f};
  std::atomic<float> gainN_{0.85f};
  std::atomic<float> voicesN_{0.5f};
  std::atomic<float> driveN_{0.15f};
  std::atomic<float> gateN_{0.0f};
  std::atomic<float> chorusN_{0.2f};
  std::atomic<float> delayN_{0.15f};
  std::atomic<float> reverbN_{0.25f};
  std::atomic<float> eqLowN_{0.5f};
  std::atomic<float> eqHighN_{0.5f};
  bool wasPlaying_{false};
  std::array<Voice, kMaxVoices> voices_{};
  uint64_t ageCounter_{0};
  uint32_t noiseSeed_{0xA5A5A5A5u};

  // FX state
  float gateEnv_{0.f};
  float eqLowZ_{0.f};
  float eqHighZ_{0.f};
  float chorusPhase_{0.f};
  std::vector<float> delayBufL_{};
  std::vector<float> delayBufR_{};
  int delayWrite_{0};
  std::vector<float> chorusBuf_{};
  int chorusWrite_{0};
  std::array<float, 4> revComb_{};
  std::array<int, 4> revCombW_{};
  std::vector<float> revCombBuf0_{};
  std::vector<float> revCombBuf1_{};
  std::vector<float> revCombBuf2_{};
  std::vector<float> revCombBuf3_{};
};

} // namespace JasWaveRoles
