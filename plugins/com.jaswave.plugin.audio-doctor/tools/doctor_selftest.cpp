// =====================================================================================
//  Autoverificación determinista del DSP de JasWave Audio Doctor (sin SDK, sin UI).
//   - Seno + ruido blanco a −40 dB: De-Noise reduce el ruido ≥ 12 dB y el seno cambia < 1 dB
//   - Seno + hum de 60 Hz: De-Hum atenúa el hum ≥ 20 dB (seno intacto)
//   - Seno recortado a 0,5: De-Clip reduce el error RMS respecto al original
//   - Seno + clics: De-Click reduce el error ≥ 10 dB
//   - Todo apagado: transparente salvo la latencia (|error| < 1e-4); Live Mic < 2 ms; sin NaN;
//     cero asignaciones dentro de process
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

#include "doctor_dsp.h"

using namespace JasWaveDoctor;
using Buf = std::vector<float>;

static int g_fail = 0, g_pass = 0;
#define CHECK(cond, ...) do { if (cond) { ++g_pass; std::printf("  [ OK ] "); } else { ++g_fail; std::printf("  [FAIL] "); } std::printf(__VA_ARGS__); std::printf("\n"); } while (0)

constexpr double kSr = 48000.0;

struct Rng { uint32_t s{0x2545F491u}; float next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return static_cast<float>(static_cast<int32_t>(s)) / 2147483648.0f; } };

static Buf sine(double f, double amp, int n, double phase = 0.0) {
    Buf v(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) v[static_cast<size_t>(i)] = static_cast<float>(amp * std::sin(2.0 * kPi * f * i / kSr + phase));
    return v;
}
static double rms(const Buf& x, int from, int to) {
    double s = 0.0;
    for (int i = from; i < to; ++i) s += static_cast<double>(x[static_cast<size_t>(i)]) * x[static_cast<size_t>(i)];
    return std::sqrt(s / std::max(1, to - from));
}
static double db(double lin) { return 20.0 * std::log10(std::max(lin, 1e-30)); }
static double toneAmp(const Buf& x, int from, int to, double f) {
    double c = 0.0, s = 0.0;
    for (int i = from; i < to; ++i) { const double w = 2.0 * kPi * f * i / kSr; c += x[static_cast<size_t>(i)] * std::cos(w); s += x[static_cast<size_t>(i)] * std::sin(w); }
    return 2.0 * std::sqrt(c * c + s * s) / (to - from);
}
static bool allFinite(const Buf& x) { for (float v : x) if (!std::isfinite(v)) return false; return true; }

// Procesa en bloques de 256 y devuelve la salida (mono duplicado en L/R, se devuelve L) alineada: se descarta la latencia
static Buf run(Engine& e, const Buf& in, int block = 256) {
    Buf out(in.size(), 0.f), tmpR(in.size(), 0.f);
    const int n = static_cast<int>(in.size());
    {
        ProcessScope scope;
        for (int pos = 0; pos < n; pos += block) {
            const int m = std::min(block, n - pos);
            e.process(in.data() + pos, in.data() + pos, out.data() + pos, tmpR.data() + pos, m);
        }
    }
    const int lat = e.latency();
    Buf al(in.size(), 0.f);
    for (int i = 0; i + lat < n; ++i) al[static_cast<size_t>(i)] = out[static_cast<size_t>(i + lat)];
    return al;
}

int main() {
    std::printf("JasWave Audio Doctor – autoverificación DSP (%.0f Hz)\n", kSr);
    const int kN = static_cast<int>(kSr * 4.0);
    const int a0 = static_cast<int>(kSr * 2.0), a1 = static_cast<int>(kSr * 3.5);   // ventana de medida (tras asentar)

    // ---- 1) transparencia con todo apagado ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; e.set(s);
        Buf in = sine(440.0, 0.5, kN);
        Rng rng; for (auto& v : in) v += 0.1f * rng.next();
        g_allocs = 0;
        const Buf out = run(e, in);
        double maxErr = 0.0;
        for (int i = a0; i < a1; ++i) maxErr = std::max(maxErr, static_cast<double>(std::fabs(out[static_cast<size_t>(i)] - in[static_cast<size_t>(i)])));
        CHECK(maxErr < 1e-4, "todo apagado: transparente salvo latencia (error máx %.2e, latencia %d muestras = %.1f ms)", maxErr, e.latency(), 1000.0 * e.latency() / kSr);
        CHECK(g_allocs.load() == 0, "cero asignaciones dentro de process (%lld)", g_allocs.load());
        CHECK(allFinite(out), "sin NaN/Inf");
        s.live = true; e.set(s);
        CHECK(e.latency() * 1000.0 / kSr < 2.0, "Live Mic: latencia %d muestras = %.2f ms (< 2 ms)", e.latency(), e.latency() * 1000.0 / kSr);
        const Buf out2 = run(e, in);
        maxErr = 0.0;
        for (int i = a0; i < a1; ++i) maxErr = std::max(maxErr, static_cast<double>(std::fabs(out2[static_cast<size_t>(i)] - in[static_cast<size_t>(i)])));
        CHECK(maxErr < 1e-4, "Live Mic todo apagado: transparente (error máx %.2e)", maxErr);
    }

    // ---- 2) De-Noise: seno −12 dB + ruido blanco −40 dB ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; s.dnOn = true; s.dnLearn = true; s.dnReduction = 18.f; s.dnMode = 1; e.set(s);
        Rng rng;
        const double sigma = std::pow(10.0, -40.0 / 20.0);
        Buf noise(static_cast<size_t>(kN));
        for (auto& v : noise) v = static_cast<float>(sigma * std::sqrt(3.0) * rng.next());   // uniforme con RMS = sigma
        // aprende 1,5 s de ruido solo
        Buf soloRuido(noise.begin(), noise.begin() + static_cast<int>(kSr * 1.5));
        run(e, soloRuido);
        s.dnLearn = false; e.set(s);
        Buf sn = sine(1000.0, 0.25, kN);
        Buf in = sn;
        for (size_t i = 0; i < in.size(); ++i) in[i] += noise[i];
        const Buf out = run(e, in);
        const double ampIn = toneAmp(in, a0, a1, 1000.0), ampOut = toneAmp(out, a0, a1, 1000.0);
        const double noiseIn = std::sqrt(std::max(0.0, rms(in, a0, a1) * rms(in, a0, a1) - ampIn * ampIn / 2.0));
        const double noiseOut = std::sqrt(std::max(0.0, rms(out, a0, a1) * rms(out, a0, a1) - ampOut * ampOut / 2.0));
        const double red = db(noiseIn) - db(noiseOut);
        CHECK(red >= 12.0, "De-Noise (perfil aprendido): ruido %.1f → %.1f dBFS (reducción %.1f dB ≥ 12)", db(noiseIn), db(noiseOut), red);
        CHECK(std::fabs(db(ampOut) - db(ampIn)) < 1.0, "De-Noise: el seno cambia %.2f dB (< 1 dB)", db(ampOut) - db(ampIn));
        CHECK(e.reduccionDb() > 6.f, "medidor de reducción %.1f dB", e.reduccionDb());
        // modo continuo (mínimos), sin aprendizaje
        Engine e2; e2.prepare(kSr, 256);
        Settings s2; s2.dnOn = true; s2.dnMode = 2; s2.dnReduction = 18.f; e2.set(s2);
        const Buf out2 = run(e2, in);
        const double ampOut2 = toneAmp(out2, a0, a1, 1000.0);
        const double noiseOut2 = std::sqrt(std::max(0.0, rms(out2, a0, a1) * rms(out2, a0, a1) - ampOut2 * ampOut2 / 2.0));
        CHECK(db(noiseIn) - db(noiseOut2) >= 8.0, "De-Noise continuo (mínimos): reducción %.1f dB (≥ 8)", db(noiseIn) - db(noiseOut2));
        CHECK(std::fabs(db(ampOut2) - db(ampIn)) < 1.0, "De-Noise continuo: seno cambia %.2f dB", db(ampOut2) - db(ampIn));
        const Diagnostico d = e2.diagnostico();
        CHECK(d.noiseDb > -50.0 && d.noiseDb < -30.0, "diagnóstico: ruido de fondo %.1f dBFS (señal −40 dB de ruido + seno)", d.noiseDb);
    }

    // ---- 3) De-Hum: seno + 60 Hz ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; s.humOn = true; s.humFreq = 2; s.humHarm = 4; s.humQ = 30.f; s.humDepth = 40.f; e.set(s);
        Buf in = sine(1000.0, 0.3, kN);
        const Buf hum = sine(60.0, 0.03, kN, 0.7);
        for (size_t i = 0; i < in.size(); ++i) in[i] += hum[i];
        const Buf out = run(e, in);
        const double hIn = toneAmp(in, a0, a1, 60.0), hOut = toneAmp(out, a0, a1, 60.0);
        const double sIn = toneAmp(in, a0, a1, 1000.0), sOut = toneAmp(out, a0, a1, 1000.0);
        CHECK(db(hIn) - db(hOut) >= 20.0, "De-Hum 60 Hz: %.1f → %.1f dBFS (atenuación %.1f dB ≥ 20)", db(hIn), db(hOut), db(hIn) - db(hOut));
        CHECK(std::fabs(db(sOut) - db(sIn)) < 0.2, "De-Hum: el seno de 1 kHz cambia %.3f dB", db(sOut) - db(sIn));
        const Diagnostico d = e.diagnostico();
        CHECK(d.humHz == 60, "diagnóstico: hum detectado a %d Hz (nivel %.1f dBFS)", d.humHz, d.humDb);
        // detección automática con hum de 50 Hz
        Engine e5; e5.prepare(kSr, 256);
        Settings s5; s5.humOn = true; s5.humFreq = 0; e5.set(s5);
        Buf in5 = sine(1000.0, 0.3, kN);
        const Buf hum5 = sine(50.4, 0.03, kN);
        for (size_t i = 0; i < in5.size(); ++i) in5[i] += hum5[i];
        const Buf out5 = run(e5, in5);
        CHECK(e5.diagnostico().humHz == 50, "Auto: hum detectado a %d Hz (f0 seguida %.2f Hz, nominal 50,4)", e5.diagnostico().humHz, e5.humF0());
        CHECK(db(toneAmp(in5, a0, a1, 50.4)) - db(toneAmp(out5, a0, a1, 50.4)) >= 20.0, "Auto 50,4 Hz: atenuación %.1f dB", db(toneAmp(in5, a0, a1, 50.4)) - db(toneAmp(out5, a0, a1, 50.4)));
    }

    // ---- 4) De-Clip ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; s.dcOn = true; s.dcThreshDb = -6.0f; s.dcStrength = 1.f; e.set(s);
        const Buf orig = sine(100.0, 0.8, kN);
        Buf in = orig;
        for (auto& v : in) v = clampT(v, -0.5f, 0.5f);
        const Buf out = run(e, in);
        double eIn = 0.0, eOut = 0.0;
        for (int i = a0; i < a1; ++i) { const double a = in[static_cast<size_t>(i)] - orig[static_cast<size_t>(i)], b = out[static_cast<size_t>(i)] - orig[static_cast<size_t>(i)]; eIn += a * a; eOut += b * b; }
        CHECK(eOut < 0.5 * eIn, "De-Clip: error RMS %.4f → %.4f (%.1f dB mejor)", std::sqrt(eIn / (a1 - a0)), std::sqrt(eOut / (a1 - a0)), 10.0 * std::log10(eIn / eOut));
        // diagnóstico de recorte: señal a fondo de escala recortada
        Engine e2; e2.prepare(kSr, 256);
        Settings s2; e2.set(s2);
        Buf in2 = sine(100.0, 1.5, kN);
        for (auto& v : in2) v = clampT(v, -1.f, 1.f);
        run(e2, in2);
        CHECK(e2.diagnostico().clipPct > 20.0f, "diagnóstico: %.1f %% de muestras recortadas", e2.diagnostico().clipPct);
    }

    // ---- 5) De-Click ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; s.clOn = true; s.clSens = 0.6f; s.clWidthMs = 1.0f; e.set(s);
        const Buf orig = sine(220.0, 0.4, kN);
        Buf in = orig;
        int clics = 0;
        for (int i = static_cast<int>(kSr * 0.3); i < kN; i += static_cast<int>(kSr * 0.1)) { in[static_cast<size_t>(i)] += 0.5f; in[static_cast<size_t>(i) + 1] -= 0.3f; ++clics; }
        const Buf out = run(e, in);
        double eIn = 0.0, eOut = 0.0;
        for (int i = a0; i < a1; ++i) { const double a = in[static_cast<size_t>(i)] - orig[static_cast<size_t>(i)], b = out[static_cast<size_t>(i)] - orig[static_cast<size_t>(i)]; eIn += a * a; eOut += b * b; }
        CHECK(eOut < 0.1 * eIn, "De-Click: error %.2e → %.2e (%.1f dB mejor)", eIn, eOut, 10.0 * std::log10(eIn / std::max(eOut, 1e-30)));
        CHECK(e.diagnostico().clicksPs > 5.f && e.diagnostico().clicksPs < 15.f, "diagnóstico: %.1f clics/s (10 reales)", e.diagnostico().clicksPs);
        // seno limpio: ningún clic falso
        Engine e2; e2.prepare(kSr, 256);
        e2.set(s);
        const Buf out2 = run(e2, orig);
        double maxErr = 0.0;
        for (int i = a0; i < a1; ++i) maxErr = std::max(maxErr, static_cast<double>(std::fabs(out2[static_cast<size_t>(i)] - orig[static_cast<size_t>(i)])));
        CHECK(maxErr < 1e-3 && e2.diagnostico().clicksPs == 0.f, "De-Click sobre seno limpio: sin falsos positivos (error %.2e, %.0f clics/s)", maxErr, e2.diagnostico().clicksPs);
    }

    // ---- 6) Gate: silencio con ruido −60 dB entre ráfagas de seno ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; s.gateOn = true; s.gateThresh = -40.f; s.gateRatio = 20.f; s.gateRelease = 50.f; s.gateHold = 10.f; e.set(s);
        Rng rng;
        Buf in(static_cast<size_t>(kN));
        for (int i = 0; i < kN; ++i) {
            const bool on = std::fmod(i / kSr, 1.0) < 0.5;
            in[static_cast<size_t>(i)] = static_cast<float>(0.001 * rng.next() + (on ? 0.3 * std::sin(2.0 * kPi * 440.0 * i / kSr) : 0.0));
        }
        const Buf out = run(e, in);
        const int q0 = static_cast<int>(kSr * 2.7), q1 = static_cast<int>(kSr * 2.95);   // tramo de silencio (0,5..1,0 de cada segundo)
        const int p0 = static_cast<int>(kSr * 2.1), p1 = static_cast<int>(kSr * 2.45);
        CHECK(db(rms(out, q0, q1)) < db(rms(in, q0, q1)) - 30.0, "Gate: ruido en silencio %.1f → %.1f dBFS", db(rms(in, q0, q1)), db(rms(out, q0, q1)));
        CHECK(std::fabs(db(rms(out, p0, p1)) - db(rms(in, p0, p1))) < 0.5, "Gate: la señal pasa (%.2f dB de cambio)", db(rms(out, p0, p1)) - db(rms(in, p0, p1)));
    }

    // ---- 7) Delta y Auto-Fix ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; s.humOn = true; s.humFreq = 2; s.delta = true; e.set(s);
        Buf in = sine(1000.0, 0.3, kN);
        const Buf hum = sine(60.0, 0.03, kN);
        for (size_t i = 0; i < in.size(); ++i) in[i] += hum[i];
        const Buf out = run(e, in);
        CHECK(db(toneAmp(out, a0, a1, 1000.0)) < -40.0 && toneAmp(out, a0, a1, 60.0) > 0.02, "Delta: solo lo quitado (1 kHz %.1f dBFS, 60 Hz %.1f dBFS)", db(toneAmp(out, a0, a1, 1000.0)), db(toneAmp(out, a0, a1, 60.0)));
        Diagnostico d; d.noiseDb = -58.f; d.humHz = 60; d.humDb = -40.f; d.clicksPs = 3.f; d.clipPct = 1.f; d.reverb = 60.f;
        Recomendacion r[kMaxRecomendaciones];
        const int n = recomendar(d, r);
        bool dn = false, hum60 = false, cl = false, dc = false, rv = false;
        for (int i = 0; i < n; ++i) {
            if (r[i].id == kDnOn && r[i].plain > 0.5) dn = true;
            if (r[i].id == kHumFreq && std::lround(r[i].plain) == 2) hum60 = true;
            if (r[i].id == kClOn && r[i].plain > 0.5) cl = true;
            if (r[i].id == kDcOn && r[i].plain > 0.5) dc = true;
            if (r[i].id == kRvOn && r[i].plain > 0.5) rv = true;
        }
        CHECK(dn && hum60 && cl && dc && rv && n <= kMaxRecomendaciones, "Auto-Fix: %d recomendaciones (denoise, hum 60, declick, declip, dereverb)", n);
    }
    // ---- 8) Estrés: todo activo, bloques de tamaño arbitrario, ajustes cambiando en caliente, Live on/off, 44,1 y 96 kHz ----
    for (double sr : { 44100.0, 96000.0 }) {
        Engine e; e.prepare(sr, 4096);
        Rng rng;
        Settings s;
        s.gateOn = s.dnOn = s.humOn = s.clOn = s.dcOn = s.rvOn = s.viOn = s.airOn = true; s.dnLearn = false;
        e.set(s);
        const int total = static_cast<int>(sr * 6.0);
        Buf in(static_cast<size_t>(total)), outL(static_cast<size_t>(total)), outR(static_cast<size_t>(total));
        for (int i = 0; i < total; ++i) {
            double v = 0.4 * std::sin(2.0 * kPi * 220.0 * i / sr) + 0.05 * std::sin(2.0 * kPi * 60.0 * i / sr) + 0.02 * rng.next();
            if (i % 9973 == 0) v += 0.8;                       // clic
            if ((i / 30000) % 5 == 0) v *= 4.0;                // recorte duro
            in[static_cast<size_t>(i)] = clampT(static_cast<float>(v), -1.f, 1.f);
        }
        bool finito = true; float pico = 0.f; int pos = 0, llamada = 0;
        g_allocs = 0;
        {
            ProcessScope scope;
            while (pos < total) {
                const int n = std::min(total - pos, 1 + static_cast<int>(std::fabs(rng.next()) * 2000.0));
                if (++llamada % 7 == 0) {   // ajustes aleatorios (set() solo reescribe coeficientes)
                    s.dnReduction = 24.f * std::fabs(rng.next()); s.dnSmooth = std::fabs(rng.next()); s.rvAmount = std::fabs(rng.next());
                    s.gateThresh = -80.f * std::fabs(rng.next()); s.humDepth = 60.f * std::fabs(rng.next()); s.viDepth = 40.f * std::fabs(rng.next());
                    s.inDb = 12.f * rng.next(); s.outDb = 6.f * rng.next(); s.delta = (llamada % 21 == 0); s.dnLearn = (llamada % 35 == 0);
                    if (llamada % 49 == 0) s.live = !s.live;
                    e.set(s);
                }
                e.process(in.data() + pos, in.data() + pos, outL.data() + pos, outR.data() + pos, n);
                pos += n;
            }
        }
        for (int i = 0; i < total; ++i) { const float a = outL[static_cast<size_t>(i)], b = outR[static_cast<size_t>(i)]; if (!std::isfinite(a) || !std::isfinite(b)) finito = false; pico = std::max(pico, std::max(std::fabs(a), std::fabs(b))); }
        CHECK(finito, "estrés %.0f Hz: sin NaN/Inf con todo activo y ajustes cambiando", sr);
        CHECK(pico < 8.0f, "estrés %.0f Hz: salida acotada (pico %.2f)", sr, pico);
        CHECK(g_allocs.load() == 0, "estrés %.0f Hz: cero asignaciones (incl. set() y cambio de Live) (%lld)", sr, g_allocs.load());
        Buf cero(static_cast<size_t>(sr), 0.f), o1(cero.size()), o2(cero.size());
        e.process(cero.data(), cero.data(), o1.data(), o2.data(), static_cast<int>(cero.size()));
        CHECK(allFinite(o1) && allFinite(o2), "estrés %.0f Hz: silencio digital finito", sr);
    }

    // ---- 9) De-Reverb: la cola de ráfagas reverberadas se reduce; Voice Isolator atenúa fuera de la banda de voz ----
    {
        Engine e; e.prepare(kSr, 256);
        Settings s; s.rvOn = true; s.rvAmount = 0.9f; s.rvTailMs = 300.f; e.set(s);
        Rng rng;
        Buf in(static_cast<size_t>(kN), 0.f);
        for (int sec = 0; sec < 4; ++sec) for (int i = 0; i < static_cast<int>(kSr * 0.08); ++i) in[static_cast<size_t>(sec * 48000 + i)] = 0.3f * rng.next();
        Buf rev(in.size(), 0.f);
        const double dec = std::exp(-6.9 / (0.6 * kSr));
        double y = 0.0;
        for (size_t i = 0; i < in.size(); ++i) { y = y * dec + in[i] * 0.02; rev[i] = in[i] + static_cast<float>(y); }
        const Buf out = run(e, rev);
        const int c0 = static_cast<int>(kSr * 2.25), c1 = static_cast<int>(kSr * 2.75);
        CHECK(db(rms(out, c0, c1)) < db(rms(rev, c0, c1)) - 3.0, "De-Reverb: cola %.1f -> %.1f dBFS", db(rms(rev, c0, c1)), db(rms(out, c0, c1)));
        Engine v; v.prepare(kSr, 256);
        Settings sv; sv.viOn = true; sv.viLow = 150.f; sv.viHigh = 6000.f; sv.viDepth = 30.f; v.set(sv);
        Buf mezcla = sine(1000.0, 0.2, kN);
        const Buf grave = sine(40.0, 0.2, kN);
        for (size_t i = 0; i < mezcla.size(); ++i) mezcla[i] += grave[i];
        const Buf ov = run(v, mezcla);
        const double bajada = db(toneAmp(mezcla, a0, a1, 40.0)) - db(toneAmp(ov, a0, a1, 40.0)), voz = db(toneAmp(ov, a0, a1, 1000.0)) - db(toneAmp(mezcla, a0, a1, 1000.0));
        CHECK(bajada > 6.0 && std::fabs(voz) < 1.5, "Voice Isolator: 40 Hz %.1f dB abajo, 1 kHz %.2f dB", bajada, voz);
    }


    std::printf("\n%d comprobaciones: %d OK, %d fallos\n", g_pass + g_fail, g_pass, g_fail);
    return g_fail ? 1 : 0;
}
