// JasWave EQ Parametric Pro – VST3 (procesador, controlador, editor Cyber con curva y nodos arrastrables)
#include "param_eq_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveEq {

// FUID estables (los de "JasWave FX EQ" y del EQ previo de plugins/): no cambiar
static const FUID kProcessorUid(0x4A617357, 0x46584551, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x46584551, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "eq.bandas-avanzadas", "Bandas 5–24" },
    { "eq.pendientes-altas", "Pendientes HPF/LPF de 24 a 48 dB/oct" },
    { "eq.analizador", "Analizador de espectro pre/post" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.param-eq", "JasWave EQ Parametric Pro", L"PARAMETRIC EQ", kFeatures, 3, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(ebus_ = std::make_shared<EqBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.snap(); engine_.reset(); }
    void updateParams() override {
        EqSettings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.slopeIdx = intOf(kSlope);
        for (int b = 0; b < kBands; ++b) {
            BandSettings& bs = s.band[static_cast<size_t>(b)];
            bs.type = intOf(bandParam(b, fType));
            bs.freq = plainOf(bandParam(b, fFreq));
            bs.gainDb = plainOf(bandParam(b, fGain));
            bs.q = plainOf(bandParam(b, fQ));
            bs.on = boolOf(bandParam(b, fOn));
            bs.used = boolOf(extParam(b, eUsed));
            bs.slope = intOf(extParam(b, eSlope));
            bs.mode = intOf(extParam(b, eMode));
            bs.solo = boolOf(extParam(b, eSolo));
        }
        s.outGainDb = plainOf(kOutput);
        s.analyzer = intOf(kAnalyzer);
        engine_.setSettings(s);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, ebus_.get()); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { engine_.process(iL, iR, oL, oR, n, ebus_.get()); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 0.2); }
    LegacyStateFn legacyState() override {
        // "JasWave FX EQ": 42 dobles normalizados con los mismos ids y mapeos (0..41)
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 42, nullptr); };
    }

private:
    EqEngine engine_;
    std::shared_ptr<EqBus> ebus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    Editor() { bIn_.fill(kBandFloorDb); bOut_.fill(kBandFloorDb); }
    const wchar_t* title() const override { return L"PARAMETRIC EQ"; }
    const wchar_t* subtitle() const override { return L"HASTA 24 BANDAS · FASE MÍNIMA · LATENCIA 0"; }

    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        ctx_ = &c;
        band_ = P::controles(c, L"BANDA 1", static_cast<int>(bandParam(0, fOn)));
        kFreq_ = P::principal(c, 0, bandParam(0, fFreq), L"FRECUENCIA");
        kGain_ = P::principal(c, 1, bandParam(0, fGain), L"GANANCIA");
        kQ_ = P::principal(c, 2, bandParam(0, fQ), L"Q");
        type_ = P::selector(c, 0, 2, bandParam(0, fType), L"TIPO");
        solo_ = P::interruptor(c, 2, 1, extParam(0, eSolo), L"SOLO");
        mode_ = c.dropdown(extParam(0, eMode), fila3(0, 2), L"MODO");
        slope_ = c.dropdown(extParam(0, eSlope), fila3(2, 1), L"PEND.");
        P::salida(c, kBypass);
        P::fader(c, kOutput, L"OUT");
        P::selectorSalida(c, 0, kSlope, L"PENDIENTE");
        P::selectorSalida(c, 1, kAnalyzer, L"ANALIZADOR");
        P::medidores(c, meters_);
        // Alta/baja de bandas y paginación de la tira (el resto de gestos: doble clic en el gráfico). Cuarta fila de controles.
        const float bx = P::kColX[0] - 52.0f, by = 378.0f;
        c.button({ bx, by, bx + 96, by + 20 }, L"+ BANDA", [this] { addBand(freeFreq()); });
        c.button({ bx + 102, by, bx + 198, by + 20 }, L"− BANDA", [this] { removeBand(sel_); });
        c.button({ bx + 204, by, bx + 244, by + 20 }, L"◀", [this] { page(-1); });
        c.button({ bx + 250, by, bx + 290, by + 20 }, L"▶", [this] { page(1); });
        select(0);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<EqBus>(c.params.bus());
        if (!bus_) return;
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        const int an = bus_->analyzer.load(std::memory_order_relaxed);
        analyzerOn_ = an > 0 && c.params.featureGranted(kFeatAnalyzer);
        preOn_ = analyzerOn_ && an >= 2;
        if (analyzerOn_) espectro_.actualizar(*bus_, c.dt, preOn_, true);
        // la banda seleccionada siempre debe existir
        if (!isUsed(c, sel_)) {
            const auto u = usedBands(c);
            if (!u.empty()) select(u.front());
        }
        for (int b = 0; b < kBands; ++b) {
            const float in = bus_->bandInDb[static_cast<size_t>(b)].load(std::memory_order_relaxed);
            const float out = bus_->bandOutDb[static_cast<size_t>(b)].load(std::memory_order_relaxed);
            // suavizado visual propio (los valores del DSP ya vienen con caída de ~250 ms)
            bIn_[static_cast<size_t>(b)] += (in - bIn_[static_cast<size_t>(b)]) * 0.5f;
            bOut_[static_cast<size_t>(b)] += (out - bOut_[static_cast<size_t>(b)]) * 0.5f;
            bNivel_[static_cast<size_t>(b)].actualizar(in > -100.0f ? in : JasWaveUI::Plantilla::kDbMin, c.dt);
        }
    }
    float outputLevel() const override { return meters_.level(); }

    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        Plantilla::panelVisual(g, L"RESPUESTA · ESPECTRO IN / OUT");
        meters_.drawLabels(g);
        const Rect pr = plotRect();
        // ejes: frecuencia común y dB de la curva (±18); el espectro usa la escala dBFS común sin rótulos
        Kit::freqAxis(g, pr);
        Kit::dbAxis(g, pr, -kDbRange, kDbRange, 6.0);
        if (analyzerOn_) espectro_.dibujar(g, pr, false, false, 0.45f);   // la curva domina (V3 §5.1)
        drawNivelesBanda(g, c, pr);
        // curvas: banda seleccionada (relleno) y total (hilo con glow + ecos)
        BandCoefs bc[kBands];
        bool active[kBands];
        const int globalSlope = c.params.locked(kSlope) ? 0 : static_cast<int>(std::lround(c.params.plain(kSlope)));
        for (int b = 0; b < kBands; ++b) {
            active[b] = isUsed(c, b) && c.params.plain(bandParam(b, fOn)) >= 0.5 && !c.params.locked(bandParam(b, fOn));
            if (!active[b]) continue;
            const int own = c.params.locked(extParam(b, eSlope)) ? 0 : static_cast<int>(std::lround(c.params.plain(extParam(b, eSlope))));
            designBand(static_cast<int>(std::lround(c.params.plain(bandParam(b, fType)))), sr_, c.params.plain(bandParam(b, fFreq)),
                       c.params.plain(bandParam(b, fGain)), c.params.plain(bandParam(b, fQ)), own > 0 ? own - 1 : globalSlope, bc[b]);
        }
        const float y0 = Kit::yForDb(pr, 0.0, -kDbRange, kDbRange);
        for (int i = 0; i < kCurve; ++i) {
            const float x = pr.l + pr.w() * i / (kCurve - 1);
            const double f = Kit::freqForX(pr, x);
            double tot = 0.0, sel = 0.0;
            for (int b = 0; b < kBands; ++b) {
                if (!active[b]) continue;
                const double d = bandResponseDb(bc[b], sr_, f);
                tot += d;
                if (b == sel_) sel = d;
            }
            tot += c.params.plain(kOutput);
            curve_[static_cast<size_t>(i)] = { x, Kit::yForDb(pr, tot, -kDbRange - 6, kDbRange + 6) };
            selCurve_[static_cast<size_t>(i)] = { x, Kit::yForDb(pr, sel, -kDbRange - 6, kDbRange + 6) };
        }
        if (active[sel_]) {
            // relleno aporte de la banda seleccionada hacia la línea de 0 dB
            for (int i = 1; i < kCurve; ++i) {
                const Pt& a = selCurve_[static_cast<size_t>(i - 1)];
                const Pt& b = selCurve_[static_cast<size_t>(i)];
                const float top = std::min(std::min(a.y, b.y), y0), bot = std::max(std::max(a.y, b.y), y0);
                if (bot - top > 0.5f) g.fillRect({ a.x, top, b.x + 0.4f, bot }, Pal::cian.withAlpha(0.10f));
            }
        }
        Kit::wireTrace(g, curve_.data(), kCurve, Pal::cian, pr.b, false);
        // nodos de las bandas usadas
        for (int b = 0; b < kBands; ++b) {
            if (!isUsed(c, b)) continue;
            const Pt p = nodePos(c, b);
            const bool locked = c.params.locked(bandParam(b, fFreq));
            const bool on = c.params.plain(bandParam(b, fOn)) >= 0.5;
            const Color col = locked ? Pal::bloqueado : Pal::cian;
            if (b == sel_ && !locked) { g.circle(p.x, p.y, 11.0f, Pal::cianGlow, 4.0f); g.circle(p.x, p.y, 9.0f, Pal::cian, 1.0f); }
            if (on && !locked) { g.glowDot(p.x, p.y, 6.0f, col.withAlpha(0.9f)); g.fillCircle(p.x, p.y, 2.6f, Pal::cianNucleo); }
            else { g.fillCircle(p.x, p.y, 6.0f, hex(0x090B24)); g.circle(p.x, p.y, 6.0f, col.withAlpha(0.7f), 1.2f); }
            wchar_t n[4];
            swprintf_s(n, L"%d", b + 1);
            g.text(n, { p.x + 7, p.y - 18, p.x + 24, p.y - 6 }, Font::ValueSmall, locked ? Pal::bloqueado : Pal::textoValor, Align::Left);
            if (c.params.plain(extParam(b, eSolo)) >= 0.5) g.text(L"S", { p.x + 7, p.y + 4, p.x + 24, p.y + 16 }, Font::ValueSmall, Pal::espectroOut, Align::Left);
            if (locked) Chrome::drawLock(g, p.x, p.y - 1.0f, 7.0f, Pal::bloqueado);
        }
        drawBandMonitor(g, c, pr);
        drawStrip(g, c);
    }

    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        // tira de bandas (mini-panel)
        const auto u = usedBands(c);
        for (int i = 0; i < kStripCells; ++i) {
            const int idx = stripStart_ + i;
            if (idx >= static_cast<int>(u.size())) break;
            if (cellRect(i).contains(e.x, e.y)) { select(u[static_cast<size_t>(idx)]); return false; }
        }
        if (!plotRect().inset(-10).contains(e.x, e.y)) return false;
        const int b = nearestNode(c, e.x, e.y, 14.0f);
        if (b < 0) return false;
        select(b);
        if (c.params.locked(bandParam(b, fFreq))) return false;
        drag_ = b;
        c.params.beginEdit(bandParam(b, fFreq));
        c.params.beginEdit(bandParam(b, fGain));
        return true;
    }
    void vizDrag(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        if (drag_ < 0) return;
        const JasWaveUI::Rect pr = plotRect();
        const double f = JasWaveUI::Kit::freqForX(pr, e.x);
        if (const ParamDef* d = c.params.def(bandParam(drag_, fFreq))) c.params.performEdit(bandParam(drag_, fFreq), toNorm(*d, f));
        const int type = static_cast<int>(std::lround(c.params.plain(bandParam(drag_, fType))));
        if (hasGain(type)) {
            const double db = kDbRange - (e.y - pr.t) / pr.h() * 2.0 * kDbRange;
            if (const ParamDef* d = c.params.def(bandParam(drag_, fGain))) c.params.performEdit(bandParam(drag_, fGain), toNorm(*d, clampT(db, -24.0, 24.0)));
        }
    }
    void vizUp(const JasWaveUI::MouseEvent&, JasWaveUI::EditorContext& c) override {
        if (drag_ < 0) return;
        c.params.endEdit(bandParam(drag_, fFreq));
        c.params.endEdit(bandParam(drag_, fGain));
        drag_ = -1;
    }
    void vizWheel(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        if (!plotRect().contains(e.x, e.y) || c.params.locked(bandParam(sel_, fQ))) return;
        const double q = clampT(c.params.plain(bandParam(sel_, fQ)) * std::pow(1.12, e.wheel), 0.1, 18.0);
        if (const ParamDef* d = c.params.def(bandParam(sel_, fQ))) c.params.setNorm(bandParam(sel_, fQ), toNorm(*d, q));
    }
    // Doble clic: sobre un nodo lo activa/desactiva (con Mayús lo quita); en vacío agrega una banda ahí.
    void vizDouble(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        const int b = nearestNode(c, e.x, e.y, 14.0f);
        if (b >= 0) {
            if (e.shift) { removeBand(b); return; }
            if (c.params.locked(bandParam(b, fOn))) return;
            c.params.setNorm(bandParam(b, fOn), c.params.norm(bandParam(b, fOn)) >= 0.5 ? 0.0 : 1.0);
            return;
        }
        const JasWaveUI::Rect pr = plotRect();
        if (!pr.contains(e.x, e.y)) return;
        addBand(JasWaveUI::Kit::freqForX(pr, e.x), clampT(kDbRange - (e.y - pr.t) / pr.h() * 2.0 * kDbRange, -24.0, 24.0));
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.param-eq"; }
    // Los controles de la sección se reasignan a la banda seleccionada: todas las bandas quedan expuestas
    void parametrosCubiertos(std::vector<uint32_t>& ids) const override {
        for (int b = 0; b < kBands; ++b) {
            for (BandField f : { fType, fFreq, fGain, fQ, fOn }) ids.push_back(bandParam(b, f));
            for (ExtField f : { eUsed, eSlope, eMode, eSolo }) ids.push_back(extParam(b, f));
        }
    }

private:
    static constexpr int kCurve = 300;
    static constexpr int kStripCells = 12;
    static constexpr double kDbRange = 18.0;

    JasWaveUI::Rect plotRect() const { return JasWaveUI::Plantilla::areaEspectro(); }
    // Tercera fila de selectores de la sección de controles (modo, pendiente de la banda)
    static JasWaveUI::Rect fila3(int col, int span) {
        JasWaveUI::Rect r = JasWaveUI::Plantilla::filaSecundaria(col, span);
        r.t += 56.0f; r.b += 56.0f;
        return { r.l, r.t + 2.0f, r.r, r.b - 2.0f };
    }
    // Celda i-ésima VISIBLE de la tira (la tira muestra solo las bandas usadas, en páginas de 12)
    JasWaveUI::Rect cellRect(int i) const {
        const auto m = JasWaveUI::Layout::kMiniPanel;
        const float w = (m.w() - 12.0f - 64.0f) / kStripCells;
        return { m.l + 12 + i * w + 1.5f, m.t + 34, m.l + 12 + (i + 1) * w - 1.5f, m.b - 12 };
    }
    static bool isUsed(JasWaveUI::EditorContext& c, int b) {
        if (b < 0 || b >= kBands) return false;
        return c.params.plain(extParam(b, eUsed)) >= 0.5;
    }
    static std::vector<int> usedBands(JasWaveUI::EditorContext& c) {
        std::vector<int> u;
        for (int b = 0; b < kBands; ++b) if (isUsed(c, b)) u.push_back(b);
        return u;
    }
    JasWaveUI::Pt nodePos(JasWaveUI::EditorContext& c, int b) const {
        const JasWaveUI::Rect pr = plotRect();
        const int type = static_cast<int>(std::lround(c.params.plain(bandParam(b, fType))));
        const double gdb = hasGain(type) ? c.params.plain(bandParam(b, fGain)) : 0.0;
        return { JasWaveUI::Kit::xForFreq(pr, c.params.plain(bandParam(b, fFreq))), JasWaveUI::Kit::yForDb(pr, gdb, -kDbRange, kDbRange) };
    }
    int nearestNode(JasWaveUI::EditorContext& c, float x, float y, float maxD) const {
        int best = -1;
        float bd = maxD * maxD;
        for (int b = 0; b < kBands; ++b) {
            if (!isUsed(c, b)) continue;
            const JasWaveUI::Pt p = nodePos(c, b);
            const float d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
            if (d <= bd) { bd = d; best = b; }
        }
        return best;
    }
    void select(int b) {
        if (b < 0 || b >= kBands) return;
        sel_ = b;
        swprintf_s(bandTitle_, L"BANDA %d", b + 1);
        band_->setTitle(bandTitle_);
        band_->setToggle(static_cast<int>(bandParam(b, fOn)));
        kFreq_->setParam(bandParam(b, fFreq));
        kGain_->setParam(bandParam(b, fGain));
        kQ_->setParam(bandParam(b, fQ));
        type_->setParam(bandParam(b, fType));
        solo_->setParam(extParam(b, eSolo));
        mode_->setParam(extParam(b, eMode));
        slope_->setParam(extParam(b, eSlope));
        // mantener visible la banda en la tira
        if (ctx_) {
            const auto u = usedBands(*ctx_);
            const auto it = std::find(u.begin(), u.end(), b);
            if (it != u.end()) {
                const int idx = static_cast<int>(it - u.begin());
                if (idx < stripStart_) stripStart_ = idx;
                else if (idx >= stripStart_ + kStripCells) stripStart_ = idx - kStripCells + 1;
            }
        }
    }
    void page(int dir) {
        if (!ctx_) return;
        const int total = static_cast<int>(usedBands(*ctx_).size());
        stripStart_ = std::clamp(stripStart_ + dir * kStripCells, 0, std::max(0, total - kStripCells));
    }
    // Frecuencia sugerida para una banda nueva: el hueco más ancho (en octavas) entre las bandas usadas
    double freeFreq() const {
        if (!ctx_) return 1000.0;
        std::vector<double> fs{ 20.0, 20000.0 };
        for (int b = 0; b < kBands; ++b) if (isUsed(*ctx_, b)) fs.push_back(ctx_->params.plain(bandParam(b, fFreq)));
        std::sort(fs.begin(), fs.end());
        double bestGap = 0.0, bestF = 1000.0;
        for (size_t i = 1; i < fs.size(); ++i) {
            const double gap = std::log2(fs[i] / fs[i - 1]);
            if (gap > bestGap) { bestGap = gap; bestF = std::sqrt(fs[i] * fs[i - 1]); }
        }
        return bestF;
    }
    // Alta de banda: primer slot libre y concedido por la licencia; la deja como Peak activa en (freq, gain)
    void addBand(double freq, double gainDb = 0.0) {
        if (!ctx_) return;
        auto& p = ctx_->params;
        int slot = -1;
        for (int b = 0; b < kBands && slot < 0; ++b) if (!isUsed(*ctx_, b) && !p.locked(extParam(b, eUsed))) slot = b;
        if (slot < 0) return;   // sin slots libres (o bandas avanzadas sin licencia)
        auto set = [&](uint32_t id, double plain) { if (const ParamDef* d = p.def(id)) p.setNorm(id, toNorm(*d, plain)); };
        set(bandParam(slot, fType), tPeak);
        set(bandParam(slot, fFreq), clampT(freq, 20.0, 20000.0));
        set(bandParam(slot, fGain), gainDb);
        set(bandParam(slot, fQ), 1.0);
        set(bandParam(slot, fOn), 1);
        set(extParam(slot, eSlope), 0);
        set(extParam(slot, eMode), mStereo);
        set(extParam(slot, eSolo), 0);
        set(extParam(slot, eUsed), 1);
        select(slot);
    }
    void removeBand(int b) {
        if (!ctx_ || !isUsed(*ctx_, b) || ctx_->params.locked(extParam(b, eUsed))) return;
        auto& p = ctx_->params;
        if (const ParamDef* d = p.def(extParam(b, eSolo))) p.setNorm(extParam(b, eSolo), toNorm(*d, 0));
        if (const ParamDef* d = p.def(extParam(b, eUsed))) p.setNorm(extParam(b, eUsed), toNorm(*d, 0));
        const auto u = usedBands(*ctx_);
        for (int nb : u) if (nb != b) { select(nb); break; }
    }
    // Resumen auditable de lo que se cambió respecto al valor de fábrica de la banda
    std::wstring changesText(JasWaveUI::EditorContext& c, int b) const {
        const BandDefault d = bandDefault(b);
        static const wchar_t* kT[] = { L"HPF", L"LOW SH", L"PEAK", L"HIGH SH", L"LPF", L"NOTCH", L"BP" };
        static const wchar_t* kM[] = { L"ST", L"MID", L"SIDE", L"L", L"R" };
        std::wstring s;
        wchar_t buf[48];
        auto add = [&](const wchar_t* t) { if (!s.empty()) s += L" · "; s += t; };
        const int type = static_cast<int>(std::lround(c.params.plain(bandParam(b, fType))));
        const double f = c.params.plain(bandParam(b, fFreq)), gdb = c.params.plain(bandParam(b, fGain)), q = c.params.plain(bandParam(b, fQ));
        if (type != d.type) { swprintf_s(buf, L"TIPO %s", kT[std::clamp(type, 0, kTypeCount - 1)]); add(buf); }
        if (std::fabs(std::log(f / d.freq)) > 0.01) { swprintf_s(buf, f >= 1000.0 ? L"FREQ %.2f kHz" : L"FREQ %.0f Hz", f >= 1000.0 ? f / 1000.0 : f); add(buf); }
        if (std::fabs(gdb) > 0.04) { swprintf_s(buf, L"GAIN %+.1f dB", gdb); add(buf); }
        if (std::fabs(q - d.q) > 0.005) { swprintf_s(buf, L"Q %.2f", q); add(buf); }
        const int mode = static_cast<int>(std::lround(c.params.plain(extParam(b, eMode))));
        if (mode != mStereo) { swprintf_s(buf, L"MODO %s", kM[std::clamp(mode, 0, kModeCount - 1)]); add(buf); }
        const int own = static_cast<int>(std::lround(c.params.plain(extParam(b, eSlope))));
        if (own > 0) { swprintf_s(buf, L"PEND %d dB/oct", own * 12); add(buf); }
        if (s.empty()) s = L"valores de fábrica";
        return s;
    }
    // Monitor de la banda seleccionada: señal real que entra y sale de la banda (en su región) vs el aporte
    // Nivel real de cada banda activa (misma escala dBFS que el espectro): columna en vivo, pico retenido y
    // rango de variación reciente, anclados a la frecuencia de la banda. La seleccionada muestra su cifra.
    void drawNivelesBanda(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c, const JasWaveUI::Rect& pr) {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        if (!analyzerOn_) return;
        for (int b = 0; b < kBands; ++b) {
            if (!isUsed(c, b) || c.params.locked(bandParam(b, fOn)) || c.params.plain(bandParam(b, fOn)) < 0.5) continue;
            const P::NivelVivo& n = bNivel_[static_cast<size_t>(b)];
            if (!n.hay()) continue;
            const float x = Kit::xForFreq(pr, c.params.plain(bandParam(b, fFreq)));
            const bool sel = b == sel_;
            const float yN = P::yDbfs(pr, n.actual), yP = P::yDbfs(pr, n.pico);
            const float aLpha = sel ? 1.0f : 0.6f;
            g.fillRect({ x - 4.0f, yN, x + 4.0f, pr.b }, Pal::espectroIn.withAlpha(0.28f * aLpha));
            g.line(x - 6.0f, yP, x + 6.0f, yP, Pal::textoValor.withAlpha(aLpha), 1.4f);
            const float yHi = P::yDbfs(pr, n.maximo), yLo = P::yDbfs(pr, n.minimo);
            if (yLo - yHi > 1.0f) {
                g.line(x + 8.0f, yHi, x + 8.0f, yLo, Pal::cian.withAlpha(0.75f * aLpha), 1.6f);
                g.line(x + 6.0f, yHi, x + 10.0f, yHi, Pal::cian.withAlpha(0.75f * aLpha), 1.2f);
                g.line(x + 6.0f, yLo, x + 10.0f, yLo, Pal::cian.withAlpha(0.75f * aLpha), 1.2f);
            }
            if (sel) {
                wchar_t buf[64];
                swprintf_s(buf, L"%.0f dB  ±%.1f", n.actual, (n.maximo - n.minimo) * 0.5f);
                g.text(buf, { x + 12.0f, yN - 8.0f, x + 120.0f, yN + 6.0f }, Font::ValueSmall, Pal::textoValor, Align::Left);
            }
        }
    }
    void drawBandMonitor(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c, const JasWaveUI::Rect& pr) {
        using namespace JasWaveUI;
        if (!isUsed(c, sel_)) return;
        const float in = bIn_[static_cast<size_t>(sel_)], out = bOut_[static_cast<size_t>(sel_)];
        const bool hay = in > -100.0f;
        wchar_t buf[160];
        const Rect r{ pr.l + 6, pr.t + 4, pr.l + 330, pr.t + 40 };
        g.fillRect(r, hex(0x090B24, 0.72f));
        g.strokeRect(r, Pal::panelBorde, 1.0f);
        if (hay) swprintf_s(buf, L"B%d  IN %.1f dB  OUT %.1f dB  APORTE %+.1f dB", sel_ + 1, in, out, out - in);
        else swprintf_s(buf, L"B%d  sin señal en la banda", sel_ + 1);
        g.text(buf, { r.l + 6, r.t + 2, r.r - 4, r.t + 17 }, Font::ValueSmall, Pal::textoValor, Align::Left);
        g.text(L"AJUSTES: " + changesText(c, sel_), { r.l + 6, r.t + 18, r.r - 4, r.t + 33 }, Font::ValueSmall, Pal::textoTenue, Align::Left);
    }
    void drawStrip(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) {
        using namespace JasWaveUI;
        Plantilla::panelMedicion(g, L"BANDAS · SEÑAL REAL vs APORTE");
        static const wchar_t* kShort[] = { L"HPF", L"LSH", L"PEAK", L"HSH", L"LPF", L"NOTCH", L"BP" };
        const auto u = usedBands(c);
        auto bar = [&](const Rect& r, float db, Color col) {
            const float v = std::clamp((db + 90.0f) / 80.0f, 0.0f, 1.0f);
            g.fillRect(r, col.withAlpha(0.10f));
            if (v > 0.0f) g.fillRect({ r.l, r.t, r.l + r.w() * v, r.b }, col.withAlpha(0.9f));
        };
        for (int i = 0; i < kStripCells; ++i) {
            const int idx = stripStart_ + i;
            if (idx >= static_cast<int>(u.size())) break;
            const int b = u[static_cast<size_t>(idx)];
            const Rect r = cellRect(i);
            const bool locked = c.params.locked(bandParam(b, fOn));
            const bool on = c.params.plain(bandParam(b, fOn)) >= 0.5;
            const bool sel = b == sel_;
            g.fillChamfer(r, 4.0f, sel ? hex(0x1A1F5C, 0.9f) : hex(0x0A0C26, 0.85f));
            g.strokeChamfer(r, 4.0f, locked ? Pal::bloqueado.withAlpha(0.6f) : sel ? Pal::cian : Pal::panelBorde, 1.0f);
            wchar_t buf[32];
            swprintf_s(buf, L"%d", b + 1);
            const Color tc = locked ? Pal::bloqueado : (on ? Pal::textoTitulo : Pal::textoTenue);
            g.text(buf, { r.l + 4, r.t + 2, r.l + 24, r.t + 16 }, Font::Section, tc, Align::Left);
            if (on && !locked) g.glowDot(r.r - 8, r.t + 9, 2.2f, Pal::cian);
            else g.circle(r.r - 8, r.t + 9, 2.2f, tc, 1.0f);
            const int type = static_cast<int>(std::lround(c.params.plain(bandParam(b, fType))));
            g.text(kShort[std::clamp(type, 0, kTypeCount - 1)], { r.l + 2, r.t + 17, r.r - 2, r.t + 30 }, Font::Label, locked ? Pal::bloqueado : Pal::textoEtiqueta, Align::Center, true);
            const double f = c.params.plain(bandParam(b, fFreq));
            if (f >= 1000.0) swprintf_s(buf, L"%.1fk", f / 1000.0); else swprintf_s(buf, L"%.0f", f);
            g.text(buf, { r.l + 1, r.t + 30, r.r - 1, r.t + 43 }, Font::ValueSmall, locked ? Pal::bloqueado : Pal::textoValor, Align::Center);
            if (hasGain(type)) swprintf_s(buf, L"%+.1f", c.params.plain(bandParam(b, fGain)));
            else swprintf_s(buf, L"Q%.1f", c.params.plain(bandParam(b, fQ)));
            g.text(buf, { r.l + 1, r.t + 43, r.r - 1, r.t + 56 }, Font::ValueSmall, locked ? Pal::bloqueado : Pal::textoTenue, Align::Center);
            if (locked) { Chrome::drawLock(g, r.cx(), r.b - 10, 8.0f, Pal::bloqueado); continue; }
            // señal real de la banda: entrada y salida (barras) y aporte medido (Δ = salida − entrada)
            const float in = bIn_[static_cast<size_t>(b)], out = bOut_[static_cast<size_t>(b)];
            const bool hay = on && in > -100.0f;
            bar({ r.l + 4, r.t + 60, r.r - 4, r.t + 65 }, hay ? in : -120.0f, Pal::espectroIn);
            bar({ r.l + 4, r.t + 68, r.r - 4, r.t + 73 }, hay ? out : -120.0f, Pal::espectroOut);
            if (hay) swprintf_s(buf, L"%+.1f", out - in); else swprintf_s(buf, L"—");
            g.text(buf, { r.l + 1, r.t + 75, r.r - 1, r.b - 1 }, Font::ValueSmall, hay && std::fabs(out - in) > 0.3f ? Pal::cianNucleo : Pal::textoTenue, Align::Center);
        }
        if (u.empty()) g.text(L"Sin bandas: doble clic en el gráfico o + BANDA", { 70, 470, 600, 490 }, Font::Label, Pal::textoTenue, Align::Left);
        wchar_t pg[24];
        swprintf_s(pg, L"%d / %d", static_cast<int>(u.size()), kBands);
        const auto m = Layout::kMiniPanel;
        g.text(pg, { m.r - 62, m.t + 106, m.r - 8, m.t + 120 }, Font::ValueSmall, Pal::textoTenue, Align::Center);
    }

    JasWaveUI::EditorContext* ctx_{nullptr};
    std::shared_ptr<EqBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    std::array<JasWaveUI::Pt, kCurve> curve_{}, selCurve_{};
    std::array<float, kBands> bIn_{}, bOut_{};
    std::array<JasWaveUI::Plantilla::NivelVivo, kBands> bNivel_{};
    JasWaveUI::Section* band_{nullptr};
    JasWaveUI::Knob *kFreq_{nullptr}, *kGain_{nullptr}, *kQ_{nullptr};
    JasWaveUI::Dropdown *type_{nullptr}, *mode_{nullptr}, *slope_{nullptr};
    JasWaveUI::Toggle* solo_{nullptr};
    wchar_t bandTitle_[32] = L"BANDA 1";
    double sr_{48000.0};
    int sel_{0}, drag_{-1}, stripStart_{0};
    bool analyzerOn_{false}, preOn_{false};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override {
        return { { bandParam(0, fOn), 1 },       { bandParam(0, fFreq), 38 },  { bandParam(1, fGain), 3.0 },  { bandParam(2, fFreq), 340 },
                 { bandParam(2, fGain), -4.5 },  { bandParam(2, fQ), 1.6 },    { bandParam(3, fFreq), 2400 }, { bandParam(3, fGain), 2.5 },
                 { bandParam(3, fQ), 0.8 },      { bandParam(5, fFreq), 6800 }, { bandParam(5, fGain), -3.5 }, { bandParam(5, fQ), 4.0 },
                 { bandParam(6, fGain), 2.5 },   { kSlope, 1 },                { kAnalyzer, 2 },
                 { extParam(8, eUsed), 1 },      { bandParam(8, fFreq), 800 }, { bandParam(8, fGain), -2.0 }, { bandParam(8, fQ), 2.0 },
                 { extParam(9, eUsed), 1 },      { bandParam(9, fFreq), 4500 }, { bandParam(9, fGain), 1.5 }, { bandParam(9, fQ), 1.2 } };
    }
protected:
    LegacyStateFn legacyState() override {
        return [](IBStream* st, const ParamTable& t, std::vector<double>& n) { return readLegacyDoubles(st, t, n, 42, nullptr); };
    }
};

} // namespace JasWaveEq

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveEq::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave EQ Parametric Pro",
               Vst::kDistributable, Vst::PlugType::kFxEQ, "1.0.0", kVstVersionString, JasWaveEq::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveEq::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave EQ Parametric Pro Controller", 0, "", "1.0.0", kVstVersionString, JasWaveEq::Controller::createInstance)
END_FACTORY
