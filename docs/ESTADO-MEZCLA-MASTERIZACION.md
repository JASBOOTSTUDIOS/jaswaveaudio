# Estado: Mezcla y Masterización — Auditoría y brechas

> **Propósito:** documento de trabajo que responde «¿en qué estado está la mezcla/masterización y puede la IA llevar un proyecto de cero a master para distribución?». Detalla lo implementado, lo que falta y el plan para cerrar el ciclo.
> **Fecha:** 2026-08-23 · Actualizar cuando cambie el pipeline de audio, el mixer o las tools de IA.
> **Audiencia:** humanos + agentes de código (`AGENTS.md`).
> **Docs relacionados:** `CHECKLIST-PRODUCTO.md`, `CONTEXTO-VST-AUDIO-APP-VS-DOCS.md`, `hoja-ruta/013-mixer.md`, `hoja-ruta/022-analisis.md`, `hoja-ruta/023-routing.md`, `hoja-ruta/034-automatizacion.md`, `hoja-ruta/035-render.md`, ADR-0012/0013/0014.

---

## 1. Respuesta ejecutiva

**¿Puede la IA hoy crear un proyecto completo desde cero hasta la masterización para distribución? PARCIAL — bounce WAV con contenido real + loudness sí; FLAC/MP3, sends y automatización aún no.**

| Etapa | Estado | Detalle |
|-------|--------|---------|
| Composición (estructura, pistas, VSTs, MIDI) | ✅ Hecho | `daw.musicBuild` / `daw.composeProject` orquestan por fases (ADR-0014) |
| Mezcla básica | ✅ Parcial | Vol/pan/mute/solo + FX serial. **Sin** sends, sidechain ni automatización |
| Monitorización (VU) | ✅ Hecho | Peaks nativos post-fader/master vía `getMixMeters` (mismo `renderMix` audible) |
| Masterización informada | ✅ Parcial | `analysis.loudness` / `compareTarget` (BS.1770) sobre bounce; sin `daw.masterPass` |
| Entrega / distribución | ✅ Parcial | Bounce WAV PCM16/24 con contenido real (`render.start` + `renderOffline*`); sin FLAC/MP3 |

> **Corte 2026-08-23 (bounce con contenido real):** el bounce ya renderiza lo mismo que se oye en Play:
> notas/CCs de clips MIDI → slots VST (delaySamples absolutos), clips de audio y Soft Pad → stems Web Audio
> pre-renderizados e inyectados inline por paso; WAV PCM16/24 con dithering TPDF.

---

## 2. Qué existe hoy (mapa real)

### 2.1 Pipeline audible (estilo Reaper, ADR-0013 A+B en producción)

```
Clips / Soft Pad (Web Audio, dry por pista)
        ↓ stems JWST por pista (AudioWorklet, pcm-tap)
jaswave-plugin-host: stem → FX_0…FX_N serial → fader/pan/mute → suma
        ↓
master.plugins serial → device (WASAPI/ASIO/miniaudio)
```

- PDC por pista en `renderMix`.
- Resample por stem; playhead = `AudioContext`.
- **Meters:** peaks en `renderMix` (`gMeterStemPeak` / `gMeterMasterPeak`) → IPC `getMixMeters` → `native-mix-meters.ts` → `audioEngine.getMeterLevel` / mixer RAF (~20 Hz).

### 2.2 Mixer UI (`jas-wave/components/mixer.tsx`)

| Criterio hoja-ruta 013 | Estado |
|---|---|
| Volumen / pan / mute / solo | ✅ |
| Inserts visibles (FX chain) | ✅ |
| Sends visibles | ❌ |
| Master fader | ✅ |
| VU meters | ✅ peaks del mix **nativo** (no solo Analysers Web Audio) |

### 2.3 FX Chains y plugins

- Host VST3 OOP + **VST2 real** (`Vst2Slot` / `HostedSlot`): LoadLibrary + `processReplacing`, MIDI, editor HWND, solo **x64**. Discover marca `hostReady` si PE64.
- **Compliance:** Steinberg ya no licencia VST2; headers mínimas en `native/plugin-host/vendor/vst2/` solo para hosting de DLLs del usuario.
- Sync en caliente mute/solo/vol/pan/cadena durante Play.

### 2.4 Bounce + loudness (contenido real)

- Host: `renderOfflineStart` / `Step` / `Finish` / `Cancel` + `mix_bus` offline (sin PLL).
  - `Step` acepta `stems:[{trackIndex,b64}]` (f32le interleaved base64) → push directo al ring (`jaswave_mix_bus_push_stem`) → sin carrera entre pipe de PCM y el paso.
  - Live MIDI WinMM desactivado durante bounce (`renderMix` gatea por `gOfflineRunning`).
- Contenido (`jas-wave/src/lib/`):
  - `bounce-content.ts`: estado → notas/CCs/clips con tiempos absolutos; resolución VST slot / Soft Pad inyectable (`buildRuntimeBounceContent` en el servicio).
  - `bounce-offline-audio.ts`: pre-render `OfflineAudioContext` por pista (clips con loop, voces sine Soft Pad) → stems DRY.
  - `bounce-service.ts`: orquesta Start → programa notas/CCs VST con `delaySamples` absolutos (la cola por-slot del host los dispara sample-accurate) → pasos inline → Finish + BS.1770.
- WAV: PCM16/24-bit con dithering TPDF; sample rate real del device (el pedido solo fija la tasa del bus).
- Dominio: `render.start/cancel/getStatus`, eventos `render.*`, store `RenderJob`.
- UI: Archivo → Exportar bounce WAV… (`ExportBounceDialog`, selector 16/24-bit); IA usa el mismo camino.
- BS.1770-4 en TS (`shared/src/audio/loudness-bs1770.ts`); adjunto al job (decodifica WAV 16/24); tools `analysis.loudness` / `analysis.compareTarget`.

### 2.5 IA — acciones

Además de composición/mix/plugin.*: `render.start` (orquesta bounce nativo), `render.cancel/getStatus`, `analysis.loudness`, `analysis.compareTarget`.

---

## 3. Brechas restantes

### G1 · Export — parcial
- ✅ WAV PCM16/24 (dithering TPDF) + progreso + cancel + contenido real (VST, clips, Soft Pad).
- ❌ FLAC/MP3, stems por pista, normalización al export.

### G2 · Masterización — parcial
- ✅ Medición post-render + compareTarget.
- ❌ `daw.masterPass`, presets master por género, espectro/clipping tools.

### G3 · Sends / sidechain — sin cambios
Tipos en dominio; sin DSP/UI/comandos.

### G4 / G5 / G6
Automatización, persistencia chunk VST en `.jaswave`, freeze — pendientes (R4/R5 del plan).

---

## 4. Matriz de herramientas IA

| Capacidad | Estado |
|---|---|
| Export/bounce WAV | ✅ `render.start/cancel/getStatus` |
| Medir loudness | ✅ `analysis.loudness` |
| Comparar vs target | ✅ `analysis.compareTarget` |
| masterPass / sends / automation | ❌ |

---

## 5. Plan (fases restantes)

**Hecho en este corte:** Fase M (meters), VST2 hosting, R1 bounce WAV **con contenido real** (notas→VST, clips/Soft Pad→stems, PCM24+dither), R2 loudness+tools.

**Pendiente:** R3 FLAC/MP3 + stems por pista, R4 persistencia estado VST, R5 sends/automatización/freeze.

---

## 6. Verificación

```bash
cd shared && npm test && npx tsc --noEmit
cd jas-wave && npm run test:plugins && npm run build
# Rebuild host (Windows, cmake de VS):
# & "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" --build native\plugin-host\build-vst3 --config Release
# Reinicio total Electron + jaswave-plugin-host
```

Play: Soft Pad / clip / VST3 / VST2 x64 → meters de pista y master se mueven.
Archivo → Exportar bounce WAV (16/24-bit) → archivo **con audio** (mismo contenido que Play) + LUFS en diálogo.
