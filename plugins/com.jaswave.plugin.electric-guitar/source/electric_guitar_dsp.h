// =====================================================================================
//  JasWave Electric Guitar – guitarra eléctrica de worship moderno (sin muestras, sin asignaciones en render)
//   CUERDA : guía de ondas (Karplus-Strong ampliado) con retardo fraccional Lagrange cúbico y compensación
//            analítica del retardo de fase de los filtros del lazo (afinación < 5 cents E2..E6), dos
//            polarizaciones (vertical/horizontal) ligeramente desafinadas, rigidez (allpass), posición de púa
//            (peine), ataque de púa y ruido de cuerda según velocidad, palm mute por note-off corto,
//            sustain de lead por realimentación acotada (nunca infinito), pitch bend y vibrato (CC1).
//   AMP    : puerta suave -> preamp con ganancia -> saturador asimétrico tipo válvula de 2 etapas con
//            sobremuestreo 4x/2x (FIR Kaiser) -> tone stack -> simulación de pantalla 4x12 (cadena de filtros)
//   FX     : chorus real (líneas moduladas L/R), delay ping-pong con sincronía al tempo del host y feedback
//            filtrado, reverb de plato FDN 8x8 (Hadamard) con amortiguación
//   HÍBRIDO: si el banco de muestras `electric-guitar.jws` (FreePats EGuitarFSBS-clean, CC0) está cargado, las notas
//            28..96 suenan con él y pasan por una cadena limpia estéreo (drive suave, tono, pantalla «de micro»
//            suave, chorus, delay, reverb); si no, o fuera de ese rango, suena el modelado de cuerda de arriba.
//   Polifonía 16 voces con strum natural cuando llegan notas casi simultáneas; robo de la voz más antigua (5 ms).
//   TÉCNICAS: slides/glissando (legato por solape o modo Slide, slide-in/out), hammer-on/pull-off, rasgueo con dirección y velocidad
//            por cuerda, palm mute, notas muertas, armónicos (síntesis aditiva), pre-bend/bend-up, vibrato con retardo, tremolo
//            picking, volume swell (CC11 y auto-swell) y ruidos de dedo/traste/púa sintetizados. Contrato MIDI más abajo.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_fxrack.h"
#include "jw_params.h"
#include "jw_sampler.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace JasWaveElectricGuitar {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kAmpGain = 0, kCabSim = 1, kTone = 2, kDelayFeedback = 3, kChorusMix = 4, kBypass = 5, kVolume = 6,
    kDelayMix = 7, kDelayDiv = 8, kDelayTime = 9, kReverbMix = 10, kPickPos = 11, kSustain = 12,
    kBendRange = 13, kBendParam = 14, kModWheel = 15, kPedal = 16, kStrum = 17,
    kLowCut = 18, kHighCut = 19, kWidth = 20, kComp = 21, kTape = 22,  // acabado «suave»: ids nuevos al final
    // ---- técnicas de guitarra (ids nuevos al final; solo automatizables, el editor nativo no tiene huecos) ----
    kExpression = 23, kArticulation = 24, kLegatoSlide = 25, kSlideTime = 26, kSlideCurve = 27, kSlideMode = 28,
    kSlideRange = 29, kStrumDir = 30, kStrumAccent = 31, kPickNoise = 32, kVibDelay = 33, kSwellTime = 34,
    kBendAmount = 35, kTremRate = 36
};
enum Feature : int { kFeatCab = 0 };

// ---- CONTRATO MIDI de técnicas (documentado también en jaswave-plugin.json y shared/src/music/worship/guitarra-tecnicas.ts) ----
// Keyswitches (notas por DEBAJO del registro de la guitarra, sin sonido; número de nota MIDI con C4 = 60, es decir C0 = 12):
//   12 C0  Normal (reinicia articulación, legato, dirección de rasgueo y auto-swell)  [fijo]
//   13 C#0 Palm mute   14 D0 Nota muerta/ghost   15 D#0 Armónico natural   16 E0 Armónico artificial (pinch)
//   17 F0  Tremolo picking                                                        [fijos hasta otra articulación]
//   18 F#0 Slide-in desde abajo   19 G0 Slide-out hacia abajo   20 G#0 Slide-out hacia arriba   [solo la SIGUIENTE nota]
//   21 A0  Pre-bend (empieza doblada y se relaja)   22 A#0 Bend-up (la nota sube tras el ataque)  [solo la SIGUIENTE nota]
//   23 B0  Modo LEGATO: nota solapada = hammer-on/pull-off (<= 3 st) o slide (4..12 st)   [fijo]
//   24 C1  Modo SLIDE: toda nota solapada (o que llega con la anterior aún sonando) se desliza  [fijo]
//   25 C#1 Rasgueo abajo   26 D1 Rasgueo arriba   27 D#1 Rasgueo alterno                       [fijos]
//   11 B-1 Auto-swell (cada nota entra con subida de volumen estilo pedal)                    [fijo]
// Sin modo Legato/Slide las notas solapadas NO se ligan (los arpegios de guitarra solapan sus notas largas a propósito).
// CC: 1 vibrato (con retardo de entrada), 11 expresión/swell de pedal, 64 sustain, pitch bend de rueda, y (equivalentes a parámetros):
//     80 articulación (valores 0,25,51,76,102,127 = normal, palm mute, nota muerta, armónico natural, artificial, tremolo picking),
//     81 legato/slide (0-31 off, 32-95 legato, 96-127 slide), 82 dirección de rasgueo (0-31 abajo, 32-95 arriba, 96-127 alterno),
//     83 slide in/out permanente (0 off, 42 slide-in, 85 slide-out abajo, 127 slide-out arriba).
enum : int {
    kKsFirst = 11, kKsAutoSwell = 11, kKsNormal = 12, kKsPalm = 13, kKsDead = 14, kKsHarmNat = 15, kKsHarmArt = 16, kKsTremolo = 17,
    kKsSlideIn = 18, kKsSlideOutDown = 19, kKsSlideOutUp = 20, kKsPreBend = 21, kKsBendUp = 22, kKsLegato = 23, kKsSlide = 24,
    kKsStrumDown = 25, kKsStrumUp = 26, kKsStrumAlt = 27, kKsLast = 27
};
enum : int { kCcExpression = 11, kCcArt = 80, kCcLegato = 81, kCcStrumDir = 82, kCcSlideMode = 83 };
enum : int { kLegOff = 0, kLegAuto = 1, kLegSlide = 2 };
enum Artic : int { kArtNormal = 0, kArtPalm = 1, kArtDead = 2, kArtHarmNat = 3, kArtHarmArt = 4, kArtTremolo = 5 };

constexpr int kMaxVoices = 16;
constexpr int kChunk = 32;            // sub-bloque de control (bend, vibrato, ganancias)
constexpr int kMinNote = 28, kMaxNote = 108;
constexpr int kSampMinNote = 28, kSampMaxNote = 96;   // rango cubierto por el banco de muestras

inline const char* const* labelsDelayDiv() {
    static const char* const l[] = { "1/8 dotted", "1/4", "1/8", "1/16", "Free (ms)" };
    return l;
}
inline const char* const* labelsBendRange() {
    static const char* const l[] = { "2 st", "12 st" };
    return l;
}

inline const char* const* labelsArticulation() {
    static const char* const l[] = { "Normal", "Palm Mute", "Dead Note", "Nat. Harmonic", "Art. Harmonic", "Tremolo Pick" };
    return l;
}
inline const char* const* labelsLegato() {
    static const char* const l[] = { "Off", "Legato", "Slide" };
    return l;
}
inline const char* const* labelsSlideMode() {
    static const char* const l[] = { "Off", "Slide In", "Slide Out Down", "Slide Out Up" };
    return l;
}
inline const char* const* labelsStrumDir() {
    static const char* const l[] = { "Down", "Up", "Alternate" };
    return l;
}

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kAmpGain, "Amp Gain", "%", 0.0, 100.0, 20.0, 0));
        v.push_back(withFeature(linearP(kCabSim, "4x12 Cab Sim", "%", 0.0, 100.0, 35.0, 0), kFeatCab));
        v.push_back(linearP(kTone, "Tone", "%", 0.0, 100.0, 55.0, 0));
        v.push_back(linearP(kDelayFeedback, "Delay Feedback", "%", 0.0, 95.0, 38.0, 0));
        v.push_back(linearP(kChorusMix, "Chorus Mix", "%", 0.0, 100.0, 22.0, 0));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kDelayMix, "Delay Mix", "%", 0.0, 100.0, 28.0, 0));
        v.push_back(stepP(kDelayDiv, "Delay Division", 4, 0, labelsDelayDiv()));
        v.push_back(logP(kDelayTime, "Delay Time", "ms", 40.0, 2000.0, 380.0, 0));
        v.push_back(linearP(kReverbMix, "Reverb Mix", "%", 0.0, 100.0, 22.0, 0));
        v.push_back(linearP(kPickPos, "Pick Position", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(linearP(kSustain, "Lead Sustain", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(stepP(kBendRange, "Bend Range", 1, 0, labelsBendRange()));
        v.push_back(linearP(kBendParam, "Pitch Bend", "", -1.0, 1.0, 0.0, 2, true));
        v.push_back(linearP(kModWheel, "Mod Wheel", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(toggleP(kPedal, "Sustain Pedal", 0));
        v.push_back(linearP(kStrum, "Strum", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(logP(kLowCut, "Low Cut", "Hz", 20.0, 400.0, 70.0, 0));
        v.push_back(logP(kHighCut, "High Cut", "Hz", 2500.0, 20000.0, 9000.0, 0));
        v.push_back(linearP(kWidth, "Stereo Width", "%", 0.0, 150.0, 90.0, 0));
        v.push_back(linearP(kComp, "Soft Compressor", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(linearP(kTape, "Tape Warmth", "%", 0.0, 100.0, 15.0, 0));
        v.push_back(linearP(kExpression, "Expression (CC11)", "%", 0.0, 100.0, 100.0, 0));
        v.push_back(stepP(kArticulation, "Articulation", 5, 0, labelsArticulation()));
        v.push_back(stepP(kLegatoSlide, "Legato / Slide", 2, 0, labelsLegato()));
        v.push_back(logP(kSlideTime, "Slide Time", "ms", 40.0, 1500.0, 140.0, 0));
        v.push_back(linearP(kSlideCurve, "Slide Curve", "%", -100.0, 100.0, 0.0, 0, true));
        v.push_back(stepP(kSlideMode, "Slide In/Out", 3, 0, labelsSlideMode()));
        v.push_back(linearP(kSlideRange, "Slide Range", "st", 1.0, 12.0, 5.0, 1));
        v.push_back(stepP(kStrumDir, "Strum Direction", 2, 0, labelsStrumDir()));
        v.push_back(linearP(kStrumAccent, "Strum Accent", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kPickNoise, "Pick/Fret Noise", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(linearP(kVibDelay, "Vibrato Delay", "ms", 0.0, 1500.0, 350.0, 0));
        v.push_back(linearP(kSwellTime, "Auto Swell Time", "ms", 0.0, 3000.0, 0.0, 0));
        v.push_back(linearP(kBendAmount, "Bend Amount", "st", 0.5, 4.0, 2.0, 1));
        v.push_back(linearP(kTremRate, "Tremolo Pick Rate", "Hz", 4.0, 16.0, 9.0, 1));
        marcarBasicos(v, { kBypass, kVolume, kAmpGain, kTone, kCabSim, kReverbMix });   // modo Básico del editor
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..): EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura (tras la cadena propia)
        return v;
    }();
    return defs;
}

struct GuitarSettings {
    double ampGain{0.20}, cab{0.35}, tone{0.55}, delayFb{0.38}, chorusMix{0.22}, delayMix{0.28}, reverbMix{0.22};
    double pickPos{0.30}, sustain{0.0}, strum{0.5}, volumeDb{0.0}, delayTimeMs{380.0};
    double lowCutHz{70.0}, highCutHz{9000.0}, width{0.9}, comp{0.3}, tape{0.15};   // acabado: EQ de corte, anchura, compresor suave, cinta
    int delayDiv{0};          // 0: 1/8 con puntillo, 1: 1/4, 2: 1/8, 3: 1/16, 4: libre (ms)
    int bendRange{2};         // semitonos (2 ó 12)
    bool bypass{false};
    // ---- técnicas ----
    double slideTimeMs{140.0}, slideCurve{0.0}, slideRange{5.0}, strumAccent{0.5}, pickNoise{0.4};
    double vibDelayMs{350.0}, swellTimeMs{0.0}, bendAmount{2.0}, tremRate{9.0}, expression{1.0};
    int articulation{0};      // Artic; el motor solo reacciona a CAMBIOS del parámetro (los keyswitches/CC mandan entre cambios)
    int slideMode{0};         // 0 off, 1 slide-in, 2 slide-out abajo, 3 slide-out arriba (todas las notas)
    int strumDir{0};          // 0 abajo, 1 arriba, 2 alterno
    int legatoSlide{0};       // 0 off, 1 legato (hammer/pull/slide por solape), 2 slide siempre
};

struct GuitarBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<uint64_t> keys[2]{};
    std::atomic<float> delayMs{0.0f};
    std::atomic<float> bendSt{0.0f};
};

// ---- utilidades numéricas ----
inline uint32_t xs32(uint32_t& s) { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
inline double rnd01(uint32_t& s) { return static_cast<double>(xs32(s)) * (1.0 / 4294967296.0); }
inline double rndS(uint32_t& s) { return rnd01(s) * 2.0 - 1.0; }
inline int pow2AtLeast(double n) { int p = 16; while (p < n) p <<= 1; return p; }

// Retardo de fase (muestras) y módulo de un filtro de primer orden (b0 + b1 z^-1)/(1 + a1 z^-1) en w (rad/muestra)
inline double phaseDelay1(double b0, double b1, double a1, double w) {
    const double cw = std::cos(w), sw = std::sin(w);
    const double argN = std::atan2(-b1 * sw, b0 + b1 * cw), argD = std::atan2(-a1 * sw, 1.0 + a1 * cw);
    return -(argN - argD) / w;
}
inline double mag1(double b0, double b1, double a1, double w) {
    const double cw = std::cos(w), sw = std::sin(w);
    const double nr = b0 + b1 * cw, ni = -b1 * sw, dr = 1.0 + a1 * cw, di = -a1 * sw;
    return std::sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

// floor() rápido para |x| < 1e6 (sin llamada a la CRT)
inline int64_t fastFloor(double x) { return static_cast<int64_t>(x + 1048576.0) - 1048576; }
// tanh racional C1 (exacto en 0, saturación en |x| >= 3): barato y suave para el saturador
inline double fastTanh(double x) {
    if (x >= 3.0) return 1.0;
    if (x <= -3.0) return -1.0;
    const double x2 = x * x;
    return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

// Interpolación Lagrange cúbica entre x0 (t=0) y x1 (t=1)
inline double lagrange3(double xm1, double x0, double x1, double x2, double t) {
    const double c0 = -t * (t - 1.0) * (t - 2.0) * (1.0 / 6.0);
    const double c1 = (t + 1.0) * (t - 1.0) * (t - 2.0) * 0.5;
    const double c2 = -(t + 1.0) * t * (t - 2.0) * 0.5;
    const double c3 = (t + 1.0) * t * (t - 1.0) * (1.0 / 6.0);
    return c0 * xm1 + c1 * x0 + c2 * x1 + c3 * x2;
}

// Soft limiter continuo (derivada 1 en la rodilla): |y| < 1 siempre
inline double softLimit(double x) {
    const double a = std::fabs(x);
    if (a <= 0.7) return x;
    const double y = 0.7 + 0.27 * std::tanh((a - 0.7) / 0.27);
    return x < 0 ? -y : y;
}

// ---- sobremuestreo FIR Kaiser (polifásico) ----
class Oversampler {
public:
    void prepare(int factor) {
        F = factor;
        if (F <= 1) { F = 1; return; }
        const int K = 32;
        N = K * F;
        h.assign(static_cast<size_t>(N), 0.0);
        const double fc = 0.47 / F;                 // frecuencia de corte normalizada a la tasa sobremuestreada
        const double beta = 7.5;
        auto bessel0 = [](double x) { double s = 1, t = 1; for (int k = 1; k < 40; ++k) { t *= (x / (2.0 * k)) * (x / (2.0 * k)); s += t; } return s; };
        double sum = 0;
        for (int i = 0; i < N; ++i) {
            const double m = i - (N - 1) * 0.5;
            const double sinc = std::fabs(m) < 1e-12 ? 2.0 * fc : std::sin(2.0 * kPi * fc * m) / (kPi * m);
            const double r = 2.0 * i / (N - 1) - 1.0;
            const double win = bessel0(beta * std::sqrt(std::max(0.0, 1.0 - r * r))) / bessel0(beta);
            h[static_cast<size_t>(i)] = sinc * win;
            sum += h[static_cast<size_t>(i)];
        }
        for (auto& v : h) v /= sum;
        upHist.assign(static_cast<size_t>(2 * K), 0.0);
        dnHist.assign(static_cast<size_t>(2 * N), 0.0);
        upPos = 0; dnPos = 0;
        K_ = K;
    }
    void reset() { std::fill(upHist.begin(), upHist.end(), 0.0); std::fill(dnHist.begin(), dnHist.end(), 0.0); upPos = dnPos = 0; }
    int factor() const { return F; }
    // Sube un muestra base a F muestras (out[0..F-1])
    void up(double x, double* out) {
        if (F == 1) { out[0] = x; return; }
        upPos = (upPos + K_ - 1) % K_;
        upHist[static_cast<size_t>(upPos)] = upHist[static_cast<size_t>(upPos + K_)] = x;
        const double* hx = &upHist[static_cast<size_t>(upPos)];
        for (int p = 0; p < F; ++p) {
            // cuatro acumuladores independientes (rompe la cadena de dependencias de la suma)
            const double* hp = &h[static_cast<size_t>(p)];
            double a0 = 0, a1 = 0, a2 = 0, a3 = 0;
            for (int k = 0; k < K_; k += 4) {
                a0 += hp[(k) * F] * hx[k];
                a1 += hp[(k + 1) * F] * hx[k + 1];
                a2 += hp[(k + 2) * F] * hx[k + 2];
                a3 += hp[(k + 3) * F] * hx[k + 3];
            }
            out[p] = ((a0 + a1) + (a2 + a3)) * F;
        }
    }
    // Baja F muestras sobremuestreadas a una base
    double down(const double* in) {
        if (F == 1) return in[0];
        for (int p = 0; p < F; ++p) {
            dnPos = (dnPos + N - 1) % N;
            dnHist[static_cast<size_t>(dnPos)] = dnHist[static_cast<size_t>(dnPos + N)] = in[p];
        }
        const double* hx = &dnHist[static_cast<size_t>(dnPos)];
        const double* hp = h.data();
        double a0 = 0, a1 = 0, a2 = 0, a3 = 0;
        for (int k = 0; k < N; k += 4) {
            a0 += hp[k] * hx[k];
            a1 += hp[k + 1] * hx[k + 1];
            a2 += hp[k + 2] * hx[k + 2];
            a3 += hp[k + 3] * hx[k + 3];
        }
        return (a0 + a1) + (a2 + a3);
    }
private:
    int F{1}, N{0}, K_{0}, upPos{0}, dnPos{0};
    std::vector<double> h, upHist, dnHist;
};

// ---- chorus real: líneas de retardo moduladas L/R ----
class Chorus {
public:
    void prepare(double sr) {
        sr_ = sr;
        size_ = pow2AtLeast(sr * 0.06 + 8);
        mask_ = size_ - 1;
        buf_.assign(static_cast<size_t>(size_), 0.0f);
        w_ = 0; phase_ = 0.0; first_ = true; cnt_ = 0;
    }
    void reset() { std::fill(buf_.begin(), buf_.end(), 0.0f); phase_ = 0.0; first_ = true; cnt_ = 0; }
    // Devuelve solo la señal húmeda (modulada) en wl/wr
    void process(double in, double& wl, double& wr) {
        buf_[static_cast<size_t>(w_ & mask_)] = static_cast<float>(in);
        if ((cnt_++ & 7) == 0) {          // el LFO se evalúa cada 8 muestras y se interpola (0.62 Hz: variación mínima)
            const double depth = 0.0030 * sr_ * 0.8;
            dL0_ = dL1_; dR0_ = dR1_;
            const double ph = phase_ + 8.0 * 0.62 / sr_;
            dL1_ = 0.0140 * sr_ + depth * (std::sin(2.0 * kPi * ph) + 0.25 * std::sin(2.0 * kPi * ph * 3.0 + 1.3));
            dR1_ = 0.0175 * sr_ + depth * (std::sin(2.0 * kPi * ph + 0.5 * kPi) + 0.25 * std::sin(2.0 * kPi * ph * 3.0 + 2.9));
            stepL_ = (dL1_ - dL0_) * 0.125; stepR_ = (dR1_ - dR0_) * 0.125;
            dL_ = dL0_; dR_ = dR0_;
            if (first_) { dL_ = dL1_; dR_ = dR1_; first_ = false; }
        }
        dL_ += stepL_; dR_ += stepR_;
        wl = tap(dL_);
        wr = tap(dR_);
        phase_ += 0.62 / sr_;
        if (phase_ >= 1.0) phase_ -= 1.0;
        ++w_;
    }
private:
    double tap(double d) const {
        const double r = static_cast<double>(w_) - d;
        const int64_t ip = fastFloor(r);
        const double t = r - static_cast<double>(ip);
        const double a = buf_[static_cast<size_t>(ip & mask_)], b = buf_[static_cast<size_t>((ip + 1) & mask_)];
        return a + (b - a) * t;
    }
    double sr_{48000.0}, phase_{0.0};
    double dL0_{0}, dL1_{0}, dR0_{0}, dR1_{0}, dL_{0}, dR_{0}, stepL_{0}, stepR_{0};
    int cnt_{0};
    bool first_{true};
    int size_{16}, mask_{15};
    int64_t w_{0};
    std::vector<float> buf_;
};

// ---- delay ping-pong con feedback filtrado ----
class PingPongDelay {
public:
    static constexpr double kMaxSeconds = 2.0;
    void prepare(double sr) {
        sr_ = sr;
        size_ = pow2AtLeast(sr * (kMaxSeconds + 0.1) + 8);
        mask_ = size_ - 1;
        bl_.assign(static_cast<size_t>(size_), 0.0f);
        br_.assign(static_cast<size_t>(size_), 0.0f);
        maxDelay_ = sr * kMaxSeconds;
        glide_ = 1.0 / (0.10 * sr);
        hpC_ = std::exp(-2.0 * kPi * 170.0 / sr);
        lpC_ = std::exp(-2.0 * kPi * 3800.0 / sr);
        reset();
        dcur_ = dtar_ = 0.38 * sr;
    }
    void reset() {
        std::fill(bl_.begin(), bl_.end(), 0.0f); std::fill(br_.begin(), br_.end(), 0.0f);
        w_ = 0; hpL_ = hpR_ = lpL_ = lpR_ = hxL_ = hxR_ = 0;
    }
    void setTimeSamples(double d) { dtar_ = clampT(d, 16.0, maxDelay_); }
    void jumpTimeSamples(double d) { setTimeSamples(d); dcur_ = dtar_; }   // sin glide (pruebas / reset)
    void setFeedback(double fb) { fb_ = clampT(fb, 0.0, 0.95); }
    double timeMs() const { return dtar_ / sr_ * 1000.0; }
    void process(double in, double& wl, double& wr) {
        dcur_ += (dtar_ - dcur_) * glide_;
        const double tl = tap(bl_, dcur_), tr = tap(br_, dcur_);
        // realimentación cruzada con HPF + LPF de un polo (|H| <= 1 => estable con fb < 1)
        const double fL = filt(tr, hxL_, hpL_, lpL_), fR = filt(tl, hxR_, hpR_, lpR_);
        bl_[static_cast<size_t>(w_ & mask_)] = static_cast<float>(in + fb_ * fL);
        br_[static_cast<size_t>(w_ & mask_)] = static_cast<float>(fb_ * fR);
        ++w_;
        wl = tl; wr = tr;
    }
private:
    double filt(double x, double& hx, double& hp, double& lp) {
        hp = hpC_ * hp + 0.5 * (1.0 + hpC_) * (x - hx);   // pasa-altos de un polo
        hx = x;
        lp = (1.0 - lpC_) * hp + lpC_ * lp;
        return lp;
    }
    double tap(const std::vector<float>& b, double d) const {
        const double r = static_cast<double>(w_) - d;
        const int64_t ip = fastFloor(r);
        const double t = r - static_cast<double>(ip);
        const double a = b[static_cast<size_t>(ip & mask_)], c = b[static_cast<size_t>((ip + 1) & mask_)];
        return a + (c - a) * t;
    }
    double sr_{48000.0}, maxDelay_{96000.0}, dcur_{0}, dtar_{0}, glide_{0.001}, fb_{0.3}, hpC_{0.98}, lpC_{0.6};
    double hpL_{0}, hpR_{0}, lpL_{0}, lpR_{0}, hxL_{0}, hxR_{0};
    int size_{16}, mask_{15};
    int64_t w_{0};
    std::vector<float> bl_, br_;
};

// ---- reverb de plato: difusores + FDN 8x8 Hadamard con amortiguación ----
class PlateReverb {
public:
    static constexpr int N = 8;
    void prepare(double sr) {
        const double sc = sr / 48000.0;
        static const int base[N] = { 743, 887, 1031, 1187, 1327, 1481, 1619, 1783 };
        int maxLen = 16;
        for (int i = 0; i < N; ++i) { len_[i] = std::max(8, static_cast<int>(base[i] * sc + 0.5)); maxLen = std::max(maxLen, len_[i]); }
        size_ = pow2AtLeast(maxLen + 8);
        mask_ = size_ - 1;
        for (int i = 0; i < N; ++i) line_[i].assign(static_cast<size_t>(size_), 0.0f);
        const double rt60 = 1.7;
        for (int i = 0; i < N; ++i) g_[i] = std::pow(10.0, -3.0 * len_[i] / (rt60 * sr));
        damp_ = 1.0 - std::exp(-2.0 * kPi * 5500.0 / sr);
        static const int apBase[2] = { 142, 107 };
        for (int i = 0; i < 2; ++i) {
            apLen_[i] = std::max(4, static_cast<int>(apBase[i] * sc + 0.5));
            ap_[i].assign(static_cast<size_t>(pow2AtLeast(apLen_[i] + 4)), 0.0f);
            apMask_[i] = static_cast<int>(ap_[i].size()) - 1;
        }
        reset();
    }
    void reset() {
        for (int i = 0; i < N; ++i) { std::fill(line_[i].begin(), line_[i].end(), 0.0f); lp_[i] = 0; }
        for (int i = 0; i < 2; ++i) std::fill(ap_[i].begin(), ap_[i].end(), 0.0f);
        w_ = 0; apW_[0] = apW_[1] = 0;
    }
    void process(double in, double& wl, double& wr) {
        double x = in;
        for (int a = 0; a < 2; ++a) {                      // allpass de Schroeder g = 0.6
            const double d = ap_[a][static_cast<size_t>((apW_[a] - apLen_[a]) & apMask_[a])];
            const double v = x - 0.6 * d;
            ap_[a][static_cast<size_t>(apW_[a] & apMask_[a])] = static_cast<float>(v);
            x = d + 0.6 * v;
            ++apW_[a];
        }
        double s[N];
        for (int i = 0; i < N; ++i) {
            const double r = line_[i][static_cast<size_t>((w_ - len_[i]) & mask_)];
            lp_[i] += damp_ * (r - lp_[i]);
            s[i] = lp_[i] * g_[i];
        }
        // Hadamard 8x8 (butterflies) escalada 1/sqrt(8): ortogonal => estable con g < 1
        double t[N];
        for (int i = 0; i < N; i += 2) { t[i] = s[i] + s[i + 1]; t[i + 1] = s[i] - s[i + 1]; }
        double u[N];
        for (int i = 0; i < N; i += 4) { u[i] = t[i] + t[i + 2]; u[i + 2] = t[i] - t[i + 2]; u[i + 1] = t[i + 1] + t[i + 3]; u[i + 3] = t[i + 1] - t[i + 3]; }
        double v[N];
        for (int i = 0; i < 4; ++i) { v[i] = u[i] + u[i + 4]; v[i + 4] = u[i] - u[i + 4]; }
        const double k = 0.35355339059327373;
        for (int i = 0; i < N; ++i) line_[i][static_cast<size_t>(w_ & mask_)] = static_cast<float>(v[i] * k + x * 0.5);
        ++w_;
        double l = 0, r = 0;
        for (int i = 0; i < N; ++i) { if (i & 1) r += s[i]; else l += s[i]; }
        wl = l * 0.5; wr = r * 0.5;
    }
private:
    int len_[N]{}, size_{16}, mask_{15}, apLen_[2]{}, apMask_[2]{};
    int64_t w_{0}, apW_[2]{};
    double g_[N]{}, lp_[N]{}, damp_{0.5};
    std::vector<float> line_[N], ap_[2];
};

// ---- ruidos sintetizados de técnica (dedo sobre la cuerda, traste, púa, golpe muerto): ruido blanco -> filtro de estado variable ----
struct FxVoice {
    enum Kind : int { kRelease = 0, kScrape = 1, kSlide = 2, kThump = 3 };
    bool active{false};
    int kind{0};
    int64_t pos{0}, len{1};
    double amp{0}, f0{3000}, f1{3000}, rate{0}, q{0.6}, low{0}, band{0};
    uint32_t rng{1};
    void start(int k, double sr, double seconds, double a, double fa, double fb, double ratehz, uint32_t seed) {
        active = true; kind = k; pos = 0; len = std::max<int64_t>(8, static_cast<int64_t>(seconds * sr));
        amp = a; f0 = fa; f1 = fb; rate = ratehz; low = band = 0.0; rng = seed ? seed : 1u;
        q = (k == kThump) ? 1.1 : 0.55;
    }
    // suma `n` muestras en out
    void render(double* out, int n, double sr) {
        for (int i = 0; i < n && active; ++i) {
            const double x = static_cast<double>(pos) / static_cast<double>(len);
            double env;
            switch (kind) {
                case kRelease: env = (x < 0.1 ? x * 10.0 : 1.0) * std::exp(-5.0 * x); break;
                case kScrape: env = std::pow(std::sin(kPi * x), 0.8); break;
                case kSlide: env = std::pow(std::sin(kPi * x), 0.6) * (0.78 + 0.22 * std::sin(2.0 * kPi * rate * static_cast<double>(pos) / sr)); break;
                default: env = std::min(1.0, static_cast<double>(pos) * 0.02) * std::exp(-6.0 * x); break;
            }
            const double fc = f0 + (f1 - f0) * x;
            const double f = 2.0 * std::sin(kPi * std::min(fc, 0.16 * sr) / sr);
            const double white = rndS(rng);
            const double high = white - low - q * band;
            band += f * high;
            low += f * band;
            out[i] += band * env * amp;
            if (++pos >= len) active = false;
        }
    }
};

// ---- armónicos (natural / artificial): parciales senoidales con decaimiento propio, osciladores por recurrencia ----
struct HarmVoice {
    static constexpr int kP = 5;
    bool active{false}, keyUp{false}, released{false};
    int note{0}, nPart{3};
    int64_t order{0};
    double f{440.0}, relMul{0.9995}, att{0.0}, attStep{0.01};
    double zr[kP]{}, zi[kP]{}, wr[kP]{}, wi[kP]{}, a[kP]{}, d[kP]{}, e[kP]{};
    double relG{1.0};
    void start(int n, double vel, bool artificial, double sr, uint32_t seed, double gainMul = 1.0) {
        active = true; keyUp = released = false; note = n; relG = 1.0; att = 0.0;
        attStep = 1.0 / std::max(8.0, 0.0008 * sr);
        f = 440.0 * std::pow(2.0, (n - 69) / 12.0);
        nPart = artificial ? 5 : 3;
        static const double aNat[kP] = { 1.0, 0.10, 0.035, 0.0, 0.0 }, aArt[kP] = { 1.0, 0.55, 0.30, 0.16, 0.09 };
        static const double tNat[kP] = { 3.2, 1.6, 0.9, 0.5, 0.3 }, tArt[kP] = { 2.4, 1.3, 0.8, 0.5, 0.3 };
        const double lvl = 0.28 * gainMul * (0.10 + 0.30 * std::pow(vel, 1.2));   // los armónicos suenan bastante por debajo de una nota pisada
        const double regDecay = std::pow(110.0 / std::max(f, 110.0), 0.25);
        const double ph0 = (seed & 1023) * (2.0 * kPi / 1024.0);
        for (int k = 0; k < kP; ++k) {
            a[k] = (artificial ? aArt[k] : aNat[k]) * lvl;
            const double t60 = (artificial ? tArt[k] : tNat[k]) * regDecay;
            d[k] = std::pow(10.0, -3.0 / (t60 * sr));
            e[k] = 1.0;
            const double ph = ph0 * (k + 1);
            zr[k] = std::cos(ph); zi[k] = std::sin(ph);
        }
        setRate(1.0, sr);
    }
    void setRate(double mul, double sr) {   // mul: factor de afinación por bend/vibrato
        for (int k = 0; k < kP; ++k) {
            const double fk = f * mul * (k + 1) * (1.0 + 0.0002 * k * k);
            const double w = 2.0 * kPi * std::min(fk, 0.45 * sr) / sr;
            wr[k] = std::cos(w); wi[k] = std::sin(w);
            const double nrm = 1.0 / std::sqrt(zr[k] * zr[k] + zi[k] * zi[k]);   // renormaliza la fase (sin deriva de amplitud)
            zr[k] *= nrm; zi[k] *= nrm;
        }
    }
    void release(double sr, double sec) { if (released) return; released = true; relMul = std::pow(10.0, -3.0 / (sec * sr)); }
    void render(double* out, int n) {
        double peak = 0.0;
        for (int i = 0; i < n; ++i) {
            double s = 0.0;
            for (int k = 0; k < nPart; ++k) {
                const double r = zr[k] * wr[k] - zi[k] * wi[k], im = zr[k] * wi[k] + zi[k] * wr[k];
                zr[k] = r; zi[k] = im;
                s += a[k] * e[k] * im;
                e[k] *= d[k];
            }
            if (att < 1.0) { att = std::min(1.0, att + attStep); s *= att; }
            if (released) relG *= relMul;
            s *= relG;
            peak = std::max(peak, std::fabs(s));
            out[i] += s;
        }
        (void)peak;
        if ((released && relG < 1.0e-4) || a[0] * e[0] < 1.0e-6) active = false;
    }
};

// Cadena limpia por canal para el banco de muestras: pasa-altos, drive suave sobremuestreado, tono, pantalla suave
struct SampChain {
    Oversampler os;
    BiquadState hp, tone[4], cab[4];
    double di{0};
    void reset() { os.reset(); hp.reset(); for (auto& b : tone) b.reset(); for (auto& b : cab) b.reset(); di = 0; }
};

// =====================================================================================
class GuitarEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        lineSize_ = pow2AtLeast(sr_ / 20.0 + 16);           // soporta E1 con bend -12 st sin salir del buffer
        lineMask_ = lineSize_ - 1;
        for (auto& v : voices_) { v.store.assign(static_cast<size_t>(2 * lineSize_), 0.0); v.active = false; }
        scratch_.assign(static_cast<size_t>(lineSize_), 0.0);
        scratch2_.assign(static_cast<size_t>(lineSize_), 0.0);
        const int F = sr_ <= 56000.0 ? 4 : (sr_ <= 112000.0 ? 2 : 1);
        os_.prepare(F);
        osF_ = F;
        for (auto& c : samp_) c.os.prepare(F);
        sampler_.prepare(sr_);
        sampler_.setHumanize({ 0.7f, 2.5f, 2.0f, 0.85f });   // las capas se normalizan al mismo nivel: la dinámica la da la curva de velocidad
        sampler_.setReleaseScale(0.28f);
        sampler_.setLevelDb(1.5f);
        if (!samplerLoadStarted_) { samplerLoadStarted_ = true; sampler_.startLoad("electric-guitar"); }
        chorus_.prepare(sr_);
        delay_.prepare(sr_);
        reverb_.prepare(sr_);
        rack_.prepare(sr_);
        vol_.prepare(sr_, 20.0);
        wet_.prepare(sr_, 8.0);
        bend_.prepare(sr_, 6.0);
        mod_.prepare(sr_, 30.0);
        expr_.prepare(sr_, 15.0);
        expr_.reset(1.0);
        vol_.reset(dbToLinear(s_.volumeDb));
        wet_.reset(s_.bypass ? 0.0 : 1.0);
        killLen_ = std::max(16, static_cast<int>(0.005 * sr_));
        noiseLen_ = static_cast<int64_t>(0.08 * sr_);
        invNoiseLen_ = 1.0 / static_cast<double>(noiseLen_);
        // filtros fijos del amp (a la tasa base)
        inHp_ = BiquadCoefs::design(FilterType::HighPass, sr_, 75.0, 0.0, 0.7071);
        dcHp_ = BiquadCoefs::design(FilterType::HighPass, sr_, 28.0, 0.0, 0.7071);
        outHp_ = BiquadCoefs::design(FilterType::HighPass, sr_, 12.0, 0.0, 0.7071);
        const double fos = sr_ * F;
        osHpC_ = std::exp(-2.0 * kPi * 140.0 / fos);
        osLpC_ = std::exp(-2.0 * kPi * 6500.0 / fos);
        osFizzC_ = std::exp(-2.0 * kPi * 7800.0 / fos);
        gateAtk_ = 1.0 - std::exp(-1.0 / (0.004 * sr_));
        gateRel_ = 1.0 - std::exp(-1.0 / (0.120 * sr_));
        envDecay_ = std::exp(-1.0 / (0.050 * sr_));
        cabDelay_ = clampT(static_cast<int>(0.00022 * sr_ + 0.5), 1, 60);
        tanhBiasB_ = fastTanh(0.08);
        reset();
        applySettings();
    }
    void reset() {
        for (auto& v : voices_) v.active = false;
        for (auto& p : pending_) p.left = -1;
        sampler_.panic();
        for (auto& c : samp_) c.reset();
        sampKeyEnd_.fill(-1);
        os_.reset(); chorus_.reset(); delay_.reset(); reverb_.reset(); rack_.reset();
        stIn_.reset(); stDc_.reset(); stOut_[0].reset(); stOut_[1].reset();
        for (auto& b : stLc_) b.reset();
        for (auto& b : stHc_) b.reset();
        compEnv_ = 0.0;
        for (auto& b : stTone_) b.reset();
        for (auto& b : stCab_) b.reset();
        stCabDl_.fill(0.0); cabW_ = 0;
        osHp_ = osLp_ = osFizz_ = 0.0;
        gateEnv_ = 0.0; gateG_ = 0.0; diLp_ = 0.0;
        pedal_ = false;
        vibPhase_ = 0.0; now_ = 0; orderCtr_ = 0;
        bend_.reset(0.0); mod_.reset(0.0);
        bendNorm_ = 0.0; modV_ = 0.0;
        // técnicas
        for (auto& h : harm_) h.active = false;
        for (auto& f : fx_) f.active = false;
        for (auto& t : trem_) t.on = false;
        tremCount_ = 0; grpN_ = 0; grpWait_ = -1;
        held_.fill(false); heldCount_ = 0; noteSlideOut_.fill(0); noteArt_.fill(0); noteStart_.fill(0);
        lastNote_ = -1; lastLaunch_ = -1000000000; nextSlide_ = 0; nextBend_ = 0; autoSwellKs_ = false; altFlip_ = false;
        art_ = pArt_; legatoMode_ = pLeg_; slideModeP_ = pSlide_; strumDir_ = pDir_;
        swellPos_ = 1.0e9; swellG_ = 1.0; vibT_ = 1.0e9; tbMode_ = 0; tbT_ = 0.0; tbSm_ = 0.0; prevEg_ = 1.0;
        expr_.reset(pExpr_); expr_.setTarget(pExpr_);
    }
    void setSettings(const GuitarSettings& s) {
        s_ = s;
        // controles de técnica: el parámetro solo manda cuando CAMBIA (entre cambios mandan los keyswitches/CC)
        if (s.articulation != pArt_) { pArt_ = s.articulation; art_ = std::max(0, std::min(5, s.articulation)); }
        if (s.legatoSlide != pLeg_) { pLeg_ = s.legatoSlide; legatoMode_ = std::max(0, std::min(2, s.legatoSlide)); }
        if (s.slideMode != pSlide_) { pSlide_ = s.slideMode; slideModeP_ = std::max(0, std::min(3, s.slideMode)); }
        if (s.strumDir != pDir_) { pDir_ = s.strumDir; strumDir_ = std::max(0, std::min(2, s.strumDir)); }
        if (s.expression != pExpr_) { pExpr_ = s.expression; setExpression(s.expression); }
        applySettings();
    }
    void setTempo(double bpm) {
        const double b = (bpm >= 20.0 && bpm <= 400.0) ? bpm : 0.0;
        if (b != bpm_) { bpm_ = b; updateDelayTime(); }
        rack_.setTempo(b);   // FX Rack comun: fuera de rango -> 120 bpm
    }
    // FX Rack comun (jw_fxrack.h): va DESPUES de la cadena propia de la guitarra (EQ y efectos extra de mezcla), apagado por defecto
    void setFx(const JasWaveFx::FxParams& p) { rack_.setParams(p); }
    JasWaveFx::FxRack& rack() { return rack_; }
    void setBend(double norm) { bendNorm_ = clampT(norm, -1.0, 1.0); bend_.setTarget(bendNorm_ * s_.bendRange); }
    void setModWheel(double v) { modV_ = clampT(v, 0.0, 1.0); mod_.setTarget(modV_); }
    bool samplerReady() const { return sampler_.ready(); }
    bool samplerLoading() const { return sampler_.loading(); }
    void setPedal(bool down) {
        pedal_ = down;
        sampler_.setSustain(down);
        if (!down) {
            for (auto& v : voices_) if (v.active && v.keyUp && !v.released) release(v);
            for (auto& h : harm_) if (h.active && h.keyUp && !h.released) h.release(sr_, 0.30);
        }
    }

    // ---- técnicas: entrada MIDI ----
    // Las notas por debajo de kMinNote son KEYSWITCHES (ver el contrato MIDI arriba). Los acordes que llegan juntos se
    // reúnen 1,5 ms y se rasguean con dirección, velocidad por cuerda y ruido de púa (si «Strum» > 0).
    void noteOn(int note, float velIn) {
        if (note >= kKsFirst && note <= kKsLast) { keyswitch(note); return; }
        if (note < kMinNote || note > kMaxNote) return;
        if (velIn <= 0.0f) { noteOff(note); return; }
        const double vel = clampT(static_cast<double>(velIn), 0.0, 1.0);
        if (s_.strum > 0.02 && grpN_ < static_cast<int>(grp_.size())) {
            if (grpN_ == 0) grpWait_ = std::max(8, static_cast<int>(0.0015 * sr_));
            grp_[static_cast<size_t>(grpN_++)] = { note, vel };
            return;
        }
        launch(note, vel, true);
    }
    void noteOff(int note) {
        if (note < kMinNote || note > kMaxNote) return;       // los keyswitches no tienen note-off
        for (auto& p : pending_) if (p.left >= 0 && p.note == note) p.left = -1;   // nota cancelada antes de sonar
        for (int i = 0; i < grpN_;) {
            if (grp_[static_cast<size_t>(i)].note == note) { grp_[static_cast<size_t>(i)] = grp_[static_cast<size_t>(--grpN_)]; } else ++i;
        }
        if (grpN_ == 0) grpWait_ = -1;
        for (auto& t : trem_) if (t.on && t.note == note) { t.on = false; --tremCount_; }
        const bool wasHeld = held_[static_cast<size_t>(note)];
        if (wasHeld) { held_[static_cast<size_t>(note)] = false; --heldCount_; }
        const int sOut = noteSlideOut_[static_cast<size_t>(note)];
        const int art = noteArt_[static_cast<size_t>(note)];
        noteSlideOut_[static_cast<size_t>(note)] = 0;
        const double sdur = clampT(s_.slideTimeMs * 0.001, 0.04, 1.5);
        const double outSt = (sOut == 2 ? -1.0 : 1.0) * clampT(s_.slideRange, 1.0, 12.0);
        for (auto& h : harm_) {
            if (!h.active || h.note != note || h.keyUp) continue;
            h.keyUp = true;
            if (!pedal_) h.release(sr_, 0.30);
        }
        if (sampKeyEnd_[static_cast<size_t>(note & 127)] > now_) {
            if (sOut) sampler_.slideOut(note, static_cast<float>(outSt), static_cast<float>(sdur), static_cast<float>(curveGamma()), static_cast<float>(sdur * 2.5));
            else sampler_.noteOff(note);
            sampKeyEnd_[static_cast<size_t>(note & 127)] = now_ + static_cast<int64_t>(0.35 * sr_);
        }
        for (auto& v : voices_) {
            if (!v.active || v.killing || v.note != note || v.keyUp) continue;
            v.keyUp = true;
            if (sOut) {
                glideVoice(v, outSt, sdur);
                v.relT = sdur * 2.5;
                v.released = false;
                release(v);
            } else if (!pedal_) release(v);
        }
        const double heldSec = static_cast<double>(now_ - noteStart_[static_cast<size_t>(note)]) / sr_;
        if (sOut) {
            spawnFx(FxVoice::kSlide, sdur, 0.09 * s_.pickNoise, outSt > 0 ? 1800.0 : 3400.0, outSt > 0 ? 3400.0 : 1800.0, std::fabs(outSt) / sdur);
        } else if (wasHeld && art == kArtNormal && heldSec > 0.15) {
            spawnFx(FxVoice::kRelease, 0.014, 0.10 * s_.pickNoise, 2800.0, 1700.0, 0.0);   // «chasquido» del dedo al soltar
        }
    }
    void allNotesOff() {
        for (auto& p : pending_) p.left = -1;
        grpN_ = 0; grpWait_ = -1; tremCount_ = 0;
        for (auto& t : trem_) t.on = false;
        held_.fill(false); heldCount_ = 0; noteSlideOut_.fill(0);
        sampler_.allNotesOff();
        for (auto& v : voices_) if (v.active && !v.killing) startKill(v, -1, 0.0);
        for (auto& h : harm_) if (h.active) h.release(sr_, 0.08);
    }
    // Controladores de técnica por MIDI (CC) — equivalentes a los parámetros (mismos umbrales que el mapeo del controlador)
    void controlChange(int cc, int v127) {
        v127 = std::max(0, std::min(127, v127));
        if (cc == kCcExpression) setExpression(v127 / 127.0);
        else if (cc == kCcArt) art_ = std::max(0, std::min(5, static_cast<int>(std::lround(v127 / 127.0 * 5.0))));
        else if (cc == kCcLegato) legatoMode_ = v127 < 32 ? kLegOff : (v127 < 96 ? kLegAuto : kLegSlide);
        else if (cc == kCcStrumDir) strumDir_ = v127 < 32 ? 0 : (v127 < 96 ? 1 : 2);
        else if (cc == kCcSlideMode) slideModeP_ = std::max(0, std::min(3, static_cast<int>(std::lround(v127 / 127.0 * 3.0))));
    }
    void setExpression(double v) { expr_.setTarget(clampT(v, 0.0, 1.0)); }
    void setArticulation(int a) { art_ = std::max(0, std::min(5, a)); }
    int articulation() const { return art_; }
    // lectura (pruebas / diagnóstico): instante (muestras) y velocidad real con que sonó por última vez una nota tras strum/humanización
    int64_t noteStartSample(int note) const { return noteStart_[static_cast<size_t>(note & 127)]; }
    double noteVelocity(int note) const { return noteVel_[static_cast<size_t>(note & 127)]; }

    template <class T>
    void render(T* outL, T* outR, int n, GuitarBus* bus) {
        int pos = 0;
        float pk[2] = { 0, 0 };
        while (pos < n) {
            if (grpWait_ == 0) launchGroup();
            firePending();
            tickTremolo();
            int len = std::min(kChunk, n - pos);
            for (const auto& p : pending_) if (p.left > 0) len = std::min(len, p.left);
            if (grpWait_ > 0) len = std::min(len, grpWait_);
            if (tremCount_ > 0 && tremNext_ > now_) len = static_cast<int>(std::min<int64_t>(len, tremNext_ - now_));
            renderChunk(len);
            for (int i = 0; i < len; ++i) {
                outL[pos + i] = static_cast<T>(chL_[static_cast<size_t>(i)]);
                outR[pos + i] = static_cast<T>(chR_[static_cast<size_t>(i)]);
                pk[0] = std::max(pk[0], static_cast<float>(std::fabs(chL_[static_cast<size_t>(i)])));
                pk[1] = std::max(pk[1], static_cast<float>(std::fabs(chR_[static_cast<size_t>(i)])));
            }
            for (auto& p : pending_) if (p.left > 0) p.left -= len;
            if (grpWait_ > 0) grpWait_ -= len;
            now_ += len;
            pos += len;
        }
        // FX Rack comun tras la cadena propia; si esta activo los picos se miden DESPUES (apagado: no toca el buffer, bit a bit)
        if (rack_.activo()) {
            rack_.process(outL, outR, n, bus);
            pk[0] = pk[1] = 0.0f;
            for (int i = 0; i < n; ++i) { pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i])))); pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i])))); }
        } else rack_.process(outL, outR, n, bus);
        if (bus) {
            bus->salida(outL, outR, n);
            bus->outPk[0].update(pk[0]);
            bus->outPk[1].update(pk[1]);
            uint64_t k0 = 0, k1 = 0;
            int act = 0;
            act += sampler_.activeVoices();
            for (int n = kSampMinNote; n <= kSampMaxNote; ++n)
                if (sampKeyEnd_[static_cast<size_t>(n)] > now_) { if (n < 64) k0 |= 1ull << n; else k1 |= 1ull << (n - 64); }
            for (const auto& h : harm_) {
                if (!h.active) continue;
                ++act;
                if (h.note < 64) k0 |= 1ull << h.note; else k1 |= 1ull << (h.note - 64);
            }
            for (const auto& v : voices_) {
                if (!v.active) continue;
                ++act;
                if (v.note < 64) k0 |= 1ull << v.note; else k1 |= 1ull << (v.note - 64);
            }
            bus->keys[0].store(k0, std::memory_order_relaxed);
            bus->keys[1].store(k1, std::memory_order_relaxed);
            bus->activeVoices.store(act, std::memory_order_relaxed);
            bus->delayMs.store(static_cast<float>(delay_.timeMs()), std::memory_order_relaxed);
            bus->bendSt.store(static_cast<float>(bend_.current()), std::memory_order_relaxed);
        }
    }

    int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a; }
    double sampleRate() const { return sr_; }
    double delayMs() const { return delay_.timeMs(); }
    int oversampling() const { return osF_; }
    // Respuesta en dB de la cadena de pantalla (para pruebas): magnitud de los biquads en cascada
    double cabResponseDb(double f) const {
        double db = 0;
        for (const auto& c : cabCoef_) db += c.magnitudeDb(f, sr_);
        return db;
    }
    static double midiToHz(int note) { return 440.0 * std::pow(2.0, (note - 69) / 12.0); }

private:
    // ---------------- voz ----------------
    struct Voice {
        std::vector<double> store;     // 2 líneas de retardo (polarizaciones)
        bool active{false}, keyUp{false}, released{false}, killing{false}, palm{false};
        int note{-1}, pendingNote{-1};
        double pendingVel{0};
        int64_t order{0}, held{0};
        double f0{110.0}, vel{0.5};
        // lazo por polarización
        int w[2]{0, 0};
        double lp[2]{0, 0}, apx[2]{0, 0}, apy[2]{0, 0}, dcur[2]{0, 0}, Tn[2]{0, 0}, pd[2]{0, 0}, wgt[2]{1, 0.3};
        double c{0.5}, apA{-0.05};
        double gBase{0.99}, gSust{0.99}, gRel{0.5}, gCur{0.99};
        double olC{1.0}, olY{0.0};           // lowpass de salida (palm mute)
        double env{0.0};
        double killGain{1.0}, killStep{0.0};
        int clickLeft{0}, clickLen{1};
        double clickInv{1.0};
        double clickAmp{0}, noiseAmp{0}, nz{0}, nzHp{0};
        uint32_t rng{1};
        // técnicas: deslizamiento de afinación (offset(t) = gA + gB*(t/gLen)^gGamma, semitonos), suelta automática, release propio
        double gA{0}, gB{0}, gGamma{1}, relT{0};
        int gLen{0}, gPos{0}, autoRel{-1};
        bool palmForce{false};
    };
    struct Pending { int note{0}; double vel{0}; int left{-1}; };
    struct GrpNote { int note{0}; double vel{0}; };
    struct Trem { int note{0}; double vel{0}; bool on{false}; };

    void firePending() {
        for (auto& p : pending_) if (p.left == 0) { p.left = -1; launch(p.note, p.vel, false); }
    }

    void release(Voice& v) {
        if (v.released) return;
        v.released = true;
        v.palm = v.palmForce || v.held < static_cast<int64_t>(0.17 * sr_);
        const double tRel = v.relT > 0.0 ? v.relT : (v.palm ? 0.035 : 0.12);
        v.gRel = std::min(v.gBase, std::pow(10.0, -3.0 / (tRel * v.f0)));
        if (v.palm && v.relT <= 0.0) v.olC = 1.0 - std::exp(-2.0 * kPi * 1100.0 / sr_);
    }
    void startKill(Voice& v, int pendNote, double pendVel) {
        v.killing = true;
        v.killStep = std::max(1.0e-9, v.killGain / killLen_);
        v.pendingNote = pendNote;
        v.pendingVel = pendVel;
    }

    // ---------------- técnicas ----------------
    double curveGamma() const { return std::pow(2.0, clampT(s_.slideCurve, -1.0, 1.0) * 1.585); }   // 0 -> lineal; +100 % -> x^3; -100 % -> x^(1/3)
    bool inSamp(int note) const { return sampler_.ready() && note >= kSampMinNote && note <= kSampMaxNote; }
    static double voiceGlideOffset(const Voice& v, int pos) {
        const double x = clampT(static_cast<double>(pos) / static_cast<double>(std::max(1, v.gLen)), 0.0, 1.0);
        return v.gA + v.gB * std::pow(x, v.gGamma);
    }
    // desliza la afinación de una voz modelada `semis` semitonos desde su afinación actual
    void glideVoice(Voice& v, double semis, double sec) {
        const double cur = v.gLen > 0 ? voiceGlideOffset(v, v.gPos) : v.gA;
        v.gA = cur; v.gB = semis; v.gLen = std::max(1, static_cast<int>(sec * sr_)); v.gPos = 0; v.gGamma = curveGamma();
    }

    void spawnFx(int kind, double seconds, double amp, double fa, double fb, double rate) {
        if (amp <= 1.0e-5) return;
        FxVoice* f = nullptr;
        for (auto& x : fx_) if (!x.active) { f = &x; break; }
        if (!f) {
            double worst = -1.0;
            for (auto& x : fx_) { const double pr = static_cast<double>(x.pos) / static_cast<double>(x.len); if (pr > worst) { worst = pr; f = &x; } }
        }
        f->start(kind, sr_, seconds, amp, fa, fb, rate, xs32(rng_));
    }

    void keyswitch(int k) {
        switch (k) {
            case kKsNormal: art_ = kArtNormal; legatoMode_ = kLegOff; strumDir_ = 0; autoSwellKs_ = false; nextSlide_ = 0; nextBend_ = 0; break;
            case kKsPalm: art_ = kArtPalm; break;
            case kKsDead: art_ = kArtDead; break;
            case kKsHarmNat: art_ = kArtHarmNat; break;
            case kKsHarmArt: art_ = kArtHarmArt; break;
            case kKsTremolo: art_ = kArtTremolo; break;
            case kKsSlideIn: nextSlide_ = 1; break;
            case kKsSlideOutDown: nextSlide_ = 2; break;
            case kKsSlideOutUp: nextSlide_ = 3; break;
            case kKsPreBend: nextBend_ = 1; break;
            case kKsBendUp: nextBend_ = 2; break;
            case kKsLegato: legatoMode_ = kLegAuto; break;
            case kKsSlide: legatoMode_ = kLegSlide; break;
            case kKsStrumDown: strumDir_ = 0; break;
            case kKsStrumUp: strumDir_ = 1; break;
            case kKsStrumAlt: strumDir_ = 2; break;
            case kKsAutoSwell: autoSwellKs_ = true; break;
            default: break;
        }
    }

    // Lanza una nota ya decidida (tras strum): resuelve legato, slide-in/out, pre-bend y articulación.
    void launch(int note, double vel, bool allowLegato) {
        const int sIn = (nextSlide_ == 1 || slideModeP_ == 1) ? 1 : 0;
        const int sOut = (nextSlide_ == 2 || slideModeP_ == 2) ? 2 : ((nextSlide_ == 3 || slideModeP_ == 3) ? 3 : 0);
        const int bendK = nextBend_;
        nextSlide_ = 0; nextBend_ = 0;
        bool legato = false;
        if (allowLegato && art_ == kArtNormal && sIn == 0 && bendK == 0 && legatoMode_ != kLegOff) legato = tryLegato(note, vel);
        if (!legato) { freshNote(bendK); playNote(note, vel, sIn); }
        noteSlideOut_[static_cast<size_t>(note)] = static_cast<uint8_t>(sOut);
        noteArt_[static_cast<size_t>(note)] = static_cast<uint8_t>(art_);
        noteStart_[static_cast<size_t>(note)] = now_;
        noteVel_[static_cast<size_t>(note)] = vel;
        if (!held_[static_cast<size_t>(note)]) { held_[static_cast<size_t>(note)] = true; ++heldCount_; }
        lastNote_ = note;
        lastLaunch_ = now_;
    }
    // Una nota nueva (no ligada) reinicia el vibrato con retardo, el auto-swell y el pre-bend/bend-up.
    void freshNote(int bendK) {
        swellPos_ = 0.0;
        vibT_ = 0.0;
        tbMode_ = bendK; tbT_ = 0.0;
        if (bendK == 1) tbSm_ = clampT(s_.bendAmount, 0.5, 4.0);
        else if (bendK == 0) tbSm_ = 0.0;
    }
    void playNote(int note, double vel, int slideIn) {
        const double inSt = slideIn ? clampT(s_.slideRange, 1.0, 12.0) : 0.0;
        switch (art_) {
            case kArtHarmNat: case kArtHarmArt: startHarm(note, vel, art_ == kArtHarmArt); break;
            case kArtPalm: startNote(note, vel, 1, 0.0, 0.0); break;
            case kArtDead: startNote(note, vel, 2, 0.0, 0.0); break;
            case kArtTremolo: {
                const double period = 1.0 / clampT(s_.tremRate, 4.0, 16.0);
                startNote(note, vel, 3, 0.0, period * 0.95);
                for (auto& t : trem_) if (!t.on) { t = { note, vel, true }; if (tremCount_++ == 0) { tremNext_ = now_ + static_cast<int64_t>(period * sr_); tremDown_ = true; } break; }
                break;
            }
            default: startNote(note, vel, 0, inSt, 0.0); break;
        }
    }
    void tickTremolo() {
        if (tremCount_ <= 0 || now_ < tremNext_) return;
        const double period = 1.0 / clampT(s_.tremRate, 4.0, 16.0);
        tremDown_ = !tremDown_;
        for (auto& t : trem_)
            if (t.on) startNote(t.note, clampT(t.vel * (tremDown_ ? 1.0 : 0.80) * (0.93 + 0.14 * rnd01(rng_)), 0.05, 1.0), 3, 0.0, period * 0.95);
        tremNext_ = now_ + std::max<int64_t>(1, static_cast<int64_t>(period * sr_ * (0.94 + 0.12 * rnd01(rng_))));
    }

    void startHarm(int note, double vel, bool artificial) {
        HarmVoice* h = nullptr;
        for (auto& x : harm_) if (x.active && x.note == note) { x.release(sr_, 0.02); }
        for (auto& x : harm_) if (!x.active) { h = &x; break; }
        if (!h) for (auto& x : harm_) if (!h || x.order < h->order) h = &x;
        h->start(note, vel, artificial, sr_, xs32(rng_), sampler_.ready() ? 2.5 : 1.0);   // la cadena de muestras es mas baja que la del modelado
        h->order = ++orderCtr_;
        spawnFx(FxVoice::kRelease, 0.010, (artificial ? 0.09 : 0.045) * s_.pickNoise * (0.4 + 0.6 * vel), artificial ? 4200.0 : 3000.0, 2500.0, 0.0);   // «tic» del armónico
    }

    // kind: 0 normal, 1 palm mute, 2 nota muerta, 3 pulsación de tremolo (con suelta automática a holdSec)
    void startNote(int note, double vel, int kind = 0, double slideInSt = 0.0, double holdSec = 0.0) {
        const double sdur = clampT(s_.slideTimeMs * 0.001, 0.04, 1.5);
        if (slideInSt != 0.0) spawnFx(FxVoice::kSlide, sdur, 0.09 * s_.pickNoise, slideInSt > 0 ? 1800.0 : 3400.0, slideInSt > 0 ? 3400.0 : 1800.0, std::fabs(slideInSt) / sdur);
        if (kind == 2) spawnFx(FxVoice::kThump, 0.05, 0.55 * (0.4 + 0.6 * vel) * (0.3 + 0.7 * std::max(s_.pickNoise, 0.35)), 900.0, 300.0, 0.0);
        if (inSamp(note)) {
            JwSampler::NoteOpts o;
            if (kind == 1) { o.lpHz = 1400.0f; o.holdSec = 0.20f; o.holdRelSec = 0.05f; o.relSec = 0.04f; o.gainMul = 0.95f; }
            else if (kind == 2) { o.lpHz = 650.0f; o.holdSec = 0.035f; o.holdRelSec = 0.03f; o.relSec = 0.03f; o.gainMul = 0.85f; }
            else if (kind == 3) { o.holdSec = static_cast<float>(holdSec); o.holdRelSec = 0.035f; o.relSec = 0.04f; }
            if (slideInSt != 0.0) { o.glideSemis = static_cast<float>(-slideInSt); o.glideSec = static_cast<float>(sdur); o.glideGamma = static_cast<float>(curveGamma()); }
            sampler_.noteOnEx(note, static_cast<float>(vel), o);
            sampKeyEnd_[static_cast<size_t>(note & 127)] = INT64_MAX;
            return;
        }
        for (auto& v : voices_) if (v.active && !v.killing && v.note == note) startKill(v, -1, 0.0);   // re-golpe de la misma cuerda
        Voice* freeV = nullptr;
        for (auto& v : voices_) if (!v.active) { freeV = &v; break; }
        if (freeV) {
            initVoice(*freeV, note, vel);
            if (kind == 1) { freeV->palmForce = true; freeV->olC = 1.0 - std::exp(-2.0 * kPi * 1300.0 / sr_); freeV->autoRel = static_cast<int>(0.20 * sr_); freeV->relT = 0.04; }
            else if (kind == 2) { freeV->palmForce = true; freeV->olC = 1.0 - std::exp(-2.0 * kPi * 650.0 / sr_); freeV->autoRel = static_cast<int>(0.035 * sr_); freeV->relT = 0.03; }
            else if (kind == 3) { freeV->autoRel = static_cast<int>(holdSec * sr_); freeV->relT = 0.04; }
            if (slideInSt != 0.0) { freeV->gA = -slideInSt; freeV->gB = slideInSt; freeV->gLen = std::max(1, static_cast<int>(sdur * sr_)); freeV->gPos = 0; freeV->gGamma = curveGamma(); }
            return;
        }
        Voice* victim = nullptr;
        for (auto& v : voices_) {
            if (!v.active || v.killing) continue;
            if (!victim || v.order < victim->order) victim = &v;     // la más antigua
        }
        if (victim) { startKill(*victim, note, vel); return; }
        for (auto& v : voices_) if (v.active && v.killing && v.pendingNote >= 0) { v.pendingNote = note; v.pendingVel = vel; return; }
    }

    // ¿La nota nueva liga con la anterior? Legato (solape) o slide (solape / anterior aún sonando); nunca dentro de un acorde.
    bool tryLegato(int note, double vel) {
        if (lastNote_ < 0) return false;
        const double gap = static_cast<double>(now_ - lastLaunch_) / sr_;
        const bool slideMode = legatoMode_ == kLegSlide;
        if (gap < (slideMode ? 0.025 : 0.060)) return false;          // casi simultáneas: es un acorde, no una ligadura
        const int from = lastNote_;
        const bool overlap = held_[static_cast<size_t>(from)] && heldCount_ == 1;
        const bool ringing = !overlap && slideMode && heldCount_ == 0 && gap < 1.5 && (inSamp(from) ? sampKeyEnd_[static_cast<size_t>(from)] > now_ : voiceSounding(from));
        if (!overlap && !ringing) return false;
        const int d = note - from;
        if (d == 0 || std::abs(d) > 12) return false;
        return doLegato(from, note, vel, slideMode || std::abs(d) > 3, ringing);
    }
    bool voiceSounding(int note) const {
        for (const auto& v : voices_) if (v.active && !v.killing && v.note == note) return true;
        return false;
    }
    bool doLegato(int from, int to, double vel, bool slide, bool ringing = false) {
        const double glideS = slide ? clampT(s_.slideTimeMs * 0.001, 0.04, 1.5) : 0.016;
        const double gamma = slide ? curveGamma() : 1.0;
        const double semis = static_cast<double>(to - from);
        bool ok = false;
        if (inSamp(from) && inSamp(to)) {
            const int moved = sampler_.glideNote(from, to, static_cast<float>(semis), static_cast<float>(glideS), static_cast<float>(gamma),
                                                 static_cast<float>(glideS * 0.5), static_cast<float>(std::max(0.006, glideS * 0.4)), ringing);
            if (moved == 0) return false;
            JwSampler::NoteOpts o;
            o.skipSec = 0.065f;                                         // salta el ataque de la púa: nota ligada
            o.atkSec = static_cast<float>(std::max(0.006, glideS * 0.5));
            o.delaySamples = static_cast<int>(glideS * 0.5 * sr_);
            const double age = std::max(0.065, static_cast<double>(now_ - noteStart_[static_cast<size_t>(from & 127)]) / sr_);
            const double match = clampT(std::pow(10.0, -7.5 * (age - 0.065) / 20.0), 0.35, 1.0);   // la muestra decae ~7,5 dB/s: la voz nueva entra al nivel de la que ya sonaba
            o.gainMul = static_cast<float>(match * (slide ? 1.0 : 0.9));
            o.glideSemis = static_cast<float>(-semis); o.glideSec = static_cast<float>(glideS); o.glideGamma = static_cast<float>(gamma);
            sampler_.noteOnEx(to, static_cast<float>(vel), o);
            sampKeyEnd_[static_cast<size_t>(to & 127)] = INT64_MAX;
            sampKeyEnd_[static_cast<size_t>(from & 127)] = now_ + static_cast<int64_t>(0.35 * sr_);
            ok = true;
        } else if (!inSamp(from) && !inSamp(to) && ringing) {
            // nota anterior ya soltada (su cuerda casi no suena): púa nueva que entra deslizándose desde la afinación anterior
            startNote(to, vel * 0.9, 0, semis, 0.0);
            return true;
        } else if (!inSamp(from) && !inSamp(to)) {
            for (auto& v : voices_) {
                if (!v.active || v.killing || (v.released && !ringing) || v.note != from) continue;
                const double cur = v.gLen > 0 ? voiceGlideOffset(v, v.gPos) : v.gA;
                v.gA = cur; v.gB = semis; v.gLen = std::max(1, static_cast<int>(glideS * sr_)); v.gPos = 0; v.gGamma = gamma;
                v.note = to;
                v.f0 = midiToHz(to);
                if (!slide) { v.clickLeft = v.clickLen / 2; v.clickAmp = 0.02 * (0.3 + vel); }   // golpe del dedo en el traste
                ok = true;
                break;
            }
        }
        if (!ok) return false;
        if (slide) spawnFx(FxVoice::kSlide, glideS, 0.09 * s_.pickNoise * std::min(1.0, std::fabs(semis) / 6.0), semis > 0 ? 1800.0 : 3400.0, semis > 0 ? 3400.0 : 1800.0, std::fabs(semis) / glideS);
        else spawnFx(FxVoice::kRelease, 0.010, 0.07 * s_.pickNoise, 1500.0, 1000.0, 0.0);
        return true;
    }

    // Rasgueo: ordena el grupo por altura, aplica dirección (abajo: graves primero; arriba: agudos primero), velocidad por
    // cuerda (acentúa las cuerdas del lado donde empieza el golpe), aceleración leve y ruido de púa.
    void launchGroup() {
        const int n = grpN_;
        grpN_ = 0; grpWait_ = -1;
        if (n <= 0) return;
        if (n == 1) { launch(grp_[0].note, grp_[0].vel, true); return; }
        std::sort(grp_.begin(), grp_.begin() + n, [](const GrpNote& a, const GrpNote& b) { return a.note < b.note; });
        int dir = strumDir_;
        if (dir == 2) { dir = altFlip_ ? 1 : 0; altFlip_ = !altFlip_; }
        const double gap = (0.0025 + 0.0175 * clampT(s_.strum, 0.0, 1.0)) * sr_;
        const double acc = clampT(s_.strumAccent, 0.0, 1.0);
        double t = 0.0, velSum = 0.0;
        for (int k = 0; k < n; ++k) {
            const int idx = dir == 0 ? k : n - 1 - k;                  // abajo: la k-ésima más grave; arriba: la k-ésima más aguda
            const GrpNote g = grp_[static_cast<size_t>(idx)];
            const double r = static_cast<double>(idx) / static_cast<double>(n - 1);   // 0 = grave .. 1 = aguda
            const double side = dir == 0 ? (0.5 - r) : (r - 0.5);
            const double v = clampT(g.vel * (dir == 0 ? 1.0 : 0.92) * (1.0 + 0.36 * acc * side + 0.05 * rndS(rng_)), 0.05, 1.0);
            velSum += v;
            if (k > 0) t += gap * std::max(0.55, 1.0 - 0.05 * k) * (0.75 + 0.5 * rnd01(rng_));
            const int64_t d = static_cast<int64_t>(t);
            bool queued = false;
            if (d > 0) for (auto& p : pending_) if (p.left < 0) { p.note = g.note; p.vel = v; p.left = static_cast<int>(d); queued = true; break; }
            if (!queued) launch(g.note, v, false);
        }
        const double total = t / sr_;
        spawnFx(FxVoice::kScrape, total + 0.03, 0.10 * s_.pickNoise * (velSum / n), dir == 0 ? 4200.0 : 2300.0, dir == 0 ? 2300.0 : 4200.0, 0.0);
    }

    void initVoice(Voice& v, int note, double vel) {
        std::vector<double> keep;
        keep.swap(v.store);                       // conserva la memoria (sin asignar)
        v = Voice{};
        v.store.swap(keep);
        std::fill(v.store.begin(), v.store.end(), 0.0);
        v.active = true;
        v.note = note;
        v.vel = vel;
        v.order = ++orderCtr_;
        v.rng = 0x9E3779B9u ^ static_cast<uint32_t>(note * 7919) ^ static_cast<uint32_t>(orderCtr_ * 2654435761u);
        if (v.rng == 0) v.rng = 1;
        const double microCents = 1.2 * rndS(v.rng);                      // microdesafinación por nota
        v.f0 = midiToHz(note) * std::pow(2.0, microCents / 1200.0);
        const double w0 = 2.0 * kPi * v.f0 / sr_;
        // Filtros del lazo: LP de un polo (brillo según velocidad y registro) + allpass de rigidez
        const double fcLoop = (1900.0 + 6200.0 * std::pow(vel, 1.1)) * std::pow(std::max(v.f0, 110.0) / 220.0, 0.7);
        v.c = std::exp(-2.0 * kPi * std::min(fcLoop, 0.42 * sr_) / sr_);
        const double lowF = clampT((note - 40) / 50.0, 0.0, 1.0);
        v.apA = -(0.02 + 0.10 * (1.0 - lowF));
        const double pdLp = phaseDelay1(1.0 - v.c, 0.0, -v.c, w0);
        const double pdAp = phaseDelay1(v.apA, 1.0, v.apA, w0);
        const double magLp = mag1(1.0 - v.c, 0.0, -v.c, w0);
        const double detune[2] = { 0.9, -0.9 };
        for (int p = 0; p < 2; ++p) {
            v.Tn[p] = sr_ / (v.f0 * std::pow(2.0, detune[p] / 1200.0));
            v.pd[p] = pdLp + pdAp;
            v.dcur[p] = clampT(v.Tn[p] - v.pd[p], 3.01, static_cast<double>(lineSize_ - 8));
        }
        v.wgt[0] = 1.0; v.wgt[1] = 0.28;
        // Ganancia del lazo para el T60 deseado (compensa la pérdida del propio LP en f0)
        const double t60 = clampT(3.4 * std::pow(110.0 / v.f0, 0.30), 0.9, 5.0);
        auto gFor = [&](double T60) { return std::min(0.99985, std::pow(10.0, -3.0 / (T60 * v.f0)) / std::max(magLp, 1e-3)); };
        v.gBase = gFor(t60);
        v.gSust = gFor(t60 * (1.0 + 5.0 * s_.sustain));
        v.gCur = v.gSust;
        v.gRel = v.gBase;
        // Excitación: pluck triangular (en la posición de púa) + ruido filtrado con peine de púa + peine de pastilla
        const double beta = 0.08 + 0.42 * s_.pickPos;
        const double ampV = 0.10 + 0.34 * std::pow(vel, 1.3);
        const double kn = 0.10 + 0.80 * vel;                               // brillo del ruido de excitación
        for (int p = 0; p < 2; ++p) {
            const int L = std::min(lineSize_ - 4, static_cast<int>(std::ceil(v.Tn[p])) + 4);
            double* x = scratch_.data();
            double* y = scratch2_.data();
            const int Ppick = std::max(1, static_cast<int>(beta * L + 0.5));
            double nlp = 0.0;
            for (int i = 0; i < L; ++i) {
                const double tri = i < Ppick ? static_cast<double>(i) / Ppick : static_cast<double>(L - 1 - i) / std::max(1, L - 1 - Ppick);
                nlp += kn * (rndS(v.rng) - nlp);
                x[i] = nlp;
                y[i] = tri;
            }
            // x := ruido con peine de púa (circular); mezcla
            double mean = 0;
            for (int i = 0; i < L; ++i) {
                const double nc = x[i] - x[(i - Ppick + L) % L];
                scratch2_[static_cast<size_t>(i)] = 0.55 * y[i] + (0.30 + 0.75 * vel) * nc;
                mean += scratch2_[static_cast<size_t>(i)];
            }
            mean /= L;
            const int Ppu = std::max(1, static_cast<int>(0.13 * L + 0.5));
            double peak = 1e-9;
            for (int i = 0; i < L; ++i) {
                x[i] = (scratch2_[static_cast<size_t>(i)] - mean) - 0.55 * (scratch2_[static_cast<size_t>((i - Ppu + L) % L)] - mean);
                peak = std::max(peak, std::fabs(x[i]));
            }
            double* buf = &v.store[static_cast<size_t>(p * lineSize_)];
            const double sc = ampV * v.wgt[p] / peak;
            for (int i = 0; i < L; ++i) buf[i & lineMask_] = x[i] * sc;
            v.w[p] = L;
        }
        v.clickLen = std::max(8, static_cast<int>(0.0028 * sr_));
        v.clickLeft = v.clickLen;
        v.clickInv = 1.0 / v.clickLen;
        v.clickAmp = 0.035 * std::pow(vel, 1.5);
        v.noiseAmp = 0.012 * vel;
        v.killGain = 1.0;
        v.olC = 1.0;
    }

    // Renderiza len muestras de una voz sumando en acc (mono); m = factor de afinación por bend/vibrato
    void renderVoice(Voice& v, double* acc, int len, double m) {
        const double invLen = 1.0 / len;
        double mv = m;
        if (v.gLen > 0) {                      // deslizamiento de afinación de la voz (slide / legato)
            mv *= std::exp2(-voiceGlideOffset(v, std::min(v.gPos + len, v.gLen)) / 12.0);
            v.gPos += len;
            if (v.gPos >= v.gLen) { v.gA += v.gB; v.gB = 0.0; v.gLen = 0; v.gPos = 0; }
        } else if (v.gA != 0.0) mv *= std::exp2(-v.gA / 12.0);
        double dt[2], dstep[2];
        for (int p = 0; p < 2; ++p) {
            dt[p] = clampT(v.Tn[p] * mv - v.pd[p], 3.01, static_cast<double>(lineSize_ - 8));
            dstep[p] = (dt[p] - v.dcur[p]) * invLen;
        }
        // objetivo de ganancia del lazo
        double gT;
        if (v.released) gT = v.gRel;
        else {
            const double heldS = static_cast<double>(v.held) / sr_;
            const double fade = clampT((heldS - 7.0) / 4.0, 0.0, 1.0);        // el sustain del lead se apaga tras 7..11 s
            gT = v.gSust + (v.gBase - v.gSust) * fade;
        }
        double* b0 = &v.store[0];
        double* b1 = &v.store[static_cast<size_t>(lineSize_)];
        double* bufs[2] = { b0, b1 };
        const int mask = lineMask_;
        int i0 = 0;
        if (v.clickLeft <= 0 && v.held >= noiseLen_ && v.olC >= 1.0 && !v.killing) {
            // camino rápido (régimen estacionario): estado de ambas polarizaciones en registros
            double gC = v.gCur, env = v.env;
            const double c = v.c, c1 = 1.0 - v.c, aA = v.apA;
            int w0 = v.w[0], w1 = v.w[1];
            double d0 = v.dcur[0], d1 = v.dcur[1], lp0 = v.lp[0], lp1 = v.lp[1];
            double x0 = v.apx[0], x1 = v.apx[1], y0 = v.apy[0], y1 = v.apy[1];
            const double ds0 = dstep[0], ds1 = dstep[1];
            for (int i = 0; i < len; ++i) {
                gC += (gT - gC) * 0.02;
                d0 += ds0; d1 += ds1;
                const double r0 = static_cast<double>(w0) - d0, r1 = static_cast<double>(w1) - d1;
                const int ip0 = static_cast<int>(fastFloor(r0)), ip1 = static_cast<int>(fastFloor(r1));
                const double q0 = lagrange3(b0[(ip0 - 1) & mask], b0[ip0 & mask], b0[(ip0 + 1) & mask], b0[(ip0 + 2) & mask], r0 - ip0);
                const double q1 = lagrange3(b1[(ip1 - 1) & mask], b1[ip1 & mask], b1[(ip1 + 1) & mask], b1[(ip1 + 2) & mask], r1 - ip1);
                lp0 = c1 * q0 + c * lp0; lp1 = c1 * q1 + c * lp1;
                const double ap0 = aA * lp0 + x0 - aA * y0, ap1 = aA * lp1 + x1 - aA * y1;
                x0 = lp0; y0 = ap0; x1 = lp1; y1 = ap1;
                const double o0 = ap0 * gC, o1 = ap1 * gC;
                b0[w0 & mask] = o0; b1[w1 & mask] = o1;
                ++w0; ++w1;
                const double s = o0 + o1;
                env = std::max(std::fabs(s), env * envDecay_);
                acc[i] += s;
            }
            v.gCur = gC; v.env = env; v.w[0] = w0; v.w[1] = w1; v.dcur[0] = d0; v.dcur[1] = d1; v.lp[0] = lp0; v.lp[1] = lp1;
            v.apx[0] = x0; v.apx[1] = x1; v.apy[0] = y0; v.apy[1] = y1;
            i0 = len;
        }
        for (int i = i0; i < len; ++i) {
            v.gCur += (gT - v.gCur) * 0.02;
            double sum = 0.0;
            for (int p = 0; p < 2; ++p) {
                double* b = bufs[p];
                v.dcur[p] += dstep[p];
                const double r = static_cast<double>(v.w[p]) - v.dcur[p];
                const int ip = static_cast<int>(fastFloor(r));
                const double t = r - ip;
                const double y = lagrange3(b[(ip - 1) & mask], b[ip & mask], b[(ip + 1) & mask], b[(ip + 2) & mask], t);
                v.lp[p] = (1.0 - v.c) * y + v.c * v.lp[p];
                const double ap = v.apA * v.lp[p] + v.apx[p] - v.apA * v.apy[p];
                v.apx[p] = v.lp[p];
                v.apy[p] = ap;
                const double o = ap * v.gCur;
                b[v.w[p] & mask] = o;
                ++v.w[p];
                sum += o;
            }
            // ataque de púa (click) y ruido de cuerda
            double s = sum;
            if (v.clickLeft > 0) {
                const double e = static_cast<double>(v.clickLeft) * v.clickInv;
                const double nzr = rndS(v.rng);
                v.nzHp = nzr - v.nz;
                v.nz += 0.35 * (nzr - v.nz);
                s += v.nzHp * v.clickAmp * e * e;
                --v.clickLeft;
            }
            if (v.held + i < noiseLen_) {
                const double e = 1.0 - static_cast<double>(v.held + i) * invNoiseLen_;
                s += rndS(v.rng) * v.noiseAmp * e * e * 0.5;
            }
            v.olY += v.olC * (s - v.olY);
            s = v.olC >= 1.0 ? s : v.olY;
            if (v.killing) {
                v.killGain -= v.killStep;
                if (v.killGain <= 0.0) { v.killGain = 0.0; }
            }
            s *= v.killGain;
            v.env = std::max(std::fabs(s), v.env * envDecay_);
            acc[i] += s;
            if (v.killing && v.killGain <= 0.0) break;
        }
        for (int p = 0; p < 2; ++p) v.dcur[p] = dt[p];
        v.held += len;
        if (v.autoRel >= 0 && !v.released && !v.killing) {      // suelta automática (palm mute, nota muerta, tremolo picking)
            v.autoRel -= len;
            if (v.autoRel <= 0) { v.autoRel = -1; v.keyUp = true; release(v); }
        }
        if (v.killing && v.killGain <= 0.0) {
            v.active = false;
            if (v.pendingNote >= 0) { const int pn = v.pendingNote; const double pv = v.pendingVel; v.pendingNote = -1; initVoice(v, pn, pv); }
            return;
        }
        if (v.env < 2.0e-6 && v.held > static_cast<int64_t>(0.12 * sr_)) v.active = false;   // fin natural (-114 dB)
        if (v.released && v.env < 1.0e-5 && v.held > static_cast<int64_t>(0.05 * sr_)) v.active = false;
    }

    // ---------------- ajustes ----------------
    void applySettings() {
        vol_.setTarget(dbToLinear(s_.volumeDb));
        wet_.setTarget(s_.bypass ? 0.0 : 1.0);
        bend_.setTarget(bendNorm_ * s_.bendRange);
        const double g = clampT(s_.ampGain, 0.0, 1.0);
        k1_ = 0.8 + 18.0 * g * g;
        k2_ = 1.0 + 5.0 * g;
        biasA_ = 0.18 + 0.12 * g;
        tanhBiasA_ = fastTanh(biasA_);
        {   // compensación de nivel: post * k1 interpolado en una tabla (RMS de acorde ~ -20 dBFS a cualquier ganancia)
            static const double gx[6] = { 0.0, 0.25, 0.45, 0.7, 0.85, 1.0 };
            static const double nm[6] = { 3.0, 1.5, 1.6, 2.1, 2.7, 3.2 };
            int i = 0;
            while (i < 4 && g > gx[i + 1]) ++i;
            const double t = clampT((g - gx[i]) / (gx[i + 1] - gx[i]), 0.0, 1.0);
            post_ = (nm[i] + (nm[i + 1] - nm[i]) * t) / k1_;
        }
        // tone stack
        const double tilt = (clampT(s_.tone, 0.0, 1.0) - 0.5) * 2.0;
        toneCoef_[0] = BiquadCoefs::design(FilterType::LowShelf, sr_, 190.0, -3.0 * tilt + 1.0, 0.7);
        toneCoef_[1] = BiquadCoefs::design(FilterType::Bell, sr_, 680.0, -1.5 * g, 0.9);
        toneCoef_[2] = BiquadCoefs::design(FilterType::HighShelf, sr_, 2600.0, 7.0 * tilt, 0.7);
        toneCoef_[3] = BiquadCoefs::design(FilterType::Bell, sr_, 3500.0, 2.5 * std::max(0.0, tilt) + 1.0, 1.1);
        // pantalla 4x12: HPF, resonancia ~100 Hz, caja -3 dB a 400 Hz, presencia 2.6k, corte ~5 kHz (24 dB/oct)
        cabCoef_[0] = BiquadCoefs::design(FilterType::HighPass, sr_, 82.0, 0.0, 0.75);
        cabCoef_[1] = BiquadCoefs::design(FilterType::Bell, sr_, 105.0, 5.5, 1.5);
        cabCoef_[2] = BiquadCoefs::design(FilterType::Bell, sr_, 420.0, -3.5, 1.0);
        cabCoef_[3] = BiquadCoefs::design(FilterType::Bell, sr_, 2400.0, 4.0, 1.2);
        cabCoef_[4] = BiquadCoefs::design(FilterType::LowPass, sr_, 3900.0, 0.0, butterworthQ(4, 0));
        cabCoef_[5] = BiquadCoefs::design(FilterType::LowPass, sr_, 3900.0, 0.0, butterworthQ(4, 1));
        diC_ = std::exp(-2.0 * kPi * 9500.0 / sr_);
        // acabado: pasa-altos / pasa-bajos suaves (12 dB/oct, sin resonancia), compresor y cinta
        lcCoef_ = BiquadCoefs::design(FilterType::HighPass, sr_, clampT(s_.lowCutHz, 20.0, 400.0), 0.0, 0.6);
        hcCoef_ = BiquadCoefs::design(FilterType::LowPass, sr_, clampT(s_.highCutHz, 2500.0, 0.45 * sr_), 0.0, 0.6);
        tapeDrive_ = 1.0 + 2.2 * clampT(s_.tape, 0.0, 1.0);
        compAmt_ = clampT(s_.comp, 0.0, 1.0);
        width_ = clampT(s_.width, 0.0, 1.5);
        compAtk_ = 1.0 - std::exp(-1.0 / (0.015 * sr_));
        compRel_ = 1.0 - std::exp(-1.0 / (0.200 * sr_));
        // cadena de muestras: las muestras ya vienen amplificadas, así que la «pantalla» solo da aire y presencia
        // (sin resonancia de graves ni corte de 4 kHz): -1.5 dB de caja a 300 Hz, +2 dB de presencia, aire hasta 9 kHz
        sCabCoef_[0] = BiquadCoefs::design(FilterType::HighPass, sr_, 70.0, 0.0, 0.7071);
        sCabCoef_[1] = BiquadCoefs::design(FilterType::Bell, sr_, 300.0, -1.5, 0.9);
        sCabCoef_[2] = BiquadCoefs::design(FilterType::Bell, sr_, 2800.0, 2.0, 0.9);
        sCabCoef_[3] = BiquadCoefs::design(FilterType::LowPass, sr_, std::min(9000.0, 0.45 * sr_), 0.0, 0.7071);
        sDrive_ = 0.5 + 4.5 * g * g;
        fxChorus_ = clampT(s_.chorusMix, 0.0, 1.0);
        fxDelay_ = clampT(s_.delayMix, 0.0, 1.0);
        fxRev_ = clampT(s_.reverbMix, 0.0, 1.0);
        delay_.setFeedback(s_.delayFb);
        updateDelayTime();
    }
    void updateDelayTime() {
        double ms = s_.delayTimeMs;
        if (bpm_ > 0.0 && s_.delayDiv < 4) {
            static const double beats[4] = { 0.75, 1.0, 0.5, 0.25 };
            double T = beats[s_.delayDiv] * 60.0 / bpm_;
            while (T > PingPongDelay::kMaxSeconds) T *= 0.5;
            ms = T * 1000.0;
        }
        delay_.setTimeSamples(ms * 0.001 * sr_);
    }

    // ---------------- cadena por chunk ----------------
    void renderChunk(int len) {
        const double bendSt = bend_.advance(len);
        const double modv = mod_.advance(len);
        vibPhase_ += 2.0 * kPi * 5.3 * len / sr_;
        if (vibPhase_ > 2.0 * kPi) vibPhase_ -= 2.0 * kPi;
        // vibrato con retardo de entrada (como la mano del guitarrista): la rueda actua tras `vibDelay` y sube en 0,4 s
        vibT_ += static_cast<double>(len) / sr_;
        const double vdel = s_.vibDelayMs * 0.001;
        const double vramp = vdel <= 0.0 ? 1.0 : clampT((vibT_ - vdel) / 0.4, 0.0, 1.0);
        // pre-bend / bend-up (por keyswitch)
        tbT_ += static_cast<double>(len) / sr_;
        {
            const double amt = clampT(s_.bendAmount, 0.5, 4.0);
            double tgt = 0.0;
            if (tbMode_ == 1) { if (tbT_ < 0.12) tgt = amt; else if (tbT_ < 0.52) tgt = amt * 0.5 * (1.0 + std::cos(kPi * (tbT_ - 0.12) / 0.40)); }
            else if (tbMode_ == 2) { if (tbT_ < 0.08) tgt = 0.0; else if (tbT_ < 0.50) tgt = amt * 0.5 * (1.0 - std::cos(kPi * (tbT_ - 0.08) / 0.42)); else tgt = amt; }
            tbSm_ += (tgt - tbSm_) * (1.0 - std::exp(-static_cast<double>(len) / (0.006 * sr_)));
        }
        const double st = bendSt + modv * vramp * 0.45 * std::sin(vibPhase_) + tbSm_;
        const double m = std::exp2(-st / 12.0);
        // swell de volumen (CC11 + auto-swell por nota): ganancia previa al ampli y a los efectos
        swellPos_ += static_cast<double>(len) / sr_;
        const bool swellOn = autoSwellKs_ || s_.swellTimeMs > 0.0;
        if (swellOn) {
            const double T = (s_.swellTimeMs > 0.0 ? s_.swellTimeMs : 700.0) * 0.001;
            const double x = clampT((swellPos_ - 0.004) / T, 0.0, 1.0);
            swellG_ += (x * x * (3.0 - 2.0 * x) - swellG_) * (1.0 - std::exp(-static_cast<double>(len) / (0.003 * sr_)));
        } else swellG_ = 1.0;
        const double exv = expr_.advance(len);
        const double eg0 = prevEg_, eg1 = exv * exv * swellG_;
        prevEg_ = eg1;
        for (int i = 0; i < len; ++i) { vbuf_[static_cast<size_t>(i)] = 0.0; nzBuf_[static_cast<size_t>(i)] = 0.0; }
        for (auto& v : voices_) if (v.active) renderVoice(v, vbuf_.data(), len, m);
        for (auto& h : harm_) if (h.active) { h.setRate(1.0 / m, sr_); h.render(vbuf_.data(), len); }
        for (auto& f : fx_) if (f.active) f.render(nzBuf_.data(), len, sr_);
        const bool useSamp = sampler_.ready();
        if (useSamp) {
            for (int i = 0; i < len; ++i) sL_[static_cast<size_t>(i)] = sR_[static_cast<size_t>(i)] = 0.0;
            sampler_.setBend(static_cast<float>(st));
            sampler_.render(sL_.data(), sR_.data(), len);
        }
        const double vg0 = vol_.current(), vg1 = vol_.advance(len), w0 = wet_.current(), w1 = wet_.advance(len);
        const double thr = 0.0004 + 0.0030 * s_.ampGain;
        const double k1 = k1_, k2 = k2_;
        double up[4], dn[4];
        for (int i = 0; i < len; ++i) {
            double ampL, ampR;
            if (useSamp) {
                const double cabAmt = clampT(s_.cab, 0.0, 1.0);
                const double mv = 0.8 * vbuf_[static_cast<size_t>(i)];
                const double eg = eg0 + (eg1 - eg0) * static_cast<double>(i + 1) / static_cast<double>(len);
                const double inp[2] = { (sL_[static_cast<size_t>(i)] + mv) * eg, (sR_[static_cast<size_t>(i)] + mv) * eg };
                double o[2];
                const double a = sDrive_;
                for (int c = 0; c < 2; ++c) {
                    SampChain& ch = samp_[static_cast<size_t>(c)];
                    const double x0 = biquadProcess(inHp_, ch.hp, inp[c]);
                    ch.os.up(x0, up);
                    for (int p = 0; p < osF_; ++p) dn[p] = fastTanh(up[p] * a) / a;      // drive suave simétrico (unitario en señal baja)
                    double y = ch.os.down(dn);
                    for (int b = 0; b < 4; ++b) y = biquadProcess(toneCoef_[b], ch.tone[b], y);
                    ch.di = diC_ * ch.di + (1.0 - diC_) * y;
                    double cb = y;
                    for (int b = 0; b < 4; ++b) cb = biquadProcess(sCabCoef_[b], ch.cab[b], cb);
                    o[c] = ch.di * (1.0 - cabAmt) + cb * cabAmt;
                }
                ampL = o[0] * sGain_; ampR = o[1] * sGain_;
            } else {
            const double egm = eg0 + (eg1 - eg0) * static_cast<double>(i + 1) / static_cast<double>(len);
            double x = biquadProcess(inHp_, stIn_, vbuf_[static_cast<size_t>(i)] * egm);
            // puerta de ruido suave (expansor)
            gateEnv_ = std::max(std::fabs(x), gateEnv_ * envDecay_);
            const double gt = std::min(1.0, gateEnv_ / thr);
            gateG_ += (gt * gt - gateG_) * (gt * gt > gateG_ ? gateAtk_ : gateRel_);
            x *= gateG_;
            // preamp + saturador asimétrico (2 etapas) sobremuestreado
            os_.up(x, up);
            for (int p = 0; p < osF_; ++p) {
                double a = up[p] * k1;
                double yA = fastTanh(a + biasA_) - tanhBiasA_;
                osHp_ = osHpC_ * osHp_ + (1.0 - osHpC_) * yA;                // pasa-altos interetapa (resta LP)
                double z = yA - osHp_;
                osLp_ = osLpC_ * osLp_ + (1.0 - osLpC_) * z;
                z = osLp_;
                double yB = fastTanh(z * k2 + 0.08) - tanhBiasB_;
                osFizz_ = osFizzC_ * osFizz_ + (1.0 - osFizzC_) * yB;
                dn[p] = osFizz_;
            }
            double y = os_.down(dn) * post_;
            y = biquadProcess(dcHp_, stDc_, y);
            for (int b = 0; b < 4; ++b) y = biquadProcess(toneCoef_[b], stTone_[b], y);
            // DI (LP suave) vs pantalla
            diLp_ = diC_ * diLp_ + (1.0 - diC_) * y;
            double cab = y;
            for (int b = 0; b < 6; ++b) cab = biquadProcess(cabCoef_[b], stCab_[b], cab);
            stCabDl_[static_cast<size_t>(cabW_ & 63)] = cab;
            cab += 0.14 * stCabDl_[static_cast<size_t>((cabW_ - cabDelay_) & 63)];   // reflexión corta de cono/micrófono
            const double cabAmt = clampT(s_.cab, 0.0, 1.0);
            double amp = diLp_ * (1.0 - cabAmt) * 0.8 + cab * cabAmt * 1.55;
            ++cabW_;
            ampL = ampR = amp;
            }
            {   // ruidos de tecnica (dedo, traste, pua): limpios, tras el ampli, con el mismo swell/expresion
                const double egn = eg0 + (eg1 - eg0) * static_cast<double>(i + 1) / static_cast<double>(len);
                const double nz = nzBuf_[static_cast<size_t>(i)] * egn;
                ampL += nz; ampR += nz;
            }
            // chorus real
            double cl, cr;
            chorus_.process(0.5 * (ampL + ampR), cl, cr);
            const double cm = fxChorus_;
            double l = ampL * (1.0 - 0.35 * cm) + cl * 0.78 * cm;
            double r = ampR * (1.0 - 0.35 * cm) + cr * 0.78 * cm;
            // delay ping-pong (entrada = suma de la guitarra con chorus)
            double dl, dr;
            delay_.process(0.5 * (l + r), dl, dr);
            l += dl * fxDelay_ * 0.9;
            r += dr * fxDelay_ * 0.9;
            // reverb de plato
            double rl, rr;
            reverb_.process(0.5 * (l + r), rl, rr);
            l += rl * fxRev_ * 0.55;
            r += rr * fxRev_ * 0.55;
            // acabado: cinta sutil -> compresor suave (enlazado, 2:1..4:1, codo blando) -> anchura M/S -> cortes
            if (tapeDrive_ > 1.0001) { l = fastTanh(l * tapeDrive_) / tapeDrive_; r = fastTanh(r * tapeDrive_) / tapeDrive_; }
            if (compAmt_ > 0.001) {
                const double lvl = std::max(std::fabs(l), std::fabs(r));
                compEnv_ += (lvl - compEnv_) * (lvl > compEnv_ ? compAtk_ : compRel_);
                const double thr = 0.14;                                   // ~ -17 dBFS
                const double ratio = 1.0 + 3.0 * compAmt_;
                double gc = 1.0;
                if (compEnv_ > thr) gc = std::pow(compEnv_ / thr, 1.0 / ratio - 1.0);
                const double mk = 1.0 + 0.35 * compAmt_;                  // maquillaje moderado
                l *= gc * mk; r *= gc * mk;
            }
            {
                const double m = 0.5 * (l + r), sd = 0.5 * (l - r) * width_;
                l = m + sd; r = m - sd;
            }
            l = biquadProcess(hcCoef_, stHc_[0], biquadProcess(lcCoef_, stLc_[0], l));
            r = biquadProcess(hcCoef_, stHc_[1], biquadProcess(lcCoef_, stLc_[1], r));
            const double t = static_cast<double>(i + 1) * (1.0 / len);
            const double gain = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t);
            l = softLimit(biquadProcess(outHp_, stOut_[0], l) * gain);
            r = softLimit(biquadProcess(outHp_, stOut_[1], r) * gain);
            chL_[static_cast<size_t>(i)] = l;
            chR_[static_cast<size_t>(i)] = r;
        }
    }

    double sr_{48000.0};
    GuitarSettings s_;
    std::array<Voice, kMaxVoices> voices_;
    std::array<Pending, 32> pending_;
    std::vector<double> scratch_, scratch2_;
    std::array<double, kChunk> vbuf_{}, chL_{}, chR_{}, sL_{}, sR_{};
    JwSampler::Sampler sampler_;
    bool samplerLoadStarted_{false};
    std::array<SampChain, 2> samp_;
    std::array<BiquadCoefs, 4> sCabCoef_;
    std::array<int64_t, 128> sampKeyEnd_{};
    double sDrive_{0.9}, sGain_{1.0};
    BiquadCoefs lcCoef_, hcCoef_;
    BiquadState stLc_[2], stHc_[2];
    double tapeDrive_{1.0}, compAmt_{0.0}, width_{1.0}, compEnv_{0.0}, compAtk_{0.01}, compRel_{0.001};
    int64_t noiseLen_{3840};
    double invNoiseLen_{1.0 / 3840};
    int lineSize_{2048}, lineMask_{2047}, osF_{1}, killLen_{240}, cabDelay_{10};
    Oversampler os_;
    Chorus chorus_;
    PingPongDelay delay_;
    PlateReverb reverb_;
    Smoother vol_, wet_, bend_, mod_;
    // amp
    BiquadCoefs inHp_, dcHp_, outHp_;
    std::array<BiquadCoefs, 4> toneCoef_;
    std::array<BiquadCoefs, 6> cabCoef_;
    BiquadState stIn_, stDc_, stOut_[2];
    std::array<BiquadState, 4> stTone_;
    std::array<BiquadState, 6> stCab_;
    std::array<double, 64> stCabDl_{};
    int cabW_{0};
    double tanhBiasA_{0.0}, tanhBiasB_{0.0};
    double k1_{4.0}, k2_{3.0}, biasA_{0.2}, post_{1.0}, diC_{0.5};
    double osHpC_{0.99}, osLpC_{0.5}, osFizzC_{0.5};
    double osHp_{0}, osLp_{0}, osFizz_{0}, diLp_{0};
    double gateEnv_{0}, gateG_{0}, gateAtk_{0.01}, gateRel_{0.001}, envDecay_{0.999};
    double fxChorus_{0}, fxDelay_{0}, fxRev_{0};
    // estado de interpretación
    double bpm_{0.0}, lastBpm_{-1.0}, bendNorm_{0.0}, modV_{0.0}, vibPhase_{0.0};
    bool pedal_{false};
    int64_t now_{0}, orderCtr_{0};
    // tecnicas
    int art_{0}, strumDir_{0}, slideModeP_{0}, nextSlide_{0}, nextBend_{0}, legatoMode_{0};
    int pArt_{0}, pLeg_{0}, pSlide_{0}, pDir_{0};
    double pExpr_{1.0};
    bool autoSwellKs_{false}, altFlip_{false}, tremDown_{true};
    Smoother expr_;
    std::array<bool, 128> held_{};
    std::array<uint8_t, 128> noteSlideOut_{}, noteArt_{};
    std::array<int64_t, 128> noteStart_{};
    std::array<double, 128> noteVel_{};
    int heldCount_{0}, lastNote_{-1}, tremCount_{0}, grpN_{0}, grpWait_{-1};
    int64_t lastLaunch_{-1000000000}, tremNext_{0};
    std::array<GrpNote, 16> grp_{};
    std::array<Trem, 8> trem_{};
    std::array<FxVoice, 12> fx_{};
    JasWaveFx::FxRack rack_;
    std::array<HarmVoice, 8> harm_{};
    std::array<double, kChunk> nzBuf_{};
    double swellPos_{1.0e9}, swellG_{1.0}, vibT_{1.0e9}, tbT_{0.0}, tbSm_{0.0}, prevEg_{1.0};
    int tbMode_{0};
    uint32_t rng_{0xC0FFEEu};
};

} // namespace JasWaveElectricGuitar
