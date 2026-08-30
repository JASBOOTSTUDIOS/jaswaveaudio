# 04 · Comandos MIDI

Todos pasan por el **Command System** (`shared/src/commands/domain-commands.ts`) cuando el agent hace `tienda.executor.execute(...)`.

## Autoría nota a nota (herramienta más precisa)

| type | Payload esencial | Efecto |
|------|------------------|--------|
| `midi.clip.md.read` | `clipId`, `pistaId?` | Lee `clip-<id>.md` en Docs o serializa el clip del DAW |
| `midi.clip.md.upsert` | `clipId`, `pistaId`, `markdown` o `notas[]`, `aplicar?:false` | Escribe el `.md` + **preview en chat** (no timeline) |
| `midi.clip.md.apply` | `clipId`, `pistaId?`, `markdown?` | Parsea el `.md` → `midi.notes.set` o `midi.clip.create` |
| `midi.notes.compare` | `clipId` + `otherClipId` o `markdown` | Diff por `id` (añadidas / quitadas / campos) |

Formato del doc: frontmatter YAML + tabla `| id | pitch | name | inicio | duracion | velocidad | … |`  
Implementación: `jas-wave/src/lib/midi-clip-markdown.ts`. Preview UI: `midi-clip-md-preview.tsx`.

## Comandos de creación / edición de notas

| type | Payload esencial | Efecto |
|------|------------------|--------|
| `midi.clip.create` | `pistaId`, `nombre?`, `inicio?`, `duracion?`, `notas[]` | Crea clip MIDI + notas |
| `midi.notes.set` | `pistaId`, `clipId`, `notas[]` | **Reemplaza** todas las notas del clip |
| `midi.createNotes` | (según schema) | Añade notas |
| `midi.deleteNotes` | ids / selección | Borra |

## Transformaciones

| type | Uso |
|------|-----|
| `midi.transpose` | Semitonos |
| `midi.quantize` | Cuantización |
| `midi.humanize` | Timing/velocity humanizados |
| `midi.setVelocity` | Velocidad relativa/absoluta |
| `midi.makeStaccato` / `midi.makeLegato` | Duraciones |
| `midi.constrainScale` | Filtra a escala |
| `midi.repeat` / `midi.reverse` / `midi.invert` / `midi.timeStretch` | Edición avanzada |
| `midi.applyGroove` | Groove |
| `midi.generatePattern` | Patrones (`bass_funk`, `arp`, `drums`, `pad_chords`, …) — **también código**, no LLM nota a nota |

## Expresión (no van dentro de cada nota del array típico)

| type | Uso |
|------|-----|
| `midi.setCC` | Lane CC (`cc: 64` sustain, etc.) + puntos `{ tiempo, valor }` |
| `midi.setPitchBend` | Puntos de pitch bend |

Music Build **no** llama a estos automáticamente.

---

## Forma de una nota en el payload

Schema de dominio (campos relevantes):

```ts
{
  pitch: number      // obligatorio
  inicio: number     // beats — obligatorio
  duracion: number   // beats — obligatorio
  velocidad?: number // 1–127; si falta → 80
  canal?: number     // si falta → 0
  id?: string        // notes.set; si falta → generarId()
}
```

Al materializar en estado (`mapMidiNotePayload` / handler de `midi.clip.create`):

| Campo en DAW | Origen |
|--------------|--------|
| `pitch`, `inicio`, `duracion` | Del payload (IA o generador) |
| `velocidad` | Payload o **default 80** |
| `canal` | Payload o **default 0** |
| `id` | Payload o **generarId()** |
| `presion` | Siempre **0** (hardcode dominio) |
| `seleccionada` | **false** al crear |

Tipo mínimo del generador de canciones (`GeneratedNote` en `midi-song-generator.ts`):

```ts
{ pitch, inicio, duracion, velocidad }  // sin canal, sin CC, sin id
```

---

## Quién llama a `midi.clip.create`

### A) Music Build (habitual)

```ts
await tienda.executor.execute('midi.clip.create', {
  pistaId: row.trackId,
  nombre: t.nombre,
  inicio: 0,
  duracion: song.durationBeats,
  notas: song.notes, // salida de composeMidiFromBrief
})
```

`song.notes` lo inventa **el algoritmo**, no el JSON del LLM.

### B) ACTIONS directas del LLM

El modelo puede emitir `midi.clip.create` / `midi.notes.set` con `notas: [...]` explícitas.  
Útil para un riff corto o un arreglo fino; malo para 2 minutos × 5 pistas (tokens + inconsistencia).

### C) UI / usuario

Piano roll y herramientas humanas usan los mismos comandos (sin ACTIONS).

---

## Prompt del sistema (extracto de idea)

El system prompt lista los `midi.*` y insiste:

- Music Build / ArrangementSpec para canciones multi-pista
- Velocidades propias por nota (cuando hay lista)
- Sustain piano/pad vía `midi.setCC` cc:64

Siguiente: [05 · Notas IA vs código](./05-notas-ia-vs-codigo.md) — la pregunta central.
