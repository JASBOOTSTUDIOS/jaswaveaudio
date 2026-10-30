# Monocypher 4.0.3 (vendorizado)

- Origen: release oficial `https://monocypher.org/download/monocypher-4.0.3.tar.gz`
- SHA-512 del tarball (coincide con `monocypher-4.0.3.tar.gz.sha512` publicado):
  `40904ada5c7ee4f7741733e38b69a30a4b0561cbffba5ffe7c2dce16136d540251ec0d9056ff606510d3b5b708fb8a40db7e0870d4a0b2dc17ba2bfb880f8965`
- Licencia: BSD-2-Clause o CC0-1.0 a elección (`LICENCE.md`). Autores en `AUTHORS.md`.
- Archivos copiados sin modificar: `src/monocypher.{c,h}` y `src/optional/monocypher-ed25519.{c,h}`
  (Ed25519 con SHA-512, compatible con RFC 8032 y con `crypto.sign(null, …)` de Node).
- Revisión: código C puro sin E/S, red, asignación dinámica ni ensamblador; solo incluye `<stddef.h>` y `<stdint.h>`.

Uso en JasWave: solo `crypto_ed25519_check` (verificación de licencias `jwl1`) y, en las pruebas,
`crypto_ed25519_key_pair`/`crypto_ed25519_sign` para los vectores RFC 8032.
