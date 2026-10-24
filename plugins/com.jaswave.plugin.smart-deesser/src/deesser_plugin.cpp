// JasWave Smart De-Esser – VST3 (procesador, controlador, editor Cyber con espectro del sidechain e historial de GR)
#include "deesser_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

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
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoVerdeCian; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"DE-ESSER");
        P::principal(c, 0, kFreq, L"FRECUENCIA");
        P::principal(c, 1, kThreshold, L"UMBRAL");
        P::principal(c, 2, kRange, L"RANGO");
        P::secundaria(c, 0, kRelease, L"RELEASE");
        P::selector(c, 1, 2, kScFilter, L"FILTRO SC");
        P::salida(c, kBypass, L"SALIDA · DETECCIÓN");
        gr_ = P::medidorEnFader(c, L"GR", 0.0f, 24.0f, true);
        P::interruptorSalida(c, 0, 0, 3, kListen, L"ESCUCHAR SC");
        P::selectorSalida(c, 1, kDetection, L"DETECCIÓN");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<DeEsserBus>(c.params.bus());
        if (!bus_) return;
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt);
        sc_.updateBalistica(bus_->sc, sr_, c.dt, JasWaveUI::Kit::kCaidaDbS);
        sc_.columns(cols_, JasWaveUI::Plantilla::EspectroDual::kCols, 20.0, 20000.0, JasWaveUI::Plantilla::kInclinacion);
        bus_->scope.snapshot(snap_, 1000);
        historial_.cargar(snap_.grDb.data(), snap_.count);
        const float g = bus_->grMax.take();
        grF_.push(std::pow(10.0f, g / 20.0f), c.dt);
        gr_->set(grF_.db, grF_.peak);
        grNow_ += (bus_->grNow.load(std::memory_order_relaxed) - grNow_) * std::min(1.0f, c.dt * 20.0f);
        grPeak_ = std::max(grPeak_ - JasWaveUI::Kit::kCaidaDbS * c.dt, g);
        scDb_ = bus_->scDb.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        P::panelVisual(g, L"ESPECTRO IN / OUT · BANDA SIBILANTE");
        meters_.drawLabels(g);
        const Rect a = P::areaEspectro();
        // banda vigilada (campana o paso alto del sidechain), iluminada en el acento
        const double f = c.params.plain(kFreq);
        const bool bell = c.params.plain(kScFilter) >= 0.5;
        const float xf = Kit::xForFreq(a, f);
        const float xl = bell ? Kit::xForFreq(a, f / 1.45) : xf;
        const float xr = bell ? Kit::xForFreq(a, std::min(20000.0, f * 1.45)) : a.r;
        g.fillRect({ xl, a.t, xr, a.b }, ac.withAlpha(0.07f));
        espectro_.dibujar(g, a);
        // espectro del sidechain filtrado (sombreado en el acento)
        if (cols_.size() == static_cast<size_t>(P::EspectroDual::kCols)) {
            for (int i = 0; i < P::EspectroDual::kCols; ++i)
                pts_[static_cast<size_t>(i)] = { a.l + a.w() * (i + 0.5f) / P::EspectroDual::kCols, P::yDbfs(a, cols_[static_cast<size_t>(i)]) };
            g.fillUnder(pts_.data(), P::EspectroDual::kCols, a.b, ac.withAlpha(0.12f));
            g.polyline(pts_.data(), P::EspectroDual::kCols, ac.withAlpha(0.55f), 1.0f);
        }
        g.glowLine(xf, a.t, xf, a.b, ac.withAlpha(0.85f), 1.0f);
        wchar_t buf[48];
        swprintf_s(buf, L"%.0f Hz", f);
        g.text(buf, { xf + 6, a.t + 18, xf + 120, a.t + 34 }, Font::ValueSmall, ac, Align::Left);
        // umbral sobre la escala dBFS
        const float yT = P::yDbfs(a, static_cast<float>(c.params.plain(kThreshold)));
        g.line(a.l, yT, a.r, yT, Pal::alerta.withAlpha(0.55f), 1.0f);
        g.text(L"UMBRAL", { a.l + 4, yT - 16, a.l + 90, yT - 2 }, Font::Label, Pal::alerta.withAlpha(0.8f), Align::Left, true);
        // mini-panel: historial de reducción + vúmetro + lecturas
        P::panelMedicion(g, L"REDUCCIÓN DE SIBILANCIAS · HISTORIAL");
        const Rect h{ P::kMiniGrafico.l, P::kMiniGrafico.t, P::kMiniGrafico.r - 26, P::kMiniGrafico.b - 20 };
        historial_.dibujar(g, h, ac, 12.0f);
        P::barraGR(g, { h.l, h.b + 8, h.r, h.b + 18 }, grNow_, grPeak_, ac, 12.0f);
        wchar_t b1[32], b2[32], b3[32];
        swprintf_s(b1, L"%.1f dB", -grNow_);
        swprintf_s(b2, L"%.1f dB", -grPeak_);
        swprintf_s(b3, L"%.1f dB", std::max(scDb_, -99.0f));
        P::lectura(g, 0, 0, L"REDUCCIÓN", b1, ac);
        P::lectura(g, 1, 0, L"PICO", b2);
        P::lectura(g, 0, 1, L"SIDECHAIN", b3);
        P::lectura(g, 1, 1, L"BANDA", buf);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.smart-deesser"; }

private:
    std::shared_ptr<DeEsserBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::HistorialGR historial_;
    JasWaveUI::Kit::PeakFollower grF_;
    JasWaveUI::Meter* gr_{nullptr};
    JasWaveDsp::SpectrumAnalyzer sc_;
    std::vector<float> cols_;
    JasWaveDsp::ScopeSnapshot snap_;
    std::array<JasWaveUI::Pt, JasWaveUI::Plantilla::EspectroDual::kCols> pts_{};
    double sr_{48000.0};
    float grNow_{0}, grPeak_{0}, scDb_{-120.0f};
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
