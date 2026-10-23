#pragma once

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <gdiplus.h>
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <sstream>
#include <iomanip>

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "msimg32.lib")

namespace JasWaveUI {

// Inicialización de GDI+ una sola vez por módulo
inline void ensureGdiplus() {
    static ULONG_PTR g_token = 0;
    if (g_token == 0) {
        Gdiplus::GdiplusStartupInput input;
        Gdiplus::GdiplusStartup(&g_token, &input, nullptr);
    }
}

namespace Colors {
    static constexpr COLORREF kBgDeepSpaceRef = RGB(10, 11, 16);     // #0A0B10
    static constexpr COLORREF kBgCardRef      = RGB(17, 21, 31);     // #11151F
    static constexpr COLORREF kBgInnerRef     = RGB(13, 16, 23);     // #0D1017
    static constexpr COLORREF kBorderGlowRef  = RGB(32, 42, 60);     // #202A3C
    static constexpr COLORREF kNeonCyanRef    = RGB(0, 240, 255);    // #00F0FF
    static constexpr COLORREF kNeonMagentaRef = RGB(255, 0, 128);    // #FF0080
    static constexpr COLORREF kNeonAmberRef   = RGB(255, 176, 32);   // #FFB020
    static constexpr COLORREF kNeonGreenRef   = RGB(0, 255, 157);    // #00FF9D
    static constexpr COLORREF kTextPureRef    = RGB(245, 250, 255);
    static constexpr COLORREF kTextCyberRef   = RGB(140, 165, 195);

    inline Gdiplus::Color deepSpace()  { return Gdiplus::Color(255, 10, 11, 16); }
    inline Gdiplus::Color card()       { return Gdiplus::Color(255, 17, 21, 31); }
    inline Gdiplus::Color cardInner()  { return Gdiplus::Color(255, 13, 16, 23); }
    inline Gdiplus::Color borderGlow() { return Gdiplus::Color(255, 32, 42, 60); }
    inline Gdiplus::Color neonCyan(BYTE a = 255)    { return Gdiplus::Color(a, 0, 240, 255); }
    inline Gdiplus::Color neonMagenta(BYTE a = 255) { return Gdiplus::Color(a, 255, 0, 128); }
    inline Gdiplus::Color neonAmber(BYTE a = 255)   { return Gdiplus::Color(a, 255, 176, 32); }
    inline Gdiplus::Color neonGreen(BYTE a = 255)   { return Gdiplus::Color(a, 0, 255, 157); }
    inline Gdiplus::Color textPure()   { return Gdiplus::Color(255, 245, 250, 255); }
    inline Gdiplus::Color textCyber()  { return Gdiplus::Color(255, 140, 165, 195); }
}

// Estructura de Control Interactivo Cyber
struct CyberSlider {
    int id{0};
    std::wstring label;
    std::wstring valueText;
    double normalized{0.5};
    RECT bounds{0, 0, 0, 0};
    Gdiplus::Color accent{Colors::neonCyan()};
    bool isDragging{false};
};

// Renderizado del Marco HUD Principal
inline void drawCyberFrame(Gdiplus::Graphics& g, int w, int h,
                           const std::wstring& title,
                           const std::wstring& subtitle,
                           const std::wstring& aiBadge) {
    g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);

    // 1. Fondo Deep Space
    Gdiplus::SolidBrush bgBrush(Colors::deepSpace());
    g.FillRectangle(&bgBrush, 0, 0, w, h);

    // 2. Rejilla Cyberpunk sutil de fondo
    Gdiplus::Pen gridPen(Gdiplus::Color(18, 0, 240, 255), 1.0f);
    for (int x = 20; x < w; x += 40) {
        g.DrawLine(&gridPen, x, 0, x, h);
    }
    for (int y = 20; y < h; y += 40) {
        g.DrawLine(&gridPen, 0, y, w, y);
    }

    // 3. Tarjeta Principal con Biseles Futuristas
    int padX = 14;
    int padY = 12;
    int cardW = w - padX * 2;
    int cardH = h - padY * 2;

    Gdiplus::SolidBrush cardBrush(Colors::card());
    g.FillRectangle(&cardBrush, padX, padY, cardW, cardH);

    // Marco exterior con resplandor neón
    Gdiplus::Pen borderPen(Colors::borderGlow(), 1.5f);
    g.DrawRectangle(&borderPen, padX, padY, cardW, cardH);

    // Esquinas reforzadas (Cyber accents)
    Gdiplus::Pen cornerPen(Colors::neonCyan(), 2.0f);
    int cL = 12;
    // Top-Left
    g.DrawLine(&cornerPen, padX, padY + cL, padX, padY);
    g.DrawLine(&cornerPen, padX, padY, padX + cL, padY);
    // Top-Right
    g.DrawLine(&cornerPen, padX + cardW - cL, padY, padX + cardW, padY);
    g.DrawLine(&cornerPen, padX + cardW, padY, padX + cardW, padY + cL);
    // Bottom-Left
    g.DrawLine(&cornerPen, padX, padY + cardH - cL, padX, padY + cardH);
    g.DrawLine(&cornerPen, padX, padY + cardH, padX + cL, padY + cardH);
    // Bottom-Right
    g.DrawLine(&cornerPen, padX + cardW - cL, padY + cardH, padX + cardW, padY + cardH);
    g.DrawLine(&cornerPen, padX + cardW, padY + cardH - cL, padX + cardW, padY + cardH);

    // Barra de acento Neón superior
    Gdiplus::LinearGradientBrush barBrush(
        Gdiplus::Point(padX, padY),
        Gdiplus::Point(padX + cardW, padY),
        Colors::neonCyan(220),
        Colors::neonMagenta(180)
    );
    g.FillRectangle(&barBrush, padX + 2, padY + 1, cardW - 4, 3);

    // 4. Tipografía Encabezado
    Gdiplus::FontFamily fontSegoe(L"Segoe UI");
    Gdiplus::FontFamily fontConsolas(L"Consolas");
    Gdiplus::Font titleFont(&fontSegoe, 15.0f, Gdiplus::FontStyleBold, Gdiplus::UnitPixel);
    Gdiplus::Font subFont(&fontSegoe, 11.5f, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);
    Gdiplus::Font badgeFont(&fontConsolas, 11.0f, Gdiplus::FontStyleBold, Gdiplus::UnitPixel);

    Gdiplus::SolidBrush textBrush(Colors::textPure());
    Gdiplus::SolidBrush subBrush(Colors::textCyber());
    Gdiplus::SolidBrush cyanBrush(Colors::neonCyan());

    g.DrawString(title.c_str(), -1, &titleFont, Gdiplus::PointF((float)padX + 16, (float)padY + 12), &textBrush);
    g.DrawString(subtitle.c_str(), -1, &subFont, Gdiplus::PointF((float)padX + 16, (float)padY + 32), &subBrush);

    // Badge AI Matrix a la derecha
    Gdiplus::RectF badgeBox((float)(padX + cardW - 190), (float)(padY + 14), 175.0f, 22.0f);
    Gdiplus::SolidBrush badgeBg(Gdiplus::Color(30, 0, 240, 255));
    g.FillRectangle(&badgeBg, badgeBox);
    Gdiplus::Pen badgeBorder(Colors::neonCyan(140), 1.0f);
    g.DrawRectangle(&badgeBorder, badgeBox);

    Gdiplus::StringFormat badgeFormat;
    badgeFormat.SetAlignment(Gdiplus::StringAlignmentCenter);
    badgeFormat.SetLineAlignment(Gdiplus::StringAlignmentCenter);
    g.DrawString(aiBadge.c_str(), -1, &badgeFont, badgeBox, &badgeFormat, &cyanBrush);
}

// Renderizado de Slider Futurista Cyber con Track Neón y Mango Háptico
inline void drawCyberSlider(Gdiplus::Graphics& g, const CyberSlider& slider) {
    int x = slider.bounds.left;
    int y = slider.bounds.top;
    int w = slider.bounds.right - slider.bounds.left;
    int h = slider.bounds.bottom - slider.bounds.top;

    Gdiplus::FontFamily fontSegoe(L"Segoe UI");
    Gdiplus::FontFamily fontConsolas(L"Consolas");
    Gdiplus::Font labelFont(&fontSegoe, 11.0f, Gdiplus::FontStyleBold, Gdiplus::UnitPixel);
    Gdiplus::Font valFont(&fontConsolas, 11.0f, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);

    // Etiqueta a la izquierda
    Gdiplus::SolidBrush textBrush(Colors::textPure());
    g.DrawString(slider.label.c_str(), -1, &labelFont, Gdiplus::PointF((float)x, (float)y), &textBrush);

    // Valor a la derecha
    Gdiplus::SolidBrush valBrush(slider.accent);
    Gdiplus::StringFormat rightFmt;
    rightFmt.SetAlignment(Gdiplus::StringAlignmentFar);
    g.DrawString(slider.valueText.c_str(), -1, &valFont, Gdiplus::PointF((float)(x + w), (float)y), &rightFmt, &valBrush);

    // Track del Slider
    int trackY = y + 18;
    int trackH = 10;
    int trackW = w;

    // Fondo oscuro del track
    Gdiplus::SolidBrush trackBg(Colors::cardInner());
    g.FillRectangle(&trackBg, x, trackY, trackW, trackH);
    Gdiplus::Pen trackBorder(Colors::borderGlow(), 1.0f);
    g.DrawRectangle(&trackBorder, x, trackY, trackW, trackH);

    // Relleno Neón Activo
    int fillW = (int)(slider.normalized * trackW);
    if (fillW > 0) {
        Gdiplus::SolidBrush fillBrush(Gdiplus::Color(140, slider.accent.GetR(), slider.accent.GetG(), slider.accent.GetB()));
        g.FillRectangle(&fillBrush, x, trackY, fillW, trackH);
    }

    // Mango / Thumb Neón
    int thumbW = 14;
    int thumbH = 18;
    int thumbX = x + fillW - thumbW / 2;
    int thumbY = trackY - (thumbH - trackH) / 2;

    if (thumbX < x) thumbX = x;
    if (thumbX > x + trackW - thumbW) thumbX = x + trackW - thumbW;

    Gdiplus::SolidBrush thumbBrush(Colors::card());
    g.FillRectangle(&thumbBrush, thumbX, thumbY, thumbW, thumbH);

    Gdiplus::Pen thumbPen(slider.accent, 1.5f);
    g.DrawRectangle(&thumbPen, thumbX, thumbY, thumbW, thumbH);

    // Línea central luminosa en el mango
    Gdiplus::Pen thumbGlow(Colors::textPure(), 1.0f);
    g.DrawLine(&thumbGlow, thumbX + thumbW / 2, thumbY + 3, thumbX + thumbW / 2, thumbY + thumbH - 3);
}

// -------------------------------------------------------------------------------------------------
// VISUALIZADOR 1: Gráfico Paramétrico EQ con Curva Analítica Biquad y Analizador de Espectro RTA
// -------------------------------------------------------------------------------------------------
inline void drawParametricEqVisualizer(Gdiplus::Graphics& g, const RECT& rc,
                                      double lowCutFreq, double lowShelfGain,
                                      double highShelfGain, double masterGain,
                                      const std::vector<float>* realSpectrum = nullptr,
                                      float animPhase = 0.0f) {
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;

    // Fondo del visor
    Gdiplus::SolidBrush scopeBg(Colors::cardInner());
    g.FillRectangle(&scopeBg, rc.left, rc.top, w, h);
    Gdiplus::Pen scopeBorder(Colors::borderGlow(), 1.0f);
    g.DrawRectangle(&scopeBorder, rc.left, rc.top, w, h);

    // Rejilla de frecuencias (20, 100, 1k, 10k, 20k) y dB (+12, 0, -12, -24)
    Gdiplus::Pen gridPen(Gdiplus::Color(25, 140, 165, 195), 1.0f);
    Gdiplus::FontFamily fontConsolas(L"Consolas");
    Gdiplus::Font gridFont(&fontConsolas, 9.0f, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);
    Gdiplus::SolidBrush gridTextBrush(Gdiplus::Color(100, 140, 165, 195));

    // Líneas dB
    int midY = rc.top + h / 2;
    int yPlus12 = rc.top + (int)(h * 0.22);
    int yMinus12 = rc.top + (int)(h * 0.78);

    g.DrawLine(&gridPen, rc.left, midY, rc.right, midY); // 0 dB
    g.DrawLine(&gridPen, rc.left, yPlus12, rc.right, yPlus12); // +12 dB
    g.DrawLine(&gridPen, rc.left, yMinus12, rc.right, yMinus12); // -12 dB

    g.DrawString(L"+12 dB", -1, &gridFont, Gdiplus::PointF((float)rc.left + 6, (float)yPlus12 - 12), &gridTextBrush);
    g.DrawString(L" 0 dB", -1, &gridFont, Gdiplus::PointF((float)rc.left + 6, (float)midY - 12), &gridTextBrush);
    g.DrawString(L"-12 dB", -1, &gridFont, Gdiplus::PointF((float)rc.left + 6, (float)yMinus12 - 12), &gridTextBrush);

    // Frecuencias Logarítmicas
    struct FreqMarker { double hz; const wchar_t* label; };
    FreqMarker markers[] = { {100.0, L"100Hz"}, {1000.0, L"1kHz"}, {10000.0, L"10kHz"} };
    for (const auto& m : markers) {
        double normX = (std::log10(m.hz) - std::log10(20.0)) / (std::log10(20000.0) - std::log10(20.0));
        int markerX = rc.left + (int)(normX * w);
        g.DrawLine(&gridPen, markerX, rc.top, markerX, rc.bottom);
        g.DrawString(m.label, -1, &gridFont, Gdiplus::PointF((float)markerX + 4, (float)rc.bottom - 16), &gridTextBrush);
    }

    // 2. Analizador de Espectro RTA Real (FFT Hann de audio real)
    if (realSpectrum && !realSpectrum->empty()) {
        const int numBars = std::min(48, static_cast<int>(realSpectrum->size()));
        const float barW = static_cast<float>(w) / static_cast<float>(numBars);
        Gdiplus::SolidBrush rtaBrush(Gdiplus::Color(45, 0, 240, 255));
        Gdiplus::SolidBrush rtaCapBrush(Gdiplus::Color(180, 0, 240, 255));
        for (int i = 0; i < numBars; ++i) {
            float db = (*realSpectrum)[static_cast<size_t>(i)]; // dBFS (-120 a 0)
            float norm = (db - (-75.0f)) / (0.0f - (-75.0f));
            norm = std::max(0.0f, std::min(1.0f, norm));
            float barH = norm * (h * 0.82f);
            if (barH > 1.0f) {
                g.FillRectangle(&rtaBrush, rc.left + i * barW + 1, rc.bottom - barH - 1, barW - 2, barH);
                g.FillRectangle(&rtaCapBrush, rc.left + i * barW + 1, rc.bottom - barH - 2, barW - 2, 2.0f);
            }
        }
    } else {
        Gdiplus::SolidBrush idleBrush(Gdiplus::Color(8, 0, 240, 255));
        g.FillRectangle(&idleBrush, rc.left + 1, rc.bottom - 2, w - 2, 2);
    }

    // 3. Curva de Respuesta de Frecuencia Real Biquad
    std::vector<Gdiplus::PointF> curvePoints;
    curvePoints.reserve(w);

    double minF = std::log10(20.0);
    double maxF = std::log10(20000.0);

    for (int px = 0; px < w; px += 2) {
        double normX = (double)px / (double)w;
        double freq = std::pow(10.0, minF + normX * (maxF - minF));

        // Cálculo aproximado de ganancia combinada de los 4 filtros
        double totalGainDb = masterGain;

        // Low Cut (Highpass a lowCutFreq)
        if (freq < lowCutFreq) {
            double ratio = freq / (lowCutFreq + 0.001);
            totalGainDb += 24.0 * std::log10(std::max(0.001, ratio));
        }

        // Low Shelf (centrado en ~250 Hz)
        double lowTrans = 1.0 / (1.0 + std::pow(freq / 250.0, 2.0));
        totalGainDb += lowShelfGain * lowTrans;

        // High Shelf (centrado en ~4000 Hz)
        double highTrans = 1.0 / (1.0 + std::pow(4000.0 / freq, 2.0));
        totalGainDb += highShelfGain * highTrans;

        // Limitar a rango visible [-24 dB, +18 dB]
        double normY = (18.0 - totalGainDb) / (18.0 - (-24.0));
        normY = std::max(0.02, std::min(0.98, normY));
        float py = (float)(rc.top + normY * h);
        curvePoints.push_back(Gdiplus::PointF((float)(rc.left + px), py));
    }

    // Relleno translúcido bajo la curva
    if (curvePoints.size() > 1) {
        std::vector<Gdiplus::PointF> polyPoints = curvePoints;
        polyPoints.push_back(Gdiplus::PointF((float)rc.right, (float)rc.bottom));
        polyPoints.push_back(Gdiplus::PointF((float)rc.left, (float)rc.bottom));

        Gdiplus::LinearGradientBrush areaBrush(
            Gdiplus::Point(rc.left, rc.top),
            Gdiplus::Point(rc.left, rc.bottom),
            Gdiplus::Color(45, 0, 240, 255),
            Gdiplus::Color(5, 0, 240, 255)
        );
        g.FillPolygon(&areaBrush, polyPoints.data(), (INT)polyPoints.size());

        // Trazo Neón brillante de la curva
        Gdiplus::Pen curvePen(Colors::neonCyan(), 2.5f);
        g.DrawLines(&curvePen, curvePoints.data(), (INT)curvePoints.size());
    }

    // 4. Nodos de Filtro Interactivos (Interactive Pucks)
    auto drawNode = [&](double freq, double gainDb, Gdiplus::Color col, const wchar_t* tag) {
        double normX = (std::log10(freq) - minF) / (maxF - minF);
        normX = std::max(0.02, std::min(0.98, normX));
        double normY = (18.0 - gainDb) / (18.0 - (-24.0));
        normY = std::max(0.05, std::min(0.95, normY));

        float nx = (float)(rc.left + normX * w);
        float ny = (float)(rc.top + normY * h);

        // Anillo de resplandor exterior
        Gdiplus::Pen glowPen(Gdiplus::Color(80, col.GetR(), col.GetG(), col.GetB()), 3.0f);
        g.DrawEllipse(&glowPen, nx - 9, ny - 9, 18.0f, 18.0f);

        // Núcleo del nodo
        Gdiplus::SolidBrush nodeBrush(col);
        g.FillEllipse(&nodeBrush, nx - 6, ny - 6, 12.0f, 12.0f);

        // Etiqueta del nodo
        g.DrawString(tag, -1, &gridFont, Gdiplus::PointF(nx - 8, ny - 20), &gridTextBrush);
    };

    drawNode(lowCutFreq, 0.0, Colors::neonCyan(), L"HP");
    drawNode(250.0, lowShelfGain, Colors::neonAmber(), L"LS");
    drawNode(4000.0, highShelfGain, Colors::neonMagenta(), L"HS");
    drawNode(12000.0, masterGain, Colors::neonGreen(), L"OUT");
}

// -------------------------------------------------------------------------------------------------
// VISUALIZADOR 2: Compresor Bus con Escopio de Reducción de Ganancia (GR) y Curva VCA
// -------------------------------------------------------------------------------------------------
inline void drawCompressorVisualizer(Gdiplus::Graphics& g, const RECT& rc,
                                     double threshDb, double ratioVal, double grDb,
                                     const JasWaveDsp::ScopeSnapshot* realScope = nullptr,
                                     double detLevelDb = -100.0,
                                     float animPhase = 0.0f) {
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;

    Gdiplus::SolidBrush scopeBg(Colors::cardInner());
    g.FillRectangle(&scopeBg, rc.left, rc.top, w, h);
    Gdiplus::Pen scopeBorder(Colors::borderGlow(), 1.0f);
    g.DrawRectangle(&scopeBorder, rc.left, rc.top, w, h);

    // Dividir en 2 paneles: Izquierda = Curva de Transferencia VCA, Derecha = Escopio de GR en Tiempo Real
    int leftW = (int)(w * 0.40);
    RECT curveRc = { rc.left + 8, rc.top + 8, rc.left + leftW - 8, rc.bottom - 8 };
    RECT grRc = { rc.left + leftW + 8, rc.top + 8, rc.right - 8, rc.bottom - 8 };

    Gdiplus::Pen splitPen(Colors::borderGlow(), 1.0f);
    g.DrawLine(&splitPen, rc.left + leftW, rc.top, rc.left + leftW, rc.bottom);

    Gdiplus::FontFamily fontConsolas(L"Consolas");
    Gdiplus::Font monoFont(&fontConsolas, 9.0f, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);
    Gdiplus::SolidBrush labelBrush(Colors::textCyber());

    // Panel Izquierdo: Curva de Transferencia (Input vs Output)
    g.DrawString(L"VCA TRANSFER SLOPE", -1, &monoFont, Gdiplus::PointF((float)curveRc.left, (float)curveRc.top), &labelBrush);

    int cW = curveRc.right - curveRc.left;
    int cH = curveRc.bottom - curveRc.top - 16;
    int cTop = curveRc.top + 16;

    // Línea de 1:1 (sin compresión)
    Gdiplus::Pen linPen(Gdiplus::Color(30, 140, 165, 195), 1.0f);
    g.DrawLine(&linPen, curveRc.left, cTop + cH, curveRc.left + cW, cTop);

    // Curva con Threshold y Ratio
    double normThresh = (threshDb - (-40.0)) / (0.0 - (-40.0));
    normThresh = std::max(0.1, std::min(0.9, normThresh));
    int kneeX = curveRc.left + (int)(normThresh * cW);
    int kneeY = cTop + cH - (int)(normThresh * cH);

    Gdiplus::Pen vcaPen(Colors::neonAmber(), 2.0f);
    g.DrawLine(&vcaPen, curveRc.left, cTop + cH, kneeX, kneeY);

    // Pendiente por encima del umbral (1 / ratio)
    int endX = curveRc.left + cW;
    int endY = kneeY - (int)((endX - kneeX) / ratioVal);
    g.DrawLine(&vcaPen, kneeX, kneeY, endX, endY);

    // Punto activo del umbral
    Gdiplus::SolidBrush kneePoint(Colors::neonCyan());
    g.FillEllipse(&kneePoint, kneeX - 4, kneeY - 4, 8, 8);

    // Bola del detector en tiempo real si hay audio
    if (detLevelDb > -50.0) {
        double dIn = std::max(-40.0, std::min(0.0, detLevelDb));
        double normIn = (dIn - (-40.0)) / 40.0;
        double dOut = dIn <= threshDb ? dIn : threshDb + (dIn - threshDb) / ratioVal;
        double normOut = (dOut - (-40.0)) / 40.0;
        int dx = curveRc.left + (int)(normIn * cW);
        int dy = cTop + cH - (int)(normOut * cH);
        Gdiplus::Pen glowPen(Gdiplus::Color(100, 255, 176, 32), 2.5f);
        g.DrawEllipse(&glowPen, dx - 6, dy - 6, 12, 12);
        Gdiplus::SolidBrush dotBrush(Colors::neonMagenta());
        g.FillEllipse(&dotBrush, dx - 4, dy - 4, 8, 8);
    }

    // Panel Derecho: Escopio de Reducción de Ganancia (GR Timeline)
    std::wstring grLabel = L"GAIN REDUCTION: " + std::to_wstring((int)std::abs(grDb)) + L" dB";
    g.DrawString(grLabel.c_str(), -1, &monoFont, Gdiplus::PointF((float)grRc.left, (float)grRc.top), &labelBrush);

    int grW = grRc.right - grRc.left;
    int grH = grRc.bottom - grRc.top - 16;
    int grTop = grRc.top + 16;

    // Línea 0 dB GR (tope)
    Gdiplus::Pen zeroPen(Gdiplus::Color(60, 255, 176, 32), 1.0f);
    g.DrawLine(&zeroPen, grRc.left, grTop, grRc.right, grTop);

    // Historial real del bus de audio
    std::vector<Gdiplus::PointF> grPoints;
    if (realScope && realScope->count > 10) {
        const int n = realScope->count;
        for (int x = 0; x < grW; x += 2) {
            int idx = (x * n) / grW;
            if (idx >= n) idx = n - 1;
            float gDb = realScope->grDb[static_cast<size_t>(idx)]; // dB (>=0)
            float norm = std::min(1.0f, gDb / 24.0f);
            float dipH = norm * (grH * 0.90f);
            grPoints.push_back(Gdiplus::PointF((float)(grRc.left + x), (float)(grTop + dipH)));
        }
    } else {
        for (int x = 0; x < grW; x += 4) {
            grPoints.push_back(Gdiplus::PointF((float)(grRc.left + x), (float)grTop));
        }
    }

    if (grPoints.size() > 1) {
        std::vector<Gdiplus::PointF> poly = grPoints;
        poly.push_back(Gdiplus::PointF((float)grRc.right, (float)grTop));
        poly.push_back(Gdiplus::PointF((float)grRc.left, (float)grTop));

        Gdiplus::LinearGradientBrush grArea(
            Gdiplus::Point(grRc.left, grTop),
            Gdiplus::Point(grRc.left, grTop + grH),
            Gdiplus::Color(80, 255, 176, 32),
            Gdiplus::Color(10, 255, 0, 128)
        );
        g.FillPolygon(&grArea, poly.data(), (INT)poly.size());

        Gdiplus::Pen grLine(Colors::neonAmber(), 2.0f);
        g.DrawLines(&grLine, grPoints.data(), (INT)grPoints.size());
    }
}

// -------------------------------------------------------------------------------------------------
// VISUALIZADOR 3: TruePeak Brickwall Limiter con Barras LUFS y Detección de Picos
// -------------------------------------------------------------------------------------------------
inline void drawLimiterVisualizer(Gdiplus::Graphics& g, const RECT& rc,
                                  double ceilingDb, double driveDb, double peakDb,
                                  const JasWaveDsp::ScopeSnapshot* realScope = nullptr,
                                  float lufsM = -120.0f, float lufsI = -120.0f, float tpOut = 0.0f,
                                  float animPhase = 0.0f) {
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;

    Gdiplus::SolidBrush scopeBg(Colors::cardInner());
    g.FillRectangle(&scopeBg, rc.left, rc.top, w, h);
    Gdiplus::Pen scopeBorder(Colors::borderGlow(), 1.0f);
    g.DrawRectangle(&scopeBorder, rc.left, rc.top, w, h);

    Gdiplus::FontFamily fontConsolas(L"Consolas");
    Gdiplus::Font monoFont(&fontConsolas, 9.0f, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);
    Gdiplus::SolidBrush labelBrush(Colors::textCyber());

    // Panel Izquierdo: Onda en Tiempo Real rebotando contra el Techo Brickwall
    int waveW = (int)(w * 0.65);
    RECT waveRc = { rc.left + 8, rc.top + 8, rc.left + waveW - 8, rc.bottom - 8 };
    RECT lufsRc = { rc.left + waveW + 8, rc.top + 8, rc.right - 8, rc.bottom - 8 };

    Gdiplus::Pen splitPen(Colors::borderGlow(), 1.0f);
    g.DrawLine(&splitPen, rc.left + waveW, rc.top, rc.left + waveW, rc.bottom);

    // Título Waveform
    g.DrawString(L"LOOKAHEAD WAVEFORM & CEILING", -1, &monoFont, Gdiplus::PointF((float)waveRc.left, (float)waveRc.top), &labelBrush);

    int midY = waveRc.top + (waveRc.bottom - waveRc.top) / 2 + 8;
    int maxAmplitude = (waveRc.bottom - waveRc.top) / 2 - 18;

    // Línea de Techo (Ceiling) Superior e Inferior
    double normCeiling = std::pow(10.0, ceilingDb / 20.0);
    int ceilY1 = midY - (int)(normCeiling * maxAmplitude);
    int ceilY2 = midY + (int)(normCeiling * maxAmplitude);

    Gdiplus::Pen ceilPen(Colors::neonMagenta(), 1.5f);
    g.DrawLine(&ceilPen, waveRc.left, ceilY1, waveRc.right, ceilY1);
    g.DrawLine(&ceilPen, waveRc.left, ceilY2, waveRc.right, ceilY2);

    // Dibujar señal con picos reales del lookahead
    std::vector<Gdiplus::PointF> waveTop;
    std::vector<Gdiplus::PointF> waveBottom;

    int ww = waveRc.right - waveRc.left;

    if (realScope && realScope->count > 10) {
        const int n = realScope->count;
        for (int x = 0; x < ww; x += 2) {
            int idx = (x * n) / ww;
            if (idx >= n) idx = n - 1;
            float outVal = realScope->outAbs[static_cast<size_t>(idx)];
            float norm = std::min(1.0f, outVal);
            float y1 = static_cast<float>(midY - norm * maxAmplitude);
            float y2 = static_cast<float>(midY + norm * maxAmplitude);
            waveTop.push_back(Gdiplus::PointF((float)(waveRc.left + x), y1));
            waveBottom.push_back(Gdiplus::PointF((float)(waveRc.left + x), y2));
        }
    } else {
        waveTop.push_back(Gdiplus::PointF((float)waveRc.left, (float)midY));
        waveTop.push_back(Gdiplus::PointF((float)waveRc.right, (float)midY));
        waveBottom.push_back(Gdiplus::PointF((float)waveRc.left, (float)midY));
        waveBottom.push_back(Gdiplus::PointF((float)waveRc.right, (float)midY));
    }

    if (waveTop.size() > 1) {
        Gdiplus::Pen wavePen(Colors::neonCyan(), 1.5f);
        g.DrawLines(&wavePen, waveTop.data(), (INT)waveTop.size());
        g.DrawLines(&wavePen, waveBottom.data(), (INT)waveBottom.size());
    }

    // Panel Derecho: Medidores LUFS y TruePeak dBTP
    g.DrawString(L"EBU LOUDNESS / dBTP", -1, &monoFont, Gdiplus::PointF((float)lufsRc.left, (float)lufsRc.top), &labelBrush);

    int meterTop = lufsRc.top + 20;
    int meterH = lufsRc.bottom - meterTop - 12;
    int barW = 20;

    // Barra 1: LUFS Integrated (-36 a -6 LUFS)
    int b1X = lufsRc.left + 16;
    Gdiplus::SolidBrush mBg(Colors::card());
    g.FillRectangle(&mBg, b1X, meterTop, barW, meterH);
    Gdiplus::Pen mBorder(Colors::borderGlow(), 1.0f);
    g.DrawRectangle(&mBorder, b1X, meterTop, barW, meterH);

    // Target Spotify -14 LUFS marker (-36 a -6: rango 30 dB. -14 está a 22 dB del fondo = 22/30)
    int ySpotify = meterTop + (int)(meterH * (1.0f - (22.0f / 30.0f)));
    Gdiplus::Pen spotPen(Colors::neonGreen(), 1.5f);
    g.DrawLine(&spotPen, b1X - 4, ySpotify, b1X + barW + 4, ySpotify);

    float activeLufs = lufsI > -70.0f ? lufsI : lufsM;
    float lufsNorm = activeLufs > -70.0f ? std::max(0.0f, std::min(1.0f, (activeLufs - (-36.0f)) / 30.0f)) : 0.0f;
    float lufsFillH = meterH * lufsNorm;
    Gdiplus::SolidBrush lufsFill(Colors::neonCyan());
    g.FillRectangle(&lufsFill, (float)b1X, (float)(meterTop + meterH - lufsFillH), (float)barW, lufsFillH);

    // Barra 2: TruePeak dBTP (-18 a +3 dBTP)
    int b2X = b1X + 44;
    g.FillRectangle(&mBg, b2X, meterTop, barW, meterH);
    g.DrawRectangle(&mBorder, b2X, meterTop, barW, meterH);

    // 0 dBTP line (rango 21 dB: -18 a +3. 0 está a 18 dB del fondo = 18/21)
    int yZero = meterTop + (int)(meterH * (1.0f - (18.0f / 21.0f)));
    Gdiplus::Pen redPen(Colors::neonMagenta(), 1.5f);
    g.DrawLine(&redPen, b2X - 4, yZero, b2X + barW + 4, yZero);

    float tpDb = tpOut > 1.0e-5f ? 20.0f * std::log10(tpOut) : -60.0f;
    float tpNorm = std::max(0.0f, std::min(1.0f, (tpDb - (-18.0f)) / 21.0f));
    float tpFillH = meterH * tpNorm;
    Gdiplus::SolidBrush tpFill(tpDb > 0.0f ? Colors::neonMagenta() : Colors::neonGreen());
    g.FillRectangle(&tpFill, (float)b2X, (float)(meterTop + meterH - tpFillH), (float)barW, tpFillH);

    g.DrawString(L"LUFS", -1, &monoFont, Gdiplus::PointF((float)b1X - 2, (float)(meterTop + meterH + 2)), &labelBrush);
    g.DrawString(L"dBTP", -1, &monoFont, Gdiplus::PointF((float)b2X - 2, (float)(meterTop + meterH + 2)), &labelBrush);
}

} // namespace JasWaveUI
#endif
