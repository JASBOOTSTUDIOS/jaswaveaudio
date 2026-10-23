// =====================================================================================
//  JasWave EQ Parametric Pro – motor DSP (8 bandas, fase mínima, latencia 0)
//   Banda 0: Low-Cut (HP Butterworth 12/24/36/48 dB/oct)      Banda 7: High-Cut (LP idem)
//   Banda 1: Low Shelf   Bandas 2-5: Bell   Banda 6: High Shelf
// =====================================================================================
#pragma once

#include "../../shared-dsp/jw_dsp.h"
#include "../../shared-dsp/jw_params.h"

#include <deque>
#include <string>

namespace JasWaveEq {

using namespace JasWaveDsp;
using namespace JasWaveVst;

constexpr int kBands = 8;
constexpr int kSlots = 14;     // HP 0..3, bandas 1..6 -> 4..9, LP 10..13

enum : uint32_t { kBypass = 0, kOutGain = 1, kAnalyzer = 2, kSlope = 3 };
inline constexpr uint32_t bandParam(int band, int field) { return 100u + static_cast<uint32_t>(band) * 10u + static_cast<uint32_t>(field); }
enum BandField { fOn = 0, fFreq = 1, fGain = 2, fQ = 3 };

inline bool bandHasGain(int b) { return b >= 1 && b <= 6; }
inline FilterType bandType(int b) {
    if (b == 0) return FilterType::HighPass;
    if (b == 7) return FilterType::LowPass;
    if (b == 1) return FilterType::LowShelf;
    if (b == 6) return FilterType::HighShelf;
    return FilterType::Bell;
}

struct BandDefault { double freq, q; bool on; };
inline BandDefault bandDefault(int b) {
    static const BandDefault d[kBands] = {
        { 30.0, 0.71, false }, { 110.0, 0.71, true }, { 300.0, 1.0, true }, { 1000.0, 1.0, true },
        { 3000.0, 1.0, true }, { 6500.0, 1.0, true }, { 10000.0, 0.71, true }, { 18000.0, 0.71, false } };
    return d[b];
}

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static std::deque<std::string> names;
        auto nm = [&](const std::string& s) { names.push_back(s); return names.back().c_str(); };
        std::vector<ParamDef> v;
        static const char* const kAnalyzerLabels[] = { "Off", "Post", "Pre+Post" };
        static const char* const kSlopeLabels[] = { "12 dB", "24 dB", "36 dB", "48 dB" };
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kOutGain, "Output Gain", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(stepP(kAnalyzer, "Analyzer", 2, 2, kAnalyzerLabels));
        v.push_back(stepP(kSlope, "HP/LP Slope", 3, 1, kSlopeLabels));
        for (int b = 0; b < kBands; ++b) {
            const BandDefault bd = bandDefault(b);
            const std::string p = "Band " + std::to_string(b + 1) + " ";
            v.push_back(toggleP(bandParam(b, fOn), nm(p + "On"), bd.on ? 1 : 0));
            v.push_back(logP(bandParam(b, fFreq), nm(p + "Freq"), "Hz", 20.0, 20000.0, bd.freq, 1));
            if (bandHasGain(b)) {
                v.push_back(linearP(bandParam(b, fGain), nm(p + "Gain"), "dB", -18.0, 18.0, 0.0, 1, true));
                const bool shelf = (b == 1 || b == 6);
                v.push_back(logP(bandParam(b, fQ), nm(p + "Q"), "", shelf ? 0.25 : 0.1, shelf ? 2.5 : 18.0, bd.q, 2));
            }
        }
        return v;
    }();
    return defs;
}

struct BandSettings { bool on{false}; double freq{1000.0}, gainDb{0.0}, q{1.0}; };
struct EqSettings {
    std::array<BandSettings, kBands> band;
    int slopeIdx{1};
    double outGainDb{0.0};
    bool bypass{false};
    EqSettings() { for (int b = 0; b < kBands; ++b) { auto d = bandDefault(b); band[b] = { d.on, d.freq, 0.0, d.q }; } }
};

struct EqSlots {
    std::array<BiquadCoefs, kSlots> c;
    std::array<bool, kSlots> active{};
    int hpSections{2}, lpSections{2};
};

inline void buildSlots(const EqSettings& s, double sr, EqSlots& out, bool ignoreOn) {
    const int nsec = s.slopeIdx + 1, order = nsec * 2;
    out.hpSections = out.lpSections = nsec;
    for (int k = 0; k < 4; ++k) {
        const bool a = k < nsec;
        out.active[k] = a; out.active[10 + k] = a;
        out.c[k] = a ? BiquadCoefs::design(FilterType::HighPass, sr, s.band[0].freq, 0.0, butterworthQ(order, k)) : BiquadCoefs{};
        out.c[10 + k] = a ? BiquadCoefs::design(FilterType::LowPass, sr, s.band[7].freq, 0.0, butterworthQ(order, k)) : BiquadCoefs{};
    }
    for (int b = 1; b <= 6; ++b) {
        const BandSettings& bs = s.band[b];
        const double g = (bs.on || ignoreOn) ? bs.gainDb : 0.0;
        out.c[3 + b] = BiquadCoefs::design(bandType(b), sr, bs.freq, g, bs.q);
        out.active[3 + b] = std::fabs(g) > 1.0e-4;
    }
}

// Respuesta total en dB (misma matemática que corre en el hilo de audio) – usada por la UI
inline double responseDb(const EqSettings& s, const EqSlots& sl, double sr, double freq, int onlyBand = -1) {
    double db = 0.0;
    if (onlyBand < 0 || onlyBand == 0) {
        if (s.band[0].on || onlyBand == 0) for (int k = 0; k < sl.hpSections; ++k) db += sl.c[k].magnitudeDb(freq, sr);
    }
    if (onlyBand < 0 || onlyBand == 7) {
        if (s.band[7].on || onlyBand == 7) for (int k = 0; k < sl.lpSections; ++k) db += sl.c[10 + k].magnitudeDb(freq, sr);
    }
    for (int b = 1; b <= 6; ++b) {
        if (onlyBand >= 0 && onlyBand != b) continue;
        if (sl.active[3 + b]) db += sl.c[3 + b].magnitudeDb(freq, sr);
    }
    return db;
}

// ---- Bus de telemetría (audio -> UI) ----
struct EqBus : MeterBusBase {
    SpectrumTap pre, post;
    PeakMeter inPk[2], outPk[2];
    std::atomic<int> analyzerMode{2};
};

// ---- Motor ----
class EqEngine {
public:
    void prepare(double sr, int maxBlock) {
        sr_ = sr > 0 ? sr : 48000.0;
        (void)maxBlock;
        for (int b = 0; b < kBands; ++b) { lf_[b].prepare(sr_, 25.0); g_[b].prepare(sr_, 25.0); lq_[b].prepare(sr_, 25.0); }
        mixHp_.prepare(sr_, 12.0); mixLp_.prepare(sr_, 12.0);
        outG_.prepare(sr_, 25.0); wet_.prepare(sr_, 10.0);
        setSettings(target_);
        snapAll();
        resetState();
    }
    void resetState() { for (auto& ch : st_) for (auto& s : ch) s.reset(); }

    void setSettings(const EqSettings& s) {
        target_ = s;
        for (int b = 0; b < kBands; ++b) {
            lf_[b].setTarget(std::log(s.band[b].freq));
            g_[b].setTarget(s.band[b].on ? s.band[b].gainDb : 0.0);
            lq_[b].setTarget(std::log(s.band[b].q));
        }
        mixHp_.setTarget(s.band[0].on ? 1.0 : 0.0);
        mixLp_.setTarget(s.band[7].on ? 1.0 : 0.0);
        outG_.setTarget(s.outGainDb);
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        dirty_ = true;
    }
    void snapAll() {
        for (int b = 0; b < kBands; ++b) {
            lf_[b].reset(lf_[b].target()); g_[b].reset(g_[b].target()); lq_[b].reset(lq_[b].target());
        }
        mixHp_.reset(mixHp_.target()); mixLp_.reset(mixLp_.target());
        outG_.reset(outG_.target()); wet_.reset(wet_.target());
        prevOut_ = dbToLinear(outG_.current()); prevWet_ = wet_.current();
        rebuild();
    }

    // L/R pueden alias de salida (in-place). outR puede apuntar a un buffer auxiliar en mono.
    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, EqBus* bus = nullptr) {
        if (bus) bus->pre.pushT(inL, inR, n);
        int pos = 0;
        while (pos < n) {
            const int m = std::min(kSub, n - pos);
            advance(m);
            const double wetNow = wet_.current();
            const double outNow = dbToLinear(outG_.current());
            const bool fullyBypassed = wetNow <= 0.0 && prevWet_ <= 0.0;
            if (fullyBypassed) {
                for (int i = 0; i < m; ++i) { const T l = inL[pos + i], r = inR[pos + i]; outL[pos + i] = l; outR[pos + i] = r; }
                resetState();
            } else {
                const double mhp = mixHp_.current(), mlp = mixLp_.current();
                for (int i = 0; i < m; ++i) {
                    const double t = static_cast<double>(i + 1) / m;
                    const double w = prevWet_ + (wetNow - prevWet_) * t;
                    const double og = prevOut_ + (outNow - prevOut_) * t;
                    const double xl = static_cast<double>(inL[pos + i]);
                    const double xr = static_cast<double>(inR[pos + i]);
                    double yl = xl, yr = xr;
                    // Low-cut
                    if (mhp > 0.0) {
                        double hl = yl, hr = yr;
                        for (int k = 0; k < slots_.hpSections; ++k) { hl = biquadProcess(slots_.c[k], st_[0][k], hl); hr = biquadProcess(slots_.c[k], st_[1][k], hr); }
                        yl += (hl - yl) * mhp; yr += (hr - yr) * mhp;
                    } else { for (int k = 0; k < 4; ++k) { st_[0][k].reset(); st_[1][k].reset(); } }
                    // Shelves y Bells
                    for (int s = 4; s <= 9; ++s) {
                        if (slots_.active[s]) { yl = biquadProcess(slots_.c[s], st_[0][s], yl); yr = biquadProcess(slots_.c[s], st_[1][s], yr); }
                        else { st_[0][s].reset(); st_[1][s].reset(); }
                    }
                    // High-cut
                    if (mlp > 0.0) {
                        double ll = yl, lr = yr;
                        for (int k = 0; k < slots_.lpSections; ++k) { ll = biquadProcess(slots_.c[10 + k], st_[0][10 + k], ll); lr = biquadProcess(slots_.c[10 + k], st_[1][10 + k], lr); }
                        yl += (ll - yl) * mlp; yr += (lr - yr) * mlp;
                    } else { for (int k = 10; k < 14; ++k) { st_[0][k].reset(); st_[1][k].reset(); } }
                    yl *= og; yr *= og;
                    outL[pos + i] = static_cast<T>(xl + (yl - xl) * w);
                    outR[pos + i] = static_cast<T>(xr + (yr - xr) * w);
                }
            }
            prevWet_ = wetNow; prevOut_ = outNow;
            pos += m;
        }
        if (bus) bus->post.pushT(outL, outR, n);
    }

    const EqSettings& settings() const { return target_; }

private:
    static constexpr int kSub = 32;
    void advance(int m) {
        bool changed = dirty_;
        for (int b = 0; b < kBands; ++b) {
            if (!lf_[b].settled() || !g_[b].settled() || !lq_[b].settled()) changed = true;
            lf_[b].advance(m); g_[b].advance(m); lq_[b].advance(m);
        }
        mixHp_.advance(m); mixLp_.advance(m); outG_.advance(m); wet_.advance(m);
        if (changed) { rebuild(); dirty_ = false; }
    }
    void rebuild() {
        EqSettings cur = target_;
        for (int b = 0; b < kBands; ++b) {
            cur.band[b].freq = std::exp(lf_[b].current());
            cur.band[b].gainDb = g_[b].current();
            cur.band[b].q = std::exp(lq_[b].current());
            cur.band[b].on = true;   // el on/off ya está incorporado en gain / mix
        }
        buildSlots(cur, sr_, slots_, true);
    }

    double sr_{48000.0};
    EqSettings target_;
    EqSlots slots_;
    std::array<std::array<BiquadState, kSlots>, 2> st_{};
    std::array<Smoother, kBands> lf_, g_, lq_;
    Smoother mixHp_, mixLp_, outG_, wet_;
    double prevOut_{1.0}, prevWet_{1.0};
    bool dirty_{true};
};

} // namespace JasWaveEq
