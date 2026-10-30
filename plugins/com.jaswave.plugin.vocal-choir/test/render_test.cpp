// JasWave Vocal Choir - prueba de render offline (sin VST3). Uso: JasWaveVocalChoir_rendertest [salida.wav]
//  1. Barrido de frecuencias de muestreo x fuentes x vocales con 4 voces: sin NaN/inf y salida acotada.
//  2. Tono de cada nota (4 octavas) medido por autocorrelacion: error < 20 cents.
//  3. Formantes preservados: relacion de energia F1/F2 estable entre dos notas distintas (PSOLA, no resampleo).
//  4. Acorde de 4 voces: 4 notas presentes en el espectro; spread = 0 -> L == R; spread = 100 % -> L != R.
//  5. Fuente = entrada: voz sintetica de 200 Hz llevada a la nota pedida; con "Original" a 100 % la voz seca sale
//     retrasada exactamente la latencia informada.
//  6. Robo de voz con portamento (5.a nota con 4 voces): sin clics; noteOff + release: silencio.
//  7. CPU: 4 voces, 48 kHz.
//  8. Escribe un WAV con una progresion de acordes si se da una ruta.
#include "vocal_choir_dsp.h"

#include <chrono>
#include <complex>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace JasWaveVocalChoir;

static int g_fail = 0;
#define CHECK(cond, ...) do { if (!(cond)) { ++g_fail; std::printf("  FALLO: "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

struct Render {
    std::vector<float> L, R;
};

// Renderiza `segundos` con eventos (tiempo en s, nota, vel; vel 0 = off)
struct Ev { double t; int nota; float vel; };

static Render render(VocalChoirEngine& e, double sr, double segundos, const std::vector<Ev>& evs, const std::vector<float>* entrada = nullptr, ChoirBus* bus = nullptr) {
    const int total = static_cast<int>(segundos * sr);
    Render r; r.L.resize(static_cast<size_t>(total)); r.R.resize(static_cast<size_t>(total));
    std::vector<float> zero(static_cast<size_t>(total), 0.0f);
    size_t ie = 0;
    int pos = 0;
    while (pos < total) {
        while (ie < evs.size() && static_cast<int>(evs[ie].t * sr) <= pos) { if (evs[ie].vel > 0.0f) e.noteOn(evs[ie].nota, evs[ie].vel); else e.noteOff(evs[ie].nota); ++ie; }
        int fin = std::min(total, pos + 256);
        if (ie < evs.size()) fin = std::min(fin, std::max(pos + 1, static_cast<int>(evs[ie].t * sr)));
        const float* in = entrada ? entrada->data() + pos : zero.data() + pos;
        e.process(in, in, r.L.data() + pos, r.R.data() + pos, fin - pos, bus);
        pos = fin;
    }
    return r;
}

static ChoirSettings base() {
    ChoirSettings s;
    s.vibCents = 0.0; s.humanize = 0.0; s.detuneCents = 0.0; s.glideMs = 0.0; s.attackMs = 10.0; s.releaseMs = 100.0;
    return s;
}

// f0 por autocorrelacion normalizada
static double f0Auto(const std::vector<float>& x, size_t i0, size_t n, double sr, double fmin, double fmax) {
    const int lagMin = static_cast<int>(sr / fmax), lagMax = static_cast<int>(sr / fmin);
    double mejor = -1.0; int lagB = 0;
    std::vector<double> c(static_cast<size_t>(lagMax + 2), 0.0);
    for (int lag = lagMin - 1; lag <= lagMax + 1; ++lag) {
        double a = 0, e1 = 0, e2 = 0;
        for (size_t i = 0; i + static_cast<size_t>(lag) < n; ++i) { const double u = x[i0 + i], v = x[i0 + i + static_cast<size_t>(lag)]; a += u * v; e1 += u * u; e2 += v * v; }
        c[static_cast<size_t>(lag)] = a / std::sqrt(e1 * e2 + 1e-18);
    }
    for (int lag = lagMin; lag <= lagMax; ++lag) {
        const double v = c[static_cast<size_t>(lag)];
        if (v > mejor && v >= c[static_cast<size_t>(lag - 1)] && v >= c[static_cast<size_t>(lag + 1)]) { mejor = v; lagB = lag; }
    }
    // el primer pico alto (evita sub-multiplos): el mas corto con >= 0.9 * mejor
    for (int lag = lagMin; lag <= lagMax; ++lag) {
        const double v = c[static_cast<size_t>(lag)];
        if (v >= 0.9 * mejor && v >= c[static_cast<size_t>(lag - 1)] && v >= c[static_cast<size_t>(lag + 1)]) { lagB = lag; break; }
    }
    // interpolacion parabolica
    const double a = c[static_cast<size_t>(lagB - 1)], b = c[static_cast<size_t>(lagB)], d = c[static_cast<size_t>(lagB + 1)];
    const double den = a - 2 * b + d;
    const double off = std::fabs(den) > 1e-12 ? 0.5 * (a - d) / den : 0.0;
    return sr / (lagB + off);
}

static double energiaBanda(const std::vector<float>& x, size_t i0, size_t n, double sr, double f1, double f2) {
    // Goertzel-like: suma de |DFT| en rejilla de 10 Hz (ventana Hann)
    double e = 0.0;
    for (double f = f1; f <= f2; f += 10.0) {
        double re = 0, im = 0;
        for (size_t i = 0; i < n; ++i) {
            const double w = 0.5 - 0.5 * std::cos(2 * 3.14159265358979 * i / (n - 1));
            const double ph = 2 * 3.14159265358979 * f * i / sr;
            re += x[i0 + i] * w * std::cos(ph); im -= x[i0 + i] * w * std::sin(ph);
        }
        e += re * re + im * im;
    }
    return e;
}
static double magEn(const std::vector<float>& x, size_t i0, size_t n, double sr, double f) {
    double re = 0, im = 0;
    for (size_t i = 0; i < n; ++i) {
        const double w = 0.5 - 0.5 * std::cos(2 * 3.14159265358979 * i / (n - 1));
        const double ph = 2 * 3.14159265358979 * f * i / sr;
        re += x[i0 + i] * w * std::cos(ph); im -= x[i0 + i] * w * std::sin(ph);
    }
    return std::sqrt(re * re + im * im);
}
static double hz(int nota) { return 440.0 * std::pow(2.0, (nota - 69) / 12.0); }
static bool finito(const std::vector<float>& x, double& pico) {
    pico = 0.0;
    for (float v : x) { if (!std::isfinite(v)) return false; pico = std::max(pico, static_cast<double>(std::fabs(v))); }
    return true;
}

static void escribirWav(const char* ruta, const Render& r, int sr) {
    FILE* f = std::fopen(ruta, "wb");
    if (!f) return;
    const uint32_t n = static_cast<uint32_t>(r.L.size()), dataBytes = n * 4, riff = 36 + dataBytes, fmtLen = 16, rate = static_cast<uint32_t>(sr), byteRate = rate * 4;
    const uint16_t fmt = 1, ch = 2, align = 4, bits = 16;
    std::fwrite("RIFF", 1, 4, f); std::fwrite(&riff, 4, 1, f); std::fwrite("WAVEfmt ", 1, 8, f);
    std::fwrite(&fmtLen, 4, 1, f); std::fwrite(&fmt, 2, 1, f); std::fwrite(&ch, 2, 1, f); std::fwrite(&rate, 4, 1, f);
    std::fwrite(&byteRate, 4, 1, f); std::fwrite(&align, 2, 1, f); std::fwrite(&bits, 2, 1, f);
    std::fwrite("data", 1, 4, f); std::fwrite(&dataBytes, 4, 1, f);
    for (uint32_t i = 0; i < n; ++i) {
        const int16_t a = static_cast<int16_t>(std::max(-1.0f, std::min(1.0f, r.L[i])) * 32767.0f), b = static_cast<int16_t>(std::max(-1.0f, std::min(1.0f, r.R[i])) * 32767.0f);
        std::fwrite(&a, 2, 1, f); std::fwrite(&b, 2, 1, f);
    }
    std::fclose(f);
}

// Vocal sintetica de entrada: pulsos periodicos por 3 resonadores (formantes distintos de los internos)
static std::vector<float> vozEntrada(double sr, double f0, double seg) {
    const int n = static_cast<int>(seg * sr);
    std::vector<float> x(static_cast<size_t>(n));
    const double F[3] = { 650, 1700, 2600 };
    double a1[3], a2[3], y1[3] = {}, y2[3] = {};
    for (int i = 0; i < 3; ++i) { const double r = std::exp(-3.14159265358979 * 90.0 / sr); a1[i] = 2 * r * std::cos(2 * 3.14159265358979 * F[i] / sr); a2[i] = -r * r; }
    double ph = 0, g = 0;
    for (int i = 0; i < n; ++i) {
        ph += f0 / sr; double imp = 0; if (ph >= 1.0) { ph -= 1.0; imp = 1.0; }
        g += (imp - g) * 0.12;
        double s = 0;
        for (int k = 0; k < 3; ++k) { const double y = (1 - std::exp(-3.14159265358979 * 90.0 / sr)) * g + a1[k] * y1[k] + a2[k] * y2[k]; y2[k] = y1[k]; y1[k] = y; s += y; }
        x[static_cast<size_t>(i)] = static_cast<float>(s * 3.0);
    }
    return x;
}

int main(int argc, char** argv) {
    const double SR = 48000.0;
    // ---------------- 1. barrido
    std::printf("1. barrido de fs x fuente x vocal (4 voces)\n");
    for (double sr : { 44100.0, 48000.0, 96000.0 }) {
        for (int fuente = 0; fuente < 2; ++fuente) {
            for (int vocal = 0; vocal < 5; ++vocal) {
                VocalChoirEngine e; ChoirSettings s; s.source = fuente; s.vowel = vocal; s.range = vocal % 4; s.formantSt = (vocal - 2) * 3.0; s.throatPct = 100.0 + (vocal - 2) * 30.0;
                e.prepare(sr, 512); e.setSettings(s);
                const auto in = vozEntrada(sr, 180.0 + 20 * vocal, 1.5);
                auto r = render(e, sr, 1.5, { { 0.05, 48, 0.9f }, { 0.1, 55, 0.8f }, { 0.15, 64, 1.0f }, { 0.2, 72, 0.7f }, { 0.9, 48, 0 }, { 1.0, 79, 0.9f } }, &in);
                double pL, pR;
                CHECK(finito(r.L, pL) && finito(r.R, pR), "NaN/inf fs=%.0f fuente=%d vocal=%d", sr, fuente, vocal);
                CHECK(std::max(pL, pR) < 2.0, "pico %.2f fuera de rango fs=%.0f fuente=%d vocal=%d", std::max(pL, pR), sr, fuente, vocal);
            }
        }
    }

    // ---------------- 2. tono por nota (fuente interna)
    std::printf("2. tono por nota\n");
    for (int range = 0; range < 4; ++range) {
        for (int nota : { 40, 48, 60, 72, 84 }) {
            static const double fsrc[4] = { 110.0, 165.0, 220.0, 330.0 };
            if (hz(nota) < fsrc[range] * 0.5 || hz(nota) > fsrc[range] * 6.5) continue;   // fuera de la tesitura util de la fuente
            VocalChoirEngine e; ChoirSettings s = base(); s.voices = 1; s.range = range; e.prepare(SR, 512); e.setSettings(s);
            auto r = render(e, SR, 1.0, { { 0.0, nota, 0.9f } });
            const double f = f0Auto(r.L, 24000, 12000, SR, hz(nota) * 0.7, hz(nota) * 1.4);
            const double cents = 1200.0 * std::log2(f / hz(nota));
            CHECK(std::fabs(cents) < 20.0, "rango %d nota %d: f0=%.2f esperado %.2f (%.1f cents)", range, nota, f, hz(nota), cents);
            if (range == 1) std::printf("   nota %d -> %.2f Hz (esperado %.2f, %+.1f cents)\n", nota, f, hz(nota), cents);
        }
    }

    // ---------------- 3. formantes preservados
    std::printf("3. formantes preservados (vocal A, tesitura tenor, F1~730 / F2~1090)\n");
    {
        double rel[3];
        int k = 0;
        for (int nota : { 52, 55, 59 }) {   // E3 G3 B3: f0 entre 165 y 247
            VocalChoirEngine e; ChoirSettings s = base(); s.voices = 1; s.range = 1; e.prepare(SR, 512); e.setSettings(s);
            auto r = render(e, SR, 1.0, { { 0.0, nota, 0.9f } });
            const double f1 = energiaBanda(r.L, 24000, 8192, SR, 400, 1400), f3 = energiaBanda(r.L, 24000, 8192, SR, 2000, 3600);
            rel[k++] = 10.0 * std::log10(f1 / (f3 + 1e-20));
        }
        std::printf("   F1/F3 (dB): %.1f %.1f %.1f\n", rel[0], rel[1], rel[2]);
        CHECK(std::fabs(rel[0] - rel[1]) < 6.0 && std::fabs(rel[1] - rel[2]) < 6.0, "la envolvente de formantes cambia con el tono");
        // y el desplazamiento de formantes SI la mueve: el centroide de 300..2200 Hz sube
        auto centroide = [&](double st) {
            VocalChoirEngine e; ChoirSettings s = base(); s.voices = 1; s.range = 1; s.formantSt = st; e.prepare(SR, 512); e.setSettings(s);
            auto r = render(e, SR, 1.0, { { 0.0, 55, 0.9f } });
            double num = 0, den = 0;
            for (double f = 300; f <= 2200; f += 10.0) { const double m = magEn(r.L, 24000, 8192, SR, f); num += f * m * m; den += m * m; }
            return num / den;
        };
        const double c0 = centroide(0.0), c6 = centroide(6.0), cm6 = centroide(-6.0);
        std::printf("   centroide 300-2200 Hz: -6 st %.0f | 0 st %.0f | +6 st %.0f\n", cm6, c0, c6);
        CHECK(c6 > c0 * 1.1 && cm6 < c0 * 0.92, "Formant Shift no desplaza la envolvente");
    }

    // ---------------- 4. acorde y spread
    std::printf("4. acorde C-E-G-C y spread\n");
    for (double spread : { 0.0, 1.0 }) {
        VocalChoirEngine e; ChoirSettings s = base(); s.voices = 4; s.spread = spread; e.prepare(SR, 512); e.setSettings(s);
        auto r = render(e, SR, 1.5, { { 0.0, 48, 0.9f }, { 0.0, 52, 0.9f }, { 0.0, 55, 0.9f }, { 0.0, 60, 0.9f } });
        double dif = 0, tot = 0;
        for (size_t i = 24000; i < r.L.size(); ++i) { dif += std::fabs(r.L[i] - r.R[i]); tot += std::fabs(r.L[i]) + std::fabs(r.R[i]); }
        const double rel = dif / (tot + 1e-12);
        std::printf("   spread %.0f%%: diferencia L/R relativa %.3f\n", spread * 100, rel);
        if (spread == 0.0) CHECK(rel < 1e-4, "spread 0 debe dar L == R");
        else CHECK(rel > 0.15, "spread 100%% casi mono (%.3f)", rel);
        if (spread == 1.0) {
            std::vector<float> m(r.L.size());
            for (size_t i = 0; i < m.size(); ++i) m[i] = 0.5f * (r.L[i] + r.R[i]);
            const double base0 = magEn(m, 24000, 16384, SR, 1000.0) + magEn(m, 24000, 16384, SR, 1111.0);
            for (int nota : { 48, 52, 55, 60 }) {
                // armonico mas cercano a la fundamental de la nota o su 2.o: la nota debe destacar sobre un tono no musical
                const double m1 = magEn(m, 24000, 16384, SR, hz(nota)) + magEn(m, 24000, 16384, SR, 2 * hz(nota));
                CHECK(m1 > 3.0 * base0, "nota %d no aparece en el espectro (%.1f vs %.1f)", nota, m1, base0);
            }
        }
    }

    // ---------------- 5. entrada
    std::printf("5. fuente = entrada\n");
    {
        VocalChoirEngine e; ChoirSettings s = base(); s.voices = 1; s.source = 0; e.prepare(SR, 512); e.setSettings(s);
        const auto in = vozEntrada(SR, 200.0, 2.0);
        auto r = render(e, SR, 2.0, { { 0.2, 64, 0.9f } }, &in);
        const double f = f0Auto(r.L, 48000, 24000, SR, 200, 500);
        const double cents = 1200.0 * std::log2(f / hz(64));
        std::printf("   200 Hz -> nota 64: %.2f Hz (esperado %.2f, %+.1f cents)\n", f, hz(64), cents);
        CHECK(std::fabs(cents) < 25.0, "entrada: tono %.2f Hz lejos de %.2f", f, hz(64));
        // original al 100 %: la voz seca sale retrasada exactamente D
        VocalChoirEngine e2; ChoirSettings s2 = base(); s2.source = 0; s2.original = 1.0; s2.voices = 1; e2.prepare(SR, 512); e2.setSettings(s2);
        auto r2 = render(e2, SR, 2.0, {}, &in);
        const int D = e2.latency();
        double err = 0; for (size_t i = 24000; i < 60000; ++i) err = std::max(err, static_cast<double>(std::fabs(r2.L[i] - in[i - static_cast<size_t>(D)])));
        CHECK(err < 1e-5, "voz original no coincide con la entrada retrasada %d muestras (err %.2e)", D, err);
        std::printf("   latencia %d muestras (%.2f ms); error del camino seco %.1e\n", D, 1000.0 * D / SR, err);
    }

    // ---------------- 6. robo de voz, legato y release
    std::printf("6. robo de voz con portamento y release\n");
    {
        VocalChoirEngine e; ChoirSettings s = base(); s.voices = 4; s.glideMs = 60.0; e.prepare(SR, 512); e.setSettings(s);
        auto r = render(e, SR, 3.0, { { 0.0, 48, 0.9f }, { 0.0, 52, 0.9f }, { 0.0, 55, 0.9f }, { 0.0, 60, 0.9f }, { 1.0, 62, 0.9f }, { 1.5, 64, 0.9f },
                                      { 2.0, 62, 0 }, { 2.0, 64, 0 }, { 2.0, 52, 0 }, { 2.0, 55, 0 }, { 2.0, 60, 0 }, { 2.0, 48, 0 } });
        double pico = 0, salto = 0;
        for (size_t i = 1; i < r.L.size(); ++i) { pico = std::max(pico, static_cast<double>(std::fabs(r.L[i]))); salto = std::max(salto, static_cast<double>(std::fabs(r.L[i] - r.L[i - 1]))); }
        std::printf("   pico %.3f, salto maximo entre muestras %.3f\n", pico, salto);
        CHECK(salto < 0.6 * pico + 0.02, "clic en el robo de voz (salto %.3f, pico %.3f)", salto, pico);
        double cola = 0; for (size_t i = static_cast<size_t>(2.8 * SR); i < r.L.size(); ++i) cola = std::max(cola, static_cast<double>(std::fabs(r.L[i])));
        CHECK(cola < 1e-3, "tras el release sigue sonando (%.4f)", cola);
        CHECK(e.activeVoices() == 0, "quedan %d voces activas", e.activeVoices());
    }
    {
        // pedal de sustain: el noteOff se retiene
        VocalChoirEngine e; ChoirSettings s = base(); s.voices = 2; e.prepare(SR, 512); e.setSettings(s);
        e.pedal(true); e.noteOn(60, 0.8f);
        std::vector<float> z(48000, 0.0f), a(48000), b(48000);
        e.process(z.data(), z.data(), a.data(), b.data(), 24000, nullptr);
        e.noteOff(60);
        e.process(z.data(), z.data(), a.data(), b.data(), 24000, nullptr);
        CHECK(e.activeVoices() == 1, "el pedal no retiene la nota");
        e.pedal(false);
        for (int i = 0; i < 3; ++i) e.process(z.data(), z.data(), a.data(), b.data(), 24000, nullptr);
        CHECK(e.activeVoices() == 0, "al soltar el pedal la nota no se libera");
    }

    // ---------------- 7. CPU
    std::printf("7. CPU\n");
    {
        VocalChoirEngine e; ChoirSettings s; e.prepare(SR, 512); e.setSettings(s);
        e.noteOn(48, 0.9f); e.noteOn(52, 0.9f); e.noteOn(55, 0.9f); e.noteOn(60, 0.9f);
        const int blk = 512; std::vector<float> z(blk, 0.0f), a(blk), b(blk);
        const auto t0 = std::chrono::steady_clock::now();
        const int blocks = static_cast<int>(10.0 * SR / blk);
        for (int i = 0; i < blocks; ++i) e.process(z.data(), z.data(), a.data(), b.data(), blk, nullptr);
        const double seg = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        std::printf("   interna, 4 voces: %.3f s por 10 s de audio (%.2f %% de un nucleo)\n", seg, seg * 10.0);
        CHECK(seg < 1.5, "demasiado lento: %.2f s por 10 s", seg);
        VocalChoirEngine e2; ChoirSettings s2; s2.source = 0; e2.prepare(SR, 512); e2.setSettings(s2);
        e2.noteOn(48, 0.9f); e2.noteOn(52, 0.9f); e2.noteOn(55, 0.9f); e2.noteOn(60, 0.9f);
        const auto in = vozEntrada(SR, 200.0, 10.0);
        const auto t1 = std::chrono::steady_clock::now();
        for (int i = 0; i < blocks; ++i) e2.process(in.data() + static_cast<size_t>(i) * blk, in.data() + static_cast<size_t>(i) * blk, a.data(), b.data(), blk, nullptr);
        const double seg2 = std::chrono::duration<double>(std::chrono::steady_clock::now() - t1).count();
        std::printf("   entrada, 4 voces: %.3f s por 10 s de audio (%.2f %% de un nucleo)\n", seg2, seg2 * 10.0);
        CHECK(seg2 < 2.0, "demasiado lento con entrada: %.2f s", seg2);
    }

    // ---------------- 8. WAV de progresion
    if (argc > 1) {
        VocalChoirEngine e; ChoirSettings s; s.voices = 4; s.spread = 0.8; e.prepare(SR, 512); e.setSettings(s);
        std::vector<Ev> ev;
        const int acordes[4][4] = { { 48, 52, 55, 60 }, { 45, 52, 57, 60 }, { 41, 53, 57, 60 }, { 43, 50, 55, 59 } };
        for (int c = 0; c < 8; ++c) {
            const double t = c * 2.0;
            for (int j = 0; j < 4; ++j) { ev.push_back({ t, acordes[c % 4][j], 0.85f }); ev.push_back({ t + 1.9, acordes[c % 4][j], 0.0f }); }
        }
        auto r = render(e, SR, 17.0, ev);
        escribirWav(argv[1], r, static_cast<int>(SR));
        std::printf("8. WAV escrito en %s\n", argv[1]);
    }
    std::printf(g_fail ? "FALLOS: %d\n" : "TODO OK\n", g_fail);
    return g_fail ? 1 : 0;
}
