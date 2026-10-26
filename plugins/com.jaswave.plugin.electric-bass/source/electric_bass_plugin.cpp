#include "electric_bass_dsp.h"
#include "jw_vst3.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveElectricBass {

static const FUID kProcessorUid(0xB3A7C9E4, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E4, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "bass.tube-drive", "Emulación de saturación valvular de previo vintage" }
};

static const PluginDescriptor kDesc{ "com.jaswave.plugin.electric-bass", "JasWave Electric Bass", L"ELECTRIC BASS", kFeatures, 1, true };

class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) {}
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        BassSettings s;
        s.tonePct = plainOf(kTone);
        s.fingerAttackPct = plainOf(kFingerAttack);
        s.drivePct = plainOf(kDrive);
        s.lowBoostDb = plainOf(kLowBoost);
        s.compMixPct = plainOf(kCompressorMix);
        s.bypass = boolOf(kBypass) || !licensed();
        s.volumeDb = plainOf(kVolume);
        engine_.setSettings(s);
    }

    tresult PLUGIN_API process(ProcessData& data) override {
        updateParams();

        if (data.numOutputs < 1 || !data.outputs[0].channelBuffers32) {
            return kResultOk;
        }

        const int numSamples = data.numSamples;
        float* outL = data.outputs[0].channelBuffers32[0];
        float* outR = data.outputs[0].numChannels > 1 ? data.outputs[0].channelBuffers32[1] : outL;

        if (data.inputEvents) {
            const int32 numEvents = data.inputEvents->getEventCount();
            for (int32 i = 0; i < numEvents; ++i) {
                Event e{};
                if (data.inputEvents->getEvent(i, e) == kResultOk) {
                    if (e.type == Event::kNoteOnEvent) {
                        engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                    } else if (e.type == Event::kNoteOffEvent) {
                        engine_.noteOff(e.noteOff.pitch);
                    }
                }
            }
        }

        engine_.render(outL, outR, numSamples);
        return kResultOk;
    }

private:
    ElectricBassEngine engine_{};
};

class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
};

} // namespace JasWaveElectricBass

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectricBass::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Electric Bass",
               Vst::kDistributable, Vst::PlugType::kInstrumentBass, "1.0.0", kVstVersionString, JasWaveElectricBass::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveElectricBass::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Electric Bass Controller", 0, "", "1.0.0", kVstVersionString, JasWaveElectricBass::Controller::createInstance)
END_FACTORY
