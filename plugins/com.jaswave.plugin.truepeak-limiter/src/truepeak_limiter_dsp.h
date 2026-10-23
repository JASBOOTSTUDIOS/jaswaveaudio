// =====================================================================================
//  JasWave TruePeak Brickwall Limiter – motor DSP
//   - Detección true-peak 4x (polifásica) sobre la señal ya amplificada (gain)
//   - Lookahead de 2 ms: mínimo deslizante + media móvil -> rampa de ataque sin distorsión
//     (el retardo del audio garantiza que la ganancia ya llegó al valor requerido en el pico)
//   - Release exponencial; limitador de seguridad final a ±ceiling (nunca se excede el techo)
//   - Latencia reportada al host (PDC) y bypass alineado en latencia con crossfade
//   - Medición: picos de entrada, true-peak de salida, GR, scope de forma de onda y LUFS M/S/I
// =====================================================================================
#pragma once

#include "../../shared-dsp/jw_dsp.h"
#include "../../shared-dsp/jw_params.h"

namespace JasWaveLimiter {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t { kBypass = 0, kCeiling = 1, kGain = 2, kRelease = 3 };

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kCeiling, "Ceiling", "dBTP", -12.0, 0.0, -1.0, 1));
        v.push_back(linearP(kGain, "Input Gain", "dB", 0.0, 24.0, 0.0, 1));
        v.push_back(logP(kRelease, "Release", "ms", 1.0, 1000.0, 80.0, 0));
        return v;
    }();
    return defs;
}

struct LimiterSettings { double ceilingDb{-1.0}, gainDb{0.0}, releaseMs{80.0}; bool bypass{false}; };

struct LimiterBus : MeterBusBase {
    SpectrumTap pre, post;
    PeakMeter inPk[2];
    PeakMeter tpOut;                 // true-peak de salida (lineal), desde la última lectura
    PeakMeter grMax;                 // dB
    ScopeRing scope;
    LoudnessMeter loudness;
    std::atomic<uint32_t> latency{0};
};

class LimiterEngine {
public:
    static constexpr double kLookaheadMs = 2.0;
    static constexpr int kMaxLookahead = 1024;

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        N_ = clampT(static_cast<int>(std::lround(kLookaheadMs * 0.001 * sr_)), 8, kMaxLookahead);
        D_ = N_ - 1 + TruePeak4x::kDelay;
        dlyLen_ = D_ + 1;
        for (int c = 0; c < 2; ++c) { dlyDriven_[c].assign(static_cast<size_t>(dlyLen_), 0.0f); dlyDry_[c].assign(static_cast<size_t>(dlyLen_), 0.0f); }
        box_.assign(static_cast<size_t>(N_), 1.0f);
        smin_.prepare(N_);
        gain_.prepare(sr_, 15.0); wet_.prepare(sr_, 10.0);
        accum_.configure(sr_);
        setSettings(s_);
        gain_.reset(gain_.target()); wet_.reset(wet_.target());
        prevGain_ = dbToLinear(gain_.target()); prevWet_ = wet_.target();
        reset();
    }
    void reset() {
        for (int c = 0; c < 2; ++c) { std::fill(dlyDriven_[c].begin(), dlyDriven_[c].end(), 0.0f); std::fill(dlyDry_[c].begin(), dlyDry_[c].end(), 0.0f); tpIn_[c].reset(); tpOut_[c].reset(); }
        std::fill(box_.begin(), box_.end(), 1.0f);
        boxSum_ = static_cast<double>(N_);
        boxPos_ = 0; wp_ = 0; rg_ = 1.0; hold_ = 0;
        smin_.reset();
    }
    uint32_t latencySamples() const { return static_cast<uint32_t>(D_); }

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
    }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, LimiterBus* bus) {
        const T* in[2] = { inL, inR };
        T* out[2] = { outL, outR };
        float pkIn[2] = { 0, 0 };
        float tpMax = 0.0f;
        double grMaxDb = 0.0;
        int pos = 0;
        if (bus) bus->loudness.pollReset();
        const double targetCeil = ceil_ * 0.945; // ~0.5 dB de margen anti-overshoot para interpolador 16x sinc
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
                // 1) true-peak de la señal amplificada -> ganancia requerida con margen
                const float tp = std::max(tpIn_[0].process(d[0]), tpIn_[1].process(d[1]));
                const double r = tp > targetCeil ? targetCeil / static_cast<double>(tp) : 1.0;
                // 2) mínimo deslizante (lookahead) + hold anti-distorsión + release suave
                const double mn = static_cast<double>(smin_.push(static_cast<float>(r), N_));
                if (mn < rg_) {
                    rg_ = mn;
                    hold_ = static_cast<int>(sr_ * 0.002); // 2 ms hold: previene modulación intra-ciclo
                } else {
                    if (hold_ > 0) {
                        --hold_;
                    } else {
                        rg_ += (1.0 - rg_) * relCoef_;
                    }
                }
                if (rg_ > 0.999999) rg_ = 1.0;
                // 3) media móvil = rampa de ataque suave
                boxSum_ += rg_ - static_cast<double>(box_[static_cast<size_t>(boxPos_)]);
                box_[static_cast<size_t>(boxPos_)] = static_cast<float>(rg_);
                if (++boxPos_ >= N_) boxPos_ = 0;
                const double g = std::min(1.0, boxSum_ / N_);
                // 4) audio retardado D = N-1+6
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
                    float v = static_cast<float>(static_cast<double>(oDriven[c]) * g);
                    v = clampT(v, static_cast<float>(-ceil_), static_cast<float>(ceil_));       // seguridad brickwall
                    const float o = (w <= 0.0) ? oDry[c] : (w >= 1.0) ? v : static_cast<float>(static_cast<double>(oDry[c]) + (static_cast<double>(v) - static_cast<double>(oDry[c])) * w);
                    out[c][pos + i] = static_cast<T>(o);
                    y[c] = o;
                }
                if (bus) {
                    bus->loudness.processSample(y[0], y[1]);
                    tpMax = std::max(tpMax, std::max(tpOut_[0].process(y[0]), tpOut_[1].process(y[1])));
                    const double grDb = g < 0.99999 ? -20.0 * std::log10(g) : 0.0;
                    grMaxDb = std::max(grMaxDb, grDb * w);
                    const float a = std::fabs(oDriven[0]) > std::fabs(oDriven[1]) ? oDriven[0] : oDriven[1];
                    const float b = std::fabs(y[0]) > std::fabs(y[1]) ? y[0] : y[1];
                    accum_.push(bus->scope, a, b, static_cast<float>(grDb * w));
                }
            }
            prevGain_ = gNow; prevWet_ = wNow;
            pos += m;
        }
        if (bus) {
            bus->inPk[0].update(pkIn[0]); bus->inPk[1].update(pkIn[1]);
            bus->tpOut.update(tpMax);
            bus->grMax.update(static_cast<float>(grMaxDb));
            bus->latency.store(static_cast<uint32_t>(D_), std::memory_order_relaxed);
        }
    }

private:
    double sr_{48000.0};
    LimiterSettings s_;
    int N_{96}, D_{101}, dlyLen_{102}, wp_{0}, boxPos_{0}, hold_{0};
    double ceil_{0.891}, relCoef_{0.001}, rg_{1.0}, boxSum_{96.0};
    double prevGain_{1.0}, prevWet_{1.0};
    std::array<std::vector<float>, 2> dlyDriven_, dlyDry_;
    std::vector<float> box_;
    SlidingMin smin_;
    Smoother gain_, wet_;
    std::array<TruePeak4x, 2> tpIn_, tpOut_;
    ScopeAccum accum_;
};

} // namespace JasWaveLimiter
