// JasWave Shimmer Pad - VST3 instrumento (procesador, controlador, editor Cyber con teclado y medidores)
#include "shimmer_pad_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveShimmerPad {

// FUID: los del shimmer-pad original (proyectos existentes cargan)
static const FUID kProcessorUid(0xB3A7C9E6, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E6, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "pad.infinite-shimmer", "Intervalos de shimmer +7 y +24 (doble octava)" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.shimmer-pad", "JasWave Shimmer Pad", L"SHIMMER PAD", kFeatures, 1, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(pbus_ = std::make_shared<PadBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        PadSettings s;
        s.cutoffHz = plainOf(kCutoff);
        s.resonance = plainOf(kResonance) / 100.0;
        s.interval = intOf(kShimmerOctave);
        s.rt60 = plainOf(kShimmerDecay);
        s.lfoHz = plainOf(kLfoRate);
        s.volumeDb = plainOf(kVolume);
        s.shimmer = plainOf(kShimmer) / 100.0;
        s.attack = plainOf(kAttack);
        s.release = plainOf(kRelease);
        s.reverb = plainOf(kReverb) / 100.0;
        s.detune = plainOf(kDetune) / 100.0;
        s.sub = plainOf(kSub) / 100.0;
        s.chorus = plainOf(kChorus) / 100.0;
        s.bendSemi = plainOf(kBend);
        s.modWheel = plainOf(kModWheel) / 100.0;
        s.aftertouch = plainOf(kAftertouch) / 100.0;
        s.sustain = boolOf(kSustain);
        s.lowCutHz = plainOf(kLowCut);
        s.toneHz = plainOf(kTone);
        s.comp = plainOf(kComp) / 100.0;
        s.delayMix = plainOf(kDelayMix) / 100.0;
        s.delayMs = plainOf(kDelayTime);
        s.delayFb = plainOf(kDelayFb) / 100.0;
        s.drive = plainOf(kDrive) / 100.0;
        s.width = plainOf(kWidth) / 100.0;
        s.tuneCents = plainOf(kTune);
        s.damping = plainOf(kDamping) / 100.0;
        s.bypass = boolOf(kBypass) || !licensed();     // sin licencia: silencio con fundido
        engine_.setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun
        engine_.setFx(fxp_);
    }
    // Un controlador MIDI heredado tambien actualiza el valor normalizado (coherencia con updateParams)
    void setPlain(ParamID id, double plain) {
        const int i = table_.index(id);
        if (i >= 0) norm_[static_cast<size_t>(i)] = JasWaveVst::toNorm(table_.at(i), plain);
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
            if (at > pos) { engine_.render(oL + pos, oR + pos, at - pos, pbus_.get()); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                pbus_->velocidadMidi.update(e.noteOn.velocity);
            } else if (e.type == Event::kNoteOffEvent) {
                engine_.noteOff(e.noteOff.pitch);
            } else if (e.type == Event::kLegacyMIDICCOutEvent) {
                const int cc = e.midiCCOut.controlNumber;
                const int val = e.midiCCOut.value;
                if (cc == 64) { engine_.setPedal(val >= 64); setPlain(kSustain, val >= 64 ? 1.0 : 0.0); }
                else if (cc == 1) { engine_.setModWheel(val / 127.0); setPlain(kModWheel, val / 127.0 * 100.0); }
                else if (cc == 128) { engine_.setAftertouch(val / 127.0); setPlain(kAftertouch, val / 127.0 * 100.0); }
                else if (cc == 129) {
                    const int b14 = (static_cast<int>(e.midiCCOut.value2) << 7) | (val & 0x7F);
                    const double st = (b14 - 8192) / 8192.0 * 2.0;
                    engine_.setBend(st);
                    setPlain(kBend, st);
                } else if (cc == 120) engine_.allSoundOff();
                else if (cc == 123) engine_.allNotesOff();
            }
        }
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, pbus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return kInfiniteTail; }

private:
    PadEngine engine_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<PadBus> pbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"SHIMMER PAD"; }
    const wchar_t* subtitle() const override { return L"PAD AMBIENTAL WORSHIP · SUPERSAW + WAVETABLE · SHIMMER FDN"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    // Teclado en pantalla tocable con el ratón
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { return teclado_.pulsar(e, c.params.bus()); }
    void vizDrag(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext&) override { teclado_.arrastrar(e); }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext&) override { teclado_.soltar(); }
    JasWaveUI::Color accent() const override { return JasWaveUI::hex(0xB78CFF); }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"FILTRO · SHIMMER");
        P::principal(c, 0, kCutoff, L"CUTOFF");
        P::principal(c, 1, kResonance, L"RESONANCIA");
        P::principal(c, 2, kShimmer, L"SHIMMER");
        P::secundaria(c, 0, kShimmerOctave, L"INTERVALO");
        P::secundaria(c, 1, kShimmerDecay, L"DECAY RT60");
        P::secundaria(c, 2, kLfoRate, L"LFO");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaPequena(c, 0, 0, kAttack, L"ATAQUE");
        P::perillaPequena(c, 1, 0, kRelease, L"RELEASE");
        P::perillaPequena(c, 2, 0, kReverb, L"REVERB");
        P::perillaPequena(c, 0, 1, kDetune, L"DETUNE");
        P::perillaPequena(c, 1, 1, kSub, L"SUB");
        P::perillaPequena(c, 2, 1, kChorus, L"CHORUS");
        P::medidores(c, meters_);
        P::paginaMixFx(c);   // pagina «MIX / FX» comun (EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura)
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<PadBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        cutoff_ = bus_->cutoffHz.load(std::memory_order_relaxed);
        const float lvl = bus_->shimmerLevel.load(std::memory_order_relaxed);
        hist_[static_cast<size_t>(histPos_)] = std::clamp((20.0f * std::log10(std::max(lvl, 1.0e-5f)) + 80.0f) / 80.0f, 0.0f, 1.0f);
        histPos_ = (histPos_ + 1) % kHist;
        rt60_ = static_cast<float>(c.params.plain(kShimmerDecay));
        const int iv = static_cast<int>(std::lround(c.params.plain(kShimmerOctave)));
        interval_ = iv == 1 ? L"+7 st" : (iv == 2 ? L"+24 st" : L"+12 st");
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
        // mini-panel: energia de la cola shimmer (reverb)
        P::panelMedicion(g, L"COLA SHIMMER");
        const Rect h = P::kMiniGrafico;
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - val * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, accent(), h.b, true);
        wchar_t buf[32];
        swprintf_s(buf, L"%d / %d", voices_, kMaxVoices);
        P::lectura(g, 0, 0, L"VOCES", buf, accent());
        swprintf_s(buf, L"%.1f s", rt60_);
        P::lectura(g, 1, 0, L"RT60", buf);
        if (cutoff_ >= 1000.0f) swprintf_s(buf, L"%.2f kHz", cutoff_ / 1000.0f); else swprintf_s(buf, L"%.0f Hz", cutoff_);
        P::lectura(g, 0, 1, L"FILTRO", buf);
        P::lectura(g, 1, 1, L"SHIMMER", interval_);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.shimmer-pad"; }

private:
    static constexpr int kHist = 240;
    std::shared_ptr<PadBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, histPos_{0};
    float cutoff_{3200.0f}, rt60_{6.0f};
    const wchar_t* interval_{L"+12 st"};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override {
        // el rack FX va apagado de serie; la demo (solo capturas) lo muestra encendido para probar la pagina MIX / FX
        namespace F = JasWaveFx;
        return { { kAttack, 0.25 }, { kCutoff, 4200.0 }, { kShimmer, 55.0 }, { kReverb, 50.0 }, { kShimmerDecay, 8.0 }, { kChorus, 50.0 },
                 { F::kBase + F::EqOn, 1.0 }, { F::kBase + F::eqGain(0), 3.0 }, { F::kBase + F::eqGain(2), -4.0 }, { F::kBase + F::eqGain(4), 3.5 },
                 { F::kBase + F::eqFreq(4), 4200.0 }, { F::kBase + F::eqGain(5), 2.0 }, { F::kBase + F::HpfOn, 1.0 },
                 { F::kBase + F::CompOn, 1.0 }, { F::kBase + F::CompThresh, -34.0 }, { F::kBase + F::CompRatio, 4.0 }, { F::kBase + F::CompMakeup, 3.0 },
                 { F::kBase + F::ChOn, 1.0 }, { F::kBase + F::DlOn, 1.0 }, { F::kBase + F::DlMix, 22.0 }, { F::kBase + F::RvOn, 1.0 } };
    }
protected:
    // CC1 rueda de modulacion, CC64 sustain, 128 aftertouch de canal, 129 pitch bend
    int midiCcParam(int cc) const override {
        switch (cc) {
            case 1: return static_cast<int>(kModWheel);
            case 64: return static_cast<int>(kSustain);
            case 128: return static_cast<int>(kAftertouch);
            case 129: return static_cast<int>(kBend);
            default: return -1;
        }
    }
};

} // namespace JasWaveShimmerPad

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveShimmerPad::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Shimmer Pad",
               Vst::kDistributable, Vst::PlugType::kInstrumentSynth, "1.0.0", kVstVersionString, JasWaveShimmerPad::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveShimmerPad::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Shimmer Pad Controller", 0, "", "1.0.0", kVstVersionString, JasWaveShimmerPad::Controller::createInstance)
END_FACTORY
