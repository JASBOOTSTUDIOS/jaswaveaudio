# Cómo se comunica la IA con el DAW

Documentación técnica (y legible) del puente **Asistente Jas → comandos → estado del DAW**, la estructura de **`plan.md`**, qué se **ejecuta**, y cómo se crean las notas **MIDI** (IA vs código).

> No es el [manual de usuario](../manual-usuario/README.md). Aquí está el *cómo funciona por dentro*.

## Índice

| Archivo | Contenido |
|---------|-----------|
| [01 · Pipeline de comunicación](./01-pipeline-comunicacion.md) | Chat → LLM → ACTIONS → `executeDawActions` → Command System |
| [02 · plan.md y bloques](./02-plan-md-y-bloques.md) | Secciones del plan, `<<<PLAN>>>`, `<<<DOC>>>`, `<<<ACTIONS>>>` |
| [03 · Qué ejecuta la IA](./03-que-ejecuta-la-ia.md) | Modos, orquestadores, harness de reparación |
| [04 · Comandos MIDI](./04-comandos-midi.md) | Tipos de comando, payloads, defaults del dominio |
| [05 · Notas: IA vs código](./05-notas-ia-vs-codigo.md) | **Respuesta clara:** Music Build no inventa nota a nota en el LLM |

## Respuesta corta (MIDI)

En el camino habitual (**Music Build** / canción multi-pista):

- La IA decide **intención**: género, BPM, tonalidad, secciones, roles, a veces `articulacion` / `presetId`.
- El código (`composeMidiFromBrief`) **calcula cada nota**: pitch, inicio, duración, velocidad.
- El Command System rellena lo que falte: `canal = 0`, `velocidad` default **80** si no viene, `id`, `presion = 0`.
- **CC / pitch bend** no los genera Music Build; solo si la IA emite después `midi.setCC` / `midi.setPitchBend`.

La IA *puede* enviar nota a nota con `midi.clip.create` / `midi.notes.set` en ACTIONS, pero el prompt de producto empuja a **Music Build** para canciones completas (no listas enormes de notas en el chat).
