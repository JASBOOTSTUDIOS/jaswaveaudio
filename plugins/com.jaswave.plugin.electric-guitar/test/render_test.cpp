// Prueba de render offline del motor de la guitarra (sin VST3): afinación, sin OOB/NaN a varias tasas,
// CPU, chorus real, delay sincronizado, bend, palm mute, sustain acotado y WAVs musicales.
//   uso: JasWaveElectricGuitar_rendertest <dir_salida> [--samples]
//   --samples: prueba el banco electric-guitar.jws (niveles, dinamica, colas, round-robin, WAV); sin el, la suite modelada.
#define JW_FXRACK_PROBE 1   // sondas por etapa del rack (diagnostico del barrido de estabilidad)
#include "electric_guitar_dsp.h"

#define _CRT_SECURE_NO_WARNINGS
#include <chrono>
#include <complex>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
#include <memory>

using namespace JasWaveElectricGuitar;

static int g_fail = 0;
// Hash FNV-1a de TODOS los renders deterministas de renderSeq (incluida la seccion de tecnicas): sirve para comprobar que
// integrar el FX Rack (apagado) no cambia ni un bit. Las pruebas del rack lo desactivan (g_hashOn = false).
static bool g_hashOn = true;
static uint64_t g_hash = 1469598103934665603ull;
#define CHECK(cond, ...) do { if (!(cond)) { ++g_fail; std::printf("  FALLO: "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

struct Ev { double t; int type; int note; float vel; };   // type 0 on, 1 off, 2 bend, 3 mod, 4 tempo, 5 CC (note = CC, vel = valor 0..127)
static void sortEv(std::vector<Ev>& e) { std::stable_sort(e.begin(), e.end(), [](const Ev& a, const Ev& b) { return a.t < b.t; }); }

static std::vector<float> renderSeq(GuitarEngine& g, double sr, std::vector<Ev> ev, double seconds, int block, std::vector<float>* outR = nullptr) {
    sortEv(ev);
    const size_t total = static_cast<size_t>(seconds * sr);
    std::vector<float> L(total), R(total);
    size_t pos = 0, ei = 0;
    std::vector<float> bl(static_cast<size_t>(block)), br(static_cast<size_t>(block));
    while (pos < total) {
        const size_t n = std::min<size_t>(static_cast<size_t>(block), total - pos);
        size_t done = 0;
        while (done < n) {
            // eventos con precisión de muestra dentro del bloque
            size_t until = n;
            while (ei < ev.size() && static_cast<size_t>(ev[ei].t * sr) <= pos + done) {
                const Ev& e = ev[ei++];
                if (e.type == 0) g.noteOn(e.note, e.vel);
                else if (e.type == 1) g.noteOff(e.note);
                else if (e.type == 2) g.setBend(e.vel);
                else if (e.type == 3) g.setModWheel(e.vel);
                else if (e.type == 4) g.setTempo(e.vel);
                else if (e.type == 5) g.controlChange(e.note, static_cast<int>(e.vel));   // CC genérico (note = nº de CC)
            }
            if (ei < ev.size()) until = std::min<size_t>(until, static_cast<size_t>(ev[ei].t * sr) - pos);
            if (until <= done) until = done + 1 > n ? n : done + 1;
            g.render(bl.data() + done, br.data() + done, static_cast<int>(until - done), nullptr);
            done = until;
        }
        std::copy(bl.begin(), bl.begin() + n, L.begin() + pos);
        std::copy(br.begin(), br.begin() + n, R.begin() + pos);
        pos += n;
    }
    if (g_hashOn) { for (size_t i = 0; i < total; ++i) { uint32_t a, b; std::memcpy(&a, &L[i], 4); std::memcpy(&b, &R[i], 4); g_hash = (g_hash ^ a) * 1099511628211ull; g_hash = (g_hash ^ b) * 1099511628211ull; } }
    if (outR) *outR = R;
    return L;
}

static GuitarSettings dry() {
    GuitarSettings s;
    s.ampGain = 0.30; s.cab = 0.6; s.tone = 0.5; s.delayMix = 0; s.chorusMix = 0; s.reverbMix = 0; s.strum = 0;
    return s;
}

static bool finiteAll(const std::vector<float>& v) { for (float x : v) if (!std::isfinite(x)) return false; return true; }
static double peakOf(const std::vector<float>& v, size_t a = 0, size_t b = 0) { if (!b) b = v.size(); double p = 0; for (size_t i = a; i < b; ++i) p = std::max(p, (double)std::fabs(v[i])); return p; }
static double rmsOf(const std::vector<float>& v, size_t a = 0, size_t b = 0) { if (!b) b = v.size(); double s = 0; for (size_t i = a; i < b; ++i) s += (double)v[i] * v[i]; return std::sqrt(s / std::max<size_t>(1, b - a)); }

// f0 por correlación normalizada multiperíodo con interpolación parabólica
static double estimateF0(const std::vector<float>& x, double sr, size_t start, size_t len, double fExp, double mSec = 0.30) {
    const double tau0 = sr / fExp;
    const int M = std::max(1, static_cast<int>(mSec * fExp));
    const size_t Lc = len;
    auto corr = [&](double lag) {
        const int il = static_cast<int>(std::floor(lag));
        const double fr = lag - il;
        double sxy = 0, sxx = 0, syy = 0;
        for (size_t j = 0; j < Lc; ++j) {
            const double a = x[start + j];
            const double b = x[start + j + il] * (1 - fr) + x[start + j + il + 1] * fr;
            sxy += a * b; sxx += a * a; syy += b * b;
        }
        return sxy / std::sqrt(sxx * syy + 1e-30);
    };
    const double centre = M * tau0;
    double best = -2, bl = centre;
    for (double l = centre - 0.7 * tau0; l <= centre + 0.7 * tau0; l += 0.25) { const double c = corr(l); if (c > best) { best = c; bl = l; } }
    const double cm = corr(bl - 0.25), c0 = best, cp = corr(bl + 0.25);
    const double den = cm - 2 * c0 + cp;
    const double off = std::fabs(den) > 1e-12 ? 0.25 * 0.5 * (cm - cp) / den : 0.0;
    return M * sr / (bl + off);
}

// ---- WAV 24 bit estéreo ----
static void writeWav(const std::string& path, const std::vector<float>& L, const std::vector<float>& R, int sr) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) { std::printf("  no se pudo escribir %s\n", path.c_str()); ++g_fail; return; }
    const uint32_t frames = static_cast<uint32_t>(L.size()), dataBytes = frames * 6, rate = static_cast<uint32_t>(sr);
    auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); w32(36 + dataBytes); std::fwrite("WAVEfmt ", 1, 8, f);
    w32(16); w16(1); w16(2); w32(rate); w32(rate * 6); w16(6); w16(24);
    std::fwrite("data", 1, 4, f); w32(dataBytes);
    for (uint32_t i = 0; i < frames; ++i) {
        for (int c = 0; c < 2; ++c) {
            double v = (c ? R[i] : L[i]) * 8388607.0;
            int32_t q = static_cast<int32_t>(std::lround(std::max(-8388607.0, std::min(8388607.0, v))));
            unsigned char b[3] = { (unsigned char)(q & 255), (unsigned char)((q >> 8) & 255), (unsigned char)((q >> 16) & 255) };
            std::fwrite(b, 1, 3, f);
        }
    }
    std::fclose(f);
}

static void chord(std::vector<Ev>& e, double t, double dur, std::initializer_list<int> notes, float vel) {
    int k = 0;
    for (int n : notes) { e.push_back({ t, 0, n, vel * (1.0f - 0.02f * k) }); e.push_back({ t + dur, 1, n, 0 }); ++k; }
}

// ---- camino de muestras reales (necesita electric-guitar.jws en la carpeta de samples): mide, no escucha ----
static double dbfsOf(double x) { return 20.0 * std::log10(std::max(x, 1e-9)); }

// Centroide espectral (Hz) de 8192 muestras desde `start` (ventana Hann)
static double centroidOf(const std::vector<float>& x, size_t start, double sr) {
    constexpr int Lg = 13;
    JasWaveDsp::FFT fft(Lg);
    std::vector<float> re(1 << Lg), im(1 << Lg, 0.0f);
    for (int i = 0; i < (1 << Lg); ++i) {
        const double w = 0.5 - 0.5 * std::cos(2.0 * JasWaveDsp::kPi * i / (1 << Lg));
        re[static_cast<size_t>(i)] = static_cast<float>((start + i < x.size() ? x[start + i] : 0.0f) * w);
    }
    fft.forward(re.data(), im.data());
    double num = 0, den = 0;
    for (int k = 1; k < (1 << (Lg - 1)); ++k) {
        const double m2 = static_cast<double>(re[static_cast<size_t>(k)]) * re[static_cast<size_t>(k)] + static_cast<double>(im[static_cast<size_t>(k)]) * im[static_cast<size_t>(k)];
        num += m2 * (k * sr / (1 << Lg)); den += m2;
    }
    return den > 0 ? num / den : 0.0;
}

static void makeReady(GuitarEngine& g) {
    // el banco se carga en otro hilo: se espera (hasta 20 s) para probar el camino real
    for (int i = 0; i < 2000 && !g.samplerReady() && g.samplerLoading(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
}

// ===================================================================================================
//  TECNICAS DE GUITARRA (slide, hammer-on/pull-off, strum, palm mute, muertas, armonicos, bends, vibrato, swell,
//  tremolo picking, ruidos): se miden con autocorrelacion por ventanas y envolventes, no se escuchan.
//  Se ejecuta con el banco de muestras (--samples) y con el motor modelado de respaldo (sin banco).
// ===================================================================================================
// f0 por autocorrelacion normalizada en una ventana corta (busca solo en [fLo, fHi]); devuelve Hz y la correlacion (0..1)
static double f0Win(const std::vector<float>& x, double sr, double t, double winSec, double fLo, double fHi, double* corrOut = nullptr) {
    const size_t start = static_cast<size_t>(t * sr), N = static_cast<size_t>(winSec * sr);
    const int lagMin = std::max(2, static_cast<int>(sr / fHi)), lagMax = static_cast<int>(sr / fLo) + 1;
    if (start + N + static_cast<size_t>(lagMax) + 2 >= x.size()) return 0.0;
    std::vector<double> c(static_cast<size_t>(lagMax + 2), 0.0);
    double sxx0 = 0;
    for (size_t j = 0; j < N; ++j) sxx0 += static_cast<double>(x[start + j]) * x[start + j];
    for (int lag = lagMin - 1; lag <= lagMax + 1; ++lag) {
        double sxy = 0, syy = 0;
        for (size_t j = 0; j < N; ++j) { const double b = x[start + j + static_cast<size_t>(lag)]; sxy += static_cast<double>(x[start + j]) * b; syy += b * b; }
        c[static_cast<size_t>(lag)] = sxy / std::sqrt(sxx0 * syy + 1e-30);
    }
    int best = lagMin; double bv = -2;
    for (int lag = lagMin; lag <= lagMax; ++lag) if (c[static_cast<size_t>(lag)] > bv) { bv = c[static_cast<size_t>(lag)]; best = lag; }
    // el primer máximo local cercano al máximo global (evita saltar a 2T)
    for (int lag = lagMin + 1; lag < best; ++lag)
        if (c[static_cast<size_t>(lag)] > 0.92 * bv && c[static_cast<size_t>(lag)] >= c[static_cast<size_t>(lag - 1)] && c[static_cast<size_t>(lag)] >= c[static_cast<size_t>(lag + 1)]) { best = lag; bv = c[static_cast<size_t>(lag)]; break; }
    const double cm = c[static_cast<size_t>(best - 1)], c0 = c[static_cast<size_t>(best)], cp = c[static_cast<size_t>(best + 1)];
    const double den = cm - 2 * c0 + cp;
    const double off = std::fabs(den) > 1e-12 ? 0.5 * (cm - cp) / den : 0.0;
    if (corrOut) *corrOut = bv;
    return sr / (best + off);
}
// pico espectral (FFT 8192 con ventana Hann de `winSec` centrada en t, interpolacion parabolica) dentro de [fLo, fHi]: apto para glissandos
static double fftPeakHz(const std::vector<float>& x, double sr, double t, double winSec, double fLo, double fHi) {
    constexpr int Lg = 13;
    JasWaveDsp::FFT fft(Lg);
    std::vector<float> re(1 << Lg, 0.0f), im(1 << Lg, 0.0f);
    const long N = static_cast<long>(winSec * sr), s0 = static_cast<long>(t * sr) - N / 2;
    for (long i = 0; i < N; ++i) {
        const long k = s0 + i;
        if (k < 0 || k >= static_cast<long>(x.size())) continue;
        re[static_cast<size_t>(i)] = static_cast<float>(x[static_cast<size_t>(k)] * (0.5 - 0.5 * std::cos(2.0 * JasWaveDsp::kPi * i / N)));
    }
    fft.forward(re.data(), im.data());
    const double df = sr / (1 << Lg);
    const int kLo = std::max(2, static_cast<int>(fLo / df)), kHi = static_cast<int>(fHi / df);
    std::vector<double> m(static_cast<size_t>(kHi + 2));
    for (int k = 0; k <= kHi + 1; ++k) m[static_cast<size_t>(k)] = std::sqrt(static_cast<double>(re[static_cast<size_t>(k)]) * re[static_cast<size_t>(k)] + static_cast<double>(im[static_cast<size_t>(k)]) * im[static_cast<size_t>(k)]);
    int b = kLo;
    for (int k = kLo; k <= kHi; ++k) if (m[static_cast<size_t>(k)] > m[static_cast<size_t>(b)]) b = k;
    if (m[static_cast<size_t>(b)] <= 0) return 0.0;
    const double a = std::log(m[static_cast<size_t>(b - 1)] + 1e-30), c = std::log(m[static_cast<size_t>(b)] + 1e-30), d = std::log(m[static_cast<size_t>(b + 1)] + 1e-30);
    const double den = a - 2 * c + d;
    return (b + (std::fabs(den) > 1e-12 ? 0.5 * (a - d) / den : 0.0)) * df;
}
static double centsBetween(double f, double ref) { return 1200.0 * std::log2(std::max(f, 1e-9) / ref); }
// envolvente RMS en dB por tramos de `hop` segundos desde t0 hasta t1
static std::vector<double> envDb(const std::vector<float>& x, double sr, double t0, double t1, double hop) {
    std::vector<double> e;
    for (double t = t0; t + hop <= t1; t += hop) e.push_back(dbfsOf(rmsOf(x, static_cast<size_t>(t * sr), static_cast<size_t>((t + hop) * sr))));
    return e;
}
static double maxRiseDb(const std::vector<double>& e) { double m = -1e9; for (size_t i = 1; i < e.size(); ++i) m = std::max(m, e[i] - e[i - 1]); return m; }
static double rmsDbAt(const std::vector<float>& x, double sr, double a, double b) { return dbfsOf(rmsOf(x, static_cast<size_t>(a * sr), static_cast<size_t>(b * sr))); }
static double maxStep(const std::vector<float>& x) { double d = 0; for (size_t i = 1; i < x.size(); ++i) d = std::max(d, (double)std::fabs(x[i] - x[i - 1])); return d; }

static int techniqueSuite(bool sampled, const std::string& out) {
    constexpr double SR = 48000.0;
    const int failAntes = g_fail;
    std::printf("== TECNICAS DE GUITARRA (%s) ==\n", sampled ? "banco de muestras" : "motor modelado");
    GuitarSettings base; base.delayMix = 0; base.chorusMix = 0; base.reverbMix = 0; base.strum = 0; base.comp = 0; base.tape = 0;
    auto mk = [&](const GuitarSettings& st) {
        auto g = std::make_unique<GuitarEngine>(); g->prepare(SR, 512); g->setSettings(st); makeReady(*g);
        CHECK(g->samplerReady() == sampled, "banco de muestras %s", sampled ? "no cargado" : "cargado en la prueba modelada");
        return g;
    };
    static int dumpN = 0;
    auto run = [&](GuitarEngine& g, std::vector<Ev> ev, double secs) {
        auto x = renderSeq(g, SR, std::move(ev), secs, 256);
        CHECK(finiteAll(x), "NaN/inf");
        if (std::getenv("JW_TECH_DUMP")) writeWav(std::string(std::getenv("JW_TECH_DUMP")) + "/t" + std::string(sampled ? "s" : "m") + std::to_string(++dumpN) + ".wav", x, x, 48000);
        return x;
    };
    auto cleanCheck = [&](const std::vector<float>& x, const char* what) {
        CHECK(peakOf(x) < 0.99, "%s: pico >= 0.99", what);
        CHECK(maxStep(x) < 0.5, "%s: discontinuidad/clic %.3f", what, maxStep(x));
    };
    const double f57 = 220.0, f59 = GuitarEngine::midiToHz(59), f64 = GuitarEngine::midiToHz(64), f76 = GuitarEngine::midiToHz(76);

    // ---- 1. SLIDE por solape (modo Slide, 300 ms): la fundamental pasa de f1 a f2 de forma continua ----
    std::printf("-- 1. slide A3 -> E4 por solape (7 st en 300 ms) --\n");
    {
        GuitarSettings s = base; s.legatoSlide = 2; s.slideTimeMs = 300;
        auto g = mk(s);
        auto x = run(*g, { { 0.1, 0, 57, 0.8f }, { 0.9, 0, 64, 0.8f }, { 0.95, 1, 57, 0 }, { 2.5, 1, 64, 0 } }, 3.0);
        std::vector<double> f; std::vector<double> ts;
        for (double t = 0.82; t <= 1.46; t += 0.025) { f.push_back(fftPeakHz(x, SR, t, 0.043, 190, 400)); ts.push_back(t); }
        std::printf("   f0(t): "); for (size_t i = 0; i < f.size(); ++i) std::printf("%.0f ", f[i]); std::printf("Hz\n");
        CHECK(std::fabs(centsBetween(f.front(), f57)) < 40, "slide: inicio %.1f Hz != 220", f.front());
        CHECK(std::fabs(centsBetween(f.back(), f64)) < 30, "slide: final %.1f Hz != 329.6", f.back());
        int inter = 0; double worstBack = 0, worstJump = 0;
        for (size_t i = 0; i < f.size(); ++i) {
            if (centsBetween(f[i], f57) > 100 && centsBetween(f[i], f64) < -100) ++inter;
            if (i) { worstBack = std::min(worstBack, centsBetween(f[i], f[i - 1])); worstJump = std::max(worstJump, centsBetween(f[i], f[i - 1])); }
        }
        std::printf("   ventanas con tono intermedio: %d; retroceso max %.0f cents; salto max %.0f cents\n", inter, worstBack, worstJump);
        CHECK(inter >= 3, "slide: no hay deslizamiento continuo (solo %d ventanas intermedias)", inter);
        CHECK(worstBack > -60, "slide no monotono (%.0f cents)", worstBack);
        CHECK(worstJump < 300, "slide con salto de %.0f cents", worstJump);
        const auto e = envDb(x, SR, 0.85, 1.5, 0.010);
        const double rise = maxRiseDb(e);
        std::printf("   subida maxima de nivel en la transicion (10 ms): %.1f dB (un re-ataque da >10 dB)\n", rise);
        CHECK(rise < 4.5, "slide: re-ataque audible (+%.1f dB)", rise);
        cleanCheck(x, "slide");
    }

    // ---- 2/3. HAMMER-ON y PULL-OFF (modo Legato, intervalo <= 3 st): sin segundo ataque ----
    for (int dirn = 0; dirn < 2; ++dirn) {
        const int a = dirn == 0 ? 57 : 59, b = dirn == 0 ? 59 : 57;
        std::printf("-- %d. %s %d -> %d (2 st) --\n", 2 + dirn, dirn == 0 ? "hammer-on" : "pull-off", a, b);
        auto trial = [&](int mode) {
            GuitarSettings s = base; s.legatoSlide = mode;
            auto g = mk(s);
            return run(*g, { { 0.1, 0, a, 0.8f }, { 0.8, 0, b, 0.8f }, { 0.85, 1, a, 0 }, { 2.0, 1, b, 0 } }, 2.5);
        };
        auto xl = trial(1), xc = trial(0);
        // sobre-nivel del pico de la transicion (10 ms) respecto al nivel previo de la nota que ya sonaba: un re-pulsado se nota mas
        auto topRise = [&](const std::vector<float>& v) {
            const auto e = envDb(v, SR, 0.80, 0.95, 0.010);
            double m = -1e9; for (double d : e) m = std::max(m, d);
            return m - rmsDbAt(v, SR, 0.74, 0.79);
        };
        const double rl = topRise(xl), rc = topRise(xc);
        const double fa = GuitarEngine::midiToHz(a), fb = GuitarEngine::midiToHz(b);
        const double f0a = f0Win(xl, SR, 0.65, 0.04, 150, 340), f0b = f0Win(xl, SR, 1.2, 0.05, 150, 340);
        std::printf("   pico de la transicion sobre el nivel previo: ligado %+.1f dB, re-pulsado %+.1f dB; f0 antes %.1f (esp. %.1f) despues %.1f (esp. %.1f)\n", rl, rc, f0a, fa, f0b, fb);
        CHECK(rl < 3.0 && rl < rc - 3.0, "%s: sigue habiendo segundo ataque (+%.1f dB vs +%.1f dB re-pulsado)", dirn == 0 ? "hammer-on" : "pull-off", rl, rc);
        CHECK(std::fabs(centsBetween(f0a, fa)) < 40 && std::fabs(centsBetween(f0b, fb)) < 30, "%s: afinacion final", dirn == 0 ? "hammer-on" : "pull-off");
        cleanCheck(xl, "hammer/pull");
    }

    // ---- 3b. slide con la nota anterior ya soltada pero aun sonando (modo Slide) ----
    std::printf("-- 3b. slide desde una nota soltada que aun suena (modo Slide) --\n");
    {
        GuitarSettings s = base; s.legatoSlide = 2; s.slideTimeMs = 200;
        auto g = mk(s);
        auto x = run(*g, { { 0.1, 0, 57, 0.8f }, { 0.4, 1, 57, 0 }, { 0.5, 0, 64, 0.8f }, { 2.0, 1, 64, 0 } }, 2.5);
        const double fe = fftPeakHz(x, SR, 1.2, 0.043, 190, 400);
        std::printf("   f0 final %.1f Hz (esp. %.1f)\n", fe, f64);
        CHECK(std::fabs(centsBetween(fe, f64)) < 30, "slide tras soltar: afinacion final");
        cleanCheck(x, "slide-ringing");
    }

    // ---- 4. STRUM: direccion, spread, velocidad por cuerda ----
    std::printf("-- 4. strum abajo / arriba / alterno --\n");
    {
        const int ns[6] = { 40, 47, 52, 56, 59, 64 };
        for (int dir = 0; dir < 3; ++dir) {
            GuitarSettings s = base; s.strum = 0.7; s.strumDir = dir; s.strumAccent = 0.8;
            auto g = mk(s);
            std::vector<Ev> ev;
            for (int k = 0; k < 6; ++k) { ev.push_back({ 0.1, 0, ns[k], 0.8f }); ev.push_back({ 1.0, 1, ns[k], 0 }); }
            for (int k = 0; k < 6; ++k) { ev.push_back({ 1.5, 0, ns[k], 0.8f }); ev.push_back({ 2.4, 1, ns[k], 0 }); }
            auto x = run(*g, ev, 3.0);
            // el segundo golpe: con 'alterno' debe invertirse; (los tiempos se leen del ultimo golpe)
            int64_t t0 = g->noteStartSample(ns[0]), t5 = g->noteStartSample(ns[5]);
            bool asc = true, desc = true;
            for (int k = 1; k < 6; ++k) { asc = asc && g->noteStartSample(ns[k]) > g->noteStartSample(ns[k - 1]); desc = desc && g->noteStartSample(ns[k]) < g->noteStartSample(ns[k - 1]); }
            const double spreadMs = std::fabs(static_cast<double>(t5 - t0)) / SR * 1000.0;
            const double vLow = g->noteVelocity(ns[0]), vHigh = g->noteVelocity(ns[5]);
            std::printf("   dir=%s (2.o golpe): graves->agudos %s, spread %.0f ms, vel grave %.2f / aguda %.2f\n", dir == 0 ? "abajo" : (dir == 1 ? "arriba" : "alterno"),
                        asc ? "creciente" : (desc ? "decreciente" : "mixto"), spreadMs, vLow, vHigh);
            CHECK(spreadMs > 15.0 && spreadMs < 160.0, "strum: spread %.0f ms fuera de 15..160", spreadMs);
            if (dir == 0) { CHECK(asc, "strum abajo: las cuerdas graves deben sonar primero"); CHECK(vLow > vHigh, "strum abajo: grave mas fuerte que aguda"); }
            if (dir == 1) { CHECK(desc, "strum arriba: las cuerdas agudas deben sonar primero"); CHECK(vHigh > vLow, "strum arriba: aguda mas fuerte que grave"); }
            if (dir == 2) CHECK(desc, "strum alterno: el 2.o golpe debe ser hacia arriba (el 1.o hacia abajo)");
            cleanCheck(x, "strum");
        }
        GuitarSettings s0 = base; s0.strum = 0.0;
        auto g0 = mk(s0);
        run(*g0, { { 0.1, 0, 40, 0.8f }, { 0.1, 0, 47, 0.8f }, { 0.1, 0, 52, 0.8f }, { 0.5, 1, 40, 0 }, { 0.5, 1, 47, 0 }, { 0.5, 1, 52, 0 } }, 0.8);
        CHECK(g0->noteStartSample(40) == g0->noteStartSample(52), "strum 0: las notas deben sonar a la vez");
    }

    // ---- 5. PALM MUTE y 6. NOTA MUERTA ----
    std::printf("-- 5/6. palm mute y nota muerta --\n");
    {
        auto trial = [&](int art, int note, double offAt) {
            GuitarSettings s = base; s.articulation = art;
            auto g = mk(s);
            return run(*g, { { 0.0, 0, note, 0.8f }, { offAt, 1, note, 0 } }, 2.0);
        };
        auto xn = trial(0, 45, 1.0), xp = trial(1, 45, 1.0), xs = trial(1, 45, 0.1);
        const double dn = rmsDbAt(xn, SR, 0.5, 0.7), dp = rmsDbAt(xp, SR, 0.5, 0.7), ds = rmsDbAt(xs, SR, 0.25, 0.35);
        const double cn = centroidOf(xn, static_cast<size_t>(0.02 * SR), SR), cp = centroidOf(xp, static_cast<size_t>(0.02 * SR), SR);
        std::printf("   palm mute: RMS 0.5-0.7 s normal %.1f / palm %.1f dBFS; nota corta (100 ms) a 0.25-0.35 s: %.1f dBFS; centroide %.0f -> %.0f Hz\n", dn, dp, ds, cn, cp);
        CHECK(dp < dn - 15.0, "palm mute: no amortigua (%.1f vs %.1f)", dp, dn);
        CHECK(ds < dn - 20.0, "palm mute corto: release largo");
        CHECK(cp < cn, "palm mute: no se oscurece");
        cleanCheck(xp, "palm");
        auto xd = trial(2, 52, 1.0), xr = trial(0, 52, 1.0);
        double cd = 0, cr = 0;
        f0Win(xd, SR, 0.01, 0.04, 70, 140, &cd); f0Win(xr, SR, 0.05, 0.04, 70, 140, &cr);
        const double dd = rmsDbAt(xd, SR, 0.15, 0.30), drn = rmsDbAt(xr, SR, 0.15, 0.30);
        std::printf("   nota muerta: RMS 0.15-0.30 s normal %.1f / muerta %.1f dBFS; periodicidad %.2f (normal %.2f)\n", drn, dd, cd, cr);
        CHECK(dd < drn - 20.0, "nota muerta: suena demasiado");
        CHECK(peakOf(xd, 0, 4800) > 0.01, "nota muerta: sin golpe percusivo");
        cleanCheck(xd, "dead");
    }

    // ---- 7. ARMONICOS (por keyswitch) ----
    std::printf("-- 7. armonicos natural (ks D#0) y artificial (ks E0) --\n");
    for (int art = 0; art < 2; ++art) {
        auto g = mk(base);
        const int note = art == 0 ? 76 : 64;
        auto x = run(*g, { { 0.0, 0, art == 0 ? kKsHarmNat : kKsHarmArt, 1.0f }, { 0.05, 0, note, 0.8f }, { 2.5, 1, note, 0 } }, 3.5);
        const double fe = GuitarEngine::midiToHz(note);
        const double f = f0Win(x, SR, 0.3, 0.06, fe * 0.8, fe * 1.25);
        const double l1 = rmsDbAt(x, SR, 0.25, 0.35), l2 = rmsDbAt(x, SR, 1.9, 2.0), l0 = rmsDbAt(x, SR, 1.0, 1.1);
        std::printf("   %s nota %d: f0 %.1f Hz (esp. %.1f, %.1f cents); nivel 0.3 s %.1f, 1.0 s %.1f, 1.9 s %.1f dBFS\n", art == 0 ? "natural" : "artificial", note, f, fe, centsBetween(f, fe), l1, l0, l2);
        CHECK(std::fabs(centsBetween(f, fe)) < 12.0, "armonico %d: afinacion %.1f cents", art, centsBetween(f, fe));
        CHECK(l1 > -50 && l0 > -60 && l2 < l1, "armonico %d: envolvente (%.1f/%.1f/%.1f)", art, l1, l0, l2);
        cleanCheck(x, "harm");
    }

    // ---- 8. BENDS: pre-bend (ks A0) y bend-up (ks A#0) ----
    std::printf("-- 8. pre-bend y bend-up (2 st) --\n");
    {
        auto g1 = mk(base);
        auto xa = run(*g1, { { 0.0, 0, kKsPreBend, 1.0f }, { 0.01, 0, 64, 0.8f }, { 1.5, 1, 64, 0 } }, 2.0);
        const double fa0 = f0Win(xa, SR, 0.045, 0.04, 250, 480), fa1 = f0Win(xa, SR, 1.0, 0.05, 250, 480);
        std::printf("   pre-bend: inicio %.1f Hz (esp. %.1f), final %.1f Hz (esp. %.1f)\n", fa0, f64 * std::pow(2, 2.0 / 12), fa1, f64);
        CHECK(std::fabs(centsBetween(fa0, f64 * std::pow(2, 2.0 / 12))) < 40.0, "pre-bend: inicio");
        CHECK(std::fabs(centsBetween(fa1, f64)) < 20.0, "pre-bend: no vuelve a la nota");
        auto g2 = mk(base);
        auto xb = run(*g2, { { 0.0, 0, kKsBendUp, 1.0f }, { 0.01, 0, 64, 0.8f }, { 1.5, 1, 64, 0 } }, 2.0);
        const double fb0 = f0Win(xb, SR, 0.03, 0.04, 250, 480), fb1 = f0Win(xb, SR, 1.0, 0.05, 250, 480);
        std::printf("   bend-up: inicio %.1f Hz, final %.1f Hz (esp. %.1f)\n", fb0, fb1, f64 * std::pow(2, 2.0 / 12));
        CHECK(std::fabs(centsBetween(fb0, f64)) < 25.0, "bend-up: inicio");
        CHECK(std::fabs(centsBetween(fb1, f64 * std::pow(2, 2.0 / 12))) < 40.0, "bend-up: no llega al tono");
        cleanCheck(xa, "prebend"); cleanCheck(xb, "bendup");
    }

    // ---- 9. VIBRATO con retardo de entrada (CC1) ----
    std::printf("-- 9. vibrato (CC1) con retardo de 400 ms --\n");
    {
        GuitarSettings s = base; s.vibDelayMs = 400;
        auto g = mk(s);
        auto x = run(*g, { { 0.0, 3, 0, 1.0f }, { 0.0, 0, 57, 0.8f }, { 2.5, 1, 57, 0 } }, 3.0);
        double e0 = 1e9, e1 = 0, l0 = 1e9, l1 = 0;
        for (double t = 0.05; t < 0.36; t += 0.02) { const double f = f0Win(x, SR, t, 0.04, 190, 260); e0 = std::min(e0, f); e1 = std::max(e1, f); }
        for (double t = 1.0; t < 1.9; t += 0.02) { const double f = f0Win(x, SR, t, 0.04, 190, 260); l0 = std::min(l0, f); l1 = std::max(l1, f); }
        std::printf("   pico a pico: antes del retardo %.0f cents, despues %.0f cents\n", centsBetween(e1, e0), centsBetween(l1, l0));
        CHECK(centsBetween(e1, e0) < 20.0, "vibrato: ya actua antes del retardo (%.0f cents)", centsBetween(e1, e0));
        CHECK(centsBetween(l1, l0) > 30.0, "vibrato: ausente tras el retardo (%.0f cents)", centsBetween(l1, l0));
        cleanCheck(x, "vibrato");
    }

    // ---- 10. VOLUME SWELL: auto-swell por nota y CC11 ----
    std::printf("-- 10. volume swell (auto 800 ms y CC11) --\n");
    {
        GuitarSettings s = base; s.swellTimeMs = 800;
        auto g = mk(s);
        auto x = run(*g, { { 0.0, 0, 57, 0.8f }, { 3.0, 1, 57, 0 } }, 3.5);
        const auto e = envDb(x, SR, 0.05, 0.45, 0.05);
        bool mono = true; for (size_t i = 1; i < e.size(); ++i) mono = mono && e[i] >= e[i - 1] - 0.5;
        std::printf("   auto-swell RMS por 50 ms: "); for (double v : e) std::printf("%.0f ", v); std::printf("dBFS\n");
        CHECK(mono, "swell automatico no monotono");
        CHECK(e.back() - e.front() > 15.0, "swell automatico: subida insuficiente (%.1f dB)", e.back() - e.front());
        cleanCheck(x, "swell");
        GuitarSettings s2 = base;
        auto g2 = mk(s2);
        std::vector<Ev> ev = { { 0.0, 5, 11, 0.0f }, { 0.05, 0, 57, 0.8f }, { 3.0, 1, 57, 0 } };
        for (int k = 1; k <= 25; ++k) ev.push_back({ 0.05 + 0.02 * k, 5, 11, static_cast<float>(127.0 * k / 25.0) });
        auto y = run(*g2, ev, 3.5);
        const auto e2 = envDb(y, SR, 0.1, 0.5, 0.05);
        bool mono2 = true; for (size_t i = 1; i < e2.size(); ++i) mono2 = mono2 && e2[i] >= e2[i - 1] - 0.3;
        std::printf("   CC11 0->127 en 0.5 s, RMS por 50 ms: "); for (double v : e2) std::printf("%.0f ", v); std::printf("dBFS\n");
        CHECK(mono2, "swell por CC11 no monotono");
        CHECK(e2.back() - e2.front() > 15.0, "swell CC11: subida insuficiente");
        cleanCheck(y, "cc11");
        GuitarSettings s3 = base; s3.expression = 0.0;
        auto g3 = mk(s3);
        auto z = run(*g3, { { 0.0, 0, 57, 0.8f }, { 1.0, 1, 57, 0 } }, 1.5);
        CHECK(rmsDbAt(z, SR, 0.3, 0.8) < -70.0, "expresion 0 no silencia (%.1f dBFS)", rmsDbAt(z, SR, 0.3, 0.8));
    }

    // ---- 11. TREMOLO PICKING ----
    std::printf("-- 11. tremolo picking (10 Hz) --\n");
    {
        GuitarSettings s = base; s.articulation = 5; s.tremRate = 10;
        auto g = mk(s);
        auto x = run(*g, { { 0.2, 0, 55, 0.8f }, { 1.7, 1, 55, 0 } }, 2.2);
        auto countOnsets = [&](const std::vector<float>& sig) {
            std::vector<float> d(sig.size(), 0.0f);
            for (size_t i = 1; i < sig.size(); ++i) d[i] = sig[i] - sig[i - 1];
            const auto e = envDb(d, SR, 0.3, 1.7, 0.005);
            int n = 0; double last = -1;
            for (size_t i = 1; i < e.size(); ++i) {
                const double tt = 0.3 + i * 0.005;
                if (e[i] - e[i - 1] > 3.0 && tt - last > 0.04) { ++n; last = tt; }
            }
            return n;
        };
        const int onsets = countOnsets(x);
        std::printf("   pulsaciones detectadas en 1.4 s: %d (esperadas ~14)\n", onsets);
        CHECK(onsets >= 9 && onsets <= 19, "tremolo picking: %d pulsaciones (esp. ~14)", onsets);
        cleanCheck(x, "tremolo");
        GuitarSettings sn = base;
        auto gn = mk(sn);
        auto xn = run(*gn, { { 0.2, 0, 55, 0.8f }, { 1.7, 1, 55, 0 } }, 2.2);
        const int on2 = countOnsets(xn);
        std::printf("   nota normal: %d pulsaciones\n", on2);
        CHECK(on2 < onsets - 4, "tremolo picking no se distingue de la nota normal");
    }

    // ---- 12. SLIDE-IN / SLIDE-OUT ----
    std::printf("-- 12. slide-in (ks F#0) y slide-out (ks G0) --\n");
    {
        GuitarSettings s = base; s.slideTimeMs = 140; s.slideRange = 5;
        auto g = mk(s);
        auto x = run(*g, { { 0.0, 0, kKsSlideIn, 1.0f }, { 0.05, 0, 64, 0.8f }, { 1.0, 1, 64, 0 } }, 1.5);
        const double fi0 = fftPeakHz(x, SR, 0.075, 0.043, 180, 420), fi1 = fftPeakHz(x, SR, 0.5, 0.043, 250, 420);
        std::printf("   slide-in: f0 al empezar %.1f Hz (%.0f cents) -> %.1f Hz\n", fi0, centsBetween(fi0, f64), fi1);
        CHECK(centsBetween(fi0, f64) < -200.0, "slide-in: no empieza por debajo (%.0f cents)", centsBetween(fi0, f64));
        CHECK(std::fabs(centsBetween(fi1, f64)) < 20.0, "slide-in: no llega a la nota");
        cleanCheck(x, "slide-in");
        auto g2 = mk(s);
        auto y = run(*g2, { { 0.0, 0, kKsSlideOutDown, 1.0f }, { 0.05, 0, 64, 0.8f }, { 0.6, 1, 64, 0 } }, 1.2);
        const double fo0 = fftPeakHz(y, SR, 0.55, 0.043, 180, 420), fo1 = fftPeakHz(y, SR, 0.66, 0.030, 150, 420);
        std::printf("   slide-out abajo: f0 %.1f Hz antes -> %.1f Hz (%.0f cents)\n", fo0, fo1, centsBetween(fo1, fo0));
        CHECK(std::fabs(centsBetween(fo0, f64)) < 25.0, "slide-out: tono antes de soltar");
        CHECK(centsBetween(fo1, fo0) < -50.0, "slide-out: no baja al soltar (%.0f cents)", centsBetween(fo1, fo0));
        cleanCheck(y, "slide-out");
        auto g3 = mk(s);
        auto z = run(*g3, { { 0.0, 0, kKsSlideOutUp, 1.0f }, { 0.05, 0, 64, 0.8f }, { 0.6, 1, 64, 0 } }, 1.2);
        const double fu1 = fftPeakHz(z, SR, 0.66, 0.030, 180, 600);
        CHECK(centsBetween(fu1, f64) > 50.0, "slide-out arriba: no sube (%.0f cents)", centsBetween(fu1, f64));
    }

    // ---- 13. keyswitches mudos y CC ----
    std::printf("-- 13. keyswitches sin sonido y mapeo de CC --\n");
    {
        auto g = mk(base);
        std::vector<Ev> ev;
        for (int k = kKsFirst; k <= kKsLast; ++k) ev.push_back({ 0.01 * (k - kKsFirst), 0, k, 1.0f });
        auto x = run(*g, ev, 0.5);
        CHECK(peakOf(x) < 1e-6 && g->activeVoices() == 0, "los keyswitches suenan");
        g->controlChange(kCcArt, 102);
        CHECK(g->articulation() == 4, "CC80=102 debe elegir armonico artificial (%d)", g->articulation());
        g->controlChange(kCcArt, 0);
        CHECK(g->articulation() == 0, "CC80=0 debe volver a normal");
        std::printf("   ok (%d keyswitches, CC80)\n", kKsLast - kKsFirst + 1);
    }

    // ---- 13b. nivel de los ruidos de dedo/traste/pua respecto a la nota (sutiles, no tapan la nota) ----
    std::printf("-- 13b. nivel relativo de los ruidos de tecnica --\n");
    {
        auto slideRun = [&](double pn) {
            GuitarSettings s = base; s.legatoSlide = 2; s.slideTimeMs = 300; s.pickNoise = pn;
            auto g = mk(s);
            return run(*g, { { 0.1, 0, 57, 0.8f }, { 0.9, 0, 64, 0.8f }, { 0.95, 1, 57, 0 }, { 2.5, 1, 64, 0 } }, 3.0);
        };
        const auto a1 = slideRun(0.4), a0 = slideRun(0.0);
        std::vector<float> dn(a1.size());
        for (size_t i = 0; i < dn.size(); ++i) dn[i] = a1[i] - a0[i];
        const double rs = rmsDbAt(dn, SR, 0.95, 1.2) - rmsDbAt(a0, SR, 0.12, 0.40);   // respecto al nivel del ataque de la nota
        std::printf("   rasp del slide: %.1f dB respecto a la nota\n", rs);
        CHECK(rs > -42.0 && rs < -16.0, "ruido de slide fuera de rango (%.1f dB)", rs);
        auto relRun = [&](double pn) {
            GuitarSettings s = base; s.pickNoise = pn;
            auto g = mk(s);
            return run(*g, { { 0.0, 0, 52, 0.8f }, { 1.0, 1, 52, 0 } }, 1.5);
        };
        const auto r1 = relRun(0.4), r0 = relRun(0.0);
        std::vector<float> dr(r1.size());
        for (size_t i = 0; i < dr.size(); ++i) dr[i] = r1[i] - r0[i];
        const double rr = rmsDbAt(dr, SR, 1.0, 1.02) - rmsDbAt(r0, SR, 0.05, 0.30);
        std::printf("   chasquido al soltar: %.1f dB respecto a la nota\n", rr);
        CHECK(rr > -50.0 && rr < -20.0, "ruido al soltar fuera de rango (%.1f dB)", rr);
        CHECK(peakOf(dr, static_cast<size_t>(1.2 * SR), dr.size()) < 1e-6, "el ruido al soltar no termina");
    }

    // ---- 14. seguridad: todas las tecnicas a la vez a varias tasas / bloques ----
    std::printf("-- 14. seguridad con todas las tecnicas mezcladas --\n");
    for (double sr : { 44100.0, 96000.0 }) {
        for (int block : { 1, 77, 4096 }) {
            GuitarEngine g; g.prepare(sr, block);
            GuitarSettings s = base; s.legatoSlide = 2; s.strum = 1.0; s.swellTimeMs = 500; s.pickNoise = 1.0; s.ampGain = 1.0;
            g.setSettings(s); makeReady(g);
            std::vector<Ev> ev;
            const int ks[] = { 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 12 };
            for (int i = 0; i < 16; ++i) {
                const double t = i * 0.18;
                ev.push_back({ t, 0, ks[i], 1.0f });
                for (int n : { 40, 52, 59, 64 + (i % 5) }) { ev.push_back({ t + 0.01, 0, n, 0.9f }); ev.push_back({ t + 0.14 + 0.02 * (n % 3), 1, n, 0 }); }
            }
            auto x = renderSeq(g, sr, ev, block == 1 ? 0.4 : 3.2, block);
            CHECK(finiteAll(x) && peakOf(x) < 1.0, "tecnicas mezcladas: NaN o pico sr=%.0f block=%d", sr, block);
        }
        std::printf("   sr %.0f OK\n", sr);
    }

    // ---- 15. WAV de demostracion de tecnicas ----
    {
        GuitarSettings s;   // sonido de fabrica (FX incluidos)
        s.legatoSlide = 0;
        auto g = mk(s);
        std::vector<Ev> ev; ev.push_back({ 0, 4, 0, 90.0f });
        auto note = [&](double t, double d, int n, float v) { ev.push_back({ t, 0, n, v }); ev.push_back({ t + d, 1, n, 0 }); };
        auto ks = [&](double t, int k) { ev.push_back({ t - 0.005, 0, k, 1.0f }); };
        double t = 0.2;
        ks(t, kKsLegato); note(t, 1.2, 62, 0.7f); note(t + 0.9, 1.2, 69, 0.7f); t += 2.4;            // slide D4 -> A4 (solape)
        note(t, 0.8, 64, 0.7f); note(t + 0.6, 0.8, 66, 0.7f); note(t + 1.2, 1.2, 64, 0.7f); t += 2.6;   // hammer-on / pull-off
        ks(t, kKsNormal); ks(t + 0.001, kKsStrumDown);
        for (int n : { 50, 57, 62, 66, 69, 74 }) note(t, 1.0, n, 0.75f);
        ks(t + 1.1, kKsStrumUp);
        for (int n : { 50, 57, 62, 66, 69, 74 }) note(t + 1.2, 1.0, n, 0.7f);
        t += 2.6;
        ks(t, kKsPalm); for (int i = 0; i < 8; ++i) note(t + i * 0.25, 0.22, i % 2 ? 50 : 45, 0.8f); t += 2.2;
        ks(t, kKsHarmNat); note(t, 2.0, 76, 0.7f); note(t + 0.7, 2.0, 71, 0.7f); t += 3.0;
        ks(t, kKsNormal); ks(t + 0.001, kKsSlideIn); note(t + 0.01, 1.2, 69, 0.75f); ks(t + 1.4, kKsSlideOutDown); note(t + 1.41, 1.0, 66, 0.75f); t += 3.2;
        ks(t, kKsPreBend); note(t + 0.01, 1.6, 71, 0.75f); t += 2.2;
        ev.push_back({ t, 3, 0, 0.8f }); note(t, 2.4, 74, 0.7f); ev.push_back({ t + 2.6, 3, 0, 0.0f }); t += 3.0;
        ks(t, kKsAutoSwell); note(t, 3.0, 57, 0.7f); note(t + 0.02, 3.0, 64, 0.7f); note(t + 0.04, 3.0, 69, 0.7f);
        std::vector<float> R;
        auto L = renderSeq(*g, SR, ev, t + 6.0, 512, &R);
        writeWav(out + (sampled ? "/guitarra_tecnicas_muestras.wav" : "/guitarra_tecnicas_modelado.wav"), L, R, 48000);
        const double pk = std::max(peakOf(L), peakOf(R));
        std::printf("-- 15. WAV de tecnicas: pico %.1f dBFS, rms %.1f dBFS\n", dbfsOf(pk), dbfsOf(rmsOf(L)));
        CHECK(finiteAll(L) && pk > 0.05 && pk < 0.99 && maxStep(L) < 0.5, "WAV de tecnicas fuera de rango");
    }
    return g_fail - failAntes;
}

static int sampledTest(const std::string& out) {
    constexpr double SR = 48000.0;
    std::printf("== JasWave Electric Guitar - prueba del banco de muestras ==\n");
    GuitarEngine probe; probe.prepare(SR, 512); makeReady(probe);
    CHECK(probe.samplerReady(), "el banco electric-guitar.jws no se cargo (carpeta de samples)");
    if (!probe.samplerReady()) return 1;

    auto engine = [&](const GuitarSettings& st) { auto g = std::make_unique<GuitarEngine>(); g->prepare(SR, 512); g->setSettings(st); makeReady(*g); return g; };
    GuitarSettings def;                       // valores por defecto del plugin (FX incluidos)
    GuitarSettings seco = def; seco.delayMix = 0; seco.chorusMix = 0; seco.reverbMix = 0; seco.strum = 0;

    std::printf("-- 1. nivel por nota (vel 0.7, ajustes por defecto), cola y estabilidad --\n");
    std::printf("%6s %9s %10s %10s %11s %9s\n", "nota", "pico dB", "rms ataque", "centroide", "cola final", "salto max");
    double pkMin = 1e9, pkMax = 0;
    for (int n : { 28, 33, 40, 45, 50, 55, 59, 64, 69, 76, 83, 88, 96 }) {
        auto g = engine(def);
        std::vector<float> R;
        auto L = renderSeq(*g, SR, { { 0.05, 0, n, 0.7f }, { 2.0, 1, n, 0 } }, 9.0, 256, &R);
        CHECK(finiteAll(L) && finiteAll(R), "NaN/inf en nota %d", n);
        const double pk = std::max(peakOf(L), peakOf(R));
        const size_t a = static_cast<size_t>(0.15 * SR), b = static_cast<size_t>(0.45 * SR);
        const double rms = rmsOf(L, a, b);
        double cola = 0; for (size_t i = L.size() - 4000; i < L.size(); ++i) cola = std::max(cola, (double)std::fabs(L[i]));
        double dmax = 0; for (size_t i = 1; i < L.size(); ++i) dmax = std::max(dmax, (double)std::fabs(L[i] - L[i - 1]));
        const double cen = centroidOf(L, static_cast<size_t>(0.2 * SR), SR);
        std::printf("%6d %9.1f %10.1f %9.0fHz %11.1f %9.3f\n", n, dbfsOf(pk), dbfsOf(rms), cen, dbfsOf(cola), dmax);
        pkMin = std::min(pkMin, pk); pkMax = std::max(pkMax, pk);
        CHECK(pk > 0.1 && pk < 0.708, "pico fuera de -20..-3 dBFS en nota %d (%.1f dB)", n, dbfsOf(pk));
        CHECK(cola < 1e-3, "la cola no termina en silencio (nota %d)", n);
        CHECK(dmax < 0.35, "discontinuidad en nota %d (%.3f)", n, dmax);
    }
    std::printf("  rango de picos entre notas: %.1f .. %.1f dBFS (dispersion %.1f dB)\n", dbfsOf(pkMin), dbfsOf(pkMax), dbfsOf(pkMax) - dbfsOf(pkMin));
    CHECK(dbfsOf(pkMax) - dbfsOf(pkMin) < 9.0, "niveles entre notas demasiado desiguales");

    std::printf("-- 2. dinamica por velocidad (nota 55 y 64, fx off) --\n");
    for (int n : { 55, 64 }) {
        double lv[4]; int k = 0;
        for (float v : { 0.2f, 0.45f, 0.7f, 0.95f }) {
            auto g = engine(seco);
            auto L = renderSeq(*g, SR, { { 0.0, 0, n, v }, { 1.5, 1, n, 0 } }, 3.0, 256);
            lv[k++] = dbfsOf(rmsOf(L, static_cast<size_t>(0.1 * SR), static_cast<size_t>(0.5 * SR)));
        }
        std::printf("  nota %d: rms vel 0.20 %.1f | 0.45 %.1f | 0.70 %.1f | 0.95 %.1f dBFS (rango %.1f dB)\n", n, lv[0], lv[1], lv[2], lv[3], lv[3] - lv[0]);
        CHECK(lv[3] - lv[0] > 6.0 && lv[3] - lv[0] < 24.0, "dinamica pp->ff fuera de 6..24 dB (nota %d)", n);
        CHECK(lv[0] < lv[1] + 0.5 && lv[1] < lv[2] + 0.5 && lv[2] < lv[3] + 0.5, "dinamica no monotona (nota %d)", n);
    }

    std::printf("-- 3. golpes iguales no identicos (round-robin + humanizacion) --\n");
    {
        auto g = engine(seco);
        auto L = renderSeq(*g, SR, { { 0.0, 0, 52, 0.7f }, { 0.8, 1, 52, 0 }, { 1.5, 0, 52, 0.7f }, { 2.3, 1, 52, 0 }, { 3.0, 0, 52, 0.7f }, { 3.8, 1, 52, 0 } }, 5.0, 256);
        const size_t i0 = 0, i1 = static_cast<size_t>(1.5 * SR), i2 = static_cast<size_t>(3.0 * SR);
        auto rel = [&](size_t x, size_t y) { double dif = 0, ref = 0; for (size_t i = 0; i < 12000; ++i) { dif += std::fabs(L[x + i] - L[y + i]); ref += std::fabs(L[x + i]); } return dif / std::max(ref, 1e-9); };
        std::printf("  diferencia relativa golpe1-golpe2 %.0f %%, golpe2-golpe3 %.0f %%, golpe1-golpe3 %.0f %%\n", 100 * rel(i0, i1), 100 * rel(i1, i2), 100 * rel(i0, i2));
        CHECK(rel(i0, i1) > 0.05 && rel(i1, i2) > 0.05 && rel(i0, i2) > 0.05, "golpes casi identicos: suena a ametralladora");
    }

    std::printf("-- 4. acorde (strum por defecto): voces y nivel --\n");
    {
        auto g = engine(def);
        std::vector<Ev> ev; chord(ev, 0.0, 3.0, { 50, 57, 62, 66, 69, 74 }, 0.7f);
        std::vector<float> R;
        auto L = renderSeq(*g, SR, ev, 6.0, 256, &R);
        const double pk = std::max(peakOf(L), peakOf(R));
        std::printf("  acorde D de 6 notas vel 0.7: pico %.1f dBFS, rms %.1f dBFS\n", dbfsOf(pk), dbfsOf(rmsOf(L, 4800, 96000)));
        CHECK(pk > 0.1 && pk < 0.99, "acorde: pico fuera de rango");
        double dmax = 0; for (size_t i = 1; i < L.size(); ++i) dmax = std::max(dmax, (double)std::fabs(L[i] - L[i - 1]));
        CHECK(dmax < 0.5, "acorde: discontinuidad %.3f", dmax);
        double dif = 0, ref = 0; for (size_t i = 24000; i < 96000; ++i) { dif += std::fabs(L[i] - R[i]); ref += std::fabs(L[i]); }
        std::printf("  anchura estereo |L-R|/|L| = %.2f\n", dif / std::max(ref, 1e-9));
        CHECK(dif / std::max(ref, 1e-9) > 0.1, "el resultado es casi mono");
    }

    std::printf("-- 5. cadena: centroide con tono 20/55/90 %% y drive 0/20/60 %% (nota 64) --\n");
    {
        for (double tone : { 0.2, 0.55, 0.9 }) {
            GuitarSettings s = seco; s.tone = tone;
            auto g = engine(s);
            auto L = renderSeq(*g, SR, { { 0.0, 0, 64, 0.7f } }, 1.5, 256);
            std::printf("  tono %.0f%%: centroide %.0f Hz\n", tone * 100, centroidOf(L, static_cast<size_t>(0.2 * SR), SR));
        }
        double c0 = 0, c60 = 0;
        for (double ga : { 0.0, 0.2, 0.6 }) {
            GuitarSettings s = seco; s.ampGain = ga;
            auto g = engine(s);
            auto L = renderSeq(*g, SR, { { 0.0, 0, 64, 0.9f } }, 1.5, 256);
            const double c = centroidOf(L, static_cast<size_t>(0.2 * SR), SR);
            std::printf("  drive %.0f%%: centroide %.0f Hz, pico %.1f dBFS\n", ga * 100, c, dbfsOf(peakOf(L)));
            if (ga == 0.0) c0 = c; else if (ga == 0.6) c60 = c;
        }
        CHECK(c60 >= c0 * 0.9, "el drive no deberia oscurecer");
    }

    std::printf("-- 6. a otras tasas y bloques (seguridad) --\n");
    for (double sr : { 44100.0, 96000.0 }) {
        for (int block : { 1, 64, 4096 }) {
            GuitarEngine g; g.prepare(sr, block); GuitarSettings s; s.ampGain = 1.0; s.chorusMix = 1.0; s.delayMix = 1.0; s.delayFb = 0.95; s.reverbMix = 1.0;
            g.setSettings(s); makeReady(g);
            std::vector<Ev> ev; ev.push_back({ 0.0, 2, 0, 0.5f }); chord(ev, 0.0, 0.5, { 40, 47, 52, 56, 59, 64 }, 1.0f); chord(ev, 0.7, 0.5, { 28, 35, 90, 96, 100, 108 }, 1.0f);
            auto x = renderSeq(g, sr, ev, block == 1 ? 0.3 : 3.0, block);
            CHECK(finiteAll(x) && peakOf(x) < 1.0, "NaN o pico>=1 sr=%.0f block=%d", sr, block);
        }
        std::printf("  sr %.0f OK\n", sr);
    }

    std::printf("-- 7. WAV: acorde ambiental con delay punteado + arpegio --\n");
    {
        GuitarSettings s;   // por defecto: es el sonido «de fabrica»
        auto g = engine(s);
        std::vector<Ev> ev; ev.push_back({ 0, 4, 0, 72.0f });
        chord(ev, 0.2, 5.0, { 50, 57, 62, 66, 69, 74 }, 0.6f);              // D (acorde abierto, rasgueo suave)
        const double beat = 60.0 / 72.0;
        const int arp[] = { 57, 62, 66, 69, 66, 62, 69, 74 };               // arpegio sobre D
        for (int i = 0; i < 16; ++i) {
            const double t = 7.0 + i * beat * 0.5;
            ev.push_back({ t, 0, arp[i % 8], (float)(0.5 + 0.12 * ((i % 4) == 0) + 0.04 * ((i * 5) % 3)) });
            ev.push_back({ t + beat * 0.8, 1, arp[i % 8], 0 });
        }
        std::vector<float> R;
        auto L = renderSeq(*g, SR, ev, 7.0 + 16 * beat * 0.5 + 4.0, 512, &R);
        writeWav(out + "/guitarra_muestras_acorde_arpegio.wav", L, R, 48000);
        const double pk = std::max(peakOf(L), peakOf(R));
        std::printf("  acorde+arpegio: pico %.1f dBFS, rms %.1f dBFS\n", dbfsOf(pk), dbfsOf(rmsOf(L)));
        CHECK(finiteAll(L) && pk > 0.1 && pk < 0.99, "WAV de muestras fuera de rango");
    }

    techniqueSuite(true, out);
    std::printf("\nHASH-SUITE samples = 0x%016llx\n", static_cast<unsigned long long>(g_hash));
    std::printf(g_fail ?"\nRESULTADO: %d FALLOS\n" : "\nRESULTADO: TODO OK\n", g_fail);
    return g_fail ? 1 : 0;
}


// ------------------------------------------------------------------ 7. FX Rack comun (jw_fxrack.h)
// Las pruebas del rack no entran en el hash de la suite (g_hashOn = false mientras corren).
struct XorT {
    uint32_t s{0x2545F491u};
    void seed(uint32_t v) { s = v ? v : 0x9E3779B9u; for (int i = 0; i < 4; ++i) u32(); }
    uint32_t u32() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    double uni() { return u32() * (1.0 / 4294967296.0); }
    double bi() { return uni() * 2.0 - 1.0; }
};
static void fftC(std::vector<std::complex<double>>& a) {
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; ++i) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = -2.0 * JasWaveDsp::kPi / static_cast<double>(len);
        const std::complex<double> wl(std::cos(ang), std::sin(ang));
        for (size_t i = 0; i < n; i += len) {
            std::complex<double> w(1.0);
            for (size_t j = 0; j < len / 2; ++j) {
                const auto u = a[i + j], v = a[i + j + len / 2] * w;
                a[i + j] = u + v;
                a[i + j + len / 2] = u - v;
                w *= wl;
            }
        }
    }
}
// Tiempo de reloj de pared; se toma el MINIMO de varias pasadas (descarta la interferencia de otros procesos)
static double cpuSeconds() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
static double db(double v) { return 20.0 * std::log10(std::max(v, 1e-12)); }

// Hash FNV-1a de un render determinista de la guitarra (acordes + notas sueltas + bend + CC, 6 s, bloques de 512)
static uint64_t renderHash(GuitarEngine& e, double sr, int block) {
    const bool prev = g_hashOn; g_hashOn = false;
    std::vector<Ev> ev;
    const int notes[] = { 40, 52, 59, 64, 69 };
    for (int k = 0; k < 5; ++k) { ev.push_back({ k * 0.4, 0, notes[k], 0.6f + 0.05f * k }); ev.push_back({ 3.0 + k * 0.1, 1, notes[k], 0.0f }); }
    ev.push_back({ 1.0, 2, 0, 0.5f }); ev.push_back({ 1.5, 2, 0, 0.0f }); ev.push_back({ 2.0, 3, 0, 0.7f });
    ev.push_back({ 4.0, 4, 0, 100.0f });
    std::vector<float> R;
    const auto L = renderSeq(e, sr, ev, 6.0, block, &R);
    g_hashOn = prev;
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < L.size(); ++i) { uint32_t a, b; std::memcpy(&a, &L[i], 4); std::memcpy(&b, &R[i], 4); h = (h ^ a) * 1099511628211ull; h = (h ^ b) * 1099511628211ull; }
    return h;
}
static void testFxRack() {
    using namespace JasWaveFx;
    std::printf("[7] FX Rack comun (jw_fxrack.h, ids %u..%u)\n", kBase, kBase + kUltimoOffset);
    const double SR = 48000.0;

    // ---- 7.0 definiciones: ids estandar, contiguos al final, nombres con prefijo, defaults neutros ----
    {
        const auto& defs = paramDefs();
        int nFx = 0; bool ids = true, nombres = true, neutros = true;
        for (const auto& d : defs) {
            if (d.id < kBase) continue;
            ++nFx;
            if (d.id >= kBase + kRango) ids = false;
            if (std::strncmp(d.name, "FX \xC2\xB7 ", 5) != 0) nombres = false;
            if (d.map == Map::Stepped && d.steps == 1 && d.units && d.name && std::strstr(d.name, " On") && d.defV != 0.0) neutros = false;
        }
        const FxParams pd = porDefecto();
        std::printf("    parametros del rack: %d (esperados 58), algun bloque activo por defecto: %d\n", nFx, pd.algunoActivo() ? 1 : 0);
        CHECK(nFx == 58, "numero de parametros del rack %d != 58", nFx);
        CHECK(ids && nombres && neutros, "ids/nombres/defaults del rack");
        CHECK(!pd.algunoActivo(), "el rack debe estar apagado por defecto");
        // ids unicos y con la base fija
        std::vector<uint32_t> idv; for (const auto& d : defs) idv.push_back(d.id);
        std::sort(idv.begin(), idv.end());
        CHECK(std::adjacent_find(idv.begin(), idv.end()) == idv.end(), "ids duplicados");
        CHECK(defs.back().id == kBase + OutGain, "el ultimo parametro debe ser Out Gain");
    }

    // ---- 7.1 neutralidad bit a bit en el motor (rack apagado == salida previa del plugin) ----
    {
        // Referencia del render de abajo con el rack apagado. La neutralidad frente al motor PREVIO a la integracion se verifico con el
        // hash de toda la suite (HASH-SUITE: modelada 0xafc9b958c9c94879, samples 0x41bd2e162487dd80), identico antes y despues.
        const uint64_t golden = 0x84f6641f8dc37b0dull;
        GuitarEngine e0; e0.prepare(SR, 512); e0.setSettings(GuitarSettings{});
        const uint64_t h0 = renderHash(e0, SR, 512);
        // con valores de rack ajustados pero TODOS los bloques apagados
        GuitarEngine e1; e1.prepare(SR, 512); e1.setSettings(GuitarSettings{});
        FxParams p = porDefecto();
        for (int b = 0; b < kBands; ++b) { p.eq[b].gainDb = 12.0; p.eq[b].hz *= 1.3; }
        p.compThreshDb = -50; p.compRatio = 20; p.satDrive = 1.0; p.dlTimeMs = 100; p.rvMix = 1.0; p.outWidth = 2.0; p.outGainDb = 12.0;
        e1.setFx(p);
        const uint64_t h1 = renderHash(e1, SR, 512);
        std::printf("    hash sin rack=0x%016llx, rack apagado con valores extremos=0x%016llx (referencia 0x%016llx)\n",
                    static_cast<unsigned long long>(h0), static_cast<unsigned long long>(h1), static_cast<unsigned long long>(golden));
        CHECK(h0 == golden, "el rack apagado cambia el sonido por defecto del plugin");
        CHECK(h1 == golden, "el rack con bloques apagados cambia el sonido");
        // y encendido SI cambia
        GuitarEngine e2; e2.prepare(SR, 512); e2.setSettings(GuitarSettings{});
        FxParams q = porDefecto(); q.eqOn = true; q.eq[2].gainDb = 9.0; q.dlOn = true; q.rvOn = true; q.compOn = true; q.satOn = true; q.chOn = true; q.outOn = true;
        e2.setFx(q);
        CHECK(renderHash(e2, SR, 512) != golden, "el rack encendido no cambia nada");
    }

    // ---- utilidades de medida ----
    FxRack rk; rk.prepare(SR);
    auto sine = [&](std::vector<float>& x, double f, double amp, double sr) { for (size_t i = 0; i < x.size(); ++i) x[i] = static_cast<float>(amp * std::sin(2.0 * kPi * f * static_cast<double>(i) / sr)); };
    // ganancia (dB) en estado estable a la frecuencia f: RMS de la segunda mitad
    auto gainAt = [&](FxRack& r, const FxParams& p, double f, double sr, double dur) {
        const size_t N = static_cast<size_t>(dur * sr);
        std::vector<float> a(N), b(N), ref;
        sine(a, f, 0.1, sr); b = a; ref = a;
        r.reset(); r.setParams(p, true);
        for (size_t i = 0; i < N; i += 480) { const int n = static_cast<int>(std::min<size_t>(480, N - i)); r.process(a.data() + i, b.data() + i, n); }
        return db(rmsOf(a, N / 2, N) / rmsOf(ref, N / 2, N));
    };

    auto gainAt5 = [&](FxRack& r, const FxParams& p, double f) { return gainAt(r, p, f, SR, 0.5); };
    // ---- 7.2 EQ: respuesta medida de cada banda ----
    {
        std::printf("    EQ de 6 bandas: ganancia medida vs analitica (dB)\n");
        double worst = 0.0;
        for (int b = 0; b < kBands; ++b) {
            for (const double g : { -9.0, +9.0 }) {
                FxParams p = porDefecto(); p.eqOn = true;
                p.eq[b].gainDb = g;
                const double f0 = p.eq[b].hz;
                const double meas = gainAt5(rk, p, f0), ana = eqCoefs(b, p.eq[b], SR).magnitudeDb(f0, SR);
                // bandas campana: ganancia a su frecuencia == ganancia pedida; shelves: plateau lejos de la esquina
                double target = (b == 0 || b == kBands - 1) ? ana : g;
                worst = std::max(worst, std::fabs(meas - target));
                if (b == 0) { const double pl = gainAt5(rk, p, 20.0); CHECK(std::fabs(pl - g) < 1.0, "low shelf: plateau a 20 Hz %.2f dB != %.1f", pl, g); }
                if (b == kBands - 1) { const double pl = gainAt5(rk, p, 20000.0); CHECK(std::fabs(pl - g) < 1.5, "high shelf: plateau a 20 kHz %.2f dB != %.1f", pl, g); }
                CHECK(std::fabs(meas - target) < 0.5, "banda %d g=%+.0f: medido %.2f dB, esperado %.2f dB", b + 1, g, meas, target);
            }
        }
        std::printf("      peor desviacion (6 bandas x +-9 dB): %.3f dB (limite 0.5)\n", worst);
        // Q coherente: ancho de banda entre los puntos de media ganancia (+12 dB campana a 1 kHz) ~ f0/Q
        for (const double Q : { 0.7, 2.0, 6.0 }) {
            FxParams p = porDefecto(); p.eqOn = true; p.eq[2].hz = 1000.0; p.eq[2].gainDb = 12.0; p.eq[2].q = Q;
            auto halfPoint = [&](bool up) {   // busca por biseccion la f con +6 dB (mitad de la ganancia)
                double lo = up ? 1000.0 : 100.0, hi = up ? 10000.0 : 1000.0;
                for (int it = 0; it < 18; ++it) {
                    const double mid = std::sqrt(lo * hi);
                    const double gdb = gainAt(rk, p, mid, SR, 0.4);
                    if (up) { if (gdb > 6.0) lo = mid; else hi = mid; } else { if (gdb > 6.0) hi = mid; else lo = mid; }
                }
                return std::sqrt(lo * hi);
            };
            const double fu = halfPoint(true), fd = halfPoint(false);
            const double qm = 1000.0 / (fu - fd);
            std::printf("      Q=%.1f: puntos de +6 dB en %.0f y %.0f Hz -> Q medido %.2f\n", Q, fd, fu, qm);
            CHECK(std::fabs(qm / Q - 1.0) < 0.25, "Q medido %.2f vs %.2f", qm, Q);
        }
        // filtros paso-altos / paso-bajos
        {
            FxParams p = porDefecto(); p.hpfOn = true; p.hpfHz = 1000.0; p.hpfSlope = 0;
            const double a = gainAt5(rk, p, 1000.0), c = gainAt5(rk, p, 500.0);
            p.hpfSlope = 1;
            const double a2 = gainAt5(rk, p, 1000.0), c2 = gainAt5(rk, p, 500.0);
            p = porDefecto(); p.lpfOn = true; p.lpfHz = 4000.0; p.lpfSlope = 1;
            const double l1 = gainAt5(rk, p, 4000.0), l2 = gainAt5(rk, p, 8000.0);
            std::printf("      HPF 1 kHz: 12 dB/oct f0=%.2f f0/2=%.2f | 24 dB/oct f0=%.2f f0/2=%.2f | LPF 24 dB/oct 4 kHz: f0=%.2f 2f0=%.2f\n", a, c, a2, c2, l1, l2);
            CHECK(std::fabs(a + 3.0) < 0.5 && std::fabs(c + 12.3) < 1.0, "HPF 12 dB/oct");
            CHECK(std::fabs(a2 + 3.0) < 0.5 && std::fabs(c2 + 24.1) < 1.5, "HPF 24 dB/oct");
            CHECK(std::fabs(l1 + 3.0) < 0.5 && std::fabs(l2 + 26.7) < 1.0, "LPF 24 dB/oct (alabeo bilineal a 2 f0)");
        }
        // EQ encendido con todas las bandas a 0 dB: transparente
        {
            FxParams p = porDefecto(); p.eqOn = true;
            std::vector<float> a(4800), b(4800), a0, b0;
            sine(a, 440.0, 0.3, SR); b = a; a0 = a; b0 = b;
            rk.reset(); rk.setParams(p, true);
            rk.process(a.data(), b.data(), 4800);
            double md = 0.0; for (size_t i = 0; i < a.size(); ++i) md = std::max(md, static_cast<double>(std::fabs(a[i] - a0[i])));
            CHECK(md == 0.0, "EQ con ganancias 0 no transparente (%g)", md);
        }
    }

    // ---- 7.3 compresor ----
    {
        std::printf("    compresor (sinusoide 1 kHz):\n");
        auto level = [&](const FxParams& p, double ampDb, float* grOut = nullptr) {
            const size_t N = static_cast<size_t>(2.0 * SR);
            std::vector<float> a(N), b;
            sine(a, 1000.0, std::pow(10.0, ampDb / 20.0), SR); b = a;
            rk.reset(); rk.setParams(p, true);
            for (size_t i = 0; i < N; i += 256) rk.process(a.data() + i, b.data() + i, 256);
            if (grOut) *grOut = rk.grDb();
            return db(peakOf(a, N * 3 / 4, N));
        };
        FxParams p = porDefecto(); p.compOn = true; p.compThreshDb = -20.0; p.compRatio = 4.0; p.compKneeDb = 0.0; p.compAttackMs = 0.5; p.compReleaseMs = 500.0;
        float gr = 0;
        const double o1 = level(p, -8.0, &gr);   // 12 dB sobre el umbral -> 9 dB de reduccion
        std::printf("      -8 dBFS, umbral -20, ratio 4:1: salida %.2f dBFS (esperado -17.0), GR medidor %.2f dB (esperado 9.0)\n", o1, gr);
        CHECK(std::fabs(o1 + 17.0) < 0.8, "compresor: salida %.2f dBFS", o1);
        CHECK(std::fabs(gr - 9.0) < 1.0, "medidor de GR %.2f", gr);
        p.compRatio = 10.0;
        const double o2 = level(p, -8.0);   // 12 -> 12*0.9 = 10.8 dB
        std::printf("      ratio 10:1: salida %.2f dBFS (esperado -18.8)\n", o2);
        CHECK(std::fabs(o2 + 18.8) < 0.8, "ratio 10:1 salida %.2f", o2);
        p.compRatio = 4.0; p.compThreshDb = -10.0;
        const double o3 = level(p, -8.0);   // 2 dB sobre -> 1.5 dB
        CHECK(std::fabs(o3 + 9.5) < 0.6, "umbral -10: salida %.2f (esperado -9.5)", o3);
        const double o4 = level(p, -30.0);   // bajo el umbral: intacto
        CHECK(std::fabs(o4 + 30.0) < 0.2, "por debajo del umbral debe quedar intacto (%.2f)", o4);
        p.compThreshDb = -20.0; p.compMakeupDb = 6.0;
        const double o5 = level(p, -8.0);
        CHECK(std::fabs(o5 - (o1 + 6.0)) < 0.5, "makeup +6 dB (%.2f vs %.2f)", o5, o1 + 6.0);
        p.compMakeupDb = 0.0; p.compMix = 0.0;
        CHECK(std::fabs(level(p, -8.0) + 8.0) < 0.05, "mezcla paralela 0 %% debe dejar la senal intacta");
        p.compMix = 0.5;
        const double o6 = level(p, -8.0);
        const double expMix = db(0.5 + 0.5 * std::pow(10.0, -9.0 / 20.0)) - 8.0;
        std::printf("      mezcla 50 %%: %.2f dBFS (esperado %.2f)\n", o6, expMix);
        CHECK(std::fabs(o6 - expMix) < 0.8, "mezcla paralela 50 %%");
        // rodilla: en el umbral la reduccion con rodilla > 0 es menor que sin ella y sube con la entrada
        p.compMix = 1.0; p.compKneeDb = 12.0; p.compThreshDb = -20.0;
        const double k0 = level(p, -20.0), k1 = level(p, -14.0), k2 = level(p, -8.0);
        std::printf("      rodilla 12 dB: salidas a -20/-14/-8 dBFS = %.2f / %.2f / %.2f\n", k0, k1, k2);
        CHECK(k0 < -20.0 && k0 > -21.5, "rodilla: reduccion en el umbral inesperada (%.2f)", k0);
        CHECK((k2 - k1) < 6.0 && (k1 - k0) < 6.0, "rodilla: la salida debe crecer menos que la entrada");
    }

    // ---- 7.4 saturacion: THD creciente con el drive; tipos ----
    {
        const size_t N = 1 << 16;
        const int bin = 1365;   // f = bin*SR/N ~ 1000 Hz (coherente: sin fuga)
        const double f0 = bin * SR / static_cast<double>(N);
        auto harmonics = [&](int type, double drive, double* h2, double* h3) {
            FxParams p = porDefecto(); p.satOn = true; p.satType = type; p.satDrive = drive; p.satToneHz = 20000.0;
            std::vector<float> a(N), b;
            sine(a, f0, 0.25, SR); b = a;
            rk.reset(); rk.setParams(p, true);
            for (size_t i = 0; i < N; i += 512) rk.process(a.data() + i, b.data() + i, 512);
            std::vector<std::complex<double>> z(N);
            for (size_t i = 0; i < N; ++i) z[i] = a[i] * (0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(N)));
            fftC(z);
            auto mag = [&](int k) { double m = 0; for (int j = -2; j <= 2; ++j) m = std::max(m, std::abs(z[static_cast<size_t>(k + j)])); return m; };
            const double fund = mag(bin);
            double thd = 0.0;
            for (int h = 2; h <= 9; ++h) { const double m = mag(bin * h); thd += m * m; }
            if (h2) *h2 = mag(bin * 2) / fund;
            if (h3) *h3 = mag(bin * 3) / fund;
            return std::sqrt(thd) / fund;
        };
        double prev = -1.0; bool crece = true;
        std::printf("    saturacion (cinta) THD 2..9 armonicos: ");
        for (const double d : { 0.1, 0.3, 0.5, 0.7, 1.0 }) {
            const double t = harmonics(0, d, nullptr, nullptr);
            std::printf("drive %.0f%%=%.2f%%  ", d * 100, t * 100.0);
            if (t <= prev) crece = false;
            prev = t;
        }
        std::printf("\n");
        CHECK(crece, "THD no crece con el drive");
        double h2t, h3t, h2v, h3v;
        harmonics(0, 0.6, &h2t, &h3t); harmonics(1, 0.6, &h2v, &h3v);
        std::printf("      cinta: H2=%.4f H3=%.4f | valvula: H2=%.4f H3=%.4f\n", h2t, h3t, h2v, h3v);
        CHECK(h3t > 10.0 * h2t, "cinta debe ser simetrica (armonicos impares)");
        CHECK(h2v > 0.01 && h2v > 3.0 * h2t, "valvula debe generar 2.o armonico");
        CHECK(harmonics(0, 0.0, nullptr, nullptr) < 0.01, "drive 0 deberia ser casi lineal a -12 dBFS");
    }

    // ---- 7.5 delay: tiempo, sync, feedback, ping-pong ----
    {
        auto echoes = [&](const FxParams& p, double bpm, size_t N, std::vector<float>& L, std::vector<float>& R) {
            L.assign(N, 0.0f); R.assign(N, 0.0f);
            L[100] = 1.0f;
            FxRack r; r.prepare(SR); r.setTempo(bpm); r.setParams(p, true);
            for (size_t i = 0; i < N; i += 256) r.process(L.data() + i, R.data() + i, static_cast<int>(std::min<size_t>(256, N - i)));
        };
        auto peakIdx = [&](const std::vector<float>& x, size_t from) { size_t bi = from; for (size_t i = from; i < x.size(); ++i) if (std::fabs(x[i]) > std::fabs(x[bi])) bi = i; return bi; };
        FxParams p = porDefecto(); p.dlOn = true; p.dlMix = 1.0; p.dlFeedback = 0.5; p.dlToneHz = 16000.0; p.dlTimeMs = 300.0;
        std::vector<float> L, R;
        echoes(p, 120.0, static_cast<size_t>(2 * SR), L, R);
        size_t e1 = peakIdx(L, 1000);
        std::printf("    delay: tiempo libre 300 ms -> eco en %.2f ms", (static_cast<double>(e1) - 100.0) / SR * 1000.0);
        CHECK(std::llabs(static_cast<long long>(e1) - 100 - 14400) <= 2, "tiempo del delay");
        // segundo eco ~ feedback
        std::vector<float> tmp(L.begin() + static_cast<long>(e1) + 2000, L.end());
        const size_t e2 = peakIdx(tmp, 0) + e1 + 2000;
        std::printf(", 2.o eco a %.1f ms con razon %.2f (fb 0.50)\n", (static_cast<double>(e2) - 100.0) / SR * 1000.0, std::fabs(L[e2]) / std::fabs(L[e1]));
        CHECK(std::llabs(static_cast<long long>(e2 - e1) - 14400) <= 3, "periodo de repeticion");
        CHECK(std::fabs(L[e2]) / std::fabs(L[e1]) > 0.35 && std::fabs(L[e2]) / std::fabs(L[e1]) < 0.55, "feedback");
        // sincronia: 120 bpm -> 1/4 = 500 ms, 1/8 = 250, 1/8. = 375, 1/16 = 125
        const int sy[4] = { 1, 2, 3, 4 };
        const double ms[4] = { 500.0, 250.0, 375.0, 125.0 };
        for (int k = 0; k < 4; ++k) {
            FxParams q = p; q.dlSync = sy[k]; q.dlFeedback = 0.0;
            echoes(q, 120.0, static_cast<size_t>(1.5 * SR), L, R);
            e1 = peakIdx(L, 1000);
            const double got = (static_cast<double>(e1) - 100.0) / SR * 1000.0;
            std::printf("      sync %s @120 bpm: %.2f ms (esperado %.0f)\n", labelsSync()[sy[k]], got, ms[k]);
            CHECK(std::fabs(got - ms[k]) < 0.1, "sync %d: %.3f ms vs %.0f", sy[k], got, ms[k]);
        }
        { FxParams q = p; q.dlSync = 1; q.dlFeedback = 0.0;
          echoes(q, 90.0, static_cast<size_t>(1.5 * SR), L, R);
          const double got = (static_cast<double>(peakIdx(L, 1000)) - 100.0) / SR * 1000.0;
          CHECK(std::fabs(got - 666.667) < 0.1, "sync 1/4 @90 bpm: %.2f ms", got); }
        // ping-pong: eco 1 en L, eco 2 en R
        { FxParams q = p; q.dlPingPong = true; q.dlFeedback = 0.6;
          echoes(q, 120.0, static_cast<size_t>(2 * SR), L, R);
          const size_t t1 = 100 + 14400, t2 = 100 + 28800;
          std::printf("      ping-pong: L@T=%.3f R@T=%.3f R@2T=%.3f L@2T=%.3f\n", L[t1], R[t1], R[t2], L[t2]);
          CHECK(std::fabs(L[t1]) > 0.2 && std::fabs(R[t1]) < 1e-4 && std::fabs(R[t2]) > 0.05 && std::fabs(L[t2]) < 1e-4, "ping-pong"); }
        // mezcla 0 = intacto
        { FxParams q = p; q.dlMix = 0.0; echoes(q, 120.0, 4800, L, R); CHECK(L[100] == 1.0f && std::fabs(L[2000]) == 0.0f, "delay mix 0"); }
    }

    // ---- 7.6 reverb: estabilidad a 60 s, decaimiento, orden de tipos/tamano ----
    {
        auto impulseEnergy = [&](int type, double size, double damp, std::vector<double>& h) {
            FxParams p = porDefecto(); p.rvOn = true; p.rvType = type; p.rvSize = size; p.rvDamping = damp; p.rvMix = 1.0; p.rvPreDelayMs = 0.0;
            FxRack r; r.prepare(SR); r.setParams(p, true);
            const size_t N = static_cast<size_t>(30 * SR);
            std::vector<float> L(N, 0.0f), R(N, 0.0f); L[0] = R[0] = 1.0f;
            for (size_t i = 0; i < N; i += 512) r.process(L.data() + i, R.data() + i, static_cast<int>(std::min<size_t>(512, N - i)));
            h.resize(N);
            for (size_t i = 0; i < N; ++i) h[i] = 0.5 * (L[i] + R[i]);
            return true;
        };
        auto rt60 = [&](const std::vector<double>& h) {   // integral de Schroeder, ajuste T20 (-5..-25 dB) extrapolado a 60 dB
            std::vector<double> e(h.size());
            double acc = 0.0;
            for (size_t i = h.size(); i-- > 0;) { acc += h[i] * h[i]; e[i] = acc; }
            double t5 = -1, t25 = -1;
            for (size_t i = 0; i < e.size(); ++i) { const double d = 10.0 * std::log10(e[i] / e[0] + 1e-30); if (t5 < 0 && d <= -5.0) t5 = static_cast<double>(i) / SR; if (t25 < 0 && d <= -25.0) { t25 = static_cast<double>(i) / SR; break; } }
            return (t5 > 0 && t25 > 0) ? 3.0 * (t25 - t5) : -1.0;
        };
        std::vector<double> h;
        double r[3][2];
        const char* nm[3] = { "plate", "hall", "room" };
        std::printf("    reverb RT60 medido (T20x3, damping 30 %%): ");
        for (int t = 0; t < 3; ++t) for (int s = 0; s < 2; ++s) { impulseEnergy(t, s == 0 ? 0.2 : 0.8, 0.3, h); r[t][s] = rt60(h); }
        for (int t = 0; t < 3; ++t) std::printf("%s tamano20%%=%.2fs 80%%=%.2fs  ", nm[t], r[t][0], r[t][1]);
        std::printf("\n");
        for (int t = 0; t < 3; ++t) CHECK(r[t][0] > 0.0 && r[t][1] > r[t][0] * 1.3, "reverb %s: el RT60 debe crecer con el tamano", nm[t]);
        CHECK(r[2][1] < r[0][1] && r[0][1] < r[1][1], "orden de RT60 room < plate < hall (tamano 80%%)");
        // la cola desaparece
        impulseEnergy(1, 1.0, 0.0, h);
        double tail = 0.0, head = 0.0;
        for (size_t i = 0; i < h.size(); ++i) { if (i < static_cast<size_t>(5 * SR)) head += h[i] * h[i]; if (i > static_cast<size_t>(25 * SR)) tail += h[i] * h[i]; }
        std::printf("      hall 100 %% sin damping: energia 25..30 s frente a 0..5 s = %.1f dB\n", 10.0 * std::log10(tail / head + 1e-30));
        CHECK(10.0 * std::log10(tail / head + 1e-30) < -40.0, "la cola debe extinguirse");
        // estabilidad: ruido continuo 60 s
        {
            FxParams p = porDefecto(); p.rvOn = true; p.rvType = 1; p.rvSize = 1.0; p.rvDamping = 0.0; p.rvMix = 1.0;
            FxRack rv; rv.prepare(SR); rv.setParams(p, true);
            XorT rng; rng.seed(77);
            const size_t N = static_cast<size_t>(60 * SR);
            std::vector<float> L(512), R(512);
            double e1 = 0, e2 = 0, mx = 0; size_t c1 = 0, c2 = 0; bool fin = true;
            for (size_t i = 0; i < N; i += 512) {
                for (int k = 0; k < 512; ++k) { L[k] = static_cast<float>(0.1 * rng.bi()); R[k] = static_cast<float>(0.1 * rng.bi()); }
                rv.process(L.data(), R.data(), 512);
                for (int k = 0; k < 512; ++k) {
                    if (!std::isfinite(L[k]) || !std::isfinite(R[k])) fin = false;
                    mx = std::max(mx, static_cast<double>(std::fabs(L[k])));
                    const double e = static_cast<double>(L[k]) * L[k];
                    if (i > static_cast<size_t>(10 * SR) && i < static_cast<size_t>(20 * SR)) { e1 += e; ++c1; }
                    if (i > static_cast<size_t>(50 * SR)) { e2 += e; ++c2; }
                }
            }
            const double d = 10.0 * std::log10((e2 / c2) / (e1 / c1));
            std::printf("      ruido continuo 60 s (hall 100 %%, damping 0, mezcla 100 %%): finito=%d, pico=%.3f, RMS 50..60 s frente a 10..20 s = %+.2f dB\n", fin ? 1 : 0, mx, d);
            CHECK(fin, "NaN en la reverb");
            CHECK(std::fabs(d) < 1.5 && mx < 2.0, "la reverb crece o es inestable");
        }
    }

    // ---- 7.7 chorus ----
    {
        FxParams p = porDefecto(); p.chOn = true; p.chDepth = 1.0; p.chMix = 1.0; p.chRateHz = 1.0;
        const size_t N = static_cast<size_t>(4 * SR);
        std::vector<float> a(N), b(N);
        sine(a, 2000.0, 0.2, SR); b = a;
        FxRack r; r.prepare(SR); r.setParams(p, true);
        for (size_t i = 0; i < N; i += 512) r.process(a.data() + i, b.data() + i, 512);
        // envolvente en ventanas de 10 ms: la modulacion de fase entre voces produce batido
        double mn = 1e9, mx = 0;
        for (size_t i = N / 4; i + 480 < N; i += 480) { const double v = rmsOf(a, i, i + 480); mn = std::min(mn, v); mx = std::max(mx, v); }
        const double rip = db(mx / mn);
        // decorrelacion L/R con ruido
        XorT rng; rng.seed(3);
        std::vector<float> nl(N), nr(N);
        for (size_t i = 0; i < N; ++i) nl[i] = nr[i] = static_cast<float>(0.2 * rng.bi());
        r.reset(); r.setParams(p, true);
        for (size_t i = 0; i < N; i += 512) r.process(nl.data() + i, nr.data() + i, 512);
        double sl = 0, sr2 = 0, slr = 0;
        for (size_t i = N / 2; i < N; ++i) { sl += nl[i] * nl[i]; sr2 += nr[i] * nr[i]; slr += nl[i] * nr[i]; }
        const double cor = slr / std::sqrt(sl * sr2);
        std::printf("    chorus (profundidad 100 %%): ondulacion de envolvente %.2f dB, correlacion L/R de ruido mono = %.2f\n", rip, cor);
        CHECK(rip > 0.5, "chorus sin modulacion perceptible");
        CHECK(cor < 0.95, "chorus sin ensanchamiento estereo");
        p.chMix = 0.0;
        std::vector<float> c(4800), d(4800), c0;
        sine(c, 1000.0, 0.3, SR); d = c; c0 = c;
        r.reset(); r.setParams(p, true); r.process(c.data(), d.data(), 4800);
        double md = 0; for (size_t i = 0; i < c.size(); ++i) md = std::max(md, static_cast<double>(std::fabs(c[i] - c0[i])));
        CHECK(md < 1e-6, "chorus mezcla 0 no transparente (%g)", md);
    }

    // ---- 7.8 barrido de estabilidad: sr x bloque x parametros extremos con automatizacion ----
    {
        long bad = 0; int runs = 0;
        for (const double r : { 44100.0, 48000.0, 96000.0, 192000.0 }) {
            for (const int blk : { 1, 7, 64, 480, 4096 }) {
                FxRack rk2; rk2.prepare(r); rk2.setTempo(60.0 + 40.0 * (runs % 4));
                XorT rng; rng.seed(1000 + runs);
                const size_t N = static_cast<size_t>(r * 2.0);
                std::vector<float> L(static_cast<size_t>(blk)), R(static_cast<size_t>(blk));
                size_t done = 0; int step = 0;
                while (done < N) {
                    FxParams p = porDefecto();
                    p.hpfOn = p.lpfOn = p.eqOn = p.compOn = p.satOn = p.chOn = p.dlOn = p.rvOn = p.outOn = true;
                    const double u = (step % 7) / 6.0;
                    p.hpfHz = 20.0 + 900.0 * u; p.hpfSlope = step & 1; p.lpfHz = 20000.0 - 18000.0 * u; p.lpfSlope = (step >> 1) & 1;
                    for (int b = 0; b < kBands; ++b) { p.eq[b].hz = (b == 0 ? 30.0 : 100.0) * std::pow(100.0, (u + b * 0.17) - std::floor(u + b * 0.17)); p.eq[b].gainDb = (b & 1) ? 18.0 : -18.0; p.eq[b].q = (b == 0 || b == 5) ? 2.0 : (u > 0.5 ? 10.0 : 0.1); }
                    p.compThreshDb = -60.0; p.compRatio = 20.0; p.compAttackMs = 0.1; p.compReleaseMs = 10.0; p.compKneeDb = 24.0 * u; p.compMakeupDb = 12.0;
                    p.satDrive = 1.0; p.satType = step & 1; p.chDepth = 1.0; p.chRateHz = 5.0;
                    p.dlSync = step % 5; p.dlTimeMs = 20.0 + 1900.0 * u; p.dlFeedback = 0.9; p.dlPingPong = (step & 2) != 0; p.dlMix = 1.0;
                    p.rvType = step % 3; p.rvSize = u; p.rvDamping = 1.0 - u; p.rvPreDelayMs = 200.0 * u; p.rvMix = 1.0;
                    p.outWidth = 2.0; p.outGainDb = 12.0;
                    rk2.setParams(p);
                    for (int k = 0; k < blk; ++k) { L[static_cast<size_t>(k)] = static_cast<float>(0.5 * rng.bi()); R[static_cast<size_t>(k)] = static_cast<float>(0.5 * rng.bi()); }
                    for (int k = 0; k < 9; ++k) rk2.probe[k] = 0.0;
                    for (int k = 0; k < 9; ++k) rk2.probe[k] = 0.0;
                    rk2.process(L.data(), R.data(), blk);
                    for (int k = 0; k < blk; ++k) if (!std::isfinite(L[static_cast<size_t>(k)]) || !std::isfinite(R[static_cast<size_t>(k)]) || std::fabs(L[static_cast<size_t>(k)]) > 3000.0f) { if (bad == 0) { std::printf("      sondas:"); for (int q_ = 0; q_ < 9; ++q_) std::printf(" %g", rk2.probe[q_]); std::printf("\n"); }
                    if (bad == 0) std::printf("      primera muestra mala: sr=%.0f bloque=%d paso=%d k=%d L=%g R=%g\n", r, blk, step, k, static_cast<double>(L[static_cast<size_t>(k)]), static_cast<double>(R[static_cast<size_t>(k)])); ++bad; }
                    done += static_cast<size_t>(blk);
                    if (blk < 64 ? (step % 1000 == 999) : true) ++step;
                    else if (blk < 64 && (done % 4800) < static_cast<size_t>(blk)) ++step;
                }
                bad += rk2.fallos();
                ++runs;
            }
        }
        std::printf("    barrido sr(44.1..192 kHz) x bloque(1..4096) x parametros extremos automatizados (%d pasadas): muestras malas=%ld\n", runs, bad);
        CHECK(bad == 0, "NaN/inf/desbordes en el rack");
    }

    // ---- 7.9 sin clics al activar/desactivar bloques ----
    {
        FxParams off = porDefecto(), on = porDefecto();
        on.eqOn = true; on.eq[0].gainDb = 12.0; on.compOn = true; on.compThreshDb = -30; on.compRatio = 8;
        const size_t N = static_cast<size_t>(1.0 * SR);
        std::vector<float> a(N), b;
        sine(a, 220.0, 0.5, SR); b = a;
        FxRack r; r.prepare(SR); r.setParams(off, true);
        double maxD = 0.0; float last = 0.0f;
        for (size_t i = 0; i < N; i += 256) {
            if (i == 128 * 256) r.setParams(on);
            if (i == 160 * 256) r.setParams(off);
            r.process(a.data() + i, b.data() + i, 256);
        }
        for (size_t i = 0; i < N; ++i) { maxD = std::max(maxD, static_cast<double>(std::fabs(a[i] - last))); last = a[i]; }
        const double ideal = 2.0 * kPi * 220.0 / SR * 0.5 * 4.0;   // pendiente maxima de la sinusoide x 4 (ganancia posible del EQ)
        std::printf("    conmutacion de bloques en caliente: salto maximo entre muestras %.4f (limite %.4f)\n", maxD, ideal);
        CHECK(maxD < ideal, "clic al activar/desactivar");
    }

    // ---- 7.10 CPU con TODO activo ----
    {
        FxParams p = porDefecto();
        p.hpfOn = p.lpfOn = p.eqOn = p.compOn = p.satOn = p.chOn = p.dlOn = p.rvOn = p.outOn = true;
        p.hpfSlope = p.lpfSlope = 1;
        for (int b = 0; b < kBands; ++b) p.eq[b].gainDb = (b & 1) ? 4.0 : -4.0;
        p.dlPingPong = true; p.compThreshDb = -30.0;
        for (const double sr : { 48000.0, 96000.0 }) {
            FxRack r; r.prepare(sr); r.setParams(p, true);
            XorT rng; rng.seed(9);
            const size_t N = static_cast<size_t>(10 * sr);
            std::vector<float> L(512), R(512);
            double best = 1e9;
            for (int rep = 0; rep < 3; ++rep) {
                const double t0 = cpuSeconds();
                for (size_t i = 0; i < N; i += 512) {
                    for (int k = 0; k < 512; ++k) { L[static_cast<size_t>(k)] = static_cast<float>(0.2 * rng.bi()); R[static_cast<size_t>(k)] = static_cast<float>(0.2 * rng.bi()); }
                    r.process(L.data(), R.data(), 512);
                }
                best = std::min(best, cpuSeconds() - t0);
            }
            // se descuenta la generacion de ruido
            double base = 1e9;
            for (int rep = 0; rep < 3; ++rep) {
                const double t0 = cpuSeconds();
                for (size_t i = 0; i < N; i += 512) for (int k = 0; k < 512; ++k) { L[static_cast<size_t>(k)] = static_cast<float>(0.2 * rng.bi()); R[static_cast<size_t>(k)] = static_cast<float>(0.2 * rng.bi()); }
                base = std::min(base, cpuSeconds() - t0);
            }
            const double pct = 100.0 * (best - base) / 10.0;
            std::printf("    CPU rack completo (9 bloques activos, estereo) a %.0f kHz: %.2f %% de un nucleo\n", sr / 1000.0, pct);
            if (sr == 48000.0) {   // desglose por bloque (informativo)
                const char* nmB[9] = { "HPF+LPF", "EQ", "comp", "sat", "chorus", "delay", "reverb", "out", "nada" };
                std::printf("      desglose %%:");
                for (int bI = 0; bI < 9; ++bI) {
                    FxParams q = porDefecto();
                    q.hpfOn = q.lpfOn = (bI == 0); q.eqOn = (bI == 1); q.compOn = (bI == 2); q.satOn = (bI == 3); q.chOn = (bI == 4); q.dlOn = (bI == 5); q.rvOn = (bI == 6); q.outOn = (bI == 7);
                    for (int b = 0; b < kBands; ++b) q.eq[b].gainDb = (b & 1) ? 4.0 : -4.0;
                    q.compThreshDb = -30.0;
                    FxRack r2; r2.prepare(sr); r2.setParams(q, true);
                    double bt = 1e9;
                    for (int rep = 0; rep < 3; ++rep) {
                        const double t0 = cpuSeconds();
                        for (size_t i = 0; i < N; i += 512) {
                            for (int k = 0; k < 512; ++k) { L[static_cast<size_t>(k)] = static_cast<float>(0.2 * rng.bi()); R[static_cast<size_t>(k)] = static_cast<float>(0.2 * rng.bi()); }
                            r2.process(L.data(), R.data(), 512);
                        }
                        bt = std::min(bt, cpuSeconds() - t0);
                    }
                    std::printf(" %s=%.2f", nmB[bI], 100.0 * (bt - base) / 10.0);
                }
                std::printf("\n");
            }
            if (sr == 48000.0) CHECK(pct < 4.0, "CPU del rack %.2f %% >= 4 %% (%.0f Hz)", pct, sr);   // a 96 kHz el coste escala x2 (informativo)
        }
    }

    // ---- 7.10b soporte float y double: misma salida (la cadena trabaja en double) ----
    {
        FxParams p = porDefecto();
        p.hpfOn = p.eqOn = p.compOn = p.satOn = p.chOn = p.dlOn = p.rvOn = p.outOn = true;
        p.eq[2].gainDb = 6.0; p.compThreshDb = -30.0; p.dlTimeMs = 120.0; p.rvMix = 0.3;
        const size_t N = 24000;
        std::vector<float> af(N), bf(N);
        std::vector<double> ad(N), bd(N);
        XorT rng; rng.seed(21);
        for (size_t i = 0; i < N; ++i) { af[i] = bf[i] = static_cast<float>(0.2 * rng.bi()); ad[i] = bd[i] = static_cast<double>(af[i]); }
        FxRack r32; r32.prepare(SR); r32.setParams(p, true);
        FxRack r64; r64.prepare(SR); r64.setParams(p, true);
        for (size_t i = 0; i < N; i += 333) {
            const int n = static_cast<int>(std::min<size_t>(333, N - i));
            r32.process(af.data() + i, bf.data() + i, n);
            r64.process(ad.data() + i, bd.data() + i, n);
        }
        double md = 0.0;
        for (size_t i = 0; i < N; ++i) md = std::max(md, std::fabs(static_cast<double>(af[i]) - ad[i]));
        std::printf("    float vs double (cadena completa): diferencia maxima %.2e\n", md);
        CHECK(md < 1.0e-4, "float y double difieren (%g)", md);
    }

    // ---- 7.11 motor: con todo encendido sigue siendo finito y acotado; el rack va DESPUES de la cadena propia ----
    {
        GuitarEngine e; e.prepare(SR, 512); e.setSettings(GuitarSettings{});
        FxParams q = porDefecto(); q.hpfOn = q.eqOn = q.compOn = q.satOn = q.chOn = q.dlOn = q.rvOn = q.outOn = true;
        q.eq[1].gainDb = 8.0; q.outGainDb = -6.0;
        e.setFx(q);
        GuitarBus bus;
        const size_t N = static_cast<size_t>(6 * SR);
        std::vector<float> L(N, 0.0f), R(N, 0.0f);
        e.noteOn(50, 0.8f); e.noteOn(57, 0.8f); e.noteOn(66, 0.8f);
        for (size_t i = 0; i < N; i += 512) e.render(L.data() + i, R.data() + i, static_cast<int>(std::min<size_t>(512, N - i)), &bus);
        bool fin = true; for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i]) || std::fabs(L[i]) > 1.0f) fin = false;
        std::printf("    motor con rack completo: finito y |x|<=1 = %d, GR publicado en el bus = %.2f dB\n", fin ? 1 : 0, bus.fxGrDb.load());
        CHECK(fin, "motor + rack no finito");
        // el tempo del host llega al rack: delay 1/4 sincronizado; a 120 y a 60 bpm la salida debe ser distinta, y a 120 bpm igual al rack suelto
        auto renderTempo = [&](double bpm) {
            GuitarEngine d; d.prepare(SR, 512); GuitarSettings sd = dry(); d.setSettings(sd);
            FxParams pd = porDefecto(); pd.dlOn = true; pd.dlSync = 1; pd.dlMix = 1.0; pd.dlFeedback = 0.0; pd.dlToneHz = 16000.0;
            d.setFx(pd); d.setTempo(bpm);
            std::vector<float> dl(static_cast<size_t>(2 * SR)), dr(dl.size());
            d.noteOn(64, 1.0f);
            for (size_t i = 0; i < dl.size(); i += 512) d.render(dl.data() + i, dr.data() + i, static_cast<int>(std::min<size_t>(512, dl.size() - i)), nullptr);
            return dl;
        };
        const auto t120 = renderTempo(120.0), t60 = renderTempo(60.0), t120b = renderTempo(120.0);
        double dif = 0.0; for (size_t i = 0; i < t120.size(); ++i) dif = std::max(dif, static_cast<double>(std::fabs(t120[i] - t60[i])));
        std::printf("    tempo del host al rack: diferencia maxima 120 vs 60 bpm = %.4f, repetibilidad 120 bpm = %s\n", dif, t120 == t120b ? "identica" : "DISTINTA");
        CHECK(dif > 0.01, "el tempo no llega al delay sincronizado del rack");
        CHECK(t120 == t120b, "render no determinista");
    }
}

int main(int argc, char** argv) {
    JasWaveDsp::ScopedNoDenormals noDenormals;   // igual que JwProcessor::process en el plugin
    const std::string out = argc > 1 && std::strncmp(argv[1], "--", 2) != 0 ? argv[1] : ".";
    if (argc > 1 && std::strcmp(argv[argc - 1], "--samples") == 0) return sampledTest(out);
    // La suite modelada comprueba el respaldo sin banco: se aparta la carpeta de samples.
#ifdef _WIN32
    _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
#else
    setenv("JASWAVE_SAMPLES_DIR", "__sin_samples__", 1);
#endif
    const double rates[] = { 44100, 48000, 96000, 192000 };
    const int notes[] = { 40, 45, 50, 55, 59, 64, 69, 76, 88 };   // E2 A2 D3 G3 B3 E4 A4 E5 E6

    std::printf("== 1. Afinacion por nota (cents vs 440 Hz) a 44.1/48/96/192 kHz ==\n");
    std::printf("%-8s", "nota");
    for (double r : rates) std::printf("%10.0f", r);
    std::printf("\n");
    double worst = 0;
    for (int n : notes) {
        std::printf("%-8d", n);
        for (double sr : rates) {
            GuitarEngine g; g.prepare(sr, 512); g.setSettings(dry());
            std::vector<Ev> ev = { { 0.0, 0, n, 0.8f } };
            auto x = renderSeq(g, sr, ev, 1.6, 512);
            const double fe = GuitarEngine::midiToHz(n);
            const size_t a = static_cast<size_t>(0.25 * sr);
            const size_t len = static_cast<size_t>(0.25 * sr);
            const double f = estimateF0(x, sr, a, len, fe);
            const double cents = 1200.0 * std::log2(f / fe);
            worst = std::max(worst, std::fabs(cents));
            CHECK(finiteAll(x), "NaN en nota %d a %.0f", n, sr);
            std::printf("%+10.2f", cents);
        }
        std::printf("\n");
    }
    std::printf("peor desviacion: %.2f cents\n", worst);
    CHECK(worst < 5.0, "afinacion peor que 5 cents (%.2f)", worst);

    std::printf("== 2. Seguridad: todas las tasas, bloques 1..4096, FX al maximo, delay 2 s, bend -12 ==\n");
    for (double sr : { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 }) {
        for (int block : { 1, 7, 64, 333, 4096 }) {
            GuitarEngine g; g.prepare(sr, block);
            GuitarSettings s; s.ampGain = 1.0; s.chorusMix = 1.0; s.delayMix = 1.0; s.delayFb = 0.95; s.reverbMix = 1.0; s.delayDiv = 4;
            s.delayTimeMs = 2000.0; s.bendRange = 12; s.sustain = 1.0; s.strum = 1.0;
            g.setSettings(s);
            std::vector<Ev> ev;
            ev.push_back({ 0.0, 2, 0, -1.0f }); ev.push_back({ 0.0, 3, 0, 1.0f });
            chord(ev, 0.0, 0.5, { 40, 47, 52, 56, 59, 64 }, 1.0f);
            chord(ev, 0.7, 0.5, { 28, 35, 40, 88, 100, 108 }, 1.0f);
            ev.push_back({ 1.0, 2, 0, 1.0f });
            const double secs = block == 1 ? 0.3 : 3.0;
            auto x = renderSeq(g, sr, ev, secs, block);
            CHECK(finiteAll(x), "NaN sr=%.0f block=%d", sr, block);
            CHECK(peakOf(x) < 1.0, "pico >= 1 sr=%.0f block=%d", sr, block);
        }
        std::printf("  sr %.0f OK (retardo maximo %.0f muestras)\n", sr, 2.0 * sr);
    }

    std::printf("== 3. Nivel por ganancia de amp (acorde Dsus2, fx off) ==\n");
    for (double gain : { 0.0, 0.25, 0.45, 0.7, 1.0 }) {
        GuitarEngine g; g.prepare(48000, 512);
        GuitarSettings s = dry(); s.ampGain = gain; g.setSettings(s);
        std::vector<Ev> ev; chord(ev, 0.0, 2.0, { 50, 57, 62, 64, 69 }, 0.8f);
        auto x = renderSeq(g, 48000, ev, 3.0, 512);
        const double r = rmsOf(x, 4800, 96000);
        std::printf("  gain %3.0f%%  pico %.3f  rms %.1f dBFS\n", gain * 100, peakOf(x), 20 * std::log10(r + 1e-12));
        CHECK(r > 0.01 && peakOf(x) < 0.99, "nivel fuera de rango con ganancia %.2f", gain);
    }

    std::printf("== 4. Pantalla 4x12 (respuesta de la cadena) ==\n");
    {
        GuitarEngine g; g.prepare(48000, 512); g.setSettings(dry());
        double pk = -99, pkf = 0;
        for (double f = 40; f < 300; f *= 1.02) { const double d = g.cabResponseDb(f); if (d > pk) { pk = d; pkf = f; } }
        const double d1k = g.cabResponseDb(1000), d5k = g.cabResponseDb(5000), d10k = g.cabResponseDb(10000), d50 = g.cabResponseDb(50);
        std::printf("  pico graves %.1f dB @ %.0f Hz; 1k %.1f; 5k %.1f; 10k %.1f; 50 Hz %.1f dB\n", pk, pkf, d1k, d5k, d10k, d50);
        CHECK(pkf > 85 && pkf < 130 && pk - d1k > 2.0, "resonancia ~100 Hz ausente");
        CHECK(d1k - d5k > 3.0 && d5k - d10k > 12.0, "caida ~5 kHz insuficiente");
    }

    std::printf("== 5. Chorus real (modulacion de retardo, no tremolo) ==\n");
    {
        Chorus c; c.prepare(48000);
        const double sr = 48000, f = 1000;
        std::vector<double> w(static_cast<size_t>(sr * 4));
        for (size_t i = 0; i < w.size(); ++i) { double l, r; c.process(std::sin(2 * kPi * f * i / sr), l, r); w[i] = l; }
        double fmin = 1e9, fmax = 0, emin = 1e9, emax = 0;
        std::vector<double> zc;
        for (size_t i = 48000; i + 1 < w.size(); ++i)
            if (w[i] <= 0 && w[i + 1] > 0) zc.push_back(i + (-w[i]) / (w[i + 1] - w[i]));
        for (size_t k = 0; k + 8 < zc.size(); ++k) { const double fi = 8.0 * sr / (zc[k + 8] - zc[k]); fmin = std::min(fmin, fi); fmax = std::max(fmax, fi); }
        for (size_t i = 48000; i + 240 < w.size(); i += 240) { double p = 0; for (size_t j = 0; j < 240; ++j) p = std::max(p, std::fabs(w[i + j])); emin = std::min(emin, p); emax = std::max(emax, p); }
        std::printf("  f instantanea: %.1f..%.1f Hz (desviacion %.2f%%); envolvente %.3f..%.3f\n", fmin, fmax, 100 * (fmax - fmin) / f, emin, emax);
        CHECK((fmax - fmin) / f > 0.004, "el chorus no modula el tono");
        CHECK(emin > 0.9 && emax < 1.1, "el chorus modula la amplitud (tremolo)");
    }

    std::printf("== 6. Delay sincronizado al tempo (120 BPM) ==\n");
    {
        const double sr = 48000;
        const char* names[] = { "1/8 dotted", "1/4", "1/8", "1/16" };
        const double expectMs[] = { 375.0, 500.0, 250.0, 125.0 };
        for (int d = 0; d < 4; ++d) {
            GuitarEngine g; g.prepare(sr, 512);
            GuitarSettings s = dry(); s.delayMix = 1.0; s.delayFb = 0.5; s.delayDiv = d; s.delayTimeMs = 777;
            g.setSettings(s); g.setTempo(120.0);
            std::printf("  %-11s -> %.2f ms (esperado %.1f)\n", names[d], g.delayMs(), expectMs[d]);
            CHECK(std::fabs(g.delayMs() - expectMs[d]) < 0.5, "delay sincronizado incorrecto (%s)", names[d]);
        }
        GuitarEngine g; g.prepare(sr, 512); GuitarSettings s = dry(); s.delayDiv = 0; s.delayTimeMs = 600; g.setSettings(s);
        g.setTempo(0.0);
        std::printf("  sin tempo: %.1f ms (fallback a delay_time 600)\n", g.delayMs());
        CHECK(std::fabs(g.delayMs() - 600) < 0.5, "fallback a ms");
        // ping-pong: pulso -> primer eco a T en L, segundo a 2T en R
        PingPongDelay p; p.prepare(sr); p.setFeedback(0.6); p.jumpTimeSamples(0.25 * sr);
        double eL[5] = {}, eR[5] = {};
        for (int i = 0; i < static_cast<int>(sr * 1.3); ++i) {
            double l, r; p.process(i == 0 ? 1.0 : 0.0, l, r);
            const int k = static_cast<int>(std::lround(i / (0.25 * sr)));
            if (k >= 0 && k < 5 && std::fabs(i - k * 0.25 * sr) < 40) { eL[k] = std::max(eL[k], std::fabs(l)); eR[k] = std::max(eR[k], std::fabs(r)); }
        }
        std::printf("  ping-pong: L=[%.2f %.2f %.2f %.2f] R=[%.2f %.2f %.2f %.2f] (ecos 1..4)\n", eL[1], eL[2], eL[3], eL[4], eR[1], eR[2], eR[3], eR[4]);
        CHECK(eL[1] > 0.5 && eR[1] < 0.05 && eR[2] > 0.1 && eL[2] < 0.05, "ping-pong no alterna");
    }

    std::printf("== 7. Pitch bend, vibrato, palm mute, sustain acotado ==\n");
    {
        const double sr = 48000;
        for (int rng : { 2, 12 }) {
            GuitarEngine g; g.prepare(sr, 512);
            GuitarSettings s = dry(); s.bendRange = rng; g.setSettings(s);
            std::vector<Ev> ev = { { 0.0, 0, 57, 0.8f }, { 0.9, 2, 0, 1.0f } };
            auto x = renderSeq(g, sr, ev, 2.4, 512);
            const double f0 = estimateF0(x, sr, static_cast<size_t>(0.35 * sr), static_cast<size_t>(0.2 * sr), 220.0);
            const double f1 = estimateF0(x, sr, static_cast<size_t>(1.4 * sr), static_cast<size_t>(0.2 * sr), 220.0 * std::pow(2.0, rng / 12.0));
            std::printf("  bend +%d st: %.2f Hz -> %.2f Hz (error %.1f cents)\n", rng, f0, f1, 1200 * std::log2(f1 / f0) - rng * 100);
            CHECK(std::fabs(1200 * std::log2(f1 / f0) - rng * 100) < 12.0, "bend +%d inexacto", rng);
        }
        {
            GuitarEngine g; g.prepare(sr, 512); g.setSettings(dry());
            std::vector<Ev> ev = { { 0.0, 0, 52, 0.8f }, { 0.0, 3, 0, 1.0f } };
            auto x = renderSeq(g, sr, ev, 2.0, 512);
            double mn = 1e9, mx = 0;
            for (double t = 0.3; t < 1.2; t += 0.04) { const double f = estimateF0(x, sr, static_cast<size_t>(t * sr), 3000, 164.81, 0.012); mn = std::min(mn, f); mx = std::max(mx, f); }
            std::printf("  vibrato CC1=127: %.2f..%.2f Hz (%.0f cents pico a pico)\n", mn, mx, 1200 * std::log2(mx / mn));
            CHECK(1200 * std::log2(mx / mn) > 25, "vibrato ausente");
        }
        GuitarEngine a; a.prepare(sr, 512); a.setSettings(dry());
        GuitarEngine b; b.prepare(sr, 512); b.setSettings(dry());
        auto xa = renderSeq(a, sr, { { 0.0, 0, 45, 0.8f }, { 0.08, 1, 45, 0 } }, 1.0, 512);
        auto xb = renderSeq(b, sr, { { 0.0, 0, 45, 0.8f }, { 0.9, 1, 45, 0 } }, 1.0, 512);
        const double ra = rmsOf(xa, 24000, 36000), rb = rmsOf(xb, 24000, 36000);
        std::printf("  palm mute: RMS 500-750 ms  corta %.1f dBFS vs larga %.1f dBFS\n", 20 * std::log10(ra + 1e-12), 20 * std::log10(rb + 1e-12));
        CHECK(ra < rb * 0.05, "palm mute no amortigua");
        GuitarEngine c; c.prepare(sr, 512); GuitarSettings sc = dry(); sc.sustain = 1.0; c.setSettings(sc);
        auto xc = renderSeq(c, sr, { { 0.0, 0, 64, 0.9f } }, 30.0, 512);
        GuitarEngine d; d.prepare(sr, 512); d.setSettings(dry());
        auto xd = renderSeq(d, sr, { { 0.0, 0, 64, 0.9f } }, 30.0, 512);
        auto at = [&](const std::vector<float>& v, double t) { return 20 * std::log10(rmsOf(v, static_cast<size_t>(t * sr), static_cast<size_t>((t + 0.25) * sr)) + 1e-12); };
        std::printf("  sustain 100%%: 2 s %.1f / 6 s %.1f / 12 s %.1f / 25 s %.1f dBFS   (sin sustain: 2 s %.1f / 6 s %.1f / 12 s %.1f)\n",
                    at(xc, 2), at(xc, 6), at(xc, 12), at(xc, 25), at(xd, 2), at(xd, 6), at(xd, 12));
        CHECK(at(xc, 6) > at(xd, 6) + 6, "el sustain no alarga la nota");
        CHECK(at(xc, 25) < -60, "el sustain no es acotado");
    }

    std::printf("== 8. Polifonia, strum, robo de voces sin clics ==\n");
    {
        const double sr = 48000;
        GuitarEngine g; g.prepare(sr, 512);
        GuitarSettings s = dry(); s.ampGain = 0.0; s.strum = 0.6; g.setSettings(s);
        std::vector<Ev> ev; chord(ev, 0.0, 3.0, { 40, 47, 52, 56, 59, 64 }, 0.8f); chord(ev, 0.5, 3.0, { 38, 45, 50, 54, 57, 62 }, 0.8f);
        auto x = renderSeq(g, sr, ev, 3.0, 512);
        (void)x;
        std::printf("  2 acordes de 6 notas: voces activas = %d (>=12)\n", g.activeVoices());
        CHECK(g.activeVoices() >= 12, "polifonia < 12");
        GuitarEngine h; h.prepare(sr, 512); h.setSettings(s);
        std::vector<Ev> e2; for (int i = 0; i < 40; ++i) e2.push_back({ i * 0.05, 0, 40 + i % 30, 0.7f });
        auto y = renderSeq(h, sr, e2, 3.0, 512);
        double dmax = 0; for (size_t i = 1; i < y.size(); ++i) dmax = std::max(dmax, (double)std::fabs(y[i] - y[i - 1]));
        std::printf("  40 notas con robo de voces: derivada max %.3f, pico %.3f\n", dmax, peakOf(y));
        CHECK(dmax < 0.5 && finiteAll(y), "clic al robar voces");
    }

    std::printf("== 9. CPU a 48 kHz (16 voces sostenidas + chorus + delay + reverb + amp 4x) ==\n");
    {
        const double sr = 48000;
        GuitarEngine g; g.prepare(sr, 512);
        GuitarSettings s; s.ampGain = 0.7; s.chorusMix = 0.5; s.delayMix = 0.4; s.reverbMix = 0.4; s.sustain = 1.0; g.setSettings(s);
        std::vector<Ev> ev;
        for (int i = 0; i < 16; ++i) ev.push_back({ 0.0 + i * 0.001, 0, 40 + i * 3, 0.8f });
        const double secs = 10.0;
        double dt = 1e9;
        std::vector<float> x;
        for (int rep = 0; rep < 3; ++rep) {          // mejor de 3 (la maquina puede estar cargada por otros procesos)
            GuitarEngine g2; g2.prepare(sr, 512); g2.setSettings(s);
            const auto t0 = std::chrono::steady_clock::now();
            x = renderSeq(g2, sr, ev, secs, 512);
            dt = std::min(dt, std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
        }
        std::printf("  CPU: %.2f %% de un nucleo (%.3f s para %.0f s de audio, mejor de 3)\n", 100.0 * dt / secs, dt, secs);
        CHECK(dt / secs < 0.05, "CPU > 5 %%");
        CHECK(finiteAll(x), "NaN en CPU test");
    }

    std::printf("== 10. DC y estabilidad de la cola (delay fb 95 %% + reverb) ==\n");
    {
        const double sr = 48000;
        GuitarEngine g; g.prepare(sr, 512);
        GuitarSettings s; s.delayFb = 0.95; s.delayMix = 1.0; s.reverbMix = 1.0; g.setSettings(s);
        auto x = renderSeq(g, sr, { { 0.0, 0, 52, 1.0f }, { 0.3, 1, 52, 0 } }, 60.0, 512);
        const size_t a = static_cast<size_t>(sr * 55);
        double dc = 0; for (size_t i = a; i < x.size(); ++i) dc += x[i];
        dc /= static_cast<double>(x.size() - a);
        std::printf("  tras 55 s: RMS %.1f dBFS, DC %.2e\n", 20 * std::log10(rmsOf(x, a, x.size()) + 1e-12), dc);
        CHECK(std::fabs(dc) < 1e-4 && rmsOf(x, a, x.size()) < 1e-3, "cola no decae");
    }

    std::printf("== 11. WAVs musicales (48 kHz, 24 bit) ==\n");
    {
        const double sr = 48000;
        {   // A) arpegios limpios en D: D - A - Bm - G, 120 BPM, corcheas, 8 compases
            GuitarEngine g; g.prepare(sr, 512);
            GuitarSettings s; s.ampGain = 0.12; s.cab = 0.6; s.tone = 0.62; s.chorusMix = 0.35; s.delayMix = 0.22; s.delayFb = 0.35; s.delayDiv = 0; s.reverbMix = 0.28; s.strum = 0.5;
            g.setSettings(s);
            std::vector<Ev> ev; ev.push_back({ 0, 4, 0, 120.0f });
            const int prog[4][6] = { { 50, 57, 62, 66, 69, 74 }, { 45, 52, 57, 61, 64, 69 }, { 47, 54, 59, 62, 66, 71 }, { 43, 50, 55, 59, 62, 67 } };
            const int pat[8] = { 0, 2, 3, 4, 3, 2, 4, 3 };
            for (int bar = 0; bar < 8; ++bar)
                for (int i = 0; i < 8; ++i) {
                    const double t = bar * 2.0 + i * 0.25;
                    const int n = prog[bar % 4][pat[i]];
                    ev.push_back({ t, 0, n, 0.55f + 0.2f * ((i % 4) == 0) + 0.06f * ((i * 7) % 3) });
                    ev.push_back({ t + 0.7, 1, n, 0 });
                }
            std::vector<float> R;
            auto L = renderSeq(g, sr, ev, 18.0, 512, &R);
            writeWav(out + "/guitarra_arpegios_D.wav", L, R, 48000);
            std::printf("  arpegios_D: pico %.3f, rms %.1f dBFS\n", peakOf(L), 20 * std::log10(rmsOf(L)));
            CHECK(finiteAll(L) && peakOf(L) < 0.99, "arpegios");
        }
        {   // B) lead con delay punteado (1/8 dotted a 90 BPM) sobre acordes con strum, 8 compases
            GuitarEngine g; g.prepare(sr, 512);
            GuitarSettings s; s.ampGain = 0.62; s.cab = 0.7; s.tone = 0.6; s.chorusMix = 0.15; s.delayMix = 0.38; s.delayFb = 0.45; s.delayDiv = 0; s.reverbMix = 0.25; s.sustain = 0.5; s.strum = 0.55;
            g.setSettings(s);
            const double bpm = 90, beat = 60.0 / bpm;
            std::vector<Ev> ev; ev.push_back({ 0, 4, 0, (float)bpm });
            const int ch[4][5] = { { 50, 57, 62, 66, 69 }, { 45, 52, 57, 61, 64 }, { 47, 54, 59, 62, 66 }, { 43, 50, 55, 59, 62 } };
            for (int bar = 0; bar < 8; ++bar) chord(ev, bar * 4 * beat, 3.8 * beat, { ch[bar % 4][0], ch[bar % 4][1], ch[bar % 4][2], ch[bar % 4][3], ch[bar % 4][4] }, 0.5f);
            struct N { double b; double d; int n; };
            const N mel[] = { { 0, 1.5, 74 }, { 1.5, 0.5, 76 }, { 2, 2, 78 }, { 4, 1.5, 81 }, { 5.5, 0.5, 79 }, { 6, 2, 78 }, { 8, 1.5, 76 }, { 9.5, 0.5, 74 }, { 10, 1, 73 }, { 11, 1, 76 },
                              { 12, 3, 78 }, { 16, 1.5, 81 }, { 17.5, 0.5, 83 }, { 18, 2, 81 }, { 20, 1.5, 79 }, { 21.5, 0.5, 78 }, { 22, 2, 79 }, { 24, 2, 83 }, { 26, 2, 81 }, { 28, 4, 78 } };
            for (const auto& m : mel) {
                ev.push_back({ m.b * beat, 0, m.n, 0.8f });
                ev.push_back({ (m.b + m.d * 0.95) * beat, 1, m.n, 0 });
                if (m.d >= 2) {   // vibrato (CC1) en las notas largas
                    ev.push_back({ (m.b + 0.5) * beat, 3, 0, 0.0f }); ev.push_back({ (m.b + 0.9) * beat, 3, 0, 0.85f }); ev.push_back({ (m.b + m.d) * beat, 3, 0, 0.0f });
                }
            }
            std::vector<float> R;
            auto L = renderSeq(g, sr, ev, 8 * 4 * beat + 3.0, 512, &R);
            writeWav(out + "/guitarra_lead_delay.wav", L, R, 48000);
            std::printf("  lead_delay: pico %.3f, rms %.1f dBFS\n", peakOf(L), 20 * std::log10(rmsOf(L)));
            CHECK(finiteAll(L) && peakOf(L) < 0.99, "lead");
        }
    }

    techniqueSuite(false, out);
    std::printf("\nHASH-SUITE modelada = 0x%016llx\n", static_cast<unsigned long long>(g_hash));
    g_hashOn = false;
    std::printf("\n== 16. FX Rack comun ==\n");
    testFxRack();

    std::printf(g_fail ?"\nRESULTADO: %d FALLOS\n" : "\nRESULTADO: TODO OK\n", g_fail);
    return g_fail ? 1 : 0;
}
