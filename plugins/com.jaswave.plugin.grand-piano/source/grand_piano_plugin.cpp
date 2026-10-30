// JasWave Grand Piano - VST3 instrumento (procesador, controlador, editor Cyber con teclado, pedal y pagina NOTA A NOTA)
#include "grand_piano_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"
#include "nota_a_nota_editor.h"
#include "jw_fxrack_page.h"

#include "public.sdk/source/main/pluginfactory.h"

#include <deque>

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveGrandPiano {

// FUID del Grand Piano (se mantienen los de 174a40c: el manifiesto los declara como classId)
static const FUID kProcessorUid(0xB3A7C9E2, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E2, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "piano.polifonia-extendida", "Polifonía de 64 voces (básica: 16)" },
    { "piano.hall-reverb", "Simulación acústica de sala de concierto" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.grand-piano", "JasWave Grand Piano", L"GRAND PIANO", kFeatures, 2, true };

// ---------------------------------------------------------------------------------
//  Estado de la tabla nota a nota: bloque AÑADIDO tras el estado base de parametros (formato en nota_a_nota.h)
// ---------------------------------------------------------------------------------
inline void escribirTabla(IBStream* st, const NotaTabla& t) {
    std::vector<uint8_t> b;
    notaSerializar(t, b);
    int32 n = 0;
    st->write(b.data(), static_cast<int32>(b.size()), &n);
}
// false si el flujo no trae tabla (estado anterior al editor nota a nota)
inline bool leerTabla(IBStream* st, NotaTabla& out) {
    if (!st) return false;
    uint8_t h[kTablaCabecera];
    int32 got = 0;
    if (st->read(h, static_cast<int32>(sizeof h), &got) != kResultOk || got != static_cast<int32>(sizeof h)) return false;
    int n = 0, np = 0;
    if (!notaLeerCabecera(h, n, np)) return false;
    std::vector<uint8_t> d(static_cast<size_t>(n) * static_cast<size_t>(np) * 4);
    if (st->read(d.data(), static_cast<int32>(d.size()), &got) != kResultOk || got != static_cast<int32>(d.size())) return false;
    notaDeserializar(d.data(), n, np, out);
    return true;
}

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) {
        registerBus(pbus_ = std::make_shared<GrandBus>());
        iSel_ = table_.index(kNoteSelect); iPre_ = table_.index(kNotePreset); iCmd_ = table_.index(kNoteCmd);
        for (int p = 0; p < kNpCount; ++p) iProp_[p] = table_.index(kNoteGain + static_cast<uint32_t>(p));
        NotaParams np = leerNP();
        ns_.iniciar(np);
        escribirNP(np);
    }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

    // Estado: parametros (base) + tabla nota a nota
    tresult PLUGIN_API getState(IBStream* state) SMTG_OVERRIDE {
        const tresult r = JwProcessor::getState(state);
        if (r == kResultOk) escribirTabla(state, ns_.tabla);
        return r;
    }
    tresult PLUGIN_API setState(IBStream* state) SMTG_OVERRIDE {
        const tresult r = JwProcessor::setState(state);
        if (r != kResultOk) return r;
        NotaTabla t;
        if (leerTabla(state, t)) ns_.tabla = t;
        else {   // estado anterior al editor nota a nota: tabla neutra
            ns_.tabla.neutro();
            norm_[static_cast<size_t>(iPre_)] = notaPresetNormDe(0);
        }
        NotaParams np = leerNP();
        ns_.iniciar(np);
        escribirNP(np);
        tablaPend_ = true;
        return kResultOk;
    }

protected:
    void prepare(double sr, int maxBlock) override {
        engine_.prepare(sr, maxBlock);
        engine_.setSettings(settings_);
        engine_.setPedal(settings_.pedalPct / 100.0);   // prepare/reset sueltan el pedal: se repone el del parametro
        engine_.setNotaTabla(ns_.tabla);
    }
    void resetDsp() override { engine_.reset(); engine_.setPedal(settings_.pedalPct / 100.0); }
    void updateParams() override {
        GrandSettings s;
        s.attackMs = plainOf(kAttack);
        s.decayPct = plainOf(kDecay);
        s.releaseS = plainOf(kRelease);
        s.velCurvePct = plainOf(kVelocityCurve);
        s.brightnessPct = plainOf(kBrightness);
        s.reverbPct = plainOf(kReverbSend);
        s.volumeDb = plainOf(kVolume);
        s.a4 = plainOf(kTune);
        s.widthPct = plainOf(kWidth);
        s.pedalPct = plainOf(kSustain);
        s.unaCorda = boolOf(kUnaCorda);
        s.bypass = boolOf(kBypass) || !licensed();     // sin licencia: silencio con fundido
        s.maxVoices = feature(kFeatPolyphony) ? kMaxVoices : kBasicVoices;
        settings_ = s;
        engine_.setSettings(s);
        fxp_.leer([this](uint32_t id) { return plainOf(id); });   // FX Rack comun (ids 100..; un estado sin ellos carga con el rack apagado)
        engine_.setFx(fxp_);
        sincronizarNotas();
    }
    template <class T>
    void renderT(T* oL, T* oR, int n, int offset, ProcessData& data) {
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
                const int cc = e.midiCCOut.controlNumber, v1 = e.midiCCOut.value & 0x7F, v2 = e.midiCCOut.value2 & 0x7F;
                if (cc == 64) engine_.setPedal(v1 / 127.0);                                  // sustain (continuo: medio pedal)
                else if (cc == kPitchBend) engine_.setBend(((v2 << 7 | v1) - 8192) * (2.0 / 8192.0));
                else if (cc == 123) engine_.allNotesOff();
                else if (cc == 120) engine_.panic();
            }
        }
        if (pos < n) engine_.render(oL + pos, oR + pos, n - pos, pbus_.get());
    }
    void render(const float*, const float*, float* oL, float* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    void render(const double*, const double*, double* oL, double* oR, int n, int off, ProcessData& d) override { renderT(oL, oR, n, off, d); }
    uint32 tailSamples() override { return kInfiniteTail; }

private:
    // ---- editor nota a nota: los parametros Note * leen y escriben la entrada de la nota elegida (logica en NotaSync) ----
    NotaParams leerNP() const {
        NotaParams np;
        np.sel = norm_[static_cast<size_t>(iSel_)]; np.pre = norm_[static_cast<size_t>(iPre_)]; np.cmd = norm_[static_cast<size_t>(iCmd_)];
        for (int p = 0; p < kNpCount; ++p) np.prop[p] = norm_[static_cast<size_t>(iProp_[p])];
        return np;
    }
    void escribirNP(const NotaParams& np) {
        norm_[static_cast<size_t>(iPre_)] = np.pre;
        for (int p = 0; p < kNpCount; ++p) norm_[static_cast<size_t>(iProp_[p])] = np.prop[p];
    }
    // Se ejecuta en cada cambio de parametros (hilo de audio, antes de renderizar el bloque)
    void sincronizarNotas() {
        NotaParams np = leerNP();
        const bool cambio = ns_.sincronizar(np) || tablaPend_;
        tablaPend_ = false;
        escribirNP(np);
        if (cambio) engine_.setNotaTabla(ns_.tabla);
    }

    GrandPianoEngine engine_;
    GrandSettings settings_;
    JasWaveFx::FxParams fxp_;
    std::shared_ptr<GrandBus> pbus_;
    NotaSync ns_;
    int iSel_{-1}, iPre_{-1}, iCmd_{-1}, iProp_[kNpCount]{};
    bool tablaPend_{true};
};

// ---------------------------------------------------------------------------------
class Controller;

class Editor : public JasWaveUI::PluginEditor {
public:
    explicit Editor(INotaModelo* modelo) : pagina_(modelo) {}
    const wchar_t* title() const override { return L"GRAND PIANO"; }
    const wchar_t* subtitle() const override { return L"PIANO DE COLA DE CONCIERTO · MODELADO DE CUERDAS · 88 TECLAS"; }
    const char* visualizer() const override { return "espectro-instrumento"; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"MARTILLO · CUERDA · SALA");
        P::principal(c, 0, kBrightness, L"BRILLO");
        P::principal(c, 1, kDecay, L"DECAY");
        P::principal(c, 2, kReverbSend, L"SALA");
        P::secundaria(c, 0, kAttack, L"ATAQUE");
        P::secundaria(c, 1, kRelease, L"RELEASE");
        P::secundaria(c, 2, kVelocityCurve, L"VEL CURVE");
        P::salida(c, kBypass);
        P::fader(c, kVolume, L"VOLUMEN");
        P::perillaSalida(c, 0, kWidth, L"ANCHURA");
        P::perillaSalida(c, 1, kTune, L"LA4");
        P::perillaPequena(c, 2, 0, kSustain, L"PEDAL");
        P::interruptorSalida(c, 2, 1, 1, kUnaCorda, L"UNA CORDA");
        P::medidores(c, meters_);
        ctx_ = &c;
        nPagina1_ = c.widgets.size();   // widgets de la pagina principal (se ocultan en las paginas NOTA A NOTA y MIX / FX)
        mix_ = P::paginaMixFx(c);       // pagina «MIX / FX» comun (ultima llamada de build): boton en x 484..568, junto al de NOTA A NOTA (x 700..880)
    }
    void tick(JasWaveUI::EditorContext& c) override {
        // Las dos paginas no coexisten: al abrir MIX / FX se cierra NOTA A NOTA. Los widgets de la pagina principal quedan
        // marcados como visibles en el estado que MIX / FX restaura al cerrarse, asi se vuelve a la pagina principal.
        if (mix_ && mix_->activa && notas_) {
            notas_ = false;
            for (size_t i = 0; i < nPagina1_ && i < mix_->visPrev.size(); ++i) mix_->visPrev[i] = 1;
        }
        if (c.modoBasico && notas_) alternarPagina();   // NOTA A NOTA es del modo Avanzado
        pagina_.tick(c.dt);
        bus_ = std::dynamic_pointer_cast<GrandBus>(c.params.bus());
        if (!bus_) return;
        meters_.updateInstrumento(bus_->velocidadMidi, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt, false, true);
        teclado_.actualizar(bus_->keys[0].load(std::memory_order_relaxed), bus_->keys[1].load(std::memory_order_relaxed), c.dt);
        voices_ = bus_->activeVoices.load(std::memory_order_relaxed);
        maxVoices_ = bus_->maxVoices.load(std::memory_order_relaxed);
        pedal_ = bus_->pedalPct.load(std::memory_order_relaxed);
        hist_[static_cast<size_t>(histPos_)] = static_cast<float>(voices_);
        histPos_ = (histPos_ + 1) % kHist;
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        if (!c.modoBasico) dibujarPestana(g);
        if (notas_) { pagina_.draw(g, c.params, accent()); return; }
        const Rect v = P::kVisual;
        P::panelVisual(g, L"ESPECTRO OUT · TECLADO");
        meters_.drawLabels(g);
        espectro_.dibujar(g, { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 112.0f });
        teclado_.dibujar(g, { v.l + 14.0f, v.b - 84.0f, v.r - 14.0f, v.b - 14.0f }, accent());
        // mini-panel: polifonía
        P::panelMedicion(g, L"POLIFONÍA · PEDAL");
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
        swprintf_s(buf, L"%d %%", pedal_);
        P::lectura(g, 0, 1, L"PEDAL", buf, pedal_ > 5 ? accent() : Pal::textoValor);
        P::lectura(g, 1, 0, L"POLIFONÍA", maxVoices_ >= kMaxVoices ? L"EXTENDIDA" : L"BÁSICA");
        P::lectura(g, 1, 1, L"SALA", L"CONCIERTO");
    }
    // El raton de la pagina NOTA A NOTA llega por los ganchos viz* (sus widgets no se registran: ui-layout.json no cambia)
    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        if (!c.modoBasico && kPestana.contains(e.x, e.y)) { alternarPagina(); return false; }
        return notas_ ? pagina_.down(e, c.params) : teclado_.pulsar(e, c.params.bus());   // teclado en pantalla tocable
    }
    void vizDrag(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { if (notas_) pagina_.drag(e, c.params); else teclado_.arrastrar(e); }
    void vizUp(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { if (notas_) pagina_.up(e, c.params); else teclado_.soltar(); }
    void vizDouble(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { if (notas_) pagina_.doble(e, c.params); }
    void vizWheel(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override { if (notas_) pagina_.rueda(e, c.params); }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.grand-piano"; }
    // Página NOTA A NOTA (dibujada a mano): nota elegida, sus 9 propiedades, preset y la orden interna de edición
    void parametrosCubiertos(std::vector<uint32_t>& ids) const override {
        for (uint32_t id = kNoteSelect; id <= kNoteCmd; ++id) ids.push_back(id);
    }

private:
    static constexpr JasWaveUI::Rect kPestana{ 700.0f, 48.0f, 880.0f, 68.0f };
    void alternarPagina() {
        if (mix_ && mix_->activa) mix_->activar(false);   // por seguridad: nunca las dos a la vez
        notas_ = !notas_;
        if (ctx_) for (size_t i = 0; i < nPagina1_ && i < ctx_->widgets.size(); ++i) ctx_->widgets[i]->visible = !notas_;
    }
    void dibujarPestana(JasWaveUI::Gfx& g) const {
        using namespace JasWaveUI;
        g.fillRound(kPestana, 10.0f, accent().withAlpha(notas_ ? 0.30f : 0.10f));
        g.strokeRound(kPestana, 10.0f, accent().withAlpha(notas_ ? 1.0f : 0.6f), 1.0f);
        g.text(notas_ ? L"◀  PÁGINA PRINCIPAL" : L"NOTA A NOTA  ▶", kPestana, Font::Label, Pal::textoTitulo, Align::Center, true);
    }

    static constexpr int kHist = 240;
    std::shared_ptr<GrandBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    int voices_{0}, maxVoices_{kMaxVoices}, pedal_{0}, histPos_{0};
    NotaPagina pagina_;
    JasWaveUI::EditorContext* ctx_{nullptr};
    size_t nPagina1_{0};
    std::shared_ptr<JasWaveUI::Plantilla::MixFx::Estado> mix_;
    bool notas_{false};
};

// ---------------------------------------------------------------------------------
//  Controlador: ademas de los parametros, mantiene un ESPEJO de la tabla nota a nota (para la UI y para que Note Select /
//  Note * muestren los valores de la nota elegida) con la misma logica que el procesador. Las ediciones del editor viajan
//  al procesador como ordenes `Note Edit Cmd` (una por llamada a tick(), con reenvio de verificacion: ver nota_a_nota.h).
// ---------------------------------------------------------------------------------
class Controller : public JwController, public INotaModelo {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(static_cast<INotaModelo*>(this)); }
    std::vector<DemoParam> demoPreset() const override { return { { kBrightness, 62.0 }, { kDecay, 70.0 }, { kReverbSend, 30.0 }, { kSustain, 100.0 } }; }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        const tresult r = JwController::initialize(context);
        if (r != kResultOk) return r;
        // la orden de edicion es interna: oculta y no automatizable
        if (Parameter* p = parameters.getParameter(kNoteCmd)) p->getInfo().flags = ParameterInfo::kIsHidden;
        return kResultOk;
    }

    tresult PLUGIN_API setComponentState(IBStream* state) SMTG_OVERRIDE {
        std::lock_guard<std::recursive_mutex> lk(mtx_);
        loading_ = true;
        const tresult r = JwController::setComponentState(state);
        if (r == kResultOk) {
            NotaTabla t;
            if (leerTabla(state, t)) ns_.tabla = t;
            else {
                ns_.tabla.neutro();
                EditController::setParamNormalized(kNotePreset, notaPresetNormDe(0));
            }
            limpiarCola();
        }
        loading_ = false;
        NotaParams np = leerNP();
        ns_.iniciar(np);
        escribirNP(np);
        return r;
    }

    // Todo cambio de parametro (UI, host, automatizacion, IA) pasa por aqui: misma logica que el procesador
    tresult PLUGIN_API setParamNormalized(ParamID id, ParamValue v) SMTG_OVERRIDE {
        const tresult r = JwController::setParamNormalized(id, v);
        std::lock_guard<std::recursive_mutex> lk(mtx_);
        if (loading_ || sync_ || id < kNoteSelect || id > kNoteCmd) return r;
        NotaParams np = leerNP();
        ns_.sincronizar(np);
        if (ns_.presetAplicado) limpiarCola();
        escribirNP(np);
        return r;
    }

    // ---- INotaModelo (editor) ----
    NotaTabla copiaTabla() const override { std::lock_guard<std::recursive_mutex> lk(mtx_); return ns_.tabla; }
    int notaSeleccionada() const override { std::lock_guard<std::recursive_mutex> lk(mtx_); return ns_.sel; }
    int pendientes() const override { std::lock_guard<std::recursive_mutex> lk(mtx_); return static_cast<int>(cola_.size()); }
    void editarNota(int nota, int prop, double plainV) override {
        std::lock_guard<std::recursive_mutex> lk(mtx_);
        if (!NotaTabla::valida(nota) || prop < 0 || prop >= kNpCount) return;
        NotaParams np = leerNP();
        if (!ns_.editar(nota, prop, plainV, np)) return;
        escribirNP(np);
        encolar(nota, prop);
    }
    void tick(float dt) override {
        std::lock_guard<std::recursive_mutex> lk(mtx_);
        if (!cola_.empty()) {
            const uint16_t k = cola_.front();
            cola_.pop_front();
            const int idx = k / 16, p = k % 16;
            enCola_[idx][p] = false;
            enviar(kNotaMin + idx, p);
            if (!verificando_) enviados_.push_back(k);
            ocioso_ = 0.0f;
            if (cola_.empty() && verificando_) verificando_ = false;
            return;
        }
        if (enviados_.empty()) return;
        ocioso_ += dt;
        if (ocioso_ < 0.4f) return;   // pasada de verificacion: se reenvia todo lo enviado (las ordenes son idempotentes)
        ocioso_ = 0.0f;
        verificando_ = true;
        for (const uint16_t k : enviados_) encolar(kNotaMin + k / 16, k % 16);
        enviados_.clear();
    }

protected:
    int midiCcParam(int cc) const override { return cc == 64 ? static_cast<int>(kSustain) : -1; }

private:
    NotaParams leerNP() const {
        NotaParams np;
        np.sel = const_cast<Controller*>(this)->getParamNormalized(kNoteSelect);
        np.pre = const_cast<Controller*>(this)->getParamNormalized(kNotePreset);
        np.cmd = const_cast<Controller*>(this)->getParamNormalized(kNoteCmd);
        for (int p = 0; p < kNpCount; ++p) np.prop[p] = const_cast<Controller*>(this)->getParamNormalized(kNoteGain + static_cast<uint32_t>(p));
        return np;
    }
    // vuelca a los parametros (solo lo que cambio) sin reentrar en setParamNormalized
    void escribirNP(const NotaParams& np) {
        sync_ = true;
        if (getParamNormalized(kNotePreset) != np.pre) EditController::setParamNormalized(kNotePreset, np.pre);
        for (int p = 0; p < kNpCount; ++p) {
            const ParamID id = kNoteGain + static_cast<uint32_t>(p);
            if (getParamNormalized(id) != np.prop[p]) EditController::setParamNormalized(id, np.prop[p]);
        }
        sync_ = false;
    }
    void limpiarCola() {
        cola_.clear(); enviados_.clear(); verificando_ = false; ocioso_ = 0.0f;
        std::memset(enCola_, 0, sizeof enCola_);
    }
    void encolar(int nota, int prop) {
        const int idx = nota - kNotaMin;
        if (enCola_[idx][prop]) return;
        enCola_[idx][prop] = true;
        cola_.push_back(static_cast<uint16_t>(idx * 16 + prop));
    }
    void enviar(int nota, int prop) {
        const double cmd = notaCmdCodificar(nota, prop, ns_.tabla.get(nota, prop));
        sync_ = true;
        EditController::setParamNormalized(kNoteCmd, cmd);
        sync_ = false;
        ns_.lastCmd = cmd;   // la orden propia no se vuelve a aplicar a la tabla
        beginEdit(kNoteCmd);
        performEdit(kNoteCmd, cmd);
        endEdit(kNoteCmd);
    }

    mutable std::recursive_mutex mtx_;
    NotaSync ns_;
    bool loading_{false}, sync_{false}, verificando_{false};
    float ocioso_{0.0f};
    std::deque<uint16_t> cola_;
    std::vector<uint16_t> enviados_;
    bool enCola_[kNotas][16]{};
};

} // namespace JasWaveGrandPiano

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveGrandPiano::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Grand Piano",
               Vst::kDistributable, Vst::PlugType::kInstrumentPiano, "1.0.0", kVstVersionString, JasWaveGrandPiano::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveGrandPiano::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Grand Piano Controller", 0, "", "1.0.0", kVstVersionString, JasWaveGrandPiano::Controller::createInstance)
END_FACTORY
