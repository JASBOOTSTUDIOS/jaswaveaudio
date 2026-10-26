// =====================================================================================
//  Autoverificación objetiva del DSP de todos los plugins JasWave (sin SDK, sin UI).
//   - EQ: respuesta medida con senos contra fórmulas RBJ independientes (≤ 0.1 dB) y Butterworth
//   - Compresor: curva estática (umbral / ratio / rodilla)
//   - Limitador: true-peak de salida ≤ techo medido con sobremuestreo 16× (y 4× BS.1770) en
//     señales difíciles; latencia exacta
//   - De-esser: reduce la banda sibilante sin tocar el resto; cruce LR4 plano
//   - Utility: fase, swap, M/S, mono-graves, balance, DC
//   - Piano: afinación A4 = 440 Hz ±1 cent (y LA4 = 442), polifonía 16/64, sin denormales
//   - Todos: sin NaN/Inf, tamaños de bloque 1/64/512/4096 idénticos, 44.1–192 kHz,
//     y CERO asignaciones de memoria dentro de process (operator new instrumentado)
// =====================================================================================
#define _USE_MATH_DEFINES
#include <atomic>
#include <cfloat>
#include <cstdio>
#include <cstdlib>
#include <new>
#include <random>

// ---- contador de asignaciones (solo cuenta dentro de las secciones "process") ----
static std::atomic<long long> g_allocs{0};
static thread_local bool g_inProcess = false;
void* operator new(size_t n) {
    if (g_inProcess) g_allocs.fetch_add(1);
    if (void* p = std::malloc(n ? n : 1)) return p;
    throw std::bad_alloc();
}
void* operator new[](size_t n) { return operator new(n); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, size_t) noexcept { std::free(p); }
void operator delete[](void* p, size_t) noexcept { std::free(p); }
struct ProcessScope { ProcessScope() { g_inProcess = true; } ~ProcessScope() { g_inProcess = false; } };

#include "com.jaswave.plugin.param-eq/src/param_eq_dsp.h"
#include "com.jaswave.plugin.bus-compressor/src/bus_compressor_dsp.h"
#include "com.jaswave.plugin.truepeak-limiter/src/truepeak_limiter_dsp.h"
#include "com.jaswave.plugin.smart-deesser/src/deesser_dsp.h"
#include "com.jaswave.plugin.utility-tool/src/utility_dsp.h"
#include "com.jaswave.plugin.piano-synth/source/piano_dsp.h"
#include "com.jaswave.plugin.roles-vst/src/roles_engine.h"
#include "jw_audio_lens.h"

using namespace JasWaveDsp;

static int g_fail = 0, g_pass = 0;
#define CHECK(cond, ...) do { if (cond) { ++g_pass; std::printf("  [ OK ] "); } else { ++g_fail; std::printf("  [FAIL] "); } std::printf(__VA_ARGS__); std::printf("\n"); } while (0)

using Buf = std::vector<double>;

static Buf sine(double f, double amp, double sr, int n, double phase = 0.0) {
    Buf v(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) v[static_cast<size_t>(i)] = amp * std::sin(2.0 * kPi * f * i / sr + phase);
    return v;
}
static double rms(const Buf& x, int from, int to) {
    double s = 0;
    for (int i = from; i < to; ++i) s += x[static_cast<size_t>(i)] * x[static_cast<size_t>(i)];
    return std::sqrt(s / std::max(1, to - from));
}
static double db(double lin) { return 20.0 * std::log10(std::max(lin, 1e-30)); }
static bool allFinite(const Buf& x) { for (double v : x) if (!std::isfinite(v)) return false; return true; }
// Amplitud de la componente a frecuencia f (proyección sobre seno/coseno, ventana entera)
static double toneAmp(const Buf& x, int from, int to, double f, double sr) {
    double c = 0, s = 0;
    for (int i = from; i < to; ++i) { const double w = 2.0 * kPi * f * i / sr; c += x[static_cast<size_t>(i)] * std::cos(w); s += x[static_cast<size_t>(i)] * std::sin(w); }
    return 2.0 * std::sqrt(c * c + s * s) / (to - from);
}

// True-peak de referencia: sobremuestreo 16× con sinc de 64 taps/fase (Blackman), independiente del plugin
static double truePeak16(const Buf& x, int from) {
    const int os = 16, half = 32;
    static std::vector<double> h;
    if (h.empty()) {
        h.resize(static_cast<size_t>(2 * half * os + 1));
        for (int i = 0; i < static_cast<int>(h.size()); ++i) {
            const double t = (i - half * os) / static_cast<double>(os);
            const double s = (t == 0.0) ? 1.0 : std::sin(kPi * t) / (kPi * t);
            const double r = static_cast<double>(i) / (h.size() - 1);
            h[static_cast<size_t>(i)] = s * (0.42 - 0.5 * std::cos(2 * kPi * r) + 0.08 * std::cos(4 * kPi * r));
        }
    }
    double best = 0.0;
    for (int n = std::max(from, half); n < static_cast<int>(x.size()) - half; ++n) {
        best = std::max(best, std::fabs(x[static_cast<size_t>(n)]));
        for (int p = 1; p < os; ++p) {
            double acc = 0.0;
            for (int k = -half + 1; k <= half; ++k) acc += x[static_cast<size_t>(n - k)] * h[static_cast<size_t>(k * os - p + half * os)];
            best = std::max(best, std::fabs(acc));
        }
    }
    return best;
}
// True-peak 4× con los coeficientes normativos de ITU-R BS.1770-4 (Anexo 2, 48 taps, 4 fases)
static double truePeak4(const Buf& x, int from) {
    static const double c[4][12] = {
        { 0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500 },
        { -0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375 },
        { -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875 },
        { -0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750 } };
    double best = 0.0;
    for (int n = std::max(from, 11); n < static_cast<int>(x.size()); ++n)
        for (int p = 0; p < 4; ++p) {
            double acc = 0.0;
            for (int k = 0; k < 12; ++k) acc += c[p][k] * x[static_cast<size_t>(n - k)];
            best = std::max(best, std::fabs(acc));
        }
    return best;
}

// RBJ cookbook independiente (re-implementado aquí) -> |H| en dB
static double rbjDb(const char* type, double sr, double f0, double gainDb, double q, double f) {
    const double A = std::pow(10.0, gainDb / 40.0), w0 = 2 * kPi * f0 / sr, al = std::sin(w0) / (2 * q), cw = std::cos(w0);
    double b0, b1, b2, a0, a1, a2;
    const std::string t = type;
    if (t == "peak") { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else if (t == "lp") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (t == "hp") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (t == "notch") { b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (t == "ls") {
        const double s = 2 * std::sqrt(A) * al;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
    } else {
        const double s = 2 * std::sqrt(A) * al;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
    }
    const double w = 2 * kPi * f / sr;
    const double nr = b0 + b1 * std::cos(w) + b2 * std::cos(2 * w), ni = -(b1 * std::sin(w) + b2 * std::sin(2 * w));
    const double dr = a0 + a1 * std::cos(w) + a2 * std::cos(2 * w), di = -(a1 * std::sin(w) + a2 * std::sin(2 * w));
    return 10 * std::log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

// Procesa por bloques de tamaño `block` (todas las engines tienen la misma firma de efecto)
template <class E, class Bus>
static void runFx(E& e, Bus* bus, const Buf& inL, const Buf& inR, Buf& outL, Buf& outR, int block) {
    const int n = static_cast<int>(inL.size());
    outL.assign(inL.size(), 0.0);
    outR.assign(inR.size(), 0.0);
    ProcessScope ps;
    for (int p = 0; p < n; p += block) {
        const int m = std::min(block, n - p);
        e.process(inL.data() + p, inR.data() + p, outL.data() + p, outR.data() + p, m, bus);
    }
}

// =====================================================================================
static void testEq() {
    std::printf("\n[EQ] respuesta medida vs RBJ independiente (tolerancia 0.1 dB)\n");
    using namespace JasWaveEq;
    const double sr = 48000.0;
    struct Case { int type; const char* rbj; double f0, g, q; };
    const Case cases[] = { { tPeak, "peak", 1000, 9, 1.4 }, { tPeak, "peak", 120, -12, 0.7 }, { tLowShelf, "ls", 200, 6, 0.71 },
                           { tHighShelf, "hs", 6000, -8, 0.71 }, { tHpf, "hp", 150, 0, 0.71 }, { tLpf, "lp", 5000, 0, 2.0 }, { tNotch, "notch", 2000, 0, 4.0 } };
    const double freqs[] = { 50, 100, 250, 700, 1000, 1500, 3000, 6000, 12000 };
    double worst = 0;
    long long allocs0 = g_allocs.load();
    for (const Case& c : cases) {
        EqSettings s;
        for (auto& b : s.band) b.on = false;
        s.band[2] = { c.type, c.f0, c.g, c.q, true };
        s.analyzer = 0;
        EqEngine e;
        e.setSettings(s);
        e.prepare(sr, 512);
        for (double f : freqs) {
            if (c.type == tNotch && std::fabs(f - c.f0) < 1.0) continue;
            const int n = 48000;
            const Buf x = sine(f, 0.25, sr, n);
            Buf yl, yr;
            e.reset();
            runFx(e, static_cast<EqBus*>(nullptr), x, x, yl, yr, 512);
            const double meas = db(toneAmp(yl, n / 2, n, f, sr) / 0.25);
            const double ref = rbjDb(c.rbj, sr, c.f0, c.g, c.q, f);
            const double err = std::fabs(meas - ref);
            if (ref > -60.0) worst = std::max(worst, err);
            if (err > 0.1 && ref > -60.0) std::printf("     %s f0=%.0f @%.0f Hz: medido %.3f, RBJ %.3f\n", c.rbj, c.f0, f, meas, ref);
        }
    }
    CHECK(worst <= 0.1, "7 tipos × 9 frecuencias: error máximo %.4f dB (≤ 0.1)", worst);
    // Butterworth 48 dB/oct (4 secciones) contra |H|² = 1/(1+(fc/f)^16)
    {
        EqSettings s;
        for (auto& b : s.band) b.on = false;
        s.band[0] = { tHpf, 200.0, 0.0, 0.71, true };
        s.slopeIdx = 3;
        s.analyzer = 0;
        EqEngine e;
        e.setSettings(s);
        e.prepare(sr, 512);
        double w = 0;
        for (double f : { 100.0, 150.0, 200.0, 300.0, 600.0, 2000.0 }) {
            const int n = 96000;
            const Buf x = sine(f, 0.25, sr, n);
            Buf yl, yr;
            e.reset();
            runFx(e, static_cast<EqBus*>(nullptr), x, x, yl, yr, 256);
            const double meas = db(toneAmp(yl, n / 2, n, f, sr) / 0.25);
            // bilineal: frecuencia pre-deformada
            const double fw = std::tan(kPi * f / sr), cw = std::tan(kPi * 200.0 / sr);
            const double ref = -10.0 * std::log10(1.0 + std::pow(cw / fw, 16.0));
            w = std::max(w, std::fabs(meas - ref));
        }
        CHECK(w <= 0.1, "HPF Butterworth 48 dB/oct: error máximo %.4f dB frente a la fórmula analítica", w);
    }
    CHECK(g_allocs.load() == allocs0, "EQ: 0 asignaciones de memoria en process (%lld)", g_allocs.load() - allocs0);
}

// Bandas dinámicas (pool de 24 slots), modos M/S/L/R, pendiente por banda, solo y medición por banda
static void testEqDinamico() {
    std::printf("\n[EQ] bandas dinámicas, modos, pendiente por banda, solo y medición por banda\n");
    using namespace JasWaveEq;
    const double sr = 48000.0;
    const int n = 48000;
    auto gainAt = [&](EqEngine& e, const Buf& xl, const Buf& xr, double f, bool right = false) {
        Buf yl, yr;
        e.reset();
        runFx(e, static_cast<EqBus*>(nullptr), xl, xr, yl, yr, 512);
        const double in = toneAmp(right ? xr : xl, n / 2, n, f, sr);
        return db(toneAmp(right ? yr : yl, n / 2, n, f, sr) / std::max(in, 1e-9));
    };
    auto flat = [] {
        EqSettings s;
        for (auto& b : s.band) { b.on = false; b.used = false; }
        s.analyzer = 0;
        return s;
    };
    // 1) un slot alto (13) usado funciona; sin usar no suena
    {
        EqSettings s = flat();
        s.band[12] = { tPeak, 1000.0, 6.0, 1.0, true, true, 0, mStereo, false };
        EqEngine e; e.setSettings(s); e.prepare(sr, 512);
        const Buf x = sine(1000, 0.25, sr, n);
        const double on = gainAt(e, x, x, 1000);
        s.band[12].used = false;
        e.setSettings(s); e.snap();
        const double off = gainAt(e, x, x, 1000);
        CHECK(std::fabs(on - 6.0) < 0.1 && std::fabs(off) < 0.05, "slot 13 usado: %+.3f dB (esperado +6); sin usar: %+.3f dB (esperado 0)", on, off);
    }
    // 2) las 24 bandas usadas a la vez (+1 dB c/u en 1 kHz) suman como en la fórmula
    {
        EqSettings s = flat();
        for (int b = 0; b < kBands; ++b) s.band[static_cast<size_t>(b)] = { tPeak, 1000.0, 1.0, 1.0, true, true, 0, mStereo, false };
        EqEngine e; e.setSettings(s); e.prepare(sr, 512);
        const Buf x = sine(1000, 0.05, sr, n);
        const double g = gainAt(e, x, x, 1000);
        CHECK(std::fabs(g - 24.0) < 0.2, "24 bandas × +1 dB en 1 kHz = %+.3f dB (esperado +24)", g);
    }
    // 3) modos Mid / Side / Left / Right
    {
        const Buf m = sine(1000, 0.25, sr, n);
        Buf neg(m.size());
        for (size_t i = 0; i < m.size(); ++i) neg[i] = -m[i];
        auto modeGain = [&](int mode, const Buf& xl, const Buf& xr, bool rightCh) {
            EqSettings s = flat();
            s.band[0] = { tPeak, 1000.0, 6.0, 1.0, true, true, 0, mode, false };
            EqEngine e; e.setSettings(s); e.prepare(sr, 512);
            return gainAt(e, xl, xr, 1000, rightCh);
        };
        CHECK(std::fabs(modeGain(mMid, m, m, false) - 6.0) < 0.1 && std::fabs(modeGain(mMid, m, neg, false)) < 0.1,
              "modo Mid: +6 dB solo sobre el centro (L=R) y 0 dB sobre el lateral (L=-R)");
        CHECK(std::fabs(modeGain(mSide, m, neg, false) - 6.0) < 0.1 && std::fabs(modeGain(mSide, m, m, false)) < 0.1,
              "modo Side: +6 dB solo sobre el lateral y 0 dB sobre el centro");
        CHECK(std::fabs(modeGain(mLeft, m, m, false) - 6.0) < 0.1 && std::fabs(modeGain(mLeft, m, m, true)) < 0.05,
              "modo Left: sube L (+6) y deja R intacto");
        CHECK(std::fabs(modeGain(mRight, m, m, true) - 6.0) < 0.1 && std::fabs(modeGain(mRight, m, m, false)) < 0.05,
              "modo Right: sube R (+6) y deja L intacto");
    }
    // 4) pendiente propia de la banda (48 dB/oct) frente a la global (12 dB/oct)
    {
        EqSettings s = flat();
        s.band[0] = { tHpf, 200.0, 0.0, 0.71, true, true, 4, mStereo, false };   // slope 4 = 48 dB/oct propia
        s.slopeIdx = 0;                                                       // global 12 dB/oct
        EqEngine e; e.setSettings(s); e.prepare(sr, 512);
        const Buf x = sine(100.0, 0.25, sr, 2 * n);
        Buf yl, yr;
        e.reset();
        runFx(e, static_cast<EqBus*>(nullptr), x, x, yl, yr, 256);
        const double meas = db(toneAmp(yl, n, 2 * n, 100.0, sr) / 0.25);
        const double fw = std::tan(kPi * 100.0 / sr), cw = std::tan(kPi * 200.0 / sr);
        const double ref = -10.0 * std::log10(1.0 + std::pow(cw / fw, 16.0));
        CHECK(std::fabs(meas - ref) < 0.1, "HPF con pendiente propia de 48 dB/oct a 100 Hz: %.2f dB (analítico %.2f)", meas, ref);
    }
    // 5) solo: se escucha solo la región de la banda
    {
        EqSettings s = flat();
        s.band[3] = { tPeak, 1000.0, 0.0, 1.0, true, true, 0, mStereo, true };
        EqEngine e; e.setSettings(s); e.prepare(sr, 512);
        const double at1k = gainAt(e, sine(1000, 0.25, sr, n), sine(1000, 0.25, sr, n), 1000);
        const double at100 = gainAt(e, sine(100, 0.25, sr, n), sine(100, 0.25, sr, n), 100);
        CHECK(std::fabs(at1k) < 0.5 && at100 < -15.0, "solo: 1 kHz pasa (%.2f dB) y 100 Hz se atenúa (%.1f dB)", at1k, at100);
    }
    // 6) medición por banda: salida − entrada = aporte real de la banda; sin asignaciones en process
    {
        EqSettings s = flat();
        s.band[0] = { tPeak, 1000.0, 6.0, 1.0, true, true, 0, mStereo, false };
        s.band[1] = { tPeak, 6000.0, -9.0, 1.0, true, true, 0, mStereo, false };
        s.analyzer = 0;
        EqEngine e; e.setSettings(s); e.prepare(sr, 512);
        auto bus = std::make_unique<EqBus>();
        bus->editoresAbiertos.store(1);
        const Buf x = sine(1000, 0.25, sr, n);
        Buf yl, yr;
        const long long a0 = g_allocs.load();
        runFx(e, bus.get(), x, x, yl, yr, 512);
        const long long allocs = g_allocs.load() - a0;
        const float in0 = bus->bandInDb[0].load(), out0 = bus->bandOutDb[0].load();
        const float in1 = bus->bandInDb[1].load(), out1 = bus->bandOutDb[1].load();
        const float in2 = bus->bandInDb[2].load();
        CHECK(std::fabs((out0 - in0) - 6.0f) < 0.5f, "medición banda 1 (+6 dB en 1 kHz): aporte medido %+.2f dB", out0 - in0);
        CHECK(in0 > -40.0f && in1 < in0 - 8.0f, "señal real por banda: banda 1 ve el tono (%.1f dB) y banda 2 (6 kHz) bastante menos (%.1f dB)", in0, in1);
        CHECK(std::fabs(out1 - in1) < 1.5f || in1 < -60.0f, "banda 2 sin señal relevante: aporte %+.2f dB", out1 - in1);
        CHECK(in2 <= kBandFloorDb + 0.01f, "banda sin usar/apagada: medición en el piso (%.0f dB)", in2);
        CHECK(allocs == 0, "EQ con medición por banda: 0 asignaciones en process (%lld)", allocs);
    }
    // 7) los IDs de las 8 bandas heredadas no cambian y los nuevos no colisionan
    {
        bool legacy = bandParam(0, fType) == 1u && bandParam(7, fOn) == 40u && kOutput == 41u && kSlope == 42u && kAnalyzer == 43u;
        std::vector<uint32_t> ids;
        for (const auto& d : paramDefs()) ids.push_back(d.id);
        std::sort(ids.begin(), ids.end());
        const bool unique = std::adjacent_find(ids.begin(), ids.end()) == ids.end();
        CHECK(legacy, "IDs heredados intactos (banda 1 = 1..5, banda 8 = 36..40, out 41, pendiente 42, analizador 43)");
        CHECK(unique && static_cast<int>(ids.size()) == 1 + 5 * kBands + 3 + 4 * kBands, "%zu parámetros, todos con ID único", ids.size());
    }
}

static void testComp() {
    std::printf("\n[COMPRESOR] curva estática (umbral/ratio/rodilla)\n");
    using namespace JasWaveComp;
    const double sr = 48000.0;
    double worst = 0;
    for (double knee : { 0.0, 12.0 }) {
        for (double inDb : { -40.0, -26.0, -20.0, -14.0, -6.0, 0.0 }) {
            CompSettings s;
            s.thrDb = -20; s.ratio = 4; s.kneeDb = knee; s.attackMs = 1; s.releaseMs = 40; s.makeupDb = 0; s.mix = 1; s.rms = true;
            CompressorEngine e;
            e.setSettings(s);
            e.prepare(sr, 512);
            const int n = 48000;
            const Buf x = sine(997.0, std::pow(10.0, inDb / 20.0), sr, n);
            Buf yl, yr;
            runFx(e, static_cast<CompBus*>(nullptr), x, x, yl, yr, 512);
            const double gain = db(rms(yl, n / 2, n) / rms(x, n / 2, n));
            const double expect = staticOutDb(inDb, -20, 4, knee) - inDb;
            worst = std::max(worst, std::fabs(gain - expect));
            if (std::fabs(gain - expect) > 0.25) std::printf("     knee %.0f in %.0f: ganancia %.3f, esperada %.3f\n", knee, inDb, gain, expect);
        }
    }
    CHECK(worst <= 0.25, "umbral −20 dB, 4:1, rodilla 0/12 dB: error máximo %.3f dB (≤ 0.25, detector RMS)", worst);
    CHECK(std::fabs(staticOutDb(-10, -20, 4, 0) - (-17.5)) < 1e-12 && std::fabs(staticOutDb(-30, -20, 4, 0) - (-30)) < 1e-12, "curva estática exacta: −10 dB → −17.5 dB, −30 dB intacto");
}

static void testLimiter() {
    std::printf("\n[LIMITADOR] true-peak de salida ≤ techo (16× y 4× BS.1770) en señales difíciles\n");
    using namespace JasWaveLimiter;
    for (double sr : { 44100.0, 48000.0, 96000.0 }) {
        const int n = static_cast<int>(sr * 1.5);
        std::mt19937 rng(7);
        std::normal_distribution<double> nd(0.0, 0.5);
        struct Sig { const char* name; Buf x; double gain; };
        std::vector<Sig> sigs;
        sigs.push_back({ "seno fs/4 a 45° (+3 dB entre muestras)", sine(sr / 4.0, 0.9, sr, n, kPi / 4.0), 12.0 });
        Buf sq(static_cast<size_t>(n));
        for (int i = 0; i < n; ++i) sq[static_cast<size_t>(i)] = std::sin(2 * kPi * 997.0 * i / sr) >= 0 ? 0.95 : -0.95;
        sigs.push_back({ "cuadrada 997 Hz a fondo de escala", sq, 9.0 });
        Buf wn(static_cast<size_t>(n));
        for (auto& v : wn) v = std::clamp(nd(rng), -1.0, 1.0);
        sigs.push_back({ "ruido blanco +20 dB", wn, 20.0 });
        Buf imp(static_cast<size_t>(n), 0.0);
        for (int i = 1000; i < n; i += 3001) imp[static_cast<size_t>(i)] = (i / 3001) % 2 ? 1.0 : -1.0;
        sigs.push_back({ "impulsos alternos", imp, 6.0 });
        Buf sw(static_cast<size_t>(n));
        double ph = 0;
        for (int i = 0; i < n; ++i) { const double f = 20.0 * std::pow(1000.0, static_cast<double>(i) / n); ph += 2 * kPi * f / sr; sw[static_cast<size_t>(i)] = 0.8 * std::sin(ph); }
        sigs.push_back({ "barrido 20 Hz–20 kHz", sw, 15.0 });
        for (const auto& sg : sigs) {
            for (double ceilDb : { -1.0, -0.1 }) {
                LimiterSettings s;
                s.ceilingDb = ceilDb; s.gainDb = sg.gain; s.releaseMs = 50; s.lookaheadMs = 2.0; s.loudness = false;
                LimiterEngine e;
                e.setSettings(s);
                e.prepare(sr, 512);
                Buf yl, yr;
                runFx(e, static_cast<LimiterBus*>(nullptr), sg.x, sg.x, yl, yr, 512);
                const double tp16 = db(std::max(truePeak16(yl, 0), truePeak16(yr, 0)));
                const double tp4 = db(std::max(truePeak4(yl, 0), truePeak4(yr, 0)));
                double spk = 0;
                for (size_t i = 0; i < yl.size(); ++i) spk = std::max(spk, std::max(std::fabs(yl[i]), std::fabs(yr[i])));
                CHECK(tp16 <= ceilDb + 1e-9 && tp4 <= ceilDb + 1e-9 && allFinite(yl), "%.1f kHz %-38s techo %.1f: TP16 %.3f / TP4(BS.1770) %.3f dBTP (pico muestra %.3f dBFS)", sr / 1000, sg.name, ceilDb, tp16, tp4, db(spk));
            }
        }
    }
    // latencia exacta: impulso sin limitación aparece en D muestras
    {
        LimiterSettings s;
        s.ceilingDb = 0.0; s.gainDb = 0.0; s.lookaheadMs = 5.0; s.loudness = false;
        LimiterEngine e;
        e.setSettings(s);
        e.prepare(48000.0, 512);
        Buf x(4096, 0.0);
        x[100] = 0.5;
        Buf yl, yr;
        runFx(e, static_cast<LimiterBus*>(nullptr), x, x, yl, yr, 64);
        int at = -1;
        for (int i = 0; i < 4096; ++i) if (std::fabs(yl[static_cast<size_t>(i)] - 0.5) < 1e-6) at = i;
        CHECK(at == 100 + static_cast<int>(e.latencySamples()), "latencia reportada %u muestras = retardo medido %d (lookahead 5 ms dentro de latencia fija)", e.latencySamples(), at - 100);
    }
}

static void testDeEsser() {
    std::printf("\n[DE-ESSER] banda sibilante reducida, resto intacto\n");
    using namespace JasWaveDeEsser;
    const double sr = 48000.0;
    const int n = 96000;
    Buf x(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) x[static_cast<size_t>(i)] = 0.3 * std::sin(2 * kPi * 300.0 * i / sr) + 0.3 * std::sin(2 * kPi * 7000.0 * i / sr);
    for (int wide = 0; wide <= 1; ++wide) {
        DeEsserSettings s;
        s.freqHz = 5000; s.thrDb = -30; s.rangeDb = 12; s.wide = wide == 1; s.releaseMs = 80;
        DeEsserEngine e;
        e.setSettings(s);
        e.prepare(sr, 512);
        Buf yl, yr;
        runFx(e, static_cast<DeEsserBus*>(nullptr), x, x, yl, yr, 256);
        const double low = db(toneAmp(yl, n / 2, n, 300.0, sr) / 0.3), high = db(toneAmp(yl, n / 2, n, 7000.0, sr) / 0.3);
        if (!wide) {
            CHECK(std::fabs(low) < 0.1 && high < -6.0, "split: 300 Hz %+.3f dB (|·|<0.1), 7 kHz %+.2f dB (< −6)", low, high);
        } else {
            CHECK(low < -6.0 && high < -6.0, "wide: reducción de banda completa (300 Hz %+.2f dB, 7 kHz %+.2f dB)", low, high);
        }
    }
    // sin sibilancia: el cruce LR4 es plano (suma de magnitud 0 dB)
    {
        DeEsserSettings s;
        s.freqHz = 6000; s.thrDb = 0; s.rangeDb = 12;
        DeEsserEngine e;
        e.setSettings(s);
        e.prepare(sr, 512);
        double w = 0;
        for (double f : { 100.0, 1000.0, 5000.0, 6000.0, 7000.0, 15000.0 }) {
            const Buf t = sine(f, 0.05, sr, 48000);
            Buf yl, yr;
            e.reset();
            runFx(e, static_cast<DeEsserBus*>(nullptr), t, t, yl, yr, 512);
            w = std::max(w, std::fabs(db(toneAmp(yl, 24000, 48000, f, sr) / 0.05)));
        }
        CHECK(w < 0.05, "sin reducción, cruce LR4 plano: desviación máxima %.4f dB", w);
    }
}

static void testUtility() {
    std::printf("\n[UTILITY] fase, swap, M/S, mono-graves, balance, DC\n");
    using namespace JasWaveUtility;
    const double sr = 48000.0;
    const int n = 48000;
    const Buf l = sine(1000, 0.5, sr, n), r = sine(1000, 0.25, sr, n, 0.6);
    auto run = [&](const UtilitySettings& s, const Buf& a, const Buf& b, Buf& oa, Buf& ob) {
        UtilityEngine e;
        e.setSettings(s);
        e.prepare(sr, 512);
        runFx(e, static_cast<UtilityBus*>(nullptr), a, b, oa, ob, 512);
    };
    Buf ol, orr;
    UtilitySettings s;
    s.invL = true;
    run(s, l, r, ol, orr);
    double e1 = 0;
    for (int i = 0; i < n; ++i) e1 = std::max(e1, std::fabs(ol[static_cast<size_t>(i)] + l[static_cast<size_t>(i)]) + std::fabs(orr[static_cast<size_t>(i)] - r[static_cast<size_t>(i)]));
    CHECK(e1 < 1e-9, "inversión de fase L exacta (error %.2e)", e1);
    s = UtilitySettings{};
    s.swap = true;
    run(s, l, r, ol, orr);
    e1 = 0;
    for (int i = 0; i < n; ++i) e1 = std::max(e1, std::fabs(ol[static_cast<size_t>(i)] - r[static_cast<size_t>(i)]) + std::fabs(orr[static_cast<size_t>(i)] - l[static_cast<size_t>(i)]));
    CHECK(e1 < 1e-9, "intercambio L/R exacto (error %.2e)", e1);
    s = UtilitySettings{};
    s.width = 0.0;
    run(s, l, r, ol, orr);
    e1 = 0;
    for (int i = 0; i < n; ++i) e1 = std::max(e1, std::fabs(ol[static_cast<size_t>(i)] - orr[static_cast<size_t>(i)]));
    CHECK(e1 < 1e-9, "ancho 0 %% → mono exacto (L−R máx %.2e)", e1);
    s.width = 2.0;
    run(s, l, r, ol, orr);
    double sideIn = 0, sideOut = 0, midErr = 0;
    for (int i = n / 2; i < n; ++i) {
        const size_t k = static_cast<size_t>(i);
        sideIn += std::pow(0.5 * (l[k] - r[k]), 2); sideOut += std::pow(0.5 * (ol[k] - orr[k]), 2);
        midErr = std::max(midErr, std::fabs(0.5 * (ol[k] + orr[k]) - 0.5 * (l[k] + r[k])));
    }
    CHECK(std::fabs(db(std::sqrt(sideOut / sideIn)) - db(2.0)) < 0.01 && midErr < 1e-9, "ancho 200 %%: Side ×2 (%+.3f dB), Mid intacto", db(std::sqrt(sideOut / sideIn)));
    // mono-graves 120 Hz: 40 Hz en antifase → Side atenuado; 1 kHz conservado
    s = UtilitySettings{};
    s.monoBelowHz = 120.0;
    const Buf a40 = sine(40, 0.5, sr, n), b40 = sine(40, -0.5, sr, n);
    run(s, a40, b40, ol, orr);
    const double side40 = db(rms(ol, n / 2, n) / rms(a40, n / 2, n));
    const Buf a1k = sine(1000, 0.5, sr, n), b1k = sine(1000, -0.5, sr, n);
    run(s, a1k, b1k, ol, orr);
    const double side1k = db(rms(ol, n / 2, n) / rms(a1k, n / 2, n));
    CHECK(side40 < -20.0 && std::fabs(side1k) < 0.5, "mono-graves 120 Hz: Side 40 Hz %.1f dB (< −20), Side 1 kHz %+.2f dB", side40, side1k);
    // balance −1: R a 0, L intacto
    s = UtilitySettings{};
    s.balance = -1.0;
    run(s, l, r, ol, orr);
    CHECK(rms(orr, n / 2, n) < 1e-9 && std::fabs(db(rms(ol, n / 2, n) / rms(l, n / 2, n))) < 1e-6, "balance totalmente a la izquierda: R silenciado, L a 0 dB");
    // DC: offset +0.3 eliminado
    s = UtilitySettings{};
    s.dc = true;
    Buf dcIn(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) dcIn[static_cast<size_t>(i)] = 0.3 + l[static_cast<size_t>(i)] * 0.2;
    run(s, dcIn, dcIn, ol, orr);
    double mean = 0;
    for (int i = n / 2; i < n; ++i) mean += ol[static_cast<size_t>(i)];
    mean /= (n / 2);
    CHECK(std::fabs(mean) < 1e-3, "filtro DC: media residual %.2e", mean);
}

static double measurePitch(const Buf& x, int from, int to, double guess, double sr) {
    // máximo de la DTFT con ventana de Hann alrededor de la conjetura, refinado por búsqueda dorada
    auto mag = [&](double f) {
        double c = 0, s = 0;
        const int N = to - from;
        for (int i = 0; i < N; ++i) {
            const double w = 0.5 - 0.5 * std::cos(2 * kPi * i / (N - 1));
            const double ph = 2 * kPi * f * (from + i) / sr;
            c += w * x[static_cast<size_t>(from + i)] * std::cos(ph);
            s += w * x[static_cast<size_t>(from + i)] * std::sin(ph);
        }
        return c * c + s * s;
    };
    double lo = guess * std::pow(2.0, -30.0 / 1200), hi = guess * std::pow(2.0, 30.0 / 1200);
    // barrido grueso
    double best = guess, bm = -1;
    for (int k = 0; k <= 60; ++k) { const double f = lo * std::pow(hi / lo, k / 60.0); const double m = mag(f); if (m > bm) { bm = m; best = f; } }
    lo = best * std::pow(2.0, -1.5 / 1200); hi = best * std::pow(2.0, 1.5 / 1200);
    for (int it = 0; it < 40; ++it) {
        const double a = lo + (hi - lo) * 0.382, b = lo + (hi - lo) * 0.618;
        if (mag(a) > mag(b)) hi = b; else lo = a;
    }
    return 0.5 * (lo + hi);
}

static void testPiano() {
    std::printf("\n[PIANO] afinación, polifonía, denormales\n");
    using namespace JasWavePiano;
    for (double sr : { 44100.0, 48000.0, 96000.0 }) {
        for (double a4 : { 440.0, 442.0 }) {
            PianoEngine e;
            PianoSettings s;
            s.a4 = a4;
            e.setSettings(s);
            e.prepare(sr, 512);
            const int n = static_cast<int>(sr * 2.0);
            Buf L(static_cast<size_t>(n), 0.0), R(static_cast<size_t>(n), 0.0);
            {
                ProcessScope ps;
                e.noteOn(69, 0.8f);
                for (int p = 0; p < n; p += 256) e.render(L.data() + p, R.data() + p, std::min(256, n - p), nullptr);
            }
            const double f = measurePitch(L, static_cast<int>(sr * 0.2), n, a4, sr);
            const double cents = 1200.0 * std::log2(f / a4);
            CHECK(std::fabs(cents) <= 1.0, "%.1f kHz LA4=%.0f: medido %.3f Hz (%+.3f cents, ≤ ±1)", sr / 1000, a4, f, cents);
        }
    }
    // octavas: C2, C4, C6 contra temperamento igual
    {
        PianoEngine e;
        PianoSettings s;
        e.setSettings(s);
        e.prepare(48000.0, 512);
        double worst = 0;
        for (int note : { 36, 60, 84 }) {
            e.reset();
            const int n = 96000;
            Buf L(static_cast<size_t>(n), 0.0), R(static_cast<size_t>(n), 0.0);
            e.noteOn(note, 0.8f);
            for (int p = 0; p < n; p += 256) e.render(L.data() + p, R.data() + p, 256, nullptr);
            const double ref = 440.0 * std::pow(2.0, (note - 69) / 12.0);
            worst = std::max(worst, std::fabs(1200.0 * std::log2(measurePitch(L, 9600, n, ref, 48000.0) / ref)));
        }
        CHECK(worst <= 1.0, "C2/C4/C6: desviación máxima %.3f cents", worst);
    }
    // polifonía
    for (int maxV : { kBasicVoices, kMaxVoices }) {
        PianoEngine e;
        PianoSettings s;
        s.maxVoices = maxV;
        e.setSettings(s);
        e.prepare(48000.0, 512);
        Buf L(512, 0.0), R(512, 0.0);
        ProcessScope ps;
        for (int k = 0; k < 80; ++k) e.noteOn(24 + k, 0.7f);
        for (int b = 0; b < 4; ++b) { std::fill(L.begin(), L.end(), 0.0); std::fill(R.begin(), R.end(), 0.0); e.render(L.data(), R.data(), 512, nullptr); }
        CHECK(e.activeVoices() == maxV && allFinite(L), "80 notas con límite %d → %d voces activas, sin NaN", maxV, e.activeVoices());
    }
    // denormales: tras soltar, la salida llega a 0 exacto y las voces se liberan
    {
        PianoEngine e;
        PianoSettings s;
        s.releaseS = 0.1;
        e.setSettings(s);
        e.prepare(48000.0, 512);
        Buf L(512, 0.0), R(512, 0.0);
        e.noteOn(40, 1.0f);
        e.noteOn(64, 1.0f);
        bool denorm = false;
        for (int b = 0; b < 600; ++b) {
            if (b == 50) { e.noteOff(40); e.noteOff(64); }
            std::fill(L.begin(), L.end(), 0.0); std::fill(R.begin(), R.end(), 0.0);
            e.render(L.data(), R.data(), 512, nullptr);
            for (double v : L) if (v != 0.0 && std::fabs(v) < DBL_MIN) denorm = true;
        }
        CHECK(!denorm && e.activeVoices() == 0 && L[511] == 0.0, "release: voces liberadas (%d), salida 0 exacta, sin denormales", e.activeVoices());
    }
}

// Tamaños de bloque y frecuencias de muestreo: mismas muestras con bloques 1/64/512/4096
template <class E, class Bus, class Setup>
static void blockSizeInvariance(const char* name, Setup setup) {
    const double sr = 48000.0;
    const int n = 16384;
    std::mt19937 rng(3);
    std::uniform_real_distribution<double> ud(-0.8, 0.8);
    Buf a(static_cast<size_t>(n)), b(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) { a[static_cast<size_t>(i)] = ud(rng) * 0.5 + 0.4 * std::sin(i * 0.05); b[static_cast<size_t>(i)] = ud(rng) * 0.5; }
    Buf refL, refR;
    double worst = 0;
    bool finite = true;
    for (int block : { 4096, 512, 64, 1 }) {
        E e;
        setup(e);
        e.prepare(sr, 4096);
        Buf yl, yr;
        runFx(e, static_cast<Bus*>(nullptr), a, b, yl, yr, block);
        finite = finite && allFinite(yl) && allFinite(yr);
        if (refL.empty()) { refL = yl; refR = yr; continue; }
        for (int i = 0; i < n; ++i) worst = std::max(worst, std::max(std::fabs(yl[static_cast<size_t>(i)] - refL[static_cast<size_t>(i)]), std::fabs(yr[static_cast<size_t>(i)] - refR[static_cast<size_t>(i)])));
    }
    CHECK(worst < 1e-6 && finite, "%-12s bloques 1/64/512/4096 idénticos (dif. máx %.2e), finitos", name, worst);
    // frecuencias de muestreo y entradas extremas
    bool ok = true;
    for (double rate : { 44100.0, 88200.0, 96000.0, 176400.0, 192000.0 }) {
        E e;
        setup(e);
        e.prepare(rate, 512);
        Buf x(8192), yl, yr;
        for (int i = 0; i < 8192; ++i) x[static_cast<size_t>(i)] = (i % 997 == 0) ? 8.0 : (i % 3 == 0 ? 1e-310 : std::sin(i * 0.3) * 0.9);
        runFx(e, static_cast<Bus*>(nullptr), x, x, yl, yr, 333);
        ok = ok && allFinite(yl) && allFinite(yr);
    }
    CHECK(ok, "%-12s 44.1/88.2/96/176.4/192 kHz con impulsos +18 dB y denormales: salida finita", name);
}

static void testInvariance() {
    std::printf("\n[TODOS] bloques, frecuencias de muestreo, NaN/Inf, asignaciones\n");
    const long long allocs0 = g_allocs.load();
    blockSizeInvariance<JasWaveEq::EqEngine, JasWaveEq::EqBus>("EQ", [](JasWaveEq::EqEngine& e) {
        JasWaveEq::EqSettings s;
        s.band[2].gainDb = 6; s.band[3].gainDb = -4; s.band[0].on = true; s.slopeIdx = 2; s.analyzer = 0;
        e.setSettings(s);
    });
    blockSizeInvariance<JasWaveComp::CompressorEngine, JasWaveComp::CompBus>("Compresor", [](JasWaveComp::CompressorEngine& e) {
        JasWaveComp::CompSettings s;
        s.thrDb = -24; s.ratio = 6; s.scHpfHz = 120; s.mix = 0.8;
        e.setSettings(s);
    });
    blockSizeInvariance<JasWaveLimiter::LimiterEngine, JasWaveLimiter::LimiterBus>("Limitador", [](JasWaveLimiter::LimiterEngine& e) {
        JasWaveLimiter::LimiterSettings s;
        s.gainDb = 10; s.loudness = false;
        e.setSettings(s);
    });
    blockSizeInvariance<JasWaveDeEsser::DeEsserEngine, JasWaveDeEsser::DeEsserBus>("De-esser", [](JasWaveDeEsser::DeEsserEngine& e) {
        JasWaveDeEsser::DeEsserSettings s;
        s.thrDb = -40; s.relative = true;
        e.setSettings(s);
    });
    blockSizeInvariance<JasWaveUtility::UtilityEngine, JasWaveUtility::UtilityBus>("Utility", [](JasWaveUtility::UtilityEngine& e) {
        JasWaveUtility::UtilitySettings s;
        s.width = 1.4; s.monoBelowHz = 100; s.dc = true; s.balance = 0.2;
        e.setSettings(s);
    });
    // Con buses de telemetría (la ruta real del plugin) también sin asignaciones
    {
        auto eqBus = std::make_unique<JasWaveEq::EqBus>();
        auto compBus = std::make_unique<JasWaveComp::CompBus>();
        auto limBus = std::make_unique<JasWaveLimiter::LimiterBus>();
        auto deBus = std::make_unique<JasWaveDeEsser::DeEsserBus>();
        auto utBus = std::make_unique<JasWaveUtility::UtilityBus>();
        limBus->loudness.prepare(48000.0);
        JasWaveEq::EqEngine eq; eq.prepare(48000, 512);
        JasWaveComp::CompressorEngine cp; cp.prepare(48000, 512);
        JasWaveLimiter::LimiterEngine lm; lm.prepare(48000, 512);
        JasWaveDeEsser::DeEsserEngine de; de.prepare(48000, 512);
        JasWaveUtility::UtilityEngine ut; ut.prepare(48000, 512);
        const Buf x = sine(440, 0.7, 48000, 8192);
        Buf yl, yr;
        const long long before = g_allocs.load();
        runFx(eq, eqBus.get(), x, x, yl, yr, 512);
        runFx(cp, compBus.get(), x, x, yl, yr, 512);
        runFx(lm, limBus.get(), x, x, yl, yr, 512);
        runFx(de, deBus.get(), x, x, yl, yr, 512);
        runFx(ut, utBus.get(), x, x, yl, yr, 512);
        // instrumentos
        JasWavePiano::PianoEngine pn;
        pn.prepare(48000, 512);
        auto pnBus = std::make_unique<JasWavePiano::PianoBus>();
        JasWaveRoles::RolesEngine rl;
        rl.prepare(48000);
        std::vector<float> fl(512), fr(512);
        Buf L(512, 0.0), R(512, 0.0);
        {
            ProcessScope ps;
            for (int k = 0; k < 70; ++k) pn.noteOn(30 + k, 0.6f);
            for (int b = 0; b < 20; ++b) pn.render(L.data(), R.data(), 512, pnBus.get());
            for (int role = 0; role < JasWaveRoles::kNumRoles; ++role) {
                rl.setRole(role);
                for (int k = 0; k < 8; ++k) rl.noteOn(static_cast<int16_t>(36 + k * 5), 0.8f, 0);
                for (int b = 0; b < 4; ++b) rl.render(fl.data(), fr.data(), 512);
            }
        }
        bool finite = true;
        for (float v : fl) finite = finite && std::isfinite(v);
        CHECK(g_allocs.load() == before && finite, "process de los 7 motores (con telemetría, 70 notas de piano, 13 roles): 0 asignaciones, salida finita");
    }
    CHECK(g_allocs.load() == allocs0, "total en secciones process: %lld asignaciones", g_allocs.load() - allocs0);
}

// =====================================================================================
//  V3: espectro IN/OUT solo con el editor abierto, balística de 14 dB/s y 0 asignaciones con taps
// =====================================================================================
static void testV3Visualizacion() {
    std::printf("\n[V3] taps IN/OUT, coste cero con el editor cerrado y balística por tiempo\n");
    const Buf x = sine(1000, 0.5, 48000, 16384);
    Buf yl, yr;
    // 1) editor cerrado: el procesador no escribe en los taps (ni scope ni vectorscopio)
    {
        auto bus = std::make_unique<JasWaveComp::CompBus>();
        auto ut = std::make_unique<JasWaveUtility::UtilityBus>();
        JasWaveComp::CompressorEngine cp; cp.prepare(48000, 512);
        JasWaveUtility::UtilityEngine u; u.prepare(48000, 512);
        runFx(cp, bus.get(), x, x, yl, yr, 512);
        runFx(u, ut.get(), x, x, yl, yr, 512);
        CHECK(bus->espIn.escritas() == 0 && bus->espOut.escritas() == 0 && ut->espIn.escritas() == 0,
              "editor cerrado: taps IN/OUT sin alimentar (comp %llu/%llu, utility %llu)", static_cast<unsigned long long>(bus->espIn.escritas()),
              static_cast<unsigned long long>(bus->espOut.escritas()), static_cast<unsigned long long>(ut->espIn.escritas()));
        // 2) editor abierto: entrada y salida reciben exactamente las muestras procesadas, sin asignar memoria
        bus->editoresAbiertos.store(1);
        ut->editoresAbiertos.store(1);
        const long long before = g_allocs.load();
        runFx(cp, bus.get(), x, x, yl, yr, 512);
        runFx(u, ut.get(), x, x, yl, yr, 512);
        CHECK(bus->espIn.escritas() == x.size() && bus->espOut.escritas() == x.size() && ut->espOut.escritas() == x.size(),
              "editor abierto: taps IN y OUT con %zu muestras cada uno", x.size());
        CHECK(g_allocs.load() == before, "process con taps IN/OUT activos: 0 asignaciones (%lld)", g_allocs.load() - before);
        bus->editoresAbiertos.store(0);
        const uint64_t w = bus->espIn.escritas();
        runFx(cp, bus.get(), x, x, yl, yr, 512);
        CHECK(bus->espIn.escritas() == w, "al cerrar el editor los taps dejan de alimentarse");
    }
    // 3) los 7 procesadores publican IN y OUT (los instrumentos, OUT y la velocidad MIDI)
    {
        auto eqB = std::make_unique<JasWaveEq::EqBus>();
        auto limB = std::make_unique<JasWaveLimiter::LimiterBus>();
        auto deB = std::make_unique<JasWaveDeEsser::DeEsserBus>();
        auto pnB = std::make_unique<JasWavePiano::PianoBus>();
        for (JasWaveDsp::MeterBusBase* b : { static_cast<JasWaveDsp::MeterBusBase*>(eqB.get()), static_cast<JasWaveDsp::MeterBusBase*>(limB.get()),
                                             static_cast<JasWaveDsp::MeterBusBase*>(deB.get()), static_cast<JasWaveDsp::MeterBusBase*>(pnB.get()) })
            b->editoresAbiertos.store(1);
        limB->loudness.prepare(48000.0);
        JasWaveEq::EqEngine eq; eq.prepare(48000, 512);
        JasWaveEq::EqSettings es; es.analyzer = 2; eq.setSettings(es);
        JasWaveLimiter::LimiterEngine lm; lm.prepare(48000, 512);
        JasWaveDeEsser::DeEsserEngine de; de.prepare(48000, 512);
        runFx(eq, eqB.get(), x, x, yl, yr, 512);
        runFx(lm, limB.get(), x, x, yl, yr, 512);
        runFx(de, deB.get(), x, x, yl, yr, 512);
        JasWavePiano::PianoEngine pn; pn.prepare(48000, 512);
        Buf L(512, 0.0), R(512, 0.0);
        pn.noteOn(60, 0.8f);
        for (int b = 0; b < 4; ++b) pn.render(L.data(), R.data(), 512, pnB.get());
        CHECK(eqB->espIn.escritas() > 0 && eqB->espOut.escritas() > 0 && limB->espIn.escritas() > 0 && limB->espOut.escritas() > 0 &&
                  deB->espIn.escritas() > 0 && deB->espOut.escritas() > 0 && pnB->espOut.escritas() == 2048,
              "EQ, limitador, de-esser y piano publican el espectro IN/OUT con el editor abierto");
    }
    // 4) balística: ataque instantáneo y caída de 14 dB/s (independiente de los fps)
    {
        JasWaveDsp::SpectrumTap tap;
        std::vector<float> s(8192);
        for (int i = 0; i < 8192; ++i) s[static_cast<size_t>(i)] = static_cast<float>(0.5 * std::sin(2.0 * 3.14159265358979 * 1500.0 * i / 48000.0));
        tap.push(s.data(), nullptr, 8192);
        JasWaveDsp::SpectrumAnalyzer an;
        std::vector<float> c0, c1, c2;
        an.updateBalistica(tap, 48000.0, 1.0f / 60.0f, 14.0f);
        an.columns(c0, 64, 20.0, 20000.0, 0.0);
        const auto peak = [](const std::vector<float>& v) { float m = -400.0f; for (float d : v) m = std::max(m, d); return m; };
        const float p0 = peak(c0);
        // sin audio nuevo: 0.25 s (el dt máximo admitido) → −3.5 dB; 2 frames de 30 fps (=1/15 s) → −0.933 dB; igual a 1 frame de 1/15 s
        an.updateBalistica(tap, 48000.0, 0.25f, 14.0f);
        an.columns(c1, 64, 20.0, 20000.0, 0.0);
        JasWaveDsp::SpectrumAnalyzer a30, a15;
        a30.updateBalistica(tap, 48000.0, 0.0f, 14.0f);
        a15.updateBalistica(tap, 48000.0, 0.0f, 14.0f);
        a30.updateBalistica(tap, 48000.0, 1.0f / 30.0f, 14.0f);
        a30.updateBalistica(tap, 48000.0, 1.0f / 30.0f, 14.0f);
        a15.updateBalistica(tap, 48000.0, 1.0f / 15.0f, 14.0f);
        std::vector<float> d30, d15;
        a30.columns(d30, 64, 20.0, 20000.0, 0.0);
        a15.columns(d15, 64, 20.0, 20000.0, 0.0);
        CHECK(p0 > -12.0f, "ataque instantáneo: pico del seno a %.2f dBFS en el primer frame", p0);
        CHECK(std::fabs((p0 - peak(c1)) - 3.5f) < 0.01f, "caída sin señal: %.3f dB en 0.25 s (14 dB/s → 3.5 dB)", p0 - peak(c1));
        CHECK(std::fabs(peak(d30) - peak(d15)) < 0.01f, "misma caída a 30 fps que a 15 fps (%.3f vs %.3f dBFS)", peak(d30), peak(d15));
    }
}

static void testAudioLens() {
    std::printf("-- AudioLens (Análisis Beatbox y Audio Descriptor) --\n");
    const double sr = 44100.0;
    const size_t nSamples = static_cast<size_t>(sr * 1.5);
    std::vector<float> audio(nSamples, 0.0f);

    // 1. Kick a 60 Hz en t = 0.1s
    const size_t kickIdx = static_cast<size_t>(0.1 * sr);
    for (size_t i = 0; i < 2000; ++i) {
        float t = static_cast<float>(i) / sr;
        audio[kickIdx + i] = 0.9f * std::exp(-t * 25.0f) * std::sin(2.0f * 3.14159f * 60.0f * t);
    }

    // 2. Hi-Hat agudo a 8000 Hz en t = 0.8s
    const size_t hatIdx = static_cast<size_t>(0.8 * sr);
    for (size_t i = 0; i < 800; ++i) {
        float t = static_cast<float>(i) / sr;
        audio[hatIdx + i] = 0.8f * std::exp(-t * 80.0f) * std::sin(2.0f * 3.14159f * 8000.0f * t);
    }

    auto res = AudioLensEngine::analyze(audio.data(), nSamples, sr, 120.0, true);
    CHECK(res.drumHits.size() >= 2, "detecta al menos 2 golpes en la señal (detectados: %zu)", res.drumHits.size());
    CHECK(res.kickCount >= 1, "detecta al menos 1 kick (detectados: %d)", res.kickCount);
    CHECK(res.hihatCount >= 1, "detecta al menos 1 hi-hat (detectados: %d)", res.hihatCount);
    CHECK(!res.aiSummary.empty(), "genera resumen para IA no vacío");
}

int main() {
    std::printf("JasWave DSP selftest\n");
    testV3Visualizacion();
    testEq();
    testEqDinamico();
    testComp();
    testLimiter();
    testDeEsser();
    testUtility();
    testPiano();
    testInvariance();
    testAudioLens();
    std::printf("\n%d OK, %d FALLOS\n", g_pass, g_fail);
    std::printf(g_fail == 0 ? "DSP SELFTEST: OK\n" : "DSP SELFTEST: FALLO\n");
    return g_fail == 0 ? 0 : 1;
}
