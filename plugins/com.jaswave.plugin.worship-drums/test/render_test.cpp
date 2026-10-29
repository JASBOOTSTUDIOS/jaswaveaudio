// Prueba de render offline de JasWave Worship Drums (solo worship_drums_dsp.h, sin SDK VST3).
//   JasWaveWorshipDrums_rendertest <salida.wav> [--quick]      (suite modelada, sin banco)
//   JasWaveWorshipDrums_rendertest <salida.wav> --samples      (banco MuldjordKit estereo; JASWAVE_SAMPLES_DIR elige la carpeta del banco)
// Mide: latencia de transitorio, energía espectral por elemento, choke, notas fuera del mapa, clics, DC, NaN,
// round-robin, capas de velocidad, afinación del bombo, estabilidad de la sala, independencia de bloque y de
// frecuencia de muestreo, polifonía/robo y coste de CPU. Escribe un WAV de 24 bit/48 kHz con un groove de
// worship de 8 compases. Sale con código != 0 si algo falla.
//   JasWaveWorshipDrums_rendertest --dump-hits <carpeta>       (golpes sueltos de bombo/caja/toms a 0.5/0.7/0.9 con el banco, para analisis externo antes/despues)
// v3 (--samples): S19-S23 miden el cuerpo y la pegada de caja y toms frente al banco original (Shell Body = Shell Punch = 0) y frente a umbrales de referencia;
// S22 escribe <salida>-redoble-toms.wav y <salida>-redoble-toms-banco-original.wav para comparar a oido.
#include "worship_drums_dsp.h"

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif
#include <algorithm>
#include <chrono>
#include <complex>
#include <cstring>
#include <set>
#include <memory>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
#include <vector>

using namespace JasWaveWorshipDrums;
using namespace JasWaveDsp;

static int g_fail = 0;
static void check(bool ok, const char* what, const std::string& detail = "") {
    std::printf("  [%s] %s %s\n", ok ? " OK " : "FAIL", what, detail.c_str());
    if (!ok) ++g_fail;
}
static std::string fmt(const char* f, double a = 0, double b = 0, double c = 0, double d = 0) {
    char buf[256];
    std::snprintf(buf, sizeof buf, f, a, b, c, d);
    return buf;
}

// Tiempo de CPU del hilo actual (no se ve afectado por otros procesos de la maquina)
static double threadCpuSeconds() {
#ifdef _WIN32
    FILETIME c, e, k, u;
    GetThreadTimes(GetCurrentThread(), &c, &e, &k, &u);
    auto t = [](const FILETIME& f) { return double((uint64_t(f.dwHighDateTime) << 32) | f.dwLowDateTime) * 1e-7; };
    return t(k) + t(u);
#else
    return double(std::clock()) / CLOCKS_PER_SEC;
#endif
}

static bool g_samples = false;   // modo --samples: espera a que cargue el banco antes de renderizar
struct Ev { int64_t at; int note; float vel; };
struct Out { std::vector<float> l, r; };

// Renderiza una lista de eventos con bloques de `blk` muestras y partiendo en cada evento (como el plugin)
static Out renderEvents(double sr, int64_t total, std::vector<Ev> evs, int blk, const DrumSettings* st = nullptr, DrumBus* bus = nullptr,
                        WorshipDrumsEngine* shared = nullptr) {
    std::unique_ptr<WorshipDrumsEngine> localEng(shared ? nullptr : new WorshipDrumsEngine());
    WorshipDrumsEngine& e = shared ? *shared : *localEng;
    if (!shared) {
        e.prepare(sr, blk);
        DrumSettings s; if (st) s = *st;
        e.setSettings(s);
        e.prepare(sr, blk);   // settle smoothers on the target values
        if (g_samples) for (int i = 0; i < 3000 && !e.samplerReady(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    std::sort(evs.begin(), evs.end(), [](const Ev& a, const Ev& b) { return a.at < b.at; });
    Out o; o.l.assign(static_cast<size_t>(total), 0.0f); o.r.assign(static_cast<size_t>(total), 0.0f);
    size_t ei = 0;
    int64_t pos = 0;
    while (pos < total) {
        const int64_t n = std::min<int64_t>(blk, total - pos);
        int64_t p = 0;
        while (p < n) {
            while (ei < evs.size() && evs[ei].at <= pos + p) { e.noteOn(evs[ei].note, evs[ei].vel); ++ei; }
            int64_t next = n;
            if (ei < evs.size() && evs[ei].at < pos + n) next = evs[ei].at - pos;
            if (next > p) { e.render(o.l.data() + pos + p, o.r.data() + pos + p, static_cast<int>(next - p), bus); p = next; }
        }
        pos += n;
    }
    return o;
}

static double rmsRange(const Out& o, int64_t a, int64_t b) {
    a = std::max<int64_t>(0, a); b = std::min<int64_t>(b, static_cast<int64_t>(o.l.size()));
    if (b <= a) return 0.0;
    double s = 0.0;
    for (int64_t i = a; i < b; ++i) s += 0.5 * (double(o.l[size_t(i)]) * o.l[size_t(i)] + double(o.r[size_t(i)]) * o.r[size_t(i)]);
    return std::sqrt(s / double(b - a));
}
static double peakOf(const Out& o) {
    double p = 0.0;
    for (size_t i = 0; i < o.l.size(); ++i) p = std::max({ p, double(std::fabs(o.l[i])), double(std::fabs(o.r[i])) });
    return p;
}
static bool finiteAll(const Out& o) {
    for (size_t i = 0; i < o.l.size(); ++i) if (!std::isfinite(o.l[i]) || !std::isfinite(o.r[i])) return false;
    return true;
}
static double db(double x) { return 20.0 * std::log10(std::max(x, 1e-9)); }

// Espectro de potencia (FFT 2^16) de la mezcla mono en [a, a+65536)
static std::vector<double> powerSpectrum(const Out& o, int64_t a) {
    const int L = 16, N = 1 << L;
    FFT fft(L);
    std::vector<float> re(N, 0.0f), im(N, 0.0f);
    for (int i = 0; i < N; ++i) {
        const int64_t k = a + i;
        const float w = static_cast<float>(0.5 - 0.5 * std::cos(2.0 * kPi * i / N));
        if (k >= 0 && k < static_cast<int64_t>(o.l.size())) re[i] = 0.5f * (o.l[size_t(k)] + o.r[size_t(k)]) * w;
    }
    fft.forward(re.data(), im.data());
    std::vector<double> p(N / 2 + 1);
    for (int i = 0; i <= N / 2; ++i) p[size_t(i)] = double(re[i]) * re[i] + double(im[i]) * im[i];
    return p;
}
static double bandDb(const std::vector<double>& p, double sr, double f0, double f1) {
    const double bin = sr / (2.0 * (p.size() - 1));
    double s = 0.0;
    for (size_t i = size_t(f0 / bin); i < p.size() && i * bin < f1; ++i) s += p[i];
    return 10.0 * std::log10(std::max(s, 1e-30));
}
static double centroid(const std::vector<double>& p, double sr) {
    const double bin = sr / (2.0 * (p.size() - 1));
    double n = 0.0, d = 0.0;
    for (size_t i = 2; i < p.size(); ++i) { n += p[i] * i * bin; d += p[i]; }
    return d > 0 ? n / d : 0.0;
}

// Mayor |paso| relativo al RMS local (+-256 muestras) fuera de las ventanas de ataque: detecta discontinuidades
static double clickRatio(const Out& o, const std::vector<char>& nearHit) {
    const size_t N = o.l.size();
    std::vector<double> cs(N + 1, 0.0);   // suma acumulada de x^2
    for (size_t i = 0; i < N; ++i) cs[i + 1] = cs[i] + double(o.l[i]) * o.l[i];
    double worst = 0.0;
    for (size_t i = 1; i < N; ++i) {
        if (nearHit[i]) continue;
        const size_t a = i > 256 ? i - 256 : 0, b = std::min(N, i + 256);
        const double rms = std::sqrt((cs[b] - cs[a]) / double(b - a));
        const double d = std::fabs(double(o.l[i]) - o.l[i - 1]);
        worst = std::max(worst, d / (rms + 2.0e-4));
    }
    return worst;
}

static void writeWav24(const char* path, const Out& o, int sr) {
    FILE* f = std::fopen(path, "wb");
    if (!f) { std::printf("  no se pudo escribir %s\n", path); ++g_fail; return; }
    const uint32_t n = static_cast<uint32_t>(o.l.size()), dataBytes = n * 6, riff = 36 + dataBytes;
    auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); w32(riff); std::fwrite("WAVEfmt ", 1, 8, f);
    w32(16); w16(1); w16(2); w32(uint32_t(sr)); w32(uint32_t(sr) * 6); w16(6); w16(24);
    std::fwrite("data", 1, 4, f); w32(dataBytes);
    for (uint32_t i = 0; i < n; ++i) {
        for (int c = 0; c < 2; ++c) {
            const double x = std::max(-1.0, std::min(1.0, double(c ? o.r[i] : o.l[i])));
            const int32_t v = static_cast<int32_t>(std::lround(x * 8388607.0));
            const uint8_t b[3] = { uint8_t(v & 0xFF), uint8_t((v >> 8) & 0xFF), uint8_t((v >> 16) & 0xFF) };
            std::fwrite(b, 1, 3, f);
        }
    }
    std::fclose(f);
}

// ---------------------------------------------------------------------------------
static const struct { int note; const char* name; } kMap[] = {
    { 36, "bombo 36" }, { 35, "bombo 35" }, { 38, "caja 38" }, { 40, "rimshot 40" }, { 37, "cross-stick 37" },
    { 41, "tom 41" }, { 43, "tom 43" }, { 45, "tom 45" }, { 47, "tom 47" }, { 48, "tom 48" }, { 50, "tom 50" },
    { 42, "hat cerrado 42" }, { 44, "hat pedal 44" }, { 46, "hat abierto 46" }, { 51, "ride 51" }, { 59, "ride2 59" },
    { 53, "campana 53" }, { 49, "crash 49" }, { 57, "crash 57" }, { 55, "splash 55" }, { 52, "china 52" },
};

// ---------------------------------------------------------------------------------
//  Modo --samples: banco worship-drums.jws (MuldjordKit). Requiere el banco en %APPDATA%\JasWave\samples.
// ---------------------------------------------------------------------------------
static double peakHz(const Out& o, int64_t a, double f0, double f1, double sr) {
    const auto sp = powerSpectrum(o, a);
    const double bin = sr / (2.0 * (sp.size() - 1));
    size_t best = size_t(f0 / bin);
    for (size_t i = size_t(f0 / bin); i < sp.size() && i * bin < f1; ++i) if (sp[i] > sp[best]) best = i;
    return best * bin;
}


// ---- ayudas v2 (bateria acustica multimicrofono) ----
static const JwSampler::Zone* findZone(const JwSampler::Bank& b, int note, int vel, int rr) {
    for (const auto& z : b.zones) if (note >= z.lokey && note <= z.hikey && vel >= z.lovel && vel <= z.hivel && z.rrIndex == rr) return &z;
    return nullptr;
}
// mezcla mono (L+R)/2 de una zona del banco, en float [-1,1)
static std::vector<float> zoneMono(const JwSampler::Bank& b, const JwSampler::Zone& z) {
    std::vector<float> m(z.frames);
    const int16_t* d = b.data(z);
    for (uint32_t i = 0; i < z.frames; ++i) m[i] = z.channels == 2 ? 0.5f * (d[2 * i] + d[2 * i + 1]) / 32768.f : d[i] / 32768.f;
    return m;
}
// pico (Hz) y centroide de un tramo de una senal mono (FFT 2^16 con Hann, desde la muestra `a`, `len` muestras)
static void spectrumOf(const std::vector<float>& x, double sr, int64_t a, int64_t len, double f0, double f1, double& peak, double& cen) {
    const int L = 16, N = 1 << L;
    FFT fft(L);
    std::vector<float> re(N, 0.0f), im(N, 0.0f);
    for (int64_t i = 0; i < len && i < N; ++i) {
        const int64_t k = a + i;
        if (k >= 0 && k < int64_t(x.size())) re[size_t(i)] = x[size_t(k)] * float(0.5 - 0.5 * std::cos(2.0 * kPi * double(i) / double(len)));
    }
    fft.forward(re.data(), im.data());
    const double bin = sr / N;
    double best = -1.0, num = 0.0, den = 0.0; peak = 0.0;
    for (size_t i = size_t(f0 / bin); i < size_t(f1 / bin) && i < size_t(N / 2); ++i) {
        const double p = double(re[i]) * re[i] + double(im[i]) * im[i];
        if (p > best) { best = p; peak = double(i) * bin; }
        num += p * double(i) * bin; den += p;
    }
    cen = den > 0 ? num / den : 0.0;
}
// nivel del centro (dB), del lado (sideDb) y correlacion L/R en [a, b)
static double midSideDb(const Out& o, int64_t a, int64_t b, double* sideDb, double* corr) {
    double m2 = 0, s2 = 0, ll = 0, rr = 0, lr = 0;
    a = std::max<int64_t>(a, 0); b = std::min<int64_t>(b, int64_t(o.l.size()));
    for (int64_t i = a; i < b; ++i) {
        const double l = o.l[size_t(i)], r = o.r[size_t(i)], m = 0.5 * (l + r), sd = 0.5 * (l - r);
        m2 += m * m; s2 += sd * sd; ll += l * l; rr += r * r; lr += l * r;
    }
    const double n = double(std::max<int64_t>(1, b - a));
    if (sideDb) *sideDb = 10.0 * std::log10(std::max(s2 / n, 1e-18));
    if (corr) *corr = lr / std::sqrt(std::max(ll * rr, 1e-30));
    return 10.0 * std::log10(std::max(m2 / n, 1e-18));
}

// ---- v3: cuerpo y pegada de caja y toms ----
// energia (dB) de la mezcla mono en [a, a+len) entre f0 y f1 (ventana de Hann, FFT 2^16)
static double segBandDb(const Out& o, int64_t a, int64_t len, double sr, double f0, double f1) {
    const int L = 16, N = 1 << L;
    FFT fft(L);
    std::vector<float> re(N, 0.0f), im(N, 0.0f);
    for (int64_t i = 0; i < len && i < N; ++i) {
        const int64_t k = a + i;
        if (k >= 0 && k < int64_t(o.l.size())) re[size_t(i)] = 0.5f * (o.l[size_t(k)] + o.r[size_t(k)]) * float(0.5 - 0.5 * std::cos(2.0 * kPi * double(i) / double(len)));
    }
    fft.forward(re.data(), im.data());
    const double bin = sr / N;
    double s = 0.0;
    for (size_t i = size_t(f0 / bin); i < size_t(f1 / bin) && i < size_t(N / 2); ++i) s += double(re[i]) * re[i] + double(im[i]) * im[i];
    return 10.0 * std::log10(std::max(s, 1e-30));
}
struct ShellM { double pk, r80, r300, e100_250, e80_300, h125, h160, pres, fund; };
// metricas de un golpe aislado (sin sala): pico, RMS 80/300 ms, energia 100-250 y 80-300 Hz (0-300 ms), "huecos" de 125 y 160 Hz respecto al pico de la
// fundamental (tercios de octava, primeros 60 ms), presencia = media de los tercios de 2,5/3,15/4 kHz (dB absolutos) y energia de la banda de la fundamental
static ShellM shellMetrics(double sr, int note, double vel, const DrumSettings& st, double fundHz) {
    Out o = renderEvents(sr, int64_t(1.2 * sr), { { 4800, note, float(vel) } }, 512, &st);
    ShellM m{};
    m.pk = db(peakOf(o));
    m.r80 = db(rmsRange(o, 4800, 4800 + int64_t(0.08 * sr)));
    m.r300 = db(rmsRange(o, 4800, 4800 + int64_t(0.3 * sr)));
    const int64_t a = 4800, w60 = int64_t(0.06 * sr), w300 = int64_t(0.3 * sr);
    auto tb = [&](double c) { return segBandDb(o, a, w60, sr, c / 1.1225, c * 1.1225); };
    double pkb = -1e9;
    for (double c : { 160.0, 200.0, 250.0, 315.0 }) pkb = std::max(pkb, tb(c));
    m.h125 = tb(125.0) - pkb;
    m.h160 = tb(160.0) - pkb;
    m.pres = (tb(2500.0) + tb(3150.0) + tb(4000.0)) / 3.0;
    m.e100_250 = segBandDb(o, a, w300, sr, 100, 250);
    m.e80_300 = segBandDb(o, a, w300, sr, 80, 300);
    m.fund = fundHz > 0.0 ? segBandDb(o, a, int64_t(0.4 * sr), sr, 0.75 * fundHz, 1.35 * fundHz) : 0.0;
    return m;
}

// ---- FX Rack comun: motor listo (prepare + ajustes + espera del banco si g_samples) y hash FNV-1a de un render determinista ----
static std::unique_ptr<WorshipDrumsEngine> makeDrumEngine(double sr, const DrumSettings& st = DrumSettings{}) {
    std::unique_ptr<WorshipDrumsEngine> e(new WorshipDrumsEngine());
    e->prepare(sr, 512);
    e->setSettings(st);
    e->prepare(sr, 512);   // igual que renderEvents: los suavizadores parten de los valores objetivo
    if (g_samples) for (int i = 0; i < 3000 && !e->samplerReady(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    return e;
}
// Frase determinista (bombo, caja con ghost y rimshot, hi-hat cerrado/abierto/pedal, toms, crash, ride, campana; 6 s + cola de 3 s)
static uint64_t hashRenderBateria(WorshipDrumsEngine& e, int blk = 256, double sr = 48000.0) {
    std::vector<Ev> evs;
    auto at = [&](double t, int note, float v) { evs.push_back({ int64_t(t * sr), note, v }); };
    at(0.00, 36, 0.95f); at(0.00, 49, 0.9f); at(0.00, 42, 0.7f);
    at(0.25, 42, 0.5f);  at(0.50, 38, 0.9f); at(0.50, 42, 0.6f); at(0.75, 42, 0.45f);
    at(1.00, 36, 0.85f); at(1.12, 36, 0.6f); at(1.25, 42, 0.5f); at(1.50, 38, 0.2f); at(1.50, 46, 0.8f);
    at(1.75, 44, 0.6f);  at(2.00, 36, 0.9f); at(2.00, 51, 0.8f); at(2.25, 40, 0.95f); at(2.50, 38, 0.7f);
    at(2.75, 41, 0.9f);  at(2.85, 43, 0.85f); at(2.95, 45, 0.8f); at(3.05, 47, 0.8f); at(3.15, 48, 0.85f); at(3.25, 50, 0.9f);
    at(3.50, 37, 0.7f);  at(3.75, 53, 0.6f);  at(4.00, 36, 1.0f); at(4.00, 57, 1.0f); at(4.50, 38, 1.0f); at(5.00, 55, 0.8f); at(5.50, 52, 0.9f);
    const int64_t total = int64_t(9.0 * sr);
    Out o = renderEvents(sr, total, evs, blk, nullptr, nullptr, &e);
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < o.l.size(); ++i) {
        uint32_t a, b; std::memcpy(&a, &o.l[i], 4); std::memcpy(&b, &o.r[i], 4);
        h = (h ^ a) * 1099511628211ull; h = (h ^ b) * 1099511628211ull;
    }
    return h;
}

static void fftCplx(std::vector<std::complex<double>>& a) {
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
            std::complex<double> w(1.0, 0.0);
            for (size_t k = 0; k < len / 2; ++k) {
                const auto u = a[i + k], v = a[i + k + len / 2] * w;
                a[i + k] = u + v;
                a[i + k + len / 2] = u - v;
                w *= wl;
            }
        }
    }
}

// ------------------------------------------------------------------ 7. FX Rack comun (jw_fxrack.h): utilidades
#define CHECK(cond, ...) do { if (!(cond)) { ++g_fail; std::printf("  [FALLO] "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)
static double cpuSeconds() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }   // reloj de pared (minimo de varias pasadas)
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
struct Xor {   // generador xorshift32 determinista para ruido de prueba
    uint32_t s{0x2545F491u};
    void seed(uint32_t v) { s = v ? v : 0x9E3779B9u; for (int i = 0; i < 4; ++i) u32(); }
    uint32_t u32() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    double uni() { return u32() * (1.0 / 4294967296.0); }
    double bi() { return uni() * 2.0 - 1.0; }
};

static void testFxRack(bool conSamples) {
    using namespace JasWaveFx;
    std::printf("[7] FX Rack comun%s (jw_fxrack.h, ids %u..%u)\n", conSamples ? " (con banco de muestras: neutralidad y motor)" : "", kBase, kBase + kUltimoOffset);
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
        int propios = 0; bool sinColision = true;
        for (const auto& d : defs) if (d.id < kBase) { ++propios; if (d.id != static_cast<uint32_t>(propios - 1)) sinColision = false; }
        std::printf("    parametros propios de la bateria: %d (ids 0..%d contiguos, sin colision con >= %u)\n", propios, propios - 1, kBase);
        CHECK(propios == 23 && sinColision, "los 20 parametros propios de la bateria cambiaron (%d)", propios);
    }

    // ---- 7.1 neutralidad bit a bit en el motor (rack apagado == salida previa del plugin) ----
    {
        // hashes de referencia tomados ANTES de integrar el rack (hashRenderBateria: frase con legato, fantasma y doble cuerda)
        const uint64_t golden = conSamples ? 0x898f5c6c2fbdcdf0ull : 0xc8011f741d59782cull;
        DrumSettings s;
        auto e0 = makeDrumEngine(SR, s);
        CHECK(e0->samplerReady() == conSamples, "estado del banco de muestras inesperado (%d)", e0->samplerReady() ? 1 : 0);
        const uint64_t h0 = hashRenderBateria(*e0);
        // con valores de rack ajustados pero TODOS los bloques apagados
        auto e1 = makeDrumEngine(SR, s);
        FxParams p = porDefecto();
        for (int b = 0; b < kBands; ++b) { p.eq[b].gainDb = 12.0; p.eq[b].hz *= 1.3; }
        p.compThreshDb = -50; p.compRatio = 20; p.satDrive = 1.0; p.dlTimeMs = 100; p.rvMix = 1.0; p.outWidth = 2.0; p.outGainDb = 12.0;
        e1->setFx(p); e1->setTempo(100.0);
        const uint64_t h1 = hashRenderBateria(*e1, 77);   // otro tamano de bloque: tambien identico al hash de 256? (se compara con su propia referencia abajo)
        auto e1b = makeDrumEngine(SR, s);
        e1b->setFx(p);
        const uint64_t h1b = hashRenderBateria(*e1b);
        std::printf("    hash sin rack=0x%016llx, rack apagado con valores extremos=0x%016llx (referencia 0x%016llx)\n",
                    static_cast<unsigned long long>(h0), static_cast<unsigned long long>(h1b), static_cast<unsigned long long>(golden));
        CHECK(h0 == golden, "el rack apagado cambia el sonido por defecto del plugin");
        CHECK(h1b == golden, "el rack con bloques apagados cambia el sonido");
        (void)h1;
        // y encendido SI cambia
        auto e2 = makeDrumEngine(SR, s);
        FxParams q = porDefecto(); q.eqOn = true; q.eq[2].gainDb = 9.0; q.dlOn = true; q.rvOn = true; q.compOn = true; q.satOn = true; q.chOn = true; q.outOn = true;
        e2->setFx(q);
        CHECK(hashRenderBateria(*e2) != golden, "el rack encendido no cambia nada");
    }

    // ---- 7.11 motor: con todo encendido sigue siendo finito y acotado; el GR del compresor del rack llega al bus ----
    {
        auto e = makeDrumEngine(SR, DrumSettings{});
        FxParams q = porDefecto(); q.hpfOn = q.eqOn = q.compOn = q.satOn = q.chOn = q.dlOn = q.rvOn = q.outOn = true;
        q.eq[1].gainDb = 8.0; q.outGainDb = -6.0; q.compThreshDb = -40.0; q.compRatio = 8.0;
        e->setFx(q);
        DrumBus bus;
        const size_t N = static_cast<size_t>(6 * SR);
        std::vector<float> L(512), R(512);
        e->noteOn(36, 0.95f); e->noteOn(38, 0.9f); e->noteOn(49, 0.9f);
        bool fin = true; double pk = 0.0; float grMax = 0.0f;
        for (size_t i = 0; i < N; i += 512) {
            e->render(L.data(), R.data(), 512, &bus);
            for (int k = 0; k < 512; ++k) { if (!std::isfinite(L[static_cast<size_t>(k)]) || !std::isfinite(R[static_cast<size_t>(k)])) fin = false; pk = std::max(pk, static_cast<double>(std::fabs(L[static_cast<size_t>(k)]))); }
            grMax = std::max(grMax, bus.fxGrDb.load());
        }
        std::printf("    motor con rack completo: finito=%d, pico=%.3f, GR maximo publicado en el bus = %.2f dB\n", fin ? 1 : 0, pk, static_cast<double>(grMax));
        CHECK(fin && pk <= 1.0, "motor + rack no finito o desbordado (pico %.3f)", pk);
        CHECK(grMax > 0.1f, "el compresor del rack no publica GR en el bus");
    }
    if (conSamples) return;

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
            fftCplx(z);
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
}

static int sampledTest(const char* wavPath) {
    g_samples = true;
    const double SR = 48000.0;
    ScopedNoDenormals nd;
    std::printf("== JasWave Worship Drums - prueba del banco de muestras (MuldjordKit, CC BY 4.0) ==\n");
    const std::string dir = JwSampler::samplesDir();
    std::string envOrig; { const char* e0 = std::getenv("JASWAVE_SAMPLES_DIR"); if (e0) envOrig = e0; }
    const std::string path = dir + "\\worship-drums.jws";
    std::string err;
    static std::shared_ptr<JwSampler::Bank> keep = JwSampler::acquireBank(path, err);   // mantiene el banco en la cache entre motores
    check(keep != nullptr, "banco worship-drums.jws carga", err);
    if (!keep) return 1;
    {
        FILE* f = std::fopen(path.c_str(), "rb"); std::fseek(f, 0, SEEK_END); const double mb = std::ftell(f) / 1e6; std::fclose(f);
        std::printf("  banco: %zu zonas, %.1f MB\n", keep->zones.size(), mb);
        check(mb <= 320.0, "banco <= 320 MB", fmt("%.1f MB", mb));
    }
    {
        WorshipDrumsEngine* e = new WorshipDrumsEngine(); e->prepare(SR, 512);
        for (int i = 0; i < 3000 && !e->samplerReady(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
        check(e->samplerReady(), "el motor carga el banco en su hilo");
        std::printf("  notas con muestras:");
        for (const auto& m : kMap) { if (e->noteIsSampled(m.note)) std::printf(" %d", m.note); }
        std::printf("\n  notas modeladas (sin zona):");
        for (const auto& m : kMap) { if (!e->noteIsSampled(m.note)) std::printf(" %d", m.note); }
        std::printf("\n");
        check(!e->noteIsSampled(37), "cross-stick 37 sigue modelado (el kit no trae aro)");
        for (int n : { 35, 36, 38, 40, 41, 43, 45, 47, 48, 50, 42, 44, 46, 49, 57, 55, 52, 51, 59, 53 })
            check(e->noteIsSampled(n), fmt("nota %.0f con muestras", n).c_str());
        delete e;
    }

    std::printf("== S1. Nivel por pieza (vel 0.9, sin sala; pico real, RMS 0.5 s, energia por banda) ==\n");
    std::printf("  %-16s %7s %8s | %6s %6s %6s %6s dB | centroide\n", "elemento", "pico", "rms dB", "<200", "200-2k", "2k-8k", ">8k");
    for (const auto& m : kMap) {
        DrumSettings s1; s1.volumeDb = -24.0; s1.roomBlend = 0.0;
        Out o = renderEvents(SR, int64_t(8.0 * SR), { { 100, m.note, 0.9f } }, 256, &s1);
        for (auto& x : o.l) x *= 15.84893f;
        for (auto& x : o.r) x *= 15.84893f;
        const double pk = peakOf(o), rms = rmsRange(o, 100, 100 + int64_t(0.5 * SR));
        const auto sp = powerSpectrum(o, 100);
        std::printf("  %-16s %7.3f %8.1f | %6.1f %6.1f %6.1f %6.1f    | %6.0f Hz\n", m.name, pk, db(rms),
                    bandDb(sp, SR, 20, 200), bandDb(sp, SR, 200, 2000), bandDb(sp, SR, 2000, 8000), bandDb(sp, SR, 8000, 20000), centroid(sp, SR));
        check(finiteAll(o) && pk > 0.05 && pk < 0.99, m.name, fmt("pico=%.3f (%.1f dBFS)", pk, db(pk)));
    }

    std::printf("== S2. Dinamica y timbre por velocidad (vel 0.15 vs 1.0) ==\n");
    for (int note : { 36, 38, 41, 42, 46, 49, 51 }) {
        DrumSettings s1; s1.roomBlend = 0.0;
        Out lo = renderEvents(SR, int64_t(3 * SR), { { 100, note, 0.15f } }, 512, &s1);
        Out hi = renderEvents(SR, int64_t(3 * SR), { { 100, note, 1.0f } }, 512, &s1);
        const double dl = db(rmsRange(hi, 100, 100 + 24000)) - db(rmsRange(lo, 100, 100 + 24000));
        const auto spl = powerSpectrum(lo, 100), sph = powerSpectrum(hi, 100);
        std::printf("  nota %d: rms 0.5 s vel1.0 - vel0.15 = %+.1f dB | centroide %.0f -> %.0f Hz\n", note, dl, centroid(spl, SR), centroid(sph, SR));
        check(dl > 10.0, fmt("rango dinamico > 10 dB (nota %.0f)", note).c_str(), fmt("%.1f dB", dl));
    }

    std::printf("== S3. Round-robin: 8 golpes iguales deben diferir ==\n");
    for (int note : { 36, 38, 42, 46, 41, 49, 51 }) {
        std::vector<Ev> evs;
        for (int i = 0; i < 8; ++i) evs.push_back({ 100 + int64_t(i) * int64_t(2.0 * SR), note, 0.8f });
        DrumSettings s1; s1.roomBlend = 0.0;
        Out o = renderEvents(SR, int64_t(8 * 2.0 * SR), evs, 512, &s1);
        // con N variaciones el golpe i+N repite muestra: entre consecutivos exige variacion de muestra; entre cualquier par, la humanizacion
        auto dif = [&](int i, int j) {
            double num = 0, den = 0;
            for (int64_t k = 0; k < int64_t(0.4 * SR); ++k) {
                const double a = o.l[size_t(100 + int64_t(i) * int64_t(2.0 * SR) + k)], b = o.l[size_t(100 + int64_t(j) * int64_t(2.0 * SR) + k)];
                num += (a - b) * (a - b); den += a * a;
            }
            return std::sqrt(num / std::max(den, 1e-12));
        };
        double minCons = 1e9, minAny = 1e9;
        for (int i = 0; i < 8; ++i) for (int j = i + 1; j < 8; ++j) { const double d = dif(i, j); minAny = std::min(minAny, d); if (j == i + 1) minCons = std::min(minCons, d); }
        std::printf("  nota %d: dif relativa consecutivos min %.2f, cualquier par min %.2f\n", note, minCons, minAny);
        check(minCons > 0.05 && minAny > 0.02, fmt("golpes distintos (nota %.0f)", note).c_str());
    }
    {   // dos golpes consecutivos iguales de la caja no son identicos
        Out o = renderEvents(SR, int64_t(3 * SR), { { 100, 38, 0.8f }, { 100 + int64_t(1.0 * SR), 38, 0.8f } }, 256);
        double num = 0, den = 0;
        for (int64_t k = 0; k < 12000; ++k) { const double a = o.l[size_t(100 + k)], b = o.l[size_t(100 + int64_t(SR) + k)]; num += (a - b) * (a - b); den += a * a; }
        check(std::sqrt(num / den) > 0.1, "dos golpes de caja iguales no son identicos", fmt("%.2f", std::sqrt(num / den)));
    }

    std::printf("== S4. Choke del hi-hat (cerrado/pedal cortan el abierto) ==\n");
    {
        const int64_t total = int64_t(3.0 * SR), hit = 100 + int64_t(0.25 * SR);
        DrumSettings s1; s1.roomBlend = 0.0;
        Out open = renderEvents(SR, total, { { 100, 46, 0.9f } }, 256, &s1);
        const int64_t w0 = hit + int64_t(0.15 * SR), w1 = hit + int64_t(0.30 * SR);
        const double tailOpen = rmsRange(open, w0, w1);
        for (int ch : { 42, 44 }) {
            Out c = renderEvents(SR, total, { { 100, 46, 0.9f }, { hit, ch, 0.7f } }, 256, &s1);
            Out only = renderEvents(SR, total, { { hit, ch, 0.7f } }, 256, &s1);
            const double tailC = rmsRange(c, w0, w1), tailRef = rmsRange(only, w0, w1);
            std::printf("  abierto + %d: cola = %.1f dB (abierto libre %.1f dB, solo %d %.1f dB)\n", ch, db(tailC), db(tailOpen), ch, db(tailRef));
            check(db(tailC) < db(tailOpen) - 12.0 && db(tailC) < db(tailRef) + 6.0, ch == 42 ? "cerrado corta el abierto" : "pedal corta el abierto");
        }
        Out sn = renderEvents(SR, total, { { 100, 46, 0.9f }, { hit, 38, 0.7f } }, 256, &s1);
        const double w2a = hit + int64_t(0.05 * SR), w2b = hit + int64_t(0.15 * SR);
        check(db(rmsRange(sn, int64_t(w2a), int64_t(w2b))) > db(rmsRange(open, int64_t(w2a), int64_t(w2b))) - 3.0, "la caja no corta el hi-hat abierto");
        // sin clic en el choke
        auto maxStep = [&](const Out& o, int64_t a, int64_t b) { double m = 0; for (int64_t i = a + 1; i < b; ++i) m = std::max(m, double(std::fabs(o.l[size_t(i)] - o.l[size_t(i - 1)]))); return m; };
        Out ck = renderEvents(SR, total, { { 100, 46, 0.9f }, { hit, 44, 0.01f } }, 256, &s1);
        const double before = maxStep(ck, hit - 240, hit), after = maxStep(ck, hit + 3, hit + 480);
        std::printf("  clic de choke: paso max antes %.5f / despues %.5f\n", before, after);
        check(after <= before * 1.5 + 1e-3, "choke sin clic");
    }

    std::printf("== S5. Colas: terminan en silencio y sin voces colgadas ==\n");
    for (const auto& m : kMap) {
        std::unique_ptr<WorshipDrumsEngine> ep(new WorshipDrumsEngine());
        ep->prepare(SR, 512); ep->setSettings(DrumSettings{}); ep->prepare(SR, 512);
        for (int i = 0; i < 3000 && !ep->samplerReady(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
        Out o; const int64_t total = int64_t(16 * SR); o.l.assign(size_t(total), 0.f); o.r.assign(size_t(total), 0.f);
        ep->noteOn(m.note, 1.0f);
        for (int64_t p = 0; p < total; p += 512) ep->render(o.l.data() + p, o.r.data() + p, int(std::min<int64_t>(512, total - p)), nullptr);
        double cola = 0; for (int64_t i = total - 4800; i < total; ++i) cola = std::max({ cola, double(std::fabs(o.l[size_t(i)])), double(std::fabs(o.r[size_t(i)])) });
        check(cola < 1e-4 && ep->activeVoices() == 0, fmt("cola en silencio (nota %.0f)", m.note).c_str(), fmt("%.1f dBFS", db(cola)) + " voces=" + std::to_string(ep->activeVoices()));
    }

    std::printf("== S6. Afinacion por pieza: toms descendentes 50>48>47>45>43>41; bombo 35 < 36 ==\n");
    {
        DrumSettings s1; s1.roomBlend = 0.0;
        double prev = 1e9; const int toms[6] = { 50, 48, 47, 45, 43, 41 };
        for (int n : toms) {
            Out o = renderEvents(SR, int64_t(2 * SR), { { 100, n, 0.8f } }, 512, &s1);
            const double f = peakHz(o, 100 + int64_t(0.04 * SR), 50, 400, SR);
            std::printf("  tom %d: %.1f Hz\n", n, f);
            check(f < prev + 1.0, fmt("tom %.0f mas grave que el anterior", n).c_str(), fmt("%.1f Hz", f));
            prev = f;
        }
        // el pico de un bombo es ancho y cambia con cada variacion: se promedia el reparto de energia (30-60 Hz frente a 60-130 Hz)
        // sobre 4 golpes (un ciclo completo de round-robin), velocidades 0.6..0.95
        double r36 = 0, r35 = 0;
        for (int n : { 36, 35 }) {
            double acc = 0;
            for (int h = 0; h < 8; ++h) {
                const float v = 0.6f + 0.05f * float(h);
                Out o = renderEvents(SR, int64_t(1.2 * SR), { { 100, n, v } }, 512, &s1);
                const auto sp = powerSpectrum(o, 100 + int64_t(0.03 * SR));
                acc += (bandDb(sp, SR, 30, 60) - bandDb(sp, SR, 60, 130)) / 8.0;
            }
            (n == 36 ? r36 : r35) = acc;
        }
        std::printf("  bombo 36: 30-60/60-130 Hz = %+.1f dB | bombo 35: %+.1f dB (el 35 es el bombo grave)\n", r36, r35);
        check(r35 > r36 + 1.0, "bombo 35 mas grave que 36 (mas energia 30-60 Hz relativa, promedio)");
    }

    std::printf("== S7. Parametros actuan sobre las muestras ==\n");
    {   // kick_tune
        double f[3]; int j = 0;
        for (double tune : { 40.0, 55.0, 80.0 }) {
            DrumSettings s; s.kickTuneHz = tune; s.roomBlend = 0.0;
            Out o = renderEvents(SR, int64_t(1.5 * SR), { { 100, 36, 0.8f } }, 512, &s);
            f[j++] = peakHz(o, 100 + int64_t(0.03 * SR), 25, 250, SR);
        }
        std::printf("  kick_tune 40/55/80 Hz -> pico %.1f / %.1f / %.1f Hz\n", f[0], f[1], f[2]);
        check(f[0] < f[1] && f[1] < f[2] && f[2] / f[0] > 1.5, "kick_tune sube la afinacion de forma monotona");
    }
    {   // snare_snap
        double e[2]; int j = 0;
        for (double snap : { 0.0, 1.0 }) {
            DrumSettings s; s.snareSnap = snap; s.roomBlend = 0.0; s.air = 0.0;
            Out o = renderEvents(SR, int64_t(1.5 * SR), { { 100, 38, 0.9f } }, 512, &s);
            e[j++] = bandDb(powerSpectrum(o, 100), SR, 3500, 16000);
        }
        std::printf("  snare_snap 0 / 100 %%: energia >3.5 kHz %.1f / %.1f dB (delta %+.1f)\n", e[0], e[1], e[1] - e[0]);
        check(e[1] - e[0] > 4.0, "snare_snap abre los agudos de la caja (> +4 dB)");
    }
    {   // toms_damp
        double t[2]; int j = 0;
        for (double d : { 0.0, 1.0 }) {
            DrumSettings s; s.tomsDamp = d; s.roomBlend = 0.0;
            Out o = renderEvents(SR, int64_t(4 * SR), { { 100, 45, 0.9f } }, 512, &s);
            t[j++] = db(rmsRange(o, 100 + int64_t(0.8 * SR), 100 + int64_t(1.3 * SR)));
        }
        std::printf("  toms_damp 0 / 100 %%: nivel 0.8-1.3 s %.1f / %.1f dB (delta %+.1f)\n", t[0], t[1], t[1] - t[0]);
        check(t[0] - t[1] > 10.0, "toms_damp acorta la cola del tom (> 10 dB)");
    }
    {   // overhead_air
        double a[2]; int j = 0;
        for (double air : { 0.0, 1.0 }) {
            DrumSettings s; s.air = air; s.roomBlend = 0.0;
            Out o = renderEvents(SR, int64_t(3 * SR), { { 100, 49, 0.9f } }, 512, &s);
            a[j++] = bandDb(powerSpectrum(o, 100), SR, 8000, 20000);
        }
        std::printf("  overhead_air 0 / 100 %%: energia >8 kHz del crash %.1f / %.1f dB (delta %+.1f)\n", a[0], a[1], a[1] - a[0]);
        check(a[1] - a[0] > 3.0, "overhead_air abre los platos (> +3 dB)");
    }
    {   // room_blend: cola de sala tras la caja (se compara con el motor modelado: misma relacion sala/directo)
        auto medir = [&](double rb, double* dry) {
            DrumSettings s; s.roomBlend = rb;
            Out o = renderEvents(SR, int64_t(5 * SR), { { 100, 38, 0.9f } }, 512, &s);
            if (dry) *dry = db(rmsRange(o, 100, 100 + int64_t(0.3 * SR)));
            return db(rmsRange(o, 100 + int64_t(1.2 * SR), 100 + int64_t(2.2 * SR)));
        };
        double dryS = 0, dryM = 0;
        const double tailS = medir(1.0, &dryS);
        g_samples = false; _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
        const double tailM = medir(1.0, &dryM);
        _putenv_s("JASWAVE_SAMPLES_DIR", envOrig.c_str()); g_samples = true;   // se restaura la carpeta original (no la de por defecto)
        std::printf("  sala 100 %% (cola 1.2-2.2 s vs directo 0-0.3 s): muestras %.1f dB | modelado %.1f dB\n", tailS - dryS, tailM - dryM);
        check(std::fabs((tailS - dryS) - (tailM - dryM)) < 6.0, "relacion sala/directo de las muestras cercana a la del motor modelado (+-6 dB)");
    }
    {   // room_blend: cola de sala tras la caja
        double r[2]; int j = 0;
        for (double rb : { 0.0, 1.0 }) {
            DrumSettings s; s.roomBlend = rb;
            Out o = renderEvents(SR, int64_t(5 * SR), { { 100, 38, 0.9f } }, 512, &s);
            r[j++] = db(rmsRange(o, 100 + int64_t(1.2 * SR), 100 + int64_t(2.2 * SR)));
        }
        std::printf("  room_blend 0 / 100 %%: nivel 1.2-2.2 s %.1f / %.1f dB (delta %+.1f)\n", r[0], r[1], r[1] - r[0]);
        check(r[1] - r[0] > 3.0, "room_blend anade cola de sala (> +3 dB sobre la cola propia de la muestra)");
    }
    {   // niveles de bus
        double a[2]; int j = 0;
        for (double d : { -12.0, 6.0 }) {
            DrumSettings s; s.shellsDb = d; s.roomBlend = 0.0;
            Out o = renderEvents(SR, int64_t(1.5 * SR), { { 100, 38, 0.4f } }, 512, &s);
            a[j++] = db(rmsRange(o, 100, 100 + 24000));
        }
        check(std::fabs((a[1] - a[0]) - 18.0) < 2.0, "shells_level -12..+6 dB = 18 dB sobre la caja", fmt("%.1f dB", a[1] - a[0]));
    }

    std::printf("== S8. Hibrido: lo que no tiene muestra sigue sonando; fuera del mapa, silencio ==\n");
    {
        Out o = renderEvents(SR, int64_t(2 * SR), { { 100, 37, 0.9f } }, 512);
        check(peakOf(o) > 0.02, "cross-stick 37 (modelado) suena", fmt("pico=%.3f", peakOf(o)));
        int leaks = 0;
        for (int n = 0; n < 128; ++n) {
            if (elementForNote(n) >= 0) continue;
            Out q = renderEvents(SR, 4800, { { 0, n, 1.0f } }, 512);
            if (peakOf(q) != 0.0) ++leaks;
        }
        check(leaks == 0, "notas fuera del mapa GM: silencio exacto");
    }

    std::printf("== S9. Robustez: SR/bloques, polifonia y sin NaN ==\n");
    {
        for (double sr : { 44100.0, 48000.0, 96000.0, 192000.0 }) {
            std::vector<Ev> evs; const int notes[] = { 36, 38, 42, 46, 41, 50, 49, 51, 55, 52, 53, 44 };
            for (int i = 0; i < 12; ++i) evs.push_back({ int64_t(i * 0.09 * sr), notes[i], 0.5f + 0.04f * i });
            bool ok = true; double pk = 0;
            for (int blk : { 1, 64, 480, 4096 }) { Out o = renderEvents(sr, int64_t((sr > 100000.0 ? 1.6 : 3.0) * sr), evs, blk); ok = ok && finiteAll(o) && peakOf(o) < 0.9801; pk = std::max(pk, peakOf(o)); }
            check(ok, fmt("%.0f Hz, bloques 1/64/480/4096", sr).c_str(), fmt("pico=%.3f", pk));
        }
        std::vector<Ev> evs; const int notes[] = { 49, 57, 51, 59, 55, 52, 46, 41, 43, 45, 47, 48, 50, 38, 36, 53 };
        for (int i = 0; i < 200; ++i) evs.push_back({ 1000 + int64_t(i) * 48, notes[i % 16], 0.9f });
        Out o = renderEvents(SR, int64_t(5 * SR), evs, 512);
        check(finiteAll(o) && peakOf(o) < 0.9801, "200 golpes en 200 ms: sin NaN y pico < 0.98", fmt("pico=%.3f", peakOf(o)));
    }

    std::printf("== S10. Groove de worship (4 compases, 70 BPM, con fills) -> %s ==\n", wavPath);
    {
        const double bpm = 70.0, beat = 60.0 / bpm, step = beat / 4.0;
        Rng r; r.seed(777);
        std::vector<Ev> evs;
        auto add = [&](int bar, double stepIdx, int note, double vel) {
            const double t = (bar * 16 + stepIdx) * step + r.bi() * 0.003;
            const double v = std::min(1.0, std::max(0.05, vel + r.bi() * 0.06));
            evs.push_back({ int64_t(std::max(0.0, t) * SR) + 480, note, float(v) });
        };
        for (int bar = 0; bar < 4; ++bar) {
            if (bar == 0 || bar == 2) add(bar, 0, 49, 0.95);
            add(bar, 0, 36, 0.92); add(bar, 6, 36, 0.62); add(bar, 8, 36, 0.85);
            if (bar % 2 == 1) add(bar, 14, 36, 0.7);
            add(bar, 4, 38, 0.86); add(bar, 12, 38, 0.9);
            add(bar, 7, 38, 0.2); add(bar, 10, 38, 0.24); add(bar, 15, 38, 0.2);
            if (bar < 2) {
                for (int s = 0; s < 16; s += 2) {
                    if (s == 14) add(bar, s, 46, 0.75);
                    else add(bar, s, 42, (s % 4 == 0) ? 0.72 : 0.5);
                }
                if (bar == 1) add(bar, 15.5, 44, 0.5);
            } else {
                for (int s = 0; s < 16; s += 2) add(bar, s, 51, (s % 4 == 0) ? 0.7 : 0.5);
                if (bar == 2) add(bar, 8, 53, 0.7);
            }
            if (bar == 1) { add(bar, 12, 38, 0.8); add(bar, 13, 50, 0.8); add(bar, 14, 48, 0.85); add(bar, 14.5, 47, 0.85); add(bar, 15, 45, 0.9); add(bar, 15.5, 43, 0.95); }
            if (bar == 3) { add(bar, 8, 50, 0.7); add(bar, 9, 48, 0.75); add(bar, 10, 47, 0.8); add(bar, 11, 45, 0.85); add(bar, 12, 43, 0.9); add(bar, 13, 41, 0.95); add(bar, 14, 38, 0.9); add(bar, 14.5, 38, 0.95); add(bar, 15, 36, 1.0); add(bar, 15, 49, 1.0); }
        }
        add(4, 0, 49, 1.0); add(4, 0, 36, 1.0); add(4, 0, 38, 1.0);
        const int64_t total = int64_t((4 * 16 * step + 7.0) * SR) + 480;
        DrumSettings s; s.roomBlend = 0.40;
        DrumBus bus;
        const double t0 = threadCpuSeconds();
        Out o = renderEvents(SR, total, evs, 512, &s, &bus);
        const double secs = double(total) / SR, cpu = (threadCpuSeconds() - t0) / secs * 100.0;
        double dc = 0, sumsq = 0;
        for (size_t i = 0; i < o.l.size(); ++i) { dc += 0.5 * (o.l[i] + o.r[i]); sumsq += 0.5 * (double(o.l[i]) * o.l[i] + double(o.r[i]) * o.r[i]); }
        dc /= double(o.l.size());
        std::vector<char> nearHit(o.l.size(), 0);
        for (const auto& e : evs) for (int64_t k = 0; k < 288; ++k) if (e.at + k < int64_t(o.l.size())) nearHit[size_t(e.at + k)] = 1;
        const double md = clickRatio(o, nearHit);
        std::printf("  duracion %.1f s, %zu golpes, pico %.3f, RMS %.1f dBFS, DC %.2e, paso/RMS %.2f, CPU %.2f %%\n", secs, evs.size(), peakOf(o), db(std::sqrt(sumsq / double(o.l.size()))), dc, md, cpu);
        check(finiteAll(o), "groove sin NaN/inf");
        check(peakOf(o) < 0.9801 && peakOf(o) > 0.3, "pico del groove 0.3..0.98", fmt("%.3f", peakOf(o)));
        check(std::fabs(dc) < 2e-3 * std::sqrt(sumsq / double(o.l.size())), "sin DC", fmt("%.2e", dc));
        check(md < 12.0, "sin clics fuera de los ataques", fmt("%.2f", md));
        check(cpu < 5.0, "CPU del groove < 5 % de un nucleo", fmt("%.2f %%", cpu));
        writeWav24(wavPath, o, 48000);
    }

    // =====================================================================================================
    //  v2: bateria acustica multimicrofono (MuldjordKit estereo)
    // =====================================================================================================
    std::printf("== S11. Banco: carga, tamano, estereo y capas ==\n");
    {
        FILE* f = std::fopen(path.c_str(), "rb"); std::fseek(f, 0, SEEK_END); const double mb = std::ftell(f) / 1e6; std::fclose(f);
        check(mb <= 320.0, "tamano del banco <= 320 MB", fmt("%.1f MB", mb));
        bool allSr = true; for (const auto& z : keep->zones) allSr = allSr && z.sr == 44100;
        check(allSr, "todo el banco a 44,1 kHz");
        for (int n : { 36, 35, 38, 40, 41, 43, 45, 47, 48, 50, 42, 44, 46, 49, 57, 51, 59 }) {
            bool st = true; std::set<int> capas; int rrMax = 0;
            for (const auto& z : keep->zones) if (z.lokey == n) { st = st && z.channels == 2; capas.insert(z.lovel); rrMax = std::max<int>(rrMax, z.rrCount); }
            check(st && capas.size() >= 3 && rrMax >= 2, fmt("nota %.0f en estereo con capas de velocidad y round-robin", n).c_str(),
                  fmt("capas=%.0f rr=%.0f", double(capas.size()), rrMax));
        }
        bool semi = false; for (const auto& z : keep->zones) semi = semi || (z.lokey == kHatSemiNote && z.channels == 2);
        check(semi, "hi-hat semiabierto (nota interna 100) presente");
        // transposicion: bombo/caja sin afinar; toms como maximo +-200 cents
        double maxKS = 0, maxTom = 0;
        for (const auto& z : keep->zones) {
            if (z.lokey == 36 || z.lokey == 35 || z.lokey == 38 || z.lokey == 40) maxKS = std::max<double>(maxKS, std::fabs(z.tuneCents));
            if (z.lokey >= 41 && z.lokey <= 50) maxTom = std::max<double>(maxTom, std::fabs(z.tuneCents));
        }
        check(maxKS == 0.0, "bombo (36/35) y caja sin transposicion en el banco", fmt("%.0f cents", maxKS));
        check(maxTom <= 200.0, "toms con transposicion <= 200 cents", fmt("%.0f cents", maxTom));
    }

    std::printf("== S12. Estereo natural: correlacion L/R y relacion lado/centro (ambiente, sin reverb propia) ==\n");
    for (int note : { 36, 38, 40, 41, 45, 50, 42, 46, 49, 51 }) {
        DrumSettings s1; s1.roomBlend = 0.0; s1.busComp = 0.0; s1.tape = 0.0;
        Out o = renderEvents(44100.0, int64_t(3.0 * 44100.0), { { 100, note, 0.85f } }, 512, &s1);
        double sd = 0, corr = 0;
        const double md = midSideDb(o, 100 + 882, 100 + int64_t(0.6 * 44100.0), &sd, &corr);
        std::printf("  nota %d: correlacion L/R (20-600 ms) %.2f | lado/centro %+.1f dB\n", note, corr, sd - md);
        check(corr < 0.985 && sd - md > -22.0, fmt("nota %.0f en estereo real (no mono)", note).c_str(), fmt("corr=%.2f", corr));
    }

    std::printf("== S13. Niveles de micros: close (centro) / overhead+room (lados) controlables ==\n");
    for (int note : { 36, 38, 45, 49 }) {
        double sd[3], md[3], co[3]; int j = 0;
        for (auto cfg : { std::pair<double, double>{ 0, 0 }, { -12, 0 }, { 0, -12 } }) {
            DrumSettings s1; s1.roomBlend = 0.0; s1.busComp = 0.0; s1.tape = 0.0; s1.closeDb = cfg.first; s1.ambDb = cfg.second;
            Out o = renderEvents(44100.0, int64_t(2.0 * 44100.0), { { 100, note, 0.85f } }, 512, &s1);
            md[j] = midSideDb(o, 100, 100 + 44100, &sd[j], &co[j]); ++j;
        }
        std::printf("  nota %d: centro/lados por defecto %+.1f/%+.1f dB | close -12: %+.1f/%+.1f | ambient -12: %+.1f/%+.1f  (ratio lado-centro por defecto %+.1f dB)\n",
                    note, md[0], sd[0], md[1], sd[1], md[2], sd[2], sd[0] - md[0]);
        check(md[0] - md[1] > 9.0 && md[0] - md[1] < 13.0 && std::fabs(sd[1] - sd[0]) < 1.5, fmt("close_level -12 dB baja el centro (nota %.0f)", note).c_str(), fmt("%.1f dB", md[0] - md[1]));
        check(sd[0] - sd[2] > 9.0 && sd[0] - sd[2] < 13.0 && std::fabs(md[2] - md[0]) < 1.5, fmt("ambient_level -12 dB baja los lados (nota %.0f)", note).c_str(), fmt("%.1f dB", sd[0] - sd[2]));
    }
    {   // sala propia: envio de reverb sobre el ambiente real (room_blend 0 -> 100 %: sube la cola 0,8-2 s)
        DrumSettings a, b; a.roomBlend = 0.0; b.roomBlend = 1.0;
        Out oa = renderEvents(44100.0, int64_t(4.0 * 44100.0), { { 100, 38, 0.9f } }, 512, &a), ob = renderEvents(44100.0, int64_t(4.0 * 44100.0), { { 100, 38, 0.9f } }, 512, &b);
        const double close = db(rmsRange(oa, 100, 100 + 2205)), tailA = db(rmsRange(oa, int64_t(0.8 * 44100.0), int64_t(2.0 * 44100.0))), tailB = db(rmsRange(ob, int64_t(0.8 * 44100.0), int64_t(2.0 * 44100.0)));
        std::printf("  caja: ataque %.1f dB | cola 0,8-2 s: solo micros %.1f dB (%.1f bajo el ataque), con room_blend 100 %% %.1f dB (%.1f bajo el ataque)\n", close, tailA, close - tailA, tailB, close - tailB);
        check(tailB - tailA > 6.0, "room_blend 100 % anade sala sobre el ambiente real de la muestra (> +6 dB en la cola)");
    }

    std::printf("== S14. Afinacion natural: defaults y pico espectral del bombo = el de la muestra ==\n");
    {
        const auto& defs = paramDefs();
        auto def = [&](uint32_t id) { return defs[id].defV; };
        check(def(kKickTune) == kKickRefHz && kKickRefHz >= 60.0 && kKickRefHz <= 90.0, "kick_tune por defecto = fundamental de la muestra (0 cents)", fmt("%.1f Hz", def(kKickTune)));
        check(def(kTape) <= 8.0 && def(kBusComp) <= 20.0 && def(kSmooth) <= 50.0, "tape <= 8 %, compresion paralela <= 20 %, suavizado de platos suave",
              fmt("tape=%.0f comp=%.0f smooth=%.0f", def(kTape), def(kBusComp), def(kSmooth)));
        check(def(kRoomBlend) >= 40.0 && def(kTomsDamp) <= 30.0, "room generoso y toms con cola natural por defecto", fmt("room=%.0f damp=%.0f", def(kRoomBlend), def(kTomsDamp)));
        size_t nPropios = 0; for (const auto& d : defs) if (d.id < JasWaveFx::kBase) ++nPropios;   // ids >= 100: FX Rack comun
        check(nPropios == 23 && defs[kCloseLevel].id == 15 && defs[kAmbLevel].id == 16 && defs[kSmooth].id == 14 && defs[kShellBody].id == 17 && defs[kTomsTune].id == 22, "ids nuevos (15, 16 y 17..22) al final; los anteriores no cambian");
        bool seq = true; for (size_t i = 0; i < nPropios; ++i) seq = seq && defs[i].id == i;
        check(seq, "ids de parametros contiguos 0..22");
        for (int note : { 36, 35 }) {
            const int vel = 108;
            std::vector<double> rawPk, rawCen;
            for (int rr = 0; rr < 4; ++rr) {
                const auto* z = findZone(*keep, note, vel, rr); if (!z) continue;
                double pk, cen; spectrumOf(zoneMono(*keep, *z), 44100.0, int64_t(0.03 * 44100), int64_t(0.17 * 44100), 40, 130, pk, cen);
                double pk2, cen2; spectrumOf(zoneMono(*keep, *z), 44100.0, int64_t(0.03 * 44100), int64_t(0.17 * 44100), 30, 250, pk2, cen2);
                rawPk.push_back(pk); rawCen.push_back(cen2);
            }
            DrumSettings s1; s1.roomBlend = 0.0; s1.busComp = 0.0; s1.tape = 0.0;   // kick_tune = defecto
            Out o = renderEvents(44100.0, int64_t(1.5 * 44100), { { 100, note, float(vel) / 127.0f } }, 512, &s1);
            std::vector<float> mono(o.l.size()); for (size_t i = 0; i < mono.size(); ++i) mono[i] = 0.5f * (o.l[i] + o.r[i]);
            double pk, cen, pk2, cen2;
            spectrumOf(mono, 44100.0, 100 + int64_t(0.03 * 44100), int64_t(0.17 * 44100), 40, 130, pk, cen);
            spectrumOf(mono, 44100.0, 100 + int64_t(0.03 * 44100), int64_t(0.17 * 44100), 30, 250, pk2, cen2);
            double bestD = 1e9, rawC = 0; for (size_t i = 0; i < rawPk.size(); ++i) { if (std::fabs(rawPk[i] - pk) < bestD) bestD = std::fabs(rawPk[i] - pk); rawC += rawCen[i] / double(rawPk.size()); }
            std::printf("  bombo %d: pico muestra (rr0-3) =", note); for (double v : rawPk) std::printf(" %.1f", v);
            std::printf(" Hz | pico renderizado %.1f Hz | centroide 30-250 Hz muestra %.0f / render %.0f Hz\n", pk, rawC, cen2);
            check(bestD <= 3.0, fmt("pico del bombo %.0f = el de la muestra (+-3 Hz, sin transposicion)", note).c_str(), fmt("dif %.1f Hz", bestD));
            check(std::fabs(cen2 / rawC - 1.0) < 0.10, fmt("centroide del bombo %.0f dentro del 10 %% de la muestra", note).c_str(), fmt("%.1f %%", (cen2 / rawC - 1.0) * 100.0));
        }
        // toms sin transponer (48 / 45 / 43): el pico cae donde la muestra
        for (int note : { 48, 45, 43 }) {
            const auto* z = findZone(*keep, note, 100, 0); if (!z) { check(false, "zona de tom"); continue; }
            double rp, rc; spectrumOf(zoneMono(*keep, *z), 44100.0, int64_t(0.05 * 44100), int64_t(0.5 * 44100), 50, 400, rp, rc);
            DrumSettings s1; s1.roomBlend = 0.0; s1.busComp = 0.0; s1.tape = 0.0;
            Out o = renderEvents(44100.0, int64_t(2.0 * 44100.0), { { 100, note, 100.0f / 127.0f } }, 512, &s1);
            std::vector<float> mono(o.l.size()); for (size_t i = 0; i < mono.size(); ++i) mono[i] = 0.5f * (o.l[i] + o.r[i]);
            double pk, cen; spectrumOf(mono, 44100.0, 100 + int64_t(0.05 * 44100), int64_t(0.5 * 44100), 50, 400, pk, cen);
            std::printf("  tom %d: pico muestra %.1f Hz | render %.1f Hz\n", note, rp, pk);
            check(std::fabs(pk / rp - 1.0) < 0.04, fmt("tom %.0f afinacion natural (+-4 %%)", note).c_str(), fmt("%.1f vs %.1f Hz", pk, rp));
        }
    }

    std::printf("== S15. Round-robin del banco: sin repetir muestra consecutiva (sampler sin humanizacion) ==\n");
    for (int note : { 36, 38, 41, 45, 42, 46, 51 }) {
        JwSampler::Sampler sm; sm.prepare(44100.0); JwSampler::Humanize h0; h0.gainDb = 0; h0.detuneCents = 0; h0.timingMs = 0; h0.velCurve = 0; sm.setHumanize(h0); sm.setBank(keep);
        const int NH = 12, W = 6000;
        std::vector<std::vector<float>> hit(NH);
        for (int i = 0; i < NH; ++i) {
            sm.panic(); sm.noteOn(note, 0.8f);
            std::vector<float> l(W, 0.f), r(W, 0.f);
            for (int p = 0; p < W; p += 500) sm.render(l.data() + p, r.data() + p, 500);
            hit[size_t(i)] = l;
        }
        auto rel = [&](int a, int b) { double nn = 0, dd = 0; for (int k = 0; k < W; ++k) { const double x = hit[size_t(a)][size_t(k)], y = hit[size_t(b)][size_t(k)]; nn += (x - y) * (x - y); dd += x * x; } return std::sqrt(nn / std::max(dd, 1e-12)); };
        double minCons = 1e9; for (int i = 0; i + 1 < NH; ++i) minCons = std::min(minCons, rel(i, i + 1));
        std::vector<int> distinct; for (int i = 0; i < NH; ++i) { bool dup = false; for (int j : distinct) if (rel(i, j) < 1e-4) { dup = true; break; } if (!dup) distinct.push_back(i); }
        std::printf("  nota %d: min dif consecutiva %.2f | muestras distintas en 12 golpes: %zu\n", note, minCons, distinct.size());
        check(minCons > 0.05 && distinct.size() >= 3, fmt("round-robin sin repetir seguidas (nota %.0f)", note).c_str(), fmt("%.2f", minCons));
    }

    std::printf("== S16. Redoble de caja: alternancia de manos, sin efecto ametralladora ==\n");
    {
        std::vector<Ev> evs; const double step = 0.07 * 44100.0;
        for (int i = 0; i < 20; ++i) evs.push_back({ 100 + int64_t(i * step), 38, 0.70f });
        DrumSettings s1; s1.roomBlend = 0.0;
        Out o = renderEvents(44100.0, int64_t(3.0 * 44100.0), evs, 512, &s1);
        std::vector<double> pk;
        for (int i = 0; i < 20; ++i) { double p = 0; for (int64_t k = 0; k < 600; ++k) p = std::max(p, double(std::fabs(o.l[size_t(evs[size_t(i)].at + k)]))); pk.push_back(p); }
        double mean = 0; for (double p : pk) mean += p / 20.0; double var = 0; for (double p : pk) var += (p - mean) * (p - mean) / 20.0;
        double minCons = 1e9;
        for (int i = 4; i + 1 < 20; ++i) { double nn = 0, dd = 0; for (int64_t k = 0; k < 1500; ++k) { const double a = o.l[size_t(evs[size_t(i)].at + k)], b = o.l[size_t(evs[size_t(i + 1)].at + k)]; nn += (a - b) * (a - b); dd += a * a; } minCons = std::min(minCons, std::sqrt(nn / dd)); }
        const double sdDb = 20.0 * std::log10((mean + std::sqrt(var)) / std::max(mean - std::sqrt(var), 1e-6));
        std::printf("  20 golpes iguales a 70 ms: variacion de pico (+-1 sigma) %.2f dB, dif consecutiva minima %.2f\n", sdDb, minCons);
        check(sdDb > 0.3 && minCons > 0.1, "el redoble varia en nivel y timbre entre golpes consecutivos");
    }

    std::printf("== S17. Hi-hat: posiciones de pedal por CC4 (cerrado -> semiabierto -> abierto) y choke ==\n");
    {
        double tail[5]; int j = 0;
        for (double foot : { 1.0, 0.75, 0.5, 0.25, 0.0 }) {
            DrumSettings s1; s1.roomBlend = 0.0; s1.hatFoot = foot;
            Out o = renderEvents(SR, int64_t(3.0 * SR), { { 100, 42, 0.7f } }, 256, &s1);
            tail[j] = db(rmsRange(o, 100 + int64_t(0.15 * SR), 100 + int64_t(0.6 * SR)));
            ++j;
        }
        std::printf("  cola 0,15-0,6 s del hat 42 con CC4 = 127/95/64/32/0: %.1f / %.1f / %.1f / %.1f / %.1f dB\n", tail[0], tail[1], tail[2], tail[3], tail[4]);
        check(tail[2] > tail[0] + 6.0 && tail[4] > tail[2] + 3.0 && tail[1] <= tail[2] + 1.0 && tail[3] <= tail[4] + 1.0, "la cola crece de forma monotona al abrir el pedal (cerrado < medio < abierto)");
        DrumSettings s1; s1.roomBlend = 0.0; s1.hatFoot = 0.5;
        Out half = renderEvents(SR, int64_t(3.0 * SR), { { 100, 42, 0.7f } }, 256, &s1);
        Out chk = renderEvents(SR, int64_t(3.0 * SR), { { 100, 42, 0.7f }, { 100 + int64_t(0.1 * SR), 44, 0.4f } }, 256, &s1);
        const double a = db(rmsRange(half, 100 + int64_t(0.3 * SR), 100 + int64_t(0.6 * SR))), b = db(rmsRange(chk, 100 + int64_t(0.3 * SR), 100 + int64_t(0.6 * SR)));
        std::printf("  semiabierto 0,3-0,6 s: libre %.1f dB | con pedal 44 a los 100 ms %.1f dB\n", a, b);
        check(b < a - 12.0, "el pedal corta tambien el hi-hat semiabierto");
    }

    std::printf("== S18. CPU con groove denso (fusas a 120 BPM, bombo, caja, toms, platos; 12 s) ==\n");
    {
        std::vector<Ev> evs; Rng r; r.seed(99);
        const double stp = 0.0625;
        const int notesT[] = { 50, 48, 47, 45, 43, 41 };
        for (int i = 0; i < int(12.0 / stp) - 4; ++i) {
            const double t = i * stp;
            auto add = [&](int n, double v) { evs.push_back({ int64_t(t * SR) + 480 + int64_t(r.u() * 100), n, float(std::min(1.0, std::max(0.05, v + r.bi() * 0.08))) }); };
            add(i % 4 == 0 ? 46 : 42, 0.6);
            if (i % 8 == 0 || i % 16 == 6) add(36, 0.9);
            if (i % 8 == 4) add(38, 0.9); else if (i % 4 == 3) add(38, 0.25);
            if (i % 16 == 12) add(notesT[(i / 16) % 6], 0.85);
            if (i % 32 == 0) add(49, 0.95);
            if (i % 16 == 8) add(51, 0.7);
        }
        // el tiempo de CPU del hilo es ruidoso si el equipo esta ocupado: se toma el minimo de 12 pasadas (por defecto) y de 12 con cuerpo/pegada a 0 (banco original)
        DrumBus bus;
        double cpu = 1e9, cpuRef = 1e9, pk = 0.0;
        bool fin = true;
#ifdef _WIN32
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);   // menos expulsiones por otros procesos mientras se mide
#endif
        for (int rep = 0; rep < 12; ++rep) {
            for (int variant = 0; variant < 2; ++variant) {
                DrumSettings s1;
                if (variant == 1) { s1.shellBody = 0.0; s1.shellPunch = 0.0; }
                const double t0 = threadCpuSeconds();
                Out o = renderEvents(SR, int64_t(14.0 * SR), evs, 512, &s1, &bus);
                const double c = (threadCpuSeconds() - t0) / 14.0 * 100.0;
                if (variant == 0) { cpu = std::min(cpu, c); pk = peakOf(o); fin = fin && finiteAll(o); }
                else cpuRef = std::min(cpuRef, c);
            }
        }
        std::printf("  %zu golpes en 12 s: CPU = %.2f %% de un nucleo (minimo de 12; con cuerpo y pegada a 0: %.2f %%), pico %.3f\n", evs.size(), cpu, cpuRef, pk);
        check(fin && cpu <= 6.0, "CPU del groove denso <= 6 % de un nucleo y sin NaN", fmt("%.2f %%", cpu));
    }
    // =====================================================================================================
    //  v3: cuerpo y pegada de caja y toms (queja: "el redoblante se siente sin cuerpo y sin fuerza, los toms tambien")
    //  Diagnostico medido del banco original (Shell Body = Shell Punch = 0): la caja del kit no tiene nada bajo 160 Hz (el tercio de 125 Hz esta ~28 dB bajo el
    //  pico de 215 Hz), su presencia 2,5-4 kHz esta ~17,6 dB bajo ese pico y los toms 41/43/48/50 tienen el ataque de baqueta 25-28 dB bajo su fundamental.
    //  La referencia son las envolventes espectrales tipicas de una caja de rock/worship acustica (tercios de octava, primeros 60 ms, relativos al pico de
    //  150-300 Hz): 125 Hz >= -14 dB, 160 Hz >= -9 dB; y la mejora medida sobre el propio banco con el mismo golpe.
    // =====================================================================================================
    std::printf("== S19. Caja: cuerpo (100-250 Hz), huecos de 125/160 Hz, presencia y pegada frente al banco original ==\n");
    DrumSettings sRef; sRef.roomBlend = 0.0; sRef.shellBody = 0.0; sRef.shellPunch = 0.0;   // = muestras del banco (sin EQ, sin capa, sin curva de velocidad)
    DrumSettings sDef; sDef.roomBlend = 0.0;                                                 // valores por defecto del plugin
    double kickR300 = 0.0;
    {
        const ShellM k = shellMetrics(SR, 36, 0.7, sDef, 0.0);
        kickR300 = k.r300;
        std::printf("  bombo 0.7: pico %.1f dBFS, RMS 300 ms %.1f dB\n", k.pk, k.r300);
        for (double vel : { 0.5, 0.7, 0.9 }) {
            const ShellM a = shellMetrics(SR, 38, vel, sRef, 0.0), b = shellMetrics(SR, 38, vel, sDef, 0.0);
            std::printf("  caja vel %.1f: pico %.1f -> %.1f | RMS300 %.1f -> %.1f | E100-250 %.1f -> %.1f | hueco 125 Hz %.1f -> %.1f dB | 160 Hz %.1f -> %.1f dB | presencia %.1f -> %.1f dB | crest(pico-RMS80) %.1f -> %.1f\n",
                        vel, a.pk, b.pk, a.r300, b.r300, a.e100_250, b.e100_250, a.h125, b.h125, a.h160, b.h160, a.pres, b.pres, a.pk - a.r80, b.pk - b.r80);
            check(b.h125 >= -14.0 && b.h160 >= -9.0, fmt("caja %.1f: sin hueco bajo 160 Hz (125 Hz >= -14 dB, 160 Hz >= -9 dB del pico de la fundamental)", vel).c_str(), fmt("%.1f / %.1f dB", b.h125, b.h160));
            check(b.h125 - a.h125 >= 10.0, fmt("caja %.1f: el hueco de 125 Hz mejora >= 10 dB", vel).c_str(), fmt("%+.1f dB", b.h125 - a.h125));
            check(b.e100_250 - a.e100_250 >= 1.5, fmt("caja %.1f: energia 100-250 Hz (0-300 ms) sube >= 1,5 dB", vel).c_str(), fmt("%+.1f dB", b.e100_250 - a.e100_250));
            check(b.pres - a.pres >= (vel > 0.8 ? 1.0 : 2.5), fmt("caja %.1f: presencia 2,5-4 kHz sube (>= 2,5 dB; >= 1 dB en velocidades altas, que ya traen mucho ataque)", vel).c_str(), fmt("%+.1f dB", b.pres - a.pres));
            if (vel < 0.8) {
                check(b.pk - a.pk >= 1.0, fmt("caja %.1f: pico (pegada) sube >= 1 dB", vel).c_str(), fmt("%+.1f dB", b.pk - a.pk));
                check(b.r300 - a.r300 >= 1.0, fmt("caja %.1f: la curva de velocidad lleva la velocidad media a una capa mas fuerte (RMS +1 dB)", vel).c_str(), fmt("%+.1f dB", b.r300 - a.r300));
            }
            if (vel == 0.7) check(b.r300 - kickR300 <= -3.0 && b.r300 - kickR300 >= -8.0, "caja a vel 0,7 entre -3 y -8 dB del bombo (RMS 300 ms)", fmt("%.2f dB", b.r300 - kickR300));
        }
    }

    {   // el rimshot ya trae el crack del aro: conserva el nivel y el timbre del banco (no pasa por la EQ ni la capa de la caja)
        const ShellM a = shellMetrics(SR, 40, 0.8, sRef, 0.0), b = shellMetrics(SR, 40, 0.8, sDef, 0.0);
        std::printf("  rimshot 0.8: pico %.1f -> %.1f | RMS300 %.1f -> %.1f | presencia %.1f -> %.1f dB\n", a.pk, b.pk, a.r300, b.r300, a.pres, b.pres);
        check(std::fabs(b.r300 - a.r300) < 1.0 && std::fabs(b.pres - a.pres) < 1.0, "rimshot sin cambio de nivel ni de timbre", fmt("%+.1f dB", b.r300 - a.r300));
    }

    std::printf("== S20. Toms: fundamental de cada tom, presencia de baqueta y pegada frente al banco original ==\n");
    {
        const int notes[kNumToms] = { 41, 43, 45, 47, 48, 50 };
        double sumRel = 0.0;
        for (int t = 0; t < kNumToms; ++t) {
            for (double vel : { 0.5, 0.7, 0.9 }) {
                const ShellM a = shellMetrics(SR, notes[t], vel, sRef, kTomFundHz[t]), b = shellMetrics(SR, notes[t], vel, sDef, kTomFundHz[t]);
                std::printf("  tom %d (%.0f Hz) vel %.1f: pico %.1f -> %.1f | RMS300 %.1f -> %.1f | banda de la fundamental %.1f -> %.1f dB | presencia %.1f -> %.1f dB | crest %.1f -> %.1f\n",
                            notes[t], kTomFundHz[t], vel, a.pk, b.pk, a.r300, b.r300, a.fund, b.fund, a.pres, b.pres, a.pk - a.r80, b.pk - b.r80);
                if (vel == 0.7) {
                    check(b.fund - a.fund >= 3.0, fmt("tom %.0f: la fundamental sube >= 3 dB", notes[t]).c_str(), fmt("%+.1f dB", b.fund - a.fund));
                    check(b.pres - a.pres >= 3.0, fmt("tom %.0f: el ataque de baqueta 2,5-4 kHz sube >= 3 dB", notes[t]).c_str(), fmt("%+.1f dB", b.pres - a.pres));
                    check(b.pk - a.pk >= 1.0, fmt("tom %.0f: pico (pegada) sube >= 1 dB (los toms graves 41/43 ganan sobre todo en presencia)", notes[t]).c_str(), fmt("%+.1f dB", b.pk - a.pk));
                    check((b.pk - b.r80) - (a.pk - a.r80) >= -1.0, fmt("tom %.0f: el transitorio no pierde pegada aunque el cuerpo sube (crest >= -1 dB)", notes[t]).c_str(), fmt("%+.1f dB", (b.pk - b.r80) - (a.pk - a.r80)));
                    sumRel += b.r300 - kickR300;
                    check(b.r300 - kickR300 <= 0.5 && b.r300 - kickR300 >= -6.0, fmt("tom %.0f a vel 0,7 entre -6 y +0,5 dB del bombo", notes[t]).c_str(), fmt("%.2f dB", b.r300 - kickR300));
                }
                if (vel == 0.5) check(b.r300 - a.r300 >= 1.0, fmt("tom %.0f: la velocidad media suena a una capa mas fuerte (RMS +1 dB)", notes[t]).c_str(), fmt("%+.1f dB", b.r300 - a.r300));
            }
        }
        std::printf("  toms a 0.7: media respecto al bombo %.2f dB\n", sumRel / kNumToms);
    }

    std::printf("== S21. Parametros de cuerpo y pegada actuan (Shell Body / Shell Punch / Snare Body / Toms Body / afinaciones) ==\n");
    {
        double e[3], pr[3], pkv[3]; int j = 0;
        for (double b : { 0.0, 0.5, 1.0 }) {
            DrumSettings s = sDef; s.shellBody = b; s.shellPunch = 0.0;
            const ShellM m = shellMetrics(SR, 38, 0.7, s, 0.0); e[j] = m.e100_250; pr[j] = m.h125; ++j;
        }
        std::printf("  Shell Body 0/50/100 %%: caja E100-250 %.1f / %.1f / %.1f dB, hueco 125 Hz %.1f / %.1f / %.1f\n", e[0], e[1], e[2], pr[0], pr[1], pr[2]);
        check(e[1] > e[0] + 0.5 && e[2] > e[1] + 0.3 && pr[2] > pr[0] + 10.0, "Shell Body sube el cuerpo de la caja de forma monotona");
        j = 0;
        for (double p : { 0.0, 0.5, 1.0 }) {
            DrumSettings s = sDef; s.shellPunch = p; s.shellBody = 0.0;
            const ShellM m = shellMetrics(SR, 38, 0.5, s, 0.0); pr[j] = m.pres; pkv[j] = m.pk; ++j;
        }
        std::printf("  Shell Punch 0/50/100 %%: caja presencia %.1f / %.1f / %.1f dB, pico %.1f / %.1f / %.1f dBFS\n", pr[0], pr[1], pr[2], pkv[0], pkv[1], pkv[2]);
        check(pr[1] > pr[0] + 1.0 && pr[2] > pr[1] + 1.0 && pkv[2] > pkv[0] + 2.0, "Shell Punch sube presencia y pico de forma monotona");
        {   // Snare Body (ajuste fino) y Toms Body
            double es[3]; j = 0;
            for (double b : { 0.0, 1.0, 1.5 }) { DrumSettings s = sDef; s.snareBody = b; es[j++] = shellMetrics(SR, 38, 0.7, s, 0.0).e100_250; }
            std::printf("  Snare Body 0/100/150 %%: E100-250 %.1f / %.1f / %.1f dB\n", es[0], es[1], es[2]);
            check(es[1] > es[0] + 1.0 && es[2] > es[1] + 0.2, "Snare Body ajusta el cuerpo de la caja");
            j = 0;
            for (double b : { 0.0, 1.0, 1.5 }) { DrumSettings s = sDef; s.tomsBody = b; es[j++] = shellMetrics(SR, 45, 0.7, s, kTomFundHz[2]).fund; }
            std::printf("  Toms Body 0/100/150 %%: tom 45 fundamental %.1f / %.1f / %.1f dB\n", es[0], es[1], es[2]);
            check(es[1] > es[0] + 1.0 && es[2] > es[1] + 0.2, "Toms Body ajusta la fundamental de los toms");
        }
        {   // Snare Body Tuning: la capa sintetizada se mueve (centroide 100-300 Hz)
            double cen[3]; j = 0;
            for (double f : { 120.0, 165.0, 250.0 }) {
                DrumSettings s = sDef; s.snareTuneHz = f; s.shellPunch = 0.0;
                Out o = renderEvents(SR, int64_t(0.8 * SR), { { 4800, 38, 0.7f } }, 512, &s);
                std::vector<float> mono(o.l.size()); for (size_t i = 0; i < mono.size(); ++i) mono[i] = 0.5f * (o.l[i] + o.r[i]);
                double pk, c; spectrumOf(mono, SR, 4800 + int64_t(0.01 * SR), int64_t(0.20 * SR), 100, 190, pk, c); cen[j++] = c;
            }
            std::printf("  Snare Body Tuning 120/165/250 Hz: centroide 100-190 Hz %.0f / %.0f / %.0f Hz\n", cen[0], cen[1], cen[2]);
            check(cen[0] < cen[1] && cen[1] < cen[2] && cen[2] - cen[0] > 15.0, "Snare Body Tuning mueve la capa sintetizada de la caja");
        }
        {   // Toms Body Tuning: el pico de la fundamental del tom 45 sigue a la afinacion
            double cenHz[3]; j = 0;
            for (double c : { -300.0, 0.0, 300.0 }) {
                DrumSettings s = sDef; s.tomsTuneCents = c; s.tomsBody = 1.5;
                Out o = renderEvents(SR, int64_t(1.2 * SR), { { 4800, 45, 0.7f } }, 512, &s);
                // reparto de la energia entre 98-118 Hz y 68-80 Hz (la resonancia anadida se desplaza con la afinacion)
                cenHz[j++] = segBandDb(o, 4800, int64_t(0.5 * SR), SR, 98, 118) - segBandDb(o, 4800, int64_t(0.5 * SR), SR, 68, 80);
            }
            std::printf("  Toms Body Tuning -300/0/+300 cents: energia 98-118 Hz menos 68-80 Hz del tom 45 %.1f / %.1f / %.1f dB\n", cenHz[0], cenHz[1], cenHz[2]);
            check(cenHz[0] < cenHz[1] && cenHz[1] < cenHz[2] && cenHz[2] - cenHz[0] > 2.0, "Toms Body Tuning desplaza la resonancia anadida de los toms");
        }
        {   // con Shell Body = Shell Punch = 0 la caja y los toms suenan como las muestras (nivel ya medido en el banco)
            const ShellM a = shellMetrics(SR, 38, 0.7, sRef, 0.0);
            double rawR = 0.0; int nr = 0;
            for (int rr = 0; rr < 4; ++rr) {
                const auto* z = findZone(*keep, 38, 89, rr); if (!z) continue;
                const auto m = zoneMono(*keep, *z);
                double s2 = 0; const int64_t n = std::min<int64_t>(int64_t(m.size()), int64_t(0.3 * 44100));
                for (int64_t i = 0; i < n; ++i) s2 += double(m[size_t(i)]) * m[size_t(i)];
                rawR += 20.0 * std::log10(std::sqrt(s2 / double(n)) + 1e-12); ++nr;
            }
            rawR /= std::max(1, nr);
            std::printf("  caja 0.7 con cuerpo y pegada a 0: RMS300 %.1f dB | muestras del banco (vel 89) %.1f dB\n", a.r300, rawR);
            check(std::fabs(a.r300 - rawR) < 3.0, "con Shell Body = Shell Punch = 0 la caja suena al nivel del banco original (+-3 dB)", fmt("%.1f dB", a.r300 - rawR));
        }
    }

    std::printf("== S22. Redoble de caja con toms y groove: A/B frente al banco original (WAV) ==\n");
    {
        const double bpm = 84.0, step = 60.0 / bpm / 4.0;
        std::vector<Ev> evs;
        auto addAt = [&](double t, int note, double vel) { evs.push_back({ int64_t(t * SR) + 480, note, float(std::min(1.0, std::max(0.05, vel))) }); };
        // compas 1: redoble de caja que crece (semicorcheas, 55 -> 100) con bombo en 1 y 3
        for (int i = 0; i < 16; ++i) addAt(i * step, 38, 0.55 + 0.45 * i / 15.0);
        addAt(0.0, 36, 0.85); addAt(8 * step, 36, 0.8); addAt(0.0, 49, 0.9);
        // compas 2: recorrido de toms 50 -> 41 en semicorcheas dobles, cierre con caja + crash + bombo
        const int tomSeq[] = { 50, 50, 48, 48, 47, 47, 45, 45, 43, 43, 41, 41 };
        for (int i = 0; i < 12; ++i) addAt((16 + i) * step, tomSeq[i], 0.62 + 0.03 * i);
        addAt(28 * step, 38, 0.9); addAt(28 * step, 36, 1.0); addAt(28 * step, 49, 1.0);
        addAt(30 * step, 38, 0.6); addAt(31 * step, 38, 0.75);
        const int64_t total = int64_t((32 * step + 4.0) * SR);
        Out o0 = renderEvents(SR, total, evs, 512, &sRef), o1 = renderEvents(SR, total, evs, 512, &sDef);
        auto summary = [&](const char* nm, const Out& o) {
            double ss = 0; const int64_t n = int64_t(32 * step * SR);
            for (int64_t i = 0; i < n; ++i) ss += 0.5 * (double(o.l[size_t(i)]) * o.l[size_t(i)] + double(o.r[size_t(i)]) * o.r[size_t(i)]);
            const double rms = std::sqrt(ss / double(n));
            std::printf("  %s: pico %.3f (%.1f dBFS), RMS %.1f dBFS, crest %.1f dB, E100-250 %.1f dB, E2-5k %.1f dB\n", nm, peakOf(o), db(peakOf(o)), db(rms), db(peakOf(o)) - db(rms),
                        segBandDb(o, 480, n, SR, 100, 250), segBandDb(o, 480, n, SR, 2000, 5000));
        };
        summary("banco original", o0);
        summary("por defecto    ", o1);
        check(finiteAll(o1) && peakOf(o1) < 0.9801, "redoble con toms sin NaN y pico < 0.98", fmt("%.3f", peakOf(o1)));
        std::vector<char> nearHit(o1.l.size(), 0);
        for (const auto& e : evs) for (int64_t k = 0; k < 288; ++k) if (e.at + k < int64_t(o1.l.size())) nearHit[size_t(e.at + k)] = 1;
        check(clickRatio(o1, nearHit) < 12.0, "redoble con toms sin clics fuera de los ataques", fmt("%.2f", clickRatio(o1, nearHit)));
        std::string base = wavPath; const size_t dot = base.rfind('.'); if (dot != std::string::npos) base = base.substr(0, dot);
        writeWav24((base + "-redoble-toms.wav").c_str(), o1, 48000);
        writeWav24((base + "-redoble-toms-banco-original.wav").c_str(), o0, 48000);
        std::printf("  WAV: %s-redoble-toms.wav (por defecto) y %s-redoble-toms-banco-original.wav\n", base.c_str(), base.c_str());
    }
    std::printf("== S23. Robustez de la capa de cuerpo: 44,1-192 kHz, bloques 1-4096, ajustes extremos, colas en silencio ==\n");
    {
        for (double sr : { 44100.0, 96000.0, 192000.0 }) {
            DrumSettings st; st.shellBody = 1.0; st.shellPunch = 1.0; st.snareBody = 1.5; st.tomsBody = 1.5; st.snareTuneHz = 110.0; st.tomsTuneCents = 300.0; st.tomsDamp = 0.0;
            std::vector<Ev> evs;
            const int nn[] = { 38, 41, 43, 45, 47, 48, 50, 38, 38, 40 };
            for (int i = 0; i < 40; ++i) evs.push_back({ int64_t(i * 0.012 * sr), nn[i % 10], 0.4f + 0.015f * float(i) });
            bool ok = true; double pk = 0;
            for (int blk : { 1, 64, 480, 4096 }) {
                Out o = renderEvents(sr, int64_t((sr > 100000.0 ? 1.5 : 2.5) * sr), evs, blk, &st);
                ok = ok && finiteAll(o) && peakOf(o) < 0.9801; pk = std::max(pk, peakOf(o));
            }
            check(ok, fmt("%.0f Hz, bloques 1/64/480/4096, cuerpo y pegada al maximo", sr).c_str(), fmt("pico=%.3f", pk));
        }
        // la cola de la caja y de un tom termina en silencio (capa sintetizada incluida)
        for (int note : { 38, 41, 45, 50 }) {
            DrumSettings st; st.tomsDamp = 0.5;
            Out o = renderEvents(SR, int64_t(9.0 * SR), { { 4800, note, 0.95f } }, 512, &st);
            const double tail = rmsRange(o, int64_t(7.5 * SR), int64_t(9.0 * SR));
            check(finiteAll(o) && db(tail) < -90.0, fmt("cola de la nota %.0f en silencio a los 7,5 s", note).c_str(), fmt("%.1f dB", db(tail)));
        }
    }
    testFxRack(true);
    std::printf("\n%s (%d fallos)\n", g_fail ? "FALLO" : "TODO OK", g_fail);
    return g_fail ? 1 : 0;
}

int main(int argc, char** argv) {
    if (argc > 1 && std::string(argv[1]) == "--hash") {   // utilidad: imprime el hash de referencia (modelado, o con el banco si se pasa --samples)
        ScopedNoDenormals nd0;
        const bool conBanco = argc > 2 && std::string(argv[2]) == "--samples";
        g_samples = conBanco;
        if (!conBanco) _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
        auto e = makeDrumEngine(48000.0);
        const uint64_t h = hashRenderBateria(*e);
        auto e2 = makeDrumEngine(48000.0);
        std::printf("samplerReady=%d hash=0x%016llx (2.a instancia 0x%016llx)\n", e->samplerReady() ? 1 : 0, static_cast<unsigned long long>(h),
                    static_cast<unsigned long long>(hashRenderBateria(*e2)));
        return 0;
    }
    if (argc > 2 && std::string(argv[1]) == "--dump-hits") {   // golpes sueltos con el banco (ajustes por defecto) para analisis externo antes/despues
        g_samples = true;
        ScopedNoDenormals nd;
        for (int n : { 36, 38, 40, 41, 43, 45, 47, 48, 50 }) for (float v : { 0.5f, 0.7f, 0.9f }) {
            Out o = renderEvents(48000.0, int64_t(2.5 * 48000), { { 4800, n, v } }, 512);
            writeWav24((std::string(argv[2]) + "/h" + std::to_string(n) + "_v" + std::to_string(int(v * 100)) + ".wav").c_str(), o, 48000);
        }
        return 0;
    }
    for (int i = 1; i < argc; ++i) if (std::string(argv[i]) == "--samples") {
        const char* w = (argc > 1 && std::strncmp(argv[1], "--", 2) != 0) ? argv[1] : "worship_drums_samples_groove.wav";
        return sampledTest(w);
    }
    // La suite modelada comprueba el motor sin banco: se aparta la carpeta de samples (el respaldo es el comportamiento probado).
#ifdef _WIN32
    _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
#endif
    if (argc > 2 && std::string(argv[1]) == "--dump") {   // un WAV por elemento (vel 0.9 y 0.25) para analisis externo
        ScopedNoDenormals nd;
        for (const auto& m : kMap) for (float v : { 0.9f, 0.25f }) {
            Out o = renderEvents(48000.0, 5 * 48000, { { 4800, m.note, v } }, 512);
            writeWav24((std::string(argv[2]) + "/n" + std::to_string(m.note) + "_v" + std::to_string(int(v * 100)) + ".wav").c_str(), o, 48000);
        }
        return 0;
    }
    const char* wavPath = argc > 1 ? argv[1] : "worship_drums_groove.wav";
    const bool quick = argc > 2 && std::string(argv[2]) == "--quick";
    const double SR = 48000.0;
    ScopedNoDenormals noDenormals;   // lo pone JwProcessor en el plugin

    std::printf("== 1. Elementos aislados (vel 0.9): pico, RMS 0.5 s, latencia de transitorio, energia por banda ==\n");
    std::printf("  %-16s %7s %8s %8s | %6s %6s %6s %6s dB | centroide\n", "elemento", "pico", "rms dB", "lat ms", "<200", "200-2k", "2k-8k", ">8k");
    for (const auto& m : kMap) {
        const int64_t total = static_cast<int64_t>(5.0 * SR);
        DrumSettings s1; s1.volumeDb = -24.0;                     // sin soft-clip: pico real
        Out o = renderEvents(SR, total, { { 100, m.note, 0.9f } }, 256, &s1);
        const double pk = peakOf(o) * std::pow(10.0, 24.0 / 20.0);
        for (auto& x : o.l) x *= 15.84893f;
        for (auto& x : o.r) x *= 15.84893f;
        const double rms = rmsRange(o, 100, 100 + int64_t(0.5 * SR));
        // latencia: primera muestra que supera el 5 % del pico de los primeros 20 ms
        double pk20 = 0.0;
        for (int64_t i = 0; i < 100 + int64_t(0.02 * SR); ++i) pk20 = std::max({ pk20, double(std::fabs(o.l[size_t(i)])), double(std::fabs(o.r[size_t(i)])) });
        int64_t lat = -1;
        for (int64_t i = 0; i < total; ++i) if (std::max(std::fabs(o.l[size_t(i)]), std::fabs(o.r[size_t(i)])) > 0.05 * pk20) { lat = i - 100; break; }
        const auto sp = powerSpectrum(o, 100);
        std::printf("  %-16s %7.3f %8.1f %8.3f | %6.1f %6.1f %6.1f %6.1f    | %6.0f Hz\n", m.name, pk, db(rms), lat * 1000.0 / SR,
                    bandDb(sp, SR, 20, 200), bandDb(sp, SR, 200, 2000), bandDb(sp, SR, 2000, 8000), bandDb(sp, SR, 8000, 20000), centroid(sp, SR));
        check(finiteAll(o) && pk > 0.02 && pk < 0.99, m.name, fmt("pico real=%.3f (%.1f dBFS)", pk, db(pk)));
        check(lat >= 0 && lat * 1000.0 / SR <= 1.0, "  latencia <= 1 ms", fmt("%.3f ms", lat * 1000.0 / SR));
    }

    std::printf("== 2. Notas fuera del mapa GM: silencio exacto ==\n");
    {
        int ignored = 0, leaks = 0;
        for (int n = 0; n < 128; ++n) {
            if (elementForNote(n) >= 0) continue;
            ++ignored;
            Out o = renderEvents(SR, 4800, { { 0, n, 1.0f } }, 512);
            if (peakOf(o) != 0.0) ++leaks;
        }
        check(leaks == 0, "notas no mapeadas ignoradas", fmt("%.0f notas probadas, %.0f suenan", ignored, leaks));
    }

    std::printf("== 3. Choke del hi-hat y del crash ==\n");
    {
        const int64_t total = int64_t(3.0 * SR);
        Out open = renderEvents(SR, total, { { 100, 46, 0.9f } }, 256);
        const double tailOpen = rmsRange(open, int64_t(0.7 * SR), int64_t(0.9 * SR));
        for (int ch : { 42, 44 }) {
            Out c = renderEvents(SR, total, { { 100, 46, 0.9f }, { 100 + int64_t(0.5 * SR), ch, 0.7f } }, 256);
            Out closedOnly = renderEvents(SR, total, { { 100 + int64_t(0.5 * SR), ch, 0.7f } }, 256);
            const double tailC = rmsRange(c, int64_t(0.7 * SR), int64_t(0.9 * SR));
            const double tailRef = rmsRange(closedOnly, int64_t(0.7 * SR), int64_t(0.9 * SR));
            std::printf("  hat abierto + %d: cola 0.7-0.9 s = %.1f dB (abierto libre %.1f dB, solo %d %.1f dB)\n", ch, db(tailC), db(tailOpen), ch, db(tailRef));
            check(db(tailC) < db(tailRef) + 6.0 && db(tailC) < db(tailOpen) - 12.0,
                  ch == 42 ? "cerrado corta el abierto (cola = solo el cerrado, >12 dB bajo el abierto libre)"
                           : "pedal corta el abierto (cola = solo el pedal, >12 dB bajo el abierto libre)");
        }
        // sin choke si el golpe siguiente es otro elemento (la caja no corta el abierto)
        Out sn = renderEvents(SR, total, { { 100, 46, 0.9f }, { 100 + int64_t(0.5 * SR), 38, 0.7f } }, 256);
        check(db(rmsRange(sn, int64_t(1.2 * SR), int64_t(1.4 * SR))) > db(rmsRange(open, int64_t(1.2 * SR), int64_t(1.4 * SR))) - 3.0, "la caja no corta el hi-hat abierto");
        // crash repetido: la primera cola se ahoga
        Out cr1 = renderEvents(SR, int64_t(6 * SR), { { 100, 49, 0.9f } }, 256);
        Out cr2 = renderEvents(SR, int64_t(6 * SR), { { 100, 49, 0.9f }, { 100 + int64_t(0.8 * SR), 49, 0.9f } }, 256);
        Out cr3 = renderEvents(SR, int64_t(6 * SR), { { 100 + int64_t(0.8 * SR), 49, 0.9f } }, 256);   // solo el segundo golpe
        (void)cr1;
        const double aCr = rmsRange(cr3, int64_t(3.0 * SR), int64_t(3.5 * SR)), bCr = rmsRange(cr2, int64_t(3.0 * SR), int64_t(3.5 * SR));
        std::printf("  crash 3.0-3.5 s: solo el 2o golpe %.1f dB, 1o + 2o (a 0.8 s) %.1f dB\n", db(aCr), db(bCr));
        check(bCr <= aCr * 1.03, "el crash repetido se ahoga: la cola del primero no se suma");
        // clic en el choke: salto máximo muestra a muestra 5 ms antes/después del choke
        auto maxStep = [&](const Out& o, int64_t a, int64_t b) { double m = 0; for (int64_t i = a + 1; i < b; ++i) m = std::max(m, double(std::fabs(o.l[size_t(i)] - o.l[size_t(i - 1)]))); return m; };
        Out ch42 = renderEvents(SR, total, { { 100, 46, 0.9f }, { 100 + int64_t(0.5 * SR), 44, 0.01f } }, 256);   // pedal casi mudo: aísla el choke
        const int64_t c0 = 100 + int64_t(0.5 * SR);
        const double before = maxStep(ch42, c0 - 240, c0), after = maxStep(ch42, c0 + 3, c0 + 480);
        std::printf("  clic de choke: paso max antes %.5f / despues %.5f\n", before, after);
        check(after <= before * 1.25 + 1e-4, "choke sin clic (paso max despues <= 1.25x antes)");
    }

    std::printf("== 4. Round-robin: 8 golpes iguales deben diferir ==\n");
    {
        for (int note : { 36, 38, 42, 49 }) {
            std::vector<Ev> evs;
            for (int i = 0; i < 8; ++i) evs.push_back({ 100 + int64_t(i) * int64_t(2.0 * SR), note, 0.8f });
            Out o = renderEvents(SR, int64_t(8 * 2.0 * SR), evs, 512);
            double minDiff = 1e9;
            const int64_t len = int64_t(0.4 * SR);
            for (int i = 1; i < 8; ++i) {
                double num = 0, den = 0;
                for (int64_t k = 0; k < len; ++k) {
                    const double a = o.l[size_t(100 + k)], b = o.l[size_t(100 + int64_t(i) * int64_t(2.0 * SR) + k)];
                    num += (a - b) * (a - b); den += a * a;
                }
                minDiff = std::min(minDiff, std::sqrt(num / std::max(den, 1e-12)));
            }
            check(minDiff > 0.15, fmt("golpes distintos (nota %.0f)", note).c_str(), fmt("dif relativa minima=%.2f", minDiff));
        }
    }

    std::printf("== 5. Capas de velocidad: el timbre cambia (energia por encima/debajo de 1 kHz (2 kHz en la caja) en el ataque) ==\n");
    for (int note : { 36, 38, 41, 42, 51, 49 }) {
        Out lo = renderEvents(SR, int64_t(3 * SR), { { 100, note, 0.2f } }, 512);
        Out hi = renderEvents(SR, int64_t(3 * SR), { { 100, note, 1.0f } }, 512);
        const auto spl = powerSpectrum(lo, 100), sph = powerSpectrum(hi, 100);
        auto bright = [&](const Out& o, int64_t len) {
            Out w; w.l.assign(o.l.begin() + 100, o.l.begin() + 100 + len); w.r.assign(o.r.begin() + 100, o.r.begin() + 100 + len);
            const auto sp = powerSpectrum(w, -32768);   // segmento centrado en la ventana de Hann
            const double split = note == 38 ? 2000.0 : 1000.0;
            return bandDb(sp, SR, split, 20000) - bandDb(sp, SR, 20, split);
        };
        const double bl = bright(lo, 2880), bh = bright(hi, 2880);
        std::printf("  nota %d: brillo del ataque (60 ms) vel0.2 = %+.1f dB, vel1.0 = %+.1f dB (delta %+.1f) | centroide %.0f -> %.0f Hz | rms %.1f vs %.1f dB\n", note, bl, bh, bh - bl,
                    centroid(spl, SR), centroid(sph, SR), db(rmsRange(lo, 100, 100 + 24000)), db(rmsRange(hi, 100, 100 + 24000)));
        check(bh > bl + 1.0 || centroid(sph, SR) > centroid(spl, SR) * 1.1, "mas brillo con mas velocidad (+1 dB o centroide +10 %; el suavizado de agudos del master lo comprime en el hi-hat)");
    }

    std::printf("== 6. Afinacion del bombo (kick_tune) ==\n");
    for (double tune : { 40.0, 55.0, 80.0 }) {
        DrumSettings s; s.kickTuneHz = tune;
        Out o = renderEvents(SR, int64_t(1.5 * SR), { { 0, 36, 0.8f } }, 512, &s);
        const auto sp = powerSpectrum(o, int64_t(0.15 * SR));
        const double bin = SR / 65536.0;
        size_t best = size_t(20.0 / bin);
        for (size_t i = size_t(20.0 / bin); i < size_t(200.0 / bin); ++i) if (sp[i] > sp[best]) best = i;
        const double f = best * bin;
        std::printf("  tune %.0f Hz -> pico espectral %.1f Hz\n", tune, f);
        check(std::fabs(f - tune) / tune < 0.08, "bombo afinado");
    }

    std::printf("== 7. Sala FDN: estabilidad y cola ==\n");
    {
        DrumSettings s; s.roomBlend = 1.0; s.roomComp = 0.0;
        Out o = renderEvents(SR, int64_t(12 * SR), { { 100, 38, 1.0f } }, 512, &s);
        const double e1 = rmsRange(o, int64_t(0.3 * SR), int64_t(0.5 * SR)), e2 = rmsRange(o, int64_t(3.0 * SR), int64_t(3.2 * SR)), e3 = rmsRange(o, int64_t(10.0 * SR), int64_t(12.0 * SR));
        std::printf("  sala al 100 %%: 0.3-0.5 s %.1f dB | 3.0-3.2 s %.1f dB | 10-12 s %.1f dB\n", db(e1), db(e2), db(e3));
        std::unique_ptr<WorshipDrumsEngine> engp(new WorshipDrumsEngine()); WorshipDrumsEngine& eng = *engp; eng.prepare(SR, 512);
        check(eng.room().maxLoopGain() < 1.0, "ganancia de lazo FDN < 1", fmt("g_max=%.5f", eng.room().maxLoopGain()));
        check(e3 < e1 * 0.001, "la cola de sala decae (>60 dB en 12 s)");
        check(e2 < e1, "decaimiento monotono");
        for (double sr : { 44100.0, 192000.0 }) {
            std::unique_ptr<WorshipDrumsEngine> e2p(new WorshipDrumsEngine()); WorshipDrumsEngine& e2e = *e2p; e2e.prepare(sr, 512);
            check(e2e.room().maxLoopGain() < 1.0, fmt("lazo FDN < 1 a %.0f Hz", sr).c_str());
        }
    }

    std::printf("== 8. Frecuencias de muestreo y bloques de 1..4096 ==\n");
    {
        for (double sr : { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 }) {
            std::vector<Ev> evs;
            const int notes[] = { 36, 38, 42, 46, 41, 50, 49, 51, 55, 52, 53, 44 };
            for (int i = 0; i < 12; ++i) evs.push_back({ int64_t(i * 0.09 * sr), notes[i], 0.5f + 0.04f * i });
            bool ok = true; double pk = 0;
            for (int blk : { 1, 7, 64, 480, 4096 }) {
                if (quick && blk == 1 && sr > 100000) continue;
                Out o = renderEvents(sr, int64_t(2.0 * sr), evs, blk);
                ok = ok && finiteAll(o) && peakOf(o) < 0.9801; pk = std::max(pk, peakOf(o));
            }
            check(ok, fmt("%.0f Hz, bloques 1/7/64/480/4096", sr).c_str(), fmt("pico=%.3f", pk));
        }
        // independencia de bloque
        std::vector<Ev> evs;
        for (int i = 0; i < 20; ++i) evs.push_back({ int64_t(i * 0.05 * SR) + (i * 37) % 91, i % 2 ? 38 : 36, 0.7f });
        Out a = renderEvents(SR, int64_t(1.5 * SR), evs, 1), b = renderEvents(SR, int64_t(1.5 * SR), evs, 4096);
        double md = 0; size_t mi = 0; for (size_t i = 0; i < a.l.size(); ++i) { const double d = std::fabs(a.l[i] - b.l[i]); if (d > md) { md = d; mi = i; } }
        std::printf("  dif max en muestra %zu (%.4f s)\n", mi, mi / SR);
        { size_t first = 0, cnt = 0; for (size_t i = 0; i < a.l.size(); ++i) if (std::fabs(a.l[i] - b.l[i]) > 1e-4) { if (!cnt) first = i; ++cnt; }
          std::printf("  muestras con dif > 1e-4: %zu, primera en %zu (%.5f s); a=%.5f b=%.5f\n", cnt, first, first / SR, a.l[first], b.l[first]); }
        check(md < 2e-4, "resultado independiente del tamano de bloque (poda de modos por chunk < -74 dB)", fmt("dif max=%.2e", md));
    }

    std::printf("== 9. Polifonia y robo de voces (80 golpes en 80 ms) ==\n");
    {
        std::vector<Ev> evs;
        const int notes[] = { 49, 57, 51, 59, 55, 52, 46, 41, 43, 45, 47, 48, 50, 38, 36, 53 };
        for (int i = 0; i < 80; ++i) evs.push_back({ 1000 + int64_t(i) * 48, notes[i % 16], 0.9f });
        DrumBus bus;
        std::unique_ptr<WorshipDrumsEngine> engp(new WorshipDrumsEngine()); WorshipDrumsEngine& eng = *engp; eng.prepare(SR, 512); eng.setSettings(DrumSettings{}); eng.prepare(SR, 512);
        Out o = renderEvents(SR, int64_t(4 * SR), evs, 512, nullptr, &bus, &eng);
        std::vector<char> nearHit(o.l.size(), 0);
        for (const auto& e : evs) for (int64_t k = 0; k < 144; ++k) if (e.at + k < int64_t(o.l.size())) nearHit[size_t(e.at + k)] = 1;
        const double md = clickRatio(o, nearHit);
        check(finiteAll(o) && peakOf(o) < 0.9801, "sin NaN y pico < 0.98", fmt("pico=%.3f", peakOf(o)));
        check(kPolyphony >= 32, "polifonia >= 32", fmt("%.0f", kPolyphony));
        check(md < 12.0, "sin clics por robo/solape (paso/RMS local < 12)", fmt("%.2f", md));
    }

    std::printf("== 10. CPU a 48 kHz ==\n");
    {
        // 10 s del groove con hasta ~16 voces
        std::vector<Ev> evs;
        const double beat = 60.0 / 100.0;
        Rng r; r.seed(5);
        for (int i = 0; i < 16 * 4; ++i) {
            const double t = i * beat * 0.25;
            const int64_t at = int64_t(t * SR);
            if (i % 4 == 0) evs.push_back({ at, 36, 0.9f });
            if (i % 8 == 4) evs.push_back({ at, 38, 0.95f });
            evs.push_back({ at, (i % 8 == 6) ? 46 : 42, 0.6f });
            if (i % 16 == 0) evs.push_back({ at, 49, 0.9f });
            if (i % 5 == 0) evs.push_back({ at + 100, 41 + 2 * (i % 3), 0.8f });
            if (i % 4 == 2) evs.push_back({ at, 51, 0.5f });
        }
        const double secs = 12.0;
        double cpu = 1e9;
        for (int rep = 0; rep < 3; ++rep) {
            const double t0 = threadCpuSeconds();
            DrumBus bus;
            Out o = renderEvents(SR, int64_t(secs * SR), evs, 512, nullptr, &bus);
            cpu = std::min(cpu, (threadCpuSeconds() - t0) / secs * 100.0);
        }
        std::printf("  groove denso, %.0f s de audio: CPU = %.2f %% de un nucleo (tiempo de hilo, minimo de 3)\n", secs, cpu);
        check(cpu < 5.0, "CPU groove denso < 5 % de un nucleo", fmt("%.2f %%", cpu));
        // 16 voces simultaneas sostenidas (platos y toms con colas largas)
        {
            std::vector<Ev> v16;
            const int n16[] = { 49, 57, 51, 59, 55, 52, 46, 53, 41, 43, 45, 47, 48, 50, 36, 38 };
            for (int i = 0; i < 16; ++i) v16.push_back({ 100 + int64_t(i) * 48, n16[i], 0.9f });
            double c16 = 1e9;
            for (int rep = 0; rep < 3; ++rep) {
                const double t0 = threadCpuSeconds();
                Out w = renderEvents(SR, int64_t(3 * SR), v16, 512);
                c16 = std::min(c16, (threadCpuSeconds() - t0) / 3.0 * 100.0);
            }
            std::printf("  16 voces simultaneas (3 s): CPU = %.2f %% de un nucleo\n", c16);
            check(c16 < 5.0, "CPU con 16 voces < 5 % de un nucleo", fmt("%.2f %%", c16));
        }
        // peor caso: 40 voces
        std::vector<Ev> st;
        const int notes[] = { 49, 57, 51, 59, 55, 52, 46, 53, 49, 57 };
        for (int i = 0; i < 40; ++i) st.push_back({ 100 + int64_t(i) * 480, notes[i % 10], 0.9f });
        const double s0 = threadCpuSeconds();
        Out w = renderEvents(SR, int64_t(4 * SR), st, 512);
        const double s1 = threadCpuSeconds();
        std::printf("  estres 40 voces de platos, 4 s: CPU = %.2f %% de un nucleo (pico %.3f)\n", (s1 - s0) / 4.0 * 100.0, peakOf(w));
    }

    std::printf("== 11. Groove de worship (8 compases, 72 BPM) -> %s ==\n", wavPath);
    {
        const double bpm = 72.0, beat = 60.0 / bpm, step = beat / 4.0;   // semicorcheas
        Rng r; r.seed(20260);
        std::vector<Ev> evs;
        auto add = [&](int bar, double stepIdx, int note, double vel) {
            const double t = (bar * 16 + stepIdx) * step + r.bi() * 0.0025;   // micro-timing humano +-2.5 ms
            const double v = std::min(1.0, std::max(0.05, vel + r.bi() * 0.05));
            evs.push_back({ int64_t(std::max(0.0, t) * SR) + 480, note, float(v) });
        };
        for (int bar = 0; bar < 8; ++bar) {
            const bool verse = bar < 4;
            if (bar == 0 || bar == 4) add(bar, 0, 49, 0.95);             // crash
            // bombo: 1, 1.5(a), 3 con empuje
            add(bar, 0, 36, 0.92); add(bar, 6, 36, 0.62); add(bar, 8, 36, 0.85);
            if (bar % 2 == 1) add(bar, 14, 36, 0.7);
            // caja 2 y 4 + ghost notes
            add(bar, 4, verse ? 38 : 40, verse ? 0.85 : 0.95); add(bar, 12, verse ? 38 : 40, verse ? 0.88 : 0.97);
            add(bar, 7, 38, 0.18); add(bar, 10, 38, 0.22); add(bar, 15, 38, 0.2);
            if (verse) {   // hi-hat 8vos con abierto en el "y" del 4
                for (int s = 0; s < 16; s += 2) {
                    if (s == 14) add(bar, s, 46, 0.75);
                    else add(bar, s, 42, (s % 4 == 0) ? 0.72 : 0.5);
                }
                if (bar % 2 == 1) add(bar, 15.5, 44, 0.5);
            } else {       // coro: ride + crash
                for (int s = 0; s < 16; s += 2) add(bar, s, 51, (s % 4 == 0) ? 0.7 : 0.5);
                if (bar == 5) add(bar, 8, 53, 0.7);
            }
            if (bar == 3) {   // fill de toms con crash final en 5
                add(bar, 12, 38, 0.8); add(bar, 13, 50, 0.8); add(bar, 14, 48, 0.85); add(bar, 14.5, 47, 0.85); add(bar, 15, 45, 0.9); add(bar, 15.5, 43, 0.95);
            }
            if (bar == 7) {   // fill largo + final
                add(bar, 8, 50, 0.7); add(bar, 9, 48, 0.75); add(bar, 10, 47, 0.8); add(bar, 11, 45, 0.85); add(bar, 12, 43, 0.9);
                add(bar, 13, 41, 0.95); add(bar, 14, 38, 0.9); add(bar, 14.5, 38, 0.95); add(bar, 15, 36, 1.0); add(bar, 15, 49, 1.0);
            }
            if (bar == 2) add(bar, 8, 55, 0.7);     // splash
            if (bar == 6) add(bar, 8, 52, 0.7);     // china
        }
        add(8, 0, 49, 1.0); add(8, 0, 36, 1.0); add(8, 0, 38, 1.0);
        const int64_t total = int64_t((8 * 16 * step + 6.0) * SR) + 480;
        DrumSettings s; s.roomBlend = 0.45;
        DrumBus bus;
        const double t0 = threadCpuSeconds();
        Out o = renderEvents(SR, total, evs, 512, &s, &bus);
        const double t1 = threadCpuSeconds();
        const double secs = double(total) / SR;
        double dc = 0, sumsq = 0;
        for (size_t i = 0; i < o.l.size(); ++i) { dc += 0.5 * (o.l[i] + o.r[i]); sumsq += 0.5 * (double(o.l[i]) * o.l[i] + double(o.r[i]) * o.r[i]); }
        dc /= double(o.l.size());
        // clics: paso máximo fuera de los 4 ms posteriores a un ataque (todos los ataques de la partitura)
        std::vector<char> nearHit(o.l.size(), 0);
        for (const auto& e : evs) for (int64_t k = 0; k < 288; ++k) if (e.at + k < int64_t(o.l.size())) nearHit[size_t(e.at + k)] = 1;
        const double md = clickRatio(o, nearHit);
        double stepAbs = 0; for (size_t i = 1; i < o.l.size(); ++i) if (!nearHit[i]) stepAbs = std::max(stepAbs, double(std::fabs(o.l[i] - o.l[i - 1])));
        std::printf("  duracion %.1f s, %zu golpes, pico %.3f, RMS %.1f dBFS, DC %.2e, paso max fuera de ataques %.4f\n", secs, evs.size(), peakOf(o), db(std::sqrt(sumsq / double(o.l.size()))), dc, md);
        std::printf("  CPU del groove: %.2f %% de un nucleo\n", (t1 - t0) / secs * 100.0);
        check(finiteAll(o), "groove sin NaN/inf");
        check(peakOf(o) < 0.9801 && peakOf(o) > 0.3, "pico del groove 0.3..0.98", fmt("%.3f", peakOf(o)));
        check(std::fabs(dc) < 2e-3 * std::sqrt(sumsq / double(o.l.size())), "sin DC (|media| < 0.2 % del RMS)", fmt("%.2e", dc));
        check(md < 12.0, "sin clics fuera de los ataques (paso/RMS local < 12)", fmt("%.2f", md));
        writeWav24(wavPath, o, 48000);
    }

    std::printf("== 12. Parametros v2 (modelada): ids estables, defaults de acustica natural, sin NaN a 44,1-192 kHz ==\n");
    {
        const auto& defs = paramDefs();
        size_t propios = 0; for (const auto& d : defs) if (d.id < JasWaveFx::kBase) ++propios;   // los ids >= 100 son del FX Rack comun (seccion [7])
        bool seq = propios == 23;
        for (size_t i = 0; i < propios; ++i) seq = seq && defs[i].id == i;
        check(seq && defs[kCloseLevel].id == 15 && defs[kAmbLevel].id == 16, "23 parametros, ids contiguos; Close/Ambient mic level (15, 16) y cuerpo/pegada de caja y toms (17..22) al final");
        check(defs[kKickTune].defV == kKickRefHz, "kick_tune por defecto = fundamental natural de la muestra", fmt("%.1f Hz", defs[kKickTune].defV));
        check(defs[kTape].defV <= 8.0 && defs[kBusComp].defV <= 20.0, "saturacion de cinta <= 8 % y compresion paralela <= 20 % por defecto");
        check(defs[kSmooth].defV <= 50.0 && defs[kRoomBlend].defV >= 40.0, "suavizado de platos moderado y room generoso por defecto");
        DrumSettings d;
        check(d.kickTuneHz == kKickRefHz && d.tape <= 0.08 && d.busComp <= 0.20 && d.closeDb == 0.0 && d.ambDb == 0.0, "DrumSettings por defecto coherentes con los parametros");
        // los parametros nuevos no tocan el motor modelado en su valor por defecto y no producen NaN con valores extremos
        bool ok = true;
        for (double sr : { 44100.0, 96000.0, 192000.0 }) for (int blk : { 1, 480, 4096 }) {
            DrumSettings x; x.closeDb = 6.0; x.ambDb = -12.0;
            std::vector<Ev> evs; const int ns[] = { 36, 38, 42, 46, 41, 49 };
            for (int i = 0; i < 6; ++i) evs.push_back({ int64_t(i * 0.07 * sr), ns[i], 0.8f });
            Out o = renderEvents(sr, int64_t((sr > 100000.0 ? 1.0 : 2.0) * sr), evs, blk, &x);
            ok = ok && finiteAll(o) && peakOf(o) < 0.9801;
        }
        check(ok, "sin NaN y pico < 0.98 con 44,1/96/192 kHz y bloques 1/480/4096");
    }

    testFxRack(false);
    std::printf("\n%s (%d fallos)\n", g_fail ? "FALLO" : "TODO OK", g_fail);
    return g_fail ? 1 : 0;
}
