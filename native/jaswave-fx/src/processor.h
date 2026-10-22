#pragma once

#include "dsp.h"
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"

#include <array>
#include <atomic>
#include <cstdint>
#include <vector>

namespace JasWaveFx {

// ──────────────────────────────────────────────────────────────
// UIDs de clase (uno por procesador + su controlador)
// ──────────────────────────────────────────────────────────────

static const Steinberg::FUID kEqProcessorUid(0x4A617357, 0x46584551, 0x50726F63, 0x56335431); // JW FX EQ Proc
static const Steinberg::FUID kEqControllerUid(0x4A617357, 0x46584551, 0x436E7472, 0x56335431); // JW FX EQ Ctrl

static const Steinberg::FUID kCompProcessorUid(0x4A617357, 0x434F4D50, 0x50726F63, 0x56335431); // JW FX Comp Proc
static const Steinberg::FUID kCompControllerUid(0x4A617357, 0x434F4D50, 0x436E7472, 0x56335431); // JW FX Comp Ctrl

static const Steinberg::FUID kLimProcessorUid(0x4A617357, 0x4C494D49, 0x50726F63, 0x56335431); // JW FX Lim Proc
static const Steinberg::FUID kLimControllerUid(0x4A617357, 0x4C494D49, 0x436E7472, 0x56335431); // JW FX Lim Ctrl

static const Steinberg::FUID kUtilProcessorUid(0x4A617357, 0x5554494C, 0x50726F63, 0x56335431); // JW FX Util Proc
static const Steinberg::FUID kUtilControllerUid(0x4A617357, 0x5554494C, 0x436E7472, 0x56335431); // JW FX Util Ctrl

static const Steinberg::FUID kDeEsserProcessorUid(0x4A617357, 0x44455352, 0x50726F63, 0x56335431); // JW FX DE Proc
static const Steinberg::FUID kDeEsserControllerUid(0x4A617357, 0x44455352, 0x436E7472, 0x56335431); // JW FX DE Ctrl

// ──────────────────────────────────────────────────────────────
// IDs de parámetro fijos (documentados en processor-profiles.json)
// ──────────────────────────────────────────────────────────────

namespace EqParam {
static constexpr int32_t kBypass = 0;
static constexpr int32_t kOutput = 41;
// Banda i (0..7): base = 1 + i*5 → type, freq, gain, q, on
static constexpr int32_t kBandBase = 1;
static constexpr int32_t kBandStride = 5;
static constexpr int32_t kBandType = 0;   // offset dentro de la banda
static constexpr int32_t kBandFreq = 1;
static constexpr int32_t kBandGain = 2;
static constexpr int32_t kBandQ = 3;
static constexpr int32_t kBandOn = 4;
static constexpr int32_t kNumBands = 8;
static constexpr int32_t kTotalParams = 42;
} // namespace EqParam

namespace CompParam {
static constexpr int32_t kBypass = 0;
static constexpr int32_t kThreshold = 1;
static constexpr int32_t kRatio = 2;
static constexpr int32_t kAttack = 3;
static constexpr int32_t kRelease = 4;
static constexpr int32_t kKnee = 5;
static constexpr int32_t kMakeup = 6;
static constexpr int32_t kMix = 7;
static constexpr int32_t kSidechainHp = 8;
static constexpr int32_t kGrReadOnly = 40;
static constexpr int32_t kTotalParams = 41;
} // namespace CompParam

namespace LimParam {
static constexpr int32_t kBypass = 0;
static constexpr int32_t kCeiling = 1;
static constexpr int32_t kInputGain = 2;
static constexpr int32_t kRelease = 3;
static constexpr int32_t kLookahead = 4;
static constexpr int32_t kGrReadOnly = 40;
static constexpr int32_t kTotalParams = 41;
} // namespace LimParam

namespace UtilParam {
static constexpr int32_t kBypass = 0;
static constexpr int32_t kGain = 1;
static constexpr int32_t kWidth = 2;
static constexpr int32_t kMonoBelow = 3;
static constexpr int32_t kInvertL = 4;
static constexpr int32_t kInvertR = 5;
static constexpr int32_t kBalance = 6;
static constexpr int32_t kTotalParams = 7;
} // namespace UtilParam

namespace DeEsserParam {
static constexpr int32_t kBypass = 0;
static constexpr int32_t kFreq = 1;
static constexpr int32_t kThreshold = 2;
static constexpr int32_t kRange = 3;
static constexpr int32_t kMode = 4;
static constexpr int32_t kTotalParams = 5;
} // namespace DeEsserParam

// ──────────────────────────────────────────────────────────────
// Conversión normalizado (0..1) ↔ valor plano (documentado)
// ──────────────────────────────────────────────────────────────

inline float eqFreqPlain(float n) {           // 20 .. 20000 Hz (log)
  return 20.f * std::pow(20000.f / 20.f, n);
}
inline float eqFreqNormalized(float f) {
  return std::max(0.f, std::min(1.f, std::log(f / 20.f) / std::log(20000.f / 20.f)));
}

inline float compThresholdPlain(float n) { return -60.f + n * 60.f; }      // -60 .. 0 dB
inline float compThresholdNormalized(float v) { return std::max(0.f, std::min(1.f, (v + 60.f) / 60.f)); }
inline float compRatioPlain(float n) { return 1.f + n * 19.f; }            // 1 .. 20
inline float compRatioNormalized(float v) { return std::max(0.f, std::min(1.f, (v - 1.f) / 19.f)); }
inline float compAttackPlain(float n) { return 0.1f + n * 199.9f; }        // 0.1 .. 200 ms
inline float compAttackNormalized(float v) { return std::max(0.f, std::min(1.f, (v - 0.1f) / 199.9f)); }
inline float compReleasePlain(float n) { return 5.f + n * 1995.f; }        // 5 .. 2000 ms
inline float compReleaseNormalized(float v) { return std::max(0.f, std::min(1.f, (v - 5.f) / 1995.f)); }
inline float compKneePlain(float n) { return n * 24.f; }                   // 0 .. 24 dB
inline float compKneeNormalized(float v) { return std::max(0.f, std::min(1.f, v / 24.f)); }
inline float compMakeupPlain(float n) { return -24.f + n * 48.f; }         // ±24 dB
inline float compMakeupNormalized(float v) { return std::max(0.f, std::min(1.f, (v + 24.f) / 48.f)); }
inline float compMixPlain(float n) { return n * 100.f; }                   // 0 .. 100 %
inline float compMixNormalized(float v) { return std::max(0.f, std::min(1.f, v / 100.f)); }
inline float compSidechainHpPlain(float n) { return n == 0.f ? 0.f : 20.f + (n - 1.f / 65536.f) * 0.f; } // ver impl
inline float limCeilingPlain(float n) { return -12.f + n * 12.f; }         // -12 .. 0 dBTP
inline float limCeilingNormalized(float v) { return std::max(0.f, std::min(1.f, (v + 12.f) / 12.f)); }
inline float limInputGainPlain(float n) { return n * 24.f; }               // 0 .. +24 dB
inline float limInputGainNormalized(float v) { return std::max(0.f, std::min(1.f, v / 24.f)); }
inline float limReleasePlain(float n) { return 1.f + n * 999.f; }          // 1 .. 1000 ms
inline float limReleaseNormalized(float v) { return std::max(0.f, std::min(1.f, (v - 1.f) / 999.f)); }
inline float limLookaheadPlain(float n) { return n * 10.f; }               // 0 .. 10 ms
inline float limLookaheadNormalized(float v) { return std::max(0.f, std::min(1.f, v / 10.f)); }
inline float utilGainPlain(float n) { return -24.f + n * 48.f; }           // ±24 dB
inline float utilGainNormalized(float v) { return std::max(0.f, std::min(1.f, (v + 24.f) / 48.f)); }
inline float utilWidthPlain(float n) { return n * 2.f; }                   // 0 .. 200 %
inline float utilWidthNormalized(float v) { return std::max(0.f, std::min(1.f, v / 2.f)); }
inline float utilMonoBelowPlain(float n) { return n * 200.f; }             // 0..200 (0=off)
inline float utilMonoBelowNormalized(float v) { return std::max(0.f, std::min(1.f, v / 200.f)); }
inline float utilBalancePlain(float n) { return -1.f + n * 2.f; }          // -1 .. 1
inline float utilBalanceNormalized(float v) { return std::max(0.f, std::min(1.f, (v + 1.f) / 2.f)); }
inline float deEsserFreqPlain(float n) { return 3000.f + n * 9000.f; }     // 3 .. 12 kHz
inline float deEsserFreqNormalized(float v) { return std::max(0.f, std::min(1.f, (v - 3000.f) / 9000.f)); }
inline float deEsserThresholdPlain(float n) { return -60.f + n * 60.f; }   // -60 .. 0 dB
inline float deEsserThresholdNormalized(float v) { return std::max(0.f, std::min(1.f, (v + 60.f) / 60.f)); }
inline float deEsserRangePlain(float n) { return n * 24.f; }               // 0 .. 24 dB
inline float deEsserRangeNormalized(float v) { return std::max(0.f, std::min(1.f, v / 24.f)); }

inline bool paramOn(float n) { return n >= 0.5f; }
inline float paramOnNormalized(bool on) { return on ? 1.f : 0.f; }

// ──────────────────────────────────────────────────────────────
// Clase base para procesadores de FX (estéreo)
// ──────────────────────────────────────────────────────────────

class FxProcessor : public Steinberg::Vst::AudioEffect {
public:
  explicit FxProcessor(int32_t totalParams) : totalParams_(totalParams) {}
  ~FxProcessor() override = default;

  int32_t totalParams() const { return totalParams_; }
  float sampleRate() const { return sampleRate_; }
  void setSampleRate(float sr) { sampleRate_ = sr; }

protected:
  float sampleRate_{48000.f};
  int32_t totalParams_;
};

// ──────────────────────────────────────────────────────────────
// EQ (8 bandas)
// ──────────────────────────────────────────────────────────────

class EqProcessor : public FxProcessor {
public:
  EqProcessor();
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IAudioProcessor*>(new EqProcessor());
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
  void applyParameters(const Steinberg::Vst::IParameterChanges* changes);
  float bandFreqPlain(int32_t band) const;
  float bandGainPlain(int32_t band) const;
  float bandQPlain(int32_t band) const;
  int32_t bandTypePlain(int32_t band) const;
  bool bandOn(int32_t band) const;

  std::array<float, EqParam::kTotalParams> normalized_{}; // 0..1 por parámetro
  std::array<dsp::Biquad, EqParam::kNumBands> bands_{};
  dsp::OnePole outputFilter{}; // no-op placeholder, salida directa
  bool bypass_{false};
};

// ──────────────────────────────────────────────────────────────
// Compresor
// ──────────────────────────────────────────────────────────────

class CompProcessor : public FxProcessor {
public:
  CompProcessor();
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IAudioProcessor*>(new CompProcessor());
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
  void applyParameters(const Steinberg::Vst::IParameterChanges* changes);
  std::array<float, CompParam::kTotalParams> normalized_{};
  dsp::Compressor comp_;
  bool bypass_{false};
};

// ──────────────────────────────────────────────────────────────
// Limitador
// ──────────────────────────────────────────────────────────────

class LimiterProcessor : public FxProcessor {
public:
  LimiterProcessor();
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IAudioProcessor*>(new LimiterProcessor());
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
  void applyParameters(const Steinberg::Vst::IParameterChanges* changes);
  std::array<float, LimParam::kTotalParams> normalized_{};
  dsp::Limiter lim_;
  bool bypass_{false};
};

// ──────────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────────

class UtilityProcessor : public FxProcessor {
public:
  UtilityProcessor();
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IAudioProcessor*>(new UtilityProcessor());
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
  void applyParameters(const Steinberg::Vst::IParameterChanges* changes);
  std::array<float, UtilParam::kTotalParams> normalized_{};
  dsp::Utility util_;
  bool bypass_{false};
};

// ──────────────────────────────────────────────────────────────
// De-esser
// ──────────────────────────────────────────────────────────────

class DeEsserProcessor : public FxProcessor {
public:
  DeEsserProcessor();
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IAudioProcessor*>(new DeEsserProcessor());
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
  void applyParameters(const Steinberg::Vst::IParameterChanges* changes);
  std::array<float, DeEsserParam::kTotalParams> normalized_{};
  dsp::DeEsser de_;
  bool bypass_{false};
};

// ──────────────────────────────────────────────────────────────
// Controladores (uno por FX)
// ──────────────────────────────────────────────────────────────

class FxController : public Steinberg::Vst::EditController {
public:
  explicit FxController(int32_t totalParams) : totalParams_(totalParams) {}
  ~FxController() override = default;

  Steinberg::tresult PLUGIN_API setComponentState(Steinberg::IBStream* state) SMTG_OVERRIDE;
  Steinberg::IPlugView* PLUGIN_API createView(Steinberg::FIDString name) SMTG_OVERRIDE {
    return nullptr; // sin editor nativo; la UI del DAW edita parámetros
  }

protected:
  int32_t totalParams_;
  float readNormalized(Steinberg::IBStreamer& streamer, int32_t id, float def);
  void writeNormalized(Steinberg::IBStreamer& streamer, int32_t id, float v);
};

class EqController : public FxController {
public:
  EqController() : FxController(EqParam::kTotalParams) {}
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IEditController*>(new EqController());
  }
  Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
};

class CompController : public FxController {
public:
  CompController() : FxController(CompParam::kTotalParams) {}
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IEditController*>(new CompController());
  }
  Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
};

class LimiterController : public FxController {
public:
  LimiterController() : FxController(LimParam::kTotalParams) {}
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IEditController*>(new LimiterController());
  }
  Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
};

class UtilityController : public FxController {
public:
  UtilityController() : FxController(UtilParam::kTotalParams) {}
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IEditController*>(new UtilityController());
  }
  Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
};

class DeEsserController : public FxController {
public:
  DeEsserController() : FxController(DeEsserParam::kTotalParams) {}
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IEditController*>(new DeEsserController());
  }
  Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
};

} // namespace JasWaveFx
