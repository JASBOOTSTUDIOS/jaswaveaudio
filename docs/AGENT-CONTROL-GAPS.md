# Control total del DAW por IA — brechas y agente persistente

> Actualizado 2026-08-24. Complementa `ESTADO-MEZCLA-MASTERIZACION.md` y `ARRANGEMENT-SPEC.md`.

## Respuesta corta

**La IA puede orquestar composición → mezcla (vol/pan/FX/sends/automatización) → masterPass/bounce → AudioListenReport**, con harness que repara y exige plan + listen/target OK.  
**Pendiente fino:** taps de send sample-accurate en el host en vivo y sidechain de plugin.

---

## Qué ya controla

| Área | Capacidad |
|------|-----------|
| Estructura / MIDI | `daw.musicBuild` con spec IA |
| Pistas / VST | create, insert, probe, biblioteca de presets |
| Mezcla | vol/pan/mute/solo, FX, **automation.***, **bus/send/sidechain** (estado) |
| Master / entrega | `daw.masterPass`, `render.start` (+ stems/normalize/flac|mp3), `analysis.*` |
| Freeze | `track.freeze` / `unfreeze` |
| Escucha | `AudioListenReport` en job + plan Evaluación; harness gate |
| Agente | Harness multi-turno + debug dump + plan-incomplete + listen/target |

## Brechas menores

1. Sends live en `renderMix` (hoy suma en bounce + UI).
2. Sidechain real en I/O de slots.
3. Reference track / A-B.
4. No enviar PCM al LLM (por diseño).

## Agente persistente

Tras mutar: inspectDawHealth → plan + empty MIDI + plugins + **listen-failed / compare-target / master-pass-target**.  
Hasta 8×12 acciones; debug real del DAW.

Verificación: `cd shared && npm test` · `cd jas-wave && npx tsc --noEmit`.

## CLI de auditoría (terminal ↔ DAW vivo)

Con la app abierta (`npm run dev`), el main expone `http://127.0.0.1:18787`:

```bash
cd jas-wave
npm run cli -- health
npm run cli -- watch --play   # Play audible + stream de meters/playhead/hang
```

Ver `docs/DAW-CLI-AUDIT.md`.
