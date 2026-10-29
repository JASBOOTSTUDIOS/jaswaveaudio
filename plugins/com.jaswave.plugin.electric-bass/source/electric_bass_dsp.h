// =====================================================================================
//  JasWave Electric Bass – bajo eléctrico (Precision / Jazz) por guía de ondas de cuerda
//   - Karplus-Strong extendido: lazo de retardo con interpolación Lagrange de 4 puntos cuyo
//     retardo fraccional se resuelve con la FASE REAL del lazo en f0 (filtro de pérdidas de un polo
//     + all-pass de dispersión + Lagrange): afinación exacta (< 1 cent) en todo el registro.
//   - Pérdidas por filtro de un polo dependientes de la frecuencia; T60 del fundamental por nota.
//   - Rigidez de cuerda (all-pass de dispersión), posición del pulso (filtro peine), excitación de
//     dedo (pulso Hann + ruido) o púa/slap (pulso estrecho + chasquido) según velocidad y ATTACK.
//   - Pastilla: peine por posición (P a 0.14, J puente 0.085 / mástil 0.20) + resonancia LC.
//   - Ghost / palm-mute, apagado de cuerda al soltar (sin cortar), ruido de cuerda al soltar,
//     legato / hammer-on / pull-off con glissando, pitch bend ±2 st.
//   - Cadena: compresor paralelo RMS, saturación valvular asimétrica con sobremuestreo 2×
//     (halfband), tilt EQ, shelving de graves, filtro de tono, soft-clip.
//   Sin asignaciones ni rand() en el hilo de audio (PRNG xorshift por voz).
//   HÍBRIDO: si existen los bancos de muestras reales (electric-bass.jws = dedo y electric-bass-pick.jws = púa,
//   FreePats FingerBassYR / PickedBassYR, CC0) las notas E1..G4 suenan con ellos (mezcla dedo/púa con
//   FINGER ATTACK, brillo por velocidad, bajo monofónico con corte corto, hammer-on / pull-off y notas
//   fantasma) y atraviesan la misma cadena de tono/compresor/drive. Sin banco, el modelado sigue igual.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_fxrack.h"
#include "jw_params.h"
#include "jw_sampler.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace JasWaveElectricBass {

using namespace JasWaveDsp;
using namespace JasWaveVst;

// IDs 0..6 = los del manifiesto previo; 7.. nuevos
enum : uint32_t {
    kTone = 0, kFingerAttack = 1, kDrive = 2, kLowBoost = 3, kCompressorMix = 4, kBypass = 5, kVolume = 6,
    kPickup = 7, kPluckPos = 8, kSustain = 9, kMute = 10, kLegato = 11, kGlide = 12, kBend = 13,
    // Mezcla suave y redonda (se añaden al final: no rompen automatización ni presets)
    kLowCut = 14, kMidDb = 15, kMidHz = 16, kHighDb = 17, kTape = 18, kTune = 19
};
enum Feature : int { kFeatDrive = 0 };

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kTone, "Tone", "%", 0.0, 100.0, 28.0, 0));
        v.push_back(linearP(kFingerAttack, "Finger Attack", "%", 0.0, 100.0, 25.0, 0));
        v.push_back(withFeature(linearP(kDrive, "Tube Drive", "%", 0.0, 100.0, 3.0, 0), kFeatDrive));
        v.push_back(linearP(kLowBoost, "Sub Low Boost", "dB", 0.0, 12.0, 5.0, 1));
        v.push_back(linearP(kCompressorMix, "VCA Comp Mix", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kPickup, "Pickup P/J", "%", 0.0, 100.0, 15.0, 0));
        v.push_back(linearP(kPluckPos, "Pluck Position", "%", 0.0, 100.0, 55.0, 0));
        v.push_back(linearP(kSustain, "String Sustain", "%", 0.0, 100.0, 75.0, 0));
        v.push_back(linearP(kMute, "Palm Mute", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(toggleP(kLegato, "Legato", 1));
        v.push_back(linearP(kGlide, "Legato Glide", "ms", 0.0, 150.0, 40.0, 0));
        v.push_back(linearP(kBend, "Pitch Bend", "st", -2.0, 2.0, 0.0, 2, true));
        v.push_back(linearP(kLowCut, "Low Cut", "Hz", 20.0, 60.0, 28.0, 0));            // paso-altos suave: limpia el sub inaudible
        v.push_back(linearP(kMidDb, "Mid Gain", "dB", -9.0, 9.0, 0.0, 1, true));
        v.push_back(logP(kMidHz, "Mid Freq", "Hz", 200.0, 2500.0, 700.0, 0));
        v.push_back(linearP(kHighDb, "High Gain", "dB", -9.0, 9.0, -2.0, 1, true));
        v.push_back(linearP(kTape, "Tape Sat", "%", 0.0, 100.0, 22.0, 0));              // saturación de cinta sutil
        v.push_back(linearP(kTune, "Fine Tune", "cents", -50.0, 50.0, 0.0, 1, true));
        marcarBasicos(v, { kBypass, kVolume, kTone, kFingerAttack, kDrive, kLowBoost });   // modo Básico del editor
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..): EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura (tras la cadena propia)
        return v;
    }();
    return defs;
}

struct BassSettings {
    // Carácter por defecto: bajo de dedos profundo de worship (oscuro, redondo, sub presente, sin brillo de púa)
    double tone{0.28}, fingerAttack{0.25}, drive{0.03}, lowBoostDb{5.0}, compMix{0.5}, volumeDb{0.0};
    double pickupMix{0.15}, pluckPos{0.55}, sustain{0.75}, mute{0.0}, glideMs{40.0}, bendSt{0.0};
    double lowCutHz{28.0}, midDb{0.0}, midHz{700.0}, highDb{-2.0}, tape{0.22}, tuneCents{0.0};
    bool legato{true}, bypass{false};
};

struct BassBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<uint64_t> keys[2]{};   // notas sonando (MIDI 0..127)
};

constexpr int kMaxVoices = 6;
constexpr int kBufLen = 16384;         // potencia de 2: delay máx. ≈ 16380 muestras (f ≥ 12 Hz a 192 kHz)
constexpr int kBufMask = kBufLen - 1;
constexpr int kNoiseLen = 2048;
constexpr int kChunk = 16;             // periodo de control
constexpr int kHbTaps = 31;

namespace detail {
struct Rng {
    uint32_t s{0x2545F491u};
    inline uint32_t next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    inline double bip() { return static_cast<double>(static_cast<int32_t>(next())) * (1.0 / 2147483648.0); }
};
// Transformada de Fourier (módulo) de una ventana Hann unitaria de ancho W muestras a f ciclos/muestra
inline double hannMag(double fCycles, double W) {
    const double u = fCycles * W;
    const double sinc = std::fabs(u) < 1.0e-9 ? 1.0 : std::sin(kPi * u) / (kPi * u);
    const double den = 1.0 - u * u;
    if (std::fabs(den) < 1.0e-6) return 0.25 * W;
    return std::fabs(0.5 * W * sinc / den);
}
// Pesos Lagrange 3er orden para retardo d en [1,2] sobre nodos 0..3
inline void lagrange4(double d, double* h) {
    h[0] = -(d - 1.0) * (d - 2.0) * (d - 3.0) * (1.0 / 6.0);
    h[1] = d * (d - 2.0) * (d - 3.0) * 0.5;
    h[2] = -d * (d - 1.0) * (d - 3.0) * 0.5;
    h[3] = d * (d - 1.0) * (d - 2.0) * (1.0 / 6.0);
}
inline double hann(double t, double W) {
    if (t < 0.0 || t >= W) return 0.0;
    return 0.5 * (1.0 - std::cos(2.0 * kPi * t / W));
}
} // namespace detail

class BassEngine {
public:
    BassEngine() { designHalfband(); }

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        vol_.prepare(sr_, 20.0);  wet_.prepare(sr_, 8.0);
        mixSm_.prepare(sr_, 30.0); driveSm_.prepare(sr_, 30.0);
        pickSm_.prepare(sr_, 30.0); bendSm_.prepare(sr_, 15.0); attSm_.prepare(sr_, 30.0);
        attSm_.reset(s_.fingerAttack);
        smpPrepare();
        vol_.reset(dbToLinear(s_.volumeDb));
        wet_.reset(s_.bypass ? 0.0 : 1.0);
        mixSm_.reset(s_.compMix); driveSm_.reset(s_.drive); pickSm_.reset(s_.pickupMix); bendSm_.reset(s_.bendSt);
        killLen_ = std::max(16, static_cast<int>(0.005 * sr_));
        lvlDecay_ = 1.0 - 1.0 / (0.03 * sr_);
        slew_ = 1.0 - std::exp(-1.0 / (0.004 * sr_));
        compAtk_ = 1.0 - std::exp(-1.0 / (0.002 * sr_));
        pkRel_ = std::exp(-1.0 / (0.080 * sr_));
        compRel_ = 1.0 - std::exp(-1.0 / (0.150 * sr_));
        dcR_ = 1.0 - 2.0 * kPi * 18.0 / sr_;
        designChain();
        fx_.prepare(sr_);
        reset();
    }
    // FX Rack comun (jw_fxrack.h): se aplica DESPUES de toda la cadena propia del bajo (EQ/compresion extra de mezcla)
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    void setTempo(double bpm) { fx_.setTempo(bpm); }
    JasWaveFx::FxRack& fx() { return fx_; }
    void reset() {
        for (auto& v : voices_) v.active = false;
        for (auto& s : st_) s.reset();
        pkEnv_ = 0.0; grS_ = 0.0;
        dc1x_ = dc1y_ = dc2x_ = dc2y_ = 0.0;
        upBuf_.fill(0.0); dnBuf_.fill(0.0); upPos_ = dnPos_ = 0;
        bendNow_ = s_.bendSt + tuneSt_;
        bendSm_.reset(s_.bendSt);
        noteCounter_ = 0; order_ = 0;
        smpReset();
        fx_.reset();
    }
    void setSettings(const BassSettings& s) {
        s_ = s;
        vol_.setTarget(dbToLinear(s.volumeDb));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        mixSm_.setTarget(s.compMix); driveSm_.setTarget(s.drive); pickSm_.setTarget(s.pickupMix);
        bendSm_.setTarget(clampT(s.bendSt + extBend_, -2.0, 2.0));
        attSm_.setTarget(s.fingerAttack);
        tuneSt_ = s.tuneCents * 0.01;
        designChain();
        smpRelNormal();   // release y cola sostenida dependen de String Sustain y Palm Mute
    }

    // ---------------------------------------------------------------- notas
    void noteOn(int note, float velIn) {
        if (note < 12 || note > 96) return;
        if (velIn <= 0.0f) { noteOff(note); return; }
        const double vel = clampT(static_cast<double>(velIn), 0.0, 1.0);
        if (smpF_.ready() && note >= kSmpLo && note <= kSmpHi) { smpNoteOn(note, vel); return; }
        onModel_[static_cast<size_t>(note)] = true;
        // misma nota ya sonando (pulsada): se apaga con fundido y se vuelve a pulsar
        for (auto& v : voices_) if (v.active && !v.killing && v.note == note && v.keyDown) { startKill(v, note, vel); return; }
        // legato: hay una nota sujeta, sonando desde hace > 30 ms (no es un acorde / doble cuerda)
        if (s_.legato) {
            Voice* c = nullptr;
            for (auto& v : voices_) {
                if (!v.active || v.killing || !v.keyDown || v.stackN >= 4) continue;
                if (v.age < static_cast<int64_t>(0.030 * sr_) || std::abs(v.note - note) > 7 || v.note == note) continue;
                if (!c || v.order > c->order) c = &v;
            }
            if (c) { legatoTo(*c, note, vel, true); return; }
        }
        Voice* freeV = nullptr;
        for (auto& v : voices_) if (!v.active) { freeV = &v; break; }
        if (freeV) { start(*freeV, note, vel); return; }
        Voice* victim = nullptr;
        for (auto& v : voices_) if (!v.killing && (!victim || v.order < victim->order)) victim = &v;
        if (victim) { startKill(*victim, note, vel); return; }
        for (auto& v : voices_) if (v.killing) { v.pendingNote = note; v.pendingVel = vel; return; }
    }
    void noteOff(int note) {
        if (note >= 0 && note < 128) {
            smpNoteOff(note);
            if (!onModel_[static_cast<size_t>(note)]) return;
            onModel_[static_cast<size_t>(note)] = false;
        }
        for (auto& v : voices_) {
            if (!v.active || v.killing) continue;
            if (v.keyDown && v.note == note) {
                if (s_.legato && v.stackN > 0) {            // pull-off a la nota anterior que sigue sujeta
                    const int prev = v.stackNote[v.stackN - 1];
                    const double pv = v.stackVel[v.stackN - 1];
                    --v.stackN;
                    legatoTo(v, prev, pv, false);
                } else release(v);
            } else {
                for (int i = 0; i < v.stackN; ++i)
                    if (v.stackNote[i] == note) {
                        for (int k = i; k + 1 < v.stackN; ++k) { v.stackNote[k] = v.stackNote[k + 1]; v.stackVel[k] = v.stackVel[k + 1]; }
                        --v.stackN;
                        break;
                    }
            }
        }
    }
    void allNotesOff() {
        smpReleaseAll(1.0f);
        onModel_.fill(false);
        for (auto& v : voices_) if (v.active && !v.killing && v.keyDown) { v.stackN = 0; release(v); }
    }
    void panic() {
        smpReleaseAll(0.12f);
        onModel_.fill(false);
        for (auto& v : voices_) if (v.active && !v.killing) startKill(v, -1, 0.0);
    }
    bool samplerReady() const { return smpF_.ready(); }
    bool samplerLoading() const { return smpF_.loading() || smpP_.loading(); }
    // Pitch bend en semitonos (se suma al parámetro Pitch Bend)
    void setBend(double st) { extBend_ = clampT(st, -2.0, 2.0); bendSm_.setTarget(clampT(s_.bendSt + extBend_, -2.0, 2.0)); }

    // ---------------------------------------------------------------- render
    template <class T>
    void render(T* outL, T* outR, int n, BassBus* bus) {
        double mix[kChunk];
        float pk[2] = { 0, 0 };
        int pos = 0;
        while (pos < n) {
            const int nb = std::min(kChunk, n - pos);
            bendNow_ = bendSm_.advance(nb) + tuneSt_;
            const double pm = pickSm_.advance(nb);
            const double wP = 1.0 - pm, wJ = pm;
            const double v0 = vol_.current(), v1 = vol_.advance(nb), w0 = wet_.current(), w1 = wet_.advance(nb);
            const double cm = mixSm_.advance(nb), dr = driveSm_.advance(nb);
            for (int i = 0; i < nb; ++i) mix[i] = 0.0;
            for (auto& v : voices_) if (v.active) voiceChunk(v, mix, nb, wP, wJ);
            double smp[kChunk];
            smpChunk(smp, nb, pm);
            const double kDrv = 0.25 + 9.0 * std::pow(dr, 1.5), biasDrv = 0.6 * dr;
            const double mkDrv = 1.0 / ((1.0 + 1.1 * std::pow(dr, 1.3)) * (1.0 + 1.1 * std::pow(dr, 2.5)));
            const double normDrv = mkDrv * 0.35 / std::max(1.0e-6, std::tanh(kDrv * 0.35 + biasDrv) - std::tanh(biasDrv));
            const double tb = std::tanh(biasDrv);
            for (int i = 0; i < nb; ++i) {
                const double t = static_cast<double>(i + 1) / nb;
                const double g = (v0 + (v1 - v0) * t) * (w0 + (w1 - w0) * t);
                double x = mix[i];
                // pastilla: saturación magnética suave + resonancia LC + DC/subsónico
                x = x / std::sqrt(1.0 + 0.2 * x * x);
                x = biquadProcess(pkBody_, st_[6], x);
                x = biquadProcess(pkBell_, st_[0], x);
                x = biquadProcess(pkLp_, st_[1], x);
                x += smp[i];   // muestras reales: ya llevan su propia pastilla, no pasan por el peine ni el paso bajo del modelado
                { const double y = x - dc1x_ + dcR_ * dc1y_; dc1x_ = x; dc1y_ = y; x = y; }
                // compresor paralelo (detector de pico con ataque instantáneo, ganancia suavizada en dB)
                { const double a = std::fabs(x); pkEnv_ = a > pkEnv_ ? a : pkEnv_ * pkRel_; }
                const double envDb = 20.0 * std::log10(pkEnv_ + 1.0e-9);
                const double over = envDb - kThr;
                double gr = 0.0;
                if (2.0 * over > kKnee) gr = (1.0 / kRatio - 1.0) * over;
                else if (2.0 * over > -kKnee) { const double q = over + kKnee * 0.5; gr = (1.0 / kRatio - 1.0) * q * q / (2.0 * kKnee); }
                grS_ += (gr - grS_) * (gr < grS_ ? compAtk_ : compRel_);
                x *= (1.0 - cm) + cm * std::exp(grS_ * 0.115129254649702 * 0.6);   // maquillaje: recupera el 40 % de la reducción
                // saturación valvular asimétrica con sobremuestreo 2×
                double u0, u1;
                upsample(x, u0, u1);
                u0 = (std::tanh(kDrv * u0 + biasDrv) - tb) * normDrv;
                u1 = (std::tanh(kDrv * u1 + biasDrv) - tb) * normDrv;
                x = downsample(u0, u1);
                { const double y = x - dc2x_ + dcR_ * dc2y_; dc2x_ = x; dc2y_ = y; x = y; }
                // tilt EQ + tono + shelving de graves
                if (s_.tape > 1.0e-4) { const double y = std::tanh(2.5 * x) / 2.5; x += s_.tape * (y - x); }   // cinta: compresión suave de picos
                x = biquadProcess(bump_, st_[11], x);
                x = biquadProcess(tiltLo_, st_[2], x);
                x = biquadProcess(tiltHi_, st_[3], x);
                x = biquadProcess(toneLp_, st_[4], x);
                x = biquadProcess(sub_, st_[5], x);
                x = biquadProcess(mid_, st_[8], x);
                x = biquadProcess(high_, st_[9], x);
                x = biquadProcess(lowCut_, st_[10], x);   // corte de sub (< ~30 Hz), después del realce de graves
                x *= g;
                x = softClip(x);
                outL[pos + i] = static_cast<T>(x);
                outR[pos + i] = static_cast<T>(x);
                pk[0] = std::max(pk[0], static_cast<float>(std::fabs(x)));
            }
            // fin de chunk: vida de las voces
            for (auto& v : voices_) {
                if (!v.active) continue;
                v.age += nb;
                if (v.killing && v.env <= 0.0) {
                    v.active = false;
                    if (v.pendingNote >= 0) { const int pn = v.pendingNote; v.pendingNote = -1; start(v, pn, v.pendingVel); }
                    continue;
                }
                if (v.lvl < 1.0e-6 && v.exI >= v.exN && v.thEnv * v.thAmp < 1.0e-6 && v.age > static_cast<int64_t>(2.0 * v.T) + 64) v.active = false;
            }
            smpAfterChunk(nb);
            pos += nb;
        }
        pk[1] = pk[0];
        if (fx_.activo()) {   // el rack puede cambiar nivel y anchura: los picos se miden despues
            fx_.process(outL, outR, n, bus);
            pk[0] = pk[1] = 0.0f;
            for (int i = 0; i < n; ++i) { pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i])))); pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i])))); }
        } else fx_.process(outL, outR, n, bus);   // apagado: no toca el buffer (solo publica GR = 0)
        if (bus) {
            bus->salida(outL, outR, n);
            bus->outPk[0].update(pk[0]);
            bus->outPk[1].update(pk[1]);
            uint64_t k0 = 0, k1 = 0;
            int act = std::max(smpF_.activeVoices(), smpP_.activeVoices());
            for (int n = kSmpLo; n <= kSmpHi; ++n)
                if (smpSounding_[static_cast<size_t>(n)]) { if (n < 64) k0 |= 1ull << n; else k1 |= 1ull << (n - 64); }
            for (const auto& v : voices_) {
                if (!v.active) continue;
                ++act;
                if (v.note < 64) k0 |= 1ull << v.note; else k1 |= 1ull << (v.note - 64);
            }
            bus->keys[0].store(k0, std::memory_order_relaxed);
            bus->keys[1].store(k1, std::memory_order_relaxed);
            bus->activeVoices.store(act, std::memory_order_relaxed);
        }
    }

    int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a; }
    double sampleRate() const { return sr_; }
    static double noteHz(int note) { return 440.0 * std::pow(2.0, (note - 69) / 12.0); }

private:
    static constexpr double kThr = -24.0, kRatio = 3.0, kKnee = 12.0;   // compresor suave

    struct Voice {
        bool active{false}, keyDown{false}, released{false}, killing{false};
        int note{-1}, stackN{0}, pendingNote{-1};
        int stackNote[4]{};
        double stackVel[4]{};
        double pendingVel{0.0};
        int64_t age{0}, order{0};
        double semi{40.0}, semiTarget{40.0}, glideCoef{0.1}, fApplied{0.0}, T{1000.0};
        int w{0}, n0{1};
        double h[4]{1.0, 0.0, 0.0, 0.0};
        double lpB{0.5}, lp{0.0}, lpG{0.999}, dispA{-0.1}, dispZ{0.0}, dampG{1.0}, dampT{1.0};
        double t60{3.0}, fcStr{2000.0}, fund{0.3};
        double env{1.0}, killStep{0.0}, lvl{1.0};
        double vel{0.7}, mute{0.0}, ghost{0.0}, mg{1.0};
        bool layer{false};   // capa de cuerpo bajo una nota de muestras (registro agudo)
        // excitación
        int exI{0}, exN{0}, nbN{0};
        double exA{0.0}, exWp{100.0}, exWs{10.0}, exClick{0.0}, exDp{100.0}, exNz{0.0};
        // transitorio de dedo (fuera del lazo) y ruido al soltar
        double thEnv{0.0}, thDecay{0.99}, thAmp{0.0}, thC{0.1}, thZ1{0.0}, thZ2{0.0}, thNorm{1.0};
        int rnLeft{0};
        double rnAmp{0.0}, rnEnv{0.0}, rnDecay{0.99}, rnZ{0.0}, rnC{0.3};
        detail::Rng rng;
        double nb[kNoiseLen]{};
        double buf[kBufLen]{};
        float yh[kBufLen]{};
    };

    // ---------------------------------------------------------------- cadena
    void designChain() {
        const double sr = sr_;
        const double pm = s_.pickupMix;
        pkBody_ = BiquadCoefs::design(FilterType::LowShelf, sr, 120.0, 4.0, 0.7);
        pkBell_ = BiquadCoefs::design(FilterType::Bell, sr, 700.0, 3.0 - 5.0 * pm, 0.9);
        pkLp_ = BiquadCoefs::design(FilterType::LowPass, sr, 3000.0 + 1600.0 * pm, 0.0, 0.8 + 0.3 * pm);
        const double t = (s_.tone - 0.5) * 2.0;
        tiltLo_ = BiquadCoefs::design(FilterType::LowShelf, sr, 650.0, -6.0 * t, 0.6);
        tiltHi_ = BiquadCoefs::design(FilterType::HighShelf, sr, 650.0, 6.0 * t, 0.6);
        const double fc = s_.tone >= 0.5 ? 20000.0 : 3500.0 * std::pow(20000.0 / 3500.0, s_.tone / 0.5);
        toneLp_ = BiquadCoefs::design(FilterType::LowPass, sr, fc, 0.0, 0.707);
        sub_ = BiquadCoefs::design(FilterType::LowShelf, sr, 110.0, s_.lowBoostDb, 0.707);
        lowCut_ = BiquadCoefs::design(FilterType::HighPass, sr, clampT(s_.lowCutHz, 15.0, 80.0), 0.0, 0.6);
        mid_ = BiquadCoefs::design(FilterType::Bell, sr, clampT(s_.midHz, 100.0, 4000.0), s_.midDb, 0.8);
        high_ = BiquadCoefs::design(FilterType::HighShelf, sr, 4500.0, s_.highDb, 0.7);
        bump_ = BiquadCoefs::design(FilterType::Bell, sr, 70.0, 2.0 * s_.tape, 0.8);   // "head bump" de la cinta
    }
    static double softClip(double x) {
        const double a = std::fabs(x);
        if (a <= 0.65) return x;
        const double y = 0.65 + 0.30 * std::tanh((a - 0.65) / 0.30);
        return x < 0 ? -y : y;
    }
    void designHalfband() {
        // FIR de media banda (corte fs_up/4) con ventana Kaiser β = 8, ganancia DC unitaria
        auto i0 = [](double x) { double s = 1.0, t = 1.0; for (int k = 1; k < 60; ++k) { t *= (x / (2.0 * k)) * (x / (2.0 * k)); s += t; } return s; };
        const int c = (kHbTaps - 1) / 2;
        double sum = 0.0;
        for (int i = 0; i < kHbTaps; ++i) {
            const double u = (i - c) * 0.5;
            const double sn = (i == c) ? 1.0 : std::sin(kPi * u) / (kPi * u);
            const double r = static_cast<double>(i - c) / c;
            hb_[static_cast<size_t>(i)] = 0.5 * sn * i0(8.0 * std::sqrt(std::max(0.0, 1.0 - r * r))) / i0(8.0);
            sum += hb_[static_cast<size_t>(i)];
        }
        for (auto& h : hb_) h /= sum;
        nzN_ = 0;
        for (int i = 0; i < kHbTaps; ++i) if (i == c || (i - c) % 2 != 0) nz_[nzN_++] = i; else hb_[static_cast<size_t>(i)] = 0.0;
    }
    inline double firDot(const std::array<double, 2 * kHbTaps>& b, int pos) const {
        double a = 0.0;
        for (int j = 0; j < nzN_; ++j) { const int k = nz_[j]; a += hb_[static_cast<size_t>(k)] * b[static_cast<size_t>(pos + k)]; }
        return a;
    }
    inline void pushUp(double x) {
        upPos_ = (upPos_ + kHbTaps - 1) % kHbTaps;
        upBuf_[static_cast<size_t>(upPos_)] = x;
        upBuf_[static_cast<size_t>(upPos_ + kHbTaps)] = x;
    }
    inline void upsample(double x, double& y0, double& y1) {
        pushUp(2.0 * x);  y0 = firDot(upBuf_, upPos_);
        pushUp(0.0);      y1 = firDot(upBuf_, upPos_);
    }
    inline double downsample(double a, double b) {
        dnPos_ = (dnPos_ + kHbTaps - 1) % kHbTaps;
        dnBuf_[static_cast<size_t>(dnPos_)] = a; dnBuf_[static_cast<size_t>(dnPos_ + kHbTaps)] = a;
        dnPos_ = (dnPos_ + kHbTaps - 1) % kHbTaps;
        dnBuf_[static_cast<size_t>(dnPos_)] = b; dnBuf_[static_cast<size_t>(dnPos_ + kHbTaps)] = b;
        return firDot(dnBuf_, dnPos_);
    }

    // ---------------------------------------------------------------- voces
    void startKill(Voice& v, int pendingNote, double vel) {
        v.killing = true;
        v.killStep = std::max(1.0e-9, v.env / killLen_);
        v.pendingNote = pendingNote;
        v.pendingVel = vel;
    }
    void release(Voice& v) {
        v.keyDown = false;
        v.released = true;
        const double f = v.fApplied > 1.0 ? v.fApplied : 100.0;
        const double t60 = 0.22 * (1.0 - 0.6 * std::max(s_.mute, v.mute));
        v.dampT = std::pow(10.0, -3.0 / (t60 * f));
        if (v.age > static_cast<int64_t>(0.06 * sr_)) {          // ruido de cuerda al soltar
            v.rnLeft = static_cast<int>(0.012 * sr_);
            v.rnEnv = 1.0;
            v.rnDecay = std::exp(-1.0 / (0.004 * sr_));
            v.rnAmp = v.fund * 0.05 * (0.4 + 0.6 * s_.fingerAttack) * (1.0 - 0.7 * std::max(s_.mute, v.mute));
            v.rnC = 1.0 - std::exp(-2.0 * kPi * 2500.0 / sr_);
        }
    }

    // Resuelve el lazo para la frecuencia f (compensación exacta de fase en f0)
    void updateLoop(Voice& v, double f) {
        f = clampT(f, sr_ / 16000.0, sr_ * 0.2);
        const double w0 = 2.0 * kPi * f / sr_;
        const double T = sr_ / f;
        const double b = v.lpB;
        const double sw = std::sin(w0), cw = std::cos(w0);
        const double hMag = (1.0 - b) / std::sqrt(std::max(1.0e-12, 1.0 - 2.0 * b * cw + b * b));
        const double L0 = std::pow(10.0, -3.0 / (v.t60 * f));
        v.lpG = std::min(0.99995, L0 / hMag);
        const double tauLp = std::atan2(b * sw, 1.0 - b * cw) / w0;
        v.dispA = -(0.05 + 0.10 * clampT(f / 500.0, 0.0, 1.0));
        const double tauD = 1.0 - 2.0 * std::atan2(v.dispA * sw, 1.0 + v.dispA * cw) / w0;
        double Dbuf = T - tauLp - tauD;
        if (Dbuf < 4.0) Dbuf = 4.0;
        if (Dbuf > kBufLen - 8) Dbuf = kBufLen - 8;
        v.n0 = static_cast<int>(std::floor(Dbuf)) - 1;
        const double dt = Dbuf - v.n0;
        double d = dt;
        for (int it = 0; it < 4; ++it) {
            double h[4];
            detail::lagrange4(d, h);
            double re = 0.0, im = 0.0;
            for (int k = 0; k < 4; ++k) { re += h[k] * std::cos(w0 * k); im -= h[k] * std::sin(w0 * k); }
            const double tau = -std::atan2(im, re) / w0;
            d += dt - tau;
        }
        detail::lagrange4(d, v.h);
        v.T = T;
        v.fApplied = f;
    }

    void controlUpdate(Voice& v) {
        if (v.semi != v.semiTarget) {
            v.semi += (v.semiTarget - v.semi) * v.glideCoef;
            if (std::fabs(v.semiTarget - v.semi) < 1.0e-4) v.semi = v.semiTarget;
        }
        const double f = 440.0 * std::exp2((v.semi + bendNow_ - 69.0) / 12.0);
        if (std::fabs(f - v.fApplied) > v.fApplied * 5.0e-6) updateLoop(v, f);
    }

    // Parámetros tímbricos de la nota (T60, pérdidas, dureza, mute / ghost). Devuelve la dureza.
    double configureNote(Voice& v, double vel, double f0) {
        const double att = s_.fingerAttack;
        v.vel = vel;
        v.ghost = clampT((0.26 - vel) / 0.14, 0.0, 1.0);
        v.mute = clampT(std::max(s_.mute, 0.85 * v.ghost), 0.0, 1.0);
        const double v1 = std::pow(vel, 0.9);
        const double hard = clampT(0.55 * v1 + 0.45 * att, 0.0, 1.0) * (1.0 - 0.45 * v.mute) * (1.0 + 0.04 * v.rng.bip());
        const double sb = clampT(0.25 + 0.55 * hard, 0.0, 1.0);
        v.t60 = std::max(0.05, (2.0 + 16.0 * s_.sustain) * std::pow(110.0 / f0, 0.35) * (1.0 - 0.85 * v.mute));   // 75 %: T60 ≈ 14-16 s en el grave (redonda de 8 s sin apagarse)
        v.fcStr = (500.0 + 2600.0 * sb) * (1.0 - 0.75 * v.mute);
        v.lpB = clampT(std::exp(-2.0 * kPi * v.fcStr / sr_), 0.0, 0.98);
        return clampT(hard, 0.0, 1.0);
    }

    // Prepara la excitación (pulso de dedo/púa + ruido + transitorio) con amplitud relativa ampScale
    void armExcitation(Voice& v, double hard, double f0, double ampScale) {
        const double att = s_.fingerAttack;
        const double v1 = std::pow(v.vel, 0.9);
        const double T = sr_ / f0;
        v.exWp = (5.5 * (1.0 - hard) + 0.60 * hard) * 1.0e-3 * sr_;
        v.exWs = 0.25e-3 * sr_;
        v.exClick = 0.9 * hard * hard;
        const double pp = (0.10 + 0.40 * s_.pluckPos) * (1.0 + 0.03 * v.rng.bip());
        v.exDp = pp * T;
        const double F = 0.128 * std::pow(f0 / 55.0, 0.3) * (0.10 + 0.90 * std::pow(v1, 1.3)) * ampScale;   // compensa la caída de nivel hacia el agudo
        v.fund = F;
        const double fc = f0 / sr_;
        const double E1 = detail::hannMag(fc, v.exWp) + v.exClick * detail::hannMag(fc, v.exWs);
        const double sinF = std::max(0.35, 2.0 * std::sin(kPi * pp));
        v.exA = F * T / (2.0 * std::max(1.0e-6, E1) * sinF);
        // ráfaga de ruido de dedo (filtrada, con envolvente), inyectada en el lazo
        v.nbN = clampT(static_cast<int>((0.003 + 0.012 * att) * sr_), 8, kNoiseLen - 2);
        const double c = 1.0 - std::exp(-2.0 * kPi * 2500.0 / sr_);
        const double nrm = 1.0 / std::sqrt(c * 0.5);
        double z = 0.0;
        for (int i = 0; i < v.nbN; ++i) {
            z += c * (v.rng.bip() - z);
            const double e = std::exp(-4.0 * i / v.nbN) * (1.0 - static_cast<double>(i) / v.nbN);
            v.nb[i] = z * nrm * 0.5 * e;
        }
        v.exNz = (0.10 + 0.55 * att) * (0.4 + 0.6 * v1) * (1.0 + v.ghost);
        v.exI = 0;
        v.exN = static_cast<int>(std::ceil(std::max(v.exWp, static_cast<double>(v.nbN)) + v.exDp)) + 2;
        // transitorio de dedo fuera del lazo
        v.thC = 1.0 - std::exp(-2.0 * kPi * (500.0 + 900.0 * att) / sr_);
        v.thNorm = 1.0 / std::sqrt(v.thC * 0.5);
        v.thDecay = std::exp(-1.0 / (sr_ * (0.004 + 0.010 * att + 0.006 * v.mute)));
        v.thEnv = 1.0;
        v.thAmp = F * 0.9 * (0.15 + 0.50 * att) * (0.3 + 0.7 * v1) * (1.0 + 1.2 * v.ghost) * (1.0 - 0.3 * v.mute) * ampScale * 0.6;
    }

    void start(Voice& v, int note, double vel, double mg = 1.0, bool layer = false) {
        v.mg = mg; v.layer = layer;
        v.active = true; v.keyDown = true; v.released = false; v.killing = false;
        v.note = note; v.stackN = 0; v.pendingNote = -1; v.pendingVel = 0.0;
        v.age = 0; v.order = ++order_;
        v.rng.s = 0x9E3779B9u ^ (static_cast<uint32_t>(note) * 2654435761u) ^ (++noteCounter_ * 40503u + 1u);
        if (v.rng.s == 0) v.rng.s = 1;
        v.rng.next(); v.rng.next();
        const double detune = 0.012 * v.rng.bip();                       // ±1.2 cents de microdesafinación
        v.semi = v.semiTarget = note + detune;
        v.glideCoef = 0.1;
        std::fill(v.buf, v.buf + kBufLen, 0.0);
        std::fill(v.yh, v.yh + kBufLen, 0.0f);
        v.w = 0; v.lp = 0.0; v.dispZ = 0.0; v.dampG = 1.0; v.dampT = 1.0;
        v.env = 1.0; v.killStep = 0.0; v.lvl = 1.0;
        v.rnLeft = 0; v.rnEnv = 0.0; v.rnZ = 0.0; v.thZ1 = v.thZ2 = 0.0;
        const double f0 = 440.0 * std::exp2((v.semi + bendNow_ - 69.0) / 12.0);
        const double hard = configureNote(v, vel, f0);
        updateLoop(v, f0);
        armExcitation(v, hard, v.fApplied, 1.0);
    }

    // Legato / hammer-on (up=true) o pull-off (up=false) sobre una cuerda que ya suena
    void legatoTo(Voice& v, int note, double vel, bool push) {
        if (push) {
            v.stackNote[v.stackN] = v.note;
            v.stackVel[v.stackN] = v.vel;
            ++v.stackN;
        }
        const bool hammer = push;
        v.note = note;
        v.keyDown = true; v.released = false; v.dampT = 1.0;
        v.order = ++order_;
        v.semiTarget = note + v.semiTarget - std::floor(v.semiTarget + 0.5);   // conserva la microdesafinación
        const double glide = std::max(3.0, s_.glideMs);
        v.glideCoef = 1.0 - std::exp(-static_cast<double>(kChunk) / (sr_ * glide * 0.001 / 3.0));
        const double f0 = 440.0 * std::exp2((v.semiTarget + bendNow_ - 69.0) / 12.0);
        const double hard = configureNote(v, vel, f0);
        v.lvl = 1.0;
        armExcitation(v, hard * 0.8, f0, hammer ? 0.40 : 0.22);
        v.thAmp *= 0.5;
        if (v.fApplied > 0.0) updateLoop(v, 440.0 * std::exp2((v.semi + bendNow_ - 69.0) / 12.0));
    }

    inline double pulseAt(const Voice& v, double t) const {
        return detail::hann(t, v.exWp) + v.exClick * detail::hann(t, v.exWs);
    }
    inline double nbAt(const Voice& v, double t) const {
        if (t < 0.0 || t >= v.nbN - 1) return 0.0;
        const int i = static_cast<int>(t);
        const double fr = t - i;
        return v.nb[i] * (1.0 - fr) + v.nb[i + 1] * fr;
    }

    void voiceChunk(Voice& v, double* mix, int nb, double wP, double wJ) {
        controlUpdate(v);
        const double qP = 0.14 * v.T, qJb = 0.085 * v.T, qJn = 0.20 * v.T;
        const double lg = v.lpG, bb = v.lpB, ob = 1.0 - v.lpB, ad = v.dispA;
        for (int i = 0; i < nb; ++i) {
            const int w = v.w;
            const double y = v.h[0] * v.buf[(w - v.n0) & kBufMask] + v.h[1] * v.buf[(w - v.n0 - 1) & kBufMask]
                           + v.h[2] * v.buf[(w - v.n0 - 2) & kBufMask] + v.h[3] * v.buf[(w - v.n0 - 3) & kBufMask];
            v.yh[w] = static_cast<float>(y);
            const double d = ad * y + v.dispZ;
            v.dispZ = y - ad * d;
            v.lp = bb * v.lp + ob * d;
            v.dampG += (v.dampT - v.dampG) * slew_;
            double x = v.lp * lg * v.dampG;
            if (v.exI < v.exN) {
                const double t = static_cast<double>(v.exI++);
                const double e = (pulseAt(v, t) - pulseAt(v, t - v.exDp)) + v.exNz * (nbAt(v, t) - nbAt(v, t - v.exDp));
                x += v.exA * e;
            }
            v.buf[w] = x;
            v.w = (w + 1) & kBufMask;
            const double a = std::fabs(y);
            v.lvl = a > v.lvl * lvlDecay_ ? a : v.lvl * lvlDecay_;
            // pastilla: peine por posición (P / J)
            double s = 0.0;
            if (wP > 1.0e-4) s += wP * (y - yAt(v, w, qP));
            if (wJ > 1.0e-4) s += wJ * (0.6 * (y - yAt(v, w, qJn)) + 0.4 * (y - yAt(v, w, qJb)));
            // transitorio de dedo + ruido al soltar
            if (v.thEnv > 1.0e-4) {
                v.thZ1 += v.thC * (v.rng.bip() - v.thZ1);
                v.thZ2 += v.thC * (v.thZ1 - v.thZ2);
                s += v.thZ2 * v.thNorm * v.thEnv * v.thAmp;
                v.thEnv *= v.thDecay;
            }
            if (v.rnLeft > 0) {
                const double nz = v.rng.bip();
                v.rnZ += v.rnC * (nz - v.rnZ);
                s += (nz - v.rnZ) * 0.5 * v.rnEnv * v.rnAmp;               // paso alto: ruido de cuerda
                v.rnEnv *= v.rnDecay;
                --v.rnLeft;
            }
            if (v.killing) {
                v.env -= v.killStep;
                if (v.env <= 0.0) { v.env = 0.0; break; }
            }
            mix[i] += s * v.env * v.mg;
        }
    }
    inline double yAt(const Voice& v, int w, double dq) const {
        if (dq < 1.0) dq = 1.0;
        const int i0 = static_cast<int>(dq);
        const double fr = dq - i0;
        return v.yh[(w - i0) & kBufMask] * (1.0 - fr) + v.yh[(w - i0 - 1) & kBufMask] * fr;
    }

    JasWaveFx::FxRack fx_;
    double sr_{48000.0};
    BassSettings s_;
    double extBend_{0.0}, bendNow_{0.0};
    std::array<Voice, kMaxVoices> voices_;
    Smoother vol_, wet_, mixSm_, driveSm_, pickSm_, bendSm_, attSm_;

    // ---------------------------------------------------------------- bancos de muestras (híbrido)
    static constexpr int kSmpLo = 28, kSmpHi = 67;   // E1..G4: rango de los bancos
    static constexpr int kChordSamples = 30;          // ms: dos notas casi simultáneas = doble cuerda, no se cortan

    void smpPrepare() {
        smpF_.prepare(sr_); smpP_.prepare(sr_);
        JwSampler::Humanize h;
        h.gainDb = 0.6f; h.detuneCents = 2.0f; h.timingMs = 0.6f; h.velCurve = 1.0f;   // humanización de golpe por defecto
        smpF_.setHumanize(h); smpP_.setHumanize(h);
        smpF_.setLevelDb(kSmpLevelDb); smpP_.setLevelDb(kSmpLevelDb);
        smpF_.setAttack(kSmpAttackSec); smpP_.setAttack(kSmpAttackSec);   // ataque suave (smoothstep): sin clic de dedo
        smpRelNormal();
        if (!smpLoadStarted_) {
            smpLoadStarted_ = true;
            // Bucle de cola sintético: las muestras duran 2-5,7 s sin bucle; la redonda se sostiene con el decaimiento lento de la cola
            smpF_.startLoadTailLoop("electric-bass");
            smpP_.startLoadTailLoop("electric-bass-pick");
        }
    }
    void smpReset() {
        smpF_.panic(); smpP_.panic();
        smpSounding_.fill(false); smpKeyHeld_.fill(false); smpHeldN_ = 0;
        smpNote_ = -1; smpAge_ = 0; smpGhostLeft_ = 0; smpVel_ = 0.7;
        smpLp1_ = smpLp2_ = 0.0; smpGain_ = smpGainTarget_ = 1.0; smpFc_ = smpFcTarget_ = 12000.0;
    }
    int smpChordLen() const { return static_cast<int>(kChordSamples * 0.001 * sr_); }
    // Release de teclas sueltas: más corto con Palm Mute, ligado a String Sustain
    void smpRelNormal() {
        const float s = static_cast<float>(0.8 * (1.0 - 0.75 * s_.mute) * (0.6 + 0.8 * s_.sustain));   // release largo y redondo
        smpF_.setReleaseScale(s); smpP_.setReleaseScale(s);
        // String Sustain también gobierna cuánto decae la cola sostenida (dB/s de la cola x escala): 75 % -> x0,7
        const float ds = static_cast<float>(1.6 - 1.2 * s_.sustain);
        smpF_.setLoopDecayScale(ds); smpP_.setLoopDecayScale(ds);
    }
    void smpReleaseNote(int note, float scale) {
        if (!smpSounding_[static_cast<size_t>(note)]) return;
        smpSounding_[static_cast<size_t>(note)] = false;
        smpF_.setReleaseScale(scale); smpP_.setReleaseScale(scale);
        smpF_.noteOff(note); smpP_.noteOff(note);
        smpRelNormal();
    }
    void smpReleaseAll(float scale) {
        for (int n = kSmpLo; n <= kSmpHi; ++n) smpReleaseNote(n, scale);
        smpHeldN_ = 0; smpKeyHeld_.fill(false); smpNote_ = -1; smpGhostLeft_ = 0;
    }
    // Registro agudo: la muestra se transpone mucho hacia arriba (adelgaza y suena a juguete). Por encima de ~7
    // semitonos sobre la raíz más aguda se mezcla, por equipotencia, una voz del modelado (cuerpo y sustain reales).
    static constexpr int kSmpRootTop = 39;
    static constexpr double kModelCal = 1.7;
    void smpCutLayers() {
        for (auto& v : voices_) if (v.active && v.layer && !v.killing && v.keyDown) release(v);
    }
    void smpTrigger(int note, double vel, bool cutLayers) {
        if (cutLayers) smpCutLayers();
        const int trans = note - kSmpRootTop;
        // Menos transposición «de juguete»: el modelado de cuerda (cuerpo y armónicos reales) entra antes (desde +5 st sobre la raíz) y con más peso
        const double blend = trans > 5 ? clampT((trans - 5) / 12.0, 0.0, 1.0) * 0.7 : 0.0;
        double gS = std::cos(blend * kPi * 0.5);
        const double gM = std::sin(blend * kPi * 0.5) * kModelCal * std::pow(10.0, 0.35 * std::max(0, note - 52) / 20.0);   // el modelado pierde nivel hacia el agudo
        if (gM > 0.05 && vel >= 0.2) {
            Voice* fv = nullptr;
            for (auto& v : voices_) if (!v.active) { fv = &v; break; }
            if (fv) { start(*fv, note, vel, gM, true); onModel_[static_cast<size_t>(note)] = true; }
            else gS = 1.0;
        } else gS = 1.0;
        smpGainBlend_ = gS;
        smpF_.noteOn(note, static_cast<float>(vel));
        if (smpP_.ready()) smpP_.noteOn(note, static_cast<float>(vel));
        smpSounding_[static_cast<size_t>(note)] = true;
        smpNote_ = note; smpAge_ = 0; smpVel_ = vel;
        // las notas agudas son muestras transpuestas hacia arriba: decaen más rápido y suenan más flojas; se compensa
        smpGainTarget_ = std::pow(10.0, 0.25 * std::max(0, note - 45) / 20.0) * smpGainBlend_;
        const bool ghost = vel < 0.2;
        smpGhostLeft_ = ghost ? static_cast<int>(0.11 * sr_) : 0;
        // brillo por velocidad (la muestra es de una sola capa): suave = más oscuro; fantasma = apagada
        smpFcTarget_ = ghost ? 650.0 : std::min(20000.0, 900.0 + 5500.0 * std::pow(vel, 1.5));   // oscuro y redondo: pocos armónicos agudos
        if (trans > 7) smpFcTarget_ = std::min(smpFcTarget_, std::max(2500.0, 12000.0 - 280.0 * (trans - 7)));   // oculta el adelgazamiento
    }
    void smpNoteOn(int note, double vel) {
        const bool chord = smpNote_ >= 0 && smpAge_ < smpChordLen() && smpSounding_[static_cast<size_t>(smpNote_)];
        bool hammer = false;
        if (!chord) {
            hammer = s_.legato && smpNote_ >= 0 && smpKeyHeld_[static_cast<size_t>(smpNote_)] && smpNote_ != note
                  && std::abs(smpNote_ - note) <= 7 && smpSounding_[static_cast<size_t>(smpNote_)];
            for (int n = kSmpLo; n <= kSmpHi; ++n) smpReleaseNote(n, 0.12f);   // bajo monofónico: corte corto de lo anterior
        }
        smpHeldRemove(note);
        if (smpHeldN_ < 8) smpHeld_[smpHeldN_++] = note;
        smpKeyHeld_[static_cast<size_t>(note)] = true;
        smpTrigger(note, hammer ? vel * 0.75 : vel, !chord);
    }
    void smpHeldRemove(int note) {
        for (int i = 0; i < smpHeldN_; ++i)
            if (smpHeld_[i] == note) { for (int k = i; k + 1 < smpHeldN_; ++k) smpHeld_[k] = smpHeld_[k + 1]; --smpHeldN_; break; }
    }
    void smpNoteOff(int note) {
        if (note < kSmpLo || note > kSmpHi || !smpKeyHeld_[static_cast<size_t>(note)]) return;
        smpKeyHeld_[static_cast<size_t>(note)] = false;
        smpHeldRemove(note);
        if (!smpSounding_[static_cast<size_t>(note)]) return;
        if (s_.legato && note == smpNote_ && smpHeldN_ > 0 && smpAge_ >= smpChordLen()) {   // pull-off a la nota anterior que sigue sujeta
            const int prev = smpHeld_[smpHeldN_ - 1];
            if (!smpSounding_[static_cast<size_t>(prev)]) {
                smpReleaseNote(note, 0.12f);
                smpTrigger(prev, 0.40 * smpVel_ + 0.12, true);
                return;
            }
        }
        smpReleaseNote(note, 1.0f);
    }
    // Una vuelta de 16 muestras: mezcla dedo/púa, brillo por velocidad y pastilla; devuelve la señal lista para sumar
    void smpChunk(double* out, int nb, double pickMix) {
        const double att = attSm_.advance(nb);
        if (!smpF_.ready()) { for (int i = 0; i < nb; ++i) out[i] = 0.0; return; }
        float fL[kChunk] = {}, fR[kChunk] = {}, pL[kChunk] = {}, pR[kChunk] = {};
        smpF_.setBend(static_cast<float>(bendNow_)); smpP_.setBend(static_cast<float>(bendNow_));
        smpF_.render(fL, fR, nb);
        const bool pk = smpP_.ready();
        if (pk) smpP_.render(pL, pR, nb);
        // FINGER ATTACK: 0..35 % dedo puro; hacia 100 % cruza (equipotencia) a la púa
        const double w = pk ? std::pow(clampT((att - 0.35) / 0.65, 0.0, 1.0), 1.5) : 0.0;
        const double gF = std::cos(w * kPi * 0.5), gP = std::sin(w * kPi * 0.5);
        smpFc_ += (smpFcTarget_ - smpFc_) * (1.0 - std::exp(-static_cast<double>(nb) / (0.012 * sr_)));
        const double c = 1.0 - std::exp(-2.0 * kPi * std::min(smpFc_, sr_ * 0.45) / sr_);
        (void)pickMix;
        const double gk = 1.0 - std::exp(-1.0 / (0.010 * sr_));
        for (int i = 0; i < nb; ++i) {
            smpGain_ += (smpGainTarget_ - smpGain_) * gk;
            const double s = (gF * fL[i] + gP * pL[i]) * smpGain_;
            smpLp1_ += c * (s - smpLp1_);
            smpLp2_ += c * (smpLp1_ - smpLp2_);
            out[i] = biquadProcess(pkBell_, st_[7], smpLp2_);
        }
    }
    void smpAfterChunk(int nb) {
        smpAge_ += nb;
        if (smpGhostLeft_ > 0) {
            smpGhostLeft_ -= nb;
            if (smpGhostLeft_ <= 0 && smpNote_ >= 0) smpReleaseNote(smpNote_, 0.25f);   // nota fantasma: seca
        }
    }
    static constexpr float kSmpLevelDb = 4.0f;
    static constexpr float kSmpAttackSec = 0.006f;
    JwSampler::Sampler smpF_, smpP_;
    bool smpLoadStarted_{false};
    std::array<bool, 128> smpSounding_{}, smpKeyHeld_{}, onModel_{};
    int smpHeld_[8]{}, smpHeldN_{0}, smpNote_{-1}, smpAge_{0}, smpGhostLeft_{0};
    double smpGainBlend_{1.0}, smpGain_{1.0}, smpGainTarget_{1.0}, smpVel_{0.7}, smpLp1_{0.0}, smpLp2_{0.0}, smpFc_{12000.0}, smpFcTarget_{12000.0};
    BiquadCoefs pkBody_, pkBell_, pkLp_, tiltLo_, tiltHi_, toneLp_, sub_, lowCut_, mid_, high_, bump_;
    double tuneSt_{0.0};
    BiquadState st_[12];
    double grS_{0.0}, dc1x_{0}, dc1y_{0}, dc2x_{0}, dc2y_{0};
    double pkEnv_{0.0}, pkRel_{0.9997}, dcR_{0.9976}, compAtk_{0.01}, compRel_{0.001}, lvlDecay_{0.9993}, slew_{0.005};
    int killLen_{240};
    std::array<double, kHbTaps> hb_{};
    int nz_[kHbTaps]{}, nzN_{0};
    std::array<double, 2 * kHbTaps> upBuf_{}, dnBuf_{};
    int upPos_{0}, dnPos_{0};
    uint32_t noteCounter_{0};
    int64_t order_{0};
};

} // namespace JasWaveElectricBass
