#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace JasWaveFx {
namespace dsp {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;

inline float clamp01(float x) { return std::max(0.f, std::min(1.f, x)); }
inline float dbToLinear(float db) { return std::pow(10.f, db * 0.05f); }
inline float linearToDb(float x) { return x <= 0.f ? -120.f : 20.f * std::log10f(x); }

// ──────────────────────────────────────────────────────────────
// One-pole
// ──────────────────────────────────────────────────────────────

struct OnePole {
  float z1{0.f};
  float a{0.f}; // (1 - a) * x + a * z1
  void setCutoff(float cutoffHz, float sampleRate) {
    a = std::exp(-kTwoPi * cutoffHz / sampleRate);
  }
  float process(float x) {
    z1 = (1.f - a) * x + a * z1;
    return z1;
  }
  void reset() { z1 = 0.f; }
};

// ──────────────────────────────────────────────────────────────
// Biquad (Direct Form II transposed). Coeficientes estilo RBJ.
// ──────────────────────────────────────────────────────────────

enum class BiquadType { LowPass, HighPass, Peak, LowShelf, HighShelf, Notch };

struct Biquad {
  BiquadType type{BiquadType::Peak};
  float sampleRate{48000.f};
  float freq{1000.f};
  float gainDb{0.f};
  float q{0.7f};
  float b0{1.f}, b1{0.f}, b2{0.f};
  float a1{0.f}, a2{0.f};
  float z1{0.f}, z2{0.f};

  void setSampleRate(float sr) {
    sampleRate = sr;
    recompute();
  }
  void setFreq(float f) { freq = std::max(10.f, f); recompute(); }
  void setGainDb(float g) { gainDb = g; recompute(); }
  void setQ(float qq) { q = std::max(0.05f, qq); recompute(); }
  void setType(BiquadType t) { type = t; recompute(); }
  void reset() { z1 = 0.f; z2 = 0.f; }

  void recompute() {
    const float sr = std::max(1000.f, sampleRate);
    const float f = std::clamp(freq, 10.f, sr * 0.49f);
    const float w0 = kTwoPi * f / sr;
    const float cw = std::cos(w0);
    const float sw = std::sin(w0);
    const float A = std::pow(10.f, gainDb / 40.f);
    const float alpha = sw / (2.f * q);

    float nb0{1.f}, nb1{0.f}, nb2{0.f}, na0{1.f}, na1{0.f}, na2{0.f};

    switch (type) {
      case BiquadType::LowPass: {
        nb0 = (1.f - cw) / 2.f;
        nb1 = 1.f - cw;
        nb2 = nb0;
        na0 = 1.f + alpha;
        na1 = -2.f * cw;
        na2 = 1.f - alpha;
        break;
      }
      case BiquadType::HighPass: {
        nb0 = (1.f + cw) / 2.f;
        nb1 = -(1.f + cw);
        nb2 = nb0;
        na0 = 1.f + alpha;
        na1 = -2.f * cw;
        na2 = 1.f - alpha;
        break;
      }
      case BiquadType::Peak: {
        nb0 = 1.f + alpha * A;
        nb1 = -2.f * cw;
        nb2 = 1.f - alpha * A;
        na0 = 1.f + alpha / A;
        na1 = -2.f * cw;
        na2 = 1.f - alpha / A;
        break;
      }
      case BiquadType::LowShelf: {
        const float s = A;
        const float beta = std::sqrt(A) / q; // approx shelf slope
        nb0 = A * ((A + 1.f) - (A - 1.f) * cw + beta * sw);
        nb1 = 2.f * A * ((A - 1.f) - (A + 1.f) * cw);
        nb2 = A * ((A + 1.f) - (A - 1.f) * cw - beta * sw);
        na0 = (A + 1.f) + (A - 1.f) * cw + beta * sw;
        na1 = -2.f * ((A - 1.f) + (A + 1.f) * cw);
        na2 = (A + 1.f) + (A - 1.f) * cw - beta * sw;
        break;
      }
      case BiquadType::HighShelf: {
        const float s = A;
        const float beta = std::sqrt(A) / q;
        nb0 = A * ((A + 1.f) + (A - 1.f) * cw + beta * sw);
        nb1 = -2.f * A * ((A - 1.f) + (A + 1.f) * cw);
        nb2 = A * ((A + 1.f) + (A - 1.f) * cw - beta * sw);
        na0 = (A + 1.f) - (A - 1.f) * cw + beta * sw;
        na1 = 2.f * ((A - 1.f) - (A + 1.f) * cw);
        na2 = (A + 1.f) - (A - 1.f) * cw - beta * sw;
        break;
      }
      case BiquadType::Notch: {
        nb0 = 1.f;
        nb1 = -2.f * cw;
        nb2 = 1.f;
        na0 = 1.f + alpha;
        na1 = -2.f * cw;
        na2 = 1.f - alpha;
        break;
      }
    }
    const float inv = 1.f / na0;
    b0 = nb0 * inv; b1 = nb1 * inv; b2 = nb2 * inv;
    a1 = na1 * inv; a2 = na2 * inv;
  }

  float process(float x) {
    const float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
};

// ──────────────────────────────────────────────────────────────
// Compresor (curva estática + seguidor de envolvente)
// ──────────────────────────────────────────────────────────────

struct Compressor {
  float sampleRate{48000.f};
  float thresholdDb{-20.f}; // -60..0
  float ratio{4.f};         // 1..20
  float attackMs{10.f};     // 0.1..200
  float releaseMs{100.f};   // 5..2000
  float kneeDb{0.f};        // 0..24
  float makeupDb{0.f};      // -24..+24
  float mix{1.f};           // 0..1

  float env{0.f}; // envolvente lineal
  float grDb{0.f}; // reducción de ganancia (dB, ≥0), read-only

  void setSampleRate(float sr) { sampleRate = sr; }

  void process(float& l, float& r) {
    const float sr = std::max(1000.f, sampleRate);
    const float thrLin = dbToLinear(thresholdDb);
    const float kneeHalf = std::max(0.f, kneeDb) * 0.5f;

    auto processOne = [&](float& x) {
      const float inMag = std::fabs(x);
      const float attCoef = 1.f - std::exp(-1.f / std::max(0.0001f, attackMs * 0.001f * sr));
      const float relCoef = 1.f - std::exp(-1.f / std::max(0.0001f, releaseMs * 0.001f * sr));
      if (inMag > env) env += (inMag - env) * attCoef;
      else env += (inMag - env) * relCoef;

      const float levelDb = linearToDb(env);
      float grDb = 0.f;
      if (levelDb > thresholdDb + kneeHalf) {
        const float over = levelDb - thresholdDb;
        grDb = over * (1.f - 1.f / std::max(1.f, ratio));
      } else if (levelDb > thresholdDb - kneeHalf) {
        const float t = (levelDb - (thresholdDb - kneeHalf)) / kneeDb;
        const float over = levelDb - thresholdDb;
        const float grFull = over * (1.f - 1.f / std::max(1.f, ratio));
        grDb = t * t * (3.f - 2.f * t) * grFull;
      }
      grDb = std::max(0.f, grDb);

      const float gainDb = -grDb + makeupDb;
      const float gainLin = dbToLinear(gainDb);
      const float wet = x * gainLin;
      x = x * (1.f - mix) + wet * mix;
    };
    processOne(l);
    processOne(r);
    grDb = grDb; // se lee tras procesar un bloque (promedio aproximado del último sample)
  }

  void reset() { env = 0.f; grDb = 0.f; }
};

// ──────────────────────────────────────────────────────────────
// Limitador con true-peak (sobremuestreo 4×)
// ──────────────────────────────────────────────────────────────

struct Limiter {
  float sampleRate{48000.f};
  float ceilingDb{-1.f};   // -12..0 dBTP
  float inputGainDb{0.f};  // 0..+24
  float releaseMs{100.f};  // 1..1000
  float lookaheadMs{0.f};  // 0..10

  float ceilingLin{dbToLinear(-1.f)};
  float gain{1.f}; // ganancia actual aplicada (smoothed)
  float grDb{0.f}; // reducción read-only

  // Lookahead buffer
  std::vector<float> bufL{}, bufR{};
  size_t writeIdx{0};
  // 4× oversampling (insertar ceros + one-pole de reconstrucción)
  float osZ1L{0.f}, osZ2L{0.f}, osZ3L{0.f};
  float osZ1R{0.f}, osZ2R{0.f}, osZ3R{0.f};

  void setSampleRate(float sr) {
    sampleRate = sr;
    const size_t cap = std::max<size_t>(64, static_cast<size_t>(sr * 0.010f) + 1);
    if (bufL.size() != cap) {
      bufL.assign(cap, 0.f);
      bufR.assign(cap, 0.f);
      writeIdx = 0;
    }
    recomputeCeiling();
  }

  void setCeilingDb(float d) {
    ceilingDb = std::clamp(d, -12.f, 0.f);
    recomputeCeiling();
  }
  void setInputGainDb(float d) { inputGainDb = std::clamp(d, 0.f, 24.f); }
  void setReleaseMs(float d) { releaseMs = std::clamp(d, 1.f, 1000.f); }
  void setLookaheadMs(float d) { lookaheadMs = std::clamp(d, 0.f, 10.f); }

  void recomputeCeiling() { ceilingLin = dbToLinear(ceilingDb); }

  float processOs(float x, float& z1, float& z2, float& z3) {
    // 4×: subir (insertar ceros), filtrar one-pole a ~Fs/2 para anti-imagen,
    // tomar el pico de los 4 ejes. Simplificación: filtrar y downsamplear
    // tomando max absoluto de las 4 fases.
    float maxPeak = std::fabs(x);
    const float a = std::exp(-kTwoPi * (sampleRate * 0.25f) / (sampleRate * 4.f));
    float v = x;
    v = (1.f - a) * v + a * z1; z1 = v;
    maxPeak = std::max(maxPeak, std::fabs(v));
    v = (1.f - a) * v + a * z2; z2 = v;
    maxPeak = std::max(maxPeak, std::fabs(v));
    v = (1.f - a) * v + a * z3; z3 = v;
    maxPeak = std::max(maxPeak, std::fabs(v));
    return maxPeak;
  }

  void process(float& l, float& r) {
    const float sr = std::max(1000.f, sampleRate);
    const float inGain = dbToLinear(inputGainDb);
    const float relCoef = 1.f - std::exp(-1.f / std::max(0.0001f, releaseMs * 0.001f * sr));

    // escalar por ganancia de entrada
    l *= inGain;
    r *= inGain;

    // lookahead: escribir muestra actual, leer la que está `lookahead` atrás.
    const int lookaheadSamples = static_cast<int>((lookaheadMs * 0.001f) * sr);
    const size_t cap = bufL.size();
    const size_t readIdx = (writeIdx + cap - static_cast<size_t>(std::clamp(lookaheadSamples, 0, 60000))) % cap;

    float peakL = std::fabs(l);
    float peakR = std::fabs(r);
    if (lookaheadSamples > 0 && cap > 1) {
      peakL = std::max(peakL, std::fabs(bufL[readIdx]));
      peakR = std::max(peakR, std::fabs(bufR[readIdx]));
    }
    // aproximación true-peak por canal (mono señal para decisión de gain)
    const float peak = std::max(peakL, peakR);

    // ganancia objetivo para no superar el techo
    float targetGain = 1.f;
    if (peak > ceilingLin) targetGain = ceilingLin / std::max(1e-6f, peak);
    targetGain = std::min(1.f, targetGain);

    // suavizado de la ganancia (release)
    if (targetGain < gain) gain += (targetGain - gain) * relCoef;
    else gain += (targetGain - gain) * 0.5f; // ataque rápido

    grDb = linearToDb(gain); // ≤ 0

    const float g = gain;
    l = std::clamp(l * g, -ceilingLin * 1.05f, ceilingLin * 1.05f);
    r = std::clamp(r * g, -ceilingLin * 1.05f, ceilingLin * 1.05f);

    bufL[writeIdx] = l;
    bufR[writeIdx] = r;
    writeIdx = (writeIdx + 1) % cap;
  }

  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
    writeIdx = 0;
    osZ1L = osZ2L = osZ3L = 0.f;
    osZ1R = osZ2R = osZ3R = 0.f;
    gain = 1.f;
    grDb = 0.f;
  }
};

// ──────────────────────────────────────────────────────────────
// Utility: ganancia, ancho estéreo, mono bajo Hz, fase, balance
// ──────────────────────────────────────────────────────────────

struct Utility {
  float sampleRate{48000.f};
  float gainDb{0.f};        // -24..+24
  float width{1.f};         // 0..2 (0 = mono, 1 = normal, 2 = ultra ancho)
  float monoBelowHz{0.f};   // 0 = off, 60..200
  bool invertL{false};
  bool invertR{false};
  float balance{0.f};       // -1..1 (L..R)

  OnePole hpZ1{}, hpZ2{}; // filtro paso alto para mono-below (procesa mid)

  void setSampleRate(float sr) {
    sampleRate = sr;
    if (monoBelowHz > 0.f) hpZ1.setCutoff(monoBelowHz, sr);
    hpZ2 = hpZ1;
  }
  void setMonoBelowHz(float hz) {
    monoBelowHz = hz;
    if (sampleRate > 0) {
      if (hz > 0.f) hpZ1.setCutoff(hz, sampleRate);
      hpZ2 = hpZ1;
    }
  }

  void process(float& l, float& r) {
    const float g = dbToLinear(gainDb);
    const float mid = (l + r) * 0.5f;
    const float side = (l - r) * 0.5f;

    float m = mid;
    if (monoBelowHz > 0.f) m = hpZ1.process(mid); // paso alto del mid → contenido bajo se va al centro
    // width: reducir side para mono, ampliar para ancho
    const float s = side * (2.f - width); // width=1 → side; width=0 → 0 (mono); width=2 → -side (invertido)

    l = m + s;
    r = m - s;

    if (invertL) l = -l;
    if (invertR) r = -r;

    // balance
    const float bl = std::max(0.f, 1.f - balance);
    const float br = std::max(0.f, 1.f + balance);
    l *= bl;
    r *= br;

    l *= g;
    r *= g;
  }
  void reset() { hpZ1.reset(); hpZ2.reset(); }
};

// ──────────────────────────────────────────────────────────────
// De-esser: banda alta 3-12 kHz, detector, reducción split/wide
// ──────────────────────────────────────────────────────────────

struct DeEsser {
  float sampleRate{48000.f};
  float freqHz{6000.f};   // 3..12 kHz
  float thresholdDb{-20.f}; // del detector
  float rangeDb{12.f};    // reducción máxima dB
  bool wideMode{false};   // false = split (solo HF), true = wide (banda completa)

  Biquad hp{}; // detector HPF sobre el señal
  Biquad hi{}; // banda alta (peaking) para aplicar reducción en split
  float env{0.f};
  float grDb{0.f};

  void setSampleRate(float sr) {
    sampleRate = sr;
    hp.setSampleRate(sr); hp.setType(BiquadType::HighPass); hp.setFreq(freqHz); hp.setQ(0.7f);
    hi.setSampleRate(sr); hi.setType(BiquadType::Peak); hi.setFreq(freqHz); hi.setQ(1.f); hi.setGainDb(0.f);
  }
  void setFreqHz(float f) { freqHz = std::clamp(f, 3000.f, 12000.f); hp.setFreq(freqHz); hi.setFreq(freqHz); }

  void process(float& l, float& r) {
    const float sr = std::max(1000.f, sampleRate);
    const float attCoef = 1.f - std::exp(-1.f / std::max(0.0001f, 0.005f * sr));
    const float relCoef = 1.f - std::exp(-1.f / std::max(0.0001f, 0.1f * sr));
    const float thrLin = dbToLinear(thresholdDb);
    const float maxLin = dbToLinear(-rangeDb);

    auto processOne = [&](float& x, Biquad& hiBand) {
      const float det = hp.process(x);
      const float detMag = std::fabs(det);
      if (detMag > env) env += (detMag - env) * attCoef;
      else env += (detMag - env) * relCoef;

      float reduction = 1.f;
      if (env > thrLin) {
        const float t = env / std::max(1e-6f, thrLin); // >1
        const float r = std::min(maxLin, std::pow(t, -1.f)); // cuanto más sobre el umbral, más reduce
        reduction = r;
      }
      grDb = linearToDb(reduction);

      if (wideMode) {
        x *= reduction;
      } else {
        // split: solo la banda alta se reduce
        const float hiSample = hiBand.process(x);
        const float loSample = x - hiSample;
        x = loSample + hiSample * reduction;
      }
    };
    processOne(l, hi);
    processOne(r, hi);
  }
  void reset() { env = 0.f; grDb = 0.f; hp.reset(); hi.reset(); }
};

} // namespace dsp
} // namespace JasWaveFx
