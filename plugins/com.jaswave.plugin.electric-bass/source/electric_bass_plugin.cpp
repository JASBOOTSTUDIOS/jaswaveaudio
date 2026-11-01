// JasWave Electric Bass – VST3 instrumento (procesador, controlador, editor Cyber con espectro y teclado)
#include "electric_bass_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveElectricBass {

// FUID existentes del electric-bass (no cambian: los proyectos que lo usan siguen cargando)
static const FUID kProcessorUid(0xB3A7C9E4, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E4, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "bass.tube-drive", "Emulación de saturación valvular de previo vintage" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.electric-bass", "JasWave Electric Bass", L"ELECTRIC BASS", kFeatures, 1, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) {
        registerBus(bbus_ = std::make_shared<BassBus>());
        engine_ = std::make_unique<BassEngine>();   // ≈ 1.3 MB: en el heap, fuera del hilo de audio
    }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_->prepare(sr, maxBlock); updateParams(); }
    void resetDsp() override { engine_->reset(); }
    void updateParams() override {
        BassSettings s;
        s.tone = plainOf(kTone) / 100.0;
        s.fingerAttack = plainOf(kFingerAttack) / 100.0;
        s.drive = plainOf(kDrive) / 100.0;           // sin la feature de licencia cae al valor por defecto
        s.lowBoostDb = plainOf(kLowBoost);
        s.compMix = plainOf(kCompressorMix) / 100.0;
        s.volumeDb = plainOf(kVolume);
        s.pickupMix = plainOf(kPickup) / 100.0;
        s.pluckPos = plainOf(kPluckPos) / 100.0;
        s.sustain = plainOf(kSustain) / 100.0;
        s.mute = plainOf(kMute) / 100.0;
        s.legato = boolOf(kLegato);
        s.glideMs = plainOf(kGlide);
        s.bendSt = plainOf(kBend);
        s.lowCutHz = plainOf(kLowCut);
        s.midDb = plainOf(kMidDb);
        s.midHz = plainOf(kMidHz);
        s.highDb = plainOf(kHighDb);
        s.tape = plainOf(kTape) / 100.0;
        s.tuneCents = plainOf(kTune);
        s.bypass = boolOf(kBypass) || !licensed();    // sin licencia: silencio con fundido
        engine_->setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun
        engine_->setFx(fxp_);
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        if (data.processContext && (data.processContext->state & ProcessContext::kTempoValid)) engine_->setTempo(data.processContext->tempo);
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
            if (at > pos) { engine_->render(oL + pos, oR + pos, at - pos, bbus_.get()); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                engine_->noteOn(e.noteOn.pitch, e.noteOn.velocity);
                bbus_->velocidadMidi.update(e.noteOn.velocity);
            } else if (e.type == Event::kNoteOffEvent) {
                engine_->noteOff(e.noteOff.pitch);
            } else if (e.type == Event::kLegacyMIDICCOutEvent) {
                const int cc = e.midiCCOut.controlNumber;
                if (cc == kPitchBend) {
                    const int v14 = (static_cast<int>(e.midiCCOut.value2) << 7) | static_cast<int>(e.midiCCOut.value);
                    engine_->setBend((v14 - 8192) * (2.0 / 8192.0));
                } else if (cc == 123) engine_->allNotesOff();
                else if (cc == 120) engine_->panic();
            }
        }
        if (pos < n) engine_->render(oL + pos, oR + pos, n - pos, bbus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    // con el rack encendido las colas de delay/reverb pueden superar 0,6 s: cola infinita solo en ese caso
    uint32 tailSamples() override { return fxp_.algunoActivo() ? kInfiniteTail : static_cast<uint32>(sr_ * 0.6); }

private:
    std::unique_ptr<BassEngine> engine_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<BassBus> bbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"ELECTRIC BASS"; }
    const wchar_t* subtitle() const override { return L"BAJO ELÉCTRICO P / J · GUÍA DE ONDAS DE CUERDA · LEGATO"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    // Teclado en pantalla tocable con el ratón
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { return teclado_.pulsar(e, c.params.bus()); }
    void vizDrag(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext&) override { teclado_.arrastrar(e); }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext&) override { teclado_.soltar(); }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"CUERDA · PASTILLA");
        P::principal(c, 0, kTone, L"TONE");
        P::principal(c, 1, kFingerAttack, L"ATTACK");
        P::principal(c, 2, kDrive, L"DRIVE");
        P::secundaria(c, 0, kPickup, L"P / J");
        P::secundaria(c, 1, kPluckPos, L"PLUCK");
        P::secundaria(c, 2, kSustain, L"SUSTAIN");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaSalida(c, 0, kLowBoost, L"SUB BOOST");
        P::perillaPequena(c, 1, 0, kCompressorMix, L"COMP");
        P::perillaPequena(c, 2, 0, kMute, L"MUTE");
        P::perillaPequena(c, 1, 1, kGlide, L"GLIDE");
        P::interruptorSalida(c, 2, 1, 1, kLegato, L"LEGATO");
        P::medidores(c, meters_);
        P::paginaMixFx(c);   // pagina «MIX / FX» comun (EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura)
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<BassBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
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
        P::panelMedicion(g, L"VOCES DE CUERDA");
        const Rect h = P::kMiniGrafico;
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - std::clamp(val / static_cast<float>(kMaxVoices), 0.0f, 1.0f) * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, accent(), h.b, true);
        wchar_t buf[32];
        swprintf_s(buf, L"%d / %d", voices_, kMaxVoices);
        P::lectura(g, 0, 0, L"VOCES", buf, accent());
        P::lectura(g, 0, 1, L"RANGO", L"E1 - G4+");
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.electric-bass"; }

private:
    static constexpr int kHist = 240;
    std::shared_ptr<BassBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, histPos_{0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kTone, 55.0 }, { kFingerAttack, 65.0 }, { kDrive, 25.0 }, { kLowBoost, 4.0 }, { kSustain, 100.0 }, { kLegato, 0.0 } }; }
protected:
    // La rueda de pitch bend (controlador 129 en VST3) se enruta al parámetro Pitch Bend (±2 st)
    int midiCcParam(int cc) const override { return cc == kPitchBend ? static_cast<int>(kBend) : -1; }
};

} // namespace JasWaveElectricBass

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectricBass::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Electric Bass",
               Vst::kDistributable, Vst::PlugType::kInstrumentSynth, "1.0.0", kVstVersionString, JasWaveElectricBass::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectricBass::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Electric Bass Controller", 0, "", "1.0.0", kVstVersionString, JasWaveElectricBass::Controller::createInstance)
END_FACTORY
