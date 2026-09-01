#include "processor.h"
#include "controller.h"

#include "public.sdk/source/main/pluginfactory.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"

#define stringPluginName "JasWave Roles"
#define stringPluginVersion "1.0.0"

using namespace Steinberg;
using namespace JasWaveRoles;

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY("JasWave", "https://jaswave.app", "mailto:dev@jaswave.app",
              PFactoryInfo::kNoFlags)

DEF_CLASS2(INLINE_UID_FROM_FUID(kProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
           stringPluginName, Vst::kDistributable, "Instrument|Synth", stringPluginVersion,
           kVstVersionString, Processor::createInstance)

DEF_CLASS2(INLINE_UID_FROM_FUID(kControllerUid), PClassInfo::kManyInstances,
           kVstComponentControllerClass, stringPluginName " Controller", 0, "", stringPluginVersion,
           kVstVersionString, Controller::createInstance)

END_FACTORY
