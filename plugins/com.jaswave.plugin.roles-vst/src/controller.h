#pragma once

#include "roles_map.h"
#include "public.sdk/source/vst/vsteditcontroller.h"

namespace JasWaveRoles {

class Controller : public Steinberg::Vst::EditController {
public:
  static Steinberg::FUnknown* createInstance(void*) {
    return static_cast<Steinberg::Vst::IEditController*>(new Controller());
  }

  Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
  Steinberg::tresult PLUGIN_API setComponentState(Steinberg::IBStream* state) SMTG_OVERRIDE;
  Steinberg::IPlugView* PLUGIN_API createView(Steinberg::FIDString name) SMTG_OVERRIDE;
};

} // namespace JasWaveRoles
