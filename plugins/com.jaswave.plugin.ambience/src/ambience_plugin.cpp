// JasWave Ambience – VST3 rack worship (reverb FDN, delay sincronizado, shimmer, swell, chorus, trémolo, drive, EQ, estéreo)
#include "ambience_dsp.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveAmbience {

// FUIDs únicos y estables para JasWave Ambience VST3
static const FUID kProcessorUid(0x4A617357, 0x414D4249, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x414D4249, 0x436E7472, 0x56335431);

static const FeatureDef kFeatures[] = {
    { "ambience.reverb", "Reverb de hall FDN modulada con congelado infinito (freeze)" },
    { "ambience.shimmer", "Shimmer granular en el lazo de realimentación" },
    { "ambience.delay", "Delay estéreo ping-pong sincronizado al tempo del DAW" },
    { "ambience.swell", "Envolvente dinámica automática de swell para worship" },
};
static const PluginDescriptor kDesc{ "com.jaswave.plugin.ambience", "JasWave Ambience", L"AMBIENCE", kFeatures, 4, false };

enum ParamId : uint32_t {
    kBypass = 0,
    kInGain = 1,
    kOutGain = 2,
    // Reverb
    kRevMix = 10,
    kRevSize = 11,
    kRevDamp = 12,
    kRevWidth = 13,
    kRevPre = 14,
    kRevLow = 15,
    kRevHigh = 16,
    kRevMod = 17,
    kRevAttack = 18,
    kFreeze = 19,
    // Delay
    kDlyMix = 20,
    kDlyTime = 21,
    kDlyNote = 22,
    kDlyFb = 23,
    kDlyTone = 24,
    kDlyMod = 25,
    kPing = 26,
    kDlyAttack = 27,
    // Shimmer
    kShMix = 30,
    kShSize = 31,
    kShBlend = 32,
    kShTone = 33,
    kShAttack = 34,
    kShInterval = 35,
    // Dinámica
    kSwAttack = 40,
    kSwDepth = 41,
    kComp = 42,
    kTremMix = 43,
    kTremRate = 44,
    kTremDepth = 45,
    // Tono / Drive / Chorus
    kDrive = 50,
    kDriveTone = 51,
    kDriveLevel = 52,
    kChMix = 53,
    kChRate = 54,
    kChDepth = 55,
    // EQ y Estéreo
    kEqLow = 60,
    kEqMid = 61,
    kEqHigh = 62,
    kWidth = 63,
    kBassMono = 64,
    // Preset
    kPresetSelect = 70
};

} // namespace JasWaveAmbience

#include "ambience_presets.h"

namespace JasWaveAmbience {

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static const char* const kDlyNotes[] = { "Libre", "1/2", "1/4", "1/4.", "1/8.", "1/8", "1/8T", "1/16" };
        static const char* const kShIntervals[] = { "+12 semitonos (octava)", "+7 semitonos (quinta)", "+19 semitonos (+octava+5a)", "-12 semitonos (-octava)" };
        static std::vector<std::string> pNames;
        static std::vector<const char*> pLabels;
        pNames.reserve(kNumPresetDefs);
        pLabels.reserve(kNumPresetDefs);
        for (int i = 0; i < kNumPresetDefs; ++i) {
            std::wstring ws(kPresetDefs[i].name);
            pNames.push_back(std::string(ws.begin(), ws.end()));
            pLabels.push_back(pNames.back().c_str());
        }

        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kInGain, "Entrada", "dB", -24.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kOutGain, "Salida", "dB", -24.0, 12.0, 0.0, 1, true));

        // Reverb
        v.push_back(linearP(kRevMix, "Reverb Mix", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(linearP(kRevSize, "Reverb Decay", "s", 0.4, 12.0, 4.2, 1));
        v.push_back(linearP(kRevDamp, "Amortiguación", "%", 0.0, 95.0, 35.0, 0));
        v.push_back(linearP(kRevWidth, "Ancho Reverb", "%", 0.0, 200.0, 100.0, 0));
        v.push_back(linearP(kRevPre, "Pre-delay", "ms", 0.0, 200.0, 24.0, 0));
        v.push_back(linearP(kRevLow, "Corte Graves Reverb", "Hz", 20.0, 800.0, 100.0, 0));
        v.push_back(linearP(kRevHigh, "Corte Agudos Reverb", "Hz", 2000.0, 20000.0, 11000.0, 0));
        v.push_back(linearP(kRevMod, "Modulación Reverb", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(linearP(kRevAttack, "Ataque Reverb", "ms", 0.0, 2000.0, 0.0, 0));
        v.push_back(stepP(kFreeze, "Freeze Reverb", 1, 0, nullptr));

        // Delay
        v.push_back(linearP(kDlyMix, "Delay Mix", "%", 0.0, 100.0, 22.0, 0));
        v.push_back(linearP(kDlyTime, "Delay Tiempo", "ms", 10.0, 2000.0, 480.0, 0));
        v.push_back(stepP(kDlyNote, "Delay Sincro", 7, 4, kDlyNotes)); // 4 = 1/8. (puntillo)
        v.push_back(linearP(kDlyFb, "Delay Feedback", "%", 0.0, 90.0, 35.0, 0));
        v.push_back(linearP(kDlyTone, "Delay Tono", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kDlyMod, "Delay Modulación", "%", 0.0, 100.0, 15.0, 0));
        v.push_back(stepP(kPing, "Ping-Pong", 1, 1, nullptr));
        v.push_back(linearP(kDlyAttack, "Ataque Delay", "ms", 0.0, 2000.0, 0.0, 0));

        // Shimmer
        v.push_back(linearP(kShMix, "Shimmer Mix", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kShSize, "Shimmer Espacio", "%", 0.0, 100.0, 60.0, 0));
        v.push_back(linearP(kShBlend, "Shimmer Realimentación", "%", 0.0, 100.0, 65.0, 0));
        v.push_back(linearP(kShTone, "Shimmer Tono", "%", 0.0, 100.0, 60.0, 0));
        v.push_back(linearP(kShAttack, "Ataque Shimmer", "ms", 0.0, 2000.0, 500.0, 0));
        v.push_back(stepP(kShInterval, "Intervalo Shimmer", 3, 0, kShIntervals));

        // Dinámica & Swell
        v.push_back(linearP(kSwAttack, "Swell Tiempo", "ms", 50.0, 3000.0, 950.0, 0));
        v.push_back(linearP(kSwDepth, "Swell Intensidad", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kComp, "Compresión", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kTremMix, "Trémolo Mix", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kTremRate, "Trémolo Velocidad", "Hz", 0.1, 20.0, 4.5, 1));
        v.push_back(linearP(kTremDepth, "Trémolo Profundidad", "%", 0.0, 100.0, 50.0, 0));

        // Tono / Drive / Chorus
        v.push_back(linearP(kDrive, "Saturación / Drive", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kDriveTone, "Drive Tono", "%", 0.0, 100.0, 55.0, 0));
        v.push_back(linearP(kDriveLevel, "Drive Nivel", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kChMix, "Chorus Mix", "%", 0.0, 100.0, 0.0, 0));
        v.push_back(linearP(kChRate, "Chorus Velocidad", "Hz", 0.05, 5.0, 0.45, 2));
        v.push_back(linearP(kChDepth, "Chorus Profundidad", "%", 0.0, 100.0, 50.0, 0));

        // EQ & Estéreo
        v.push_back(linearP(kEqLow, "EQ Graves", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kEqMid, "EQ Medios", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kEqHigh, "EQ Agudos", "dB", -12.0, 12.0, 0.0, 1, true));
        v.push_back(linearP(kWidth, "Ancho Global", "%", 0.0, 200.0, 100.0, 0));
        v.push_back(linearP(kBassMono, "Graves en Mono", "Hz", 0.0, 300.0, 0.0, 0));

        // Selector de Presets
        v.push_back(stepP(kPresetSelect, "Preset Worship", kNumPresetDefs - 1, 1, pLabels.data()));
        marcarBasicos(v, { kBypass, kOutGain, kRevMix, kRevSize, kDlyMix, kShMix, kWidth, kPresetSelect });   // modo Básico del editor
        return v;
    }();
    return defs;
}

struct AmbienceBus : JasWaveDsp::MeterBusBase {
    JasWaveDsp::PeakMeter inPk[2], outPk[2];
    std::atomic<float> revMeter{0.f}, dlyMeter{0.f};
    std::atomic<int> currentPreset{-1};
};

class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) {
        registerBus(abus_ = std::make_shared<AmbienceBus>());
    }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int) override {
        engine_.prepare(static_cast<float>(sr));
    }
    void resetDsp() override {
        engine_.clear();
    }
    void updateParams() override {
        Settings s;
        s.bypass = boolOf(kBypass) || !licensed();
        s.inDb = static_cast<float>(plainOf(kInGain));
        s.outDb = static_cast<float>(plainOf(kOutGain));

        s.revMix = static_cast<float>(plainOf(kRevMix) / 100.0);
        s.revSize = static_cast<float>(plainOf(kRevSize));
        s.revDamp = static_cast<float>(plainOf(kRevDamp) / 100.0);
        s.revWidth = static_cast<float>(plainOf(kRevWidth) / 100.0);
        s.revPre = static_cast<float>(plainOf(kRevPre));
        s.revLow = static_cast<float>(plainOf(kRevLow));
        s.revHigh = static_cast<float>(plainOf(kRevHigh));
        s.revMod = static_cast<float>(plainOf(kRevMod) / 100.0);
        s.revAttack = static_cast<float>(plainOf(kRevAttack));
        s.freeze = boolOf(kFreeze);

        s.dlyMix = static_cast<float>(plainOf(kDlyMix) / 100.0);
        s.dlyMs = static_cast<float>(plainOf(kDlyTime));
        s.dlyNote = intOf(kDlyNote);
        s.dlyFb = static_cast<float>(plainOf(kDlyFb) / 100.0);
        s.dlyTone = static_cast<float>(plainOf(kDlyTone) / 100.0);
        s.dlyMod = static_cast<float>(plainOf(kDlyMod) / 100.0);
        s.pingPong = boolOf(kPing);
        s.dlyAttack = static_cast<float>(plainOf(kDlyAttack));

        s.shMix = static_cast<float>(plainOf(kShMix) / 100.0);
        s.shSize = static_cast<float>(plainOf(kShSize) / 100.0);
        s.shBlend = static_cast<float>(plainOf(kShBlend) / 100.0);
        s.shTone = static_cast<float>(plainOf(kShTone) / 100.0);
        s.shAttack = static_cast<float>(plainOf(kShAttack));
        s.shInterval = intOf(kShInterval);

        s.swellAttack = static_cast<float>(plainOf(kSwAttack));
        s.swellDepth = static_cast<float>(plainOf(kSwDepth) / 100.0);
        s.comp = static_cast<float>(plainOf(kComp) / 100.0);
        s.tremMix = static_cast<float>(plainOf(kTremMix) / 100.0);
        s.tremRate = static_cast<float>(plainOf(kTremRate));
        s.tremDepth = static_cast<float>(plainOf(kTremDepth) / 100.0);

        s.drive = static_cast<float>(plainOf(kDrive) / 100.0);
        s.driveTone = static_cast<float>(plainOf(kDriveTone) / 100.0);
        s.driveLevel = static_cast<float>(plainOf(kDriveLevel) / 100.0);
        s.chorusMix = static_cast<float>(plainOf(kChMix) / 100.0);
        s.chorusRate = static_cast<float>(plainOf(kChRate));
        s.chorusDepth = static_cast<float>(plainOf(kChDepth) / 100.0);

        s.eqLow = static_cast<float>(plainOf(kEqLow));
        s.eqMid = static_cast<float>(plainOf(kEqMid));
        s.eqHigh = static_cast<float>(plainOf(kEqHigh));
        s.width = static_cast<float>(plainOf(kWidth) / 100.0);
        s.bassMono = static_cast<float>(plainOf(kBassMono));

        engine_.set(s);
    }

    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData& data) override {
        if (data.processContext && (data.processContext->state & ProcessContext::kTempoValid)) {
            engine_.setTempo(data.processContext->tempo);
        }
        float pkInL = 0.f, pkInR = 0.f, pkOutL = 0.f, pkOutR = 0.f;
        for (int i = 0; i < n; ++i) {
            pkInL = std::max(pkInL, std::fabs(iL[i]));
            pkInR = std::max(pkInR, std::fabs(iR[i]));
        }
        abus_->inPk[0].update(pkInL);
        abus_->inPk[1].update(pkInR);
        abus_->entrada(iL, iR, n);

        engine_.process(iL, iR, oL, oR, n);

        for (int i = 0; i < n; ++i) {
            pkOutL = std::max(pkOutL, std::fabs(oL[i]));
            pkOutR = std::max(pkOutR, std::fabs(oR[i]));
        }
        abus_->outPk[0].update(pkOutL);
        abus_->outPk[1].update(pkOutR);
        abus_->salida(oL, oR, n);

        abus_->revMeter.store(engine_.lastReverbLevel(), std::memory_order_relaxed);
        abus_->dlyMeter.store(engine_.lastDelayLevel(), std::memory_order_relaxed);
    }

    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData& data) override {
        if (data.processContext && (data.processContext->state & ProcessContext::kTempoValid)) {
            engine_.setTempo(data.processContext->tempo);
        }
        std::vector<float> inL(n), inR(n), outL(n), outR(n);
        float pkInL = 0.f, pkInR = 0.f, pkOutL = 0.f, pkOutR = 0.f;
        for (int i = 0; i < n; ++i) {
            inL[i] = static_cast<float>(iL[i]);
            inR[i] = static_cast<float>(iR[i]);
            pkInL = std::max(pkInL, std::fabs(inL[i]));
            pkInR = std::max(pkInR, std::fabs(inR[i]));
        }
        abus_->inPk[0].update(pkInL);
        abus_->inPk[1].update(pkInR);
        abus_->entrada(inL.data(), inR.data(), n);

        engine_.process(inL.data(), inR.data(), outL.data(), outR.data(), n);

        for (int i = 0; i < n; ++i) {
            outL[i] = static_cast<float>(oL[i]);
            outR[i] = static_cast<float>(oR[i]);
            pkOutL = std::max(pkOutL, std::fabs(outL[i]));
            pkOutR = std::max(pkOutR, std::fabs(outR[i]));
        }
        abus_->outPk[0].update(pkOutL);
        abus_->outPk[1].update(pkOutR);
        abus_->salida(outL.data(), outR.data(), n);

        abus_->revMeter.store(engine_.lastReverbLevel(), std::memory_order_relaxed);
        abus_->dlyMeter.store(engine_.lastDelayLevel(), std::memory_order_relaxed);
    }

    uint32 tailSamples() override { return static_cast<uint32>(sr_ * 8.0); }

private:
    Engine engine_;
    std::shared_ptr<AmbienceBus> abus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"JASWAVE AMBIENCE"; }
    const wchar_t* subtitle() const override { return L"RACK WORSHIP · REVERB FDN · DELAY SINCRO · SHIMMER · SWELL"; }
    JasWaveUI::Color accent() const override { return JasWaveUI::Pal::acentoCian; }

    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"ESPACIO WORSHIP");

        // Fila principal: Reverb Mix, Decay, Delay Mix
        P::principal(c, 0, kRevMix, L"REVERB");
        P::principal(c, 1, kRevSize, L"DECAY");
        P::principal(c, 2, kDlyMix, L"DELAY");

        // Fila secundaria: Shimmer Mix, Swell Depth, Delay Sincro
        P::secundaria(c, 0, kShMix, L"SHIMMER");
        P::secundaria(c, 1, kSwDepth, L"SWELL");
        P::selector(c, 2, 7, kDlyNote, L"SINCRO");

        // Salida
        P::salida(c, kBypass, L"SALIDA · DINÁMICA");
        P::fader(c, kOutGain, L"VOLUMEN");
        P::perillaSalida(c, 0, kWidth, L"ANCHO");
        P::perillaSalida(c, 1, kFreeze, L"FREEZE");

        P::medidores(c, meters_);
    }

    void tick(JasWaveUI::EditorContext& c) override {
        bus_ = std::dynamic_pointer_cast<AmbienceBus>(c.params.bus());
        if (!bus_) return;
        meters_.update(bus_->inPk, bus_->outPk, c.dt);
        espectro_.actualizar(*bus_, c.dt);
    }

    void drawPanels(JasWaveUI::Gfx& g, JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::panelVisual(g, L"ESPECTRO ESPACIAL · COLA Y REFLEXIONES");
        meters_.drawLabels(g);
        const JasWaveUI::Rect a = P::areaEspectro();
        espectro_.dibujar(g, a);

        // Subpanel de medición e información de preset
        P::panelMedicion(g, L"ESTADO DEL RACK WORSHIP");
        const int pIdx = static_cast<int>(c.params.plain(kPresetSelect));
        const wchar_t* pName = (pIdx >= 0 && pIdx < kNumPresetDefs) ? kPresetDefs[pIdx].name : L"Custom";

        wchar_t bufDecay[32], bufDly[32];
        swprintf_s(bufDecay, L"%.1f s", c.params.plain(kRevSize));
        swprintf_s(bufDly, L"%.0f ms", c.params.plain(kDlyTime));

        P::lectura(g, 0, 0, L"PRESET ACTIVO", pName, accent());
        P::lectura(g, 1, 0, L"TIEMPO REVERB", bufDecay);
        P::lectura(g, 0, 1, L"DELAY BASE", bufDly);
        P::lectura(g, 1, 1, L"MODULACIÓN", c.params.plain(kFreeze) >= 0.5 ? L"INFINITO (FREEZE)" : L"FDN ACTIVA");
    }

    float outputLevel() const override { return meters_.level(); }
    const wchar_t* footerId() const override { return L"com.jaswave.plugin.ambience"; }

private:
    std::shared_ptr<AmbienceBus> bus_;
    JasWaveUI::Kit::StereoMeters meters_;
    JasWaveUI::Plantilla::EspectroDual espectro_;
};

// ---------------------------------------------------------------------------------
class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    std::unique_ptr<JasWaveUI::PluginEditor> createEditor() override { return std::make_unique<Editor>(); }
    std::vector<DemoParam> demoPreset() const override {
        return { { kRevMix, 48.0 }, { kRevSize, 5.0 }, { kDlyMix, 26.0 }, { kShMix, 34.0 } };
    }

    tresult PLUGIN_API setParamNormalized(ParamID tag, ParamValue value) override {
        tresult res = JwController::setParamNormalized(tag, value);
        if (tag == kPresetSelect && res == kResultOk) {
            // Aplicar los valores del preset seleccionado
            const int idx = std::clamp(static_cast<int>(std::round(value * (kNumPresetDefs - 1))), 0, kNumPresetDefs - 1);
            const PresetDef& p = kPresetDefs[idx];
            for (int i = 0; i < p.count; ++i) {
                const uint32_t pid = p.values[i].id;
                const double plain = p.values[i].v;
                const int pIndex = table_.index(pid);
                if (pIndex >= 0) {
                    const double norm = toNorm(table_.defs()[static_cast<size_t>(pIndex)], plain);
                    JwController::setParamNormalized(pid, norm);
                }
            }
        }
        return res;
    }
};

} // namespace JasWaveAmbience

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveAmbience::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Ambience",
               Vst::kDistributable, Vst::PlugType::kFxReverb, "1.0.0", kVstVersionString, JasWaveAmbience::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveAmbience::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Ambience Controller", 0, "", "1.0.0", kVstVersionString, JasWaveAmbience::Controller::createInstance)
END_FACTORY
