// jw_sampler.h — motor de samples compartido por los instrumentos JasWave (formato de banco .jws, ver
// plugins/samples/tools/sfz2jws.py). Sin dependencias del SDK VST3: solo C++17.
//
// Reglas de tiempo real: noteOn/noteOff/render no reservan memoria ni bloquean. El banco se carga en un hilo
// aparte (startLoad) y se publica con un intercambio atómico; mientras no esté listo, ready() es falso y el
// instrumento sigue sonando con su motor modelado.
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace JwSampler {

struct Zone {
    uint8_t lokey{0}, hikey{127}, root{60}, lovel{0}, hivel{127}, rrIndex{0}, rrCount{1}, channels{1};
    uint32_t sr{44100}, frames{0}, loopStart{0}, loopEnd{0};
    float tuneCents{0}, gainDb{0}, releaseSec{0.35f}, pan{0};
    uint64_t dataOffset{0};
    uint8_t group{0}, offBy{0}, oneShot{0};
    uint32_t xfade{0};
    float gainLin{1.f};
    /// ADITIVO (bajo/sostenidos): si > 0 y la zona tiene bucle, la voz atenúa esta cantidad de dB por segundo desde que
    /// entra al bucle (el bucle se aplanó a amplitud constante: el decaimiento lo pone el motor). 0 = sin cambio.
    float loopDecayDb{0.f};
};

struct Bank {
    std::vector<Zone> zones;
    std::vector<int16_t> pcm;
    uint32_t flags{0};
    std::string path;

    const int16_t* data(const Zone& z) const { return pcm.data() + z.dataOffset / sizeof(int16_t); }

    static std::shared_ptr<Bank> load(const std::string& path, std::string& err) {
        FILE* f = nullptr;
#ifdef _WIN32
        if (fopen_s(&f, path.c_str(), "rb") != 0) f = nullptr;
#else
        f = std::fopen(path.c_str(), "rb");
#endif
        if (!f) { err = "no se pudo abrir " + path; return nullptr; }
        struct Cierre { FILE* f; ~Cierre() { std::fclose(f); } } cierre{f};
        unsigned char cab[32];
        if (std::fread(cab, 1, 32, f) != 32 || std::memcmp(cab, "JWS1", 4) != 0) { err = "cabecera .jws no válida"; return nullptr; }
        auto u32 = [&](int o) { uint32_t v; std::memcpy(&v, cab + o, 4); return v; };
        const uint32_t ver = u32(4), n = u32(8), tam = u32(12), inicio = u32(16);
        if (ver != 1 || tam != 64 || n == 0 || n > 20000) { err = "versión o tabla de zonas no válida"; return nullptr; }
        auto b = std::make_shared<Bank>();
        b->path = path;
        b->flags = u32(20);
        b->zones.resize(n);
        std::vector<unsigned char> tabla(static_cast<size_t>(n) * 64);
        if (std::fread(tabla.data(), 1, tabla.size(), f) != tabla.size()) { err = "tabla de zonas truncada"; return nullptr; }
        for (uint32_t i = 0; i < n; ++i) {
            const unsigned char* r = tabla.data() + static_cast<size_t>(i) * 64;
            Zone& z = b->zones[i];
            z.lokey = r[0]; z.hikey = r[1]; z.root = r[2]; z.lovel = r[3]; z.hivel = r[4];
            z.rrIndex = r[5]; z.rrCount = std::max<uint8_t>(1, r[6]); z.channels = r[7] == 2 ? 2 : 1;
            std::memcpy(&z.sr, r + 8, 4); std::memcpy(&z.frames, r + 12, 4);
            std::memcpy(&z.loopStart, r + 16, 4); std::memcpy(&z.loopEnd, r + 20, 4);
            std::memcpy(&z.tuneCents, r + 24, 4); std::memcpy(&z.gainDb, r + 28, 4);
            std::memcpy(&z.releaseSec, r + 32, 4); std::memcpy(&z.pan, r + 36, 4);
            std::memcpy(&z.dataOffset, r + 40, 8);
            z.group = r[48]; z.offBy = r[49]; z.oneShot = r[50];
            std::memcpy(&z.xfade, r + 52, 4);
            z.gainLin = std::pow(10.f, z.gainDb / 20.f);
            if (z.sr < 8000 || z.sr > 192000 || z.frames < 16) { err = "zona con datos no válidos"; return nullptr; }
        }
        // El resto del archivo son los PCM; offsetDatos (en bytes) es relativo a `inicio`.
        std::fseek(f, 0, SEEK_END);
        const long total = std::ftell(f);
        if (total < static_cast<long>(inicio)) { err = "archivo truncado"; return nullptr; }
        const size_t bytes = static_cast<size_t>(total) - inicio;
        b->pcm.resize(bytes / 2);
        std::fseek(f, static_cast<long>(inicio), SEEK_SET);
        if (std::fread(b->pcm.data(), 1, bytes & ~size_t(1), f) != (bytes & ~size_t(1))) { err = "datos PCM truncados"; return nullptr; }
        for (const auto& z : b->zones) {
            if (z.dataOffset + static_cast<uint64_t>(z.frames) * z.channels * 2 > bytes) { err = "zona fuera del archivo"; return nullptr; }
        }
        return b;
    }
};

/// Carpeta de bancos: JASWAVE_SAMPLES_DIR, o %APPDATA%\JasWave\samples (Windows) / ~/.config/JasWave/samples.
inline std::string samplesDir() {
    auto env = [](const char* k) -> std::string {
#ifdef _WIN32
        char* v = nullptr; size_t len = 0;
        if (_dupenv_s(&v, &len, k) == 0 && v) { std::string s(v); std::free(v); return s; }
        return {};
#else
        const char* v = std::getenv(k); return v ? v : "";
#endif
    };
    std::string d = env("JASWAVE_SAMPLES_DIR");
    if (!d.empty()) return d;
#ifdef _WIN32
    d = env("APPDATA");
    return d.empty() ? std::string() : d + "\\JasWave\\samples";
#else
    d = env("HOME");
    return d.empty() ? std::string() : d + "/.config/JasWave/samples";
#endif
}

/// Cache por ruta: varias instancias del mismo instrumento comparten un único banco en memoria.
inline std::shared_ptr<Bank> acquireBank(const std::string& path, std::string& err) {
    static std::mutex m;
    static std::map<std::string, std::weak_ptr<Bank>> cache;
    std::lock_guard<std::mutex> lock(m);
    if (auto it = cache.find(path); it != cache.end()) {
        if (auto b = it->second.lock()) return b;
    }
    auto b = Bank::load(path, err);
    if (b) cache[path] = b;
    return b;
}

/// ADITIVO (bajo): parámetros del bucle de cola sintético (ver withTailLoops).
struct TailLoopOpts {
    float startFrac{0.52f};    // el bucle empieza hacia este punto de la muestra (fracción de su duración)
    float minLoopSec{0.42f};   // duración mínima del bucle (se redondea a un nº entero de periodos)
    float marginSec{0.15f};    // el bucle termina como mínimo a tanto del final de la muestra (evita el recorte final)
    float xfadeSec{0.06f};     // fundido del empalme del bucle
    float minDecayDb{1.5f};    // dB/s mínimos y máximos del decaimiento que se continúa tras el bucle
    float maxDecayDb{7.0f};
    float minSampleSec{1.2f};  // muestras más cortas no se bucleaban
};

/// ADITIVO (bajo/sostenidos): devuelve una COPIA PRIVADA del banco (no toca la compartida de la caché) en la que cada zona
/// mono, sin bucle y de más de `minSampleSec`, lleva un bucle de cola sintético: la parte final de la muestra (casi un
/// seno de la fundamental con su decaimiento natural) se aplana a amplitud constante, su longitud se ajusta a un nº entero
/// de periodos maximizando la correlación entre el final y el principio del bucle y el empalme se funde en equipotencia.
/// La zona recibe `loopDecayDb` (dB/s medidos en la propia cola) y el motor continúa ese decaimiento tras el bucle:
/// la nota larga se sostiene sin apagarse a los 2-5 s y sin cambio de timbre ni clic.
inline std::shared_ptr<Bank> withTailLoops(const Bank& src, const TailLoopOpts& o = {}) {
    auto b = std::make_shared<Bank>(src);
    for (auto& z : b->zones) {
        if (z.channels != 1 || z.loopEnd > z.loopStart || z.oneShot) continue;
        const double sr = z.sr;
        const double secs = static_cast<double>(z.frames) / sr;
        if (secs < o.minSampleSec) continue;
        const double f0 = 440.0 * std::pow(2.0, (static_cast<double>(z.root) - 69.0) / 12.0 + z.tuneCents / 1200.0);
        const double P = sr / f0;
        const int xf = std::clamp(static_cast<int>(std::max(o.xfadeSec * sr, 2.0 * P)), 64, static_cast<int>(0.25 * sr));
        const int F = static_cast<int>(z.frames);
        const int eMax = F - static_cast<int>(o.marginSec * sr);
        const int Lt = std::max(static_cast<int>(o.minLoopSec * sr), static_cast<int>(std::ceil(4.0 * P)));
        const int Lk = std::max(4, static_cast<int>(std::lround(Lt / P)));
        int S = std::min(static_cast<int>(o.startFrac * F), eMax - static_cast<int>(std::lround(Lk * P)) - static_cast<int>(P));
        if (S < xf + 64) continue;
        int16_t* pcm = b->pcm.data() + z.dataOffset / sizeof(int16_t);
        auto X = [&](int i) { return static_cast<double>(pcm[i]); };
        // E óptimo: alrededor de S + Lk*P (±P/2), correlación normalizada entre [E-xf, E) y [S-xf, S) (decimada x2)
        const int E0 = S + static_cast<int>(std::lround(Lk * P));
        int bestE = E0;
        double bestC = -2.0;
        for (int E = E0 - static_cast<int>(P * 0.5); E <= E0 + static_cast<int>(P * 0.5); ++E) {
            if (E > eMax || E - xf < S) continue;
            double sab = 0.0, saa = 0.0, sbb = 0.0;
            for (int k = 0; k < xf; k += 2) { const double a = X(E - xf + k), c = X(S - xf + k); sab += a * c; saa += a * a; sbb += c * c; }
            const double r = sab / std::sqrt(saa * sbb + 1e-9);
            if (r > bestC) { bestC = r; bestE = E; }
        }
        const int E = bestE;
        if (E > eMax || E - S < 2 * xf) continue;
        // decaimiento medido en la propia cola (RMS de 0,1 s al principio y al final del bucle)
        const int w = static_cast<int>(0.1 * sr);
        auto rms = [&](int a0) { double s = 0.0; for (int i = a0; i < a0 + w; ++i) s += X(i) * X(i); return std::sqrt(s / w) + 1e-9; };
        const double dtSec = static_cast<double>(E - S - w) / sr;
        double slope = dtSec > 0.05 ? 20.0 * std::log10(rms(S) / rms(E - w)) / dtSec : o.minDecayDb;
        if (!std::isfinite(slope)) slope = o.minDecayDb;
        slope = std::clamp(slope, static_cast<double>(o.minDecayDb), static_cast<double>(o.maxDecayDb));
        const double aNp = slope / 8.685889638 / sr;   // neperios por muestra
        auto g = [&](int i) { return std::exp(aNp * static_cast<double>(i - S)); };
        // 1) copia de la parte previa al empalme (para el fundido), 2) aplanado del bucle, 3) fundido del final con el principio
        std::vector<double> partner(static_cast<size_t>(xf));
        for (int k = 0; k < xf; ++k) partner[static_cast<size_t>(k)] = X(S - xf + k) * g(S - xf + k);
        for (int i = S; i < E - xf; ++i) pcm[i] = static_cast<int16_t>(std::clamp(std::lround(X(i) * g(i)), -32768L, 32767L));
        for (int k = 0; k < xf; ++k) {
            const int i = E - xf + k;
            // fundido de ganancia complementaria (cos² / sin²): el final y el principio del bucle están correlacionados
            // (mismo periodo), así que un fundido equipotencia abultaría ~3 dB en el centro del empalme
            const double wgt = (k + 1.0) / xf * 1.5707963267948966;
            const double cw = std::cos(wgt), sw = std::sin(wgt);
            const double v = X(i) * g(i) * cw * cw + partner[static_cast<size_t>(k)] * sw * sw;
            pcm[i] = static_cast<int16_t>(std::clamp(std::lround(v), -32768L, 32767L));
        }
        z.loopStart = static_cast<uint32_t>(S);
        z.loopEnd = static_cast<uint32_t>(E);
        z.loopDecayDb = static_cast<float>(slope);
    }
    return b;
}

struct Humanize {
    float gainDb{0.5f};       // ± dB aleatorios por golpe
    float detuneCents{2.0f};  // ± cents aleatorios por golpe
    float timingMs{0.6f};     // retardo aleatorio 0..N ms (nunca adelanta)
    float velCurve{0.18f};    // cuánto sube el nivel dentro de una capa con la velocidad
};

/// ADITIVO (guitarra: slides, legato, palm mute, tremolo picking): opciones por nota para `noteOnEx`. Todo a cero/valor
/// por defecto = nota normal. Los demás instrumentos no lo usan.
struct NoteOpts {
    float skipSec{0.f};        // empieza la muestra a `skipSec` del inicio (salta el ataque de la púa: nota ligada)
    float atkSec{0.f};         // ataque suave (smoothstep); 0 = ataque corto original
    float gainMul{1.f};        // ganancia extra
    float lpHz{0.f};           // paso-bajo por voz de 2 polos (0 = sin filtro): palm mute / notas muertas
    float holdSec{0.f};        // suelta sola tras `holdSec` aunque la tecla siga pulsada (0 = no)
    float holdRelSec{0.05f};   // tiempo de release (-60 dB) de esa suelta automática
    float relSec{0.f};         // si > 0, el note-off de esta voz usa este release (-60 dB) en vez del de la zona
    float glideSemis{0.f};     // desplazamiento de afinación INICIAL en semitonos que se resuelve a 0 en `glideSec`
    float glideSec{0.f};
    float glideGamma{1.f};     // forma: offset(t) = glideSemis * (1 - (t/T)^gamma)
    float extraCents{0.f};
    int delaySamples{-1};      // >= 0: sustituye al retardo aleatorio de humanización
};

/// ADITIVO (piano nota a nota): forma por voz para `noteOnShaped`. Todo a su valor por defecto = nota normal (y
/// `noteOnShaped` con una forma neutra suena IDÉNTICO a `noteOn`). Los demás instrumentos no lo usan.
struct NoteShape {
    float gainMul{1.f};          // ganancia lineal
    float cents{0.f};            // afinación fina
    float pan{0.f};              // -1..1: se suma al pan de la zona (zonas estéreo: balance)
    float shelfDb{0.f};          // shelf de agudos de 2º orden (RBJ, S = 1; +/- dB; `shelfHz` = frecuencia media): brillo/tono de la nota
    float shelfHz{1500.f};
    float bodyDb{0.f};           // campana (Q 1,2) de `bodyDb` dB en `bodyHz` (la fundamental): cuerpo
    float bodyHz{0.f};
    float decayDbPerSec{0.f};    // atenuación EXTRA en dB/s mientras la tecla está pulsada: > 0 cae antes, < 0 sostiene (la ganancia sube, tope +12 dB)
    float releaseScale{1.f};     // multiplica el release de la zona (0,1..8)
    float hammer{1.f};           // nivel del transitorio: ganancia de 1 + (hammer - 1) * exp(-t/20 ms); 0 = ataque suavizado
};

class Sampler {
public:
    ~Sampler() { join(); }

    void prepare(double sr) {
        sr_ = sr > 0 ? sr : 48000.0;
        for (auto& v : voices_) v.active = false;
    }

    /// Carga `<carpeta de samples>/<slug>.jws` en un hilo aparte. Se puede llamar varias veces.
    void startLoad(const std::string& slug) {
        join();
        const std::string dir = samplesDir();
        if (dir.empty()) return;
#ifdef _WIN32
        const std::string path = dir + "\\" + slug + ".jws";
#else
        const std::string path = dir + "/" + slug + ".jws";
#endif
        loading_.store(true);
        loader_ = std::thread([this, path] {
            std::string err;
            auto b = acquireBank(path, err);
            if (b) std::atomic_store(&bank_, b);
            else lastError_ = err;
            loading_.store(false);
        });
    }
    /// ADITIVO (bajo): como startLoad, pero publica una copia privada del banco con bucle de cola sintético (withTailLoops).
    void startLoadTailLoop(const std::string& slug, const TailLoopOpts& opts = {}) {
        join();
        const std::string dir = samplesDir();
        if (dir.empty()) return;
#ifdef _WIN32
        const std::string path = dir + "\\" + slug + ".jws";
#else
        const std::string path = dir + "/" + slug + ".jws";
#endif
        loading_.store(true);
        loader_ = std::thread([this, path, opts] {
            std::string err;
            auto b = acquireBank(path, err);
            if (b) std::atomic_store(&bank_, withTailLoops(*b, opts));
            else lastError_ = err;
            loading_.store(false);
        });
    }
    /// ADITIVO (bajo): escala el decaimiento (dB/s) que las zonas con `loopDecayDb` aplican tras entrar al bucle.
    void setLoopDecayScale(float s) { loopDecayScale_ = std::clamp(s, 0.f, 4.f); }
    void setBank(std::shared_ptr<Bank> b) { std::atomic_store(&bank_, std::move(b)); }
    bool ready() const { return std::atomic_load(&bank_) != nullptr; }
    bool loading() const { return loading_.load(); }
    const std::string& lastError() const { return lastError_; }

    void setLevelDb(float db) { level_ = std::pow(10.f, db / 20.f); }
    void setReleaseScale(float s) { relScale_ = std::clamp(s, 0.1f, 8.f); }
    void setTuneCents(float c) { tune_ = c; }
    void setHumanize(const Humanize& h) { hum_ = h; }
    void setSustain(bool down) {
        if (sustain_ == down) return;
        sustain_ = down;
        if (!down) for (auto& v : voices_) if (v.active && v.pedalHeld) { v.pedalHeld = false; if (!v.keyDown) release(v); }
    }
    void setBend(float semitones) { bend_ = std::clamp(semitones, -12.f, 12.f); }

    int activeVoices() const { int n = 0; for (const auto& v : voices_) n += v.active ? 1 : 0; return n; }

    /// ADITIVO (pads): ataque suave de `sec` segundos (curva smoothstep) para las notas NUEVAS. 0 = ataque corto
    /// original (1,5 ms), que es el valor por defecto: los instrumentos existentes no cambian.
    void setAttack(float sec) { attackSec_ = std::max(0.f, sec); }
    /// ADITIVO (pads): deriva lenta de afinación por voz, de ±`cents` a ~`hz` Hz (fase aleatoria por voz). 0 = sin deriva.
    void setDrift(float cents, float hz) { driftCents_ = std::max(0.f, cents); driftHz_ = std::clamp(hz, 0.005f, 2.f); }
    /// ADITIVO (cuerdas/coros): vibrato por voz de ±`cents` (máx. 50) a ~`hz` Hz con deriva aleatoria de la velocidad y
    /// fase inicial distinta por voz; aparece con una rampa de ~0,6 s tras el ataque y mueve además la amplitud un
    /// ~0,4 dB por cada 8 cents (como el arco real). 0 = sin vibrato (valor por defecto, comportamiento original).
    void setVibrato(float cents, float hz) { vibCents_ = std::clamp(cents, 0.f, 50.f); vibHz_ = std::clamp(hz, 0.5f, 12.f); }
    /// ADITIVO (cuerdas/coros): al llegar por primera vez al final del bucle cada voz salta (con un fundido cruzado de
    /// `fadeSec`) a una posición ALEATORIA del bucle: dos voces de la misma muestra dejan de estar en fase (sin flanger).
    void setLoopScatter(bool on, float fadeSec = 0.06f) { loopScatter_ = on; scatterFade_ = std::clamp(fadeSec, 0.01f, 0.3f); }
    /// ADITIVO (legato): como noteOnStack pero las voces EMPIEZAN dentro del bucle (sin el ataque del arco, en una
    /// posición aleatoria) con una subida de `atkSec` segundos: la nota nueva continúa el sonido sostenido.
    int noteOnStackLegato(int note, float vel01, float atkSec) {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return 0;
        if (!(vel01 > 0.f)) { noteOff(note); return 0; }
        const int vel = std::clamp(static_cast<int>(vel01 * 127.f + 0.5f), 1, 127);
        int n = 0;
        for (const auto& z : bank->zones) {
            if (note < z.lokey || note > z.hikey || vel < z.lovel || vel > z.hivel || z.rrIndex != 0) continue;
            startVoice(bank, z, note, vel01, true, atkSec);
            if (++n >= 24) break;
        }
        return n;
    }
    /// ADITIVO (legato): suelta las voces de `note` en `sec` segundos (ignora el pedal y la escala de release).
    void releaseNote(int note, float sec) {
        for (auto& v : voices_) {
            if (!v.active || v.note != note || !v.keyDown || v.releasing) continue;
            v.keyDown = false; v.pedalHeld = false; v.releasing = true;
            v.relK = 1.f - std::exp(-6.907755f / (std::max(0.01f, sec) * static_cast<float>(sr_)));
        }
    }
    /// ADITIVO: ¿hay alguna zona para esta nota/velocidad? (para decidir entre banco y motor modelado por nota)
    bool hasZone(int note, float vel01) const {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return false;
        const int vel = std::clamp(static_cast<int>(vel01 * 127.f + 0.5f), 1, 127);
        for (const auto& z : bank->zones)
            if (note >= z.lokey && note <= z.hikey && vel >= z.lovel && vel <= z.hivel) return true;
        return false;
    }
    /// ADITIVO (capas de timbre): dispara A LA VEZ todas las zonas que cubren la nota (p. ej. un banco que une
    /// cuerpo + coro + arco). Ignora round-robin (usa rrIndex 0) y grupos de corte. Devuelve cuántas voces lanzó.
    int noteOnStack(int note, float vel01) {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return 0;
        if (!(vel01 > 0.f)) { noteOff(note); return 0; }
        const int vel = std::clamp(static_cast<int>(vel01 * 127.f + 0.5f), 1, 127);
        int n = 0;
        for (const auto& z : bank->zones) {
            if (note < z.lokey || note > z.hikey || vel < z.lovel || vel > z.hivel || z.rrIndex != 0) continue;
            startVoice(bank, z, note, vel01);
            if (++n >= 24) break;
        }
        return n;
    }

    /// ADITIVO (capas de timbre seleccionables): como noteOnStack pero solo con las zonas cuyo `group` es `group`
    /// (el banco etiqueta cada capa con un grupo; en estos bancos el grupo NO se usa para cortes) y con una ganancia
    /// extra `gainMul` (mezcla de capas). `detuneCents` suma una desafinación fija a la voz (unísono). Devuelve voces lanzadas.
    int noteOnGroup(int note, float vel01, int group, float gainMul = 1.f, float detuneCents = 0.f) {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return 0;
        if (!(vel01 > 0.f)) { noteOff(note); return 0; }
        const int vel = std::clamp(static_cast<int>(vel01 * 127.f + 0.5f), 1, 127);
        int n = 0;
        for (const auto& z : bank->zones) {
            if (note < z.lokey || note > z.hikey || vel < z.lovel || vel > z.hivel || z.rrIndex != 0 || z.group != group) continue;
            startVoice(bank, z, note, vel01, true, 0.f, gainMul, detuneCents);   // true: arranca en un punto aleatorio del bucle (sin repetir el inicio)
            if (++n >= 4) break;
        }
        return n;
    }
    /// ADITIVO: ¿el banco cargado tiene alguna zona de este grupo para la nota? (selección de capa con respaldo modelado)
    bool hasGroup(int note, int group) const {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return false;
        for (const auto& z : bank->zones)
            if (note >= z.lokey && note <= z.hikey && z.group == group) return true;
        return false;
    }
    /// ADITIVO: ruta del banco cargado (vacía si no hay) y número de zonas, para informes/diagnóstico.
    int zoneCount() const { auto b = std::atomic_load(&bank_); return b ? static_cast<int>(b->zones.size()) : 0; }

    void noteOn(int note, float vel01) {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return;
        if (!(vel01 > 0.f)) { noteOff(note); return; }
        const int vel = std::clamp(static_cast<int>(vel01 * 127.f + 0.5f), 1, 127);
        const Zone* z = pick(*bank, note, vel);
        if (!z) return;
        if (z->group) for (auto& v : voices_) if (v.active && v.zone->offBy == z->group) fastKill(v);
        startVoice(bank, *z, note, vel01);
    }

    /// ADITIVO (piano nota a nota): como noteOn pero con una forma por voz (ganancia, afinación, pan, brillo, cuerpo,
    /// caída, release y martillo; ver NoteShape). Consume los mismos números aleatorios que noteOn.
    void noteOnShaped(int note, float vel01, const NoteShape& sh) {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return;
        if (!(vel01 > 0.f)) { noteOff(note); return; }
        const int vel = std::clamp(static_cast<int>(vel01 * 127.f + 0.5f), 1, 127);
        const Zone* z = pick(*bank, note, vel);
        if (!z) return;
        if (z->group) for (auto& v : voices_) if (v.active && v.zone->offBy == z->group) fastKill(v);
        startVoice(bank, *z, note, vel01, false, 0.f, sh.gainMul, sh.cents, &sh);
    }

    /// ADITIVO (guitarra): como noteOn con opciones por nota (ver NoteOpts). Devuelve true si lanzó una voz.
    bool noteOnEx(int note, float vel01, const NoteOpts& o) {
        auto bank = std::atomic_load(&bank_);
        if (!bank) return false;
        if (!(vel01 > 0.f)) { noteOff(note); return false; }
        const int vel = std::clamp(static_cast<int>(vel01 * 127.f + 0.5f), 1, 127);
        const Zone* z = pick(*bank, note, vel);
        if (!z) return false;
        if (z->group) for (auto& v : voices_) if (v.active && v.zone->offBy == z->group) fastKill(v);
        lastStarted_ = nullptr;
        startVoice(bank, *z, note, vel01, false, 0.f, o.gainMul, o.extraCents);
        Voice* v = lastStarted_;
        if (!v) return false;
        const float srf = static_cast<float>(sr_);
        if (o.skipSec > 0.f) {
            const double p = static_cast<double>(o.skipSec) * z->sr;
            if (p < static_cast<double>(z->frames) * 0.5) v->pos = p;
        }
        if (o.atkSec > 0.f) { v->attStep = 1.f / std::max(8.f, o.atkSec * srf); v->att = 0.f; }
        if (o.delaySamples >= 0) v->delay = o.delaySamples;
        if (o.lpHz > 0.f) v->lpC = 1.f - std::exp(-6.2831853f * std::min(o.lpHz, 0.45f * srf) / srf);
        if (o.holdSec > 0.f) {
            v->holdLeft = std::max(1, static_cast<int>(o.holdSec * srf));
            v->holdRelK = 1.f - std::exp(-6.907755f / (std::max(0.005f, o.holdRelSec) * srf));
        }
        if (o.relSec > 0.f) v->relKOverride = 1.f - std::exp(-6.907755f / (std::max(0.005f, o.relSec) * srf));
        if (o.glideSec > 0.f && o.glideSemis != 0.f) {
            v->gA = o.glideSemis; v->gB = -o.glideSemis; v->gLen = std::max(1, static_cast<int>(o.glideSec * srf));
            v->gPos = 0; v->gGamma = std::max(0.2f, o.glideGamma);
        }
        return true;
    }

    /// ADITIVO (guitarra: legato/slide): las voces vivas de `fromNote` (tecla pulsada) pasan a ser de `toNote` y su
    /// afinación se desliza `semis` semitonos en `sec` segundos con curva x^gamma, sin re-pulsar. Se sueltan solas a los
    /// `relAfterSec` (release de `relSec`) para fundir con la voz de la nota nueva. Devuelve cuántas voces movió.
    int glideNote(int fromNote, int toNote, float semis, float sec, float gamma, float relAfterSec, float relSec, bool includeReleasing = false) {
        int n = 0;
        const float srf = static_cast<float>(sr_);
        for (auto& v : voices_) {
            if (!v.active || v.note != fromNote || (!includeReleasing && (!v.keyDown || v.releasing))) continue;
            v.note = toNote;
            // si ya venía deslizando, parte de la afinación actual
            float cur = 0.f;
            if (v.gLen > 0) cur = glideOffset(v, v.gPos); else cur = v.gA;
            v.gA = cur; v.gB = semis; v.gLen = std::max(1, static_cast<int>(sec * srf)); v.gPos = 0; v.gGamma = std::max(0.2f, gamma);
            v.holdLeft = std::max(1, static_cast<int>(relAfterSec * srf));
            v.holdRelK = 1.f - std::exp(-6.907755f / (std::max(0.005f, relSec) * srf));
            ++n;
        }
        return n;
    }

    /// ADITIVO (guitarra: slide de salida): suelta `note` deslizando la afinación `semis` semitonos en `sec` s mientras
    /// se apaga con un release de `relSec` (ignora el pedal). Devuelve cuántas voces afectó.
    int slideOut(int note, float semis, float sec, float gamma, float relSec) {
        int n = 0;
        const float srf = static_cast<float>(sr_);
        for (auto& v : voices_) {
            if (!v.active || v.note != note || !v.keyDown || v.releasing) continue;
            float cur = 0.f;
            if (v.gLen > 0) cur = glideOffset(v, v.gPos); else cur = v.gA;
            v.gA = cur; v.gB = semis; v.gLen = std::max(1, static_cast<int>(sec * srf)); v.gPos = 0; v.gGamma = std::max(0.2f, gamma);
            v.keyDown = false; v.pedalHeld = false; v.releasing = true;
            v.relK = 1.f - std::exp(-6.907755f / (std::max(0.01f, relSec) * srf));
            ++n;
        }
        return n;
    }

private:
    void startVoice(const std::shared_ptr<Bank>& bank, const Zone& zr, int note, float vel01, bool fromLoop = false, float atkOverride = 0.f,
                    float gainMul = 1.f, float extraCents = 0.f, const NoteShape* sh = nullptr) {
        const Zone* z = &zr;
        Voice* v = allocate();
        v->bank = bank;
        v->zone = z;
        v->note = note;
        v->active = true;
        v->keyDown = true;
        v->pedalHeld = false;
        v->releasing = false;
        v->age = ++clock_;
        v->env = 0.f;
        v->attack = 1.f / std::max(8.f, 0.0015f * static_cast<float>(sr_));
        v->att = 0.f;
        v->attStep = attackSec_ > 0.f ? 1.f / std::max(8.f, attackSec_ * static_cast<float>(sr_)) : 0.f;
        v->driftPh = rnd() * 6.2831853f;
        v->driftMul = 0.7f + 0.6f * rnd();
        const float detune = (rnd() * 2.f - 1.f) * hum_.detuneCents;
        v->cents = z->tuneCents + tune_ + detune + extraCents;
        v->basePitch = static_cast<float>(note - z->root);
        const float g = (rnd() * 2.f - 1.f) * hum_.gainDb;
        const float layer = (1.f - hum_.velCurve) + hum_.velCurve * vel01;
        v->gain = z->gainLin * std::pow(10.f, g / 20.f) * layer * gainMul;
        v->delay = static_cast<int>(rnd() * hum_.timingMs * 0.001f * static_cast<float>(sr_));
        v->pos = 0.0;
        v->relK = 0.f;
        v->vibPh = 0.f; v->vibHz = 1.f; v->vibEnv = 0.f; v->vibCnt = 16; v->looped = false; v->xfLeft = 0; v->pos2 = 0.0;
        v->lpC = 0.f; v->lpL = v->lpR = v->lpL2 = v->lpR2 = 0.f; v->holdLeft = 0; v->holdRelK = 0.f; v->relKOverride = 0.f;
        v->gA = v->gB = 0.f; v->gLen = 0; v->gPos = 0; v->gGamma = 1.f; v->loopGain = 1.f;
        lastStarted_ = v;
        if (vibCents_ > 0.f) { v->vibPh = rnd() * 6.2831853f; v->vibHz = 0.94f + 0.12f * rnd(); }
        if (fromLoop && z->loopEnd > z->loopStart && !z->oneShot) {   // legato: arranca ya en el sostenido, sin el ataque del arco
            const double L = static_cast<double>(z->loopEnd - z->loopStart);
            v->pos = z->loopStart + rnd() * 0.6 * L;
            v->looped = true;
            v->delay = 0;
            if (atkOverride > 0.f) v->attStep = 1.f / std::max(8.f, atkOverride * static_cast<float>(sr_));
        }
        const float pan = std::clamp(z->pan, -1.f, 1.f);
        const float a = (pan + 1.f) * 0.7853982f;
        v->panL = std::cos(a) * 1.4142135f * (z->channels == 1 ? 0.7071068f : 1.f);
        v->panR = std::sin(a) * 1.4142135f * (z->channels == 1 ? 0.7071068f : 1.f);
        if (z->channels == 2) { v->panL = 1.f; v->panR = 1.f; }
        // ADITIVO (piano nota a nota): forma por voz. Sin `sh` (todos los demás instrumentos) la voz queda `shaped = false`.
        v->shaped = false; v->relMul = 1.f; v->shG = 1.f; v->bodyOn = false; v->hamA = 0.f; v->hamE = 1.f; v->decMul = 1.f; v->decGain = 1.f;
        if (sh) {
            const float srf = static_cast<float>(sr_);
            if (sh->pan != 0.f) {
                const float pn = std::clamp(z->pan + sh->pan, -1.f, 1.f);
                if (z->channels == 2) {   // balance: atenúa solo el canal contrario
                    v->panL = pn > 0.f ? std::cos(pn * 1.5707963f) : 1.f;
                    v->panR = pn < 0.f ? std::cos(-pn * 1.5707963f) : 1.f;
                } else {
                    const float a2 = (pn + 1.f) * 0.7853982f;
                    v->panL = std::cos(a2) * 1.4142135f * 0.7071068f;
                    v->panR = std::sin(a2) * 1.4142135f * 0.7071068f;
                }
            }
            if (sh->shelfDb != 0.f) {   // high-shelf RBJ (S = 1)
                const double A = std::pow(10.0, sh->shelfDb / 40.0), w0 = 6.283185307179586 * std::clamp(sh->shelfHz, 50.f, 0.45f * srf) / sr_;
                const double cw = std::cos(w0), al = std::sin(w0) * 0.7071067811865476, sa = 2.0 * std::sqrt(A) * al;
                const double a0 = (A + 1.0) - (A - 1.0) * cw + sa;
                v->sb0 = A * ((A + 1.0) + (A - 1.0) * cw + sa) / a0;
                v->sb1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cw) / a0;
                v->sb2 = A * ((A + 1.0) + (A - 1.0) * cw - sa) / a0;
                v->sa1 = 2.0 * ((A - 1.0) - (A + 1.0) * cw) / a0;
                v->sa2 = ((A + 1.0) - (A - 1.0) * cw - sa) / a0;
                v->sz1L = v->sz2L = v->sz1R = v->sz2R = 0.0;
                v->shG = 2.f;   // marca "activo"
                v->shaped = true;
            }
            if (sh->bodyDb != 0.f && sh->bodyHz > 10.f && sh->bodyHz < 0.45f * srf) {
                const double A = std::pow(10.0, sh->bodyDb / 40.0), w0 = 6.283185307179586 * sh->bodyHz / sr_;
                const double alpha = std::sin(w0) / (2.0 * 1.2), cw = std::cos(w0);
                const double a0 = 1.0 + alpha / A;
                v->bb0 = (1.0 + alpha * A) / a0; v->bb1 = -2.0 * cw / a0; v->bb2 = (1.0 - alpha * A) / a0;
                v->ba1 = -2.0 * cw / a0; v->ba2 = (1.0 - alpha / A) / a0;
                v->bz1L = v->bz2L = v->bz1R = v->bz2R = 0.0;
                v->bodyOn = true; v->shaped = true;
            }
            if (sh->hammer != 1.f) {
                v->hamA = std::clamp(sh->hammer, 0.f, 4.f) - 1.f; v->hamE = 1.f;
                v->hamK = std::exp(-1.f / (0.020f * srf));
                v->shaped = true;
            }
            if (sh->decayDbPerSec != 0.f) {
                v->decMul = std::pow(10.f, -sh->decayDbPerSec / (20.f * srf));   // factor por muestra de salida
                v->decGain = 1.f;
                v->shaped = true;
            }
            v->relMul = std::clamp(sh->releaseScale, 0.1f, 8.f);
        }
    }

public:
    void noteOff(int note) {
        for (auto& v : voices_) {
            if (!v.active || v.note != note || !v.keyDown) continue;
            v.keyDown = false;
            if (v.zone->oneShot) continue;
            if (sustain_) v.pedalHeld = true;
            else release(v);
        }
    }

    void allNotesOff() { for (auto& v : voices_) if (v.active) { v.keyDown = false; v.pedalHeld = false; release(v); } }
    void panic() { for (auto& v : voices_) v.active = false; }

    /// SUMA `n` muestras estéreo en outL/outR (multiplicadas por el nivel del motor).
    template <class T>
    void render(T* outL, T* outR, int n) {
        for (auto& v : voices_) if (v.active) renderVoice(v, outL, outR, n);
    }

private:
    static constexpr int kVoices = 64;

    struct Voice {
        bool active{false}, keyDown{false}, pedalHeld{false}, releasing{false};
        std::shared_ptr<Bank> bank;
        const Zone* zone{nullptr};
        int note{0}, delay{0};
        uint64_t age{0};
        double pos{0};
        float cents{0}, basePitch{0}, gain{1}, env{0}, attack{0.01f}, relK{0}, panL{1}, panR{1};
        float att{0}, attStep{0}, driftPh{0}, driftMul{1};   // ataque suave y deriva (solo si se activan)
        float vibPh{0}, vibHz{1}, vibEnv{0};                 // vibrato por voz (solo si se activa)
        int vibCnt{16};
        bool looped{false};                                  // ya está en el bucle (el salto aleatorio ya se hizo)
        int xfLeft{0}, xfLen{0};                             // fundido cruzado del salto aleatorio (muestras de salida)
        double pos2{0};                                      // segunda cabeza de lectura durante ese fundido
        // ADITIVO (guitarra): paso-bajo por voz, suelta automática, release propio y deslizamiento de afinación
        float lpC{0}, lpL{0}, lpR{0}, lpL2{0}, lpR2{0};
        int holdLeft{0};
        float holdRelK{0}, relKOverride{0};
        float gA{0}, gB{0}, gGamma{1};                       // offset(t) = gA + gB * (t/gLen)^gGamma  (semitonos)
        int gLen{0}, gPos{0};
        float loopGain{1.f};                                 // ADITIVO (bajo): decaimiento acumulado tras entrar al bucle
        // ADITIVO (piano nota a nota): forma por voz (ver NoteShape); `shaped` = false en todos los demás instrumentos
        bool shaped{false}, bodyOn{false};
        float relMul{1.f}, shG{1.f};                                 // release; shG != 1 = shelf de agudos activo
        double sb0{1}, sb1{0}, sb2{0}, sa1{0}, sa2{0}, sz1L{0}, sz2L{0}, sz1R{0}, sz2R{0};   // shelf de agudos (TDF2)
        double bb0{1}, bb1{0}, bb2{0}, ba1{0}, ba2{0}, bz1L{0}, bz2L{0}, bz1R{0}, bz2R{0};   // campana del cuerpo (TDF2)
        float hamA{0.f}, hamE{1.f}, hamK{0.f};                       // martillo: 1 + hamA * hamE, hamE *= hamK
        float decMul{1.f}, decGain{1.f};                             // caída/sostén extra por muestra
    };

    static float glideOffset(const Voice& v, int pos) {
        const float x = std::clamp(static_cast<float>(pos) / static_cast<float>(std::max(1, v.gLen)), 0.f, 1.f);
        return v.gA + v.gB * std::pow(x, v.gGamma);
    }

    void join() { if (loader_.joinable()) loader_.join(); }

    uint32_t xs() { rng_ ^= rng_ << 13; rng_ ^= rng_ >> 17; rng_ ^= rng_ << 5; return rng_; }
    float rnd() { return static_cast<float>(xs() & 0xFFFFFF) / 16777216.f; }

    const Zone* pick(const Bank& b, int note, int vel) {
        const Zone* cand[24];
        int nc = 0, rrCount = 1;
        for (const auto& z : b.zones) {
            if (note < z.lokey || note > z.hikey || vel < z.lovel || vel > z.hivel) continue;
            if (nc < 24) cand[nc++] = &z;
            rrCount = std::max<int>(rrCount, z.rrCount);
        }
        if (nc == 0) return nullptr;
        if (rrCount <= 1) return cand[0];
        int& cur = rr_[note & 127];
        cur = (cur + 1) % rrCount;
        // round-robin que no repite la muestra anterior; si la capa tiene menos variaciones, usa la que haya
        for (int k = 0; k < rrCount; ++k) {
            const int want = (cur + k) % rrCount;
            for (int i = 0; i < nc; ++i) if (cand[i]->rrIndex == want) return cand[i];
        }
        return cand[0];
    }

    Voice* allocate() {
        Voice* libre = nullptr; Voice* viejaSuelta = nullptr; Voice* vieja = nullptr;
        for (auto& v : voices_) {
            if (!v.active) { libre = &v; break; }
            if (v.releasing && (!viejaSuelta || v.age < viejaSuelta->age)) viejaSuelta = &v;
            if (!vieja || v.age < vieja->age) vieja = &v;
        }
        if (libre) return libre;
        Voice* v = viejaSuelta ? viejaSuelta : vieja;
        v->active = false;
        return v;
    }

    void release(Voice& v) {
        if (v.releasing) return;
        v.releasing = true;
        if (v.relKOverride > 0.f) { v.relK = v.relKOverride; return; }
        const float t = std::max(0.02f, v.zone->releaseSec) * relScale_ * v.relMul;
        v.relK = 1.f - std::exp(-6.907755f / (t * static_cast<float>(sr_)));  // -60 dB en `t`
    }
    void fastKill(Voice& v) {
        v.keyDown = false; v.pedalHeld = false; v.releasing = true;
        v.relK = 1.f - std::exp(-6.907755f / (0.008f * static_cast<float>(sr_)));
    }

    template <class T>
    void renderVoice(Voice& v, T* outL, T* outR, int n) {
        const Zone& z = *v.zone;
        const int16_t* d = v.bank->data(z);
        const int ch = z.channels;
        const int last = static_cast<int>(z.frames) - 1;
        const bool loop = z.loopEnd > z.loopStart && !z.oneShot;
        float driftC = 0.f;
        if (driftCents_ > 0.f) {   // deriva lenta por voz (una fase por bloque)
            driftC = driftCents_ * std::sin(v.driftPh);
            v.driftPh += 6.2831853f * driftHz_ * v.driftMul * static_cast<float>(n) / static_cast<float>(sr_);
            if (v.driftPh > 6.2831853f) v.driftPh -= 6.2831853f;
        }
        const double ratioBase = std::pow(2.0, (v.basePitch + bend_) / 12.0 + (v.cents + driftC) / 1200.0) * (static_cast<double>(z.sr) / sr_);
        double ratio = ratioBase;
        float ampMod = 1.f;
        const float k = 1.f / 32768.f * level_ * v.gain;
        auto at = [&](int i, int c) -> float {
            if (loop && i >= static_cast<int>(z.loopEnd)) i -= static_cast<int>(z.loopEnd - z.loopStart);   // interpola a traves de la costura del bucle
            i = i < 0 ? 0 : (i > last ? last : i);
            return static_cast<float>(d[static_cast<size_t>(i) * ch + c]);
        };
        auto hermite = [](float y0, float y1, float y2, float y3, float t) {
            const float c1 = 0.5f * (y2 - y0), c2 = y0 - 2.5f * y1 + 2.f * y2 - 0.5f * y3, c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
            return ((c3 * t + c2) * t + c1) * t + y1;
        };
        const int safeEnd = loop ? static_cast<int>(z.loopEnd) : last + 1;   // índices < safeEnd no envuelven ni se recortan
        auto rd = [&](double p, float& l, float& r) {   // lectura interpolada (Hermite) en la posición p
            const int i0 = static_cast<int>(p);
            const float t = static_cast<float>(p - i0);
            if (i0 >= 1 && i0 + 2 < safeEnd) {   // camino rápido (el habitual): lectura directa
                const int16_t* q = d + static_cast<size_t>(i0 - 1) * ch;
                if (ch == 2) {
                    l = hermite(q[0], q[2], q[4], q[6], t);
                    r = hermite(q[1], q[3], q[5], q[7], t);
                } else {
                    l = r = hermite(q[0], q[1], q[2], q[3], t);
                }
                return;
            }
            if (ch == 2) {
                l = hermite(at(i0 - 1, 0), at(i0, 0), at(i0 + 1, 0), at(i0 + 2, 0), t);
                r = hermite(at(i0 - 1, 1), at(i0, 1), at(i0 + 1, 1), at(i0 + 2, 1), t);
            } else {
                l = r = hermite(at(i0 - 1, 0), at(i0, 0), at(i0 + 1, 0), at(i0 + 2, 0), t);
            }
        };
        const bool vib = vibCents_ > 0.f;
        // ADITIVO (guitarra): deslizamiento de afinación por voz (ratio interpolado linealmente dentro del bloque)
        const bool glideOn = v.gLen > 0 || v.gA != 0.f;
        double gR0 = 1.0, gR1 = 1.0;
        if (v.gLen > 0) {
            gR0 = std::exp2(static_cast<double>(glideOffset(v, v.gPos)) / 12.0);
            gR1 = std::exp2(static_cast<double>(glideOffset(v, std::min(v.gPos + n, v.gLen))) / 12.0);
        } else if (v.gA != 0.f) {
            gR0 = gR1 = std::exp2(static_cast<double>(v.gA) / 12.0);
        }
        const bool lpOn = v.lpC > 0.f;
        const bool shaped = v.shaped;
        // ADITIVO (bajo): decaimiento por muestra de salida una vez la voz entra al bucle (solo zonas con loopDecayDb)
        const bool loopDec = loop && z.loopDecayDb > 0.f && loopDecayScale_ > 0.f;
        const float ldMul = loopDec ? std::pow(10.f, -(z.loopDecayDb * loopDecayScale_ * static_cast<float>(ratioBase)) / (20.f * static_cast<float>(sr_))) : 1.f;
        for (int i = 0; i < n; ++i) {
            if (v.delay > 0) { --v.delay; continue; }
            if (glideOn) ratio = ratioBase * (gR0 + (gR1 - gR0) * static_cast<double>(i + 1) / static_cast<double>(n));
            if (v.holdLeft > 0 && --v.holdLeft == 0 && !v.releasing) {   // suelta automática (palm mute, tremolo, fundido del legato)
                v.keyDown = false; v.pedalHeld = false; v.releasing = true; v.relK = v.holdRelK;
            }
            if (!v.releasing) {
                if (v.attStep > 0.f) { v.att = std::min(1.f, v.att + v.attStep); v.env = v.att * v.att * (3.f - 2.f * v.att); }
                else v.env = std::min(1.f, v.env + v.attack);
            }
            else { v.env -= v.env * v.relK; if (v.env < 1e-4f) { v.active = false; v.bank.reset(); return; } }
            if (vib && !glideOn && ++v.vibCnt >= 16) {   // vibrato: se actualiza cada 16 muestras (fase, deriva de velocidad, rampa de entrada)
                v.vibCnt = 0;
                const float dts = 16.f / static_cast<float>(sr_);
                v.vibEnv = std::min(1.f, v.vibEnv + dts / 0.6f);
                v.vibHz = std::clamp(v.vibHz + (rnd() - 0.5f) * 0.012f, 0.9f, 1.1f);
                v.vibPh += 6.2831853f * vibHz_ * v.vibHz * dts;
                if (v.vibPh > 6.2831853f) v.vibPh -= 6.2831853f;
                ratio = ratioBase * std::exp2(vibCents_ * v.vibEnv * std::sin(v.vibPh) / 1200.f);
                ampMod = 1.f + 0.047f * (vibCents_ / 8.f) * v.vibEnv * std::sin(v.vibPh + 1.3f);
            }
            float l, r;
            rd(v.pos, l, r);
            if (lpOn) {   // paso-bajo por voz de 2 polos
                v.lpL += v.lpC * (l - v.lpL); v.lpL2 += v.lpC * (v.lpL - v.lpL2); l = v.lpL2;
                v.lpR += v.lpC * (r - v.lpR); v.lpR2 += v.lpC * (v.lpR - v.lpR2); r = v.lpR2;
            }
            if (shaped) {   // ADITIVO (piano nota a nota): shelf de agudos y campana del cuerpo
                if (v.shG != 1.f) {
                    const double xl = l, xr = r;
                    const double yl = v.sb0 * xl + v.sz1L; v.sz1L = v.sb1 * xl - v.sa1 * yl + v.sz2L; v.sz2L = v.sb2 * xl - v.sa2 * yl;
                    const double yr = v.sb0 * xr + v.sz1R; v.sz1R = v.sb1 * xr - v.sa1 * yr + v.sz2R; v.sz2R = v.sb2 * xr - v.sa2 * yr;
                    l = static_cast<float>(yl); r = static_cast<float>(yr);
                }
                if (v.bodyOn) {
                    const double xl = l, xr = r;
                    const double yl = v.bb0 * xl + v.bz1L; v.bz1L = v.bb1 * xl - v.ba1 * yl + v.bz2L; v.bz2L = v.bb2 * xl - v.ba2 * yl;
                    const double yr = v.bb0 * xr + v.bz1R; v.bz1R = v.bb1 * xr - v.ba1 * yr + v.bz2R; v.bz2R = v.bb2 * xr - v.ba2 * yr;
                    l = static_cast<float>(yl); r = static_cast<float>(yr);
                }
            }
            if (v.xfLeft > 0) {   // salto aleatorio dentro del bucle: fundido cruzado equipotencia entre las dos cabezas
                float l2, r2;
                rd(v.pos2, l2, r2);
                const float w = 1.5707963f * (1.f - static_cast<float>(v.xfLeft) / static_cast<float>(v.xfLen));
                const float ca = std::cos(w), cb = std::sin(w);
                l = l * ca + l2 * cb;
                r = r * ca + r2 * cb;
            }
            float e = v.env * k * ampMod;
            if (shaped) {   // ADITIVO (piano nota a nota): martillo (transitorio) y caída/sostén extra
                if (v.hamA != 0.f) { e *= 1.f + v.hamA * v.hamE; v.hamE *= v.hamK; }
                if (v.decMul != 1.f) {
                    e *= v.decGain;
                    if (!v.releasing) {   // al soltar la tecla la caída se congela: manda el release
                        v.decGain *= v.decMul;
                        if (v.decGain > 4.f) v.decGain = 4.f;
                        else if (v.decGain < 1e-5f) { v.active = false; v.bank.reset(); return; }
                    }
                }
            }
            if (loopDec && v.pos >= z.loopStart) {
                e *= v.loopGain;
                v.loopGain *= ldMul;
                if (v.loopGain < 1e-5f) { v.active = false; v.bank.reset(); return; }   // -100 dB: la cola se extinguió
            }
            outL[i] += static_cast<T>(l * e * v.panL);
            outR[i] += static_cast<T>(r * e * v.panR);
            v.pos += ratio;
            if (v.xfLeft > 0) {
                v.pos2 += ratio;
                if (loop && v.pos2 >= z.loopEnd) v.pos2 -= static_cast<double>(z.loopEnd - z.loopStart);
                if (--v.xfLeft == 0) v.pos = v.pos2;
            }
            if (loop && v.pos >= z.loopEnd) {
                v.pos -= static_cast<double>(z.loopEnd - z.loopStart);
                if (loopScatter_ && !v.looped && !v.releasing && v.xfLeft == 0) {   // primera vuelta: fase de bucle propia de la voz
                    v.pos2 = z.loopStart + static_cast<double>(rnd()) * static_cast<double>(z.loopEnd - z.loopStart);
                    v.xfLen = std::max(8, static_cast<int>(scatterFade_ * static_cast<float>(sr_)));
                    v.xfLeft = v.xfLen;
                }
                v.looped = true;
            }
            // fin de la muestra (un bucle que termina justo en el ultimo fotograma no debe matar la voz antes de envolver)
            if (!loop && v.pos >= last) { v.active = false; v.bank.reset(); return; }
        }
        if (v.gLen > 0) {
            v.gPos += n;
            if (v.gPos >= v.gLen) { v.gA += v.gB; v.gB = 0.f; v.gLen = 0; v.gPos = 0; }
        }
    }

    double sr_{48000.0};
    std::shared_ptr<Bank> bank_;
    std::array<Voice, kVoices> voices_;
    std::array<int, 128> rr_{};
    std::thread loader_;
    std::atomic<bool> loading_{false};
    std::string lastError_;
    Humanize hum_;
    float level_{1.f}, relScale_{1.f}, tune_{0.f}, bend_{0.f}, loopDecayScale_{1.f};
    float attackSec_{0.f}, driftCents_{0.f}, driftHz_{0.1f};
    float vibCents_{0.f}, vibHz_{5.3f}, scatterFade_{0.06f};
    bool loopScatter_{false};
    bool sustain_{false};
    uint64_t clock_{0};
    Voice* lastStarted_{nullptr};
    uint32_t rng_{0x9E3779B9u};
};

}  // namespace JwSampler
