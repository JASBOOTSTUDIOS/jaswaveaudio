// Prueba de render del Electric Bass (solo incluye el DSP, sin VST3 ni UI).
//   JasWaveElectricBass_rendertest <salida.wav>
// Mide: afinación por nota E1..G4 (cents), pico, RMS, CPU, timbre vs velocidad, compresor, drive,
// shelving de graves, legato, bend, clics, DC y robustez (frecuencias de muestreo y tamaños de bloque).
// Escribe un WAV 24-bit/48 kHz estéreo con una línea de bajo worship en D (8 compases). Sale con código != 0 si algo falla.
#include "electric_bass_dsp.h"

#include <chrono>
#include <complex>
#include <cstdio>
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace JasWaveElectricBass;

// Umbrales del carácter «bajo profundo de worship» (ver medirProfundo)
// Muestras: centroide < 130 Hz, sub 40-100 Hz > -12 dB del total, redonda de 8 s sin caer más de 24 dB entre 0,5 y 7 s, sin apagón
// (> -3,5 dB por 0,5 s), sin pulsos del empalme (rizado < 1,2 dB), ataque sin clic (> 1,5 kHz < -20 dB bajo los graves).
static constexpr double kMaxCentroideHz = 130.0, kMinSubDb = -12.0, kMaxCaidaDb = -24.0, kMaxSaltoDb = -3.5, kMaxClicDb = -20.0, kMinSubidaMs = 5.0, kMaxRizadoDb = 1.2;
// Modelado (respaldo sin banco): más tolerante
static constexpr double kMaxCentroideModHz = 140.0, kMinSubModDb = -9.0, kMaxCaidaModDb = -28.0, kMaxClicModDb = -6.0;

static int g_fail = 0;
static void check(bool ok, const char* what) {
    if (!ok) { ++g_fail; std::printf("  [FALLO] %s\n", what); }
}

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
static std::vector<double> magSpectrum(const std::vector<double>& x, int start, int len, size_t nfft) {
    std::vector<std::complex<double>> a(nfft, {0, 0});
    for (int i = 0; i < len && start + i < static_cast<int>(x.size()); ++i)
        a[static_cast<size_t>(i)] = x[static_cast<size_t>(start + i)] * (0.5 - 0.5 * std::cos(2.0 * kPi * i / (len - 1)));
    fft(a);
    std::vector<double> m(nfft / 2);
    for (size_t i = 0; i < m.size(); ++i) m[i] = std::abs(a[i]);
    return m;
}
static double measureHz(const std::vector<double>& x, int start, int len, double sr, double expect) {
    size_t nfft = 1; while (nfft < sr * 5.5) nfft <<= 1;
    const auto m = magSpectrum(x, start, len, nfft);
    const double binHz = sr / static_cast<double>(nfft);
    const size_t lo = static_cast<size_t>(expect * 0.95 / binHz), hi = static_cast<size_t>(expect * 1.05 / binHz);
    size_t best = lo;
    for (size_t i = lo; i <= hi; ++i) if (m[i] > m[best]) best = i;
    const double a = std::log(m[best - 1] + 1e-30), b = std::log(m[best] + 1e-30), c = std::log(m[best + 1] + 1e-30);
    const double d = 0.5 * (a - c) / (a - 2 * b + c);
    return (static_cast<double>(best) + d) * binHz;
}
static double cents(double f, double ref) { return 1200.0 * std::log2(f / ref); }
static double centroid(const std::vector<double>& x, int start, int len, double sr) {
    const auto m = magSpectrum(x, start, len, 16384);
    double num = 0, den = 0;
    for (size_t i = 1; i < m.size(); ++i) { const double f = i * sr / 16384.0; num += f * m[i] * m[i]; den += m[i] * m[i]; }
    return den > 0 ? num / den : 0;
}
static double bandDb(const std::vector<double>& x, int start, int len, double sr, double f0, double f1) {
    const auto m = magSpectrum(x, start, len, 32768);
    double e = 0;
    for (size_t i = 0; i < m.size(); ++i) { const double f = i * sr / 32768.0; if (f >= f0 && f <= f1) e += m[i] * m[i]; }
    return 10.0 * std::log10(e + 1e-30);
}

struct Ev { double beat, dur; int note; float vel; };

// Renderiza una lista de eventos (con precisión de muestra) en bloques de `block`
static void renderEvents(BassEngine& eng, const std::vector<Ev>& evs, double bpm, double sr, double tailSec,
                         std::vector<double>& L, std::vector<double>& R, int block = 256) {
    struct E { long long at; bool on; int note; float vel; };
    std::vector<E> list;
    const double spb = 60.0 / bpm * sr;
    long long endAt = 0;
    for (const auto& e : evs) {
        const long long a = static_cast<long long>(e.beat * spb), b = static_cast<long long>((e.beat + e.dur) * spb);
        list.push_back({ a, true, e.note, e.vel });
        list.push_back({ b, false, e.note, 0 });
        endAt = std::max(endAt, b);
    }
    std::stable_sort(list.begin(), list.end(), [](const E& x, const E& y) { return x.at < y.at; });
    const long long total = endAt + static_cast<long long>(tailSec * sr);
    L.assign(static_cast<size_t>(total), 0.0); R.assign(static_cast<size_t>(total), 0.0);
    std::vector<float> bl(static_cast<size_t>(block)), br(static_cast<size_t>(block));
    size_t ei = 0;
    long long pos = 0;
    while (pos < total) {
        const int n = static_cast<int>(std::min<long long>(block, total - pos));
        int done = 0;
        while (done < n) {
            while (ei < list.size() && list[ei].at <= pos + done) {
                if (list[ei].on) eng.noteOn(list[ei].note, list[ei].vel); else eng.noteOff(list[ei].note);
                ++ei;
            }
            int seg = n - done;
            if (ei < list.size() && list[ei].at < pos + n) seg = static_cast<int>(list[ei].at - (pos + done));
            if (seg <= 0) seg = 1;
            eng.render(bl.data() + done, br.data() + done, seg, nullptr);
            done += seg;
        }
        for (int i = 0; i < n; ++i) { L[static_cast<size_t>(pos + i)] = bl[static_cast<size_t>(i)]; R[static_cast<size_t>(pos + i)] = br[static_cast<size_t>(i)]; }
        pos += n;
    }
}

static std::vector<double> renderNote(BassEngine& eng, int note, float vel, double secs, double sr) {
    eng.reset();
    std::vector<double> L, R;
    renderEvents(eng, { { 0.0, secs * 2.0, note, vel } }, 60.0, sr, 0.0, L, R);   // 1 beat = 1 s -> dur = secs*2 beats -> recorta
    L.resize(static_cast<size_t>(secs * sr));
    return L;
}

static void writeWav24(const char* path, const std::vector<double>& L, const std::vector<double>& R, int sr) {
    FILE* f = std::fopen(path, "wb");
    if (!f) { std::printf("No se pudo escribir %s\n", path); ++g_fail; return; }
    const uint32_t n = static_cast<uint32_t>(L.size()), dataLen = n * 6u;
    auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); w32(36 + dataLen); std::fwrite("WAVEfmt ", 1, 8, f);
    w32(16); w16(1); w16(2); w32(static_cast<uint32_t>(sr)); w32(static_cast<uint32_t>(sr) * 6u); w16(6); w16(24);
    std::fwrite("data", 1, 4, f); w32(dataLen);
    for (uint32_t i = 0; i < n; ++i) {
        for (int c = 0; c < 2; ++c) {
            const double v = std::max(-1.0, std::min(1.0, c == 0 ? L[i] : R[i]));
            const int32_t q = static_cast<int32_t>(std::lrint(v * 8388607.0));
            const uint8_t b[3] = { static_cast<uint8_t>(q & 0xFF), static_cast<uint8_t>((q >> 8) & 0xFF), static_cast<uint8_t>((q >> 16) & 0xFF) };
            std::fwrite(b, 1, 3, f);
        }
    }
    std::fclose(f);
}

static double peakOf(const std::vector<double>& x, size_t a = 0, size_t b = SIZE_MAX) {
    double p = 0; b = std::min(b, x.size());
    for (size_t i = a; i < b; ++i) p = std::max(p, std::fabs(x[i]));
    return p;
}
static double rmsOf(const std::vector<double>& x, size_t a, size_t b) {
    double s = 0; b = std::min(b, x.size());
    for (size_t i = a; i < b; ++i) s += x[i] * x[i];
    return std::sqrt(s / std::max<size_t>(1, b - a));
}
static bool finiteAll(const std::vector<double>& x) { for (double v : x) if (!std::isfinite(v)) return false; return true; }
static const char* noteName(int n) {
    static const char* nm[] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
    static char buf[8][8]; static int k = 0; k = (k + 1) & 7;
    std::snprintf(buf[k], 8, "%s%d", nm[n % 12], n / 12 - 1);
    return buf[k];
}

// ------------------------------------------------------------------ camino de muestras reales
// Necesita electric-bass.jws (dedo) y electric-bass-pick.jws (púa) en la carpeta de samples.
static std::unique_ptr<BassEngine> makeSampled(double sr, const BassSettings& st) {
    auto e = std::make_unique<BassEngine>();
    e->prepare(sr, 256);
    e->setSettings(st);
    e->prepare(sr, 256);
    for (int i = 0; i < 2000 && !e->samplerReady() && e->samplerLoading(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    for (int i = 0; i < 300 && e->samplerLoading(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    return e;
}
static double dbf(double x) { return 20.0 * std::log10(std::max(x, 1e-9)); }

// ------------------------------------------------------------------ carácter «bajo profundo de worship»
// Mide con un render de nota larga (redonda de 8 s a 60 BPM): centroide bajo, energía del sub 40-100 Hz frente al total,
// sostenido (la nota no se apaga a los 2-5 s) y ataque sin clic. Se aplica al camino de muestras y al modelado.
struct PerfilProfundo { double centroideHz, subDb, caidaDb, saltoMaxDb, clicDb, subidaMs, centroTardeHz, rizadoDb; };
static PerfilProfundo medirProfundo(const std::vector<double>& x, double sr, int note) {
    PerfilProfundo p{};
    const int i0 = static_cast<int>(0.20 * sr);
    p.centroideHz = centroid(x, i0, 16384, sr);
    // energía 40-100 Hz respecto a la banda completa 20 Hz - 20 kHz (dB; 0 = toda la energía en el sub)
    p.subDb = bandDb(x, i0, 16384, sr, 40.0, 100.0) - bandDb(x, i0, 16384, sr, 20.0, 20000.0);
    // sostenido: RMS 0.4 s en 0.5 s vs 7.0 s; mayor salto entre ventanas consecutivas de 0.5 s (apagón brusco)
    auto win = [&](double t) { return dbf(rmsOf(x, static_cast<size_t>(t * sr), static_cast<size_t>((t + 0.4) * sr))); };
    p.caidaDb = win(7.0) - win(0.5);
    double prev = win(0.5), worst = 0.0;
    for (double t = 1.0; t <= 7.0; t += 0.5) { const double w = win(t); worst = std::min(worst, w - prev); prev = w; }
    p.saltoMaxDb = worst;
    // rizado: desviación máx. (dB) de la envolvente (ventanas de 40 ms entre 3 y 7 s) respecto a su recta de regresión;
    // un empalme de bucle mal hecho late con la longitud del bucle
    {
        std::vector<double> ts, ds;
        for (double t = 3.0; t < 7.0; t += 0.04) { ts.push_back(t); ds.push_back(dbf(rmsOf(x, static_cast<size_t>(t * sr), static_cast<size_t>((t + 0.04) * sr)))); }
        double mt = 0, md = 0; for (size_t i = 0; i < ts.size(); ++i) { mt += ts[i]; md += ds[i]; }
        mt /= ts.size(); md /= ds.size();
        double num = 0, den = 0; for (size_t i = 0; i < ts.size(); ++i) { num += (ts[i] - mt) * (ds[i] - md); den += (ts[i] - mt) * (ts[i] - mt); }
        const double m = num / std::max(den, 1e-12);
        double worstR = 0; for (size_t i = 0; i < ts.size(); ++i) worstR = std::max(worstR, std::fabs(ds[i] - (md + m * (ts[i] - mt))));
        p.rizadoDb = worstR;
        if (std::getenv("JW_DEBUG_ENV")) { std::printf("   env %s:", noteName(note)); for (size_t i = 0; i < ts.size() && i < 80; ++i) std::printf(" %.1f", ds[i] - (md + m * (ts[i] - mt))); std::printf("\n"); }
    }
    // timbre tardío (centroide a los 6 s): no debe volverse metálico ni cambiar mucho respecto al inicio
    p.centroTardeHz = centroid(x, static_cast<int>(6.0 * sr), 16384, sr);
    // ataque: contenido > 1.5 kHz en los primeros 15 ms frente al sub (clic); tiempo de subida al 90 % del pico de 100 ms
    const int a0 = 0, aN = static_cast<int>(0.015 * sr);
    p.clicDb = bandDb(x, a0, aN, sr, 1500.0, 12000.0) - bandDb(x, a0, aN, sr, 30.0, 300.0);
    double pk = 0; for (int i = 0; i < static_cast<int>(0.15 * sr); ++i) pk = std::max(pk, std::fabs(x[static_cast<size_t>(i)]));
    int ir = 0; for (int i = 0; i < static_cast<int>(0.15 * sr); ++i) if (std::fabs(x[static_cast<size_t>(i)]) >= 0.9 * pk) { ir = i; break; }
    p.subidaMs = 1000.0 * ir / sr;
    std::printf("  %-4s centroide %6.1f Hz | 40-100 Hz/total %5.1f dB | 0.5s->7s %6.1f dB (salto máx. %5.1f dB/0.5 s) | centroide 6 s %6.1f Hz | clic >1.5k %6.1f dB | subida %.1f ms | rizado %.2f dB\n",
                noteName(note), p.centroideHz, p.subDb, p.caidaDb, p.saltoMaxDb, p.centroTardeHz, p.clicDb, p.subidaMs, p.rizadoDb);
    return p;
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
static double db(double v) { return 20.0 * std::log10(std::max(v, 1e-12)); }
struct Xor {   // generador xorshift32 determinista para ruido de prueba
    uint32_t s{0x2545F491u};
    void seed(uint32_t v) { s = v ? v : 0x9E3779B9u; for (int i = 0; i < 4; ++i) u32(); }
    uint32_t u32() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    double uni() { return u32() * (1.0 / 4294967296.0); }
    double bi() { return uni() * 2.0 - 1.0; }
};

// Hash FNV-1a de un render determinista (frase con legato, fantasma y doble cuerda; 6 s + cola) para la neutralidad del FX Rack
static uint64_t hashRenderBajo(BassEngine& e, int block = 256) {
    const float F = 0.85f, M = 0.70f, G = 0.11f;
    const std::vector<Ev> line = {
        { 0.0, 0.45, 38, F }, { 0.5, 0.2, 38, G }, { 1.0, 0.45, 38, M }, { 2.0, 0.45, 50, F }, { 2.5, 0.45, 45, M }, { 3.0, 0.7, 40, M },
        { 3.5, 0.3, 41, M }, { 3.75, 0.3, 43, M }, { 4.0, 0.9, 33, F }, { 4.0, 0.9, 45, 0.45f }, { 5.0, 0.5, 28, F },
    };
    std::vector<double> L, R;
    renderEvents(e, line, 92.0, 48000.0, 1.5, L, R, block);
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < L.size(); ++i) {
        uint64_t a, b; std::memcpy(&a, &L[i], 8); std::memcpy(&b, &R[i], 8);
        h = (h ^ a) * 1099511628211ull; h = (h ^ b) * 1099511628211ull;
    }
    return h;
}

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
        std::printf("    parametros propios del bajo: %d (ids 0..%d contiguos, sin colision con >= %u)\n", propios, propios - 1, kBase);
        CHECK(propios == 20 && sinColision, "los 20 parametros propios del bajo cambiaron (%d)", propios);
    }

    // ---- 7.1 neutralidad bit a bit en el motor (rack apagado == salida previa del plugin) ----
    {
        // hashes de referencia tomados ANTES de integrar el rack (hashRenderBajo: frase con legato, fantasma y doble cuerda)
        const uint64_t golden = conSamples ? 0x6a16983c70bdbf1bull : 0x7cfb169bf0bdbf1bull;
        BassSettings s;
        auto e0 = makeSampled(SR, s);
        CHECK(e0->samplerReady() == conSamples, "estado del banco de muestras inesperado (%d)", e0->samplerReady() ? 1 : 0);
        const uint64_t h0 = hashRenderBajo(*e0);
        // con valores de rack ajustados pero TODOS los bloques apagados
        auto e1 = makeSampled(SR, s);
        FxParams p = porDefecto();
        for (int b = 0; b < kBands; ++b) { p.eq[b].gainDb = 12.0; p.eq[b].hz *= 1.3; }
        p.compThreshDb = -50; p.compRatio = 20; p.satDrive = 1.0; p.dlTimeMs = 100; p.rvMix = 1.0; p.outWidth = 2.0; p.outGainDb = 12.0;
        e1->setFx(p); e1->setTempo(100.0);
        const uint64_t h1 = hashRenderBajo(*e1, 77);   // otro tamano de bloque: tambien identico al hash de 256? (se compara con su propia referencia abajo)
        auto e1b = makeSampled(SR, s);
        e1b->setFx(p);
        const uint64_t h1b = hashRenderBajo(*e1b);
        std::printf("    hash sin rack=0x%016llx, rack apagado con valores extremos=0x%016llx (referencia 0x%016llx)\n",
                    static_cast<unsigned long long>(h0), static_cast<unsigned long long>(h1b), static_cast<unsigned long long>(golden));
        CHECK(h0 == golden, "el rack apagado cambia el sonido por defecto del plugin");
        CHECK(h1b == golden, "el rack con bloques apagados cambia el sonido");
        (void)h1;
        // y encendido SI cambia
        auto e2 = makeSampled(SR, s);
        FxParams q = porDefecto(); q.eqOn = true; q.eq[2].gainDb = 9.0; q.dlOn = true; q.rvOn = true; q.compOn = true; q.satOn = true; q.chOn = true; q.outOn = true;
        e2->setFx(q);
        CHECK(hashRenderBajo(*e2) != golden, "el rack encendido no cambia nada");
    }

    // ---- 7.11 motor: con todo encendido sigue siendo finito y acotado; el GR del compresor del rack llega al bus ----
    {
        auto e = makeSampled(SR, BassSettings{});
        FxParams q = porDefecto(); q.hpfOn = q.eqOn = q.compOn = q.satOn = q.chOn = q.dlOn = q.rvOn = q.outOn = true;
        q.eq[1].gainDb = 8.0; q.outGainDb = -6.0; q.compThreshDb = -40.0; q.compRatio = 8.0;
        e->setFx(q);
        BassBus bus;
        const size_t N = static_cast<size_t>(6 * SR);
        std::vector<float> L(512), R(512);
        e->noteOn(40, 0.9f); e->noteOn(52, 0.8f);
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
}

static int sampledTest(const char* wavPath) {
    const double SR = 48000.0;
    std::printf("== JasWave Electric Bass - prueba del banco de muestras ==\n");
    BassSettings def;
    auto e = makeSampled(SR, def);
    check(e->samplerReady(), "el banco electric-bass.jws no se cargó (carpeta de samples)");
    if (!e->samplerReady()) { std::printf("RESULTADO: %d FALLO(S)\n", g_fail); return 1; }

    auto nota = [&](const BassSettings& s, int note, float vel, double dur) {
        auto eng = makeSampled(SR, s);
        std::vector<double> L, R;
        renderEvents(*eng, { { 0.0, dur, note, vel } }, 60.0, SR, 3.5, L, R);
        return L;
    };
    // 1) niveles por nota a vel 0.7, colas y NaN
    std::printf("[niveles] vel 0.7, ajustes por defecto, cadena completa\n");
    double worstLo = 1e9, worstHi = -1e9;
    for (int n : { 28, 31, 33, 36, 40, 43, 45, 50, 55, 60, 64, 67 }) {
        const auto x = nota(def, n, 0.7f, 1.5);
        check(finiteAll(x), "NaN/inf en nota sampleada");
        const double pk = peakOf(x), cola = peakOf(x, x.size() - 2000);
        std::printf("  %-4s pico %6.1f dBFS | RMS 0.15-0.35 s %6.1f dBFS | cola final %7.1f dBFS\n", noteName(n), dbf(pk), dbf(rmsOf(x, 7200, 16800)), dbf(cola));
        worstLo = std::min(worstLo, dbf(pk)); worstHi = std::max(worstHi, dbf(pk));
        check(dbf(pk) > -20.0 && dbf(pk) < -3.0, "pico fuera de -20..-3 dBFS a vel 0.7");
        check(cola < 1.0e-3, "la cola no termina en silencio");
    }
    std::printf("  rango de picos entre notas: %.1f .. %.1f dBFS (dispersión %.1f dB)\n", worstLo, worstHi, worstHi - worstLo);
    check(worstHi - worstLo < 7.0, "niveles poco homogéneos entre notas (> 7 dB)");

    // 1b) cuerpo en el registro agudo: RMS en la parte sostenida (0.6-1.0 s) y fundamental
    std::printf("[cuerpo] vel 0.7: RMS 0.15-0.35 s | RMS 0.6-1.0 s | caida\n");
    {
        double rmsAgudo = 0;
        for (int n : { 40, 46, 50, 55, 60, 64, 67 }) {
            const auto x = nota(def, n, 0.7f, 1.5);
            const double a1 = dbf(rmsOf(x, 7200, 16800)), a2 = dbf(rmsOf(x, 28800, 48000));
            std::printf("  %-4s %6.1f dBFS | %6.1f dBFS | %5.1f dB\n", noteName(n), a1, a2, a2 - a1);
            if (n >= 55) rmsAgudo += a2;
            check(a2 > -48.0, "registro agudo sin cuerpo en la parte sostenida");
        }
        std::printf("  media sostenida 55..67: %.1f dBFS\n", rmsAgudo / 4.0);
        check(rmsAgudo / 4.0 > -33.0, "el registro agudo perdió cuerpo (media sostenida < -33 dBFS)");
    }
    // 1c) bajo profundo de worship: redonda de 8 s (centroide bajo, sub 40-100 Hz, sostenido, ataque sin clic)
    std::printf("[profundo] redonda de 8 s, vel 0.7, ajustes por defecto\n");
    {
        for (int n : { 31, 33, 38, 40 }) {
            auto eng = makeSampled(SR, def);
            std::vector<double> L, R;
            renderEvents(*eng, { { 0.0, 8.0, n, 0.7f } }, 60.0, SR, 1.5, L, R);
            check(finiteAll(L), "NaN en la redonda");
            const auto p = medirProfundo(L, SR, n);
            check(p.centroideHz < kMaxCentroideHz, "bajo no profundo: centroide demasiado alto");
            check(p.subDb > kMinSubDb, "poca energía de sub 40-100 Hz frente al total");
            check(p.caidaDb > kMaxCaidaDb, "la redonda se apaga: cae demasiado entre 0.5 s y 7 s");
            check(p.saltoMaxDb > kMaxSaltoDb, "apagón brusco en la redonda (hueco de nivel entre ventanas)");
            check(p.centroTardeHz < kMaxCentroideHz * 1.3 && p.centroTardeHz > 0.0, "el timbre tardío de la redonda se vuelve agudo/metálico");
            check(p.clicDb < kMaxClicDb, "clic en el ataque (> 1.5 kHz respecto a graves)");
            check(p.subidaMs > kMinSubidaMs, "ataque demasiado abrupto (subida < min ms)");
            check(p.rizadoDb < kMaxRizadoDb, "la redonda late: el empalme del bucle de cola se oye (rizado de envolvente)");
            double dmax = 0; for (size_t i = 1; i < L.size(); ++i) dmax = std::max(dmax, std::fabs(L[i] - L[i - 1]));
            check(dmax < 0.12, "salto de muestra grande (clic) en la redonda");
        }
    }
    // 1d) registro agudo «de juguete»: la muestra transpuesta muy arriba adelgaza; se mide el centroide y el cuerpo (<400 Hz)
    std::printf("[registro agudo] vel 0.7: centroide 0.15-0.5 s respecto a la fundamental (cuanto más cerca de 1, más sinusoidal/fino)\n");
    for (int n : { 46, 52, 58, 64, 67 }) {
        const auto x = nota(def, n, 0.7f, 1.2);
        const double c = centroid(x, 7200, 16384, SR);
        const double f0 = BassEngine::noteHz(n);
        std::printf("  %-4s f0 %6.1f Hz | centroide %6.1f Hz (x%.1f f0)\n", noteName(n), f0, c, c / f0);
        check(c < 3.0 * f0 + 80.0, "registro agudo: demasiado brillante/fino (suena a juguete)");
    }
    // 2) dinámica pp -> ff
    {
        const auto pp = nota(def, 40, 0.2f, 1.5), ff = nota(def, 40, 0.95f, 1.5);
        const double a = dbf(rmsOf(pp, 7200, 16800)), b = dbf(rmsOf(ff, 7200, 16800));
        const double c0 = bandDb(pp, 480, 14400, SR, 800, 6000) - bandDb(pp, 480, 14400, SR, 40, 300);
        const double c1 = bandDb(ff, 480, 14400, SR, 800, 6000) - bandDb(ff, 480, 14400, SR, 40, 300);
        std::printf("[dinámica] pp %.1f dBFS, ff %.1f dBFS -> %.1f dB; brillo (0.8-6 kHz vs graves) pp %.1f dB, ff %.1f dB\n", a, b, b - a, c0, c1);
        check(b - a >= 8.0, "dinámica pp->ff < 8 dB");
        check(c1 > c0 + 1.0, "el timbre no se abre con la velocidad");
    }
    // 3) dos golpes iguales no idénticos
    {
        auto eng = makeSampled(SR, def);
        std::vector<double> L, R;
        renderEvents(*eng, { { 0.0, 0.7, 40, 0.7f }, { 1.0, 0.7, 40, 0.7f } }, 60.0, SR, 1.0, L, R);
        const size_t i1 = static_cast<size_t>(1.0 * SR);
        double dif = 0, ref = 0;
        for (size_t i = 0; i < 12000; ++i) { dif += std::fabs(L[i] - L[i1 + i]); ref += std::fabs(L[i]); }
        std::printf("[humanización] diferencia relativa entre dos golpes iguales: %.1f %%\n", 100.0 * dif / std::max(ref, 1e-9));
        check(dif / std::max(ref, 1e-9) > 0.02, "dos golpes idénticos: suena a ametralladora");
    }
    // 4) dedo vs púa (FINGER ATTACK) y monofonía
    {
        BassSettings a = def, b = def; a.fingerAttack = 0.0; b.fingerAttack = 1.0;
        const double c0 = centroid(nota(a, 40, 0.8f, 1.0), 0, 4800, SR), c1 = centroid(nota(b, 40, 0.8f, 1.0), 0, 4800, SR);
        std::printf("[dedo/púa] centroide 0-100 ms: dedo %.0f Hz, púa %.0f Hz\n", c0, c1);
        check(c1 > c0 * 1.1, "FINGER ATTACK no abre el timbre hacia la púa");
        auto eng = makeSampled(SR, def);
        std::vector<double> L, R;
        renderEvents(*eng, { { 0.0, 2.0, 38, 0.8f }, { 1.0, 1.0, 43, 0.8f } }, 60.0, SR, 1.0, L, R);   // la 2ª corta a la 1ª
        const double antes = rmsOf(L, static_cast<size_t>(0.9 * SR), static_cast<size_t>(0.98 * SR));
        const double desp = rmsOf(L, static_cast<size_t>(1.25 * SR), static_cast<size_t>(1.4 * SR));
        const double f = measureHz(L, static_cast<int>(1.15 * SR), 36000, SR, BassEngine::noteHz(43));
        std::printf("[monofonía] G2 sobre D2 sujeta: afinación %.2f Hz (%+.1f cents); RMS antes %.4f, después %.4f\n", f, cents(f, BassEngine::noteHz(43)), antes, desp);
        check(std::fabs(cents(f, BassEngine::noteHz(43))) < 40.0, "la nota nueva no domina (el bajo no es monofónico)");
        // ghost note: corta y apagada
        const auto g = nota(def, 38, 0.12f, 1.5);
        std::printf("[ghost] vel 0.12: RMS 0-0.1 s %.1f dBFS, RMS 0.3-0.4 s %.1f dBFS\n", dbf(rmsOf(g, 0, 4800)), dbf(rmsOf(g, 14400, 19200)));
        check(rmsOf(g, 14400, 19200) < rmsOf(g, 0, 4800) * 0.1, "la nota fantasma no es seca");
    }
    // 5) bloques distintos / ajustes extremos sin NaN
    {
        bool fin = true;
        for (int blk : { 1, 64, 1000 }) {
            auto eng = makeSampled(SR, def);
            std::vector<double> L, R;
            renderEvents(*eng, { { 0, 1, 40, 0.8f }, { 0.5, 1, 52, 0.6f }, { 1.2, 0.6, 33, 0.9f }, { 1.3, 0.6, 33, 0.9f } }, 120.0, SR, 0.5, L, R, blk);
            fin = fin && finiteAll(L);
        }
        BassSettings x = def; x.drive = 1.0; x.tone = 0.0; x.compMix = 1.0; x.mute = 1.0; x.sustain = 1.0; x.fingerAttack = 1.0; x.bendSt = 2.0;
        const auto ex = nota(x, 45, 1.0f, 1.0);
        fin = fin && finiteAll(ex) && peakOf(ex) < 0.99;
        check(fin, "NaN o saturación con ajustes extremos / bloques");
    }
    // 6) frase de bajo -> WAV
    {
        auto eng = makeSampled(SR, def);
        const float F = 0.85f, M = 0.70f, S = 0.58f, G = 0.11f;
        const std::vector<Ev> line = {
            { 0.0, 0.45, 38, F }, { 0.5, 0.2, 38, G }, { 1.0, 0.45, 38, M }, { 2.0, 0.45, 50, F }, { 2.5, 0.45, 45, S }, { 3.0, 0.7, 38, M },
            { 4.0, 0.9, 38, F }, { 5.5, 0.45, 42, S }, { 6.0, 0.55, 45, M }, { 6.5, 0.55, 47, M }, { 7.0, 0.95, 50, F },
            { 8.0, 0.45, 33, F }, { 8.5, 0.45, 33, M }, { 9.0, 0.2, 33, G }, { 10.0, 0.45, 40, M }, { 10.5, 0.45, 45, S }, { 11.0, 0.45, 43, M }, { 11.5, 0.45, 40, S },
            { 12.0, 0.9, 33, F }, { 13.0, 0.3, 40, M }, { 13.25, 0.3, 41, M }, { 13.5, 0.3, 42, M }, { 13.75, 0.3, 43, M }, { 14.0, 1.9, 45, F },
            { 16.0, 0.45, 35, F }, { 16.5, 0.2, 35, G }, { 17.0, 0.45, 35, M }, { 17.5, 0.45, 47, S }, { 18.0, 0.45, 42, M }, { 18.5, 0.2, 42, G }, { 19.0, 0.45, 45, M }, { 19.5, 0.45, 47, S },
            { 20.0, 0.9, 35, F }, { 21.5, 0.45, 38, M }, { 22.0, 0.55, 42, M }, { 22.5, 0.55, 40, M }, { 23.0, 0.9, 38, F },
            { 24.0, 0.45, 31, F }, { 24.5, 0.45, 31, M }, { 25.0, 0.2, 31, G }, { 25.5, 0.45, 43, S }, { 26.0, 0.55, 35, M }, { 26.5, 0.55, 38, M }, { 27.0, 0.95, 43, F },
            { 28.0, 0.45, 38, F }, { 28.5, 0.45, 38, M }, { 29.0, 0.2, 38, G }, { 30.0, 0.3, 43, M }, { 30.25, 0.3, 42, M }, { 30.5, 0.3, 41, M }, { 30.75, 0.3, 40, M }, { 31.0, 0.9, 38, F },
        };
        std::vector<double> L, R;
        renderEvents(*eng, line, 92.0, SR, 3.0, L, R);
        double dmax = 0; for (size_t i = 1; i < L.size(); ++i) dmax = std::max(dmax, std::fabs(L[i] - L[i - 1]));
        std::printf("[frase] pico %.1f dBFS, RMS %.1f dBFS, derivada máx. %.4f\n", dbf(peakOf(L)), dbf(rmsOf(L, 0, L.size())), dmax);
        check(finiteAll(L) && peakOf(L) > 0.1 && peakOf(L) < 0.98, "pico de la frase fuera de rango");
        check(dmax < 0.35, "clic en la frase");
        writeWav24(wavPath, L, R, 48000);
        std::printf("  WAV: %s\n", wavPath);
    }
    testFxRack(true);
    std::printf(g_fail ? "\nRESULTADO: %d FALLO(S)\n" : "\nRESULTADO: TODO OK\n", g_fail);
    return g_fail ? 1 : 0;
}

int main(int argc, char** argv) {
    const bool conSamples = (argc > 1 && std::strcmp(argv[argc - 1], "--samples") == 0);
    if (argc > 1 && std::strcmp(argv[1], "--hash") == 0) {   // utilidad: imprime el hash de referencia (modelado o con --samples)
        JasWaveDsp::ScopedNoDenormals nd0;
        if (!(argc > 2 && std::strcmp(argv[2], "--samples") == 0)) _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
        BassSettings s0;
        auto e = makeSampled(48000.0, s0);
        std::printf("samplerReady=%d hash=0x%016llx\n", e->samplerReady() ? 1 : 0, static_cast<unsigned long long>(hashRenderBajo(*e)));
        return 0;
    }
    const char* wavPath = argc > 1 && std::strncmp(argv[1], "--", 2) != 0 ? argv[1] : (conSamples ? "electric-bass-samples.wav" : "electric-bass-worship-d.wav");
    JasWaveDsp::ScopedNoDenormals nd;
    if (conSamples) return sampledTest(wavPath);
    // La suite modelada comprueba el respaldo sin banco: se aparta la carpeta de samples.
#ifdef _WIN32
    _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
#endif
    auto eng = std::make_unique<BassEngine>();
    const double SR = 48000.0;
    eng->prepare(SR, 256);
    BassSettings def;
    eng->setSettings(def);

    // ---------------------------------------------------------------- 1) afinación E1..G4
    std::printf("== Afinación por nota (48 kHz, vel 0.8, ajustes por defecto, cadena completa) ==\n");
    std::printf(" nota   esperada(Hz)  medida(Hz)   error(cents)  pico    RMS(0-0.5s)\n");
    double worst = 0, sumAbs = 0; int cnt = 0, nanBad = 0;
    for (int note = 28; note <= 67; ++note) {
        const auto x = renderNote(*eng, note, 0.8f, 1.6, SR);
        if (!finiteAll(x)) ++nanBad;
        const double exp = BassEngine::noteHz(note);
        const double f = measureHz(x, static_cast<int>(0.15 * SR), 60000, SR, exp);
        const double c = cents(f, exp);
        worst = std::max(worst, std::fabs(c)); sumAbs += std::fabs(c); ++cnt;
        std::printf(" %-4s   %9.3f   %9.3f   %+8.2f      %.3f   %.4f\n", noteName(note), exp, f, c, peakOf(x), rmsOf(x, 0, static_cast<size_t>(0.5 * SR)));
    }
    std::printf("Error máximo |cents| = %.2f, medio = %.2f\n", worst, sumAbs / cnt);
    check(worst < 5.0, "afinación: error > 5 cents");
    check(nanBad == 0, "NaN/inf en notas sueltas");

    // afinación con otros ajustes extremos (Tone, Drive, Damping, Mute, P/J) y velocidades
    {
        double w2 = 0;
        const double sets[4][6] = { { 0.0, 1.0, 1.0, 1.0, 0.0, 1.0 }, { 1.0, 0.0, 0.0, 0.0, 1.0, 0.0 }, { 0.5, 0.5, 0.5, 0.5, 0.5, 0.5 }, { 0.2, 0.9, 0.8, 0.0, 0.3, 0.7 } };
        for (const auto& sv : sets) {
            BassSettings s = def;
            s.tone = sv[0]; s.fingerAttack = sv[1]; s.drive = sv[2]; s.sustain = sv[3]; s.mute = sv[4] * 0.6; s.pickupMix = sv[5];
            eng->setSettings(s); eng->prepare(SR, 256); eng->setSettings(s);
            for (int note : { 28, 33, 40, 47, 55, 62, 67 }) {
                for (float vel : { 0.3f, 1.0f }) {
                    const auto x = renderNote(*eng, note, vel, 1.2, SR);
                    if (!finiteAll(x)) ++nanBad;
                    if (sv[4] * 0.6 > 0.4) continue;   // con mute fuerte la nota apenas dura
                    const double exp = BassEngine::noteHz(note);
                    const double f = measureHz(x, static_cast<int>(0.10 * SR), 40000, SR, exp);
                    w2 = std::max(w2, std::fabs(cents(f, exp)));
                }
            }
        }
        std::printf("Error máximo con ajustes extremos y vel 0.3/1.0 = %.2f cents\n", w2);
        check(w2 < 5.0, "afinación con ajustes extremos > 5 cents");
        eng->setSettings(def); eng->prepare(SR, 256); eng->setSettings(def);
    }

    // ---------------------------------------------------------------- 2) frecuencias de muestreo y bloques
    std::printf("== Robustez: frecuencias de muestreo y tamaños de bloque ==\n");
    for (double sr : { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 }) {
        auto e = std::make_unique<BassEngine>();
        e->prepare(sr, 4096);
        e->setSettings(def);
        double w = 0; bool fin = true;
        for (int note : { 28, 36, 45, 55, 67 }) {
            const auto x = renderNote(*e, note, 0.8f, 1.5, sr);
            fin = fin && finiteAll(x);
            const double exp = BassEngine::noteHz(note);
            w = std::max(w, std::fabs(cents(measureHz(x, static_cast<int>(0.15 * sr), static_cast<int>(1.0 * sr), sr, exp), exp)));
        }
        std::printf("  %8.0f Hz: error máx = %.2f cents, pico fin=%s\n", sr, w, fin ? "OK" : "NaN");
        check(fin, "NaN a otras frecuencias de muestreo");
        check(w < 5.0, "afinación > 5 cents a otra frecuencia de muestreo");
    }
    {
        std::vector<double> ref;
        bool allSame = true;
        const std::vector<Ev> evs = { { 0, 1, 40, 0.8f }, { 0.5, 1, 52, 0.6f }, { 1.2, 0.6, 33, 0.9f } };
        for (int block : { 1, 7, 64, 256, 1000, 4096 }) {
            eng->reset();
            std::vector<double> L, R;
            renderEvents(*eng, evs, 120.0, SR, 0.5, L, R, block);
            if (!finiteAll(L)) { allSame = false; std::printf("  bloque %d: NaN\n", block); }
            if (ref.empty()) ref = L;
            else {
                double md = 0; const size_t n = std::min(ref.size(), L.size());
                for (size_t i = 0; i < n; ++i) md = std::max(md, std::fabs(ref[i] - L[i]));
                std::printf("  bloque %4d: diferencia máx. respecto a bloque 1 = %.2e\n", block, md);
                if (md > 1e-3) allSame = false;
            }
        }
        check(allSame, "resultado dependiente del tamaño de bloque o NaN");
    }

    // ---------------------------------------------------------------- 3) timbre vs velocidad
    std::printf("== Timbre vs velocidad (A1, centroide espectral 20-300 ms) ==\n");
    double cen[3];
    {
        int i = 0;
        for (float vel : { 0.25f, 0.6f, 1.0f }) {
            const auto x = renderNote(*eng, 33, vel, 0.6, SR);
            cen[i] = centroid(x, static_cast<int>(0.02 * SR), 14400, SR);
            std::printf("  vel %.2f: centroide %.1f Hz, pico %.3f, RMS %.4f\n", vel, cen[i], peakOf(x), rmsOf(x, 0, 24000));
            ++i;
        }
        check(cen[2] > cen[0] * 1.05, "el timbre no cambia con la velocidad");
    }
    {
        const auto x = renderNote(*eng, 33, 0.8f, 1.0, SR);
        const auto m = magSpectrum(x, 2400, 32768, 65536);
        std::printf("  armónicos de A1 (55 Hz, vel 0.8) en dB relativos al fundamental:");
        double ref = 0;
        for (int h = 1; h <= 8; ++h) {
            const size_t c = static_cast<size_t>(55.0 * h / (SR / 65536.0));
            double mx = 0; for (size_t i = c - 6; i <= c + 6; ++i) mx = std::max(mx, m[i]);
            if (h == 1) ref = mx;
            std::printf(" %.1f", 20 * std::log10(mx / ref));
        }
        std::printf("\n");
    }
    std::printf("== ATTACK (vel 0.8, A1): centroide 0-60 ms ==\n");
    {
        double c0, c1;
        BassSettings s = def; s.fingerAttack = 0.0; eng->setSettings(s);
        c0 = centroid(renderNote(*eng, 33, 0.8f, 0.4, SR), 0, 2880, SR);
        s.fingerAttack = 1.0; eng->setSettings(s);
        c1 = centroid(renderNote(*eng, 33, 0.8f, 0.4, SR), 0, 2880, SR);
        std::printf("  attack 0%%: %.1f Hz, attack 100%%: %.1f Hz\n", c0, c1);
        check(c1 > c0, "ATTACK no aumenta el brillo del transitorio");
        eng->setSettings(def);
    }

    // ---------------------------------------------------------------- 4) cadena: compresor, drive, graves, tone, mute, sustain
    std::printf("== Cadena ==\n");
    {
        // compresor paralelo: diferencia de nivel entre la nota fuerte (vel 1.0) y la suave (vel 0.35), misma altura
        const std::vector<Ev> phr = { { 0, 1, 38, 1.0f }, { 1, 1, 38, 0.35f } };
        double rng[2];
        int k = 0;
        for (double mixv : { 0.0, 1.0 }) {
            BassSettings s = def; s.compMix = mixv; s.drive = 0.0; eng->setSettings(s); eng->prepare(SR, 256); eng->setSettings(s); eng->reset();
            std::vector<double> L, R; renderEvents(*eng, phr, 120.0, SR, 0.5, L, R);
            const double rl = rmsOf(L, 4800, 12000), rs = rmsOf(L, 24000 + 4800, 24000 + 12000);
            rng[k] = 20 * std::log10(rl / rs);
            std::printf("  compresor mix %3.0f%%: pico %.3f, RMS fuerte %.4f, RMS suave %.4f, diferencia %.2f dB\n", mixv * 100, peakOf(L), rl, rs, rng[k]);
            ++k;
        }
        check(rng[1] < rng[0] - 2.5, "el compresor no reduce el rango dinámico");   // con los graves realzados por defecto las dos notas ya compriman
        // drive: RMS y contenido de armónicos
        double r[3]; int j = 0;
        for (double d : { 0.0, 0.5, 1.0 }) {
            BassSettings s = def; s.drive = d; s.compMix = 0.0; eng->setSettings(s); eng->prepare(SR, 256); eng->setSettings(s);
            const auto x = renderNote(*eng, 40, 0.8f, 1.0, SR);
            r[j] = rmsOf(x, 4800, 36000);
            const double h1 = bandDb(x, 4800, 30000, SR, 75, 90), h2 = bandDb(x, 4800, 30000, SR, 150, 175), h3 = bandDb(x, 4800, 30000, SR, 235, 250);
            std::printf("  drive %3.0f%%: RMS %.4f, fund %.1f dB, 2a %.1f dB, 3a %.1f dB (relativo)\n", d * 100, r[j], h1, h2 - h1, h3 - h1);
            ++j;
        }
        check(std::fabs(20 * std::log10(r[2] / r[0])) < 6.0, "drive cambia el nivel RMS más de 6 dB");
        // low boost: shelving (afecta graves, no el rango medio)
        double lowDb[2], midDb[2]; j = 0;
        for (double lb : { 0.0, 12.0 }) {
            BassSettings s = def; s.lowBoostDb = lb; s.drive = 0.0; s.compMix = 0.0; eng->setSettings(s); eng->prepare(SR, 256); eng->setSettings(s);
            const auto x = renderNote(*eng, 28, 0.35f, 1.0, SR);   // E1 (nivel bajo: sin soft-clip)
            lowDb[j] = bandDb(x, 4800, 30000, SR, 38, 45);
            midDb[j] = bandDb(x, 0, 12000, SR, 400, 3000);
            ++j;
        }
        std::printf("  low_boost 0->12 dB: fundamental E1 %+.2f dB, banda 0.4-3 kHz %+.2f dB\n", lowDb[1] - lowDb[0], midDb[1] - midDb[0]);
        check(lowDb[1] - lowDb[0] > 8.0 && lowDb[1] - lowDb[0] < 13.0, "low_boost no realza ~12 dB en graves");
        check(std::fabs(midDb[1] - midDb[0]) < 1.5, "low_boost afecta la banda media (no es shelving)");
        // tone: tilt
        double tl[2], th[2]; j = 0;
        for (double tn : { 0.0, 1.0 }) {
            BassSettings s = def; s.tone = tn; s.drive = 0.0; s.compMix = 0.0; eng->setSettings(s); eng->prepare(SR, 256); eng->setSettings(s);
            const auto x = renderNote(*eng, 40, 0.4f, 0.6, SR);
            tl[j] = bandDb(x, 0, 14400, SR, 60, 120); th[j] = bandDb(x, 0, 14400, SR, 1000, 5000); ++j;
        }
        std::printf("  tone 0->100: graves %+.2f dB, agudos %+.2f dB (tilt)\n", tl[1] - tl[0], th[1] - th[0]);
        check((th[1] - th[0]) > (tl[1] - tl[0]) + 6.0, "tone no inclina el espectro");
        // pickup P/J
        double pj[2]; j = 0;
        for (double pmx : { 0.0, 1.0 }) {
            BassSettings s = def; s.pickupMix = pmx; s.drive = 0.0; eng->setSettings(s); eng->prepare(SR, 256); eng->setSettings(s);
            const auto x = renderNote(*eng, 45, 0.8f, 0.6, SR);
            pj[j++] = centroid(x, 1000, 14400, SR);
        }
        std::printf("  pastilla P -> J: centroide %.1f -> %.1f Hz\n", pj[0], pj[1]);
        check(pj[1] != pj[0], "P/J no cambia el timbre");
        // sustain y palm mute: nivel a 1.0 s respecto a 0.1 s
        double dec[3]; j = 0;
        for (int mode = 0; mode < 3; ++mode) {
            BassSettings s = def; s.drive = 0.0; s.compMix = 0.0;
            if (mode == 1) s.mute = 0.8;
            if (mode == 2) s.sustain = 1.0;
            eng->setSettings(s); eng->prepare(SR, 256); eng->setSettings(s);
            const auto x = renderNote(*eng, 40, 0.8f, 2.0, SR);
            dec[j++] = 20 * std::log10(rmsOf(x, 48000, 52800) / rmsOf(x, 4800, 9600));
        }
        std::printf("  caída 0.1s->1.0s: normal %.1f dB, palm-mute %.1f dB, sustain 100%% %.1f dB\n", dec[0], dec[1], dec[2]);
        check(dec[1] < dec[0] - 3.0, "palm mute no acorta la nota");
        check(dec[2] > dec[0], "sustain no alarga la nota");
        eng->setSettings(def); eng->prepare(SR, 256); eng->setSettings(def);
    }

    // ---------------------------------------------------------------- 5) ghost, release, bend, legato
    std::printf("== Ghost / release / bend / legato ==\n");
    {
        const auto g = renderNote(*eng, 38, 0.12f, 0.6, SR);
        const auto n = renderNote(*eng, 38, 0.85f, 0.6, SR);
        std::printf("  ghost (vel 0.12): pico %.3f, RMS 0-0.5s %.4f; normal: pico %.3f; duración ghost (RMS 0.25-0.35 s / 0-0.1 s) %.1f dB\n",
                    peakOf(g), rmsOf(g, 0, 24000), peakOf(n), 20 * std::log10(rmsOf(g, 12000, 16800) / rmsOf(g, 0, 4800)));
        check(peakOf(g) < peakOf(n) * 0.5 && peakOf(g) > 0.003, "ghost no es notablemente más débil / audible");
        // release: apagado sin cortar de golpe
        eng->reset();
        std::vector<double> L, R;
        renderEvents(*eng, { { 0, 1.0, 40, 0.8f } }, 60.0, SR, 1.0, L, R);
        const size_t off = static_cast<size_t>(1.0 * SR);
        const double a0 = rmsOf(L, off - 2400, off), a1 = rmsOf(L, off + 2400, off + 4800), a2 = rmsOf(L, off + 24000, off + 26400);
        double maxStep = 0; for (size_t i = off - 4; i < off + 20000; ++i) maxStep = std::max(maxStep, std::fabs(L[i + 1] - L[i]));
        std::printf("  release: RMS antes %.4f, +50ms %.4f, +500ms %.5f (%.1f dB/0.5s); paso máx. %.4f\n", a0, a1, a2, 20 * std::log10(a2 / a0), maxStep);
        check(a1 < a0 * 0.9 && a1 > a0 * 0.01, "release: no es un apagado gradual (corte o sin apagado)");
        check(a2 < a0 * 0.02, "release: la cuerda no se apaga");
        // bend
        eng->reset();
        eng->noteOn(45, 0.8f);
        std::vector<float> bl(256), br(256);
        for (int i = 0; i < 100; ++i) eng->render(bl.data(), br.data(), 256, nullptr);
        BassSettings sb = def; sb.bendSt = 2.0; eng->setSettings(sb);
        std::vector<double> xb;
        for (int i = 0; i < 400; ++i) { eng->render(bl.data(), br.data(), 256, nullptr); if (i >= 150) for (float v : bl) xb.push_back(v); }
        const double fb = measureHz(xb, 0, 40000, SR, 110.0 * std::pow(2.0, 2.0 / 12.0));
        std::printf("  bend +2 st sobre A2: %.3f Hz (esperado %.3f) = %+.2f cents\n", fb, 110.0 * std::pow(2.0, 2.0 / 12.0), cents(fb, 110.0 * std::pow(2.0, 2.0 / 12.0)));
        check(std::fabs(cents(fb, 110.0 * std::pow(2.0, 2.0 / 12.0))) < 5.0, "pitch bend +2 st impreciso");
        eng->setSettings(def); eng->noteOff(45);
        // legato: hammer-on A2 -> D3 (nota anterior sujeta) debe cambiar el tono sin una nueva voz
        eng->reset();
        std::vector<double> Ll, Rl;
        renderEvents(*eng, { { 0, 1.5, 45, 0.8f }, { 0.8, 1.2, 50, 0.7f } }, 60.0, SR, 0.5, Ll, Rl);
        const double fl1 = measureHz(Ll, static_cast<int>(0.30 * SR), 24000, SR, 110.0);
        const double fl2 = measureHz(Ll, static_cast<int>(1.15 * SR), 24000, SR, 146.83);
        std::printf("  legato A2->D3: antes %.2f Hz (%+.2f c), después %.2f Hz (%+.2f c)\n", fl1, cents(fl1, 110.0), fl2, cents(fl2, 146.832));
        check(std::fabs(cents(fl1, 110.0)) < 5.0 && std::fabs(cents(fl2, 146.832)) < 5.0, "legato: afinación incorrecta");
    }

    // arpegio sujeto (el de la herramienta de capturas): cadena de legato, todas las notas siguen pulsadas
    {
        eng->reset();
        const int notes[] = { 48, 55, 60, 64, 67, 72, 76 };
        std::vector<Ev> arp;
        for (int k = 0; k < 7; ++k) arp.push_back({ k * 0.18, 3.0 - k * 0.18, notes[k], 0.55f + 0.06f * k });
        std::vector<double> La, Ra;
        renderEvents(*eng, arp, 60.0, SR, 0.2, La, Ra);
        std::printf("== Arpegio sujeto (legato encadenado): RMS por 0.5 s:");
        double minRms = 1e9;
        for (int k = 0; k < 6; ++k) { const double r = rmsOf(La, static_cast<size_t>(k * 0.5 * SR), static_cast<size_t>((k + 1) * 0.5 * SR)); std::printf(" %.4f", r); if (k < 3) minRms = std::min(minRms, r); }
        std::printf("\n");
        check(minRms > 0.005, "arpegio sujeto: la voz en legato se queda muda");
    }

    // ---------------------------------------------------------------- 5b) bajo profundo de worship (modelado)
    std::printf("== Bajo profundo (modelado): redonda de 8 s, vel 0.7, ajustes por defecto ==\n");
    {
        eng->setSettings(def); eng->prepare(SR, 256); eng->setSettings(def);
        for (int n : { 31, 33, 38, 40 }) {
            eng->reset();
            std::vector<double> Lp, Rp;
            renderEvents(*eng, { { 0.0, 8.0, n, 0.7f } }, 60.0, SR, 1.5, Lp, Rp);
            check(finiteAll(Lp), "NaN en la redonda modelada");
            const auto p = medirProfundo(Lp, SR, n);
            check(p.centroideHz < kMaxCentroideModHz, "modelado: centroide demasiado alto");
            check(p.subDb > kMinSubModDb, "modelado: poca energía de sub 40-100 Hz");
            check(p.caidaDb > kMaxCaidaModDb, "modelado: la redonda se apaga");
            check(p.saltoMaxDb > kMaxSaltoDb, "modelado: apagón brusco");
            check(p.clicDb < kMaxClicModDb, "modelado: clic en el ataque");
        }
    }

    // ---------------------------------------------------------------- 6) línea de bajo worship en D
    std::printf("== Línea de bajo worship en D (8 compases, 92 BPM) ==\n");
    std::vector<double> L, R;
    {
        // D2=38 E2=40 F#2=42 G2=43 A2=45 B2=47 D3=50 | A1=33 B1=35 G1=31 E1=28
        const float F = 0.85f, M = 0.70f, S = 0.58f, G = 0.11f;
        std::vector<Ev> line = {
            // c1 (D): corcheas, nota fantasma y octava
            { 0.0, 0.45, 38, F }, { 0.5, 0.2, 38, G }, { 1.0, 0.45, 38, M }, { 2.0, 0.45, 50, F }, { 2.5, 0.45, 45, S }, { 3.0, 0.7, 38, M },
            // c2 (D): silencio en 4.5 y subida por hammer-ons hacia el compás de A
            { 4.0, 0.9, 38, F }, { 5.5, 0.45, 42, S }, { 6.0, 0.55, 45, M }, { 6.5, 0.55, 47, M }, { 7.0, 0.95, 50, F },
            // c3 (A): raíz, fantasmas y quinta
            { 8.0, 0.45, 33, F }, { 8.5, 0.45, 33, M }, { 9.0, 0.2, 33, G }, { 10.0, 0.45, 40, M }, { 10.5, 0.45, 45, S }, { 11.0, 0.45, 43, M }, { 11.5, 0.45, 40, S },
            // c4 (A): deslizamiento cromático ascendente (legato) y nota larga
            { 12.0, 0.9, 33, F }, { 13.0, 0.3, 40, M }, { 13.25, 0.3, 41, M }, { 13.5, 0.3, 42, M }, { 13.75, 0.3, 43, M }, { 14.0, 1.9, 45, F },
            // c5 (Bm)
            { 16.0, 0.45, 35, F }, { 16.5, 0.2, 35, G }, { 17.0, 0.45, 35, M }, { 17.5, 0.45, 47, S }, { 18.0, 0.45, 42, M }, { 18.5, 0.2, 42, G }, { 19.0, 0.45, 45, M }, { 19.5, 0.45, 47, S },
            // c6 (Bm)
            { 20.0, 0.9, 35, F }, { 21.5, 0.45, 38, M }, { 22.0, 0.55, 42, M }, { 22.5, 0.55, 40, M }, { 23.0, 0.9, 38, F },
            // c7 (G): raíz grave, octava, hammer-on a la tercera, silencio
            { 24.0, 0.45, 31, F }, { 24.5, 0.45, 31, M }, { 25.0, 0.2, 31, G }, { 25.5, 0.45, 43, S }, { 26.0, 0.55, 35, M }, { 26.5, 0.55, 38, M }, { 27.0, 0.95, 43, F },
            // c8 (D, cadencia): deslizamiento descendente, final largo
            { 28.0, 0.45, 38, F }, { 28.5, 0.45, 38, M }, { 29.0, 0.2, 38, G }, { 30.0, 0.3, 43, M }, { 30.25, 0.3, 42, M }, { 30.5, 0.3, 41, M }, { 30.75, 0.3, 40, M }, { 31.0, 0.9, 38, F },
            { 31.0, 0.9, 50, 0.45f },   // doble cuerda (D2 + D3 simultáneos)
        };
        double el = 1e30;
        for (int rep = 0; rep < 3; ++rep) {   // el mínimo de 3 pasadas (la máquina puede estar cargada)
            eng->reset();
            const auto t0 = std::chrono::high_resolution_clock::now();
            renderEvents(*eng, line, 92.0, SR, 3.0, L, R);
            const auto t1 = std::chrono::high_resolution_clock::now();
            el = std::min(el, std::chrono::duration<double>(t1 - t0).count());
        }
        const double sec = static_cast<double>(L.size()) / SR;
        double dmax = 0, mean = 0;
        for (size_t i = 1; i < L.size(); ++i) dmax = std::max(dmax, std::fabs(L[i] - L[i - 1]));
        for (double v : L) mean += v;
        mean /= static_cast<double>(L.size());
        std::printf("  duración %.2f s, pico %.4f (%.1f dBFS), RMS %.4f (%.1f dBFS), DC %.2e, derivada máx. %.4f, CPU %.3f%% de un núcleo\n",
                    sec, peakOf(L), 20 * std::log10(peakOf(L)), rmsOf(L, 0, L.size()), 20 * std::log10(rmsOf(L, 0, L.size())), mean, dmax, 100.0 * el / sec);
        check(finiteAll(L), "NaN en la línea de bajo");
        check(peakOf(L) < 0.98, "pico >= 0.98");
        check(peakOf(L) > 0.3, "nivel demasiado bajo");
        check(rmsOf(L, 0, L.size()) > 0.03, "RMS demasiado bajo");
        check(std::fabs(mean) < 0.01, "DC");
        check(dmax < 0.35, "salto máximo entre muestras (clic)");
        check(100.0 * el / sec < 5.0, "CPU > 5 %");
        writeWav24(wavPath, L, R, 48000);
        std::printf("  WAV: %s\n", wavPath);
    }

    // ---------------------------------------------------------------- 7) estrés de CPU: 6 voces + retriggers
    {
        eng->reset();
        std::vector<Ev> st;
        for (int b = 0; b < 40; ++b)
            for (int v = 0; v < 6; ++v) st.push_back({ b * 0.5 + v * 0.01, 0.9, 28 + v * 7 + (b % 3), 0.8f });
        std::vector<double> L2, R2;
        const auto t0 = std::chrono::high_resolution_clock::now();
        renderEvents(*eng, st, 120.0, SR, 1.0, L2, R2);
        const auto t1 = std::chrono::high_resolution_clock::now();
        const double sec = static_cast<double>(L2.size()) / SR, el = std::chrono::duration<double>(t1 - t0).count();
        std::printf("== Estrés 6 voces con robo: %.1f s de audio, CPU %.3f%% de un núcleo, pico %.3f, finito=%s ==\n", sec, 100.0 * el / sec, peakOf(L2), finiteAll(L2) ? "si" : "NO");
        check(finiteAll(L2) && peakOf(L2) < 0.98, "estrés de voces");
        check(100.0 * el / sec < 5.0, "CPU estrés > 5 %");
        double dmax = 0; for (size_t i = 1; i < L2.size(); ++i) dmax = std::max(dmax, std::fabs(L2[i] - L2[i - 1]));
        std::printf("   derivada máx. en estrés (robo con fundido): %.4f\n", dmax);
        check(dmax < 0.5, "clic en robo de voces");
    }

    testFxRack(false);
    std::printf(g_fail ? "\nRESULTADO: %d FALLO(S)\n" : "\nRESULTADO: TODO OK\n", g_fail);
    return g_fail ? 1 : 0;
}
