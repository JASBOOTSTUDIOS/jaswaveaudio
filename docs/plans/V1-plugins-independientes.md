# V1 — Plugins VST3 independientes en plugins/

**Depende de:** K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`plugins/*`, `plugins/CMakeLists.txt`, `native/` (retiro de jaswave-fx)

## Criterios de aceptación
Cada plugin compila en Release con CMake propio; manifiestos V5 con metadatos IA y features licenciables; roles-vst y piano-synth movidos; `dsp_selftest` verde.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
