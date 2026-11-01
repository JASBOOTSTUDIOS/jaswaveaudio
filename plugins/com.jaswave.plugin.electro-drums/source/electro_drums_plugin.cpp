// JasWave Electro Drums - VST3 instrumento (procesador, controlador, editor Cyber con pads tocables)
#include "electro_drums_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveElectroDrums {

static const FUID kProcessorUid(0xE1EC7A0D, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xE1EC7A0D, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "drums.electro-kits", "Kits Techno duro y Lo-fi" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.electro-drums", "JasWave Electro Drums", L"ELECTRO DRUMS", kFeatures, 1, true };

// Pads de la UI: nota GM que dispara cada uno
static const int kPadNota[kNumPads] = { 36, 38, 39, 37, 42, 46, 44, 41, 45, 48, 49, 51, 56, 70, 54 };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(bus_ = std::make_shared<ElectroBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        DrumSettings s;
        s.kit = intOf(kKit);
        s.tuneSt = plainOf(kTune);
        s.decay = plainOf(kDecay) / 100.0;
        s.drive = plainOf(kDrive) / 100.0;
        s.volumeDb = plainOf(kVolume);
        const uint32_t lv[5] = { kKickLevel, kSnareLevel, kHatLevel, kTomLevel, kPercLevel };
        const uint32_t pn[5] = { kKickPan, kSnarePan, kHatPan, kTomPan, kPercPan };
        for (int g = 0; g < 5; ++g) { s.lvlDb[g] = plainOf(lv[g]); s.pan[g] = plainOf(pn[g]) / 100.0; }
        s.kickTuneHz = plainOf(kKickTune);
        s.kickDecay = plainOf(kKickDecay) / 100.0;
        s.kickSweep = plainOf(kKickSweep) / 100.0;
        s.kickDrive = plainOf(kKickDrive) / 100.0;
        s.kickClick = plainOf(kKickClick) / 100.0;
        s.snareTuneHz = plainOf(kSnareTune);
        s.snareSnap = plainOf(kSnareSnap) / 100.0;
        s.hatDecay = plainOf(kHatDecay) / 100.0;
        s.tomTuneSt = plainOf(kTomTune);
        s.variation = plainOf(kVariation) / 100.0;
        s.bypass = boolOf(kBypass) || !licensed();     // sin licencia: silencio con fundido
        engine_.setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun
        engine_.setFx(fxp_);
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        if (data.processContext && (data.processContext->state & ProcessContext::kTempoValid)) engine_.setTempo(data.processContext->tempo);
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
            if (at > pos) { engine_.render(oL + pos, oR + pos, at - pos, bus_.get()); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                bus_->velocidadMidi.update(e.noteOn.velocity);
            } else if (e.type == Event::kLegacyMIDICCOutEvent) {
                const int cc = e.midiCCOut.controlNumber;
                if (cc == kCtrlAllNotesOff || cc == kCtrlAllSoundsOff) engine_.allNotesOff();
            }
        }
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, bus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return fxp_.algunoActivo() ? kInfiniteTail : static_cast<uint32>(sr_ * 4.0); }

private:
    DrumEngine engine_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<ElectroBus> bus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"ELECTRO DRUMS"; }
    const wchar_t* subtitle() const override { return L"CAJA DE RITMOS SINTETIZADA · 808 / 909 / TECHNO / LO-FI"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::hex(0xFF9F43); }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"BOMBO · CAJA · SATURACIÓN");
        P::principal(c, 0, kKickTune, L"KICK TUNE");
        P::principal(c, 1, kKickDecay, L"KICK DECAY");
        P::principal(c, 2, kKickSweep, L"KICK SWEEP");
        P::secundaria(c, 0, kKickDrive, L"KICK DRIVE");
        P::secundaria(c, 1, kSnareSnap, L"SNARE SNAP");
        P::secundaria(c, 2, kDrive, L"DRIVE");
        c.dropdown(kKit, { 704.0f, 368.0f, 880.0f, 392.0f }, L"KIT");
        c.knob(kTune, 914.0f, 363.0f, JasWaveUI::KnobSize::Small, L"TUNE");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaPequena(c, 0, 0, kKickLevel, L"BOMBO");
        P::perillaPequena(c, 1, 0, kSnareLevel, L"CAJA");
        P::perillaPequena(c, 2, 0, kHatLevel, L"HATS");
        P::perillaPequena(c, 0, 1, kTomLevel, L"TOMS");
        P::perillaPequena(c, 1, 1, kPercLevel, L"PERC");
        P::perillaPequena(c, 2, 1, kDecay, L"DECAY");
        P::medidores(c, meters_);
        P::paginaMixFx(c);   // pagina «MIX / FX» comun: SIEMPRE lo ultimo de build()
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<ElectroBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        const float caida = std::exp(-c.dt * 6.0f);
        for (int p = 0; p < kNumPads; ++p) {
            const float h = bus_->pad[p].exchange(0.0f, std::memory_order_relaxed);
            pads_[static_cast<size_t>(p)] = h > 0.0f ? std::max(0.35f, h) : pads_[static_cast<size_t>(p)] * caida;
        }
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        hist_[static_cast<size_t>(histPos_)] = static_cast<float>(voices_);
        histPos_ = (histPos_ + 1) % kHist;
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Rect v = P::kVisual;
        P::panelVisual(g, L"ESPECTRO OUT · PADS");
        meters_.drawLabels(g);
        espectro_.dibujar(g, { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 112.0f });
        drawPads(g, rectPads());
        P::panelMedicion(g, L"POLIFONÍA");
        const Rect h = P::kMiniGrafico;
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - std::clamp(val / static_cast<float>(kMaxVoices), 0.0f, 1.0f) * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, accent(), h.b, true);
        wchar_t buf[32];
        swprintf_s(buf, L"%d / %d", voices_, kMaxVoices);
        P::lectura(g, 0, 0, L"VOCES", buf, accent());
        P::lectura(g, 0, 1, L"MAPA", L"GM");
        static const wchar_t* const kits[4] = { L"808", L"909", L"TECHNO", L"LO-FI" };
        P::lectura(g, 1, 0, L"KIT", kits[std::clamp(static_cast<int>(std::lround(c.params.plain(kKit))), 0, 3)], accent());
        swprintf_s(buf, L"%.0f Hz", c.params.plain(kKickTune));
        P::lectura(g, 1, 1, L"BOMBO", buf);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.electro-drums"; }

    // Pads tocables: clic = golpe (mas fuerte cuanto mas cerca del centro del pad). Entran por la cola de la UI del bus.
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        const int p = padEn(e.x, e.y);
        if (p < 0) return false;
        auto bus = std::dynamic_pointer_cast<ElectroBus>(c.params.bus());
        if (!bus) return false;
        bus->notasUi.push(kPadNota[p], velocidadEnPad(p, e.x, e.y));
        bus->notasUi.push(kPadNota[p], 0.0f);
        padPulsado_ = p;
        return true;
    }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext&) override { padPulsado_ = -1; }

private:
    static JasWaveUI::Rect rectPads() {
        const JasWaveUI::Rect v = JasWaveUI::Plantilla::kVisual;
        return { v.l + 14.0f, v.b - 98.0f, v.r - 14.0f, v.b - 12.0f };
    }
    static int padEn(float x, float y) {
        const JasWaveUI::Rect r = rectPads();
        if (x < r.l || x >= r.r || y < r.t || y > r.b) return -1;
        const int p = static_cast<int>((x - r.l) / (r.w() / kNumPads));
        return p >= 0 && p < kNumPads ? p : -1;
    }
    static float velocidadEnPad(int p, float x, float y) {
        const JasWaveUI::Rect r = rectPads();
        const float w = r.w() / kNumPads;
        const float cx = r.l + w * (p + 0.5f), cy = r.t + 34.0f;
        const float d = std::sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / 16.0f;
        return std::clamp(0.95f - 0.5f * d, 0.35f, 0.95f);
    }
    void drawPads(JasWaveUI::Gfx& g, const JasWaveUI::Rect& r) {
        using namespace JasWaveUI;
        static const wchar_t* const names[kNumPads] = { L"KICK", L"SNARE", L"CLAP", L"RIM", L"HAT", L"OPEN", L"PEDAL", L"TOM L", L"TOM M", L"TOM H",
                                                       L"CRASH", L"RIDE", L"COWBL", L"SHAKR", L"TAMB" };
        const float w = r.w() / kNumPads;
        for (int p = 0; p < kNumPads; ++p) {
            const float cx = r.l + w * (p + 0.5f), cy = r.t + 34.0f;
            const float b = pads_[static_cast<size_t>(p)];
            const float rad = 16.0f;
            g.circle(cx, cy, rad, p == padPulsado_ ? accent() : Pal::panelBorde, p == padPulsado_ ? 2.0f : 1.0f);
            if (b > 0.03f) { g.fillCircle(cx, cy, rad * (0.55f + 0.4f * b), accent().withAlpha(0.2f + 0.7f * b)); g.glowDot(cx, cy, 3.0f, accent()); }
            g.text(names[p], { cx - w * 0.5f, r.b - 20.0f, cx + w * 0.5f, r.b - 4.0f }, Font::Label, Pal::textoTenue, Align::Center, true);
        }
    }

    static constexpr int kHist = 240;
    std::shared_ptr<ElectroBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    std::array<float, kNumPads> pads_{};
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, histPos_{0};
    int padPulsado_{-1};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kKickTune, 54.0 }, { kKickSweep, 60.0 }, { kSnareSnap, 70.0 } }; }
};

} // namespace JasWaveElectroDrums

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectroDrums::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Electro Drums",
               Vst::kDistributable, Vst::PlugType::kInstrumentDrum, "1.0.0", kVstVersionString, JasWaveElectroDrums::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectroDrums::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Electro Drums Controller", 0, "", "1.0.0", kVstVersionString, JasWaveElectroDrums::Controller::createInstance)
END_FACTORY
