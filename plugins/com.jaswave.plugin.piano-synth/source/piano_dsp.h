// =====================================================================================
//  JasWave Piano Synth – síntesis modal (sin muestras, sin asignaciones en process)
//   - Cada nota = parciales inarmónicos f_k = k·f0·sqrt((1+B k²)/(1+B)) (el fundamental es EXACTO)
//     como resonadores de 2 polos con T60 por parcial (los agudos decaen antes)
//   - Cuerdas al unísono en los 4 primeros parciales (pares ±δ cents, centroide exacto: batido)
//   - Espectro del martillo: posición de golpe 1/7.3, dureza y velocidad controlan el brillo
//   - Ruido de martillo filtrado, apagadores (release), pedal de sustain (CC64), robo de voces
//     con fundido de 2 ms, polifonía 16 (básica) o 64 (feature)
//   IDs 0..5 compatibles con el JasWave Piano previo (native/piano-synth).
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

namespace JasWavePiano {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t { kVelocity = 0, kBrightness = 1, kDecay = 2, kRelease = 3, kStereo = 4, kBypass = 5, kVolume = 6, kTune = 7, kHardness = 8, kSustain = 9 };
enum Feature : int { kFeatPolyphony = 0, kFeatStereo = 1 };

constexpr int kMaxVoices = 64;
constexpr int kBasicVoices = 16;
constexpr int kMaxPartials = 24;
constexpr int kUnison = 4;                       // parciales con par de cuerdas
constexpr int kMaxRes = kMaxPartials + kUnison;  // resonadores por voz

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kVelocity, "Velocity Sens", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(linearP(kBrightness, "Brightness", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kDecay, "Decay", "%", 0.0, 100.0, 45.0, 0));
        v.push_back(linearP(kRelease, "Release", "s", 0.05, 3.0, 0.4, 2));
        v.push_back(withFeature(linearP(kStereo, "Stereo Width", "%", 0.0, 100.0, 30.0, 0), kFeatStereo));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kTune, "Tune A4", "Hz", 430.0, 450.0, 440.0, 1));
        v.push_back(linearP(kHardness, "Hammer Hardness", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(toggleP(kSustain, "Sustain Pedal", 0));
        return v;
    }();
    return defs;
}

struct PianoSettings {
    double velSens{0.7}, bright{0.5}, decay{0.45}, releaseS{0.4}, stereo{0.3}, volumeDb{0.0}, a4{440.0}, hardness{0.5};
    bool sustain{false}, bypass{false};
    int maxVoices{kMaxVoices};
};

struct PianoBus : MeterBusBase {
    SpectrumTap out;
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<uint64_t> keys[2]{};   // teclas sonando (MIDI 0..127)
    std::atomic<int> maxVoices{kMaxVoices};
};

class PianoEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        vol_.prepare(sr_, 20.0);
        wet_.prepare(sr_, 8.0);
        vol_.reset(dbToLinear(s_.volumeDb));
        wet_.reset(s_.bypass ? 0.0 : 1.0);
        killLen_ = std::max(16, static_cast<int>(0.002 * sr_));
        reset();
    }
    void reset() {
        for (auto& v : voices_) v.active = false;
        pedal_ = false;
    }
    void setSettings(const PianoSettings& s) {
        if (s.sustain != s_.sustain) setPedal(s.sustain);
        s_ = s;
        vol_.setTarget(dbToLinear(s.volumeDb));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        relCoef_ = std::exp(std::log(1.0e-3) / (std::max(0.02, s.releaseS) * sr_));   // −60 dB en release
    }

    void noteOn(int note, float vel) {
        if (note < 0 || note > 127) return;
        if (vel <= 0.0f) { noteOff(note); return; }
        // misma tecla sonando: se apaga con fundido (re-golpe limpio)
        for (auto& v : voices_) if (v.active && !v.killing && v.note == note) startKill(v, -1, 0.0f);
        Voice* free = nullptr;
        int used = 0;
        for (auto& v : voices_) {
            if (v.active) { if (!v.killing || v.pendingNote >= 0) ++used; }   // las robadas con nota pendiente cuentan
            else if (!free) free = &v;
        }
        const int limit = std::clamp(s_.maxVoices, 1, kMaxVoices);
        if (free && used < limit) { start(*free, note, vel); return; }
        // robo: la voz liberada más silenciosa (o la más vieja)
        Voice* victim = nullptr;
        double best = 1e30;
        for (auto& v : voices_) {
            if (!v.active || v.killing) continue;
            const double score = v.level * v.env * (v.released ? 0.25 : 1.0) + v.age * 1e-12;
            if (score < best) { best = score; victim = &v; }
        }
        if (victim) { startKill(*victim, note, vel); return; }
        // todas las voces ya se están robando: la nota sustituye a la pendiente más antigua
        for (auto& v : voices_) if (v.active && v.killing && v.pendingNote >= 0) { v.pendingNote = note; v.pendingVel = vel; return; }
    }
    void noteOff(int note) {
        for (auto& v : voices_) {
            if (!v.active || v.killing || v.note != note || v.keyUp) continue;
            v.keyUp = true;
            if (!pedal_) v.released = true;
        }
    }
    void allNotesOff() { for (auto& v : voices_) if (v.active && !v.killing) startKill(v, -1, 0.0f); }
    void setPedal(bool down) {
        pedal_ = down;
        if (!down) for (auto& v : voices_) if (v.active && v.keyUp) v.released = true;
    }

    // Renderiza n muestras sumando sobre outL/outR (ya puestos a cero por el llamador)
    template <class T>
    void render(T* outL, T* outR, int n, PianoBus* bus) {
        const double width = s_.stereo;
        for (auto& v : voices_) {
            if (!v.active) continue;
            const double panL = std::sqrt(0.5 * (1.0 - width * v.pan)), panR = std::sqrt(0.5 * (1.0 + width * v.pan));
            for (int i = 0; i < n; ++i) {
                double y = 0.0;
                for (int k = 0; k < v.nRes; ++k) {
                    Res& r = v.res[static_cast<size_t>(k)];
                    const double o = r.c * r.y1 - r.r2 * r.y2;
                    r.y2 = r.y1;
                    r.y1 = o;
                    y += o;
                }
                // ruido de martillo
                if (v.noiseLeft > 0) {
                    v.rng = v.rng * 1664525u + 1013904223u;
                    const double w = static_cast<double>(static_cast<int32_t>(v.rng)) * (1.0 / 2147483648.0);
                    v.nz += v.nzCoef * (w - v.nz);
                    y += v.nz * v.noiseAmp * (static_cast<double>(v.noiseLeft) / v.noiseLen);
                    --v.noiseLeft;
                }
                if (v.released) v.env *= relCoef_;
                if (v.killing) {
                    v.env -= v.killStep;
                    if (v.env <= 0.0) { v.env = 0.0; }
                }
                v.level *= v.levelDecay;
                const double s = y * v.env;
                outL[i] += static_cast<T>(s * panL);
                outR[i] += static_cast<T>(s * panR);
                if (v.killing && v.env <= 0.0) break;
            }
            v.age += n;
            if (v.killing && v.env <= 0.0) {
                v.active = false;
                if (v.pendingNote >= 0) { const int pn = v.pendingNote; v.pendingNote = -1; start(v, pn, v.pendingVel); }
                continue;
            }
            if (v.level * v.env < 3.0e-6 && v.noiseLeft <= 0) v.active = false;   // −110 dB: fin natural / tras release
        }
        // volumen + bypass (instrumento: el bypass silencia con fundido)
        const double vg0 = vol_.current(), vg1 = vol_.advance(n), w0 = wet_.current(), w1 = wet_.advance(n);
        float pk[2] = { 0, 0 };
        for (int i = 0; i < n; ++i) {
            const double t = static_cast<double>(i + 1) / n;
            const double g = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t);
            outL[i] = static_cast<T>(static_cast<double>(outL[i]) * g);
            outR[i] = static_cast<T>(static_cast<double>(outR[i]) * g);
            pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i]))));
            pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i]))));
        }
        if (bus) {
            bus->out.pushT(outL, outR, n);
            bus->outPk[0].update(pk[0]);
            bus->outPk[1].update(pk[1]);
            uint64_t k0 = 0, k1 = 0;
            int act = 0;
            for (const auto& v : voices_) {
                if (!v.active) continue;
                ++act;
                if (v.note < 64) k0 |= 1ull << v.note; else k1 |= 1ull << (v.note - 64);
            }
            bus->keys[0].store(k0, std::memory_order_relaxed);
            bus->keys[1].store(k1, std::memory_order_relaxed);
            bus->activeVoices.store(act, std::memory_order_relaxed);
            bus->maxVoices.store(s_.maxVoices, std::memory_order_relaxed);
        }
    }

    int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a; }
    double sampleRate() const { return sr_; }
    // Frecuencia del parcial 1 (para pruebas de afinación)
    double fundamental(int note) const { return s_.a4 * std::pow(2.0, (note - 69) / 12.0); }

private:
    struct Res { double c{0}, r2{0}, y1{0}, y2{0}; };
    struct Voice {
        bool active{false}, released{false}, keyUp{false}, killing{false};
        int note{-1}, nRes{0}, noiseLeft{0}, noiseLen{1}, pendingNote{-1};
        float pendingVel{0};
        double env{1.0}, level{0.0}, levelDecay{1.0}, pan{0.0}, killStep{0.0}, noiseAmp{0.0}, nz{0.0}, nzCoef{0.5};
        int64_t age{0};
        uint32_t rng{0x12345u};
        std::array<Res, kMaxRes> res{};
    };

    void startKill(Voice& v, int pendingNote, float vel) {
        v.killing = true;
        v.killStep = std::max(1.0e-9, v.env / killLen_);
        v.pendingNote = pendingNote;
        v.pendingVel = vel;
    }

    void start(Voice& v, int note, float velIn) {
        const double sr = sr_;
        const double f0 = s_.a4 * std::pow(2.0, (note - 69) / 12.0);
        const double curve = 1.0 / (0.3 + 1.7 * s_.velSens);           // compatible con el piano previo
        const double vel = std::pow(clampT(static_cast<double>(velIn), 0.0, 1.0), curve);
        const double B = 1.0e-4 * std::exp((note - 21) * 0.045);
        const double hk = clampT(0.35 * s_.hardness + 0.35 * s_.bright + 0.3 * vel, 0.0, 1.0);
        const double tilt = 2.3 - 1.5 * hk;
        const double decayScale = 0.25 + 1.6 * s_.decay;
        const double t60base = clampT(decayScale * 16.0 * std::pow(220.0 / f0, 0.55), 0.35, 40.0);
        v = Voice{};
        v.active = true;
        v.note = note;
        v.rng = 0x9E3779B9u ^ static_cast<uint32_t>(note * 7919 + static_cast<int>(velIn * 1000));
        v.pan = clampT((note - 64) / 40.0, -1.0, 1.0);
        double norm = 0.0;
        int nr = 0;
        double slowest = 0.0;
        for (int k = 1; k <= kMaxPartials; ++k) {
            const double fk = k * f0 * std::sqrt((1.0 + B * k * k) / (1.0 + B));
            if (fk >= 0.45 * sr) break;
            double a = std::fabs(std::sin(kPi * k / 7.3)) * std::pow(static_cast<double>(k), -tilt);
            a *= std::exp(-fk / (2500.0 + 9000.0 * s_.bright));          // filtro de brillo
            const double t60 = t60base / (1.0 + 3.0 * std::pow(fk / 2000.0, 1.2));
            const double r = std::pow(10.0, -3.0 / (t60 * sr));
            if (k == 1) slowest = r;
            const int strings = k <= kUnison ? 2 : 1;
            const double cents = 0.12 + 0.08 * k;                           // desafinación de unísono
            for (int s = 0; s < strings; ++s) {
                if (nr >= kMaxRes) break;
                const double det = strings == 2 ? std::pow(2.0, (s == 0 ? cents : -cents) / 1200.0) : 1.0;
                const double w = 2.0 * kPi * fk * det / sr;
                Res& rs = v.res[static_cast<size_t>(nr++)];
                rs.c = 2.0 * r * std::cos(w);
                rs.r2 = r * r;
                rs.y2 = 0.0;
                rs.y1 = (a / strings) * r * std::sin(w);
            }
            norm += a;
        }
        v.nRes = nr;
        const double amp = 0.32 * vel / std::max(norm, 1e-9) * (1.0 + 0.6 * (1.0 - std::min(1.0, f0 / 1000.0)));
        for (int k = 0; k < nr; ++k) { v.res[static_cast<size_t>(k)].y1 *= amp; }
        v.level = amp * norm;
        v.levelDecay = slowest;
        v.env = 1.0;
        v.noiseLen = std::max(16, static_cast<int>((0.003 + 0.009 * (1.0 - s_.hardness)) * sr));
        v.noiseLeft = v.noiseLen;
        v.noiseAmp = 0.06 * vel * (0.4 + s_.hardness);
        v.nzCoef = 1.0 - std::exp(-2.0 * kPi * (1500.0 + 6000.0 * s_.bright) / sr);
    }

    double sr_{48000.0};
    PianoSettings s_;
    std::array<Voice, kMaxVoices> voices_;
    Smoother vol_, wet_;
    double relCoef_{0.999};
    int killLen_{96};
    bool pedal_{false};
};

} // namespace JasWavePiano
