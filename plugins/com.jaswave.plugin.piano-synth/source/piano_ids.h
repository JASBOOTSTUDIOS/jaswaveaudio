#pragma once

#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/vst/vsttypes.h"

namespace JasWave {
namespace Piano {

// GUID del plugin: {B3A7C9E1-4D2F-4A8B-9E6C-1F3D5A7B8C0D}
static const Steinberg::FUID kJasWavePianoUID(
    0xB3A7C9E1, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C0D);

// IDs de parámetros (host los identifica por estos valores)
enum Parameters : Steinberg::Vst::ParamID {
    kVelocity = 0,
    kBrightness = 1,
    kDamping = 2,
    kRelease = 3,
    kStereo = 4,
    kBypass = 5
};

// Límites del motor de síntesis
constexpr int32_t kMaxVoices = 64;      // polifonía máxima
constexpr int32_t kMaxStrings = 2;      // cuerdas por nota (para chorus natural)
constexpr int32_t kMaxDelayLen = 2048;  // longitud máxima línea de retardo (La0 = 27.5Hz a 48kHz)

} // namespace Piano
} // namespace JasWave
