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
  double drive = 0.15, gate = 0.0, chorus = 0.2, delay = 0.15, reverb = 0.25, eqL = 0.5, eqH = 0.5;
  streamer.readDouble(attack);
  streamer.readDouble(release);
  streamer.readDouble(cutoff);
  streamer.readDouble(reso);
  streamer.readDouble(gain);
  streamer.readDouble(voices);
  streamer.readDouble(drive);
  streamer.readDouble(gate);
  streamer.readDouble(chorus);
  streamer.readDouble(delay);
  streamer.readDouble(reverb);
  streamer.readDouble(eqL);
  streamer.readDouble(eqH);
  attackN_.store(static_cast<float>(std::clamp(attack, 0.0, 1.0)));
  releaseN_.store(static_cast<float>(std::clamp(release, 0.0, 1.0)));
  cutoffN_.store(static_cast<float>(std::clamp(cutoff, 0.0, 1.0)));
  resonanceN_.store(static_cast<float>(std::clamp(reso, 0.0, 1.0)));
  gainN_.store(static_cast<float>(std::clamp(gain, 0.0, 1.0)));
  voicesN_.store(static_cast<float>(std::clamp(voices, 0.0, 1.0)));
  driveN_.store(static_cast<float>(std::clamp(drive, 0.0, 1.0)));
  gateN_.store(static_cast<float>(std::clamp(gate, 0.0, 1.0)));
  chorusN_.store(static_cast<float>(std::clamp(chorus, 0.0, 1.0)));
  delayN_.store(static_cast<float>(std::clamp(delay, 0.0, 1.0)));
  reverbN_.store(static_cast<float>(std::clamp(reverb, 0.0, 1.0)));
  eqLowN_.store(static_cast<float>(std::clamp(eqL, 0.0, 1.0)));
  eqHighN_.store(static_cast<float>(std::clamp(eqH, 0.0, 1.0)));
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
  streamer.writeDouble(driveN_.load());
  streamer.writeDouble(gateN_.load());
  streamer.writeDouble(chorusN_.load());
  streamer.writeDouble(delayN_.load());
  streamer.writeDouble(reverbN_.load());
  streamer.writeDouble(eqLowN_.load());
  streamer.writeDouble(eqHighN_.load());
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
  const float atkMul = 0.15f + attackN_.load() * 2.5f;
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
      // Kit orgánico (GM-ish): pitch sweep kick, snare body+noise, hats filtrados.
      v.oneShot = true;
      v.filterQ = 0.55f;
      const bool perc = (role == Role::Percussion);
      auto startDrum = [&](int8_t kind, float durSec, float body, float noise, float click,
                           float pitchStart, float pitchEnd, float glide, float cutHz) {
        v.drumKind = kind;
        v.filterCutoff = cutHz;
        v.bodyEnv = body * vel;
        v.bodyDec = v.bodyEnv / std::max(1.f, durSec * sr * (0.55f + 0.45f * vel));
        v.noiseEnv = noise * vel;
        v.noiseDec = v.noiseEnv / std::max(1.f, durSec * sr * (kind >= 2 ? 0.35f : 0.55f));
        v.clickEnv = click * vel;
        v.clickDec = v.clickEnv / std::max(1.f, 0.006f * sr);
        v.drumPitchHz = pitchStart;
        v.drumPitchTarget = pitchEnd;
        v.drumPitchGlide = glide;
        v.envTarget = std::max({v.bodyEnv, v.noiseEnv, v.clickEnv});
        v.env = v.envTarget;
        v.attackInc = v.envTarget;
        v.releaseInc = v.envTarget / std::max(1.f, durSec * sr);
        v.samplesLeft = static_cast<int>(durSec * sr);
        v.noiseHpZ_ = 0.f;
      };

      // GM / Music Build: 35-36 kick, 37 stick, 38/40 snare, 39 clap,
      // 41-45 toms, 42/44 CH, 46 OH, 49/51 cymbal-ish, resto perc.
      if (pitch <= 36 || pitch == 35) {
        // Kick profundo con click y caída de pitch.
        const float start = perc ? 95.f : (118.f + (36 - pitch) * 4.f);
        startDrum(0, 0.42f + vel * 0.12f, 0.85f, 0.12f, 0.55f, start, 42.f + vel * 8.f,
                  0.992f - vel * 0.004f, 1800.f);
        setPartial(0, OscType::Sine, start, 0.f); // body vía renderDrum
      } else if (pitch == 37) {
        startDrum(6, 0.08f, 0.15f, 0.55f, 0.7f, 900.f, 700.f, 0.97f, 6500.f);
      } else if (pitch == 38 || pitch == 40) {
        startDrum(1, 0.22f + vel * 0.08f, 0.45f, 0.7f, 0.4f, 185.f, 160.f, 0.985f, 5200.f);
      } else if (pitch == 39) {
        startDrum(5, 0.18f, 0.2f, 0.85f, 0.65f, 600.f, 400.f, 0.97f, 7000.f);
      } else if (pitch >= 41 && pitch <= 45) {
        const float tomF = 90.f + (45 - pitch) * 28.f;
        startDrum(4, 0.28f + vel * 0.1f, 0.7f, 0.18f, 0.35f, tomF * 1.55f, tomF, 0.988f, 3500.f);
      } else if (pitch == 42 || pitch == 44 || pitch == 22) {
        startDrum(2, 0.055f + vel * 0.03f, 0.05f, 0.55f, 0.25f, 9000.f, 7000.f, 0.95f, 11000.f);
      } else if (pitch == 46 || pitch == 26) {
        startDrum(3, 0.28f + vel * 0.15f, 0.08f, 0.5f, 0.2f, 8500.f, 5000.f, 0.96f, 10000.f);
      } else if (pitch >= 49 && pitch <= 59) {
        startDrum(3, 0.55f + vel * 0.25f, 0.12f, 0.55f, 0.3f, 7500.f, 3200.f, 0.978f, 9000.f);
      } else if (pitch < 42) {
        startDrum(0, 0.35f, 0.75f, 0.1f, 0.45f, 100.f, 48.f, 0.993f, 1600.f);
      } else {
        // Percusión / rim / shaker genérico
        startDrum(6, 0.12f + vel * 0.08f, 0.2f, 0.55f, 0.4f, 1400.f + (pitch - 48) * 40.f,
                  900.f, 0.97f, 8000.f);
      }
      break;
    }
    case Role::Bass: {
      v.filterCutoff = 220.f + vel * 380.f;
      v.filterQ = 0.85f;
      setPartial(0, OscType::Sine, freq, 0.42f * vel);
      setPartial(1, OscType::Triangle, freq * 0.5f, 0.18f * vel);
      setPartial(2, OscType::Sine, freq * 2.f, 0.08f * vel);
      v.envTarget = 0.48f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.015f * sr);
      v.releaseInc = 0.28f * vel / std::max(1.f, 0.18f * sr);
      break;
    }
    case Role::Guitar: {
      v.filterCutoff = 1100.f + vel * 1600.f;
      v.filterQ = 0.55f;
      setPartial(0, OscType::Triangle, freq, 0.24f * vel, -4.f);
      setPartial(1, OscType::Sine, freq * 2.002f, 0.1f * vel, 3.f);
      v.envTarget = 0.3f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.025f * sr);
      v.releaseInc = 0.16f * vel / std::max(1.f, 0.2f * sr);
      break;
    }
    case Role::Piano:
    case Role::Keys: {
      // Timbre más redondo (menos noise/saw caricaturesco).
      v.oneShot = true;
      v.filterCutoff = 1800.f + vel * 2200.f;
      v.filterQ = 0.45f;
      setPartial(0, OscType::Sine, freq, 0.38f * vel);
      setPartial(1, OscType::Triangle, freq * 2.005f, 0.16f * vel);
      setPartial(2, OscType::Sine, freq * 3.01f, 0.06f * vel);
      v.envTarget = 0.5f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.004f * sr);
      const float decaySec = 0.85f + (1.f - vel) * 1.1f;
      v.releaseInc = v.envTarget / std::max(1.f, decaySec * sr);
      v.samplesLeft = static_cast<int>(decaySec * sr);
      break;
    }
    case Role::Pad:
    case Role::Strings:
    case Role::Choir: {
      // Pads cálidos: capas sinusoidales detunadas + ataque lento.
      v.filterCutoff = (role == Role::Choir) ? 1600.f : 1200.f + vel * 900.f;
      v.filterQ = 0.35f;
      setPartial(0, OscType::Sine, freq, 0.28f * vel);
      setPartial(1, OscType::Sine, freq * 1.003f, 0.18f * vel, 7.f);
      setPartial(2, OscType::Triangle, freq * 0.5f, 0.1f * vel, -5.f);
      v.envTarget = 0.36f * vel;
      const float atk = role == Role::Pad ? 0.45f : 0.22f;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, atk * sr);
      v.releaseInc = 0.22f * vel / std::max(1.f, 0.55f * sr);
      break;
    }
    case Role::Lead:
    case Role::Brass:
    case Role::Synth: {
      v.filterCutoff = 1400.f + vel * 2000.f;
      v.filterQ = 0.5f;
      setPartial(0, OscType::Triangle, freq, 0.26f * vel);
      setPartial(1, OscType::Sine, freq * 2.01f, 0.1f * vel, 2.f);
      v.envTarget = 0.34f * vel;
      v.attackInc = (v.envTarget - v.env) / std::max(1.f, 0.03f * sr);
      v.releaseInc = 0.2f * vel / std::max(1.f, 0.16f * sr);
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
      if (v.drumKind >= 0) {
        // Audition / note corta: acelerar decay (no dejar el one-shot “pegado”).
        const float sr = static_cast<float>(sampleRate_);
        v.bodyDec *= 6.f;
        v.noiseDec *= 6.f;
        v.clickDec *= 6.f;
        v.samplesLeft = std::min(v.samplesLeft, static_cast<int>(0.06f * sr));
        continue;
      }
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
  clearFxTail();
}

void Processor::clearFxTail() {
  gateEnv_ = 0.f;
  eqLowZ_ = 0.f;
  eqHighZ_ = 0.f;
  chorusPhase_ = 0.f;
  delayWrite_ = 0;
  chorusWrite_ = 0;
  for (auto& w : revCombW_) w = 0;
  std::fill(delayBufL_.begin(), delayBufL_.end(), 0.f);
  std::fill(delayBufR_.begin(), delayBufR_.end(), 0.f);
  std::fill(chorusBuf_.begin(), chorusBuf_.end(), 0.f);
  std::fill(revCombBuf0_.begin(), revCombBuf0_.end(), 0.f);
  std::fill(revCombBuf1_.begin(), revCombBuf1_.end(), 0.f);
  std::fill(revCombBuf2_.begin(), revCombBuf2_.end(), 0.f);
  std::fill(revCombBuf3_.begin(), revCombBuf3_.end(), 0.f);
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

float Processor::renderDrumSample(Voice& v, float sr) {
  // Ruido blanco
  noiseSeed_ = noiseSeed_ * 1664525u + 1013904223u;
  const float white = (static_cast<int32_t>(noiseSeed_ >> 8) / 8388608.f) - 1.f;

  // Pitch sweep (kick/tom): aproximación exponencial al target
  const float prevPitch = v.drumPitchHz;
  v.drumPitchHz += (v.drumPitchTarget - v.drumPitchHz) * (1.f - v.drumPitchGlide);
  if ((prevPitch - v.drumPitchTarget) * (v.drumPitchHz - v.drumPitchTarget) <= 0.f)
    v.drumPitchHz = v.drumPitchTarget;

  auto& body = v.partials[0];
  body.active = true;
  body.type = OscType::Sine;
  body.freqHz = std::max(20.f, v.drumPitchHz);
  body.gain = 1.f;
  float tone = nextOsc(body, sr);

  // Segundo armónico suave (punch)
  auto& harm = v.partials[1];
  harm.active = true;
  harm.type = OscType::Triangle;
  harm.freqHz = std::max(20.f, v.drumPitchHz * 2.02f);
  harm.gain = 1.f;
  const float tone2 = nextOsc(harm, sr);

  // HP noise para snare/hats
  const float hpA = std::exp(-6.28318530718f * 1800.f / sr);
  v.noiseHpZ_ = (1.f - hpA) * white + hpA * v.noiseHpZ_;
  float noise = white - v.noiseHpZ_;

  float s = 0.f;
  const int k = v.drumKind;
  if (k == 0) {
    // Kick: sine + click noise corto
    s = tone * v.bodyEnv * 0.95f + tone2 * v.bodyEnv * 0.12f + white * v.clickEnv * 0.35f;
    // Soft saturation for body weight
    s = std::tanh(s * 1.35f);
  } else if (k == 1) {
    // Snare: cuerpo + noise
    s = tone * v.bodyEnv * 0.55f + noise * v.noiseEnv * 0.85f + white * v.clickEnv * 0.25f;
    s = processFilter(v, s);
  } else if (k == 2) {
    // Closed hat
    s = noise * v.noiseEnv * 0.9f + white * v.clickEnv * 0.2f;
    v.filterCutoff = std::max(6000.f, v.filterCutoff);
    s = processFilter(v, s);
  } else if (k == 3) {
    // Open hat / cymbal
    s = noise * v.noiseEnv * 0.75f + tone2 * v.bodyEnv * 0.08f + white * v.clickEnv * 0.15f;
    s = processFilter(v, s);
  } else if (k == 4) {
    // Tom
    s = tone * v.bodyEnv * 0.9f + tone2 * v.bodyEnv * 0.18f + noise * v.noiseEnv * 0.15f;
    s = std::tanh(s * 1.2f);
  } else if (k == 5) {
    // Clap: ráfagas de noise
    const float burst = (v.samplesLeft % std::max(1, static_cast<int>(0.012f * sr)) < static_cast<int>(0.004f * sr))
                            ? 1.f
                            : 0.55f;
    s = noise * v.noiseEnv * burst + white * v.clickEnv * 0.4f;
    s = processFilter(v, s);
  } else {
    // Perc / stick / shaker
    s = tone * v.bodyEnv * 0.35f + noise * v.noiseEnv * 0.7f + white * v.clickEnv * 0.3f;
    s = processFilter(v, s);
  }

  v.bodyEnv = std::max(0.f, v.bodyEnv - v.bodyDec);
  v.noiseEnv = std::max(0.f, v.noiseEnv - v.noiseDec);
  v.clickEnv = std::max(0.f, v.clickEnv - v.clickDec);
  v.env = std::max({v.bodyEnv, v.noiseEnv, v.clickEnv, 0.0001f});
  return s;
}

void Processor::render(float* L, float* R, int32_t numSamples) {
  const float sr = static_cast<float>(sampleRate_);
  for (int32_t i = 0; i < numSamples; ++i) {
    float mix = 0.f;
    for (auto& v : voices_) {
      if (!v.active) continue;

      if (v.drumKind >= 0) {
        if (--v.samplesLeft <= 0 || v.env <= 0.0002f) {
          v.active = false;
          continue;
        }
        mix += renderDrumSample(v, sr);
        continue;
      }

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
    /* Salida caliente; soft-clip solo overs. */
    const float makeup = 1.8f + gainN_.load() * 2.4f;
    mix *= makeup;
    if (mix > 0.95f) mix = 0.95f + 0.05f * std::tanh((mix - 0.95f) * 6.f);
    else if (mix < -0.95f) mix = -0.95f - 0.05f * std::tanh((-mix - 0.95f) * 6.f);
    L[i] = mix;
    R[i] = mix;
  }
  applyFx(L, R, numSamples);
}

void Processor::ensureFxBuffers(float sr) {
  const int delayCap = std::max(64, static_cast<int>(sr * 1.2f));
  if (static_cast<int>(delayBufL_.size()) != delayCap) {
    delayBufL_.assign(static_cast<size_t>(delayCap), 0.f);
    delayBufR_.assign(static_cast<size_t>(delayCap), 0.f);
    delayWrite_ = 0;
  }
  const int chCap = std::max(32, static_cast<int>(sr * 0.03f));
  if (static_cast<int>(chorusBuf_.size()) != chCap) {
    chorusBuf_.assign(static_cast<size_t>(chCap), 0.f);
    chorusWrite_ = 0;
  }
  const int combLens[4] = {
      std::max(16, static_cast<int>(sr * 0.0297f)),
      std::max(16, static_cast<int>(sr * 0.0371f)),
      std::max(16, static_cast<int>(sr * 0.0411f)),
      std::max(16, static_cast<int>(sr * 0.0437f)),
  };
  auto ensureComb = [](std::vector<float>& b, int n, int& w) {
    if (static_cast<int>(b.size()) != n) {
      b.assign(static_cast<size_t>(n), 0.f);
      w = 0;
    }
  };
  ensureComb(revCombBuf0_, combLens[0], revCombW_[0]);
  ensureComb(revCombBuf1_, combLens[1], revCombW_[1]);
  ensureComb(revCombBuf2_, combLens[2], revCombW_[2]);
  ensureComb(revCombBuf3_, combLens[3], revCombW_[3]);
}

void Processor::applyFx(float* L, float* R, int32_t numSamples) {
  const float sr = static_cast<float>(sampleRate_);
  ensureFxBuffers(sr);
  const float drive = driveN_.load();
  const float gateAmt = gateN_.load();
  const float chorusAmt = chorusN_.load();
  const float delayAmt = delayN_.load();
  const float reverbAmt = reverbN_.load();
  const float eqLow = eqLowN_.load();
  const float eqHigh = eqHighN_.load();

  const int delayCap = static_cast<int>(delayBufL_.size());
  const int delaySamples = std::clamp(static_cast<int>((0.12f + delayAmt * 0.45f) * sr), 1, delayCap - 1);
  const int chCap = static_cast<int>(chorusBuf_.size());
  const float chorusBase = 0.012f * sr;
  const float chorusDepth = 0.006f * sr * chorusAmt;

  std::vector<float>* combs[4] = {&revCombBuf0_, &revCombBuf1_, &revCombBuf2_, &revCombBuf3_};

  for (int32_t i = 0; i < numSamples; ++i) {
    float l = L[i];
    float r = R[i];

    // EQ shelves (one-pole)
    const float lowGain = 0.35f + eqLow * 1.4f;
    const float highGain = 0.35f + eqHigh * 1.4f;
    const float lowA = std::exp(-2.f * 3.14159265f * 220.f / sr);
    eqLowZ_ = (1.f - lowA) * ((l + r) * 0.5f) + lowA * eqLowZ_;
    const float highA = std::exp(-2.f * 3.14159265f * 4500.f / sr);
    const float mid = (l + r) * 0.5f;
    eqHighZ_ = (1.f - highA) * mid + highA * eqHighZ_;
    const float highs = mid - eqHighZ_;
    l = l * 0.55f + eqLowZ_ * (lowGain - 0.55f) + highs * (highGain - 0.55f);
    r = r * 0.55f + eqLowZ_ * (lowGain - 0.55f) + highs * (highGain - 0.55f);

    // Drive
    if (drive > 0.001f) {
      const float k = 1.f + drive * 5.f;
      l = std::tanh(l * k) * (0.85f + drive * 0.15f);
      r = std::tanh(r * k) * (0.85f + drive * 0.15f);
    }

    // Gate
    const float peak = std::max(std::fabs(l), std::fabs(r));
    const float thr = gateAmt * gateAmt * 0.35f;
    const float target = peak >= thr ? 1.f : (1.f - gateAmt);
    gateEnv_ += (target - gateEnv_) * (peak >= thr ? 0.2f : 0.02f);
    l *= gateEnv_;
    r *= gateEnv_;

    // Chorus
    if (chorusAmt > 0.001f && chCap > 4) {
      chorusPhase_ += 2.f * 3.14159265f * 0.8f / sr;
      if (chorusPhase_ > 6.2831853f) chorusPhase_ -= 6.2831853f;
      const float mod = chorusBase + std::sin(chorusPhase_) * chorusDepth;
      float readPos = static_cast<float>(chorusWrite_) - mod;
      while (readPos < 0.f) readPos += static_cast<float>(chCap);
      const int i0 = static_cast<int>(readPos) % chCap;
      const int i1 = (i0 + 1) % chCap;
      const float frac = readPos - std::floor(readPos);
      const float wet = chorusBuf_[static_cast<size_t>(i0)] * (1.f - frac) +
                        chorusBuf_[static_cast<size_t>(i1)] * frac;
      chorusBuf_[static_cast<size_t>(chorusWrite_)] = (l + r) * 0.5f;
      chorusWrite_ = (chorusWrite_ + 1) % chCap;
      l += wet * chorusAmt * 0.45f;
      r += wet * chorusAmt * 0.45f * 0.92f;
    }

    // Delay
    if (delayAmt > 0.001f && delayCap > 4) {
      int ri = delayWrite_ - delaySamples;
      if (ri < 0) ri += delayCap;
      const float dl = delayBufL_[static_cast<size_t>(ri)];
      const float dr = delayBufR_[static_cast<size_t>(ri)];
      const float fb = 0.25f + delayAmt * 0.45f;
      delayBufL_[static_cast<size_t>(delayWrite_)] = l + dl * fb;
      delayBufR_[static_cast<size_t>(delayWrite_)] = r + dr * fb;
      delayWrite_ = (delayWrite_ + 1) % delayCap;
      l += dl * delayAmt * 0.55f;
      r += dr * delayAmt * 0.55f;
    }

    // Cheap reverb (4 combs)
    if (reverbAmt > 0.001f) {
      float wet = 0.f;
      for (int c = 0; c < 4; ++c) {
        auto& buf = *combs[c];
        int& w = revCombW_[static_cast<size_t>(c)];
        const int n = static_cast<int>(buf.size());
        const float fb = 0.72f - c * 0.04f;
        const float out = buf[static_cast<size_t>(w)];
        buf[static_cast<size_t>(w)] = ((l + r) * 0.5f) + out * fb;
        w = (w + 1) % n;
        wet += out;
      }
      wet *= 0.22f;
      l += wet * reverbAmt;
      r += wet * reverbAmt * 0.96f;
    }

    if (l > 0.98f) l = 0.98f;
    else if (l < -0.98f) l = -0.98f;
    if (r > 0.98f) r = 0.98f;
    else if (r < -0.98f) r = -0.98f;
    L[i] = l;
    R[i] = r;
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
        else if (id == static_cast<ParamID>(kParamDriveId))
          driveN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamGateId))
          gateN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamChorusId))
          chorusN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamDelayId))
          delayN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamReverbId))
          reverbN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamEqLowId))
          eqLowN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
        else if (id == static_cast<ParamID>(kParamEqHighId))
          eqHighN_.store(static_cast<float>(std::clamp(value, 0.0, 1.0)));
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
