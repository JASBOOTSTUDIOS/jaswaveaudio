# 14 · Conceptos para principiantes

Si nunca has usado un **DAW** (programa para grabar, editar y mezclar música), empieza aquí. Cada término se explica
con palabras sencillas y se dice **dónde se encuentra** en JasWave. Los nombres entre **negrita** son los que ves en la
pantalla.

> Para abrir cualquier panel: menú **Ver → Herramientas** y elige su nombre, o el icono del rail izquierdo
> (ver [02 · Interfaz](./02-interfaz.md)). Para buscar cualquier acción por nombre: **Ctrl+Shift+P** (paleta de comandos).

## La idea general

Un DAW funciona como un estudio de grabación dentro de la computadora:

1. **Grabas o escribes** música en **pistas** (cada instrumento o voz va en la suya).
2. **Editas** lo grabado (corriges notas, cortas, mueves).
3. **Mezclas**: ajustas el volumen, el lado (izquierda/derecha) y los efectos de cada pista para que suenen bien juntas.
4. **Exportas** una canción terminada a un archivo (WAV, MP3…).

## Audio y MIDI: las dos clases de música

| Tipo | Qué es | Ejemplo |
|------|--------|---------|
| **Audio** | Un sonido ya grabado (una onda) | La voz grabada con un micrófono |
| **MIDI** | Las «instrucciones» de qué notas tocar, cuándo y con qué fuerza; no tiene sonido hasta que un **instrumento** (plugin) las toca | Lo que toca tu teclado; las notas del piano roll |

Ventaja del MIDI: puedes cambiar notas, tempo o el instrumento después sin volver a tocar. Para que el MIDI suene
necesita un instrumento cargado en la pista (ver [07 · VST e instrumentos](./07-vst-e-instrumentos.md)).

## Dónde está cada cosa

| Nombre en pantalla | Para qué sirve | Dónde se abre |
|--------------------|----------------|---------------|
| **Arrange** | La línea de tiempo con todas las pistas y clips: aquí armas la canción | Centro; icono Arrange |
| **Mixer** | Un fader (control de volumen) por pista, paneo, mute/solo, envíos, efectos | Panel inferior; icono Mixer |
| **Piano roll** | Editar las notas de un clip MIDI como en un teclado visual | Panel inferior; selecciona un clip MIDI y abre el panel **Piano roll** |
| **Biblioteca** | Audios, samples y presets guardados | Panel izquierdo |
| **Inspector** | Propiedades de la pista o clip seleccionado | Panel derecho |
| **Instrumentos** | Catálogo de instrumentos y efectos disponibles | Panel izquierdo |
| **FX Chain** | La cadena de efectos de la pista elegida (o del Master) | Panel derecho |
| **Editor de plugin** | La ventana con los controles del instrumento o efecto elegido | Panel derecho |
| **Ruteo** | Buses y envíos (a dónde manda su sonido cada pista) | Panel derecho |
| **Medidores** | Espectro, estéreo y volumen general (LUFS) | Panel derecho |
| **Automatización** | Curvas que mueven volumen o paneo solos durante la canción | Menú **Ver → Herramientas** |
| **MIDI Learn** | Asignar una tecla, perilla o fader de tu controlador a una función del DAW | **Ctrl+Shift+M** o **Ver → Herramientas** |
| **Zonas MIDI** | Repartir tu teclado entre varias pistas para tocar en directo | **Ver → Herramientas** |
| **Grooves** | Biblioteca de ritmos de batería listos para insertar | **Ver → Herramientas** |
| **Terminal** | Escribir comandos en español y ver lo que ejecuta la IA | **Ctrl+`** |
| **Configuración** | Ajustes del proyecto (audio, dispositivos, IA…) | Panel derecho / menú **Acciones** |
| **Asistente Jas** | El chat con la IA | Panel izquierdo |
| **Banda virtual** | Panel con la banda de agentes de IA trabajando y «Mi estilo» | Botón de panel en el chat de una producción en curso, o **Ver → Herramientas** (por verificar si siempre aparece en la lista aunque no haya producción) |

## Términos de la mezcla

- **Pista**: un carril para un instrumento, voz o grupo. Tiene su propio volumen, paneo y efectos.
- **Clip**: un trozo de audio o de MIDI colocado en una pista, que puedes mover, cortar o repetir.
- **Compás y tempo (BPM)**: el compás agrupa los tiempos (4/4 = cuatro tiempos por compás); el tempo son los **pulsos por minuto**. A más BPM, más rápido.
- **Fader**: la barra deslizante que sube o baja el volumen de una pista.
- **Paneo (pan)**: reparte el sonido entre el altavoz izquierdo y el derecho.
- **Mute / Solo**: Mute silencia una pista; Solo deja oír solo esa pista (para revisarla sin ruido de las demás).
- **Armar (Arm)**: dejar una pista lista para grabar en ella. Si no la armas, al grabar no entra nada.
- **Bypass**: apagar un efecto sin quitarlo de la cadena. Sirve para comparar «con» y «sin» efecto.
- **Preset**: un ajuste guardado de un instrumento o efecto («Piano cálido», «Reverb sala grande»).
- **dB (decibelio)**: unidad de volumen. 0 dB es el máximo digital; por encima el sonido se deforma (**clipping**). Una mezcla sana deja un margen por debajo de 0.
- **LUFS**: medida del volumen que de verdad percibe el oído en toda la canción; los servicios de música piden cierto nivel.
- **True-peak**: el pico más alto real de la señal, incluso entre muestras. Un **limitador true-peak** evita que se pase de un techo (p. ej. −1 dBTP).

### Bus, envío y retorno

- **Bus**: un canal «mezclador» al que varias pistas mandan su sonido para tratarlas juntas. Ejemplo: mandas las tres guitarras a un bus «Guitarras» y con un solo fader subes o bajas las tres, o les pones un mismo efecto.
- **Envío (send)**: una perilla en cada pista que decide **cuánto** de su sonido copia hacia un bus. El sonido original sigue en su pista y se manda una copia.
- **Retorno**: lo que sale del bus (por ejemplo, la reverb) y vuelve a la mezcla; se controla con el fader del bus.
- **Para qué sirve**: con un solo efecto caro (una reverb) en un bus y envíos distintos por pista, todos los instrumentos «comparten el mismo salón» sin cargar un efecto por pista.
- **Cómo hacerlo**: panel **Ruteo** (crear el bus), luego en el **Mixer** sube el **send** de cada pista hacia ese bus; en el bus carga la reverb o el delay (ver [05 · Mixer, FX y automatización](./05-mixer-fx-automatizacion.md)).

### Efectos más comunes

- **EQ (ecualizador)**: sube o baja zonas de frecuencia (graves, medios, agudos). Para quitar «turbiedad» de graves en una guitarra o dar brillo a una voz. Plugin de JasWave: **Param EQ**.
- **Compresor**: reduce la diferencia entre lo más fuerte y lo más suave, para que el volumen sea más parejo. Controles típicos: **umbral** (desde qué nivel actúa), **ratio** (cuánto reduce), **ataque** y **release** (qué tan rápido entra y sale) y **makeup** (para recuperar el volumen que se pierde). Plugin de JasWave: **Bus Compressor**.
- **Sidechain**: hacer que un compresor reaccione a **otra** señal. El caso clásico: que el bajo «baje» un instante cada vez que suena el bombo para que no se pisen. En JasWave los plugins que lo ofrecen traen su propio filtro de sidechain (por ejemplo Bus Compressor y el gate de Audio Doctor). Consulta [05 · Mixer, FX y automatización](./05-mixer-fx-automatizacion.md) para el estado del sidechain entre pistas.
- **Reverb**: simula el eco natural de un espacio (sala, iglesia, estadio). Más reverb = sonido más lejano.
- **Delay**: repite el sonido unos instantes después, como un eco.
- **Limitador**: un compresor extremo que impide pasar de un techo; se pone al final del Master.
- **Saturación / distorsión**: añade «calor» o agresividad al deformar suavemente la señal.

### MIDI y edición

- **Nota**: un sonido con altura, momento de inicio y duración. En el **Piano roll** es un rectángulo.
- **Velocity (velocidad)**: qué tan fuerte se tocó la nota (1–127). Más velocity suele sonar más fuerte y más brillante. Variar la velocity es lo que hace que una parte suene humana y no robótica.
- **Cuantizar**: alinear las notas a la rejilla del tiempo (negras, corcheas…). Corrige el ritmo pero, aplicado al 100 %, suena rígido; úsalo con moderación para conservar tu toque. En el Piano roll, tecla **Q** (ver [06 · Piano roll y MIDI](./06-piano-roll-y-midi.md)).
- **Humanizar**: lo contrario de cuantizar: pequeñas variaciones de tiempo y velocidad para que suene tocado por una persona.
- **Legato / sostenido**: notas que se alargan hasta la siguiente, sin huecos.
- **Loop (bucle)**: repetir una zona una y otra vez mientras trabajas.
- **Count-in (cuenta previa)**: los clics de metrónomo antes de empezar a grabar.

## Flujo básico: grabar una toma de teclado (MIDI)

Pasos generales; los nombres exactos de los botones se describen en [04 · Transporte y Arrange](./04-transporte-y-arrange.md) y [06 · Piano roll y MIDI](./06-piano-roll-y-midi.md).

1. Conecta tu teclado MIDI y asígnalo como **entrada** de la pista (Ajustes → **MIDI**), con el **monitor** de la pista encendido para oírte.
2. Crea una **pista MIDI** y carga un instrumento (panel **Instrumentos**) para oír lo que tocas.
3. **Arma** la pista para grabar.
4. Activa el **metrónomo** y la **cuenta previa** en la barra de transporte para tocar al tempo.
5. Pulsa **Grabar** y toca. Al terminar, pulsa **Stop**: aparece un **clip** con tus notas.
6. Escúchalo con **Play**; corrige en el **Piano roll** si hace falta.

Consejo: toca de forma natural. No cuantices al 100 % para que se conserve tu forma de tocar; ese toque es lo que luego analiza **Mi estilo** (ver [08 · Asistente Jas y prompts](./08-asistente-y-prompts.md)).

Siguiente: [01 · Primeros pasos](./01-primeros-pasos.md). Glosario completo: [GLOSARIO](../GLOSARIO.md).
