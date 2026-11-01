// JasWave Audio Doctor – VST3 de restauración (procesador, controlador, editor Cyber con perfil de ruido y diagnóstico)
#include "doctor_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

#include <cstdio>

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveDoctor {

static const FUID kProcessorUid(0x4A617357, 0x41444F43, 0x50726F63, 0x56335431);   // "JasW" "ADOC" "Proc" "V3T1"
static const FUID kControllerUid(0x4A617357, 0x41444F43, 0x436E7472, 0x56335431);  // "JasW" "ADOC" "Cntr" "V3T1"

static const PluginDescriptor kDesc{ "com.jaswave.plugin.audio-doctor", "JasWave Audio Doctor", L"AUDIO DOCTOR", nullptr, 0, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(dbus_ = std::make_shared<DoctorBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); autoPendiente_ = false; }
    void resetDsp() override { engine_.clear(); autoPendiente_ = false; }
    void updateParams() override {
        Settings s;
        s.bypass = boolOf(kBypass) || !licensed();   // sin licencia: paso limpio (nunca se rompe la sesión)
        s.live = boolOf(kLive);
        s.delta = boolOf(kDelta);
        s.inDb = static_cast<float>(plainOf(kInGain));
        s.outDb = static_cast<float>(plainOf(kOutGain));
        s.gateOn = boolOf(kGateOn);
        s.gateThresh = static_cast<float>(plainOf(kGateThresh));
        s.gateRatio = static_cast<float>(plainOf(kGateRatio));
        s.gateAttack = static_cast<float>(plainOf(kGateAttack));
        s.gateRelease = static_cast<float>(plainOf(kGateRelease));
        s.gateHold = static_cast<float>(plainOf(kGateHold));
        s.gateHyst = static_cast<float>(plainOf(kGateHyst));
        s.gateHpf = static_cast<float>(plainOf(kGateScHpf));
        s.dnOn = boolOf(kDnOn);
        s.dnLearn = boolOf(kDnLearn);
        s.dnMode = intOf(kDnMode);
        s.dnReduction = static_cast<float>(plainOf(kDnReduction));
        s.dnSmooth = static_cast<float>(plainOf(kDnSmooth) / 100.0);
        s.humOn = boolOf(kHumOn);
        s.humFreq = intOf(kHumFreq);
        s.humHarm = intOf(kHumHarm);
        s.humQ = static_cast<float>(plainOf(kHumQ));
        s.humDepth = static_cast<float>(plainOf(kHumDepth));
        s.clOn = boolOf(kClOn);
        s.clSens = static_cast<float>(plainOf(kClSens) / 100.0);
        s.clWidthMs = static_cast<float>(plainOf(kClWidth));
        s.dcOn = boolOf(kDcOn);
        s.dcThreshDb = static_cast<float>(plainOf(kDcThresh));
        s.dcStrength = static_cast<float>(plainOf(kDcStrength) / 100.0);
        s.rvOn = boolOf(kRvOn);
        s.rvAmount = static_cast<float>(plainOf(kRvAmount) / 100.0);
        s.rvTailMs = static_cast<float>(plainOf(kRvTail));
        s.viOn = boolOf(kViOn);
        s.viLow = static_cast<float>(plainOf(kViLow));
        s.viHigh = static_cast<float>(plainOf(kViHigh));
        s.viDepth = static_cast<float>(plainOf(kViDepth));
        s.tsOn = boolOf(kTsOn);
        s.tsAmount = static_cast<float>(plainOf(kTsAmount) / 100.0);
        s.airOn = boolOf(kAirOn);
        s.airFreq = static_cast<float>(plainOf(kAirFreq));
        s.airGain = static_cast<float>(plainOf(kAirGain));
        engine_.set(s);
        // Auto-Fix: flanco de subida => analiza ~3 s de audio y escribe los ajustes recomendados
        const bool af = boolOf(kAutoFix);
        if (af && !autoPrev_) { autoPendiente_ = true; autoMuestras_ = 0; }
        if (!af) autoPendiente_ = false;
        autoPrev_ = af;
    }
    template <class T>
    void paso(const T* iL, const T* iR, T* oL, T* oR, int n) {
        float pi = 0.0f;
        for (int i = 0; i < n; ++i) pi = std::max(pi, static_cast<float>(std::max(std::fabs(iL[i]), std::fabs(iR[i]))));
        dbus_->inPk[0].update(pi); dbus_->inPk[1].update(pi);
        dbus_->entrada(iL, iR, n);
        engine_.process(iL, iR, oL, oR, n);
        float po = 0.0f;
        for (int i = 0; i < n; ++i) po = std::max(po, static_cast<float>(std::max(std::fabs(oL[i]), std::fabs(oR[i]))));
        dbus_->outPk[0].update(po); dbus_->outPk[1].update(po);
        dbus_->salida(oL, oR, n);
        engine_.publicar(dbus_.get());
        if (autoPendiente_) autoMuestras_ += n;
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { paso(iL, iR, oL, oR, n); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { paso(iL, iR, oL, oR, n); }
    // La latencia depende solo de Live Mic (el host la consulta tras restartComponent(kLatencyChanged))
    uint32 latencySamples() override { return static_cast<uint32>(latenciaPara(sr_, boolOf(kLive))); }
    uint32 tailSamples() override { return static_cast<uint32>(latenciaPara(sr_, boolOf(kLive)) + sr_ * 0.05); }

    void writeOutputParams(ProcessData& data) override {
        const Diagnostico d = engine_.diagnostico();
        auto w = [&](uint32_t id, double plain) { if (const ParamDef* pd = table_.find(id)) writeOutputParam(data, id, toNorm(*pd, plain)); };
        w(kDiagNoise, d.noiseDb);
        w(kDiagHumHz, d.humHz == 50 ? 1.0 : (d.humHz == 60 ? 2.0 : 0.0));
        w(kDiagHumDb, d.humDb);
        w(kDiagClicks, d.clicksPs);
        w(kDiagClip, d.clipPct);
        w(kDiagReverb, d.reverb);
        w(kDiagReduction, engine_.reduccionDb());
        if (autoPendiente_ && autoMuestras_ >= static_cast<int64_t>(3.2 * sr_)) {
            Recomendacion rec[kMaxRecomendaciones];
            const int n = recomendar(d, rec);
            for (int i = 0; i < n; ++i) {
                const int idx = table_.index(rec[i].id);
                if (idx < 0) continue;
                const double nn = toNorm(table_.at(idx), rec[i].plain);
                norm_[static_cast<size_t>(idx)] = nn;
                writeOutputParam(data, rec[i].id, nn);
            }
            // el interruptor Auto-Fix vuelve a Off (es un disparador, no un estado)
            const int ia = table_.index(kAutoFix);
            if (ia >= 0) { norm_[static_cast<size_t>(ia)] = 0.0; writeOutputParam(data, kAutoFix, 0.0); }
            autoPendiente_ = false;
            updateParams();
            dbus_->autoFixSerie.fetch_add(1, std::memory_order_relaxed);
        }
    }

private:
    Engine engine_;
    std::shared_ptr<DoctorBus> dbus_;
    bool autoPrev_{false}, autoPendiente_{false};
    int64_t autoMuestras_{0};
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"AUDIO DOCTOR"; }
    const wchar_t* subtitle() const override { return L"DENOISE · DE-HUM · DE-CLICK · DE-CLIP · DE-REVERB · VOZ · AUTO-FIX"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::cian; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"RESTAURACIÓN");
        P::principal(c, 0, kDnReduction, L"DENOISE");
        P::principal(c, 1, kGateThresh, L"GATE");
        P::principal(c, 2, kRvAmount, L"DE-REVERB");
        P::interruptor(c, 0, 1, kDnOn, L"DENOISE");
        P::interruptor(c, 1, 1, kGateOn, L"GATE");
        P::interruptor(c, 2, 1, kRvOn, L"DE-REVERB");
        P::salida(c, kBypass, L"SALIDA · RESTAURACIÓN");
        P::fader(c, kOutGain, L"SALIDA");
        P::interruptorSalida(c, 0, 0, 1, kAutoFix, L"AUTO-FIX");
        P::interruptorSalida(c, 1, 0, 1, kDnLearn, L"APRENDER");
        P::interruptorSalida(c, 2, 0, 1, kDelta, L"DELTA");
        P::interruptorSalida(c, 0, 1, 1, kHumOn, L"DE-HUM");
        P::interruptorSalida(c, 1, 1, 1, kClOn, L"DE-CLICK");
        P::interruptorSalida(c, 2, 1, 1, kDcOn, L"DE-CLIP");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<DoctorBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt);
        const float k = std::min(1.0f, c.dt * 10.0f);
        redDb_ += (bus_->reduccionDb.load(std::memory_order_relaxed) - redDb_) * k;
        redPico_ = std::max(redPico_ - JasWaveUI::Kit::kCaidaDbS * c.dt, redDb_);
        noiseDb_ = bus_->noiseDb.load(std::memory_order_relaxed);
        humDb_ = bus_->humDb.load(std::memory_order_relaxed);
        humHz_ = bus_->humHz.load(std::memory_order_relaxed);
        clics_ = bus_->clicksPs.load(std::memory_order_relaxed);
        clip_ = bus_->clipPct.load(std::memory_order_relaxed);
        rev_ = bus_->reverb.load(std::memory_order_relaxed);
        lat_ = bus_->latencia.load(std::memory_order_relaxed);
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        aprendiendo_ = bus_->aprendiendo.load(std::memory_order_relaxed) != 0;
        aprendido_ = bus_->aprendido.load(std::memory_order_relaxed) != 0;
        for (int i = 0; i < DoctorBus::kCols; ++i) perfil_[static_cast<size_t>(i)] = bus_->perfil[static_cast<size_t>(i)].load(std::memory_order_relaxed);
        const uint32_t serie = bus_->autoFixSerie.load(std::memory_order_relaxed);
        if (serie != serieVista_) { serieVista_ = serie; destello_ = 1.0f; }
        destello_ = std::max(0.0f, destello_ - c.dt * 0.4f);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext&) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        P::panelVisual(g, L"ESPECTRO IN / OUT · PERFIL DE RUIDO · HUM");
        meters_.drawLabels(g);
        const Rect a = P::areaEspectro();
        espectro_.dibujar(g, a);
        // perfil de ruido (aprendido o estimado por mínimos), 64 columnas log 20 Hz..20 kHz
        for (int i = 0; i < DoctorBus::kCols; ++i)
            pts_[static_cast<size_t>(i)] = { a.l + a.w() * (i + 0.5f) / DoctorBus::kCols, P::yDbfs(a, perfil_[static_cast<size_t>(i)]) };
        g.fillUnder(pts_.data(), DoctorBus::kCols, a.b, Pal::alerta.withAlpha(0.10f));
        g.polyline(pts_.data(), DoctorBus::kCols, Pal::alerta.withAlpha(0.75f), 1.2f);
        g.text(aprendiendo_ ? L"APRENDIENDO RUIDO…" : (aprendido_ ? L"PERFIL APRENDIDO" : L"PERFIL ESTIMADO"),
               { a.l + 6, a.t + 2, a.l + 200, a.t + 16 }, Font::Label, Pal::alerta.withAlpha(0.85f), Align::Left, true);
        // marcas del hum detectado (fundamental y armónicos)
        if (humHz_ > 0) {
            for (int h = 1; h <= 4; ++h) {
                const float x = Kit::xForFreq(a, humHz_ * h);
                g.line(x, a.t, x, a.b, ac.withAlpha(0.45f), 1.0f);
            }
        }
        if (destello_ > 0.0f) g.text(L"AUTO-FIX APLICADO", { a.l + 6, a.t + 18, a.l + 220, a.t + 32 }, Font::Label, ac.withAlpha(destello_), Align::Left, true);

        P::panelMedicion(g, L"DIAGNÓSTICO");
        const Rect m = P::kMiniGrafico;
        const float y0 = m.t + 2.0f;
        wchar_t b[48];
        auto fila = [&](int i, const wchar_t* et, const wchar_t* val, Color c) {
            const float y = y0 + i * 17.0f;
            g.text(et, { m.l, y, m.l + 150.0f, y + 15.0f }, Font::Label, Pal::textoEtiqueta, Align::Left, true);
            g.text(val, { m.l + 152.0f, y, m.r, y + 15.0f }, Font::ValueSmall, c, Align::Left);
        };
        swprintf_s(b, L"%.1f dBFS", std::max(noiseDb_, -99.0f));
        fila(0, L"RUIDO DE FONDO", b, noiseDb_ > -75.0f ? Pal::alerta : Pal::textoValor);
        if (humHz_ > 0) swprintf_s(b, L"%d Hz  %.1f dBFS", humHz_, humDb_); else swprintf_s(b, L"—");
        fila(1, L"HUM", b, humHz_ ? Pal::alerta : Pal::textoValor);
        swprintf_s(b, L"%.1f / s", clics_);
        fila(2, L"CLICS", b, clics_ > 0.5f ? Pal::alerta : Pal::textoValor);
        swprintf_s(b, L"%.2f %%", clip_);
        fila(3, L"RECORTE", b, clip_ > 0.02f ? Pal::alerta : Pal::textoValor);
        swprintf_s(b, L"%.0f %%", rev_);
        fila(4, L"REVERBERANCIA", b, rev_ > 45.0f ? Pal::alerta : Pal::textoValor);
        swprintf_s(b, L"%.1f dB", -redDb_);
        P::lectura(g, 0, 0, L"QUITADO", b, ac);
        swprintf_s(b, L"%.1f dB", -redPico_);
        P::lectura(g, 1, 0, L"PICO", b);
        swprintf_s(b, L"%.2f ms", sr_ > 0.0 ? lat_ * 1000.0 / sr_ : 0.0);
        P::lectura(g, 0, 1, L"LATENCIA", b);
        P::lectura(g, 1, 1, L"MODO", lat_ * 1000.0 / std::max(sr_, 1.0) < 3.0 ? L"LIVE" : L"CALIDAD");
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.audio-doctor"; }

private:
    std::shared_ptr<DoctorBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    std::array<float, DoctorBus::kCols> perfil_{};
    std::array<JasWaveUI::Pt, DoctorBus::kCols> pts_{};
    float redDb_{0}, redPico_{0}, noiseDb_{-120.f}, humDb_{-120.f}, clics_{0}, clip_{0}, rev_{0}, destello_{0};
    int humHz_{0}, lat_{0};
    double sr_{48000.0};
    bool aprendiendo_{false}, aprendido_{false};
    uint32_t serieVista_{0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kDnOn, 1.0 }, { kDnMode, 2.0 }, { kDnReduction, 14.0 }, { kHumOn, 1.0 }, { kHumFreq, 2.0 }, { kGateOn, 1.0 } }; }
    DemoSignal demoSignal() const override { return DemoSignal::Vocal; }
    // Live Mic cambia la latencia del procesador: el host debe volver a consultarla
    tresult PLUGIN_API setParamNormalized(ParamID tag, ParamValue value) SMTG_OVERRIDE {
        const bool cambia = tag == kLive && std::fabs(getParamNormalized(tag) - value) > 1e-9;
        const tresult r = JwController::setParamNormalized(tag, value);
        if (cambia && componentHandler) componentHandler->restartComponent(kLatencyChanged);
        return r;
    }
};

} // namespace JasWaveDoctor

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveDoctor::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Audio Doctor",
               Vst::kDistributable, Vst::PlugType::kFxRestoration, "1.0.0", kVstVersionString, JasWaveDoctor::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveDoctor::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Audio Doctor Controller", 0, "", "1.0.0", kVstVersionString, JasWaveDoctor::Controller::createInstance)
END_FACTORY
