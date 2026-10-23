// =====================================================================================
//  JasWave – licencia dentro de cada VST (CONTRATO-V5 §2–§4)
//
//  Manager (uno por módulo .vst3):
//   - Carga %APPDATA%\JasWave\license\license.jwl, la verifica offline (Ed25519) y publica
//     el estado en un único std::atomic<uint64_t> (lock-free): el hilo de audio solo hace load().
//   - Hilo de fondo: re-evalúa caducidad, detecta renovaciones hechas por otro plugin/DAW y
//     renueva con `tokenDispositivo` (DPAPI) cuando quedan < 6 h (reintentos con backoff).
//   - Flujo device-code bajo demanda (botón "INICIAR SESIÓN" de la UI): start → navegador → poll.
//  Nunca hay E/S, red ni locks en el hilo de audio.
// =====================================================================================
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>

namespace JasWaveLicense {

struct ProductInfo {
    const char* productId;               // = id del manifiesto
    const char* const* featureKeys;      // features[].key del manifiesto (máx. 24)
    int featureCount;
};

// Palabra de estado publicada atómicamente
namespace StateBits {
constexpr uint64_t kLicensed = 1ull << 0;       // firma válida, no caducada y producto concedido
constexpr uint64_t kExpiringSoon = 1ull << 1;   // < 2 h y la última renovación falló
constexpr int kFeatureShift = 8;                // bit (8 + i) <=> featureKeys[i] concedida
} // namespace StateBits

inline bool isLicensed(uint64_t s) { return (s & StateBits::kLicensed) != 0; }
inline bool hasFeature(uint64_t s, int idx) {
    return idx < 0 ? isLicensed(s) : (isLicensed(s) && ((s >> (StateBits::kFeatureShift + idx)) & 1ull) != 0);
}

enum class Phase : uint8_t {
    Idle,             // sin licencia y sin flujo en curso
    Starting,         // pidiendo código al backend
    WaitingApproval,  // código mostrado; esperando aprobación en el navegador
    Active,           // licencia válida
    Error,            // último intento falló (mensaje en `message`)
};

// Copia para la UI (no usar desde el hilo de audio)
struct UiStatus {
    Phase phase{Phase::Idle};
    uint64_t state{0};
    std::string email;
    std::string userCode;      // XXXX-XXXX durante el flujo
    std::string message;       // texto de error / información (UTF-8)
    int64_t expiresAt{0};      // epoch s de la licencia actual (0 si no hay)
};

class Manager {
public:
    // Instancia única por módulo. `configure` debe llamarse antes de `acquire` (idempotente).
    static Manager& instance();
    void configure(const ProductInfo& info);

    // Cada instancia de Processor/Controller llama acquire()/release(): el hilo de fondo
    // vive mientras haya al menos una referencia.
    void acquire();
    void release();

    // Lectura lock-free (hilo de audio)
    uint64_t state() const noexcept { return state_.load(std::memory_order_acquire); }

    // UI
    void startActivation();
    void cancelActivation();
    UiStatus uiStatus() const;
    uint32_t serial() const noexcept { return serial_.load(std::memory_order_acquire); }  // cambia cuando cambia el estado UI
    const char* productId() const;

#ifdef JW_LICENSE_TESTING
    // Solo en binarios de prueba (capturas, tests): fija el estado sin licencia real.
    void testOverride(uint64_t state, const UiStatus& st);
#endif

    Manager(const Manager&) = delete;
    Manager& operator=(const Manager&) = delete;
    ~Manager();

private:
    Manager();
    struct Impl;
    std::unique_ptr<Impl> impl_;
    std::atomic<uint64_t> state_{0};
    std::atomic<uint32_t> serial_{0};
    friend struct Impl;
};

// Ruta %APPDATA%\JasWave\license (UTF-16). Vacía si no se puede resolver.
std::wstring licenseDir();

} // namespace JasWaveLicense
