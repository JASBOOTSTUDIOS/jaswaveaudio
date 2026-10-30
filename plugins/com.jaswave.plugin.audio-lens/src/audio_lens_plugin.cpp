// JasWave AudioLens – VST3 (procesador, controlador, editor Cyber y factoría)
#include "jw_audio_lens.h"
#include "jw_vst3.h"
#include "jw_ui.h"
#include "jw_ui_kit.h"
#include "jw_ui_plantilla.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;
using namespace JasWaveDsp;

namespace JasWaveAudioLens {

// FUID único para JasWave AudioLens VST3
static const FUID kProcessorUid(0x4A617357, 0x4155444C, 0x454E5356, 0x33543130);
static const FUID kControllerUid(0x4A617357, 0x4155444C, 0x454E5356, 0x33543131);

enum : uint32_t {
    kBypass = 0,
    kRecord = 1,
    kSensitivity = 2,
    kQuantize16th = 3
};

enum Feature : int {
    kFeatBeatboxMidi = 0,
    kFeatChordsKey = 1
};

static const FeatureDef kFeatures[] = {
    { "lens.beatbox-midi", "Conversión de Beatbox a batería MIDI" },
    { "lens.chords-key", "Extracción de acordes y tonalidad" },
};

static const PluginDescriptor kDesc{
    "com.jaswave.plugin.audio-lens",
    "JasWave AudioLens",
    L"AUDIO DESCRIPTOR & BEATBOX",
    kFeatures,
    2,
    false
};

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(toggleP(kRecord, "Record Sample", 0));
        v.push_back(withFeature(linearP(kSensitivity, "Sensitivity", "x", 0.5, 2.0, 1.0, 2), kFeatBeatboxMidi));
        v.push_back(toggleP(kQuantize16th, "Quantize 1/16", 1));
        return v;
    }();
    return defs;
}

// Bus de comunicación interna con la UI
class AudioLensBus {
public:
    std::atomic<bool> isRecording{false};
    std::atomic<int> detectedHits{0};
    std::atomic<int> detectedKicks{0};
    std::atomic<int> detectedSnares{0};
    std::atomic<int> detectedHats{0};
    std::string latestSummary;
    std::mutex summaryMtx;

    void updateResults(const AudioLensAnalysisResult& res) {
        detectedHits.store(static_cast<int>(res.drumHits.size()), std::memory_order_relaxed);
        detectedKicks.store(res.kickCount, std::memory_order_relaxed);
        detectedSnares.store(res.snareCount, std::memory_order_relaxed);
        detectedHats.store(res.hihatCount, std::memory_order_relaxed);
        std::lock_guard<std::mutex> lock(summaryMtx);
        latestSummary = res.aiSummary;
    }
};

// ---------------------------------------------------------------------------------
class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) {
        registerBus(lbus_ = std::make_shared<AudioLensBus>());
    }
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int /*maxBlock*/) override {
        sr_ = sr;
        capture_.prepare(sr, 30);
    }

    void resetDsp() override {
        capture_.stopRecording();
    }

    void updateParams() override {
        bool rec = boolOf(kRecord);
        if (rec && !capture_.isRecording()) {
            capture_.startRecording();
            if (lbus_) lbus_->isRecording.store(true, std::memory_order_relaxed);
        } else if (!rec && capture_.isRecording()) {
            capture_.stopRecording();
            if (lbus_) lbus_->isRecording.store(false, std::memory_order_relaxed);

            // Ejecutar análisis de la muestra capturada
            double sensitivity = plainOf(kSensitivity);
            bool quantize = boolOf(kQuantize16th);
            size_t nSamples = capture_.recordedSamples();
            const auto& buf = capture_.getBuffer();

            if (nSamples > 2048) {
                auto res = AudioLensEngine::analyze(buf.data(), nSamples, sr_, 120.0, quantize);
                if (lbus_) lbus_->updateResults(res);
            }
        }
    }

    void render(const float* iL, const float* iR, float* oL, float* oR, int n, int, ProcessData&) override {
        // Audio pass-through transparente (para usar como insert sin alterar la señal)
        for (int i = 0; i < n; ++i) {
            oL[i] = iL[i];
            oR[i] = iR[i];
        }
        capture_.processBlock(iL, iR, n);
    }

    void render(const double* iL, const double* iR, double* oL, double* oR, int n, int, ProcessData&) override {
        for (int i = 0; i < n; ++i) {
            oL[i] = static_cast<double>(iL[i]);
            oR[i] = static_cast<double>(iR[i]);
        }
    }

    uint32 tailSamples() override { return 0; }

private:
    double sr_{44100.0};
    AudioLensCapture capture_;
    std::shared_ptr<AudioLensBus> lbus_;
};

// ---------------------------------------------------------------------------------
class Editor : public JasWaveUI::PluginEditor {
public:
    const wchar_t* title() const override { return L"AUDIOLENS DESCRIPTOR"; }
    const wchar_t* subtitle() const override { return L"ANÁLISIS MUSICAL · BEATBOX A MIDI · PUENTE IA"; }
    const char* visualizer() const override { return "espectro"; }

    void build(JasWaveUI::EditorContext& c) override {
        namespace P = JasWaveUI::Plantilla;
        P::controles(c, L"CAPTURA Y PROCESADO");
        P::principal(c, 0, kSensitivity, L"SENSIBILIDAD");
        P::interruptor(c, 0, 1, kRecord, L"REC MUESTRA");
        P::interruptor(c, 1, 1, kQuantize16th, L"CUANTIZAR 1/16");
        P::salida(c, kBypass);
    }
};

class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
    IPlugView* PLUGIN_API createView(FIDString name) override {
        if (name && strcmp(name, ViewType::kEditor) == 0) return new Editor();
        return nullptr;
    }
};

} // namespace JasWaveAudioLens

// Exportación de la factoría VST3
BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.com", "soporte@jaswave.com")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveAudioLens::kProcessorUid),
               PClassInfo::kManyInstances,
               kVstAudioEffectClass,
               "JasWave AudioLens",
               Vst::kDistributable,
               "Fx|Analysis|Tools",
               "1.0.0",
               kVstVersionString,
               JasWaveAudioLens::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveAudioLens::kControllerUid),
               PClassInfo::kManyInstances,
               kVstComponentControllerClass,
               "JasWave AudioLens Controller",
               0,
               "",
               "1.0.0",
               kVstVersionString,
               JasWaveAudioLens::Controller::createInstance)
END_FACTORY
