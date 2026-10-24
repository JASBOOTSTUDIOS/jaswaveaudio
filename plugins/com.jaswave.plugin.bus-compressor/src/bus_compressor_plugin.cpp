// JasWave Bus Compressor – VST3 (procesador, controlador, editor Cyber con historial de GR y curva estática)
#include "bus_compressor_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

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
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoAmbar; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"COMPRESOR");
        P::principal(c, 0, kThreshold, L"UMBRAL");
        P::principal(c, 1, kRatio, L"RATIO");
        P::principal(c, 2, kKnee, L"RODILLA");
        P::secundaria(c, 0, kAttack, L"ATAQUE");
        P::secundaria(c, 1, kRelease, L"RELEASE");
        P::selector(c, 2, 1, kDetector, L"DET");
        P::salida(c, kBypass);
        P::fader(c, kMakeup, L"MAKEUP");
        P::perillaSalida(c, 0, kMix, L"MEZCLA");
        P::perillaSalida(c, 1, kScHpf, L"SC HPF");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<CompBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt);
        bus_->scope.snapshot(snap_, 1000);
        historial_.cargar(snap_.grDb.data(), snap_.count);
        const float g = bus_->grMax.take();
        grNow_ += (bus_->grNow.load(std::memory_order_relaxed) - grNow_) * std::min(1.0f, c.dt * 20.0f);
        grPeak_ = std::max(grPeak_ - JasWaveUI::Kit::kCaidaDbS * c.dt, g);
        det_ = bus_->detLevelDb.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        P::panelVisual(g, L"ESPECTRO IN / OUT · CURVA ESTÁTICA");
        meters_.drawLabels(g);
        const Rect a = P::areaEspectro();
        espectro_.dibujar(g, a);
        // curva estática entrada → salida (inserto arriba a la derecha, donde el espectro de agudos es bajo)
        const Rect cr{ a.r - 166, a.t + 22, a.r - 10, a.t + 22 + 156 };
        g.fillRect(cr, hex(0x03080C, 0.78f));
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
        g.glowPolyline(curve_.data(), kN, ac, 1.5f);
        const float tx = cr.l + cr.w() * static_cast<float>((thr + 60.0) / 60.0);
        g.line(tx, cr.t, tx, cr.b, ac.withAlpha(0.3f), 1.0f);
        if (det_ > -60.0f) {
            const double y = staticOutDb(det_, thr, ratio, knee);
            g.glowDot(cr.l + cr.w() * (det_ + 60.0f) / 60.0f, cr.b - cr.h() * static_cast<float>(std::clamp((y + 60.0) / 60.0, 0.0, 1.0)), 3.0f, Pal::cianNucleo);
        }
        g.text(L"ENTRADA → SALIDA", { cr.l, cr.b + 2, cr.r, cr.b + 16 }, Font::Label, Pal::textoTenue, Align::Center, true);
        // mini-panel: historial de GR en cascada + vúmetro horizontal + lecturas
        P::panelMedicion(g, L"REDUCCIÓN DE GANANCIA · HISTORIAL");
        const Rect h{ P::kMiniGrafico.l, P::kMiniGrafico.t, P::kMiniGrafico.r - 26, P::kMiniGrafico.b - 20 };
        historial_.dibujar(g, h, ac);
        P::barraGR(g, { h.l, h.b + 8, h.r, h.b + 18 }, grNow_, grPeak_, ac);
        wchar_t b1[32], b2[32], b3[32], b4[32];
        swprintf_s(b1, L"%.1f dB", -grNow_);
        swprintf_s(b2, L"%.1f dB", -grPeak_);
        swprintf_s(b3, L"%.1f dB", std::max(det_, -99.0f));
        swprintf_s(b4, L"%.1f:1", ratio);
        P::lectura(g, 0, 0, L"GR", b1, ac);
        P::lectura(g, 1, 0, L"PICO GR", b2);
        P::lectura(g, 0, 1, L"DETECTOR", b3);
        P::lectura(g, 1, 1, L"RATIO", b4);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.bus-compressor"; }

private:
    std::shared_ptr<CompBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::HistorialGR historial_;
    JasWaveDsp::ScopeSnapshot snap_;
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
