// JasWave Strings Section – VST3 instrumento (procesador, controlador, editor Cyber con teclado y voces)
#include "strings_section_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveStringsSection {

using namespace JasWaveStrings;

// FUID existentes del strings-section (no cambian: los proyectos que ya lo referencian cargan)
static const FUID kProcessorUid(0xB3A7C9E7, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E7, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "strings.cinematic-hall", "Acústica sinfónica de sala de conciertos de 4.0 segundos" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.strings-section", "JasWave Strings Section", L"STRINGS SECTION", kFeatures, 1, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(sbus_ = std::make_shared<StringsBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        StringsSettings s;
        s.expression = plainOf(kExpression) / 100.0;
        s.vibrato = plainOf(kVibratoDepth) / 100.0;
        s.attackSec = plainOf(kAttackTime) / 1000.0;
        s.releaseSec = plainOf(kReleaseTime) / 1000.0;
        s.hall = plainOf(kHallSize) / 100.0;
        s.volumeDb = plainOf(kVolume);
        s.a4 = plainOf(kTune);
        s.width = plainOf(kWidth) / 100.0;
        s.sectionSize = intOf(kSectionSize);
        s.modWheel = plainOf(kModWheel) / 100.0;
        s.bendSemis = plainOf(kPitchBendP);
        s.sustain = boolOf(kSustain);
        s.legato = boolOf(kLegato);
        s.glideMs = plainOf(kGlideTime);
        s.tremolo = plainOf(kTremolo) / 100.0;
        s.warmth = plainOf(kWarmth) / 100.0;
        s.ensemble = plainOf(kEnsemble) / 100.0;
        s.compress = plainOf(kCompressor) / 100.0;
        s.lowCutHz = plainOf(kLowCut);
        s.bypass = boolOf(kBypass) || !licensed();     // sin licencia: silencio con fundido
        engine_.setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun
        engine_.setFx(fxp_);
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        std::fill(oL, oL + n, T(0));
        std::fill(oR, oR + n, T(0));
        if (data.processContext && (data.processContext->state & ProcessContext::kTempoValid)) engine_.setTempo(data.processContext->tempo);
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
            if (at > pos) { engine_.render(oL + pos, oR + pos, at - pos, sbus_.get()); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                sbus_->velocidadMidi.update(e.noteOn.velocity);
            } else if (e.type == Event::kNoteOffEvent) engine_.noteOff(e.noteOff.pitch);
        }
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, sbus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return kInfiniteTail; }   // sala propia hasta ~4 s + release, y el FX Rack (reverb hall/delay) alarga la cola

private:
    StringsEngine engine_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<StringsBus> sbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"STRINGS SECTION"; }
    const wchar_t* subtitle() const override { return L"ENSAMBLE SINFÓNICO DE CUERDAS LEGATO · EXPRESIÓN & SALA"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    // Teclado en pantalla tocable con el ratón
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { return teclado_.pulsar(e, c.params.bus()); }
    void vizDrag(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext&) override { teclado_.arrastrar(e); }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext&) override { teclado_.soltar(); }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"ARCO · EXPRESIÓN");
        P::principal(c, 0, kExpression, L"EXPRESSION");
        P::principal(c, 1, kVibratoDepth, L"VIBRATO");
        P::principal(c, 2, kHallSize, L"SALA");
        P::secundaria(c, 0, kAttackTime, L"ATAQUE");
        P::secundaria(c, 1, kReleaseTime, L"RELEASE");
        P::secundaria(c, 2, kSectionSize, L"SECCIÓN");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaSalida(c, 0, kWidth, L"ANCHO");
        P::perillaPequena(c, 1, 0, kGlideTime, L"GLIDE");
        P::perillaPequena(c, 1, 1, kTremolo, L"TREMOLO");
        P::interruptorSalida(c, 2, 0, 1, kLegato, L"LEGATO");
        P::interruptorSalida(c, 2, 1, 1, kSustain, L"SUSTAIN");
        P::medidores(c, meters_);
        P::paginaMixFx(c);   // pagina «MIX / FX» comun (EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura); SIEMPRE la ultima
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<StringsBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        players_ = bus_->players.load(std::memory_order_relaxed);
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
        P::panelMedicion(g, L"SECCIÓN");
        const Rect h = P::kMiniGrafico;
        const float maxV = static_cast<float>(kMaxVoices);
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - std::clamp(val / maxV, 0.0f, 1.0f) * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, accent(), h.b, true);
        wchar_t buf[32];
        swprintf_s(buf, L"%d / %d", voices_, kMaxVoices);
        P::lectura(g, 0, 0, L"VOCES", buf, accent());
        swprintf_s(buf, L"%d", players_);
        P::lectura(g, 0, 1, L"ATRILES", buf);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.strings-section"; }

private:
    static constexpr int kHist = 240;
    std::shared_ptr<StringsBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, players_{0}, histPos_{0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kExpression, 80.0 }, { kHallSize, 65.0 }, { kVibratoDepth, 40.0 } }; }
protected:
    // CC1 (mod wheel), CC11 (expression), CC64 (sustain) y pitch bend (129) llegan como parámetros automatizables
    int midiCcParam(int cc) const override {
        switch (cc) {
            case kCtrlModWheel: return static_cast<int>(kModWheel);
            case kCtrlExpression: return static_cast<int>(kExpression);
            case kCtrlSustainOnOff: return static_cast<int>(kSustain);
            case Steinberg::Vst::kPitchBend: return static_cast<int>(kPitchBendP);
            default: return -1;
        }
    }
};

} // namespace JasWaveStringsSection

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveStringsSection::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Strings Section",
               Vst::kDistributable, Vst::PlugType::kInstrumentSynth, "1.0.0", kVstVersionString, JasWaveStringsSection::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveStringsSection::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Strings Section Controller", 0, "", "1.0.0", kVstVersionString, JasWaveStringsSection::Controller::createInstance)
END_FACTORY
