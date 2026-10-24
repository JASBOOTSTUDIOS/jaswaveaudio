// =====================================================================================
//  JasWave UI – plantilla única de editor (V3, docs/plans/V3-diseno-unificado-futurista.md)
//   - Columna derecha fija: sección superior de controles (rejilla 3×2) y sección SALIDA
//     (fader, celdas, bypass en la píldora y medidores IN/OUT en la misma x en los 7 VST)
//   - Visualizadores comunes: espectro dual IN/OUT (−120..0 dBFS, 20 Hz..20 kHz, 14 dB/s),
//     teclado de 88 teclas e historial de reducción de ganancia
//   - Mini-panel de medición con gráfico y lecturas en posiciones estándar
//  Ningún editor usa coordenadas sueltas: todo sale de aquí.
// =====================================================================================
#pragma once

#include "jw_ui_kit.h"

#include <array>
#include <cmath>
#include <vector>

namespace JasWaveUI {
namespace Plantilla {

// ---------------------------------------------------------------------------------
//  Columna derecha
// ---------------------------------------------------------------------------------
constexpr Rect kControles = Layout::kRightTop;
constexpr Rect kSalida = Layout::kRightBottom;
constexpr float kColX[3] = { 742.0f, 857.0f, 972.0f };   // columnas de la rejilla 3×2
constexpr float kFilaPrincipal = 176.0f;                   // perillas Main (64)
constexpr float kFilaSecundaria = 304.0f;                  // perillas Normal (44), selectores o interruptores
constexpr Rect kFader{ 680.0f, 440.0f, 724.0f, 552.0f };   // fader de salida / makeup / volumen
constexpr float kMedidoresX = 976.0f, kMedidoresArriba = 446.0f, kMedidoresAbajo = 528.0f;
constexpr float kCeldaX[3] = { 777.0f, 851.0f, 925.0f };   // celdas de SALIDA entre el fader y los medidores
constexpr float kCeldaY[2] = { 466.0f, 522.0f };

inline Section* controles(EditorContext& c, const wchar_t* titulo, int toggleParam = -1, int feature = -1) {
    return c.section(kControles, titulo, toggleParam, false, feature);
}
inline Knob* principal(EditorContext& c, int col, uint32_t id, const wchar_t* etiqueta) {
    return c.knob(id, kColX[col], kFilaPrincipal, KnobSize::Main, etiqueta);
}
inline Knob* secundaria(EditorContext& c, int col, uint32_t id, const wchar_t* etiqueta) {
    return c.knob(id, kColX[col], kFilaSecundaria, KnobSize::Normal, etiqueta);
}
// Hueco de la fila secundaria que ocupa `span` columnas desde `col`
inline Rect filaSecundaria(int col, int span) {
    const float l = kColX[col] - 52.0f;
    const float r = std::min(kControles.r - 12.0f, kColX[col + span - 1] + 52.0f);
    return { l, kFilaSecundaria - 12.0f, r, kFilaSecundaria + 12.0f };
}
inline Dropdown* selector(EditorContext& c, int col, int span, uint32_t id, const wchar_t* etiqueta) {
    const Rect r = filaSecundaria(col, span);
    return c.dropdown(id, { r.l, r.t + 2.0f, r.r, r.b - 2.0f }, etiqueta);
}
inline Toggle* interruptor(EditorContext& c, int col, int span, uint32_t id, const wchar_t* etiqueta) {
    return c.toggle(id, filaSecundaria(col, span), etiqueta);
}

// Sección SALIDA: la píldora es siempre el BYPASS del plugin (si lo tiene)
inline Section* salida(EditorContext& c, int bypassParam = -1, const wchar_t* titulo = L"SALIDA") {
    return c.section(kSalida, titulo, bypassParam, true);
}
inline Fader* fader(EditorContext& c, uint32_t id, const wchar_t* etiqueta) { return c.fader(id, kFader, etiqueta); }
// Medidor en el hueco del fader (plugins sin ganancia de salida: p. ej. atenuación del de-esser)
inline Meter* medidorEnFader(EditorContext& c, const wchar_t* etiqueta, float minDb, float maxDb, bool invertido) {
    return c.meter({ kFader.cx() - 6.0f, kMedidoresArriba, kFader.cx() + 6.0f, kMedidoresAbajo + 16.0f }, etiqueta, minDb, maxDb, invertido);
}
// Medidor vertical adicional (GR, true-peak…) en una celda de SALIDA, alineado con los medidores IN/OUT
inline Meter* medidorCelda(EditorContext& c, int col, const wchar_t* etiqueta, float minDb, float maxDb, bool invertido) {
    return c.meter({ kCeldaX[col] - 6.0f, kMedidoresArriba, kCeldaX[col] + 6.0f, kMedidoresAbajo + 16.0f }, etiqueta, minDb, maxDb, invertido);
}
inline Rect celda(int col, int fila, int span = 1) {
    return { kCeldaX[col] - 34.0f, kCeldaY[fila] - 12.0f, kCeldaX[col + span - 1] + 34.0f, kCeldaY[fila] + 12.0f };
}
// Perilla Normal que ocupa las dos filas de una celda
inline Knob* perillaSalida(EditorContext& c, int col, uint32_t id, const wchar_t* etiqueta) {
    return c.knob(id, kCeldaX[col], 484.0f, KnobSize::Normal, etiqueta);
}
inline Knob* perillaPequena(EditorContext& c, int col, int fila, uint32_t id, const wchar_t* etiqueta) {
    return c.knob(id, kCeldaX[col], kCeldaY[fila] - 8.0f, KnobSize::Small, etiqueta);
}
inline Toggle* interruptorSalida(EditorContext& c, int col, int fila, int span, uint32_t id, const wchar_t* etiqueta) {
    return c.toggle(id, celda(col, fila, span), etiqueta);
}
inline Dropdown* selectorSalida(EditorContext& c, int fila, uint32_t id, const wchar_t* etiqueta) {
    const Rect r = celda(0, fila, 3);
    return c.dropdown(id, { r.l, r.t + 2.0f, r.r, r.b - 2.0f }, etiqueta);
}
inline void medidores(EditorContext& c, Kit::StereoMeters& m) { m.build(c, kMedidoresX, kMedidoresArriba, kMedidoresAbajo); }

// ---------------------------------------------------------------------------------
//  Visualizador
// ---------------------------------------------------------------------------------
constexpr Rect kVisual = Layout::kVisualizer;
constexpr float kDbMin = -120.0f, kDbMax = 0.0f;   // escala unificada (V3 §4.3)
constexpr double kInclinacion = 3.0;               // dB/oct respecto a 1 kHz (lectura "plana" de mezclas)

inline Rect areaEspectro(const Rect& v = kVisual) { return { v.l + 14.0f, v.t + 32.0f, v.r - 40.0f, v.b - 22.0f }; }
inline float yDbfs(const Rect& a, float db) { return a.b - std::clamp((db - kDbMin) / (kDbMax - kDbMin), 0.0f, 1.0f) * a.h(); }

// Espectro dual IN/OUT con balística por tiempo, idéntica para ambos trazos
class EspectroDual {
public:
    static constexpr int kCols = 192;
    void actualizar(JasWaveDsp::MeterBusBase& bus, float dt, bool in = true, bool out = true) {
        const double sr = bus.sampleRate.load(std::memory_order_relaxed);
        hayIn_ = in;
        hayOut_ = out;
        if (in) { in_.updateBalistica(bus.espIn, sr, dt, Kit::kCaidaDbS); in_.columns(cIn_, kCols, 20.0, 20000.0, kInclinacion); }
        if (out) { out_.updateBalistica(bus.espOut, sr, dt, Kit::kCaidaDbS); out_.columns(cOut_, kCols, 20.0, 20000.0, kInclinacion); }
    }
    // Ejes (frecuencia y dBFS) + IN (fino, tenue, relleno 8 %) + OUT (1.8 px con halo, relleno 15 %).
    // `intensidad` < 1 lo deja en segundo plano (p. ej. bajo la curva del EQ).
    void dibujar(Gfx& g, const Rect& a, bool ejeFrecuencia = true, bool ejeDb = true, float intensidad = 1.0f) {
        const float k = std::clamp(intensidad, 0.0f, 1.0f);
        if (ejeFrecuencia) Kit::freqAxis(g, a);
        if (ejeDb) Kit::dbAxis(g, a, kDbMin, kDbMax, 24.0);
        if (hayIn_ && cIn_.size() == static_cast<size_t>(kCols)) {
            puntos(a, cIn_);
            g.fillUnder(pts_.data(), kCols, a.b, Pal::espectroIn.withAlpha(0.08f * k));
            g.polyline(pts_.data(), kCols, Pal::espectroIn.withAlpha(Pal::espectroIn.a * k), 1.0f);
        }
        if (hayOut_ && cOut_.size() == static_cast<size_t>(kCols)) {
            puntos(a, cOut_);
            g.fillUnder(pts_.data(), kCols, a.b, Pal::espectroOut.withAlpha(0.15f * k));
            if (k >= 0.99f) g.glowPolyline(pts_.data(), kCols, Pal::espectroOut, 1.8f);
            else g.polyline(pts_.data(), kCols, Pal::espectroOut.withAlpha(k), 1.2f);
        }
        // leyenda
        if (hayIn_) {
            g.fillRect({ a.r - 92.0f, a.t + 8.0f, a.r - 80.0f, a.t + 9.5f }, Pal::espectroIn);
            g.text(L"IN", { a.r - 76.0f, a.t + 1.0f, a.r - 52.0f, a.t + 15.0f }, Font::Label, Pal::textoTenue, Align::Left, true);
        }
        if (hayOut_) {
            g.fillRect({ a.r - 44.0f, a.t + 8.0f, a.r - 32.0f, a.t + 9.5f }, Pal::espectroOut);
            g.text(L"OUT", { a.r - 28.0f, a.t + 1.0f, a.r + 4.0f, a.t + 15.0f }, Font::Label, Pal::textoTenue, Align::Left, true);
        }
    }
private:
    void puntos(const Rect& a, const std::vector<float>& cols) {
        for (int i = 0; i < kCols; ++i)
            pts_[static_cast<size_t>(i)] = { a.l + a.w() * (i + 0.5f) / kCols, yDbfs(a, cols[static_cast<size_t>(i)]) };
    }
    JasWaveDsp::SpectrumAnalyzer in_, out_;
    std::vector<float> cIn_, cOut_;
    std::array<Pt, kCols> pts_{};
    bool hayIn_{false}, hayOut_{false};
};

// Teclado de 88 teclas (A0..C8) iluminado por las notas que suenan
class Teclado88 {
public:
    void actualizar(uint64_t k0, uint64_t k1, float dt) {
        const float caida = std::exp(-dt * 9.0f);
        for (int n = 0; n < 128; ++n) {
            const bool on = n < 64 ? ((k0 >> n) & 1u) != 0 : ((k1 >> (n - 64)) & 1u) != 0;
            brillo_[static_cast<size_t>(n)] = on ? 1.0f : brillo_[static_cast<size_t>(n)] * caida;
        }
    }
    void dibujar(Gfx& g, const Rect& kb, Color acento) {
        geometria(kb);
        for (int n = 21; n <= 108; ++n) {
            if (negra(n)) continue;
            const Rect& r = teclas_[static_cast<size_t>(n)];
            const float b = brillo_[static_cast<size_t>(n)];
            g.fillRect(r, b > 0.02f ? acento.withAlpha(0.25f + 0.65f * b) : hex(0x12143A));
            g.strokeRect(r, Pal::panelBorde, 0.8f);
        }
        for (int n = 21; n <= 108; ++n) {
            if (!negra(n)) continue;
            const Rect& r = teclas_[static_cast<size_t>(n)];
            const float b = brillo_[static_cast<size_t>(n)];
            g.fillRect(r, b > 0.02f ? Pal::cianNucleo.withAlpha(0.3f + 0.6f * b) : hex(0x03030F));
            g.strokeRect(r, Pal::panelBorde, 0.8f);
        }
        for (int n = 21; n <= 108; ++n)
            if (brillo_[static_cast<size_t>(n)] > 0.5f) g.glowDot(teclas_[static_cast<size_t>(n)].cx(), kb.t - 6.0f, 2.0f, acento);
    }
    static bool negra(int n) { const int p = n % 12; return p == 1 || p == 3 || p == 6 || p == 8 || p == 10; }
private:
    void geometria(const Rect& kb) {
        if (kb.l == kb_.l && kb.t == kb_.t && kb.r == kb_.r && kb.b == kb_.b) return;
        kb_ = kb;
        const float ww = kb.w() / 52.0f;   // 52 teclas blancas
        int wi = 0;
        for (int n = 21; n <= 108; ++n) {
            if (negra(n)) {
                const float x = kb.l + wi * ww;
                teclas_[static_cast<size_t>(n)] = { x - ww * 0.32f, kb.t, x + ww * 0.32f, kb.t + kb.h() * 0.6f };
            } else {
                teclas_[static_cast<size_t>(n)] = { kb.l + wi * ww + 0.6f, kb.t, kb.l + (wi + 1) * ww - 0.6f, kb.b };
                ++wi;
            }
        }
    }
    std::array<float, 128> brillo_{};
    std::array<Rect, 128> teclas_{};
    Rect kb_{ 0, 0, 0, 0 };
};

// ---------------------------------------------------------------------------------
//  Mini-panel de medición
// ---------------------------------------------------------------------------------
constexpr Rect kMini = Layout::kMiniPanel;
constexpr Rect kMiniGrafico{ kMini.l + 14.0f, kMini.t + 34.0f, kMini.r - 176.0f, kMini.b - 14.0f };

inline void panelVisual(Gfx& g, const wchar_t* titulo) { Kit::panel(g, kVisual, titulo); }
inline void panelMedicion(Gfx& g, const wchar_t* titulo) { Kit::panel(g, kMini, titulo); }
// Lecturas en una rejilla 2×2 a la derecha del mini-panel
inline void lectura(Gfx& g, int col, int fila, const wchar_t* etiqueta, const wchar_t* valor, Color c = Pal::textoValor) {
    Kit::readout(g, kMini.r - 162.0f + col * 82.0f, kMini.t + 30.0f + fila * 48.0f, etiqueta, valor, c);
}

// Medidor horizontal de reducción de ganancia (crece de derecha a izquierda) con marca de pico
inline void barraGR(Gfx& g, const Rect& bar, float grDb, float picoDb, Color acento, float maxDb = 24.0f) {
    constexpr int kSegs = 48;
    const float sw = bar.w() / kSegs;
    for (int i = 0; i < kSegs; ++i) {
        const float x0 = bar.r - (i + 1) * sw;
        const float nivel = (i + 0.5f) * maxDb / kSegs;
        const bool on = grDb >= nivel;
        const bool pico = std::fabs(picoDb - nivel) < 0.5f * maxDb / kSegs;
        g.fillRect({ x0 + 1.0f, bar.t, x0 + sw - 1.0f, bar.b }, on ? acento : pico ? acento.withAlpha(0.6f) : acento.withAlpha(0.08f));
    }
}

// Historial de reducción de ganancia en cascada (crece hacia abajo), en el color de acento
class HistorialGR {
public:
    static constexpr int kN = 240;
    void push(float grDb) { h_[static_cast<size_t>(pos_)] = grDb; pos_ = (pos_ + 1) % kN; }
    // Carga el historial del scope del procesador (≈1 ms por entrada) reducido a kN columnas por máximo
    void cargar(const float* gr, int n) {
        pos_ = 0;
        if (n <= 0) { h_.fill(0.0f); return; }
        for (int i = 0; i < kN; ++i) {
            const int a = i * n / kN, b = std::max(a + 1, (i + 1) * n / kN);
            float m = 0.0f;
            for (int k = a; k < b && k < n; ++k) m = std::max(m, gr[k]);
            h_[static_cast<size_t>(i)] = m;
        }
    }
    void dibujar(Gfx& g, const Rect& r, Color acento, float maxDb = 24.0f) {
        Chrome::drawGrid(g, r, 22.0f, false);
        for (int i = 0; i < kN; ++i) {
            const float v = h_[static_cast<size_t>((pos_ + i) % kN)];
            pts_[static_cast<size_t>(i)] = { r.l + r.w() * i / (kN - 1), r.t + std::clamp(v / maxDb, 0.0f, 1.0f) * r.h() };
        }
        // relleno desde la línea de 0 dB (arriba) hasta la curva
        for (int i = 1; i < kN; ++i) {
            const float y = std::max(pts_[static_cast<size_t>(i - 1)].y, pts_[static_cast<size_t>(i)].y);
            if (y - r.t > 0.5f) g.fillRect({ pts_[static_cast<size_t>(i - 1)].x, r.t, pts_[static_cast<size_t>(i)].x + 0.35f, y }, acento.withAlpha(0.14f));
        }
        g.glowPolyline(pts_.data(), kN, acento, 1.4f);
        g.text(L"0", { r.r + 3.0f, r.t - 7.0f, r.r + 30.0f, r.t + 7.0f }, Font::ValueSmall, Pal::textoTenue);
        wchar_t b[8];
        swprintf_s(b, L"-%.0f", maxDb);
        g.text(b, { r.r + 3.0f, r.b - 7.0f, r.r + 30.0f, r.b + 7.0f }, Font::ValueSmall, Pal::textoTenue);
    }
private:
    std::array<float, kN> h_{};
    std::array<Pt, kN> pts_{};
    int pos_{0};
};

} // namespace Plantilla
} // namespace JasWaveUI
