# ADR-0011: Host de plugins VST3 — discovery, registry, lifecycle

## Estado

**Aprobado** (aislamiento híbrido C). Host nativo **sí carga y procesa** VST3; el **handoff al motor del DAW no existe**. UI nativa = proceso `jaswave-vst3-editor` (**otra instancia**). Ver [ADR-0013](./ADR-0013-fx-runtime-pipeline.md) **[REQUIERE APROBACIÓN]** antes de unificar UI+audio o FX DSP.

Complementa `PluginInfo` en dominio y [036-sistema-plugins-completo](../hoja-ruta/036-sistema-plugins-completo.md).

Scaffold TS: `jas-wave/src/lib/plugin/`. Host nativo: `native/plugin-host/` (`jaswave-plugin-host.exe`).

## Contexto

El dominio ya tiene `track.plugins`, eventos `plugin.*` y Soft Pad (instrumento interno).
Todavía **no** hay host C++ capaz de cargar VST3 reales.

## Decisión de implementación VST3

**No** reinventar el protocolo VST3 desde cero.
**No** absorber un DAW/host open source completo.
**No** adoptar JUCE como arquitectura completa del DAW.

**Sí:** sistema de plugins JasWave (Discovery → Scanner → Registry → Host → Instance) + backend VST3 con **SDK oficial Steinberg (MIT)** detrás de `PluginFormatAdapter` / `Vst3Host`.

```
JasWavePlugin (abstracción)
        │
   ┌────┼────┐
   │    │    │
 VST3  CLAP Internal
   │
 Steinberg SDK
```

## Decisión de aislamiento de crashes — **C) Híbrida** (APROBADA)

| Formato | Aislamiento | Motivo |
|---------|-------------|--------|
| `builtin` / internos (Soft Pad, Fake Gain, …) | **In-process** | Código de confianza, mínima latencia |
| VST3 / AU / LV2 / CLAP de terceros | **Out-of-process** (Plugin Host Process) | Crash del plugin ≠ crash de JasWave |

```
Electron Main / Plugin Service
        │
        ├─ InProcessRuntime ── Soft Pad / Fake / internal
        │
        └─ OutOfProcessRuntime ── IPC / shared memory (futuro)
                    │
              Plugin Host Process
                    │
              VST3 Adapter (Steinberg SDK)
                    │
              Audio Engine handoff (buffers listos fuera del audio callback)
```

### Reglas

1. Lifecycle (load/unload/scan/editor) **fuera** del audio thread.
2. El audio thread solo procesa instancias ya `prepared` / `active`.
3. Renderer **nunca** carga DLL/Bundle.
4. Core no depende de tipos Steinberg.
5. Fallo OOP → marcar `crashed`, preservar proyecto, ofrecer bypass/reload.
6. Hasta que el proceso hijo nativo exista: VST3 permanece `hostReady: false` (sin fingir carga real).

## Lifecycle

```
DISCOVERED → SCANNED → AVAILABLE → LOADING → LOADED → PREPARED → ACTIVE
                                              ↘ BYPASSED
UNLOADING → UNLOADED
(+ SCAN_FAILED | LOAD_FAILED | CRASHED | INCOMPATIBLE | MISSING)
```

## Flujo

```
UI / AI → Tool Registry → Validator → Command System → PluginManager
     → InProcessRuntime | OutOfProcessRuntime → Audio Engine
```

## Fases

| Fase | Contenido | Estado |
|------|-----------|--------|
| A | ADR + decisión C | **Hecho** |
| B | Contratos + Descriptor + InstanceRef | Scaffold |
| C | Format adapter + isolation routing + host process | **Scaffold completo (discover)** |
| D–E | Discovery + Scanner + Registry | Discovery FS ✅; scan SDK pendiente |
| F–H | Host + audio handoff | Builtin (Soft Pad) ✅. VST3 **load+process+WASAPI en plugin-host** ✅. Handoff al audio engine del DAW ❌. No fingir que eso es el mixer de JasWave. |
| I–N | Params, state, presets, **UI nativa** | UI flotante ✅ (`jaswave-vst3-editor`, instancia distinta). `createView` en el host de audio = freeze. Params/state/presets nativos pendientes. |
| O | Proceso hijo nativo + crash recovery | Parcial (editor spawn + kill) |
| P–T | Browser, commands, AI tools, tests | Parcial |

## Criterio de no-engaño

- No marcar VST3 como “Loaded” sin host nativo OOP confirmado.
- No guardar punteros C++ / buffers en `DAWState`.
- Missing plugin → estado explícito.

## Consecuencias

- Soft Pad / Fake Gain cargan in-process hoy (Web Audio). Fake Gain **no** tiene DSP.
- VST3 comercial usa `native/plugin-host` + bridge. El binario nativo **ya no** es `HostNotReady` para load; sigue `HostNotReady` el **handoff** al motor del DAW (ADR-0005/0009).
- Camino de producción: SDK Steinberg + proceso aislado. Unificar instancia UI+audio o handoff PCM = [ADR-0013](./ADR-0013-fx-runtime-pipeline.md), no improvisar.
