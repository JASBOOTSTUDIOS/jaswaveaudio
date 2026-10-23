# W1 — Cliente web (arrangement, piano roll, Web MIDI)

**Depende de:** B0, K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/src/platform/`, `jas-wave/components/arrangement/`, `jas-wave/components/piano-roll*.tsx`

## Criterios de aceptación
`npm run build:web` genera bundle; flujo de edición MIDI en navegador sin Electron (e2e); Web MIDI operativo.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
