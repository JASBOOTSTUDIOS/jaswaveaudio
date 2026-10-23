// JasWave True-Peak Limiter Pro – VST3 (procesador, controlador, editor Cyber con forma de onda, TP y LUFS)
#include "truepeak_limiter_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveLimiter {

// FUID estables (los de "JasWave FX Limitador" y del limitador previo de plugins/): no cambiar
static const FUID kProcessorUid(0x4A617357, 0x4C494D49, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x4C494D49, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "limitador.medicion-lufs", "Sonoridad ITU-R BS.1770 / EBU R128 (M, S, I)" },
    { "limitador.dither", "Dither TPDF de 24/16 bit" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.truepeak-limiter", "JasWave True-Peak Limiter Pro", L"TRUE-PEAK LIMITER", kFeatures, 2, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(lbus_ = std::make_shared<LimiterBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override {
        engine_.prepare(sr, maxBlock);
        lbus_->loudness.prepare(sr);
    }
    void resetDsp() override { engine_.snapAll(); engine_.reset(); }
    void updateParams() override {
        LimiterSettings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.ceilingDb = plainOf(kCeiling);
        s.gainDb = plainOf(kGain);
        s.releaseMs = plainOf(kRelease);
        s.lookaheadMs = plainOf(kLookahead);
        s.dither = intOf(kDither);
        s.loudness = feature(kFeatLoudness);
        engine_.setSettings(s);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, lbus_.get()); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, lbus_.get()); }
    uint32 latencySamples() override { return engine_.latencySamples(); }
    uint32 tailSamples() override { return engine_.latencySamples() + static_cast<uint32>(sr_ * 0.05); }
    void writeOutputParams(ProcessData& data) override { writeOutputParam(data, kGrMeter, (60.0 - std::min(60.0, engine_.grDb())) / 60.0); }
    LegacyStateFn legacyState() override {
        // "JasWave FX Limitador": 41 dobles (ids 0..40) con los mismos rangos lineales
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 41, nullptr); };
    }

private:
    LimiterEngine engine_;
    std::shared_ptr<LimiterBus> lbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"TRUE-PEAK LIMITER"; }
    const wchar_t* subtitle() const override { return L"ITU-R BS.1770 · SOBREMUESTREO 4× · LOOKAHEAD"; }
    void build(JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        c.section({ 666, 92, 1048, 404 }, L"LIMITADOR", kBypass, true);
        c.knob(kCeiling, 760, 176, KnobSize::Main, L"TECHO");
        c.knob(kGain, 954, 176, KnobSize::Main, L"GANANCIA");
        c.knob(kRelease, 760, 304, KnobSize::Normal, L"RELEASE");
        c.knob(kLookahead, 857, 304, KnobSize::Normal, L"LOOKAHEAD");
        c.dropdown(kDither, { 920, 294, 1036, 314 }, L"DITHER");
        c.section({ 666, 418, 1048, 556 }, L"MEDIDORES");
        meters_.build(c, 690.0f, 446.0f, 528.0f);
        gr_ = c.meter({ 774, 446, 786, 528 }, nullptr, 0.0f, 24.0f, true);
        tp_ = c.meter({ 800, 446, 812, 528 }, nullptr, -60.0f, 6.0f);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<LimiterBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk);
        bus_->scope.snapshot(snap_, 1000);
        grF_.push(std::pow(10.0f, bus_->grMax.take() / 20.0f));
        const float tp = bus_->tpOut.take();
        tpF_.push(tp);
        tpHold_ = std::max(tpHold_, tp <= 1e-6f ? -120.0f : 20.0f * std::log10(tp));
        gr_->set(grF_.db, grF_.peak);
        tp_->set(tpF_.db, tpF_.peak);
        lufsOn_ = bus_->loudnessOn.load(std::memory_order_relaxed);
        lm_ = bus_->loudness.momentary.load(std::memory_order_relaxed);
        ls_ = bus_->loudness.shortTerm.load(std::memory_order_relaxed);
        li_ = bus_->loudness.integrated.load(std::memory_order_relaxed);
        lat_ = bus_->latency.load(std::memory_order_relaxed);
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return std::clamp((tpF_.db + 48.0f) / 54.0f, 0.0f, 1.0f); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        const Rect v = Layout::kVisualizer;
        Kit::panel(g, v, L"FORMA DE ONDA · TRUE-PEAK");
        const Rect h{ v.l + 14, v.t + 34, v.r - 40, v.b - 16 };
        const float mid = h.cy();
        const double ceil = c.params.plain(kCeiling);
        const float ceilLin = static_cast<float>(std::pow(10.0, ceil / 20.0));
        const float yC = mid - ceilLin * h.h() * 0.5f;
        const int n = snap_.count;
        if (n > 1) {
            for (int i = 0; i < n; ++i) {
                const float x = h.l + h.w() * i / (n - 1);
                const float a = std::min(1.0f, snap_.inAbs[static_cast<size_t>(i)] * static_cast<float>(std::pow(10.0, c.params.plain(kGain) / 20.0)));
                g.line(x, mid - a * h.h() * 0.5f, x, mid + a * h.h() * 0.5f, Pal::textoTenue.withAlpha(0.35f), 1.0f);
            }
            for (int i = 0; i < n; ++i) {
                const float x = h.l + h.w() * i / (n - 1);
                const float a = std::min(1.0f, snap_.outAbs[static_cast<size_t>(i)]);
                g.line(x, mid - a * h.h() * 0.5f, x, mid + a * h.h() * 0.5f, Pal::cian.withAlpha(0.55f), 1.0f);
                pts_[static_cast<size_t>(i)] = { x, mid - a * h.h() * 0.5f };
            }
            Kit::wireTrace(g, pts_.data(), n, Pal::cian, mid, false);
            for (int i = 0; i < n; ++i)
                pts_[static_cast<size_t>(i)].y = h.t + std::clamp(snap_.grDb[static_cast<size_t>(i)] / 12.0f, 0.0f, 1.0f) * h.h() * 0.45f;
            g.glowPolyline(pts_.data(), n, Pal::alerta.withAlpha(0.85f), 1.3f);
        }
        g.line(h.l, mid, h.r, mid, Pal::cian.withAlpha(0.4f), 1.0f);
        g.glowLine(h.l, yC, h.r, yC, Pal::alerta.withAlpha(0.8f), 1.0f);
        g.line(h.l, 2 * mid - yC, h.r, 2 * mid - yC, Pal::alerta.withAlpha(0.35f), 1.0f);
        wchar_t buf[48];
        swprintf_s(buf, L"%.1f dBTP", ceil);
        g.text(buf, { h.r - 120, yC - 18, h.r, yC - 2 }, Font::ValueSmall, Pal::alerta, Align::Right);
        // mini-panel: sonoridad y true-peak
        const Rect m = Layout::kMiniPanel;
        Kit::panel(g, m, L"SONORIDAD · BS.1770");
        const bool lufsLocked = !c.params.featureGranted(kFeatLoudness);
        auto lufs = [&](float v, wchar_t* b) { if (lufsLocked || !lufsOn_ || v <= -119.0f) swprintf_s(b, 32, L"--.-"); else swprintf_s(b, 32, L"%.1f", v); };
        wchar_t bm[32], bs[32], bi[32], btp[32], blat[48];
        lufs(lm_, bm); lufs(ls_, bs); lufs(li_, bi);
        swprintf_s(btp, L"%.2f", tpHold_ < -119.0f ? -120.0f : tpHold_);
        swprintf_s(blat, L"%u smp · %.1f ms", lat_, sr_ > 0 ? lat_ * 1000.0 / sr_ : 0.0);
        const Color lc = lufsLocked ? Pal::bloqueado : Pal::textoValor;
        bigReadout(g, m.l + 24, m.t + 40, L"MOMENTÁNEA", bm, L"LUFS", lc);
        bigReadout(g, m.l + 150, m.t + 40, L"CORTO PLAZO", bs, L"LUFS", lc);
        bigReadout(g, m.l + 276, m.t + 40, L"INTEGRADA", bi, L"LUFS", lc);
        bigReadout(g, m.l + 410, m.t + 40, L"TRUE-PEAK MÁX", btp, L"dBTP", tpHold_ > ceil + 0.01 ? Pal::alerta : Pal::textoValor);
        if (lufsLocked) { Chrome::drawLock(g, m.l + 380, m.t + 15, 9.0f, Pal::bloqueado); }
        g.text(L"LATENCIA", { m.l + 24, m.b - 30, m.l + 110, m.b - 16 }, Font::Label, Pal::textoTenue, Align::Left, true);
        g.text(blat, { m.l + 110, m.b - 31, m.l + 330, m.b - 15 }, Font::ValueSmall, Pal::textoValor, Align::Left);
        // etiquetas de medidores
        meters_.drawLabels(g);
        g.text(L"GR", { 764, 532, 796, 546 }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
        g.text(L"TP", { 790, 532, 822, 546 }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.truepeak-limiter"; }

private:
    static void bigReadout(JasWaveUI::Gfx& g, float x, float y, const wchar_t* label, const wchar_t* value, const wchar_t* unit, JasWaveUI::Color c) {
        using namespace JasWaveUI;
        g.text(label, { x, y, x + 130, y + 14 }, Font::Label, Pal::textoTenue, Align::Left, true);
        g.text(value, { x, y + 14, x + 90, y + 46 }, Font::CodeBig, c, Align::Left);
        g.text(unit, { x + 2, y + 46, x + 90, y + 60 }, Font::ValueSmall, Pal::textoTenue, Align::Left);
    }
    std::shared_ptr<LimiterBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Kit::PeakFollower grF_, tpF_;
    JasWaveUI::Meter *gr_{nullptr}, *tp_{nullptr};
    JasWaveDsp::ScopeSnapshot snap_;
    std::array<JasWaveUI::Pt, 1024> pts_{};
    float tpHold_{-120.0f}, lm_{-120}, ls_{-120}, li_{-120};
    bool lufsOn_{false};
    uint32_t lat_{0};
    double sr_{48000.0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kCeiling, -1.0 }, { kGain, 7.0 }, { kRelease, 120.0 }, { kLookahead, 3.0 }, { kDither, 2 } }; }
protected:
    LegacyStateFn legacyState() override {
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 41, nullptr); };
    }
};

} // namespace JasWaveLimiter

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveLimiter::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave True-Peak Limiter Pro",
               Vst::kDistributable, "Fx|Dynamics|Mastering", "1.0.0", kVstVersionString, JasWaveLimiter::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveLimiter::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave True-Peak Limiter Pro Controller", 0, "", "1.0.0", kVstVersionString, JasWaveLimiter::Controller::createInstance)
END_FACTORY
