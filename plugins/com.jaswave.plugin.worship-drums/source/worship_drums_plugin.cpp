// JasWave Worship Drums – VST3 instrumento (procesador, controlador, editor Cyber con pads del kit y voces)
#include "worship_drums_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveWorshipDrums {

// FUID existentes del worship-drums (los proyectos guardados cargan igual)
static const FUID kProcessorUid(0xB3A7C9E3, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E3, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "drums.worship-room", "Sala espacial worship de gran dimensión" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.worship-drums", "JasWave Worship Drums", L"WORSHIP DRUMS", kFeatures, 1, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(dbus_ = std::make_shared<DrumBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        DrumSettings s;
        s.kickTuneHz = plainOf(kKickTune);
        s.snareSnap = plainOf(kSnareSnap) / 100.0;
        s.tomsDamp = plainOf(kTomsDamp) / 100.0;
        s.air = plainOf(kOverheadAir) / 100.0;
        s.roomBlend = plainOf(kRoomBlend) / 100.0;
        s.roomComp = plainOf(kRoomComp) / 100.0;
        s.shellsDb = plainOf(kShellsLevel);
        s.cymbalDb = plainOf(kCymbalLevel);
        s.hatFoot = plainOf(kHatFoot) / 100.0;
        s.busComp = plainOf(kBusComp) / 100.0;
        s.tape = plainOf(kTape) / 100.0;
        s.roomWarm = plainOf(kRoomWarm) / 100.0;
        s.smooth = plainOf(kSmooth) / 100.0;
        s.volumeDb = plainOf(kVolume);
        s.closeDb = plainOf(kCloseLevel);
        s.ambDb = plainOf(kAmbLevel);
        s.shellBody = plainOf(kShellBody) / 100.0;
        s.shellPunch = plainOf(kShellPunch) / 100.0;
        s.snareBody = plainOf(kSnareBody) / 100.0;
        s.tomsBody = plainOf(kTomsBody) / 100.0;
        s.snareTuneHz = plainOf(kSnareTune);
        s.tomsTuneCents = plainOf(kTomsTune);
        s.bypass = boolOf(kBypass) || !licensed();     // sin licencia: silencio con fundido
        engine_.setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun
        engine_.setFx(fxp_);
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        if (data.processContext && (data.processContext->state & ProcessContext::kTempoValid)) engine_.setTempo(data.processContext->tempo);   // sync del delay del rack
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
            if (at > pos) { engine_.render(oL + pos, oR + pos, at - pos, dbus_.get()); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                dbus_->velocidadMidi.update(e.noteOn.velocity);
            } else if (e.type == Event::kLegacyMIDICCOutEvent) {
                const auto& c = e.midiCCOut;
                if (c.controlNumber == kPitchBend) {   // 14 bit -> ±2 semitonos (afecta a los golpes siguientes)
                    const int v14 = (static_cast<int>(c.value2) << 7) | static_cast<int>(c.value);
                    engine_.setBend((v14 - 8192) / 8192.0 * 2.0);
                } else if (c.controlNumber == 4) engine_.setHatFoot(c.value / 127.0);                       // pedal de hi-hat
                else if (c.controlNumber == kCtrlAllNotesOff || c.controlNumber == kCtrlAllSoundsOff) engine_.allNotesOff();
            }
        }
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, dbus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return fxp_.algunoActivo() ? kInfiniteTail : static_cast<uint32>(sr_ * 6.0); }   // el rack (reverb/delay) alarga la cola

private:
    WorshipDrumsEngine engine_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<DrumBus> dbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"WORSHIP DRUMS"; }
    const wchar_t* subtitle() const override { return L"BATERÍA ACÚSTICA MODAL · SALA WORSHIP & AIRE DE PLATOS"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"AFINACIÓN · PARCHES · SALA");
        P::principal(c, 0, kKickTune, L"KICK TUNE");
        P::principal(c, 1, kSnareSnap, L"SNARE SNAP");
        P::principal(c, 2, kTomsDamp, L"TOMS DAMP");
        P::secundaria(c, 0, kOverheadAir, L"OVERHEAD AIR");
        P::secundaria(c, 1, kRoomBlend, L"ROOM BLEND");
        P::secundaria(c, 2, kRoomComp, L"ROOM COMP");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaSalida(c, 0, kShellsLevel, L"PARCHES");
        P::perillaSalida(c, 1, kCymbalLevel, L"PLATOS");
        P::perillaSalida(c, 2, kHatFoot, L"HAT PEDAL");
        P::medidores(c, meters_);
        P::paginaMixFx(c);   // pagina «MIX / FX» comun (EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura): SIEMPRE lo ultimo de build()
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<DrumBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        const float caida = std::exp(-c.dt * 6.0f);
        for (int p = 0; p < kNumPads; ++p) {
            const float h = bus_->pad[p].exchange(0.0f, std::memory_order_relaxed);
            pads_[static_cast<size_t>(p)] = h > 0.0f ? std::max(0.35f, h) : pads_[static_cast<size_t>(p)] * caida;
        }
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
        P::panelVisual(g, L"ESPECTRO OUT · KIT");
        meters_.drawLabels(g);
        espectro_.dibujar(g, { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 112.0f });
        drawKit(g, rectKit());
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
        P::lectura(g, 0, 1, L"MAPA", L"GM");
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.worship-drums"; }

    // Pads tocables: clic = golpe (más fuerte cuanto más cerca del centro del parche); Shift en HAT = abierto,
    // en RIDE = campana. Las notas entran por la cola de la UI del bus, como el teclado de los instrumentos.
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        const int p = padEn(e.x, e.y);
        if (p < 0) return false;
        auto bus = std::dynamic_pointer_cast<DrumBus>(c.params.bus());
        if (!bus) return false;
        const int nota = notaDePad(p, e.shift);
        bus->notasUi.push(nota, velocidadEnPad(p, e.x, e.y));
        bus->notasUi.push(nota, 0.0f);   // la batería ignora el note-off; se envía por simetría con el teclado
        padPulsado_ = p;
        return true;
    }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext&) override { padPulsado_ = -1; }

private:
    static int notaDePad(int p, bool alt) {
        static const int notas[kNumPads] = { 36, 38, 41, 43, 45, 47, 48, 50, 42, 51, 49, 57, 55, 52 };
        if (p == 8 && alt) return 46;   // hi-hat abierto
        if (p == 9 && alt) return 53;   // campana del ride
        return notas[p];
    }
    static float radioPad(int p) { return p == 0 ? 20.0f : (p >= 8 ? 15.0f : 17.0f); }
    static JasWaveUI::Rect rectKit() {
        const JasWaveUI::Rect v = JasWaveUI::Plantilla::kVisual;
        return { v.l + 14.0f, v.b - 98.0f, v.r - 14.0f, v.b - 12.0f };
    }
    /** Pad bajo el cursor: la columna completa del pad (parche y nombre), o −1. */
    static int padEn(float x, float y) {
        const JasWaveUI::Rect r = rectKit();
        if (x < r.l || x >= r.r || y < r.t || y > r.b) return -1;
        const int p = static_cast<int>((x - r.l) / (r.w() / kNumPads));
        return p >= 0 && p < kNumPads ? p : -1;
    }
    static float velocidadEnPad(int p, float x, float y) {
        const JasWaveUI::Rect r = rectKit();
        const float w = r.w() / kNumPads;
        const float cx = r.l + w * (p + 0.5f), cy = r.t + 34.0f;
        const float d = std::sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / radioPad(p);
        return std::clamp(0.95f - 0.5f * d, 0.35f, 0.95f);
    }

    // Pads del kit: se iluminan con la velocidad del último golpe
    void drawKit(JasWaveUI::Gfx& g, const JasWaveUI::Rect& r) {
        using namespace JasWaveUI;
        static const wchar_t* const names[kNumPads] = { L"KICK", L"SNARE", L"T41", L"T43", L"T45", L"T47", L"T48", L"T50",
                                                       L"HAT", L"RIDE", L"CRASH", L"CR 2", L"SPLSH", L"CHINA" };
        const float w = r.w() / kNumPads;
        for (int p = 0; p < kNumPads; ++p) {
            const float cx = r.l + w * (p + 0.5f), cy = r.t + 34.0f;
            const float b = pads_[static_cast<size_t>(p)];
            const float rad = radioPad(p);
            g.circle(cx, cy, rad, p == padPulsado_ ? accent() : Pal::panelBorde, p == padPulsado_ ? 2.0f : 1.0f);
            if (b > 0.03f) { g.fillCircle(cx, cy, rad * (0.55f + 0.4f * b), accent().withAlpha(0.2f + 0.7f * b)); g.glowDot(cx, cy, 3.0f, accent()); }
            g.text(names[p], { cx - w * 0.5f, r.b - 20.0f, cx + w * 0.5f, r.b - 4.0f }, Font::Label, Pal::textoTenue, Align::Center, true);
        }
    }

    static constexpr int kHist = 240;
    std::shared_ptr<DrumBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    std::array<float, kNumPads> pads_{};
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, maxVoices_{kPolyphony}, histPos_{0};
    int padPulsado_{-1};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kKickTune, 76.0 }, { kRoomBlend, 45.0 }, { kOverheadAir, 55.0 } }; }
protected:
    int midiCcParam(int cc) const override { return cc == 4 ? static_cast<int>(kHatFoot) : -1; }   // CC4 = pedal de hi-hat
};

} // namespace JasWaveWorshipDrums

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveWorshipDrums::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Worship Drums",
               Vst::kDistributable, Vst::PlugType::kInstrumentDrum, "1.0.0", kVstVersionString, JasWaveWorshipDrums::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveWorshipDrums::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Worship Drums Controller", 0, "", "1.0.0", kVstVersionString, JasWaveWorshipDrums::Controller::createInstance)
END_FACTORY
