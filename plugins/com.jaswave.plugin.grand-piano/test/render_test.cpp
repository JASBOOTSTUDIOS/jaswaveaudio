// JasWave Grand Piano - prueba de render offline (sin VST3): mide, no escucha.
//   render_test <salida.wav>     escribe una frase (escala + acordes + pp->ff + pedal) 24-bit/48k estereo
// Imprime f0 por nota vs esperado (cents), pico, RMS, CPU, timbre/dinamica, pedal, estereo, estabilidad en
// 44.1..192 kHz y bloques 1..4096; sale con codigo != 0 si algo falla.
#include "grand_piano_dsp.h"

#include <algorithm>
#include <chrono>
#include <complex>
#include <cstring>
#ifdef _WIN32
#include <windows.h>
#endif
#include <cstdio>
#include <cstdlib>
#include <string>

using namespace JasWaveGrandPiano;

static int g_fail = 0;
static void testFxRack(bool completo);   // [7] FX Rack comun (mas abajo); completo=false: solo definiciones, neutralidad y motor

// Tiempo de CPU del hilo (no de reloj de pared: inmune a la carga de otros procesos)
static double cpuSeconds() {
#ifdef _WIN32
    FILETIME c, e, k, u;
    GetThreadTimes(GetCurrentThread(), &c, &e, &k, &u);
    ULARGE_INTEGER a, b;
    a.LowPart = k.dwLowDateTime; a.HighPart = k.dwHighDateTime;
    b.LowPart = u.dwLowDateTime; b.HighPart = u.dwHighDateTime;
    return static_cast<double>(a.QuadPart + b.QuadPart) * 1.0e-7;
#else
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
#endif
}
#define CHECK(cond, ...) do { if (!(cond)) { ++g_fail; std::printf("  FALLO: "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

struct Stereo { std::vector<double> l, r; };

static GrandSettings defaults() { return GrandSettings{}; }

// Evento programado de la frase
struct Ev { double t; int kind; int note; double v; };   // kind: 0 on, 1 off, 2 pedal(0..1), 3 settings-reverb
static bool isFiniteBuf(const std::vector<double>& x) { for (double v : x) if (!std::isfinite(v)) return false; return true; }

// Renderiza una lista de eventos en bloques de `block` muestras con precision de muestra
static Stereo renderEvents(GrandPianoEngine& e, std::vector<Ev> evs, double seconds, int block, GrandBus* bus = nullptr) {
    const double sr = e.sampleRate();
    const int total = static_cast<int>(seconds * sr);
    std::stable_sort(evs.begin(), evs.end(), [](const Ev& a, const Ev& b) { return a.t < b.t; });
    Stereo o; o.l.assign(static_cast<size_t>(total), 0.0); o.r.assign(static_cast<size_t>(total), 0.0);
    size_t ei = 0;
    int pos = 0;
    while (pos < total) {
        const int n = std::min(block, total - pos);
        int cur = 0;
        while (cur < n) {
            int next = n;
            while (ei < evs.size() && static_cast<int>(evs[ei].t * sr) <= pos + cur) {
                const Ev& ev = evs[ei++];
                if (ev.kind == 0) e.noteOn(ev.note, ev.v);
                else if (ev.kind == 1) e.noteOff(ev.note);
                else if (ev.kind == 2) e.setPedal(ev.v);
            }
            if (ei < evs.size()) next = std::min(n, std::max(cur + 1, static_cast<int>(evs[ei].t * sr) - pos));
            e.render(o.l.data() + pos + cur, o.r.data() + pos + cur, next - cur, bus);
            cur = next;
        }
        pos += n;
    }
    return o;
}

static std::vector<double> mono(const Stereo& s) {
    std::vector<double> m(s.l.size());
    for (size_t i = 0; i < m.size(); ++i) m[i] = 0.5 * (s.l[i] + s.r[i]);
    return m;
}
static double rmsRange(const std::vector<double>& x, size_t a, size_t b) {
    b = std::min(b, x.size());
    if (a >= b) return 0.0;
    double s = 0; for (size_t i = a; i < b; ++i) s += x[i] * x[i];
    return std::sqrt(s / static_cast<double>(b - a));
}
static double db(double x) { return 20.0 * std::log10(std::max(x, 1.0e-9)); }

// YIN (de Cheveigne & Kawahara) con interpolacion parabolica
static double yin(const std::vector<double>& x, size_t start, int W, double sr, double fmin, double fmax) {
    const int tauMin = std::max(2, static_cast<int>(sr / fmax)), tauMax = static_cast<int>(sr / fmin) + 2;
    if (start + static_cast<size_t>(W + tauMax + 2) > x.size()) return 0.0;
    std::vector<double> d(static_cast<size_t>(tauMax + 2), 0.0), c(static_cast<size_t>(tauMax + 2), 1.0);
    for (int tau = 1; tau <= tauMax; ++tau) {
        double s = 0;
        for (int j = 0; j < W; ++j) { const double q = x[start + j] - x[start + j + tau]; s += q * q; }
        d[static_cast<size_t>(tau)] = s;
    }
    double run = 0;
    for (int tau = 1; tau <= tauMax; ++tau) {
        run += d[static_cast<size_t>(tau)];
        c[static_cast<size_t>(tau)] = run > 0 ? d[static_cast<size_t>(tau)] * tau / run : 1.0;
    }
    int best = -1;
    for (int tau = tauMin; tau < tauMax; ++tau) {
        if (c[static_cast<size_t>(tau)] < 0.15) {
            while (tau + 1 < tauMax && c[static_cast<size_t>(tau + 1)] < c[static_cast<size_t>(tau)]) ++tau;
            best = tau; break;
        }
    }
    if (best < 0) {
        double m = 1e9;
        for (int tau = tauMin; tau < tauMax; ++tau) if (c[static_cast<size_t>(tau)] < m) { m = c[static_cast<size_t>(tau)]; best = tau; }
    }
    if (best < 2) return 0.0;
    const double a = c[static_cast<size_t>(best - 1)], b = c[static_cast<size_t>(best)], cc = c[static_cast<size_t>(best + 1)];
    const double den = a - 2.0 * b + cc;
    const double off = std::fabs(den) > 1e-12 ? 0.5 * (a - cc) / den : 0.0;
    return sr / (best + off);
}

// Centroide espectral (Hz) de una ventana de 8192
static double centroid(const std::vector<double>& x, size_t start, double sr) {
    constexpr int L = 13;
    FFT fft(L);
    std::vector<float> re(1 << L), im(1 << L, 0.0f);
    for (int i = 0; i < (1 << L); ++i) {
        const double w = 0.5 - 0.5 * std::cos(2.0 * kPi * i / (1 << L));
        re[static_cast<size_t>(i)] = static_cast<float>((start + i < x.size() ? x[start + i] : 0.0) * w);
    }
    fft.forward(re.data(), im.data());
    double num = 0, den = 0;
    for (int k = 1; k < (1 << (L - 1)); ++k) {
        const double m = std::sqrt(static_cast<double>(re[static_cast<size_t>(k)]) * re[static_cast<size_t>(k)] + static_cast<double>(im[static_cast<size_t>(k)]) * im[static_cast<size_t>(k)]);
        num += m * m * (k * sr / (1 << L)); den += m * m;
    }
    return den > 0 ? num / den : 0.0;
}

static void writeWav24(const char* path, const Stereo& s, int sr) {
    FILE* f = std::fopen(path, "wb");
    if (!f) { std::printf("  no se pudo escribir %s\n", path); ++g_fail; return; }
    const uint32_t frames = static_cast<uint32_t>(s.l.size()), dataBytes = frames * 6;
    auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); w32(36 + dataBytes); std::fwrite("WAVEfmt ", 1, 8, f);
    w32(16); w16(1); w16(2); w32(static_cast<uint32_t>(sr)); w32(static_cast<uint32_t>(sr) * 6); w16(6); w16(24);
    std::fwrite("data", 1, 4, f); w32(dataBytes);
    auto put = [&](double v) {
        const int32_t q = static_cast<int32_t>(std::lround(clampT(v, -1.0, 1.0) * 8388607.0));
        const uint8_t b[3] = { static_cast<uint8_t>(q & 0xFF), static_cast<uint8_t>((q >> 8) & 0xFF), static_cast<uint8_t>((q >> 16) & 0xFF) };
        std::fwrite(b, 1, 3, f);
    };
    for (uint32_t i = 0; i < frames; ++i) { put(s.l[i]); put(s.r[i]); }
    std::fclose(f);
}

static std::unique_ptr<GrandPianoEngine> makeEngine(double sr, const GrandSettings& st) {
    auto e = std::make_unique<GrandPianoEngine>();
    e->prepare(sr, 4096);
    e->setSettings(st);
    e->prepare(sr, 4096);   // vuelve a fijar suavizadores a los valores finales
    // El banco de samples se carga en otro hilo: se espera (hasta 20 s) para probar el camino real.
    for (int i = 0; i < 2000 && !e->samplerReady() && e->samplerLoading(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    return e;
}

static double dbfs(double x) { return 20.0 * std::log10(std::max(x, 1e-9)); }

// =====================================================================================
//  Editor nota a nota: cada propiedad por nota cambia lo medido SOLO en esa nota. Se ejecuta en las dos suites
//  (modelada y con banco de muestras). Los motores recien creados son deterministas (mismo azar de humanizacion,
//  round-robin y jitter), asi que una nota no afectada debe salir IDENTICA bit a bit.
// =====================================================================================
static std::unique_ptr<GrandPianoEngine> makeEngineT(double sr, const GrandSettings& st, const NotaTabla& t) {
    auto e = makeEngine(sr, st);
    e->setNotaTabla(t);
    return e;
}
static GrandSettings seco() { GrandSettings s = defaults(); s.reverbPct = 0; return s; }

struct Espectro { double hz{0}, banda{0}, tilt{0}; };   // tilt: dB de energia 1,2-8 kHz respecto a 80 Hz-1,2 kHz
// Pico de la fundamental (FFT de 32768 con Hann + interpolacion parabolica del log-modulo) y energia en f0 +-3 %
static Espectro espectroF0(const std::vector<double>& x, size_t start, double f0, double sr, double refHz = 0.0) {
    constexpr int L = 15, N = 1 << L;
    static FFT fft(L);
    std::vector<float> re(N), im(N, 0.0f);
    for (int i = 0; i < N; ++i) re[static_cast<size_t>(i)] = static_cast<float>((start + i < x.size() ? x[start + static_cast<size_t>(i)] : 0.0) * (0.5 - 0.5 * std::cos(2.0 * kPi * i / N)));
    fft.forward(re.data(), im.data());
    std::vector<double> mag(N / 2);
    for (int k = 0; k < N / 2; ++k) mag[static_cast<size_t>(k)] = std::sqrt(static_cast<double>(re[static_cast<size_t>(k)]) * re[static_cast<size_t>(k)] + static_cast<double>(im[static_cast<size_t>(k)]) * im[static_cast<size_t>(k)]);
    const int kLo = std::max(2, static_cast<int>(f0 * 0.94 * N / sr)), kHi = std::min(N / 2 - 2, static_cast<int>(f0 * 1.14 * N / sr) + 1);   // 1,14: el C4 del banco esta +100 cents
    int kb = kLo;
    for (int k = kLo; k <= kHi; ++k) if (mag[static_cast<size_t>(k)] > mag[static_cast<size_t>(kb)]) kb = k;
    const double a = std::log(mag[static_cast<size_t>(kb - 1)] + 1e-12), b = std::log(mag[static_cast<size_t>(kb)] + 1e-12), c = std::log(mag[static_cast<size_t>(kb + 1)] + 1e-12);
    const double den = a - 2.0 * b + c, d = std::fabs(den) > 1e-12 ? 0.5 * (a - c) / den : 0.0;
    Espectro e;
    e.hz = (kb + d) * sr / N;
    double en = 0;
    const double fb = refHz > 0.0 ? refHz : e.hz;   // banda de +-3 % alrededor de la fundamental de referencia
    for (int k = static_cast<int>(fb * 0.97 * N / sr); k <= static_cast<int>(fb * 1.03 * N / sr) + 1 && k < N / 2; ++k) en += mag[static_cast<size_t>(k)] * mag[static_cast<size_t>(k)];
    e.banda = 10.0 * std::log10(std::max(en, 1e-30));
    double eLo = 0, eHi = 0;
    for (int k = 1; k < N / 2; ++k) {
        const double f = k * sr / N, q = mag[static_cast<size_t>(k)] * mag[static_cast<size_t>(k)];
        if (f >= 80.0 && f < 1200.0) eLo += q; else if (f >= 1200.0 && f < 8000.0) eHi += q;
    }
    e.tilt = 10.0 * std::log10(std::max(eHi, 1e-30) / std::max(eLo, 1e-30));
    return e;
}

struct Medida {
    Stereo s;
    double lvl{0}, cen{0}, tilt{0}, hz{0}, banda{0}, caida{0}, rel{0}, pk30{0}, lr{0};
};
// Una nota (vel `vel`), note-off a 1.2 s, 3 s de audio, sin sala
static Medida medirNota(const NotaTabla& t, int note, double vel = 0.7, int block = 256, double refHz = 0.0) {
    constexpr double SR = 48000.0;
    auto e = makeEngineT(SR, seco(), t);
    Medida m;
    m.s = renderEvents(*e, { { 0.0, 0, note, vel }, { 1.2, 1, note, 0.0 } }, 3.0, block);
    CHECK(isFiniteBuf(m.s.l) && isFiniteBuf(m.s.r), "NaN/inf (nota %d)", note);
    const auto mo = mono(m.s);
    auto W = [&](double a, double b) { return rmsRange(mo, static_cast<size_t>(a * SR), static_cast<size_t>(b * SR)); };
    const double f0 = 440.0 * std::pow(2.0, (note - 69) / 12.0);
    m.lvl = db(W(0.15, 0.6));
    m.cen = centroid(mo, 4800, SR);
    const Espectro sp = espectroF0(mo, 7200, f0, SR, refHz);
    m.hz = sp.hz; m.banda = sp.banda; m.tilt = sp.tilt;
    m.caida = db(W(0.25, 0.45)) - db(W(0.95, 1.15));       // dB perdidos con la tecla pulsada
    m.rel = db(W(1.0, 1.2)) - db(W(1.4, 1.6));             // dB perdidos tras soltarla
    double pk = 0; for (size_t i = 0; i < static_cast<size_t>(0.03 * SR); ++i) pk = std::max(pk, std::fabs(mo[i]));
    m.pk30 = db(pk) - db(W(0.3, 0.5));                    // transitorio del martillo respecto al cuerpo
    m.lr = db(rmsRange(m.s.r, static_cast<size_t>(0.1 * SR), static_cast<size_t>(0.6 * SR))) - db(rmsRange(m.s.l, static_cast<size_t>(0.1 * SR), static_cast<size_t>(0.6 * SR)));
    return m;
}
static double maxDif(const Stereo& a, const Stereo& b) {
    double d = a.l.size() == b.l.size() ? 0.0 : 1e9;
    for (size_t i = 0; i < std::min(a.l.size(), b.l.size()); ++i) d = std::max({ d, std::fabs(a.l[i] - b.l[i]), std::fabs(a.r[i] - b.r[i]) });
    return d;
}


static void notaSuite(bool conBanco) {
    constexpr double SR = 48000.0;
    constexpr int N0 = 60;                      // nota que se edita
    const int otras[] = { 48, 59, 61, 72 };    // notas que NO deben cambiar (incluye las vecinas)
    std::printf("\n[nota a nota] %s: cada propiedad cambia lo medido solo en C4 (nota %d); %d notas no afectadas deben salir identicas\n",
                conBanco ? "banco de muestras" : "motor modelado", N0, static_cast<int>(sizeof otras / sizeof otras[0]));
    if (conBanco) { auto e = makeEngine(SR, defaults()); CHECK(e->samplerReady(), "el banco no se cargo: la suite de nota a nota mediria el motor modelado"); }
    const NotaTabla neutra;
    const Medida base = medirNota(neutra, N0);
    std::printf("  base C4: nivel %.1f dBFS | centroide %.0f Hz | f0 %.2f Hz | caida %.1f dB | release %.1f dB | martillo %.1f dB | R-L %+.1f dB\n",
                base.lvl, base.cen, base.hz, base.caida, base.rel, base.pk30, base.lr);
    // neutro explicito == sin tabla
    {
        auto e = makeEngine(SR, seco());
        const Stereo s0 = renderEvents(*e, { { 0.0, 0, N0, 0.7 }, { 1.2, 1, N0, 0.0 } }, 3.0, 256);
        CHECK(maxDif(s0, base.s) == 0.0, "la tabla neutra no es identica a no tener tabla");
    }
    std::vector<Medida> baseOtras;
    for (int n : otras) baseOtras.push_back(medirNota(neutra, n));

    auto caso = [&](int prop, double valor) {
        NotaTabla t;
        t.set(N0, prop, valor);
        const Medida m = medirNota(t, N0, 0.7, 256, base.hz);
        // las demas notas no cambian NADA
        double dif = 0;
        for (size_t i = 0; i < baseOtras.size(); ++i) dif = std::max(dif, maxDif(medirNota(t, otras[i]).s, baseOtras[i].s));
        CHECK(dif == 0.0, "%s=%g altera otras notas (dif %g)", notaPropDefs()[prop].name, valor, dif);
        return m;
    };
    auto cents = [&](const Medida& m) { return 1200.0 * std::log2(m.hz / base.hz); };

    { // volumen
        const Medida a = caso(kNpGain, 6.0), b = caso(kNpGain, -6.0);
        std::printf("  gain  +6 dB -> %+.2f dB | -6 dB -> %+.2f dB\n", a.lvl - base.lvl, b.lvl - base.lvl);
        CHECK(std::fabs((a.lvl - base.lvl) - 6.0) < 0.6 && std::fabs((b.lvl - base.lvl) + 6.0) < 0.6, "ganancia por nota fuera de +-0,6 dB");
    }
    { // afinacion
        const Medida a = caso(kNpTune, 30.0), b = caso(kNpTune, -30.0), c = caso(kNpTune, 50.0);
        std::printf("  tune  +30 -> %+.2f cents | -30 -> %+.2f | +50 -> %+.2f (FFT 32768, interpolacion parabolica)\n", cents(a), cents(b), cents(c));
        CHECK(std::fabs(cents(a) - 30.0) < 3.0 && std::fabs(cents(b) + 30.0) < 3.0 && std::fabs(cents(c) - 50.0) < 3.0, "afinacion por nota fuera de +-3 cents");
    }
    { // tono (brillo)
        const Medida a = caso(kNpTone, 80.0), b = caso(kNpTone, -80.0);
        std::printf("  tone  +80 -> agudos %+.2f dB, centroide x%.2f | -80 -> agudos %+.2f dB, centroide x%.2f\n", a.tilt - base.tilt, a.cen / base.cen, b.tilt - base.tilt, b.cen / base.cen);
        CHECK(a.tilt > base.tilt + 5.0 && b.tilt < base.tilt - 5.0 && a.cen > base.cen * 1.08 && b.cen < base.cen * 0.92, "el tono por nota no mueve la energia de agudos / el centroide");
    }
    { // cuerpo
        const Medida a = caso(kNpBody, 100.0), b = caso(kNpBody, -100.0);
        std::printf("  body  +100 -> fundamental %+.2f dB | -100 -> %+.2f dB\n", a.banda - base.banda, b.banda - base.banda);
        CHECK(a.banda - base.banda > 5.0 && a.banda - base.banda < 11.5 && b.banda - base.banda < -4.0, "el cuerpo no realza/recorta la fundamental (+-9 dB)");
    }
    { // decay / sustain
        const Medida a = caso(kNpDecay, 50.0), b = caso(kNpDecay, 200.0);
        std::printf("  decay 50 %% -> pierde %.2f dB (base %.2f) | 200 %% -> %.2f dB\n", a.caida, base.caida, b.caida);
        CHECK(a.caida > base.caida + 0.8 && b.caida < base.caida - 0.4 && a.caida > b.caida + 1.5, "la escala de decay no cambia la caida medida");
    }
    { // release
        const Medida a = caso(kNpRelease, 25.0), b = caso(kNpRelease, 400.0);
        std::printf("  release 25 %% -> pierde %.1f dB tras soltar (base %.1f) | 400 %% -> %.1f dB\n", a.rel, base.rel, b.rel);
        CHECK(a.rel > base.rel + 3.0 && b.rel < base.rel - 1.5, "la escala de release no cambia el apagado medido");
    }
    { // martillo
        const Medida a = caso(kNpHammer, 200.0), b = caso(kNpHammer, 0.0);
        std::printf("  hammer 200 %% -> pico/cuerpo %+.2f dB | 0 %% -> %+.2f dB (base %.1f dB)\n", a.pk30 - base.pk30, b.pk30 - base.pk30, base.pk30);
        CHECK(a.pk30 > base.pk30 + 1.0 && b.pk30 < base.pk30 - 1.0 && a.pk30 > b.pk30 + 4.0, "el nivel del martillo no cambia el transitorio");
    }
    { // paneo
        const Medida a = caso(kNpPan, 100.0), b = caso(kNpPan, -100.0);
        std::printf("  pan   +100 -> R-L %+.2f dB | -100 -> %+.2f dB (base %+.2f)\n", a.lr, b.lr, base.lr);
        CHECK(a.lr > base.lr + 6.0 && b.lr < base.lr - 6.0, "el paneo por nota no mueve el estereo");
    }
    { // curva de velocidad (se mide con vel 0.5)
        const Medida v0 = medirNota(neutra, N0, 0.5);
        NotaTabla ta, tb; ta.set(N0, kNpVelCurve, 100.0); tb.set(N0, kNpVelCurve, -100.0);
        const Medida a = medirNota(ta, N0, 0.5), b = medirNota(tb, N0, 0.5);
        double dif = 0; for (size_t i = 0; i < baseOtras.size(); ++i) dif = std::max(dif, maxDif(medirNota(ta, otras[i], 0.7).s, baseOtras[i].s));
        std::printf("  vel   +100 -> %+.2f dB | -100 -> %+.2f dB a vel 0.5\n", a.lvl - v0.lvl, b.lvl - v0.lvl);
        CHECK(a.lvl < v0.lvl - 3.0 && b.lvl > v0.lvl + 1.5, "la curva de velocidad por nota no cambia el nivel");
        CHECK(dif == 0.0, "la curva de velocidad altera otras notas");
    }

    // ---- presets: valores esperados y efecto medido
    std::printf("  presets de fabrica\n");
    {
        NotaTabla t;
        t.aplicarPreset(0); CHECK(t.esNeutro(), "Concierto no es neutro");
        t.aplicarPreset(1);
        CHECK(t.get(24, kNpBody) > t.get(72, kNpBody) + 30 && t.get(100, kNpTone) < t.get(60, kNpTone) - 30 && t.get(60, kNpRelease) > 110 && t.get(24, kNpRelease) > t.get(72, kNpRelease), "Calido worship: graves llenos, agudos suaves, release largo");
        t.aplicarPreset(2);
        CHECK(t.get(60, kNpHammer) < 70 && t.get(72, kNpTone) < -25, "Intimo: martillo suave y brillo bajo");
        t.aplicarPreset(3);
        CHECK(t.get(72, kNpTone) > 25 && t.get(60, kNpHammer) > 110, "Brillante pop: tono alto y martillo marcado");
        t.aplicarPreset(0); CHECK(t.esNeutro(), "volver a Concierto no restaura la tabla neutra (RESET)");
        for (int k = 1; k <= 3; ++k) {
            NotaTabla p; p.aplicarPreset(k);
            for (int n = kNotaMin; n <= kNotaMax; ++n) for (int q = 0; q < kNpCount; ++q)
                CHECK(p.get(n, q) >= notaPropDefs()[q].mn && p.get(n, q) <= notaPropDefs()[q].mx, "preset %d fuera de rango", k);
            const Medida m = medirNota(p, N0);
            std::printf("    %-15s C4: nivel %+5.1f dB | centroide x%.2f | caida %+5.1f dB | release %+5.1f dB | martillo %+5.1f dB\n",
                        notaPresetLabels()[k], m.lvl - base.lvl, m.cen / base.cen, m.caida - base.caida, m.rel - base.rel, m.pk30 - base.pk30);
            CHECK(maxDif(m.s, base.s) > 1e-4, "el preset %d no cambia el sonido", k);
        }
        NotaTabla w, i2, b3; w.aplicarPreset(1); i2.aplicarPreset(2); b3.aplicarPreset(3);
        const Medida mw = medirNota(w, 84), mi = medirNota(i2, 84), mb = medirNota(b3, 84), m0 = medirNota(neutra, 84);
        CHECK(mw.cen < m0.cen && mi.cen < mw.cen * 1.1 && mb.cen > m0.cen, "orden de brillo de los presets en C6 (calido/intimo < concierto < brillante)");
    }

    // ---- cada nota responde (88 teclas): una ganancia de +3 dB por nota se mide en las 88
    {
        double peor = 0;
        for (int n = kNotaMin; n <= kNotaMax; n += 1) {
            NotaTabla t0, t1; t1.set(n, kNpGain, 3.0);
            auto e0 = makeEngineT(SR, seco(), t0), e1 = makeEngineT(SR, seco(), t1);
            const std::vector<Ev> ev = { { 0.0, 0, n, 0.6 }, { 0.5, 1, n, 0.0 } };
            const auto a = mono(renderEvents(*e0, ev, 0.8, 256)), b = mono(renderEvents(*e1, ev, 0.8, 256));
            const double d = db(rmsRange(b, 2400, 24000)) - db(rmsRange(a, 2400, 24000));
            peor = std::max(peor, std::fabs(d - 3.0));
        }
        std::printf("  88 teclas: +3 dB en cada una -> peor error %.2f dB\n", peor);
        CHECK(peor < 0.5, "alguna tecla no responde a su ganancia (%.2f dB)", peor);
    }

    // ---- ordenes de edicion y sincronizacion de parametros (misma logica que procesador y controlador)
    {
        // orden: ida y vuelta, neutro exacto, invalidas
        for (int p = 0; p < kNpCount; ++p) {
            const NotaPropDef& d = notaPropDefs()[p];
            int n = 0, q = 0; double v = 0;
            CHECK(notaCmdDecodificar(notaCmdCodificar(88, p, d.def), n, q, v) && n == 88 && q == p && v == d.def, "orden neutra de %s no es exacta", d.name);
            for (double f : { 0.0, 0.13, 0.5, 0.77, 1.0 }) {
                const double plain = notaFromNorm(p, f);
                const double cod = notaCmdCodificar(33, p, plain);
                CHECK(cod >= 0.5 && cod < 1.0 && static_cast<double>(static_cast<float>(cod)) == cod, "la orden no cabe exacta en un float");
                CHECK(notaCmdDecodificar(cod, n, q, v) && n == 33 && q == p, "orden mal decodificada");
                CHECK(std::fabs(notaToNorm(p, v) - f) <= 0.5 / 4095.0 + 1e-9, "orden de %s: error de cuantizacion", d.name);
            }
        }
        int n, q; double v;
        CHECK(!notaCmdDecodificar(0.0, n, q, v) && !notaCmdDecodificar(0.3, n, q, v) && !notaCmdDecodificar(std::nan(""), n, q, v), "ordenes invalidas aceptadas");

        NotaSync ns; NotaParams np;
        np.sel = notaSelectNorm(60); np.pre = notaPresetNormDe(0); ns.iniciar(np);
        // 1) editar la nota elegida con Note Gain
        np.prop[kNpGain] = notaToNorm(kNpGain, 4.0);
        CHECK(ns.sincronizar(np) && ns.tabla.get(60, kNpGain) == 4.0f && notaPresetDe(np.pre) == kPresetPersonalizado, "Note Gain no escribe la nota elegida");
        // 2) cambiar Note Select muestra los valores de la otra nota y no toca la tabla
        np.sel = notaSelectNorm(72);
        CHECK(!ns.sincronizar(np) && std::fabs(notaFromNorm(kNpGain, np.prop[kNpGain])) < 1e-9 && ns.sel == 72, "Note Select no muestra la nota nueva");
        np.sel = notaSelectNorm(60); ns.sincronizar(np);
        CHECK(std::fabs(notaFromNorm(kNpGain, np.prop[kNpGain]) - 4.0) < 1e-3, "al volver a C4 no muestra +4 dB");
        // 3) Note Select y Note Tune en la misma tanda: la afinacion es para la nota NUEVA
        np.sel = notaSelectNorm(64); np.prop[kNpTune] = notaToNorm(kNpTune, -20.0);
        ns.sincronizar(np);
        CHECK(std::fabs(ns.tabla.get(64, kNpTune) + 20.0) < 1e-3 && ns.tabla.get(60, kNpTune) == 0.0f, "select+propiedad en la misma tanda se escribe en la nota equivocada");
        // 4) orden de edicion: otra nota, sin tocar la seleccion
        np.cmd = notaCmdCodificar(90, kNpPan, 50.0);
        ns.sincronizar(np);
        CHECK(std::fabs(ns.tabla.get(90, kNpPan) - 50.0) < 0.05 && ns.sel == 64, "Note Edit Cmd no escribe la nota indicada");
        // 5) RESET: el preset pasa a Concierto (0) y la tabla vuelve a neutra; los parametros muestran el neutro
        np.pre = notaPresetNormDe(0);
        ns.sincronizar(np);
        CHECK(ns.tabla.esNeutro() && ns.presetAplicado && std::fabs(notaFromNorm(kNpTune, np.prop[kNpTune])) < 1e-9, "RESET (Note Preset = Concierto) no restaura la tabla");
        // 6) preset de fabrica y edicion posterior -> Personalizado; volver a elegir el preset lo restaura
        np.pre = notaPresetNormDe(1); ns.sincronizar(np);
        CHECK(!ns.tabla.esNeutro() && ns.tabla.get(24, kNpBody) > 40, "Note Preset no aplica el preset");
        np.prop[kNpHammer] = notaToNorm(kNpHammer, 150.0); ns.sincronizar(np);
        CHECK(notaPresetDe(np.pre) == kPresetPersonalizado, "editar un parametro no marca Personalizado");
        np.pre = notaPresetNormDe(1); ns.sincronizar(np);
        CHECK(std::fabs(ns.tabla.get(ns.sel, kNpHammer) - 85.0) < 1e-3, "volver a elegir el preset no restaura la tabla");
        // 7) "Personalizado" elegido a mano no hace nada
        NotaTabla antes = ns.tabla;
        np.pre = notaPresetNormDe(kPresetPersonalizado); ns.sincronizar(np);
        CHECK(ns.tabla == antes, "Personalizado no debe cambiar la tabla");
    }

    // ---- estado: guardar -> restaurar -> mismo render (formato versionado y compatible con estados sin tabla)
    {
        NotaTabla t; t.aplicarPreset(1);
        t.set(60, kNpTune, 17.0); t.set(60, kNpGain, 2.5); t.set(61, kNpDecay, 140.0); t.set(100, kNpPan, -45.0); t.set(21, kNpBody, 80.0);
        std::vector<uint8_t> bytes;
        notaSerializar(t, bytes);
        CHECK(bytes.size() == kTablaCabecera + static_cast<size_t>(kNotas) * kNpCount * 4, "tamano del bloque de estado");
        int n = 0, np = 0;
        CHECK(notaLeerCabecera(bytes.data(), n, np) && n == kNotas && np == kNpCount, "cabecera del bloque de estado");
        NotaTabla r;
        notaDeserializar(bytes.data() + kTablaCabecera, n, np, r);
        CHECK(r == t, "la tabla restaurada no es identica");
        const Medida a = medirNota(t, 60), b = medirNota(r, 60);
        CHECK(maxDif(a.s, b.s) == 0.0, "getState->setState no da el mismo render");
        std::printf("  estado: %zu bytes, restaurado identico, render identico\n", bytes.size());
        // estado antiguo (sin bloque), basura y valores no finitos
        const uint8_t viejo[16] = { 0x20, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
        CHECK(!notaLeerCabecera(viejo, n, np), "un estado antiguo se tomo por tabla");
        std::vector<uint8_t> mal = bytes;
        const float nanf = std::nanf(""), enorme = 1.0e9f;
        std::memcpy(mal.data() + kTablaCabecera, &nanf, 4);
        std::memcpy(mal.data() + kTablaCabecera + 4, &enorme, 4);
        NotaTabla m;
        notaDeserializar(mal.data() + kTablaCabecera, kNotas, kNpCount, m);
        CHECK(m.get(21, kNpGain) == 0.0f && m.get(21, kNpTune) == 50.0f, "valores no finitos / fuera de rango sin sanear");
    }

    // ---- estabilidad con la tabla al limite: tasas 44,1..192 kHz x bloques 1..4096, sin NaN
    {
        NotaTabla ex;
        for (int n = kNotaMin; n <= kNotaMax; ++n) {
            const bool a = (n & 1) != 0;
            ex.set(n, kNpGain, a ? 12.0 : -12.0); ex.set(n, kNpTune, a ? 50.0 : -50.0); ex.set(n, kNpTone, a ? 100.0 : -100.0);
            ex.set(n, kNpBody, a ? 100.0 : -100.0); ex.set(n, kNpDecay, a ? 400.0 : 25.0); ex.set(n, kNpRelease, a ? 400.0 : 25.0);
            ex.set(n, kNpHammer, a ? 200.0 : 0.0); ex.set(n, kNpPan, a ? 100.0 : -100.0); ex.set(n, kNpVelCurve, a ? 100.0 : -100.0);
        }
        std::vector<Ev> evs;
        const int ns[] = { 21, 33, 48, 60, 72, 84, 96, 108 };
        for (int i = 0; i < 8; ++i) { evs.push_back({ 0.1 * i, 0, ns[i] + (i & 1), 0.4 + 0.08 * i }); evs.push_back({ 0.1 * i + 0.9, 1, ns[i] + (i & 1), 0 }); }
        evs.push_back({ 0.0, 2, 0, 1.0 }); evs.push_back({ 1.6, 2, 0, 0.0 });
        int tot = 0;
        for (double sr : { 44100.0, 48000.0, 96000.0, 192000.0 }) {
            for (int bs : { 1, 7, 64, 4096 }) {
                if (bs == 1 && sr > 100000.0) continue;
                auto e = makeEngineT(sr, defaults(), ex);
                const auto s = renderEvents(*e, evs, 2.5, bs);
                double pk = 0; for (double v : s.l) pk = std::max(pk, std::fabs(v)); for (double v : s.r) pk = std::max(pk, std::fabs(v));
                CHECK(isFiniteBuf(s.l) && isFiniteBuf(s.r), "NaN/inf con la tabla al limite a %g Hz bloque %d", sr, bs);
                CHECK(pk < 0.999 && pk > 0.005, "nivel %g con la tabla al limite a %g Hz bloque %d", pk, sr, bs);
                ++tot;
            }
        }
        std::printf("  tabla al limite: %d combinaciones de tasa x bloque sin NaN\n", tot);
        // cambiar la tabla en caliente (en mitad de las notas) no debe producir NaN ni clics grandes
        auto e = makeEngineT(SR, defaults(), NotaTabla());
        Stereo o; o.l.assign(96000, 0.0); o.r.assign(96000, 0.0);
        e->noteOn(60, 0.8); e->noteOn(64, 0.8);
        double dmax = 0;
        for (int i = 0; i < 96000; i += 256) {
            if (i == 24000) e->setNotaTabla(ex);
            if (i == 48000) e->setNotaTabla(NotaTabla());
            if (i == 60000) { e->noteOff(60); e->noteOn(67, 0.7); }
            e->render(o.l.data() + i, o.r.data() + i, 256, nullptr);
        }
        for (size_t i = 1; i < o.l.size(); ++i) dmax = std::max(dmax, std::fabs(o.l[i] - o.l[i - 1]));
        CHECK(isFiniteBuf(o.l) && isFiniteBuf(o.r) && dmax < 0.6, "cambiar la tabla con notas sonando (derivada %.3f)", dmax);
    }

    // ---- CPU: 16 voces con la tabla editada en todas las notas (tono + cuerpo + decay + martillo) frente a la neutra
    {
        NotaTabla ed;
        for (int n = kNotaMin; n <= kNotaMax; ++n) { ed.set(n, kNpTone, 40.0); ed.set(n, kNpBody, 50.0); ed.set(n, kNpDecay, 70.0); ed.set(n, kNpHammer, 140.0); ed.set(n, kNpTune, 5.0); ed.set(n, kNpPan, 10.0); }
        auto cpu = [&](const NotaTabla& t) {
            double best = 1e9;
            for (int rep = 0; rep < 5; ++rep) {
                auto eng = makeEngineT(SR, defaults(), t);
                std::vector<Ev> ev;
                for (int i = 0; i < 16; ++i) ev.push_back({ 0.0, 0, 40 + i * 3, 0.8 });
                const double c0 = cpuSeconds();
                renderEvents(*eng, ev, 6.0, 256);
                best = std::min(best, cpuSeconds() - c0);
            }
            return 100.0 * best / 6.0;
        };
        const double cn = cpu(neutra), ce = cpu(ed);
        std::printf("  CPU 16 voces: tabla neutra %.2f %% | tabla editada en las 88 notas %.2f %% de un nucleo\n", cn, ce);
        CHECK(ce < 5.0 && ce < cn * 2.2 + 0.3, "la tabla editada cuesta demasiado CPU (%.2f %% vs %.2f %%)", ce, cn);
    }
}

// Camino de muestras reales (necesita el banco grand-piano.jws en la carpeta de samples).
static int sampledTest(const char* wavPath) {
    constexpr double SR = 48000.0;
    std::printf("== JasWave Grand Piano - prueba del banco de muestras ==\n");
    auto e = makeEngine(SR, defaults());
    CHECK(e->samplerReady(), "el banco grand-piano.jws no se cargo (carpeta de samples)");
    if (!e->samplerReady()) return 1;
    auto medir = [&](int note, double vel, double dur) {
        auto eng = makeEngine(SR, defaults());
        Stereo o = renderEvents(*eng, { {0.05, 0, note, vel}, {dur, 1, note, 0.0} }, dur + 3.0, 256);
        CHECK(isFiniteBuf(o.l) && isFiniteBuf(o.r), "NaN/inf en nota %d", note);
        double pk = 0; for (size_t i = 0; i < o.l.size(); ++i) pk = std::max({ pk, std::fabs(o.l[i]), std::fabs(o.r[i]) });
        // energia 100-300 ms despues del ataque
        const size_t a = static_cast<size_t>(0.15 * SR), b = static_cast<size_t>(0.35 * SR);
        double rms = 0; for (size_t i = a; i < b && i < o.l.size(); ++i) rms += o.l[i] * o.l[i] + o.r[i] * o.r[i];
        rms = std::sqrt(rms / static_cast<double>(2 * (b - a)));
        // la cola debe terminar en silencio (sin cortes bruscos)
        double cola = 0; for (size_t i = o.l.size() - 2000; i < o.l.size(); ++i) cola = std::max(cola, std::fabs(o.l[i]));
        std::printf("  nota %3d vel %.2f: pico %6.1f dBFS | rms ataque %6.1f dBFS | cola final %6.1f dBFS\n", note, vel, dbfs(pk), dbfs(rms), dbfs(cola));
        CHECK(pk > 0.002 && pk < 0.99, "pico fuera de rango nota %d", note);
        CHECK(cola < 1e-3, "la cola no termina en silencio nota %d", note);
        return rms;
    };
    const double pp = medir(60, 0.2, 2.0), ff = medir(60, 0.95, 2.0);
    CHECK(dbfs(ff) - dbfs(pp) > 8.0, "la dinamica pp->ff es menor de 8 dB (%.1f)", dbfs(ff) - dbfs(pp));
    for (int n : { 24, 36, 48, 72, 84, 96, 105 }) medir(n, 0.6, 1.5);
    // dos golpes iguales no deben ser identicos (humanizacion + round-robin)
    {
        auto a = makeEngine(SR, defaults());
        Stereo o = renderEvents(*a, { {0.05, 0, 64, 0.7}, {0.6, 1, 64, 0}, {1.0, 0, 64, 0.7}, {1.6, 1, 64, 0} }, 2.5, 256);
        const size_t i0 = static_cast<size_t>(0.05 * SR), i1 = static_cast<size_t>(1.0 * SR);
        double dif = 0, ref = 0;
        for (size_t i = 0; i < 12000; ++i) { dif += std::fabs(o.l[i0 + i] - o.l[i1 + i]); ref += std::fabs(o.l[i0 + i]); }
        std::printf("  diferencia relativa entre dos golpes iguales: %.1f %%\n", 100.0 * dif / std::max(ref, 1e-9));
        CHECK(dif / std::max(ref, 1e-9) > 0.02, "dos golpes identicos: suena a ametralladora");
    }
    // acorde con pedal + frase corta -> wav para escuchar
    Stereo fr = renderEvents(*e, { {0.1, 2, 0, 1.0}, {0.2, 0, 50, 0.45}, {0.22, 0, 57, 0.4}, {0.25, 0, 62, 0.5}, {0.27, 0, 66, 0.55}, {3.0, 1, 50, 0}, {3.0, 1, 57, 0}, {3.0, 1, 62, 0}, {3.0, 1, 66, 0},
                                {3.2, 0, 69, 0.7}, {4.0, 0, 74, 0.6}, {5.0, 0, 73, 0.5}, {6.5, 2, 0, 0.0} }, 10.0, 256);
    double pk = 0; for (size_t i = 0; i < fr.l.size(); ++i) pk = std::max({ pk, std::fabs(fr.l[i]), std::fabs(fr.r[i]) });
    std::printf("  frase: pico %.1f dBFS\n", dbfs(pk));
    CHECK(pk > 0.01 && pk < 0.99, "pico de la frase fuera de rango");
    writeWav24(wavPath, fr, 48000);
    std::printf("  WAV: %s\n", wavPath);
    testFxRack(false);   // [7] FX Rack comun (solo lo que depende del motor: neutralidad, tempo, panic)
    notaSuite(true);
    std::printf(g_fail ? "== FALLO (%d fallos) ==\n" : "== OK ==\n", g_fail);
    return g_fail ? 1 : 0;
}

// Hash FNV-1a de un render determinista (acorde con pedal + notas sueltas, 6 s): referencia de neutralidad del FX Rack
static uint64_t renderHash(GrandPianoEngine& e, int block) {
    const std::vector<Ev> ev = { { 0.0, 2, 0, 1.0 }, { 0.0, 0, 48, 0.7 }, { 0.012, 0, 55, 0.68 }, { 0.024, 0, 64, 0.72 }, { 0.036, 0, 72, 0.6 },
                                 { 2.0, 1, 48, 0 }, { 2.0, 1, 55, 0 }, { 2.0, 1, 64, 0 }, { 2.0, 1, 72, 0 }, { 2.5, 2, 0, 0.0 },
                                 { 2.6, 0, 33, 0.9 }, { 3.0, 0, 84, 0.5 }, { 3.5, 1, 33, 0 }, { 4.0, 1, 84, 0 } };
    const Stereo s = renderEvents(e, ev, 6.0, block);
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < s.l.size(); ++i) {
        uint64_t a, b;
        std::memcpy(&a, &s.l[i], 8); std::memcpy(&b, &s.r[i], 8);
        h = (h ^ a) * 1099511628211ull; h = (h ^ b) * 1099511628211ull;
    }
    return h;
}


// =====================================================================================
//  [7] FX Rack comun (jw_fxrack.h, ids 100..230): mismas pruebas que el piloto shimmer-pad (las del rack solo usan jw_fxrack.h)
//  + neutralidad bit a bit en el motor del piano (rack apagado == hash previo a la integracion), medidor tras el rack, tempo.
// =====================================================================================
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

static void testFxRack(bool completo) {
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
        // Referencias medidas ANTES de integrar el rack (motor sin rack, render determinista de renderHash):
        //   modelado (sin banco): 0x7f56a4636a902f66. Con banco: depende del banco instalado (0xa5f101f9b01f77a8 con grand-piano.jws del 2026-10-26).
        const uint64_t goldenModelado = 0x7f56a4636a902f66ull, goldenBanco = 0xa5f101f9b01f77a8ull;
        auto e0 = makeEngine(SR, defaults());
        const bool banco = e0->samplerReady();
        const uint64_t h0 = renderHash(*e0, 512);
        // con valores de rack ajustados pero TODOS los bloques apagados
        auto e1 = makeEngine(SR, defaults());
        FxParams p = porDefecto();
        for (int b = 0; b < kBands; ++b) { p.eq[b].gainDb = 12.0; p.eq[b].hz *= 1.3; }
        p.compThreshDb = -50; p.compRatio = 20; p.satDrive = 1.0; p.dlTimeMs = 100; p.rvMix = 1.0; p.outWidth = 2.0; p.outGainDb = 12.0;
        e1->setFx(p);
        const uint64_t h1 = renderHash(*e1, 512);
        // y con otro tamano de bloque (el rack apagado tampoco depende del bloque)
        auto e3 = makeEngine(SR, defaults());
        e3->setFx(p);
        const uint64_t h3 = renderHash(*e3, 77);
        auto e4 = makeEngine(SR, defaults());
        const uint64_t h4 = renderHash(*e4, 77);
        const uint64_t golden = banco ? goldenBanco : goldenModelado;
        std::printf("    %s: hash sin rack=0x%016llx, rack apagado con valores extremos=0x%016llx (referencia previa 0x%016llx); bloque 77: 0x%016llx / 0x%016llx\n",
                    banco ? "banco de muestras" : "modelado", static_cast<unsigned long long>(h0), static_cast<unsigned long long>(h1),
                    static_cast<unsigned long long>(golden), static_cast<unsigned long long>(h3), static_cast<unsigned long long>(h4));
        CHECK(h1 == h0, "el rack con bloques apagados cambia el sonido");
        CHECK(h3 == h4, "el rack con bloques apagados cambia el sonido (bloque 77)");
        if (!banco) CHECK(h0 == goldenModelado, "el rack apagado cambia el sonido por defecto del plugin (modelado)");
        else if (h0 != goldenBanco) std::printf("    (aviso: el banco de muestras instalado ya no es el de la referencia; la neutralidad se comprueba contra el motor sin setFx)\n");
        // y encendido SI cambia
        auto e2 = makeEngine(SR, defaults());
        FxParams q = porDefecto(); q.eqOn = true; q.eq[2].gainDb = 9.0; q.dlOn = true; q.rvOn = true; q.compOn = true; q.satOn = true; q.chOn = true; q.outOn = true;
        e2->setFx(q);
        CHECK(renderHash(*e2, 512) != h0, "el rack encendido no cambia nada");
        // los ids del piano (0..23, nota a nota 12..23) no colisionan con el rack (100..)
        int propios = 0, rack = 0; bool sinColision = true;
        for (const auto& d : paramDefs()) { if (d.id < kBase) ++propios; else ++rack; if (d.id >= 24 && d.id < kBase) sinColision = false; }
        std::printf("    parametros propios del piano: %d (ids 0..23), del rack: %d\n", propios, rack);
        CHECK(propios == 24 && rack == 58 && sinColision, "ids del piano/rack: %d propios, %d del rack", propios, rack);
    }
    if (completo) {   // pruebas del rack aislado (solo dependen de jw_fxrack.h): una sola vez, en la suite modelada
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
                    rk2.process(L.data(), R.data(), blk);
                    for (int k = 0; k < blk; ++k) if (!std::isfinite(L[static_cast<size_t>(k)]) || !std::isfinite(R[static_cast<size_t>(k)]) || std::fabs(L[static_cast<size_t>(k)]) > 3000.0f) ++bad;
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

    }   // completo

    // ---- 7.11 motor: con todo encendido sigue finito y acotado; el pico se mide tras el rack; el tempo llega al delay ----
    {
        auto e = makeEngine(SR, defaults());
        FxParams q = porDefecto(); q.dlOn = true;
        q.dlSync = 1; q.dlFeedback = 0.0; q.dlMix = 1.0;
        e->setFx(q);
        e->setTempo(120.0);
        GrandBus bus;
        // una nota corta: el eco de 1/4 a 120 bpm (500 ms) debe oirse medio segundo despues del ataque
        const Stereo s = renderEvents(*e, { { 0.0, 0, 72, 0.9 }, { 0.05, 1, 72, 0 } }, 2.0, 256, &bus);
        auto env = [&](double t0, double t1) { return rmsRange(s.l, static_cast<size_t>(t0 * SR), static_cast<size_t>(t1 * SR)); };
        const double eco = env(0.52, 0.62), valle = env(0.40, 0.48);
        std::printf("    delay 1/4 @120 bpm sobre el motor: RMS 0.52..0.62 s = %.1f dBFS frente a 0.40..0.48 s = %.1f dBFS\n", db(eco), db(valle));
        CHECK(isFiniteBuf(s.l) && isFiniteBuf(s.r), "NaN con el rack en el motor");
        CHECK(db(eco) > db(valle) + 6.0, "el eco sincronizado no aparece a 500 ms (tempo no llega al delay)");
        // todo encendido
        auto e5 = makeEngine(SR, defaults());
        FxParams t = porDefecto(); t.hpfOn = t.eqOn = t.compOn = t.satOn = t.chOn = t.dlOn = t.rvOn = t.outOn = true;
        t.eq[1].gainDb = 8.0; t.outGainDb = -6.0;
        e5->setFx(t);
        GrandBus bus2;
        const Stereo s2 = renderEvents(*e5, { { 0.0, 2, 0, 1.0 }, { 0.0, 0, 50, 0.8 }, { 0.0, 0, 57, 0.8 }, { 0.0, 0, 66, 0.8 }, { 5.0, 1, 50, 0 } }, 6.0, 512, &bus2);
        double pk = 0; for (size_t i = 0; i < s2.l.size(); ++i) pk = std::max({ pk, std::fabs(s2.l[i]), std::fabs(s2.r[i]) });
        std::printf("    motor con rack completo: pico %.3f, GR publicado en el bus = %.2f dB\n", pk, static_cast<double>(bus2.fxGrDb.load()));
        CHECK(isFiniteBuf(s2.l) && isFiniteBuf(s2.r) && pk <= 1.0, "motor + rack no finito o desbordado (%.3f)", pk);
        // el reset del motor limpia las colas del rack: tras panic() no queda eco
        e5->panic();
        Stereo mudo; mudo.l.assign(4800, 0.0); mudo.r.assign(4800, 0.0);
        e5->render(mudo.l.data(), mudo.r.data(), 4800, nullptr);
        double pm = 0; for (double v : mudo.l) pm = std::max(pm, std::fabs(v));
        CHECK(pm < 1.0e-6, "las colas del rack sobreviven al panic (%.3g)", pm);
    }
}

int main(int argc, char** argv) {
    ScopedNoDenormals nd;
    const char* wavPath = argc > 1 && std::strncmp(argv[1], "--", 2) != 0 ? argv[1] : "grand_piano_phrase.wav";
    constexpr double SR = 48000.0;
    const bool conSamples = (argc > 1 && std::strcmp(argv[argc - 1], "--samples") == 0);
    if (conSamples) return sampledTest(wavPath);
    // La suite modelada comprueba el respaldo sin banco: se aparta la carpeta de samples.
#ifdef _WIN32
    _putenv_s("JASWAVE_SAMPLES_DIR", "__sin_samples__");
#endif

    std::printf("== JasWave Grand Piano - render test ==\n");

    // ---- 0. estabilidad de la sala
    {
        HallReverb rv; rv.prepare(SR);
        std::printf("[sala] ganancia de lazo maxima = %.5f (debe ser < 1)\n", rv.maxLoopGain());
        CHECK(rv.maxLoopGain() < 1.0, "fb >= 1");
        for (double sr : { 44100.0, 96000.0, 192000.0 }) { HallReverb r2; r2.prepare(sr); CHECK(r2.maxLoopGain() < 1.0, "fb >= 1 a %g", sr); }
    }

    // ---- 1. afinacion por nota (sin sala para medir la cuerda)
    std::printf("\n[afinacion] f0 medida (YIN) vs esperada, vel 0.7, sala 0\n");
    std::printf("  nota  esperada(Hz)  medida(Hz)  error(cents)\n");
    {
        const int notes[] = { 21, 28, 33, 40, 45, 52, 57, 60, 64, 69, 72, 76, 81, 84, 88, 93, 96, 100, 104, 108 };
        GrandSettings st = defaults(); st.reverbPct = 0;
        double worst = 0;
        for (int n : notes) {
            auto e = makeEngine(SR, st);
            const auto s = renderEvents(*e, { { 0.0, 0, n, 0.7 } }, 2.0, 256);
            const auto m = mono(s);
            const double exp = 440.0 * std::pow(2.0, (n - 69) / 12.0);
            const double got = yin(m, 19200, 8192, SR, exp * 0.7, exp * 1.4);
            const double cents = got > 0 ? 1200.0 * std::log2(got / exp) : 9999.0;
            worst = std::max(worst, std::fabs(cents));
            std::printf("  %3d   %10.2f   %10.2f   %+8.2f\n", n, exp, got, cents);
            CHECK(std::fabs(cents) < 15.0, "nota %d: %.1f cents", n, cents);
        }
        std::printf("  peor error: %.2f cents\n", worst);
    }

    // ---- 2. dinamica y timbre
    std::printf("\n[dinamica] A4 con vel 0.12 / 0.5 / 1.0: nivel y centroide espectral (timbre)\n");
    {
        GrandSettings st = defaults(); st.reverbPct = 0;
        double lvl[3], cen[3]; const double vs[3] = { 0.12, 0.5, 1.0 };
        for (int i = 0; i < 3; ++i) {
            auto e = makeEngine(SR, st);
            const auto m = mono(renderEvents(*e, { { 0.0, 0, 69, vs[i] } }, 1.0, 256));
            lvl[i] = db(rmsRange(m, 2400, 14400)); cen[i] = centroid(m, 1500, SR);
            std::printf("  vel %.2f: RMS(50..300ms) %7.2f dBFS   centroide %7.0f Hz\n", vs[i], lvl[i], cen[i]);
        }
        CHECK(lvl[2] - lvl[0] > 15.0, "rango dinamico insuficiente (%.1f dB)", lvl[2] - lvl[0]);
        CHECK(cen[2] > cen[0] * 1.3, "el timbre no depende de la velocidad");
    }

    // ---- 3. decaimiento bifasico y por registro
    std::printf("\n[decaimiento] RMS (dBFS) a distintos tiempos, vel 0.7, sala 0\n");
    {
        GrandSettings st = defaults(); st.reverbPct = 0;
        for (int n : { 36, 60, 84 }) {
            auto e = makeEngine(SR, st);
            const auto m = mono(renderEvents(*e, { { 0.0, 0, n, 0.7 } }, 12.0, 256));
            const double a = db(rmsRange(m, 4800, 9600)), b = db(rmsRange(m, 28800, 33600)), c = db(rmsRange(m, 96000, 100800)), d = db(rmsRange(m, 240000, 244800));
            std::printf("  nota %3d: 0.1s %7.1f | 0.6s %7.1f | 2s %7.1f | 5s %7.1f dB   (pendiente inicial %.1f dB/s, tardia %.1f dB/s)\n",
                        n, a, b, c, d, (b - a) / 0.5, (d - c) / 3.0);
            CHECK(a > b && b > c, "no decae (nota %d)", n);
        }
        auto e = makeEngine(SR, st);
        const auto m = mono(renderEvents(*e, { { 0.0, 0, 60, 0.7 } }, 12.0, 256));
        const double s1 = (db(rmsRange(m, 28800, 33600)) - db(rmsRange(m, 4800, 9600))) / 0.5;
        const double s2 = (db(rmsRange(m, 240000, 244800)) - db(rmsRange(m, 96000, 100800))) / 3.0;
        CHECK(s1 < s2 - 1.0, "decaimiento no bifasico (inicial %.1f, tardio %.1f dB/s)", s1, s2);
    }

    // ---- 4. release de apagador y pedal de sustain / resonancia simpatica
    std::printf("\n[pedal] acorde C3-G3-E4, nota-off a 1 s, nivel 0.5..1.5 s despues\n");
    {
        GrandSettings st = defaults(); st.reverbPct = 0;
        auto run = [&](double pedal, double rel) {
            GrandSettings s2 = st; s2.releaseS = rel;
            auto e = makeEngine(SR, s2);
            std::vector<Ev> ev = { { 0.0, 2, 0, pedal }, { 0.0, 0, 48, 0.7 }, { 0.0, 0, 55, 0.7 }, { 0.0, 0, 64, 0.7 },
                                   { 1.0, 1, 48, 0 }, { 1.0, 1, 55, 0 }, { 1.0, 1, 64, 0 } };
            return mono(renderEvents(*e, ev, 3.0, 256));
        };
        const auto up = run(0.0, 0.6), dn = run(1.0, 0.6), half = run(0.5, 0.6);
        const double lu = db(rmsRange(up, 72000, 120000)), ld = db(rmsRange(dn, 72000, 120000)), lh = db(rmsRange(half, 72000, 120000));
        std::printf("  sin pedal %7.1f dB | medio pedal %7.1f dB | pedal %7.1f dB\n", lu, lh, ld);
        CHECK(ld > lu + 20.0, "el pedal no sostiene");
        CHECK(lh > lu + 3.0 && lh < ld + 0.5, "medio pedal fuera de orden");
        const auto r1 = run(0.0, 0.1), r2 = run(0.0, 2.0);
        std::printf("  release 0.1 s: %7.1f dB | release 2.0 s: %7.1f dB\n", db(rmsRange(r1, 72000, 120000)), db(rmsRange(r2, 72000, 120000)));
        CHECK(db(rmsRange(r2, 72000, 120000)) > db(rmsRange(r1, 72000, 120000)) + 6.0, "el parametro release no actua");
        // resonancia simpatica: acorde C3-G3 con pedal; se mide lo que aportan las cuerdas libres (banco on/off)
        auto e1 = makeEngine(SR, st), e2 = makeEngine(SR, st);
        e2->setSympathetic(0.0);
        const std::vector<Ev> ev = { { 0.0, 2, 0, 1.0 }, { 0.0, 0, 48, 0.9 }, { 0.0, 0, 55, 0.9 }, { 0.4, 1, 48, 0 }, { 0.4, 1, 55, 0 } };
        const auto sa = mono(renderEvents(*e1, ev, 4.0, 256)), sb = mono(renderEvents(*e2, ev, 4.0, 256));
        std::vector<double> diff(sa.size());
        for (size_t i = 0; i < sa.size(); ++i) diff[i] = sa[i] - sb[i];
        const double total = db(rmsRange(sa, 48000, 144000)), sym = db(rmsRange(diff, 48000, 144000));
        std::printf("  resonancia simpatica (1..3 s): total %.1f dB, aportacion de cuerdas libres %.1f dB (%.1f dB bajo el total)\n", total, sym, total - sym);
        CHECK(total - sym > 6.0 && total - sym < 40.0, "simpatica fuera de rango");
    }

    // ---- 5. imagen estereo
    std::printf("\n[estereo] energia L/R por registro (anchura 75 %%)\n");
    {
        GrandSettings st = defaults(); st.reverbPct = 0;
        for (int n : { 28, 48, 64, 84, 100 }) {
            auto e = makeEngine(SR, st);
            const auto s = renderEvents(*e, { { 0.0, 0, n, 0.7 } }, 1.0, 256);
            const double l = rmsRange(s.l, 4800, 36000), r = rmsRange(s.r, 4800, 36000);
            std::printf("  nota %3d: L %7.1f dB  R %7.1f dB  (R-L %+5.1f dB)\n", n, db(l), db(r), db(r) - db(l));
            if (n == 28) CHECK(l > r, "graves no a la izquierda");
            if (n == 100) CHECK(r > l, "agudos no a la derecha");
        }
        GrandSettings w0 = st; w0.widthPct = 0;
        auto e = makeEngine(SR, w0);
        const auto s = renderEvents(*e, { { 0.0, 0, 28, 0.7 } }, 1.0, 256);
        std::printf("  anchura 0: nota 28 R-L %+5.2f dB\n", db(rmsRange(s.r, 4800, 36000)) - db(rmsRange(s.l, 4800, 36000)));
    }

    // ---- 6. estabilidad: tasas de muestreo, bloques, polifonia, robo de voces, panico
    std::printf("\n[estabilidad] tasas x bloques x polifonia\n");
    {
        std::vector<Ev> evs;
        const int ns[] = { 21, 33, 48, 60, 72, 84, 96, 108 };
        for (int i = 0; i < 8; ++i) { evs.push_back({ 0.1 * i, 0, ns[i], 0.4 + 0.08 * i }); evs.push_back({ 0.1 * i + 0.9, 1, ns[i], 0 }); }
        evs.push_back({ 0.0, 2, 0, 1.0 }); evs.push_back({ 1.6, 2, 0, 0.0 });
        for (double sr : { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 }) {
            for (int bs : { 1, 7, 64, 4096 }) {
                if (bs == 1 && sr > 100000.0) continue;
                auto e = makeEngine(sr, defaults());
                const auto s = renderEvents(*e, evs, 2.5, bs);
                double pk = 0; for (double v : s.l) pk = std::max(pk, std::fabs(v)); for (double v : s.r) pk = std::max(pk, std::fabs(v));
                const bool fin = isFiniteBuf(s.l) && isFiniteBuf(s.r);
                CHECK(fin, "NaN/inf a %g Hz bloque %d", sr, bs);
                CHECK(pk < 0.98 && pk > 0.01, "nivel %g a %g Hz bloque %d", pk, sr, bs);
                if (bs == 64 || bs == 4096) std::printf("  %7.0f Hz  bloque %4d: pico %.3f %s\n", sr, bs, pk, fin ? "ok" : "NaN");
            }
        }
        // robo de voces (16 voces basicas, 120 notas en 0.6 s)
        GrandSettings st = defaults(); st.maxVoices = kBasicVoices;
        auto e = makeEngine(SR, st);
        std::vector<Ev> storm;
        for (int i = 0; i < 120; ++i) storm.push_back({ 0.005 * i, 0, 30 + (i * 7) % 70, 0.9 });
        const auto s = renderEvents(*e, storm, 3.0, 128);
        double pk = 0, dmax = 0;
        for (size_t i = 1; i < s.l.size(); ++i) { pk = std::max(pk, std::fabs(s.l[i])); dmax = std::max(dmax, std::fabs(s.l[i] - s.l[i - 1])); }
        std::printf("  tormenta 120 notas / 16 voces: pico %.3f, derivada max %.3f, voces activas %d\n", pk, dmax, e->activeVoices());
        CHECK(isFiniteBuf(s.l) && isFiniteBuf(s.r), "NaN en la tormenta");
        CHECK(e->activeVoices() <= kBasicVoices + kExtraSlots, "demasiadas voces");
        // panico: silencio total (incluye sala y cuerdas simpaticas)
        e->setPedal(1.0);
        std::vector<Ev> none;
        Stereo tmp; tmp.l.assign(4800, 0); tmp.r.assign(4800, 0);
        e->noteOn(60, 1.0); e->render(tmp.l.data(), tmp.r.data(), 4800, nullptr);
        e->panic();
        e->render(tmp.l.data(), tmp.r.data(), 4800, nullptr);
        double pm = 0; for (double v : tmp.l) pm = std::max(pm, std::fabs(v)); for (double v : tmp.r) pm = std::max(pm, std::fabs(v));
        std::printf("  tras panic: pico %.3g, voces %d\n", pm, e->activeVoices());
        CHECK(pm < 1.0e-9 && e->activeVoices() == 0, "panic no silencia");
        // las voces con energia agotada se liberan solas (sin note-off y con pedal: solo la extincion natural)
        auto e3 = makeEngine(SR, defaults());
        Stereo t3; t3.l.assign(4800, 0); t3.r.assign(4800, 0);
        e3->setPedal(1.0);
        e3->noteOn(100, 0.4);
        int sec = 0;
        for (; sec < 600 && e3->activeVoices() > 0; ++sec) for (int k = 0; k < 10; ++k) e3->render(t3.l.data(), t3.r.data(), 4800, nullptr);
        std::printf("  voz de E7 (vel 0.4, pedal, sin note-off): se libera sola a los ~%d s (activas %d)\n", sec, e3->activeVoices());
        CHECK(e3->activeVoices() == 0, "la voz agotada no se libera");
    }

    // ---- 7. frase musical
    std::printf("\n[frase] escala + acordes + dinamica pp->ff + pedal\n");
    std::vector<Ev> ph;
    double t = 0.2;
    const int scale[] = { 60, 62, 64, 65, 67, 69, 71, 72 };
    for (int i = 0; i < 8; ++i) { ph.push_back({ t, 0, scale[i], 0.55 + 0.03 * i }); ph.push_back({ t + 0.36, 1, scale[i], 0 }); t += 0.38; }
    t += 0.4;
    auto chord = [&](std::initializer_list<int> ns, double vel, double dur) {
        int k = 0; for (int n : ns) { ph.push_back({ t + 0.012 * k, 0, n, vel - 0.02 * k }); ph.push_back({ t + dur, 1, n, 0 }); ++k; }
        t += dur + 0.15;
    };
    ph.push_back({ t, 2, 0, 1.0 });
    chord({ 48, 55, 60, 64, 72 }, 0.72, 2.2);
    ph.push_back({ t - 0.3, 2, 0, 0.0 });
    chord({ 45, 52, 57, 60, 64 }, 0.66, 2.0);
    chord({ 53, 57, 60, 65, 69 }, 0.7, 2.0);
    ph.push_back({ t, 2, 0, 1.0 });
    chord({ 43, 50, 55, 59, 62, 65 }, 0.78, 2.6);
    ph.push_back({ t - 0.2, 2, 0, 0.0 });
    // pasaje dinamico pp -> ff sobre A4
    const double dyn[] = { 0.10, 0.22, 0.36, 0.52, 0.70, 0.86, 1.0 };
    for (int i = 0; i < 7; ++i) { ph.push_back({ t, 0, 69, dyn[i] }); ph.push_back({ t, 0, 76, dyn[i] * 0.8 }); ph.push_back({ t + 0.55, 1, 69, 0 }); ph.push_back({ t + 0.55, 1, 76, 0 }); t += 0.62; }
    ph.push_back({ t, 0, 45, 0.85 }); ph.push_back({ t + 0.002, 0, 57, 0.7 }); ph.push_back({ t + 1.5, 1, 45, 0 }); ph.push_back({ t + 1.5, 1, 57, 0 }); t += 1.8;
    // arpegio con pedal (medio pedal despues) y registros extremos
    ph.push_back({ t, 2, 0, 1.0 });
    const int arp[] = { 36, 43, 48, 52, 55, 60, 64, 67, 72, 76, 79, 84, 88, 91, 96, 100 };
    for (int i = 0; i < 16; ++i) { ph.push_back({ t, 0, arp[i], 0.45 + 0.02 * i }); ph.push_back({ t + 0.15, 1, arp[i], 0 }); t += 0.22; }
    t += 1.2;
    ph.push_back({ t, 2, 0, 0.45 });
    t += 1.4;
    ph.push_back({ t, 2, 0, 0.0 });
    t += 1.0;
    ph.push_back({ t, 0, 21, 0.8 }); ph.push_back({ t + 0.003, 0, 28, 0.7 }); ph.push_back({ t + 2.0, 1, 21, 0 }); ph.push_back({ t + 2.0, 1, 28, 0 });
    t += 1.0;
    ph.push_back({ t, 0, 105, 0.6 }); ph.push_back({ t + 0.3, 0, 108, 0.5 }); ph.push_back({ t + 1.0, 1, 105, 0 }); ph.push_back({ t + 1.0, 1, 108, 0 });
    t += 4.5;
    auto e = makeEngine(SR, defaults());
    GrandBus bus;
    const double t0 = cpuSeconds();
    const Stereo out = renderEvents(*e, ph, t, 256, &bus);
    const double wall = cpuSeconds() - t0;
    double pk = 0, dmax = 0, dc = 0, ss = 0; size_t nonSilent = 0;
    for (size_t i = 0; i < out.l.size(); ++i) {
        pk = std::max({ pk, std::fabs(out.l[i]), std::fabs(out.r[i]) });
        dc += out.l[i] + out.r[i];
        const double q = out.l[i] * out.l[i] + out.r[i] * out.r[i];
        ss += q; if (q > 1e-10) ++nonSilent;
        if (i) dmax = std::max({ dmax, std::fabs(out.l[i] - out.l[i - 1]), std::fabs(out.r[i] - out.r[i - 1]) });
    }
    dc /= 2.0 * static_cast<double>(out.l.size());
    const double rms = std::sqrt(ss / (2.0 * static_cast<double>(std::max<size_t>(1, nonSilent))));
    std::printf("  duracion %.2f s | pico %.3f (%.1f dBFS) | RMS(no silencio) %.1f dBFS | DC %.2e | derivada max %.3f\n",
                t, pk, db(pk), db(rms), dc, dmax);
    std::printf("  CPU frase: %.3f s de calculo / %.2f s de audio = %.2f %% de un nucleo\n", wall, t, 100.0 * wall / t);
    CHECK(isFiniteBuf(out.l) && isFiniteBuf(out.r), "NaN/inf en la frase");
    CHECK(pk < 0.98 && pk > 0.2, "pico fuera de rango");
    CHECK(db(rms) > -40.0 && db(rms) < -8.0, "RMS fuera de rango");
    CHECK(std::fabs(dc) < 1.0e-3, "DC");
    CHECK(dmax < 0.6, "posible clic (derivada %.3f)", dmax);
    writeWav24(wavPath, out, 48000);
    std::printf("  WAV: %s\n", wavPath);

    // ---- 8. CPU con 16 voces sostenidas (3 cuerdas, 48 kHz), CPU del hilo, mejor de 3
    {
        const double secs = 6.0;
        auto cpuRun = [&](int nv, int step, int base, bool pedal) {
            double best = 1e9;
            for (int rep = 0; rep < 5; ++rep) {
                auto eng = makeEngine(SR, defaults());
                std::vector<Ev> ev;
                for (int i = 0; i < nv; ++i) ev.push_back({ 0.0, 0, base + i * step, 0.8 });
                if (pedal) ev.push_back({ 0.0, 2, 0, 1.0 });
                const double c0 = cpuSeconds();
                renderEvents(*eng, ev, secs, 256);
                best = std::min(best, cpuSeconds() - c0);
            }
            return 100.0 * best / secs;
        };
        const double c16 = cpuRun(16, 3, 40, false);
        std::printf("\n[cpu] 16 voces sostenidas (E2..A6, vel 0.8) + sala: %.2f %% de un nucleo a 48 kHz (CPU del hilo, mejor de 5)\n", c16);
        CHECK(c16 < 5.0, "CPU >= 5 %%");
        std::printf("[cpu] 64 voces + pedal (cuerdas simpaticas): %.2f %% de un nucleo\n", cpuRun(64, 1, 28, true));
    }


    testFxRack(true);   // [7] FX Rack comun
    notaSuite(false);

    std::printf("\n== %s (%d fallos) ==\n", g_fail ? "FALLO" : "OK", g_fail);
    return g_fail ? 1 : 0;
}
