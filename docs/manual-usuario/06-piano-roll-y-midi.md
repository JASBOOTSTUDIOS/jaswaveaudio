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

Siguiente: [07 · VST e instrumentos](./07-vst-e-instrumentos.md).
