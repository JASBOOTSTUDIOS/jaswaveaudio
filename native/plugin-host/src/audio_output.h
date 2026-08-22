#pragma once
/**
 * Salida de audio del plugin-host: enumera backends instalados y abre uno
 * (WASAPI / Exclusive / DirectSound / WinMM / JACK / ASIO).
 */

#include <cstdint>
#include <string>
#include <vector>

struct JaswaveAudioDevice {
  std::string id;
  std::string backend;
  std::string name;
  bool isDefault{false};
  bool available{true};
};

struct JaswaveAudioBackendInfo {
  std::string id;
  std::string name;
  bool available{false};
  std::string hint;
};

struct JaswaveAudioConfig {
  std::string backend;    // auto|wasapi|wasapi_exclusive|dsound|winmm|asio|jack|coreaudio|alsa|pulse
  std::string deviceId;   // vacío = default del backend
  uint32_t sampleRate{48000};
  uint32_t bufferSize{512};
  bool exclusive{false};
};

struct JaswaveAudioStatus {
  JaswaveAudioConfig cfg;
  std::string deviceName;
  bool running{false};
  std::string lastError;
  uint32_t actualSampleRate{0};
  uint32_t actualBufferSize{0};
};

typedef void (*JaswaveRenderProc)(float* interleavedStereo, uint32_t frames);

extern JaswaveRenderProc gRenderProc;
void jaswave_audio_set_renderer(JaswaveRenderProc proc);

bool jaswave_audio_list(std::vector<JaswaveAudioBackendInfo>& backends,
                        std::vector<JaswaveAudioDevice>& devices, std::string& err);

bool jaswave_audio_start(const JaswaveAudioConfig& want, std::string& err);
void jaswave_audio_stop();
JaswaveAudioStatus jaswave_audio_status();
bool jaswave_audio_asio_control_panel(const std::string& deviceId, std::string& err);
void jaswave_audio_test_tone(uint32_t frames);
bool jaswave_audio_test_tone_active();
void jaswave_audio_mix_test_tone(float* interleavedStereo, uint32_t frames, uint32_t sampleRate);
