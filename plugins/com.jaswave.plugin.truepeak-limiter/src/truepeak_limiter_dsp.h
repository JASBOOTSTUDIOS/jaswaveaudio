// =====================================================================================
//  JasWave TruePeak Brickwall Limiter – motor DSP
//   - Detección true-peak 8x (polifásica, 257 taps) sobre la señal amplificada (Input Gain)
//   - Lookahead ajustable 0–10 ms dentro de una latencia FIJA (10 ms + 17 muestras): el detector
//     se pre-retrasa (Nmax − N) para que la rampa termine siempre al llegar el pico
//   - Mínimo deslizante + media móvil (rampa de ataque sin distorsión), hold 2 ms, release exp.
//   - Margen anti-overshoot interpolado y limitador de seguridad final a ±techo
//   - Dither TPDF opcional (24/16 bit) antes del recorte final
//   - Bypass alineado en latencia con crossfade; medición TP de salida, GR, scope y LUFS M/S/I
//   IDs/rangos compatibles con "JasWave Limitador" (JasWaveFx / processor-profiles.json).
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

namespace JasWaveLimiter {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t { kBypass = 0, kCeiling = 1, kGain = 2, kRelease = 3, kLookahead = 4, kDither = 5, kGrMeter = 40 };
enum Feature : int { kFeatLoudness = 0, kFeatDither = 1 };

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static const char* const kDitherLabels[] = { "Off", "24 bit", "16 bit" };
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kCeiling, "Ceiling", "dBTP", -12.0, 0.0, -1.0, 1));
        v.push_back(linearP(kGain, "Input Gain", "dB", 0.0, 24.0, 0.0, 1));
        v.push_back(linearP(kRelease, "Release", "ms", 1.0, 1000.0, 100.0, 0));
        v.push_back(linearP(kLookahead, "Lookahead", "ms", 0.0, 10.0, 2.0, 1));
        v.push_back(withFeature(stepP(kDither, "Dither", 2, 0, kDitherLabels), kFeatDither));
        v.push_back(asReadOnly(linearP(kGrMeter, "GR", "dB", -60.0, 0.0, 0.0, 1)));
        marcarBasicos(v, { kBypass, kCeiling, kGain, kRelease });   // modo Básico del editor
        return v;
    }();
    return defs;
}

struct LimiterSettings {
    double ceilingDb{-1.0}, gainDb{0.0}, releaseMs{100.0}, lookaheadMs{2.0};
    int dither{0};          // 0 off, 1 = 24 bit, 2 = 16 bit
    bool loudness{true}, bypass{false};
};

struct LimiterBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    PeakMeter tpOut;                 // true-peak de salida (lineal), desde la última lectura
    PeakMeter grMax;                 // dB
    ScopeRing scope;
    LoudnessMeter loudness;
    std::atomic<bool> loudnessOn{false};
    std::atomic<uint32_t> latency{0};
};

class LimiterEngine {
public:
    static constexpr double kMaxLookaheadMs = 10.0;
    static constexpr double kCeilingMargin = 0.945;   // ≈ −0.49 dB: margen para el pico interpolado

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        Nmax_ = std::max(1, static_cast<int>(std::lround(kMaxLookaheadMs * 0.001 * sr_)));
        D_ = Nmax_ + TruePeak8x::kDelay + 1;   // +2 muestras de seguridad: el pico interpolado puede caer antes de la muestra central
        dlyLen_ = D_ + 1;
        for (int c = 0; c < 2; ++c) { dlyDriven_[c].assign(static_cast<size_t>(dlyLen_), 0.0f); dlyDry_[c].assign(static_cast<size_t>(dlyLen_), 0.0f); }
        pre_.assign(static_cast<size_t>(Nmax_ + 1), 1.0f);
        box_.assign(static_cast<size_t>(Nmax_), 1.0f);
        smin_.prepare(Nmax_);
        gain_.prepare(sr_, 15.0);
        wet_.prepare(sr_, 10.0);
        accum_.configure(sr_);
        setSettings(s_);
        gain_.reset(gain_.target());
        wet_.reset(wet_.target());
        prevGain_ = dbToLinear(gain_.target());
        prevWet_ = wet_.target();
        reset();
    }
    void reset() {
        for (int c = 0; c < 2; ++c) {
            std::fill(dlyDriven_[c].begin(), dlyDriven_[c].end(), 0.0f);
            std::fill(dlyDry_[c].begin(), dlyDry_[c].end(), 0.0f);
            tpIn_[c].reset();
            tpOut_[c].reset();
        }
        std::fill(pre_.begin(), pre_.end(), 1.0f);
        resetBox();
        wp_ = 0; preW_ = 0; rg_ = 1.0; hold_ = 0;
        smin_.reset();
        gNow_ = 1.0;
    }
    uint32_t latencySamples() const { return static_cast<uint32_t>(D_); }
    double grDb() const { return gNow_ < 0.999999 ? -20.0 * std::log10(gNow_) : 0.0; }

    void snapAll() {
        gain_.reset(gain_.target());
        wet_.reset(wet_.target());
        prevGain_ = dbToLinear(gain_.target());
        prevWet_ = wet_.target();
    }

    void setSettings(const LimiterSettings& s) {
        s_ = s;
        ceil_ = dbToLinear(s.ceilingDb);
        gain_.setTarget(s.gainDb);
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        relCoef_ = 1.0 - std::exp(-1.0 / (sr_ * std::max(1.0, s.releaseMs) * 0.001));
        const int n = clampT(static_cast<int>(std::lround(s.lookaheadMs * 0.001 * sr_)), 1, Nmax_);
        if (n != N_) { N_ = n; resetBox(); smin_.reset(); }
        ditherAmp_ = s.dither == 1 ? 1.0 / 8388608.0 : s.dither == 2 ? 1.0 / 32768.0 : 0.0;
    }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, LimiterBus* bus) {
        if (bus) bus->entrada(inL, inR, n);
        const bool vista = bus && bus->vistaAbierta();   // scope solo con el editor abierto
        const T* in[2] = { inL, inR };
        T* out[2] = { outL, outR };
        float pkIn[2] = { 0, 0 }, pkOut[2] = { 0, 0 };
        float tpMax = 0.0f;
        double grMaxDb = 0.0;
        const bool loud = bus && s_.loudness;
        if (loud) bus->loudness.pollReset();
        const double targetCeil = ceil_ * kCeilingMargin;
        const int preDelay = Nmax_ - N_;
        int pos = 0;
        while (pos < n) {
            const int m = std::min(32, n - pos);
            const double gPrev = prevGain_;
            const double gNow = dbToLinear(gain_.advance(m));
            const double wNow = wet_.advance(m), wPrev = prevWet_;
            for (int i = 0; i < m; ++i) {
                const double t = static_cast<double>(i + 1) / m;
                const double gin = gPrev + (gNow - gPrev) * t;
                const double w = wPrev + (wNow - wPrev) * t;
                float x[2], d[2];
                for (int c = 0; c < 2; ++c) {
                    x[c] = static_cast<float>(in[c][pos + i]);
                    d[c] = static_cast<float>(static_cast<double>(x[c]) * gin);
                    pkIn[c] = std::max(pkIn[c], std::fabs(x[c]));
                }
                // 1) true-peak de la señal amplificada -> ganancia requerida (enlace estéreo)
                const float tp = std::max(tpIn_[0].process(d[0]), tpIn_[1].process(d[1]));
                float r = tp > targetCeil ? static_cast<float>(targetCeil / static_cast<double>(tp)) : 1.0f;
                // 2) pre-retardo del detector (lookahead < máximo con latencia fija)
                if (preDelay > 0) {
                    pre_[static_cast<size_t>(preW_)] = r;
                    int rp = preW_ - preDelay;
                    if (rp < 0) rp += static_cast<int>(pre_.size());
                    r = pre_[static_cast<size_t>(rp)];
                    if (++preW_ >= static_cast<int>(pre_.size())) preW_ = 0;
                }
                // 3) mínimo deslizante (lookahead) + hold + release
                const double mn = static_cast<double>(smin_.push(r, N_));
                if (mn < rg_) { rg_ = mn; hold_ = static_cast<int>(sr_ * 0.002); }
                else if (hold_ > 0) --hold_;
                else rg_ += (1.0 - rg_) * relCoef_;
                if (rg_ > 0.999999) rg_ = 1.0;
                // 4) media móvil = rampa de ataque suave de N muestras
                boxSum_ += rg_ - static_cast<double>(box_[static_cast<size_t>(boxPos_)]);
                box_[static_cast<size_t>(boxPos_)] = static_cast<float>(rg_);
                if (++boxPos_ >= N_) boxPos_ = 0;
                const double g = std::min(1.0, boxSum_ / N_);
                gNow_ = g;
                // 5) audio retardado D = Nmax+17 (latencia fija)
                float oDriven[2], oDry[2];
                const int rp = wp_ >= D_ ? wp_ - D_ : wp_ - D_ + dlyLen_;
                for (int c = 0; c < 2; ++c) {
                    dlyDriven_[c][static_cast<size_t>(wp_)] = d[c];
                    dlyDry_[c][static_cast<size_t>(wp_)] = x[c];
                    oDriven[c] = dlyDriven_[c][static_cast<size_t>(rp)];
                    oDry[c] = dlyDry_[c][static_cast<size_t>(rp)];
                }
                if (++wp_ >= dlyLen_) wp_ = 0;
                float y[2];
                for (int c = 0; c < 2; ++c) {
                    double v = static_cast<double>(oDriven[c]) * g;
                    if (ditherAmp_ > 0.0) v += ditherAmp_ * (rand01() - rand01());   // TPDF ±1 LSB
                    v = clampT(v, -ceil_, ceil_);                                        // seguridad brickwall
                    const double o = (w <= 0.0) ? oDry[c] : (w >= 1.0) ? v : static_cast<double>(oDry[c]) + (v - static_cast<double>(oDry[c])) * w;
                    out[c][pos + i] = static_cast<T>(o);
                    y[c] = static_cast<float>(o);
                    pkOut[c] = std::max(pkOut[c], std::fabs(y[c]));
                }
                if (bus) {
                    if (loud) bus->loudness.processSample(y[0], y[1]);
                    tpMax = std::max(tpMax, std::max(tpOut_[0].process(y[0]), tpOut_[1].process(y[1])));
                    const double grDb = g < 0.99999 ? -20.0 * std::log10(g) : 0.0;
                    grMaxDb = std::max(grMaxDb, grDb * w);
                    const float a = std::fabs(oDriven[0]) > std::fabs(oDriven[1]) ? oDriven[0] : oDriven[1];
                    const float b = std::fabs(y[0]) > std::fabs(y[1]) ? y[0] : y[1];
                    if (vista) accum_.push(bus->scope, a, b, static_cast<float>(grDb * w));
                }
            }
            prevGain_ = gNow; prevWet_ = wNow;
            pos += m;
        }
        if (bus) {
            bus->salida(outL, outR, n);
            bus->inPk[0].update(pkIn[0]); bus->inPk[1].update(pkIn[1]);
            bus->outPk[0].update(pkOut[0]); bus->outPk[1].update(pkOut[1]);
            bus->tpOut.update(tpMax);
            bus->grMax.update(static_cast<float>(grMaxDb));
            bus->latency.store(static_cast<uint32_t>(D_), std::memory_order_relaxed);
            bus->loudnessOn.store(loud, std::memory_order_relaxed);
        }
    }

private:
    void resetBox() {
        std::fill(box_.begin(), box_.end(), static_cast<float>(rg_));
        boxSum_ = rg_ * N_;
        boxPos_ = 0;
    }
    double rand01() {
        rng_ = rng_ * 1664525u + 1013904223u;
        return static_cast<double>(rng_ >> 8) / 16777216.0;
    }
    double sr_{48000.0};
    LimiterSettings s_;
    int Nmax_{480}, N_{96}, D_{485}, dlyLen_{486}, wp_{0}, boxPos_{0}, hold_{0}, preW_{0};
    double ceil_{0.891}, relCoef_{0.001}, rg_{1.0}, boxSum_{96.0}, gNow_{1.0}, ditherAmp_{0.0};
    double prevGain_{1.0}, prevWet_{1.0};
    uint32_t rng_{0x9E3779B9u};
    std::array<std::vector<float>, 2> dlyDriven_, dlyDry_;
    std::vector<float> pre_, box_;
    SlidingMin smin_;
    Smoother gain_, wet_;
    std::array<TruePeak8x, 2> tpIn_;
    std::array<TruePeak4x, 2> tpOut_;
    ScopeAccum accum_;
};

} // namespace JasWaveLimiter
