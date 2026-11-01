// =====================================================================================
//  JasWave Grand Piano - pagina "NOTA A NOTA" del editor nativo (plantilla shared-ui, sin tocarla)
//   - Teclado de 88 teclas: clic = elegir nota (Note Select); arrastrar = elegir un RANGO de notas
//   - Grafica de barras de las 88 notas para la propiedad activa (9 pestanas): clic/arrastre = pintar el valor
//     (interpola entre las notas que se saltan), doble clic = valor neutro, rueda = ajuste fino de la nota elegida
//   - Herramientas de grupo sobre el rango (o las 88 notas): suavizar, inclinar +/-, copiar a octavas, neutro
//   - Presets de timbre (Note Preset) y lectura de las 9 propiedades de la nota elegida
//  No registra widgets en el EditorContext (no cambia ui-layout.json): dibuja en drawPanels y recibe el raton por los
//  ganchos viz* del PluginEditor. Las ediciones van al modelo (INotaModelo: el controlador), que las envia al procesador.
// =====================================================================================
#pragma once

#include "grand_piano_dsp.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"

#include <cwctype>
#include <functional>
#include <string>

namespace JasWaveGrandPiano {

// Lo que la pagina necesita del controlador (el controlador es el unico que escribe en la tabla y habla con el procesador)
struct INotaModelo {
    virtual ~INotaModelo() = default;
    virtual NotaTabla copiaTabla() const = 0;
    virtual int notaSeleccionada() const = 0;                       // MIDI 21..108
    virtual void editarNota(int nota, int prop, double plain) = 0;  // escribe la tabla local y encola la orden al procesador
    virtual int pendientes() const = 0;                              // ordenes aun sin enviar
    virtual void tick(float dt) = 0;                                 // vacia la cola (una orden por llamada) y reenvia para verificar
};

class NotaPagina {
public:
    using Rect = JasWaveUI::Rect;
    static constexpr Rect kPanel{ 52.0f, 92.0f, 1048.0f, 556.0f };

    explicit NotaPagina(INotaModelo* m) : m_(m) {
        geometria();
        snap_ = m_->copiaTabla();
        sel_ = m_->notaSeleccionada();
    }

    void tick(float dt) {
        m_->tick(dt);
        snap_ = m_->copiaTabla();
        sel_ = m_->notaSeleccionada();
        pend_ = m_->pendientes();
    }

    // ---------------------------------------------------------------- dibujo
    void draw(JasWaveUI::Gfx& g, JasWaveUI::ParamAccess& pa, JasWaveUI::Color ac) {
        using namespace JasWaveUI;
        Kit::panel(g, kPanel, L"NOTA A NOTA  ·  AFINACIÓN Y TIMBRE POR TECLA  ·  88 TECLAS");
        // estado de sincronizacion con el procesador
        wchar_t buf[96];
        if (pend_ > 0) swprintf_s(buf, L"SINCRONIZANDO %d", pend_); else swprintf_s(buf, L"SINCRONIZADO");
        g.text(buf, { kPanel.r - 200.0f, kPanel.t + 4.0f, kPanel.r - 14.0f, kPanel.t + 22.0f }, Font::ValueSmall, pend_ > 0 ? Pal::alerta : Pal::textoTenue, Align::Right);

        // pestanas de propiedad
        for (int p = 0; p < kNpCount; ++p) {
            const Rect r = tab(p);
            const bool on = p == prop_;
            g.fillRound(r, 4.0f, on ? ac.withAlpha(0.22f) : hex(0x10123A, 0.8f));
            g.strokeRound(r, 4.0f, on ? ac : Pal::panelBorde, on ? 1.4f : 1.0f);
            g.text(ws(notaPropCorto(p)), r, Font::Label, on ? Pal::textoTitulo : Pal::textoEtiqueta, Align::Center, true);
        }

        dibujarGrafica(g, ac);
        dibujarTeclado(g, ac);

        // herramientas
        for (const Boton& b : botones_) {
            g.fillRound(b.r, 4.0f, hex(0x10123A, 0.85f));
            g.strokeRound(b.r, 4.0f, Pal::cian.withAlpha(0.55f), 1.0f);
            g.text(b.cap, b.r, Font::Label, Pal::textoTitulo, Align::Center, true);
        }
        const int n0 = rango_ ? lo_ : kNotaMin, n1 = rango_ ? hi_ : kNotaMax;
        swprintf_s(buf, L"RANGO  %hs – %hs  (%d notas)", notaNombre(n0), notaNombre(n1), n1 - n0 + 1);
        g.text(buf, { 66.0f, 482.0f, 560.0f, 498.0f }, Font::ValueSmall, rango_ ? ac : Pal::textoTenue, Align::Left);
        g.text(L"arrastra sobre el teclado para elegir un rango · sin rango = las 88 notas", { 360.0f, 482.0f, 790.0f, 498.0f }, Font::ValueSmall, Pal::textoTenue, Align::Right);

        // lectura de la nota elegida (las 9 propiedades)
        const int si = std::clamp(sel_ - kNotaMin, 0, kNotas - 1);
        for (int p = 0; p < kNpCount; ++p) {
            const Rect r = celda(p);
            const bool on = p == prop_;
            g.fillRound(r, 4.0f, hex(0x0B0D27, 0.7f));
            g.strokeRound(r, 4.0f, on ? ac : Pal::panelBorde, on ? 1.4f : 1.0f);
            g.text(ws(notaPropCorto(p)), { r.l + 6.0f, r.t + 3.0f, r.r - 4.0f, r.t + 17.0f }, Font::Label, Pal::textoTenue, Align::Left, true);
            const double v = snap_.v[si][p];
            const bool neutro = v == static_cast<float>(notaPropDefs()[p].def);
            g.text(valorTexto(p, v, true), { r.l + 6.0f, r.t + 20.0f, r.r - 4.0f, r.t + 38.0f }, Font::Value, neutro ? Pal::textoValor : ac, Align::Left);
        }

        // presets
        g.text(L"PRESET DE TIMBRE", { 806.0f, 424.0f, 1034.0f, 440.0f }, Font::Label, Pal::textoTenue, Align::Left, true);
        const int cur = static_cast<int>(std::lround(pa.plain(kNotePreset)));
        for (int k = 0; k < 4; ++k) {
            const Rect r = presetRect(k);
            const bool on = cur == k;
            g.fillRound(r, 4.0f, on ? ac.withAlpha(0.22f) : hex(0x10123A, 0.85f));
            g.strokeRound(r, 4.0f, on ? ac : Pal::panelBorde, on ? 1.4f : 1.0f);
            g.text(ws(notaPresetLabels()[k]), r, Font::Label, on ? Pal::textoTitulo : Pal::textoEtiqueta, Align::Center, true);
        }
        g.text(cur == kPresetPersonalizado ? L"PERSONALIZADO (editado a mano)" : L"", { 806.0f, 538.0f, 1034.0f, 552.0f }, Font::ValueSmall, Pal::textoTenue, Align::Left);
    }

    // ---------------------------------------------------------------- raton
    bool down(const JasWaveUI::MouseEvent& e, JasWaveUI::ParamAccess& pa) {
        mode_ = Modo::Nada;
        if (!kPanel.contains(e.x, e.y)) return false;
        for (int p = 0; p < kNpCount; ++p)
            if (tab(p).contains(e.x, e.y) || celda(p).contains(e.x, e.y)) { prop_ = p; return false; }
        for (const Boton& b : botones_) if (b.r.contains(e.x, e.y)) { herramienta(b.id); return false; }
        for (int k = 0; k < 4; ++k)
            if (presetRect(k).contains(e.x, e.y)) { pa.setNorm(kNotePreset, static_cast<double>(k) / (kNotaPresets - 1)); return false; }
        if (grafica_.contains(e.x, e.y)) {
            const int n = notaEnX(e.x);
            selecciona(pa, n);
            const double v = valorEnY(e.y);
            m_->editarNota(n, prop_, v);
            ultimaNota_ = n; ultimoValor_ = v;
            mode_ = Modo::Pintar;
            return true;
        }
        const int n = teclaEn(e.x, e.y);
        if (n >= 0) { selecciona(pa, n); ancla_ = n; rango_ = false; mode_ = Modo::Teclas; return true; }
        return false;
    }
    void drag(const JasWaveUI::MouseEvent& e, JasWaveUI::ParamAccess&) {
        if (mode_ == Modo::Pintar) {
            const int n = notaEnX(e.x);
            const double v = valorEnY(e.y);
            const int a = ultimaNota_, d = n > a ? 1 : (n < a ? -1 : 0);
            if (d == 0) { m_->editarNota(n, prop_, v); ultimoValor_ = v; return; }
            const double na = notaToNorm(prop_, ultimoValor_), nb = notaToNorm(prop_, v);
            for (int k = a + d; ; k += d) {   // interpola en el espacio normalizado entre la ultima nota pintada y esta
                const double t = static_cast<double>(k - a) / static_cast<double>(n - a);
                m_->editarNota(k, prop_, notaFromNorm(prop_, na + (nb - na) * t));
                if (k == n) break;
            }
            ultimaNota_ = n; ultimoValor_ = v;
        } else if (mode_ == Modo::Teclas) {
            const int n = teclaEn(e.x, e.y);
            if (n >= 0 && n != ancla_) { rango_ = true; lo_ = std::min(ancla_, n); hi_ = std::max(ancla_, n); }
        }
    }
    void up(const JasWaveUI::MouseEvent&, JasWaveUI::ParamAccess&) { mode_ = Modo::Nada; }
    void doble(const JasWaveUI::MouseEvent& e, JasWaveUI::ParamAccess&) {
        if (grafica_.contains(e.x, e.y)) m_->editarNota(notaEnX(e.x), prop_, notaPropDefs()[prop_].def);
    }
    void rueda(const JasWaveUI::MouseEvent& e, JasWaveUI::ParamAccess&) {
        if (!kPanel.contains(e.x, e.y) || e.wheel == 0) return;
        const double paso = (e.shift ? 0.002 : 0.01) * (e.wheel > 0 ? 1.0 : -1.0);
        const double n = notaToNorm(prop_, snap_.get(sel_, prop_));
        m_->editarNota(sel_, prop_, notaFromNorm(prop_, std::clamp(n + paso, 0.0, 1.0)));
    }

    // Herramientas (publicas para poder probarlas sin interfaz)
    enum Herramienta { kSuavizar = 0, kInclinarMenos, kInclinarMas, kOctavas, kNeutroProp, kNeutroNota, kQuitarRango };
    void herramienta(int id) {
        snap_ = m_->copiaTabla();
        const int a = rango_ ? lo_ : kNotaMin, b = rango_ ? hi_ : kNotaMax;
        const int p = prop_;
        auto norm = [&](int n) { return notaToNorm(p, snap_.get(n, p)); };
        switch (id) {
        case kSuavizar: {
            std::array<double, kNotas> o{};
            for (int n = a; n <= b; ++n) o[static_cast<size_t>(n - kNotaMin)] = 0.25 * norm(std::max(a, n - 1)) + 0.5 * norm(n) + 0.25 * norm(std::min(b, n + 1));
            for (int n = a; n <= b; ++n) m_->editarNota(n, p, notaFromNorm(p, o[static_cast<size_t>(n - kNotaMin)]));
            break;
        }
        case kInclinarMenos: case kInclinarMas: {
            if (b <= a) break;
            const double s = id == kInclinarMas ? 0.25 : -0.25;   // +-12,5 % del recorrido en cada extremo por pulsacion
            for (int n = a; n <= b; ++n) {
                const double t = static_cast<double>(n - a) / static_cast<double>(b - a);
                m_->editarNota(n, p, notaFromNorm(p, std::clamp(norm(n) + s * (t - 0.5), 0.0, 1.0)));
            }
            break;
        }
        case kOctavas: {
            const double v = snap_.get(sel_, p);
            for (int n = a; n <= b; ++n) if (n % 12 == sel_ % 12 && n != sel_) m_->editarNota(n, p, v);
            break;
        }
        case kNeutroProp:
            for (int n = a; n <= b; ++n) m_->editarNota(n, p, notaPropDefs()[p].def);
            break;
        case kNeutroNota:
            for (int q = 0; q < kNpCount; ++q) m_->editarNota(sel_, q, notaPropDefs()[q].def);
            break;
        case kQuitarRango: rango_ = false; break;
        default: break;
        }
    }
    void setPropiedad(int p) { prop_ = std::clamp(p, 0, kNpCount - 1); }
    int propiedad() const { return prop_; }
    void setRango(int lo, int hi) { rango_ = true; lo_ = std::clamp(std::min(lo, hi), kNotaMin, kNotaMax); hi_ = std::clamp(std::max(lo, hi), kNotaMin, kNotaMax); }
    void quitarRango() { rango_ = false; }

private:
    struct Boton { Rect r; const wchar_t* cap; int id; };
    enum class Modo { Nada, Pintar, Teclas };

    // ---- geometria (unidades de diseno 1100x620)
    Rect grafica_{ 66.0f, 154.0f, 1034.0f, 330.0f };
    Rect teclado_{ 66.0f, 336.0f, 1034.0f, 414.0f };
    std::array<Rect, 128> tecla_{};
    std::array<float, 128> cx_{};
    std::array<Boton, 7> botones_{};

    static bool negra(int n) { const int p = n % 12; return p == 1 || p == 3 || p == 6 || p == 8 || p == 10; }
    static std::wstring ws(const std::string& s) { return std::wstring(s.begin(), s.end()); }
    // UTF-8 -> UTF-16 (las etiquetas de preset llevan acentos)
    static std::wstring ws(const char* s) {
        std::wstring o;
        for (size_t i = 0; s && s[i];) {
            const unsigned char c = static_cast<unsigned char>(s[i]);
            if (c >= 0xC0 && s[i + 1]) { o.push_back(static_cast<wchar_t>(((c & 0x1F) << 6) | (s[i + 1] & 0x3F))); i += 2; }
            else { o.push_back(static_cast<wchar_t>(c)); ++i; }
        }
        for (auto& ch : o) ch = (ch >= 0xE0 && ch <= 0xFE && ch != 0xF7) ? static_cast<wchar_t>(ch - 0x20) : static_cast<wchar_t>(std::towupper(ch));
        return o;
    }
    static std::wstring valorTexto(int p, double v, bool unidad) { return ws(JasWaveVst::formatValue(notaParamDef(0, p), v, unidad)); }

    Rect tab(int p) const { const float w = 80.0f; return { 66.0f + p * (w + 3.0f), 122.0f, 66.0f + p * (w + 3.0f) + w, 144.0f }; }
    Rect celda(int p) const { const float w = 77.0f; return { 66.0f + p * (w + 2.0f), 506.0f, 66.0f + p * (w + 2.0f) + w, 546.0f }; }
    Rect presetRect(int k) const { return { 806.0f, 442.0f + k * 24.0f, 1034.0f, 462.0f + k * 24.0f }; }

    void geometria() {
        const float ww = teclado_.w() / 52.0f;
        int wi = 0;
        for (int n = kNotaMin; n <= kNotaMax; ++n) {
            const size_t i = static_cast<size_t>(n);
            if (negra(n)) {
                const float x = teclado_.l + wi * ww;
                tecla_[i] = { x - ww * 0.32f, teclado_.t, x + ww * 0.32f, teclado_.t + teclado_.h() * 0.6f };
            } else {
                tecla_[i] = { teclado_.l + wi * ww + 0.6f, teclado_.t, teclado_.l + (wi + 1) * ww - 0.6f, teclado_.b };
                ++wi;
            }
            cx_[i] = tecla_[i].cx();
        }
        const float bw = 168.0f, bh = 24.0f, gap = 6.0f;
        const wchar_t* cap[7] = { L"SUAVIZAR", L"INCLINAR  −", L"INCLINAR  +", L"COPIAR A OCTAVAS", L"NEUTRO (PROPIEDAD)", L"NEUTRO (NOTA)", L"QUITAR RANGO" };
        for (int i = 0; i < 7; ++i) {
            const int fila = i < 4 ? 0 : 1, col = i < 4 ? i : i - 4;
            botones_[static_cast<size_t>(i)] = { { 66.0f + col * (bw + gap), 424.0f + fila * 28.0f, 66.0f + col * (bw + gap) + bw, 424.0f + fila * 28.0f + bh }, cap[i], i };
        }
    }

    int notaEnX(float x) const {
        int best = kNotaMin;
        float bd = 1.0e9f;
        for (int n = kNotaMin; n <= kNotaMax; ++n) {
            const float d = std::fabs(cx_[static_cast<size_t>(n)] - x);
            if (d < bd) { bd = d; best = n; }
        }
        return best;
    }
    int teclaEn(float x, float y) const {
        if (!teclado_.contains(x, y)) return -1;
        for (int n = kNotaMin; n <= kNotaMax; ++n) if (negra(n) && tecla_[static_cast<size_t>(n)].contains(x, y)) return n;
        for (int n = kNotaMin; n <= kNotaMax; ++n) if (!negra(n) && tecla_[static_cast<size_t>(n)].contains(x, y)) return n;
        return -1;
    }
    double valorEnY(float y) const {
        double t = std::clamp(static_cast<double>((grafica_.b - y) / grafica_.h()), 0.0, 1.0);
        if (std::fabs(t - 0.5) < 0.012) t = 0.5;   // imán al valor neutro (todas las propiedades lo tienen en el centro)
        return notaClamp(prop_, notaFromNorm(prop_, t));
    }
    float yDe(double plain) const { return grafica_.b - static_cast<float>(notaToNorm(prop_, plain)) * grafica_.h(); }
    void selecciona(JasWaveUI::ParamAccess& pa, int n) {
        if (n < kNotaMin || n > kNotaMax) return;
        sel_ = n;
        pa.setNorm(kNoteSelect, static_cast<double>(n - kNotaMin) / (kNotas - 1));
    }

    void dibujarGrafica(JasWaveUI::Gfx& g, JasWaveUI::Color ac) const {
        using namespace JasWaveUI;
        const Rect& c = grafica_;
        g.fillRect(c, hex(0x05061A, 0.55f));
        g.strokeRect(c, Pal::panelBorde, 1.0f);
        const float y0 = c.t + c.h() * 0.5f;
        for (float f : { 0.25f, 0.75f }) g.line(c.l, c.t + c.h() * f, c.r, c.t + c.h() * f, Pal::cian.withAlpha(0.06f), 1.0f);
        // franjas de octava (cada C) y rango
        for (int n = kNotaMin; n <= kNotaMax; ++n)
            if (n % 12 == 0) g.line(cx_[static_cast<size_t>(n)] - 4.0f, c.t, cx_[static_cast<size_t>(n)] - 4.0f, c.b, Pal::cian.withAlpha(0.07f), 1.0f);
        if (rango_) {
            const float xa = cx_[static_cast<size_t>(lo_)] - 5.0f, xb = cx_[static_cast<size_t>(hi_)] + 5.0f;
            g.fillRect({ xa, c.t, xb, c.b }, ac.withAlpha(0.07f));
            g.strokeRect({ xa, c.t, xb, c.b }, ac.withAlpha(0.45f), 1.0f);
        }
        const float sx = cx_[static_cast<size_t>(std::clamp(sel_, kNotaMin, kNotaMax))];
        g.fillRect({ sx - 6.0f, c.t, sx + 6.0f, c.b }, Pal::cianNucleo.withAlpha(0.08f));
        g.line(c.l, y0, c.r, y0, Pal::cian.withAlpha(0.45f), 1.0f);
        for (int n = kNotaMin; n <= kNotaMax; ++n) {
            const double v = snap_.v[n - kNotaMin][prop_];
            const float y = yDe(v), x = cx_[static_cast<size_t>(n)];
            const bool en = n == sel_, enRango = rango_ && n >= lo_ && n <= hi_;
            const bool neg = y > y0;
            Color col = neg ? Pal::acentoVioleta : ac;
            col = col.withAlpha(en ? 1.0f : (enRango ? 0.9f : 0.62f));
            if (en) col = Pal::cianNucleo;
            const float t = std::min(y, y0), b = std::max(y, y0);
            g.fillRect({ x - 3.0f, t, x + 3.0f, std::max(b, t + 1.5f) }, col);
            g.fillRect({ x - 3.0f, y - 1.0f, x + 3.0f, y + 1.0f }, col.withAlpha(1.0f));
        }
        // rotulos
        const NotaPropDef& d = notaPropDefs()[prop_];
        g.text(valorTexto(prop_, d.mx, true), { c.l + 4.0f, c.t + 2.0f, c.l + 120.0f, c.t + 16.0f }, Font::ValueSmall, Pal::textoTenue, Align::Left);
        g.text(valorTexto(prop_, d.mn, true), { c.l + 4.0f, c.b - 16.0f, c.l + 120.0f, c.b - 2.0f }, Font::ValueSmall, Pal::textoTenue, Align::Left);
        g.text(valorTexto(prop_, d.def, true), { c.r - 124.0f, y0 - 14.0f, c.r - 4.0f, y0 - 1.0f }, Font::ValueSmall, Pal::textoTenue, Align::Right);
        wchar_t b[128];
        swprintf_s(b, L"%hs  ·  %hs: %s", notaPropCorto(prop_), notaNombre(sel_), valorTexto(prop_, snap_.get(sel_, prop_), true).c_str());
        g.text(b, { c.r - 330.0f, c.t + 2.0f, c.r - 6.0f, c.t + 16.0f }, Font::Value, Pal::textoValor, Align::Right);
    }

    void dibujarTeclado(JasWaveUI::Gfx& g, JasWaveUI::Color ac) const {
        using namespace JasWaveUI;
        for (int pasada = 0; pasada < 2; ++pasada) {
            for (int n = kNotaMin; n <= kNotaMax; ++n) {
                if (negra(n) != (pasada == 1)) continue;
                const Rect& r = tecla_[static_cast<size_t>(n)];
                const bool en = n == sel_, enRango = rango_ && n >= lo_ && n <= hi_;
                const bool tocada = !snap_.esNeutra(n);
                Color fill = pasada == 0 ? hex(0x12143A) : hex(0x03030F);
                if (enRango) fill = ac.withAlpha(pasada == 0 ? 0.22f : 0.35f);
                if (en) fill = Pal::cianNucleo.withAlpha(0.55f);
                g.fillRect(r, fill);
                g.strokeRect(r, en ? Pal::cianNucleo : Pal::panelBorde, en ? 1.4f : 0.8f);
                if (tocada) g.fillRect({ r.cx() - 2.0f, r.b - 7.0f, r.cx() + 2.0f, r.b - 3.0f }, ac);   // nota con ajustes
                if (pasada == 0 && n % 12 == 0) g.text(ws(notaNombre(n)), { r.l, r.b - 20.0f, r.r, r.b - 8.0f }, Font::ValueSmall, Pal::textoTenue, Align::Center);
            }
        }
    }

    INotaModelo* m_;
    NotaTabla snap_;
    int sel_{60}, prop_{0}, pend_{0};
    bool rango_{false};
    int lo_{21}, hi_{108}, ancla_{60};
    Modo mode_{Modo::Nada};
    int ultimaNota_{60};
    double ultimoValor_{0.0};
};

} // namespace JasWaveGrandPiano
