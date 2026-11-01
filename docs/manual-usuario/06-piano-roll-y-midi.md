# 06 · Piano roll y MIDI

## Abrir el piano roll

1. Selecciona un **clip MIDI** en el Arrange (o una pista MIDI).
2. Abre el panel **Piano roll**.

Si no hay clip, verás un shell vacío: crea notas o pide al Asistente un clip.

## Timeline (paridad con el Arrange)

La regla y el grid del piano roll usan la misma profundidad de encaje y la misma semántica de gestos temporales:

| Gesto | Efecto |
|--------|--------|
| Rueda (o Ctrl+rueda) | Zoom horizontal **anclado al playhead** |
| Shift+rueda | Pan horizontal |
| Ctrl+Shift+rueda | Zoom vertical (altura de teclas) |
| `+` / `−` | Zoom H anclado al playhead |
| Arrastrar en la regla | Seek (playhead); tooltip `compás.beat` |
| Clic vacío (herramienta seleccionar) | Seek en esa posición |
| Magnet (barra de transporte del piano) | Imán del seek (`ui.playheadSnap`) |
| `S` | Imán de **notas** (snap del proyecto) |
| `1–8` / `0` | Profundidad de encaje (mismo selector que el Arrange) |
| ← / → | Con notas seleccionadas: mover notas · sin selección: pan |
| Alt+← / → | Pan ~1 compás (sin selección) |
| Alt+Ctrl+arrastrar vacío | Crear nota con duración del arrastre (como clip MIDI en Arrange) |
| Alt+arrastrar vacío | Crear nota con duración |
| Ctrl+arrastrar nota | Duplicar y colocar la copia (estilo Reaper); Ctrl+clic sin mover = toggle selección |
| Clic derecho en nota | Borrar nota (si está en una selección múltiple, borra toda la selección) |

La rejilla muestra como máximo el trío **S · S/2 · S/4** según el zoom (nunca más fino que S/4).

## Herramientas

| Acción | Atajos habituales |
|--------|-------------------|
| Seleccionar | `V` |
| Dibujar notas | `D` / `B` |
| Borrar | `E` / `X` |
| Cuantizar | `Q` |
| Velocidad | `G` |
| Expresión / CC | `F` |

También: transponer (↑↓), mover en tiempo (←→ con selección), copiar/pegar, Alt-drag para precisión.

## Snap musical

Negra, corchea, semicorchea… — alinea dibujo y movimientos al grid. El selector de profundidad es el mismo que en el Arrange.

**Magnet** (transporte) afecta solo al seek/playhead; **S** / toolbar Imán afecta el snap de notas y clips.

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

**Timing:** el motor sella cada nota del teclado en cuanto llega (reloj de alta resolución de Windows) y la
coloca en su muestra exacta dentro del bloque de audio, así que lo que tocas no «baila» con el tamaño del
buffer. Al grabar, la nota queda donde la tocaste, no donde la vio la interfaz.

El Asistente también escucha lo que tocas: pídele *«analiza lo que acabo de tocar»* (o *«tócalo como yo»*) y
mide tus últimos segundos: notas, rango, dinámica, tempo, adelantos/retrasos respecto a la rejilla en ms,
flams y acordes arpegiados (acción `analysis.midiPlayed`).

### Tu toque

El Asistente puede aprender **cómo tocas** a partir de tus clips MIDI o de lo que acabas de tocar: micro-tiempos
de cada nota en ms (en el tiempo fuerte, los débiles, los contratiempos y las subdivisiones), si arpegias los
acordes (grave→agudo o al revés, ms entre notas), la microdinámica (qué voz del acorde destacas, curva de los
arpegios, ataque al empezar una frase) y la articulación (legato o staccato). Pídele *«analiza mi toque en esta
pista»* (`analysis.touch`), *«guarda mi toque de piano como “Mi piano”»* (`style.touch.learn`) y *«aplica mi
toque a la melodía nueva»* (`style.touch.apply`, se deshace con Ctrl+Z). Guarda un perfil por instrumento; con
pocas notas el perfil se marca de confianza baja. Al producir un tema de worship puedes pedir que cada rol use tu
toque (`perfilToque`).

## Sostener las notas como en worship (legato worship)

En una canción de adoración, alabanza o balada las notas no se cortan: cada nota o acorde sigue sonando, como con el
pedal pisado, hasta **500 ms después** de que empiece la siguiente. Así no quedan huecos en las melodías. Los **pads**
siempre suenan (sostienen hasta el siguiente acorde y se mezclan con él) y la **batería y la percusión no se tocan**.

- **Cuándo usarlo:** una melodía, un piano o una guitarra que suenan «picados» o con silencios entre notas, sobre todo
  si los escribiste o tocaste de forma corta. No lo uses en música que debe sonar seca (funk, staccato, pop rítmico).
- **Cómo:** pídeselo al asistente («sostén las notas del piano como en worship») o ejecuta la acción
  `midi.notes.legatoWorship` con la pista y, si quieres, un clip, `solapeMs` (500 por defecto; 1000 en pads) y
  `modo` (`legato`, `pad` o `auto`, que reconoce los pads por el nombre). Se puede deshacer con Ctrl+Z.
- **La banda virtual** lo aplica sola al escribir cuando tu pedido habla de adoración, alabanza, worship o balada. Se
  controla con el ajuste local `jaswave-banda-legato` (`worship` por defecto, `siempre` o `nunca`).
- Los silencios largos entre frases o secciones (más de 8 tiempos) se respetan: son intencionales.

## Biblioteca de Grooves (ritmos de batería)

Un **groove** es un patrón de batería ya escrito en MIDI (por ejemplo, un «pop 4/4» o un «6/8 worship»). Sirve para
tener un ritmo base en segundos, sin escribirlo nota a nota, y luego editarlo en el Piano roll como cualquier clip.

**Dónde se abre:** menú **Ver → Herramientas → Grooves** (se coloca a la izquierda). Si el panel muestra «no disponible»,
la biblioteca no está accesible en ese entorno (por verificar los casos exactos).

**Qué hay en la pantalla:**

- **Barra superior:** cuántos ritmos y estilos hay; **Añadir groove…** (importa tus propios archivos `.mid`; también
  puedes soltarlos en la lista con un estilo elegido), **Nuevo estilo** (una carpeta propia) y un botón de carpeta
  que abre la carpeta de grooves en el disco.
- **Buscador y filtros:** texto libre (estilo, nombre, etiqueta) y desplegables **Compás**, **Tipo**, **Intensidad**
  (mínima) y **Etiqueta**.
- **Columna izquierda de estilos:** «Todos» y cada estilo con su número de ritmos; al elegir uno aparecen sus
  subestilos. Con un estilo elegido puedes **renombrarlo** o **borrarlo** (va a la papelera).
- **Lista de ritmos:** cada fila tiene una estrella (**favorito**), un botón de **escuchar** la vista previa, y
  **Insertar**. En tus propios grooves hay además **Proponer al catálogo** y borrar (a la papelera).
- **Barra inferior (cómo se inserta):**
  - **Pista:** la pista MIDI de batería donde se pondrá. Si no hay ninguna, créala antes.
  - **Compases:** cuántos compases insertar (0 = los que tenga el groove).
  - **Variación humana:** pequeñas variaciones para que no suene idéntico cada vez.
  - **Fill al final:** cambia el último compás por un *fill* (redoble o adorno de cierre) del mismo estilo.
  - **Escalar al tempo:** mantiene la duración real del groove al tempo del proyecto (por defecto las notas siguen los pulsos).
  - **Adaptar compás:** ajusta el groove al compás del proyecto (por verificar el detalle exacto de la adaptación).
  - **Insertar en el playhead:** coloca el groove elegido donde está el cursor de reproducción.

**Pasos:** 1) crea una pista MIDI con una batería cargada (por ejemplo **Worship Drums**); 2) abre **Grooves**;
3) busca un estilo y pulsa el botón de escuchar; 4) elige la pista en la barra inferior y pulsa **Insertar**.

**Sincronización y compartir** (barra bajo el título): **Actualizar grooves automáticamente** baja ritmos nuevos del
catálogo de JasWave y retira los que se quiten (tus grooves nunca se tocan); **Sincronizar ahora** lo hace al momento.
**Compartir mis grooves con JasWave para mejorar el catálogo** viene **apagado**; al activarlo se pide permiso y,
si aceptas, autorizas incluirlos en el catálogo bajo licencia CC0. Solo se envían los que tú creaste.

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
