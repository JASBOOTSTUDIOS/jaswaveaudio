#include "controller.h"
#include "editor.h"
#include "processor.h"

#include "base/source/fstreamer.h"
#include "public.sdk/source/vst/vstparameters.h"
#include "pluginterfaces/base/ustring.h"

#include <algorithm>
#include <cstring>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace JasWaveRoles {

tresult PLUGIN_API Controller::initialize(FUnknown* context) {
  const tresult r = EditController::initialize(context);
  if (r != kResultOk) return r;

  parameters.addParameter(STR16("Role"), STR16(""), kNumRoles - 1, roleToNormalized(Role::Pad),
                          ParameterInfo::kCanAutomate | ParameterInfo::kIsList, kParamRoleId);
  parameters.addParameter(STR16("Attack"), STR16(""), 0, 0.35,
                          ParameterInfo::kCanAutomate, kParamAttackId);
  parameters.addParameter(STR16("Release"), STR16(""), 0, 0.4,
                          ParameterInfo::kCanAutomate, kParamReleaseId);
  parameters.addParameter(STR16("Cutoff"), STR16(""), 0, 0.55,
                          ParameterInfo::kCanAutomate, kParamCutoffId);
  parameters.addParameter(STR16("Resonance"), STR16(""), 0, 0.25,
                          ParameterInfo::kCanAutomate, kParamResonanceId);
  parameters.addParameter(STR16("Gain"), STR16(""), 0, 0.7,
                          ParameterInfo::kCanAutomate, kParamGainId);
  parameters.addParameter(STR16("Voices"), STR16(""), 0, 0.5,
                          ParameterInfo::kCanAutomate, kParamVoicesId);

  return kResultOk;
}

tresult PLUGIN_API Controller::setComponentState(IBStream* state) {
  if (!state) return kResultFalse;
  IBStreamer streamer(state, kLittleEndian);
  int32 role = 0;
  if (!streamer.readInt32(role)) return kResultFalse;
  role = std::clamp(role, 0, kNumRoles - 1);
  setParamNormalized(kParamRoleId, roleToNormalized(static_cast<Role>(role)));

  double attack = 0.35, release = 0.4, cutoff = 0.55, reso = 0.25, gain = 0.7, voices = 0.5;
  streamer.readDouble(attack);
  streamer.readDouble(release);
  streamer.readDouble(cutoff);
  streamer.readDouble(reso);
  streamer.readDouble(gain);
  streamer.readDouble(voices);
  setParamNormalized(kParamAttackId, attack);
  setParamNormalized(kParamReleaseId, release);
  setParamNormalized(kParamCutoffId, cutoff);
  setParamNormalized(kParamResonanceId, reso);
  setParamNormalized(kParamGainId, gain);
  setParamNormalized(kParamVoicesId, voices);
  return kResultOk;
}

IPlugView* PLUGIN_API Controller::createView(FIDString name) {
  if (name && std::strcmp(name, ViewType::kEditor) == 0) {
    return new RolesEditorView(this);
  }
  return nullptr;
}

} // namespace JasWaveRoles
