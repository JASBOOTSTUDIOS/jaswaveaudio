// JasWave UI – marco, cabecera y componentes (DESIGN.md §1, §4)
#include "jw_ui.h"

#include <algorithm>
#include <cmath>
#include <cwchar>

namespace JasWaveUI {

namespace {
constexpr float kPi = 3.14159265358979f;
constexpr float kKnobStart = 135.0f * kPi / 180.0f;
constexpr float kKnobSpan = 270.0f * kPi / 180.0f;

std::wstring widen(const std::string& s) {
    if (s.empty()) return std::wstring();
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(std::max(0, n)), L'\0');
    if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), &w[0], n);
    return w;
}

std::wstring valueText(ParamAccess& p, uint32_t id) {
    const JasWaveVst::ParamDef* d = p.def(id);
    if (!d) return std::wstring();
    return widen(JasWaveVst::formatValue(*d, p.plain(id), true));
}

uint32_t lcg(uint32_t& s) { s = s * 1664525u + 1013904223u; return s >> 8; }
float frand(uint32_t& s) { return static_cast<float>(lcg(s) & 0xFFFF) / 65535.0f; }

double stepNorm(const JasWaveVst::ParamDef* d, double n, int dir) {
    if (!d) return n;
    if (d->map == JasWaveVst::Map::Stepped && d->steps > 0) {
        const double v = std::floor(n * d->steps + 0.5) + dir;
        return std::clamp(v / d->steps, 0.0, 1.0);
    }
    return std::clamp(n + dir * 0.01, 0.0, 1.0);
}
} // namespace

// =====================================================================================
//  Chrome
// =====================================================================================
namespace Chrome {

void drawGrid(Gfx& g, const Rect& r, float step, bool nodes) {
    const float x0 = std::ceil((r.l - Layout::kScreen.l) / step) * step + Layout::kScreen.l;
    const float y0 = std::ceil((r.t - Layout::kScreen.t) / step) * step + Layout::kScreen.t;
    for (float x = x0; x < r.r; x += step) g.line(x, r.t, x, r.b, Pal::reticula, 1.0f);
    for (float y = y0; y < r.b; y += step) g.line(r.l, y, r.r, y, Pal::reticula, 1.0f);
    if (!nodes) return;
    uint32_t seed = 0x5EED1234u;
    for (float x = x0; x < r.r; x += step)
        for (float y = y0; y < r.b; y += step)
            if ((lcg(seed) % 7u) == 0u) g.glowDot(x, y, 1.1f, Pal::reticulaNodo.withAlpha(0.55f));
}

void drawLock(Gfx& g, float x, float y, float s, Color c) {
    // candado: arco + cuerpo
    g.arc(x, y - s * 0.15f, s * 0.32f, kPi, 2.0f * kPi, c, s * 0.12f);
    g.line(x - s * 0.32f, y - s * 0.15f, x - s * 0.32f, y + s * 0.05f, c, s * 0.12f);
    g.line(x + s * 0.32f, y - s * 0.15f, x + s * 0.32f, y + s * 0.05f, c, s * 0.12f);
    g.fillRound({ x - s * 0.45f, y + s * 0.02f, x + s * 0.45f, y + s * 0.6f }, s * 0.08f, c);
}

void drawPanelBox(Gfx& g, const Rect& r, const wchar_t* title) {
    g.fillChamfer(r, 6.0f, Pal::panelFondo);
    g.strokeChamfer(r, 6.0f, Pal::panelBorde, 1.0f);
    if (title && *title) g.text(title, { r.l + 10.0f, r.t + 4.0f, r.r - 40.0f, r.t + 24.0f }, Font::Section, Pal::textoTitulo, Align::Left, true);
}

void drawStaticBackground(Gfx& g) {
    g.clear(hex(0x06080A));
    // --- marco metálico cepillado con pestañas ---
    const Rect frame{ 0.0f, 10.0f, kBaseW, kBaseH - 10.0f };
    const Rect tabTop{ 420.0f, 0.0f, 680.0f, 40.0f };
    const Rect tabBot{ 420.0f, kBaseH - 40.0f, 680.0f, kBaseH };
    g.fillChamferGradient(tabTop, 10.0f, hex(0x46505A), Pal::metalAlto);
    g.fillChamferGradient(tabBot, 10.0f, hex(0x262C32), Pal::metalBajo);
    g.fillChamferGradient(frame, 26.0f, Pal::metalAlto, Pal::metalBajo);
    // ruido horizontal (cepillado) al 4 %
    uint32_t seed = 0xB12A5EDu;
    for (float y = 11.0f; y < kBaseH - 11.0f; y += 1.5f) {
        const float a = 0.015f + 0.04f * frand(seed);
        const bool light = (lcg(seed) & 1u) != 0u;
        const float x0 = 6.0f + 20.0f * frand(seed), x1 = kBaseW - 6.0f - 20.0f * frand(seed);
        g.line(x0, y, x1, y, light ? hex(0xFFFFFF, a) : hex(0x000000, a * 1.4f), 0.7f);
    }
    // bisel: 1 px claro arriba-izquierda, 1 px oscuro abajo-derecha
    g.strokeChamfer(frame.inset(0.5f), 26.0f, Pal::metalSombra, 1.0f);
    g.line(26.0f, 11.0f, kBaseW - 26.0f, 11.0f, Pal::metalBrillo, 1.0f);
    g.line(1.0f, 36.0f, 1.0f, kBaseH - 36.0f, Pal::metalBrillo.withAlpha(0.8f), 1.0f);
    g.line(430.0f, 1.0f, 670.0f, 1.0f, Pal::metalBrillo, 1.0f);
    g.line(26.0f, kBaseH - 11.0f, kBaseW - 26.0f, kBaseH - 11.0f, Pal::metalSombra, 1.0f);
    g.line(kBaseW - 1.0f, 36.0f, kBaseW - 1.0f, kBaseH - 36.0f, Pal::metalSombra, 1.0f);
    // tornillos decorativos en las esquinas
    const Pt screws[4] = { { 30, 26 }, { kBaseW - 30, 26 }, { 30, kBaseH - 26 }, { kBaseW - 30, kBaseH - 26 } };
    for (const Pt& s : screws) {
        g.fillCircle(s.x, s.y, 4.0f, hex(0x22282E));
        g.circle(s.x, s.y, 4.0f, Pal::metalBrillo.withAlpha(0.6f), 0.8f);
        g.line(s.x - 2.5f, s.y - 2.5f, s.x + 2.5f, s.y + 2.5f, Pal::metalSombra, 1.0f);
    }
    // LEDs laterales verticales (4×70) con resplandor y LED inferior (60×4)
    const float midY = kBaseH * 0.5f;
    g.glowRect({ 13.0f, midY - 35.0f, 17.0f, midY + 35.0f }, Pal::cian, 10.0f);
    g.fillRect({ 14.2f, midY - 33.0f, 15.8f, midY + 33.0f }, Pal::cianNucleo.withAlpha(0.8f));
    g.glowRect({ kBaseW - 17.0f, midY - 35.0f, kBaseW - 13.0f, midY + 35.0f }, Pal::cian, 10.0f);
    g.fillRect({ kBaseW - 15.8f, midY - 33.0f, kBaseW - 14.2f, midY + 33.0f }, Pal::cianNucleo.withAlpha(0.8f));
    g.glowRect({ 520.0f, kBaseH - 13.0f, 580.0f, kBaseH - 9.0f }, Pal::cian, 10.0f);
    g.fillRect({ 522.0f, kBaseH - 11.8f, 578.0f, kBaseH - 10.2f }, Pal::cianNucleo.withAlpha(0.8f));

    // --- pantalla ---
    const Rect sc = Layout::kScreen;
    g.fillChamfer(sc.inset(-2.0f), 15.0f, hex(0x020405));
    g.fillChamfer(sc, 14.0f, Pal::pantallaBorde);
    g.fillRadial(sc, Pal::pantallaCentro, Pal::pantallaBorde);
    // sombra interior
    for (int i = 1; i <= 6; ++i) g.strokeChamfer(sc.inset(static_cast<float>(i)), 14.0f, hex(0x000000, 0.22f - i * 0.03f), 1.2f);
    drawGrid(g, sc.inset(3.0f), 44.0f, true);
    // hexágonos de contorno (5 %) arriba-izquierda
    for (int row = 0; row < 4; ++row)
        for (int col = 0; col < 6 - row; ++col)
            g.hexagon(70.0f + col * 30.0f + (row & 1) * 15.0f, 108.0f + row * 26.0f, 15.0f, Pal::cian.withAlpha(0.05f), 1.0f);
    // partículas deterministas
    uint32_t ps = 0xC0FFEEu;
    for (int i = 0; i < 40; ++i) {
        const float x = sc.l + 12.0f + frand(ps) * (sc.w() - 24.0f);
        const float y = sc.t + 12.0f + frand(ps) * (sc.h() - 24.0f);
        g.fillCircle(x, y, 0.6f, Pal::cianNucleo.withAlpha(0.3f));
    }
    g.strokeChamfer(sc, 14.0f, Pal::cian.withAlpha(0.35f), 1.0f);
}

void drawHeader(Gfx& g, const wchar_t* title, const wchar_t* subtitle, bool expiringSoon, bool licensed) {
    const Rect tr{ 58.0f, 42.0f, 520.0f, 74.0f };
    // glow sutil del título
    g.text(title, { tr.l + 0.8f, tr.t + 0.8f, tr.r + 0.8f, tr.b + 0.8f }, Font::Title, Pal::cian.withAlpha(0.18f), Align::Left, true);
    g.text(title, { tr.l - 0.8f, tr.t - 0.4f, tr.r - 0.8f, tr.b - 0.4f }, Font::Title, Pal::cian.withAlpha(0.12f), Align::Left, true);
    g.text(title, tr, Font::Title, Pal::textoTitulo, Align::Left, true);
    if (subtitle && *subtitle) g.text(subtitle, { 58.0f, 70.0f, 520.0f, 86.0f }, Font::Label, Pal::textoTenue, Align::Left, true);
    // indicador central "·  ●  ·"
    const float cx = 600.0f, cy = 58.0f;
    g.fillCircle(cx - 16.0f, cy, 1.4f, Pal::cian.withAlpha(0.5f));
    g.fillCircle(cx + 16.0f, cy, 1.4f, Pal::cian.withAlpha(0.5f));
    if (expiringSoon) g.glowDot(cx, cy, 3.6f, Pal::alerta);
    else if (licensed) g.glowDot(cx, cy, 3.6f, Pal::cian);
    else g.fillCircle(cx, cy, 3.6f, Pal::bloqueado);
    // marca
    g.text(L"JASWAVE", { 860.0f, 40.0f, 1046.0f, 72.0f }, Font::Brand, Pal::textoTitulo, Align::Right, true);
    g.line(918.0f, 74.0f, 1046.0f, 74.0f, Pal::cian.withAlpha(0.4f), 1.0f);
}

void drawFrameLeds(Gfx& g, float level) {
    const int lit = static_cast<int>(std::lround(std::clamp(level, 0.0f, 1.0f) * 8.0f));
    for (int i = 0; i < 8; ++i) {
        const float x = 1016.0f + i * 6.0f;
        const Color c = i < lit ? (i == 7 ? Pal::alerta : Pal::cian) : Pal::cian.withAlpha(0.15f);
        for (const float y : { 12.0f, kBaseH - 22.0f }) {
            if (i < lit) g.fillRect({ x - 1.5f, y - 1.5f, x + 3.5f, y + 11.5f }, c.withAlpha(0.18f));
            g.fillRect({ x, y, x + 2.0f, y + 10.0f }, c);
        }
    }
}

void drawFooter(Gfx& g, const wchar_t* id) {
    std::wstring s = L"jaswave · ";
    s += id ? id : L"";
    g.text(s, { 600.0f, 562.0f, 1046.0f, 580.0f }, Font::ValueSmall, Pal::textoTenue, Align::Right);
}

} // namespace Chrome

// =====================================================================================
//  Knob
// =====================================================================================
Knob::Knob(uint32_t id, float cx, float cy, KnobSize size, const wchar_t* label)
    : Widget({ cx - static_cast<float>(size) * 0.5f - 6.0f, cy - static_cast<float>(size) * 0.5f - 4.0f,
               cx + static_cast<float>(size) * 0.5f + 6.0f, cy + static_cast<float>(size) * 0.5f + 26.0f }),
      id_(id), cx_(cx), cy_(cy), radius_(static_cast<float>(size) * 0.5f), label_(label ? label : L"") {}

void Knob::draw(Gfx& g, ParamAccess& p, bool hover) {
    const bool locked = p.locked(id_);
    const JasWaveVst::ParamDef* d = p.def(id_);
    const double n = p.norm(id_);
    const float r = radius_;
    const Color accent = locked ? Pal::bloqueado : Pal::cian;
    // cuerpo + anillo metálico
    g.fillCircle(cx_, cy_, r - 5.0f, Pal::perillaCuerpo);
    g.circle(cx_, cy_, r - 5.0f, Pal::metalBrillo.withAlpha(0.75f), 1.5f);
    g.circle(cx_, cy_, r - 6.5f, Pal::metalSombra, 1.0f);
    // pista y arco de valor
    const float tw = r >= 30.0f ? 3.5f : 3.0f;
    g.arc(cx_, cy_, r - 1.5f, kKnobStart, kKnobStart + kKnobSpan, Pal::perillaPista, tw);
    const bool bip = d && d->bipolar;
    const float aVal = kKnobStart + kKnobSpan * static_cast<float>(n);
    const float aFrom = bip ? kKnobStart + kKnobSpan * 0.5f : kKnobStart;
    if (std::fabs(aVal - aFrom) > 0.002f) {
        if (locked) g.arc(cx_, cy_, r - 1.5f, std::min(aFrom, aVal), std::max(aFrom, aVal), accent, tw);
        else g.glowArc(cx_, cy_, r - 1.5f, std::min(aFrom, aVal), std::max(aFrom, aVal), accent, tw);
    }
    // indicador en el borde
    const float ix = cx_ + (r - 1.5f) * std::cos(aVal), iy = cy_ + (r - 1.5f) * std::sin(aVal);
    if (locked) g.fillCircle(ix, iy, 2.2f, Pal::bloqueado);
    else g.glowDot(ix, iy, 2.2f, Pal::cianNucleo);
    // línea interior hacia el indicador
    g.line(cx_ + (r - 14.0f) * std::cos(aVal), cy_ + (r - 14.0f) * std::sin(aVal), cx_ + (r - 8.0f) * std::cos(aVal),
           cy_ + (r - 8.0f) * std::sin(aVal), locked ? Pal::bloqueado : Pal::textoValor, 1.4f);
    if (locked) Chrome::drawLock(g, cx_, cy_ - 2.0f, std::max(9.0f, r * 0.42f), Pal::bloqueado);
    // etiqueta (valor al pasar el ratón / arrastrar)
    const Rect lr{ cx_ - 60.0f, cy_ + r + 2.0f, cx_ + 60.0f, cy_ + r + 18.0f };
    if ((hover || dragging_) && !locked) g.text(valueText(p, id_), lr, Font::Value, Pal::textoValor, Align::Center);
    else g.text(label_, lr, Font::Label, locked ? Pal::bloqueado : Pal::textoEtiqueta, Align::Center, true);
}

bool Knob::onDown(const MouseEvent& e, ParamAccess& p) {
    if (p.locked(id_)) return false;
    dragging_ = true;
    dragY_ = e.y;
    dragStart_ = static_cast<float>(p.norm(id_));
    p.beginEdit(id_);
    return true;
}
void Knob::onDrag(const MouseEvent& e, ParamAccess& p) {
    if (!dragging_) return;
    const float sens = e.shift ? 1.0f / 900.0f : 1.0f / 180.0f;
    double n = std::clamp(static_cast<double>(dragStart_) + (dragY_ - e.y) * sens, 0.0, 1.0);
    const JasWaveVst::ParamDef* d = p.def(id_);
    if (d && d->map == JasWaveVst::Map::Stepped && d->steps > 0) n = std::floor(n * d->steps + 0.5) / d->steps;
    p.performEdit(id_, n);
}
void Knob::onUp(const MouseEvent&, ParamAccess& p) {
    if (!dragging_) return;
    dragging_ = false;
    p.endEdit(id_);
}
void Knob::onDouble(const MouseEvent&, ParamAccess& p) {
    if (p.locked(id_)) return;
    if (const JasWaveVst::ParamDef* d = p.def(id_)) p.setNorm(id_, JasWaveVst::defaultNorm(*d));
}
void Knob::onWheel(const MouseEvent& e, ParamAccess& p) {
    if (p.locked(id_) || e.wheel == 0) return;
    const JasWaveVst::ParamDef* d = p.def(id_);
    double n = p.norm(id_);
    if (d && d->map == JasWaveVst::Map::Stepped) n = stepNorm(d, n, e.wheel > 0 ? 1 : -1);
    else n = std::clamp(n + e.wheel * (e.shift ? 0.002 : 0.01), 0.0, 1.0);
    p.setNorm(id_, n);
}

// =====================================================================================
//  Fader
// =====================================================================================
Fader::Fader(uint32_t id, Rect r, const wchar_t* label) : Widget(r), id_(id), label_(label ? label : L"") {}

Rect Fader::slot() const { return { rect.cx() - 3.0f, rect.t + 8.0f, rect.cx() + 3.0f, rect.b - 36.0f }; }

void Fader::draw(Gfx& g, ParamAccess& p, bool hover) {
    const bool locked = p.locked(id_);
    const Rect s = slot();
    const float n = static_cast<float>(p.norm(id_));
    const float capY = s.b - n * s.h();
    // marcas de escala
    for (int i = 0; i <= 10; ++i) {
        const float y = s.t + s.h() * i / 10.0f;
        g.line(s.l - (i % 5 == 0 ? 9.0f : 6.0f), y, s.l - 3.0f, y, Pal::textoTenue.withAlpha(0.7f), 1.0f);
    }
    g.fillRect({ s.l - 1, s.t - 1, s.r + 1, s.b + 1 }, hex(0x020507));
    g.strokeRect(s, Pal::panelBorde, 1.0f);
    g.fillRect({ s.l + 1.0f, capY, s.r - 1.0f, s.b - 0.5f }, (locked ? Pal::bloqueado : Pal::cian).withAlpha(0.32f));
    // tapa metálica 22×10 con línea cian
    const Rect cap{ s.cx() - 11.0f, capY - 5.0f, s.cx() + 11.0f, capY + 5.0f };
    g.fillRectGradient(cap, hex(0x6A747E), hex(0x2A3036));
    g.strokeRect(cap, Pal::metalSombra, 1.0f);
    if (locked) g.line(cap.l + 2, capY, cap.r - 2, capY, Pal::bloqueado, 1.5f);
    else g.glowLine(cap.l + 2, capY, cap.r - 2, capY, Pal::cian, 1.4f);
    const Color vc = locked ? Pal::bloqueado : Pal::textoValor;
    g.text(valueText(p, id_), { rect.l - 14.0f, rect.b - 32.0f, rect.r + 14.0f, rect.b - 18.0f }, Font::ValueSmall, vc, Align::Center);
    g.text(label_, { rect.l - 14.0f, rect.b - 17.0f, rect.r + 14.0f, rect.b - 2.0f }, Font::Label, locked ? Pal::bloqueado : Pal::textoEtiqueta,
           Align::Center, true);
    if (locked) Chrome::drawLock(g, s.cx() + 13.0f, s.t + 6.0f, 9.0f, Pal::bloqueado);
    (void)hover;
}
bool Fader::onDown(const MouseEvent& e, ParamAccess& p) {
    if (p.locked(id_)) return false;
    dragging_ = true;
    dragY_ = e.y;
    dragStart_ = static_cast<float>(p.norm(id_));
    p.beginEdit(id_);
    // clic fuera de la tapa: salta a la posición
    const Rect s = slot();
    const float capY = s.b - dragStart_ * s.h();
    if (std::fabs(e.y - capY) > 8.0f && e.y >= s.t && e.y <= s.b) {
        dragStart_ = std::clamp((s.b - e.y) / s.h(), 0.0f, 1.0f);
        p.performEdit(id_, dragStart_);
    }
    return true;
}
void Fader::onDrag(const MouseEvent& e, ParamAccess& p) {
    if (!dragging_) return;
    const float sens = (e.shift ? 0.2f : 1.0f) / slot().h();
    p.performEdit(id_, std::clamp(static_cast<double>(dragStart_) + (dragY_ - e.y) * sens, 0.0, 1.0));
}
void Fader::onUp(const MouseEvent&, ParamAccess& p) {
    if (!dragging_) return;
    dragging_ = false;
    p.endEdit(id_);
}
void Fader::onDouble(const MouseEvent&, ParamAccess& p) {
    if (p.locked(id_)) return;
    if (const JasWaveVst::ParamDef* d = p.def(id_)) p.setNorm(id_, JasWaveVst::defaultNorm(*d));
}
void Fader::onWheel(const MouseEvent& e, ParamAccess& p) {
    if (p.locked(id_) || e.wheel == 0) return;
    p.setNorm(id_, std::clamp(p.norm(id_) + e.wheel * (e.shift ? 0.002 : 0.01), 0.0, 1.0));
}

// =====================================================================================
//  Toggle / Dropdown / Section / Meter / Button
// =====================================================================================
Toggle::Toggle(uint32_t id, Rect r, const wchar_t* label, bool invert) : Widget(r), id_(id), label_(label ? label : L""), invert_(invert) {}

void Toggle::draw(Gfx& g, ParamAccess& p, bool hover) {
    const bool locked = p.locked(id_);
    const bool on = (p.norm(id_) >= 0.5) != invert_;
    if (rect.w() <= 30.0f) {   // píldora 24×8
        const Rect pill{ rect.cx() - 12.0f, rect.cy() - 4.0f, rect.cx() + 12.0f, rect.cy() + 4.0f };
        if (on && !locked) { g.fillRound(pill.inset(-3.0f), 7.0f, Pal::cianGlow.withAlpha(0.18f)); g.fillRound(pill, 4.0f, Pal::cian); }
        else g.strokeRound(pill, 4.0f, locked ? Pal::bloqueado : Pal::cian.withAlpha(0.45f), 1.0f);
        return;
    }
    const Color border = locked ? Pal::bloqueado : on ? Pal::cian : Pal::panelBorde;
    if (on && !locked) g.fillChamfer(rect.inset(-2.0f), 5.0f, Pal::cianGlow.withAlpha(0.12f));
    g.fillChamfer(rect, 4.0f, on && !locked ? hex(0x0E2C38) : hex(0x08131B));
    g.strokeChamfer(rect, 4.0f, hover && !locked ? border.withAlpha(1.0f) : border.withAlpha(on ? 1.0f : 0.8f), 1.0f);
    g.text(label_, rect, Font::Label, locked ? Pal::bloqueado : on ? Pal::cianNucleo : Pal::textoEtiqueta, Align::Center, true);
    if (locked) Chrome::drawLock(g, rect.r - 8.0f, rect.cy() - 2.0f, 8.0f, Pal::bloqueado);
}
bool Toggle::onDown(const MouseEvent&, ParamAccess& p) {
    if (p.locked(id_)) return false;
    p.setNorm(id_, p.norm(id_) >= 0.5 ? 0.0 : 1.0);
    return false;
}

Dropdown::Dropdown(uint32_t id, Rect r, const wchar_t* label) : Widget(r), id_(id), label_(label ? label : L"") {}

void Dropdown::draw(Gfx& g, ParamAccess& p, bool hover) {
    const bool locked = p.locked(id_);
    float bx = rect.l;
    if (!label_.empty()) {
        const float lw = g.textWidth(label_, Font::Label, true) + 8.0f;
        g.text(label_, { rect.l, rect.t, rect.l + lw, rect.b }, Font::Label, locked ? Pal::bloqueado : Pal::textoEtiqueta, Align::Left, true);
        bx = rect.l + lw;
    }
    const Rect box{ bx, rect.t + 1.0f, rect.r, rect.b - 1.0f };
    g.fillRect(box, hex(0x07121A));
    g.strokeRect(box, hover && !locked ? Pal::cian.withAlpha(0.7f) : Pal::panelBorde, 1.0f);
    g.text(valueText(p, id_), { box.l + 6.0f, box.t, box.r - 16.0f, box.b }, Font::ValueSmall, locked ? Pal::bloqueado : Pal::textoValor, Align::Left);
    // chevron
    const float cx = box.r - 9.0f, cy = box.cy();
    const Color cc = locked ? Pal::bloqueado : Pal::cian;
    g.line(cx - 3.5f, cy - 1.5f, cx, cy + 2.0f, cc, 1.3f);
    g.line(cx, cy + 2.0f, cx + 3.5f, cy - 1.5f, cc, 1.3f);
    if (locked) Chrome::drawLock(g, box.r - 22.0f, cy - 2.0f, 8.0f, Pal::bloqueado);
}
bool Dropdown::onDown(const MouseEvent&, ParamAccess&) { return false; }

Section::Section(Rect r, const wchar_t* title, int toggleParam, bool invertToggle, int feature)
    : Widget(r), title_(title ? title : L""), toggle_(toggleParam), invert_(invertToggle), feature_(feature) {}

Rect Section::pillRect() const { return { rect.r - 36.0f, rect.t + 9.0f, rect.r - 12.0f, rect.t + 17.0f }; }
bool Section::hit(float x, float y) const {
    const Rect pr = pillRect();
    return toggle_ >= 0 && x >= pr.l - 6 && x <= pr.r + 6 && y >= pr.t - 6 && y <= pr.b + 6;
}
bool Section::isLocked(ParamAccess& p) const {
    if (feature_ >= 0 && !p.featureGranted(feature_)) return true;
    return toggle_ >= 0 && p.locked(static_cast<uint32_t>(toggle_));
}
void Section::draw(Gfx& g, ParamAccess& p, bool) {
    const bool locked = isLocked(p);
    g.fillChamfer(rect, 6.0f, Pal::panelFondo);
    g.strokeChamfer(rect, 6.0f, Pal::panelBorde, 1.0f);
    g.line(rect.l + 8.0f, rect.t + 26.0f, rect.r - 8.0f, rect.t + 26.0f, Pal::panelBorde.withAlpha(0.6f), 1.0f);
    g.text(title_, { rect.l + 10.0f, rect.t + 3.0f, rect.r - 44.0f, rect.t + 24.0f }, Font::Section, locked ? Pal::bloqueado : Pal::textoTitulo,
           Align::Left, true);
    if (locked && feature_ >= 0) Chrome::drawLock(g, rect.r - 52.0f, rect.t + 11.0f, 9.0f, Pal::bloqueado);
    if (toggle_ >= 0) {
        const bool on = (p.norm(static_cast<uint32_t>(toggle_)) >= 0.5) != invert_;
        const Rect pill = pillRect();
        if (on && !locked) { g.fillRound(pill.inset(-3.0f), 7.0f, Pal::cianGlow.withAlpha(0.2f)); g.fillRound(pill, 4.0f, Pal::cian); }
        else g.strokeRound(pill, 4.0f, locked ? Pal::bloqueado : Pal::cian.withAlpha(0.45f), 1.0f);
    }
}
bool Section::onDown(const MouseEvent&, ParamAccess& p) {
    if (toggle_ < 0 || isLocked(p)) return false;
    const uint32_t id = static_cast<uint32_t>(toggle_);
    p.setNorm(id, p.norm(id) >= 0.5 ? 0.0 : 1.0);
    return false;
}

Meter::Meter(Rect r, const wchar_t* label, float minDb, float maxDb, bool inverted)
    : Widget(r), label_(label ? label : L""), minDb_(minDb), maxDb_(maxDb), inverted_(inverted) {}

void Meter::draw(Gfx& g, ParamAccess&, bool) {
    const Rect bar{ rect.l, rect.t, rect.r, rect.b - (label_.empty() ? 0.0f : 16.0f) };
    const int segs = std::max(4, static_cast<int>(bar.h() / 5.0f));
    const float segH = bar.h() / segs;
    const float frac = std::clamp((db_ - minDb_) / (maxDb_ - minDb_), 0.0f, 1.0f);
    const float pk = std::clamp((peak_ - minDb_) / (maxDb_ - minDb_), 0.0f, 1.0f);
    const int lit = static_cast<int>(std::lround(frac * segs));
    const int pkSeg = static_cast<int>(std::lround(pk * segs));
    g.fillRect(bar.inset(-1.0f), hex(0x03080C));
    for (int i = 0; i < segs; ++i) {
        // i = 0 abajo (o arriba si inverted)
        const float y0 = inverted_ ? bar.t + i * segH : bar.b - (i + 1) * segH;
        const Rect s{ bar.l, y0 + 0.8f, bar.r, y0 + segH - 0.8f };
        const bool on = i < lit;
        const bool top = !inverted_ && i == segs - 1;
        Color c = top ? Pal::alerta : Pal::cian;
        if (on) { g.fillRect(s.inset(-1.0f), c.withAlpha(0.15f)); g.fillRect(s, c); }
        else if (i == pkSeg - 1) g.fillRect(s, c.withAlpha(0.55f));
        else g.fillRect(s, c.withAlpha(0.08f));
    }
    if (!label_.empty()) g.text(label_, { rect.l - 12.0f, rect.b - 15.0f, rect.r + 12.0f, rect.b }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
}

Button::Button(Rect r, const wchar_t* t, std::function<void()> action) : Widget(r), text(t ? t : L""), action_(std::move(action)) {}
void Button::draw(Gfx& g, ParamAccess&, bool hover) {
    const float rad = rect.h() * 0.5f;
    g.fillRound(rect.inset(-4.0f), rad + 4.0f, Pal::cianGlow.withAlpha(hover ? 0.3f : 0.16f));
    g.fillRound(rect, rad, hover ? hex(0x5BE4F8) : Pal::cian);
    g.text(text, rect, Font::Section, hex(0x031018), Align::Center, true);
}
bool Button::onDown(const MouseEvent&, ParamAccess&) {
    if (action_) action_();
    return false;
}

// =====================================================================================
//  EditorContext
// =====================================================================================
template <class W, class... A>
static W* addW(std::vector<std::unique_ptr<Widget>>& v, A&&... a) {
    auto w = std::make_unique<W>(std::forward<A>(a)...);
    W* raw = w.get();
    v.push_back(std::move(w));
    return raw;
}
Knob* EditorContext::knob(uint32_t id, float cx, float cy, KnobSize s, const wchar_t* label) { return addW<Knob>(widgets, id, cx, cy, s, label); }
Fader* EditorContext::fader(uint32_t id, Rect r, const wchar_t* label) { return addW<Fader>(widgets, id, r, label); }
Toggle* EditorContext::toggle(uint32_t id, Rect r, const wchar_t* label, bool invert) { return addW<Toggle>(widgets, id, r, label, invert); }
Dropdown* EditorContext::dropdown(uint32_t id, Rect r, const wchar_t* label) { return addW<Dropdown>(widgets, id, r, label); }
Section* EditorContext::section(Rect r, const wchar_t* title, int toggleParam, bool invertToggle, int feature) {
    return addW<Section>(widgets, r, title, toggleParam, invertToggle, feature);
}
Meter* EditorContext::meter(Rect r, const wchar_t* label, float minDb, float maxDb, bool inverted) {
    return addW<Meter>(widgets, r, label, minDb, maxDb, inverted);
}
Button* EditorContext::button(Rect r, const wchar_t* text, std::function<void()> action) { return addW<Button>(widgets, r, text, std::move(action)); }

} // namespace JasWaveUI
