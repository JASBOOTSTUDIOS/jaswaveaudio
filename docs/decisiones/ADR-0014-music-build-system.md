# ADR-0014: Music Build System

## Contexto

El Asistente Jas puede crear pistas y MIDI, pero un proyecto completo (estructura → pistas → VSTs del catálogo → notas coherentes → mezcla) no debe ser un único tool call ni texto libre del LLM. Cursor orquesta herramientas existentes; JasWave debe orquestar `track.*`, `midi.*`, `plugin.*` y `marker.*` igual.

## Decisión

Añadir un **orquestador** `Music Build System` en el harness de IA (no un comando `createCompleteSong`):

1. **Spec** — tempo, tonalidad, forma, roles (sin mutar el DAW).
2. **Stages** — setup → estructura (marcadores) → pistas + instrumentos del catálogo → MIDI validado → mezcla básica.
3. **Validator** — rango por rol, escala (no drums), solapes en bajo/lead.
4. **Executor** — Command System existente; VSTs solo del registry.
5. **plan.md** — el usuario y la IA ven el build (intención / por implementar / evaluación).

El LLM propone intención; el motor determinista genera y valida MIDI.

## Consecuencias

- Un `daw.musicBuild` orquesta fases; cada fase usa comandos granulares (undo/transacciones).
- Análisis de audio (LUFS) y critic loop quedan para una iteración posterior: el validator MIDI y el mix por rol son el primer corte.
- Si el catálogo VST está vacío, se usa el instrumento builtin; no se inventan plugins.
