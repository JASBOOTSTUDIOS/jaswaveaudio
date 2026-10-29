/**
 * VST3 slot: Module + PlugProvider + process + editor HWND (hijo de Electron).
 */

#include <atomic>
#include "vst3_slot.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <iostream>
#include <thread>
#include <vector>

#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vstspeaker.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace {

HostApplication& hostApp() {
  static HostApplication app;
  return app;
}

bool gContextSet = false;
void ensureHostContext() {
  if (!gContextSet) {
    PluginContextFactory::instance().setPluginContext(&hostApp());
    gContextSet = true;
  }
}

#ifdef _WIN32
static const wchar_t* kEmbedClass = L"JasWaveVstEmbedHost";
/** Editores flotantes abiertos (para escalonar la posición de cada ventana nueva). */
static std::atomic<int> gFloatingEditors{0};

struct PlugFrame; 

struct EmbedState {
  HWND hwnd{nullptr};
  HWND owner{nullptr};
  IPtr<IPlugView> view;
  PlugFrame* frame{nullptr};
  bool registered{false};
  bool topLevel{false};
  bool embedded{false};   // popup alineado al panel del DAW (ver openEditorEmbedded)
  bool pinned{false};     // pin: ventana TOPMOST (sobrevive a cerrar/reabrir el editor)
};

/** Hook (hilo UI) al activarse un editor anclado: main.cpp reaplica el orden por índice. */
static std::atomic<void (*)()> gPinActivatedHook{nullptr};

// DPI por monitor solo en el hilo de UI del editor embebido (los editores flotantes de terceros
// conservan el comportamiento de siempre). Se resuelve en tiempo de ejecución (Windows 10 1607+).
struct ThreadDpiScope {
  using SetCtx = DPI_AWARENESS_CONTEXT(WINAPI*)(DPI_AWARENESS_CONTEXT);
  SetCtx set{nullptr};
  DPI_AWARENESS_CONTEXT prev{nullptr};
  ThreadDpiScope() {
    if (HMODULE u = GetModuleHandleW(L"user32.dll"))
      set = reinterpret_cast<SetCtx>(GetProcAddress(u, "SetThreadDpiAwarenessContext"));
    if (set) prev = set(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  }
  ~ThreadDpiScope() {
    if (set && prev) set(prev);
  }
};

// Ajusta el view al cliente de la ventana embebida respetando su proporción y lo centra.
void fitEmbeddedView(HWND hwnd, IPlugView* view) {
  RECT rc{};
  GetClientRect(hwnd, &rc);
  const int cw = rc.right - rc.left, ch = rc.bottom - rc.top;
  if (cw <= 0 || ch <= 0 || !view) return;
  ViewRect vr{};
  if (view->canResize() == kResultTrue) {
    ViewRect cur{};
    double aspect = 0.0;
    if (view->getSize(&cur) == kResultTrue && cur.getHeight() > 0) aspect = static_cast<double>(cur.getWidth()) / cur.getHeight();
    int w = cw;
    int h = aspect > 0.0 ? static_cast<int>(w / aspect) : ch;
    if (h > ch && aspect > 0.0) {
      h = ch;
      w = static_cast<int>(h * aspect);
    }
    vr.right = w;
    vr.bottom = h;
    // si el plugin impone un mínimo mayor que el panel se respeta (sin deformarlo): queda anclado arriba a la izquierda
    view->checkSizeConstraint(&vr);
    view->onSize(&vr);
  } else if (view->getSize(&vr) != kResultTrue) {
    return;
  }
  const int vw = vr.getWidth(), vh = vr.getHeight();
  if (HWND child = GetWindow(hwnd, GW_CHILD))
    SetWindowPos(child, nullptr, std::max(0, (cw - vw) / 2), std::max(0, (ch - vh) / 2), vw, vh, SWP_NOZORDER | SWP_NOACTIVATE);
}

// Ventana flotante: si el editor se redimensiona ocupa todo el cliente (respetando sus límites); si no,
// conserva su tamaño y queda centrado (al maximizar no se deforma ni se recorta).
void fitFloatingView(HWND hwnd, IPlugView* view) {
  RECT rc{};
  GetClientRect(hwnd, &rc);
  const int cw = rc.right - rc.left, ch = rc.bottom - rc.top;
  if (cw <= 0 || ch <= 0 || !view) return;
  ViewRect vr{};
  if (view->canResize() == kResultTrue) {
    vr.right = cw;
    vr.bottom = ch;
    view->checkSizeConstraint(&vr);
    // Si el plugin impone su proporción (p. ej. 16:9) y no cabe, se ajusta a lo que cabe con esa proporción.
    if ((vr.getWidth() > cw || vr.getHeight() > ch) && vr.getWidth() > 0 && vr.getHeight() > 0) {
      const double aspect = static_cast<double>(vr.getWidth()) / vr.getHeight();
      int w = cw;
      int h = static_cast<int>(w / aspect);
      if (h > ch) {
        h = ch;
        w = static_cast<int>(h * aspect);
      }
      vr = ViewRect{0, 0, w, h};
      view->checkSizeConstraint(&vr);
    }
    view->onSize(&vr);
  } else if (view->getSize(&vr) != kResultTrue) {
    return;
  }
  const int vw = vr.getWidth(), vh = vr.getHeight();
  if (HWND child = GetWindow(hwnd, GW_CHILD))
    SetWindowPos(child, nullptr, std::max(0, (cw - vw) / 2), std::max(0, (ch - vh) / 2), vw, vh, SWP_NOZORDER | SWP_NOACTIVATE);
  InvalidateRect(hwnd, nullptr, TRUE);
}

// Lleva un rectángulo de ventana dentro del área de trabajo de su monitor: la barra de título (con
// minimizar, maximizar y cerrar) nunca queda fuera de la pantalla.
void clampToWorkArea(int& x, int& y, int& w, int& h) {
  POINT centro{x + w / 2, y + 20};
  HMONITOR mon = MonitorFromPoint(centro, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO mi{};
  mi.cbSize = sizeof(mi);
  if (!GetMonitorInfoW(mon, &mi)) return;
  const RECT& wa = mi.rcWork;
  const int aw = wa.right - wa.left, ah = wa.bottom - wa.top;
  w = std::min(w, aw);
  h = std::min(h, ah);
  x = std::min(std::max(x, static_cast<int>(wa.left)), static_cast<int>(wa.right) - w);
  y = std::min(std::max(y, static_cast<int>(wa.top)), static_cast<int>(wa.bottom) - h);
}

struct PlugFrame : public IPlugFrame {
  EmbedState* st{nullptr};
  tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* newSize) override {
    if (!st || !st->hwnd || !newSize || view != st->view) return kInvalidArgument;
    int w = newSize->right - newSize->left;
    int h = newSize->bottom - newSize->top;
    if (st->topLevel && !st->embedded) {
      // Ventana flotante con marco: el tamaño pedido es el del cliente, no el de la ventana.
      if (IsZoomed(st->hwnd)) {
        view->onSize(newSize);
        return kResultTrue;
      }
      RECT r{0, 0, w, h};
      AdjustWindowRectEx(&r, static_cast<DWORD>(GetWindowLongPtrW(st->hwnd, GWL_STYLE)), FALSE,
                         static_cast<DWORD>(GetWindowLongPtrW(st->hwnd, GWL_EXSTYLE)));
      w = r.right - r.left;
      h = r.bottom - r.top;
    }
    SetWindowPos(st->hwnd, nullptr, 0, 0, w, h, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    view->onSize(newSize);
    return kResultTrue;
  }
  tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) override {
    QUERY_INTERFACE(_iid, obj, FUnknown::iid, IPlugFrame)
    QUERY_INTERFACE(_iid, obj, IPlugFrame::iid, IPlugFrame)
    *obj = nullptr;
    return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1000; }
  uint32 PLUGIN_API release() override { return 1000; }
};

LRESULT CALLBACK EmbedWndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == WM_CLOSE) {
    // El usuario cerró la ventana flotante con la X: se libera la vista y el slot queda sin editor
    // (antes quedaba un HWND destruido y hasEditor() seguía devolviendo true).
    auto* st = reinterpret_cast<EmbedState*>(GetWindowLongPtr(hWnd, GWLP_USERDATA));
    if (st && st->topLevel && !st->embedded && st->hwnd == hWnd) {
      if (st->view) {
        st->view->setFrame(nullptr);
        st->view->removed();
        st->view = nullptr;
      }
      st->hwnd = nullptr;
      st->topLevel = false;
      gFloatingEditors.fetch_sub(1);
      DestroyWindow(hWnd);
      return 0;
    }
  }
  if (msg == WM_SIZE) {
    auto* st = reinterpret_cast<EmbedState*>(GetWindowLongPtr(hWnd, GWLP_USERDATA));
    // Minimizada: cliente 0×0; no se le pide al plugin un tamaño nulo (varios se cuelgan o pierden su UI).
    if (wParam == SIZE_MINIMIZED) return DefWindowProcW(hWnd, msg, wParam, lParam);
    if (st && st->view && st->embedded) {
      fitEmbeddedView(hWnd, st->view);
    } else if (st && st->view) {
      fitFloatingView(hWnd, st->view);
    }
  }
  if (msg == WM_GETMINMAXINFO) {
    // Un editor que no se redimensiona no puede encogerse por debajo de su tamaño (no se recorta su UI);
    // maximizar/restaurar sigue disponible: el editor queda centrado sobre fondo negro.
    auto* st = reinterpret_cast<EmbedState*>(GetWindowLongPtr(hWnd, GWLP_USERDATA));
    if (st && st->view && st->topLevel && !st->embedded) {
      // Redimensionable: su mínimo (consulta pura a checkSizeConstraint); fijo: su tamaño.
      ViewRect vr{0, 0, 1, 1};
      const bool ok = st->view->canResize() == kResultTrue ? st->view->checkSizeConstraint(&vr) == kResultTrue
                                                           : st->view->getSize(&vr) == kResultTrue;
      if (ok && vr.getWidth() > 1 && vr.getHeight() > 1) {
        RECT r{0, 0, vr.getWidth(), vr.getHeight()};
        AdjustWindowRectEx(&r, static_cast<DWORD>(GetWindowLongPtrW(hWnd, GWL_STYLE)), FALSE,
                           static_cast<DWORD>(GetWindowLongPtrW(hWnd, GWL_EXSTYLE)));
        auto* mmi = reinterpret_cast<MINMAXINFO*>(lParam);
        // Nunca un mínimo mayor que la pantalla: los botones de la barra de título tienen que verse.
        mmi->ptMinTrackSize.x = std::min<LONG>(std::max<LONG>(mmi->ptMinTrackSize.x, r.right - r.left), mmi->ptMaxTrackSize.x);
        mmi->ptMinTrackSize.y = std::min<LONG>(std::max<LONG>(mmi->ptMinTrackSize.y, r.bottom - r.top), mmi->ptMaxTrackSize.y);
        return 0;
      }
    }
  }
  if (msg == WM_ERASEBKGND) {
    // márgenes del editor ajustado (embebido) en negro, como el panel del DAW
    RECT rc{};
    GetClientRect(hWnd, &rc);
    FillRect(reinterpret_cast<HDC>(wParam), &rc, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    return 1;
  }
  if (msg == WM_MOUSEACTIVATE) {
    auto* st = reinterpret_cast<EmbedState*>(GetWindowLongPtr(hWnd, GWLP_USERDATA));
    if (st && st->embedded) return MA_ACTIVATE;
  }
  if (msg == WM_ACTIVATE && LOWORD(wParam) != WA_INACTIVE) {
    // Un anclado que recibe el foco sube al frente de la banda TOPMOST y rompería la jerarquía:
    // se avisa a main.cpp para que reaplique el orden por índice (diferido, sin activar nada).
    auto* st = reinterpret_cast<EmbedState*>(GetWindowLongPtr(hWnd, GWLP_USERDATA));
    if (st && st->pinned && st->topLevel && !st->embedded) {
      if (auto* hook = gPinActivatedHook.load()) hook();
    }
  }
  return DefWindowProcW(hWnd, msg, wParam, lParam);
}

void registerEmbedClass(HINSTANCE inst) {
  static bool once = false;
  if (once) return;
  once = true;
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = EmbedWndProc;
  wc.hInstance = inst;
  wc.lpszClassName = kEmbedClass;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassExW(&wc);
}
#endif

std::string vstStringToUtf8(const String128 s) {
  std::string out;
  out.reserve(64);
  for (int i = 0; i < 128 && s[i]; ++i) {
    const uint32_t c = static_cast<uint16_t>(s[i]);
    if (c < 0x80) {
      out += static_cast<char>(c);
    } else if (c < 0x800) {
      out += static_cast<char>(0xC0 | (c >> 6));
      out += static_cast<char>(0x80 | (c & 0x3F));
    } else {
      out += static_cast<char>(0xE0 | (c >> 12));
      out += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (c & 0x3F));
    }
  }
  return out;
}

/** IBStream en memoria (evita depender de memorystream.cpp del SDK). */
struct BufStream : public IBStream {
  std::vector<uint8_t> buf;
  int64 cursor{0};

  tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) override {
    QUERY_INTERFACE(_iid, obj, FUnknown::iid, IBStream)
    QUERY_INTERFACE(_iid, obj, IBStream::iid, IBStream)
    *obj = nullptr;
    return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1000; }
  uint32 PLUGIN_API release() override { return 1000; }

  tresult PLUGIN_API read(void* buffer, int32 numBytes, int32* numBytesRead) override {
    if (!buffer || numBytes < 0) return kInvalidArgument;
    const int64 avail = static_cast<int64>(buf.size()) - cursor;
    const int32 n = static_cast<int32>(std::min<int64>(numBytes, std::max<int64>(0, avail)));
    if (n > 0) std::memcpy(buffer, buf.data() + cursor, static_cast<size_t>(n));
    cursor += n;
    if (numBytesRead) *numBytesRead = n;
    return kResultOk;
  }
  tresult PLUGIN_API write(void* buffer, int32 numBytes, int32* numBytesWritten) override {
    if (!buffer || numBytes < 0) return kInvalidArgument;
    const size_t need = static_cast<size_t>(cursor + numBytes);
    if (buf.size() < need) buf.resize(need);
    std::memcpy(buf.data() + cursor, buffer, static_cast<size_t>(numBytes));
    cursor += numBytes;
    if (numBytesWritten) *numBytesWritten = numBytes;
    return kResultOk;
  }
  tresult PLUGIN_API seek(int64 pos, int32 mode, int64* result) override {
    int64 next = cursor;
    if (mode == kIBSeekSet) next = pos;
    else if (mode == kIBSeekCur) next = cursor + pos;
    else if (mode == kIBSeekEnd) next = static_cast<int64>(buf.size()) + pos;
    else return kInvalidArgument;
    if (next < 0) return kInvalidArgument;
    cursor = next;
    if (result) *result = cursor;
    return kResultOk;
  }
  tresult PLUGIN_API tell(int64* pos) override {
    if (!pos) return kInvalidArgument;
    *pos = cursor;
    return kResultOk;
  }
};

} // namespace

/** Eventos MIDI por sub-bloque entregados al plugin (los que no quepan pasan al siguiente bloque). */
static constexpr int32 kMaxEventsPerBlock = 4096;

struct Vst3Slot::Impl {
  VST3::Hosting::Module::Ptr module;
  IPtr<PlugProvider> provider;
  IPtr<IComponent> component;
  IPtr<IEditController> controller;
  IPtr<IAudioProcessor> processor;

  HostProcessData processData;
  ProcessContext processContext{};
  // El EventList del SDK admite 50 eventos por defecto y descarta en silencio el resto: el panic (128
  // note-off) y los bloques densos perdían note-off y dejaban notas colgadas. Ver también el reenvío en process().
  EventList eventList{kMaxEventsPerBlock};
  ParameterChanges inputParameterChanges;
  ParameterChanges outputParameterChanges;

  double sampleRate{48000};
  int32_t blockSize{512};
  std::mutex midiMutex;
  std::vector<Vst3MidiEvent> midiQueue;
  // Pedal de sustain del lado del host (bajo midiMutex). Muchos VST3 ignoran kLegacyMIDICCOutEvent y no todos
  // mapean CC64 por IMidiMapping: mientras el pedal esté pisado los note-off se retienen y se entregan al soltar.
  // Vive en el slot para que valga en todas las rutas (WinMM en el audio thread, comandos del renderer, clips).
  bool sustainDown{false};
  uint64_t keyDown[2]{0, 0};
  uint64_t latched[2]{0, 0};
  static bool bit(const uint64_t* w, int p) { return (w[p >> 6] >> (p & 63)) & 1ull; }
  static void setBit(uint64_t* w, int p, bool on) {
    if (on) w[p >> 6] |= (1ull << (p & 63));
    else w[p >> 6] &= ~(1ull << (p & 63));
  }
  void resetSustain() {
    sustainDown = false;
    keyDown[0] = keyDown[1] = 0;
    latched[0] = latched[1] = 0;
  }
  std::mutex paramMutex;
  std::vector<std::pair<ParamID, ParamValue>> paramQueue;

  struct Handler : public IComponentHandler {
    Impl* owner{nullptr};
    tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API performEdit(ParamID id, ParamValue valueNormalized) override {
      if (!owner) return kResultFalse;
      std::lock_guard<std::mutex> lock(owner->paramMutex);
      owner->paramQueue.push_back({id, valueNormalized});
      return kResultOk;
    }
    tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API restartComponent(int32) override { return kResultOk; }
    tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) override {
      QUERY_INTERFACE(_iid, obj, FUnknown::iid, IComponentHandler)
      QUERY_INTERFACE(_iid, obj, IComponentHandler::iid, IComponentHandler)
      *obj = nullptr;
      return kNoInterface;
    }
    uint32 PLUGIN_API addRef() override { return 1000; }
    uint32 PLUGIN_API release() override { return 1000; }
  } handler;

  std::vector<float> silentInL;
  std::vector<float> silentInR;
  // Búferes de reserva para canales/buses sin conectar (el SDK no es dueño de ningún búfer: bufferSamples=0).
  std::vector<float> scratchIn;
  std::vector<float> scratchOut;
  std::vector<float> outBusL;
  std::vector<float> outBusR;
  int32_t sidechainBusIndex{-1};
  std::vector<float> sidechainL;
  std::vector<float> sidechainR;
  bool sidechainActive{false};

#ifdef _WIN32
  EmbedState embed;
  PlugFrame plugFrame;
#endif
};

Vst3Slot::Vst3Slot() : impl_(std::make_unique<Impl>()) {
#ifdef _WIN32
  impl_->embed.frame = &impl_->plugFrame;
  impl_->plugFrame.st = &impl_->embed;
#endif
  impl_->handler.owner = impl_.get();
}

Vst3Slot::~Vst3Slot() { unload(); }

bool Vst3Slot::load(const std::string& path, std::string& err) {
  unload();
  ensureHostContext();
  path_ = path;

  std::string moduleError;
  impl_->module = VST3::Hosting::Module::create(path, moduleError);
  if (!impl_->module) {
    err = "Module::create falló: " + moduleError;
    return false;
  }

  auto factory = impl_->module->getFactory();
  factory.setHostContext(&hostApp());
  for (auto& classInfo : factory.classInfos()) {
    if (classInfo.category() != kVstAudioEffectClass) continue;
    impl_->provider = owned(new PlugProvider(factory, classInfo, true));
    if (!impl_->provider->initialize()) {
      impl_->provider = nullptr;
      continue;
    }
    break;
  }
  if (!impl_->provider) {
    err = "No se encontró clase Audio Effect en " + path;
    return false;
  }

  impl_->component = impl_->provider->getComponent();
  impl_->controller = impl_->provider->getController();
  if (!impl_->component) {
    err = "Sin IComponent";
    return false;
  }

  FUnknownPtr<IAudioProcessor> proc(impl_->component);
  if (!proc) {
    err = "El plugin no expone IAudioProcessor";
    return false;
  }
  impl_->processor = proc;
  if (impl_->controller) {
    impl_->controller->setComponentHandler(&impl_->handler);
  }
  return true;
}

bool Vst3Slot::prepare(double sampleRate, int32_t blockSize, std::string& err) {
  if (!impl_->processor || !impl_->component) {
    err = "load() requerido antes de prepare";
    return false;
  }
  impl_->sampleRate = sampleRate;
  impl_->blockSize = blockSize;
  {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    impl_->resetSustain();
  }

  ProcessSetup setup{};
  setup.processMode = kRealtime;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;

  if (impl_->processor->setupProcessing(setup) != kResultOk) {
    err = "setupProcessing falló";
    return false;
  }

  // Stereo I/O — sin esto muchos VST3 dejan numOutputs=0 y no suenan.
  const int32 numInBuses = impl_->component->getBusCount(kAudio, kInput);
  const int32 numOutBuses = impl_->component->getBusCount(kAudio, kOutput);
  std::vector<SpeakerArrangement> inArr(static_cast<size_t>(std::max(0, numInBuses)),
                                        SpeakerArr::kStereo);
  std::vector<SpeakerArrangement> outArr(static_cast<size_t>(std::max(0, numOutBuses)),
                                         SpeakerArr::kStereo);
  const tresult busRes = impl_->processor->setBusArrangements(
      numInBuses > 0 ? inArr.data() : nullptr, numInBuses,
      numOutBuses > 0 ? outArr.data() : nullptr, numOutBuses);
  (void)busRes; // kResultFalse = layout negociado; seguimos con activateBus.

  const int32 eventIns = impl_->component->getBusCount(kEvent, kInput);
  for (int32 i = 0; i < eventIns; ++i) {
    impl_->component->activateBus(kEvent, kInput, i, true);
  }
  for (int32 i = 0; i < numOutBuses; ++i) {
    impl_->component->activateBus(kAudio, kOutput, i, true);
  }
  for (int32 i = 0; i < numInBuses; ++i) {
    // Instrumentos: entradas de audio en silencio; activar para HostProcessData.
    impl_->component->activateBus(kAudio, kInput, i, true);
    BusInfo busInfo{};
    if (impl_->component->getBusInfo(kAudio, kInput, i, busInfo) == kResultOk) {
      if (busInfo.busType == kAux && impl_->sidechainBusIndex < 0) {
        impl_->sidechainBusIndex = i;
      }
    }
  }

  if (!impl_->processData.prepare(*impl_->component, 0, kSample32)) {
    err = "HostProcessData::prepare falló";
    return false;
  }
  if (impl_->processData.numOutputs <= 0) {
    err = "Plugin sin buses de audio de salida activos";
    return false;
  }

  if (impl_->component->setActive(true) != kResultOk) {
    err = "setActive(true) falló";
    return false;
  }
  if (impl_->processor->setProcessing(true) != kResultOk) {
    err = "setProcessing(true) falló";
    return false;
  }

  impl_->silentInL.assign(static_cast<size_t>(blockSize), 0.f);
  impl_->silentInR.assign(static_cast<size_t>(blockSize), 0.f);
  impl_->sidechainBusIndex = -1;
  impl_->sidechainActive = false;
  impl_->outBusL.assign(static_cast<size_t>(blockSize), 0.f);
  impl_->scratchIn.assign(static_cast<size_t>(blockSize), 0.f);
  impl_->scratchOut.assign(static_cast<size_t>(blockSize), 0.f);
  impl_->outBusR.assign(static_cast<size_t>(blockSize), 0.f);

  impl_->processContext = {};
  impl_->processContext.sampleRate = sampleRate;
  impl_->processContext.tempo = 120.0;
  // Sin kPlaying al cargar: evita notas “fantasma” y gatea noteOn hasta play.
  impl_->processContext.state = ProcessContext::kTempoValid | ProcessContext::kProjectTimeMusicValid |
                               ProcessContext::kContTimeValid;
  impl_->processContext.projectTimeMusic = 0;
  impl_->processContext.continousTimeSamples = 0;

  latencySamples_ = static_cast<int>(impl_->processor->getLatencySamples());
  prepared_.store(true);
  return true;
}

bool Vst3Slot::reprepare(double sampleRate, int32_t blockSize, std::string& err) {
  waitNotProcessing();
  prepared_.store(false);
  // El estado del usuario (kit, mezcla, ajustes) debe sobrevivir al ciclo setActive(false/true) y al
  // cambio de dispositivo/sample rate: se captura antes de desactivar y se reaplica tras prepare().
  std::vector<uint8_t> guardado = std::move(estadoTrasSuspender_);
  estadoTrasSuspender_.clear();
  if (guardado.empty() && impl_->component) {
    std::string e0;
    getStateChunk(guardado, e0);
  }
  if (impl_->processor) impl_->processor->setProcessing(false);
  if (impl_->component) impl_->component->setActive(false);
  impl_->processData.unprepare();
  const bool ok = prepare(sampleRate, blockSize, err);
  if (ok && !guardado.empty()) {
    std::string e1;
    if (!setStateChunk(guardado.data(), guardado.size(), e1)) {
      std::cerr << "[jaswave-plugin-host] reprepare: no se pudo reaplicar el estado (" << e1 << ")\n";
    }
  }
  return ok;
}

void Vst3Slot::suspendForAudioRestart() {
  waitNotProcessing();
  prepared_.store(false);
  if (impl_->component) {
    std::string e0;
    std::vector<uint8_t> bytes;
    if (getStateChunk(bytes, e0)) estadoTrasSuspender_ = std::move(bytes);
  }
  if (impl_->processor) impl_->processor->setProcessing(false);
  if (impl_->component) impl_->component->setActive(false);
}

void Vst3Slot::waitNotProcessing() {
  prepared_.store(false);
  for (int i = 0; i < 200 && inProcess_.load(); ++i) {
#ifdef _WIN32
    Sleep(1);
#else
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
#endif
  }
}

void Vst3Slot::unload() {
  closeEditor();
  waitNotProcessing();
  if (impl_->controller) impl_->controller->setComponentHandler(nullptr);
  if (impl_->processor) {
    impl_->processor->setProcessing(false);
  }
  if (impl_->component) {
    impl_->component->setActive(false);
  }
  impl_->processData.unprepare();
  impl_->processor = nullptr;
  impl_->controller = nullptr;
  impl_->component = nullptr;
  impl_->provider = nullptr;
  impl_->module = nullptr;
  path_.clear();
}

void Vst3Slot::noteOn(int pitch, float velocity, int delaySamples, int32_t lengthSamples) {
  std::lock_guard<std::mutex> lock(impl_->midiMutex);
  if (impl_->midiQueue.size() > 8192) return;
  const int delay = std::max(0, delaySamples);
  if (pitch >= 0 && pitch < 128) {
    // Nota retenida solo por el pedal que se vuelve a tocar: se apaga antes para que el plugin la redispare.
    if (Impl::bit(impl_->latched, pitch)) {
      Impl::setBit(impl_->latched, pitch, false);
      impl_->midiQueue.push_back({Vst3MidiEvent::Kind::NoteOff, static_cast<int16_t>(pitch), 0.f, 0, 0, delay});
    }
    Impl::setBit(impl_->keyDown, pitch, true);
  }
  impl_->midiQueue.push_back({Vst3MidiEvent::Kind::NoteOn, static_cast<int16_t>(pitch),
                              std::clamp(velocity, 0.f, 1.f), 0, 0, delay, std::max(0, lengthSamples)});
}

void Vst3Slot::noteOff(int pitch, int delaySamples) {
  std::lock_guard<std::mutex> lock(impl_->midiMutex);
  if (impl_->midiQueue.size() > 16384) return;
  if (pitch >= 0 && pitch < 128) {
    Impl::setBit(impl_->keyDown, pitch, false);
    if (impl_->sustainDown) {
      Impl::setBit(impl_->latched, pitch, true);
      return;
    }
  }
  impl_->midiQueue.push_back(
      {Vst3MidiEvent::Kind::NoteOff, static_cast<int16_t>(pitch), 0.f, 0, 0, std::max(0, delaySamples)});
}

void Vst3Slot::midiCc(int cc, int value, int delaySamples) {
  const int c = std::clamp(cc, 0, 127);
  const int v = std::clamp(value, 0, 127);
  const int delay = std::max(0, delaySamples);
  {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    if (impl_->midiQueue.size() > 16384) return;
    impl_->midiQueue.push_back({Vst3MidiEvent::Kind::ControlChange, 0, 0.f, static_cast<int16_t>(c),
                                static_cast<int16_t>(v), delay});
    if (c == 64) {
      const bool down = v >= 64;
      if (down != impl_->sustainDown) {
        impl_->sustainDown = down;
        if (!down) {
          // Al soltar: las notas que solo retenía el pedal se apagan en el mismo instante del CC.
          for (int p = 0; p < 128; ++p) {
            if (!Impl::bit(impl_->latched, p)) continue;
            Impl::setBit(impl_->latched, p, false);
            if (!Impl::bit(impl_->keyDown, p))
              impl_->midiQueue.push_back({Vst3MidiEvent::Kind::NoteOff, static_cast<int16_t>(p), 0.f, 0, 0, delay});
          }
        }
      }
    }
  }
  if (!impl_->controller) return;
  FUnknownPtr<IMidiMapping> mapping(impl_->controller);
  if (!mapping) return;
  ParamID pid = 0;
  const ParamValue nv = v >= 127 ? 1.0 : (v <= 0 ? 0.0 : static_cast<ParamValue>(v) / 127.0);
  bool mapped = false;
  for (int16_t ch = 0; ch < 16 && !mapped; ++ch) {
    if (mapping->getMidiControllerAssignment(0, ch, static_cast<CtrlNumber>(c), pid) == kResultOk) {
      impl_->controller->setParamNormalized(pid, nv);
      std::lock_guard<std::mutex> lock(impl_->paramMutex);
      impl_->paramQueue.push_back({pid, nv});
      mapped = true;
    }
  }
}

void Vst3Slot::allNotesOff() {
  {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    impl_->midiQueue.clear();
    impl_->resetSustain();
  }
  midiCc(64, 0);
  midiCc(120, 0);
  midiCc(123, 0);
  std::lock_guard<std::mutex> lock(impl_->midiMutex);
  for (int p = 0; p < 128; ++p) {
    impl_->midiQueue.push_back({Vst3MidiEvent::Kind::NoteOff, static_cast<int16_t>(p), 0.f});
  }
  // No tocar kPlaying aquí: el panic se usa también en play (mute/rearm) y
  // setPlaying(false) dejaba el instrumento en silencio permanente.
}

void Vst3Slot::flushDsp() {
  if (!impl_->processor || !impl_->component || !prepared_.load()) return;
  waitNotProcessing();  // deja prepared_ en false: el hilo de audio no llama al plugin mientras se reinicia
  {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    impl_->midiQueue.clear();
  }
  impl_->processor->setProcessing(false);
  impl_->component->setActive(false);
  const bool ok = impl_->component->setActive(true) == kResultOk;
  impl_->processor->setProcessing(true);
  impl_->processContext.state &= ~static_cast<uint32>(ProcessContext::kPlaying);
  if (ok) prepared_.store(true);
  else std::cerr << "[jaswave-plugin-host] flushDsp: setActive(true) falló; el plugin queda en bypass\n";
}

void Vst3Slot::setParameterNormalized(uint32_t paramId, double normalized) {
  const ParamValue v = std::clamp(normalized, 0.0, 1.0);
  const ParamID id = static_cast<ParamID>(paramId);
  if (impl_->controller) {
    impl_->controller->setParamNormalized(id, v);
  }
  std::lock_guard<std::mutex> lock(impl_->paramMutex);
  impl_->paramQueue.push_back({id, v});
}

void Vst3Slot::setPlaying(bool playing) {
  if (playing) {
    impl_->processContext.state |= ProcessContext::kPlaying;
  } else {
    impl_->processContext.state &= ~static_cast<uint32>(ProcessContext::kPlaying);
  }
}

void Vst3Slot::setTransport(bool playing, double tempoBpm, double ppqPos) {
  if (tempoBpm >= 20.0 && tempoBpm <= 400.0) {
    impl_->processContext.tempo = tempoBpm;
  }
  if (ppqPos >= 0.0) {
    impl_->processContext.projectTimeMusic = ppqPos;
    const double sr =
        impl_->processContext.sampleRate > 0.0 ? impl_->processContext.sampleRate : impl_->sampleRate;
    const double t = impl_->processContext.tempo;
    if (sr > 0.0 && t > 0.0) {
      impl_->processContext.continousTimeSamples =
          static_cast<int64_t>(std::llround(ppqPos * 60.0 / t * sr));
    }
  }
  setPlaying(playing);
}

std::vector<Vst3ParamDesc> Vst3Slot::listParameters(int maxCount) {
  std::vector<Vst3ParamDesc> out;
  if (!impl_->controller) return out;
  const int32 n = impl_->controller->getParameterCount();
  const int32 lim = std::min(n, maxCount > 0 ? static_cast<int32>(maxCount) : n);
  out.reserve(static_cast<size_t>(std::max(0, lim)));
  for (int32 i = 0; i < lim; ++i) {
    ParameterInfo info{};
    if (impl_->controller->getParameterInfo(i, info) != kResultOk) continue;
    Vst3ParamDesc d;
    d.id = static_cast<uint32_t>(info.id);
    d.name = vstStringToUtf8(info.title);
    d.shortName = vstStringToUtf8(info.shortTitle);
    d.unit = vstStringToUtf8(info.units);
    d.normalized = impl_->controller->getParamNormalized(info.id);
    d.defaultNormalized = info.defaultNormalizedValue;
    d.stepCount = info.stepCount;
    d.automatable = (info.flags & ParameterInfo::kCanAutomate) != 0;
    d.readOnly = (info.flags & ParameterInfo::kIsReadOnly) != 0;
    d.hidden = (info.flags & ParameterInfo::kIsHidden) != 0;
    d.bypass = (info.flags & ParameterInfo::kIsBypass) != 0;
    d.programChange = (info.flags & ParameterInfo::kIsProgramChange) != 0;
    String128 disp{};
    if (impl_->controller->getParamStringByValue(info.id, d.normalized, disp) == kResultOk) {
      d.display = vstStringToUtf8(disp);
    }
    out.push_back(std::move(d));
  }
  return out;
}

void Vst3Slot::setMix(float gain, float pan, bool muted) {
  mixGain_.store(std::max(0.f, std::min(2.f, gain)), std::memory_order_relaxed);
  mixPan_.store(std::max(-1.f, std::min(1.f, pan)), std::memory_order_relaxed);
  mixMuted_.store(muted, std::memory_order_relaxed);
}

void Vst3Slot::applyMix(float* outL, float* outR, int frames) const {
  if (!outL || !outR || frames <= 0) return;
  const float g = mixMuted_.load(std::memory_order_relaxed)
                      ? 0.f
                      : mixGain_.load(std::memory_order_relaxed);
  const float pan = mixPan_.load(std::memory_order_relaxed);
  float gL = g;
  float gR = g;
  if (pan < 0.f) gR *= 1.f + pan;
  else if (pan > 0.f) gL *= 1.f - pan;
  if (gL == 1.f && gR == 1.f) return;
  for (int i = 0; i < frames; ++i) {
    outL[i] *= gL;
    outR[i] *= gR;
  }
}

#ifdef _WIN32
namespace {
// process() del plugin protegido con SEH (también captura excepciones C++ que cruzan el límite de la DLL).
// Sin objetos con destructor en esta función: requisito de __try.
bool safeVst3Process(Steinberg::Vst::IAudioProcessor* p, Steinberg::Vst::ProcessData* d) {
  __try {
    p->process(*d);
    return true;
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    return false;
  }
}
}  // namespace
#endif

void Vst3Slot::process(const float* inL, const float* inR, float* outL, float* outR, int frames) {
  if (!outL || !outR || frames <= 0) return;
  if (bypass_.load(std::memory_order_relaxed) || !prepared_.load() || !impl_->processor) {
    if (inL && inR) {
      std::memcpy(outL, inL, static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(outR, inR, static_cast<size_t>(frames) * sizeof(float));
    } else {
      std::fill(outL, outL + frames, 0.f);
      std::fill(outR, outR + frames, 0.f);
    }
    return;
  }
  inProcess_.store(true);

  std::fill(outL, outL + frames, 0.f);
  std::fill(outR, outR + frames, 0.f);

  std::vector<Vst3MidiEvent> pendingMidi;
  std::vector<Vst3MidiEvent> keepMidi;
  {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    keepMidi.reserve(impl_->midiQueue.size());
    for (auto& ev : impl_->midiQueue) {
      if (ev.delaySamples >= frames) {
        ev.delaySamples -= frames;
        keepMidi.push_back(ev);
      } else {
        pendingMidi.push_back(ev);
      }
    }
    impl_->midiQueue.swap(keepMidi);
  }
  std::vector<std::pair<ParamID, ParamValue>> pendingParams;
  {
    std::lock_guard<std::mutex> lock(impl_->paramMutex);
    pendingParams.swap(impl_->paramQueue);
  }

  // Eventos que no cupieron en el EventList de un sub-bloque: se reencolan al principio del siguiente
  // bloque (nunca se pierde un note-off).
  std::vector<Vst3MidiEvent> overflowMidi;
  int offset = 0;
  while (offset < frames) {
    const int n = std::min(frames - offset, impl_->blockSize);
    if (static_cast<int>(impl_->outBusL.size()) < n) {
      impl_->outBusL.resize(static_cast<size_t>(n), 0.f);
      impl_->outBusR.resize(static_cast<size_t>(n), 0.f);
      impl_->silentInL.resize(static_cast<size_t>(n), 0.f);
      impl_->silentInR.resize(static_cast<size_t>(n), 0.f);
    }
    std::fill(impl_->outBusL.begin(), impl_->outBusL.begin() + n, 0.f);
    std::fill(impl_->outBusR.begin(), impl_->outBusR.begin() + n, 0.f);
    if (inL && inR) {
      std::memcpy(impl_->silentInL.data(), inL + offset, static_cast<size_t>(n) * sizeof(float));
      std::memcpy(impl_->silentInR.data(), inR + offset, static_cast<size_t>(n) * sizeof(float));
    } else {
      std::fill(impl_->silentInL.begin(), impl_->silentInL.begin() + n, 0.f);
      std::fill(impl_->silentInR.begin(), impl_->silentInR.begin() + n, 0.f);
    }

    impl_->eventList.clear();
    for (const auto& ev : pendingMidi) {
      const int off = ev.delaySamples;
      if (off < offset || off >= offset + n) continue;
      Event e{};
      e.busIndex = 0;
      e.sampleOffset = off - offset;
      if (ev.kind == Vst3MidiEvent::Kind::NoteOn) {
        e.type = Event::kNoteOnEvent;
        e.noteOn.channel = 0;
        e.noteOn.pitch = ev.pitch;
        e.noteOn.velocity = ev.velocity;
        e.noteOn.length = ev.lengthSamples > 0 ? ev.lengthSamples : 0;
        e.noteOn.tuning = 0;
        e.noteOn.noteId = ev.pitch;
      } else if (ev.kind == Vst3MidiEvent::Kind::ControlChange) {
        // JUCE y varios wrappers leen CC aquí (el nombre "Out" es histórico).
        // El sustain real también va por IMidiMapping → IParameterChanges en midiCc().
        e.type = Event::kLegacyMIDICCOutEvent;
        e.midiCCOut.channel = 0;
        e.midiCCOut.controlNumber = static_cast<uint8>(ev.cc);
        e.midiCCOut.value = static_cast<int8>(ev.ccValue);
        e.midiCCOut.value2 = 0;
      } else {
        e.type = Event::kNoteOffEvent;
        e.noteOff.channel = 0;
        e.noteOff.pitch = ev.pitch;
        e.noteOff.velocity = 0;
        e.noteOff.tuning = 0;
        e.noteOff.noteId = ev.pitch;
      }
      if (impl_->eventList.addEvent(e) != kResultOk) {
        Vst3MidiEvent later = ev;
        later.delaySamples = 0;
        overflowMidi.push_back(later);
      }
    }

    impl_->inputParameterChanges.clearQueue();
    if (!pendingParams.empty()) {
      for (const auto& p : pendingParams) {
        int32 qIndex = 0;
        if (auto* q = impl_->inputParameterChanges.addParameterData(p.first, qIndex)) {
          int32 pt = 0;
          q->addPoint(0, p.second, pt);
        }
      }
      pendingParams.clear();
    }

    if (impl_->processData.numInputs > 0 && impl_->processData.inputs) {
      auto& in = impl_->processData.inputs[0];
      if (in.numChannels >= 1) impl_->processData.setChannelBuffer(kInput, 0, 0, impl_->silentInL.data());
      if (in.numChannels >= 2) impl_->processData.setChannelBuffer(kInput, 0, 1, impl_->silentInR.data());
      if (impl_->sidechainBusIndex >= 0 &&
          static_cast<size_t>(impl_->sidechainBusIndex) < impl_->processData.numInputs &&
          impl_->sidechainActive) {
        const int scBus = impl_->sidechainBusIndex;
        if (impl_->processData.inputs[scBus].numChannels >= 1) {
          impl_->processData.setChannelBuffer(kInput, scBus, 0, impl_->sidechainL.data());
        }
        if (impl_->processData.inputs[scBus].numChannels >= 2) {
          impl_->processData.setChannelBuffer(kInput, scBus, 1, impl_->sidechainR.data());
        }
      }
    }
    if (impl_->processData.numOutputs > 0 && impl_->processData.outputs) {
      auto& out = impl_->processData.outputs[0];
      if (out.numChannels >= 1) impl_->processData.setChannelBuffer(kOutput, 0, 0, impl_->outBusL.data());
      if (out.numChannels >= 2) impl_->processData.setChannelBuffer(kOutput, 0, 1, impl_->outBusR.data());
    }

    // Todo canal sin conectar apunta a un búfer de reserva propio: nunca un puntero nulo ni memoria ajena.
    if (static_cast<int>(impl_->scratchIn.size()) < n) {
      impl_->scratchIn.resize(static_cast<size_t>(n), 0.f);
      impl_->scratchOut.resize(static_cast<size_t>(n), 0.f);
    }
    std::fill(impl_->scratchIn.begin(), impl_->scratchIn.begin() + n, 0.f);
    for (int32 b = 0; b < impl_->processData.numInputs && impl_->processData.inputs; ++b) {
      auto& bus = impl_->processData.inputs[b];
      for (int32 c = 0; c < bus.numChannels && bus.channelBuffers32; ++c) {
        if (!bus.channelBuffers32[c]) bus.channelBuffers32[c] = impl_->scratchIn.data();
      }
    }
    for (int32 b = 0; b < impl_->processData.numOutputs && impl_->processData.outputs; ++b) {
      auto& bus = impl_->processData.outputs[b];
      for (int32 c = 0; c < bus.numChannels && bus.channelBuffers32; ++c) {
        if (!bus.channelBuffers32[c]) bus.channelBuffers32[c] = impl_->scratchOut.data();
      }
    }

    impl_->processData.numSamples = n;
    impl_->processData.processContext = &impl_->processContext;
    impl_->processData.inputEvents = &impl_->eventList;
    impl_->processData.outputEvents = nullptr;
    impl_->processData.inputParameterChanges = &impl_->inputParameterChanges;
    impl_->processData.outputParameterChanges = &impl_->outputParameterChanges;
    impl_->outputParameterChanges.clearQueue();

    impl_->processContext.continousTimeSamples += n;
    impl_->processContext.projectTimeMusic +=
        (static_cast<double>(n) / impl_->sampleRate) * (impl_->processContext.tempo / 60.0);

#ifdef _WIN32
    if (!safeVst3Process(impl_->processor.get(), &impl_->processData)) {
      // Plugin roto: bypass silencioso para que el audio del resto siga (cuarentena V5 §2.4)
      exceptions_.fetch_add(1, std::memory_order_relaxed);
      bypass_.store(true, std::memory_order_relaxed);
      std::fill(outL, outL + frames, 0.f);
      std::fill(outR, outR + frames, 0.f);
      inProcess_.store(false);
      return;
    }
#else
    impl_->processor->process(impl_->processData);
#endif

    const bool stereo = impl_->processData.numOutputs > 0 &&
                        impl_->processData.outputs &&
                        impl_->processData.outputs[0].numChannels >= 2;
    for (int i = 0; i < n; ++i) {
      outL[offset + i] = impl_->outBusL[static_cast<size_t>(i)];
      outR[offset + i] =
          stereo ? impl_->outBusR[static_cast<size_t>(i)] : impl_->outBusL[static_cast<size_t>(i)];
    }
    offset += n;
  }
  if (!overflowMidi.empty()) {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    impl_->midiQueue.insert(impl_->midiQueue.begin(), overflowMidi.begin(), overflowMidi.end());
  }
  inProcess_.store(false);
}

bool Vst3Slot::openEditor(std::uintptr_t parentHwnd, int x, int y, int w, int h, std::string& err) {
#ifdef _WIN32
  // Ya hay una ventana flotante de este plugin: se restaura y se trae al frente (varios plugins abiertos a la vez)
  if (impl_->embed.hwnd && impl_->embed.topLevel && !impl_->embed.embedded && IsWindow(impl_->embed.hwnd)) {
    ShowWindow(impl_->embed.hwnd, SW_RESTORE);
    SetWindowPos(impl_->embed.hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetForegroundWindow(impl_->embed.hwnd);
    return true;
  }
  closeEditor();
  if (!impl_->controller) {
    err = "Sin EditController";
    return false;
  }

  IPtr<IPlugView> view = owned(impl_->controller->createView(ViewType::kEditor));
  if (!view) {
    err = "createView(kEditor) falló";
    return false;
  }
  if (view->isPlatformTypeSupported(kPlatformTypeHWND) != kResultTrue) {
    err = "El plugin no soporta HWND";
    return false;
  }

  ViewRect size{};
  if (view->getSize(&size) != kResultTrue) {
    size.right = w > 0 ? w : 800;
    size.bottom = h > 0 ? h : 500;
  }
  int vw = size.right - size.left;
  int vh = size.bottom - size.top;
  if (vw < 100) vw = w > 0 ? w : 800;
  if (vh < 100) vh = h > 0 ? h : 500;
  if (w > 0) vw = w;
  if (h > 0) vh = h;

  HINSTANCE inst = GetModuleHandleW(nullptr);
  registerEmbedClass(inst);

  // Solo coords. Nunca owner=Electron (deadlock SendMessage).
  HWND coordRef = parentHwnd ? reinterpret_cast<HWND>(parentHwnd) : nullptr;
  int sx = x;
  int sy = y;
  if (coordRef && IsWindow(coordRef)) {
    POINT pt{x, y};
    ClientToScreen(coordRef, &pt);
    sx = pt.x;
    sy = pt.y;
  } else {
    // Centrar en el monitor primario si no hay referencia
    const int sw = GetSystemMetrics(SM_CXSCREEN);
    const int sh = GetSystemMetrics(SM_CYSCREEN);
    sx = std::max(40, (sw - vw) / 2);
    sy = std::max(40, (sh - vh) / 2);
  }
  // Cascada: cada ventana nueva se desplaza para no tapar a las abiertas
  {
    const int k = gFloatingEditors.load() % 8;
    sx += 38 * k;
    sy += 32 * k;
  }
  if (vw < 200) vw = 800;
  if (vh < 150) vh = 500;
  // Un editor redimensionable con mínimo o proporción propios: la ventana nace con un tamaño que acepta
  // (antes quedaba recortado por la derecha hasta que se maximizaba).
  if (view->canResize() == kResultTrue) {
    ViewRect pedido{0, 0, vw, vh};
    if (view->checkSizeConstraint(&pedido) == kResultTrue && pedido.getWidth() > 0 && pedido.getHeight() > 0) {
      vw = pedido.getWidth();
      vh = pedido.getHeight();
    }
  }

  // Ventana flotante normal de Windows: título, minimizar, maximizar/restaurar y cerrar (sin
  // WS_EX_TOOLWINDOW, que quitaría minimizar y la barra de tareas). El tamaño es el del cliente = editor.
  const DWORD estilo = WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
  const DWORD estiloEx = WS_EX_APPWINDOW;
  RECT marco{0, 0, vw, vh};
  AdjustWindowRectEx(&marco, estilo, FALSE, estiloEx);
  int ww = marco.right - marco.left;
  int wh = marco.bottom - marco.top;
  // Nunca con la barra de título fuera de la pantalla (antes se admitía hasta 100 px por encima/izquierda
  // y la cascada podía empujarla fuera por abajo o la derecha).
  clampToWorkArea(sx, sy, ww, wh);

  // Ventana flotante con título (usuario puede moverla / cerrarla).
  std::wstring titleW = L"JasWave Plugin";
  if (!editorTitle_.empty()) {
    const int n = MultiByteToWideChar(CP_UTF8, 0, editorTitle_.c_str(), -1, nullptr, 0);
    if (n > 1) {
      titleW.assign(static_cast<size_t>(n), L' ');
      MultiByteToWideChar(CP_UTF8, 0, editorTitle_.c_str(), -1, titleW.data(), n);
      titleW.resize(static_cast<size_t>(n - 1));
    }
  }
  HWND hwnd = CreateWindowExW(
      estiloEx,
      kEmbedClass,
      titleW.c_str(),
      estilo,
      sx, sy, ww, wh,
      nullptr,
      nullptr, inst, nullptr);
  if (!hwnd) {
    err = "CreateWindowEx falló (GetLastError=" + std::to_string(GetLastError()) + ")";
    return false;
  }

  impl_->embed.hwnd = hwnd;
  impl_->embed.owner = nullptr;
  impl_->embed.topLevel = true;
  impl_->embed.view = view;
  SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&impl_->embed));

  view->setFrame(&impl_->plugFrame);
  if (view->attached(hwnd, kPlatformTypeHWND) != kResultTrue) {
    err = "IPlugView::attached falló";
    DestroyWindow(hwnd);
    impl_->embed.hwnd = nullptr;
    impl_->embed.view = nullptr;
    return false;
  }

  ViewRect vr{};
  vr.right = vw;
  vr.bottom = vh;
  view->onSize(&vr);

  SetWindowPos(hwnd, impl_->embed.pinned ? HWND_TOPMOST : HWND_TOP, sx, sy, ww, wh, SWP_SHOWWINDOW);
  fitFloatingView(hwnd, view);
  ShowWindow(hwnd, SW_SHOW);
  SetForegroundWindow(hwnd);
  gFloatingEditors.fetch_add(1);
  return true;
#else
  (void)parentHwnd;
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  err = "Editor embed solo en Windows por ahora";
  return false;
#endif
}

bool Vst3Slot::openEditorEmbedded(int x, int y, int w, int h, std::string& err) {
#ifdef _WIN32
  closeEditor();
  if (!impl_->controller) {
    err = "Sin EditController";
    return false;
  }
  ThreadDpiScope dpi;   // x/y/w/h llegan en píxeles físicos (screen.dipToScreenRect en Electron)
  IPtr<IPlugView> view = owned(impl_->controller->createView(ViewType::kEditor));
  if (!view) {
    err = "createView(kEditor) falló";
    return false;
  }
  if (view->isPlatformTypeSupported(kPlatformTypeHWND) != kResultTrue) {
    err = "El plugin no soporta HWND";
    return false;
  }
  HINSTANCE inst = GetModuleHandleW(nullptr);
  registerEmbedClass(inst);
  // Popup sin borde, sin barra de tareas y SIN owner: nada de SendMessage entre procesos.
  HWND hwnd = CreateWindowExW(WS_EX_TOOLWINDOW, kEmbedClass, L"JasWave Plugin",
                              WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN, x, y, std::max(1, w), std::max(1, h), nullptr, nullptr, inst,
                              nullptr);
  if (!hwnd) {
    err = "CreateWindowEx falló (GetLastError=" + std::to_string(GetLastError()) + ")";
    return false;
  }
  impl_->embed.hwnd = hwnd;
  impl_->embed.owner = nullptr;
  impl_->embed.topLevel = true;
  impl_->embed.embedded = true;
  impl_->embed.view = view;
  SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&impl_->embed));
  view->setFrame(&impl_->plugFrame);
  if (view->attached(hwnd, kPlatformTypeHWND) != kResultTrue) {
    err = "IPlugView::attached falló";
    DestroyWindow(hwnd);
    impl_->embed.hwnd = nullptr;
    impl_->embed.view = nullptr;
    impl_->embed.embedded = false;
    return false;
  }
  fitEmbeddedView(hwnd, view);
  SetWindowPos(hwnd, HWND_TOP, x, y, std::max(1, w), std::max(1, h), SWP_SHOWWINDOW | SWP_NOACTIVATE);
  return true;
#else
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  err = "Editor embebido solo en Windows";
  return false;
#endif
}

bool Vst3Slot::editorEmbedded() const {
#ifdef _WIN32
  return impl_->embed.hwnd && impl_->embed.embedded;
#else
  return false;
#endif
}

void Vst3Slot::setEmbeddedBounds(int x, int y, int w, int h, bool visible, bool raise) {
#ifdef _WIN32
  if (!impl_->embed.hwnd || !impl_->embed.embedded) return;
  ThreadDpiScope dpi;
  if (!visible || w <= 0 || h <= 0) {
    ShowWindow(impl_->embed.hwnd, SW_HIDE);
    return;
  }
  // HWND_TOP sin activar: por encima de la ventana del DAW cuando esta vuelve al frente
  SetWindowPos(impl_->embed.hwnd, raise ? HWND_TOP : nullptr, x, y, w, h,
               SWP_NOACTIVATE | SWP_SHOWWINDOW | (raise ? 0 : SWP_NOZORDER));
#else
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  (void)visible;
  (void)raise;
#endif
}

void Vst3Slot::setEditorBounds(int x, int y, int w, int h) {
#ifdef _WIN32
  if (!impl_->embed.hwnd) return;
  int sx = x;
  int sy = y;
  if (impl_->embed.topLevel && impl_->embed.owner && IsWindow(impl_->embed.owner)) {
    POINT pt{x, y};
    ClientToScreen(impl_->embed.owner, &pt);
    sx = pt.x;
    sy = pt.y;
  }
  SetWindowPos(impl_->embed.hwnd, HWND_TOP, sx, sy, std::max(1, w), std::max(1, h),
               SWP_NOACTIVATE | SWP_SHOWWINDOW);
  if (impl_->embed.view) {
    ViewRect vr{};
    vr.right = w;
    vr.bottom = h;
    impl_->embed.view->onSize(&vr);
  }
#else
  (void)x;
  (void)y;
  (void)w;
  (void)h;
#endif
}

void Vst3Slot::closeEditor() {
#ifdef _WIN32
  if (impl_->embed.view) {
    impl_->embed.view->setFrame(nullptr);
    impl_->embed.view->removed();
    impl_->embed.view = nullptr;
  }
  if (impl_->embed.hwnd) {
    if (impl_->embed.topLevel && !impl_->embed.embedded) gFloatingEditors.fetch_sub(1);
    DestroyWindow(impl_->embed.hwnd);
    impl_->embed.hwnd = nullptr;
  }
  impl_->embed.topLevel = false;
  impl_->embed.embedded = false;
#endif
}

bool Vst3Slot::hasEditor() const {
#ifdef _WIN32
  return impl_->embed.hwnd != nullptr;
#else
  return false;
#endif
}

bool Vst3Slot::getStateChunk(std::vector<uint8_t>& out, std::string& err) {
  out.clear();
  if (!impl_->component) {
    err = "Sin IComponent";
    return false;
  }
  BufStream comp;
  const tresult compRes = impl_->component->getState(&comp);
  if (compRes != kResultOk) comp.buf.clear();
  BufStream ctrl;
  if (impl_->controller) {
    if (impl_->controller->getState(&ctrl) != kResultOk) ctrl.buf.clear();  // opcional
  }
  // Hay plugins que guardan todo en el controlador (componente vacío): vale con que uno de los dos tenga datos.
  if (comp.buf.empty() && ctrl.buf.empty()) {
    err = "IComponent::getState vacío/falló";
    return false;
  }
  // Formato: magic "JW3S" + u32 LE lenComp + comp + u32 LE lenCtrl + ctrl
  out.reserve(8 + comp.buf.size() + ctrl.buf.size());
  out.push_back('J');
  out.push_back('W');
  out.push_back('3');
  out.push_back('S');
  auto putU32 = [&](uint32_t v) {
    out.push_back(static_cast<uint8_t>(v & 0xff));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xff));
    out.push_back(static_cast<uint8_t>((v >> 16) & 0xff));
    out.push_back(static_cast<uint8_t>((v >> 24) & 0xff));
  };
  putU32(static_cast<uint32_t>(comp.buf.size()));
  out.insert(out.end(), comp.buf.begin(), comp.buf.end());
  putU32(static_cast<uint32_t>(ctrl.buf.size()));
  out.insert(out.end(), ctrl.buf.begin(), ctrl.buf.end());
  return true;
}

bool Vst3Slot::setStateChunk(const uint8_t* data, size_t nbytes, std::string& err) {
  if (!impl_->component || !data || nbytes < 8) {
    err = "Chunk VST3 inválido";
    return false;
  }
  auto readU32 = [](const uint8_t* p) -> uint32_t {
    return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
  };

  const uint8_t* compPtr = nullptr;
  size_t compLen = 0;
  const uint8_t* ctrlPtr = nullptr;
  size_t ctrlLen = 0;

  if (nbytes >= 4 && data[0] == 'J' && data[1] == 'W' && data[2] == '3' && data[3] == 'S') {
    size_t off = 4;
    if (off + 4 > nbytes) {
      err = "Chunk truncado";
      return false;
    }
    compLen = readU32(data + off);
    off += 4;
    if (off + compLen + 4 > nbytes) {
      err = "Chunk component truncado";
      return false;
    }
    compPtr = data + off;
    off += compLen;
    ctrlLen = readU32(data + off);
    off += 4;
    if (off + ctrlLen > nbytes) {
      err = "Chunk controller truncado";
      return false;
    }
    ctrlPtr = ctrlLen ? data + off : nullptr;
  } else {
    // Blob crudo = solo component (compat).
    compPtr = data;
    compLen = nbytes;
  }

  BufStream comp;
  comp.buf.assign(compPtr, compPtr + compLen);
  comp.cursor = 0;
  bool compOk = true;
  if (compLen > 0) {
    compOk = impl_->component->setState(&comp) == kResultOk;
  }
  // Spec VST3: tras IComponent::setState el host debe pasar el MISMO estado al controlador
  // (IEditController::setComponentState); si no, la GUI y los parámetros quedan "de fábrica"
  // aunque el procesador sí cargó el estado (kit/mezcla que el usuario eligió en BFD, Kontakt…).
  bool ctrlOk = false;
  if (impl_->controller) {
    if (compLen > 0) {
      comp.cursor = 0;
      ctrlOk = impl_->controller->setComponentState(&comp) == kResultOk || ctrlOk;
    }
    if (ctrlPtr && ctrlLen > 0) {
      BufStream ctrl;
      ctrl.buf.assign(ctrlPtr, ctrlPtr + ctrlLen);
      ctrl.cursor = 0;
      ctrlOk = impl_->controller->setState(&ctrl) == kResultOk || ctrlOk;
    }
  }
  if (!compOk) {
    err = "IComponent::setState falló";
    (void)ctrlOk;
    return false;
  }
  return true;
}

bool Vst3Slot::hasSidechainInput() const {
  return impl_ && impl_->sidechainBusIndex >= 0;
}

void Vst3Slot::setSidechainInput(const float* l, const float* r, int frames) {
  if (!impl_ || impl_->sidechainBusIndex < 0 || frames <= 0) return;
  impl_->sidechainL.assign(static_cast<size_t>(frames), 0.f);
  impl_->sidechainR.assign(static_cast<size_t>(frames), 0.f);
  if (l) std::memcpy(impl_->sidechainL.data(), l, static_cast<size_t>(frames) * sizeof(float));
  if (r) std::memcpy(impl_->sidechainR.data(), r, static_cast<size_t>(frames) * sizeof(float));
  else if (l) std::memcpy(impl_->sidechainR.data(), l, static_cast<size_t>(frames) * sizeof(float));
  impl_->sidechainActive = true;
}

void Vst3Slot::clearSidechainInput() {
  if (!impl_) return;
  impl_->sidechainActive = false;
}

// ── Pin de editores (siempre visibles) ──────────────────────────────────────
void vst3SetPinActivatedHook(void (*hook)()) {
#ifdef _WIN32
  gPinActivatedHook.store(hook);
#else
  (void)hook;
#endif
}

void Vst3Slot::setEditorPinned(bool pinned) {
#ifdef _WIN32
  impl_->embed.pinned = pinned;
  HWND h = impl_->embed.hwnd;
  if (!h || !impl_->embed.topLevel || impl_->embed.embedded || !IsWindow(h)) return;
  SetWindowPos(h, pinned ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
#else
  (void)pinned;
#endif
}

bool Vst3Slot::editorPinned() const {
#ifdef _WIN32
  return impl_->embed.pinned;
#else
  return false;
#endif
}

void Vst3Slot::raiseEditorPinned() {
#ifdef _WIN32
  HWND h = impl_->embed.hwnd;
  if (!impl_->embed.pinned || !h || !impl_->embed.topLevel || impl_->embed.embedded || !IsWindow(h)) return;
  if (!IsWindowVisible(h)) return;  // oculto por la política de minimizado: no se resucita aquí
  SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
#endif
}

void Vst3Slot::setEditorPinVisible(bool visible) {
#ifdef _WIN32
  HWND h = impl_->embed.hwnd;
  if (!impl_->embed.pinned || !h || !impl_->embed.topLevel || impl_->embed.embedded || !IsWindow(h)) return;
  if (!visible) {
    ShowWindow(h, SW_HIDE);
  } else {
    ShowWindow(h, IsIconic(h) ? SW_SHOWMINNOACTIVE : SW_SHOWNOACTIVATE);
    SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  }
#else
  (void)visible;
#endif
}

bool Vst3Slot::editorTopmost() const {
#ifdef _WIN32
  HWND h = impl_->embed.hwnd;
  if (!h || !IsWindow(h)) return false;
  return (GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
#else
  return false;
#endif
}

std::uintptr_t Vst3Slot::editorHwnd() const {
#ifdef _WIN32
  return reinterpret_cast<std::uintptr_t>(impl_->embed.hwnd);
#else
  return 0;
#endif
}
