// Autoverificación numérica del DSP de JasWave (sin SDK, sin UI).
// Verifica que el audio NO se daña: respuesta del EQ, curva estática del compresor,
// techo true-peak del limitador, latencia exacta, bypass transparente, LUFS y espectro reales.
#define _USE_MATH_DEFINES
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <random>

#include "../com.jaswave.plugin.param-eq/src/param_eq_dsp.h"
#include "../com.jaswave.plugin.bus-compressor/src/bus_compressor_dsp.h"
#include "../com.jaswave.plugin.truepeak-limiter/src/truepeak_limiter_dsp.h"

using namespace JasWaveDsp;

static int g_fail = 0, g_pass = 0;
#define CHECK(cond, ...) do { if (cond) { ++g_pass; std::printf("  [ OK ] "); } else { ++g_fail; std::printf("  [FAIL] "); } std::printf(__VA_ARGS__); std::printf("\n"); } while (0)

static const double kSr = 48000.0;

static std::vector<float> sine(double f, double ampDb, double sr, int n, double phase = 0.0) {
    std::vector<float> v(static_cast<size_t>(n));
    const double a = dbToLinear(ampDb);
    for (int i = 0; i < n; ++i) v[static_cast<size_t>(i)] = static_cast<float>(a * std::sin(2.0 * kPi * f * i / sr + phase));
    return v;
}
static double rmsDb(const std::vector<float>& x, int from, int to) {
    double s = 0; for (int i = from; i < to; ++i) s += static_cast<double>(x[static_cast<size_t>(i)]) * x[static_cast<size_t>(i)];
    return 10.0 * std::log10(std::max(1e-30, s / (to - from)));
}
static double peakAbs(const std::vector<float>& x, int from = 0) {
    double p = 0; for (size_t i = static_cast<size_t>(from); i < x.size(); ++i) p = std::max(p, static_cast<double>(std::fabs(x[i]))); return p;
}
// True-peak de referencia: sobremuestreo 16x con sinc de 64 taps/fase (Blackman), independiente del detector del plugin
static double referenceTruePeak(const std::vector<float>& x, int from) {
    const int os = 16, half = 32;
    double best = 0.0;
    std::vector<double> h(static_cast<size_t>(2 * half * os + 1));
    for (int i = 0; i < static_cast<int>(h.size()); ++i) {
        const double t = (i - half * os) / static_cast<double>(os);
        const double s = (t == 0.0) ? 1.0 : std::sin(kPi * t) / (kPi * t);
        const double r = static_cast<double>(i) / (h.size() - 1);
        const double w = 0.42 - 0.5 * std::cos(2 * kPi * r) + 0.08 * std::cos(4 * kPi * r);
        h[static_cast<size_t>(i)] = s * w;
    }
    for (int n = std::max(from, half); n < static_cast<int>(x.size()) - half; ++n) {
        for (int p = 0; p < os; ++p) {
            double acc = 0.0;
            for (int k = -half + 1; k <= half; ++k) {
                const int idx = k * os - p + half * os;   // t = k - p/os
                if (idx < 0 || idx >= static_cast<int>(h.size())) continue;
                acc += static_cast<double>(x[static_cast<size_t>(n - k)]) * h[static_cast<size_t>(idx)];
            }
            best = std::max(best, std::fabs(acc));
        }
    }
    return best;
}

// ------------------------------------------------------------------------------------
static void testEq() {
    std::printf("\n== EQ Parametric Pro ==\n");
    using namespace JasWaveEq;
    const int N = static_cast<int>(kSr * 1.5);

    // 1) Plano = transparente bit a bit
    {
        EqEngine e; e.prepare(kSr, 512); e.setSettings(EqSettings{}); e.snapAll();
        auto in = sine(997.0, -6.0, kSr, N); std::vector<float> outL(in.size()), outR(in.size());
        e.process(in.data(), in.data(), outL.data(), outR.data(), N);
        double md = 0; for (size_t i = 0; i < in.size(); ++i) md = std::max(md, std::fabs(static_cast<double>(outL[i]) - in[i]));
        CHECK(md == 0.0, "EQ plano: salida idéntica a la entrada (max diff = %.3g)", md);
    }
    // 2) Respuesta de cada tipo de banda vs análisis exacto
    struct Case { int band; double f, g, q; double probe; };
    const Case cases[] = { {3, 1000.0, 12.0, 1.0, 1000.0}, {3, 1000.0, -9.0, 2.0, 800.0}, {1, 110.0, 8.0, 0.71, 40.0},
                           {6, 10000.0, -10.0, 0.71, 16000.0}, {2, 300.0, 6.0, 4.0, 300.0}, {5, 6500.0, 15.0, 0.5, 5000.0} };
    for (const Case& c : cases) {
        EqSettings s; s.band[c.band].on = true; s.band[c.band].freq = c.f; s.band[c.band].gainDb = c.g; s.band[c.band].q = c.q;
        EqEngine e; e.prepare(kSr, 512); e.setSettings(s); e.snapAll();
        auto in = sine(c.probe, -12.0, kSr, N); std::vector<float> oL(in.size()), oR(in.size());
        e.process(in.data(), in.data(), oL.data(), oR.data(), N);
        const double measured = rmsDb(oL, N / 2, N) - rmsDb(in, N / 2, N);
        EqSlots sl; buildSlots(s, kSr, sl, false);
        const double expected = responseDb(s, sl, kSr, c.probe);
        CHECK(std::fabs(measured - expected) < 0.05, "Banda %d (%s %.0f Hz %+.0f dB Q%.2f) @%.0f Hz: medido %+.3f dB, teórico %+.3f dB",
              c.band + 1, c.band == 1 ? "LowShelf" : c.band == 6 ? "HighShelf" : "Bell", c.f, c.g, c.q, c.probe, measured, expected);
    }
    // 3) Low-cut 24 dB/oct a 100 Hz
    {
        EqSettings s; s.band[0].on = true; s.band[0].freq = 100.0; s.slopeIdx = 1;
        EqEngine e; e.prepare(kSr, 512); e.setSettings(s); e.snapAll();
        auto in = sine(50.0, -12.0, kSr, N); std::vector<float> oL(in.size()), oR(in.size());
        e.process(in.data(), in.data(), oL.data(), oR.data(), N);
        const double att = rmsDb(oL, N / 2, N) - rmsDb(in, N / 2, N);
        CHECK(std::fabs(att - (-24.1)) < 0.4, "Low-cut 24 dB/oct @100 Hz, sonda 50 Hz: %.2f dB (esperado ≈ -24.1)", att);
        auto in2 = sine(1000.0, -12.0, kSr, N); std::vector<float> o2(in2.size()), o2r(in2.size());
        e.process(in2.data(), in2.data(), o2.data(), o2r.data(), N);
        CHECK(std::fabs(rmsDb(o2, N / 2, N) - rmsDb(in2, N / 2, N)) < 0.02, "Low-cut no altera 1 kHz");
    }
    // 4) Bypass transparente con crossfade
    {
        EqSettings s; s.band[3].gainDb = 12.0; EqEngine e; e.prepare(kSr, 512); e.setSettings(s); e.snapAll();
        s.bypass = true; e.setSettings(s);
        auto in = sine(997.0, -6.0, kSr, N); std::vector<float> oL(in.size()), oR(in.size());
        e.process(in.data(), in.data(), oL.data(), oR.data(), N);
        double md = 0; for (int i = N / 2; i < N; ++i) md = std::max(md, std::fabs(static_cast<double>(oL[static_cast<size_t>(i)]) - in[static_cast<size_t>(i)]));
        CHECK(md == 0.0, "Bypass: pasa idéntico tras el crossfade (max diff = %.3g)", md);
    }
    // 5) Estrés: automatización agresiva, sin NaN/Inf ni explosión
    {
        EqEngine e; e.prepare(kSr, 512); std::mt19937 rng(7); std::uniform_real_distribution<double> U(0.0, 1.0);
        std::vector<float> in(512), oL(512), oR(512); bool ok = true; double pk = 0;
        for (int blk = 0; blk < 800; ++blk) {
            EqSettings s;
            for (int b = 0; b < kBands; ++b) { s.band[b].on = U(rng) > 0.3; s.band[b].freq = 20.0 * std::pow(1000.0, U(rng)); s.band[b].gainDb = (U(rng) - 0.5) * 36.0; s.band[b].q = 0.1 * std::pow(180.0, U(rng)); }
            s.slopeIdx = static_cast<int>(U(rng) * 3.99); s.outGainDb = (U(rng) - 0.5) * 12.0;
            e.setSettings(s);
            for (auto& v : in) v = static_cast<float>((U(rng) - 0.5) * 0.5);
            e.process(in.data(), in.data(), oL.data(), oR.data(), 512);
            for (float v : oL) { if (!std::isfinite(v)) ok = false; pk = std::max(pk, static_cast<double>(std::fabs(v))); }
        }
        CHECK(ok && pk < 200.0, "Estrés (800 bloques con parámetros aleatorios): finito y estable (pico %.2f)", pk);
    }
    // 6) CPU
    {
        EqSettings s; for (int b = 1; b < 7; ++b) s.band[b].gainDb = 3.0; s.band[0].on = s.band[7].on = true; s.slopeIdx = 3;
        EqEngine e; e.prepare(kSr, 512); e.setSettings(s); e.snapAll();
        std::vector<float> in(512, 0.1f), oL(512), oR(512);
        const int blocks = 4000;
        auto t0 = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < blocks; ++i) e.process(in.data(), in.data(), oL.data(), oR.data(), 512);
        const double sec = std::chrono::duration<double>(std::chrono::high_resolution_clock::now() - t0).count();
        const double audioSec = blocks * 512.0 / kSr;
        std::printf("  [PERF] EQ (8 bandas activas, 48 dB/oct): %.2f %% de un núcleo (%.0fx tiempo real)\n", 100.0 * sec / audioSec, audioSec / sec);
    }
}

// ------------------------------------------------------------------------------------
static void testComp() {
    std::printf("\n== Bus Compressor ==\n");
    using namespace JasWaveComp;
    const int N = static_cast<int>(kSr * 3.0);

    auto run = [&](const CompSettings& s, const std::vector<float>& in, std::vector<float>& out) {
        CompressorEngine e; e.prepare(kSr, 512); e.setSettings(s); e.snapAll();
        out.assign(in.size(), 0.0f); std::vector<float> oR(in.size());
        e.process(in.data(), in.data(), out.data(), oR.data(), static_cast<int>(in.size()), nullptr);
    };
    {
        CompSettings s; s.thrDb = -18; s.ratio = 4; s.kneeDb = 0; s.rms = true; s.attackMs = 5; s.releaseMs = 100;
        auto in = sine(1000.0, -6.0, kSr, N); std::vector<float> out; run(s, in, out);
        const double gr = rmsDb(in, N * 2 / 3, N) - rmsDb(out, N * 2 / 3, N);
        const double expected = (-6.0) - staticOutDb(-6.0, -18.0, 4.0, 0.0);
        CHECK(std::fabs(gr - expected) < 0.15, "Curva estática (thr -18, 4:1, entrada -6 dB): GR medido %.3f dB, teórico %.3f dB", gr, expected);
    }
    {
        CompSettings s; s.thrDb = -18; s.ratio = 8; s.kneeDb = 12; s.rms = true;
        auto in = sine(1000.0, -15.0, kSr, N); std::vector<float> out; run(s, in, out);
        const double gr = rmsDb(in, N * 2 / 3, N) - rmsDb(out, N * 2 / 3, N);
        const double expected = (-15.0) - staticOutDb(-15.0, -18.0, 8.0, 12.0);
        CHECK(std::fabs(gr - expected) < 0.15, "Soft-knee 12 dB dentro de la rodilla (-15 dB): GR %.3f dB, teórico %.3f dB", gr, expected);
    }
    {
        CompSettings s; s.ratio = 1.0; s.thrDb = -40;
        auto in = sine(1000.0, -3.0, kSr, N); std::vector<float> out; run(s, in, out);
        double md = 0; for (size_t i = 0; i < in.size(); ++i) md = std::max(md, std::fabs(static_cast<double>(out[i]) - in[i]));
        CHECK(md < 1e-6, "Ratio 1:1 es transparente (max diff %.3g)", md);
    }
    {
        CompSettings s; s.thrDb = -30; s.mix = 0.0;
        auto in = sine(1000.0, -3.0, kSr, N); std::vector<float> out; run(s, in, out);
        double md = 0; for (size_t i = 0; i < in.size(); ++i) md = std::max(md, std::fabs(static_cast<double>(out[i]) - in[i]));
        CHECK(md < 1e-6, "Mix 0 %% = señal seca (max diff %.3g)", md);
    }
    {   // Tiempo de ataque (detector Peak): 63 % del GR final ≈ attack
        CompSettings s; s.thrDb = -30; s.ratio = 20; s.kneeDb = 0; s.rms = false; s.attackMs = 20; s.releaseMs = 1000;
        std::vector<float> in(static_cast<size_t>(kSr * 0.6), 0.0f);
        const int onset = static_cast<int>(kSr * 0.1);
        for (size_t i = static_cast<size_t>(onset); i < in.size(); ++i) in[i] = 0.5f;  // DC -6 dB (respuesta del detector limpia)
        std::vector<float> out; run(s, in, out);
        const double finalGr = -20.0 * std::log10(out.back() / 0.5);
        int t63 = -1;
        for (size_t i = static_cast<size_t>(onset); i < out.size(); ++i) { const double gr = -20.0 * std::log10(std::max(1e-9f, out[i]) / 0.5); if (gr >= 0.632 * finalGr) { t63 = static_cast<int>(i) - onset; break; } }
        const double ms = 1000.0 * t63 / kSr;
        CHECK(std::fabs(ms - 20.0) < 3.0, "Ataque 20 ms: el GR alcanza 63 %% en %.1f ms (GR final %.1f dB)", ms, finalGr);
    }
    {   // Bypass
        CompSettings s; s.thrDb = -40; s.ratio = 20; s.bypass = true;
        auto in = sine(1000.0, -3.0, kSr, N); std::vector<float> out; run(s, in, out);
        double md = 0; for (size_t i = 0; i < in.size(); ++i) md = std::max(md, std::fabs(static_cast<double>(out[i]) - in[i]));
        CHECK(md == 0.0, "Bypass idéntico (max diff %.3g)", md);
    }
    {   // Telemetría real: la GR del bus coincide con el audio procesado
        CompBus bus; CompSettings s; s.thrDb = -24; s.ratio = 6; s.kneeDb = 3; s.rms = true;
        CompressorEngine e; e.prepare(kSr, 512); e.setSettings(s);
        auto in = sine(440.0, -6.0, kSr, 48000); std::vector<float> oL(in.size()), oR(in.size());
        for (int p = 0; p < 48000; p += 512) e.process(in.data() + p, in.data() + p, oL.data() + p, oR.data() + p, std::min(512, 48000 - p), &bus);
        const double grBus = bus.grNow.load();
        const double grAudio = rmsDb(in, 40000, 47000) - rmsDb(oL, 40000, 47000);
        CHECK(std::fabs(grBus - grAudio) < 0.2, "Telemetría GR del bus %.2f dB == GR del audio %.2f dB", grBus, grAudio);
        CHECK(bus.scope.count() > 900, "Scope recibió %llu entradas reales (≈1/ms)", static_cast<unsigned long long>(bus.scope.count()));
    }
    {   // CPU
        CompSettings s; s.rms = true; s.scHpfHz = 100.0; CompBus bus;
        CompressorEngine e; e.prepare(kSr, 512); e.setSettings(s);
        auto in = sine(200.0, -6.0, kSr, 512); std::vector<float> oL(512), oR(512);
        const int blocks = 4000; auto t0 = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < blocks; ++i) e.process(in.data(), in.data(), oL.data(), oR.data(), 512, &bus);
        const double sec = std::chrono::duration<double>(std::chrono::high_resolution_clock::now() - t0).count();
        const double audioSec = blocks * 512.0 / kSr;
        std::printf("  [PERF] Compresor (RMS + SC HPF + telemetría): %.2f %% de un núcleo (%.0fx tiempo real)\n", 100.0 * sec / audioSec, audioSec / sec);
    }
}

// ------------------------------------------------------------------------------------
static void testLimiter() {
    std::printf("\n== TruePeak Limiter ==\n");
    using namespace JasWaveLimiter;
    auto run = [&](const LimiterSettings& s, const std::vector<float>& inL, const std::vector<float>& inR, std::vector<float>& oL, std::vector<float>& oR, uint32_t* lat, LimiterBus* bus = nullptr, int blk = 512) {
        LimiterEngine e; e.prepare(kSr, blk); e.setSettings(s); e.snapAll(); if (lat) *lat = e.latencySamples();
        if (bus) bus->loudness.prepare(kSr);
        oL.assign(inL.size(), 0.0f); oR.assign(inL.size(), 0.0f);
        for (int p = 0; p < static_cast<int>(inL.size()); p += blk) {
            const int m = std::min(blk, static_cast<int>(inL.size()) - p);
            e.process(inL.data() + p, inR.data() + p, oL.data() + p, oR.data() + p, m, bus);
        }
    };
    // 1) Latencia exacta y transparencia bajo el techo
    {
        LimiterSettings s; s.ceilingDb = -1.0; auto in = sine(997.0, -6.0, kSr, 48000);
        std::vector<float> oL, oR; uint32_t lat = 0; run(s, in, in, oL, oR, &lat);
        double md = 0; for (size_t i = lat; i < in.size(); ++i) md = std::max(md, std::fabs(static_cast<double>(oL[i]) - in[i - lat]));
        CHECK(md == 0.0, "Bajo el techo: salida == entrada retardada %u muestras (%.2f ms), max diff %.3g", lat, 1000.0 * lat / kSr, md);
    }
    // 2) Techo true-peak con +12 dB de ganancia sobre material denso (ruido rosa-ish + bursts)
    {
        std::mt19937 rng(3); std::normal_distribution<double> G(0.0, 0.25);
        std::vector<float> in(static_cast<size_t>(kSr * 4)), inR(in.size());
        double lp = 0;
        for (size_t i = 0; i < in.size(); ++i) {
            lp += 0.3 * (G(rng) - lp);
            double burst = (i / 24000) % 3 == 0 ? 2.0 : 1.0;
            in[i] = static_cast<float>(std::max(-1.0, std::min(1.0, lp * burst)));
            inR[i] = static_cast<float>(std::max(-1.0, std::min(1.0, 0.7 * lp * burst + 0.2 * G(rng))));
        }
        LimiterSettings s; s.ceilingDb = -1.0; s.gainDb = 12.0; s.releaseMs = 100.0;
        std::vector<float> oL, oR; uint32_t lat; LimiterBus bus; run(s, in, inR, oL, oR, &lat, &bus);
        const double sp = std::max(peakAbs(oL, 4800), peakAbs(oR, 4800));
        const double tp = std::max(referenceTruePeak(oL, 4800), referenceTruePeak(oR, 4800));
        CHECK(sp <= dbToLinear(-1.0) + 1e-6, "Material denso +12 dB: pico de muestra %.3f dBFS <= techo -1.0", linearToDb(sp));
        CHECK(linearToDb(tp) <= -1.0 + 0.15, "Material denso +12 dB: true-peak de referencia (16x) %.3f dBTP (techo -1.0, tolerancia 0.15)", linearToDb(tp));
        const double tpBus = linearToDb(bus.tpOut.take());
        CHECK(std::fabs(tpBus - linearToDb(tp)) < 0.6, "Medidor TP del plugin (%.2f dBTP) coincide con la referencia (%.2f dBTP)", tpBus, linearToDb(tp));
    }
    // 3) Peor caso inter-muestra: fs/4 con fase 45° (picos reales 3 dB por encima de las muestras)
    {
        auto in = sine(kSr / 4.0, 3.0, kSr, 48000, kPi / 4.0);
        const double rawSample = peakAbs(in), rawTp = referenceTruePeak(in, 100);
        LimiterSettings s; s.ceilingDb = -1.0; s.releaseMs = 50.0; std::vector<float> oL, oR; uint32_t lat; run(s, in, in, oL, oR, &lat);
        const double tp = referenceTruePeak(oL, 4800);
        CHECK(linearToDb(tp) <= -1.0 + 0.2, "Inter-muestra fs/4: entrada %.2f dBFS muestra / %.2f dBTP real -> salida %.3f dBTP (techo -1.0)", linearToDb(rawSample), linearToDb(rawTp), linearToDb(tp));
    }
    // 4) THD del limitador actuando sobre senoidal 1 kHz (+6 dB sobre techo)
    {
        auto in = sine(1000.0, 5.0 - 1.0 + 0.0, kSr, 96000);  // amplitud 4 dB → clipping al limitar
        for (auto& v : in) v = static_cast<float>(v * 0.5);   // +/−: 0.5*10^(4/20)=0.79 dBFS≈-2 → con gain 6 dB actúa
        LimiterSettings s; s.ceilingDb = -1.0; s.gainDb = 6.0; s.releaseMs = 120.0;
        std::vector<float> oL, oR; uint32_t lat; run(s, in, in, oL, oR, &lat);
        const int n = 16384, from = 60000;
        SpectrumTap tap; tap.push(oL.data() + from, nullptr, n);
        // THD+N simple con FFT de la salida (ventana Hann)
        SpectrumAnalyzer an; std::vector<float> snap(n); tap.snapshot(snap.data(), n);
        FFT fft(14); std::vector<float> re(n), im(n, 0.0f);
        for (int i = 0; i < n; ++i) re[static_cast<size_t>(i)] = snap[static_cast<size_t>(i)] * static_cast<float>(0.5 - 0.5 * std::cos(2 * kPi * i / n));
        fft.forward(re.data(), im.data());
        const double bin = 1000.0 * n / kSr; double fund = 0, tot = 0;
        for (int k = 1; k < n / 2; ++k) { const double p = static_cast<double>(re[static_cast<size_t>(k)]) * re[static_cast<size_t>(k)] + static_cast<double>(im[static_cast<size_t>(k)]) * im[static_cast<size_t>(k)]; tot += p; if (std::fabs(k - bin) <= 6.0) fund += p; }
        const double thd = 10.0 * std::log10((tot - fund) / fund);
        CHECK(thd < -45.0, "THD+N del limitador con 4.5 dB de GR sostenido (release 120 ms): %.1f dB (< -45)", thd);
    }
    // 5) LUFS BS.1770: 1 kHz estéreo -23 dBFS == -23.0 LUFS
    {
        LimiterBus bus; LimiterSettings s; s.ceilingDb = 0.0; s.releaseMs = 50.0;
        auto in = sine(997.0, -23.0, kSr, static_cast<int>(kSr * 6)); std::vector<float> oL, oR; uint32_t lat; run(s, in, in, oL, oR, &lat, &bus);
        const double I = bus.loudness.integrated.load(), M = bus.loudness.momentary.load(), S = bus.loudness.shortTerm.load();
        CHECK(std::fabs(I + 23.0) < 0.15 && std::fabs(M + 23.0) < 0.15 && std::fabs(S + 23.0) < 0.15, "LUFS de senoidal 997 Hz a -23 dBFS: M %.2f  S %.2f  I %.2f (esperado -23.0)", M, S, I);
    }
    // 6) Gating: silencio no contamina la sonoridad integrada
    {
        LimiterBus bus; LimiterSettings s; s.ceilingDb = 0.0;
        auto a = sine(997.0, -20.0, kSr, static_cast<int>(kSr * 4)); std::vector<float> in = a; in.insert(in.end(), static_cast<size_t>(kSr * 4), 0.0f);
        std::vector<float> oL, oR; uint32_t lat; run(s, in, in, oL, oR, &lat, &bus);
        const double I = bus.loudness.integrated.load();
        CHECK(std::fabs(I + 20.0) < 0.2, "Gating absoluto/relativo: 4 s de tono -20 + 4 s de silencio -> I = %.2f LUFS (esperado -20.0)", I);
    }
    // 7) Bypass
    {
        LimiterSettings s; s.gainDb = 12.0; s.bypass = true; auto in = sine(997.0, -3.0, kSr, 48000);
        std::vector<float> oL, oR; uint32_t lat; run(s, in, in, oL, oR, &lat);
        double md = 0; for (size_t i = lat + 4800; i < in.size(); ++i) md = std::max(md, std::fabs(static_cast<double>(oL[i]) - in[i - lat]));
        CHECK(md == 0.0, "Bypass alineado en latencia (%u muestras): idéntico (max diff %.3g)", lat, md);
    }
    // 8) CPU
    {
        LimiterSettings s; s.gainDb = 6.0; LimiterBus bus; bus.loudness.prepare(kSr);
        LimiterEngine e; e.prepare(kSr, 512); e.setSettings(s);
        std::vector<float> in = sine(220.0, -3.0, kSr, 512), oL(512), oR(512);
        const int blocks = 4000; auto t0 = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < blocks; ++i) e.process(in.data(), in.data(), oL.data(), oR.data(), 512, &bus);
        const double sec = std::chrono::duration<double>(std::chrono::high_resolution_clock::now() - t0).count();
        const double audioSec = blocks * 512.0 / kSr;
        std::printf("  [PERF] Limitador (TP 4x + lookahead + LUFS + scope): %.2f %% de un núcleo (%.0fx tiempo real)\n", 100.0 * sec / audioSec, audioSec / sec);
    }
}

// ------------------------------------------------------------------------------------
static void testAnalyzer() {
    std::printf("\n== Analizador de espectro ==\n");
    SpectrumTap tap; SpectrumAnalyzer an;
    auto in = sine(1000.0, -10.0, kSr, 16384);
    tap.push(in.data(), nullptr, 16384);
    for (int i = 0; i < 40; ++i) an.update(tap, kSr);
    std::vector<float> cols; an.columns(cols, 800, 20.0, 20000.0, 0.0);
    int best = 0; for (int i = 0; i < 800; ++i) if (cols[static_cast<size_t>(i)] > cols[static_cast<size_t>(best)]) best = i;
    const double fPeak = 20.0 * std::pow(1000.0, (best + 0.5) / 800.0);
    CHECK(std::fabs(fPeak - 1000.0) < 25.0, "Pico del espectro en %.1f Hz (senoidal de 1000 Hz)", fPeak);
    CHECK(std::fabs(cols[static_cast<size_t>(best)] + 10.0) < 1.6, "Nivel medido %.2f dBFS (senoidal de -10 dBFS; margen Hann ±1.5 dB)", cols[static_cast<size_t>(best)]);
    CHECK(cols[100] < -90.0, "Suelo de ruido lejos del tono: %.1f dBFS", cols[100]);
    // K-weighting @48k vs coeficientes normativos BS.1770
    BiquadCoefs sh = BiquadCoefs::designBs1770Stage1(48000.0);
    CHECK(std::fabs(sh.b0 - 1.53512485958697) < 1e-6 && std::fabs(sh.a1 + 1.69065929318241) < 1e-6, "K-weighting etapa 1 == coeficientes BS.1770 (b0=%.8f, a1=%.8f)", sh.b0, sh.a1);
}

int main() {
    std::printf("JasWave DSP selftest (sr = %.0f Hz)\n", kSr);
    testEq(); testComp(); testLimiter(); testAnalyzer();
    std::printf("\nResultado: %d OK, %d FAIL\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
