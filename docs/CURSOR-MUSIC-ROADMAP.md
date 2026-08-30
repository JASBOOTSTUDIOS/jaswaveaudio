# Cursor para producción musical — roadmap

> Fase 0 (diff + certify badges + revert por turno) se implementa en el producto.
> Este documento fija Fases 1–3 **fuera** del sprint actual.

## Hecho (Fase 0)

- Diff semántico + aceptar/rechazar por acción en propuestas (plan/think/ask)
- Badges de verificación post-turno (`certify`)
- «Revertir esta respuesta» vía snapshot de profundidad de undo
- Modo create: aplica al vuelo + resumen + badges + revert

## Fase 1 — Autocompletado musical y selección

1. **Selección anclada (Ctrl+L musical):** ✅ serializar notas/clips/pista en el chat; botón flotante «Preguntar a Jas» en el piano roll; atajo `ai.askSelection` (Ctrl+L).
2. **Tab / continuación de patrón:** motor heurístico local (escala/acorde/ritmo del clip) invocable desde piano-roll y `daw.continuePattern`. LLM solo como variantes opcionales (no en cada tecla).

### Relacionado (creación nota a nota)

- Music Build default `midiSource: "ai"`: estructura + VST; MIDI por turnos con `midi.clip.create` + `notas[]`.
- Audición corta tras crear clip; prompts de modo Crear fuerzan 1 pista/turno.

## Fase 2 — Dominio de mezcla y escucha

3. **Descriptor de escucha:** empaquetar loudness/spectrum/stereo + contorno por compás para el LLM.
4. **Cerrar gaps de mezcla** ([AGENT-CONTROL-GAPS.md](./AGENT-CONTROL-GAPS.md)): sends sample-accurate, sidechain real en host, reference A/B audible.
5. **Jobs en paralelo:** arranger / mixer / master sobre la cola `harness-until-plan` existente (no confundir con `.agents/` de desarrollo).

## Fase 3 — DX y memoria

6. Atajos tipo Cursor (aceptar/rechazar hunk, continuar patrón, abrir selección en chat, toggle plan).
7. Memoria musical del proyecto: tonalidad / progresión / motivos / decisiones persistidas y consumidas en cada prompt.

## Principios

- Preferir **control visible** (diff, verify, revert) antes de más llamadas LLM.
- No saturar gateways cloud con Tab predictivo o razonamiento × N en cada tecla.
- Reutilizar dry-run, certify y undo existentes; no reinventar pipelines.
