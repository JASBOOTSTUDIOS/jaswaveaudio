/**
 * Enumeración y apertura de devices (miniaudio + ASIO).
 */

#include "audio_output.h"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include "asio_output.h"
#endif

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <sstream>

#ifdef _WIN32
#include <objbase.h>
#ifndef MA_COINIT_VALUE
#define MA_COINIT_VALUE COINIT_APARTMENTTHREADED
#endif
#endif

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

JaswaveRenderProc gRenderProc = nullptr;

namespace {

std::mutex gMu;
ma_context gCtx{};
ma_device gDev{};
bool gCtxInit{false};
bool gDevInit{false};
bool gUsingAsio{false};
JaswaveAudioStatus gStatus{};
std::atomic<uint32_t> gTestToneLeft{0};
std::atomic<uint32_t> gTestPhase{0};

std::string backendName(ma_backend b) {
  switch (b) {
    case ma_backend_wasapi:
      return "wasapi";
    case ma_backend_dsound:
      return "dsound";
    case ma_backend_winmm:
      return "winmm";
    case ma_backend_coreaudio:
      return "coreaudio";
    case ma_backend_alsa:
      return "alsa";
    case ma_backend_pulseaudio:
      return "pulse";
    case ma_backend_jack:
      return "jack";
    default:
      return "unknown";
  }
}

bool nameLooksLikeUmc(const char* name) {
  if (!name || !name[0]) return false;
  std::string n(name);
  for (char& c : n) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return n.find("umc") != std::string::npos || n.find("behringer") != std::string::npos;
}

std::string backendLabel(const std::string& id) {
  if (id == "wasapi") return "WASAPI";
  if (id == "wasapi_exclusive") return "WASAPI Exclusive";
  if (id == "dsound") return "DirectSound";
  if (id == "winmm") return "WinMM (MME)";
  if (id == "asio") return "ASIO";
  if (id == "jack") return "JACK";
  if (id == "coreaudio") return "Core Audio";
  if (id == "alsa") return "ALSA";
  if (id == "pulse") return "PulseAudio";
  if (id == "auto") return "Automático";
  return id;
}

ma_backend parseMaBackend(const std::string& id) {
  if (id == "wasapi" || id == "wasapi_exclusive") return ma_backend_wasapi;
  if (id == "dsound") return ma_backend_dsound;
  if (id == "winmm") return ma_backend_winmm;
  if (id == "coreaudio") return ma_backend_coreaudio;
  if (id == "alsa") return ma_backend_alsa;
  if (id == "pulse") return ma_backend_pulseaudio;
  if (id == "jack") return ma_backend_jack;
  return ma_backend_wasapi;
}

std::string utf16ToUtf8(const wchar_t* w) {
  if (!w || !w[0]) return {};
#ifdef _WIN32
  char buf[512]{};
  WideCharToMultiByte(CP_UTF8, 0, w, -1, buf, sizeof(buf), nullptr, nullptr);
  return buf;
#else
  (void)w;
  return {};
#endif
}

std::string encodeDeviceId(ma_backend backend, const ma_device_id& id) {
  const std::string b = backendName(backend);
  if (backend == ma_backend_wasapi) {
#ifdef _WIN32
    return b + ":" + utf16ToUtf8(id.wasapi);
#else
    return b + ":default";
#endif
  }
  if (backend == ma_backend_dsound) {
    char hex[40]{};
    for (int i = 0; i < 16; ++i) std::snprintf(hex + i * 2, 3, "%02x", id.dsound[i]);
    return b + ":" + hex;
  }
  if (backend == ma_backend_winmm) {
    return b + ":" + std::to_string(id.winmm);
  }
  if (backend == ma_backend_alsa) return b + ":" + id.alsa;
  if (backend == ma_backend_pulseaudio) return b + ":" + id.pulse;
  if (backend == ma_backend_coreaudio) return b + ":" + id.coreaudio;
  if (backend == ma_backend_jack) return b + ":default";
  return b + ":default";
}

bool decodeDeviceId(const std::string& encoded, ma_backend expected, ma_device_id& out) {
  std::memset(&out, 0, sizeof(out));
  const auto colon = encoded.find(':');
  if (colon == std::string::npos) return false;
  const std::string b = encoded.substr(0, colon);
  const std::string rest = encoded.substr(colon + 1);
  if (b != backendName(expected) && !(expected == ma_backend_wasapi && b == "wasapi")) return false;
  if (expected == ma_backend_wasapi) {
#ifdef _WIN32
    MultiByteToWideChar(CP_UTF8, 0, rest.c_str(), -1, out.wasapi, 64);
#endif
    return true;
  }
  if (expected == ma_backend_dsound) {
    if (rest.size() < 32) return false;
    for (int i = 0; i < 16; ++i) {
      unsigned v = 0;
      std::sscanf(rest.c_str() + i * 2, "%02x", &v);
      out.dsound[i] = static_cast<ma_uint8>(v);
    }
    return true;
  }
  if (expected == ma_backend_winmm) {
    out.winmm = static_cast<ma_uint32>(std::strtoul(rest.c_str(), nullptr, 10));
    return true;
  }
  if (expected == ma_backend_alsa) {
    std::strncpy(out.alsa, rest.c_str(), sizeof(out.alsa) - 1);
    return true;
  }
  if (expected == ma_backend_pulseaudio) {
    std::strncpy(out.pulse, rest.c_str(), sizeof(out.pulse) - 1);
    return true;
  }
  if (expected == ma_backend_coreaudio) {
    std::strncpy(out.coreaudio, rest.c_str(), sizeof(out.coreaudio) - 1);
    return true;
  }
  return rest == "default";
}

void dataCallback(ma_device* /*device*/, void* output, const void* /*input*/, ma_uint32 frameCount) {
  auto* out = static_cast<float*>(output);
  std::memset(out, 0, static_cast<size_t>(frameCount) * 2 * sizeof(float));
  if (gRenderProc) gRenderProc(out, frameCount);
  const uint32_t sr = gStatus.actualSampleRate ? gStatus.actualSampleRate : gStatus.cfg.sampleRate;
  jaswave_audio_mix_test_tone(out, frameCount, sr ? sr : 48000);
}

bool tryListBackend(ma_backend backend, std::vector<JaswaveAudioDevice>& devices) {
  ma_context ctx{};
  ma_backend backends[] = {backend};
  ma_context_config cfg = ma_context_config_init();
  if (ma_context_init(backends, 1, &cfg, &ctx) != MA_SUCCESS) return false;
  ma_device_info* playback = nullptr;
  ma_uint32 count = 0;
  const bool ok = ma_context_get_devices(&ctx, &playback, &count, nullptr, nullptr) == MA_SUCCESS;
  if (ok && playback) {
    for (ma_uint32 i = 0; i < count; ++i) {
      JaswaveAudioDevice d;
      d.backend = backendName(backend);
      d.name = playback[i].name;
      d.isDefault = playback[i].isDefault != 0;
      d.available = true;
      d.id = encodeDeviceId(backend, playback[i].id);
      devices.push_back(std::move(d));
    }
  }
  ma_context_uninit(&ctx);
  return ok;
}

void uninitMaLocked() {
  if (gDevInit) {
    ma_device_stop(&gDev);
    ma_device_uninit(&gDev);
    gDevInit = false;
  }
  if (gCtxInit) {
    ma_context_uninit(&gCtx);
    gCtxInit = false;
  }
}

bool openDeviceLocked(JaswaveAudioConfig cfg, std::string& err) {
  if (cfg.backend.empty() || cfg.backend == "auto") {
#ifdef _WIN32
    cfg.backend = "wasapi";
#elif defined(__APPLE__)
    cfg.backend = "coreaudio";
#else
    cfg.backend = "alsa";
#endif
  }
  if (cfg.sampleRate == 0) cfg.sampleRate = 48000;
  if (cfg.bufferSize == 0) cfg.bufferSize = 256;
  cfg.exclusive = cfg.exclusive || cfg.backend == "wasapi_exclusive";

#ifdef _WIN32
  if (cfg.backend == "asio") {
    std::string name = cfg.deviceId;
    const auto colon = name.find(':');
    if (colon != std::string::npos) name = name.substr(colon + 1);
    if (name.empty() || name == "default") {
      err =
          "Elige un driver ASIO x64 de la lista (UMC, Yamaha, M-WAVE…). «Predeterminado» no abre ASIO.";
      gStatus.lastError = err;
      return false;
    }
    if (!jaswave_asio_start(name, cfg.sampleRate, cfg.bufferSize, err)) {
      gStatus.lastError = err;
      return false;
    }
    gUsingAsio = true;
    gStatus.cfg = cfg;
    gStatus.deviceName = name;
    gStatus.running = true;
    gStatus.lastError.clear();
    gStatus.actualSampleRate = jaswave_asio_sample_rate();
    gStatus.actualBufferSize = jaswave_asio_buffer_size();
    return true;
  }
#endif

  ma_backend backend = parseMaBackend(cfg.backend);
  ma_backend backends[] = {backend};
  ma_context_config ctxCfg = ma_context_config_init();
  if (ma_context_init(backends, 1, &ctxCfg, &gCtx) != MA_SUCCESS) {
    err = "No se pudo inicializar el backend " + backendLabel(cfg.backend);
    gStatus.lastError = err;
    return false;
  }
  gCtxInit = true;

  ma_device_id decoded{};
  ma_device_config dcfg = ma_device_config_init(ma_device_type_playback);
  dcfg.playback.format = ma_format_f32;
  dcfg.playback.channels = 2;
  dcfg.playback.shareMode = cfg.exclusive ? ma_share_mode_exclusive : ma_share_mode_shared;
  dcfg.sampleRate = cfg.sampleRate;
  dcfg.periodSizeInFrames = cfg.bufferSize;
  dcfg.dataCallback = dataCallback;
#if defined(_WIN32)
  dcfg.wasapi.noAutoConvertSRC = MA_FALSE;
  dcfg.wasapi.usage = ma_wasapi_usage_pro_audio;
#endif

  std::string opaque = cfg.deviceId;
  const auto colon = opaque.find(':');
  if (colon != std::string::npos) {
    if (opaque.rfind("wasapi_exclusive:", 0) == 0) opaque = std::string("wasapi:") + opaque.substr(17);
  }
  if (!opaque.empty() && opaque != "default" && opaque.find(':') != std::string::npos) {
    if (decodeDeviceId(opaque, backend, decoded)) {
      dcfg.playback.pDeviceID = &decoded;
    }
  }
#if defined(_WIN32)
  /* Primer open WASAPI: si no hay deviceId, preferir Behringer UMC (ASIO de esa tarjeta tumba el host). */
  if (!dcfg.playback.pDeviceID && backend == ma_backend_wasapi && !cfg.exclusive) {
    ma_device_info* playback = nullptr;
    ma_uint32 playbackCount = 0;
    if (ma_context_get_devices(&gCtx, &playback, &playbackCount, nullptr, nullptr) == MA_SUCCESS) {
      for (ma_uint32 i = 0; i < playbackCount; ++i) {
        if (!nameLooksLikeUmc(playback[i].name)) continue;
        decoded = playback[i].id;
        dcfg.playback.pDeviceID = &decoded;
        std::fprintf(stderr, "[jaswave-plugin-host] WASAPI: se abre «%s» (UMC preferida)\n",
                     playback[i].name);
        break;
      }
    }
  }
#endif

  if (ma_device_init(&gCtx, &dcfg, &gDev) != MA_SUCCESS) {
    dcfg.playback.shareMode = ma_share_mode_shared;
    dcfg.sampleRate = 0;
    if (ma_device_init(&gCtx, &dcfg, &gDev) != MA_SUCCESS) {
      ma_context_uninit(&gCtx);
      gCtxInit = false;
      err = "ma_device_init falló para " + backendLabel(cfg.backend);
      gStatus.lastError = err;
      return false;
    }
  }
  if (ma_device_start(&gDev) != MA_SUCCESS) {
    ma_device_uninit(&gDev);
    ma_context_uninit(&gCtx);
    gCtxInit = false;
    err = "ma_device_start falló";
    gStatus.lastError = err;
    return false;
  }
  gDevInit = true;
  gUsingAsio = false;
  if (cfg.deviceId.empty() || cfg.deviceId == "default") {
    cfg.deviceId = encodeDeviceId(backend, gDev.playback.id);
  }
  gStatus.cfg = cfg;
  gStatus.deviceName = gDev.playback.name[0] ? gDev.playback.name : backendLabel(cfg.backend);
  gStatus.running = true;
  gStatus.lastError.clear();
  gStatus.actualSampleRate = gDev.sampleRate;
  gStatus.actualBufferSize = gDev.playback.internalPeriodSizeInFrames
                                 ? gDev.playback.internalPeriodSizeInFrames
                                 : cfg.bufferSize;
  return true;
}

}  // namespace

void jaswave_audio_set_renderer(JaswaveRenderProc proc) { gRenderProc = proc; }

void jaswave_audio_test_tone(uint32_t frames) { gTestToneLeft.store(frames); }

bool jaswave_audio_test_tone_active() { return gTestToneLeft.load() > 0; }

void jaswave_audio_mix_test_tone(float* interleavedStereo, uint32_t frames, uint32_t sampleRate) {
  uint32_t left = gTestToneLeft.load();
  if (left == 0 || !interleavedStereo || frames == 0) return;
  const float freq = 440.f;
  const float sr = sampleRate > 0 ? static_cast<float>(sampleRate) : 48000.f;
  uint32_t phase = gTestPhase.load();
  const uint32_t n = left < frames ? left : frames;
  for (uint32_t i = 0; i < n; ++i) {
    const float s = 0.15f * std::sin(2.f * 3.14159265f * freq * (static_cast<float>(phase + i) / sr));
    interleavedStereo[i * 2 + 0] += s;
    interleavedStereo[i * 2 + 1] += s;
  }
  gTestPhase.store(phase + n);
  gTestToneLeft.store(left - n);
}

bool jaswave_audio_list(std::vector<JaswaveAudioBackendInfo>& backends,
                        std::vector<JaswaveAudioDevice>& devices, std::string& err) {
  (void)err;
  backends.clear();
  devices.clear();

  auto addBackend = [&](const char* id, bool available, const char* hint) {
    JaswaveAudioBackendInfo b;
    b.id = id;
    b.name = backendLabel(id);
    b.available = available;
    b.hint = hint;
    backends.push_back(std::move(b));
  };

#ifdef _WIN32
  std::vector<JaswaveAudioDevice> wasapi;
  const bool wasapiOk = tryListBackend(ma_backend_wasapi, wasapi);
  addBackend("wasapi", wasapiOk, "Compartido · recomendado en Windows si no usas ASIO");
  addBackend("wasapi_exclusive", wasapiOk, "Baja latencia · monopoliza el dispositivo");
  for (auto& d : wasapi) devices.push_back(d);
  for (auto d : wasapi) {
    d.backend = "wasapi_exclusive";
    d.id = "wasapi_exclusive:" + (d.id.find(':') == std::string::npos ? d.id : d.id.substr(d.id.find(':') + 1));
    devices.push_back(std::move(d));
  }

  std::vector<JaswaveAudioDevice> ds;
  const bool dsOk = tryListBackend(ma_backend_dsound, ds);
  addBackend("dsound", dsOk, "DirectSound · compatibilidad");
  for (auto& d : ds) devices.push_back(d);

  std::vector<JaswaveAudioDevice> mm;
  const bool mmOk = tryListBackend(ma_backend_winmm, mm);
  addBackend("winmm", mmOk, "MME · más latencia, máxima compatibilidad");
  for (auto& d : mm) devices.push_back(d);

  std::vector<JaswaveAudioDevice> asio;
  jaswave_asio_list_drivers(asio);
  addBackend("asio", !asio.empty(),
             asio.empty() ? "No hay drivers ASIO en el registro (ASIO4ALL, interfaz, etc.)"
                          : "Baja latencia. Elige el ASIO x64 de tu interfaz, no «Predeterminado».");
  for (auto& d : asio) devices.push_back(d);

  std::vector<JaswaveAudioDevice> jack;
  const bool jackOk = tryListBackend(ma_backend_jack, jack);
  addBackend("jack", jackOk, jackOk ? "JACK Audio Connection Kit" : "JACK no está instalado o no responde");
  for (auto& d : jack) devices.push_back(d);
#elif defined(__APPLE__)
  std::vector<JaswaveAudioDevice> ca;
  const bool caOk = tryListBackend(ma_backend_coreaudio, ca);
  addBackend("coreaudio", caOk, "Core Audio");
  for (auto& d : ca) devices.push_back(d);
#else
  std::vector<JaswaveAudioDevice> alsa;
  const bool alsaOk = tryListBackend(ma_backend_alsa, alsa);
  addBackend("alsa", alsaOk, "ALSA");
  for (auto& d : alsa) devices.push_back(d);
  std::vector<JaswaveAudioDevice> pulse;
  const bool pulseOk = tryListBackend(ma_backend_pulseaudio, pulse);
  addBackend("pulse", pulseOk, "PulseAudio / PipeWire");
  for (auto& d : pulse) devices.push_back(d);
  std::vector<JaswaveAudioDevice> jack;
  const bool jackOk = tryListBackend(ma_backend_jack, jack);
  addBackend("jack", jackOk, "JACK");
  for (auto& d : jack) devices.push_back(d);
#endif

  addBackend("auto", true, "Elige el primer backend disponible (WASAPI / CoreAudio / ALSA)");
#ifdef _WIN32
  jaswave_com_restore_sta();
#endif
  return true;
}

void jaswave_audio_stop() {
  std::lock_guard<std::mutex> lock(gMu);
#ifdef _WIN32
  if (gUsingAsio) {
    jaswave_asio_stop();
    gUsingAsio = false;
  }
#endif
  uninitMaLocked();
  gStatus.running = false;
#ifdef _WIN32
  jaswave_com_restore_sta();
#endif
}

bool jaswave_audio_start(const JaswaveAudioConfig& want, std::string& err) {
  JaswaveAudioConfig previous{};
  bool had = false;
  {
    std::lock_guard<std::mutex> lock(gMu);
    had = gStatus.running;
    previous = gStatus.cfg;
    if (previous.backend.empty()) previous.backend = "wasapi";
    const bool keepWasapi =
        had && !gUsingAsio && gStatus.running && !want.exclusive &&
        (want.backend == "wasapi" || want.backend == "auto" || want.backend.empty());
    if (keepWasapi) {
      gStatus.lastError.clear();
      err.clear();
      return true;
    }
  }

  jaswave_audio_stop();
#ifdef _WIN32
  if (want.backend == "asio") Sleep(400);
#endif

  {
    std::lock_guard<std::mutex> lock(gMu);
    if (openDeviceLocked(want, err)) {
#ifdef _WIN32
      jaswave_com_restore_sta();
#endif
      return true;
    }
  }

  if (had && (previous.backend != want.backend || previous.deviceId != want.deviceId)) {
#ifdef _WIN32
    Sleep(50);
#endif
    std::string ignored;
    std::lock_guard<std::mutex> lock(gMu);
    if (openDeviceLocked(previous, ignored)) {
      gStatus.lastError = err;
    }
  }
#ifdef _WIN32
  jaswave_com_restore_sta();
#endif
  return false;
}

JaswaveAudioStatus jaswave_audio_status() {
  std::lock_guard<std::mutex> lock(gMu);
#ifdef _WIN32
  if (gUsingAsio && jaswave_asio_running()) {
    gStatus.actualSampleRate = jaswave_asio_sample_rate();
    gStatus.actualBufferSize = jaswave_asio_buffer_size();
    gStatus.running = true;
  }
#endif
  return gStatus;
}

void jaswave_audio_set_sys_handle(void* hwnd) {
#ifdef _WIN32
  jaswave_asio_set_sys_handle(hwnd);
#else
  (void)hwnd;
#endif
}

bool jaswave_audio_asio_control_panel(const std::string& deviceId, std::string& err) {
#ifdef _WIN32
  std::string name = deviceId;
  const auto colon = name.find(':');
  if (colon != std::string::npos) name = name.substr(colon + 1);
  return jaswave_asio_control_panel(name, err);
#else
  err = "ASIO solo está disponible en Windows";
  return false;
#endif
}
