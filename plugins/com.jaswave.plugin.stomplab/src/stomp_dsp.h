// =====================================================================================
//  JasWave StompLab – cadena de pedales de guitarra/bajo/voz (header-only, sin SDK, sin asignaciones en process)
//   Cadena fija con bypass por módulo (fundidos de 10 ms):
//     entrada → Gate → Compresor → [×2: Overdrive (5 modelos) → Preamp de válvulas] → Cabina IR → Chorus → Delay → Shimmer
//   - Las etapas no lineales (overdrive y preamp) corren sobreamuestreadas ×2 con filtros de medio banda de 31 taps
//     (latencia fija de 15 muestras con cualquier combinación de módulos).
//   - Cabina: convolución directa de 512 taps con respuestas sintéticas de fase mínima (cepstrum) generadas en prepare();
//     el cambio de modelo se funde entre dos IR en 20 ms.
//   - Chorus estéreo (LFO en cuadratura, Hermite), delay estéreo (mono / ping-pong / cinta) con realimentación
//     saturada (siempre estable) y shimmer = FDN de 8 líneas + desplazador de tono +12 st en el lazo.
//   Todos los búferes se reservan en prepare(); process() solo hace aritmética.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>

namespace JasWaveStomp {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kBypass = 0, kInGain = 1, kOutGain = 2, kMix = 3,
    kGateOn = 10, kGateThresh = 11, kGateRelease = 12, kGateRange = 13,
    kCompOn = 20, kCompThresh = 21, kCompRatio = 22, kCompAttack = 23, kCompRelease = 24, kCompMakeup = 25, kCompBlend = 26, kCompKnee = 27,
    kOdOn = 30, kOdModel = 31, kOdDrive = 32, kOdTone = 33, kOdLevel = 34,
    kPreOn = 40, kPreChannel = 41, kPreGain = 42, kPreBass = 43, kPreMid = 44, kPreTreble = 45, kPrePresence = 46, kPreMaster = 47, kPreSag = 48, kPreBright = 49,
    kCabOn = 50, kCabModel = 51, kCabLow = 52, kCabHigh = 53, kCabMix = 54,
    kChoOn = 60, kChoRate = 61, kChoDepth = 62, kChoMix = 63,
    kDlyOn = 70, kDlyTime = 71, kDlyFeedback = 72, kDlyTone = 73, kDlyMix = 74, kDlyMode = 75,
    kShiOn = 80, kShiMix = 81, kShiDecay = 82, kShiAmount = 83, kShiDamping = 84,
    kMeterGate = 120, kMeterComp = 121
};

inline const char* const* labelsOdModel() { static const char* const l[] = { "Clean Boost", "Overdrive", "Distortion", "Fuzz", "Metal" }; return l; }
inline const char* const* labelsPreChannel() { static const char* const l[] = { "Clean", "Crunch", "Lead" }; return l; }
inline const char* const* labelsCabModel() { static const char* const l[] = { "1x12 Open", "2x12 Combo", "4x12 Closed", "Vintage Bright", "British 2x12", "DI (flat)" }; return l; }
inline const char* const* labelsDlyMode() { static const char* const l[] = { "Stereo", "Ping-Pong", "Tape" }; return l; }

constexpr int kNumCab = 6;
constexpr int kIrLen = 512;
constexpr int kOsLatency = 15;   // muestras (medio banda ×2 de 31 taps, subida + bajada)

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kInGain, "Input Gain", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(linearP(kOutGain, "Output Gain", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(linearP(kMix, "Mix", "%", 0.0, 100.0, 100.0, 0));
        v.push_back(toggleP(kGateOn, "Gate On", 0));
        v.push_back(linearP(kGateThresh, "Gate Threshold", "dB", -80.0, -20.0, -55.0, 1));
        v.push_back(logP(kGateRelease, "Gate Release", "ms", 10.0, 500.0, 80.0, 0));
        v.push_back(linearP(kGateRange, "Gate Range", "dB", 0.0, 80.0, 60.0, 0));
        v.push_back(toggleP(kCompOn, "Comp On", 0));
        v.push_back(linearP(kCompThresh, "Comp Threshold", "dB", -60.0, 0.0, -20.0, 1));
        v.push_back(logP(kCompRatio, "Comp Ratio", ":1", 1.0, 20.0, 4.0, 1));
        v.push_back(logP(kCompAttack, "Comp Attack", "ms", 0.1, 100.0, 10.0, 1));
        v.push_back(logP(kCompRelease, "Comp Release", "ms", 10.0, 1000.0, 120.0, 0));
        v.push_back(linearP(kCompMakeup, "Comp Makeup", "dB", 0.0, 24.0, 0.0, 1));
        v.push_back(linearP(kCompBlend, "Comp Blend", "%", 0.0, 100.0, 100.0, 0));
        v.push_back(linearP(kCompKnee, "Comp Knee", "dB", 0.0, 12.0, 6.0, 1));
        v.push_back(toggleP(kOdOn, "Drive On", 0));
        v.push_back(stepP(kOdModel, "Drive Model", 4, 1, labelsOdModel()));
        v.push_back(linearP(kOdDrive, "Drive", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(logP(kOdTone, "Drive Tone", "Hz", 500.0, 8000.0, 3000.0, 0));
        v.push_back(linearP(kOdLevel, "Drive Level", "dB", -24.0, 12.0, 0.0, 1, true));
        v.push_back(toggleP(kPreOn, "Preamp On", 0));
        v.push_back(stepP(kPreChannel, "Preamp Channel", 2, 1, labelsPreChannel()));
        v.push_back(linearP(kPreGain, "Preamp Gain", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(linearP(kPreBass, "Preamp Bass", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kPreMid, "Preamp Mid", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kPreTreble, "Preamp Treble", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kPrePresence, "Preamp Presence", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(linearP(kPreMaster, "Preamp Master", "dB", -24.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kPreSag, "Preamp Sag", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(toggleP(kPreBright, "Preamp Bright", 0));
        v.push_back(toggleP(kCabOn, "Cabinet On", 0));
        v.push_back(stepP(kCabModel, "Cabinet Model", kNumCab - 1, 0, labelsCabModel()));
        v.push_back(logP(kCabLow, "Cabinet Low Cut", "Hz", 20.0, 400.0, 40.0, 0));
        v.push_back(logP(kCabHigh, "Cabinet High Cut", "Hz", 2000.0, 20000.0, 14000.0, 0));
        v.push_back(linearP(kCabMix, "Cabinet Mix", "%", 0.0, 100.0, 100.0, 0));
        v.push_back(toggleP(kChoOn, "Chorus On", 0));
        v.push_back(logP(kChoRate, "Chorus Rate", "Hz", 0.05, 8.0, 0.8, 2));
        v.push_back(linearP(kChoDepth, "Chorus Depth", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kChoMix, "Chorus Mix", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(toggleP(kDlyOn, "Delay On", 0));
        v.push_back(logP(kDlyTime, "Delay Time", "ms", 20.0, 2000.0, 380.0, 0));
        v.push_back(linearP(kDlyFeedback, "Delay Feedback", "%", 0.0, 95.0, 35.0, 0));
        v.push_back(logP(kDlyTone, "Delay Tone", "Hz", 1000.0, 12000.0, 5000.0, 0));
        v.push_back(linearP(kDlyMix, "Delay Mix", "%", 0.0, 100.0, 25.0, 0));
        v.push_back(stepP(kDlyMode, "Delay Mode", 2, 0, labelsDlyMode()));
        v.push_back(toggleP(kShiOn, "Shimmer On", 0));
        v.push_back(linearP(kShiMix, "Shimmer Mix", "%", 0.0, 100.0, 25.0, 0));
        v.push_back(logP(kShiDecay, "Shimmer Decay", "s", 0.3, 20.0, 3.0, 1));
        v.push_back(linearP(kShiAmount, "Shimmer Octave", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(logP(kShiDamping, "Shimmer Damping", "Hz", 1000.0, 16000.0, 6000.0, 0));
        v.push_back(asReadOnly(linearP(kMeterGate, "Gate Reduction", "dB", 0.0, 80.0, 0.0, 1)));
        v.push_back(asReadOnly(linearP(kMeterComp, "Comp Reduction", "dB", 0.0, 24.0, 0.0, 1)));
        marcarBasicos(v, { kBypass, kOutGain, kMix, kGateOn, kCompOn, kOdOn, kOdModel, kOdDrive, kPreOn, kPreGain, kCabOn, kCabModel, kChoOn, kDlyOn, kDlyMix, kShiOn, kShiMix });
        return v;
    }();
    return defs;
}

struct Settings {
    bool bypass{false}; float inDb{0.f}, outDb{0.f}, mix{1.f};
    bool gateOn{false}; float gateThr{-55.f}, gateRel{80.f}, gateRange{60.f};
    bool compOn{false}; float compThr{-20.f}, compRatio{4.f}, compAtk{10.f}, compRel{120.f}, compMakeup{0.f}, compBlend{1.f}, compKnee{6.f};
    bool odOn{false}; int odModel{1}; float odDrive{0.4f}, odTone{3000.f}, odLevel{0.f};
    bool preOn{false}; int preCh{1}; float preGain{0.4f}, preBass{0.f}, preMid{0.f}, preTreble{0.f}, prePres{0.3f}, preMaster{0.f}, preSag{0.3f}; bool preBright{false};
    bool cabOn{false}; int cabModel{0}; float cabLow{40.f}, cabHigh{14000.f}, cabMix{1.f};
    bool choOn{false}; float choRate{0.8f}, choDepth{0.5f}, choMix{0.4f};
    bool dlyOn{false}; float dlyTime{380.f}, dlyFb{0.35f}, dlyTone{5000.f}, dlyMix{0.25f}; int dlyMode{0};
    bool shiOn{false}; float shiMix{0.25f}, shiDecay{3.f}, shiAmt{0.5f}, shiDamp{6000.f};
};

struct StompBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    std::atomic<float> gateGr{0.f}, compGr{0.f};
    std::atomic<int> latencia{kOsLatency};
};

// ---------------------------------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------------------------------
inline float fdb(float lin) { return 20.f * std::log10(lin + 1.0e-9f); }
inline float fdbLin(float db) { return std::pow(10.f, db * 0.05f); }
inline float onePoleCoef(double sr, double ms) { return 1.f - static_cast<float>(std::exp(-1.0 / (std::max(0.01, ms) * 0.001 * sr))); }
inline size_t pow2Ceil(size_t n) { size_t p = 1; while (p < n) p <<= 1; return p; }

// Interpolación Hermite cúbica en un anillo (índice w = próxima escritura; delay en muestras ≥ 1)
inline float leerHermite(const float* b, size_t mask, size_t w, float delay) {
    const float d = std::max(delay, 2.0f);
    const size_t i = static_cast<size_t>(d);
    const float f = d - static_cast<float>(i);
    const float ym1 = b[(w - i + 1) & mask], y0 = b[(w - i) & mask], y1 = b[(w - i - 1) & mask], y2 = b[(w - i - 2) & mask];
    const float c0 = y0, c1 = 0.5f * (y1 - ym1), c2 = ym1 - 2.5f * y0 + 2.f * y1 - 0.5f * y2, c3 = 0.5f * (y2 - ym1) + 1.5f * (y0 - y1);
    return ((c3 * f + c2) * f + c1) * f + c0;
}

struct Bq {   // biquad de un canal con coeficientes compartidos
    BiquadCoefs c;
    BiquadState s;
    float run(float x) { return static_cast<float>(biquadProcess(c, s, x)); }
};

// ---------------------------------------------------------------------------------------------
//  Medio banda ×2 (31 taps, Kaiser β = 8): subida y bajada, 15 muestras de retardo cada una a la tasa ×2
// ---------------------------------------------------------------------------------------------
class HalfBandTaps {
public:
    static constexpr int kN = 31, kC = 15;
    HalfBandTaps() {
        auto i0 = [](double x) { double s = 1.0, t = 1.0; for (int k = 1; k < 30; ++k) { t *= (x / (2.0 * k)) * (x / (2.0 * k)); s += t; } return s; };
        const double beta = 8.0, den = i0(beta);
        double sum = 0.0;
        for (int n = 0; n < kN; ++n) {
            const int m = n - kC;
            const double x = m / static_cast<double>(kC);
            const double w = i0(beta * std::sqrt(std::max(0.0, 1.0 - x * x))) / den;
            const double s = m == 0 ? 0.5 : std::sin(kPi * m / 2.0) / (kPi * m);   // sinc de corte fs2/4
            h[n] = static_cast<float>(s * w);
            sum += h[n];
        }
        for (int n = 0; n < kN; ++n) h[n] = static_cast<float>(h[n] / sum);   // ganancia DC = 1
        nz = 0;
        for (int n = 0; n < kN; ++n) if (std::fabs(h[n]) > 1.0e-9f) idx[nz++] = n;
    }
    float h[kN]{};
    int idx[kN]{};
    int nz{0};
};
inline const HalfBandTaps& halfBandTaps() { static const HalfBandTaps t; return t; }

class Os2 {
public:
    void reset() { std::fill(std::begin(up_), std::end(up_), 0.f); std::fill(std::begin(dn_), std::end(dn_), 0.f); wu_ = wd_ = 0; fase_ = 0; }
    // Sube: devuelve las dos muestras a la tasa ×2
    inline void subir(float x, float& a, float& b) {
        const HalfBandTaps& t = halfBandTaps();
        // zero-stuffing: u[2n] = x (ganancia ×2 para conservar el nivel), u[2n+1] = 0
        a = filtrar(up_, wu_, 2.f * x, t);
        b = filtrar(up_, wu_, 0.f, t);
    }
    // Baja: recibe dos muestras ×2 y devuelve una
    inline float bajar(float a, float b) {
        const HalfBandTaps& t = halfBandTaps();
        const float ya = filtrar(dn_, wd_, a, t);
        dn_[wd_ & 31] = b; ++wd_;      // la muestra descartada solo entra en la linea de retardo
        return ya;
    }
private:
    static inline float filtrar(float* buf, int& w, float x, const HalfBandTaps& t) {
        buf[w & 31] = x;
        float y = 0.f;
        for (int k = 0; k < t.nz; ++k) y += t.h[t.idx[k]] * buf[(w - t.idx[k]) & 31];
        ++w;
        return y;
    }
    float up_[32]{}, dn_[32]{};
    int wu_{0}, wd_{0}, fase_{0};
};

// ---------------------------------------------------------------------------------------------
//  Gate
// ---------------------------------------------------------------------------------------------
class Gate {
public:
    void prepare(double sr) { sr_ = sr; aEnv_ = onePoleCoef(sr, 0.5); aOpen_ = onePoleCoef(sr, 0.8); reset(); }
    void reset() { env_ = 0.f; g_ = 1.f; abierto_ = true; holdN_ = 0; grMax_ = 0.f; }
    void set(float thr, float relMs, float rangeDb) {
        thr_ = thr; aRel_ = onePoleCoef(sr_, relMs); floorG_ = fdbLin(-rangeDb);
        holdMax_ = static_cast<int>(0.02 * sr_);
    }
    inline float process(float l, float r) {
        const float s = std::max(std::fabs(l), std::fabs(r));
        env_ += (s - env_) * (s > env_ ? aEnv_ : aEnv_ * 0.05f);
        const float db = fdb(env_);
        if (abierto_) { if (db < thr_ - 3.f) { if (++holdN_ > holdMax_) abierto_ = false; } else holdN_ = 0; }
        else if (db > thr_) { abierto_ = true; holdN_ = 0; }
        const float target = abierto_ ? 1.f : floorG_;
        g_ += (target - g_) * (target > g_ ? aOpen_ : aRel_);
        grMax_ = std::max(grMax_, -fdb(g_));
        return g_;
    }
    float takeGr() { const float g = grMax_; grMax_ = 0.f; return g; }
private:
    double sr_{48000.0};
    float thr_{-55.f}, aEnv_{0.1f}, aOpen_{0.1f}, aRel_{0.001f}, floorG_{0.001f}, env_{0.f}, g_{1.f}, grMax_{0.f};
    bool abierto_{true};
    int holdN_{0}, holdMax_{960};
};

// ---------------------------------------------------------------------------------------------
//  Compresor (detector de pico enlazado, rodilla suave, balística en dB)
// ---------------------------------------------------------------------------------------------
class Comp {
public:
    void prepare(double sr) { sr_ = sr; reset(); }
    void reset() { grDb_ = 0.f; grMax_ = 0.f; }
    void set(float thr, float ratio, float atkMs, float relMs, float makeupDb, float knee) {
        thr_ = thr; ratio_ = std::max(1.f, ratio); knee_ = std::max(0.f, knee);
        aA_ = onePoleCoef(sr_, atkMs); aR_ = onePoleCoef(sr_, relMs); makeup_ = fdbLin(makeupDb);
    }
    // devuelve la ganancia lineal (con compensación)
    inline float process(float l, float r) {
        const float lvl = fdb(std::max(std::fabs(l), std::fabs(r)));
        const float over = lvl - thr_;
        float out;
        if (knee_ > 0.f && std::fabs(over) <= 0.5f * knee_) { const float t = over + 0.5f * knee_; out = (1.f / ratio_ - 1.f) * t * t / (2.f * knee_); }
        else if (over > 0.f) out = (1.f / ratio_ - 1.f) * over;
        else out = 0.f;
        const float targetGr = -out;                     // reducción positiva
        grDb_ += (targetGr - grDb_) * (targetGr > grDb_ ? aA_ : aR_);
        grMax_ = std::max(grMax_, grDb_);
        return fdbLin(-grDb_) * makeup_;
    }
    float takeGr() { const float g = grMax_; grMax_ = 0.f; return g; }
private:
    double sr_{48000.0};
    float thr_{-20.f}, ratio_{4.f}, knee_{6.f}, aA_{0.01f}, aR_{0.001f}, makeup_{1.f}, grDb_{0.f}, grMax_{0.f};
};

// ---------------------------------------------------------------------------------------------
//  Cabina: respuestas sintéticas de fase mínima + convolución directa
// ---------------------------------------------------------------------------------------------
inline double cabMagnitude(int model, double f) {
    auto hp = [&](double fc, int n) { return 1.0 / std::sqrt(1.0 + std::pow(fc / f, 2.0 * n)); };
    auto lp = [&](double fc, int n) { return 1.0 / std::sqrt(1.0 + std::pow(f / fc, 2.0 * n)); };
    auto bump = [&](double dbGain, double fc, double wOct) { const double o = std::log2(f / fc) / wOct; return 1.0 + (std::pow(10.0, dbGain / 20.0) - 1.0) * std::exp(-0.5 * o * o); };
    f = std::max(f, 1.0);
    switch (model) {
        case 0: return hp(100, 2) * lp(5200, 4) * bump(4, 120, 0.5) * bump(5, 2600, 0.45) * bump(-3, 900, 0.6);
        case 1: return hp(85, 2) * lp(5800, 4) * bump(3, 140, 0.5) * bump(6, 3100, 0.4) * bump(-2, 1100, 0.5);
        case 2: return hp(75, 2) * lp(4600, 5) * bump(5, 105, 0.4) * bump(-4, 550, 0.5) * bump(4, 1900, 0.4) * bump(3, 3300, 0.3);
        case 3: return hp(90, 2) * lp(7500, 3) * bump(2, 120, 0.5) * bump(5, 4000, 0.5) * bump(-2, 700, 0.5);
        case 4: return hp(110, 2) * lp(6200, 4) * bump(3, 220, 0.5) * bump(6, 1700, 0.5) * bump(-3, 3800, 0.4);
        default: return 1.0;
    }
}

// Construye en `h` (kIrLen) la IR de fase mínima del modelo. `work` = 4 vectores de 4096 floats (preasignados).
inline void construirIr(int model, double sr, float* h, FFT& fft, std::vector<float>& re, std::vector<float>& im) {
    if (model >= kNumCab - 1) { std::fill(h, h + kIrLen, 0.f); h[0] = 1.f; return; }
    const int N = fft.size();
    const double binHz = sr / N;
    auto ifft = [&]() { for (int i = 0; i < N; ++i) im[static_cast<size_t>(i)] = -im[static_cast<size_t>(i)]; fft.forward(re.data(), im.data()); for (int i = 0; i < N; ++i) { re[static_cast<size_t>(i)] /= N; im[static_cast<size_t>(i)] = -im[static_cast<size_t>(i)] / N; } };
    for (int k = 0; k <= N / 2; ++k) {
        const double m = std::max(cabMagnitude(model, std::max(k * binHz, 1.0)), 1.0e-5);
        re[static_cast<size_t>(k)] = static_cast<float>(std::log(m));
        if (k > 0 && k < N / 2) re[static_cast<size_t>(N - k)] = re[static_cast<size_t>(k)];
    }
    std::fill(im.begin(), im.begin() + N, 0.f);
    ifft();                                                  // cepstrum real
    for (int n = 1; n < N / 2; ++n) re[static_cast<size_t>(n)] *= 2.f;
    for (int n = N / 2 + 1; n < N; ++n) re[static_cast<size_t>(n)] = 0.f;
    std::fill(im.begin(), im.begin() + N, 0.f);
    fft.forward(re.data(), im.data());                        // log del espectro de fase mínima
    for (int k = 0; k < N; ++k) {
        const double mg = std::exp(static_cast<double>(re[static_cast<size_t>(k)])), ph = im[static_cast<size_t>(k)];
        re[static_cast<size_t>(k)] = static_cast<float>(mg * std::cos(ph));
        im[static_cast<size_t>(k)] = static_cast<float>(mg * std::sin(ph));
    }
    ifft();
    const int taper = kIrLen / 4;
    for (int n = 0; n < kIrLen; ++n) {
        float w = 1.f;
        if (n >= kIrLen - taper) w = 0.5f + 0.5f * std::cos(static_cast<float>(kPi) * (n - (kIrLen - taper)) / taper);
        h[n] = re[static_cast<size_t>(n)] * w;
    }
}

class Fir {
public:
    void reset() { std::fill(hist_.begin(), hist_.end(), 0.f); pos_ = 0; }
    void prepare() { hist_.assign(2 * kIrLen, 0.f); pos_ = 0; }
    inline void push(float x) { pos_ = (pos_ + 1) & (kIrLen - 1); hist_[static_cast<size_t>(pos_)] = x; hist_[static_cast<size_t>(pos_) + kIrLen] = x; }
    // salida con la IR h: y[n] = sum h[k]*x[n-k]  (la ultima muestra empujada es x[n])
    inline float dot(const float* h) const {
        const float* p = hist_.data() + pos_ + kIrLen;   // p[-k] = x[n-k]
        float acc = 0.f;
        for (int k = 0; k < kIrLen; ++k) acc += h[k] * p[-k];
        return acc;
    }
private:
    std::vector<float> hist_;
    int pos_{0};
};

// ---------------------------------------------------------------------------------------------
//  Chorus estéreo
// ---------------------------------------------------------------------------------------------
class Chorus {
public:
    void prepare(double sr) {
        sr_ = sr;
        const size_t n = pow2Ceil(static_cast<size_t>(0.06 * sr) + 8);
        for (auto& b : buf_) b.assign(n, 0.f);
        mask_ = n - 1; reset();
    }
    void reset() { for (auto& b : buf_) std::fill(b.begin(), b.end(), 0.f); w_ = 0; ph_ = 0.0; }
    void set(float rate, float depth) { inc_ = rate / sr_; depth_ = depth; }
    inline void process(float l, float r, float& wl, float& wr) {
        buf_[0][w_ & mask_] = l; buf_[1][w_ & mask_] = r;
        const float baseMs = 8.f, depMs = 5.5f * depth_;
        const float lfoL = static_cast<float>(std::sin(2.0 * kPi * ph_)), lfoR = static_cast<float>(std::cos(2.0 * kPi * ph_));
        const float dl = (baseMs + depMs * lfoL) * 0.001f * static_cast<float>(sr_), dr = (baseMs + depMs * lfoR) * 0.001f * static_cast<float>(sr_);
        wl = leerHermite(buf_[0].data(), mask_, w_, dl);
        wr = leerHermite(buf_[1].data(), mask_, w_, dr);
        ++w_;
        ph_ += inc_; if (ph_ >= 1.0) ph_ -= 1.0;
    }
private:
    double sr_{48000.0}, ph_{0.0}, inc_{0.0001};
    std::vector<float> buf_[2];
    size_t mask_{63}, w_{0};
    float depth_{0.5f};
};

// ---------------------------------------------------------------------------------------------
//  Delay estéreo (Stereo / Ping-Pong / Tape)
// ---------------------------------------------------------------------------------------------
class Delay {
public:
    void prepare(double sr) {
        sr_ = sr;
        const size_t n = pow2Ceil(static_cast<size_t>(2.1 * sr) + 16);
        for (auto& b : buf_) b.assign(n, 0.f);
        mask_ = n - 1; reset();
    }
    void reset() { for (auto& b : buf_) std::fill(b.begin(), b.end(), 0.f); w_ = 0; lp_[0] = lp_[1] = 0.f; hp_[0] = hp_[1] = 0.f; hpx_[0] = hpx_[1] = 0.f; wow_ = 0.0; timeS_ = timeT_; }
    void set(float timeMs, float fb, float toneHz, int mode) {
        timeT_ = timeMs * 0.001f * static_cast<float>(sr_);
        fb_ = std::min(fb, 0.95f); mode_ = mode;
        lpA_ = 1.f - std::exp(-2.f * static_cast<float>(kPi) * toneHz / static_cast<float>(sr_));
        slew_ = onePoleCoef(sr_, 60.0);
    }
    inline void process(float l, float r, float& wl, float& wr) {
        timeS_ += (timeT_ - timeS_) * slew_;
        float t = timeS_;
        if (mode_ == 2) { wow_ += 0.45 / sr_; if (wow_ >= 1.0) wow_ -= 1.0; t += static_cast<float>(std::sin(2.0 * kPi * wow_)) * 0.0004f * static_cast<float>(sr_); }
        const float maxT = static_cast<float>(mask_) - 4.f;
        t = std::min(t, maxT);
        const float dl = leerHermite(buf_[0].data(), mask_, w_, t), dr = leerHermite(buf_[1].data(), mask_, w_, t);
        float fl, fr;                                   // señales que se realimentan
        if (mode_ == 1) { fl = dr; fr = dl; }           // ping-pong: cruzado
        else { fl = dl; fr = dr; }
        const float inL = mode_ == 1 ? 0.5f * (l + r) : l, inR = mode_ == 1 ? 0.f : r;
        float tl = tono(0, fl), tr = tono(1, fr);
        if (mode_ == 2) { tl = std::tanh(tl * 1.4f) * 0.714f; tr = std::tanh(tr * 1.4f) * 0.714f; }
        buf_[0][w_ & mask_] = softlim(inL + tl * fb_) + 1.0e-20f;
        buf_[1][w_ & mask_] = softlim(inR + tr * fb_) + 1.0e-20f;
        ++w_;
        wl = dl; wr = dr;
    }
private:
    static inline float softlim(float x) { return std::fabs(x) < 0.9f ? x : std::tanh(x * 1.1f) * 0.91f; }
    inline float tono(int c, float x) {
        lp_[c] += (x - lp_[c]) * lpA_;
        const float y = lp_[c] - hpx_[c];     // pasa-alto suave 1 polo (~40 Hz) para no acumular DC
        hpx_[c] += (lp_[c] - hpx_[c]) * 0.005f;
        return y;
    }
    double sr_{48000.0}, wow_{0.0};
    std::vector<float> buf_[2];
    size_t mask_{63}, w_{0};
    float timeT_{18000.f}, timeS_{18000.f}, fb_{0.35f}, lpA_{0.3f}, slew_{0.001f};
    float lp_[2]{}, hp_[2]{}, hpx_[2]{};
    int mode_{0};
};

// ---------------------------------------------------------------------------------------------
//  Shimmer: FDN de 8 líneas + desplazador +12 st en el lazo de realimentación
// ---------------------------------------------------------------------------------------------
class Shimmer {
public:
    static constexpr int kLines = 8;
    void prepare(double sr) {
        sr_ = sr;
        static const int base[kLines] = { 1117, 1367, 1553, 1721, 1999, 2237, 2467, 2719 };
        for (int i = 0; i < kLines; ++i) {
            len_[i] = std::max(16, static_cast<int>(base[i] * sr / 48000.0));
            const size_t n = pow2Ceil(static_cast<size_t>(len_[i]) + 4);
            line_[i].assign(n, 0.f); mask_[i] = n - 1;
        }
        static const int apb[4] = { 142, 107, 379, 277 };
        for (int i = 0; i < 4; ++i) {
            apLen_[i] = std::max(8, static_cast<int>(apb[i] * sr / 48000.0));
            const size_t n = pow2Ceil(static_cast<size_t>(apLen_[i]) + 2);
            ap_[i].assign(n, 0.f); apMask_[i] = n - 1;
        }
        win_ = std::max(64, static_cast<int>(0.06 * sr));
        const size_t pn = pow2Ceil(static_cast<size_t>(win_) * 2 + 16);
        pit_.assign(pn, 0.f); pitMask_ = pn - 1;
        reset();
    }
    void reset() {
        for (auto& l : line_) std::fill(l.begin(), l.end(), 0.f);
        for (auto& a : ap_) std::fill(a.begin(), a.end(), 0.f);
        std::fill(pit_.begin(), pit_.end(), 0.f);
        std::fill(std::begin(damp_), std::end(damp_), 0.f);
        std::fill(std::begin(w_), std::end(w_), 0u); std::fill(std::begin(apW_), std::end(apW_), 0u);
        pw_ = 0; phase_ = 0.f; fbSig_ = 0.f; dc_ = 0.f; dcx_ = 0.f;
    }
    void set(float decaySec, float amount, float dampHz) {
        for (int i = 0; i < kLines; ++i) g_[i] = std::pow(10.f, -3.f * static_cast<float>(len_[i]) / (std::max(0.1f, decaySec) * static_cast<float>(sr_)));
        amount_ = amount * 0.5f;     // ganancia máxima del lazo de octava (el FDN ya decae)
        dampA_ = 1.f - std::exp(-2.f * static_cast<float>(kPi) * dampHz / static_cast<float>(sr_));
    }
    inline void process(float l, float r, float& wl, float& wr) {
        float x = 0.5f * (l + r) + fbSig_;
        // difusores en serie
        for (int i = 0; i < 4; ++i) {
            float* b = ap_[i].data(); const size_t m = apMask_[i];
            const float d = b[(apW_[i] - static_cast<size_t>(apLen_[i])) & m];
            const float v = x - 0.65f * d;
            b[apW_[i] & m] = v; apW_[i]++;
            x = d + 0.65f * v;
        }
        float o[kLines];
        for (int i = 0; i < kLines; ++i) {
            const float d = line_[i][(w_[i] - static_cast<size_t>(len_[i])) & mask_[i]];
            damp_[i] += (d - damp_[i]) * dampA_;
            o[i] = damp_[i] * g_[i];
        }
        // Hadamard 8×8 (normalizada): 3 mariposas
        float a[kLines];
        for (int i = 0; i < kLines; ++i) a[i] = o[i];
        for (int s = 1; s < kLines; s <<= 1)
            for (int i = 0; i < kLines; i += 2 * s)
                for (int j = i; j < i + s; ++j) { const float u = a[j], v = a[j + s]; a[j] = u + v; a[j + s] = u - v; }
        const float k = 0.35355339f;   // 1/sqrt(8)
        for (int i = 0; i < kLines; ++i) {
            line_[i][w_[i] & mask_[i]] = x * 0.5f + a[i] * k + 1.0e-20f; w_[i]++;
        }
        wl = 0.f; wr = 0.f;
        for (int i = 0; i < kLines; i += 2) { wl += o[i]; wr += o[i + 1]; }
        wl *= 0.5f; wr *= 0.5f;
        // lazo de octava: desplazador de dos tomas sobre la salida mono del FDN
        const float mono = 0.5f * (wl + wr);
        pit_[pw_ & pitMask_] = mono;
        const float W = static_cast<float>(win_);
        const float dA = (1.f - phase_) * W, dB = (1.f - std::fmod(phase_ + 0.5f, 1.f)) * W;
        const float gA = 0.5f - 0.5f * std::cos(2.f * static_cast<float>(kPi) * phase_);
        const float gB = 0.5f - 0.5f * std::cos(2.f * static_cast<float>(kPi) * std::fmod(phase_ + 0.5f, 1.f));
        const float sh = leerHermite(pit_.data(), pitMask_, pw_, dA + 2.f) * gA + leerHermite(pit_.data(), pitMask_, pw_, dB + 2.f) * gB;
        ++pw_;
        phase_ += 1.f / W; if (phase_ >= 1.f) phase_ -= 1.f;       // +12 st: el retardo decrece 1 muestra por muestra
        // pasa-alto de DC y limitador suave antes de reinyectar
        dc_ += (sh - dc_) * 0.002f;
        const float y = sh - dc_;
        const float lim = std::fabs(y) < 0.8f ? y : std::tanh(y);
        fbSig_ = lim * amount_;
    }
private:
    double sr_{48000.0};
    std::vector<float> line_[kLines], ap_[4], pit_;
    size_t mask_[kLines]{}, apMask_[4]{}, pitMask_{63}, w_[kLines]{}, apW_[4]{}, pw_{0};
    int len_[kLines]{}, apLen_[4]{}, win_{2880};
    float g_[kLines]{}, damp_[kLines]{}, dampA_{0.3f}, amount_{0.25f}, phase_{0.f}, fbSig_{0.f}, dc_{0.f}, dcx_{0.f};
};

// ---------------------------------------------------------------------------------------------
//  Etapas no lineales (a la tasa ×2)
// ---------------------------------------------------------------------------------------------
inline float softP2(float x) { return x / std::sqrt(1.f + x * x); }
inline float softP4(float x) { const float x2 = x * x; return x / std::sqrt(std::sqrt(1.f + x2 * x2)); }

struct DriveCh {
    Bq pre, tone;          // pre: pasa-alto (modelos) · tone: pasa-bajo de tono (a la tasa ×2)
    Bq hp2;                // pasa-alto intermedio de Metal
    float dc{0.f};
    void reset() { pre.s.reset(); tone.s.reset(); hp2.s.reset(); dc = 0.f; }
};

struct PreCh {
    Bq coupling, low, mid, high, bright, presence, miller;
    float dc1{0.f}, dc2{0.f};
    void reset() { for (Bq* b : { &coupling, &low, &mid, &high, &bright, &presence, &miller }) b->s.reset(); dc1 = dc2 = 0.f; }
};

// ---------------------------------------------------------------------------------------------
//  Motor completo
// ---------------------------------------------------------------------------------------------
inline float fastTanh(float x) {
    if (x > 3.f) return 1.f;
    if (x < -3.f) return -1.f;
    const float x2 = x * x;
    return x * (27.f + x2) / (27.f + 9.f * x2);
}

class Engine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        gate_.prepare(sr_); comp_.prepare(sr_); chorus_.prepare(sr_); delay_.prepare(sr_); shimmer_.prepare(sr_);
        for (auto& f : fir_) f.prepare();
        std::vector<float> re(4096), im(4096);
        FFT fft(12);
        for (int m = 0; m < kNumCab; ++m) construirIr(m, sr_, ir_[static_cast<size_t>(m)].data(), fft, re, im);
        cFade_ = onePoleCoef(sr_, 10.0); cSlow_ = onePoleCoef(sr_, 30.0);
        s_ = Settings{};
        clear();
        cabCur_ = cabPrev_ = s_.cabModel; xfade_ = 1.f;
        aplicar(true);
    }
    void clear() {
        gate_.reset(); comp_.reset(); chorus_.reset(); delay_.reset(); shimmer_.reset();
        for (auto& f : fir_) f.reset();
        for (auto& o : os_) o.reset();
        for (auto& d : drv_) d.reset();
        for (auto& p : pre_) p.reset();
        for (auto& b : cabHp_) b.s.reset();
        for (auto& b : cabLp_) b.s.reset();
        sag_ = 0.f; xfade_ = 1.f; cabPrev_ = cabCur_;
        std::memset(ring_, 0, sizeof ring_); rw_ = 0;
    }
    void set(const Settings& s) { s_ = s; aplicar(false); }
    const Settings& settings() const { return s_; }
    int latency() const { return kOsLatency; }
    float gateGrDb() const { return gateGr_; }
    float compGrDb() const { return compGr_; }

    template <class T>
    void process(const T* iL, const T* iR, T* oL, T* oR, int n) {
        for (int i = 0; i < n; ++i) {
            const float xl = static_cast<float>(iL[i]), xr = static_cast<float>(iR[i]);
            for (int k = 0; k < kMods; ++k) fade_[k] += (tgt_[k] - fade_[k]) * cFade_;
            gIn_ += (gInT_ - gIn_) * cSlow_; gOut_ += (gOutT_ - gOut_) * cSlow_; mix_ += (mixT_ - mix_) * cSlow_; byp_ += (bypT_ - byp_) * cFade_;
            // dry alineado con la latencia (anillo de 32)
            ring_[0][rw_ & 31] = xl; ring_[1][rw_ & 31] = xr;
            const float dryL = ring_[0][(rw_ - kOsLatency) & 31], dryR = ring_[1][(rw_ - kOsLatency) & 31];
            ++rw_;
            float l = xl * gIn_, r = xr * gIn_;
            // ---- gate ----
            if (fade_[kGate] > 0.0005f || tgt_[kGate] > 0.f) {
                const float g = gate_.process(l, r);
                const float gg = 1.f + (g - 1.f) * fade_[kGate];
                l *= gg; r *= gg;
            }
            // ---- compresor ----
            if (fade_[kComp] > 0.0005f || tgt_[kComp] > 0.f) {
                const float g = comp_.process(l, r);
                const float gm = 1.f + (g - 1.f) * fade_[kComp];
                const float gb = 1.f - cBlend_ + cBlend_ * gm;       // mezcla paralela
                l *= gb; r *= gb;
            }
            // ---- etapas no lineales x2 (los filtros de medio banda corren siempre: latencia y estados constantes) ----
            {
                float a0, a1, b0, b1;
                os_[0].subir(l, a0, a1); os_[1].subir(r, b0, b1);
                const bool activo = fade_[kOd] > 0.0005f || fade_[kPre] > 0.0005f || tgt_[kOd] > 0.f || tgt_[kPre] > 0.f;
                if (activo) {
                    a0 = etapa(0, a0, true); a1 = etapa(0, a1, false);
                    b0 = etapa(1, b0, false); b1 = etapa(1, b1, false);
                }
                l = os_[0].bajar(a0, a1); r = os_[1].bajar(b0, b1);
            }
            // ---- cabina ----
            fir_[0].push(l); fir_[1].push(r);
            if (fade_[kCab] > 0.0005f || tgt_[kCab] > 0.f) {
                float cl = fir_[0].dot(ir_[static_cast<size_t>(cabCur_)].data()), cr = fir_[1].dot(ir_[static_cast<size_t>(cabCur_)].data());
                if (xfade_ < 1.f) {
                    const float pl = fir_[0].dot(ir_[static_cast<size_t>(cabPrev_)].data()), pr = fir_[1].dot(ir_[static_cast<size_t>(cabPrev_)].data());
                    cl = pl + (cl - pl) * xfade_; cr = pr + (cr - pr) * xfade_;
                    xfade_ = std::min(1.f, xfade_ + xfStep_);
                }
                cl = cabHp_[0].run(cl); cr = cabHp_[1].run(cr);
                cl = cabLp_[0].run(cl); cr = cabLp_[1].run(cr);
                const float w = fade_[kCab] * cabMix_;
                l += (cl - l) * w; r += (cr - r) * w;
            } else xfade_ = 1.f;
            // ---- chorus / delay / shimmer: siempre corren; el fundido solo afecta a la parte humeda ----
            {
                float wl, wr; chorus_.process(l, r, wl, wr);
                const float m = fade_[kCho] * choMix_;
                const float dg = 1.f - 0.5f * m;
                l = l * dg + wl * m * 0.8f; r = r * dg + wr * m * 0.8f;
            }
            {
                float wl, wr; delay_.process(l, r, wl, wr);
                const float m = fade_[kDly] * dlyMix_;
                l += wl * m; r += wr * m;
            }
            {
                float wl, wr; shimmer_.process(l, r, wl, wr);
                const float m = fade_[kShi] * shiMix_;
                l += wl * m * 2.f; r += wr * m * 2.f;
            }
            l *= gOut_; r *= gOut_;
            // mezcla global y bypass real (ambos contra el dry alineado)
            l = dryL + (l - dryL) * mix_; r = dryR + (r - dryR) * mix_;
            l += (dryL - l) * byp_; r += (dryR - r) * byp_;
            if (!(std::fabs(l) < 1.0e6f)) l = 0.f;     // red de seguridad ante NaN/Inf
            if (!(std::fabs(r) < 1.0e6f)) r = 0.f;
            oL[i] = static_cast<T>(l); oR[i] = static_cast<T>(r);
        }
        gateGr_ = gate_.takeGr(); compGr_ = comp_.takeGr();
    }

private:
    enum { kGate, kComp, kOd, kPre, kCab, kCho, kDly, kShi, kMods };

    // ---- una muestra a la tasa x2 por las etapas de overdrive y preamp ----
    inline float etapa(int ch, float x, bool actualizaSag) {
        float y = x;
        if (fade_[kOd] > 0.0005f) { const float d = drive(ch, y); y += (d - y) * fade_[kOd]; }
        if (fade_[kPre] > 0.0005f) { const float p = preamp(ch, y, actualizaSag); y += (p - y) * fade_[kPre]; }
        return y;
    }
    inline float dcBlock(float& st, float x) { st += (x - st) * dcA_; return x - st; }

    inline float drive(int ch, float x) {
        DriveCh& d = drv_[ch];
        const float g = odGain_;
        float y;
        switch (s_.odModel) {
            case 0: y = softP2(x * g); break;
            case 1: { const float hi = d.pre.run(x); y = softP2((x + hi * (g - 1.f)) * 1.1f); break; }
            case 2: y = softP4(x * g * 0.9f); break;
            case 3: {
                const float z = x * g + 0.15f;
                y = z > 0.f ? 1.f - std::exp(-1.3f * z) : -(1.f - std::exp(0.7f * z)) * 0.9f;
                y = dcBlock(d.dc, y);
                break;
            }
            default: {
                const float s1 = softP4(x * g * 0.5f);
                const float h = d.hp2.run(s1);
                y = d.pre.run(softP4(h * g * 0.2f));
                break;
            }
        }
        return d.tone.run(y * odLevel_);
    }

    static inline float tube(float z, float b, float norm) { return (fastTanh(z + b) - fastTanh(b)) * norm; }
    inline float preamp(int ch, float x, bool actualizaSag) {
        PreCh& p = pre_[ch];
        float v = p.coupling.run(x);
        const float sg = 1.f / (1.f + sagK_ * sag_);
        v = tube(v * g1_ * sg, 0.2f, 1.05f);
        v = dcBlock(p.dc1, v);
        v = p.low.run(v); v = p.mid.run(v); v = p.high.run(v);
        if (s_.preBright) v = p.bright.run(v);
        v = tube(v * g2_ * sg, 0.15f, 1.03f);
        v = dcBlock(p.dc2, v);
        v = p.miller.run(v);
        v = fastTanh(v * 0.9f) * 1.05f;                    // etapa de potencia
        v = p.presence.run(v) * preMaster_;
        if (actualizaSag) { const float a = std::fabs(v); sag_ += (a - sag_) * (a > sag_ ? sagAtk_ : sagRel_); }
        return v;
    }

    void aplicar(bool snap) {
        const Settings& s = s_;
        const double sr2 = sr_ * 2.0;
        tgt_[kGate] = s.gateOn; tgt_[kComp] = s.compOn; tgt_[kOd] = s.odOn; tgt_[kPre] = s.preOn; tgt_[kCab] = s.cabOn;
        tgt_[kCho] = s.choOn; tgt_[kDly] = s.dlyOn; tgt_[kShi] = s.shiOn;
        gInT_ = fdbLin(s.inDb); gOutT_ = fdbLin(s.outDb); mixT_ = clampT(s.mix, 0.f, 1.f); bypT_ = s.bypass ? 1.f : 0.f;
        gate_.set(s.gateThr, s.gateRel, s.gateRange);
        comp_.set(s.compThr, s.compRatio, s.compAtk, s.compRel, s.compMakeup, s.compKnee);
        cBlend_ = clampT(s.compBlend, 0.f, 1.f);
        // overdrive
        const float d = clampT(s.odDrive, 0.f, 1.f);
        static const float dbMin[5] = { 0.f, 4.f, 10.f, 12.f, 12.f }, dbSpan[5] = { 20.f, 36.f, 40.f, 33.f, 38.f };
        static const float comp[5] = { 1.f, 0.9f, 0.7f, 0.7f, 0.6f };
        const int m = clampT(s.odModel, 0, 4);
        odGain_ = fdbLin(dbMin[m] + dbSpan[m] * d);
        odLevel_ = fdbLin(s.odLevel) * comp[m];
        dcA_ = static_cast<float>(2.0 * kPi * 20.0 / sr2);
        for (auto& dc : drv_) {
            dc.tone.c = BiquadCoefs::design(FilterType::LowPass, sr2, std::min(static_cast<double>(s.odTone), sr2 * 0.45), 0.0, 0.707);
            dc.hp2.c = BiquadCoefs::design(FilterType::HighPass, sr2, 150.0, 0.0, 0.707);
            if (m == 1) dc.pre.c = BiquadCoefs::design(FilterType::HighPass, sr2, 720.0, 0.0, 0.707);
            else if (m == 4) dc.pre.c = BiquadCoefs::design(FilterType::Bell, sr2, 600.0, -6.0, 0.8);
            else dc.pre.c = BiquadCoefs{};
        }
        // preamp
        static const float maxDb[3] = { 24.f, 44.f, 60.f };
        const int ch = clampT(s.preCh, 0, 2);
        const float G = clampT(s.preGain, 0.f, 1.f) * maxDb[ch];
        const float g1 = std::min(G, 26.f);
        g1_ = fdbLin(g1); g2_ = fdbLin(G - g1);
        preMaster_ = fdbLin(s.preMaster);
        sagK_ = clampT(s.preSag, 0.f, 1.f) * 1.5f;
        sagAtk_ = 1.f - std::exp(-1.f / static_cast<float>(0.02 * sr2)); sagRel_ = 1.f - std::exp(-1.f / static_cast<float>(0.25 * sr2));
        for (auto& p : pre_) {
            p.coupling.c = BiquadCoefs::design(FilterType::HighPass, sr2, 30.0, 0.0, 0.707);
            p.low.c = BiquadCoefs::design(FilterType::LowShelf, sr2, 120.0, s.preBass, 0.707);
            p.mid.c = BiquadCoefs::design(FilterType::Bell, sr2, 650.0, s.preMid, 0.8);
            p.high.c = BiquadCoefs::design(FilterType::HighShelf, sr2, 3000.0, s.preTreble, 0.707);
            p.bright.c = BiquadCoefs::design(FilterType::HighShelf, sr2, 3500.0, 5.0, 0.707);
            p.presence.c = BiquadCoefs::design(FilterType::HighShelf, sr2, 5500.0, 9.0 * clampT(s.prePres, 0.f, 1.f), 0.707);
            p.miller.c = BiquadCoefs::design(FilterType::LowPass, sr2, 9000.0, 0.0, 0.707);
        }
        // cabina
        const int cm = clampT(s.cabModel, 0, kNumCab - 1);
        if (cm != cabCur_) {
            if (snap) { cabCur_ = cabPrev_ = cm; xfade_ = 1.f; }
            else { cabPrev_ = cabCur_; cabCur_ = cm; xfade_ = 0.f; xfStep_ = 1.f / static_cast<float>(0.02 * sr_); }
        }
        cabMix_ = clampT(s.cabMix, 0.f, 1.f);
        for (auto& b : cabHp_) b.c = BiquadCoefs::design(FilterType::HighPass, sr_, s.cabLow, 0.0, 0.707);
        for (auto& b : cabLp_) b.c = BiquadCoefs::design(FilterType::LowPass, sr_, std::min(static_cast<double>(s.cabHigh), sr_ * 0.45), 0.0, 0.707);
        chorus_.set(s.choRate, clampT(s.choDepth, 0.f, 1.f)); choMix_ = clampT(s.choMix, 0.f, 1.f);
        delay_.set(s.dlyTime, s.dlyFb, s.dlyTone, clampT(s.dlyMode, 0, 2)); dlyMix_ = clampT(s.dlyMix, 0.f, 1.f);
        shimmer_.set(s.shiDecay, clampT(s.shiAmt, 0.f, 1.f), s.shiDamp); shiMix_ = clampT(s.shiMix, 0.f, 1.f);
        if (snap) {
            for (int k = 0; k < kMods; ++k) fade_[k] = tgt_[k];
            gIn_ = gInT_; gOut_ = gOutT_; mix_ = mixT_; byp_ = bypT_;
        }
    }

    double sr_{48000.0};
    Settings s_;
    Gate gate_; Comp comp_; Chorus chorus_; Delay delay_; Shimmer shimmer_;
    Fir fir_[2];
    std::array<std::array<float, kIrLen>, kNumCab> ir_{};
    Os2 os_[2]; DriveCh drv_[2]; PreCh pre_[2];
    Bq cabHp_[2], cabLp_[2];
    float ring_[2][32]{};
    size_t rw_{0};
    float fade_[kMods]{}, tgt_[kMods]{};
    float gIn_{1.f}, gInT_{1.f}, gOut_{1.f}, gOutT_{1.f}, mix_{1.f}, mixT_{1.f}, byp_{0.f}, bypT_{0.f};
    float cFade_{0.01f}, cSlow_{0.003f}, cBlend_{1.f}, cabMix_{1.f}, choMix_{0.4f}, dlyMix_{0.25f}, shiMix_{0.25f};
    float odGain_{10.f}, odLevel_{1.f}, dcA_{0.001f}, g1_{1.f}, g2_{1.f}, preMaster_{1.f}, sagK_{0.f}, sagAtk_{0.01f}, sagRel_{0.001f}, sag_{0.f};
    float xfade_{1.f}, xfStep_{0.001f}, gateGr_{0.f}, compGr_{0.f};
    int cabCur_{0}, cabPrev_{0};
};

} // namespace JasWaveStomp
