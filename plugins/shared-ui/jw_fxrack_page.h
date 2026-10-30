// =====================================================================================
//  JasWave UI – pagina «MIX / FX» comun (FX Rack, shared-dsp/jw_fxrack.h)
//
//  Una sola llamada al FINAL de PluginEditor::build() anade a cualquier editor:
//    - un boton «MIX / FX» en la cabecera (alterna entre el editor del plugin y la pagina),
//    - la pagina a pantalla completa: grafica del ecualizador de 6 bandas (curva en vivo sobre el espectro de
//      salida, 6 nodos arrastrables, rueda = Q, doble clic = reset de banda), filtros paso-altos/bajos,
//      compresor con medidor de reduccion, saturacion, chorus, delay (sync al tempo), reverb y anchura/salida,
//    - un boton RESET FX que devuelve SOLO los parametros del rack a su valor por defecto (el RESET de la
//      cabecera sigue restaurando todo el plugin).
//
//      void build(JasWaveUI::EditorContext& c) override {
//          ... widgets del plugin ...
//          JasWaveUI::Plantilla::paginaMixFx(c);            // base = FXR_BASE (100)
//      }
//
//  No toca el resto de la plantilla: al abrir la pagina se ocultan los widgets del plugin y se suprime su
//  drawPanels (EditorContext::suppressPanels); al cerrarla se restauran. Todos los widgets de la pagina llevan
//  `pagina = 1` (el volcado ui-layout.json los marca para la replica web).
// =====================================================================================
#pragma once

#include "jw_fxrack.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include <chrono>
#include <cwchar>
#include <memory>
#include <string>
#include <vector>

namespace JasWaveUI {
namespace Plantilla {

namespace MixFx {

constexpr double kDbMin = -18.0, kDbMax = 18.0;                 // escala vertical de la grafica del EQ
constexpr Rect kGrafica{ 70.0f, 120.0f, 612.0f, 276.0f };      // area de la curva (la geometria completa esta en pagina())
constexpr float kRadioNodo = 7.0f;

inline const wchar_t* tipoBanda(int b) { return b == 0 ? L"LOW SHELF" : (b == JasWaveFx::kBands - 1 ? L"HIGH SHELF" : L"PEAK"); }

class Estado;

// Una perilla de la banda seleccionada (frecuencia / ganancia / Q): el volcado de layout marca su rol
class KnobBanda : public Knob {
public:
    KnobBanda(uint32_t id, float cx, float cy, KnobSize s, const wchar_t* label, const char* rol) : Knob(id, cx, cy, s, label), rol_(rol) {}
    std::string layoutExtra() const override { return std::string(", \"bandaRol\": \"") + rol_ + "\""; }
    // Se reasigna a cualquiera de las 6 bandas del EQ del rack: todas quedan expuestas
    void parametrosCubiertos(std::vector<uint32_t>& ids) const override {
        for (int b = 0; b < JasWaveFx::kBands; ++b)
            ids.push_back(baseRack + static_cast<uint32_t>(rol_[0] == 'f' ? JasWaveFx::eqFreq(b) : rol_[0] == 'g' ? JasWaveFx::eqGain(b) : JasWaveFx::eqQ(b)));
    }
    uint32_t baseRack{JasWaveFx::kBase};
private:
    const char* rol_;
};

// Estado compartido de la pagina (banda seleccionada, visibilidad). Vive mientras vivan sus widgets.
class Estado {
public:
    EditorContext* ctx{nullptr};
    uint32_t base{JasWaveFx::kBase};
    int banda{2};
    bool activa{false};
    Knob *kFreq{nullptr}, *kGain{nullptr}, *kQ{nullptr};
    Button* boton{nullptr};
    std::vector<Button*> botonesBanda;
    std::vector<char> visPrev;
    uint8_t numero{1};

    void seleccionar(int b) {
        banda = b < 0 ? 0 : (b >= JasWaveFx::kBands ? JasWaveFx::kBands - 1 : b);
        if (kFreq) kFreq->setParam(base + JasWaveFx::eqFreq(banda));
        if (kGain) kGain->setParam(base + JasWaveFx::eqGain(banda));
        if (kQ) kQ->setParam(base + JasWaveFx::eqQ(banda));
    }
    // Widgets de la cabecera que siguen visibles con la pagina abierta (RESET y selector BÁSICO | AVANZADO)
    static bool fija(const Widget* w) { const std::string k = w->kind(); return k == "reset" || k == "modo"; }
    // Muestra la pagina (oculta los widgets del plugin y suprime su visualizador) o la cierra
    void activar(bool on) {
        if (!ctx || on == activa) return;
        auto& ws = ctx->widgets;
        if (on) {
            visPrev.assign(ws.size(), 1);
            for (size_t i = 0; i < ws.size(); ++i) {
                Widget* w = ws[i].get();
                visPrev[i] = w->visible ? 1 : 0;
                if (w->pagina == numero || w == boton || fija(w)) continue;
                w->visible = false;
            }
        } else {
            for (size_t i = 0; i < ws.size() && i < visPrev.size(); ++i) {
                Widget* w = ws[i].get();
                if (w->pagina == numero || w == boton || fija(w)) continue;
                w->visible = visPrev[i] != 0;
            }
        }
        for (auto& w : ws) if (w->pagina == numero) w->visible = on;
        ctx->suppressPanels = on;
        activa = on;
        if (boton) boton->caption = on ? L"EDITOR" : L"MIX / FX";
    }
};

// Boton de la cabecera: LED cian si hay algun bloque del rack activo
class BotonPagina : public Button {
public:
    BotonPagina(Rect r, std::function<void()> a, std::shared_ptr<Estado> st) : Button(r, L"MIX / FX", std::move(a)), st_(std::move(st)) {}
    void draw(Gfx& g, ParamAccess& p, bool hover) override {
        const float rad = rect.h() * 0.5f;
        const bool on = st_->activa;
        g.fillRound(rect, rad, Pal::cian.withAlpha(on ? 0.34f : (hover ? 0.26f : 0.10f)));
        g.strokeRound(rect, rad, Pal::cian.withAlpha(on || hover ? 0.95f : 0.55f), 1.0f);
        g.text(caption, { rect.l + 8.0f, rect.t, rect.r - 14.0f, rect.b }, Font::Label, hover || on ? Pal::textoTitulo : Pal::cian, Align::Center, true);
        bool alguno = false;
        static const uint32_t ons[] = { JasWaveFx::HpfOn, JasWaveFx::LpfOn, JasWaveFx::EqOn, JasWaveFx::CompOn, JasWaveFx::SatOn, JasWaveFx::ChOn,
                                        JasWaveFx::DlOn, JasWaveFx::RvOn, JasWaveFx::OutOn };
        for (uint32_t o : ons) if (p.norm(st_->base + o) >= 0.5) { alguno = true; break; }
        if (alguno) g.glowDot(rect.r - 9.0f, rect.cy(), 2.6f, Pal::cianNucleo);
    }
    const char* kind() const override { return "pagina"; }
    int paginaDestino() const override { return 1; }
    bool paginaAbierta() const override { return st_->activa; }
    std::string layoutExtra() const override { return ", \"paginaDestino\": 1"; }
private:
    std::shared_ptr<Estado> st_;
};

// Boton de seleccion de banda (resalta la seleccionada)
class BotonBanda : public Button {
public:
    BotonBanda(Rect r, const wchar_t* t, int idx, std::shared_ptr<Estado> st)
        : Button(r, t, [st, idx] { st->seleccionar(idx); }), idx_(idx), st_(std::move(st)) {}
    void draw(Gfx& g, ParamAccess& p, bool hover) override {
        const bool sel = st_->banda == idx_;
        const Color c = gradienteMarca(static_cast<float>(idx_) / (JasWaveFx::kBands - 1));
        const bool tocada = std::fabs(p.plain(st_->base + JasWaveFx::eqGain(idx_))) > 0.05;
        g.fillChamfer(rect, 4.0f, sel ? c.withAlpha(0.30f) : hex(0x0A0C26));
        g.strokeChamfer(rect, 4.0f, sel || hover ? c : Pal::panelBorde, 1.0f);
        g.text(caption, rect, Font::Label, sel ? Pal::textoTitulo : Pal::textoEtiqueta, Align::Center, true);
        if (tocada) g.fillCircle(rect.r - 6.0f, rect.t + 6.0f, 1.8f, c);
    }
    std::string layoutExtra() const override { return ", \"selBanda\": " + std::to_string(idx_); }
private:
    int idx_;
    std::shared_ptr<Estado> st_;
};

// RESET FX: solo los parametros del rack
class BotonResetFx : public Button {
public:
    using Button::Button;
    void draw(Gfx& g, ParamAccess&, bool hover) override {
        const float rad = rect.h() * 0.5f;
        g.fillRound(rect, rad, Pal::alerta.withAlpha(hover ? 0.24f : 0.08f));
        g.strokeRound(rect, rad, Pal::alerta.withAlpha(hover ? 0.95f : 0.5f), 1.0f);
        g.text(caption, rect, Font::Label, hover ? Pal::textoTitulo : Pal::alerta, Align::Center, true);
    }
    const char* kind() const override { return "reset-fx"; }
};

// Grafica del ecualizador: espectro de salida + curva de respuesta (EQ + filtros) + 6 nodos arrastrables
class GraficaEq : public Widget {
public:
    GraficaEq(Rect r, std::shared_ptr<Estado> st, ParamAccess& pa) : Widget(r), st_(std::move(st)), base_(st_->base), pa_(&pa) {}
    const char* kind() const override { return "mixfx-eq"; }
    // El volcado incluye la definicion (rango, escala, nombre) de los 3 parametros de cada banda: la replica web
    // reasigna las perillas FREQ / GAIN / Q a la banda seleccionada y necesita sus rangos.
    std::string layoutExtra() const override {
        char b[200];
        std::snprintf(b, sizeof b, ", \"base\": %u, \"dbMin\": %.0f, \"dbMax\": %.0f, \"fMin\": 20, \"fMax\": 20000, \"bandas\": [", base_, kDbMin, kDbMax);
        std::string o = b;
        for (int k = 0; k < JasWaveFx::kBands; ++k) {
            o += k ? ", {" : "{";
            const char* rol[3] = { "freq", "gain", "q" };
            const uint32_t ids[3] = { JasWaveFx::eqFreq(k), JasWaveFx::eqGain(k), JasWaveFx::eqQ(k) };
            for (int r = 0; r < 3; ++r) {
                const JasWaveVst::ParamDef* d = pa_->def(base_ + ids[r]);
                char t[420];
                std::snprintf(t, sizeof t, "%s\"%s\": { \"param\": %u, \"min\": %.10g, \"max\": %.10g, \"defecto\": %.10g, \"escala\": \"%s\", \"decimales\": %d, \"bipolar\": %s, \"unidad\": \"%s\", \"nombre\": \"%s\" }",
                              r ? ", " : "", rol[r], base_ + ids[r], d ? d->minV : 0.0, d ? d->maxV : 1.0, d ? d->defV : 0.0,
                              d && d->map == JasWaveVst::Map::Log ? "log" : "linear", d ? d->decimals : 0, d && d->bipolar ? "true" : "false",
                              d && d->units ? d->units : "", d && d->name ? d->name : "");
                o += t;
            }
            o += "}";
        }
        return o + "]";
    }
    bool hit(float x, float y) const override { return rect.inset(-10.0f).contains(x, y); }

    void draw(Gfx& g, ParamAccess& p, bool) override {
        using namespace JasWaveFx;
        FxParams fp;
        fp.leer([&](uint32_t id) { return p.plain(id); }, base_);
        auto bus = p.bus();
        const double sr = bus ? bus->sampleRate.load(std::memory_order_relaxed) : 48000.0;
        g.fillRect(rect, hex(0x05061A, 0.55f));
        g.strokeRect(rect, Pal::panelBorde, 1.0f);
        if (bus) {
            const auto now = std::chrono::steady_clock::now();
            const float dt = last_.time_since_epoch().count() ? std::min(0.1f, std::chrono::duration<float>(now - last_).count()) : 1.0f / 60.0f;
            last_ = now;
            esp_.actualizar(*bus, dt, false, true);
            esp_.dibujar(g, rect, false, false, 0.45f);
        }
        Kit::freqAxis(g, rect);
        Kit::dbAxis(g, rect, kDbMin, kDbMax, 6.0);
        // marcas de los filtros paso-altos / paso-bajos
        if (fp.hpfOn) g.line(Kit::xForFreq(rect, fp.hpfHz), rect.t, Kit::xForFreq(rect, fp.hpfHz), rect.b, Pal::alerta.withAlpha(0.35f), 1.0f);
        if (fp.lpfOn) g.line(Kit::xForFreq(rect, fp.lpfHz), rect.t, Kit::xForFreq(rect, fp.lpfHz), rect.b, Pal::alerta.withAlpha(0.35f), 1.0f);
        // curva
        const bool viva = fp.eqOn || fp.hpfOn || fp.lpfOn;
        for (int i = 0; i < kN; ++i) {
            const double f = 20.0 * std::pow(1000.0, static_cast<double>(i) / (kN - 1));
            const double dbv = respuestaDb(fp, sr, f, fp.eqOn, true);
            pts_[static_cast<size_t>(i)] = { rect.l + rect.w() * i / (kN - 1), Kit::yForDb(rect, dbv, kDbMin, kDbMax) };
        }
        const float y0 = Kit::yForDb(rect, 0.0, kDbMin, kDbMax);
        const Color cc = viva ? Pal::cian : Pal::cian.withAlpha(0.35f);
        g.fillUnder(pts_.data(), kN, y0, cc.withAlpha(viva ? 0.13f : 0.05f));
        if (viva) g.glowPolyline(pts_.data(), kN, cc, 1.8f); else g.polyline(pts_.data(), kN, cc, 1.2f);
        // nodos
        for (int b = 0; b < kBands; ++b) {
            const Pt n = nodo(fp, b);
            const bool sel = st_->banda == b;
            const Color c = gradienteMarca(static_cast<float>(b) / (kBands - 1));
            const float r = sel ? kRadioNodo + 2.0f : kRadioNodo;
            if (sel) g.glowDot(n.x, n.y, r + 1.0f, c.withAlpha(0.8f));
            g.fillCircle(n.x, n.y, r, fp.eqOn ? hex(0x0B0D27) : hex(0x0B0D27, 0.6f));
            g.circle(n.x, n.y, r, fp.eqOn ? c : c.withAlpha(0.45f), sel ? 2.0f : 1.4f);
            wchar_t num[4];
            swprintf_s(num, L"%d", b + 1);
            g.text(num, { n.x - 8.0f, n.y - 7.0f, n.x + 8.0f, n.y + 7.0f }, Font::ValueSmall, fp.eqOn ? Pal::textoTitulo : Pal::textoTenue, Align::Center);
        }
        // lectura de la banda seleccionada
        {
            const EqBand& e = fp.eq[st_->banda];
            wchar_t fb[24], buf[160];
            if (e.hz >= 1000.0) swprintf_s(fb, L"%.2f kHz", e.hz / 1000.0); else swprintf_s(fb, L"%.0f Hz", e.hz);
            swprintf_s(buf, L"BANDA %d · %ls · %ls · %+.1f dB · Q %.2f", st_->banda + 1, tipoBanda(st_->banda), fb, e.gainDb, e.q);
            g.text(buf, { 196.0f, 98.0f, 478.0f, 116.0f }, Font::ValueSmall, Pal::textoValor, Align::Left);
            g.text(L"ARRASTRA: FREQ / GAIN", { 500.0f, 334.0f, 646.0f, 348.0f }, Font::ValueSmall, Pal::textoTenue, Align::Right);
            g.text(L"RUEDA: Q", { 500.0f, 348.0f, 646.0f, 362.0f }, Font::ValueSmall, Pal::textoTenue, Align::Right);
            g.text(L"DOBLE CLIC: RESET BANDA", { 500.0f, 362.0f, 646.0f, 376.0f }, Font::ValueSmall, Pal::textoTenue, Align::Right);
        }
    }

    bool onDown(const MouseEvent& e, ParamAccess& p) override {
        using namespace JasWaveFx;
        FxParams fp;
        fp.leer([&](uint32_t id) { return p.plain(id); }, base_);
        const int b = buscar(fp, e.x, e.y);
        if (b < 0) return false;
        st_->seleccionar(b);
        drag_ = b;
        down_ = { e.x, e.y };
        const Pt n = nodo(fp, b);
        start_ = n;
        p.beginEdit(base_ + eqFreq(b));
        p.beginEdit(base_ + eqGain(b));
        if (!fp.eqOn) p.setNorm(base_ + EqOn, 1.0);   // tocar un nodo enciende el ecualizador
        return true;
    }
    void onDrag(const MouseEvent& e, ParamAccess& p) override {
        using namespace JasWaveFx;
        if (drag_ < 0) return;
        const float k = e.shift ? 0.2f : 1.0f;
        const float x = start_.x + (e.x - down_.x) * k, y = start_.y + (e.y - down_.y) * k;
        const JasWaveVst::ParamDef* df = p.def(base_ + eqFreq(drag_));
        const JasWaveVst::ParamDef* dg = p.def(base_ + eqGain(drag_));
        if (df) {
            double f = Kit::freqForX(rect, x);
            f = std::min(std::max(f, df->minV), df->maxV);
            p.performEdit(base_ + eqFreq(drag_), JasWaveVst::toNorm(*df, f));
        }
        if (dg) {
            double gdb = kDbMin + (rect.b - y) / rect.h() * (kDbMax - kDbMin);
            gdb = std::round(gdb * 10.0) / 10.0;
            if (std::fabs(gdb) < 0.35) gdb = 0.0;   // imán a 0 dB
            gdb = std::min(std::max(gdb, dg->minV), dg->maxV);
            p.performEdit(base_ + eqGain(drag_), JasWaveVst::toNorm(*dg, gdb));
        }
    }
    void onUp(const MouseEvent&, ParamAccess& p) override {
        using namespace JasWaveFx;
        if (drag_ < 0) return;
        p.endEdit(base_ + eqFreq(drag_));
        p.endEdit(base_ + eqGain(drag_));
        drag_ = -1;
    }
    void onDouble(const MouseEvent& e, ParamAccess& p) override {
        using namespace JasWaveFx;
        FxParams fp;
        fp.leer([&](uint32_t id) { return p.plain(id); }, base_);
        const int b = buscar(fp, e.x, e.y);
        if (b < 0) return;
        for (uint32_t id : { eqFreq(b), eqGain(b), eqQ(b) })
            if (const JasWaveVst::ParamDef* d = p.def(base_ + id)) p.setNorm(base_ + id, JasWaveVst::defaultNorm(*d));
    }
    void onWheel(const MouseEvent& e, ParamAccess& p) override {
        using namespace JasWaveFx;
        if (e.wheel == 0) return;
        FxParams fp;
        fp.leer([&](uint32_t id) { return p.plain(id); }, base_);
        int b = buscar(fp, e.x, e.y);
        if (b < 0) b = st_->banda;
        const uint32_t id = base_ + eqQ(b);
        p.setNorm(id, std::min(1.0, std::max(0.0, p.norm(id) + e.wheel * (e.shift ? 0.01 : 0.04))));
        st_->seleccionar(b);
    }

private:
    static constexpr int kN = 180;
    Pt nodo(const JasWaveFx::FxParams& fp, int b) const {
        return { Kit::xForFreq(rect, fp.eq[b].hz), Kit::yForDb(rect, fp.eq[b].gainDb, kDbMin, kDbMax) };
    }
    int buscar(const JasWaveFx::FxParams& fp, float x, float y) const {
        int best = -1;
        float bd = 15.0f * 15.0f;
        for (int b = 0; b < JasWaveFx::kBands; ++b) {
            const Pt n = nodo(fp, b);
            const float d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
            if (d <= bd) { bd = d; best = b; }
        }
        return best;
    }
    std::shared_ptr<Estado> st_;
    uint32_t base_;
    ParamAccess* pa_;
    EspectroDual esp_;
    std::array<Pt, kN> pts_{};
    std::chrono::steady_clock::time_point last_{};
    int drag_{-1};
    Pt down_{0, 0}, start_{0, 0};
};

// Medidor de reduccion de ganancia del compresor integrado (lee MeterBusBase::fxGrDb)
class MedidorGr : public Widget {
public:
    MedidorGr(Rect r, uint32_t base) : Widget(r), base_(base) {}
    const char* kind() const override { return "mixfx-gr"; }
    std::string layoutExtra() const override { char b[64]; std::snprintf(b, sizeof b, ", \"base\": %u, \"maxDb\": 24", base_); return b; }
    void draw(Gfx& g, ParamAccess& p, bool) override {
        auto bus = p.bus();
        const auto now = std::chrono::steady_clock::now();
        const float dt = last_.time_since_epoch().count() ? std::min(0.1f, std::chrono::duration<float>(now - last_).count()) : 1.0f / 60.0f;
        last_ = now;
        const float gr = bus ? bus->fxGrDb.load(std::memory_order_relaxed) : 0.0f;
        gr_ = std::max(gr, gr_ - 48.0f * dt);
        pico_ = gr_ >= pico_ ? gr_ : std::max(gr_, pico_ - 12.0f * dt);
        const bool on = p.norm(base_ + JasWaveFx::CompOn) >= 0.5;
        barraGR(g, { rect.l, rect.t, rect.r - 58.0f, rect.b }, on ? gr_ : 0.0f, on ? pico_ : 0.0f, on ? Pal::cian : Pal::cian.withAlpha(0.4f));
        wchar_t b[24];
        swprintf_s(b, L"GR %4.1f dB", on ? gr_ : 0.0f);
        g.text(b, { rect.r - 54.0f, rect.t - 3.0f, rect.r + 4.0f, rect.b + 3.0f }, Font::ValueSmall, on ? Pal::textoValor : Pal::textoTenue, Align::Right);
    }
private:
    uint32_t base_;
    float gr_{0.0f}, pico_{0.0f};
    std::chrono::steady_clock::time_point last_{};
};

}  // namespace MixFx

// Anade la pagina MIX / FX al editor (llamar al FINAL de build()). `base` = FXR_BASE (100) salvo que el plugin
// haya registrado el rack con otra base. Devuelve el estado (normalmente se ignora).
inline std::shared_ptr<MixFx::Estado> paginaMixFx(EditorContext& c, uint32_t base = JasWaveFx::kBase) {
    using namespace JasWaveFx;
    auto st = std::make_shared<MixFx::Estado>();
    st->ctx = &c;
    st->base = base;
    const size_t i0 = c.widgets.size();
    auto K = [&](uint32_t off, float cx, float cy, const wchar_t* label) { return c.knob(base + off, cx, cy, KnobSize::Small, label); };

    // ---- paneles (secciones con la pildora de activacion del bloque) ----
    c.section({ 52.0f, 92.0f, 652.0f, 404.0f }, L"ECUALIZADOR", static_cast<int>(base + EqOn));
    c.section({ 666.0f, 92.0f, 1048.0f, 250.0f }, L"COMPRESOR", static_cast<int>(base + CompOn));
    c.section({ 666.0f, 258.0f, 1048.0f, 404.0f }, L"SATURACIÓN", static_cast<int>(base + SatOn));
    c.section({ 52.0f, 418.0f, 262.0f, 556.0f }, L"CHORUS", static_cast<int>(base + ChOn));
    c.section({ 274.0f, 418.0f, 606.0f, 556.0f }, L"DELAY", static_cast<int>(base + DlOn));
    c.section({ 618.0f, 418.0f, 918.0f, 556.0f }, L"REVERB", static_cast<int>(base + RvOn));
    c.section({ 930.0f, 418.0f, 1048.0f, 556.0f }, L"SALIDA", static_cast<int>(base + OutOn));

    // ---- ecualizador: grafica, selector de banda, perillas de la banda, filtros ----
    c.widgets.push_back(std::make_unique<MixFx::GraficaEq>(MixFx::kGrafica, st, c.params));
    static const wchar_t* nomB[kBands] = { L"1 LS", L"2 PK", L"3 PK", L"4 PK", L"5 PK", L"6 HS" };
    for (int b = 0; b < kBands; ++b) {
        auto btn = std::make_unique<MixFx::BotonBanda>(Rect{ 70.0f + 60.0f * b, 296.0f, 70.0f + 60.0f * b + 56.0f, 314.0f }, nomB[b], b, st);
        st->botonesBanda.push_back(btn.get());
        c.widgets.push_back(std::move(btn));
    }
    auto kb = [&](uint32_t off, float cx, const wchar_t* label, const char* rol) {
        auto k = std::make_unique<MixFx::KnobBanda>(base + off, cx, 346.0f, KnobSize::Small, label, rol);
        k->baseRack = base;
        Knob* raw = k.get();
        c.widgets.push_back(std::move(k));
        return raw;
    };
    st->kFreq = kb(eqFreq(st->banda), 96.0f, L"FREQ", "freq");
    st->kGain = kb(eqGain(st->banda), 148.0f, L"GAIN", "gain");
    st->kQ = kb(eqQ(st->banda), 200.0f, L"Q", "q");
    c.toggle(base + HpfOn, { 268.0f, 328.0f, 318.0f, 346.0f }, L"HPF");
    K(HpfFreq, 346.0f, 346.0f, L"FREQ");
    c.dropdown(base + HpfSlope, { 268.0f, 384.0f, 372.0f, 400.0f }, L"");
    c.toggle(base + LpfOn, { 410.0f, 328.0f, 460.0f, 346.0f }, L"LPF");
    K(LpfFreq, 488.0f, 346.0f, L"FREQ");
    c.dropdown(base + LpfSlope, { 410.0f, 384.0f, 514.0f, 400.0f }, L"");
    auto reset = std::make_unique<MixFx::BotonResetFx>(Rect{ 482.0f, 96.0f, 574.0f, 114.0f }, L"RESET FX", [&c, base] {
        for (uint32_t o = 0; o < kRango; ++o)
            if (const JasWaveVst::ParamDef* d = c.params.def(base + o)) if (!d->readOnly) c.params.setNorm(base + o, JasWaveVst::defaultNorm(*d));
    });
    c.widgets.push_back(std::move(reset));

    // ---- compresor ----
    c.widgets.push_back(std::make_unique<MixFx::MedidorGr>(Rect{ 682.0f, 128.0f, 1034.0f, 140.0f }, base));
    const float kx[7] = { 692.0f, 744.0f, 796.0f, 848.0f, 900.0f, 952.0f, 1004.0f };
    K(CompThresh, kx[0], 196.0f, L"THRESH");
    K(CompRatio, kx[1], 196.0f, L"RATIO");
    K(CompAttack, kx[2], 196.0f, L"ATTACK");
    K(CompRelease, kx[3], 196.0f, L"RELEASE");
    K(CompKnee, kx[4], 196.0f, L"KNEE");
    K(CompMakeup, kx[5], 196.0f, L"MAKEUP");
    K(CompMix, kx[6], 196.0f, L"MIX");

    // ---- saturacion ----
    c.dropdown(base + SatType, { 682.0f, 312.0f, 784.0f, 330.0f }, L"TIPO");
    K(SatDrive, 832.0f, 338.0f, L"DRIVE");
    K(SatTone, 902.0f, 338.0f, L"TONE");
    K(SatMix, 972.0f, 338.0f, L"MIX");

    // ---- chorus ----
    K(ChDepth, 88.0f, 478.0f, L"DEPTH");
    K(ChRate, 150.0f, 478.0f, L"RATE");
    K(ChMix, 212.0f, 478.0f, L"MIX");

    // ---- delay ----
    K(DlTime, 320.0f, 470.0f, L"TIME");
    K(DlFeedback, 395.0f, 470.0f, L"FEEDBACK");
    K(DlTone, 470.0f, 470.0f, L"TONE");
    K(DlMix, 545.0f, 470.0f, L"MIX");
    c.dropdown(base + DlSync, { 290.0f, 520.0f, 408.0f, 538.0f }, L"SYNC");
    c.toggle(base + DlPingPong, { 420.0f, 520.0f, 520.0f, 538.0f }, L"PING-PONG");

    // ---- reverb ----
    K(RvSize, 660.0f, 470.0f, L"SIZE");
    K(RvDamping, 722.0f, 470.0f, L"DAMPING");
    K(RvPreDelay, 784.0f, 470.0f, L"PRE-DLY");
    K(RvMix, 846.0f, 470.0f, L"MIX");
    c.dropdown(base + RvType, { 634.0f, 520.0f, 752.0f, 538.0f }, L"TIPO");

    // ---- salida ----
    K(OutWidth, 962.0f, 470.0f, L"WIDTH");
    K(OutGain, 1018.0f, 470.0f, L"GAIN");

    // todo lo anterior pertenece a la pagina y arranca oculto
    for (size_t i = i0; i < c.widgets.size(); ++i) { c.widgets[i]->pagina = st->numero; c.widgets[i]->visible = false; }

    // boton de la cabecera (visible siempre; es del editor base)
    auto b = std::make_unique<MixFx::BotonPagina>(Rect{ 484.0f, 48.0f, 568.0f, 68.0f }, [st] { st->activar(!st->activa); }, st);
    st->boton = b.get();
    c.widgets.push_back(std::move(b));
    if (gPaginaInicial == st->numero) st->activar(true);   // solo capturas
    return st;
}

}  // namespace Plantilla
}  // namespace JasWaveUI
