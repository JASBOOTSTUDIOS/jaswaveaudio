// =====================================================================================
//  JasWave Ambience – rack worship (reverb de hall FDN, delay sincronizado, shimmer, swell, chorus,
//  trémolo, compresor, drive ADAA, EQ y ancho estéreo). Portado conceptualmente de "Jasboot FX"
//  (módulos, presets y envolvente de ataque) con DSP nuevo: reverb FDN modulada en lugar de Freeverb,
//  delay con interpolación Hermite y LFO por muestra, shimmer granular con crossfade, drive sin aliasing.
// =====================================================================================
#pragma once

#include "../../com.jaswave.plugin.roles-vst/src/roles_dsp.h"

namespace JasWaveAmbience {

using namespace JasWaveRoles::dsp;

// ---- parámetros del motor (valores planos) -------------------------------------------------------------------
struct Settings {
  bool bypass{false};
  float inDb{0.f}, outDb{0.f};
  // reverb
  float revMix{0.f}, revSize{2.4f}, revDamp{0.4f}, revWidth{1.f}, revPre{20.f}, revLow{120.f}, revHigh{10000.f}, revMod{0.3f}, revAttack{0.f};
  bool freeze{false};
  // delay
  float dlyMix{0.f}, dlyMs{480.f}, dlyFb{0.35f}, dlyTone{0.5f}, dlyMod{0.2f}, dlyAttack{0.f};
  int dlyNote{0};          // 0 libre, 1 1/2, 2 1/4, 3 1/4., 4 1/8., 5 1/8, 6 1/8T, 7 1/16
  bool pingPong{true};
  // shimmer
  float shMix{0.f}, shSize{0.5f}, shBlend{0.6f}, shTone{0.6f}, shAttack{0.f};
  int shInterval{0};       // 0 +12, 1 +7, 2 +19, 3 -12
  // dinámica
  float swellAttack{900.f}, swellDepth{0.f}, comp{0.f};
  float tremMix{0.f}, tremRate{4.5f}, tremDepth{0.5f};
  // tono
  float drive{0.f}, driveTone{0.5f}, driveLevel{0.5f};
  float chorusMix{0.f}, chorusRate{0.45f}, chorusDepth{0.5f};
  // mezcla
  float eqLow{0.f}, eqMid{0.f}, eqHigh{0.f};
  float width{1.f}, bassMono{0.f};
};

inline float noteBeats(int note) {
  switch (note) {
    case 1: return 2.f;
    case 2: return 1.f;
    case 3: return 1.5f;
    case 4: return 0.75f;
    case 5: return 0.5f;
    case 6: return 1.f / 3.f;
    case 7: return 0.25f;
    default: return 0.f;
  }
}

// ---- detector de arranque de señal (para swell y para la rampa de ataque del efecto) -------------------------------
struct OnsetRamp {
  float env{0.f}, ramp{1.f}, quiet{1.f};   // quiet = segundos en silencio
  bool armed{true};
  /** Devuelve la ganancia de rampa 0..1. attackMs = 0 → siempre 1. */
  inline float tick(float inAbs, float sr, float attackMs) {
    const float a = inAbs > env ? 0.2f : 0.0004f;
    env += (inAbs - env) * a;
    const bool signal = env > 0.003f;   // ≈ −50 dBFS
    if (!signal) {
      quiet += 1.f / sr;
      if (quiet > 0.35f) { armed = true; }
    } else {
      if (armed && quiet > 0.35f) { ramp = 0.f; }   // arranque tras silencio: la rampa empieza de cero
      armed = false;
      quiet = 0.f;
    }
    if (attackMs <= 1.f) { ramp = 1.f; return 1.f; }
    if (ramp < 1.f) ramp = std::min(1.f, ramp + 1.f / (attackMs * 0.001f * sr));
    return ramp;
  }
};

// ---- retardo con interpolación Hermite ----------------------------------------------------------------------------
inline float hermiteRead(const DelayLine& d, float delay) {
  const float rp = static_cast<float>(d.w) - delay;
  const float fl = std::floor(rp);
  const int i1 = static_cast<int>(fl) & d.mask;
  const float fr = rp - fl;
  const float a = d.b[static_cast<size_t>((i1 - 1) & d.mask)], b = d.b[static_cast<size_t>(i1)];
  const float c = d.b[static_cast<size_t>((i1 + 1) & d.mask)], e = d.b[static_cast<size_t>((i1 + 2) & d.mask)];
  const float c1 = 0.5f * (c - a), c2 = a - 2.5f * b + 2.f * c - 0.5f * e, c3 = 0.5f * (e - a) + 1.5f * (b - c);
  return ((c3 * fr + c2) * fr + c1) * fr + b;
}

// ---- pitch shifter granular de dos ventanas (octava / quinta) -----------------------------------------------------
class GrainShifter {
public:
  void prepare(float sr) { sr_ = sr; win_ = 0.065f * sr; buf_.alloc(static_cast<int>(win_ * 2.f) + 8); }
  void clear() { buf_.clear(); phase_ = 0.f; }
  inline float process(float x, float ratio) {
    buf_.push(x);
    phase_ += (ratio - 1.f) / win_;
    if (phase_ >= 1.f) phase_ -= 1.f;
    if (phase_ < 0.f) phase_ += 1.f;
    const float p2 = phase_ + 0.5f >= 1.f ? phase_ - 0.5f : phase_ + 0.5f;
    const float d1 = win_ * (1.f - phase_) + 2.f, d2 = win_ * (1.f - p2) + 2.f;
    const float g1 = std::sin(kPi * phase_), g2 = std::sin(kPi * p2);
    return hermiteRead(buf_, d1) * g1 * g1 + hermiteRead(buf_, d2) * g2 * g2;
  }
private:
  float sr_{48000.f}, win_{3000.f}, phase_{0.f};
  DelayLine buf_;
};

// ---- distorsión tanh con anti-aliasing de primer orden (ADAA) ----------------------------------------------------
struct AdaaTanh {
  float x1{0.f}, f1{0.f};
  static inline float F(float x) { const float a = std::fabs(x); return a + std::log1p(std::exp(-2.f * a)) - 0.693147f; }
  inline float process(float x) {
    const float f = F(x), dx = x - x1;
    const float y = std::fabs(dx) < 1.0e-4f ? std::tanh(0.5f * (x + x1)) : (f - f1) / dx;
    x1 = x; f1 = f;
    return y;
  }
};

class Engine {
public:
  void prepare(float sr) {
    sr_ = sr;
    reverb_.prepare(sr);
    shL_.prepare(sr); shR_.prepare(sr);
    dlL_.alloc(static_cast<int>(sr * 2.7f)); dlR_.alloc(static_cast<int>(sr * 2.7f));
    chL_.alloc(static_cast<int>(sr * 0.06f)); chR_.alloc(static_cast<int>(sr * 0.06f));
    dirty_ = true;
    clear();
  }
  void clear() {
    reverb_.clear(); shL_.clear(); shR_.clear(); dlL_.clear(); dlR_.clear(); chL_.clear(); chR_.clear();
    for (auto* b : { &eqLowL_, &eqLowR_, &eqMidL_, &eqMidR_, &eqHighL_, &eqHighR_, &hpDrvL_, &hpDrvR_, &lpDrvL_, &lpDrvR_, &dlyLpL_, &dlyLpR_, &shLpL_, &shLpR_, &bmL_, &bmR_, &dcL_, &dcR_ }) b->reset();
    fbL_ = fbR_ = shFb_ = 0.f; compEnv_ = 0.f; compGain_ = 1.f; lfoCh_ = lfoDly_ = lfoTrem_ = 0.f;
    onsetDly_ = OnsetRamp{}; onsetRev_ = OnsetRamp{}; onsetSh_ = OnsetRamp{}; swellOn_ = OnsetRamp{};
    adL_ = AdaaTanh{}; adR_ = AdaaTanh{};
  }
  void setTempo(double bpm) { tempo_ = (bpm > 20.0 && bpm < 400.0) ? static_cast<float>(bpm) : 0.f; }
  void set(const Settings& s) { s_ = s; dirty_ = true; }

  void process(const float* inL, const float* inR, float* outL, float* outR, int n);

  float lastReverbLevel() const { return revMeter_; }
  float lastDelayLevel() const { return dlyMeter_; }

private:
  void rebuild();
  float sr_{48000.f};
  Settings s_;
  bool dirty_{true};
  float tempo_{0.f};
  FdnReverb reverb_;
  GrainShifter shL_, shR_;
  DelayLine dlL_, dlR_, chL_, chR_;
  Biquad eqLowL_, eqLowR_, eqMidL_, eqMidR_, eqHighL_, eqHighR_, hpDrvL_, hpDrvR_, lpDrvL_, lpDrvR_, dlyLpL_, dlyLpR_, shLpL_, shLpR_, bmL_, bmR_, dcL_, dcR_;
  AdaaTanh adL_, adR_;
  OnsetRamp onsetDly_, onsetRev_, onsetSh_, swellOn_;
  float fbL_{0.f}, fbR_{0.f}, shFb_{0.f}, compEnv_{0.f}, compGain_{1.f};
  float lfoCh_{0.f}, lfoDly_{0.f}, lfoTrem_{0.f};
  float wetRev_{0.f}, wetDly_{0.f}, wetSh_{0.f}, wetChr_{0.f}, wetTrem_{0.f}, drvAmt_{0.f};
  float revMeter_{0.f}, dlyMeter_{0.f};
  float bypassMix_{1.f};
};

inline void Engine::rebuild() {
  reverb_.setDecay(s_.revSize, s_.revDamp);
  reverb_.setPreDelayMs(s_.revPre);
  reverb_.setInputFilters(s_.revLow, s_.revHigh);
  reverb_.setModDepth(0.6f + s_.revMod * 5.f);
  reverb_.setFreeze(s_.freeze);
  for (int c = 0; c < 2; ++c) {
    (c ? eqLowR_ : eqLowL_).lowShelf(sr_, 120.f, s_.eqLow);
    (c ? eqMidR_ : eqMidL_).peaking(sr_, 1200.f, 1.0f, s_.eqMid);
    (c ? eqHighR_ : eqHighL_).highShelf(sr_, 6000.f, s_.eqHigh);
    (c ? hpDrvR_ : hpDrvL_).highpass(sr_, 620.f, 0.707f);
    (c ? lpDrvR_ : lpDrvL_).lowpass(sr_, 1600.f + s_.driveTone * 9000.f, 0.707f);
    (c ? dlyLpR_ : dlyLpL_).lowpass(sr_, 1500.f + s_.dlyTone * 9500.f, 0.707f);
    (c ? shLpR_ : shLpL_).lowpass(sr_, 2500.f + s_.shTone * 9000.f, 0.707f);
    (c ? bmR_ : bmL_).lowpass(sr_, std::max(30.f, s_.bassMono), 0.707f);
    (c ? dcR_ : dcL_).highpass(sr_, 20.f, 0.707f);
  }
  dirty_ = false;
}

inline void Engine::process(const float* inL, const float* inR, float* outL, float* outR, int n) {
  if (dirty_) rebuild();
  const float inG = dbToLin(s_.inDb), outG = dbToLin(s_.outDb);
  // tiempo de delay (sincronizado al tempo del host si procede)
  float dlyMs = s_.dlyMs;
  if (s_.dlyNote > 0 && tempo_ > 0.f) dlyMs = noteBeats(s_.dlyNote) * 60000.f / tempo_;
  const float dlySamples = clampf(dlyMs * 0.001f * sr_, 8.f, sr_ * 2.6f);
  const float fb = clampf(s_.dlyFb, 0.f, 0.9f);
  const float shRatio = s_.shInterval == 1 ? 1.4983f : s_.shInterval == 2 ? 2.9966f : s_.shInterval == 3 ? 0.5f : 2.f;
  const float compThr = -8.f - 32.f * s_.comp, compRatio = 1.5f + 6.5f * s_.comp, compMakeup = dbToLin((-compThr) * (1.f - 1.f / compRatio) * 0.42f);
  const float cAtk = std::exp(-1.f / (0.012f * sr_)), cRel = std::exp(-1.f / (0.16f * sr_));
  const float driveG = 1.f + 38.f * s_.drive * s_.drive;
  const float lvl = 0.35f + s_.driveLevel * 1.3f;
  const float swellDepth = s_.swellDepth;
  const int chBase = static_cast<int>(0.016f * sr_);
  const float chDepth = (0.0016f + 0.0032f * s_.chorusDepth) * sr_;
  const float tgtRev = s_.revMix * 1.15f, tgtDly = s_.dlyMix, tgtSh = s_.shMix, tgtChr = s_.chorusMix, tgtTrem = s_.tremMix;
  const float byTarget = s_.bypass ? 0.f : 1.f;
  float revAcc = 0.f, dlyAcc = 0.f;

  for (int i = 0; i < n; ++i) {
    bypassMix_ += (byTarget - bypassMix_) * 0.002f;
    const float dryL = inL[i], dryR = inR[i];
    float l = dryL * inG, r = dryR * inG;
    const float mono = std::fabs(l) > std::fabs(r) ? std::fabs(l) : std::fabs(r);

    // 1) swell (volumen que sube al atacar tras un silencio)
    if (swellDepth > 0.001f) {
      const float g = swellOn_.tick(mono, sr_, s_.swellAttack);
      const float gain = 1.f - swellDepth * (1.f - g);
      l *= gain; r *= gain;
    }
    // 2) compresor
    if (s_.comp > 0.002f) {
      const float lvlDb = 20.f * std::log10(std::max(1.0e-5f, std::max(std::fabs(l), std::fabs(r))));
      const float over = lvlDb - compThr;
      const float target = over > 0.f ? std::pow(10.f, -(over * (1.f - 1.f / compRatio)) / 20.f) : 1.f;
      compGain_ = target < compGain_ ? target + (compGain_ - target) * cAtk : target + (compGain_ - target) * cRel;
      l *= compGain_ * compMakeup; r *= compGain_ * compMakeup;
    }
    // 3) drive (TS: paso alto antes, tanh ADAA, tono, mezcla con el seco para conservar graves)
    drvAmt_ += (s_.drive - drvAmt_) * 0.002f;
    if (drvAmt_ > 0.003f) {
      const float dl = lpDrvL_.process(adL_.process(hpDrvL_.process(l) * driveG)) * 0.55f * lvl;
      const float dr = lpDrvR_.process(adR_.process(hpDrvR_.process(r) * driveG)) * 0.55f * lvl;
      const float m = clampf(drvAmt_ * 1.6f, 0.f, 1.f);
      l = l * (1.f - m * 0.65f) + dl * m;
      r = r * (1.f - m * 0.65f) + dr * m;
    }
    // 4) EQ
    l = eqHighL_.process(eqMidL_.process(eqLowL_.process(l)));
    r = eqHighR_.process(eqMidR_.process(eqLowR_.process(r)));
    // 5) chorus estéreo
    wetChr_ += (tgtChr - wetChr_) * 0.001f;
    if (wetChr_ > 0.003f) {
      chL_.push(l); chR_.push(r);
      lfoCh_ += kTwoPi * s_.chorusRate / sr_;
      if (lfoCh_ > kTwoPi) lfoCh_ -= kTwoPi;
      const float wl = hermiteRead(chL_, static_cast<float>(chBase) + std::sin(lfoCh_) * chDepth + 2.f);
      const float wr = hermiteRead(chR_, static_cast<float>(chBase) + std::sin(lfoCh_ + 1.9f) * chDepth + 2.f);
      l = l * (1.f - 0.3f * wetChr_) + wl * wetChr_ * 0.7f;
      r = r * (1.f - 0.3f * wetChr_) + wr * wetChr_ * 0.7f;
    }
    // 6) trémolo
    wetTrem_ += (tgtTrem - wetTrem_) * 0.001f;
    if (wetTrem_ > 0.003f) {
      lfoTrem_ += kTwoPi * s_.tremRate / sr_;
      if (lfoTrem_ > kTwoPi) lfoTrem_ -= kTwoPi;
      const float m = 0.5f + 0.5f * std::sin(lfoTrem_);
      const float g = 1.f - wetTrem_ * s_.tremDepth * (1.f - m);
      l *= g; r *= g;
    }
    // envolvente de ataque de los efectos (swell del "wet" tras cada arranque)
    const float onsetBase = std::max(std::fabs(dryL), std::fabs(dryR));

    // 7) delay (ping-pong, tono en el lazo, modulación, sincronizado)
    wetDly_ += (tgtDly - wetDly_) * 0.001f;
    float dOutL = 0.f, dOutR = 0.f;
    const float gDly = onsetDly_.tick(onsetBase, sr_, s_.dlyAttack);
    if (wetDly_ > 0.003f || std::fabs(fbL_) + std::fabs(fbR_) > 1.0e-5f) {
      lfoDly_ += kTwoPi * 0.33f / sr_;
      if (lfoDly_ > kTwoPi) lfoDly_ -= kTwoPi;
      const float modS = std::sin(lfoDly_) * s_.dlyMod * 0.005f * sr_;
      const float tl = hermiteRead(dlL_, dlySamples + modS), tr = hermiteRead(dlR_, dlySamples * (s_.pingPong ? 1.0f : 1.003f) - modS);
      float inLd = l, inRd = r;
      if (s_.pingPong) { const float m = 0.5f * (l + r); inLd = m; inRd = 0.f; }
      const float nl = dlyLpL_.process(inLd + (s_.pingPong ? fbR_ : fbL_) * fb);
      const float nr = dlyLpR_.process(inRd + (s_.pingPong ? fbL_ : fbR_) * fb);
      dlL_.push(nl); dlR_.push(nr);
      fbL_ = flush(tl); fbR_ = flush(tr);
      dOutL = tl * wetDly_ * 0.7f * gDly;
      dOutR = tr * wetDly_ * 0.7f * gDly;
    }
    float xl = l + dOutL, xr = r + dOutR;
    dlyAcc = std::max(dlyAcc, std::fabs(dOutL) + std::fabs(dOutR));

    // 8) reverb FDN con shimmer en el lazo (la octava realimenta la entrada de la cola)
    wetRev_ += (tgtRev - wetRev_) * 0.001f;
    wetSh_ += (tgtSh - wetSh_) * 0.001f;
    float rl = 0.f, rr = 0.f, shL = 0.f, shR = 0.f;
    const float gRev = onsetRev_.tick(onsetBase, sr_, s_.revAttack);
    const float gSh = onsetSh_.tick(onsetBase, sr_, s_.shAttack);
    if (wetRev_ > 0.003f || wetSh_ > 0.003f || s_.freeze) {
      const float in = 0.5f * (xl + xr) + shFb_ * (0.12f + 0.8f * s_.shSize);
      reverb_.process(in, in, rl, rr);
      if (wetSh_ > 0.003f) {
        shL = shLpL_.process(shL_.process(rl, shRatio));
        shR = shLpR_.process(shR_.process(rr, shRatio));
        shFb_ = flush(0.5f * (shL + shR) * s_.shBlend);
      } else shFb_ = 0.f;
    } else shFb_ = 0.f;
    const float wl = rl * wetRev_ * gRev + shL * wetSh_ * 1.1f * gSh, wr = rr * wetRev_ * gRev + shR * wetSh_ * 1.1f * gSh;
    revAcc = std::max(revAcc, std::fabs(wl) + std::fabs(wr));
    // ancho de la cola (M/S)
    const float mm = 0.5f * (wl + wr), ss = 0.5f * (wl - wr) * s_.revWidth * 1.25f;
    xl += mm + ss; xr += mm - ss;

    // 9) estéreo global: ancho y graves en mono
    {
      float m2 = 0.5f * (xl + xr), s2 = 0.5f * (xl - xr);
      if (s_.bassMono > 31.f) { const float lowS = 0.5f * (bmL_.process(s2) + bmR_.process(s2)); s2 -= lowS; }
      s2 *= s_.width;
      xl = m2 + s2; xr = m2 - s2;
    }
    xl = dcL_.process(xl) * outG; xr = dcR_.process(xr) * outG;
    // seguridad: limitador suave
    const float al = std::fabs(xl), ar = std::fabs(xr);
    if (al > 0.92f) xl = (xl > 0.f ? 1.f : -1.f) * (0.92f + 0.08f * std::tanh((al - 0.92f) * 5.f));
    if (ar > 0.92f) xr = (xr > 0.f ? 1.f : -1.f) * (0.92f + 0.08f * std::tanh((ar - 0.92f) * 5.f));
    outL[i] = dryL + (xl - dryL) * bypassMix_;
    outR[i] = dryR + (xr - dryR) * bypassMix_;
  }
  revMeter_ = revAcc;
  dlyMeter_ = dlyAcc;
}

} // namespace JasWaveAmbience
