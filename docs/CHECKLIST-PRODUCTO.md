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
- [ ] Playback nativo de clips (hoy: Web Audio → pipe → host) — **aceptado / diferido post-1.0**
- [x] Freeze de pista (CLI `track.freeze` + botón Freeze/Unfreeze; bypass snapshot en unfreeze)
- [x] Render offline = el mismo audio que Play (stems pre-renderizados; MIDI host; fail-loud sin slot)
- [ ] Addon `native/audio-engine` fuera de stub o retirado del camino — **diferido post-1.0** (stub fuera del path de producto)

### 3. Mezcla de estudio
- [x] Sends / returns (estado + bounce + encoding live en host `renderMix`)
- [ ] Sidechain (comando de estado; **sin I/O host audible**) — **diferido post-1.0**; IA/UI no lo presentan como audible
- [x] PDC relativa en `renderMix` del host (cap 16384)
- [x] Freeze / bounce in place (vía freeze)

### 4. Estado de plugins en el proyecto
- [x] Chunk / preset del VST en el `.jaswave` (snapshot/restore)
- [x] Reabrir restaura instrumento (chunk primero; overlay params si falla)
- [x] Bypass y parámetros de la cadena persisten

### 5. Grabación usable
- [x] Monitoreo de entrada (MIDI thru fiable; audio monitor: mensaje honesto si ASIO posee el device)
- [x] Punch in/out (MVP transport + ventana)
- [ ] Tomas / comping (tipos only — **diferido post-1.0**, sin UI mentirosa)
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
- [ ] Soak 4h+ BFD/Kontakt formal — script `cli/_soak-host.mjs` soporta `SOAK_MINUTES=240`; ejecutar en máquina de release

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
- [ ] Sidechain I/O real a plugins
- [ ] Tomas / comping UI
- [ ] Motor C++ único (retirar dual Web Audio→host)
- [ ] Cursor-music Fases 1–3 (Tab MIDI, mezcla fiel descriptor, memoria) — ver [CURSOR-MUSIC-ROADMAP.md](./CURSOR-MUSIC-ROADMAP.md)

---

## Notas de cierre 2026-08-28

- Bounce offline: `push_stem` + `pull_stem` en `renderMix` cuando `gOfflineRunning`.
- Music Build / bounce: abortan si hay VST sin slot host (`host-slot-unconfirmed`).
- Sidechain: plan eval y `sidechain.connect` en agente fallan de forma honesta en 1.0.
- Soft Pad Web Audio eliminado: instrumentos = Roles/Piano VST u externos (Decent/4Front).
- Suite CLI: `node cli/_certify.mjs --full` — gate release: verde ×2 en máquina limpia.
- Matriz auditoría: `docs/_audit-matrix-cierre.md`.
