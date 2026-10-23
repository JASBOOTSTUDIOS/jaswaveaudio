// =====================================================================================
//  JasWave shared DSP core (header-only, sin dependencias de SDK ni de UI)
//  - Biquad RBJ con respuesta en frecuencia analítica
//  - Suavizado de parámetros, anti-denormales
//  - FFT radix-2 + analizador de espectro (lado UI)
//  - Detector true-peak 4x (polifásico, Kaiser)
//  - Medidor de sonoridad ITU-R BS.1770-4 / EBU R128 (M, S, I con gating)
//  - Buses lock-free audio-thread -> UI-thread (tap de audio, picos, scope)
// =====================================================================================
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <map>
#include <vector>

#if defined(_MSC_VER) && (defined(_M_X64) || defined(_M_IX86))
#include <xmmintrin.h>
#define JW_HAS_SSE_CSR 1
#elif defined(__SSE__)
#include <xmmintrin.h>
#define JW_HAS_SSE_CSR 1
#endif

namespace JasWaveDsp {

constexpr double kPi = 3.14159265358979323846;

inline double dbToLinear(double db) { return std::pow(10.0, db * 0.05); }
inline double linearToDb(double lin) { return lin <= 1.0e-9 ? -180.0 : 20.0 * std::log10(lin); }
template <class T>
inline T clampT(T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Activa FTZ/DAZ en el hilo de audio durante el bloque (evita picos de CPU por denormales)
struct ScopedNoDenormals {
#ifdef JW_HAS_SSE_CSR
    unsigned int prev;
    ScopedNoDenormals() : prev(_mm_getcsr()) { _mm_setcsr(prev | 0x8040u); }
    ~ScopedNoDenormals() { _mm_setcsr(prev); }
#else
    ScopedNoDenormals() {}
#endif
};

// -------------------------------------------------------------------------------------
//  Biquad (RBJ cookbook) – coeficientes normalizados a0 = 1, forma transpuesta directa II
// -------------------------------------------------------------------------------------
enum class FilterType { HighPass, LowPass, LowShelf, HighShelf, Bell, Notch };

struct BiquadCoefs {
    double b0{1.0}, b1{0.0}, b2{0.0}, a1{0.0}, a2{0.0};

    static BiquadCoefs design(FilterType type, double sr, double freq, double gainDb, double q) {
        BiquadCoefs c;
        if (sr <= 0.0) return c;
        freq = clampT(freq, 10.0, sr * 0.499);
        q = clampT(q, 0.05, 40.0);
        const double w0 = 2.0 * kPi * freq / sr;
        const double cw = std::cos(w0), sw = std::sin(w0);
        const double alpha = sw / (2.0 * q);
        const double A = std::pow(10.0, gainDb / 40.0);
        double b0, b1, b2, a0, a1, a2;
        switch (type) {
            case FilterType::Bell:
                b0 = 1.0 + alpha * A; b1 = -2.0 * cw; b2 = 1.0 - alpha * A;
                a0 = 1.0 + alpha / A; a1 = -2.0 * cw; a2 = 1.0 - alpha / A;
                break;
            case FilterType::HighPass:
                b0 = (1.0 + cw) * 0.5; b1 = -(1.0 + cw); b2 = (1.0 + cw) * 0.5;
                a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
                break;
            case FilterType::LowPass:
                b0 = (1.0 - cw) * 0.5; b1 = 1.0 - cw; b2 = (1.0 - cw) * 0.5;
                a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
                break;
            case FilterType::LowShelf: {
                const double s2 = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1.0) - (A - 1.0) * cw + s2);
                b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cw);
                b2 = A * ((A + 1.0) - (A - 1.0) * cw - s2);
                a0 = (A + 1.0) + (A - 1.0) * cw + s2;
                a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cw);
                a2 = (A + 1.0) + (A - 1.0) * cw - s2;
                break;
            }
            case FilterType::HighShelf: {
                const double s2 = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1.0) + (A - 1.0) * cw + s2);
                b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cw);
                b2 = A * ((A + 1.0) + (A - 1.0) * cw - s2);
                a0 = (A + 1.0) - (A - 1.0) * cw + s2;
                a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cw);
                a2 = (A + 1.0) - (A - 1.0) * cw - s2;
                break;
            }
            case FilterType::Notch:
            default:
                b0 = 1.0; b1 = -2.0 * cw; b2 = 1.0;
                a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
                break;
        }
        const double inv = 1.0 / a0;
        c.b0 = b0 * inv; c.b1 = b1 * inv; c.b2 = b2 * inv; c.a1 = a1 * inv; c.a2 = a2 * inv;
        return c;
    }

    // Coeficientes normativos ITU-R BS.1770-4 / EBU R128 para cualquier frecuencia de muestreo
    static BiquadCoefs designBs1770Stage1(double sr) {
        if (std::fabs(sr - 48000.0) < 1.0) {
            BiquadCoefs c;
            c.b0 = 1.53512485958697;
            c.b1 = -2.69169618940638;
            c.b2 = 1.19839281085285;
            c.a1 = -1.69065929318241;
            c.a2 = 0.73248077421585;
            return c;
        }
        const double f0 = 1681.974450955533;
        const double G = 3.999843853973347;
        const double K = std::tan(kPi * f0 / sr);
        const double Vh = std::pow(10.0, G / 20.0);
        const double Vb = std::pow(Vh, 0.4996667741545416);
        const double a0 = 1.0 + 1.414213562373095 * K + K * K;
        BiquadCoefs c;
        c.b0 = (Vh + Vb * 1.414213562373095 * K + K * K) / a0;
        c.b1 = 2.0 * (K * K - Vh) / a0;
        c.b2 = (Vh - Vb * 1.414213562373095 * K + K * K) / a0;
        c.a1 = 2.0 * (K * K - 1.0) / a0;
        c.a2 = (1.0 - 1.414213562373095 * K + K * K) / a0;
        return c;
    }

    static BiquadCoefs designBs1770Stage2(double sr) {
        if (std::fabs(sr - 48000.0) < 1.0) {
            BiquadCoefs c;
            c.b0 = 1.0;
            c.b1 = -2.0;
            c.b2 = 1.0;
            c.a1 = -1.99004745483398;
            c.a2 = 0.99007225035621;
            return c;
        }
        const double f0 = 38.13547087602444;
        const double Q = 0.5003270373238773;
        const double K = std::tan(kPi * f0 / sr);
        const double K2 = K * K;
        const double a0 = 1.0 + K / Q + K2;
        BiquadCoefs c;
        c.b0 = 1.0 / a0;
        c.b1 = -2.0 / a0;
        c.b2 = 1.0 / a0;
        c.a1 = 2.0 * (K2 - 1.0) / a0;
        c.a2 = (1.0 - K / Q + K2) / a0;
        return c;
    }

    // |H(e^jw)| en dB (análisis exacto del filtro real que corre en el hilo de audio)
    double magnitudeDb(double freq, double sr) const {
        const double w = 2.0 * kPi * freq / sr;
        const double cw = std::cos(w), sw = std::sin(w), c2 = std::cos(2.0 * w), s2 = std::sin(2.0 * w);
        const double nr = b0 + b1 * cw + b2 * c2, ni = -(b1 * sw + b2 * s2);
        const double dr = 1.0 + a1 * cw + a2 * c2, di = -(a1 * sw + a2 * s2);
        const double den = dr * dr + di * di;
        if (den <= 1.0e-30) return 0.0;
        const double m = (nr * nr + ni * ni) / den;
        return 10.0 * std::log10(std::max(m, 1.0e-30));
    }
};

struct BiquadState {
    double z1{0.0}, z2{0.0};
    void reset() { z1 = z2 = 0.0; }
};

inline double biquadProcess(const BiquadCoefs& c, BiquadState& s, double x) {
    const double y = c.b0 * x + s.z1;
    s.z1 = c.b1 * x - c.a1 * y + s.z2;
    s.z2 = c.b2 * x - c.a2 * y;
    return y;
}

// Butterworth de orden par: Q de la sección k (0-based)
inline double butterworthQ(int order, int k) {
    return 1.0 / (2.0 * std::cos(kPi * (2.0 * k + 1.0) / (2.0 * order)));
}

// -------------------------------------------------------------------------------------
//  Suavizado exponencial de parámetros (se avanza por sub-bloques)
// -------------------------------------------------------------------------------------
class Smoother {
public:
    void prepare(double sampleRate, double timeMs) { sr_ = sampleRate > 0 ? sampleRate : 48000.0; tau_ = std::max(0.1, timeMs) * 0.001; }
    void reset(double v) { cur_ = tgt_ = v; }
    void setTarget(double v) { tgt_ = v; }
    double target() const { return tgt_; }
    double current() const { return cur_; }
    bool settled() const { return cur_ == tgt_; }
    double advance(int n) {
        if (cur_ == tgt_) return cur_;
        const double a = 1.0 - std::exp(-static_cast<double>(n) / (tau_ * sr_));
        cur_ += (tgt_ - cur_) * a;
        if (std::fabs(tgt_ - cur_) < 1.0e-6 * std::max(1.0, std::fabs(tgt_))) cur_ = tgt_;
        return cur_;
    }
private:
    double sr_{48000.0}, tau_{0.02}, cur_{0.0}, tgt_{0.0};
};

// -------------------------------------------------------------------------------------
//  Telemetría lock-free (audio thread = único escritor, UI thread = lector)
// -------------------------------------------------------------------------------------
struct MeterBusBase {
    virtual ~MeterBusBase() = default;
    std::atomic<double> sampleRate{48000.0};
};

// Pico "desde la última lectura" (lineal)
struct PeakMeter {
    std::atomic<float> v{0.0f};
    void update(float p) { if (p > v.load(std::memory_order_relaxed)) v.store(p, std::memory_order_relaxed); }
    float take() { return v.exchange(0.0f, std::memory_order_relaxed); }
};

// Tap mono de audio para el analizador (anillo de potencia de 2)
template <size_t N>
class AudioTap {
    static_assert((N & (N - 1)) == 0, "N debe ser potencia de 2");
public:
    AudioTap() { for (auto& b : buf_) b.store(0.0f, std::memory_order_relaxed); }
    void push(const float* l, const float* r, int n) {
        uint64_t p = w_.load(std::memory_order_relaxed);
        for (int i = 0; i < n; ++i) {
            const float v = r ? 0.5f * (l[i] + r[i]) : l[i];
            buf_[(p + static_cast<uint64_t>(i)) & (N - 1)].store(v, std::memory_order_relaxed);
        }
        w_.store(p + static_cast<uint64_t>(n), std::memory_order_release);
    }
    template <class T>
    void pushT(const T* l, const T* r, int n) {
        uint64_t p = w_.load(std::memory_order_relaxed);
        for (int i = 0; i < n; ++i) {
            const float v = r ? static_cast<float>(0.5 * (static_cast<double>(l[i]) + static_cast<double>(r[i]))) : static_cast<float>(l[i]);
            buf_[(p + static_cast<uint64_t>(i)) & (N - 1)].store(v, std::memory_order_relaxed);
        }
        w_.store(p + static_cast<uint64_t>(n), std::memory_order_release);
    }
    bool snapshot(float* dst, size_t count) const {
        const uint64_t end = w_.load(std::memory_order_acquire);
        if (end < count || count > N) { std::fill(dst, dst + count, 0.0f); return false; }
        const uint64_t start = end - count;
        for (size_t i = 0; i < count; ++i) dst[i] = buf_[(start + i) & (N - 1)].load(std::memory_order_relaxed);
        return true;
    }
private:
    std::array<std::atomic<float>, N> buf_;
    std::atomic<uint64_t> w_{0};
};
using SpectrumTap = AudioTap<32768>;

// Anillo de scope: 1 entrada por ~1 ms con min/max de dos señales (a = entrada, b = salida) y GR
struct ScopeEntry { float aMin, aMax, bMin, bMax, gr; };

struct ScopeSnapshot {
    int count{0};
    std::array<float, 1024> inAbs{};
    std::array<float, 1024> outAbs{};
    std::array<float, 1024> grDb{};
};

class ScopeRing {
public:
    static constexpr size_t N = 8192;
    ScopeRing() {
        for (auto& s : slots_) for (auto& v : s.v) v.store(0.0f, std::memory_order_relaxed);
    }
    void push(const ScopeEntry& e) {
        const uint64_t p = w_.load(std::memory_order_relaxed);
        Slot& s = slots_[p & (N - 1)];
        s.v[0].store(e.aMin, std::memory_order_relaxed); s.v[1].store(e.aMax, std::memory_order_relaxed);
        s.v[2].store(e.bMin, std::memory_order_relaxed); s.v[3].store(e.bMax, std::memory_order_relaxed);
        s.v[4].store(e.gr, std::memory_order_relaxed);
        w_.store(p + 1, std::memory_order_release);
    }
    uint64_t count() const { return w_.load(std::memory_order_acquire); }
    ScopeEntry read(uint64_t idx) const {
        const Slot& s = slots_[idx & (N - 1)];
        return { s.v[0].load(std::memory_order_relaxed), s.v[1].load(std::memory_order_relaxed),
                 s.v[2].load(std::memory_order_relaxed), s.v[3].load(std::memory_order_relaxed),
                 s.v[4].load(std::memory_order_relaxed) };
    }
    void snapshot(ScopeSnapshot& snap, int maxPoints = 512) const {
        const uint64_t total = w_.load(std::memory_order_acquire);
        const int n = std::min(maxPoints, static_cast<int>(std::min(total, static_cast<uint64_t>(N))));
        snap.count = n;
        for (int i = 0; i < n; ++i) {
            const uint64_t idx = total - static_cast<uint64_t>(n) + static_cast<uint64_t>(i);
            const ScopeEntry e = read(idx);
            snap.inAbs[static_cast<size_t>(i)] = std::max(std::fabs(e.aMin), std::fabs(e.aMax));
            snap.outAbs[static_cast<size_t>(i)] = std::max(std::fabs(e.bMin), std::fabs(e.bMax));
            snap.grDb[static_cast<size_t>(i)] = e.gr;
        }
    }
private:
    struct Slot { std::atomic<float> v[5]; };
    std::array<Slot, N> slots_;
    std::atomic<uint64_t> w_{0};
};

struct ScopeAccum {
    int chunk{48}, cnt{0};
    float aMin{0}, aMax{0}, bMin{0}, bMax{0}, gr{0};
    void configure(double sr) { chunk = std::max(1, static_cast<int>(sr / 1000.0)); cnt = 0; }
    inline void push(ScopeRing& ring, float a, float b, float grDb) {
        if (cnt == 0) { aMin = aMax = a; bMin = bMax = b; gr = grDb; }
        else {
            aMin = std::min(aMin, a); aMax = std::max(aMax, a);
            bMin = std::min(bMin, b); bMax = std::max(bMax, b);
            gr = std::max(gr, grDb);
        }
        if (++cnt >= chunk) { ring.push({ aMin, aMax, bMin, bMax, gr }); cnt = 0; }
    }
};

// -------------------------------------------------------------------------------------
//  FFT radix-2 (float) + analizador de espectro (hilo UI)
// -------------------------------------------------------------------------------------
class FFT {
public:
    explicit FFT(int log2n) : n_(1 << log2n), cos_(n_ / 2), sin_(n_ / 2), rev_(n_) {
        for (int i = 0; i < n_ / 2; ++i) {
            cos_[i] = static_cast<float>(std::cos(2.0 * kPi * i / n_));
            sin_[i] = static_cast<float>(-std::sin(2.0 * kPi * i / n_));
        }
        for (int i = 0; i < n_; ++i) {
            int r = 0;
            for (int b = 0; b < log2n; ++b) if (i & (1 << b)) r |= 1 << (log2n - 1 - b);
            rev_[i] = r;
        }
    }
    int size() const { return n_; }
    void forward(float* re, float* im) const {
        for (int i = 0; i < n_; ++i) {
            const int j = rev_[i];
            if (j > i) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
        }
        for (int len = 2; len <= n_; len <<= 1) {
            const int half = len >> 1, step = n_ / len;
            for (int i = 0; i < n_; i += len) {
                for (int j = 0; j < half; ++j) {
                    const float wr = cos_[j * step], wi = sin_[j * step];
                    const int a = i + j, b = a + half;
                    const float xr = re[b] * wr - im[b] * wi;
                    const float xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                }
            }
        }
    }
private:
    int n_;
    std::vector<float> cos_, sin_;
    std::vector<int> rev_;
};

class SpectrumAnalyzer {
public:
    static constexpr int kLog2 = 13;
    static constexpr int kN = 1 << kLog2;
    static constexpr int kBins = kN / 2 + 1;

    SpectrumAnalyzer() : fft_(kLog2), win_(kN), buf_(kN), re_(kN), im_(kN), db_(kBins, -140.0f) {
        double sum = 0.0;
        for (int i = 0; i < kN; ++i) {
            win_[i] = static_cast<float>(0.5 - 0.5 * std::cos(2.0 * kPi * i / kN));
            sum += win_[i];
        }
        norm_ = static_cast<float>(2.0 / sum);
    }
    void reset() { std::fill(db_.begin(), db_.end(), -140.0f); }

    // attack/release por llamada (UI ~30 fps)
    template <class Tap>
    void update(const Tap& tap, double sampleRate, float attack = 0.65f, float release = 0.14f) {
        sr_ = sampleRate > 0 ? sampleRate : 48000.0;
        if (!tap.snapshot(buf_.data(), kN)) return;
        for (int i = 0; i < kN; ++i) { re_[i] = buf_[i] * win_[i]; im_[i] = 0.0f; }
        fft_.forward(re_.data(), im_.data());
        for (int k = 0; k < kBins; ++k) {
            const float m = std::sqrt(re_[k] * re_[k] + im_[k] * im_[k]) * norm_;
            const float d = m <= 1.0e-7f ? -140.0f : 20.0f * std::log10(m);
            const float a = d > db_[k] ? attack : release;
            db_[k] += (d - db_[k]) * a;
        }
    }

    // Columnas log-frecuencia en dBFS (con inclinación opcional dB/oct respecto a 1 kHz)
    void columns(std::vector<float>& out, int count, double fMin, double fMax, double tiltDbPerOct) const {
        out.resize(static_cast<size_t>(std::max(count, 0)));
        if (count <= 0) return;
        const double ratio = fMax / fMin;
        const double binHz = sr_ / kN;
        for (int c = 0; c < count; ++c) {
            const double f0 = fMin * std::pow(ratio, static_cast<double>(c) / count);
            const double f1 = fMin * std::pow(ratio, static_cast<double>(c + 1) / count);
            const double b0 = f0 / binHz, b1 = f1 / binHz;
            float v;
            if (b1 - b0 <= 1.0) {
                const double bc = 0.5 * (b0 + b1);
                int k = clampT(static_cast<int>(bc), 0, kBins - 2);
                const double fr = clampT(bc - k, 0.0, 1.0);
                v = static_cast<float>(db_[k] * (1.0 - fr) + db_[k + 1] * fr);
            } else {
                const int k0 = std::max(0, static_cast<int>(std::ceil(b0)));
                const int k1 = std::min(kBins - 1, static_cast<int>(std::floor(b1)));
                v = -200.0f;
                for (int k = k0; k <= k1; ++k) v = std::max(v, db_[k]);
            }
            v += static_cast<float>(tiltDbPerOct * std::log2(std::sqrt(f0 * f1) / 1000.0));
            out[static_cast<size_t>(c)] = v;
        }
    }
private:
    FFT fft_;
    std::vector<float> win_, buf_, re_, im_, db_;
    float norm_{1.0f};
    double sr_{48000.0};
};

// -------------------------------------------------------------------------------------
//  Detector true-peak 4x (polifásico, 49 taps Kaiser, el tap central cae en la muestra original)
//  process(x) devuelve el pico del intervalo [n-6, n-5) -> retardo kDelay = 6 muestras
// -------------------------------------------------------------------------------------
class TruePeak4x {
public:
    static constexpr int kTaps = 12;
    static constexpr int kDelay = 6;

    TruePeak4x() {
        constexpr int N = 49;
        const double beta = 5.0;
        auto i0 = [](double x) { double s = 1.0, t = 1.0; for (int k = 1; k < 40; ++k) { t *= (x / (2.0 * k)) * (x / (2.0 * k)); s += t; } return s; };
        double h[N];
        for (int n = 0; n < N; ++n) {
            const double t = (n - 24) / 4.0;
            const double s = (t == 0.0) ? 1.0 : std::sin(kPi * t) / (kPi * t);
            const double r = (n - 24) / 24.0;
            h[n] = s * i0(beta * std::sqrt(std::max(0.0, 1.0 - r * r))) / i0(beta);
        }
        for (int p = 1; p <= 3; ++p) {
            double sum = 0.0;
            for (int k = 0; k < kTaps; ++k) sum += h[4 * k + p];
            for (int k = 0; k < kTaps; ++k) c_[p - 1][k] = static_cast<float>(h[4 * k + p] / sum);
        }
        reset();
    }
    void reset() { hist_.fill(0.0f); }
    inline float process(float x) {
        for (int k = kTaps - 1; k > 0; --k) hist_[k] = hist_[k - 1];
        hist_[0] = x;
        float pk = std::fabs(hist_[kDelay]);
        for (int p = 0; p < 3; ++p) {
            float acc = 0.0f;
            for (int k = 0; k < kTaps; ++k) acc += c_[p][k] * hist_[k];
            pk = std::max(pk, std::fabs(acc));
        }
        return pk;
    }
private:
    float c_[3][kTaps];
    std::array<float, kTaps> hist_;
};

// Mínimo deslizante O(1) amortizado (deque monótona sobre anillo preasignado)
class SlidingMin {
public:
    void prepare(int maxWindow) {
        cap_ = maxWindow + 2;
        idx_.assign(static_cast<size_t>(cap_), 0);
        val_.assign(static_cast<size_t>(cap_), 1.0f);
        reset();
    }
    void reset() { head_ = 0; count_ = 0; t_ = 0; }
    float push(float v, int window) {
        while (count_ > 0 && val_[back()] >= v) --count_;
        const int pos = (head_ + count_) % cap_;
        idx_[pos] = t_; val_[pos] = v; ++count_;
        while (idx_[head_] <= t_ - window) { head_ = (head_ + 1) % cap_; --count_; }
        ++t_;
        return val_[head_];
    }
private:
    size_t back() const { return static_cast<size_t>((head_ + count_ - 1) % cap_); }
    std::vector<int64_t> idx_;
    std::vector<float> val_;
    int cap_{4}, head_{0}, count_{0};
    int64_t t_{0};
};

// -------------------------------------------------------------------------------------
//  Sonoridad ITU-R BS.1770-4 / EBU R128 : Momentary (400 ms), Short-term (3 s), Integrated (gating)
// -------------------------------------------------------------------------------------
class LoudnessMeter {
public:
    std::atomic<float> momentary{-120.0f}, shortTerm{-120.0f}, integrated{-120.0f};
    std::atomic<bool> resetRequested{false};

    void prepare(double sr) {
        sr_ = sr > 0 ? sr : 48000.0;
        shelf_ = BiquadCoefs::designBs1770Stage1(sr_);
        hp_ = BiquadCoefs::designBs1770Stage2(sr_);
        blockLen_ = std::max(1, static_cast<int>(std::lround(sr_ * 0.1)));
        reset();
    }
    void reset() {
        for (auto& s : st_) for (auto& b : s) b.reset();
        acc_ = 0.0; cnt_ = 0; ring_.fill(0.0); head_ = 0; blocks_ = 0;
        histCount_.fill(0); histEnergy_.fill(0.0);
        momentary.store(-120.0f, std::memory_order_relaxed);
        shortTerm.store(-120.0f, std::memory_order_relaxed);
        integrated.store(-120.0f, std::memory_order_relaxed);
    }
    void pollReset() { if (resetRequested.exchange(false, std::memory_order_relaxed)) reset(); }
    template <class T>
    inline void processSample(T l, T r) {
        const double xl = biquadProcess(hp_, st_[0][1], biquadProcess(shelf_, st_[0][0], static_cast<double>(l)));
        const double xr = biquadProcess(hp_, st_[1][1], biquadProcess(shelf_, st_[1][0], static_cast<double>(r)));
        acc_ += xl * xl + xr * xr;
        if (++cnt_ >= blockLen_) { finishBlock(acc_ / cnt_); acc_ = 0.0; cnt_ = 0; }
    }
    template <class T>
    void process(const T* l, const T* r, int n) {
        pollReset();
        for (int i = 0; i < n; ++i) processSample(l[i], r[i]);
    }
private:
    static double lufs(double e) { return e <= 1.0e-10 ? -120.0 : -0.691 + 10.0 * std::log10(e); }
    void finishBlock(double e) {
        ring_[static_cast<size_t>(head_)] = e;
        head_ = (head_ + 1) % kRing;
        ++blocks_;
        auto meanLast = [&](int count) {
            const int c = std::min(count, blocks_);
            double s = 0.0;
            for (int i = 1; i <= c; ++i) s += ring_[static_cast<size_t>((head_ - i + kRing * 2) % kRing)];
            return s / std::max(1, c);
        };
        const double mE = meanLast(4);
        momentary.store(static_cast<float>(lufs(mE)), std::memory_order_relaxed);
        shortTerm.store(static_cast<float>(lufs(meanLast(30))), std::memory_order_relaxed);
        if (blocks_ >= 4) {
            const double lm = lufs(mE);
            if (lm >= -70.0) {
                const int bin = clampT(static_cast<int>((lm + 70.0) * 10.0), 0, kBins - 1);
                histCount_[static_cast<size_t>(bin)]++;
                histEnergy_[static_cast<size_t>(bin)] += mE;
            }
            double sumE = 0.0; int64_t sumC = 0;
            for (int b = 0; b < kBins; ++b) { sumE += histEnergy_[static_cast<size_t>(b)]; sumC += histCount_[static_cast<size_t>(b)]; }
            if (sumC > 0) {
                const double rel = lufs(sumE / static_cast<double>(sumC)) - 10.0;
                const int relBin = clampT(static_cast<int>(std::floor((rel + 70.0) * 10.0)), 0, kBins - 1);
                double gE = 0.0; int64_t gC = 0;
                for (int b = relBin; b < kBins; ++b) { gE += histEnergy_[static_cast<size_t>(b)]; gC += histCount_[static_cast<size_t>(b)]; }
                if (gC > 0) integrated.store(static_cast<float>(lufs(gE / static_cast<double>(gC))), std::memory_order_relaxed);
            }
        }
    }
    static constexpr int kRing = 32;
    static constexpr int kBins = 900;
    double sr_{48000.0};
    BiquadCoefs shelf_, hp_;
    std::array<std::array<BiquadState, 2>, 2> st_{};
    int blockLen_{4800}, cnt_{0}, head_{0}, blocks_{0};
    double acc_{0.0};
    std::array<double, kRing> ring_{};
    std::array<int64_t, kBins> histCount_{};
    std::array<double, kBins> histEnergy_{};
};

// -------------------------------------------------------------------------------------
//  Hub de conexión en el mismo proceso (Processor -> View)
// -------------------------------------------------------------------------------------
template <class BusType>
class PluginBusHub {
public:
    static void set(void* token, std::shared_ptr<BusType> bus) {
        std::lock_guard<std::mutex> lock(hubMtx());
        hubMap()[token] = bus;
    }
    static std::shared_ptr<BusType> get(void* token) {
        std::lock_guard<std::mutex> lock(hubMtx());
        auto it = hubMap().find(token);
        return it != hubMap().end() ? it->second : nullptr;
    }
    static void remove(void* token) {
        std::lock_guard<std::mutex> lock(hubMtx());
        hubMap().erase(token);
    }
    static std::shared_ptr<BusType> getLast() {
        std::lock_guard<std::mutex> lock(hubMtx());
        if (hubMap().empty()) return nullptr;
        return hubMap().rbegin()->second;
    }
private:
    static std::mutex& hubMtx() { static std::mutex m; return m; }
    static std::map<void*, std::shared_ptr<BusType>>& hubMap() { static std::map<void*, std::shared_ptr<BusType>> m; return m; }
};

} // namespace JasWaveDsp
