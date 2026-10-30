// =====================================================================================
//  JasWave Vocal Choir – motor DSP del coro controlado por MIDI (hasta 4 voces)
//   - Una fuente vocal (la ENTRADA de audio o una vocal formántica INTERNA) se escribe en un anillo mono.
//   - Cada voz del coro es un lector TD-PSOLA propio sobre ese anillo (mismo esquema que Vocal Tune:
//     granos síncronos con el periodo de la fuente, ventanas de coseno alzado que suman 1, saltos de un
//     periodo, Catmull-Rom). Cambiar el periodo de síntesis cambia el tono SIN mover los formantes; el
//     desplazamiento de formantes / longitud de garganta remuestrea cada grano (factor k).
//   - Cada nota MIDI toma una voz: tono = nota + desafinación fija de la voz + vibrato (con retardo de
//     entrada) + deriva humana lenta. Si faltan voces, la más antigua pasa a la nota nueva con portamento
//     (legato, sin reataque): así un coro mueve sus voces de acorde en acorde.
//   - Spread estéreo: cada voz tiene su pan (ley de potencia constante) escalado por el parámetro.
//   - Latencia fija D = 10 ms (la que se informa al host): la entrada sale retrasada exactamente D.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace JasWaveVocalChoir {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kBypass = 0, kVoices = 1, kSpread = 2, kFormant = 3, kThroat = 4, kSource = 5, kVowel = 6, kRange = 7,
    kAttack = 8, kRelease = 9, kVibDepth = 10, kVibRate = 11, kHumanize = 12, kDetune = 13, kGlide = 14,
    kLevel = 15, kOriginal = 16,
    kPitchMeter = 40, kVoicesMeter = 41
};

constexpr int kMaxVoices = 4;

inline const char* const* voiceLabels() { static const char* const l[] = { "1", "2", "3", "4" }; return l; }
inline const char* const* sourceLabels() { static const char* const l[] = { "Input", "Internal" }; return l; }
inline const char* const* vowelLabels() { static const char* const l[] = { "A", "E", "I", "O", "U" }; return l; }
inline const char* const* rangeLabels() { static const char* const l[] = { "Bass", "Tenor", "Alto", "Soprano" }; return l; }

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(asBasico(toggleP(kBypass, "Bypass", 0, true)));
        v.push_back(asBasico(stepP(kVoices, "Voices", kMaxVoices - 1, kMaxVoices - 1, voiceLabels())));
        v.push_back(asBasico(linearP(kSpread, "Stereo Spread", "%", 0.0, 100.0, 70.0, 0)));
        v.push_back(linearP(kFormant, "Formant Shift", "st", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kThroat, "Throat Length", "%", 50.0, 200.0, 100.0, 0));
        v.push_back(asBasico(stepP(kSource, "Source", 1, 1, sourceLabels())));
        v.push_back(asBasico(stepP(kVowel, "Vowel", 4, 0, vowelLabels())));
        v.push_back(stepP(kRange, "Voice Range", 3, 1, rangeLabels()));
        v.push_back(asBasico(linearP(kAttack, "Attack", "ms", 1.0, 1000.0, 60.0, 0)));
        v.push_back(linearP(kRelease, "Release", "ms", 20.0, 3000.0, 400.0, 0));
        v.push_back(linearP(kVibDepth, "Vibrato Depth", "cents", 0.0, 100.0, 25.0, 0));
        v.push_back(linearP(kVibRate, "Vibrato Rate", "Hz", 2.0, 8.0, 5.2, 1));
        v.push_back(linearP(kHumanize, "Humanize", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(linearP(kDetune, "Voice Detune", "cents", 0.0, 50.0, 8.0, 0));
        v.push_back(linearP(kGlide, "Glide", "ms", 0.0, 500.0, 40.0, 0));
        v.push_back(asBasico(linearP(kLevel, "Level", "dB", -24.0, 12.0, 0.0, 1, true)));
        v.push_back(linearP(kOriginal, "Original Voice", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(asReadOnly(linearP(kPitchMeter, "Source Pitch", "Hz", 0.0, 2000.0, 0.0, 1)));
        v.push_back(asReadOnly(linearP(kVoicesMeter, "Active Voices", "", 0.0, 4.0, 0.0, 0)));
        return v;
    }();
    return defs;
}

struct ChoirSettings {
    int voices{kMaxVoices};
    double spread{0.7}, formantSt{0.0}, throatPct{100.0}, attackMs{60.0}, releaseMs{400.0};
    double vibCents{25.0}, vibHz{5.2}, humanize{0.3}, detuneCents{8.0}, glideMs{40.0}, levelDb{0.0}, original{0.0};
    int source{1}, vowel{0}, range{1};
    bool bypass{false};
};

constexpr double kLatencySec = 0.010;
inline int latencyFor(double sr) { return static_cast<int>(std::lround(kLatencySec * (sr > 0 ? sr : 48000.0))); }

struct ChoirBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    std::atomic<float> sourceHz{0.0f};
    std::atomic<int> activeVoices{0};
    std::array<std::atomic<int>, kMaxVoices> note{};
    std::array<std::atomic<float>, kMaxVoices> level{};
    std::array<std::atomic<float>, kMaxVoices> pan{};
    std::atomic<int> latency{0};
    ChoirBus() { for (auto& n : note) n.store(-1); for (auto& l : level) l.store(0.0f); for (auto& p : pan) p.store(0.0f); }
};

class VocalChoirEngine {
public:
    static constexpr int kRing = 1 << 15;
    static constexpr int kDecRing = 1 << 11;
    static constexpr int kDMin = 3;

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        dec_ = std::max(1, static_cast<int>(std::lround(sr_ / 12000.0)));
        decRate_ = sr_ / dec_;
        tauMin_ = std::max(2, static_cast<int>(std::floor(decRate_ / 1000.0)));
        tauMax_ = static_cast<int>(std::ceil(decRate_ / 60.0));
        winDec_ = static_cast<int>(std::ceil(decRate_ * 0.0213));
        hop_ = std::max(32, static_cast<int>(std::lround(sr_ * 0.00267)));
        unvoicedTs_ = std::max(32.0, std::round(sr_ * 0.005));
        const double fc = std::min(2500.0, 0.3 * decRate_);
        lp_[0] = BiquadCoefs::design(FilterType::LowPass, sr_, fc, 0.0, butterworthQ(4, 0));
        lp_[1] = BiquadCoefs::design(FilterType::LowPass, sr_, fc, 0.0, butterworthQ(4, 1));
        L_.assign(kRing, 0.0f); R_.assign(kRing, 0.0f); M_.assign(kRing, 0.0f);
        decBuf_.assign(kDecRing, 0.0f);
        work_.assign(static_cast<size_t>(winDec_ + tauMax_ + 8), 0.0f);
        diff_.assign(static_cast<size_t>(tauMax_ + 2), 0.0f);
        cmnd_.assign(static_cast<size_t>(tauMax_ + 2), 1.0f);
        workFull_.assign(8192, 0.0f);
        wet_.prepare(sr_, 15.0);
        D_ = latencyFor(sr_);
        calibrated_ = false;
        setSettings(s_);
        wet_.reset(wet_.target());
        reset();
    }

    void reset() {
        std::fill(L_.begin(), L_.end(), 0.0f); std::fill(R_.begin(), R_.end(), 0.0f); std::fill(M_.begin(), M_.end(), 0.0f);
        std::fill(decBuf_.begin(), decBuf_.end(), 0.0f);
        for (auto& s : lpS_) s.reset();
        for (auto& r : res_) { r.y1 = 0.0; r.y2 = 0.0; }
        glot_ = 0.0; phaseInt_ = 0;
        n_ = 0; decN_ = 0; decPh_ = 0; hopCnt_ = 0;
        D_ = latencyFor(sr_);
        voiced_ = false; unvoicedHops_ = 99; period_ = unvoicedTs_; f0_ = 0.0;
        sustain_ = false;
        for (auto& v : voices_) v = Voice{};
    }

    void setSettings(const ChoirSettings& s) {
        const bool recal = !calibrated_ || s.vowel != s_.vowel || s.range != s_.range;
        s_ = s;
        s_.voices = std::clamp(s.voices, 1, kMaxVoices);
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        const double k = std::pow(2.0, clampT(s.formantSt, -12.0, 12.0) / 12.0) * (100.0 / clampT(s.throatPct, 50.0, 200.0));
        kTarget_ = clampT(k, 0.5, 2.0);
        if (std::fabs(kTarget_ - 1.0) < 1e-6) kTarget_ = 1.0;
        outGain_ = dbToLinear(clampT(s.levelDb, -24.0, 12.0)) * kBaseGain / std::sqrt(static_cast<double>(s_.voices));
        orig_ = clampT(s.original, 0.0, 1.0);
        atkInc_ = 1.0 / std::max(1.0, s.attackMs * 0.001 * sr_);
        relCoef_ = std::exp(-6.9 / std::max(1.0, s.releaseMs * 0.001 * sr_));
        stealCoef_ = std::exp(-6.9 / std::max(1.0, 0.003 * sr_));
        glideCoef_ = s.glideMs < 0.5 ? 1.0 : 1.0 - std::exp(-1.0 / (s.glideMs * 0.001 * sr_));
        vibInc_ = 2.0 * 3.14159265358979323846 * clampT(s.vibHz, 0.5, 12.0) / sr_;
        D_ = latencyFor(sr_);
        for (int i = s_.voices; i < kMaxVoices; ++i) if (voices_[static_cast<size_t>(i)].on) voices_[static_cast<size_t>(i)].released = true;
        if (recal) configureSource();
    }
    const ChoirSettings& settings() const { return s_; }
    int latency() const { return D_; }
    double sourceHz() const { return voiced_ ? f0_ : 0.0; }
    int activeVoices() const { int c = 0; for (const auto& v : voices_) if (v.on) ++c; return c; }

    // ---- MIDI ----
    void noteOn(int note, float vel) {
        if (vel <= 0.0f) { noteOff(note); return; }
        const double m = clampT(note, 0, 127);
        // misma nota ya sonando: se reataca la voz
        for (auto& v : voices_) if (v.on && v.note == note) { v.released = false; v.held = false; v.vel = vel; return; }
        int slot = -1;
        for (int i = 0; i < s_.voices; ++i) if (!voices_[static_cast<size_t>(i)].on) { slot = i; break; }
        bool steal = false;
        if (slot < 0) {
            // sin voces libres: la más antigua pasa a la nota nueva con portamento (legato); se prefieren las soltadas
            steal = true;
            uint64_t best = ~0ull; bool bestRel = false;
            for (int i = 0; i < s_.voices; ++i) {
                const Voice& v = voices_[static_cast<size_t>(i)];
                const bool rel = v.released || v.held;
                if ((rel && !bestRel) || (rel == bestRel && v.age < best)) { slot = i; best = v.age; bestRel = rel; }
            }
        }
        if (slot < 0) return;
        Voice& v = voices_[static_cast<size_t>(slot)];
        const double det = kDetuneSlot[slot] * s_.detuneCents * 0.01;
        if (!steal) {
            v = Voice{};
            v.on = true;
            v.mCur = m + det;
            v.env = 0.0;
            const double o = static_cast<double>(n_);
            const double Ts = std::max(16.0, sr_ / midiHz(v.mCur));
            v.sC = o; v.aC = o - D_; v.kC = 1.0; v.sN = o + Ts; v.aN = v.sN - D_; v.kN = 1.0; v.kCur = kTarget_;
        }
        v.note = note; v.vel = vel; v.released = false; v.held = false; v.age = ++clock_;
        v.slot = slot; v.det = det; v.mObj = m + det;
        if (!steal) v.tNote = 0.0;
    }
    void noteOff(int note) {
        for (auto& v : voices_) {
            if (!v.on || v.note != note || v.released) continue;
            if (sustain_) v.held = true; else v.released = true;
        }
    }
    void pedal(bool down) {
        sustain_ = down;
        if (!down) for (auto& v : voices_) if (v.on && v.held) { v.held = false; v.released = true; }
    }
    void allNotesOff() { for (auto& v : voices_) if (v.on) { v.released = true; v.held = false; } sustain_ = false; }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, ChoirBus* bus) {
        if (bus) {
            bus->entrada(inL, inR, n);
            bus->latency.store(D_, std::memory_order_relaxed);
        }
        float pin[2] = { 0, 0 }, pout[2] = { 0, 0 };
        constexpr int kMask = kRing - 1;
        const bool internal = s_.source == 1;
        const int nv = s_.voices;
        std::array<double, kMaxVoices> panTarget = panLayout(nv, s_.spread);
        for (int i = 0; i < n; ++i) {
            const float xl = static_cast<float>(inL[i]), xr = static_cast<float>(inR[i]);
            const int w = static_cast<int>(n_ & kMask);
            float mono;
            if (internal) {
                mono = nextInternal();
                L_[static_cast<size_t>(w)] = 0.0f; R_[static_cast<size_t>(w)] = 0.0f;
            } else {
                mono = 0.5f * (xl + xr);
                L_[static_cast<size_t>(w)] = xl; R_[static_cast<size_t>(w)] = xr;
            }
            M_[static_cast<size_t>(w)] = mono;
            if (!internal) {
                const double lpOut = biquadProcess(lp_[1], lpS_[1], biquadProcess(lp_[0], lpS_[0], mono));
                if (++decPh_ >= dec_) { decPh_ = 0; decBuf_[static_cast<size_t>(decN_ & (kDecRing - 1))] = static_cast<float>(lpOut); ++decN_; }
            }
            const double o = static_cast<double>(n_);
            ++n_;
            if (internal) { voiced_ = true; period_ = periodInt_; f0_ = sr_ / periodInt_; }
            else if (++hopCnt_ >= hop_) { hopCnt_ = 0; analyze(); }

            double wl = 0.0, wr = 0.0;
            for (int j = 0; j < kMaxVoices; ++j) {
                Voice& v = voices_[static_cast<size_t>(j)];
                if (!v.on) continue;
                // envolvente
                if (j >= nv && !v.released) v.released = true;
                if (v.released) v.env *= (j >= nv ? stealCoef_ : relCoef_);
                else v.env = std::min(1.0, v.env + atkInc_);
                if (v.released && v.env < 1.0e-4) { v = Voice{}; continue; }
                // tono: portamento hacia la nota objetivo, vibrato con retardo de entrada y deriva humana
                v.tNote += 1.0 / sr_;
                v.mObj = v.note + v.det;
                v.mCur += (v.mObj - v.mCur) * glideCoef_;
                v.vibPh += vibInc_ * (1.0 + 0.07 * (j - 1.5));
                if (v.vibPh > 6.283185307179586) v.vibPh -= 6.283185307179586;
                const double vibAmt = clampT((v.tNote - 0.15) / 0.4, 0.0, 1.0);
                if (--v.driftCnt <= 0) {
                    v.driftCnt = 1024 + static_cast<int>(rnd() * 1024.0);
                    v.driftObj = (rnd() * 2.0 - 1.0) * s_.humanize * 0.12;   // semitonos (±12 cents al 100 %)
                }
                v.drift += (v.driftObj - v.drift) * 0.0008;
                v.mOut = v.mCur + s_.vibCents * 0.01 * std::sin(v.vibPh) * vibAmt + v.drift;
                // granos PSOLA
                while (o >= v.sN) nextGrain(v);
                const double span = v.sN - v.sC;
                const double phi = span > 0.0 ? clampT((o - v.sC) / span, 0.0, 1.0) : 1.0;
                const double wN = 0.5 - 0.5 * std::cos(3.14159265358979323846 * phi);
                const double lim = o - kDMin;
                const double p1 = std::min(v.aC + v.kC * (o - v.sC), lim);
                const double p2 = std::min(v.aN + v.kN * (o - v.sN), lim);
                const float s = p1 == p2 ? readC(M_, p1) : static_cast<float>((1.0 - wN) * readC(M_, p1) + wN * readC(M_, p2));
                const double g = v.env * (0.35 + 0.65 * v.vel);
                v.panCur += (panTarget[static_cast<size_t>(j)] - v.panCur) * 0.002;
                const double ang = (v.panCur + 1.0) * 0.78539816339744831;
                const double y = s * g;
                wl += y * std::cos(ang);
                wr += y * std::sin(ang);
                v.lvl = std::max(static_cast<float>(std::fabs(y)), v.lvl * 0.9995f);
            }
            // camino seco con la misma latencia (solo con fuente = entrada)
            double dl = 0.0, dr = 0.0;
            if (!internal) {
                const int pd = (static_cast<int>(n_ - 1) - D_) & kMask;
                dl = L_[static_cast<size_t>(pd)]; dr = R_[static_cast<size_t>(pd)];
            }
            const double wt = wet_.advance(1);
            const double dryGain = orig_ * wt + (1.0 - wt);   // bypass = voz original retrasada
            const double yl = wl * outGain_ * wt + dl * dryGain;
            const double yr = wr * outGain_ * wt + dr * dryGain;
            outL[i] = static_cast<T>(yl);
            outR[i] = static_cast<T>(yr);
            if (bus) {
                pin[0] = std::max(pin[0], std::fabs(xl)); pin[1] = std::max(pin[1], std::fabs(xr));
                pout[0] = std::max(pout[0], static_cast<float>(std::fabs(yl))); pout[1] = std::max(pout[1], static_cast<float>(std::fabs(yr)));
            }
        }
        if (bus) {
            bus->salida(outL, outR, n);
            bus->inPk[0].update(pin[0]); bus->inPk[1].update(pin[1]);
            bus->outPk[0].update(pout[0]); bus->outPk[1].update(pout[1]);
            bus->sourceHz.store(static_cast<float>(sourceHz()), std::memory_order_relaxed);
            int act = 0;
            for (int j = 0; j < kMaxVoices; ++j) {
                const Voice& v = voices_[static_cast<size_t>(j)];
                if (v.on) ++act;
                bus->note[static_cast<size_t>(j)].store(v.on ? v.note : -1, std::memory_order_relaxed);
                bus->level[static_cast<size_t>(j)].store(v.on ? v.lvl : 0.0f, std::memory_order_relaxed);
                bus->pan[static_cast<size_t>(j)].store(static_cast<float>(v.panCur), std::memory_order_relaxed);
            }
            bus->activeVoices.store(act, std::memory_order_relaxed);
        }
    }

    // Pan objetivo de cada puesto según el número de voces
    static std::array<double, kMaxVoices> panLayout(int n, double spread) {
        static const double t1[kMaxVoices] = { 0.0, 0.0, 0.0, 0.0 };
        static const double t2[kMaxVoices] = { -0.5, 0.5, 0.0, 0.0 };
        static const double t3[kMaxVoices] = { 0.0, -0.7, 0.7, 0.0 };
        static const double t4[kMaxVoices] = { -0.3, 0.3, -0.9, 0.9 };
        const double* t = n <= 1 ? t1 : n == 2 ? t2 : n == 3 ? t3 : t4;
        std::array<double, kMaxVoices> r{};
        for (int i = 0; i < kMaxVoices; ++i) r[static_cast<size_t>(i)] = clampT(t[i] * clampT(spread, 0.0, 1.0), -1.0, 1.0);
        return r;
    }

private:
    struct Voice {
        bool on{false}, released{false}, held{false};
        int note{-1}, slot{0};
        float vel{0.0f}, lvl{0.0f};
        uint64_t age{0};
        double env{0.0}, mCur{60.0}, mObj{60.0}, mOut{60.0}, det{0.0}, tNote{0.0}, vibPh{0.0}, drift{0.0}, driftObj{0.0}, panCur{0.0};
        int driftCnt{0};
        double sC{0}, aC{0}, kC{1}, sN{0}, aN{0}, kN{1}, kCur{1};
    };

    // Desafinación fija de cada puesto (unidad = «Voice Detune» en cents) y timbre propio (desplazamiento de formantes, st)
    static constexpr double kDetuneSlot[kMaxVoices] = { 0.0, 1.0, -1.0, 0.5 };
    static constexpr double kFormantSlot[kMaxVoices] = { 0.0, 0.5, -0.5, -1.2 };
    static constexpr double kBaseGain = 1.6;

    static double midiHz(double m) { return 440.0 * std::pow(2.0, (m - 69.0) / 12.0); }
    double rnd() { rng_ ^= rng_ << 13; rng_ ^= rng_ >> 17; rng_ ^= rng_ << 5; return (rng_ & 0xFFFFFF) / 16777216.0; }

    // ---- fuente interna: tren de pulsos periódico (periodo entero) por 4 resonadores de formante ----
    struct Res { double a1{0}, a2{0}, g{0}, y1{0}, y2{0}; };
    void configureSource() {
        static const double f0i[4] = { 110.0, 165.0, 220.0, 330.0 };
        static const double escala[4] = { 0.90, 1.0, 1.08, 1.20 };
        static const double F[5][4] = { { 730, 1090, 2440, 3400 }, { 530, 1840, 2480, 3500 }, { 300, 2200, 3000, 3600 }, { 570, 840, 2410, 3300 }, { 300, 870, 2240, 3300 } };
        static const double BW[4] = { 70, 100, 140, 180 };
        static const double AMP[4] = { 1.0, 0.7, 0.45, 0.3 };
        const int vw = clampT(s_.vowel, 0, 4), rg = clampT(s_.range, 0, 3);
        periodInt_ = std::max(32.0, std::round(sr_ / f0i[rg]));
        for (int i = 0; i < 4; ++i) {
            const double f = std::min(F[vw][i] * escala[rg], sr_ * 0.45);
            const double r = std::exp(-3.14159265358979323846 * BW[i] / sr_);
            res_[i].a1 = 2.0 * r * std::cos(2.0 * 3.14159265358979323846 * f / sr_);
            res_[i].a2 = -r * r;
            res_[i].g = (1.0 - r) * AMP[i];
            res_[i].y1 = res_[i].y2 = 0.0;
        }
        // calibra el nivel (RMS ≈ 0.18) con una pasada offline sobre 4 periodos estables
        phaseInt_ = 0; glot_ = 0.0;
        double e = 0.0; int cnt = 0;
        const int total = static_cast<int>(periodInt_ * 12);
        for (int i = 0; i < total; ++i) {
            const double y = rawInternal();
            if (i >= total / 2) { e += y * y; ++cnt; }
        }
        const double rms = std::sqrt(e / std::max(1, cnt));
        srcGain_ = rms > 1e-9 ? 0.18 / rms : 1.0;
        for (auto& r : res_) { r.y1 = 0.0; r.y2 = 0.0; }
        phaseInt_ = 0; glot_ = 0.0;
        calibrated_ = true;
    }
    double rawInternal() {
        const double imp = (phaseInt_ == 0) ? 1.0 : 0.0;
        phaseInt_ = (phaseInt_ + 1 >= static_cast<int>(periodInt_)) ? 0 : phaseInt_ + 1;
        glot_ += (imp - glot_) * 0.12;           // pulso glotal suavizado (inclinación espectral)
        double y = 0.0;
        for (auto& r : res_) {                    // resonadores en paralelo con pesos decrecientes
            const double o = r.g * glot_ + r.a1 * r.y1 + r.a2 * r.y2;
            r.y2 = r.y1; r.y1 = o;
            y += o;
        }
        return y;
    }
    float nextInternal() { return static_cast<float>(rawInternal() * srcGain_); }

    // Catmull-Rom sobre el anillo (posición absoluta en muestras)
    static float readC(const std::vector<float>& b, double pos) {
        constexpr int kMask = kRing - 1;
        const double fl = std::floor(pos);
        const float t = static_cast<float>(pos - fl);
        const int64_t i = static_cast<int64_t>(fl);
        const float y0 = b[static_cast<size_t>((i - 1) & kMask)], y1 = b[static_cast<size_t>(i & kMask)];
        if (t == 0.0f) return y1;
        const float y2 = b[static_cast<size_t>((i + 1) & kMask)], y3 = b[static_cast<size_t>((i + 2) & kMask)];
        const float c1 = 0.5f * (y2 - y0);
        const float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
        const float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
        return ((c3 * t + c2) * t + c1) * t + y1;
    }

    // Siguiente marca de síntesis de una voz: periodo de síntesis = 1 / f(voz); marca de análisis a saltos de un periodo
    void nextGrain(Voice& v) {
        v.sC = v.sN; v.aC = v.aN; v.kC = v.kN;
        const double kT = clampT(kTarget_ * std::pow(2.0, kFormantSlot[v.slot] / 12.0), 0.5, 2.0);
        v.kCur += (kT - v.kCur) * 0.35;
        if (std::fabs(v.kCur - kT) < 1e-4) v.kCur = kT;
        const double k = v.kCur;
        const double T = voiced_ ? period_ : unvoicedTs_;
        const double Ts = voiced_ ? clampT(sr_ / midiHz(v.mOut), 16.0, 0.05 * sr_) : unvoicedTs_;
        v.sN = v.sC + Ts;
        v.kN = k;
        const double D = static_cast<double>(D_);
        const double req = kDMin + std::max((k - 1.0) * Ts * 1.5, (1.0 - k) * Ts) + 1.0;
        if (!voiced_) { v.aN = v.sN - std::max(D, req); return; }
        double m = std::round((v.sN - D - v.aC) / T);
        double a = v.aC + m * T;
        while (v.sN - a < req) a -= T;
        while (v.sN - a > D + 1.5 * T + req && v.sN - (a + T) >= req) a += T;
        if (v.sN - a > kRing - 64) a = v.sN - D;
        v.aN = a;
    }

    // Análisis de la fuente de entrada cada salto (~2.7 ms): YIN diezmado + refinado a tasa completa
    void analyze() {
        constexpr int kMask = kRing - 1;
        const int nl = std::min<int>(static_cast<int>(sr_ * 0.0107), static_cast<int>(std::min<uint64_t>(n_, 4096)));
        double e = 0.0, eh = 0.0;
        float prev = M_[static_cast<size_t>((n_ - static_cast<uint64_t>(nl) - 1) & kMask)];
        for (int j = 0; j < nl; ++j) {
            const float x = M_[static_cast<size_t>((n_ - static_cast<uint64_t>(nl) + static_cast<uint64_t>(j)) & kMask)];
            e += static_cast<double>(x) * x;
            eh += static_cast<double>(x - prev) * (x - prev);
            prev = x;
        }
        const double rmsDb = nl > 0 ? 10.0 * std::log10(e / nl + 1e-20) : -200.0;
        const double hf = e > 1e-20 ? eh / e : 0.0;
        const double thr = 0.15;
        bool voz = false;
        double periodo = 0.0;
        const int need = winDec_ + tauMax_;
        if (rmsDb > -57.0 && hf < 0.6 && decN_ >= static_cast<uint64_t>(need)) {
            double tauC = 0.0, cm = 1.0;
            if (yin(thr, tauC, cm)) {
                periodo = refine(tauC * dec_);
                const double f = periodo > 0.0 ? sr_ / periodo : 0.0;
                voz = cm < thr && f >= 55.0 && f <= 1100.0;
            }
        }
        if (voz) unvoicedHops_ = 0; else ++unvoicedHops_;
        if (voz) { period_ = periodo; f0_ = sr_ / periodo; voiced_ = true; }
        else if (unvoicedHops_ > 2) voiced_ = false;
    }

    bool yin(double thr, double& tau, double& cmOut) {
        const int W = winDec_, tmax = tauMax_, total = W + tmax;
        for (int j = 0; j < total; ++j)
            work_[static_cast<size_t>(j)] = decBuf_[static_cast<size_t>((decN_ - static_cast<uint64_t>(total) + static_cast<uint64_t>(j)) & (kDecRing - 1))];
        const float* x = work_.data();
        diff_[0] = 0.0f;
        for (int t = 1; t <= tmax; ++t) {
            float acc = 0.0f;
            for (int j = 0; j < W; ++j) { const float d = x[j] - x[j + t]; acc += d * d; }
            diff_[static_cast<size_t>(t)] = acc;
        }
        cmnd_[0] = 1.0f;
        double run = 0.0;
        for (int t = 1; t <= tmax; ++t) {
            run += diff_[static_cast<size_t>(t)];
            cmnd_[static_cast<size_t>(t)] = run > 0.0 ? static_cast<float>(diff_[static_cast<size_t>(t)] * t / run) : 1.0f;
        }
        int best = -1;
        for (int t = tauMin_; t <= tmax; ++t) {
            if (cmnd_[static_cast<size_t>(t)] < thr) {
                while (t + 1 <= tmax && cmnd_[static_cast<size_t>(t + 1)] < cmnd_[static_cast<size_t>(t)]) ++t;
                best = t;
                break;
            }
        }
        if (best < 0) {
            float mn = 1e9f;
            for (int t = tauMin_; t <= tmax; ++t) if (cmnd_[static_cast<size_t>(t)] < mn) { mn = cmnd_[static_cast<size_t>(t)]; best = t; }
        }
        if (best < 0) return false;
        cmOut = cmnd_[static_cast<size_t>(best)];
        double off = 0.0;
        if (best > 1 && best < tmax) {
            const double a = cmnd_[static_cast<size_t>(best - 1)], b = cmnd_[static_cast<size_t>(best)], c = cmnd_[static_cast<size_t>(best + 1)];
            const double den = a - 2.0 * b + c;
            if (den > 1e-12) off = clampT(0.5 * (a - c) / den, -0.5, 0.5);
        }
        tau = best + off;
        return true;
    }

    double refine(double lagC) {
        constexpr int kMask = kRing - 1;
        const int lo = std::max(2, static_cast<int>(std::floor(lagC - dec_)) - 1);
        const int hi = static_cast<int>(std::ceil(lagC + dec_)) + 1;
        const int Wf = clampT(static_cast<int>(2.0 * lagC), 256, 2048);
        const int total = Wf + hi + 1;
        if (total > static_cast<int>(workFull_.size()) || n_ < static_cast<uint64_t>(total)) return lagC;
        for (int j = 0; j < total; ++j)
            workFull_[static_cast<size_t>(j)] = M_[static_cast<size_t>((n_ - static_cast<uint64_t>(total) + static_cast<uint64_t>(j)) & kMask)];
        const float* y = workFull_.data();
        std::array<double, 64> d{};
        const int cnt = std::min(hi - lo + 1, 64);
        int best = 0;
        for (int k = 0; k < cnt; ++k) {
            const int L = lo + k;
            double acc = 0.0;
            for (int j = 0; j < Wf; ++j) { const double v = static_cast<double>(y[j]) - y[j + L]; acc += v * v; }
            d[static_cast<size_t>(k)] = acc;
            if (acc < d[static_cast<size_t>(best)]) best = k;
        }
        double off = 0.0;
        if (best > 0 && best < cnt - 1) {
            const double a = d[static_cast<size_t>(best - 1)], b = d[static_cast<size_t>(best)], c = d[static_cast<size_t>(best + 1)];
            const double den = a - 2.0 * b + c;
            if (den > 1e-18) off = clampT(0.5 * (a - c) / den, -0.5, 0.5);
        }
        return lo + best + off;
    }

    double sr_{48000.0}, decRate_{12000.0}, unvoicedTs_{240.0};
    int dec_{4}, tauMin_{12}, tauMax_{200}, winDec_{256}, hop_{128};
    ChoirSettings s_;
    Smoother wet_;
    BiquadCoefs lp_[2];
    BiquadState lpS_[2];
    std::vector<float> L_, R_, M_, decBuf_, work_, diff_, cmnd_, workFull_;
    uint64_t n_{0}, decN_{0}, clock_{0};
    int decPh_{0}, hopCnt_{0}, D_{480};
    bool voiced_{false}, sustain_{false}, calibrated_{false};
    int unvoicedHops_{99};
    double period_{240.0}, f0_{0.0};
    double kTarget_{1.0}, outGain_{1.0}, orig_{0.0}, atkInc_{0.01}, relCoef_{0.999}, stealCoef_{0.99}, glideCoef_{0.01}, vibInc_{0.0007};
    // fuente interna
    Res res_[4];
    double glot_{0.0}, periodInt_{291.0}, srcGain_{1.0};
    int phaseInt_{0};
    uint32_t rng_{0x9E3779B9u};
    std::array<Voice, kMaxVoices> voices_{};
};

} // namespace JasWaveVocalChoir
