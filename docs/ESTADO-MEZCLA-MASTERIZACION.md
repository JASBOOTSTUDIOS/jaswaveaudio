# Estado: Mezcla y Masterización — Auditoría y brechas

> **Propósito:** documento de trabajo que responde «¿en qué estado está la mezcla/masterización y puede la IA llevar un proyecto de cero a master para distribución?».
> **Fecha:** 2026-08-24 · Actualizar cuando cambie el pipeline de audio, el mixer o las tools de IA.
> **Audiencia:** humanos + agentes de código (`AGENTS.md`).
> **Docs relacionados:** `CHECKLIST-PRODUCTO.md`, `AGENT-CONTROL-GAPS.md`, hoja-ruta 013/022/023/034/035.

---

## 1. Respuesta ejecutiva

**¿Puede la IA hoy crear un proyecto completo desde cero hasta master para distribución? SÍ en el camino principal** (composición → mezcla → masterPass/bounce → AudioListenReport), con matices en sends nativos en vivo y FLAC/MP3 (requiere ffmpeg).

| Etapa | Estado | Detalle |
|-------|--------|---------|
| Composición | ✅ | `daw.musicBuild` / spec IA |
| Mezcla básica | ✅ | Vol/pan/mute/solo + FX + **automatización** vol/pan + **sends** (estado + bounce; live taps host parcial) |
| Monitorización | ✅ | Peaks nativos |
| Masterización | ✅ | `daw.masterPass` + `analysis.fullReport` / compareTarget + true-peak / espectro / correlación |
| Entrega | ✅ | WAV + stems + normalize; FLAC/MP3 vía ffmpeg opcional |
| Freeze | ✅ | `track.freeze` / `unfreeze` (stem → clip + bypass) |
| IA “escucha” | ✅ | `AudioListenReport` post-bounce; harness falla si listen/target mal |

---

## 2. Qué existe (mapa 2026-08-24)

### Análisis (`shared/src/audio/mix-analysis.ts`)
- true-peak, crest, clipping, correlación L/R, bandas espectrales, `buildAudioListenReport`
- Tools: `analysis.loudness|spectrum|stereo|fullReport|compareTarget`
- Adjuntado a `RenderJob` (`analysis`, `listenReport`, `stemsPaths`)

### Export / bounce
- `render.start` acepta wav/flac/mp3, `stems`, `normalize`, `listenTarget`
- Stems en `{bounce}-stems/stemN.wav`; normalize peak/lufs; ffmpeg IPC opcional
- UI: `ExportBounceDialog`

### MasterPass
- `daw.masterPass` orquesta cadena master (catálogo VST) + bounce + iteración de fader vs target

### Automatización
- `automation.setCurve` / `clear`; play ~20 Hz + bake en bounce; panel MVP en mixer

### Routing
- `bus.create` (crea pista tipo bus), `send.set`, `sidechain.connect` (estado)
- Mixer: knobs send; bounce suma sends al stem del bus

### Freeze
- Cliente: solo → bounce → clip audio → `track.freeze` (bypass plugins)

### Harness
- Errores `listen-failed`, `compare-target`, `master-pass-target` además de plan-incomplete

---

## 3. Brechas restantes (menor)

- Sends **sample-accurate en host live** (taps post-fader en `renderMix`) — hoy bounce + knobs UI + suma offline.
- Sidechain I/O en slots VST.
- EQ/comp nativos propios (se usan VST de catálogo/biblioteca).
- PCM al LLM: **fuera de alcance** (solo informe estructurado).

---

## 4. Verificación

```bash
cd shared && npm test -- mix-analysis
cd jas-wave && npx tsc --noEmit
```
