// JasWave Smart De-Esser – VST3 (procesador, controlador, editor Cyber con espectro del sidechain e historial de GR)
#include "deesser_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveDeEsser {

// Mismos FUID que "JasWave FX De-esser" (bundle JasWaveFx retirado)
static const FUID kProcessorUid(0x4A617357, 0x44455352, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x44455352, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "deesser.escucha-sidechain", "Escucha del sidechain filtrado" },
    { "deesser.deteccion-relativa", "Detección relativa (sidechain frente a banda completa)" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.smart-deesser", "JasWave Smart De-Esser", L"SMART DE-ESSER", kFeatures, 2, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(dbus_ = std::make_shared<DeEsserBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        DeEsserSettings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.freqHz = plainOf(kFreq);
        s.thrDb = plainOf(kThreshold);
        s.rangeDb = plainOf(kRange);
        s.wide = intOf(kMode) == 1;
        s.listen = boolOf(kListen);
        s.relative = intOf(kDetection) == 1;
        s.bandPass = intOf(kScFilter) == 1;
        s.releaseMs = plainOf(kRelease);
        engine_.setSettings(s);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, dbus_.get()); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, dbus_.get()); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 0.05); }
    void writeOutputParams(ProcessData& data) override { writeOutputParam(data, kGrMeter, (60.0 - std::min(60.0, engine_.grDb())) / 60.0); }
    LegacyStateFn legacyState() override {
        // "JasWave FX De-esser": 5 dobles normalizados (ids 0..4) con los mismos rangos
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 5, nullptr); };
    }

private:
    DeEsserEngine engine_;
    std::shared_ptr<DeEsserBus> dbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"SMART DE-ESSER"; }
    const wchar_t* subtitle() const override { return L"BANDA DIVIDIDA LR4 · SIDECHAIN FILTRADO"; }
    int modeParam() const override { return kMode; }
    void build(JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        c.section({ 666, 92, 1048, 404 }, L"DE-ESSER", kBypass, true);
        c.knob(kFreq, 742, 176, KnobSize::Main, L"FRECUENCIA");
        c.knob(kThreshold, 857, 176, KnobSize::Main, L"UMBRAL");
        c.knob(kRange, 972, 176, KnobSize::Main, L"RANGO");
        c.knob(kRelease, 742, 304, KnobSize::Normal, L"RELEASE");
        c.dropdown(kScFilter, { 820, 294, 1036, 314 }, L"FILTRO SC");
        c.section({ 666, 418, 1048, 556 }, L"DETECCIÓN");
        c.toggle(kListen, { 682, 456, 800, 482 }, L"ESCUCHAR SC");
        c.dropdown(kDetection, { 682, 500, 900, 520 }, L"MODO");
        meters_.build(c, 940.0f, 446.0f, 528.0f);
        gr_ = c.meter({ 1012, 446, 1024, 528 }, nullptr, 0.0f, 24.0f, true);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<DeEsserBus>(c.params.bus());
        if (!bus_) return;
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        meters_.update(bus_->inPk, bus_->outPk);
        an_.update(bus_->sc, sr_);
        an_.columns(cols_, kCols, 1000.0, 20000.0, 3.0);
        bus_->scope.snapshot(snap_, 600);
        grF_.push(std::pow(10.0f, bus_->grMax.take() / 20.0f));
        gr_->set(grF_.db, grF_.peak);
        scDb_ = bus_->scDb.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        const Rect v = Layout::kVisualizer;
        Kit::panel(g, v, L"ESPECTRO DEL SIDECHAIN");
        meters_.drawLabels(g);
        g.text(L"GR", { 1002, 532, 1034, 546 }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
        const Rect pr{ v.l + 14, v.t + 34, v.r - 40, v.b - 22 };
        const double fMin = 1000.0, fMax = 20000.0;
        // eje
        static const double fs[] = { 2000, 3000, 5000, 8000, 12000, 16000 };
        static const wchar_t* ls[] = { L"2k", L"3k", L"5k", L"8k", L"12k", L"16k" };
        for (int i = 0; i < 6; ++i) {
            const float x = Kit::xForFreq(pr, fs[i], fMin, fMax);
            g.line(x, pr.t, x, pr.b, Pal::cian.withAlpha(0.07f), 1.0f);
            g.text(ls[i], { x - 20, pr.b + 2, x + 20, pr.b + 16 }, Font::ValueSmall, Pal::textoTenue, Align::Center);
        }
        // banda vigilada
        const double f = c.params.plain(kFreq);
        const bool bp = c.params.plain(kScFilter) >= 0.5;
        const float xf = Kit::xForFreq(pr, f, fMin, fMax);
        const float xr = bp ? Kit::xForFreq(pr, std::min(fMax, f * 1.45), fMin, fMax) : pr.r;
        const float xl = bp ? Kit::xForFreq(pr, f / 1.45, fMin, fMax) : xf;
        g.fillRect({ xl, pr.t, xr, pr.b }, Pal::cian.withAlpha(0.06f));
        g.glowLine(xf, pr.t, xf, pr.b, Pal::cian.withAlpha(0.8f), 1.0f);
        wchar_t buf[48];
        swprintf_s(buf, L"%.0f Hz", f);
        g.text(buf, { xf + 6, pr.t + 2, xf + 120, pr.t + 18 }, Font::ValueSmall, Pal::textoValor, Align::Left);
        // umbral (absoluto)
        const double thr = c.params.plain(kThreshold);
        const float yT = pr.b - static_cast<float>(std::clamp((thr + 90.0) / 90.0, 0.0, 1.0)) * pr.h();
        g.line(pr.l, yT, pr.r, yT, Pal::alerta.withAlpha(0.55f), 1.0f);
        g.text(L"UMBRAL", { pr.l + 4, yT - 16, pr.l + 90, yT - 2 }, Font::Label, Pal::alerta.withAlpha(0.8f), Align::Left, true);
        if (cols_.size() == static_cast<size_t>(kCols)) {
            for (int i = 0; i < kCols; ++i)
                pts_[static_cast<size_t>(i)] = { pr.l + pr.w() * (i + 0.5f) / kCols, pr.b - std::clamp((cols_[static_cast<size_t>(i)] + 90.0f) / 90.0f, 0.0f, 1.0f) * pr.h() };
            Kit::wireTrace(g, pts_.data(), kCols, Pal::cian, pr.b, true);
        }
        // mini-panel: historial de GR y nivel del sidechain
        const Rect m = Layout::kMiniPanel;
        Kit::panel(g, m, L"HISTORIAL · REDUCCIÓN");
        const Rect h{ m.l + 14, m.t + 32, m.r - 130, m.b - 12 };
        const int n = snap_.count;
        if (n > 1) {
            for (int i = 0; i < n; ++i) {
                const float a = snap_.outAbs[static_cast<size_t>(i)];   // sidechain
                const float db = a <= 1e-5f ? -60.0f : 20.0f * std::log10(a);
                hist_[static_cast<size_t>(i)] = { h.l + h.w() * i / (n - 1), h.b - std::clamp((db + 60.0f) / 60.0f, 0.0f, 1.0f) * h.h() };
            }
            g.fillUnder(hist_.data(), n, h.b, Pal::cian.withAlpha(0.12f));
            g.polyline(hist_.data(), n, Pal::cian.withAlpha(0.5f), 1.0f);
            for (int i = 0; i < n; ++i) hist_[static_cast<size_t>(i)].y = h.t + std::clamp(snap_.grDb[static_cast<size_t>(i)] / 12.0f, 0.0f, 1.0f) * h.h();
            g.glowPolyline(hist_.data(), n, Pal::alerta, 1.4f);
        }
        swprintf_s(buf, L"%.1f dB", grF_.db <= -119.0f ? 0.0f : -grF_.db);
        Kit::readout(g, m.r - 116, m.t + 34, L"REDUCCIÓN", buf, Pal::alerta);
        swprintf_s(buf, L"%.1f dB", std::max(scDb_, -99.0f));
        Kit::readout(g, m.r - 116, m.t + 72, L"SIDECHAIN", buf);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.smart-deesser"; }

private:
    static constexpr int kCols = 200;
    std::shared_ptr<DeEsserBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Kit::PeakFollower grF_;
    JasWaveUI::Meter* gr_{nullptr};
    JasWaveDsp::SpectrumAnalyzer an_;
    std::vector<float> cols_;
    JasWaveDsp::ScopeSnapshot snap_;
    std::array<JasWaveUI::Pt, kCols> pts_{};
    std::array<JasWaveUI::Pt, 1024> hist_{};
    double sr_{48000.0};
    float scDb_{-120.0f};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kFreq, 5800.0 }, { kThreshold, -32.0 }, { kRange, 10.0 }, { kRelease, 70.0 } }; }
    DemoSignal demoSignal() const override { return DemoSignal::Vocal; }
protected:
    LegacyStateFn legacyState() override {
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 5, nullptr); };
    }
};

} // namespace JasWaveDeEsser

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveDeEsser::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Smart De-Esser",
               Vst::kDistributable, Vst::PlugType::kFxDynamics, "1.0.0", kVstVersionString, JasWaveDeEsser::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveDeEsser::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Smart De-Esser Controller", 0, "", "1.0.0", kVstVersionString, JasWaveDeEsser::Controller::createInstance)
END_FACTORY
