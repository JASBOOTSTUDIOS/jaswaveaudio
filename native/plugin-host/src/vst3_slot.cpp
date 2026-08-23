/**
 * VST3 slot: Module + PlugProvider + process + editor HWND (hijo de Electron).
 */

#include "vst3_slot.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <thread>
#include <vector>

#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"
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

struct PlugFrame; 

struct EmbedState {
  HWND hwnd{nullptr};
  HWND owner{nullptr};
  IPtr<IPlugView> view;
  PlugFrame* frame{nullptr};
  bool registered{false};
  bool topLevel{false};
};

struct PlugFrame : public IPlugFrame {
  EmbedState* st{nullptr};
  tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* newSize) override {
    if (!st || !st->hwnd || !newSize || view != st->view) return kInvalidArgument;
    const int w = newSize->right - newSize->left;
    const int h = newSize->bottom - newSize->top;
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
  if (msg == WM_SIZE) {
    auto* st = reinterpret_cast<EmbedState*>(GetWindowLongPtr(hWnd, GWLP_USERDATA));
    if (st && st->view) {
      RECT rc{};
      GetClientRect(hWnd, &rc);
      ViewRect vr{};
      vr.right = rc.right - rc.left;
      vr.bottom = rc.bottom - rc.top;
      st->view->onSize(&vr);
    }
  }
  if (msg == WM_ERASEBKGND) return 1;
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

} // namespace

struct Vst3Slot::Impl {
  VST3::Hosting::Module::Ptr module;
  IPtr<PlugProvider> provider;
  IPtr<IComponent> component;
  IPtr<IEditController> controller;
  IPtr<IAudioProcessor> processor;

  HostProcessData processData;
  ProcessContext processContext{};
  EventList eventList;
  ParameterChanges inputParameterChanges;
  ParameterChanges outputParameterChanges;

  double sampleRate{48000};
  int32_t blockSize{512};
  std::mutex midiMutex;
  std::vector<Vst3MidiEvent> midiQueue;
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
  std::vector<float> outBusL;
  std::vector<float> outBusR;

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
  }

  if (!impl_->processData.prepare(*impl_->component, blockSize, kSample32)) {
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
  impl_->outBusL.assign(static_cast<size_t>(blockSize), 0.f);
  impl_->outBusR.assign(static_cast<size_t>(blockSize), 0.f);

  impl_->processContext = {};
  impl_->processContext.sampleRate = sampleRate;
  impl_->processContext.tempo = 120.0;
  impl_->processContext.state = ProcessContext::kPlaying | ProcessContext::kTempoValid |
                               ProcessContext::kProjectTimeMusicValid |
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
  if (impl_->processor) impl_->processor->setProcessing(false);
  if (impl_->component) impl_->component->setActive(false);
  impl_->processData.unprepare();
  return prepare(sampleRate, blockSize, err);
}

void Vst3Slot::suspendForAudioRestart() {
  waitNotProcessing();
  prepared_.store(false);
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

void Vst3Slot::noteOn(int pitch, float velocity) {
  std::lock_guard<std::mutex> lock(impl_->midiMutex);
  impl_->midiQueue.push_back(
      {Vst3MidiEvent::Kind::NoteOn, static_cast<int16_t>(pitch), std::clamp(velocity, 0.f, 1.f)});
}

void Vst3Slot::noteOff(int pitch) {
  std::lock_guard<std::mutex> lock(impl_->midiMutex);
  impl_->midiQueue.push_back({Vst3MidiEvent::Kind::NoteOff, static_cast<int16_t>(pitch), 0.f});
}

void Vst3Slot::midiCc(int cc, int value) {
  const int c = std::clamp(cc, 0, 127);
  const int v = std::clamp(value, 0, 127);
  {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    impl_->midiQueue.push_back(
        {Vst3MidiEvent::Kind::ControlChange, 0, 0.f, static_cast<int16_t>(c), static_cast<int16_t>(v)});
  }
  if (!impl_->controller) return;
  FUnknownPtr<IMidiMapping> mapping(impl_->controller);
  if (!mapping) return;
  ParamID pid = 0;
  if (mapping->getMidiControllerAssignment(0, 0, static_cast<CtrlNumber>(c), pid) == kResultOk) {
    const ParamValue nv = v >= 127 ? 1.0 : (v <= 0 ? 0.0 : static_cast<ParamValue>(v) / 127.0);
    impl_->controller->setParamNormalized(pid, nv);
    std::lock_guard<std::mutex> lock(impl_->paramMutex);
    impl_->paramQueue.push_back({pid, nv});
  }
}

void Vst3Slot::allNotesOff() {
  midiCc(64, 0);
  midiCc(120, 0);
  midiCc(123, 0);
  std::lock_guard<std::mutex> lock(impl_->midiMutex);
  for (int p = 0; p < 128; ++p) {
    impl_->midiQueue.push_back({Vst3MidiEvent::Kind::NoteOff, static_cast<int16_t>(p), 0.f});
  }
  setPlaying(false);
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
  {
    std::lock_guard<std::mutex> lock(impl_->midiMutex);
    pendingMidi.swap(impl_->midiQueue);
  }
  std::vector<std::pair<ParamID, ParamValue>> pendingParams;
  {
    std::lock_guard<std::mutex> lock(impl_->paramMutex);
    pendingParams.swap(impl_->paramQueue);
  }

  int offset = 0;
  bool midiSent = false;
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
    if (!midiSent) {
      for (const auto& ev : pendingMidi) {
        Event e{};
        e.busIndex = 0;
        e.sampleOffset = 0;
        if (ev.kind == Vst3MidiEvent::Kind::NoteOn) {
          e.type = Event::kNoteOnEvent;
          e.noteOn.channel = 0;
          e.noteOn.pitch = ev.pitch;
          e.noteOn.velocity = ev.velocity;
          e.noteOn.length = 0;
          e.noteOn.tuning = 0;
          e.noteOn.noteId = ev.pitch;
        } else if (ev.kind == Vst3MidiEvent::Kind::ControlChange) {
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
        impl_->eventList.addEvent(e);
      }
      midiSent = true;
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
    }
    if (impl_->processData.numOutputs > 0 && impl_->processData.outputs) {
      auto& out = impl_->processData.outputs[0];
      if (out.numChannels >= 1) impl_->processData.setChannelBuffer(kOutput, 0, 0, impl_->outBusL.data());
      if (out.numChannels >= 2) impl_->processData.setChannelBuffer(kOutput, 0, 1, impl_->outBusR.data());
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

    impl_->processor->process(impl_->processData);

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
  inProcess_.store(false);
}

bool Vst3Slot::openEditor(std::uintptr_t parentHwnd, int x, int y, int w, int h, std::string& err) {
#ifdef _WIN32
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
  // Evitar ventana fuera de pantalla / tamaño cero
  if (sx < -100 || sy < -100 || sx > GetSystemMetrics(SM_CXSCREEN) - 80) {
    sx = 80;
    sy = 80;
  }
  if (vw < 200) vw = 800;
  if (vh < 150) vh = 500;

  // Ventana flotante con título (usuario puede moverla / cerrarla).
  HWND hwnd = CreateWindowExW(
      WS_EX_APPWINDOW,
      kEmbedClass,
      L"JasWave Plugin",
      WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_VISIBLE |
          WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
      sx, sy, vw + 16, vh + 40,
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

  SetWindowPos(hwnd, HWND_TOP, sx, sy, vw + 16, vh + 40, SWP_SHOWWINDOW);
  ShowWindow(hwnd, SW_SHOW);
  SetForegroundWindow(hwnd);
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
    DestroyWindow(impl_->embed.hwnd);
    impl_->embed.hwnd = nullptr;
  }
#endif
}

bool Vst3Slot::hasEditor() const {
#ifdef _WIN32
  return impl_->embed.hwnd != nullptr;
#else
  return false;
#endif
}
