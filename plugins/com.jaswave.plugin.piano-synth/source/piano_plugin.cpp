// JasWave Piano Synth – VST3 instrumento (procesador, controlador, editor Cyber con teclado y voces)
#include "piano_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"

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
            if (e.type == Event::kNoteOnEvent) engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
            else if (e.type == Event::kNoteOffEvent) engine_.noteOff(e.noteOff.pitch);
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
    void build(JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        c.section({ 666, 92, 1048, 404 }, L"MARTILLO · CUERDA");
        c.knob(kBrightness, 742, 176, KnobSize::Main, L"BRILLO");
        c.knob(kHardness, 857, 176, KnobSize::Main, L"DUREZA");
        c.knob(kDecay, 972, 176, KnobSize::Main, L"DECAY");
        c.knob(kVelocity, 742, 304, KnobSize::Normal, L"VELOCIDAD");
        c.knob(kRelease, 857, 304, KnobSize::Normal, L"RELEASE");
        c.knob(kTune, 972, 304, KnobSize::Normal, L"LA4");
        c.section({ 666, 418, 1048, 556 }, L"SALIDA", kBypass, true);
        c.fader(kVolume, { 680, 440, 724, 552 }, L"VOLUMEN");
        c.knob(kStereo, 790, 482, KnobSize::Normal, L"ESTÉREO");
        c.toggle(kSustain, { 850, 470, 950, 496 }, L"SUSTAIN");
        meters_.build(c, 1000.0f, 446.0f, 528.0f);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<PianoBus>(c.params.bus());
        if (!bus_) return;
        static JasWaveDsp::PeakMeter none[2];
        meters_.update(none, bus_->outPk);
        an_.update(bus_->out, bus_->sampleRate.load(std::memory_order_relaxed));
        an_.columns(cols_, kCols, 25.0, 16000.0, 4.5);
        keys_[0] = bus_->keys[0].load(std::memory_order_relaxed);
        keys_[1] = bus_->keys[1].load(std::memory_order_relaxed);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        maxVoices_ = bus_->maxVoices.load(std::memory_order_relaxed);
        for (int k = 0; k < 128; ++k) {
            const bool on = k < 64 ? ((keys_[0] >> k) & 1) != 0 : ((keys_[1] >> (k - 64)) & 1) != 0;
            glow_[static_cast<size_t>(k)] = on ? 1.0f : glow_[static_cast<size_t>(k)] * 0.85f;
        }
        hist_[static_cast<size_t>(histPos_)] = static_cast<float>(voices_);
        histPos_ = (histPos_ + 1) % kHist;
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext&) override {
        using namespace JasWaveUI;
        const Rect v = Layout::kVisualizer;
        Kit::panel(g, v, L"ARMÓNICOS · TECLADO");
        g.text(L"OUT", { 1000, 532, 1040, 546 }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
        const Rect sp{ v.l + 14, v.t + 34, v.r - 14, v.t + 200 };
        if (cols_.size() == static_cast<size_t>(kCols)) {
            for (int i = 0; i < kCols; ++i)
                pts_[static_cast<size_t>(i)] = { sp.l + sp.w() * (i + 0.5f) / kCols, sp.b - std::clamp((cols_[static_cast<size_t>(i)] + 96.0f) / 90.0f, 0.0f, 1.0f) * sp.h() };
            Kit::wireTrace(g, pts_.data(), kCols, Pal::cian, sp.b, true);
        }
        // teclado de 88 teclas (A0..C8)
        const Rect kb{ v.l + 14, v.b - 90, v.r - 14, v.b - 14 };
        int whites = 0;
        for (int n = 21; n <= 108; ++n) if (!isBlack(n)) ++whites;
        const float ww = kb.w() / whites;
        int wi = 0;
        for (int n = 21; n <= 108; ++n) {
            if (isBlack(n)) continue;
            const Rect r{ kb.l + wi * ww + 0.6f, kb.t, kb.l + (wi + 1) * ww - 0.6f, kb.b };
            const float gl = glow_[static_cast<size_t>(n)];
            g.fillRect(r, gl > 0.02f ? Pal::cian.withAlpha(0.25f + 0.65f * gl) : hex(0x0F1E28));
            g.strokeRect(r, Pal::panelBorde, 0.8f);
            ++wi;
        }
        wi = 0;
        for (int n = 21; n <= 108; ++n) {
            if (!isBlack(n)) { ++wi; continue; }
            const float x = kb.l + wi * ww;
            const Rect r{ x - ww * 0.32f, kb.t, x + ww * 0.32f, kb.t + kb.h() * 0.6f };
            const float gl = glow_[static_cast<size_t>(n)];
            g.fillRect(r, gl > 0.02f ? Pal::cianNucleo.withAlpha(0.3f + 0.6f * gl) : hex(0x03080C));
            g.strokeRect(r, Pal::panelBorde, 0.8f);
        }
        for (int n = 21; n <= 108; ++n) if (glow_[static_cast<size_t>(n)] > 0.5f) {
            int w2 = 0;
            for (int m = 21; m < n; ++m) if (!isBlack(m)) ++w2;
            const float x = kb.l + w2 * ww + (isBlack(n) ? 0.0f : ww * 0.5f);
            g.glowDot(x, kb.t - 6.0f, 2.0f, Pal::cian);
        }
        // mini-panel: voces
        const Rect m = Layout::kMiniPanel;
        Kit::panel(g, m, L"POLIFONÍA");
        const Rect h{ m.l + 14, m.t + 34, m.r - 150, m.b - 12 };
        const float maxV = static_cast<float>(std::max(1, maxVoices_));
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - std::clamp(val / maxV, 0.0f, 1.0f) * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, Pal::cian, h.b, true);
        wchar_t buf[32];
        swprintf_s(buf, L"%d / %d", voices_, maxVoices_);
        Kit::readout(g, m.r - 130, m.t + 34, L"VOCES", buf);
        Kit::readout(g, m.r - 130, m.t + 72, L"POLIFONÍA", maxVoices_ >= kMaxVoices ? L"EXTENDIDA" : L"BÁSICA");
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.piano-synth"; }

private:
    static bool isBlack(int n) { const int p = n % 12; return p == 1 || p == 3 || p == 6 || p == 8 || p == 10; }
    static constexpr int kCols = 200;
    static constexpr int kHist = 240;
    std::shared_ptr<PianoBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveDsp::SpectrumAnalyzer an_;
    std::vector<float> cols_;
    std::array<JasWaveUI::Pt, kCols> pts_{};
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    std::array<float, 128> glow_{};
    uint64_t keys_[2] = {};
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
