/**
 * Host ASIO mínimo (Windows): enumera drivers del registro y abre el IASIO del fabricante.
 * El layout de IASIO coincide con el ABI público de ASIO 2.3 en MSVC.
 */

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <objbase.h>

#include "asio_output.h"
#include "audio_output.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <mutex>
#include <string>
#include <vector>

typedef long ASIOBool;
typedef long ASIOError;
typedef double ASIOSampleRate;

enum {
  ASIOFalse = 0,
  ASIOTrue = 1,
  ASE_OK = 0,
  ASE_SUCCESS = 0x3f4847a0,
  ASIOSTInt16MSB = 0,
  ASIOSTInt24MSB = 1,
  ASIOSTInt32MSB = 2,
  ASIOSTFloat32MSB = 3,
  ASIOSTFloat64MSB = 4,
  ASIOSTInt32MSB16 = 8,
  ASIOSTInt32MSB18 = 9,
  ASIOSTInt32MSB20 = 10,
  ASIOSTInt32MSB24 = 11,
  ASIOSTInt16LSB = 16,
  ASIOSTInt24LSB = 17,
  ASIOSTInt32LSB = 18,
  ASIOSTFloat32LSB = 19,
  ASIOSTFloat64LSB = 20,
  ASIOSTInt32LSB16 = 24,
  ASIOSTInt32LSB18 = 25,
  ASIOSTInt32LSB20 = 26,
  ASIOSTInt32LSB24 = 27,
};

struct ASIOSamples {
  unsigned long hi;
  unsigned long lo;
};
struct ASIOTimeStamp {
  unsigned long hi;
  unsigned long lo;
};
struct ASIOTimeCode {
  double speed;
  ASIOSamples timeCodeSamples;
  unsigned long flags;
  char future[64];
};
struct AsioTimeInfo {
  double speed;
  ASIOTimeStamp systemTime;
  ASIOSamples samplePosition;
  ASIOSampleRate sampleRate;
  unsigned long flags;
  char reserved[12];
};
struct ASIOTime {
  long reserved[4];
  AsioTimeInfo timeInfo;
  ASIOTimeCode timeCode;
};
struct ASIOClockSource {
  long index;
  long associatedChannel;
  long associatedGroup;
  ASIOBool isCurrentSource;
  char name[32];
};
struct ASIOChannelInfo {
  long channel;
  ASIOBool isInput;
  ASIOBool isActive;
  long channelGroup;
  long type;
  char name[32];
};
struct ASIOBufferInfo {
  ASIOBool isInput;
  long channelNum;
  void* buffers[2];
};
struct ASIOCallbacks {
  void (*bufferSwitch)(long doubleBufferIndex, ASIOBool directProcess);
  void (*sampleRateDidChange)(ASIOSampleRate sRate);
  long (*asioMessage)(long selector, long value, void* message, double* opt);
  ASIOTime* (*bufferSwitchTimeInfo)(ASIOTime* params, long doubleBufferIndex, ASIOBool directProcess);
};

struct IASIO : public IUnknown {
  virtual ASIOBool init(void* sysHandle) = 0;
  virtual void getDriverName(char* name) = 0;
  virtual long getDriverVersion() = 0;
  virtual void getErrorMessage(char* string) = 0;
  virtual ASIOError start() = 0;
  virtual ASIOError stop() = 0;
  virtual ASIOError getChannels(long* numInputChannels, long* numOutputChannels) = 0;
  virtual ASIOError getLatencies(long* inputLatency, long* outputLatency) = 0;
  virtual ASIOError getBufferSize(long* minSize, long* maxSize, long* preferredSize,
                                  long* granularity) = 0;
  virtual ASIOError canSampleRate(ASIOSampleRate sampleRate) = 0;
  virtual ASIOError getSampleRate(ASIOSampleRate* sampleRate) = 0;
  virtual ASIOError setSampleRate(ASIOSampleRate sampleRate) = 0;
  virtual ASIOError getClockSources(ASIOClockSource* clocks, long* numSources) = 0;
  virtual ASIOError setClockSource(long reference) = 0;
  virtual ASIOError getSamplePosition(ASIOSamples* sPos, ASIOTimeStamp* tStamp) = 0;
  virtual ASIOError getChannelInfo(ASIOChannelInfo* info) = 0;
  virtual ASIOError createBuffers(ASIOBufferInfo* bufferInfos, long numChannels, long bufferSize,
                                  ASIOCallbacks* callbacks) = 0;
  virtual ASIOError disposeBuffers() = 0;
  virtual ASIOError controlPanel() = 0;
  virtual ASIOError future(long selector, void* opt) = 0;
  virtual ASIOError outputReady() = 0;
};

namespace {

std::mutex gAsioMu;
std::atomic<uintptr_t> gSysHwnd{0};
IASIO* gDriver{nullptr};
std::atomic<bool> gRunning{false};
std::atomic<int> gInCallback{0};
uint32_t gSr{48000};
uint32_t gBuf{512};
long gSampleType{ASIOSTFloat32LSB};
long gOutChannels{0};
bool gNeedOutputReady{false};
bool gBuffersCreated{false};
ASIOBufferInfo gBufInfo[32]{};
ASIOCallbacks gCb{};
std::string gDriverName;
float gScratch[8192 * 2]{};
float gAsioL[8192];
float gAsioR[8192];

bool isAsioWrapperName(const std::string& name) {
  std::string n = name;
  for (char& c : n) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return n.find("fl studio") != std::string::npos || n.find("generic low latency") != std::string::npos;
}

size_t asioSampleBytes(long type) {
  switch (type) {
    case ASIOSTInt16LSB:
    case ASIOSTInt16MSB:
      return 2;
    case ASIOSTInt24LSB:
    case ASIOSTInt24MSB:
      return 3;
    case ASIOSTFloat64LSB:
    case ASIOSTFloat64MSB:
      return 8;
    default:
      return 4;
  }
}

void silenceAsioChannel(void* dest, int frames, long type) {
  if (!dest || frames <= 0) return;
  std::memset(dest, 0, static_cast<size_t>(frames) * asioSampleBytes(type));
}

long snapAsioBuffer(long want, long minB, long maxB, long pref, long gran) {
  if (want <= 0) want = pref > 0 ? pref : 256;
  if (minB > 0 && want < minB) want = minB;
  if (maxB > 0 && want > maxB) want = maxB;
  if (gran == 0) gran = 1;
  if (gran > 0 && minB >= 0) {
    const long base = minB > 0 ? minB : 0;
    if (want >= base) {
      const long n = gran ? (want - base + gran / 2) / gran : 0;
      want = base + n * gran;
    }
    if (maxB > 0 && want > maxB) want = maxB;
    if (minB > 0 && want < minB) want = minB;
  } else if (gran < 0) {
    long p = 1;
    while (p < want) p <<= 1;
    want = p;
    if (maxB > 0 && want > maxB) {
      want = 1;
      while ((want << 1) <= maxB) want <<= 1;
    }
    if (minB > 0 && want < minB) want = minB;
  }
  return std::max(16L, want);
}

void writeAsioChannel(void* dest, const float* src, int frames, long type, bool swapEndian) {
  if (!dest || !src) return;
  (void)swapEndian;
  switch (type) {
    case ASIOSTFloat32LSB:
      std::memcpy(dest, src, static_cast<size_t>(frames) * sizeof(float));
      break;
    case ASIOSTInt16LSB: {
      auto* d = static_cast<int16_t*>(dest);
      for (int i = 0; i < frames; ++i) {
        const float s = std::max(-1.f, std::min(1.f, src[i]));
        d[i] = static_cast<int16_t>(s * 32767.f);
      }
      break;
    }
    case ASIOSTInt24LSB: {
      auto* d = static_cast<unsigned char*>(dest);
      for (int i = 0; i < frames; ++i) {
        const float s = std::max(-1.f, std::min(1.f, src[i]));
        const int v = static_cast<int>(s * 8388607.f);
        d[i * 3 + 0] = static_cast<unsigned char>(v & 0xff);
        d[i * 3 + 1] = static_cast<unsigned char>((v >> 8) & 0xff);
        d[i * 3 + 2] = static_cast<unsigned char>((v >> 16) & 0xff);
      }
      break;
    }
    case ASIOSTInt32LSB:
      {
        auto* d = static_cast<int32_t*>(dest);
        for (int i = 0; i < frames; ++i) {
          const float s = std::max(-1.f, std::min(1.f, src[i]));
          d[i] = static_cast<int32_t>(s * 2147483647.f);
        }
        break;
      }
    case ASIOSTInt32LSB24: {
      auto* d = static_cast<int32_t*>(dest);
      for (int i = 0; i < frames; ++i) {
        const float s = std::max(-1.f, std::min(1.f, src[i]));
        d[i] = static_cast<int32_t>(s * 8388607.f) << 8;
      }
      break;
    }
    default: {
      auto* d = static_cast<float*>(dest);
      std::memcpy(d, src, static_cast<size_t>(frames) * sizeof(float));
      break;
    }
  }
}

void CALLBACK_bufferSwitch(long index, ASIOBool directProcess);

long CALLBACK_asioMessage(long selector, long value, void* message, double* opt) {
  (void)value;
  (void)message;
  (void)opt;
  enum {
    kAsioSelectorSupported = 1,
    kAsioEngineVersion = 2,
    kAsioResetRequest = 3,
    kAsioBufferSizeChange = 4,
    kAsioResyncRequest = 5,
    kAsioLatenciesChanged = 6,
    kAsioSupportsTimeInfo = 7,
    kAsioSupportsTimeCode = 8,
  };
  switch (selector) {
    case kAsioSelectorSupported:
      switch (value) {
        case kAsioEngineVersion:
        case kAsioResetRequest:
        case kAsioBufferSizeChange:
        case kAsioResyncRequest:
        case kAsioLatenciesChanged:
        case kAsioSupportsTimeInfo:
          return 1;
        default:
          return 0;
      }
    case kAsioEngineVersion:
      return 2;
    case kAsioSupportsTimeInfo:
      return 1;
    case kAsioSupportsTimeCode:
      return 0;
    default:
      return 0;
  }
}

void CALLBACK_sampleRateDidChange(ASIOSampleRate sRate) {
  if (sRate > 0) gSr = static_cast<uint32_t>(sRate);
}

ASIOTime* CALLBACK_bufferSwitchTimeInfo(ASIOTime* params, long doubleBufferIndex,
                                        ASIOBool directProcess) {
  CALLBACK_bufferSwitch(doubleBufferIndex, directProcess);
  return params;
}

void CALLBACK_bufferSwitch(long index, ASIOBool /*directProcess*/) {
  if (!gRunning.load(std::memory_order_acquire) || index < 0 || index > 1) return;
  gInCallback.fetch_add(1, std::memory_order_acq_rel);
  const int frames = std::min(static_cast<int>(gBuf), 8192);
  if (frames <= 0) {
    gInCallback.fetch_sub(1, std::memory_order_acq_rel);
    return;
  }
  std::fill(gScratch, gScratch + frames * 2, 0.f);
  if (gRenderProc) gRenderProc(gScratch, static_cast<uint32_t>(frames));
  jaswave_audio_mix_test_tone(gScratch, static_cast<uint32_t>(frames), gSr ? gSr : 48000);
  for (int i = 0; i < frames; ++i) {
    gAsioL[i] = gScratch[i * 2];
    gAsioR[i] = gScratch[i * 2 + 1];
  }
  writeAsioChannel(gBufInfo[0].buffers[index], gAsioL, frames, gSampleType, false);
  if (gOutChannels > 1 && gBufInfo[1].buffers[index] &&
      gBufInfo[1].buffers[index] != gBufInfo[0].buffers[index]) {
    writeAsioChannel(gBufInfo[1].buffers[index], gAsioR, frames, gSampleType, false);
  }
  for (long c = 2; c < gOutChannels && c < 32; ++c) {
    silenceAsioChannel(gBufInfo[c].buffers[index], frames, gSampleType);
  }
  if (gNeedOutputReady && gDriver) gDriver->outputReady();
  gInCallback.fetch_sub(1, std::memory_order_acq_rel);
}

std::string wideToUtf8(const wchar_t* w) {
  if (!w || !w[0]) return {};
  char buf[512]{};
  WideCharToMultiByte(CP_UTF8, 0, w, -1, buf, sizeof(buf), nullptr, nullptr);
  return buf;
}

std::string hresultHex(HRESULT hr) {
  char b[20]{};
  std::snprintf(b, sizeof(b), "0x%08X", static_cast<unsigned>(hr));
  return b;
}

bool iequalsUtf8(const std::string& a, const std::string& b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    const unsigned char ca = static_cast<unsigned char>(a[i]);
    const unsigned char cb = static_cast<unsigned char>(b[i]);
    if (std::tolower(ca) != std::tolower(cb)) return false;
  }
  return true;
}

bool clsidHasInproc(const CLSID& clsid, REGSAM wow) {
  wchar_t guid[64]{};
  if (StringFromGUID2(clsid, guid, 64) <= 0) return false;
  const std::wstring path = std::wstring(L"SOFTWARE\\Classes\\CLSID\\") + guid + L"\\InprocServer32";
  HKEY h = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0, KEY_READ | wow, &h) != ERROR_SUCCESS) {
    return false;
  }
  wchar_t dll[MAX_PATH]{};
  DWORD sz = sizeof(dll);
  const LONG st = RegGetValueW(h, nullptr, nullptr, RRF_RT_REG_SZ, nullptr, dll, &sz);
  RegCloseKey(h);
  return st == ERROR_SUCCESS && dll[0] != 0;
}

bool readAsioClsid(HKEY sub, CLSID& clsid) {
  wchar_t buf[128]{};
  DWORD sz = sizeof(buf);
  if (RegGetValueW(sub, nullptr, L"CLSID", RRF_RT_REG_SZ, nullptr, buf, &sz) != ERROR_SUCCESS) {
    return false;
  }
  return SUCCEEDED(CLSIDFromString(buf, &clsid));
}

void enumAsioView(REGSAM wow, std::vector<JaswaveAudioDevice>& out) {
  HKEY h = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\ASIO", 0, KEY_READ | wow, &h) != ERROR_SUCCESS) {
    return;
  }
  for (DWORD i = 0; i < 128; ++i) {
    wchar_t name[256]{};
    DWORD nlen = 256;
    if (RegEnumKeyExW(h, i, name, &nlen, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
    HKEY sub = nullptr;
    if (RegOpenKeyExW(h, name, 0, KEY_READ | wow, &sub) != ERROR_SUCCESS) continue;
    wchar_t desc[256]{};
    DWORD dsz = sizeof(desc);
    if (RegGetValueW(sub, nullptr, L"Description", RRF_RT_REG_SZ, nullptr, desc, &dsz) != ERROR_SUCCESS) {
      wcsncpy_s(desc, name, _TRUNCATE);
    }
    CLSID clsid{};
    const bool hasClsid = readAsioClsid(sub, clsid);
    RegCloseKey(sub);

    const std::string label = wideToUtf8(desc[0] ? desc : name);
    if (label.empty()) continue;
    JaswaveAudioDevice d;
    d.backend = "asio";
    d.name = label;
    d.id = std::string("asio:") + label;
    const bool x64 = hasClsid && clsidHasInproc(clsid, KEY_WOW64_64KEY);
    const bool x86 = hasClsid && clsidHasInproc(clsid, KEY_WOW64_32KEY);
#if defined(_WIN64)
    d.available = x64;
    if (!d.available) d.name += x86 ? " (32-bit, no usable en JasWave x64)" : " (sin servidor COM)";
#else
    d.available = x86 || x64;
#endif
    d.isDefault = false;
    bool dup = false;
    for (auto& e : out) {
      if (e.id == d.id) {
        dup = true;
        if (d.available) e.available = true;
        break;
      }
    }
    if (!dup) out.push_back(std::move(d));
  }
  RegCloseKey(h);
}

bool findClsidForDriver(const std::string& driverName, CLSID& clsid, bool& only32, std::string& err) {
  only32 = false;
  const REGSAM views[] = {KEY_WOW64_64KEY, KEY_WOW64_32KEY};
  CLSID found32{};
  bool have32 = false;
  for (REGSAM wow : views) {
    HKEY h = nullptr;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\ASIO", 0, KEY_READ | wow, &h) != ERROR_SUCCESS) {
      continue;
    }
    for (DWORD i = 0; i < 128; ++i) {
      wchar_t name[256]{};
      DWORD nlen = 256;
      if (RegEnumKeyExW(h, i, name, &nlen, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
      HKEY sub = nullptr;
      if (RegOpenKeyExW(h, name, 0, KEY_READ | wow, &sub) != ERROR_SUCCESS) continue;
      wchar_t desc[256]{};
      DWORD dsz = sizeof(desc);
      RegGetValueW(sub, nullptr, L"Description", RRF_RT_REG_SZ, nullptr, desc, &dsz);
      CLSID id{};
      const bool ok = readAsioClsid(sub, id);
      RegCloseKey(sub);
      if (!ok) continue;
      const std::string keyUtf = wideToUtf8(name);
      const std::string descUtf = wideToUtf8(desc[0] ? desc : name);
      if (!iequalsUtf8(driverName, descUtf) && !iequalsUtf8(driverName, keyUtf)) continue;
      const bool x64 = clsidHasInproc(id, KEY_WOW64_64KEY);
      if (x64) {
        clsid = id;
        RegCloseKey(h);
        return true;
      }
      found32 = id;
      have32 = true;
    }
    RegCloseKey(h);
  }
  if (have32) {
    only32 = true;
    clsid = found32;
    err = "El driver ASIO «" + driverName +
          "» es 32-bit. JasWave es 64-bit: instala el ASIO x64 del fabricante.";
    return false;
  }
  err = "Driver ASIO no encontrado en el registro: " + driverName;
  return false;
}

IASIO* instantiateAsio(const CLSID& clsid, std::string& err) {
  // Steinberg: el IID del driver es el mismo GUID que el CLSID. Castear IUnknown→IASIO
  // cuando CoCreateInstance(clsid) falla (E_NOINTERFACE) llama métodos en el vtable
  // equivocado y termina en heap 0xC0000374.
  IASIO* drv = nullptr;
  HRESULT hr = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, clsid,
                                reinterpret_cast<void**>(&drv));
  if (FAILED(hr) || !drv) {
    err = "CoCreateInstance ASIO falló (" + hresultHex(hr) +
          "). Usa el ASIO x64 de tu interfaz o WASAPI; no wrappers (FL Studio ASIO).";
    return nullptr;
  }
  return drv;
}

IASIO* createDriver(const std::string& driverName, std::string& err) {
  CLSID clsid{};
  bool only32 = false;
  if (!findClsidForDriver(driverName, clsid, only32, err)) return nullptr;
  return instantiateAsio(clsid, err);
}

HWND asioSysHandle() {
  const auto p = reinterpret_cast<HWND>(gSysHwnd.load(std::memory_order_acquire));
  if (p && IsWindow(p)) return p;
  return GetDesktopWindow();
}

}  // namespace

void jaswave_asio_set_sys_handle(void* hwnd) {
  gSysHwnd.store(reinterpret_cast<uintptr_t>(hwnd), std::memory_order_release);
}

bool jaswave_asio_list_drivers(std::vector<JaswaveAudioDevice>& out) {
  enumAsioView(KEY_WOW64_64KEY, out);
  enumAsioView(KEY_WOW64_32KEY, out);
  return true;
}

void jaswave_asio_stop() {
  std::lock_guard<std::mutex> lock(gAsioMu);
  gRunning.store(false, std::memory_order_release);
  for (int i = 0; i < 80 && gInCallback.load(std::memory_order_acquire) > 0; ++i) {
    Sleep(1);
  }
  if (gDriver) {
    gDriver->stop();
    if (gBuffersCreated) gDriver->disposeBuffers();
    gDriver->Release();
    gDriver = nullptr;
  }
  gBuffersCreated = false;
  gOutChannels = 0;
  gNeedOutputReady = false;
  gDriverName.clear();
}

bool jaswave_asio_start(const std::string& driverName, uint32_t sampleRate, uint32_t bufferSize,
                        std::string& err) {
  jaswave_asio_stop();
  std::lock_guard<std::mutex> lock(gAsioMu);
  if (isAsioWrapperName(driverName)) {
    err = "«" + driverName +
          "» es un wrapper (FL Studio / Generic Low Latency) y suele corromper el host. "
          "Usa WASAPI o el ASIO x64 de tu interfaz.";
    return false;
  }
  IASIO* drv = createDriver(driverName, err);
  if (!drv) return false;
  // Un solo init. Varios drivers devuelven 0 (= ASE_OK) en éxito; re-llamar init()
  // (hwnd / desktop / nullptr) es lo que provocaba el heap 0xC0000374.
  drv->init(GetDesktopWindow());
  long inCh = 0, outCh = 0;
  if (drv->getChannels(&inCh, &outCh) != ASE_OK || outCh < 1) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO init/getChannels: ") +
          (msg[0] ? msg : "el driver rechazó el host (¿ASIO ya abierto en otra DAW?)");
    drv->Release();
    return false;
  }
  ASIOSampleRate sr = sampleRate > 0 ? static_cast<ASIOSampleRate>(sampleRate) : 48000;
  if (drv->canSampleRate(sr) != ASE_OK) {
    if (drv->getSampleRate(&sr) != ASE_OK) sr = 48000;
  } else {
    drv->setSampleRate(sr);
  }
  long minB = 0, maxB = 0, prefB = 0, gran = 0;
  drv->getBufferSize(&minB, &maxB, &prefB, &gran);
  long buf = snapAsioBuffer(static_cast<long>(bufferSize), minB, maxB, prefB, gran);

  ASIOChannelInfo ci{};
  ci.channel = 0;
  ci.isInput = ASIOFalse;
  drv->getChannelInfo(&ci);
  gSampleType = ci.type;

  const long nCh = std::min(outCh, 32L);
  std::memset(gBufInfo, 0, sizeof(gBufInfo));
  for (long c = 0; c < nCh; ++c) {
    gBufInfo[c].isInput = ASIOFalse;
    gBufInfo[c].channelNum = c;
  }

  gCb.bufferSwitch = CALLBACK_bufferSwitch;
  gCb.sampleRateDidChange = CALLBACK_sampleRateDidChange;
  gCb.asioMessage = CALLBACK_asioMessage;
  gCb.bufferSwitchTimeInfo = CALLBACK_bufferSwitchTimeInfo;

  if (drv->createBuffers(gBufInfo, nCh, buf, &gCb) != ASE_OK) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO createBuffers: ") + (msg[0] ? msg : "falló");
    drv->Release();
    return false;
  }
  gBuffersCreated = true;
  gOutChannels = nCh;
  gNeedOutputReady = (drv->outputReady() == ASE_OK);
  gSr = static_cast<uint32_t>(sr > 0 ? sr : 48000);
  gBuf = static_cast<uint32_t>(std::min(buf, 8192L));
  gDriver = drv;
  gDriverName = driverName;
  gRunning.store(true, std::memory_order_release);
  if (drv->start() != ASE_OK) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO start: ") + (msg[0] ? msg : "falló");
    gRunning.store(false, std::memory_order_release);
    drv->disposeBuffers();
    gBuffersCreated = false;
    drv->Release();
    gDriver = nullptr;
    gOutChannels = 0;
    gNeedOutputReady = false;
    return false;
  }
  return true;
}

bool jaswave_asio_running() { return gRunning.load(); }
uint32_t jaswave_asio_sample_rate() { return gSr; }
uint32_t jaswave_asio_buffer_size() { return gBuf; }

bool jaswave_asio_control_panel(const std::string& driverName, std::string& err) {
  std::lock_guard<std::mutex> lock(gAsioMu);
  if (gDriver && (driverName.empty() || driverName == gDriverName)) {
    gDriver->controlPanel();
    return true;
  }
  IASIO* drv = createDriver(driverName, err);
  if (!drv) return false;
  drv->init(GetDesktopWindow());
  drv->controlPanel();
  drv->Release();
  return true;
}

#endif  // _WIN32
