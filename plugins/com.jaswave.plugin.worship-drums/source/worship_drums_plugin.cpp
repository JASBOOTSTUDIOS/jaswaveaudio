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
    void resetDsp() override { engine_.reset(); engine_.kits().refresh(); }   // al activar: vuelve a leer la carpeta de kits (kits instalados desde la ultima vez)
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
        s.percDb = plainOf(kPercLevel);
        s.kitIndex = static_cast<int>(std::lround(plainOf(kKit)));
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
    // El kit se guarda tambien por nombre (slug): el orden de la lista de kits puede cambiar al instalar o quitar kits
    std::string saveExtraState() override { const std::string k = engine_.kitSlug(); return k.empty() ? std::string() : "kit=" + k; }
    void loadExtraState(const std::string& ex) override { if (ex.rfind("kit=", 0) == 0) engine_.setKitSlug(ex.substr(4)); }
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
        // v4: selector de kit (nombre del kit instalado) y nivel de la percusion auxiliar, bajo las perillas de la seccion de controles
        c.dropdown(kKit, { 704.0f, 368.0f, 880.0f, 392.0f }, L"KIT");
        c.knob(kPercLevel, 914.0f, 363.0f, JasWaveUI::KnobSize::Small, L"PERC");
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
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Rect v = P::kVisual;
        P::panelVisual(g, L"ESPECTRO OUT · KIT");
        meters_.drawLabels(g);
        espectro_.dibujar(g, { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 166.0f });
        drawPiezas(g, c);
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
        drawEstadoKit(g, c);
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
    static std::wstring ancho(const std::string& u8) {
        if (u8.empty()) return {};
        const int n = MultiByteToWideChar(CP_UTF8, 0, u8.data(), static_cast<int>(u8.size()), nullptr, 0);
        std::wstring w(static_cast<size_t>(std::max(0, n)), L'\0');
        if (n > 0) MultiByteToWideChar(CP_UTF8, 0, u8.data(), static_cast<int>(u8.size()), &w[0], n);
        return w;
    }
    // Piezas del kit (fila 1) y percusion auxiliar (fila 2): encendidas = hay muestra real (kit cargado o banco de percusion);
    // las piezas del kit apagadas suenan con el modelo fisico; la percusion apagada no suena
    void drawPiezas(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) {
        using namespace JasWaveUI;
        if (!bus_) return;
        struct Chip { const wchar_t* t; int notas[6]; };
        static const Chip fila1[14] = {
            { L"KICK", { 35, 36, -1 } }, { L"SNARE", { 38, -1 } }, { L"SIDE", { 37, -1 } }, { L"RIM", { 40, -1 } },
            { L"TOMS", { 41, 43, 45, 47, 48, 50 } }, { L"HAT", { 42, 44, 46, -1 } }, { L"PEDAL", { 44, -1 } }, { L"OPEN", { 46, -1 } },
            { L"RIDE", { 51, 59, -1 } }, { L"R.BELL", { 53, -1 } }, { L"CRASH", { 49, 57, -1 } }, { L"C.BELL", { 78, -1 } },
            { L"SPLSH", { 55, -1 } }, { L"CHINA", { 52, -1 } } };
        static const Chip fila2[14] = {
            { L"CLAPS", { 39, -1 } }, { L"TAMB", { 54, -1 } }, { L"COWBL", { 56, -1 } }, { L"VIBSL", { 58, -1 } },
            { L"BONGO", { 60, 61, -1 } }, { L"CONGA", { 62, 63, 64, -1 } }, { L"TIMBL", { 65, 66, -1 } }, { L"AGOGO", { 67, 68, -1 } },
            { L"CABAS", { 69, -1 } }, { L"SHAKR", { 70, 82, -1 } }, { L"GUIRO", { 73, 74, -1 } }, { L"CLAVE", { 75, -1 } },
            { L"WOOD", { 76, 77, -1 } }, { L"TRIAN", { 80, 81, -1 } } };
        const auto kits = std::atomic_load(&bus_->kits);
        const int sel = static_cast<int>(std::lround(c.params.plain(kKit)));
        const int act = bus_->kitActivo.load(std::memory_order_relaxed);
        const bool previa = kits && sel != act && sel >= 0 && sel < static_cast<int>(kits->kits.size());   // kit elegido que todavia carga: vista previa por kit.json
        auto tiene = [&](int nota) {
            const uint64_t bit = uint64_t(1) << (nota & 63);
            const int w = nota >> 6;
            if (bus_->maskPerc[w].load(std::memory_order_relaxed) & bit) return true;
            if (previa) return kits->tieneNota(static_cast<size_t>(sel), nota);
            return (bus_->maskKit[w].load(std::memory_order_relaxed) & bit) != 0;
        };
        const Rect v = Plantilla::kVisual;
        const float w = (v.r - v.l - 28.0f) / 14.0f;
        for (int fila = 0; fila < 2; ++fila) {
            const Chip* ch = fila == 0 ? fila1 : fila2;
            const float t = v.b - 146.0f + fila * 22.0f;
            for (int i = 0; i < 14; ++i) {
                bool on = false;
                for (int k = 0; k < 6 && ch[i].notas[k] >= 0; ++k) if (tiene(ch[i].notas[k])) on = true;
                const Rect r{ v.l + 14.0f + i * w + 1.0f, t, v.l + 14.0f + (i + 1) * w - 1.0f, t + 18.0f };
                if (on) g.fillRect(r, accent().withAlpha(0.20f));
                g.strokeRect(r, on ? accent().withAlpha(0.8f) : Pal::panelBorde, 1.0f);
                g.text(ch[i].t, r, Font::Label, on ? accent() : (fila == 0 ? Pal::textoTenue : Pal::textoTenue.withAlpha(0.45f)), Align::Center);
            }
        }
        // cabecera: kit activo y estilo
        std::wstring cab = L"SIN BANCO \u00B7 MOTOR MODELADO";
        if (kits && act >= 0 && act < static_cast<int>(kits->kits.size())) {
            const KitInfo& k = kits->kits[static_cast<size_t>(act)];
            cab = ancho(k.nombre) + (k.estilo.empty() ? L"" : L" \u00B7 " + ancho(k.estilo));
        }
        g.text(cab, { v.l + 230.0f, v.t + 10.0f, v.r - 14.0f, v.t + 28.0f }, Font::Label, Pal::textoTenue, Align::Right);
    }
    void drawEstadoKit(JasWaveUI::Gfx& g, JasWaveUI::EditorContext&) {
        namespace P = JasWaveUI::Plantilla;
        if (!bus_) return;
        const auto kits = std::atomic_load(&bus_->kits);
        const int act = bus_->kitActivo.load(std::memory_order_relaxed);
        const bool hay = kits && act >= 0 && act < static_cast<int>(kits->kits.size());
        std::wstring nombre = hay ? ancho(kits->kits[static_cast<size_t>(act)].nombre) : std::wstring(L"MODELADO");
        if (nombre.size() > 11) nombre = nombre.substr(0, 10) + L"\u2026";
        P::lectura(g, 1, 0, L"KIT", nombre.c_str(), accent());
        static const wchar_t* const est[] = { L"MODELADO", L"CARGANDO", L"OK", L"NO EXISTE", L"ERROR" };
        const int e = std::clamp(bus_->kitEstado.load(std::memory_order_relaxed), 0, 4);
        wchar_t buf[40];
        if (e == 2 && hay) swprintf_s(buf, L"OK %.0f MB", kits->kits[static_cast<size_t>(act)].tamanoMB);
        else swprintf_s(buf, L"%s", est[e]);
        P::lectura(g, 1, 1, L"BANCO", buf);
    }

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
