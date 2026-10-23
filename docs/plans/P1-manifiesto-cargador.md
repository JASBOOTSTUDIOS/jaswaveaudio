# P1 — Manifiesto universal jaswave-plugin.json y cargador

**Depende de:** K1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`shared/src/plugins/manifiesto.ts`, `jas-wave/electron/plugins/`

## Criterios de aceptación
Parser zod del esquema V5 §2.2 + extensiones; verificación SHA-256; watchdog ⇒ cuarentena (reutiliza `quarantine.ts`); worker_threads para aiSkill con permisos aplicados; tests `node:test`.

## Checklist
- [x] Implementación (manifiesto, escáner, integridad, registro de herramientas, watchdog puro)
- [x] Tests automatizados
- [ ] Cargador de aiSkill en worker y módulos UI (pendiente)
- [ ] Watchdog conectado al host (pendiente de getSlotStats en native/plugin-host)

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- shared/src/plugins: esquema V5 (zod) y herramientas IA derivadas del manifiesto (describir/ajustar con vstParamId).
- electron/plugins/escaner.ts: paquetes en %LOCALAPPDATA%/JasWave/plugins (+ plugins/ del repo en dev, + JASWAVE_PLUGINS_DIR); integridad SHA-256 contra instalacion.json; IPC plugins-listar.
- El main no valida el esquema (shared es fuente TS no ejecutable en main): lo hace el renderer (registro-plugins.ts).
- electron/plugins/watchdog.ts: lógica pura (saturación 5 muestras > 0.9, 3 excepciones/60 s). Falta el comando getSlotStats del host (encargado al agente nativo) y el bucle de sondeo.
- Pendiente: aiSkill en Web Worker con permisos; módulos UI por protocolo jaswave-plugin://; los manifiestos de plugins/ aún usan el esquema previo (los migra V1) y hoy se rechazan como inválidos.
