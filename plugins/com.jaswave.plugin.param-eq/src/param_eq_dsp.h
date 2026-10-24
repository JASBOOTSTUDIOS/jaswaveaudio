// =====================================================================================
//  JasWave EQ Parametric Pro – motor DSP (hasta 24 bandas dinámicas, fase mínima, latencia 0)
//   Tipos por banda: HPF, Low Shelf, Peak, High Shelf, LPF, Notch, Band Pass (RBJ cookbook)
//   HPF/LPF: 12 dB/oct (Q de la banda = resonancia) o 24/36/48 dB/oct Butterworth en cascada
//   Por banda: usada (alta/baja de la banda), pendiente propia, modo Stereo/Mid/Side/Left/Right y solo.
//   Medición por banda (señal real que entra y sale de cada banda, en su región de frecuencia).
//   Suavizado logarítmico de frecuencia y Q, lineal de ganancia; cambios de tipo/pendiente/modo
//   con fundido de la banda (sin clics).
//
//   Bandas dinámicas en VST3: la lista de parámetros es fija (así la automatizan Reaper & co.), por eso
//   hay un pool de kBands "slots" con IDs estables y "agregar/quitar banda" = marcar el slot como usado.
//   Compatibilidad: los IDs 0..43 y las 8 primeras bandas son idénticos a las versiones anteriores.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include <array>
#include <atomic>
#include <deque>
#include <string>

namespace JasWaveEq {

using namespace JasWaveDsp;
using namespace JasWaveVst;

constexpr int kBands = 24;          // slots de banda (antes 8)
constexpr int kLegacyBands = 8;     // bandas con IDs 1..40 (compatibles con "JasWave EQ" / JasWaveFx)
constexpr int kMaxSec = 4;
enum : uint32_t { kBypass = 0, kOutput = 41, kSlope = 42, kAnalyzer = 43 };
enum BandField : uint32_t { fType = 0, fFreq = 1, fGain = 2, fQ = 3, fOn = 4 };
// Parámetros extra por banda (todas las bandas): usada, pendiente propia, modo estéreo y solo
enum ExtField : uint32_t { eUsed = 0, eSlope = 1, eMode = 2, eSolo = 3 };
// Bandas 1..8: IDs heredados (1 + b*5 + campo). Bandas 9..24: bloque nuevo a partir de 400.
inline constexpr uint32_t bandParam(int band, BandField f) {
    return band < kLegacyBands ? 1u + static_cast<uint32_t>(band) * 5u + static_cast<uint32_t>(f)
                               : 400u + static_cast<uint32_t>(band - kLegacyBands) * 5u + static_cast<uint32_t>(f);
}
inline constexpr uint32_t extParam(int band, ExtField f) { return 100u + static_cast<uint32_t>(band) * 8u + static_cast<uint32_t>(f); }
enum BandType : int { tHpf = 0, tLowShelf = 1, tPeak = 2, tHighShelf = 3, tLpf = 4, tNotch = 5, tBandPass = 6 };
constexpr int kTypeCount = 7;
enum BandMode : int { mStereo = 0, mMid = 1, mSide = 2, mLeft = 3, mRight = 4 };
constexpr int kModeCount = 5;
enum Feature : int { kFeatAdvancedBands = 0, kFeatSteepSlopes = 1, kFeatAnalyzer = 2 };
constexpr int kFirstAdvancedBand = 4;   // bandas 5–24 requieren la feature "eq.bandas-avanzadas"

struct BandDefault { int type; double freq, q; bool on, used; };
inline BandDefault bandDefault(int b) {
    static const BandDefault d[kLegacyBands] = { { tHpf, 30.0, 0.71, false, true },     { tLowShelf, 100.0, 0.71, true, true }, { tPeak, 250.0, 1.0, true, true },
                                                 { tPeak, 1000.0, 1.0, true, true },    { tPeak, 3000.0, 1.0, true, true },     { tPeak, 6000.0, 1.0, true, true },
                                                 { tHighShelf, 10000.0, 0.71, true, true }, { tLpf, 18000.0, 0.71, false, true } };
    if (b < kLegacyBands) return d[b];
    // slots libres: peaks repartidos en escala logarítmica (120 Hz … 9 kHz), sin usar hasta que se agreguen
    const double t = static_cast<double>(b - kLegacyBands) / static_cast<double>(kBands - kLegacyBands - 1);
    return { tPeak, 120.0 * std::pow(9000.0 / 120.0, t), 1.0, true, false };
}

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static std::deque<std::string> names;
        auto nm = [&](const std::string& s) { names.push_back(s); return names.back().c_str(); };
        static const char* const kTypes[] = { "HPF", "Low Shelf", "Peak", "High Shelf", "LPF", "Notch", "Band Pass" };
        static const char* const kSlopes[] = { "12 dB/oct", "24 dB/oct", "36 dB/oct", "48 dB/oct" };
        static const char* const kBandSlopes[] = { "Global", "12 dB/oct", "24 dB/oct", "36 dB/oct", "48 dB/oct" };
        static const char* const kModes[] = { "Stereo", "Mid", "Side", "Left", "Right" };
        static const char* const kAnalyzerLabels[] = { "Off", "Post", "Pre+Post" };
        std::vector<ParamDef> v;
        auto baseBand = [&](int b) {
            const BandDefault bd = bandDefault(b);
            const std::string p = "Band " + std::to_string(b + 1) + " ";
            const int feat = b >= kFirstAdvancedBand ? kFeatAdvancedBands : -1;
            v.push_back(withFeature(stepP(bandParam(b, fType), nm(p + "Type"), kTypeCount - 1, bd.type, kTypes), feat));
            v.push_back(withFeature(logP(bandParam(b, fFreq), nm(p + "Freq"), "Hz", 20.0, 20000.0, bd.freq, 1), feat));
            v.push_back(withFeature(linearP(bandParam(b, fGain), nm(p + "Gain"), "dB", -24.0, 24.0, 0.0, 1, true), feat));
            v.push_back(withFeature(linearP(bandParam(b, fQ), nm(p + "Q"), "", 0.1, 18.0, bd.q, 2), feat));
            v.push_back(withFeature(toggleP(bandParam(b, fOn), nm(p + "On"), bd.on ? 1 : 0), feat));
        };
        // Orden estable: los 44 primeros parámetros conservan su posición (estados guardados v1 van por orden de tabla)
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        for (int b = 0; b < kLegacyBands; ++b) baseBand(b);
        v.push_back(linearP(kOutput, "Output", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(withFeature(stepP(kSlope, "HP/LP Slope", 3, 0, kSlopes), kFeatSteepSlopes));
        v.push_back(withFeature(stepP(kAnalyzer, "Analyzer", 2, 1, kAnalyzerLabels), kFeatAnalyzer));
        for (int b = 0; b < kBands; ++b) {
            const std::string p = "Band " + std::to_string(b + 1) + " ";
            const int feat = b >= kFirstAdvancedBand ? kFeatAdvancedBands : -1;
            v.push_back(withFeature(toggleP(extParam(b, eUsed), nm(p + "Used"), bandDefault(b).used ? 1 : 0), feat));
            v.push_back(withFeature(stepP(extParam(b, eSlope), nm(p + "Slope"), 4, 0, kBandSlopes), feat));
            v.push_back(withFeature(stepP(extParam(b, eMode), nm(p + "Mode"), kModeCount - 1, 0, kModes), feat));
            v.push_back(withFeature(toggleP(extParam(b, eSolo), nm(p + "Solo"), 0), feat));
        }
        for (int b = kLegacyBands; b < kBands; ++b) baseBand(b);
        return v;
    }();
    return defs;
}

struct BandSettings {
    int type{tPeak};
    double freq{1000.0}, gainDb{0.0}, q{1.0};
    bool on{true};
    bool used{true};     // el slot existe (agregar/quitar banda)
    int slope{0};        // 0 = global; 1..4 = 12..48 dB/oct propia
    int mode{mStereo};
    bool solo{false};
};
struct EqSettings {
    std::array<BandSettings, kBands> band;
    int slopeIdx{0};          // 0..3 -> 12..48 dB/oct
    double outGainDb{0.0};
    bool bypass{false};
    int analyzer{1};
    EqSettings() {
        for (int b = 0; b < kBands; ++b) { const auto d = bandDefault(b); band[b] = { d.type, d.freq, 0.0, d.q, d.on, d.used, 0, mStereo, false }; }
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
        case tBandPass: return FilterType::BandPass;
        default: return FilterType::Bell;
    }
}
// Pendiente efectiva de una banda: la suya si la fija, si no la global
inline int effectiveSlope(const BandSettings& b, int globalIdx) { return b.slope > 0 ? b.slope - 1 : globalIdx; }

// Coeficientes de una banda (misma matemática en audio y UI)
struct BandCoefs { std::array<BiquadCoefs, kMaxSec> c; int n{1}; };
inline void designBand(int type, double sr, double freq, double gainDb, double q, int slopeIdx, BandCoefs& out) {
    if (isCut(type)) {
        if (slopeIdx <= 0) { out.n = 1; out.c[0] = BiquadCoefs::design(rbjType(type), sr, freq, 0.0, q); return; }
        const int nsec = std::min(slopeIdx, 3) + 1, order = nsec * 2;
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

// Telemetría hacia el editor. Por banda: nivel (dB RMS) de la señal real que ENTRA y la que SALE de esa banda
// medido en su región de frecuencia (filtro pasa-banda centrado en la banda); salida − entrada = aporte real.
constexpr float kBandFloorDb = -120.0f;
struct EqBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    std::atomic<int> analyzer{1};
    std::array<std::atomic<float>, kBands> bandInDb, bandOutDb;
    EqBus() {
        for (auto& v : bandInDb) v.store(kBandFloorDb, std::memory_order_relaxed);
        for (auto& v : bandOutDb) v.store(kBandFloorDb, std::memory_order_relaxed);
    }
};

class EqEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        for (auto& b : bands_) { b.lf.prepare(sr_, 25.0); b.g.prepare(sr_, 25.0); b.lq.prepare(sr_, 25.0); b.mix.prepare(sr_, 6.0); }
        out_.prepare(sr_, 25.0);
        wet_.prepare(sr_, 10.0);
        solo_.prepare(sr_, 15.0);
        setSettings(s_);
        snap();
        reset();
    }
    void reset() {
        for (auto& b : bands_) {
            for (auto& ch : b.st) for (auto& s : ch) s.reset();
            for (auto& s : b.soloSt) s.reset();
            for (auto& s : b.mInSt) s.reset();
            for (auto& s : b.mOutSt) s.reset();
            b.envIn = b.envOut = 0.0;
        }
    }

    void setSettings(const EqSettings& s) {
        s_ = s;
        anySolo_ = false;
        for (int i = 0; i < kBands; ++i) {
            Band& b = bands_[static_cast<size_t>(i)];
            const BandSettings& bs = s.band[static_cast<size_t>(i)];
            b.reqType = bs.type;
            b.reqSlope = effectiveSlope(bs, s.slopeIdx);
            b.reqMode = bs.mode;
            b.on = bs.on;
            b.used = bs.used;
            b.solo = bs.solo && bs.used;
            anySolo_ = anySolo_ || b.solo;
            b.lf.setTarget(std::log(clampT(bs.freq, 10.0, 22000.0)));
            b.g.setTarget(bs.gainDb);
            b.lq.setTarget(std::log(clampT(bs.q, 0.05, 40.0)));
            b.mix.setTarget(targetMix(b));
            b.dirty = true;
        }
        out_.setTarget(dbToLinear(s.outGainDb));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        solo_.setTarget(anySolo_ ? 1.0 : 0.0);
    }
    void snap() {
        for (auto& b : bands_) {
            b.curType = b.reqType;
            b.curSlope = b.reqSlope;
            b.curMode = b.reqMode;
            b.lf.reset(b.lf.target()); b.g.reset(b.g.target()); b.lq.reset(b.lq.target());
            b.mix.reset(targetMix(b));
            design(b);
        }
        out_.reset(out_.target());
        wet_.reset(wet_.target());
        solo_.reset(solo_.target());
    }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, EqBus* bus) {
        // El analizador (0 apagado, 1 salida, 2 entrada+salida) solo decide qué dibuja el editor.
        const bool tap = bus && s_.analyzer > 0;
        if (tap && s_.analyzer >= 2) bus->entrada(inL, inR, n);
        // La medición por banda solo corre con el editor abierto (no cuesta nada en reproducción normal).
        const bool meter = bus && bus->vistaAbierta();
        float pin[2] = { 0, 0 }, pout[2] = { 0, 0 };
        std::array<double, kBands> accIn{}, accOut{};
        int pos = 0;
        while (pos < n) {
            const int m = std::min(32, n - pos);
            std::array<double, kBands> mix0{}, mix1{};
            for (int i = 0; i < kBands; ++i) {
                Band& b = bands_[static_cast<size_t>(i)];
                // cambio de tipo/pendiente/modo: fundido de salida, cambio, fundido de entrada
                if (b.reqType != b.curType || b.reqMode != b.curMode || (isCut(b.curType) && b.reqSlope != b.curSlope)) {
                    b.mix.setTarget(0.0);
                    if (b.mix.current() < 1.0e-3) {
                        b.curType = b.reqType;
                        b.curSlope = b.reqSlope;
                        b.curMode = b.reqMode;
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
            const double s0 = solo_.current(), s1 = solo_.advance(m);
            for (int i = 0; i < m; ++i) {
                const double t = static_cast<double>(i + 1) / m;
                const double xl = static_cast<double>(inL[pos + i]), xr = static_cast<double>(inR[pos + i]);
                double yl = xl, yr = xr;
                for (int bi = 0; bi < kBands; ++bi) {
                    Band& b = bands_[static_cast<size_t>(bi)];
                    const double mx = mix0[static_cast<size_t>(bi)] + (mix1[static_cast<size_t>(bi)] - mix0[static_cast<size_t>(bi)]) * t;
                    if (mx <= 0.0) continue;
                    double fl = yl, fr = yr;
                    switch (b.curMode) {
                        case mMid: {
                            const double mid = (yl + yr) * 0.5, side = (yl - yr) * 0.5;
                            const double fm = runChain(b, 0, mid);
                            fl = fm + side; fr = fm - side;
                            break;
                        }
                        case mSide: {
                            const double mid = (yl + yr) * 0.5, side = (yl - yr) * 0.5;
                            const double fs = runChain(b, 0, side);
                            fl = mid + fs; fr = mid - fs;
                            break;
                        }
                        case mLeft: fl = runChain(b, 0, yl); break;
                        case mRight: fr = runChain(b, 1, yr); break;
                        default: fl = runChain(b, 0, yl); fr = runChain(b, 1, yr); break;
                    }
                    const double nl = yl + (fl - yl) * mx, nr = yr + (fr - yr) * mx;
                    if (meter) {
                        const double mi = (yl + yr) * 0.5, mo = (nl + nr) * 0.5;
                        const double bi2 = biquadProcess(b.meterCoefs, b.mInSt[0], mi), bo2 = biquadProcess(b.meterCoefs, b.mOutSt[0], mo);
                        accIn[static_cast<size_t>(bi)] += bi2 * bi2;
                        accOut[static_cast<size_t>(bi)] += bo2 * bo2;
                    }
                    yl = nl; yr = nr;
                }
                const double og = o0 + (o1 - o0) * t, w = w0 + (w1 - w0) * t, sm = s0 + (s1 - s0) * t;
                yl *= og; yr *= og;
                if (sm > 0.0) {
                    // Solo: se escucha solo la región de las bandas en solo (pasa-banda sobre la entrada)
                    double sl = 0.0, sr2 = 0.0;
                    for (int bi = 0; bi < kBands; ++bi) {
                        Band& b = bands_[static_cast<size_t>(bi)];
                        if (!b.solo) continue;
                        sl += biquadProcess(b.soloCoefs, b.soloSt[0], xl);
                        sr2 += biquadProcess(b.soloCoefs, b.soloSt[1], xr);
                    }
                    yl += (sl - yl) * sm;
                    yr += (sr2 - yr) * sm;
                }
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
                if (mix1[static_cast<size_t>(bi)] <= 0.0) {
                    Band& b = bands_[static_cast<size_t>(bi)];
                    for (auto& ch : b.st) for (auto& st : ch) st.reset();
                    if (!b.solo) for (auto& st : b.soloSt) st.reset();
                }
            pos += m;
        }
        if (bus) {
            if (tap) bus->salida(outL, outR, n);
            bus->inPk[0].update(pin[0]); bus->inPk[1].update(pin[1]);
            bus->outPk[0].update(pout[0]); bus->outPk[1].update(pout[1]);
            bus->analyzer.store(s_.analyzer, std::memory_order_relaxed);
            if (meter) publishBands(*bus, accIn, accOut, n);
        }
    }
    const EqSettings& settings() const { return s_; }
    /** Respuesta total en dB a la frecuencia f con los ajustes ACTUALES (bandas usadas y activas + salida). */
    double responseDb(double f) const {
        double db = s_.outGainDb;
        for (int i = 0; i < kBands; ++i) {
            const BandSettings& bs = s_.band[static_cast<size_t>(i)];
            if (!bs.used || !bs.on || s_.bypass) continue;
            BandCoefs bc;
            designBand(bs.type, sr_, bs.freq, bs.gainDb, bs.q, effectiveSlope(bs, s_.slopeIdx), bc);
            db += bandResponseDb(bc, sr_, f);
        }
        return db;
    }

private:
    struct Band {
        int reqType{tPeak}, curType{tPeak}, reqSlope{0}, curSlope{0}, reqMode{mStereo}, curMode{mStereo};
        bool on{true}, used{true}, solo{false}, dirty{true};
        Smoother lf, g, lq, mix;
        BandCoefs coefs;
        BiquadCoefs soloCoefs, meterCoefs;
        std::array<std::array<BiquadState, kMaxSec>, 2> st{};
        std::array<BiquadState, 2> soloSt{};
        std::array<BiquadState, 1> mInSt{}, mOutSt{};
        double envIn{0.0}, envOut{0.0};   // potencia suavizada (decaimiento ~250 ms)
    };
    static double targetMix(const Band& b) { return (b.on && b.used) ? 1.0 : 0.0; }
    static double runChain(Band& b, int ch, double x) {
        for (int k = 0; k < b.coefs.n; ++k) x = biquadProcess(b.coefs.c[static_cast<size_t>(k)], b.st[static_cast<size_t>(ch)][static_cast<size_t>(k)], x);
        return x;
    }
    void design(Band& b) {
        const double f = std::exp(b.lf.current()), q = std::exp(b.lq.current());
        designBand(b.curType, sr_, f, b.g.current(), q, b.curSlope, b.coefs);
        // pasa-banda de medición/solo centrado en la banda; Q acotado para que la región sea útil
        b.meterCoefs = BiquadCoefs::design(FilterType::BandPass, sr_, f, 0.0, clampT(q, 0.5, 6.0));
        b.soloCoefs = b.meterCoefs;
    }
    void publishBands(EqBus& bus, const std::array<double, kBands>& accIn, const std::array<double, kBands>& accOut, int n) {
        const double decay = std::exp(-static_cast<double>(n) / (sr_ * 0.25));
        for (int i = 0; i < kBands; ++i) {
            Band& b = bands_[static_cast<size_t>(i)];
            if (!b.used || !b.on) {
                bus.bandInDb[static_cast<size_t>(i)].store(kBandFloorDb, std::memory_order_relaxed);
                bus.bandOutDb[static_cast<size_t>(i)].store(kBandFloorDb, std::memory_order_relaxed);
                b.envIn = b.envOut = 0.0;
                continue;
            }
            const double pi = accIn[static_cast<size_t>(i)] / n, po = accOut[static_cast<size_t>(i)] / n;
            b.envIn = std::max(pi, b.envIn * decay);
            b.envOut = std::max(po, b.envOut * decay);
            auto toDb = [](double p) { return static_cast<float>(std::max<double>(kBandFloorDb, 10.0 * std::log10(p + 1.0e-12))); };
            bus.bandInDb[static_cast<size_t>(i)].store(toDb(b.envIn), std::memory_order_relaxed);
            bus.bandOutDb[static_cast<size_t>(i)].store(toDb(b.envOut), std::memory_order_relaxed);
        }
    }

    double sr_{48000.0};
    EqSettings s_;
    bool anySolo_{false};
    std::array<Band, kBands> bands_;
    Smoother out_, wet_, solo_;
};

} // namespace JasWaveEq
