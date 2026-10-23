# W2 — WebSynth y stem freezing para VST en web

**Depende de:** W1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/lib/web-synth/`, `jas-wave/src/lib/plugin/vst-voice-router.ts`

## Criterios de aceptación
Pistas VST reproducen con WebSynth sin host nativo; stems congelados se reproducen manteniendo MIDI editable; test de audio no nulo.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
