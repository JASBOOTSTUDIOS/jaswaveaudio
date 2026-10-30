// =====================================================================================
//  JasWave Shimmer Pad - pad ambiental worship (sin SDK VST3; header-only, sin asignaciones en render)
//
//  Cadena:  voces (2 capas + sub) -> SVF TPT por voz (estereo) -> ensemble chorus -> FDN shimmer -> salida
//   - Capa A: supersaw 2..7 voces con wavetables band-limited por octava (sigma-Lanczos), detune/pan por voz, deriva organica.
//   - Capa B: wavetable band-limited por octava (4096 muestras, 9 mezclas calido<->cristal, una por voz).
//   - Sub-octava sinusoidal suave. PRNG xorshift propio por voz (fase, deriva, pan).
//   - Filtro: SVF TPT/ZDF (Zavalishin) estable de 20 Hz a 20 kHz y toda la resonancia; seguimiento de
//     teclado, velocidad, LFO lento (estereo en cuadratura), rueda de modulacion (CC1) y aftertouch.
//   - Envolvente: ataque/release exponenciales largos; robo de voz = la mas antigua (preferentemente
//     una ya liberada) con fundido lineal de 5 ms (sin clic).
//   - Shimmer: FDN de 8 lineas (difusores de entrada, matriz de Hadamard, lineas moduladas, amortiguacion
//     HF en estante) con pitch shifter granular (4 granos Hann solapados 75 %) en el lazo de realimentacion
//     (+12, +7 o +24 semitonos). shimmer_decay = RT60 real.
//   Estabilidad: cada linea tiene ganancia g < 1 (<= 0.99995) con matriz ortogonal; el camino del
//   shifter es una rotacion cos/sin entre 4 pares de lineas, con CAG de potencia (potencia de salida del
//   shifter <= potencia de entrada) y saturador tanh; ganancia de lazo < 1 en todo el rango.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_fxrack.h"
#include "jw_params.h"
#include "jw_sampler.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

#if defined(_M_X64) || defined(__SSE2__)
#include <emmintrin.h>
#define JW_PAD_SSE2 1
#endif

namespace JasWaveShimmerPad {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kCutoff = 0, kResonance = 1, kShimmerOctave = 2, kShimmerDecay = 3, kLfoRate = 4, kBypass = 5, kVolume = 6,
    kShimmer = 7, kAttack = 8, kRelease = 9, kReverb = 10, kDetune = 11, kSub = 12, kChorus = 13,
    kBend = 14, kModWheel = 15, kAftertouch = 16, kSustain = 17,
    // bloques de mezcla anadidos al final (ids estables: proyectos y automatizacion existentes no cambian)
    kLowCut = 18, kTone = 19, kComp = 20, kDelayMix = 21, kDelayTime = 22, kDelayFb = 23, kDrive = 24, kWidth = 25, kTune = 26, kDamping = 27
};
enum Feature : int { kFeatShimmer = 0 };

constexpr int kMaxVoices = 16;
constexpr int kMaxUnison = 7;
constexpr int kTick = 32;          // periodo de control (muestras)
constexpr int kChunk = 256;        // bloque interno maximo
constexpr int kTableN = 4096;
constexpr int kLevels = 10;        // octavas de wavetables (27.5 Hz * 2^k)
constexpr int kMorphs = 9;        // mezclas calido<->cristal (indice 0..8)
constexpr int kSawShape = kMorphs; // tabla de diente de sierra band-limited (capa A); indice 9
constexpr int kShapes = kMorphs + 1;
constexpr int kFdn = 8;
constexpr int kPs = 4;
constexpr double kTwoPi = 6.283185307179586476925286766559;

inline const char* const* labelsInterval() { static const char* const l[] = { "+12 st", "+7 st", "+24 st" }; return l; }

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(logP(kCutoff, "Filter Cutoff", "Hz", 20.0, 20000.0, 2600.0, 0));
        v.push_back(linearP(kResonance, "Filter Resonance", "%", 0.0, 100.0, 10.0, 0));
        v.push_back(withFeature(stepP(kShimmerOctave, "Shimmer Interval", 2, 0, labelsInterval()), kFeatShimmer));
        v.push_back(logP(kShimmerDecay, "Shimmer Decay", "s", 0.5, 20.0, 9.0, 1));
        v.push_back(logP(kLfoRate, "LFO Rate", "Hz", 0.05, 8.0, 0.12, 2));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kShimmer, "Shimmer Amount", "%", 0.0, 100.0, 45.0, 0));
        v.push_back(logP(kAttack, "Attack", "s", 0.02, 12.0, 1.2, 2));
        v.push_back(logP(kRelease, "Release", "s", 0.1, 15.0, 4.0, 2));
        v.push_back(linearP(kReverb, "Reverb Mix", "%", 0.0, 100.0, 55.0, 0));
        v.push_back(linearP(kDetune, "Unison Detune", "%", 0.0, 100.0, 45.0, 0));
        v.push_back(linearP(kSub, "Sub Octave", "%", 0.0, 100.0, 10.0, 0));
        v.push_back(linearP(kChorus, "Ensemble Chorus", "%", 0.0, 100.0, 45.0, 0));
        v.push_back(linearP(kBend, "Pitch Bend", "st", -2.0, 2.0, 0.0, 2, true));
        v.push_back(linearP(kModWheel, "Mod Wheel", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kAftertouch, "Aftertouch", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(toggleP(kSustain, "Sustain Pedal", 0));
        v.push_back(logP(kLowCut, "Low Cut", "Hz", 20.0, 400.0, 70.0, 0));
        v.push_back(logP(kTone, "Tone (Low Pass)", "Hz", 1000.0, 20000.0, 9000.0, 0));
        v.push_back(linearP(kComp, "Soft Compression", "%", 0.0, 100.0, 35.0, 0));
        v.push_back(linearP(kDelayMix, "Tape Delay Mix", "%", 0.0, 100.0, 18.0, 0));
        v.push_back(logP(kDelayTime, "Tape Delay Time", "ms", 80.0, 1200.0, 520.0, 0));
        v.push_back(linearP(kDelayFb, "Tape Delay Feedback", "%", 0.0, 90.0, 40.0, 0));
        v.push_back(linearP(kDrive, "Tape Drive", "%", 0.0, 100.0, 15.0, 0));
        v.push_back(linearP(kWidth, "Stereo Width", "%", 0.0, 150.0, 110.0, 0));
        v.push_back(linearP(kTune, "Master Tune", "ct", -50.0, 50.0, 0.0, 1, true));
        v.push_back(linearP(kDamping, "Reverb Damping", "%", 0.0, 100.0, 70.0, 0));
        marcarBasicos(v, { kBypass, kVolume, kCutoff, kResonance, kShimmer, kAttack, kRelease });   // modo Básico del editor
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..): EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura
        return v;
    }();
    return defs;
}

struct PadSettings {
    // Valores por defecto = los de paramDefs() (pad ambiental: calido, lento, cola enorme)
    double cutoffHz{2600.0}, resonance{0.10};     // resonancia 0..1
    int interval{0};                              // 0:+12  1:+7  2:+24
    double rt60{9.0}, lfoHz{0.12}, volumeDb{0.0};
    double shimmer{0.45}, attack{1.2}, release{4.0}, reverb{0.55}, detune{0.45}, sub{0.10}, chorus{0.45};
    double bendSemi{0.0}, modWheel{0.0}, aftertouch{0.0};
    // mezcla: paso-altos, tono, compresion suave, delay de cinta, saturacion, anchura (1 = original), afinacion, damping
    double lowCutHz{70.0}, toneHz{9000.0}, comp{0.35}, delayMix{0.18}, delayMs{520.0}, delayFb{0.40}, drive{0.15}, width{1.10}, tuneCents{0.0}, damping{0.70};
    bool sustain{false}, bypass{false};
    // solo pruebas
    double lfoDepthOct{0.45};
    double driftScale{1.0};
    bool wetOnly{false};
};

struct PadBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<uint64_t> keys[2]{};
    std::atomic<int> maxVoices{kMaxVoices};
    std::atomic<float> cutoffHz{3200.0f};
    std::atomic<float> shimmerLevel{0.0f};
};

// -------------------------------------------------------------------------------------
//  Utilidades
// -------------------------------------------------------------------------------------
struct Xor {
    uint32_t s{0x2545F491u};
    void seed(uint32_t v) { s = v ? v : 0x9E3779B9u; for (int i = 0; i < 4; ++i) u32(); }
    uint32_t u32() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    double uni() { return u32() * (1.0 / 4294967296.0); }
    double bi() { return uni() * 2.0 - 1.0; }
};

inline double softClip(double x) {
    const double a = std::fabs(x);
    if (a < 0.5) return x;
    const double y = 0.5 + 0.47 * std::tanh((a - 0.5) * (1.0 / 0.47));   // techo 0.97
    return x < 0 ? -y : y;
}

// 2^(c/1200) para |c| < ~60 cents (Taylor de 3er orden; error < 1e-6 relativo)
inline double centsRatio(double c) {
    const double a = c * (0.69314718055994531 / 1200.0);
    return 1.0 + a * (1.0 + a * (0.5 + a * (1.0 / 6.0)));
}

inline size_t pow2AtLeast(size_t n) { size_t p = 1; while (p < n) p <<= 1; return p; }

// Linea de retardo con lectura fraccionaria lineal. D = muestras de retardo (>= 1 respecto de la ultima escritura)
struct DelayBuf {
    std::vector<double> b;
    size_t mask{0}, w{0};
    void alloc(size_t n) { b.assign(pow2AtLeast(n + 4), 0.0); mask = b.size() - 1; w = 0; }
    void clear() { std::fill(b.begin(), b.end(), 0.0); w = 0; }
    inline void push(double x) { b[w] = x; w = (w + 1) & mask; }
    // D=1 -> ultima muestra escrita
    inline double read(double D) const {
        const double pos = static_cast<double>(w) - D;
        const double fl = std::floor(pos);
        const double fr = pos - fl;
        const size_t i0 = static_cast<size_t>(static_cast<int64_t>(fl)) & mask;
        const size_t i1 = (i0 + 1) & mask;
        return b[i0] + (b[i1] - b[i0]) * fr;
    }
};

// -------------------------------------------------------------------------------------
//  Wavetables band-limited por octava
// -------------------------------------------------------------------------------------
class WaveTables {
public:
    void build(double sr) {
        sr_ = sr;
        sine_.assign(kTableN + 1, 0.0f);
        std::vector<double> sn(kTableN);
        for (int i = 0; i < kTableN; ++i) { sn[static_cast<size_t>(i)] = std::sin(kTwoPi * i / kTableN); sine_[static_cast<size_t>(i)] = static_cast<float>(sn[static_cast<size_t>(i)]); }
        sine_[kTableN] = sine_[0];
        data_.assign(static_cast<size_t>(kShapes) * kLevels * (kTableN + 1), 0.0f);
        std::vector<double> acc(kTableN);
        for (int s = 0; s < kShapes; ++s) {
            for (int L = 0; L < kLevels; ++L) {
                const double fU = 27.5 * std::pow(2.0, L + 1);
                int maxH = static_cast<int>(std::floor(0.45 * sr / fU));
                maxH = std::max(1, std::min(maxH, s == kSawShape ? 256 : 64));
                std::fill(acc.begin(), acc.end(), 0.0);
                double e = 0.0;
                for (int k = 1; k <= maxH; ++k) {
                    // diente de sierra: 1/k con factor sigma de Lanczos (atenua el fenomeno de Gibbs)
                    const double a = s == kSawShape ? sawAmp(k, maxH) : amp(s, k);
                    e += a * a * 0.5;
                    for (int i = 0; i < kTableN; ++i) acc[static_cast<size_t>(i)] += a * sn[static_cast<size_t>((static_cast<int64_t>(k) * i) & (kTableN - 1))];
                }
                const double norm = 0.30 / std::sqrt(std::max(e, 1e-12));
                float* t = &data_[(static_cast<size_t>(s) * kLevels + L) * (kTableN + 1)];
                for (int i = 0; i < kTableN; ++i) t[i] = static_cast<float>(acc[static_cast<size_t>(i)] * norm);
                t[kTableN] = t[0];
            }
        }
    }
    const float* table(int morph, double f) const {
        int L = 0;
        if (f > 27.5) L = std::min(kLevels - 1, std::ilogb(f * (1.0 / 27.5)));
        return &data_[(static_cast<size_t>(morph) * kLevels + static_cast<size_t>(L)) * (kTableN + 1)];
    }
    const float* sine() const { return sine_.data(); }
private:
    static double sawAmp(int k, int maxH) {
        const double x = kPi * k / (maxH + 1);
        return (1.0 / k) * (std::sin(x) / x);
    }
    static double amp(int morph, int k) {
        const double warm = std::pow(static_cast<double>(k), -1.35);
        static const double g[9] = { 0, 1.0, 0.35, 0.55, 0.15, 0.40, 0.12, 0.25, 0.08 };       // "cristal"
        const double glass = k <= 8 ? g[k] : 0.9 * std::pow(static_cast<double>(k), -1.25);
        const double m = morph / static_cast<double>(kMorphs - 1);
        return (1.0 - m) * warm + m * glass;
    }
    double sr_{48000.0};
    std::vector<float> sine_, data_;
};

// lectura con fase de 32 bits: 12 bits de indice + 20 de fraccion (interpolacion lineal)
inline double readTableFx(const float* t, uint32_t ph) {
    const uint32_t i = ph >> 20;
    const float fr = static_cast<float>(ph & 0xFFFFFu) * (1.0f / 1048576.0f);
    return static_cast<double>(t[i] + (t[i + 1] - t[i]) * fr);
}
inline double readTable(const float* t, double ph) {
    const double x = ph * kTableN;
    const int i = static_cast<int>(x);
    const double fr = x - i;
    return t[i] + (t[i + 1] - t[i]) * fr;
}

// -------------------------------------------------------------------------------------
//  Pitch shifter granular: 4 granos Hann solapados al 75 %, crossfade por ventana (suma = constante)
// -------------------------------------------------------------------------------------
class GrainShifter {
public:
    void prepare(double sr, double windowSec, uint32_t seed) {
        sr_ = sr;
        W_ = std::max(64.0, windowSec * sr);
        buf_.alloc(static_cast<size_t>(W_) + 8);
        Xor r; r.seed(seed);
        phi0_ = r.uni();
        hpA_ = 1.0 - std::exp(-kTwoPi * 110.0 / sr);
        lpA_ = 1.0 - std::exp(-kTwoPi * std::min(7000.0, 0.4 * sr) / sr);
        pw_ = 1.0 - std::exp(-1.0 / (0.030 * sr));
        setRatio(2.0);
        reset();
    }
    void reset() {
        buf_.clear(); hp_ = lp_ = 0.0; pin_ = pout_ = 0.0; gain_ = 1.0; cnt_ = 0;
        phi_ = phi0_;
        resync();
    }
    void setRatio(double r) {
        dphi_ = (1.0 - r) / W_;
        rc_ = std::cos(kTwoPi * dphi_);
        rs_ = std::sin(kTwoPi * dphi_);
    }
    double process(double x) {
        hp_ += hpA_ * (x - hp_);
        const double xh = x - hp_;
        lp_ += lpA_ * (xh - lp_);
        const double in = lp_;
        buf_.push(in);
        // ventanas Hann de los 4 granos (separados 1/4 de periodo): cos(th + k pi/2) -> {c, -s, -c, s}
        const double w0 = 0.5 - 0.5 * c_, w1 = 0.5 + 0.5 * s_, w2 = 0.5 + 0.5 * c_, w3 = 0.5 - 0.5 * s_;
        double p1 = phi_ + 0.25, p2 = phi_ + 0.5, p3 = phi_ + 0.75;
        p1 -= std::floor(p1); p2 -= std::floor(p2); p3 -= std::floor(p3);
        const double acc = w0 * buf_.read(1.0 + phi_ * W_) + w1 * buf_.read(1.0 + p1 * W_) +
                           w2 * buf_.read(1.0 + p2 * W_) + w3 * buf_.read(1.0 + p3 * W_);
        phi_ += dphi_;
        phi_ -= std::floor(phi_);
        const double nc = c_ * rc_ - s_ * rs_;
        s_ = s_ * rc_ + c_ * rs_;
        c_ = nc;
        if (++cnt_ >= 512) { cnt_ = 0; resync(); }
        const double out = acc * 0.5 * 1.55;     // suma de ventanas = 2; 1.55 repone la potencia de una senal difusa
        pin_ += pw_ * (in * in - pin_);
        pout_ += pw_ * (out * out - pout_);
        if ((cnt_ & 7) == 0) {                   // CAG: potencia de salida <= potencia de entrada
            const double target = pout_ > pin_ ? std::sqrt((pin_ + 1e-18) / (pout_ + 1e-18)) : 1.0;
            gain_ += 0.016 * (target - gain_);
        }
        return fastTanh(out * std::min(gain_, 1.0));
    }
    static inline double fastTanh(double x) {
        if (x > 3.0) return 1.0;
        if (x < -3.0) return -1.0;
        const double x2 = x * x;
        return x * (27.0 + x2) / (27.0 + 9.0 * x2);
    }
private:
    void resync() { c_ = std::cos(kTwoPi * phi_); s_ = std::sin(kTwoPi * phi_); }
    double sr_{48000.0}, W_{4000.0}, dphi_{-1.0 / 4000.0}, phi0_{0.0}, phi_{0.0}, c_{1.0}, s_{0.0}, rc_{1.0}, rs_{0.0};
    DelayBuf buf_;
    double hp_{0}, lp_{0}, hpA_{0.01}, lpA_{0.5}, pin_{0}, pout_{0}, pw_{0.001}, gain_{1.0};
    int cnt_{0};
};

// -------------------------------------------------------------------------------------
//  Reverb FDN con shimmer
// -------------------------------------------------------------------------------------
class ShimmerVerb {
public:
    void prepare(double sr) {
        sr_ = sr;
        static const int base[kFdn] = { 1117, 1301, 1559, 1823, 2111, 2393, 2699, 3067 };
        sumD_ = 0.0;
        modDepth_ = 0.0004 * sr;
        for (int i = 0; i < kFdn; ++i) {
            d_[i] = std::round(base[i] * sr / 48000.0);
            sumD_ += d_[i];
            line_[i].alloc(static_cast<size_t>(d_[i] + modDepth_ + 8));
            const double rate = 0.07 + 0.043 * i;
            modRc_[i] = std::cos(kTwoPi * rate / sr);
            modRs_[i] = std::sin(kTwoPi * rate / sr);
            modC_[i] = std::cos(0.7 * i);
            modS_[i] = std::sin(0.7 * i);
        }
        static const int apL[4] = { 142, 107, 379, 277 }, apR[4] = { 157, 113, 403, 293 };
        for (int i = 0; i < 4; ++i) {
            apBufL_[i].assign(static_cast<size_t>(std::max(8.0, std::round(apL[i] * sr / 48000.0))), 0.0);
            apBufR_[i].assign(static_cast<size_t>(std::max(8.0, std::round(apR[i] * sr / 48000.0))), 0.0);
            apIdxL_[i] = apIdxR_[i] = 0;
        }
        for (int k = 0; k < kPs; ++k) ps_[k].prepare(sr, 0.085 * (1.0 + 0.11 * k), 0x1234567u + 7919u * static_cast<uint32_t>(k));
        pLp_ = std::exp(-kTwoPi * 3000.0 / sr);
        reset();
        setRt60(6.0);
        setShimmer(0.0, 0);
    }
    void reset() {
        for (auto& l : line_) l.clear();
        for (auto& l : lp_) l = 0.0;
        for (auto& b : apBufL_) std::fill(b.begin(), b.end(), 0.0);
        for (auto& b : apBufR_) std::fill(b.begin(), b.end(), 0.0);
        for (auto& p : ps_) p.reset();
    }
    // RT60 real: g por linea = 10^(-3 d / (RT60 fs)) en LF; en HF el tiempo cae a hfRatio * RT60
    void setRt60(double rtParam) {
        rtParam = clampT(rtParam, 0.3, 30.0);
        if (rtParam == rtLast_ && !dirty_) return;
        rtLast_ = rtParam;
        dirty_ = false;
        // la amortiguacion en estante acorta el RT60 medido ~15-20 %: se repone (calibrado con la integral de Schroeder)
        const double rt = rtParam * (1.17 + 0.2 / (1.0 + 2.0 * rtParam)) * (1.0 + 0.2 * shimAmt_);
        const double hfOld = rt > 3.0 ? 0.35 : (0.35 + 0.15 * (3.0 - rt) / 3.0);
        // damping 0..1 (0.7375 = calibracion original): mas damping = agudos de la cola mueren antes (sala/placa calida)
        const double hfRatio = clampT(hfOld * std::pow(2.2, (0.7375 - damping_) * 2.0), 0.08, 0.95);
        for (int i = 0; i < kFdn; ++i) {
            const double glf = std::min(0.99995, std::pow(10.0, -3.0 * d_[i] / (rt * sr_)));
            const double ghf = std::min(glf, std::pow(10.0, -3.0 * d_[i] / (rt * hfRatio * sr_)));
            glf_[i] = glf;
            dg_[i] = glf - ghf;
            ghf_[i] = ghf;
        }
        wetNorm_ = clampT(0.9 * std::sqrt(13.8 * sumD_ / (rt * sr_)), 0.35, 2.5);
    }
    // amount 0..1 -> angulo de rotacion; interval 0:+12 1:+7 2:+24
    void setShimmer(double amount, int interval) {
        const double amt = clampT(amount, 0.0, 1.0);
        if (amt != shimAmt_) { shimAmt_ = amt; dirty_ = true; setRt60(rtLast_); }
        const double th = shimAmt_ * kTwoPi / 10.0;   // hasta 36 grados por pasada
        sn_ = std::sin(th);
        cs_ = std::cos(th);
        static const double ratio[3] = { 2.0, 1.4983070768766815, 4.0 };
        const double r = ratio[clampT(interval, 0, 2)];
        for (auto& p : ps_) p.setRatio(r);
    }
    void setDamping(double d) { d = clampT(d, 0.0, 1.0); if (d != damping_) { damping_ = d; dirty_ = true; setRt60(rtLast_); } }
    double wetNorm() const { return wetNorm_; }
    double sumDelay() const { return sumD_; }

    inline void process(double inL, double inR, double& outL, double& outR) {
        if (++modCnt_ >= 1024) {   // evita la deriva de amplitud de los osciladores de rotacion
            modCnt_ = 0;
            for (int i = 0; i < kFdn; ++i) { const double m = 1.0 / std::sqrt(modC_[i] * modC_[i] + modS_[i] * modS_[i]); modC_[i] *= m; modS_[i] *= m; }
        }
        // difusion de entrada (4 allpass en serie por lado)
        double xl = inL, xr = inR;
        for (int i = 0; i < 4; ++i) { xl = allpass(apBufL_[i], apIdxL_[i], xl); xr = allpass(apBufR_[i], apIdxR_[i], xr); }
        // lectura de lineas + amortiguacion en estante + ganancia
        double z[kFdn];
        for (int i = 0; i < kFdn; ++i) {
            const double D = d_[i] + modDepth_ * modS_[i];
            const double nc = modC_[i] * modRc_[i] - modS_[i] * modRs_[i];
            modS_[i] = modS_[i] * modRc_[i] + modC_[i] * modRs_[i];
            modC_[i] = nc;
            const double y = line_[i].read(D);
            lp_[i] = (1.0 - pLp_) * y + pLp_ * lp_[i];
            z[i] = ghf_[i] * y + dg_[i] * lp_[i];
        }
        // salida (filas ortogonales de Hadamard, estereo decorrelacionado)
        double oL = 0.0, oR = 0.0;
        for (int i = 0; i < kFdn; ++i) { oL += kRowL[i] * z[i]; oR += kRowR[i] * z[i]; }
        outL = oL * kInvSqrt8 * wetNorm_;
        outR = oR * kInvSqrt8 * wetNorm_;
        // matriz de mezcla ortogonal (Hadamard normalizada)
        double w[kFdn];
        for (int i = 0; i < kFdn; ++i) w[i] = z[i];
        for (int h = 1; h < kFdn; h <<= 1)
            for (int i = 0; i < kFdn; i += 2 * h)
                for (int j = i; j < i + h; ++j) { const double a = w[j], b = w[j + h]; w[j] = a + b; w[j + h] = a - b; }
        for (int i = 0; i < kFdn; ++i) w[i] *= kInvSqrt8;
        // shimmer: rotacion entre pares (k, k+4) a traves del pitch shifter granular
        for (int k = 0; k < kPs; ++k) {
            const double s = w[k];
            const double r = ps_[k].process(s);
            w[k] = cs_ * s;
            w[k + 4] += sn_ * r;
        }
        // inyeccion de la entrada (vectores Hadamard distintos por canal)
        for (int i = 0; i < kFdn; ++i) w[i] += (kInL[i] * xl + kInR[i] * xr) * kInvSqrt8;
        for (int i = 0; i < kFdn; ++i) line_[i].push(w[i]);
    }

private:
    static inline double allpass(std::vector<double>& b, int& idx, double x) {
        const double g = 0.55;
        const double d = b[static_cast<size_t>(idx)];
        const double v = x - g * d;
        b[static_cast<size_t>(idx)] = v;
        if (++idx >= static_cast<int>(b.size())) idx = 0;
        return d + g * v;
    }
    // filas de Hadamard 8x8 (+-1): salida L = fila 3, R = fila 5; entrada L = fila 6, R = fila 7... (ver abajo)
    static constexpr double kInvSqrt8 = 0.35355339059327373;
    static constexpr double kRowL[kFdn] = { 1, 1, -1, -1, -1, -1, 1, 1 };
    static constexpr double kRowR[kFdn] = { 1, -1, 1, -1, -1, 1, -1, 1 };
    static constexpr double kInL[kFdn] = { 1, 1, -1, -1, 1, 1, -1, -1 };
    static constexpr double kInR[kFdn] = { 1, -1, -1, 1, 1, -1, -1, 1 };

    bool dirty_{true};
    double damping_{0.7375};
    int modCnt_{0};
    double shimAmt_{0}, rtLast_{-1.0}, sr_{48000.0}, sumD_{0}, modDepth_{19}, wetNorm_{1}, pLp_{0.5}, sn_{0}, cs_{1};
    double d_[kFdn]{}, glf_[kFdn]{}, ghf_[kFdn]{}, dg_[kFdn]{}, lp_[kFdn]{}, modC_[kFdn]{}, modS_[kFdn]{}, modRc_[kFdn]{}, modRs_[kFdn]{};
    DelayBuf line_[kFdn];
    std::vector<double> apBufL_[4], apBufR_[4];
    int apIdxL_[4]{}, apIdxR_[4]{};
    GrainShifter ps_[kPs];
};

// -------------------------------------------------------------------------------------
//  Chorus ensemble (3 taps por canal, LFOs lentos desfasados)
// -------------------------------------------------------------------------------------
class Ensemble {
public:
    void prepare(double sr) {
        sr_ = sr;
        bl_.alloc(static_cast<size_t>(0.06 * sr));
        br_.alloc(static_cast<size_t>(0.06 * sr));
        static const double rate[3] = { 0.17, 0.23, 0.31 };
        for (int k = 0; k < 3; ++k) {
            inc_[k] = kTwoPi * rate[k] / sr;
            phL_[k] = kTwoPi * k / 3.0;
            phR_[k] = kTwoPi * (k / 3.0 + 1.0 / 6.0);
        }
    }
    void reset() { bl_.clear(); br_.clear(); }
    inline void process(double inL, double inR, double mix, double& oL, double& oR) {
        bl_.push(inL);
        br_.push(inR);
        double wl = 0.0, wr = 0.0;
        for (int k = 0; k < 3; ++k) {
            const double dl = (0.0135 + 0.0013 * k + 0.0035 * std::sin(phL_[k])) * sr_;
            const double dr = (0.0135 + 0.0013 * k + 0.0035 * std::sin(phR_[k])) * sr_;
            wl += bl_.read(dl);
            wr += br_.read(dr);
            phL_[k] += inc_[k]; if (phL_[k] > kTwoPi) phL_[k] -= kTwoPi;
            phR_[k] += inc_[k] * 1.07; if (phR_[k] > kTwoPi) phR_[k] -= kTwoPi;
        }
        wl *= (1.0 / 3.0);
        wr *= (1.0 / 3.0);
        oL = inL * (1.0 - 0.5 * mix) + wl * 0.8 * mix;
        oR = inR * (1.0 - 0.5 * mix) + wr * 0.8 * mix;
    }
private:
    double sr_{48000.0}, inc_[3]{}, phL_[3]{}, phR_[3]{};
    DelayBuf bl_, br_;
};

// -------------------------------------------------------------------------------------
//  Filtro paso alto Butterworth de 2.o orden (envio a la reverb: sin graves < 150 Hz)
// -------------------------------------------------------------------------------------
struct HighPass2 {
    double b0{1}, b1{-2}, b2{1}, a1{0}, a2{0}, z1[2]{}, z2[2]{};
    void design(double sr, double fc) {
        const double w = std::tan(kPi * std::min(fc, 0.45 * sr) / sr), n = 1.0 / (1.0 + 1.41421356237 * w + w * w);
        b0 = n; b1 = -2.0 * n; b2 = n;
        a1 = 2.0 * (w * w - 1.0) * n; a2 = (1.0 - 1.41421356237 * w + w * w) * n;
    }
    void reset() { z1[0] = z1[1] = z2[0] = z2[1] = 0.0; }
    inline double process(int c, double x) {
        const double y = b0 * x + z1[c];
        z1[c] = b1 * x - a1 * y + z2[c];
        z2[c] = b2 * x - a2 * y;
        return y;
    }
};

// SVF TPT paso bajo estereo para el camino de muestras (cutoff lento modulado por un LFO muy lento)
struct SlowLowpass {
    double ic1[2]{}, ic2[2]{}, a1[2]{1, 1}, a2[2]{}, a3[2]{};
    void reset() { ic1[0] = ic1[1] = ic2[0] = ic2[1] = 0.0; }
    void setCutoff(int c, double fc, double sr, double k) {
        const double g = std::tan(kPi * clampT(fc, 20.0, 0.45 * sr) / sr);
        a1[c] = 1.0 / (1.0 + g * (g + k)); a2[c] = g * a1[c]; a3[c] = g * a2[c];
    }
    inline double process(int c, double x) {
        const double v3 = x - ic2[c];
        const double v1 = a1[c] * ic1[c] + a2[c] * v3;
        const double v2 = ic2[c] + a2[c] * ic1[c] + a3[c] * v3;
        ic1[c] = 2.0 * v1 - ic1[c];
        ic2[c] = 2.0 * v2 - ic2[c];
        return v2;
    }
};

// Delay de cinta estereo (cruzado): tiempo suavizado, wow (0.55 Hz) y flutter (6.3 Hz) en el tiempo de lectura,
// realimentacion con paso bajo 3.2 kHz + paso alto 130 Hz + saturacion tanh (cada repeticion mas oscura y suave).
// Estabilidad: ganancia de lazo <= 0.9 * (|tanh|<1) y filtros pasivos.
class TapeDelay {
public:
    void prepare(double sr) {
        sr_ = sr;
        bl_.alloc(static_cast<size_t>(1.4 * sr) + 64);
        br_.alloc(static_cast<size_t>(1.4 * sr) + 64);
        lpA_ = 1.0 - std::exp(-kTwoPi * 3200.0 / sr);
        hpA_ = 1.0 - std::exp(-kTwoPi * 130.0 / sr);
        tK_ = 1.0 - std::exp(-1.0 / (0.25 * sr));   // el tiempo cambia con inercia de cinta (250 ms)
        wowInc_ = kTwoPi * 0.55 / sr; flInc_ = kTwoPi * 6.3 / sr;
        reset();
    }
    void reset() { bl_.clear(); br_.clear(); lpL_ = lpR_ = hpL_ = hpR_ = 0.0; wow_ = 0.0; fl_ = 1.3; tCur_ = -1.0; }
    inline void process(double inL, double inR, double timeMs, double fb, double& oL, double& oR) {
        const double tTarget = clampT(timeMs, 20.0, 1200.0) * 0.001 * sr_;
        if (tCur_ < 0.0) tCur_ = tTarget;
        tCur_ += tK_ * (tTarget - tCur_);
        wow_ += wowInc_; if (wow_ > kTwoPi) wow_ -= kTwoPi;
        fl_ += flInc_; if (fl_ > kTwoPi) fl_ -= kTwoPi;
        const double mod = (0.0007 * std::sin(wow_) + 0.00015 * std::sin(fl_)) * sr_;
        const double dL = clampT(tCur_ + mod, 8.0, 1.35 * sr_), dR = clampT(tCur_ * 1.0 - mod * 0.8 + 0.011 * sr_, 8.0, 1.35 * sr_);   // R algo mas larga: ensancha
        oL = bl_.read(dL);
        oR = br_.read(dR);
        auto fbPath = [&](double x, double& lp, double& hp) {
            lp += lpA_ * (x - lp);
            hp += hpA_ * (lp - hp);
            const double y = lp - hp;
            return y / (1.0 + std::fabs(y) * 0.6);   // saturacion suave (acotada)
        };
        const double fl = fbPath(oL, lpL_, hpL_), fr = fbPath(oR, lpR_, hpR_);
        bl_.push(inL + fb * fr);      // cruzado: L realimenta con R
        br_.push(inR + fb * fl);
    }
private:
    double sr_{48000.0}, lpA_{0.3}, hpA_{0.01}, tK_{0.0001}, wowInc_{0}, flInc_{0}, wow_{0}, fl_{0}, tCur_{-1.0};
    double lpL_{0}, lpR_{0}, hpL_{0}, hpR_{0};
    DelayBuf bl_, br_;
};

// Compresor suave de bus (feed-forward, detector enlazado, rodilla suave de 8 dB, ataque 30 ms, release 450 ms)
class SoftComp {
public:
    void prepare(double sr) {
        aA_ = 1.0 - std::exp(-1.0 / (0.030 * sr));
        aR_ = 1.0 - std::exp(-1.0 / (0.450 * sr));
        reset();
    }
    void reset() { env_ = 0.0; gr_ = 1.0; }
    // amount 0..1: razon 1 -> 3, umbral fijo -20 dBFS, compensacion de ganancia parcial
    inline void process(double& l, double& r, double amount) {
        if (amount < 1.0e-4) { env_ = 0.0; return; }
        const double a = std::max(std::fabs(l), std::fabs(r));
        env_ += (a > env_ ? aA_ : aR_) * (a - env_);
        const double lev = 20.0 * std::log10(env_ + 1.0e-9);
        const double ratio = 1.0 + 2.0 * amount, over = lev + 20.0, knee = 8.0;
        double red;   // dB de reduccion
        if (over <= -0.5 * knee) red = 0.0;
        else if (over >= 0.5 * knee) red = over * (1.0 - 1.0 / ratio);
        else { const double x = over + 0.5 * knee; red = (1.0 - 1.0 / ratio) * x * x / (2.0 * knee); }
        const double makeup = 3.0 * amount;
        const double g = std::pow(10.0, (makeup - red) * 0.05);
        l *= g; r *= g;
        grDb_ = red;
    }
    double grDb() const { return grDb_; }
private:
    double aA_{0.001}, aR_{0.0001}, env_{0}, gr_{1}, grDb_{0};
};

// -------------------------------------------------------------------------------------
//  Motor
//  Hibrido: si el banco `shimmer-pad.jws` esta cargado, las notas que cubre suenan con MUESTRAS (tres capas de
//  timbre apiladas: New Age = cuerpo, Choir = aire vocal, Bowed = textura de arco, ver noteOnStack) y pasan por el
//  mismo ensemble + reverb shimmer; si no, suena el motor modelado (supersaw + wavetable).
// -------------------------------------------------------------------------------------
class PadEngine {
public:
    PadEngine() = default;

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        invSr_ = 1.0 / sr_;
        sampler_.prepare(sr_);
        if (!samplerLoadStarted_) { samplerLoadStarted_ = true; sampler_.startLoad("shimmer-pad"); }
        {   // humanizacion de pad: afinacion por golpe amplia (efecto coro natural), entrada desfasada hasta 40 ms
            JwSampler::Humanize h;
            h.gainDb = 1.0f; h.detuneCents = 6.0f; h.timingMs = 40.0f; h.velCurve = 0.35f;
            sampler_.setHumanize(h);
            sampler_.setDrift(5.0f, 0.06f);
        }
        sendHp_.design(sr_, 150.0);
        sendHp_.reset();
        slp_.reset();
        sLfoPh_ = 0.0;
        sL_.assign(kChunk, 0.0f);
        sR_.assign(kChunk, 0.0f);
        tables_.build(sr_);
        verb_.prepare(sr_);
        chorus_.prepare(sr_);
        mixL_.assign(kChunk, 0.0);
        mixR_.assign(kChunk, 0.0);
        killLen_ = std::max(16, static_cast<int>(0.005 * sr_));
        driftK_ = 1.0 - std::exp(-static_cast<double>(kTick) / (0.6 * sr_));
        fcMax_ = std::min(20000.0, 0.45 * sr_);
        vol_.prepare(sr_, 20.0); wet_.prepare(sr_, 8.0);
        bend_.prepare(sr_, 12.0); mw_.prepare(sr_, 25.0); at_.prepare(sr_, 40.0);
        cut_.prepare(sr_, 30.0); res_.prepare(sr_, 30.0); det_.prepare(sr_, 80.0); sub_.prepare(sr_, 60.0);
        chs_.prepare(sr_, 80.0); rvs_.prepare(sr_, 80.0); shs_.prepare(sr_, 120.0); rts_.prepare(sr_, 150.0);
        lcs_.prepare(sr_, 80.0); tns_.prepare(sr_, 80.0); cps_.prepare(sr_, 80.0); dms_.prepare(sr_, 80.0); dfs_.prepare(sr_, 80.0);
        drs_.prepare(sr_, 80.0); wds_.prepare(sr_, 80.0); tus_.prepare(sr_, 80.0); dps_.prepare(sr_, 150.0);
        delay_.prepare(sr_); comp_.prepare(sr_); mHp_.reset(); slpT_.reset();
        fx_.prepare(sr_);
        hpA_ = 1.0 - std::exp(-kTwoPi * 6.0 / sr_);
        applySmootherTargets(true);
        reset();
        seed_ = 0xC0FFEEu;
    }
    // FX Rack comun (jw_fxrack.h): se procesa al final de la cadena, antes de los medidores y del espectro
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    void setTempo(double bpm) { fx_.setTempo(bpm); }
    JasWaveFx::FxRack& fx() { return fx_; }
    void settle() { applySmootherTargets(true); }   // salta los suavizados al valor actual (pruebas)
    void reset() {
        for (auto& v : voices_) v.active = false;
        sampler_.panic();
        sampler_.setSustain(false);
        sendHp_.reset();
        slp_.reset(); slpT_.reset(); mHp_.reset(); delay_.reset(); comp_.reset(); delayLive_ = false;
        heldKeys_[0] = heldKeys_[1] = 0;
        pedal_ = false;
        verb_.reset();
        chorus_.reset();
        fx_.reset();
        dcL_ = dcR_ = 0.0;
        silent_ = false; quiet_ = 0;
        orderCtr_ = 0;
    }
    void setSettings(const PadSettings& s) {
        if (s.sustain != s_.sustain) setPedal(s.sustain);
        s_ = s;
        applySmootherTargets(false);
        pushSamplerParams();
    }

    void noteOn(int note, float vel) {
        if (note < 0 || note > 127) return;
        if (vel <= 0.0f) { noteOff(note); return; }
        // banco listo y con zona para la nota: muestras (si no, el motor modelado cubre la nota)
        if (sampler_.ready() && sampler_.hasZone(note, vel)) {
            if (sampler_.noteOnStack(note, vel) > 0) { heldKeys_[note >> 6] |= 1ull << (note & 63); return; }
        }
        Voice* freeV = nullptr;
        int used = 0;
        for (auto& v : voices_) {
            if (v.active) { if (!v.killing || v.pendingNote >= 0) ++used; }
            else if (!freeV) freeV = &v;
        }
        if (freeV) { start(*freeV, note, vel, used); return; }
        // robo: la mas antigua, preferentemente entre las ya liberadas (fundido de 5 ms, sin clic)
        Voice* victim = nullptr;
        for (auto& v : voices_) {
            if (!v.active || v.killing) continue;
            if (!victim) { victim = &v; continue; }
            const bool vr = v.released, br = victim->released;
            if (vr != br) { if (vr) victim = &v; }
            else if (v.order < victim->order) victim = &v;
        }
        if (victim) { startKill(*victim, note, vel); return; }
        for (auto& v : voices_) if (v.active && v.killing) { v.pendingNote = note; v.pendingVel = vel; return; }
    }
    void noteOff(int note) {
        if (note >= 0 && note < 128) heldKeys_[note >> 6] &= ~(1ull << (note & 63));
        sampler_.noteOff(note);
        for (auto& v : voices_) {
            if (v.active && v.killing && v.pendingNote == note) { v.pendingNote = -1; continue; }   // nota pendiente cancelada
            if (!v.active || v.killing || v.note != note || v.keyUp) continue;
            v.keyUp = true;
            if (!pedal_) v.released = true;
        }
    }
    // Controladores recibidos como eventos MIDI heredados (ademas de los parametros mapeados por IMidiMapping)
    void setBend(double st) { s_.bendSemi = st; bend_.setTarget(clampT(st, -12.0, 12.0)); }
    bool samplerReady() const { return sampler_.ready(); }
    bool samplerLoading() const { return sampler_.loading(); }
    int samplerVoices() const { return sampler_.activeVoices(); }
    void setModWheel(double x) { s_.modWheel = x; mw_.setTarget(clampT(x, 0.0, 1.0)); }
    void setAftertouch(double x) { s_.aftertouch = x; at_.setTarget(clampT(x, 0.0, 1.0)); }
    void allNotesOff() { heldKeys_[0] = heldKeys_[1] = 0; sampler_.allNotesOff(); for (auto& v : voices_) if (v.active && !v.killing) { v.keyUp = true; v.released = true; } }
    void allSoundOff() { heldKeys_[0] = heldKeys_[1] = 0; sampler_.panic(); for (auto& v : voices_) if (v.active && !v.killing) startKill(v, -1, 0.0f); }
    void setPedal(bool down) {
        pedal_ = down;
        sampler_.setSustain(down);
        if (!down) for (auto& v : voices_) if (v.active && v.keyUp) v.released = true;
    }

    template <class T>
    void render(T* outL, T* outR, int n, PadBus* bus) {
        float pk[2] = { 0, 0 };
        int pos = 0;
        while (pos < n) {
            const int m = std::min(kChunk, n - pos);
            renderChunk(outL + pos, outR + pos, m, pk);
            pos += m;
        }
        if (fx_.activo()) {
            fx_.process(outL, outR, n, bus);
            pk[0] = pk[1] = 0.0f;
            for (int i = 0; i < n; ++i) { pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i])))); pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i])))); }
        } else fx_.process(outL, outR, n, bus);
        if (bus) {
            bus->salida(outL, outR, n);
            bus->outPk[0].update(pk[0]);
            bus->outPk[1].update(pk[1]);
            uint64_t k0 = heldKeys_[0], k1 = heldKeys_[1];
            int act = std::min(kMaxVoices, (sampler_.activeVoices() + 2) / 3);   // ~3 capas por nota
            for (const auto& v : voices_) {
                if (!v.active) continue;
                ++act;
                if (v.note < 64) k0 |= 1ull << v.note; else k1 |= 1ull << (v.note - 64);
            }
            bus->keys[0].store(k0, std::memory_order_relaxed);
            bus->keys[1].store(k1, std::memory_order_relaxed);
            bus->activeVoices.store(act, std::memory_order_relaxed);
            bus->maxVoices.store(kMaxVoices, std::memory_order_relaxed);
            bus->cutoffHz.store(static_cast<float>(std::exp2(cut_.current())), std::memory_order_relaxed);
            bus->shimmerLevel.store(static_cast<float>(shimEnv_), std::memory_order_relaxed);
        }
    }

    int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a; }
    double sampleRate() const { return sr_; }
    double fundamental(int note) const { return 440.0 * std::pow(2.0, (note - 69) / 12.0); }
    ShimmerVerb& verb() { return verb_; }

private:
    struct Voice {
        bool active{false}, keyUp{false}, released{false}, killing{false}, first{true};
        int note{-1}, pendingNote{-1}, nSaw{0}, ctr{0}, driftCnt{0};
        float pendingVel{0.0f};
        uint64_t order{0};
        double baseF{440.0}, velAmp{1.0}, velOct{0.0}, env{0.0}, killGain{1.0}, killStep{0.0}, flip{1.0};
        Xor rng;
        uint32_t sawPh[kMaxUnison]{}, sawInc[kMaxUnison]{};
        double sawPos[kMaxUnison]{}, sawDr[kMaxUnison]{}, sawDrT[kMaxUnison]{}, sawGL[kMaxUnison]{}, sawGR[kMaxUnison]{};
        uint32_t wtPh[2]{}, wtInc[2]{};
        double wtPos[2]{}, wtDr[2]{}, wtDrT[2]{}, wtGL[2]{}, wtGR[2]{};
        const float* tab[2]{};
        const float* sawTab[kMaxUnison]{};
        int morphIdx{0}, nWt{2};
        uint32_t subPh{0}, subInc{0};
        double subDr{0}, subDrT{0};
        double lfoPh{0}, lfoPh2{0}, lfoMul{1.0};
        double ic1[2]{}, ic2[2]{}, g[2]{}, dg[2]{}, a1[2]{}, a2[2]{}, a3[2]{}, k{1.0}, comp{1.0};
        double sawScale{1.0}, wtScale{1.0}, subGain{0.0};
    };

    void applySmootherTargets(bool jump) {
        const double fc = clampT(s_.cutoffHz, 20.0, 20000.0);
        vol_.setTarget(dbToLinear(s_.volumeDb));
        wet_.setTarget(s_.bypass ? 0.0 : 1.0);
        bend_.setTarget(clampT(s_.bendSemi, -12.0, 12.0));
        mw_.setTarget(clampT(s_.modWheel, 0.0, 1.0));
        at_.setTarget(clampT(s_.aftertouch, 0.0, 1.0));
        cut_.setTarget(std::log2(fc));
        res_.setTarget(clampT(s_.resonance, 0.0, 1.0));
        det_.setTarget(clampT(s_.detune, 0.0, 1.0));
        sub_.setTarget(clampT(s_.sub, 0.0, 1.0));
        chs_.setTarget(clampT(s_.chorus, 0.0, 1.0));
        lcs_.setTarget(std::log2(clampT(s_.lowCutHz, 20.0, 400.0))); tns_.setTarget(std::log2(clampT(s_.toneHz, 1000.0, 20000.0)));
        cps_.setTarget(clampT(s_.comp, 0.0, 1.0)); dms_.setTarget(clampT(s_.delayMix, 0.0, 1.0));
        dfs_.setTarget(clampT(s_.delayFb, 0.0, 0.9)); drs_.setTarget(clampT(s_.drive, 0.0, 1.0));
        wds_.setTarget(clampT(s_.width, 0.0, 1.5)); tus_.setTarget(clampT(s_.tuneCents, -50.0, 50.0)); dps_.setTarget(clampT(s_.damping, 0.0, 1.0));
        rvs_.setTarget(clampT(s_.reverb, 0.0, 1.0));
        shs_.setTarget(clampT(s_.shimmer, 0.0, 1.0));
        rts_.setTarget(std::log(clampT(s_.rt60, 0.5, 20.0)));
        if (jump) {
            vol_.reset(vol_.target()); wet_.reset(wet_.target()); bend_.reset(bend_.target()); mw_.reset(mw_.target());
            at_.reset(at_.target()); cut_.reset(cut_.target()); res_.reset(res_.target()); det_.reset(det_.target());
            sub_.reset(sub_.target()); chs_.reset(chs_.target());
            lcs_.reset(lcs_.target()); tns_.reset(tns_.target()); cps_.reset(cps_.target()); dms_.reset(dms_.target()); dfs_.reset(dfs_.target());
            drs_.reset(drs_.target()); wds_.reset(wds_.target()); tus_.reset(tus_.target()); dps_.reset(dps_.target()); rvs_.reset(rvs_.target()); shs_.reset(shs_.target());
            rts_.reset(rts_.target());
        }
    }

    uint32_t phaseInc(double f) const { return static_cast<uint32_t>(std::min(f * invSr_, 0.45) * 4294967296.0); }

    void startKill(Voice& v, int pendingNote, float vel) {
        v.killing = true;
        v.killStep = std::max(1.0e-9, v.killGain / killLen_);
        v.pendingNote = pendingNote;
        v.pendingVel = vel;
    }

    void start(Voice& v, int note, float velIn, int usedVoices) {
        v = Voice{};
        v.active = true;
        v.note = note;
        v.baseF = 440.0 * std::exp2((note - 69) / 12.0);
        v.order = ++orderCtr_;
        v.rng.seed(seed_ ^ (static_cast<uint32_t>(note) * 2654435761u));
        seed_ = seed_ * 1664525u + 1013904223u + static_cast<uint32_t>(velIn * 977.0f);
        Xor& r = v.rng;
        v.velAmp = 0.45 + 0.55 * velIn;
        v.velOct = (velIn - 0.6) * 1.4;
        v.flip = r.uni() < 0.5 ? -1.0 : 1.0;
        v.nSaw = usedVoices < 3 ? 7 : (usedVoices < 6 ? 5 : (usedVoices < 10 ? 3 : 2));   // calidad adaptativa (CPU)
        v.nWt = usedVoices < 8 ? 2 : 1;
        const int n = v.nSaw;
        const double width = 0.9;
        const double gSaw = 1.05 / std::sqrt(static_cast<double>(n));   // tabla saw de RMS 0.30
        for (int i = 0; i < n; ++i) {
            double p = n == 1 ? 0.0 : (static_cast<double>(i) / (n - 1)) * 2.0 - 1.0;
            p = clampT(p + 0.08 * r.bi(), -1.0, 1.0);
            v.sawPos[i] = p;
            v.sawPh[i] = r.u32();
            v.sawDr[i] = v.sawDrT[i] = r.bi() * 3.0 * s_.driftScale;
            const double pan = clampT(p * v.flip * width, -1.0, 1.0);
            const double a = (pan + 1.0) * kPi * 0.25;
            v.sawGL[i] = std::cos(a) * gSaw;
            v.sawGR[i] = std::sin(a) * gSaw;
        }
        for (int j = 0; j < v.nWt; ++j) {
            v.wtPos[j] = v.nWt == 1 ? 0.0 : (j == 0 ? -0.6 : 0.6) + 0.05 * r.bi();
            v.wtPh[j] = r.u32();
            v.wtDr[j] = v.wtDrT[j] = r.bi() * 2.0 * s_.driftScale;
            const double pan = v.wtPos[j] * v.flip * 0.9;
            const double a = (pan + 1.0) * kPi * 0.25;
            const double gw = v.nWt == 1 ? 0.62 * 1.35 : 0.62;
            v.wtGL[j] = std::cos(a) * gw;
            v.wtGR[j] = std::sin(a) * gw;
        }
        v.subPh = r.u32();
        v.subDr = v.subDrT = r.bi() * 1.5 * s_.driftScale;
        v.morphIdx = std::min(kMorphs - 1, static_cast<int>(r.uni() * kMorphs));
        v.lfoPh = r.uni();
        v.lfoPh2 = r.uni();
        v.lfoMul = 0.93 + 0.14 * r.uni();
        v.driftCnt = static_cast<int>((0.8 + 1.7 * r.uni()) * sr_ / kTick);
        v.first = true;
        v.ctr = 0;
        v.env = 0.0;
        v.killGain = 1.0;
        if (pedal_) { /* la nota nueva no esta liberada */ }
    }

    // Parametros por bloque (suavizados)
    struct BlockParams {
        double bendF, mw, at, cutOct, resK, resComp, detCents, subG, lfoHz, lfoDepth, aK, relCoef, brightness;
    };

    void tick(Voice& v, const BlockParams& P) {
        const double f0 = v.baseF * P.bendF;
        if (--v.driftCnt <= 0) {
            const double dm = s_.driftScale;
            for (int i = 0; i < v.nSaw; ++i) v.sawDrT[i] = v.rng.bi() * 3.0 * dm;
            for (int j = 0; j < v.nWt; ++j) v.wtDrT[j] = v.rng.bi() * 2.0 * dm;
            v.subDrT = v.rng.bi() * 1.5 * dm;
            v.driftCnt = static_cast<int>((0.8 + 1.7 * v.rng.uni()) * sr_ / kTick);
        }
        for (int i = 0; i < v.nSaw; ++i) {
            v.sawDr[i] += (v.sawDrT[i] - v.sawDr[i]) * driftK_;
            const double f = f0 * centsRatio(v.sawPos[i] * P.detCents + v.sawDr[i]);
            v.sawInc[i] = phaseInc(f);
            v.sawTab[i] = tables_.table(kSawShape, f);
        }
        for (int j = 0; j < v.nWt; ++j) {
            v.wtDr[j] += (v.wtDrT[j] - v.wtDr[j]) * driftK_;
            const double f = f0 * centsRatio(v.wtPos[j] * 0.6 * P.detCents + v.wtDr[j]);
            v.wtInc[j] = phaseInc(f);
            v.tab[j] = tables_.table(v.morphIdx, f);
        }
        v.subDr += (v.subDrT - v.subDr) * driftK_;
        v.subInc = phaseInc(0.5 * f0 * centsRatio(v.subDr));
        v.lfoPh += kTick * P.lfoHz * v.lfoMul * invSr_;
        v.lfoPh -= std::floor(v.lfoPh);
        v.lfoPh2 += kTick * P.lfoHz * 0.71 * v.lfoMul * invSr_;
        v.lfoPh2 -= std::floor(v.lfoPh2);
        const double lfo = std::sin(kTwoPi * v.lfoPh), lfoQ = std::sin(kTwoPi * v.lfoPh2);
        const double envC = std::min(1.0, v.env);
        const double oct = P.cutOct + 0.5 * (v.note - 60) / 12.0 + v.velOct + P.lfoDepth * lfo + P.mw * 2.2 + P.at * 1.0 - 1.4 * (1.0 - envC);
        for (int c = 0; c < 2; ++c) {
            const double oc = oct + (c == 0 ? 0.10 : -0.10) * lfoQ;
            const double fc = clampT(std::exp2(oc), 20.0, fcMax_);
            const double gT = std::tan(kPi * fc * invSr_);
            if (v.first) { v.g[c] = gT; v.dg[c] = 0.0; v.a1[c] = 1.0 / (1.0 + gT * (gT + P.resK)); v.a2[c] = gT * v.a1[c]; v.a3[c] = gT * v.a2[c]; }
            else v.dg[c] = (gT - v.g[c]) * (1.0 / kTick);
        }
        v.first = false;
        v.k = P.resK;
        v.comp = P.resComp;
        v.sawScale = 1.0 + 0.8 * P.mw;
        v.wtScale = 1.0;
        v.subGain = P.subG;
        v.ctr = kTick;
    }

    void renderVoice(Voice& v, int m, const BlockParams& P) {
        double* mixL = mixL_.data();
        double* mixR = mixR_.data();
        const float* sineT = tables_.sine();
        int done = 0;
        while (done < m && v.active) {
            if (v.ctr <= 0) tick(v, P);
            const int seg = std::min(v.ctr, m - done);
            double tL[kTick], tR[kTick];
            for (int i = 0; i < seg; ++i) { tL[i] = 0.0; tR[i] = 0.0; }
            // capa A: supersaw por wavetables band-limited (fase de 32 bits, una lectura por oscilador)
            for (int u = 0; u < v.nSaw; ++u) {
                uint32_t ph = v.sawPh[u];
                const uint32_t inc = v.sawInc[u];
                const float* t = v.sawTab[u];
                const double gl = v.sawGL[u] * v.sawScale, gr = v.sawGR[u] * v.sawScale;
                for (int i = 0; i < seg; ++i) {
                    ph += inc;
                    const double s = readTableFx(t, ph);
                    tL[i] += s * gl;
                    tR[i] += s * gr;
                }
                v.sawPh[u] = ph;
            }
            // capa B: wavetable calido<->cristal
            for (int j = 0; j < v.nWt; ++j) {
                uint32_t ph = v.wtPh[j];
                const uint32_t inc = v.wtInc[j];
                const float* t = v.tab[j];
                const double gl = v.wtGL[j], gr = v.wtGR[j];
                for (int i = 0; i < seg; ++i) {
                    ph += inc;
                    const double w = readTableFx(t, ph);
                    tL[i] += w * gl;
                    tR[i] += w * gr;
                }
                v.wtPh[j] = ph;
            }
            // sub-octava
            if (v.subGain > 1e-4) {
                uint32_t ph = v.subPh;
                const uint32_t inc = v.subInc;
                for (int i = 0; i < seg; ++i) {
                    ph += inc;
                    const double s = readTableFx(sineT, ph) * v.subGain;
                    tL[i] += s;
                    tR[i] += s;
                }
                v.subPh = ph;
            }
            const int c0 = v.ctr;
            for (int i = 0; i < seg; ++i) {
                const double sL = tL[i], sR = tR[i];
                // filtro SVF TPT/ZDF estereo (Zavalishin): L y R en un registro SSE2 (misma matematica en doble precision)
                double out[2];
#ifdef JW_PAD_SSE2
                {
                    __m128d g = _mm_add_pd(_mm_loadu_pd(v.g), _mm_loadu_pd(v.dg));
                    _mm_storeu_pd(v.g, g);
                    if (((c0 - i - 1) & 3) == 0) {
                        const __m128d one = _mm_set1_pd(1.0);
                        const __m128d a1n = _mm_div_pd(one, _mm_add_pd(one, _mm_mul_pd(g, _mm_add_pd(g, _mm_set1_pd(v.k)))));
                        const __m128d a2n = _mm_mul_pd(g, a1n);
                        _mm_storeu_pd(v.a1, a1n);
                        _mm_storeu_pd(v.a2, a2n);
                        _mm_storeu_pd(v.a3, _mm_mul_pd(g, a2n));
                    }
                    const __m128d a1 = _mm_loadu_pd(v.a1), a2 = _mm_loadu_pd(v.a2), a3 = _mm_loadu_pd(v.a3);
                    const __m128d ic1 = _mm_loadu_pd(v.ic1), ic2 = _mm_loadu_pd(v.ic2);
                    const __m128d v3 = _mm_sub_pd(_mm_set_pd(sR, sL), ic2);
                    const __m128d v1 = _mm_add_pd(_mm_mul_pd(a1, ic1), _mm_mul_pd(a2, v3));
                    const __m128d v2 = _mm_add_pd(_mm_add_pd(ic2, _mm_mul_pd(a2, ic1)), _mm_mul_pd(a3, v3));
                    const __m128d two = _mm_set1_pd(2.0);
                    _mm_storeu_pd(v.ic1, _mm_sub_pd(_mm_mul_pd(two, v1), ic1));
                    _mm_storeu_pd(v.ic2, _mm_sub_pd(_mm_mul_pd(two, v2), ic2));
                    _mm_storeu_pd(out, _mm_mul_pd(v2, _mm_set1_pd(v.comp)));
                }
#else
                {
                    const double in[2] = { sL, sR };
                    const bool upd = ((c0 - i - 1) & 3) == 0;
                    for (int c = 0; c < 2; ++c) {
                        v.g[c] += v.dg[c];
                        if (upd) { const double g = v.g[c]; v.a1[c] = 1.0 / (1.0 + g * (g + v.k)); v.a2[c] = g * v.a1[c]; v.a3[c] = g * v.a2[c]; }
                        const double a1 = v.a1[c], a2 = v.a2[c], a3 = v.a3[c];
                        const double v3 = in[c] - v.ic2[c];
                        const double v1 = a1 * v.ic1[c] + a2 * v3;
                        const double v2 = v.ic2[c] + a2 * v.ic1[c] + a3 * v3;
                        v.ic1[c] = 2.0 * v1 - v.ic1[c];
                        v.ic2[c] = 2.0 * v2 - v.ic2[c];
                        out[c] = v2 * v.comp;
                    }
                }
#endif
                // envolvente
                if (v.released) v.env *= P.relCoef;
                else if (v.env < 1.0) { v.env += (1.15 - v.env) * P.aK; if (v.env >= 1.0) v.env = 1.0; }
                double amp = v.env * v.velAmp;
                if (v.killing) { v.killGain -= v.killStep; if (v.killGain < 0.0) v.killGain = 0.0; amp *= v.killGain; }
                mixL[done + i] += out[0] * amp;
                mixR[done + i] += out[1] * amp;
                if ((v.killing && v.killGain <= 0.0) || (v.released && v.env < 1.0e-5)) { v.active = false; break; }
            }
            v.ctr -= seg;
            done += seg;
        }
        if (!v.active && v.killing && v.pendingNote >= 0) {
            const int pn = v.pendingNote;
            const float pv = v.pendingVel;
            int used = 0;
            for (const auto& o : voices_) if (o.active) ++used;
            start(v, pn, pv, used);
        }
    }

    // Parametros del sampler que afectan a las notas NUEVAS: deben estar puestos antes del noteOn (se llama desde setSettings)
    void pushSamplerParams() {
        sampler_.setAttack(static_cast<float>(clampT(s_.attack, 0.02, 12.0)));
        sampler_.setReleaseScale(static_cast<float>(clampT(s_.release, 0.1, 15.0) / 2.0));   // los pads del banco sueltan en ~2 s
        sampler_.setLevelDb(kSampledLevelDb);
        sampler_.setTuneCents(static_cast<float>(clampT(s_.tuneCents, -50.0, 50.0)));
    }

    // Camino de muestras: banco (3 capas apiladas) -> pasabajos lento con LFO en cuadratura L/R -> mezcla comun.
    void renderSampled(int m, double res) {
        std::fill(sL_.begin(), sL_.begin() + m, 0.0f);
        std::fill(sR_.begin(), sR_.begin() + m, 0.0f);
        sampler_.render(sL_.data(), sR_.data(), m);
        sLfoPh_ += s_.lfoHz * m * invSr_;
        sLfoPh_ -= std::floor(sLfoPh_);
        const double k = 2.0 * std::pow(0.03, res);
        const double base = cut_.current();
        for (int c = 0; c < 2; ++c) {
            const double lfo = std::sin(kTwoPi * (sLfoPh_ + 0.25 * c));
            slp_.setCutoff(c, std::exp2(base + 0.6 * s_.lfoDepthOct * lfo + 0.5 * mw_.current() * 2.2 + at_.current()), sr_, k);
        }
        for (int i = 0; i < m; ++i) {
            mixL_[static_cast<size_t>(i)] += slp_.process(0, sL_[static_cast<size_t>(i)]);
            mixR_[static_cast<size_t>(i)] += slp_.process(1, sR_[static_cast<size_t>(i)]);
        }
    }

    template <class T>
    void renderChunk(T* outL, T* outR, int m, float* pk) {
        const double vg0 = vol_.current(), vg1 = vol_.advance(m);
        const double w0 = wet_.current(), w1 = wet_.advance(m);
        bend_.advance(m); mw_.advance(m); at_.advance(m); cut_.advance(m); res_.advance(m);
        det_.advance(m); sub_.advance(m); chs_.advance(m); rvs_.advance(m); shs_.advance(m); rts_.advance(m);
        lcs_.advance(m); tns_.advance(m); cps_.advance(m); dms_.advance(m); dfs_.advance(m); drs_.advance(m); wds_.advance(m); tus_.advance(m); dps_.advance(m);

        BlockParams P;
        P.bendF = std::exp2(bend_.current() / 12.0 + tus_.current() / 1200.0);
        P.mw = mw_.current();
        P.at = at_.current();
        P.cutOct = cut_.current();
        const double res = res_.current();
        P.resK = 2.0 * std::pow(0.03, res);
        P.resComp = 1.0 / std::sqrt(1.0 + 3.0 * res * res);
        P.detCents = det_.current() * 28.0;
        P.subG = sub_.current() * 0.55;
        P.lfoHz = s_.lfoHz;
        P.lfoDepth = s_.lfoDepthOct;
        const double atk = clampT(s_.attack, 0.02, 12.0);
        const double tau = atk / std::log(1.15 / 0.15);
        P.aK = 1.0 - std::exp(-1.0 / (tau * sr_));
        P.relCoef = std::exp(std::log(1.0e-3) / (clampT(s_.release, 0.1, 15.0) * sr_));
        P.brightness = 0.0;

        bool anyVoice = false;
        for (const auto& v : voices_) if (v.active) { anyVoice = true; break; }
        const bool sampled = sampler_.ready();
        if (sampled && sampler_.activeVoices() > 0) anyVoice = true;
        if (anyVoice) silent_ = false;
        if (silent_) {   // sin voces y cola extinguida (< -120 dBFS): no se procesa nada (ahorro de CPU)
            for (int i = 0; i < m; ++i) { outL[i] = T(0); outR[i] = T(0); }
            shimEnv_ *= 0.8;
            return;
        }
        std::fill(mixL_.begin(), mixL_.begin() + m, 0.0);
        std::fill(mixR_.begin(), mixR_.begin() + m, 0.0);
        for (auto& v : voices_) if (v.active) renderVoice(v, m, P);
        if (sampled) renderSampled(m, res);

        verb_.setRt60(std::exp(rts_.current()));
        const double shAmt = shs_.current();
        verb_.setShimmer(shAmt, s_.interval);
        verb_.setDamping(dps_.current());
        mHp_.design(sr_, std::exp2(lcs_.current()));
        const double toneHz = std::exp2(tns_.current());
        slpT_.setCutoff(0, toneHz, sr_, 1.41421356); slpT_.setCutoff(1, toneHz, sr_, 1.41421356);
        const double cpA = cps_.current(), dmx = dms_.current(), dfb = dfs_.current(), dtime = s_.delayMs, wdt = wds_.current();
        const double drv = drs_.current(), dK = 1.0 + 3.0 * drv;
        const double chMix = chs_.current(), rvMix = rvs_.current();
        const double wetG = s_.wetOnly ? 1.0 : 0.95 * rvMix, dryG = s_.wetOnly ? 0.0 : 1.0 - 0.45 * rvMix;
        double shimAcc = 0.0, outAcc = 0.0;
        for (int i = 0; i < m; ++i) {
            double cl, cr;
            chorus_.process(mixL_[static_cast<size_t>(i)], mixR_[static_cast<size_t>(i)], chMix, cl, cr);
            double wl, wr;
            verb_.process(sendHp_.process(0, cl), sendHp_.process(1, cr), wl, wr);   // envio sin graves (< 150 Hz)
            const double t = static_cast<double>(i + 1) / m;
            const double g = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t) * kOutGain;
            double yl = cl * dryG + wl * wetG;
            double yr = cr * dryG + wr * wetG;
            // saturacion de cinta (ganancia pequena senal = 1; solo redondea los picos)
            if (drv > 1.0e-3) { yl = std::tanh(yl * dK) / dK; yr = std::tanh(yr * dK) / dK; }
            // delay de cinta (solo si hay mezcla o cola pendiente)
            if (dmx > 1.0e-3 || delayLive_) {
                double dl, dr;
                delay_.process(yl, yr, dtime, dfb, dl, dr);
                yl += dmx * dl; yr += dmx * dr;
                delayLive_ = dmx > 1.0e-3 || (std::fabs(dl) + std::fabs(dr)) > 1.0e-7;
            }
            comp_.process(yl, yr, cpA);
            // EQ: paso-altos (graves fuera de la mezcla) y paso-bajos de tono
            yl = slpT_.process(0, mHp_.process(0, yl)); yr = slpT_.process(1, mHp_.process(1, yr));
            // anchura mid/side
            { const double mid = 0.5 * (yl + yr), side = 0.5 * (yl - yr) * wdt; yl = mid + side; yr = mid - side; }
            yl *= g; yr *= g;
            if (!(std::fabs(yl) < 1.0e4) || !(std::fabs(yr) < 1.0e4)) { yl = yr = 0.0; verb_.reset(); chorus_.reset(); delay_.reset(); comp_.reset(); mHp_.reset(); slpT_.reset(); }   // salvaguarda
            // bloqueo de DC (6 Hz)
            dcL_ += hpA_ * (yl - dcL_);
            dcR_ += hpA_ * (yr - dcR_);
            yl = softClip(yl - dcL_);
            yr = softClip(yr - dcR_);
            outL[i] = static_cast<T>(yl);
            outR[i] = static_cast<T>(yr);
            pk[0] = std::max(pk[0], static_cast<float>(std::fabs(yl)));
            pk[1] = std::max(pk[1], static_cast<float>(std::fabs(yr)));
            shimAcc += wl * wl + wr * wr;
            outAcc += yl * yl + yr * yr;
        }
        if (!anyVoice && outAcc / m < 1.0e-12) {
            if (++quiet_ >= 4) { silent_ = true; quiet_ = 0; verb_.reset(); chorus_.reset(); delay_.reset(); delayLive_ = false; dcL_ = dcR_ = 0.0; }
        } else quiet_ = 0;
        shimEnv_ += 0.2 * (std::sqrt(shimAcc / std::max(1, m)) - shimEnv_);
    }

    static constexpr double kOutGain = 0.35;   // margen de mezcla: acorde de 5 notas ~ -6 dBFS de pico

    double sr_{48000.0}, invSr_{1.0 / 48000.0}, driftK_{0.001}, fcMax_{20000.0}, hpA_{0.0008};
    double dcL_{0}, dcR_{0}, shimEnv_{0};
    int killLen_{240};
    bool pedal_{false}, silent_{false};
    int quiet_{0};
    uint32_t seed_{0xC0FFEEu};
    JwSampler::Sampler sampler_;
    bool samplerLoadStarted_{false};
    HighPass2 sendHp_;
    SlowLowpass slp_, slpT_;
    HighPass2 mHp_;
    TapeDelay delay_;
    SoftComp comp_;
    bool delayLive_{false};
    double sLfoPh_{0};
    uint64_t heldKeys_[2]{};
    std::vector<float> sL_, sR_;
    static constexpr float kSampledLevelDb = 4.0f;
    uint64_t orderCtr_{0};
    PadSettings s_;
    WaveTables tables_;
    ShimmerVerb verb_;
    Ensemble chorus_;
    JasWaveFx::FxRack fx_;
    std::array<Voice, kMaxVoices> voices_;
    std::vector<double> mixL_, mixR_;
    Smoother lcs_, tns_, cps_, dms_, dfs_, drs_, wds_, tus_, dps_;
    Smoother vol_, wet_, bend_, mw_, at_, cut_, res_, det_, sub_, chs_, rvs_, shs_, rts_;
};

} // namespace JasWaveShimmerPad
