# H1 — Handover web → desktop (jaswave://)

**Depende de:** S1, W1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/electron/instancia-unica.ts`, `jas-wave/electron/main.ts`, `jas-wave/electron-builder.cjs`, `backend/src/handover/`

## Criterios de aceptación
Token one-time de 60 s; registro del protocolo en NSIS; cursor/selección/reproducción restaurados en < 3 s (medido en test); reabre instancia existente.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
