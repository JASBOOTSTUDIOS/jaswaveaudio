# Checklist de producto — JasWave completo

> Criterio: **terminar una canción aquí y entregar un archivo**, no el roadmap entero (marketplace, colaboración, stems por IA).
> Fecha: 2026-08-28 · Cierre 1.0 (bugs bounce/freeze/slots + honestidad sidechain).

Hoy: arrange, mixer, piano roll, transporte, metrónomo, clips, JasWave Roles/Piano VST3, VST3/VST2 x64 (UI+DSP), FX serial, WASAPI/ASIO, copiloto + Music Build + harness CLI (`127.0.0.1:18787`).

---

## Bloqueantes (sin esto no es un DAW de producción)

### 1. Exportar / bounce
- [x] Bounce / render offline a **WAV** (PCM16/24; notas VST + clips; LUFS adjunto)
- [x] Exportar **FLAC** y **MP3** (vía `ffmpeg` en PATH; UI deshabilita formatos si falta; error honesto si falla conversión)
- [x] Rango (todo el proyecto o selección de tiempo)
- [x] Progreso y cancelar
- [x] Stems por pista (post-bounce dry stems)
- [x] Offline `renderMix` suma stems dry (`pull_stem`) + clips nativos (paridad audio clips)

### 2. Un motor, no dos
- [x] Playback nativo de clips (clip_player + host; bounce offline nativo sin JWST)
- [x] Freeze de pista (CLI `track.freeze` + botón Freeze/Unfreeze; bypass snapshot en unfreeze)
- [x] Render offline = el mismo audio que Play (clip_player + VST; sin OfflineAudioContext en bounce)
- [x] Pipe JWST live retirado (`plugin-host-pcm` noop; stems export opcional vía prerender solo si `exportStems`)

### 3. Mezcla de estudio
- [x] Sends / returns (estado + bounce + encoding live en host `renderMix`)
- [x] Sidechain audible (bus aux VST3 + `sidechain.connect` + metering)
- [x] PDC relativa en `renderMix` del host (cap 16384)
- [x] Freeze / bounce in place (vía freeze)

### 4. Estado de plugins en el proyecto
- [x] Chunk / preset del VST en el `.jaswave` (snapshot/restore)
- [x] Reabrir restaura instrumento (chunk primero; overlay params si falla)
- [x] Bypass y parámetros de la cadena persisten

### 5. Grabación usable
- [x] Monitoreo de entrada (MIDI thru fiable; audio monitor: mensaje honesto si ASIO posee el device)
- [x] Punch in/out (MVP transport + ventana)
- [x] Tomas / comping (modo COMP, take lanes, matriz segmentos, flatten → clip)
- [x] MIDI desde teclado hardware
- [x] Count-in fiable (MVP)
- [x] Armado → clip de audio (base)

### 6. Automatización
- [x] Volumen y pan en el tiempo
- [x] Parámetros de plugin (runtime; UI lanes delgada)
- [x] Grabación de automatización (Write arm + fader en play)
- [x] Lanes en arrange/mixer (sparklines MVP)

### 7. Host estable
- [x] ASIO reopen mitigado + cuarentena VST + clear en settings
- [x] Crash de un VST ≠ tumbar el DAW (out-of-process + quarantine)
- [x] Resync VST + MIDI tras restart (doble pasada + fail visible si quedan slots muertos)
- [ ] Soak 4h+ BFD/Kontakt formal — gate release (ver procedimiento abajo)

#### Procedimiento soak 4h (gate release)

**Requisitos:** app empaquetada (`npm run pack:win`), proyecto con BFD + Kontakt cargados, agent bridge `:18787`.

```bash
cd jas-wave
SOAK_MINUTES=240 SOAK_LOG=./artifacts/soak-4h.log npm run cli:soak-host:4h
```

**Criterios pass:**
- 0 crashes del host / DAW durante 240 min
- `analysis.buffer`: sin underruns sostenidos (`underruns` estable o 0)
- Ciclos `clearQuarantine` + `ensureBest` completan sin error fatal
- Log archivado como artefacto de release

**Criterios fail:** crash, underruns crecientes, host no responde en bridge.

**Smoke CI (opcional):** `SOAK_MINUTES=30 npm run cli:soak-host:30` en nightly.

### 8. Producto instalable
- [x] Build empaquetado Windows (`npm run pack:win`)
- [x] Artefacto NSIS generado (smoke manual: instalar/abrir `.exe`)
- [x] VST2: solo x64; caption UI + prompt IA prefieren `.vst3`

---

## Después (no bloquean “completo” / post-1.0)

- [ ] Macros y scripting
- [ ] Themes / atajos configurables a fondo
- [ ] Extensiones del DAW
- [ ] Colaboración multi-usuario
- [ ] IA generativa de audio
- [ ] Separación de stems / análisis avanzado
- [ ] Nube y marketplace
- [ ] Addon `native/audio-engine` fuera de stub o retirado del camino
- [ ] Cursor-music Fases 1–3 (Tab MIDI, mezcla fiel descriptor, memoria) — ver [CURSOR-MUSIC-ROADMAP.md](./CURSOR-MUSIC-ROADMAP.md)

---

## Notas de cierre 2026-08-28

- Bounce offline: `push_stem` + `pull_stem` en `renderMix` cuando `gOfflineRunning`.
- Music Build / bounce: abortan si hay VST sin slot host (`host-slot-unconfirmed`).
- Sidechain: I/O aux VST3 en `vst3_slot` + feed en `renderMix`; IA habilita `sidechain.connect`.
- Soft Pad Web Audio eliminado: instrumentos = Roles/Piano VST u externos (Decent/4Front).
- Bounce: `clip_player` nativo; JWST retirado del path live/bounce principal.
- Suite CLI: `node cli/_certify.mjs --full` — gate release: verde ×2 en máquina limpia.
- Matriz auditoría: `docs/_audit-matrix-cierre.md`.
