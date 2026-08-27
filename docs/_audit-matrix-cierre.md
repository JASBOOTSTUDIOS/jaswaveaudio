# Matriz auditoría checklist (cierre producto) — 2026-08-26

Criterio: terminar canción + entregar archivo. No marketplace/collab.

| # | Ítem | Código | UI | CLI | Veredicto |
|---|------|--------|----|-----|-----------|
| 1 | Bounce WAV | sí | sí | render.start | OK |
| 1 | FLAC/MP3 | sí (ffmpeg PATH) | sí (disable sin ffmpeg) | sí | Parcial — requiere ffmpeg |
| 1 | Stems | sí | checkbox | stems:true | OK (checklist stale) |
| 2 | Native clip playback | dual WebAudio→host | — | — | Gap aceptado fase |
| 2 | Freeze | track-freeze.ts | **sin botón** | track.freeze | Parcial — falta UI |
| 2 | audio-engine stub | stub | — | — | Fuera de path |
| 3 | Sends | state+bounce+host encoding | mixer | send.set | Parcial live |
| 3 | Sidechain | state only | no | sidechain.connect | State-only — ocultar cara |
| 3 | PDC | host applyPdc | — | — | Parcial |
| 4 | VST chunk .jaswave | track-vst-runtime | save/load | — | Likely OK |
| 5 | Monitor | MIDI OK; audio frágil | IN | toggleMonitor | Parcial |
| 5 | Punch/count-in | sí | transport | toggle* | MVP OK |
| 5 | Takes/comping | types only | no | no | Missing — no UI mentirosa |
| 6 | Vol/pan auto + write | sí | lanes panel | writePoint | MVP OK |
| 6 | Plugin param lanes | runtime | thin | writePoint | Parcial |
| 7 | Host quarantine/soak | sí | settings clear | clearQuarantine | Mitigaciones |
| 8 | pack:win | electron-builder | NSIS | npm | Configurado; falta smoke |

**P0 producto:** Music Build host load opcional → silencio Roles; VST2 MIDI a verificar.
