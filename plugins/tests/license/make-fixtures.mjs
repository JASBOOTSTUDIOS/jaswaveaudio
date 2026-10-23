// Genera plugins/tests/license/fixtures.h: licencias `jwl1` firmadas con un par de claves de PRUEBA
// (Node crypto / OpenSSL, implementación independiente de Monocypher). Las claves privadas se
// descartan: solo se guardan la clave pública de prueba y los tokens.
//   node plugins/tests/license/make-fixtures.mjs
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const b64u = (buf) => Buffer.from(buf).toString('base64url')

const test = crypto.generateKeyPairSync('ed25519')
const other = crypto.generateKeyPairSync('ed25519')
const rawPub = (k) => Buffer.from(k.publicKey.export({ format: 'jwk' }).x, 'base64url')

function sign(payload, keyPair) {
  const p = b64u(JSON.stringify(payload))
  const sig = crypto.sign(null, Buffer.from(`jwl1.${p}`), keyPair.privateKey)
  return `jwl1.${p}.${b64u(sig)}`
}

const NOW = 1792750000 // "ahora" fijo de las pruebas
const base = {
  sub: 'usr_prueba_01',
  email: 'prueba@jaswave.test',
  dispositivo: 'Reaper-PC',
  productos: {
    'com.jaswave.plugin.param-eq': ['eq.bandas-avanzadas', 'eq.analizador'],
    'com.jaswave.plugin.bus-compressor': ['comp.mezcla-paralela'],
    'com.jaswave.plugin.truepeak-limiter': [],
  },
  iat: 1792700000,
  exp: 1792786400,
}

const valid = sign(base, test)
const expired = sign({ ...base, iat: 1792600000, exp: 1792686400 }, test)
// payload alterado: se cambia el payload manteniendo la firma original
const [, , sigValid] = valid.split('.')
const altered = `jwl1.${b64u(JSON.stringify({ ...base, exp: 1999999999 }))}.${sigValid}`
const otherKey = sign(base, other)
const noProducts = sign({ ...base, productos: { 'com.jaswave.plugin.utility-tool': ['utilidad.mono-graves'] } }, test)
const futureIat = sign({ ...base, iat: NOW + 3600, exp: NOW + 90000 }, test)
const escaped = sign({ ...base, email: 'josé+ñ@jaswave.test', dispositivo: 'Estudio "A"\\PC' }, test)

const hex = (buf) => [...buf].map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')
const out = `// Generado por make-fixtures.mjs (Node ${process.version}). No editar a mano.
// Claves de PRUEBA (las privadas se descartaron). NO es la clave de producción.
#pragma once
#include <cstdint>
namespace JwLicenseFixtures {
constexpr int64_t kNow = ${NOW};
static const uint8_t kTestPublicKey[32] = { ${hex(rawPub(test))} };
static const uint8_t kOtherPublicKey[32] = { ${hex(rawPub(other))} };
static const char* const kTestPublicPem = R"PEM(${test.publicKey.export({ type: 'spki', format: 'pem' }).trim()})PEM";
static const char* const kValid = "${valid}";
static const char* const kExpired = "${expired}";
static const char* const kAlteredPayload = "${altered}";
static const char* const kOtherKey = "${otherKey}";
static const char* const kNoProduct = "${noProducts}";
static const char* const kFutureIat = "${futureIat}";
static const char* const kEscapedStrings = "${escaped}";
} // namespace JwLicenseFixtures
`
fs.writeFileSync(path.join(here, 'fixtures.h'), out)
console.log('fixtures.h escrito')
