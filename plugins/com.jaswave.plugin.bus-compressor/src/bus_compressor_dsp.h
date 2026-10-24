// =====================================================================================
//  JasWave Master Bus Compressor – motor DSP (feed-forward, dominio logarítmico)
//   - Detección Peak o RMS (ventana 10 ms, compensada a pico-equivalente) con enlace estéreo
//   - Filtro sidechain HPF (Butterworth 12 dB/oct)
//   - Gain computer con soft-knee cuadrático (Giannoulis/Massberg/Reiss)
//   - Suavizado ataque/release del GR en dB
//   - Mix paralelo, makeup, bypass con crossfade. Latencia 0.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

namespace JasWaveComp {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t { kBypass = 0, kThreshold = 1, kRatio = 2, kAttack = 3, kRelease = 4, kKnee = 5,
                  kMakeup = 6, kMix = 7, kScHpf = 8, kDetector = 9, kGrMeter = 40 };
enum Feature : int { kFeatScFilter = 0, kFeatParallel = 1 };

// IDs, rangos y mapeos lineales compatibles con "JasWave Compresor" (JasWaveFx / processor-profiles.json)
inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static const char* const kDet[] = { "Peak", "RMS" };
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kThreshold, "Threshold", "dB", -60.0, 0.0, -20.0, 1));
        v.push_back(linearP(kRatio, "Ratio", ":1", 1.0, 20.0, 4.0, 1));
        v.push_back(linearP(kAttack, "Attack", "ms", 0.1, 200.0, 10.0, 1));
        v.push_back(linearP(kRelease, "Release", "ms", 5.0, 2000.0, 100.0, 0));
        v.push_back(linearP(kKnee, "Knee", "dB", 0.0, 24.0, 6.0, 1));
        v.push_back(linearP(kMakeup, "Makeup", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(withFeature(linearP(kMix, "Mix", "%", 0.0, 100.0, 100.0, 0), kFeatParallel));
        v.push_back(withFeature(linearP(kScHpf, "Sidechain HP", "Hz", 0.0, 500.0, 0.0, 0), kFeatScFilter));
        v.push_back(stepP(kDetector, "Detector", 1, 1, kDet));
        v.push_back(asReadOnly(linearP(kGrMeter, "GR", "dB", -60.0, 0.0, 0.0, 1)));
        return v;
    }();
    return defs;
}

struct CompSettings {
    double thrDb{-20.0}, ratio{4.0}, attackMs{10.0}, releaseMs{100.0}, kneeDb{6.0}, makeupDb{0.0}, mix{1.0}, scHpfHz{0.0};
    bool rms{true}, bypass{false};
};

// Curva estática (dB de entrada -> dB de salida sin makeup); compartida con la UI
inline double staticOutDb(double x, double thr, double ratio, double knee) {
    const double over = x - thr;
    if (knee > 0.0 && 2.0 * over > -knee && 2.0 * over < knee) {
        const double t = over + knee * 0.5;
        return x + (1.0 / ratio - 1.0) * t * t / (2.0 * knee);
    }
    if (2.0 * over <= -knee) return x;
    return thr + over / ratio;
}

struct CompBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    PeakMeter grMax;                         // dB (>=0), máximo desde la última lectura
    std::atomic<float> detLevelDb{-100.0f};  // último nivel del detector
    std::atomic<float> grNow{0.0f};          // GR instantáneo al final del bloque
    ScopeRing scope;
};

class CompressorEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        thr_.prepare(sr_, 20.0); ratio_.prepare(sr_, 20.0); knee_.prepare(sr_, 20.0);
        makeup_.prepare(sr_, 20.0); mix_.prepare(sr_, 20.0); wet_.prepare(sr_, 10.0);
        rmsCoef_ = 1.0 - std::exp(-1.0 / (0.010 * sr_));
        accum_.configure(sr_);
        setSettings(s_);
        thr_.reset(thr_.target()); ratio_.reset(ratio_.target()); knee_.reset(knee_.target());
        makeup_.reset(makeup_.target()); mix_.reset(mix_.target()); wet_.reset(wet_.target());
        reset();
    }
    void reset() { gr_ = 0.0; pw_ = 0.0; for (auto& c : hpSt_) c.reset(); }
    double grDb() const { return gr_; }

    void snapAll() {
        thr_.reset(thr_.target()); ratio_.reset(ratio_.target()); knee_.reset(knee_.target());
        makeup_.reset(makeup_.target()); mix_.reset(mix_.target()); wet_.reset(wet_.target());
    }

    void setSettings(const CompSettings& s) {
        s_ = s;
        thr_.setTarget(s.thrDb); ratio_.setTarget(std::max(1.0, s.ratio)); knee_.setTarget(s.kneeDb);
        makeup_.setTarget(s.makeupDb); mix_.setTarget(s.mix); wet_.setTarget(s.bypass ? 0.0 : 1.0);
        atkCoef_ = 1.0 - std::exp(-1.0 / (sr_ * std::max(0.01, s.attackMs) * 0.001));
        relCoef_ = 1.0 - std::exp(-1.0 / (sr_ * std::max(1.0, s.releaseMs) * 0.001));
        hpOn_ = s.scHpfHz >= 20.0;
        if (hpOn_) hpC_ = BiquadCoefs::design(FilterType::HighPass, sr_, s.scHpfHz, 0.0, 0.70710678);
    }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, CompBus* bus) {
        if (bus) bus->entrada(inL, inR, n);
        const bool vista = bus && bus->vistaAbierta();   // scope solo con el editor abierto
        int pos = 0;
        float pkIn[2] = { 0, 0 }, pkOut[2] = { 0, 0 };
        double grMax = 0.0, lastLev = -100.0;
        while (pos < n) {
            const int m = std::min(32, n - pos);
            const double thr = thr_.advance(m), ratio = ratio_.advance(m), knee = knee_.advance(m);
            const double mk = dbToLinear(makeup_.advance(m)), mix = mix_.advance(m), wetNow = wet_.advance(m);
            for (int i = 0; i < m; ++i) {
                const double xl = static_cast<double>(inL[pos + i]), xr = static_cast<double>(inR[pos + i]);
                // detector
                double dl = xl, dr = xr;
                if (hpOn_) { dl = biquadProcess(hpC_, hpSt_[0], dl); dr = biquadProcess(hpC_, hpSt_[1], dr); }
                double lev;
                if (s_.rms) {
                    const double p = std::max(dl * dl, dr * dr);
                    pw_ += rmsCoef_ * (p - pw_);
                    lev = pw_ < 1.0e-12 ? -100.0 : 10.0 * std::log10(pw_ * 2.0);   // pico-equivalente para senoidal
                } else {
                    const double a = std::max(std::fabs(dl), std::fabs(dr));
                    lev = a < 1.0e-5 ? -100.0 : 20.0 * std::log10(a);
                }
                const double target = std::max(0.0, lev - staticOutDb(lev, thr, ratio, knee));
                gr_ += (target > gr_ ? atkCoef_ : relCoef_) * (target - gr_);
                if (target == 0.0 && gr_ < 1.0e-4) gr_ = 0.0;
                const double g = std::exp(-gr_ * 0.11512925464970229);
                const double wl = xl * g * mk, wr = xr * g * mk;
                const double yl = (mix <= 0.0) ? xl : (mix >= 1.0) ? wl : (xl * (1.0 - mix) + wl * mix);
                const double yr = (mix <= 0.0) ? xr : (mix >= 1.0) ? wr : (xr * (1.0 - mix) + wr * mix);
                const double w = wetNow;
                const double ol = (w <= 0.0) ? xl : (w >= 1.0) ? yl : (xl + (yl - xl) * w);
                const double orr = (w <= 0.0) ? xr : (w >= 1.0) ? yr : (xr + (yr - xr) * w);
                outL[pos + i] = static_cast<T>(ol); outR[pos + i] = static_cast<T>(orr);
                if (bus) {
                    pkIn[0] = std::max(pkIn[0], static_cast<float>(std::fabs(xl))); pkIn[1] = std::max(pkIn[1], static_cast<float>(std::fabs(xr)));
                    pkOut[0] = std::max(pkOut[0], static_cast<float>(std::fabs(ol))); pkOut[1] = std::max(pkOut[1], static_cast<float>(std::fabs(orr)));
                    const float ain = static_cast<float>(std::max(std::fabs(xl), std::fabs(xr)));
                    const float aout = static_cast<float>(std::max(std::fabs(ol), std::fabs(orr)));
                    if (vista) accum_.push(bus->scope, ain, aout, static_cast<float>(gr_ * w));
                }
                grMax = std::max(grMax, gr_ * w);
                lastLev = lev;
            }
            pos += m;
        }
        if (bus) {
            bus->salida(outL, outR, n);
            bus->inPk[0].update(pkIn[0]); bus->inPk[1].update(pkIn[1]);
            bus->outPk[0].update(pkOut[0]); bus->outPk[1].update(pkOut[1]);
            bus->grMax.update(static_cast<float>(grMax));
            bus->detLevelDb.store(static_cast<float>(lastLev), std::memory_order_relaxed);
            bus->grNow.store(static_cast<float>(gr_), std::memory_order_relaxed);
        }
    }

private:
    double sr_{48000.0};
    CompSettings s_;
    Smoother thr_, ratio_, knee_, makeup_, mix_, wet_;
    double atkCoef_{0.01}, relCoef_{0.001}, rmsCoef_{0.002};
    double gr_{0.0}, pw_{0.0};
    bool hpOn_{false};
    BiquadCoefs hpC_;
    std::array<BiquadState, 2> hpSt_{};
    ScopeAccum accum_;
};

} // namespace JasWaveComp
