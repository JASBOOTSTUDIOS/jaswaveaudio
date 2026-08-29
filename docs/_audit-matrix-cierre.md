# Matriz auditoría checklist (cierre producto) — 2026-08-28

Criterio: terminar canción + entregar archivo. No marketplace/collab.

| # | Ítem | Código | UI | CLI | Veredicto |
|---|------|--------|----|-----|-----------|
| 1 | Bounce WAV | sí (+ pull_stem offline) | sí | render.start | OK |
| 1 | FLAC/MP3 | sí (ffmpeg PATH) | sí (disable sin ffmpeg) | sí | Parcial — requiere ffmpeg |
| 1 | Stems | sí | checkbox | stems:true | OK |
| 2 | Native clip playback | dual WebAudio→host | — | — | Gap aceptado post-1.0 |
| 2 | Freeze | track-freeze.ts + bypass snapshot | botón inspector | track.freeze | OK |
| 2 | audio-engine stub | stub | — | — | Fuera de path |
| 3 | Sends | state+bounce+host live | mixer | send.set | OK live (verificar smoke) |
| 3 | Sidechain | state + meter | oculto / IA rechaza | sidechain.connect fail-loud | State-only — no audible 1.0 |
| 3 | PDC | host applyPdc | — | — | Parcial |
| 4 | VST chunk .jaswave | track-vst-runtime | save/load | — | OK |
| 5 | Monitor | MIDI OK; audio mensaje ASIO | IN | toggleMonitor | Honesto vs ASIO |
| 5 | Punch/count-in | sí | transport | toggle* | MVP OK |
| 5 | Takes/comping | types only | no | no | Diferido post-1.0 |
| 6 | Vol/pan auto + write | sí | lanes panel | writePoint | MVP OK |
| 6 | Plugin param lanes | runtime | thin | writePoint | Parcial |
| 7 | Host quarantine/resync | sí | settings clear | clearQuarantine | Mitigaciones + resync×2 |
| 7 | Soak | `_soak-host.mjs` SOAK_MINUTES | — | npm run cli:soak-host | Script listo; 4h manual release |
| 8 | pack:win | electron-builder | NSIS | npm | OK |
| 8 | VST2 | x64 only caption | sí | — | Política documentada |

**P0 cerrado en código:** bounce audio stems offline; Music Build/bounce fail-loud sin slot; freeze clipId + bypass restore.
