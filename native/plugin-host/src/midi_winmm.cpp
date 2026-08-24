/**
 * Entrada MIDI hardware vía WinMM (el mismo API que usa REAPER).
 * El callback SOLO escribe un anillo lock-free: fprintf ahí pierde acordes y el pedal.
 * El audio thread drena el anillo hacia los VST. Un hilo aparte emite JW_MIDI a la UI.
 */

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmsystem.h>

#include "midi_winmm.h"

#include <atomic>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "winmm.lib")

namespace {

struct MidiPort {
  HMIDIIN handle{nullptr};
  UINT index{0};
};

std::mutex gMu;
std::vector<MidiPort> gPorts;
bool gOpen{false};

constexpr uint32_t kRing = 4096;
constexpr uint32_t kMask = kRing - 1;
static_assert((kRing & (kRing - 1)) == 0, "power of two");

JaswaveMidiEvent gAudioRing[kRing];
std::atomic<uint32_t> gAudioW{0};
std::atomic<uint32_t> gAudioR{0};

JaswaveMidiEvent gUiRing[kRing];
std::atomic<uint32_t> gUiW{0};
std::atomic<uint32_t> gUiR{0};

std::atomic<bool> gUiRun{false};
std::thread gUiThread;

std::string jsonEscape(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') {
      o.push_back('\\');
      o.push_back(static_cast<char>(c));
    } else if (c < 0x20) {
      char buf[8];
      std::snprintf(buf, sizeof(buf), "\\u%04x", c);
      o += buf;
    } else {
      o.push_back(static_cast<char>(c));
    }
  }
  return o;
}

std::string utf8FromAnsi(const char* src) {
  if (!src || !src[0]) return {};
  const int wlen = MultiByteToWideChar(CP_ACP, 0, src, -1, nullptr, 0);
  if (wlen <= 0) return src;
  std::wstring w(static_cast<size_t>(wlen), L'\0');
  MultiByteToWideChar(CP_ACP, 0, src, -1, w.data(), wlen);
  const int ulen = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (ulen <= 0) return src;
  std::string u(static_cast<size_t>(ulen), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, u.data(), ulen, nullptr, nullptr);
  if (!u.empty() && u.back() == '\0') u.pop_back();
  return u;
}

void pushRing(JaswaveMidiEvent* ring, std::atomic<uint32_t>& wAt, std::atomic<uint32_t>& rAt,
              JaswaveMidiEvent ev) {
  const uint32_t w = wAt.load(std::memory_order_relaxed);
  const uint32_t next = (w + 1u) & kMask;
  if (next == rAt.load(std::memory_order_acquire)) return;
  ring[w] = ev;
  wAt.store(next, std::memory_order_release);
}

size_t drainRing(JaswaveMidiEvent* ring, std::atomic<uint32_t>& wAt, std::atomic<uint32_t>& rAt,
                 JaswaveMidiEvent* out, size_t maxCount) {
  size_t n = 0;
  while (n < maxCount) {
    const uint32_t r = rAt.load(std::memory_order_relaxed);
    if (r == wAt.load(std::memory_order_acquire)) break;
    out[n++] = ring[r];
    rAt.store((r + 1u) & kMask, std::memory_order_release);
  }
  return n;
}

void CALLBACK midiProc(HMIDIIN /*h*/, UINT msg, DWORD_PTR instance, DWORD_PTR p1, DWORD_PTR /*p2*/) {
  if (msg != MIM_DATA) return;
  const DWORD packed = static_cast<DWORD>(p1);
  const uint8_t st = static_cast<uint8_t>(packed & 0xff);
  if (st < 0x80 || st >= 0xf0) return;
  JaswaveMidiEvent ev{
      static_cast<uint8_t>(instance),
      st,
      static_cast<uint8_t>((packed >> 8) & 0xff),
      static_cast<uint8_t>((packed >> 16) & 0xff),
  };
  pushRing(gAudioRing, gAudioW, gAudioR, ev);
  pushRing(gUiRing, gUiW, gUiR, ev);
}

void uiEmitLoop() {
  JaswaveMidiEvent buf[64];
  while (gUiRun.load(std::memory_order_acquire)) {
    const size_t n = drainRing(gUiRing, gUiW, gUiR, buf, 64);
    for (size_t i = 0; i < n; ++i) {
      const auto& e = buf[i];
      std::fprintf(stderr, "JW_MIDI {\"id\":\"winmm:%u\",\"data\":[%u,%u,%u]}\n",
                   static_cast<unsigned>(e.port), static_cast<unsigned>(e.status),
                   static_cast<unsigned>(e.data1), static_cast<unsigned>(e.data2));
    }
    if (n) std::fflush(stderr);
    if (!n) Sleep(1);
  }
}

}  // namespace

bool jaswave_midi_list_json(std::string& jsonOut) {
  const UINT n = midiInGetNumDevs();
  jsonOut = "[";
  for (UINT i = 0; i < n; ++i) {
    MIDIINCAPSA caps{};
    if (midiInGetDevCapsA(i, &caps, sizeof(caps)) != MMSYSERR_NOERROR) continue;
    if (jsonOut.size() > 1) jsonOut += ',';
    jsonOut += "{\"id\":\"winmm:" + std::to_string(i) + "\",\"name\":\"" +
               jsonEscape(utf8FromAnsi(caps.szPname)) + "\",\"manufacturer\":\"WinMM\"}";
  }
  jsonOut += "]";
  return true;
}

void jaswave_midi_close_all() {
  gUiRun.store(false, std::memory_order_release);
  if (gUiThread.joinable()) gUiThread.join();
  std::lock_guard<std::mutex> lock(gMu);
  for (auto& p : gPorts) {
    if (!p.handle) continue;
    midiInStop(p.handle);
    midiInReset(p.handle);
    midiInClose(p.handle);
    p.handle = nullptr;
  }
  gPorts.clear();
  gOpen = false;
  gAudioW.store(0, std::memory_order_relaxed);
  gAudioR.store(0, std::memory_order_relaxed);
  gUiW.store(0, std::memory_order_relaxed);
  gUiR.store(0, std::memory_order_relaxed);
}

void jaswave_midi_open_all() {
  jaswave_midi_close_all();
  const UINT n = midiInGetNumDevs();
  std::lock_guard<std::mutex> lock(gMu);
  for (UINT i = 0; i < n; ++i) {
    HMIDIIN h = nullptr;
    const MMRESULT r = midiInOpen(&h, i, reinterpret_cast<DWORD_PTR>(midiProc), i, CALLBACK_FUNCTION);
    if (r != MMSYSERR_NOERROR || !h) {
      std::fprintf(stderr, "[jaswave-plugin-host] midiInOpen %u falló (%u)\n", i, r);
      continue;
    }
    midiInStart(h);
    gPorts.push_back({h, i});
  }
  gOpen = true;
  gUiRun.store(true, std::memory_order_release);
  gUiThread = std::thread(uiEmitLoop);
  std::fprintf(stderr, "[jaswave-plugin-host] MIDI WinMM entradas=%zu / %u\n", gPorts.size(), n);
}

size_t jaswave_midi_drain(JaswaveMidiEvent* out, size_t maxCount) {
  if (!out || maxCount == 0) return 0;
  return drainRing(gAudioRing, gAudioW, gAudioR, out, maxCount);
}

#endif
