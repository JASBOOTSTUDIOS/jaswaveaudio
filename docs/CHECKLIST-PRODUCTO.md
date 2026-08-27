# Checklist de producto — JasWave completo

> Criterio: **terminar una canción aquí y entregar un archivo**, no el roadmap entero (marketplace, colaboración, stems por IA).
> Fecha: 2026-08-26 · Reconciliado tras cierre de fase (auditoría + CLI + fixes Roles/host).

Hoy: arrange, mixer, piano roll, transporte, metrónomo, clips, JasWave Roles/Piano VST3, VST3/VST2 x64 (UI+DSP), FX serial, WASAPI/ASIO, copiloto + Music Build + harness CLI (`127.0.0.1:18787`).

---

## Bloqueantes (sin esto no es un DAW de producción)

### 1. Exportar / bounce
- [x] Bounce / render offline a **WAV** (PCM16/24; notas VST + clips; LUFS adjunto)
- [x] Exportar **FLAC** y **MP3** (vía `ffmpeg` en PATH; UI deshabilita formatos si falta; error honesto si falla conversión)
- [x] Rango (todo el proyecto o selección de tiempo)
- [x] Progreso y cancelar
- [x] Stems por pista (post-bounce dry stems)

### 2. Un motor, no dos
- [ ] Playback nativo de clips (hoy: Web Audio → pipe → host) — aceptado en esta fase
- [x] Freeze de pista (CLI `track.freeze` + botón Freeze/Unfreeze en inspector)
- [x] Render offline = el mismo audio que Play (stems pre-renderizados; MIDI host)
- [ ] Addon `native/audio-engine` fuera de stub o retirado del camino — stub fuera del path de producto

### 3. Mezcla de estudio
- [x] Sends / returns (estado + bounce + encoding live en host)
- [ ] Sidechain (comando de estado; **sin I/O host** — no presentar como audible)
- [x] PDC relativa en `renderMix` del host (cap 16384)
- [x] Freeze / bounce in place (vía freeze)

### 4. Estado de plugins en el proyecto
- [x] Chunk / preset del VST en el `.jaswave` (snapshot/restore)
- [x] Reabrir restaura instrumento (chunk primero; overlay params si falla)
- [x] Bypass y parámetros de la cadena persisten

### 5. Grabación usable
- [x] Monitoreo de entrada (MIDI thru fiable; audio monitor limitado vs ASIO)
- [x] Punch in/out (MVP transport + ventana)
- [ ] Tomas / comping (tipos only — **sin UI mentirosa**)
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
- [ ] Soak 4h+ BFD/Kontakt formal — script `cli/_soak-host.mjs` existe; no corrido 4h en este cierre

### 8. Producto instalable
- [x] Build empaquetado Windows (`npm run pack:win` → `release/JasWave-Setup-0.1.0.exe`; `signAndEditExecutable: false` + `CSC_IDENTITY_AUTO_DISCOVERY=false` en Windows sin privilegios de symlink)
- [x] Artefacto NSIS generado (smoke manual: instalar/abrir `.exe` sin `npm run dev`)

---

## Después (no bloquean “completo”)

- [ ] Macros y scripting
- [ ] Themes / atajos configurables a fondo
- [ ] Extensiones del DAW
- [ ] Colaboración multi-usuario
- [ ] IA generativa de audio
- [ ] Separación de stems / análisis avanzado
- [ ] Nube y marketplace

---

## Notas de cierre 2026-08-26

- Soft Pad Web Audio eliminado: instrumentos = Roles/Piano VST u externos (Decent/4Front).
- Music Build: host load obligatorio + path `%LOCALAPPDATA%` vía preload sync; MIDI solo a slots host-confirmados.
- Suite CLI: `node cli/_certify.mjs --full` — health, AI actions, external VSTs verdes; e2es Roles dependen de host estable (reinicio limpio recomendado antes de certify).
- Matriz auditoría: `docs/_audit-matrix-cierre.md`.
