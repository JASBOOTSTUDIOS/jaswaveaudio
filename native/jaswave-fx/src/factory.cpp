#include "processor.h"

#include "public.sdk/source/main/pluginfactory.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"

#include <cstring>

#define stringPluginName "JasWave FX"
#define stringPluginVersion "1.0.0"

using namespace Steinberg;
using namespace JasWaveFx;

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY("JasWave", "https://jaswave.app", "mailto:dev@jaswave.app",
              PFactoryInfo::kNoFlags)

// EQ
DEF_CLASS2(INLINE_UID_FROM_FUID(kEqProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
           stringPluginName " EQ", Vst::kDistributable, "Fx|EQ", stringPluginVersion,
           kVstVersionString, EqProcessor::createInstance)
DEF_CLASS2(INLINE_UID_FROM_FUID(kEqControllerUid), PClassInfo::kManyInstances,
           kVstComponentControllerClass, stringPluginName " EQ Controller", 0, "", stringPluginVersion,
           kVstVersionString, EqController::createInstance)

// Compresor
DEF_CLASS2(INLINE_UID_FROM_FUID(kCompProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
           stringPluginName " Compresor", Vst::kDistributable, "Fx|Dynamics", stringPluginVersion,
           kVstVersionString, CompProcessor::createInstance)
DEF_CLASS2(INLINE_UID_FROM_FUID(kCompControllerUid), PClassInfo::kManyInstances,
           kVstComponentControllerClass, stringPluginName " Compresor Controller", 0, "", stringPluginVersion,
           kVstVersionString, CompController::createInstance)

// Limitador
DEF_CLASS2(INLINE_UID_FROM_FUID(kLimProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
           stringPluginName " Limitador", Vst::kDistributable, "Fx|Limiter", stringPluginVersion,
           kVstVersionString, LimiterProcessor::createInstance)
DEF_CLASS2(INLINE_UID_FROM_FUID(kLimControllerUid), PClassInfo::kManyInstances,
           kVstComponentControllerClass, stringPluginName " Limitador Controller", 0, "", stringPluginVersion,
           kVstVersionString, LimiterController::createInstance)

// Utility
DEF_CLASS2(INLINE_UID_FROM_FUID(kUtilProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
           stringPluginName " Utility", Vst::kDistributable, "Fx|Utility", stringPluginVersion,
           kVstVersionString, UtilityProcessor::createInstance)
DEF_CLASS2(INLINE_UID_FROM_FUID(kUtilControllerUid), PClassInfo::kManyInstances,
           kVstComponentControllerClass, stringPluginName " Utility Controller", 0, "", stringPluginVersion,
           kVstVersionString, UtilityController::createInstance)

// De-esser
DEF_CLASS2(INLINE_UID_FROM_FUID(kDeEsserProcessorUid), PClassInfo::kManyInstances, kVstAudioEffectClass,
           stringPluginName " De-esser", Vst::kDistributable, "Fx|DeEsser", stringPluginVersion,
           kVstVersionString, DeEsserProcessor::createInstance)
DEF_CLASS2(INLINE_UID_FROM_FUID(kDeEsserControllerUid), PClassInfo::kManyInstances,
           kVstComponentControllerClass, stringPluginName " De-esser Controller", 0, "", stringPluginVersion,
           kVstVersionString, DeEsserController::createInstance)

END_FACTORY
