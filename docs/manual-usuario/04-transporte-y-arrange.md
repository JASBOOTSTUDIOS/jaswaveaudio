# 04 · Transporte y Arrange

## Barra de transporte

| Control | Atajo típico | Qué hace |
|---------|--------------|----------|
| Reproducir / Pausar | `Espacio` | Play / pause |
| Pausar | `Enter` | Pausa |
| Detener | `Ctrl+Espacio` | Stop y playhead al **punto de inicio** |
| Grabar | `Ctrl+R` | Alterna grabación |
| Bucle | `R` | Activa/desactiva loop |
| Ir al inicio | `W` / `Home` | Playhead y punto de inicio a 0 |
| Ir al final | `End` | Seek final |
| Metrónomo | `K` | Click track |
| BPM | (campo en barra) | Tempo del proyecto |

**Punto de inicio:** al hacer clic (o arrastrar el playhead) en la regla del Arrange o del Piano Roll, esa
posición queda marcada con un triángulo cian y una línea discontinua. **Stop** (y el final automático de la
canción) devuelve el playhead ahí; **Pausa** lo deja donde va. `W` / `Home` lo devuelven a 0. La barra
espaciadora reproduce/pausa en todo el DAW, también con una pista seleccionada en el Arrange o el Mixer y con
el foco en la ventana de un plugin (VST3); solo escribe un espacio en los campos de texto.

También: **Punch in/out** y **Count-in** (MVP) desde transporte / toggles relacionados.

**Monitorización (salida a los altavoces).** Junto a los botones de la IA hay un medidor estéreo (L/R) del master, un
altavoz y un volumen. Ese volumen controla **solo lo que sale por los altavoces o la salida de audio configurada**: no
cambia el master, ni los faders, ni lo que se exporta. Bájalo a cero o pulsa el altavoz para trabajar en silencio y el
medidor seguirá mostrando la señal real del master. Cuando la IA trabaja con «Escuchar a la IA» apagado, la salida se
silencia sola y el altavoz aparece tachado con la marca «IA»: hay señal en el master, pero no está saliendo. El
volumen y el mute se recuerdan en este equipo.

El **medidor de buffer** (blanco → amarillo → rojo) indica ocupación mix→ASIO. Si se pone rojo a menudo, sube el buffer o quita FX pesados.

## Arrange — pistas

1. **Nueva pista de audio** o **Nueva pista MIDI**.
2. Cabecera de pista:
   - Color, nombre
   - **M** mute · **S** solo · armado · monitor
   - Añadir instrumento / FX
   - Importar audio
   - Asa **⋮⋮** — arrastra para **reordenar** (también en el Mixer)
3. Selecciona la pista para el Inspector / FX Chain / Piano roll.

### Tipos útiles

- **Audio** — clips WAV, grabación, import
- **MIDI / instrumento** — notas + VST en la cadena
- **Carpeta** — agrupa pistas y es un **bus de submezcla** (ver abajo)

### Carpetas (buses de submezcla)

Crea una pista de tipo **Carpeta** y mete pistas dentro: todo su audio pasa por los **FX, el fader y el paneo de
la carpeta** antes del Master. Las pistas de dentro se ven con sangría y la carpeta con un icono de carpeta.

- **Meter una pista:** arrastra su asa **⋮⋮** sobre la **mitad derecha** de la cabecera de la carpeta (el
  recuadro se pone cian): queda dentro, justo debajo.
- **Reordenar dentro:** suéltala entre las pistas de la carpeta; adopta esa carpeta.
- **Sacarla:** suéltala sobre la mitad izquierda de la carpeta o entre pistas de fuera, o usa
  **⋮ → Sacar de la carpeta**.
- Las carpetas se pueden anidar; una carpeta nunca entra en sí misma ni en una de sus hijas.
- **Mute** de la carpeta silencia todo lo de dentro. **Solo** de la carpeta deja sonar sus pistas; el **solo** de
  una pista de dentro mantiene su carpeta sonando (si no, no llegaría al Master).
- Mover o meter una pista es **un solo paso** de deshacer (Ctrl+Z).

## Clips

- **Mover** — arrastra el cuerpo del clip (imán/snap según cuadrícula)
- **Duplicar** — `Ctrl`/`Cmd` + arrastrar el cuerpo (estilo Reaper); el original se queda
- **Recortar** — asas izquierda/derecha
- **Dividir en playhead** — atajo `S` (herramienta cortar)
- Copiar / cortar / pegar / duplicar / borrar — menú Editar o atajos
- Arrastrar a otra pista cuando el tipo lo permita

## Herramientas de edición (toolbar)

| Herramienta | Atajo catálogo | Uso |
|-------------|----------------|-----|
| Seleccionar | `1` / N | Selección |
| Mover | `2` / M | Mover clips |
| Dibujar | `3` / B | Crear |
| Cortar / Split | `4` / S | Dividir |
| Borrador | `5` | Borrar |

**Snap / cuadrícula:** Off, 1 compás, 1/2 … 1/16.  
**Zoom:** `Ctrl+=` / `Ctrl+-`, o `Ctrl` + rueda (ancla al cursor).

## Marcadores

Crea marcadores en el playhead para secciones (Intro, Estribillo…). Útiles para ti y para el Asistente / Music Build.
Cuando hay marcadores aparece la fila **Secciones** bajo la regla: doble clic renombra, arrastrar mueve (con imán a la
cuadrícula) y el clic derecho ofrece **Quitar**.

## Acordes y letra en el arreglo

Debajo de la regla, la cabecera del Arrange se convierte en una **pila de filas**: Secciones, **Acordes** y **Letra**.
Las filas solo aparecen cuando tienen datos y se pliegan con la flecha de su etiqueta (a la izquierda). Todas usan la
misma escala que las pistas: se desplazan y amplían con el scroll y el zoom, y la línea amarilla del playhead las
atraviesa.

**Acordes.** Cada acorde es una insignia que ocupa su duración (por defecto un compás). Acepta cualquier cifrado
americano: `D`, `Bm7`, `G/B`, `F#m7b5`, `Cmaj9`, `A7sus4`, `E7alt`, `C7(b9,#11)`, también con `♯`/`♭` y en minúsculas.

- **Doble clic** en una insignia: edita el nombre (Enter aplica, Esc cancela; si no es un acorde válido, el borde se
  pone rojo y no se aplica).
- **Doble clic en un hueco** del carril: crea un acorde en ese compás.
- **Arrastrar** mueve el acorde con imán a la cuadrícula. **Clic derecho → Quitar** lo elimina.
- Todo tiene deshacer (Ctrl+Z).

**Letra.** Pulsa el botón de **Letra** (icono de líneas, junto a la «M» de marcador) y pega el texto: una línea por
frase, estrofas separadas por una línea en blanco. Si el proyecto tiene marcadores, cada estrofa cae en su sección (la
primera en la primera, etc.) y sus frases se reparten por igual; si no, cada frase ocupa dos compases seguidos. Las
palabras se dividen en sílabas automáticamente (`pre-sen-cia`) y se reparten en el tiempo. Mientras suena la canción,
la sílaba que toca **brilla** en ámbar siguiendo el playhead.

- **Doble clic** en una sílaba la edita; **arrastrar** la mueve (con imán); **clic derecho → Quitar frase**.
- En el mismo botón de Letra: **Quitar letra** borra todo el carril.

**Con la IA.** El asistente dispone de `chords.set` / `chords.get` y `lyrics.set` / `lyrics.get`: puedes pedirle «pon
estos acordes: | D | Bm | G A |», «escribe la letra en el arreglo» o preguntarle qué acordes hay. La **banda virtual**
vuelca su hoja de ruta (secciones con un acorde por compás) al carril al producir una canción, y crea un marcador por
sección si no existía.

## Grabación básica de audio

1. Elige pista **audio**.
2. Asigna entrada (dispositivo) en cabecera / Inspector.
3. **Arma** la pista.
4. Activa metrónomo / count-in si quieres.
5. `Ctrl+R` + Play según flujo.
6. Detén → aparece un clip.

> Con **ASIO** como dueño del device, el monitor soft por Chromium puede estar deshabilitado (mensaje honesto). Usa monitor de hardware del interface o WASAPI Shared si necesitas soft-monitor.

Siguiente: [05 · Mixer, FX y automatización](./05-mixer-fx-automatizacion.md).
