# Contexto: App real vs documentación (VST / audio / FX)

> **Propósito:** archivo de trabajo para alinear implementación y docs, y desbloquear los bugs actuales (VST mudo, UI freeze, Soft Pad vs host).
> **Fecha:** 2026-08-22 · Actualizar este archivo cuando cambie la arquitectura de audio/plugins.
> **Auditoría FASE 1:** hecha. Decisión UI+audio + handoff: [ADR-0013](./decisiones/ADR-0013-fx-runtime-pipeline.md) **A+B en producción**. Modelo Reaper (clip → cadena serial de pista): placement R1 + stems/FX inserts R2 + master/bypass R3 **desbloqueados** en código; sends/sidechain siguen fuera.
> **Audiencia:** humanos + agentes de código (`AGENTS.md`).

---

## 1. Resumen ejecutivo (estado real)

| Área | Documentación dice | App hace hoy | Veredicto |
|------|-------------------|--------------|-----------|
| Motor de audio del DAW | C++ nativo vía Native Bridge, un solo graph | **Web Audio genera** clips + Soft Pad + metrónomo; **salida** = plugin-host (device elegido). Addon `native/audio-engine` sigue **stub** | Parcial: un device, dos generadores |
| Host VST3 OOP | Un Plugin Host: load + MIDI + process + UI | **Misma instancia** en `jaswave-plugin-host` (createView + process). Device seleccionable. Stems PCM por pista + cadena serial. | A+B + Reaper graph |
| Instrument VST | Playback + teclado del plugin | Load + noteOn + UI del mismo slot. Preset de la ventana = audio de esa instancia. | Alineado (salvo preset vacío) |
| Soft Pad | Builtin in-process | Osciladores Web Audio + FakePlugin; **insertable**; sale por stem de pista hacia FX nativos | Alineado |
| FX chain dominio/UI | ADR-0012 | Comandos + panel + Master | Dominio/UI ✅ · DSP inserts serial ✅ (sin sends) |
| Clip → pista | Reaper: media sigue la cadena de la pista | Mover clip / cambiar `trackId` en Play reprograma playback a la pista destino | Alineado (R1) |
| Arrange scroll/clips | (no ADR) | Un scroller + GridLayer absolute | Corregido (offset vertical) |

**Pipeline audible (Electron, estilo Reaper):**

```
Clips / Soft Pad (Web Audio, dry por pista)
        │ stems JWST (trackIndex)
        ▼
jaswave-plugin-host: stem → FX_0…FX_N serial → fader/pan/mute → suma
        │
        ▼
master.plugins serial → device (WASAPI/ASIO/…)
```

`web:dev` (sin Electron) sigue a altavoces Chromium. No se usa `jaswave-vst3-editor.exe` en producción.

---

## 2. Qué dice la documentación (objetivo)

### 2.1 ADR-0011 — Plugin Host VST3

- Aislamiento **híbrido**: builtin in-process; VST3 out-of-process.
- Renderer **nunca** carga DLL.
- Flujo objetivo: `OutOfProcessRuntime → VST3 Adapter → Audio Engine handoff` (shared memory / buffers).
- Fases F–H en el ADR aún marcan: *“VST3 load audio = HostNotReady”* (texto viejo).
- Fases I–N: UI nativa vía `jaswave-vst3-editor` marcada ✅; params/state pendientes.

### 2.2 ADR-0012 — Track FX Chain

- SSOT: `track.plugins` / `project.master.plugins`.
- Tabla: *“Instrument VST playback | Hecho (host OOP)”* ← **sobreestima** el estado usable.
- Efectos audio en engine: parcial / siguiente.

### 2.3 `docs/audio/MOTOR-AUDIO.md`

- Motor C++ único, Native Bridge, audio thread estricto.
- Plugins y mezcla dentro de ese motor.

### 2.4 Hoja de ruta

- `033-instrumentos-virtuales.md`: criterios sin marcar (carga VST, MIDI→DSP, latencia).
- `021-fx-chains.md`: dominio/UI ✅; *“plugins de efecto procesan audio”* ❌.
- `036-sistema-plugins-completo.md`: VST3 soportado aún abierto.

### 2.5 Criterio de no-engaño (ADR-0011)

- No fingir “Loaded” sin host confirmado.
- No punteros C++ en `DAWState`.

---

## 3. Qué hay implementado (mapa de código)

### 3.1 Dominio (`shared/`)

| Pieza | Ruta | Estado |
|-------|------|--------|
| Comandos plugin / FX | `shared/src/commands/plugin-commands.ts` | insert/remove/move/bypass/replace/setParameter, fxChain.* |
| Tipos PluginInfo | `shared/src/types/entidades` | SSOT en tracks |
| Tests FX | `shared/src/test/plugin-fx-chain.test.ts` | Cubren dominio |

### 3.2 UI / runtime TS (`jas-wave/`)

| Pieza | Ruta | Rol real |
|-------|------|----------|
| Web Audio engine | `lib/audio-engine.ts` | Clips + Soft Pad + stems dry por pista (`JWST`) + schedule MIDI |
| Playback | `components/playback-provider.tsx` | Play arma mix nativo; re-route clip→pista; VST prefetch |
| Track VST runtime | `src/lib/plugin/track-vst-runtime.ts` | Load cadena (inst+FX), `setTrackGraph`, MIDI |
| Track graph encode | `src/lib/plugin/track-graph-encoding.ts` | Paquetes stem + encoding Reaper |
| Voice router | `src/lib/plugin/vst-voice-router.ts` | VST insertado → MIDI al host; si no, Soft Pad solo si está en `track.plugins` |
| Plugin editor panel | `components/plugin-editor-panel.tsx` | Reabrir → `createView` en el mismo slot; Soft Pad = Web Audio |
| FX chain panel | `components/fx-chain-panel.tsx` | UI cadena |
| Lifecycle | `components/plugin-host-lifecycle.tsx` | sync unload + prefetch |
| Multi-window sync | `src/workspace/multi-window-sync.tsx` | Solo `request-state` / force (ya no stringify en cada cambio) |
| Arrange | `components/arrangement/*` | Un scroller; GridLayer `absolute` |

### 3.3 Electron bridge

| Pieza | Ruta | Rol real |
|-------|------|----------|
| Plugin host bridge | `electron/plugin-host-bridge.ts` | Spawn host; openEditor = mismo proceso; named pipe PCM |
| Preload IPC | `electron/preload.ts` | `pluginHostSend`, `pluginHostMidi`, `pluginHostPushPcm` |
| Native audio addon | `electron/native-audio.ts` + `native/audio-engine` | Stub HW; no se usa para clips |

### 3.4 Native plugin host

| Pieza | Ruta | Rol real |
|-------|------|----------|
| Main + audio | `native/plugin-host/src/main.cpp` | `renderMix` serial Reaper + device; editor en STA |
| Mix bus | `native/plugin-host/src/mix_bus.cpp` | Named pipe + rings por stem (`JWST`) + bus DAW |
| VST3 slot | `native/plugin-host/src/vst3_slot.cpp` | load, prepare, process, createView HWND |
| Binarios | `build-vst3/Release/jaswave-plugin-host.exe` | UI + audio + mix DAW (sin editorhost) |

### 3.5 Flujo real (hoy)

```
[Play / piano-roll / teclas panel]
        │
        ├─► Web Audio (clips / Soft Pad dry por pista)
        │         └─► stem JWST(trackIndex) → named pipe
        │
        └─► IPC noteOn ──► Vst3Slot de la pista actual
                                      │
                                      ▼
              stem → FX serial (inst+efectos) → fader → suma → master FX → device

[Reabrir UI]
        └─► createView en el mismo Vst3Slot (no editorhost)
```

---

## 4. Bugs observados y causas raíz

### B1 — Teclado del VST marca nota pero no suena

- **Causa histórica:** UI = editorhost; audio = plugin-host.
- **Hoy:** misma instancia. Si sigue mudo: preset no cargado en esa ventana, o device incorrecto.

### B2 — “JasWave Plugin (Not Responding)” + DAW lento

- **Causa histórica:** `createView` en el mismo proceso que stdin MTA.
- **Hoy:** load/editor en STA + `GetMessage`; openEditor no bloquea la cola RPC.

### B3 — Clips de audio mudos (histórico)

- **Causa:** `nativeAudioBridge.isAvailable()` true + engine stub → se saltaba Web Audio.
- **Hoy:** clips se generan en Web Audio y salen por el host nativo (handoff B).

### B4 — MIDI mudo / UI lenta al pulsar Play (histórico)

- **Causa:** `await ensureProjectVstInstruments(...)` antes de `playClips`.
- **Mitigación:** Play no espera el load VST completo (timeout 2 s).

### B5 — Clips desalineados con pistas (histórico)

- **Causa:** `GridLayer` en flujo del documento (altura doble).
- **Mitigación:** `position: absolute`.

### B6 — Docs mienten / desfasadas

- ADR-0012 dominio/UI OK; DSP inserts serial Reaper (ADR-0013 R2/R3) ya en host; sends/sidechain no.
- MOTOR-AUDIO.md describe un motor C++ único de clips que aún no existe (solo device + FX graph nativos).

---

## 5. Contratos que sí se cumplen

1. React **no** carga `.vst3` / DLL.
2. Dominio `track.plugins` es SSOT; mutación vía comandos.
3. Soft Pad / internos no dependen de cargar un VST.
4. Crash del plugin-host ≠ crash de Electron (proceso aparte). El editor ya no es un tercer proceso.
5. Criterio de no-engaño: insert VST queda `pendiente` hasta load; Soft Pad no se finge como motor VST.

---

## 6. Decisión (cerrada 2026-08-22)

| Opción | Estado |
|--------|--------|
| **A. Misma instancia** | **Hecho** — `createView` + `process` en `jaswave-plugin-host` |
| **B. Handoff PCM** | **Hecho** — un device nativo para VST + mix DAW |
| **C. Editorhost con audio** | Rechazada |
| **D. MVP honesto (solo Soft Pad)** | Histórico; Soft Pad sigue insertable |

Siguiente trabajo grande: sends / sidechain / compensación de latencia / clips nativos (fases 10+), no otra arquitectura de host.

---

## 7. Checklist de resolución (orden sugerido)

1. [x] Actualizar ADR-0011 / 0012 + **ADR-0013** (estado real).
2. [x] UX honesta (Soft Pad insertable; VST = misma instancia).
3. [x] Editor en el host de audio (STA + pump); no editorhost.
4. [x] A + B: misma instancia y un device (handoff PCM).
5. [x] Device seleccionable (WASAPI / ASIO / …).
6. [x] FX insert DSP serial por pista + master (modelo Reaper R2/R3). Sends/sidechain pendientes.
7. [x] native/audio-engine: `isAvailable()===false` hasta `JASWAVE_NATIVE_AUDIO=1`.

---

## 8. Comandos útiles (Windows)

```powershell
# Procesos host
Get-Process jaswave-plugin-host -ErrorAction SilentlyContinue |
  Format-Table Id,ProcessName,Responding

# Matar host colgado
Stop-Process -Name jaswave-plugin-host -Force -ErrorAction SilentlyContinue

# Rebuild host
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" `
  native\plugin-host\build-vst3\jaswave-plugin-host.vcxproj /p:Configuration=Release /t:Build
```

Dev app:

```bash
cd jas-wave && npm run dev
```

---

## 9. Archivos críticos (tocar con cuidado)

```
docs/CONTEXTO-VST-AUDIO-APP-VS-DOCS.md          ← este archivo
docs/decisiones/ADR-0011-plugin-host-vst3.md
docs/decisiones/ADR-0012-track-fx-chain.md
jas-wave/electron/plugin-host-bridge.ts        ← spawn host + named pipe PCM
jas-wave/components/playback-provider.tsx      ← Play / re-route clip→pista / ensureAudio
jas-wave/src/lib/plugin/track-vst-runtime.ts   ← load cadena + graph + MIDI
jas-wave/lib/audio-engine.ts                   ← genera clips; stems → host
native/plugin-host/src/main.cpp                ← renderMix serial Reaper + device
native/plugin-host/src/mix_bus.cpp             ← pipe JWST multi-pista
native/plugin-host/src/vst3_slot.cpp           ← process / bypass / editor HWND
native/audio-engine/                           ← stub; no usar para clips
```

---

## 10. Glosario rápido (términos de esta base)

| Término | Significado aquí |
|---------|------------------|
| **plugin-host** | `jaswave-plugin-host.exe` — process + UI VST + mix DAW |
| **editorhost** | `jaswave-vst3-editor.exe` — **fuera de producción** (Steinberg sample) |
| **Soft Pad** | Synth Web Audio / builtin insertable |
| **handoff** | Mix Web Audio → named pipe → device nativo (hecho) |
| **slotId** | `{trackId}:{pluginId}` en el host |

---

*Fin del contexto. Al resolver un ítem del §7, actualizar la tabla del §1 y la fecha.*
