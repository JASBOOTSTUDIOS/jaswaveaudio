# Control total del DAW por IA — brechas y agente persistente

> Actualizado 2026-08-24. Complementa `ESTADO-MEZCLA-MASTERIZACION.md` y `ARRANGEMENT-SPEC.md`.

## Respuesta corta

**La IA puede orquestar composición → mezcla (vol/pan/FX/sends/automatización) → masterPass/bounce → AudioListenReport**, con harness que repara, evalúa plan.md con criterios por tarea, y exige listen/target OK cuando aplica.

---

## Harness (2026-08)

| Gate | Código | Notas |
|------|--------|-------|
| Slot VST host | `host-slot-unconfirmed` | Tras Music Build; usa `/audit` vstSlot |
| MIDI sin señal | `silent-midi-track` | Peak en meters bajo umbral |
| Sidechain | `sidechain-unverified` / `sidechain-silent` | Estado + graph `$` en host; peaks en audit |
| Plan por tarea | `plan-incomplete` | `agent-plan-eval` (track/vst/mix/bounce) |
| Permisos UI | Ajustes → IA | `permissionManager` cableado al coproducer |

Verificación: `npx tsx --test src/lib/agent-harness.test.ts` · `src/lib/agent-plan-eval.test.ts` · `cd jas-wave && npm run cli -- audit`  
**Pendiente fino:** sidechain I/O a plugins (post-1.0). Sends live en host OK.

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
| Aislar FX malo | `analysis.fxBlame` (bypass A/B + buffer/peaks) |
| Agente | Harness multi-turno + debug dump + plan-incomplete + listen/target |

## Brechas menores

1. ~~Sends live en `renderMix`~~ — host suma sends sample-accurate (verificar smoke).
2. Sidechain real en I/O de slots — **diferido 1.0**; agente rechaza `sidechain.connect`; plan eval → `sidechain-unverified`.
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
