/**
 * JasWave Plugin Host — discover + VST3 load/MIDI/audio + editor embed (ADR-0011).
 */

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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
#include <ole2.h>
#else
#include <dirent.h>
#include <sys/stat.h>
#endif

#if defined(JASWAVE_HAS_VST3_SDK)
#include "vst3_slot.h"
#include "audio_output.h"
#include "mix_bus.h"
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

static void replyFail(const char* code, const std::string& message, const std::string& extraJson = "") {
  if (extraJson.empty()) {
    std::cout << "{\"ok\":false,\"code\":\"" << code << "\",\"message\":\"" << jsonEscape(message)
              << "\"}\n"
              << std::flush;
  } else {
    std::cout << "{\"ok\":false,\"code\":\"" << code << "\",\"message\":\"" << jsonEscape(message)
              << "\"," << extraJson << "}\n"
              << std::flush;
  }
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

static bool getBoolField(const std::string& json, const char* key, bool fallback = false) {
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = json.find(needle);
  if (pos == std::string::npos) return fallback;
  pos = json.find(':', pos);
  if (pos == std::string::npos) return fallback;
  pos = json.find_first_not_of(" \t", pos + 1);
  if (pos == std::string::npos) return fallback;
  if (json.compare(pos, 4, "true") == 0) return true;
  if (json.compare(pos, 5, "false") == 0) return false;
  return fallback;
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
static std::string gMixPipeName;
static std::atomic<float> gMasterGain{1.f};
static std::atomic<bool> gMasterMuted{false};
static float gMixL[8192];
static float gMixR[8192];
static float gTmpL[8192];
static float gTmpR[8192];
static float gChainL[8192];
static float gChainR[8192];
static float gFxL[8192];
static float gFxR[8192];
static float gStemInterleaved[8192 * 2];

static Vst3Slot* findSlotUnlocked(const std::string& slotId);

/** Graph Reaper en buffers POD (doble) — sin alloc en el audio thread. */
static constexpr int kMaxGraphTracks = 64;
static constexpr int kMaxChainSlots = 24;
static constexpr int kSlotIdLen = 96;

struct RtChainSlot {
  Vst3Slot* slot{nullptr};
  char slotId[kSlotIdLen]{};
  bool instrument{false};
  bool bypass{false};
};
struct RtTrackChain {
  uint16_t stemIndex{0};
  float gain{1.f};
  float pan{0.f};
  bool muted{false};
  uint16_t delaySamples{0};
  uint8_t slotCount{0};
  RtChainSlot slots[kMaxChainSlots]{};
};

static RtTrackChain gRtTracks[2][kMaxGraphTracks]{};
static uint8_t gRtTrackCount[2]{0, 0};
static RtChainSlot gRtMaster[2][kMaxChainSlots]{};
static uint8_t gRtMasterCount[2]{0, 0};
static std::atomic<int> gRtBuf{0};
static std::atomic<bool> gGraphActive{false};
static std::mutex gGraphMutex;  // solo control thread / publish
static uint16_t gRtMaxDelay[2]{0, 0};

static constexpr int kMaxPdc = 16384;
static float gPdcL[kMaxGraphTracks][kMaxPdc]{};
static float gPdcR[kMaxGraphTracks][kMaxPdc]{};
static uint32_t gPdcW[kMaxGraphTracks]{};
static float gPdcDawL[kMaxPdc]{};
static float gPdcDawR[kMaxPdc]{};
static uint32_t gPdcDawW{0};

struct TrackChainSlot {
  std::string slotId;
  bool instrument{false};
  bool bypass{false};
};
struct TrackChain {
  uint16_t stemIndex{0};
  float gain{1.f};
  float pan{0.f};
  bool muted{false};
  std::vector<TrackChainSlot> slots;
};

static void copySlotId(char* dst, const std::string& src) {
  if (!dst) return;
  const size_t n = std::min(src.size(), static_cast<size_t>(kSlotIdLen - 1));
  if (n) std::memcpy(dst, src.data(), n);
  dst[n] = '\0';
}

static void publishGraphUnlocked(const std::vector<TrackChain>& tracks,
                                 const std::vector<TrackChainSlot>& master) {
  const int write = 1 - gRtBuf.load(std::memory_order_relaxed);
  uint8_t tn = 0;
  for (const auto& tr : tracks) {
    if (tn >= kMaxGraphTracks) break;
    RtTrackChain& out = gRtTracks[write][tn];
    out.stemIndex = tr.stemIndex;
    out.gain = tr.gain;
    out.pan = tr.pan;
    out.muted = tr.muted;
    out.slotCount = 0;
    for (const auto& cs : tr.slots) {
      if (out.slotCount >= kMaxChainSlots) break;
      RtChainSlot& rs = out.slots[out.slotCount++];
      copySlotId(rs.slotId, cs.slotId);
      rs.instrument = cs.instrument;
      rs.bypass = cs.bypass;
      rs.slot = findSlotUnlocked(cs.slotId);
    }
    ++tn;
  }
  int maxLat = 0;
  int lats[kMaxGraphTracks]{};
  for (uint8_t t = 0; t < tn; ++t) {
    int lat = 0;
    RtTrackChain& out = gRtTracks[write][t];
    for (uint8_t s = 0; s < out.slotCount; ++s) {
      const RtChainSlot& cs = out.slots[s];
      if (cs.bypass || !cs.slot) continue;
      lat += std::max(0, cs.slot->latencySamples());
    }
    lats[t] = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (maxLat > kMaxPdc - 1) maxLat = kMaxPdc - 1;
  for (uint8_t t = 0; t < tn; ++t) {
    const int lat = std::min(lats[t], maxLat);
    gRtTracks[write][t].delaySamples = static_cast<uint16_t>(maxLat - lat);
  }
  gRtMaxDelay[write] = static_cast<uint16_t>(maxLat);
  gRtTrackCount[write] = tn;

  uint8_t mn = 0;
  for (const auto& cs : master) {
    if (mn >= kMaxChainSlots) break;
    RtChainSlot& rs = gRtMaster[write][mn++];
    copySlotId(rs.slotId, cs.slotId);
    rs.instrument = cs.instrument;
    rs.bypass = cs.bypass;
    rs.slot = findSlotUnlocked(cs.slotId);
  }
  gRtMasterCount[write] = mn;
  gRtBuf.store(write, std::memory_order_release);
  gGraphActive.store(true, std::memory_order_release);
}

static void clearSlotPointersInGraph(Vst3Slot* doomed) {
  if (!doomed) return;
  for (int b = 0; b < 2; ++b) {
    for (uint8_t t = 0; t < gRtTrackCount[b]; ++t) {
      for (uint8_t s = 0; s < gRtTracks[b][t].slotCount; ++s) {
        if (gRtTracks[b][t].slots[s].slot == doomed) gRtTracks[b][t].slots[s].slot = nullptr;
      }
    }
    for (uint8_t s = 0; s < gRtMasterCount[b]; ++s) {
      if (gRtMaster[b][s].slot == doomed) gRtMaster[b][s].slot = nullptr;
    }
  }
}

#ifdef _WIN32
static DWORD gMainThreadId = 0;
static constexpr UINT WM_JASWAVE_JOB = WM_APP + 7;
#endif

static void applyTrackGainPan(float* l, float* r, int frames, float gain, float pan, bool muted) {
  if (muted || gain <= 0.f) {
    std::fill(l, l + frames, 0.f);
    std::fill(r, r + frames, 0.f);
    return;
  }
  const float g = std::max(0.f, std::min(2.f, gain));
  const float p = std::max(-1.f, std::min(1.f, pan));
  const float theta = (p + 1.f) * 0.7853981633974483f;  // (pan+1) * π/4
  const float gL = g * std::cos(theta);
  const float gR = g * std::sin(theta);
  for (int i = 0; i < frames; ++i) {
    l[i] *= gL;
    r[i] *= gR;
  }
}

static void applyPdc(float* l, float* r, int frames, float* dL, float* dR, uint32_t& w, int delay) {
  if (!l || !r || !dL || !dR || frames <= 0) return;
  if (delay <= 0) return;
  const int cap = kMaxPdc;
  delay = std::min(delay, cap - 1);
  const uint32_t capU = static_cast<uint32_t>(cap);
  uint32_t pos = w;
  for (int i = 0; i < frames; ++i) {
    const uint32_t ri = (pos + static_cast<uint32_t>(cap - delay)) % capU;
    const float ol = dL[ri];
    const float orr = dR[ri];
    dL[pos] = l[i];
    dR[pos] = r[i];
    l[i] = ol;
    r[i] = orr;
    pos = (pos + 1u) % capU;
  }
  w = pos;
}

static void renderMix(float* interleaved, uint32_t frameCount) {
  const int frames = static_cast<int>(std::min<uint32_t>(frameCount, 8192));
  if (frames <= 0) return;
  std::fill(gMixL, gMixL + frames, 0.f);
  std::fill(gMixR, gMixR + frames, 0.f);

  const bool useGraph = gGraphActive.load(std::memory_order_acquire);
  const int idx = gRtBuf.load(std::memory_order_acquire);

  if (useGraph) {
    const uint8_t trackN = gRtTrackCount[idx];
    for (uint8_t t = 0; t < trackN && t < kMaxGraphTracks; ++t) {
      const RtTrackChain& tr = gRtTracks[idx][t];
      jaswave_mix_bus_pull_stem(tr.stemIndex, gStemInterleaved, static_cast<uint32_t>(frames));
      for (int i = 0; i < frames; ++i) {
        gChainL[i] = gStemInterleaved[i * 2];
        gChainR[i] = gStemInterleaved[i * 2 + 1];
      }
      for (uint8_t s = 0; s < tr.slotCount; ++s) {
        const RtChainSlot& cs = tr.slots[s];
        Vst3Slot* slot = cs.slot;
        if (!slot || !slot->isPrepared()) continue;
        if (cs.bypass) continue;
        if (cs.instrument) {
          slot->process(nullptr, nullptr, gFxL, gFxR, frames);
          for (int i = 0; i < frames; ++i) {
            gChainL[i] += gFxL[i];
            gChainR[i] += gFxR[i];
          }
        } else {
          slot->process(gChainL, gChainR, gFxL, gFxR, frames);
          std::memcpy(gChainL, gFxL, static_cast<size_t>(frames) * sizeof(float));
          std::memcpy(gChainR, gFxR, static_cast<size_t>(frames) * sizeof(float));
        }
      }
      applyTrackGainPan(gChainL, gChainR, frames, tr.gain, tr.pan, tr.muted);
      applyPdc(gChainL, gChainR, frames, gPdcL[t], gPdcR[t], gPdcW[t],
               static_cast<int>(tr.delaySamples));
      for (int i = 0; i < frames; ++i) {
        gMixL[i] += gChainL[i];
        gMixR[i] += gChainR[i];
      }
    }
    const uint8_t masterN = gRtMasterCount[idx];
    for (uint8_t s = 0; s < masterN; ++s) {
      const RtChainSlot& cs = gRtMaster[idx][s];
      Vst3Slot* slot = cs.slot;
      if (!slot || !slot->isPrepared() || cs.bypass) continue;
      slot->process(gMixL, gMixR, gFxL, gFxR, frames);
      std::memcpy(gMixL, gFxL, static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(gMixR, gFxR, static_cast<size_t>(frames) * sizeof(float));
    }
  } else {
    // Legacy: suma paralela de todos los slots
    Vst3Slot* snapshot[48]{};
    int n = 0;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      for (auto& [id, slot] : gSlots) {
        (void)id;
        if (!slot || !slot->isPrepared() || n >= 48) continue;
        snapshot[n++] = slot.get();
      }
    }
    for (int s = 0; s < n; ++s) {
      snapshot[s]->process(nullptr, nullptr, gTmpL, gTmpR, frames);
      snapshot[s]->applyMix(gTmpL, gTmpR, frames);
      for (int i = 0; i < frames; ++i) {
        gMixL[i] += gTmpL[i];
        gMixR[i] += gTmpR[i];
      }
    }
  }

  const float masterG = gMasterMuted.load(std::memory_order_relaxed)
                            ? 0.f
                            : gMasterGain.load(std::memory_order_relaxed);
  for (int i = 0; i < frames; ++i) {
    interleaved[i * 2 + 0] = gMixL[i] * masterG;
    interleaved[i * 2 + 1] = gMixR[i] * masterG;
  }
  std::memset(gStemInterleaved, 0, static_cast<size_t>(frames) * 2 * sizeof(float));
  jaswave_mix_bus_add(gStemInterleaved, static_cast<uint32_t>(frames));
  for (int i = 0; i < frames; ++i) {
    gTmpL[i] = gStemInterleaved[i * 2];
    gTmpR[i] = gStemInterleaved[i * 2 + 1];
  }
  const int dawDelay = useGraph ? static_cast<int>(gRtMaxDelay[idx]) : 0;
  applyPdc(gTmpL, gTmpR, frames, gPdcDawL, gPdcDawR, gPdcDawW, dawDelay);
  for (int i = 0; i < frames; ++i) {
    interleaved[i * 2 + 0] = std::max(-1.f, std::min(1.f, interleaved[i * 2 + 0] + gTmpL[i]));
    interleaved[i * 2 + 1] = std::max(-1.f, std::min(1.f, interleaved[i * 2 + 1] + gTmpR[i]));
  }
}

struct UiJob {
  enum class Kind {
    OpenEditor,
    SetBounds,
    CloseEditor,
    Load,
    Unload,
    ListDevices,
    SetDevice,
    GetDevice,
    TestTone,
    AsioPanel,
    EnsureAudio
  } kind{};
  std::string json;
  std::string err;
  std::string extraJson;
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

static bool ensureAudioDevice(std::string& err) {
  const auto st = jaswave_audio_status();
  if (st.running) {
    const uint32_t sr = st.actualSampleRate ? st.actualSampleRate : st.cfg.sampleRate;
    if (sr) jaswave_mix_bus_set_output_rate(sr);
    return true;
  }
  JaswaveAudioConfig cfg = st.cfg;
  if (cfg.backend.empty()) cfg.backend = "auto";
  if (!cfg.sampleRate) cfg.sampleRate = 48000;
  if (!cfg.bufferSize) cfg.bufferSize = 512;
  jaswave_audio_set_renderer(renderMix);
  if (!jaswave_audio_start(cfg, err)) return false;
  const auto st2 = jaswave_audio_status();
  const uint32_t sr = st2.actualSampleRate ? st2.actualSampleRate : cfg.sampleRate;
  if (sr) jaswave_mix_bus_set_output_rate(sr);
  return true;
}

static void stopAudioDevice() { jaswave_audio_stop(); }

static uint32_t currentBlockSize() {
  const auto st = jaswave_audio_status();
  const uint32_t b = st.actualBufferSize ? st.actualBufferSize : st.cfg.bufferSize;
  return std::max(512u, std::min(b * 4u, 4096u));
}

static double currentSampleRate() {
  const auto st = jaswave_audio_status();
  if (st.actualSampleRate) return static_cast<double>(st.actualSampleRate);
  return st.cfg.sampleRate ? static_cast<double>(st.cfg.sampleRate) : 48000.0;
}

static bool ensureSlotLoaded(const std::string& slotId, const std::string& path, std::string& err);

static std::string audioStatusJsonObject() {
  const auto st = jaswave_audio_status();
  std::ostringstream o;
  o << "{\"backend\":\"" << jsonEscape(st.cfg.backend) << "\""
    << ",\"deviceId\":\"" << jsonEscape(st.cfg.deviceId) << "\""
    << ",\"deviceName\":\"" << jsonEscape(st.deviceName) << "\""
    << ",\"sampleRate\":" << (st.actualSampleRate ? st.actualSampleRate : st.cfg.sampleRate)
    << ",\"bufferSize\":" << (st.actualBufferSize ? st.actualBufferSize : st.cfg.bufferSize)
    << ",\"exclusive\":" << (st.cfg.exclusive ? "true" : "false")
    << ",\"running\":" << (st.running ? "true" : "false")
    << ",\"lastError\":\"" << jsonEscape(st.lastError) << "\"}";
  return o.str();
}

static std::string listDevicesExtraJson() {
  std::vector<JaswaveAudioBackendInfo> backends;
  std::vector<JaswaveAudioDevice> devices;
  std::string err;
  jaswave_audio_list(backends, devices, err);
  std::ostringstream o;
  o << "\"backends\":[";
  for (size_t i = 0; i < backends.size(); ++i) {
    if (i) o << ",";
    o << "{\"id\":\"" << jsonEscape(backends[i].id) << "\",\"name\":\"" << jsonEscape(backends[i].name)
      << "\",\"available\":" << (backends[i].available ? "true" : "false") << ",\"hint\":\""
      << jsonEscape(backends[i].hint) << "\"}";
  }
  o << "],\"devices\":[";
  for (size_t i = 0; i < devices.size(); ++i) {
    if (i) o << ",";
    o << "{\"id\":\"" << jsonEscape(devices[i].id) << "\",\"backend\":\"" << jsonEscape(devices[i].backend)
      << "\",\"name\":\"" << jsonEscape(devices[i].name)
      << "\",\"isDefault\":" << (devices[i].isDefault ? "true" : "false")
      << ",\"available\":" << (devices[i].available ? "true" : "false") << "}";
  }
  o << "],\"audio\":" << audioStatusJsonObject();
  return o.str();
}

static bool applyAudioConfigFromJson(const std::string& json, std::string& err) {
  JaswaveAudioConfig cfg;
  cfg.backend = getStringField(json, "backend");
  if (cfg.backend.empty()) cfg.backend = getStringField(json, "api");
  cfg.deviceId = getStringField(json, "deviceId");
  if (cfg.deviceId.empty()) cfg.deviceId = getStringField(json, "device");
  cfg.sampleRate = static_cast<uint32_t>(getNumberField(json, "sampleRate", 48000));
  cfg.bufferSize = static_cast<uint32_t>(getNumberField(json, "bufferSize", 512));
  cfg.exclusive = getBoolField(json, "exclusive", cfg.backend == "wasapi_exclusive");
  const auto st = jaswave_audio_status();
  const bool wantSharedWasapi =
      !cfg.exclusive && cfg.backend != "asio" && cfg.backend != "wasapi_exclusive" &&
      (cfg.backend.empty() || cfg.backend == "wasapi" || cfg.backend == "auto");
  const bool haveSharedWasapi = st.running && !st.cfg.exclusive && st.cfg.backend != "asio" &&
                                (st.cfg.backend.empty() || st.cfg.backend == "wasapi" ||
                                 st.cfg.backend == "auto");
  if (haveSharedWasapi && wantSharedWasapi) {
    /* Un segundo ma_device_init en la UMC (y suspend/reprepare de BFD) corrompe el heap. */
    jaswave_audio_set_renderer(renderMix);
    const uint32_t sr = st.actualSampleRate ? st.actualSampleRate : st.cfg.sampleRate;
    if (sr) jaswave_mix_bus_set_output_rate(sr);
    err.clear();
    return true;
  }
  // No procesar VST mientras el driver arranca (BFD en el callback ASIO = heap 0xC0000374).
  jaswave_audio_set_renderer(nullptr);
  std::vector<Vst3Slot*> toSuspend;
  {
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    for (auto& [id, slot] : gSlots) {
      (void)id;
      if (slot) toSuspend.push_back(slot.get());
    }
  }
  for (auto* slot : toSuspend) slot->suspendForAudioRestart();
  if (!jaswave_audio_start(cfg, err)) {
    jaswave_audio_set_renderer(renderMix);
    return false;
  }
#ifdef _WIN32
  if (cfg.backend == "asio") Sleep(80);
#endif
  std::vector<Vst3Slot*> slots;
  {
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    for (auto& [id, slot] : gSlots) {
      (void)id;
      if (slot) slots.push_back(slot.get());
    }
  }
  for (auto* slot : slots) {
    std::string perr;
    if (!slot->reprepare(currentSampleRate(), static_cast<int32_t>(currentBlockSize()), perr)) {
      std::cerr << "[jaswave-plugin-host] reprepare tras setAudioDevice: " << perr << "\n";
    }
  }
  jaswave_mix_bus_set_output_rate(static_cast<uint32_t>(currentSampleRate()));
  jaswave_mix_bus_reset();
  jaswave_audio_set_renderer(renderMix);
  return true;
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
  if (!ensureAudioDevice(err)) return false;
  if (!slot->load(expandEnvPath(path), err)) return false;
  if (!slot->prepare(currentSampleRate(), static_cast<int32_t>(currentBlockSize()), err)) return false;
  std::lock_guard<std::mutex> lock(gSlotsMutex);
  gSlots[slotId] = std::move(slot);
  gActiveSlot = slotId;
  // Re-enlazar punteros del graph activo (si ya había setTrackGraph).
  {
    std::lock_guard<std::mutex> graphLock(gGraphMutex);
    const int idx = gRtBuf.load(std::memory_order_relaxed);
    for (uint8_t t = 0; t < gRtTrackCount[idx]; ++t) {
      for (uint8_t s = 0; s < gRtTracks[idx][t].slotCount; ++s) {
        auto& rs = gRtTracks[idx][t].slots[s];
        if (rs.slotId[0]) rs.slot = findSlotUnlocked(rs.slotId);
      }
    }
    for (uint8_t s = 0; s < gRtMasterCount[idx]; ++s) {
      auto& rs = gRtMaster[idx][s];
      if (rs.slotId[0]) rs.slot = findSlotUnlocked(rs.slotId);
    }
  }
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
    Vst3Slot* slot = nullptr;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      slot = findSlotUnlocked(slotId);
    }
    if (slot) slot->closeEditor();
    job.ok = true;
    return;
  }

  if (job.kind == UiJob::Kind::Load) {
    std::string err;
    if (!ensureSlotLoaded(slotId, path, err)) {
      job.ok = false;
      job.err = err;
      return;
    }
    job.ok = true;
    int lat = 0;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      if (auto* s = findSlotUnlocked(slotId)) lat = s->latencySamples();
    }
    job.extraJson = "\"slotId\":\"" + jsonEscape(slotId) +
                    "\",\"latencySamples\":" + std::to_string(lat) +
                    ",\"audioReady\":true,\"audio\":" + audioStatusJsonObject();
    return;
  }

  if (job.kind == UiJob::Kind::Unload) {
    std::unique_ptr<Vst3Slot> doomed;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      auto it = gSlots.find(slotId);
      if (it != gSlots.end()) {
        doomed = std::move(it->second);
        gSlots.erase(it);
      }
      if (gActiveSlot == slotId) gActiveSlot.clear();
      if (doomed) clearSlotPointersInGraph(doomed.get());
    }
    if (doomed) doomed->unload();
    job.ok = true;
    job.extraJson = "\"slotId\":\"" + jsonEscape(slotId) + "\"";
    return;
  }

  if (job.kind == UiJob::Kind::ListDevices) {
    job.ok = true;
    job.extraJson = listDevicesExtraJson();
    return;
  }

  if (job.kind == UiJob::Kind::SetDevice) {
    std::string err;
    if (!applyAudioConfigFromJson(json, err)) {
      job.ok = false;
      job.err = err;
      job.extraJson = "\"audio\":" + audioStatusJsonObject();
      return;
    }
    job.ok = true;
    job.extraJson = "\"audio\":" + audioStatusJsonObject();
    return;
  }

  if (job.kind == UiJob::Kind::GetDevice) {
    job.ok = true;
    job.extraJson = "\"audio\":" + audioStatusJsonObject();
    return;
  }

  if (job.kind == UiJob::Kind::TestTone) {
    std::string err;
    if (!ensureAudioDevice(err)) {
      job.ok = false;
      job.err = err;
      return;
    }
    const auto st = jaswave_audio_status();
    const uint32_t sr = st.actualSampleRate ? st.actualSampleRate : 48000;
    jaswave_audio_test_tone(sr / 2);  // ~0.5 s
    job.ok = true;
    job.extraJson = "\"audio\":" + audioStatusJsonObject();
    return;
  }

  if (job.kind == UiJob::Kind::AsioPanel) {
    std::string err;
    std::string id = getStringField(json, "deviceId");
    if (id.empty()) id = getStringField(json, "backend");
    if (!jaswave_audio_asio_control_panel(id, err)) {
      job.ok = false;
      job.err = err;
      return;
    }
    job.ok = true;
    return;
  }

  if (job.kind == UiJob::Kind::EnsureAudio) {
    std::string err;
    if (!ensureAudioDevice(err)) {
      job.ok = false;
      job.err = err;
      return;
    }
    job.ok = true;
    job.extraJson = "\"audio\":" + audioStatusJsonObject();
    return;
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
  PostThreadMessageW(gMainThreadId, WM_JASWAVE_JOB, 0, 0);
#endif
  // NO bloquear stdin: noteOn/load deben seguir. Respuesta al terminar el job en UI.
}

static void enqueueUiAndWait(const std::shared_ptr<UiJob>& job) {
  {
    std::lock_guard<std::mutex> lock(gUiQueueMu);
    gUiQueue.push_back(job);
  }
#ifdef _WIN32
  PostThreadMessageW(gMainThreadId, WM_JASWAVE_JOB, 0, 0);
#endif
  std::unique_lock<std::mutex> lk(job->mu);
  job->cv.wait(lk, [&] { return job->done; });
}

static void finishUiJob(const std::shared_ptr<UiJob>& job) {
  if (!job->replyWhenDone) return;
  std::string slotId = getStringField(job->json, "slotId");
  if (slotId.empty()) slotId = getStringField(job->json, "pluginId");
  if (job->ok) {
    std::string extra = job->extraJson;
    if (extra.empty()) {
      extra = "\"slotId\":\"" + jsonEscape(slotId) + "\",\"editorReady\":true,\"audioReady\":true";
    }
    replyOk(extra);
  } else {
    const char* code =
        (job->kind == UiJob::Kind::Load) ? "PluginLoadFailed" : "PluginEditorFailed";
    if (job->kind == UiJob::Kind::SetDevice) code = "AudioDeviceFailed";
    else if (job->kind == UiJob::Kind::ListDevices) code = "HostNotReady";
    replyFail(code, job->err.empty() ? "UI job failed" : job->err, job->extraJson);
  }
}

static bool isAudioDeviceJob(UiJob::Kind k) {
  using K = UiJob::Kind;
  return k == K::ListDevices || k == K::SetDevice || k == K::GetDevice || k == K::TestTone ||
         k == K::AsioPanel || k == K::EnsureAudio;
}

static void drainUiQueue() {
  std::vector<std::shared_ptr<UiJob>> batch;
  {
    std::lock_guard<std::mutex> lock(gUiQueueMu);
    batch.swap(gUiQueue);
  }
  std::stable_partition(batch.begin(), batch.end(), [](const std::shared_ptr<UiJob>& j) {
    return j && isAudioDeviceJob(j->kind);
  });
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
  auto job = std::make_shared<UiJob>();
  job->kind = UiJob::Kind::Load;
  job->json = json;
  job->replyWhenDone = true;
  enqueueUiAndWait(job);
}

static void handleUnload(const std::string& json) {
  auto job = std::make_shared<UiJob>();
  job->kind = UiJob::Kind::Unload;
  job->json = json;
  job->replyWhenDone = true;
  enqueueUiAndWait(job);
}

static void handleUiRpc(UiJob::Kind kind, const std::string& json) {
  auto job = std::make_shared<UiJob>();
  job->kind = kind;
  job->json = json;
  job->replyWhenDone = true;
  enqueueUiAndWait(job);
}

static void handleNote(const std::string& json, bool on) {
  std::string slotId = getStringField(json, "slotId");
  if (slotId.empty()) slotId = gActiveSlot;
  const int pitch = static_cast<int>(getNumberField(json, "pitch", 60));
  float vel = static_cast<float>(getNumberField(json, "velocity", 0.8));
  std::lock_guard<std::mutex> lock(gSlotsMutex);
  auto* slot = findSlotUnlocked(slotId);
  if (!slot) {
    static std::atomic<uint32_t> missingLogs{0};
    const uint32_t n = missingLogs.fetch_add(1, std::memory_order_relaxed);
    if (n < 6 || (n % 250) == 0) {
      std::cerr << "[jaswave-plugin-host] note: slot no cargado: " << slotId << "\n";
    }
    return;
  }
  if (on) {
    slot->noteOn(pitch, vel > 1.f ? vel / 127.f : vel);
  } else {
    slot->noteOff(pitch);
  }
}

#endif // JASWAVE_HAS_VST3_SDK

static void handleLine(const std::string& line) {
  if (line.empty()) return;
  const std::string type = getStringField(line, "type");
  if (type == "ping") {
    std::string extra = std::string("\"latencySamples\":0,\"editorReady\":") +
                        (kAudioReady ? "true" : "false") + ",\"audioReady\":" +
                        (kAudioReady ? "true" : "false");
#if defined(JASWAVE_HAS_VST3_SDK)
    if (!gMixPipeName.empty()) extra += ",\"mixPipe\":\"" + jsonEscape(gMixPipeName) + "\"";
#endif
    replyOk(extra);
    return;
  }
  if (type == "setHostWindow") {
#ifdef _WIN32
    const std::string s = getStringField(line, "hwnd");
    uintptr_t v = 0;
    if (!s.empty()) v = static_cast<uintptr_t>(std::strtoull(s.c_str(), nullptr, 10));
    jaswave_audio_set_sys_handle(reinterpret_cast<void*>(v));
#endif
    replyOk();
    return;
  }
  if (type == "setMixInputRate") {
#if defined(JASWAVE_HAS_VST3_SDK)
    const uint32_t sr = static_cast<uint32_t>(getNumberField(line, "sampleRate", 48000));
    jaswave_mix_bus_set_input_rate(sr);
#endif
    return;  // fire-and-forget: no reply (no mezclar con la cola RPC)
  }
  if (type == "setSlotMix" || type == "setMasterMix") {
#if defined(JASWAVE_HAS_VST3_SDK)
    if (type == "setMasterMix") {
      const float g = static_cast<float>(getNumberField(line, "gain", 1));
      gMasterGain.store(std::max(0.f, std::min(2.f, g)), std::memory_order_relaxed);
      gMasterMuted.store(getBoolField(line, "muted", false), std::memory_order_relaxed);
    } else {
      std::string slotId = getStringField(line, "slotId");
      if (slotId.empty()) slotId = gActiveSlot;
      const float g = static_cast<float>(getNumberField(line, "gain", 1));
      const float pan = static_cast<float>(getNumberField(line, "pan", 0));
      const bool muted = getBoolField(line, "muted", false);
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      auto* slot = findSlotUnlocked(slotId);
      if (slot) slot->setMix(g, pan, muted);
    }
#endif
    return;
  }
  if (type == "setTrackGraph") {
#if defined(JASWAVE_HAS_VST3_SDK)
    // encoding: "idx|slotId:i|e:0|1,...;idx|...||masterSlot:e:0,..."
    const std::string enc = getStringField(line, "encoding");
    std::vector<TrackChain> tracks;
    std::vector<TrackChainSlot> master;
    auto parseSlotList = [](const std::string& part, std::vector<TrackChainSlot>& out) {
      size_t p = 0;
      while (p < part.size()) {
        size_t comma = part.find(',', p);
        std::string tok = part.substr(p, comma == std::string::npos ? std::string::npos : comma - p);
        // slotId:role:bypass
        size_t c1 = tok.rfind(':');
        size_t c0 = c1 == std::string::npos ? std::string::npos : tok.rfind(':', c1 - 1);
        if (c0 != std::string::npos && c1 != std::string::npos && c1 > c0) {
          TrackChainSlot cs;
          cs.slotId = tok.substr(0, c0);
          cs.instrument = tok.substr(c0 + 1, c1 - c0 - 1) == "i";
          cs.bypass = tok.substr(c1 + 1) == "1";
          if (!cs.slotId.empty()) out.push_back(std::move(cs));
        }
        if (comma == std::string::npos) break;
        p = comma + 1;
      }
    };
    size_t masterSep = enc.find("||");
    std::string tracksPart = masterSep == std::string::npos ? enc : enc.substr(0, masterSep);
    std::string masterPart = masterSep == std::string::npos ? "" : enc.substr(masterSep + 2);
    size_t p = 0;
    while (p < tracksPart.size()) {
      size_t semi = tracksPart.find(';', p);
      std::string seg = tracksPart.substr(p, semi == std::string::npos ? std::string::npos : semi - p);
      size_t bar = seg.find('|');
      if (bar != std::string::npos) {
        TrackChain tc;
        try {
          tc.stemIndex = static_cast<uint16_t>(std::stoi(seg.substr(0, bar)));
        } catch (...) {
          tc.stemIndex = 0;
        }
        // optional :gain:pan:muted after index — "0:0.8:0:0|slots"
        size_t colon = seg.find(':');
        size_t firstBar = bar;
        if (colon != std::string::npos && colon < firstBar) {
          // idx only before |
        }
        // Extended: idx~gain~pan~muted|slots
        size_t tilde = seg.find('~');
        if (tilde != std::string::npos && tilde < firstBar) {
          try {
            tc.stemIndex = static_cast<uint16_t>(std::stoi(seg.substr(0, tilde)));
          } catch (...) {
          }
          size_t t2 = seg.find('~', tilde + 1);
          size_t t3 = t2 == std::string::npos ? std::string::npos : seg.find('~', t2 + 1);
          try {
            if (t2 != std::string::npos) tc.gain = std::stof(seg.substr(tilde + 1, t2 - tilde - 1));
            if (t2 != std::string::npos && t3 != std::string::npos)
              tc.pan = std::stof(seg.substr(t2 + 1, t3 - t2 - 1));
            if (t3 != std::string::npos && t3 < firstBar)
              tc.muted = seg.substr(t3 + 1, firstBar - t3 - 1) == "1";
          } catch (...) {
          }
        }
        parseSlotList(seg.substr(firstBar + 1), tc.slots);
        if (tc.stemIndex < JASWAVE_MIX_MAX_TRACKS) tracks.push_back(std::move(tc));
      }
      if (semi == std::string::npos) break;
      p = semi + 1;
    }
    parseSlotList(masterPart, master);
    {
      std::lock_guard<std::mutex> slotsLock(gSlotsMutex);
      std::lock_guard<std::mutex> graphLock(gGraphMutex);
      publishGraphUnlocked(tracks, master);
    }
#endif
    return;  // fire-and-forget
  }
  if (type == "setBypass") {
#if defined(JASWAVE_HAS_VST3_SDK)
    std::string slotId = getStringField(line, "slotId");
    const bool bypass = getBoolField(line, "bypass", false);
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      auto* slot = findSlotUnlocked(slotId);
      if (slot) slot->setBypass(bypass);
    }
    {
      std::lock_guard<std::mutex> glock(gGraphMutex);
      for (int b = 0; b < 2; ++b) {
        for (uint8_t t = 0; t < gRtTrackCount[b]; ++t) {
          for (uint8_t s = 0; s < gRtTracks[b][t].slotCount; ++s) {
            if (slotId == gRtTracks[b][t].slots[s].slotId) gRtTracks[b][t].slots[s].bypass = bypass;
          }
        }
        for (uint8_t s = 0; s < gRtMasterCount[b]; ++s) {
          if (slotId == gRtMaster[b][s].slotId) gRtMaster[b][s].bypass = bypass;
        }
      }
    }
    replyOk();
    return;
#endif
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
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = gActiveSlot;
    int lat = 0;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      if (auto* s = findSlotUnlocked(slotId)) lat = s->latencySamples();
    }
    replyOk("\"latencySamples\":" + std::to_string(lat));
    return;
  }
  if (type == "unload") {
    handleUnload(line);
    return;
  }
  if (type == "noteOn") {
    handleNote(line, true);
    return; // sin reply — MIDI fire-and-forget
  }
  if (type == "noteOff") {
    handleNote(line, false);
    return;
  }
  if (type == "allNotesOff") {
    std::string slotId = getStringField(line, "slotId");
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    if (slotId.empty()) {
      for (auto& [id, slot] : gSlots) {
        if (slot) slot->allNotesOff();
      }
    } else {
      auto* slot = findSlotUnlocked(slotId);
      if (slot) slot->allNotesOff();
    }
    return;
  }
  if (type == "midiCc") {
    std::string slotId = getStringField(line, "slotId");
    const int cc = static_cast<int>(getNumberField(line, "cc", 64));
    const int value = static_cast<int>(getNumberField(line, "value", 0));
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId.empty() ? gActiveSlot : slotId);
    if (slot) slot->midiCc(cc, value);
    return;
  }
  if (type == "setTransport") {
    const bool playing = getBoolField(line, "playing", false);
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    for (auto& [id, slot] : gSlots) {
      if (slot) slot->setPlaying(playing);
    }
    return;
  }
  if (type == "listParameters") {
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = gActiveSlot;
    const int maxCount = static_cast<int>(getNumberField(line, "maxCount", 400));
    std::vector<Vst3ParamDesc> params;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      auto* slot = findSlotUnlocked(slotId);
      if (!slot) {
        replyFail("PluginNotFound", "slot no cargado: " + slotId);
        return;
      }
      params = slot->listParameters(maxCount);
    }
    std::ostringstream js;
    js << "\"slotId\":\"" << jsonEscape(slotId) << "\",\"parameterCount\":" << params.size()
       << ",\"parameters\":[";
    for (size_t i = 0; i < params.size(); ++i) {
      const auto& p = params[i];
      if (i) js << ",";
      js << "{\"id\":" << p.id << ",\"parameterId\":\"" << p.id << "\",\"name\":\""
         << jsonEscape(p.name) << "\",\"shortName\":\"" << jsonEscape(p.shortName)
         << "\",\"unit\":\"" << jsonEscape(p.unit) << "\",\"displayValue\":\""
         << jsonEscape(p.display) << "\",\"normalizedValue\":" << p.normalized
         << ",\"defaultNormalizedValue\":" << p.defaultNormalized << ",\"stepCount\":"
         << p.stepCount << ",\"automatable\":" << (p.automatable ? "true" : "false")
         << ",\"readOnly\":" << (p.readOnly ? "true" : "false") << ",\"hidden\":"
         << (p.hidden ? "true" : "false") << ",\"bypass\":" << (p.bypass ? "true" : "false")
         << ",\"programChange\":" << (p.programChange ? "true" : "false") << "}";
    }
    js << "]";
    replyOk(js.str());
    return;
  }
  if (type == "setParameter") {
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = gActiveSlot;
    const uint32_t paramId = static_cast<uint32_t>(getNumberField(line, "paramId", 0));
    const double value = getNumberField(line, "normalizedValue", 0);
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId);
    if (!slot) {
      replyFail("PluginNotFound", "slot no cargado: " + slotId);
      return;
    }
    slot->setParameterNormalized(paramId, value);
    replyOk("\"slotId\":\"" + jsonEscape(slotId) + "\",\"paramId\":" + std::to_string(paramId));
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
    PostThreadMessageW(gMainThreadId, WM_JASWAVE_JOB, 0, 0);
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
    PostThreadMessageW(gMainThreadId, WM_JASWAVE_JOB, 0, 0);
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
    PostThreadMessageW(gMainThreadId, WM_JASWAVE_JOB, 0, 0);
#endif
    replyOk();
    return;
  }
  if (type == "listAudioDevices") {
    handleUiRpc(UiJob::Kind::ListDevices, line);
    return;
  }
  if (type == "setAudioDevice") {
    handleUiRpc(UiJob::Kind::SetDevice, line);
    return;
  }
  if (type == "getAudioDevice") {
    handleUiRpc(UiJob::Kind::GetDevice, line);
    return;
  }
  if (type == "testTone") {
    handleUiRpc(UiJob::Kind::TestTone, line);
    return;
  }
  if (type == "ensureAudio") {
    handleUiRpc(UiJob::Kind::EnsureAudio, line);
    return;
  }
  if (type == "asioControlPanel") {
    handleUiRpc(UiJob::Kind::AsioPanel, line);
    return;
  }
  if (type == "getLatency") {
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = gActiveSlot;
    int lat = 0;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      if (auto* s = findSlotUnlocked(slotId)) lat = s->latencySamples();
    }
    replyOk("\"latencySamples\":" + std::to_string(lat) +
            ",\"graphDelaySamples\":" +
            std::to_string(gRtMaxDelay[gRtBuf.load(std::memory_order_acquire)]));
    return;
  }
  if (type == "focusEditor" || type == "crashReport") {
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

#ifdef _WIN32
static LONG WINAPI jaswaveCrashFilter(EXCEPTION_POINTERS* info) {
  if (!info || !info->ExceptionRecord) return EXCEPTION_CONTINUE_SEARCH;
  HMODULE mod = nullptr;
  GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                     reinterpret_cast<LPCSTR>(info->ExceptionRecord->ExceptionAddress), &mod);
  char name[MAX_PATH]{};
  if (mod) GetModuleFileNameA(mod, name, MAX_PATH);
  std::fprintf(stderr, "[jaswave-plugin-host] CRASH code=0x%08lX addr=%p module=%s\n",
               static_cast<unsigned long>(info->ExceptionRecord->ExceptionCode),
               info->ExceptionRecord->ExceptionAddress, name[0] ? name : "?");
  std::fflush(stderr);
  return EXCEPTION_CONTINUE_SEARCH;
}
#endif

int main(int argc, char** argv) {
  (void)argc;
  (void)argv;
#ifdef _WIN32
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  SetUnhandledExceptionFilter(jaswaveCrashFilter);
  OleInitialize(nullptr);
#else
  setvbuf(stdout, nullptr, _IOLBF, 0);
#endif
  std::cerr << "[jaswave-plugin-host] ready"
#if defined(JASWAVE_HAS_VST3_SDK)
               " (VST3 audio+editor, same instance, selectable device)"
#else
               " (discover-only)"
#endif
            << "\n";

#ifdef _WIN32
#if defined(JASWAVE_HAS_VST3_SDK)
  gMainThreadId = GetCurrentThreadId();
  jaswave_audio_set_renderer(renderMix);
  {
    std::string mixErr;
    if (!jaswave_mix_bus_start(gMixPipeName, mixErr)) {
      std::cerr << "[jaswave-plugin-host] mix bus: " << mixErr << "\n";
    } else {
      std::cerr << "[jaswave-plugin-host] mix pipe " << gMixPipeName << "\n";
    }
  }
  MSG pumpInit{};
  PeekMessageW(&pumpInit, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
#endif
#endif

  std::atomic<bool> running{true};
  std::thread stdinThread([&] {
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
#endif
  });

#ifdef _WIN32
  MSG msg;
  while (running) {
#if defined(JASWAVE_HAS_VST3_SDK)
    drainUiQueue();
#endif
    const BOOL gm = GetMessageW(&msg, nullptr, 0, 0);
    if (gm <= 0) {
      running = false;
      break;
    }
    if (msg.message != WM_JASWAVE_JOB) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
#if defined(JASWAVE_HAS_VST3_SDK)
    drainUiQueue();
#endif
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
  jaswave_mix_bus_stop();
#endif
#ifdef _WIN32
  OleUninitialize();
#endif
  return 0;
}
