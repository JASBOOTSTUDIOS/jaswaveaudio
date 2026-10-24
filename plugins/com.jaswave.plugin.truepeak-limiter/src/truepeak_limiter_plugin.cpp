// JasWave True-Peak Limiter Pro – VST3 (procesador, controlador, editor Cyber con forma de onda, TP y LUFS)
#include "truepeak_limiter_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

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
    const wchar_t* subtitle() const override { return L"DETECCIÓN TRUE-PEAK · MEDICIÓN BS.1770-4 · LOOKAHEAD"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoMagenta; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"LIMITADOR");
        P::principal(c, 0, kGain, L"GANANCIA");
        P::principal(c, 1, kRelease, L"RELEASE");
        P::principal(c, 2, kLookahead, L"LOOKAHEAD");
        P::selector(c, 0, 3, kDither, L"DITHER");
        P::salida(c, kBypass);
        P::fader(c, kCeiling, L"TECHO");
        gr_ = P::medidorCelda(c, 0, L"GR", 0.0f, 24.0f, true);
        tp_ = P::medidorCelda(c, 1, L"TP", -60.0f, 6.0f, false);
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<LimiterBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt);
        grF_.push(std::pow(10.0f, bus_->grMax.take() / 20.0f), c.dt);
        const float tp = bus_->tpOut.take();
        tpF_.push(tp, c.dt);
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
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        P::panelVisual(g, L"ESPECTRO IN / OUT · TECHO");
        meters_.drawLabels(g);
        const Rect a = P::areaEspectro();
        espectro_.dibujar(g, a);
        // techo de limitación (acento magenta) sobre la escala dBFS
        const double ceil = c.params.plain(kCeiling);
        const float yC = P::yDbfs(a, static_cast<float>(ceil));
        g.fillRect({ a.l, a.t, a.r, yC }, ac.withAlpha(0.05f));
        g.glowLine(a.l, yC, a.r, yC, ac.withAlpha(0.9f), 1.2f);
        wchar_t buf[48];
        swprintf_s(buf, L"TECHO %.1f dBTP", ceil);
        g.text(buf, { a.l + 6, yC + 3, a.l + 220, yC + 19 }, Font::ValueSmall, ac, Align::Left);
        // mini-panel: sonoridad y true-peak (lecturas de alta visibilidad en el acento)
        P::panelMedicion(g, L"SONORIDAD · BS.1770");
        const Rect m = P::kMini;
        const bool lufsLocked = !c.params.featureGranted(kFeatLoudness);
        auto lufs = [&](float v, wchar_t* b) { if (lufsLocked || !lufsOn_ || v <= -119.0f) swprintf_s(b, 32, L"--.-"); else swprintf_s(b, 32, L"%.1f", v); };
        wchar_t bm[32], bs[32], bi[32], btp[32], blat[48];
        lufs(lm_, bm); lufs(ls_, bs); lufs(li_, bi);
        swprintf_s(btp, L"%.2f", tpHold_ < -119.0f ? -120.0f : tpHold_);
        swprintf_s(blat, L"%u smp · %.1f ms", lat_, sr_ > 0 ? lat_ * 1000.0 / sr_ : 0.0);
        const Color lc = lufsLocked ? Pal::bloqueado : ac;
        bigReadout(g, m.l + 24, m.t + 34, L"MOMENTÁNEA", bm, L"LUFS", lc);
        bigReadout(g, m.l + 150, m.t + 34, L"CORTO PLAZO", bs, L"LUFS", lc);
        bigReadout(g, m.l + 276, m.t + 34, L"INTEGRADA", bi, L"LUFS", lc);
        bigReadout(g, m.l + 410, m.t + 34, L"TRUE-PEAK MÁX", btp, L"dBTP", tpHold_ > ceil + 0.01 ? Pal::alerta : Pal::textoValor);
        if (lufsLocked) Chrome::drawLock(g, m.l + 380, m.t + 15, 9.0f, Pal::bloqueado);
        g.text(L"LATENCIA", { m.l + 24, m.b - 26, m.l + 110, m.b - 12 }, Font::Label, Pal::textoTenue, Align::Left, true);
        g.text(blat, { m.l + 110, m.b - 27, m.l + 330, m.b - 11 }, Font::ValueSmall, Pal::textoValor, Align::Left);
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
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Kit::PeakFollower grF_, tpF_;
    JasWaveUI::Meter *gr_{nullptr}, *tp_{nullptr};
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
