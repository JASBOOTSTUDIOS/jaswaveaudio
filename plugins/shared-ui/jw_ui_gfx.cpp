// JasWave UI – Gfx (Direct2D / DirectWrite)
#include "jw_ui.h"

#include <algorithm>
#include <cmath>
#include <cwchar>

#pragma comment(lib, "d2d1.lib")
#pragma comment(lib, "dwrite.lib")

namespace JasWaveUI {

namespace {
template <class T>
void safeRelease(T*& p) {
    if (p) { p->Release(); p = nullptr; }
}
inline D2D1_COLOR_F d2c(Color c) { return D2D1::ColorF(c.r, c.g, c.b, c.a); }
constexpr float kPi = 3.14159265358979f;

struct FontSpec { const wchar_t* family; DWRITE_FONT_WEIGHT weight; DWRITE_FONT_STRETCH stretch; float size; };
const FontSpec kFonts[static_cast<int>(Font::Count)] = {
    { L"Bahnschrift", DWRITE_FONT_WEIGHT_LIGHT, DWRITE_FONT_STRETCH_NORMAL, 22.0f },
    { L"Bahnschrift", DWRITE_FONT_WEIGHT_LIGHT, DWRITE_FONT_STRETCH_NORMAL, 26.0f },
    { L"Bahnschrift", DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_FONT_STRETCH_SEMI_CONDENSED, 13.0f },
    { L"Bahnschrift", DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STRETCH_SEMI_CONDENSED, 11.0f },
    { L"Consolas", DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 11.5f },
    { L"Consolas", DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 10.0f },
    { L"Consolas", DWRITE_FONT_WEIGHT_BOLD, DWRITE_FONT_STRETCH_NORMAL, 28.0f },
    { L"Bahnschrift", DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 13.0f },
};
} // namespace

struct Gfx::Impl {
    ID2D1Factory* factory{nullptr};
    IDWriteFactory* dwrite{nullptr};
    ID2D1HwndRenderTarget* hwndRt{nullptr};
    HWND hwnd{nullptr};
    ID2D1SolidColorBrush* solid{nullptr};
    ID2D1RenderTarget* brushOwner{nullptr};
    IDWriteTextFormat* formats[static_cast<int>(Font::Count)][3] = {};

    struct GeomEntry { Rect r; float ch; ID2D1PathGeometry* g; };
    std::vector<GeomEntry> geoms;

    struct GradEntry { uint64_t key; ID2D1LinearGradientBrush* b; };
    std::vector<GradEntry> grads;
    struct RadEntry { uint64_t key; ID2D1RadialGradientBrush* b; };
    std::vector<RadEntry> rads;

    struct LayoutEntry { IDWriteTextLayout* layout; };
    std::unordered_map<std::wstring, LayoutEntry> layouts;

    ID2D1BitmapRenderTarget* bgRt{nullptr};
    ID2D1Bitmap* bgBitmap{nullptr};
    D2D1_SIZE_U bgSize{0, 0};
    float bgScale{0};

    ~Impl() {
        clearLayouts();
        for (auto& e : geoms) safeRelease(e.g);
        for (auto& f : formats) for (auto*& x : f) safeRelease(x);
        releaseRtResources();
        safeRelease(hwndRt);
        safeRelease(dwrite);
        safeRelease(factory);
    }
    void clearLayouts() {
        for (auto& kv : layouts) if (kv.second.layout) kv.second.layout->Release();
        layouts.clear();
    }
    void releaseRtResources() {
        safeRelease(solid);
        for (auto& e : grads) safeRelease(e.b);
        grads.clear();
        for (auto& e : rads) safeRelease(e.b);
        rads.clear();
        safeRelease(bgBitmap);
        safeRelease(bgRt);
        bgSize = { 0, 0 };
        brushOwner = nullptr;
    }
};

Gfx::Gfx() : d_(new Impl) {
    D2D1_FACTORY_OPTIONS opt{};
    D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, __uuidof(ID2D1Factory), &opt, reinterpret_cast<void**>(&d_->factory));
    DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<IUnknown**>(&d_->dwrite));
}
Gfx::~Gfx() = default;

ID2D1Factory* Gfx::factory() const { return d_->factory; }
IDWriteFactory* Gfx::dwrite() const { return d_->dwrite; }

void Gfx::releaseTargetResources() { d_->releaseRtResources(); }

bool Gfx::beginHwnd(HWND hwnd, UINT pxW, UINT pxH) {
    if (!d_->factory || pxW == 0 || pxH == 0) return false;
    if (d_->hwndRt && d_->hwnd != hwnd) { releaseTargetResources(); safeRelease(d_->hwndRt); }
    if (!d_->hwndRt) {
        const D2D1_RENDER_TARGET_PROPERTIES props = D2D1::RenderTargetProperties(
            D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_IGNORE), 96.0f, 96.0f);
        if (FAILED(d_->factory->CreateHwndRenderTarget(props, D2D1::HwndRenderTargetProperties(hwnd, D2D1::SizeU(pxW, pxH)), &d_->hwndRt)))
            return false;
        d_->hwnd = hwnd;
    } else {
        const D2D1_SIZE_U cur = d_->hwndRt->GetPixelSize();
        if (cur.width != pxW || cur.height != pxH) d_->hwndRt->Resize(D2D1::SizeU(pxW, pxH));
    }
    rt_ = d_->hwndRt;
    if (d_->brushOwner != rt_) { releaseTargetResources(); d_->brushOwner = rt_; }
    rt_->BeginDraw();
    rt_->SetTransform(D2D1::Matrix3x2F::Scale(scale_, scale_));
    rt_->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
    return true;
}

bool Gfx::beginExternal(ID2D1RenderTarget* rt) {
    if (!rt) return false;
    if (d_->brushOwner != rt) { releaseTargetResources(); d_->brushOwner = rt; }
    rt_ = rt;
    rt_->BeginDraw();
    rt_->SetTransform(D2D1::Matrix3x2F::Scale(scale_, scale_));
    rt_->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
    return true;
}

bool Gfx::end() {
    if (!rt_) return false;
    const HRESULT hr = rt_->EndDraw();
    if (hr == D2DERR_RECREATE_TARGET) {
        releaseTargetResources();
        if (rt_ == d_->hwndRt) safeRelease(d_->hwndRt);
        rt_ = nullptr;
        return false;
    }
    return SUCCEEDED(hr);
}

void Gfx::setScale(float s) {
    if (s <= 0.0f) s = 1.0f;
    if (std::fabs(s - scale_) > 1.0e-4f) { scale_ = s; }
    if (rt_) rt_->SetTransform(D2D1::Matrix3x2F::Scale(scale_, scale_));
}

ID2D1SolidColorBrush* Gfx::brush(Color c) {
    if (!d_->solid && rt_) rt_->CreateSolidColorBrush(d2c(c), &d_->solid);
    if (d_->solid) d_->solid->SetColor(d2c(c));
    return d_->solid;
}

void Gfx::clear(Color c) { if (rt_) rt_->Clear(d2c(c)); }

void Gfx::fillRect(const Rect& r, Color c) { if (auto* b = brush(c)) rt_->FillRectangle(D2D1::RectF(r.l, r.t, r.r, r.b), b); }
void Gfx::strokeRect(const Rect& r, Color c, float w) { if (auto* b = brush(c)) rt_->DrawRectangle(D2D1::RectF(r.l, r.t, r.r, r.b), b, w); }
void Gfx::fillRound(const Rect& r, float rad, Color c) {
    if (auto* b = brush(c)) rt_->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(r.l, r.t, r.r, r.b), rad, rad), b);
}
void Gfx::strokeRound(const Rect& r, float rad, Color c, float w) {
    if (auto* b = brush(c)) rt_->DrawRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(r.l, r.t, r.r, r.b), rad, rad), b, w);
}

ID2D1PathGeometry* Gfx::chamferGeom(const Rect& r, float ch) {
    for (auto& e : d_->geoms)
        if (e.ch == ch && e.r.l == r.l && e.r.t == r.t && e.r.r == r.r && e.r.b == r.b) return e.g;
    if (d_->geoms.size() > 96) { for (auto& e : d_->geoms) safeRelease(e.g); d_->geoms.clear(); }
    ID2D1PathGeometry* g = nullptr;
    if (FAILED(d_->factory->CreatePathGeometry(&g))) return nullptr;
    ID2D1GeometrySink* s = nullptr;
    if (SUCCEEDED(g->Open(&s))) {
        ch = std::min(ch, 0.5f * std::min(r.w(), r.h()));
        s->BeginFigure(D2D1::Point2F(r.l + ch, r.t), D2D1_FIGURE_BEGIN_FILLED);
        const D2D1_POINT_2F pts[] = { { r.r - ch, r.t }, { r.r, r.t + ch }, { r.r, r.b - ch }, { r.r - ch, r.b },
                                      { r.l + ch, r.b }, { r.l, r.b - ch }, { r.l, r.t + ch } };
        s->AddLines(pts, 7);
        s->EndFigure(D2D1_FIGURE_END_CLOSED);
        s->Close();
        s->Release();
    }
    d_->geoms.push_back({ r, ch, g });
    return g;
}

void Gfx::fillChamfer(const Rect& r, float ch, Color c) {
    if (auto* g = chamferGeom(r, ch)) if (auto* b = brush(c)) rt_->FillGeometry(g, b);
}
void Gfx::strokeChamfer(const Rect& r, float ch, Color c, float w) {
    if (auto* g = chamferGeom(r, ch)) if (auto* b = brush(c)) rt_->DrawGeometry(g, b, w);
}

namespace {
uint64_t colorKey(Color a, Color b) {
    auto q = [](Color c) {
        return (static_cast<uint64_t>(c.r * 255.0f) << 24) | (static_cast<uint64_t>(c.g * 255.0f) << 16) |
               (static_cast<uint64_t>(c.b * 255.0f) << 8) | static_cast<uint64_t>(c.a * 255.0f);
    };
    return (q(a) << 32) ^ q(b);
}
} // namespace

void Gfx::fillChamferGradient(const Rect& r, float ch, Color top, Color bottom) {
    if (!rt_) return;
    const uint64_t key = colorKey(top, bottom);
    ID2D1LinearGradientBrush* gb = nullptr;
    for (auto& e : d_->grads) if (e.key == key) { gb = e.b; break; }
    if (!gb) {
        const D2D1_GRADIENT_STOP stops[2] = { { 0.0f, d2c(top) }, { 1.0f, d2c(bottom) } };
        ID2D1GradientStopCollection* col = nullptr;
        if (FAILED(rt_->CreateGradientStopCollection(stops, 2, &col))) return;
        rt_->CreateLinearGradientBrush(D2D1::LinearGradientBrushProperties(D2D1::Point2F(0, r.t), D2D1::Point2F(0, r.b)), col, &gb);
        col->Release();
        if (!gb) return;
        d_->grads.push_back({ key, gb });
    }
    gb->SetStartPoint(D2D1::Point2F(r.l, r.t));
    gb->SetEndPoint(D2D1::Point2F(r.l, r.b));
    if (ch > 0.0f) { if (auto* g = chamferGeom(r, ch)) rt_->FillGeometry(g, gb); }
    else rt_->FillRectangle(D2D1::RectF(r.l, r.t, r.r, r.b), gb);
}

void Gfx::fillRectGradient(const Rect& r, Color top, Color bottom) { fillChamferGradient(r, 0.0f, top, bottom); }

void Gfx::fillRadial(const Rect& r, Color center, Color edge) {
    if (!rt_) return;
    const uint64_t key = colorKey(center, edge);
    ID2D1RadialGradientBrush* rb = nullptr;
    for (auto& e : d_->rads) if (e.key == key) { rb = e.b; break; }
    if (!rb) {
        const D2D1_GRADIENT_STOP stops[2] = { { 0.0f, d2c(center) }, { 1.0f, d2c(edge) } };
        ID2D1GradientStopCollection* col = nullptr;
        if (FAILED(rt_->CreateGradientStopCollection(stops, 2, &col))) return;
        rt_->CreateRadialGradientBrush(D2D1::RadialGradientBrushProperties(D2D1::Point2F(r.cx(), r.cy()), D2D1::Point2F(0, 0), r.w() * 0.6f, r.h() * 0.6f), col, &rb);
        col->Release();
        if (!rb) return;
        d_->rads.push_back({ key, rb });
    }
    rb->SetCenter(D2D1::Point2F(r.cx(), r.cy()));
    rb->SetRadiusX(r.w() * 0.62f);
    rb->SetRadiusY(r.h() * 0.75f);
    rt_->FillRectangle(D2D1::RectF(r.l, r.t, r.r, r.b), rb);
}

void Gfx::line(float x0, float y0, float x1, float y1, Color c, float w) {
    if (auto* b = brush(c)) rt_->DrawLine(D2D1::Point2F(x0, y0), D2D1::Point2F(x1, y1), b, w);
}
void Gfx::glowLine(float x0, float y0, float x1, float y1, Color c, float w) {
    line(x0, y0, x1, y1, c.withAlpha(c.a * 0.07f), w + 8.0f);
    line(x0, y0, x1, y1, c.withAlpha(c.a * 0.12f), w + 4.5f);
    line(x0, y0, x1, y1, c.withAlpha(c.a * 0.22f), w + 2.0f);
    line(x0, y0, x1, y1, c, w);
}
void Gfx::polyline(const Pt* p, int n, Color c, float w) {
    auto* b = brush(c);
    if (!b) return;
    for (int i = 1; i < n; ++i) rt_->DrawLine(D2D1::Point2F(p[i - 1].x, p[i - 1].y), D2D1::Point2F(p[i].x, p[i].y), b, w);
}
void Gfx::glowPolyline(const Pt* p, int n, Color c, float w) {
    polyline(p, n, c.withAlpha(c.a * 0.06f), w + 8.0f);
    polyline(p, n, c.withAlpha(c.a * 0.11f), w + 4.5f);
    polyline(p, n, c.withAlpha(c.a * 0.22f), w + 2.0f);
    polyline(p, n, c, w);
}
void Gfx::fillUnder(const Pt* p, int n, float baseY, Color c) {
    auto* b = brush(c);
    if (!b) return;
    for (int i = 1; i < n; ++i) {
        const float top = std::min(p[i - 1].y, p[i].y);
        if (top >= baseY) continue;
        rt_->FillRectangle(D2D1::RectF(p[i - 1].x, top, p[i].x + 0.35f, baseY), b);
    }
}
void Gfx::circle(float cx, float cy, float r, Color c, float w) {
    if (auto* b = brush(c)) rt_->DrawEllipse(D2D1::Ellipse(D2D1::Point2F(cx, cy), r, r), b, w);
}
void Gfx::fillCircle(float cx, float cy, float r, Color c) {
    if (auto* b = brush(c)) rt_->FillEllipse(D2D1::Ellipse(D2D1::Point2F(cx, cy), r, r), b);
}
void Gfx::glowDot(float cx, float cy, float r, Color c) {
    fillCircle(cx, cy, r * 3.2f, c.withAlpha(c.a * 0.06f));
    fillCircle(cx, cy, r * 2.2f, c.withAlpha(c.a * 0.12f));
    fillCircle(cx, cy, r * 1.5f, c.withAlpha(c.a * 0.25f));
    fillCircle(cx, cy, r, c);
}
void Gfx::arc(float cx, float cy, float r, float a0, float a1, Color c, float w) {
    auto* b = brush(c);
    if (!b) return;
    const float span = a1 - a0;
    const int n = std::max(2, std::min(96, static_cast<int>(std::fabs(span) / (kPi / 40.0f)) + 2));
    float px = cx + r * std::cos(a0), py = cy + r * std::sin(a0);
    for (int i = 1; i <= n; ++i) {
        const float a = a0 + span * static_cast<float>(i) / n;
        const float x = cx + r * std::cos(a), y = cy + r * std::sin(a);
        rt_->DrawLine(D2D1::Point2F(px, py), D2D1::Point2F(x, y), b, w);
        px = x; py = y;
    }
}
void Gfx::glowArc(float cx, float cy, float r, float a0, float a1, Color c, float w) {
    arc(cx, cy, r, a0, a1, c.withAlpha(c.a * 0.07f), w + 7.0f);
    arc(cx, cy, r, a0, a1, c.withAlpha(c.a * 0.14f), w + 3.5f);
    arc(cx, cy, r, a0, a1, c, w);
}
void Gfx::glowRect(const Rect& r, Color c, float spread) {
    for (int i = 3; i >= 1; --i) {
        const float s = spread * i / 3.0f;
        fillRound({ r.l - s, r.t - s, r.r + s, r.b + s }, s + 1.0f, c.withAlpha(c.a * 0.07f * (4 - i)));
    }
    fillRect(r, c);
}
void Gfx::hexagon(float cx, float cy, float r, Color c, float w) {
    Pt p[7];
    for (int i = 0; i < 7; ++i) {
        const float a = kPi / 3.0f * i + kPi / 6.0f;
        p[i] = { cx + r * std::cos(a), cy + r * std::sin(a) };
    }
    polyline(p, 7, c, w);
}

IDWriteTextFormat* Gfx::format(Font f, Align a) {
    IDWriteTextFormat*& fmt = d_->formats[static_cast<int>(f)][static_cast<int>(a)];
    if (!fmt && d_->dwrite) {
        const FontSpec& s = kFonts[static_cast<int>(f)];
        if (SUCCEEDED(d_->dwrite->CreateTextFormat(s.family, nullptr, s.weight, DWRITE_FONT_STYLE_NORMAL, s.stretch, s.size, L"es-es", &fmt))) {
            fmt->SetTextAlignment(a == Align::Left ? DWRITE_TEXT_ALIGNMENT_LEADING : a == Align::Center ? DWRITE_TEXT_ALIGNMENT_CENTER : DWRITE_TEXT_ALIGNMENT_TRAILING);
            fmt->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
            fmt->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
        }
    }
    return fmt;
}

void Gfx::text(const wchar_t* s, const Rect& r, Font f, Color c, Align a, bool spaced) {
    if (!rt_ || !s || !*s) return;
    IDWriteTextFormat* fmt = format(f, a);
    if (!fmt) return;
    // Clave: texto + fuente + alineación + espaciado + caja (las etiquetas son estáticas)
    wchar_t keyBuf[96];
    swprintf_s(keyBuf, L"|%d|%d|%d|%.1f|%.1f", static_cast<int>(f), static_cast<int>(a), spaced ? 1 : 0, r.w(), r.h());
    std::wstring key;
    key.reserve(64);
    key.append(s);
    key.append(keyBuf);
    auto it = d_->layouts.find(key);
    IDWriteTextLayout* layout = nullptr;
    if (it != d_->layouts.end()) layout = it->second.layout;
    else {
        if (d_->layouts.size() > 1500) d_->clearLayouts();
        if (FAILED(d_->dwrite->CreateTextLayout(s, static_cast<UINT32>(wcslen(s)), fmt, std::max(1.0f, r.w()), std::max(1.0f, r.h()), &layout)))
            return;
        if (spaced) {
            IDWriteTextLayout1* l1 = nullptr;
            if (SUCCEEDED(layout->QueryInterface(__uuidof(IDWriteTextLayout1), reinterpret_cast<void**>(&l1)))) {
                const float sp = kFonts[static_cast<int>(f)].size * 0.12f;
                l1->SetCharacterSpacing(0.0f, sp, 0.0f, DWRITE_TEXT_RANGE{ 0, static_cast<UINT32>(wcslen(s)) });
                l1->Release();
            }
        }
        d_->layouts.emplace(std::move(key), Impl::LayoutEntry{ layout });
    }
    if (auto* b = brush(c)) rt_->DrawTextLayout(D2D1::Point2F(r.l, r.t), layout, b, D2D1_DRAW_TEXT_OPTIONS_CLIP);
}

void Gfx::text(const std::wstring& s, const Rect& r, Font f, Color c, Align a, bool spaced) { text(s.c_str(), r, f, c, a, spaced); }

float Gfx::textWidth(const std::wstring& s, Font f, bool spaced) {
    IDWriteTextFormat* fmt = format(f, Align::Left);
    if (!fmt || s.empty()) return 0.0f;
    IDWriteTextLayout* layout = nullptr;
    if (FAILED(d_->dwrite->CreateTextLayout(s.c_str(), static_cast<UINT32>(s.size()), fmt, 4000.0f, 100.0f, &layout))) return 0.0f;
    if (spaced) {
        IDWriteTextLayout1* l1 = nullptr;
        if (SUCCEEDED(layout->QueryInterface(__uuidof(IDWriteTextLayout1), reinterpret_cast<void**>(&l1)))) {
            l1->SetCharacterSpacing(0.0f, kFonts[static_cast<int>(f)].size * 0.12f, 0.0f, DWRITE_TEXT_RANGE{ 0, static_cast<UINT32>(s.size()) });
            l1->Release();
        }
    }
    DWRITE_TEXT_METRICS m{};
    layout->GetMetrics(&m);
    layout->Release();
    return m.widthIncludingTrailingWhitespace;
}

void Gfx::invalidateBackground() {
    safeRelease(d_->bgBitmap);
    safeRelease(d_->bgRt);
    d_->bgSize = { 0, 0 };
}

void Gfx::drawCachedBackground(const StaticPainter& painter) {
    if (!rt_) return;
    const D2D1_SIZE_U px = rt_->GetPixelSize();
    if (!d_->bgRt || d_->bgSize.width != px.width || d_->bgSize.height != px.height || d_->bgScale != scale_) {
        invalidateBackground();
        ID2D1BitmapRenderTarget* bg = nullptr;
        if (SUCCEEDED(rt_->CreateCompatibleRenderTarget(nullptr, &px, nullptr, D2D1_COMPATIBLE_RENDER_TARGET_OPTIONS_NONE, &bg))) {
            ID2D1RenderTarget* saved = rt_;
            ID2D1SolidColorBrush* savedBrush = d_->solid;
            d_->solid = nullptr;
            auto savedGrads = std::move(d_->grads);
            auto savedRads = std::move(d_->rads);
            d_->grads.clear();
            d_->rads.clear();
            rt_ = bg;
            bg->SetDpi(96.0f, 96.0f);
            bg->BeginDraw();
            bg->SetTransform(D2D1::Matrix3x2F::Scale(scale_, scale_));
            bg->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
            painter(*this);
            bg->EndDraw();
            // recursos del bitmap target: se liberan, se restauran los del destino principal
            safeRelease(d_->solid);
            for (auto& e : d_->grads) safeRelease(e.b);
            for (auto& e : d_->rads) safeRelease(e.b);
            d_->grads = std::move(savedGrads);
            d_->rads = std::move(savedRads);
            d_->solid = savedBrush;
            rt_ = saved;
            d_->bgRt = bg;
            bg->GetBitmap(&d_->bgBitmap);
            d_->bgSize = px;
            d_->bgScale = scale_;
        }
    }
    if (d_->bgBitmap) {
        D2D1_MATRIX_3X2_F m;
        rt_->GetTransform(&m);
        rt_->SetTransform(D2D1::Matrix3x2F::Identity());
        rt_->DrawBitmap(d_->bgBitmap, D2D1::RectF(0, 0, static_cast<float>(px.width), static_cast<float>(px.height)), 1.0f,
                        D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR);
        rt_->SetTransform(m);
    } else {
        painter(*this);
    }
}

} // namespace JasWaveUI
