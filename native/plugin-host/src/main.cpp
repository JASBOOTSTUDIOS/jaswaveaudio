/**
 * JasWave Plugin Host â€” discover + VST3 load/MIDI/audio + editor embed (ADR-0011).
 */

#include <algorithm>
#include <map>
#include <atomic>
#include <cctype>
#include <filesystem>
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
#include "jw_dsp.h"   // plugins/shared-dsp: LoudnessMeter BS.1770 compartido con los plugins
#include "master_limiter.h"
#endif
#ifdef _WIN32
#include "asio_output.h"
#endif

#ifdef _WIN32
/** Las rutas llegan en UTF-8 por JSON; fopen/remove de la CRT las leerían como ANSI («Batería» → «BaterÃ­a»). */
static std::wstring utf8ToWide(const std::string& s) {
  if (s.empty()) return {};
  const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring w(static_cast<size_t>(n > 0 ? n : 0), L'\0');
  if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
  return w;
}
#endif

static FILE* openFileUtf8(const std::string& path, const char* mode) {
#ifdef _WIN32
  FILE* f = nullptr;
  const std::wstring wmode(mode, mode + std::strlen(mode));
  if (_wfopen_s(&f, utf8ToWide(path).c_str(), wmode.c_str()) != 0) return nullptr;
  return f;
#else
  return std::fopen(path.c_str(), mode);
#endif
}

static void removeFileUtf8(const std::string& path) {
#ifdef _WIN32
  _wremove(utf8ToWide(path).c_str());
#else
  std::remove(path.c_str());
#endif
}

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

/**
 * Id de la petición en curso (campo "rid" del comando). Se devuelve en cada respuesta para que
 * el puente empareje respuestas asíncronas (load en el hilo UI) sin depender del orden.
 * thread_local: el hilo de stdin y el hilo UI responden cada uno a su petición.
 */
static thread_local long long tReplyRid = -1;
static std::mutex gReplyMu;

static std::string ridSuffix() {
  return tReplyRid >= 0 ? ",\"rid\":" + std::to_string(tReplyRid) : std::string();
}

static void replyOk(const std::string& extraJson = "") {
  std::lock_guard<std::mutex> lock(gReplyMu);
  if (extraJson.empty()) {
    std::cout << "{\"ok\":true,\"processId\":\"jaswave-plugin-host\"" << ridSuffix() << "}\n" << std::flush;
  } else {
    std::cout << "{\"ok\":true,\"processId\":\"jaswave-plugin-host\"," << extraJson << ridSuffix() << "}\n"
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
  std::lock_guard<std::mutex> lock(gReplyMu);
  if (extraJson.empty()) {
    std::cout << "{\"ok\":false,\"code\":\"" << code << "\",\"message\":\"" << jsonEscape(message)
              << "\"" << ridSuffix() << "}\n"
              << std::flush;
  } else {
    std::cout << "{\"ok\":false,\"code\":\"" << code << "\",\"message\":\"" << jsonEscape(message)
              << "\"," << extraJson << ridSuffix() << "}\n"
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
  // strtod directo sobre el buffer: `substr` copiaba el resto de la linea (puede ser PCM base64 de cientos de MB).
  const char* begin = json.c_str() + pos;
  char* end = nullptr;
  const double v = std::strtod(begin, &end);
  return end == begin ? fallback : v;
}

/** Base64 -> floats f32 LE. false si el tamano decodificado no es multiplo de 4 bytes o esta vacio. */
static bool decodeF32Base64(const std::string& b64, std::vector<float>& out) {
  auto val = [](unsigned char c) -> int {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
  };
  std::vector<uint8_t> bytes;
  bytes.reserve(b64.size() / 4 * 3 + 3);
  uint32_t acc = 0;
  int bits = -8;
  for (unsigned char c : b64) {
    if (c == '=') break;
    const int d = val(c);
    if (d < 0) continue;
    acc = (acc << 6) | static_cast<uint32_t>(d);
    bits += 6;
    if (bits >= 0) {
      bytes.push_back(static_cast<uint8_t>((acc >> bits) & 0xFF));
      bits -= 8;
    }
  }
  if (bytes.empty()) return false;
  out.resize(bytes.size() / sizeof(float));
  std::memcpy(out.data(), bytes.data(), out.size() * sizeof(float));
  return !out.empty();
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
  std::string format;  // siempre "vst3" (VST2 retirado, ADR-0019)
};

static std::string toLowerCopy(std::string s) {
  for (auto& c : s) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  return s;
}

static bool endsWithLower(const std::string& nameLower, const char* ext) {
  const size_t n = std::strlen(ext);
  return nameLower.size() >= n && nameLower.compare(nameLower.size() - n, n, ext) == 0;
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
    if (name.size() > 5) name = name.substr(0, name.size() - 5);
    const bool hostable = kAudioReady;
    plugins << "{\"path\":\"" << jsonEscape(found[i].path) << "\",\"name\":\"" << jsonEscape(name)
            << "\",\"format\":\"vst3\",\"hostReady\":"
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
/** Destinos MIDI en vivo (K3): hasta 32 (capas × zonas de todas las pistas armadas). */
static constexpr int kLiveMidiMax = 32;
static std::atomic<HostedSlot*> gLiveMidiSlots[kLiveMidiMax]{};
static std::atomic<int> gLiveMidiPort[kLiveMidiMax]{};
static std::atomic<int> gLiveMidiCount{0};
static std::atomic<int> gLiveMidiChannel{-1};

/**
 * Zona por destino: rango de teclas, transposición, curva de velocidad y canales. Doble buffer: el hilo de
 * control rellena el inactivo y publica el índice; el hilo de audio solo lee. Dos publicaciones muy seguidas
 * pueden dar un bloque con la configuración mezclada (solo enteros): inocuo.
 */
struct LiveZoneCfg {
  int lo{0};
  int hi{127};
  int transpose{0};
  int velCurve{0};  // 0 lineal · 1 suave · 2 dura · 3 fija
  int velFixed{100};
  float velScale{1.f};
  int inChannel{-1};   // -1 = cualquier canal de entrada
  int outChannel{-1};  // -1 = el canal con el que llegó la nota
};
static LiveZoneCfg gLiveZones[2][kLiveMidiMax];
static std::atomic<int> gLiveZoneBuf{0};
/** Cambia con cada setLiveMidiTargets/unload: el hilo de audio revisa qué notas seguían sonando. */
static std::atomic<uint32_t> gLiveZoneGen{0};
/** PANIC: el hilo de audio descarta lo pendiente en el anillo WinMM y olvida las notas en curso. */
static std::atomic<bool> gLivePanic{false};

/**
 * Seguimiento de note-off por nota ORIGINAL (canal de entrada × tono): si la transposición o el rango
 * cambian mientras una tecla está pisada, el note-off llega al tono y canal que sonaron. Solo hilo de audio.
 */
struct LiveNoteTrack {
  uint8_t out[16][128]{};    // tono emitido + 1 (0 = no suena)
  uint8_t outCh[16][128]{};  // canal con el que se emitió
  HostedSlot* owner{nullptr};
};
static LiveNoteTrack gLiveNotes[kLiveMidiMax];
static uint32_t gLiveNotesGen = 0;

static int liveVelCurveFromName(const std::string& s) {
  if (s == "suave") return 1;
  if (s == "dura") return 2;
  if (s == "fija") return 3;
  return 0;
}

/** Velocidad 0..1 tras la curva de la zona (nunca 0: eso sería un note-off). */
static float liveVelocityCurve(int vel, const LiveZoneCfg& z) {
  float v = static_cast<float>(std::clamp(vel, 1, 127)) / 127.f;
  switch (z.velCurve) {
    case 1: v = std::sqrt(v); break;   // suave: responde más con poca fuerza
    case 2: v = v * v; break;          // dura: hay que pegar más fuerte
    case 3: return std::clamp(static_cast<float>(z.velFixed) / 127.f, 1.f / 127.f, 1.f);
    default: break;
  }
  return std::clamp(v * z.velScale, 1.f / 127.f, 1.f);
}

struct LiveMidiPortInit {
  LiveMidiPortInit() {
    for (int i = 0; i < kLiveMidiMax; ++i) gLiveMidiPort[i].store(-1, std::memory_order_relaxed);
  }
} gLiveMidiPortInit;

/**
 * Recorre los objetos `{…}` de un array JSON plano `"key":[{…},{…}]` (sin arrays anidados). Hilo de control.
 */
template <class Fn>
static void forEachJsonObjectIn(const std::string& json, const char* key, Fn fn) {
  const std::string needle = std::string("\"") + key + "\"";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return;
  pos = json.find('[', pos);
  if (pos == std::string::npos) return;
  int depth = 0;
  bool inStr = false;
  size_t start = 0;
  for (size_t i = pos + 1; i < json.size(); ++i) {
    const char c = json[i];
    if (inStr) {
      if (c == '\\') ++i;
      else if (c == '"') inStr = false;
      continue;
    }
    if (c == '"') inStr = true;
    else if (c == '{') {
      if (depth++ == 0) start = i;
    } else if (c == '}') {
      if (--depth == 0) fn(json.substr(start, i - start + 1));
    } else if (c == ']' && depth == 0) {
      return;
    }
  }
}

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

/** Puerto de entrada "todas" (pista con entrada MIDI = all): recibe de cualquier dispositivo. */
static constexpr int kLiveMidiPortOmni = -2;

/** "winmm:N" → N · "all" → kLiveMidiPortOmni · cualquier otro (vacío, desconocido) → -1 (sin entrada). */
static int parseWinmmPortId(const std::string& id) {
  if (id == "all") return kLiveMidiPortOmni;
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
// El sustain del lado del host (retener note-off con el pedal pisado) vive en cada Vst3Slot: así vale para la
// entrada WinMM, para los comandos del renderer (Web MIDI, MIDI Learn, teclado en pantalla) y para los clips.

/**
 * Pedales conmutados (CC64 sustain, CC66 sostenuto, CC67 suave, CC69 hold 2) unificados por canal.
 * Teclados como el Yamaha PSR-E373 mandan cada pisada por varios canales a la vez (voz principal, dual y
 * split): B0 40 7F · B1 40 7F · B2 40 00 en el mismo milisegundo. En modo omni el último mensaje («suelto»
 * en el canal sin voz) anulaba la pisada y el sustain nunca se aplicaba. Valor efectivo = máximo entre los
 * 16 canales; solo se reenvía cuando cambia. Solo lo toca el audio thread.
 */
struct LivePedal {
  uint8_t porCanal[16]{};
  int emitido{-1};
};
static LivePedal gLivePedales[4];

static int livePedalIndex(int cc) {
  switch (cc) {
    case 64: return 0;
    case 66: return 1;
    case 67: return 2;
    case 69: return 3;
    default: return -1;
  }
}

/** true si hay que reenviar el CC (con `out` como valor efectivo); false si no cambia el estado del pedal. */
static bool livePedalUnificar(int cc, int ch, int value, int& out) {
  const int i = livePedalIndex(cc);
  if (i < 0) {
    out = value;
    return true;
  }
  LivePedal& p = gLivePedales[i];
  p.porCanal[ch & 15] = static_cast<uint8_t>(std::clamp(value, 0, 127));
  int mx = 0;
  for (int c = 0; c < 16; ++c) mx = std::max(mx, static_cast<int>(p.porCanal[c]));
  if (mx == p.emitido) return false;
  p.emitido = mx;
  out = mx;
  return true;
}

static double currentSampleRate();

/** Instante (QPC ns) del bloque anterior: los eventos llegados desde entonces se reparten en este bloque. */
static int64_t gLiveMidiBlockNs = 0;

/**
 * Desfase en muestras de un evento dentro del bloque actual. Se reproduce un bloque después de llegar pero
 * con su espaciado real (sin jitter de buffer): off = (t_evento − t_bloque_anterior) × sr. Si el reloj
 * no es fiable (primer bloque, pausa larga) el evento va al inicio, como antes.
 */
static int liveMidiOffset(int64_t evNs, int64_t prevNs, int64_t nowNs, int frames) {
  if (evNs <= 0 || prevNs <= 0 || evNs < prevNs || frames <= 1) return 0;
  const double sr = currentSampleRate();
  const double bloqueNs = 1e9 * frames / (sr > 0 ? sr : 48000.0);
  if (static_cast<double>(nowNs - prevNs) > 4.0 * bloqueNs) return 0;
  const double off = static_cast<double>(evNs - prevNs) * sr / 1e9;
  return std::max(0, std::min(frames - 1, static_cast<int>(off)));
}

/**
 * Tras cambiar los destinos (setLiveMidiTargets / unload): si un índice pasó a otro slot, las notas que seguían
 * sonando se apagan en el slot anterior (solo si sigue siendo un destino vivo: nunca se usa un puntero descargado).
 */
static void liveNotesSyncGeneration() {
  const uint32_t gen = gLiveZoneGen.load(std::memory_order_acquire);
  if (gen == gLiveNotesGen) return;
  gLiveNotesGen = gen;
  for (int s = 0; s < kLiveMidiMax; ++s) {
    LiveNoteTrack& t = gLiveNotes[s];
    HostedSlot* now = gLiveMidiSlots[s].load(std::memory_order_acquire);
    if (t.owner == now) continue;
    bool vivo = false;
    if (t.owner) {
      for (int k = 0; k < kLiveMidiMax && !vivo; ++k) vivo = gLiveMidiSlots[k].load(std::memory_order_acquire) == t.owner;
    }
    for (int ch = 0; ch < 16; ++ch) {
      for (int p = 0; p < 128; ++p) {
        if (!t.out[ch][p]) continue;
        if (vivo) t.owner->noteOff(t.out[ch][p] - 1, 0, t.outCh[ch][p]);
        t.out[ch][p] = 0;
      }
    }
    t.owner = now;
  }
}

static void liveNotesForgetAll() {
  for (int s = 0; s < kLiveMidiMax; ++s) {
    for (int ch = 0; ch < 16; ++ch) {
      for (int p = 0; p < 128; ++p) gLiveNotes[s].out[ch][p] = 0;
    }
  }
  for (auto& p : gLivePedales) {
    for (int c = 0; c < 16; ++c) p.porCanal[c] = 0;
    p.emitido = -1;
  }
}

static void applyLiveMidiFromWinmm(int frames) {
  const int64_t nowNs = jaswave_midi_now_ns();
  const int64_t prevNs = gLiveMidiBlockNs;
  gLiveMidiBlockNs = nowNs;
  JaswaveMidiEvent evs[128];
  if (gLivePanic.exchange(false, std::memory_order_acq_rel)) {
    // PANIC: lo que quedaba en el anillo no llega a ningún instrumento y nada queda «sonando» para el seguimiento.
    while (jaswave_midi_drain(evs, 128) == 128) {
    }
    liveNotesForgetAll();
  }
  liveNotesSyncGeneration();
  int guard = 0;
  while (guard++ < 8) {
    const size_t n = jaswave_midi_drain(evs, 128);
    if (!n) return;
    const int count = std::min(gLiveMidiCount.load(std::memory_order_acquire), kLiveMidiMax);
    if (count <= 0) continue;
    const int chFilter = gLiveMidiChannel.load(std::memory_order_relaxed);
    const LiveZoneCfg* zones = gLiveZones[gLiveZoneBuf.load(std::memory_order_acquire) & 1];
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
      } else {
        continue;
      }
      int ccValor = static_cast<int>(e.data2);
      // El estado del pedal se actualiza aunque ahora mismo no haya destino: al asignar una pista ya está al día.
      if (hi == 0xb0 && !livePedalUnificar(pitch, ch, ccValor, ccValor)) continue;
      const bool noteOn = hi == 0x90 && e.data2 > 0;
      const bool noteOff = hi == 0x80 || (hi == 0x90 && e.data2 == 0);
      const int off = liveMidiOffset(e.timestampNs, prevNs, nowNs, frames);
      // Un CC va una sola vez a cada slot aunque tenga varias zonas.
      HostedSlot* ccSent[kLiveMidiMax];
      int nCcSent = 0;
      for (int s = 0; s < count; ++s) {
        auto* slot = gLiveMidiSlots[s].load(std::memory_order_acquire);
        if (!slot) continue;
        const int port = gLiveMidiPort[s].load(std::memory_order_relaxed);
        if (port == -1) continue;  // sin entrada asignada
        if (port != kLiveMidiPortOmni && port != static_cast<int>(e.port)) continue;
        const LiveZoneCfg& z = zones[s];
        if (z.inChannel >= 0 && ch != z.inChannel) continue;
        const int outCh = z.outChannel >= 0 ? z.outChannel : ch;
        LiveNoteTrack& t = gLiveNotes[s];
        if (noteOn) {
          if (pitch < z.lo || pitch > z.hi) continue;
          const int op = std::clamp(pitch + z.transpose, 0, 127);
          uint8_t& prev = t.out[ch][pitch];
          if (prev) slot->noteOff(prev - 1, off, t.outCh[ch][pitch]);  // misma tecla repetida sin soltar
          prev = static_cast<uint8_t>(op + 1);
          t.outCh[ch][pitch] = static_cast<uint8_t>(outCh);
          slot->noteOn(op, liveVelocityCurve(static_cast<int>(e.data2), z), off, 0, outCh);
        } else if (noteOff) {
          uint8_t& prev = t.out[ch][pitch];
          if (prev) {
            slot->noteOff(prev - 1, off, t.outCh[ch][pitch]);
            prev = 0;
          } else if (pitch >= z.lo && pitch <= z.hi) {
            // Nota iniciada antes de asignar la zona: se apaga donde sonaría ahora.
            slot->noteOff(std::clamp(pitch + z.transpose, 0, 127), off, outCh);
          }
        } else {
          bool ya = false;
          for (int k = 0; k < nCcSent && !ya; ++k) ya = ccSent[k] == slot;
          if (ya) continue;
          ccSent[nCcSent++] = slot;
          slot->midiCc(pitch, ccValor, off, outCh);
        }
      }
    }
    if (n < 128) return;
  }
}
static std::string gMixPipeName;
static std::atomic<float> gMasterGain{1.f};
static std::atomic<bool> gMasterMuted{false};
static std::atomic<float> gMasterPan{0.f};
// Monitorización: volumen hacia el dispositivo (altavoces/auriculares). No toca el bounce ni los medidores:
// el usuario puede ver señal en el master y, a la vez, no sacar nada por la salida.
static std::atomic<float> gMonitorGain{1.f};
static std::atomic<bool> gMonitorMuted{false};
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
static constexpr uint16_t kSinPadre = 0xFFFF;
struct RtTrackChain {
  uint16_t stemIndex{0};
  /** Carpeta-bus a la que va su salida post-fader (stem), o kSinPadre = al master. */
  uint16_t parentStem{kSinPadre};
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
static float gPrevPostL[kMaxGraphTracks][8192]{};
static float gPrevPostR[kMaxGraphTracks][8192]{};
static float gScMixL[8192]{};
static float gScMixR[8192]{};
static float gPreL[kMaxGraphTracks][8192]{};
static float gPreR[kMaxGraphTracks][8192]{};
/** Salida post-fader de cada stem (lo que exporta su stem), vaya al master o a su carpeta-bus. */
static float gStemAccL[kMaxGraphTracks][8192]{};
static float gStemAccR[kMaxGraphTracks][8192]{};
/** Entrada de cada stem desde el grafo: hijas de una carpeta y envíos a un bus (pasan por sus FX). */
static float gInL[kMaxGraphTracks][8192]{};
static float gInR[kMaxGraphTracks][8192]{};

static RtTrackChain gRtTracks[2][kMaxGraphTracks]{};
static uint8_t gRtTrackCount[2]{0, 0};
/**
 * Orden topológico (índices de cadena): cada pista antes que su carpeta y que los buses a los que envía.
 * `gRtRank` = posición de cada cadena en ese orden; `gRtStemChain` = cadena de cada stem (0xFF = ninguna).
 */
static uint8_t gRtOrder[2][kMaxGraphTracks]{};
static uint8_t gRtRank[2][kMaxGraphTracks]{};
static uint8_t gRtStemChain[2][kMaxGraphTracks]{};
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
/**
 * Stop duro en curso: la salida es silencio desde el bloque siguiente y no se procesa ningún plugin hasta
 * que el hilo UI termina de vaciarlos (voces, reverb, delay). Pausa no lo usa: ahí las colas caen solas.
 */
static std::atomic<bool> gHardStop{false};

/** Borra el audio retenido por el host (líneas de compensación de latencia y sidechain previo). */
static void clearHostDelayLines() {
  for (int t = 0; t < kMaxGraphTracks; ++t) {
    std::fill(gPdcL[t], gPdcL[t] + kMaxPdc, 0.f);
    std::fill(gPdcR[t], gPdcR[t] + kMaxPdc, 0.f);
    std::fill(gPrevPostL[t], gPrevPostL[t] + 8192, 0.f);
    std::fill(gPrevPostR[t], gPrevPostR[t] + 8192, 0.f);
  }
  std::fill(gPdcDawL, gPdcDawL + kMaxPdc, 0.f);
  std::fill(gPdcDawR, gPdcDawR + kMaxPdc, 0.f);
}

/** Peaks post-fader (stemIndex 0..63) + master; audio thread escribe, control lee snapshot. */
static std::atomic<float> gMeterStemPeak[kMaxGraphTracks]{};
static std::atomic<float> gMeterStemPeakL[kMaxGraphTracks]{};
static std::atomic<float> gMeterStemPeakR[kMaxGraphTracks]{};
static std::atomic<float> gMeterSidechainPeak[kMaxGraphTracks]{};
static std::atomic<float> gMeterMasterPeak{0.f};
static constexpr float kMeterDecay = 0.92f;
/** Medición del master (hilo de audio escribe, control lee): L/R, RMS, correlación y sonoridad BS.1770. */
static std::atomic<float> gMeterMasterPeakL{0.f}, gMeterMasterPeakR{0.f};
static std::atomic<float> gMeterMasterRmsL{0.f}, gMeterMasterRmsR{0.f};
static std::atomic<float> gMeterMasterCorr{1.f};
static JasWaveDsp::LoudnessMeter gMasterLoudness;
static uint32_t gMasterLoudnessSr = 0;
static JasWaveDsp::SpectrumTap gMasterTap;   // mono (L+R)/2 de la salida, para el espectro del master
static float gMasterTapL[8192], gMasterTapR[8192];
/**
 * Espectro por pista, independiente: cada tira del mixer con el espectro abierto activa el tap de su stem
 * (el hilo de audio solo copia a los activos). Un tap que nadie consulta en 2 s se apaga solo.
 */
static JasWaveDsp::SpectrumTap gStemTaps[kMaxGraphTracks];
static std::atomic<bool> gStemTapActivo[kMaxGraphTracks]{};
static std::atomic<bool> gMasterLoudnessReset{false};
static double currentSampleRate();
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
// Streaming a disco (U6): el WAV se escribe bloque a bloque en vez de acumular
// todo el render en RAM (los renders largos se comían la memoria del host).
static std::atomic<bool> gOfflineActive{false};
// Ventana de preparación: entre renderOfflineStart y el primer bloque la app
// programa los clips del bounce (el host limpia lo programado al arrancar).
static std::atomic<bool> gOfflineSetup{false};
static FILE* gOfflineFile{nullptr};
static uint32_t gOfflineSampleRate{48000};
static uint32_t gOfflineFramesWritten{0};
/** Render sin la ganancia ×1.35 ni el limitador suave del master (freeze, stems, análisis). */
static std::atomic<bool> gOfflineTransparentMaster{false};

/** Stem exportado durante el bounce: salida de una pista (o bus) a su propio WAV, en la misma pasada. */
struct OfflineStemOut {
  uint16_t stemIndex{0};
  std::string path;
  FILE* file{nullptr};
  bool preFader{false};
};
static std::vector<OfflineStemOut> gOfflineStems;
static constexpr size_t kMaxOfflineStems = 64;

/** Escribe la cabecera WAV (44 bytes) con los tamaños reservados. bits=32 → PCM float IEEE. */
static bool writeOfflineWavHeader(FILE* f, uint32_t sampleRate, uint16_t bits, uint32_t frames) {
  if (!f) return false;
  const uint16_t numCh = 2;
  const uint32_t byteRate = sampleRate * numCh * (bits / 8);
  const uint16_t blockAlign = static_cast<uint16_t>(numCh * (bits / 8));
  const uint32_t dataSize = frames * blockAlign;
  auto w32 = [&](uint32_t v) {
    unsigned char b[4] = {static_cast<unsigned char>(v & 255), static_cast<unsigned char>((v >> 8) & 255),
                          static_cast<unsigned char>((v >> 16) & 255), static_cast<unsigned char>((v >> 24) & 255)};
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
  w16(bits == 32 ? 3 : 1);  // 3 = WAVE_FORMAT_IEEE_FLOAT
  w16(numCh);
  w32(sampleRate);
  w32(byteRate);
  w16(blockAlign);
  w16(bits);
  std::fwrite("data", 1, 4, f);
  w32(dataSize);
  std::fflush(f);
  return std::ferror(f) == 0;
}

/** Escribe un bloque estéreo interlequeado a disco (enteros con dithering TPDF; float tal cual). */
static bool writeOfflinePcmBlock(FILE* f, const float* block, size_t count, uint16_t bits) {
  if (!f) return false;
  if (bits == 32) {
    // Float: sin recorte ni dither (conserva overs para masterizar después).
    for (size_t i = 0; i < count; ++i) {
      float x = block[i];
      if (!std::isfinite(x)) x = 0.f;
      if (std::fwrite(&x, sizeof(float), 1, f) != 1) return false;
    }
    return std::ferror(f) == 0;
  }
  auto randUnit = []() {
    return static_cast<float>(std::rand()) / static_cast<float>(RAND_MAX);
  };
  const float lsb = bits == 24 ? (1.f / 8388608.f) : (1.f / 32768.f);
  for (size_t i = 0; i < count; ++i) {
    float x = block[i];
    if (x < -1.f) x = -1.f;
    if (x > 1.f) x = 1.f;
    x += (randUnit() + randUnit() - 1.f) * lsb;
    if (x < -1.f) x = -1.f;
    if (x > 1.f) x = 1.f;
    if (bits == 24) {
      const int v = static_cast<int>(x * 8388607.f);
      const unsigned char b3[3] = {static_cast<unsigned char>(v & 255),
                                   static_cast<unsigned char>((v >> 8) & 255),
                                   static_cast<unsigned char>((v >> 16) & 255)};
      if (std::fwrite(b3, 1, 3, f) != 3) return false;
    } else {
      const int16_t s = x < 0 ? static_cast<int16_t>(x * 32768.f) : static_cast<int16_t>(x * 32767.f);
      const uint16_t u = static_cast<uint16_t>(s);
      const unsigned char b2[2] = {static_cast<unsigned char>(u & 255), static_cast<unsigned char>((u >> 8) & 255)};
      if (std::fwrite(b2, 1, 2, f) != 2) return false;
    }
  }
  return std::ferror(f) == 0;
}

/** Cierra el WAV de streaming y parchea los tamaños reales en la cabecera. */
static bool finalizeOfflineWav(FILE* f, uint32_t sampleRate, uint16_t bits, uint32_t frames) {
  if (!f) return false;
  const uint16_t numCh = 2;
  const uint16_t blockAlign = static_cast<uint16_t>(numCh * (bits / 8));
  const uint32_t dataSize = frames * blockAlign;
  auto patch32 = [&](long offset, uint32_t v) {
    if (std::fseek(f, offset, SEEK_SET) != 0) return false;
    unsigned char b[4] = {static_cast<unsigned char>(v & 255), static_cast<unsigned char>((v >> 8) & 255),
                          static_cast<unsigned char>((v >> 16) & 255), static_cast<unsigned char>((v >> 24) & 255)};
    return std::fwrite(b, 1, 4, f) == 4;
  };
  const bool ok = patch32(4, 36 + dataSize) && patch32(40, dataSize);
  std::fflush(f);
  std::fclose(f);
  return ok;
}

/** Cierra los WAV de stems; con `finalize` parchea cabeceras, si no borra los parciales. */
static bool closeOfflineStems(bool finalize) {
  bool ok = true;
  for (auto& st : gOfflineStems) {
    if (!st.file) continue;
    if (finalize) {
      ok = finalizeOfflineWav(st.file, gOfflineSampleRate, gOfflineBits, gOfflineFramesWritten) && ok;
    } else {
      std::fclose(st.file);
      removeFileUtf8(st.path);
    }
    st.file = nullptr;
  }
  gOfflineStems.clear();
  return ok;
}

/** Abre un WAV por stem a partir de "stemIndex|ruta;stemIndex|ruta". Cadena vacía = sin stems. */
static bool openOfflineStems(const std::string& spec, bool preFader, std::string& err) {
  closeOfflineStems(false);
  size_t pos = 0;
  while (pos < spec.size()) {
    size_t end = spec.find(';', pos);
    if (end == std::string::npos) end = spec.size();
    const std::string item = spec.substr(pos, end - pos);
    pos = end + 1;
    if (item.empty()) continue;
    const size_t bar = item.find('|');
    if (bar == std::string::npos || bar == 0 || bar + 1 >= item.size()) {
      err = "stemOuts inválido: " + item;
      closeOfflineStems(false);
      return false;
    }
    int idx = 0;
    try {
      idx = std::stoi(item.substr(0, bar));
    } catch (...) {
      idx = -1;
    }
    if (idx < 0 || idx >= kMaxGraphTracks || gOfflineStems.size() >= kMaxOfflineStems) {
      err = "stemOuts: índice de stem fuera de rango: " + item.substr(0, bar);
      closeOfflineStems(false);
      return false;
    }
    OfflineStemOut st;
    st.stemIndex = static_cast<uint16_t>(idx);
    st.path = item.substr(bar + 1);
    st.preFader = preFader;
    st.file = openFileUtf8(st.path, "wb");
    if (!st.file || !writeOfflineWavHeader(st.file, gOfflineSampleRate, gOfflineBits, gOfflineTotal)) {
      if (st.file) std::fclose(st.file);
      err = "No se pudo crear el stem: " + st.path;
      closeOfflineStems(false);
      return false;
    }
    gOfflineStems.push_back(std::move(st));
  }
  return true;
}

/**
 * Tras renderMix: escribe el bloque de cada stem. Post-fader = salida de la pista con fader, paneo,
 * mute, PDC y lo que le llega por envíos (un bus de retorno incluye su reverb); pre-fader = salida
 * de la cadena de inserts antes del fader. Sin grafo nativo el stem queda en silencio.
 */
static bool writeOfflineStemsBlock(uint32_t frames) {
  if (gOfflineStems.empty()) return true;
  static std::vector<float> inter;
  inter.assign(static_cast<size_t>(frames) * 2u, 0.f);
  const bool useGraph = gGraphActive.load(std::memory_order_acquire);
  const int idx = gRtBuf.load(std::memory_order_acquire);
  for (auto& st : gOfflineStems) {
    std::fill(inter.begin(), inter.end(), 0.f);
    if (useGraph) {
      const float* l = nullptr;
      const float* r = nullptr;
      if (st.preFader) {
        for (uint8_t t = 0; t < gRtTrackCount[idx] && t < kMaxGraphTracks; ++t) {
          if (gRtTracks[idx][t].stemIndex == st.stemIndex) {
            l = gPreL[t];
            r = gPreR[t];
            break;
          }
        }
      } else {
        l = gStemAccL[st.stemIndex];
        r = gStemAccR[st.stemIndex];
      }
      if (l && r) {
        for (uint32_t i = 0; i < frames; ++i) {
          inter[i * 2] = l[i];
          inter[i * 2 + 1] = r[i];
        }
      }
    }
    if (!writeOfflinePcmBlock(st.file, inter.data(), inter.size(), gOfflineBits)) return false;
  }
  return true;
}

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

/**
 * Seguridad del máster (modo Directo, K3): limitador true-peak conmutable que sustituye al soft-clip cuando
 * está activo. Solo monitorización: en un bounce no entra (el render no debe depender del ajuste de directo).
 */
static jaswave::MasterTruePeakLimiter gMasterLimiter;
static std::atomic<bool> gMasterSafety{false};
static std::atomic<float> gMeterMasterLimiterGain{1.f};
static uint32_t gMasterLimiterSr = 0;
static bool gMasterSafetyWasOn = false;

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

static float channelPeakAbs(const float* x, int frames) {
  float p = 0.f;
  for (int i = 0; i < frames; ++i) {
    const float a = std::fabs(x[i]);
    if (a > p) p = a;
  }
  return p > 1.f ? 1.f : p;
}

/** Actualiza el pico combinado y los picos L/R del stem (VU estéreo del mixer). */
static void meterUpdateStem(int si, const float* l, const float* r, int frames) {
  if (si < 0 || si >= kMaxGraphTracks) return;
  const float pl = channelPeakAbs(l, frames);
  const float pr = channelPeakAbs(r, frames);
  meterUpdatePeak(gMeterStemPeak[si], pl > pr ? pl : pr);
  meterUpdatePeak(gMeterStemPeakL[si], pl);
  meterUpdatePeak(gMeterStemPeakR[si], pr);
  if (gStemTapActivo[si].load(std::memory_order_relaxed)) gStemTaps[si].push(l, r, frames > 8192 ? 8192 : frames);
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
  uint16_t parentStem{kSinPadre};
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
    out.parentStem = tr.parentStem;
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
  // Orden topológico (Kahn): arista hija → carpeta y origen → bus de cada envío. Lo que quede en un
  // ciclo se procesa al final en el orden recibido y sus aristas «hacia atrás» caen al master (como antes).
  {
    uint8_t* stemChain = gRtStemChain[write];
    std::fill(stemChain, stemChain + kMaxGraphTracks, static_cast<uint8_t>(0xFF));
    for (uint8_t t = 0; t < tn; ++t) {
      const uint16_t st = gRtTracks[write][t].stemIndex;
      if (st < kMaxGraphTracks) stemChain[st] = t;
    }
    auto destinoDe = [&](uint16_t stem) -> int {
      return stem < kMaxGraphTracks && stemChain[stem] != 0xFF ? stemChain[stem] : -1;
    };
    int grado[kMaxGraphTracks]{};
    for (uint8_t t = 0; t < tn; ++t) {
      const RtTrackChain& c = gRtTracks[write][t];
      const int p = destinoDe(c.parentStem);
      if (p >= 0 && p != t) ++grado[p];
      for (uint8_t s = 0; s < c.sendCount; ++s) {
        const int d = destinoDe(c.sends[s].destStem);
        if (d >= 0 && d != t) ++grado[d];
      }
    }
    bool puesto[kMaxGraphTracks]{};
    uint8_t n = 0;
    for (bool avanzo = true; avanzo && n < tn;) {
      avanzo = false;
      for (uint8_t t = 0; t < tn; ++t) {
        if (puesto[t] || grado[t] > 0) continue;
        puesto[t] = true;
        gRtOrder[write][n++] = t;
        avanzo = true;
        const RtTrackChain& c = gRtTracks[write][t];
        const int p = destinoDe(c.parentStem);
        if (p >= 0 && p != t) --grado[p];
        for (uint8_t s = 0; s < c.sendCount; ++s) {
          const int d = destinoDe(c.sends[s].destStem);
          if (d >= 0 && d != t) --grado[d];
        }
      }
    }
    for (uint8_t t = 0; t < tn; ++t) {
      if (!puesto[t]) gRtOrder[write][n++] = t;
    }
    for (uint8_t k = 0; k < tn; ++k) gRtRank[write][gRtOrder[write][k]] = k;
  }

  // PDC por ruta: llegada A(t) = máx. llegada de sus entradas (hijas) + latencia propia. Cada hija se
  // retrasa hasta la llegada más tardía de su carpeta y cada pista raíz hasta la más tardía del master.
  // Los envíos no cuentan (como antes: se toman tras el PDC de su pista).
  {
    int lat[kMaxGraphTracks]{};
    int entrada[kMaxGraphTracks]{};
    int llegada[kMaxGraphTracks]{};
    for (uint8_t t = 0; t < tn; ++t) {
      RtTrackChain& out = gRtTracks[write][t];
      for (uint8_t s = 0; s < out.slotCount; ++s) {
        const RtChainSlot& cs = out.slots[s];
        if (cs.bypass || !cs.slot) continue;
        lat[t] += std::max(0, cs.slot->latencySamples());
      }
    }
    auto padreValido = [&](uint8_t t) -> int {
      const uint16_t ps = gRtTracks[write][t].parentStem;
      if (ps >= kMaxGraphTracks) return -1;
      const uint8_t p = gRtStemChain[write][ps];
      return (p != 0xFF && p != t && gRtRank[write][p] > gRtRank[write][t]) ? p : -1;
    };
    int maxRaiz = 0;
    for (uint8_t k = 0; k < tn; ++k) {
      const uint8_t t = gRtOrder[write][k];
      llegada[t] = entrada[t] + lat[t];
      const int p = padreValido(t);
      if (p >= 0) entrada[p] = std::max(entrada[p], llegada[t]);
      else maxRaiz = std::max(maxRaiz, llegada[t]);
    }
    for (uint8_t t = 0; t < tn; ++t) {
      const int p = padreValido(t);
      const int objetivo = p >= 0 ? entrada[p] : maxRaiz;
      gRtTracks[write][t].delaySamples =
          static_cast<uint16_t>(std::min(kMaxPdc - 1, std::max(0, objetivo - llegada[t])));
    }
    gRtMaxDelay[write] = static_cast<uint16_t>(std::min(kMaxPdc - 1, maxRaiz));
  }
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

#ifdef _WIN32
/** Despierta el hilo principal (lo usa el driver ASIO y miniaudio). */
void jaswave_host_wake_main_thread() {
  if (gMainThreadId == 0) return;
  PostThreadMessageW(gMainThreadId, WM_JASWAVE_JOB, 0, 0);
}
#endif

/**
 * U6: el driver ASIO puede pedir reinicio (reset / cambio de buffer / resync).
 * Se reinicializa con el mismo dispositivo fuera del callback del driver.
 */
static void checkPendingAudioReset() {
#ifdef _WIN32
  if (!jaswave_asio_reset_pending()) return;
  jaswave_asio_clear_reset_pending();
  const auto st = jaswave_audio_status();
  if (!st.running) return;
  std::string err;
  if (!jaswave_audio_start(st.cfg, err)) {
    std::cerr << "[jaswave-plugin-host] device-lost: " << err << "\n";
  } else {
    std::cerr << "[jaswave-plugin-host] audio-device-reset aplicado\n";
  }
#else
  (void)0;
#endif
}

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

static void mixSidechainForTrack(uint8_t destT, int idx, uint8_t trackN, int frames) {
  std::fill(gScMixL, gScMixL + frames, 0.f);
  std::fill(gScMixR, gScMixR + frames, 0.f);
  const RtTrackChain& tr = gRtTracks[idx][destT];
  if (tr.sidechainCount == 0 || frames <= 0) return;
  uint16_t stemToChain[kMaxGraphTracks];
  for (uint8_t i = 0; i < kMaxGraphTracks; ++i) stemToChain[i] = 0xFFFF;
  for (uint8_t ti = 0; ti < trackN && ti < kMaxGraphTracks; ++ti) {
    stemToChain[gRtTracks[idx][ti].stemIndex] = ti;
  }
  for (uint8_t sc = 0; sc < tr.sidechainCount; ++sc) {
    const RtSidechain& side = tr.sidechains[sc];
    const uint16_t srcT =
        side.srcStem < kMaxGraphTracks ? stemToChain[side.srcStem] : 0xFFFF;
    if (srcT == 0xFFFF || srcT >= trackN) continue;
    // Origen ya procesado en este bloque (antes en el orden topológico): su salida actual; si no, la anterior.
    const bool yaProcesado = gRtRank[idx][srcT] < gRtRank[idx][destT];
    const float* sl = yaProcesado ? gPostL[srcT] : gPrevPostL[srcT];
    const float* sr = yaProcesado ? gPostR[srcT] : gPrevPostR[srcT];
    for (int i = 0; i < frames; ++i) {
      gScMixL[i] += sl[i] * side.amount;
      gScMixR[i] += sr[i] * side.amount;
    }
  }
}

static void renderMix(float* interleaved, uint32_t frameCount) {
  const int frames = static_cast<int>(std::min<uint32_t>(frameCount, 8192));
  if (frames <= 0) return;
  if (gHardStop.load(std::memory_order_acquire) && !gOfflineRunning) {
    std::fill(interleaved, interleaved + static_cast<size_t>(frames) * 2u, 0.f);
    return;
  }
  if (!gOfflineRunning) applyLiveMidiFromWinmm(frames);
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
      std::fill(gInL[t], gInL[t] + frames, 0.f);
      std::fill(gInR[t], gInR[t] + frames, 0.f);
    }
    // Suma a destino: si el destino aún no se procesó (va después en el orden topológico) entra por su
    // cadena (FX de la carpeta / del bus); si no (ciclo), va directo al master como antes.
    auto sumarHacia = [&](uint16_t destStem, uint8_t origenT, const float* l, const float* r, float k) {
      if (destStem >= kMaxGraphTracks) return false;
      const uint8_t d = gRtStemChain[idx][destStem];
      if (d == 0xFF || d == origenT) return false;
      if (gRtRank[idx][d] > gRtRank[idx][origenT]) {
        for (int i = 0; i < frames; ++i) {
          gInL[destStem][i] += l[i] * k;
          gInR[destStem][i] += r[i] * k;
        }
      } else {
        for (int i = 0; i < frames; ++i) {
          gMixL[i] += l[i] * k;
          gMixR[i] += r[i] * k;
        }
      }
      return true;
    };
    for (uint8_t k = 0; k < trackN && k < kMaxGraphTracks; ++k) {
      const uint8_t t = gRtOrder[idx][k];
      const RtTrackChain& tr = gRtTracks[idx][t];
      // Motor único: clip_player nativo (live y offline) + lo que llega por el grafo (hijas, envíos).
      std::memset(gStemInterleaved, 0, static_cast<size_t>(frames) * 2 * sizeof(float));
      jaswave::clip_render_stem(tr.stemIndex, gStemInterleaved, static_cast<uint32_t>(frames));
      const bool conEntrada = tr.stemIndex < kMaxGraphTracks;
      for (int i = 0; i < frames; ++i) {
        gChainL[i] = gStemInterleaved[i * 2] + (conEntrada ? gInL[tr.stemIndex][i] : 0.f);
        gChainR[i] = gStemInterleaved[i * 2 + 1] + (conEntrada ? gInR[tr.stemIndex][i] : 0.f);
      }
      // Capas: todos los instrumentos de la pista suenan en paralelo y su suma entra a TODA la cadena de
      // FX, esté donde esté el instrumento en la lista (antes uno puesto tras un FX se lo saltaba).
      for (uint8_t s = 0; s < tr.slotCount; ++s) {
        const RtChainSlot& cs = tr.slots[s];
        HostedSlot* slot = cs.slot;
        if (!cs.instrument || cs.bypass || !slot || !slot->isPrepared()) continue;
        slot->process(nullptr, nullptr, gFxL, gFxR, frames);
        applyInstrumentTrim(gFxL, gFxR, frames);
        for (int i = 0; i < frames; ++i) {
          gChainL[i] += gFxL[i];
          gChainR[i] += gFxR[i];
        }
      }
      for (uint8_t s = 0; s < tr.slotCount; ++s) {
        const RtChainSlot& cs = tr.slots[s];
        HostedSlot* slot = cs.slot;
        if (!slot || !slot->isPrepared()) continue;
        if (cs.bypass) continue;
        if (cs.instrument) {
          continue;
        } else {
          if (slot->hasSidechainInput() && tr.sidechainCount > 0) {
            mixSidechainForTrack(t, idx, trackN, frames);
            slot->setSidechainInput(gScMixL, gScMixR, frames);
          } else {
            slot->clearSidechainInput();
          }
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
        meterUpdateStem(static_cast<int>(tr.stemIndex), gChainL, gChainR, frames);
      }
      std::memcpy(gPostL[t], gChainL, static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(gPostR[t], gChainR, static_cast<size_t>(frames) * sizeof(float));
      if (tr.stemIndex < kMaxGraphTracks) {
        std::memcpy(gStemAccL[tr.stemIndex], gChainL, static_cast<size_t>(frames) * sizeof(float));
        std::memcpy(gStemAccR[tr.stemIndex], gChainR, static_cast<size_t>(frames) * sizeof(float));
      }
      // Salida: a su carpeta-bus o al master.
      if (!sumarHacia(tr.parentStem, t, gChainL, gChainR, 1.f)) {
        for (int i = 0; i < frames; ++i) {
          gMixL[i] += gChainL[i];
          gMixR[i] += gChainR[i];
        }
      }
      // Envíos: entran por la cadena del bus destino (su reverb/delay los procesa).
      for (uint8_t s = 0; s < tr.sendCount; ++s) {
        const RtSend& sn = tr.sends[s];
        if (sn.amount <= 0.f) continue;
        sumarHacia(sn.destStem, t, sn.preFader ? gPreL[t] : gPostL[t], sn.preFader ? gPreR[t] : gPostR[t],
                   sn.amount);
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
    const uint8_t masterN = gRtMasterCount[idx];
    for (uint8_t s = 0; s < masterN; ++s) {
      const RtChainSlot& cs = gRtMaster[idx][s];
      HostedSlot* slot = cs.slot;
      if (!slot || !slot->isPrepared() || cs.bypass) continue;
      slot->process(gMixL, gMixR, gFxL, gFxR, frames);
      std::memcpy(gMixL, gFxL, static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(gMixR, gFxR, static_cast<size_t>(frames) * sizeof(float));
    }
    for (uint8_t t = 0; t < trackN && t < kMaxGraphTracks; ++t) {
      std::memcpy(gPrevPostL[t], gPostL[t], static_cast<size_t>(frames) * sizeof(float));
      std::memcpy(gPrevPostR[t], gPostR[t], static_cast<size_t>(frames) * sizeof(float));
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
        meterUpdateStem(meterStemFromSlotId(snapshotSlotId[s]), gTmpL, gTmpR, frames);
      }
      for (int i = 0; i < frames; ++i) {
        gMixL[i] += gTmpL[i];
        gMixR[i] += gTmpR[i];
      }
    }
    jaswave::clip_render_mix(gMixL, gMixR, static_cast<uint32_t>(frames));
  }

  const bool transparent = gOfflineRunning && gOfflineTransparentMaster.load(std::memory_order_relaxed);
  const float masterG = (gMasterMuted.load(std::memory_order_relaxed)
                            ? 0.f
                            : gMasterGain.load(std::memory_order_relaxed)) * (transparent ? 1.f : 1.35f);
  // Pan del master: ley de potencia constante, 0 dB al centro (como el pan por pista).
  const float masterPan = std::max(-1.f, std::min(1.f, gMasterPan.load(std::memory_order_relaxed)));
  const float panAng = (masterPan + 1.f) * 0.78539816339f;
  const float panL = std::cos(panAng) * 1.41421356237f;
  const float panR = std::sin(panAng) * 1.41421356237f;
  // Seguridad del máster (limitador true-peak) en lugar del soft-clip; nunca dentro de un bounce.
  const bool safety = !gOfflineRunning && gMasterSafety.load(std::memory_order_relaxed);
  const bool rawMaster = transparent || safety;
  for (int i = 0; i < frames; ++i) {
    const float l = gMixL[i] * masterG * panL;
    const float r = gMixR[i] * masterG * panR;
    interleaved[i * 2 + 0] = rawMaster ? l : softLimitSample(l);
    interleaved[i * 2 + 1] = rawMaster ? r : softLimitSample(r);
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
      const float l = interleaved[i * 2 + 0] + gTmpL[i];
      const float r = interleaved[i * 2 + 1] + gTmpR[i];
      interleaved[i * 2 + 0] = safety ? l : softLimitSample(l);
      interleaved[i * 2 + 1] = safety ? r : softLimitSample(r);
    }
  }
  if (safety) {
    const uint32_t srNow = static_cast<uint32_t>(currentSampleRate());
    if (srNow != gMasterLimiterSr || !gMasterSafetyWasOn) {
      gMasterLimiter.setSampleRate(static_cast<double>(srNow));
      gMasterLimiter.reset();
      gMasterLimiterSr = srNow;
    }
    gMasterLimiter.process(interleaved, frames);
    gMeterMasterLimiterGain.store(gMasterLimiter.lastBlockMinGain(), std::memory_order_relaxed);
  } else {
    gMeterMasterLimiterGain.store(1.f, std::memory_order_relaxed);
  }
  gMasterSafetyWasOn = safety;
  // El metrónomo es solo de monitorización: nunca entra en un bounce.
  if (!gOfflineRunning) jaswave::metronome_render(interleaved, static_cast<uint32_t>(frames));
  {
    float mp = 0.f;
    for (int i = 0; i < frames; ++i) {
      const float a = std::fabs(interleaved[i * 2]);
      const float b = std::fabs(interleaved[i * 2 + 1]);
      if (a > mp) mp = a;
      if (b > mp) mp = b;
    }
    meterUpdatePeak(gMeterMasterPeak, mp > 1.f ? 1.f : mp);
    // Medición completa del master (post-fader, post-limitador, con metrónomo: lo que sale al dispositivo)
    float pl = 0.f, pr = 0.f;
    double sl = 0.0, sr2 = 0.0, slr = 0.0;
    for (int i = 0; i < frames; ++i) {
      const float l = interleaved[i * 2], r = interleaved[i * 2 + 1];
      pl = std::max(pl, std::fabs(l));
      pr = std::max(pr, std::fabs(r));
      sl += static_cast<double>(l) * l;
      sr2 += static_cast<double>(r) * r;
      slr += static_cast<double>(l) * r;
    }
    meterUpdatePeak(gMeterMasterPeakL, pl > 1.f ? 1.f : pl);
    meterUpdatePeak(gMeterMasterPeakR, pr > 1.f ? 1.f : pr);
    const float n = frames > 0 ? static_cast<float>(frames) : 1.f;
    const float rmsL = std::sqrt(static_cast<float>(sl) / n), rmsR = std::sqrt(static_cast<float>(sr2) / n);
    gMeterMasterRmsL.store(rmsL, std::memory_order_relaxed);
    gMeterMasterRmsR.store(rmsR, std::memory_order_relaxed);
    const double den = std::sqrt(sl * sr2);
    const float corrBlock = den > 1e-12 ? static_cast<float>(slr / den) : 1.f;
    const float corrPrev = gMeterMasterCorr.load(std::memory_order_relaxed);
    gMeterMasterCorr.store(corrPrev + (corrBlock - corrPrev) * 0.2f, std::memory_order_relaxed);
    const uint32_t srNow = static_cast<uint32_t>(currentSampleRate());
    if (srNow != gMasterLoudnessSr) {
      gMasterLoudness.prepare(static_cast<double>(srNow));
      gMasterLoudnessSr = srNow;
    }
    if (gMasterLoudnessReset.exchange(false, std::memory_order_relaxed)) gMasterLoudness.reset();
    for (int i = 0; i < frames; ++i) gMasterLoudness.processSample(interleaved[i * 2], interleaved[i * 2 + 1]);
    {
      const int m = frames > 8192 ? 8192 : frames;
      for (int i = 0; i < m; ++i) { gMasterTapL[i] = interleaved[i * 2]; gMasterTapR[i] = interleaved[i * 2 + 1]; }
      gMasterTap.push(gMasterTapL, gMasterTapR, m);
    }
  }
  // Volumen de monitorización: solo lo que va al dispositivo (los medidores y el bounce ya quedaron arriba).
  if (!gOfflineRunning) {
    const float mg = gMonitorMuted.load(std::memory_order_relaxed) ? 0.f : gMonitorGain.load(std::memory_order_relaxed);
    if (mg != 1.f) {
      for (int i = 0; i < frames * 2; ++i) interleaved[i] *= mg;
    }
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
    EnsureAudio,
    GetState,  // getPluginState: IComponent::getState en el hilo UI (JUCE/Kontakt/BFD lo exigen)
    SetState,  // setPluginState
    PinEditor,   // pinEditor: ancla/desancla (TOPMOST) la ventana del editor de un slot
    RepinAll,    // reaplica el orden por índice de los editores anclados
    PinsVisible, // setPinsVisible: oculta/muestra los anclados (app minimizada)
    HardStop     // hardStop: vacía el DSP de todos los slots (stop del transporte)
  } kind{};
  std::string json;
  std::string err;
  std::string extraJson;
  bool ok{false};
  bool replyWhenDone{true};
  long long rid{-1};  // id de la petición que responde este job (ver tReplyRid)
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

// ── Pin de editores: slotId → índice (0 = el de más arriba). Solo se toca desde el hilo UI. ──────────
static std::map<std::string, int> gPins;
static bool gPinsVisible = true;

/** Reaplica el apilado de los anclados: del índice más alto al 0, cada uno sube a la cima de la banda
 *  TOPMOST sin activarse; el último (índice 0) queda encima de todos. Los no anclados quedan debajo. */
static void reapplyPins() {
  std::vector<std::pair<int, std::string>> orden;
  for (const auto& [id, idx] : gPins) orden.emplace_back(idx, id);
  std::sort(orden.begin(), orden.end(), [](const auto& a, const auto& b) {
    return a.first != b.first ? a.first > b.first : a.second > b.second;
  });
  std::lock_guard<std::mutex> lock(gSlotsMutex);
  for (const auto& [idx, id] : orden) {
    (void)idx;
    if (auto* slot = findSlotUnlocked(id)) slot->raiseEditorPinned();
  }
}

static bool gRepinQueued = false;  // desduplica avisos de activación (hilo UI)

static void enqueueUiAsync(UiJob::Kind kind, const std::string& json, bool replyWhenDone);

/** Hook de vst3_slot.cpp: un editor anclado se activó → reaplicar el orden en el siguiente turno. */
static void onPinnedEditorActivated() {
  if (gRepinQueued) return;
  gRepinQueued = true;
  enqueueUiAsync(UiJob::Kind::RepinAll, "{}", false);
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
    << ",\"engineOwned\":" << (jaswave_audio_engine_owned() ? "true" : "false")
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
  // Sin la reserva del motor no se suspenden los slots: el fallo sería seguro pero inútil.
  if (!jaswave_audio_engine_acquire(err)) return false;
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
  // Otra salida WASAPI pedida explícitamente: se reabre (antes se ignoraba y el audio seguía en la anterior).
  const bool sameSharedDevice =cfg.deviceId.empty() || cfg.deviceId == "default" || cfg.deviceId == st.cfg.deviceId;
  if (haveSharedWasapi && wantSharedWasapi && sameSharedDevice) {
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
    // El arranque falló: los slots ya estaban suspendidos (setActive(false)); sin reactivarlos quedaban
    // mudos y, en el siguiente reprepare, "de fábrica". Se reactivan (reprepare reaplica el estado guardado).
    for (auto* slot : toSuspend) {
      std::string perr;
      if (!slot->reprepare(currentSampleRate(), static_cast<int32_t>(currentBlockSize()), perr)) {
        std::cerr << "[jaswave-plugin-host] reprepare tras fallo de dispositivo: " << perr << "\n";
      }
    }
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
  // Solo VST3: cargar una .dll VST2 (u otra) ejecutaría su DllMain dentro del proceso del host.
  {
    std::string ext = std::filesystem::path(expanded).extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (ext != ".vst3") {
      err = "Formato no soportado (solo .vst3): " + expanded;
      return false;
    }
  }
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
    // embedded: popup alineado al panel del DAW (x/y/w/h en píxeles físicos de pantalla).
    if (getBoolField(json, "embedded", false) && slot->supportsEmbeddedEditor()) {
      if (!slot->openEditorEmbedded(x, y, w, h, err)) {
        job.ok = false;
        job.err = err;
        return;
      }
      gActiveSlot = slotId;
      job.ok = true;
      return;
    }
    slot->setEditorTitle(getStringField(json, "title"));
    // Pin: si este slot está anclado, la ventana nace TOPMOST (sobrevive a cerrar/reabrir el editor).
    slot->setEditorPinned(gPins.count(slotId) > 0);
    if (!slot->openEditor(parent, x, y, w, h, err)) {
      job.ok = false;
      job.err = err;
      return;
    }
    gActiveSlot = slotId;
    if (!gPins.empty()) reapplyPins();
    job.ok = true;
    return;
  }

  if (job.kind == UiJob::Kind::PinEditor) {
    const bool pinned = getBoolField(json, "pinned", true);
    const int index = std::max(0, static_cast<int>(getNumberField(json, "index", 0)));
    bool hasEditor = false;
    bool topmost = false;
    std::uintptr_t hwnd = 0;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      auto* slot = findSlotUnlocked(slotId);
      if (pinned) {
        gPins[slotId] = index;
        if (slot) slot->setEditorPinned(true);
      } else {
        gPins.erase(slotId);
        if (slot) slot->setEditorPinned(false);
      }
      if (slot) {
        hasEditor = slot->hasEditor();
        hwnd = slot->editorHwnd();
      }
    }
    // El orden de los anclados depende de todos los índices: por defecto se reaplica entero. Con
    // reorder:false + raise:true solo sube este (main intercala editores y paneles Electron en secuencia).
    if (pinned && gPinsVisible) {
      if (getBoolField(json, "reorder", true)) {
        reapplyPins();
      } else if (getBoolField(json, "raise", false)) {
        std::lock_guard<std::mutex> lock(gSlotsMutex);
        if (auto* slot = findSlotUnlocked(slotId)) slot->raiseEditorPinned();
      }
    }
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      if (auto* slot = findSlotUnlocked(slotId)) topmost = slot->editorTopmost();
    }
    job.ok = true;
    job.extraJson = "\"slotId\":\"" + jsonEscape(slotId) + "\",\"pinned\":" + (pinned ? "true" : "false") +
                    ",\"index\":" + std::to_string(index) + ",\"hasEditor\":" + (hasEditor ? "true" : "false") +
                    ",\"topmost\":" + (topmost ? "true" : "false") + ",\"hwnd\":\"" + std::to_string(hwnd) + "\"";
    return;
  }

  if (job.kind == UiJob::Kind::RepinAll) {
    gRepinQueued = false;
    if (gPinsVisible) reapplyPins();
    job.ok = true;
    return;
  }

  if (job.kind == UiJob::Kind::PinsVisible) {
    gPinsVisible = getBoolField(json, "visible", true);
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      for (const auto& [id, idx] : gPins) {
        (void)idx;
        if (auto* slot = findSlotUnlocked(id)) slot->setEditorPinVisible(gPinsVisible);
      }
    }
    if (gPinsVisible) reapplyPins();
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
    if (getBoolField(json, "embedded", false))
      slot->setEmbeddedBounds(x, y, w, h, getBoolField(json, "visible", true), getBoolField(json, "raise", false));
    else
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

  if (job.kind == UiJob::Kind::GetState || job.kind == UiJob::Kind::SetState) {
    // Estado de plugin en el hilo UI (los VST3 basados en JUCE/Kontakt/BFD asumen hilo principal).
    if (slotId.empty()) slotId = gActiveSlot;
    std::vector<uint8_t> bytes;
    if (job.kind == UiJob::Kind::SetState) {
      const std::string b64 = getStringField(json, "stateBase64");
      if (b64.empty() || !decodeBase64(b64, bytes) || bytes.empty()) {
        job.ok = false;
        job.err = "stateBase64 inválido";
        return;
      }
    }
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    auto* slot = findSlotUnlocked(slotId);
    if (!slot) {
      job.ok = false;
      job.err = "slot no cargado: " + slotId;
      return;
    }
    std::string err;
    if (job.kind == UiJob::Kind::GetState) {
      if (!slot->getStateChunk(bytes, err)) {
        job.ok = false;
        job.err = err;
        return;
      }
      job.extraJson = "\"slotId\":\"" + jsonEscape(slotId) + "\",\"stateBytes\":" +
                      std::to_string(bytes.size()) + ",\"stateBase64\":\"" +
                      jsonEscape(encodeBase64(bytes.data(), bytes.size())) + "\"";
    } else {
      if (!slot->setStateChunk(bytes.data(), bytes.size(), err)) {
        job.ok = false;
        job.err = err;
        return;
      }
      job.extraJson = "\"slotId\":\"" + jsonEscape(slotId) + "\",\"stateBytes\":" + std::to_string(bytes.size());
    }
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
      gPins.erase(slotId);  // slot descargado: el pin desaparece con él
      if (doomed) {
        clearSlotPointersInGraph(doomed.get());
        // Sin compactar: cada índice conserva su zona; el hilo de audio salta los destinos vacíos.
        for (int i = 0; i < kLiveMidiMax; ++i) {
          if (gLiveMidiSlots[i].load(std::memory_order_acquire) == doomed.get()) {
            gLiveMidiSlots[i].store(nullptr, std::memory_order_release);
          }
        }
        gLiveZoneGen.fetch_add(1, std::memory_order_acq_rel);
      }
    }
    if (doomed) doomed->unload();
    job.ok = true;
    job.extraJson = "\"slotId\":\"" + jsonEscape(slotId) + "\"";
    return;
  }

  if (job.kind == UiJob::Kind::HardStop) {
    // Se recogen los slots bajo el mutex y se vacían fuera de él (setActive puede tardar en samplers grandes).
    std::vector<HostedSlot*> slots;
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      for (auto& [id, slot] : gSlots) {
        (void)id;
        if (slot) slots.push_back(slot.get());
      }
    }
    for (auto* s : slots) s->flushDsp();
    clearHostDelayLines();
    gHardStop.store(false, std::memory_order_release);
    job.ok = true;
    job.extraJson = "\"flushed\":" + std::to_string(slots.size());
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
  job->rid = replyWhenDone ? tReplyRid : -1;
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
  // Se responde desde el hilo UI: restaurar el id de la petición original.
  struct RidScope {
    long long prev;
    explicit RidScope(long long rid) : prev(tReplyRid) { tReplyRid = rid; }
    ~RidScope() { tReplyRid = prev; }
  } ridScope(job->rid);
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
    if (job->kind == UiJob::Kind::GetState) code = (job->err.rfind("slot no cargado", 0) == 0) ? "PluginNotFound" : "NoChunk";
    else if (job->kind == UiJob::Kind::SetState) code = (job->err.rfind("slot no cargado", 0) == 0) ? "PluginNotFound" : "SetChunkFailed";
    else if (job->kind == UiJob::Kind::SetDevice) code = "AudioDeviceFailed";
    else if (job->kind == UiJob::Kind::ListDevices) code = "HostNotReady";
    // Otra instancia tiene el motor de audio: código propio para que la app no caiga a WASAPI ni reinicie.
    if (job->err.rfind("AudioEngineBusy", 0) == 0) code = "AudioEngineBusy";
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
  job->rid = tReplyRid;
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

static void handleLineImpl(const std::string& line);

static void handleLine(const std::string& line) {
  if (line.empty()) return;
  // "rid" (opcional): el puente lo usa para emparejar respuestas; sin él se responde como antes.
  const double rid = getNumberField(line, "rid", -1);
  tReplyRid = rid >= 0 ? static_cast<long long>(rid) : -1;
  handleLineImpl(line);
  tReplyRid = -1;
}

static void handleLineImpl(const std::string& line) {
  const std::string type = getStringField(line, "type");
  if (type == "ping") {
    std::string extra = std::string("\"ridEcho\":true,\"latencySamples\":0,\"editorReady\":") +
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
    // Los campos globales se leen de la cabecera (antes de "targets"): los objetos de zona repiten nombres.
    const size_t posTargets = line.find("\"targets\"");
    const std::string head = posTargets == std::string::npos ? line : line.substr(0, posTargets);
    const int ch = static_cast<int>(getNumberField(head, "channel", -1));
    gLiveMidiChannel.store(ch < 0 ? -1 : ch, std::memory_order_relaxed);
    parseEatCsv(getStringField(head, "eatCcs"), &gLiveEatCcLo, &gLiveEatCcHi);
    parseEatCsv(getStringField(head, "eatNotes"), &gLiveEatNoteLo, &gLiveEatNoteHi);

    // Forma nueva: "targets":[{slotId, deviceId?, channel?, lo, hi, transpose, velCurve, velScale, velFixed?, outChannel?}]
    // Forma anterior (compatible): "slotIds":"a,b" + "deviceIds":"winmm:0,all" → zona completa por slot.
    struct Destino {
      std::string slotId;
      std::string deviceId;
      LiveZoneCfg zona;
    };
    std::vector<Destino> destinos;
    forEachJsonObjectIn(line, "targets", [&](const std::string& obj) {
      Destino d;
      d.slotId = getStringField(obj, "slotId");
      d.deviceId = getStringField(obj, "deviceId");
      d.zona.lo = std::clamp(static_cast<int>(getNumberField(obj, "lo", 0)), 0, 127);
      d.zona.hi = std::clamp(static_cast<int>(getNumberField(obj, "hi", 127)), 0, 127);
      if (d.zona.lo > d.zona.hi) std::swap(d.zona.lo, d.zona.hi);
      d.zona.transpose = std::clamp(static_cast<int>(getNumberField(obj, "transpose", 0)), -60, 60);
      d.zona.velCurve = liveVelCurveFromName(getStringField(obj, "velCurve"));
      d.zona.velScale = std::clamp(static_cast<float>(getNumberField(obj, "velScale", 1.0)), 0.f, 4.f);
      d.zona.velFixed = std::clamp(static_cast<int>(getNumberField(obj, "velFixed", 100)), 1, 127);
      const int inCh = static_cast<int>(getNumberField(obj, "channel", -1));
      d.zona.inChannel = inCh >= 0 && inCh < 16 ? inCh : -1;
      const int outCh = static_cast<int>(getNumberField(obj, "outChannel", -1));
      d.zona.outChannel = outCh >= 0 && outCh < 16 ? outCh : -1;
      destinos.push_back(std::move(d));
    });
    if (destinos.empty()) {
      const std::vector<std::string> slotList = splitCsv(getStringField(head, "slotIds"));
      const std::vector<std::string> deviceList = splitCsv(getStringField(head, "deviceIds"));
      for (size_t i = 0; i < slotList.size(); ++i) {
        Destino d;
        d.slotId = slotList[i];
        d.deviceId = i < deviceList.size() ? deviceList[i] : "";
        destinos.push_back(std::move(d));
      }
    }

    const int nb = (gLiveZoneBuf.load(std::memory_order_acquire) + 1) & 1;
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    int n = 0;
    for (size_t i = 0; i < destinos.size() && n < kLiveMidiMax; ++i) {
      auto* s = findSlotUnlocked(destinos[i].slotId);
      if (!s) continue;
      gLiveZones[nb][n] = destinos[i].zona;
      gLiveMidiPort[n].store(parseWinmmPortId(destinos[i].deviceId), std::memory_order_release);
      gLiveMidiSlots[n].store(s, std::memory_order_release);
      ++n;
    }
    for (int i = n; i < kLiveMidiMax; ++i) {
      gLiveZones[nb][i] = LiveZoneCfg{};
      gLiveMidiSlots[i].store(nullptr, std::memory_order_release);
      gLiveMidiPort[i].store(-1, std::memory_order_release);
    }
    gLiveZoneBuf.store(nb, std::memory_order_release);
    gLiveMidiCount.store(n, std::memory_order_release);
    gLiveZoneGen.fetch_add(1, std::memory_order_acq_rel);
#endif
    return;
  }
  if (type == "setMasterSafety") {
#if defined(JASWAVE_HAS_VST3_SDK)
    gMasterLimiter.setCeilingDb(static_cast<float>(getNumberField(line, "ceilingDb", -0.5)));
    gMasterSafety.store(getBoolField(line, "enabled", false), std::memory_order_relaxed);
#endif
    return;  // fire-and-forget, como setMonitorMix
  }
  if (type == "panic") {
    // PANIC del modo Directo: descarta el MIDI pendiente del teclado, olvida las notas en curso y apaga todo.
#if defined(JASWAVE_HAS_VST3_SDK)
    gLivePanic.store(true, std::memory_order_release);
    std::lock_guard<std::mutex> lock(gSlotsMutex);
    for (auto& [id, slot] : gSlots) {
      (void)id;
      if (slot) slot->allNotesOff();
    }
#endif
    return;  // sin respuesta, como allNotesOff
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
  if (type == "setMonitorMix") {
    const float g = static_cast<float>(getNumberField(line, "gain", 1));
    gMonitorGain.store(std::max(0.f, std::min(2.f, g)), std::memory_order_relaxed);
    gMonitorMuted.store(getBoolField(line, "muted", false), std::memory_order_relaxed);
    return;  // fire-and-forget
  }
  if (type == "setSlotMix" || type == "setMasterMix") {
#if defined(JASWAVE_HAS_VST3_SDK)
    if (type == "setMasterMix") {
      const float g = static_cast<float>(getNumberField(line, "gain", 1));
      gMasterGain.store(std::max(0.f, std::min(4.f, g)), std::memory_order_relaxed);
      gMasterMuted.store(getBoolField(line, "muted", false), std::memory_order_relaxed);
      const float mpan = static_cast<float>(getNumberField(line, "pan", 0));
      gMasterPan.store(std::max(-1.f, std::min(1.f, mpan)), std::memory_order_relaxed);
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
    // Durante la preparación del bounce el grafo no se toca. Con el render ya en marcha sí se acepta: la automatización
    // de volumen y paneo lo republica y `renderOfflineStep` y este mensaje se procesan en el mismo hilo, uno tras otro.
    // Rechazarlo hacía una ida y vuelta inútil por bloque (8–11 veces más lento) y dejaba la automatización sin aplicar.
    if (gOfflineActive.load() && gOfflineSetup.load()) {
      replyFail("RenderBusy", "Hay un bounce en curso: no se puede cambiar el grafo");
      return;
    }
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
    // rfind: un track final sin slots termina en "|" y find("||") cortaba dentro de ese track.
    size_t masterSep = enc.rfind("||");
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
            // Opcional `~padre` (stem de la carpeta-bus; vacío o -1 = master).
            const size_t t4 = t3 == std::string::npos ? std::string::npos : seg.find('~', t3 + 1);
            const bool conPadre = t4 != std::string::npos && t4 < firstBar;
            if (t3 != std::string::npos && t3 < firstBar)
              tc.muted = seg.substr(t3 + 1, (conPadre ? t4 : firstBar) - t3 - 1) == "1";
            if (conPadre) {
              const std::string ps = seg.substr(t4 + 1, firstBar - t4 - 1);
              const int pv = ps.empty() ? -1 : std::stoi(ps);
              tc.parentStem = (pv >= 0 && pv < kMaxGraphTracks) ? static_cast<uint16_t>(pv) : kSinPadre;
            }
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
  if (type == "hardStop") {
    // Stop del transporte: silencio inmediato (el siguiente bloque ya sale vacío) y reinicio del DSP de cada
    // plugin en el hilo UI. Durante un bounce no se toca nada.
#if defined(JASWAVE_HAS_VST3_SDK)
    if (gOfflineActive.load()) {
      replyFail("RenderBusy", "Hay un bounce en curso");
      return;
    }
    gHardStop.store(true, std::memory_order_release);
    jaswave::clip_stop_all_scheduled();
    enqueueUiAsync(UiJob::Kind::HardStop, line, true);
#else
    replyOk();
#endif
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
    // Durante un bounce el transporte no se toca: el render comparte el reloj.
    if (gOfflineActive.load()) {
      replyFail("RenderBusy", "Hay un bounce en curso: no se puede mover el transporte");
      return;
    }
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
      std::vector<float> pcm;
      if (!decodeF32Base64(b64, pcm) ||
          pcm.size() < static_cast<size_t>(frames) * std::max(1u, channels)) {
        replyFail("BadRequest", "pcmBase64 corto");
        return;
      }
      ok = jaswave::clip_load_pcm(clipId, pcm.data(), frames, channels, sr, err);
    }
    if (!ok) {
      replyFail("ClipLoadFailed", err.empty() ? "clip.load falló" : err);
      return;
    }
    replyOk("\"clipId\":\"" + jsonEscape(clipId) + "\"");
    return;
  }
  // Subida por trozos para clips largos: begin -> chunk* -> end (cada mensaje es pequeno).
  if (type == "clip.loadBegin") {
    const std::string clipId = getStringField(line, "clipId");
    std::string err;
    if (!jaswave::clip_load_begin(clipId, static_cast<uint32_t>(getNumberField(line, "frames", 0)),
                                  static_cast<uint32_t>(getNumberField(line, "channels", 2)),
                                  static_cast<uint32_t>(getNumberField(line, "sampleRate", currentSampleRate())),
                                  err)) {
      replyFail("ClipLoadFailed", err);
      return;
    }
    replyOk("\"clipId\":\"" + jsonEscape(clipId) + "\"");
    return;
  }
  if (type == "clip.loadChunk") {
    const std::string clipId = getStringField(line, "clipId");
    const uint32_t offset = static_cast<uint32_t>(getNumberField(line, "offsetFrames", 0));
    const uint32_t frames = static_cast<uint32_t>(getNumberField(line, "frames", 0));
    std::vector<float> pcm;
    std::string err;
    if (!decodeF32Base64(getStringField(line, "pcmBase64"), pcm)) {
      jaswave::clip_load_abort(clipId);
      replyFail("BadRequest", "pcmBase64 invalido");
      return;
    }
    // El host conoce los canales de la subida (loadBegin): valida que el trozo traiga frames*channels floats.
    if (!jaswave::clip_load_chunk(clipId, offset, pcm.data(), pcm.size(), frames, err)) {
      replyFail("ClipLoadFailed", err);
      return;
    }
    replyOk();
    return;
  }
  if (type == "clip.loadEnd") {
    const std::string clipId = getStringField(line, "clipId");
    std::string err;
    if (!jaswave::clip_load_end(clipId, err)) {
      replyFail("ClipLoadFailed", err);
      return;
    }
    replyOk("\"clipId\":\"" + jsonEscape(clipId) + "\"");
    return;
  }
  if (type == "clip.has") {
    const std::string clipId = getStringField(line, "clipId");
    uint32_t frames = 0, sr = 0;
    const bool has = jaswave::clip_has(clipId, frames, sr);
    replyOk(std::string("\"loaded\":") + (has ? "true" : "false") + ",\"frames\":" + std::to_string(frames) +
            ",\"sampleRate\":" + std::to_string(sr));
    return;
  }
  if (type == "clip.schedule") {
    // Durante el bounce no se programan clips, salvo en la ventana de
    // preparación (la app programa los clips del bounce tras arrancar el render).
    if (gOfflineActive.load() && !gOfflineSetup.load()) {
      replyFail("RenderBusy", "Hay un bounce en curso: no se pueden programar clips");
      return;
    }
    const std::string clipId = getStringField(line, "clipId");
    const uint16_t trackIndex = static_cast<uint16_t>(getNumberField(line, "trackIndex", 0));
    const int64_t startSample = static_cast<int64_t>(getNumberField(line, "startSample", 0));
    const int64_t durationSamples = static_cast<int64_t>(getNumberField(line, "durationSamples", 0));
    const int64_t sourceOffset = static_cast<int64_t>(getNumberField(line, "sourceOffsetSamples", 0));
    const float gain = static_cast<float>(getNumberField(line, "gain", 1.0));
    const float pan = static_cast<float>(getNumberField(line, "pan", 0.0));
    jaswave::ClipFades fades;
    fades.clipStartSample = static_cast<int64_t>(getNumberField(line, "clipStartSample", static_cast<double>(startSample)));
    fades.clipEndSample = static_cast<int64_t>(
        getNumberField(line, "clipEndSample", static_cast<double>(startSample + durationSamples)));
    fades.inSamples = std::max<int64_t>(0, static_cast<int64_t>(getNumberField(line, "fadeInSamples", 0)));
    fades.outSamples = std::max<int64_t>(0, static_cast<int64_t>(getNumberField(line, "fadeOutSamples", 0)));
    fades.inCurve = static_cast<int>(getNumberField(line, "fadeInCurve", 0));
    fades.outCurve = static_cast<int>(getNumberField(line, "fadeOutCurve", 0));
    fades.reverse = getBoolField(line, "reverse", false);
    fades.regionStart = static_cast<int64_t>(getNumberField(line, "regionStartSample", 0));
    fades.regionLen = static_cast<int64_t>(getNumberField(line, "regionLenSamples", 0));
    jaswave::clip_schedule(clipId, trackIndex, startSample, durationSamples, sourceOffset, gain, pan, fades);
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
    // Hilo UI + respuesta asíncrona (no bloquea stdin/MIDI mientras un sampler pesado serializa su estado).
    enqueueUiAsync(UiJob::Kind::GetState, line, true);
    return;
  }
  if (type == "setPluginState") {
    enqueueUiAsync(UiJob::Kind::SetState, line, true);
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
  if (type == "pinEditor") {
    // {slotId, pinned, index}: ancla (TOPMOST) el editor flotante; index 0 = el de más arriba entre anclados.
    handleUiRpc(UiJob::Kind::PinEditor, line);
    return;
  }
  if (type == "setPinsVisible") {
    // {visible}: política con la app minimizada: los anclados se ocultan y vuelven al restaurar.
    enqueueUiAsync(UiJob::Kind::PinsVisible, line, false);
    replyOk();
    return;
  }
  if (type == "listAudioDevices") {
    handleUiRpc(UiJob::Kind::ListDevices, line);
    return;
  }
  if (type == "setAudioDevice") {
    // Durante un bounce el dispositivo no se cambia: el render comparte el reloj.
    if (gOfflineActive.load()) {
      replyFail("RenderBusy", "Hay un bounce en curso: no se puede cambiar el dispositivo");
      return;
    }
    handleUiRpc(UiJob::Kind::SetDevice, line);
    return;
  }
  if (type == "getAudioDevice") {
    handleUiRpc(UiJob::Kind::GetDevice, line);
    return;
  }
  if (type == "acquireAudioEngine") {
    // Reserva del motor de audio de la sesión antes de abrir dispositivo (una sola instancia suena).
    std::string err;
    if (!jaswave_audio_engine_acquire(err)) {
      replyFail("AudioEngineBusy", err);
      return;
    }
    replyOk("\"engineOwned\":true");
    return;
  }
  if (type == "requestAudioEngine") {
    // "Usar audio aquí": pide al host dueño (otra instancia) que ceda el motor; luego se reintenta la reserva.
    if (jaswave_audio_engine_owned()) {
      replyOk("\"engineOwned\":true");
      return;
    }
    if (!jaswave_audio_engine_request_release()) {
      replyFail("AudioEngineBusy", "no se pudo avisar a la otra instancia");
      return;
    }
    replyOk("\"requested\":true");
    return;
  }
  if (type == "releaseAudioEngine") {
    // Cede el motor: se para el dispositivo y se suelta la reserva; los plugins siguen cargados.
    if (gOfflineActive.load()) {
      replyFail("RenderBusy", "Hay un bounce en curso: el motor no se puede ceder ahora");
      return;
    }
    jaswave_audio_set_renderer(nullptr);
    jaswave_audio_engine_release();
    jaswave_audio_set_renderer(renderMix);
    replyOk("\"engineOwned\":false");
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
  if (type == "getOpenEditors") {
    // Editores con ventana abierta (flotante o embebida): la UI los muestra para poder tener varios a la vez.
    std::ostringstream js;
    js << "\"editors\":[";
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      bool first = true;
      for (auto& [id, slot] : gSlots) {
        if (!slot || !slot->hasEditor()) continue;
        if (!first) js << ",";
        first = false;
        js << "{\"slot\":\"" << jsonEscape(id) << "\",\"embedded\":" << (slot->editorEmbedded() ? "true" : "false") << ",\"pinned\":" << (slot->editorPinned() ? "true" : "false") << "}";
      }
    }
    js << "]";
    replyOk(js.str());
    return;
  }
  if (type == "getSlotStats") {
    // Carga por slot para el watchdog de cuarentena (V5 §2.4). load = tiempo de process() / duración del bloque.
    const bool reset = getBoolField(line, "reset", false);
    std::ostringstream js;
    js << "\"slots\":[";
    {
      std::lock_guard<std::mutex> lock(gSlotsMutex);
      bool first = true;
      for (auto& [id, slot] : gSlots) {
        if (!slot) continue;
        const HostedSlot::Stats st = slot->stats();
        if (!first) js << ",";
        first = false;
        js << "{\"slot\":\"" << jsonEscape(id) << "\",\"path\":\"" << jsonEscape(slot->path()) << "\""
           << ",\"blocks\":" << st.blocks << ",\"avgLoad\":" << st.avgLoad << ",\"maxLoad\":" << st.maxLoad
           << ",\"overruns\":" << st.overruns << ",\"exceptions\":" << st.exceptions
           << ",\"bypassed\":" << (slot->isBypassed() ? "true" : "false") << "}";
        if (reset) slot->resetStats();
      }
    }
    js << "]";
    replyOk(js.str());
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
  if (type == "getMasterSpectrum") {
    // FFT de 8192 puntos del master (misma balística que los plugins), en columnas log 20 Hz..20 kHz (dBFS).
    static JasWaveDsp::SpectrumAnalyzer analyzer;
    static auto last = std::chrono::steady_clock::now();
    const auto now = std::chrono::steady_clock::now();
    const float dt = std::chrono::duration<float>(now - last).count();
    last = now;
    const int count = static_cast<int>(std::max(8.0, std::min(256.0, getNumberField(line, "count", 96))));
    analyzer.updateBalistica(gMasterTap, currentSampleRate(), dt, 14.0f);
    std::vector<float> cols;
    analyzer.columns(cols, count, 20.0, 20000.0, 0.0);
    std::ostringstream js;
    js << "\"columns\":[";
    for (size_t i = 0; i < cols.size(); ++i) {
      char nb[24];
      std::snprintf(nb, sizeof(nb), "%s%.1f", i ? "," : "", static_cast<double>(cols[i] < -140.f ? -140.f : cols[i]));
      js << nb;
    }
    js << "]";
    replyOk(js.str());
    return;
  }
  if (type == "getStemSpectrum") {
    // Igual que getMasterSpectrum pero de la salida post-fader de un stem. Cada stem tiene su tap y su
    // analizador: varias tiras pueden mostrar su espectro a la vez. {index, release:true} apaga ese tap;
    // index < 0 los apaga todos.
    struct EstadoEspectroStem {
      std::unique_ptr<JasWaveDsp::SpectrumAnalyzer> analyzer;
      std::chrono::steady_clock::time_point last{};
    };
    static EstadoEspectroStem estados[kMaxGraphTracks];
    const auto now = std::chrono::steady_clock::now();
    // Taps abandonados (tira cerrada sin avisar, renderer recargado): dejan de costar en el hilo de audio.
    for (int i = 0; i < kMaxGraphTracks; ++i) {
      if (gStemTapActivo[i].load(std::memory_order_relaxed) && now - estados[i].last > std::chrono::seconds(2)) {
        gStemTapActivo[i].store(false, std::memory_order_relaxed);
      }
    }
    const int index = static_cast<int>(getNumberField(line, "index", -1));
    if (index < 0 || index >= kMaxGraphTracks) {
      for (auto& a : gStemTapActivo) a.store(false, std::memory_order_relaxed);
      replyOk();
      return;
    }
    auto& est = estados[index];
    if (getBoolField(line, "release", false)) {
      gStemTapActivo[index].store(false, std::memory_order_relaxed);
      replyOk();
      return;
    }
    if (!est.analyzer) est.analyzer = std::make_unique<JasWaveDsp::SpectrumAnalyzer>();
    if (!gStemTapActivo[index].exchange(true, std::memory_order_relaxed)) {
      est.analyzer->reset();
      est.last = now;
    }
    const float dt = std::chrono::duration<float>(now - est.last).count();
    est.last = now;
    const int count = static_cast<int>(std::max(8.0, std::min(256.0, getNumberField(line, "count", 48))));
    auto& analyzer = *est.analyzer;
    analyzer.updateBalistica(gStemTaps[index], currentSampleRate(), dt, 14.0f);
    std::vector<float> cols;
    analyzer.columns(cols, count, 20.0, 20000.0, 0.0);
    std::ostringstream js;
    js << "\"index\":" << index << ",\"columns\":[";
    for (size_t i = 0; i < cols.size(); ++i) {
      char nb[24];
      std::snprintf(nb, sizeof(nb), "%s%.1f", i ? "," : "", static_cast<double>(cols[i] < -140.f ? -140.f : cols[i]));
      js << nb;
    }
    js << "]";
    replyOk(js.str());
    return;
  }
  if (type == "resetMasterLoudness") {
    gMasterLoudnessReset.store(true, std::memory_order_relaxed);
    replyOk();
    return;
  }
  if (type == "getMixMeters") {
    std::ostringstream js;
    js << "\"masterPeak\":";
    appendJsonFloat(js, gMeterMasterPeak.load(std::memory_order_relaxed));
    js << ",\"masterPeakL\":";
    appendJsonFloat(js, gMeterMasterPeakL.load(std::memory_order_relaxed));
    js << ",\"masterPeakR\":";
    appendJsonFloat(js, gMeterMasterPeakR.load(std::memory_order_relaxed));
    js << ",\"masterRmsL\":";
    appendJsonFloat(js, gMeterMasterRmsL.load(std::memory_order_relaxed));
    js << ",\"masterRmsR\":";
    appendJsonFloat(js, gMeterMasterRmsR.load(std::memory_order_relaxed));
    {
      char nb[160];
      std::snprintf(nb, sizeof(nb), ",\"masterCorrelation\":%.4f,\"lufsMomentary\":%.2f,\"lufsShort\":%.2f,\"lufsIntegrated\":%.2f",
                    static_cast<double>(gMeterMasterCorr.load(std::memory_order_relaxed)),
                    static_cast<double>(gMasterLoudness.momentary.load(std::memory_order_relaxed)),
                    static_cast<double>(gMasterLoudness.shortTerm.load(std::memory_order_relaxed)),
                    static_cast<double>(gMasterLoudness.integrated.load(std::memory_order_relaxed)));
      js << nb;
      // Seguridad del máster: ganancia mínima del último bloque (1 = sin actuar) y si está activa.
      std::snprintf(nb, sizeof(nb), ",\"masterSafety\":%s,\"masterLimiterGain\":%.4f",
                    gMasterSafety.load(std::memory_order_relaxed) ? "true" : "false",
                    static_cast<double>(gMeterMasterLimiterGain.load(std::memory_order_relaxed)));
      js << nb;
    }
    js << ",\"tracks\":[";
    const int idx = gRtBuf.load(std::memory_order_acquire);
    const uint8_t trackN = gRtTrackCount[idx];
    bool first = true;
    auto emitStem = [&](uint16_t si) {
      if (!first) js << ',';
      first = false;
      js << "{\"index\":" << si << ",\"peak\":";
      appendJsonFloat(js, gMeterStemPeak[si].load(std::memory_order_relaxed));
      js << ",\"peakL\":";
      appendJsonFloat(js, gMeterStemPeakL[si].load(std::memory_order_relaxed));
      js << ",\"peakR\":";
      appendJsonFloat(js, gMeterStemPeakR[si].load(std::memory_order_relaxed));
      js << ",\"sidechainPeak\":";
      appendJsonFloat(js, gMeterSidechainPeak[si].load(std::memory_order_relaxed));
      js << '}';
    };
    if (trackN > 0) {
      for (uint8_t t = 0; t < trackN && t < kMaxGraphTracks; ++t) {
        uint16_t si = gRtTracks[idx][t].stemIndex;
        if (si >= kMaxGraphTracks) si = t;
        emitStem(si);
      }
    } else {
      // Graph aún no publicado: devolver picos por índice lineal (layout Web Audio).
      for (uint16_t si = 0; si < 16; ++si) emitStem(si);
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
    const double bits = getNumberField(line, "bitDepth", 16);
    gOfflineBits = bits >= 32 ? 32u : bits >= 24 ? 24u : 16u;
    gOfflineTransparentMaster.store(getBoolField(line, "transparentMaster", false));
    const double sr = getNumberField(line, "sampleRate", currentSampleRate());
    gOfflineSampleRate = sr >= 8000 ? static_cast<uint32_t>(sr) : static_cast<uint32_t>(currentSampleRate());
    // Streaming a disco: se abre el WAV y se escribe la cabecera por adelantado.
    // Los tamaños se parchean al terminar con los frames realmente escritos.
    if (gOfflineFile) {
      std::fclose(gOfflineFile);
      gOfflineFile = nullptr;
    }
    gOfflineFile = openFileUtf8(gOfflineOutPath, "wb");
    if (!gOfflineFile) {
      replyFail("RenderWriteFailed", "No se pudo abrir outPath");
      return;
    }
    gOfflineFramesWritten = 0;
    if (!writeOfflineWavHeader(gOfflineFile, gOfflineSampleRate, gOfflineBits, gOfflineTotal)) {
      std::fclose(gOfflineFile);
      gOfflineFile = nullptr;
      removeFileUtf8(gOfflineOutPath);
      replyFail("RenderWriteFailed", "No se pudo escribir la cabecera WAV");
      return;
    }
    // stemOuts: "stemIndex|ruta;stemIndex|ruta…" — un WAV por pista/bus en la misma pasada.
    std::string stemErr;
    if (!openOfflineStems(getStringField(line, "stemOuts"), getStringField(line, "stemTap") == "pre", stemErr)) {
      std::fclose(gOfflineFile);
      gOfflineFile = nullptr;
      removeFileUtf8(gOfflineOutPath);
      replyFail("RenderWriteFailed", stemErr);
      return;
    }
    gOfflineRunning = true;
    gOfflineActive.store(true);
    gOfflineSetup.store(true);
    jaswave::transport_clock_seek_samples(0);
    jaswave::transport_clock_set_playing(true);
    jaswave::clip_stop_all_scheduled();
    jaswave_audio_set_renderer(nullptr);
    jaswave_mix_bus_set_offline(true);
    jaswave_mix_bus_reset();
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
    std::vector<float> block(static_cast<size_t>(frames) * 2u, 0.f);
    renderMix(block.data(), frames);
    // A partir del primer bloque ya no se admiten cambios en la línea de tiempo.
    gOfflineSetup.store(false);
    // El PCM se escribe a disco: no se acumula en RAM (renders largos).
    if (!writeOfflinePcmBlock(gOfflineFile, block.data(), block.size(), gOfflineBits) ||
        !writeOfflineStemsBlock(frames)) {
      gOfflineRunning = false;
      gOfflineActive.store(false);
      gOfflineSetup.store(false);
      if (gOfflineFile) {
        std::fclose(gOfflineFile);
        gOfflineFile = nullptr;
      }
      // Se borra el WAV parcial: no es utilizable.
      if (!gOfflineOutPath.empty()) removeFileUtf8(gOfflineOutPath);
      closeOfflineStems(false);
      jaswave_mix_bus_set_offline(false);
      jaswave_audio_set_renderer(renderMix);
      replyFail("RenderWriteFailed", "No se pudo escribir en outPath");
      return;
    }
    gOfflineFramesWritten += frames;
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
    // Solo se borra el archivo si queda un WAV parcial abierto: un bounce ya
    // finalizado no se debe eliminar.
    const bool parcial = gOfflineFile != nullptr;
    gOfflineRunning = false;
    gOfflineActive.store(false);
    gOfflineSetup.store(false);
    gOfflinePcm.clear();
    if (gOfflineFile) {
      std::fclose(gOfflineFile);
      gOfflineFile = nullptr;
    }
    if (parcial && !gOfflineOutPath.empty()) removeFileUtf8(gOfflineOutPath);
    closeOfflineStems(false);
    gOfflineTransparentMaster.store(false);
    jaswave::transport_clock_set_playing(false);
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
    auto writeFail = [&](const std::string& msg) {
      gOfflineRunning = false;
      gOfflineActive.store(false);
      gOfflineSetup.store(false);
      gOfflinePcm.clear();
      if (gOfflineFile) {
        std::fclose(gOfflineFile);
        gOfflineFile = nullptr;
      }
      closeOfflineStems(false);
      gOfflineTransparentMaster.store(false);
      jaswave_mix_bus_set_offline(false);
      jaswave_audio_set_renderer(renderMix);
      replyFail("RenderWriteFailed", msg);
    };
    if (gOfflineCancel.load()) {
      gOfflineRunning = false;
      gOfflineActive.store(false);
    gOfflineSetup.store(false);
      gOfflinePcm.clear();
      if (gOfflineFile) {
        std::fclose(gOfflineFile);
        gOfflineFile = nullptr;
      }
      if (!gOfflineOutPath.empty()) removeFileUtf8(gOfflineOutPath);
      closeOfflineStems(false);
      gOfflineTransparentMaster.store(false);
      jaswave::transport_clock_set_playing(false);
      jaswave_mix_bus_set_offline(false);
      jaswave_audio_set_renderer(renderMix);
      replyOk("\"cancelled\":true");
      return;
    }
    const uint32_t frames = gOfflineFramesWritten;
    const uint32_t sr = gOfflineSampleRate;
    if (!gOfflineFile) {
      writeFail("No se pudo abrir outPath");
      return;
    }
    if (!finalizeOfflineWav(gOfflineFile, sr, gOfflineBits, frames)) {
      gOfflineFile = nullptr;
      writeFail("No se pudo escribir el WAV");
      return;
    }
    gOfflineFile = nullptr;
    const std::string path = gOfflineOutPath;
    std::string stemsJson = "[";
    for (size_t i = 0; i < gOfflineStems.size(); ++i) {
      if (i) stemsJson += ",";
      stemsJson += "{\"stemIndex\":" + std::to_string(gOfflineStems[i].stemIndex) + ",\"path\":\"" +
                   jsonEscape(gOfflineStems[i].path) + "\"}";
    }
    stemsJson += "]";
    const bool stemsOk = closeOfflineStems(true);
    gOfflineRunning = false;
    gOfflineActive.store(false);
    gOfflineSetup.store(false);
    gOfflinePcm.clear();
    gOfflineTransparentMaster.store(false);
    jaswave::transport_clock_set_playing(false);
    jaswave_mix_bus_set_offline(false);
    jaswave_audio_set_renderer(renderMix);
    if (!stemsOk) {
      replyFail("RenderWriteFailed", "La mezcla se escribió, pero no se pudieron cerrar los stems");
      return;
    }
    replyOk("\"path\":\"" + jsonEscape(path) + "\",\"frames\":" + std::to_string(frames) +
            ",\"sampleRate\":" + std::to_string(sr) + ",\"bitDepth\":" + std::to_string(gOfflineBits) +
            ",\"stems\":" + stemsJson);
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
  vst3SetPinActivatedHook(&onPinnedEditorActivated);
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
  // Otra instancia pide el motor: lo decide la app (para el transporte antes de soltar).
  jaswave_audio_engine_on_release_request([] {
    std::fprintf(stderr, "JW_ENGINE_RELEASE_REQUEST\n");
    std::fflush(stderr);
  });
  MSG pumpInit{};
  PeekMessageW(&pumpInit, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
#endif
#endif

  std::atomic<bool> running{true};
#ifdef _WIN32
  const DWORD mainThreadId = GetCurrentThreadId();
  // Barra espaciadora con el foco en la ventana de un plugin = Play/Stop del DAW (como en el resto de la app).
  // Se consume (el plugin no la ve) salvo en campos de texto del propio plugin, donde se escribe un espacio.
  auto esEspacioDeTransporte = [](const MSG& m) -> bool {
    if (m.message != WM_KEYDOWN && m.message != WM_KEYUP) return false;
    if (m.wParam != VK_SPACE) return false;
    if (GetKeyState(VK_CONTROL) < 0 || GetKeyState(VK_MENU) < 0 || GetKeyState(VK_SHIFT) < 0) return false;
    wchar_t clase[64]{};
    GetClassNameW(m.hwnd, clase, 63);
    if (wcsstr(clase, L"Edit") || wcsstr(clase, L"EDIT") || wcsstr(clase, L"RichEdit")) return false;
    // Solo al pulsar (sin autorepetición); el keyup se consume para que el plugin no reciba medio evento.
    if (m.message == WM_KEYDOWN && (m.lParam & (1 << 30)) == 0) {
      std::fprintf(stderr, "JW_TRANSPORT_TOGGLE\n");
      std::fflush(stderr);
    }
    return true;
  };
#endif
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
    // WM_QUIT debe ir a la cola del hilo principal (PostQuitMessage lo enviaría a la de este hilo).
    PostThreadMessageW(mainThreadId, WM_QUIT, 0, 0);
#endif
  });
#ifdef _WIN32
  MSG msg;
  while (running) {
#if defined(JASWAVE_HAS_VST3_SDK)
    drainUiQueue();
#endif
    checkPendingAudioReset();
    const BOOL gm = GetMessageW(&msg, nullptr, 0, 0);
    if (gm <= 0) {
      running = false;
      break;
    }
    if (msg.message != WM_JASWAVE_JOB && !esEspacioDeTransporte(msg)) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
#if defined(JASWAVE_HAS_VST3_SDK)
    drainUiQueue();
#endif
    checkPendingAudioReset();
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
  // Sin esto el std::thread de MIDI sigue unible al salir y std::terminate mata el proceso (0xC0000409).
  jaswave_midi_close_all();
#ifdef _WIN32
  OleUninitialize();
#endif
  return 0;
}
