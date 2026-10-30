// JasWave StompLab – VST3 (procesador, controlador, editor Cyber con la cadena de pedales iluminada)
#include "stomp_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

#include <cstdio>

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveStomp {

static const FUID kProcessorUid(0x4A617357, 0x53544D50, 0x50726F63, 0x56335431);   // "JasW" "STMP" "Proc" "V3T1"
static const FUID kControllerUid(0x4A617357, 0x53544D50, 0x436E7472, 0x56335431);  // "JasW" "STMP" "Cntr" "V3T1"

static const PluginDescriptor kDesc{ "com.jaswave.plugin.stomplab", "JasWave StompLab", L"STOMPLAB", nullptr, 0, false };

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) { registerBus(sbus_ = std::make_shared<StompBus>()); }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.clear(); }
    void updateParams() override {
        Settings s;
        s.bypass = boolOf(kBypass) || !licensed();   // sin licencia: paso limpio
        s.inDb = static_cast<float>(plainOf(kInGain));
        s.outDb = static_cast<float>(plainOf(kOutGain));
        s.mix = static_cast<float>(plainOf(kMix) / 100.0);
        s.gateOn = boolOf(kGateOn); s.gateThr = static_cast<float>(plainOf(kGateThresh)); s.gateRel = static_cast<float>(plainOf(kGateRelease)); s.gateRange = static_cast<float>(plainOf(kGateRange));
        s.compOn = boolOf(kCompOn); s.compThr = static_cast<float>(plainOf(kCompThresh)); s.compRatio = static_cast<float>(plainOf(kCompRatio));
        s.compAtk = static_cast<float>(plainOf(kCompAttack)); s.compRel = static_cast<float>(plainOf(kCompRelease)); s.compMakeup = static_cast<float>(plainOf(kCompMakeup));
        s.compBlend = static_cast<float>(plainOf(kCompBlend) / 100.0); s.compKnee = static_cast<float>(plainOf(kCompKnee));
        s.odOn = boolOf(kOdOn); s.odModel = intOf(kOdModel); s.odDrive = static_cast<float>(plainOf(kOdDrive) / 100.0); s.odTone = static_cast<float>(plainOf(kOdTone)); s.odLevel = static_cast<float>(plainOf(kOdLevel));
        s.preOn = boolOf(kPreOn); s.preCh = intOf(kPreChannel); s.preGain = static_cast<float>(plainOf(kPreGain) / 100.0);
        s.preBass = static_cast<float>(plainOf(kPreBass)); s.preMid = static_cast<float>(plainOf(kPreMid)); s.preTreble = static_cast<float>(plainOf(kPreTreble));
        s.prePres = static_cast<float>(plainOf(kPrePresence) / 100.0); s.preMaster = static_cast<float>(plainOf(kPreMaster)); s.preSag = static_cast<float>(plainOf(kPreSag) / 100.0);
        s.preBright = boolOf(kPreBright);
        s.cabOn = boolOf(kCabOn); s.cabModel = intOf(kCabModel); s.cabLow = static_cast<float>(plainOf(kCabLow)); s.cabHigh = static_cast<float>(plainOf(kCabHigh)); s.cabMix = static_cast<float>(plainOf(kCabMix) / 100.0);
        s.choOn = boolOf(kChoOn); s.choRate = static_cast<float>(plainOf(kChoRate)); s.choDepth = static_cast<float>(plainOf(kChoDepth) / 100.0); s.choMix = static_cast<float>(plainOf(kChoMix) / 100.0);
        s.dlyOn = boolOf(kDlyOn); s.dlyTime = static_cast<float>(plainOf(kDlyTime)); s.dlyFb = static_cast<float>(plainOf(kDlyFeedback) / 100.0);
        s.dlyTone = static_cast<float>(plainOf(kDlyTone)); s.dlyMix = static_cast<float>(plainOf(kDlyMix) / 100.0); s.dlyMode = intOf(kDlyMode);
        s.shiOn = boolOf(kShiOn); s.shiMix = static_cast<float>(plainOf(kShiMix) / 100.0); s.shiDecay = static_cast<float>(plainOf(kShiDecay));
        s.shiAmt = static_cast<float>(plainOf(kShiAmount) / 100.0); s.shiDamp = static_cast<float>(plainOf(kShiDamping));
        engine_.set(s);
    }
    template <class T>
    void paso(const T* iL, const T* iR, T* oL, T* oR, int n) {
        float pi = 0.0f;
        for (int i = 0; i < n; ++i) pi = std::max(pi, static_cast<float>(std::max(std::fabs(iL[i]), std::fabs(iR[i]))));
        sbus_->inPk[0].update(pi); sbus_->inPk[1].update(pi);
        sbus_->entrada(iL, iR, n);
        engine_.process(iL, iR, oL, oR, n);
        float po = 0.0f;
        for (int i = 0; i < n; ++i) po = std::max(po, static_cast<float>(std::max(std::fabs(oL[i]), std::fabs(oR[i]))));
        sbus_->outPk[0].update(po); sbus_->outPk[1].update(po);
        sbus_->salida(oL, oR, n);
        sbus_->gateGr.store(engine_.gateGrDb(), std::memory_order_relaxed);
        sbus_->compGr.store(engine_.compGrDb(), std::memory_order_relaxed);
    }
    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override { paso(iL, iR, oL, oR, n); }
    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override { paso(iL, iR, oL, oR, n); }
    uint32 latencySamples() override { return static_cast<uint32>(engine_.latency()); }
    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 8.0); }   // delay y shimmer
    void writeOutputParams(ProcessData& data) override {
        writeOutputParam(data, kMeterGate, engine_.gateGrDb() / 80.0);
        writeOutputParam(data, kMeterComp, engine_.compGrDb() / 24.0);
    }

private:
    Engine engine_;
    std::shared_ptr<StompBus> sbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"STOMPLAB"; }
    const wchar_t* subtitle() const override { return L"GATE · COMP · DRIVE · AMP · CABINA IR · CHORUS · DELAY · SHIMMER"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoMagenta; }
    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"PEDALERA");
        P::principal(c, 0, kOdDrive, L"DRIVE");
        P::principal(c, 1, kPreGain, L"AMP GAIN");
        P::principal(c, 2, kDlyMix, L"DELAY");
        P::interruptor(c, 0, 1, kGateOn, L"GATE");
        P::interruptor(c, 1, 1, kCompOn, L"COMP");
        P::interruptor(c, 2, 1, kOdOn, L"DRIVE");
        P::salida(c, kBypass, L"SALIDA · PEDALERA");
        P::fader(c, kOutGain, L"SALIDA");
        P::interruptorSalida(c, 0, 0, 1, kPreOn, L"AMP");
        P::interruptorSalida(c, 1, 0, 1, kCabOn, L"CABINA");
        P::interruptorSalida(c, 2, 0, 1, kChoOn, L"CHORUS");
        P::interruptorSalida(c, 0, 1, 1, kDlyOn, L"DELAY");
        P::interruptorSalida(c, 1, 1, 1, kShiOn, L"SHIMMER");
        P::interruptorSalida(c, 2, 1, 1, kPreBright, L"BRIGHT");
        P::medidores(c, meters_);
    }
    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<StompBus>(c.params.bus());
        if (!bus_) return;
        sr_ = bus_->sampleRate.load(std::memory_order_relaxed);
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt);
        const float k = std::min(1.0f, c.dt * 10.0f);
        gate_ += (bus_->gateGr.load(std::memory_order_relaxed) - gate_) * k;
        comp_ += (bus_->compGr.load(std::memory_order_relaxed) - comp_) * k;
        gatePk_ = std::max(gatePk_ - JasWaveUI::Kit::kCaidaDbS * c.dt, gate_);
        compPk_ = std::max(compPk_ - JasWaveUI::Kit::kCaidaDbS * c.dt, comp_);
    }
    float outputLevel() const override { return meters_.level(); }
    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        using namespace JasWaveUI;
        namespace P = Plantilla;
        const Color ac = accent();
        P::panelVisual(g, L"CADENA DE PEDALES · ESPECTRO IN / OUT");
        meters_.drawLabels(g);
        const Rect v = P::areaEspectro();
        // tira de módulos (8 pedales): iluminados cuando están activos
        struct Mod { uint32_t on; const wchar_t* nombre; };
        static const Mod mods[8] = { { kGateOn, L"GATE" }, { kCompOn, L"COMP" }, { kOdOn, L"DRIVE" }, { kPreOn, L"AMP" }, { kCabOn, L"CABINA" }, { kChoOn, L"CHORUS" }, { kDlyOn, L"DELAY" }, { kShiOn, L"SHIM" } };
        const float bw = (v.w() - 7 * 6.0f) / 8.0f;
        for (int i = 0; i < 8; ++i) {
            const bool on = c.params.plain(mods[i].on) >= 0.5;
            const Rect r{ v.l + i * (bw + 6.0f), v.t + 4.0f, v.l + i * (bw + 6.0f) + bw, v.t + 40.0f };
            g.fillChamfer(r, 4.0f, hex(0x080A22, 0.75f));
            g.strokeChamfer(r, 4.0f, on ? ac : Pal::panelBorde, on ? 1.5f : 1.0f);
            if (on) g.glowDot(r.l + 9.0f, r.t + 9.0f, 3.0f, ac); else g.circle(r.l + 9.0f, r.t + 9.0f, 2.5f, Pal::textoTenue, 1.0f);
            g.text(mods[i].nombre, { r.l + 16.0f, r.t + 2.0f, r.r - 2.0f, r.t + 16.0f }, Font::Label, on ? ac : Pal::textoTenue, Align::Left, true);
            const wchar_t* sub = L"";
            if (i == 2) sub = nombreModelo(labelsOdModel(), static_cast<int>(std::lround(c.params.plain(kOdModel))), 4);
            else if (i == 3) sub = nombreModelo(labelsPreChannel(), static_cast<int>(std::lround(c.params.plain(kPreChannel))), 2);
            else if (i == 4) sub = nombreModelo(labelsCabModel(), static_cast<int>(std::lround(c.params.plain(kCabModel))), kNumCab - 1);
            else if (i == 6) sub = nombreModelo(labelsDlyMode(), static_cast<int>(std::lround(c.params.plain(kDlyMode))), 2);
            g.text(sub, { r.l + 6.0f, r.t + 18.0f, r.r - 2.0f, r.t + 34.0f }, Font::ValueSmall, on ? Pal::textoValor : Pal::textoTenue, Align::Left);
        }
        const Rect a{ v.l, v.t + 48.0f, v.r, v.b };
        espectro_.dibujar(g, a);

        P::panelMedicion(g, L"REDUCCIÓN DE GANANCIA · GATE / COMPRESOR");
        const Rect h = P::kMiniGrafico;
        g.text(L"GATE", { h.l, h.t + 2.0f, h.l + 60.0f, h.t + 16.0f }, Font::Label, Pal::textoEtiqueta, Align::Left, true);
        P::barraGR(g, { h.l + 64.0f, h.t + 4.0f, h.r - 4.0f, h.t + 14.0f }, gate_, gatePk_, ac, 40.0f);
        g.text(L"COMP", { h.l, h.t + 34.0f, h.l + 60.0f, h.t + 48.0f }, Font::Label, Pal::textoEtiqueta, Align::Left, true);
        P::barraGR(g, { h.l + 64.0f, h.t + 36.0f, h.r - 4.0f, h.t + 46.0f }, comp_, compPk_, ac, 12.0f);
        wchar_t b[48];
        swprintf_s(b, L"%.1f dB", -gate_);
        P::lectura(g, 0, 0, L"GATE", b, ac);
        swprintf_s(b, L"%.1f dB", -comp_);
        P::lectura(g, 1, 0, L"COMP", b, ac);
        swprintf_s(b, L"%.2f ms", sr_ > 0.0 ? kOsLatency * 1000.0 / sr_ : 0.0);
        P::lectura(g, 0, 1, L"LATENCIA", b);
        P::lectura(g, 1, 1, L"OS", L"x2");
    }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.stomplab"; }

private:
    static const wchar_t* nombreModelo(const char* const* labels, int i, int maxI) {
        static wchar_t buf[8][32];
        static int k = 0;
        wchar_t* d = buf[k++ & 7];
        const char* s = labels[std::clamp(i, 0, maxI)];
        int n = 0;
        for (; s[n] && n < 31; ++n) d[n] = static_cast<wchar_t>(static_cast<unsigned char>(s[n]));
        d[n] = 0;
        return d;
    }
    std::shared_ptr<StompBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
    float gate_{0}, comp_{0}, gatePk_{0}, compPk_{0};
    double sr_{48000.0};
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override {
        return { { kGateOn, 1.0 }, { kCompOn, 1.0 }, { kOdOn, 1.0 }, { kOdDrive, 60.0 }, { kPreOn, 1.0 }, { kCabOn, 1.0 }, { kDlyOn, 1.0 }, { kShiOn, 1.0 } };
    }
};

} // namespace JasWaveStomp

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveStomp::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave StompLab",
               Vst::kDistributable, Vst::PlugType::kFxDistortion, "1.0.0", kVstVersionString, JasWaveStomp::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveStomp::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave StompLab Controller", 0, "", "1.0.0", kVstVersionString, JasWaveStomp::Controller::createInstance)
END_FACTORY
