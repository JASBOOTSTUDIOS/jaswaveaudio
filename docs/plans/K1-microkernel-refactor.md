# K1 — Microkernel: núcleo sin dependencias estáticas de plugins

**Depende de:** —
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/src/lib/plugin/bundled-plugins.ts`, `native/plugin-host/CMakeLists.txt`, `native/scripts/build-native.mjs`, `jas-wave/scripts/stage-plugin-host.mjs`

## Criterios de aceptación
El núcleo compila y arranca sin ningún plugin concreto presente; los plugins se resuelven desde el registro de manifiestos; build nativo del host verde.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
