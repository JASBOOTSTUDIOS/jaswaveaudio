// =====================================================================================
//  JasWave Channel Utility – motor DSP (latencia 0, sin asignaciones en process)
//   DC (HP 1er orden 5 Hz) → swap L/R → fase L/R → M/S: mono-graves (LR4 HP sobre Side),
//   ancho (Side × width), mono → balance → ganancia. Todos los cambios con rampas (sin clics).
//   IDs/rangos compatibles con "JasWave Utility" de JasWaveFx (processor-profiles.json).
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

namespace JasWaveUtility {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t { kBypass = 0, kGain = 1, kWidth = 2, kMonoBelow = 3, kInvertL = 4, kInvertR = 5, kBalance = 6, kDcFilter = 7, kSwap = 8, kMono = 9 };
enum Feature : int { kFeatMonoBass = 0, kFeatWidth = 1 };

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kGain, "Gain", "dB", -24.0, 24.0, 0.0, 1, true));
        v.push_back(withFeature(linearP(kWidth, "Width", "%", 0.0, 200.0, 100.0, 0), kFeatWidth));
        v.push_back(withFeature(linearP(kMonoBelow, "Mono Below", "Hz", 0.0, 200.0, 0.0, 0), kFeatMonoBass));
        v.push_back(toggleP(kInvertL, "Invert L", 0));
        v.push_back(toggleP(kInvertR, "Invert R", 0));
        v.push_back(linearP(kBalance, "Balance", "", -1.0, 1.0, 0.0, 2, true));
        v.push_back(toggleP(kDcFilter, "DC Filter", 0));
        v.push_back(toggleP(kSwap, "Swap L/R", 0));
        v.push_back(toggleP(kMono, "Mono", 0));
        marcarBasicos(v, { kBypass, kGain, kWidth, kBalance, kMono });   // modo Básico del editor
        return v;
    }();
    return defs;
}

struct UtilitySettings {
    double gainDb{0.0}, width{1.0}, monoBelowHz{0.0}, balance{0.0};
    bool invL{false}, invR{false}, dc{false}, swap{false}, mono{false}, bypass{false};
};

// Anillo XY (goniómetro) decimado, lock-free
class XYRing {
public:
    static constexpr size_t N = 2048;
    XYRing() { for (size_t i = 0; i < N; ++i) { x_[i].store(0.0f, std::memory_order_relaxed); y_[i].store(0.0f, std::memory_order_relaxed); } }
    void push(float l, float r) {
        const uint64_t p = w_.load(std::memory_order_relaxed);
        x_[p & (N - 1)].store(l, std::memory_order_relaxed);
        y_[p & (N - 1)].store(r, std::memory_order_relaxed);
        w_.store(p + 1, std::memory_order_release);
    }
    int snapshot(float* l, float* r, int count) const {
        const uint64_t end = w_.load(std::memory_order_acquire);
        const int n = static_cast<int>(std::min<uint64_t>(end, static_cast<uint64_t>(std::min<size_t>(static_cast<size_t>(count), N))));
        for (int i = 0; i < n; ++i) {
            const uint64_t idx = end - static_cast<uint64_t>(n) + static_cast<uint64_t>(i);
            l[i] = x_[idx & (N - 1)].load(std::memory_order_relaxed);
            r[i] = y_[idx & (N - 1)].load(std::memory_order_relaxed);
        }
        return n;
    }
private:
    std::array<std::atomic<float>, N> x_, y_;
    std::atomic<uint64_t> w_{0};
};

struct UtilityBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    std::atomic<float> correlation{1.0f};   // -1..1 (salida)
    std::atomic<float> sideDb{-120.0f};      // nivel Side / Mid de salida (dB)
    XYRing xy;
};

class UtilityEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        gain_.prepare(sr_, 20.0); width_.prepare(sr_, 20.0); bal_.prepare(sr_, 20.0);
        invL_.prepare(sr_, 8.0); invR_.prepare(sr_, 8.0); swap_.prepare(sr_, 8.0); mono_.prepare(sr_, 15.0);
        dcMix_.prepare(sr_, 10.0); mbMix_.prepare(sr_, 15.0); mbFreq_.prepare(sr_, 30.0); wet_.prepare(sr_, 10.0);
        dcCoef_ = std::exp(-2.0 * kPi * 5.0 / sr_);
        corrCoef_ = 1.0 - std::exp(-1.0 / (0.3 * sr_));
        decim_ = std::max(1, static_cast<int>(sr_ / 12000.0));
        setSettings(s_);
        snap();
        reset();
    }
    void reset() {
        dcL_ = dcR_ = dcXl_ = dcXr_ = 0.0;
        for (auto& b : mbSt_) b.reset();
        cLR_ = 0.0; cLL_ = cRR_ = 1.0e-9; mEn_ = sEn_ = 1.0e-12;
        decCnt_ = 0;
    }
    void setSettings(const UtilitySettings& s) {
        s_ = s;
        gain_.setTarget(dbToLinear(s.gainDb));
        width_.setTarget(s.width);
        bal_.setTarget(s.balance);
        invL_.setTarget(s.invL ? -1.0 : 1.0);
        invR_.setTarget(s.invR ? -1.0 : 1.0);
        swap_.setTarget(s.swap ? 1.0 : 0.0);
        mono_.setTarget(s.mono ? 1.0 : 0.0);
        dcMix_.setTarget(s.dc ? 1.0 : 0.0);
        const bool mbOn = s.monoBelowHz >= 20.0;
        mbMix_.setTarget(mbOn ? 1.0 : 0.0);
        if (mbOn) mbFreq_.setTarget(std::log(s.monoBelowHz));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
    }
    void snap() {
        for (Smoother* sm : { &gain_, &width_, &bal_, &invL_, &invR_, &swap_, &mono_, &dcMix_, &mbMix_, &mbFreq_, &wet_ }) sm->reset(sm->target());
        if (mbFreq_.target() == 0.0) mbFreq_.reset(std::log(100.0));
        designMonoBass(std::exp(mbFreq_.current()));
    }

    template <class T>
    void process(const T* inL, const T* inR, T* outL, T* outR, int n, UtilityBus* bus) {
        if (bus) bus->entrada(inL, inR, n);
        const bool vista = bus && bus->vistaAbierta();   // vectorscopio solo con el editor abierto
        float pin[2] = { 0, 0 }, pout[2] = { 0, 0 };
        int pos = 0;
        while (pos < n) {
            const int m = std::min(32, n - pos);
            const double g0 = gain_.current(), w0 = width_.current(), b0 = bal_.current(), il0 = invL_.current(), ir0 = invR_.current();
            const double sw0 = swap_.current(), mo0 = mono_.current(), dc0 = dcMix_.current(), mb0 = mbMix_.current(), wt0 = wet_.current();
            const double g1 = gain_.advance(m), w1 = width_.advance(m), b1 = bal_.advance(m), il1 = invL_.advance(m), ir1 = invR_.advance(m);
            const double sw1 = swap_.advance(m), mo1 = mono_.advance(m), dc1 = dcMix_.advance(m), mb1 = mbMix_.advance(m), wt1 = wet_.advance(m);
            if (!mbFreq_.settled()) designMonoBass(std::exp(mbFreq_.advance(m)));
            for (int i = 0; i < m; ++i) {
                const double t = static_cast<double>(i + 1) / m;
                auto lerp = [t](double a, double b) { return a + (b - a) * t; };
                const double xl = static_cast<double>(inL[pos + i]), xr = static_cast<double>(inR[pos + i]);
                double l = xl, r = xr;
                // DC: HP de 1er orden (se procesa siempre para que el estado esté listo al activarlo)
                const double hl = l - dcXl_ + dcCoef_ * dcL_;
                const double hr = r - dcXr_ + dcCoef_ * dcR_;
                dcXl_ = l; dcXr_ = r; dcL_ = hl; dcR_ = hr;
                const double dcm = lerp(dc0, dc1);
                l += (hl - l) * dcm;
                r += (hr - r) * dcm;
                // swap (crossfade)
                const double sw = lerp(sw0, sw1);
                const double sl = l * (1.0 - sw) + r * sw, sr = r * (1.0 - sw) + l * sw;
                l = sl * lerp(il0, il1);
                r = sr * lerp(ir0, ir1);
                // M/S
                const double mid = 0.5 * (l + r);
                double side = 0.5 * (l - r);
                const double mbm = lerp(mb0, mb1);
                if (mbm > 0.0) {
                    double hs = biquadProcess(mbC_[0], mbSt_[0], side);
                    hs = biquadProcess(mbC_[1], mbSt_[1], hs);
                    side += (hs - side) * mbm;
                } else {
                    mbSt_[0].reset(); mbSt_[1].reset();
                }
                side *= lerp(w0, w1) * (1.0 - lerp(mo0, mo1));
                l = mid + side;
                r = mid - side;
                // balance (ley lineal, 0 dB en el centro) + ganancia
                const double bal = lerp(b0, b1);
                const double g = lerp(g0, g1);
                l *= g * std::min(1.0, 1.0 - bal);
                r *= g * std::min(1.0, 1.0 + bal);
                const double wt = lerp(wt0, wt1);
                const double ol = xl + (l - xl) * wt, orr = xr + (r - xr) * wt;
                outL[pos + i] = static_cast<T>(ol);
                outR[pos + i] = static_cast<T>(orr);
                if (bus) {
                    pin[0] = std::max(pin[0], static_cast<float>(std::fabs(xl)));
                    pin[1] = std::max(pin[1], static_cast<float>(std::fabs(xr)));
                    pout[0] = std::max(pout[0], static_cast<float>(std::fabs(ol)));
                    pout[1] = std::max(pout[1], static_cast<float>(std::fabs(orr)));
                    cLR_ += corrCoef_ * (ol * orr - cLR_);
                    cLL_ += corrCoef_ * (ol * ol - cLL_);
                    cRR_ += corrCoef_ * (orr * orr - cRR_);
                    const double om = 0.5 * (ol + orr), os = 0.5 * (ol - orr);
                    mEn_ += corrCoef_ * (om * om - mEn_);
                    sEn_ += corrCoef_ * (os * os - sEn_);
                    if (vista && ++decCnt_ >= decim_) { decCnt_ = 0; bus->xy.push(static_cast<float>(ol), static_cast<float>(orr)); }
                }
            }
            pos += m;
        }
        if (bus) {
            bus->salida(outL, outR, n);
            bus->inPk[0].update(pin[0]); bus->inPk[1].update(pin[1]);
            bus->outPk[0].update(pout[0]); bus->outPk[1].update(pout[1]);
            const double den = std::sqrt(cLL_ * cRR_);
            bus->correlation.store(den > 1.0e-10 ? static_cast<float>(clampT(cLR_ / den, -1.0, 1.0)) : 1.0f, std::memory_order_relaxed);
            bus->sideDb.store(static_cast<float>(10.0 * std::log10(std::max(sEn_, 1.0e-12) / std::max(mEn_, 1.0e-12))), std::memory_order_relaxed);
        }
    }

private:
    void designMonoBass(double hz) {
        hz = clampT(hz, 20.0, 400.0);
        mbC_[0] = BiquadCoefs::design(FilterType::HighPass, sr_, hz, 0.0, 0.70710678118654752);
        mbC_[1] = mbC_[0];   // LR4 = dos Butterworth de 2º orden
    }
    double sr_{48000.0};
    UtilitySettings s_;
    Smoother gain_, width_, bal_, invL_, invR_, swap_, mono_, dcMix_, mbMix_, mbFreq_, wet_;
    double dcCoef_{0.999}, dcL_{0}, dcR_{0}, dcXl_{0}, dcXr_{0};
    BiquadCoefs mbC_[2];
    BiquadState mbSt_[2];
    double corrCoef_{0.0001}, cLR_{0}, cLL_{1e-9}, cRR_{1e-9}, mEn_{1e-12}, sEn_{1e-12};
    int decim_{4}, decCnt_{0};
};

} // namespace JasWaveUtility
