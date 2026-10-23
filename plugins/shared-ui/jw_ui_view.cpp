// JasWave UI – vista VST3 (HWND), núcleo de pintado compartido con las capturas PNG y overlay de licencia
#include "jw_ui.h"
#include "jw_vst3.h"

#include "public.sdk/source/common/pluginview.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"

#include <commctrl.h>
#include <wincodec.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>

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
//  Núcleo del editor: estado + pintado (ventana o bitmap)
// ---------------------------------------------------------------------------------
class EditorCore {
public:
    explicit EditorCore(JasWaveVst::JwController* c) : access_(c), ctx_(access_), ctl_(c), editor_(c->createEditor()) {
        if (editor_) {
            editor_->build(ctx_);
            if (editor_->modeParam() >= 0) mode_ = ctx_.dropdown(static_cast<uint32_t>(editor_->modeParam()), { 690.0f, 48.0f, 846.0f, 68.0f }, L"MODO");
        }
        footer_ = widen(c->descriptor().productId);
        login_ = std::make_unique<Button>(Rect{ 460.0f, 352.0f, 640.0f, 384.0f }, L"INICIAR SESIÓN",
                                          [] { JasWaveLicense::Manager::instance().startActivation(); });
        cancel_ = std::make_unique<Button>(Rect{ 490.0f, 392.0f, 610.0f, 416.0f }, L"CANCELAR",
                                           [] { JasWaveLicense::Manager::instance().cancelActivation(); });
    }

    void tick() {
        if (editor_) editor_->tick(ctx_);
        const uint32_t s = JasWaveLicense::Manager::instance().serial();
        if (s != licSerial_) { licSerial_ = s; lic_ = JasWaveLicense::Manager::instance().uiStatus(); }
    }

    void paint(Gfx& g) {
        g.drawCachedBackground([](Gfx& gg) { Chrome::drawStaticBackground(gg); });
        const bool licensed = JasWaveLicense::isLicensed(lic_.state);
        const bool expiring = (lic_.state & JasWaveLicense::StateBits::kExpiringSoon) != 0;
        Chrome::drawHeader(g, editor_ ? editor_->title() : L"JASWAVE", editor_ ? editor_->subtitle() : L"", expiring, licensed);
        if (editor_) editor_->drawPanels(g, ctx_);
        for (auto& w : ctx_.widgets) if (w->visible) w->draw(g, access_, w.get() == hover_ && !overlayActive());
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
            if (!w->visible || !w->hit(e.x, e.y)) continue;
            if (dynamic_cast<Dropdown*>(w)) return w->isLocked(access_) ? -1 : w->paramId();
            if (w->onDown(e, access_)) captured_ = w;
            return -1;
        }
        if (editor_ && editor_->vizDown(e, ctx_)) vizCaptured_ = true;
        return -1;
    }
    void mouseMove(const MouseEvent& e) {
        mouse_ = { e.x, e.y };
        if (captured_) { captured_->onDrag(e, access_); return; }
        if (vizCaptured_) { editor_->vizDrag(e, ctx_); return; }
        hover_ = nullptr;
        if (overlayActive()) return;
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->visible && (*it)->hit(e.x, e.y)) { hover_ = it->get(); break; }
    }
    void mouseUp(const MouseEvent& e) {
        if (captured_) { captured_->onUp(e, access_); captured_ = nullptr; }
        if (vizCaptured_) { editor_->vizUp(e, ctx_); vizCaptured_ = false; }
    }
    void mouseDouble(const MouseEvent& e) {
        if (overlayActive()) return;
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->visible && (*it)->hit(e.x, e.y)) { (*it)->onDouble(e, access_); return; }
        if (editor_) editor_->vizDouble(e, ctx_);
    }
    void mouseWheel(const MouseEvent& e) {
        if (overlayActive()) return;
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->visible && (*it)->hit(e.x, e.y)) { (*it)->onWheel(e, access_); return; }
        if (editor_) editor_->vizWheel(e, ctx_);
    }
    void mouseLeave() { if (!captured_) hover_ = nullptr; }
    Widget* widgetAt(float x, float y) {
        for (auto it = ctx_.widgets.rbegin(); it != ctx_.widgets.rend(); ++it)
            if ((*it)->visible && (*it)->hit(x, y)) return it->get();
        return nullptr;
    }

    ParamAccess& access() { return access_; }
    JasWaveVst::JwController* controller() { return ctl_; }

private:
    Button* activeOverlayButton() {
        if (lic_.phase == JasWaveLicense::Phase::WaitingApproval || lic_.phase == JasWaveLicense::Phase::Starting) return cancel_.get();
        return login_.get();
    }
    void drawOverlay(Gfx& g) {
        g.fillChamfer(Layout::kScreen, 14.0f, hex(0x000000, 0.70f));
        const Rect card{ 320.0f, 196.0f, 780.0f, 436.0f };
        g.fillChamfer(card.inset(-3.0f), 9.0f, Pal::cianGlow.withAlpha(0.08f));
        g.fillChamfer(card, 6.0f, hex(0x0B1823, 0.97f));
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
        g.fillRect(r, hex(0x08131B, 0.96f));
        g.strokeRect(r, Pal::bloqueado, 1.0f);
        g.text(text, r, Font::Label, Pal::textoEtiqueta, Align::Center);
    }

    ControllerAccess access_;
    EditorContext ctx_;
    JasWaveVst::JwController* ctl_;
    std::unique_ptr<PluginEditor> editor_;
    Dropdown* mode_{nullptr};
    std::wstring footer_;
    std::unique_ptr<Button> login_, cancel_;
    JasWaveLicense::UiStatus lic_;
    uint32_t licSerial_{~0u};
    Widget* hover_{nullptr};
    Widget* captured_{nullptr};
    bool vizCaptured_{false};
    Pt mouse_{ -100.0f, -100.0f };
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
        const float minW = kBaseW * 0.6f * scaleFactor_;
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
        if (hwnd_) {
            KillTimer(hwnd_, kTimer);
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
                return 0;
            case WM_LBUTTONDOWN: {
                SetFocus(hwnd);
                const int menu = self->core_->mouseDown(self->toDesign(lp, wp));
                if (menu >= 0) self->openMenu(menu);
                else SetCapture(hwnd);
                return 0;
            }
            case WM_LBUTTONDBLCLK: self->core_->mouseDouble(self->toDesign(lp, wp)); return 0;
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

} // namespace JasWaveUI

// ---- JwController::createView ----
namespace JasWaveVst {
IPlugView* PLUGIN_API JwController::createView(FIDString name) {
    if (name && std::strcmp(name, ViewType::kEditor) == 0) return new JasWaveUI::EditorView(this);
    return nullptr;
}
} // namespace JasWaveVst
