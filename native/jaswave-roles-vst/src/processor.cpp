#include "processor.h"

#include "base/source/fstreamer.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"

#include <algorithm>
#include <cstring>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace JasWaveRoles {
namespace {

float midiToHz(int pitch) {
  return 440.f * std::pow(2.f, (static_cast<float>(pitch) - 69.f) / 12.f);
}

float clampEnv(float x) { return std::max(0.0001f, x); }

} // namespace

Processor::Processor() {
  setControllerClass(kControllerUid);
}

tresult PLUGIN_API Processor::initialize(FUnknown* context) {
  const tresult r = AudioEffect::initialize(context);
  if (r != kResultOk) return r;
  addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
  addEventInput(STR16("MIDI In"), 16);
  return kResultOk;
}

tresult PLUGIN_API Processor::setBusArrangements(SpeakerArrangement* inputs, int32 numIns,
                                                 SpeakerArrangement* outputs, int32 numOuts) {
  if (numIns == 0 && numOuts == 1 && outputs && outputs[0] == SpeakerArr::kStereo) {
    return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
  }
  return kResultFalse;
}

tresult PLUGIN_API Processor::canProcessSampleSize(int32 symbolicSampleSize) {
  if (symbolicSampleSize == kSample32) return kResultTrue;
  return kResultFalse;
}

tresult PLUGIN_API Processor::setActive(TBool state) {
  if (state) {
    sampleRate_ = processSetup.sampleRate > 0 ? processSetup.sampleRate : 48000.0;
    for (auto& v : voices_) v = Voice{};
  }
  return AudioEffect::setActive(state);
}

tresult PLUGIN_API Processor::setProcessing(TBool /*state*/) {
  // AudioEffect base returns kNotImplemented; host exige kResultOk.
  return kResultOk;
}

tresult PLUGIN_API Processor::getControllerClassId(TUID classId) {
  kControllerUid.toTUID(classId);
  return kResultTrue;
}

tresult PLUGIN_API Processor::setState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  int32 role = 0;
  if (!streamer.readInt32(role)) return kResultFalse;
  activeRole_.store(std::clamp(role, 0, kNumRoles - 1));
  double attack = 0.35, release = 0.4, cutoff = 0.55, reso = 0.25, gain = 0.7, voices = 0.5;
  streamer.readDouble(attack);
  streamer.readDouble(release);
  streamer.readDouble(cutoff);
  streamer.readDouble(reso);
  streamer.readDouble(gain);
  streamer.readDouble(voices);
  attackN_.store(static_cast<float>(std::clamp(attack, 0.0, 1.0)));
  releaseN_.store(static_cast<float>(std::clamp(release, 0.0, 1.0)));
  cutoffN_.store(static_cast<float>(std::clamp(cutoff, 0.0, 1.0)));
  resonanceN_.store(static_cast<float>(std::clamp(reso, 0.0, 1.0)));
  gainN_.store(static_cast<float>(std::clamp(gain, 0.0, 1.0)));
  voicesN_.store(static_cast<float>(std::clamp(voices, 0.0, 1.0)));
  return kResultOk;
}

tresult PLUGIN_API Processor::getState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  streamer.writeInt32(activeRole_.load());
  streamer.writeDouble(attackN_.load());
  streamer.writeDouble(releaseN_.load());
  streamer.writeDouble(cutoffN_.load());
  streamer.writeDouble(resonanceN_.load());
  streamer.writeDouble(gainN_.load());
  streamer.writeDouble(voicesN_.load());
  return kResultOk;
}

void Processor::applyRole(double normalized) {
  activeRole_.store(static_cast<int32_t>(roleFromNormalized(normalized)));
}

int32_t Processor::allocVoice(Role role) {
  const float voicesBias = voicesN_.load();
  const int32_t baseCap = voiceCapForRole(role);
  const int32_t cap = std::clamp(static_cast<int32_t>(std::lround(baseCap * (0.35f + voicesBias * 1.3f))),
                                 1, kMaxVoices);
  int32_t used = 0;
  int32_t oldestIdx = -1;
  uint64_t oldestAge = UINT64_MAX;
  int32_t freeIdx = -1;

  for (int32_t i = 0; i < kMaxVoices; ++i) {
    auto& v = voices_[static_cast<size_t>(i)];
    if (!v.active) {
      if (freeIdx < 0) freeIdx = i;
      continue;
    }
    if (v.role == role) {
      ++used;
      if (v.age < oldestAge) {
        oldestAge = v.age;
        oldestIdx = i;
      }
    }
  }

  if (used >= cap && oldestIdx >= 0) {
    voices_[static_cast<size_t>(oldestIdx)].active = false;
    return oldestIdx;
  }
  if (freeIdx >= 0) return freeIdx;

  // Global steal
  oldestIdx = 0;
  oldestAge = voices_[0].age;
  for (int32_t i = 1; i < kMaxVoices; ++i) {
    if (voices_[static_cast<size_t>(i)].age < oldestAge) {
      oldestAge = voices_[static_cast<size_t>(i)].age;
      oldestIdx = i;
    }
  }
  voices_[static_cast<size_t>(oldestIdx)].active = false;
  return oldestIdx;
}

void Processor::setupVoice(Voice& v, int16_t pitch, float velocity, Role role) {
  v = Voice{};
  v.active = true;
  v.releasing = false;
  v.pitch = pitch;
  v.velocity = std::clamp(velocity, 0.05f, 1.f);
  v.role = role;
  v.age = ++ageCounter_;
  v.env = 0.0001f;
  v.filterZ1 = 0.f;
  v.filterZ2 = 0.f;
  v.oneShot = false;
  v.samplesLeft = 0;

  const float freq = midiToHz(pitch);
  const float vel = v.velocity;
  const float sr = static_cast<float>(sampleRate_);
  const float durGuess = 0.4f;
  const float atkMul = 0.15f + attackN_.load() * 2.5f;   // ~0.15x … 2.65x
  const float relMul = 0.2f + releaseN_.load() * 2.8f;
  const float cutMul = 0.35f + cutoffN_.load() * 2.2f;
  const float qMul = 0.4f + resonanceN_.load() * 2.5f;

  auto setPartial = [&](int i, OscType t, float f, float g, float det = 0.f) {
    v.partials[static_cast<size_t>(i)].type = t;
    v.partials[static_cast<size_t>(i)].freqHz = std::max(20.f, f);
    v.partials[static_cast<size_t>(i)].gain = g;
    v.partials[static_cast<size_t>(i)].detuneCents = det;
    v.partials[static_cast<size_t>(i)].phase = 0.f;
    v.partials[static_cast<size_t>(i)].active = g > 0.f;
  };

  auto scaleEnv = [&](float& attackInc, float& releaseInc, float cutoff) {
    if (attackInc > 0.f) attackInc /= atkMul;
    if (releaseInc > 0.f) releaseInc /= relMul;
    v.filterCutoff = std::clamp(cutoff * cutMul, 40.f, sr * 0.45f);
    v.filterQ = std::clamp(v.filterQ * qMul, 0.2f, 8.f);
  };

  switch (role) {
    case Role::Drums:
    case Role::Percussion: {
      v.oneShot = true;
      v.filterCutoff = 4000.f;
      v.filterQ = 0.7f;
      if (pitch <= 40) {
        setPartial(0, OscType::Sine, 55.f + (pitch - 36) * 2.f, 0.55f * vel);
        setPartial(1, OscType::Triangle, 80.f, 0.25f * vel);
        v.envTarget = 0.55f * vel;
        v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.01f * sr);
        v.releaseInc = v.envTarget / std::max(1.f, 0.35f * sr);
        v.samplesLeft = static_cast<int>(0.45f * sr);
      } else if (pitch <= 50) {
        setPartial(0, OscType::Noise, 1800.f, 0.45f * vel);
        setPartial(1, OscType::Triangle, 180.f, 0.2f * vel);
        v.envTarget = 0.5f * vel;
        v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.005f * sr);
        v.releaseInc = v.envTarget / std::max(1.f, 0.18f * sr);
        v.samplesLeft = static_cast<int>(0.22f * sr);
        v.filterCutoff = 1800.f;
      } else {
        setPartial(0, OscType::Noise, 7000.f + (pitch - 42) * 40.f, 0.22f * vel);
        v.envTarget = 0.28f * vel;
        v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.002f * sr);
        v.releaseInc = v.envTarget / std::max(1.f, 0.06f * sr);
        v.samplesLeft = static_cast<int>(0.08f * sr);
        v.filterCutoff = 7000.f;
      }
      break;
    }
    case Role::Bass: {
      v.filterCutoff = 280.f + vel * 420.f;
      v.filterQ = 0.9f;
      setPartial(0, OscType::Saw, freq, 0.38f * vel);
      v.envTarget = 0.4f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.02f * sr);
      v.releaseInc = 0.3f * vel / std::max(1.f, 0.12f * sr);
      break;
    }
    case Role::Guitar: {
      v.filterCutoff = 1200.f + vel * 1800.f;
      v.filterQ = 0.6f;
      setPartial(0, OscType::Saw, freq, 0.22f * vel, -6.f);
      v.envTarget = 0.26f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.03f * sr);
      v.releaseInc = 0.14f * vel / std::max(1.f, 0.15f * sr);
      break;
    }
    case Role::Piano:
    case Role::Keys: {
      // Piano struck: ataque corto + decaimiento (one-shot), no pad sostenido.
      v.oneShot = true;
      v.filterCutoff = 2200.f + vel * 2800.f;
      v.filterQ = 0.55f;
      setPartial(0, OscType::Triangle, freq, 0.34f * vel);
      setPartial(1, OscType::Sine, freq * 2.01f, 0.14f * vel);
      setPartial(2, OscType::Noise, 6000.f, 0.05f * vel);
      v.envTarget = 0.45f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.003f * sr);
      const float decaySec = 0.7f + (1.f - vel) * 0.9f;
      v.releaseInc = v.envTarget / std::max(1.f, decaySec * sr);
      v.samplesLeft = static_cast<int>(decaySec * sr);
      break;
    }
    case Role::Pad:
    case Role::Strings:
    case Role::Choir: {
      v.filterCutoff = (role == Role::Choir) ? 1400.f : 900.f + vel * 800.f;
      v.filterQ = 0.4f;
      setPartial(0, OscType::Triangle, freq, 0.18f * vel);
      setPartial(1, OscType::Triangle, freq * 1.005f, 0.08f * vel, 4.f);
      v.envTarget = 0.2f * vel;
      const float atk = std::min(0.35f, std::max(0.08f, durGuess * 0.15f));
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, atk * sr);
      v.releaseInc = 0.14f * vel / std::max(1.f, 0.35f * sr);
      break;
    }
    case Role::Lead:
    case Role::Brass:
    case Role::Synth: {
      v.filterCutoff = 1600.f + vel * 2400.f;
      setPartial(0, OscType::Saw, freq, 0.2f * vel);
      setPartial(1, OscType::Square, freq, 0.08f * vel, 3.f);
      v.envTarget = 0.3f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.025f * sr);
      v.releaseInc = 0.2f * vel / std::max(1.f, 0.12f * sr);
      break;
    }
    default: {
      v.filterCutoff = 900.f + vel * 2400.f;
      setPartial(0, OscType::Triangle, freq, 0.2f * vel);
      v.envTarget = 0.26f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.03f * sr);
      v.releaseInc = 0.16f * vel / std::max(1.f, 0.15f * sr);
      break;
    }
  }
  if (!v.oneShot) {
    scaleEnv(v.attackInc, v.releaseInc, v.filterCutoff);
  } else {
    // One-shots (drums/piano): solo cutoff/Q, sin alargar el decay.
    const float cutMul = 0.35f + cutoffN_.load() * 2.2f;
    const float qMul = 0.4f + resonanceN_.load() * 2.5f;
    const float srF = static_cast<float>(sampleRate_);
    v.filterCutoff = std::clamp(v.filterCutoff * cutMul, 40.f, srF * 0.45f);
    v.filterQ = std::clamp(v.filterQ * qMul, 0.2f, 8.f);
  }
}

void Processor::noteOn(int16_t pitch, float velocity, int32_t /*sampleOffset*/) {
  const Role role = static_cast<Role>(activeRole_.load());
  const int32_t idx = allocVoice(role);
  setupVoice(voices_[static_cast<size_t>(idx)], pitch, velocity, role);
}

void Processor::noteOff(int16_t pitch, int32_t /*sampleOffset*/) {
  for (auto& v : voices_) {
    if (!v.active || v.pitch != pitch) continue;
    if (v.oneShot) {
      // Corte inmediato (pause / fin de nota): no dejar cola de 80ms pegada.
      v = Voice{};
      continue;
    }
    v.releasing = true;
    v.envTarget = 0.0001f;
    const float sr = static_cast<float>(sampleRate_);
    const float minRel = v.env / std::max(1.f, 0.04f * sr);
    if (v.releaseInc < minRel) v.releaseInc = minRel;
  }
}

void Processor::panicAll() {
  for (auto& v : voices_) v = Voice{};
}

float Processor::nextOsc(Partial& p, float sr) {
  if (!p.active) return 0.f;
  float sample = 0.f;
  const float det = std::pow(2.f, p.detuneCents / 1200.f);
  const float f = p.freqHz * det;
  switch (p.type) {
    case OscType::Sine:
      sample = std::sin(p.phase * 6.28318530718f);
      break;
    case OscType::Triangle: {
      const float t = p.phase;
      sample = 4.f * std::fabs(t - 0.5f) - 1.f;
      break;
    }
    case OscType::Saw:
      sample = 2.f * p.phase - 1.f;
      break;
    case OscType::Square:
      sample = p.phase < 0.5f ? 1.f : -1.f;
      break;
    case OscType::Noise: {
      noiseSeed_ = noiseSeed_ * 1664525u + 1013904223u;
      sample = (static_cast<int32_t>(noiseSeed_ >> 8) / 8388608.f) - 1.f;
      // crude band emphasis via gain only; cutoff applied in voice filter
      break;
    }
  }
  p.phase += f / sr;
  if (p.phase >= 1.f) p.phase -= std::floor(p.phase);
  return sample * p.gain;
}

float Processor::processFilter(Voice& v, float x) {
  // One-pole lowpass approx (cheap, stable)
  const float sr = static_cast<float>(sampleRate_);
  const float cutoff = std::clamp(v.filterCutoff, 40.f, sr * 0.45f);
  const float a = std::exp(-6.28318530718f * cutoff / sr);
  v.filterZ1 = (1.f - a) * x + a * v.filterZ1;
  return v.filterZ1;
}

void Processor::render(float* L, float* R, int32_t numSamples) {
  const float sr = static_cast<float>(sampleRate_);
  for (int32_t i = 0; i < numSamples; ++i) {
    float mix = 0.f;
    for (auto& v : voices_) {
      if (!v.active) continue;

      if (v.oneShot) {
        if (v.env < v.envTarget) v.env = std::min(v.envTarget, v.env + v.attackInc);
        else v.env = std::max(0.0001f, v.env - v.releaseInc);
        if (--v.samplesLeft <= 0 || v.env <= 0.0002f) {
          v.active = false;
          continue;
        }
      } else if (!v.releasing) {
        if (v.env < v.envTarget) {
          v.env = std::min(v.envTarget, v.env + v.attackInc);
        }
      } else {
        v.env = std::max(0.0001f, v.env - v.releaseInc);
        if (v.env <= 0.0002f) {
          v.active = false;
          continue;
        }
      }

      float s = 0.f;
      for (auto& p : v.partials) s += nextOsc(p, sr);
      s = processFilter(v, s) * clampEnv(v.env);
      mix += s;
    }
    mix = std::tanh(mix * 0.85f) * (0.25f + gainN_.load() * 1.5f);
    L[i] = mix;
    R[i] = mix;
  }
}

tresult PLUGIN_API Processor::process(ProcessData& data) {
  if (data.processContext && data.processContext->sampleRate > 0) {
    sampleRate_ = data.processContext->sampleRate;
  }

  // Transport stop/pause → panic una vez (no silenciar en vivo: MIDI live debe sonar parado).
  if (data.processContext) {
    const bool playing = (data.processContext->state & ProcessContext::kPlaying) != 0;
    if (wasPlaying_ && !playing) panicAll();
    wasPlaying_ = playing;
  }

  if (data.inputParameterChanges) {
    const int32 nParams = data.inputParameterChanges->getParameterCount();
    for (int32 i = 0; i < nParams; ++i) {
      auto* q = data.inputParameterChanges->getParameterData(i);
      if (!q) continue;
      ParamID id = q->getParameterId();
      int32 nPts = q->getPointCount();
      if (nPts <= 0) continue;
      int32 sampleOffset = 0;
      ParamValue value = 0;
      if (q->getPoint(nPts - 1, sampleOffset, value) == kResultOk) {
        if (id == static_cast<ParamID>(kParamRoleId)) applyRole(value);
        else if (id == static_cast<ParamID>(kParamAttackId))
          attackN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamReleaseId))
          releaseN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamCutoffId))
          cutoffN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamResonanceId))
          resonanceN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamGainId))
          gainN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamVoicesId))
          voicesN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
      }
    }
  }

  if (data.inputEvents) {
    const int32 nEv = data.inputEvents->getEventCount();
    for (int32 i = 0; i < nEv; ++i) {
      Event e{};
      if (data.inputEvents->getEvent(i, e) != kResultOk) continue;
      if (e.type == Event::kNoteOnEvent) {
        float v = e.noteOn.velocity;
        if (v <= 0.f) {
          noteOff(static_cast<int16_t>(e.noteOn.pitch), e.sampleOffset);
          continue;
        }
        if (v > 1.f) v = v / 127.f;
        noteOn(static_cast<int16_t>(e.noteOn.pitch), v, e.sampleOffset);
      } else if (e.type == Event::kNoteOffEvent) {
        noteOff(static_cast<int16_t>(e.noteOff.pitch), e.sampleOffset);
      } else if (e.type == Event::kLegacyMIDICCOutEvent) {
        // Host allNotesOff → CC 120/123
        if (e.midiCCOut.controlNumber == 120 || e.midiCCOut.controlNumber == 123) {
          panicAll();
        }
      }
    }
  }

  if (data.numOutputs < 1 || !data.outputs || data.outputs[0].numChannels < 1) return kResultOk;
  float* L = data.outputs[0].channelBuffers32[0];
  float* R = data.outputs[0].numChannels >= 2 ? data.outputs[0].channelBuffers32[1] : L;
  if (!L) return kResultOk;

  const int32 n = data.numSamples;
  std::memset(L, 0, static_cast<size_t>(n) * sizeof(float));
  if (R != L) std::memset(R, 0, static_cast<size_t>(n) * sizeof(float));
  render(L, R, n);
  return kResultOk;
}

} // namespace JasWaveRoles
