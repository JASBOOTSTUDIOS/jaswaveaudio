// JasWave Roles – VST3 instrumento por roles musicales (procesador, controlador, editor Cyber y factoría)
#include "roles_engine.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

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
            if (data.processContext->state & ProcessContext::kTempoValid) engine_.setTempo(data.processContext->tempo);
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
                else {
                    engine_.noteOn(e.noteOn.pitch, v > 1.f ? v / 127.f : v, 0);
                    rbus_->velocidadMidi.update(v > 1.f ? v / 127.f : v);
                }
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
        rbus_->salida(oL, oR, n);
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
    const char* visualizer() const override { return "espectro-instrumento"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoLila; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"ENVOLVENTE · FILTRO");
        P::principal(c, 0, kParamAttackId, L"ATAQUE");
        P::principal(c, 1, kParamReleaseId, L"RELEASE");
        P::principal(c, 2, kParamCutoffId, L"CORTE");
        P::secundaria(c, 0, kParamResonanceId, L"RESONANCIA");
        P::secundaria(c, 1, kParamDriveId, L"DRIVE");
        P::secundaria(c, 2, kParamVoicesId, L"VOCES");
        P::salida(c, -1, L"SALIDA · EFECTOS");
        P::fader(c, kParamGainId, L"NIVEL");
        P::perillaPequena(c, 0, 0, kParamChorusId, L"CHORUS");
        P::perillaPequena(c, 1, 0, kParamDelayId, L"DELAY");
        P::perillaPequena(c, 2, 0, kParamReverbId, L"REVERB");
        P::perillaPequena(c, 0, 1, kParamEqLowId, L"GRAVES");
        P::perillaPequena(c, 1, 1, kParamEqHighId, L"AGUDOS");
        P::perillaPequena(c, 2, 1, kParamGateId, L"GATE");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<RolesBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
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
        // mini-panel: matriz de 13 roles (acento violeta) con candado por licencia
        P::panelMedicion(g, L"ROL ACTIVO");
        const Rect m = P::kMini;
        static const wchar_t* names[] = { L"BATERÍA", L"BAJO", L"GUITARRA", L"PIANO", L"TECLAS", L"PAD", L"CUERDAS", L"CORO", L"LEAD", L"METALES", L"SYNTH", L"PERCUSIÓN", L"DEFAULT" };
        const int sel = static_cast<int>(std::lround(c.params.plain(kParamRoleId)));
        const bool drumsLocked = !c.params.featureGranted(kFeatDrums);
        for (int i = 0; i < 13; ++i) {
            const Rect r = cellRect(i);
            const bool locked = drumsLocked && (i == 0 || i == 11);
            const bool on = i == sel;
            g.fillRect(r, on ? ac.withAlpha(0.16f) : hex(0x0A0C26, 0.85f));
            g.strokeRect(r, locked ? Pal::bloqueado.withAlpha(0.6f) : on ? ac : Pal::panelBorde, 1.0f);
            if (on && !locked) g.glowLine(r.l + 4, r.b - 3, r.r - 4, r.b - 3, ac, 1.5f);
            if (locked) Chrome::drawLock(g, r.cx(), r.t + 12, 8.0f, Pal::bloqueado);
            g.text(names[i], { r.l - 4, r.t + 18, r.r + 4, r.t + 34 }, Font::ValueSmall, locked ? Pal::bloqueado : on ? Pal::cianNucleo : Pal::textoEtiqueta, Align::Center);
        }
        wchar_t buf[48];
        swprintf_s(buf, L"VOCES ACTIVAS  %d", voices_);
        g.text(buf, { m.l + 16, m.b - 30, m.l + 300, m.b - 12 }, Font::Value, Pal::textoValor, Align::Left);
    }
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        for (int i = 0; i < 13; ++i) {
            if (!cellRect(i).contains(e.x, e.y)) continue;
            if ((i == 0 || i == 11) && !c.params.featureGranted(kFeatDrums)) return false;
            c.params.setNorm(kParamRoleId, static_cast<double>(i) / (kNumRoles - 1));
            return false;
        }
        return false;
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.roles-vst"; }

private:
    // 13 botones de rol en una rejilla de 7 + 6 (área táctil ≥ 44 px de alto en dos filas)
    static JasWaveUI::Rect cellRect(int i) {
        const JasWaveUI::Rect m = JasWaveUI::Plantilla::kMini;
        const int fila = i < 7 ? 0 : 1, col = i < 7 ? i : i - 7;
        const float cw = (m.w() - 28.0f) / 7.0f;
        const float x = m.l + 14.0f + col * cw + (fila == 1 ? cw * 0.5f : 0.0f);
        const float y = m.t + 30.0f + fila * 40.0f;
        return { x + 2.0f, y, x + cw - 2.0f, y + 36.0f };
    }
    std::shared_ptr<RolesBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    int voices_{0};
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
