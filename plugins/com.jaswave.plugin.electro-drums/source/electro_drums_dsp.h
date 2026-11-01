// =====================================================================================
//  JasWave Electro Drums - caja de ritmos electronica SINTETIZADA (sin SDK VST3; header-only, sin asignaciones en render)
//
//  Cero muestras: todo el sonido sale de osciladores, ruido y filtros propios (sin problemas de licencia).
//   - Bombo  : seno con barrido de tono exponencial + click + saturacion (tipo 808/909).
//   - Caja   : cuerpo tonal (2 senos con caida de tono) + ruido filtrado (HP/LP).   - Clap: rafagas de ruido BP + cola.
//   - Rimshot: 3 senos inarmonicos muy cortos + click.     - Hats: 6 cuadradas PolyBLEP (ratios 808) + ruido, HP/LP;
//     choke cerrado/pedal/abierto (fundido lineal de 4 ms, sin clic).   - Toms: seno con barrido (6 notas GM).
//   - Crash/ride/china/splash: metalico largo.   - Cowbell: 2 cuadradas.   - Shaker/cabasa/pandereta: ruido.
//   Velocidad = volumen Y timbre (barrido y click del bombo, brillo del ruido de la caja, corte de los hats...).
//   Determinista: el ruido sale de xorshift con semilla fija (por golpe: contador de golpes) y reset() lo reinicia.
//   Cadena: voces -> buses por grupo (nivel y pan) -> drive -> volumen -> lo-fi (solo kit 4) -> limitador suave -> FX Rack.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_fxrack.h"
#include "jw_params.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace JasWaveElectroDrums {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kKit = 0, kBypass = 1, kVolume = 2, kTune = 3, kDecay = 4, kDrive = 5,
    kKickLevel = 6, kSnareLevel = 7, kHatLevel = 8, kTomLevel = 9, kPercLevel = 10,
    kKickPan = 11, kSnarePan = 12, kHatPan = 13, kTomPan = 14, kPercPan = 15,
    kKickTune = 16, kKickDecay = 17, kKickSweep = 18, kKickDrive = 19, kKickClick = 20,
    kSnareTune = 21, kSnareSnap = 22, kHatDecay = 23, kTomTune = 24, kVariation = 25
};
enum Feature : int { kFeatKits = 0 };

constexpr int kMaxVoices = 32;
constexpr int kChunk = 256;
constexpr int kNumPads = 15;
constexpr double kTrim = 0.8;   // margen de mezcla fijo (-1.9 dB) antes del limitador suave
constexpr double kTwoPi = 6.283185307179586476925286766559;

inline const char* const* labelsKit() { static const char* const l[] = { "808", "909", "Techno duro", "Lo-fi" }; return l; }

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(withFeature(stepP(kKit, "Kit", 3, 0, labelsKit()), kFeatKits));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kTune, "Tune", "st", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kDecay, "Decay", "%", 50.0, 200.0, 100.0, 0));
        v.push_back(linearP(kDrive, "Drive", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kKickLevel, "Kick Lvl", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kSnareLevel, "Snare Lvl", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kHatLevel, "Hats Lvl", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kTomLevel, "Toms Lvl", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kPercLevel, "Perc Lvl", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kKickPan, "Kick Pan", "%", -100.0, 100.0, 0.0, 0, true));
        v.push_back(linearP(kSnarePan, "Snare Pan", "%", -100.0, 100.0, 0.0, 0, true));
        v.push_back(linearP(kHatPan, "Hats Pan", "%", -100.0, 100.0, 20.0, 0, true));
        v.push_back(linearP(kTomPan, "Toms Pan", "%", -100.0, 100.0, 0.0, 0, true));
        v.push_back(linearP(kPercPan, "Perc Pan", "%", -100.0, 100.0, -20.0, 0, true));
        v.push_back(logP(kKickTune, "Kick Tune", "Hz", 38.0, 90.0, 52.0, 1));
        v.push_back(linearP(kKickDecay, "Kick Decay", "%", 40.0, 250.0, 100.0, 0));
        v.push_back(linearP(kKickSweep, "Kick Sweep", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kKickDrive, "Kick Drive", "%", 0.0, 100.0, 20.0, 0));
        v.push_back(linearP(kKickClick, "Kick Click", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(logP(kSnareTune, "Snare Tune", "Hz", 140.0, 300.0, 200.0, 0));
        v.push_back(linearP(kSnareSnap, "Snare Snap", "%", 0.0, 100.0, 60.0, 0));
        v.push_back(linearP(kHatDecay, "Open Hat Decay", "%", 30.0, 250.0, 100.0, 0));
        v.push_back(linearP(kTomTune, "Tom Tune", "st", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kVariation, "Variation", "%", 0.0, 100.0, 25.0, 0));
        marcarBasicos(v, { kBypass, kVolume, kKit, kKickTune, kKickDecay, kSnareSnap });   // modo Basico del editor
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..)
        return v;
    }();
    return defs;
}

struct DrumSettings {
    int kit{0};
    double tuneSt{0.0}, decay{1.0}, drive{0.0}, volumeDb{0.0};
    double lvlDb[5]{ 0, 0, 0, 0, 0 };            // bombo, caja(+clap+rim), hats, toms, percusion (platos incluidos)
    double pan[5]{ 0.0, 0.0, 0.20, 0.0, -0.20 };  // -1..1
    double kickTuneHz{52.0}, kickDecay{1.0}, kickSweep{0.5}, kickDrive{0.2}, kickClick{0.4};
    double snareTuneHz{200.0}, snareSnap{0.6}, hatDecay{1.0}, tomTuneSt{0.0}, variation{0.25};
    bool bypass{false};
};

struct ElectroBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<float> pad[kNumPads]{};   // velocidad del ultimo golpe por pad (la UI lo consume con exchange)
};

// -------------------------------------------------------------------------------------
//  Utilidades
// -------------------------------------------------------------------------------------
enum Group { gKick = 0, gSnare = 1, gHat = 2, gTom = 3, gPerc = 4 };
enum Kind { kdKick, kdSnare, kdClap, kdRim, kdHat, kdTom, kdCymbal, kdCow, kdShaker, kdTamb };

// Mapa GM -> pad de la UI (-1 = fuera del mapa)
inline int padDeNota(int n) {
    switch (n) {
        case 35: case 36: return 0;
        case 38: case 40: return 1;
        case 39: return 2;
        case 37: return 3;
        case 42: return 4;
        case 46: return 5;
        case 44: return 6;
        case 41: case 43: return 7;
        case 45: case 47: return 8;
        case 48: case 50: return 9;
        case 49: case 57: case 52: case 55: return 10;
        case 51: case 59: case 53: return 11;
        case 56: return 12;
        case 70: case 69: case 82: return 13;
        case 54: return 14;
        default: return -1;
    }
}
inline bool notaEnMapa(int n) { return padDeNota(n) >= 0; }

struct Svf {   // SVF TPT (Zavalishin): lp/bp/hp a la vez
    double ic1{0}, ic2{0}, g{0}, k{1}, a1{0}, a2{0}, a3{0};
    double lp{0}, bp{0}, hp{0};
    void set(double fc, double q, double sr) {
        fc = std::min(std::max(fc, 20.0), sr * 0.45);
        g = std::tan(3.14159265358979323846 * fc / sr);
        k = 1.0 / q;
        a1 = 1.0 / (1.0 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    }
    void clear() { ic1 = ic2 = 0; lp = bp = hp = 0; }
    inline void tick(double v0) {
        const double v3 = v0 - ic2;
        const double v1 = a1 * ic1 + a2 * v3;
        const double v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2.0 * v1 - ic1; ic2 = 2.0 * v2 - ic2;
        lp = v2; bp = v1; hp = v0 - k * v1 - v2;
    }
};

inline double polyBlep(double t, double dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1.0; }
    if (t > 1.0 - dt) { t = (t - 1.0) / dt; return t * t + t + t + 1.0; }
    return 0.0;
}
inline double squareBlep(double ph, double inc) {
    double s = ph < 0.5 ? 1.0 : -1.0;
    s += polyBlep(ph, inc);
    double p2 = ph + 0.5; if (p2 >= 1.0) p2 -= 1.0;
    s -= polyBlep(p2, inc);
    return s;
}
inline double limitaSuave(double x) {   // transparente hasta 0.8; por encima, tanh hacia 1.0 (nunca satura duro)
    const double a = std::fabs(x);
    if (a <= 0.8) return x;
    const double y = 0.8 + 0.2 * std::tanh((a - 0.8) / 0.2);
    return x < 0 ? -y : y;
}

// -------------------------------------------------------------------------------------
//  Kits
// -------------------------------------------------------------------------------------
struct KitCfg {
    double kickF0Mul, kickSweep, kickPitchTau, kickTau, kickClick, kickDrive;
    double snBodyMul, snBodyTau, snNoiseHz, snNoiseTau, snBodyMix, snNoiseMix;
    double clapHz, clapTail;
    double hatHp, hatTauC, hatTauO, hatNoise;
    double tomSweep, tomTau;
    double cymHp, cymTau, cymNoise;
    double cowMul, shkHp;
};
inline const KitCfg& kitCfg(int k) {
    static const KitCfg kits[4] = {
        // 808: bombo largo y redondo, caja suelta, hats metalicos suaves
        { 1.00, 2.6, 0.034, 0.200, 0.55, 0.15,   0.90, 0.090, 1800.0, 0.110, 0.75, 0.80,   1100.0, 0.075,   7000.0, 0.030, 0.170, 0.12,   1.7, 0.140,   4500.0, 0.42, 0.45,   1.00, 5500.0 },
        // 909: bombo seco con mas click, caja chasqueante, hats brillantes
        { 1.10, 5.0, 0.014, 0.110, 1.00, 0.35,   1.10, 0.070, 2600.0, 0.150, 0.60, 1.00,   1300.0, 0.090,   8000.0, 0.040, 0.210, 0.30,   1.4, 0.110,   5500.0, 0.55, 0.60,   1.15, 6500.0 },
        // Techno duro: bombo con mucho drive y barrido rapido, caja compacta y agresiva
        { 1.00, 4.0, 0.018, 0.130, 0.90, 0.80,   1.00, 0.060, 3000.0, 0.090, 0.55, 1.00,   1500.0, 0.060,   8500.0, 0.025, 0.150, 0.35,   1.3, 0.090,   6000.0, 0.35, 0.65,   1.10, 7000.0 },
        // Lo-fi: apagado y corto, con reduccion de frecuencia y de bits en la salida
        { 1.15, 2.0, 0.030, 0.100, 0.35, 0.25,   0.95, 0.080, 1500.0, 0.100, 0.85, 0.70,   900.0, 0.065,   6000.0, 0.035, 0.130, 0.25,   1.6, 0.095,   3800.0, 0.30, 0.55,   0.95, 4800.0 }
    };
    return kits[k < 0 ? 0 : (k > 3 ? 3 : k)];
}

// Frecuencias (Hz) de las 6 cuadradas metalicas del hi-hat de la 808
constexpr double kMetal[6] = { 205.3, 304.4, 369.6, 522.7, 540.0, 800.0 };
// Afinacion base de los 6 toms GM (Hz)
inline double tomBaseHz(int note) {
    switch (note) { case 41: return 82.0; case 43: return 98.0; case 45: return 117.0; case 47: return 140.0; case 48: return 165.0; default: return 196.0; }
}
inline double tomPanOff(int note) {
    switch (note) { case 41: return -0.45; case 43: return -0.27; case 45: return -0.09; case 47: return 0.09; case 48: return 0.27; default: return 0.45; }
}

struct Voice {
    bool active{false}, fading{false};
    Kind kind{kdKick};
    int note{0}, group{0}, hat{-1}, age{0};
    uint64_t order{0};
    double vel{0}, gl{0}, gr{0}, fade{1}, fadeDec{0}, atk{0}, atkInc{0};
    uint32_t rng{1};
    double ph[6]{}, inc[6]{};
    double e1{0}, k1{1}, e2{0}, k2{1}, e3{0}, k3{1};
    double pe{0}, pk{1};
    double m[8]{};
    Svf s1, s2, s3;
    int burst[4]{}; double burstAmp[4]{};
    double smooth{0}, smoothK{0};
    inline double noise() {
        rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
        return static_cast<double>(static_cast<int32_t>(rng)) * 4.656612875245797e-10;
    }
};

// -------------------------------------------------------------------------------------
//  Motor
// -------------------------------------------------------------------------------------
class DrumEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        fx_.prepare(sr_);
        coefSmooth_ = 1.0 - std::exp(-1.0 / (0.010 * sr_));
        coefByp_ = 1.0 / (0.005 * sr_);
        reset();
        for (int g = 0; g < 5; ++g) lvl_[g] = std::pow(10.0, st_.lvlDb[g] / 20.0);
        for (int g = 0; g < 5; ++g) lvlTarget_[g] = lvl_[g];
        volCur_ = volTarget_ = std::pow(10.0, st_.volumeDb / 20.0);
        byp_ = st_.bypass ? 0.0 : 1.0;
    }
    void reset() {
        for (auto& v : voices_) v = Voice{};
        order_ = 0; hits_ = 0;
        holdCnt_ = 0; holdL_ = holdR_ = 0.0;
        fx_.reset();
    }
    void setSettings(const DrumSettings& s) {
        st_ = s;
        for (int g = 0; g < 5; ++g) lvlTarget_[g] = std::pow(10.0, s.lvlDb[g] / 20.0);
        volTarget_ = std::pow(10.0, s.volumeDb / 20.0);
        // el volumen y la bypass son suaves; el resto de parametros afectan a los golpes siguientes
    }
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    void setTempo(double bpm) { fx_.setTempo(bpm); }
    JasWaveFx::FxRack& fx() { return fx_; }
    int activeVoices() const { int n = 0; for (const auto& v : voices_) if (v.active) ++n; return n; }
    void allNotesOff() { for (auto& v : voices_) if (v.active) fadeOut(v, 0.004); }

    // note-off: las cajas de ritmos ignoran el fin de nota (disparo de un solo golpe)
    void noteOff(int) {}

    void noteOn(int note, float velIn) {
        if (note < 0 || note > 127 || velIn <= 0.0f || !notaEnMapa(note)) return;
        const double vel = std::min(1.0, std::max(0.0, static_cast<double>(velIn)));
        const uint64_t hit = ++hits_;
        const int pad = padDeNota(note);
        hit_[pad] = std::max(hit_[pad], static_cast<float>(vel));

        // --- choke y retrigger ---
        const bool esHat = (note == 42 || note == 44 || note == 46);
        for (auto& v : voices_) {
            if (!v.active || v.fading) continue;
            if (esHat && v.hat >= 0) fadeOut(v, 0.004);        // cualquier hat corta al anterior (cerrado/pedal corta al abierto)
            else if (v.note == note) fadeOut(v, 0.004);        // misma nota: el golpe viejo se funde (sin acumular fase)
        }
        // --- hueco: libre, o la voz mas antigua (con fundido) ---
        Voice* slot = nullptr;
        for (auto& v : voices_) if (!v.active) { slot = &v; break; }
        if (!slot) {
            for (auto& v : voices_) if (!slot || v.order < slot->order) slot = &v;
        }
        start(*slot, note, vel, hit);
    }

    template <class T>
    void render(T* outL, T* outR, int n, ElectroBus* bus) {
        ScopedNoDenormals nd;
        for (int off = 0; off < n; off += kChunk) renderChunk(outL + off, outR + off, std::min(kChunk, n - off));
        fx_.process(outL, outR, n, bus);
        if (bus) {
            bus->salida(outL, outR, n);
            float pk[2] = { 0, 0 };
            for (int i = 0; i < n; ++i) {
                pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i]))));
                pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i]))));
            }
            bus->outPk[0].update(pk[0]); bus->outPk[1].update(pk[1]);
            bus->activeVoices.store(activeVoices(), std::memory_order_relaxed);
            for (int p = 0; p < kNumPads; ++p) if (hit_[p] > 0.0f) bus->pad[p].store(hit_[p], std::memory_order_relaxed);
        }
        for (auto& h : hit_) h = 0.0f;
    }

private:
    static double clampd(double x, double a, double b) { return x < a ? a : (x > b ? b : x); }
    double coef(double tau) const { return std::exp(-1.0 / (std::max(tau, 1.0e-5) * sr_)); }
    void fadeOut(Voice& v, double secs) { v.fading = true; v.fadeDec = 1.0 / (secs * sr_); }

    void start(Voice& v, int note, double vel, uint64_t hit) {
        const KitCfg& K = kitCfg(st_.kit);
        v = Voice{};
        v.active = true; v.note = note; v.vel = vel; v.order = ++order_;
        v.rng = static_cast<uint32_t>(0x9E3779B9u ^ (static_cast<uint32_t>(note) * 0x85EBCA6Bu) ^ (static_cast<uint32_t>(hit) * 0xC2B2AE35u));
        if (!v.rng) v.rng = 1;
        for (int i = 0; i < 4; ++i) v.noise();
        const double tuneMul = std::pow(2.0, st_.tuneSt / 12.0);
        const double dec = st_.decay;
        // variacion sutil determinista (round-robin): tono +-0.6 % y nivel +-0.7 dB como maximo
        const double vr = st_.variation;
        const double pv = 1.0 + 0.006 * vr * v.noise();
        const double lv = std::pow(10.0, 0.7 * vr * v.noise() / 20.0);
        const double amp = std::pow(vel, 1.4) * lv;
        const double sr = sr_;
        double panOff = 0.0;
        v.atkInc = 1.0 / (0.0005 * sr);   // ataque de 0.5 ms (primera muestra = 0)

        switch (note) {
        case 35: case 36: {
            v.kind = kdKick; v.group = gKick;
            const double f0 = st_.kickTuneHz * K.kickF0Mul * tuneMul * pv;
            const double sweep = K.kickSweep * (st_.kickSweep / 0.5) * (0.65 + 0.35 * vel);
            v.inc[0] = f0 / sr;
            v.m[1] = f0 * sweep / sr;                // exceso de frecuencia inicial
            v.pe = 1.0; v.pk = coef(K.kickPitchTau);
            v.e1 = 1.0; v.k1 = coef(K.kickTau * st_.kickDecay * dec);
            v.e2 = 1.0; v.k2 = coef(0.0012);          // envolvente del click
            v.m[0] = st_.kickClick * K.kickClick * (0.25 + 0.75 * std::pow(vel, 1.5));
            v.m[2] = 1.0 + 12.0 * clampd(K.kickDrive * 0.5 + st_.kickDrive * 0.9, 0.0, 1.0) * (0.6 + 0.4 * vel);   // ganancia previa a tanh
            v.m[3] = 1.0 / std::tanh(v.m[2]);
            v.s1.set(2500.0, 0.7, sr);
            v.m[4] = amp * 1.0;
            break; }
        case 38: case 40: {
            v.kind = kdSnare; v.group = gSnare;
            const double alt = note == 40 ? 1.22 : 1.0;
            const double f1 = st_.snareTuneHz * K.snBodyMul * alt * tuneMul * pv;
            v.inc[0] = f1 / sr; v.inc[1] = f1 * 1.62 / sr;
            v.pe = 1.0; v.pk = coef(0.012);
            v.e1 = 1.0; v.k1 = coef(K.snBodyTau * dec);
            const double snap = st_.snareSnap;
            v.e2 = 1.0; v.k2 = coef(K.snNoiseTau * (0.55 + 0.9 * snap) * dec);
            v.s1.set(K.snNoiseHz * (0.75 + 0.5 * vel), 0.8, sr);   // mas velocidad = ruido mas brillante
            v.s2.set(std::min(11000.0, sr * 0.42), 0.7, sr);
            v.m[0] = K.snBodyMix * (note == 40 ? 0.7 : 1.0);
            v.m[1] = K.snNoiseMix * (0.30 + 0.85 * snap) * (0.7 + 0.3 * vel) * (note == 40 ? 1.25 : 1.0);
            v.m[4] = amp * 0.85;
            break; }
        case 39: {
            v.kind = kdClap; v.group = gSnare;
            v.s1.set(K.clapHz * (0.85 + 0.3 * vel), 1.5, sr);
            v.s2.set(450.0, 0.7, sr);
            const double gap = 0.0105 * sr;
            for (int i = 0; i < 4; ++i) {
                v.burst[i] = static_cast<int>(gap * i * (1.0 + 0.12 * v.noise()));   // difusion: separacion irregular pero fija
                v.burstAmp[i] = 1.0 - 0.07 * i;
            }
            v.burst[0] = 0;
            v.k1 = coef(0.0035);                       // rafagas
            v.k2 = coef(K.clapTail * dec);             // cola
            v.smoothK = 1.0 - std::exp(-1.0 / (0.0002 * sr));
            v.m[4] = amp * 1.5;
            panOff = 0.0;
            break; }
        case 37: {
            v.kind = kdRim; v.group = gSnare;
            const double f = 455.0 * tuneMul * pv;
            v.inc[0] = f / sr; v.inc[1] = f * 2.24 / sr; v.inc[2] = f * 3.74 / sr;
            v.e1 = 1.0; v.k1 = coef(0.007 * dec);
            v.e2 = 1.0; v.k2 = coef(0.0012);
            v.s1.set(3500.0, 0.7, sr);
            v.m[4] = amp * 1.0;
            panOff = 0.15;
            break; }
        case 42: case 44: case 46: {
            v.kind = kdHat; v.group = gHat;
            v.hat = note == 42 ? 0 : (note == 46 ? 1 : 2);
            const double hm = std::pow(2.0, st_.tuneSt / 24.0) * (1.0 + 0.004 * v.noise() * vr);
            for (int i = 0; i < 6; ++i) { v.inc[i] = kMetal[i] * hm / sr; v.ph[i] = 0.0; }
            const double tau = v.hat == 0 ? K.hatTauC : (v.hat == 1 ? K.hatTauO * st_.hatDecay : K.hatTauC * 1.5);
            v.e1 = 1.0; v.k1 = coef(tau * (v.hat == 1 ? 1.0 : dec));
            // segunda etapa (cuerpo de la cola) del abierto
            v.e2 = 1.0; v.k2 = coef(tau * 0.45);
            v.s1.set(K.hatHp * (0.85 + 0.3 * vel), 0.8, sr);
            v.s2.set(std::min(16000.0, sr * 0.42), 0.7, sr);
            v.m[0] = K.hatNoise;
            v.m[4] = amp * (v.hat == 2 ? 0.75 : 0.95);
            panOff = 0.0;
            break; }
        case 41: case 43: case 45: case 47: case 48: case 50: {
            v.kind = kdTom; v.group = gTom;
            const double f = tomBaseHz(note) * tuneMul * std::pow(2.0, st_.tomTuneSt / 12.0) * pv;
            v.inc[0] = f / sr; v.m[1] = f * K.tomSweep / sr; v.pe = 1.0; v.pk = coef(0.028);
            v.inc[1] = f * 1.58 / sr;
            const double lowBoost = 1.0 + 0.5 * (1.0 - (std::min(f, 220.0) - 82.0) / 138.0);   // los toms graves suenan mas
            v.e1 = 1.0; v.k1 = coef(K.tomTau * lowBoost * dec);
            v.e2 = 1.0; v.k2 = coef(0.040 * dec);
            v.e3 = 1.0; v.k3 = coef(0.003);
            v.s1.set(3000.0, 0.7, sr);
            v.m[4] = amp * 0.95;
            panOff = tomPanOff(note);
            break; }
        case 49: case 57: case 52: case 55: case 51: case 59: case 53: {
            v.kind = kdCymbal; v.group = gPerc;
            const bool ride = (note == 51 || note == 59 || note == 53);
            const bool bell = note == 53;
            double mul = ride ? 1.28 : 1.0, tau = K.cymTau, hp = K.cymHp, noiseMix = K.cymNoise;
            if (note == 57) { tau *= 0.8; hp *= 1.1; }
            if (note == 52) { tau *= 0.7; mul = 1.15; noiseMix *= 1.2; }       // china
            if (note == 55) { tau *= 0.32; hp *= 1.25; }                         // splash
            if (ride) { tau *= 0.85; noiseMix *= 0.4; hp *= 0.75; }
            if (note == 59) { tau *= 0.8; }
            if (bell) { mul = 2.1; tau *= 0.8; noiseMix *= 0.05; hp *= 0.7; }
            const double hm = std::pow(2.0, st_.tuneSt / 24.0);
            for (int i = 0; i < 6; ++i) v.inc[i] = kMetal[i] * 2.7 * mul * hm / sr;
            v.e1 = 1.0; v.k1 = coef(tau * dec);
            v.e2 = 1.0; v.k2 = coef(0.012);                                       // golpe de baqueta
            v.s1.set(hp, 0.7, sr);
            v.s2.set(std::min(16000.0, sr * 0.42), 0.7, sr);
            v.m[0] = noiseMix; v.m[1] = ride ? 0.6 : 0.0; v.m[2] = bell ? 1.0 : 0.0;
            v.m[4] = amp * (ride ? 0.80 : 0.75);
            panOff = ride ? 0.40 : -0.35;
            break; }
        case 56: {
            v.kind = kdCow; v.group = gPerc;
            const double m = K.cowMul * tuneMul * pv;
            v.inc[0] = 540.0 * m / sr; v.inc[1] = 800.0 * m / sr;
            v.e1 = 1.0; v.k1 = coef(0.014); v.e2 = 1.0; v.k2 = coef(0.150 * dec);
            v.s1.set(2640.0 * m, 1.4, sr);
            v.m[4] = amp * 1.0;
            panOff = -0.10;
            break; }
        case 54: {
            v.kind = kdTamb; v.group = gPerc;
            v.s1.set(7500.0, 0.9, sr); v.s2.set(5000.0, 0.7, sr);
            static const double j[4] = { 5100.0, 6300.0, 7400.0, 8900.0 };
            for (int i = 0; i < 4; ++i) v.inc[i] = j[i] * (1.0 + 0.003 * vr * v.noise()) / sr;
            v.e1 = 1.0; v.k1 = coef(0.100 * dec); v.e2 = 1.0; v.k2 = coef(0.030);
            v.m[4] = amp * 0.85;
            panOff = 0.25;
            break; }
        default: {   // 69 cabasa, 70 shaker, 82 shaker
            v.kind = kdShaker; v.group = gPerc;
            const bool cab = note == 69;
            v.s1.set(K.shkHp * (cab ? 1.15 : 1.0), 0.8, sr);
            v.s2.set(std::min(12000.0, sr * 0.42), 0.7, sr);
            v.e1 = 1.0; v.k1 = coef((cab ? 0.030 : 0.045) * dec);
            v.m[0] = 1.0 / (0.007 * sr);       // incremento del ataque lento (7 ms)
            v.m[4] = amp * 0.9;
            panOff = 0.15;
            break; }
        }
        // pan total = pan del grupo + desplazamiento propio (ley de potencia constante, -3 dB en el centro)
        const double p = clampd(st_.pan[v.group] + panOff, -1.0, 1.0);
        const double a = (p + 1.0) * 0.78539816339744830962;
        v.gl = std::cos(a); v.gr = std::sin(a);
    }

    // Un sample mono de la voz
    inline double tick(Voice& v) {
        double y = 0.0;
        const double att = std::min(1.0, v.age * v.atkInc);
        bool dead = false;
        switch (v.kind) {
        case kdKick: {
            v.pe *= v.pk;
            v.ph[0] += v.inc[0] + v.m[1] * v.pe;
            if (v.ph[0] >= 1.0) v.ph[0] -= std::floor(v.ph[0]);
            double s = std::sin(kTwoPi * v.ph[0]) * v.e1;
            v.e1 *= v.k1;
            if (v.m[2] > 1.05) s = std::tanh(v.m[2] * s) * v.m[3];
            if (v.m[0] > 0.0) {
                v.s1.tick(v.noise());
                s += v.m[0] * 0.9 * v.s1.hp * v.e2;
                v.e2 *= v.k2;
            }
            y = s * v.m[4];
            dead = v.e1 < 8.0e-5;
            break; }
        case kdSnare: {
            v.pe *= v.pk;
            const double d = 1.0 + 0.25 * v.pe;
            v.ph[0] += v.inc[0] * d; v.ph[1] += v.inc[1] * d;
            if (v.ph[0] >= 1.0) v.ph[0] -= std::floor(v.ph[0]);
            if (v.ph[1] >= 1.0) v.ph[1] -= std::floor(v.ph[1]);
            const double body = (std::sin(kTwoPi * v.ph[0]) + 0.5 * std::sin(kTwoPi * v.ph[1])) * v.e1 * 0.67;
            v.e1 *= v.k1;
            v.s1.tick(v.noise());
            v.s2.tick(v.s1.hp);
            const double nz = v.s2.lp * v.e2;
            v.e2 *= v.k2;
            y = (v.m[0] * body + v.m[1] * nz) * v.m[4];
            dead = v.e1 < 8.0e-5 && v.e2 < 8.0e-5;
            break; }
        case kdClap: {
            for (int i = 0; i < 4; ++i) if (v.age == v.burst[i]) {
                if (i < 3) v.e1 = v.burstAmp[i];
                else { v.e2 = v.burstAmp[3]; v.e1 = 0.0; }
            }
            const double target = v.e1 + v.e2;
            v.e1 *= v.k1; v.e2 *= v.k2;
            v.smooth += (target - v.smooth) * v.smoothK;
            v.s1.tick(v.noise());
            v.s2.tick(v.s1.bp * v.s1.k);
            y = v.s2.hp * 1.6 * v.smooth * v.m[4];
            dead = v.age > v.burst[3] && v.e2 < 8.0e-5 && v.e1 < 8.0e-5;
            break; }
        case kdRim: {
            for (int i = 0; i < 3; ++i) { v.ph[i] += v.inc[i]; if (v.ph[i] >= 1.0) v.ph[i] -= std::floor(v.ph[i]); }
            const double tones = (std::sin(kTwoPi * v.ph[0]) + 0.7 * std::sin(kTwoPi * v.ph[1]) + 0.5 * std::sin(kTwoPi * v.ph[2])) * v.e1 * 0.5;
            v.e1 *= v.k1;
            v.s1.tick(v.noise());
            const double click = v.s1.hp * v.e2 * 0.7; v.e2 *= v.k2;
            y = std::tanh(1.6 * (tones + click)) * 0.75 * v.m[4];
            dead = v.e1 < 8.0e-5 && v.e2 < 8.0e-5;
            break; }
        case kdHat: {
            double sq = 0.0;
            for (int i = 0; i < 6; ++i) {
                v.ph[i] += v.inc[i]; if (v.ph[i] >= 1.0) v.ph[i] -= 1.0;
                sq += squareBlep(v.ph[i], v.inc[i]);
            }
            const double in = sq * (1.0 / 6.0) * 1.6 + v.noise() * v.m[0];
            v.s1.tick(in);
            v.s2.tick(v.s1.hp);
            const double env = (v.hat == 1) ? (0.55 * v.e1 + 0.45 * v.e2) : v.e1;
            y = v.s2.lp * env * v.m[4] * 1.8;
            v.e1 *= v.k1; v.e2 *= v.k2;
            dead = (v.hat == 1 ? std::max(v.e1, v.e2) : v.e1) < 8.0e-5;
            break; }
        case kdTom: {
            v.pe *= v.pk;
            v.ph[0] += v.inc[0] + v.m[1] * v.pe;
            v.ph[1] += v.inc[1] + v.m[1] * 1.58 * v.pe;
            if (v.ph[0] >= 1.0) v.ph[0] -= std::floor(v.ph[0]);
            if (v.ph[1] >= 1.0) v.ph[1] -= std::floor(v.ph[1]);
            double s = std::sin(kTwoPi * v.ph[0]) * v.e1 + 0.18 * std::sin(kTwoPi * v.ph[1]) * v.e2;
            v.e1 *= v.k1; v.e2 *= v.k2;
            v.s1.tick(v.noise());
            s += 0.25 * v.s1.hp * v.e3; v.e3 *= v.k3;
            y = std::tanh(1.2 * s) * 0.9 * v.m[4];
            dead = v.e1 < 8.0e-5;
            break; }
        case kdCymbal: {
            double sq = 0.0;
            for (int i = 0; i < 6; ++i) {
                v.ph[i] += v.inc[i]; if (v.ph[i] >= 1.0) v.ph[i] -= std::floor(v.ph[i]);
                sq += squareBlep(v.ph[i], std::min(v.inc[i], 0.49));
            }
            double in = sq * (1.0 / 6.0) * (v.m[2] > 0.5 ? 1.2 : 0.9) + v.noise() * v.m[0];
            in += v.m[1] * v.noise() * v.e2 * 0.5;
            v.s1.tick(in);
            v.s2.tick(v.s1.hp);
            y = v.s2.lp * v.e1 * v.m[4] * 1.3;
            v.e1 *= v.k1; v.e2 *= v.k2;
            dead = v.e1 < 8.0e-5;
            break; }
        case kdCow: {
            v.ph[0] += v.inc[0]; if (v.ph[0] >= 1.0) v.ph[0] -= std::floor(v.ph[0]);
            v.ph[1] += v.inc[1]; if (v.ph[1] >= 1.0) v.ph[1] -= std::floor(v.ph[1]);
            const double sq = squareBlep(v.ph[0], v.inc[0]) + squareBlep(v.ph[1], v.inc[1]);
            v.s1.tick(sq * 0.5);
            const double env = 0.55 * v.e1 + 0.45 * v.e2;
            v.e1 *= v.k1; v.e2 *= v.k2;
            y = v.s1.bp * v.s1.k * env * v.m[4] * 1.1;
            dead = v.e2 < 8.0e-5;
            break; }
        case kdTamb: {
            double jing = 0.0;
            for (int i = 0; i < 4; ++i) { v.ph[i] += v.inc[i]; if (v.ph[i] >= 1.0) v.ph[i] -= 1.0; jing += squareBlep(v.ph[i], v.inc[i]); }
            const double in = v.noise() * 0.8 + jing * 0.12 * v.e2;
            v.s1.tick(in);
            v.s2.tick(v.s1.hp);
            y = v.s2.lp * v.e1 * v.m[4] * 1.8;
            v.e1 *= v.k1; v.e2 *= v.k2;
            dead = v.e1 < 8.0e-5;
            break; }
        case kdShaker: {
            v.s1.tick(v.noise());
            v.s2.tick(v.s1.hp);
            const double rise = std::min(1.0, (v.age + 1) * v.m[0]);
            y = v.s2.lp * v.e1 * rise * v.m[4] * 0.9;
            v.e1 *= v.k1;
            dead = v.e1 < 8.0e-5;
            break; }
        }
        y *= att;
        ++v.age;
        if (v.fading) {
            v.fade -= v.fadeDec;
            if (v.fade <= 0.0) { v.fade = 0.0; dead = true; }
            y *= v.fade;
        }
        if (dead || !(y == y)) v.active = false;
        return y;
    }

    void renderChunk(float* oL, float* oR, int n) { renderT(oL, oR, n); }
    void renderChunk(double* oL, double* oR, int n) { renderT(oL, oR, n); }

    template <class T>
    void renderT(T* oL, T* oR, int n) {
        const double driveG = 1.0 + 7.0 * st_.drive;
        const double driveN = st_.drive > 0.001 ? 1.0 / std::tanh(driveG) : 1.0;
        const bool lofi = st_.kit == 3;
        const int hold = std::max(1, static_cast<int>(std::lround(sr_ / 16000.0)));
        const double q = 512.0;   // 10 bits
        for (int i = 0; i < n; ++i) {
            double bl[5] = { 0, 0, 0, 0, 0 }, br[5] = { 0, 0, 0, 0, 0 };
            for (auto& v : voices_) {
                if (!v.active) continue;
                const double y = tick(v);
                bl[v.group] += y * v.gl; br[v.group] += y * v.gr;
            }
            double l = 0.0, r = 0.0;
            for (int g = 0; g < 5; ++g) {
                lvl_[g] += (lvlTarget_[g] - lvl_[g]) * coefSmooth_;
                l += bl[g] * lvl_[g]; r += br[g] * lvl_[g];
            }
            if (st_.drive > 0.001) { l = std::tanh(driveG * l) * driveN; r = std::tanh(driveG * r) * driveN; }
            volCur_ += (volTarget_ - volCur_) * coefSmooth_;
            l *= volCur_; r *= volCur_;
            if (lofi) {
                if (holdCnt_ <= 0) { holdL_ = std::round(l * q) / q; holdR_ = std::round(r * q) / q; holdCnt_ = hold; }
                --holdCnt_; l = holdL_; r = holdR_;
            }
            const double bt = st_.bypass ? 0.0 : 1.0;
            byp_ += clampd(bt - byp_, -coefByp_, coefByp_);
            l = limitaSuave(l * kTrim) * byp_; r = limitaSuave(r * kTrim) * byp_;
            oL[i] = static_cast<T>(l); oR[i] = static_cast<T>(r);
        }
    }

    double sr_{48000.0}, coefSmooth_{0.002}, coefByp_{0.01};
    DrumSettings st_;
    Voice voices_[kMaxVoices];
    uint64_t order_{0}, hits_{0};
    double lvl_[5]{ 1, 1, 1, 1, 1 }, lvlTarget_[5]{ 1, 1, 1, 1, 1 };
    double volCur_{1.0}, volTarget_{1.0}, byp_{1.0};
    int holdCnt_{0}; double holdL_{0}, holdR_{0};
    float hit_[kNumPads]{};
    JasWaveFx::FxRack fx_;
};

} // namespace JasWaveElectroDrums
