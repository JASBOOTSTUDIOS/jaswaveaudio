// E2E del Manager de licencias contra el backend falso de run-e2e.mjs (no ejecutar a mano).
//   jw_license_e2e activate | renew-expired | revoked
// Variables (las fija run-e2e.mjs): JASWAVE_LICENSE_DIR, JASWAVE_API_URL, JASWAVE_WEB_URL,
// JASWAVE_LICENSE_NO_BROWSER, JW_LICENSE_TEST_PUBKEY_HEX. Requiere el sabor jw_license_testing.
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <wincrypt.h>

#include "jw_license.h"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

using namespace JasWaveLicense;

static const char* const kFeatures[] = { "eq.bandas-avanzadas", "eq.pendientes-altas", "eq.analizador" };

static std::string readDeviceToken() {
    const std::wstring path = licenseDir() + L"\\device.bin";
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) return "";
    char buf[4096];
    DWORD rd = 0;
    ReadFile(h, buf, sizeof buf, &rd, nullptr);
    CloseHandle(h);
    DATA_BLOB in{ rd, reinterpret_cast<BYTE*>(buf) }, out{};
    if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out)) return "<dpapi-error>";
    std::string s(reinterpret_cast<char*>(out.pbData), out.cbData);
    LocalFree(out.pbData);
    return s;
}

static bool fileExists(const wchar_t* name) {
    return GetFileAttributesW((licenseDir() + L"\\" + name).c_str()) != INVALID_FILE_ATTRIBUTES;
}

template <class Pred>
static bool waitFor(Pred p, int seconds) {
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (std::chrono::steady_clock::now() < end) {
        if (p()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    return p();
}

int main(int argc, char** argv) {
    const std::string mode = argc > 1 ? argv[1] : "activate";
    Manager& m = Manager::instance();
    m.configure({ "com.jaswave.plugin.param-eq", kFeatures, 3 });
    m.acquire();
    int rc = 0;
    auto report = [&](const char* what) {
        const UiStatus s = m.uiStatus();
        std::printf("[%s] licensed=%d features=0x%llx phase=%d email=%s code=%s msg=%s exp=%lld\n", what, isLicensed(s.state) ? 1 : 0,
                    static_cast<unsigned long long>(s.state >> StateBits::kFeatureShift), static_cast<int>(s.phase), s.email.c_str(),
                    s.userCode.c_str(), s.message.c_str(), static_cast<long long>(s.expiresAt));
    };

    if (mode == "activate") {
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        if (isLicensed(m.state())) { std::printf("ERROR: licencia antes de activar\n"); rc = 1; }
        report("inicio");
        m.startActivation();
        if (!waitFor([&] { return m.uiStatus().phase == Phase::WaitingApproval; }, 10)) { std::printf("ERROR: no llegó a WaitingApproval\n"); rc = 1; }
        report("esperando");
        if (!waitFor([&] { return isLicensed(m.state()); }, 30)) { std::printf("ERROR: no se activó\n"); rc = 1; }
        report("activado");
        const uint64_t s = m.state();
        if (!hasFeature(s, 0) || hasFeature(s, 1) || !hasFeature(s, 2)) { std::printf("ERROR: features inesperadas\n"); rc = 1; }
        // La licencia emitida es corta (< 6 h): el hilo de fondo debe renovarla en seguida
        // (el token de dispositivo rota de dev-1-* a dev-2-* en la renovación)
        if (!waitFor([&] { const std::string t = readDeviceToken(); return t.rfind("dev-", 0) == 0 && t.rfind("dev-1-", 0) != 0; }, 20)) {
            std::printf("ERROR: no renovó\n");
            rc = 1;
        }
        report("renovado");
        std::printf("DEVICE_TOKEN=%s\n", readDeviceToken().c_str());
        std::printf("FILES license=%d device=%d\n", fileExists(L"license.jwl") ? 1 : 0, fileExists(L"device.bin") ? 1 : 0);
    } else if (mode == "renew-expired") {
        // license.jwl caducada en disco + device.bin válido -> renovación automática al arrancar
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        report("inicio");
        if (!waitFor([&] { return isLicensed(m.state()); }, 20)) { std::printf("ERROR: no renovó la licencia caducada\n"); rc = 1; }
        report("renovado");
        std::printf("DEVICE_TOKEN=%s\n", readDeviceToken().c_str());
    } else if (mode == "revoked") {
        // el backend responde 401 dispositivo_revocado: se borran licencia y token
        if (!waitFor([&] { return !fileExists(L"license.jwl") && !fileExists(L"device.bin"); }, 20)) {
            std::printf("ERROR: no borró la licencia revocada\n");
            rc = 1;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        report("revocado");
        if (isLicensed(m.state())) { std::printf("ERROR: sigue con licencia tras 401\n"); rc = 1; }
    }
    m.release();
    std::printf(rc == 0 ? "E2E %s: OK\n" : "E2E %s: FALLO\n", mode.c_str());
    return rc;
}
