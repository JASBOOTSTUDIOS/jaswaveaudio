// =====================================================================================
//  JasWave Sampler – motor de muestras (reproduce librerías multimuestra reales)
//   - Formato de instrumento .jwi (texto, una región por línea) generado desde librerías SFZ/WAV/FLAC
//   - Carga en un hilo propio (nunca en el hilo de audio): FLAC/WAV -> int16 en memoria
//   - Voces con interpolación Hermite, envolvente de liberación, grupos de silenciado (hi-hat),
//     round-robin aleatorio, humanización (nivel / afinación / ataque) y pedal de sustain (CC64)
//   - Reverb FDN y control de nivel
// =====================================================================================
#pragma once

#include "../../com.jaswave.plugin.roles-vst/src/roles_dsp.h"

#define DR_FLAC_IMPLEMENTATION
#include "third_party/dr_flac.h"
#define DR_WAV_IMPLEMENTATION
#include "third_party/dr_wav.h"
#define DR_MP3_IMPLEMENTATION
#include "third_party/dr_mp3.h"

#include <atomic>
#include <cctype>
#include <cstring>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace JasWaveSampler {

using namespace JasWaveRoles::dsp;

struct SampleData {
  std::vector<int16_t> data;   // intercalado
  int ch{1};
  uint32_t frames{0};
  uint32_t sr{48000};
};

struct Region {
  int sample{-1};
  int lokey{0}, hikey{127}, center{60};
  int lovel{1}, hivel{127};
  float tune{0.f}, vol{0.f}, pan{0.f};     // cents, dB, -1..1
  float attack{0.f}, release{0.4f};         // s
  int loopStart{-1}, loopEnd{-1};           // en frames; -1 = sin lazo
  bool oneShot{false};
  int group{0}, offBy{0};
  int rr{0};                                // grupo de round-robin (0 = ninguno)
  bool releaseTrigger{false};
};

struct Instrument {
  std::string name;
  float gainDb{0.f};
  float velGamma{0.5f};
  float baseRelease{0.4f};
  std::vector<SampleData> samples;
  std::vector<Region> regions;
  size_t bytes() const { size_t b = 0; for (const auto& s : samples) b += s.data.size() * 2; return b; }
};

inline std::string trim(const std::string& s) {
  size_t a = 0, b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r')) ++a;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r')) --b;
  return s.substr(a, b - a);
}

inline bool endsWith(const std::string& s, const char* suf) {
  const size_t n = std::strlen(suf);
  if (s.size() < n) return false;
  for (size_t i = 0; i < n; ++i) if (std::tolower(static_cast<unsigned char>(s[s.size() - n + i])) != suf[i]) return false;
  return true;
}

// Decodifica un archivo a int16 (FLAC, WAV o MP3), truncando a maxSeconds con fundido final.
// Para MP3 solo se decodifican los primeros maxSeconds (los pads son archivos muy largos).
inline bool decodeFile(const std::string& path, float maxSeconds, SampleData& out) {
  if (endsWith(path, ".mp3")) {
    drmp3 mp3;
    if (!drmp3_init_file(&mp3, path.c_str(), nullptr)) return false;
    const unsigned ch = mp3.channels, sr = mp3.sampleRate;
    uint64_t want = maxSeconds > 0.f ? static_cast<uint64_t>(maxSeconds * static_cast<float>(sr)) : 0;
    if (want == 0) want = static_cast<uint64_t>(60.f * static_cast<float>(sr));
    out.ch = ch > 1 ? 2 : 1;
    out.sr = sr;
    out.data.assign(static_cast<size_t>(want) * static_cast<size_t>(out.ch), 0);
    std::vector<int16_t> tmp(4096 * 2);
    uint64_t got = 0;
    while (got < want) {
      const uint64_t n = std::min<uint64_t>(4096, want - got);
      const uint64_t r = drmp3_read_pcm_frames_s16(&mp3, n, tmp.data());
      if (r == 0) break;
      for (uint64_t i = 0; i < r; ++i)
        for (int c = 0; c < out.ch; ++c) out.data[static_cast<size_t>(got + i) * out.ch + c] = tmp[static_cast<size_t>(i) * mp3.channels + static_cast<size_t>(c)];
      got += r;
    }
    drmp3_uninit(&mp3);
    if (got == 0) return false;
    out.frames = static_cast<uint32_t>(got);
    out.data.resize(static_cast<size_t>(got) * static_cast<size_t>(out.ch));
    return true;
  }
  drwav_uint64 frames = 0;
  unsigned int ch = 0, sr = 0;
  int16_t* pcm = nullptr;
  const bool isFlac = endsWith(path, ".flac");
  if (isFlac) {
    drflac_uint64 f = 0;
    pcm = drflac_open_file_and_read_pcm_frames_s16(path.c_str(), &ch, &sr, &f, nullptr);
    frames = f;
  } else {
    drwav_uint64 f = 0;
    unsigned int c = 0, s2 = 0;
    pcm = drwav_open_file_and_read_pcm_frames_s16(path.c_str(), &c, &s2, &f, nullptr);
    ch = c; sr = s2; frames = f;
  }
  if (!pcm || frames == 0 || ch == 0) { if (pcm) { if (isFlac) drflac_free(pcm, nullptr); else drwav_free(pcm, nullptr); } return false; }
  uint64_t use = frames;
  if (maxSeconds > 0.f) use = std::min<uint64_t>(frames, static_cast<uint64_t>(maxSeconds * static_cast<float>(sr)));
  out.ch = ch > 2 ? 2 : static_cast<int>(ch);
  out.sr = sr;
  out.frames = static_cast<uint32_t>(use);
  out.data.resize(static_cast<size_t>(use) * static_cast<size_t>(out.ch));
  for (uint64_t i = 0; i < use; ++i)
    for (int c = 0; c < out.ch; ++c) out.data[static_cast<size_t>(i) * out.ch + c] = pcm[static_cast<size_t>(i) * ch + static_cast<size_t>(c)];
  if (isFlac) drflac_free(pcm, nullptr); else drwav_free(pcm, nullptr);
  if (use < frames) {   // fundido de 0.8 s al truncar
    const uint64_t fade = std::min<uint64_t>(use, static_cast<uint64_t>(0.8f * static_cast<float>(sr)));
    for (uint64_t i = 0; i < fade; ++i) {
      const float g = 1.f - static_cast<float>(i) / static_cast<float>(fade);
      const size_t base = static_cast<size_t>(use - fade + i) * out.ch;
      for (int c = 0; c < out.ch; ++c) out.data[base + static_cast<size_t>(c)] = static_cast<int16_t>(static_cast<float>(out.data[base + static_cast<size_t>(c)]) * g * g);
    }
  }
  return true;
}

// Formato .jwi:
//   # comentario
//   name=...    gain=dB    velGamma=0.5    release=0.4
//   r|archivo|lokey|hikey|center|lovel|hivel|tune|vol|pan|attack|release|loopStart|loopEnd|oneShot|group|offBy|rr|maxSec
inline std::shared_ptr<Instrument> loadInstrument(const std::string& jwiPath, std::atomic<int>& progress, std::atomic<bool>& cancel) {
  std::ifstream f(jwiPath);
  if (!f) return nullptr;
  auto inst = std::make_shared<Instrument>();
  std::string dir = jwiPath.substr(0, jwiPath.find_last_of("/\\") + 1);
  struct Line { std::string file; Region r; float maxSec; };
  std::vector<Line> lines;
  std::string ln;
  while (std::getline(f, ln)) {
    ln = trim(ln);
    if (ln.empty() || ln[0] == '#') continue;
    if (ln[0] != 'r' || ln.size() < 2 || ln[1] != '|') {
      const size_t eq = ln.find('=');
      if (eq == std::string::npos) continue;
      const std::string k = trim(ln.substr(0, eq)), v = trim(ln.substr(eq + 1));
      if (k == "name") inst->name = v;
      else if (k == "gain") inst->gainDb = static_cast<float>(std::atof(v.c_str()));
      else if (k == "velGamma") inst->velGamma = static_cast<float>(std::atof(v.c_str()));
      else if (k == "release") inst->baseRelease = static_cast<float>(std::atof(v.c_str()));
      continue;
    }
    std::vector<std::string> p;
    std::stringstream ss(ln.substr(2));
    std::string tok;
    while (std::getline(ss, tok, '|')) p.push_back(tok);
    if (p.size() < 19) continue;
    Line l;
    l.file = p[0];
    Region& r = l.r;
    r.lokey = std::atoi(p[1].c_str()); r.hikey = std::atoi(p[2].c_str()); r.center = std::atoi(p[3].c_str());
    r.lovel = std::atoi(p[4].c_str()); r.hivel = std::atoi(p[5].c_str());
    r.tune = static_cast<float>(std::atof(p[6].c_str())); r.vol = static_cast<float>(std::atof(p[7].c_str())); r.pan = static_cast<float>(std::atof(p[8].c_str()));
    r.attack = static_cast<float>(std::atof(p[9].c_str())); r.release = static_cast<float>(std::atof(p[10].c_str()));
    r.loopStart = std::atoi(p[11].c_str()); r.loopEnd = std::atoi(p[12].c_str());
    r.oneShot = std::atoi(p[13].c_str()) != 0;
    r.group = std::atoi(p[14].c_str()); r.offBy = std::atoi(p[15].c_str());
    r.rr = std::atoi(p[16].c_str());
    r.releaseTrigger = std::atoi(p[17].c_str()) != 0;
    l.maxSec = static_cast<float>(std::atof(p[18].c_str()));
    lines.push_back(std::move(l));
  }
  // Muestras únicas
  std::vector<std::string> unique;
  std::vector<float> uniqueMax;
  std::vector<int> map(lines.size());
  for (size_t i = 0; i < lines.size(); ++i) {
    size_t k = 0;
    for (; k < unique.size(); ++k) if (unique[k] == lines[i].file && uniqueMax[k] == lines[i].maxSec) break;
    if (k == unique.size()) { unique.push_back(lines[i].file); uniqueMax.push_back(lines[i].maxSec); }
    map[i] = static_cast<int>(k);
  }
  inst->samples.resize(unique.size());
  for (size_t k = 0; k < unique.size(); ++k) {
    if (cancel.load()) return nullptr;
    const std::string full = (unique[k].size() > 1 && (unique[k][1] == ':' || unique[k][0] == '/' || unique[k][0] == '\\')) ? unique[k] : dir + unique[k];
    if (!decodeFile(full, uniqueMax[k], inst->samples[k])) { inst->samples[k].frames = 0; }
    progress.store(static_cast<int>(100.0 * static_cast<double>(k + 1) / static_cast<double>(unique.size())));
  }
  for (size_t i = 0; i < lines.size(); ++i) {
    Region r = lines[i].r;
    r.sample = map[i];
    if (inst->samples[static_cast<size_t>(r.sample)].frames == 0) continue;
    inst->regions.push_back(r);
  }
  if (inst->name.empty()) inst->name = jwiPath;
  return inst;
}

// ---------------------------------------------------------------------------------
//  Voz
// ---------------------------------------------------------------------------------
struct SVoice {
  bool active{false}, releasing{false}, held{false};
  const Instrument* inst{nullptr};
  const Region* reg{nullptr};
  const SampleData* smp{nullptr};
  double pos{0.0}, inc{1.0};
  float gL{0.f}, gR{0.f};
  float env{0.f}, envA{1.f}, relDec{0.999f};
  int note{0};
  int group{0};
  uint64_t age{0};
};

class SamplerEngine {
public:
  ~SamplerEngine() { shutdown(); }

  void prepare(double sr) {
    sr_ = static_cast<float>(sr > 0 ? sr : 48000.0);
    reverb_.prepare(sr_);
    applyReverb();
    eqDirty_ = true;
    if (!loader_.joinable()) {
      stop_.store(false);
      loader_ = std::thread([this] { loaderMain(); });
    }
  }
  void shutdown() {
    stop_.store(true);
    cancel_.store(true);
    if (loader_.joinable()) loader_.join();
  }

  // ---- parámetros (hilo de audio, sin bloqueo) ----
  void setInstrumentIndex(int idx) { requested_.store(idx); }
  void setVolumeDb(float db) { volume_ = dbToLin(db); }
  void setPan(float p) { pan_ = clampf(p, -1.f, 1.f); }
  void setWidth(float w) { width_ = clampf(w, 0.f, 2.f); }
  void setHumanize(float h) { humanize_ = clampf(h, 0.f, 1.f); }
  void setAttackMs(float ms) { attackSec_ = clampf(ms, 0.f, 4000.f) * 0.001f; }
  void setReleaseScale(float s) { releaseScale_ = clampf(s, 0.1f, 6.f); }
  void setSustain(float s) { sustain_ = clampf(s, 0.f, 1.f); }
  void setVelSens(float v) { velSens_ = clampf(v, 0.f, 1.f); }
  void setTuneCents(float c) { tune_ = c; }
  void setEq(float lowDb, float highDb) { if (lowDb != eqLowDb_ || highDb != eqHighDb_) { eqLowDb_ = lowDb; eqHighDb_ = highDb; eqDirty_ = true; } }
  void setReverb(float mix, float rt60, float damp, float preMs) {
    reverbTarget_ = clampf(mix, 0.f, 1.f);
    if (rt60 != rt60_ || damp != damp_ || preMs != preMs_) { rt60_ = rt60; damp_ = damp; preMs_ = preMs; reverbDirty_ = true; }
  }
  void setPaths(std::vector<std::string> files) { files_ = std::move(files); }

  int loadProgress() const { return progress_.load(); }
  int loadState() const { return state_.load(); }     // 0 vacío, 1 cargando, 2 listo, 3 error
  int activeVoices() const { int a = 0; for (const auto& v : voices_) a += v.active ? 1 : 0; return a; }
  const std::array<SVoice, 96>& voices() const { return voices_; }

  void noteOn(int pitch, float vel01, int);
  void noteOff(int pitch, int);
  void sustainPedal(bool on);
  void allNotesOff();
  void render(float* L, float* R, int n);

private:
  void loaderMain();
  void startVoice(const Region& r, const Instrument* inst, int pitch, float vel01);
  void releaseVoice(SVoice& v, bool fast);
  void applyReverb() { reverb_.setDecay(rt60_, damp_); reverb_.setPreDelayMs(preMs_); reverbDirty_ = false; }
  void rebuildEq() { eqLowL_.lowShelf(sr_, 160.f, eqLowDb_); eqLowR_.lowShelf(sr_, 160.f, eqLowDb_); eqHighL_.highShelf(sr_, 5500.f, eqHighDb_); eqHighR_.highShelf(sr_, 5500.f, eqHighDb_); eqDirty_ = false; }

  float sr_{48000.f};
  float volume_{1.f}, pan_{0.f}, width_{1.f}, humanize_{0.3f}, attackSec_{0.f}, releaseScale_{1.f}, sustain_{0.f}, velSens_{0.5f}, tune_{0.f};
  float eqLowDb_{0.f}, eqHighDb_{0.f}, reverbTarget_{0.f}, reverbWet_{0.f}, rt60_{2.4f}, damp_{0.45f}, preMs_{18.f};
  bool eqDirty_{true}, reverbDirty_{false};
  std::array<SVoice, 96> voices_{};
  uint64_t age_{0};
  Rng rng_{0x1234567u};
  FdnReverb reverb_;
  Biquad eqLowL_, eqLowR_, eqHighL_, eqHighR_;
  bool sustainOn_{false};
  int lastRr_[64]{};

  std::vector<std::string> files_;
  std::atomic<int> requested_{-1};
  int loadedIdx_{-2};
  std::atomic<int> progress_{0}, state_{0};
  std::atomic<bool> stop_{false}, cancel_{false};
  std::atomic<Instrument*> active_{nullptr};
  std::shared_ptr<Instrument> holder_;
  std::vector<std::shared_ptr<Instrument>> graveyard_;
  std::thread loader_;
  Instrument* voicesInst_{nullptr};
};

inline void SamplerEngine::loaderMain() {
  while (!stop_.load()) {
    const int want = requested_.load();
    if (want != loadedIdx_ && want >= 0 && static_cast<size_t>(want) < files_.size()) {
      state_.store(1);
      progress_.store(0);
      cancel_.store(false);
      auto inst = loadInstrument(files_[static_cast<size_t>(want)], progress_, cancel_);
      if (inst && !inst->regions.empty()) {
        if (holder_) graveyard_.push_back(holder_);
        holder_ = inst;
        active_.store(inst.get());
        loadedIdx_ = want;
        state_.store(2);
        progress_.store(100);
      } else {
        loadedIdx_ = want;
        state_.store(3);
      }
    } else if (!graveyard_.empty() && state_.load() == 2) {
      std::this_thread::sleep_for(std::chrono::milliseconds(1500));
      graveyard_.clear();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
  }
}

inline void SamplerEngine::releaseVoice(SVoice& v, bool fast) {
  if (!v.active || v.releasing) return;
  v.releasing = true;
  // el "sustain" prolonga la cola al soltar la nota (hasta 5x), como un pedal parcial
  const float rel = fast ? 0.012f : std::max(0.01f, v.reg->release * releaseScale_ * (1.f + 4.f * sustain_));
  v.relDec = std::pow(10.f, -3.f / (rel * sr_));
}

inline void SamplerEngine::startVoice(const Region& r, const Instrument* inst, int pitch, float vel01) {
  int idx = -1;
  uint64_t oldest = UINT64_MAX;
  int oldestIdx = 0;
  for (size_t i = 0; i < voices_.size(); ++i) {
    if (!voices_[i].active) { idx = static_cast<int>(i); break; }
    if (voices_[i].age < oldest) { oldest = voices_[i].age; oldestIdx = static_cast<int>(i); }
  }
  if (idx < 0) idx = oldestIdx;
  SVoice& v = voices_[static_cast<size_t>(idx)];
  const SampleData& s = inst->samples[static_cast<size_t>(r.sample)];
  v = SVoice{};
  v.active = true;
  v.inst = inst; v.reg = &r; v.smp = &s;
  v.note = pitch;
  v.group = r.group;
  v.age = ++age_;
  const float h = humanize_;
  const float centsJitter = (rng_.uni() * 2.f - 1.f) * 3.5f * h;
  const float dbJitter = (rng_.uni() * 2.f - 1.f) * 1.4f * h;
  const double semis = static_cast<double>(pitch - r.center) + static_cast<double>(r.tune + tune_ + centsJitter) / 100.0;
  v.inc = (static_cast<double>(s.sr) / static_cast<double>(sr_)) * std::pow(2.0, semis / 12.0);
  const float gamma = inst->velGamma * (0.25f + 1.5f * velSens_);
  const float g = std::pow(clampf(vel01, 0.01f, 1.f), gamma) * dbToLin(r.vol + inst->gainDb + dbJitter);
  const float a = (clampf(r.pan, -1.f, 1.f) + 1.f) * 0.78539816f;
  v.gL = g * std::cos(a) * 1.41421356f;
  v.gR = g * std::sin(a) * 1.41421356f;
  const float atk = std::max(r.attack, attackSec_) + (rng_.uni() * 0.0015f * h);
  v.envA = atk > 0.0005f ? 1.f / (atk * sr_) : 1.f;
  v.env = atk > 0.0005f ? 0.f : 1.f;
}

inline void SamplerEngine::noteOn(int pitch, float vel01, int) {
  Instrument* inst = active_.load(std::memory_order_acquire);
  if (!inst) return;
  if (inst != voicesInst_) { for (auto& v : voices_) v.active = false; voicesInst_ = inst; }
  const int vel = std::clamp(static_cast<int>(std::lround(vel01 * 127.f)), 1, 127);
  const Region* cand[64];
  int nc = 0;
  for (const auto& r : inst->regions) {
    if (r.releaseTrigger) continue;
    if (pitch < r.lokey || pitch > r.hikey || vel < r.lovel || vel > r.hivel) continue;
    if (nc < 64) cand[nc++] = &r;
  }
  if (nc == 0) return;
  int played[64];
  int np = 0;
  int seenRr[16];
  int nSeen = 0;
  for (int i = 0; i < nc; ++i) {
    const int rr = cand[i]->rr;
    if (rr == 0) { played[np++] = i; continue; }
    bool seen = false;
    for (int k = 0; k < nSeen; ++k) if (seenRr[k] == rr) seen = true;
    if (seen) continue;
    if (nSeen < 16) seenRr[nSeen++] = rr;
    int members[64], nm = 0;
    for (int j = 0; j < nc; ++j) if (cand[j]->rr == rr) members[nm++] = j;
    int pick = members[static_cast<int>(rng_.uni() * static_cast<float>(nm)) % nm];
    const int key = pitch & 63;
    if (nm > 1 && pick == lastRr_[key]) pick = members[(static_cast<int>(rng_.uni() * static_cast<float>(nm)) + 1) % nm];
    lastRr_[key] = pick;
    played[np++] = pick;
  }
  for (int i = 0; i < np; ++i) {
    const Region& r = *cand[played[i]];
    if (r.offBy > 0) for (auto& v : voices_) if (v.active && v.group == r.offBy) releaseVoice(v, true);
    startVoice(r, inst, pitch, vel01);
  }
}

inline void SamplerEngine::noteOff(int pitch, int) {
  for (auto& v : voices_) {
    if (!v.active || v.note != pitch || v.releasing) continue;
    if (v.reg && v.reg->oneShot) continue;
    if (sustainOn_) { v.held = true; continue; }
    releaseVoice(v, false);
  }
}

inline void SamplerEngine::sustainPedal(bool on) {
  sustainOn_ = on;
  if (!on) for (auto& v : voices_) if (v.active && v.held) { v.held = false; releaseVoice(v, false); }
}

inline void SamplerEngine::allNotesOff() {
  sustainOn_ = false;
  for (auto& v : voices_) { v.held = false; if (v.active) releaseVoice(v, true); }
}

inline void SamplerEngine::render(float* L, float* R, int n) {
  if (eqDirty_) rebuildEq();
  if (reverbDirty_) applyReverb();
  for (int i = 0; i < n; ++i) { L[i] = 0.f; R[i] = 0.f; }
  for (auto& v : voices_) {
    if (!v.active) continue;
    const SampleData& s = *v.smp;
    const int16_t* d = s.data.data();
    const int ch = s.ch;
    const int64_t last = static_cast<int64_t>(s.frames) - 1;
    const Region& rg = *v.reg;
    const bool hasLoop = rg.loopStart >= 0 && rg.loopEnd > rg.loopStart && rg.loopEnd <= last;
    const bool loop = hasLoop && !v.releasing;
    const double loopLen = hasLoop ? static_cast<double>(rg.loopEnd - rg.loopStart) : 0.0;
    const double xf = hasLoop ? std::min(loopLen * 0.5, std::max(0.05 * static_cast<double>(s.sr), std::min(loopLen * 0.25, 4.0 * static_cast<double>(s.sr)))) : 0.0;
    auto readAt = [&](double pos, float& yl, float& yr) {
      const int64_t i1 = static_cast<int64_t>(pos);
      const float fr = static_cast<float>(pos - static_cast<double>(i1));
      const int64_t i0 = i1 > 0 ? i1 - 1 : 0, i2 = std::min(i1 + 1, last), i3 = std::min(i1 + 2, last);
      auto herm = [&](float a, float b, float c, float e) {
        const float c0 = b, c1 = 0.5f * (c - a), c2 = a - 2.5f * b + 2.f * c - 0.5f * e, c3 = 0.5f * (e - a) + 1.5f * (b - c);
        return ((c3 * fr + c2) * fr + c1) * fr + c0;
      };
      if (ch == 2) {
        yl = herm(d[i0 * 2], d[i1 * 2], d[i2 * 2], d[i3 * 2]);
        yr = herm(d[i0 * 2 + 1], d[i1 * 2 + 1], d[i2 * 2 + 1], d[i3 * 2 + 1]);
      } else {
        yl = yr = herm(d[i0], d[i1], d[i2], d[i3]);
      }
    };
    for (int i = 0; i < n; ++i) {
      if (static_cast<int64_t>(v.pos) >= last) { v.active = false; break; }
      float yl, yr;
      readAt(v.pos, yl, yr);
      if (loop && v.pos >= static_cast<double>(rg.loopEnd) - xf) {
        // crossfade de potencia constante hacia el inicio del lazo (sin clics ni saltos de fase)
        const float t = static_cast<float>((v.pos - (static_cast<double>(rg.loopEnd) - xf)) / xf);
        float bl, br;
        readAt(v.pos - loopLen, bl, br);
        const float ca = std::cos(t * 1.5707963f), cb = std::sin(t * 1.5707963f);
        yl = yl * ca + bl * cb;
        yr = yr * ca + br * cb;
      }
      if (v.env < 1.f && !v.releasing) v.env = std::min(1.f, v.env + v.envA);
      float e = v.env;
      if (v.releasing) { v.env *= v.relDec; e = v.env; if (v.env < 1.0e-4f) { v.active = false; break; } }
      const float k = e * (1.f / 32768.f);
      L[i] += yl * k * v.gL;
      R[i] += yr * k * v.gR;
      v.pos += v.inc;
      if (loop && v.pos >= static_cast<double>(rg.loopEnd)) v.pos -= loopLen;
    }
  }
  // ancho, pan, EQ, reverb y nivel
  const float pa = (pan_ + 1.f) * 0.78539816f;
  const float pl = std::cos(pa) * 1.41421356f, pr = std::sin(pa) * 1.41421356f;
  for (int i = 0; i < n; ++i) {
    float l = L[i], r = R[i];
    if (width_ != 1.f) {
      const float m = 0.5f * (l + r), sd = 0.5f * (l - r) * width_;
      l = m + sd; r = m - sd;
    }
    l *= pl; r *= pr;
    if (eqLowDb_ != 0.f || eqHighDb_ != 0.f) {
      l = eqHighL_.process(eqLowL_.process(l));
      r = eqHighR_.process(eqLowR_.process(r));
    }
    reverbWet_ += (reverbTarget_ - reverbWet_) * 0.001f;
    l *= volume_; r *= volume_;
    if (reverbWet_ > 0.002f) {
      float rl, rr;
      reverb_.process(l, r, rl, rr);
      l += rl * reverbWet_ * 1.3f;
      r += rr * reverbWet_ * 1.3f;
    } else {
      float a, b; reverb_.process(0.f, 0.f, a, b); (void)a; (void)b;
    }
    const float al = std::fabs(l), ar = std::fabs(r);
    if (al > 0.9f) l = (l > 0.f ? 1.f : -1.f) * (0.9f + 0.1f * std::tanh((al - 0.9f) * 6.f));
    if (ar > 0.9f) r = (r > 0.f ? 1.f : -1.f) * (0.9f + 0.1f * std::tanh((ar - 0.9f) * 6.f));
    L[i] = l; R[i] = r;
  }
}

} // namespace JasWaveSampler
