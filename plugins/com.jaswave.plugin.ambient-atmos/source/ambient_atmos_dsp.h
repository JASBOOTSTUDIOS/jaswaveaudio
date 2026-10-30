// =====================================================================================
//  JasWave Ambient Atmos - instrumento ambiental (sin SDK VST3; header-only, sin asignaciones en render)
//
//  Cadena:  sampler(s) de sostenido infinito (3 bancos bajo demanda) o motor modelado de respaldo
//           -> saturacion de cinta/valvula -> paso-altos -> paso-bajo SVF con LFO lento (estereo en cuadratura)
//           -> EQ 4 bandas -> ensemble chorus -> TAPE DELAY ping-pong sincronizado al tempo (wow/flutter, filtro y
//           saturacion en el lazo) -> REVERB FDN plate/hall con cola modulada y SHIMMER (octava arriba en el lazo)
//           -> compresor suave -> anchura M/S -> volumen
//  Macros del panel: A (Attack), R (Release), E/FX (eco+espacio+modulacion coherentes), Volumen, Afinacion.
//  Estabilidad: todas las realimentaciones tienen ganancia de lazo < 1 con filtros pasivos; el shimmer usa una
//  rotacion con CAG de potencia (como el Shimmer Pad); cada tramo esta acotado y la salida pasa por un limitador suave.
// =====================================================================================
#pragma once

#include "ambient_atmos_presets.h"
#include "jw_dsp.h"
#include "jw_fxrack.h"
#include "jw_params.h"
#include "jw_sampler.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <string>
#include <thread>
#include <vector>

namespace JasWaveAmbientAtmos {

using namespace JasWaveDsp;
using namespace JasWaveVst;

constexpr int kTick = 32;           // periodo de control (muestras)
constexpr int kChunk = 256;         // bloque interno maximo
constexpr int kFdn = 8;
constexpr int kPs = 4;
constexpr int kMaxModelVoices = 12;
constexpr int kNumBanks = 3;
constexpr double kTwoPi = 6.283185307179586476925286766559;

struct AtmosSettings {
    double p[kParamCount]{};        // valores planos de TODOS los parametros (kPreset aparte)
    int preset{0};
    AtmosSettings() { loadPreset(0); }
    void loadPreset(int i) {
        i = std::clamp(i, 0, kNumPresets - 1);
        const Preset& pr = presets()[static_cast<size_t>(i)];
        for (int k = 0; k < kParamCount; ++k) p[k] = pr.p[k];
        preset = i;
    }
    bool bypass() const { return p[kBypass] >= 0.5; }
};

struct AtmosBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<uint64_t> keys[2]{};
    std::atomic<int> bankState{0};            // 0 sin banco (motor modelado) | 1 cargando | 2 listo | 3 error
    std::atomic<float> delayMs{0.0f};
    std::atomic<float> cutoffHz{8000.0f};
};

// -------------------------------------------------------------------------------------
//  Utilidades
// -------------------------------------------------------------------------------------
struct Xor {
    uint32_t s{0x2545F491u};
    void seed(uint32_t v) { s = v ? v : 0x9E3779B9u; for (int i = 0; i < 4; ++i) u32(); }
    uint32_t u32() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    double uni() { return u32() * (1.0 / 4294967296.0); }
    double bi() { return uni() * 2.0 - 1.0; }
};

inline double softClip(double x) {
    const double a = std::fabs(x);
    if (a < 0.6) return x;
    const double y = 0.6 + 0.37 * std::tanh((a - 0.6) * (1.0 / 0.37));   // techo 0.97
    return x < 0 ? -y : y;
}
inline double fastTanh(double x) {
    if (x > 3.0) return 1.0;
    if (x < -3.0) return -1.0;
    const double x2 = x * x;
    return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}
inline size_t pow2AtLeast(size_t n) { size_t p = 1; while (p < n) p <<= 1; return p; }

struct DelayBuf {
    std::vector<double> b;
    size_t mask{0}, w{0};
    void alloc(size_t n) { b.assign(pow2AtLeast(n + 4), 0.0); mask = b.size() - 1; w = 0; }
    void clear() { std::fill(b.begin(), b.end(), 0.0); w = 0; }
    inline void push(double x) { b[w] = x; w = (w + 1) & mask; }
    inline double read(double D) const {   // D = 1 -> ultima muestra escrita
        const double pos = static_cast<double>(w) - D;
        const double fl = std::floor(pos);
        const double fr = pos - fl;
        const size_t i0 = static_cast<size_t>(static_cast<int64_t>(fl)) & mask;
        const size_t i1 = (i0 + 1) & mask;
        return b[i0] + (b[i1] - b[i0]) * fr;
    }
};

struct HighPass2 {
    double b0{1}, b1{-2}, b2{1}, a1{0}, a2{0}, z1[2]{}, z2[2]{};
    void design(double sr, double fc) {
        const double w = std::tan(kPi * std::min(fc, 0.45 * sr) / sr), n = 1.0 / (1.0 + 1.41421356237 * w + w * w);
        b0 = n; b1 = -2.0 * n; b2 = n;
        a1 = 2.0 * (w * w - 1.0) * n; a2 = (1.0 - 1.41421356237 * w + w * w) * n;
    }
    void reset() { z1[0] = z1[1] = z2[0] = z2[1] = 0.0; }
    inline double process(int c, double x) {
        const double y = b0 * x + z1[c];
        z1[c] = b1 * x - a1 * y + z2[c];
        z2[c] = b2 * x - a2 * y;
        return y;
    }
};

// SVF TPT paso bajo estereo (cutoff independiente por canal)
struct SvfLp {
    double ic1[2]{}, ic2[2]{}, a1[2]{1, 1}, a2[2]{}, a3[2]{};
    void reset() { ic1[0] = ic1[1] = ic2[0] = ic2[1] = 0.0; }
    void set(int c, double fc, double sr, double k) {
        const double g = std::tan(kPi * clampT(fc, 20.0, 0.45 * sr) / sr);
        a1[c] = 1.0 / (1.0 + g * (g + k)); a2[c] = g * a1[c]; a3[c] = g * a2[c];
    }
    inline double process(int c, double x) {
        const double v3 = x - ic2[c];
        const double v1 = a1[c] * ic1[c] + a2[c] * v3;
        const double v2 = ic2[c] + a2[c] * ic1[c] + a3[c] * v3;
        ic1[c] = 2.0 * v1 - ic1[c];
        ic2[c] = 2.0 * v2 - ic2[c];
        return v2;
    }
};

// -------------------------------------------------------------------------------------
//  Pitch shifter granular (4 granos Hann solapados al 75 %) para el shimmer
// -------------------------------------------------------------------------------------
class GrainShifter {
public:
    void prepare(double sr, double windowSec, uint32_t seed) {
        sr_ = sr;
        W_ = std::max(64.0, windowSec * sr);
        buf_.alloc(static_cast<size_t>(W_) + 8);
        Xor r; r.seed(seed);
        phi0_ = r.uni();
        hpA_ = 1.0 - std::exp(-kTwoPi * 110.0 / sr);
        lpA_ = 1.0 - std::exp(-kTwoPi * std::min(7000.0, 0.4 * sr) / sr);
        pw_ = 1.0 - std::exp(-1.0 / (0.030 * sr));
        setRatio(2.0);
        reset();
    }
    void reset() { buf_.clear(); hp_ = lp_ = 0.0; pin_ = pout_ = 0.0; gain_ = 1.0; cnt_ = 0; phi_ = phi0_; resync(); }
    void setRatio(double r) {
        dphi_ = (1.0 - r) / W_;
        rc_ = std::cos(kTwoPi * dphi_);
        rs_ = std::sin(kTwoPi * dphi_);
    }
    double process(double x) {
        hp_ += hpA_ * (x - hp_);
        const double xh = x - hp_;
        lp_ += lpA_ * (xh - lp_);
        const double in = lp_;
        buf_.push(in);
        const double w0 = 0.5 - 0.5 * c_, w1 = 0.5 + 0.5 * s_, w2 = 0.5 + 0.5 * c_, w3 = 0.5 - 0.5 * s_;
        double p1 = phi_ + 0.25, p2 = phi_ + 0.5, p3 = phi_ + 0.75;
        p1 -= std::floor(p1); p2 -= std::floor(p2); p3 -= std::floor(p3);
        const double acc = w0 * buf_.read(1.0 + phi_ * W_) + w1 * buf_.read(1.0 + p1 * W_) +
                           w2 * buf_.read(1.0 + p2 * W_) + w3 * buf_.read(1.0 + p3 * W_);
        phi_ += dphi_;
        phi_ -= std::floor(phi_);
        const double nc = c_ * rc_ - s_ * rs_;
        s_ = s_ * rc_ + c_ * rs_;
        c_ = nc;
        if (++cnt_ >= 512) { cnt_ = 0; resync(); }
        const double out = acc * 0.5 * 1.55;
        pin_ += pw_ * (in * in - pin_);
        pout_ += pw_ * (out * out - pout_);
        if ((cnt_ & 7) == 0) {   // CAG: potencia de salida <= potencia de entrada
            const double target = pout_ > pin_ ? std::sqrt((pin_ + 1e-18) / (pout_ + 1e-18)) : 1.0;
            gain_ += 0.016 * (target - gain_);
        }
        return fastTanh(out * std::min(gain_, 1.0));
    }
private:
    void resync() { c_ = std::cos(kTwoPi * phi_); s_ = std::sin(kTwoPi * phi_); }
    double sr_{48000.0}, W_{4000.0}, dphi_{-1.0 / 4000.0}, phi0_{0.0}, phi_{0.0}, c_{1.0}, s_{0.0}, rc_{1.0}, rs_{0.0};
    DelayBuf buf_;
    double hp_{0}, lp_{0}, hpA_{0.01}, lpA_{0.5}, pin_{0}, pout_{0}, pw_{0.001}, gain_{1.0};
    int cnt_{0};
};

// -------------------------------------------------------------------------------------
//  Reverb FDN de 8 lineas (plate/hall) con cola modulada, damping calido y shimmer en el lazo
// -------------------------------------------------------------------------------------
class AtmosVerb {
public:
    void prepare(double sr) {
        sr_ = sr;
        static const int base[kFdn] = { 1117, 1301, 1559, 1823, 2111, 2393, 2699, 3067 };
        for (int i = 0; i < kFdn; ++i) {
            baseD_[i] = base[i] * sr / 48000.0;
            line_[i].alloc(static_cast<size_t>(baseD_[i] * 1.35 + 0.0016 * sr + 16));
            const double rate = 0.07 + 0.043 * i;
            modRc_[i] = std::cos(kTwoPi * rate / sr);
            modRs_[i] = std::sin(kTwoPi * rate / sr);
            modC_[i] = std::cos(0.7 * i);
            modS_[i] = std::sin(0.7 * i);
        }
        static const int apL[4] = { 142, 107, 379, 277 }, apR[4] = { 157, 113, 403, 293 };
        for (int i = 0; i < 4; ++i) {
            apBufL_[i].assign(static_cast<size_t>(std::max(8.0, std::round(apL[i] * sr / 48000.0))), 0.0);
            apBufR_[i].assign(static_cast<size_t>(std::max(8.0, std::round(apR[i] * sr / 48000.0))), 0.0);
            apIdxL_[i] = apIdxR_[i] = 0;
        }
        for (int k = 0; k < kPs; ++k) ps_[k].prepare(sr, 0.085 * (1.0 + 0.11 * k), 0x1234567u + 7919u * static_cast<uint32_t>(k));
        pLp_ = std::exp(-kTwoPi * 3000.0 / sr);
        reset();
        setParams(1.0, 6.0, 0.6, 0.4, 0.0, 0);
    }
    void reset() {
        for (auto& l : line_) l.clear();
        for (auto& l : lp_) l = 0.0;
        for (auto& b : apBufL_) std::fill(b.begin(), b.end(), 0.0);
        for (auto& b : apBufR_) std::fill(b.begin(), b.end(), 0.0);
        for (auto& p : ps_) p.reset();
    }
    // scale: 0.72 plate .. 1.0 hall (tamano de las lineas); rt: RT60 (s); damping 0..1; mod 0..1; shimmer 0..1; interval 0:+12 1:+7 2:-12
    void setParams(double scale, double rt, double damping, double mod, double shimmer, int interval) {
        rt = clampT(rt, 0.3, 32.0);
        damping = clampT(damping, 0.0, 1.0);
        shimAmt_ = clampT(shimmer, 0.0, 1.0);
        modDepth_ = (0.00015 + 0.0011 * clampT(mod, 0.0, 1.0)) * sr_;
        sumD_ = 0.0;
        for (int i = 0; i < kFdn; ++i) { d_[i] = baseD_[i] * scale; sumD_ += d_[i]; }
        const double rtEff = rt * (1.17 + 0.2 / (1.0 + 2.0 * rt)) * (1.0 + 0.2 * shimAmt_);
        const double hfOld = rtEff > 3.0 ? 0.35 : (0.35 + 0.15 * (3.0 - rtEff) / 3.0);
        const double hfRatio = clampT(hfOld * std::pow(2.2, (0.7375 - damping) * 2.0), 0.08, 0.95);
        for (int i = 0; i < kFdn; ++i) {
            const double glf = std::min(0.99995, std::pow(10.0, -3.0 * d_[i] / (rtEff * sr_)));
            const double ghf = std::min(glf, std::pow(10.0, -3.0 * d_[i] / (rtEff * hfRatio * sr_)));
            ghf_[i] = ghf;
            dg_[i] = glf - ghf;
        }
        wetNorm_ = clampT(0.9 * std::sqrt(13.8 * sumD_ / (rtEff * sr_)), 0.35, 2.5);
        const double th = shimAmt_ * kTwoPi / 10.0;
        sn_ = std::sin(th);
        cs_ = std::cos(th);
        if (interval != lastInterval_) {
            static const double ratio[3] = { 2.0, 1.4983070768766815, 0.5 };
            for (auto& p : ps_) p.setRatio(ratio[clampT(interval, 0, 2)]);
            lastInterval_ = interval;
        }
    }
    inline void process(double inL, double inR, double& outL, double& outR) {
        if (++modCnt_ >= 1024) {
            modCnt_ = 0;
            for (int i = 0; i < kFdn; ++i) { const double m = 1.0 / std::sqrt(modC_[i] * modC_[i] + modS_[i] * modS_[i]); modC_[i] *= m; modS_[i] *= m; }
        }
        double xl = inL, xr = inR;
        for (int i = 0; i < 4; ++i) { xl = allpass(apBufL_[i], apIdxL_[i], xl); xr = allpass(apBufR_[i], apIdxR_[i], xr); }
        double z[kFdn];
        for (int i = 0; i < kFdn; ++i) {
            const double D = d_[i] + modDepth_ * modS_[i];
            const double nc = modC_[i] * modRc_[i] - modS_[i] * modRs_[i];
            modS_[i] = modS_[i] * modRc_[i] + modC_[i] * modRs_[i];
            modC_[i] = nc;
            const double y = line_[i].read(std::max(2.0, D));
            lp_[i] = (1.0 - pLp_) * y + pLp_ * lp_[i];
            z[i] = ghf_[i] * y + dg_[i] * lp_[i];
        }
        double oL = 0.0, oR = 0.0;
        for (int i = 0; i < kFdn; ++i) { oL += kRowL[i] * z[i]; oR += kRowR[i] * z[i]; }
        outL = oL * kInvSqrt8 * wetNorm_;
        outR = oR * kInvSqrt8 * wetNorm_;
        double w[kFdn];
        for (int i = 0; i < kFdn; ++i) w[i] = z[i];
        for (int h = 1; h < kFdn; h <<= 1)
            for (int i = 0; i < kFdn; i += 2 * h)
                for (int j = i; j < i + h; ++j) { const double a = w[j], b = w[j + h]; w[j] = a + b; w[j + h] = a - b; }
        for (int i = 0; i < kFdn; ++i) w[i] *= kInvSqrt8;
        if (shimAmt_ > 1.0e-4) {
            for (int k = 0; k < kPs; ++k) {
                const double s = w[k];
                const double r = ps_[k].process(s);
                w[k] = cs_ * s;
                w[k + 4] += sn_ * r;
            }
        }
        for (int i = 0; i < kFdn; ++i) w[i] += (kInL[i] * xl + kInR[i] * xr) * kInvSqrt8;
        for (int i = 0; i < kFdn; ++i) line_[i].push(w[i]);
    }
    double shimmerEnergy() const { return shimAmt_; }

private:
    static inline double allpass(std::vector<double>& b, int& idx, double x) {
        const double g = 0.55;
        const double d = b[static_cast<size_t>(idx)];
        const double v = x - g * d;
        b[static_cast<size_t>(idx)] = v;
        if (++idx >= static_cast<int>(b.size())) idx = 0;
        return d + g * v;
    }
    static constexpr double kInvSqrt8 = 0.35355339059327373;
    static constexpr double kRowL[kFdn] = { 1, 1, -1, -1, -1, -1, 1, 1 };
    static constexpr double kRowR[kFdn] = { 1, -1, 1, -1, -1, 1, -1, 1 };
    static constexpr double kInL[kFdn] = { 1, 1, -1, -1, 1, 1, -1, -1 };
    static constexpr double kInR[kFdn] = { 1, -1, -1, 1, 1, -1, -1, 1 };

    int modCnt_{0}, lastInterval_{-1};
    double shimAmt_{0}, sr_{48000.0}, sumD_{0}, modDepth_{10}, wetNorm_{1}, pLp_{0.5}, sn_{0}, cs_{1};
    double baseD_[kFdn]{}, d_[kFdn]{}, ghf_[kFdn]{}, dg_[kFdn]{}, lp_[kFdn]{}, modC_[kFdn]{}, modS_[kFdn]{}, modRc_[kFdn]{}, modRs_[kFdn]{};
    DelayBuf line_[kFdn];
    std::vector<double> apBufL_[4], apBufR_[4];
    int apIdxL_[4]{}, apIdxR_[4]{};
    GrainShifter ps_[kPs];
};

// -------------------------------------------------------------------------------------
//  Ensemble chorus (3 taps por canal, LFOs lentos desfasados)
// -------------------------------------------------------------------------------------
class Ensemble {
public:
    void prepare(double sr) {
        sr_ = sr;
        bl_.alloc(static_cast<size_t>(0.06 * sr));
        br_.alloc(static_cast<size_t>(0.06 * sr));
        static const double rate[3] = { 0.17, 0.23, 0.31 };
        for (int k = 0; k < 3; ++k) {
            inc_[k] = kTwoPi * rate[k] / sr;
            phL_[k] = kTwoPi * k / 3.0;
            phR_[k] = kTwoPi * (k / 3.0 + 1.0 / 6.0);
        }
    }
    void reset() { bl_.clear(); br_.clear(); }
    inline void process(double inL, double inR, double mix, double& oL, double& oR) {
        bl_.push(inL);
        br_.push(inR);
        double wl = 0.0, wr = 0.0;
        for (int k = 0; k < 3; ++k) {
            const double dl = (0.0135 + 0.0013 * k + 0.0035 * std::sin(phL_[k])) * sr_;
            const double dr = (0.0135 + 0.0013 * k + 0.0035 * std::sin(phR_[k])) * sr_;
            wl += bl_.read(dl);
            wr += br_.read(dr);
            phL_[k] += inc_[k]; if (phL_[k] > kTwoPi) phL_[k] -= kTwoPi;
            phR_[k] += inc_[k] * 1.07; if (phR_[k] > kTwoPi) phR_[k] -= kTwoPi;
        }
        wl *= (1.0 / 3.0);
        wr *= (1.0 / 3.0);
        oL = inL * (1.0 - 0.5 * mix) + wl * 0.8 * mix;
        oR = inR * (1.0 - 0.5 * mix) + wr * 0.8 * mix;
    }
private:
    double sr_{48000.0}, inc_[3]{}, phL_[3]{}, phR_[3]{};
    DelayBuf bl_, br_;
};

// -------------------------------------------------------------------------------------
//  Tape delay ping-pong: la entrada (suma mono) entra por L; L -> R -> L con filtro paso-bajo (tono), paso-alto y
//  saturacion en cada salto. Tiempo con inercia de cinta (250 ms), wow (0.55 Hz) y flutter (6.3 Hz).
//  Estabilidad: ganancia por salto = fb (<= 0.92) * filtros pasivos * saturador de pendiente <= 1.
// -------------------------------------------------------------------------------------
class TapeDelay {
public:
    void prepare(double sr) {
        sr_ = sr;
        bl_.alloc(static_cast<size_t>(1.55 * sr) + 64);
        br_.alloc(static_cast<size_t>(1.55 * sr) + 64);
        hpA_ = 1.0 - std::exp(-kTwoPi * 130.0 / sr);
        tK_ = 1.0 - std::exp(-1.0 / (0.25 * sr));
        wowInc_ = kTwoPi * 0.55 / sr; flInc_ = kTwoPi * 6.3 / sr;
        setTone(3600.0);
        reset();
    }
    void reset() { bl_.clear(); br_.clear(); lpL_ = lpR_ = hpL_ = hpR_ = 0.0; wow_ = 0.0; fl_ = 1.3; tCur_ = -1.0; }
    void setTone(double hz) { lpA_ = 1.0 - std::exp(-kTwoPi * clampT(hz, 500.0, 0.4 * sr_) / sr_); }
    double currentMs() const { return tCur_ > 0 ? tCur_ * 1000.0 / sr_ : 0.0; }
    inline void process(double inL, double inR, double timeMs, double fb, double age, double& oL, double& oR) {
        const double tTarget = clampT(timeMs, 20.0, 1400.0) * 0.001 * sr_;
        if (tCur_ < 0.0) tCur_ = tTarget;
        tCur_ += tK_ * (tTarget - tCur_);
        wow_ += wowInc_; if (wow_ > kTwoPi) wow_ -= kTwoPi;
        fl_ += flInc_; if (fl_ > kTwoPi) fl_ -= kTwoPi;
        const double mod = (0.0008 * std::sin(wow_) + 0.00018 * std::sin(fl_)) * sr_ * age;
        const double d = clampT(tCur_ + mod, 8.0, 1.5 * sr_);
        oL = bl_.read(d);
        oR = br_.read(d);
        auto hop = [&](double x, double& lp, double& hp) {
            lp += lpA_ * (x - lp);
            hp += hpA_ * (lp - hp);
            const double y = lp - hp;
            return y / (1.0 + std::fabs(y) * 0.5);   // saturacion suave acotada (pendiente <= 1)
        };
        const double fL = hop(oL, lpL_, hpL_), fR = hop(oR, lpR_, hpR_);
        const double mid = 0.5 * (inL + inR);
        bl_.push(mid + fb * fR);
        br_.push(fL);
    }
private:
    double sr_{48000.0}, lpA_{0.3}, hpA_{0.01}, tK_{0.0001}, wowInc_{0}, flInc_{0}, wow_{0}, fl_{0}, tCur_{-1.0};
    double lpL_{0}, lpR_{0}, hpL_{0}, hpR_{0};
    DelayBuf bl_, br_;
};

// Compresor suave de bus (feed-forward, rodilla suave 8 dB, ataque 30 ms, release 450 ms)
class SoftComp {
public:
    void prepare(double sr) {
        aA_ = 1.0 - std::exp(-1.0 / (0.030 * sr));
        aR_ = 1.0 - std::exp(-1.0 / (0.450 * sr));
        reset();
    }
    void reset() { env_ = 0.0; grDb_ = 0.0; }
    inline void process(double& l, double& r, double amount) {
        if (amount < 1.0e-4) { env_ = 0.0; grDb_ = 0.0; return; }
        const double a = std::max(std::fabs(l), std::fabs(r));
        env_ += (a > env_ ? aA_ : aR_) * (a - env_);
        const double lev = 20.0 * std::log10(env_ + 1.0e-9);
        const double ratio = 1.0 + 2.0 * amount, over = lev + 22.0, knee = 8.0;
        double red;
        if (over <= -0.5 * knee) red = 0.0;
        else if (over >= 0.5 * knee) red = over * (1.0 - 1.0 / ratio);
        else { const double x = over + 0.5 * knee; red = (1.0 - 1.0 / ratio) * x * x / (2.0 * knee); }
        const double g = std::pow(10.0, (2.5 * amount - red) * 0.05);
        l *= g; r *= g;
        grDb_ = red;
    }
    double grDb() const { return grDb_; }
private:
    double aA_{0.001}, aR_{0.0001}, env_{0}, grDb_{0};
};

// -------------------------------------------------------------------------------------
//  Motor
// -------------------------------------------------------------------------------------
class AtmosEngine {
public:
    AtmosEngine() = default;
    ~AtmosEngine() { stopLoader(); }
    AtmosEngine(const AtmosEngine&) = delete;
    AtmosEngine& operator=(const AtmosEngine&) = delete;

    /// autoLoad=false: pruebas que cargan el banco a mano (loadBankSync) o sin banco
    void prepare(double sr, int /*maxBlock*/, bool autoLoad = true) {
        sr_ = sr > 0 ? sr : 48000.0;
        autoLoad_ = autoLoad;
        for (auto& s : sampler_) {
            s.prepare(sr_);
            JwSampler::Humanize h;
            h.gainDb = 0.8f; h.detuneCents = 3.0f; h.timingMs = 25.0f; h.velCurve = 0.55f;
            s.setHumanize(h);
            s.setDrift(4.0f, 0.05f);
        }
        startLoader();
        buildTables();
        verb_.prepare(sr_);
        chorus_.prepare(sr_);
        delay_.prepare(sr_);
        comp_.prepare(sr_);
        fx_.prepare(sr_);
        preL_.alloc(static_cast<size_t>(0.16 * sr_));
        preR_.alloc(static_cast<size_t>(0.16 * sr_));
        sendHp_.design(sr_, 170.0);
        lowCutDirty_ = true;
        for (int i = 0; i < kParamCount; ++i) sm_[static_cast<size_t>(i)].prepare(sr_, smoothMs(i));
        sL_.assign(kChunk, 0.0f);
        sR_.assign(kChunk, 0.0f);
        mL_.assign(kChunk, 0.0);
        mR_.assign(kChunk, 0.0);
        hpDcA_ = 1.0 - std::exp(-kTwoPi * 6.0 / sr_);
        dcDriveA_ = 1.0 - std::exp(-kTwoPi * 18.0 / sr_);
        lfoInc_ = kTwoPi / sr_;
        applyTargets(true);
        reset();
    }
    void settle() { applyTargets(true); }
    void reset() {
        for (auto& s : sampler_) { s.panic(); s.setSustain(false); }
        for (auto& v : mv_) v.active = false;
        sendHp_.reset(); lowHp_.reset(); lp_.reset(); verb_.reset(); chorus_.reset(); delay_.reset(); comp_.reset();
        fx_.reset();
        preL_.clear(); preR_.clear();
        for (auto& b : eqSt_) for (auto& s : b) s.reset();
        dcIn_[0] = dcIn_[1] = dcOut_[0] = dcOut_[1] = 0.0;
        dcDr_[0] = dcDr_[1] = 0.0;
        lfoPh_ = 0.0; heldKeys_[0] = heldKeys_[1] = 0; pedal_ = false; sustainHeld_.fill(false);
        eqDirty_ = true;
    }
    void setSettings(const AtmosSettings& s) {
        s_ = s;
        applyTargets(false);
        pushSamplerParams();
        const int bi = bankIndex(presets()[static_cast<size_t>(clampT(s_.preset, 0, kNumPresets - 1))].family);
        ensureBank(bi);
        if (autoLoad_ && bi != currentBank_.load(std::memory_order_relaxed)) {   // cambio de familia: los otros bancos se descargan cuando callan
            currentBank_.store(bi);
            unloadMask_.fetch_or(((1u << kNumBanks) - 1u) & ~(1u << bi));
        }
        setPedal(s_.p[kSustain] >= 0.5);
    }
    void setTempo(double bpm) { bpm_ = (bpm >= 20.0 && bpm <= 400.0) ? bpm : 120.0; fx_.setTempo(bpm); }
    // FX Rack comun (jw_fxrack.h): va DESPUES de toda la cadena interna (eco, reverb, EQ, compresor, anchura)
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    JasWaveFx::FxRack& fx() { return fx_; }

    // ---- bancos ----
    int bankState(int bank) const { return state_[bank].load(std::memory_order_relaxed); }
    int activeBankState() const { return bankState(bankIndex(presets()[static_cast<size_t>(clampT(s_.preset, 0, kNumPresets - 1))].family)); }
    /// Carga sincrona (pruebas): devuelve true si el banco quedo listo
    bool loadBankSync(int bank, const std::string& path = std::string()) {
        std::string err;
        std::string p = path;
        if (p.empty()) {
            const std::string dir = JwSampler::samplesDir();
            const char* slug = bank == 0 ? "ambient-atmos-guitar" : (bank == 1 ? "ambient-atmos-pads" : "ambient-atmos-textures");
#ifdef _WIN32
            p = dir + "\\" + slug + ".jws";
#else
            p = dir + "/" + slug + ".jws";
#endif
        }
        auto b = JwSampler::acquireBank(p, err);
        if (!b) { state_[bank].store(3); lastError_ = err; return false; }
        sampler_[bank].setBank(b);
        state_[bank].store(2);
        return true;
    }
    const std::string& lastError() const { return lastError_; }
    int sampleVoices() const { int n = 0; for (const auto& s : sampler_) n += s.activeVoices(); return n; }

    // ---- notas ----
    void noteOn(int note, float vel) {
        if (note < 0 || note > 127) return;
        if (vel <= 0.0f) { noteOff(note); return; }
        const Preset& pr = presets()[static_cast<size_t>(clampT(s_.preset, 0, kNumPresets - 1))];
        const int bi = bankIndex(pr.family);
        heldKeys_[note >> 6] |= 1ull << (note & 63);
        if (state_[bi].load(std::memory_order_relaxed) == 2 && sampler_[bi].hasGroup(note, pr.layerA)) {
            const int nV = static_cast<int>(clampT(std::lround(s_.p[kUnisonVoices]), 0L, 2L)) + 1;
            const double spread = s_.p[kUnisonDetune] / 100.0 * 16.0;                  // cents
            static const double off3[3] = { 0.0, -1.0, 1.0 }, off2[2] = { -0.5, 0.5 };
            const float gv = 1.0f / std::sqrt(static_cast<float>(nV));
            float gA = 1.0f, gB = 0.0f;
            const bool hasB = pr.layerB >= 0 && sampler_[bi].hasGroup(note, pr.layerB) && s_.p[kLayerBlend] > 0.5;
            if (hasB) { const double b = clampT(s_.p[kLayerBlend] / 100.0, 0.0, 1.0); gA = static_cast<float>(std::cos(b * kPi * 0.5)); gB = static_cast<float>(std::sin(b * kPi * 0.5)); }
            for (int k = 0; k < nV; ++k) {
                const double o = nV == 1 ? 0.0 : (nV == 2 ? off2[k] * 2.0 : off3[k]) * spread;
                sampler_[bi].noteOnGroup(note, vel, pr.layerA, gA * gv, static_cast<float>(o));
                if (hasB) sampler_[bi].noteOnGroup(note, vel, pr.layerB, gB * gv, static_cast<float>(-o));
            }
            return;
        }
        startModelVoice(note, vel, pr.family);   // respaldo: sin banco (aun cargando o ausente)
    }
    void noteOff(int note) {
        if (note < 0 || note > 127) return;
        heldKeys_[note >> 6] &= ~(1ull << (note & 63));
        for (auto& s : sampler_) s.noteOff(note);
        for (auto& v : mv_) if (v.active && v.note == note && v.keyDown) { v.keyDown = false; if (!pedal_) v.releasing = true; else sustainHeld_[static_cast<size_t>(&v - mv_.data())] = true; }
    }
    void setPedal(bool down) {
        if (down == pedal_) return;
        pedal_ = down;
        for (auto& s : sampler_) s.setSustain(down);
        if (!down) for (size_t i = 0; i < mv_.size(); ++i) if (mv_[i].active && !mv_[i].keyDown) { mv_[i].releasing = true; sustainHeld_[i] = false; }
    }
    void setBend(double st) { st = clampT(st, -12.0, 12.0); s_.p[kBend] = st; for (auto& sp : sampler_) sp.setBend(static_cast<float>(st)); }
    void setModWheel(double x) { s_.p[kModWheel] = clampT(x, 0.0, 1.0) * 100.0; sm_[kModWheel].setTarget(clampT(x, 0.0, 1.0)); }
    void setAftertouch(double x) { s_.p[kAftertouch] = clampT(x, 0.0, 1.0) * 100.0; sm_[kAftertouch].setTarget(clampT(x, 0.0, 1.0)); }
    void allNotesOff() { heldKeys_[0] = heldKeys_[1] = 0; for (auto& s : sampler_) s.allNotesOff(); for (auto& v : mv_) if (v.active) { v.keyDown = false; v.releasing = true; } }
    void allSoundOff() { heldKeys_[0] = heldKeys_[1] = 0; for (auto& s : sampler_) s.panic(); for (auto& v : mv_) v.active = false; }

    template <class T>
    void render(T* outL, T* outR, int n, AtmosBus* bus) {
        float pk[2] = { 0, 0 };
        int pos = 0;
        while (pos < n) {
            const int m = std::min(kChunk, n - pos);
            renderChunk(outL + pos, outR + pos, m, pk);
            pos += m;
        }
        if (fx_.activo()) {
            fx_.process(outL, outR, n, bus);   // los picos se miden DESPUES del rack
            pk[0] = pk[1] = 0.0f;
            for (int i = 0; i < n; ++i) { pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i])))); pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i])))); }
        } else fx_.process(outL, outR, n, bus);
        if (bus) {
            bus->salida(outL, outR, n);
            bus->outPk[0].update(pk[0]);
            bus->outPk[1].update(pk[1]);
            uint64_t k0 = heldKeys_[0], k1 = heldKeys_[1];
            bus->keys[0].store(k0, std::memory_order_relaxed);
            bus->keys[1].store(k1, std::memory_order_relaxed);
            bus->activeVoices.store(sampleVoices() + modelVoices(), std::memory_order_relaxed);
            bus->bankState.store(activeBankState(), std::memory_order_relaxed);
            bus->delayMs.store(static_cast<float>(delay_.currentMs()), std::memory_order_relaxed);
            bus->cutoffHz.store(static_cast<float>(cutNow_), std::memory_order_relaxed);
        }
    }
    int modelVoices() const { int a = 0; for (const auto& v : mv_) a += v.active ? 1 : 0; return a; }
    double sampleRate() const { return sr_; }
    double compGrDb() const { return comp_.grDb(); }

private:
    // ---------------- motor modelado de respaldo ----------------
    struct MVoice {
        bool active{false}, keyDown{false}, releasing{false};
        int note{0}, nPart{6};
        float vel{0.7f};
        double env{0.0}, atkK{0.001}, relK{0.0001}, f0{220.0};
        double ph[2][10]{};
        double amp[10]{};
        double noise{0.0}, nLp{0.0}, drift[2]{}, driftT[2]{};
        int cnt{0};
        Xor rng;
        double gL{0.7}, gR{0.7};
        uint64_t age{0};
    };

    void buildTables() {
        sine_.assign(2049, 0.0f);
        for (int i = 0; i < 2048; ++i) sine_[static_cast<size_t>(i)] = static_cast<float>(std::sin(kTwoPi * i / 2048.0));
        sine_[2048] = sine_[0];
    }
    inline double sineAt(double ph) const {   // ph en ciclos 0..1
        const double x = ph * 2048.0;
        const int i = static_cast<int>(x);
        const double fr = x - i;
        return sine_[static_cast<size_t>(i)] + (sine_[static_cast<size_t>(i) + 1] - sine_[static_cast<size_t>(i)]) * fr;
    }

    void startModelVoice(int note, float vel, int family) {
        MVoice* v = nullptr;
        for (auto& x : mv_) if (!x.active) { v = &x; break; }
        if (!v) { for (auto& x : mv_) if (!v || x.age < v->age) v = &x; }
        *v = MVoice{};
        v->active = true; v->keyDown = true; v->note = note; v->vel = vel; v->age = ++clock_;
        v->rng.seed(0xA5A5u + static_cast<uint32_t>(note) * 7919u + static_cast<uint32_t>(clock_) * 2654435761u);
        v->f0 = 440.0 * std::pow(2.0, (note - 69) / 12.0);
        const double expo = family == kFamGuitar ? 1.15 : (family == kFamPads ? 1.6 : 2.0);
        double e2 = 0.0;
        v->nPart = 8;
        for (int k = 0; k < v->nPart; ++k) { v->amp[k] = std::pow(static_cast<double>(k + 1), -expo); e2 += v->amp[k] * v->amp[k] * 0.5; }
        const double norm = 0.30 / std::sqrt(e2 * 2.0);
        for (int k = 0; k < v->nPart; ++k) v->amp[k] *= norm;
        for (int c = 0; c < 2; ++c) for (int k = 0; k < 10; ++k) v->ph[c][k] = v->rng.uni();
        v->gL = 0.75 + 0.2 * v->rng.bi(); v->gR = 1.5 - v->gL;
        v->noise = (family >= kFamTextures) ? 0.35 : 0.0;
        updateModelEnv(*v);
    }
    void updateModelEnv(MVoice& v) const {
        const double a = std::max(0.002, s_.p[kAttack]), r = std::max(0.2, s_.p[kRelease]);
        v.atkK = 1.0 - std::exp(-3.5 / (a * sr_));
        v.relK = 1.0 - std::exp(-6.9078 / (r * sr_));
    }

    void renderModelVoices(int n) {
        for (auto& v : mv_) {
            if (!v.active) continue;
            const double cents = 5.0 * (s_.p[kUnisonDetune] / 100.0);
            const double detune[2] = { std::pow(2.0, -cents / 1200.0), std::pow(2.0, cents / 1200.0) };
            const double tune = std::pow(2.0, (s_.p[kTune] / 100.0 + s_.p[kBend] * 1.0 + 0.0) / 12.0);
            double inc[2];
            for (int c = 0; c < 2; ++c) inc[c] = v.f0 * tune * detune[c] / sr_;
            const double kScale = 0.5 * (0.55 + 0.45 * v.vel);
            for (int i = 0; i < n; ++i) {
                if (v.releasing) { v.env -= v.env * v.relK; if (v.env < 1e-5) { v.active = false; break; } }
                else v.env += (1.0 - v.env) * v.atkK;
                double yl = 0.0, yr = 0.0;
                for (int k = 0; k < v.nPart; ++k) {
                    if ((k + 1) * v.f0 * tune > 0.45 * sr_) break;
                    v.ph[0][k] += inc[0] * (k + 1); v.ph[0][k] -= std::floor(v.ph[0][k]);
                    v.ph[1][k] += inc[1] * (k + 1); v.ph[1][k] -= std::floor(v.ph[1][k]);
                    yl += v.amp[k] * sineAt(v.ph[0][k]);
                    yr += v.amp[k] * sineAt(v.ph[1][k]);
                }
                if (v.noise > 0.0) {   // textura: ruido filtrado (aire) bajo los parciales
                    v.nLp += 0.12 * (v.rng.bi() - v.nLp);
                    yl += v.noise * 0.06 * v.nLp; yr += v.noise * 0.06 * v.nLp * 0.9;
                }
                mL_[static_cast<size_t>(i)] += yl * v.env * v.gL * kScale;
                mR_[static_cast<size_t>(i)] += yr * v.env * v.gR * kScale;
            }
        }
    }

    // ---------------- carga de bancos bajo demanda ----------------
    void ensureBank(int bank) {
        if (!autoLoad_) return;
        int expected = 0;
        if (state_[bank].compare_exchange_strong(expected, 1)) pending_.fetch_or(1u << bank);
    }
    void startLoader() {
        if (loaderRunning_) return;
        quit_.store(false);
        loaderRunning_ = true;
        loader_ = std::thread([this] {
            while (!quit_.load()) {
                // descarga diferida (en este hilo, nunca en el de audio): solo bancos que no son el activo y sin voces vivas
                if (const unsigned u = unloadMask_.load()) {
                    for (int b = 0; b < kNumBanks; ++b) {
                        if (!(u & (1u << b))) continue;
                        if (b == currentBank_.load()) { unloadMask_.fetch_and(~(1u << b)); continue; }
                        if (sampler_[b].activeVoices() == 0 && state_[b].load() == 2) { sampler_[b].setBank(nullptr); state_[b].store(0); unloadMask_.fetch_and(~(1u << b)); }
                        else if (state_[b].load() != 2) unloadMask_.fetch_and(~(1u << b));
                    }
                }
                const unsigned m = pending_.exchange(0u);
                if (m == 0) { std::this_thread::sleep_for(std::chrono::milliseconds(15)); continue; }
                for (int b = 0; b < kNumBanks; ++b) if (m & (1u << b)) loadBankSync(b);
            }
        });
    }
    void stopLoader() {
        if (!loaderRunning_) return;
        quit_.store(true);
        if (loader_.joinable()) loader_.join();
        loaderRunning_ = false;
    }

    void pushSamplerParams() {
        for (auto& s : sampler_) {
            s.setAttack(static_cast<float>(std::max(0.002, s_.p[kAttack])));
            s.setReleaseScale(static_cast<float>(std::max(0.2, s_.p[kRelease]) / 2.0));
            s.setTuneCents(static_cast<float>(s_.p[kTune]));
            s.setBend(static_cast<float>(s_.p[kBend]));
            s.setLevelDb(kSamplerLevelDb);
        }
    }

    static double smoothMs(int id) {
        switch (id) {
            case kCutoff: case kLowCut: case kEqLow: case kEqLowMid: case kEqHighMid: case kEqHigh: return 90.0;
            case kReverbDecay: case kReverbDamp: case kReverbType: return 200.0;
            case kDelayTone: return 120.0;
            case kVolume: return 30.0;
            case kModWheel: case kAftertouch: return 30.0;
            case kFxMacro: case kDelayMix: case kReverbMix: case kShimmer: case kChorus: case kDrive: return 120.0;
            default: return 80.0;
        }
    }

    void applyTargets(bool jump) {
        for (int i = 0; i < kParamCount; ++i) {
            double t = s_.p[i];
            switch (i) {
                case kCutoff: t = std::log2(clampT(t, 200.0, 20000.0)); break;
                case kLowCut: t = std::log2(clampT(t, 20.0, 400.0)); break;
                case kReverbDecay: t = std::log(clampT(t, 0.5, 30.0)); break;
                case kDelayTone: t = std::log2(clampT(t, 800.0, 9000.0)); break;
                case kLfoRate: t = std::log2(clampT(t, 0.02, 8.0)); break;
                case kBypass: t = s_.bypass() ? 0.0 : 1.0; break;
                case kModWheel: case kAftertouch: t = clampT(t / 100.0, 0.0, 1.0); break;
                default: break;
            }
            sm_[static_cast<size_t>(i)].setTarget(t);
            if (jump) sm_[static_cast<size_t>(i)].reset(t);
        }
        if (jump) { eqDirty_ = true; lowCutDirty_ = true; }
        for (auto& v : mv_) if (v.active) updateModelEnv(v);
    }
    inline double cur(int id) const { return sm_[static_cast<size_t>(id)].current(); }

    // ---------------- bloque ----------------
    template <class T>
    void renderChunk(T* oL, T* oR, int m, float* pk) {
        std::fill(sL_.begin(), sL_.begin() + m, 0.0f);
        std::fill(sR_.begin(), sR_.begin() + m, 0.0f);
        std::fill(mL_.begin(), mL_.begin() + m, 0.0);
        std::fill(mR_.begin(), mR_.begin() + m, 0.0);
        for (auto& s : sampler_) if (s.activeVoices() > 0) s.render(sL_.data(), sR_.data(), m);
        renderModelVoices(m);
        int pos = 0;
        while (pos < m) {
            const int k = std::min(kTick, m - pos);
            controlTick(k);
            for (int i = 0; i < k; ++i) {
                double l = sL_[static_cast<size_t>(pos + i)] + mL_[static_cast<size_t>(pos + i)];
                double r = sR_[static_cast<size_t>(pos + i)] + mR_[static_cast<size_t>(pos + i)];
                processFrame(l, r);
                oL[pos + i] = static_cast<T>(l);
                oR[pos + i] = static_cast<T>(r);
                pk[0] = std::max(pk[0], static_cast<float>(std::fabs(l)));
                pk[1] = std::max(pk[1], static_cast<float>(std::fabs(r)));
            }
            pos += k;
        }
    }

    void controlTick(int n) {
        for (int i = 0; i < kParamCount; ++i) sm_[static_cast<size_t>(i)].advance(n);
        const double mw = cur(kModWheel), at = cur(kAftertouch);
        // macro E/FX: 0..2 (50 % = el preset); la rueda y el aftertouch suman profundidad
        double d = clampT(cur(kFxMacro) / 100.0 * 2.0 + 0.5 * mw + 0.3 * at, 0.0, 2.3);
        fxD_ = d;
        // filtro con LFO lento (cuadratura L/R)
        lfoPh_ += lfoInc_ * std::exp2(cur(kLfoRate)) * n;
        if (lfoPh_ > kTwoPi) lfoPh_ -= kTwoPi;
        const double depth = cur(kLfoDepth) / 100.0 * 1.6 * (0.6 + 0.4 * d);          // octavas
        const double cutBase = cur(kCutoff) + 1.5 * mw;                                  // log2 Hz
        cutNow_ = std::exp2(cutBase);
        const double q = 0.6 + cur(kResonance) / 100.0 * 4.5;
        const double kq = 1.0 / q;
        lp_.set(0, std::exp2(clampT(cutBase + depth * std::sin(lfoPh_), 7.0, 14.28)), sr_, kq);
        lp_.set(1, std::exp2(clampT(cutBase + depth * std::cos(lfoPh_), 7.0, 14.28)), sr_, kq);
        const double lc = cur(kLowCut);
        if (std::fabs(lc - lowCutLast_) > 0.002 || lowCutDirty_) { lowCutLast_ = lc; lowHp_.design(sr_, std::exp2(lc)); lowCutDirty_ = false; }
        // EQ
        const double eq[4] = { cur(kEqLow), cur(kEqLowMid), cur(kEqHighMid), cur(kEqHigh) };
        bool chg = eqDirty_;
        for (int i = 0; i < 4; ++i) if (std::fabs(eq[i] - eqLast_[i]) > 0.005) chg = true;
        if (chg) {
            eqCo_[0] = BiquadCoefs::design(FilterType::LowShelf, sr_, 120.0, eq[0], 0.7);
            eqCo_[1] = BiquadCoefs::design(FilterType::Bell, sr_, 400.0, eq[1], 0.8);
            eqCo_[2] = BiquadCoefs::design(FilterType::Bell, sr_, 3000.0, eq[2], 0.8);
            eqCo_[3] = BiquadCoefs::design(FilterType::HighShelf, sr_, 9000.0, eq[3], 0.7);
            for (int i = 0; i < 4; ++i) eqLast_[i] = eq[i];
            eqDirty_ = false;
            eqActive_ = false;
            for (int i = 0; i < 4; ++i) if (std::fabs(eq[i]) > 0.01) eqActive_ = true;
        }
        // delay
        const int sync = static_cast<int>(clampT(std::lround(cur(kDelaySync)), 0L, 5L));
        double ms = cur(kDelayTime);
        if (sync > 0) { ms = syncBeats(sync) * 60000.0 / bpm_; while (ms > 1400.0) ms *= 0.5; while (ms < 40.0) ms *= 2.0; }
        delayMs_ = ms;
        delay_.setTone(std::exp2(cur(kDelayTone)));
        delayFb_ = clampT(cur(kDelayFb) / 100.0 + 0.12 * (d - 1.0), 0.0, 0.92);
        delayMix_ = clampT(cur(kDelayMix) / 100.0 * d, 0.0, 0.95);
        tapeAge_ = clampT(cur(kTapeAge) / 100.0 * d, 0.0, 1.6);
        // reverb
        const double type = clampT(cur(kReverbType), 0.0, 1.0);
        const double scale = 0.72 + 0.28 * type;
        const double rt = std::exp(cur(kReverbDecay)) * (0.85 + 0.15 * d);
        const double shim = clampT(cur(kShimmer) / 100.0 * d * (1.0 + 0.4 * at), 0.0, 1.0);
        verb_.setParams(scale, rt, cur(kReverbDamp) / 100.0, clampT(cur(kReverbMod) / 100.0 * d, 0.0, 1.0), shim, static_cast<int>(std::lround(cur(kShimmerInterval))));
        revMix_ = clampT(cur(kReverbMix) / 100.0 * std::pow(d, 0.85), 0.0, 1.0);
        preMs_ = cur(kPreDelay) * (0.8 + 0.2 * type);
        chorusAmt_ = clampT(cur(kChorus) / 100.0 * d, 0.0, 1.0);
        driveG_ = 1.0 + 5.0 * cur(kDrive) / 100.0;
        drive_ = cur(kDrive) / 100.0;
        compAmt_ = cur(kComp) / 100.0;
        width_ = cur(kWidth) / 100.0;
        const double vol = std::pow(10.0, (cur(kVolume) + presetTrimDb()[static_cast<size_t>(clampT(s_.preset, 0, kNumPresets - 1))]) * 0.05) * kOutTrim;
        outGain_ = vol * cur(kBypass);
    }

    inline void processFrame(double& l, double& r) {
        // saturacion de cinta/valvula (ganancia unidad en pequena senal) + bloqueo de la continua que genera
        if (drive_ > 1.0e-3) {
            const double g = driveG_;
            auto sat = [&](double x, int c) {
                const double xg = x * g;
                const double y = fastTanh(xg + 0.12 * drive_ * xg * xg) / g;
                dcDr_[c] += dcDriveA_ * (y - dcDr_[c]);
                return y - dcDr_[c];
            };
            l = sat(l, 0); r = sat(r, 1);
        }
        l = lowHp_.process(0, l); r = lowHp_.process(1, r);
        l = lp_.process(0, l); r = lp_.process(1, r);
        if (eqActive_) {
            for (int b = 0; b < 4; ++b) { l = biquadProcess(eqCo_[b], eqSt_[b][0], l); r = biquadProcess(eqCo_[b], eqSt_[b][1], r); }
        }
        if (chorusAmt_ > 1.0e-3) { double a, b; chorus_.process(l, r, chorusAmt_, a, b); l = a; r = b; }
        // tape delay (paralelo)
        double dl = 0.0, dr = 0.0;
        if (delayMix_ > 1.0e-3 || delayWet_) {
            delay_.process(l, r, delayMs_, delayFb_, tapeAge_, dl, dr);
            delayWet_ = delayMix_ > 1.0e-3 || std::fabs(dl) + std::fabs(dr) > 1.0e-7;
            dl *= delayMix_ * 0.9; dr *= delayMix_ * 0.9;
        }
        double xl = l + dl, xr = r + dr;
        // reverb: envio sin graves, con pre-delay
        if (revMix_ > 1.0e-3 || revWet_) {
            double sl = sendHp_.process(0, xl), sr = sendHp_.process(1, xr);
            preL_.push(sl); preR_.push(sr);
            const double pd = std::max(1.0, preMs_ * 0.001 * sr_);
            sl = preL_.read(pd); sr = preR_.read(pd);
            double vl, vr;
            verb_.process(sl, sr, vl, vr);
            revWet_ = revMix_ > 1.0e-3 || std::fabs(vl) + std::fabs(vr) > 1.0e-7;
            xl = xl * (1.0 - 0.3 * revMix_) + vl * revMix_ * kRevGain;
            xr = xr * (1.0 - 0.3 * revMix_) + vr * revMix_ * kRevGain;
        }
        comp_.process(xl, xr, compAmt_);
        const double m = 0.5 * (xl + xr), s = 0.5 * (xl - xr) * width_;
        xl = (m + s) * outGain_;
        xr = (m - s) * outGain_;
        // continua + limitador suave + guarda de NaN
        dcOut_[0] += hpDcA_ * (xl - dcOut_[0]); xl -= dcOut_[0];
        dcOut_[1] += hpDcA_ * (xr - dcOut_[1]); xr -= dcOut_[1];
        if (!(std::isfinite(xl) && std::isfinite(xr))) { resetFx(); xl = xr = 0.0; }
        l = softClip(xl);
        r = softClip(xr);
    }
    void resetFx() { sendHp_.reset(); lowHp_.reset(); lp_.reset(); verb_.reset(); chorus_.reset(); delay_.reset(); comp_.reset(); preL_.clear(); preR_.clear(); dcOut_[0] = dcOut_[1] = 0.0; dcDr_[0] = dcDr_[1] = 0.0; for (auto& b : eqSt_) for (auto& s : b) s.reset(); }

public:
    // Calibracion de niveles (ver render_test: pico -18..-3 dBFS a velocidad 0.7)
    static constexpr float kSamplerLevelDb = 6.0f;
    static constexpr double kOutTrim = 1.0;
    static constexpr double kRevGain = 0.85;

private:
    double sr_{48000.0}, bpm_{120.0};
    bool autoLoad_{true};
    AtmosSettings s_;
    std::array<JwSampler::Sampler, kNumBanks> sampler_;
    std::array<std::atomic<int>, kNumBanks> state_{};
    std::atomic<unsigned> pending_{0u}, unloadMask_{0u};
    std::atomic<int> currentBank_{-1};
    std::atomic<bool> quit_{false};
    std::thread loader_;
    bool loaderRunning_{false};
    std::string lastError_;

    std::array<Smoother, kParamCount> sm_;
    std::array<MVoice, kMaxModelVoices> mv_;
    std::array<bool, kMaxModelVoices> sustainHeld_{};
    std::vector<float> sine_;
    std::vector<float> sL_, sR_;
    std::vector<double> mL_, mR_;
    uint64_t clock_{0}, heldKeys_[2]{0, 0};
    bool pedal_{false};

    HighPass2 lowHp_, sendHp_;
    SvfLp lp_;
    BiquadCoefs eqCo_[4];
    BiquadState eqSt_[4][2];
    double eqLast_[4]{1e9, 1e9, 1e9, 1e9};
    bool eqDirty_{true}, eqActive_{false}, lowCutDirty_{true};
    double lowCutLast_{-1.0};
    Ensemble chorus_;
    TapeDelay delay_;
    AtmosVerb verb_;
    SoftComp comp_;
    JasWaveFx::FxRack fx_;
    DelayBuf preL_, preR_;
    bool delayWet_{false}, revWet_{false};
    double lfoPh_{0.0}, lfoInc_{0.0}, cutNow_{8000.0}, fxD_{1.0};
    double delayMs_{500.0}, delayFb_{0.4}, delayMix_{0.2}, tapeAge_{0.2}, revMix_{0.4}, preMs_{20.0}, chorusAmt_{0.3};
    double driveG_{1.0}, drive_{0.0}, compAmt_{0.3}, width_{1.1}, outGain_{1.0};
    double hpDcA_{0.001}, dcDriveA_{0.002};
    double dcIn_[2]{}, dcOut_[2]{}, dcDr_[2]{};
};

} // namespace JasWaveAmbientAtmos
