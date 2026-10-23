// =====================================================================================
//  JasWave UI "Cyber" (DESIGN.md) – Direct2D + DirectWrite, compartida por todos los VST
//   - Gfx: primitivas en unidades lógicas de diseño (1100×620), escaladas por transformación
//   - Widgets: perilla, fader, sección con toggle, desplegable, botón, medidor, LEDs
//   - PluginEditor: cada plugin define su layout, su visualizador y su telemetría
//   - EditorView: IPlugView HWND (HiDPI, 60 fps, ratón/teclado) y render a PNG (capturas)
//  Sin asignaciones por frame en el camino caliente: geometrías, pinceles, formatos y
//  layouts de texto se cachean; el fondo estático se pre-renderiza en un bitmap.
// =====================================================================================
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <d2d1_1.h>
#include <dwrite_1.h>

#include "jw_params.h"
#include "jw_dsp.h"

#include <array>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace JasWaveVst { class JwController; }

namespace JasWaveUI {

constexpr float kBaseW = 1100.0f;
constexpr float kBaseH = 620.0f;

// ---------------------------------------------------------------------------------
//  Paleta (DESIGN.md §2)
// ---------------------------------------------------------------------------------
struct Color {
    float r, g, b, a;
    constexpr Color withAlpha(float na) const { return { r, g, b, na }; }
};
constexpr Color hex(uint32_t rgb, float a = 1.0f) {
    return { ((rgb >> 16) & 0xFF) / 255.0f, ((rgb >> 8) & 0xFF) / 255.0f, (rgb & 0xFF) / 255.0f, a };
}
namespace Pal {
constexpr Color metalAlto = hex(0x3A4148), metalBajo = hex(0x15191D);
constexpr Color metalBrillo = hex(0x5C666F), metalSombra = hex(0x0A0C0E);
constexpr Color pantallaCentro = hex(0x0A1822), pantallaBorde = hex(0x050D14);
constexpr Color panelFondo = hex(0x0B1823, 0.88f), panelBorde = hex(0x1E4656);
constexpr Color reticula = hex(0x163543, 0.55f), reticulaNodo = hex(0x3FB8D0);
constexpr Color cian = hex(0x2FD6F2), cianNucleo = hex(0xBFF6FF), cianGlow = hex(0x2FD6F2, 0.35f);
constexpr Color textoTitulo = hex(0x7FE3F5), textoEtiqueta = hex(0x8FB4BF), textoValor = hex(0xA8EEFA), textoTenue = hex(0x4F6B75);
constexpr Color bloqueado = hex(0x5A6870), alerta = hex(0xF2B544);
constexpr Color perillaCuerpo = hex(0x0E1A22), perillaPista = hex(0x1A2C36);
}

enum class Font : uint8_t {
    Title,          // Bahnschrift Light 22
    Brand,          // Bahnschrift Light 26
    Section,        // Bahnschrift SemiBold SemiCondensed 13
    Label,          // Bahnschrift SemiCondensed 11
    Value,          // Consolas 11.5
    ValueSmall,     // Consolas 10
    CodeBig,        // Consolas 28
    Body,           // Bahnschrift 13
    Count
};
enum class Align : uint8_t { Left, Center, Right };

struct Pt { float x, y; };
struct Rect {
    float l, t, r, b;
    float w() const { return r - l; }
    float h() const { return b - t; }
    float cx() const { return 0.5f * (l + r); }
    float cy() const { return 0.5f * (t + b); }
    bool contains(float x, float y) const { return x >= l && x <= r && y >= t && y <= b; }
    Rect inset(float d) const { return { l + d, t + d, r - d, b - d }; }
};

// ---------------------------------------------------------------------------------
//  Gfx: envoltorio Direct2D con cachés
// ---------------------------------------------------------------------------------
class Gfx {
public:
    Gfx();
    ~Gfx();
    Gfx(const Gfx&) = delete;
    Gfx& operator=(const Gfx&) = delete;

    // Ventana: crea/redimensiona el HwndRenderTarget (px físicos)
    bool beginHwnd(HWND hwnd, UINT pxW, UINT pxH);
    // Destino externo (bitmap WIC, capturas)
    bool beginExternal(ID2D1RenderTarget* rt);
    bool end();   // false si el destino se perdió (se recrea en el siguiente frame)

    void setScale(float s);          // unidades de diseño -> px
    float scale() const { return scale_; }
    ID2D1RenderTarget* target() const { return rt_; }
    ID2D1Factory* factory() const;
    IDWriteFactory* dwrite() const;

    void clear(Color c);
    void fillRect(const Rect& r, Color c);
    void strokeRect(const Rect& r, Color c, float w = 1.0f);
    void fillRound(const Rect& r, float radius, Color c);
    void strokeRound(const Rect& r, float radius, Color c, float w = 1.0f);
    void fillChamfer(const Rect& r, float ch, Color c);
    void strokeChamfer(const Rect& r, float ch, Color c, float w = 1.0f);
    void fillChamferGradient(const Rect& r, float ch, Color top, Color bottom);
    void fillRectGradient(const Rect& r, Color top, Color bottom);
    void fillRadial(const Rect& r, Color center, Color edge);
    void line(float x0, float y0, float x1, float y1, Color c, float w = 1.0f);
    void glowLine(float x0, float y0, float x1, float y1, Color c, float w);
    void polyline(const Pt* p, int n, Color c, float w = 1.0f);
    void glowPolyline(const Pt* p, int n, Color c, float w);
    void fillUnder(const Pt* p, int n, float baseY, Color c);   // relleno bajo una curva (columnas)
    void circle(float cx, float cy, float r, Color c, float w = 1.0f);
    void fillCircle(float cx, float cy, float r, Color c);
    void glowDot(float cx, float cy, float r, Color c);
    void arc(float cx, float cy, float r, float a0, float a1, Color c, float w);   // ángulos en radianes (0 = derecha, sentido horario)
    void glowArc(float cx, float cy, float r, float a0, float a1, Color c, float w);
    void glowRect(const Rect& r, Color c, float spread);
    void hexagon(float cx, float cy, float r, Color c, float w = 1.0f);

    // Texto: las etiquetas estáticas usan layouts cacheados (espaciado +12 %)
    void text(const std::wstring& s, const Rect& r, Font f, Color c, Align a = Align::Left, bool spaced = false);
    void text(const wchar_t* s, const Rect& r, Font f, Color c, Align a = Align::Left, bool spaced = false);
    float textWidth(const std::wstring& s, Font f, bool spaced = false);

    // Fondo estático pre-renderizado (marco + pantalla + retícula): se invalida al cambiar el tamaño
    using StaticPainter = std::function<void(Gfx&)>;
    void drawCachedBackground(const StaticPainter& painter);
    void invalidateBackground();

private:
    struct Impl;
    std::unique_ptr<Impl> d_;
    ID2D1RenderTarget* rt_{nullptr};
    float scale_{1.0f};
    ID2D1SolidColorBrush* brush(Color c);
    ID2D1PathGeometry* chamferGeom(const Rect& r, float ch);
    IDWriteTextFormat* format(Font f, Align a);
    void releaseTargetResources();
};

// ---------------------------------------------------------------------------------
//  Acceso a parámetros desde la UI (implementado por EditorView sobre JwController)
// ---------------------------------------------------------------------------------
class ParamAccess {
public:
    virtual ~ParamAccess() = default;
    virtual const JasWaveVst::ParamDef* def(uint32_t id) const = 0;
    virtual double norm(uint32_t id) const = 0;
    virtual double plain(uint32_t id) const = 0;
    virtual void beginEdit(uint32_t id) = 0;
    virtual void performEdit(uint32_t id, double norm) = 0;
    virtual void endEdit(uint32_t id) = 0;
    virtual bool locked(uint32_t id) const = 0;      // feature no concedida
    virtual bool featureGranted(int featureIndex) const = 0;
    virtual std::shared_ptr<JasWaveDsp::MeterBusBase> bus() const = 0;
    void setNorm(uint32_t id, double n) { beginEdit(id); performEdit(id, n); endEdit(id); }
};

// ---------------------------------------------------------------------------------
//  Widgets
// ---------------------------------------------------------------------------------
struct MouseEvent {
    float x, y;          // unidades de diseño
    bool shift, ctrl;
    int wheel;           // pasos (+/-)
};

class Widget {
public:
    explicit Widget(Rect r) : rect(r) {}
    virtual ~Widget() = default;
    virtual void draw(Gfx& g, ParamAccess& p, bool hover) = 0;
    virtual bool hit(float x, float y) const { return rect.contains(x, y); }
    virtual bool onDown(const MouseEvent&, ParamAccess&) { return false; }     // true = captura
    virtual void onDrag(const MouseEvent&, ParamAccess&) {}
    virtual void onUp(const MouseEvent&, ParamAccess&) {}
    virtual void onDouble(const MouseEvent&, ParamAccess&) {}
    virtual void onWheel(const MouseEvent&, ParamAccess&) {}
    virtual int paramId() const { return -1; }            // para clic derecho = escribir valor / menú
    virtual bool isLocked(ParamAccess& p) const { const int id = paramId(); return id >= 0 && p.locked(static_cast<uint32_t>(id)); }
    Rect rect;
    bool visible{true};
};

enum class KnobSize : uint8_t { Small = 30, Normal = 44, Main = 64 };

class Knob : public Widget {
public:
    Knob(uint32_t id, float cx, float cy, KnobSize size, const wchar_t* label);
    void draw(Gfx& g, ParamAccess& p, bool hover) override;
    bool onDown(const MouseEvent& e, ParamAccess& p) override;
    void onDrag(const MouseEvent& e, ParamAccess& p) override;
    void onUp(const MouseEvent& e, ParamAccess& p) override;
    void onDouble(const MouseEvent& e, ParamAccess& p) override;
    void onWheel(const MouseEvent& e, ParamAccess& p) override;
    int paramId() const override { return static_cast<int>(id_); }
private:
    uint32_t id_;
    float cx_, cy_, radius_;
    std::wstring label_;
    float dragY_{0}, dragStart_{0};
    bool dragging_{false};
};

class Fader : public Widget {
public:
    Fader(uint32_t id, Rect r, const wchar_t* label);
    void draw(Gfx& g, ParamAccess& p, bool hover) override;
    bool onDown(const MouseEvent& e, ParamAccess& p) override;
    void onDrag(const MouseEvent& e, ParamAccess& p) override;
    void onUp(const MouseEvent& e, ParamAccess& p) override;
    void onDouble(const MouseEvent& e, ParamAccess& p) override;
    void onWheel(const MouseEvent& e, ParamAccess& p) override;
    int paramId() const override { return static_cast<int>(id_); }
private:
    Rect slot() const;
    uint32_t id_;
    std::wstring label_;
    float dragY_{0}, dragStart_{0};
    bool dragging_{false};
};

// Interruptor (píldora o botón con texto) ligado a un parámetro escalonado de 2 estados
class Toggle : public Widget {
public:
    Toggle(uint32_t id, Rect r, const wchar_t* label, bool invert = false);   // invert: activo cuando el valor es 0 (p. ej. Bypass)
    void draw(Gfx& g, ParamAccess& p, bool hover) override;
    bool onDown(const MouseEvent& e, ParamAccess& p) override;
    int paramId() const override { return static_cast<int>(id_); }
private:
    uint32_t id_;
    std::wstring label_;
    bool invert_;
};

// Selector de lista (parámetro escalonado con etiquetas): clic = menú
class Dropdown : public Widget {
public:
    Dropdown(uint32_t id, Rect r, const wchar_t* label);
    void draw(Gfx& g, ParamAccess& p, bool hover) override;
    int paramId() const override { return static_cast<int>(id_); }
    bool onDown(const MouseEvent& e, ParamAccess& p) override;   // la vista abre el menú (paramId)
    const std::wstring& label() const { return label_; }
private:
    uint32_t id_;
    std::wstring label_;
};

// Caja de sección con título y toggle píldora opcional (bypass/activación de la sección)
class Section : public Widget {
public:
    Section(Rect r, const wchar_t* title, int toggleParam = -1, bool invertToggle = false, int feature = -1);
    void draw(Gfx& g, ParamAccess& p, bool hover) override;
    bool hit(float x, float y) const override;
    bool onDown(const MouseEvent& e, ParamAccess& p) override;
    int paramId() const override { return toggle_; }
    bool isLocked(ParamAccess& p) const override;
    Rect pillRect() const;
private:
    std::wstring title_;
    int toggle_;
    bool invert_;
    int feature_;
};

// Medidor vertical segmentado (LED); el valor lo fija el editor en tick()
class Meter : public Widget {
public:
    Meter(Rect r, const wchar_t* label, float minDb = -60.0f, float maxDb = 6.0f, bool inverted = false);
    void draw(Gfx& g, ParamAccess& p, bool hover) override;
    void set(float db, float peakDb) { db_ = db; peak_ = peakDb; }
private:
    std::wstring label_;
    float minDb_, maxDb_;
    bool inverted_;     // reducción de ganancia: crece hacia abajo
    float db_{-120.0f}, peak_{-120.0f};
};

// Botón de acción (no ligado a parámetro)
class Button : public Widget {
public:
    Button(Rect r, const wchar_t* text, std::function<void()> action);
    void draw(Gfx& g, ParamAccess& p, bool hover) override;
    bool onDown(const MouseEvent& e, ParamAccess& p) override;
    std::wstring text;
private:
    std::function<void()> action_;
};

// ---------------------------------------------------------------------------------
//  Editor por plugin
// ---------------------------------------------------------------------------------
class EditorContext {
public:
    explicit EditorContext(ParamAccess& p) : params(p) {}
    ParamAccess& params;
    std::vector<std::unique_ptr<Widget>> widgets;
    Knob* knob(uint32_t id, float cx, float cy, KnobSize s, const wchar_t* label);
    Fader* fader(uint32_t id, Rect r, const wchar_t* label);
    Toggle* toggle(uint32_t id, Rect r, const wchar_t* label, bool invert = false);
    Dropdown* dropdown(uint32_t id, Rect r, const wchar_t* label);
    Section* section(Rect r, const wchar_t* title, int toggleParam = -1, bool invertToggle = false, int feature = -1);
    Meter* meter(Rect r, const wchar_t* label, float minDb = -60.0f, float maxDb = 6.0f, bool inverted = false);
    Button* button(Rect r, const wchar_t* text, std::function<void()> action);
};

// Zonas estándar de la pantalla (DESIGN.md §1) en unidades de diseño
namespace Layout {
constexpr Rect kScreen{ 34.0f, 34.0f, 1066.0f, 586.0f };
constexpr Rect kVisualizer{ 52.0f, 92.0f, 652.0f, 404.0f };      // ≈60 % del ancho útil
constexpr Rect kMiniPanel{ 52.0f, 418.0f, 652.0f, 556.0f };
constexpr Rect kRightTop{ 666.0f, 92.0f, 1048.0f, 404.0f };
constexpr Rect kRightBottom{ 666.0f, 418.0f, 1048.0f, 556.0f };
}

class PluginEditor {
public:
    virtual ~PluginEditor() = default;
    virtual const wchar_t* title() const = 0;                 // "PARAMETRIC EQ"
    virtual const wchar_t* subtitle() const { return L""; }   // modo / descripción corta en la cabecera
    virtual int modeParam() const { return -1; }              // desplegable "MODO" de la cabecera (opcional)
    virtual void build(EditorContext& ctx) = 0;
    virtual void tick(EditorContext&) {}                      // ~60 Hz, hilo UI: leer telemetría
    virtual void drawPanels(Gfx&, EditorContext&) {}          // visualizador principal y mini-paneles
    virtual float outputLevel() const { return 0.0f; }        // 0..1 para los LEDs del marco
    // interacción con el visualizador (p. ej. nodos de EQ). true = captura
    virtual bool vizDown(const MouseEvent&, EditorContext&) { return false; }
    virtual void vizDrag(const MouseEvent&, EditorContext&) {}
    virtual void vizUp(const MouseEvent&, EditorContext&) {}
    virtual void vizWheel(const MouseEvent&, EditorContext&) {}
    virtual void vizDouble(const MouseEvent&, EditorContext&) {}
    virtual const wchar_t* footerId() const { return L""; }   // "com.jaswave.plugin.x" (pie)
};

// Dibujo compartido del marco, cabecera y overlay de licencia
namespace Chrome {
void drawStaticBackground(Gfx& g);                                       // marco, pantalla, retícula, hexágonos, partículas
void drawHeader(Gfx& g, const wchar_t* title, const wchar_t* subtitle, bool expiringSoon, bool licensed);
void drawFrameLeds(Gfx& g, float level);
void drawFooter(Gfx& g, const wchar_t* id);
void drawGrid(Gfx& g, const Rect& r, float step, bool nodes);
void drawPanelBox(Gfx& g, const Rect& r, const wchar_t* title);
void drawLock(Gfx& g, float x, float y, float s, Color c);
}

// Renderiza un editor completo (sin ventana) en un PNG. Ver jw_snapshot_main.cpp.
bool renderEditorToPng(JasWaveVst::JwController* controller, const wchar_t* path, UINT pxW, UINT pxH, int warmupFrames);

} // namespace JasWaveUI
