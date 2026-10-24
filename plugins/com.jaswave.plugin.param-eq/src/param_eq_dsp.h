// =====================================================================================
//  JasWave EQ Parametric Pro – motor DSP (8 bandas de tipo seleccionable, fase mínima, latencia 0)
//   Tipos por banda: HPF, Low Shelf, Peak, High Shelf, LPF, Notch (RBJ cookbook)
//   HPF/LPF: 12 dB/oct (Q de la banda = resonancia) o 24/36/48 dB/oct Butterworth en cascada
//   Suavizado logarítmico de frecuencia y Q, lineal de ganancia; cambios de tipo/pendiente
//   con fundido de la banda (sin clics). IDs/rangos compatibles con "JasWave EQ" (JasWaveFx).
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include <deque>
#include <string>

namespace JasWaveEq {

using namespace JasWaveDsp;
using namespace JasWaveVst;

constexpr int kBands = 8;
constexpr int kMaxSec = 4;
enum : uint32_t { kBypass = 0, kOutput = 41, kSlope = 42, kAnalyzer = 43 };
enum BandField : uint32_t { fType = 0, fFreq = 1, fGain = 2, fQ = 3, fOn = 4 };
inline constexpr uint32_t bandParam(int band, BandField f) { return 1u + static_cast<uint32_t>(band) * 5u + static_cast<uint32_t>(f); }
enum BandType : int { tHpf = 0, tLowShelf = 1, tPeak = 2, tHighShelf = 3, tLpf = 4, tNotch = 5 };
enum Feature : int { kFeatAdvancedBands = 0, kFeatSteepSlopes = 1, kFeatAnalyzer = 2 };
constexpr int kFirstAdvancedBand = 4;   // bandas 5–8

struct BandDefault { int type; double freq, q; bool on; };
inline BandDefault bandDefault(int b) {
    static const BandDefault d[kBands] = { { tHpf, 30.0, 0.71, false },     { tLowShelf, 100.0, 0.71, true }, { tPeak, 250.0, 1.0, true },
                                           { tPeak, 1000.0, 1.0, true },    { tPeak, 3000.0, 1.0, true },     { tPeak, 6000.0, 1.0, true },
                                           { tHighShelf, 10000.0, 0.71, true }, { tLpf, 18000.0, 0.71, false } };
    return d[b];
}

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static std::deque<std::string> names;
        auto nm = [&](const std::string& s) { names.push_back(s); return names.back().c_str(); };
        static const char* const kTypes[] = { "HPF", "Low Shelf", "Peak", "High Shelf", "LPF", "Notch" };
        static const char* const kSlopes[] = { "12 dB/oct", "24 dB/oct", "36 dB/oct", "48 dB/oct" };
        static const char* const kAnalyzerLabels[] = { "Off", "Post", "Pre+Post" };
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        for (int b = 0; b < kBands; ++b) {
            const BandDefault bd = bandDefault(b);
            const std::string p = "Band " + std::to_string(b + 1) + " ";
            const int feat = b >= kFirstAdvancedBand ? kFeatAdvancedBands : -1;
            v.push_back(withFeature(stepP(bandParam(b, fType), nm(p + "Type"), 5, bd.type, kTypes), feat));
            v.push_back(withFeature(logP(bandParam(b, fFreq), nm(p + "Freq"), "Hz", 20.0, 20000.0, bd.freq, 1), feat));
            v.push_back(withFeature(linearP(bandParam(b, fGain), nm(p + "Gain"), "dB", -24.0, 24.0, 0.0, 1, true), feat));
            v.push_back(withFeature(linearP(bandParam(b, fQ), nm(p + "Q"), "", 0.1, 18.0, bd.q, 2), feat));
            v.push_back(withFeature(toggleP(bandParam(b, fOn), nm(p + "On"), bd.on ? 1 : 0), feat));
        }
        v.push_back(linearP(kOutput, "Output", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(withFeature(stepP(kSlope, "HP/LP Slope", 3, 0, kSlopes), kFeatSteepSlopes));
        v.push_back(withFeature(stepP(kAnalyzer, "Analyzer", 2, 1, kAnalyzerLabels), kFeatAnalyzer));
        return v;
    }();
    return defs;
}

struct BandSettings { int type{tPeak}; double freq{1000.0}, gainDb{0.0}, q{1.0}; bool on{true}; };
struct EqSettings {
    std::array<BandSettings, kBands> band;
    int slopeIdx{0};          // 0..3 -> 12..48 dB/oct
    double outGainDb{0.0};
    bool bypass{false};
    int analyzer{1};
    EqSettings() {
        for (int b = 0; b < kBands; ++b) { const auto d = bandDefault(b); band[b] = { d.type, d.freq, 0.0, d.q, d.on }; }
    }
};

inline bool isCut(int type) { return type == tHpf || type == tLpf; }
inline bool hasGain(int type) { return type == tLowShelf || type == tPeak || type == tHighShelf; }
inline FilterType rbjType(int type) {
    switch (type) {
        case tHpf: return FilterType::HighPass;
        case tLpf: return FilterType::LowPass;
        case tLowShelf: return FilterType::LowShelf;
        case tHighShelf: return FilterType::HighShelf;
        case tNotch: return FilterType::Notch;
        default: return FilterType::Bell;
    }
}

// Coeficientes de una banda (misma matemática en audio y UI)
struct BandCoefs { std::array<BiquadCoefs, kMaxSec> c; int n{1}; };
inline void designBand(int type, double sr, double freq, double gainDb, double q, int slopeIdx, BandCoefs& out) {
    if (isCut(type)) {
        if (slopeIdx <= 0) { out.n = 1; out.c[0] = BiquadCoefs::design(rbjType(type), sr, freq, 0.0, q); return; }
        const int nsec = slopeIdx + 1, order = nsec * 2;
        out.n = nsec;
        for (int k = 0; k < nsec; ++k) out.c[static_cast<size_t>(k)] = BiquadCoefs::design(rbjType(type), sr, freq, 0.0, butterworthQ(order, k));
        return;
    }
    out.n = 1;
    out.c[0] = BiquadCoefs::design(rbjType(type), sr, freq, hasGain(type) ? gainDb : 0.0, q);
}
inline double bandResponseDb(const BandCoefs& bc, double sr, double f) {
    double db = 0.0;
    for (int k = 0; k < bc.n; ++k) db += bc.c[static_cast<size_t>(k)].magnitudeDb(f, sr);
    return db;
}

struct EqBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    std::atomic<int> analyzer{1};
};

class EqEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        for (auto& b : bands_) { b.lf.prepare(sr_, 25.0); b.g.prepare(sr_, 25.0); b.lq.prepare(sr_, 25.0); b.mix.prepare(sr_, 6.0); }
        out_.prepare(sr_, 25.0);
        wet_.prepare(sr_, 10.0);
        setSettings(s_);
        snap();
        reset();
    }
    void reset() { for (auto& b : bands_) for (auto& ch : b.st) for (auto& s : ch) s.reset(); }

    void setSettings(const EqSettings& s) {
        s_ = s;
        for (int i = 0; i < kBands; ++i) {
            Band& b = bands_[static_cast<size_t>(i)];
            const BandSettings& bs = s.band[static_cast<size_t>(i)];
            b.reqType = bs.type;
            b.reqSlope = s.slopeIdx;
            b.on = bs.on;
            b.lf.setTarget(std::log(clampT(bs.freq, 10.0, 22000.0)));
            b.g.setTarget(bs.gainDb);
            b.lq.setTarget(std::log(clampT(bs.q, 0.05, 40.0)));
            b.mix.setTarget(targetMix(b));
            b.dirty = true;
        }
        out_.setTarget(dbToLinear(s.outGainDb));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
    }
    void snap() {
        for (auto& b : bands_) {
            b.curType = b.reqType;
            b.curSlope = b.reqSlope;
            b.lf.reset(b.lf.target()); b.g.reset(b.g.target()); b.lq.reset(b.lq.target());
            b.mix.reset(targetMix(b));
            design(b);
        }
        out_.reset(out_.target());
        wet_.reset(wet_.target());
    }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, EqBus* bus) {
        // El analizador (0 apagado, 1 salida, 2 entrada+salida) solo decide qué dibuja el editor.
        const bool tap = bus && s_.analyzer > 0;
        if (tap && s_.analyzer >= 2) bus->entrada(inL, inR, n);
        float pin[2] = { 0, 0 }, pout[2] = { 0, 0 };
        int pos = 0;
        while (pos < n) {
            const int m = std::min(32, n - pos);
            std::array<double, kBands> mix0{}, mix1{};
            for (int i = 0; i < kBands; ++i) {
                Band& b = bands_[static_cast<size_t>(i)];
                // cambio de tipo/pendiente: fundido de salida, cambio, fundido de entrada
                if (b.reqType != b.curType || (isCut(b.curType) && b.reqSlope != b.curSlope)) {
                    b.mix.setTarget(0.0);
                    if (b.mix.current() < 1.0e-3) {
                        b.curType = b.reqType;
                        b.curSlope = b.reqSlope;
                        for (auto& ch : b.st) for (auto& st : ch) st.reset();
                        b.mix.reset(0.0);
                        b.mix.setTarget(targetMix(b));
                        b.dirty = true;
                    }
                }
                mix0[static_cast<size_t>(i)] = b.mix.current();
                mix1[static_cast<size_t>(i)] = b.mix.advance(m);
                if (b.dirty || !b.lf.settled() || !b.g.settled() || !b.lq.settled()) {
                    b.lf.advance(m); b.g.advance(m); b.lq.advance(m);
                    design(b);
                    b.dirty = false;
                }
            }
            const double o0 = out_.current(), o1 = out_.advance(m);
            const double w0 = wet_.current(), w1 = wet_.advance(m);
            for (int i = 0; i < m; ++i) {
                const double t = static_cast<double>(i + 1) / m;
                const double xl = static_cast<double>(inL[pos + i]), xr = static_cast<double>(inR[pos + i]);
                double yl = xl, yr = xr;
                for (int bi = 0; bi < kBands; ++bi) {
                    Band& b = bands_[static_cast<size_t>(bi)];
                    const double mx = mix0[static_cast<size_t>(bi)] + (mix1[static_cast<size_t>(bi)] - mix0[static_cast<size_t>(bi)]) * t;
                    if (mx <= 0.0) continue;
                    double fl = yl, fr = yr;
                    for (int k = 0; k < b.coefs.n; ++k) {
                        fl = biquadProcess(b.coefs.c[static_cast<size_t>(k)], b.st[0][static_cast<size_t>(k)], fl);
                        fr = biquadProcess(b.coefs.c[static_cast<size_t>(k)], b.st[1][static_cast<size_t>(k)], fr);
                    }
                    yl += (fl - yl) * mx;
                    yr += (fr - yr) * mx;
                }
                const double og = o0 + (o1 - o0) * t, w = w0 + (w1 - w0) * t;
                yl *= og; yr *= og;
                const double ol = xl + (yl - xl) * w, orr = xr + (yr - xr) * w;
                outL[pos + i] = static_cast<T>(ol);
                outR[pos + i] = static_cast<T>(orr);
                if (bus) {
                    pin[0] = std::max(pin[0], static_cast<float>(std::fabs(xl))); pin[1] = std::max(pin[1], static_cast<float>(std::fabs(xr)));
                    pout[0] = std::max(pout[0], static_cast<float>(std::fabs(ol))); pout[1] = std::max(pout[1], static_cast<float>(std::fabs(orr)));
                }
            }
            // bandas silenciadas: estado a cero para reentrar limpias
            for (int bi = 0; bi < kBands; ++bi)
                if (mix1[static_cast<size_t>(bi)] <= 0.0) for (auto& ch : bands_[static_cast<size_t>(bi)].st) for (auto& st : ch) st.reset();
            pos += m;
        }
        if (bus) {
            if (tap) bus->salida(outL, outR, n);
            bus->inPk[0].update(pin[0]); bus->inPk[1].update(pin[1]);
            bus->outPk[0].update(pout[0]); bus->outPk[1].update(pout[1]);
            bus->analyzer.store(s_.analyzer, std::memory_order_relaxed);
        }
    }
    const EqSettings& settings() const { return s_; }

private:
    struct Band {
        int reqType{tPeak}, curType{tPeak}, reqSlope{0}, curSlope{0};
        bool on{true}, dirty{true};
        Smoother lf, g, lq, mix;
        BandCoefs coefs;
        std::array<std::array<BiquadState, kMaxSec>, 2> st{};
    };
    static double targetMix(const Band& b) { return b.on ? 1.0 : 0.0; }
    void design(Band& b) { designBand(b.curType, sr_, std::exp(b.lf.current()), b.g.current(), std::exp(b.lq.current()), b.curSlope, b.coefs); }

    double sr_{48000.0};
    EqSettings s_;
    std::array<Band, kBands> bands_;
    Smoother out_, wet_;
};

} // namespace JasWaveEq
