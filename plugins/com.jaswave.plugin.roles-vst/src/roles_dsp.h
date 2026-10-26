// =====================================================================================
//  JasWave Roles – primitivas DSP (v2, calidad de estudio)
//   Biquad RBJ, SVF TPT, polyBLEP, resonador complejo, línea Karplus-Strong, reverb FDN, chorus,
//   delay estéreo. Sin asignaciones en el hilo de audio: todo se dimensiona en prepare().
// =====================================================================================
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace JasWaveRoles {
namespace dsp {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;

inline float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
inline float dbToLin(float db) { return std::pow(10.f, db * 0.05f); }
inline float midiToHz(float m) { return 440.f * std::pow(2.f, (m - 69.f) / 12.f); }

/** Evita denormales en lazos de realimentación. */
inline float flush(float x) { return std::fabs(x) < 1.0e-20f ? 0.f : x; }

struct Rng {
  uint32_t s{0x9E3779B9u};
  explicit Rng(uint32_t seed = 0x9E3779B9u) : s(seed ? seed : 1u) {}
  inline uint32_t next() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s;
  }
  /** Ruido blanco en [-1, 1). */
  inline float white() { return static_cast<float>(static_cast<int32_t>(next())) * (1.0f / 2147483648.0f); }
  /** Uniforme en [0, 1). */
  inline float uni() { return static_cast<float>(next() >> 8) * (1.0f / 16777216.0f); }
};

// ---------------------------------------------------------------------------------
//  Biquad RBJ (forma transpuesta II)
// ---------------------------------------------------------------------------------
struct Biquad {
  float b0{1.f}, b1{0.f}, b2{0.f}, a1{0.f}, a2{0.f};
  float z1{0.f}, z2{0.f};
  void reset() { z1 = z2 = 0.f; }
  inline float process(float x) {
    const float y = b0 * x + z1;
    z1 = flush(b1 * x - a1 * y + z2);
    z2 = flush(b2 * x - a2 * y);
    return y;
  }
  void set(float nb0, float nb1, float nb2, float na0, float na1, float na2) {
    const float inv = 1.f / na0;
    b0 = nb0 * inv; b1 = nb1 * inv; b2 = nb2 * inv; a1 = na1 * inv; a2 = na2 * inv;
  }
  void lowpass(float sr, float f, float q) {
    f = clampf(f, 10.f, sr * 0.49f);
    const float w = kTwoPi * f / sr, c = std::cos(w), al = std::sin(w) / (2.f * q);
    set((1.f - c) * 0.5f, 1.f - c, (1.f - c) * 0.5f, 1.f + al, -2.f * c, 1.f - al);
  }
  void highpass(float sr, float f, float q) {
    f = clampf(f, 10.f, sr * 0.49f);
    const float w = kTwoPi * f / sr, c = std::cos(w), al = std::sin(w) / (2.f * q);
    set((1.f + c) * 0.5f, -(1.f + c), (1.f + c) * 0.5f, 1.f + al, -2.f * c, 1.f - al);
  }
  void bandpass(float sr, float f, float q) {   // ganancia pico = 1
    f = clampf(f, 10.f, sr * 0.49f);
    const float w = kTwoPi * f / sr, c = std::cos(w), al = std::sin(w) / (2.f * q);
    set(al, 0.f, -al, 1.f + al, -2.f * c, 1.f - al);
  }
  void peaking(float sr, float f, float q, float gainDb) {
    f = clampf(f, 10.f, sr * 0.49f);
    const float A = std::pow(10.f, gainDb / 40.f);
    const float w = kTwoPi * f / sr, c = std::cos(w), al = std::sin(w) / (2.f * q);
    set(1.f + al * A, -2.f * c, 1.f - al * A, 1.f + al / A, -2.f * c, 1.f - al / A);
  }
  void lowShelf(float sr, float f, float gainDb, float slope = 0.8f) {
    f = clampf(f, 10.f, sr * 0.49f);
    const float A = std::pow(10.f, gainDb / 40.f);
    const float w = kTwoPi * f / sr, c = std::cos(w), s = std::sin(w);
    const float al = s * 0.5f * std::sqrt((A + 1.f / A) * (1.f / slope - 1.f) + 2.f);
    const float sq = 2.f * std::sqrt(A) * al;
    set(A * ((A + 1.f) - (A - 1.f) * c + sq), 2.f * A * ((A - 1.f) - (A + 1.f) * c), A * ((A + 1.f) - (A - 1.f) * c - sq),
        (A + 1.f) + (A - 1.f) * c + sq, -2.f * ((A - 1.f) + (A + 1.f) * c), (A + 1.f) + (A - 1.f) * c - sq);
  }
  void highShelf(float sr, float f, float gainDb, float slope = 0.8f) {
    f = clampf(f, 10.f, sr * 0.49f);
    const float A = std::pow(10.f, gainDb / 40.f);
    const float w = kTwoPi * f / sr, c = std::cos(w), s = std::sin(w);
    const float al = s * 0.5f * std::sqrt((A + 1.f / A) * (1.f / slope - 1.f) + 2.f);
    const float sq = 2.f * std::sqrt(A) * al;
    set(A * ((A + 1.f) + (A - 1.f) * c + sq), -2.f * A * ((A - 1.f) + (A + 1.f) * c), A * ((A + 1.f) + (A - 1.f) * c - sq),
        (A + 1.f) - (A - 1.f) * c + sq, 2.f * ((A - 1.f) - (A + 1.f) * c), (A + 1.f) - (A - 1.f) * c - sq);
  }
};

// ---------------------------------------------------------------------------------
//  SVF TPT (Zavalishin): lowpass / bandpass / highpass con modulación estable
// ---------------------------------------------------------------------------------
struct Svf {
  float g{0.1f}, k{1.f}, a1{0.f}, a2{0.f}, a3{0.f};
  float ic1{0.f}, ic2{0.f};
  void reset() { ic1 = ic2 = 0.f; }
  void set(float sr, float f, float q) {
    f = clampf(f, 15.f, sr * 0.45f);
    g = std::tan(kPi * f / sr);
    k = 1.f / std::max(0.3f, q);
    a1 = 1.f / (1.f + g * (g + k));
    a2 = g * a1;
    a3 = g * a2;
  }
  struct Out { float lp, bp, hp; };
  inline Out process(float v0) {
    const float v3 = v0 - ic2;
    const float v1 = a1 * ic1 + a2 * v3;
    const float v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = flush(2.f * v1 - ic1);
    ic2 = flush(2.f * v2 - ic2);
    return { v2, v1, v0 - k * v1 - v2 };
  }
  inline float lowpass(float x) { return process(x).lp; }
};

// ---------------------------------------------------------------------------------
//  polyBLEP (saw / square sin aliasing audible)
// ---------------------------------------------------------------------------------
inline float polyBlep(float t, float dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1.f; }
  if (t > 1.f - dt) { t = (t - 1.f) / dt; return t * t + t + t + 1.f; }
  return 0.f;
}
inline float sawBlep(float phase, float dt) { return 2.f * phase - 1.f - polyBlep(phase, dt); }
inline float squareBlep(float phase, float dt, float width = 0.5f) {
  float v = phase < width ? 1.f : -1.f;
  v += polyBlep(phase, dt);
  float p2 = phase - width;
  if (p2 < 0.f) p2 += 1.f;
  v -= polyBlep(p2, dt);
  return v;
}
inline float triangleFromSquare(float sq, float dt, float& integ) {
  // triángulo = integrador con fuga del cuadrado band-limited
  integ = flush(dt * 4.f * sq + (1.f - dt * 4.f * 0.002f) * integ);
  return integ;
}

// ---------------------------------------------------------------------------------
//  Resonador complejo (oscilador amortiguado "magic circle"): z <- z * (r e^{jw})
// ---------------------------------------------------------------------------------
struct Rotor {
  float re{0.f}, im{0.f}, mr{1.f}, mi{0.f};
  void set(float amp, float phase0, float freqHz, float t60Sec, float sr) {
    const float w = kTwoPi * freqHz / sr;
    const float r = (t60Sec > 0.f) ? std::pow(10.f, -3.f / (t60Sec * sr)) : 0.f;
    mr = r * std::cos(w);
    mi = r * std::sin(w);
    re = amp * std::cos(phase0);
    im = amp * std::sin(phase0);
  }
  inline float tick() {
    const float nr = re * mr - im * mi;
    const float ni = re * mi + im * mr;
    re = flush(nr); im = flush(ni);
    return re;
  }
  inline bool dead(float thr) const { return std::fabs(re) + std::fabs(im) < thr; }
};

// ---------------------------------------------------------------------------------
//  Línea de cuerda pulsada (Karplus-Strong extendido): pérdida con filtro de 2 puntos, afinación
//  fraccionaria con all-pass de Thiran de 1er orden.
// ---------------------------------------------------------------------------------
struct PluckString {
  std::vector<float> buf;
  int len{0}, w{0};
  float apA{0.f}, apX1{0.f}, apY1{0.f};
  float gLoop{0.995f}, bright{0.4f}, prev{0.f};
  bool active{false};
  void alloc(int maxLen) { buf.assign(static_cast<size_t>(std::max(16, maxLen)), 0.f); }
  void clear() { std::fill(buf.begin(), buf.end(), 0.f); w = 0; apX1 = apY1 = prev = 0.f; active = false; }
  /** f0 en Hz; devuelve el tamaño de excitación (muestras). */
  int tune(float f0, float sr, float damping, float t60) {
    const float period = sr / std::max(15.f, f0);
    bright = clampf(damping, 0.02f, 0.5f);          // 0.5 = muy amortiguada
    const float loopDelay = period - bright;        // el filtro aporta ~bright muestras
    int li = static_cast<int>(loopDelay - 0.5f);
    li = std::max(2, std::min(li, static_cast<int>(buf.size()) - 2));
    len = li;
    const float d = loopDelay - static_cast<float>(li);   // fracción en [0.5, 1.5)
    apA = (1.f - d) / (1.f + d);
    // ganancia de lazo para el T60 pedido a f0
    gLoop = std::pow(10.f, -3.f / (std::max(0.05f, t60) * std::max(15.f, f0)));
    gLoop = std::min(gLoop, 0.99995f);
    return li;
  }
  inline float tick() {
    // lectura al final de la línea (w = posición más antigua)
    const float x = buf[static_cast<size_t>(w)];
    // filtro de pérdida: media ponderada con la muestra anterior
    const float lp = gLoop * ((1.f - bright) * x + bright * prev);
    prev = x;
    // all-pass de afinación
    const float y = apA * lp + apX1 - apA * apY1;
    apX1 = lp;
    apY1 = flush(y);
    buf[static_cast<size_t>(w)] = apY1;
    if (++w >= len) w = 0;
    return x;
  }
};

// ---------------------------------------------------------------------------------
//  Retardo modulado / peine
// ---------------------------------------------------------------------------------
struct DelayLine {
  std::vector<float> b;
  int w{0}, mask{0};
  void alloc(int n) {
    int sz = 16;
    while (sz < n) sz <<= 1;
    b.assign(static_cast<size_t>(sz), 0.f);
    mask = sz - 1;
    w = 0;
  }
  void clear() { std::fill(b.begin(), b.end(), 0.f); w = 0; }
  inline void push(float x) { b[static_cast<size_t>(w)] = x; w = (w + 1) & mask; }
  /** Lectura con retardo en muestras (fraccionario, interpolación lineal). */
  inline float read(float d) const {
    const float rp = static_cast<float>(w) - d;
    const float fl = std::floor(rp);
    const int i0 = (static_cast<int>(fl)) & mask;
    const int i1 = (i0 + 1) & mask;
    const float fr = rp - fl;
    return b[static_cast<size_t>(i0)] * (1.f - fr) + b[static_cast<size_t>(i1)] * fr;
  }
  inline float readInt(int d) const { return b[static_cast<size_t>((w - d) & mask)]; }
};

struct Allpass {
  DelayLine d;
  int n{1};
  float g{0.5f};
  void alloc(int len, float gain) { d.alloc(len + 2); n = len; g = gain; }
  inline float process(float x) {
    const float z = d.readInt(n);
    const float y = z - g * x;
    d.push(x + g * z);
    return y;
  }
};

// ---------------------------------------------------------------------------------
//  Reverb FDN de 8 líneas (matriz de Hadamard), difusión de entrada, amortiguación por línea,
//  modulación lenta de los retardos y salida estéreo decorrelada. Cola ~ RT60 configurable.
// ---------------------------------------------------------------------------------
class FdnReverb {
public:
  static constexpr int kN = 8;
  void prepare(float sr) {
    sr_ = sr;
    static const float kLenMs[kN] = { 29.7f, 37.1f, 41.1f, 43.7f, 53.3f, 61.7f, 71.9f, 79.3f };
    for (int i = 0; i < kN; ++i) {
      const int n = static_cast<int>(kLenMs[i] * 0.001f * sr);
      baseLen_[i] = static_cast<float>(n);
      line_[i].alloc(n + 256);
      damp_[i] = 0.f;
    }
    static const float kApMs[4] = { 5.1f, 7.7f, 11.3f, 13.9f };
    for (int i = 0; i < 4; ++i) { apL_[i].alloc(static_cast<int>(kApMs[i] * 0.001f * sr), 0.62f); apR_[i].alloc(static_cast<int>(kApMs[i] * 0.00113f * sr) + 1, 0.62f); }
    preDelay_.alloc(static_cast<int>(0.2f * sr) + 4);
    inHp_.highpass(sr, 160.f, 0.707f);
    inLp_.lowpass(sr, 9500.f, 0.707f);
    outHpL_.highpass(sr, 130.f, 0.707f); outHpR_.highpass(sr, 130.f, 0.707f);
    setDecay(2.6f, 0.45f);
    clear();
  }
  void clear() {
    for (auto& l : line_) l.clear();
    for (auto& a : apL_) a.d.clear();
    for (auto& a : apR_) a.d.clear();
    preDelay_.clear();
    for (auto& d : damp_) d = 0.f;
    inHp_.reset(); inLp_.reset(); outHpL_.reset(); outHpR_.reset();
    lfo_ = 0.f;
  }
  /** rt60 en segundos; hf = factor de amortiguación de agudos (0 = brillante, 1 = oscuro). */
  void setDecay(float rt60, float hf) {
    rt60_ = rt60;
    for (int i = 0; i < kN; ++i) {
      const float lenSec = baseLen_[i] / sr_;
      gain_[i] = freeze_ ? 0.99995f : std::pow(10.f, -3.f * lenSec / std::max(0.2f, rt60));
    }
    dampCoef_ = clampf(hf, 0.f, 0.95f);
  }
  void setPreDelayMs(float ms) { preSamples_ = clampf(ms * 0.001f * sr_, 1.f, 0.19f * sr_); }
  /** Filtros de entrada de la cola (paso alto / paso bajo) en Hz. */
  void setInputFilters(float lowCutHz, float highCutHz) {
    inHp_.highpass(sr_, clampf(lowCutHz, 20.f, 1000.f), 0.707f);
    inLp_.lowpass(sr_, clampf(highCutHz, 1000.f, 20000.f), 0.707f);
    outHpL_.highpass(sr_, clampf(lowCutHz * 0.8f, 20.f, 800.f), 0.707f);
    outHpR_.highpass(sr_, clampf(lowCutHz * 0.8f, 20.f, 800.f), 0.707f);
  }
  /** Profundidad de la modulación de los retardos (muestras, 0..~6): evita el sonido metálico. */
  void setModDepth(float samples) { modDepth_ = clampf(samples, 0.f, 8.f); }
  /** Congela la cola: se corta la entrada y la realimentación se acerca a 1 (pad infinito). */
  void setFreeze(bool on) { if (on != freeze_) { freeze_ = on; setDecay(rt60_, dampCoef_); } }
  inline void process(float inL, float inR, float& outL, float& outR) {
    float x = 0.5f * (inL + inR);
    x = inLp_.process(inHp_.process(x));
    if (freeze_) x = 0.f;
    preDelay_.push(x);
    x = preDelay_.read(preSamples_);
    for (int i = 0; i < 4; ++i) x = apL_[i].process(x);
    // lectura de líneas con modulación lenta
    lfo_ += 0.35f * kTwoPi / sr_;
    if (lfo_ > kTwoPi) lfo_ -= kTwoPi;
    float v[kN];
    for (int i = 0; i < kN; ++i) {
      const float mod = std::sin(lfo_ * (1.f + 0.13f * static_cast<float>(i)) + static_cast<float>(i) * 1.3f) * modDepth_;
      float s = line_[i].read(baseLen_[i] + mod);
      // amortiguación de agudos por línea (one-pole)
      damp_[i] = flush(s * (1.f - dampCoef_) + damp_[i] * dampCoef_);
      v[i] = damp_[i] * gain_[i];
    }
    // Hadamard 8x8 normalizada
    float h[kN];
    hadamard(v, h);
    for (int i = 0; i < kN; ++i) line_[i].push(h[i] * 0.35355339f + x * 0.35f);
    // salida estéreo: combinaciones ortogonales de las líneas
    const float l = v[0] + v[2] - v[4] + v[6] + 0.5f * (v[1] - v[5]);
    const float r = v[1] - v[3] + v[5] + v[7] + 0.5f * (v[2] - v[6]);
    float ol = l * 0.28f, orr = r * 0.28f;
    for (int i = 0; i < 2; ++i) { ol = apR_[i].process(ol); orr = apR_[i + 2].process(orr); }
    outL = outHpL_.process(ol);
    outR = outHpR_.process(orr);
  }

private:
  static inline void hadamard(const float* in, float* out) {
    float a[kN];
    for (int i = 0; i < kN; i += 2) { a[i] = in[i] + in[i + 1]; a[i + 1] = in[i] - in[i + 1]; }
    float b[kN];
    for (int i = 0; i < kN; i += 4) {
      b[i] = a[i] + a[i + 2]; b[i + 2] = a[i] - a[i + 2];
      b[i + 1] = a[i + 1] + a[i + 3]; b[i + 3] = a[i + 1] - a[i + 3];
    }
    for (int i = 0; i < 4; ++i) { out[i] = b[i] + b[i + 4]; out[i + 4] = b[i] - b[i + 4]; }
  }
  float sr_{48000.f};
  std::array<DelayLine, kN> line_{};
  std::array<float, kN> baseLen_{}, gain_{}, damp_{};
  std::array<Allpass, 4> apL_{}, apR_{};
  DelayLine preDelay_;
  Biquad inHp_, inLp_, outHpL_, outHpR_;
  float dampCoef_{0.4f}, preSamples_{960.f}, lfo_{0.f}, rt60_{2.6f}, modDepth_{2.2f};
  bool freeze_{false};
};

// ---------------------------------------------------------------------------------
//  Chorus estéreo de 2 voces (LFO en cuadratura entre canales)
// ---------------------------------------------------------------------------------
class StereoChorus {
public:
  void prepare(float sr) { sr_ = sr; dl_.alloc(static_cast<int>(sr * 0.06f)); dr_.alloc(static_cast<int>(sr * 0.06f)); }
  void clear() { dl_.clear(); dr_.clear(); ph_ = 0.f; }
  inline void process(float inL, float inR, float amount, float& outL, float& outR) {
    dl_.push(inL);
    dr_.push(inR);
    ph_ += 0.42f * kTwoPi / sr_;
    if (ph_ > kTwoPi) ph_ -= kTwoPi;
    const float base = 0.018f * sr_, depth = 0.0035f * sr_;
    const float wl = dl_.read(base + std::sin(ph_) * depth);
    const float wr = dr_.read(base + std::sin(ph_ + 1.5708f) * depth);
    const float wl2 = dl_.read(base * 1.3f + std::sin(ph_ * 1.37f + 2.1f) * depth * 0.8f);
    const float wr2 = dr_.read(base * 1.3f + std::sin(ph_ * 1.37f + 3.7f) * depth * 0.8f);
    outL = inL + amount * 0.5f * (wl + wr2 * 0.6f - inL * 0.0f) ;
    outR = inR + amount * 0.5f * (wr + wl2 * 0.6f);
    (void)wl2;
  }
private:
  float sr_{48000.f}, ph_{0.f};
  DelayLine dl_, dr_;
};

} // namespace dsp
} // namespace JasWaveRoles
