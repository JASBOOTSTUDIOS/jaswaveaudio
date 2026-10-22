#include "processor.h"

#include "base/source/fstreamer.h"
#include "pluginterfaces/base/ibstream.h"

#include <cstring>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace JasWaveFx {

// ──────────────────────────────────────────────────────────────
// Helpers de conversión normalizado (0..1) ↔ valor plano
// ──────────────────────────────────────────────────────────────

namespace {

float readNormalizedParam(IBStreamer& streamer, int32_t id, float def) {
  double v = static_cast<double>(def);
  streamer.readDouble(v);
  return static_cast<float>(std::clamp(v, 0.0, 1.0));
}
void writeNormalizedParam(IBStreamer& streamer, int32_t id, float v) {
  streamer.writeDouble(static_cast<double>(std::clamp(v, 0.0f, 1.0f)));
}

} // namespace

// ################################################################
// EQ
// ################################################################

EqProcessor::EqProcessor() : FxProcessor(EqParam::kTotalParams) {
  setControllerClass(kEqControllerUid);
}

tresult PLUGIN_API EqProcessor::initialize(FUnknown* context) {
  const tresult r = AudioEffect::initialize(context);
  if (r != kResultOk) return r;
  addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
  addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
  return kResultOk;
}

tresult PLUGIN_API EqProcessor::setBusArrangements(SpeakerArrangement* inputs, int32 numIns,
                                                   SpeakerArrangement* outputs, int32 numOuts) {
  if (numIns == 1 && numOuts == 1 && inputs && outputs &&
      inputs[0] == SpeakerArr::kStereo && outputs[0] == SpeakerArr::kStereo) {
    return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
  }
  return kResultFalse;
}

tresult PLUGIN_API EqProcessor::canProcessSampleSize(int32 symbolicSampleSize) {
  return symbolicSampleSize == kSample32 ? kResultTrue : kResultFalse;
}

tresult PLUGIN_API EqProcessor::setActive(TBool state) {
  if (state) {
    sampleRate_ = processSetup.sampleRate > 0 ? static_cast<float>(processSetup.sampleRate) : 48000.f;
    for (auto& b : bands_) b.setSampleRate(sampleRate_);
    bypass_ = paramOn(normalized_[EqParam::kBypass]);
  }
  return AudioEffect::setActive(state);
}

tresult PLUGIN_API EqProcessor::setProcessing(TBool /*state*/) { return kResultOk; }

tresult PLUGIN_API EqProcessor::getControllerClassId(TUID classId) {
  kEqControllerUid.toTUID(classId);
  return kResultTrue;
}

void EqProcessor::applyParameters(const IParameterChanges* changes) {
  if (!changes) return;
  const int32 n = changes->getParameterCount();
  for (int32 i = 0; i < n; ++i) {
    auto* q = changes->getParameterData(i);
    if (!q) continue;
    int32 sampleOffset = 0;
    ParamValue value = 0;
    if (q->getPoint(q->getPointCount() - 1, sampleOffset, value) == kResultOk) {
      const ParamID id = q->getParameterId();
      if (id >= 0 && id < EqParam::kTotalParams) {
        normalized_[static_cast<size_t>(id)] = static_cast<float>(std::clamp(value, 0.0, 1.0));
      }
    }
  }
  bypass_ = paramOn(normalized_[EqParam::kBypass]);
  for (int32 b = 0; b < EqParam::kNumBands; ++b) {
    const int32_t base = EqParam::kBandBase + b * EqParam::kBandStride;
    auto& biquad = bands_[static_cast<size_t>(b)];
    biquad.setSampleRate(sampleRate_);
    const int32_t typeId = base + EqParam::kBandType;
    const int32_t freqId = base + EqParam::kBandFreq;
    const int32_t gainId = base + EqParam::kBandGain;
    const int32_t qId = base + EqParam::kBandQ;
    switch (bandTypePlain(b)) {
      case 0: biquad.setType(dsp::BiquadType::HighPass); break;
      case 1: biquad.setType(dsp::BiquadType::LowShelf); break;
      case 2: biquad.setType(dsp::BiquadType::Peak); break;
      case 3: biquad.setType(dsp::BiquadType::HighShelf); break;
      case 4: biquad.setType(dsp::BiquadType::LowPass); break;
      case 5: biquad.setType(dsp::BiquadType::Notch); break;
      default: biquad.setType(dsp::BiquadType::Peak); break;
    }
    biquad.setFreq(bandFreqPlain(b));
    biquad.setGainDb(bandGainPlain(b));
    biquad.setQ(bandQPlain(b));
  }
}

float EqProcessor::bandFreqPlain(int32_t band) const {
  const int32_t id = EqParam::kBandBase + band * EqParam::kBandStride + EqParam::kBandFreq;
  return eqFreqPlain(normalized_[static_cast<size_t>(id)]);
}
float EqProcessor::bandGainPlain(int32_t band) const {
  const int32_t id = EqParam::kBandBase + band * EqParam::kBandStride + EqParam::kBandGain;
  return -24.f + normalized_[static_cast<size_t>(id)] * 48.f;
}
float EqProcessor::bandQPlain(int32_t band) const {
  const int32_t id = EqParam::kBandBase + band * EqParam::kBandStride + EqParam::kBandQ;
  return 0.1f + normalized_[static_cast<size_t>(id)] * 17.9f;
}
int32_t EqProcessor::bandTypePlain(int32_t band) const {
  const int32_t id = EqParam::kBandBase + band * EqParam::kBandStride + EqParam::kBandType;
  const float n = normalized_[static_cast<size_t>(id)];
  return static_cast<int32_t>(std::clamp(std::floor(n * 6.f + 0.001f), 0.f, 5.f));
}
bool EqProcessor::bandOn(int32_t band) const {
  const int32_t id = EqParam::kBandBase + band * EqParam::kBandStride + EqParam::kBandOn;
  return paramOn(normalized_[static_cast<size_t>(id)]);
}

tresult PLUGIN_API EqProcessor::process(ProcessData& data) {
  if (data.processContext && data.processContext->sampleRate > 0) {
    sampleRate_ = static_cast<float>(data.processContext->sampleRate);
  }
  if (data.inputParameterChanges) applyParameters(data.inputParameterChanges);

  if (data.numOutputs < 1 || !data.outputs || data.outputs[0].numChannels < 1) return kResultOk;
  float* L = data.outputs[0].channelBuffers32[0];
  float* R = data.outputs[0].numChannels >= 2 ? data.outputs[0].channelBuffers32[1] : L;
  if (!L) return kResultOk;
  const int32 n = data.numSamples;

  const float outGain = dbToLinear(-24.f + normalized_[EqParam::kOutput] * 48.f);

  if (bypass_) {
    for (int32 i = 0; i < n; ++i) { L[i] *= outGain; if (R != L) R[i] *= outGain; }
    return kResultOk;
  }
  for (int32 i = 0; i < n; ++i) {
    float l = L[i], r = R[i];
    for (int32 b = 0; b < EqParam::kNumBands; ++b) {
      if (!bandOn(b)) continue;
      l = bands_[static_cast<size_t>(b)].process(l);
      r = bands_[static_cast<size_t>(b)].process(r);
    }
    L[i] = l * outGain;
    if (R != L) R[i] = r * outGain;
  }
  return kResultOk;
}

tresult PLUGIN_API EqProcessor::setState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < EqParam::kTotalParams; ++i) {
    normalized_[static_cast<size_t>(i)] = readNormalizedParam(streamer, i, 0.5f);
  }
  return kResultOk;
}

tresult PLUGIN_API EqProcessor::getState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < EqParam::kTotalParams; ++i) {
    writeNormalizedParam(streamer, i, normalized_[static_cast<size_t>(i)]);
  }
  return kResultOk;
}

// ################################################################
// Compresor
// ################################################################

CompProcessor::CompProcessor() : FxProcessor(CompParam::kTotalParams) {
  setControllerClass(kCompControllerUid);
}

tresult PLUGIN_API CompProcessor::initialize(FUnknown* context) {
  const tresult r = AudioEffect::initialize(context);
  if (r != kResultOk) return r;
  addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
  addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
  return kResultOk;
}

tresult PLUGIN_API CompProcessor::setBusArrangements(SpeakerArrangement* inputs, int32 numIns,
                                                     SpeakerArrangement* outputs, int32 numOuts) {
  if (numIns == 1 && numOuts == 1 && inputs && outputs &&
      inputs[0] == SpeakerArr::kStereo && outputs[0] == SpeakerArr::kStereo) {
    return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
  }
  return kResultFalse;
}

tresult PLUGIN_API CompProcessor::canProcessSampleSize(int32 symbolicSampleSize) {
  return symbolicSampleSize == kSample32 ? kResultTrue : kResultFalse;
}

tresult PLUGIN_API CompProcessor::setActive(TBool state) {
  if (state) {
    sampleRate_ = processSetup.sampleRate > 0 ? static_cast<float>(processSetup.sampleRate) : 48000.f;
    comp_.setSampleRate(sampleRate_);
    bypass_ = paramOn(normalized_[CompParam::kBypass]);
  }
  return AudioEffect::setActive(state);
}

tresult PLUGIN_API CompProcessor::setProcessing(TBool /*state*/) { return kResultOk; }

tresult PLUGIN_API CompProcessor::getControllerClassId(TUID classId) {
  kCompControllerUid.toTUID(classId);
  return kResultTrue;
}

void CompProcessor::applyParameters(const IParameterChanges* changes) {
  if (!changes) return;
  const int32 n = changes->getParameterCount();
  for (int32 i = 0; i < n; ++i) {
    auto* q = changes->getParameterData(i);
    if (!q) continue;
    int32 sampleOffset = 0;
    ParamValue value = 0;
    if (q->getPoint(q->getPointCount() - 1, sampleOffset, value) == kResultOk) {
      const ParamID id = q->getParameterId();
      if (id >= 0 && id < CompParam::kTotalParams)
        normalized_[static_cast<size_t>(id)] = static_cast<float>(std::clamp(value, 0.0, 1.0));
    }
  }
  bypass_ = paramOn(normalized_[CompParam::kBypass]);
  comp_.thresholdDb = compThresholdPlain(normalized_[CompParam::kThreshold]);
  comp_.ratio = compRatioPlain(normalized_[CompParam::kRatio]);
  comp_.attackMs = compAttackPlain(normalized_[CompParam::kAttack]);
  comp_.releaseMs = compReleasePlain(normalized_[CompParam::kRelease]);
  comp_.kneeDb = compKneePlain(normalized_[CompParam::kKnee]);
  comp_.makeupDb = compMakeupPlain(normalized_[CompParam::kMakeup]);
  comp_.mix = compMixPlain(normalized_[CompParam::kMix]) * 0.01f;
}

tresult PLUGIN_API CompProcessor::process(ProcessData& data) {
  if (data.processContext && data.processContext->sampleRate > 0) {
    sampleRate_ = static_cast<float>(data.processContext->sampleRate);
    comp_.setSampleRate(sampleRate_);
  }
  if (data.inputParameterChanges) applyParameters(data.inputParameterChanges);

  if (data.numOutputs < 1 || !data.outputs || data.outputs[0].numChannels < 1) return kResultOk;
  float* L = data.outputs[0].channelBuffers32[0];
  float* R = data.outputs[0].numChannels >= 2 ? data.outputs[0].channelBuffers32[1] : L;
  if (!L) return kResultOk;
  const int32 n = data.numSamples;

  if (bypass_) return kResultOk;
  for (int32 i = 0; i < n; ++i) {
    comp_.process(L[i], R != L ? R[i] : L[i]);
    if (R != L) R[i] = R[i]; // comp_.process escribe in-place
  }
  return kResultOk;
}

tresult PLUGIN_API CompProcessor::setState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < CompParam::kTotalParams; ++i)
    normalized_[static_cast<size_t>(i)] = readNormalizedParam(streamer, i, 0.5f);
  return kResultOk;
}

tresult PLUGIN_API CompProcessor::getState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < CompParam::kTotalParams; ++i)
    writeNormalizedParam(streamer, i, normalized_[static_cast<size_t>(i)]);
  return kResultOk;
}

// ################################################################
// Limitador
// ################################################################

LimiterProcessor::LimiterProcessor() : FxProcessor(LimParam::kTotalParams) {
  setControllerClass(kLimControllerUid);
}

tresult PLUGIN_API LimiterProcessor::initialize(FUnknown* context) {
  const tresult r = AudioEffect::initialize(context);
  if (r != kResultOk) return r;
  addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
  addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
  return kResultOk;
}

tresult PLUGIN_API LimiterProcessor::setBusArrangements(SpeakerArrangement* inputs, int32 numIns,
                                                        SpeakerArrangement* outputs, int32 numOuts) {
  if (numIns == 1 && numOuts == 1 && inputs && outputs &&
      inputs[0] == SpeakerArr::kStereo && outputs[0] == SpeakerArr::kStereo) {
    return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
  }
  return kResultFalse;
}

tresult PLUGIN_API LimiterProcessor::canProcessSampleSize(int32 symbolicSampleSize) {
  return symbolicSampleSize == kSample32 ? kResultTrue : kResultFalse;
}

tresult PLUGIN_API LimiterProcessor::setActive(TBool state) {
  if (state) {
    sampleRate_ = processSetup.sampleRate > 0 ? static_cast<float>(processSetup.sampleRate) : 48000.f;
    lim_.setSampleRate(sampleRate_);
    bypass_ = paramOn(normalized_[LimParam::kBypass]);
  }
  return AudioEffect::setActive(state);
}

tresult PLUGIN_API LimiterProcessor::setProcessing(TBool /*state*/) { return kResultOk; }

tresult PLUGIN_API LimiterProcessor::getControllerClassId(TUID classId) {
  kLimControllerUid.toTUID(classId);
  return kResultTrue;
}

void LimiterProcessor::applyParameters(const IParameterChanges* changes) {
  if (!changes) return;
  const int32 n = changes->getParameterCount();
  for (int32 i = 0; i < n; ++i) {
    auto* q = changes->getParameterData(i);
    if (!q) continue;
    int32 sampleOffset = 0;
    ParamValue value = 0;
    if (q->getPoint(q->getPointCount() - 1, sampleOffset, value) == kResultOk) {
      const ParamID id = q->getParameterId();
      if (id >= 0 && id < LimParam::kTotalParams)
        normalized_[static_cast<size_t>(id)] = static_cast<float>(std::clamp(value, 0.0, 1.0));
    }
  }
  bypass_ = paramOn(normalized_[LimParam::kBypass]);
  lim_.setCeilingDb(limCeilingPlain(normalized_[LimParam::kCeiling]));
  lim_.setInputGainDb(limInputGainPlain(normalized_[LimParam::kInputGain]));
  lim_.setReleaseMs(limReleasePlain(normalized_[LimParam::kRelease]));
  lim_.setLookaheadMs(limLookaheadPlain(normalized_[LimParam::kLookahead]));
}

tresult PLUGIN_API LimiterProcessor::process(ProcessData& data) {
  if (data.processContext && data.processContext->sampleRate > 0) {
    sampleRate_ = static_cast<float>(data.processContext->sampleRate);
    lim_.setSampleRate(sampleRate_);
  }
  if (data.inputParameterChanges) applyParameters(data.inputParameterChanges);

  if (data.numOutputs < 1 || !data.outputs || data.outputs[0].numChannels < 1) return kResultOk;
  float* L = data.outputs[0].channelBuffers32[0];
  float* R = data.outputs[0].numChannels >= 2 ? data.outputs[0].channelBuffers32[1] : L;
  if (!L) return kResultOk;
  const int32 n = data.numSamples;

  if (bypass_) return kResultOk;
  for (int32 i = 0; i < n; ++i) lim_.process(L[i], R != L ? R[i] : L[i]);
  return kResultOk;
}

tresult PLUGIN_API LimiterProcessor::setState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < LimParam::kTotalParams; ++i)
    normalized_[static_cast<size_t>(i)] = readNormalizedParam(streamer, i, 0.5f);
  return kResultOk;
}

tresult PLUGIN_API LimiterProcessor::getState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < LimParam::kTotalParams; ++i)
    writeNormalizedParam(streamer, i, normalized_[static_cast<size_t>(i)]);
  return kResultOk;
}

// ################################################################
// Utility
// ################################################################

UtilityProcessor::UtilityProcessor() : FxProcessor(UtilParam::kTotalParams) {
  setControllerClass(kUtilControllerUid);
}

tresult PLUGIN_API UtilityProcessor::initialize(FUnknown* context) {
  const tresult r = AudioEffect::initialize(context);
  if (r != kResultOk) return r;
  addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
  addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
  return kResultOk;
}

tresult PLUGIN_API UtilityProcessor::setBusArrangements(SpeakerArrangement* inputs, int32 numIns,
                                                        SpeakerArrangement* outputs, int32 numOuts) {
  if (numIns == 1 && numOuts == 1 && inputs && outputs &&
      inputs[0] == SpeakerArr::kStereo && outputs[0] == SpeakerArr::kStereo) {
    return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
  }
  return kResultFalse;
}

tresult PLUGIN_API UtilityProcessor::canProcessSampleSize(int32 symbolicSampleSize) {
  return symbolicSampleSize == kSample32 ? kResultTrue : kResultFalse;
}

tresult PLUGIN_API UtilityProcessor::setActive(TBool state) {
  if (state) {
    sampleRate_ = processSetup.sampleRate > 0 ? static_cast<float>(processSetup.sampleRate) : 48000.f;
    util_.setSampleRate(sampleRate_);
    bypass_ = paramOn(normalized_[UtilParam::kBypass]);
  }
  return AudioEffect::setActive(state);
}

tresult PLUGIN_API UtilityProcessor::setProcessing(TBool /*state*/) { return kResultOk; }

tresult PLUGIN_API UtilityProcessor::getControllerClassId(TUID classId) {
  kUtilControllerUid.toTUID(classId);
  return kResultTrue;
}

void UtilityProcessor::applyParameters(const IParameterChanges* changes) {
  if (!changes) return;
  const int32 n = changes->getParameterCount();
  for (int32 i = 0; i < n; ++i) {
    auto* q = changes->getParameterData(i);
    if (!q) continue;
    int32 sampleOffset = 0;
    ParamValue value = 0;
    if (q->getPoint(q->getPointCount() - 1, sampleOffset, value) == kResultOk) {
      const ParamID id = q->getParameterId();
      if (id >= 0 && id < UtilParam::kTotalParams)
        normalized_[static_cast<size_t>(id)] = static_cast<float>(std::clamp(value, 0.0, 1.0));
    }
  }
  bypass_ = paramOn(normalized_[UtilParam::kBypass]);
  util_.gainDb = utilGainPlain(normalized_[UtilParam::kGain]);
  util_.width = utilWidthPlain(normalized_[UtilParam::kWidth]);
  util_.setMonoBelowHz(utilMonoBelowPlain(normalized_[UtilParam::kMonoBelow]));
  util_.invertL = paramOn(normalized_[UtilParam::kInvertL]);
  util_.invertR = paramOn(normalized_[UtilParam::kInvertR]);
  util_.balance = utilBalancePlain(normalized_[UtilParam::kBalance]);
}

tresult PLUGIN_API UtilityProcessor::process(ProcessData& data) {
  if (data.processContext && data.processContext->sampleRate > 0) {
    sampleRate_ = static_cast<float>(data.processContext->sampleRate);
    util_.setSampleRate(sampleRate_);
  }
  if (data.inputParameterChanges) applyParameters(data.inputParameterChanges);

  if (data.numOutputs < 1 || !data.outputs || data.outputs[0].numChannels < 1) return kResultOk;
  float* L = data.outputs[0].channelBuffers32[0];
  float* R = data.outputs[0].numChannels >= 2 ? data.outputs[0].channelBuffers32[1] : L;
  if (!L) return kResultOk;
  const int32 n = data.numSamples;

  if (bypass_) return kResultOk;
  for (int32 i = 0; i < n; ++i) util_.process(L[i], R != L ? R[i] : L[i]);
  return kResultOk;
}

tresult PLUGIN_API UtilityProcessor::setState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < UtilParam::kTotalParams; ++i)
    normalized_[static_cast<size_t>(i)] = readNormalizedParam(streamer, i, 0.5f);
  return kResultOk;
}

tresult PLUGIN_API UtilityProcessor::getState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < UtilParam::kTotalParams; ++i)
    writeNormalizedParam(streamer, i, normalized_[static_cast<size_t>(i)]);
  return kResultOk;
}

// ################################################################
// De-esser
// ################################################################

DeEsserProcessor::DeEsserProcessor() : FxProcessor(DeEsserParam::kTotalParams) {
  setControllerClass(kDeEsserControllerUid);
}

tresult PLUGIN_API DeEsserProcessor::initialize(FUnknown* context) {
  const tresult r = AudioEffect::initialize(context);
  if (r != kResultOk) return r;
  addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
  addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
  return kResultOk;
}

tresult PLUGIN_API DeEsserProcessor::setBusArrangements(SpeakerArrangement* inputs, int32 numIns,
                                                        SpeakerArrangement* outputs, int32 numOuts) {
  if (numIns == 1 && numOuts == 1 && inputs && outputs &&
      inputs[0] == SpeakerArr::kStereo && outputs[0] == SpeakerArr::kStereo) {
    return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
  }
  return kResultFalse;
}

tresult PLUGIN_API DeEsserProcessor::canProcessSampleSize(int32 symbolicSampleSize) {
  return symbolicSampleSize == kSample32 ? kResultTrue : kResultFalse;
}

tresult PLUGIN_API DeEsserProcessor::setActive(TBool state) {
  if (state) {
    sampleRate_ = processSetup.sampleRate > 0 ? static_cast<float>(processSetup.sampleRate) : 48000.f;
    de_.setSampleRate(sampleRate_);
    bypass_ = paramOn(normalized_[DeEsserParam::kBypass]);
  }
  return AudioEffect::setActive(state);
}

tresult PLUGIN_API DeEsserProcessor::setProcessing(TBool /*state*/) { return kResultOk; }

tresult PLUGIN_API DeEsserProcessor::getControllerClassId(TUID classId) {
  kDeEsserControllerUid.toTUID(classId);
  return kResultTrue;
}

void DeEsserProcessor::applyParameters(const IParameterChanges* changes) {
  if (!changes) return;
  const int32 n = changes->getParameterCount();
  for (int32 i = 0; i < n; ++i) {
    auto* q = changes->getParameterData(i);
    if (!q) continue;
    int32 sampleOffset = 0;
    ParamValue value = 0;
    if (q->getPoint(q->getPointCount() - 1, sampleOffset, value) == kResultOk) {
      const ParamID id = q->getParameterId();
      if (id >= 0 && id < DeEsserParam::kTotalParams)
        normalized_[static_cast<size_t>(id)] = static_cast<float>(std::clamp(value, 0.0, 1.0));
    }
  }
  bypass_ = paramOn(normalized_[DeEsserParam::kBypass]);
  de_.setFreqHz(deEsserFreqPlain(normalized_[DeEsserParam::kFreq]));
  de_.thresholdDb = deEsserThresholdPlain(normalized_[DeEsserParam::kThreshold]);
  de_.rangeDb = deEsserRangePlain(normalized_[DeEsserParam::kRange]);
  de_.wideMode = normalized_[DeEsserParam::kMode] >= 0.5f;
}

tresult PLUGIN_API DeEsserProcessor::process(ProcessData& data) {
  if (data.processContext && data.processContext->sampleRate > 0) {
    sampleRate_ = static_cast<float>(data.processContext->sampleRate);
    de_.setSampleRate(sampleRate_);
  }
  if (data.inputParameterChanges) applyParameters(data.inputParameterChanges);

  if (data.numOutputs < 1 || !data.outputs || data.outputs[0].numChannels < 1) return kResultOk;
  float* L = data.outputs[0].channelBuffers32[0];
  float* R = data.outputs[0].numChannels >= 2 ? data.outputs[0].channelBuffers32[1] : L;
  if (!L) return kResultOk;
  const int32 n = data.numSamples;

  if (bypass_) return kResultOk;
  for (int32 i = 0; i < n; ++i) de_.process(L[i], R != L ? R[i] : L[i]);
  return kResultOk;
}

tresult PLUGIN_API DeEsserProcessor::setState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < DeEsserParam::kTotalParams; ++i)
    normalized_[static_cast<size_t>(i)] = readNormalizedParam(streamer, i, 0.5f);
  return kResultOk;
}

tresult PLUGIN_API DeEsserProcessor::getState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < DeEsserParam::kTotalParams; ++i)
    writeNormalizedParam(streamer, i, normalized_[static_cast<size_t>(i)]);
  return kResultOk;
}

// ################################################################
// Controladores
// ################################################################

tresult PLUGIN_API FxController::setComponentState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  for (int32 i = 0; i < totalParams_; ++i) {
    double v = 0.5;
    streamer.readDouble(v);
    setParamNormalized(i, static_cast<ParamValue>(std::clamp(v, 0.0, 1.0)));
  }
  return kResultOk;
}

float FxController::readNormalized(IBStreamer& streamer, int32_t id, float def) {
  double v = static_cast<double>(def);
  streamer.readDouble(v);
  return static_cast<float>(std::clamp(v, 0.0, 1.0));
}
void FxController::writeNormalized(IBStreamer& streamer, int32_t id, float v) {
  streamer.writeDouble(static_cast<double>(std::clamp(v, 0.0f, 1.0f)));
}

// ── EQ Controller ──
tresult PLUGIN_API EqController::initialize(FUnknown* context) {
  const tresult r = EditController::initialize(context);
  if (r != kResultOk) return r;
  parameters.addParameter(STR16("Bypass"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, EqParam::kBypass);
  for (int32 b = 0; b < EqParam::kNumBands; ++b) {
    const int32 base = EqParam::kBandBase + b * EqParam::kBandStride;
    parameters.addParameter(STR16("Type"), STR16(""), 5, 0.5, ParameterInfo::kCanAutomate, base + EqParam::kBandType);
    parameters.addParameter(STR16("Freq"), STR16("Hz"), 0, eqFreqNormalized(1000.f), ParameterInfo::kCanAutomate, base + EqParam::kBandFreq);
    parameters.addParameter(STR16("Gain"), STR16("dB"), 0, 0.5, ParameterInfo::kCanAutomate, base + EqParam::kBandGain);
    parameters.addParameter(STR16("Q"), STR16(""), 0, 0.5, ParameterInfo::kCanAutomate, base + EqParam::kBandQ);
    parameters.addParameter(STR16("On"), STR16(""), 1, 1.0, ParameterInfo::kCanAutomate, base + EqParam::kBandOn);
  }
  parameters.addParameter(STR16("Output"), STR16("dB"), 0, 0.5, ParameterInfo::kCanAutomate, EqParam::kOutput);
  return kResultOk;
}

// ── Comp Controller ──
tresult PLUGIN_API CompController::initialize(FUnknown* context) {
  const tresult r = EditController::initialize(context);
  if (r != kResultOk) return r;
  parameters.addParameter(STR16("Bypass"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, CompParam::kBypass);
  parameters.addParameter(STR16("Threshold"), STR16("dB"), 0, compThresholdNormalized(-20.f), ParameterInfo::kCanAutomate, CompParam::kThreshold);
  parameters.addParameter(STR16("Ratio"), STR16(":1"), 0, compRatioNormalized(4.f), ParameterInfo::kCanAutomate, CompParam::kRatio);
  parameters.addParameter(STR16("Attack"), STR16("ms"), 0, compAttackNormalized(10.f), ParameterInfo::kCanAutomate, CompParam::kAttack);
  parameters.addParameter(STR16("Release"), STR16("ms"), 0, compReleaseNormalized(100.f), ParameterInfo::kCanAutomate, CompParam::kRelease);
  parameters.addParameter(STR16("Knee"), STR16("dB"), 0, compKneeNormalized(0.f), ParameterInfo::kCanAutomate, CompParam::kKnee);
  parameters.addParameter(STR16("Makeup"), STR16("dB"), 0, compMakeupNormalized(0.f), ParameterInfo::kCanAutomate, CompParam::kMakeup);
  parameters.addParameter(STR16("Mix"), STR16("%"), 0, compMixNormalized(100.f), ParameterInfo::kCanAutomate, CompParam::kMix);
  parameters.addParameter(STR16("Sidechain HP"), STR16("Hz"), 0, 0.0, ParameterInfo::kCanAutomate, CompParam::kSidechainHp);
  parameters.addParameter(STR16("GR"), STR16("dB"), 0, 0.0, ParameterInfo::kCanAutomate, CompParam::kGrReadOnly);
  return kResultOk;
}

// ── Limiter Controller ──
tresult PLUGIN_API LimiterController::initialize(FUnknown* context) {
  const tresult r = EditController::initialize(context);
  if (r != kResultOk) return r;
  parameters.addParameter(STR16("Bypass"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, LimParam::kBypass);
  parameters.addParameter(STR16("Ceiling"), STR16("dBTP"), 0, limCeilingNormalized(-1.f), ParameterInfo::kCanAutomate, LimParam::kCeiling);
  parameters.addParameter(STR16("Input Gain"), STR16("dB"), 0, limInputGainNormalized(0.f), ParameterInfo::kCanAutomate, LimParam::kInputGain);
  parameters.addParameter(STR16("Release"), STR16("ms"), 0, limReleaseNormalized(100.f), ParameterInfo::kCanAutomate, LimParam::kRelease);
  parameters.addParameter(STR16("Lookahead"), STR16("ms"), 0, limLookaheadNormalized(0.f), ParameterInfo::kCanAutomate, LimParam::kLookahead);
  parameters.addParameter(STR16("GR"), STR16("dB"), 0, 0.0, ParameterInfo::kCanAutomate, LimParam::kGrReadOnly);
  return kResultOk;
}

// ── Utility Controller ──
tresult PLUGIN_API UtilityController::initialize(FUnknown* context) {
  const tresult r = EditController::initialize(context);
  if (r != kResultOk) return r;
  parameters.addParameter(STR16("Bypass"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, UtilParam::kBypass);
  parameters.addParameter(STR16("Gain"), STR16("dB"), 0, utilGainNormalized(0.f), ParameterInfo::kCanAutomate, UtilParam::kGain);
  parameters.addParameter(STR16("Width"), STR16("%"), 0, utilWidthNormalized(1.f), ParameterInfo::kCanAutomate, UtilParam::kWidth);
  parameters.addParameter(STR16("Mono Below"), STR16("Hz"), 0, utilMonoBelowNormalized(0.f), ParameterInfo::kCanAutomate, UtilParam::kMonoBelow);
  parameters.addParameter(STR16("Invert L"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, UtilParam::kInvertL);
  parameters.addParameter(STR16("Invert R"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, UtilParam::kInvertR);
  parameters.addParameter(STR16("Balance"), STR16(""), 0, utilBalanceNormalized(0.f), ParameterInfo::kCanAutomate, UtilParam::kBalance);
  return kResultOk;
}

// ── De-esser Controller ──
tresult PLUGIN_API DeEsserController::initialize(FUnknown* context) {
  const tresult r = EditController::initialize(context);
  if (r != kResultOk) return r;
  parameters.addParameter(STR16("Bypass"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, DeEsserParam::kBypass);
  parameters.addParameter(STR16("Freq"), STR16("Hz"), 0, deEsserFreqNormalized(6000.f), ParameterInfo::kCanAutomate, DeEsserParam::kFreq);
  parameters.addParameter(STR16("Threshold"), STR16("dB"), 0, deEsserThresholdNormalized(-20.f), ParameterInfo::kCanAutomate, DeEsserParam::kThreshold);
  parameters.addParameter(STR16("Range"), STR16("dB"), 0, deEsserRangeNormalized(12.f), ParameterInfo::kCanAutomate, DeEsserParam::kRange);
  parameters.addParameter(STR16("Mode"), STR16(""), 1, 0.0, ParameterInfo::kCanAutomate, DeEsserParam::kMode);
  return kResultOk;
}

} // namespace JasWaveFx
