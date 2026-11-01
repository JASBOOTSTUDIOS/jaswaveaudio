// =====================================================================================
//  JasWave Vocal Tune – motor DSP de afinación vocal automática (latencia < 3 ms)
//   - Detección de tono YIN sobre la mezcla mono diezmada (~12 kHz, ventana ~21 ms, 60..1000 Hz)
//     y refinado del periodo a tasa completa con interpolación parabólica (< 1 cent)
//   - Decisión de voz: umbral de la CMNDF (Tracking), puerta de nivel y guarda de sibilancia
//     (energía de la derivada frente a la señal). Lo que no es voz pasa sin corregir.
//   - Corrección: nota más cercana de la escala (histéresis), conserva el vibrato (Vibrato
//     Preserve) y se acerca al objetivo con la constante de Retune Speed (+ Humanize en notas largas)
//   - Desplazamiento de tono TD-PSOLA en flujo: granos síncronos con el periodo, ventanas de coseno
//     alzado que suman 1 (partición de la unidad) y saltos de exactamente un periodo; conserva los
//     formantes. Formant Shift / Throat Length remuestrean cada grano (factor k).
//   - Latencia fija D (Low Latency: 2.5 ms; normal: 10 ms) = la que se informa al host. Sin voz o con
//     ratio 1 la salida es la entrada retrasada exactamente D muestras.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include <array>
#include <atomic>
#include <cmath>
#include <vector>

namespace JasWaveVocalTune {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kBypass = 0, kRetune = 1, kHumanize = 2, kVibrato = 3, kFormant = 4, kThroat = 5, kTracking = 6,
    kScale = 7, kRoot = 8, kMix = 9, kLowLatency = 10,
    kPitchMeter = 40, kCorrMeter = 41
};

constexpr int kNumScales = 10;
inline const char* const* scaleLabels() {
    static const char* const l[] = { "Chromatic", "Major", "Natural Minor", "Harmonic Minor", "Melodic Minor",
                                     "Major Pentatonic", "Minor Pentatonic", "Blues", "Dorian", "Mixolydian" };
    return l;
}
inline const char* const* rootLabels() {
    static const char* const l[] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
    return l;
}
// Grados de cada escala como máscara de 12 bits (bit k = k semitonos sobre la tónica)
inline uint16_t scaleMask(int s) {
    auto m = [](std::initializer_list<int> g) { uint16_t r = 0; for (int k : g) r = static_cast<uint16_t>(r | (1u << k)); return r; };
    switch (s) {
        case 1: return m({ 0, 2, 4, 5, 7, 9, 11 });   // mayor
        case 2: return m({ 0, 2, 3, 5, 7, 8, 10 });   // menor natural
        case 3: return m({ 0, 2, 3, 5, 7, 8, 11 });   // menor armónica
        case 4: return m({ 0, 2, 3, 5, 7, 9, 11 });   // menor melódica
        case 5: return m({ 0, 2, 4, 7, 9 });          // pentatónica mayor
        case 6: return m({ 0, 3, 5, 7, 10 });         // pentatónica menor
        case 7: return m({ 0, 3, 5, 6, 7, 10 });      // blues
        case 8: return m({ 0, 2, 3, 5, 7, 9, 10 });   // dórica
        case 9: return m({ 0, 2, 4, 5, 7, 9, 10 });   // mixolidia
        default: return 0x0FFF;                       // cromática
    }
}

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(asBasico(toggleP(kBypass, "Bypass", 0, true)));
        v.push_back(asBasico(linearP(kRetune, "Retune Speed", "ms", 0.0, 400.0, 40.0, 0)));
        v.push_back(asBasico(linearP(kHumanize, "Humanize", "%", 0.0, 100.0, 20.0, 0)));
        v.push_back(linearP(kVibrato, "Vibrato Preserve", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(linearP(kFormant, "Formant Shift", "st", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kThroat, "Throat Length", "%", 50.0, 200.0, 100.0, 0));
        v.push_back(linearP(kTracking, "Tracking", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(asBasico(stepP(kScale, "Scale", kNumScales - 1, 0, scaleLabels())));
        v.push_back(asBasico(stepP(kRoot, "Root", 11, 0, rootLabels())));
        v.push_back(asBasico(linearP(kMix, "Mix", "%", 0.0, 100.0, 100.0, 0)));
        v.push_back(toggleP(kLowLatency, "Low Latency", 1));
        v.push_back(asReadOnly(linearP(kPitchMeter, "Detected Pitch", "Hz", 0.0, 2000.0, 0.0, 1)));
        v.push_back(asReadOnly(linearP(kCorrMeter, "Correction", "cents", -300.0, 300.0, 0.0, 0, true)));
        return v;
    }();
    return defs;
}

struct VocalTuneSettings {
    double retuneMs{40.0}, humanize{0.2}, vibrato{0.7}, formantSt{0.0}, throatPct{100.0}, tracking{0.5}, mix{1.0};
    int scale{0}, root{0};
    bool lowLatency{true}, bypass{false};
};

// Latencia algorítmica (muestras) que se informa al host
inline int latencyFor(double sr, bool low) { return static_cast<int>(std::lround((low ? 0.0025 : 0.010) * (sr > 0 ? sr : 48000.0))); }

// Curva de tono para el editor: una entrada por salto de análisis (~2.7 ms), notas MIDI en coma flotante
// (< 0 = sin voz). Escritor único (audio), lector el editor; sin bloqueos.
class PitchRing {
public:
    static constexpr size_t N = 2048;
    PitchRing() { for (auto& s : d_) s.store(-1.0f, std::memory_order_relaxed); for (auto& s : c_) s.store(-1.0f, std::memory_order_relaxed); }
    void push(float detectada, float corregida) {
        const uint64_t p = w_.load(std::memory_order_relaxed);
        d_[p & (N - 1)].store(detectada, std::memory_order_relaxed);
        c_[p & (N - 1)].store(corregida, std::memory_order_relaxed);
        w_.store(p + 1, std::memory_order_release);
    }
    // Copia las últimas `n` entradas (las más antiguas primero); devuelve cuántas hay
    int snapshot(float* det, float* cor, int n) const {
        const uint64_t total = w_.load(std::memory_order_acquire);
        const int k = static_cast<int>(std::min<uint64_t>(static_cast<uint64_t>(n), std::min<uint64_t>(total, N)));
        for (int i = 0; i < k; ++i) {
            const uint64_t idx = total - static_cast<uint64_t>(k) + static_cast<uint64_t>(i);
            det[i] = d_[idx & (N - 1)].load(std::memory_order_relaxed);
            cor[i] = c_[idx & (N - 1)].load(std::memory_order_relaxed);
        }
        return k;
    }
private:
    std::array<std::atomic<float>, N> d_, c_;
    std::atomic<uint64_t> w_{0};
};

struct VocalTuneBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    std::atomic<float> detectadoHz{0.0f}, corregidoHz{0.0f}, correccionCents{0.0f}, claridad{0.0f};
    std::atomic<int> notaObjetivo{-1};
    std::atomic<bool> voz{false};
    std::atomic<int> latencia{0};
    PitchRing curva;
};

class VocalTuneEngine {
public:
    static constexpr int kRing = 1 << 15;           // por canal (≥ 340 ms a 96 kHz)
    static constexpr int kDecRing = 1 << 11;
    static constexpr int kDMin = 3;                 // margen de lectura (interpolación cúbica)

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        dec_ = std::max(1, static_cast<int>(std::lround(sr_ / 12000.0)));
        decRate_ = sr_ / dec_;
        tauMin_ = std::max(2, static_cast<int>(std::floor(decRate_ / 1000.0)));
        tauMax_ = static_cast<int>(std::ceil(decRate_ / 60.0));
        winDec_ = static_cast<int>(std::ceil(decRate_ * 0.0213));
        hop_ = std::max(32, static_cast<int>(std::lround(sr_ * 0.00267)));
        hopSec_ = hop_ / sr_;
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
        wet_.prepare(sr_, 15.0); mix_.prepare(sr_, 20.0);
        setSettings(s_);
        wet_.reset(wet_.target()); mix_.reset(mix_.target());
        D_ = latencyFor(sr_, s_.lowLatency);
        dryDelay_ = D_;
        reset();
    }
    void reset() {
        std::fill(L_.begin(), L_.end(), 0.0f); std::fill(R_.begin(), R_.end(), 0.0f); std::fill(M_.begin(), M_.end(), 0.0f);
        std::fill(decBuf_.begin(), decBuf_.end(), 0.0f);
        for (auto& s : lpS_) s.reset();
        n_ = 0; decN_ = 0; decPh_ = 0; hopCnt_ = 0;
        D_ = latencyFor(sr_, s_.lowLatency);
        dryDelay_ = D_;
        sC_ = 0.0; aC_ = -static_cast<double>(D_); kC_ = 1.0;
        sN_ = unvoicedTs_; aN_ = sN_ - D_; kN_ = 1.0; kCur_ = kTarget_;
        voiced_ = false; unvoicedHops_ = 99; period_ = unvoicedTs_; f0_ = 0.0;
        mSlow_ = 0.0; shift_ = 0.0; target_ = -1; held_ = 0.0; clarity_ = 0.0;
    }
    void setSettings(const VocalTuneSettings& s) {
        s_ = s;
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        mix_.setTarget(clampT(s.mix, 0.0, 1.0));
        const double k = std::pow(2.0, clampT(s.formantSt, -12.0, 12.0) / 12.0) * (100.0 / clampT(s.throatPct, 50.0, 200.0));
        kTarget_ = clampT(k, 0.5, 2.0);
        if (std::fabs(kTarget_ - 1.0) < 1e-6) kTarget_ = 1.0;
        mask_ = scaleMask(s.scale);
        root_ = ((s.root % 12) + 12) % 12;
        D_ = latencyFor(sr_, s.lowLatency);
    }
    int latency() const { return D_; }
    double detectedHz() const { return voiced_ ? f0_ : 0.0; }
    double correctionCents() const { return voiced_ ? shift_ * 100.0 : 0.0; }
    bool voiced() const { return voiced_; }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, VocalTuneBus* bus) {
        if (bus) { bus->entrada(inL, inR, n); bus->latencia.store(D_, std::memory_order_relaxed); }
        float pin[2] = { 0, 0 }, pout[2] = { 0, 0 };
        constexpr int kMask = kRing - 1;
        for (int i = 0; i < n; ++i) {
            const float xl = static_cast<float>(inL[i]), xr = static_cast<float>(inR[i]);
            const int w = static_cast<int>(n_ & kMask);
            L_[static_cast<size_t>(w)] = xl; R_[static_cast<size_t>(w)] = xr;
            const float mono = 0.5f * (xl + xr);
            M_[static_cast<size_t>(w)] = mono;
            // diezmado para la detección
            const double lpOut = biquadProcess(lp_[1], lpS_[1], biquadProcess(lp_[0], lpS_[0], mono));
            if (++decPh_ >= dec_) { decPh_ = 0; decBuf_[static_cast<size_t>(decN_ & (kDecRing - 1))] = static_cast<float>(lpOut); ++decN_; }
            const double o = static_cast<double>(n_);
            ++n_;
            if (++hopCnt_ >= hop_) { hopCnt_ = 0; analyze(bus); }

            // granos PSOLA
            while (o >= sN_) nextGrain();
            const double span = sN_ - sC_;
            const double phi = span > 0.0 ? clampT((o - sC_) / span, 0.0, 1.0) : 1.0;
            const double wN = 0.5 - 0.5 * std::cos(3.14159265358979323846 * phi);
            const double lim = o - kDMin;
            const double p1 = std::min(aC_ + kC_ * (o - sC_), lim);
            const double p2 = std::min(aN_ + kN_ * (o - sN_), lim);
            float wl, wr;
            if (p1 == p2) { wl = readC(L_, p1); wr = readC(R_, p1); }
            else {
                wl = static_cast<float>((1.0 - wN) * readC(L_, p1) + wN * readC(L_, p2));
                wr = static_cast<float>((1.0 - wN) * readC(R_, p1) + wN * readC(R_, p2));
            }
            // camino seco con la misma latencia
            if (dryDelay_ != D_) dryDelay_ += clampT(static_cast<double>(D_) - dryDelay_, -0.25, 0.25);
            const double pd = o - dryDelay_;
            const float dl = readC(L_, pd), dr = readC(R_, pd);
            const double wt = wet_.advance(1), mx = mix_.advance(1) * wt;
            const double yl = dl + (wl - dl) * mx, yr = dr + (wr - dr) * mx;
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
        }
    }

private:
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

    // Avanza a la siguiente marca de síntesis: elige su marca de análisis (saltos de un periodo)
    void nextGrain() {
        sC_ = sN_; aC_ = aN_; kC_ = kN_;
        kCur_ += (kTarget_ - kCur_) * 0.35;
        if (std::fabs(kCur_ - kTarget_) < 1e-4) kCur_ = kTarget_;
        const double k = kCur_;
        const double r = voiced_ ? std::pow(2.0, shift_ / 12.0) : 1.0;
        const double T = voiced_ ? period_ : unvoicedTs_;
        const double Ts = clampT(T / r, 16.0, 0.05 * sr_);
        sN_ = sC_ + Ts;
        kN_ = k;
        const double D = static_cast<double>(D_);
        // margen que pide el remuestreo del grano (formantes) a lo largo de su vida [sC, sN + Ts]
        const double req = kDMin + std::max((k - 1.0) * Ts * 1.5, (1.0 - k) * Ts) + 1.0;
        if (!voiced_) {
            aN_ = sN_ - std::max(D, req);
            return;
        }
        double m = std::round((sN_ - D - aC_) / T);
        double a = aC_ + m * T;
        while (sN_ - a < req) a -= T;                                 // repetir un periodo: nunca leer el futuro
        while (sN_ - a > D + 1.5 * T + req && sN_ - (a + T) >= req) a += T;
        if (sN_ - a > kRing - 64) a = sN_ - D;                         // salvaguarda (no debería ocurrir)
        aN_ = a;
    }

    // Análisis cada salto (~2.7 ms): YIN diezmado + refinado a tasa completa + corrección
    void analyze(VocalTuneBus* bus) {
        constexpr int kMask = kRing - 1;
        // nivel y relación de agudos sobre los últimos ~10.7 ms (tasa completa)
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
        const double gateDb = -50.0 - 15.0 * s_.tracking;
        const double thr = 0.06 + 0.24 * s_.tracking;

        bool voz = false;
        double periodo = 0.0, clar = 0.0;
        const int need = winDec_ + tauMax_;
        if (rmsDb > gateDb && hf < 0.6 && decN_ >= static_cast<uint64_t>(need)) {
            double tauC = 0.0, cm = 1.0;
            if (yin(thr, tauC, cm)) {
                clar = 1.0 - cm;
                periodo = refine(tauC * dec_);
                const double f = periodo > 0.0 ? sr_ / periodo : 0.0;
                voz = cm < thr && f >= 55.0 && f <= 1100.0;
            }
        }
        clarity_ = clar;
        if (voz) unvoicedHops_ = 0; else ++unvoicedHops_;
        const bool estaba = voiced_;
        if (voz) {
            period_ = periodo;
            f0_ = sr_ / periodo;
            voiced_ = true;
        } else if (unvoicedHops_ > 2) {
            voiced_ = false;
        }
        if (!voiced_) {
            target_ = -1; held_ = 0.0;
            shift_ = 0.0;
            publish(bus, -1.0f, -1.0f);
            return;
        }
        const double m = 69.0 + 12.0 * std::log2(f0_ / 440.0);
        if (!estaba) { mSlow_ = m; shift_ = 0.0; target_ = -1; held_ = 0.0; }
        mSlow_ += (1.0 - std::exp(-hopSec_ / 0.12)) * (m - mSlow_);
        // nota objetivo con histéresis
        const int prevTarget = target_;
        if (target_ < 0 || !permitida(target_) || std::fabs(mSlow_ - target_) > 0.62) target_ = notaCercana(mSlow_);
        held_ = target_ == prevTarget ? held_ + hopSec_ : 0.0;
        const double corregida = target_ + clampT(s_.vibrato, 0.0, 1.0) * (m - mSlow_);
        const double sStar = clampT(corregida - m, -12.0, 12.0);
        // Humanize: en notas sostenidas la corrección se hace más lenta (deja pasar la expresión)
        const double tauMs = s_.retuneMs + clampT(s_.humanize, 0.0, 1.0) * 300.0 * clampT(held_ / 0.3, 0.0, 1.0);
        if (tauMs < 0.5) shift_ = sStar;
        else shift_ += (1.0 - std::exp(-hopSec_ * 1000.0 / tauMs)) * (sStar - shift_);
        publish(bus, static_cast<float>(m), static_cast<float>(m + shift_));
    }

    void publish(VocalTuneBus* bus, float det, float cor) {
        if (!bus) return;
        bus->curva.push(det, cor);
        bus->voz.store(det >= 0.0f, std::memory_order_relaxed);
        bus->detectadoHz.store(det >= 0.0f ? static_cast<float>(f0_) : 0.0f, std::memory_order_relaxed);
        bus->corregidoHz.store(det >= 0.0f ? static_cast<float>(440.0 * std::pow(2.0, (cor - 69.0) / 12.0)) : 0.0f, std::memory_order_relaxed);
        bus->correccionCents.store(det >= 0.0f ? static_cast<float>(shift_ * 100.0) : 0.0f, std::memory_order_relaxed);
        bus->notaObjetivo.store(det >= 0.0f ? target_ : -1, std::memory_order_relaxed);
        bus->claridad.store(static_cast<float>(clarity_), std::memory_order_relaxed);
    }

    bool permitida(int nota) const { return ((mask_ >> (((nota - root_) % 12 + 12) % 12)) & 1u) != 0; }
    int notaCercana(double m) const {
        const int base = static_cast<int>(std::lround(m));
        int mejor = base;
        double dMejor = 1e9;
        for (int d = -7; d <= 7; ++d) {
            const int c = base + d;
            if (!permitida(c)) continue;
            const double dist = std::fabs(m - c);
            if (dist < dMejor) { dMejor = dist; mejor = c; }
        }
        return mejor;
    }

    // YIN sobre la señal diezmada. Devuelve el retardo (en muestras diezmadas) y el valor de la CMNDF.
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

    // Refinado del periodo a tasa completa alrededor de la estimación diezmada
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

    double sr_{48000.0}, decRate_{12000.0}, hopSec_{0.00267}, unvoicedTs_{240.0};
    int dec_{4}, tauMin_{12}, tauMax_{200}, winDec_{256}, hop_{128};
    VocalTuneSettings s_;
    Smoother wet_, mix_;
    BiquadCoefs lp_[2];
    BiquadState lpS_[2];
    std::vector<float> L_, R_, M_, decBuf_, work_, diff_, cmnd_, workFull_;
    uint64_t n_{0}, decN_{0};
    int decPh_{0}, hopCnt_{0}, D_{120};
    double dryDelay_{120.0};
    // granos: marca actual (C) y siguiente (N): instante de síntesis s, de análisis a, factor de formantes k
    double sC_{0}, aC_{0}, kC_{1}, sN_{0}, aN_{0}, kN_{1}, kCur_{1}, kTarget_{1};
    // seguimiento
    bool voiced_{false};
    int unvoicedHops_{99};
    double period_{240.0}, f0_{0.0}, mSlow_{0.0}, shift_{0.0}, held_{0.0}, clarity_{0.0};
    int target_{-1};
    uint16_t mask_{0x0FFF};
    int root_{0};
};

} // namespace JasWaveVocalTune
