// JasWave EQ Parametric Pro – VST3 (procesador, controlador, editor Cyber con curva y nodos arrastrables)
#include "param_eq_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveEq {

// FUID estables (los de "JasWave FX EQ" y del EQ previo de plugins/): no cambiar
static const FUID kProcessorUid(0x4A617357, 0x46584551, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x46584551, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "eq.bandas-avanzadas", "Bandas 5–8" },
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
        for (int b = 0; b < kBands; ++b) {
            BandSettings& bs = s.band[static_cast<size_t>(b)];
            bs.type = intOf(bandParam(b, fType));
            bs.freq = plainOf(bandParam(b, fFreq));
            bs.gainDb = plainOf(bandParam(b, fGain));
            bs.q = plainOf(bandParam(b, fQ));
            bs.on = boolOf(bandParam(b, fOn));
        }
        s.outGainDb = plainOf(kOutput);
        s.slopeIdx = intOf(kSlope);
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
    const wchar_t* title() const override { return L"PARAMETRIC EQ"; }
    const wchar_t* subtitle() const override { return L"8 BANDAS · FASE MÍNIMA · LATENCIA 0"; }

    void build(JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        band_ = c.section({ 666, 92, 1048, 404 }, L"BANDA 1", static_cast<int>(bandParam(0, fOn)));
        kFreq_ = c.knob(bandParam(0, fFreq), 742, 178, KnobSize::Main, L"FRECUENCIA");
        kGain_ = c.knob(bandParam(0, fGain), 857, 178, KnobSize::Main, L"GANANCIA");
        kQ_ = c.knob(bandParam(0, fQ), 972, 178, KnobSize::Main, L"Q");
        type_ = c.dropdown(bandParam(0, fType), { 690, 290, 900, 312 }, L"TIPO");
        c.section({ 666, 418, 1048, 556 }, L"SALIDA", kBypass, true);
        c.fader(kOutput, { 682, 440, 730, 552 }, L"OUT");
        c.dropdown(kSlope, { 748, 456, 960, 476 }, L"PENDIENTE");
        c.dropdown(kAnalyzer, { 748, 490, 960, 510 }, L"ANALIZADOR");
        meters_.build(c, 976.0f, 446.0f, 528.0f);
        select(0);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<EqBus>(c.params.bus());
        if (!bus_) return;
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        meters_.update(bus_->inPk, bus_->outPk);
        const int an = bus_->analyzer.load(std::memory_order_relaxed);
        analyzerOn_ = an > 0 && c.params.featureGranted(kFeatAnalyzer);
        preOn_ = analyzerOn_ && an >= 2;
        if (analyzerOn_) {
            post_.update(bus_->post, sr_);
            post_.columns(colsPost_, kCols, 20.0, 20000.0, 4.5);
            if (preOn_) { pre_.update(bus_->pre, sr_); pre_.columns(colsPre_, kCols, 20.0, 20000.0, 4.5); }
        }
    }
    float outputLevel() const override { return meters_.level(); }

    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        const Rect v = Layout::kVisualizer;
        Kit::panel(g, v, L"RESPUESTA · ANALIZADOR");
        meters_.drawLabels(g);
        const Rect pr = plotRect();
        Kit::freqAxis(g, pr);
        Kit::dbAxis(g, pr, -kDbRange, kDbRange, 6.0);
        // analizador
        if (analyzerOn_ && colsPost_.size() == static_cast<size_t>(kCols)) {
            if (preOn_ && colsPre_.size() == static_cast<size_t>(kCols)) {
                for (int i = 0; i < kCols; ++i) pts_[static_cast<size_t>(i)] = { pr.l + pr.w() * (i + 0.5f) / kCols, specY(pr, colsPre_[static_cast<size_t>(i)]) };
                g.polyline(pts_.data(), kCols, Pal::textoTenue.withAlpha(0.7f), 1.0f);
            }
            for (int i = 0; i < kCols; ++i) pts_[static_cast<size_t>(i)] = { pr.l + pr.w() * (i + 0.5f) / kCols, specY(pr, colsPost_[static_cast<size_t>(i)]) };
            g.fillUnder(pts_.data(), kCols, pr.b, Pal::cian.withAlpha(0.08f));
            g.polyline(pts_.data(), kCols, Pal::cian.withAlpha(0.35f), 1.0f);
        }
        // curvas: banda seleccionada (relleno) y total (hilo con glow + ecos)
        BandCoefs bc[kBands];
        bool active[kBands];
        for (int b = 0; b < kBands; ++b) {
            active[b] = c.params.plain(bandParam(b, fOn)) >= 0.5 && !c.params.locked(bandParam(b, fOn));
            const int slope = c.params.locked(kSlope) ? 0 : static_cast<int>(std::lround(c.params.plain(kSlope)));
            designBand(static_cast<int>(std::lround(c.params.plain(bandParam(b, fType)))), sr_, c.params.plain(bandParam(b, fFreq)),
                       c.params.plain(bandParam(b, fGain)), c.params.plain(bandParam(b, fQ)), slope, bc[b]);
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
            // relleno de la banda seleccionada hacia la línea de 0 dB
            for (int i = 1; i < kCurve; ++i) {
                const Pt& a = selCurve_[static_cast<size_t>(i - 1)];
                const Pt& b = selCurve_[static_cast<size_t>(i)];
                const float top = std::min(std::min(a.y, b.y), y0), bot = std::max(std::max(a.y, b.y), y0);
                if (bot - top > 0.5f) g.fillRect({ a.x, top, b.x + 0.4f, bot }, Pal::cian.withAlpha(0.10f));
            }
        }
        Kit::wireTrace(g, curve_.data(), kCurve, Pal::cian, pr.b, false);
        // nodos
        for (int b = 0; b < kBands; ++b) {
            const Pt p = nodePos(c, b);
            const bool locked = c.params.locked(bandParam(b, fFreq));
            const bool on = c.params.plain(bandParam(b, fOn)) >= 0.5;
            const Color col = locked ? Pal::bloqueado : Pal::cian;
            if (b == sel_ && !locked) { g.circle(p.x, p.y, 11.0f, Pal::cianGlow, 4.0f); g.circle(p.x, p.y, 9.0f, Pal::cian, 1.0f); }
            if (on && !locked) { g.glowDot(p.x, p.y, 6.0f, col.withAlpha(0.9f)); g.fillCircle(p.x, p.y, 2.6f, Pal::cianNucleo); }
            else { g.fillCircle(p.x, p.y, 6.0f, hex(0x07121A)); g.circle(p.x, p.y, 6.0f, col.withAlpha(0.7f), 1.2f); }
            wchar_t n[4];
            swprintf_s(n, L"%d", b + 1);
            g.text(n, { p.x + 7, p.y - 18, p.x + 24, p.y - 6 }, Font::ValueSmall, locked ? Pal::bloqueado : Pal::textoValor, Align::Left);
            if (locked) Chrome::drawLock(g, p.x, p.y - 1.0f, 7.0f, Pal::bloqueado);
        }
        drawStrip(g, c);
    }

    bool vizDown(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        // tira de bandas (mini-panel)
        for (int b = 0; b < kBands; ++b)
            if (cellRect(b).contains(e.x, e.y)) { select(b); return false; }
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
    void vizDouble(const JasWaveUI::MouseEvent& e, JasWaveUI::EditorContext& c) override {
        const int b = nearestNode(c, e.x, e.y, 14.0f);
        if (b < 0 || c.params.locked(bandParam(b, fOn))) return;
        c.params.setNorm(bandParam(b, fOn), c.params.norm(bandParam(b, fOn)) >= 0.5 ? 0.0 : 1.0);
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.param-eq"; }

private:
    static constexpr int kCols = 220;
    static constexpr int kCurve = 300;
    static constexpr double kDbRange = 18.0;

    JasWaveUI::Rect plotRect() const { const auto v = JasWaveUI::Layout::kVisualizer; return { v.l + 14, v.t + 32, v.r - 40, v.b - 22 }; }
    JasWaveUI::Rect cellRect(int b) const {
        const auto m = JasWaveUI::Layout::kMiniPanel;
        const float w = (m.w() - 24.0f) / kBands;
        return { m.l + 12 + b * w + 2, m.t + 34, m.l + 12 + (b + 1) * w - 2, m.b - 12 };
    }
    float specY(const JasWaveUI::Rect& pr, float db) const {
        return pr.b - std::clamp((db + 90.0f) / 84.0f, 0.0f, 1.0f) * pr.h();
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
            const JasWaveUI::Pt p = nodePos(c, b);
            const float d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
            if (d <= bd) { bd = d; best = b; }
        }
        return best;
    }
    void select(int b) {
        sel_ = b;
        swprintf_s(bandTitle_, L"BANDA %d", b + 1);
        band_->setTitle(bandTitle_);
        band_->setToggle(static_cast<int>(bandParam(b, fOn)));
        kFreq_->setParam(bandParam(b, fFreq));
        kGain_->setParam(bandParam(b, fGain));
        kQ_->setParam(bandParam(b, fQ));
        type_->setParam(bandParam(b, fType));
    }
    void drawStrip(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) {
        using namespace JasWaveUI;
        const Rect m = Layout::kMiniPanel;
        Kit::panel(g, m, L"BANDAS");
        static const wchar_t* kShort[] = { L"HPF", L"LOW SH", L"PEAK", L"HIGH SH", L"LPF", L"NOTCH" };
        for (int b = 0; b < kBands; ++b) {
            const Rect r = cellRect(b);
            const bool locked = c.params.locked(bandParam(b, fOn));
            const bool on = c.params.plain(bandParam(b, fOn)) >= 0.5;
            const bool sel = b == sel_;
            g.fillChamfer(r, 4.0f, sel ? hex(0x0E2C38, 0.9f) : hex(0x08131B, 0.85f));
            g.strokeChamfer(r, 4.0f, locked ? Pal::bloqueado.withAlpha(0.6f) : sel ? Pal::cian : Pal::panelBorde, 1.0f);
            wchar_t buf[32];
            swprintf_s(buf, L"%d", b + 1);
            const Color tc = locked ? Pal::bloqueado : (on ? Pal::textoTitulo : Pal::textoTenue);
            g.text(buf, { r.l + 6, r.t + 4, r.l + 24, r.t + 20 }, Font::Section, tc, Align::Left);
            if (on && !locked) g.glowDot(r.r - 10, r.t + 12, 2.5f, Pal::cian);
            else g.circle(r.r - 10, r.t + 12, 2.5f, tc, 1.0f);
            const int type = static_cast<int>(std::lround(c.params.plain(bandParam(b, fType))));
            g.text(kShort[std::clamp(type, 0, 5)], { r.l + 4, r.t + 24, r.r - 4, r.t + 40 }, Font::Label, locked ? Pal::bloqueado : Pal::textoEtiqueta, Align::Center, true);
            const double f = c.params.plain(bandParam(b, fFreq));
            if (f >= 1000.0) swprintf_s(buf, L"%.1fk", f / 1000.0); else swprintf_s(buf, L"%.0f", f);
            g.text(buf, { r.l + 2, r.t + 42, r.r - 2, r.t + 58 }, Font::ValueSmall, locked ? Pal::bloqueado : Pal::textoValor, Align::Center);
            if (hasGain(type)) swprintf_s(buf, L"%+.1f", c.params.plain(bandParam(b, fGain)));
            else swprintf_s(buf, L"Q %.2f", c.params.plain(bandParam(b, fQ)));
            g.text(buf, { r.l + 2, r.t + 58, r.r - 2, r.t + 74 }, Font::ValueSmall, locked ? Pal::bloqueado : Pal::textoTenue, Align::Center);
            if (locked) Chrome::drawLock(g, r.cx(), r.b - 14, 9.0f, Pal::bloqueado);
        }
    }

    std::shared_ptr<EqBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveDsp::SpectrumAnalyzer post_, pre_;
    std::vector<float> colsPost_, colsPre_;
    std::array<JasWaveUI::Pt, kCols> pts_{};
    std::array<JasWaveUI::Pt, kCurve> curve_{}, selCurve_{};
    JasWaveUI::Section* band_{nullptr};
    JasWaveUI::Knob *kFreq_{nullptr}, *kGain_{nullptr}, *kQ_{nullptr};
    JasWaveUI::Dropdown* type_{nullptr};
    wchar_t bandTitle_[32] = L"BANDA 1";
    double sr_{48000.0};
    int sel_{0}, drag_{-1};
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
                 { bandParam(6, fGain), 2.5 },   { kSlope, 1 },                { kAnalyzer, 2 } };
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
