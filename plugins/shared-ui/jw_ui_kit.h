// JasWave UI – utilidades de dibujo compartidas por los editores (cabecera, sin estado global)
#pragma once

#include "jw_ui.h"

#include <algorithm>
#include <cmath>
#include <cwchar>

namespace JasWaveUI {
namespace Kit {

// Caja de panel (visualizador / mini-panel): deja ver la retícula
inline void panel(Gfx& g, const Rect& r, const wchar_t* title) {
    g.fillChamfer(r, 6.0f, hex(0x07121A, 0.55f));
    g.strokeChamfer(r, 6.0f, Pal::panelBorde, 1.0f);
    if (title && *title) g.text(title, { r.l + 12.0f, r.t + 4.0f, r.r - 12.0f, r.t + 24.0f }, Font::Section, Pal::textoTitulo, Align::Left, true);
}

// Balística común de medidores y espectros (V3 §4.3): ataque instantáneo, caída de 14 dB/s
constexpr float kCaidaDbS = 14.0f;
constexpr float kRetencionPicoS = 1.5f;

// Nivel con caída (dB) y pico retenido, por tiempo real (dt del frame), no por frames
struct PeakFollower {
    float db{-120.0f}, peak{-120.0f};
    float hold{0.0f};
    void push(float lin, float dt) {
        const float d = lin <= 1.0e-6f ? -120.0f : 20.0f * std::log10(lin);
        const float caida = kCaidaDbS * std::clamp(dt, 0.0f, 0.25f);
        db = d >= db ? d : std::max(d, db - caida);
        if (d >= peak) { peak = d; hold = kRetencionPicoS; }
        else if ((hold -= dt) < 0.0f) peak = std::max(d, peak - caida);
    }
};

// Cuatro medidores LED (IN L/R, OUT L/R) dentro de una sección
class StereoMeters {
public:
    void build(EditorContext& c, float x, float top, float bottom) {
        const wchar_t* lab[4] = { L"IN", L"", L"OUT", L"" };
        for (int i = 0; i < 4; ++i) {
            const float xx = x + i * 14.0f + (i >= 2 ? 16.0f : 0.0f);
            m_[i] = c.meter({ xx, top, xx + 9.0f, bottom }, nullptr, -60.0f, 6.0f);
            (void)lab;
        }
        labelX_ = x;
        labelY_ = bottom;
    }
    void update(JasWaveDsp::PeakMeter* in, JasWaveDsp::PeakMeter* out, float dt) {
        f_[0].push(in[0].take(), dt); f_[1].push(in[1].take(), dt);
        f_[2].push(out[0].take(), dt); f_[3].push(out[1].take(), dt);
        for (int i = 0; i < 4; ++i) if (m_[i]) m_[i]->set(f_[i].db, f_[i].peak);
    }
    // Instrumentos: la entrada es MIDI; los dos medidores IN muestran la velocidad de las notas
    void updateInstrumento(JasWaveDsp::PeakMeter& velocidad, JasWaveDsp::PeakMeter* out, float dt) {
        const float v = velocidad.take();
        f_[0].push(v, dt); f_[1].push(v, dt);
        f_[2].push(out[0].take(), dt); f_[3].push(out[1].take(), dt);
        for (int i = 0; i < 4; ++i) if (m_[i]) m_[i]->set(f_[i].db, f_[i].peak);
        instrumento_ = true;
    }
    float level() const { return std::clamp((std::max(f_[2].db, f_[3].db) + 48.0f) / 54.0f, 0.0f, 1.0f); }
    float outDb() const { return std::max(f_[2].db, f_[3].db); }
    void drawLabels(Gfx& g) const {
        g.text(instrumento_ ? L"MIDI" : L"IN", { labelX_ - 6, labelY_ + 2, labelX_ + 30, labelY_ + 16 }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
        g.text(L"OUT", { labelX_ + 38, labelY_ + 2, labelX_ + 76, labelY_ + 16 }, Font::Label, Pal::textoEtiqueta, Align::Center, true);
    }
private:
    Meter* m_[4] = {};
    PeakFollower f_[4];
    float labelX_{0}, labelY_{0};
    bool instrumento_{false};
};

// Eje logarítmico de frecuencia
inline float xForFreq(const Rect& r, double f, double fMin = 20.0, double fMax = 20000.0) {
    return r.l + static_cast<float>(std::log(f / fMin) / std::log(fMax / fMin)) * r.w();
}
inline double freqForX(const Rect& r, float x, double fMin = 20.0, double fMax = 20000.0) {
    return fMin * std::pow(fMax / fMin, std::clamp((x - r.l) / r.w(), 0.0f, 1.0f));
}
inline float yForDb(const Rect& r, double db, double dbMin, double dbMax) {
    return r.b - static_cast<float>((std::clamp(db, dbMin, dbMax) - dbMin) / (dbMax - dbMin)) * r.h();
}

inline void freqAxis(Gfx& g, const Rect& r, double fMin = 20.0, double fMax = 20000.0) {
    static const double fs[] = { 50, 100, 200, 500, 1000, 2000, 5000, 10000 };
    static const wchar_t* ls[] = { L"50", L"100", L"200", L"500", L"1k", L"2k", L"5k", L"10k" };
    for (int i = 0; i < 8; ++i) {
        if (fs[i] < fMin || fs[i] > fMax) continue;
        const float x = xForFreq(r, fs[i], fMin, fMax);
        g.line(x, r.t, x, r.b, Pal::cian.withAlpha(0.07f), 1.0f);
        g.text(ls[i], { x - 20, r.b + 2, x + 20, r.b + 16 }, Font::ValueSmall, Pal::textoTenue, Align::Center);
    }
}
inline void dbAxis(Gfx& g, const Rect& r, double dbMin, double dbMax, double step, bool labels = true) {
    for (double d = std::ceil(dbMin / step) * step; d <= dbMax + 1e-9; d += step) {
        const float y = yForDb(r, d, dbMin, dbMax);
        g.line(r.l, y, r.r, y, Pal::cian.withAlpha(std::fabs(d) < 1e-9 ? 0.4f : 0.07f), 1.0f);
        if (labels) {
            wchar_t b[16];
            swprintf_s(b, L"%+.0f", d);
            g.text(b, { r.r + 2, y - 8, r.r + 34, y + 8 }, Font::ValueSmall, Pal::textoTenue, Align::Left);
        }
    }
}

// Traza "hilo" (DESIGN.md §4): principal opaca 1.5 px con glow + 3 ecos desplazados al 25–10 %
inline void wireTrace(Gfx& g, Pt* pts, int n, Color c, float baseY, bool fill) {
    if (n < 2) return;
    if (fill) g.fillUnder(pts, n, baseY, c.withAlpha(0.07f));
    const float echoA[3] = { 0.25f, 0.16f, 0.10f };
    for (int e = 0; e < 3; ++e) {
        const float dy = 3.0f * (e + 1);
        for (int i = 0; i < n; ++i) pts[i].y += dy;
        g.polyline(pts, n, c.withAlpha(echoA[e]), 1.0f);
        for (int i = 0; i < n; ++i) pts[i].y -= dy;
    }
    g.glowPolyline(pts, n, c, 1.5f);
}

inline void readout(Gfx& g, float x, float y, const wchar_t* label, const wchar_t* value, Color vc = Pal::textoValor) {
    g.text(label, { x, y, x + 120, y + 14 }, Font::Label, Pal::textoTenue, Align::Left, true);
    g.text(value, { x, y + 13, x + 120, y + 30 }, Font::Value, vc, Align::Left);
}

} // namespace Kit
} // namespace JasWaveUI
