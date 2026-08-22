/**
 * Rings SPSC por pista + bus DAW. Productor = pipe reader; consumidor = audio thread.
 * Overflow tira lo nuevo (el productor nunca toca gR).
 */

#include "mix_bus.h"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef PIPE_REJECT_REMOTE_CLIENTS
#define PIPE_REJECT_REMOTE_CLIENTS 0x00000008
#endif
#include <windows.h>
#endif

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr uint32_t kCap = 8192;
constexpr uint32_t kMask = kCap - 1;
static_assert((kCap & (kCap - 1)) == 0, "kCap power of two");

struct StemRing {
  float buf[kCap * 2]{};
  std::atomic<uint32_t> w{0};
  std::atomic<uint32_t> r{0};
};

StemRing gStems[JASWAVE_MIX_MAX_TRACKS]{};
StemRing gDaw{};
std::atomic<bool> gRun{false};
std::atomic<uint32_t> gInRate{48000};
std::atomic<uint32_t> gOutRate{48000};
std::atomic<bool> gWantReset{false};
double gPhase = 0.0;

#ifdef _WIN32
HANDLE gPipe{INVALID_HANDLE_VALUE};
#endif
std::thread gReader;
std::string gPipeName;

uint32_t availOf(StemRing& s) {
  const uint32_t w = s.w.load(std::memory_order_acquire);
  const uint32_t r = s.r.load(std::memory_order_relaxed);
  return (w - r) & kMask;
}

bool pushFrame(StemRing& s, float l, float r) {
  const uint32_t w = s.w.load(std::memory_order_relaxed);
  const uint32_t next = (w + 1) & kMask;
  const uint32_t rd = s.r.load(std::memory_order_acquire);
  if (next == rd) return false;
  s.buf[w * 2 + 0] = l;
  s.buf[w * 2 + 1] = r;
  s.w.store(next, std::memory_order_release);
  return true;
}

StemRing* ringFor(uint16_t trackIndex) {
  if (trackIndex == JASWAVE_MIX_DAW_BUS) return &gDaw;
  if (trackIndex < JASWAVE_MIX_MAX_TRACKS) return &gStems[trackIndex];
  return nullptr;
}

void consumeResetIfNeeded() {
  if (!gWantReset.load(std::memory_order_acquire)) return;
  for (int i = 0; i < JASWAVE_MIX_MAX_TRACKS; ++i) {
    const uint32_t w = gStems[i].w.load(std::memory_order_acquire);
    gStems[i].r.store(w, std::memory_order_release);
  }
  const uint32_t dw = gDaw.w.load(std::memory_order_acquire);
  gDaw.r.store(dw, std::memory_order_release);
  gPhase = 0.0;
  gWantReset.store(false, std::memory_order_release);
}

void pullFrom(StemRing& s, float* interleaved, uint32_t frames, bool add) {
  const uint32_t inRate = gInRate.load(std::memory_order_relaxed);
  const uint32_t outRate = gOutRate.load(std::memory_order_relaxed);
  const uint32_t sr = outRate ? outRate : 48000;
  const uint32_t high = (sr * 80) / 1000;
  const uint32_t keep = (sr * 20) / 1000;
  uint32_t avail = availOf(s);
  if (avail > high && avail > keep + frames) {
    uint32_t skip = avail - keep;
    uint32_t r = s.r.load(std::memory_order_relaxed);
    s.r.store((r + skip) & kMask, std::memory_order_release);
    avail = keep;
  }

  const bool resample = inRate != 0 && outRate != 0 && inRate != outRate;
  uint32_t r = s.r.load(std::memory_order_relaxed);

  if (!resample) {
    for (uint32_t i = 0; i < frames; ++i) {
      float l = 0.f, rr = 0.f;
      if (avail > 0) {
        l = s.buf[r * 2 + 0];
        rr = s.buf[r * 2 + 1];
        r = (r + 1) & kMask;
        --avail;
      }
      if (add) {
        interleaved[i * 2 + 0] += l;
        interleaved[i * 2 + 1] += rr;
      } else {
        interleaved[i * 2 + 0] = l;
        interleaved[i * 2 + 1] = rr;
      }
    }
    s.r.store(r, std::memory_order_release);
    return;
  }

  const double step = static_cast<double>(inRate) / static_cast<double>(outRate);
  double phase = gPhase;
  for (uint32_t i = 0; i < frames; ++i) {
    float l = 0.f, rr = 0.f;
    if (avail > 0) {
      const float aL = s.buf[r * 2 + 0];
      const float aR = s.buf[r * 2 + 1];
      float bL = aL, bR = aR;
      if (avail > 1) {
        const uint32_t n = (r + 1) & kMask;
        bL = s.buf[n * 2 + 0];
        bR = s.buf[n * 2 + 1];
      }
      const float t = static_cast<float>(phase);
      l = aL + (bL - aL) * t;
      rr = aR + (bR - aR) * t;
      phase += step;
      while (phase >= 1.0 && avail > 0) {
        phase -= 1.0;
        r = (r + 1) & kMask;
        --avail;
      }
    }
    if (add) {
      interleaved[i * 2 + 0] += l;
      interleaved[i * 2 + 1] += rr;
    } else {
      interleaved[i * 2 + 0] = l;
      interleaved[i * 2 + 1] = rr;
    }
  }
  gPhase = phase;
  s.r.store(r, std::memory_order_release);
}

#ifdef _WIN32
void pushPacketFrames(uint16_t trackIndex, const float* interleaved, uint16_t frameCount) {
  StemRing* ring = ringFor(trackIndex);
  if (!ring || !interleaved) return;
  for (uint16_t i = 0; i < frameCount; ++i) {
    if (!pushFrame(*ring, interleaved[i * 2], interleaved[i * 2 + 1])) return;
  }
}

/** Parser: paquetes JWST o legacy f32 stereo → DAW bus. */
void pushBytes(const uint8_t* data, size_t nbytes, std::vector<uint8_t>& remnant) {
  remnant.insert(remnant.end(), data, data + nbytes);
  size_t off = 0;
  while (true) {
    const size_t left = remnant.size() - off;
    if (left < 4) break;
    uint32_t magic = 0;
    std::memcpy(&magic, remnant.data() + off, 4);
    if (magic == JASWAVE_MIX_MAGIC) {
      if (left < 8) break;
      uint16_t trackIndex = 0, frameCount = 0;
      std::memcpy(&trackIndex, remnant.data() + off + 4, 2);
      std::memcpy(&frameCount, remnant.data() + off + 6, 2);
      const size_t need = 8 + static_cast<size_t>(frameCount) * 8;
      if (left < need) break;
      if (frameCount > 0 && frameCount <= 4096) {
        const float* pcm = reinterpret_cast<const float*>(remnant.data() + off + 8);
        pushPacketFrames(trackIndex, pcm, frameCount);
      }
      off += need;
      continue;
    }
    // Legacy: consumir frames de 8 bytes hacia DAW bus
    if (left < 8) break;
    float l = 0, r = 0;
    std::memcpy(&l, remnant.data() + off, 4);
    std::memcpy(&r, remnant.data() + off + 4, 4);
    pushFrame(gDaw, l, r);
    off += 8;
  }
  if (off > 0) remnant.erase(remnant.begin(), remnant.begin() + static_cast<std::ptrdiff_t>(off));
  if (remnant.size() > 65536) remnant.clear();
}

void readerLoop() {
  std::vector<uint8_t> remnant;
  remnant.reserve(8192);
  while (gRun.load(std::memory_order_acquire)) {
    if (gPipe == INVALID_HANDLE_VALUE) break;
    BOOL ok = ConnectNamedPipe(gPipe, nullptr);
    if (!ok) {
      const DWORD err = GetLastError();
      if (err != ERROR_PIPE_CONNECTED && err != ERROR_NO_DATA) {
        if (!gRun.load(std::memory_order_acquire)) break;
        Sleep(30);
        continue;
      }
    }
    remnant.clear();
    gWantReset.store(true, std::memory_order_release);
    uint8_t chunk[8192];
    while (gRun.load(std::memory_order_acquire)) {
      DWORD got = 0;
      if (!ReadFile(gPipe, chunk, sizeof(chunk), &got, nullptr) || got == 0) break;
      pushBytes(chunk, static_cast<size_t>(got), remnant);
    }
    DisconnectNamedPipe(gPipe);
    remnant.clear();
  }
}
#endif

}  // namespace

bool jaswave_mix_bus_start(std::string& pipeName, std::string& err) {
  jaswave_mix_bus_stop();
#ifdef _WIN32
  const DWORD pid = GetCurrentProcessId();
  char name[128];
  std::snprintf(name, sizeof(name), "\\\\.\\pipe\\jaswave-mix-%lu", static_cast<unsigned long>(pid));
  gPipe = CreateNamedPipeA(
      name, PIPE_ACCESS_INBOUND,
      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 262144,
      262144, 0, nullptr);
  if (gPipe == INVALID_HANDLE_VALUE) {
    gPipe = CreateNamedPipeA(name, PIPE_ACCESS_INBOUND,
                             PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1, 262144, 262144, 0,
                             nullptr);
  }
  if (gPipe == INVALID_HANDLE_VALUE) {
    err = "CreateNamedPipe mix bus falló";
    return false;
  }
  gPipeName = name;
  pipeName = name;
  for (int i = 0; i < JASWAVE_MIX_MAX_TRACKS; ++i) {
    gStems[i].w.store(0, std::memory_order_relaxed);
    gStems[i].r.store(0, std::memory_order_relaxed);
  }
  gDaw.w.store(0, std::memory_order_relaxed);
  gDaw.r.store(0, std::memory_order_relaxed);
  gPhase = 0.0;
  gWantReset.store(false, std::memory_order_relaxed);
  gRun.store(true, std::memory_order_release);
  gReader = std::thread(readerLoop);
  return true;
#else
  err = "mix bus PCM solo en Windows por ahora";
  (void)pipeName;
  return false;
#endif
}

void jaswave_mix_bus_stop() {
  gRun.store(false, std::memory_order_release);
#ifdef _WIN32
  if (gPipe != INVALID_HANDLE_VALUE) {
    CancelIoEx(gPipe, nullptr);
    CloseHandle(gPipe);
    gPipe = INVALID_HANDLE_VALUE;
  }
#endif
  if (gReader.joinable()) gReader.join();
  gPipeName.clear();
}

bool jaswave_mix_bus_running() { return gRun.load(std::memory_order_acquire); }

void jaswave_mix_bus_set_input_rate(uint32_t hz) {
  if (hz >= 8000 && hz <= 192000) gInRate.store(hz, std::memory_order_relaxed);
}

void jaswave_mix_bus_set_output_rate(uint32_t hz) {
  if (hz >= 8000 && hz <= 192000) gOutRate.store(hz, std::memory_order_relaxed);
}

void jaswave_mix_bus_reset() { gWantReset.store(true, std::memory_order_release); }

void jaswave_mix_bus_add(float* interleavedStereo, uint32_t frames) {
  if (!interleavedStereo || frames == 0) return;
  consumeResetIfNeeded();
  pullFrom(gDaw, interleavedStereo, frames, true);
}

void jaswave_mix_bus_pull_stem(uint16_t trackIndex, float* interleavedStereo, uint32_t frames) {
  if (!interleavedStereo || frames == 0) return;
  consumeResetIfNeeded();
  StemRing* ring = ringFor(trackIndex);
  if (!ring) {
    std::memset(interleavedStereo, 0, static_cast<size_t>(frames) * 2 * sizeof(float));
    return;
  }
  pullFrom(*ring, interleavedStereo, frames, false);
}
