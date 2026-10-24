// =====================================================================================
//  JasWave Roles v2 – motor de síntesis de estudio por roles
//   Piano modal (inarmonicidad + decaimiento por parcial + cuerdas dobles), piano eléctrico FM,
//   bajo y guitarra por cuerda pulsada física con cuerpo resonante, batería sintetizada con capas
//   (bombo, caja, hats metálicos, toms, platillos, palmas), pads y cuerdas con unísono y vibrato,
//   coro/voz con formantes, metales y sintetizador polifónico. Todo band-limited (polyBLEP),
//   estéreo, y cadena de efectos con EQ, saturación, chorus, delay sincronizable y reverb FDN.
//  Sin asignaciones en process(): los búferes se dimensionan en prepare().
// =====================================================================================
#pragma once

#include "roles_dsp.h"
#include "roles_map.h"

namespace JasWaveRoles {

using namespace dsp;

enum class VK : uint8_t { None, Piano, EPiano, Kick, Snare, Rim, Hat, Tom, Cymbal, Clap, Shaker, Cowbell, Pluck, Pad, Strings, Choir, Lead, Brass, Synth };

constexpr int kPianoPartials = 26;
constexpr int kMaxPoly = 7;

struct Voice {
  bool active{false};
  bool releasing{false};
  int16_t pitch{60};
  float vel{0.f};
  Role role{Role::Default};
  VK kind{VK::None};
  uint64_t age{0};
  uint32_t n{0};            // muestras transcurridas
  float relGain{1.f};       // amortiguador de nota liberada
  float relDec{0.999f};
  float pan{0.f};
  float env{0.f}, envA{0.f}, envR{0.f}, envT{1.f};
  float gain{1.f};
  float f0{440.f};
  float p[10]{};            // parámetros por tipo
  float ph[10]{};           // fases
  float e[5]{};             // envolventes
  float d[5]{};             // factores de decaimiento por muestra
  float x1{0.f};
  float tri{0.f};
  uint32_t seed{1};
  bool open{false};
  Svf s1, s2, s3;
  Biquad q1, q2, q3;
  Rotor rot[kPianoPartials * 2];
  int nrot{0}, nA{0};     // nA = rotores de la 1ª cuerda; el resto (nrot-nA) son la 2ª cuerda
  PluckString str[2];
};

class RolesEngine {
public:
  void prepare(double sr) {
    sr_ = static_cast<float>(sr > 0 ? sr : 48000.0);
    const int maxLen = static_cast<int>(sr_ / 26.f) + 16;
    for (auto& v : voices_) {
      v.str[0].alloc(maxLen);
      v.str[1].alloc(maxLen);
      killVoice(v);
    }
    reverb_.prepare(sr_);
    chorus_.prepare(sr_);
    delayL_.alloc(static_cast<int>(sr_ * 1.6f));
    delayR_.alloc(static_cast<int>(sr_ * 1.6f));
    rebuildBusFilters();
    setRoleReverb(Role::Default);
    panicAll();
  }
  void setRole(int32_t r) {
    const Role nr = static_cast<Role>(std::clamp(r, 0, kNumRoles - 1));
    if (nr != role_) { role_ = nr; setRoleReverb(nr); rebuildBusFilters(); }
  }
  int32_t role() const { return static_cast<int32_t>(role_); }
  void setTempo(double bpm) { tempo_ = (bpm > 20.0 && bpm < 400.0) ? static_cast<float>(bpm) : 0.f; }
  void setNorm(int32_t id, float n) {
    n = std::clamp(n, 0.f, 1.f);
    switch (id) {
      case kParamAttackId: attackN_ = n; break;
      case kParamReleaseId: releaseN_ = n; break;
      case kParamCutoffId: if (cutoffN_ != n) { cutoffN_ = n; eqDirty_ = true; } break;
      case kParamResonanceId: resonanceN_ = n; break;
      case kParamGainId: gainN_ = n; break;
      case kParamVoicesId: voicesN_ = n; break;
      case kParamDriveId: driveN_ = n; break;
      case kParamGateId: gateN_ = n; break;
      case kParamChorusId: chorusN_ = n; break;
      case kParamDelayId: delayN_ = n; break;
      case kParamReverbId: reverbN_ = n; break;
      case kParamEqLowId: if (eqLowN_ != n) { eqLowN_ = n; eqDirty_ = true; } break;
      case kParamEqHighId: if (eqHighN_ != n) { eqHighN_ = n; eqDirty_ = true; } break;
      default: break;
    }
  }
  void noteOn(int16_t pitch, float velocity, int32_t /*sampleOffset*/);
  void noteOff(int16_t pitch, int32_t /*sampleOffset*/);
  void panicAll();
  void render(float* L, float* R, int32_t numSamples);
  int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a; }
  const std::array<Voice, kMaxVoices>& voices() const { return voices_; }

private:
  // ---- configuración por nota ----
  void setupPiano(Voice& v);
  void setupEPiano(Voice& v);
  void setupKick(Voice& v);
  void setupSnare(Voice& v);
  void setupRim(Voice& v);
  void setupHat(Voice& v, bool open, bool pedal);
  void setupTom(Voice& v);
  void setupCymbal(Voice& v, int kind);
  void setupClap(Voice& v);
  void setupShaker(Voice& v, bool tambourine);
  void setupCowbell(Voice& v);
  void setupPluck(Voice& v, bool bass);
  void setupPad(Voice& v);
  void setupStrings(Voice& v);
  void setupVoiceLike(Voice& v, bool choir);
  void setupBrass(Voice& v);
  void setupSynth(Voice& v);
  void setupDrumNote(Voice& v);

  // ---- render por tipo (estéreo mezclado en l/r) ----
  void renderVoice(Voice& v, float& l, float& r, float& gtrL, float& gtrR, float& bass);
  inline void renderPiano(Voice& v, float& l, float& r);
  inline void renderEPiano(Voice& v, float& l, float& r);
  inline float renderKick(Voice& v);
  inline float renderSnare(Voice& v);
  inline float renderRim(Voice& v);
  inline float renderHat(Voice& v);
  inline float renderTom(Voice& v);
  inline float renderCymbal(Voice& v);
  inline float renderClap(Voice& v);
  inline float renderShaker(Voice& v);
  inline float renderCowbell(Voice& v);
  inline float renderPluck(Voice& v);
  inline void renderPad(Voice& v, float& l, float& r);
  inline void renderStrings(Voice& v, float& l, float& r);
  inline void renderVoiceLike(Voice& v, float& l, float& r);
  inline void renderBrass(Voice& v, float& l, float& r);
  inline void renderSynth(Voice& v, float& l, float& r);

  int32_t allocVoice(Role role);
  void killVoice(Voice& v);
  void rebuildBusFilters();
  void setRoleReverb(Role r);
  inline void pan2(float mono, float pan, float& l, float& r) const {
    const float a = (clampf(pan, -1.f, 1.f) + 1.f) * 0.78539816339f;
    l += mono * std::cos(a) * 1.41421356f;
    r += mono * std::sin(a) * 1.41421356f;
  }
  inline float vibrato(float depthCents, float rateHz, float t, float phase) const {
    return std::pow(2.f, depthCents * std::sin(kTwoPi * rateHz * t + phase) / 1200.f);
  }

  float sr_{48000.f};
  Role role_{Role::Default};
  float tempo_{0.f};
  float attackN_{0.35f}, releaseN_{0.4f}, cutoffN_{0.55f}, resonanceN_{0.25f}, gainN_{0.7f}, voicesN_{0.5f};
  float driveN_{0.15f}, gateN_{0.f}, chorusN_{0.2f}, delayN_{0.15f}, reverbN_{0.25f}, eqLowN_{0.5f}, eqHighN_{0.5f};
  bool eqDirty_{true};
  std::array<Voice, kMaxVoices> voices_{};
  uint64_t ageCounter_{0};
  Rng rng_{0xA5A5A5A5u};

  // buses de cuerpo / EQ por instrumento
  std::array<Biquad, 4> gtrBodyL_{}, gtrBodyR_{};
  Biquad gtrHpL_, gtrHpR_;
  std::array<Biquad, 4> bassEq_{};
  Biquad gtrLpL_, gtrLpR_;
  std::array<Biquad, 3> pnoEqL_{}, pnoEqR_{};
  Biquad eqLowL_, eqLowR_, eqHighL_, eqHighR_;
  Biquad dcL_, dcR_;
  FdnReverb reverb_;
  StereoChorus chorus_;
  DelayLine delayL_, delayR_;
  Biquad dlyLpL_, dlyLpR_, dlyHpL_, dlyHpR_;
  float fbL_{0.f}, fbR_{0.f};
  float wetRev_{0.f}, wetDly_{0.f}, wetChr_{0.f}, gateEnv_{1.f}, outGain_{1.f};
  bool filtersBuilt_{false};
};

// =====================================================================================
//  Utilidades
// =====================================================================================
inline void RolesEngine::killVoice(Voice& v) {
  v.active = false;
  v.releasing = false;
  v.kind = VK::None;
  v.nrot = 0;
  v.str[0].active = v.str[1].active = false;
}

inline void RolesEngine::panicAll() {
  for (auto& v : voices_) killVoice(v);
  reverb_.clear();
  chorus_.clear();
  delayL_.clear();
  delayR_.clear();
  fbL_ = fbR_ = 0.f;
  gateEnv_ = 1.f;
  for (auto& b : gtrBodyL_) b.reset();
  for (auto& b : gtrBodyR_) b.reset();
  for (auto& b : bassEq_) b.reset();
  gtrLpL_.reset(); gtrLpR_.reset();
  for (auto& b : pnoEqL_) b.reset();
  for (auto& b : pnoEqR_) b.reset();
  eqLowL_.reset(); eqLowR_.reset(); eqHighL_.reset(); eqHighR_.reset();
  dcL_.reset(); dcR_.reset();
}

inline void RolesEngine::setRoleReverb(Role r) {
  float rt = 2.4f, hf = 0.45f;
  switch (r) {
    case Role::Drums: case Role::Percussion: rt = 1.5f; hf = 0.5f; break;
    case Role::Bass: rt = 0.9f; hf = 0.6f; break;
    case Role::Guitar: rt = 2.3f; hf = 0.5f; break;
    case Role::Piano: rt = 2.8f; hf = 0.42f; break;
    case Role::Keys: rt = 2.2f; hf = 0.45f; break;
    case Role::Pad: rt = 4.0f; hf = 0.42f; break;
    case Role::Strings: rt = 3.4f; hf = 0.42f; break;
    case Role::Choir: rt = 3.6f; hf = 0.4f; break;
    case Role::Lead: rt = 2.5f; hf = 0.45f; break;
    case Role::Brass: rt = 1.9f; hf = 0.5f; break;
    default: break;
  }
  reverb_.setDecay(rt, hf);
  reverb_.setPreDelayMs(r == Role::Drums || r == Role::Percussion ? 8.f : 22.f);
}

inline void RolesEngine::rebuildBusFilters() {
  const float sr = sr_;
  // cuerpo de guitarra acústica: resonancias Helmholtz / tapa / aro
  static const float kF[4] = { 98.f, 205.f, 392.f, 1180.f };
  static const float kQ[4] = { 4.5f, 6.f, 7.f, 9.f };
  for (int i = 0; i < 4; ++i) {
    gtrBodyL_[static_cast<size_t>(i)].bandpass(sr, kF[i], kQ[i]);
    gtrBodyR_[static_cast<size_t>(i)].bandpass(sr, kF[i] * 1.01f, kQ[i]);
  }
  gtrHpL_.highpass(sr, 75.f, 0.707f); gtrHpR_.highpass(sr, 75.f, 0.707f);
  // bajo: calidez grave, hueco de medios, presencia de dedo
  bassEq_[0].lowShelf(sr, 95.f, 2.5f);
  bassEq_[1].peaking(sr, 420.f, 0.9f, -3.5f);
  bassEq_[2].peaking(sr, 1900.f, 0.8f, 2.0f);
  bassEq_[3].lowpass(sr, clampf(2600.f * (0.4f + cutoffN_), 900.f, 9000.f), 0.707f);
  gtrLpL_.lowpass(sr, clampf(7200.f * (0.4f + cutoffN_), 2500.f, 14000.f), 0.707f); gtrLpR_.lowpass(sr, clampf(7200.f * (0.4f + cutoffN_), 2500.f, 14000.f), 0.707f);
  // piano: cuerpo y brillo suave
  for (int c = 0; c < 2; ++c) {
    auto& e = c == 0 ? pnoEqL_ : pnoEqR_;
    e[0].peaking(sr, 190.f, 0.8f, 2.0f);
    e[1].peaking(sr, 3100.f, 0.9f, 1.5f);
    e[2].highShelf(sr, 9000.f, -2.5f);
  }
  const float lowDb = (eqLowN_ - 0.5f) * 18.f, highDb = (eqHighN_ - 0.5f) * 18.f;
  eqLowL_.lowShelf(sr, 140.f, lowDb); eqLowR_.lowShelf(sr, 140.f, lowDb);
  eqHighL_.highShelf(sr, 5500.f, highDb); eqHighR_.highShelf(sr, 5500.f, highDb);
  dcL_.highpass(sr, 22.f, 0.707f); dcR_.highpass(sr, 22.f, 0.707f);
  dlyLpL_.lowpass(sr, 4800.f, 0.707f); dlyLpR_.lowpass(sr, 4800.f, 0.707f);
  dlyHpL_.highpass(sr, 180.f, 0.707f); dlyHpR_.highpass(sr, 180.f, 0.707f);
  eqDirty_ = false;
  filtersBuilt_ = true;
}

inline int32_t RolesEngine::allocVoice(Role role) {
  const int32_t baseCap = voiceCapForRole(role);
  const int32_t cap = std::clamp(static_cast<int32_t>(std::lround(baseCap * (0.5f + voicesN_ * 1.0f))), 1, kMaxVoices);
  int32_t used = 0, oldestIdx = -1, freeIdx = -1;
  uint64_t oldestAge = UINT64_MAX;
  for (int32_t i = 0; i < kMaxVoices; ++i) {
    auto& v = voices_[static_cast<size_t>(i)];
    if (!v.active) { if (freeIdx < 0) freeIdx = i; continue; }
    if (v.role == role) { ++used; if (v.age < oldestAge) { oldestAge = v.age; oldestIdx = i; } }
  }
  if (used >= cap && oldestIdx >= 0) return oldestIdx;
  if (freeIdx >= 0) return freeIdx;
  oldestIdx = 0; oldestAge = voices_[0].age;
  for (int32_t i = 1; i < kMaxVoices; ++i) if (voices_[static_cast<size_t>(i)].age < oldestAge) { oldestAge = voices_[static_cast<size_t>(i)].age; oldestIdx = i; }
  return oldestIdx;
}

// =====================================================================================
//  PIANO (modal): parcelas inarmónicas con dos cuerdas por nota (decaimiento rápido + postsonido)
// =====================================================================================
inline void RolesEngine::setupPiano(Voice& v) {
  const float f0 = v.f0, sr = sr_, vel = v.vel;
  const float m = static_cast<float>(v.pitch);
  float B = 5.0e-5f * std::exp(0.095f * (m - 21.f));
  B = clampf(B, 5.0e-5f, 0.012f);
  const float t60_0 = clampf(13.f * std::pow(2.f, -(m - 21.f) / 17.f), 0.9f, 14.f) * (0.65f + releaseN_ * 0.9f);
  const float tilt = 1.55f - 0.95f * vel;           // golpe fuerte = más brillante
  const float cutMul = 0.35f + cutoffN_ * 1.3f;     // brillo global
  v.nrot = 0;
  float norm = 0.f;
  float amps[kPianoPartials];
  for (int n = 1; n <= kPianoPartials; ++n) {
    const float fn = static_cast<float>(n) * f0 * std::sqrt(1.f + B * static_cast<float>(n * n));
    if (fn > 0.42f * sr) { amps[n - 1] = 0.f; continue; }
    float a = std::fabs(std::sin(kPi * static_cast<float>(n) * 0.122f)) / std::pow(static_cast<float>(n), tilt);
    a *= std::exp(-static_cast<float>(n) * 0.045f / cutMul);   // roll-off por dureza de fieltro
    amps[n - 1] = a;
    norm += a;
  }
  const float scale = 0.55f * std::pow(vel, 1.18f) / std::max(0.3f, norm);
  // 1ª cuerda: todas las parciales. 2ª cuerda (batido + postsonido): solo hasta la parcial 16 para ahorrar CPU.
  for (int pass = 0; pass < 2; ++pass) {
    for (int n = 1; n <= kPianoPartials; ++n) {
      const float a = amps[n - 1] * scale;
      if (a <= 0.f) continue;
      if (pass == 1 && n > 16) break;
      const float fn = static_cast<float>(n) * f0 * std::sqrt(1.f + B * static_cast<float>(n * n));
      const float t60n = t60_0 / (1.f + 0.85f * std::pow(static_cast<float>(n - 1), 0.88f));
      const float beat = 1.f + (0.00035f + 0.00012f * static_cast<float>(n)) * (0.6f + 0.8f * rng_.uni());
      if (v.nrot >= kPianoPartials * 2) break;
      if (pass == 0) v.rot[v.nrot++].set(a * (n > 16 ? 1.f : 0.62f), kPi * 0.5f, fn, std::max(0.12f, t60n), sr);
      else v.rot[v.nrot++].set(a * 0.38f, kPi * 0.5f + 0.6f * rng_.uni(), fn * beat, std::max(0.3f, t60n * 3.4f), sr);
    }
    if (pass == 0) v.nA = v.nrot;
  }
  v.pan = clampf((m - 60.f) / 56.f, -0.45f, 0.45f);
  v.p[0] = std::exp(-1.f / (sr * (0.0009f + (1.f - vel) * 0.0022f)));   // ataque de martillo
  v.e[0] = 1.f;
  v.p[1] = rng_.uni();
  // amortiguador: más largo en graves
  const float relSec = clampf(0.55f - (m - 21.f) * 0.0042f, 0.14f, 0.55f) * (0.5f + releaseN_);
  v.relDec = std::pow(10.f, -3.f / (relSec * sr));
  // ruido de martillo (golpe de fieltro)
  v.q1.bandpass(sr, clampf(f0 * 4.f, 600.f, 3800.f), 0.9f);
  v.d[0] = std::exp(-1.f / (sr * 0.012f));
  v.e[1] = vel * 0.05f;
}

inline void RolesEngine::renderPiano(Voice& v, float& l, float& r) {
  float a = 0.f, b = 0.f;
  for (int i = 0; i < v.nA; ++i) a += v.rot[i].tick();
  for (int i = v.nA; i < v.nrot; ++i) b += v.rot[i].tick();
  v.e[0] *= v.p[0];
  const float att = 1.f - v.e[0];
  const float hammer = v.q1.process(rng_.white()) * v.e[1];
  v.e[1] *= v.d[0];
  const float mono = (a + b) * att + hammer;
  // dos cuerdas a lados opuestos (ancho sutil)
  const float wA = a * att + hammer * 0.5f, wB = b * att + hammer * 0.5f;
  const float mid = mono * 0.5f;
  const float spread = 0.5f;
  const float outL = mid + (wA - wB) * spread * 0.5f;
  const float outR = mid - (wA - wB) * spread * 0.5f;
  const float g = v.relGain;
  const float pl = std::cos((v.pan + 1.f) * 0.78539816f) * 1.41421356f;
  const float pr = std::sin((v.pan + 1.f) * 0.78539816f) * 1.41421356f;
  l += outL * pl * g;
  r += outR * pr * g;
  if (v.n > static_cast<uint32_t>(sr_ * 0.2f) && v.rot[0].dead(1.0e-6f) && (v.nrot > v.nA ? v.rot[v.nA].dead(1.0e-6f) : true)) v.active = false;
}

// =====================================================================================
//  PIANO ELÉCTRICO (FM de dos operadores, estilo tine)
// =====================================================================================
inline void RolesEngine::setupEPiano(Voice& v) {
  const float sr = sr_;
  v.p[0] = 0.f;  // fase portadora
  v.p[1] = 0.f;  // fase moduladora
  v.p[2] = 0.f;  // fase tine
  v.e[0] = 1.f;  // índice de modulación
  v.e[1] = 1.f;  // amplitud
  const float m = static_cast<float>(v.pitch);
  const float t60 = clampf(7.f * std::pow(2.f, -(m - 36.f) / 20.f), 0.8f, 8.f);
  v.d[1] = std::exp(-6.9f / (t60 * sr));
  v.d[0] = std::exp(-1.f / (0.45f * sr));
  v.e[2] = 1.f;
  v.d[2] = std::exp(-1.f / (0.022f * sr));
  v.pan = clampf((m - 60.f) / 60.f, -0.3f, 0.3f);
  v.q1.lowpass(sr, clampf(3500.f * (0.4f + cutoffN_), 1200.f, 9000.f), 0.707f);
  const float relSec = 0.35f * (0.5f + releaseN_);
  v.relDec = std::pow(10.f, -3.f / (relSec * sr));
}
inline void RolesEngine::renderEPiano(Voice& v, float& l, float& r) {
  const float f = v.f0 / sr_;
  const float idx = (0.35f + v.vel * 1.5f) * v.e[0] + 0.12f;
  v.ph[0] += f; if (v.ph[0] >= 1.f) v.ph[0] -= 1.f;
  v.ph[1] += f; if (v.ph[1] >= 1.f) v.ph[1] -= 1.f;
  v.ph[2] += f * 14.f; if (v.ph[2] >= 1.f) v.ph[2] -= std::floor(v.ph[2]);
  const float mod = std::sin(kTwoPi * v.ph[1]);
  float y = std::sin(kTwoPi * v.ph[0] + idx * mod);
  y += 0.35f * std::sin(kTwoPi * v.ph[0] * 2.f);   // octava para calidez
  y += v.e[2] * 0.09f * v.vel * std::sin(kTwoPi * v.ph[2]);
  y = v.q1.process(y) * v.e[1] * v.vel * 0.34f;
  v.e[0] *= v.d[0]; v.e[1] *= v.d[1]; v.e[2] *= v.d[2];
  // tremolo muy leve
  const float trem = 1.f + 0.06f * std::sin(kTwoPi * 4.6f * static_cast<float>(v.n) / sr_);
  const float s = y * trem * v.relGain;
  pan2(s, v.pan, l, r);
  if (v.e[1] < 1.0e-4f) v.active = false;
}

// =====================================================================================
//  BATERÍA
// =====================================================================================
inline void RolesEngine::setupKick(Voice& v) {
  const float sr = sr_, vel = v.vel;
  v.p[0] = 135.f + vel * 70.f;                       // frecuencia inicial
  v.p[1] = 44.f + (v.pitch <= 35 ? -4.f : 0.f);      // frecuencia final (sub)
  v.d[0] = std::exp(-1.f / (sr * 0.028f));            // barrido
  v.p[2] = v.p[0] - v.p[1];
  v.e[0] = 1.f;                                       // cuerpo
  v.d[1] = std::exp(-1.f / (sr * (0.19f + vel * 0.07f)));
  v.e[1] = 1.f;                                       // click
  v.d[2] = std::exp(-1.f / (sr * 0.0022f));
  v.e[2] = 1.f;                                       // sub
  v.d[3] = std::exp(-1.f / (sr * 0.34f));
  v.ph[0] = 0.f; v.ph[1] = 0.f;
  v.q1.bandpass(sr, 3200.f, 0.8f);
  v.q2.lowpass(sr, 7000.f, 0.707f);
  v.pan = 0.f;
}
inline float RolesEngine::renderKick(Voice& v) {
  const float sr = sr_;
  v.p[2] *= v.d[0];
  const float f = v.p[1] + v.p[2];
  v.ph[0] += f / sr; if (v.ph[0] >= 1.f) v.ph[0] -= 1.f;
  v.ph[1] += v.p[1] / sr; if (v.ph[1] >= 1.f) v.ph[1] -= 1.f;
  const float body = std::sin(kTwoPi * v.ph[0]) * v.e[0];
  const float sub = std::sin(kTwoPi * v.ph[1]) * v.e[2] * 0.55f;
  const float click = v.q1.process(rng_.white()) * v.e[1] * 0.55f * (0.35f + v.vel);
  v.e[0] *= v.d[1]; v.e[1] *= v.d[2]; v.e[2] *= v.d[3];
  float s = body * 0.85f + sub + click;
  s = std::tanh(s * (1.2f + v.vel * 0.8f)) * 0.62f;
  s = v.q2.process(s);
  if (v.e[0] < 4.0e-4f && v.e[2] < 4.0e-4f) v.active = false;
  return s * (0.55f + 0.45f * v.vel);
}

inline void RolesEngine::setupSnare(Voice& v) {
  const float sr = sr_, vel = v.vel;
  v.p[0] = 188.f + rng_.uni() * 6.f;
  v.p[1] = 336.f;
  v.e[0] = 1.f; v.d[0] = std::exp(-1.f / (sr * 0.075f));     // modo 1
  v.e[1] = 1.f; v.d[1] = std::exp(-1.f / (sr * 0.05f));      // modo 2
  v.e[2] = 1.f; v.d[2] = std::exp(-1.f / (sr * (0.14f + vel * 0.05f)));  // alambres
  v.e[3] = 1.f; v.d[3] = std::exp(-1.f / (sr * 0.0018f));    // click
  v.e[4] = 1.f;
  v.q1.highpass(sr, 1500.f, 0.707f);
  v.q2.lowpass(sr, 9800.f, 0.707f);
  v.q3.peaking(sr, 3600.f, 0.8f, 5.f);
  v.ph[0] = v.ph[1] = 0.f;
  v.pan = 0.05f;
}
inline float RolesEngine::renderSnare(Voice& v) {
  const float sr = sr_;
  const float t = static_cast<float>(v.n) / sr;
  const float f1 = v.p[0] * (1.f + 0.14f * std::exp(-t / 0.012f));
  v.ph[0] += f1 / sr; if (v.ph[0] >= 1.f) v.ph[0] -= 1.f;
  v.ph[1] += v.p[1] / sr; if (v.ph[1] >= 1.f) v.ph[1] -= 1.f;
  const float m1 = std::sin(kTwoPi * v.ph[0]) * v.e[0];
  const float m2 = std::sin(kTwoPi * v.ph[1]) * v.e[1] * 0.5f;
  float w = v.q3.process(v.q2.process(v.q1.process(rng_.white())));
  w *= v.e[2] * (0.45f + 0.55f * v.vel);
  const float click = rng_.white() * v.e[3] * 0.35f;
  v.e[0] *= v.d[0]; v.e[1] *= v.d[1]; v.e[2] *= v.d[2]; v.e[3] *= v.d[3];
  float s = (m1 * 0.6f + m2 * 0.35f) * (0.4f + 0.6f * v.vel) + w * 0.85f + click * v.vel;
  s = std::tanh(s * 1.4f) * 0.7f;
  if (v.e[2] < 4.0e-4f && v.e[0] < 4.0e-4f) v.active = false;
  return s;
}

inline void RolesEngine::setupRim(Voice& v) {
  const float sr = sr_;
  v.e[0] = 1.f; v.d[0] = std::exp(-1.f / (sr * 0.012f));
  v.e[1] = 1.f; v.d[1] = std::exp(-1.f / (sr * 0.0035f));
  v.ph[0] = 0.f;
  v.q1.bandpass(sr, 1750.f, 4.f);
  v.pan = -0.08f;
}
inline float RolesEngine::renderRim(Voice& v) {
  v.ph[0] += 395.f / sr_; if (v.ph[0] >= 1.f) v.ph[0] -= 1.f;
  const float body = std::sin(kTwoPi * v.ph[0]) * v.e[0] * 0.55f;
  const float cr = v.q1.process(rng_.white()) * v.e[1] * 1.6f;
  v.e[0] *= v.d[0]; v.e[1] *= v.d[1];
  if (v.e[0] < 5.0e-4f) v.active = false;
  return (body + cr) * (0.35f + 0.65f * v.vel) * 0.8f;
}

inline void RolesEngine::setupHat(Voice& v, bool open, bool pedal) {
  const float sr = sr_;
  static const float kF[6] = { 205.3f, 304.4f, 369.6f, 522.7f, 540.0f, 800.0f };
  for (int i = 0; i < 6; ++i) v.ph[i] = rng_.uni();
  for (int i = 0; i < 6; ++i) v.p[i] = kF[i] * (pedal ? 0.97f : 1.f) * (1.f + (rng_.uni() - 0.5f) * 0.01f);
  v.open = open;
  v.e[0] = 1.f;
  v.d[0] = std::exp(-1.f / (sr * (open ? 0.32f : (pedal ? 0.05f : 0.032f + v.vel * 0.014f))));
  v.q1.highpass(sr, 7200.f, 0.8f);
  v.q2.bandpass(sr, 10500.f, 0.7f);
  v.q3.highpass(sr, 4800.f, 0.707f);
  v.pan = 0.18f;
  v.e[1] = 1.f; v.d[1] = std::exp(-1.f / (sr * 0.0012f));
}
inline float RolesEngine::renderHat(Voice& v) {
  float s = 0.f;
  for (int i = 0; i < 6; ++i) {
    const float dt = v.p[i] * 2.7f / sr_;     // x2.7: zona metálica sin perder el carácter 808
    v.ph[i] += dt; if (v.ph[i] >= 1.f) v.ph[i] -= 1.f;
    s += squareBlep(v.ph[i], clampf(dt, 1.0e-4f, 0.45f));
  }
  s *= 0.16f;
  float y = v.q1.process(s);
  y += v.q2.process(s) * 0.6f;
  y += v.q3.process(rng_.white()) * 0.22f;
  y += rng_.white() * v.e[1] * 0.3f;   // chasquido de baqueta
  y *= v.e[0];
  v.e[0] *= v.d[0]; v.e[1] *= v.d[1];
  if (v.e[0] < 4.0e-4f) v.active = false;
  return y * (0.22f + 0.78f * v.vel) * 0.55f;
}

inline void RolesEngine::setupTom(Voice& v) {
  const float sr = sr_;
  static const int kP[] = { 41, 43, 45, 47, 48, 50 };
  static const float kHz[] = { 82.f, 98.f, 118.f, 138.f, 156.f, 180.f };
  float f = 100.f;
  for (int i = 0; i < 6; ++i) if (v.pitch <= kP[i]) { f = kHz[i]; break; }
  if (v.pitch > 50) f = 200.f;
  v.p[0] = f; v.p[1] = f * 0.62f;
  v.e[0] = 1.f; v.d[0] = std::exp(-1.f / (sr * (0.26f + (1.f - f / 200.f) * 0.12f)));
  v.e[1] = 1.f; v.d[1] = std::exp(-1.f / (sr * 0.045f));   // barrido
  v.e[2] = 1.f; v.d[2] = std::exp(-1.f / (sr * 0.004f));   // golpe de parche
  v.ph[0] = 0.f;
  v.q1.bandpass(sr, 2400.f, 1.2f);
  v.pan = clampf((f - 120.f) / 160.f, -0.4f, 0.4f);
}
inline float RolesEngine::renderTom(Voice& v) {
  const float f = v.p[0] * (1.f + 0.55f * v.e[1]);
  v.ph[0] += f / sr_; if (v.ph[0] >= 1.f) v.ph[0] -= 1.f;
  float s = std::sin(kTwoPi * v.ph[0]) * v.e[0];
  s += 0.25f * std::sin(kTwoPi * v.ph[0] * 1.58f) * v.e[0] * v.e[0];
  s += v.q1.process(rng_.white()) * v.e[2] * 0.5f;
  v.e[0] *= v.d[0]; v.e[1] *= v.d[1]; v.e[2] *= v.d[2];
  if (v.e[0] < 4.0e-4f) v.active = false;
  return std::tanh(s * 1.3f) * 0.6f * (0.4f + 0.6f * v.vel);
}

inline void RolesEngine::setupCymbal(Voice& v, int kind) {   // 0 crash, 1 ride, 2 splash/china
  const float sr = sr_;
  v.open = kind == 1;
  v.p[0] = static_cast<float>(kind);
  v.e[0] = 1.f; v.d[0] = std::exp(-1.f / (sr * (kind == 0 ? 1.7f : (kind == 1 ? 1.2f : 0.7f))));
  v.e[1] = 1.f; v.d[1] = std::exp(-1.f / (sr * (kind == 0 ? 3.6f : (kind == 1 ? 2.4f : 1.3f))));
  v.e[2] = 1.f; v.d[2] = std::exp(-1.f / (sr * 0.012f));
  v.q1.highpass(sr, kind == 1 ? 4200.f : 3000.f, 0.8f);
  v.q2.bandpass(sr, kind == 1 ? 7600.f : 9200.f, 0.6f);
  v.q3.lowpass(sr, 15500.f, 0.707f);
  for (int i = 0; i < 6; ++i) { v.ph[i] = rng_.uni(); v.p[1 + i] = (3100.f + 1000.f * static_cast<float>(i) + rng_.uni() * 280.f) * (kind == 1 ? 1.f : 1.15f); }
  v.pan = kind == 1 ? 0.35f : -0.3f;
}
inline float RolesEngine::renderCymbal(Voice& v) {
  const float n = rng_.white();
  float s = v.q3.process(v.q1.process(n)) * 0.65f;
  s += v.q2.process(n) * 0.9f;
  if (v.p[0] == 1.f) {
    // campana del ride: parciales inarmónicos
    float bell = 0.f;
    for (int i = 0; i < 3; ++i) { v.ph[i] += v.p[1 + i] / sr_; if (v.ph[i] >= 1.f) v.ph[i] -= 1.f; bell += std::sin(kTwoPi * v.ph[i]); }
    s += bell * 0.1f * v.e[2];
    s += bell * 0.04f * v.e[0];
  }
  const float env = v.e[0] * 0.62f + v.e[1] * 0.38f;
  const float y = s * env * (0.2f + 0.8f * v.vel) * 0.42f + n * v.e[2] * 0.12f;
  v.e[0] *= v.d[0]; v.e[1] *= v.d[1]; v.e[2] *= v.d[2];
  if (env < 4.0e-4f) v.active = false;
  return y;
}

inline void RolesEngine::setupClap(Voice& v) {
  const float sr = sr_;
  v.e[0] = 1.f; v.d[0] = std::exp(-1.f / (sr * 0.1f));
  v.p[0] = 0.f;
  v.q1.bandpass(sr, 1150.f, 1.6f);
  v.q2.highpass(sr, 600.f, 0.707f);
  v.pan = 0.f;
}
inline float RolesEngine::renderClap(Voice& v) {
  // 4 ráfagas separadas ~9 ms seguidas de la cola
  const float t = static_cast<float>(v.n) / sr_;
  float burst = 0.f;
  for (int i = 0; i < 4; ++i) {
    const float dt = t - 0.0095f * static_cast<float>(i);
    if (dt >= 0.f) burst += std::exp(-dt / 0.0035f);
  }
  const float tail = v.e[0];
  const float s = v.q2.process(v.q1.process(rng_.white())) * (burst * 0.55f + tail * 0.8f);
  v.e[0] *= v.d[0];
  if (t > 0.03f && tail < 6.0e-4f) v.active = false;
  return s * (0.3f + 0.7f * v.vel) * 0.9f;
}

inline void RolesEngine::setupShaker(Voice& v, bool tambourine) {
  const float sr = sr_;
  v.e[0] = 1.f; v.d[0] = std::exp(-1.f / (sr * (tambourine ? 0.11f : 0.05f)));
  v.e[1] = 0.f;
  v.q1.highpass(sr, tambourine ? 5500.f : 4200.f, 0.8f);
  v.q2.bandpass(sr, tambourine ? 8800.f : 6800.f, 1.1f);
  v.pan = tambourine ? 0.3f : -0.25f;
}
inline float RolesEngine::renderShaker(Voice& v) {
  const float n = rng_.white();
  const float t = static_cast<float>(v.n) / sr_;
  const float swell = t < 0.012f ? t / 0.012f : 1.f;
  const float s = (v.q1.process(n) * 0.5f + v.q2.process(n) * 0.9f) * v.e[0] * swell;
  v.e[0] *= v.d[0];
  if (v.e[0] < 5.0e-4f) v.active = false;
  return s * (0.25f + 0.75f * v.vel) * 0.55f;
}

inline void RolesEngine::setupCowbell(Voice& v) {
  const float sr = sr_;
  v.ph[0] = v.ph[1] = 0.f;
  v.e[0] = 1.f; v.d[0] = std::exp(-1.f / (sr * 0.17f));
  v.q1.bandpass(sr, 1500.f, 2.2f);
  v.pan = 0.1f;
}
inline float RolesEngine::renderCowbell(Voice& v) {
  const float d1 = 562.f / sr_, d2 = 845.f / sr_;
  v.ph[0] += d1; if (v.ph[0] >= 1.f) v.ph[0] -= 1.f;
  v.ph[1] += d2; if (v.ph[1] >= 1.f) v.ph[1] -= 1.f;
  const float s = v.q1.process(squareBlep(v.ph[0], d1) + squareBlep(v.ph[1], d2));
  v.e[0] *= v.d[0];
  if (v.e[0] < 5.0e-4f) v.active = false;
  return s * v.e[0] * (0.3f + 0.7f * v.vel) * 0.5f;
}

inline void RolesEngine::setupDrumNote(Voice& v) {
  const int p = v.pitch;
  if (p <= 36 || p == 35) { v.kind = VK::Kick; setupKick(v); }
  else if (p == 37) { v.kind = VK::Rim; setupRim(v); }
  else if (p == 38 || p == 40) { v.kind = VK::Snare; setupSnare(v); }
  else if (p == 39) { v.kind = VK::Clap; setupClap(v); }
  else if (p == 41 || p == 43 || p == 45 || p == 47 || p == 48 || p == 50) { v.kind = VK::Tom; setupTom(v); }
  else if (p == 42) { v.kind = VK::Hat; setupHat(v, false, false); }
  else if (p == 44) { v.kind = VK::Hat; setupHat(v, false, true); }
  else if (p == 46) { v.kind = VK::Hat; setupHat(v, true, false); }
  else if (p == 49 || p == 57 || p == 55 || p == 52) { v.kind = VK::Cymbal; setupCymbal(v, p == 55 ? 2 : 0); }
  else if (p == 51 || p == 53 || p == 59) { v.kind = VK::Cymbal; setupCymbal(v, 1); }
  else if (p == 54) { v.kind = VK::Shaker; setupShaker(v, true); }
  else if (p == 70 || p == 69) { v.kind = VK::Shaker; setupShaker(v, false); }
  else if (p == 56) { v.kind = VK::Cowbell; setupCowbell(v); }
  else { v.kind = VK::Tom; setupTom(v); }
}

// =====================================================================================
//  CUERDA PULSADA (bajo eléctrico / guitarra acústica)
// =====================================================================================
inline void RolesEngine::setupPluck(Voice& v, bool bass) {
  const float sr = sr_, f0 = v.f0, vel = v.vel;
  const float bright = 0.35f + cutoffN_ * 1.2f;
  const int nStr = bass ? 1 : 2;
  v.p[8] = bass ? 1.f : 0.f;
  for (int s = 0; s < nStr; ++s) {
    PluckString& st = v.str[s];
    st.clear();
    const float detune = s == 0 ? 1.f : 1.0006f;
    const float t60 = bass ? clampf(1.2f + (f0 < 80.f ? 0.5f : 0.f), 0.8f, 2.4f) * (0.5f + releaseN_ * 0.9f)
                           : clampf(2.4f * std::pow(2.f, -(static_cast<float>(v.pitch) - 40.f) / 28.f), 0.45f, 3.0f) * (0.5f + releaseN_ * 0.9f);
    // amortiguación: más brillo con velocidad alta y con el control de corte
    const float damp = clampf((bass ? 0.42f : 0.31f) - 0.12f * vel * bright * 0.7f, 0.06f, 0.48f);
    const int L = st.tune(f0 * detune, sr, damp, t60);
    // excitación: ruido filtrado + peine de posición de púa
    float lp = 0.f;
    const float cutoffA = bass ? clampf(0.02f + 0.10f * vel * bright, 0.015f, 0.4f) : clampf(0.07f + 0.30f * vel * bright, 0.05f, 0.9f);
    float mean = 0.f;
    for (int i = 0; i < L; ++i) {
      const float w = rng_.white();
      lp += (w - lp) * cutoffA;
      st.buf[static_cast<size_t>(i)] = lp;
      mean += lp;
    }
    mean /= static_cast<float>(L);
    const int pk = std::max(1, static_cast<int>(static_cast<float>(L) * (bass ? 0.22f : 0.16f)));
    for (int i = L - 1; i >= pk; --i) st.buf[static_cast<size_t>(i)] -= st.buf[static_cast<size_t>(i - pk)] * 0.85f;
    float pkAmp = 1e-6f;
    for (int i = 0; i < L; ++i) { st.buf[static_cast<size_t>(i)] -= mean; pkAmp = std::max(pkAmp, std::fabs(st.buf[static_cast<size_t>(i)])); }
    const float g = (bass ? 0.55f : 0.42f) * std::pow(vel, 1.1f) / pkAmp;
    for (int i = 0; i < L; ++i) st.buf[static_cast<size_t>(i)] *= g;
    st.active = true;
  }
  v.str[1].active = !bass;
  v.pan = bass ? 0.f : clampf((static_cast<float>(v.pitch) - 62.f) / 40.f, -0.4f, 0.4f);
  v.ph[0] = 0.f;           // sub
  v.e[0] = 1.f;
  v.d[0] = std::exp(-3.0f / ((bass ? 1.1f : 0.5f) * sr));
  v.q1.bandpass(sr, 2600.f, 1.1f);
  v.e[1] = vel * (bass ? 0.1f : 0.09f);
  v.d[1] = std::exp(-1.f / (sr * 0.006f));
  const float relSec = (bass ? 0.09f : 0.14f) * (0.5f + releaseN_);
  v.relDec = std::pow(10.f, -3.f / (relSec * sr));
}
inline float RolesEngine::renderPluck(Voice& v) {
  float s = v.str[0].tick();
  const bool bass = v.p[8] > 0.5f;
  if (!bass) s = (s + v.str[1].tick()) * 0.5f;
  // chasquido de púa/dedo
  s += v.q1.process(rng_.white()) * v.e[1];
  v.e[1] *= v.d[1];
  if (bass) {
    v.ph[0] += v.f0 / sr_; if (v.ph[0] >= 1.f) v.ph[0] -= 1.f;
    s += std::sin(kTwoPi * v.ph[0]) * v.e[0] * 0.22f * v.vel;
    v.e[0] *= v.d[0];
  }
  if (v.n > static_cast<uint32_t>(sr_ * 0.1f) && std::fabs(s) < 2.0e-6f && std::fabs(v.x1) < 2.0e-6f) {
    if (++v.seed > 2000u) v.active = false;
  } else v.seed = 0;
  v.x1 = s;
  return s;
}

// =====================================================================================
//  PAD (supersaw suave con barrido de filtro)
// =====================================================================================
inline void RolesEngine::setupPad(Voice& v) {
  const float sr = sr_;
  static const float kDet[kMaxPoly] = { -11.f, -6.f, -2.f, 0.f, 2.f, 6.f, 11.f };
  for (int i = 0; i < kMaxPoly; ++i) { v.ph[i] = rng_.uni(); v.p[i] = std::pow(2.f, kDet[i] / 1200.f); }
  v.ph[8] = rng_.uni();        // fase del LFO
  v.ph[9] = 0.f;               // sub
  const float atk = 1.1f * (0.3f + attackN_ * 2.0f);
  v.envA = 1.f / (atk * sr);
  v.env = 0.f;
  const float rel = 2.3f * (0.3f + releaseN_ * 1.75f);
  v.relDec = std::pow(10.f, -3.f / (rel * sr));
  v.s1.reset();
  v.p[8] = clampf((900.f + v.f0 * 2.2f) * (0.35f + cutoffN_ * 1.3f), 250.f, 7500.f);
  v.pan = clampf((static_cast<float>(v.pitch) - 60.f) / 50.f, -0.3f, 0.3f);
  v.x1 = 0.f;
}
inline void RolesEngine::renderPad(Voice& v, float& l, float& r) {
  const float dtBase = v.f0 / sr_;
  float a = 0.f, b = 0.f, c = 0.f;
  for (int i = 0; i < kMaxPoly; ++i) {
    const float dt = dtBase * v.p[i];
    v.ph[i] += dt; if (v.ph[i] >= 1.f) v.ph[i] -= 1.f;
    const float s = sawBlep(v.ph[i], clampf(dt, 1.0e-5f, 0.45f));
    if (i < 3) a += s; else if (i == 3) c += s; else b += s;
  }
  v.ph[9] += dtBase * 0.5f; if (v.ph[9] >= 1.f) v.ph[9] -= 1.f;
  const float sub = std::sin(kTwoPi * v.ph[9]) * 0.5f;
  v.ph[8] += 0.065f / sr_; if (v.ph[8] >= 1.f) v.ph[8] -= 1.f;
  const float lfo = std::sin(kTwoPi * v.ph[8]);
  if (v.env < 1.f && !v.releasing) v.env = std::min(1.f, v.env + v.envA);
  if ((v.n & 15u) == 0u) v.s1.set(sr_, v.p[8] * (1.f + 0.22f * lfo) * (0.6f + 0.4f * v.env), 0.6f * (0.7f + resonanceN_ * 1.6f));
  const float lo = v.s1.lowpass(c * 0.5f + sub * 0.6f + (a + b) * 0.2f);   // cuerpo
  const float la = (a * 0.33f + c * 0.25f);
  const float lb = (b * 0.33f + c * 0.25f);
  // lados con filtro propio (aprox.: el mismo lowpass sobre la mezcla de cada lado)
  const float dark = 0.55f + 0.45f * (1.f - 0.5f * (1.f - v.env));
  const float outL = lo * 0.6f + la * dark * 0.4f;
  const float outR = lo * 0.6f + lb * dark * 0.4f;
  const float g = v.env * v.relGain * v.vel * 0.42f;
  l += outL * g * 1.1f;
  r += outR * g * 1.1f;
}

// =====================================================================================
//  CUERDAS (ensemble: 4 sierras, vibrato retardado, formantes de caja)
// =====================================================================================
inline void RolesEngine::setupStrings(Voice& v) {
  const float sr = sr_;
  static const float kDet[4] = { -12.f, -4.f, 4.f, 12.f };
  for (int i = 0; i < 4; ++i) { v.ph[i] = rng_.uni(); v.p[i] = std::pow(2.f, kDet[i] / 1200.f); }
  v.ph[6] = rng_.uni() * kTwoPi;     // fase del vibrato (rad)
  v.p[6] = 4.9f + rng_.uni() * 0.9f; // Hz
  const float atk = 0.32f * (0.3f + attackN_ * 2.0f);
  v.envA = 1.f / (atk * sr);
  v.env = 0.f;
  const float rel = 0.8f * (0.3f + releaseN_ * 1.75f);
  v.relDec = std::pow(10.f, -3.f / (rel * sr));
  v.s1.reset();
  v.q1.peaking(sr, 560.f, 1.1f, 3.5f);
  v.q2.peaking(sr, 2300.f, 1.0f, 3.f);
  v.p[7] = clampf((2600.f + v.f0 * 3.f) * (0.35f + cutoffN_ * 1.3f), 800.f, 9000.f);
  v.pan = clampf((static_cast<float>(v.pitch) - 62.f) / 45.f, -0.35f, 0.35f);
}
inline void RolesEngine::renderStrings(Voice& v, float& l, float& r) {
  const float t = static_cast<float>(v.n) / sr_;
  const float vibDepth = 6.f * std::min(1.f, std::max(0.f, (t - 0.25f) / 0.6f));
  const float vib = vibrato(vibDepth, v.p[6], t, v.ph[6]);
  const float dtBase = v.f0 * vib / sr_;
  float a = 0.f, b = 0.f;
  for (int i = 0; i < 4; ++i) {
    const float dt = dtBase * v.p[i];
    v.ph[i] += dt; if (v.ph[i] >= 1.f) v.ph[i] -= 1.f;
    const float s = sawBlep(v.ph[i], clampf(dt, 1.0e-5f, 0.45f));
    if (i < 2) a += s; else b += s;
  }
  if (v.env < 1.f && !v.releasing) v.env = std::min(1.f, v.env + v.envA);
  // arco: sube el brillo con la envolvente
  if ((v.n & 15u) == 0u) v.s1.set(sr_, v.p[7] * (0.45f + 0.55f * v.env), 0.7f);
  const float bow = rng_.white() * 0.012f * v.env;
  float mid = (a + b) * 0.25f + bow;
  mid = v.q2.process(v.q1.process(v.s1.lowpass(mid)));
  const float sideL = a * 0.18f, sideR = b * 0.18f;
  const float g = v.env * v.relGain * v.vel * 0.5f;
  l += (mid + sideL * v.env * 0.5f) * g;
  r += (mid + sideR * v.env * 0.5f) * g;
}

// =====================================================================================
//  VOZ / CORO (fuente glotal band-limited + 3 formantes), también usada como "voz guía"
// =====================================================================================
inline void RolesEngine::setupVoiceLike(Voice& v, bool choir) {
  const float sr = sr_;
  v.p[8] = choir ? 1.f : 0.f;
  v.ph[0] = rng_.uni(); v.ph[1] = rng_.uni(); v.ph[2] = rng_.uni();
  v.ph[6] = rng_.uni() * kTwoPi;
  v.p[6] = 5.2f + rng_.uni() * 0.5f;
  const float atk = (choir ? 0.38f : 0.06f) * (0.3f + attackN_ * 2.0f);
  v.envA = 1.f / (atk * sr);
  v.env = 0.f;
  const float rel = (choir ? 0.9f : 0.22f) * (0.3f + releaseN_ * 1.75f);
  v.relDec = std::pow(10.f, -3.f / (rel * sr));
  // vocal "aa" (voz de tenor/soprano) o "oo" para coro; los formantes suben con la tesitura
  const float reg = clampf((static_cast<float>(v.pitch) - 55.f) / 30.f, 0.f, 1.f);
  const float shift = 1.f + 0.18f * reg;
  const float f1 = (choir ? 330.f : 730.f) * shift, f2 = (choir ? 900.f : 1150.f) * shift, f3 = (choir ? 2300.f : 2600.f) * shift;
  v.s1.set(sr, f1, 7.f); v.s2.set(sr, f2, 9.f); v.s3.set(sr, f3, 11.f);
  v.s1.reset(); v.s2.reset(); v.s3.reset();
  v.q1.lowpass(sr, clampf(5500.f * (0.4f + cutoffN_), 1800.f, 10000.f), 0.707f);
  v.q2.highpass(sr, 120.f, 0.707f);
  v.pan = choir ? clampf((rng_.uni() - 0.5f) * 0.5f, -0.25f, 0.25f) : 0.f;
}
inline void RolesEngine::renderVoiceLike(Voice& v, float& l, float& r) {
  const bool choir = v.p[8] > 0.5f;
  const float t = static_cast<float>(v.n) / sr_;
  const float vibDepth = (choir ? 5.f : 8.f) * std::min(1.f, std::max(0.f, (t - (choir ? 0.4f : 0.18f)) / 0.45f));
  const float jitter = 1.f + (rng_.white()) * 0.0006f;
  const float dtBase = v.f0 * vibrato(vibDepth, v.p[6], t, v.ph[6]) * jitter / sr_;
  float src = 0.f;
  const int nv = choir ? 3 : 2;
  static const float kDet[3] = { 1.f, 1.0045f, 0.9958f };
  for (int i = 0; i < nv; ++i) {
    const float dt = dtBase * kDet[i];
    v.ph[i] += dt; if (v.ph[i] >= 1.f) v.ph[i] -= 1.f;
    // fuente glotal aproximada: diente de sierra suavizado + pulso estrecho
    const float saw = sawBlep(v.ph[i], clampf(dt, 1.0e-5f, 0.45f));
    src += saw * 0.65f + squareBlep(v.ph[i], clampf(dt, 1.0e-5f, 0.45f), 0.28f) * 0.3f;
  }
  src /= static_cast<float>(nv);
  src += rng_.white() * 0.03f;   // aire
  if (v.env < 1.f && !v.releasing) v.env = std::min(1.f, v.env + v.envA);
  const float y1 = v.s1.process(src).bp, y2 = v.s2.process(src).bp, y3 = v.s3.process(src).bp;
  float s = y1 * 1.f + y2 * 0.55f + y3 * 0.28f;
  s = v.q2.process(v.q1.process(s));
  const float g = v.env * v.relGain * v.vel * (choir ? 0.55f : 0.62f);
  pan2(s * g, v.pan, l, r);
}

// =====================================================================================
//  METALES y SINTETIZADOR
// =====================================================================================
inline void RolesEngine::setupBrass(Voice& v) {
  const float sr = sr_;
  v.ph[0] = rng_.uni(); v.ph[1] = rng_.uni();
  v.p[0] = 1.0035f; v.p[1] = 0.9965f;
  v.ph[6] = rng_.uni() * kTwoPi;
  const float atk = 0.07f * (0.3f + attackN_ * 2.0f);
  v.envA = 1.f / (atk * sr);
  v.env = 0.f;
  const float rel = 0.22f * (0.3f + releaseN_ * 1.75f);
  v.relDec = std::pow(10.f, -3.f / (rel * sr));
  v.s1.reset();
  v.p[7] = (1600.f + v.vel * 3200.f) * (0.35f + cutoffN_ * 1.3f);
  v.pan = clampf((static_cast<float>(v.pitch) - 62.f) / 60.f, -0.25f, 0.25f);
}
inline void RolesEngine::renderBrass(Voice& v, float& l, float& r) {
  const float t = static_cast<float>(v.n) / sr_;
  const float vib = vibrato(std::min(1.f, t * 1.2f) * 4.f, 5.4f, t, v.ph[6]);
  const float dtBase = v.f0 * vib / sr_;
  float s = 0.f;
  for (int i = 0; i < 2; ++i) {
    const float dt = dtBase * v.p[i];
    v.ph[i] += dt; if (v.ph[i] >= 1.f) v.ph[i] -= 1.f;
    s += sawBlep(v.ph[i], clampf(dt, 1.0e-5f, 0.45f));
  }
  s *= 0.5f;
  if (v.env < 1.f && !v.releasing) v.env = std::min(1.f, v.env + v.envA);
  // "blat": el filtro se abre rápido y se asienta
  const float open = 0.55f + 0.45f * std::exp(-t / 0.12f);
  if ((v.n & 15u) == 0u) v.s1.set(sr_, v.p[7] * (0.35f + open * v.env), 0.9f * (0.7f + resonanceN_ * 1.2f));
  s = v.s1.lowpass(s);
  pan2(s * v.env * v.relGain * v.vel * 0.55f, v.pan, l, r);
}

inline void RolesEngine::setupSynth(Voice& v) {
  const float sr = sr_;
  v.ph[0] = rng_.uni(); v.ph[1] = rng_.uni(); v.ph[2] = rng_.uni();
  v.p[0] = 1.004f; v.p[1] = 0.996f;
  const float atk = 0.012f * (0.3f + attackN_ * 2.0f);
  v.envA = 1.f / (atk * sr);
  v.env = 0.f;
  const float rel = 0.35f * (0.3f + releaseN_ * 1.75f);
  v.relDec = std::pow(10.f, -3.f / (rel * sr));
  v.s1.reset();
  v.p[7] = (1200.f + v.vel * 4200.f) * (0.35f + cutoffN_ * 1.3f);
  v.pan = clampf((static_cast<float>(v.pitch) - 60.f) / 60.f, -0.3f, 0.3f);
}
inline void RolesEngine::renderSynth(Voice& v, float& l, float& r) {
  const float t = static_cast<float>(v.n) / sr_;
  const float dtBase = v.f0 / sr_;
  float s = 0.f;
  for (int i = 0; i < 2; ++i) {
    const float dt = dtBase * v.p[i];
    v.ph[i] += dt; if (v.ph[i] >= 1.f) v.ph[i] -= 1.f;
    s += sawBlep(v.ph[i], clampf(dt, 1.0e-5f, 0.45f));
  }
  v.ph[2] += dtBase * 0.5f; if (v.ph[2] >= 1.f) v.ph[2] -= 1.f;
  s = s * 0.4f + std::sin(kTwoPi * v.ph[2]) * 0.35f;
  if (v.env < 1.f && !v.releasing) v.env = std::min(1.f, v.env + v.envA);
  const float fenv = 0.25f + 0.75f * std::exp(-t / 0.35f);
  if ((v.n & 15u) == 0u) v.s1.set(sr_, v.p[7] * fenv + 180.f, 0.8f * (0.7f + resonanceN_ * 1.4f));
  s = v.s1.lowpass(s);
  pan2(s * v.env * v.relGain * v.vel * 0.5f * std::exp(-t / 2.5f * 0.35f), v.pan, l, r);
}

// =====================================================================================
//  Notas
// =====================================================================================
inline void RolesEngine::noteOn(int16_t pitch, float velocity, int32_t) {
  if (!filtersBuilt_) rebuildBusFilters();
  const Role role = role_;
  const bool drums = role == Role::Drums || role == Role::Percussion;
  // choke: el hat cerrado / pedal corta el hat abierto
  if (drums && (pitch == 42 || pitch == 44)) {
    for (auto& o : voices_) if (o.active && o.kind == VK::Hat && o.open) { o.releasing = true; o.relDec = std::pow(10.f, -3.f / (0.02f * sr_)); }
  }
  // misma nota repetida en instrumentos tonales: se reutiliza (retrigger)
  const int32_t idx = allocVoice(role);
  Voice& v = voices_[static_cast<size_t>(idx)];
  killVoice(v);
  v.active = true;
  v.releasing = false;
  v.pitch = pitch;
  v.vel = clampf(velocity, 0.04f, 1.f);
  v.role = role;
  v.age = ++ageCounter_;
  v.n = 0;
  v.relGain = 1.f;
  v.relDec = 0.999f;
  v.f0 = midiToHz(static_cast<float>(pitch));
  v.x1 = 0.f; v.seed = 0;
  v.gain = 1.f;
  for (auto& e : v.e) e = 0.f;
  for (auto& d : v.d) d = 0.f;
  switch (role) {
    case Role::Drums: case Role::Percussion: setupDrumNote(v); break;
    case Role::Bass: v.kind = VK::Pluck; setupPluck(v, true); break;
    case Role::Guitar: v.kind = VK::Pluck; setupPluck(v, false); break;
    case Role::Piano: v.kind = VK::Piano; setupPiano(v); break;
    case Role::Keys: v.kind = VK::EPiano; setupEPiano(v); break;
    case Role::Pad: v.kind = VK::Pad; setupPad(v); break;
    case Role::Strings: v.kind = VK::Strings; setupStrings(v); break;
    case Role::Choir: v.kind = VK::Choir; setupVoiceLike(v, true); break;
    case Role::Lead: v.kind = VK::Lead; setupVoiceLike(v, false); break;
    case Role::Brass: v.kind = VK::Brass; setupBrass(v); break;
    default: v.kind = VK::Synth; setupSynth(v); break;
  }
}

inline void RolesEngine::noteOff(int16_t pitch, int32_t) {
  for (auto& v : voices_) {
    if (!v.active || v.pitch != pitch || v.releasing) continue;
    switch (v.kind) {
      case VK::Kick: case VK::Snare: case VK::Rim: case VK::Tom: case VK::Cymbal: case VK::Clap: case VK::Shaker: case VK::Cowbell: case VK::Hat:
        break;   // los golpes de batería suenan completos
      default:
        v.releasing = true;
        break;
    }
  }
}

// =====================================================================================
//  Render
// =====================================================================================
inline void RolesEngine::renderVoice(Voice& v, float& l, float& r, float& gtrL, float& gtrR, float& bass) {
  switch (v.kind) {
    case VK::Piano: renderPiano(v, l, r); break;
    case VK::EPiano: renderEPiano(v, l, r); break;
    // ganancias de equilibrio de la batería (calibradas con roles_render --cal)
    case VK::Kick: pan2(renderKick(v) * 0.58f, v.pan, l, r); break;
    case VK::Snare: pan2(renderSnare(v) * 0.5f, v.pan, l, r); break;
    case VK::Rim: pan2(renderRim(v) * 0.35f, v.pan, l, r); break;
    case VK::Hat: pan2(renderHat(v) * v.relGain * (v.open ? 0.5f : 0.4f), v.pan, l, r); break;
    case VK::Tom: pan2(renderTom(v) * 0.47f, v.pan, l, r); break;
    case VK::Cymbal: pan2(renderCymbal(v) * (v.open ? 0.18f : 0.25f), v.pan, l, r); break;
    case VK::Clap: pan2(renderClap(v) * 0.7f, v.pan, l, r); break;
    case VK::Shaker: pan2(renderShaker(v) * 0.16f, v.pan, l, r); break;
    case VK::Cowbell: pan2(renderCowbell(v) * 0.25f, v.pan, l, r); break;
    case VK::Pluck: {
      const float s = renderPluck(v) * v.relGain;
      if (v.p[8] > 0.5f) bass += s;
      else pan2(s, v.pan, gtrL, gtrR);
      break;
    }
    case VK::Pad: renderPad(v, l, r); break;
    case VK::Strings: renderStrings(v, l, r); break;
    case VK::Choir: case VK::Lead: renderVoiceLike(v, l, r); break;
    case VK::Brass: renderBrass(v, l, r); break;
    case VK::Synth: renderSynth(v, l, r); break;
    default: v.active = false; break;
  }
  ++v.n;
  if (v.releasing) {
    v.relGain *= v.relDec;
    if (v.relGain < 1.0e-4f) v.active = false;
  }
}

inline void RolesEngine::render(float* L, float* R, int32_t numSamples) {
  if (eqDirty_) rebuildBusFilters();
  const float sr = sr_;
  // calibración por rol (dB) tras medir con renderizador offline
  float trimDb = 0.f;
  switch (role_) {
    case Role::Drums: case Role::Percussion: trimDb = -9.f; break;
    case Role::Bass: trimDb = -8.5f; break;
    case Role::Guitar: trimDb = -4.2f; break;
    case Role::Piano: trimDb = -0.8f; break;
    case Role::Keys: trimDb = -15.3f; break;
    case Role::Pad: trimDb = -20.f; break;
    case Role::Strings: trimDb = -22.f; break;
    case Role::Choir: trimDb = -22.f; break;
    case Role::Lead: trimDb = -14.8f; break;
    case Role::Brass: trimDb = -19.6f; break;
    default: trimDb = -20.f; break;
  }
  const float trim = dbToLin(trimDb + (gainN_ - 0.7f) * 24.f);
  const float tgtRev = reverbN_ * 0.55f, tgtDly = delayN_, tgtChr = chorusN_;
  const float driveK = 1.f + driveN_ * 4.f;
  const float driveNorm = 1.f / std::tanh(driveK);
  const int dlyMax = static_cast<int>(delayL_.b.size()) - 4;
  float dlySamples = tempo_ > 0.f ? (60.f / tempo_) * 0.75f * sr : (0.12f + delayN_ * 0.45f) * sr;
  dlySamples = clampf(dlySamples, 8.f, static_cast<float>(dlyMax));
  const float fbAmt = 0.32f + delayN_ * 0.28f;
  const float gateThr = gateN_ * gateN_ * 0.2f;

  for (int32_t i = 0; i < numSamples; ++i) {
    float l = 0.f, r = 0.f, gl = 0.f, gr = 0.f, bs = 0.f;
    for (auto& v : voices_) if (v.active) renderVoice(v, l, r, gl, gr, bs);

    // cuerpo de guitarra (4 resonancias en paralelo) y EQ del bajo
    if (role_ == Role::Guitar) {
      const float inL = gtrHpL_.process(gl), inR = gtrHpR_.process(gr);
      float bl = 0.f, br = 0.f;
      static const float kG[4] = { 0.5f, 0.42f, 0.2f, 0.12f };
      for (size_t k = 0; k < 4; ++k) { bl += gtrBodyL_[k].process(inL) * kG[k]; br += gtrBodyR_[k].process(inR) * kG[k]; }
      l += gtrLpL_.process(inL + bl * 0.8f);
      r += gtrLpR_.process(inR + br * 0.8f);
    } else if (role_ == Role::Bass) {
      float b = bs;
      for (auto& e : bassEq_) b = e.process(b);
      l += b; r += b;
    }
    if (role_ == Role::Piano) {
      for (auto& e : pnoEqL_) l = e.process(l);
      for (auto& e : pnoEqR_) r = e.process(r);
    }

    l *= trim; r *= trim;

    // EQ de usuario
    l = eqHighL_.process(eqLowL_.process(l));
    r = eqHighR_.process(eqLowR_.process(r));

    // saturación suave
    if (driveN_ > 0.002f) {
      l = std::tanh(l * driveK) * driveNorm;
      r = std::tanh(r * driveK) * driveNorm;
    }

    // puerta suave
    if (gateN_ > 0.002f) {
      const float pk = std::max(std::fabs(l), std::fabs(r));
      const float tg = pk >= gateThr ? 1.f : (1.f - gateN_ * 0.9f);
      gateEnv_ += (tg - gateEnv_) * (pk >= gateThr ? 0.15f : 0.004f);
      l *= gateEnv_; r *= gateEnv_;
    }

    // suavizado de los envíos de efecto
    wetChr_ += (tgtChr - wetChr_) * 0.001f;
    wetDly_ += (tgtDly - wetDly_) * 0.001f;
    wetRev_ += (tgtRev - wetRev_) * 0.001f;

    if (wetChr_ > 0.002f) {
      float cl, cr;
      chorus_.process(l, r, wetChr_ * 0.8f, cl, cr);
      l = cl; r = cr;
    }

    float dl = l, dr = r;
    if (wetDly_ > 0.002f) {
      const float tl = delayL_.read(dlySamples), tr = delayR_.read(dlySamples * 1.0f);
      // ping-pong: el retorno de un canal alimenta al otro, con filtros en el lazo
      const float inL = dlyHpL_.process(dlyLpL_.process(l + fbR_ * fbAmt));
      const float inR = dlyHpR_.process(dlyLpR_.process(r + fbL_ * fbAmt));
      delayL_.push(inL);
      delayR_.push(inR);
      fbL_ = tl; fbR_ = tr;
      dl = l + tl * wetDly_ * 0.55f;
      dr = r + tr * wetDly_ * 0.55f;
    }

    float rl = 0.f, rr = 0.f;
    if (wetRev_ > 0.002f) reverb_.process(dl, dr, rl, rr);
    else { float a, b; reverb_.process(0.f, 0.f, a, b); (void)a; (void)b; }
    float ol = dl + rl * wetRev_ * 1.4f;
    float orr = dr + rr * wetRev_ * 1.4f;

    ol = dcL_.process(ol);
    orr = dcR_.process(orr);
    // limitador suave de seguridad (solo si excede)
    const float a = std::fabs(ol), b = std::fabs(orr);
    if (a > 0.9f) ol = (ol > 0.f ? 1.f : -1.f) * (0.9f + 0.1f * std::tanh((a - 0.9f) * 6.f));
    if (b > 0.9f) orr = (orr > 0.f ? 1.f : -1.f) * (0.9f + 0.1f * std::tanh((b - 0.9f) * 6.f));
    L[i] = ol;
    R[i] = orr;
  }
}

} // namespace JasWaveRoles
