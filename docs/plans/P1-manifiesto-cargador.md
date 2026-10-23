# P1 — Manifiesto universal jaswave-plugin.json y cargador

**Depende de:** K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`shared/src/plugins/manifiesto.ts`, `jas-wave/electron/plugins/`

## Criterios de aceptación
Parser zod del esquema V5 §2.2 + extensiones; verificación SHA-256; watchdog ⇒ cuarentena (reutiliza `quarantine.ts`); worker_threads para aiSkill con permisos aplicados; tests `node:test`.

## Checklist
- [ ] Implementación
- [ ] Tests automatizados
- [ ] Verificación reproducible documentada

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- (vacío: workstream pendiente)
