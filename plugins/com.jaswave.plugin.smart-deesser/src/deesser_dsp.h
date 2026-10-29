// =====================================================================================
//  JasWave Smart De-Esser – motor DSP (latencia 0)
//   - Sidechain filtrado (HP 24 dB/oct Butterworth o paso banda RBJ, Q 1.4) en cada canal,
//     detector de pico con enlace estéreo (ataque 0.5 ms, release ajustable)
//   - Detección absoluta (nivel del sidechain) o relativa (sidechain − banda completa, "smart")
//   - Computador de ganancia: ratio 6:1 con rodilla suave 6 dB, limitado a Range
//   - Split: cruce Linkwitz-Riley 4º orden (suma plana) y reducción solo en la banda alta
//     Wide : reducción de banda completa. Cambios de modo / escucha con crossfade
//   IDs/rangos 0..4 compatibles con "JasWave De-esser" (JasWaveFx / processor-profiles.json).
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

namespace JasWaveDeEsser {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t { kBypass = 0, kFreq = 1, kThreshold = 2, kRange = 3, kMode = 4, kListen = 5, kDetection = 6, kScFilter = 7, kRelease = 8, kGrMeter = 40 };
enum Feature : int { kFeatListen = 0, kFeatRelative = 1 };

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static const char* const kModes[] = { "Split", "Wide" };
        static const char* const kDet[] = { "Absolute", "Relative" };
        static const char* const kFilt[] = { "High-pass", "Band-pass" };
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kFreq, "Freq", "Hz", 3000.0, 12000.0, 6000.0, 0));
        v.push_back(linearP(kThreshold, "Threshold", "dB", -60.0, 0.0, -20.0, 1));
        v.push_back(linearP(kRange, "Range", "dB", 0.0, 24.0, 12.0, 1));
        v.push_back(stepP(kMode, "Mode", 1, 0, kModes));
        v.push_back(withFeature(toggleP(kListen, "Listen Sidechain", 0), kFeatListen));
        v.push_back(withFeature(stepP(kDetection, "Detection", 1, 0, kDet), kFeatRelative));
        v.push_back(stepP(kScFilter, "SC Filter", 1, 0, kFilt));
        v.push_back(linearP(kRelease, "Release", "ms", 20.0, 300.0, 80.0, 0));
        v.push_back(asReadOnly(linearP(kGrMeter, "GR", "dB", -60.0, 0.0, 0.0, 1)));
        marcarBasicos(v, { kBypass, kFreq, kThreshold, kRange, kMode });   // modo Básico del editor
        return v;
    }();
    return defs;
}

struct DeEsserSettings {
    double freqHz{6000.0}, thrDb{-20.0}, rangeDb{12.0}, releaseMs{80.0};
    bool wide{false}, listen{false}, relative{false}, bandPass{false}, bypass{false};
};

// Ganancia estática del de-esser (dB de reducción >= 0) a partir de lo que excede el umbral
inline double deesserGrDb(double overDb, double rangeDb) {
    constexpr double ratio = 6.0, knee = 6.0;
    double gr;
    if (2.0 * overDb <= -knee) gr = 0.0;
    else if (2.0 * overDb < knee) { const double t = overDb + knee * 0.5; gr = (1.0 - 1.0 / ratio) * t * t / (2.0 * knee); }
    else gr = (1.0 - 1.0 / ratio) * overDb;
    return std::min(gr, rangeDb);
}

struct DeEsserBus : MeterBusBase {
    SpectrumTap sc;                 // sidechain filtrado (para el espectro)
    PeakMeter inPk[2], outPk[2];
    PeakMeter grMax;
    std::atomic<float> grNow{0.0f}, scDb{-120.0f};
    ScopeRing scope;                // a = entrada, b = sidechain, gr = reducción
};

class DeEsserEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        freq_.prepare(sr_, 30.0); wide_.prepare(sr_, 10.0); listen_.prepare(sr_, 10.0); wet_.prepare(sr_, 10.0);
        atk_ = 1.0 - std::exp(-1.0 / (0.0005 * sr_));
        grAtk_ = 1.0 - std::exp(-1.0 / (0.001 * sr_));
        accum_.configure(sr_);
        setSettings(s_);
        freq_.reset(freq_.target()); wide_.reset(wide_.target()); listen_.reset(listen_.target()); wet_.reset(wet_.target());
        design(std::exp(freq_.current()));
        reset();
    }
    void reset() {
        for (auto& ch : xo_) for (auto& s : ch) s.reset();
        for (auto& ch : sc_) for (auto& s : ch) s.reset();
        envSc_ = envFull_ = 0.0; gr_ = 0.0;
    }
    double grDb() const { return gr_; }
    void setSettings(const DeEsserSettings& s) {
        s_ = s;
        freq_.setTarget(std::log(clampT(s.freqHz, 1000.0, 16000.0)));
        wide_.setTarget(s.wide ? 1.0 : 0.0);
        listen_.setTarget(s.listen ? 1.0 : 0.0);
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        rel_ = 1.0 - std::exp(-1.0 / (std::max(1.0, s.releaseMs) * 0.001 * sr_));
        if (s.bandPass != bandPass_) { bandPass_ = s.bandPass; dirty_ = true; }
    }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, DeEsserBus* bus) {
        if (bus) bus->entrada(inL, inR, n);
        const bool vista = bus && bus->vistaAbierta();   // scope solo con el editor abierto
        float pin[2] = { 0, 0 }, pout[2] = { 0, 0 };
        double grMax = 0.0, scPk = 0.0;
        int pos = 0;
        while (pos < n) {
            const int m = std::min(32, n - pos);
            if (!freq_.settled() || dirty_) { design(std::exp(freq_.advance(m))); dirty_ = false; }
            const double wd0 = wide_.current(), wd1 = wide_.advance(m);
            const double ls0 = listen_.current(), ls1 = listen_.advance(m);
            const double wt0 = wet_.current(), wt1 = wet_.advance(m);
            for (int i = 0; i < m; ++i) {
                const double t = static_cast<double>(i + 1) / m;
                const double x[2] = { static_cast<double>(inL[pos + i]), static_cast<double>(inR[pos + i]) };
                double sc[2], lo[2], hi[2];
                for (int c = 0; c < 2; ++c) {
                    // sidechain
                    double s = biquadProcess(scC_[0], sc_[c][0], x[c]);
                    s = biquadProcess(scC_[1], sc_[c][1], s);
                    sc[c] = s;
                    // cruce LR4
                    lo[c] = biquadProcess(lpC_, xo_[c][1], biquadProcess(lpC_, xo_[c][0], x[c]));
                    hi[c] = biquadProcess(hpC_, xo_[c][3], biquadProcess(hpC_, xo_[c][2], x[c]));
                }
                const double aSc = std::max(std::fabs(sc[0]), std::fabs(sc[1]));
                const double aFull = std::max(std::fabs(x[0]), std::fabs(x[1]));
                envSc_ += (aSc > envSc_ ? atk_ : rel_) * (aSc - envSc_);
                envFull_ += (aFull > envFull_ ? atk_ : rel_) * (aFull - envFull_);
                const double scDb = envSc_ < 1.0e-6 ? -120.0 : 20.0 * std::log10(envSc_);
                double over;
                if (s_.relative) {
                    const double fullDb = envFull_ < 1.0e-6 ? -120.0 : 20.0 * std::log10(envFull_);
                    // umbral relativo: diferencia sidechain − banda completa; puerta en −60 dBFS
                    over = scDb < -60.0 ? -100.0 : (scDb - fullDb) - s_.thrDb * 0.5;
                } else {
                    over = scDb - s_.thrDb;
                }
                const double target = deesserGrDb(over, s_.rangeDb);
                gr_ += (target > gr_ ? grAtk_ : rel_) * (target - gr_);
                if (gr_ < 1.0e-6) gr_ = 0.0;
                const double g = std::exp(-gr_ * 0.11512925464970229);
                const double wd = wd0 + (wd1 - wd0) * t, ls = ls0 + (ls1 - ls0) * t, wt = wt0 + (wt1 - wt0) * t;
                double y[2];
                for (int c = 0; c < 2; ++c) {
                    const double split = lo[c] + hi[c] * g;
                    const double wide = x[c] * g;
                    double v = split + (wide - split) * wd;
                    v += (sc[c] - v) * ls;          // escucha del sidechain
                    y[c] = x[c] + (v - x[c]) * wt;
                }
                outL[pos + i] = static_cast<T>(y[0]);
                outR[pos + i] = static_cast<T>(y[1]);
                if (bus) {
                    pin[0] = std::max(pin[0], static_cast<float>(std::fabs(x[0]))); pin[1] = std::max(pin[1], static_cast<float>(std::fabs(x[1])));
                    pout[0] = std::max(pout[0], static_cast<float>(std::fabs(y[0]))); pout[1] = std::max(pout[1], static_cast<float>(std::fabs(y[1])));
                    if (vista) accum_.push(bus->scope, static_cast<float>(aFull), static_cast<float>(aSc), static_cast<float>(gr_ * wt));
                    scPk = std::max(scPk, envSc_);
                }
                grMax = std::max(grMax, gr_ * wt);
                scBuf_[static_cast<size_t>(i)] = static_cast<float>(0.5 * (sc[0] + sc[1]));
            }
            if (vista) bus->sc.push(scBuf_.data(), nullptr, m);
            pos += m;
        }
        if (bus) {
            bus->salida(outL, outR, n);
            bus->inPk[0].update(pin[0]); bus->inPk[1].update(pin[1]);
            bus->outPk[0].update(pout[0]); bus->outPk[1].update(pout[1]);
            bus->grMax.update(static_cast<float>(grMax));
            bus->grNow.store(static_cast<float>(gr_), std::memory_order_relaxed);
            bus->scDb.store(scPk < 1e-6 ? -120.0f : static_cast<float>(20.0 * std::log10(scPk)), std::memory_order_relaxed);
        }
    }

private:
    void design(double f) {
        constexpr double q = 0.70710678118654752;
        lpC_ = BiquadCoefs::design(FilterType::LowPass, sr_, f, 0.0, q);
        hpC_ = BiquadCoefs::design(FilterType::HighPass, sr_, f, 0.0, q);
        if (bandPass_) {
            scC_[0] = BiquadCoefs::design(FilterType::BandPass, sr_, f, 0.0, 1.4);
            scC_[1] = BiquadCoefs::design(FilterType::BandPass, sr_, f, 0.0, 1.4);
        } else {
            scC_[0] = hpC_;
            scC_[1] = hpC_;
        }
    }
    double sr_{48000.0};
    DeEsserSettings s_;
    Smoother freq_, wide_, listen_, wet_;
    BiquadCoefs lpC_, hpC_, scC_[2];
    std::array<std::array<BiquadState, 4>, 2> xo_{};
    std::array<std::array<BiquadState, 2>, 2> sc_{};
    double atk_{0.04}, rel_{0.0003}, grAtk_{0.02}, envSc_{0}, envFull_{0}, gr_{0};
    bool bandPass_{false}, dirty_{true};
    std::array<float, 32> scBuf_{};
    ScopeAccum accum_;
};

} // namespace JasWaveDeEsser
