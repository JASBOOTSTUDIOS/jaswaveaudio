// JasWave – Manager de licencias (Windows): almacenamiento compartido, DPAPI, WinHTTP, device-code
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wincrypt.h>
#include <winhttp.h>

#include "jw_license.h"
#include "jw_license_core.h"
#include "jw_json.h"
#include "jw_license_pubkey.h"   // generado en build desde keys/licencia_publica.pem

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <ctime>
#include <mutex>
#include <random>
#include <thread>
#include <vector>

namespace JasWaveLicense {

namespace {

constexpr int64_t kRenewWindowSec = 6 * 3600;      // renovar cuando quedan < 6 h
constexpr int64_t kExpiringSoonSec = 2 * 3600;     // aviso ámbar < 2 h sin renovar
constexpr int kBackoffMinSec = 60;
constexpr int kBackoffMaxSec = 30 * 60;

int64_t nowSec() { return static_cast<int64_t>(std::time(nullptr)); }

#ifdef JW_LICENSE_TESTING
// Solo binarios de prueba: clave pública de pruebas por variable de entorno (64 hex)
const uint8_t* publicKey() {
    static uint8_t key[32];
    static const bool fromEnv = [] {
        char hex[80] = {};
        const DWORD n = GetEnvironmentVariableA("JW_LICENSE_TEST_PUBKEY_HEX", hex, sizeof hex);
        if (n != 64) return false;
        for (int i = 0; i < 32; ++i) {
            unsigned v = 0;
            if (sscanf_s(hex + i * 2, "%2x", &v) != 1) return false;
            key[i] = static_cast<uint8_t>(v);
        }
        return true;
    }();
    return fromEnv ? key : kJwLicensePublicKey;
}
#else
const uint8_t* publicKey() { return kJwLicensePublicKey; }
#endif

std::wstring widen(const std::string& s) {
    if (s.empty()) return std::wstring();
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(std::max(0, n)), L'\0');
    if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), &w[0], n);
    return w;
}
std::string narrow(const std::wstring& w) {
    if (w.empty()) return std::string();
    const int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(std::max(0, n)), '\0');
    if (n > 0) WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), &s[0], n, nullptr, nullptr);
    return s;
}

std::wstring envVar(const wchar_t* name) {
    wchar_t buf[1024];
    const DWORD n = GetEnvironmentVariableW(name, buf, 1024);
    if (n == 0 || n >= 1024) return std::wstring();
    return std::wstring(buf, n);
}

bool readFileLimited(const std::wstring& path, std::string& out, size_t limit = 64 * 1024) {
    out.clear();
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER sz{};
    bool ok = GetFileSizeEx(h, &sz) && sz.QuadPart >= 0 && static_cast<uint64_t>(sz.QuadPart) <= limit;
    if (ok) {
        out.resize(static_cast<size_t>(sz.QuadPart));
        DWORD rd = 0;
        ok = sz.QuadPart == 0 || (ReadFile(h, &out[0], static_cast<DWORD>(out.size()), &rd, nullptr) && rd == out.size());
    }
    CloseHandle(h);
    if (!ok) out.clear();
    return ok;
}

bool fileWriteTime(const std::wstring& path, uint64_t& t) {
    WIN32_FILE_ATTRIBUTE_DATA d{};
    if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &d)) return false;
    t = (static_cast<uint64_t>(d.ftLastWriteTime.dwHighDateTime) << 32) | d.ftLastWriteTime.dwLowDateTime;
    t ^= (static_cast<uint64_t>(d.nFileSizeLow) << 1);
    return true;
}

// Escritura atómica: temporal en la misma carpeta + MoveFileEx(REPLACE_EXISTING)
bool writeFileAtomic(const std::wstring& path, const void* data, size_t size) {
    const size_t slash = path.find_last_of(L"\\/");
    if (slash != std::wstring::npos) SHCreateDirectoryExW(nullptr, path.substr(0, slash).c_str(), nullptr);
    wchar_t suffix[64];
    swprintf_s(suffix, L".%lu.%lu.tmp", GetCurrentProcessId(), GetCurrentThreadId());
    const std::wstring tmp = path + suffix;
    HANDLE h = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD wr = 0;
    bool ok = size == 0 || (WriteFile(h, data, static_cast<DWORD>(size), &wr, nullptr) && wr == size);
    ok = FlushFileBuffers(h) && ok;
    CloseHandle(h);
    if (ok) ok = MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
    if (!ok) DeleteFileW(tmp.c_str());
    return ok;
}

bool dpapiProtect(const std::string& plain, std::string& out) {
    DATA_BLOB in{ static_cast<DWORD>(plain.size()), reinterpret_cast<BYTE*>(const_cast<char*>(plain.data())) };
    DATA_BLOB res{};
    if (!CryptProtectData(&in, L"JasWave tokenDispositivo", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &res)) return false;
    out.assign(reinterpret_cast<const char*>(res.pbData), res.cbData);
    SecureZeroMemory(res.pbData, res.cbData);
    LocalFree(res.pbData);
    return true;
}
bool dpapiUnprotect(const std::string& blob, std::string& out) {
    DATA_BLOB in{ static_cast<DWORD>(blob.size()), reinterpret_cast<BYTE*>(const_cast<char*>(blob.data())) };
    DATA_BLOB res{};
    if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &res)) return false;
    out.assign(reinterpret_cast<const char*>(res.pbData), res.cbData);
    SecureZeroMemory(res.pbData, res.cbData);
    LocalFree(res.pbData);
    return true;
}

std::string deviceName() {
    wchar_t buf[256];
    DWORD n = 256;
    std::string s = GetComputerNameExW(ComputerNameDnsHostname, buf, &n) ? narrow(std::wstring(buf, n)) : std::string();
    if (s.empty()) s = "JasWave-PC";
    if (s.size() > 120) s.resize(120);
    return s;
}

bool isHttpUrl(const std::wstring& u) {
    return u.rfind(L"http://", 0) == 0 || u.rfind(L"https://", 0) == 0;
}
std::wstring trimSlash(std::wstring u) {
    while (!u.empty() && (u.back() == L'/' || u.back() == L' ')) u.pop_back();
    return u;
}
std::string urlEncode(const std::string& s) {
    static const char* hx = "0123456789ABCDEF";
    std::string o;
    for (const char ch : s) {
        const unsigned char c = static_cast<unsigned char>(ch);
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') o.push_back(ch);
        else { o.push_back('%'); o.push_back(hx[c >> 4]); o.push_back(hx[c & 15]); }
    }
    return o;
}

struct HttpResult {
    int status{0};          // 0 = error de red
    std::string body;
    JsonValue json;
    bool jsonOk{false};
    std::string errorCode() const {
        if (!jsonOk) return std::string();
        const JsonValue* e = json.get("error");
        if (e && e->isObject()) return e->getString("codigo");
        return json.getString("error");
    }
    std::string errorMessage() const {
        if (!jsonOk) return std::string();
        const JsonValue* e = json.get("error");
        return (e && e->isObject()) ? e->getString("mensaje") : std::string();
    }
};

HttpResult httpPostJson(const std::wstring& base, const std::wstring& path, const std::string& body) {
    HttpResult r;
    const std::wstring url = trimSlash(base) + path;
    URL_COMPONENTS uc{};
    uc.dwStructSize = sizeof uc;
    wchar_t host[256] = {}, urlPath[1024] = {};
    uc.lpszHostName = host; uc.dwHostNameLength = 256;
    uc.lpszUrlPath = urlPath; uc.dwUrlPathLength = 1024;
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &uc)) return r;
    const bool https = uc.nScheme == INTERNET_SCHEME_HTTPS;
    HINTERNET ses = WinHttpOpen(L"JasWaveVST/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!ses) ses = WinHttpOpen(L"JasWaveVST/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!ses) return r;
    WinHttpSetTimeouts(ses, 3000, 3000, 6000, 8000);
    HINTERNET con = WinHttpConnect(ses, host, uc.nPort, 0);
    HINTERNET req = con ? WinHttpOpenRequest(con, L"POST", urlPath, nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                             https ? WINHTTP_FLAG_SECURE : 0)
                        : nullptr;
    if (req) {
        const wchar_t* hdr = L"Content-Type: application/json\r\nAccept: application/json\r\n";
        if (WinHttpSendRequest(req, hdr, static_cast<DWORD>(-1L), const_cast<char*>(body.data()), static_cast<DWORD>(body.size()),
                               static_cast<DWORD>(body.size()), 0) &&
            WinHttpReceiveResponse(req, nullptr)) {
            DWORD status = 0, len = sizeof status;
            WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &len,
                                WINHTTP_NO_HEADER_INDEX);
            std::string data;
            for (;;) {
                DWORD avail = 0;
                if (!WinHttpQueryDataAvailable(req, &avail) || avail == 0) break;
                if (data.size() + avail > 128 * 1024) { data.clear(); status = 0; break; }
                const size_t old = data.size();
                data.resize(old + avail);
                DWORD rd = 0;
                if (!WinHttpReadData(req, &data[old], avail, &rd)) { data.clear(); status = 0; break; }
                data.resize(old + rd);
                if (rd == 0) break;
            }
            r.status = static_cast<int>(status);
            r.body = std::move(data);
            r.jsonOk = JsonValue::parse(r.body, r.json);
        }
        WinHttpCloseHandle(req);
    }
    if (con) WinHttpCloseHandle(con);
    WinHttpCloseHandle(ses);
    return r;
}

// Mutex con nombre (por sesión de usuario) que serializa renovaciones y escrituras entre
// todos los plugins JasWave y el DAW: evita carreras con la rotación de tokenDispositivo.
class NamedLock {
public:
    explicit NamedLock(DWORD waitMs) {
        h_ = CreateMutexW(nullptr, FALSE, L"Local\\JasWave.License.v1");
        if (!h_) return;
        const DWORD r = WaitForSingleObject(h_, waitMs);
        owned_ = (r == WAIT_OBJECT_0 || r == WAIT_ABANDONED);
    }
    ~NamedLock() {
        if (h_ && owned_) ReleaseMutex(h_);
        if (h_) CloseHandle(h_);
    }
    bool owned() const { return owned_; }
private:
    HANDLE h_{nullptr};
    bool owned_{false};
};

} // namespace

std::wstring licenseDir() {
#ifdef JW_LICENSE_TESTING
    // Solo binarios de prueba: carpeta aislada (nunca la del usuario real)
    const std::wstring testDir = envVar(L"JASWAVE_LICENSE_DIR");
    if (!testDir.empty()) return testDir;
#endif
    PWSTR p = nullptr;
    std::wstring dir;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, KF_FLAG_DEFAULT, nullptr, &p)) && p) dir = p;
    if (p) CoTaskMemFree(p);
    if (dir.empty()) dir = envVar(L"APPDATA");
    if (dir.empty()) return dir;
    return dir + L"\\JasWave\\license";
}

// =====================================================================================

struct Manager::Impl {
    explicit Impl(Manager& m) : self(m) {}
    Manager& self;

    // configuración del producto
    bool configured{false};
    std::string productId;
    std::vector<std::string> featureStore;
    std::vector<const char*> featurePtrs;

    // hilo
    mutable std::mutex m;
    std::condition_variable cv;
    std::thread th;
    int refs{0};
    bool stop{false};
    bool activationRequested{false};
    bool cancelRequested{false};

    // estado (protegido por m)
    UiStatus ui;
    Claims claims;
    bool haveClaims{false};
    uint64_t licStamp{0};
    bool licStampValid{false};
    int64_t nextRenewAt{0};
    int backoff{kBackoffMinSec};
    bool lastRenewFailed{false};
    bool testMode{false};          // solo JW_LICENSE_TESTING
    std::wstring lastBrowserUrl;   // solo JW_LICENSE_TESTING
    std::mt19937 rng{std::random_device{}()};

    std::wstring dir() const { return licenseDir(); }
    std::wstring licPath() const { return dir() + L"\\license.jwl"; }
    std::wstring devPath() const { return dir() + L"\\device.bin"; }
    std::wstring cfgPath() const { return dir() + L"\\config.json"; }

    void endpoints(std::wstring& api, std::wstring& web) const {
        api = envVar(L"JASWAVE_API_URL");
        web = envVar(L"JASWAVE_WEB_URL");
        std::string cfg;
        JsonValue j;
        if (readFileLimited(cfgPath(), cfg) && JsonValue::parse(cfg, j) && j.isObject()) {
            const std::wstring a = widen(j.getString("apiBase"));
            const std::wstring w = widen(j.getString("webBase"));
            if (isHttpUrl(a)) api = a;
            if (isHttpUrl(w)) web = w;
        }
        if (!isHttpUrl(api)) api = L"http://127.0.0.1:8787";
        if (!isHttpUrl(web)) web = L"http://localhost:5173";
    }

    void bumpSerial() { self.serial_.fetch_add(1, std::memory_order_acq_rel); }

    // Calcula y publica la palabra de estado (llamar con m tomado)
    void publishLocked() {
        if (testMode) return;
        uint64_t s = 0;
        const int64_t now = nowSec();
        if (haveClaims && claims.exp > now && !(claims.iat > 0 && now + 300 < claims.iat)) {
            uint32_t mask = 0;
            if (productAccess(claims, productId, featurePtrs.data(), static_cast<int>(featurePtrs.size()), &mask)) {
                s = StateBits::kLicensed | (static_cast<uint64_t>(mask) << StateBits::kFeatureShift);
                if (claims.exp - now < kExpiringSoonSec && lastRenewFailed) s |= StateBits::kExpiringSoon;
            }
        }
        const uint64_t prev = self.state_.exchange(s, std::memory_order_acq_rel);
        ui.state = s;
        ui.expiresAt = haveClaims ? claims.exp : 0;
        ui.email = haveClaims ? claims.email : std::string();
        if (isLicensed(s)) {
            if (ui.phase != Phase::Starting && ui.phase != Phase::WaitingApproval) { ui.phase = Phase::Active; ui.message.clear(); }
        } else if (ui.phase == Phase::Active) {
            ui.phase = Phase::Idle;
            if (haveClaims && claims.exp <= now) ui.message = "La licencia caducó. Inicia sesión para renovarla.";
            else if (haveClaims) ui.message = "Tu cuenta no incluye este plugin.";
        }
        if (prev != s) bumpSerial();
    }

    // Lee y verifica license.jwl (llamar con m tomado)
    void loadLocked() {
        std::string tok;
        uint64_t stamp = 0;
        licStampValid = fileWriteTime(licPath(), stamp);
        licStamp = stamp;
        haveClaims = false;
        if (!licStampValid || !readFileLimited(licPath(), tok)) return;
        Claims c;
        const VerifyResult r = verifyToken(tok, publicKey(), nowSec(), &c);
        if (r == VerifyResult::Ok || r == VerifyResult::Expired) {
            claims = c;     // caducada: se conserva para informar (publish la marca sin licencia)
            haveClaims = true;
        } else if (r != VerifyResult::Ok) {
            ui.message = std::string("Licencia local no válida: ") + verifyResultText(r) + ".";
            bumpSerial();
        }
    }

    bool fileChangedLocked() const {
        uint64_t stamp = 0;
        const bool exists = fileWriteTime(licPath(), stamp);
        return exists != licStampValid || (exists && stamp != licStamp);
    }

    bool deviceTokenExists() const { return GetFileAttributesW(devPath().c_str()) != INVALID_FILE_ATTRIBUTES; }

    // Guarda licencia (+ token de dispositivo) de forma atómica bajo el mutex con nombre
    bool storeLicense(const std::string& token, const std::string& tokenDispositivo) {
        NamedLock lk(5000);
        if (!lk.owned()) return false;
        bool ok = writeFileAtomic(licPath(), token.data(), token.size());
        if (ok && !tokenDispositivo.empty()) {
            std::string blob;
            ok = dpapiProtect(tokenDispositivo, blob) && writeFileAtomic(devPath(), blob.data(), blob.size());
        }
        return ok;
    }

    // ---- Renovación con tokenDispositivo (hilo de fondo, sin m tomado) ----
    void renew() {
        NamedLock lk(0);
        if (!lk.owned()) { scheduleRetry(false); return; }   // otro proceso está renovando
        {
            // ¿Ya lo renovó otro plugin / el DAW?
            std::lock_guard<std::mutex> g(m);
            loadLocked();
            publishLocked();
            if (haveClaims && claims.exp - nowSec() >= kRenewWindowSec) { lastRenewFailed = false; backoff = kBackoffMinSec; return; }
        }
        std::string blob, devToken;
        if (!readFileLimited(devPath(), blob) || !dpapiUnprotect(blob, devToken) || devToken.empty()) {
            std::lock_guard<std::mutex> g(m);
            nextRenewAt = nowSec() + kBackoffMaxSec;
            return;
        }
        std::wstring api, web;
        endpoints(api, web);
        const std::string body = std::string("{\"tokenDispositivo\":") + jsonQuote(devToken) + ",\"dispositivo\":" + jsonQuote(deviceName()) + "}";
        SecureZeroMemory(&devToken[0], devToken.size());
        const HttpResult res = httpPostJson(api, L"/license/device/renovar", body);
        if (res.status == 200 && res.jsonOk && res.json.getString("estado") == "aprobado") {
            const std::string token = res.json.getString("token");
            const std::string nuevoDev = res.json.getString("tokenDispositivo");
            Claims c;
            if (verifyToken(token, publicKey(), nowSec(), &c) == VerifyResult::Ok) {
                bool ok = writeFileAtomic(licPath(), token.data(), token.size());
                if (ok && !nuevoDev.empty()) {
                    std::string nb;
                    ok = dpapiProtect(nuevoDev, nb) && writeFileAtomic(devPath(), nb.data(), nb.size());
                }
                std::lock_guard<std::mutex> g(m);
                loadLocked();
                lastRenewFailed = !ok;
                backoff = kBackoffMinSec;
                // nunca más de una renovación por minuto aunque el servidor emita licencias cortas
                nextRenewAt = nowSec() + kBackoffMinSec;
                publishLocked();
                return;
            }
            scheduleRetry(true);
            return;
        }
        if (res.status == 401 || res.status == 403) {
            // Revocado / sin licencia: el admin manda. Se borra la licencia local.
            DeleteFileW(licPath().c_str());
            if (res.status == 401) DeleteFileW(devPath().c_str());
            std::lock_guard<std::mutex> g(m);
            loadLocked();
            ui.phase = Phase::Idle;
            ui.message = res.status == 401 ? "Este equipo fue revocado. Inicia sesión de nuevo." : "Tu cuenta ya no tiene licencia para este plugin.";
            nextRenewAt = nowSec() + kBackoffMaxSec;
            publishLocked();
            bumpSerial();
            return;
        }
        scheduleRetry(true);
    }

    void scheduleRetry(bool failed) {
        std::lock_guard<std::mutex> g(m);
        if (failed) lastRenewFailed = true;
        const int jitter = static_cast<int>(rng() % 15u);
        nextRenewAt = nowSec() + backoff + jitter;
        backoff = std::min(kBackoffMaxSec, backoff * 2);
        publishLocked();
    }

    // Espera interrumpible (stop / cancel). Devuelve false si hay que abortar.
    bool sleepInterruptible(int seconds) {
        std::unique_lock<std::mutex> g(m);
        cv.wait_for(g, std::chrono::seconds(seconds), [&] { return stop || cancelRequested; });
        return !(stop || cancelRequested);
    }

    void setUi(Phase p, const std::string& msg, const std::string& code = std::string()) {
        std::lock_guard<std::mutex> g(m);
        ui.phase = p;
        ui.message = msg;
        ui.userCode = code;
        bumpSerial();
    }

    // ---- Flujo device-code (hilo de fondo) ----
    void runActivation() {
        setUi(Phase::Starting, "Conectando con JasWave…");
        std::wstring api, web;
        endpoints(api, web);
        const std::string dev = deviceName();
        const HttpResult st = httpPostJson(api, L"/license/device/start",
                                           std::string("{\"productoId\":") + jsonQuote(productId) + ",\"dispositivo\":" + jsonQuote(dev) + "}");
        if (st.status == 0) { setUi(Phase::Error, "Sin conexión con el servidor de licencias."); return; }
        if ((st.status != 200 && st.status != 201) || !st.jsonOk) {
            const std::string msg = st.errorMessage();
            setUi(Phase::Error, msg.empty() ? "El servidor rechazó la solicitud (" + std::to_string(st.status) + ")." : msg);
            return;
        }
        const std::string devCode = st.json.getString("codigoDispositivo");
        const std::string userCode = st.json.getString("codigoUsuario");
        const int interval = std::clamp(static_cast<int>(st.json.getNumber("intervaloSeg", 5.0)), 2, 30);
        if (devCode.empty() || userCode.empty() || userCode.size() > 20) { setUi(Phase::Error, "Respuesta inesperada del servidor."); return; }
        setUi(Phase::WaitingApproval, "Esperando aprobación…", userCode);

        const std::wstring url = trimSlash(web) + L"/activar?codigo=" + widen(urlEncode(userCode));
#ifdef JW_LICENSE_TESTING
        if (!envVar(L"JASWAVE_LICENSE_NO_BROWSER").empty()) lastBrowserUrl = url;
        else
#endif
        if (isHttpUrl(url)) ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);

        const int64_t deadline = nowSec() + 15 * 60;
        int netFails = 0;
        while (nowSec() < deadline) {
            if (!sleepInterruptible(interval)) {
                std::lock_guard<std::mutex> g(m);
                if (cancelRequested) { ui.phase = Phase::Idle; ui.userCode.clear(); ui.message.clear(); bumpSerial(); }
                return;
            }
            const HttpResult pr = httpPostJson(api, L"/license/device/poll",
                                               std::string("{\"codigoDispositivo\":") + jsonQuote(devCode) + ",\"dispositivo\":" + jsonQuote(dev) + "}");
            if (pr.status == 0) {
                if (++netFails >= 6) { setUi(Phase::Error, "Se perdió la conexión con el servidor de licencias."); return; }
                continue;
            }
            netFails = 0;
            if (pr.status != 200 || !pr.jsonOk) {
                const std::string msg = pr.errorMessage();
                setUi(Phase::Error, msg.empty() ? "Error del servidor (" + std::to_string(pr.status) + ")." : msg);
                return;
            }
            const std::string estado = pr.json.getString("estado");
            if (estado == "pendiente") continue;
            if (estado == "caducado") { setUi(Phase::Error, "El código caducó. Vuelve a intentarlo."); return; }
            if (estado != "aprobado") { setUi(Phase::Error, "Respuesta inesperada del servidor."); return; }

            const std::string token = pr.json.getString("token");
            Claims c;
            const VerifyResult vr = verifyToken(token, publicKey(), nowSec(), &c);
            if (vr != VerifyResult::Ok) { setUi(Phase::Error, std::string("Licencia recibida no válida: ") + verifyResultText(vr) + "."); return; }
            if (!storeLicense(token, pr.json.getString("tokenDispositivo"))) {
                setUi(Phase::Error, "No se pudo guardar la licencia en %APPDATA%\\JasWave\\license.");
                return;
            }
            std::lock_guard<std::mutex> g(m);
            loadLocked();
            ui.userCode.clear();
            ui.phase = Phase::Idle;
            ui.message.clear();
            lastRenewFailed = false;
            backoff = kBackoffMinSec;
            nextRenewAt = 0;
            publishLocked();
            if (!isLicensed(self.state_.load(std::memory_order_relaxed))) ui.message = "Tu cuenta no incluye este plugin.";
            else ui.phase = Phase::Active;
            bumpSerial();
            return;
        }
        setUi(Phase::Error, "El código caducó. Vuelve a intentarlo.");
    }

    void threadMain() {
        HRESULT co = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);   // ShellExecute
        {
            std::lock_guard<std::mutex> g(m);
            loadLocked();
            publishLocked();
        }
        std::unique_lock<std::mutex> g(m);
        while (!stop) {
            if (activationRequested) {
                activationRequested = false;
                cancelRequested = false;
                g.unlock();
                runActivation();
                g.lock();
                continue;
            }
            if (fileChangedLocked()) loadLocked();
            publishLocked();
            const int64_t now = nowSec();
            const bool needRenew = (!haveClaims || claims.exp - now < kRenewWindowSec) && now >= nextRenewAt && deviceTokenExists();
            if (needRenew) {
                g.unlock();
                renew();
                g.lock();
                continue;
            }
            // Re-evalúa como mucho cada 15 s (caducidad exacta, cambios en disco de otros procesos)
            int64_t waitS = 15;
            if (haveClaims && claims.exp > now) waitS = std::min<int64_t>(waitS, std::max<int64_t>(1, claims.exp - now));
            cv.wait_for(g, std::chrono::seconds(waitS), [&] { return stop || activationRequested; });
        }
        g.unlock();
        if (SUCCEEDED(co)) CoUninitialize();
    }
};

Manager& Manager::instance() {
    static Manager m;
    return m;
}

Manager::Manager() : impl_(new Impl(*this)) {}

Manager::~Manager() {
    if (impl_ && impl_->th.joinable()) {
        // No se puede hacer join bajo el loader lock: las instancias deben haber llamado release().
        {
            std::lock_guard<std::mutex> g(impl_->m);
            impl_->stop = true;
        }
        impl_->cv.notify_all();
        impl_->th.detach();
    }
}

void Manager::configure(const ProductInfo& info) {
    std::lock_guard<std::mutex> g(impl_->m);
    if (impl_->configured) return;
    impl_->productId = info.productId ? info.productId : "";
    for (int i = 0; i < info.featureCount && i < 24; ++i) impl_->featureStore.emplace_back(info.featureKeys[i]);
    for (const auto& s : impl_->featureStore) impl_->featurePtrs.push_back(s.c_str());
    impl_->configured = true;
}

const char* Manager::productId() const { return impl_->productId.c_str(); }

void Manager::acquire() {
    std::lock_guard<std::mutex> g(impl_->m);
    if (impl_->refs++ == 0 && !impl_->th.joinable()) {
        impl_->stop = false;
        impl_->th = std::thread([this] { impl_->threadMain(); });
    }
}

void Manager::release() {
    std::thread t;
    {
        std::lock_guard<std::mutex> g(impl_->m);
        if (impl_->refs <= 0) return;
        if (--impl_->refs > 0) return;
        impl_->stop = true;
        impl_->cancelRequested = true;
        t = std::move(impl_->th);
    }
    impl_->cv.notify_all();
    if (t.joinable()) t.join();
    std::lock_guard<std::mutex> g(impl_->m);
    impl_->cancelRequested = false;
    if (impl_->ui.phase == Phase::Starting || impl_->ui.phase == Phase::WaitingApproval) {
        impl_->ui.phase = Phase::Idle;
        impl_->ui.userCode.clear();
    }
}

void Manager::startActivation() {
    {
        std::lock_guard<std::mutex> g(impl_->m);
        if (impl_->ui.phase == Phase::Starting || impl_->ui.phase == Phase::WaitingApproval) return;
        impl_->activationRequested = true;
        impl_->ui.phase = Phase::Starting;
        impl_->ui.message = "Conectando con JasWave…";
        impl_->bumpSerial();
    }
    impl_->cv.notify_all();
}

void Manager::cancelActivation() {
    {
        std::lock_guard<std::mutex> g(impl_->m);
        impl_->cancelRequested = true;
        impl_->activationRequested = false;
    }
    impl_->cv.notify_all();
}

UiStatus Manager::uiStatus() const {
    std::lock_guard<std::mutex> g(impl_->m);
    UiStatus s = impl_->ui;
    s.state = state_.load(std::memory_order_acquire);
    return s;
}

#ifdef JW_LICENSE_TESTING
void Manager::testOverride(uint64_t state, const UiStatus& st) {
    std::lock_guard<std::mutex> g(impl_->m);
    impl_->testMode = true;
    impl_->ui = st;
    impl_->ui.state = state;
    state_.store(state, std::memory_order_release);
    impl_->bumpSerial();
}
#endif

} // namespace JasWaveLicense
