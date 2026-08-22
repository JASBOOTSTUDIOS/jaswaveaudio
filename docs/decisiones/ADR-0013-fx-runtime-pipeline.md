# ADR-0013: Pipeline FX Chain → Plugin Runtime → Audio Graph

## Estado

**Aprobada opción A (2026-08-22)** — misma instancia `createView` + `process()` en `jaswave-plugin-host`, con driver de audio seleccionable (WASAPI / Exclusive / DirectSound / WinMM / ASIO / JACK).

**Aprobada opción B (2026-08-22)** — handoff PCM: Web Audio genera clips / Soft Pad / metrónomo, Chromium se silencia, el host mezcla ese bus + VST y sale por **un** device nativo.

Complementa [ADR-0011](./ADR-0011-plugin-host-vst3.md), [ADR-0012](./ADR-0012-track-fx-chain.md), [ADR-0005](./ADR-0005-interfaz-motor-audio.md), [ADR-0009](./ADR-0009-native-audio-bridge-napi.md).

Auditoría: 2026-08-22. Artefacto: canvas `fx-chain-pipeline-audit`. Contexto: [CONTEXTO-VST-AUDIO-APP-VS-DOCS](../CONTEXTO-VST-AUDIO-APP-VS-DOCS.md).

## Contexto

El dominio y la UI de FX Chain **ya existen** (`track.plugins`, comandos `plugin.*` / `fxChain.*`, `FxChainPanel`, Tool Registry). El usuario pide un pipeline profesional:

```
DAWState → track.plugins → FX Chain Domain → Plugin Runtime Graph → Audio Engine / Plugin Host
```

Antes de A+B había **tres** salidas desconectadas (Web Audio, plugin-host WASAPI, Steinberg editorhost). Eso dejaba el VST mudo respecto de su propia UI y los clips en otro device.

## Decisión

**A, en producción:** UI (`IPlugView::createView`) en el mismo `Vst3Slot` que hace `process()`. Load/editor en el hilo STA (message pump `GetMessage`). El teclado del plugin y el MIDI del DAW alimentan la misma instancia. **No** se usa `jaswave-vst3-editor.exe` en producción.

**Device:** el host enumera backends instalados y abre el que elija el usuario (Configuración → Audio). Preferencia en `%APPDATA%/…/audio-device.json`.

**B, en producción:** named pipe `\\.\pipe\jaswave-mix-{pid}` (f32le interleaved). Electron escribe el mix Web Audio; `renderMix` suma VST + bus DAW → el device seleccionado. `web:dev` (sin Electron) sigue a altavoces Chromium.

**C** sigue rechazada. **D** queda como mitigación histórica.

## Lo que ya es SSOT (no reemplazar)

- Dominio: `PluginInfo` en `track.plugins` y `project.master.plugins` (`trackId` canónico `master`).
- Identidad de instancia: `PluginInfo.id` (no el nombre).
- Comandos: `plugin.insert|remove|move|bypass|duplicate|replace|setParameter` y `fxChain.copy|paste|pasteUndo|savePreset|loadPreset`.
- Eventos existentes (español): `plugin.cargado`, `plugin.descargado`, `plugin.movido`, `plugin.bypass.cambiado`, `plugin.parametro.cambiado`, `plugin.presetCargado`, `plugin.presetGuardado`, `plugin.error`.
- AI: `track.getFxChain` (equivalente a `plugin.getTrackChain`) + tools `plugin.*` vía CommandExecutor.
- Automatización (clave, no motor): `automationParamKey(instanceId, parameterId)` → `plugin:{instanceId}:{parameterId}`.
- Aislamiento: builtin in-process; VST3 out-of-process. Renderer nunca carga DLL.

No crear `trackFx.insert`. No crear Event Bus paralelo. No serializar punteros C++ en `DAWState`.

## Lifecycle (FASE 4 — contrato existente)

Runtime (fuera de `DAWState`): `PluginLifecycleState` en `jas-wave/src/lib/plugin/types.ts`:

```
discovered → scanned → available → loading → loaded → prepared → active
                                                      ↘ bypassed
unloading → unloaded
(+ scan_failed | load_failed | crashed | incompatible | missing)
```

Dominio hoy (`PluginInfo.estado`): solo `cargado | error | pendiente`. **No ampliar el enum de dominio en esta ADR** hasta cablear runtime FX. Mientras tanto:

- `pendiente` = requested / loading / missing no confirmado.
- `cargado` = host confirmó **esta** instancia (load ok), no “el catálogo escaneó el path”.
- `error` = load_failed / crashed / HostNotReady.

`descriptorToPluginInfo()` hoy pone `estado: 'cargado'` si `hostReady && scanStatus === 'ok'` **al insertar**, sin load de instancia. Eso viola el criterio de no-engaño. Corrección diferida a FASE 5.

Mapeo conceptual (no objetos nativos en estado):

```
PluginDescriptor (catálogo, pluginId)
        ↓ plugin.insert
PluginInfo (SSOT, instanceId = PluginInfo.id, trackId implícito)
        ↓ runtime preparation (fuera del audio thread)
PluginInstanceRef (lifecycle, latencySamples, isolation, hostProcessId)
        ↓
Vst3Slot nativo (no serializable)
```

## Mapa real vs objetivo

```
Objetivo:  Command → Domain → Prepare graph B → Validate → Atomic swap → Audio thread
Hoy:       Command → Domain → UI
                 ↘ track-vst-runtime.load cadena (instrumento + efectos) → mismo Vst3Slot (process + createView)
                 ↘ Play → Web Audio genera clips/Soft Pad → stems por pista (pipe JWST) → cadena serial nativa → 1 device
```

El `audioCallback` del host (graph Reaper activo vía `setTrackGraph`):

- por cada pista: pull stem dry → process serial de `track.plugins` (instrumento suma; efecto reemplaza; bypass = passthrough);
- aplica gain/pan/mute de pista;
- suma pistas → cadena serial `master.plugins` → master gain;
- suma el bus DAW residual (metrónomo / legacy) desde el ring `0xFFFF`.

Sin `setTrackGraph`, permanece el path legacy (suma paralela de slots + bus DAW).

## Buses y Master

- Master: **misma** abstracción (`MASTER_FX_TRACK_ID` / trackId `master`). Cadena serial en el mismo `renderMix`.
- Bus: `routing.Bus.plugins: PluginInfo[]` existe; `resolveChainHost` **no** resuelve buses. Cablear al mismo comando **después** del pipeline de pista, no un sistema paralelo.
- Sends / sidechain / folders: fuera de alcance (tipos preparados, runtime no).

## Editor

Mantener aislamiento: no `createView` en el renderer. El editor se adjunta al **mismo** `Vst3Slot` que hace `process`.

## Consecuencias

### Hecho (A + B + Reaper graph R1–R3)

- Misma instancia UI+audio en `jaswave-plugin-host`.
- Device seleccionable; `ensureAudio` abre el device aunque no haya VST (clips-only).
- Handoff PCM multi-pista (`JWST` + stem index); Chromium destination en silencio; salida = driver nativo.
- Soft Pad es insertable; su salida entra al stem de la pista (FX nativos posteriores lo procesan).
- Mover clip / cambiar `trackId` durante Play reprograma al instrumento y bus de la pista destino (R1).
- Inserts VST3 de efecto se cargan y procesan en serie por pista; bypass salta el slot en el audio thread.
- Cadena Master serial (`project.master.plugins`) en el mismo graph.
- Addon `native/audio-engine` stub: `isAvailable()===false` salvo `JASWAVE_NATIVE_AUDIO=1`.

### Límites honestos

- Clips / Soft Pad **se generan** en Web Audio; solo el **device** y el **FX graph** son nativos. Resample lineal **por stem** si Web Audio y el device no coinciden.
- DecentSampler puede quedar mudo hasta cargar un preset **en esa misma** ventana de editor.
- ASIO exclusive puede pelear con el WASAPI silencioso de Chrome (el tap Worklet debe seguir conectado a `destination` para dispararse).
- Compensación de latencia por plugin: reportable vía `getLatency`; **PDC relativo por pista en `renderMix`** (tope 16384 samples). Master no se retrasa extra (latencia común de salida).
- Sends / pre-FX / post-fader / item FX take: no.

### No hacer (sigue bloqueado)

- Hot-swap atómico de graph completo, sidechain runtime, multi-channel.
- Transacciones AI de cadena completa contra VST.
- Segunda arquitectura de plugins.
- Reactivar editorhost para audio.
- Motor C++ único generando todos los clips (fase 10+).

## Fases

| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Auditoría | **Hecho** (2026-08-22) |
| 2 | Mapa Domain→…→Audio | **Hecho** (esta ADR + canvas) |
| 3 | Docs vs código | A+B + Reaper graph documentados aquí + CONTEXTO |
| 4 | Lifecycle | **Definido** (contrato TS existente + mapeo) |
| 5–7 | Runtime FX serial por pista, stems, load efectos | **Hecho** (modelo Reaper R2; sin sends) |
| 8–9 | Master chain + bypass real en audio thread | **Hecho** (R3; PDC relativo por pista) |
| 10–15 | Mixer nativo de clips, routing/sidechain, automation, AI txn | **Bloqueado** / siguiente |
