# L2 — Licencia dentro de cada VST (device-code, Ed25519, offline 24 h)

**Depende de:** L1, V1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`plugins/shared-license/`

## Criterios de aceptación
Sin licencia ⇒ overlay 'Iniciar sesión' y bypass limpio; feature no concedida ⇒ control bloqueado y DSP desactivado; verificación de firma offline; lectura atómica desde el hilo de audio.

## Checklist
- [x] Monocypher 4.0.3 vendorizado (SHA-512 verificado, licencia conservada) y clave pública incrustada desde el PEM en CMake
- [x] §3–§4 del contrato: device-code (ShellExecuteW), poll, renovar con tokenDispositivo (DPAPI sin entropía), WinHTTP,
      escritura atómica, renovación en hilo de fondo (< 6 h, backoff), mutex con nombre entre procesos, relectura de
      device.bin tras 401
- [x] Estado lock-free para el audio; sin licencia ⇒ bypass con fundido; feature ausente ⇒ DSP desactivado + candado en UI
- [x] Tests: vectores RFC 8032, licencias firmadas por Node (válida, caducada, payload alterado, otra clave, producto
      ausente, feature ausente, iat futuro) y E2E contra backend falso

## Verificación
```bat
plugins\build\tests\Release\jw_license_tests.exe                       :: RFC 8032 + licencias firmadas por Node
node plugins/tests/license/run-e2e.mjs plugins/build/tests/Release/jw_license_e2e.exe   :: device-code, renovación, revocación
node plugins/tests/license/make-fixtures.mjs                          :: regenera fixtures (clave de PRUEBA efímera)
```

## Notas de traspaso
- 2026-10-23 · Claude Opus 5.5. Hecho (falta probar contra el backend real cuando `/license/device/renovar` esté publicado).
- El sabor `jw_license_testing` (solo binarios de prueba/capturas) permite `JASWAVE_LICENSE_DIR`, `JW_LICENSE_TEST_PUBKEY_HEX`
  y `JASWAVE_LICENSE_NO_BROWSER`; los .vst3 enlazan `jw_license` sin esos ganchos.
- 401/403 en renovación borran la licencia local (401 también device.bin). Con licencia caducada y device.bin presente el
  VST renueva solo al arrancar.
- `dispositivo` = nombre DNS del equipo; no se exige que coincida con el del token.
