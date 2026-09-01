# 03 · Qué ejecuta la IA

## Modos → permiso de mutación

| Modo UI | ¿Mutar DAW? | Qué suele emitir |
|---------|-------------|------------------|
| **Consulta** (`ask`) | No | Texto; tools read-only en reasoning |
| **Plan** (`plan`) | No | `<<<DOC plan.md>>>` + `<<<PLAN>>>`; ACTIONS solo borrador / `aplicar:false` |
| **Pensar** (`think`) | No | Arreglo profundo + preview `daw.musicBuild { aplicar: false }` |
| **Crear** (`create`) | **Sí** | ACTIONS con efecto; Music Build `aplicar: true`; harness repara |
| **Auto** | Detecta | Según texto (`detectAgentMode`) |

Código: `ai-harness/src/agent/modes.ts` → `modeBlocksMutation`.

---

## Dos tipos de “type” en ACTIONS

### 1. Comandos de dominio (1 acción = 1 mutación undoable)

Ejemplos: `track.create`, `clip.move`, `midi.notes.set`, `plugin.insert`, `send.set`, `render.start` (más bounce nativo en el agent).

Van a `tienda.executor.execute(type, payload)`.

### 2. Orquestadores (cliente)

Viven en `executeDawActions`, llaman a varios comandos por dentro:

| type | Qué hace |
|------|----------|
| `daw.musicBuild` | Spec → pistas → VST catálogo → `composeMidiFromBrief` → `midi.clip.create` por pista → mezcla básica |
| `daw.composeProject` | Variante de compose de alto nivel |
| `daw.generateMidiSong` | Un clip MIDI (no canción multi-rol completa) |
| `daw.masterPass` | Cadena de master asistida |
| `library.preset.apply` | Carga preset de Biblioteca |
| `track.freeze` | Bounce + freeze cliente |
| `doc.*` | Leer/escribir Docs |

---

## Music Build — fases que ejecuta el código

Archivo: `jas-wave/src/lib/music-build/executor.ts`.

Orden típico (stages):

1. **spec** — fusiona prompt + payload IA (`mergeMusicBuildSpec`)
2. **setup** — BPM / nombre proyecto
3. **markers** — estructura
4. **tracks** — `track.create` por rol
5. **instruments** — insert + ensure host slot (falla si no hay slot)
6. **midi** — por cada pista: `composeMidiFromBrief` → `midi.clip.create`
7. **mix** — `track.update` vol/pan; opcional `bus.create` + `send.set`
8. **validate** — issues MIDI

La IA **elige la spec**; el executor **corre las fases**.

---

## Harness (modo Crear)

Si queda trabajo en `plan.md` (Por implementar):

1. Inspecciona salud del DAW / plan
2. Pide otro turno al LLM (“repara…”)
3. Parsea nuevas ACTIONS
4. Ejecuta
5. Repite hasta plan vacío o tope de intentos

Archivos: `jas-wave/src/lib/agent-harness-job-runner.ts`, `ai-harness/src/loop/harness.ts`.

---

## Diff / certify / revert (UX)

- Propuestas pueden mostrarse como cards con aceptar/rechazar.
- Post-turno: badges de verificación (`agent-certify-pipeline`).
- Revertir respuesta = undo apilado de ese turno.

Eso no cambia el modelo de comandos: sigue siendo executor + undo.

Siguiente: [04 · Comandos MIDI](./04-comandos-midi.md).
