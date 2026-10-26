#include "worship_drums_dsp.h"
#include "jw_vst3.h"

#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;
using namespace JasWaveVst;

namespace JasWaveWorshipDrums {

static const FUID kProcessorUid(0xB3A7C9E3, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C01);
static const FUID kControllerUid(0xB3A7C9E3, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C02);

static const FeatureDef kFeatures[] = {
    { "drums.worship-room", "Sala espacial worship de gran dimensión" }
};

static const PluginDescriptor kDesc{ "com.jaswave.plugin.worship-drums", "JasWave Worship Drums", L"WORSHIP DRUMS", kFeatures, 1, true };

class Processor : public JwProcessor {
public:
    Processor() : JwProcessor(kDesc, paramDefs(), kControllerUid) {}
    static FUnknown* createInstance(void*) { return static_cast<IAudioProcessor*>(new Processor()); }

protected:
    void prepare(double sr, int maxBlock) override { engine_.prepare(sr, maxBlock); }
    void resetDsp() override { engine_.reset(); }
    void updateParams() override {
        DrumSettings s;
        s.kickTuneHz = plainOf(kKickTune);
        s.snareSnapPct = plainOf(kSnareSnap);
        s.tomsDampPct = plainOf(kTomsDamp);
        s.overheadAirPct = plainOf(kOverheadAir);
        s.roomBlendPct = plainOf(kRoomBlend);
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

        // Procesar eventos MIDI de percusión
        if (data.inputEvents) {
            const int32 numEvents = data.inputEvents->getEventCount();
            for (int32 i = 0; i < numEvents; ++i) {
                Event e{};
                if (data.inputEvents->getEvent(i, e) == kResultOk) {
                    if (e.type == Event::kNoteOnEvent) {
                        engine_.noteOn(e.noteOn.pitch, e.noteOn.velocity);
                    }
                }
            }
        }

        engine_.render(outL, outR, numSamples);
        return kResultOk;
    }

private:
    WorshipDrumsEngine engine_{};
};

class Controller : public JwController {
public:
    Controller() : JwController(kDesc, paramDefs()) {}
    static FUnknown* createInstance(void*) { return static_cast<IEditController*>(new Controller()); }
};

} // namespace JasWaveWorshipDrums

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveWorshipDrums::kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass, "JasWave Worship Drums",
               Vst::kDistributable, Vst::PlugType::kInstrumentDrum, "1.0.0", kVstVersionString, JasWaveWorshipDrums::Processor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveWorshipDrums::kControllerUid), PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Worship Drums Controller", 0, "", "1.0.0", kVstVersionString, JasWaveWorshipDrums::Controller::createInstance)
END_FACTORY
