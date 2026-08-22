/**
 * JasWave Plugin Host — discover + VST3 load/MIDI/audio + editor embed (ADR-0011).
 */

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <objbase.h>
#else
#include <dirent.h>
#include <sys/stat.h>
#endif

#if defined(JASWAVE_HAS_VST3_SDK)
#include "vst3_slot.h"
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#endif

static std::string jsonEscape(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      default: o += c; break;
    }
  }
  return o;
}

static void replyOk(const std::string& extraJson = "") {
  if (extraJson.empty()) {
    std::cout << "{\"ok\":true,\"processId\":\"jaswave-plugin-host\"}\n" << std::flush;
  } else {
    std::cout << "{\"ok\":true,\"processId\":\"jaswave-plugin-host\"," << extraJson << "}\n"
              << std::flush;
  }
}

static void replyFail(const char* code, const std::string& message) {
  std::cout << "{\"ok\":false,\"code\":\"" << code << "\",\"message\":\"" << jsonEscape(message)
            << "\"}\n"
            << std::flush;
}

static std::string getStringField(const std::string& json, const char* key) {
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = json.find(needle);
  if (pos == std::string::npos) return {};
  pos = json.find(':', pos);
  if (pos == std::string::npos) return {};
  pos = json.find('"', pos);
  if (pos == std::string::npos) return {};
  ++pos;
  std::string out;
  while (pos < json.size() && json[pos] != '"') {
    if (json[pos] == '\\' && pos + 1 < json.size()) {
      out += json[pos + 1];
      pos += 2;
      continue;
    }
    out += json[pos++];
  }
  return out;
}

static double getNumberField(const std::string& json, const char* key, double fallback = 0) {
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = json.find(needle);
  if (pos == std::string::npos) return fallback;
  pos = json.find(':', pos);
  if (pos == std::string::npos) return fallback;
  ++pos;
  while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) ++pos;
  try {
    return std::stod(json.substr(pos));
  } catch (...) {
    return fallback;
  }
}

#ifdef _WIN32
static void listVst3InDir(const std::string& dir, std::vector<std::string>& out, int depth = 0) {
  if (depth > 4) return;
  std::string pattern = dir;
  if (!pattern.empty() && pattern.back() != '\\' && pattern.back() != '/') pattern += '\\';
  pattern += '*';
  WIN32_FIND_DATAA fd;
  HANDLE h = FindFirstFileA(pattern.c_str(), &fd);
  if (h == INVALID_HANDLE_VALUE) return;
  do {
    if (fd.cFileName[0] == '.' && (fd.cFileName[1] == 0 || fd.cFileName[1] == '.')) continue;
    std::string full = dir;
    if (!full.empty() && full.back() != '\\') full += '\\';
    full += fd.cFileName;
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      std::string name = fd.cFileName;
      if (name.size() > 5) {
        auto ext = name.substr(name.size() - 5);
        for (auto& c : ext) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
        if (ext == ".vst3") {
          out.push_back(full);
          continue;
        }
      }
      listVst3InDir(full, out, depth + 1);
    }
  } while (FindNextFileA(h, &fd));
  FindClose(h);
}
#else
static void listVst3InDir(const std::string& dir, std::vector<std::string>& out, int depth = 0) {
  if (depth > 4) return;
  DIR* d = opendir(dir.c_str());
  if (!d) return;
  while (auto* ent = readdir(d)) {
    if (ent->d_name[0] == '.') continue;
    std::string full = dir + "/" + ent->d_name;
    struct stat st {};
    if (stat(full.c_str(), &st) != 0) continue;
    if (S_ISDIR(st.st_mode)) {
      std::string name = ent->d_name;
      if (name.size() > 5) {
        auto ext = name.substr(name.size() - 5);
        for (auto& c : ext) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
        if (ext == ".vst3") {
          out.push_back(full);
          continue;
        }
      }
      listVst3InDir(full, out, depth + 1);
    }
  }
  closedir(d);
}
#endif

static std::string expandEnvPath(std::string p) {
#ifdef _WIN32
  char buf[4096];
  DWORD n = ExpandEnvironmentStringsA(p.c_str(), buf, sizeof(buf));
  if (n > 0 && n < sizeof(buf)) return std::string(buf);
#endif
  return p;
}

#if defined(JASWAVE_HAS_VST3_SDK)
static constexpr bool kAudioReady = true;
#else
static constexpr bool kAudioReady = false;
#endif

static void handleDiscover(const std::string& json) {
  std::string path = getStringField(json, "path");
  if (path.empty()) {
    replyFail("PluginScanFailed", "discover requiere path");
    return;
  }
  path = expandEnvPath(path);
  std::vector<std::string> found;
  listVst3InDir(path, found);
  std::ostringstream plugins;
  plugins << "[";
  for (size_t i = 0; i < found.size(); ++i) {
    if (i) plugins << ",";
    std::string name = found[i];
    auto slash = name.find_last_of("/\\");
    if (slash != std::string::npos) name = name.substr(slash + 1);
    if (name.size() > 5) name = name.substr(0, name.size() - 5);
    plugins << "{\"path\":\"" << jsonEscape(found[i]) << "\",\"name\":\"" << jsonEscape(name)
            << "\",\"format\":\"vst3\",\"hostReady\":" << (kAudioReady ? "true" : "false")
            << ",\"editorReady\":" << (kAudioReady ? "true" : "false") << "}";
  }
  plugins << "]";
  replyOk("\"plugins\":" + plugins.str() + ",\"count\":" + std::to_string(found.size()) +
          ",\"editorReady\":" + (kAudioReady ? "true" : "false") +
          ",\"audioReady\":" + (kAudioReady ? "true" : "false"));
}

#if defined(JASWAVE_HAS_VST3_SDK)

static std::mutex gSlotsMutex;
static std::unordered_map<std::string, std::unique_ptr<Vst3Slot>> gSlots;
static std::string gActiveSlot;

static ma_device gAudioDevice;
static std::atomic<bool> gAudioRunning{false};
static std::vector<float> gMixL;
static std::vector<float> gMixR;

#ifdef _WIN32
static DWORD gMainThreadId = 0;
#endif

struct UiJob {
  enum class Kind { OpenEditor, SetBounds, CloseEditor } kind{};
  std::string json;
  std::string err;
  bool ok{false};
  bool replyWhenDone{true};
  std::mutex mu;
  std::condition_variable cv;
  bool done{false};
};

static std::mutex gUiQueueMu;
static std::vector<std::shared_ptr<UiJob>> gUiQueue;

static Vst3Slot* findSlotUnlocked(const std::string& slotId) {
  auto it = gSlots.find(slotId);
  return it == gSlots.end() ? nullptr : it->second.get();
}

static void audioCallback(ma_device* /*device*/, void* output, const void* /*input*/,
                          ma_uint32 frameCount) {
  auto* out = static_cast<float*>(output);
  const int frames = static_cast<int>(frameCount);
  if (static_cast<int>(gMixL.size()) < frames) {
    gMixL.resize(static_cast<size_t>(frames));
    gMixR.resize(static_cast<size_t>(frames));
  }
  std::fill(gMixL.begin(), gMixL.begin() + frames, 0.f);
  std::fill(gMixR.begin(), gMixR.begin() + frames, 0.f);

  std::vector<float> tmpL(static_cast<size_t>(frames));
  std::vector<float> tmpR(static_cast<size_t>(frames));

  {
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    for (auto& [id, slot] : gSlots) {
      (void)id;
      if (!slot || !slot->isPrepared()) continue;
      slot->process(tmpL.data(), tmpR.data(), frames);
      for (int i = 0; i < frames; ++i) {
        gMixL[static_cast<size_t>(i)] += tmpL[static_cast<size_t>(i)];
        gMixR[static_cast<size_t>(i)] += tmpR[static_cast<size_t>(i)];
      }
    }
  }

  for (int i = 0; i < frames; ++i) {
    out[i * 2 + 0] = std::max(-1.f, std::min(1.f, gMixL[static_cast<size_t>(i)]));
    out[i * 2 + 1] = std::max(-1.f, std::min(1.f, gMixR[static_cast<size_t>(i)]));
  }
}

static bool ensureAudioDevice(std::string& err) {
  if (gAudioRunning) return true;
  ma_device_config cfg = ma_device_config_init(ma_device_type_playback);
  cfg.playback.format = ma_format_f32;
  cfg.playback.channels = 2;
  cfg.playback.shareMode = ma_share_mode_shared; // crítico: no robar el device a Electron/Web Audio
  cfg.sampleRate = 0; // rate nativo del device (evita exclusive / SRC agresivo)
  cfg.periodSizeInFrames = 512;
  cfg.dataCallback = audioCallback;
  cfg.wasapi.noAutoConvertSRC = MA_FALSE;
  cfg.wasapi.usage = ma_wasapi_usage_default;
  if (ma_device_init(nullptr, &cfg, &gAudioDevice) != MA_SUCCESS) {
    // Retry fijo 48k shared
    cfg.sampleRate = 48000;
    if (ma_device_init(nullptr, &cfg, &gAudioDevice) != MA_SUCCESS) {
      err = "ma_device_init falló";
      return false;
    }
  }
  if (ma_device_start(&gAudioDevice) != MA_SUCCESS) {
    ma_device_uninit(&gAudioDevice);
    err = "ma_device_start falló";
    return false;
  }
  gAudioRunning = true;
  return true;
}

static void stopAudioDevice() {
  if (!gAudioRunning) return;
  ma_device_stop(&gAudioDevice);
  ma_device_uninit(&gAudioDevice);
  gAudioRunning = false;
}

static bool ensureSlotLoaded(const std::string& slotId, const std::string& path, std::string& err) {
  {
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    if (findSlotUnlocked(slotId)) return true;
  }
  if (path.empty()) {
    err = "path vacío";
    return false;
  }
  auto slot = std::make_unique<Vst3Slot>();
  slot->setSlotId(slotId);
  if (!slot->load(expandEnvPath(path), err)) return false;
  if (!ensureAudioDevice(err)) return false;
  const double rate =
      gAudioDevice.sampleRate > 0 ? static_cast<double>(gAudioDevice.sampleRate) : 48000.0;
  if (!slot->prepare(rate, 512, err)) return false;
  std::lock_guard<std::mutex> lock(gSlotsMutex);
  gSlots[slotId] = std::move(slot);
  gActiveSlot = slotId;
  return true;
}

static void executeUiJob(UiJob& job) {
  const std::string& json = job.json;
  std::string slotId = getStringField(json, "slotId");
  if (slotId.empty()) slotId = getStringField(json, "pluginId");
  const std::string path = getStringField(json, "path");
  if (slotId.empty()) slotId = path;

  if (job.kind == UiJob::Kind::OpenEditor) {
    std::string err;
    if (!ensureSlotLoaded(slotId, path, err)) {
      job.ok = false;
      job.err = err;
      return;
    }
    std::uintptr_t parent = 0;
    try {
      const auto s = getStringField(json, "parentHwnd");
      if (!s.empty()) parent = static_cast<std::uintptr_t>(std::stoull(s));
    } catch (...) {
      parent = static_cast<std::uintptr_t>(getNumberField(json, "parentHwnd", 0));
    }
    const int x = static_cast<int>(getNumberField(json, "x", 0));
    const int y = static_cast<int>(getNumberField(json, "y", 0));
    const int w = static_cast<int>(getNumberField(json, "w", 800));
    const int h = static_cast<int>(getNumberField(json, "h", 500));

    Vst3Slot* slot = nullptr;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      slot = findSlotUnlocked(slotId);
    }
    if (!slot) {
      job.ok = false;
      job.err = "slot desapareció";
      return;
    }
    // Sin mutex: CreateWindow/attached no deben bloquear el audio thread.
    if (!slot->openEditor(parent, x, y, w, h, err)) {
      job.ok = false;
      job.err = err;
      return;
    }
    gActiveSlot = slotId;
    job.ok = true;
    return;
  }

  if (job.kind == UiJob::Kind::SetBounds) {
    const int x = static_cast<int>(getNumberField(json, "x", 0));
    const int y = static_cast<int>(getNumberField(json, "y", 0));
    const int w = static_cast<int>(getNumberField(json, "w", 800));
    const int h = static_cast<int>(getNumberField(json, "h", 500));
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId);
    if (!slot) {
      job.ok = false;
      job.err = "slot no encontrado";
      return;
    }
    slot->setEditorBounds(x, y, w, h);
    job.ok = true;
    return;
  }

  if (job.kind == UiJob::Kind::CloseEditor) {
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId);
    if (slot) slot->closeEditor();
    job.ok = true;
  }
}

static void enqueueUiAsync(UiJob::Kind kind, const std::string& json) {
  auto job = std::make_shared<UiJob>();
  job->kind = kind;
  job->json = json;
  {
    std::lock_guard<std::mutex> lock(gUiQueueMu);
    gUiQueue.push_back(job);
  }
#ifdef _WIN32
  PostThreadMessageW(gMainThreadId, WM_NULL, 0, 0);
#endif
  // NO bloquear stdin: noteOn/load deben seguir. Respuesta al terminar el job en UI.
}

static void finishUiJob(const std::shared_ptr<UiJob>& job) {
  if (!job->replyWhenDone) return;
  std::string slotId = getStringField(job->json, "slotId");
  if (slotId.empty()) slotId = getStringField(job->json, "pluginId");
  if (job->ok)
    replyOk("\"slotId\":\"" + jsonEscape(slotId) + "\",\"editorReady\":true,\"audioReady\":true");
  else
    replyFail("PluginEditorFailed", job->err.empty() ? "UI job failed" : job->err);
}

static void drainUiQueue() {
  std::vector<std::shared_ptr<UiJob>> batch;
  {
    std::lock_guard<std::mutex> lock(gUiQueueMu);
    batch.swap(gUiQueue);
  }
  for (auto& job : batch) {
    executeUiJob(*job);
    {
      std::lock_guard<std::mutex> lk(job->mu);
      job->done = true;
    }
    job->cv.notify_one();
    finishUiJob(job);
  }
}

static void handleLoad(const std::string& json) {
  std::string path = getStringField(json, "path");
  std::string slotId = getStringField(json, "slotId");
  if (slotId.empty()) slotId = getStringField(json, "pluginId");
  if (slotId.empty()) slotId = path;
  std::string err;
  if (!ensureSlotLoaded(slotId, path, err)) {
    replyFail("PluginLoadFailed", err);
    return;
  }
  replyOk("\"slotId\":\"" + jsonEscape(slotId) + "\",\"latencySamples\":0,\"audioReady\":true");
}

static void handleUnload(const std::string& json) {
  std::string slotId = getStringField(json, "slotId");
  std::unique_ptr<Vst3Slot> doomed;
  {
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto it = gSlots.find(slotId);
    if (it != gSlots.end()) {
      doomed = std::move(it->second);
      gSlots.erase(it);
    }
    if (gActiveSlot == slotId) gActiveSlot.clear();
    if (gSlots.empty()) stopAudioDevice();
  }
  // closeEditor/unload fuera del mutex de audio
  if (doomed) doomed->unload();
  replyOk("\"slotId\":\"" + jsonEscape(slotId) + "\"");
}

static void handleNote(const std::string& json, bool on) {
  std::string slotId = getStringField(json, "slotId");
  if (slotId.empty()) slotId = gActiveSlot;
  const int pitch = static_cast<int>(getNumberField(json, "pitch", 60));
  float vel = static_cast<float>(getNumberField(json, "velocity", 0.8));
  std::lock_guard<std::mutex> lock(gSlotsMutex);
  auto* slot = findSlotUnlocked(slotId);
  if (!slot) {
    replyFail("PluginNotFound", "slot no cargado: " + slotId);
    return;
  }
  if (on)
    slot->noteOn(pitch, vel > 1.f ? vel / 127.f : vel);
  else
    slot->noteOff(pitch);
  replyOk("\"slotId\":\"" + jsonEscape(slotId) + "\"");
}

#endif // JASWAVE_HAS_VST3_SDK

static void handleLine(const std::string& line) {
  if (line.empty()) return;
  const std::string type = getStringField(line, "type");
  if (type == "ping") {
    replyOk(std::string("\"latencySamples\":0,\"editorReady\":") +
            (kAudioReady ? "true" : "false") + ",\"audioReady\":" +
            (kAudioReady ? "true" : "false"));
    return;
  }
  if (type == "discover") {
    handleDiscover(line);
    return;
  }

#if defined(JASWAVE_HAS_VST3_SDK)
  if (type == "load") {
    handleLoad(line);
    return;
  }
  if (type == "prepare") {
    replyOk("\"latencySamples\":0");
    return;
  }
  if (type == "unload") {
    handleUnload(line);
    return;
  }
  if (type == "noteOn") {
    handleNote(line, true);
    return;
  }
  if (type == "noteOff") {
    handleNote(line, false);
    return;
  }
  if (type == "allNotesOff") {
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = gActiveSlot;
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId);
    if (slot) slot->allNotesOff();
    replyOk("\"slotId\":\"" + jsonEscape(slotId) + "\"");
    return;
  }
  if (type == "openEditor") {
    // Respuesta inmediata: DecentSampler y otros cuelgan createView;
    // no bloquear la cola RPC (MIDI/audio). La UI se intenta en background.
    auto job = std::make_shared<UiJob>();
    job->kind = UiJob::Kind::OpenEditor;
    job->json = line;
    job->replyWhenDone = false;
    {
      std::lock_guard<std::mutex> lock(gUiQueueMu);
      gUiQueue.push_back(job);
    }
#ifdef _WIN32
    PostThreadMessageW(gMainThreadId, WM_NULL, 0, 0);
#endif
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = getStringField(line, "pluginId");
    replyOk("\"slotId\":\"" + jsonEscape(slotId) +
            "\",\"editorOpening\":true,\"editorReady\":false,\"audioReady\":true");
    return;
  }
  if (type == "setEditorBounds") {
    auto job = std::make_shared<UiJob>();
    job->kind = UiJob::Kind::SetBounds;
    job->json = line;
    job->replyWhenDone = false;
    {
      std::lock_guard<std::mutex> lock(gUiQueueMu);
      gUiQueue.push_back(job);
    }
#ifdef _WIN32
    PostThreadMessageW(gMainThreadId, WM_NULL, 0, 0);
#endif
    replyOk();
    return;
  }
  if (type == "closeEditor") {
    auto job = std::make_shared<UiJob>();
    job->kind = UiJob::Kind::CloseEditor;
    job->json = line;
    job->replyWhenDone = false;
    {
      std::lock_guard<std::mutex> lock(gUiQueueMu);
      gUiQueue.push_back(job);
    }
#ifdef _WIN32
    PostThreadMessageW(gMainThreadId, WM_NULL, 0, 0);
#endif
    replyOk();
    return;
  }
  if (type == "focusEditor" || type == "setBypass" || type == "getLatency" || type == "crashReport") {
    replyOk();
    return;
  }
#else
  if (type == "load" || type == "prepare" || type == "unload" || type == "openEditor" ||
      type == "noteOn" || type == "noteOff" || type == "setBypass" || type == "getLatency" ||
      type == "crashReport") {
    replyFail("HostNotReady", "Compila con JASWAVE_VST3_SDK=ON (Steinberg + miniaudio).");
    return;
  }
#endif
  replyFail("PluginLoadFailed", "Comando desconocido: " + type);
}

int main(int argc, char** argv) {
  (void)argc;
  (void)argv;
#ifdef _WIN32
  setvbuf(stdout, nullptr, _IONBF, 0);
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  (void)hr;
#else
  setvbuf(stdout, nullptr, _IOLBF, 0);
#endif
  std::cerr << "[jaswave-plugin-host] ready"
#if defined(JASWAVE_HAS_VST3_SDK)
               " (VST3 audio+editor)"
#else
               " (discover-only)"
#endif
            << "\n";

#ifdef _WIN32
#if defined(JASWAVE_HAS_VST3_SDK)
  gMainThreadId = GetCurrentThreadId();
#endif
#endif

  std::atomic<bool> running{true};
  std::thread stdinThread([&] {
#ifdef _WIN32
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
#endif
    std::string line;
    while (std::getline(std::cin, line)) {
      if (!line.empty() && line.back() == '\r') line.pop_back();
      handleLine(line);
    }
    running = false;
#if defined(JASWAVE_HAS_VST3_SDK)
    stopAudioDevice();
#endif
#ifdef _WIN32
    PostQuitMessage(0);
    CoUninitialize();
#endif
  });

#ifdef _WIN32
  MSG msg;
  while (running) {
#if defined(JASWAVE_HAS_VST3_SDK)
    drainUiQueue();
#endif
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
      if (msg.message == WM_QUIT) {
        running = false;
        break;
      }
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    Sleep(5);
  }
#else
  while (running) {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
#endif

  if (stdinThread.joinable()) stdinThread.join();
#if defined(JASWAVE_HAS_VST3_SDK)
  {
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    gSlots.clear();
  }
  stopAudioDevice();
#endif
  return 0;
}
