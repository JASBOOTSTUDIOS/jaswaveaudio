// =====================================================================================
//  JasWave Strings Section – sección de cuerdas orquestal legato (sin muestras, sin asignaciones en render)
//
//   Síntesis de cuerda frotada
//     - Fuente: diente de sierra PolyBLEP (band-limited) por «instrumentista», con irregularidad de
//       fricción (jitter de tono y de amplitud coloreado), ruido de arco y «chiff» de ataque.
//     - Caja: formantes de violín / viola / chelo / contrabajo (3 resonancias + «bridge hill») con
//       crossfade continuo según el registro (interpolación log de frecuencia entre instrumentos).
//     - Ensemble: cada nota = 4..8 instrumentistas con desafinación (media exacta 0), fase, vibrato
//       (velocidad, profundidad y fase), entrada/salida temporal y paneo por atril distintos, todo
//       con PRNG xorshift propio. Densidad adaptativa: con muchas voces cada una usa menos atriles.
//     - Vibrato con retardo de aparición; tremolo de arco opcional que sólo actúa con velocidad alta.
//   Expresión
//     - expression (CC11) = nivel; mod wheel (CC1) = capa dinámica pp->ff. Ambos mueven además el
//       brillo (corte del filtro dinámico) en tiempo real, con suavizado.
//     - Velocidad MIDI -> tiempo de ataque, brillo inicial y chiff.
//     - Legato: una nota que llega con UNA sola nota sostenida cercana (y no en un acorde) no
//       re-ataca: la voz se retarga con portamento breve.
//     - CC64 sustain, pitch bend ±2 st.
//   Sala: FDN de 8 líneas (Hadamard ortogonal) con difusores de entrada, pre-delay, amortiguación
//     de agudos por línea y modulación suave; RT60 0.4..4.0 s; estable (|g|<1) con cualquier valor.
//   Salida: soft-clip con rodilla (nunca clamp duro) y bloqueador de DC.
//
//  MODO HÍBRIDO (muestras reales)
//   Si existe el banco `strings-section.jws` (VSCO 2 CE, CC0: violines, violas, chelos y contrabajo en sostenido con
//   vibrato, con bucle de sostenido; ver tools/gen_strings_bank.py) las notas suenan con SAMPLES; mientras no esté
//   cargado (o si la nota queda fuera del banco) suena el motor modelado de arriba. Los parámetros actúan así:
//     - expression (CC11): nivel + brillo (filtro de 2 polos que sigue a CC11 y CC1); CC1 sube además la capa de velocidad.
//     - attack_time: envolvente de entrada smoothstep sobre la muestra (menos con velocidad alta).
//     - vibrato_depth: vibrato extra por voz de hasta ±8 cents a ~5,3 Hz con deriva aleatoria y fase propia por voz.
//     - release_time: escala del release de las zonas; hall_size: la misma sala FDN (algo más seca: la muestra ya trae sala).
//     - legato: una nota nueva con UNA sola nota sostenida cercana arranca ya DENTRO del bucle (sin re-ataque) y la
//       anterior se funde; cada voz salta a una fase aleatoria del bucle (sin flanger entre unísonos).
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include "jw_sampler.h"
#include "jw_fxrack.h"

namespace JasWaveStrings {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kExpression = 0, kVibratoDepth = 1, kAttackTime = 2, kReleaseTime = 3, kHallSize = 4, kBypass = 5, kVolume = 6,
    kTune = 7, kWidth = 8, kSectionSize = 9, kModWheel = 10, kSustain = 11, kPitchBendP = 12, kLegato = 13,
    kGlideTime = 14, kTremolo = 15,
    kWarmth = 16, kEnsemble = 17, kCompressor = 18, kLowCut = 19      // mezcla (nuevos: al final para no romper automatización)
};
enum Feature : int { kFeatHall = 0 };

constexpr int kMaxVoices = 32;          // polifonía (notas simultáneas)
constexpr int kPool = kMaxVoices + 4;   // + voces que se están apagando (robo con fundido)
constexpr int kMaxPlayers = 8;          // instrumentistas por nota
constexpr int kChunk = 64;              // sub-bloque de control (parámetros, vibrato, filtros dinámicos)

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kExpression, "Expression", "%", 0.0, 100.0, 75.0, 0));
        v.push_back(linearP(kVibratoDepth, "Vibrato Depth", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(linearP(kAttackTime, "Attack Time", "ms", 20.0, 1500.0, 220.0, 0));
        v.push_back(linearP(kReleaseTime, "Release Time", "ms", 50.0, 3000.0, 650.0, 0));
        v.push_back(withFeature(linearP(kHallSize, "Hall Size", "%", 0.0, 100.0, 60.0, 0), kFeatHall));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kTune, "Tune A4", "Hz", 430.0, 450.0, 440.0, 1));
        v.push_back(linearP(kWidth, "Stereo Width", "%", 0.0, 100.0, 75.0, 0));
        v.push_back(linearP(kSectionSize, "Section Size", "", 4.0, 8.0, 6.0, 0));
        v.push_back(linearP(kModWheel, "Mod Wheel", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(toggleP(kSustain, "Sustain Pedal", 0));
        v.push_back(linearP(kPitchBendP, "Pitch Bend", "st", -2.0, 2.0, 0.0, 2, true));
        v.push_back(toggleP(kLegato, "Legato", 1));
        v.push_back(linearP(kGlideTime, "Legato Glide", "ms", 0.0, 300.0, 80.0, 0));
        v.push_back(linearP(kTremolo, "Bow Tremolo", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kWarmth, "Warmth", "%", 0.0, 100.0, 55.0, 0));            // recorte de aspereza 2-5 kHz + brillo suave
        v.push_back(linearP(kEnsemble, "Ensemble", "%", 0.0, 100.0, 25.0, 0));        // chorus/ensemble sutil
        v.push_back(linearP(kCompressor, "Compressor", "%", 0.0, 100.0, 30.0, 0));    // compresor suave de bus
        v.push_back(linearP(kLowCut, "Low Cut", "Hz", 20.0, 200.0, 35.0, 0));         // paso-altos
        marcarBasicos(v, { kBypass, kVolume, kExpression, kVibratoDepth, kHallSize, kAttackTime, kReleaseTime });   // modo Básico del editor
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..): EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura
        return v;
    }();
    return defs;
}

struct StringsSettings {
    double expression{0.75}, vibrato{0.30}, attackSec{0.22}, releaseSec{0.65}, hall{0.60}, volumeDb{0.0}, a4{440.0};
    double width{0.75}, modWheel{0.0}, bendSemis{0.0}, glideMs{80.0}, tremolo{0.0};
    double warmth{0.55}, ensemble{0.25}, compress{0.30}, lowCutHz{35.0};
    int sectionSize{6};
    bool sustain{false}, legato{true}, bypass{false};
};

struct StringsBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<int> players{0};
    std::atomic<uint64_t> keys[2]{};   // notas sonando (MIDI 0..127)
    std::atomic<int> maxVoices{kMaxVoices};
};

// PRNG xorshift32 (sin rand(), determinista, sin estado global)
struct Rng {
    uint32_t s{0x9E3779B9u};
    void seed(uint32_t v) { s = v ? v : 0x9E3779B9u; for (int i = 0; i < 4; ++i) next32(); }
    uint32_t next32() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    double uni() { return (next32() >> 8) * (1.0 / 16777216.0); }   // [0,1)
    double bip() { return uni() * 2.0 - 1.0; }                       // [-1,1)
};

inline double smooth01(double x) { x = x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x); return x * x * (3.0 - 2.0 * x); }

// Soft-clip con rodilla: lineal hasta 0.72, luego tanh hacia ±1 (derivada continua)
inline double softClip(double x) {
    constexpr double t = 0.72;
    const double a = std::fabs(x);
    if (a <= t) return x;
    const double y = t + (1.0 - t) * std::tanh((a - t) / (1.0 - t));
    return x < 0 ? -y : y;
}

// ---------------------------------------------------------------------------------
//  Sala: FDN de 8 líneas
// ---------------------------------------------------------------------------------
class HallReverb {
public:
    static constexpr int N = 8;
    void prepare(double sr) {
        sr_ = sr > 0 ? sr : 48000.0;
        const double sc = sr_ / 48000.0;
        static const int base[N] = { 1499, 1747, 2053, 2339, 2713, 3119, 3511, 3943 };
        modDepth_ = 9.0 * sc;
        for (int i = 0; i < N; ++i) {
            len_[i] = std::max(64, static_cast<int>(base[i] * sc));
            buf_[i].assign(static_cast<size_t>(len_[i] + 2 * static_cast<int>(modDepth_) + 16), 0.0);
            bp_[i] = buf_[i].data();
            sz_[i] = static_cast<int>(buf_[i].size());
        }
        static const int apBase[4] = { 142, 107, 379, 277 };
        for (int i = 0; i < 4; ++i) {
            apLen_[i] = std::max(8, static_cast<int>(apBase[i] * sc));
            apBuf_[i].assign(static_cast<size_t>(apLen_[i]), 0.0);
        }
        pdBuf_.assign(static_cast<size_t>(0.16 * sr_) + 8, 0.0);
        hpA_ = std::exp(-2.0 * kPi * 110.0 / sr_);
        dcA_ = std::exp(-2.0 * kPi * 30.0 / sr_);
        hS_ = 0.65;
        reset();
        update(0.65, kChunk, true);
    }
    void reset() {
        for (auto& b : buf_) std::fill(b.begin(), b.end(), 0.0);
        for (auto& b : apBuf_) std::fill(b.begin(), b.end(), 0.0);
        std::fill(pdBuf_.begin(), pdBuf_.end(), 0.0);
        for (int i = 0; i < N; ++i) { w_[i] = 0; lp_[i] = 0.0; }
        for (int i = 0; i < 4; ++i) apW_[i] = 0;
        pdW_ = 0; hpX_ = hpY_ = 0.0; dcL_ = dcR_ = dcXL_ = dcXR_ = 0.0;
        lfoPh_ = 0.0;
    }
    // Una vez por sub-bloque: hall 0..1 -> RT60, amortiguación, pre-delay y nivel (suavizado)
    void update(double hall, int n, bool immediate = false) {
        hall = clampT(hall, 0.0, 1.0);
        const double k = immediate ? 1.0 : 1.0 - std::exp(-static_cast<double>(n) / (0.25 * sr_));
        hS_ += (hall - hS_) * k;
        const double rt60 = 0.4 + 3.6 * std::pow(hS_, 1.2);
        for (int i = 0; i < N; ++i)
            g_[i] = std::exp(-6.907755 * len_[i] / (sr_ * rt60));       // 10^(-3 L/(sr RT60)) < 1 siempre
        const double fd = 7500.0 - 4500.0 * hS_;   // amortiguación cálida: la cola pierde agudos antes
        damp_ = std::exp(-2.0 * kPi * fd / sr_);
        pdTarget_ = (0.010 + 0.060 * hS_) * sr_;
        if (immediate) pd_ = pdTarget_; else pd_ += (pdTarget_ - pd_) * k;
        wet_ = 0.30 + 0.70 * hS_;
        // LFO de modulación: cada línea con su fase, ~0.17..0.43 Hz
        const double dtc = static_cast<double>(n) / sr_;
        for (int i = 0; i < N; ++i) {
            modPrev_[i] = modNow_[i];
            const double ph = lfoPh_ * (0.17 + 0.037 * i) + i * 0.7853981;
            modNow_[i] = modDepth_ * std::sin(2.0 * kPi * ph);
        }
        lfoPh_ += dtc;
        if (lfoPh_ > 1.0e4) lfoPh_ = 0.0;
        if (immediate) for (int i = 0; i < N; ++i) modPrev_[i] = modNow_[i];
    }
    double wetGain() const { return wet_; }

    // Procesa un sub-bloque: entrada estéreo (mix seco) -> salida húmeda estéreo
    void process(const double* inL, const double* inR, double* outL, double* outR, int n) {
        const double invN = 1.0 / n;
        for (int s = 0; s < n; ++s) {
            const double t = (s + 1) * invN;
            // send mono + paso alto
            const double x = 0.5 * (inL[s] + inR[s]);
            hpY_ = hpA_ * (hpY_ + x - hpX_);
            hpX_ = x;
            // pre-delay (interpolado)
            pdBuf_[static_cast<size_t>(pdW_)] = hpY_;
            double pd = std::max(1.0, pd_);
            const int pdLen = static_cast<int>(pdBuf_.size());
            const int di = std::min(static_cast<int>(pd), pdLen - 2);
            const double fr = pd - di;
            int r0 = pdW_ - di; if (r0 < 0) r0 += pdLen;
            int r1 = r0 - 1; if (r1 < 0) r1 += pdLen;
            double v = pdBuf_[static_cast<size_t>(r0)] * (1.0 - fr) + pdBuf_[static_cast<size_t>(r1)] * fr;
            if (++pdW_ >= pdLen) pdW_ = 0;
            // difusores Schroeder
            for (int a = 0; a < 4; ++a) {
                auto& b = apBuf_[a];
                const double d = b[static_cast<size_t>(apW_[a])];
                const double vv = v + 0.6 * d;
                const double y = -0.6 * vv + d;
                b[static_cast<size_t>(apW_[a])] = vv;
                if (++apW_[a] >= apLen_[a]) apW_[a] = 0;
                v = y;
            }
            // lectura de las líneas (retardo modulado), amortiguación y ganancia
            double y[N];
            for (int i = 0; i < N; ++i) {
                const double mod = modPrev_[i] + (modNow_[i] - modPrev_[i]) * t;
                const double d = len_[i] + mod;
                const int di2 = static_cast<int>(d);
                const double f2 = d - di2;
                const int size = sz_[i];
                const double* bf = bp_[i];
                int a0 = w_[i] - di2; if (a0 < 0) a0 += size;
                int a1 = a0 - 1; if (a1 < 0) a1 += size;
                const double xr = bf[a0] * (1.0 - f2) + bf[a1] * f2;
                lp_[i] = xr * (1.0 - damp_) + lp_[i] * damp_;   // ganancia en DC = 1
                y[i] = lp_[i] * g_[i];
            }
            // salida estéreo decorrelada (filas ortogonales de Hadamard)
            const double oL = 0.35 * (y[0] + y[1] - y[2] - y[3] + y[4] + y[5] - y[6] - y[7]);
            const double oR = 0.35 * (y[0] - y[1] - y[2] + y[3] + y[4] - y[5] - y[6] + y[7]);
            // matriz de mezcla Hadamard 8x8 normalizada (ortogonal: conserva energía)
            double h[N];
            for (int i = 0; i < N; ++i) h[i] = y[i];
            for (int len = 1; len < N; len <<= 1)
                for (int i = 0; i < N; i += len << 1)
                    for (int j = i; j < i + len; ++j) { const double a = h[j], b = h[j + len]; h[j] = a + b; h[j + len] = a - b; }
            constexpr double nrm = 0.35355339059327373;   // 1/sqrt(8)
            static const double sign[N] = { 1, -1, 1, 1, -1, 1, -1, -1 };
            for (int i = 0; i < N; ++i) {
                bp_[i][w_[i]] = h[i] * nrm + v * 0.30 * sign[i];
                if (++w_[i] >= sz_[i]) w_[i] = 0;
            }
            // bloqueador de DC de la cola
            const double l = oL - dcXL_ + dcA_ * dcL_; dcXL_ = oL; dcL_ = l;
            const double r = oR - dcXR_ + dcA_ * dcR_; dcXR_ = oR; dcR_ = r;
            outL[s] = l;
            outR[s] = r;
        }
    }

private:
    double sr_{48000.0}, modDepth_{9.0}, hpA_{0.99}, dcA_{0.999}, hS_{0.65}, damp_{0.5}, pd_{1000}, pdTarget_{1000}, wet_{0.5}, lfoPh_{0.0};
    int len_[N]{}, w_[N]{}, apLen_[4]{}, apW_[4]{}, pdW_{0};
    double g_[N]{}, lp_[N]{}, modPrev_[N]{}, modNow_[N]{};
    double hpX_{0}, hpY_{0}, dcL_{0}, dcR_{0}, dcXL_{0}, dcXR_{0};
    std::vector<double> buf_[N], apBuf_[4], pdBuf_;
    double* bp_[N]{};
    int sz_[N]{};
};

// ---------------------------------------------------------------------------------
//  Cadena de mezcla de la sección (antes de la sala): paso-altos, recorte de aspereza 2-5 kHz y brillo suave,
//  compresor suave de bus (ligado estéreo, rodilla blanda) y ensemble/chorus sutil (3 retardos modulados por canal).
//  Sin asignaciones en render; con todo a cero es transparente.
// ---------------------------------------------------------------------------------
class MixChain {
public:
    void prepare(double sr) {
        sr_ = sr > 0 ? sr : 48000.0;
        dlen_ = static_cast<int>(0.05 * sr_) + 16;
        for (auto& b : buf_) b.assign(static_cast<size_t>(dlen_), 0.0);
        envA_ = std::exp(-1.0 / (0.020 * sr_));
        envR_ = std::exp(-1.0 / (0.250 * sr_));
        gsA_ = std::exp(-1.0 / (0.005 * sr_));
        cached_ = false;
        reset();
    }
    void reset() {
        for (auto& b : buf_) std::fill(b.begin(), b.end(), 0.0);
        for (int c = 0; c < 2; ++c) for (auto& st : bq_[c]) st = BiquadState{};
        w_ = 0; env_ = 0.0; gr_ = 0.0; ph_ = 0.0;
        for (int c = 0; c < 2; ++c) for (int k = 0; k < 3; ++k) dPrev_[c][k] = -1.0;
    }
    void configure(double warmth, double ensemble, double comp, double lowCutHz) {
        if (cached_ && warmth == cw_ && ensemble == ce_ && comp == cc_ && lowCutHz == cl_) return;
        cached_ = true; cw_ = warmth; ce_ = ensemble; cc_ = comp; cl_ = lowCutHz;
        const double w = clampT(warmth, 0.0, 1.0);
        co_[0] = BiquadCoefs::design(FilterType::HighPass, sr_, clampT(lowCutHz, 20.0, 300.0), 0.0, 0.7071);
        co_[1] = BiquadCoefs::design(FilterType::Bell, sr_, 3300.0, -5.0 * w, 0.8);          // aspereza del arco 2-5 kHz
        co_[2] = BiquadCoefs::design(FilterType::HighShelf, sr_, 7500.0, -4.0 * w, 0.7);     // aire suave, sin dureza digital
        co_[3] = BiquadCoefs::design(FilterType::LowShelf, sr_, 250.0, 1.5 * w, 0.7);        // cuerpo cálido
        ens_ = clampT(ensemble, 0.0, 1.0);
        const double cp = clampT(comp, 0.0, 1.0);
        ratio_ = 1.0 + 2.0 * cp;
        makeup_ = 0.15 * 20.0 * (1.0 - 1.0 / ratio_);
    }
    void process(double* l, double* r, int n) {
        // --- EQ ---
        for (int i = 0; i < n; ++i) {
            double a = l[i], b = r[i];
            for (int k = 0; k < 4; ++k) { a = biquadProcess(co_[k], bq_[0][k], a); b = biquadProcess(co_[k], bq_[1][k], b); }
            l[i] = a; r[i] = b;
        }
        // --- compresor (rodilla blanda 10 dB, umbral -20 dBFS) ---
        if (ratio_ > 1.001) {
            const double thr = -20.0, knee = 10.0;
            for (int i = 0; i < n; ++i) {
                const double x = std::max(std::fabs(l[i]), std::fabs(r[i]));
                env_ = x > env_ ? x + envA_ * (env_ - x) : x + envR_ * (env_ - x);
                const double lvl = 20.0 * std::log10(env_ + 1.0e-9);
                const double over = lvl - thr;
                double grT = 0.0;
                if (2.0 * over > knee) grT = (1.0 / ratio_ - 1.0) * over;
                else if (2.0 * over > -knee) grT = (1.0 / ratio_ - 1.0) * (over + knee * 0.5) * (over + knee * 0.5) / (2.0 * knee);
                gr_ = grT + gsA_ * (gr_ - grT);
                const double g = std::pow(10.0, (gr_ + makeup_) * 0.05);
                l[i] *= g; r[i] *= g;
            }
        } else gr_ = 0.0;
        // --- ensemble ---
        if (ens_ > 0.0005) {
            static const double base[3] = { 0.013, 0.019, 0.025 }, depth[3] = { 0.0016, 0.0019, 0.0014 }, rate[3] = { 0.31, 0.47, 0.63 };
            const double dtc = static_cast<double>(n) / sr_;
            double dNow[2][3];
            for (int c = 0; c < 2; ++c) for (int k = 0; k < 3; ++k)
                dNow[c][k] = (base[k] + depth[k] * std::sin(2.0 * kPi * (ph_ * rate[k]) + 2.1 * k + 1.0 * c + 0.5 * c * k)) * sr_;
            const double mixW = 0.30 * ens_;
            for (int i = 0; i < n; ++i) {
                const double t = static_cast<double>(i + 1) / n;
                double* in[2] = { l, r };
                double wet[2];
                for (int c = 0; c < 2; ++c) {
                    buf_[c][static_cast<size_t>(w_)] = in[c][i];
                    double acc = 0.0;
                    for (int k = 0; k < 3; ++k) {
                        const double d0 = dPrev_[c][k] < 0.0 ? dNow[c][k] : dPrev_[c][k];
                        const double d = d0 + (dNow[c][k] - d0) * t;
                        const int di = static_cast<int>(d);
                        const double fr = d - di;
                        int a0 = w_ - di; if (a0 < 0) a0 += dlen_;
                        int a1 = a0 - 1; if (a1 < 0) a1 += dlen_;
                        acc += buf_[c][static_cast<size_t>(a0)] * (1.0 - fr) + buf_[c][static_cast<size_t>(a1)] * fr;
                    }
                    wet[c] = acc * (1.0 / 3.0);
                }
                // los canales se cruzan un poco: el coro abre la imagen sin cambiar el nivel medio
                l[i] = l[i] * (1.0 - mixW) + wet[0] * mixW * 1.15;
                r[i] = r[i] * (1.0 - mixW) + wet[1] * mixW * 1.15;
                if (++w_ >= dlen_) w_ = 0;
            }
            for (int c = 0; c < 2; ++c) for (int k = 0; k < 3; ++k) dPrev_[c][k] = dNow[c][k];
            ph_ += dtc; if (ph_ > 1.0e4) ph_ = 0.0;
        } else {
            for (int i = 0; i < n; ++i) { buf_[0][static_cast<size_t>(w_)] = l[i]; buf_[1][static_cast<size_t>(w_)] = r[i]; if (++w_ >= dlen_) w_ = 0; }
            for (int c = 0; c < 2; ++c) for (int k = 0; k < 3; ++k) dPrev_[c][k] = -1.0;
        }
    }
    double gainReductionDb() const { return -gr_; }

private:
    double sr_{48000.0}, envA_{0.99}, envR_{0.999}, gsA_{0.99}, env_{0}, gr_{0}, ratio_{1.0}, makeup_{0}, ens_{0}, ph_{0};
    double cw_{-1}, ce_{-1}, cc_{-1}, cl_{-1};
    bool cached_{false};
    int dlen_{2048}, w_{0};
    BiquadCoefs co_[4];
    BiquadState bq_[2][4];
    std::vector<double> buf_[2];
    double dPrev_[2][3]{};
};

// ---------------------------------------------------------------------------------
//  Motor
// ---------------------------------------------------------------------------------
class StringsEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        vol_.prepare(sr_, 20.0);
        wet_.prepare(sr_, 10.0);
        vol_.reset(dbToLinear(s_.volumeDb));
        wet_.reset(s_.bypass ? 0.0 : 1.0);
        killLen_ = std::max(16, static_cast<int>(0.005 * sr_));
        {   // tablas de ruido blanco y paso alto (PRNG propio, determinista); se generan aquí, nunca en render
            Rng nr; nr.seed(0xC0FFEEu);
            double lp = 0.0;
            for (int i = 0; i < kNoiseLen; ++i) {
                const double w = nr.bip();
                lp += 0.3 * (w - lp);
                noiseW_[i] = w;
                noiseH_[i] = w - lp;
            }
        }
        hall_.prepare(sr_);
        mix_.prepare(sr_);
        fx_.prepare(sr_);
        mix_.configure(s_.warmth, s_.ensemble, s_.compress, s_.lowCutHz);
        sampler_.prepare(sr_);
        if (!samplerLoadStarted_) { samplerLoadStarted_ = true; sampler_.startLoad("strings-section"); }
        {   // humanización de sección: entradas escalonadas, afinación y nivel ligeramente distintos por atril
            JwSampler::Humanize h; h.gainDb = 0.7f; h.detuneCents = 3.0f; h.timingMs = 22.0f; h.velCurve = 0.25f;
            sampler_.setHumanize(h);
        }
        sampler_.setLoopScatter(true, 0.08f);
        sampler_.setDrift(2.0f, 0.13f);
        sampler_.setLevelDb(kSampleLevelDb);
        applySamplerSettings();
        sL1_ = sL2_ = sR1_ = sR2_ = 0.0; polyS_ = 1.0;
        eS_ = s_.expression; mS_ = s_.modWheel; bendS_ = s_.bendSemis * 100.0; polyG_ = 1.0;
        reset();
    }
    void reset() {
        for (auto& v : voices_) v.active = false;
        sampler_.panic();
        mix_.reset();
        fx_.reset();
        sHeld_.fill(false); sHeldN_ = 0; lastOffClock_ = -1000000000LL;
        sL1_ = sL2_ = sR1_ = sR2_ = 0.0;
        pedal_ = false;
        hall_.reset();
        dcXL_ = dcXR_ = dcYL_ = dcYR_ = 0.0;
        clock_ = 0; lastOnClock_ = -1000000000LL; order_ = 0;
    }
    void setSettings(const StringsSettings& s) {
        if (s.sustain != s_.sustain) setPedal(s.sustain);
        s_ = s;
        mix_.configure(s.warmth, s.ensemble, s.compress, s.lowCutHz);
        applySamplerSettings();
        vol_.setTarget(dbToLinear(s.volumeDb));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
    }

    void noteOn(int note, float velIn) {
        if (note < 0 || note > 127) return;
        if (velIn <= 0.0f) { noteOff(note); return; }
        const double vel = clampT(static_cast<double>(velIn), 0.0, 1.0);
        if (samplesOn_ && sampler_.ready() && noteOnSampled(note, vel)) return;
        // Legato: exactamente UNA nota sostenida cercana, no es parte de un acorde (ataque >30 ms después)
        if (s_.legato && (clock_ - lastOnClock_) > static_cast<int64_t>(0.030 * sr_)) {
            Voice* held = nullptr;
            int heldCount = 0;
            for (auto& v : voices_) if (v.active && !v.killing && !v.keyUp) { ++heldCount; held = &v; }
            if (heldCount == 1 && held->note != note && std::abs(held->note - note) <= 7 && held->t > 0.04) {
                held->glideCents += (held->note - note) * 100.0;
                held->note = note;
                held->vel = 0.5 * (held->vel + vel);
                held->order = order_++;
                lastOnClock_ = clock_;
                return;
            }
        }
        lastOnClock_ = clock_;
        // misma tecla sonando: se apaga con fundido (re-golpe limpio)
        for (auto& v : voices_) if (v.active && !v.killing && v.note == note) startKill(v);
        int used = 0;
        for (const auto& v : voices_) if (v.active && !v.killing) ++used;
        if (used >= kMaxVoices) {
            // robo: la más antigua (las ya liberadas primero), con fundido de ~5 ms
            Voice* victim = nullptr;
            for (auto& v : voices_) {
                if (!v.active || v.killing) continue;
                if (!victim || (v.released && !victim->released) || (v.released == victim->released && v.order < victim->order)) victim = &v;
            }
            if (victim) startKill(*victim);
        }
        Voice* slot = nullptr;
        for (auto& v : voices_) if (!v.active) { slot = &v; break; }
        if (!slot) {   // pool agotado (solo con ráfagas extremas): reutiliza la voz que más se ha apagado
            double best = 2.0;
            for (auto& v : voices_) if (v.killing && v.killG < best) { best = v.killG; slot = &v; }
        }
        if (slot) start(*slot, note, vel, std::max(1, used));
    }
    void noteOff(int note) {
        if (note >= 0 && note < 128 && sHeld_[note]) { sHeld_[note] = false; --sHeldN_; lastOffClock_ = clock_; }
        sampler_.noteOff(note);
        for (auto& v : voices_) {
            if (!v.active || v.killing || v.note != note || v.keyUp) continue;
            v.keyUp = true;
            if (!pedal_) release(v);
        }
    }
    void allNotesOff() { sampler_.allNotesOff(); sHeld_.fill(false); sHeldN_ = 0; for (auto& v : voices_) if (v.active && !v.killing) startKill(v); }
    void setPedal(bool down) {
        pedal_ = down;
        sampler_.setSustain(down);
        if (!down) for (auto& v : voices_) if (v.active && v.keyUp && !v.released) release(v);
    }

    // FX Rack comun (jw_fxrack.h): va DESPUES de la MixChain propia (Warmth/Ensemble/Compressor/Low Cut) y de la sala
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    void setTempo(double bpm) { fx_.setTempo(bpm); }
    JasWaveFx::FxRack& fx() { return fx_; }

    // Suma sobre outL/outR (el llamador los pone a cero antes)
    template <class T>
    void render(T* outL, T* outR, int n, StringsBus* bus) {
        double cl[kChunk], cr[kChunk], wl[kChunk], wr[kChunk];
        float pk0 = 0, pk1 = 0;
        int pos = 0;
        while (pos < n) {
            const int m = std::min(kChunk, n - pos);
            chunk(m, cl, cr, wl, wr);
            for (int i = 0; i < m; ++i) {
                outL[pos + i] += static_cast<T>(cl[i]);
                outR[pos + i] += static_cast<T>(cr[i]);
                pk0 = std::max(pk0, static_cast<float>(std::fabs(cl[i])));
                pk1 = std::max(pk1, static_cast<float>(std::fabs(cr[i])));
            }
            pos += m;
        }
        clock_ += n;
        // rack comun: con todos los bloques apagados no toca el buffer (salida identica); encendido, los picos se miden despues
        fx_.process(outL, outR, n, bus);
        if (fx_.activo()) {
            pk0 = pk1 = 0.0f;
            for (int i = 0; i < n; ++i) { pk0 = std::max(pk0, static_cast<float>(std::fabs(static_cast<double>(outL[i])))); pk1 = std::max(pk1, static_cast<float>(std::fabs(static_cast<double>(outR[i])))); }
        }
        if (bus) {
            bus->salida(outL, outR, n);
            bus->outPk[0].update(pk0);
            bus->outPk[1].update(pk1);
            uint64_t k0 = 0, k1 = 0;
            int act = 0, pl = 0;
            for (const auto& v : voices_) {
                if (!v.active) continue;
                ++act; pl += v.nPl;
                if (v.note < 64) k0 |= 1ull << v.note; else k1 |= 1ull << (v.note - 64);
            }
            for (int k = 0; k < 128; ++k) if (sHeld_[k]) { if (k < 64) k0 |= 1ull << k; else k1 |= 1ull << (k - 64); }
            act += sHeldN_;
            bus->keys[0].store(k0, std::memory_order_relaxed);
            bus->keys[1].store(k1, std::memory_order_relaxed);
            bus->activeVoices.store(act, std::memory_order_relaxed);
            bus->players.store(pl, std::memory_order_relaxed);
        }
    }

    int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a + sampler_.activeVoices(); }
    bool samplerReady() const { return sampler_.ready(); }
    bool samplerLoading() const { return sampler_.loading(); }
    const std::string& samplerError() const { return sampler_.lastError(); }
    /// Fuerza el motor modelado (false) o permite el banco de muestras (true, por defecto).
    void setSamplesEnabled(bool on) { samplesOn_ = on; }
    int sampledVoices() const { return sampler_.activeVoices(); }
    double sampleRate() const { return sr_; }
    double fundamental(int note) const { return s_.a4 * std::pow(2.0, (note - 69) / 12.0); }
    int playersForNextNote() const { return playersFor(activeVoices() + 1); }

private:
    struct Formant { double f, gainDb, q; };
    struct Player {
        double ph{0}, inc{0}, detCents{0}, vibPh{0}, vibRate{5.5}, vibScale{1}, jit{0}, shim{0}, dOn{0}, dOff{0}, pan{0};
        double tremPh{0}, tremRate{9}, g{0};
    };
    struct Voice {
        bool active{false}, released{false}, keyUp{false}, killing{false};
        int note{-1}, nPl{0};
        uint32_t nzIdx{0};
        double vel{0.7}, t{0}, tr{0}, atkSec{0.18}, relSec{0.5}, vibDelay{0.4}, glideCents{0}, killG{1.0};
        double gAmp{0}, pan0{0}, chiffAmp{0}, chiffDec{0.999}, lpM1{0}, lpM2{0}, lpS1{0}, lpS2{0}, gvPrev{0};
        int64_t order{0};
        Rng rng;
        Player pl[kMaxPlayers];
        BiquadCoefs body[3], chiff;
        BiquadState bm[3], bs[3], chiffSt;
    };

    // Formantes de caja: 0 contrabajo, 1 chelo, 2 viola, 3 violín (aire A0, madera, «bridge hill»)
    static void bodyFor(int note, Formant out[3]) {
        static const Formant kBody[4][3] = {
            { { 62.0, 4.0, 3.0 }, { 118.0, 3.0, 4.0 }, { 700.0, 4.5, 1.5 } },
            { { 108.0, 4.5, 3.0 }, { 205.0, 3.0, 4.0 }, { 1500.0, 5.0, 1.6 } },
            { { 225.0, 4.5, 3.0 }, { 410.0, 3.0, 4.0 }, { 2100.0, 5.5, 1.6 } },
            { { 290.0, 4.5, 3.0 }, { 520.0, 3.0, 4.0 }, { 2800.0, 6.0, 1.6 } },
        };
        static const double knot[4] = { 36.0, 50.0, 64.0, 79.0 };
        int i0 = 0;
        double t = 0.0;
        if (note >= knot[3]) { i0 = 2; t = 1.0; }
        else if (note > knot[0]) {
            while (i0 < 2 && note >= knot[i0 + 1]) ++i0;
            t = (note - knot[i0]) / (knot[i0 + 1] - knot[i0]);
        }
        for (int k = 0; k < 3; ++k) {
            const Formant& a = kBody[i0][k];
            const Formant& b = kBody[i0 + 1][k];
            out[k].f = a.f * std::pow(b.f / a.f, t);
            out[k].gainDb = a.gainDb + (b.gainDb - a.gainDb) * t;
            out[k].q = a.q + (b.q - a.q) * t;
        }
    }

    // Densidad adaptativa: con más voces, cada nota usa menos atriles (CPU acotada)
    int playersFor(int voicesNow) const {
        const int want = clampT(s_.sectionSize, 4, kMaxPlayers);
        const double k = voicesNow <= 6 ? 1.0 : (voicesNow <= 12 ? 0.75 : (voicesNow <= 20 ? 0.55 : 0.42));
        return clampT(static_cast<int>(std::lround(want * k)), 3, kMaxPlayers);
    }

    void startKill(Voice& v) { v.killing = true; }

    // ---- camino de muestras ----
    void applySamplerSettings() {
        sampler_.setVibrato(static_cast<float>(clampT(s_.vibrato, 0.0, 1.0)) * 8.0f, 5.3f);          // ±8 cents máx.
        sampler_.setReleaseScale(static_cast<float>(std::max(0.05, s_.releaseSec)) / 0.5f);          // zonas con release 0,5 s
        sampler_.setTuneCents(static_cast<float>(1200.0 * std::log2(s_.a4 / 440.0)));
        sampler_.setBend(static_cast<float>(s_.bendSemis));
    }
    // Devuelve false si el banco no cubre la nota (entonces suena el motor modelado)
    bool noteOnSampled(int note, double vel) {
        // CC1 sube la capa de velocidad (más arco); la velocidad real también fija el ataque (menos con vel alta)
        const double effVel = clampT(vel + (1.0 - vel) * s_.modWheel, 0.0, 1.0);
        if (!sampler_.hasZone(note, static_cast<float>(effVel))) return false;
        const float atk = static_cast<float>(std::max(0.02, s_.attackSec) * (1.45 - 0.95 * std::pow(vel, 0.8)));
        // Legato: una sola nota sostenida cercana y esta no forma parte de un acorde (>30 ms desde el último ataque)
        if (s_.legato && sHeldN_ == 1 && (clock_ - lastOnClock_) > static_cast<int64_t>(0.030 * sr_)) {
            int held = -1;
            for (int k = 0; k < 128; ++k) if (sHeld_[k]) { held = k; break; }
            if (held >= 0 && held != note && std::abs(held - note) <= 7) {
                const float xf = static_cast<float>(clampT(s_.glideMs * 0.0007 + 0.01, 0.04, 0.2));
                sampler_.noteOff(note);
                if (sampler_.noteOnStackLegato(note, static_cast<float>(effVel), xf) > 0) {
                    sampler_.releaseNote(held, static_cast<float>(std::max(0.35, s_.releaseSec)));
                    sHeld_[held] = false; sHeld_[note] = true;
                    lastOnClock_ = clock_;
                    return true;
                }
            }
        }
        // Cambio de acorde/nota «pegado» (la anterior se soltó hace < 120 ms): también continúa el sostenido sin re-ataque
        if (s_.legato && (clock_ - lastOffClock_) >= 0 && (clock_ - lastOffClock_) < static_cast<int64_t>(0.12 * sr_)) {
            const float xf = static_cast<float>(clampT(s_.glideMs * 0.0007 + 0.01, 0.04, 0.2));
            sampler_.noteOff(note);
            if (sampler_.noteOnStackLegato(note, static_cast<float>(effVel), xf) > 0) {
                if (!sHeld_[note]) { sHeld_[note] = true; ++sHeldN_; }
                lastOnClock_ = clock_;
                return true;
            }
        }
        lastOnClock_ = clock_;
        sampler_.noteOff(note);   // misma tecla: el golpe anterior se suelta antes de empezar el nuevo
        sampler_.setAttack(atk);
        if (sampler_.noteOnStack(note, static_cast<float>(effVel)) <= 0) return false;
        if (!sHeld_[note]) { sHeld_[note] = true; ++sHeldN_; }
        return true;
    }
    void release(Voice& v) {
        v.released = true;
        v.tr = 0.0;
        v.relSec = std::max(0.05, s_.releaseSec);
    }

    void start(Voice& v, int note, double vel, int voicesNow) {
        v = Voice{};
        v.active = true;
        v.note = note;
        v.vel = vel;
        v.order = order_++;
        v.rng.seed(0x9E3779B9u ^ static_cast<uint32_t>(note * 7919) ^ (static_cast<uint32_t>(vel * 1000.0) << 12) ^ (++seedCtr_ * 2654435761u));
        Rng& r = v.rng;
        const int np = playersFor(voicesNow);
        v.nPl = np;
        v.atkSec = std::max(0.02, s_.attackSec) * (1.45 - 0.95 * std::pow(vel, 0.8));
        v.relSec = std::max(0.05, s_.releaseSec);
        v.vibDelay = 0.30 + 0.25 * r.uni();
        v.nzIdx = r.next32() & (kNoiseLen - 1);
        // atriles: desafinación y paneo estratificados (media 0) y barajados de forma independiente
        int permD[kMaxPlayers], permP[kMaxPlayers];
        for (int i = 0; i < np; ++i) permD[i] = permP[i] = i;
        for (int i = np - 1; i > 0; --i) {
            std::swap(permD[i], permD[static_cast<int>(r.uni() * (i + 1))]);
            std::swap(permP[i], permP[static_cast<int>(r.uni() * (i + 1))]);
        }
        double meanDet = 0.0;
        for (int i = 0; i < np; ++i) {
            Player& p = v.pl[i];
            const double sd = ((permD[i] + 0.5) / np - 0.5) * 2.0 + r.bip() * 0.3 / np;
            p.detCents = sd * 8.0;
            meanDet += p.detCents;
            p.pan = clampT(((permP[i] + 0.5) / np - 0.5) * 2.0 * 0.95, -1.0, 1.0);
            p.ph = r.uni();
            p.vibPh = r.uni();
            p.vibRate = 5.2 + 0.9 * r.uni();
            p.vibScale = 0.75 + 0.5 * r.uni();
            p.dOn = (i == 0 ? 0.0 : std::pow(r.uni(), 1.3) * 0.045);
            p.dOff = r.uni() * 0.05;
            p.tremRate = 8.0 + 3.0 * r.uni();
            p.tremPh = r.uni();
        }
        meanDet /= np;
        for (int i = 0; i < np; ++i) v.pl[i].detCents -= meanDet;   // media del ensemble exactamente afinada
        // caja
        Formant fm[3];
        bodyFor(note, fm);
        for (int k = 0; k < 3; ++k) v.body[k] = BiquadCoefs::design(FilterType::Bell, sr_, fm[k].f, fm[k].gainDb, fm[k].q);
        v.gAmp = kVoiceGain / std::sqrt(static_cast<double>(np)) * (0.55 + 0.45 * vel);
        // pan del registro: violines a la izquierda, bajos a la derecha (sección sentada)
        v.pan0 = clampT((58.0 - note) / 50.0, -1.0, 1.0) * 0.35;
        // chiff de arco
        const double f0 = fundamental(note);
        v.chiff = BiquadCoefs::design(FilterType::BandPass, sr_, clampT(2200.0 + f0 * 1.5, 1500.0, 6000.0), 0.0, 1.2);
        v.chiffAmp = 0.05 * std::pow(vel, 1.5) * clampT(0.25 / v.atkSec, 0.2, 1.0);
        v.chiffDec = std::exp(-1.0 / (0.035 * sr_));
    }

    void chunk(int n, double* cl, double* cr, double* wl, double* wr) {
        const double dtc = static_cast<double>(n) / sr_;
        // parámetros globales con suavizado (CC11 / CC1 / bend)
        const double kE = 1.0 - std::exp(-dtc / 0.030), kB = 1.0 - std::exp(-dtc / 0.010);
        eS_ += (s_.expression - eS_) * kE;
        mS_ += (s_.modWheel - mS_) * kE;
        bendS_ += (s_.bendSemis * 100.0 - bendS_) * kB;
        const double gE = dbToLinear(-20.0 * (1.0 - eS_));
        // compensación de polifonía: más notas simultáneas -> menos ganancia por nota (acordes sin saturar)
        int nAct = 0;
        for (const auto& vv : voices_) if (vv.active && !vv.killing) ++nAct;
        polyG_ += (1.0 / std::sqrt(1.0 + 0.15 * (std::max(1, nAct) - 1)) - polyG_) * (1.0 - std::exp(-dtc / 0.05));
        const double vib = s_.vibrato;
        const double trem = s_.tremolo;
        for (int i = 0; i < n; ++i) { cl[i] = 0.0; cr[i] = 0.0; }
        const double width = s_.width;

        for (auto& v : voices_) {
            if (!v.active) continue;
            // --- tiempos y estado de fin ---
            const double t1 = v.t + dtc;
            const double tr1 = v.released ? v.tr + dtc : 0.0;
            double kg0 = v.killG, kg1 = v.killG;
            if (v.killing) {
                kg1 = std::max(0.0, v.killG - static_cast<double>(n) / killLen_);
                if (kg0 <= 0.0) { v.active = false; continue; }
            }
            // --- glide de legato ---
            if (v.glideCents != 0.0) {
                if (s_.glideMs < 1.0) v.glideCents = 0.0;
                else {
                    v.glideCents *= std::exp(-dtc / (s_.glideMs * 0.001 / 3.0));
                    if (std::fabs(v.glideCents) < 0.01) v.glideCents = 0.0;
                }
            }
            // --- dinámica y brillo (CC11 / CC1 / velocidad) ---
            const double dyn = clampT(0.62 * eS_ + 0.38 * mS_ + 0.30 * (v.vel - 0.5), 0.0, 1.0);
            const double fNom = fundamental(v.note);
            const double fc = clampT(650.0 + fNom * 1.8 + 8200.0 * std::pow(dyn, 1.7), 300.0, 0.45 * sr_);
            const double lpA = 1.0 - std::exp(-2.0 * kPi * fc / sr_);
            const double gvDyn = dbToLinear(-12.0 * (1.0 - dyn));
            const double gv1 = gE * gvDyn * v.gAmp * polyG_;
            // --- osciladores por atril: tono (vibrato, jitter, bend, glide) y ganancia ---
            double envMean = 0.0;
            const double vibDepthCents = vib * 28.0;
            const double vibOn = smooth01((t1 - v.vibDelay) / 0.7);
            const double tremDep = trem * 0.8 * smooth01((v.vel - 0.8) / 0.2);
            double gTarget[kMaxPlayers];
            for (int i = 0; i < v.nPl; ++i) {
                Player& p = v.pl[i];
                p.vibPh += p.vibRate * dtc;
                if (p.vibPh > 1.0) p.vibPh -= 1.0;
                p.jit += (v.rng.bip() * 1.6 - p.jit) * 0.10;
                p.shim += (v.rng.bip() * 0.10 - p.shim) * 0.10;
                const double cents = p.detCents + p.jit + vibDepthCents * vibOn * p.vibScale * std::sin(2.0 * kPi * p.vibPh) + bendS_ + v.glideCents;
                p.inc = std::min(0.45, s_.a4 * std::exp2(((v.note - 69) * 100.0 + cents) / 1200.0) / sr_);
                // ganancia: ataque / liberación escalonados por atril + irregularidad + tremolo
                const double xa = (t1 - p.dOn) / v.atkSec;
                double gg = smooth01(xa);
                if (v.released) gg *= std::exp(-8.5 * std::max(0.0, tr1 - p.dOff) / v.relSec);
                p.tremPh += p.tremRate * dtc;
                if (p.tremPh > 1.0) p.tremPh -= 1.0;
                if (tremDep > 0.0) gg *= 1.0 - tremDep * 0.5 * (1.0 - std::cos(2.0 * kPi * p.tremPh));
                gg *= 1.0 + p.shim;
                gTarget[i] = gg;
                envMean += gg;
            }
            envMean /= std::max(1, v.nPl);
            const double hiss = 0.012 * (0.6 + 0.8 * (1.0 - dyn)) * envMean;
            // --- muestras ---
            const double pw0 = std::sqrt(0.5 * (1.0 - v.pan0 * width)), pw1 = std::sqrt(0.5 * (1.0 + v.pan0 * width));
            const double gvStep = (gv1 - v.gvPrev) / n;
            double gv = v.gvPrev;
            const double kgStep = (kg1 - kg0) / n;
            double kg = kg0;
            double gStep[kMaxPlayers], gCur[kMaxPlayers];
            for (int i = 0; i < v.nPl; ++i) { gCur[i] = v.pl[i].g; gStep[i] = (gTarget[i] - v.pl[i].g) / n; }
            // Estado caliente en locales (sin alias con cl/cr): el compilador lo mantiene en registros
            const int np = v.nPl;
            double ph[kMaxPlayers], inc[kMaxPlayers], pan[kMaxPlayers];
            for (int i = 0; i < np; ++i) { ph[i] = v.pl[i].ph; inc[i] = v.pl[i].inc; pan[i] = v.pl[i].pan; }
            double bc[15], zm[6], zs[6], cc[5], cz[2];
            for (int k = 0; k < 3; ++k) {
                bc[k * 5] = v.body[k].b0; bc[k * 5 + 1] = v.body[k].b1; bc[k * 5 + 2] = v.body[k].b2; bc[k * 5 + 3] = v.body[k].a1; bc[k * 5 + 4] = v.body[k].a2;
                zm[k * 2] = v.bm[k].z1; zm[k * 2 + 1] = v.bm[k].z2; zs[k * 2] = v.bs[k].z1; zs[k * 2 + 1] = v.bs[k].z2;
            }
            cc[0] = v.chiff.b0; cc[1] = v.chiff.b1; cc[2] = v.chiff.b2; cc[3] = v.chiff.a1; cc[4] = v.chiff.a2;
            cz[0] = v.chiffSt.z1; cz[1] = v.chiffSt.z2;
            double chAmp = v.chiffAmp, l1 = v.lpM1, l2 = v.lpM2, l3 = v.lpS1, l4 = v.lpS2;
            uint32_t nzi = v.nzIdx;
            const double chDec = v.chiffDec;
            double* const __restrict oL = cl;
            double* const __restrict oR = cr;
            for (int s = 0; s < n; ++s) {
                double mAcc = 0.0, sAcc = 0.0;
                for (int i = 0; i < np; ++i) {
                    double q = ph[i] + inc[i];
                    if (q >= 1.0) q -= 1.0;
                    ph[i] = q;
                    const double dt = inc[i];
                    double saw = 2.0 * q - 1.0;
                    if (q < dt) { const double x = q / dt; saw -= x + x - x * x - 1.0; }
                    else if (q > 1.0 - dt) { const double x = (q - 1.0) / dt; saw -= x * x + x + x + 1.0; }
                    gCur[i] += gStep[i];
                    const double y = saw * gCur[i];
                    mAcc += y;
                    sAcc += y * pan[i];
                }
                const double w = noiseW_[nzi];                       // tablas de ruido (xorshift) con inicio propio por voz
                const double nz = noiseH_[nzi];                      // ruido de arco (paso alto)
                nzi = (nzi + 1) & (kNoiseLen - 1);
                double m = mAcc + nz * hiss;
                if (chAmp > 1.0e-7) {                                // «chiff» de ataque (se apaga solo)
                    const double yc = cc[0] * w + cz[0];
                    cz[0] = cc[1] * w - cc[3] * yc + cz[1];
                    cz[1] = cc[2] * w - cc[4] * yc;
                    m += yc * chAmp;
                    chAmp *= chDec;
                }
                double d = sAcc;
                for (int k = 0; k < 3; ++k) {
                    const double* c = bc + k * 5;
                    const double ym = c[0] * m + zm[k * 2];
                    zm[k * 2] = c[1] * m - c[3] * ym + zm[k * 2 + 1];
                    zm[k * 2 + 1] = c[2] * m - c[4] * ym;
                    m = ym;
                    const double yd = c[0] * d + zs[k * 2];
                    zs[k * 2] = c[1] * d - c[3] * yd + zs[k * 2 + 1];
                    zs[k * 2 + 1] = c[2] * d - c[4] * yd;
                    d = yd;
                }
                l1 += lpA * (m - l1); l2 += lpA * (l1 - l2);
                l3 += lpA * (d - l3); l4 += lpA * (l3 - l4);
                gv += gvStep;
                kg += kgStep;
                const double gk = gv * kg;
                const double mm = l2 * gk, dd = l4 * gk * width;
                oL[s] += (mm + dd) * pw0;
                oR[s] += (mm - dd) * pw1;
            }
            for (int i = 0; i < np; ++i) { v.pl[i].ph = ph[i]; }
            for (int k = 0; k < 3; ++k) { v.bm[k].z1 = zm[k * 2]; v.bm[k].z2 = zm[k * 2 + 1]; v.bs[k].z1 = zs[k * 2]; v.bs[k].z2 = zs[k * 2 + 1]; }
            v.chiffSt.z1 = cz[0]; v.chiffSt.z2 = cz[1];
            v.chiffAmp = chAmp; v.lpM1 = l1; v.lpM2 = l2; v.lpS1 = l3; v.lpS2 = l4; v.nzIdx = nzi;
            for (int i = 0; i < v.nPl; ++i) v.pl[i].g = gTarget[i];
            v.gvPrev = gv1;
            v.killG = kg1;
            v.t = t1;
            v.tr = tr1;
            // fin de la voz
            if (v.killing && kg1 <= 0.0) v.active = false;
            else if (v.released && tr1 > v.relSec * 1.0 + 0.08) v.active = false;
        }

        // --- muestras reales: nivel (CC11), brillo (CC11/CC1) y compensación de polifonía ---
        const bool sampled = sampler_.ready();
        if (sampled) {
            double sl[kChunk], sr2[kChunk];
            for (int i = 0; i < n; ++i) { sl[i] = 0.0; sr2[i] = 0.0; }
            sampler_.render(sl, sr2, n);
            const double dynS = clampT(0.62 * eS_ + 0.38 * mS_, 0.0, 1.0);
            const double fcS = clampT(1400.0 + 11000.0 * std::pow(dynS, 1.2), 1200.0, 0.45 * sr_);   // pp oscuro y cálido, ff abierto
            const double aS = 1.0 - std::exp(-2.0 * kPi * fcS / sr_);
            const int nv = sampler_.activeVoices();
            polyS_ += (1.0 / std::sqrt(1.0 + 0.06 * (std::max(1, nv) - 1)) - polyS_) * (1.0 - std::exp(-dtc / 0.05));
            const double gS = gE * polyS_;
            for (int i = 0; i < n; ++i) {
                sL1_ += aS * (sl[i] - sL1_); sL2_ += aS * (sL1_ - sL2_);
                sR1_ += aS * (sr2[i] - sR1_); sR2_ += aS * (sR1_ - sR2_);
                const double mid = 0.5 * (sL2_ + sR2_), side = 0.5 * (sL2_ - sR2_) * width;
                cl[i] += (mid + side) * gS;
                cr[i] += (mid - side) * gS;
            }
        }

        // --- mezcla: EQ (paso-altos, aspereza, aire), compresor suave y ensemble ---
        mix_.process(cl, cr, n);

        // --- sala ---
        hall_.update(s_.hall, n);
        hall_.process(cl, cr, wl, wr, n);
        const double hw = hall_.wetGain() * (sampled ? kWetScaleSamples : kWetScale);
        // --- master: volumen + bypass + DC + soft-clip ---
        const double vg0 = vol_.current(), vg1 = vol_.advance(n), w0 = wet_.current(), w1 = wet_.advance(n);
        for (int i = 0; i < n; ++i) {
            const double t = static_cast<double>(i + 1) / n;
            const double g = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t);
            const double l = (cl[i] + wl[i] * hw) * g, r = (cr[i] + wr[i] * hw) * g;
            const double yl = l - dcXL_ + 0.9995 * dcYL_; dcXL_ = l; dcYL_ = yl;
            const double yr = r - dcXR_ + 0.9995 * dcYR_; dcXR_ = r; dcYR_ = yr;
            cl[i] = softClip(yl);
            cr[i] = softClip(yr);
        }
    }

    static constexpr int kNoiseLen = 8192;
    double noiseW_[kNoiseLen], noiseH_[kNoiseLen];
    static constexpr double kVoiceGain = 0.22;
    static constexpr double kWetScale = 0.55;
    static constexpr double kWetScaleSamples = 0.40;   // las muestras ya traen sala
    static constexpr float kSampleLevelDb = -5.0f;      // se ajusta con --samples (igualar el nivel del motor modelado)

    double sr_{48000.0};
    StringsSettings s_;
    Voice voices_[kPool];
    Smoother vol_, wet_;
    HallReverb hall_;
    double eS_{0.75}, mS_{0.0}, bendS_{0.0}, polyG_{1.0};
    double dcXL_{0}, dcXR_{0}, dcYL_{0}, dcYR_{0};
    int killLen_{240};
    bool pedal_{false};
    int64_t clock_{0}, lastOnClock_{-1000000000LL}, order_{0};
    uint32_t seedCtr_{1};
    // muestras
    MixChain mix_;
    JasWaveFx::FxRack fx_;
    JwSampler::Sampler sampler_;
    bool samplerLoadStarted_{false}, samplesOn_{true};
    std::array<bool, 128> sHeld_{};
    int sHeldN_{0};
    int64_t lastOffClock_{-1000000000LL};
    double sL1_{0}, sL2_{0}, sR1_{0}, sR2_{0}, polyS_{1.0};
};

} // namespace JasWaveStrings
