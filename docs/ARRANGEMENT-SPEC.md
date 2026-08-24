# ArrangementSpec — contrato para agentes JasWave

La creatividad musical vive en la **IA**. El cliente solo **renderiza** MIDI y carga VSTs.

## Principio

1. El agente emite un arreglo estructurado (género, forma, progresiones por sección, pistas).
2. `composeMidiFromBrief` / Music Build generan notas a partir de ese plan.
3. Heurísticas locales (`specFromPrompt`, `GENRE_ROLES`, `defaultProgression`) son **fallback** si faltan campos.

## `daw.musicBuild` payload (preferido)

```json
{
  "type": "daw.musicBuild",
  "payload": {
    "aplicar": true,
    "prompt": "texto del usuario",
    "genero": "metal",
    "bpm": 140,
    "tonalidad": "E menor",
    "minutos": 2,
    "progresion": [1, 6, 3, 7],
    "secciones": [
      { "nombre": "Intro", "bars": 4, "degrees": [1, 1, 6, 6], "density": 0.4 },
      { "nombre": "Riff", "bars": 8, "degrees": [1, 6, 3, 7], "density": 0.95 },
      { "nombre": "Breakdown", "bars": 4, "degrees": [1, 7, 6, 5], "density": 0.35, "kind": "breakdown" }
    ],
    "pistas": [
      { "nombre": "Drums", "rol": "drums", "articulacion": "drums", "pluginId": "…" },
      { "nombre": "Bass", "rol": "bass", "articulacion": "bass", "presetId": "…" }
    ]
  }
}
```

- `degrees` / `progresion`: Nashville 1–7.
- `density`: 0–1 (rareza rítmica / plenitud).
- `kind` (opcional): `intro|verse|chorus|bridge|outro|breakdown|build`.
- `presetId`: entrada de la **biblioteca del proyecto** (`library.preset.*`).

## Biblioteca VST del proyecto

| Acción | Uso |
|--------|-----|
| `library.preset.save` | Guarda `estadoPluginBase64` (+ tags) desde una pista |
| `library.preset.list` / `search` | Catálogo para decidir sonido |
| `plugin.probe` | ¿Carga en el host? |
| `library.preset.audition` | Clip corto + play |
| `library.preset.apply` | Inserta VST + restaura estado en una pista |

UI: panel **Biblioteca** (rail izquierdo). Persistencia: `localStorage` por `projectId` y opcional `{projectDir}/library/instruments.json`.

## `daw.generateMidiSong`

Acepta `progresion`, `secciones`, `genero`, `articulacion`. Si hay `secciones`, el motor usa `barPlan` (IA-directed) y no inventa contraste pop.

## Anti-patrones

- No asumir plantilla worship / vi–IV–I–V para todo género.
- No insertar VST inventados: solo catálogo descubierto o biblioteca.
- No dejar vacío `secciones`/`progresion` en canciones largas si el usuario ya describió forma/armonía.
