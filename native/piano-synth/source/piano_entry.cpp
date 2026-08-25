#include "piano_plugin.h"
#include "piano_ids.h"
#include "public.sdk/source/main/pluginfactory.h"

extern "C" {
SMTG_EXPORT_SYMBOL Steinberg::IPluginFactory* PLUGIN_API GetPluginFactory ()
{
    using namespace Steinberg;

    static bool initialized = false;
    if (gPluginFactory && initialized)
    {
        gPluginFactory->addRef ();
        return gPluginFactory;
    }

    static PFactoryInfo factoryInfo ("JasWave", "https://jaswave.dev", "dev@jaswave.dev",
                                     PFactoryInfo::kNoFlags);
    gPluginFactory = new CPluginFactory (factoryInfo);
    if (!gPluginFactory) return nullptr;

    static PClassInfo2 componentClass (JasWave::Piano::kJasWavePianoUID,
                                       PClassInfo::kManyInstances,
                                       kVstAudioEffectClass,
                                       "JasWave Piano Synth",
                                       0,
                                       "Instrument",
                                       "JasWave",
                                       "1.0.0",
                                       kVstVersionString);
    gPluginFactory->registerClass (&componentClass, JasWavePiano::createInstance);

    initialized = true;
    return gPluginFactory;
}
}
