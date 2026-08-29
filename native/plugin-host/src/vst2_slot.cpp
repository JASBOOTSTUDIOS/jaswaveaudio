/**
 * Hosting VST2 mínimo (Windows x64): processReplacing + MIDI + editor HWND.
 */

#include "vst2_slot.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <mutex>
#include <vector>

#include "vst2/aeffect.h"

namespace {

constexpr float kInvSqrt2 = 0.70710678118f;

void constantPowerGains(float pan, float& gL, float& gR) {
  const float t = (pan + 1.f) * 0.5f;
  const float a = t * (3.14159265f * 0.5f);
  gL = std::cos(a) * kInvSqrt2 * 1.41421356f;
  gR = std::sin(a) * kInvSqrt2 * 1.41421356f;
}

bool readPeMachine(const std::string& path, uint16_t& machine) {
#ifdef _WIN32
  HANDLE h = CreateFileA(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                         FILE_ATTRIBUTE_NORMAL, nullptr);
  if (h == INVALID_HANDLE_VALUE) return false;
  IMAGE_DOS_HEADER dos{};
  DWORD rd = 0;
  if (!ReadFile(h, &dos, sizeof(dos), &rd, nullptr) || rd != sizeof(dos) || dos.e_magic != IMAGE_DOS_SIGNATURE) {
    CloseHandle(h);
    return false;
  }
  if (SetFilePointer(h, dos.e_lfanew, nullptr, FILE_BEGIN) == INVALID_SET_FILE_POINTER) {
    CloseHandle(h);
    return false;
  }
  DWORD peSig = 0;
  if (!ReadFile(h, &peSig, 4, &rd, nullptr) || peSig != IMAGE_NT_SIGNATURE) {
    CloseHandle(h);
    return false;
  }
  IMAGE_FILE_HEADER fh{};
  if (!ReadFile(h, &fh, sizeof(fh), &rd, nullptr) || rd != sizeof(fh)) {
    CloseHandle(h);
    return false;
  }
  machine = fh.Machine;
  CloseHandle(h);
  return true;
#else
  (void)path;
  (void)machine;
  return false;
#endif
}

}  // namespace

struct Vst2Slot::Impl {
  HMODULE module{nullptr};
  AEffect* effect{nullptr};
  double sampleRate{48000.0};
  int32_t blockSize{512};
  std::mutex midiMu;
  std::vector<VstMidiEvent> midiQueue;
  std::atomic<bool> playing{false};
  std::atomic<bool> crashed{false};
  double tempo{120.0};
  double ppqPos{0.0};
  double samplePos{0.0};
  bool transportChanged{true};
  VstTimeInfo timeInfo{};
  HWND editorHwnd{nullptr};
  HWND shellHwnd{nullptr};  // top-level cuando no hay parent Electron
  std::vector<float> inL, inR, outL, outR;
  std::vector<float*> inPtrs, outPtrs;

  static intptr_t VSTCALLBACK hostCallback(AEffect* effect, int32_t opcode, int32_t index,
                                           intptr_t value, void* ptr, float opt) {
    auto* self = effect ? static_cast<Impl*>(effect->user) : nullptr;
    switch (opcode) {
      case audioMasterVersion:
        return 2400;
      case audioMasterCurrentId:
        return effect ? effect->uniqueID : 0;
      case audioMasterIdle:
        return 0;
      case audioMasterWantMidi:
        return 1;
      case audioMasterGetVendorString:
        if (ptr) std::strncpy(static_cast<char*>(ptr), "JasWave", 63);
        return 1;
      case audioMasterGetProductString:
        if (ptr) std::strncpy(static_cast<char*>(ptr), "JasWave Host", 63);
        return 1;
      case audioMasterGetVendorVersion:
        return 1000;
      case audioMasterGetLanguage:
        return 1;  // English
      case audioMasterTempoAt:
        if (!self) return static_cast<intptr_t>(120.0 * 10000.0);
        return static_cast<intptr_t>(self->tempo * 10000.0);
      case audioMasterCanDo: {
        const char* s = static_cast<const char*>(ptr);
        if (!s) return 0;
        if (std::strcmp(s, "sendVstEvents") == 0) return 1;
        if (std::strcmp(s, "sendVstMidiEvent") == 0) return 1;
        if (std::strcmp(s, "receiveVstEvents") == 0) return 1;
        if (std::strcmp(s, "receiveVstMidiEvent") == 0) return 1;
        if (std::strcmp(s, "receiveVstTimeInfo") == 0) return 1;
        if (std::strcmp(s, "sizeWindow") == 0) return 1;
        if (std::strcmp(s, "supplyIdle") == 0) return 1;
        if (std::strcmp(s, "reportConnectionChanges") == 0) return 1;
        return 0;
      }
      case audioMasterGetTime: {
        if (!self) return 0;
        self->timeInfo.samplePos = self->samplePos;
        self->timeInfo.sampleRate = self->sampleRate;
        self->timeInfo.nanoSeconds = 0;
        self->timeInfo.ppqPos = self->ppqPos;
        self->timeInfo.tempo = self->tempo > 1.0 ? self->tempo : 120.0;
        self->timeInfo.barStartPos = std::floor(self->ppqPos / 4.0) * 4.0;
        self->timeInfo.cycleStartPos = 0;
        self->timeInfo.cycleEndPos = 0;
        self->timeInfo.timeSigNumerator = 4;
        self->timeInfo.timeSigDenominator = 4;
        self->timeInfo.smpteOffset = 0;
        self->timeInfo.smpteFrameRate = 0;
        self->timeInfo.samplesToNextClock = 0;
        int32_t flags = kVstTempoValid | kVstTimeSigValid | kVstNanosValid | kVstPpqPosValid |
                        kVstBarsValid;
        if (self->playing.load(std::memory_order_relaxed)) flags |= kVstTransportPlaying;
        if (self->transportChanged) {
          flags |= kVstTransportChanged;
          self->transportChanged = false;
        }
        self->timeInfo.flags = flags;
        return reinterpret_cast<intptr_t>(&self->timeInfo);
      }
      case audioMasterGetSampleRate:
        return self ? static_cast<intptr_t>(self->sampleRate) : 48000;
      case audioMasterGetBlockSize:
        return self ? self->blockSize : 512;
      case audioMasterGetCurrentProcessLevel:
        return kVstProcessLevelRealtime;
      case audioMasterSizeWindow:
        if (self && self->editorHwnd) {
          SetWindowPos(self->editorHwnd, nullptr, 0, 0, static_cast<int>(index),
                       static_cast<int>(value), SWP_NOMOVE | SWP_NOZORDER);
        }
        return 1;
      case audioMasterAutomate:
      case audioMasterBeginEdit:
      case audioMasterEndEdit:
        return 0;
      default:
        (void)index;
        (void)value;
        (void)opt;
        return 0;
    }
  }

  void ensureBuffers(int frames, int nIn, int nOut) {
    if (static_cast<int>(inL.size()) < frames) {
      inL.resize(static_cast<size_t>(frames));
      inR.resize(static_cast<size_t>(frames));
      outL.resize(static_cast<size_t>(frames));
      outR.resize(static_cast<size_t>(frames));
    }
    inPtrs.clear();
    outPtrs.clear();
    inPtrs.push_back(inL.data());
    if (nIn > 1) inPtrs.push_back(inR.data());
    while (static_cast<int>(inPtrs.size()) < nIn) inPtrs.push_back(inL.data());
    outPtrs.push_back(outL.data());
    if (nOut > 1) outPtrs.push_back(outR.data());
    while (static_cast<int>(outPtrs.size()) < nOut) outPtrs.push_back(outL.data());
  }

  void flushMidi(int frames) {
    if (frames <= 0) return;
    std::vector<VstMidiEvent> ready;
    std::vector<VstMidiEvent> keep;
    {
      std::lock_guard<std::mutex> lock(midiMu);
      keep.reserve(midiQueue.size());
      ready.reserve(midiQueue.size());
      for (auto& e : midiQueue) {
        if (e.deltaFrames >= frames) {
          e.deltaFrames -= frames;
          keep.push_back(e);
        } else {
          ready.push_back(e);
        }
      }
      midiQueue.swap(keep);
    }
    if (ready.empty() || !effect) return;
    std::vector<VstEvent*> ptrs;
    ptrs.reserve(ready.size());
    for (auto& e : ready) {
      e.deltaFrames = std::max(0, std::min(e.deltaFrames, frames - 1));
      ptrs.push_back(reinterpret_cast<VstEvent*>(&e));
    }
    // offsetof(events) es 16 en x64 (padding tras numEvents); no usar 4+8=12.
    const size_t header = offsetof(VstEvents, events);
    const size_t bytes = header + sizeof(VstEvent*) * ptrs.size();
    std::vector<uint8_t> raw(bytes, 0);
    auto* ev = reinterpret_cast<VstEvents*>(raw.data());
    ev->numEvents = static_cast<int32_t>(ptrs.size());
    ev->reserved = 0;
    auto** dest = reinterpret_cast<VstEvent**>(raw.data() + header);
    for (size_t i = 0; i < ptrs.size(); ++i) dest[i] = ptrs[i];
    effect->dispatcher(effect, effProcessEvents, 0, 0, ev, 0.f);
  }

  void pushMidi(uint8_t status, uint8_t d1, uint8_t d2, int delay) {
    VstMidiEvent e{};
    e.type = kVstMidiType;
    e.byteSize = sizeof(VstMidiEvent);
    e.deltaFrames = delay;
    e.midiData[0] = static_cast<char>(status);
    e.midiData[1] = static_cast<char>(d1);
    e.midiData[2] = static_cast<char>(d2);
    std::lock_guard<std::mutex> lock(midiMu);
    if (midiQueue.size() < 8192) midiQueue.push_back(e);
  }
};
namespace {

#ifdef _WIN32
constexpr UINT_PTR kEditIdleTimer = 1;
constexpr char kVst2ShellClass[] = "JasWaveVst2Shell";

LRESULT CALLBACK vst2ShellWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  if (msg == WM_TIMER && wp == kEditIdleTimer) {
    auto* effect = reinterpret_cast<AEffect*>(GetWindowLongPtrA(hwnd, GWLP_USERDATA));
    if (effect) effect->dispatcher(effect, effEditIdle, 0, 0, nullptr, 0.f);
    return 0;
  }
  if (msg == WM_CLOSE) {
    ShowWindow(hwnd, SW_HIDE);
    return 0;
  }
  if (msg == WM_DESTROY) {
    KillTimer(hwnd, kEditIdleTimer);
    return 0;
  }
  return DefWindowProcA(hwnd, msg, wp, lp);
}

void registerVst2ShellClass() {
  static bool once = false;
  if (once) return;
  once = true;
  WNDCLASSEXA wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = vst2ShellWndProc;
  wc.hInstance = GetModuleHandleA(nullptr);
  wc.lpszClassName = kVst2ShellClass;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  RegisterClassExA(&wc);
}
#endif

}  // namespace

#ifdef _WIN32
namespace {

struct SafeEntryCtx {
  PluginEntryProc entry{nullptr};
  audioMasterCallback cb{nullptr};
  AEffect* effect{nullptr};
  bool ok{false};
};

int vst2SehFilter(unsigned int /*code*/, struct _EXCEPTION_POINTERS* /*ep*/) {
  return EXCEPTION_EXECUTE_HANDLER;
}

void safeVst2Entry(SafeEntryCtx* ctx) {
  __try {
    ctx->effect = ctx->entry(ctx->cb);
    ctx->ok = true;
  } __except (vst2SehFilter(GetExceptionCode(), GetExceptionInformation())) {
    ctx->effect = nullptr;
    ctx->ok = false;
  }
}

struct SafeProcessCtx {
  AEffect* fx{nullptr};
  float** ins{nullptr};
  float** outs{nullptr};
  int frames{0};
  bool ok{false};
};

void safeVst2ProcessReplacing(SafeProcessCtx* ctx) {
  __try {
    if (ctx->fx->processReplacing)
      ctx->fx->processReplacing(ctx->fx, ctx->ins, ctx->outs, ctx->frames);
    else if (ctx->fx->process)
      ctx->fx->process(ctx->fx, ctx->ins, ctx->outs, ctx->frames);
    ctx->ok = true;
  } __except (vst2SehFilter(GetExceptionCode(), GetExceptionInformation())) {
    ctx->ok = false;
  }
}

struct SafeDispatchCtx {
  AEffect* fx{nullptr};
  int32_t op{0};
  int32_t index{0};
  intptr_t value{0};
  void* ptr{nullptr};
  float opt{0.f};
  bool ok{false};
};

void safeVst2Dispatch(SafeDispatchCtx* ctx) {
  __try {
    ctx->fx->dispatcher(ctx->fx, ctx->op, ctx->index, ctx->value, ctx->ptr, ctx->opt);
    ctx->ok = true;
  } __except (vst2SehFilter(GetExceptionCode(), GetExceptionInformation())) {
    ctx->ok = false;
  }
}

}  // namespace
#endif

bool Vst2Slot::isPe64Dll(const std::string& path) {
  uint16_t machine = 0;
  if (!readPeMachine(path, machine)) return false;
  return machine == IMAGE_FILE_MACHINE_AMD64;
}

Vst2Slot::Vst2Slot() : impl_(std::make_unique<Impl>()) {}
Vst2Slot::~Vst2Slot() { unload(); }

bool Vst2Slot::load(const std::string& path, std::string& err) {
  unload();
  path_ = path;
#ifdef _WIN32
  if (!isPe64Dll(path)) {
    err = "VST2 solo x64 (DLL 32-bit no soportada)";
    return false;
  }
  impl_->module = LoadLibraryA(path.c_str());
  if (!impl_->module) {
    err = "LoadLibrary falló para VST2";
    return false;
  }
  auto entry = reinterpret_cast<PluginEntryProc>(GetProcAddress(impl_->module, "VSTPluginMain"));
  if (!entry) entry = reinterpret_cast<PluginEntryProc>(GetProcAddress(impl_->module, "main"));
  if (!entry) {
    err = "DLL sin VSTPluginMain/main (no es VST2)";
    FreeLibrary(impl_->module);
    impl_->module = nullptr;
    return false;
  }
  SafeEntryCtx ctx{};
  ctx.entry = entry;
  ctx.cb = &Impl::hostCallback;
  safeVst2Entry(&ctx);
  AEffect* fx = ctx.ok ? ctx.effect : nullptr;
  if (!fx || fx->magic != kEffectMagic) {
    err = ctx.ok ? "AEffect inválido (no es VST2)" : "VST2 crasheó al abrir (SEH)";
    FreeLibrary(impl_->module);
    impl_->module = nullptr;
    return false;
  }
  fx->user = impl_.get();
  impl_->effect = fx;
  SafeDispatchCtx openCtx{};
  openCtx.fx = fx;
  openCtx.op = effOpen;
  safeVst2Dispatch(&openCtx);
  if (!openCtx.ok) {
    err = "VST2 crasheó en effOpen";
    impl_->effect = nullptr;
    FreeLibrary(impl_->module);
    impl_->module = nullptr;
    return false;
  }
  // Synths antiguos: declarar que el host envía MIDI.
  if (fx->flags & effFlagsIsSynth) {
    SafeDispatchCtx midiCtx{};
    midiCtx.fx = fx;
    midiCtx.op = effSetProgram;
    safeVst2Dispatch(&midiCtx);
  }
  impl_->crashed.store(false);
  return true;
#else
  err = "VST2 solo en Windows";
  return false;
#endif
}

bool Vst2Slot::prepare(double sampleRate, int32_t blockSize, std::string& err) {
  if (!impl_->effect) {
    err = "VST2 no cargado";
    return false;
  }
  impl_->sampleRate = sampleRate;
  impl_->blockSize = blockSize;
  auto* fx = impl_->effect;
  fx->dispatcher(fx, effSetSampleRate, 0, 0, nullptr, static_cast<float>(sampleRate));
  fx->dispatcher(fx, effSetBlockSize, 0, blockSize, nullptr, 0.f);
  fx->dispatcher(fx, effMainsChanged, 0, 1, nullptr, 0.f);
  fx->dispatcher(fx, effStartProcess, 0, 0, nullptr, 0.f);
  latencySamples_ = std::max(0, fx->initialDelay);
  prepared_.store(true);
  return true;
}

bool Vst2Slot::reprepare(double sampleRate, int32_t blockSize, std::string& err) {
  suspendForAudioRestart();
  return prepare(sampleRate, blockSize, err);
}

void Vst2Slot::suspendForAudioRestart() {
  waitNotProcessing();
  prepared_.store(false);
  if (!impl_->effect) return;
  auto* fx = impl_->effect;
  fx->dispatcher(fx, effStopProcess, 0, 0, nullptr, 0.f);
  fx->dispatcher(fx, effMainsChanged, 0, 0, nullptr, 0.f);
}

void Vst2Slot::unload() {
  closeEditor();
  waitNotProcessing();
  prepared_.store(false);
  if (impl_->effect) {
    impl_->effect->dispatcher(impl_->effect, effClose, 0, 0, nullptr, 0.f);
    impl_->effect = nullptr;
  }
#ifdef _WIN32
  if (impl_->module) {
    FreeLibrary(impl_->module);
    impl_->module = nullptr;
  }
#endif
  path_.clear();
}

void Vst2Slot::noteOn(int pitch, float velocity, int delaySamples) {
  const int v = std::max(1, std::min(127, static_cast<int>(velocity <= 1.f ? velocity * 127.f : velocity)));
  impl_->pushMidi(0x90, static_cast<uint8_t>(pitch & 0x7f), static_cast<uint8_t>(v), delaySamples);
}

void Vst2Slot::noteOff(int pitch, int delaySamples) {
  impl_->pushMidi(0x80, static_cast<uint8_t>(pitch & 0x7f), 0, delaySamples);
}

void Vst2Slot::midiCc(int cc, int value, int delaySamples) {
  impl_->pushMidi(0xB0, static_cast<uint8_t>(cc & 0x7f), static_cast<uint8_t>(value & 0x7f), delaySamples);
}

void Vst2Slot::allNotesOff() {
  impl_->pushMidi(0xB0, 123, 0, 0);
  impl_->pushMidi(0xB0, 120, 0, 0);
  for (int p = 0; p < 128; ++p) noteOff(p, 0);
}

void Vst2Slot::setParameterNormalized(uint32_t paramId, double normalized) {
  if (!impl_->effect) return;
  if (static_cast<int32_t>(paramId) >= impl_->effect->numParams) return;
  const float v = static_cast<float>(std::max(0.0, std::min(1.0, normalized)));
  impl_->effect->setParameter(impl_->effect, static_cast<int32_t>(paramId), v);
}

std::vector<Vst3ParamDesc> Vst2Slot::listParameters(int maxCount) {
  std::vector<Vst3ParamDesc> out;
  if (!impl_->effect) return out;
  const int n = std::min(impl_->effect->numParams, maxCount);
  char name[64]{};
  char label[64]{};
  char display[64]{};
  for (int i = 0; i < n; ++i) {
    std::memset(name, 0, sizeof(name));
    std::memset(label, 0, sizeof(label));
    std::memset(display, 0, sizeof(display));
    impl_->effect->dispatcher(impl_->effect, effGetParamName, i, 0, name, 0.f);
    impl_->effect->dispatcher(impl_->effect, effGetParamLabel, i, 0, label, 0.f);
    impl_->effect->dispatcher(impl_->effect, effGetParamDisplay, i, 0, display, 0.f);
    Vst3ParamDesc d;
    d.id = static_cast<uint32_t>(i);
    d.name = name[0] ? name : ("Param " + std::to_string(i));
    d.shortName = d.name;
    d.unit = label;
    d.display = display;
    d.normalized = impl_->effect->getParameter(impl_->effect, i);
    d.defaultNormalized = d.normalized;
    out.push_back(std::move(d));
  }
  return out;
}

void Vst2Slot::setPlaying(bool playing) {
  impl_->playing.store(playing, std::memory_order_relaxed);
  impl_->transportChanged = true;
}

void Vst2Slot::setTransport(bool playing, double tempoBpm, double ppqPos) {
  impl_->playing.store(playing, std::memory_order_relaxed);
  if (tempoBpm > 1.0 && tempoBpm < 999.0) impl_->tempo = tempoBpm;
  if (ppqPos >= 0.0) impl_->ppqPos = ppqPos;
  impl_->transportChanged = true;
}

void Vst2Slot::process(const float* inL, const float* inR, float* outL, float* outR, int frames) {
  if (impl_->crashed.load(std::memory_order_relaxed) || !prepared_.load() || !impl_->effect ||
      bypass_.load(std::memory_order_relaxed)) {
    if (inL && outL) std::memcpy(outL, inL, static_cast<size_t>(frames) * sizeof(float));
    else if (outL) std::memset(outL, 0, static_cast<size_t>(frames) * sizeof(float));
    if (inR && outR) std::memcpy(outR, inR, static_cast<size_t>(frames) * sizeof(float));
    else if (outR) std::memset(outR, 0, static_cast<size_t>(frames) * sizeof(float));
    return;
  }
  inProcess_.store(true, std::memory_order_release);
  auto* fx = impl_->effect;
  const int nIn = std::max(1, fx->numInputs);
  const int nOut = std::max(1, fx->numOutputs);
  impl_->ensureBuffers(frames, nIn, nOut);
  std::memset(impl_->inL.data(), 0, static_cast<size_t>(frames) * sizeof(float));
  std::memset(impl_->inR.data(), 0, static_cast<size_t>(frames) * sizeof(float));
  if (inL) std::memcpy(impl_->inL.data(), inL, static_cast<size_t>(frames) * sizeof(float));
  if (inR) std::memcpy(impl_->inR.data(), inR, static_cast<size_t>(frames) * sizeof(float));
  std::memset(impl_->outL.data(), 0, static_cast<size_t>(frames) * sizeof(float));
  std::memset(impl_->outR.data(), 0, static_cast<size_t>(frames) * sizeof(float));
  impl_->flushMidi(frames);
#ifdef _WIN32
  SafeProcessCtx pctx{};
  pctx.fx = fx;
  pctx.ins = impl_->inPtrs.data();
  pctx.outs = impl_->outPtrs.data();
  pctx.frames = frames;
  safeVst2ProcessReplacing(&pctx);
  if (!pctx.ok) {
    impl_->crashed.store(true, std::memory_order_relaxed);
    bypass_.store(true, std::memory_order_relaxed);
    if (outL) std::memset(outL, 0, static_cast<size_t>(frames) * sizeof(float));
    if (outR) std::memset(outR, 0, static_cast<size_t>(frames) * sizeof(float));
    inProcess_.store(false, std::memory_order_release);
    return;
  }
#else
  if (fx->processReplacing) {
    fx->processReplacing(fx, impl_->inPtrs.data(), impl_->outPtrs.data(), frames);
  } else if (fx->process) {
    fx->process(fx, impl_->inPtrs.data(), impl_->outPtrs.data(), frames);
  }
#endif
  if (outL) std::memcpy(outL, impl_->outL.data(), static_cast<size_t>(frames) * sizeof(float));
  if (outR) {
    if (nOut > 1) std::memcpy(outR, impl_->outR.data(), static_cast<size_t>(frames) * sizeof(float));
    else std::memcpy(outR, impl_->outL.data(), static_cast<size_t>(frames) * sizeof(float));
  }
  // Avance de reloj VST2 (PPQ / samplePos) para LFO/arps sincronizados.
  impl_->samplePos += static_cast<double>(frames);
  const double bpm = impl_->tempo > 1.0 ? impl_->tempo : 120.0;
  impl_->ppqPos += (static_cast<double>(frames) / impl_->sampleRate) * (bpm / 60.0);
  inProcess_.store(false, std::memory_order_release);
}

bool Vst2Slot::openEditor(std::uintptr_t parentHwnd, int x, int y, int w, int h, std::string& err) {
#ifdef _WIN32
  if (!impl_->effect || !(impl_->effect->flags & effFlagsHasEditor)) {
    err = "Plugin sin editor";
    return false;
  }
  closeEditor();
  registerVst2ShellClass();
  ERect* rect = nullptr;
  impl_->effect->dispatcher(impl_->effect, effEditGetRect, 0, 0, &rect, 0.f);
  const int ew = rect ? (rect->right - rect->left) : (w > 0 ? w : 800);
  const int eh = rect ? (rect->bottom - rect->top) : (h > 0 ? h : 500);
  const int vw = ew < 200 ? 800 : ew;
  const int vh = eh < 150 ? 500 : eh;

  HWND parent = parentHwnd ? reinterpret_cast<HWND>(parentHwnd) : nullptr;
  // Como VST3: si Electron no pasa HWND (evita deadlock), ventana top-level propia.
  if (!parent || !IsWindow(parent)) {
    HINSTANCE inst = GetModuleHandleA(nullptr);
    int sx = x;
    int sy = y;
    if (sx <= 0 && sy <= 0) {
      const int sw = GetSystemMetrics(SM_CXSCREEN);
      const int sh = GetSystemMetrics(SM_CYSCREEN);
      sx = std::max(40, (sw - vw) / 2);
      sy = std::max(40, (sh - vh) / 2);
    }
    impl_->shellHwnd = CreateWindowExA(
        WS_EX_APPWINDOW, kVst2ShellClass, "JasWave VST2",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_VISIBLE |
            WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        sx, sy, vw + 16, vh + 40, nullptr, nullptr, inst, nullptr);
    if (!impl_->shellHwnd) {
      err = "CreateWindow shell VST2 falló";
      return false;
    }
    SetWindowLongPtrA(impl_->shellHwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(impl_->effect));
    SetTimer(impl_->shellHwnd, kEditIdleTimer, 16, nullptr);
    parent = impl_->shellHwnd;
    x = 0;
    y = 0;
  }

  impl_->editorHwnd = CreateWindowExA(0, "STATIC", "", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN, x, y,
                                      vw, vh, parent, nullptr, GetModuleHandleA(nullptr), nullptr);
  if (!impl_->editorHwnd) {
    err = "CreateWindow editor falló";
    if (impl_->shellHwnd) {
      KillTimer(impl_->shellHwnd, kEditIdleTimer);
      DestroyWindow(impl_->shellHwnd);
      impl_->shellHwnd = nullptr;
    }
    return false;
  }
  impl_->effect->dispatcher(impl_->effect, effEditOpen, 0, 0, impl_->editorHwnd, 0.f);
  if (impl_->shellHwnd) {
    ShowWindow(impl_->shellHwnd, SW_SHOW);
    UpdateWindow(impl_->shellHwnd);
    SetForegroundWindow(impl_->shellHwnd);
  }
  // Idle inmediato: muchos VST2 no pintan hasta el primer effEditIdle.
  impl_->effect->dispatcher(impl_->effect, effEditIdle, 0, 0, nullptr, 0.f);
  return true;
#else
  (void)parentHwnd;
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  err = "Editor VST2 solo Windows";
  return false;
#endif
}

void Vst2Slot::setEditorBounds(int x, int y, int w, int h) {
#ifdef _WIN32
  if (impl_->editorHwnd) SetWindowPos(impl_->editorHwnd, nullptr, x, y, w, h, SWP_NOZORDER);
#else
  (void)x;
  (void)y;
  (void)w;
  (void)h;
#endif
}

void Vst2Slot::closeEditor() {
#ifdef _WIN32
  if (impl_->effect && impl_->editorHwnd) {
    impl_->effect->dispatcher(impl_->effect, effEditClose, 0, 0, nullptr, 0.f);
  }
  if (impl_->editorHwnd) {
    DestroyWindow(impl_->editorHwnd);
    impl_->editorHwnd = nullptr;
  }
  if (impl_->shellHwnd) {
    KillTimer(impl_->shellHwnd, kEditIdleTimer);
    DestroyWindow(impl_->shellHwnd);
    impl_->shellHwnd = nullptr;
  }
#endif
}

void Vst2Slot::idleEditor() {
  if (impl_->effect && impl_->editorHwnd) {
    impl_->effect->dispatcher(impl_->effect, effEditIdle, 0, 0, nullptr, 0.f);
  }
}

bool Vst2Slot::hasEditor() const {
  return impl_->effect && (impl_->effect->flags & effFlagsHasEditor);
}

bool Vst2Slot::getStateChunk(std::vector<uint8_t>& out, std::string& err) {
  out.clear();
  if (!impl_->effect) {
    err = "Sin effect";
    return false;
  }
  if (!(impl_->effect->flags & effFlagsProgramChunks)) {
    err = "Plugin sin chunks";
    return false;
  }
  void* data = nullptr;
  const intptr_t n = impl_->effect->dispatcher(impl_->effect, effGetChunk, 0, 0, &data, 0.f);
  if (n <= 0 || !data) {
    err = "effGetChunk vacío";
    return false;
  }
  out.resize(static_cast<size_t>(n));
  std::memcpy(out.data(), data, static_cast<size_t>(n));
  return true;
}

bool Vst2Slot::setStateChunk(const uint8_t* data, size_t nbytes, std::string& err) {
  if (!impl_->effect) {
    err = "Sin effect";
    return false;
  }
  if (!(impl_->effect->flags & effFlagsProgramChunks) || !data || nbytes == 0) {
    err = "Chunk inválido";
    return false;
  }
  const intptr_t r =
      impl_->effect->dispatcher(impl_->effect, effSetChunk, 0, static_cast<intptr_t>(nbytes),
                                const_cast<uint8_t*>(data), 0.f);
  if (r == 0) {
    err = "effSetChunk falló";
    return false;
  }
  return true;
}

void Vst2Slot::waitNotProcessing() {
  for (int i = 0; i < 2000 && inProcess_.load(std::memory_order_acquire); ++i) {
#ifdef _WIN32
    Sleep(1);
#endif
  }
}

void Vst2Slot::setMix(float gain, float pan, bool muted) {
  mixGain_.store(gain, std::memory_order_relaxed);
  mixPan_.store(pan, std::memory_order_relaxed);
  mixMuted_.store(muted, std::memory_order_relaxed);
}

void Vst2Slot::applyMix(float* outL, float* outR, int frames) const {
  if (mixMuted_.load(std::memory_order_relaxed)) {
    std::memset(outL, 0, static_cast<size_t>(frames) * sizeof(float));
    std::memset(outR, 0, static_cast<size_t>(frames) * sizeof(float));
    return;
  }
  float gL = 1.f, gR = 1.f;
  constantPowerGains(mixPan_.load(std::memory_order_relaxed), gL, gR);
  const float g = mixGain_.load(std::memory_order_relaxed);
  gL *= g;
  gR *= g;
  for (int i = 0; i < frames; ++i) {
    outL[i] *= gL;
    outR[i] *= gR;
  }
}
