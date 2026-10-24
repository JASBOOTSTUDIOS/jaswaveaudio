// JasWave Channel Utility – VST3 (procesador, controlador, editor Cyber y factoría)
#include "utility_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveUtility {

// Mismos FUID que "JasWave FX Utility" (bundle JasWaveFx retirado): proyectos existentes siguen cargando
static const FUID kProcessorUid(0x4A617357, 0x5554494C, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x5554494C, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "utilidad.mono-graves", "Mono por debajo de una frecuencia" },
    { "utilidad.ancho-estereo", "Ancho estéreo M/S" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.utility-tool", "JasWave Utility & Phase Tool", L"CHANNEL UTILITY", kFeatures, 2, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(ubus_ = std::make_shared<UtilityBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.snap(); engine_.reset(); }
    void updateParams() override {
        UtilitySettings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.gainDb = plainOf(kGain);
        s.width = plainOf(kWidth) / 100.0;
        s.monoBelowHz = plainOf(kMonoBelow);
        s.invL = boolOf(kInvertL);
        s.invR = boolOf(kInvertR);
        s.balance = plainOf(kBalance);
        s.dc = boolOf(kDcFilter);
        s.swap = boolOf(kSwap);
        s.mono = boolOf(kMono);
        engine_.setSettings(s);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, ubus_.get()); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, ubus_.get()); }
    uint32 tailSamples() override { return 0; }
    LegacyStateFn legacyState() override {
        // Estado de "JasWave FX Utility": 7 dobles normalizados con la misma tabla de ids/rangos
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 7, nullptr); };
    }

private:
    UtilityEngine engine_;
    std::shared_ptr<UtilityBus> ubus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"CHANNEL UTILITY"; }
    const wchar_t* subtitle() const override { return L"GANANCIA · FASE · ANCHO M/S · MONO-GRAVES"; }
    const char* visualizer() const override { return "vectorscopio"; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"IMAGEN ESTÉREO");
        P::principal(c, 0, kBalance, L"BALANCE");
        P::principal(c, 1, kWidth, L"ANCHO");
        P::principal(c, 2, kMonoBelow, L"MONO <");
        P::interruptor(c, 0, 1, kMono, L"MONO");
        P::interruptor(c, 1, 1, kInvertL, L"Ø L");
        P::interruptor(c, 2, 1, kInvertR, L"Ø R");
        P::salida(c, kBypass);
        P::fader(c, kGain, L"GANANCIA");
        P::interruptorSalida(c, 0, 0, 1, kSwap, L"L ⇄ R");
        P::interruptorSalida(c, 1, 0, 1, kDcFilter, L"DC");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<UtilityBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt);
        const float k = std::min(1.0f, c.dt * 15.0f);
        corr_ += (bus_->correlation.load(std::memory_order_relaxed) - corr_) * k;
        side_ += (bus_->sideDb.load(std::memory_order_relaxed) - side_) * k;
        nxy_ = bus_->xy.snapshot(xl_.data(), xr_.data(), static_cast<int>(xl_.size()));
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext&) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Rect v = P::kVisual;
        P::panelVisual(g, L"VECTORSCOPIO · ESPECTRO IN / OUT");
        meters_.drawLabels(g);
        // vectorscopio circular con retícula a 45° (izquierda)
        const float cx = v.l + 152.0f, cy = v.cy() + 12.0f, R = 116.0f;
        g.circle(cx, cy, R, Pal::cian.withAlpha(0.25f), 1.0f);
        g.circle(cx, cy, R * 0.5f, Pal::cian.withAlpha(0.10f), 1.0f);
        g.line(cx, cy - R - 6, cx, cy + R + 6, Pal::cian.withAlpha(0.4f), 1.0f);
        g.line(cx - R - 6, cy, cx + R + 6, cy, Pal::cian.withAlpha(0.2f), 1.0f);
        g.line(cx - R * 0.7071f, cy - R * 0.7071f, cx + R * 0.7071f, cy + R * 0.7071f, Pal::cian.withAlpha(0.15f), 1.0f);
        g.line(cx + R * 0.7071f, cy - R * 0.7071f, cx - R * 0.7071f, cy + R * 0.7071f, Pal::cian.withAlpha(0.15f), 1.0f);
        g.text(L"M", { cx - 10, cy - R - 22, cx + 10, cy - R - 6 }, Font::Label, Pal::textoEtiqueta, Align::Center);
        g.text(L"+S", { cx + R + 6, cy - 8, cx + R + 32, cy + 8 }, Font::Label, Pal::textoTenue, Align::Left);
        g.text(L"−S", { cx - R - 32, cy - 8, cx - R - 6, cy + 8 }, Font::Label, Pal::textoTenue, Align::Right);
        g.text(L"L", { cx - R * 0.78f - 16, cy - R * 0.78f - 16, cx - R * 0.78f, cy - R * 0.78f }, Font::Label, Pal::textoEtiqueta, Align::Center);
        g.text(L"R", { cx + R * 0.78f, cy - R * 0.78f - 16, cx + R * 0.78f + 16, cy - R * 0.78f }, Font::Label, Pal::textoEtiqueta, Align::Center);
        for (int i = 0; i < nxy_; ++i) {
            const float l = std::clamp(xl_[static_cast<size_t>(i)], -1.5f, 1.5f), r = std::clamp(xr_[static_cast<size_t>(i)], -1.5f, 1.5f);
            const float px = cx + (l - r) * 0.5f * R * 1.3f;   // S horizontal
            const float py = cy - (l + r) * 0.5f * R * 1.3f;   // M vertical
            const float age = static_cast<float>(i) / std::max(1, nxy_);
            g.fillRect({ px - 0.8f, py - 0.8f, px + 0.8f, py + 0.8f }, Pal::cianNucleo.withAlpha(0.15f + 0.55f * age));
        }
        // espectro IN / OUT (derecha)
        const Rect a{ v.l + 310.0f, v.t + 32.0f, v.r - 40.0f, v.b - 22.0f };
        espectro_.dibujar(g, a);
        // mini-panel: correlación de fase
        P::panelMedicion(g, L"CORRELACIÓN DE FASE");
        const Rect m = P::kMini;
        const Rect bar{ P::kMiniGrafico.l + 26, m.t + 62, P::kMiniGrafico.r - 10, m.t + 78 };
        g.fillRect(bar, hex(0x03080C));
        g.strokeRect(bar, Pal::panelBorde, 1.0f);
        for (int i = 0; i <= 8; ++i) {
            const float x = bar.l + bar.w() * i / 8.0f;
            g.line(x, bar.b + 2, x, bar.b + (i % 4 == 0 ? 9.0f : 5.0f), Pal::textoTenue, 1.0f);
        }
        const float zx = bar.cx(), vx = bar.l + bar.w() * (corr_ + 1.0f) * 0.5f;
        const Color cc = corr_ < 0.0f ? Pal::alerta : Pal::cian;
        g.fillRect({ std::min(zx, vx), bar.t + 2, std::max(zx, vx), bar.b - 2 }, cc.withAlpha(0.55f));
        g.glowLine(vx, bar.t - 4, vx, bar.b + 4, cc, 2.0f);
        g.text(L"−1", { bar.l - 30, bar.b + 6, bar.l + 30, bar.b + 22 }, Font::ValueSmall, Pal::textoTenue, Align::Center);
        g.text(L"0", { zx - 30, bar.b + 6, zx + 30, bar.b + 22 }, Font::ValueSmall, Pal::textoTenue, Align::Center);
        g.text(L"+1", { bar.r - 30, bar.b + 6, bar.r + 30, bar.b + 22 }, Font::ValueSmall, Pal::textoTenue, Align::Center);
        wchar_t b1[32], b2[32];
        swprintf_s(b1, L"%+.2f", corr_);
        swprintf_s(b2, L"%+.1f dB", side_);
        P::lectura(g, 0, 0, L"CORRELACIÓN", b1, cc);
        P::lectura(g, 0, 1, L"S / M", b2);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.utility-tool"; }

private:
    std::shared_ptr<UtilityBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    std::array<float, 1024> xl_{}, xr_{};
    int nxy_{0};
    float corr_{1.0f}, side_{-60.0f};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kWidth, 135.0 }, { kMonoBelow, 120.0 }, { kGain, 1.5 }, { kDcFilter, 1.0 } }; }
protected:
    LegacyStateFn legacyState() override {
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 7, nullptr); };
    }
};

} // namespace JasWaveUtility

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveUtility::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
               "JasWave Utility & Phase Tool", Vst::kDistributable, Vst::PlugType::kFxTools, "1.0.0", kVstVersionString,
               JasWaveUtility::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveUtility::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Utility & Phase Tool Controller", 0, "", "1.0.0", kVstVersionString, JasWaveUtility::Controller::createInstance)
END_FACTORY
