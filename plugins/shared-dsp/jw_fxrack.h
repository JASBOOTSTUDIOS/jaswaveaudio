// =====================================================================================
//  JasWave FX Rack – rack de mezcla comun e integrado para los instrumentos propios (C++17, header-only)
//
//  Cadena fija, con bypass por bloque (sin clics: fundido de ~15 ms):
//    A) paso-altos + paso-bajos (12/24 dB/oct)  B) ecualizador parametrico de 6 bandas
//    C) compresor  D) saturacion (cinta / valvula)  E) chorus / ensemble  F) delay estereo (sync al tempo)
//    G) reverb (plate / hall / room)  H) anchura estereo + ganancia de salida
//
//  - Todo desactivado por defecto: con TODOS los bloques apagados process() retorna sin tocar el buffer
//    (salida identica bit a bit a la del plugin sin rack).
//  - Sin latencia (latency() = 0): la saturacion usa ADAA de 1.er orden (sin sobremuestreo ni FIR).
//  - Sin asignaciones en el hilo de audio: toda la memoria se reserva en prepare().
//  - float y double (se procesa en double por sub-bloques de 64 muestras; los parametros se suavizan por sub-bloque).
//  - ids ESTANDAR: FXR_BASE (100) + offset fijo (ver enum Off). La IA y el host tratan igual a todos los plugins.
//
//  Integracion (ver docs/plans/F4-fxrack-integracion.md):
//    paramDefs():   JasWaveFx::registrarParametros(v);                      // al final de la lista
//    motor:         JasWaveFx::FxRack fx_;  prepare(sr) / reset() / setParams(p) / process(L, R, n, bus)
//    updateParams:  fxp.leer([this](uint32_t id) { return plainOf(id); });  engine.setFx(fxp);
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <deque>
#include <string>
#include <vector>

#ifndef FXR_BASE
#define FXR_BASE 100
#endif

namespace JasWaveFx {

constexpr uint32_t kBase = FXR_BASE;
constexpr int kBands = 6;
constexpr int kSub = 64;   // sub-bloque de control (muestras)

// ---- ids: offsets fijos respecto a la base (cada bloque empieza en un multiplo de 16) ----
enum Off : uint32_t {
    // A) filtros
    HpfOn = 0, HpfFreq = 1, HpfSlope = 2, LpfOn = 3, LpfFreq = 4, LpfSlope = 5,
    // B) ecualizador: EqBand0 + 3*banda + {0 Freq, 1 Gain, 2 Q}  (banda 0..5)
    EqOn = 16, EqBand0 = 17,
    // C) compresor
    CompOn = 48, CompThresh = 49, CompRatio = 50, CompAttack = 51, CompRelease = 52, CompKnee = 53, CompMakeup = 54, CompMix = 55,
    // D) saturacion
    SatOn = 64, SatType = 65, SatDrive = 66, SatTone = 67, SatMix = 68,
    // E) chorus / ensemble
    ChOn = 80, ChDepth = 81, ChRate = 82, ChMix = 83,
    // F) delay
    DlOn = 96, DlSync = 97, DlTime = 98, DlFeedback = 99, DlTone = 100, DlMix = 101, DlPingPong = 102,
    // G) reverb
    RvOn = 112, RvType = 113, RvSize = 114, RvDamping = 115, RvPreDelay = 116, RvMix = 117,
    // H) anchura y salida
    OutOn = 128, OutWidth = 129, OutGain = 130,
    kRango = 144   // el rack ocupa [base, base + kRango)
};
constexpr uint32_t eqFreq(int b) { return EqBand0 + 3u * static_cast<uint32_t>(b); }
constexpr uint32_t eqGain(int b) { return EqBand0 + 3u * static_cast<uint32_t>(b) + 1u; }
constexpr uint32_t eqQ(int b) { return EqBand0 + 3u * static_cast<uint32_t>(b) + 2u; }
constexpr uint32_t kUltimoOffset = OutGain;

inline const char* const* labelsSlope() { static const char* const l[] = { "12 dB/oct", "24 dB/oct" }; return l; }
inline const char* const* labelsSatType() { static const char* const l[] = { "Tape", "Tube" }; return l; }
inline const char* const* labelsSync() { static const char* const l[] = { "Free", "1/4", "1/8", "1/8.", "1/16" }; return l; }
inline const char* const* labelsReverb() { static const char* const l[] = { "Plate", "Hall", "Room" }; return l; }

// ---- valores planos ----
struct EqBand { double hz{1000.0}, gainDb{0.0}, q{1.0}; };

struct FxParams {
    bool hpfOn{false}; double hpfHz{80.0}; int hpfSlope{0};
    bool lpfOn{false}; double lpfHz{16000.0}; int lpfSlope{0};
    bool eqOn{false}; EqBand eq[kBands];
    bool compOn{false}; double compThreshDb{-18.0}, compRatio{3.0}, compAttackMs{10.0}, compReleaseMs{120.0}, compKneeDb{6.0}, compMakeupDb{0.0}, compMix{1.0};
    bool satOn{false}; int satType{0}; double satDrive{0.3}, satToneHz{12000.0}, satMix{1.0};
    bool chOn{false}; double chDepth{0.4}, chRateHz{0.6}, chMix{0.35};
    bool dlOn{false}; int dlSync{0}; double dlTimeMs{350.0}, dlFeedback{0.35}, dlToneHz{5000.0}, dlMix{0.25}; bool dlPingPong{false};
    bool rvOn{false}; int rvType{1}; double rvSize{0.5}, rvDamping{0.5}, rvPreDelayMs{20.0}, rvMix{0.2};
    bool outOn{false}; double outWidth{1.0}, outGainDb{0.0};

    // Lee todos los valores desde `g(id) -> valor plano` (p. ej. [this](uint32_t id){ return plainOf(id); }).
    template <class G>
    void leer(G&& g, uint32_t base = kBase) {
        auto V = [&](uint32_t o) { return static_cast<double>(g(base + o)); };
        auto B = [&](uint32_t o) { return V(o) >= 0.5; };
        auto I = [&](uint32_t o) { return static_cast<int>(std::lround(V(o))); };
        hpfOn = B(HpfOn); hpfHz = V(HpfFreq); hpfSlope = I(HpfSlope);
        lpfOn = B(LpfOn); lpfHz = V(LpfFreq); lpfSlope = I(LpfSlope);
        eqOn = B(EqOn);
        for (int b = 0; b < kBands; ++b) { eq[b].hz = V(eqFreq(b)); eq[b].gainDb = V(eqGain(b)); eq[b].q = V(eqQ(b)); }
        compOn = B(CompOn); compThreshDb = V(CompThresh); compRatio = V(CompRatio); compAttackMs = V(CompAttack); compReleaseMs = V(CompRelease);
        compKneeDb = V(CompKnee); compMakeupDb = V(CompMakeup); compMix = V(CompMix) * 0.01;
        satOn = B(SatOn); satType = I(SatType); satDrive = V(SatDrive) * 0.01; satToneHz = V(SatTone); satMix = V(SatMix) * 0.01;
        chOn = B(ChOn); chDepth = V(ChDepth) * 0.01; chRateHz = V(ChRate); chMix = V(ChMix) * 0.01;
        dlOn = B(DlOn); dlSync = I(DlSync); dlTimeMs = V(DlTime); dlFeedback = V(DlFeedback) * 0.01; dlToneHz = V(DlTone); dlMix = V(DlMix) * 0.01;
        dlPingPong = B(DlPingPong);
        rvOn = B(RvOn); rvType = I(RvType); rvSize = V(RvSize) * 0.01; rvDamping = V(RvDamping) * 0.01; rvPreDelayMs = V(RvPreDelay); rvMix = V(RvMix) * 0.01;
        outOn = B(OutOn); outWidth = V(OutWidth) * 0.01; outGainDb = V(OutGain);
    }
    bool algunoActivo() const { return hpfOn || lpfOn || eqOn || compOn || satOn || chOn || dlOn || rvOn || outOn; }
};

// ---- tabla de parametros (fuente unica de ids, nombres, rangos y valores por defecto) ----
namespace detail {

inline std::deque<std::string>& nombres() { static std::deque<std::string> n; return n; }
inline const char* guardar(const std::string& s) { nombres().push_back(s); return nombres().back().c_str(); }

}  // namespace detail

// Crea la lista de ParamDef del rack para una base dada (los nombres viven toda la vida del modulo).
inline std::vector<JasWaveVst::ParamDef> crearDefs(uint32_t base = kBase) {
    using namespace JasWaveVst;
    std::vector<ParamDef> v;
    v.reserve(64);
    auto N = [](const char* s) { return detail::guardar(std::string("FX \xC2\xB7 ") + s); };   // "FX · ..."
    const uint32_t b = base;
    // A) filtros
    v.push_back(toggleP(b + HpfOn, N("HPF On"), 0));
    v.push_back(logP(b + HpfFreq, N("HPF Freq"), "Hz", 20.0, 1000.0, 80.0, 0));
    v.push_back(stepP(b + HpfSlope, N("HPF Slope"), 1, 0, labelsSlope()));
    v.push_back(toggleP(b + LpfOn, N("LPF On"), 0));
    v.push_back(logP(b + LpfFreq, N("LPF Freq"), "Hz", 1000.0, 20000.0, 16000.0, 0));
    v.push_back(stepP(b + LpfSlope, N("LPF Slope"), 1, 0, labelsSlope()));
    // B) ecualizador de 6 bandas: low shelf, 4 campanas, high shelf
    v.push_back(toggleP(b + EqOn, N("EQ On"), 0));
    static const double fDef[kBands] = { 80.0, 200.0, 800.0, 2500.0, 6000.0, 10000.0 };
    static const double fMin[kBands] = { 20.0, 20.0, 20.0, 20.0, 20.0, 1000.0 };
    static const double fMax[kBands] = { 1000.0, 20000.0, 20000.0, 20000.0, 20000.0, 20000.0 };
    for (int k = 0; k < kBands; ++k) {
        const bool shelf = k == 0 || k == kBands - 1;
        const std::string pre = "EQ Band " + std::to_string(k + 1) + " ";
        v.push_back(logP(b + eqFreq(k), detail::guardar("FX \xC2\xB7 " + pre + "Freq"), "Hz", fMin[k], fMax[k], fDef[k], 0));
        v.push_back(linearP(b + eqGain(k), detail::guardar("FX \xC2\xB7 " + pre + "Gain"), "dB", -18.0, 18.0, 0.0, 1, true));
        v.push_back(shelf ? logP(b + eqQ(k), detail::guardar("FX \xC2\xB7 " + pre + "Q"), "", 0.3, 2.0, 0.71, 2)
                          : logP(b + eqQ(k), detail::guardar("FX \xC2\xB7 " + pre + "Q"), "", 0.1, 10.0, 1.0, 2));
    }
    // C) compresor
    v.push_back(toggleP(b + CompOn, N("Comp On"), 0));
    v.push_back(linearP(b + CompThresh, N("Comp Threshold"), "dB", -60.0, 0.0, -18.0, 1));
    v.push_back(logP(b + CompRatio, N("Comp Ratio"), ":1", 1.0, 20.0, 3.0, 1));
    v.push_back(logP(b + CompAttack, N("Comp Attack"), "ms", 0.1, 200.0, 10.0, 1));
    v.push_back(logP(b + CompRelease, N("Comp Release"), "ms", 10.0, 2000.0, 120.0, 0));
    v.push_back(linearP(b + CompKnee, N("Comp Knee"), "dB", 0.0, 24.0, 6.0, 1));
    v.push_back(linearP(b + CompMakeup, N("Comp Makeup"), "dB", 0.0, 24.0, 0.0, 1));
    v.push_back(linearP(b + CompMix, N("Comp Mix"), "%", 0.0, 100.0, 100.0, 0));
    // D) saturacion
    v.push_back(toggleP(b + SatOn, N("Sat On"), 0));
    v.push_back(stepP(b + SatType, N("Sat Type"), 1, 0, labelsSatType()));
    v.push_back(linearP(b + SatDrive, N("Sat Drive"), "%", 0.0, 100.0, 30.0, 0));
    v.push_back(logP(b + SatTone, N("Sat Tone"), "Hz", 1000.0, 20000.0, 12000.0, 0));
    v.push_back(linearP(b + SatMix, N("Sat Mix"), "%", 0.0, 100.0, 100.0, 0));
    // E) chorus / ensemble
    v.push_back(toggleP(b + ChOn, N("Chorus On"), 0));
    v.push_back(linearP(b + ChDepth, N("Chorus Depth"), "%", 0.0, 100.0, 40.0, 0));
    v.push_back(logP(b + ChRate, N("Chorus Rate"), "Hz", 0.05, 5.0, 0.6, 2));
    v.push_back(linearP(b + ChMix, N("Chorus Mix"), "%", 0.0, 100.0, 35.0, 0));
    // F) delay
    v.push_back(toggleP(b + DlOn, N("Delay On"), 0));
    v.push_back(stepP(b + DlSync, N("Delay Sync"), 4, 0, labelsSync()));
    v.push_back(logP(b + DlTime, N("Delay Time"), "ms", 20.0, 2000.0, 350.0, 0));
    v.push_back(linearP(b + DlFeedback, N("Delay Feedback"), "%", 0.0, 90.0, 35.0, 0));
    v.push_back(logP(b + DlTone, N("Delay Tone"), "Hz", 500.0, 16000.0, 5000.0, 0));
    v.push_back(linearP(b + DlMix, N("Delay Mix"), "%", 0.0, 100.0, 25.0, 0));
    v.push_back(toggleP(b + DlPingPong, N("Delay Ping-Pong"), 0));
    // G) reverb
    v.push_back(toggleP(b + RvOn, N("Reverb On"), 0));
    v.push_back(stepP(b + RvType, N("Reverb Type"), 2, 1, labelsReverb()));
    v.push_back(linearP(b + RvSize, N("Reverb Size"), "%", 0.0, 100.0, 50.0, 0));
    v.push_back(linearP(b + RvDamping, N("Reverb Damping"), "%", 0.0, 100.0, 50.0, 0));
    v.push_back(linearP(b + RvPreDelay, N("Reverb Pre-Delay"), "ms", 0.0, 200.0, 20.0, 0));
    v.push_back(linearP(b + RvMix, N("Reverb Mix"), "%", 0.0, 100.0, 20.0, 0));
    // H) anchura y salida
    v.push_back(toggleP(b + OutOn, N("Out On"), 0));
    v.push_back(linearP(b + OutWidth, N("Out Width"), "%", 0.0, 200.0, 100.0, 0));
    v.push_back(linearP(b + OutGain, N("Out Gain"), "dB", -24.0, 12.0, 0.0, 1, true));
    return v;
}

// Cache de la lista estandar (base = FXR_BASE): unica por modulo
inline const std::vector<JasWaveVst::ParamDef>& definiciones() {
    static const std::vector<JasWaveVst::ParamDef> d = crearDefs(kBase);
    return d;
}
// Registra los parametros del rack AL FINAL de la lista de un plugin
inline void registrarParametros(std::vector<JasWaveVst::ParamDef>& v) {
    const auto& d = definiciones();
    v.insert(v.end(), d.begin(), d.end());
}
#define JW_FXRACK_REGISTRAR(v) ::JasWaveFx::registrarParametros(v)

// Valores por defecto (neutros: todo apagado)
inline FxParams porDefecto() {
    FxParams p;
    const auto& d = definiciones();
    p.leer([&](uint32_t id) { for (const auto& x : d) if (x.id == id) return x.defV; return 0.0; });
    return p;
}

// ---- respuesta analitica del ecualizador / filtros (para la UI y las pruebas) ----
inline JasWaveDsp::BiquadCoefs eqCoefs(int banda, const EqBand& e, double sr) {
    using JasWaveDsp::FilterType;
    const FilterType t = banda == 0 ? FilterType::LowShelf : (banda == kBands - 1 ? FilterType::HighShelf : FilterType::Bell);
    return JasWaveDsp::BiquadCoefs::design(t, sr, e.hz, e.gainDb, e.q);
}
// Respuesta (dB) a la frecuencia f: bandas del EQ (si incluirEq) y filtros paso-altos/bajos activos
inline double respuestaDb(const FxParams& p, double sr, double f, bool incluirEq = true, bool incluirFiltros = true) {
    using JasWaveDsp::BiquadCoefs;
    using JasWaveDsp::FilterType;
    double db = 0.0;
    if (incluirEq) for (int b = 0; b < kBands; ++b) if (std::fabs(p.eq[b].gainDb) > 1.0e-3) db += eqCoefs(b, p.eq[b], sr).magnitudeDb(f, sr);
    if (incluirFiltros) {
        if (p.hpfOn) {
            if (p.hpfSlope) { db += BiquadCoefs::design(FilterType::HighPass, sr, p.hpfHz, 0, JasWaveDsp::butterworthQ(4, 0)).magnitudeDb(f, sr);
                              db += BiquadCoefs::design(FilterType::HighPass, sr, p.hpfHz, 0, JasWaveDsp::butterworthQ(4, 1)).magnitudeDb(f, sr); }
            else db += BiquadCoefs::design(FilterType::HighPass, sr, p.hpfHz, 0, 0.70710678).magnitudeDb(f, sr);
        }
        if (p.lpfOn) {
            if (p.lpfSlope) { db += BiquadCoefs::design(FilterType::LowPass, sr, p.lpfHz, 0, JasWaveDsp::butterworthQ(4, 0)).magnitudeDb(f, sr);
                              db += BiquadCoefs::design(FilterType::LowPass, sr, p.lpfHz, 0, JasWaveDsp::butterworthQ(4, 1)).magnitudeDb(f, sr); }
            else db += BiquadCoefs::design(FilterType::LowPass, sr, p.lpfHz, 0, 0.70710678).magnitudeDb(f, sr);
        }
    }
    return db;
}

// =====================================================================================
//  Bloques DSP (internos)
// =====================================================================================
namespace detail {

using JasWaveDsp::BiquadCoefs;
using JasWaveDsp::BiquadState;
using JasWaveDsp::Smoother;
using JasWaveDsp::FilterType;
using JasWaveDsp::biquadProcess;

constexpr double kTwoPi = 6.283185307179586476925286766559;
inline double lg2(double x) { return std::log2(std::max(x, 1.0e-9)); }
inline double lnCosh(double z) { z = std::fabs(z); return z > 20.0 ? z - 0.69314718055994531 : z + std::log1p(std::exp(-2.0 * z)) - 0.69314718055994531; }

// log2 / exp2 rapidos (error < 1e-4 dB): detector y ganancia del compresor sin llamadas a libm por muestra
inline double fastLog2(double x) {
    union { double d; uint64_t u; } v;
    v.d = x;
    const int e = static_cast<int>((v.u >> 52) & 0x7FF) - 1023;
    v.u = (v.u & 0x000FFFFFFFFFFFFFull) | 0x3FF0000000000000ull;
    const double t = (v.d - 1.0) / (v.d + 1.0), t2 = t * t;
    return e + t * (2.8853900817779268 + t2 * (0.9617966939259756 + t2 * (0.5770780163555854 + t2 * 0.41219858311113243)));
}
inline double fastExp2(double x) {   // x en [-60, 60]
    if (x < -60.0) x = -60.0; else if (x > 60.0) x = 60.0;
    const double fl = std::floor(x), f = x - fl;
    const double p = 1.0 + f * (0.6931471805599453 + f * (0.2402265069591007 + f * (0.0555041086648216 + f * (0.0096181291076285 + f * (0.0013333558146428 + f * 0.00015403530461308)))));
    union { double d; uint64_t u; } v;
    v.u = static_cast<uint64_t>(static_cast<int64_t>(fl) + 1023) << 52;
    return p * v.d;
}

inline size_t pow2Min(size_t n) { size_t p = 1; while (p < n) p <<= 1; return p; }

// Lectura fraccionaria Hermite de 4 puntos de un anillo (d en muestras, d >= 1)
inline double leerHermite(const std::vector<double>& b, size_t mask, size_t w, double d) {
    const double pos = static_cast<double>(w) - d;
    const double fl = std::floor(pos);
    const double f = pos - fl;
    const size_t i1 = static_cast<size_t>(static_cast<int64_t>(fl)) & mask;
    const double y0 = b[(i1 - 1) & mask], y1 = b[i1], y2 = b[(i1 + 1) & mask], y3 = b[(i1 + 2) & mask];
    const double c0 = y1, c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + c0;
}
inline double leerLineal(const std::vector<double>& b, size_t mask, size_t w, double d) {
    const double pos = static_cast<double>(w) - d;
    const double fl = std::floor(pos);
    const double f = pos - fl;
    const size_t i1 = static_cast<size_t>(static_cast<int64_t>(fl)) & mask;
    return b[i1] + f * (b[(i1 + 1) & mask] - b[i1]);
}

// Interruptor con fundido (0..1): el bloque solo corre mientras esta vivo
struct Gate {
    Smoother s;
    bool cleared{true};
    void prepare(double sr) { s.prepare(sr, 3.0); s.reset(0.0); cleared = true; }
    void set(bool on, bool snap) { s.setTarget(on ? 1.0 : 0.0); if (snap) s.reset(on ? 1.0 : 0.0); }
    bool live() const { return s.current() > 0.0 || s.target() > 0.0; }
};

// ---- A) paso-altos / paso-bajos Butterworth 12/24 dB/oct ----
struct FilterBlock {
    double sr{48000.0};
    bool hp{true};
    Smoother f;
    int slope{0};
    double lastF{-1.0};
    BiquadCoefs c[2];
    BiquadState st[2][2];   // [canal][etapa]
    void prepare(double sr_, bool esHp) { sr = sr_; hp = esHp; f.prepare(sr, 25.0); f.reset(lg2(hp ? 80.0 : 16000.0)); lastF = -1.0; slope = 0; clear(); }
    void clear() { for (auto& a : st) for (auto& s : a) s.reset(); lastF = -1.0; }
    void setP(double hz, int sl, bool snap) {
        const double v = lg2(std::min(std::max(hz, 10.0), sr * 0.45));
        f.setTarget(v);
        if (snap) { f.reset(v); lastF = -1.0; }
        sl = sl ? 1 : 0;
        if (sl != slope) { slope = sl; st[0][1].reset(); st[1][1].reset(); lastF = -1.0; }
    }
    void run(double* l, double* r, int m) {
        const double v = f.advance(m);
        if (v != lastF) {
            lastF = v;
            const double fh = std::exp2(v);
            const FilterType t = hp ? FilterType::HighPass : FilterType::LowPass;
            if (slope) { c[0] = BiquadCoefs::design(t, sr, fh, 0.0, JasWaveDsp::butterworthQ(4, 0)); c[1] = BiquadCoefs::design(t, sr, fh, 0.0, JasWaveDsp::butterworthQ(4, 1)); }
            else c[0] = BiquadCoefs::design(t, sr, fh, 0.0, 0.70710678118654752);
        }
        for (int i = 0; i < m; ++i) {
            double a = biquadProcess(c[0], st[0][0], l[i]);
            double b = biquadProcess(c[0], st[1][0], r[i]);
            if (slope) { a = biquadProcess(c[1], st[0][1], a); b = biquadProcess(c[1], st[1][1], b); }
            l[i] = a; r[i] = b;
        }
    }
};

// ---- B) ecualizador parametrico de 6 bandas ----
struct EqBlock {
    double sr{48000.0};
    Smoother fr[kBands], ga[kBands], qq[kBands];
    BiquadCoefs c[kBands];
    BiquadState st[kBands][2];
    double lf[kBands], lg[kBands], lq[kBands];
    bool act[kBands];
    void prepare(double sr_) {
        sr = sr_;
        for (int b = 0; b < kBands; ++b) { fr[b].prepare(sr, 25.0); ga[b].prepare(sr, 25.0); qq[b].prepare(sr, 25.0); fr[b].reset(lg2(1000.0)); ga[b].reset(0.0); qq[b].reset(0.0); }
        clear();
    }
    void clear() { for (int b = 0; b < kBands; ++b) { st[b][0].reset(); st[b][1].reset(); lf[b] = lg[b] = lq[b] = 1.0e300; act[b] = false; } }
    void setP(const EqBand* e, bool snap) {
        for (int b = 0; b < kBands; ++b) {
            const double f = lg2(std::min(std::max(e[b].hz, 10.0), sr * 0.45)), g = std::min(std::max(e[b].gainDb, -30.0), 30.0), q = lg2(std::min(std::max(e[b].q, 0.1), 20.0));
            fr[b].setTarget(f); ga[b].setTarget(g); qq[b].setTarget(q);
            if (snap) { fr[b].reset(f); ga[b].reset(g); qq[b].reset(q); lf[b] = lg[b] = lq[b] = 1.0e300; }
        }
    }
    void run(double* l, double* r, int m) {
        for (int b = 0; b < kBands; ++b) {
            const double f = fr[b].advance(m), g = ga[b].advance(m), q = qq[b].advance(m);
            const bool activo = std::fabs(g) > 1.0e-3 || std::fabs(ga[b].target()) > 1.0e-3;
            if (!activo) { st[b][0].reset(); st[b][1].reset(); lf[b] = 1.0e300; continue; }
            if (f != lf[b] || g != lg[b] || q != lq[b]) {
                lf[b] = f; lg[b] = g; lq[b] = q;
                EqBand e; e.hz = std::exp2(f); e.gainDb = g; e.q = std::exp2(q);
                c[b] = eqCoefs(b, e, sr);
            }
            const BiquadCoefs& k = c[b];
            BiquadState& sl = st[b][0];
            BiquadState& sr_ = st[b][1];
            for (int i = 0; i < m; ++i) { l[i] = biquadProcess(k, sl, l[i]); r[i] = biquadProcess(k, sr_, r[i]); }
        }
    }
};

// ---- C) compresor (detector de pico enlazado, rodilla suave, balistica en dB) ----
struct CompBlock {
    double sr{48000.0};
    Smoother thr, ratio, knee, makeup, mix, atk, rel;
    double gr{0.0};          // reduccion actual (dB, >= 0)
    double grMax{0.0};       // maximo desde la ultima lectura
    void prepare(double sr_) {
        sr = sr_;
        thr.prepare(sr, 20.0); ratio.prepare(sr, 20.0); knee.prepare(sr, 20.0); makeup.prepare(sr, 20.0); mix.prepare(sr, 20.0); atk.prepare(sr, 20.0); rel.prepare(sr, 20.0);
        thr.reset(-18.0); ratio.reset(3.0); knee.reset(6.0); makeup.reset(0.0); mix.reset(1.0); atk.reset(lg2(10.0)); rel.reset(lg2(120.0));
        clear();
    }
    void clear() { gr = 0.0; grMax = 0.0; }
    void setP(const FxParams& p, bool snap) {
        thr.setTarget(p.compThreshDb); ratio.setTarget(std::max(1.0, p.compRatio)); knee.setTarget(std::max(0.0, p.compKneeDb)); makeup.setTarget(p.compMakeupDb);
        mix.setTarget(std::min(1.0, std::max(0.0, p.compMix))); atk.setTarget(lg2(p.compAttackMs)); rel.setTarget(lg2(p.compReleaseMs));
        if (snap) { thr.reset(thr.target()); ratio.reset(ratio.target()); knee.reset(knee.target()); makeup.reset(makeup.target()); mix.reset(mix.target()); atk.reset(atk.target()); rel.reset(rel.target()); }
    }
    void run(double* l, double* r, int m) {
        const double T = thr.advance(m), R = ratio.advance(m), K = knee.advance(m), MU = makeup.advance(m), MX = mix.advance(m);
        const double aA = std::exp(-1.0 / (std::exp2(atk.advance(m)) * 0.001 * sr)), aR = std::exp(-1.0 / (std::exp2(rel.advance(m)) * 0.001 * sr));
        const double mk = std::pow(10.0, MU / 20.0), slope = 1.0 / R - 1.0;
        double g = gr;
        for (int i = 0; i < m; ++i) {
            const double lin = std::max(std::fabs(l[i]), std::fabs(r[i]));
            const double db = 6.020599913279624 * fastLog2(std::max(lin, 1.0e-9));
            const double over = db - T;
            double target;   // reduccion deseada (dB)
            if (K > 0.01) {
                if (2.0 * over < -K) target = 0.0;
                else if (2.0 * std::fabs(over) <= K) { const double x = over + K * 0.5; target = -slope * x * x / (2.0 * K); }
                else target = -slope * over;
            } else target = over > 0.0 ? -slope * over : 0.0;
            const double a = target > g ? aA : aR;
            g = a * g + (1.0 - a) * target;
            const double gain = fastExp2(-g * 0.16609640474436813) * mk;
            l[i] = l[i] * (1.0 - MX) + l[i] * gain * MX;
            r[i] = r[i] * (1.0 - MX) + r[i] * gain * MX;
            if (g > grMax) grMax = g;
        }
        gr = g;
    }
};

// ---- D) saturacion (cinta simetrica / valvula asimetrica) con ADAA de 1.er orden ----
struct SatBlock {
    double sr{48000.0};
    int type{0};
    Smoother drive, tone, mix;
    double xp[2]{0.0, 0.0}, lp[2]{0.0, 0.0}, dcx[2]{0.0, 0.0}, dcy[2]{0.0, 0.0};   // xp: entrada anterior (ADAA)
    void prepare(double sr_) { sr = sr_; drive.prepare(sr, 30.0); tone.prepare(sr, 30.0); mix.prepare(sr, 20.0); drive.reset(0.3); tone.reset(lg2(12000.0)); mix.reset(1.0); clear(); }
    void clear() { for (int c = 0; c < 2; ++c) xp[c] = lp[c] = dcx[c] = dcy[c] = 0.0; }
    void setP(const FxParams& p, bool snap) {
        type = p.satType ? 1 : 0;
        drive.setTarget(std::min(1.0, std::max(0.0, p.satDrive))); tone.setTarget(lg2(std::min(std::max(p.satToneHz, 200.0), sr * 0.45))); mix.setTarget(std::min(1.0, std::max(0.0, p.satMix)));
        if (snap) { drive.reset(drive.target()); tone.reset(tone.target()); mix.reset(mix.target()); }
    }
    void run(double* l, double* r, int m) {
        const double d = drive.advance(m), MX = mix.advance(m);
        const double k = std::pow(10.0, d * 30.0 / 20.0);     // 0..+30 dB de ganancia previa
        const double mk = std::sqrt(k);                       // compensacion parcial de nivel
        const double bias = type ? 0.25 + 0.35 * d : 0.0, tb = std::tanh(bias);
        const double a = 1.0 - std::exp(-kTwoPi * std::exp2(tone.advance(m)) / sr);
        const double dcR = std::exp(-kTwoPi * 15.0 / sr);
        double* ch[2] = { l, r };
        for (int c = 0; c < 2; ++c) {
            double* x = ch[c];
            double xr = xp[c], lps = lp[c], x1 = dcx[c], y1 = dcy[c];
            double u0 = k * xr, G0 = lnCosh(u0 + bias) - u0 * tb;   // se recalcula por sub-bloque: k y el sesgo cambian con el drive
            for (int i = 0; i < m; ++i) {
                const double in = x[i];
                const double u1 = k * in;
                const double G1 = lnCosh(u1 + bias) - u1 * tb;
                const double du = u1 - u0;
                double y;
                if (std::fabs(du) > 1.0e-5) y = (G1 - G0) / du;
                else y = std::tanh(0.5 * (u1 + u0) + bias) - tb;
                u0 = u1; G0 = G1; xr = in;
                y *= mk / k;
                if (type) { const double o = y - x1 + dcR * y1; x1 = y; y1 = o; y = o; }
                lps += a * (y - lps);
                x[i] = in * (1.0 - MX) + lps * MX;
            }
            xp[c] = xr; lp[c] = lps; dcx[c] = x1; dcy[c] = y1;
        }
    }
};

// ---- E) chorus / ensemble de 3 voces por canal ----
struct ChorusBlock {
    double sr{48000.0};
    std::vector<double> buf[2];
    size_t mask{0}, w{0};
    double oc[3]{}, os[3]{};   // osciladores de cuadratura (seno = os)
    Smoother depth, rate, mix;
    void prepare(double sr_) {
        sr = sr_;
        const size_t n = pow2Min(static_cast<size_t>(0.06 * sr) + 16);
        for (auto& b : buf) b.assign(n, 0.0);
        mask = n - 1; w = 0;
        for (int v = 0; v < 3; ++v) { oc[v] = std::cos(kTwoPi * v / 3.0); os[v] = std::sin(kTwoPi * v / 3.0); }
        depth.prepare(sr, 40.0); rate.prepare(sr, 40.0); mix.prepare(sr, 30.0);
        depth.reset(0.4); rate.reset(lg2(0.6)); mix.reset(0.35);
        clear();
    }
    void clear() { for (auto& b : buf) std::fill(b.begin(), b.end(), 0.0); w = 0; }
    void setP(const FxParams& p, bool snap) {
        depth.setTarget(std::min(1.0, std::max(0.0, p.chDepth))); rate.setTarget(lg2(std::min(std::max(p.chRateHz, 0.02), 10.0))); mix.setTarget(std::min(1.0, std::max(0.0, p.chMix)));
        if (snap) { depth.reset(depth.target()); rate.reset(rate.target()); mix.reset(mix.target()); }
    }
    void run(double* l, double* r, int m) {
        const double D = depth.advance(m), MX = mix.advance(m), th = kTwoPi * std::exp2(rate.advance(m)) / sr, rc = std::cos(th), rs = std::sin(th);
        const double baseMs = 14.0, depthMs = 1.0 + 6.0 * D;
        const double dBase = baseMs * 0.001 * sr, dDep = depthMs * 0.001 * sr;
        const double dryG = 1.0 - 0.5 * MX, wetG = 0.7 * MX;
        for (int i = 0; i < m; ++i) {
            buf[0][w] = l[i]; buf[1][w] = r[i];
            double wl = 0.0, wr = 0.0;
            for (int v = 0; v < 3; ++v) {
                const double s = os[v];
                const double dl = dBase + dDep * (0.5 + 0.5 * s) + 2.0, dr = dBase + dDep * (0.5 - 0.5 * s) + 2.0;   // R en contrafase: ensanchamiento
                wl += leerHermite(buf[0], mask, w, dl);
                wr += leerHermite(buf[1], mask, w, dr);
                { const double nc = oc[v] * rc - os[v] * rs, ns = os[v] * rc + oc[v] * rs; oc[v] = nc; os[v] = ns; }
            }
            l[i] = l[i] * dryG + wl * (1.0 / 3.0) * wetG;
            r[i] = r[i] * dryG + wr * (1.0 / 3.0) * wetG;
            w = (w + 1) & mask;
        }
        for (int v = 0; v < 3; ++v) { const double r2 = oc[v] * oc[v] + os[v] * os[v], nrm = 1.5 - 0.5 * r2; oc[v] *= nrm; os[v] *= nrm; }   // renormaliza
    }
};

// ---- F) delay estereo con sync al tempo, tono en el lazo y ping-pong ----
struct DelayBlock {
    double sr{48000.0};
    std::vector<double> buf[2];
    size_t mask{0}, w{0};
    Smoother time, fb, tone, mix;
    bool ping{false};
    double lp[2]{0.0, 0.0}, hx[2]{0.0, 0.0}, hy[2]{0.0, 0.0};
    void prepare(double sr_) {
        sr = sr_;
        const size_t n = pow2Min(static_cast<size_t>(2.05 * sr) + 8);
        for (auto& b : buf) b.assign(n, 0.0);
        mask = n - 1; w = 0;
        time.prepare(sr, 60.0); fb.prepare(sr, 30.0); tone.prepare(sr, 30.0); mix.prepare(sr, 30.0);
        time.reset(350.0); fb.reset(0.35); tone.reset(lg2(5000.0)); mix.reset(0.25);
        clear();
    }
    void clear() { for (auto& b : buf) std::fill(b.begin(), b.end(), 0.0); w = 0; for (int c = 0; c < 2; ++c) lp[c] = hx[c] = hy[c] = 0.0; }
    void setTime(double ms, bool snap) { ms = std::min(std::max(ms, 1.0), 2000.0); time.setTarget(ms); if (snap) time.reset(ms); }
    void setP(const FxParams& p, bool snap) {
        ping = p.dlPingPong;
        fb.setTarget(std::min(0.9, std::max(0.0, p.dlFeedback))); tone.setTarget(lg2(std::min(std::max(p.dlToneHz, 200.0), sr * 0.45))); mix.setTarget(std::min(1.0, std::max(0.0, p.dlMix)));
        if (snap) { fb.reset(fb.target()); tone.reset(tone.target()); mix.reset(mix.target()); }
    }
    void run(double* l, double* r, int m) {
        const double ms = time.advance(m), F = fb.advance(m), MX = mix.advance(m);
        const double d = std::max(2.0, ms * 0.001 * sr);
        const double a = 1.0 - std::exp(-kTwoPi * std::exp2(tone.advance(m)) / sr), hr = std::exp(-kTwoPi * 30.0 / sr);
        for (int i = 0; i < m; ++i) {
            const double dl = leerHermite(buf[0], mask, w, d), dr = leerHermite(buf[1], mask, w, d);
            double fl = dl, fr = dr;
            // lazo: paso-bajos de tono + paso-altos de 30 Hz (sin acumulacion de DC)
            lp[0] += a * (fl - lp[0]); lp[1] += a * (fr - lp[1]);
            fl = lp[0]; fr = lp[1];
            double ol = fl - hx[0] + hr * hy[0]; hx[0] = fl; hy[0] = ol;
            double orr = fr - hx[1] + hr * hy[1]; hx[1] = fr; hy[1] = orr;
            fl = ol; fr = orr;
            double wl, wr;
            if (ping) { const double mono = 0.5 * (l[i] + r[i]); wl = mono + F * fr; wr = fl; }
            else { wl = l[i] + F * fl; wr = r[i] + F * fr; }
            if (!(std::fabs(wl) < 1.0e4)) wl = 0.0;
            if (!(std::fabs(wr) < 1.0e4)) wr = 0.0;
            buf[0][w] = wl; buf[1][w] = wr;
            w = (w + 1) & mask;
            l[i] += MX * dl; r[i] += MX * dr;
        }
    }
};

// ---- G) reverb: pre-delay + difusion de entrada + FDN de 8 lineas (Hadamard) con damping y modulacion ----
struct ReverbBlock {
    static constexpr int N = 8;
    double sr{48000.0};
    std::vector<double> line[N];
    size_t lmask[N]{};
    size_t lw[N]{};
    std::vector<double> pre[2];
    size_t pmask{0}, pw{0};
    struct AP { std::vector<double> b; size_t i{0}; double g{0.6};
        double run(double x) { const double d = b[i]; const double y = -g * x + d; b[i] = x + g * y; if (++i >= b.size()) i = 0; return y; } };
    AP ap[2][2];
    double lpS[N]{};
    double osc_c[N]{}, osc_s[N]{}, osc_k[N]{}, osc_r[N]{};
    Smoother size, damp, preMs, mixS;
    int type{1};
    double len[N]{};      // longitudes actuales (muestras)
    double g[N]{};
    double lpa{0.5};
    double inj{0.3};
    double lastSize{-1.0}, lastDamp{-1.0};
    int lastType{-1};
    double modDepth{0.0};

    static const double* baseMs(int t) {
        static const double plate[N] = { 7.9, 11.3, 15.7, 19.1, 23.3, 28.9, 34.1, 41.3 };
        static const double hall[N] = { 25.1, 31.7, 39.3, 47.9, 57.1, 67.7, 79.3, 93.1 };
        static const double room[N] = { 5.3, 7.9, 10.7, 13.9, 17.3, 21.1, 25.7, 30.1 };
        return t == 0 ? plate : (t == 2 ? room : hall);
    }
    static void rtRange(int t, double& mn, double& mx) { if (t == 0) { mn = 0.6; mx = 4.5; } else if (t == 2) { mn = 0.2; mx = 1.5; } else { mn = 1.5; mx = 10.0; } }

    void prepare(double sr_) {
        sr = sr_;
        for (int i = 0; i < N; ++i) { const size_t n = pow2Min(static_cast<size_t>(0.2 * sr) + 16); line[i].assign(n, 0.0); lmask[i] = n - 1; lw[i] = 0; }
        const size_t pn = pow2Min(static_cast<size_t>(0.21 * sr) + 16);
        pre[0].assign(pn, 0.0); pre[1].assign(pn, 0.0); pmask = pn - 1; pw = 0;
        static const double apMs[2][2] = { { 3.2, 7.9 }, { 3.7, 8.7 } };
        for (int c = 0; c < 2; ++c) for (int s = 0; s < 2; ++s) { ap[c][s].b.assign(static_cast<size_t>(apMs[c][s] * 0.001 * sr) + 1, 0.0); ap[c][s].i = 0; ap[c][s].g = 0.62; }
        for (int i = 0; i < N; ++i) {   // osciladores de modulacion en cuadratura (rate 0.35..1.1 Hz)
            const double rt = 0.35 + 0.1 * i, th = kTwoPi * rt / sr;
            osc_k[i] = std::cos(th); osc_r[i] = std::sin(th);
            const double ph0 = kTwoPi * i / N;
            osc_c[i] = std::cos(ph0); osc_s[i] = std::sin(ph0);
        }
        size.prepare(sr, 250.0); damp.prepare(sr, 60.0); preMs.prepare(sr, 60.0); mixS.prepare(sr, 30.0);
        size.reset(0.5); damp.reset(0.5); preMs.reset(20.0); mixS.reset(0.2);
        modDepth = 0.0003 * sr;
        clear();
        lastSize = lastDamp = -1.0; lastType = -1;
    }
    void clear() {
        for (int i = 0; i < N; ++i) { std::fill(line[i].begin(), line[i].end(), 0.0); lw[i] = 0; lpS[i] = 0.0; }
        for (auto& p : pre) std::fill(p.begin(), p.end(), 0.0);
        pw = 0;
        for (auto& a : ap) for (auto& s : a) { std::fill(s.b.begin(), s.b.end(), 0.0); s.i = 0; }
        lastSize = lastDamp = -1.0; lastType = -1;
    }
    void setP(const FxParams& p, bool snap) {
        const int t = p.rvType < 0 ? 0 : (p.rvType > 2 ? 2 : p.rvType);
        if (t != type) { type = t; lastType = -1; }
        size.setTarget(std::min(1.0, std::max(0.0, p.rvSize))); damp.setTarget(std::min(1.0, std::max(0.0, p.rvDamping))); preMs.setTarget(std::min(200.0, std::max(0.0, p.rvPreDelayMs)));
        mixS.setTarget(std::min(1.0, std::max(0.0, p.rvMix)));
        if (snap) { size.reset(size.target()); damp.reset(damp.target()); preMs.reset(preMs.target()); mixS.reset(mixS.target()); lastType = -1; }
    }
    void updateTuning(double sz, double dm) {
        const double* bm = baseMs(type);
        double rmn, rmx; rtRange(type, rmn, rmx);
        const double rt = rmn * std::pow(rmx / rmn, sz);
        const double scale = 0.6 + 0.8 * sz;
        double g2 = 0.0;
        for (int i = 0; i < N; ++i) {
            len[i] = std::max(8.0, bm[i] * 0.001 * sr * scale);
            g[i] = std::pow(10.0, -3.0 * len[i] / (rt * sr));
            g2 += g[i] * g[i];
        }
        g2 /= N;
        inj = std::min(1.0, std::max(0.04, std::sqrt(1.0 - g2))) * 0.9;
        const double fc = 16000.0 * std::pow(0.08, dm);
        lpa = std::exp(-kTwoPi * std::min(fc, sr * 0.45) / sr);
    }
    void run(double* l, double* r, int m) {
        const double sz = size.advance(m), dm = damp.advance(m), pd = preMs.advance(m) * 0.001 * sr;
        if (sz != lastSize || dm != lastDamp || type != lastType) { lastSize = sz; lastDamp = dm; lastType = type; updateTuning(sz, dm); }
        const double mx0 = mixS.current(), mx1 = mixS.advance(m);
        double dOff[N], dStep[N];   // modulacion: un paso de oscilador por sub-bloque, interpolado linealmente
        {
            const double invm = 1.0 / m;
            for (int k = 0; k < N; ++k) {
                const double th = std::acos(std::min(1.0, std::max(-1.0, osc_k[k]))) * m;
                const double s0 = osc_s[k], s1 = s0 * std::cos(th) + osc_c[k] * std::sin(th), c1 = osc_c[k] * std::cos(th) - s0 * std::sin(th);
                dOff[k] = modDepth * s0; dStep[k] = modDepth * (s1 - s0) * invm;
                osc_c[k] = c1; osc_s[k] = s1;
                const double r2 = c1 * c1 + s1 * s1, nrm = 1.5 - 0.5 * r2; osc_c[k] *= nrm; osc_s[k] *= nrm;
            }
        }
        const double pdl = std::max(1.0, pd);
        for (int i = 0; i < m; ++i) {
            pre[0][pw] = l[i]; pre[1][pw] = r[i];
            const double pl = leerLineal(pre[0], pmask, pw, pdl), pr = leerLineal(pre[1], pmask, pw, pdl);
            pw = (pw + 1) & pmask;
            const double dl = ap[0][1].run(ap[0][0].run(pl)), dr = ap[1][1].run(ap[1][0].run(pr));
            double o[N], v[N];
            for (int k = 0; k < N; ++k) {
                dOff[k] += dStep[k];
                const double d = std::max(2.0, len[k] + dOff[k]);
                o[k] = leerLineal(line[k], lmask[k], lw[k], d);
                lpS[k] = (1.0 - lpa) * o[k] + lpa * lpS[k];
                v[k] = lpS[k] * g[k];
            }
            // Hadamard rapida 8x8 (ortogonal)
            for (int len2 = 1; len2 < N; len2 <<= 1)
                for (int a = 0; a < N; a += len2 << 1)
                    for (int b = a; b < a + len2; ++b) { const double x = v[b], y = v[b + len2]; v[b] = x + y; v[b + len2] = x - y; }
            static const double sg[N] = { 1, 1, -1, 1, -1, -1, 1, -1 };
            for (int k = 0; k < N; ++k) {
                double nv = v[k] * 0.35355339059327373 + ((k & 1) ? dr : dl) * sg[k] * inj;
                if (!(std::fabs(nv) < 1.0e4)) nv = 0.0;
                line[k][lw[k]] = nv;
                lw[k] = (lw[k] + 1) & lmask[k];
            }
            const double wl = 0.5 * (o[0] + o[2] - o[4] + o[6]), wr = 0.5 * (o[1] - o[3] + o[5] + o[7]);
            const double mixOut = mx0 + (mx1 - mx0) * (static_cast<double>(i + 1) / m);
            l[i] += mixOut * wl; r[i] += mixOut * wr;
        }
    }
};

// ---- H) anchura estereo y ganancia de salida ----
struct OutBlock {
    Smoother width, gain;
    void prepare(double sr) { width.prepare(sr, 30.0); gain.prepare(sr, 30.0); width.reset(1.0); gain.reset(1.0); }
    void clear() {}
    void setP(const FxParams& p, bool snap) {
        width.setTarget(std::min(2.0, std::max(0.0, p.outWidth))); gain.setTarget(std::pow(10.0, std::min(12.0, std::max(-24.0, p.outGainDb)) / 20.0));
        if (snap) { width.reset(width.target()); gain.reset(gain.target()); }
    }
    void run(double* l, double* r, int m) {
        const double w0 = width.current(), g0 = gain.current(), w1 = width.advance(m), g1 = gain.advance(m);
        for (int i = 0; i < m; ++i) {
            const double t = static_cast<double>(i + 1) / m, w = w0 + (w1 - w0) * t, g = g0 + (g1 - g0) * t;
            const double mid = 0.5 * (l[i] + r[i]), side = 0.5 * (l[i] - r[i]) * w;
            l[i] = (mid + side) * g; r[i] = (mid - side) * g;
        }
    }
};

}  // namespace detail

// =====================================================================================
//  FxRack: cadena completa
// =====================================================================================
class FxRack {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate > 0 ? sampleRate : 48000.0;
        gHpf_.prepare(sr_); gLpf_.prepare(sr_); gEq_.prepare(sr_); gComp_.prepare(sr_); gSat_.prepare(sr_); gCh_.prepare(sr_); gDl_.prepare(sr_); gRv_.prepare(sr_); gOut_.prepare(sr_);
        hpf_.prepare(sr_, true); lpf_.prepare(sr_, false); eq_.prepare(sr_); comp_.prepare(sr_); sat_.prepare(sr_); ch_.prepare(sr_); dl_.prepare(sr_); rv_.prepare(sr_); out_.prepare(sr_);
        p_ = porDefecto();
        snap_ = true;
        setParams(p_, true);
        snap_ = true;
    }
    // Limpia estados y cola (parada / reposicion de transporte). Los parametros se conservan.
    void reset() {
        hpf_.clear(); lpf_.clear(); eq_.clear(); comp_.clear(); sat_.clear(); ch_.clear(); dl_.clear(); rv_.clear(); out_.clear();
        gHpf_.s.reset(gHpf_.s.target()); gLpf_.s.reset(gLpf_.s.target()); gEq_.s.reset(gEq_.s.target()); gComp_.s.reset(gComp_.s.target()); gSat_.s.reset(gSat_.s.target());
        gCh_.s.reset(gCh_.s.target()); gDl_.s.reset(gDl_.s.target()); gRv_.s.reset(gRv_.s.target()); gOut_.s.reset(gOut_.s.target());
        snap_ = true;
    }
    // Aplica los parametros (llamar desde updateParams; sin asignaciones). snap: salta los suavizados al valor.
    void setParams(const FxParams& p, bool snap = false) {
        p_ = p;
        const bool s = snap || snap_;
        snap_ = false;
        auto sn = [&](const detail::Gate& g) { return s || !g.live(); };
        hpf_.setP(p.hpfHz, p.hpfSlope, sn(gHpf_)); lpf_.setP(p.lpfHz, p.lpfSlope, sn(gLpf_));
        eq_.setP(p.eq, sn(gEq_)); comp_.setP(p, sn(gComp_)); sat_.setP(p, sn(gSat_)); ch_.setP(p, sn(gCh_)); dl_.setP(p, sn(gDl_));
        rv_.setP(p, sn(gRv_)); out_.setP(p, sn(gOut_));
        gHpf_.set(p.hpfOn, s); gLpf_.set(p.lpfOn, s); gEq_.set(p.eqOn, s); gComp_.set(p.compOn, s); gSat_.set(p.satOn, s);
        gCh_.set(p.chOn, s); gDl_.set(p.dlOn, s); gRv_.set(p.rvOn, s); gOut_.set(p.outOn, s);
        updateDelayTime(s);
    }
    void setTempo(double bpm) { bpm_ = (bpm >= 20.0 && bpm <= 400.0) ? bpm : 120.0; }
    const FxParams& params() const { return p_; }
    double sampleRate() const { return sr_; }
    int latency() const { return 0; }
    // Algun bloque encendido o aun apagandose
    bool activo() const {
        return gHpf_.live() || gLpf_.live() || gEq_.live() || gComp_.live() || gSat_.live() || gCh_.live() || gDl_.live() || gRv_.live() || gOut_.live();
    }
    // Ultima reduccion maxima del compresor (dB, >= 0)
    float grDb() const { return grOut_; }
    // Veces que la salvaguarda de seguridad (|x| >= 1e4 o NaN) tuvo que reiniciar el rack: debe ser 0
    uint32_t fallos() const { return faults_; }

    // Procesa n muestras estereo in situ. bus (opcional): publica la reduccion del compresor para la UI.
    template <class T>
    void process(T* L, T* R, int n, JasWaveDsp::MeterBusBase* bus = nullptr) {
        if (n <= 0) return;
        if (!activo()) {
            if (grOut_ != 0.0f) { grOut_ = 0.0f; if (bus) bus->fxGrDb.store(0.0f, std::memory_order_relaxed); }
            return;   // transparente: el buffer no se toca (bit a bit)
        }
        JasWaveDsp::ScopedNoDenormals nd;
        updateDelayTime(false);
        comp_.grMax = 0.0;
        int pos = 0;
        while (pos < n) {
            const int m = std::min(kSub, n - pos);
            for (int i = 0; i < m; ++i) { bl_[i] = static_cast<double>(L[pos + i]); br_[i] = static_cast<double>(R[pos + i]); }
#ifdef JW_FXRACK_PROBE
#define JW_FXR_PROBE(k) { for (int i_ = 0; i_ < m; ++i_) probe[k] = std::max(probe[k], std::max(std::fabs(bl_[i_]), std::fabs(br_[i_]))); }
#else
#define JW_FXR_PROBE(k)
#endif
            stage(gHpf_, hpf_, m); JW_FXR_PROBE(0) stage(gLpf_, lpf_, m); JW_FXR_PROBE(1) stage(gEq_, eq_, m); JW_FXR_PROBE(2) stage(gComp_, comp_, m); JW_FXR_PROBE(3) stage(gSat_, sat_, m); JW_FXR_PROBE(4)
            stage(gCh_, ch_, m); JW_FXR_PROBE(5) stage(gDl_, dl_, m); JW_FXR_PROBE(6) stage(gRv_, rv_, m); JW_FXR_PROBE(7) stage(gOut_, out_, m); JW_FXR_PROBE(8)
            bool bad = false;
            for (int i = 0; i < m; ++i) if (!(std::fabs(bl_[i]) < 1.0e4) || !(std::fabs(br_[i]) < 1.0e4)) { bad = true; break; }
            if (bad) {   // salvaguarda: silencio y reinicio de estados
                ++faults_;
                for (int i = 0; i < m; ++i) bl_[i] = br_[i] = 0.0;
                hpf_.clear(); lpf_.clear(); eq_.clear(); comp_.clear(); sat_.clear(); ch_.clear(); dl_.clear(); rv_.clear();
            }
            for (int i = 0; i < m; ++i) { L[pos + i] = static_cast<T>(bl_[i]); R[pos + i] = static_cast<T>(br_[i]); }
            pos += m;
        }
        grOut_ = static_cast<float>(comp_.grMax);
        if (bus) bus->fxGrDb.store(grOut_, std::memory_order_relaxed);
    }

private:
    template <class B>
    void stage(detail::Gate& g, B& blk, int m) {
        const double g0 = g.s.current();
        const double g1 = g.s.advance(m);
        if (g1 <= 0.0 && !(g.s.target() > 0.0)) { if (!g.cleared) { blk.clear(); g.cleared = true; } return; }
        g.cleared = false;
        if (g0 >= 1.0 && g1 >= 1.0) { blk.run(bl_, br_, m); return; }
        for (int i = 0; i < m; ++i) { tl_[i] = bl_[i]; tr_[i] = br_[i]; }
        blk.run(tl_, tr_, m);
        for (int i = 0; i < m; ++i) {
            const double t = g0 + (g1 - g0) * (static_cast<double>(i + 1) / m);
            bl_[i] += t * (tl_[i] - bl_[i]);
            br_[i] += t * (tr_[i] - br_[i]);
        }
    }
    void updateDelayTime(bool snap) {
        static const double fac[5] = { 0.0, 1.0, 0.5, 0.75, 0.25 };
        const int sy = p_.dlSync < 0 ? 0 : (p_.dlSync > 4 ? 4 : p_.dlSync);
        const double ms = sy == 0 ? p_.dlTimeMs : (60000.0 / bpm_) * fac[sy];
        dl_.setTime(ms, snap || !gDl_.live());
    }

    double sr_{48000.0}, bpm_{120.0};
    FxParams p_;
    bool snap_{true};
    float grOut_{0.0f};
    uint32_t faults_{0};
public:
    double probe[9]{};   // solo con JW_FXRACK_PROBE: maximo |x| tras cada etapa (diagnostico)
private:
    detail::Gate gHpf_, gLpf_, gEq_, gComp_, gSat_, gCh_, gDl_, gRv_, gOut_;
    detail::FilterBlock hpf_, lpf_;
    detail::EqBlock eq_;
    detail::CompBlock comp_;
    detail::SatBlock sat_;
    detail::ChorusBlock ch_;
    detail::DelayBlock dl_;
    detail::ReverbBlock rv_;
    detail::OutBlock out_;
    double bl_[kSub]{}, br_[kSub]{}, tl_[kSub]{}, tr_[kSub]{};
};

}  // namespace JasWaveFx
