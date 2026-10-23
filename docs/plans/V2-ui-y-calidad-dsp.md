# V2 — Rediseño UI cyber y calidad DSP de los VST

**Depende de:** V1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`plugins/shared-ui/`, `plugins/tests/dsp_selftest.cpp`, `plugins/shared-ui/DESIGN.md`

## Criterios de aceptación
Todos los VST siguen DESIGN.md (marco biselado, LEDs, retícula, perillas con glow, faders, osciloscopio); selftest ampliado (RBJ, true-peak, sin asignaciones en process, save/restore); validator VST3 y pluginval sin errores.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
