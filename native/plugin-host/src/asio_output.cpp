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
#include <cmath>
#include <cstring>
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
IASIO* gDriver{nullptr};
std::atomic<bool> gRunning{false};
std::atomic<int> gInCallback{0};
uint32_t gSr{48000};
uint32_t gBuf{512};
long gSampleType{ASIOSTFloat32LSB};
bool gNeedOutputReady{false};
ASIOBufferInfo gBufInfo[2]{};
ASIOCallbacks gCb{};
std::string gDriverName;
float gScratch[8192 * 2]{};
float gAsioL[8192];
float gAsioR[8192];
HWND gHostWnd{nullptr};

HWND asioHostWindow() {
  if (gHostWnd && IsWindow(gHostWnd)) return gHostWnd;
  WNDCLASSW wc{};
  wc.lpfnWndProc = DefWindowProcW;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"JasWaveAsioHost";
  RegisterClassW(&wc);
  gHostWnd = CreateWindowExW(WS_EX_TOOLWINDOW, L"JasWaveAsioHost", L"JasWave ASIO",
                             WS_OVERLAPPED, 0, 0, 16, 16, nullptr, nullptr, wc.hInstance, nullptr);
  return gHostWnd ? gHostWnd : GetDesktopWindow();
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
  if (gBufInfo[1].buffers[index] && gBufInfo[1].buffers[index] != gBufInfo[0].buffers[index]) {
    writeAsioChannel(gBufInfo[1].buffers[index], gAsioR, frames, gSampleType, false);
  }
  if (gNeedOutputReady && gDriver) gDriver->outputReady();
  gInCallback.fetch_sub(1, std::memory_order_acq_rel);
}

bool clsidFromRegistry(const std::wstring& keyPath, CLSID& clsid) {
  HKEY h = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, keyPath.c_str(), 0, KEY_READ | KEY_WOW64_64KEY, &h) !=
      ERROR_SUCCESS) {
    return false;
  }
  wchar_t buf[128]{};
  DWORD sz = sizeof(buf);
  const LONG st = RegGetValueW(h, nullptr, L"CLSID", RRF_RT_REG_SZ, nullptr, buf, &sz);
  RegCloseKey(h);
  if (st != ERROR_SUCCESS) return false;
  return SUCCEEDED(CLSIDFromString(buf, &clsid));
}

void enumAsioKey(HKEY root, const wchar_t* path, std::vector<JaswaveAudioDevice>& out) {
  HKEY h = nullptr;
  if (RegOpenKeyExW(root, path, 0, KEY_READ | KEY_WOW64_64KEY, &h) != ERROR_SUCCESS) return;
  for (DWORD i = 0; i < 128; ++i) {
    wchar_t name[256]{};
    DWORD nlen = 256;
    if (RegEnumKeyExW(h, i, name, &nlen, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
    wchar_t desc[256]{};
    DWORD dsz = sizeof(desc);
    HKEY sub = nullptr;
    if (RegOpenKeyExW(h, name, 0, KEY_READ | KEY_WOW64_64KEY, &sub) != ERROR_SUCCESS) continue;
    if (RegGetValueW(sub, nullptr, L"Description", RRF_RT_REG_SZ, nullptr, desc, &dsz) != ERROR_SUCCESS) {
      wcsncpy_s(desc, name, _TRUNCATE);
    }
    RegCloseKey(sub);
    char utf8[512]{};
    WideCharToMultiByte(CP_UTF8, 0, desc[0] ? desc : name, -1, utf8, sizeof(utf8), nullptr, nullptr);
    JaswaveAudioDevice d;
    d.backend = "asio";
    d.name = utf8;
    d.id = std::string("asio:") + utf8;
    d.available = true;
    d.isDefault = out.empty();
    bool dup = false;
    for (const auto& e : out) {
      if (e.id == d.id) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push_back(std::move(d));
  }
  RegCloseKey(h);
}

IASIO* createDriver(const std::string& driverName, std::string& err) {
  const std::wstring wname(driverName.begin(), driverName.end());
  CLSID clsid{};
  bool found = clsidFromRegistry(L"SOFTWARE\\ASIO\\" + wname, clsid);
  if (!found) {
    // Recorre subclaves por Description == driverName
    HKEY h = nullptr;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\ASIO", 0, KEY_READ | KEY_WOW64_64KEY, &h) ==
        ERROR_SUCCESS) {
      for (DWORD i = 0; i < 128 && !found; ++i) {
        wchar_t name[256]{};
        DWORD nlen = 256;
        if (RegEnumKeyExW(h, i, name, &nlen, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS)
          break;
        wchar_t desc[256]{};
        DWORD dsz = sizeof(desc);
        HKEY sub = nullptr;
        if (RegOpenKeyExW(h, name, 0, KEY_READ | KEY_WOW64_64KEY, &sub) != ERROR_SUCCESS) continue;
        RegGetValueW(sub, nullptr, L"Description", RRF_RT_REG_SZ, nullptr, desc, &dsz);
        wchar_t clsidStr[128]{};
        DWORD csz = sizeof(clsidStr);
        const LONG ok = RegGetValueW(sub, nullptr, L"CLSID", RRF_RT_REG_SZ, nullptr, clsidStr, &csz);
        RegCloseKey(sub);
        char utf8[512]{};
        WideCharToMultiByte(CP_UTF8, 0, desc[0] ? desc : name, -1, utf8, sizeof(utf8), nullptr, nullptr);
        if (ok == ERROR_SUCCESS && driverName == utf8) {
          found = SUCCEEDED(CLSIDFromString(clsidStr, &clsid));
        }
      }
      RegCloseKey(h);
    }
  }
  if (!found) {
    err = "Driver ASIO no encontrado en el registro: " + driverName;
    return nullptr;
  }
  IASIO* drv = nullptr;
  const HRESULT hr =
      CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, clsid, reinterpret_cast<void**>(&drv));
  if (FAILED(hr) || !drv) {
    err = "CoCreateInstance ASIO falló (HRESULT=" + std::to_string(static_cast<long>(hr)) + ")";
    return nullptr;
  }
  return drv;
}

}  // namespace

bool jaswave_asio_list_drivers(std::vector<JaswaveAudioDevice>& out) {
  enumAsioKey(HKEY_LOCAL_MACHINE, L"SOFTWARE\\ASIO", out);
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
    gDriver->disposeBuffers();
    gDriver->Release();
    gDriver = nullptr;
  }
  gNeedOutputReady = false;
  gDriverName.clear();
}

bool jaswave_asio_start(const std::string& driverName, uint32_t sampleRate, uint32_t bufferSize,
                        std::string& err) {
  jaswave_asio_stop();
  std::lock_guard<std::mutex> lock(gAsioMu);
  IASIO* drv = createDriver(driverName, err);
  if (!drv) return false;
  HWND sys = asioHostWindow();
  if (!drv->init(sys)) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO init: ") + (msg[0] ? msg : "falló");
    drv->Release();
    return false;
  }
  long inCh = 0, outCh = 0;
  if (drv->getChannels(&inCh, &outCh) != ASE_OK || outCh < 1) {
    err = "El driver ASIO no tiene canales de salida";
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

  gBufInfo[0] = {};
  gBufInfo[0].isInput = ASIOFalse;
  gBufInfo[0].channelNum = 0;
  gBufInfo[1] = {};
  gBufInfo[1].isInput = ASIOFalse;
  gBufInfo[1].channelNum = outCh > 1 ? 1 : 0;

  gCb.bufferSwitch = CALLBACK_bufferSwitch;
  gCb.sampleRateDidChange = CALLBACK_sampleRateDidChange;
  gCb.asioMessage = CALLBACK_asioMessage;
  gCb.bufferSwitchTimeInfo = CALLBACK_bufferSwitchTimeInfo;

  const long nCh = outCh > 1 ? 2 : 1;
  if (drv->createBuffers(gBufInfo, nCh, buf, &gCb) != ASE_OK) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO createBuffers: ") + (msg[0] ? msg : "falló");
    drv->Release();
    return false;
  }
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
    drv->Release();
    gDriver = nullptr;
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
  HWND sys = asioHostWindow();
  if (!drv->init(sys)) {
    err = "ASIO init para panel de control falló";
    drv->Release();
    return false;
  }
  drv->controlPanel();
  drv->Release();
  return true;
}

#endif  // _WIN32
