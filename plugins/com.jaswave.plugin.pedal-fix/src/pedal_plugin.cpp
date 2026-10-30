// JasWave Pedal Fix – VST3 efecto MIDI (procesador, controlador con IMidiMapping por canal, editor Cyber y factoría)
#include "pedal_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

#include <cstdio>

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWavePedal {

static const FUID kProcessorUid(0x4A617357, 0x5045444C, 0x50726F63, 0x56335431);   // "JasW" "PEDL" "Proc" "V3T1"
static const FUID kControllerUid(0x4A617357, 0x5045444C, 0x436E7472, 0x56335431);  // "JasW" "PEDL" "Cntr" "V3T1"

static const PluginDescriptor kDesc{ "com.jaswave.plugin.pedal-fix", "JasWave Pedal Fix", L"PEDAL FIX", nullptr, 0, false, true };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(pbus_ = std::make_shared<PedalBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double, int) override { engine_.reset(); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        PedalSettings s;
        s.bypass = boolOf(kBypass) || !licensed();   // sin licencia: el MIDI pasa intacto (nunca se rompe la sesión)
        s.umbral = intOf(kUmbral);
        s.transponer = intOf(kTransponer);
        s.velocidad = plainOf(kVelocidad) / 100.0;
        s.fuente = std::clamp(intOf(kFuente), 0, kNumPedales - 1);
        s.canalSalida = intOf(kCanal) - 1;           // 0 = Original → -1
        s.invertir = boolOf(kPolaridad);
        s.forzar = boolOf(kForzar);
        s.unificar = boolOf(kUnificar);
        s.retrigger = boolOf(kRetrigger);
        engine_.setSettings(s);
    }

    // Audio: paso directo (el plugin vive en la cadena de inserción) con medidores
    template <class T>
    void pasoT(const T* iL, const T* iR, T* oL, T* oR, int n) {
        float pi = 0.0f, po = 0.0f;
        for (int i = 0; i < n; ++i) {
            const T l = iL ? iL[i] : T(0), r = iR ? iR[i] : T(0);
            pi = std::max(pi, static_cast<float>(std::max(std::fabs(l), std::fabs(r))));
            oL[i] = l;
            oR[i] = r;
        }
        po = pi;
        pbus_->inPk[0].update(pi); pbus_->inPk[1].update(pi);
        pbus_->outPk[0].update(po); pbus_->outPk[1].update(po);
        pbus_->entrada(oL, oR, n);
        pbus_->salida(oL, oR, n);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { pasoT(iL, iR, oL, oR, n); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { pasoT(iL, iR, oL, oR, n); }
    uint32 tailSamples() override { return 0; }

    // ---- MIDI: entrada (eventos + CC por parámetros IMidiMapping) → salida reescrita ----
    struct PuntoPedal { int32 offset; int16 cc; int8 canal; int16 valor; };
    static constexpr int kMaxPuntos = 256;

    void processEvents(ProcessData& data) override {
        IEventList* out = data.outputEvents;
        if (!out) return;   // el host no enruta MIDI desde este plugin: nada que hacer
        const PedalSettings& s = engine_.settings();

        auto emitir = [&](const PedalOut& o) {
            Event e{};
            e.busIndex = 0;
            e.sampleOffset = o.offset;
            if (o.tipo == PedalOut::NoteOn) {
                e.type = Event::kNoteOnEvent;
                e.noteOn.channel = o.canal;
                e.noteOn.pitch = o.nota;
                e.noteOn.velocity = o.velocidad;
                e.noteOn.noteId = o.noteId;
            } else if (o.tipo == PedalOut::NoteOff) {
                e.type = Event::kNoteOffEvent;
                e.noteOff.channel = o.canal;
                e.noteOff.pitch = o.nota;
                e.noteOff.velocity = o.velocidad;
                e.noteOff.noteId = o.noteId;
            } else {
                e.type = Event::kLegacyMIDICCOutEvent;
                e.midiCCOut.channel = o.canal;
                e.midiCCOut.controlNumber = static_cast<uint8>(o.cc);
                e.midiCCOut.value = static_cast<int8>(o.valor);
                e.midiCCOut.value2 = 0;
            }
            out->addEvent(e);
        };

        // 1) CC del pedal que el host entrega como cambios de parámetro (IMidiMapping), con su offset de muestra
        int nPuntos = 0;
        if (IParameterChanges* ch = data.inputParameterChanges) {
            const int32 n = ch->getParameterCount();
            for (int32 i = 0; i < n && nPuntos < kMaxPuntos; ++i) {
                IParamValueQueue* q = ch->getParameterData(i);
                if (!q || !esCcParam(q->getParameterId())) continue;
                const uint32_t rel = q->getParameterId() - kCcParamBase;
                const int pedal = static_cast<int>(rel / 16), canal = static_cast<int>(rel % 16);
                const int32 pts = q->getPointCount();
                for (int32 k = 0; k < pts && nPuntos < kMaxPuntos; ++k) {
                    int32 off = 0;
                    ParamValue v = 0.0;
                    if (q->getPoint(k, off, v) != kResultTrue) continue;
                    PuntoPedal p{ std::max<int32>(0, off), static_cast<int16>(kPedalCc[pedal]), static_cast<int8>(canal),
                                  static_cast<int16>(std::lround(std::clamp(v, 0.0, 1.0) * 127.0)) };
                    // inserción ordenada por offset (estable): los puntos de un mismo instante conservan el orden
                    int j = nPuntos++;
                    while (j > 0 && puntos_[static_cast<size_t>(j - 1)].offset > p.offset) { puntos_[static_cast<size_t>(j)] = puntos_[static_cast<size_t>(j - 1)]; --j; }
                    puntos_[static_cast<size_t>(j)] = p;
                }
            }
        }

        IEventList* in = data.inputEvents;
        const int32 nIn = in ? in->getEventCount() : 0;

        if (s.bypass) {
            // Paso directo: eventos tal cual y los CC del pedal reconstruidos (el host ya los convirtió en parámetros)
            if (engine_.liberarPendiente()) engine_.soltarTodo(0, emitir);
            for (int32 i = 0; i < nIn; ++i) { Event e{}; if (in->getEvent(i, e) == kResultOk) out->addEvent(e); }
            for (int i = 0; i < nPuntos; ++i) {
                const PuntoPedal& p = puntos_[static_cast<size_t>(i)];
                emitir(PedalOut{ PedalOut::Cc, p.canal, 0, 0.0f, p.cc, p.valor, p.offset, -1 });
            }
            engine_.publicar(pbus_.get());
            return;
        }

        if (engine_.liberarPendiente()) engine_.soltarTodo(0, emitir);

        // 2) Mezcla ordenada de eventos del host y puntos del pedal
        int32 i = 0;
        int j = 0;
        Event e{};
        bool tengo = false;
        while (i < nIn || j < nPuntos) {
            if (!tengo && i < nIn) {
                if (in->getEvent(i, e) != kResultOk) { ++i; continue; }
                tengo = true;
            }
            const bool usarPedal = j < nPuntos && (!tengo || puntos_[static_cast<size_t>(j)].offset <= e.sampleOffset);
            if (usarPedal) {
                const PuntoPedal& p = puntos_[static_cast<size_t>(j++)];
                engine_.cc(p.canal, p.cc, p.valor, p.offset, emitir);
                continue;
            }
            tengo = false;
            ++i;
            switch (e.type) {
                case Event::kNoteOnEvent:
                    if (e.noteOn.velocity <= 0.0f) engine_.noteOff(e.noteOn.channel, e.noteOn.pitch, 0.0f, e.noteOn.noteId, e.sampleOffset, emitir);
                    else engine_.noteOn(e.noteOn.channel, e.noteOn.pitch, e.noteOn.velocity, e.noteOn.noteId, e.sampleOffset, emitir);
                    break;
                case Event::kNoteOffEvent:
                    engine_.noteOff(e.noteOff.channel, e.noteOff.pitch, e.noteOff.velocity, e.noteOff.noteId, e.sampleOffset, emitir);
                    break;
                case Event::kLegacyMIDICCOutEvent:
                    // Hosts que entregan los CC como eventos: misma ruta (la deduplicación absorbe el duplicado con el parámetro)
                    engine_.cc(e.midiCCOut.channel, e.midiCCOut.controlNumber, e.midiCCOut.value, e.sampleOffset, emitir);
                    break;
                case Event::kPolyPressureEvent: {
                    Event o = e;
                    if (s.canalSalida >= 0) o.polyPressure.channel = static_cast<int16>(s.canalSalida);
                    o.polyPressure.pitch = static_cast<int16>(std::clamp(static_cast<int>(e.polyPressure.pitch) + s.transponer, 0, 127));
                    out->addEvent(o);
                    break;
                }
                default:
                    out->addEvent(e);   // expresión de nota, acordes, SysEx…: sin cambios
                    break;
            }
        }
        engine_.publicar(pbus_.get());
    }

private:
    PedalEngine engine_;
    std::shared_ptr<PedalBus> pbus_;
    std::array<PuntoPedal, kMaxPuntos> puntos_{};
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"PEDAL FIX"; }
    const wchar_t* subtitle() const override { return L"SUSTAIN REAL · UNIFICA CANALES · POLARIDAD · TRANSPOSICIÓN"; }
    const char* visualizer() const override { return "espectro-dual"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoLila; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"PEDAL");
        P::principal(c, 0, kUmbral, L"UMBRAL");
        P::principal(c, 1, kTransponer, L"TRANSPONER");
        P::principal(c, 2, kVelocidad, L"VELOCIDAD");
        P::selector(c, 0, 1, kFuente, L"FUENTE");
        P::selector(c, 1, 1, kCanal, L"CANAL");
        P::selector(c, 2, 1, kPolaridad, L"POLARIDAD");
        P::salida(c, kBypass, L"SALIDA MIDI");
        P::interruptorSalida(c, 0, 0, 1, kForzar, L"FORZAR");
        P::interruptorSalida(c, 0, 1, 1, kUnificar, L"UNIFICAR");
        P::interruptorSalida(c, 1, 0, 1, kRetrigger, L"REDISPARO");
        // Sin ganancia de salida (efecto MIDI): el hueco del fader muestra el pedal efectivo (0–127)
        medidorPedal_ = P::medidorEnFader(c, L"PEDAL", 0.0f, 127.0f, false);
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<PedalBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        if (medidorPedal_) medidorPedal_->set(static_cast<float>(bus_->pedalSalida.load(std::memory_order_relaxed)), 127.0f);
        canalesPedal_ = bus_->canalesPedal.load(std::memory_order_relaxed);
        pedal_ = bus_->pedalSalida.load(std::memory_order_relaxed);
        retenidas_ = bus_->notasRetenidas.load(std::memory_order_relaxed);
        pulsadas_ = bus_->notasPulsadas.load(std::memory_order_relaxed);
        ultimoCc_ = bus_->ultimoCc.load(std::memory_order_relaxed);
        entrada_ = bus_->eventosEntrada.load(std::memory_order_relaxed);
        salida_ = bus_->eventosSalida.load(std::memory_order_relaxed);
        duplicados_ = bus_->duplicadosFiltrados.load(std::memory_order_relaxed);
        const uint16_t act = bus_->canalesNotas.exchange(0, std::memory_order_relaxed);
        for (int ch = 0; ch < 16; ++ch) {
            if ((act >> ch) & 1u) actividad_[static_cast<size_t>(ch)] = 1.0f;
            else actividad_[static_cast<size_t>(ch)] = std::max(0.0f, actividad_[static_cast<size_t>(ch)] - c.dt * 2.5f);
        }
        teclado_.actualizar(bus_->teclas[0].load(std::memory_order_relaxed), bus_->teclas[1].load(std::memory_order_relaxed), c.dt);
        hist_[static_cast<size_t>(histPos_)] = static_cast<float>(pedal_) / 127.0f;
        histPos_ = (histPos_ + 1) % kHist;
        // los LEDs del marco respiran con el pedal
        nivel_ += ((pedal_ > 0 ? 0.85f : 0.15f) - nivel_) * std::min(1.0f, c.dt * 8.0f);
    }
    float outputLevel() const override { return nivel_; }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext&) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Rect v = P::kVisual;
        P::panelVisual(g, L"MONITOR MIDI · PEDAL POR CANAL · NOTAS HACIA EL INSTRUMENTO");
        meters_.drawLabels(g);
        const Color ac = accent();

        // --- indicador grande del pedal (izquierda) ---
        const float cx = v.l + 92.0f, cy = v.t + 108.0f;
        const bool abajo = pedal_ > 0;
        g.circle(cx, cy, 52.0f, Pal::panelBorde, 1.5f);
        g.circle(cx, cy, 44.0f, ac.withAlpha(0.25f), 1.0f);
        if (abajo) g.glowDot(cx, cy, 30.0f + 8.0f * (static_cast<float>(pedal_) / 127.0f), ac);
        else g.fillCircle(cx, cy, 26.0f, hex(0x0A0C2A));
        g.text(abajo ? L"PISADO" : L"SUELTO", { cx - 60, cy + 56, cx + 60, cy + 72 }, Font::Label, abajo ? ac : Pal::textoTenue, Align::Center, true);
        wchar_t b[48];
        swprintf_s(b, L"CC%d  %d", kPedalCc[0], pedal_);
        g.text(b, { cx - 60, cy + 74, cx + 60, cy + 90 }, Font::ValueSmall, Pal::textoValor, Align::Center);

        // --- rejilla de 16 canales (2 filas × 8): LED del pedal + barra de actividad de notas ---
        const Rect grid{ v.l + 170.0f, v.t + 40.0f, v.r - 14.0f, v.t + 180.0f };
        g.text(L"CANALES  ·  pedal (anillo)  ·  notas (barra)", { grid.l, grid.t - 20.0f, grid.r, grid.t - 6.0f }, Font::Label, Pal::textoEtiqueta, Align::Left, true);
        const float cw = grid.w() / 8.0f, chh = grid.h() / 2.0f;
        for (int ch = 0; ch < 16; ++ch) {
            const int col = ch % 8, fila = ch / 8;
            const Rect cell{ grid.l + col * cw + 3.0f, grid.t + fila * chh + 3.0f, grid.l + (col + 1) * cw - 3.0f, grid.t + (fila + 1) * chh - 3.0f };
            const bool pedalCh = (canalesPedal_ >> ch) & 1u;
            const float act = actividad_[static_cast<size_t>(ch)];
            g.fillChamfer(cell, 4.0f, hex(0x080A22, 0.7f));
            g.strokeChamfer(cell, 4.0f, pedalCh ? ac : Pal::panelBorde, pedalCh ? 1.5f : 1.0f);
            swprintf_s(b, L"%d", ch + 1);
            g.text(b, { cell.l + 4, cell.t + 2, cell.r - 4, cell.t + 16 }, Font::ValueSmall, pedalCh ? ac : Pal::textoTenue, Align::Left);
            const float lx = cell.r - 10.0f, ly = cell.t + 9.0f;
            if (pedalCh) g.glowDot(lx, ly, 3.5f, ac); else g.circle(lx, ly, 3.0f, Pal::textoTenue, 1.0f);
            const Rect bar{ cell.l + 4.0f, cell.b - 10.0f, cell.r - 4.0f, cell.b - 4.0f };
            g.fillRect(bar, hex(0x03030F));
            if (act > 0.0f) g.fillRect({ bar.l, bar.t, bar.l + bar.w() * act, bar.b }, Pal::cian.withAlpha(0.35f + 0.5f * act));
        }

        // --- historial del pedal (traza) ---
        const Rect h{ v.l + 170.0f, v.t + 196.0f, v.r - 14.0f, v.t + 236.0f };
        g.text(L"PEDAL EFECTIVO (ÚLTIMOS SEGUNDOS)", { h.l, h.t - 16.0f, h.r, h.t - 2.0f }, Font::Label, Pal::textoEtiqueta, Align::Left, true);
        g.fillRect(h, hex(0x03030F, 0.6f));
        for (int i = 0; i < kHist; ++i) {
            const float val = hist_[static_cast<size_t>((histPos_ + i) % kHist)];
            hpts_[static_cast<size_t>(i)] = { h.l + h.w() * i / (kHist - 1), h.b - 2.0f - val * (h.h() - 4.0f) };
        }
        Kit::wireTrace(g, hpts_.data(), kHist, ac, h.b, true);

        // --- teclado: notas que llegan al instrumento (pulsadas o retenidas por el pedal) ---
        teclado_.dibujar(g, { v.l + 14.0f, v.b - 70.0f, v.r - 14.0f, v.b - 14.0f }, ac);

        // --- mini-panel: estadísticas ---
        P::panelMedicion(g, L"ESTADÍSTICAS DEL FLUJO MIDI");
        const Rect m = P::kMiniGrafico;
        const float y0 = m.t + 6.0f;
        auto fila = [&](int i, const wchar_t* et, const wchar_t* val, Color c) {
            const float y = y0 + i * 22.0f;
            g.text(et, { m.l, y, m.l + 170.0f, y + 16.0f }, Font::Label, Pal::textoEtiqueta, Align::Left, true);
            g.text(val, { m.l + 172.0f, y, m.r, y + 16.0f }, Font::Value, c, Align::Left);
        };
        swprintf_s(b, L"%llu", static_cast<unsigned long long>(entrada_));
        fila(0, L"EVENTOS RECIBIDOS", b, Pal::textoValor);
        swprintf_s(b, L"%llu", static_cast<unsigned long long>(salida_));
        fila(1, L"EVENTOS ENVIADOS", b, Pal::textoValor);
        swprintf_s(b, L"%llu", static_cast<unsigned long long>(duplicados_));
        fila(2, L"PEDAL DUPLICADO FILTRADO", b, duplicados_ ? ac : Pal::textoValor);
        if (ultimoCc_ & 0x80000000u) swprintf_s(b, L"CC%u  canal %u  = %u", (ultimoCc_ >> 16) & 0x7F, ((ultimoCc_ >> 8) & 0x0F) + 1, ultimoCc_ & 0x7F);
        else swprintf_s(b, L"—");
        fila(3, L"ÚLTIMO PEDAL RECIBIDO", b, Pal::textoValor);
        swprintf_s(b, L"%d", retenidas_);
        P::lectura(g, 0, 0, L"RETENIDAS", b, retenidas_ ? ac : Pal::textoValor);
        swprintf_s(b, L"%d", pulsadas_);
        P::lectura(g, 0, 1, L"PULSADAS", b);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.pedal-fix"; }

private:
    static constexpr int kHist = 240;
    std::shared_ptr<PedalBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Meter* medidorPedal_{nullptr};
    JasWaveUI::Plantilla::Teclado88 teclado_;
    std::array<JasWaveUI::Pt, kHist> hpts_{};
    std::array<float, kHist> hist_{};
    std::array<float, 16> actividad_{};
    int histPos_{0};
    uint16_t canalesPedal_{0};
    int pedal_{0}, retenidas_{0}, pulsadas_{0};
    uint32_t ultimoCc_{0};
    uint64_t entrada_{0}, salida_{0}, duplicados_{0};
    float nivel_{0.15f};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        const tresult r = JwController::initialize(context);
        if (r != kResultOk) return r;
        // Un parámetro oculto por (pedal, canal): así el host entrega CC64/66/67/69 de los 16 canales con su
        // offset de muestra (VST3 no pasa CC como eventos). No se guardan en el estado ni salen en el editor.
        for (int p = 0; p < kNumPedales; ++p) {
            for (int ch = 0; ch < 16; ++ch) {
                ParameterInfo info{};
                info.id = ccParamId(p, ch);
                char nombre[48];
                std::snprintf(nombre, sizeof nombre, "MIDI CC%d ch%d", kPedalCc[p], ch + 1);
                asciiToTChar(nombre, info.title, 128);
                asciiToTChar(nombre, info.shortTitle, 128);
                info.stepCount = 0;
                info.defaultNormalizedValue = 0.0;
                info.unitId = kRootUnitId;
                info.flags = ParameterInfo::kIsHidden;
                parameters.addParameter(new Parameter(info));
            }
        }
        return kResultOk;
    }

    tresult PLUGIN_API getMidiControllerAssignment(int32 busIndex, int16 channel, CtrlNumber cc, ParamID& id) SMTG_OVERRIDE {
        if (busIndex != 0 || channel < 0 || channel > 15) return kResultFalse;
        const int p = indicePedal(static_cast<int>(cc));
        if (p < 0) return kResultFalse;
        id = ccParamId(p, channel);
        return kResultTrue;
    }

    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override { return {}; }
};

} // namespace JasWavePedal

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWavePedal::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
               "JasWave Pedal Fix", Vst::kDistributable, Vst::PlugType::kFxTools, "1.0.0", kVstVersionString,
               JasWavePedal::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWavePedal::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Pedal Fix Controller", 0, "", "1.0.0", kVstVersionString, JasWavePedal::Controller::createInstance)
END_FACTORY
