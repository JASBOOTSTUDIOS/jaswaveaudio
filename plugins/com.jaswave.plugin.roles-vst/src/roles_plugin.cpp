// JasWave Roles – VST3 instrumento por roles musicales (procesador, controlador, editor Cyber y factoría)
#include "roles_engine.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveRoles {

// FUID estables del JasWave Roles previo (native/jaswave-roles-vst): no cambiar
static const FUID kProcessorUid(0x4A617357, 0x526F6C65, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x526F6C65, 0x436E7472, 0x56335431);

enum Feature : int { kFeatDrums = 0, kFeatFx = 1 };
static const FeatureDef kFeatures[] = {
    { "roles.bateria", "Roles de batería y percusión" },
    { "roles.efectos", "Efectos chorus, delay y reverb" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.roles-vst", "JasWave Roles", L"ROLES", kFeatures, 2, true };

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static const char* const kRoles[] = { "Bateria", "Bajo", "Guitarra", "Piano", "Teclas", "Pad", "Cuerdas", "Coro", "Lead", "Metales", "Synth", "Percusion", "Default" };
        std::vector<ParamDef> v;
        v.push_back(stepP(kParamRoleId, "Role", kNumRoles - 1, static_cast<int>(Role::Pad), kRoles));
        v.push_back(linearP(kParamAttackId, "Attack", "%", 0.0, 100.0, 35.0, 0));
        v.push_back(linearP(kParamReleaseId, "Release", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(linearP(kParamCutoffId, "Cutoff", "%", 0.0, 100.0, 55.0, 0));
        v.push_back(linearP(kParamResonanceId, "Resonance", "%", 0.0, 100.0, 25.0, 0));
        v.push_back(linearP(kParamGainId, "Gain", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(linearP(kParamVoicesId, "Voices", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kParamDriveId, "Drive", "%", 0.0, 100.0, 15.0, 0));
        v.push_back(linearP(kParamGateId, "Gate", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(withFeature(linearP(kParamChorusId, "Chorus", "%", 0.0, 100.0, 20.0, 0), kFeatFx));
        v.push_back(withFeature(linearP(kParamDelayId, "Delay", "%", 0.0, 100.0, 15.0, 0), kFeatFx));
        v.push_back(withFeature(linearP(kParamReverbId, "Reverb", "%", 0.0, 100.0, 25.0, 0), kFeatFx));
        v.push_back(linearP(kParamEqLowId, "EQ Low", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kParamEqHighId, "EQ High", "%", 0.0, 100.0, 50.0, 0));
        return v;
    }();
    return defs;
}

struct RolesBus : JasWaveDsp::MeterBusBase {
    JasWaveDsp::SpectrumTap out;
    JasWaveDsp::PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<int> role{static_cast<int>(Role::Pad)};
    std::atomic<uint64_t> keys[2]{};
};

// Estado previo: int32 rol + 13 dobles normalizados
static LegacyStateFn legacyRoles() {
    return [](IBStream* st, const ParamTable& t, std::vector<double>& n) {
        IBStreamer s(st, kLittleEndian);
        int32 role = 0;
        if (!s.readInt32(role)) return false;
        const int ri = t.index(kParamRoleId);
        if (ri >= 0) n[static_cast<size_t>(ri)] = static_cast<double>(std::clamp(role, 0, kNumRoles - 1)) / (kNumRoles - 1);
        for (int32 id = 1; id < kParamCount; ++id) {
            double v = 0.0;
            if (!s.readDouble(v)) break;
            const int i = t.index(static_cast<uint32_t>(id));
            if (i >= 0 && std::isfinite(v)) n[static_cast<size_t>(i)] = clamp01(v);
        }
        return true;
    };
}

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(rbus_ = std::make_shared<RolesBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override {
        engine_.prepare(sr);
        tmpL_.assign(static_cast<size_t>(maxBlock), 0.0f);
        tmpR_.assign(static_cast<size_t>(maxBlock), 0.0f);
    }
    void resetDsp() override { engine_.panicAll(); }
    void updateParams() override {
        int role = intOf(kParamRoleId);
        if ((role == static_cast<int>(Role::Drums) || role == static_cast<int>(Role::Percussion)) && !feature(kFeatDrums)) role = static_cast<int>(Role::Default);
        engine_.setRole(role);
        for (int32 id = 1; id < kParamCount; ++id) engine_.setNorm(id, static_cast<float>(plainOf(static_cast<ParamID>(id)) / 100.0));
        if (!feature(kFeatFx)) { engine_.setNorm(kParamChorusId, 0.f); engine_.setNorm(kParamDelayId, 0.f); engine_.setNorm(kParamReverbId, 0.f); }
        licTarget_ = licensed() ? 1.0f : 0.0f;
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
        if (offset == 0 && data.processContext) {
            const bool playing = (data.processContext->state & ProcessContext::kPlaying) != 0;
            if (wasPlaying_ && !playing) engine_.panicAll();   // stop del transporte: panic una vez
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
                else engine_.noteOn(e.noteOn.pitch, v > 1.f ? v / 127.f : v, 0);
            } else if (e.type == Event::kNoteOffEvent) {
                engine_.noteOff(e.noteOff.pitch, 0);
            }
        }
        if (pos < n) engine_.render(L + pos, R + pos, n - pos);
        // licencia: fundido a silencio sin clics
        float pk[2] = { 0, 0 };
        for (int i = 0; i < n; ++i) {
            licGain_ += (licTarget_ - licGain_) * 0.002f;
            if (std::fabs(licGain_ - licTarget_) < 1e-5f) licGain_ = licTarget_;
            oL[i] = static_cast<T>(L[i] * licGain_);
            oR[i] = static_cast<T>(R[i] * licGain_);
            pk[0] = std::max(pk[0], std::fabs(L[i] * licGain_));
            pk[1] = std::max(pk[1], std::fabs(R[i] * licGain_));
        }
        rbus_->out.pushT(oL, oR, n);
        rbus_->outPk[0].update(pk[0]);
        rbus_->outPk[1].update(pk[1]);
        uint64_t k0 = 0, k1 = 0;
        for (const auto& v : engine_.voices()) {
            if (!v.active || v.pitch < 0 || v.pitch > 127) continue;
            if (v.pitch < 64) k0 |= 1ull << v.pitch; else k1 |= 1ull << (v.pitch - 64);
        }
        rbus_->keys[0].store(k0, std::memory_order_relaxed);
        rbus_->keys[1].store(k1, std::memory_order_relaxed);
        rbus_->activeVoices.store(engine_.activeVoices(), std::memory_order_relaxed);
        rbus_->role.store(engine_.role(), std::memory_order_relaxed);
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 3.0); }
    LegacyStateFn legacyState() override { return legacyRoles(); }

private:
    RolesEngine engine_;
    std::shared_ptr<RolesBus> rbus_;
    std::vector<float> tmpL_, tmpR_;
    float licGain_{0.0f}, licTarget_{0.0f};
    bool wasPlaying_{false};
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"ROLES"; }
    const wchar_t* subtitle() const override { return L"INSTRUMENTO POR ROL MUSICAL · 13 ROLES"; }
    int modeParam() const override { return kParamRoleId; }
    void build(JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        c.section({ 666, 92, 1048, 404 }, L"ENVOLVENTE · FILTRO");
        c.knob(kParamAttackId, 742, 172, KnobSize::Main, L"ATAQUE");
        c.knob(kParamReleaseId, 857, 172, KnobSize::Main, L"RELEASE");
        c.knob(kParamCutoffId, 972, 172, KnobSize::Main, L"CORTE");
        c.knob(kParamResonanceId, 742, 304, KnobSize::Normal, L"RESONANCIA");
        c.knob(kParamDriveId, 857, 304, KnobSize::Normal, L"DRIVE");
        c.knob(kParamVoicesId, 972, 304, KnobSize::Normal, L"VOCES");
        c.section({ 666, 418, 1048, 556 }, L"EFECTOS · TONO");
        c.fader(kParamGainId, { 680, 440, 724, 552 }, L"NIVEL");
        const uint32_t ids[6] = { kParamChorusId, kParamDelayId, kParamReverbId, kParamEqLowId, kParamEqHighId, kParamGateId };
        const wchar_t* labels[6] = { L"CHORUS", L"DELAY", L"REVERB", L"GRAVES", L"AGUDOS", L"GATE" };
        for (int i = 0; i < 6; ++i) c.knob(ids[i], 768.0f + i * 54.0f, 490.0f, KnobSize::Small, labels[i]);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<RolesBus>(c.params.bus());
        if (!bus_) return;
        static JasWaveDsp::PeakMeter none[2];
        (void)none;
        level_.push(std::max(bus_->outPk[0].take(), bus_->outPk[1].take()));
        an_.update(bus_->out, bus_->sampleRate.load(std::memory_order_relaxed));
        an_.columns(cols_, kCols, 25.0, 16000.0, 4.5);
        const uint64_t k0 = bus_->keys[0].load(std::memory_order_relaxed), k1 = bus_->keys[1].load(std::memory_order_relaxed);
        for (int k = 0; k < 128; ++k) {
            const bool on = k < 64 ? ((k0 >> k) & 1) != 0 : ((k1 >> (k - 64)) & 1) != 0;
            glow_[static_cast<size_t>(k)] = on ? 1.0f : glow_[static_cast<size_t>(k)] * 0.85f;
        }
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        role_ = bus_->role.load(std::memory_order_relaxed);
    }
    float outputLevel() const override { return std::clamp((level_.db + 48.0f) / 54.0f, 0.0f, 1.0f); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        const Rect v = Layout::kVisualizer;
        Kit::panel(g, v, L"ESPECTRO · NOTAS");
        const Rect sp{ v.l + 14, v.t + 34, v.r - 14, v.b - 70 };
        if (cols_.size() == static_cast<size_t>(kCols)) {
            for (int i = 0; i < kCols; ++i)
                pts_[static_cast<size_t>(i)] = { sp.l + sp.w() * (i + 0.5f) / kCols, sp.b - std::clamp((cols_[static_cast<size_t>(i)] + 96.0f) / 90.0f, 0.0f, 1.0f) * sp.h() };
            Kit::wireTrace(g, pts_.data(), kCols, Pal::cian, sp.b, true);
        }
        // notas MIDI 24..107 como celdas
        const Rect kb{ v.l + 14, v.b - 56, v.r - 14, v.b - 16 };
        const int lo = 24, hi = 107;
        const float w = kb.w() / (hi - lo + 1);
        for (int n = lo; n <= hi; ++n) {
            const int p = n % 12;
            const bool black = p == 1 || p == 3 || p == 6 || p == 8 || p == 10;
            const Rect r{ kb.l + (n - lo) * w + 0.5f, black ? kb.t : kb.t + 10, kb.l + (n - lo + 1) * w - 0.5f, kb.b };
            const float gl = glow_[static_cast<size_t>(n)];
            g.fillRect(r, gl > 0.02f ? Pal::cian.withAlpha(0.25f + 0.7f * gl) : (black ? hex(0x03080C) : hex(0x0F1E28)));
            if (p == 0) g.line(r.l, kb.t - 4, r.l, kb.b, Pal::panelBorde, 1.0f);
        }
        // mini-panel: rol y voces
        const Rect m = Layout::kMiniPanel;
        Kit::panel(g, m, L"ROL ACTIVO");
        static const wchar_t* names[] = { L"BATERÍA", L"BAJO", L"GUITARRA", L"PIANO", L"TECLAS", L"PAD", L"CUERDAS", L"CORO", L"LEAD", L"METALES", L"SYNTH", L"PERCUSIÓN", L"DEFAULT" };
        const float cw = (m.w() - 28.0f) / 13.0f;
        const int sel = static_cast<int>(std::lround(c.params.plain(kParamRoleId)));
        const bool drumsLocked = !c.params.featureGranted(kFeatDrums);
        for (int i = 0; i < 13; ++i) {
            const Rect r{ m.l + 14 + i * cw + 1, m.t + 40, m.l + 14 + (i + 1) * cw - 1, m.t + 92 };
            const bool locked = drumsLocked && (i == 0 || i == 11);
            const bool on = i == sel;
            g.fillRect(r, on ? hex(0x0E2C38, 0.95f) : hex(0x08131B, 0.85f));
            g.strokeRect(r, locked ? Pal::bloqueado.withAlpha(0.6f) : on ? Pal::cian : Pal::panelBorde, 1.0f);
            if (on && !locked) g.glowLine(r.l + 4, r.b - 3, r.r - 4, r.b - 3, Pal::cian, 1.5f);
            if (locked) Chrome::drawLock(g, r.cx(), r.t + 14, 8.0f, Pal::bloqueado);
            g.text(names[i], { r.l - 6, r.t + 22, r.r + 6, r.t + 38 }, Font::ValueSmall, locked ? Pal::bloqueado : on ? Pal::cianNucleo : Pal::textoEtiqueta, Align::Center);
        }
        wchar_t buf[48];
        swprintf_s(buf, L"VOCES ACTIVAS  %d", voices_);
        g.text(buf, { m.l + 16, m.b - 30, m.l + 300, m.b - 12 }, Font::Value, Pal::textoValor, Align::Left);
        (void)role_;
    }
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        const JasWaveUI::Rect m = JasWaveUI::Layout::kMiniPanel;
        const float cw = (m.w() - 28.0f) / 13.0f;
        if (e.y < m.t + 40 || e.y > m.t + 92 || e.x < m.l + 14) return false;
        const int i = static_cast<int>((e.x - m.l - 14) / cw);
        if (i < 0 || i > 12) return false;
        if ((i == 0 || i == 11) && !c.params.featureGranted(kFeatDrums)) return false;
        c.params.setNorm(kParamRoleId, static_cast<double>(i) / (kNumRoles - 1));
        return false;
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.roles-vst"; }

private:
    static constexpr int kCols = 200;
    std::shared_ptr<RolesBus> bus_;
    JasWaveUI::Kit::PeakFollower level_;
    JasWaveDsp::SpectrumAnalyzer an_;
    std::vector<float> cols_;
    std::array<JasWaveUI::Pt, kCols> pts_{};
    std::array<float, 128> glow_{};
    int voices_{0}, role_{0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return { { kParamRoleId, static_cast<double>(Role::Strings) }, { kParamReverbId, 40.0 }, { kParamChorusId, 35.0 } }; }
protected:
    LegacyStateFn legacyState() override { return legacyRoles(); }
};

} // namespace JasWaveRoles

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveRoles::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Roles",
               Vst::kDistributable, Vst::PlugType::kInstrumentSynth, "1.0.0", kVstVersionString, JasWaveRoles::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveRoles::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Roles Controller", 0, "", "1.0.0", kVstVersionString, JasWaveRoles::Controller::createInstance)
END_FACTORY
