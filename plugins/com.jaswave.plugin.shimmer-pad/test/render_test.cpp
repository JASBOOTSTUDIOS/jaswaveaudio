// JasWave Shimmer Pad - prueba de render offline (sin VST3). Uso: ShimmerPad_rendertest <ruta.wav> [dir_extra]
//  1. Barrido cutoff x resonancia x frecuencia de muestreo: sin NaN/inf, salida acotada.
//  2. RT60 medido (integral de Schroeder) vs parametro; estabilidad del lazo con shimmer al 100 %.
//  3. Nota sostenida 10 s: ausencia de clics periodicos (derivada) con detector validado con un clic sintetico.
//  4. f0 por nota (6 notas, 3 registros, velocidades distintas), pico, RMS, DC, aliasing, pitch bend.
//  5. CPU por segundo de audio con 16 voces.
//  6. Progresion D-A-Bm-G de 8 compases a WAV 24-bit/48 kHz estereo.
#define JW_FXRACK_PROBE 1
#define JW_FXRACK_PROBE 1
#include "shimmer_pad_dsp.h"

#include <chrono>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <memory>

using namespace JasWaveShimmerPad;

static int g_fail = 0;
#define CHECK(cond, ...) do { if (!(cond)) { ++g_fail; std::printf("  FALLO: "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

// ------------------------------------------------------------------ utilidades
static void fft(std::vector<std::complex<double>>& a) {
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; ++i) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = -2.0 * kPi / static_cast<double>(len);
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

// Espectro de magnitud (ventana Hann) de x[start .. start+N)
static std::vector<double> spectrum(const std::vector<float>& x, size_t start, size_t N) {
    std::vector<std::complex<double>> a(N);
    for (size_t i = 0; i < N; ++i) a[i] = (start + i < x.size() ? x[start + i] : 0.0f) * (0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(N)));
    fft(a);
    std::vector<double> m(N / 2 + 1);
    for (size_t k = 0; k < m.size(); ++k) m[k] = std::abs(a[k]);
    return m;
}

static bool writeWav24(const char* path, const std::vector<float>& L, const std::vector<float>& R, int sr) {
    FILE* f = std::fopen(path, "wb");
    if (!f) return false;
    const uint32_t n = static_cast<uint32_t>(L.size()), dataBytes = n * 6;
    auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); w32(36 + dataBytes); std::fwrite("WAVEfmt ", 1, 8, f);
    w32(16); w16(1); w16(2); w32(static_cast<uint32_t>(sr)); w32(static_cast<uint32_t>(sr) * 6); w16(6); w16(24);
    std::fwrite("data", 1, 4, f); w32(dataBytes);
    for (uint32_t i = 0; i < n; ++i) {
        for (int c = 0; c < 2; ++c) {
            const double v = std::max(-1.0, std::min(1.0, static_cast<double>(c ? R[i] : L[i])));
            const int32_t q = static_cast<int32_t>(std::lround(v * 8388607.0));
            const uint8_t b[3] = { static_cast<uint8_t>(q & 0xFF), static_cast<uint8_t>((q >> 8) & 0xFF), static_cast<uint8_t>((q >> 16) & 0xFF) };
            std::fwrite(b, 1, 3, f);
        }
    }
    std::fclose(f);
    return true;
}

// Tiempo de reloj de pared; se toma el MINIMO de varias pasadas (descarta la interferencia de otros procesos)
static double cpuSeconds() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

struct Ev { int at; int type; int note; float vel; };   // 0 = on, 1 = off

// Renderiza como lo hace el procesador VST3: segmentos entre eventos con precision de muestra
static void renderEv(PadEngine& e, std::vector<float>& L, std::vector<float>& R, size_t n0, size_t n, const std::vector<Ev>& ev, int block, PadBus* bus = nullptr) {
    size_t pos = 0, ei = 0;
    while (pos < n) {
        const size_t blk = std::min<size_t>(static_cast<size_t>(block), n - pos);
        size_t p = 0;
        while (p < blk) {
            const size_t abs = n0 + pos + p;
            while (ei < ev.size() && static_cast<size_t>(ev[ei].at) <= abs) {
                if (ev[ei].type == 0) e.noteOn(ev[ei].note, ev[ei].vel); else e.noteOff(ev[ei].note);
                ++ei;
            }
            size_t next = blk;
            if (ei < ev.size() && static_cast<size_t>(ev[ei].at) < n0 + pos + blk) next = static_cast<size_t>(ev[ei].at) - (n0 + pos);
            e.render(L.data() + abs, R.data() + abs, static_cast<int>(next - p), bus);
            p = next;
        }
        pos += blk;
    }
}

static PadSettings neutral() {   // para medir afinacion/aliasing: sin modulaciones aleatorias ni efectos
    PadSettings s;
    s.cutoffHz = 20000.0; s.resonance = 0.0; s.attack = 0.02; s.release = 0.2;
    s.lowCutHz = 20.0; s.toneHz = 20000.0; s.comp = 0.0; s.delayMix = 0.0; s.drive = 0.0; s.width = 1.0;
    s.reverb = 0.0; s.chorus = 0.0; s.shimmer = 0.0; s.detune = 0.0; s.sub = 0.0;
    s.lfoDepthOct = 0.0; s.driftScale = 0.0;
    return s;
}

static double rmsOf(const std::vector<float>& x, size_t a, size_t b) {
    double s = 0.0;
    for (size_t i = a; i < b && i < x.size(); ++i) s += static_cast<double>(x[i]) * x[i];
    return std::sqrt(s / static_cast<double>(std::max<size_t>(1, b - a)));
}
static double peakOf(const std::vector<float>& x, size_t a, size_t b) {
    double p = 0.0;
    for (size_t i = a; i < b && i < x.size(); ++i) p = std::max(p, static_cast<double>(std::fabs(x[i])));
    return p;
}
static double db(double v) { return 20.0 * std::log10(std::max(v, 1e-12)); }

// ------------------------------------------------------------------ 1. barrido NaN
static void testSweep() {
    std::printf("[1] Barrido cutoff (20 Hz..20 kHz, 21 pasos) x resonancia (0..100 %%, 5 pasos) x sr\n");
    const double srs[] = { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 };
    const int blocks[] = { 1, 37, 256, 4096 };
    long points = 0, bad = 0;
    double worst = 0.0;
    for (const double sr : srs) {
        PadEngine e;
        e.prepare(sr, 4096);
        const size_t N = static_cast<size_t>(sr * 0.35);
        std::vector<float> L(N), R(N);
        int bi = 0;
        for (int ci = 0; ci < 21; ++ci) {
            for (int ri = 0; ri < 5; ++ri) {
                PadSettings s;
                s.cutoffHz = 20.0 * std::pow(1000.0, ci / 20.0);
                s.resonance = ri / 4.0;
                s.attack = 0.05; s.reverb = 0.5; s.shimmer = 1.0; s.chorus = 0.5; s.lfoHz = 8.0; s.sub = 0.5; s.detune = 1.0;
                s.modWheel = (ci % 3) / 2.0; s.aftertouch = (ri % 2);
                e.setSettings(s);
                e.allSoundOff();
                std::vector<Ev> ev = { { 0, 0, 36, 1.0f }, { 0, 0, 60, 0.9f }, { 10, 0, 72, 0.7f }, { 20, 0, 96, 1.0f }, { 30, 0, 120, 1.0f } };
                renderEv(e, L, R, 0, N, ev, blocks[bi++ % 4]);
                for (size_t i = 0; i < N; ++i) {
                    const double a = std::fabs(L[i]), b = std::fabs(R[i]);
                    if (!std::isfinite(a) || !std::isfinite(b) || a > 1.0 || b > 1.0) ++bad;
                    worst = std::max(worst, std::max(std::isfinite(a) ? a : 1e9, std::isfinite(b) ? b : 1e9));
                }
                ++points;
                e.allNotesOff();
            }
        }
    }
    std::printf("    puntos=%ld, muestras no finitas o fuera de [-1,1]=%ld, pico maximo=%.4f\n", points, bad, worst);
    CHECK(bad == 0, "NaN/inf o desbordes en el barrido");
}

// ------------------------------------------------------------------ 2. RT60
static double measureRt60(const std::vector<double>& h, double sr) {
    // integral de Schroeder hacia atras; ajuste lineal entre -5 y -35 dB (T30) extrapolado a -60
    std::vector<double> edc(h.size());
    double acc = 0.0;
    for (size_t i = h.size(); i-- > 0;) { acc += h[i] * h[i]; edc[i] = acc; }
    const double tot = edc[0];
    double t1 = -1, t2 = -1;
    for (size_t i = 0; i < h.size(); ++i) {
        const double d = 10.0 * std::log10(std::max(edc[i] / tot, 1e-30));
        if (t1 < 0 && d <= -5.0) t1 = static_cast<double>(i) / sr;
        if (t2 < 0 && d <= -35.0) { t2 = static_cast<double>(i) / sr; break; }
    }
    if (t1 < 0 || t2 < 0) return -1.0;
    return 2.0 * (t2 - t1);   // 30 dB -> 60 dB
}

static void testRt60() {
    std::printf("[2] RT60 de la FDN (impulso, shimmer 0) vs parametro shimmer_decay\n");
    const double sr = 48000.0;
    const double rts[] = { 0.5, 1.0, 2.0, 4.5, 6.0, 10.0, 20.0 };
    for (const double rt : rts) {
        ShimmerVerb v;
        v.prepare(sr);
        v.setRt60(rt);
        v.setShimmer(0.0, 0);
        const size_t N = static_cast<size_t>(sr * (rt * 1.7 + 1.0));
        std::vector<double> hl(N), hr(N);
        for (size_t i = 0; i < N; ++i) { double l, r; v.process(i == 0 ? 1.0 : 0.0, 0.0, l, r); hl[i] = l; hr[i] = r; }
        const double ml = measureRt60(hl, sr), mr = measureRt60(hr, sr);
        const double m = 0.5 * (ml + mr);
        const double err = (m - rt) / rt * 100.0;
        std::printf("    RT60 param=%5.2f s  medido L=%6.2f R=%6.2f  error=%+5.1f %%\n", rt, ml, mr, err);
        CHECK(m > 0 && std::fabs(err) <= 20.0, "RT60 fuera de +-20 %% (param %.2f, medido %.2f)", rt, m);
    }
    std::printf("[2b] Estabilidad del lazo con shimmer 100 %% (ruido 3 s, luego silencio 60 s), RT60=20 s\n");
    for (int iv = 0; iv < 3; ++iv) {
        ShimmerVerb v;
        v.prepare(sr);
        v.setRt60(20.0);
        v.setShimmer(1.0, iv);
        Xor rng; rng.seed(77);
        const size_t nIn = static_cast<size_t>(3 * sr), nTail = static_cast<size_t>(60 * sr);
        double peakIn = 0.0, peakAll = 0.0;
        std::vector<double> secE;
        double e = 0.0;
        bool finite = true;
        for (size_t i = 0; i < nIn + nTail; ++i) {
            double l, r;
            const double x = i < nIn ? 0.5 * rng.bi() : 0.0;
            v.process(x, i < nIn ? 0.5 * rng.bi() : 0.0, l, r);
            if (!std::isfinite(l) || !std::isfinite(r)) { finite = false; break; }
            peakAll = std::max(peakAll, std::max(std::fabs(l), std::fabs(r)));
            if (i < nIn) peakIn = std::max(peakIn, std::max(std::fabs(l), std::fabs(r)));
            e += l * l + r * r;
            if ((i + 1) % static_cast<size_t>(sr) == 0) { secE.push_back(10.0 * std::log10(e / sr + 1e-30)); e = 0.0; }
        }
        // tras cortar la entrada (segundo >= 4) la energia por segundo debe descender de forma monotona
        int rises = 0;
        double maxRise = 0.0;
        for (size_t s = 5; s < secE.size(); ++s) if (secE[s] > secE[s - 1] + 0.5) { ++rises; maxRise = std::max(maxRise, secE[s] - secE[s - 1]); }
        const double decay = secE[4] - secE[std::min<size_t>(secE.size() - 1, 24)];
        std::printf("    intervalo %d: finito=%d pico durante entrada=%.3f, pico total=%.3f, subidas de energia=%d (max %.2f dB), caida 4s->24s=%.1f dB\n",
                    iv, finite ? 1 : 0, peakIn, peakAll, rises, maxRise, decay);
        CHECK(finite, "NaN en el lazo shimmer (intervalo %d)", iv);
        CHECK(rises == 0, "la cola crece tras cortar la entrada (intervalo %d)", iv);
        CHECK(peakAll < 8.0, "pico excesivo en el lazo (intervalo %d)", iv);
        CHECK(decay > 6.0, "la cola no decae (intervalo %d)", iv);
    }
    std::printf("[2c] RT60 con shimmer 35 %% (+12): efecto del lazo sobre el decaimiento\n");
    for (const double rt : { 4.5, 10.0 }) {
        ShimmerVerb v; v.prepare(sr); v.setRt60(rt); v.setShimmer(0.35, 0);
        const size_t N = static_cast<size_t>(sr * (rt * 1.7 + 1.0));
        std::vector<double> hl(N);
        for (size_t i = 0; i < N; ++i) { double l, r; v.process(i == 0 ? 1.0 : 0.0, 0.0, l, r); hl[i] = l; }
        std::printf("    param=%5.2f s medido con shimmer=%6.2f s\n", rt, measureRt60(hl, sr));
    }
}

// ------------------------------------------------------------------ 3. clics
struct ClickStats { double spikeRatio, periodicity; int periodicLagMs; };
static ClickStats analyzeClicks(const std::vector<float>& x, size_t a, size_t b, double sr) {
    // tercera diferencia: elimina contenido suave, deja los saltos
    std::vector<double> e(b - a, 0.0);
    for (size_t i = a + 3; i < b; ++i) e[i - a] = std::fabs(static_cast<double>(x[i]) - 3.0 * x[i - 1] + 3.0 * x[i - 2] - x[i - 3]);
    double mean = 0.0, pk = 0.0;
    for (const double v : e) { mean += v; pk = std::max(pk, v); }
    mean /= static_cast<double>(e.size());
    ClickStats cs{};
    // relacion pico / media local (ventana 50 ms) - un clic es un pico sobresaliente
    const size_t W = static_cast<size_t>(0.05 * sr);
    double worst = 0.0;
    for (size_t s = 0; s + W < e.size(); s += W / 2) {
        double m = 0.0, p = 0.0;
        for (size_t i = s; i < s + W; ++i) { m += e[i]; p = std::max(p, e[i]); }
        m /= static_cast<double>(W);
        if (m > 1e-9) worst = std::max(worst, p / m);
    }
    cs.spikeRatio = worst;
    // periodicidad de EVENTOS IMPULSIVOS: envolvente del maximo de |e| en tramos de 2 ms; solo cuentan los tramos que
    // superan 3 veces la media local (+-40 ms). La modulacion suave (batido del unisono, LFO) no cuenta, un clic si.
    const size_t F = static_cast<size_t>(0.002 * sr);
    std::vector<double> env;
    for (size_t s = 0; s + F <= e.size(); s += F) { double p = 0.0; for (size_t i = s; i < s + F; ++i) p = std::max(p, e[i]); env.push_back(p); }
    std::vector<double> imp(env.size(), 0.0);
    const size_t H = 20;
    int events = 0;
    for (size_t i = 0; i < env.size(); ++i) {
        const size_t lo = i > H ? i - H : 0, hi = std::min(env.size(), i + H + 1);
        double m = 0.0;
        for (size_t k = lo; k < hi; ++k) m += env[k];
        m /= static_cast<double>(hi - lo);
        if (m > 1e-12 && env[i] / m > 3.0) { imp[i] = env[i] / m - 3.0; ++events; }
    }
    cs.periodicity = 0.0;
    cs.periodicLagMs = 0;
    if (events >= 4) {
        double mu = 0.0;
        for (const double v : imp) mu += v;
        mu /= static_cast<double>(imp.size());
        double var = 0.0;
        for (const double v : imp) var += (v - mu) * (v - mu);
        if (var > 1e-18) {
            for (size_t lag = 50; lag <= 500; ++lag) {
                double c = 0.0;
                for (size_t i = 0; i + lag < imp.size(); ++i) c += (imp[i] - mu) * (imp[i + lag] - mu);
                c /= var;
                if (c > cs.periodicity) { cs.periodicity = c; cs.periodicLagMs = static_cast<int>(lag * 2); }
            }
        }
    }
    return cs;
}

static void testClicks() {
    std::printf("[3] Nota sostenida 10 s (analisis de la derivada de 3er orden; ventana 50 ms, envolvente 2 ms)\n");
    std::printf("    (a) solo la senal humeda (camino del shimmer): un clic del pitch shifter se veria aqui\n");
    std::printf("    (b) mezcla completa con filtro a 1.2 kHz (los bordes de las sierras sin filtrar dan picos naturales)\n");
    const double sr = 48000.0;
    struct Cfg { const char* name; double shimmer, reverb; int interval; };
    const Cfg cfgs[] = { { "defecto (shimmer 35 %, +12)", 0.35, 0.4, 0 }, { "shimmer 100 %, +12", 1.0, 0.6, 0 }, { "shimmer 100 %, +24", 1.0, 0.6, 2 }, { "shimmer 100 %, +7", 1.0, 0.6, 1 } };
    for (int wet = 1; wet >= 0; --wet) {
        for (const auto& c : cfgs) {
            PadEngine e;
            e.prepare(sr, 4096);
            PadSettings s;
            s.attack = 0.5; s.shimmer = c.shimmer; s.reverb = c.reverb; s.interval = c.interval; s.rt60 = 8.0; s.chorus = 0.5;
            s.wetOnly = wet != 0;
            if (!wet) s.cutoffHz = 1200.0;
            e.setSettings(s);
            const size_t N = static_cast<size_t>(12 * sr);
            std::vector<float> L(N), R(N);
            renderEv(e, L, R, 0, N, { { 0, 0, 57, 0.8f }, { 5, 0, 64, 0.7f } }, 512);
            const ClickStats cl = analyzeClicks(L, static_cast<size_t>(2 * sr), static_cast<size_t>(12 * sr), sr);
            std::printf("    (%c) %-28s spike(pico/media local)=%5.1f  autocorr. de impulsos (100 ms..1 s)=%.2f @ %d ms\n", wet ? 'a' : 'b', c.name, cl.spikeRatio, cl.periodicity, cl.periodicLagMs);
            CHECK(cl.spikeRatio < (wet ? 8.0 : 10.0), "pico anomalo en la derivada (%s)", c.name);
            CHECK(cl.periodicity < 0.30, "clics periodicos (%s)", c.name);
        }
    }
    // validacion del detector: la misma senal con un clic cada 0.34 s debe delatarse
    {
        PadEngine e; e.prepare(sr, 4096);
        PadSettings s; s.attack = 0.5; s.wetOnly = true; e.setSettings(s);
        const size_t N = static_cast<size_t>(12 * sr);
        std::vector<float> L(N), R(N);
        renderEv(e, L, R, 0, N, { { 0, 0, 57, 0.8f } }, 512);
        for (size_t i = static_cast<size_t>(0.34 * sr); i < N; i += static_cast<size_t>(0.34 * sr)) L[i] += 0.01f;
        const ClickStats cl = analyzeClicks(L, static_cast<size_t>(2 * sr), static_cast<size_t>(12 * sr), sr);
        std::printf("    control positivo (clic sintetico de 0.01 cada 0.34 s sobre la senal humeda): spike=%5.1f periodicidad=%.2f @ %d ms\n", cl.spikeRatio, cl.periodicity, cl.periodicLagMs);
        CHECK(cl.spikeRatio >= 8.0 && cl.periodicity >= 0.30, "el detector no detecta un clic sintetico (prueba invalida)");
    }
}

// ------------------------------------------------------------------ 4. f0, aliasing, bend
static double peakFreq(const std::vector<float>& x, size_t start, size_t N, double sr, double fExp) {
    const std::vector<double> m = spectrum(x, start, N);
    const double bin = sr / static_cast<double>(N);
    const int c = static_cast<int>(fExp / bin);
    const int w = std::max(3, static_cast<int>(fExp * 0.06 / bin));
    int best = c;
    for (int k = std::max(2, c - w); k <= c + w && k + 1 < static_cast<int>(m.size()); ++k) if (m[static_cast<size_t>(k)] > m[static_cast<size_t>(best)]) best = k;
    const double a = std::log(m[static_cast<size_t>(best) - 1] + 1e-30), b = std::log(m[static_cast<size_t>(best)] + 1e-30), cc = std::log(m[static_cast<size_t>(best) + 1] + 1e-30);
    const double d = 0.5 * (a - cc) / (a - 2 * b + cc);
    return (best + d) * bin;
}

static void testNotes() {
    std::printf("[4] f0 por nota (config neutra: sin detune/deriva/efectos), pico y RMS\n");
    const double sr = 48000.0;
    const int notes[] = { 36, 48, 60, 72, 84, 96 };
    const float vels[] = { 0.4f, 0.6f, 0.8f, 1.0f, 0.5f, 0.7f };
    std::printf("    nota  f_esp(Hz)  f_med(Hz)  cents   pico   RMS(dBFS)\n");
    for (int i = 0; i < 6; ++i) {
        PadEngine e; e.prepare(sr, 4096);
        e.setSettings(neutral()); e.settle();
        const size_t N = static_cast<size_t>(1.6 * sr);
        std::vector<float> L(N), R(N);
        renderEv(e, L, R, 0, N, { { 0, 0, notes[i], vels[i] } }, 512);
        const double fe = e.fundamental(notes[i]);
        const double fm = peakFreq(L, static_cast<size_t>(0.4 * sr), 65536, sr, fe);
        const double cents = 1200.0 * std::log2(fm / fe);
        const double pk = peakOf(L, 0, N), rm = rmsOf(L, static_cast<size_t>(0.4 * sr), N);
        std::printf("    %3d   %9.2f  %9.2f  %+6.2f  %.3f  %6.1f\n", notes[i], fe, fm, cents, pk, db(rm));
        CHECK(std::fabs(cents) < 10.0, "f0 desafinada %.2f cents (nota %d)", cents, notes[i]);
        CHECK(pk < 0.98, "pico >= 0.98");
    }
    // pitch bend +2 st
    {
        PadEngine e; e.prepare(sr, 4096);
        PadSettings s = neutral(); s.bendSemi = 2.0;
        e.setSettings(s); e.settle();
        const size_t N = static_cast<size_t>(1.6 * sr);
        std::vector<float> L(N), R(N);
        renderEv(e, L, R, 0, N, { { 0, 0, 60, 0.8f } }, 512);
        const double fe = e.fundamental(60) * std::pow(2.0, 2.0 / 12.0);
        const double cents = 1200.0 * std::log2(peakFreq(L, static_cast<size_t>(0.6 * sr), 65536, sr, fe) / fe);
        std::printf("    pitch bend +2 st (nota 60): error %+.2f cents\n", cents);
        CHECK(std::fabs(cents) < 10.0, "pitch bend desafinado");
    }
    // aliasing: energia fuera de los armonicos / energia total (filtro abierto, solo capas A+B)
    std::printf("    aliasing (energia no armonica / total, filtro abierto 20 kHz):\n");
    for (const int note : { 72, 84, 96, 108 }) {
        PadEngine e; e.prepare(sr, 4096);
        e.setSettings(neutral()); e.settle();
        const size_t N = static_cast<size_t>(2.2 * sr);
        std::vector<float> L(N), R(N);
        renderEv(e, L, R, 0, N, { { 0, 0, note, 0.9f } }, 512);
        const size_t Nf = 65536;
        const std::vector<double> m = spectrum(L, static_cast<size_t>(0.5 * sr), Nf);
        const double fe = e.fundamental(note);
        const double fm = peakFreq(L, static_cast<size_t>(0.5 * sr), Nf, sr, fe);
        const double bin = sr / Nf;
        double tot = 0.0, harm = 0.0;
        for (size_t k = 1; k < m.size(); ++k) {
            const double f = k * bin;
            tot += m[k] * m[k];
            const double h = f / fm;
            const double dist = std::fabs(h - std::round(h)) * fm;
            if (std::round(h) >= 1.0 && dist < 6.0 * bin) harm += m[k] * m[k];
        }
        const double ratio = 10.0 * std::log10(std::max(tot - harm, 1e-30) / tot);
        std::printf("      nota %3d (%.0f Hz): %.1f dB\n", note, fe, ratio);
        CHECK(ratio < -50.0, "aliasing audible: %.1f dB (nota %d)", ratio, note);
    }
}

// ------------------------------------------------------------------ 4b. el shimmer produce de verdad el intervalo
static double bandEnergyDb(const std::vector<float>& x, size_t start, size_t N, double sr, double fc, double rel) {
    const std::vector<double> m = spectrum(x, start, N);
    const double bin = sr / static_cast<double>(N);
    double e = 0.0;
    for (size_t k = static_cast<size_t>(fc * (1.0 - rel) / bin); k <= static_cast<size_t>(fc * (1.0 + rel) / bin) && k < m.size(); ++k) e += m[k] * m[k];
    return 10.0 * std::log10(std::max(e, 1e-30));
}

static double centroidOct(const std::vector<float>& x, size_t start, size_t N, double sr) {
    const std::vector<double> m = spectrum(x, start, N);
    const double bin = sr / static_cast<double>(N);
    double num = 0.0, den = 0.0;
    for (size_t k = static_cast<size_t>(100.0 / bin); k < static_cast<size_t>(14000.0 / bin) && k < m.size(); ++k) { num += m[k] * m[k] * std::log2(k * bin); den += m[k] * m[k]; }
    return num / std::max(den, 1e-30);
}

static void testShimmerReal() {
    std::printf("[4b] El shimmer sube de verdad la cola (solo senal humeda, nota A3 soltada a los 2 s, analisis 3.0-4.4 s; shimmer 100 %% frente a 0 %%)\n");
    const double sr = 48000.0;
    struct Iv { int idx; const char* name; double ratio, minRiseOct; };
    const Iv ivs[] = { { 0, "+12", 2.0, 0.8 }, { 1, "+7", 1.4983070768766815, 0.8 }, { 2, "+24", 4.0, 0.5 } };
    for (const auto& iv : ivs) {
        double cen[2], band[2];
        for (int on = 0; on < 2; ++on) {
            PadEngine eng; eng.prepare(sr, 4096);
            PadSettings s = neutral();
            s.wetOnly = true; s.reverb = 1.0; s.rt60 = 6.0; s.shimmer = on ? 1.0 : 0.0; s.interval = iv.idx; s.release = 0.1; s.cutoffHz = 20000.0;
            eng.setSettings(s); eng.settle();
            const size_t N = static_cast<size_t>(5 * sr);
            std::vector<float> L(N), R(N);
            renderEv(eng, L, R, 0, N, { { 0, 0, 57, 0.8f }, { static_cast<int>(2 * sr), 1, 57, 0.0f } }, 512);
            cen[on] = centroidOct(L, static_cast<size_t>(3.0 * sr), 65536, sr);
            band[on] = bandEnergyDb(L, static_cast<size_t>(3.0 * sr), 65536, sr, 220.0 * iv.ratio, 0.03);
        }
        std::printf("    %-4s: centroide de la cola %.0f Hz -> %.0f Hz (%+.2f octavas); banda f0*razon (%.1f Hz) %+.1f dB\n",
                    iv.name, std::pow(2.0, cen[0]), std::pow(2.0, cen[1]), cen[1] - cen[0], 220.0 * iv.ratio, band[1] - band[0]);
        CHECK(cen[1] - cen[0] >= iv.minRiseOct, "el shimmer %s no sube la cola (%+.2f octavas)", iv.name, cen[1] - cen[0]);
        if (iv.idx == 1) CHECK(band[1] - band[0] >= 10.0, "el shimmer +7 no genera la quinta (%+.1f dB)", band[1] - band[0]);
    }
}

// ------------------------------------------------------------------ 5. CPU y robo de voces
static void testCpu() {
    std::printf("[5] CPU con 16 voces sostenidas (defecto, shimmer 35 %%), 20 s de audio a 48 kHz, bloques de 512\n");
    const double sr = 48000.0;
    PadEngine e; e.prepare(sr, 4096);
    PadSettings s; s.attack = 0.3;
    e.setSettings(s);
    const size_t N = static_cast<size_t>(20 * sr);
    std::vector<float> L(N), R(N);
    std::vector<Ev> ev;
    for (int i = 0; i < 16; ++i) ev.push_back({ i * 10, 0, 40 + i * 3, 0.8f });
    ScopedNoDenormals nd;
    double sec = 1e9;
    for (int rep = 0; rep < 5; ++rep) {   // minimo de 5 pasadas
        PadEngine er; er.prepare(sr, 4096); er.setSettings(s);
        const double t0 = cpuSeconds();
        renderEv(er, L, R, 0, N, ev, 512);
        sec = std::min(sec, cpuSeconds() - t0);
    }
    renderEv(e, L, R, 0, N, ev, 512);
    std::printf("    voces activas=%d, tiempo=%.3f s para 20 s de audio -> CPU = %.2f %% de un nucleo (reloj de pared, minimo de 5 pasadas)\n", e.activeVoices(), sec, 100.0 * sec / 20.0);
    CHECK(100.0 * sec / 20.0 < 5.0, "CPU >= 5 %%");

    // robo de voces: 40 notas sin soltar, sin NaN ni saltos bruscos
    PadEngine e2; e2.prepare(sr, 4096);
    PadSettings s2; s2.attack = 0.05; s2.cutoffHz = 20000;
    e2.setSettings(s2);
    const size_t N2 = static_cast<size_t>(6 * sr);
    std::vector<float> L2(N2), R2(N2);
    std::vector<Ev> ev2;
    for (int i = 0; i < 40; ++i) ev2.push_back({ static_cast<int>(sr * 0.5) + i * 4000, 0, 36 + (i * 7) % 48, 0.8f });
    renderEv(e2, L2, R2, 0, N2, ev2, 128);
    double maxJump = 0.0, rms = rmsOf(L2, static_cast<size_t>(sr), N2);
    for (size_t i = 1; i < N2; ++i) maxJump = std::max(maxJump, static_cast<double>(std::fabs(L2[i] - L2[i - 1])));
    const ClickStats cl = analyzeClicks(L2, static_cast<size_t>(sr), N2, sr);
    std::printf("    robo de voces (40 notas, 16 voces): voces=%d, salto maximo entre muestras=%.4f, RMS=%.1f dBFS, spike=%.1f\n",
                e2.activeVoices(), maxJump, db(rms), cl.spikeRatio);
    CHECK(e2.activeVoices() <= 16, "mas de 16 voces");
    CHECK(cl.spikeRatio < 14.0, "clic al robar voz");
}

// ------------------------------------------------------------------ 6. progresion D-A-Bm-G
static void renderProgression(const char* wavPath) {
    std::printf("[6] Progresion D-A-Bm-G (2 vueltas = 8 compases, 4/4 a 60 bpm) -> %s\n", wavPath);
    const double sr = 48000.0;
    PadEngine e; e.prepare(sr, 4096);
    const int chords[4][5] = { { 38, 50, 57, 62, 66 }, { 45, 52, 57, 61, 64 }, { 47, 54, 59, 62, 66 }, { 43, 50, 55, 59, 62 } };
    const double bar = 4.0 * sr;
    const size_t N = static_cast<size_t>(8 * bar + 7.0 * sr);   // cola de release/reverb
    std::vector<float> L(N, 0.0f), R(N, 0.0f);
    std::vector<Ev> ev;
    for (int b = 0; b < 8; ++b) {
        const int* c = chords[b % 4];
        for (int k = 0; k < 5; ++k) {
            const int at = static_cast<int>(b * bar) + k * 1200;   // arpegio muy suave 25 ms entre notas
            ev.push_back({ at, 0, c[k], 0.62f + 0.06f * k });
            ev.push_back({ static_cast<int>((b + 1) * bar) - 2400 + k * 300, 1, c[k], 0.0f });
        }
    }
    std::sort(ev.begin(), ev.end(), [](const Ev& a, const Ev& b) { return a.at < b.at; });
    // automatizacion suave: rueda de modulacion en los compases 5-8, cutoff abierto progresivamente
    PadSettings s;
    s.cutoffHz = 2400.0; s.resonance = 0.25; s.attack = 1.6; s.release = 3.2; s.rt60 = 7.0; s.shimmer = 0.45; s.reverb = 0.45; s.chorus = 0.5; s.detune = 0.45; s.sub = 0.2; s.lfoHz = 0.22;
    PadBus bus;
    ScopedNoDenormals nd;
    size_t pos = 0, evIdx = 0;
    const size_t seg = 256;
    while (pos < N) {
        const double t = static_cast<double>(pos) / sr;
        s.cutoffHz = 1800.0 * std::pow(2.0, 1.6 * std::min(1.0, t / 32.0));
        s.modWheel = t > 16.0 ? std::min(1.0, (t - 16.0) / 12.0) * 0.6 : 0.0;
        e.setSettings(s);
        const size_t n = std::min(seg, N - pos);
        std::vector<Ev> sub;
        while (evIdx < ev.size() && static_cast<size_t>(ev[evIdx].at) < pos + n) sub.push_back(ev[evIdx++]);
        renderEv(e, L, R, pos, n, sub, 4096, &bus);
        pos += n;
    }
    double pk = std::max(peakOf(L, 0, N), peakOf(R, 0, N));
    double dc = 0.0;
    for (size_t i = 0; i < N; ++i) dc += L[i];
    dc /= static_cast<double>(N);
    const double rms = std::sqrt(0.5 * (std::pow(rmsOf(L, static_cast<size_t>(8 * sr), static_cast<size_t>(32 * sr)), 2) + std::pow(rmsOf(R, static_cast<size_t>(8 * sr), static_cast<size_t>(32 * sr)), 2)));
    bool finite = true;
    for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i])) { finite = false; break; }
    // correlacion L/R (anchura estereo)
    double sl = 0, sr2 = 0, slr = 0;
    for (size_t i = static_cast<size_t>(8 * sr); i < static_cast<size_t>(32 * sr); ++i) { sl += L[i] * L[i]; sr2 += R[i] * R[i]; slr += L[i] * R[i]; }
    const ClickStats cl = analyzeClicks(L, static_cast<size_t>(4 * sr), static_cast<size_t>(34 * sr), sr);
    std::printf("    pico=%.3f (%.1f dBFS)  RMS(8..32 s)=%.1f dBFS  DC=%.2e  finito=%d  correlacion L/R=%.2f  spike=%.1f periodicidad=%.2f\n",
                pk, db(pk), db(rms), dc, finite ? 1 : 0, slr / std::sqrt(sl * sr2 + 1e-30), cl.spikeRatio, cl.periodicity);
    CHECK(finite, "NaN en la progresion");
    CHECK(pk < 0.98, "pico >= 0.98 en la progresion");
    CHECK(std::fabs(dc) < 1e-3, "DC en la progresion");
    CHECK(rms > 0.01 && rms < 0.4, "nivel RMS fuera de rango (%.4f)", rms);
    CHECK(writeWav24(wavPath, L, R, 48000), "no se pudo escribir el WAV");
}

// ------------------------------------------------------------------ banco de muestras (--samples)
static std::unique_ptr<PadEngine> makeSampled(double sr, const PadSettings& s) {
    auto e = std::make_unique<PadEngine>();
    e->prepare(sr, 4096);
    e->setSettings(s);
    e->settle();
    for (int i = 0; i < 3000 && !e->samplerReady() && e->samplerLoading(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    return e;
}

// ventanas de RMS (dBFS) cada `win` segundos
static std::vector<double> rmsWindows(const std::vector<float>& x, double sr, double win, double from = 0.0) {
    std::vector<double> w;
    const size_t W = static_cast<size_t>(win * sr);
    for (size_t a = static_cast<size_t>(from * sr); a + W <= x.size(); a += W) w.push_back(db(rmsOf(x, a, a + W)));
    return w;
}

static int samplesTest(const char* wavPath) {
    std::printf("== JasWave Shimmer Pad - prueba del banco de muestras ==\n");
    const double sr = 48000.0;
    PadSettings def;   // valores por defecto (los que suenan sin tocar nada)
    const char* onlyEnv = std::getenv("JW_SOLO");   // p. ej. JW_SOLO=S3S5 ejecuta solo esas pruebas
    auto on = [&](const char* id) { return !onlyEnv || std::strstr(onlyEnv, id) != nullptr; };
    auto probe = makeSampled(sr, def);
    CHECK(probe->samplerReady(), "el banco shimmer-pad.jws no se cargo (carpeta de samples)");
    if (!probe->samplerReady()) return 1;

    // [S1] estructura del banco y costuras de bucle (medidas sobre el PCM, sin motor)
    if (on("S1")) {
        std::string err;
        const std::string path = JwSampler::samplesDir() + "\\shimmer-pad.jws";
        auto b = JwSampler::Bank::load(path, err);
        CHECK(b != nullptr, "no se pudo abrir el banco: %s", err.c_str());
        if (b) {
            const double mb = (b->pcm.size() * 2.0 + b->zones.size() * 64.0) / 1.0e6;
            int looped = 0, stereo = 0;
            double worstSeam = 0.0, worstLoopSec = 1e9;
            for (const auto& z : b->zones) {
                if (z.channels == 2) ++stereo;
                if (z.loopEnd <= z.loopStart) continue;
                ++looped;
                const int16_t* d = b->data(z);
                const int ch = z.channels;
                // costura: salto entre la ultima muestra del bucle y la primera, frente al salto tipico del material
                double acc = 0.0; size_t cnt = 0;
                for (uint32_t i = z.loopStart + 1; i < z.loopEnd; i += 7) { acc += std::fabs(static_cast<double>(d[i * ch]) - d[(i - 1) * ch]); ++cnt; }
                const double typ = std::max(acc / static_cast<double>(std::max<size_t>(1, cnt)), 1.0);
                const double seam = std::fabs(static_cast<double>(d[static_cast<size_t>(z.loopStart) * ch]) - d[static_cast<size_t>(z.loopEnd - 1) * ch]);
                worstSeam = std::max(worstSeam, seam / typ);
                worstLoopSec = std::min(worstLoopSec, (z.loopEnd - z.loopStart) / static_cast<double>(z.sr));
            }
            std::printf("[S1] banco: %zu zonas (%d en estereo), %.1f MB, %d con bucle; bucle mas corto %.2f s; peor costura = %.2f x el salto tipico\n",
                        b->zones.size(), stereo, mb, looped, worstLoopSec, worstSeam);
            CHECK(mb <= 80.0, "banco de %.1f MB (> 80)", mb);
            CHECK(looped == static_cast<int>(b->zones.size()), "hay zonas sin bucle de sostenido");
            CHECK(worstSeam < 6.0, "costura de bucle audible (%.1f x)", worstSeam);
            CHECK(worstLoopSec > 1.5, "bucle demasiado corto (%.2f s): se oiria el ciclo", worstLoopSec);
        }
    }

    // [S2] niveles por nota y velocidad (seco, sin efectos): pico / RMS de la meseta, cola hacia el silencio
    if (on("S2")) {
        std::printf("[S2] niveles por nota (seco: reverb 0, chorus 0; mantenida 5 s, suelta, 12 s en total)\n");
        std::printf("    nota   vel   pico(dBFS)  RMS meseta(dBFS)  cola final(dBFS)\n");
        PadSettings s = def; s.reverb = 0.0; s.chorus = 0.0; s.attack = 0.5;
        double lo = 1e9, hi = -1e9;
        for (const int note : { 34, 36, 43, 48, 55, 60, 67, 72, 79, 84, 91, 96 }) {
            for (const float vel : { 0.3f, 0.9f }) {
                auto e = makeSampled(sr, s);
                const size_t N = static_cast<size_t>(12 * sr);
                std::vector<float> L(N), R(N);
                renderEv(*e, L, R, 0, N, { { 0, 0, note, vel }, { static_cast<int>(5 * sr), 1, note, 0.0f } }, 256);
                bool fin = true;
                for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i])) { fin = false; break; }
                const double pk = std::max(peakOf(L, 0, N), peakOf(R, 0, N));
                const double pl = db(rmsOf(L, static_cast<size_t>(2.5 * sr), static_cast<size_t>(4.5 * sr)));
                const double tail = db(std::max(peakOf(L, N - 4800, N), peakOf(R, N - 4800, N)));
                std::printf("    %3d   %.1f   %8.1f   %12.1f   %12.1f\n", note, vel, db(pk), pl, tail);
                CHECK(fin, "NaN en nota %d", note);
                CHECK(pk > 0.002 && pk < 0.9, "pico fuera de rango en nota %d vel %.1f", note, vel);
                CHECK(tail < -90.0, "la cola no termina en silencio (nota %d: %.1f dBFS)", note, tail);
                if (vel > 0.5f) { lo = std::min(lo, pl); hi = std::max(hi, pl); }
            }
        }
        std::printf("    dispersion de nivel entre notas (vel 0.9): %.1f dB\n", hi - lo);
        CHECK(hi - lo < 9.0, "niveles muy desiguales entre notas (%.1f dB)", hi - lo);
    }

    // [S3] ataque lento y movimiento: la nota sube despacio (no hay golpe) y no queda plana ni oscila de mas
    if (on("S3")) {
        PadSettings s = def; s.reverb = 0.0; s.chorus = 0.0;   // ataque por defecto
        auto e = makeSampled(sr, s);
        const size_t N = static_cast<size_t>(10 * sr);
        std::vector<float> L(N), R(N);
        renderEv(*e, L, R, 0, N, { { 0, 0, 57, 0.7f }, { 0, 0, 64, 0.7f } }, 256);
        const double plateau = rmsOf(L, static_cast<size_t>(6 * sr), static_cast<size_t>(9 * sr));
        const double early = rmsOf(L, static_cast<size_t>(0.15 * sr), static_cast<size_t>(0.35 * sr));
        size_t t90 = 0;
        for (size_t a = 0; a + 2400 < N; a += 2400) if (rmsOf(L, a, a + 2400) >= 0.9 * plateau) { t90 = a; break; }
        std::printf("[S3] ataque por defecto %.2f s: RMS a 0.15-0.35 s = %.1f dB bajo la meseta; 90 %% de la meseta a los %.2f s\n", def.attack, db(plateau) - db(early), static_cast<double>(t90) / sr);
        CHECK(db(plateau) - db(early) > 12.0, "el ataque es demasiado rapido (solo %.1f dB bajo la meseta a 0.35 s)", db(plateau) - db(early));
        CHECK(static_cast<double>(t90) / sr >= 0.4, "el ataque por defecto es < 0.4 s");
        const std::vector<double> w = rmsWindows(L, sr, 0.25, 4.0);
        double mn = 1e9, mx = -1e9;
        for (double v : w) { mn = std::min(mn, v); mx = std::max(mx, v); }
        std::printf("    movimiento de la meseta (RMS en ventanas de 250 ms, 4..10 s): %.2f dB pico a pico\n    perfil RMS (dB, ventanas de 0.5 s):", mx - mn);
        for (double v : rmsWindows(L, sr, 0.5)) std::printf(" %.0f", v);
        std::printf("\n");
        CHECK(mx - mn < 8.0, "la meseta oscila demasiado (%.1f dB)", mx - mn);
    }

    // [S4] bucles sin clic: notas sostenidas 40 s (varios giros de bucle) en seco; detector validado con un clic sintetico
    if (on("S4")) {
        PadSettings s = def; s.reverb = 0.0; s.chorus = 0.0; s.cutoffHz = 20000.0; s.attack = 0.2;
        auto e = makeSampled(sr, s);
        const size_t N = static_cast<size_t>(40 * sr);
        std::vector<float> L(N), R(N);
        renderEv(*e, L, R, 0, N, { { 0, 0, 48, 0.8f }, { 0, 0, 60, 0.8f }, { 0, 0, 72, 0.8f } }, 512);
        const ClickStats cl = analyzeClicks(L, static_cast<size_t>(3 * sr), N, sr);
        std::printf("[S4] bucle sostenido 40 s (3 notas, filtro abierto): spike=%.1f periodicidad=%.2f @ %d ms\n", cl.spikeRatio, cl.periodicity, cl.periodicLagMs);
        CHECK(cl.spikeRatio < 12.0, "pico anomalo en la derivada: clic de bucle (%.1f)", cl.spikeRatio);
        CHECK(cl.periodicity < 0.30, "clics periodicos (bucle)");
        std::vector<float> Lc = L;
        for (size_t i = static_cast<size_t>(4 * sr); i < N; i += static_cast<size_t>(3.7 * sr)) Lc[i] += 0.004f;
        const ClickStats cc = analyzeClicks(Lc, static_cast<size_t>(3 * sr), N, sr);
        std::printf("    control positivo (clic de 0.004 cada 3.7 s): spike=%.1f\n", cc.spikeRatio);
        CHECK(cc.spikeRatio > cl.spikeRatio * 1.5 || cc.spikeRatio >= 12.0, "el detector no distingue un clic sintetico");
    }

    // [S5] estabilidad del shimmer con notas sostenidas 60 s (peor caso: shimmer 100 %, decay 20 s, reverb 100 %)
    if (on("S5")) for (int iv = 0; iv < 3; ++iv) {
        PadSettings s = def; s.shimmer = 1.0; s.rt60 = 20.0; s.reverb = 1.0; s.interval = iv; s.attack = 0.3;
        auto e = makeSampled(sr, s);
        const size_t N = static_cast<size_t>(60 * sr);
        std::vector<float> L(N), R(N);
        std::vector<Ev> ev;
        for (const int n : { 38, 50, 57, 62, 66, 74 }) ev.push_back({ 0, 0, n, 0.8f });
        renderEv(*e, L, R, 0, N, ev, 512);
        bool fin = true;
        for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i])) { fin = false; break; }
        const std::vector<double> w = rmsWindows(L, sr, 5.0);
        const double early = (w[3] + w[4] + w[5]) / 3.0, late = (w[9] + w[10] + w[11]) / 3.0;
        const double pk = std::max(peakOf(L, 0, N), peakOf(R, 0, N));
        std::printf("[S5] shimmer 100%% intervalo %d, 60 s: RMS 15-30 s=%.1f dB, 45-60 s=%.1f dB (deriva %+.2f dB), pico=%.3f, finito=%d\n", iv, early, late, late - early, pk, fin ? 1 : 0);
        CHECK(fin, "NaN con shimmer sostenido");
        CHECK(late - early < 1.0, "el shimmer crece con notas sostenidas (%+.2f dB)", late - early);
        CHECK(pk < 0.98, "pico >= 0.98 con shimmer sostenido");
    }

    // [S6] envio a la reverb sin graves: el envio filtra < 150 Hz, asi que (humedo vs seco) la banda grave cae frente a las medias
    if (on("S6")) {
        double rel[2];   // (200-2k) - (40-100 Hz) en dB por Hz: 0 = humedo, 1 = seco
        for (int dry = 0; dry < 2; ++dry) {
            PadSettings s = def; s.attack = 0.2; s.shimmer = 0.0; s.cutoffHz = 20000.0; s.chorus = 0.0;
            if (dry) { s.reverb = 0.0; } else { s.wetOnly = true; }
            auto e = makeSampled(sr, s);
            const size_t N = static_cast<size_t>(10 * sr);
            std::vector<float> L(N), R(N);
            renderEv(*e, L, R, 0, N, { { 0, 0, 38, 0.8f }, { 0, 0, 50, 0.8f } }, 512);
            const std::vector<double> m = spectrum(L, static_cast<size_t>(4 * sr), 65536);
            const double bin = sr / 65536.0;
            auto band = [&](double f0, double f1) { double a = 0.0; size_t c = 0; for (size_t k = static_cast<size_t>(f0 / bin); k < static_cast<size_t>(f1 / bin); ++k) { a += m[k] * m[k]; ++c; } return 10.0 * std::log10(a / static_cast<double>(c) + 1e-30); };
            rel[dry] = band(200.0, 2000.0) - band(40.0, 100.0);
        }
        std::printf("[S6] graves 40-100 Hz frente a 200-2k (dB por Hz): seco %.1f dB, humedo %.1f dB (informativo: el amortiguador de la FDN tambien colorea)\n", rel[1], rel[0]);
        // medida directa del filtro del envio (paso alto de 150 Hz, 2.o orden)
        HighPass2 hp; hp.design(sr, 150.0);
        auto gainAt = [&](double f) {
            hp.reset();
            double peak = 0.0;
            for (int i = 0; i < static_cast<int>(sr * 2); ++i) { const double y = hp.process(0, std::sin(kTwoPi * f * i / sr)); if (i > static_cast<int>(sr)) peak = std::max(peak, std::fabs(y)); }
            return db(peak);
        };
        const double g50 = gainAt(50.0), g75 = gainAt(75.0), g150 = gainAt(150.0), g1k = gainAt(1000.0);
        std::printf("    envio a la reverb (paso alto 150 Hz): 50 Hz %.1f dB, 75 Hz %.1f dB, 150 Hz %.1f dB, 1 kHz %.1f dB\n", g50, g75, g150, g1k);
        CHECK(g50 < -18.0 && g75 < -10.0 && g150 > -4.0 && g150 < -2.0 && g1k > -0.5, "paso alto del envio mal ajustado");
    }

    // [S7] barrido de estabilidad: sr, bloques y parametros agresivos, sin NaN
    if (on("S7")) {
        long bad = 0; int runs = 0;
        for (const double r : { 44100.0, 48000.0, 96000.0, 192000.0 }) {
            for (const int blk : { 1, 64, 480, 4096 }) {
                PadSettings s = def;
                s.cutoffHz = 20.0 * std::pow(900.0, (runs % 7) / 6.0); s.resonance = (runs % 3) / 2.0; s.shimmer = (runs % 2) ? 1.0 : 0.3;
                s.reverb = 1.0; s.attack = 0.02; s.release = 0.1 + 3.0 * (runs % 4); s.lfoHz = 8.0; s.interval = runs % 3; s.modWheel = (runs % 5) / 4.0;
                auto e = makeSampled(r, s);
                const size_t N = static_cast<size_t>(r * 3.0);
                std::vector<float> L(N), R(N);
                std::vector<Ev> ev;
                for (int k = 0; k < 30; ++k) { ev.push_back({ k * 2000, 0, 24 + (k * 5) % 90, 0.2f + 0.8f * ((k % 5) / 4.0f) }); if (k % 3 == 0) ev.push_back({ k * 2000 + 4000, 1, 24 + (k * 5) % 90, 0.0f }); }
                std::sort(ev.begin(), ev.end(), [](const Ev& a, const Ev& b) { return a.at < b.at; });
                renderEv(*e, L, R, 0, N, ev, blk);
                for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i]) || std::fabs(L[i]) > 1.0 || std::fabs(R[i]) > 1.0) ++bad;
                ++runs;
            }
        }
        std::printf("[S7] barrido sr x bloque x parametros (%d pasadas, 30 notas incl. fuera del banco): muestras malas=%ld\n", runs, bad);
        CHECK(bad == 0, "NaN/inf o desbordes");
    }

    // [S8] CPU con acorde grande (12 notas = ~36 voces de muestras), defecto
    if (on("S8")) {
        const size_t N = static_cast<size_t>(20 * sr);
        std::vector<float> L(N), R(N);
        std::vector<Ev> ev;
        for (int i = 0; i < 12; ++i) ev.push_back({ i * 10, 0, 36 + i * 5, 0.8f });
        double sec = 1e9;
        for (int rep = 0; rep < 3; ++rep) {
            auto er = makeSampled(sr, def);
            const double t0 = cpuSeconds();
            renderEv(*er, L, R, 0, N, ev, 512);
            sec = std::min(sec, cpuSeconds() - t0);
        }
        std::printf("[S8] CPU con 12 notas sostenidas (muestras + shimmer): %.2f %% de un nucleo\n", 100.0 * sec / 20.0);
        // desglose: sampler solo / reverb shimmer sola / ensemble solo (20 s de audio cada uno)
        {
            JwSampler::Sampler sp; sp.prepare(sr); sp.startLoad("shimmer-pad");
            while (!sp.ready() && sp.loading()) std::this_thread::sleep_for(std::chrono::milliseconds(10));
            for (int i = 0; i < 12; ++i) sp.noteOnStack(36 + i * 5, 0.8f);
            std::vector<float> a(512), b(512);
            double t0 = cpuSeconds();
            for (size_t k = 0; k < N / 512; ++k) { std::fill(a.begin(), a.end(), 0.f); std::fill(b.begin(), b.end(), 0.f); sp.render(a.data(), b.data(), 512); }
            const double tSp = cpuSeconds() - t0;
            ShimmerVerb v; v.prepare(sr); v.setRt60(9.0); v.setShimmer(0.45, 0);
            Xor rng; rng.seed(5);
            t0 = cpuSeconds();
            double l, r, acc = 0.0;
            for (size_t i = 0; i < N; ++i) { v.process(0.1 * rng.bi(), 0.1 * rng.bi(), l, r); acc += l + r; }
            const double tVb = cpuSeconds() - t0;
            Ensemble en; en.prepare(sr);
            t0 = cpuSeconds();
            for (size_t i = 0; i < N; ++i) { en.process(0.1 * rng.bi(), 0.1 * rng.bi(), 0.45, l, r); acc += l + r; }
            const double tEn = cpuSeconds() - t0;
            std::printf("    desglose (%% de un nucleo): sampler %.2f (%d voces) | reverb shimmer %.2f | ensemble %.2f  [%g]\n", 100.0 * tSp / 20.0, sp.activeVoices(), 100.0 * tVb / 20.0, 100.0 * tEn / 20.0, acc * 0.0);
        }
        CHECK(100.0 * sec / 20.0 < 8.0, "CPU >= 8 %%");
    }

    // [S9] WAV de 18 s: acorde D sostenido 6 s, cambio a G (6..12 s), cola; ajustes por defecto
    if (on("S9")) {
        auto e = makeSampled(sr, def);
        const size_t N = static_cast<size_t>(18 * sr);
        std::vector<float> L(N, 0.0f), R(N, 0.0f);
        const int d[] = { 38, 50, 57, 62, 66 }, g[] = { 43, 50, 55, 59, 62, 67 };
        std::vector<Ev> ev;
        for (int k = 0; k < 5; ++k) { ev.push_back({ k * 1500, 0, d[k], 0.62f + 0.05f * k }); ev.push_back({ static_cast<int>(6 * sr) + k * 400, 1, d[k], 0.0f }); }
        for (int k = 0; k < 6; ++k) { ev.push_back({ static_cast<int>(6 * sr) + k * 1500, 0, g[k], 0.62f + 0.04f * k }); ev.push_back({ static_cast<int>(12 * sr) + k * 400, 1, g[k], 0.0f }); }
        std::sort(ev.begin(), ev.end(), [](const Ev& a, const Ev& b) { return a.at < b.at; });
        renderEv(*e, L, R, 0, N, ev, 512);
        const double pk = std::max(peakOf(L, 0, N), peakOf(R, 0, N));
        const double rm = 0.5 * (rmsOf(L, static_cast<size_t>(3 * sr), static_cast<size_t>(11 * sr)) + rmsOf(R, static_cast<size_t>(3 * sr), static_cast<size_t>(11 * sr)));
        double dc = 0.0; bool fin = true;
        for (size_t i = 0; i < N; ++i) { dc += L[i]; if (!std::isfinite(L[i]) || !std::isfinite(R[i])) fin = false; }
        dc /= static_cast<double>(N);
        double sl = 0, sr2 = 0, slr = 0;
        for (size_t i = static_cast<size_t>(3 * sr); i < static_cast<size_t>(11 * sr); ++i) { sl += L[i] * L[i]; sr2 += R[i] * R[i]; slr += L[i] * R[i]; }
        const double cen = std::pow(2.0, centroidOct(L, static_cast<size_t>(8 * sr), 65536, sr));
        std::printf("[S9] acorde D -> G: pico=%.1f dBFS, RMS=%.1f dBFS, DC=%.1e, correlacion L/R=%.2f, centroide=%.0f Hz, finito=%d -> %s\n",
                    db(pk), db(rm), dc, slr / std::sqrt(sl * sr2 + 1e-30), cen, fin ? 1 : 0, wavPath);
        CHECK(fin, "NaN en el acorde");
        CHECK(pk < 0.98, "pico >= 0.98");
        CHECK(db(rm) > -40.0 && db(rm) < -12.0, "nivel RMS fuera de rango (%.1f dBFS)", db(rm));
        CHECK(std::fabs(dc) < 1e-3, "DC");
        CHECK(slr / std::sqrt(sl * sr2 + 1e-30) < 0.9, "imagen estereo casi mono");
        CHECK(writeWav24(wavPath, L, R, 48000), "no se pudo escribir el WAV");
    }
    std::printf("\n%s (%d fallos)\n", g_fail == 0 ? "TODO CORRECTO" : "HAY FALLOS", g_fail);
    return g_fail == 0 ? 0 : 1;
}


// ------------------------------------------------------------------ 7. FX Rack comun (jw_fxrack.h)
static uint64_t renderHash(PadEngine& e, double sr, int block) {
    const size_t N = static_cast<size_t>(6 * sr);
    std::vector<float> L(N, 0.0f), R(N, 0.0f);
    std::vector<Ev> ev;
    const int notes[] = { 38, 50, 57, 62, 66 };
    for (int k = 0; k < 5; ++k) { ev.push_back({ k * 700, 0, notes[k], 0.6f + 0.05f * k }); ev.push_back({ static_cast<int>(3 * sr) + k * 300, 1, notes[k], 0.0f }); }
    renderEv(e, L, R, 0, N, ev, block);
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < N; ++i) { uint32_t a, b; std::memcpy(&a, &L[i], 4); std::memcpy(&b, &R[i], 4); h = (h ^ a) * 1099511628211ull; h = (h ^ b) * 1099511628211ull; }
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
        const uint64_t golden = 0x4e902380394f155dull;   // hash de la salida SIN rack (motor previo a la integracion)
        PadEngine e0; e0.prepare(SR, 512); PadSettings s; e0.setSettings(s); e0.settle();
        const uint64_t h0 = renderHash(e0, SR, 512);
        // con valores de rack ajustados pero TODOS los bloques apagados
        PadEngine e1; e1.prepare(SR, 512); e1.setSettings(s); e1.settle();
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
        PadEngine e2; e2.prepare(SR, 512); e2.setSettings(s); e2.settle();
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
            fft(z);
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
            Xor rng; rng.seed(77);
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
        Xor rng; rng.seed(3);
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
                Xor rng; rng.seed(1000 + runs);
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
            Xor rng; rng.seed(9);
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
        Xor rng; rng.seed(21);
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

    // ---- 7.11 motor: con todo encendido sigue siendo finito y acotado; el espectro/pico se miden tras el rack ----
    {
        PadEngine e; e.prepare(SR, 512); PadSettings s; e.setSettings(s); e.settle();
        FxParams q = porDefecto(); q.hpfOn = q.eqOn = q.compOn = q.satOn = q.chOn = q.dlOn = q.rvOn = q.outOn = true;
        q.eq[1].gainDb = 8.0; q.outGainDb = -6.0;
        e.setFx(q);
        PadBus bus;
        const size_t N = static_cast<size_t>(6 * SR);
        std::vector<float> L(N, 0.0f), R(N, 0.0f);
        renderEv(e, L, R, 0, N, { { 0, 0, 50, 0.8f }, { 0, 0, 57, 0.8f }, { 0, 0, 66, 0.8f } }, 512, &bus);
        bool fin = true; for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i]) || std::fabs(L[i]) > 1.0f) fin = false;
        std::printf("    motor con rack completo: finito y |x|<=1 = %d, GR publicado en el bus = %.2f dB\n", fin ? 1 : 0, bus.fxGrDb.load());
        CHECK(fin, "motor + rack no finito");
    }
}

int main(int argc, char** argv) {
    if (argc > 1 && std::strcmp(argv[argc - 1], "--samples") == 0)
        return samplesTest(argc > 2 ? argv[1] : "shimmer_pad_samples.wav");
#ifdef _WIN32
    _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");   // la suite modelada prueba el respaldo sin banco
#endif
    const char* wav = argc > 1 ? argv[1] : "shimmer_pad_progresion.wav";
    const std::string only = argc > 2 ? argv[2] : "";   // p. ej. "34" ejecuta solo las pruebas 3 y 4
    auto run = [&](char id) { return only.empty() || only.find(id) != std::string::npos; };
    ScopedNoDenormals nd;
    if (run('1')) testSweep();
    if (run('2')) testRt60();
    if (run('3')) testClicks();
    if (run('4')) { testNotes(); testShimmerReal(); }
    if (run('5')) testCpu();
    if (run('6')) renderProgression(wav);
    if (run('7')) testFxRack();
    std::printf("\n%s (%d fallos)\n", g_fail == 0 ? "TODO CORRECTO" : "HAY FALLOS", g_fail);
    return g_fail == 0 ? 0 : 1;
}
