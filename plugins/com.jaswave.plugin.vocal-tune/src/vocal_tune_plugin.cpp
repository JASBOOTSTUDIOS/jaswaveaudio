// JasWave Vocal Tune – VST3 (procesador, controlador, editor Cyber con la curva de tono detectada/corregida)
#include "vocal_tune_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveVocalTune {

static const FUID kProcessorUid(0x4A617357, 0x56545545, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x56545545, 0x436E7472, 0x56335431);

static const PluginDescriptor kDesc{ "com.jaswave.plugin.vocal-tune", "JasWave Vocal Tune", L"VOCAL TUNE", nullptr, 0, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(vbus_ = std::make_shared<VocalTuneBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        VocalTuneSettings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.retuneMs = plainOf(kRetune);
        s.humanize = plainOf(kHumanize) / 100.0;
        s.vibrato = plainOf(kVibrato) / 100.0;
        s.formantSt = plainOf(kFormant);
        s.throatPct = plainOf(kThroat);
        s.tracking = plainOf(kTracking) / 100.0;
        s.scale = intOf(kScale);
        s.root = intOf(kRoot);
        s.mix = plainOf(kMix) / 100.0;
        s.lowLatency = boolOf(kLowLatency);
        engine_.setSettings(s);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, vbus_.get()); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, vbus_.get()); }
    // La latencia depende solo de Low Latency (el host la consulta tras restartComponent(kLatencyChanged))
    uint32 latencySamples() override { return static_cast<uint32>(latencyFor(sr_, boolOf(kLowLatency))); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 0.03); }
    void writeOutputParams(ProcessData& data) override {
        writeOutputParam(data, kPitchMeter, engine_.detectedHz() / 2000.0);
        writeOutputParam(data, kCorrMeter, (clampT(engine_.correctionCents(), -300.0, 300.0) + 300.0) / 600.0);
    }

private:
    VocalTuneEngine engine_;
    std::shared_ptr<VocalTuneBus> vbus_;
};

// ---------------------------------------------------------------------------------
inline const wchar_t* nombreNota(int n) {
    static const wchar_t* const k[] = { L"C", L"C#", L"D", L"D#", L"E", L"F", L"F#", L"G", L"G#", L"A", L"A#", L"B" };
    return k[((n % 12) + 12) % 12];
}

class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"VOCAL TUNE"; }
    const wchar_t* subtitle() const override { return L"AFINACIÓN AUTOMÁTICA · PSOLA CON FORMANTES"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoMagenta; }
    const char* visualizer() const override { return "curva-tono"; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"CORRECCIÓN");
        P::principal(c, 0, kRetune, L"RETUNE");
        P::principal(c, 1, kHumanize, L"HUMANIZE");
        P::principal(c, 2, kVibrato, L"VIBRATO");
        P::secundaria(c, 0, kFormant, L"FORMANTES");
        P::secundaria(c, 1, kThroat, L"GARGANTA");
        P::secundaria(c, 2, kTracking, L"TRACKING");
        P::salida(c, kBypass, L"SALIDA · ESCALA");
        P::fader(c, kMix, L"MEZCLA");
        P::selectorSalida(c, 0, kScale, L"ESCALA");
        const JasWaveUI::Rect r = P::celda(0, 1, 2);
        c.dropdown(kRoot, { r.l, r.t + 2.0f, r.r, r.b - 2.0f }, L"TÓNICA");
        P::interruptorSalida(c, 2, 1, 1, kLowLatency, L"LOW LAT");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<VocalTuneBus>(c.params.bus());
        if (!bus_) return;
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        n_ = bus_->curva.snapshot(det_.data(), cor_.data(), kHist);
        voz_ = bus_->voz.load(std::memory_order_relaxed);
        detHz_ = bus_->detectadoHz.load(std::memory_order_relaxed);
        corHz_ = bus_->corregidoHz.load(std::memory_order_relaxed);
        cents_ = bus_->correccionCents.load(std::memory_order_relaxed);
        nota_ = bus_->notaObjetivo.load(std::memory_order_relaxed);
        latencia_ = bus_->latencia.load(std::memory_order_relaxed);
        // centro vertical de la curva: sigue la mediana reciente de la voz (suavizado)
        float suma = 0.0f; int k = 0;
        for (int i = std::max(0, n_ - 300); i < n_; ++i) if (det_[static_cast<size_t>(i)] > 0.0f) { suma += det_[static_cast<size_t>(i)]; ++k; }
        if (k > 0) {
            // la primera voz detectada centra la curva de golpe; después la sigue suavemente
            if (!centrado_) { centro_ = suma / k; centrado_ = true; }
            else centro_ += (suma / k - centro_) * std::min(1.0f, c.dt * 3.0f);
        }
        if (voz_ && nota_ >= 0) {
            const float m = 69.0f + 12.0f * std::log2(std::max(1.0f, detHz_) / 440.0f);
            desvio_ += ((m - nota_) * 100.0f - desvio_) * std::min(1.0f, c.dt * 18.0f);
        } else desvio_ *= std::exp(-c.dt * 6.0f);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        P::panelVisual(g, L"CURVA DE TONO · DETECTADO / CORREGIDO");
        meters_.drawLabels(g);
        const Rect a = P::areaEspectro();
        // rejilla de semitonos: los de la escala elegida, marcados; la tónica, en el acento
        const float semis = 14.0f;
        const float lo = centro_ - semis * 0.5f;
        const auto yNota = [&](float m) { return a.b - (m - lo) / semis * a.h(); };
        const uint16_t mask = scaleMask(static_cast<int>(c.params.plain(kScale) + 0.5));
        const int root = static_cast<int>(c.params.plain(kRoot) + 0.5);
        for (int n = static_cast<int>(std::ceil(lo)); n <= static_cast<int>(std::floor(lo + semis)); ++n) {
            const float y = yNota(static_cast<float>(n));
            const int grado = ((n - root) % 12 + 12) % 12;
            const bool enEscala = ((mask >> grado) & 1u) != 0;
            const Color col = grado == 0 ? ac.withAlpha(0.45f) : enEscala ? Pal::reticulaNodo.withAlpha(0.30f) : Pal::reticula;
            g.line(a.l + 34.0f, y, a.r, y, col, grado == 0 ? 1.2f : 1.0f);
            wchar_t b[8];
            swprintf_s(b, L"%s%d", nombreNota(n), n / 12 - 1);
            g.text(b, { a.l, y - 7.0f, a.l + 32.0f, y + 7.0f }, Font::ValueSmall, enEscala ? Pal::textoEtiqueta : Pal::textoTenue, Align::Left);
        }
        // curvas (cortes donde no hay voz)
        if (n_ > 1) {
            dibujarCurva(g, a, det_.data(), lo, semis, Pal::espectroIn, false);
            dibujarCurva(g, a, cor_.data(), lo, semis, ac, true);
        }
        g.fillRect({ a.r - 150.0f, a.t + 8.0f, a.r - 138.0f, a.t + 9.5f }, Pal::espectroIn);
        g.text(L"DETECTADO", { a.r - 134.0f, a.t + 1.0f, a.r - 66.0f, a.t + 15.0f }, Font::Label, Pal::textoTenue, Align::Left, true);
        g.fillRect({ a.r - 62.0f, a.t + 8.0f, a.r - 50.0f, a.t + 9.5f }, ac);
        g.text(L"CORREGIDO", { a.r - 46.0f, a.t + 1.0f, a.r + 30.0f, a.t + 15.0f }, Font::Label, Pal::textoTenue, Align::Left, true);

        // mini-panel: nota objetivo + desvío en cents + lecturas
        P::panelMedicion(g, L"AFINACIÓN · NOTA Y DESVÍO");
        const Rect h = P::kMiniGrafico;
        const Rect caja{ h.l, h.t, h.l + 92.0f, h.b };
        g.strokeRect(caja, Pal::panelBorde, 1.0f);
        wchar_t nb[16];
        if (voz_ && nota_ >= 0) swprintf_s(nb, L"%s%d", nombreNota(nota_), nota_ / 12 - 1);
        else swprintf_s(nb, L"--");
        g.text(nb, { caja.l, caja.cy() - 22.0f, caja.r, caja.cy() + 14.0f }, Font::CodeBig, voz_ ? ac : Pal::textoTenue, Align::Center);
        g.text(voz_ ? L"VOZ" : L"SIN VOZ", { caja.l, caja.b - 22.0f, caja.r, caja.b - 6.0f }, Font::Label, voz_ ? Pal::textoValor : Pal::textoTenue, Align::Center, true);
        // barra de desvío −50..+50 cents (de la voz detectada respecto a la nota objetivo)
        const Rect bar{ caja.r + 14.0f, h.cy() - 6.0f, h.r - 4.0f, h.cy() + 6.0f };
        g.fillRect(bar, Pal::perillaPista);
        const float x0 = bar.cx(), xv = bar.cx() + std::clamp(desvio_ / 50.0f, -1.0f, 1.0f) * bar.w() * 0.5f;
        g.fillRect({ std::min(x0, xv), bar.t + 2.0f, std::max(x0, xv), bar.b - 2.0f }, std::fabs(desvio_) > 25.0f ? Pal::alerta : ac);
        g.line(x0, bar.t - 6.0f, x0, bar.b + 6.0f, Pal::textoValor, 1.2f);
        g.text(L"-50", { bar.l, bar.b + 4.0f, bar.l + 40.0f, bar.b + 18.0f }, Font::ValueSmall, Pal::textoTenue, Align::Left);
        g.text(L"+50", { bar.r - 40.0f, bar.b + 4.0f, bar.r, bar.b + 18.0f }, Font::ValueSmall, Pal::textoTenue, Align::Right);
        g.text(L"DESVÍO (CENTS)", { bar.l, bar.t - 22.0f, bar.r, bar.t - 8.0f }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
        wchar_t b1[32], b2[32], b3[32], b4[32];
        if (voz_) { swprintf_s(b1, L"%.1f Hz", detHz_); swprintf_s(b2, L"%.1f Hz", corHz_); swprintf_s(b3, L"%+.0f ct", cents_); }
        else { swprintf_s(b1, L"--"); swprintf_s(b2, L"--"); swprintf_s(b3, L"0 ct"); }
        swprintf_s(b4, L"%.2f ms", sr_ > 0.0 ? latencia_ * 1000.0 / sr_ : 0.0);
        P::lectura(g, 0, 0, L"DETECTADO", b1, Pal::espectroIn);
        P::lectura(g, 1, 0, L"CORREGIDO", b2, ac);
        P::lectura(g, 0, 1, L"CORRECCIÓN", b3);
        P::lectura(g, 1, 1, L"LATENCIA", b4);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.vocal-tune"; }

private:
    static constexpr int kHist = 900;   // ≈2.4 s a un punto por salto de análisis
    void dibujarCurva(JasWaveUI::Gfx& g, const JasWaveUI::Rect& a, const float* v, float lo, float semis, JasWaveUI::Color col, bool brillo) {
        int k = 0;
        const float x0 = a.l + 36.0f, w = a.r - x0;
        for (int i = 0; i < n_; ++i) {
            const float m = v[i];
            const bool ok = m > 0.0f;
            if (ok) {
                const float y = std::clamp(a.b - (m - lo) / semis * a.h(), a.t, a.b);
                pts_[static_cast<size_t>(k++)] = { x0 + w * (kHist - n_ + i) / (kHist - 1), y };
            }
            if ((!ok || i == n_ - 1) && k > 0) {
                if (k > 1) { if (brillo) g.glowPolyline(pts_.data(), k, col, 1.6f); else g.polyline(pts_.data(), k, col, 1.0f); }
                k = 0;
            }
        }
    }
    std::shared_ptr<VocalTuneBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    std::array<float, kHist> det_{}, cor_{};
    std::array<JasWaveUI::Pt, kHist> pts_{};
    int n_{0}, nota_{-1}, latencia_{0};
    bool voz_{false}, centrado_{false};
    float detHz_{0}, corHz_{0}, cents_{0}, desvio_{0}, centro_{62.0f};
    double sr_{48000.0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kScale, 1.0 }, { kRoot, 9.0 }, { kRetune, 25.0 } }; }
    DemoSignal demoSignal() const override { return DemoSignal::Vocal; }
    // Low Latency cambia la latencia del procesador: el host debe volver a consultarla
    tresult PLUGIN_API setParamNormalized(ParamID tag, ParamValue value) SMTG_OVERRIDE {
        const bool cambia = tag == kLowLatency && std::fabs(getParamNormalized(tag) - value) > 1e-9;
        const tresult r = JwController::setParamNormalized(tag, value);
        if (cambia && componentHandler) componentHandler->restartComponent(kLatencyChanged);
        return r;
    }
};

} // namespace JasWaveVocalTune

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveVocalTune::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Vocal Tune",
               Vst::kDistributable, Vst::PlugType::kFxPitchShift, "1.0.0", kVstVersionString, JasWaveVocalTune::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveVocalTune::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Vocal Tune Controller", 0, "", "1.0.0", kVstVersionString, JasWaveVocalTune::Controller::createInstance)
END_FACTORY
