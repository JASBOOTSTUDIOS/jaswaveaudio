// Pruebas del núcleo de licencias jwl1 (L2):
//  - Ed25519 de Monocypher contra los vectores de RFC 8032 §7.1
//  - Licencias firmadas por Node (clave de prueba): válida, caducada, payload alterado,
//    firma de otra clave, producto ausente, feature ausente, iat futuro, cadenas escapadas
//  - base64url, JSON, PEM y la clave de producción incrustada en build
#include "jw_json.h"
#include "jw_license_core.h"
#include "fixtures.h"

extern "C" {
#include "monocypher-ed25519.h"
}

#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#ifdef JW_HAVE_PROD_KEY
#include "jw_license_pubkey.h"
#endif

using namespace JasWaveLicense;

static int gFails = 0, gChecks = 0;
#define CHECK(cond, msg)                                                         \
    do {                                                                         \
        ++gChecks;                                                               \
        if (!(cond)) { ++gFails; std::printf("  FALLO: %s  (%s:%d)\n", msg, __FILE__, __LINE__); } \
    } while (0)

static std::vector<uint8_t> hex(const char* h) {
    std::vector<uint8_t> v;
    for (size_t i = 0; h[i] && h[i + 1]; i += 2) {
        unsigned x = 0;
        std::sscanf(h + i, "%2x", &x);
        v.push_back(static_cast<uint8_t>(x));
    }
    return v;
}

static void testRfc8032() {
    std::printf("[RFC 8032 §7.1] Ed25519\n");
    struct V { const char *sk, *pk, *msg, *sig; };
    const V vs[] = {
        { "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
          "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b" },
        { "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
          "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00" },
        { "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7", "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82",
          "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a" },
        { "833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42", "ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf",
          "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
          "dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704" },
    };
    int idx = 1;
    for (const V& v : vs) {
        const auto seed = hex(v.sk), pk = hex(v.pk), msg = hex(v.msg), sig = hex(v.sig);
        uint8_t sk64[64], pkOut[32], seedCopy[32], sigOut[64];
        std::memcpy(seedCopy, seed.data(), 32);
        crypto_ed25519_key_pair(sk64, pkOut, seedCopy);
        CHECK(std::memcmp(pkOut, pk.data(), 32) == 0, "clave pública derivada = RFC");
        crypto_ed25519_sign(sigOut, sk64, msg.data(), msg.size());
        CHECK(std::memcmp(sigOut, sig.data(), 64) == 0, "firma = RFC");
        CHECK(crypto_ed25519_check(sig.data(), pk.data(), msg.data(), msg.size()) == 0, "verificación de la firma RFC");
        auto bad = sig;
        bad[10] ^= 0x01;
        CHECK(crypto_ed25519_check(bad.data(), pk.data(), msg.data(), msg.size()) != 0, "firma alterada rechazada");
        if (!msg.empty()) {
            auto m2 = msg;
            m2[0] ^= 0x80;
            CHECK(crypto_ed25519_check(sig.data(), pk.data(), m2.data(), m2.size()) != 0, "mensaje alterado rechazado");
        }
        std::printf("  TEST %d ok\n", idx++);
    }
}

static void testBase64AndJson() {
    std::printf("[base64url / JSON / PEM]\n");
    std::vector<uint8_t> out;
    CHECK(base64UrlDecode("aGVsbG8", out) && std::string(out.begin(), out.end()) == "hello", "base64url sin relleno");
    CHECK(base64UrlDecode("aGVsbG8=", out), "base64url con relleno");
    CHECK(!base64UrlDecode("aGV+bG8", out), "carácter '+' rechazado en base64url");
    CHECK(!base64UrlDecode("aGVsbG9", out), "bits sobrantes no canónicos rechazados");
    const uint8_t raw[5] = { 0xfb, 0xff, 0x00, 0x10, 0x7f };
    CHECK(base64UrlDecode(base64UrlEncode(raw, 5), out) && out.size() == 5 && std::memcmp(out.data(), raw, 5) == 0, "ida y vuelta base64url");

    JsonValue j;
    CHECK(JsonValue::parse(R"({"a":[1,2,{"b":"ñ🎹"}],"c":true,"d":null,"e":-1.5e2})", j), "JSON válido");
    CHECK(j.get("a") && j.get("a")->items().size() == 3, "array");
    CHECK(j.get("a")->items()[2].getString("b") == "\xC3\xB1\xF0\x9F\x8E\xB9", "escapes \\u y pares sustitutos");
    CHECK(j.getNumber("e") == -150.0, "número con exponente");
    CHECK(!JsonValue::parse(R"({"a":1,})", j), "coma final rechazada");
    CHECK(!JsonValue::parse(R"({"a":"\ud800"})", j), "sustituto suelto rechazado");
    CHECK(!JsonValue::parse(std::string(40, '[') + std::string(40, ']'), j), "profundidad excesiva rechazada");
    CHECK(jsonQuote("a\"b\\c\n\x01") == "\"a\\\"b\\\\c\\n\\u0001\"", "jsonQuote escapa");

    uint8_t key[32];
    CHECK(publicKeyFromPem(JwLicenseFixtures::kTestPublicPem, key) && std::memcmp(key, JwLicenseFixtures::kTestPublicKey, 32) == 0,
          "PEM SPKI Ed25519 -> 32 bytes");
    CHECK(!publicKeyFromPem("-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----", key), "PEM no Ed25519 rechazado");
}

static void testFixtures() {
    using namespace JwLicenseFixtures;
    std::printf("[licencias jwl1 firmadas por Node con clave de prueba]\n");
    const int64_t now = kNow;
    Claims c;
    static const char* const eqFeatures[] = { "eq.bandas-avanzadas", "eq.pendientes-altas", "eq.analizador" };
    static const char* const compFeatures[] = { "comp.filtro-sidechain", "comp.mezcla-paralela" };
    uint32_t mask = 0;

    CHECK(verifyToken(kValid, kTestPublicKey, now, &c) == VerifyResult::Ok, "válida verifica");
    CHECK(c.email == "prueba@jaswave.test" && c.dispositivo == "Reaper-PC" && c.exp == 1792786400 && c.iat == 1792700000, "claims leídos");
    CHECK(productAccess(c, "com.jaswave.plugin.param-eq", eqFeatures, 3, &mask) && mask == 0b101, "producto con features (bandas-avanzadas, analizador)");
    CHECK(productAccess(c, "com.jaswave.plugin.bus-compressor", compFeatures, 2, &mask) && mask == 0b10, "feature ausente -> bit a 0 (filtro-sidechain)");
    CHECK(productAccess(c, "com.jaswave.plugin.truepeak-limiter", nullptr, 0, &mask) && mask == 0, "producto con lista vacía = acceso básico");
    CHECK(!productAccess(c, "com.jaswave.plugin.utility-tool", nullptr, 0, &mask), "producto ausente -> sin acceso");

    CHECK(verifyToken(kValid, kTestPublicKey, 1792786400, &c) == VerifyResult::Expired, "exp == ahora -> caducada");
    CHECK(verifyToken(kExpired, kTestPublicKey, now, &c) == VerifyResult::Expired, "licencia caducada");
    CHECK(verifyToken(kAlteredPayload, kTestPublicKey, now, &c) == VerifyResult::BadSignature, "payload alterado -> firma inválida");
    CHECK(verifyToken(kOtherKey, kTestPublicKey, now, &c) == VerifyResult::BadSignature, "firmada con otra clave -> rechazada");
    CHECK(verifyToken(kOtherKey, kOtherPublicKey, now, &c) == VerifyResult::Ok, "la misma, con su clave, sí verifica");
    CHECK(verifyToken(kNoProduct, kTestPublicKey, now, &c) == VerifyResult::Ok, "token sin el producto verifica…");
    CHECK(!productAccess(c, "com.jaswave.plugin.param-eq", eqFeatures, 3, &mask), "…pero no da acceso al producto ausente");
    CHECK(verifyToken(kFutureIat, kTestPublicKey, now, &c) == VerifyResult::NotYetValid, "iat en el futuro (reloj atrasado) -> rechazada");
    CHECK(verifyToken(kEscapedStrings, kTestPublicKey, now, &c) == VerifyResult::Ok && c.email == "jos\xC3\xA9+\xC3\xB1@jaswave.test" &&
              c.dispositivo == "Estudio \"A\"\\PC",
          "cadenas con escapes JSON");

    // Malformados
    CHECK(verifyToken("", kTestPublicKey, now, &c) == VerifyResult::Malformed, "vacío");
    CHECK(verifyToken("jwl2.abc.def", kTestPublicKey, now, &c) == VerifyResult::Malformed, "prefijo distinto");
    CHECK(verifyToken("jwl1.abc", kTestPublicKey, now, &c) == VerifyResult::Malformed, "sin firma");
    CHECK(verifyToken("jwl1.a.b.c", kTestPublicKey, now, &c) == VerifyResult::Malformed, "demasiadas partes");
    std::string truncated = kValid;
    truncated.pop_back();
    CHECK(verifyToken(truncated, kTestPublicKey, now, &c) != VerifyResult::Ok, "firma truncada");
    std::string withNewline = std::string(kValid) + "\r\n";
    CHECK(verifyToken(withNewline, kTestPublicKey, now, &c) == VerifyResult::Ok, "salto de línea final tolerado (archivo)");
}

static void testProductionKey() {
#ifdef JW_HAVE_PROD_KEY
    std::printf("[clave de producción incrustada]\n");
    std::ifstream f(JW_PROD_PEM_PATH, std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    uint8_t key[32];
    CHECK(publicKeyFromPem(ss.str(), key), "licencia_publica.pem es Ed25519");
    CHECK(std::memcmp(key, kJwLicensePublicKey, 32) == 0, "header generado por CMake = PEM");
    CHECK(verifyToken(JwLicenseFixtures::kValid, kJwLicensePublicKey, JwLicenseFixtures::kNow, nullptr) == VerifyResult::BadSignature,
          "una licencia de prueba NO verifica con la clave de producción");
#endif
}

int main() {
    testRfc8032();
    testBase64AndJson();
    testFixtures();
    testProductionKey();
    std::printf("\n%d comprobaciones, %d fallos\n", gChecks, gFails);
    std::printf(gFails == 0 ? "LICENSE TESTS: OK\n" : "LICENSE TESTS: FALLO\n");
    return gFails == 0 ? 0 : 1;
}
