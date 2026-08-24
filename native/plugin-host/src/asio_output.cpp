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
#include <ole2.h>

#include "asio_output.h"
#include "asio_com.h"
#include "audio_output.h"

#include <unknwn.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <mutex>
#include <string>
#include <vector>

typedef long ASIOBool;
typedef long ASIOError;
typedef double ASIOSampleRate;

/* Steinberg ASIO 2.3: pack(4). Sin esto, ASIOTime/ASIOClockSource no coinciden en x64. */
#pragma pack(push, 4)

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

#pragma pack(pop)

static_assert(sizeof(ASIOBufferInfo) == 24, "ASIOBufferInfo must be 24 bytes on x64");
static_assert(offsetof(ASIOBufferInfo, buffers) == 8, "ASIOBufferInfo.buffers offset");

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
HWND gAsioHwnd{nullptr};
IASIO* gDriver{nullptr};
std::atomic<bool> gRunning{false};
std::atomic<int> gInCallback{0};
uint32_t gSr{48000};
uint32_t gBuf{512};
long gSampleType{ASIOSTInt32LSB};
long gOutChannels{0};
long gNumBufInfos{0};
bool gNeedOutputReady{false};
bool gBuffersCreated{false};
ASIOBufferInfo gBufInfo[64]{};
long gChanType[64]{};
ASIOCallbacks gCb{};
std::string gDriverName;
float gScratch[8192 * 2]{};
float gAsioL[8192];
float gAsioR[8192];

HWND ensureAsioHostWindow() {
  if (gAsioHwnd && IsWindow(gAsioHwnd)) return gAsioHwnd;
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = DefWindowProcW;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"JasWaveAsioHost";
  if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    return nullptr;
  }
  gAsioHwnd = CreateWindowExW(WS_EX_NOACTIVATE, L"JasWaveAsioHost", L"JasWave ASIO",
                              WS_OVERLAPPEDWINDOW, 0, 0, 8, 8, nullptr, nullptr, wc.hInstance,
                              nullptr);
  if (gAsioHwnd) ShowWindow(gAsioHwnd, SW_HIDE);
  return gAsioHwnd;
}

bool isAsioWrapperName(const std::string& name) {
  std::string n = name;
  for (char& c : n) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return n.find("fl studio") != std::string::npos || n.find("generic low latency") != std::string::npos;
}

const char* sampleTypeName(long type) {
  switch (type) {
    case ASIOSTInt16LSB: return "Int16LSB";
    case ASIOSTInt24LSB: return "Int24LSB";
    case ASIOSTInt32LSB: return "Int32LSB";
    case ASIOSTInt32LSB24: return "Int32LSB24";
    case ASIOSTFloat32LSB: return "Float32LSB";
    default: return "other";
  }
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
          double s = static_cast<double>(src[i]);
          if (s > 1.0) s = 1.0;
          if (s < -1.0) s = -1.0;
          const double scaled = s * 2147483647.0;
          const double clamped =
              scaled > 2147483647.0 ? 2147483647.0 : (scaled < -2147483647.0 ? -2147483647.0 : scaled);
          d[i] = static_cast<int32_t>(std::lrint(clamped));
        }
        break;
      }
    case ASIOSTInt32LSB24: {
      auto* d = static_cast<int32_t*>(dest);
      for (int i = 0; i < frames; ++i) {
        double s = static_cast<double>(src[i]);
        if (s > 1.0) s = 1.0;
        if (s < -1.0) s = -1.0;
        const double scaled = s * 8388607.0;
        const double clamped =
            scaled > 8388607.0 ? 8388607.0 : (scaled < -8388607.0 ? -8388607.0 : scaled);
        d[i] = static_cast<int32_t>(std::lrint(clamped)) << 8;
      }
      break;
    }
    default:
      silenceAsioChannel(dest, frames, type);
      break;
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
        case kAsioSupportsTimeCode:
          return 1;
        default:
          return 0;
      }
    case kAsioEngineVersion:
      return 2;
    case kAsioResetRequest:
    case kAsioBufferSizeChange:
    case kAsioResyncRequest:
    case kAsioLatenciesChanged:
      return 1;
    case kAsioSupportsTimeInfo:
      return 1;
    case kAsioSupportsTimeCode:
      return 1;
    default:
      return 0;
  }
}

void CALLBACK_sampleRateDidChange(ASIOSampleRate sRate) {
  if (sRate > 0) gSr = static_cast<uint32_t>(sRate);
}

ASIOTime* CALLBACK_bufferSwitchTimeInfo(ASIOTime* /*params*/, long doubleBufferIndex,
                                        ASIOBool directProcess) {
  CALLBACK_bufferSwitch(doubleBufferIndex, directProcess);
  return nullptr;
}

void bufferSwitchBody(long index) {
  const bool running = gRunning.load(std::memory_order_acquire);
  const int frames = std::min(static_cast<int>(gBuf), 8192);
  if (index < 0 || index > 1 || frames <= 0) return;
  long outSeen = 0;
  for (long i = 0; i < gNumBufInfos && i < 64; ++i) {
    if (gBufInfo[i].isInput) continue;
    void* dest = gBufInfo[i].buffers[index];
    if (!dest) continue;
    const long type = gChanType[i] ? gChanType[i] : gSampleType;
    if (!running) {
      silenceAsioChannel(dest, frames, type);
      continue;
    }
    if (outSeen == 0) {
      std::fill(gScratch, gScratch + frames * 2, 0.f);
      if (gRenderProc) gRenderProc(gScratch, static_cast<uint32_t>(frames));
      jaswave_audio_mix_test_tone(gScratch, static_cast<uint32_t>(frames), gSr ? gSr : 48000);
      for (int s = 0; s < frames; ++s) {
        gAsioL[s] = gScratch[s * 2];
        gAsioR[s] = gScratch[s * 2 + 1];
      }
      writeAsioChannel(dest, gAsioL, frames, type, false);
    } else if (outSeen == 1) {
      writeAsioChannel(dest, gAsioR, frames, type, false);
    } else {
      silenceAsioChannel(dest, frames, type);
    }
    ++outSeen;
  }
}

void CALLBACK_bufferSwitch(long index, ASIOBool /*directProcess*/) {
  gInCallback.fetch_add(1, std::memory_order_acq_rel);
#if defined(_MSC_VER)
  __try {
    bufferSwitchBody(index);
    if (gNeedOutputReady && gDriver) {
      const int rc = jaswave_asio_seh_output_ready(gDriver);
      if (rc != ASE_OK) gNeedOutputReady = false;
    }
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    gNeedOutputReady = false;
  }
#else
  bufferSwitchBody(index);
  if (gNeedOutputReady && gDriver) {
    const int rc = jaswave_asio_seh_output_ready(gDriver);
    if (rc != ASE_OK) gNeedOutputReady = false;
  }
#endif
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

bool inprocServerPath(const CLSID& clsid, REGSAM wow, std::wstring& dll) {
  wchar_t guid[64]{};
  if (StringFromGUID2(clsid, guid, 64) <= 0) return false;
  const std::wstring path = std::wstring(L"SOFTWARE\\Classes\\CLSID\\") + guid + L"\\InprocServer32";
  HKEY h = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0, KEY_READ | wow, &h) != ERROR_SUCCESS) {
    return false;
  }
  wchar_t buf[MAX_PATH]{};
  DWORD sz = sizeof(buf);
  const LONG st = RegGetValueW(h, nullptr, nullptr, RRF_RT_REG_SZ, nullptr, buf, &sz);
  RegCloseKey(h);
  if (st != ERROR_SUCCESS || !buf[0]) return false;
  dll = buf;
  return true;
}

bool clsidHasInproc(const CLSID& clsid, REGSAM wow) {
  std::wstring dll;
  return inprocServerPath(clsid, wow, dll);
}

bool ensureStaApartment(std::string& err) {
  jaswave_com_restore_sta();
  APTTYPE apt = APTTYPE_MTA;
  APTTYPEQUALIFIER qual = APTTYPEQUALIFIER_NONE;
  const HRESULT aptHr = CoGetApartmentType(&apt, &qual);
  if (FAILED(aptHr) || apt == APTTYPE_MTA) {
    err =
        "ASIO requiere un hilo STA (como REAPER/Cubase). No se pudo recuperar el apartment COM.";
    return false;
  }
  return true;
}

IASIO* adoptIfAsio(IUnknown* unk, const char* via) {
  if (!unk) return nullptr;
  char name[64]{};
  if (!jaswave_asio_probe_name(unk, name, 64)) {
    unk->Release();
    return nullptr;
  }
  std::cerr << "[jaswave-plugin-host] ASIO " << via << " «" << name << "»\n";
  return reinterpret_cast<IASIO*>(unk);
}

IASIO* instantiateViaClassFactory(const CLSID& clsid, std::string& err) {
  std::wstring dllPath;
  if (!inprocServerPath(clsid, KEY_WOW64_64KEY, dllPath)) {
    err = "El CLSID ASIO no tiene InprocServer32 x64.";
    return nullptr;
  }
  HMODULE mod = LoadLibraryW(dllPath.c_str());
  if (!mod) {
    err = "LoadLibrary del driver ASIO falló.";
    return nullptr;
  }
  static std::vector<HMODULE> kept;
  kept.push_back(mod);

  using DllGetClassObjectFn = HRESULT(STDAPICALLTYPE*)(REFCLSID, REFIID, LPVOID*);
  auto pfn = reinterpret_cast<DllGetClassObjectFn>(GetProcAddress(mod, "DllGetClassObject"));
  if (!pfn) {
    err = "El DLL ASIO no exporta DllGetClassObject.";
    return nullptr;
  }
  IClassFactory* factory = nullptr;
  const HRESULT gco = pfn(clsid, IID_IClassFactory, reinterpret_cast<void**>(&factory));
  if (FAILED(gco) || !factory) {
    err = "DllGetClassObject falló (" + hresultHex(gco) + ").";
    return nullptr;
  }

  IASIO* drv = nullptr;
  int hr = jaswave_com_factory_create(factory, &clsid, reinterpret_cast<void**>(&drv));
  if (hr == static_cast<int>(S_OK) && drv) {
    factory->Release();
    std::cerr << "[jaswave-plugin-host] ASIO class factory CLSID-as-IID ok\n";
    return drv;
  }

  IUnknown* unk = nullptr;
  hr = jaswave_com_factory_create(factory, &IID_IUnknown, reinterpret_cast<void**>(&unk));
  factory->Release();
  if (hr == static_cast<int>(S_OK) && unk) {
    if (auto* asio = adoptIfAsio(unk, "class factory IUnknown")) return asio;
  }
  err = "CreateInstance del driver ASIO falló (" + hresultHex(static_cast<HRESULT>(hr)) + ").";
  return nullptr;
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
  if (!ensureStaApartment(err)) return nullptr;

  APTTYPE apt = APTTYPE_STA;
  APTTYPEQUALIFIER qual = APTTYPEQUALIFIER_NONE;
  CoGetApartmentType(&apt, &qual);
  std::cerr << "[jaswave-plugin-host] ASIO instantiate apt=" << static_cast<int>(apt) << "\n";

  // Steinberg/JUCE: el IID es el CLSID. En STA eso suele bastar.
  IASIO* drv = nullptr;
  int hr = jaswave_com_create(&clsid, &clsid, reinterpret_cast<void**>(&drv));
  if (hr == static_cast<int>(S_OK) && drv) {
    std::cerr << "[jaswave-plugin-host] ASIO CoCreate CLSID-as-IID ok\n";
    return drv;
  }
  std::cerr << "[jaswave-plugin-host] ASIO CoCreate CLSID-as-IID hr=" << hresultHex(static_cast<HRESULT>(hr))
            << "\n";

  // UMC y otros no implementan QueryInterface(CLSID). En STA, IUnknown + probe de
  // getDriverName es el camino que usan hosts cuando COM devuelve E_NOINTERFACE.
  IUnknown* unk = nullptr;
  hr = jaswave_com_create(&clsid, &IID_IUnknown, reinterpret_cast<void**>(&unk));
  if (hr == static_cast<int>(S_OK) && unk) {
    if (auto* asio = adoptIfAsio(unk, "CoCreate IUnknown")) return asio;
  }

  std::string factoryErr;
  drv = instantiateViaClassFactory(clsid, factoryErr);
  if (drv) return drv;

  err = "No se pudo instanciar el driver ASIO (" + hresultHex(static_cast<HRESULT>(hr)) +
        "). Cierra Cubase/REAPER/FL si tienen el interfaz abierto, o usa WASAPI. " + factoryErr;
  return nullptr;
}

IASIO* createDriver(const std::string& driverName, std::string& err) {
  CLSID clsid{};
  bool only32 = false;
  if (!findClsidForDriver(driverName, clsid, only32, err)) return nullptr;
  return instantiateAsio(clsid, err);
}

HWND asioSysHandle() {
  /* REAPER pasa un HWND del mismo proceso. Nunca el de Electron ni el desktop
   * (otro PID): UMC ASIO hace subclass/SetWindowLong y corrompe el heap. */
  HWND owned = ensureAsioHostWindow();
  if (owned && IsWindow(owned)) return owned;
  return nullptr;
}

}  // namespace

void jaswave_com_restore_sta() {
  APTTYPE apt = APTTYPE_STA;
  APTTYPEQUALIFIER qual = APTTYPEQUALIFIER_NONE;
  const HRESULT hr = CoGetApartmentType(&apt, &qual);
  if (hr == CO_E_NOTINITIALIZED) {
    OleInitialize(nullptr);
    return;
  }
  if (SUCCEEDED(hr) && apt == APTTYPE_MTA) {
    CoUninitialize();
    OleInitialize(nullptr);
  }
}

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
  gNumBufInfos = 0;
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
  HWND sys = asioSysHandle();
  std::cerr << "[jaswave-plugin-host] ASIO init «" << driverName << "» hwnd=" << static_cast<void*>(sys)
            << "\n";
  const int initRc = jaswave_asio_seh_init(drv, sys);
  if (initRc < 0) {
    err = "El driver ASIO crasheó en init(). Cierra otras DAWs que lo tengan abierto o usa WASAPI.";
    drv->Release();
    return false;
  }
  {
    char dn[64]{};
    drv->getDriverName(dn);  // algunos drivers (UMC) esperan esta llamada tras init
    (void)drv->getDriverVersion();
  }
  long inCh = 0, outCh = 0;
  if (drv->getChannels(&inCh, &outCh) != ASE_OK || outCh < 1) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO init/getChannels: ") +
          (msg[0] ? msg : "el driver rechazó el host (¿ASIO ya abierto en otra DAW?)");
    drv->Release();
    return false;
  }
  std::cerr << "[jaswave-plugin-host] ASIO channels in=" << inCh << " out=" << outCh << "\n";

  ASIOSampleRate sr = sampleRate > 0 ? static_cast<ASIOSampleRate>(sampleRate) : 48000;
  if (drv->canSampleRate(sr) != ASE_OK) {
    if (drv->getSampleRate(&sr) != ASE_OK) sr = 48000;
  } else {
    drv->setSampleRate(sr);
  }
  long minB = 0, maxB = 0, prefB = 0, gran = 0;
  drv->getBufferSize(&minB, &maxB, &prefB, &gran);
  std::cerr << "[jaswave-plugin-host] ASIO buf min=" << minB << " max=" << maxB << " pref=" << prefB
            << " gran=" << gran << " want=" << bufferSize << "\n";
  long want = static_cast<long>(bufferSize);
  if (want <= 0) want = prefB > 0 ? prefB : 256;
  /* Solo snapeo al rango/granularidad del driver — no forzar piso artificial. */
  const long buf = snapAsioBuffer(want, minB, maxB, prefB > 0 ? prefB : want, gran);
  std::cerr << "[jaswave-plugin-host] ASIO using buffer=" << buf << " (driver min=" << minB
            << " max=" << maxB << " pref=" << prefB << ")\n";

  auto fillInfos = [&](long nIn, long nOut) -> long {
    long n = 0;
    std::memset(gBufInfo, 0, sizeof(gBufInfo));
    std::memset(gChanType, 0, sizeof(gChanType));
    for (long c = 0; c < nIn && n < 64; ++c) {
      gBufInfo[n].isInput = ASIOTrue;
      gBufInfo[n].channelNum = c;
      ASIOChannelInfo ci{};
      ci.channel = c;
      ci.isInput = ASIOTrue;
      gChanType[n] = (drv->getChannelInfo(&ci) == ASE_OK) ? ci.type : ASIOSTInt32LSB;
      ++n;
    }
    for (long c = 0; c < nOut && n < 64; ++c) {
      gBufInfo[n].isInput = ASIOFalse;
      gBufInfo[n].channelNum = c;
      ASIOChannelInfo ci{};
      ci.channel = c;
      ci.isInput = ASIOFalse;
      gChanType[n] = (drv->getChannelInfo(&ci) == ASE_OK) ? ci.type : ASIOSTInt32LSB;
      ++n;
    }
    return n;
  };

  /* Como REAPER: createBuffers de TODAS las entradas y salidas que declara el driver. */
  long nInfos = fillInfos(inCh, outCh);
  long outInfos = 0;
  for (long i = 0; i < nInfos; ++i) {
    if (!gBufInfo[i].isInput) ++outInfos;
  }
  gSampleType = ASIOSTInt32LSB;
  for (long i = 0; i < nInfos; ++i) {
    if (!gBufInfo[i].isInput) {
      gSampleType = gChanType[i];
      break;
    }
  }

  gCb.bufferSwitch = CALLBACK_bufferSwitch;
  gCb.sampleRateDidChange = CALLBACK_sampleRateDidChange;
  gCb.asioMessage = CALLBACK_asioMessage;
  gCb.bufferSwitchTimeInfo = CALLBACK_bufferSwitchTimeInfo;

  std::cerr << "[jaswave-plugin-host] ASIO createBuffers infos=" << nInfos << " out=" << outInfos
            << " buf=" << buf << " sr=" << sr << " type=" << sampleTypeName(gSampleType) << "("
            << gSampleType << ")\n";
  ASIOError created = drv->createBuffers(gBufInfo, nInfos, buf, &gCb);
  if (created != ASE_OK) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO createBuffers: ") + (msg[0] ? msg : "falló");
    drv->Release();
    return false;
  }
  gBuffersCreated = true;
  gOutChannels = outInfos;
  gNumBufInfos = nInfos;
  gSr = static_cast<uint32_t>(sr > 0 ? sr : 48000);
  gBuf = static_cast<uint32_t>(std::min(buf, 8192L));
  gDriver = drv;
  gDriverName = driverName;

  for (long i = 0; i < nInfos; ++i) {
    ASIOChannelInfo ci{};
    ci.channel = gBufInfo[i].channelNum;
    ci.isInput = gBufInfo[i].isInput;
    if (drv->getChannelInfo(&ci) == ASE_OK) gChanType[i] = ci.type;
  }

  long inLat = 0, outLat = 0;
  drv->getLatencies(&inLat, &outLat);
  /* No llamar outputReady antes de start(): en UMC eso AV. Se prueba en el primer callback. */
  gNeedOutputReady = true;
  std::cerr << "[jaswave-plugin-host] ASIO lat in=" << inLat << " out=" << outLat
            << " (outputReady en callback, como REAPER)\n";

  if (drv->start() != ASE_OK) {
    char msg[256]{};
    drv->getErrorMessage(msg);
    err = std::string("ASIO start: ") + (msg[0] ? msg : "falló");
    drv->disposeBuffers();
    gBuffersCreated = false;
    drv->Release();
    gDriver = nullptr;
    gOutChannels = 0;
    gNumBufInfos = 0;
    gNeedOutputReady = false;
    return false;
  }
  gRunning.store(true, std::memory_order_release);
  std::cerr << "[jaswave-plugin-host] ASIO running «" << driverName << "»\n";
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
  drv->init(asioSysHandle());
  drv->controlPanel();
  drv->Release();
  return true;
}

#endif  // _WIN32
