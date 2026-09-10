# 06 · Piano roll y MIDI

## Abrir el piano roll

1. Selecciona un **clip MIDI** en el Arrange (o una pista MIDI).
2. Abre el panel **Piano roll**.

Si no hay clip, verás un shell vacío: crea notas o pide al Asistente un clip.

## Herramientas

| Acción | Atajos habituales |
|--------|-------------------|
| Seleccionar | `V` |
| Dibujar notas | `D` / `B` |
| Borrar | `E` / `X` |
| Cuantizar | `Q` |
| Velocidad | `G` |
| Expresión / CC | `F` |

También: transponer (↑↓), mover en tiempo (←→), copiar/pegar, Alt-drag para precisión.

## Snap musical

Negra, corchea, semicorchea… — alinea dibujo y movimientos al grid.

## Audición

Las notas suenan por el **VST de la pista**. Si no oyes nada:

1. ¿Hay instrumento en la FX Chain?
2. ¿El host confirmó el slot? (caption “host listo”)
3. ¿Pista mute / solo de otra pista?
4. ¿Volumen a cero?

## MIDI hardware

1. Conecta teclado USB / controlador.
2. Ajustes → **MIDI** / asigna **entrada** en la pista.
3. Activa **monitor** en la pista para thru.
4. **Ctrl+Shift+M** — **MIDI Learn** / Control MIDI para mapear faders a acciones o parámetros.

## Expresión

Lanes de CC (p. ej. sustain CC64, mod wheel) y pitch bend según el editor.  
Pide al Asistente: “añade sustain (CC64) en el piano del estribillo”.

## Buenas prácticas MIDI

- Escribe o genera a **velocidades variadas** (no todo a 100).
- Cuantiza con groove suave si suena robótico.
- Un clip por sección facilita editar y que la IA no pise todo el arreglo.

## MIDI · MD (clip como archivo editable)

Cada clip MIDI puede vivir como un Markdown en Docs del proyecto: `clip-{id}.md`.  
**Piano roll** y **MIDI · MD** son **tabs independientes** (acoplables / movibles / undock). No van lado a lado en un solo panel.

### Sync en vivo

1. Clic derecho en un clip MIDI → **Abrir MIDI · MD**, o el botón **MIDI · MD** en la toolbar del piano roll.
2. Se abre el tab **MIDI · MD** y se vincula el clip (`Sync ON`).
3. Editas notas en el **piano roll** → el `.md` se actualiza solo.
4. Editas la tabla en **MIDI · MD** → las notas del clip (y el piano roll) se actualizan si el parse es válido.
5. Puedes dejar cada tab en zonas distintas o independizar una ventana.

Si el `.md` está mal formado, verás un banner de error y **no** se pisa el MIDI.

### Contrato del archivo

1 archivo = 1 clip. Tiempo en **beats**. Pitch = número MIDI 0–127.

```markdown
---
clipId: abc123
trackId: pista-piano
nombre: Intro Piano
inicio: 0
duracion: 16
bpm: 120
compas: 4/4
trackName: Piano
---

# Clip MIDI · Intro Piano

## Notas

| id | pitch | name | inicio | duracion | velocidad | canal | mute | articulation | releaseVelocity | probability | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n_a1 | 60 | C4 | 0 | 1 | 96 | 0 |  |  |  |  |  |
```

- Frontmatter obligatorio: `clipId`, `trackId`, `nombre`, `inicio`, `duracion`.
- En la tabla, manda `pitch` (la columna `name` es solo lectura).
- Sección `## Expresión` opcional (CC / pitch bend).
- No es un `.mid` binario ni un manifiesto multi-pista.

Siguiente: [07 · VST e instrumentos](./07-vst-e-instrumentos.md).
