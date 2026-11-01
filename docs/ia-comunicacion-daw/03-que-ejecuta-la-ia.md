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

Ejemplos: `track.create`, `clip.move`, `midi.notes.set`, `midi.clip.create`, `plugin.insert`, `send.set`, `render.start` (más bounce nativo en el agent).

Van a `tienda.executor.execute(type, payload)`.

### 2. Orquestadores (cliente)

Viven en `executeDawActions`, llaman a varios comandos por dentro:

| type | Qué hace |
|------|----------|
| `daw.musicBuild` | Spec → pistas → VST → (AI: plan por sección; procedural: clips con notas) → mezcla |
| `daw.composeProject` | Variante de compose de alto nivel |
| `daw.generateMidiSong` | Un clip MIDI (no canción multi-rol completa) |
| `daw.masterPass` | Cadena de master asistida + bounce/listen |
| `library.preset.apply` | Carga preset de Biblioteca |
| `track.freeze` | Bounce + freeze cliente |
| `doc.*` | Leer/escribir Docs |

---

## Music Build — fases que ejecuta el código

Archivo: `jas-wave/src/lib/music-build/executor.ts`.

Orden típico (stages):

1. **spec** — fusiona prompt + payload IA (`mergeMusicBuildSpec`)
2. **setup** — BPM / nombre proyecto
3. **structure** — marcadores por sección
4. **tracks** — `track.create` por rol
5. **instruments** — insert + ensure host slot (falla si no hay slot)
6. **midi** —
   - `midiSource: "ai"` (default): **sin clips**; escribe `plan.md` (sección × pista) y deja huecos al harness
   - `midiSource: "procedural"`: `composeMidiFromBrief` → `midi.clip.create` **con notas** por sección
7. **mix** — `track.update` vol/pan; opcional `bus.create` + `send.set`
8. **validate** — issues

La IA **elige la spec**; el executor **corre las fases**. Los clips con notas los inserta la IA (o el procedural) en turnos siguientes.

---

## Harness hasta completar (modo Crear)

Tras mutar, si quedan huecos de sección o el auditor de producción tiene errores:

1. Inspecciona salud + `inspectProduction` (VST, rango MIDI, huecos, mezcla, listen)
2. Prompt: **siguiente hueco** (`Drums · Verso 32–64`) + dump del DAW
3. Parsea ACTIONS (máx. ~12; fingerprint por `pistaId`+`inicio` en clips)
4. Ejecuta (create/patch con notas; audition corta)
5. Repite (presupuesto alto de turnos internos + outer until-plan) hasta audit limpio, plan OK, abort o tope

Cuando el mapa de huecos está vacío: exige `render.start` + `analysis.compareTarget` (target streaming/club/cd).

Archivos: `ai-harness/src/loop/harness.ts`, `until-plan.ts`, `production-audit.ts`, `plan/section-coverage.ts`, `jas-wave/src/lib/agent-harness-job-runner.ts`.

---

## Diff / certify / revert (UX)

- Propuestas pueden mostrarse como cards con aceptar/rechazar.
- Post-turno: badges (`health`, plan, **huecos**, **audit**).
- Revertir respuesta = undo apilado de ese turno.

Eso no cambia el modelo de comandos: sigue siendo executor + undo.
