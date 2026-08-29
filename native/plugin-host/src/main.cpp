/**
 * JasWave Plugin Host â€” discover + VST3 load/MIDI/audio + editor embed (ADR-0011).
 */

#include <algorithm>
#include <atomic>
#include <cctype>
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
#include "hosted_slot.h"
#include "audio_output.h"
#include "mix_bus.h"
#include "midi_winmm.h"
#include "transport_clock.h"
#include "native_metronome.h"
#include "clip_player.h"
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

/** Float JSON-safe (evita coma decimal de locale que rompe el parse en el renderer). */
static void appendJsonFloat(std::ostringstream& js, float v) {
  char buf[32];
  if (!std::isfinite(v)) v = 0.f;
  if (v < 0.f) v = 0.f;
  if (v > 1.f) v = 1.f;
  std::snprintf(buf, sizeof(buf), "%.6f", static_cast<double>(v));
  js << buf;
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

struct DiscoveredPluginFile {
  std::string path;
  std::string format;  // vst3 | vst2
};

static std::string toLowerCopy(std::string s) {
  for (auto& c : s) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  return s;
}

static bool endsWithLower(const std::string& nameLower, const char* ext) {
  const size_t n = std::strlen(ext);
  return nameLower.size() >= n && nameLower.compare(nameLower.size() - n, n, ext) == 0;
}

static bool skipVst2DllName(const std::string& nameLower) {
  static const char* kSkip[] = {"msvcp", "vcruntime", "ucrtbase", "concrt", "vccorlib",
                                "d3dcompiler", "api-ms-", "ext-ms-", "unins", "crashpad",
                                "ffmpeg", "avcodec", "libcrypto", "opengl32", "dxgi."};
  for (auto* p : kSkip) {
    if (nameLower.find(p) != std::string::npos) return true;
  }
  return false;
}

#ifdef _WIN32
static void listPluginsInDir(const std::string& dir, std::vector<DiscoveredPluginFile>& out, int depth = 0) {
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
    const std::string nameLower = toLowerCopy(fd.cFileName);
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (endsWithLower(nameLower, ".vst3")) {
        out.push_back({full, "vst3"});
        continue;
      }
      listPluginsInDir(full, out, depth + 1);
      continue;
    }
    if (endsWithLower(nameLower, ".vst3")) {
      out.push_back({full, "vst3"});
    } else if (endsWithLower(nameLower, ".dll") && !skipVst2DllName(nameLower)) {
      out.push_back({full, "vst2"});
    }
  } while (FindNextFileA(h, &fd));
  FindClose(h);
}
#else
static void listPluginsInDir(const std::string& dir, std::vector<DiscoveredPluginFile>& out, int depth = 0) {
  if (depth > 4) return;
  DIR* d = opendir(dir.c_str());
  if (!d) return;
  while (auto* ent = readdir(d)) {
    if (ent->d_name[0] == '.') continue;
    std::string full = dir + "/" + ent->d_name;
    struct stat st {};
    if (stat(full.c_str(), &st) != 0) continue;
    const std::string nameLower = toLowerCopy(ent->d_name);
    if (S_ISDIR(st.st_mode)) {
      if (endsWithLower(nameLower, ".vst3")) {
        out.push_back({full, "vst3"});
        continue;
      }
      listPluginsInDir(full, out, depth + 1);
      continue;
    }
    if (endsWithLower(nameLower, ".vst3")) out.push_back({full, "vst3"});
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
  std::vector<DiscoveredPluginFile> found;
  listPluginsInDir(path, found);
  std::ostringstream plugins;
  plugins << "[";
  for (size_t i = 0; i < found.size(); ++i) {
    if (i) plugins << ",";
    std::string name = found[i].path;
    auto slash = name.find_last_of("/\\");
    if (slash != std::string::npos) name = name.substr(slash + 1);
    const bool vst2 = found[i].format == "vst2";
    if (vst2 && name.size() > 4) name = name.substr(0, name.size() - 4);
    else if (!vst2 && name.size() > 5) name = name.substr(0, name.size() - 5);
    bool hostable = kAudioReady;
    if (vst2) {
#if defined(JASWAVE_HAS_VST3_SDK)
      hostable = kAudioReady && Vst2Slot::isPe64Dll(found[i].path);
#else
      hostable = false;
#endif
    }
    plugins << "{\"path\":\"" << jsonEscape(found[i].path) << "\",\"name\":\"" << jsonEscape(name)
            << "\",\"format\":\"" << found[i].format << "\",\"hostReady\":"
            << (hostable ? "true" : "false")
            << ",\"editorReady\":" << (hostable ? "true" : "false") << "}";
  }
  plugins << "]";
  replyOk("\"plugins\":" + plugins.str() + ",\"count\":" + std::to_string(found.size()) +
          ",\"editorReady\":" + (kAudioReady ? "true" : "false") +
          ",\"audioReady\":" + (kAudioReady ? "true" : "false"));
}

#if defined(JASWAVE_HAS_VST3_SDK)

static std::mutex gSlotsMutex;
static std::unordered_map<std::string, std::unique_ptr<HostedSlot>> gSlots;
static std::string gActiveSlot;
static std::atomic<HostedSlot*> gLiveMidiSlots[8]{};
static std::atomic<int> gLiveMidiPort[8]{};
static std::atomic<int> gLiveMidiCount{0};
static std::atomic<int> gLiveMidiChannel{-1};

struct LiveMidiPortInit {
  LiveMidiPortInit() {
    for (int i = 0; i < 8; ++i) gLiveMidiPort[i].store(-1, std::memory_order_relaxed);
  }
} gLiveMidiPortInit;

static std::vector<std::string> splitCsv(const std::string& s) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : s) {
    if (c == ',' || c == ' ') {
      if (!cur.empty()) {
        out.push_back(cur);
        cur.clear();
      }
    } else {
      cur.push_back(c);
    }
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

static int parseWinmmPortId(const std::string& id) {
  const char* pfx = "winmm:";
  if (id.size() <= 6) return -1;
  for (int i = 0; i < 6; ++i) {
    const char a = static_cast<char>(std::tolower(static_cast<unsigned char>(id[static_cast<size_t>(i)])));
    if (a != pfx[i]) return -1;
  }
  int n = 0;
  for (size_t i = 6; i < id.size(); ++i) {
    if (id[i] < '0' || id[i] > '9') return -1;
    n = n * 10 + (id[i] - '0');
  }
  return n;
}
static std::atomic<uint64_t> gLiveEatCcLo{0};
static std::atomic<uint64_t> gLiveEatCcHi{0};
static std::atomic<uint64_t> gLiveEatNoteLo{0};
static std::atomic<uint64_t> gLiveEatNoteHi{0};

static void parseEatCsv(const std::string& csv, std::atomic<uint64_t>* lo, std::atomic<uint64_t>* hi) {
  uint64_t l = 0, h = 0;
  int n = 0;
  bool digit = false;
  for (size_t i = 0; i <= csv.size(); ++i) {
    const char c = i < csv.size() ? csv[i] : ',';
    if (c >= '0' && c <= '9') {
      n = n * 10 + (c - '0');
      digit = true;
      continue;
    }
    if (digit && n >= 0 && n < 128) {
      if (n < 64) l |= (1ull << n);
      else h |= (1ull << (n - 64));
    }
    n = 0;
    digit = false;
  }
  lo->store(l, std::memory_order_release);
  hi->store(h, std::memory_order_release);
}

static bool liveEatHas(const std::atomic<uint64_t>* lo, const std::atomic<uint64_t>* hi, int n) {
  if (n < 0 || n > 127) return false;
  const uint64_t bits = (n < 64 ? lo : hi)->load(std::memory_order_acquire);
  const int b = n < 64 ? n : n - 64;
  return (bits & (1ull << b)) != 0;
}
/** Sustain host-side: muchos VST3 ignoran kLegacyMIDICCOutEvent; el pedal debe sostener igual. */
static bool gLiveSustainDown = false;
static uint8_t gLiveKeyDown[128]{};
static uint8_t gLiveLatched[128]{};

static void liveSlotsNoteOn(HostedSlot** slots, int ns, int pitch, float vel) {
  if (pitch < 0 || pitch > 127) return;
  if (gLiveLatched[pitch] || gLiveKeyDown[pitch]) {
    for (int s = 0; s < ns; ++s) slots[s]->noteOff(pitch, 0);
  }
  gLiveKeyDown[pitch] = 1;
  gLiveLatched[pitch] = 0;
  for (int s = 0; s < ns; ++s) slots[s]->noteOn(pitch, vel, 0);
}

static void liveSlotsNoteOff(HostedSlot** slots, int ns, int pitch) {
  if (pitch < 0 || pitch > 127) return;
  gLiveKeyDown[pitch] = 0;
  if (gLiveSustainDown) {
    gLiveLatched[pitch] = 1;
    return;
  }
  for (int s = 0; s < ns; ++s) slots[s]->noteOff(pitch, 0);
}

static void liveSlotsCc(HostedSlot** slots, int ns, int cc, int value) {
  for (int s = 0; s < ns; ++s) slots[s]->midiCc(cc, value, 0);
  if (cc != 64) return;
  const bool down = value >= 64;
  if (down == gLiveSustainDown) return;
  gLiveSustainDown = down;
  if (down) return;
  for (int p = 0; p < 128; ++p) {
    if (!gLiveLatched[p]) continue;
    gLiveLatched[p] = 0;
    if (!gLiveKeyDown[p]) {
      for (int s = 0; s < ns; ++s) slots[s]->noteOff(p, 0);
    }
  }
}

static void applyLiveMidiFromWinmm() {
  JaswaveMidiEvent evs[128];
  int guard = 0;
  while (guard++ < 8) {
    const size_t n = jaswave_midi_drain(evs, 128);
    if (!n) return;
    const int count = gLiveMidiCount.load(std::memory_order_acquire);
    if (count <= 0) continue;
    const int chFilter = gLiveMidiChannel.load(std::memory_order_relaxed);
    for (size_t i = 0; i < n; ++i) {
      const auto& e = evs[i];
      const int hi = e.status & 0xf0;
      const int ch = e.status & 0x0f;
      if (chFilter >= 0 && ch != chFilter) continue;
      const int pitch = static_cast<int>(e.data1);
      if (hi == 0x90 || hi == 0x80) {
        if (liveEatHas(&gLiveEatNoteLo, &gLiveEatNoteHi, pitch)) continue;
      } else if (hi == 0xb0) {
        if (liveEatHas(&gLiveEatCcLo, &gLiveEatCcHi, pitch)) continue;
      }
      HostedSlot* dest[8];
      int nd = 0;
      for (int s = 0; s < count && s < 8; ++s) {
        auto* slot = gLiveMidiSlots[s].load(std::memory_order_acquire);
        if (!slot) continue;
        const int port = gLiveMidiPort[s].load(std::memory_order_relaxed);
        if (port < 0 || port != static_cast<int>(e.port)) continue;
        dest[nd++] = slot;
      }
      if (!nd) continue;
      if (hi == 0x90) {
        if (e.data2 == 0) liveSlotsNoteOff(dest, nd, pitch);
        else liveSlotsNoteOn(dest, nd, pitch, static_cast<float>(e.data2) / 127.f);
      } else if (hi == 0x80) {
        liveSlotsNoteOff(dest, nd, pitch);
      } else if (hi == 0xb0) {
        liveSlotsCc(dest, nd, static_cast<int>(e.data1), static_cast<int>(e.data2));
      }
    }
    if (n < 128) return;
  }
}
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

static HostedSlot* findSlotUnlocked(const std::string& slotId);

/** Graph Reaper en buffers POD (doble) â€” sin alloc en el audio thread. */
static constexpr int kMaxGraphTracks = 64;
static constexpr int kMaxChainSlots = 24;
static constexpr int kSlotIdLen = 96;

struct RtChainSlot {
  HostedSlot* slot{nullptr};
  char slotId[kSlotIdLen]{};
  bool instrument{false};
  bool bypass{false};
};
static constexpr int kMaxSends = 8;
struct RtSend {
  uint16_t destStem{0};
  float amount{0.f};
  bool preFader{false};
};
static constexpr int kMaxSidechains = 4;
struct RtSidechain {
  uint16_t srcStem{0};
  float amount{0.f};
};
struct RtTrackChain {
  uint16_t stemIndex{0};
  float gain{1.f};
  float pan{0.f};
  bool muted{false};
  uint16_t delaySamples{0};
  uint8_t slotCount{0};
  RtChainSlot slots[kMaxChainSlots]{};
  uint8_t sendCount{0};
  RtSend sends[kMaxSends]{};
  uint8_t sidechainCount{0};
  RtSidechain sidechains[kMaxSidechains]{};
};

/** Post-fader por pista (pass 1) + acumulado por stem (sends). */
static float gPostL[kMaxGraphTracks][8192]{};
static float gPostR[kMaxGraphTracks][8192]{};
static float gPreL[kMaxGraphTracks][8192]{};
static float gPreR[kMaxGraphTracks][8192]{};
static float gStemAccL[kMaxGraphTracks][8192]{};
static float gStemAccR[kMaxGraphTracks][8192]{};

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

/** Peaks post-fader (stemIndex 0..63) + master; audio thread escribe, control lee snapshot. */
static std::atomic<float> gMeterStemPeak[kMaxGraphTracks]{};
static std::atomic<float> gMeterSidechainPeak[kMaxGraphTracks]{};
static std::atomic<float> gMeterMasterPeak{0.f};
static constexpr float kMeterDecay = 0.92f;
static char gMeterTrackOrder[kMaxGraphTracks][kSlotIdLen]{};
static uint8_t gMeterTrackOrderN = 0;

static int meterStemForTrackId(const std::string& trackId) {
  for (uint8_t i = 0; i < gMeterTrackOrderN; ++i) {
    if (trackId == gMeterTrackOrder[i]) return static_cast<int>(i);
  }
  return -1;
}

static int meterStemFromSlotId(const std::string& slotId) {
  const size_t colon = slotId.find(':');
  if (colon == std::string::npos || colon == 0) return -1;
  return meterStemForTrackId(slotId.substr(0, colon));
}

static std::mutex gOfflineMu;
static std::vector<float> gOfflinePcm;
static std::string gOfflineOutPath;
static uint32_t gOfflineBlock{512};
static uint32_t gOfflineTotal{0};
static uint32_t gOfflineDone{0};
static std::atomic<bool> gOfflineCancel{false};
static bool gOfflineRunning{false};
static uint16_t gOfflineBits{16};

static int b64Val(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

/** Base64 → bytes (estándar, ignora '=' y saltos). */
static bool decodeBase64(const std::string& in, std::vector<uint8_t>& out) {
  out.clear();
  out.reserve((in.size() / 4) * 3 + 3);
  int val = 0;
  int bits = 0;
  for (char c : in) {
    if (c == '=' || c == '\n' || c == '\r') continue;
    const int d = b64Val(c);
    if (d < 0) return false;
    val = (val << 6) | d;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<uint8_t>((val >> bits) & 0xFF));
    }
  }
  return true;
}

static std::string encodeBase64(const uint8_t* data, size_t n) {
  static const char* kTbl =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((n + 2) / 3) * 4);
  for (size_t i = 0; i < n; i += 3) {
    const uint32_t b0 = data[i];
    const uint32_t b1 = i + 1 < n ? data[i + 1] : 0;
    const uint32_t b2 = i + 2 < n ? data[i + 2] : 0;
    const uint32_t triple = (b0 << 16) | (b1 << 8) | b2;
    out.push_back(kTbl[(triple >> 18) & 63]);
    out.push_back(kTbl[(triple >> 12) & 63]);
    out.push_back(i + 1 < n ? kTbl[(triple >> 6) & 63] : '=');
    out.push_back(i + 2 < n ? kTbl[triple & 63] : '=');
  }
  return out;
}

static float softLimitSample(float x) {
  /* Transparente bajo ~0.95; solo suaviza overs (antes: ×0.72+tanh dejaba el DAW muy bajo vs YouTube). */
  if (x > 0.95f) return 0.95f + 0.05f * std::tanh((x - 0.95f) * 8.f);
  if (x < -0.95f) return -0.95f - 0.05f * std::tanh((-0.95f - x) * 8.f);
  return x;
}

/** Sin atenuación post-instrumento (antes 0.42 / 0.85 dejaban canales flojos). */
static constexpr float kInstrumentTrim = 1.f;

/** Makeup por canal (~+6 dB). 4× amplificaba ruido idle de VSTs → master pegado / «feedback». */
static constexpr float kChannelMakeup = 2.f;

static void applyInstrumentTrim(float* l, float* r, int frames) {
  if (kInstrumentTrim == 1.f) return;
  for (int i = 0; i < frames; ++i) {
    l[i] *= kInstrumentTrim;
    r[i] *= kInstrumentTrim;
  }
}

static void meterUpdatePeak(std::atomic<float>& slot, float blockPeak) {
  float cur = slot.load(std::memory_order_relaxed);
  const float next = blockPeak > cur ? blockPeak : cur * kMeterDecay;
  slot.store(next > 1.f ? 1.f : next, std::memory_order_relaxed);
}

static float blockPeakAbs(const float* l, const float* r, int frames) {
  float p = 0.f;
  for (int i = 0; i < frames; ++i) {
    const float a = std::fabs(l[i]);
    const float b = std::fabs(r[i]);
    if (a > p) p = a;
    if (b > p) p = b;
  }
  return p > 1.f ? 1.f : p;
}

struct TrackChainSlot {
  std::string slotId;
  bool instrument{false};
  bool bypass{false};
};
struct TrackSend {
  uint16_t destStem{0};
  float amount{0.f};
  bool preFader{false};
};
struct TrackSidechain {
  uint16_t srcStem{0};
  float amount{0.f};
};
struct TrackChain {
  uint16_t stemIndex{0};
  float gain{1.f};
  float pan{0.f};
  bool muted{false};
  std::vector<TrackChainSlot> slots;
  std::vector<TrackSend> sends;
  std::vector<TrackSidechain> sidechains;
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
    out.sendCount = 0;
    for (const auto& sn : tr.sends) {
      if (out.sendCount >= kMaxSends) break;
      if (sn.amount <= 0.f || sn.destStem >= kMaxGraphTracks) continue;
      RtSend& rs = out.sends[out.sendCount++];
      rs.destStem = sn.destStem;
      rs.amount = sn.amount;
      rs.preFader = sn.preFader;
    }
    out.sidechainCount = 0;
    for (const auto& sc : tr.sidechains) {
      if (out.sidechainCount >= kMaxSidechains) break;
      if (sc.amount <= 0.f || sc.srcStem >= kMaxGraphTracks) continue;
      RtSidechain& rs = out.sidechains[out.sidechainCount++];
      rs.srcStem = sc.srcStem;
      rs.amount = sc.amount;
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
  // Vaciar rings Chromium/legacy: pull_stem ya no alimenta el graph (stems = clip nativo + VST).
  jaswave_mix_bus_reset();
}

static void clearSlotPointersInGraph(HostedSlot* doomed) {
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
  const float g = std::max(0.f, std::min(4.f, gain * kChannelMakeup));
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

static double currentSampleRate();
static uint32_t currentBlockSize();

static void renderMix(float* interleaved, uint32_t frameCount) {
  if (!gOfflineRunning) applyLiveMidiFromWinmm();
  const int frames = static_cast<int>(std::min<uint32_t>(frameCount, 8192));
  if (frames <= 0) return;
  jaswave::transport_clock_set_sample_rate(currentSampleRate());
  jaswave_mix_bus_begin_block(static_cast<uint32_t>(frames));
  std::fill(gMixL, gMixL + frames, 0.f);
  std::fill(gMixR, gMixR + frames, 0.f);

  const bool useGraph = gGraphActive.load(std::memory_order_acquire);
  const int idx = gRtBuf.load(std::memory_order_acquire);

  if (useGraph) {
    const uint8_t trackN = gRtTrackCount[idx];
    for (uint8_t t = 0; t < kMaxGraphTracks; ++t) {
      std::fill(gPostL[t], gPostL[t] + frames, 0.f);
      std::fill(gPostR[t], gPostR[t] + frames, 0.f);
      std::fill(gStemAccL[t], gStemAccL[t] + frames, 0.f);
      std::fill(gStemAccR[t], gStemAccR[t] + frames, 0.f);
    }
    for (uint8_t t = 0; t < trackN && t < kMaxGraphTracks; ++t) {
      const RtTrackChain& tr = gRtTracks[idx][t];
      // Live: solo clip_player (no pull_stem del pipe Chromium → evita mezcla fantasma).
      // Offline bounce: sumar stems dry empujados vía push_stem (JWST) + clips nativos.
      std::memset(gStemInterleaved, 0, static_cast<size_t>(frames) * 2 * sizeof(float));
      jaswave::clip_render_stem(tr.stemIndex, gStemInterleaved, static_cast<uint32_t>(frames));
      if (gOfflineRunning) {
        float pulled[8192 * 2];
        const uint32_t n = static_cast<uint32_t>(frames);
        jaswave_mix_bus_pull_stem(tr.stemIndex, pulled, n);
        for (uint32_t i = 0; i < n; ++i) {
          gStemInterleaved[i * 2] += pulled[i * 2];
          gStemInterleaved[i * 2 + 1] += pulled[i * 2 + 1];
        }
      }
      for (int i = 0; i < frames; ++i) {
        gChainL[i] = gStemInterleaved[i * 2];
        gChainR[i] = gStemInterleaved[i * 2 + 1];
      }
      for (uint8_t s = 0; s < tr.slotCount; ++s) {
        const RtChainSlot& cs = tr.slots[s];
        HostedSlot* slot = cs.slot;
        if (!slot || !slot->isPrepared()) continue;
        if (cs.bypass) continue;
        if (cs.instrument) {
          slot->process(nullptr, nullptr, gFxL, gFxR, frames);
          applyInstrumentTrim(gFxL, gFxR, frames);
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
      std::memcpy(gPreL[t], gChainL, static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(gPreR[t], gChainR, static_cast<size_t>(frames) * sizeof(float));
      applyTrackGainPan(gChainL, gChainR, frames, tr.gain, tr.pan, tr.muted);
      applyPdc(gChainL, gChainR, frames, gPdcL[t], gPdcR[t], gPdcW[t],
               static_cast<int>(tr.delaySamples));
      {
        const uint16_t si = tr.stemIndex;
        if (si < kMaxGraphTracks) {
          meterUpdatePeak(gMeterStemPeak[si], blockPeakAbs(gChainL, gChainR, frames));
        }
      }
      std::memcpy(gPostL[t], gChainL, static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(gPostR[t], gChainR, static_cast<size_t>(frames) * sizeof(float));
      if (tr.stemIndex < kMaxGraphTracks) {
        for (int i = 0; i < frames; ++i) {
          gStemAccL[tr.stemIndex][i] += gChainL[i];
          gStemAccR[tr.stemIndex][i] += gChainR[i];
        }
      }
    }
    // Sidechain metering (I/O host confirmado para harness)
    {
      uint16_t stemToChain[kMaxGraphTracks];
      for (uint8_t i = 0; i < kMaxGraphTracks; ++i) stemToChain[i] = 0xFFFF;
      for (uint8_t ti = 0; ti < trackN && ti < kMaxGraphTracks; ++ti) {
        stemToChain[gRtTracks[idx][ti].stemIndex] = ti;
      }
      for (uint8_t t = 0; t < trackN && t < kMaxGraphTracks; ++t) {
        const RtTrackChain& tr = gRtTracks[idx][t];
        if (tr.sidechainCount == 0) continue;
        float scPeak = 0.f;
        for (uint8_t sc = 0; sc < tr.sidechainCount; ++sc) {
          const RtSidechain& side = tr.sidechains[sc];
          const uint16_t srcT =
              side.srcStem < kMaxGraphTracks ? stemToChain[side.srcStem] : 0xFFFF;
          if (srcT == 0xFFFF || srcT >= trackN) continue;
          for (int i = 0; i < frames; ++i) {
            const float l = gPostL[srcT][i] * side.amount;
            const float r = gPostR[srcT][i] * side.amount;
            const float p = std::max(std::fabs(l), std::fabs(r));
            if (p > scPeak) scPeak = p;
          }
        }
        if (tr.stemIndex < kMaxGraphTracks && scPeak > 0.f) {
          meterUpdatePeak(gMeterSidechainPeak[tr.stemIndex], scPeak);
        }
      }
    }
    // Pass 2: sends sample-accurate (origen → stem destino)
    for (uint8_t t = 0; t < trackN && t < kMaxGraphTracks; ++t) {
      const RtTrackChain& tr = gRtTracks[idx][t];
      for (uint8_t s = 0; s < tr.sendCount; ++s) {
        const RtSend& sn = tr.sends[s];
        if (sn.amount <= 0.f || sn.destStem >= kMaxGraphTracks) continue;
        for (int i = 0; i < frames; ++i) {
          const float sl = sn.preFader ? gPreL[t][i] : gPostL[t][i];
          const float sr = sn.preFader ? gPreR[t][i] : gPostR[t][i];
          gStemAccL[sn.destStem][i] += sl * sn.amount;
          gStemAccR[sn.destStem][i] += sr * sn.amount;
        }
      }
    }
    for (uint8_t stem = 0; stem < trackN && stem < kMaxGraphTracks; ++stem) {
      for (int i = 0; i < frames; ++i) {
        gMixL[i] += gStemAccL[stem][i];
        gMixR[i] += gStemAccR[stem][i];
      }
    }
    const uint8_t masterN = gRtMasterCount[idx];
    for (uint8_t s = 0; s < masterN; ++s) {
      const RtChainSlot& cs = gRtMaster[idx][s];
      HostedSlot* slot = cs.slot;
      if (!slot || !slot->isPrepared() || cs.bypass) continue;
      slot->process(gMixL, gMixR, gFxL, gFxR, frames);
      std::memcpy(gMixL, gFxL, static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(gMixR, gFxR, static_cast<size_t>(frames) * sizeof(float));
    }
  } else {
    // Legacy: suma paralela de todos los slots
    HostedSlot* snapshot[48]{};
    char snapshotSlotId[48][kSlotIdLen]{};
    int n = 0;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      for (auto& [id, slot] : gSlots) {
        if (!slot || !slot->isPrepared() || n >= 48) continue;
        copySlotId(snapshotSlotId[n], id);
        snapshot[n++] = slot.get();
      }
    }
    for (int s = 0; s < n; ++s) {
      snapshot[s]->process(nullptr, nullptr, gTmpL, gTmpR, frames);
      applyInstrumentTrim(gTmpL, gTmpR, frames);
      snapshot[s]->applyMix(gTmpL, gTmpR, frames);
      {
        const int stem = meterStemFromSlotId(snapshotSlotId[s]);
        if (stem >= 0 && stem < kMaxGraphTracks) {
          meterUpdatePeak(gMeterStemPeak[stem],
                          blockPeakAbs(gTmpL, gTmpR, frames));
        }
      }
      for (int i = 0; i < frames; ++i) {
        gMixL[i] += gTmpL[i];
        gMixR[i] += gTmpR[i];
      }
    }
    jaswave::clip_render_mix(gMixL, gMixR, static_cast<uint32_t>(frames));
  }

  const float masterG = (gMasterMuted.load(std::memory_order_relaxed)
                            ? 0.f
                            : gMasterGain.load(std::memory_order_relaxed)) * 1.35f;
  for (int i = 0; i < frames; ++i) {
    interleaved[i * 2 + 0] = softLimitSample(gMixL[i] * masterG);
    interleaved[i * 2 + 1] = softLimitSample(gMixR[i] * masterG);
  }
  // Legacy Chromium/Soft Pad bus: skip when Reaper graph owns all track audio.
  if (!useGraph) {
    std::memset(gStemInterleaved, 0, static_cast<size_t>(frames) * 2 * sizeof(float));
    jaswave_mix_bus_add(gStemInterleaved, static_cast<uint32_t>(frames));
    for (int i = 0; i < frames; ++i) {
      gTmpL[i] = gStemInterleaved[i * 2];
      gTmpR[i] = gStemInterleaved[i * 2 + 1];
    }
    applyPdc(gTmpL, gTmpR, frames, gPdcDawL, gPdcDawR, gPdcDawW, 0);
    for (int i = 0; i < frames; ++i) {
      interleaved[i * 2 + 0] = softLimitSample(interleaved[i * 2 + 0] + gTmpL[i]);
      interleaved[i * 2 + 1] = softLimitSample(interleaved[i * 2 + 1] + gTmpR[i]);
    }
  }
  jaswave::metronome_render(interleaved, static_cast<uint32_t>(frames));
  {
    float mp = 0.f;
    for (int i = 0; i < frames; ++i) {
      const float a = std::fabs(interleaved[i * 2]);
      const float b = std::fabs(interleaved[i * 2 + 1]);
      if (a > mp) mp = a;
      if (b > mp) mp = b;
    }
    meterUpdatePeak(gMeterMasterPeak, mp > 1.f ? 1.f : mp);
  }
  jaswave::transport_clock_advance(static_cast<uint32_t>(frames));
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

static HostedSlot* findSlotUnlocked(const std::string& slotId) {
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
  if (!cfg.bufferSize) cfg.bufferSize = 256;
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
  cfg.bufferSize = static_cast<uint32_t>(getNumberField(json, "bufferSize", 256));
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
  std::vector<HostedSlot*> toSuspend;
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
  std::vector<HostedSlot*> slots;
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
  const std::string expanded = expandEnvPath(path);
  auto slot = HostedSlot::createForPath(expanded);
  slot->setSlotId(slotId);
  if (!ensureAudioDevice(err)) return false;
  if (!slot->load(expanded, err)) return false;
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

    HostedSlot* slot = nullptr;
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
    HostedSlot* slot = nullptr;
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
    std::unique_ptr<HostedSlot> doomed;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      auto it = gSlots.find(slotId);
      if (it != gSlots.end()) {
        doomed = std::move(it->second);
        gSlots.erase(it);
      }
      if (gActiveSlot == slotId) gActiveSlot.clear();
      if (doomed) {
        clearSlotPointersInGraph(doomed.get());
        int liveN = gLiveMidiCount.load(std::memory_order_acquire);
        int w = 0;
        for (int i = 0; i < liveN && i < 8; ++i) {
          auto* s = gLiveMidiSlots[i].load(std::memory_order_acquire);
          if (s && s != doomed.get()) {
            gLiveMidiSlots[w++].store(s, std::memory_order_release);
          }
        }
        for (int i = w; i < 8; ++i) gLiveMidiSlots[i].store(nullptr, std::memory_order_release);
        gLiveMidiCount.store(w, std::memory_order_release);
      }
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

static void enqueueUiAsync(UiJob::Kind kind, const std::string& json, bool replyWhenDone = false) {
  auto job = std::make_shared<UiJob>();
  job->kind = kind;
  job->json = json;
  job->replyWhenDone = replyWhenDone;
  {
    std::lock_guard<std::mutex> lock(gUiQueueMu);
    gUiQueue.push_back(job);
  }
#ifdef _WIN32
  PostThreadMessageW(gMainThreadId, WM_JASWAVE_JOB, 0, 0);
#endif
  // NO bloquear stdin: noteOn debe seguir mientras load corre en el hilo UI.
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
  // Async: esperar aquí congela noteOn/getTransportClock → silencio a los ~3–4 s.
  enqueueUiAsync(UiJob::Kind::Load, json, true);
}

static void handleUnload(const std::string& json) {
  enqueueUiAsync(UiJob::Kind::Unload, json, true);
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
  const int delay = std::max(0, static_cast<int>(getNumberField(json, "delaySamples", 0)));
  const int length = std::max(0, static_cast<int>(getNumberField(json, "lengthSamples", 0)));
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
    // Preview / teclado: muchos VST3 ignoran MIDI si !kPlaying. No arrancar el
    // transport clock del DAW — solo la bandera del slot.
    slot->setPlaying(true);
    slot->noteOn(pitch, vel > 1.f ? vel / 127.f : vel, delay, length);
  } else {
    slot->noteOff(pitch, delay);
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
  if (type == "listMidiDevices") {
    std::string devices = "[]";
#ifdef _WIN32
    jaswave_midi_list_json(devices);
#endif
    replyOk("\"devices\":" + devices);
    return;
  }
  if (type == "openMidiInputs") {
#ifdef _WIN32
    jaswave_midi_open_all();
#endif
    replyOk();
    return;
  }
  if (type == "setLiveMidiTargets") {
#if defined(JASWAVE_HAS_VST3_SDK)
    const std::string ids = getStringField(line, "slotIds");
    const std::vector<std::string> slotList = splitCsv(ids);
    const std::vector<std::string> deviceList = splitCsv(getStringField(line, "deviceIds"));
    const int ch = static_cast<int>(getNumberField(line, "channel", -1));
    gLiveMidiChannel.store(ch < 0 ? -1 : ch, std::memory_order_relaxed);
    parseEatCsv(getStringField(line, "eatCcs"), &gLiveEatCcLo, &gLiveEatCcHi);
    parseEatCsv(getStringField(line, "eatNotes"), &gLiveEatNoteLo, &gLiveEatNoteHi);
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    int n = 0;
    for (size_t i = 0; i < slotList.size() && n < 8; ++i) {
      if (auto* s = findSlotUnlocked(slotList[i])) {
        gLiveMidiSlots[n].store(s, std::memory_order_release);
        const int port = i < deviceList.size() ? parseWinmmPortId(deviceList[i]) : -1;
        gLiveMidiPort[n].store(port, std::memory_order_release);
        ++n;
      }
    }
    for (int i = n; i < 8; ++i) {
      gLiveMidiSlots[i].store(nullptr, std::memory_order_release);
      gLiveMidiPort[i].store(-1, std::memory_order_release);
    }
    gLiveMidiCount.store(n, std::memory_order_release);
#endif
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
      gMasterGain.store(std::max(0.f, std::min(4.f, g)), std::memory_order_relaxed);
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
        // optional :gain:pan:muted after index â€” "0:0.8:0:0|slots"
        size_t colon = seg.find(':');
        size_t firstBar = bar;
        if (colon != std::string::npos && colon < firstBar) {
          // idx only before |
        }
        // Extended: idx~gain~pan~muted|slots#dest:amt+dest2:amt2
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
        std::string afterBar = seg.substr(firstBar + 1);
        size_t hash = afterBar.find('#');
        size_t dollar = afterBar.find('$');
        size_t slotsEnd = hash;
        if (dollar != std::string::npos && (slotsEnd == std::string::npos || dollar < slotsEnd)) {
          slotsEnd = dollar;
        }
        std::string slotsPart =
            slotsEnd == std::string::npos ? afterBar : afterBar.substr(0, slotsEnd);
        std::string sendsPart = "";
        if (hash != std::string::npos) {
          size_t sendsEnd = dollar == std::string::npos ? afterBar.size() : dollar;
          sendsPart = afterBar.substr(hash + 1, sendsEnd - hash - 1);
        }
        std::string sidePart = dollar == std::string::npos ? "" : afterBar.substr(dollar + 1);
        parseSlotList(slotsPart, tc.slots);
        size_t sp = 0;
        while (sp < sendsPart.size()) {
          size_t plus = sendsPart.find('+', sp);
          std::string tok =
              sendsPart.substr(sp, plus == std::string::npos ? std::string::npos : plus - sp);
          size_t colonS = tok.find(':');
          if (colonS != std::string::npos) {
            TrackSend sn;
            try {
              sn.destStem = static_cast<uint16_t>(std::stoi(tok.substr(0, colonS)));
              size_t colon2 = tok.find(':', colonS + 1);
              if (colon2 != std::string::npos) {
                sn.amount = std::stof(tok.substr(colonS + 1, colon2 - colonS - 1));
                sn.preFader = tok.substr(colon2 + 1) == "p";
              } else {
                sn.amount = std::stof(tok.substr(colonS + 1));
              }
              if (sn.amount > 0.f && sn.destStem < kMaxGraphTracks) tc.sends.push_back(sn);
            } catch (...) {
            }
          }
          if (plus == std::string::npos) break;
          sp = plus + 1;
        }
        size_t scp = 0;
        while (scp < sidePart.size()) {
          size_t plus = sidePart.find('+', scp);
          std::string tok =
              sidePart.substr(scp, plus == std::string::npos ? std::string::npos : plus - scp);
          size_t colonS = tok.find(':');
          if (colonS != std::string::npos) {
            TrackSidechain sc;
            try {
              sc.srcStem = static_cast<uint16_t>(std::stoi(tok.substr(0, colonS)));
              sc.amount = std::stof(tok.substr(colonS + 1));
              if (sc.amount > 0.f && sc.srcStem < kMaxGraphTracks) tc.sidechains.push_back(sc);
            } catch (...) {
            }
          }
          if (plus == std::string::npos) break;
          scp = plus + 1;
        }
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
    return; // sin reply â€” MIDI fire-and-forget
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
    if (slot) slot->midiCc(cc, value, std::max(0, static_cast<int>(getNumberField(line, "delaySamples", 0))));
    return;
  }
  if (type == "setTransport") {
    const bool playing = getBoolField(line, "playing", false);
    const double tempo = getNumberField(line, "tempo", 0.0);
    const double ppq = getNumberField(line, "ppqPos", -1.0);
    jaswave::transport_clock_set_sample_rate(currentSampleRate());
    if (tempo > 0.0) jaswave::transport_clock_set_tempo(tempo);
    if (ppq >= 0.0) jaswave::transport_clock_seek_ppq(ppq);
    jaswave::transport_clock_set_playing(playing);
    if (!playing) jaswave::clip_stop_all_scheduled();
    const double hostTempo = jaswave::transport_clock_tempo();
    const double hostPpq = jaswave::transport_clock_ppq();
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    for (auto& [id, slot] : gSlots) {
      if (!slot) continue;
      slot->setTransport(playing, hostTempo, hostPpq);
      // Panic inmediato al pausar/parar: corta colas MIDI + voces (evita notas pegadas).
      if (!playing) slot->allNotesOff();
    }
    return;
  }
  if (type == "metronome.set") {
    const bool enabled = getBoolField(line, "enabled", false);
    const double bpm = getNumberField(line, "bpm", 0.0);
    const int beats = static_cast<int>(getNumberField(line, "beatsPerBar", 0));
    const float volume = static_cast<float>(getNumberField(line, "volume", -1.0));
    jaswave::transport_clock_set_sample_rate(currentSampleRate());
    if (bpm > 0.0) jaswave::transport_clock_set_tempo(bpm);
    if (beats > 0) jaswave::transport_clock_set_beats_per_bar(beats);
    if (volume >= 0.f) jaswave::metronome_set_volume(volume);
    jaswave::metronome_set_enabled(enabled);
    return;
  }
  if (type == "getTransportClock") {
    const auto snap = jaswave::transport_clock_snapshot();
    std::ostringstream js;
    js << "\"playing\":" << (snap.playing ? "true" : "false")
       << ",\"sampleRate\":" << snap.sampleRate
       << ",\"samples\":" << snap.samples
       << ",\"tempo\":" << snap.tempoBpm
       << ",\"beatsPerBar\":" << snap.beatsPerBar
       << ",\"ppqPos\":" << snap.ppqPos
       << ",\"timelineSec\":" << snap.timelineSec
       << ",\"metronome\":" << (jaswave::metronome_enabled() ? "true" : "false");
    replyOk(js.str());
    return;
  }
  if (type == "clip.load") {
    const std::string clipId = getStringField(line, "clipId");
    const std::string path = getStringField(line, "path");
    std::string err;
    bool ok = false;
    if (!path.empty()) {
      ok = jaswave::clip_load_path(clipId, path, err);
    } else {
      // pcmBase64: interleaved f32 LE
      const std::string b64 = getStringField(line, "pcmBase64");
      const uint32_t frames = static_cast<uint32_t>(getNumberField(line, "frames", 0));
      const uint32_t channels = static_cast<uint32_t>(getNumberField(line, "channels", 2));
      const uint32_t sr = static_cast<uint32_t>(getNumberField(line, "sampleRate", currentSampleRate()));
      if (b64.empty() || frames == 0) {
        replyFail("BadRequest", "clip.load requiere path o pcmBase64+frames");
        return;
      }
      // Decode base64 inline (minimal)
      auto b64val = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;
      };
      std::vector<uint8_t> bytes;
      bytes.reserve(b64.size() * 3 / 4);
      int val = 0, valb = -8;
      for (unsigned char c : b64) {
        if (c == '=') break;
        const int d = b64val(static_cast<char>(c));
        if (d < 0) continue;
        val = (val << 6) + d;
        valb += 6;
        if (valb >= 0) {
          bytes.push_back(static_cast<uint8_t>((val >> valb) & 0xFF));
          valb -= 8;
        }
      }
      const size_t need = static_cast<size_t>(frames) * std::max(1u, channels) * sizeof(float);
      if (bytes.size() < need) {
        replyFail("BadRequest", "pcmBase64 corto");
        return;
      }
      ok = jaswave::clip_load_pcm(clipId, reinterpret_cast<const float*>(bytes.data()), frames,
                                  channels, sr, err);
    }
    if (!ok) {
      replyFail("ClipLoadFailed", err.empty() ? "clip.load falló" : err);
      return;
    }
    replyOk("\"clipId\":\"" + jsonEscape(clipId) + "\"");
    return;
  }
  if (type == "clip.schedule") {
    const std::string clipId = getStringField(line, "clipId");
    const uint16_t trackIndex = static_cast<uint16_t>(getNumberField(line, "trackIndex", 0));
    const int64_t startSample = static_cast<int64_t>(getNumberField(line, "startSample", 0));
    const int64_t durationSamples = static_cast<int64_t>(getNumberField(line, "durationSamples", 0));
    const int64_t sourceOffset = static_cast<int64_t>(getNumberField(line, "sourceOffsetSamples", 0));
    const float gain = static_cast<float>(getNumberField(line, "gain", 1.0));
    const float pan = static_cast<float>(getNumberField(line, "pan", 0.0));
    jaswave::clip_schedule(clipId, trackIndex, startSample, durationSamples, sourceOffset, gain, pan);
    return;
  }
  if (type == "clip.stopAll") {
    jaswave::clip_stop_all_scheduled();
    return;
  }
  if (type == "clip.unload") {
    const std::string clipId = getStringField(line, "clipId");
    if (clipId.empty()) jaswave::clip_unload_all();
    else jaswave::clip_unload(clipId);
    replyOk();
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
  if (type == "getPluginState") {
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = gActiveSlot;
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId);
    if (!slot) {
      replyFail("PluginNotFound", "slot no cargado: " + slotId);
      return;
    }
    std::vector<uint8_t> bytes;
    std::string err;
    if (!slot->getStateChunk(bytes, err)) {
      replyFail("NoChunk", err);
      return;
    }
    replyOk("\"slotId\":\"" + jsonEscape(slotId) + "\",\"stateBase64\":\"" +
            jsonEscape(encodeBase64(bytes.data(), bytes.size())) + "\"");
    return;
  }
  if (type == "setPluginState") {
    std::string slotId = getStringField(line, "slotId");
    if (slotId.empty()) slotId = gActiveSlot;
    const std::string b64 = getStringField(line, "stateBase64");
    std::vector<uint8_t> bytes;
    if (b64.empty() || !decodeBase64(b64, bytes) || bytes.empty()) {
      replyFail("InvalidArgs", "stateBase64 inválido");
      return;
    }
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId);
    if (!slot) {
      replyFail("PluginNotFound", "slot no cargado: " + slotId);
      return;
    }
    std::string err;
    if (!slot->setStateChunk(bytes.data(), bytes.size(), err)) {
      replyFail("SetChunkFailed", err);
      return;
    }
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
  if (type == "getMixBufferStats") {
    if (getBoolField(line, "reset", false)) jaswave_mix_bus_reset_stats();
    JaswaveMixBusStats st{};
    jaswave_mix_bus_get_stats(st);
    std::ostringstream js;
    js << "\"mix\":{"
       << "\"running\":" << (st.running ? "true" : "false")
       << ",\"capacity\":" << st.capacity
       << ",\"targetFill\":" << st.targetFill
       << ",\"highFill\":" << st.highFill
       << ",\"dawFill\":" << st.dawFill
       << ",\"minLiveFill\":" << st.minLiveFill
       << ",\"maxLiveFill\":" << st.maxLiveFill
       << ",\"liveTracks\":" << st.liveTracks
       << ",\"pullBudget\":" << st.pullBudget
       << ",\"inRate\":" << st.inRate
       << ",\"outRate\":" << st.outRate
       << ",\"underrunBlocks\":" << st.underrunBlocks
       << ",\"overflowPushes\":" << st.overflowPushes
       << ",\"highFillDropFrames\":" << st.highFillDropFrames
       << "}";
    replyOk(js.str());
    return;
  }
  if (type == "setMeterTrackOrder") {
    const std::string ids = getStringField(line, "ids");
    gMeterTrackOrderN = 0;
    size_t p = 0;
    while (p < ids.size() && gMeterTrackOrderN < kMaxGraphTracks) {
      size_t comma = ids.find(',', p);
      std::string tid = ids.substr(p, comma == std::string::npos ? std::string::npos : comma - p);
      if (!tid.empty()) {
        copySlotId(gMeterTrackOrder[gMeterTrackOrderN], tid);
        ++gMeterTrackOrderN;
      }
      if (comma == std::string::npos) break;
      p = comma + 1;
    }
    return;
  }
  if (type == "getMixMeters") {
    std::ostringstream js;
    js << "\"masterPeak\":";
    appendJsonFloat(js, gMeterMasterPeak.load(std::memory_order_relaxed));
    js << ",\"tracks\":[";
    const int idx = gRtBuf.load(std::memory_order_acquire);
    const uint8_t trackN = gRtTrackCount[idx];
    bool first = true;
    if (trackN > 0) {
      for (uint8_t t = 0; t < trackN && t < kMaxGraphTracks; ++t) {
        uint16_t si = gRtTracks[idx][t].stemIndex;
        if (si >= kMaxGraphTracks) si = t;
        if (!first) js << ',';
        first = false;
        js << "{\"index\":" << si << ",\"peak\":";
        appendJsonFloat(js, gMeterStemPeak[si].load(std::memory_order_relaxed));
        js << ",\"sidechainPeak\":";
        appendJsonFloat(js, gMeterSidechainPeak[si].load(std::memory_order_relaxed));
        js << '}';
      }
    } else {
      // Graph aún no publicado: devolver picos por índice lineal (layout Web Audio).
      for (uint16_t si = 0; si < 16; ++si) {
        if (!first) js << ',';
        first = false;
        js << "{\"index\":" << si << ",\"peak\":";
        appendJsonFloat(js, gMeterStemPeak[si].load(std::memory_order_relaxed));
        js << ",\"sidechainPeak\":";
        appendJsonFloat(js, gMeterSidechainPeak[si].load(std::memory_order_relaxed));
        js << '}';
      }
    }
    js << ']';
    replyOk(js.str());
    return;
  }
  if (type == "renderOfflineStart") {
    std::lock_guard<std::mutex> lock(gOfflineMu);
    if (gOfflineRunning) {
      replyFail("RenderBusy", "Ya hay un bounce en curso");
      return;
    }
    gOfflineOutPath = getStringField(line, "outPath");
    if (gOfflineOutPath.empty()) {
      replyFail("InvalidArgs", "outPath requerido");
      return;
    }
    gOfflineTotal = static_cast<uint32_t>(std::max(0.0, getNumberField(line, "totalFrames", 0)));
    gOfflineBlock = static_cast<uint32_t>(std::max(64.0, getNumberField(line, "blockSize", 512)));
    gOfflineBlock = std::min(gOfflineBlock, 4096u);
    gOfflineDone = 0;
    gOfflineCancel.store(false);
    gOfflinePcm.clear();
    if (gOfflineTotal > 0) gOfflinePcm.reserve(static_cast<size_t>(gOfflineTotal) * 2u);
    const double bits = getNumberField(line, "bitDepth", 16);
    gOfflineBits = bits >= 24 ? 24u : 16u;
    gOfflineRunning = true;
    jaswave_audio_set_renderer(nullptr);
    jaswave_mix_bus_set_offline(true);
    jaswave_mix_bus_reset();
    const double sr = getNumberField(line, "sampleRate", currentSampleRate());
    if (sr >= 8000) jaswave_mix_bus_set_output_rate(static_cast<uint32_t>(sr));
    replyOk("\"totalFrames\":" + std::to_string(gOfflineTotal));
    return;
  }
  if (type == "renderOfflineStep") {
    std::lock_guard<std::mutex> lock(gOfflineMu);
    if (!gOfflineRunning) {
      replyFail("RenderIdle", "No hay bounce activo");
      return;
    }
    if (gOfflineCancel.load()) {
      replyOk("\"cancelled\":true,\"progress\":0");
      return;
    }
    uint32_t frames = gOfflineBlock;
    if (gOfflineTotal > 0 && gOfflineDone + frames > gOfflineTotal) {
      frames = gOfflineTotal - gOfflineDone;
    }
    if (frames == 0) {
      replyOk("\"progress\":1,\"doneFrames\":" + std::to_string(gOfflineDone));
      return;
    }
    // Stems inline (bounce con contenido real): decodificar y empujar directo.
    {
      const auto spos = line.find("\"stems\"");
      if (spos != std::string::npos) {
        const size_t arrStart = line.find('[', spos);
        const size_t arrEnd = line.find(']', arrStart == std::string::npos ? 0 : arrStart);
        if (arrStart != std::string::npos && arrEnd != std::string::npos) {
          static std::vector<uint8_t> bytes;
          static std::vector<float> pcm;
          size_t p = arrStart + 1;
          while (p < arrEnd) {
            const size_t objStart = line.find('{', p);
            if (objStart == std::string::npos || objStart > arrEnd) break;
            const size_t objEnd = line.find('}', objStart);
            if (objEnd == std::string::npos || objEnd > arrEnd) break;
            const std::string obj = line.substr(objStart, objEnd - objStart + 1);
            const double tiNum = getNumberField(obj, "trackIndex", -1);
            if (tiNum >= 0 && tiNum < JASWAVE_MIX_MAX_TRACKS) {
              const std::string b64 = getStringField(obj, "b64");
              if (!b64.empty() && decodeBase64(b64, bytes)) {
                const size_t nSamples = bytes.size() / 4;
                pcm.resize(nSamples);
                if (nSamples > 0) std::memcpy(pcm.data(), bytes.data(), nSamples * sizeof(float));
                jaswave_mix_bus_push_stem(static_cast<uint16_t>(tiNum), pcm.data(),
                                          static_cast<uint32_t>(nSamples / 2));
              }
            }
            p = objEnd + 1;
          }
        }
      }
    }
    std::vector<float> block(static_cast<size_t>(frames) * 2u, 0.f);
    renderMix(block.data(), frames);
    gOfflinePcm.insert(gOfflinePcm.end(), block.begin(), block.end());
    gOfflineDone += frames;
    const double prog =
        gOfflineTotal > 0 ? static_cast<double>(gOfflineDone) / static_cast<double>(gOfflineTotal) : 0.0;
    std::ostringstream js;
    js << std::fixed << "\"progress\":" << prog << ",\"doneFrames\":" << gOfflineDone;
    replyOk(js.str());
    return;
  }
  if (type == "renderOfflineCancel") {
    gOfflineCancel.store(true);
    std::lock_guard<std::mutex> lock(gOfflineMu);
    gOfflineRunning = false;
    gOfflinePcm.clear();
    jaswave_mix_bus_set_offline(false);
    jaswave_audio_set_renderer(renderMix);
    replyOk("\"cancelled\":true");
    return;
  }
  if (type == "renderOfflineFinish") {
    std::lock_guard<std::mutex> lock(gOfflineMu);
    if (!gOfflineRunning) {
      replyFail("RenderIdle", "No hay bounce activo");
      return;
    }
    if (gOfflineCancel.load()) {
      gOfflineRunning = false;
      gOfflinePcm.clear();
      jaswave_mix_bus_set_offline(false);
      jaswave_audio_set_renderer(renderMix);
      replyOk("\"cancelled\":true");
      return;
    }
    const uint32_t frames = static_cast<uint32_t>(gOfflinePcm.size() / 2);
    const uint32_t sr = static_cast<uint32_t>(currentSampleRate());
    auto writeFail = [&](const std::string& msg) {
      gOfflineRunning = false;
      gOfflinePcm.clear();
      jaswave_mix_bus_set_offline(false);
      jaswave_audio_set_renderer(renderMix);
      replyFail("RenderWriteFailed", msg);
    };
#ifdef _WIN32
    FILE* f = nullptr;
    if (fopen_s(&f, gOfflineOutPath.c_str(), "wb") != 0 || !f) {
      writeFail("No se pudo abrir outPath");
      return;
    }
#else
    FILE* f = std::fopen(gOfflineOutPath.c_str(), "wb");
    if (!f) {
      writeFail("No se pudo abrir outPath");
      return;
    }
#endif
    const uint16_t numCh = 2;
    const uint16_t bits = gOfflineBits >= 24 ? 24 : 16;
    const uint32_t byteRate = sr * numCh * (bits / 8);
    const uint16_t blockAlign = numCh * (bits / 8);
    const uint32_t dataSize = frames * blockAlign;
    auto w32 = [&](uint32_t v) {
      unsigned char b[4] = {static_cast<unsigned char>(v & 255), static_cast<unsigned char>((v >> 8) & 255),
                            static_cast<unsigned char>((v >> 16) & 255),
                            static_cast<unsigned char>((v >> 24) & 255)};
      std::fwrite(b, 1, 4, f);
    };
    auto w16 = [&](uint16_t v) {
      unsigned char b[2] = {static_cast<unsigned char>(v & 255), static_cast<unsigned char>((v >> 8) & 255)};
      std::fwrite(b, 1, 2, f);
    };
    std::fwrite("RIFF", 1, 4, f);
    w32(36 + dataSize);
    std::fwrite("WAVE", 1, 4, f);
    std::fwrite("fmt ", 1, 4, f);
    w32(16);
    w16(1);
    w16(numCh);
    w32(sr);
    w32(byteRate);
    w16(blockAlign);
    w16(bits);
    std::fwrite("data", 1, 4, f);
    w32(dataSize);
    auto randUnit = []() {
      return static_cast<float>(std::rand()) / static_cast<float>(RAND_MAX);
    };
    for (uint32_t i = 0; i < frames * 2; ++i) {
      float x = gOfflinePcm[i];
      if (x < -1.f) x = -1.f;
      if (x > 1.f) x = 1.f;
      // Dithering TPDF: suma de dos uniforms → triangular en ±1 LSB.
      const float lsb = bits == 24 ? (1.f / 8388608.f) : (1.f / 32768.f);
      x += (randUnit() + randUnit() - 1.f) * lsb;
      if (x < -1.f) x = -1.f;
      if (x > 1.f) x = 1.f;
      if (bits == 24) {
        const int v = static_cast<int>(x * 8388607.f);
        const unsigned char b3[3] = {static_cast<unsigned char>(v & 255),
                                     static_cast<unsigned char>((v >> 8) & 255),
                                     static_cast<unsigned char>((v >> 16) & 255)};
        std::fwrite(b3, 1, 3, f);
      } else {
        const int16_t s =
            x < 0 ? static_cast<int16_t>(x * 32768.f) : static_cast<int16_t>(x * 32767.f);
        w16(static_cast<uint16_t>(s));
      }
    }
    std::fclose(f);
    const std::string path = gOfflineOutPath;
    gOfflineRunning = false;
    gOfflinePcm.clear();
    jaswave_mix_bus_set_offline(false);
    jaswave_audio_set_renderer(renderMix);
    replyOk("\"path\":\"" + jsonEscape(path) + "\",\"frames\":" + std::to_string(frames) +
            ",\"sampleRate\":" + std::to_string(sr) + ",\"bitDepth\":" + std::to_string(bits));
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
  jaswave_midi_open_all();
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
