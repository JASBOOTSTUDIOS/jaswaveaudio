// JasWave UI – vista VST3 (HWND), núcleo de pintado compartido con las capturas PNG y overlay de licencia
#include "jw_ui.h"
#include "jw_ui_plantilla.h"
#include "jw_vst3.h"

#include "public.sdk/source/common/pluginview.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"

#include <commctrl.h>
#include <wincodec.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "windowscodecs.lib")

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace JasWaveUI {

namespace {
std::wstring widen(const std::string& s) {
    if (s.empty()) return std::wstring();
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(std::max(0, n)), L'\0');
    if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), &w[0], n);
    return w;
}
std::string utf8(const wchar_t* w) {
    if (!w || !*w) return std::string();
    const int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(std::max(0, n - 1)), '\0');
    if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
    return s;
}
std::string jsonStr(const std::string& v) {
    std::string o = "\"";
    for (const char ch : v) {
        if (ch == '"' || ch == '\\') o.push_back('\\');
        o.push_back(ch);
    }
    return o + "\"";
}
std::string jsonRect(const Rect& r) {
    char b[96];
    std::snprintf(b, sizeof b, "[%.1f,%.1f,%.1f,%.1f]", r.l, r.t, r.r, r.b);
    return b;
}
std::string jsonColor(Color c) {
    char b[16];
    std::snprintf(b, sizeof b, "#%02X%02X%02X", static_cast<int>(std::lround(c.r * 255.0f)), static_cast<int>(std::lround(c.g * 255.0f)),
                  static_cast<int>(std::lround(c.b * 255.0f)));
    return jsonStr(b);
}
HINSTANCE moduleInstance() {
    HMODULE h = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&moduleInstance), &h);
    return h;
}
} // namespace

// ---------------------------------------------------------------------------------
//  Acceso a parámetros sobre el controlador
// ---------------------------------------------------------------------------------
class ControllerAccess : public ParamAccess {
public:
    explicit ControllerAccess(JasWaveVst::JwController* c) : c_(c) {}
    const JasWaveVst::ParamDef* def(uint32_t id) const override { return c_->table().find(id); }
    double norm(uint32_t id) const override { return c_->getParamNormalized(id); }
    double plain(uint32_t id) const override { return c_->plain(id); }
    void beginEdit(uint32_t id) override { c_->beginEdit(id); }
    void performEdit(uint32_t id, double n) override {
        n = JasWaveVst::clamp01(n);
        c_->setParamNormalized(id, n);
        c_->performEdit(id, n);
    }
    void endEdit(uint32_t id) override { c_->endEdit(id); }
    bool locked(uint32_t id) const override {
        const JasWaveVst::ParamDef* d = def(id);
        return d && d->feature >= 0 && !featureGranted(d->feature);
    }
    bool featureGranted(int f) const override { return JasWaveLicense::hasFeature(JasWaveLicense::Manager::instance().state(), f); }
    std::shared_ptr<JasWaveDsp::MeterBusBase> bus() const override { return c_->bus(); }
private:
    JasWaveVst::JwController* c_;
};

// ---------------------------------------------------------------------------------
//  Botón RESET de la cabecera: todos los parámetros editables vuelven a su valor por defecto
// ---------------------------------------------------------------------------------
class ResetButton : public Button {
public:
    using Button::Button;
    void draw(Gfx& g, ParamAccess&, bool hover) override {
        const float rad = rect.h() * 0.5f;
        g.fillRound(rect, rad, Pal::cian.withAlpha(hover ? 0.26f : 0.10f));
        g.strokeRound(rect, rad, Pal::cian.withAlpha(hover ? 0.95f : 0.55f), 1.0f);
        g.text(caption, rect, Font::Label, hover ? Pal::textoTitulo : Pal::cian, Align::Center, true);
    }
    const char* kind() const override { return "reset"; }
};

// ---------------------------------------------------------------------------------
//  Selector de modo de la cabecera: [ BÁSICO | AVANZADO ]
// ---------------------------------------------------------------------------------
constexpr Rect kRectModo{ 358.0f, 48.0f, 476.0f, 68.0f };
constexpr float kCorteModo = 410.0f;   // frontera entre las dos mitades

class SelectorModo : public Widget {
public:
    SelectorModo(Rect r, std::function<bool()> esBasico, std::function<void(bool)> cambiar)
        : Widget(r), esBasico_(std::move(esBasico)), cambiar_(std::move(cambiar)) { basico = 1; }
    void draw(Gfx& g, ParamAccess&, bool hover) override {
        const bool b = esBasico_();
        const float rad = rect.h() * 0.5f;
        const Rect izq{ rect.l, rect.t, kCorteModo, rect.b }, der{ kCorteModo, rect.t, rect.r, rect.b };
        g.fillRound(rect, rad, Pal::cian.withAlpha(hover ? 0.10f : 0.05f));
        g.fillRound(b ? izq : der, rad, Pal::cian.withAlpha(0.30f));
        g.strokeRound(rect, rad, Pal::cian.withAlpha(hover ? 0.95f : 0.55f), 1.0f);
        g.line(kCorteModo, rect.t + 4.0f, kCorteModo, rect.b - 4.0f, Pal::cian.withAlpha(0.35f), 1.0f);
        g.text(L"BÁSICO", izq, Font::Label, b ? Pal::textoTitulo : Pal::cian.withAlpha(0.75f), Align::Center, true);
        g.text(L"AVANZADO", der, Font::Label, b ? Pal::cian.withAlpha(0.75f) : Pal::textoTitulo, Align::Center, true);
    }
    bool onDown(const MouseEvent& e, ParamAccess&) override {
        const bool quiere = e.x < kCorteModo;
        if (quiere != esBasico_()) cambiar_(quiere);
        return false;
    }
    const char* kind() const override { return "modo"; }
    const wchar_t* text() const override { return L"BÁSICO|AVANZADO"; }
    std::string layoutExtra() const override {
        char b[64];
        std::snprintf(b, sizeof b, ", \"corte\": %.1f", kCorteModo);
        return b;
    }
private:
    std::function<bool()> esBasico_;
    std::function<void(bool)> cambiar_;
};

// ---------------------------------------------------------------------------------
//  Página automática «PARÁMETROS» (pagina = 2): todos los parámetros editables que el editor del plugin no expone
//  con un widget propio, en una rejilla. Garantiza que el modo Avanzado muestre el 100 % de la tabla.
// ---------------------------------------------------------------------------------
constexpr uint8_t kPaginaParametros = 2;

class BotonParametros : public Button {
public:
    BotonParametros(Rect r, int n, std::function<void()> a, std::function<bool()> abierta)
        : Button(r, L"", std::move(a)), abierta_(std::move(abierta)) {
        wchar_t b[32];
        swprintf_s(b, L"+%d PARÁM.", n);
        cerrado_ = b;
        caption = cerrado_;
        basico = 0;
    }
    void draw(Gfx& g, ParamAccess&, bool hover) override {
        const bool on = abierta_();
        caption = on ? L"◀ EDITOR" : cerrado_;
        const float rad = rect.h() * 0.5f;
        g.fillRound(rect, rad, Pal::cian.withAlpha(on ? 0.34f : (hover ? 0.26f : 0.10f)));
        g.strokeRound(rect, rad, Pal::cian.withAlpha(on || hover ? 0.95f : 0.55f), 1.0f);
        g.text(caption, rect, Font::Label, hover || on ? Pal::textoTitulo : Pal::cian, Align::Center, true);
    }
    const char* kind() const override { return "pagina"; }
    int paginaDestino() const override { return kPaginaParametros; }
    bool paginaAbierta() const override { return abierta_(); }
    std::string layoutExtra() const override { return ", \"paginaDestino\": 2, \"textoAbierta\": \"◀ EDITOR\""; }
private:
    std::wstring cerrado_;
    std::function<bool()> abierta_;
};

// Desplegable de la página de parámetros: nombre encima y caja debajo
class DropdownApilado : public Dropdown {
public:
    DropdownApilado(uint32_t id, Rect r, const wchar_t* label) : Dropdown(id, r, L""), nombre_(label ? label : L"") {}
    void draw(Gfx& g, ParamAccess& p, bool hover) override {
        const bool locked = p.locked(static_cast<uint32_t>(paramId()));
        g.text(nombre_, { rect.l - 8.0f, rect.t - 18.0f, rect.r + 8.0f, rect.t - 2.0f }, Font::Label, locked ? Pal::bloqueado : Pal::textoEtiqueta, Align::Center, true);
        Dropdown::draw(g, p, hover);
    }
    const wchar_t* text() const override { return nombre_.c_str(); }
    std::string layoutExtra() const override { return ", \"etiquetaArriba\": true"; }
private:
    std::wstring nombre_;
};

// Nombre legible de un parámetro para la rejilla (mayúsculas, UTF-8 -> UTF-16)
// Si no cabe bajo la perilla (~18 caracteres) se abrevian las palabras más largas ("REALIMENTACIÓN" -> "REAL.").
static std::wstring nombreParametro(const JasWaveVst::ParamDef& d) {
    constexpr size_t kMax = 18;
    std::wstring w = widen(d.name ? d.name : "");
    if (!w.empty()) CharUpperBuffW(&w[0], static_cast<DWORD>(w.size()));
    for (int guarda = 0; w.size() > kMax && guarda < 8; ++guarda) {
        size_t mejor = std::wstring::npos, largo = 0, i = 0;
        while (i < w.size()) {
            const size_t f = std::min(w.find(L' ', i), w.size());
            if (f - i > largo && w[f - 1] != L'.') { largo = f - i; mejor = i; }
            i = f + 1;
        }
        if (mejor == std::wstring::npos || largo <= 5) break;
        w = w.substr(0, mejor + 4) + L"." + w.substr(mejor + largo);
    }
    if (w.size() > kMax) w = w.substr(0, kMax - 1) + L"…";
    return w;
}

// ---------------------------------------------------------------------------------
//  Núcleo del editor: estado + pintado (ventana o bitmap)
// ---------------------------------------------------------------------------------
class EditorCore {
public:
    explicit EditorCore(JasWaveVst::JwController* c) : access_(c), ctx_(access_), ctl_(c), editor_(c->createEditor()) {
        QueryPerformanceFrequency(&freq_);
        if (editor_) {
            editor_->build(ctx_);
            if (editor_->modeParam() >= 0) mode_ = ctx_.dropdown(static_cast<uint32_t>(editor_->modeParam()), { 690.0f, 48.0f, 846.0f, 68.0f }, L"MODO");
        }
        construirPaginaParametros();
        ctx_.widgets.push_back(std::make_unique<SelectorModo>(kRectModo, [this] { return modoBasico(); }, [this](bool b) { cambiarModo(b); }));
        {
            // el botón se registra el último: queda por encima de los demás widgets en pintado y en hit-test
            JasWaveVst::JwController* ctl = c;
            ctx_.widgets.push_back(std::make_unique<ResetButton>(Rect{ 624.0f, 48.0f, 684.0f, 68.0f }, L"RESET", [this, ctl] {
                for (const auto& d : ctl->table().defs()) {
                    if (d.readOnly) continue;
                    access_.setNorm(d.id, JasWaveVst::defaultNorm(d));
                }
            }));
        }
        offsets_.assign(ctx_.widgets.size(), Pt{ 0.0f, 0.0f });
        if (gPaginaInicial == kPaginaParametros) activarParametros(true);   // solo capturas
        if (gPaginaInicial == 1 && botonParams_) botonParams_->visible = false;   // capturas de MIX / FX abierta
        aplicarModo();
        footer_ = widen(c->descriptor().productId);
        login_ = std::make_unique<Button>(Rect{ 460.0f, 352.0f, 640.0f, 384.0f }, L"INICIAR SESIÓN",
                                          [] { JasWaveLicense::Manager::instance().startActivation(); });
        cancel_ = std::make_unique<Button>(Rect{ 490.0f, 392.0f, 610.0f, 416.0f }, L"CANCELAR",
                                           [] { JasWaveLicense::Manager::instance().cancelActivation(); });
    }

    ~EditorCore() {
        // la vista se cierra: el procesador deja de alimentar los taps del espectro (coste cero)
        if (bus_) bus_->editoresAbiertos.fetch_sub(1, std::memory_order_relaxed);
    }

    void tick() {
        if (!bus_) {
            bus_ = access_.bus();
            if (bus_) bus_->editoresAbiertos.fetch_add(1, std::memory_order_relaxed);
        }
        LARGE_INTEGER now;
        QueryPerformanceCounter(&now);
        ctx_.dt = last_.QuadPart ? static_cast<float>(static_cast<double>(now.QuadPart - last_.QuadPart) / static_cast<double>(freq_.QuadPart))
                                 : 1.0f / 60.0f;
        last_ = now;
        if (editor_) editor_->tick(ctx_);
        const uint32_t s = JasWaveLicense::Manager::instance().serial();
        if (s != licSerial_) { licSerial_ = s; lic_ = JasWaveLicense::Manager::instance().uiStatus(); }
    }

    void paint(Gfx& g) {
        g.drawCachedBackground([](Gfx& gg) { Chrome::drawStaticBackground(gg); });
        const bool licensed = JasWaveLicense::isLicensed(lic_.state);
        const bool expiring = (lic_.state & JasWaveLicense::StateBits::kExpiringSoon) != 0;
        Chrome::drawHeader(g, editor_ ? editor_->title() : L"JASWAVE", editor_ ? editor_->subtitle() : L"", expiring, licensed,
                           editor_ ? editor_->accent() : Pal::acentoCian);
        aplicarModo();
        if (editor_ && !ctx_.suppressPanels) editor_->drawPanels(g, ctx_);
        for (auto& w : ctx_.widgets) if (w->mostrado()) w->draw(g, access_, w.get() == hover_ && !overlayActive());
        Chrome::drawFrameLeds(g, editor_ ? editor_->outputLevel() : 0.0f);
        Chrome::drawFooter(g, footer_.c_str());
        if (overlayActive()) drawOverlay(g);
        else if (hover_ && hover_->isLocked(access_)) drawTooltip(g, L"No incluido en tu licencia");
    }

    bool overlayActive() const { return !JasWaveLicense::isLicensed(lic_.state); }

    // ---- ratón (coordenadas de diseño) ----
    // Devuelve el id de un parámetro escalonado cuyo menú hay que abrir (o -1)
    int mouseDown(const MouseEvent& e) {
        mouse_ = { e.x, e.y };
        if (overlayActive()) {
            Button* b = activeOverlayButton();
            if (b && b->rect.contains(e.x, e.y)) b->onDown(e, access_);
            return -1;
        }
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it) {
            Widget* w = it->get();
            if (!w->mostrado() ||!w->hit(e.x, e.y)) continue;
            if (dynamic_cast<Dropdown*>(w)) return w->isLocked(access_) ? -1 : w->paramId();
            if (w->onDown(e, access_)) captured_ = w;
            return -1;
        }
        if (editor_ && !ctx_.suppressPanels && editor_->vizDown(e, ctx_)) vizCaptured_ = true;
        return -1;
    }
    void mouseMove(const MouseEvent& e) {
        mouse_ = { e.x, e.y };
        if (captured_) { captured_->onDrag(e, access_); return; }
        if (vizCaptured_) { editor_->vizDrag(e, ctx_); return; }
        hover_ = nullptr;
        if (overlayActive()) return;
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->mostrado() &&(*it)->hit(e.x, e.y)) { hover_ = it->get(); break; }
    }
    void mouseUp(const MouseEvent& e) {
        if (captured_) { captured_->onUp(e, access_); captured_ = nullptr; }
        if (vizCaptured_) { editor_->vizUp(e, ctx_); vizCaptured_ = false; }
    }
    void mouseDouble(const MouseEvent& e) {
        if (overlayActive()) return;
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->mostrado() &&(*it)->hit(e.x, e.y)) { (*it)->onDouble(e, access_); return; }
        if (editor_ && !ctx_.suppressPanels) editor_->vizDouble(e, ctx_);
    }
    // Clic central = valor por defecto del control bajo el cursor (como el doble clic); no toca el visualizador
    void mouseMiddle(const MouseEvent& e) {
        if (overlayActive()) return;
        if (Widget* w = widgetAt(e.x, e.y)) w->onDouble(e, access_);
    }
    void mouseWheel(const MouseEvent& e) {
        if (overlayActive()) return;
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->mostrado() &&(*it)->hit(e.x, e.y)) { (*it)->onWheel(e, access_); return; }
        if (editor_ && !ctx_.suppressPanels) editor_->vizWheel(e, ctx_);
    }
    void mouseLeave() { if (!captured_) hover_ = nullptr; }
    Widget* widgetAt(float x, float y) {
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->mostrado() &&(*it)->hit(x, y)) return it->get();
        return nullptr;
    }
    // Táctil: área mínima de 44 px de diseño alrededor de cada control (V3 §4.5)
    Widget* widgetNear(float x, float y) {
        if (Widget* w = widgetAt(x, y)) return w;
        Widget* best = nullptr;
        float bestD = 1.0e9f;
        for (auto& w : ctx_.widgets) {
            if (!w->mostrado() ||dynamic_cast<Section*>(w.get())) continue;
            const Rect& r = w->rect;
            const float padX = std::max(0.0f, (44.0f - r.w()) * 0.5f), padY = std::max(0.0f, (44.0f - r.h()) * 0.5f);
            if (!Rect{ r.l - padX, r.t - padY, r.r + padX, r.b + padY }.contains(x, y)) continue;
            const float d = std::fabs(r.cx() - x) + std::fabs(r.cy() - y);
            if (d < bestD) { bestD = d; best = w.get(); }
        }
        return best;
    }

    ParamAccess& access() { return access_; }
    JasWaveVst::JwController* controller() { return ctl_; }
    PluginEditor* editor() { return editor_.get(); }
    EditorContext& context() { return ctx_; }

    // ---- modo Básico / Avanzado ----
    bool modoBasico() const { return forzado_ >= 0 ? forzado_ == 0 : ctl_->modoEditor() == 0; }
    void cambiarModo(bool basico) {
        if (basico) cerrarPaginas();   // las páginas extra (MIX / FX, PARÁMETROS) son del modo Avanzado
        ctl_->setModoEditor(basico ? 0 : 1);
        aplicarModo();
    }
    // Solo volcado de layout: fija el modo sin tocar el controlador (-1 = el del controlador)
    void forzarModo(int modo) { forzado_ = modo; aplicarModo(); }
    // ¿El widget se muestra en modo Básico?
    bool esBasico(const Widget& w) const {
        if (w.basico >= 0) return w.basico != 0;
        if (w.paginaDestino() >= 0) return false;   // botones de páginas extra: solo Avanzado
        if (dynamic_cast<const Section*>(&w) || dynamic_cast<const Meter*>(&w)) return true;
        const int id = w.paramId();
        if (id < 0) return true;
        const JasWaveVst::ParamDef* d = ctl_->table().find(static_cast<uint32_t>(id));
        return !d || d->basico || d->bypass;
    }
    // Oculta lo que no es esencial en Básico y recoloca lo que queda (solo cuando cambia lo visible)
    void aplicarModo() {
        const bool basico = modoBasico();
        ctx_.modoBasico = basico;
        auto& ws = ctx_.widgets;
        uint64_t firma = basico ? 0x9E3779B97F4A7C15ull : 0x1234567ull;
        for (size_t i = 0; i < ws.size(); ++i) {
            Widget* w = ws[i].get();
            w->ocultoModo = basico && !esBasico(*w);
            const uint64_t v = (w->visible ? 1ull : 0ull) | (w->ocultoModo ? 2ull : 0ull) | (static_cast<uint64_t>(static_cast<uint32_t>(w->paramId())) << 2);
            firma = (firma ^ (v + 0x9E3779B97F4A7C15ull + (firma << 6) + (firma >> 2))) * 0x100000001B3ull;
        }
        if (firma == firma_) return;
        firma_ = firma;
        reflujo(basico);
    }
    // Rectángulo de un widget en el layout base (sin el reflujo del modo Básico)
    Rect rectBase(size_t i) const {
        const Rect& r = ctx_.widgets[i]->rect;
        const Pt o = i < offsets_.size() ? offsets_[i] : Pt{ 0.0f, 0.0f };
        return { r.l - o.x, r.t - o.y, r.r - o.x, r.b - o.y };
    }
    bool desplazado(size_t i) const { return i < offsets_.size() && (offsets_[i].x != 0.0f || offsets_[i].y != 0.0f); }
    // Parámetros expuestos sin widget propio (perillas reasignables, páginas dibujadas a mano)
    const std::vector<uint32_t>& cubiertosExtra() const { return cubiertosExtra_; }

private:
    void cerrarPaginas() {
        if (paramsAbierta_) activarParametros(false);
        for (auto& w : ctx_.widgets)
            if (w->paginaDestino() > 0 && w->paginaAbierta()) { const MouseEvent e{ w->rect.cx(), w->rect.cy(), false, false, 0 }; w->onDown(e, access_); }
    }

    // ---- página PARÁMETROS ----
    void construirPaginaParametros() {
        std::vector<uint32_t> cubiertos;
        for (auto& w : ctx_.widgets) w->parametrosCubiertos(cubiertosExtra_);
        if (editor_) editor_->parametrosCubiertos(cubiertosExtra_);
        std::sort(cubiertosExtra_.begin(), cubiertosExtra_.end());
        cubiertosExtra_.erase(std::unique(cubiertosExtra_.begin(), cubiertosExtra_.end()), cubiertosExtra_.end());
        cubiertos = cubiertosExtra_;
        for (auto& w : ctx_.widgets) if (w->paramId() >= 0) cubiertos.push_back(static_cast<uint32_t>(w->paramId()));
        if (editor_ && editor_->modeParam() >= 0) cubiertos.push_back(static_cast<uint32_t>(editor_->modeParam()));
        std::vector<const JasWaveVst::ParamDef*> resto;
        for (const auto& d : ctl_->table().defs()) {
            if (d.readOnly) continue;
            if (std::find(cubiertos.begin(), cubiertos.end(), d.id) != cubiertos.end()) continue;
            resto.push_back(&d);
        }
        if (resto.empty()) return;
        const int n = static_cast<int>(resto.size());
        // botón en la barra de título de la sección de controles (a la izquierda de su píldora / candado si los tiene)
        const Rect z = Plantilla::kControles;
        float derecha = z.r - 14.0f;
        for (auto& w : ctx_.widgets)
            if (auto* s = dynamic_cast<Section*>(w.get()))
                if (s->rect.l == z.l && s->rect.t == z.t) {
                    if (s->paramId() >= 0) derecha = z.r - 46.0f;
                    if (s->feature() >= 0) derecha = std::min(derecha, z.r - 62.0f);
                }
        const size_t i0 = ctx_.widgets.size();
        // sección a pantalla completa con la rejilla
        wchar_t titulo[64];
        swprintf_s(titulo, L"PARÁMETROS AVANZADOS · %d", n);
        const Rect area{ Layout::kVisualizer.l, Layout::kVisualizer.t, Layout::kRightBottom.r, Layout::kRightBottom.b };
        ctx_.section(area, titulo);
        int cols = std::min(n, 6);
        while (cols < 12 && (n + cols - 1) / cols * 84 > static_cast<int>(area.h() - 44.0f)) ++cols;
        const int rows = (n + cols - 1) / cols;
        const float x0 = area.l + 14.0f, x1 = area.r - 14.0f, y0 = area.t + 34.0f, y1 = area.b - 8.0f;
        const float cw = (x1 - x0) / cols, ch = std::min(96.0f, (y1 - y0) / rows);
        const float yOff = y0 + ((y1 - y0) - ch * rows) * 0.5f;
        const KnobSize ks = cw >= 96.0f && ch >= 84.0f ? KnobSize::Normal : KnobSize::Small;
        for (int k = 0; k < n; ++k) {
            const JasWaveVst::ParamDef& d = *resto[static_cast<size_t>(k)];
            const float cx = x0 + cw * (k % cols + 0.5f), cy = yOff + ch * (k / cols + 0.5f);
            const std::wstring nombre = nombreParametro(d);
            if (d.map == JasWaveVst::Map::Stepped && d.steps == 1 && !d.bypass) {
                const float hw = std::min(cw * 0.5f - 6.0f, 64.0f);
                ctx_.toggle(d.id, { cx - hw, cy - 12.0f, cx + hw, cy + 12.0f }, nombre.c_str());
            } else if (d.map == JasWaveVst::Map::Stepped) {
                const float hw = std::min(cw * 0.5f - 6.0f, 70.0f);
                auto dd = std::make_unique<DropdownApilado>(d.id, Rect{ cx - hw, cy - 2.0f, cx + hw, cy + 18.0f }, nombre.c_str());
                ctx_.widgets.push_back(std::move(dd));
            } else {
                const float s = static_cast<float>(ks);
                ctx_.knob(d.id, cx, cy - (s * 0.5f + 26.0f - (s + 30.0f) * 0.5f), ks, nombre.c_str());
            }
        }
        for (size_t i = i0; i < ctx_.widgets.size(); ++i) { ctx_.widgets[i]->pagina = kPaginaParametros; ctx_.widgets[i]->visible = false; }
        ctx_.widgets.push_back(std::make_unique<BotonParametros>(Rect{ derecha - 86.0f, z.t + 6.0f, derecha, z.t + 21.0f }, n,
                                                                 [this] { activarParametros(!paramsAbierta_); }, [this] { return paramsAbierta_; }));
        botonParams_ = ctx_.widgets.back().get();
    }
    void activarParametros(bool on) {
        if (on == paramsAbierta_ || !botonParams_) return;
        auto& ws = ctx_.widgets;
        auto fija = [&](Widget* w) { return w == botonParams_ || std::strcmp(w->kind(), "reset") == 0 || std::strcmp(w->kind(), "modo") == 0; };
        if (on) {
            visPrevParams_.assign(ws.size(), 1);
            for (size_t i = 0; i < ws.size(); ++i) {
                Widget* w = ws[i].get();
                visPrevParams_[i] = w->visible ? 1 : 0;
                if (w->pagina == kPaginaParametros || fija(w)) continue;
                w->visible = false;
            }
        } else {
            for (size_t i = 0; i < ws.size() && i < visPrevParams_.size(); ++i) {
                Widget* w = ws[i].get();
                if (w->pagina == kPaginaParametros || fija(w)) continue;
                w->visible = visPrevParams_[i] != 0;
            }
        }
        for (auto& w : ws) if (w->pagina == kPaginaParametros) w->visible = on;
        ctx_.suppressPanels = on;
        paramsAbierta_ = on;
        // el botón se coloca en la cabecera mientras la página está abierta (la sección de controles queda tapada)
        // (en el sitio del botón MIX / FX, que queda oculto)
        if (on) {
            offsetBoton_ = { 484.0f - botonParams_->rect.l, 51.0f - botonParams_->rect.t };
            botonParams_->mover(offsetBoton_.x, offsetBoton_.y);
        } else {
            botonParams_->mover(-offsetBoton_.x, -offsetBoton_.y);
            offsetBoton_ = { 0.0f, 0.0f };
        }
        firma_ = 0;
    }

    // ---- reflujo del modo Básico ----
    struct Item { size_t i; Rect r; bool oculto; };
    void moverA(size_t i, float dx, float dy) {
        if (dx == 0.0f && dy == 0.0f) return;
        ctx_.widgets[i]->mover(dx, dy);
        offsets_[i].x += dx;
        offsets_[i].y += dy;
    }
    void reflujo(bool basico) {
        auto& ws = ctx_.widgets;
        if (offsets_.size() < ws.size()) offsets_.resize(ws.size(), Pt{ 0.0f, 0.0f });
        // vuelta al layout base
        for (size_t i = 0; i < ws.size(); ++i) moverA(i, -offsets_[i].x, -offsets_[i].y);
        if (!basico) return;
        reflujoControles();
        reflujoSalida();
    }
    std::vector<Item> itemsEn(const Rect& z, bool celdas) {
        std::vector<Item> v;
        auto& ws = ctx_.widgets;
        for (size_t i = 0; i < ws.size(); ++i) {
            Widget* w = ws[i].get();
            if (w->pagina != 0 || !w->visible || w == botonParams_) continue;
            if (dynamic_cast<Section*>(w) || dynamic_cast<Fader*>(w)) continue;
            if (!celdas && dynamic_cast<Meter*>(w)) continue;
            const Rect r = rectBase(i);
            if (!z.contains(r.cx(), r.cy())) continue;
            v.push_back({ i, r, w->ocultoModo });
        }
        return v;
    }
    // Controles: filas (por altura); en cada fila con huecos se reparten los visibles a lo ancho y, si una fila
    // queda vacía, las restantes se reparten a lo alto.
    void reflujoControles() {
        const Rect z = Plantilla::kControles;
        std::vector<Item> items = itemsEn({ z.l, z.t + 26.0f, z.r, z.b }, false);
        if (items.empty()) return;
        std::sort(items.begin(), items.end(), [](const Item& a, const Item& b) { return a.r.cy() < b.r.cy(); });
        std::vector<std::vector<Item>> filas;
        for (const Item& it : items) {
            if (filas.empty() || std::fabs(it.r.cy() - filas.back().front().r.cy()) > 22.0f) filas.emplace_back();
            filas.back().push_back(it);
        }
        struct Fila { std::vector<Item> vis; float t, b; bool cambia; float paso; };
        std::vector<Fila> quedan;
        bool filaVacia = false;
        for (auto& f : filas) {
            Fila q{ {}, 1e9f, -1e9f, false, 12.0f };
            for (const Item& it : f) if (!it.oculto) { q.vis.push_back(it); q.t = std::min(q.t, it.r.t); q.b = std::max(q.b, it.r.b); }
            if (q.vis.empty()) { filaVacia = true; continue; }
            q.cambia = q.vis.size() < f.size();
            // separación original entre vecinos de la fila (se conserva al recentrar el grupo)
            std::sort(f.begin(), f.end(), [](const Item& a, const Item& b) { return a.r.cx() < b.r.cx(); });
            float suma = 0.0f;
            int n = 0;
            for (size_t j = 1; j < f.size(); ++j) { suma += std::max(0.0f, f[j].r.l - f[j - 1].r.r); ++n; }
            if (n > 0) q.paso = std::max(4.0f, suma / n);
            quedan.push_back(std::move(q));
        }
        if (quedan.empty()) return;
        // reparto vertical (solo si desapareció alguna fila)
        std::vector<float> dyFila(quedan.size(), 0.0f);
        if (filaVacia) {
            const float top = z.t + 34.0f, bot = z.b - 10.0f;
            float suma = 0.0f;
            for (auto& q : quedan) suma += q.b - q.t;
            const float gap = std::max(6.0f, ((bot - top) - suma) / (quedan.size() + 1));
            float y = top + gap;
            for (size_t k = 0; k < quedan.size(); ++k) {
                dyFila[k] = y - quedan[k].t;
                y += (quedan[k].b - quedan[k].t) + gap;
            }
        }
        // filas con huecos: el grupo visible se recentra con la separación original entre vecinos
        const float l = z.l + 14.0f, r = z.r - 14.0f;
        for (size_t k = 0; k < quedan.size(); ++k) {
            auto& vis = quedan[k].vis;
            std::sort(vis.begin(), vis.end(), [](const Item& a, const Item& b) { return a.r.cx() < b.r.cx(); });
            float ancho = 0.0f;
            for (const Item& it : vis) ancho += it.r.w();
            const float paso = std::min(quedan[k].paso, std::max(0.0f, ((r - l) - ancho) / std::max<size_t>(1, vis.size() - 1)));
            ancho += paso * (vis.size() - 1);
            float x = 0.5f * (l + r) - 0.5f * ancho;
            for (const Item& it : vis) {
                const float dx = quedan[k].cambia ? x - it.r.l : 0.0f;
                moverA(it.i, dx, dyFila[k]);
                x += it.r.w() + paso;
            }
        }
    }
    // SALIDA: las celdas (3 columnas × 2 filas entre el fader y los medidores) se reempaquetan en orden de lectura
    // y el bloque resultante se centra; el fader y los medidores IN/OUT no se mueven.
    void reflujoSalida() {
        namespace P = Plantilla;
        const Rect celdas{ P::kCeldaX[0] - 37.0f, P::kSalida.t + 22.0f, P::kCeldaX[2] + 37.0f, P::kSalida.b };
        std::vector<Item> items = itemsEn(celdas, true);
        bool hay = false;
        for (const Item& it : items) if (it.oculto) hay = true;
        if (!hay) return;
        constexpr float kPasoX = 74.0f, kPasoY = 56.0f;
        bool ocupado[2][3] = {};
        struct Pieza { Item it; int span, alto, c0, f0; float ax, ay; };
        std::vector<Pieza> piezas;
        for (const Item& it : items) {
            Widget* w = ctx_.widgets[it.i].get();
            const int span = std::clamp(static_cast<int>(std::lround(it.r.w() / kPasoX)), 1, 3);
            const auto* k = dynamic_cast<Knob*>(w);
            const bool medidor = dynamic_cast<Meter*>(w) != nullptr;
            const int alto = medidor || (k && k->size() != KnobSize::Small) ? 2 : 1;
            const int c0 = std::clamp(static_cast<int>(std::lround((it.r.cx() - P::kCeldaX[0]) / kPasoX - (span - 1) * 0.5f)), 0, 3 - span);
            const int f0 = alto == 2 ? 0 : (std::fabs(it.r.cy() - P::kCeldaY[0]) <= std::fabs(it.r.cy() - P::kCeldaY[1]) ? 0 : 1);
            const float ax = P::kCeldaX[0] + kPasoX * (c0 + (span - 1) * 0.5f);
            const float ay = alto == 2 ? 0.5f * (P::kCeldaY[0] + P::kCeldaY[1]) : P::kCeldaY[f0];
            if (medidor) { for (int f = 0; f < 2; ++f) ocupado[f][c0] = true; continue; }   // los medidores de celda no se mueven
            if (it.oculto) continue;
            piezas.push_back({ it, span, alto, c0, f0, ax, ay });
        }
        if (piezas.empty()) return;
        std::stable_sort(piezas.begin(), piezas.end(), [](const Pieza& a, const Pieza& b) { return a.f0 != b.f0 ? a.f0 < b.f0 : a.c0 < b.c0; });
        int cMin = 3, cMax = -1, fMin = 2, fMax = -1;
        std::vector<std::pair<int, int>> pos(piezas.size(), { -1, -1 });
        for (size_t k = 0; k < piezas.size(); ++k) {
            const Pieza& p = piezas[k];
            for (int f = 0; f + p.alto <= 2 && pos[k].first < 0; ++f)
                for (int c = 0; c + p.span <= 3; ++c) {
                    bool libre = true;
                    for (int ff = f; ff < f + p.alto; ++ff) for (int cc = c; cc < c + p.span; ++cc) if (ocupado[ff][cc]) libre = false;
                    if (!libre) continue;
                    for (int ff = f; ff < f + p.alto; ++ff) for (int cc = c; cc < c + p.span; ++cc) ocupado[ff][cc] = true;
                    pos[k] = { f, c };
                    cMin = std::min(cMin, c); cMax = std::max(cMax, c + p.span - 1);
                    fMin = std::min(fMin, f); fMax = std::max(fMax, f + p.alto - 1);
                    break;
                }
        }
        if (cMax < 0) return;
        // con medidores de celda fijos no se centra en horizontal (se respetan sus columnas)
        bool hayMedidor = false;
        for (const Item& it : items) if (dynamic_cast<Meter*>(ctx_.widgets[it.i].get())) hayMedidor = true;
        const float offX = hayMedidor ? 0.0f : ((3 - (cMax - cMin + 1)) * kPasoX) * 0.5f - cMin * kPasoX;
        const float offY = ((2 - (fMax - fMin + 1)) * kPasoY) * 0.5f - fMin * kPasoY;
        for (size_t k = 0; k < piezas.size(); ++k) {
            if (pos[k].first < 0) continue;
            const Pieza& p = piezas[k];
            const float tx = P::kCeldaX[0] + kPasoX * (pos[k].second + (p.span - 1) * 0.5f) + offX;
            const float ty = (p.alto == 2 ? 0.5f * (P::kCeldaY[0] + P::kCeldaY[1]) : P::kCeldaY[0] + kPasoY * pos[k].first) + offY;
            moverA(p.it.i, tx - p.ax, ty - p.ay);
        }
    }

    Button* activeOverlayButton() {
        if (lic_.phase == JasWaveLicense::Phase::WaitingApproval || lic_.phase == JasWaveLicense::Phase::Starting) return cancel_.get();
        return login_.get();
    }
    void drawOverlay(Gfx& g) {
        g.fillChamfer(Layout::kScreen, 14.0f, hex(0x000000, 0.70f));
        const Rect card{ 320.0f, 196.0f, 780.0f, 436.0f };
        g.fillChamfer(card.inset(-3.0f), 9.0f, Pal::cianGlow.withAlpha(0.08f));
        g.fillChamfer(card, 6.0f, hex(0x0B0D27, 0.97f));
        g.strokeChamfer(card, 6.0f, Pal::cian.withAlpha(0.55f), 1.0f);
        g.text(L"ACTIVAR JASWAVE", { card.l, card.t + 16.0f, card.r, card.t + 44.0f }, Font::Title, Pal::textoTitulo, Align::Center, true);
        g.line(card.l + 40.0f, card.t + 52.0f, card.r - 40.0f, card.t + 52.0f, Pal::panelBorde, 1.0f);
        using JasWaveLicense::Phase;
        const bool waiting = lic_.phase == Phase::WaitingApproval;
        const bool starting = lic_.phase == Phase::Starting;
        if (waiting) {
            g.text(L"Introduce este código en el navegador:", { card.l, card.t + 64.0f, card.r, card.t + 84.0f }, Font::Body, Pal::textoEtiqueta, Align::Center);
            const std::wstring code = widen(lic_.userCode);
            g.text(code, { card.l + 1.0f, card.t + 92.0f, card.r + 1.0f, card.t + 132.0f }, Font::CodeBig, Pal::cian.withAlpha(0.25f), Align::Center);
            g.text(code, { card.l, card.t + 90.0f, card.r, card.t + 130.0f }, Font::CodeBig, Pal::cianNucleo, Align::Center);
            g.text(L"Esperando aprobación…", { card.l, card.t + 138.0f, card.r, card.t + 158.0f }, Font::Body, Pal::textoValor, Align::Center);
            cancel_->draw(g, access_, cancel_->rect.contains(mouse_.x, mouse_.y));
        } else if (starting) {
            g.text(L"Conectando con JasWave…", { card.l, card.t + 100.0f, card.r, card.t + 124.0f }, Font::Body, Pal::textoValor, Align::Center);
            cancel_->draw(g, access_, cancel_->rect.contains(mouse_.x, mouse_.y));
        } else {
            g.text(L"Este plugin necesita una licencia JasWave activa.", { card.l, card.t + 66.0f, card.r, card.t + 86.0f }, Font::Body,
                   Pal::textoEtiqueta, Align::Center);
            g.text(L"El audio pasa sin procesar (bypass) hasta activarla.", { card.l, card.t + 86.0f, card.r, card.t + 106.0f }, Font::Body,
                   Pal::textoTenue, Align::Center);
            if (!lic_.message.empty())
                g.text(widen(lic_.message), { card.l + 10.0f, card.t + 116.0f, card.r - 10.0f, card.t + 140.0f }, Font::Body, Pal::alerta, Align::Center);
            login_->draw(g, access_, login_->rect.contains(mouse_.x, mouse_.y));
        }
    }
    void drawTooltip(Gfx& g, const wchar_t* text) {
        const float w = g.textWidth(text, Font::Label) + 16.0f;
        float x = std::min(mouse_.x + 12.0f, Layout::kScreen.r - w - 4.0f);
        float y = std::max(mouse_.y - 28.0f, Layout::kScreen.t + 4.0f);
        const Rect r{ x, y, x + w, y + 20.0f };
        g.fillRect(r, hex(0x0A0C26, 0.96f));
        g.strokeRect(r, Pal::bloqueado, 1.0f);
        g.text(text, r, Font::Label, Pal::textoEtiqueta, Align::Center);
    }

    ControllerAccess access_;
    EditorContext ctx_;
    JasWaveVst::JwController* ctl_;
    std::unique_ptr<PluginEditor> editor_;
    std::shared_ptr<JasWaveDsp::MeterBusBase> bus_;
    LARGE_INTEGER freq_{}, last_{};
    Dropdown* mode_{nullptr};
    std::wstring footer_;
    std::unique_ptr<Button> login_, cancel_;
    JasWaveLicense::UiStatus lic_;
    uint32_t licSerial_{~0u};
    Widget* hover_{nullptr};
    Widget* captured_{nullptr};
    bool vizCaptured_{false};
    Pt mouse_{ -100.0f, -100.0f };
    // modo Básico / Avanzado y página PARÁMETROS
    int forzado_{-1};
    uint64_t firma_{0};
    std::vector<Pt> offsets_;
    Widget* botonParams_{nullptr};
    bool paramsAbierta_{false};
    std::vector<char> visPrevParams_;
    Pt offsetBoton_{ 0.0f, 0.0f };
    std::vector<uint32_t> cubiertosExtra_;
};

// ---------------------------------------------------------------------------------
//  Vista VST3 (HWND hijo)
// ---------------------------------------------------------------------------------
class EditorView : public CPluginView, public IPlugViewContentScaleSupport {
public:
    explicit EditorView(JasWaveVst::JwController* c) : CPluginView(nullptr), ctl_(c) {
        ctl_->addRef();
        rect = ViewRect(0, 0, static_cast<int32>(kBaseW), static_cast<int32>(kBaseH));
    }
    ~EditorView() SMTG_OVERRIDE {
        destroyWindow();
        ctl_->release();
    }

    tresult PLUGIN_API isPlatformTypeSupported(FIDString type) SMTG_OVERRIDE {
        return type && std::strcmp(type, kPlatformTypeHWND) == 0 ? kResultTrue : kResultFalse;
    }
    tresult PLUGIN_API canResize() SMTG_OVERRIDE { return kResultTrue; }
    tresult PLUGIN_API checkSizeConstraint(ViewRect* r) SMTG_OVERRIDE {
        if (!r) return kInvalidArgument;
        // mínimo de 300 px: cabe entero en el panel lateral del DAW (editor embebido, V4)
        const float minW = 300.0f;
        int32 w = std::max<int32>(r->getWidth(), static_cast<int32>(minW));
        int32 h = static_cast<int32>(std::lround(w * kBaseH / kBaseW));
        // si el host fija la altura, se respeta la proporción 16:9 aprox. desde la altura
        if (r->getHeight() > 0 && std::abs(r->getHeight() - h) > 2 && r->getWidth() == rect.getWidth()) {
            h = std::max<int32>(r->getHeight(), static_cast<int32>(minW * kBaseH / kBaseW));
            w = static_cast<int32>(std::lround(h * kBaseW / kBaseH));
        }
        r->right = r->left + w;
        r->bottom = r->top + h;
        return kResultTrue;
    }
    tresult PLUGIN_API onSize(ViewRect* newSize) SMTG_OVERRIDE {
        if (newSize) rect = *newSize;
        if (hwnd_) {
            SetWindowPos(hwnd_, nullptr, 0, 0, rect.getWidth(), rect.getHeight(), SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOMOVE);
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
        return kResultOk;
    }
    tresult PLUGIN_API setContentScaleFactor(ScaleFactor factor) SMTG_OVERRIDE {
        if (factor <= 0.0f) return kResultFalse;
        scaleFactor_ = factor;
        return kResultTrue;
    }

    tresult PLUGIN_API attached(void* parent, FIDString type) SMTG_OVERRIDE {
        if (isPlatformTypeSupported(type) != kResultTrue) return kResultFalse;
        const tresult r = CPluginView::attached(parent, type);
        createWindow(static_cast<HWND>(parent));
        return r;
    }
    tresult PLUGIN_API removed() SMTG_OVERRIDE {
        destroyWindow();
        return CPluginView::removed();
    }

    OBJ_METHODS(EditorView, CPluginView)
    DEFINE_INTERFACES
        DEF_INTERFACE(IPlugViewContentScaleSupport)
    END_DEFINE_INTERFACES(CPluginView)
    REFCOUNT_METHODS(CPluginView)

private:
    static constexpr UINT_PTR kTimer = 0x4A57;
    static constexpr UINT_PTR kLongPress = 0x4A58;

    // Táctil: arrastre como el ratón y pulsación larga = escribir el valor
    void touchDown(float x, float y) {
        if (edit_) commitValueEditor(true);
        touchStart_ = { x, y };
        touchWidget_ = core_->overlayActive() ? nullptr : core_->widgetNear(x, y);
        MouseEvent e{ x, y, false, false, 0 };
        if (touchWidget_ && !touchWidget_->rect.contains(x, y))   // dentro del área de 44 px: se lleva al control
            e = { std::clamp(x, touchWidget_->rect.l + 1.0f, touchWidget_->rect.r - 1.0f), std::clamp(y, touchWidget_->rect.t + 1.0f, touchWidget_->rect.b - 1.0f), false, false, 0 };
        touchOffset_ = { e.x - x, e.y - y };
        const int menu = core_->mouseDown(e);
        if (menu >= 0) { touchWidget_ = nullptr; openMenu(menu); return; }
        if (touchWidget_ && touchWidget_->paramId() >= 0) SetTimer(hwnd_, kLongPress, 550, nullptr);
    }
    void touchMove(float x, float y) {
        if (touchWidget_ && std::fabs(x - touchStart_.x) + std::fabs(y - touchStart_.y) > 8.0f) KillTimer(hwnd_, kLongPress);
        core_->mouseMove({ x + touchOffset_.x, y + touchOffset_.y, false, false, 0 });
    }
    void touchUp(float x, float y) {
        KillTimer(hwnd_, kLongPress);
        core_->mouseUp({ x + touchOffset_.x, y + touchOffset_.y, false, false, 0 });
        core_->mouseLeave();
        touchWidget_ = nullptr;
    }
    void longPress() {
        KillTimer(hwnd_, kLongPress);
        Widget* w = touchWidget_;
        touchWidget_ = nullptr;
        if (!w) return;
        core_->mouseUp({ touchStart_.x, touchStart_.y, false, false, 0 });   // el valor no cambia: se escribe
        openValueEditor(w);
    }

    void createWindow(HWND parent) {
        if (hwnd_ || !parent) return;
        static const wchar_t* kClass = L"JasWaveCyberEditor";
        WNDCLASSEXW wc{};
        wc.cbSize = sizeof wc;
        if (!GetClassInfoExW(moduleInstance(), kClass, &wc)) {
            wc = {};
            wc.cbSize = sizeof wc;
            wc.style = CS_DBLCLKS | CS_HREDRAW | CS_VREDRAW;
            wc.lpfnWndProc = &EditorView::wndProc;
            wc.hInstance = moduleInstance();
            wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
            wc.lpszClassName = kClass;
            RegisterClassExW(&wc);
        }
        // tamaño HiDPI inicial
        const UINT dpi = GetDpiForWindow(parent);
        if (scaleFactor_ <= 1.0f && dpi > 96) scaleFactor_ = dpi / 96.0f;
        core_ = std::make_unique<EditorCore>(ctl_);
        hwnd_ = CreateWindowExW(0, kClass, L"JasWave", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, 0, 0, rect.getWidth(), rect.getHeight(), parent,
                                nullptr, moduleInstance(), this);
        if (hwnd_) SetTimer(hwnd_, kTimer, 16, nullptr);
    }
    void destroyWindow() {
        if (edit_) { DestroyWindow(edit_); edit_ = nullptr; }
        touchWidget_ = nullptr;
        if (hwnd_) {
            KillTimer(hwnd_, kTimer);
            KillTimer(hwnd_, kLongPress);
            SetWindowLongPtrW(hwnd_, GWLP_USERDATA, 0);
            DestroyWindow(hwnd_);
            hwnd_ = nullptr;
        }
        gfx_.reset();
        core_.reset();
    }

    float designScale() const {
        RECT rc{};
        GetClientRect(hwnd_, &rc);
        return std::max(0.1f, static_cast<float>(rc.right - rc.left) / kBaseW);
    }
    MouseEvent toDesign(LPARAM lp, WPARAM wp, int wheel = 0) const {
        const float s = designScale();
        return { GET_X_LPARAM(lp) / s, GET_Y_LPARAM(lp) / s, (wp & MK_SHIFT) != 0, (wp & MK_CONTROL) != 0, wheel };
    }

    void paint() {
        RECT rc{};
        GetClientRect(hwnd_, &rc);
        const UINT w = static_cast<UINT>(std::max<LONG>(1, rc.right - rc.left));
        const UINT h = static_cast<UINT>(std::max<LONG>(1, rc.bottom - rc.top));
        if (!gfx_) gfx_ = std::make_unique<Gfx>();
        gfx_->setScale(static_cast<float>(w) / kBaseW);
        if (!gfx_->beginHwnd(hwnd_, w, h)) return;
        core_->paint(*gfx_);
        gfx_->end();
    }

    void openMenu(int paramId) {
        const JasWaveVst::ParamDef* d = core_->access().def(static_cast<uint32_t>(paramId));
        if (!d || d->map != JasWaveVst::Map::Stepped) return;
        HMENU m = CreatePopupMenu();
        const int cur = static_cast<int>(std::lround(core_->access().plain(static_cast<uint32_t>(paramId))));
        for (int i = 0; i <= d->steps; ++i) {
            std::wstring label = d->labels ? widen(d->labels[i]) : std::to_wstring(i);
            AppendMenuW(m, MF_STRING | (i == cur ? MF_CHECKED : 0), static_cast<UINT_PTR>(i + 1), label.c_str());
        }
        POINT pt;
        GetCursorPos(&pt);
        const int sel = TrackPopupMenu(m, TPM_RETURNCMD | TPM_NONOTIFY | TPM_LEFTALIGN, pt.x, pt.y, 0, hwnd_, nullptr);
        DestroyMenu(m);
        if (sel > 0) core_->access().setNorm(static_cast<uint32_t>(paramId), JasWaveVst::toNorm(*d, sel - 1));
    }

    // Clic derecho: escribir el valor (EDIT temporal)
    void openValueEditor(Widget* w) {
        const int id = w->paramId();
        if (id < 0 || w->isLocked(core_->access())) return;
        const JasWaveVst::ParamDef* d = core_->access().def(static_cast<uint32_t>(id));
        if (!d) return;
        if (d->map == JasWaveVst::Map::Stepped) { openMenu(id); return; }
        const float s = designScale();
        const Rect r = w->rect;
        const int x = static_cast<int>((r.cx() - 50.0f) * s), y = static_cast<int>((r.b - 22.0f) * s);
        const std::wstring cur = widen(JasWaveVst::formatValue(*d, core_->access().plain(static_cast<uint32_t>(id)), false));
        edit_ = CreateWindowExW(0, L"EDIT", cur.c_str(), WS_CHILD | WS_VISIBLE | WS_BORDER | ES_CENTER | ES_AUTOHSCROLL, x, y,
                                static_cast<int>(100 * s), static_cast<int>(20 * s), hwnd_, nullptr, moduleInstance(), nullptr);
        if (!edit_) return;
        editParam_ = id;
        SetWindowSubclass(edit_, &EditorView::editProc, 1, reinterpret_cast<DWORD_PTR>(this));
        SendMessageW(edit_, EM_SETSEL, 0, -1);
        SetFocus(edit_);
    }
    void commitValueEditor(bool apply) {
        if (!edit_) return;
        HWND e = edit_;
        edit_ = nullptr;
        if (apply && editParam_ >= 0) {
            wchar_t buf[64] = {};
            GetWindowTextW(e, buf, 63);
            if (Parameter* p = ctl_->getParameterObject(static_cast<ParamID>(editParam_))) {
                String128 t{};
                for (int i = 0; i < 63 && buf[i]; ++i) t[i] = static_cast<TChar>(buf[i]);
                ParamValue n = 0;
                if (p->fromString(t, n)) core_->access().setNorm(static_cast<uint32_t>(editParam_), n);
            }
        }
        editParam_ = -1;
        RemoveWindowSubclass(e, &EditorView::editProc, 1);
        DestroyWindow(e);
        if (hwnd_) SetFocus(hwnd_);
    }
    static LRESULT CALLBACK editProc(HWND h, UINT msg, WPARAM wp, LPARAM lp, UINT_PTR, DWORD_PTR ref) {
        auto* self = reinterpret_cast<EditorView*>(ref);
        if (msg == WM_KEYDOWN && (wp == VK_RETURN || wp == VK_ESCAPE)) { self->commitValueEditor(wp == VK_RETURN); return 0; }
        if (msg == WM_CHAR && (wp == VK_RETURN || wp == VK_ESCAPE)) return 0;
        if (msg == WM_KILLFOCUS) { LRESULT r = DefSubclassProc(h, msg, wp, lp); self->commitValueEditor(true); return r; }
        return DefSubclassProc(h, msg, wp, lp);
    }

    static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        if (msg == WM_NCCREATE) {
            auto* cs = reinterpret_cast<CREATESTRUCTW*>(lp);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(cs->lpCreateParams));
            return DefWindowProcW(hwnd, msg, wp, lp);
        }
        auto* self = reinterpret_cast<EditorView*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
        if (!self || !self->core_) return DefWindowProcW(hwnd, msg, wp, lp);
        switch (msg) {
            case WM_ERASEBKGND: return 1;
            case WM_PAINT: {
                PAINTSTRUCT ps;
                BeginPaint(hwnd, &ps);
                self->paint();
                EndPaint(hwnd, &ps);
                return 0;
            }
            case WM_SIZE:
                if (self->gfx_) self->gfx_->invalidateBackground();
                InvalidateRect(hwnd, nullptr, FALSE);
                return 0;
            case WM_TIMER:
                if (wp == kTimer) { self->core_->tick(); InvalidateRect(hwnd, nullptr, FALSE); }
                else if (wp == kLongPress) self->longPress();
                return 0;
            case WM_POINTERDOWN:
            case WM_POINTERUPDATE:
            case WM_POINTERUP: {
                // Solo el dedo: ratón y lápiz siguen por los mensajes de ratón (promoción por defecto)
                POINTER_INPUT_TYPE type = PT_POINTER;
                if (!GetPointerType(GET_POINTERID_WPARAM(wp), &type) || type != PT_TOUCH) break;
                POINT pt{ GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
                ScreenToClient(hwnd, &pt);
                const float s = self->designScale();
                const float x = pt.x / s, y = pt.y / s;
                if (msg == WM_POINTERDOWN) { SetFocus(hwnd); self->touchDown(x, y); }
                else if (msg == WM_POINTERUPDATE) { if (IS_POINTER_INCONTACT_WPARAM(wp)) self->touchMove(x, y); }
                else self->touchUp(x, y);
                return 0;
            }
            case WM_DPICHANGED_AFTERPARENT:
            case WM_DPICHANGED:
                // DPI dinámico: el destino se reescala en el siguiente frame y el fondo se regenera
                self->scaleFactor_ = std::max(1.0f, GetDpiForWindow(hwnd) / 96.0f);
                if (self->gfx_) self->gfx_->invalidateBackground();
                InvalidateRect(hwnd, nullptr, FALSE);
                if (msg == WM_DPICHANGED) break;
                return 0;
            case WM_LBUTTONDOWN: {
                SetFocus(hwnd);
                const int menu = self->core_->mouseDown(self->toDesign(lp, wp));
                if (menu >= 0) self->openMenu(menu);
                else SetCapture(hwnd);
                return 0;
            }
            case WM_LBUTTONDBLCLK: self->core_->mouseDouble(self->toDesign(lp, wp)); return 0;
            case WM_MBUTTONDOWN: self->core_->mouseMiddle(self->toDesign(lp, wp)); return 0;
            case WM_MOUSEMOVE: {
                if (!self->tracking_) {
                    TRACKMOUSEEVENT t{ sizeof t, TME_LEAVE, hwnd, 0 };
                    TrackMouseEvent(&t);
                    self->tracking_ = true;
                }
                self->core_->mouseMove(self->toDesign(lp, wp));
                return 0;
            }
            case WM_MOUSELEAVE: self->tracking_ = false; self->core_->mouseLeave(); return 0;
            case WM_LBUTTONUP:
                self->core_->mouseUp(self->toDesign(lp, wp));
                if (GetCapture() == hwnd) ReleaseCapture();
                return 0;
            case WM_CAPTURECHANGED: self->core_->mouseUp({ 0, 0, false, false, 0 }); return 0;
            case WM_RBUTTONDOWN: {
                const MouseEvent e = self->toDesign(lp, wp);
                if (self->core_->overlayActive()) return 0;
                if (Widget* w = self->core_->widgetAt(e.x, e.y)) self->openValueEditor(w);
                return 0;
            }
            case WM_MOUSEWHEEL: {
                POINT pt{ GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
                ScreenToClient(hwnd, &pt);
                const int steps = GET_WHEEL_DELTA_WPARAM(wp) / WHEEL_DELTA;
                const float s = self->designScale();
                const WPARAM keys = GET_KEYSTATE_WPARAM(wp);
                self->core_->mouseWheel({ pt.x / s, pt.y / s, (keys & MK_SHIFT) != 0, (keys & MK_CONTROL) != 0, steps });
                return 0;
            }
            case WM_GETDLGCODE: return DLGC_WANTALLKEYS;
            default: break;
        }
        return DefWindowProcW(hwnd, msg, wp, lp);
    }

    JasWaveVst::JwController* ctl_;
    std::unique_ptr<EditorCore> core_;
    std::unique_ptr<Gfx> gfx_;
    Widget* touchWidget_{nullptr};
    Pt touchStart_{ 0, 0 }, touchOffset_{ 0, 0 };
    HWND hwnd_{nullptr};
    HWND edit_{nullptr};
    int editParam_{-1};
    bool tracking_{false};
    float scaleFactor_{1.0f};
};

// ---------------------------------------------------------------------------------
//  Render a PNG (WIC) – herramienta de capturas
// ---------------------------------------------------------------------------------
bool renderEditorToPng(JasWaveVst::JwController* controller, const wchar_t* path, UINT pxW, UINT pxH, int warmupFrames) {
    const HRESULT coHr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    bool ok = false;
    {
        IWICImagingFactory* wic = nullptr;
        if (SUCCEEDED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&wic)))) {
            IWICBitmap* bmp = nullptr;
            if (SUCCEEDED(wic->CreateBitmap(pxW, pxH, GUID_WICPixelFormat32bppPBGRA, WICBitmapCacheOnLoad, &bmp))) {
                EditorCore core(controller);
                Gfx g;
                ID2D1RenderTarget* rt = nullptr;
                const D2D1_RENDER_TARGET_PROPERTIES props = D2D1::RenderTargetProperties(
                    D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED), 96.0f, 96.0f);
                if (g.factory() && SUCCEEDED(g.factory()->CreateWicBitmapRenderTarget(bmp, props, &rt))) {
                    for (int i = 0; i < std::max(1, warmupFrames); ++i) core.tick();
                    g.setScale(static_cast<float>(pxW) / kBaseW);
                    if (g.beginExternal(rt)) {
                        core.paint(g);
                        ok = g.end();
                    }
                    rt->Release();
                }
                if (ok) {
                    ok = false;
                    IWICStream* stream = nullptr;
                    IWICBitmapEncoder* enc = nullptr;
                    IWICBitmapFrameEncode* frame = nullptr;
                    if (SUCCEEDED(wic->CreateStream(&stream)) && SUCCEEDED(stream->InitializeFromFilename(path, GENERIC_WRITE)) &&
                        SUCCEEDED(wic->CreateEncoder(GUID_ContainerFormatPng, nullptr, &enc)) && SUCCEEDED(enc->Initialize(stream, WICBitmapEncoderNoCache)) &&
                        SUCCEEDED(enc->CreateNewFrame(&frame, nullptr)) && SUCCEEDED(frame->Initialize(nullptr))) {
                        frame->SetSize(pxW, pxH);
                        WICPixelFormatGUID fmt = GUID_WICPixelFormat32bppBGRA;
                        frame->SetPixelFormat(&fmt);
                        ok = SUCCEEDED(frame->WriteSource(bmp, nullptr)) && SUCCEEDED(frame->Commit()) && SUCCEEDED(enc->Commit());
                    }
                    if (frame) frame->Release();
                    if (enc) enc->Release();
                    if (stream) stream->Release();
                }
                bmp->Release();
            }
            wic->Release();
        }
    }
    if (SUCCEEDED(coHr)) CoUninitialize();
    return ok;
}

// ---------------------------------------------------------------------------------
//  Volcado del layout (fuente única de la réplica web, V4): zonas, widgets y parámetros
// ---------------------------------------------------------------------------------
bool dumpEditorLayout(JasWaveVst::JwController* controller, const wchar_t* path) {
    EditorCore core(controller);
    PluginEditor* ed = core.editor();
    if (!ed) return false;
    const auto& desc = controller->descriptor();
    std::string o = "{\n";
    o += "  \"productId\": " + jsonStr(desc.productId) + ",\n";
    o += "  \"titulo\": " + jsonStr(utf8(ed->title())) + ",\n";
    o += "  \"subtitulo\": " + jsonStr(utf8(ed->subtitle())) + ",\n";
    o += "  \"instrumento\": " + std::string(desc.instrument ? "true" : "false") + ",\n";
    o += "  \"visualizador\": " + jsonStr(ed->visualizer()) + ",\n";
    o += "  \"acento\": " + jsonColor(ed->accent()) + ",\n";
    o += "  \"base\": { \"ancho\": 1100, \"alto\": 620 },\n";
    o += "  \"zonas\": {\n";
    o += "    \"pantalla\": " + jsonRect(Layout::kScreen) + ",\n";
    o += "    \"visualizador\": " + jsonRect(Plantilla::kVisual) + ",\n";
    o += "    \"espectro\": " + jsonRect(Plantilla::areaEspectro()) + ",\n";
    o += "    \"miniPanel\": " + jsonRect(Plantilla::kMini) + ",\n";
    o += "    \"controles\": " + jsonRect(Plantilla::kControles) + ",\n";
    o += "    \"salida\": " + jsonRect(Plantilla::kSalida) + ",\n";
    o += "    \"fader\": " + jsonRect(Plantilla::kFader) + ",\n";
    char med[128];
    std::snprintf(med, sizeof med, "{ \"x\": %.1f, \"arriba\": %.1f, \"abajo\": %.1f }", Plantilla::kMedidoresX, Plantilla::kMedidoresArriba,
                  Plantilla::kMedidoresAbajo);
    o += std::string("    \"medidores\": ") + med + "\n  },\n";
    o += "  \"escalas\": { \"frecuencia\": [20, 20000], \"dbfs\": [-120, 0], \"caidaDbS\": 14 },\n";
    o += "  \"modoParam\": " + (ed->modeParam() >= 0 ? std::to_string(ed->modeParam()) : std::string("null")) + ",\n";
    // Modo Básico: qué widgets quedan y dónde (reflujo); después se vuelve al layout base (Avanzado)
    auto& ws = core.context().widgets;
    core.forzarModo(0);
    std::vector<std::pair<bool, Rect>> enBasico(ws.size(), { false, Rect{ 0, 0, 0, 0 } });
    for (size_t i = 0; i < ws.size(); ++i) enBasico[i] = { core.desplazado(i), ws[i]->rect };
    core.forzarModo(1);
    o += "  \"modos\": { \"selector\": " + jsonRect(kRectModo) + ", \"corte\": " + std::to_string(static_cast<int>(kCorteModo)) + ", \"defecto\": \"avanzado\" },\n";
    o += "  \"parametrosCubiertos\": [";
    for (size_t i = 0; i < core.cubiertosExtra().size(); ++i) o += (i ? "," : "") + std::to_string(core.cubiertosExtra()[i]);
    o += "],\n";
    o += "  \"widgets\": [\n";
    bool first = true;
    for (size_t i = 0; i < ws.size(); ++i) {
        auto& w = ws[i];
        o += first ? "    {" : ",\n    {";
        first = false;
        o += " \"tipo\": " + jsonStr(w->kind()) + ", \"rect\": " + jsonRect(w->rect) + ", \"etiqueta\": " + jsonStr(utf8(w->text()));
        if (auto* k = dynamic_cast<Knob*>(w.get())) o += ", \"tamano\": " + std::to_string(static_cast<int>(k->size()));
        if (w->pagina) o += ", \"pagina\": " + std::to_string(static_cast<int>(w->pagina));
        o += std::string(", \"basico\": ") + (core.esBasico(*w) ? "true" : "false");
        if (enBasico[i].first) o += ", \"rectBasico\": " + jsonRect(enBasico[i].second);
        o += w->layoutExtra();
        const int id = w->paramId();
        if (id >= 0) {
            o += ", \"param\": " + std::to_string(id);
            if (const JasWaveVst::ParamDef* d = core.access().def(static_cast<uint32_t>(id))) {
                char b[320];
                std::snprintf(b, sizeof b,
                              ", \"min\": %.10g, \"max\": %.10g, \"defecto\": %.10g, \"pasos\": %d, \"escala\": \"%s\", \"decimales\": %d, \"bipolar\": %s, \"bypass\": %s",
                              d->minV, d->maxV, d->defV, d->steps,
                              d->map == JasWaveVst::Map::Log ? "log" : d->map == JasWaveVst::Map::Stepped ? "stepped" : "linear", d->decimals,
                              d->bipolar ? "true" : "false", d->bypass ? "true" : "false");
                o += b;
                o += ", \"nombre\": " + jsonStr(d->name ? d->name : "") + ", \"unidad\": " + jsonStr(d->units ? d->units : "");
                if (d->feature >= 0 && d->feature < desc.featureCount) o += ", \"feature\": " + jsonStr(desc.features[d->feature].key);
                if (d->labels) {
                    o += ", \"opciones\": [";
                    for (int i = 0; i <= d->steps; ++i) o += (i ? "," : "") + jsonStr(d->labels[i]);
                    o += "]";
                }
            }
        }
        o += " }";
    }
    o += "\n  ]\n}\n";
    FILE* fp = nullptr;
    if (_wfopen_s(&fp, path, L"wb") != 0 || !fp) return false;
    const bool ok = std::fwrite(o.data(), 1, o.size(), fp) == o.size();
    std::fclose(fp);
    return ok;
}

} // namespace JasWaveUI

// ---- JwController::createView ----
namespace JasWaveVst {
IPlugView* PLUGIN_API JwController::createView(FIDString name) {
    if (name && std::strcmp(name, ViewType::kEditor) == 0) return new JasWaveUI::EditorView(this);
    return nullptr;
}
} // namespace JasWaveVst
