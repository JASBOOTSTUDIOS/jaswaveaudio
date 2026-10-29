// JasWave Electric Guitar – VST3 instrumento (procesador, controlador y editor Cyber con teclado y voces)
#include "electric_guitar_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveElectricGuitar {

static const FUID kProcessorUid(0xB3A7C9E5, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E5, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "guitar.cab-sim-hd", "Emulación de pantalla 4x12 Vintage / Modern" }
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.electric-guitar", "JasWave Electric Guitar", L"ELECTRIC GUITAR", kFeatures, 1, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(gbus_ = std::make_shared<GuitarBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); lastBend_ = lastMod_ = lastPedal_ = -1e9; }
    void resetDsp() override { engine_.reset(); lastBend_ = lastMod_ = lastPedal_ = -1e9; }
    void updateParams() override {
        GuitarSettings s;
        s.ampGain = plainOf(kAmpGain) / 100.0;
        s.cab = plainOf(kCabSim) / 100.0;
        s.tone = plainOf(kTone) / 100.0;
        s.delayFb = plainOf(kDelayFeedback) / 100.0;
        s.chorusMix = plainOf(kChorusMix) / 100.0;
        s.delayMix = plainOf(kDelayMix) / 100.0;
        s.reverbMix = plainOf(kReverbMix) / 100.0;
        s.pickPos = plainOf(kPickPos) / 100.0;
        s.sustain = plainOf(kSustain) / 100.0;
        s.strum = plainOf(kStrum) / 100.0;
        s.volumeDb = plainOf(kVolume);
        s.lowCutHz = plainOf(kLowCut);
        s.highCutHz = plainOf(kHighCut);
        s.width = plainOf(kWidth) / 100.0;
        s.comp = plainOf(kComp) / 100.0;
        s.tape = plainOf(kTape) / 100.0;
        s.delayTimeMs = plainOf(kDelayTime);
        s.delayDiv = intOf(kDelayDiv);
        s.bendRange = intOf(kBendRange) == 1 ? 12 : 2;
        s.bypass = boolOf(kBypass) || !licensed();     // sin licencia: silencio con fundido
        // técnicas (solo automatizables): el motor aplica articulación/legato/dirección/slide/expresión solo cuando el parámetro CAMBIA
        s.slideTimeMs = plainOf(kSlideTime);
        s.slideCurve = plainOf(kSlideCurve) / 100.0;
        s.slideRange = plainOf(kSlideRange);
        s.strumAccent = plainOf(kStrumAccent) / 100.0;
        s.pickNoise = plainOf(kPickNoise) / 100.0;
        s.vibDelayMs = plainOf(kVibDelay);
        s.swellTimeMs = plainOf(kSwellTime);
        s.bendAmount = plainOf(kBendAmount);
        s.tremRate = plainOf(kTremRate);
        s.expression = plainOf(kExpression) / 100.0;
        s.articulation = intOf(kArticulation);
        s.legatoSlide = intOf(kLegatoSlide);
        s.slideMode = intOf(kSlideMode);
        s.strumDir = intOf(kStrumDir);
        engine_.setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun (ids 100..)
        engine_.setFx(fxp_);
        // controladores: solo si el parámetro cambió (los eventos MIDI heredados mandan entre cambios)
        const double bend = plainOf(kBendParam), mod = plainOf(kModWheel) / 100.0, pedal = plainOf(kPedal);
        if (bend != lastBend_) { engine_.setBend(bend); lastBend_ = bend; }
        if (mod != lastMod_) { engine_.setModWheel(mod); lastMod_ = mod; }
        if (pedal != lastPedal_) { engine_.setPedal(pedal >= 0.5); lastPedal_ = pedal; }
    }
    void handleEvent(const Event& e) {
        if (e.type == Event::kNoteOnEvent) {
            engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
            gbus_->velocidadMidi.update(e.noteOn.velocity);
        } else if (e.type == Event::kNoteOffEvent) {
            engine_.noteOff(e.noteOff.pitch);
        } else if (e.type == Event::kLegacyMIDICCOutEvent) {
            const auto& cc = e.midiCCOut;
            if (cc.controlNumber == Steinberg::Vst::kPitchBend) {
                const int v = (static_cast<int>(cc.value2 & 0x7F) << 7) | (cc.value & 0x7F);
                engine_.setBend((v - 8192) / 8192.0);
            } else if (cc.controlNumber == kCtrlModWheel) engine_.setModWheel((cc.value & 0x7F) / 127.0);
            else if (cc.controlNumber == kCtrlSustainOnOff) engine_.setPedal((cc.value & 0x7F) >= 64);
            else if (cc.controlNumber == 123 /*all notes off*/) engine_.allNotesOff();
            else engine_.controlChange(cc.controlNumber, cc.value & 0x7F);   // 11 expresión, 80..83 técnicas
        }
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        std::fill(oL, oL + n, T(0));
        std::fill(oR, oR + n, T(0));
        const ProcessContext* pc = data.processContext;
        engine_.setTempo(pc && (pc->state & ProcessContext::kTempoValid) ? pc->tempo : 0.0);
        IEventList* ev = data.inputEvents;
        const int32 count = ev ? ev->getEventCount() : 0;
        int pos = 0;
        for (int32 i = 0; i <= count; ++i) {
            Event e{};
            int at = n;
            if (i < count) {
                if (ev->getEvent(i, e) != kResultOk) continue;
                at = e.sampleOffset - offset;
                if (at < 0 || at >= n) { if (at < 0 && offset == 0) at = 0; else continue; }
            }
            if (at > pos) { engine_.render(oL + pos, oR + pos, at - pos, gbus_.get()); pos = at; }
            if (i == count) break;
            handleEvent(e);
        }
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, gbus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return kInfiniteTail; }

private:
    GuitarEngine engine_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<GuitarBus> gbus_;
    double lastBend_{-1e9}, lastMod_{-1e9}, lastPedal_{-1e9};
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"ELECTRIC GUITAR"; }
    const wchar_t* subtitle() const override { return L"GUÍA DE ONDAS · AMP VALVULAR · CAB 4X12 · DELAY & CHORUS"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    // Teclado en pantalla tocable con el ratón
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { return teclado_.pulsar(e, c.params.bus()); }
    void vizDrag(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext&) override { teclado_.arrastrar(e); }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext&) override { teclado_.soltar(); }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"AMP · PANTALLA", -1, kFeatCab);
        P::principal(c, 0, kAmpGain, L"AMP GAIN");
        P::principal(c, 1, kTone, L"TONE");
        P::principal(c, 2, kCabSim, L"4X12 CAB");
        P::secundaria(c, 0, kDelayFeedback, L"DELAY FB");
        P::secundaria(c, 1, kDelayMix, L"DELAY MIX");
        P::secundaria(c, 2, kChorusMix, L"CHORUS");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaSalida(c, 0, kReverbMix, L"REVERB");
        {
            const JasWaveUI::Rect r = P::celda(1, 0, 2);
            c.dropdown(kDelayDiv, { r.l, r.t + 2.0f, r.r, r.b - 2.0f }, L"DELAY DIV");
        }
        P::interruptorSalida(c, 1, 1, 1, kBendRange, L"BEND 12");
        P::perillaPequena(c, 2, 1, kSustain, L"SUST");
        P::medidores(c, meters_);
        P::paginaMixFx(c);   // pagina «MIX / FX» (FX Rack comun): SIEMPRE la ultima llamada de build()
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<GuitarBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        delayMs_ = bus_->delayMs.load(std::memory_order_relaxed);
        bend_ = bus_->bendSt.load(std::memory_order_relaxed);
        hist_[static_cast<size_t>(histPos_)] = static_cast<float>(voices_);
        histPos_ = (histPos_ + 1) % kHist;
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext&) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Rect v = P::kVisual;
        P::panelVisual(g, L"ESPECTRO OUT · TECLADO");
        meters_.drawLabels(g);
        espectro_.dibujar(g, { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 112.0f });
        teclado_.dibujar(g, { v.l + 14.0f, v.b - 84.0f, v.r - 14.0f, v.b - 14.0f }, accent());
        P::panelMedicion(g, L"CUERDAS");
        const Rect h = P::kMiniGrafico;
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - std::clamp(val / static_cast<float>(kMaxVoices), 0.0f, 1.0f) * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, accent(), h.b, true);
        wchar_t buf[40];
        swprintf_s(buf, L"%d / %d", voices_, kMaxVoices);
        P::lectura(g, 0, 0, L"VOCES", buf, accent());
        swprintf_s(buf, L"%.0f ms", delayMs_);
        P::lectura(g, 0, 1, L"DELAY", buf);
        swprintf_s(buf, L"%+.2f st", bend_);
        P::lectura(g, 1, 0, L"BEND", buf);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.electric-guitar"; }

private:
    static constexpr int kHist = 240;
    std::shared_ptr<GuitarBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, histPos_{0};
    float delayMs_{0.0f}, bend_{0.0f};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kAmpGain, 55.0 }, { kDelayMix, 30.0 }, { kChorusMix, 30.0 } }; }
protected:
    int midiCcParam(int cc) const override {
        if (cc == Steinberg::Vst::kPitchBend) return static_cast<int>(kBendParam);
        if (cc == kCtrlModWheel) return static_cast<int>(kModWheel);
        if (cc == kCtrlSustainOnOff) return static_cast<int>(kPedal);
        if (cc == kCcExpression) return static_cast<int>(kExpression);
        if (cc == kCcArt) return static_cast<int>(kArticulation);
        if (cc == kCcLegato) return static_cast<int>(kLegatoSlide);
        if (cc == kCcStrumDir) return static_cast<int>(kStrumDir);
        if (cc == kCcSlideMode) return static_cast<int>(kSlideMode);
        return -1;
    }
};

} // namespace JasWaveElectricGuitar

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectricGuitar::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Electric Guitar",
               Vst::kDistributable, Vst::PlugType::kInstrument, "1.0.0", kVstVersionString, JasWaveElectricGuitar::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectricGuitar::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Electric Guitar Controller", 0, "", "1.0.0", kVstVersionString, JasWaveElectricGuitar::Controller::createInstance)
END_FACTORY
