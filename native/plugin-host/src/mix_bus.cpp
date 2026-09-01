/**
 * Rings SPSC por pista + bus DAW. Productor = pipe reader; consumidor = audio thread.
 * Chromium (sink none) y ASIO no comparten reloj: NO cortar audio al target.
 * PLL: consume un poco más rápido/lento según fill (interpolación).
 * Solo en emergencia (>~87% capacity) se descartan frames viejos.
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

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
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
  double phase{0.0};
};

StemRing gStems[JASWAVE_MIX_MAX_TRACKS]{};
StemRing gDaw{};
std::atomic<bool> gRun{false};
std::atomic<uint32_t> gInRate{48000};
std::atomic<uint32_t> gOutRate{48000};
std::atomic<bool> gWantReset{false};
std::atomic<uint32_t> gCallbackGen{0};
std::atomic<uint32_t> gLastPushGen[JASWAVE_MIX_MAX_TRACKS]{};
std::atomic<uint32_t> gDawLastPushGen{0};
std::atomic<uint8_t> gSeen[JASWAVE_MIX_MAX_TRACKS]{};
std::atomic<uint8_t> gDawSeen{0};
std::atomic<uint32_t> gPullBudget{std::numeric_limits<uint32_t>::max()};
std::atomic<bool> gOffline{false};
std::atomic<uint64_t> gUnderrunBlocks{0};
std::atomic<uint64_t> gOverflowPushes{0};
std::atomic<uint64_t> gHighFillDropFrames{0};

/** Cola generosa: el PLL absorbe drift; high solo para emergencia. */
constexpr uint32_t kLiveCallbacks = 16;
constexpr uint32_t kMinTarget = 256;
constexpr uint32_t kMaxTarget = 2048;
constexpr uint32_t kEmergencyFill = (kCap * 7) / 8;  // ~7168
std::atomic<uint32_t> gAsioFrames{256};
std::atomic<uint32_t> gTargetFill{768};
std::atomic<uint32_t> gHighFill{2048};
/** Ratio de consumo (1.0 = 1:1). Audio thread escribe; pullExact lee. */
std::atomic<double> gPullRatio{1.0};

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

void skipFrames(StemRing& s, uint32_t n) {
  const uint32_t a = availOf(s);
  if (n > a) n = a;
  if (n == 0) return;
  const uint32_t r = s.r.load(std::memory_order_relaxed);
  s.r.store((r + n) & kMask, std::memory_order_release);
  s.phase = 0.0;
}

void updateFillLimits(uint32_t asioFrames) {
  if (asioFrames < 16) asioFrames = 16;
  if (asioFrames > 4096) asioFrames = 4096;
  gAsioFrames.store(asioFrames, std::memory_order_relaxed);
  // ~4 bloques de cola para buffers grandes (menos underrun bajo VSTs pesados).
  uint32_t target = asioFrames >= 512 ? asioFrames * 4 : asioFrames * 3;
  if (target < kMinTarget) target = kMinTarget;
  if (target > kMaxTarget) target = kMaxTarget;
  uint32_t high = asioFrames * 8;
  if (high < target + asioFrames * 2) high = target + asioFrames * 2;
  if (high > kCap / 2) high = kCap / 2;
  if (high <= target) high = target + asioFrames;
  gTargetFill.store(target, std::memory_order_relaxed);
  gHighFill.store(high, std::memory_order_relaxed);
}

/** Solo si el ring está casi lleno (evitar wrap). No usarlo como PLL. */
void trimRingEmergency(StemRing& s) {
  const uint32_t a = availOf(s);
  if (a <= kEmergencyFill) return;
  const uint32_t high = gHighFill.load(std::memory_order_relaxed);
  const uint32_t want = high > kEmergencyFill / 2 ? high : kEmergencyFill / 2;
  if (a <= want) return;
  const uint32_t drop = a - want;
  skipFrames(s, drop);
  gHighFillDropFrames.fetch_add(drop, std::memory_order_relaxed);
}

bool pushFrame(StemRing& s, float l, float r) {
  uint32_t w = s.w.load(std::memory_order_relaxed);
  uint32_t next = (w + 1) & kMask;
  uint32_t rd = s.r.load(std::memory_order_acquire);
  if (next == rd) {
    // Lleno de verdad: descarta 1 viejo (último recurso; el PLL debería evitarlo).
    skipFrames(s, 1);
    gOverflowPushes.fetch_add(1, std::memory_order_relaxed);
    w = s.w.load(std::memory_order_relaxed);
    next = (w + 1) & kMask;
    rd = s.r.load(std::memory_order_acquire);
    if (next == rd) return false;
  }
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

void markLive(uint16_t trackIndex) {
  const uint32_t gen = gCallbackGen.load(std::memory_order_relaxed);
  if (trackIndex == JASWAVE_MIX_DAW_BUS) {
    gDawSeen.store(1, std::memory_order_release);
    gDawLastPushGen.store(gen, std::memory_order_release);
    return;
  }
  if (trackIndex < JASWAVE_MIX_MAX_TRACKS) {
    gSeen[trackIndex].store(1, std::memory_order_release);
    gLastPushGen[trackIndex].store(gen, std::memory_order_release);
  }
}

bool genIsLive(uint32_t lastGen, uint32_t gen) {
  return (gen - lastGen) <= kLiveCallbacks;
}

void consumeResetIfNeeded() {
  if (!gWantReset.load(std::memory_order_acquire)) return;
  for (int i = 0; i < JASWAVE_MIX_MAX_TRACKS; ++i) {
    const uint32_t w = gStems[i].w.load(std::memory_order_acquire);
    gStems[i].r.store(w, std::memory_order_release);
    gStems[i].phase = 0.0;
    gSeen[i].store(0, std::memory_order_relaxed);
    gLastPushGen[i].store(0, std::memory_order_relaxed);
  }
  const uint32_t dw = gDaw.w.load(std::memory_order_acquire);
  gDaw.r.store(dw, std::memory_order_release);
  gDaw.phase = 0.0;
  gDawSeen.store(0, std::memory_order_relaxed);
  gDawLastPushGen.store(0, std::memory_order_relaxed);
  gPullRatio.store(1.0, std::memory_order_relaxed);
  gWantReset.store(false, std::memory_order_release);
}

void pullExact(StemRing& s, float* interleaved, uint32_t frames, bool add) {
  if (frames == 0) return;
  const uint32_t inRate = gInRate.load(std::memory_order_relaxed);
  const uint32_t outRate = gOutRate.load(std::memory_order_relaxed);
  double step = gPullRatio.load(std::memory_order_relaxed);
  if (step < 0.5) step = 0.5;
  if (step > 2.0) step = 2.0;
  if (inRate != 0 && outRate != 0 && inRate != outRate) {
    step *= static_cast<double>(inRate) / static_cast<double>(outRate);
  }

  uint32_t r = s.r.load(std::memory_order_relaxed);
  uint32_t avail = availOf(s);
  double phase = s.phase;

  // Siempre interpolar: con step≈1 es 1:1; el PLL ajusta step para seguir el reloj ASIO.
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
  s.phase = phase;
  s.r.store(r, std::memory_order_release);
}

void pullFrom(StemRing& s, float* interleaved, uint32_t frames, bool add) {
  const uint32_t budget = gPullBudget.load(std::memory_order_relaxed);
  uint32_t n = frames;
  if (budget < n) n = budget;
  pullExact(s, interleaved, n, add);
  if (n >= frames || add) return;
  std::memset(interleaved + n * 2, 0, static_cast<size_t>(frames - n) * 2 * sizeof(float));
}

#ifdef _WIN32
void pushPacketFrames(uint16_t trackIndex, const float* interleaved, uint16_t frameCount) {
  StemRing* ring = ringFor(trackIndex);
  if (!ring || !interleaved || frameCount == 0) return;
  trimRingEmergency(*ring);
  markLive(trackIndex);
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
    // Legacy: frames sueltos → DAW bus
    if (left < 8) break;
    float l = 0, r = 0;
    std::memcpy(&l, remnant.data() + off, 4);
    std::memcpy(&r, remnant.data() + off + 4, 4);
    off += 8;
    trimRingEmergency(gDaw);
    pushFrame(gDaw, l, r);
    markLive(JASWAVE_MIX_DAW_BUS);
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

void jaswave_mix_bus_push_stem(uint16_t trackIndex, const float* interleavedStereo,
                               uint32_t frames) {
#ifdef _WIN32
  StemRing* ring = ringFor(trackIndex);
  if (!ring || !interleavedStereo || frames == 0) return;
  trimRingEmergency(*ring);
  markLive(trackIndex);
  for (uint32_t i = 0; i < frames; ++i) {
    if (!pushFrame(*ring, interleavedStereo[i * 2], interleavedStereo[i * 2 + 1])) return;
  }
#else
  (void)trackIndex;
  (void)interleavedStereo;
  (void)frames;
#endif
}

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
    gStems[i].phase = 0.0;
    gSeen[i].store(0, std::memory_order_relaxed);
    gLastPushGen[i].store(0, std::memory_order_relaxed);
  }
  gDaw.w.store(0, std::memory_order_relaxed);
  gDaw.r.store(0, std::memory_order_relaxed);
  gDaw.phase = 0.0;
  gDawSeen.store(0, std::memory_order_relaxed);
  gDawLastPushGen.store(0, std::memory_order_relaxed);
  gCallbackGen.store(0, std::memory_order_relaxed);
  gPullBudget.store(std::numeric_limits<uint32_t>::max(), std::memory_order_relaxed);
  gWantReset.store(false, std::memory_order_relaxed);
  updateFillLimits(256);
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

void jaswave_mix_bus_set_offline(bool offline) {
  gOffline.store(offline, std::memory_order_release);
}

void jaswave_mix_bus_begin_block(uint32_t frames) {
  consumeResetIfNeeded();
  if (frames == 0) {
    gPullBudget.store(0, std::memory_order_relaxed);
    return;
  }

  updateFillLimits(frames);

  if (gOffline.load(std::memory_order_acquire)) {
    gPullRatio.store(1.0, std::memory_order_relaxed);
    gPullBudget.store(frames, std::memory_order_relaxed);
    gCallbackGen.fetch_add(1, std::memory_order_relaxed);
    return;
  }

  const uint32_t gen = gCallbackGen.fetch_add(1, std::memory_order_relaxed) + 1;
  const uint32_t target = gTargetFill.load(std::memory_order_relaxed);
  const uint32_t high = gHighFill.load(std::memory_order_relaxed);

  uint32_t minAvail = std::numeric_limits<uint32_t>::max();
  bool anyLive = false;
  StemRing* live[JASWAVE_MIX_MAX_TRACKS + 1]{};
  int liveN = 0;

  for (int i = 0; i < JASWAVE_MIX_MAX_TRACKS; ++i) {
    if (!gSeen[i].load(std::memory_order_relaxed)) continue;
    if (!genIsLive(gLastPushGen[i].load(std::memory_order_relaxed), gen)) continue;
    anyLive = true;
    live[liveN++] = &gStems[i];
    minAvail = std::min(minAvail, availOf(gStems[i]));
  }
  if (gDawSeen.load(std::memory_order_relaxed) &&
      genIsLive(gDawLastPushGen.load(std::memory_order_relaxed), gen)) {
    anyLive = true;
    live[liveN++] = &gDaw;
    minAvail = std::min(minAvail, availOf(gDaw));
  }

  if (!anyLive) {
    gPullRatio.store(1.0, std::memory_order_relaxed);
    gPullBudget.store(frames, std::memory_order_relaxed);
    return;
  }

  // Emergencia: ring casi lleno → recortar a high (no a target: eso causaba crackle).
  if (minAvail > kEmergencyFill) {
    const uint32_t want = high;
    if (minAvail > want) {
      const uint32_t drop = minAvail - want;
      for (int i = 0; i < liveN; ++i) skipFrames(*live[i], drop);
      minAvail = want;
      gHighFillDropFrames.fetch_add(drop, std::memory_order_relaxed);
    }
  }

  // PLL: drenar saturación con más agresividad; reconstruir si está vacío.
  {
    const double t = target > 0 ? static_cast<double>(target) : 512.0;
    const double err = (static_cast<double>(minAvail) - t) / t;
    double adj = err * 0.06;
    if (minAvail < frames * 2) {
      if (adj > -0.06) adj = -0.06;
    }
    if (adj > 0.05) adj = 0.05;
    if (adj < -0.06) adj = -0.06;
    // Por encima de high: acelerar fuerte (hasta +12%) para vaciar antes del trim.
    if (minAvail > high) {
      double boost = (static_cast<double>(minAvail) - static_cast<double>(high)) / t * 0.12;
      if (boost > 0.12) boost = 0.12;
      if (boost > adj) adj = boost;
    } else if (minAvail > target + (target >> 1)) {
      // Entre 1.5×target y high: drenar con +5% extra.
      if (adj < 0.05) adj = 0.05;
    }
    gPullRatio.store(1.0 + adj, std::memory_order_relaxed);
  }

  if (minAvail < frames) {
    gUnderrunBlocks.fetch_add(1, std::memory_order_relaxed);
  }

  // Siempre intentar el bloque completo; pullExact rellena silencio si no hay samples.
  gPullBudget.store(frames, std::memory_order_relaxed);
}

void jaswave_mix_bus_add(float* interleavedStereo, uint32_t frames) {
  if (!interleavedStereo || frames == 0) return;
  pullFrom(gDaw, interleavedStereo, frames, true);
}

void jaswave_mix_bus_pull_stem(uint16_t trackIndex, float* interleavedStereo, uint32_t frames) {
  if (!interleavedStereo || frames == 0) return;
  StemRing* ring = ringFor(trackIndex);
  if (!ring) {
    std::memset(interleavedStereo, 0, static_cast<size_t>(frames) * 2 * sizeof(float));
    return;
  }
  pullFrom(*ring, interleavedStereo, frames, false);
}

void jaswave_mix_bus_get_stats(JaswaveMixBusStats& out) {
  out = {};
  out.capacity = kCap;
  out.targetFill = gTargetFill.load(std::memory_order_relaxed);
  out.highFill = gHighFill.load(std::memory_order_relaxed);
  out.running = gRun.load(std::memory_order_acquire);
  out.inRate = gInRate.load(std::memory_order_relaxed);
  out.outRate = gOutRate.load(std::memory_order_relaxed);
  out.pullBudget = gPullBudget.load(std::memory_order_relaxed);
  out.underrunBlocks = gUnderrunBlocks.load(std::memory_order_relaxed);
  out.overflowPushes = gOverflowPushes.load(std::memory_order_relaxed);
  out.highFillDropFrames = gHighFillDropFrames.load(std::memory_order_relaxed);
  out.dawFill = availOf(gDaw);

  const uint32_t gen = gCallbackGen.load(std::memory_order_relaxed);
  uint32_t minLive = std::numeric_limits<uint32_t>::max();
  uint32_t maxLive = 0;
  uint32_t liveN = 0;
  for (int i = 0; i < JASWAVE_MIX_MAX_TRACKS; ++i) {
    if (!gSeen[i].load(std::memory_order_relaxed)) continue;
    if (!genIsLive(gLastPushGen[i].load(std::memory_order_relaxed), gen)) continue;
    const uint32_t a = availOf(gStems[i]);
    minLive = std::min(minLive, a);
    maxLive = std::max(maxLive, a);
    ++liveN;
  }
  if (gDawSeen.load(std::memory_order_relaxed) &&
      genIsLive(gDawLastPushGen.load(std::memory_order_relaxed), gen)) {
    const uint32_t a = availOf(gDaw);
    minLive = std::min(minLive, a);
    maxLive = std::max(maxLive, a);
    ++liveN;
  }
  out.liveTracks = liveN;
  out.minLiveFill = liveN ? minLive : 0;
  out.maxLiveFill = liveN ? maxLive : 0;
}

void jaswave_mix_bus_reset_stats() {
  gUnderrunBlocks.store(0, std::memory_order_relaxed);
  gOverflowPushes.store(0, std::memory_order_relaxed);
  gHighFillDropFrames.store(0, std::memory_order_relaxed);
}
