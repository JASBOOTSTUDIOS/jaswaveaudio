// JasWave Bus Compressor – VST3 (procesador, controlador, editor Cyber con historial de GR y curva estática)
#include "bus_compressor_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveComp {

// FUID estables (los de "JasWave FX Compresor" y del compresor previo de plugins/): no cambiar
static const FUID kProcessorUid(0x4A617357, 0x434F4D50, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x434F4D50, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "comp.filtro-sidechain", "Filtro paso alto del sidechain" },
    { "comp.mezcla-paralela", "Compresión paralela (mezcla dry/wet)" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.bus-compressor", "JasWave Bus Compressor", L"BUS COMPRESSOR", kFeatures, 2, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(cbus_ = std::make_shared<CompBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.snapAll(); engine_.reset(); }
    void updateParams() override {
        CompSettings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.thrDb = plainOf(kThreshold);
        s.ratio = plainOf(kRatio);
        s.attackMs = plainOf(kAttack);
        s.releaseMs = plainOf(kRelease);
        s.kneeDb = plainOf(kKnee);
        s.makeupDb = plainOf(kMakeup);
        s.mix = plainOf(kMix) / 100.0;
        s.scHpfHz = plainOf(kScHpf);
        s.rms = intOf(kDetector) == 1;
        engine_.setSettings(s);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, cbus_.get()); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, cbus_.get()); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 0.05); }
    void writeOutputParams(ProcessData& data) override {
        // GR de solo lectura (id 40): -GR dB en el rango -60..0
        const double gr = std::min(60.0, engine_.grDb());
        writeOutputParam(data, kGrMeter, (60.0 - gr) / 60.0);
    }
    LegacyStateFn legacyState() override {
        // "JasWave FX Compresor": 41 dobles (ids 0..40), mismos rangos lineales; el 40 (GR) se ignora
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 41, nullptr); };
    }

private:
    CompressorEngine engine_;
    std::shared_ptr<CompBus> cbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"BUS COMPRESSOR"; }
    const wchar_t* subtitle() const override { return L"VCA FEED-FORWARD · SOFT-KNEE · ENLACE ESTÉREO"; }
    void build(JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        c.section({ 666, 92, 1048, 404 }, L"COMPRESOR", kBypass, true);
        c.knob(kThreshold, 742, 172, KnobSize::Main, L"UMBRAL");
        c.knob(kRatio, 857, 172, KnobSize::Main, L"RATIO");
        c.knob(kKnee, 972, 172, KnobSize::Main, L"RODILLA");
        c.knob(kAttack, 742, 300, KnobSize::Normal, L"ATAQUE");
        c.knob(kRelease, 857, 300, KnobSize::Normal, L"RELEASE");
        c.dropdown(kDetector, { 930, 290, 1036, 310 }, L"DET");
        c.section({ 666, 418, 1048, 556 }, L"SALIDA · SIDECHAIN");
        c.fader(kMakeup, { 680, 440, 724, 552 }, L"MAKEUP");
        c.knob(kMix, 772, 482, KnobSize::Normal, L"MEZCLA");
        c.knob(kScHpf, 868, 482, KnobSize::Normal, L"SC HPF");
        meters_.build(c, 976.0f, 446.0f, 528.0f);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<CompBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk);
        bus_->scope.snapshot(snap_, 1000);
        const float g = bus_->grMax.take();
        grNow_ += (bus_->grNow.load(std::memory_order_relaxed) - grNow_) * 0.35f;
        grPeak_ = std::max(grPeak_ * 0.995f, g);
        det_ = bus_->detLevelDb.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        const Rect v = Layout::kVisualizer;
        Kit::panel(g, v, L"HISTORIAL · REDUCCIÓN DE GANANCIA");
        meters_.drawLabels(g);
        // historial (izquierda): entrada (tenue), salida (cian) y GR desde arriba
        const Rect h{ v.l + 14, v.t + 34, v.l + 400, v.b - 16 };
        Chrome::drawGrid(g, h, 22.0f, false);
        const int n = snap_.count;
        if (n > 1) {
            auto yLev = [&](float a) { const float db = a <= 1e-5f ? -60.0f : 20.0f * std::log10(a); return h.b - std::clamp((db + 60.0f) / 60.0f, 0.0f, 1.0f) * h.h(); };
            for (int i = 0; i < n; ++i) pts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (n - 1), yLev(snap_.inAbs[static_cast<size_t>(i)]) };
            g.fillUnder(pts_.data(), n, h.b, Pal::textoTenue.withAlpha(0.18f));
            for (int i = 0; i < n; ++i) pts_[static_cast<size_t>(i)].y = yLev(snap_.outAbs[static_cast<size_t>(i)]);
            Kit::wireTrace(g, pts_.data(), n, Pal::cian, h.b, true);
            for (int i = 0; i < n; ++i)
                pts_[static_cast<size_t>(i)].y = h.t + std::clamp(snap_.grDb[static_cast<size_t>(i)] / 24.0f, 0.0f, 1.0f) * h.h();
            g.glowPolyline(pts_.data(), n, Pal::alerta.withAlpha(0.9f), 1.4f);
        }
        g.text(L"GR", { h.l + 4, h.t + 2, h.l + 40, h.t + 16 }, Font::Label, Pal::alerta, Align::Left, true);
        g.text(L"0", { h.r + 2, h.t - 6, h.r + 30, h.t + 8 }, Font::ValueSmall, Pal::textoTenue);
        g.text(L"-24", { h.r + 2, h.b - 8, h.r + 30, h.b + 6 }, Font::ValueSmall, Pal::textoTenue);
        // curva estática (derecha)
        const Rect cr{ v.r - 190, v.t + 46, v.r - 26, v.t + 46 + 164 };
        g.fillRect(cr, hex(0x03080C, 0.6f));
        g.strokeRect(cr, Pal::panelBorde, 1.0f);
        for (int i = 1; i < 6; ++i) {
            const float x = cr.l + cr.w() * i / 6.0f, y = cr.t + cr.h() * i / 6.0f;
            g.line(x, cr.t, x, cr.b, Pal::reticula, 1.0f);
            g.line(cr.l, y, cr.r, y, Pal::reticula, 1.0f);
        }
        g.line(cr.l, cr.b, cr.r, cr.t, Pal::cian.withAlpha(0.18f), 1.0f);
        const double thr = c.params.plain(kThreshold), ratio = c.params.plain(kRatio), knee = c.params.plain(kKnee);
        constexpr int kN = 64;
        for (int i = 0; i < kN; ++i) {
            const double x = -60.0 + 60.0 * i / (kN - 1);
            const double y = staticOutDb(x, thr, ratio, knee);
            curve_[static_cast<size_t>(i)] = { cr.l + cr.w() * static_cast<float>((x + 60.0) / 60.0), cr.b - cr.h() * static_cast<float>(std::clamp((y + 60.0) / 60.0, 0.0, 1.0)) };
        }
        g.glowPolyline(curve_.data(), kN, Pal::cian, 1.5f);
        const float tx = cr.l + cr.w() * static_cast<float>((thr + 60.0) / 60.0);
        g.line(tx, cr.t, tx, cr.b, Pal::cian.withAlpha(0.3f), 1.0f);
        if (det_ > -60.0f) {
            const double y = staticOutDb(det_, thr, ratio, knee);
            g.glowDot(cr.l + cr.w() * (det_ + 60.0f) / 60.0f, cr.b - cr.h() * static_cast<float>(std::clamp((y + 60.0) / 60.0, 0.0, 1.0)), 3.0f, Pal::cianNucleo);
        }
        g.text(L"ENTRADA → SALIDA", { cr.l, cr.b + 4, cr.r, cr.b + 18 }, Font::Label, Pal::textoTenue, Align::Center, true);
        // mini-panel: medidor horizontal de GR + lecturas
        const Rect m = Layout::kMiniPanel;
        Kit::panel(g, m, L"REDUCCIÓN DE GANANCIA");
        const Rect bar{ m.l + 20, m.t + 46, m.r - 160, m.t + 66 };
        const int segs = 48;
        for (int i = 0; i < segs; ++i) {
            const float x0 = bar.r - (i + 1) * bar.w() / segs;
            const bool on = grNow_ >= (i + 0.5f) * 24.0f / segs;
            const bool pk = std::fabs(grPeak_ - (i + 0.5f) * 24.0f / segs) < 0.25f;
            g.fillRect({ x0 + 1, bar.t, x0 + bar.w() / segs - 1, bar.b }, on ? Pal::alerta : pk ? Pal::alerta.withAlpha(0.6f) : Pal::alerta.withAlpha(0.08f));
        }
        static const wchar_t* lab[] = { L"0", L"-6", L"-12", L"-18", L"-24" };
        for (int i = 0; i <= 4; ++i) {
            const float x = bar.r - bar.w() * i / 4.0f;
            g.text(lab[i], { x - 20, bar.b + 4, x + 20, bar.b + 18 }, Font::ValueSmall, Pal::textoTenue, Align::Center);
        }
        wchar_t b1[32], b2[32], b3[32];
        swprintf_s(b1, L"%.1f dB", -grNow_);
        swprintf_s(b2, L"%.1f dB", -grPeak_);
        swprintf_s(b3, L"%.1f dB", std::max(det_, -99.0f));
        Kit::readout(g, m.r - 140, m.t + 32, L"GR", b1, Pal::alerta);
        Kit::readout(g, m.r - 140, m.t + 66, L"PICO GR", b2);
        Kit::readout(g, m.r - 70, m.t + 32, L"DETECTOR", b3);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.bus-compressor"; }

private:
    std::shared_ptr<CompBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveDsp::ScopeSnapshot snap_;
    std::array<JasWaveUI::Pt, 1024> pts_{};
    std::array<JasWaveUI::Pt, 64> curve_{};
    float grNow_{0}, grPeak_{0}, det_{-100};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override {
        return { { kThreshold, -24.0 }, { kRatio, 4.0 }, { kAttack, 8.0 }, { kRelease, 160.0 }, { kKnee, 8.0 }, { kMakeup, 4.0 }, { kMix, 85.0 }, { kScHpf, 90.0 } };
    }
protected:
    LegacyStateFn legacyState() override {
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 41, nullptr); };
    }
};

} // namespace JasWaveComp

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveComp::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Bus Compressor",
               Vst::kDistributable, Vst::PlugType::kFxDynamics, "1.0.0", kVstVersionString, JasWaveComp::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveComp::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Bus Compressor Controller", 0, "", "1.0.0", kVstVersionString, JasWaveComp::Controller::createInstance)
END_FACTORY
