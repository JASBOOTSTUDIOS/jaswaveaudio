// =====================================================================================
//  JasWave Worship Drums – catálogo de kits de batería y servicio de carga en segundo plano
//
//  Contrato de kits (generados por plugins/samples/tools, fuera de git):
//    <samples>\drum-kits\<slug>\<slug>.jws   banco con las notas GM del kit
//    <samples>\drum-kits\<slug>\kit.json     {"slug","nombre","estilo","autor","licencia","enlaceLicencia","creditos","fuente","notas":[...],"tamanoMB"}
//    <samples>\drum-kits\percusion\          kit especial de percusión auxiliar (palmas 39, pandereta 54, cencerro 56, vibraslap 58,
//                                            bongós 60/61, congas 62-64, timbales 65/66, agogó 67/68, cabasa 69, shaker 70, güiro 73/74,
//                                            claves 75, woodblock 76/77, campana de crash 78, triángulo 80/81)
//  <samples> = JASWAVE_SAMPLES_DIR o %APPDATA%\JasWave\samples (JwSampler::samplesDir()).
//  El MuldjordKit histórico (<samples>\worship-drums.jws) sigue existiendo y se muestra como el kit «muldjord».
//
//  Reglas de tiempo real: NINGUNA E/S ni reserva en el hilo de audio. KitService es un hilo de carga persistente:
//  el hilo de audio solo escribe átomos (selectIndex) y el servicio escanea la carpeta, carga el banco (caché
//  compartida de JwSampler) y lo publica con setBank() (intercambio atómico de shared_ptr). Las voces en curso
//  conservan el banco anterior (cada voz retiene su shared_ptr): el cambio de kit no corta ni hace clic.
// =====================================================================================
#pragma once

#include "jw_sampler.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace JasWaveWorshipDrums {

constexpr int kMaxKits = 16;                         // huecos del parámetro «Drum Kit» (pasos 0..15)
constexpr const char* kMuldjordSlug = "muldjord";
constexpr const char* kPercusionSlug = "percusion";

struct KitInfo {
    std::string slug, nombre, estilo, autor, licencia, enlaceLicencia, creditos, fuente;
    std::vector<int> notas;       // notas GM con muestras reales según kit.json
    double tamanoMB{0};
    std::string bankPath;
};

struct KitList {
    std::vector<KitInfo> kits;    // kits de batería instalados (muldjord primero, el resto por slug)
    bool hayPercusion{false};
    KitInfo percusion;            // kit especial de percusión auxiliar
    bool tieneNota(size_t i, int nota) const {
        if (i >= kits.size()) return false;
        for (int n : kits[i].notas) if (n == nota) return true;
        return false;
    }
};

// ---------------------------------------------------------------------------------
//  JSON mínimo (kit.json es plano: cadenas, números y una lista de enteros)
// ---------------------------------------------------------------------------------
namespace kitjson {
inline size_t valorDe(const std::string& js, const char* clave) {
    const std::string k = std::string("\"") + clave + "\"";
    size_t p = 0;
    while ((p = js.find(k, p)) != std::string::npos) {
        size_t q = p + k.size();
        while (q < js.size() && (js[q] == ' ' || js[q] == '\t' || js[q] == '\r' || js[q] == '\n')) ++q;
        if (q < js.size() && js[q] == ':') {
            ++q;
            while (q < js.size() && (js[q] == ' ' || js[q] == '\t' || js[q] == '\r' || js[q] == '\n')) ++q;
            return q;
        }
        p += k.size();
    }
    return std::string::npos;
}
inline void utf8Add(std::string& o, uint32_t c) {
    if (c < 0x80) o += static_cast<char>(c);
    else if (c < 0x800) { o += static_cast<char>(0xC0 | (c >> 6)); o += static_cast<char>(0x80 | (c & 0x3F)); }
    else { o += static_cast<char>(0xE0 | (c >> 12)); o += static_cast<char>(0x80 | ((c >> 6) & 0x3F)); o += static_cast<char>(0x80 | (c & 0x3F)); }
}
inline bool cadena(const std::string& js, const char* clave, std::string& out) {
    size_t q = valorDe(js, clave);
    if (q == std::string::npos || q >= js.size() || js[q] != '"') return false;
    ++q;
    std::string r;
    while (q < js.size() && js[q] != '"') {
        if (js[q] == '\\' && q + 1 < js.size()) {
            const char e = js[q + 1];
            q += 2;
            if (e == 'n') r += '\n'; else if (e == 't') r += '\t';
            else if (e == 'u' && q + 4 <= js.size()) { utf8Add(r, static_cast<uint32_t>(std::strtoul(js.substr(q, 4).c_str(), nullptr, 16))); q += 4; }
            else r += e;
        } else r += js[q++];
    }
    out = r;
    return true;
}
inline bool numero(const std::string& js, const char* clave, double& out) {
    const size_t q = valorDe(js, clave);
    if (q == std::string::npos) return false;
    char* fin = nullptr;
    const double v = std::strtod(js.c_str() + q, &fin);
    if (fin == js.c_str() + q) return false;
    out = v;
    return true;
}
inline std::vector<int> enteros(const std::string& js, const char* clave) {
    std::vector<int> r;
    size_t q = valorDe(js, clave);
    if (q == std::string::npos || q >= js.size() || js[q] != '[') return r;
    ++q;
    while (q < js.size() && js[q] != ']') {
        if ((js[q] >= '0' && js[q] <= '9')) {
            char* fin = nullptr;
            const long v = std::strtol(js.c_str() + q, &fin, 10);
            if (v >= 0 && v <= 127) r.push_back(static_cast<int>(v));
            q = static_cast<size_t>(fin - js.c_str());
        } else ++q;
    }
    return r;
}
inline bool leer(const std::filesystem::path& p, std::string& out) {
    FILE* f = nullptr;
#ifdef _WIN32
    if (fopen_s(&f, p.string().c_str(), "rb") != 0) f = nullptr;
#else
    f = std::fopen(p.string().c_str(), "rb");
#endif
    if (!f) return false;
    char buf[4096];
    size_t n;
    out.clear();
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0 && out.size() < (1u << 20)) out.append(buf, n);
    std::fclose(f);
    return true;
}
} // namespace kitjson

// Notas GM con muestras del MuldjordKit histórico (cabecera de worship_drums_dsp.h)
inline std::vector<int> notasMuldjord() { return { 35, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 55, 57, 59 }; }

namespace fs = std::filesystem;

inline KitInfo leerKitJson(const fs::path& carpeta, const std::string& slug) {
    KitInfo k;
    k.slug = slug;
    k.nombre = slug;
    std::string js;
    if (kitjson::leer(carpeta / "kit.json", js)) {
        kitjson::cadena(js, "nombre", k.nombre);
        kitjson::cadena(js, "estilo", k.estilo);
        kitjson::cadena(js, "autor", k.autor);
        kitjson::cadena(js, "licencia", k.licencia);
        kitjson::cadena(js, "enlaceLicencia", k.enlaceLicencia);
        kitjson::cadena(js, "creditos", k.creditos);
        kitjson::cadena(js, "fuente", k.fuente);
        kitjson::numero(js, "tamanoMB", k.tamanoMB);
        k.notas = kitjson::enteros(js, "notas");
    }
    if (k.nombre.empty()) k.nombre = slug;
    std::error_code ec;
    const fs::path banco = carpeta / (slug + ".jws");
    k.bankPath = banco.string();
    if (k.tamanoMB <= 0) {
        const auto sz = fs::file_size(banco, ec);
        if (!ec) k.tamanoMB = static_cast<double>(sz) / (1024.0 * 1024.0);
    }
    return k;
}

/// Escanea la carpeta de samples. Se llama SOLO desde el hilo de carga (hace E/S).
inline std::shared_ptr<const KitList> escanearKits() {
    auto L = std::make_shared<KitList>();
    const std::string dir = JwSampler::samplesDir();
    if (dir.empty()) return L;
    std::error_code ec;
    const fs::path raiz(dir);
    const fs::path legado = raiz / "worship-drums.jws";
    if (fs::exists(legado, ec)) {
        KitInfo k;
        k.slug = kMuldjordSlug;
        k.nombre = "Muldjord";
        k.estilo = "worship / rock moderno";
        k.autor = "Lars Muldjord";
        k.licencia = "CC BY 4.0";
        k.enlaceLicencia = "https://creativecommons.org/licenses/by/4.0/";
        k.creditos = "MuldjordKit de Lars Muldjord (FreePats), CC BY 4.0, modificado";
        k.notas = notasMuldjord();
        const fs::path copia = raiz / "drum-kits" / kMuldjordSlug;   // si L1 dejo tambien la copia con kit.json, se toman de ahi los metadatos (el banco sigue siendo el historico)
        if (fs::exists(copia / "kit.json", ec)) {
            KitInfo m = leerKitJson(copia, kMuldjordSlug);
            k.nombre = m.nombre; k.estilo = m.estilo; k.autor = m.autor; k.licencia = m.licencia; k.enlaceLicencia = m.enlaceLicencia; k.creditos = m.creditos; k.fuente = m.fuente;
            if (!m.notas.empty()) k.notas = m.notas;
        }
        k.bankPath = legado.string();
        const auto sz = fs::file_size(legado, ec);
        if (!ec) k.tamanoMB = static_cast<double>(sz) / (1024.0 * 1024.0);
        L->kits.push_back(std::move(k));
    }
    std::vector<KitInfo> otros;
    for (fs::directory_iterator it(raiz / "drum-kits", ec), fin; !ec && it != fin; it.increment(ec)) {
        std::error_code e2;
        if (!it->is_directory(e2)) continue;
        const std::string slug = it->path().filename().string();
        if (slug.empty() || slug[0] == '.') continue;
        if (!fs::exists(it->path() / (slug + ".jws"), e2)) continue;
        if (slug == kPercusionSlug) { L->percusion = leerKitJson(it->path(), slug); L->hayPercusion = true; continue; }
        if (slug == kMuldjordSlug && !L->kits.empty()) continue;   // el banco histórico manda
        otros.push_back(leerKitJson(it->path(), slug));
    }
    std::sort(otros.begin(), otros.end(), [](const KitInfo& a, const KitInfo& b) { return a.slug < b.slug; });
    for (auto& k : otros) { if (static_cast<int>(L->kits.size()) >= kMaxKits) break; L->kits.push_back(std::move(k)); }
    return L;
}

// ---------------------------------------------------------------------------------
//  Etiquetas del parámetro «Drum Kit» (la tabla de parámetros las referencia por puntero)
// ---------------------------------------------------------------------------------
struct KitLabels {
    char text[kMaxKits][48];
    const char* ptr[kMaxKits + 1];
    KitLabels() {
        for (int i = 0; i < kMaxKits; ++i) { std::snprintf(text[i], sizeof text[i], "Kit %d", i + 1); ptr[i] = text[i]; }
        ptr[kMaxKits] = nullptr;
    }
};
inline KitLabels& kitLabels() { static KitLabels k; return k; }
inline void publicarEtiquetas(const KitList& L) {
    KitLabels& K = kitLabels();
    for (int i = 0; i < kMaxKits; ++i) {
        char buf[48];
        if (i < static_cast<int>(L.kits.size())) std::snprintf(buf, sizeof buf, "%.40s", L.kits[static_cast<size_t>(i)].nombre.c_str());
        else std::snprintf(buf, sizeof buf, "Kit %d", i + 1);
        if (std::strcmp(buf, K.text[i]) != 0) std::memcpy(K.text[i], buf, sizeof buf);
    }
}

inline void mascaraDeBanco(const JwSampler::Bank& b, uint64_t out[2]) {
    out[0] = out[1] = 0;
    for (const auto& z : b.zones)
        for (int n = z.lokey; n <= z.hikey && n < 128; ++n) out[n >> 6] |= (uint64_t(1) << (n & 63));
}

// ---------------------------------------------------------------------------------
//  Servicio de carga (hilo persistente)
// ---------------------------------------------------------------------------------
class KitService {
public:
    enum Estado : int { Libre = 0, Cargando = 1, Ok = 2, NoExiste = 3, ErrorCarga = 4 };
    using Publicar = std::function<void(const std::shared_ptr<JwSampler::Bank>&, bool percusion)>;

    ~KitService() { stop(); }

    void start(Publicar cb) {
        if (iniciado_) return;
        iniciado_ = true;
        pub_ = std::move(cb);
        hilo_ = std::thread([this] { run(); });
    }
    void stop() {
        { std::lock_guard<std::mutex> lk(m_); parar_ = true; }
        cv_.notify_all();
        if (hilo_.joinable()) hilo_.join();
    }
    /// Seguro para el hilo de audio: solo átomos (el hilo de carga lo recoge en ≤ 20 ms).
    void selectIndex(int idx) { wantIdx_.store(idx); slugPend_.store(false); seq_.fetch_add(1); }
    /// Por slug (estado guardado). Hilo no de audio.
    void selectSlug(const std::string& s) {
        { std::lock_guard<std::mutex> lk(m_); wantSlug_ = s; }
        slugPend_.store(true);
        seq_.fetch_add(1);
        cv_.notify_all();
    }
    /// Vuelve a escanear la carpeta (kits nuevos) y a buscar el banco de percusión.
    void refresh() { rescan_.store(true); seq_.fetch_add(1); cv_.notify_all(); }

    std::shared_ptr<const KitList> list() const { return std::atomic_load(&lista_); }
    int activeIndex() const { return activo_.load(); }
    Estado estado() const { return static_cast<Estado>(estado_.load()); }
    bool loading() const { return cargando_.load(); }
    /// Slug del kit cargado, o el pedido por el estado guardado si todavía no hay ninguno.
    std::string slugGuardable() const { std::lock_guard<std::mutex> lk(m_); return !slugActivo_.empty() ? slugActivo_ : wantSlug_; }
    uint64_t maskKit(int w) const { return maskKit_[w].load(); }
    uint64_t maskPerc(int w) const { return maskPerc_[w].load(); }
    uint32_t listSeq() const { return listSeq_.load(); }
    /// El kit activo es el MuldjordKit (o aun no hay ninguno)? El cuerpo/pegada de caja y toms esta calibrado con sus medidas.
    bool activeIsMuldjord() const { return activoMuldjord_.load(std::memory_order_relaxed); }
    /// Espera (solo tests / herramientas) a que el servicio esté ocioso. true si terminó antes del límite.
    bool waitIdle(int timeoutMs) const {
        const auto t0 = std::chrono::steady_clock::now();
        while (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count() < timeoutMs) {
            if (!cargando_.load() && hecho_.load() == seq_.load()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        return false;
    }

private:
    void run() {
        uint32_t visto = 0;
        while (true) {
            {
                std::unique_lock<std::mutex> lk(m_);
                cv_.wait_for(lk, std::chrono::milliseconds(20), [&] { return parar_ || seq_.load() != visto; });
                if (parar_) return;
            }
            const uint32_t s = seq_.load();
            if (s == visto) continue;
            visto = s;
            cargando_.store(true);
            trabajar();
            hecho_.store(s);
            cargando_.store(false);
        }
    }
    void trabajar() {
        const bool reesc = rescan_.exchange(false) || !list();
        if (reesc) {
            auto L = escanearKits();
            std::atomic_store(&lista_, L);
            publicarEtiquetas(*L);
            listSeq_.fetch_add(1);
            // el kit activo puede haber cambiado de posición (o desaparecido)
            int pos = -1;
            for (size_t i = 0; i < L->kits.size(); ++i) if (L->kits[i].slug == slugActivoCopia()) pos = static_cast<int>(i);
            activo_.store(pos);
            if (L->hayPercusion && (!percCargada_ || percRuta_ != L->percusion.bankPath)) cargarPercusion(*L);
            else if (!L->hayPercusion && percCargada_) { /* se queda con el banco ya cargado */ }
        }
        const auto L = list();
        int idx = -1;
        if (slugPend_.load()) {
            std::string s;
            { std::lock_guard<std::mutex> lk(m_); s = wantSlug_; }
            for (size_t i = 0; i < L->kits.size(); ++i) if (L->kits[i].slug == s) idx = static_cast<int>(i);
            if (idx < 0 && slugActivoCopia().empty()) idx = wantIdx_.load();   // el kit guardado ya no existe y no hay ninguno: cae al índice del parámetro
        } else {
            idx = wantIdx_.load();
        }
        if (idx < 0 || idx >= static_cast<int>(L->kits.size())) {
            estado_.store(L->kits.empty() ? Libre : NoExiste);   // kit inexistente: se conserva el banco cargado
            return;
        }
        const KitInfo& k = L->kits[static_cast<size_t>(idx)];
        if (k.slug == slugActivoCopia()) { activo_.store(idx); estado_.store(Ok); return; }
        estado_.store(Cargando);
        std::string err;
        auto b = JwSampler::acquireBank(k.bankPath, err);
        if (!b) { estado_.store(ErrorCarga); return; }   // se conserva el banco anterior
        if (pub_) pub_(b, false);
        uint64_t m[2];
        mascaraDeBanco(*b, m);
        maskKit_[0].store(m[0]); maskKit_[1].store(m[1]);
        { std::lock_guard<std::mutex> lk(m_); slugActivo_ = k.slug; }
        activoMuldjord_.store(k.slug == kMuldjordSlug);
        activo_.store(idx);
        estado_.store(Ok);
    }
    void cargarPercusion(const KitList& L) {
        std::string err;
        auto b = JwSampler::acquireBank(L.percusion.bankPath, err);
        if (!b) return;
        if (pub_) pub_(b, true);
        uint64_t m[2];
        mascaraDeBanco(*b, m);
        maskPerc_[0].store(m[0]); maskPerc_[1].store(m[1]);
        percCargada_ = true;
        percRuta_ = L.percusion.bankPath;
    }
    std::string slugActivoCopia() const { std::lock_guard<std::mutex> lk(m_); return slugActivo_; }

    mutable std::mutex m_;
    std::condition_variable cv_;
    std::thread hilo_;
    bool iniciado_{false}, parar_{false};
    Publicar pub_;
    std::shared_ptr<const KitList> lista_;
    std::string wantSlug_, slugActivo_;
    std::atomic<int> wantIdx_{0}, activo_{-1}, estado_{Libre};
    std::atomic<bool> slugPend_{false}, rescan_{true}, cargando_{false}, activoMuldjord_{true};
    std::atomic<uint32_t> seq_{1}, hecho_{0}, listSeq_{0};
    std::atomic<uint64_t> maskKit_[2]{}, maskPerc_[2]{};
    bool percCargada_{false};
    std::string percRuta_;
};

} // namespace JasWaveWorshipDrums
