// =====================================================================================
//  JasWave – núcleo portable de licencias `jwl1` (CONTRATO-V5 §2)
//    jwl1.<payload base64url>.<firma Ed25519 base64url>
//    firma Ed25519 (RFC 8032) sobre los bytes ASCII de "jwl1.<payload base64url>"
//  Sin red ni E/S: verificable en pruebas con cualquier clave pública.
// =====================================================================================
#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace JasWaveLicense {

struct Claims {
    std::string sub;
    std::string email;
    std::string dispositivo;
    std::map<std::string, std::vector<std::string>> productos;   // productId -> acciones
    int64_t iat{0};
    int64_t exp{0};
};

enum class VerifyResult : uint8_t {
    Ok = 0,
    Malformed,        // estructura, base64url o JSON inválidos
    BadSignature,     // firma no verifica con la clave pública
    Expired,          // exp <= ahora
    NotYetValid,      // reloj muy anterior a iat (más de 5 min): reloj manipulado
};

const char* verifyResultText(VerifyResult r);

// base64url sin relleno (también acepta relleno '=' final). false si hay caracteres inválidos.
bool base64UrlDecode(std::string_view in, std::vector<uint8_t>& out);
std::string base64UrlEncode(const uint8_t* data, size_t n);
// base64 estándar (para PEM)
bool base64Decode(std::string_view in, std::vector<uint8_t>& out);

// Clave pública Ed25519 desde PEM SPKI ("-----BEGIN PUBLIC KEY-----"). false si no es Ed25519.
bool publicKeyFromPem(std::string_view pem, uint8_t out[32]);

// Verifica firma + caducidad. `out` se rellena si la estructura y la firma son válidas
// (también cuando el resultado es Expired / NotYetValid, para mostrar información en la UI).
VerifyResult verifyToken(std::string_view token, const uint8_t publicKey[32], int64_t nowSec, Claims* out);

// Acceso de un producto: true si `productos` contiene `productId`.
// `mask` recibe un bit por cada feature de `featureKeys` concedida (bit i <=> featureKeys[i]).
bool productAccess(const Claims& c, std::string_view productId, const char* const* featureKeys, int featureCount, uint32_t* mask);

} // namespace JasWaveLicense
