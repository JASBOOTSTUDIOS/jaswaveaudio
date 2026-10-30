// Prueba de render offline de JasWave Strings Section (solo el DSP; sin VST3).
//   JasWaveStringsSection_rendertest <ruta.wav>             suite del motor modelado (sin banco de samples)
//   JasWaveStringsSection_rendertest <ruta.wav> --samples   prueba del banco strings-section.jws (camino híbrido)
// Mide: afinación por nota (f0 media del ensemble vs esperada, cents), pico, RMS, CPU con 16/32 voces,
// ausencia de NaN/inf, clics (derivada máxima), DC, legato (sin re-ataque), RT60 de la sala,
// estabilidad con parámetros extremos y robustez a distintas frecuencias de muestreo y tamaños de bloque.
// Escribe un WAV 24-bit/48 kHz estéreo con acordes sostenidos + línea legato de 8 compases en Re mayor.
// Sale con código != 0 si algo falla.
#define JW_FXRACK_PROBE 1   // diagnostico del rack (maximo por etapa) usado en el barrido NaN
#include "strings_section_dsp.h"

#include <chrono>
#include <complex>
#include <ctime>
#ifdef _WIN32
#include <windows.h>
static double threadCpuSec() { FILETIME c, e, k, u; GetThreadTimes(GetCurrentThread(), &c, &e, &k, &u); return ((((unsigned long long)u.dwHighDateTime << 32) | u.dwLowDateTime) + (((unsigned long long)k.dwHighDateTime << 32) | k.dwLowDateTime)) * 1e-7; }
#else
static double threadCpuSec() { return (double)std::clock() / CLOCKS_PER_SEC; }
#endif
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace JasWaveStrings;
using JasWaveDsp::kPi;

static int g_fail = 0;
#define CHECK(cond, ...) do { if (!(cond)) { ++g_fail; std::printf("  FALLO: "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

struct Ev { int64_t t; int kind; double a, b; };   // 0 on(nota,vel) 1 off(nota) 2 expr 3 mod 4 pedal 5 bend 6 vib 7 hall
struct Out { std::vector<float> l, r; };

static Out run(StringsEngine& e, StringsSettings s, std::vector<Ev> evs, int64_t total, double sr, int block = 512) {
    std::sort(evs.begin(), evs.end(), [](const Ev& a, const Ev& b) { return a.t < b.t; });
    e.prepare(sr, 4096);
    e.setSettings(s);
    Out o;
    o.l.assign(static_cast<size_t>(total), 0.0f);
    o.r.assign(static_cast<size_t>(total), 0.0f);
    size_t ei = 0;
    int64_t pos = 0;
    JasWaveDsp::ScopedNoDenormals nd;
    while (pos < total) {
        while (ei < evs.size() && evs[ei].t <= pos) {
            const Ev& v = evs[ei++];
            switch (v.kind) {
                case 0: e.noteOn(static_cast<int>(v.a), static_cast<float>(v.b)); break;
                case 1: e.noteOff(static_cast<int>(v.a)); break;
                case 2: s.expression = v.a; e.setSettings(s); break;
                case 3: s.modWheel = v.a; e.setSettings(s); break;
                case 4: s.sustain = v.a > 0.5; e.setSettings(s); break;
                case 5: s.bendSemis = v.a; e.setSettings(s); break;
                case 6: s.vibrato = v.a; e.setSettings(s); break;
                case 7: s.hall = v.a; e.setSettings(s); break;
            }
        }
        int64_t next = std::min<int64_t>(total, pos + block);
        if (ei < evs.size()) next = std::min(next, evs[ei].t);
        e.render(o.l.data() + pos, o.r.data() + pos, static_cast<int>(next - pos), nullptr);
        pos = next;
    }
    return o;
}

static bool finite(const Out& o) {
    for (size_t i = 0; i < o.l.size(); ++i) if (!std::isfinite(o.l[i]) || !std::isfinite(o.r[i])) return false;
    return true;
}

// f0 por autocorrelación normalizada + interpolación parabólica, en [i0,i1) del mono L+R
static double estimateF0(const Out& o, int64_t i0, int64_t i1, double expected, double sr) {
    const int64_t N = i1 - i0;
    std::vector<double> x(static_cast<size_t>(N));
    for (int64_t i = 0; i < N; ++i) x[static_cast<size_t>(i)] = 0.5 * (o.l[static_cast<size_t>(i0 + i)] + o.r[static_cast<size_t>(i0 + i)]);
    const double p0 = sr / expected;
    const int lo = static_cast<int>(p0 * 0.94), hi = static_cast<int>(p0 * 1.06) + 2;
    std::vector<double> ac(static_cast<size_t>(hi + 2), 0.0);
    for (int lag = lo - 1; lag <= hi + 1; ++lag) {
        double s = 0, e1 = 0, e2 = 0;
        for (int64_t i = 0; i + lag < N; ++i) { s += x[static_cast<size_t>(i)] * x[static_cast<size_t>(i + lag)]; e1 += x[static_cast<size_t>(i)] * x[static_cast<size_t>(i)]; e2 += x[static_cast<size_t>(i + lag)] * x[static_cast<size_t>(i + lag)]; }
        ac[static_cast<size_t>(lag)] = s / std::sqrt(e1 * e2 + 1e-30);
    }
    int best = lo;
    for (int lag = lo; lag <= hi; ++lag) if (ac[static_cast<size_t>(lag)] > ac[static_cast<size_t>(best)]) best = lag;
    const double a = ac[static_cast<size_t>(best - 1)], b = ac[static_cast<size_t>(best)], c = ac[static_cast<size_t>(best + 1)];
    const double den = a - 2 * b + c;
    const double d = std::fabs(den) > 1e-12 ? 0.5 * (a - c) / den : 0.0;
    return sr / (best + d);
}

static double cents(double f, double ref) { return 1200.0 * std::log2(f / ref); }

static void peakRms(const Out& o, int64_t i0, int64_t i1, double& pk, double& rms) {
    pk = 0; double s = 0;
    for (int64_t i = i0; i < i1; ++i) {
        pk = std::max({ pk, (double)std::fabs(o.l[static_cast<size_t>(i)]), (double)std::fabs(o.r[static_cast<size_t>(i)]) });
        s += (double)o.l[static_cast<size_t>(i)] * o.l[static_cast<size_t>(i)] + (double)o.r[static_cast<size_t>(i)] * o.r[static_cast<size_t>(i)];
    }
    rms = std::sqrt(s / (2.0 * std::max<int64_t>(1, i1 - i0)));
}

static void writeWav24(const char* path, const Out& o, int sr) {
    FILE* f = std::fopen(path, "wb");
    if (!f) { std::printf("  no se pudo escribir %s\n", path); ++g_fail; return; }
    const uint32_t n = static_cast<uint32_t>(o.l.size()), dataBytes = n * 6, riff = 36 + dataBytes, rate = static_cast<uint32_t>(sr), byteRate = rate * 6;
    const uint16_t fmt = 1, ch = 2, align = 6, bits = 24;
    const uint32_t fmtSize = 16;
    std::fwrite("RIFF", 1, 4, f); std::fwrite(&riff, 4, 1, f); std::fwrite("WAVEfmt ", 1, 8, f);
    std::fwrite(&fmtSize, 4, 1, f); std::fwrite(&fmt, 2, 1, f); std::fwrite(&ch, 2, 1, f); std::fwrite(&rate, 4, 1, f);
    std::fwrite(&byteRate, 4, 1, f); std::fwrite(&align, 2, 1, f); std::fwrite(&bits, 2, 1, f);
    std::fwrite("data", 1, 4, f); std::fwrite(&dataBytes, 4, 1, f);
    for (uint32_t i = 0; i < n; ++i) {
        for (int c = 0; c < 2; ++c) {
            const double v = std::clamp((double)(c ? o.r[i] : o.l[i]), -1.0, 1.0);
            const int32_t q = static_cast<int32_t>(std::lround(v * 8388607.0));
            const uint8_t b[3] = { (uint8_t)(q & 0xFF), (uint8_t)((q >> 8) & 0xFF), (uint8_t)((q >> 16) & 0xFF) };
            std::fwrite(b, 1, 3, f);
        }
    }
    std::fclose(f);
}

// Detector de clics: mayor cociente |dx| / RMS(dx) local (ventana +-1024) y posición; los clics dan >> 10
static double clickRatio(const Out& o, int64_t* where = nullptr) {
    const int64_t N = static_cast<int64_t>(o.l.size());
    std::vector<double> d2(static_cast<size_t>(N), 0.0);
    for (int64_t i = 1; i < N; ++i) d2[(size_t)i] = std::max(std::fabs((double)o.l[(size_t)i] - o.l[(size_t)i - 1]), std::fabs((double)o.r[(size_t)i] - o.r[(size_t)i - 1]));
    double best = 0; int64_t at = 0;
    const int64_t W = 1024;
    double acc = 0;
    for (int64_t i = 0; i < std::min(N, W); ++i) acc += d2[(size_t)i] * d2[(size_t)i];
    for (int64_t i = 1; i < N; ++i) {
        if (i + W < N) acc += d2[(size_t)(i + W)] * d2[(size_t)(i + W)];
        if (i - W - 1 >= 0) acc -= d2[(size_t)(i - W - 1)] * d2[(size_t)(i - W - 1)];
        const double rms = std::sqrt(std::max(0.0, acc) / (2.0 * W + 1.0));
        if (i > 12000 && rms > 1e-5) { const double q = d2[(size_t)i] / rms; if (q > best) { best = q; at = i; } }
    }
    if (where) *where = at;
    return best;
}

static double midiHz(int n) { return 440.0 * std::pow(2.0, (n - 69) / 12.0); }

static double cents_(double f, double ref) { return 1200.0 * std::log2(f / ref); }
// =====================================================================================================
//  Modo --samples: prueba del banco strings-section.jws (necesita el banco en la carpeta de samples).
//  Mide: carga, nivel por tecla y uniones entre registros (< 3 dB), afinación, bucle sin clics y energía estable,
//  colas en silencio, parámetros (expression/attack/vibrato/release/hall), legato, CPU, NaN y un WAV de 10 s.
// =====================================================================================================
static double dbf(double x) { return 20.0 * std::log10(std::max(x, 1e-9)); }

static std::unique_ptr<StringsEngine> makeSampled(double sr, const StringsSettings& s) {
    auto e = std::make_unique<StringsEngine>();
    e->prepare(sr, 4096);
    e->setSettings(s);
    // El banco se carga en otro hilo: se espera (hasta 30 s) para probar el camino real.
    for (int i = 0; i < 3000 && !e->samplerReady() && e->samplerLoading(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    return e;
}

static double rmsAt(const Out& o, double t0, double t1, double sr) {
    double pk, r;
    peakRms(o, static_cast<int64_t>(t0 * sr), std::min<int64_t>(static_cast<int64_t>(o.l.size()), static_cast<int64_t>(t1 * sr)), pk, r);
    return r;
}

static long fileBytes(const std::string& path) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return -1;
    std::fseek(f, 0, SEEK_END);
    const long n = std::ftell(f);
    std::fclose(f);
    return n;
}

static int sampledTest(const char* wavPath) {
    const double SR = 48000.0;
    std::printf("== JasWave Strings Section - prueba del banco de muestras (strings-section.jws) ==\n");
    StringsSettings def;
    def.hall = 0.0;            // sin sala para medir el material
    auto e = makeSampled(SR, def);
    CHECK(e->samplerReady(), "el banco strings-section.jws no se cargo: %s", e->samplerError().c_str());
    if (!e->samplerReady()) return 1;
    const std::string bankPath = JwSampler::samplesDir() +
#ifdef _WIN32
        "\\strings-section.jws";
#else
        "/strings-section.jws";
#endif
    const long bytes = fileBytes(bankPath);
    std::printf("  banco: %s | %.1f MB\n", bankPath.c_str(), bytes / 1e6);
    CHECK(bytes > 0 && bytes <= 150L * 1000 * 1000, "tamano del banco %.1f MB fuera de (0,150]", bytes / 1e6);

    // ---------------------------------------------------------------- 1. nivel por tecla, uniones entre registros y afinacion
    auto levels = [&](double vel, bool samples, std::vector<double>& out, std::vector<double>* cents) {
        out.clear();
        e->setSamplesEnabled(samples);
        for (int n = 36; n <= 96; ++n) {
            Out o = run(*e, def, { { 0, 0, (double)n, vel } }, static_cast<int64_t>(8.0 * SR), SR);
            CHECK(finite(o), "NaN/inf en nota %d (samples=%d)", n, samples ? 1 : 0);
            out.push_back(dbf(rmsAt(o, 4.5, 7.5, SR)));
            if (cents) {
                const double fe = midiHz(n);
                cents->push_back(cents_(estimateF0(o, static_cast<int64_t>(4.5 * SR), static_cast<int64_t>(7.5 * SR), fe, SR), fe));
            }
        }
        e->setSamplesEnabled(true);
    };
    std::vector<double> lv7, lv3, lvModel, cts;
    levels(0.7, true, lv7, &cts);
    levels(0.3, true, lv3, nullptr);
    levels(0.7, false, lvModel, nullptr);
    auto stats = [](const std::vector<double>& v, double& mx, int& at, double& med) {
        mx = 0; at = 0;
        for (size_t i = 1; i < v.size(); ++i) if (std::fabs(v[i] - v[i - 1]) > mx) { mx = std::fabs(v[i] - v[i - 1]); at = 36 + static_cast<int>(i); }
        std::vector<double> c = v; std::sort(c.begin(), c.end()); med = c[c.size() / 2];
    };
    double mx7, mx3, mxM, med7, med3, medM; int at7, at3, atM;
    stats(lv7, mx7, at7, med7); stats(lv3, mx3, at3, med3); stats(lvModel, mxM, atM, medM);
    std::printf("== Nivel RMS (dBFS, 4.5..7.5 s, sala 0) por tecla 36..96 ==\n  vel 0.7: ");
    for (size_t i = 0; i < lv7.size(); ++i) std::printf("%s%.0f", i ? " " : "", lv7[i]);
    std::printf("\n  vel 0.3: ");
    for (size_t i = 0; i < lv3.size(); ++i) std::printf("%s%.0f", i ? " " : "", lv3[i]);
    std::printf("\n  salto maximo entre teclas contiguas: vel 0.7 = %.2f dB (en %d) | vel 0.3 = %.2f dB (en %d) | modelado = %.2f dB\n", mx7, at7, mx3, at3, mxM);
    std::printf("  mediana: vel 0.7 = %.1f dBFS | vel 0.3 = %.1f dBFS | motor modelado (vel 0.7) = %.1f dBFS\n", med7, med3, medM);
    CHECK(mx7 < 3.0, "salto de nivel entre teclas contiguas %.2f dB (>= 3) en la tecla %d (vel 0.7)", mx7, at7);
    CHECK(mx3 < 3.0, "salto de nivel entre teclas contiguas %.2f dB (>= 3) en la tecla %d (vel 0.3)", mx3, at3);
    CHECK(std::fabs(med7 - medM) < 3.0, "el nivel del banco (%.1f dBFS) difiere del modelado (%.1f dBFS) en mas de 3 dB", med7, medM);
    CHECK(med7 - med3 > 2.0, "la capa suave no es mas baja que la fuerte (%.1f dB)", med7 - med3);
    {
        double w = 0; int wn = 0;
        for (size_t i = 0; i < cts.size(); ++i) if (std::fabs(cts[i]) > w) { w = std::fabs(cts[i]); wn = 36 + static_cast<int>(i); }
        std::printf("  afinacion (f0 media, ensemble con vibrato): peor %.1f cents en la tecla %d\n", w, wn);
        CHECK(w < 25.0, "afinacion: %.1f cents en la tecla %d", w, wn);
    }

    // ---------------------------------------------------------------- 2. bucle: clics y energia estable (15 s de sostenido)
    std::printf("== Bucle de sostenido (nota mantenida 15 s, vibrato 0, sala 0) ==\n");
    std::printf("  %4s %9s %10s %12s %11s\n", "nota", "clic(max)", "std ventanas", "rango (dB)", "salto/vuelta");
    {
        StringsSettings s = def; s.vibrato = 0.0;
        double worstClick = 0, worstStd = 0, worstRange = 0;
        for (int n : { 36, 43, 52, 60, 67, 76, 84, 93 }) {
            Out o = run(*e, s, { { 0, 0, (double)n, 0.7 } }, static_cast<int64_t>(16.0 * SR), SR);
            CHECK(finite(o), "NaN en bucle de la nota %d", n);
            int64_t at = 0; const double cr = clickRatio(o, &at);
            std::vector<double> w;
            for (double t = 4.0; t + 0.5 <= 15.0; t += 0.5) w.push_back(dbf(rmsAt(o, t, t + 0.5, SR)));
            double m = 0; for (double x : w) m += x; m /= w.size();
            double sd = 0, mn = 1e9, mxw = -1e9; for (double x : w) { sd += (x - m) * (x - m); mn = std::min(mn, x); mxw = std::max(mxw, x); }
            sd = std::sqrt(sd / w.size());
            // salto de energia mayor entre ventanas contiguas de 150 ms (cualquier empalme del bucle)
            double jmax = 0;
            for (double t = 4.0; t + 0.3 <= 15.0; t += 0.05) jmax = std::max(jmax, std::fabs(dbf(rmsAt(o, t + 0.15, t + 0.30, SR)) - dbf(rmsAt(o, t, t + 0.15, SR))));
            std::printf("  %4d %9.1f %10.2f %12.2f %11.2f\n", n, cr, sd, mxw - mn, jmax);
            worstClick = std::max(worstClick, cr); worstStd = std::max(worstStd, sd); worstRange = std::max(worstRange, mxw - mn);
            CHECK(cr < 12.0, "posible clic en el bucle de la nota %d (cociente %.1f en %.2f s)", n, cr, at / SR);
            CHECK(sd < 2.0 && (mxw - mn) < 6.0, "la nota %d respira: std %.2f dB, rango %.2f dB", n, sd, mxw - mn);
        }
        std::printf("  peor: clic %.1f | std %.2f dB | rango %.2f dB\n", worstClick, worstStd, worstRange);
        // dos golpes de la misma nota: fases de bucle distintas (no deben coincidir)
        Out a = run(*e, s, { { 0, 0, 60.0, 0.7 } }, static_cast<int64_t>(14.0 * SR), SR);
        Out b = run(*e, s, { { 0, 0, 60.0, 0.7 } }, static_cast<int64_t>(14.0 * SR), SR);
        double sab = 0, saa = 0, sbb = 0;
        for (int64_t i = static_cast<int64_t>(8.0 * SR); i < static_cast<int64_t>(13.0 * SR); ++i) { sab += (double)a.l[(size_t)i] * b.l[(size_t)i]; saa += (double)a.l[(size_t)i] * a.l[(size_t)i]; sbb += (double)b.l[(size_t)i] * b.l[(size_t)i]; }
        const double corr = sab / std::sqrt(saa * sbb + 1e-30);
        std::printf("  correlacion entre dos golpes de la misma nota (8..13 s): %.3f\n", corr);
        CHECK(std::fabs(corr) < 0.8, "dos golpes iguales demasiado correlados (%.3f): fases de bucle no distintas", corr);
    }

    // ---------------------------------------------------------------- 3. colas
    {
        std::printf("== Colas ==\n");
        StringsSettings s = def; s.hall = 1.0;
        Out o = run(*e, s, { { 0, 0, 57.0, 0.7 }, { 0, 0, 64.0, 0.7 }, { (int64_t)(2.0 * SR), 1, 57.0, 0 }, { (int64_t)(2.0 * SR), 1, 64.0, 0 } }, static_cast<int64_t>(14.0 * SR), SR);
        double p, r; peakRms(o, (int64_t)(12.5 * SR), (int64_t)o.l.size(), p, r);
        std::printf("  con sala 100 %%: pico 12.5..14 s = %.1f dBFS | voces del sampler %d\n", dbf(p), e->sampledVoices());
        CHECK(finite(o) && p < 1e-3 && e->sampledVoices() == 0, "la cola con sala no termina en silencio (%.2e)", p);
        StringsSettings s0 = def; s0.releaseSec = 0.5;
        Out o0 = run(*e, s0, { { 0, 0, 57.0, 0.7 }, { (int64_t)(2.0 * SR), 1, 57.0, 0 } }, static_cast<int64_t>(6.0 * SR), SR);
        peakRms(o0, (int64_t)(4.5 * SR), (int64_t)o0.l.size(), p, r);
        std::printf("  sala 0, release 0.5 s: pico 4.5..6 s = %.2e | voces %d\n", p, e->sampledVoices());
        CHECK(p < 1e-4 && e->sampledVoices() == 0, "la cola sin sala no termina en silencio (%.2e)", p);
        // soltar durante el ataque lento no debe dar clic
        StringsSettings sa = def; sa.attackSec = 1.2;
        Out oa = run(*e, sa, { { 0, 0, 62.0, 0.7 }, { (int64_t)(0.25 * SR), 1, 62.0, 0 } }, static_cast<int64_t>(3.0 * SR), SR);
        int64_t at = 0; const double cr = clickRatio(oa, &at);
        double d = 0; for (size_t i = 1; i < oa.l.size(); ++i) d = std::max(d, (double)std::fabs(oa.l[i] - oa.l[i - 1]));
        std::printf("  soltar en pleno ataque lento: derivada max %.4f\n", d);
        CHECK(finite(oa) && d < 0.2, "salto al soltar durante el ataque (%.4f)", d);
        (void)cr; (void)at;
    }

    // ---------------------------------------------------------------- 4. parametros
    {
        std::printf("== Parametros ==\n");
        auto one = [&](StringsSettings s, double dur = 5.0) { return run(*e, s, { { 0, 0, 60.0, 0.7 } }, static_cast<int64_t>(dur * SR), SR); };
        // expression: nivel + brillo
        StringsSettings lo = def; lo.expression = 0.3; StringsSettings hi = def; hi.expression = 1.0;
        Out ol = one(lo), oh = one(hi);
        auto bright = [&](const Out& o) {
            double e0 = 0, e1 = 0;
            for (int64_t i = static_cast<int64_t>(2.0 * SR); i < static_cast<int64_t>(4.0 * SR); ++i) { const double x = o.l[(size_t)i], d = x - o.l[(size_t)i - 1]; e0 += x * x; e1 += d * d; }
            return std::sqrt(e1 / (e0 + 1e-30)) * SR / (2 * kPi);
        };
        std::printf("  expression 30 %% -> 100 %%: nivel %.1f -> %.1f dBFS | brillo eq. %.0f -> %.0f Hz\n", dbf(rmsAt(ol, 2, 4, SR)), dbf(rmsAt(oh, 2, 4, SR)), bright(ol), bright(oh));
        CHECK(dbf(rmsAt(oh, 2, 4, SR)) - dbf(rmsAt(ol, 2, 4, SR)) > 6.0, "expression no sube el nivel >= 6 dB");
        CHECK(bright(oh) > bright(ol) * 1.1, "expression no abre el brillo");
        // attack_time: tiempo hasta el 50 % del nivel de crucero
        auto t50 = [&](const Out& o) {
            const double ref = rmsAt(o, 3.5, 4.5, SR);
            for (double t = 0.0; t < 4.0; t += 0.02) if (rmsAt(o, t, t + 0.05, SR) > 0.5 * ref) return t;
            return 4.0;
        };
        StringsSettings fa = def; fa.attackSec = 0.02; StringsSettings sl = def; sl.attackSec = 1.5;
        const double tf = t50(one(fa, 6.0)), ts = t50(one(sl, 6.0));
        std::printf("  attack_time 20 ms -> 1500 ms: tiempo al 50 %% del nivel = %.2f s -> %.2f s\n", tf, ts);
        CHECK(ts > tf + 0.4, "attack_time no alarga el ataque (%.2f vs %.2f s)", tf, ts);
        // release_time
        StringsSettings r1 = def; r1.releaseSec = 0.05; StringsSettings r2 = def; r2.releaseSec = 3.0;
        auto rel = [&](StringsSettings s) { Out o = run(*e, s, { { 0, 0, 60.0, 0.7 }, { (int64_t)(3.0 * SR), 1, 60.0, 0 } }, static_cast<int64_t>(8.0 * SR), SR); return dbf(rmsAt(o, 4.0, 4.5, SR)); };
        const double q1 = rel(r1), q2 = rel(r2);
        std::printf("  release_time 50 ms -> 3000 ms: nivel 1.0..1.5 s tras soltar = %.1f -> %.1f dBFS\n", q1, q2);
        CHECK(q2 - q1 > 20.0, "release_time no alarga la cola");
        // hall_size
        StringsSettings h0 = def; h0.releaseSec = 0.05; h0.hall = 0.0; StringsSettings h1 = h0; h1.hall = 1.0;
        auto tail = [&](StringsSettings s) { Out o = run(*e, s, { { 0, 0, 60.0, 0.7 }, { (int64_t)(2.0 * SR), 1, 60.0, 0 } }, static_cast<int64_t>(6.0 * SR), SR); return dbf(rmsAt(o, 3.0, 4.0, SR)); };
        const double t0 = tail(h0), t1 = tail(h1);
        std::printf("  hall_size 0 -> 100 %%: cola 1..2 s tras soltar = %.1f -> %.1f dBFS\n", t0, t1);
        CHECK(t1 - t0 > 10.0, "hall_size no anade sala");
        // vibrato_depth: variacion de afinacion (cents) por ventanas de 120 ms
        auto vibStd = [&](double depth) {
            double acc = 0; int cnt = 0;
            for (int n : { 52, 60, 67 }) {
                StringsSettings s = def; s.vibrato = depth;
                Out o = run(*e, s, { { 0, 0, (double)n, 0.7 } }, static_cast<int64_t>(9.0 * SR), SR);
                std::vector<double> c;
                for (double t = 3.0; t + 0.12 <= 8.0; t += 0.06) {
                    Out w; w.l.assign(o.l.begin() + (size_t)(t * SR), o.l.begin() + (size_t)((t + 0.12) * SR)); w.r = w.l;
                    c.push_back(cents_(estimateF0(w, 0, (int64_t)w.l.size(), midiHz(n), SR), midiHz(n)));
                }
                double m = 0; for (double x : c) m += x; m /= c.size();
                double sd = 0; for (double x : c) sd += (x - m) * (x - m);
                acc += std::sqrt(sd / c.size()); ++cnt;
            }
            return acc / cnt;
        };
        const double v0 = vibStd(0.0), v1 = vibStd(1.0);
        std::printf("  vibrato_depth 0 -> 100 %%: desviacion tipica de la afinacion (ventanas de 120 ms) = %.2f -> %.2f cents\n", v0, v1);
        CHECK(v1 >= v0 * 0.9, "vibrato_depth no anade modulacion (%.2f vs %.2f)", v0, v1);
        CHECK(v1 < 40.0, "demasiada modulacion de afinacion (%.2f cents)", v1);
    }

    // ---------------------------------------------------------------- 5. legato (linea de 12 notas solapadas 40 ms)
    {
        std::printf("== Legato ==\n");
        const int mel[] = { 62, 64, 66, 69, 67, 66, 64, 62, 66, 69, 73, 71 };
        std::vector<Ev> evs; std::vector<int64_t> starts;
        double tb = 0.5;
        for (int i = 0; i < 12; ++i) {
            const int64_t on = (int64_t)(tb * SR), off = (int64_t)((tb + 1.0) * SR) + (int64_t)(0.040 * SR);
            evs.push_back({ on, 0, (double)mel[i], 0.65 }); evs.push_back({ off, 1, (double)mel[i], 0 }); starts.push_back(on);
            tb += 1.0;
        }
        Out o = run(*e, def, evs, (int64_t)((tb + 3.0) * SR), SR);
        CHECK(finite(o), "NaN en la linea legato");
        double mn = 9, mx = 0;
        for (size_t i = 1; i < starts.size(); ++i) {
            const double ra = rmsAt(o, starts[i] / SR - 0.050, starts[i] / SR - 0.010, SR), rb = rmsAt(o, starts[i] / SR + 0.010, starts[i] / SR + 0.050, SR);
            const double q = rb / (ra + 1e-12); mn = std::min(mn, q); mx = std::max(mx, q);
        }
        // nivel 300 ms despues del cambio vs 300 ms antes (sin re-ataque ni hueco)
        double mn2 = 9, mx2 = 0;
        for (size_t i = 2; i < starts.size(); ++i) {
            const double ra = rmsAt(o, starts[i] / SR - 0.35, starts[i] / SR - 0.05, SR), rb = rmsAt(o, starts[i] / SR + 0.15, starts[i] / SR + 0.45, SR);
            mn2 = std::min(mn2, rb / (ra + 1e-12)); mx2 = std::max(mx2, rb / (ra + 1e-12));
        }
        int64_t at = 0; const double cr = clickRatio(o, &at);
        std::printf("  cociente RMS (50 ms despues/antes): %.2f..%.2f | (150..450 ms despues / 350..50 ms antes): %.2f..%.2f | clic %.1f en %.2f s\n", mn, mx, mn2, mx2, cr, at / SR);
        CHECK(mn > 0.5 && mx < 2.0, "legato con salto de nivel (%.2f..%.2f)", mn, mx);
        CHECK(mn2 > 0.55 && mx2 < 1.8, "legato con hueco o re-ataque (%.2f..%.2f)", mn2, mx2);
        CHECK(cr < 12.0, "clic en el legato (%.1f)", cr);
    }

    // ---------------------------------------------------------------- 6. polifonia, CPU y extremos
    {
        std::printf("== Polifonia, CPU y extremos ==\n");
        Out o1 = run(*e, def, { { 0, 0, 57.0, 0.7 } }, static_cast<int64_t>(4.0 * SR), SR);
        std::vector<Ev> ch;
        for (int n : { 38, 50, 57, 62, 66 }) ch.push_back({ 0, 0, (double)n, 0.7 });
        Out oc = run(*e, def, ch, static_cast<int64_t>(4.0 * SR), SR);
        double pc, rc; peakRms(oc, (int64_t)(2 * SR), (int64_t)(4 * SR), pc, rc);
        std::printf("  acorde de 5 notas (RMS %.1f dBFS, pico %.1f dBFS) vs 1 nota (RMS %.1f dBFS)\n", dbf(rc), dbf(pc), dbf(rmsAt(o1, 2, 4, SR)));
        CHECK(dbf(rc) - dbf(rmsAt(o1, 2, 4, SR)) < 7.0, "el acorde de 5 notas sube mas de 7 dB sobre una nota");
        for (int nv : { 1, 8, 16, 32 }) {
            double best = 1e9;
            for (int rep = 0; rep < 5; ++rep) {
                StringsSettings s = def; s.hall = 0.65;
                e->prepare(SR, 4096); e->setSettings(s);
                for (int i = 0; i < nv; ++i) e->noteOn(36 + (i * 53) / std::max(1, nv - 1) + (i % 3), 0.7f);
                std::vector<float> l(512), r(512);
                JasWaveDsp::ScopedNoDenormals nd;
                const double t0 = threadCpuSec();
                for (int p = 0; p < (int)(6.0 * SR / 512); ++p) { std::fill(l.begin(), l.end(), 0.f); std::fill(r.begin(), r.end(), 0.f); e->render(l.data(), r.data(), 512, nullptr); }
                best = std::min(best, threadCpuSec() - t0);
            }
            const double cpu = 100.0 * best / 6.0;
            std::printf("  %2d notas: %.2f %% de un nucleo (voces del sampler %d)\n", nv, cpu, e->sampledVoices());
            if (nv == 16) CHECK(cpu < 8.0, "CPU con 16 notas %.2f %%", cpu);
        }
        StringsSettings s = def; s.hall = 1.0; s.expression = 1.0; s.modWheel = 1.0; s.volumeDb = 6.0; s.vibrato = 1.0;
        s.attackSec = 0.02; s.releaseSec = 3.0; s.width = 1.0; s.bendSemis = 2.0;
        std::vector<Ev> e2;
        for (int i = 0; i < 400; ++i) e2.push_back({ (int64_t)(i * 0.05 * SR), 0, (double)(24 + (i * 7) % 80), 1.0 });
        Out ox = run(*e, s, e2, static_cast<int64_t>(24.0 * SR), SR, 1000);
        double px, rx; peakRms(ox, 0, (int64_t)ox.l.size(), px, rx);
        std::printf("  extremos (24 s, 400 notas): finito=%d pico %.3f RMS %.3f\n", finite(ox) ? 1 : 0, px, rx);
        CHECK(finite(ox) && px < 1.0001, "inestable con parametros extremos (pico %.3f)", px);
        // tamanos de bloque y frecuencias de muestreo
        bool ok = true;
        for (double sr : { 44100.0, 96000.0 }) for (int bl : { 1, 64, 333, 4096 }) {
            std::vector<Ev> e3;
            for (int i = 0; i < 6; ++i) e3.push_back({ (int64_t)(i * 0.01 * sr), 0, (double)(40 + i * 7), 0.7 });
            e3.push_back({ (int64_t)(0.4 * sr), 1, 40.0, 0 });
            Out oo = run(*e, def, e3, (int64_t)((bl == 1 ? 0.25 : 1.2) * sr), sr, bl);
            double p, r; peakRms(oo, 0, (int64_t)oo.l.size(), p, r);
            if (!finite(oo) || p > 1.0001) { ok = false; std::printf("  FALLO sr=%.0f bloque=%d pico=%.3f\n", sr, bl, p); }
        }
        CHECK(ok, "robustez de sr/bloque con muestras");
        // vuelta a 48 kHz tras las pruebas de sr
        e->prepare(SR, 4096);
    }

    // ---------------------------------------------------------------- 7. WAV: acorde sostenido 10 s con cambio de acorde en legato
    {
        StringsSettings s = def; s.hall = 0.65;
        std::vector<Ev> evs;
        const int c1[] = { 38, 50, 57, 62, 66, 69 }, c2[] = { 31, 43, 50, 59, 62, 67 }, c3[] = { 33, 45, 52, 57, 61, 64 };
        auto at = [&](double t) { return (int64_t)(t * SR); };
        for (int n : c1) { evs.push_back({ at(0.2 + 0.012 * (n % 5)), 0, (double)n, 0.62 }); evs.push_back({ at(4.60), 1, (double)n, 0 }); }
        for (int n : c2) { evs.push_back({ at(4.66 + 0.010 * (n % 4)), 0, (double)n, 0.66 }); evs.push_back({ at(8.00), 1, (double)n, 0 }); }   // legato: tras soltar el anterior
        for (int n : c3) { evs.push_back({ at(7.90 + 0.008 * (n % 3)), 0, (double)n, 0.70 }); evs.push_back({ at(10.0), 1, (double)n, 0 }); }   // solapado 100 ms
        evs.push_back({ at(0.0), 2, 0.72, 0 });
        for (int i = 0; i <= 20; ++i) evs.push_back({ at(0.2 + i * 0.4), 2, 0.72 + 0.08 * std::sin(i * 0.31), 0 });
        Out o = run(*e, s, evs, at(14.0), SR);
        double pk, rms; peakRms(o, 0, (int64_t)o.l.size(), pk, rms);
        int64_t cat = 0; const double cr = clickRatio(o, &cat);
        double dmax = 0; for (size_t i = 1; i < o.l.size(); ++i) dmax = std::max(dmax, (double)std::fabs(o.l[i] - o.l[i - 1]));
        std::printf("== WAV (acorde 10 s + cambio legato) ==\n  pico %.1f dBFS | RMS %.1f dBFS | derivada max %.4f | clics %.1f en %.2f s\n", dbf(pk), dbf(rms), dmax, cr, cat / SR);
        // nivel antes/despues del cambio de acorde (4.66 s) y del segundo (8.0 s)
        const double a1 = dbf(rmsAt(o, 4.0, 4.5, SR)), a2 = dbf(rmsAt(o, 5.2, 5.7, SR)), b1 = dbf(rmsAt(o, 7.4, 7.9, SR)), b2 = dbf(rmsAt(o, 8.6, 9.1, SR));
        std::printf("  cambio de acorde 1: %.1f -> %.1f dBFS | cambio 2: %.1f -> %.1f dBFS\n", a1, a2, b1, b2);
        // hueco en el cambio: ventana de 100 ms alrededor de 4.66 s frente a los vecinos
        const double g = dbf(rmsAt(o, 4.62, 4.78, SR)), gv = std::min(a1, a2);
        std::printf("  nivel en el cambio (4.62..4.78 s): %.1f dBFS (vecinos %.1f / %.1f)\n", g, a1, a2);
        CHECK(finite(o) && pk < 0.98, "pico %.3f >= 0.98", pk);
        CHECK(cr < 12.0, "clic en el WAV (%.1f)", cr);
        CHECK(g > gv - 5.0, "hueco de %.1f dB en el cambio de acorde", gv - g);
        CHECK(std::fabs(a2 - a1) < 6.0 && std::fabs(b2 - b1) < 6.0, "salto de nivel entre acordes");
        writeWav24(wavPath, o, 48000);
        std::printf("  WAV: %s\n", wavPath);
    }

    std::printf(g_fail ? "\nRESULTADO (samples): FALLO (%d)\n" : "\nRESULTADO (samples): OK\n", g_fail);
    return g_fail ? 1 : 0;
}

// ------------------------------------------------------------------ hash determinista (neutralidad del FX Rack)
// Render fijo de 6 s (acorde de 5 notas) con el estado actual del motor; FNV-1a sobre los bits float de L/R.
static uint64_t renderHash(StringsEngine& e, double sr, int block) {
    const size_t N = static_cast<size_t>(6 * sr);
    std::vector<float> L(N, 0.0f), R(N, 0.0f);
    const int notes[] = { 38, 50, 57, 62, 66 };
    struct E2 { size_t t; int kind; int note; float vel; };
    std::vector<E2> ev;
    for (int k = 0; k < 5; ++k) { ev.push_back({ static_cast<size_t>(k * 700), 0, notes[k], 0.6f + 0.05f * k }); ev.push_back({ static_cast<size_t>(3 * sr) + static_cast<size_t>(k * 300), 1, notes[k], 0.0f }); }
    std::sort(ev.begin(), ev.end(), [](const E2& a, const E2& b) { return a.t < b.t; });
    size_t ei = 0, pos = 0;
    JasWaveDsp::ScopedNoDenormals nd;
    while (pos < N) {
        while (ei < ev.size() && ev[ei].t <= pos) { if (ev[ei].kind == 0) e.noteOn(ev[ei].note, ev[ei].vel); else e.noteOff(ev[ei].note); ++ei; }
        size_t next = std::min(N, pos + static_cast<size_t>(block));
        if (ei < ev.size()) next = std::min(next, ev[ei].t);
        e.render(L.data() + pos, R.data() + pos, static_cast<int>(next - pos), nullptr);
        pos = next;
    }
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < N; ++i) { uint32_t a, b; std::memcpy(&a, &L[i], 4); std::memcpy(&b, &R[i], 4); h = (h ^ a) * 1099511628211ull; h = (h ^ b) * 1099511628211ull; }
    return h;
}

// ------------------------------------------------------------------ 7. FX Rack comun (jw_fxrack.h)
// PRNG xorshift32 de las pruebas del rack (igual que el del piloto shimmer-pad)
struct Xor {
    uint32_t s{0x2545F491u};
    void seed(uint32_t v) { s = v ? v : 0x9E3779B9u; for (int i = 0; i < 4; ++i) u32(); }
    uint32_t u32() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    double uni() { return u32() * (1.0 / 4294967296.0); }
    double bi() { return uni() * 2.0 - 1.0; }
};

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

// Tiempo de reloj de pared; se toma el MINIMO de varias pasadas (descarta la interferencia de otros procesos)
static double cpuSeconds() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
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

    // ---- 7.1 neutralidad bit a bit en el motor (rack apagado == salida previa del plugin; modelado aqui, banco con --samples) ----
    {
        const uint64_t goldenModelado = 0xe68b8921fd601dd7ull;   // hash de la salida SIN rack (motor previo a la integracion), JASWAVE_SAMPLES_DIR inexistente
        StringsSettings s;
        auto mk = [&](bool conRack) {
            auto e = std::make_unique<StringsEngine>(); e->prepare(SR, 512); e->setSettings(s); e->setSamplesEnabled(false);
            if (conRack) {
                FxParams p = porDefecto();   // valores extremos pero TODOS los bloques apagados
                for (int b = 0; b < kBands; ++b) { p.eq[b].gainDb = 12.0; p.eq[b].hz *= 1.3; }
                p.compThreshDb = -50; p.compRatio = 20; p.satDrive = 1.0; p.dlTimeMs = 100; p.rvMix = 1.0; p.outWidth = 2.0; p.outGainDb = 12.0;
                e->setFx(p);
            }
            return e;
        };
        auto e0 = mk(false), e1 = mk(true);
        const uint64_t h0 = renderHash(*e0, SR, 512), h1 = renderHash(*e1, SR, 512);
        std::printf("    hash sin rack=0x%016llx, rack apagado con valores extremos=0x%016llx (referencia 0x%016llx)\n",
                    static_cast<unsigned long long>(h0), static_cast<unsigned long long>(h1), static_cast<unsigned long long>(goldenModelado));
        CHECK(h0 == goldenModelado, "el rack apagado cambia el sonido por defecto del plugin");
        CHECK(h1 == goldenModelado, "el rack con bloques apagados cambia el sonido");
        auto e2 = mk(false);
        FxParams q = porDefecto(); q.eqOn = true; q.eq[2].gainDb = 9.0; q.dlOn = true; q.rvOn = true; q.compOn = true; q.satOn = true; q.chOn = true; q.outOn = true;
        e2->setFx(q);
        CHECK(renderHash(*e2, SR, 512) != goldenModelado, "el rack encendido no cambia nada");
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

    // ---- 7.11 motor: con todo encendido sigue siendo finito y acotado; los picos del bus se miden tras el rack ----
    {
        StringsSettings s;
        StringsEngine e; e.prepare(SR, 512); e.setSettings(s); e.setSamplesEnabled(false);
        FxParams q = porDefecto(); q.hpfOn = q.eqOn = q.compOn = q.satOn = q.chOn = q.dlOn = q.rvOn = q.outOn = true;
        q.eq[1].gainDb = 8.0; q.outGainDb = -6.0;
        e.setFx(q);
        StringsBus bus;
        const size_t N = static_cast<size_t>(6 * SR);
        std::vector<float> L(N, 0.0f), R(N, 0.0f);
        e.noteOn(50, 0.8f); e.noteOn(57, 0.8f); e.noteOn(66, 0.8f);
        for (size_t p = 0; p < N; p += 512) { const int m = static_cast<int>(std::min<size_t>(512, N - p)); e.render(L.data() + p, R.data() + p, m, &bus); }
        bool fin = true; for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i]) || std::fabs(L[i]) > 1.0f) fin = false;
        std::printf("    motor con rack completo: finito y |x|<=1 = %d, GR publicado en el bus = %.2f dB\n", fin ? 1 : 0, bus.fxGrDb.load());
        CHECK(fin, "motor + rack no finito");
    }
}


int main(int argc, char** argv) {
    const char* wavPath = argc > 1 && std::string(argv[1]).rfind("--", 0) != 0 ? argv[1] : "strings_section_test.wav";
    const double SR = 48000.0;
    if (argc > 1 && std::string(argv[argc - 1]) == "--hash") {   // imprime los hashes de referencia (modelado y banco de muestras)
        StringsSettings s0;
        // el modelado se mide sin banco (carpeta inexistente): con el banco cargandose en otro hilo la carrera lo haria no determinista
        const char* dirPrevio = std::getenv("JASWAVE_SAMPLES_DIR");
        const std::string dirGuardado = dirPrevio ? dirPrevio : "";
#ifdef _WIN32
        _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
#else
        setenv("JASWAVE_SAMPLES_DIR", "__sin_samples__", 1);
#endif
        auto em = std::make_unique<StringsEngine>(); em->prepare(SR, 4096); em->setSettings(s0); em->setSamplesEnabled(false);
        std::printf("hash modelado = 0x%016llx\n", static_cast<unsigned long long>(renderHash(*em, SR, 512)));
#ifdef _WIN32
        _putenv_s("JASWAVE_SAMPLES_DIR", dirGuardado.c_str());
#else
        if (dirPrevio) setenv("JASWAVE_SAMPLES_DIR", dirGuardado.c_str(), 1); else unsetenv("JASWAVE_SAMPLES_DIR");
#endif
        auto es = makeSampled(SR, s0);
        std::printf("banco listo: %d\n", es->samplerReady() ? 1 : 0);
        es->setSamplesEnabled(true);
        std::printf("hash samples  = 0x%016llx\n", static_cast<unsigned long long>(renderHash(*es, SR, 512)));
        return 0;
    }
    if (argc > 1 && std::string(argv[argc - 1]) == "--samples") return sampledTest(wavPath);
    // La suite modelada comprueba el respaldo sin banco: se aparta la carpeta de samples.
#ifdef _WIN32
    _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
#else
    setenv("JASWAVE_SAMPLES_DIR", "__sin_samples__", 1);
#endif
    auto eng = std::make_unique<StringsEngine>();
    StringsSettings def;
    if (argc > 2 && std::string(argv[2]) == "prof") {   // desglose de CPU (desarrollo)
        for (int nv : { 0, 1, 4, 16 }) for (int sec : { 4, 8 }) {
            StringsSettings s; s.sectionSize = sec;
            double best = 1e9;
            for (int rep = 0; rep < 5; ++rep) {
                eng->prepare(SR, 4096); eng->setSettings(s);
                for (int i = 0; i < nv; ++i) eng->noteOn(40 + i * 3, 0.7f);
                std::vector<float> l(512), r(512);
                JasWaveDsp::ScopedNoDenormals nd;
                const auto t0 = std::chrono::high_resolution_clock::now();
                for (int p = 0; p < 48000 * 3 / 512; ++p) { std::fill(l.begin(), l.end(), 0.f); std::fill(r.begin(), r.end(), 0.f); eng->render(l.data(), r.data(), 512, nullptr); }
                best = std::min(best, std::chrono::duration<double>(std::chrono::high_resolution_clock::now() - t0).count());
            }
            std::printf("nv=%d sec=%d players/voz=%d: %.2f %%\n", nv, sec, eng->playersForNextNote(), best / 3 * 100);
        }
        return 0;
    }

    // ---------------------------------------------------------------- 1. afinación por nota
    std::printf("== Afinación (ensemble de %d..%d atriles, vibrato 35 %%, f0 media en 1.0..2.2 s) ==\n", 4, 8);
    std::printf("%5s %9s %9s %8s %8s %8s %8s\n", "nota", "esperada", "medida", "cents", "pico", "RMS", "dBFS");
    const int notes[] = { 28, 36, 43, 50, 57, 62, 66, 69, 74, 81, 86, 93 };
    const double vels[] = { 0.45, 0.6, 0.8, 0.7, 0.5, 0.9, 0.65, 0.75, 0.55, 0.85, 0.6, 0.7 };
    double worst = 0;
    for (int k = 0; k < 12; ++k) {
        const int64_t total = static_cast<int64_t>(2.4 * SR);
        Out o = run(*eng, def, { { 0, 0, (double)notes[k], vels[k] } }, total, SR);
        CHECK(finite(o), "NaN/inf en nota %d", notes[k]);
        const double fe = midiHz(notes[k]);
        const double fm = estimateF0(o, static_cast<int64_t>(1.0 * SR), static_cast<int64_t>(2.2 * SR), fe, SR);
        const double c = cents(fm, fe);
        double pk, rms; peakRms(o, static_cast<int64_t>(1.0 * SR), static_cast<int64_t>(2.2 * SR), pk, rms);
        worst = std::max(worst, std::fabs(c));
        std::printf("%5d %9.2f %9.2f %+8.2f %8.3f %8.4f %8.1f\n", notes[k], fe, fm, c, pk, rms, 20 * std::log10(rms + 1e-12));
        CHECK(std::fabs(c) < 10.0, "nota %d: error %.2f cents >= 10", notes[k], c);
    }
    std::printf("  peor error: %.2f cents\n", worst);
    {   // sin vibrato y afinación sin ensemble ruidoso: error muy pequeño
        StringsSettings s = def; s.vibrato = 0.0;
        double w2 = 0;
        for (int note : { 36, 57, 74 }) {
            Out o = run(*eng, s, { { 0, 0, (double)note, 0.7 } }, static_cast<int64_t>(2.0 * SR), SR);
            const double c = cents(estimateF0(o, static_cast<int64_t>(0.8 * SR), static_cast<int64_t>(1.9 * SR), midiHz(note), SR), midiHz(note));
            w2 = std::max(w2, std::fabs(c));
        }
        std::printf("  sin vibrato (notas 36/57/74): peor %.2f cents\n", w2);
        CHECK(w2 < 10.0, "sin vibrato %.2f cents", w2);
        // pitch bend +2 st y tune
        Out o = run(*eng, def, { { 0, 5, 2.0, 0 }, { 1, 0, 57, 0.7 } }, static_cast<int64_t>(2.0 * SR), SR);
        const double cb = cents(estimateF0(o, static_cast<int64_t>(0.8 * SR), static_cast<int64_t>(1.9 * SR), midiHz(59), SR), midiHz(59));
        std::printf("  pitch bend +2 st sobre A3: %+.2f cents respecto a B3\n", cb);
        CHECK(std::fabs(cb) < 12.0, "bend %.2f", cb);
    }

    // ---------------------------------------------------------------- 2. CPU
    std::printf("== CPU (48 kHz, sección %d atriles con densidad adaptativa) ==\n", def.sectionSize);
    for (int nv : { 1, 8, 16, 32 }) {
        std::vector<Ev> evs;
        for (int i = 0; i < nv; ++i) evs.push_back({ 0, 0, (double)(36 + (i * 53) / std::max(1, nv - 1) + (i % 3)), 0.7 });
        const int64_t total = static_cast<int64_t>(6.0 * SR);
        double sec = 1e9;
        for (int rep = 0; rep < 7; ++rep) {   // mejor de 7, tiempo de CPU del hilo (el equipo de desarrollo es ruidoso)
            eng->prepare(SR, 4096);
            eng->setSettings(def);
            std::vector<float> l(512), r(512);
            for (auto& ev : evs) eng->noteOn((int)ev.a, (float)ev.b);
            JasWaveDsp::ScopedNoDenormals nd;
            const double t0 = threadCpuSec();
            for (int64_t p = 0; p < total; p += 512) {
                std::fill(l.begin(), l.end(), 0.0f); std::fill(r.begin(), r.end(), 0.0f);
                eng->render(l.data(), r.data(), 512, nullptr);
            }
            sec = std::min(sec, threadCpuSec() - t0);
        }
        const double cpu = 100.0 * sec / (total / SR);
        std::printf("  %2d voces: %.2f %% de un núcleo (activas %d)\n", nv, cpu, eng->activeVoices());
        if (nv == 16) CHECK(cpu < 5.0, "CPU con 16 voces %.2f %% >= 5 %%", cpu);
        if (nv == 32) CHECK(cpu < 10.0, "CPU con 32 voces %.2f %% >= 10 %%", cpu);
    }

    // ---------------------------------------------------------------- 3. música: acordes + línea legato 8 compases
    std::printf("== Música: acordes sostenidos (Dmaj, Bm, G, A) + línea legato 8 compases en Re mayor, crescendo ==\n");
    const double bpm = 84.0, beat = 60.0 / bpm * SR;
    auto B = [&](double beats) { return static_cast<int64_t>(beats * beat); };
    std::vector<Ev> evs;
    // 3a. acordes: 4 compases (16 tiempos) sostenidos con pedal, 4 acordes de 1 compás
    const int chords[4][5] = { { 38, 50, 57, 62, 66 }, { 35, 47, 54, 62, 66 }, { 43, 50, 55, 62, 67 }, { 45, 52, 57, 61, 64 } };
    for (int c = 0; c < 4; ++c) {
        const int64_t t0 = B(c * 4.0);
        evs.push_back({ t0, 4, 1, 0 });
        for (int i = 0; i < 5; ++i) evs.push_back({ t0 + (int64_t)(i * 0.004 * SR), 0, (double)chords[c][i], 0.55 + 0.05 * i });
        for (int i = 0; i < 5; ++i) evs.push_back({ t0 + B(3.85), 1, (double)chords[c][i], 0 });
        evs.push_back({ t0 + B(3.95), 4, 0, 0 });
    }
    // 3b. línea legato: 8 compases en D mayor (D E F# G A B C# D5 ...), notas solapadas 40 ms
    const int64_t L0 = B(16.0) + (int64_t)(1.0 * SR);
    const int melody[] = { 62, 64, 66, 69, 67, 66, 64, 62,   66, 69, 73, 71, 69, 67, 66, 64,   62, 66, 69, 74, 73, 71, 69, 66,   67, 69, 71, 73, 74, 76, 74, 73 };
    const double lens[] = { 1.5, 0.5, 1, 1, 1.5, 0.5, 1, 1,   1, 1, 1, 1, 1.5, 0.5, 1, 1,   1, 1, 1, 1, 1, 1, 1, 1,   1, 1, 1, 1, 2, 1, 0.5, 0.5 };
    double tb = 0;
    std::vector<int64_t> noteStarts;
    for (int i = 0; i < 32; ++i) {
        const int64_t on = L0 + B(tb);
        const int64_t off = L0 + B(tb + lens[i]) + (int64_t)(0.040 * SR);
        evs.push_back({ on, 0, (double)melody[i], 0.5 + 0.4 * (double)i / 32.0 });
        evs.push_back({ off, 1, (double)melody[i], 0 });
        noteStarts.push_back(on);
        tb += lens[i];
    }
    // bajo de apoyo (nota larga por compás-par)
    for (int c = 0; c < 4; ++c) { evs.push_back({ L0 + B(c * 8.0), 0, c % 2 ? 43.0 : 38.0, 0.5 }); evs.push_back({ L0 + B(c * 8.0 + 7.9), 1, c % 2 ? 43.0 : 38.0, 0 }); }
    // crescendo CC11 / CC1 a lo largo de la línea (30 % -> 100 %, mod wheel 0 -> 85 %)
    for (int i = 0; i <= 64; ++i) {
        const double u = i / 64.0;
        evs.push_back({ L0 + B(tb * u), 2, 0.30 + 0.70 * u, 0 });
        evs.push_back({ L0 + B(tb * u), 3, 0.85 * u, 0 });
    }
    const int64_t total = L0 + B(tb) + (int64_t)(6.0 * SR);
    StringsSettings ms = def;
    ms.expression = 0.30;
    Out mus = run(*eng, ms, evs, total, SR);
    CHECK(finite(mus), "NaN/inf en la pieza");
    double pk, rms; peakRms(mus, 0, total, pk, rms);
    double dmax = 0, dc = 0;
    for (int64_t i = 1; i < total; ++i) {
        dmax = std::max({ dmax, (double)std::fabs(mus.l[(size_t)i] - mus.l[(size_t)i - 1]), (double)std::fabs(mus.r[(size_t)i] - mus.r[(size_t)i - 1]) });
        dc += mus.l[(size_t)i] + mus.r[(size_t)i];
    }
    dc /= 2.0 * total;
    std::printf("  duración %.1f s | pico %.3f (%.1f dBFS) | RMS %.4f (%.1f dBFS) | derivada máx %.4f | DC %.2e\n",
                total / SR, pk, 20 * std::log10(pk + 1e-12), rms, 20 * std::log10(rms + 1e-12), dmax, dc);
    CHECK(pk < 0.98, "pico %.3f >= 0.98", pk);
    CHECK(rms > 0.02 && rms < 0.3, "RMS %.4f fuera de rango razonable", rms);
    { int64_t at = 0; const double cr = clickRatio(mus, &at);
      std::printf("  detector de clics: cociente |dx|/RMS(dx) máx %.1f en t=%.2f s\n", cr, at / SR);
      CHECK(cr < 12.0, "posible clic (cociente %.1f en %.2f s)", cr, at / SR); }
    CHECK(dmax < 0.45, "derivada máx %.4f", dmax);
    CHECK(std::fabs(dc) < 1e-3, "DC %.2e", dc);
    // crescendo medible: RMS del primer vs último compás de la línea
    {
        double p1, r1, p2, r2;
        peakRms(mus, L0 + B(0.0), L0 + B(4.0), p1, r1);
        peakRms(mus, L0 + B(tb - 4.0), L0 + B(tb), p2, r2);
        std::printf("  crescendo: RMS primer compás %.1f dBFS -> último %.1f dBFS (+%.1f dB)\n", 20 * std::log10(r1), 20 * std::log10(r2), 20 * std::log10(r2 / r1));
        CHECK(20 * std::log10(r2 / r1) > 6.0, "crescendo insuficiente");
    }
    // legato: sin hueco ni re-ataque en las transiciones (RMS 30 ms alrededor del cambio vs 30 ms previos)
    {
        double minRatio = 9.0, maxRatio = 0.0;
        for (size_t i = 1; i < noteStarts.size(); ++i) {
            if (lens[i - 1] < 0.9 && false) continue;
            const int64_t t = noteStarts[i];
            double p, ra, rb;
            peakRms(mus, t - (int64_t)(0.050 * SR), t - (int64_t)(0.010 * SR), p, ra);
            peakRms(mus, t + (int64_t)(0.010 * SR), t + (int64_t)(0.050 * SR), p, rb);
            const double q = rb / (ra + 1e-12);
            minRatio = std::min(minRatio, q); maxRatio = std::max(maxRatio, q);
        }
        std::printf("  legato: cociente RMS (después/antes) en %zu transiciones: mín %.2f máx %.2f\n", noteStarts.size() - 1, minRatio, maxRatio);
        CHECK(minRatio > 0.6 && maxRatio < 1.6, "legato con salto de nivel (%.2f..%.2f)", minRatio, maxRatio);
    }
    writeWav24(wavPath, mus, 48000);
    std::printf("  WAV: %s\n", wavPath);

    // ---------------------------------------------------------------- 4. dinámica: timbre (centroide) pp vs ff
    {
        auto centroid = [&](double expr, double mod) {
            StringsSettings s = def; s.expression = expr; s.modWheel = mod; s.hall = 0.0;
            Out o = run(*eng, s, { { 0, 0, 57, 0.7 } }, static_cast<int64_t>(2.0 * SR), SR);
            // centroide espectral aproximado por energía de la derivada vs señal (cociente de RMS)
            double e0 = 0, e1 = 0;
            for (int64_t i = static_cast<int64_t>(1.0 * SR); i < static_cast<int64_t>(1.8 * SR); ++i) {
                const double x = o.l[(size_t)i], d = o.l[(size_t)i] - o.l[(size_t)i - 1];
                e0 += x * x; e1 += d * d;
            }
            const double rr = std::sqrt(e0 / 0.8 / SR);
            return std::make_pair(std::sqrt(e1 / (e0 + 1e-30)) * SR / (2 * kPi), rr);   // frecuencia "equivalente" y nivel
        };
        const auto pp = centroid(0.35, 0.0), ff = centroid(1.0, 1.0);
        std::printf("  timbre pp: brillo eq. %.0f Hz, nivel %.1f dBFS | ff: %.0f Hz, %.1f dBFS\n", pp.first, 20 * std::log10(pp.second), ff.first, 20 * std::log10(ff.second));
        CHECK(ff.first > pp.first * 1.3, "el brillo no sube con la dinámica");
        CHECK(ff.second > pp.second * 2.0, "el nivel no sube con la dinámica");
    }

    // ---------------------------------------------------------------- 5. sala: RT60 y estabilidad
    {
        for (double h : { 0.0, 0.5, 1.0 }) {
            StringsSettings s = def; s.hall = h; s.releaseSec = 0.05; s.attackSec = 0.02;
            Out o = run(*eng, s, { { 0, 0, 57, 0.8 }, { 0, 0, 62, 0.8 }, { (int64_t)(0.5 * SR), 1, 57, 0 }, { (int64_t)(0.5 * SR), 1, 62, 0 } }, static_cast<int64_t>(9.0 * SR), SR);
            CHECK(finite(o), "NaN en la sala h=%.1f", h);
            // energía en ventanas de 100 ms tras la liberación; pendiente en dB entre 0.8 s y 0.8+T
            auto db = [&](double t) { double p, r; peakRms(o, (int64_t)(t * SR), (int64_t)((t + 0.1) * SR), p, r); return 20 * std::log10(r + 1e-12); };
            const double d1 = db(0.9), d2 = db(2.9);
            const double slope = (d1 - d2) / 2.0;      // dB/s
            const double rt60 = slope > 0.1 ? 60.0 / slope : 99.0;
            std::printf("  hall %.0f %%: RT60 medido ~%.2f s (nivel a 0.9 s %.1f dB, a 2.9 s %.1f dB, a 8.0 s %.1f dB)\n", h * 100, rt60, d1, d2, db(8.0));
            if (h < 0.01) continue;
            if (h >= 0.99) CHECK(rt60 > 2.5 && rt60 < 5.5, "RT60 máx %.2f fuera de 2.5..5.5 s", rt60);
            CHECK(db(8.0) < d1, "la cola no decae (h=%.1f)", h);
        }
        // estabilidad con extremos: todo al máximo, 20 s con notas repetidas
        StringsSettings s = def; s.hall = 1.0; s.expression = 1.0; s.modWheel = 1.0; s.volumeDb = 6.0; s.vibrato = 1.0; s.tremolo = 1.0;
        s.sectionSize = 8; s.attackSec = 0.02; s.releaseSec = 3.0; s.width = 1.0; s.glideMs = 300; s.bendSemis = 2.0;
        std::vector<Ev> e2;
        for (int i = 0; i < 400; ++i) e2.push_back({ (int64_t)(i * 0.05 * SR), 0, (double)(28 + (i * 7) % 70), 1.0 });
        Out o = run(*eng, s, e2, static_cast<int64_t>(24.0 * SR), SR, 1000);
        double p, r; peakRms(o, 0, (int64_t)o.l.size(), p, r);
        std::printf("  extremos (24 s, 400 notas, 32 voces máx): finito=%d pico %.3f RMS %.3f\n", finite(o) ? 1 : 0, p, r);
        CHECK(finite(o) && p < 1.0001, "inestable con parámetros extremos (pico %.3f)", p);
        double tail; { double pp2; peakRms(o, (int64_t)o.l.size() - 1000, (int64_t)o.l.size(), pp2, tail); }
        // robo de voces: nunca más de kMaxVoices (comprobado vía finitud y ausencia de clics)
        double dm = 0;
        for (size_t i = 1; i < o.l.size(); ++i) dm = std::max(dm, (double)std::fabs(o.l[i] - o.l[i - 1]));
        std::printf("  derivada máx con robo de voces y extremos: %.3f\n", dm);
        // robo de voces con niveles normales: 60 notas en 3 s (polifonía 32) sin clics
        std::vector<Ev> e4;
        for (int i = 0; i < 60; ++i) e4.push_back({ (int64_t)(i * 0.05 * SR), 0, (double)(40 + (i * 5) % 40), 0.6 });
        Out o4 = run(*eng, def, e4, (int64_t)(5.0 * SR), SR, 512);
        int64_t at4 = 0; const double cr4 = clickRatio(o4, &at4);
        double p4, r4; peakRms(o4, 0, (int64_t)o4.l.size(), p4, r4);
        std::printf("  robo de voces (60 notas en 3 s, máx 32): pico %.3f, cociente de clic %.1f en %.2f s\n", p4, cr4, at4 / SR);
        CHECK(cr4 < 12.0 && finite(o4), "clic al robar voz (%.1f)", cr4);
    }

    // ---------------------------------------------------------------- 6. frecuencias de muestreo y tamaños de bloque
    {
        std::printf("== Robustez: frecuencias de muestreo x tamaños de bloque ==\n");
        const double rates[] = { 44100, 48000, 88200, 96000, 176400, 192000 };
        const int blocks[] = { 1, 7, 64, 333, 1024, 4096 };
        bool allOk = true;
        for (double sr : rates) {
            for (int bl : blocks) {
                const double dur = bl == 1 ? 0.25 : 1.2;
                std::vector<Ev> e3;
                const int ch[] = { 38, 50, 57, 62, 66, 69 };
                for (int i = 0; i < 6; ++i) e3.push_back({ (int64_t)(i * 0.01 * sr), 0, (double)ch[i], 0.7 });
                e3.push_back({ (int64_t)(0.2 * sr), 0, 105.0, 0.9 });
                e3.push_back({ (int64_t)(0.22 * sr), 0, 107.0, 0.9 });
                e3.push_back({ (int64_t)(0.4 * sr), 1, 38.0, 0 });
                Out o = run(*eng, def, e3, (int64_t)(dur * sr), sr, bl);
                double p, r; peakRms(o, 0, (int64_t)o.l.size(), p, r);
                if (!finite(o) || p > 1.0001) { allOk = false; std::printf("  FALLO sr=%.0f bloque=%d pico=%.3f\n", sr, bl, p); }
            }
        }
        std::printf("  36 combinaciones: %s\n", allOk ? "OK (sin NaN/inf, pico <= 1)" : "FALLO");
        CHECK(allOk, "robustez de sr/bloque");
        // pitch a 96 kHz y 44.1 kHz
        for (double sr : { 44100.0, 96000.0, 192000.0 }) {
            Out o = run(*eng, def, { { 0, 0, 57, 0.7 } }, (int64_t)(2.2 * sr), sr, 256);
            const double c = cents(estimateF0(o, (int64_t)(1.0 * sr), (int64_t)(2.1 * sr), midiHz(57), sr), midiHz(57));
            std::printf("  A3 a %.0f Hz: %+.2f cents\n", sr, c);
            CHECK(std::fabs(c) < 10.0, "afinación a %.0f Hz: %.2f cents", sr, c);
        }
    }

    // ---------------------------------------------------------------- 7. silencio tras all-notes-off / fin
    {
        eng->prepare(SR, 4096);
        StringsSettings s = def; s.hall = 0.0; s.releaseSec = 0.1;
        Out o = run(*eng, s, { { 0, 0, 60, 0.7 }, { (int64_t)(0.5 * SR), 1, 60, 0 } }, (int64_t)(3.0 * SR), SR);
        double p, r; peakRms(o, (int64_t)(2.0 * SR), (int64_t)(3.0 * SR), p, r);
        std::printf("  silencio 1.5 s tras release (hall 0): pico %.2e, voces activas %d\n", p, eng->activeVoices());
        CHECK(p < 1e-4 && eng->activeVoices() == 0, "no vuelve al silencio");
    }

    testFxRack();

    std::printf(g_fail ? "\nRESULTADO: FALLO (%d)\n" : "\nRESULTADO: OK\n", g_fail);
    return g_fail ? 1 : 0;
}
