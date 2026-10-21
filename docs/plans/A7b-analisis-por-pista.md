# A7b · Análisis por pista y diagnóstico de mezcla

**Objetivo:** que los agentes puedan medir cada pista, la mezcla y la referencia **sin tocar el proyecto ni pedir confirmación**, y
obtener un diagnóstico con evidencia.

## Contexto y hallazgos
- `shared/src/commands/analysis-commands.ts`: todo lee el último render (`latestJobWithAnalysis` `:28-32`); `analysis.loudness
  source:'play'` lee `project.analysis.master` que nunca se escribe (`:68`).
- Stems del bounce: solo clips de audio secos, sin VST ni inserts (`jas-wave/src/lib/bounce-offline-audio.ts:82-125`,
  `bounce-service.ts:226-234`); no se analizan.
- Host: cadena por pista con taps `gPreL/gPostL` (`native/plugin-host/src/main.cpp:877-888`); master aplica cadena + ×1.35 +
  soft limiter (`:945-996`). `getMixMeters` solo picos post-fader (`:2187-2221`, `jas-wave/src/lib/plugin/native-mix-meters.ts`).
- `track-freeze.ts:21-46` usa solo+render (pasa por master) con tope 120 s.
- Referencia: `reference.import` crea pista muteada (`src/lib/audio-import-agent.ts:135-168`); A/B solo mutea (`:170-210`).

## Tareas
- [ ] Host (pendiente C++ · ver Notas de traspaso): `renderOfflineStart` acepta `{analysis:true, tapStems:[stemIdx…]|"all", tap:"pre"|"post", bypassMaster?:true, outDir}`;
      escribe WAV por stem (post-insert, pre/post fader) y master a una carpeta temporal en `userData/analysis/<jobId>/`; streaming
      a disco (no acumular en RAM).
- [x] Bridge (`electron/plugin-host-guard.ts`): permitir `outDir` bajo `userData/analysis/` sin grant del usuario.
- [x] Servicio `jas-wave/src/lib/analysis-render.ts`: `renderForAnalysis({tracks, range, tap, bypassMaster})` → mediciones A7a por stem
      + master; caché por revisión de estado (`getStateRevision`) para no re-renderizar si no cambió; limpieza de temporales.
- [x] Clase de riesgo **read** para el render de análisis (no escribe en rutas del usuario, no confirma) en
      `ai-harness/src/agent/action-policy.ts`.
- [x] Herramientas (registry + catálogo + JSON Schema):
      `analysis.track {trackId, rango?, tap?}`, `analysis.mix {rango?}` (todas las pistas + master + suma),
      `analysis.masking {pares?|auto}` (matriz: energía por banda 1/3 oct de cada par; señala solapamientos críticos, p. ej. kick/bajo
      40–120 Hz, voz/guitarras 1–4 kHz), `analysis.dynamics {trackId?}` (crest, PLR, LRA, transientes),
      `analysis.section {marcador|rango}`, `analysis.reference {trackId}` (analiza referencia, iguala loudness y compara por banda/
      LUFS/ancho/dinámica), `analysis.diagnose` (reglas → `MixDiagnosis[]` con `{problema, severidad, evidencia, pistas, sugerencias}`:
      barro 200–500 Hz, aspereza 2–5 kHz, falta/exceso de sub, sibilancia 5–9 kHz, fase/mono, sobre-compresión (PLR bajo),
      falta de dinámica, enmascaramiento, desequilibrio L/R, clipping, headroom insuficiente).
- [x] `analysis.loudness source:'play'`: medir con render de análisis del rango actual (en lugar de fallar).
- [ ] Medidores vivos (pendiente C++ · ver Notas de traspaso): `getMixMeters` añade RMS y LUFS-M por stem y pre/post (host), expuestos en `native-mix-meters.ts` y en
      `audit.mix` como "lectura rápida".
- [x] `reference.toggleAB` con igualación de loudness y bypass de la cadena master para la referencia.
- [x] Bounce fiel: automatización de pan y de parámetros de plugin en el render offline (hoy solo volumen,
      `bounce-service.ts:236-252`); quitar tope de 120 s (`master-pass.ts:86`, `track-freeze.ts:31`).
- [x] Tests: unit de reglas de diagnóstico con espectros sintéticos; e2e: proyecto con 3 pistas → `analysis.mix` devuelve 3 stems
      con LUFS distintos y no modifica el proyecto (revisión de estado igual).

## Archivos
`native/plugin-host/src/main.cpp`, `jas-wave/electron/{plugin-host-guard,plugin-host-bridge}.ts`, nuevos
`jas-wave/src/lib/analysis-render.ts` y `shared/src/audio/diagnosis.ts`, `shared/src/commands/analysis-commands.ts`,
`src/lib/{ai-daw-agent,agent-action-catalog,bounce-service,audio-import-agent}.ts`, `ai-harness/src/agent/action-policy.ts`.
Nuevos: `shared/src/audio/{diagnosis,analysis-provider}.ts`, `jas-wave/src/lib/{analysis-render,analysis-render-web}.ts` y tests
`diagnosis`, `analysis-commands`, `analysis-render`, `reference-ab`, `automation-runtime`; ampliados `plugin-host-guard.ts` y
`automation-runtime.ts`.

## Criterios de aceptación
- El agente obtiene métricas por pista y diagnóstico sin confirmaciones y sin cambios en el proyecto.

## Verificación
`npm run native:build`; `npm run verify`; e2e; CLI `daw-cli action analysis.mix '{}'`.

## Notas de traspaso

**Commits A7b (rama `ws/a7b-dsp`):** `d459165` diagnóstico + proveedor · `120e961` comandos `analysis.*` ·
`fe0308d` servicio de análisis + backend Web Audio · `6c2f642` guard de rutas de análisis ·
`fd58102` A/B con igualación de loudness · `3a9fb4d` bounce fiel + sin tope de 120 s.

**Verificado 2026-10-21:** `jas-wave` → `npm run typecheck` ✓, `npx eslint .` 0 errores, `npm test` 347 ✓;
`shared` → typecheck + 460 tests ✓; `ai-harness` → typecheck + 196 tests ✓. No se hizo `npm run build`.

**Pendiente en C++ (no compilar en este entorno: falta `native/vst3sdk` y MSVC):**
1. `renderOfflineStart{analysis:true, tapStems, tap, bypassMaster?, outDir}` en
   `native/plugin-host/src/main.cpp`: WAV por stem (post-insert, pre/post fader) + master a `outDir`
   con streaming a disco. El lado TS ya está listo: `plugin-host-guard.ts` admite `outDir` bajo
   `userData/analysis/` y `analysis-render.ts` usa el backend inyectable (hoy `crearBackendAnalisisWeb`,
   que renderiza con Web Audio; el backend nativo queda encajado por `BackendAnalisis`).
2. `getMixMeters`: RMS y LUFS-M por stem y pre/post → `native-mix-meters.ts` y `audit.mix` (tarea A9).
3. **Confirmar en runtime** que el host aplica `setTrackGraph` y `setParameter` entre pasos de
   `renderOfflineStep`: el bounce publica fader/paneo/params un valor por bloque (512 ≈ 10 ms) con
   `syncReaperTrackGraph(..., {omitirLayout:true})` y restaura el grafo base en el `finally` de
   `bounce-service.ts`. Si el host sólo lee el grafo al iniciar el render, la automatización no
   tendrá efecto (habría que muestrear dentro de `renderMix` en C++).

**Decisiones de diseño del bounce fiel:**
- El volumen ya va horneado en el PCM de los clips de audio (`bakeVolumeAutomationIntoStem`), así que
  en esas pistas el grafo recibe el fader base; en pistas MIDI/VST sí se muestrea el volumen.
  El paneo siempre se muestrea (el grafo es su único aplicador).
- Los stems de `exportStems` siguen secos (fader/pane/mute viven en el grafo nativo); no se les
  hornea paneo para que sigan sirviendo de material de remix.
- La caché del servicio de análisis usa `getStateRevision` **+ huellaMezcla** (fader/pane/mute/solo/
  master bypass), porque la revisión no cubre esos campos.
- `reference.toggleAB` devuelve `gananciaAplicadaDb` (positiva = la referencia estaba más baja) y es
  idempotente: repetir en el mismo modo no re-mide ni re-guarda el estado previo.
