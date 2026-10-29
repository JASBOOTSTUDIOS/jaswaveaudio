// =====================================================================================
//  JasWave Audio Doctor – restauración de audio (header-only, sin SDK, sin asignaciones en process)
//   Cadena fija con bypass por módulo con fundido:
//     entrada → De-Clip → De-Click → De-Hum → Gate/Expander → [STFT: De-Noise · De-Reverb · Voice Isolator]
//            → Air Recovery → (Delta) → salida
//   - De-Clip / De-Click comparten una línea de retardo (lookahead) y reparan por interpolación cúbica Hermite.
//   - De-Hum: hasta 8 muescas por sustracción paralela de pasa-banda a f0·h, f0 seguido ±2 Hz con un banco de Goertzel (1 s).
//   - Gate/Expander: detector enlazado con HPF de sidechain, histéresis, hold, ratio y balística en dB.
//   - STFT (Hann/Hann, solape 75 %): perfil de ruido aprendido o por mínimos, sustracción espectral con suelo,
//     suavizado temporal y en frecuencia, escudo de transitorios; de-reverb por sustracción de cola retardada;
//     aislador de voz (banda + puerta espectral). Modo Live Mic: N = 64 (latencia total < 2 ms).
//   - Diagnóstico continuo (ruido de fondo, hum, clics/s, % recortado, reverberancia) y recomendación Auto-Fix.
//   Latencia fija por modo: N (trama completa, medida con impulso) + lookahead de reparación.
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

namespace JasWaveDoctor {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kBypass = 0, kInGain = 1, kOutGain = 2, kLive = 3, kDelta = 4, kAutoFix = 5,
    kGateOn = 10, kGateThresh = 11, kGateRatio = 12, kGateAttack = 13, kGateRelease = 14, kGateHold = 15, kGateHyst = 16, kGateScHpf = 17,
    kDnOn = 20, kDnReduction = 21, kDnLearn = 22, kDnMode = 23, kDnSmooth = 24,
    kHumOn = 30, kHumFreq = 31, kHumHarm = 32, kHumQ = 33, kHumDepth = 34,
    kClOn = 50, kClSens = 51, kClWidth = 52,
    kDcOn = 60, kDcThresh = 61, kDcStrength = 62,
    kRvOn = 70, kRvAmount = 71, kRvTail = 72,
    kViOn = 80, kViLow = 81, kViHigh = 82, kViDepth = 83,
    kTsOn = 90, kTsAmount = 91,
    kAirOn = 95, kAirFreq = 96, kAirGain = 97,
    // diagnóstico (solo lectura)
    kDiagNoise = 120, kDiagHumHz = 121, kDiagHumDb = 122, kDiagClicks = 123, kDiagClip = 124, kDiagReverb = 125, kDiagReduction = 126
};

inline const char* const* labelsDnMode() { static const char* const l[] = { "Auto", "Learned", "Continuous" }; return l; }
inline const char* const* labelsHumFreq() { static const char* const l[] = { "Auto", "50 Hz", "60 Hz" }; return l; }
inline const char* const* labelsDiagHum() { static const char* const l[] = { "None", "50 Hz", "60 Hz" }; return l; }

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kInGain, "Input Gain", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(linearP(kOutGain, "Output Gain", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(toggleP(kLive, "Live Mic", 0));
        v.push_back(toggleP(kDelta, "Delta", 0));
        v.push_back(toggleP(kAutoFix, "Auto-Fix", 0));
        v.push_back(toggleP(kGateOn, "Gate On", 0));
        v.push_back(linearP(kGateThresh, "Gate Threshold", "dB", -80.0, 0.0, -50.0, 1));
        v.push_back(logP(kGateRatio, "Gate Ratio", ":1", 1.0, 20.0, 4.0, 1));
        v.push_back(logP(kGateAttack, "Gate Attack", "ms", 0.1, 50.0, 1.0, 1));
        v.push_back(logP(kGateRelease, "Gate Release", "ms", 5.0, 2000.0, 120.0, 0));
        v.push_back(linearP(kGateHold, "Gate Hold", "ms", 0.0, 1000.0, 50.0, 0));
        v.push_back(linearP(kGateHyst, "Gate Hysteresis", "dB", 0.0, 12.0, 4.0, 1));
        v.push_back(logP(kGateScHpf, "Gate SC HPF", "Hz", 20.0, 2000.0, 80.0, 0));
        v.push_back(toggleP(kDnOn, "De-Noise On", 0));
        v.push_back(linearP(kDnReduction, "De-Noise Reduction", "dB", 0.0, 24.0, 12.0, 1));
        v.push_back(toggleP(kDnLearn, "Learn Noise", 0));
        v.push_back(stepP(kDnMode, "De-Noise Mode", 2, 0, labelsDnMode()));
        v.push_back(linearP(kDnSmooth, "De-Noise Smoothing", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(toggleP(kHumOn, "De-Hum On", 0));
        v.push_back(stepP(kHumFreq, "Hum Frequency", 2, 0, labelsHumFreq()));
        v.push_back(linearP(kHumHarm, "Hum Harmonics", "", 1.0, 8.0, 4.0, 0));
        v.push_back(linearP(kHumQ, "Hum Q", "", 5.0, 100.0, 30.0, 0));
        v.push_back(linearP(kHumDepth, "Hum Depth", "dB", 0.0, 60.0, 40.0, 0));
        v.push_back(toggleP(kClOn, "De-Click On", 0));
        v.push_back(linearP(kClSens, "De-Click Sensitivity", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(logP(kClWidth, "De-Click Max Width", "ms", 0.1, 5.0, 1.0, 2));
        v.push_back(toggleP(kDcOn, "De-Clip On", 0));
        v.push_back(linearP(kDcThresh, "De-Clip Threshold", "dB", -12.0, 0.0, -0.3, 1));
        v.push_back(linearP(kDcStrength, "De-Clip Strength", "%", 0.0, 100.0, 100.0, 0));
        v.push_back(toggleP(kRvOn, "De-Reverb On", 0));
        v.push_back(linearP(kRvAmount, "De-Reverb Amount", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(logP(kRvTail, "De-Reverb Tail", "ms", 50.0, 1000.0, 300.0, 0));
        v.push_back(toggleP(kViOn, "Voice Isolator On", 0));
        v.push_back(logP(kViLow, "Voice Low", "Hz", 60.0, 400.0, 100.0, 0));
        v.push_back(logP(kViHigh, "Voice High", "Hz", 3000.0, 16000.0, 8000.0, 0));
        v.push_back(linearP(kViDepth, "Voice Isolation Depth", "dB", 0.0, 40.0, 20.0, 0));
        v.push_back(toggleP(kTsOn, "Transient Shield On", 1));
        v.push_back(linearP(kTsAmount, "Transient Shield", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(toggleP(kAirOn, "Air Recovery On", 0));
        v.push_back(logP(kAirFreq, "Air Frequency", "Hz", 4000.0, 16000.0, 8000.0, 0));
        v.push_back(linearP(kAirGain, "Air Gain", "dB", 0.0, 6.0, 2.0, 1));
        v.push_back(asReadOnly(linearP(kDiagNoise, "Diag Noise Floor", "dBFS", -120.0, 0.0, -120.0, 1)));
        v.push_back(asReadOnly(stepP(kDiagHumHz, "Diag Hum", 2, 0, labelsDiagHum())));
        v.push_back(asReadOnly(linearP(kDiagHumDb, "Diag Hum Level", "dBFS", -120.0, 0.0, -120.0, 1)));
        v.push_back(asReadOnly(linearP(kDiagClicks, "Diag Clicks per Second", "", 0.0, 100.0, 0.0, 1)));
        v.push_back(asReadOnly(linearP(kDiagClip, "Diag Clipped Samples", "%", 0.0, 100.0, 0.0, 2)));
        v.push_back(asReadOnly(linearP(kDiagReverb, "Diag Reverberance", "%", 0.0, 100.0, 0.0, 0)));
        v.push_back(asReadOnly(linearP(kDiagReduction, "Reduction", "dB", 0.0, 60.0, 0.0, 1)));
        marcarBasicos(v, { kBypass, kOutGain, kAutoFix, kLive, kDelta, kDnOn, kDnReduction, kDnLearn, kHumOn, kHumFreq, kGateOn, kGateThresh,
                           kClOn, kClSens, kDcOn, kDcThresh, kRvOn, kRvAmount });
        return v;
    }();
    return defs;
}

// ---- ajustes planos (los lee el procesador de la tabla y los pasa al motor) -------------------------------------
struct Settings {
    bool bypass{false}, live{false}, delta{false};
    float inDb{0.f}, outDb{0.f};
    bool gateOn{false}; float gateThresh{-50.f}, gateRatio{4.f}, gateAttack{1.f}, gateRelease{120.f}, gateHold{50.f}, gateHyst{4.f}, gateHpf{80.f};
    bool dnOn{false}, dnLearn{false}; int dnMode{0}; float dnReduction{12.f}, dnSmooth{0.5f};
    bool humOn{false}; int humFreq{0}; int humHarm{4}; float humQ{30.f}, humDepth{40.f};
    bool clOn{false}; float clSens{0.5f}, clWidthMs{1.f};
    bool dcOn{false}; float dcThreshDb{-0.3f}, dcStrength{1.f};
    bool rvOn{false}; float rvAmount{0.5f}, rvTailMs{300.f};
    bool viOn{false}; float viLow{100.f}, viHigh{8000.f}, viDepth{20.f};
    bool tsOn{true}; float tsAmount{0.5f};
    bool airOn{false}; float airFreq{8000.f}, airGain{2.f};
};

// ---- diagnóstico y recomendación Auto-Fix ---------------------------------------------------------------------
struct Diagnostico {
    float noiseDb{-120.f};   // ruido de fondo (dBFS, mínimo de bloques de 20 ms en 3 s)
    int humHz{0};            // 0 / 50 / 60
    float humDb{-120.f};     // nivel del hum (fundamental + 2 armónicos), dBFS
    float clicksPs{0.f};     // clics detectados por segundo
    float clipPct{0.f};      // % de muestras a ≥ −0,01 dBFS en el último segundo
    float reverb{0.f};       // reverberancia 0..100 (lentitud de las caídas)
};

struct Recomendacion { uint32_t id; double plain; };
constexpr int kMaxRecomendaciones = 24;

// Traduce el diagnóstico en ajustes (valores planos). Devuelve cuántos escribió en `out` (≥ kMaxRecomendaciones de sitio).
inline int recomendar(const Diagnostico& d, Recomendacion* out) {
    int n = 0;
    auto R = [&](uint32_t id, double v) { if (n < kMaxRecomendaciones) out[n++] = { id, v }; };
    const bool ruidoso = d.noiseDb > -75.f;
    R(kDnOn, ruidoso ? 1.0 : 0.0);
    if (ruidoso) {
        R(kDnReduction, clampT((d.noiseDb + 90.0) * 0.4, 6.0, 18.0));
        R(kDnMode, 0.0);
        R(kGateOn, d.noiseDb > -65.f ? 1.0 : 0.0);
        R(kGateThresh, clampT(d.noiseDb + 8.0, -80.0, -20.0));
    } else {
        R(kGateOn, 0.0);
    }
    const bool hum = d.humHz != 0 && d.humDb > -70.f && d.humDb > d.noiseDb - 6.f;
    R(kHumOn, hum ? 1.0 : 0.0);
    if (hum) {
        R(kHumFreq, d.humHz == 50 ? 1.0 : 2.0);
        R(kHumHarm, d.humDb > -45.f ? 8.0 : 4.0);
        R(kHumDepth, clampT(d.humDb + 100.0, 24.0, 60.0));
    }
    const bool clics = d.clicksPs > 0.5f;
    R(kClOn, clics ? 1.0 : 0.0);
    if (clics) R(kClSens, clampT(40.0 + d.clicksPs * 4.0, 40.0, 80.0));
    const bool clip = d.clipPct > 0.02f;
    R(kDcOn, clip ? 1.0 : 0.0);
    if (clip) { R(kDcThresh, -0.3); R(kDcStrength, 100.0); }
    const bool rev = d.reverb > 45.f;
    R(kRvOn, rev ? 1.0 : 0.0);
    if (rev) R(kRvAmount, clampT((d.reverb - 30.0) * 1.2, 20.0, 70.0));
    return n;
}

// Latencia total por modo (la usa el procesador VST3 sin instanciar el motor; coincide con Engine::latency())
inline int latenciaPara(double sr, bool live) {
    const int rep = live ? 12 + 8 + 8 : static_cast<int>(0.010 * sr) + static_cast<int>(0.005 * sr) + 8;
    const int stft = live ? 64 : 1024;
    return rep + stft;
}

// Telemetría hacia el editor (atómicos, sin bloqueos)
struct DoctorBus : MeterBusBase {
    static constexpr int kCols = 64;
    PeakMeter inPk[2], outPk[2];
    std::atomic<float> noiseDb{-120.f}, humDb{-120.f}, clicksPs{0.f}, clipPct{0.f}, reverb{0.f};
    std::atomic<int> humHz{0};
    std::atomic<float> reduccionDb{0.f}, gateGrDb{0.f};
    std::atomic<int> latencia{0};
    std::atomic<uint32_t> autoFixSerie{0};        // se incrementa cada vez que el procesador aplicó Auto-Fix
    std::atomic<int> aprendiendo{0}, aprendido{0};
    std::array<std::atomic<float>, kCols> perfil{};   // perfil de ruido (dBFS) en 64 columnas log 20 Hz..20 kHz
    DoctorBus() { for (auto& p : perfil) p.store(-140.f, std::memory_order_relaxed); }
};

// =====================================================================================
//  Reparación (De-Clip + De-Click) sobre una línea de retardo compartida, por canal
// =====================================================================================
class ReparadorCanal {
public:
    struct Params { bool dcOn{false}; float dcThresh{0.966f}; float dcStrength{1.f}; bool clOn{false}; float clK{15.f}; int clW{48}; };

    void prepare(int lookaheadMax) {
        size_t n = 64;
        while (n < static_cast<size_t>(lookaheadMax) * 2 + 64) n <<= 1;
        buf_.assign(n, 0.f);
        mask_ = n - 1;
        reset();
    }
    // maxRun: tramo recortado máximo que se reconstruye; maxW: anchura máxima de clic (muestras)
    void configure(int maxRun, int maxW) {
        maxRun_ = std::max(2, maxRun);
        maxW_ = std::max(2, maxW);
        qOff_ = maxRun_ + 3;
        L_ = maxRun_ + maxW_ + 8;
        reset();
    }
    int latency() const { return L_; }
    void reset() {
        std::fill(buf_.begin(), buf_.end(), 0.f);
        w_ = 0; enRun_ = false; abandonado_ = false; finPend_ = -1; finStart_ = 0; runStart_ = 0;
        enClick_ = false; clStart_ = 0; clN_ = 0; esc_ = 1.0e-4f; ultimoFinClick_ = -100000;
        clicks_ = 0; recortadas_ = 0;
    }
    uint64_t clicks() const { return clicks_; }
    uint64_t recortadas() const { return recortadas_; }

    inline float push(float x, const Params& p) {
        const int64_t w = w_;
        buf_[static_cast<size_t>(w) & mask_] = x;
        // ---- De-Clip: tramos de |x| ≥ umbral ----
        const float ax = std::fabs(x);
        if (ax >= 0.9989f) ++recortadas_;
        if (ax >= p.dcThresh) {
            if (!enRun_ && !abandonado_) { enRun_ = true; runStart_ = w; }
            else if (enRun_ && w - runStart_ > maxRun_) { enRun_ = false; abandonado_ = true; }
        } else {
            abandonado_ = false;
            if (enRun_) {
                enRun_ = false;
                if (w - runStart_ >= 2) { finPend_ = w; finStart_ = runStart_; }
            }
        }
        if (finPend_ >= 0 && w == finPend_ + 1) {
            if (p.dcOn) reparar(finStart_, finPend_, p.dcStrength);
            finPend_ = -1;
        }
        // ---- De-Click: segunda derivada anómala en q (ya pasó por el De-Clip) ----
        const int64_t q = w - qOff_;
        if (q >= 1) {
            const float d2 = buf_[static_cast<size_t>(q + 1) & mask_] - 2.f * buf_[static_cast<size_t>(q) & mask_] + buf_[static_cast<size_t>(q - 1) & mask_];
            const float ad = std::fabs(d2);
            const float thr = std::max(esc_, 1.0e-5f) * p.clK;
            if (!enClick_) {
                if (ad > thr && ad > 2.0e-4f) { enClick_ = true; clStart_ = q - 1; clN_ = 0; }
                else esc_ += (ad - esc_) * (ad > esc_ ? 0.05f : 0.002f);
            } else {
                ++clN_;
                if (ad < thr * 0.5f) {
                    // terminó de forma natural: es un clic
                    if (clStart_ - ultimoFinClick_ > p.clW) ++clicks_;   // dos picos seguidos del mismo chasquido cuentan una vez
                    ultimoFinClick_ = q;
                    int64_t e = q - 1;
                    if (e <= clStart_) e = clStart_ + 1;
                    if (p.clOn) reparar(clStart_, e, 1.f);
                    enClick_ = false;
                } else if (clN_ >= p.clW) {
                    enClick_ = false;   // demasiado largo: transitorio real, no se toca
                }
            }
        }
        w_ = w + 1;
        return buf_[static_cast<size_t>(w - L_) & mask_];   // retardo exacto = L_ muestras
    }

private:
    // Rellena [s, e) con una Hermite cúbica entre buf[s-1] y buf[e] (tangentes = pendientes de los bordes)
    void reparar(int64_t s, int64_t e, float strength) {
        const int64_t n = e - s;
        if (n < 1 || n > static_cast<int64_t>(mask_ / 2)) return;
        const float p0 = buf_[static_cast<size_t>(s - 2) & mask_], p1 = buf_[static_cast<size_t>(s - 1) & mask_];
        const float p2 = buf_[static_cast<size_t>(e) & mask_], p3 = buf_[static_cast<size_t>(e + 1) & mask_];
        const float seg = static_cast<float>(n + 1);
        const float m1 = (p1 - p0) * seg, m2 = (p3 - p2) * seg;
        for (int64_t k = 1; k <= n; ++k) {
            const float u = static_cast<float>(k) / seg, u2 = u * u, u3 = u2 * u;
            float y = (2.f * u3 - 3.f * u2 + 1.f) * p1 + (u3 - 2.f * u2 + u) * m1 + (-2.f * u3 + 3.f * u2) * p2 + (u3 - u2) * m2;
            y = clampT(y, -2.f, 2.f);
            float& dst = buf_[static_cast<size_t>(s + k - 1) & mask_];
            dst += strength * (y - dst);
        }
    }

    std::vector<float> buf_;
    size_t mask_{63};
    int64_t w_{0};
    int maxRun_{480}, maxW_{240}, qOff_{483}, L_{728};
    bool enRun_{false}, abandonado_{false};
    int64_t runStart_{0}, finPend_{-1}, finStart_{0};
    bool enClick_{false};
    int64_t clStart_{0}, ultimoFinClick_{-100000};
    int clN_{0};
    float esc_{1.0e-4f};
    uint64_t clicks_{0}, recortadas_{0};
};

// =====================================================================================
//  De-Hum: seguimiento de f0 (Goertzel) + muescas en armónicos
// =====================================================================================
class DeHum {
public:
    static constexpr int kFinos = 9;      // candidatos ±2 Hz en pasos de 0,5 Hz
    static constexpr int kArm = 8;
    void prepare(double sr) {
        sr_ = sr;
        ventana_ = static_cast<int>(sr);
        f0_.prepare(sr, 200.0);
        f0_.reset(60.0);
        reset();
    }
    void reset() {
        for (auto& g : go_) g = Goertzel{};
        cuenta_ = 0;
        for (auto& c : st_) for (auto& s : c) s.reset();
        ultimaF_ = -1.0; ultimoHarm_ = -1; ultimaQ_ = -1.f; ultimaDepth_ = -1.f;
        humDb_ = -120.f; humHz_ = 0; nominalAuto_ = 60;
        configurarGoertzel();
    }
    void setParams(int modo, int harm, float q, float depthDb) { modo_ = modo; harm_ = clampT(harm, 1, kArm); q_ = q; depth_ = depthDb; }
    float humDb() const { return humDb_; }
    int humHz() const { return humHz_; }          // frecuencia nominal detectada (0 = sin hum)
    float f0() const { return static_cast<float>(f0_.current()); }

    // Rastreador: una vez por muestra con la señal mono
    inline void track(float m) {
        for (int i = 0; i < kTotal; ++i) go_[i].push(m);
        if (++cuenta_ >= ventana_) { evaluar(); cuenta_ = 0; for (auto& g : go_) g.reiniciar(); }
    }
    // Actualiza los coeficientes (una vez por bloque)
    void actualizar(int n) {
        const double f = f0_.advance(n);
        if (f != ultimaF_ || harm_ != ultimoHarm_ || q_ != ultimaQ_ || depth_ != ultimaDepth_) {
            ultimaF_ = f; ultimoHarm_ = harm_; ultimaQ_ = q_; ultimaDepth_ = depth_;
            gHum_ = static_cast<float>(1.0 - std::pow(10.0, -static_cast<double>(depth_) / 20.0));
            for (int h = 0; h < kArm; ++h) {
                const double fh = f * (h + 1);
                if (h < harm_ && fh < sr_ * 0.45) { coef_[h] = BiquadCoefs::design(FilterType::BandPass, sr_, fh, 0.0, q_); activo_[h] = true; }
                else { activo_[h] = false; st_[0][h].reset(); st_[1][h].reset(); }
            }
        }
    }
    inline float filtrar(int ch, float x) {
        // Sustracción en paralelo: y = x − g·Σ BP_h(x). A diferencia de una cascada de campanas negativas no desplaza la
        // fase de la señal fuera de los armónicos (el delta contiene solo el hum).
        double hum = 0.0;
        for (int h = 0; h < kArm; ++h) if (activo_[h]) hum += biquadProcess(coef_[h], st_[ch][h], x);
        return static_cast<float>(x - gHum_ * hum);
    }

private:
    struct Goertzel {
        double coef{0.0}, s1{0.0}, s2{0.0};
        inline void push(double x) { const double s = x + coef * s1 - s2; s2 = s1; s1 = s; }
        double power() const { return s1 * s1 + s2 * s2 - coef * s1 * s2; }
        void reiniciar() { s1 = s2 = 0.0; }
    };
    // 0..8: finos de 50 Hz · 9..17: finos de 60 Hz · 18,19: 100, 150 Hz · 20,21: 120, 180 Hz
    static constexpr int kTotal = 2 * kFinos + 4;
    void configurarGoertzel() {
        auto set = [&](int i, double f) { go_[i].coef = 2.0 * std::cos(2.0 * kPi * f / sr_); go_[i].reiniciar(); };
        for (int k = 0; k < kFinos; ++k) { set(k, 50.0 + (k - 4) * 0.5); set(kFinos + k, 60.0 + (k - 4) * 0.5); }
        set(2 * kFinos, 100.0); set(2 * kFinos + 1, 150.0); set(2 * kFinos + 2, 120.0); set(2 * kFinos + 3, 180.0);
    }
    void evaluar() {
        double p50 = 0.0, p60 = 0.0; int b50 = 4, b60 = 4;
        for (int k = 0; k < kFinos; ++k) {
            const double a = go_[k].power(), b = go_[kFinos + k].power();
            if (a > p50) { p50 = a; b50 = k; }
            if (b > p60) { p60 = b; b60 = k; }
        }
        const double h50 = p50 + go_[2 * kFinos].power() + go_[2 * kFinos + 1].power();
        const double h60 = p60 + go_[2 * kFinos + 2].power() + go_[2 * kFinos + 3].power();
        int nominal = modo_ == 1 ? 50 : (modo_ == 2 ? 60 : nominalAuto_);
        if (modo_ == 0) {
            // histéresis ×2 para no saltar entre 50 y 60
            if (nominalAuto_ == 60 && h50 > 2.0 * h60) nominalAuto_ = 50;
            else if (nominalAuto_ == 50 && h60 > 2.0 * h50) nominalAuto_ = 60;
            nominal = nominalAuto_;
        }
        const double pot = nominal == 50 ? h50 : h60;
        const double amp = 2.0 * std::sqrt(std::max(pot, 0.0)) / static_cast<double>(ventana_);
        humDb_ = static_cast<float>(linearToDb(amp));
        humHz_ = humDb_ > -80.f ? nominal : 0;
        // refinado parabólico (en amplitud) sobre los tres candidatos vecinos del pico: ~0,05 Hz de precisión
        const int b = nominal == 50 ? b50 : b60, base = nominal == 50 ? 0 : kFinos;
        double off = 0.0;
        if (b > 0 && b < kFinos - 1) {
            const double l = std::sqrt(go_[base + b - 1].power()), c = std::sqrt(go_[base + b].power()), r = std::sqrt(go_[base + b + 1].power());
            const double den = l - 2.0 * c + r;
            if (den < -1.0e-18) off = clampT(0.5 * (l - r) / den, -0.5, 0.5);
        }
        const double fino = nominal + (b - 4 + off) * 0.5;
        // Solo se mueve el seguimiento si realmente hay hum (evita derivas con la música)
        if (humDb_ > -80.f || std::fabs(f0_.target() - nominal) > 2.5) f0_.setTarget(fino);
    }

    double sr_{48000.0};
    int ventana_{48000}, cuenta_{0};
    std::array<Goertzel, kTotal> go_{};
    Smoother f0_;
    int modo_{0}, harm_{4}, nominalAuto_{60};
    float q_{30.f}, depth_{40.f}, gHum_{0.99f};
    double ultimaF_{-1.0}; int ultimoHarm_{-1}; float ultimaQ_{-1.f}, ultimaDepth_{-1.f};
    BiquadCoefs coef_[kArm];
    BiquadState st_[2][kArm];
    bool activo_[kArm]{};
    float humDb_{-120.f};
    int humHz_{0};
};

// =====================================================================================
//  Gate / Expander estéreo enlazado
// =====================================================================================
class GateExpander {
public:
    void prepare(double sr) { sr_ = sr; reset(); }
    void reset() { hs_[0].reset(); hs_[1].reset(); env_ = 0.f; gDb_ = -80.f; abierto_ = false; hold_ = 0; grMax_ = 0.f; }
    void setParams(float thrDb, float ratio, float atkMs, float relMs, float holdMs, float hystDb, float hpfHz) {
        thr_ = thrDb; ratio_ = std::max(1.f, ratio); hyst_ = std::max(0.f, hystDb);
        aAtk_ = 1.f - std::exp(-1.f / (std::max(0.05f, atkMs) * 0.001f * static_cast<float>(sr_)));
        aRel_ = 1.f - std::exp(-1.f / (std::max(1.f, relMs) * 0.001f * static_cast<float>(sr_)));
        holdN_ = static_cast<int>(holdMs * 0.001f * sr_);
        if (hpfHz != hpfHz_) { hpfHz_ = hpfHz; hp_ = BiquadCoefs::design(FilterType::HighPass, sr_, hpfHz, 0.0, 0.7071); }
        dA_ = 1.f - std::exp(-1.f / (0.0003f * static_cast<float>(sr_)));
        dR_ = 1.f - std::exp(-1.f / (0.02f * static_cast<float>(sr_)));
    }
    inline float process(float l, float r) {
        const float sl = static_cast<float>(biquadProcess(hp_, hs_[0], l)), sr = static_cast<float>(biquadProcess(hp_, hs_[1], r));
        const float sc = std::max(std::fabs(sl), std::fabs(sr));
        env_ += (sc - env_) * (sc > env_ ? dA_ : dR_);
        const float envDb = 20.f * std::log10(env_ + 1.0e-9f);
        if (abierto_) {
            if (envDb < thr_ - hyst_) { if (++hold_ > holdN_) abierto_ = false; }
            else hold_ = 0;
        } else if (envDb > thr_) { abierto_ = true; hold_ = 0; }
        const float target = abierto_ ? 0.f : clampT((envDb - (thr_ - hyst_)) * (ratio_ - 1.f), -80.f, 0.f);
        gDb_ += (target - gDb_) * (target > gDb_ ? aAtk_ : aRel_);
        grMax_ = std::max(grMax_, -gDb_);
        return std::exp(gDb_ * 0.1151292546f);
    }
    float takeGrMax() { const float g = grMax_; grMax_ = 0.f; return g; }
private:
    double sr_{48000.0};
    float thr_{-50.f}, ratio_{4.f}, hyst_{4.f}, aAtk_{0.1f}, aRel_{0.001f}, dA_{0.06f}, dR_{0.001f};
    int holdN_{2400}, hold_{0};
    float hpfHz_{-1.f};
    BiquadCoefs hp_;
    BiquadState hs_[2];
    float env_{0.f}, gDb_{-80.f}, grMax_{0.f};
    bool abierto_{false};
};

// =====================================================================================
//  Procesador espectral por canal (De-Noise · De-Reverb · Voice Isolator)
// =====================================================================================
class Espectral {
public:
    static constexpr int kLog2Max = 10, kNmax = 1 << kLog2Max, kKmax = kNmax / 2 + 1;
    static constexpr int kLog2Live = 6;
    static constexpr int kDmax = 160;   // tramas de retardo para la estimación de cola (≈50 ms en Live)

    struct Params {
        bool dnOn{false}, learn{false}, rvOn{false}, viOn{false}, tsOn{true};
        int dnMode{0};
        float floor{0.25f}, alpha{2.f}, aAtk{0.6f}, aRel{0.25f};
        float rvGamma{0.f}, rvFloor{1.f};
        float viLowHz{100.f}, viHighHz{8000.f}, viDepthDb{20.f};
        float tsAmount{0.5f};
    };
    struct Stats { double inE{0.0}, outE{0.0}; };

    void prepare(double sr) {
        sr_ = sr;
        if (!fftA_) fftA_ = std::make_unique<FFT>(kLog2Max);
        if (!fftB_) fftB_ = std::make_unique<FFT>(kLog2Live);
        frame_.assign(kNmax, 0.f); re_.assign(kNmax, 0.f); im_.assign(kNmax, 0.f); win_.assign(kNmax, 0.f);
        hopIn_.assign(kNmax / 4, 0.f); hopOut_.assign(kNmax / 4, 0.f); ola_.assign(kNmax, 0.f);
        noise_.assign(kKmax, 0.f); scratch_.assign(kKmax, 0.f); minT_.assign(kKmax, 1.0e3f); gS_.assign(kKmax, 1.f); gF_.assign(kKmax, 1.f); mag2_.assign(kKmax, 0.f);
        pRing_.assign(static_cast<size_t>(kDmax) * kKmax, 0.f);
        perfilDb_.assign(kKmax, -140.f);
        aprendido_ = false;
        configure(false);
    }
    void configure(bool live) {
        live_ = live;
        log2_ = live ? kLog2Live : kLog2Max;
        N_ = 1 << log2_; hop_ = N_ / 4; K_ = N_ / 2 + 1;
        for (int i = 0; i < N_; ++i) win_[static_cast<size_t>(i)] = static_cast<float>(0.5 - 0.5 * std::cos(2.0 * kPi * i / N_));
        D_ = clampT(static_cast<int>(std::lround(0.05 * sr_ / hop_)), 1, kDmax);
        upRate_ = static_cast<float>(hop_ / sr_ / 3.0);   // mínimos: subida en ~3 s
        bias_ = 1.5f * std::sqrt(static_cast<float>(sr_ / hop_));
        reset();
    }
    void reset() {
        std::fill(frame_.begin(), frame_.end(), 0.f); std::fill(ola_.begin(), ola_.end(), 0.f);
        std::fill(hopIn_.begin(), hopIn_.end(), 0.f); std::fill(hopOut_.begin(), hopOut_.end(), 0.f);
        std::fill(gS_.begin(), gS_.end(), 1.f); std::fill(minT_.begin(), minT_.end(), 1.0e3f);
        std::fill(pRing_.begin(), pRing_.end(), 0.f);
        k_ = 0; frameIdx_ = 0; eAvg_ = 0.f; aprendiendo_ = false; learnFrames_ = 0;
        stats_ = Stats{};
    }
    int latency() const { return N_; }   // medido con un impulso: la trama completa (N) antes de que salga la primera muestra
    int N() const { return N_; }
    int K() const { return K_; }
    bool aprendido() const { return aprendido_; }
    bool aprendiendo() const { return aprendiendo_; }
    const std::vector<float>& perfilDb() const { return perfilDb_; }
    Stats takeStats() { const Stats s = stats_; stats_ = Stats{}; return s; }
    // Ruido de banda ancha de la última trama: potencia por muestra estimada con la MEDIANA de los bins (robusta a tonos y
    // a música dispersa). Negativa = trama en silencio digital (no vale como medida).
    uint32_t frames() const { return frames_; }
    float sigma2() const { return sigma2_; }

    inline float push(float x, const Params& p) {
        hopIn_[static_cast<size_t>(k_)] = x;
        const float y = hopOut_[static_cast<size_t>(k_)];
        if (++k_ == hop_) { procesarFrame(p); k_ = 0; }
        return y;
    }

private:
    void procesarFrame(const Params& p) {
        const size_t N = static_cast<size_t>(N_), H = static_cast<size_t>(hop_);
        std::memmove(frame_.data(), frame_.data() + H, (N - H) * sizeof(float));
        std::memcpy(frame_.data() + (N - H), hopIn_.data(), H * sizeof(float));
        for (size_t i = 0; i < N; ++i) { re_[i] = frame_[i] * win_[i]; im_[i] = 0.f; }
        FFT& fft = live_ ? *fftB_ : *fftA_;
        fft.forward(re_.data(), im_.data());
        const int K = K_;
        double E = 0.0;
        for (int k = 0; k < K; ++k) { const float m2 = re_[static_cast<size_t>(k)] * re_[static_cast<size_t>(k)] + im_[static_cast<size_t>(k)] * im_[static_cast<size_t>(k)]; mag2_[static_cast<size_t>(k)] = m2; E += m2; }
        const float Ef = static_cast<float>(E);
        ++frames_;
        if (E > 1.0e-9) {
            std::memcpy(scratch_.data(), mag2_.data(), static_cast<size_t>(K) * sizeof(float));
            std::nth_element(scratch_.begin(), scratch_.begin() + K / 2, scratch_.begin() + K);
            sigma2_ = scratch_[static_cast<size_t>(K / 2)] / (0.693147f * 0.375f * static_cast<float>(N_));   // mediana de Exp(1) = ln2·media; Σw² = 3N/8
        } else sigma2_ = -1.f;
        const bool onset = Ef > 3.f * eAvg_ && Ef > 1.0e-7f;
        // ---- perfil de ruido ----
        if (p.learn) {
            if (!aprendiendo_) { aprendiendo_ = true; learnFrames_ = 0; }
            if (learnFrames_ < maxLearn()) {
                const float a = 1.f / static_cast<float>(learnFrames_ + 1);
                for (int k = 0; k < K; ++k) { float& nz = noise_[static_cast<size_t>(k)]; nz = learnFrames_ == 0 ? mag2_[static_cast<size_t>(k)] : nz + (mag2_[static_cast<size_t>(k)] - nz) * a; }
                ++learnFrames_;
                aprendido_ = true;
            }
        } else aprendiendo_ = false;
        const bool usarAprendido = aprendido_ && (p.dnMode == 1 || p.dnMode == 0);
        const float kBias = bias_;   // mínimo → media del ruido (calibrado con ruido blanco: B ≈ 1,5·√(tramas/s))
        const float dLow = p.viLowHz, dHigh = p.viHighHz;
        const float binHz = static_cast<float>(sr_ / N_);
        const float viAtt = std::pow(10.f, -p.viDepthDb / 20.f), viGate = std::pow(10.f, -p.viDepthDb / 40.f);
        const size_t ringOff = static_cast<size_t>(frameIdx_ % D_) * kKmax;
        const float lift = (p.tsOn && onset) ? p.tsAmount : 0.f;
        double inE = 0.0, outE = 0.0;
        for (int k = 0; k < K; ++k) {
            const size_t kk = static_cast<size_t>(k);
            const float m2 = mag2_[kk];
            float& mt = minT_[kk];
            mt = m2 < mt ? m2 : mt + (m2 - mt) * upRate_;
            float nEst;
            if (usarAprendido) nEst = noise_[kk];
            else {
                // Tope tonal: un tono sostenido hace subir su mínimo; se limita a 2× la mediana de sus vecinos (±8 bins)
                const int k0 = std::max(0, k - 8), k1 = std::min(K - 1, k + 8), cnt = k1 - k0 + 1;
                float w[17];
                for (int j = 0; j < cnt; ++j) w[j] = minT_[static_cast<size_t>(k0 + j)];
                std::nth_element(w, w + cnt / 2, w + cnt);
                nEst = std::min(mt, 2.f * w[cnt / 2]) * kBias;
            }
            perfilDb_[kk] = static_cast<float>(10.0 * std::log10(std::max(nEst, 1.0e-14f) * 4.0 / (N_ * N_ * 0.25)));   // escala aprox. dBFS de un seno
            float gdn = 1.f;
            if (p.dnOn) {
                const float r = p.alpha * nEst / (m2 + 1.0e-20f);
                float graw = r >= 1.f ? 0.f : std::sqrt(1.f - r);
                if (graw < p.floor) graw = p.floor;
                float& gs = gS_[kk];
                gs += (graw - gs) * (graw > gs ? p.aAtk : p.aRel);
                gdn = gs;
            } else gS_[kk] = 1.f;
            float grv = 1.f;
            const float pd = pRing_[ringOff + kk];
            pRing_[ringOff + kk] = m2;
            if (p.rvOn) {
                const float rr = p.rvGamma * pd / (m2 + 1.0e-20f);
                grv = rr >= 1.f ? 0.f : std::sqrt(1.f - rr);
                if (grv < p.rvFloor) grv = p.rvFloor;
            }
            if (lift > 0.f) { gdn += (1.f - gdn) * lift; grv += (1.f - grv) * lift; }
            float gvi = 1.f;
            if (p.viOn) {
                const float f = std::max(binHz * k, 1.f);
                float att = 0.f;
                if (f < dLow) att = std::min(1.f, std::log2(dLow / f));
                else if (f > dHigh) att = std::min(1.f, std::log2(f / dHigh));
                gvi = 1.f + (viAtt - 1.f) * att;
                if (m2 < 3.f * nEst) gvi *= viGate;   // puerta espectral: bins a menos de ~5 dB del ruido estimado (con el tope tonal)
            }
            gF_[kk] = gdn * grv * gvi;
        }
        // suavizado en frecuencia (3 taps) y aplicación
        float prev = gF_[0];
        for (int k = 0; k < K; ++k) {
            const size_t kk = static_cast<size_t>(k);
            const float cur = gF_[kk], next = k + 1 < K ? gF_[kk + 1] : cur;
            const float g = 0.25f * prev + 0.5f * cur + 0.25f * next;
            prev = cur;
            inE += 1.0;            // reducción media por bin (no ponderada por energía: un tono fuerte no oculta el ruido quitado)
            outE += static_cast<double>(g) * g;
            re_[kk] *= g; im_[kk] *= g;
        }
        stats_.inE += inE; stats_.outE += outE;
        eAvg_ += (Ef - eAvg_) * 0.1f;
        ++frameIdx_;
        // simetría conjugada e inversa (FFT directa del conjugado)
        for (int k = 1; k < K - 1; ++k) { re_[N - static_cast<size_t>(k)] = re_[static_cast<size_t>(k)]; im_[N - static_cast<size_t>(k)] = -im_[static_cast<size_t>(k)]; }
        for (size_t i = 0; i < N; ++i) im_[i] = -im_[i];
        fft.forward(re_.data(), im_.data());
        const float norm = (2.f / 3.f) / static_cast<float>(N_);
        for (size_t i = 0; i < N; ++i) ola_[i] += re_[i] * norm * win_[i];
        std::memcpy(hopOut_.data(), ola_.data(), H * sizeof(float));
        std::memmove(ola_.data(), ola_.data() + H, (N - H) * sizeof(float));
        std::fill(ola_.begin() + static_cast<std::ptrdiff_t>(N - H), ola_.begin() + static_cast<std::ptrdiff_t>(N), 0.f);
    }
    int maxLearn() const { return std::max(4, static_cast<int>(2.0 * sr_ / hop_)); }   // 2 s de aprendizaje

    double sr_{48000.0};
    bool live_{false};
    int log2_{kLog2Max}, N_{kNmax}, hop_{kNmax / 4}, K_{kKmax}, k_{0}, D_{10}, frameIdx_{0}, learnFrames_{0};
    float upRate_{0.002f}, eAvg_{0.f}, sigma2_{-1.f}, bias_{20.f};
    uint32_t frames_{0};
    bool aprendido_{false}, aprendiendo_{false};
    std::unique_ptr<FFT> fftA_, fftB_;
    std::vector<float> frame_, re_, im_, win_, hopIn_, hopOut_, ola_, noise_, scratch_, minT_, gS_, gF_, mag2_, pRing_, perfilDb_;
    Stats stats_;
};

// =====================================================================================
//  Diagnóstico en el dominio del tiempo (ruido de fondo, recorte, reverberancia)
// =====================================================================================
class Diagnosticador {
public:
    void prepare(double sr) {
        sr_ = sr;
        bloque_ = std::max(1, static_cast<int>(sr * 0.02));
        minimo_.prepare(200);
        reset();
    }
    void reset() { acc_ = 0.0; cnt_ = 0; blkMin_ = 1.0e9f; minimo_.reset(); noise_ = -120.f; prevDb_ = -120.f; rate_ = 150.f; reverb_ = 0.f; recortadas_ = 0; total_ = 0; clipPct_ = 0.f; segCnt_ = 0; clicksBase_ = 0; clicksPs_ = 0.f; }
    inline void push(float l, float r) {
        acc_ += static_cast<double>(l) * l + static_cast<double>(r) * r;
        if (std::fabs(l) >= 0.9989f) ++recortadas_;
        if (std::fabs(r) >= 0.9989f) ++recortadas_;
        total_ += 2;
        if (++cnt_ >= bloque_) finBloque();
    }
    // clics acumulados por los reparadores: se convierten en clics/s cada segundo (n = muestras del bloque)
    void segundo(uint64_t clicksTotales, int n) {
        segCnt_ += n;
        if (segCnt_ < sr_) return;
        segCnt_ = 0;
        clipPct_ = total_ ? 100.f * static_cast<float>(recortadas_) / static_cast<float>(total_) : 0.f;
        recortadas_ = 0; total_ = 0;
        clicksPs_ = static_cast<float>(clicksTotales - clicksBase_);
        clicksBase_ = clicksTotales;
    }
    // ruido de banda ancha (dB, de la mediana espectral) de cada trama STFT; el mínimo del bloque alimenta la ventana de 3 s
    void frameNoise(float db) { if (db < blkMin_) blkMin_ = db; }
    bool bloqueNuevo() { const bool b = nuevo_; nuevo_ = false; return b; }
    float noiseDb() const { return noise_; }
    float clipPct() const { return clipPct_; }
    float clicksPs() const { return clicksPs_; }
    float reverb() const { return reverb_; }
private:
    void finBloque() {
        const float db = static_cast<float>(10.0 * std::log10(acc_ / (2.0 * cnt_) + 1.0e-12));
        acc_ = 0.0; cnt_ = 0;
        const float v = blkMin_ < 1.0e8f ? blkMin_ : db;
        blkMin_ = 1.0e9f;
        noise_ = minimo_.push(v, 150);   // mínimo de 3 s
        // caídas: velocidad en dB/s mientras la señal baja y sigue 12 dB sobre el ruido
        if (db < prevDb_ - 0.5f && db > noise_ + 12.f) {
            const float r = (prevDb_ - db) * 50.f;
            rate_ += (clampT(r, 0.f, 400.f) - rate_) * 0.05f;
            reverb_ = clampT(100.f * (1.f - (rate_ - 30.f) / 170.f), 0.f, 100.f);
        }
        prevDb_ = db;
        nuevo_ = true;
    }
    double sr_{48000.0};
    int bloque_{960}, cnt_{0};
    double acc_{0.0}, segCnt_{0.0};
    float blkMin_{1.0e9f};
    SlidingMin minimo_;
    float noise_{-120.f}, prevDb_{-120.f}, rate_{150.f}, reverb_{0.f}, clipPct_{0.f}, clicksPs_{0.f};
    uint64_t recortadas_{0}, total_{0}, clicksBase_{0};
    bool nuevo_{false};
};

// =====================================================================================
//  Motor completo
// =====================================================================================
class Engine {
public:
    void prepare(double sr, int maxBlock) {
        sr_ = sr > 0 ? sr : 48000.0;
        maxBlock_ = std::max(1, maxBlock);
        const int maxRun = static_cast<int>(0.010 * sr_), maxW = static_cast<int>(0.005 * sr_);
        for (auto& r : rep_) r.prepare(maxRun + maxW + 16);
        for (auto& s : stft_) s.prepare(sr_);
        hum_.prepare(sr_);
        gate_.prepare(sr_);
        diag_.prepare(sr_);
        size_t n = 64;
        while (n < static_cast<size_t>(Espectral::kNmax + maxRun + maxW + 64)) n <<= 1;
        for (auto& d : dly_) d.assign(n, 0.f);
        dmask_ = n - 1; dw_ = 0;
        gIn_.prepare(sr_, 20.0); gOut_.prepare(sr_, 20.0); byp_.prepare(sr_, 15.0);
        gIn_.reset(1.0); gOut_.reset(1.0); byp_.reset(1.0);
        liveActual_ = !s_.live;   // fuerza la configuración
        aplicar(true);
        clear();
    }
    void clear() {
        for (auto& r : rep_) r.reset();
        for (auto& s : stft_) s.reset();
        hum_.reset(); gate_.reset(); diag_.reset();
        for (auto& d : dly_) std::fill(d.begin(), d.end(), 0.f);
        dw_ = 0;
        for (auto& a : airSt_) a.reset();
        reduccionDb_ = 0.f; gateGr_ = 0.f;
    }
    void set(const Settings& s) { s_ = s; aplicar(false); }
    const Settings& settings() const { return s_; }
    int latency() const { return latencia_; }
    bool live() const { return liveActual_; }

    Diagnostico diagnostico() const {
        Diagnostico d;
        d.noiseDb = diag_.noiseDb(); d.humHz = hum_.humHz(); d.humDb = hum_.humDb();
        d.clicksPs = diag_.clicksPs(); d.clipPct = diag_.clipPct(); d.reverb = diag_.reverb();
        return d;
    }
    float reduccionDb() const { return reduccionDb_; }
    float gateGrDb() const { return gateGr_; }
    float humF0() const { return hum_.f0(); }
    bool aprendido() const { return stft_[0].aprendido(); }
    bool aprendiendo() const { return stft_[0].aprendiendo(); }
    const std::vector<float>& perfilDb() const { return stft_[0].perfilDb(); }
    int binsPerfil() const { return stft_[0].K(); }
    int nFft() const { return stft_[0].N(); }
    double sampleRate() const { return sr_; }

    template <class T>
    void process(const T* iL, const T* iR, T* oL, T* oR, int n) {
        const float gi0 = static_cast<float>(gIn_.current()), gi1 = static_cast<float>(gIn_.advance(n));
        const float go0 = static_cast<float>(gOut_.current()), go1 = static_cast<float>(gOut_.advance(n));
        const float by0 = static_cast<float>(byp_.current()), by1 = static_cast<float>(byp_.advance(n));
        hum_.actualizar(n);
        const float inv = 1.f / static_cast<float>(n);
        const int lat = latencia_;
        for (int i = 0; i < n; ++i) {
            const float t = (i + 1) * inv;
            const float gi = gi0 + (gi1 - gi0) * t, go = go0 + (go1 - go0) * t, by = by0 + (by1 - by0) * t;
            float l = static_cast<float>(iL[i]) * gi, r = static_cast<float>(iR[i]) * gi;
            diag_.push(l, r);
            dly_[0][dw_ & dmask_] = l; dly_[1][dw_ & dmask_] = r;
            const float dryL = dly_[0][(dw_ - static_cast<size_t>(lat)) & dmask_], dryR = dly_[1][(dw_ - static_cast<size_t>(lat)) & dmask_];
            ++dw_;
            // reparación
            l = rep_[0].push(l, repP_); r = rep_[1].push(r, repP_);
            // hum
            hum_.track(0.5f * (l + r));
            if (s_.humOn) { l = hum_.filtrar(0, l); r = hum_.filtrar(1, r); }
            // gate
            if (s_.gateOn) { const float g = gate_.process(l, r); l *= g; r *= g; }
            // espectral
            l = stft_[0].push(l, espP_); r = stft_[1].push(r, espP_);
            if (stft_[0].frames() != ultimasTramas_) {
                ultimasTramas_ = stft_[0].frames();
                const float s2 = stft_[0].sigma2();
                if (s2 > 0.f) diag_.frameNoise(10.f * std::log10(s2 + 1.0e-12f));
            }
            // aire
            if (s_.airOn) { l = static_cast<float>(biquadProcess(air_, airSt_[0], l)); r = static_cast<float>(biquadProcess(air_, airSt_[1], r)); }
            float wl = l, wr = r;
            if (s_.delta) { wl = dryL - l; wr = dryR - r; }
            oL[i] = static_cast<T>((dryL + (wl - dryL) * by) * go);
            oR[i] = static_cast<T>((dryR + (wr - dryR) * by) * go);
        }
        // medidas del bloque
        diag_.segundo(std::max(rep_[0].clicks(), rep_[1].clicks()), n);   // máximo de los dos canales (un clic mono cuenta una vez)
        const Espectral::Stats a = stft_[0].takeStats(), b = stft_[1].takeStats();
        const double ie = a.inE + b.inE, oe = a.outE + b.outE;
        const float red = ie > 1.0e-12 && oe > 0.0 ? static_cast<float>(10.0 * std::log10(ie / std::max(oe, 1.0e-20))) : 0.f;
        reduccionDb_ = std::max(0.f, red);
        gateGr_ = s_.gateOn ? gate_.takeGrMax() : 0.f;
    }

    // Publica telemetría en el bus (una vez por bloque; el perfil solo con el editor abierto)
    void publicar(DoctorBus* bus) {
        if (!bus) return;
        const Diagnostico d = diagnostico();
        bus->noiseDb.store(d.noiseDb, std::memory_order_relaxed);
        bus->humDb.store(d.humDb, std::memory_order_relaxed);
        bus->humHz.store(d.humHz, std::memory_order_relaxed);
        bus->clicksPs.store(d.clicksPs, std::memory_order_relaxed);
        bus->clipPct.store(d.clipPct, std::memory_order_relaxed);
        bus->reverb.store(d.reverb, std::memory_order_relaxed);
        bus->reduccionDb.store(reduccionDb_, std::memory_order_relaxed);
        bus->gateGrDb.store(gateGr_, std::memory_order_relaxed);
        bus->latencia.store(latencia_, std::memory_order_relaxed);
        bus->aprendido.store(aprendido() ? 1 : 0, std::memory_order_relaxed);
        bus->aprendiendo.store(aprendiendo() ? 1 : 0, std::memory_order_relaxed);
        if (!bus->vistaAbierta()) return;
        const std::vector<float>& p = perfilDb();
        const int K = binsPerfil();
        const double binHz = sr_ / nFft();
        for (int c = 0; c < DoctorBus::kCols; ++c) {
            const double f0 = 20.0 * std::pow(1000.0, static_cast<double>(c) / DoctorBus::kCols), f1 = 20.0 * std::pow(1000.0, static_cast<double>(c + 1) / DoctorBus::kCols);
            int k0 = static_cast<int>(f0 / binHz), k1 = static_cast<int>(f1 / binHz);
            k0 = clampT(k0, 0, K - 1); k1 = clampT(k1, k0, K - 1);
            float m = -140.f;
            for (int k = k0; k <= k1; ++k) m = std::max(m, p[static_cast<size_t>(k)]);
            bus->perfil[static_cast<size_t>(c)].store(m, std::memory_order_relaxed);
        }
    }

private:
    void aplicar(bool snap) {
        const Settings& s = s_;
        if (s.live != liveActual_) {
            liveActual_ = s.live;
            if (s.live) { for (auto& r : rep_) r.configure(12, 8); }
            else { for (auto& r : rep_) r.configure(static_cast<int>(0.010 * sr_), static_cast<int>(0.005 * sr_)); }
            for (auto& st : stft_) st.configure(s.live);
            latencia_ = rep_[0].latency() + stft_[0].latency();
            for (auto& d : dly_) std::fill(d.begin(), d.end(), 0.f);
            snap = true;
        }
        gIn_.setTarget(dbToLinear(s.inDb)); gOut_.setTarget(dbToLinear(s.outDb)); byp_.setTarget(s.bypass ? 0.0 : 1.0);
        if (snap) { gIn_.reset(gIn_.target()); gOut_.reset(gOut_.target()); byp_.reset(byp_.target()); }
        repP_.dcOn = s.dcOn; repP_.dcThresh = static_cast<float>(dbToLinear(s.dcThreshDb) * 0.995);   // tolerancia: un tope plano a exactamente el umbral cuenta repP_.dcStrength = clampT(s.dcStrength, 0.f, 1.f);
        repP_.clOn = s.clOn; repP_.clK = 25.f - 20.f * clampT(s.clSens, 0.f, 1.f);
        const int wMax = s.live ? 8 : static_cast<int>(0.005 * sr_);
        repP_.clW = clampT(static_cast<int>(s.clWidthMs * 0.001f * sr_), 2, wMax);
        hum_.setParams(s.humFreq, s.humHarm, s.humQ, s.humDepth);
        gate_.setParams(s.gateThresh, s.gateRatio, s.gateAttack, s.gateRelease, s.gateHold, s.gateHyst, s.gateHpf);
        espP_.dnOn = s.dnOn; espP_.learn = s.dnLearn; espP_.dnMode = s.dnMode;
        espP_.floor = static_cast<float>(dbToLinear(-s.dnReduction));
        espP_.alpha = 1.5f + 2.f * clampT(s.dnSmooth, 0.f, 1.f);
        espP_.aAtk = 0.7f - 0.4f * clampT(s.dnSmooth, 0.f, 1.f);
        espP_.aRel = 0.5f - 0.35f * clampT(s.dnSmooth, 0.f, 1.f);
        espP_.rvOn = s.rvOn;
        {
            const float a = clampT(s.rvAmount, 0.f, 1.f);
            const double hopS = stft_[0].N() / 4.0 / sr_;
            const int D = clampT(static_cast<int>(std::lround(0.05 / hopS)), 1, Espectral::kDmax);
            const double decay = std::exp(-6.9 * (D * hopS) * 1000.0 / std::max(50.f, s.rvTailMs));
            espP_.rvGamma = static_cast<float>(1.5 * a * decay);
            espP_.rvFloor = std::max(0.1f, 1.f - a);
        }
        espP_.viOn = s.viOn; espP_.viLowHz = s.viLow; espP_.viHighHz = s.viHigh; espP_.viDepthDb = s.viDepth;
        espP_.tsOn = s.tsOn; espP_.tsAmount = clampT(s.tsAmount, 0.f, 1.f);
        air_ = BiquadCoefs::design(FilterType::HighShelf, sr_, s.airFreq, s.airGain, 0.7071);
    }

    double sr_{48000.0};
    int maxBlock_{4096};
    Settings s_;
    bool liveActual_{false};
    int latencia_{0};
    ReparadorCanal rep_[2];
    ReparadorCanal::Params repP_;
    DeHum hum_;
    GateExpander gate_;
    Espectral stft_[2];
    Espectral::Params espP_;
    Diagnosticador diag_;
    std::vector<float> dly_[2];
    size_t dmask_{63}, dw_{0};
    BiquadCoefs air_;
    BiquadState airSt_[2];
    Smoother gIn_, gOut_, byp_;
    float reduccionDb_{0.f}, gateGr_{0.f};
    uint32_t ultimasTramas_{0};
};

} // namespace JasWaveDoctor
