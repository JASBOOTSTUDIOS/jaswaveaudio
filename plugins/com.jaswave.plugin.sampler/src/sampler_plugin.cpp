// JasWave Sampler – VST3 instrumento de muestras reales (procesador, controlador, editor Cyber y factoría)
#include "sampler_engine.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

#include <fstream>

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveSampler {

static const FUID kProcessorUid(0x4A617357, 0x53414D50, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x53414D50, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "sampler.biblioteca", "Biblioteca de instrumentos de muestras" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.sampler", "JasWave Sampler", L"SAMPLER", kFeatures, 1, true };

enum : uint32_t {
    kInstrument = 1, kVolume = 2, kHumanize = 3, kRelease = 4, kTune = 5, kReverb = 6,
    kAttack = 7, kSustain = 8, kPan = 9, kWidth = 10, kVelSens = 11, kEqLow = 12, kEqHigh = 13,
    kRevSize = 14, kRevDamp = 15, kRevPre = 16, kLoad = 40
};

// ---- catálogo de instrumentos: %LOCALAPPDATA%\JasWave\Instruments\index.txt  (nombre|ruta\relativa.jwi) ----
struct InstrumentList {
    std::vector<std::string> names, files;
    std::vector<const char*> labels;
};
inline const InstrumentList& instrumentList() {
    static const InstrumentList list = [] {
        InstrumentList l;
        std::string base;
        if (const char* la = std::getenv("LOCALAPPDATA")) base = std::string(la) + "\\JasWave\\Instruments\\";
        std::ifstream f(base + "index.txt");
        std::string ln;
        while (f && std::getline(f, ln)) {
            ln = trim(ln);
            if (ln.empty() || ln[0] == '#') continue;
            const size_t bar = ln.find('|');
            if (bar == std::string::npos) continue;
            l.names.push_back(trim(ln.substr(0, bar)));
            l.files.push_back(base + trim(ln.substr(bar + 1)));
            if (l.names.size() >= 63) break;
        }
        if (l.names.empty()) { l.names.push_back("(sin instrumentos instalados)"); l.files.push_back(""); }
        for (const auto& n : l.names) l.labels.push_back(n.c_str());
        return l;
    }();
    return list;
}

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        const InstrumentList& il = instrumentList();
        std::vector<ParamDef> v;
        v.push_back(stepP(kInstrument, "Instrument", static_cast<int>(il.names.size()) - 1, 0, il.labels.data()));
        v.push_back(linearP(kVolume, "Volume", "dB", -30.0, 12.0, 0.0, 1));
        v.push_back(linearP(kHumanize, "Humanize", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(linearP(kRelease, "Release", "%", 10.0, 600.0, 100.0, 0));
        v.push_back(linearP(kTune, "Tune", "cents", -100.0, 100.0, 0.0, 0, true));
        v.push_back(linearP(kReverb, "Reverb Mix", "%", 0.0, 100.0, 12.0, 0));
        v.push_back(linearP(kAttack, "Attack", "ms", 0.0, 3000.0, 0.0, 0));
        v.push_back(linearP(kSustain, "Sustain", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kPan, "Pan", "%", -100.0, 100.0, 0.0, 0, true));
        v.push_back(linearP(kWidth, "Width", "%", 0.0, 200.0, 100.0, 0));
        v.push_back(linearP(kVelSens, "Velocity Sens", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kEqLow, "EQ Low", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kEqHigh, "EQ High", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kRevSize, "Reverb Size", "s", 0.4, 9.0, 1.8, 1));
        v.push_back(linearP(kRevDamp, "Reverb Tone", "%", 0.0, 95.0, 45.0, 0));
        v.push_back(linearP(kRevPre, "Reverb Pre-delay", "ms", 0.0, 120.0, 18.0, 0));
        v.push_back(asReadOnly(linearP(kLoad, "Load", "%", 0.0, 100.0, 0.0, 0)));
        return v;
    }();
    return defs;
}

// ---- presets de fábrica (estilos de interpretación y espacio) ----
struct Preset {
    const wchar_t* name;
    double attack, release, sustain, humanize, reverb, size, tone, pre, low, high, width, velSens;
};
static const Preset kPresets[] = {
    { L"NATURAL",           0,   100,  0,  40, 12, 1.8, 45, 18,  0,  0, 100, 50 },
    { L"CÁLIDO Y LARGO",    12,  180, 35,  45, 22, 2.8, 55, 22,  2, -2, 105, 50 },
    { L"WORSHIP HALL",      25,  220, 50,  50, 32, 4.2, 50, 28,  1, -1, 115, 45 },
    { L"AMBIENTE AMPLIO",   220, 320, 70,  55, 42, 5.5, 60, 34,  1, -3, 140, 40 },
    { L"ÍNTIMO SECO",       0,   60,  0,   30, 6,  1.2, 40, 8,   0,  0,  90, 60 },
    { L"BRILLANTE",         0,   90,  10,  35, 18, 2.2, 38, 16, -1,  3, 110, 55 },
    { L"SUAVE (SWELL)",     450, 280, 60,  40, 30, 4.0, 55, 30,  0, -2, 120, 25 },
    { L"SOSTENIDO",         0,   140, 85,  45, 24, 3.0, 50, 22,  1, -1, 110, 50 },
};
constexpr int kNumPresets = static_cast<int>(sizeof(kPresets) / sizeof(kPresets[0]));

struct SamplerBus : JasWaveDsp::MeterBusBase {
    JasWaveDsp::PeakMeter outPk[2];
    std::atomic<int> activeVoices{0}, loadState{0}, loadProgress{0};
    std::atomic<uint64_t> keys[2]{};
};

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(sbus_ = std::make_shared<SamplerBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override {
        engine_.setPaths(instrumentList().files);
        engine_.prepare(sr);
        tmpL_.assign(static_cast<size_t>(maxBlock), 0.0f);
        tmpR_.assign(static_cast<size_t>(maxBlock), 0.0f);
    }
    void resetDsp() override { engine_.allNotesOff(); }
    void updateParams() override {
        engine_.setInstrumentIndex(intOf(kInstrument));
        engine_.setVolumeDb(static_cast<float>(plainOf(kVolume)));
        engine_.setHumanize(static_cast<float>(plainOf(kHumanize) / 100.0));
        engine_.setReleaseScale(static_cast<float>(plainOf(kRelease) / 100.0));
        engine_.setTuneCents(static_cast<float>(plainOf(kTune)));
        engine_.setAttackMs(static_cast<float>(plainOf(kAttack)));
        engine_.setSustain(static_cast<float>(plainOf(kSustain) / 100.0));
        engine_.setPan(static_cast<float>(plainOf(kPan) / 100.0));
        engine_.setWidth(static_cast<float>(plainOf(kWidth) / 100.0));
        engine_.setVelSens(static_cast<float>(plainOf(kVelSens) / 100.0));
        engine_.setEq(static_cast<float>(plainOf(kEqLow)), static_cast<float>(plainOf(kEqHigh)));
        engine_.setReverb(static_cast<float>(plainOf(kReverb) / 100.0), static_cast<float>(plainOf(kRevSize)),
                          static_cast<float>(plainOf(kRevDamp) / 100.0), static_cast<float>(plainOf(kRevPre)));
        licTarget_ = licensed() ? 1.0f : 0.0f;
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        if (offset == 0 && data.processContext) {
            const bool playing = (data.processContext->state & ProcessContext::kPlaying) != 0;
            if (wasPlaying_ && !playing) engine_.allNotesOff();
            wasPlaying_ = playing;
        }
        float* L = tmpL_.data();
        float* R = tmpR_.data();
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
            if (at > pos) { engine_.render(L + pos, R + pos, at - pos); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                float v = e.noteOn.velocity;
                if (v <= 0.f) engine_.noteOff(e.noteOn.pitch, 0);
                else {
                    const float vn = v > 1.f ? v / 127.f : v;
                    engine_.noteOn(e.noteOn.pitch, vn, 0);
                    sbus_->velocidadMidi.update(vn);
                }
            } else if (e.type == Event::kNoteOffEvent) {
                engine_.noteOff(e.noteOff.pitch, 0);
            } else if (e.type == Event::kLegacyMIDICCOutEvent) {
                if (e.midiCCOut.controlNumber == 64) engine_.sustainPedal(e.midiCCOut.value >= 64);
                else if (e.midiCCOut.controlNumber == 123 || e.midiCCOut.controlNumber == 120) engine_.allNotesOff();
            }
        }
        if (pos < n) engine_.render(L + pos, R + pos, n - pos);
        float pk[2] = { 0, 0 };
        for (int i = 0; i < n; ++i) {
            licGain_ += (licTarget_ - licGain_) * 0.002f;
            if (std::fabs(licGain_ - licTarget_) < 1e-5f) licGain_ = licTarget_;
            oL[i] = static_cast<T>(L[i] * licGain_);
            oR[i] = static_cast<T>(R[i] * licGain_);
            pk[0] = std::max(pk[0], std::fabs(L[i] * licGain_));
            pk[1] = std::max(pk[1], std::fabs(R[i] * licGain_));
        }
        sbus_->salida(oL, oR, n);
        sbus_->outPk[0].update(pk[0]);
        sbus_->outPk[1].update(pk[1]);
        uint64_t k0 = 0, k1 = 0;
        for (const auto& v : engine_.voices()) {
            if (!v.active || v.note < 0 || v.note > 127) continue;
            if (v.note < 64) k0 |= 1ull << v.note; else k1 |= 1ull << (v.note - 64);
        }
        sbus_->keys[0].store(k0, std::memory_order_relaxed);
        sbus_->keys[1].store(k1, std::memory_order_relaxed);
        sbus_->activeVoices.store(engine_.activeVoices(), std::memory_order_relaxed);
        sbus_->loadState.store(engine_.loadState(), std::memory_order_relaxed);
        sbus_->loadProgress.store(engine_.loadProgress(), std::memory_order_relaxed);
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 8.0); }
    void writeOutputParams(ProcessData& data) override {
        const int st = engine_.loadState();
        const double p = st == 2 ? 1.0 : st == 1 ? engine_.loadProgress() / 100.0 * 0.99 : 0.0;
        writeOutputParam(data, kLoad, p);
    }

private:
    SamplerEngine engine_;
    std::shared_ptr<SamplerBus> sbus_;
    std::vector<float> tmpL_, tmpR_;
    float licGain_{0.0f}, licTarget_{0.0f};
    bool wasPlaying_{false};
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"SAMPLER"; }
    const wchar_t* subtitle() const override { return L"MUESTRAS REALES · HUMANIZACIÓN · ROUND-ROBIN · PRESETS"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoLila; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        ctx_ = &c;
        P::controles(c, L"ENVOLVENTE · TONO");
        P::principal(c, 0, kAttack, L"ATAQUE");
        P::principal(c, 1, kRelease, L"RELEASE");
        P::principal(c, 2, kSustain, L"SUSTAIN");
        P::secundaria(c, 0, kEqLow, L"GRAVES");
        P::secundaria(c, 1, kEqHigh, L"AGUDOS");
        P::secundaria(c, 2, kHumanize, L"HUMANIZAR");
        const JasWaveUI::Rect r = P::filaSecundaria(0, 3);
        c.dropdown(kInstrument, { r.l, r.t + 54.0f, r.r, r.b + 52.0f }, L"INSTRUMENTO");
        const float bx = P::kColX[0] - 52.0f, by = 378.0f;
        c.button({ bx, by, bx + 40, by + 20 }, L"◀", [this] { stepPreset(-1); });
        c.button({ bx + 46, by, bx + 90, by + 20 }, L"▶", [this] { stepPreset(1); });
        c.button({ bx + 96, by, bx + 290, by + 20 }, L"APLICAR PRESET", [this] { applyPreset(preset_); });
        P::salida(c, -1, L"SALIDA · ESPACIO");
        P::fader(c, kVolume, L"NIVEL");
        P::perillaPequena(c, 0, 0, kReverb, L"REVERB");
        P::perillaPequena(c, 1, 0, kRevSize, L"TAMAÑO");
        P::perillaPequena(c, 2, 0, kRevDamp, L"TONO");
        P::perillaPequena(c, 0, 1, kPan, L"PAN");
        P::perillaPequena(c, 1, 1, kWidth, L"ANCHO");
        P::perillaPequena(c, 2, 1, kVelSens, L"SENS.");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<SamplerBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        state_ = bus_->loadState.load(std::memory_order_relaxed);
        progress_ = bus_->loadProgress.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        const Rect v = P::kVisual;
        P::panelVisual(g, L"ESPECTRO OUT · NOTAS ACTIVAS");
        meters_.drawLabels(g);
        espectro_.dibujar(g, { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 112.0f });
        teclado_.dibujar(g, { v.l + 14.0f, v.b - 84.0f, v.r - 14.0f, v.b - 14.0f }, ac);
        P::panelMedicion(g, L"BIBLIOTECA · PRESET");
        const Rect m = P::kMini;
        const int idx = static_cast<int>(std::lround(c.params.plain(kInstrument)));
        const InstrumentList& il = instrumentList();
        const std::string& nm = il.names[static_cast<size_t>(std::clamp(idx, 0, static_cast<int>(il.names.size()) - 1))];
        std::wstring wn(nm.begin(), nm.end());
        g.text(wn, { m.l + 16, m.t + 34, m.r - 16, m.t + 58 }, Font::Value, Pal::textoValor, Align::Left);
        wchar_t buf[96];
        if (state_ == 1) swprintf_s(buf, L"CARGANDO MUESTRAS…  %d %%", progress_);
        else if (state_ == 2) swprintf_s(buf, L"LISTO  ·  VOCES ACTIVAS  %d", voices_);
        else if (state_ == 3) swprintf_s(buf, L"ERROR AL CARGAR EL INSTRUMENTO");
        else swprintf_s(buf, L"SIN CARGAR");
        g.text(buf, { m.l + 16, m.t + 62, m.r - 16, m.t + 82 }, Font::ValueSmall, state_ == 3 ? Pal::alerta : ac, Align::Left);
        swprintf_s(buf, L"PRESET  %d/%d  ·  %s", preset_ + 1, kNumPresets, kPresets[preset_].name);
        g.text(buf, { m.l + 16, m.t + 90, m.r - 16, m.t + 112 }, Font::ValueSmall, Pal::textoValor, Align::Left);
        if (state_ == 1) {
            const Rect b{ m.l + 16, m.t + 118, m.r - 16, m.t + 126 };
            g.fillRect(b, hex(0x03030F));
            g.fillRect({ b.l, b.t, b.l + b.w() * progress_ / 100.0f, b.b }, ac.withAlpha(0.8f));
        }
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.sampler"; }

private:
    void stepPreset(int d) { preset_ = (preset_ + d + kNumPresets) % kNumPresets; applyPreset(preset_); }
    void set(uint32_t id, double plain) {
        if (!ctx_) return;
        if (const ParamDef* d = ctx_->params.def(id)) ctx_->params.setNorm(id, toNorm(*d, plain));
    }
    void applyPreset(int i) {
        const Preset& p = kPresets[i];
        set(kAttack, p.attack); set(kRelease, p.release); set(kSustain, p.sustain); set(kHumanize, p.humanize);
        set(kReverb, p.reverb); set(kRevSize, p.size); set(kRevDamp, p.tone); set(kRevPre, p.pre);
        set(kEqLow, p.low); set(kEqHigh, p.high); set(kWidth, p.width); set(kVelSens, p.velSens);
    }
    JasWaveUI::EditorContext* ctx_{nullptr};
    std::shared_ptr<SamplerBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    int voices_{0}, state_{0}, progress_{0}, preset_{0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kHumanize, 45.0 }, { kReverb, 30.0 }, { kRevSize, 4.0 }, { kSustain, 40.0 } }; }
};

} // namespace JasWaveSampler

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveSampler::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Sampler",
               Vst::kDistributable, Vst::PlugType::kInstrumentSampler, "1.0.0", kVstVersionString, JasWaveSampler::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveSampler::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Sampler Controller", 0, "", "1.0.0", kVstVersionString, JasWaveSampler::Controller::createInstance)
END_FACTORY
