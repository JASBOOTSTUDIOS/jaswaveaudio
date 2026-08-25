# CLI de auditoría y control total del DAW

Con JasWave abierto (`npm run dev`), el main expone `http://127.0.0.1:18787`.

La CLI usa **la misma vía que el chat IA**: `executeDawActions` (pistas, MIDI, plugins, musicBuild, masterPass, render, docs, …).

## Comandos

```bash
cd jas-wave

npm run cli -- health
npm run cli -- list                      # catálogo completo
npm run cli -- list --filter track
npm run cli -- state                     # ids de pistas/clips/plugins

# Cualquier acción IA
npm run cli -- action track.create '{"nombre":"Bass","tipo":"midi"}'
npm run cli -- action project.setBpm '{"bpm":128}'
npm run cli -- track.create '{"nombre":"Pad","tipo":"midi"}'   # atajo: type como subcomando

# Lote
npm run cli -- actions '[{"type":"track.create","payload":{"nombre":"Drums","tipo":"midi"}},{"type":"transport.toggle"}]'
npm run cli -- actions @lote.json

# Transporte / audit
npm run cli -- play | pause | stop
npm run cli -- watch --play
npm run cli -- audit
```

Payload: JSON inline, `@archivo.json`, o `-` (stdin).

## HTTP (para agentes)

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/health` | Bridge vivo |
| GET | `/state` | Resumen proyecto |
| GET | `/actions` | Catálogo |
| POST | `/actions` | `{type,payload}` o `{actions:[…]}` |
| POST | `/command` | Alias de una acción |
| GET | `/audit` / `/audit/stream` | Meters + playhead |
| POST | `/transport` | play/pause/stop/toggle/seek |

## Soft Pad / audibilidad (producción)

- Music Build inserta **Soft Pad en toda pista MIDI** + VST si hay catálogo.
- Playback: `softPadDual` suena Soft Pad (timbre por rol) **y** VST a la vez si el kit/preset del VST está vacío.
- Timbres por rol: `jas-wave/lib/role-voice.ts` (drums/bass/guitar/piano/pad/…).
- Mezcla: bus `Reverb FX` + sends por rol.

## Sync / underruns / metrónomo

```bash
npm run cli -- sync 10          # play + muestreo buffer/playhead (~10s)
npm run cli -- action analysis.timing
npm run cli -- action analysis.buffer @_buf-sample.json
```

`sync` escribe `cli/_probe-sync-out.json` (underruns, drift, fill). Exit 0 = estable.

## Aislar FX que rompe el audio

Con play audible (recomendado):

```bash
npm run cli -- action analysis.fxBlame '{"sampleMs":350,"settleMs":120}'
# Solo una pista:
npm run cli -- action analysis.fxBlame '{"trackId":"…","includeInstruments":true}'
```

Devuelve `suspects[]` ordenados por mejora al hacer bypass (buffer + peaks). Restaura la cadena al terminar. Si no hay sospechoso FX → Soft Pad/ASIO (`analysis.buffer`).
