# P1 — Manifiesto universal jaswave-plugin.json y cargador

**Depende de:** K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`shared/src/plugins/manifiesto.ts`, `jas-wave/electron/plugins/`

## Criterios de aceptación
Parser zod del esquema V5 §2.2 + extensiones; verificación SHA-256; watchdog ⇒ cuarentena (reutiliza `quarantine.ts`); worker_threads para aiSkill con permisos aplicados; tests `node:test`.

## Checklist
- [x] Manifiesto V5 (zod), escáner con integridad, herramientas IA, catálogo del DAW
- [x] Watchdog conectado: vigilancia en main con getSlotStats (bypass + cuarentena + aviso)
- [x] Tests (unitarios, integración del escáner, e2e en Electron real)
- [ ] Cargador de aiSkill en Web Worker y módulos UI (ningún plugin actual los declara; queda para cuando exista uno)

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- electron/plugins/vigilancia.ts sondea getSlotStats (reset) cada 1 s solo con host nativo; acumula excepciones; decide con watchdog.ts; setBypass en todas las instancias, ponerPluginEnCuarentena y evento plugin-cuarentena al renderer (desactiva herramientas IA y muestra aviso).
- getSlotStats no está en el allowlist del renderer (solo main lo usa); e2e lo comprueba.
- Los 7 manifiestos reales validan con el esquema V5 (guarda en src/lib/plugins/manifiestos-repo.test.ts).
- Pendiente honesto: aiSkill/ui por worker y protocolo jaswave-plugin:// — ningún plugin actual declara esos entrypoints.
