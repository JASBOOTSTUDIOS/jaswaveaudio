#include "jw_license_core.h"
#include "jw_json.h"

extern "C" {
#include "monocypher-ed25519.h"
}

#include <cmath>
#include <cstring>

namespace JasWaveLicense {

const char* verifyResultText(VerifyResult r) {
    switch (r) {
        case VerifyResult::Ok: return "ok";
        case VerifyResult::Malformed: return "licencia mal formada";
        case VerifyResult::BadSignature: return "firma inválida";
        case VerifyResult::Expired: return "licencia caducada";
        case VerifyResult::NotYetValid: return "reloj del sistema anterior a la emisión";
    }
    return "?";
}

namespace {
int b64Index(char c, bool url) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (url) {
        if (c == '-') return 62;
        if (c == '_') return 63;
    } else {
        if (c == '+') return 62;
        if (c == '/') return 63;
    }
    return -1;
}

bool decodeImpl(std::string_view in, std::vector<uint8_t>& out, bool url) {
    out.clear();
    while (!in.empty() && in.back() == '=') in.remove_suffix(1);
    if (in.size() % 4 == 1) return false;
    out.reserve(in.size() * 3 / 4);
    uint32_t acc = 0;
    int bits = 0;
    for (const char c : in) {
        const int v = b64Index(c, url);
        if (v < 0) return false;
        acc = (acc << 6) | static_cast<uint32_t>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<uint8_t>((acc >> bits) & 0xFF));
        }
    }
    // los bits sobrantes deben ser cero (codificación canónica)
    if (bits > 0 && (acc & ((1u << bits) - 1u)) != 0) return false;
    return true;
}
} // namespace

bool base64UrlDecode(std::string_view in, std::vector<uint8_t>& out) { return decodeImpl(in, out, true); }

bool base64Decode(std::string_view in, std::vector<uint8_t>& out) {
    std::string clean;
    clean.reserve(in.size());
    for (const char c : in) if (c != '\r' && c != '\n' && c != ' ' && c != '\t') clean.push_back(c);
    return decodeImpl(clean, out, false);
}

std::string base64UrlEncode(const uint8_t* data, size_t n) {
    static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    std::string out;
    out.reserve((n * 4 + 2) / 3);
    uint32_t acc = 0;
    int bits = 0;
    for (size_t i = 0; i < n; ++i) {
        acc = (acc << 8) | data[i];
        bits += 8;
        while (bits >= 6) { bits -= 6; out.push_back(tbl[(acc >> bits) & 63]); }
    }
    if (bits > 0) out.push_back(tbl[(acc << (6 - bits)) & 63]);
    return out;
}

bool publicKeyFromPem(std::string_view pem, uint8_t out[32]) {
    const std::string_view begin = "-----BEGIN PUBLIC KEY-----";
    const std::string_view end = "-----END PUBLIC KEY-----";
    const size_t b = pem.find(begin);
    const size_t e = pem.find(end);
    if (b == std::string_view::npos || e == std::string_view::npos || e <= b) return false;
    std::vector<uint8_t> der;
    if (!base64Decode(pem.substr(b + begin.size(), e - b - begin.size()), der)) return false;
    // SubjectPublicKeyInfo Ed25519: 30 2a 30 05 06 03 2b 65 70 03 21 00 || clave(32)
    static const uint8_t prefix[12] = { 0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00 };
    if (der.size() != 44 || std::memcmp(der.data(), prefix, sizeof prefix) != 0) return false;
    std::memcpy(out, der.data() + 12, 32);
    return true;
}

namespace {
bool readInt(const JsonValue& o, std::string_view key, int64_t& v) {
    const JsonValue* x = o.get(key);
    if (!x || !x->isNumber()) return false;
    const double d = x->num();
    if (!(d >= 0.0 && d < 9.0e15) || std::floor(d) != d) return false;
    v = static_cast<int64_t>(d);
    return true;
}
} // namespace

VerifyResult verifyToken(std::string_view token, const uint8_t publicKey[32], int64_t nowSec, Claims* out) {
    if (token.size() > 16 * 1024) return VerifyResult::Malformed;
    // recorta espacios / saltos de línea finales (archivo editado a mano)
    while (!token.empty() && (token.back() == '\n' || token.back() == '\r' || token.back() == ' ' || token.back() == '\t'))
        token.remove_suffix(1);
    while (!token.empty() && (token.front() == ' ' || token.front() == '\t' || token.front() == '\n' || token.front() == '\r'))
        token.remove_prefix(1);
    if (token.substr(0, 5) != "jwl1.") return VerifyResult::Malformed;
    const size_t dot2 = token.find('.', 5);
    if (dot2 == std::string_view::npos || token.find('.', dot2 + 1) != std::string_view::npos) return VerifyResult::Malformed;
    const std::string_view signedPart = token.substr(0, dot2);
    const std::string_view payloadB64 = token.substr(5, dot2 - 5);
    const std::string_view sigB64 = token.substr(dot2 + 1);

    std::vector<uint8_t> sig, payload;
    if (!base64UrlDecode(sigB64, sig) || sig.size() != 64) return VerifyResult::Malformed;
    if (!base64UrlDecode(payloadB64, payload) || payload.empty()) return VerifyResult::Malformed;

    if (crypto_ed25519_check(sig.data(), publicKey, reinterpret_cast<const uint8_t*>(signedPart.data()), signedPart.size()) != 0)
        return VerifyResult::BadSignature;

    // La firma es válida: el contenido viene del emisor; aun así se valida estrictamente.
    JsonValue root;
    if (!JsonValue::parse(std::string_view(reinterpret_cast<const char*>(payload.data()), payload.size()), root) || !root.isObject())
        return VerifyResult::Malformed;
    Claims c;
    c.sub = root.getString("sub");
    c.email = root.getString("email");
    c.dispositivo = root.getString("dispositivo");
    if (!readInt(root, "exp", c.exp)) return VerifyResult::Malformed;
    readInt(root, "iat", c.iat);
    if (const JsonValue* prods = root.get("productos")) {
        if (!prods->isObject()) return VerifyResult::Malformed;
        for (const auto& m : prods->members()) {
            if (!m.second.isArray()) return VerifyResult::Malformed;
            std::vector<std::string> acciones;
            for (const auto& a : m.second.items()) if (a.isString()) acciones.push_back(a.str());
            c.productos[m.first] = std::move(acciones);
        }
    }
    if (out) *out = c;
    if (c.exp <= nowSec) return VerifyResult::Expired;
    if (c.iat > 0 && nowSec + 300 < c.iat) return VerifyResult::NotYetValid;
    return VerifyResult::Ok;
}

bool productAccess(const Claims& c, std::string_view productId, const char* const* featureKeys, int featureCount, uint32_t* mask) {
    if (mask) *mask = 0;
    const auto it = c.productos.find(std::string(productId));
    if (it == c.productos.end()) return false;
    uint32_t m = 0;
    for (int i = 0; i < featureCount && i < 32; ++i) {
        for (const auto& a : it->second) {
            if (a == featureKeys[i]) { m |= 1u << i; break; }
        }
    }
    if (mask) *mask = m;
    return true;
}

} // namespace JasWaveLicense
