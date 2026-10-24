// JasWave Piano Synth – VST3 instrumento (procesador, controlador, editor Cyber con teclado y voces)
#include "piano_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWavePiano {

// FUID del procesador = el del piano previo (native/piano-synth, componente único): proyectos existentes cargan.
static const FUID kProcessorUid(0xB3A7C9E1, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C0D);
static const FUID kControllerUid(0xB3A7C9E1, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C0E);

static const FeatureDef kFeatures[] = {
    { "piano.polifonia-extendida", "Polifonía de 64 voces (básica: 16)" },
    { "piano.imagen-estereo", "Imagen estéreo por registro" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.piano-synth", "JasWave Piano Synth", L"PIANO SYNTH", kFeatures, 2, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(pbus_ = std::make_shared<PianoBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        PianoSettings s;
        s.velSens = plainOf(kVelocity) / 100.0;
        s.bright = plainOf(kBrightness) / 100.0;
        s.decay = plainOf(kDecay) / 100.0;
        s.releaseS = plainOf(kRelease);
        s.stereo = plainOf(kStereo) / 100.0;
        s.volumeDb = plainOf(kVolume);
        s.a4 = plainOf(kTune);
        s.hardness = plainOf(kHardness) / 100.0;
        s.sustain = boolOf(kSustain);
        s.bypass = boolOf(kBypass) || !licensed();     // sin licencia: silencio con fundido
        s.maxVoices = feature(kFeatPolyphony) ? kMaxVoices : kBasicVoices;
        engine_.setSettings(s);
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        std::fill(oL, oL + n, T(0));
        std::fill(oR, oR + n, T(0));
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
            if (at > pos) { engine_.render(oL + pos, oR + pos, at - pos, pbus_.get()); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                pbus_->velocidadMidi.update(e.noteOn.velocity);
            } else if (e.type == Event::kNoteOffEvent) engine_.noteOff(e.noteOff.pitch);
        }
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, pbus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return kInfiniteTail; }
    LegacyStateFn legacyState() override { return legacyPiano(); }

public:
    // Estado del piano previo: 5 floats planos (vel 0.3..2, brillo, damp 0.85..0.99, release s, estéreo)
    static LegacyStateFn legacyPiano() {
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) {
            IBStreamer s(st, kLittleEndian);
            float v = 0, b = 0, d = 0, r = 0, w = 0;
            if (!s.readFloat(v) || !s.readFloat(b) || !s.readFloat(d) || !s.readFloat(r) || !s.readFloat(w)) return false;
            auto set = [&](uint32_t id, double norm) { const int i = t.index(id); if (i >= 0) n[static_cast<size_t>(i)] = clamp01(norm); };
            set(kVelocity, (v - 0.3) / 1.7);
            set(kBrightness, b);
            set(kDecay, (d - 0.85) / 0.14);
            set(kRelease, (r - 0.05) / 2.95);
            set(kStereo, w);
            return true;
        };
    }

private:
    PianoEngine engine_;
    std::shared_ptr<PianoBus> pbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"PIANO SYNTH"; }
    const wchar_t* subtitle() const override { return L"SÍNTESIS MODAL · CUERDAS AL UNÍSONO · 88 TECLAS"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"MARTILLO · CUERDA");
        P::principal(c, 0, kBrightness, L"BRILLO");
        P::principal(c, 1, kHardness, L"DUREZA");
        P::principal(c, 2, kDecay, L"DECAY");
        P::secundaria(c, 0, kVelocity, L"VELOCIDAD");
        P::secundaria(c, 1, kRelease, L"RELEASE");
        P::secundaria(c, 2, kTune, L"LA4");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaSalida(c, 0, kStereo, L"ESTÉREO");
        P::interruptorSalida(c, 1, 0, 2, kSustain, L"SUSTAIN");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<PianoBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        maxVoices_ = bus_->maxVoices.load(std::memory_order_relaxed);
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
        // mini-panel: polifonía
        P::panelMedicion(g, L"POLIFONÍA");
        const Rect h = P::kMiniGrafico;
        const float maxV = static_cast<float>(std::max(1, maxVoices_));
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - std::clamp(val / maxV, 0.0f, 1.0f) * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, accent(), h.b, true);
        wchar_t buf[32];
        swprintf_s(buf, L"%d / %d", voices_, maxVoices_);
        P::lectura(g, 0, 0, L"VOCES", buf, accent());
        P::lectura(g, 0, 1, L"POLIFONÍA", maxVoices_ >= kMaxVoices ? L"EXTENDIDA" : L"BÁSICA");
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.piano-synth"; }

private:
    static constexpr int kHist = 240;
    std::shared_ptr<PianoBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, maxVoices_{kMaxVoices}, histPos_{0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kBrightness, 62.0 }, { kDecay, 55.0 }, { kStereo, 60.0 } }; }
protected:
    int midiCcParam(int cc) const override { return cc == 64 ? static_cast<int>(kSustain) : -1; }
    LegacyStateFn legacyState() override { return Processor::legacyPiano(); }
};

} // namespace JasWavePiano

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWavePiano::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Piano Synth",
               Vst::kDistributable, Vst::PlugType::kInstrumentPiano, "1.0.0", kVstVersionString, JasWavePiano::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWavePiano::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Piano Synth Controller", 0, "", "1.0.0", kVstVersionString, JasWavePiano::Controller::createInstance)
END_FACTORY
