// JasWave Vocal Choir – VST3 (procesador con eventos MIDI de entrada, controlador, editor Cyber con los 4 puestos del coro)
#include "vocal_choir_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveVocalChoir {

static const FUID kProcessorUid(0x4A617357, 0x56434852, 0x50726F63, 0x56335431);   // "JasW" "VCHR" "Proc" "V3T1"
static const FUID kControllerUid(0x4A617357, 0x56434852, 0x436E7472, 0x56335431);  // "JasW" "VCHR" "Cntr" "V3T1"

// Efecto con entrada de eventos: audio estéreo de entrada (fuente vocal) + MIDI de entrada (las notas del coro).
// El host de JasWave enruta las notas a cualquier ranura con bus de eventos, también a pistas de instrumento
// (donde la entrada de audio llega en silencio y se usa la fuente interna).
static const PluginDescriptor kDesc{ "com.jaswave.plugin.vocal-choir", "JasWave Vocal Choir", L"VOCAL CHOIR", nullptr, 0, false, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(cbus_ = std::make_shared<ChoirBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); nEv_ = 0; }
    void updateParams() override {
        ChoirSettings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.voices = intOf(kVoices) + 1;
        s.spread = plainOf(kSpread) / 100.0;
        s.formantSt = plainOf(kFormant);
        s.throatPct = plainOf(kThroat);
        s.source = intOf(kSource);
        s.vowel = intOf(kVowel);
        s.range = intOf(kRange);
        s.attackMs = plainOf(kAttack);
        s.releaseMs = plainOf(kRelease);
        s.vibCents = plainOf(kVibDepth);
        s.vibHz = plainOf(kVibRate);
        s.humanize = plainOf(kHumanize) / 100.0;
        s.detuneCents = plainOf(kDetune);
        s.glideMs = plainOf(kGlide);
        s.levelDb = plainOf(kLevel);
        s.original = plainOf(kOriginal) / 100.0;
        engine_.setSettings(s);
    }

    // ---- MIDI: se copian los eventos del bloque y se aplican con precisión de muestra en render() ----
    struct Ev { int32 offset; uint8 tipo; int16 a; float b; };   // tipo: 0 on, 1 off, 2 pedal, 3 todo off
    static constexpr int kMaxEv = 256;
    void processEvents(ProcessData& data) override {
        nEv_ = 0;
        IEventList* in = data.inputEvents;
        if (!in) return;
        const int32 n = in->getEventCount();
        for (int32 i = 0; i < n && nEv_ < kMaxEv; ++i) {
            Event e{};
            if (in->getEvent(i, e) != kResultOk) continue;
            Ev x{ e.sampleOffset, 255, 0, 0.0f };
            if (e.type == Event::kNoteOnEvent) { x.tipo = e.noteOn.velocity > 0.0f ? 0 : 1; x.a = e.noteOn.pitch; x.b = e.noteOn.velocity; }
            else if (e.type == Event::kNoteOffEvent) { x.tipo = 1; x.a = e.noteOff.pitch; }
            else if (e.type == Event::kLegacyMIDICCOutEvent) {
                const int cc = e.midiCCOut.controlNumber;
                if (cc == 64) { x.tipo = 2; x.b = e.midiCCOut.value >= 64 ? 1.0f : 0.0f; }
                else if (cc == 123 || cc == 120) x.tipo = 3;
            }
            if (x.tipo == 255) continue;
            // inserción ordenada por offset (estable)
            int k = nEv_++;
            while (k > 0 && ev_[static_cast<size_t>(k - 1)].offset > x.offset) { ev_[static_cast<size_t>(k)] = ev_[static_cast<size_t>(k - 1)]; --k; }
            ev_[static_cast<size_t>(k)] = x;
        }
    }
    template <class T>
    void renderT(const T* iL, const T* iR, T* oL, T* oR, int n, int offset) {
        int pos = 0;
        while (pos < n) {
            // aplica los eventos cuyo offset ya llegó; el siguiente evento parte el tramo
            while (nextEv_ < nEv_ && ev_[static_cast<size_t>(nextEv_)].offset <= offset + pos) aplicar(ev_[static_cast<size_t>(nextEv_++)]);
            int fin = n;
            if (nextEv_ < nEv_) fin = std::min(n, ev_[static_cast<size_t>(nextEv_)].offset - offset);
            if (fin <= pos) fin = pos + 1;
            engine_.process(iL + pos, iR + pos, oL + pos, oR + pos, fin - pos, cbus_.get());
            pos = fin;
        }
    }
    void aplicar(const Ev& e) {
        switch (e.tipo) {
            case 0: engine_.noteOn(e.a, e.b); break;
            case 1: engine_.noteOff(e.a); break;
            case 2: engine_.pedal(e.b >= 0.5f); break;
            default: engine_.allNotesOff(); break;
        }
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int offset, ProcessData&) override { renderT(iL, iR, oL, oR, n, offset); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int offset, ProcessData&) override { renderT(iL, iR, oL, oR, n, offset); }

    uint32 latencySamples() override { return static_cast<uint32>(latencyFor(sr_)); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 3.0); }
    void writeOutputParams(ProcessData& data) override {
        writeOutputParam(data, kPitchMeter, engine_.sourceHz() / 2000.0);
        writeOutputParam(data, kVoicesMeter, engine_.activeVoices() / 4.0);
    }

public:
    tresult PLUGIN_API process(ProcessData& data) SMTG_OVERRIDE {
        nextEv_ = 0;
        return JwProcessor::process(data);
    }

private:
    VocalChoirEngine engine_;
    std::shared_ptr<ChoirBus> cbus_;
    std::array<Ev, kMaxEv> ev_{};
    int nEv_{0}, nextEv_{0};
};

// ---------------------------------------------------------------------------------
inline std::wstring nombreNotaMidi(int n) {
    static const wchar_t* const k[] = { L"C", L"C#", L"D", L"D#", L"E", L"F", L"F#", L"G", L"G#", L"A", L"A#", L"B" };
    wchar_t b[16];
    swprintf_s(b, L"%s%d", k[((n % 12) + 12) % 12], n / 12 - 1);
    return b;
}

class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"VOCAL CHOIR"; }
    const wchar_t* subtitle() const override { return L"CORO MIDI · PSOLA CON FORMANTES · 4 VOCES"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoLila; }
    const char* visualizer() const override { return "curva-tono"; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"CORO");
        P::principal(c, 0, kAttack, L"ATAQUE");
        P::principal(c, 1, kRelease, L"RELEASE");
        P::principal(c, 2, kSpread, L"SPREAD");
        P::secundaria(c, 0, kFormant, L"FORMANTES");
        P::secundaria(c, 1, kThroat, L"GARGANTA");
        P::secundaria(c, 2, kVibDepth, L"VIBRATO");
        P::salida(c, kBypass, L"SALIDA · FUENTE");
        P::fader(c, kLevel, L"NIVEL");
        c.dropdown(kSource, P::celda(0, 0), L"FUENTE");
        c.dropdown(kVowel, P::celda(1, 0), L"VOCAL");
        c.dropdown(kRange, P::celda(2, 0), L"TESITURA");
        c.dropdown(kVoices, P::celda(0, 1), L"VOCES");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<ChoirBus>(c.params.bus());
        if (!bus_) return;
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        for (int j = 0; j < kMaxVoices; ++j) {
            nota_[static_cast<size_t>(j)] = bus_->note[static_cast<size_t>(j)].load(std::memory_order_relaxed);
            const float l = bus_->level[static_cast<size_t>(j)].load(std::memory_order_relaxed);
            nivel_[static_cast<size_t>(j)] += (std::min(1.0f, l * 3.0f) - nivel_[static_cast<size_t>(j)]) * std::min(1.0f, c.dt * 12.0f);
            pan_[static_cast<size_t>(j)] = bus_->pan[static_cast<size_t>(j)].load(std::memory_order_relaxed);
        }
        activas_ = bus_->activeVoices.load(std::memory_order_relaxed);
        srcHz_ = bus_->sourceHz.load(std::memory_order_relaxed);
        latencia_ = bus_->latency.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        P::panelVisual(g, L"PUESTOS DEL CORO · NOTA, NIVEL Y PANORAMA");
        meters_.drawLabels(g);
        const Rect a = P::areaEspectro();
        const int nv = static_cast<int>(c.params.plain(kVoices) + 0.5) + 1;
        const float alto = a.h() / kMaxVoices;
        static const wchar_t* const rol[kMaxVoices] = { L"LEAD", L"2ª VOZ", L"3ª VOZ", L"BASE" };
        for (int j = 0; j < kMaxVoices; ++j) {
            const float y0 = a.t + j * alto, y1 = y0 + alto - 6.0f;
            const bool habilitada = j < nv;
            const Rect fila{ a.l, y0, a.r, y1 };
            g.strokeRect(fila, habilitada ? Pal::panelBorde : Pal::reticula, 1.0f);
            g.text(rol[j], { fila.l + 8.0f, fila.t + 2.0f, fila.l + 78.0f, fila.b - 2.0f }, Font::Label, habilitada ? Pal::textoEtiqueta : Pal::textoTenue, Align::Left, true);
            const int nota = nota_[static_cast<size_t>(j)];
            const bool suena = habilitada && nota >= 0;
            const std::wstring nombre = suena ? nombreNotaMidi(nota) : L"--";
            g.text(nombre.c_str(), { fila.l + 84.0f, fila.t, fila.l + 150.0f, fila.b }, Font::CodeBig, suena ? ac : Pal::textoTenue, Align::Center);
            // barra de nivel
            const Rect barra{ fila.l + 160.0f, fila.cy() - 5.0f, fila.r - 120.0f, fila.cy() + 5.0f };
            g.fillRect(barra, Pal::perillaPista);
            const float lv = suena ? nivel_[static_cast<size_t>(j)] : 0.0f;
            g.fillRect({ barra.l, barra.t + 1.0f, barra.l + barra.w() * std::clamp(lv, 0.0f, 1.0f), barra.b - 1.0f }, ac);
            // panorama (−1..+1)
            const Rect pb{ fila.r - 108.0f, fila.cy() - 3.0f, fila.r - 10.0f, fila.cy() + 3.0f };
            g.fillRect(pb, Pal::perillaPista);
            g.line(pb.cx(), pb.t - 5.0f, pb.cx(), pb.b + 5.0f, Pal::textoTenue, 1.0f);
            const float px = pb.cx() + std::clamp(pan_[static_cast<size_t>(j)], -1.0f, 1.0f) * pb.w() * 0.5f;
            g.glowDot(px, pb.cy(), 3.0f, habilitada ? ac : Pal::textoTenue);
        }
        P::panelMedicion(g, L"CORO · LECTURAS");
        wchar_t b1[32], b2[32], b3[32], b4[32];
        swprintf_s(b1, L"%d / %d", activas_, nv);
        if (srcHz_ > 0.0f) swprintf_s(b2, L"%.1f Hz", srcHz_); else swprintf_s(b2, L"--");
        swprintf_s(b3, L"%.0f %%", c.params.plain(kSpread));
        swprintf_s(b4, L"%.2f ms", sr_ > 0.0 ? latencia_ * 1000.0 / sr_ : 0.0);
        P::lectura(g, 0, 0, L"VOCES", b1, ac);
        P::lectura(g, 1, 0, L"FUENTE F0", b2);
        P::lectura(g, 0, 1, L"SPREAD", b3);
        P::lectura(g, 1, 1, L"LATENCIA", b4);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.vocal-choir"; }

private:
    std::shared_ptr<ChoirBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    std::array<int, kMaxVoices> nota_{ -1, -1, -1, -1 };
    std::array<float, kMaxVoices> nivel_{}, pan_{};
    int activas_{0}, latencia_{0};
    float srcHz_{0.0f};
    double sr_{48000.0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kVoices, 3.0 }, { kSpread, 80.0 }, { kVowel, 0.0 } }; }
    DemoSignal demoSignal() const override { return DemoSignal::Midi; }
};

} // namespace JasWaveVocalChoir

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveVocalChoir::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Vocal Choir",
               Vst::kDistributable, Vst::PlugType::kFxPitchShift, "1.0.0", kVstVersionString, JasWaveVocalChoir::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveVocalChoir::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Vocal Choir Controller", 0, "", "1.0.0", kVstVersionString, JasWaveVocalChoir::Controller::createInstance)
END_FACTORY
