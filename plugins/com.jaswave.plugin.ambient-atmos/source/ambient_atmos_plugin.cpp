// JasWave Ambient Atmos - VST3 instrumento (procesador, controlador, editor Cyber con macros, paginas de ajuste y teclado)
#include "ambient_atmos_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveAmbientAtmosPlugin {

using namespace JasWaveAmbientAtmos;

// FUID propios (serie B3A7C9Ex de los instrumentos independientes; sin colision con los 8 existentes)
static const FUID kProcessorUid(0xB3A7C9E8, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E8, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = { { "atmos.reserved", "Reservado (sin funciones premium)" } };
static const PluginDescriptor kDesc{ "com.jaswave.plugin.ambient-atmos", "JasWave Ambient Atmos", L"AMBIENT ATMOS", kFeatures, 0, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(abus_ = std::make_shared<AtmosBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        AtmosSettings s;
        for (uint32_t id = 0; id < kParamCount; ++id) s.p[id] = plainOf(id);
        s.preset = intOf(kPreset);
        s.p[kBypass] = (boolOf(kBypass) || !licensed()) ? 1.0 : 0.0;     // sin licencia: silencio con fundido
        engine_.setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun (ids 100..), tras la cadena interna
        engine_.setFx(fxp_);
        // cola = release + cola de la reverb (+ shimmer) + margen del eco; el host puede dejar de procesar tras este tiempo
        const double tail = std::clamp(s.p[kRelease] + s.p[kReverbDecay] * 1.4 + 4.0 + (fxp_.algunoActivo() ? 10.0 : 0.0), 4.0, 110.0);   // el rack (reverb hall/delay) alarga la cola
        tailSamples_.store(static_cast<uint32>(sr_ * tail), std::memory_order_relaxed);
    }
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
            if (at > pos) { engine_.render(oL + pos, oR + pos, at - pos, abus_.get()); pos = at; }
            if (i == count) break;
            if (e.type == Event::kNoteOnEvent) {
                engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                abus_->velocidadMidi.update(e.noteOn.velocity);
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
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, abus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return tailSamples_.load(std::memory_order_relaxed); }

private:
    AtmosEngine engine_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<AtmosBus> abus_;
    std::atomic<uint32> tailSamples_{static_cast<uint32>(48000 * 30)};
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"AMBIENT ATMOS"; }
    const wchar_t* subtitle() const override { return L"SOSTENIDO INFINITO · GUITARRAS, PADS Y TEXTURAS · ECO Y SHIMMER"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    // Teclado en pantalla tocable con el ratón
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { return teclado_.pulsar(e, c.params.bus()); }
    void vizDrag(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext&) override { teclado_.arrastrar(e); }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext&) override { teclado_.soltar(); }
    JasWaveUI::Color accent() const override { return JasWaveUI::hex(0x8FD3FF); }

    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        ctx_ = &c;
        P::controles(c, L"MACROS · A · R · E/FX");
        P::principal(c, 0, kAttack, L"A  ATAQUE");
        P::principal(c, 1, kRelease, L"R  RELEASE");
        P::principal(c, 2, kFxMacro, L"E/FX  ECO·ESPACIO");
        P::secundaria(c, 0, kTune, L"AFINACIÓN");
        P::secundaria(c, 1, kCutoff, L"FILTRO");
        P::secundaria(c, 2, kWidth, L"ANCHO");
        const JasWaveUI::Rect r = P::filaSecundaria(0, 3);
        c.dropdown(kPreset, { r.l, r.t + 54.0f, r.r, r.b + 52.0f }, L"PRESET");
        const float bx = P::kColX[0] - 52.0f, by = 378.0f;
        c.button({ bx, by, bx + 40, by + 20 }, L"◀", [this] { stepPreset(-1); });
        c.button({ bx + 46, by, bx + 90, by + 20 }, L"▶", [this] { stepPreset(1); });
        pageBtn_ = c.button({ bx + 96, by, bx + 290, by + 20 }, L"", [this] { setPage((page_ + 1) % kPages); });
        pageBtn_->basico = 0;   // las páginas de ajuste fino son del modo Avanzado
        P::salida(c, kBypass, L"SALIDA · AJUSTE FINO");
        P::fader(c, kVolume, L"VOLUMEN");
        for (int i = 0; i < 6; ++i) knobs_[i] = P::perillaPequena(c, i % 3, i / 3, kPages_[0].ids[i], kPages_[0].labels[i]);
        P::medidores(c, meters_);
        setPage(0);
        P::paginaMixFx(c);   // pagina «MIX / FX» comun: SIEMPRE la ultima llamada de build()
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<AtmosBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        state_ = bus_->bankState.load(std::memory_order_relaxed);
        delayMs_ = bus_->delayMs.load(std::memory_order_relaxed);
        cutoff_ = bus_->cutoffHz.load(std::memory_order_relaxed);
        hist_[static_cast<size_t>(histPos_)] = std::clamp(meters_.level(), 0.0f, 1.0f);
        histPos_ = (histPos_ + 1) % kHist;
        rt60_ = static_cast<float>(c.params.plain(kReverbDecay));
        preset_ = std::clamp(static_cast<int>(std::lround(c.params.plain(kPreset))), 0, kNumPresets - 1);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext&) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        const Rect v = P::kVisual;
        P::panelVisual(g, L"ESPECTRO OUT · TECLADO");
        meters_.drawLabels(g);
        espectro_.dibujar(g, { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 112.0f });
        const Rect kb{ v.l + 14.0f, v.b - 92.0f, v.r - 14.0f, v.b - 22.0f };
        teclado_.dibujar(g, kb, ac);
        // rango util: C1 (24) .. C7 (96); fuera de el las muestras se transponen mas de +-3 semitonos de su raiz
        const float ww = kb.w() / 52.0f;
        auto xNota = [&](int n) { int w = 0; for (int k = 21; k < n; ++k) if (!Plantilla::Teclado88::negra(k)) ++w; return kb.l + ww * w; };
        const float x0 = xNota(24), x1 = xNota(96) + ww;
        g.fillRect({ x0, kb.b + 3.0f, x1, kb.b + 4.5f }, ac.withAlpha(0.7f));
        g.text(L"RANGO ÚTIL  C1 – C7", { x0, kb.b + 6.0f, x0 + 200.0f, kb.b + 19.0f }, Font::ValueSmall, Pal::textoTenue, Align::Left);
        P::panelMedicion(g, L"ATMÓSFERA · PRESET");
        const Rect m = P::kMini;
        const Preset& pr = presets()[static_cast<size_t>(preset_)];
        std::wstring fam = wide(familyName(pr.family));
        g.text(fam, { m.l + 16, m.t + 32, m.r - 190, m.t + 50 }, Font::Label, Pal::textoEtiqueta, Align::Left, true);
        wchar_t buf[96];
        std::wstring nm = wide(pr.name);
        swprintf_s(buf, L"%02d / %d  %s", preset_ + 1, kNumPresets, nm.c_str());
        g.text(buf, { m.l + 16, m.t + 50, m.r - 190, m.t + 74 }, Font::Value, Pal::textoValor, Align::Left);
        const wchar_t* est = state_ == 2 ? L"BANCO DE MUESTRAS · LISTO" : state_ == 1 ? L"CARGANDO BANCO…" : state_ == 3 ? L"SIN BANCO · MOTOR MODELADO" : L"MOTOR MODELADO";
        g.text(est, { m.l + 16, m.t + 74, m.r - 190, m.t + 92 }, Font::ValueSmall, state_ == 2 ? ac : Pal::textoTenue, Align::Left);
        const Rect h{ m.l + 14.0f, m.t + 98.0f, m.r - 176.0f, m.b - 12.0f };
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - val * h.h() };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, ac, h.b, true);
        swprintf_s(buf, L"%d", voices_);
        P::lectura(g, 0, 0, L"VOCES", buf, ac);
        swprintf_s(buf, L"%.1f s", rt60_);
        P::lectura(g, 1, 0, L"RT60", buf);
        if (delayMs_ >= 1.0f) swprintf_s(buf, L"%.0f ms", delayMs_); else swprintf_s(buf, L"—");
        P::lectura(g, 0, 1, L"ECO", buf);
        if (cutoff_ >= 1000.0f) swprintf_s(buf, L"%.1f kHz", cutoff_ / 1000.0f); else swprintf_s(buf, L"%.0f Hz", cutoff_);
        P::lectura(g, 1, 1, L"FILTRO", buf);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.ambient-atmos"; }
    // Los 6 mandos pequeños de SALIDA se reasignan por páginas: todos sus parámetros quedan expuestos
    void parametrosCubiertos(std::vector<uint32_t>& ids) const override {
        for (const Page& pg : kPages_) for (int i = 0; i < pg.count; ++i) ids.push_back(pg.ids[i]);
    }

private:
    static constexpr int kHist = 240;
    static constexpr int kPages = 5;
    struct Page { const wchar_t* name; uint32_t ids[6]; const wchar_t* labels[6]; int count; };
    static std::wstring wide(const char* s) { return std::wstring(s, s + std::strlen(s)); }
    // Paginas de los 6 mandos pequenos de SALIDA (el resto de parametros; los macros del panel son fijos)
    static constexpr Page kPages_[kPages] = {
        { L"ECO DE CINTA", { kDelayMix, kDelaySync, kDelayTime, kDelayFb, kDelayTone, kTapeAge }, { L"ECO MIX", L"SYNC", L"TIEMPO", L"FEEDBACK", L"TONO ECO", L"WOW" }, 6 },
        { L"REVERB · SHIMMER", { kReverbMix, kReverbDecay, kReverbDamp, kReverbMod, kShimmer, kShimmerInterval }, { L"REV MIX", L"DECAY", L"DAMPING", L"MOD COLA", L"SHIMMER", L"INTERV." }, 6 },
        { L"FILTRO · FORMA", { kResonance, kLfoRate, kLfoDepth, kLowCut, kPreDelay, kReverbType }, { L"RESON.", L"LFO VEL", L"LFO PROF", L"LOW CUT", L"PRE-DLY", L"TIPO REV" }, 6 },
        { L"CUERPO", { kUnisonDetune, kUnisonVoices, kChorus, kDrive, kLayerBlend, kComp }, { L"UNÍSONO", L"VOCES", L"CHORUS", L"DRIVE", L"CAPA B", L"COMP" }, 6 },
        { L"ECUALIZADOR", { kEqLow, kEqLowMid, kEqHighMid, kEqHigh, kEqHigh, kEqHigh }, { L"GRAVES", L"MED-BAJO", L"MED-ALTO", L"AGUDOS", L"", L"" }, 4 },
    };
    void setPage(int p) {
        page_ = p;
        const Page& pg = kPages_[p];
        for (int i = 0; i < 6; ++i) {
            if (!knobs_[i]) continue;
            knobs_[i]->visible = i < pg.count;
            knobs_[i]->setParam(pg.ids[i], pg.labels[i]);
        }
        if (pageBtn_) { pageBtn_->caption = std::wstring(L"PÁG ") + std::to_wstring(p + 1) + L"/" + std::to_wstring(kPages) + L" · " + pg.name; }
    }
    void stepPreset(int d) {
        if (!ctx_) return;
        const int cur = std::clamp(static_cast<int>(std::lround(ctx_->params.plain(kPreset))), 0, kNumPresets - 1);
        const int nx = (cur + d + kNumPresets) % kNumPresets;
        if (const ParamDef* def = ctx_->params.def(kPreset)) ctx_->params.setNorm(kPreset, toNorm(*def, nx));
    }
    JasWaveUI::EditorContext* ctx_{nullptr};
    JasWaveUI::Button* pageBtn_{nullptr};
    JasWaveUI::Knob* knobs_[6]{};
    std::shared_ptr<AtmosBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, state_{0}, histPos_{0}, page_{0}, preset_{0};
    float delayMs_{0.0f}, cutoff_{8000.0f}, rt60_{8.0f};
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
        return { { kAttack, 0.8 }, { kReverbMix, 45.0 }, { kDelayMix, 30.0 },
                 { F::kBase + F::EqOn, 1.0 }, { F::kBase + F::eqGain(0), 3.0 }, { F::kBase + F::eqGain(2), -4.0 }, { F::kBase + F::eqGain(4), 3.5 },
                 { F::kBase + F::eqFreq(4), 4200.0 }, { F::kBase + F::HpfOn, 1.0 }, { F::kBase + F::CompOn, 1.0 }, { F::kBase + F::CompThresh, -30.0 },
                 { F::kBase + F::ChOn, 1.0 }, { F::kBase + F::DlOn, 1.0 }, { F::kBase + F::RvOn, 1.0 } };
    }

    // Cargar un proyecto no debe pisar los valores guardados con los del preset
    tresult PLUGIN_API setComponentState(IBStream* state) SMTG_OVERRIDE {
        loading_ = true;
        const tresult r = JwController::setComponentState(state);
        loading_ = false;
        return r;
    }
    // Elegir un preset (UI, host, IA o automatizacion) fija banco/capa y TODOS los valores del preset
    tresult PLUGIN_API setParamNormalized(ParamID id, ParamValue value) SMTG_OVERRIDE {
        const int before = id == kPreset ? presetIndex() : -1;
        const tresult r = JwController::setParamNormalized(id, value);
        if (id == kPreset && !loading_ && !applying_ && presetIndex() != before) applyPreset(presetIndex());
        return r;
    }

protected:
    // CC1 rueda de modulacion, CC64 sustain, 128 aftertouch de canal, 129 pitch bend, 130 cambio de programa -> preset
    int midiCcParam(int cc) const override {
        switch (cc) {
            case 1: return static_cast<int>(kModWheel);
            case 64: return static_cast<int>(kSustain);
            case 128: return static_cast<int>(kAftertouch);
            case 129: return static_cast<int>(kBend);
            case 130: return static_cast<int>(kPreset);
            default: return -1;
        }
    }

private:
    int presetIndex() const { return std::clamp(static_cast<int>(std::lround(plain(kPreset))), 0, kNumPresets - 1); }
    void applyPreset(int idx) {
        applying_ = true;
        const Preset& pr = presets()[static_cast<size_t>(idx)];
        for (const Spec& s : specs()) {
            // el preset no toca: el propio selector, los controles de interpretacion, bypass, volumen ni afinacion maestra
            if (s.id == kPreset || s.id == kBypass || s.id == kSustain || s.id == kBend || s.id == kModWheel || s.id == kAftertouch ||
                s.id == kVolume || s.id == kTune) continue;
            const ParamDef* d = table_.find(s.id);
            if (!d) continue;
            const double n = toNorm(*d, pr.p[s.id]);
            beginEdit(s.id);
            JwController::setParamNormalized(s.id, n);
            performEdit(s.id, n);
            endEdit(s.id);
        }
        applying_ = false;
    }
    bool loading_{false}, applying_{false};
};

} // namespace JasWaveAmbientAtmosPlugin

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveAmbientAtmosPlugin::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Ambient Atmos",
               Vst::kDistributable, Vst::PlugType::kInstrumentSynth, "1.0.0", kVstVersionString, JasWaveAmbientAtmosPlugin::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveAmbientAtmosPlugin::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Ambient Atmos Controller", 0, "", "1.0.0", kVstVersionString, JasWaveAmbientAtmosPlugin::Controller::createInstance)
END_FACTORY
