// =====================================================================================
//  JasWave Grand Piano - piano de cola de concierto por modelado (sin muestras)
//  Solo depende de jw_dsp.h / jw_params.h (sin SDK VST3): lo comparte el plugin y render_test.
//
//   Cuerdas      1 (graves) / 2 (medios) / 3 (agudos) cuerdas por nota, microdesafinadas entre si
//                (batimiento natural). Cada parcial es un resonador de 2 polos por recurrencia
//                (sin sin()/cos() por muestra), con inarmonicidad de cuerda rigida f_k = k f0 sqrt((1+B k^2)/(1+B)),
//                decaimiento por parcial (los agudos mueren antes) y bifasico (prompt + sostenido, y
//                cuerdas del unisono con distinta tasa de decaimiento).
//   Martillo     espectro con posicion de golpe, filtro de fieltro dependiente de velocidad (timbre),
//                thump grave y click de ataque (ruido xorshift por voz), ruido de apagador al soltar.
//   Pedal        CC64 continuo (medio pedal): amortiguacion proporcional + resonancia simpatica de
//                88 cuerdas libres excitadas por el sonido. Una corda opcional.
//   Cuerpo       banco de resonancias modales de tabla armonica (biquads, canal R levemente distinto).
//   Estereo      graves a la izquierda / agudos a la derecha (vista del pianista) + parametro de anchura.
//   Sala         reverb FDN de 8 lineas (Householder), difusores, modulacion y amortiguacion de agudos.
//   Salida       DC-blocker (en el banco de cuerpo) + soft-clip tanh, nunca clamp duro.
//  Tiempo real: todo preasignado en prepare(); sin locks ni asignaciones en render().
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_sampler.h"
#include "jw_params.h"
#include "nota_a_nota.h"
#include "jw_fxrack.h"   // FX Rack comun (ids 100..230)

#if defined(_M_X64) || defined(__SSE2__)
#include <emmintrin.h>
#define JW_GP_SSE2 1
#endif

namespace JasWaveGrandPiano {

using namespace JasWaveDsp;
using namespace JasWaveVst;

// ParamIDs estables (= manifiesto.ai.parameters[].vstParamId)
enum : uint32_t {
    kAttack = 0, kDecay = 1, kRelease = 2, kVelocityCurve = 3, kBrightness = 4, kReverbSend = 5,
    kBypass = 6, kVolume = 7, kTune = 8, kWidth = 9, kSustain = 10, kUnaCorda = 11,
    // Editor nota a nota (ver nota_a_nota.h). Se anaden al final: no cambian los ids ni la automatizacion existentes.
    // kNoteGain + p (p = NotaProp) son las 9 propiedades de la nota elegida con kNoteSelect.
    kNoteSelect = 12, kNoteGain = 13, kNoteTune = 14, kNoteTone = 15, kNoteBody = 16, kNoteDecay = 17, kNoteRelease = 18,
    kNoteHammer = 19, kNotePan = 20, kNoteVelCurve = 21, kNotePreset = 22, kNoteCmd = 23
};
// Indices en kFeatures[] del plugin
enum Feature : int { kFeatPolyphony = 0, kFeatHallReverb = 1 };

constexpr int kMaxVoices = 64;
constexpr int kBasicVoices = 16;
constexpr int kExtraSlots = 8;                       // voces que se desvanecen tras un robo
constexpr int kSlots = kMaxVoices + kExtraSlots;
constexpr int kBlk = 64;                             // sub-bloque interno (muestras)
constexpr int kMaxPartials = 48;

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kAttack, "Hammer Attack", "ms", 0.5, 50.0, 2.0, 1));
        v.push_back(linearP(kDecay, "Harmonic Decay", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(linearP(kRelease, "Damper Release", "s", 0.05, 5.0, 0.6, 2));
        v.push_back(linearP(kVelocityCurve, "Velocity Curve", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(linearP(kBrightness, "String Brightness", "%", 0.0, 100.0, 60.0, 0));
        v.push_back(withFeature(linearP(kReverbSend, "Hall Reverb Send", "%", 0.0, 100.0, 25.0, 0), kFeatHallReverb));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kTune, "Tune A4", "Hz", 430.0, 450.0, 440.0, 1));
        v.push_back(linearP(kWidth, "Stereo Width", "%", 0.0, 100.0, 75.0, 0));
        v.push_back(linearP(kSustain, "Sustain Pedal", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(toggleP(kUnaCorda, "Una Corda", 0));
        // --- editor nota a nota: Note Select (indice 0..87 = MIDI 21..108, por defecto C4) + propiedades de la nota elegida
        v.push_back(stepP(kNoteSelect, "Note Select", kNotas - 1, 60 - kNotaMin, notaSelectLabels()));
        for (int p = 0; p < kNpCount; ++p) v.push_back(notaParamDef(kNoteGain + static_cast<uint32_t>(p), p));
        v.push_back(stepP(kNotePreset, "Note Preset", kNotaPresets - 1, 0, notaPresetLabels()));
        // orden interna de edicion (la escribe el editor; oculta, ver nota_a_nota.h). Continuo y sin etiquetas.
        v.push_back(linearP(kNoteCmd, "Note Edit Cmd", "", 0.0, 1.0, 0.0, 0));
        marcarBasicos(v, { kBypass, kVolume, kBrightness, kDecay, kReverbSend, kSustain });   // modo Básico del editor
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..): EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura (apagado de serie)
        return v;
    }();
    return defs;
}

struct GrandSettings {
    double attackMs{2.0}, decayPct{70.0}, releaseS{0.6}, velCurvePct{70.0}, brightnessPct{60.0}, reverbPct{25.0};
    double volumeDb{0.0}, a4{440.0}, widthPct{75.0}, pedalPct{0.0};
    bool unaCorda{false}, bypass{false};
    int maxVoices{kMaxVoices};
};

struct GrandBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<uint64_t> keys[2]{};      // teclas sonando (MIDI 0..127)
    std::atomic<int> maxVoices{kMaxVoices};
    std::atomic<int> pedalPct{0};
};

// ---------------------------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------------------------
inline uint32_t gpXorshift(uint32_t& s) { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
inline double gpRnd01(uint32_t& s) { return static_cast<double>(gpXorshift(s) >> 8) * (1.0 / 16777216.0); }
inline double gpRndSigned(uint32_t& s) { return gpRnd01(s) * 2.0 - 1.0; }

// Saturacion suave: lineal hasta T, despues tanh hacia el techo C (derivada continua, nunca clamp duro)
inline double gpSoftClip(double x) {
    constexpr double T = 0.72, C = 0.97;
    const double a = std::fabs(x);
    if (a <= T) return x;
    const double y = T + (C - T) * std::tanh((a - T) / (C - T));
    return x < 0.0 ? -y : y;
}

// Lista de resonadores de 2 polos (estructura de arrays, relleno a multiplo de 4):
//   y[n] = c y[n-1] - r2 y[n-2],  c = 2 r cos(w),  r2 = r^2   (sinusoide amortiguada, sin sin()/cos() por muestra)
template <int CAP>
struct OscList {
    static_assert(CAP % 4 == 0, "CAP multiplo de 4");
    int n{0};
    alignas(32) double c[CAP], r2[CAP], y1[CAP], y2[CAP], w[CAP], r[CAP];

    void clear() { n = 0; }
    bool add(double wi, double ri, double amp, double phi, double ratio) {
        if (n >= CAP) return false;
        const double wr = wi * ratio;
        w[n] = wi; r[n] = ri; r2[n] = ri * ri; c[n] = 2.0 * ri * std::cos(wr);
        y2[n] = amp * std::sin(phi);
        y1[n] = amp * ri * std::sin(wr + phi);
        ++n;
        return true;
    }
    void pad() {
        while (n & 3) { c[n] = r2[n] = y1[n] = y2[n] = w[n] = r[n] = 0.0; ++n; }
    }
    void retune(double ratio) { for (int i = 0; i < n; ++i) c[i] = 2.0 * r[i] * std::cos(w[i] * ratio); }
    // out[i] += suma de los resonadores (m <= kBlk)
    void render(double* out, int m) {
#ifdef JW_GP_SSE2
        // Acumulador vectorial por muestra (la reduccion horizontal se hace una vez al final) y pasadas de
        // 12/8/4 resonadores con 6/4/2 registros de estado: cadenas independientes que ocultan la latencia.
        alignas(16) __m128d acc[kBlk];
        for (int i = 0; i < m; ++i) acc[i] = _mm_setzero_pd();
        int g = 0;
        for (; g + 12 <= n; g += 12) pass6(g, acc, m);
        if (g + 8 <= n) { pass4(g, acc, m); g += 8; }
        if (g + 4 <= n) { pass2(g, acc, m); g += 4; }
        for (int i = 0; i < m; ++i) out[i] += _mm_cvtsd_f64(_mm_add_sd(acc[i], _mm_unpackhi_pd(acc[i], acc[i])));
#else
        for (int g = 0; g < n; g += 4) {
            const double c0 = c[g], c1 = c[g + 1], c2 = c[g + 2], c3 = c[g + 3];
            const double a0 = r2[g], a1 = r2[g + 1], a2 = r2[g + 2], a3 = r2[g + 3];
            double p0 = y1[g], p1 = y1[g + 1], p2 = y1[g + 2], p3 = y1[g + 3];
            double q0 = y2[g], q1 = y2[g + 1], q2 = y2[g + 2], q3 = y2[g + 3];
            for (int i = 0; i < m; ++i) {
                out[i] += (p0 + p1) + (p2 + p3);
                const double n0 = c0 * p0 - a0 * q0, n1 = c1 * p1 - a1 * q1, n2 = c2 * p2 - a2 * q2, n3 = c3 * p3 - a3 * q3;
                q0 = p0; q1 = p1; q2 = p2; q3 = p3;
                p0 = n0; p1 = n1; p2 = n2; p3 = n3;
            }
            y1[g] = p0; y1[g + 1] = p1; y1[g + 2] = p2; y1[g + 3] = p3;
            y2[g] = q0; y2[g + 1] = q1; y2[g + 2] = q2; y2[g + 3] = q3;
        }
#endif
    }

private:
#ifdef JW_GP_SSE2
#define JW_LD(k) __m128d p##k = _mm_load_pd(y1 + g + 2 * (k)), q##k = _mm_load_pd(y2 + g + 2 * (k));
#define JW_ST(k) _mm_store_pd(y1 + g + 2 * (k), p##k); _mm_store_pd(y2 + g + 2 * (k), q##k);
#define JW_STEP(k) { const __m128d nn = _mm_sub_pd(_mm_mul_pd(_mm_load_pd(c + g + 2 * (k)), p##k), _mm_mul_pd(_mm_load_pd(r2 + g + 2 * (k)), q##k)); q##k = p##k; p##k = nn; }
    void pass6(int g, __m128d* acc, int m) {
        JW_LD(0) JW_LD(1) JW_LD(2) JW_LD(3) JW_LD(4) JW_LD(5)
        for (int i = 0; i < m; ++i) {
            const __m128d s = _mm_add_pd(_mm_add_pd(_mm_add_pd(p0, p1), _mm_add_pd(p2, p3)), _mm_add_pd(p4, p5));
            acc[i] = _mm_add_pd(acc[i], s);
            JW_STEP(0) JW_STEP(1) JW_STEP(2) JW_STEP(3) JW_STEP(4) JW_STEP(5)
        }
        JW_ST(0) JW_ST(1) JW_ST(2) JW_ST(3) JW_ST(4) JW_ST(5)
    }
    void pass4(int g, __m128d* acc, int m) {
        JW_LD(0) JW_LD(1) JW_LD(2) JW_LD(3)
        for (int i = 0; i < m; ++i) {
            acc[i] = _mm_add_pd(acc[i], _mm_add_pd(_mm_add_pd(p0, p1), _mm_add_pd(p2, p3)));
            JW_STEP(0) JW_STEP(1) JW_STEP(2) JW_STEP(3)
        }
        JW_ST(0) JW_ST(1) JW_ST(2) JW_ST(3)
    }
    void pass2(int g, __m128d* acc, int m) {
        JW_LD(0) JW_LD(1)
        for (int i = 0; i < m; ++i) {
            acc[i] = _mm_add_pd(acc[i], _mm_add_pd(p0, p1));
            JW_STEP(0) JW_STEP(1)
        }
        JW_ST(0) JW_ST(1)
    }
#undef JW_LD
#undef JW_ST
#undef JW_STEP
#endif
};

// ---------------------------------------------------------------------------------------
//  Reverb de sala: FDN de 8 lineas (mezcla Householder ortogonal), difusores de entrada,
//  predelay, lineas moduladas y amortiguacion de agudos. Ganancia de lazo < 1 siempre.
// ---------------------------------------------------------------------------------------
class HallReverb {
public:
    static constexpr int N = 8;
    static constexpr double kRt60 = 2.4;       // s (graves)
    static constexpr double kDampHz = 9500.0;  // el lazo atenua por encima (RT60 de agudos menor)

    void prepare(double sr) {
        sr_ = sr > 0 ? sr : 48000.0;
        static const int base[N] = { 1433, 1637, 1877, 2131, 2371, 2647, 2909, 3203 };
        static const double rate[N] = { 0.11, 0.17, 0.23, 0.29, 0.13, 0.19, 0.31, 0.37 };
        const double scale = sr_ / 48000.0;
        modDepth_ = std::max(2.0, 0.0005 * sr_);
        for (int i = 0; i < N; ++i) {
            len_[i] = std::max(64, static_cast<int>(std::lround(base[i] * scale)) | 1);
            buf_[i].assign(static_cast<size_t>(len_[i]) + static_cast<size_t>(modDepth_) + 8, 0.0);
            g_[i] = std::pow(10.0, -3.0 * len_[i] / (kRt60 * sr_));
            lp_[i] = 0.0;
            w_[i] = 0;
            cur_[i] = len_[i];
            phase_[i] = (i * 0.137) - std::floor(i * 0.137);
            rate_[i] = rate[i];
        }
        damp_ = std::exp(-2.0 * kPi * std::min(kDampHz, 0.45 * sr_) / sr_);
        pdLen_ = std::max(1, static_cast<int>(0.018 * sr_));
        pdL_.assign(static_cast<size_t>(pdLen_), 0.0);
        pdR_.assign(static_cast<size_t>(pdLen_), 0.0);
        pdW_ = 0;
        static const int apLen[4] = { 142, 107, 163, 127 };
        for (int i = 0; i < 4; ++i) ap_[i].init(std::max(8, static_cast<int>(std::lround(apLen[i] * scale))));
    }
    void reset() {
        for (int i = 0; i < N; ++i) { std::fill(buf_[i].begin(), buf_[i].end(), 0.0); lp_[i] = 0.0; w_[i] = 0; cur_[i] = len_[i]; }
        std::fill(pdL_.begin(), pdL_.end(), 0.0);
        std::fill(pdR_.begin(), pdR_.end(), 0.0);
        pdW_ = 0;
        for (auto& a : ap_) a.clear();
    }
    // Ganancia de lazo maxima (para comprobar estabilidad)
    double maxLoopGain() const { double m = 0; for (int i = 0; i < N; ++i) m = std::max(m, g_[i]); return m; }

    void process(const double* inL, const double* inR, double* oL, double* oR, int m) {
        double nd[N];
        for (int i = 0; i < N; ++i) {
            phase_[i] += rate_[i] * m / sr_;
            phase_[i] -= std::floor(phase_[i]);
            nd[i] = len_[i] + modDepth_ * std::sin(2.0 * kPi * phase_[i]);
        }
        for (int s = 0; s < m; ++s) {
            double xl = pdL_[static_cast<size_t>(pdW_)], xr = pdR_[static_cast<size_t>(pdW_)];
            pdL_[static_cast<size_t>(pdW_)] = inL[s];
            pdR_[static_cast<size_t>(pdW_)] = inR[s];
            if (++pdW_ >= pdLen_) pdW_ = 0;
            xl = ap_[1].proc(ap_[0].proc(xl));
            xr = ap_[3].proc(ap_[2].proc(xr));
            const double t = static_cast<double>(s + 1) / m;
            double v[N], sum = 0.0;
            for (int i = 0; i < N; ++i) {
                const double d = cur_[i] + (nd[i] - cur_[i]) * t;
                const int di = static_cast<int>(d);
                const double fr = d - di;
                const int sz = static_cast<int>(buf_[i].size());
                int i1 = w_[i] - di; if (i1 < 0) i1 += sz;
                int i2 = i1 - 1; if (i2 < 0) i2 += sz;
                const double y = buf_[i][static_cast<size_t>(i1)] * (1.0 - fr) + buf_[i][static_cast<size_t>(i2)] * fr;
                lp_[i] = y + damp_ * (lp_[i] - y);
                v[i] = lp_[i] * g_[i];
                sum += v[i];
            }
            const double fb = sum * (2.0 / N);
            for (int i = 0; i < N; ++i) {
                const int sz = static_cast<int>(buf_[i].size());
                buf_[i][static_cast<size_t>(w_[i])] = ((i & 1) ? xr : xl) * 0.5 + v[i] - fb;
                if (++w_[i] >= sz) w_[i] = 0;
            }
            oL[s] = 0.5 * ((v[0] - v[2]) + (v[4] - v[6]) + 0.35 * (v[1] + v[5]));
            oR[s] = 0.5 * ((v[1] - v[3]) + (v[5] - v[7]) + 0.35 * (v[2] + v[6]));
        }
        for (int i = 0; i < N; ++i) cur_[i] = nd[i];
    }

private:
    struct Ap {
        std::vector<double> b; int n{0}, w{0};
        static constexpr double g = 0.6;
        void init(int len) { b.assign(static_cast<size_t>(len), 0.0); n = len; w = 0; }
        void clear() { std::fill(b.begin(), b.end(), 0.0); w = 0; }
        double proc(double x) {
            const double d = b[static_cast<size_t>(w)];
            const double v = x + g * d;
            b[static_cast<size_t>(w)] = v;
            if (++w >= n) w = 0;
            return -g * v + d;
        }
    };
    double sr_{48000.0}, modDepth_{24.0}, damp_{0.3};
    std::vector<double> buf_[N];
    int len_[N]{}, w_[N]{};
    double g_[N]{}, lp_[N]{}, cur_[N]{}, phase_[N]{}, rate_[N]{};
    std::vector<double> pdL_, pdR_;
    int pdLen_{1}, pdW_{0};
    Ap ap_[4];
};

// ---------------------------------------------------------------------------------------
//  Motor
// ---------------------------------------------------------------------------------------
class GrandPianoEngine {
public:
    GrandPianoEngine() { prepare(48000.0, 512); }

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        sampler_.prepare(sr_);
        if (!samplerLoadStarted_) { samplerLoadStarted_ = true; sampler_.startLoad("grand-piano"); }
        vol_.prepare(sr_, 20.0);
        wet_.prepare(sr_, 8.0);
        width_.prepare(sr_, 30.0);
        vol_.reset(dbToLinear(s_.volumeDb));
        wet_.reset(s_.bypass ? 0.0 : 1.0);
        width_.reset(widthGain());
        killLen_ = std::max(16, static_cast<int>(0.005 * sr_));
        retrigLen_ = std::max(32, static_cast<int>(0.030 * sr_));
        reverb_.prepare(sr_);
        fx_.prepare(sr_);
        designBody();
        designSympathetic();
        reset();
    }
    void reset() {
        sampler_.panic();
        for (auto& v : voices_) v.active = false;
        pedal_ = pedalTarget_ = 0.0;
        bend_ = bendTarget_ = bendApplied_ = 0.0;
        order_ = 0;
        for (int i = 0; i < kSymN; ++i) { sy1_[i] = sy2_[i] = 0.0; }
        symLive_ = false;
        reverb_.reset();
        fx_.reset();
        for (auto& b : bodyL_) b.reset();
        for (auto& b : bodyR_) b.reset();
        updateDamperAmount();
    }
    // FX Rack comun (jw_fxrack.h): al final de la cadena, antes de los medidores y del espectro
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    void setTempo(double bpm) { fx_.setTempo(bpm); }
    JasWaveFx::FxRack& fx() { return fx_; }
    void setSettings(const GrandSettings& s) {
        const bool tuneChanged = s.a4 != s_.a4;
        if (s.pedalPct != s_.pedalPct) setPedal(s.pedalPct / 100.0);
        s_ = s;
        if (tuneChanged) designSympathetic();
        vol_.setTarget(dbToLinear(s.volumeDb));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        width_.setTarget(widthGain());
    }
    const GrandSettings& settings() const { return s_; }

    // Tabla de afinacion y timbre por nota (nota_a_nota.h). Se aplica a las notas NUEVAS (y al release de las vivas).
    void setNotaTabla(const NotaTabla& t) {
        tabla_ = t;
        for (int i = 0; i < kNotas; ++i) formas_[static_cast<size_t>(i)] = notaForma(t.v[i]);
    }
    const NotaTabla& notaTabla() const { return tabla_; }

    // vel en 0..1 (VST3). velocidad 0 = note off.
    void noteOn(int note, double vel) {
        if (note < 0 || note > 127) return;
        if (!(vel > 0.0)) { noteOff(note); return; }
        if (vel > 1.0) vel = 1.0;
        const NotaForma& nf = forma(note);
        if (!nf.neutra && nf.velGamma != 1.0) vel = std::pow(clampT(vel, 1.0 / 127.0, 1.0), nf.velGamma);   // curva de velocidad de la nota
        if (sampler_.ready()) {
            if (nf.neutra) { sampler_.noteOn(note, static_cast<float>(vel)); return; }
            const double f0 = fundamental(note) * std::pow(2.0, nf.cents / 1200.0);
            JwSampler::NoteShape sh;
            sh.gainMul = static_cast<float>(nf.gain);
            sh.cents = static_cast<float>(nf.cents);
            sh.pan = static_cast<float>(nf.pan);
            sh.shelfDb = static_cast<float>(nf.tone * 12.0);
            sh.shelfHz = static_cast<float>(clampT(2.5 * f0, 500.0, 6000.0));
            sh.bodyDb = static_cast<float>(nf.body * 9.0);
            sh.bodyHz = static_cast<float>(f0);
            // pendiente natural aproximada (dB/s) de la nota; la escala de decay la acelera (<1) o la compensa (>1)
            const double nat = 60.0 / (26.0 * std::pow(110.0 / f0, 0.55));
            sh.decayDbPerSec = static_cast<float>(nat * (1.0 / std::max(0.05, nf.decay) - 1.0));
            sh.releaseScale = static_cast<float>(nf.release);
            sh.hammer = static_cast<float>(nf.hammer);
            sampler_.noteOnShaped(note, static_cast<float>(vel), sh);
            return;
        }
        for (auto& v : voices_)
            if (v.active && !v.killing && v.note == note) beginKill(v, retrigLen_);
        Voice* freeV = nullptr;
        int used = 0;
        for (auto& v : voices_) {
            if (v.active) { if (!v.killing) ++used; }
            else if (!freeV) freeV = &v;
        }
        const int limit = clampT(s_.maxVoices, 1, kMaxVoices);
        if (used >= limit) {
            // robo: la voz mas antigua (primero entre las ya soltadas), con fundido corto
            Voice* victim = nullptr;
            for (int pass = 0; pass < 2 && !victim; ++pass) {
                for (auto& v : voices_) {
                    if (!v.active || v.killing) continue;
                    if (pass == 0 && !v.keyUp) continue;
                    if (!victim || v.order < victim->order) victim = &v;
                }
            }
            if (victim) beginKill(*victim, killLen_);
        }
        if (!freeV) {
            // todos los huecos ocupados (se estan desvaneciendo): reutiliza el mas callado
            for (auto& v : voices_)
                if (v.killing && (!freeV || v.killEnv < freeV->killEnv)) freeV = &v;
        }
        if (freeV) start(*freeV, note, vel);
    }
    void noteOff(int note) {
        sampler_.noteOff(note);
        for (auto& v : voices_) {
            if (!v.active || v.killing || v.note != note || v.keyUp) continue;
            v.keyUp = true;
            const double t60 = std::max(0.02, s_.releaseS) * forma(note).release * (0.7 + 0.5 * std::pow(110.0 / fundamental(note), 0.4));
            v.relK = 6.907755 / (t60 * sr_);
            if (damperD_ > 0.5) fireDamper(v);
        }
    }
    void allNotesOff() { sampler_.allNotesOff(); for (auto& v : voices_) if (v.active && !v.killing) { v.keyUp = true; v.relK = 6.907755 / (std::max(0.02, s_.releaseS) * sr_); } }
    // Silencio inmediato: voces, cuerdas simpaticas y cola de la sala
    void panic() { reset(); }
    void setPedal(double v01) { pedalTarget_ = clampT(v01, 0.0, 1.0); sampler_.setSustain(v01 >= 0.5); }
    void setBend(double semitones) { bendTarget_ = clampT(semitones, -12.0, 12.0); sampler_.setBend(static_cast<float>(semitones)); }
    bool samplerReady() const { return sampler_.ready(); }
    bool samplerLoading() const { return sampler_.loading(); }
    void setSympathetic(double amount) { symAmount_ = clampT(amount, 0.0, 1.0); }

    // Genera n muestras estereo (sobrescribe outL/outR)
    template <class T>
    void render(T* outL, T* outR, int n, GrandBus* bus) {
        int pos = 0;
        float pk[2] = { 0.f, 0.f };
        while (pos < n) {
            const int m = std::min(kBlk, n - pos);
            block(m);
            for (int i = 0; i < m; ++i) {
                outL[pos + i] = static_cast<T>(outL_[i]);
                outR[pos + i] = static_cast<T>(outR_[i]);
                pk[0] = std::max(pk[0], static_cast<float>(std::fabs(outL_[i])));
                pk[1] = std::max(pk[1], static_cast<float>(std::fabs(outR_[i])));
            }
            pos += m;
        }
        // rack comun tras generar la salida final; el pico se mide DESPUES (apagado: no toca el buffer ni el pico)
        if (fx_.activo()) {
            fx_.process(outL, outR, n, bus);
            pk[0] = pk[1] = 0.0f;
            for (int i = 0; i < n; ++i) { pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i])))); pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i])))); }
        } else fx_.process(outL, outR, n, bus);
        if (bus) {
            bus->salida(outL, outR, n);
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
            bus->pedalPct.store(static_cast<int>(pedal_ * 100.0 + 0.5), std::memory_order_relaxed);
        }
    }

    int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a; }
    double sampleRate() const { return sr_; }
    double fundamental(int note) const { return s_.a4 * std::pow(2.0, (note - 69) / 12.0); }
    double reverbLoopGain() const { return reverb_.maxLoopGain(); }
    int oscillatorCount() const { int a = 0; for (const auto& v : voices_) if (v.active) a += v.s0.n + v.s1.n + v.s2.n; return a; }

private:
    static constexpr int kSymN = 88, kSymPad = 88;   // 88 es multiplo de 4

    struct Voice {
        bool active{false}, keyUp{false}, killing{false}, damperFired{false}, nzOn{false};
        int note{-1};
        uint64_t order{0};
        int64_t age{0};
        OscList<16> s0;
        OscList<64> s1;
        OscList<16> s2;
        double gl[3]{}, gr[3]{}, gcL{0.7071}, gcR{0.7071};
        double att{1}, attCoef{0.9}, prm{1}, prmCoef{0.9999}, prmFrac{0.4};
        double damp{1}, relK{0};
        double killEnv{1}, killStep{0};
        double peak{0};
        uint32_t rng{1};
        double tl{0}, tA{0.1}, tAmp{0}, tDec{0.999};
        double ch{0}, cl{0}, chA{0.5}, clA{0.1}, cAmp{0}, cDec{0.99};
        double rl{0}, rA{0.1}, rAmp{0}, rDec{0.99};
        double hamA{0}, hamE{1}, hamK{0.999};      // martillo por nota: g *= 1 + hamA * hamE, hamE *= hamK
    };

    double widthGain() const { return s_.widthPct / 75.0; }
    const NotaForma& forma(int note) const { return NotaTabla::valida(note) ? formas_[static_cast<size_t>(note - kNotaMin)] : formaNeutra_; }

    void beginKill(Voice& v, int len) {
        v.killing = true;
        v.killStep = std::max(1.0e-9, v.killEnv / std::max(1, len));
    }

    void fireDamper(Voice& v) {
        v.damperFired = true;
        const double amp = std::min(0.02, 0.05 * v.peak);
        if (amp < 2.0e-5) return;
        const double fc = 650.0;
        v.rA = 1.0 - std::exp(-2.0 * kPi * fc / sr_);
        v.rAmp = amp / (0.577 * std::sqrt(v.rA / (2.0 - v.rA)));
        v.rDec = std::exp(-1.0 / (0.010 * sr_));
        v.nzOn = true;
    }

    void updateDamperAmount() { const double q = 1.0 - pedal_; damperD_ = q * q; }

    // ---- inicio de nota ---------------------------------------------------------------
    void start(Voice& v, int note, double velIn) {
        const double sr = sr_;
        const NotaForma& nf = forma(note);                                   // afinacion/timbre por nota
        const double f0 = nf.cents != 0.0 ? fundamental(note) * std::pow(2.0, nf.cents / 1200.0) : fundamental(note);
        v.active = true; v.keyUp = false; v.killing = false; v.damperFired = false; v.nzOn = false;
        v.note = note; v.order = ++order_; v.age = 0;
        v.damp = 1.0; v.relK = 0.0; v.killEnv = 1.0; v.killStep = 0.0; v.peak = 0.0;
        v.s0.clear(); v.s1.clear(); v.s2.clear();
        v.rng = 0x9E3779B9u ^ static_cast<uint32_t>(note * 7919 + static_cast<int>(order_ * 104729u) + static_cast<int>(velIn * 1000.0));
        if (v.rng == 0) v.rng = 0x1234567u;
        for (int i = 0; i < 4; ++i) gpXorshift(v.rng);

        // --- velocidad: curva, nivel y timbre
        const double gamma = std::pow(2.0, (50.0 - s_.velCurvePct) / 50.0);
        const double vq = std::pow(clampT(velIn, 1.0 / 127.0, 1.0), gamma);
        const double jitter = 1.0 + 0.04 * gpRndSigned(v.rng);            // round-robin: +-0.35 dB
        const double una = s_.unaCorda ? 1.0 : 0.0;
        const double ampV = (0.012 + 0.988 * std::pow(vq, 1.7)) * jitter * (1.0 - 0.18 * una) * nf.gain;
        const double brightMul = 0.25 * std::pow(12.0, s_.brightnessPct / 100.0);
        double fc = (420.0 + 9000.0 * std::pow(vq, 1.5)) * brightMul * (1.0 - 0.35 * una);
        fc *= std::pow(1.0 + f0 / 800.0, 0.35) / (1.0 + s_.attackMs / 25.0);
        if (nf.tone != 0.0) fc *= std::pow(2.0, nf.tone * 1.5);                 // tono por nota: +-1,5 octavas del filtro de fieltro
        fc = clampT(fc, 300.0, 20000.0);

        // --- cuerdas por nota y desafinaciones (cents)
        int nS = note < 36 ? 1 : (note < 48 ? 2 : 3);
        if (s_.unaCorda && nS > 1) --nS;
        double cents[3] = { 0, 0, 0 };
        const double d1 = 0.25 + 0.85 * gpRnd01(v.rng), d2 = 0.25 + 0.85 * gpRnd01(v.rng);
        double dm[3] = { 1.0, 1.0, 1.0 };           // multiplicador de decaimiento por cuerda
        if (nS == 2) { cents[0] = d1; cents[2] = -d2; dm[0] = 1.5; dm[2] = 0.7; }
        else if (nS == 3) { cents[0] = -d1; cents[1] = 0.0; cents[2] = d2; dm[0] = 1.6; dm[1] = 1.0; dm[2] = 0.65; }
        const int kd = nS == 1 ? 0 : (nS == 2 ? 6 : 5);   // parciales con cuerdas separadas

        // --- inarmonicidad B (cuerda rigida) por registro
        const double B = note < 48 ? 6.0e-5 + (48 - note) * 5.0e-6 : 6.0e-5 * std::exp(0.07 * (note - 48));

        // --- decaimiento base (T60 del 1er parcial) y bifasico
        const double decayScale = 0.35 * std::pow(5.14, s_.decayPct / 100.0);
        const double t60a = clampT(26.0 * std::pow(110.0 / f0, 0.55) * decayScale * nf.decay, 0.4, 120.0);
        const double alpha1 = 6.907755 / t60a;

        // --- espectro del martillo
        const double beta = 0.125 - 0.03 * clampT((note - 60) / 48.0, 0.0, 1.0);
        const double fmax = std::min(0.45 * sr, 11000.0);
        double fk[kMaxPartials], ak[kMaxPartials];
        int K = 0;
        double s2sum = 0.0;
        for (int k = 1; k <= kMaxPartials; ++k) {
            const double f = k * f0 * std::sqrt((1.0 + B * k * k) / (1.0 + B));
            if (f >= fmax) break;
            const double ex = 0.08 + std::fabs(std::sin(kPi * k * beta));
            const double rad = 1.0 / (1.0 + std::pow(140.0 / f, 1.6));
            const double lp = 1.0 / (1.0 + std::pow(f / fc, 2.6));
            double a = ex * std::pow(static_cast<double>(k), -0.85) * rad * lp;
            if (nf.tone != 0.0) a *= std::pow(static_cast<double>(k), 0.6 * nf.tone);   // inclinacion espectral por nota
            fk[K] = f; ak[K] = a; ++K;
            s2sum += a * a;
        }
        if (K == 0) { v.active = false; return; }
        // Afinacion "estirada": el centro de energia espectral cae en f0 (el fundamental queda unos cents
        // por debajo si la inarmonicidad es alta, como al afinar un piano real).
        {
            double num = 0.0;
            for (int k = 0; k < K; ++k) num += ak[k] * ak[k] * (fk[k] / ((k + 1) * f0));
            const double stretch = clampT(num / s2sum, 1.0, 1.0145);
            for (int k = 0; k < K; ++k) fk[k] /= stretch;
        }
        const double rms = std::sqrt(s2sum);
        const double G0 = 0.20;                                  // nivel de referencia (RMS por voz a ff)
        const double voiceRef = ampV * G0;
        const double load = 1.0 + activeVoices() / 20.0;         // menos parciales con mucha polifonia
        double bendRatio = std::pow(2.0, bendApplied_ / 12.0);

        for (int k = 0; k < K; ++k) {
            double rel = ak[k] / rms;
            if (k < 3 && nf.body != 0.0) rel *= std::pow(10.0, nf.body * 9.0 * kBodyShare[k] / 20.0);   // cuerpo: realce de la fundamental y graves
            if (ampV * rel * load < 8.0e-4 && k > 0) continue;
            const double amp = voiceRef * rel * 1.4142;           // amplitud de pico del parcial
            const double fq = fk[k];
            const double hfd = 1.0 + (fq / 2300.0) * (fq / 2300.0);
            const double ph = k < 2 ? 0.0 : 0.7 * gpRndSigned(v.rng);
            const double wBase = 2.0 * kPi * fq / sr;
            if (k < kd) {
                const double aS = amp / nS;
                if (nS == 2) {
                    for (int si = 0; si < 3; si += 2) {
                        const double w = wBase * std::pow(2.0, cents[si] / 1200.0);
                        const double r = std::exp(-alpha1 * dm[si] * hfd / sr);
                        (si == 0 ? v.s0.add(w, r, aS, ph, bendRatio) : v.s2.add(w, r, aS, ph + 0.2, bendRatio));
                    }
                } else {
                    for (int si = 0; si < 3; ++si) {
                        const double w = wBase * std::pow(2.0, cents[si] / 1200.0);
                        const double r = std::exp(-alpha1 * dm[si] * hfd / sr);
                        if (si == 0) v.s0.add(w, r, aS, ph, bendRatio);
                        else if (si == 1) v.s1.add(w, r, aS, ph, bendRatio);
                        else v.s2.add(w, r, aS, ph + 0.2, bendRatio);
                    }
                }
            } else {
                const double r = std::exp(-alpha1 * hfd / sr);
                v.s1.add(wBase, r, amp, ph, bendRatio);
            }
        }
        v.s0.pad(); v.s1.pad(); v.s2.pad();

        // --- paneo (vista del pianista: graves a la izquierda) y cuerdas del unisono
        const double pv = clampT(clampT((note - 64.5) / 43.5, -1.0, 1.0) * 0.7 + nf.pan, -1.0, 1.0);
        const double pans[3] = { pv - 0.22, pv, pv + 0.22 };
        for (int i = 0; i < 3; ++i) {
            const double p = clampT(pans[i], -1.0, 1.0);
            v.gl[i] = std::cos((p + 1.0) * kPi * 0.25);
            v.gr[i] = std::sin((p + 1.0) * kPi * 0.25);
        }
        v.gcL = std::cos((pv + 1.0) * kPi * 0.25);
        v.gcR = std::sin((pv + 1.0) * kPi * 0.25);

        // --- envolventes: ataque (contacto del martillo) y prompt bifasico
        const double tauA = std::max(0.0002, s_.attackMs * 0.001 / 3.0);
        v.att = 1.0;                                    // (1 - nivel de ataque): decae exponencialmente a 0
        v.attCoef = std::exp(-1.0 / (tauA * sr));
        v.prmFrac = (note < 60 ? 0.40 : 0.50) * (0.7 + 0.3 * vq);
        v.prm = 1.0;
        v.prmCoef = std::exp(-1.0 / (0.45 * std::pow(220.0 / f0, 0.25) * sr));

        // --- ruido de martillo: thump grave + click de ataque
        const double fT = clampT(f0 * 2.2, 90.0, 520.0);
        v.tA = 1.0 - std::exp(-2.0 * kPi * fT / sr);
        const double tRms = voiceRef * 0.55 * std::pow(vq, 1.4) * nf.hammer;
        v.tAmp = tRms / (0.577 * std::sqrt(v.tA / (2.0 - v.tA)));
        v.tDec = std::exp(-1.0 / ((0.012 + 0.018 * (1.0 - vq)) * sr));
        const double fHi = std::min(0.4 * sr, 5200.0 * (0.7 + 0.3 * brightMul)), fLo = 1200.0;
        v.chA = 1.0 - std::exp(-2.0 * kPi * fHi / sr);
        v.clA = 1.0 - std::exp(-2.0 * kPi * fLo / sr);
        const double cRms = voiceRef * 0.30 * vq * vq * (s_.unaCorda ? 0.5 : 1.0) * nf.hammer;
        v.cAmp = cRms / (0.577 * std::sqrt(v.chA / (2.0 - v.chA)));
        v.cDec = std::exp(-1.0 / (0.0035 * sr));
        v.tl = v.ch = v.cl = v.rl = 0.0;
        v.rAmp = 0.0;
        v.nzOn = true;
        // martillo por nota: transitorio de 1 + (h - 1) * exp(-t / 20 ms) sobre la voz entera (0 = ataque suavizado)
        v.hamA = nf.hammer - 1.0; v.hamE = 1.0; v.hamK = std::exp(-1.0 / (0.020 * sr));
    }

    // ---- una voz, m muestras ---------------------------------------------------------
    void renderVoice(Voice& v, int m) {
        // solo se calculan las listas con resonadores; las vacias entran con ganancia 0
        double gl[3], gr[3];
        OscList<16>* l0 = &v.s0; OscList<16>* l2 = &v.s2; OscList<64>* l1 = &v.s1;
        std::fill(t0_, t0_ + m, 0.0); std::fill(t1_, t1_ + m, 0.0); std::fill(t2_, t2_ + m, 0.0);
        gl[0] = l0->n ? v.gl[0] : 0.0; gr[0] = l0->n ? v.gr[0] : 0.0;
        gl[1] = l1->n ? v.gl[1] : 0.0; gr[1] = l1->n ? v.gr[1] : 0.0;
        gl[2] = l2->n ? v.gl[2] : 0.0; gr[2] = l2->n ? v.gr[2] : 0.0;
        if (l0->n) l0->render(t0_, m);
        if (l1->n) l1->render(t1_, m);
        if (l2->n) l2->render(t2_, m);
        const double dm = v.keyUp ? std::exp(-v.relK * damperD_) : 1.0;
        double pk;
        if (v.killing) pk = v.nzOn ? voiceLoop<true, true>(v, m, dm, gl, gr) : voiceLoop<true, false>(v, m, dm, gl, gr);
        else pk = v.nzOn ? voiceLoop<false, true>(v, m, dm, gl, gr) : voiceLoop<false, false>(v, m, dm, gl, gr);
        v.peak = pk;
        v.age += m;
        if (v.killing && v.killEnv <= 0.0) v.active = false;
        else if (v.damp < 1.0e-5) v.active = false;
        else if (v.age > static_cast<int64_t>(0.08 * sr_) && pk < 3.0e-6 && !v.nzOn) v.active = false;   // energia agotada
    }

    template <bool Killing, bool Noise>
    double voiceLoop(Voice& v, int m, double dm, const double* gl, const double* gr) {
        double pk = 0.0;
        const double gl0 = gl[0], gl1 = gl[1], gl2 = gl[2], gr0 = gr[0], gr1 = gr[1], gr2 = gr[2];
        double ea = v.att, prm = v.prm, damp = v.damp;        // v.att guarda (1 - ataque): cadena multiplicativa
        double hamE = v.hamE;
        const double hamA = v.hamA, hamK = v.hamK;
        const double eaC = v.attCoef, prmC = v.prmCoef, pf = v.prmFrac;
        for (int i = 0; i < m; ++i) {
            ea *= eaC;
            prm *= prmC;
            damp *= dm;
            double ke = 1.0;
            if (Killing) { v.killEnv -= v.killStep; if (v.killEnv < 0.0) v.killEnv = 0.0; ke = v.killEnv; }
            const double g = (1.0 - ea) * ((1.0 - pf) + pf * prm) * damp * ke * (1.0 + hamA * hamE);
            hamE *= hamK;
            const double a = t0_[i], b = t1_[i], c = t2_[i];
            pk = std::max(pk, std::fabs((a + b + c) * g));
            double l = g * (a * gl0 + b * gl1 + c * gl2);
            double r = g * (a * gr0 + b * gr1 + c * gr2);
            if (Noise) {
                if (v.nzOn) {
                    const double w = gpRndSigned(v.rng);
                    v.tl += v.tA * (w - v.tl);
                    v.ch += v.chA * (w - v.ch);
                    v.cl += v.clA * (w - v.cl);
                    v.rl += v.rA * (w - v.rl);
                    const double nz = (v.tl * v.tAmp + (v.ch - v.cl) * v.cAmp + v.rl * v.rAmp) * ke;
                    v.tAmp *= v.tDec; v.cAmp *= v.cDec; v.rAmp *= v.rDec;
                    l += nz * v.gcL; r += nz * v.gcR;
                    if (v.tAmp < 1.0e-7 && v.cAmp < 1.0e-7 && v.rAmp < 1.0e-7) v.nzOn = false;
                }
            }
            dryL_[i] += l;
            dryR_[i] += r;
        }
        v.att = ea < 1.0e-9 ? 0.0 : ea; v.prm = prm; v.damp = damp; v.hamE = hamE;
        return pk;
    }

    // ---- cuerdas simpaticas -----------------------------------------------------------
    void designSympathetic() {
        for (int i = 0; i < kSymN; ++i) {
            const int note = 21 + i;
            const double f = fundamental(note);
            const double w = 2.0 * kPi * f / sr_;
            const double t60 = clampT(3.5 * std::pow(110.0 / f, 0.4), 0.8, 8.0);
            const double r = std::exp(-6.907755 / (t60 * sr_));
            sc_[i] = 2.0 * r * std::cos(w);
            sr2_[i] = r * r;
            sg_[i] = 2.0 * (1.0 - r) * std::sin(w);
            const double p = clampT((note - 64.5) / 43.5, -1.0, 1.0) * 0.8;
            sgl_[i] = std::cos((p + 1.0) * kPi * 0.25);
            sgr_[i] = std::sin((p + 1.0) * kPi * 0.25);
        }
    }
    void symDecay(int m) {
        const double f = std::exp(-static_cast<double>(m) / (0.03 * sr_));
        double mx = 0.0;
        for (int i = 0; i < kSymN; ++i) {
            sy1_[i] *= f; sy2_[i] *= f;
            mx = std::max(mx, std::fabs(sy1_[i]));
        }
        if (mx < 1.0e-9) { for (int i = 0; i < kSymN; ++i) sy1_[i] = sy2_[i] = 0.0; symLive_ = false; }
    }
    void symProcess(int m, double gain) {
        for (int i = 0; i < m; ++i) symDrive_[i] = 0.5 * (dryL_[i] + dryR_[i]);
        std::fill(symL_, symL_ + m, 0.0);
        std::fill(symR_, symR_ + m, 0.0);
        for (int g = 0; g < kSymN; g += 4) {
            const double c0 = sc_[g], c1 = sc_[g + 1], c2 = sc_[g + 2], c3 = sc_[g + 3];
            const double a0 = sr2_[g], a1 = sr2_[g + 1], a2 = sr2_[g + 2], a3 = sr2_[g + 3];
            const double i0 = sg_[g], i1 = sg_[g + 1], i2 = sg_[g + 2], i3 = sg_[g + 3];
            const double l0 = sgl_[g], l1 = sgl_[g + 1], l2 = sgl_[g + 2], l3 = sgl_[g + 3];
            const double rr0 = sgr_[g], rr1 = sgr_[g + 1], rr2 = sgr_[g + 2], rr3 = sgr_[g + 3];
            double p0 = sy1_[g], p1 = sy1_[g + 1], p2 = sy1_[g + 2], p3 = sy1_[g + 3];
            double q0 = sy2_[g], q1 = sy2_[g + 1], q2 = sy2_[g + 2], q3 = sy2_[g + 3];
            for (int i = 0; i < m; ++i) {
                const double x = symDrive_[i];
                const double n0 = c0 * p0 - a0 * q0 + i0 * x, n1 = c1 * p1 - a1 * q1 + i1 * x;
                const double n2 = c2 * p2 - a2 * q2 + i2 * x, n3 = c3 * p3 - a3 * q3 + i3 * x;
                q0 = p0; q1 = p1; q2 = p2; q3 = p3;
                p0 = n0; p1 = n1; p2 = n2; p3 = n3;
                symL_[i] += n0 * l0 + n1 * l1 + n2 * l2 + n3 * l3;
                symR_[i] += n0 * rr0 + n1 * rr1 + n2 * rr2 + n3 * rr3;
            }
            sy1_[g] = p0; sy1_[g + 1] = p1; sy1_[g + 2] = p2; sy1_[g + 3] = p3;
            sy2_[g] = q0; sy2_[g + 1] = q1; sy2_[g + 2] = q2; sy2_[g + 3] = q3;
        }
        for (int i = 0; i < m; ++i) { dryL_[i] += symL_[i] * gain; dryR_[i] += symR_[i] * gain; }
        symLive_ = true;
    }

    // ---- cuerpo (tabla armonica) -------------------------------------------------------
    struct BodyStage { BiquadCoefs c; BiquadState s; void reset() { s.reset(); } };
    void designBody() {
        struct Def { FilterType t; double f, g, q; };
        static const Def defs[kBodyN] = {
            { FilterType::HighPass, 24.0, 0.0, 0.707 },
            { FilterType::Bell, 62.0, 2.0, 3.0 },   { FilterType::Bell, 118.0, 2.2, 4.0 },
            { FilterType::Bell, 187.0, 1.8, 4.0 },  { FilterType::Bell, 305.0, 1.5, 4.0 },
            { FilterType::Bell, 520.0, 1.2, 4.0 },  { FilterType::Bell, 880.0, -1.0, 3.0 },
            { FilterType::Bell, 1350.0, 1.2, 2.0 }, { FilterType::Bell, 2400.0, 0.8, 1.2 },
            { FilterType::LowPass, 15500.0, 0.0, 0.6 } };
        for (int i = 0; i < kBodyN; ++i) {
            const bool bell = defs[i].t == FilterType::Bell;
            bodyL_[i].c = BiquadCoefs::design(defs[i].t, sr_, defs[i].f, defs[i].g, defs[i].q);
            bodyR_[i].c = BiquadCoefs::design(defs[i].t, sr_, bell ? defs[i].f * 1.037 : defs[i].f, defs[i].g, defs[i].q);
        }
    }

    // ---- sub-bloque --------------------------------------------------------------------
    void block(int m) {
        // parametros suavizados (interpolados linealmente en el sub-bloque)
        const double v0 = vol_.current(), v1 = vol_.advance(m);
        const double w0 = wet_.current(), w1 = wet_.advance(m);
        const double d0 = width_.current(), d1 = width_.advance(m);
        pedal_ += (pedalTarget_ - pedal_) * (1.0 - std::exp(-static_cast<double>(m) / (0.020 * sr_)));
        if (std::fabs(pedalTarget_ - pedal_) < 1.0e-5) pedal_ = pedalTarget_;
        updateDamperAmount();
        bend_ += (bendTarget_ - bend_) * (1.0 - std::exp(-static_cast<double>(m) / (0.015 * sr_)));
        if (std::fabs(bend_ - bendApplied_) > 0.0015) {
            bendApplied_ = bend_;
            const double ratio = std::pow(2.0, bendApplied_ / 12.0);
            for (auto& v : voices_) if (v.active) { v.s0.retune(ratio); v.s1.retune(ratio); v.s2.retune(ratio); }
        }
        for (auto& v : voices_) {
            if (!v.active || !v.keyUp) continue;
            if (damperD_ > 0.5 && !v.damperFired) fireDamper(v);
            else if (damperD_ < 0.2) v.damperFired = false;
        }

        std::fill(dryL_, dryL_ + m, 0.0);
        std::fill(dryR_, dryR_ + m, 0.0);
        for (auto& v : voices_) if (v.active) renderVoice(v, m);

        // resonancia simpatica (solo con pedal) y su extincion al soltarlo
        if (pedal_ > 0.05 && symAmount_ > 0.0) symProcess(m, 0.25 * pedal_ * symAmount_);
        else if (symLive_) symDecay(m);

        for (int i = 0; i < m; ++i) {
            const double t = static_cast<double>(i + 1) / m;
            // anchura: mid/side
            const double wd = d0 + (d1 - d0) * t;
            const double mid = 0.5 * (dryL_[i] + dryR_[i]), side = 0.5 * (dryL_[i] - dryR_[i]) * wd;
            double l = mid + side, r = mid - side;
            for (int k = 0; k < kBodyN; ++k) {
                l = biquadProcess(bodyL_[k].c, bodyL_[k].s, l);
                r = biquadProcess(bodyR_[k].c, bodyR_[k].s, r);
            }
            dryL_[i] = l; dryR_[i] = r;
        }

        // muestras reales (ya traen su cuerpo): van después del filtro de caja y alimentan la misma sala
        if (sampler_.ready()) sampler_.render(dryL_, dryR_, m);

        // sala FDN
        reverb_.process(dryL_, dryR_, wetL_, wetR_, m);
        const double send = clampT(s_.reverbPct, 0.0, 100.0) * 0.01;
        const double wg = send * kReverbGain;

        for (int i = 0; i < m; ++i) {
            const double t = static_cast<double>(i + 1) / m;
            const double g = (v0 + (v1 - v0) * t) * (w0 + (w1 - w0) * t);
            outL_[i] = gpSoftClip((dryL_[i] + wetL_[i] * wg) * g);
            outR_[i] = gpSoftClip((dryR_[i] + wetR_[i] * wg) * g);
        }
    }

    static constexpr int kBodyN = 10;
    static constexpr double kBodyShare[3] = { 1.0, 0.6, 0.3 };   // reparto del realce de cuerpo entre los 3 primeros parciales
    static constexpr double kReverbGain = 1.0;

    JwSampler::Sampler sampler_;
    bool samplerLoadStarted_{false};
    double sr_{48000.0};
    GrandSettings s_;
    NotaTabla tabla_;
    std::array<NotaForma, kNotas> formas_{};
    NotaForma formaNeutra_{};
    std::array<Voice, kSlots> voices_;
    Smoother vol_, wet_, width_;
    int killLen_{240}, retrigLen_{1440};
    uint64_t order_{0};
    double pedal_{0.0}, pedalTarget_{0.0}, damperD_{1.0};
    double bend_{0.0}, bendTarget_{0.0}, bendApplied_{0.0};
    // cuerdas simpaticas
    double sc_[kSymN]{}, sr2_[kSymN]{}, sg_[kSymN]{}, sgl_[kSymN]{}, sgr_[kSymN]{}, sy1_[kSymN]{}, sy2_[kSymN]{};
    bool symLive_{false};
    double symAmount_{1.0};
    BodyStage bodyL_[kBodyN], bodyR_[kBodyN];
    HallReverb reverb_;
    JasWaveFx::FxRack fx_;   // FX Rack comun
    // buffers de trabajo (preasignados)
    double t0_[kBlk]{}, t1_[kBlk]{}, t2_[kBlk]{}, dryL_[kBlk]{}, dryR_[kBlk]{}, wetL_[kBlk]{}, wetR_[kBlk]{};
    double symDrive_[kBlk]{}, symL_[kBlk]{}, symR_[kBlk]{}, outL_[kBlk]{}, outR_[kBlk]{};
};

} // namespace JasWaveGrandPiano
