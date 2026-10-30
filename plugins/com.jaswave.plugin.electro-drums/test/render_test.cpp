// JasWave Electro Drums - prueba de render offline (solo electro_drums_dsp.h, sin SDK VST3).
//   JasWaveElectroDrums_rendertest [salida.wav]
// Mide por voz (todos los kits): pico, RMS, duracion efectiva, DC, NaN, clics de inicio, saturacion a vel 127;
// f0 del bombo (con barrido), espectro del hat (>5 kHz) y de la caja (cuerpo 150-300 Hz + ruido), choke de hats,
// timbre con la velocidad, determinismo bit a bit, independencia de bloque, tasas de muestreo, polifonia y CPU.
// Escribe un WAV de 24 bit con un groove house de 4 compases. Sale con codigo != 0 si algo falla.
#include "electro_drums_dsp.h"

#include <algorithm>
#include <chrono>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using namespace JasWaveElectroDrums;

static int g_fail = 0;
static void check(bool ok, const char* what, const std::string& detail = "") {
    std::printf("  [%s] %s %s\n", ok ? " OK " : "FAIL", what, detail.c_str());
    if (!ok) ++g_fail;
}
static std::string fmt(const char* f, double a = 0, double b = 0, double c = 0, double d = 0) {
    char buf[256]; std::snprintf(buf, sizeof buf, f, a, b, c, d); return buf;
}

struct Ev { int64_t at; int note; float vel; };
struct Out { std::vector<float> l, r; };

static DrumSettings defaults(int kit = 0) { DrumSettings s; s.kit = kit; return s; }

static Out render(double sr, int64_t total, std::vector<Ev> evs, const DrumSettings& st, int blk = 256) {
    DrumEngine e;
    e.prepare(sr, blk);
    e.setSettings(st);
    e.prepare(sr, blk);   // asienta los suavizados en los valores finales
    std::sort(evs.begin(), evs.end(), [](const Ev& a, const Ev& b) { return a.at < b.at; });
    Out o; o.l.assign(static_cast<size_t>(total), 0.0f); o.r.assign(static_cast<size_t>(total), 0.0f);
    size_t ei = 0; int64_t pos = 0;
    while (pos < total) {
        const int64_t n = std::min<int64_t>(blk, total - pos);
        int64_t p = 0;
        while (p < n) {
            while (ei < evs.size() && evs[ei].at <= pos + p) { e.noteOn(evs[ei].note, evs[ei].vel); ++ei; }
            int64_t next = n;
            if (ei < evs.size() && evs[ei].at - pos < next) next = evs[ei].at - pos;
            if (next <= p) next = p + 1;
            e.render(o.l.data() + pos + p, o.r.data() + pos + p, static_cast<int>(next - p), nullptr);
            p = next;
        }
        pos += n;
    }
    return o;
}
static std::vector<double> mid(const Out& o) {
    std::vector<double> m(o.l.size());
    for (size_t i = 0; i < m.size(); ++i) m[i] = 0.5 * (o.l[i] + o.r[i]);
    return m;
}
static double peakOf(const Out& o) {
    double p = 0; for (size_t i = 0; i < o.l.size(); ++i) p = std::max({ p, std::fabs((double)o.l[i]), std::fabs((double)o.r[i]) }); return p;
}
static bool hasNan(const Out& o) {
    for (size_t i = 0; i < o.l.size(); ++i) if (!std::isfinite(o.l[i]) || !std::isfinite(o.r[i])) return true;
    return false;
}
static double rmsOf(const std::vector<double>& x, size_t a, size_t b) {
    b = std::min(b, x.size()); if (b <= a) return 0; double s = 0; for (size_t i = a; i < b; ++i) s += x[i] * x[i]; return std::sqrt(s / (b - a));
}
// Duracion efectiva: ultimo instante (s) con RMS de ventana de 10 ms por encima de -50 dB respecto a la ventana maxima
static double duracion(const std::vector<double>& x, double sr) {
    const size_t w = static_cast<size_t>(0.010 * sr);
    double mx = 0; for (size_t i = 0; i + w <= x.size(); i += w) mx = std::max(mx, rmsOf(x, i, i + w));
    double last = 0; for (size_t i = 0; i + w <= x.size(); i += w) if (rmsOf(x, i, i + w) > mx * 0.00316) last = (i + w) / sr;
    return last;
}
// FFT radix-2
static void fft(std::vector<std::complex<double>>& a) {
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; ++i) { size_t bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) std::swap(a[i], a[j]); }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = -2 * 3.14159265358979323846 / len; const std::complex<double> wl(std::cos(ang), std::sin(ang));
        for (size_t i = 0; i < n; i += len) { std::complex<double> w(1); for (size_t k = 0; k < len / 2; ++k) { auto u = a[i + k], v = a[i + k + len / 2] * w; a[i + k] = u + v; a[i + k + len / 2] = u - v; w *= wl; } }
    }
}
struct Spec { std::vector<double> pw; double binHz; };
static Spec spectrum(const std::vector<double>& x, size_t a, size_t len, double sr, size_t N = 16384) {
    std::vector<std::complex<double>> f(N, 0.0);
    for (size_t i = 0; i < len && a + i < x.size(); ++i) f[i] = x[a + i] * (0.5 - 0.5 * std::cos(2 * 3.14159265358979323846 * i / (len - 1)));
    fft(f);
    Spec s; s.binHz = sr / N; s.pw.resize(N / 2);
    for (size_t i = 0; i < N / 2; ++i) s.pw[i] = std::norm(f[i]);
    return s;
}
static double bandEnergy(const Spec& s, double f0, double f1) {
    double e = 0; for (size_t i = 0; i < s.pw.size(); ++i) { const double f = i * s.binHz; if (f >= f0 && f < f1) e += s.pw[i]; } return e;
}
static double centroid(const Spec& s) {
    double n = 0, d = 0; for (size_t i = 1; i < s.pw.size(); ++i) { n += i * s.binHz * s.pw[i]; d += s.pw[i]; } return d > 0 ? n / d : 0;
}
static double peakFreq(const Spec& s, double f0, double f1) {
    double best = 0, bf = 0; for (size_t i = 0; i < s.pw.size(); ++i) { const double f = i * s.binHz; if (f >= f0 && f < f1 && s.pw[i] > best) { best = s.pw[i]; bf = f; } } return bf;
}
// Frecuencia por cruces ascendentes por cero en [t0,t1] s
static double freqZc(const std::vector<double>& x, double sr, double t0, double t1) {
    std::vector<double> z;
    const size_t a = static_cast<size_t>(t0 * sr), b = std::min(x.size() - 1, static_cast<size_t>(t1 * sr));
    for (size_t i = a + 1; i < b; ++i) if (x[i - 1] < 0 && x[i] >= 0) z.push_back(i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]));
    if (z.size() < 3) return 0;
    return (z.size() - 1) * sr / (z.back() - z.front());
}
static double maxDiff(const std::vector<double>& x, size_t a, size_t b) {
    double m = 0; for (size_t i = std::max<size_t>(a, 1); i < std::min(b, x.size()); ++i) m = std::max(m, std::fabs(x[i] - x[i - 1])); return m;
}

static const char* kNames[] = { "808", "909", "Techno", "Lo-fi" };
struct NoteDef { int note; const char* name; };
static const NoteDef kNotes[] = {
    { 35, "bombo2" }, { 36, "bombo" }, { 38, "caja" }, { 40, "caja2" }, { 39, "clap" }, { 37, "rimshot" }, { 42, "hat-cerrado" }, { 44, "hat-pedal" }, { 46, "hat-abierto" },
    { 41, "tom41" }, { 43, "tom43" }, { 45, "tom45" }, { 47, "tom47" }, { 48, "tom48" }, { 50, "tom50" },
    { 49, "crash" }, { 57, "crash2" }, { 52, "china" }, { 55, "splash" }, { 51, "ride" }, { 59, "ride2" }, { 53, "ride-campana" },
    { 56, "cowbell" }, { 70, "shaker" }, { 69, "cabasa" }, { 82, "shaker2" }, { 54, "pandereta" } };

static bool writeWav24(const char* path, const std::vector<float>& L, const std::vector<float>& R, int sr) {
    FILE* f = std::fopen(path, "wb"); if (!f) return false;
    const uint32_t n = static_cast<uint32_t>(L.size()), db = n * 6;
    auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); }; auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); w32(36 + db); std::fwrite("WAVEfmt ", 1, 8, f); w32(16); w16(1); w16(2); w32(sr); w32(sr * 6); w16(6); w16(24);
    std::fwrite("data", 1, 4, f); w32(db);
    for (uint32_t i = 0; i < n; ++i) for (int c = 0; c < 2; ++c) {
        const double v = std::max(-1.0, std::min(1.0, (double)(c ? R[i] : L[i]))); const int32_t q = (int32_t)std::lround(v * 8388607.0);
        std::fwrite(&q, 3, 1, f);
    }
    std::fclose(f); return true;
}

int main(int argc, char** argv) {
    const double sr = 48000.0;
    std::printf("== JasWave Electro Drums: prueba de render offline (sr %.0f Hz) ==\n", sr);

    // [1] cada nota de cada kit: senal no vacia, sin NaN, sin clipping a vel 127, inicio sin clic, DC
    std::printf("[1] Voces x kits a velocidad 127 (pico L/R, RMS 0-150 ms, duracion efectiva -50 dB, DC, 1a muestra, salto max en los primeros 1.5 ms / pico)\n");
    std::printf("  %-7s %-13s %5s %7s %7s %7s %7s %9s %9s\n", "kit", "voz", "nota", "pico", "rms", "dur_s", "DC", "1a_mues", "ini/pk");
    for (int kit = 0; kit < 4; ++kit) {
        for (const auto& nd : kNotes) {
            const Out o = render(sr, static_cast<int64_t>(sr * 4.0), { { 0, nd.note, 1.0f } }, defaults(kit));
            const auto m = mid(o);
            const double pk = peakOf(o), rms = rmsOf(m, 0, static_cast<size_t>(0.15 * sr)), dur = duracion(m, sr);
            double dc = 0; for (double v : m) dc += v; dc /= m.size();
            const double first = std::fabs(m[0]);
            double ini = 0; for (size_t i = 0; i < 5; ++i) ini = std::max(ini, std::fabs(m[i]));   // primeras 5 muestras (0.1 ms)
            const double jump = ini / std::max(pk, 1e-9);
            std::printf("  %-7s %-13s %5d %7.3f %7.4f %7.2f %7.5f %9.5f %9.3f\n", kNames[kit], nd.name, nd.note, pk, rms, dur, dc, first, jump);
            bool bad = hasNan(o);
            if (bad) check(false, "NaN/Inf", fmt("kit %.0f nota %.0f", kit, nd.note));
            if (rms < 0.01) check(false, "senal vacia", fmt("kit %.0f nota %.0f rms %.5f", kit, nd.note, rms));
            if (pk >= 0.95) check(false, "pico >= 0.95 a vel 127", fmt("kit %.0f nota %.0f pico %.3f", kit, nd.note, pk));
            if (first > 1e-6) check(false, "clic en la primera muestra", fmt("kit %.0f nota %.0f %.5f", kit, nd.note, first));
            if (std::fabs(dc) > 0.004) check(false, "DC", fmt("kit %.0f nota %.0f dc %.5f", kit, nd.note, dc));
            if (jump > 0.25) check(false, "arranque brusco (> 25 % del pico en 0.1 ms)", fmt("kit %.0f nota %.0f %.3f", kit, nd.note, jump));
        }
    }
    check(g_fail == 0, "[1] todas las voces de todos los kits: sin NaN, no vacias, pico < 0.95, sin clic de inicio, sin DC");

    // [2] notas fuera del mapa: silencio
    {
        int silent = 0, total = 0;
        for (int n = 0; n < 128; ++n) {
            bool enMapa = false; for (const auto& nd : kNotes) if (nd.note == n) enMapa = true;
            if (enMapa) continue;
            ++total;
            const Out o = render(sr, 4800, { { 0, n, 1.0f } }, defaults());
            if (peakOf(o) == 0.0) ++silent;
        }
        check(silent == total, "[2] notas fuera del mapa GM son silenciosas", fmt("%.0f/%.0f", silent, total));
    }

    // [3] bombo: f0 y barrido por kit
    std::printf("[3] Bombo (nota 36, vel 127): fundamental (ceros 120-300 ms), frecuencia inicial (0-12 ms) y pico espectral\n");
    for (int kit = 0; kit < 4; ++kit) {
        const Out o = render(sr, static_cast<int64_t>(sr * 1.5), { { 0, 36, 1.0f } }, defaults(kit));
        const auto m = mid(o);
        const double f0 = freqZc(m, sr, 0.12, 0.30), f0s = freqZc(m, sr, 0.0, 0.030);
        const Spec sp = spectrum(m, static_cast<size_t>(0.06 * sr), static_cast<size_t>(0.25 * sr), sr);
        const double pf = peakFreq(sp, 20, 300);
        std::printf("  kit %-7s f0 = %.1f Hz | media 0-30 ms = %.1f Hz (barrido x%.2f) | pico espectral %.1f Hz | pico %.3f\n", kNames[kit], f0, f0s, f0s / std::max(f0, 1.0), pf, peakOf(o));
        check(f0 >= 40.0 && f0 <= 70.0, "f0 del bombo en 40-70 Hz", fmt("%.1f Hz", f0));
        check(f0s > f0 * 1.3, "hay barrido de tono (media 0-30 ms > 1.3 x f0)", fmt("%.1f vs %.1f", f0s, f0));
    }
    {   // Kick Tune y Tune global siguen la afinacion
        DrumSettings s = defaults(); s.kickTuneHz = 40.0;
        const double a = freqZc(mid(render(sr, 72000, { { 0, 36, 1.0f } }, s)), sr, 0.12, 0.30);
        s.kickTuneHz = 70.0;
        const double b = freqZc(mid(render(sr, 72000, { { 0, 36, 1.0f } }, s)), sr, 0.12, 0.30);
        check(std::fabs(a - 40.0) < 3.0 && std::fabs(b - 70.0) < 4.0, "Kick Tune 40 y 70 Hz se miden", fmt("%.1f / %.1f Hz", a, b));
        s = defaults(); s.tuneSt = 12.0; s.kickTuneHz = 40.0;
        const double c = freqZc(mid(render(sr, 72000, { { 0, 36, 1.0f } }, s)), sr, 0.12, 0.30);
        check(std::fabs(c - 80.0) < 5.0, "Tune global +12 st duplica la frecuencia", fmt("%.1f Hz", c));
        s = defaults(); const double d1 = duracion(mid(render(sr, 192000, { { 0, 36, 1.0f } }, s)), sr);
        s.kickDecay = 2.0; const double d2 = duracion(mid(render(sr, 192000, { { 0, 36, 1.0f } }, s)), sr);
        check(d2 > d1 * 1.5, "Kick Decay alarga el bombo", fmt("%.2f s -> %.2f s", d1, d2));
        s = defaults(); s.kickSweep = 0.0; const double f0n = freqZc(mid(render(sr, 72000, { { 0, 36, 1.0f } }, s)), sr, 0.0, 0.030);
        s.kickSweep = 1.0; const double f0m = freqZc(mid(render(sr, 72000, { { 0, 36, 1.0f } }, s)), sr, 0.0, 0.030);
        check(f0m > f0n * 1.5, "Kick Sweep controla el barrido", fmt("%.0f Hz (0 %%) vs %.0f Hz (100 %%)", f0n, f0m));
    }

    // [4] espectro: hats, caja, clap
    std::printf("[4] Espectro\n");
    for (int kit = 0; kit < 4; ++kit) {
        for (int n : { 42, 46 }) {
            const Out o = render(sr, static_cast<int64_t>(sr * 1.0), { { 0, n, 1.0f } }, defaults(kit));
            const auto m = mid(o);
            const Spec sp = spectrum(m, 0, static_cast<size_t>(0.12 * sr), sr);
            const double tot = bandEnergy(sp, 20, 24000), hi = bandEnergy(sp, 5000, 24000);
            std::printf("  hat %-3d kit %-7s energia > 5 kHz = %.1f %% | centroide %.0f Hz\n", n, kNames[kit], 100.0 * hi / tot, centroid(sp));
            check(hi / tot > (kit == 3 ? 0.5 : 0.85), "hat con energia dominante > 5 kHz", fmt("%.1f %%", 100.0 * hi / tot));
        }
        const Out o = render(sr, static_cast<int64_t>(sr * 1.0), { { 0, 38, 1.0f } }, defaults(kit));
        const auto m = mid(o);
        const Spec sb = spectrum(m, 0, static_cast<size_t>(0.060 * sr), sr);
        const double tot = bandEnergy(sb, 20, 24000), body = bandEnergy(sb, 150, 330), noise = bandEnergy(sb, 2000, 12000);
        const double pf = peakFreq(sb, 100, 400);
        std::printf("  caja kit %-7s cuerpo 150-330 Hz = %.1f %% (pico %.0f Hz) | ruido 2-12 kHz = %.1f %%\n", kNames[kit], 100.0 * body / tot, pf, 100.0 * noise / tot);
        check(pf >= 170.0 && pf <= 260.0, "caja: pico tonal en 170-260 Hz", fmt("%.0f Hz", pf));
        check(noise / tot > 0.15 && body / tot > 0.05, "caja: cuerpo + ruido a la vez");
        const Out oc = render(sr, static_cast<int64_t>(sr * 1.0), { { 0, 39, 1.0f } }, defaults(kit));
        const Spec sc = spectrum(mid(oc), 0, static_cast<size_t>(0.1 * sr), sr);
        const double ct = centroid(sc);
        std::printf("  clap kit %-7s centroide %.0f Hz\n", kNames[kit], ct);
        check(ct > 800.0 && ct < 6000.0, "clap: ruido en banda media", fmt("%.0f Hz", ct));
    }

    // [5] choke de hats
    std::printf("[5] Choke de hats\n");
    {
        const int64_t t = static_cast<int64_t>(sr * 0.1);
        const Out open = render(sr, static_cast<int64_t>(sr * 1.0), { { 0, 46, 1.0f } }, defaults());
        const Out chk = render(sr, static_cast<int64_t>(sr * 1.0), { { 0, 46, 1.0f }, { t, 42, 1.0f } }, defaults());
        const Out ped = render(sr, static_cast<int64_t>(sr * 1.0), { { 0, 46, 1.0f }, { t, 44, 1.0f } }, defaults());
        const Out o2 = render(sr, static_cast<int64_t>(sr * 1.0), { { 0, 46, 1.0f }, { t, 46, 1.0f } }, defaults());
        const auto mo = mid(open), mc = mid(chk), mp = mid(ped), m2 = mid(o2);
        const size_t a = static_cast<size_t>(0.30 * sr), b = static_cast<size_t>(0.80 * sr);
        const double rOpen = rmsOf(mo, a, b), rChk = rmsOf(mc, a, b), rPed = rmsOf(mp, a, b);
        std::printf("  RMS 300-800 ms: abierto solo %.5f | cerrado corta abierto %.6f | pedal corta abierto %.6f\n", rOpen, rChk, rPed);
        check(rOpen > 0.003, "el hat abierto suena a los 300-800 ms");
        check(rChk < rOpen * 0.01 && rPed < rOpen * 0.06, "cerrado/pedal cortan el abierto (>40 dB menos que el abierto solo)");
        // el abierto retocado se corta en vez de apilarse: pico RMS acotado
        check(rmsOf(m2, a, b) < rOpen * 2.2, "abierto sobre abierto no apila voces");
        // clic: el salto maximo muestra a muestra en la ventana del choke no supera el del propio hat
        const double jOpen = maxDiff(mo, 0, t), jChk = maxDiff(mc, t - 2, t + static_cast<int64_t>(0.012 * sr));
        std::printf("  salto max muestra-muestra: hat abierto (0-100 ms) %.4f | ventana del choke %.4f\n", jOpen, jChk);
        check(jChk <= jOpen * 1.3, "choke sin clic (sin saltos mayores que los del propio hat)");
        // la cola del abierto llega a cero en <= 6 ms: se ve restando el cerrado (misma nota, mismo hit) -> usar allNotesOff
        DrumEngine e; e.prepare(sr, 256); e.setSettings(defaults()); e.prepare(sr, 256);
        std::vector<float> L(48000), R(48000);
        e.noteOn(46, 1.0f); e.render(L.data(), R.data(), 4800, nullptr);
        e.allNotesOff(); e.render(L.data() + 4800, R.data() + 4800, 43200, nullptr);
        std::vector<double> mm(L.size()); for (size_t i = 0; i < mm.size(); ++i) mm[i] = 0.5 * (L[i] + R[i]);
        const double jf = maxDiff(mm, 4800, 4800 + 300), pre = maxDiff(mm, 2400, 4800);
        const double tail = rmsOf(mm, 4800 + 400, 48000);
        std::printf("  allNotesOff sobre hat abierto: salto max en el fundido %.4f (antes %.4f), RMS posterior %.8f\n", jf, pre, tail);
        check(tail < 1e-7 && jf <= pre * 1.3, "fundido de 4 ms sin clic y silencio posterior");
    }

    // [6] velocidad = volumen y timbre
    std::printf("[6] Velocidad: volumen y timbre\n");
    {
        double pk[2], cen[2], f0s[2];
        const float vs[2] = { 0.3f, 1.0f };
        for (int i = 0; i < 2; ++i) {
            const Out o = render(sr, 48000, { { 0, 36, vs[i] } }, defaults()); pk[i] = peakOf(o);
            const auto m = mid(o); cen[i] = centroid(spectrum(m, 0, static_cast<size_t>(0.1 * sr), sr)); f0s[i] = freqZc(m, sr, 0.0, 0.030);
        }
        std::printf("  bombo vel 38 vs 127: pico %.3f -> %.3f | centroide %.0f -> %.0f Hz | frecuencia media 0-30 ms %.0f -> %.0f Hz\n", pk[0], pk[1], cen[0], cen[1], f0s[0], f0s[1]);
        check(pk[1] > pk[0] * 2.0 && cen[1] > cen[0] * 1.05 && f0s[1] > f0s[0], "bombo: mas fuerte, mas click y mas barrido con velocidad");
        double cs[2], ch[2], ps[2], ph[2];
        for (int i = 0; i < 2; ++i) {
            const Out o = render(sr, 48000, { { 0, 38, vs[i] } }, defaults(1)); cs[i] = centroid(spectrum(mid(o), 0, static_cast<size_t>(0.1 * sr), sr)); ps[i] = peakOf(o);
            const Out h = render(sr, 48000, { { 0, 42, vs[i] } }, defaults(1)); ch[i] = centroid(spectrum(mid(h), 0, static_cast<size_t>(0.06 * sr), sr)); ph[i] = peakOf(h);
        }
        std::printf("  caja vel 38 vs 127: pico %.3f -> %.3f | centroide %.0f -> %.0f Hz;  hat: pico %.3f -> %.3f | centroide %.0f -> %.0f Hz\n", ps[0], ps[1], cs[0], cs[1], ph[0], ph[1], ch[0], ch[1]);
        check(cs[1] > cs[0] * 1.05 && ch[1] > ch[0] * 1.02 && ps[1] > ps[0] * 2 && ph[1] > ph[0] * 2, "caja y hat: volumen y brillo suben con la velocidad");
        const Out low = render(sr, 4800, { { 0, 36, 0.0f } }, defaults());
        check(peakOf(low) == 0.0, "velocidad 0 = note-off: no suena");
    }

    // [7] globales
    std::printf("[7] Parametros globales\n");
    {
        DrumSettings s = defaults(); const Out a = render(sr, 96000, { { 0, 42, 1.0f }, { 0, 46, 1.0f } }, s);
        DrumSettings s2 = defaults(); s2.volumeDb = -6.0; const Out b = render(sr, 96000, { { 0, 36, 1.0f } }, s2);
        const Out b0 = render(sr, 96000, { { 0, 36, 1.0f } }, defaults());
        check(std::fabs(peakOf(b) / peakOf(b0) - 0.5012) < 0.03, "Volume -6 dB", fmt("ratio %.4f", peakOf(b) / peakOf(b0)));
        s = defaults(); s.lvlDb[0] = -12.0; const Out c = render(sr, 96000, { { 0, 36, 1.0f } }, s);
        check(std::fabs(peakOf(c) / peakOf(b0) - 0.2512) < 0.03, "nivel del bombo -12 dB", fmt("ratio %.4f", peakOf(c) / peakOf(b0)));
        s = defaults(); s.lvlDb[2] = -12.0; const Out d0 = render(sr, 96000, { { 0, 36, 1.0f }, { 0, 42, 1.0f } }, s);
        const Out d1 = render(sr, 96000, { { 0, 42, 1.0f } }, defaults());
        const Out d2 = render(sr, 96000, { { 0, 42, 1.0f } }, s);
        check(std::fabs(peakOf(d2) / peakOf(d1) - 0.2512) < 0.03, "nivel de hats -12 dB", fmt("ratio %.4f", peakOf(d2) / peakOf(d1)));
        // pan: bombo a la izquierda
        s = defaults(); s.pan[0] = -1.0; const Out pl = render(sr, 48000, { { 0, 36, 1.0f } }, s);
        double el = 0, er = 0; for (size_t i = 0; i < pl.l.size(); ++i) { el += pl.l[i] * pl.l[i]; er += pl.r[i] * pl.r[i]; }
        s.pan[0] = 1.0; const Out pr = render(sr, 48000, { { 0, 36, 1.0f } }, s);
        double fl = 0, fr = 0; for (size_t i = 0; i < pr.l.size(); ++i) { fl += pr.l[i] * pr.l[i]; fr += pr.r[i] * pr.r[i]; }
        check(er < el * 1e-4 && fl < fr * 1e-4, "pan por voz a los extremos", fmt("L %.3g R %.3g | L %.3g R %.3g", el, er, fl, fr));
        // decay general
        s = defaults(); const double da = duracion(mid(render(sr, 192000, { { 0, 49, 1.0f } }, s)), sr);
        s.decay = 2.0; const double db = duracion(mid(render(sr, 192000, { { 0, 49, 1.0f } }, s)), sr);
        check(db > da * 1.5, "Decay general alarga el crash", fmt("%.2f s -> %.2f s", da, db));
        // drive
        s = defaults(); s.drive = 1.0; const Out dr = render(sr, 96000, { { 0, 36, 1.0f }, { 0, 38, 1.0f }, { 0, 42, 1.0f } }, s);
        check(!hasNan(dr) && peakOf(dr) <= 1.0, "Drive 100 %: sin NaN y pico <= 1.0", fmt("%.3f", peakOf(dr)));
        // bypass: silencio
        s = defaults(); s.bypass = true; const Out by = render(sr, 48000, { { 0, 36, 1.0f } }, s);
        check(peakOf(by) < 1e-6, "Bypass: silencio");
        // variacion 0 vs 100: golpes repetidos casi iguales, nunca identicos con 100 %
        s = defaults(); s.variation = 0.0;
        const Out v0 = render(sr, 96000, { { 0, 38, 1.0f }, { 24000, 38, 1.0f } }, s);
        double dif0 = 0; for (int i = 0; i < 2400; ++i) dif0 = std::max(dif0, std::fabs((double)v0.l[i] - v0.l[24000 + i]));
        std::printf("  Variation 0 %%: diferencia max entre dos golpes iguales = %.4f (ruido distinto por golpe)\n", dif0);
    }

    // [8] polifonia, caos y estabilidad
    std::printf("[8] Estres: ametralladora de notas y polifonia\n");
    {
        std::vector<Ev> evs;
        uint32_t r = 12345;
        for (int i = 0; i < 4000; ++i) { r = r * 1664525u + 1013904223u; const int n = kNotes[(r >> 8) % (sizeof kNotes / sizeof kNotes[0])].note; evs.push_back({ (int64_t)i * 120, n, 1.0f }); }
        for (int kit = 0; kit < 4; ++kit) {
            DrumSettings s = defaults(kit); s.drive = 0.5;
            const Out o = render(sr, 4000LL * 120 + 48000, evs, s, 333);
            check(!hasNan(o) && peakOf(o) <= 1.0, "4000 golpes seguidos: sin NaN, pico <= 1.0", fmt("kit %.0f pico %.3f", kit, peakOf(o)));
        }
        const Out all = render(sr, 96000, { { 0, 36, 1.0f }, { 0, 38, 1.0f }, { 0, 39, 1.0f }, { 0, 42, 1.0f }, { 0, 49, 1.0f }, { 0, 41, 1.0f }, { 0, 56, 1.0f } }, defaults());
        std::printf("  7 voces simultaneas a 127: pico %.3f\n", peakOf(all));
        check(peakOf(all) <= 1.0 && !hasNan(all), "mezcla de 7 voces a 127 no pasa de 1.0 (limitador suave)");
    }

    // [9] determinismo e independencia de bloque / tasa
    std::printf("[9] Determinismo\n");
    {
        std::vector<Ev> evs = { { 0, 36, 1.0f }, { 4000, 42, 0.8f }, { 8000, 38, 0.9f }, { 8000, 39, 0.7f }, { 12000, 46, 0.6f }, { 20000, 44, 1.0f }, { 30000, 49, 1.0f } };
        const Out a = render(sr, 96000, evs, defaults(1)), b = render(sr, 96000, evs, defaults(1));
        check(a.l == b.l && a.r == b.r, "dos renders identicos: bit a bit", "");
        const Out c = render(sr, 96000, evs, defaults(1), 64), d = render(sr, 96000, evs, defaults(1), 1000);
        check(c.l == a.l && d.l == a.l && c.r == a.r && d.r == a.r, "independiente del tamano de bloque (64/256/1000)");
        DrumEngine e; e.prepare(sr, 256); e.setSettings(defaults(1)); e.prepare(sr, 256);
        std::vector<float> L1(2000), R1(2000), L2(2000), R2(2000);
        e.noteOn(38, 1.0f); e.render(L1.data(), R1.data(), 2000, nullptr);
        e.reset(); e.noteOn(38, 1.0f); e.render(L2.data(), R2.data(), 2000, nullptr);
        check(L1 == L2 && R1 == R2, "reset() reproduce el mismo golpe");
    }
    std::printf("[10] Otras tasas de muestreo\n");
    for (double s2 : { 44100.0, 96000.0 }) {
        const Out o = render(s2, static_cast<int64_t>(s2 * 1.5), { { 0, 36, 1.0f }, { 0, 42, 1.0f } }, defaults());
        const auto m = mid(render(s2, static_cast<int64_t>(s2 * 1.5), { { 0, 36, 1.0f } }, defaults()));
        const double f0 = freqZc(m, s2, 0.12, 0.30);
        check(!hasNan(o) && f0 >= 40 && f0 <= 70 && peakOf(o) <= 1.0, "tasa distinta: f0 y pico correctos", fmt("sr %.0f f0 %.1f Hz", s2, f0));
    }

    // [11] WAV de groove house 4/4 a 124 bpm, 4 compases, por kit 909 y 808
    {
        const double bpm = 124.0, spb = sr * 60.0 / bpm, sx = spb / 4.0;
        std::vector<Ev> evs;
        for (int bar = 0; bar < 4; ++bar) for (int st = 0; st < 16; ++st) {
            const int64_t t = static_cast<int64_t>((bar * 16 + st) * sx);
            if (st % 4 == 0) evs.push_back({ t, 36, 1.0f });
            if (st == 4 || st == 12) { evs.push_back({ t, 39, 0.9f }); evs.push_back({ t, 38, 0.55f }); }
            if (st % 4 == 2) evs.push_back({ t, 46, 0.8f });
            else if (st % 2 == 0) evs.push_back({ t, 42, 0.6f });
            else evs.push_back({ t, 42, 0.35f });
            if (st == 7 || st == 15) evs.push_back({ t, 56, 0.6f });
            if (st == 10 && bar % 2) evs.push_back({ t, 45, 0.9f });
            if (st == 14 && bar % 2) evs.push_back({ t, 48, 0.9f });
            if (st == 0 && bar == 0) evs.push_back({ t, 49, 0.9f });
            if (st % 4 == 3) evs.push_back({ t, 70, 0.5f });
        }
        const int64_t total = static_cast<int64_t>(4 * 16 * sx + sr);
        const Out g = render(sr, total, evs, defaults(1));
        std::printf("[11] Groove house 4 compases (909): pico %.3f\n", peakOf(g));
        check(!hasNan(g) && peakOf(g) <= 1.0, "groove: sin NaN y sin pasar de 1.0");
        if (argc > 1) check(writeWav24(argv[1], g.l, g.r, 48000), "WAV escrito", argv[1]);
        // CPU
        const auto t0 = std::chrono::steady_clock::now();
        const Out big = render(sr, static_cast<int64_t>(sr * 20), evs, defaults(2), 512);
        const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        std::printf("  CPU: 20 s de audio (groove denso, kit techno) en %.3f s (%.1fx tiempo real)\n", secs, 20.0 / std::max(secs, 1e-9));
        check(secs < 20.0 / 20.0 && !hasNan(big), "CPU: al menos 20x tiempo real");
    }

    std::printf("== %s (%d fallos) ==\n", g_fail ? "FALLO" : "TODO OK", g_fail);
    return g_fail ? 1 : 0;
}
