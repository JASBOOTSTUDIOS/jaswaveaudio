// JasWave Ambient Atmos - prueba de render offline (sin VST3).
//   Uso: AmbientAtmos_rendertest <ruta_base.wav> [--samples] [--rapido]
//   Sin --samples: motor modelado de respaldo (sin banco). Con --samples: carga los 3 bancos .jws reales de
//   %APPDATA%\JasWave\samples (o JASWAVE_SAMPLES_DIR) y mide ademas niveles, bucles y todos los presets con muestras.
//  1. Barrido: sr x bloque x ajustes extremos -> sin NaN/inf, salida acotada.
//  2. Los 40 presets: nivel (pico -18..-3 dBFS a vel 0.7), centroide espectral, variacion, sin NaN.
//  3. Estabilidad: acorde sostenido 60 s (sin crecimiento) y peor caso (feedback 92 %, shimmer 100 %, cola 30 s).
//  4. Colas largas: terminan en silencio (< -90 dBFS) en un tiempo finito.
//  5. (--samples) Bucles: costura de cada zona de cada banco + derivada maxima del render en seco de cada capa (40 s).
//  6. Cambios bruscos de parametros: sin saltos (zipper).
//  7. CPU por segundo de audio con 8 notas.
//  8. WAV 24-bit/48 kHz de 3 presets representativos (progresion de 4 acordes).
#define _CRT_SECURE_NO_WARNINGS
#include "ambient_atmos_dsp.h"

#include <chrono>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>

using namespace JasWaveAmbientAtmos;

static int g_fail = 0;
static bool g_samples = false, g_fast = false;
static std::string g_only;   // --solo <barrido|presets|estabilidad|colas|bucles|afinacion|zipper|cpu|wav>
static bool want(const char* n) { return g_only.empty() || g_only == n; }
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
static double centroidHz(const std::vector<float>& x, size_t start, size_t N, double sr) {
    std::vector<std::complex<double>> a(N);
    for (size_t i = 0; i < N; ++i) a[i] = (start + i < x.size() ? x[start + i] : 0.0f) * (0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(N)));
    fft(a);
    double num = 0.0, den = 0.0;
    for (size_t k = 1; k < N / 2; ++k) { const double m = std::abs(a[k]); num += m * static_cast<double>(k) * sr / static_cast<double>(N); den += m; }
    return den > 0 ? num / den : 0.0;
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
static double nowSec() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
static double db(double v) { return 20.0 * std::log10(std::max(v, 1e-12)); }
static double rmsOf(const std::vector<float>& x, size_t a, size_t b) {
    double s = 0.0;
    for (size_t i = a; i < b && i < x.size(); ++i) s += static_cast<double>(x[i]) * x[i];
    return std::sqrt(s / static_cast<double>(std::max<size_t>(1, std::min(b, x.size()) - a)));
}
static double peakOf(const std::vector<float>& x, size_t a, size_t b) {
    double p = 0.0;
    for (size_t i = a; i < b && i < x.size(); ++i) p = std::max(p, static_cast<double>(std::fabs(x[i])));
    return p;
}
static bool finiteAll(const std::vector<float>& x) { for (float v : x) if (!std::isfinite(v)) return false; return true; }

struct Ev { size_t at; int type; int note; float vel; };   // 0 = on, 1 = off

static void renderEv(AtmosEngine& e, std::vector<float>& L, std::vector<float>& R, size_t n, const std::vector<Ev>& ev, int block) {
    size_t pos = 0, ei = 0;
    while (pos < n) {
        const size_t blk = std::min<size_t>(static_cast<size_t>(block), n - pos);
        size_t p = 0;
        while (p < blk) {
            const size_t abs = pos + p;
            while (ei < ev.size() && ev[ei].at <= abs) { if (ev[ei].type == 0) e.noteOn(ev[ei].note, ev[ei].vel); else e.noteOff(ev[ei].note); ++ei; }
            size_t next = blk;
            if (ei < ev.size() && ev[ei].at < pos + blk) next = ev[ei].at - pos;
            e.render(L.data() + abs, R.data() + abs, static_cast<int>(next - p), nullptr);
            p = next;
        }
        pos += blk;
    }
}

static std::vector<std::shared_ptr<JwSampler::Bank>> g_banks;   // mantiene los bancos en memoria entre motores

static std::unique_ptr<AtmosEngine> makeEngine(double sr, const AtmosSettings& s) {
    auto e = std::make_unique<AtmosEngine>();
    e->prepare(sr, 4096, false);
    if (g_samples) for (int b = 0; b < kNumBanks; ++b) e->loadBankSync(b);
    e->setSettings(s);
    e->settle();
    return e;
}
static AtmosSettings presetSettings(int i) { AtmosSettings s; s.loadPreset(i); return s; }
static AtmosSettings dryNeutral(int i) {      // solo el generador: sin efectos, para medir bucles
    AtmosSettings s = presetSettings(i);
    s.p[kDelayMix] = 0; s.p[kReverbMix] = 0; s.p[kShimmer] = 0; s.p[kChorus] = 0; s.p[kDrive] = 0; s.p[kComp] = 0; s.p[kLfoDepth] = 0;
    s.p[kCutoff] = 20000; s.p[kLowCut] = 20; s.p[kFxMacro] = 50; s.p[kWidth] = 100; s.p[kAttack] = 0.05; s.p[kUnisonVoices] = 0;
    return s;
}

// ------------------------------------------------------------------ hash determinista (neutralidad del FX Rack)
static uint64_t renderHash(AtmosEngine& e, double sr, int block) {
    const size_t N = static_cast<size_t>(6 * sr);
    std::vector<float> L(N, 0.0f), R(N, 0.0f);
    std::vector<Ev> ev;
    const int notes[] = { 38, 50, 57, 62, 66 };
    for (int k = 0; k < 5; ++k) { ev.push_back({ static_cast<size_t>(k * 700), 0, notes[k], 0.6f + 0.05f * k }); ev.push_back({ static_cast<size_t>(3 * sr) + static_cast<size_t>(k * 300), 1, notes[k], 0.0f }); }
    renderEv(e, L, R, N, ev, block);
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < N; ++i) { uint32_t a, b; std::memcpy(&a, &L[i], 4); std::memcpy(&b, &R[i], 4); h = (h ^ a) * 1099511628211ull; h = (h ^ b) * 1099511628211ull; }
    return h;
}
static const int kHashPresets[] = { 0, 5, 10, 17, 22, 28, 35, 39 };
static uint64_t hashPresets(double sr, int block, const JasWaveFx::FxParams* fx = nullptr) {      // hash combinado de varios presets (los tres bancos y la familia 4)
    uint64_t h = 1469598103934665603ull;
    for (int idx : kHashPresets) {
        auto e = makeEngine(sr, presetSettings(idx));
        if (fx) e->setFx(*fx);
        h = (h ^ renderHash(*e, sr, block)) * 1099511628211ull;
    }
    return h;
}

// ------------------------------------------------------------------ 1. barrido
static void testSweep() {
    std::printf("[1] Barrido: sr x bloque x ajustes (extremos incluidos) -> sin NaN/inf, salida acotada\n");
    const double srs[] = { 44100.0, 48000.0, 96000.0, 192000.0 };
    const int blocks[] = { 1, 37, 256, 4096 };
    long runs = 0, bad = 0;
    Xor rng; rng.seed(77);
    for (const double sr : srs) {
        for (int trial = 0; trial < (g_fast ? 3 : 6); ++trial) {
            AtmosSettings s = presetSettings(trial * 7 % kNumPresets);
            if (trial >= 2) {   // ajustes al azar dentro de los rangos
                for (const Spec& sp : specs()) {
                    if (sp.id == kPreset || sp.id == kBypass) continue;
                    const double u = rng.uni();
                    s.p[sp.id] = sp.map == Map::Log ? sp.mn * std::pow(sp.mx / sp.mn, u) : (sp.map == Map::Stepped ? std::floor(u * (sp.steps + 1)) : sp.mn + (sp.mx - sp.mn) * u);
                }
            }
            if (trial == 5) { s.p[kDelayFb] = 92; s.p[kShimmer] = 100; s.p[kReverbDecay] = 30; s.p[kReverbMix] = 100; s.p[kFxMacro] = 100; s.p[kDelayMix] = 100; s.p[kResonance] = 90; }
            auto e = makeEngine(sr, s);
            e->setTempo(trial % 2 ? 60.0 : 180.0);
            const int blk = blocks[(trial + static_cast<int>(sr / 1000.0)) % 4];
            const size_t N = static_cast<size_t>(sr * (blk == 1 ? 0.25 : (g_fast ? 1.5 : 3.0)));
            std::vector<float> L(N), R(N);
            std::vector<Ev> ev;
            for (int k = 0; k < 6; ++k) ev.push_back({ static_cast<size_t>(k) * N / 12, 0, 36 + k * 9, 0.4f + 0.1f * static_cast<float>(k % 5) });
            ev.push_back({ N * 2 / 3, 1, 36, 0.f });
            renderEv(*e, L, R, N, ev, blk);
            ++runs;
            const bool ok = finiteAll(L) && finiteAll(R) && peakOf(L, 0, N) <= 1.0 && peakOf(R, 0, N) <= 1.0;
            if (!ok) ++bad;
        }
    }
    std::printf("    %ld ejecuciones, %ld con NaN/inf/sobrepaso\n", runs, bad);
    CHECK(bad == 0, "hay salidas no finitas o > 0 dBFS");
}

// ------------------------------------------------------------------ 2. presets
struct PresetStat { double peakDb, rmsDb, centroid, varDb; bool finite; };
static PresetStat measurePreset(int idx, double sr = 48000.0) {
    AtmosSettings s = presetSettings(idx);
    auto e = makeEngine(sr, s);
    const size_t N = static_cast<size_t>(sr * 12.0);
    std::vector<float> L(N), R(N);
    std::vector<Ev> ev = { { 0, 0, 48, 0.7f }, { static_cast<size_t>(sr * 8.0), 1, 48, 0.f } };
    renderEv(*e, L, R, N, ev, 512);
    PresetStat st{};
    st.finite = finiteAll(L) && finiteAll(R);
    st.peakDb = db(std::max(peakOf(L, 0, N), peakOf(R, 0, N)));
    st.rmsDb = db(rmsOf(L, static_cast<size_t>(sr * 3), static_cast<size_t>(sr * 8)));
    std::vector<float> M(N);
    for (size_t i = 0; i < N; ++i) M[i] = 0.5f * (L[i] + R[i]);
    st.centroid = centroidHz(M, static_cast<size_t>(sr * 5), 1u << 15, sr);
    // variacion: desviacion tipica (dB) del RMS en ventanas de 0.5 s entre 3 y 8 s
    double sum = 0, sum2 = 0; int cnt = 0;
    for (int w = 6; w < 16; ++w) { const double d = db(rmsOf(L, static_cast<size_t>(sr * 0.5 * w), static_cast<size_t>(sr * 0.5 * (w + 1)))); sum += d; sum2 += d * d; ++cnt; }
    st.varDb = std::sqrt(std::max(0.0, sum2 / cnt - (sum / cnt) * (sum / cnt)));
    return st;
}
static void testPresets() {
    std::printf("[2] %d presets, nota C3 vel 0.7 mantenida 8 s (+ cola): pico/RMS/centroide/variacion\n", kNumPresets);
    std::printf("    %-3s %-22s %-22s %8s %8s %9s %7s\n", "#", "preset", "familia", "pico dBFS", "RMS dB", "centroide", "var dB");
    for (int i = 0; i < kNumPresets; ++i) {
        const PresetStat st = measurePreset(i);
        const Preset& p = presets()[static_cast<size_t>(i)];
        std::printf("    %02d  %-22s %-22s %8.1f %8.1f %8.0f Hz %7.2f\n", i, p.name, familyName(p.family), st.peakDb, st.rmsDb, st.centroid, st.varDb);
        CHECK(st.finite, "preset %d (%s): NaN/inf", i, p.name);
        CHECK(st.peakDb <= -3.0 && st.peakDb >= -18.0, "preset %d (%s): pico %.1f dBFS fuera de -18..-3", i, p.name, st.peakDb);
    }
}

// ------------------------------------------------------------------ 3. estabilidad
static void testStability() {
    std::printf("[3] Estabilidad\n");
    const double sr = 48000.0;
    struct Caso { const char* nombre; AtmosSettings s; };
    AtmosSettings worst = presetSettings(0);
    worst.p[kDelayFb] = 92; worst.p[kShimmer] = 100; worst.p[kReverbDecay] = 30; worst.p[kReverbMix] = 100; worst.p[kFxMacro] = 100; worst.p[kDelayMix] = 100;
    worst.p[kReverbDamp] = 0; worst.p[kResonance] = 90; worst.p[kReverbMod] = 100; worst.p[kCutoff] = 20000;
    Caso casos[] = { { "preset 0, acorde 60 s (40 s con --rapido)", presetSettings(0) }, { "peor caso (fb 92 %, shimmer 100 %, cola 30 s)", worst }, { "pads + shimmer +7", presetSettings(19) } };
    for (auto& c : casos) {
        auto e = makeEngine(sr, c.s);
        const size_t N = static_cast<size_t>(sr * (g_fast ? 40.0 : 60.0));
        std::vector<float> L(N), R(N);
        std::vector<Ev> ev = { { 0, 0, 48, 0.7f }, { 0, 0, 55, 0.7f }, { 0, 0, 64, 0.6f }, { 0, 0, 72, 0.6f } };
        renderEv(*e, L, R, N, ev, 512);
        const double early = rmsOf(L, static_cast<size_t>(sr * 15), static_cast<size_t>(sr * 25));
        const double late = rmsOf(L, N - static_cast<size_t>(sr * 10), N);
        std::printf("    %-46s RMS 15-25 s %.1f dB, 50-60 s %.1f dB, pico %.1f dBFS\n", c.nombre, db(early), db(late), db(peakOf(L, 0, N)));
        CHECK(finiteAll(L) && finiteAll(R), "%s: NaN/inf", c.nombre);
        CHECK(db(late) - db(early) < 3.0, "%s: crece %.1f dB", c.nombre, db(late) - db(early));
        CHECK(peakOf(L, 0, N) < 1.0, "%s: pico >= 0 dBFS", c.nombre);
    }
}

// ------------------------------------------------------------------ 4. colas
static void testTails() {
    std::printf("[4] Colas largas: nota 2 s, suelta, y se mide el tiempo hasta < -90 dBFS (ventanas de 100 ms)\n");
    const double sr = 48000.0;
    struct Caso { const char* n; AtmosSettings s; };
    AtmosSettings big = presetSettings(7);
    big.p[kReverbDecay] = 30; big.p[kRelease] = 16; big.p[kDelayFb] = 92; big.p[kShimmer] = 100; big.p[kReverbMix] = 100; big.p[kDelayMix] = 80;
    Caso casos[] = { { "preset 0", presetSettings(0) }, { "Glass Cathedral", presetSettings(27) }, { "cola maxima (30 s, fb 92 %, shimmer 100 %)", big } };
    for (auto& c : casos) {
        auto e = makeEngine(sr, c.s);
        const size_t N = static_cast<size_t>(sr * (g_fast ? 90.0 : 200.0));
        std::vector<float> L(N), R(N);
        std::vector<Ev> ev = { { 0, 0, 52, 0.7f }, { static_cast<size_t>(sr * 2), 1, 52, 0.f } };
        renderEv(*e, L, R, N, ev, 1024);
        const size_t win = static_cast<size_t>(sr * 0.1);
        double tEnd = -1.0;
        for (size_t i = static_cast<size_t>(sr * 3); i + win < N; i += win) {
            double r = std::max(rmsOf(L, i, i + win), rmsOf(R, i, i + win));
            if (db(r) < -90.0) {
                // debe seguir en silencio hasta el final
                if (db(std::max(rmsOf(L, i, N), rmsOf(R, i, N))) < -85.0) { tEnd = static_cast<double>(i) / sr; break; }
            }
        }
        std::printf("    %-46s silencio (< -90 dBFS) a los %.1f s\n", c.n, tEnd);
        CHECK(tEnd > 0.0, "%s: la cola no termina en 200 s", c.n);
    }
}

// ------------------------------------------------------------------ 5. bucles (solo --samples)
static void testLoops() {
    std::printf("[5] Bucles de los bancos (costura / p99 de la variacion; <= 1.5 = sin clic) y render en seco de cada capa\n");
    const char* slugs[3] = { "ambient-atmos-guitar", "ambient-atmos-pads", "ambient-atmos-textures" };
    for (int b = 0; b < kNumBanks; ++b) {
        std::string err;
        const std::string dir = JwSampler::samplesDir();
        const std::string path = dir + "\\" + slugs[b] + ".jws";
        auto bank = JwSampler::acquireBank(path, err);
        CHECK(bank != nullptr, "no se pudo cargar %s: %s", path.c_str(), err.c_str());
        if (!bank) continue;
        g_banks.push_back(bank);
        double worstRatio = 0.0; int nLoop = 0;
        std::vector<int> groups;
        for (const auto& z : bank->zones) {
            if (std::find(groups.begin(), groups.end(), static_cast<int>(z.group)) == groups.end()) groups.push_back(z.group);
            if (z.loopEnd <= z.loopStart) continue;
            const int16_t* d = bank->data(z);
            const size_t ch = z.channels;
            std::vector<double> m(z.loopEnd - z.loopStart);
            for (size_t i = 0; i < m.size(); ++i) {
                double a = 0; for (size_t c = 0; c < ch; ++c) a += d[(z.loopStart + i) * ch + c];
                m[i] = a / static_cast<double>(ch);
            }
            std::vector<double> df(m.size() - 1);
            for (size_t i = 0; i + 1 < m.size(); ++i) df[i] = std::fabs(m[i + 1] - m[i]);
            std::vector<double> srt = df; std::sort(srt.begin(), srt.end());
            const double p99 = srt[static_cast<size_t>(0.99 * static_cast<double>(srt.size() - 1))] + 1e-9;
            const double jump = std::fabs(m.front() - m.back());
            worstRatio = std::max(worstRatio, jump / p99);
            ++nLoop;
        }
        std::printf("    %-24s %zu zonas, %d capas, %d bucles, peor costura %.2f, %.1f MB\n", slugs[b], bank->zones.size(), static_cast<int>(groups.size()), nLoop, worstRatio,
                    static_cast<double>(bank->pcm.size() * 2) / 1e6);
        CHECK(worstRatio <= 1.5, "%s: costura de bucle %.2f", slugs[b], worstRatio);
    }
    // Render en seco (40 s, una nota sostenida) de cada preset: busca clics (diferencia local >> tipica)
    const double sr = 48000.0;
    int clickPresets = 0;
    for (int i = 0; i < kNumPresets; ++i) {
        auto e = makeEngine(sr, dryNeutral(i));
        const size_t N = static_cast<size_t>(sr * (g_fast ? 20.0 : 40.0));
        std::vector<float> L(N), R(N);
        std::vector<Ev> ev = { { 0, 0, 55, 0.7f } };
        renderEv(*e, L, R, N, ev, 512);
        const Preset& p = presets()[static_cast<size_t>(i)];
        // los one-shots de sound design terminan solos: solo se mide mientras suenan (> -60 dB)
        size_t end = N;
        for (size_t k = N; k > static_cast<size_t>(sr); k -= static_cast<size_t>(sr / 10)) { if (db(rmsOf(L, k - static_cast<size_t>(sr / 10), k)) > -60.0) { end = k; break; } }
        std::vector<double> df;
        for (size_t k = static_cast<size_t>(sr * 0.5) + 1; k < end; ++k) df.push_back(std::fabs(static_cast<double>(L[k]) - L[k - 1]));
        if (df.size() < 1000) continue;
        std::vector<double> srt = df; std::sort(srt.begin(), srt.end());
        const double p999 = srt[static_cast<size_t>(0.999 * static_cast<double>(srt.size() - 1))] + 1e-9;
        const double mx = srt.back();
        const double ratio = mx / p999;
        if (ratio > 3.0) ++clickPresets;
        if (i % 5 == 0 || ratio > 3.0) std::printf("    seco preset %02d %-20s derivada max/p99.9 = %.2f\n", i, p.name, ratio);
        CHECK(ratio <= 3.0, "preset %d (%s): posible clic (max/p99.9 = %.2f)", i, p.name, ratio);
    }
    std::printf("    presets con posible clic: %d\n", clickPresets);
}

// ------------------------------------------------------------------ 5b. afinacion y estereo (solo --samples)
static double combCents(const std::vector<float>& x, size_t start, size_t N, double sr, double f0, double* score) {
    std::vector<std::complex<double>> a(N);
    for (size_t i = 0; i < N; ++i) a[i] = (start + i < x.size() ? x[start + i] : 0.0f) * (0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(N)));
    fft(a);
    auto mag = [&](double f) {   // magnitud interpolada (log-parabolica en el bin mas cercano)
        const double b = f * static_cast<double>(N) / sr;
        const size_t k = static_cast<size_t>(b + 0.5);
        if (k < 1 || k + 1 >= N / 2) return 0.0;
        double m = 0.0;
        for (size_t j = k - 1; j <= k + 1; ++j) m = std::max(m, std::abs(a[j]));
        return m;
    };
    double best = -1.0, bestC = 0.0;
    for (int c = -60; c <= 60; ++c) {
        const double f = f0 * std::pow(2.0, c / 1200.0);
        double sc = 0.0;
        for (int k = 1; k <= 8; ++k) sc += std::log(mag(f * k) + 1e-9) / static_cast<double>(k);
        if (sc > best) { best = sc; bestC = c; }
    }
    if (score) *score = best;
    return bestC;
}
static void testPitchStereo() {
    std::printf("[5b] Afinacion (peine armonico, cents de error) y estereo (correlacion L/R) de cada capa, render en seco\n");
    const double sr = 48000.0;
    struct Capa { int preset; const char* nombre; bool afinada; };
    const Capa capas[] = { { 1, "guitarra dreamy", true }, { 0, "guitarra octava", true }, { 2, "guitarra 5a+8a", true }, { 4, "guitarra saturada", true },
                           { 10, "pad coro", true }, { 16, "pad new age", true }, { 12, "pad barrido", true }, { 18, "pad arco", true }, { 15, "pad cuerdas", true },
                           { 23, "dron cuerdas", true }, { 25, "nube armonica", true }, { 20, "aire", false }, { 21, "viento", false }, { 22, "presion", false }, { 24, "olas", false } };
    for (const auto& c : capas) {
        double worstCents = 0.0, corr = 0.0;
        int nn = 0;
        for (int note : { 48, 60, 72 }) {
            AtmosSettings s = dryNeutral(c.preset);
            s.p[kLayerBlend] = 0.0;
            s.p[kUnisonVoices] = 0;
            s.p[kUnisonDetune] = 0.0;
            // solo la capa A del preset (sin B)
            auto e = makeEngine(sr, s);
            const size_t N = static_cast<size_t>(sr * 10.0);
            std::vector<float> L(N), R(N);
            renderEv(*e, L, R, N, { { 0, 0, note, 0.7f } }, 512);
            const double f0 = 440.0 * std::pow(2.0, (note - 69) / 12.0);
            std::vector<float> M(N);
            double sl = 0, sr2 = 0, slr = 0;
            for (size_t i = static_cast<size_t>(sr * 2); i < N; ++i) { sl += static_cast<double>(L[i]) * L[i]; sr2 += static_cast<double>(R[i]) * R[i]; slr += static_cast<double>(L[i]) * R[i]; }
            corr += slr / std::sqrt(sl * sr2 + 1e-18);
            for (size_t i = 0; i < N; ++i) M[i] = 0.5f * (L[i] + R[i]);
            const double cents = combCents(M, static_cast<size_t>(sr * 3), 1u << 18, sr, f0, nullptr);
            worstCents = std::max(worstCents, std::fabs(cents));
            if (std::getenv("ATMOS_VERBOSE")) std::printf("        nota %d: %+.0f cents\n", note, cents);
            ++nn;
        }
        std::printf("    %-18s error max %4.0f cents (notas 48/60/72), correlacion L/R %.2f%s\n", c.nombre, worstCents, corr / nn, c.afinada ? "" : "  (ruido: afinacion no aplica)");
        if (c.afinada) CHECK(worstCents <= 25.0, "%s: desafinada %.0f cents", c.nombre, worstCents);
        CHECK(corr / nn < 0.97, "%s: casi mono (corr %.2f)", c.nombre, corr / nn);
    }
}

// ------------------------------------------------------------------ 5c. carga bajo demanda (solo --samples)
static void testOnDemand() {
    std::printf("[5c] Carga de bancos bajo demanda segun la familia del preset (hilo de carga, descarga diferida)\n");
    const double sr = 48000.0;
    AtmosEngine e;
    e.prepare(sr, 512, true);   // autoLoad: el motor pide el banco de la familia activa y descarga los demas cuando callan
    std::vector<float> L(512), R(512);
    auto pump = [&](int blocks) { for (int i = 0; i < blocks; ++i) e.render(L.data(), R.data(), 512, nullptr); };
    auto waitState = [&](int bank, int want, double maxSec) {
        const double t0 = nowSec();
        while (e.bankState(bank) != want && nowSec() - t0 < maxSec) { pump(4); std::this_thread::sleep_for(std::chrono::milliseconds(20)); }
        return nowSec() - t0;
    };
    AtmosSettings s = presetSettings(0);                          // guitarras -> banco 0
    e.setSettings(s); e.settle();
    std::printf("    estado inicial banco guitar=%d (0 = aun sin pedir)\n", e.bankState(0));
    e.noteOn(48, 0.7f);                                           // nota antes de que el banco este listo: respaldo modelado
    pump(8);
    CHECK(e.modelVoices() > 0 || e.sampleVoices() > 0, "la nota no suena");
    const double tLoad = waitState(0, 2, 30.0);
    std::printf("    banco guitar listo en %.2f s (nota inicial con motor modelado: %d voz/voces)\n", tLoad, e.modelVoices());
    CHECK(e.bankState(0) == 2, "el banco guitar no se cargo en 30 s: %s", e.lastError().c_str());
    e.noteOff(48);
    e.noteOn(55, 0.7f); pump(8);
    CHECK(e.sampleVoices() > 0, "con el banco listo la nota debe sonar con muestras");
    e.noteOff(55);
    s.loadPreset(10);                                             // pads -> banco 1; el de guitarras se descarga al callar
    e.setSettings(s); e.settle();
    const double tPads = waitState(1, 2, 30.0);
    std::printf("    cambio a familia pads: banco pads listo en %.2f s\n", tPads);
    CHECK(e.bankState(1) == 2, "el banco pads no se cargo");
    e.allSoundOff(); pump(8);
    waitState(0, 0, 10.0);
    std::printf("    banco guitar descargado: %s\n", e.bankState(0) == 0 ? "si" : "no");
    CHECK(e.bankState(0) == 0, "el banco guitar no se descargo tras callar");
}

// ------------------------------------------------------------------ calibracion de nivel por preset
static void calibrate() {
    std::printf("Calibracion: RMS de un acorde (C3 G3 E4, vel 0.7) en 3..8 s con trim 0 dB; objetivo -22 dBFS\n");
    const double sr = 48000.0;
    std::vector<double> rms(kNumPresets);
    for (int i = 0; i < kNumPresets; ++i) {
        auto e = makeEngine(sr, presetSettings(i));
        const size_t N = static_cast<size_t>(sr * 9.0);
        std::vector<float> L(N), R(N);
        renderEv(*e, L, R, N, { { 0, 0, 48, 0.7f }, { 0, 0, 55, 0.7f }, { 0, 0, 64, 0.7f } }, 512);
        std::vector<float> M(N);
        for (size_t k = 0; k < N; ++k) M[k] = 0.5f * (L[k] + R[k]);
        const bool design = presets()[static_cast<size_t>(i)].family == kFamDesign;
        rms[static_cast<size_t>(i)] = db(rmsOf(M, static_cast<size_t>(sr * (design ? 0.5 : 3.0)), static_cast<size_t>(sr * 8)));
    }
    std::printf("static const std::array<double, kNumPresets> t = { {\n        ");
    for (int i = 0; i < kNumPresets; ++i) {
        const double trim = std::max(-6.0, std::min(6.0, -20.0 - rms[static_cast<size_t>(i)]));
        std::printf("%.1f%s", std::round(trim * 2.0) / 2.0 + 0.0, i + 1 < kNumPresets ? ((i + 1) % 10 == 0 ? ",\n        " : ", ") : "\n");
    }
    std::printf("} };\n");
    for (int i = 0; i < kNumPresets; ++i) std::printf("  %02d %-20s %.1f dB\n", i, presets()[static_cast<size_t>(i)].name, rms[static_cast<size_t>(i)]);
}

// ------------------------------------------------------------------ 6. cambios bruscos
static void testZipper() {
    std::printf("[6] Cambios bruscos de parametros con nota sostenida: derivada maxima tras el cambio vs antes\n");
    const double sr = 48000.0;
    struct Cambio { const char* n; uint32_t id; double v; };
    const Cambio cambios[] = { { "cutoff 20k->300", kCutoff, 300 }, { "reverb tipo plate", kReverbType, 0 }, { "delay sync 1/8", kDelaySync, 5 }, { "attack", kAttack, 8 },
                               { "fx macro 100", kFxMacro, 100 }, { "eq alto +12", kEqHigh, 12 }, { "volumen -18", kVolume, -18 }, { "shimmer 100 (-12)", kShimmerInterval, 2 },
                               { "width 0", kWidth, 0 }, { "low cut 400", kLowCut, 400 } };
    for (const auto& c : cambios) {
        AtmosSettings s = presetSettings(10);
        auto e = makeEngine(sr, s);
        const size_t N = static_cast<size_t>(sr * 8.0), T = static_cast<size_t>(sr * 4.0);
        std::vector<float> L(N), R(N);
        std::vector<Ev> ev = { { 0, 0, 55, 0.7f }, { 0, 0, 62, 0.7f } };
        renderEv(*e, L, R, T, ev, 512);
        AtmosSettings s2 = s; s2.p[c.id] = c.v;
        e->setSettings(s2);
        std::vector<float> L2(N - T), R2(N - T);
        renderEv(*e, L2, R2, N - T, {}, 512);
        double mxA = 0, mxB = 0;
        for (size_t i = static_cast<size_t>(sr); i < T; ++i) mxA = std::max(mxA, static_cast<double>(std::fabs(L[i] - L[i - 1])));
        for (size_t i = 1; i < L2.size(); ++i) mxB = std::max(mxB, static_cast<double>(std::fabs(L2[i] - L2[i - 1])));
        const bool ok = mxB <= 3.0 * mxA + 1e-4;
        std::printf("    %-22s antes %.5f  despues %.5f  %s\n", c.n, mxA, mxB, ok ? "ok" : "SALTO");
        CHECK(ok, "%s: salto de %.5f vs %.5f", c.n, mxB, mxA);
    }
}

// ------------------------------------------------------------------ 7. CPU
static void testCpu() {
    std::printf("[7] CPU: 8 notas (unison 2-3, delay + reverb + shimmer), 48 kHz\n");
    const double sr = 48000.0;
    for (int idx : { 0, 10, 17 }) {
        AtmosSettings s = presetSettings(idx);
        s.p[kUnisonVoices] = 2;
        auto e = makeEngine(sr, s);
        const size_t N = static_cast<size_t>(sr * 10.0);
        std::vector<float> L(N), R(N);
        std::vector<Ev> ev;
        for (int k = 0; k < 8; ++k) ev.push_back({ 0, 0, 40 + k * 5, 0.7f });
        double best = 1e9;
        for (int pass = 0; pass < 3; ++pass) {
            const double t0 = nowSec();
            renderEv(*e, L, R, N, pass == 0 ? ev : std::vector<Ev>{}, 256);
            best = std::min(best, nowSec() - t0);
        }
        const double pct = best / 10.0 * 100.0;
        std::printf("    preset %02d %-18s %.2f %% de un nucleo\n", idx, presets()[static_cast<size_t>(idx)].name, pct);
        CHECK(pct < 25.0, "CPU %.1f %% demasiado alta", pct);
    }
}

// ------------------------------------------------------------------ 8. WAV
static void writeProgression(int idx, const std::string& path) {
    const double sr = 48000.0;
    AtmosSettings s = presetSettings(idx);
    auto e = makeEngine(sr, s);
    e->setTempo(72.0);
    const size_t bar = static_cast<size_t>(sr * 60.0 / 72.0 * 4.0);   // un compas de 4 tiempos a 72 bpm
    const size_t N = bar * 6 + static_cast<size_t>(sr * 12.0);
    std::vector<float> L(N), R(N);
    static const int chords[4][4] = { { 50, 57, 62, 66 }, { 45, 57, 61, 64 }, { 47, 59, 62, 66 }, { 43, 55, 62, 67 } };   // D A Bm G (abiertos)
    std::vector<Ev> ev;
    for (int c = 0; c < 4; ++c)
        for (int k = 0; k < 4; ++k) {
            ev.push_back({ bar * static_cast<size_t>(c) + static_cast<size_t>(k) * 1200, 0, chords[c][k], 0.62f + 0.05f * static_cast<float>(k % 3) });
            ev.push_back({ bar * static_cast<size_t>(c + 1) - 4000 + static_cast<size_t>(k) * 700, 1, chords[c][k], 0.f });
        }
    // ultimo acorde sostenido y suelto
    std::sort(ev.begin(), ev.end(), [](const Ev& a, const Ev& b) { return a.at < b.at; });
    renderEv(*e, L, R, N, ev, 512);
    const bool ok = writeWav24(path.c_str(), L, R, 48000);
    std::printf("    %s -> %s (pico %.1f dBFS, RMS %.1f dB)\n", presets()[static_cast<size_t>(idx)].name, ok ? path.c_str() : "ERROR AL ESCRIBIR",
                db(std::max(peakOf(L, 0, N), peakOf(R, 0, N))), db(rmsOf(L, bar, bar * 4)));
    CHECK(ok && finiteAll(L), "WAV %s", path.c_str());
}

// ------------------------------------------------------------------ 9. FX Rack comun (jw_fxrack.h)
static double cpuSeconds() { return nowSec(); }
static void testFxRack() {
    using namespace JasWaveFx;
    std::printf("[9] FX Rack comun (jw_fxrack.h, ids %u..%u)\n", kBase, kBase + kUltimoOffset);
    const double SR = 48000.0;

    // ---- 9.0 definiciones: ids estandar, contiguos al final, nombres con prefijo, defaults neutros ----
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

    // ---- 9.1 neutralidad bit a bit en el motor (rack apagado == salida previa del plugin), 8 presets x 3 bancos ----
    {
        // hashes de referencia tomados ANTES de integrar el rack (motor previo): 8 presets (0,5,10,17,22,28,35,39), notas fijas
        const uint64_t gold1 = g_samples ? 0x028c8a9e127bed75ull : 0xc3153d940a8522b4ull;   // 48 kHz, bloques de 512
        const uint64_t gold2 = g_samples ? 0x5bbd68ccdf953c01ull : 0xe5855a306c046558ull;   // 44.1 kHz, bloques de 137
        const uint64_t h0 = hashPresets(48000.0, 512), h0b = hashPresets(44100.0, 137);
        // con valores de rack ajustados pero TODOS los bloques apagados
        FxParams p = porDefecto();
        for (int b = 0; b < kBands; ++b) { p.eq[b].gainDb = 12.0; p.eq[b].hz *= 1.3; }
        p.compThreshDb = -50; p.compRatio = 20; p.satDrive = 1.0; p.dlTimeMs = 100; p.rvMix = 1.0; p.outWidth = 2.0; p.outGainDb = 12.0;
        const uint64_t h1 = hashPresets(48000.0, 512, &p), h1b = hashPresets(44100.0, 137, &p);
        std::printf("    hash %s sin rack=0x%016llx / 0x%016llx, rack apagado con valores extremos=0x%016llx / 0x%016llx (referencia 0x%016llx / 0x%016llx)\n",
                    g_samples ? "(muestras)" : "(modelado)", static_cast<unsigned long long>(h0), static_cast<unsigned long long>(h0b), static_cast<unsigned long long>(h1),
                    static_cast<unsigned long long>(h1b), static_cast<unsigned long long>(gold1), static_cast<unsigned long long>(gold2));
        CHECK(h0 == gold1 && h0b == gold2, "el rack apagado cambia el sonido por defecto del plugin");
        CHECK(h1 == gold1 && h1b == gold2, "el rack con bloques apagados cambia el sonido");
        FxParams q = porDefecto(); q.eqOn = true; q.eq[2].gainDb = 9.0; q.dlOn = true; q.rvOn = true; q.compOn = true; q.satOn = true; q.chOn = true; q.outOn = true;
        CHECK(hashPresets(48000.0, 512, &q) != gold1, "el rack encendido no cambia nada");
    }
    // ---- 9.1b los presets no tocan los ids >= 100 (el rack es del usuario) ----
    {
        int tocados = 0;
        for (const Spec& sp : specs()) if (sp.id >= kBase) ++tocados;
        CHECK(tocados == 0, "specs() de los presets incluye ids del rack");
        CHECK(kParamCount <= kBase, "ids propios de Atmos invaden el rango del rack");
        std::printf("    presets: ids propios 0..%u, ninguno >= %u (el cambio de preset no resetea el rack)\n", kParamCount - 1, kBase);
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
    // ---- 9.2 EQ: respuesta medida de cada banda ----
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

    // ---- 9.3 compresor ----
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

    // ---- 9.4 saturacion: THD creciente con el drive; tipos ----
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

    // ---- 9.5 delay: tiempo, sync, feedback, ping-pong ----
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
            std::printf("      sync %s @120 bpm: %.2f ms (esperado %.0f)\n", JasWaveFx::labelsSync()[sy[k]], got, ms[k]);
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

    // ---- 9.6 reverb: estabilidad a 60 s, decaimiento, orden de tipos/tamano ----
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

    // ---- 9.7 chorus ----
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

    // ---- 9.8 barrido de estabilidad: sr x bloque x parametros extremos con automatizacion ----
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

    // ---- 9.9 sin clics al activar/desactivar bloques ----
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

    // ---- 9.10 CPU con TODO activo ----
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

    // ---- 9.10b soporte float y double: misma salida (la cadena trabaja en double) ----
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

    // ---- 9.11 motor: con todo encendido sigue siendo finito y acotado; el pico se mide tras el rack ----
    {
        AtmosSettings s0 = presetSettings(0);
        auto e = makeEngine(SR, s0);
        FxParams q = porDefecto(); q.hpfOn = q.eqOn = q.compOn = q.satOn = q.chOn = q.dlOn = q.rvOn = q.outOn = true;
        q.eq[1].gainDb = 8.0; q.outGainDb = -6.0;
        e->setFx(q);
        AtmosBus bus;
        const size_t N = static_cast<size_t>(6 * SR);
        std::vector<float> L(N, 0.0f), R(N, 0.0f);
        size_t pos = 0;
        e->noteOn(50, 0.8f); e->noteOn(57, 0.8f); e->noteOn(66, 0.8f);
        while (pos < N) { const int m = static_cast<int>(std::min<size_t>(512, N - pos)); e->render(L.data() + pos, R.data() + pos, m, &bus); pos += static_cast<size_t>(m); }
        bool fin = true; for (size_t i = 0; i < N; ++i) if (!std::isfinite(L[i]) || !std::isfinite(R[i]) || std::fabs(L[i]) > 1.0f) fin = false;
        std::printf("    motor con rack completo: finito y |x|<=1 = %d, GR publicado en el bus = %.2f dB\n", fin ? 1 : 0, bus.fxGrDb.load());
        CHECK(fin, "motor + rack no finito");
    }
}

int main(int argc, char** argv) {
    std::string base = argc > 1 && argv[1][0] != '-' ? argv[1] : "ambient_atmos.wav";
    for (int i = 1; i < argc; ++i) { if (!std::strcmp(argv[i], "--samples")) g_samples = true; if (!std::strcmp(argv[i], "--rapido")) g_fast = true; if (!std::strcmp(argv[i], "--solo") && i + 1 < argc) g_only = argv[i + 1]; }
    std::printf("JasWave Ambient Atmos rendertest (%s%s)\n", g_samples ? "con bancos .jws" : "motor modelado sin banco", g_fast ? ", rapido" : "");
    if (g_samples) {   // los bancos se cargan una vez y quedan en memoria (los motores de las pruebas los comparten)
        const char* slugs[3] = { "ambient-atmos-guitar", "ambient-atmos-pads", "ambient-atmos-textures" };
        for (int b = 0; b < kNumBanks; ++b) {
            std::string err;
            auto bank = JwSampler::acquireBank(JwSampler::samplesDir() + "\\" + slugs[b] + ".jws", err);
            CHECK(bank != nullptr, "banco %s no carga: %s", slugs[b], err.c_str());
            if (bank) g_banks.push_back(bank);
        }
    }
    for (int i = 1; i < argc; ++i) if (!std::strcmp(argv[i], "--calibrar")) { calibrate(); return 0; }
    if (want("hash")) { std::printf("HASH %s 48k/512=0x%016llx 44.1k/137=0x%016llx\n", g_samples ? "muestras" : "modelado", (unsigned long long)hashPresets(48000.0, 512), (unsigned long long)hashPresets(44100.0, 137)); if (g_only == "hash") return 0; }
    if (want("barrido")) testSweep();
    if (want("presets")) testPresets();
    if (want("estabilidad")) testStability();
    if (want("colas")) testTails();
    if (g_samples && want("bucles")) testLoops();
    if (g_samples && want("afinacion")) testPitchStereo();
    if (g_samples && want("demanda")) testOnDemand();
    if (want("zipper")) testZipper();
    if (want("cpu")) testCpu();
    if (want("fxrack")) testFxRack();
    if (!want("wav")) { std::printf(g_fail == 0 ? "\nRESULTADO: OK\n" : "\nRESULTADO: %d FALLO(S)\n", g_fail); return g_fail == 0 ? 0 : 1; }
    std::printf("[8] WAV de 3 presets representativos\n");
    std::string stem = base;
    if (stem.size() > 4 && stem.substr(stem.size() - 4) == ".wav") stem = stem.substr(0, stem.size() - 4);
    for (int idx : { 0, 10, 28 }) writeProgression(idx, stem + "_" + std::to_string(idx) + (g_samples ? "_muestras" : "_modelado") + ".wav");
    std::printf(g_fail == 0 ? "\nRESULTADO: OK\n" : "\nRESULTADO: %d FALLO(S)\n", g_fail);
    return g_fail == 0 ? 0 : 1;
}
