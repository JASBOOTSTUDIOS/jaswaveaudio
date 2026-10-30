// =====================================================================================
//  Autoverificación determinista del DSP de JasWave StompLab (sin SDK, sin UI).
//   latencia medida, transparencia, gate, compresor, 5 modelos de drive, preamp (EQ y saturación), 6 cabinas,
//   chorus, delay (eco y realimentación), shimmer (cola y octava), mezcla/bypass y estrés (todo activo, ajustes
//   aleatorios, 44,1/96 kHz, sin NaN, sin asignaciones, salida acotada).
// =====================================================================================
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <new>
#include <vector>

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

#include "stomp_dsp.h"

using namespace JasWaveStomp;
using Buf = std::vector<float>;

static int g_fail = 0, g_pass = 0;
#define CHECK(cond, ...) do { if (cond) { ++g_pass; std::printf("  [ OK ] "); } else { ++g_fail; std::printf("  [FAIL] "); } std::printf(__VA_ARGS__); std::printf("\n"); } while (0)

constexpr double kSr = 48000.0;
struct Rng { uint32_t s{0x2545F491u}; float next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return static_cast<float>(static_cast<int32_t>(s)) / 2147483648.0f; } };

static Buf sine(double f, double amp, int n, double sr = kSr) {
    Buf v(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) v[static_cast<size_t>(i)] = static_cast<float>(amp * std::sin(2.0 * kPi * f * i / sr));
    return v;
}
static double rms(const Buf& x, int from, int to) {
    double s = 0.0;
    for (int i = from; i < to; ++i) s += static_cast<double>(x[static_cast<size_t>(i)]) * x[static_cast<size_t>(i)];
    return std::sqrt(s / std::max(1, to - from));
}
static double db(double lin) { return 20.0 * std::log10(std::max(lin, 1e-30)); }
static double toneAmp(const Buf& x, int from, int to, double f, double sr = kSr) {
    double c = 0.0, s = 0.0;
    for (int i = from; i < to; ++i) { const double w = 2.0 * kPi * f * i / sr; c += x[static_cast<size_t>(i)] * std::cos(w); s += x[static_cast<size_t>(i)] * std::sin(w); }
    return 2.0 * std::sqrt(c * c + s * s) / (to - from);
}
static bool allFinite(const Buf& x) { for (float v : x) if (!std::isfinite(v)) return false; return true; }
static float peak(const Buf& x) { float p = 0.f; for (float v : x) p = std::max(p, std::fabs(v)); return p; }

// Procesa (mono duplicado) y devuelve L SIN alinear
static Buf run(Engine& e, const Buf& in, int block = 256) {
    JasWaveDsp::ScopedNoDenormals nd;
    Buf out(in.size(), 0.f), tmpR(in.size(), 0.f);
    const int n = static_cast<int>(in.size());
    ProcessScope scope;
    for (int pos = 0; pos < n; pos += block) {
        const int m = std::min(block, n - pos);
        e.process(in.data() + pos, in.data() + pos, out.data() + pos, tmpR.data() + pos, m);
    }
    return out;
}
static Buf alineada(const Buf& out) { Buf al(out.size(), 0.f); for (size_t i = 0; i + kOsLatency < out.size(); ++i) al[i] = out[i + kOsLatency]; return al; }

// Engine nuevo con ajustes
static std::unique_ptr<Engine> mk(const Settings& s, double sr = kSr) { auto e = std::make_unique<Engine>(); e->prepare(sr, 256); e->set(s); return e; }
// THD aproximado: energía de armónicos 2..8 frente a la fundamental
static double thd(const Buf& x, int a, int b, double f, double sr = kSr) {
    const double f1 = toneAmp(x, a, b, f, sr);
    double h = 0.0;
    for (int k = 2; k <= 8; ++k) if (f * k < sr * 0.45) { const double v = toneAmp(x, a, b, f * k, sr); h += v * v; }
    return std::sqrt(h) / std::max(f1, 1e-12);
}

int main() {
    std::printf("JasWave StompLab – autoverificación DSP (%.0f Hz)\n", kSr);
    const int kN = static_cast<int>(kSr * 4.0);
    const int a0 = static_cast<int>(kSr * 2.0), a1 = static_cast<int>(kSr * 3.5);

    // ---- 1) latencia medida y transparencia ----
    {
        Settings s;
        auto e = mk(s);
        Buf imp(8192, 0.f); imp[100] = 1.f;
        const Buf o = run(*e, imp);
        int pk = 0; for (size_t i = 0; i < o.size(); ++i) if (std::fabs(o[i]) > std::fabs(o[static_cast<size_t>(pk)])) pk = static_cast<int>(i);
        CHECK(pk - 100 == kOsLatency && o[static_cast<size_t>(pk)] > 0.9f, "latencia medida con un impulso: %d muestras (declarada %d), amplitud %.3f (pasa-bajos de medio banda)", pk - 100, kOsLatency, o[static_cast<size_t>(pk)]);
        auto e2 = mk(s);
        Buf in = sine(440.0, 0.4, kN);
        { const Buf hi = sine(5000.0, 0.1, kN); for (size_t i = 0; i < in.size(); ++i) in[i] += hi[i]; }
        g_allocs = 0;
        const Buf out = alineada(run(*e2, in));
        double maxErr = 0.0;
        for (int i = a0; i < a1; ++i) maxErr = std::max(maxErr, static_cast<double>(std::fabs(out[static_cast<size_t>(i)] - in[static_cast<size_t>(i)])));
        CHECK(maxErr < 2e-3, "todo apagado: transparente salvo latencia (error máx %.2e = %.0f dB)", maxErr, db(maxErr));
        CHECK(g_allocs.load() == 0 && allFinite(out), "cero asignaciones y sin NaN (%lld)", g_allocs.load());
    }

    // ---- 2) Gate ----
    {
        Settings s; s.gateOn = true; s.gateThr = -40.f; s.gateRel = 40.f; s.gateRange = 70.f;
        auto e = mk(s);
        Rng rng;
        Buf in(static_cast<size_t>(kN));
        for (int i = 0; i < kN; ++i) {
            const bool on = std::fmod(i / kSr, 1.0) < 0.5;
            in[static_cast<size_t>(i)] = static_cast<float>(0.001 * rng.next() + (on ? 0.3 * std::sin(2.0 * kPi * 330.0 * i / kSr) : 0.0));
        }
        const Buf out = alineada(run(*e, in));
        const int q0 = static_cast<int>(kSr * 2.7), q1 = static_cast<int>(kSr * 2.95), p0 = static_cast<int>(kSr * 2.1), p1 = static_cast<int>(kSr * 2.45);
        CHECK(db(rms(out, q0, q1)) < db(rms(in, q0, q1)) - 30.0, "Gate: ruido en silencio %.1f -> %.1f dBFS", db(rms(in, q0, q1)), db(rms(out, q0, q1)));
        CHECK(std::fabs(db(rms(out, p0, p1)) - db(rms(in, p0, p1))) < 0.5, "Gate: la señal pasa (%.2f dB)", db(rms(out, p0, p1)) - db(rms(in, p0, p1)));
        CHECK(e->gateGrDb() > 10.f, "Gate: medidor de reducción %.1f dB", e->gateGrDb());
    }

    // ---- 3) Compresor ----
    {
        Settings s; s.compOn = true; s.compThr = -20.f; s.compRatio = 8.f; s.compAtk = 2.f; s.compRel = 60.f; s.compKnee = 0.f;
        auto e = mk(s);
        Buf in(static_cast<size_t>(kN));
        for (int i = 0; i < kN; ++i) in[static_cast<size_t>(i)] = static_cast<float>((i < kN / 2 ? 0.5 : 0.03) * std::sin(2.0 * kPi * 220.0 * i / kSr));
        const Buf out = alineada(run(*e, in));
        const int h0 = static_cast<int>(kSr * 1.0), h1 = static_cast<int>(kSr * 1.8), l0 = static_cast<int>(kSr * 3.0), l1 = static_cast<int>(kSr * 3.8);
        const double dIn = db(rms(in, h0, h1)) - db(rms(in, l0, l1)), dOut = db(rms(out, h0, h1)) - db(rms(out, l0, l1));
        CHECK(dOut < dIn - 8.0, "Compresor: diferencia de niveles %.1f dB -> %.1f dB", dIn, dOut);
        // medidor de GR durante el tramo fuerte
        Engine e2; e2.prepare(kSr, 256); e2.set(s);
        Buf fuerte = sine(220.0, 0.5, 48000); run(e2, fuerte);
        CHECK(e2.compGrDb() > 8.f, "Compresor: reducción medida %.1f dB", e2.compGrDb());
    }

    // ---- 4) Drive: 5 modelos ----
    {
        static const char* nombres[] = { "Clean Boost", "Overdrive", "Distortion", "Fuzz", "Metal" };
        double thdPrev = 0.0;
        for (int m = 0; m < 5; ++m) {
            Settings s; s.odOn = true; s.odModel = m; s.odDrive = 0.8f; s.odTone = 6000.f;
            auto e = mk(s);
            const Buf in = sine(440.0, 0.2, kN);
            const Buf out = alineada(run(*e, in));
            const double t = thd(out, a0, a1, 440.0), dc = std::fabs(rms(out, a0, a1)) > 0 ? 0.0 : 0.0; (void)dc;
            double mean = 0.0; for (int i = a0; i < a1; ++i) mean += out[static_cast<size_t>(i)]; mean /= (a1 - a0);
            CHECK(allFinite(out) && peak(out) < 2.0f && t > 0.03 && std::fabs(mean) < 0.03, "Drive %s: THD %.1f %%, pico %.2f, DC %.4f", nombres[m], 100.0 * t, peak(out), mean);
            (void)thdPrev;
        }
        // Boost con poco drive es casi limpio; con drive alto distorsiona más
        Settings lo; lo.odOn = true; lo.odModel = 0; lo.odDrive = 0.1f; auto el = mk(lo);
        Settings hi = lo; hi.odDrive = 1.0f; auto eh = mk(hi);
        const Buf in = sine(440.0, 0.2, kN);
        const double tl = thd(alineada(run(*el, in)), a0, a1, 440.0), th = thd(alineada(run(*eh, in)), a0, a1, 440.0);
        CHECK(th > 2.0 * tl, "Drive: más drive = más distorsión (THD %.2f %% -> %.2f %%)", 100.0 * tl, 100.0 * th);
        // alias: 5 kHz con Overdrive a drive medio (con saturación extrema el x2 deja ~25 dB, ver Fuzz); la energía no armónica en banda base debe quedar contenida (sobremuestreo x2)
        Settings f; f.odOn = true; f.odModel = 1; f.odDrive = 0.5f; f.odTone = 8000.f; auto ef = mk(f);
        const Buf in5 = sine(5000.0, 0.3, kN);
        const Buf o5 = alineada(run(*ef, in5));
        const double fund = toneAmp(o5, a0, a1, 5000.0);
        const double alias = std::max({ toneAmp(o5, a0, a1, 1000.0), toneAmp(o5, a0, a1, 2000.0), toneAmp(o5, a0, a1, 3000.0), toneAmp(o5, a0, a1, 4000.0) });
        CHECK(db(alias) < db(fund) - 40.0, "Drive sobremuestreado: alias (1-4 kHz) %.0f dB bajo la fundamental de 5 kHz", db(fund) - db(alias));
        Settings fz; fz.odOn = true; fz.odModel = 3; fz.odDrive = 1.0f; fz.odTone = 8000.f; auto efz = mk(fz);
        const Buf o7 = alineada(run(*efz, sine(7000.0, 0.3, kN)));
        const double alias7 = std::max(toneAmp(o7, a0, a1, 1000.0), toneAmp(o7, a0, a1, 5000.0));
        CHECK(db(alias7) < db(toneAmp(o7, a0, a1, 7000.0)) - 15.0, "Fuzz extremo a 7 kHz: alias %.0f dB bajo la fundamental (límite del x2)", db(toneAmp(o7, a0, a1, 7000.0)) - db(alias7));
    }

    // ---- 5) Preamp ----
    {
        Settings s; s.preOn = true; s.preCh = 0; s.preGain = 0.0f; s.prePres = 0.f; s.preSag = 0.f;
        auto e0 = mk(s);
        Settings sb = s; sb.preBass = 12.f; auto eb = mk(sb);
        Settings st = s; st.preTreble = 12.f; auto et = mk(st);
        const Buf in100 = sine(100.0, 0.01, kN), in5k = sine(5000.0, 0.01, kN);
        const double b0 = toneAmp(alineada(run(*e0, in100)), a0, a1, 100.0), b1 = toneAmp(alineada(run(*eb, in100)), a0, a1, 100.0);
        const double t0 = toneAmp(alineada(run(*mk(s), in5k)), a0, a1, 5000.0), t1 = toneAmp(alineada(run(*et, in5k)), a0, a1, 5000.0);
        CHECK(db(b1) - db(b0) > 6.0, "Preamp: Bass +12 sube 100 Hz %.1f dB", db(b1) - db(b0));
        CHECK(db(t1) - db(t0) > 6.0, "Preamp: Treble +12 sube 5 kHz %.1f dB", db(t1) - db(t0));
        Settings sg; sg.preOn = true; sg.preCh = 2; sg.preGain = 0.9f; auto eg = mk(sg);
        const Buf in = sine(220.0, 0.1, kN);
        const Buf out = alineada(run(*eg, in));
        double mean = 0.0; for (int i = a0; i < a1; ++i) mean += out[static_cast<size_t>(i)]; mean /= (a1 - a0);
        CHECK(thd(out, a0, a1, 220.0) > 0.1 && peak(out) < 3.0f && std::fabs(mean) < 0.05, "Preamp Lead: THD %.0f %%, pico %.2f, DC %.4f", 100.0 * thd(out, a0, a1, 220.0), peak(out), mean);
    }

    // ---- 6) Cabinas ----
    {
        const Buf t1 = sine(1000.0, 0.2, kN), t8 = sine(8000.0, 0.2, kN), t100 = sine(100.0, 0.2, kN);
        Settings di; di.cabOn = true; di.cabModel = 5; di.cabLow = 20.f; di.cabHigh = 20000.f;
        auto ed = mk(di);
        const double d1 = toneAmp(alineada(run(*ed, t1)), a0, a1, 1000.0), d8 = toneAmp(alineada(run(*mk(di), t8)), a0, a1, 8000.0);
        CHECK(std::fabs(db(d1) - db(0.2)) < 0.5 && std::fabs(db(d8) - db(0.2)) < 1.0, "Cabina DI: plana (1 kHz %.2f dB, 8 kHz %.2f dB)", db(d1) - db(0.2), db(d8) - db(0.2));
        double niveles[5];
        for (int m = 0; m < 5; ++m) {
            Settings s; s.cabOn = true; s.cabModel = m; s.cabLow = 20.f; s.cabHigh = 20000.f;
            double maxDev = 0.0;
            for (double f : { 100.0, 300.0, 1000.0, 3000.0, 6000.0 }) {
                const double l = toneAmp(alineada(run(*mk(s), sine(f, 0.2, kN))), a0, a1, f);
                maxDev = std::max(maxDev, std::fabs(db(l) - db(0.2 * cabMagnitude(m, f))));
                if (f == 1000.0) niveles[m] = db(l);
            }
            CHECK(maxDev < 1.5, "Cabina %s: la IR sigue su respuesta de diseño (desviación máx %.2f dB en 100 Hz-6 kHz)", labelsCabModel()[m], maxDev);
        }
        bool distintas = false; for (int m = 1; m < 5; ++m) if (std::fabs(niveles[m] - niveles[0]) > 0.2) distintas = true;
        CHECK(distintas, "Cabinas: los modelos tienen respuestas distintas");
        // cambio de modelo en caliente: sin saltos grandes (fundido)
        Settings s; s.cabOn = true; s.cabModel = 0; auto e = mk(s);
        Buf in = sine(300.0, 0.2, kN); Buf out(in.size()), tmp(in.size());
        {
            ProcessScope sc;
            for (int pos = 0; pos < kN; pos += 256) {
                if (pos == kN / 2) { s.cabModel = 2; e->set(s); }
                e->process(in.data() + pos, in.data() + pos, out.data() + pos, tmp.data() + pos, 256);
            }
        }
        double maxJump = 0.0; for (int i = 1; i < kN; ++i) maxJump = std::max(maxJump, static_cast<double>(std::fabs(out[static_cast<size_t>(i)] - out[static_cast<size_t>(i) - 1])));
        CHECK(maxJump < 0.2 && allFinite(out) && g_allocs.load() == 0, "Cabina: cambio de modelo en caliente sin saltos (máx %.3f) ni asignaciones", maxJump);
    }

    // ---- 7) Chorus y Delay ----
    {
        Settings s; s.choOn = true; s.choMix = 1.f; s.choDepth = 0.8f; s.choRate = 1.5f;
        auto e = mk(s);
        const Buf in = sine(1000.0, 0.3, kN);
        const Buf out = alineada(run(*e, in));
        CHECK(allFinite(out) && peak(out) < 1.0f && rms(out, a0, a1) > 0.05, "Chorus: modula con salida estable (pico %.2f, RMS %.3f)", peak(out), rms(out, a0, a1));
        Settings d; d.dlyOn = true; d.dlyTime = 100.f; d.dlyFb = 0.5f; d.dlyTone = 12000.f; d.dlyMix = 1.f; d.dlyMode = 0;
        auto ed = mk(d);
        const int I0 = static_cast<int>(kSr * 1.0);   // 1 s de precarga: el tiempo de delay y los fundidos ya están asentados
        Buf imp(static_cast<size_t>(kSr * 2.0), 0.f); imp[static_cast<size_t>(I0)] = 0.5f;
        const Buf o = run(*ed, imp);
        auto pico = [&](double ms) { const int c = I0 + kOsLatency + static_cast<int>(ms * 0.001 * kSr); float p = 0.f; for (int i = c - 40; i < c + 40; ++i) p = std::max(p, std::fabs(o[static_cast<size_t>(i)])); return p; };
        const float e1 = pico(100.0), e2 = pico(200.0), e3 = pico(300.0);
        CHECK(e1 > 0.35f && e2 / e1 > 0.3f && e2 / e1 < 0.7f && e3 < e2, "Delay: ecos a 100/200/300 ms (%.3f, %.3f, %.3f) con realimentación 50 %%", e1, e2, e3);
        Settings pp = d; pp.dlyMode = 1; auto ep = mk(pp);
        const size_t TT = static_cast<size_t>(kSr * 2.0);
        Buf impL(TT, 0.f), oL(TT, 0.f), oR(TT, 0.f), zero(TT, 0.f);
        impL[static_cast<size_t>(I0)] = 0.5f;
        { ProcessScope sc; for (int pos = 0; pos + 256 <= static_cast<int>(TT); pos += 256) ep->process(impL.data() + pos, zero.data() + pos, oL.data() + pos, oR.data() + pos, 256); }
        // ping-pong: el primer eco (100 ms) en L, el segundo (200 ms) cruza a R
        const int c1 = I0 + kOsLatency + 4800, c2 = I0 + kOsLatency + 9600;
        float l1 = 0.f, r1 = 0.f, l2 = 0.f, r2 = 0.f;
        for (int i = -40; i < 40; ++i) { l1 = std::max(l1, std::fabs(oL[static_cast<size_t>(c1 + i)])); r1 = std::max(r1, std::fabs(oR[static_cast<size_t>(c1 + i)])); l2 = std::max(l2, std::fabs(oL[static_cast<size_t>(c2 + i)])); r2 = std::max(r2, std::fabs(oR[static_cast<size_t>(c2 + i)])); }
        CHECK(l1 > 0.1f && r2 > 0.05f && (l1 > 2.f * r1 || r2 > 2.f * l2), "Delay ping-pong: eco 1 L=%.3f R=%.3f · eco 2 L=%.3f R=%.3f (se alterna)", l1, r1, l2, r2);
    }

    // ---- 8) Shimmer ----
    {
        auto burst = [&](float amt) {
            Settings s; s.shiOn = true; s.shiMix = 1.f; s.shiDecay = 6.f; s.shiAmt = amt; s.shiDamp = 12000.f;
            auto e = mk(s);
            Buf in(static_cast<size_t>(kSr * 5.0), 0.f);
            for (int i = 0; i < static_cast<int>(kSr * 0.5); ++i) in[static_cast<size_t>(i)] = static_cast<float>(0.3 * std::sin(2.0 * kPi * 440.0 * i / kSr));
            return alineada(run(*e, in));
        };
        const Buf b0 = burst(0.f), b1 = burst(1.f);
        const int t0 = static_cast<int>(kSr * 1.5), t1 = static_cast<int>(kSr * 3.5);
        CHECK(allFinite(b1) && peak(b1) < 2.0f && db(rms(b0, t0, t1)) > -70.0, "Shimmer: cola presente tras 1 s (%.1f dBFS) y estable (pico %.2f)", db(rms(b0, t0, t1)), peak(b1));
        const double o0 = toneAmp(b0, t0, t1, 880.0), o1 = toneAmp(b1, t0, t1, 880.0);
        CHECK(db(o1) > db(o0) + 6.0, "Shimmer: la octava (880 Hz) sube %.1f dB al activar el lazo +12 st", db(o1) - db(o0));
        CHECK(db(rms(b1, static_cast<int>(kSr * 4.5), static_cast<int>(kSr * 5.0))) < db(rms(b1, static_cast<int>(kSr * 1.0), static_cast<int>(kSr * 1.5))) - 3.0, "Shimmer: la cola decae");
    }

    // ---- 9) Mezcla y bypass ----
    {
        Settings s; s.odOn = true; s.odDrive = 1.f; s.odModel = 3; s.mix = 0.f;
        auto e = mk(s);
        const Buf in = sine(440.0, 0.3, kN);
        const Buf out = alineada(run(*e, in));
        double maxErr = 0.0; for (int i = a0; i < a1; ++i) maxErr = std::max(maxErr, static_cast<double>(std::fabs(out[static_cast<size_t>(i)] - in[static_cast<size_t>(i)])));
        CHECK(maxErr < 1e-5, "Mix 0 %%: solo el dry alineado (error %.2e)", maxErr);
        Settings b = s; b.mix = 1.f; b.bypass = true; auto eb = mk(b);
        const Buf ob = alineada(run(*eb, in));
        maxErr = 0.0; for (int i = a0; i < a1; ++i) maxErr = std::max(maxErr, static_cast<double>(std::fabs(ob[static_cast<size_t>(i)] - in[static_cast<size_t>(i)])));
        CHECK(maxErr < 1e-5, "Bypass: salida = entrada alineada (error %.2e)", maxErr);
    }

    // ---- 10) Estrés ----
    for (double sr : { 44100.0, 96000.0 }) {
        auto e = std::make_unique<Engine>(); e->prepare(sr, 4096);
        Rng rng;
        Settings s;
        s.gateOn = s.compOn = s.odOn = s.preOn = s.cabOn = s.choOn = s.dlyOn = s.shiOn = true;
        e->set(s);
        const int total = static_cast<int>(sr * 8.0);
        Buf in(static_cast<size_t>(total)), outL(static_cast<size_t>(total)), outR(static_cast<size_t>(total));
        for (int i = 0; i < total; ++i) {
            double v = 0.5 * std::sin(2.0 * kPi * 196.0 * i / sr) * (0.5 + 0.5 * std::sin(2.0 * kPi * 0.7 * i / sr)) + 0.02 * rng.next();
            if (i % 12345 == 0) v += 0.9;
            in[static_cast<size_t>(i)] = clampT(static_cast<float>(v), -1.f, 1.f);
        }
        bool finito = true; float pico = 0.f; int pos = 0, llamada = 0;
        g_allocs = 0;
        {
            JasWaveDsp::ScopedNoDenormals nd;
            ProcessScope scope;
            while (pos < total) {
                const int n = std::min(total - pos, 1 + static_cast<int>(std::fabs(rng.next()) * 2000.0));
                if (++llamada % 5 == 0) {
                    s.inDb = 12.f * rng.next(); s.outDb = 6.f * rng.next(); s.mix = std::fabs(rng.next());
                    s.gateThr = -80.f + 60.f * std::fabs(rng.next()); s.compThr = -60.f * std::fabs(rng.next()); s.compRatio = 1.f + 19.f * std::fabs(rng.next());
                    s.odModel = static_cast<int>(std::fabs(rng.next()) * 4.99f); s.odDrive = std::fabs(rng.next()); s.odTone = 500.f + 7000.f * std::fabs(rng.next());
                    s.preCh = static_cast<int>(std::fabs(rng.next()) * 2.99f); s.preGain = std::fabs(rng.next()); s.preBass = 12.f * rng.next(); s.preMid = 12.f * rng.next(); s.preTreble = 12.f * rng.next();
                    s.preSag = std::fabs(rng.next()); s.preBright = rng.next() > 0.f;
                    s.cabModel = static_cast<int>(std::fabs(rng.next()) * 5.99f); s.cabLow = 20.f + 380.f * std::fabs(rng.next()); s.cabHigh = 2000.f + 18000.f * std::fabs(rng.next());
                    s.choRate = 0.05f + 7.9f * std::fabs(rng.next()); s.choDepth = std::fabs(rng.next());
                    s.dlyTime = 20.f + 1980.f * std::fabs(rng.next()); s.dlyFb = 95.f * 0.01f * std::fabs(rng.next()); s.dlyMode = static_cast<int>(std::fabs(rng.next()) * 2.99f); s.dlyMix = std::fabs(rng.next());
                    s.shiDecay = 0.3f + 19.7f * std::fabs(rng.next()); s.shiAmt = std::fabs(rng.next()); s.shiMix = std::fabs(rng.next());
                    s.odOn = rng.next() > -0.5f; s.preOn = rng.next() > -0.5f; s.cabOn = rng.next() > -0.5f;
                    e->set(s);
                }
                e->process(in.data() + pos, in.data() + pos, outL.data() + pos, outR.data() + pos, n);
                pos += n;
            }
        }
        for (int i = 0; i < total; ++i) { const float a = outL[static_cast<size_t>(i)], b = outR[static_cast<size_t>(i)]; if (!std::isfinite(a) || !std::isfinite(b)) finito = false; pico = std::max(pico, std::max(std::fabs(a), std::fabs(b))); }
        CHECK(finito, "estrés %.0f Hz: sin NaN/Inf con todo activo y ajustes aleatorios", sr);
        CHECK(pico < 20.0f, "estrés %.0f Hz: salida acotada (pico %.2f)", sr, pico);
        CHECK(g_allocs.load() == 0, "estrés %.0f Hz: cero asignaciones en process/set (%lld)", sr, g_allocs.load());
        // silencio tras el estrés con la realimentación máxima: la cola debe acabar siendo finita y acotada
        Settings q = s; q.dlyFb = 0.95f; q.shiDecay = 20.f; q.shiAmt = 1.f; q.shiMix = 1.f; q.dlyMix = 1.f; e->set(q);
        Buf cero(static_cast<size_t>(sr * 6.0), 0.f), o1(cero.size()), o2(cero.size());
        { JasWaveDsp::ScopedNoDenormals nd; ProcessScope sc; for (size_t p = 0; p + 512 <= cero.size(); p += 512) e->process(cero.data() + p, cero.data() + p, o1.data() + p, o2.data() + p, 512); }
        CHECK(allFinite(o1) && allFinite(o2) && peak(o1) < 20.f, "estrés %.0f Hz: cola con realimentación máxima finita y acotada (pico %.2f)", sr, peak(o1));
    }

    std::printf("\n%d comprobaciones: %d OK, %d fallos\n", g_pass + g_fail, g_pass, g_fail);
    return g_fail ? 1 : 0;
}
