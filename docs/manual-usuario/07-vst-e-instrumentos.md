# 07 · VST e instrumentos

## Filosofía JasWave

No hay Soft Pad Web Audio: el sonido de instrumentos sale del **Plugin Host** (VST nativo o **JasWave Roles / Piano**).

## JasWave Roles y Piano

1. Rail **Instrumentos** → **Insertar JasWave Roles** (o Piano).
2. En el panel Roles elige el rol (piano, pad, bajo, etc.) / parámetros.
3. Ideal para demos, Music Build nativo (`rolesOnly` / soft pad only) y cuando no tienes librerías externas.

## Escanear e insertar VST

1. **Instrumentos** → añade carpetas de búsqueda (Common Files VST3, etc.).
2. Escanea el catálogo.
3. Inserta en la pista seleccionada (o pide al Asistente `plugin.insert`).

### Preferencias para la IA

En **Instrumentos**:

- **Catálogo VST**: buscar / filtrar; **IA / Off**; default de **plugin** por rol.
- **Configs**: guarda el estado completo del VST (p. ej. un instrumento DecentSampler = una config). Cada una tiene `presetId`; puedes marcarla default de rol para que la IA la use al producir.
- Flujo típico: inserta DecentSampler → carga el sonido en su UI → **Configs → Guardar de pista** → opcionalmente default Piano/Pad/etc.

Las carpetas de escaneo y la vista previa MIDI están colapsadas abajo para dejar espacio al catálogo.

### Preferencias de formato

| Formato | Recomendación |
|--------|----------------|
| **VST3** (`.vst3`) | Preferido |
| **VST2** (`.dll`) | **No soportado.** Busca la edición VST3 del plugin |

### Alias que entiende el Asistente

| Dices | Resuelve a |
|-------|------------|
| Descent / Decent | **DecentSampler** |
| Font / Font Piano | **Kontakt** (si está instalado) |
| BFD | **BFD Player** |

Ruta típica DecentSampler:  
`C:\Program Files\Common Files\VST3\DecentSampler.vst3`

## Capas: varios instrumentos en una pista

Puedes poner **más de un instrumento** en la misma pista (p. ej. piano + pad): inserta el segundo desde
Instrumentos o FX Chain como el primero. Todos reciben **el mismo MIDI** (clips, teclado MIDI y teclas de
prueba) y sus salidas **se suman antes de los efectos**, así que el EQ, la compresión o la reverb de la pista
procesan la capa entera. Cada capa conserva su bypass. Quitar un instrumento de la cadena lo descarga; los
demás siguen sonando.

## DecentSampler — tips

1. Inserta el VST en una pista MIDI.
2. Abre el **Editor de plugin**.
3. Carga un preset **`.dspreset`** — sin preset suele quedar en silencio.
4. Guarda el estado en **Biblioteca** cuando suene bien.

## Kontakt / BFD / librerías pesadas

1. Inserta → espera confirmación del host.
2. Carga el instrumento/kit **dentro** de la UI del plugin.
3. **Guarda proyecto** + preset en Biblioteca.
4. Si el CPU duele: **Freeze** la pista.

## Biblioteca de presets

Panel **Biblioteca**:

| Acción | Uso |
|--------|-----|
| **Guardar** | Snapshot del VST de la pista actual |
| **Probar** | Audition corto (~2 compases) |
| **Aplicar** | Carga el preset en la pista |
| **Proyecto / Global** | Scope |
| **Promover a global** | Reutilizar entre canciones |

La IA puede usar `presetId` / `library.preset.apply` — **mejor que** pelear parámetros a ciegas.

## Editor de plugin y crashes

- La UI nativa corre **fuera de proceso** (otra instancia editor).
- Si un VST crashea: cuarentena + el DAW sigue vivo.
- Ajustes → limpiar cuarentena cuando hayas actualizado el plugin.
- Tras restart del host, JasWave reintenta cargar slots; si algo queda mudo, reinserta o reabre el proyecto.
- **Varias ventanas de JasWave abiertas** (p. ej. la instalada y otra copia): solo una usa el motor de audio.
  Las demás muestran «Motor de audio en uso» y siguen editando sin sonido. Para pasar el audio a otra ventana
  sin cerrar ninguna, pulsa **Usar audio aquí** en su aviso: la que sonaba para la reproducción (si grababa,
  guarda la toma), suelta el dispositivo con sus plugins aún cargados y muestra el mismo botón para
  recuperarlo. Si cierras la que suena, la otra recupera el audio sola. Ya no se tumban los motores entre sí
  ni se apartan plugins por ello. (Una versión anterior de JasWave sin traspaso no suelta el motor: ciérrala.)
- **Teclado en pantalla:** en los instrumentos de JasWave (Grand Piano, Strings, Shimmer Pad, Bajo, Guitarra,
  Ambient Atmos, Piano, Roles y Sampler) el teclado del editor suena: clic = nota (más fuerte cuanto más abajo
  en la tecla), arrastrar = glissando, soltar = fin de la nota. Las teclas de prueba de la barra del panel
  tocan ese mismo VST.
- **Pads de Worship Drums:** cada pad del kit (KICK, SNARE, toms, HAT, RIDE, platos) suena al pulsarlo, más
  fuerte cuanto más cerca del centro del parche. Shift + clic: HAT abierto y campana del RIDE.
- **Kits de Worship Drums:** el selector **KIT** de la sección de controles lista los kits de muestras reales
  instalados (nombre y estilo en la cabecera del visualizador: worship moderno, jazz, rock/pop, indie con
  escobillas, rock/metal vintage…). Se leen de `%APPDATA%\JasWave\samples\drum-kits\<kit>\` (cada kit trae su
  `kit.json` con autor y licencia); el MuldjordKit de siempre aparece como «Muldjord». Cambiar de kit con la
  música sonando no corta ni hace clic: lo que ya suena termina con el kit anterior y los golpes nuevos usan el
  nuevo. Sin ningún kit instalado la batería sigue sonando con el motor modelado. El kit elegido se guarda en el
  proyecto por nombre (no se pierde si instalas o quitas otros kits). Las filas de casillas del visualizador
  muestran qué piezas tiene el kit (encendida = muestra real; las piezas del kit apagadas suenan con el modelo
  físico) y qué percusión auxiliar hay instalada.
- **Percusión y campanas:** además del kit, Worship Drums toca palmas (nota 39), pandereta (54), cencerro (56),
  vibraslap (58), bongós (60/61), congas (62-64), timbales (65/66), agogó (67/68), cabasa (69), shaker (70/82),
  güiro (73/74), claves (75), woodblock (76/77) y triángulo (80/81) con el banco `percusion`, con su propio
  nivel (**PERC**, «Percusion Level»), panorámica por pieza y envío a overheads y sala. La campana del ride
  (nota 53) y la campana del crash (78) suenan siempre: con la muestra real del kit si la trae y, si no, con el
  modelo físico de platos en modo campana.
- **Valor inicial:** doble clic o clic central en cualquier perilla o fader (de JasWave o de sus plugins)
  lo devuelve a su valor por defecto. «Restablecer» devuelve todo el plugin a los valores que reporta el
  propio VST, y se deshace con Ctrl+Z.

## Controles del plugin (lo mismo que puede hacer la IA)

En FX Chain, el botón de deslizadores de cada plugin (o «Controles» en el editor) abre tres pestañas:

- **Parámetros:** todos los parámetros del VST con búsqueda (nombre o función: cutoff, attack, mix…),
  deslizador, valor real y ↺ para volver al valor por defecto. «Restablecer todo» en un paso de deshacer.
- **Presets:** buscar, cargar en la pista, escuchar (pista de audición), guardar el sonido actual en el
  proyecto o global, y hacer global un preset del proyecto.
- **Herramientas:** guardar el estado del VST en el proyecto, probar su carga en el motor y guía de uso.

En la cabecera de FX Chain, el icono de actividad analiza qué FX degrada el audio (bypass A/B de cada
plugin; la cadena queda como estaba). Cada botón ejecuta la misma acción que la IA, con deshacer y auditoría.

## JasWave Grand Piano · editor NOTA A NOTA

El Grand Piano permite afinar y dar timbre a **cada una de las 88 teclas** (MIDI 21 = A0 … 108 = C8). En su editor, el botón **NOTA A NOTA ▶** (cabecera) abre la página con el teclado, una gráfica de barras de las 88 notas por propiedad y las herramientas de grupo.

| Propiedad | Rango | Neutro | Qué hace |
|-----------|-------|--------|----------|
| Volumen (`note_gain`) | ±12 dB | 0 | Nivel de la tecla |
| Afinación (`note_tune`) | ±50 cents | 0 | Afinación fina |
| Tono (`note_tone`) | −100…+100 % | 0 | Brillo: shelf de agudos de ±12 dB (muestras) / filtro de fieltro y tilt de parciales (modelado) |
| Cuerpo (`note_body`) | −100…+100 % | 0 | Realce/recorte de ±9 dB de la fundamental y los graves de esa nota |
| Decay (`note_decay`) | 25…400 % | 100 | Escala del tiempo de caída con la tecla pulsada |
| Release (`note_release`) | 25…400 % | 100 | Escala del tiempo al soltar |
| Martillo (`note_hammer`) | 0…200 % | 100 | Nivel del transitorio (0 = ataque suavizado) |
| Pan (`note_pan`) | −100…+100 % | 0 | Se suma al paneo por registro |
| Curva de velocidad (`note_vel_curve`) | −100…+100 % | 0 | + = más dinámico, − = más plano |

**En el editor:** clic en una tecla = elegir nota; arrastrar sobre el teclado = elegir un **rango**; clic o arrastre en la gráfica = pintar el valor de la propiedad activa (interpola entre las notas que se salten); doble clic = valor neutro; rueda = ajuste fino de la nota elegida. Herramientas (sobre el rango, o las 88 notas si no hay rango): **Suavizar**, **Inclinar −/+** (pendiente lineal alrededor del centro del rango), **Copiar a octavas** (el valor de la nota elegida a las mismas notas de otras octavas), **Neutro (propiedad)** y **Neutro (nota)**.

**Presets de timbre** (`note_preset`, pisan toda la tabla): *Concierto* (neutro: sirve de reset), *Cálido worship* (graves más llenos, agudos suavizados, release más largo, martillo 85 %), *Íntimo* (martillo 55 %, brillo bajo, dinámica comprimida), *Brillante pop* (agudos abiertos, martillo 135 %, caída algo más corta). Al editar una nota a mano el preset pasa a *Personalizado* (elegirlo no cambia nada). El botón RESET de la cabecera restaura la tabla.

**Para la IA / el host** (sin abrir la UI): fija `note_select` (número MIDI de la tecla) y después `note_gain`…`note_vel_curve`: leen y escriben solo la entrada de la nota elegida; al cambiar `note_select` esos parámetros muestran los valores de esa tecla. Si van en la misma tanda, las propiedades se aplican a la nota nueva. Los cambios afectan a las notas que se toquen después. La tabla se guarda en el estado del plugin (proyecto) y se restaura con él; los estados antiguos (sin tabla) cargan con la tabla neutra.

Limitaciones conocidas: la réplica web (`editores-vst`, plantilla compartida) no tiene la página NOTA A NOTA; el motor web (AudioWorklet) sí admite los parámetros `note_*` (`escribirNota` / `leerNota` para edición directa). Las teclas no se pueden “tocar” desde el editor (no hay audición por clic): usa tu teclado MIDI.

## JasWave Vocal Tune · afinación automática

Efecto VST3 (`JasWaveVocalTune.vst3`) para voces **monofónicas**: detecta el tono (YIN), lo lleva a la nota más cercana de la escala elegida y desplaza con PSOLA **conservando los formantes** (la voz no suena “ardilla”). Las consonantes, respiraciones y silencios pasan limpios. Ponlo el primero de la cadena de la voz.

| Control | Rango | Por defecto | Qué hace |
|---------|-------|-------------|----------|
| Retune Speed | 0…400 ms | 40 ms | Rapidez de la corrección. 0 = efecto robótico; 20–60 = natural; >100 = solo corrige notas largas |
| Humanize | 0…100 % | 20 % | Las notas sostenidas se corrigen más despacio (más naturales) |
| Vibrato Preserve | 0…100 % | 70 % | Cuánto vibrato original se respeta |
| Formant Shift | −12…+12 st | 0 | Mueve los formantes (timbre) sin cambiar la nota |
| Throat Length | 50…200 % | 100 % | “Tamaño de garganta”: <100 % más fino, >100 % más grave |
| Tracking | 0…100 % | 50 % | Sensibilidad de la detección (subir en voces suaves o con aire) |
| Scale / Root | 10 escalas · C…B | Chromatic · C | Escala y tónica destino (Cromática, Mayor, menores, pentatónicas, Blues, Dórica, Mixolidia) |
| Mix | 0…100 % | 100 % | Mezcla seco / afinado |
| Low Latency | On / Off | On | On = **2,5 ms** de latencia (para grabar y monitorizar); Off = 10 ms con detección más estable en voces graves |

La latencia se informa al host (compensación automática). La curva del editor muestra el tono detectado y el corregido sobre la rejilla de la escala (la tónica, en el acento) y el mini-panel la nota, el desvío en cents y la latencia. Consejo: en worship en vivo, *Retune* 25–50 ms, *Humanize* 20–40 % y la escala de la canción; para el efecto “T-Pain”, *Retune* 0 y *Humanize* 0.

## Pedal de sustain: teclados que lo mandan por varios canales y JasWave Pedal Fix

Algunos teclados arranger (p. ej. **Yamaha PSR-E373**) mandan cada pisada del pedal por **tres canales MIDI a la vez**:
en los canales 1 y 2 llega CC64 = 127 y en el 3 llega CC64 = 0 en el mismo instante. Un DAW en modo omni toma el
último valor y el pedal queda «suelto» aunque esté pisado. JasWave lo resuelve solo: los pedales conmutados
(CC 64 sustain, 66 sostenuto, 67 soft y 69 hold 2) se **unifican por canal** (vale el valor más alto entre todos los
canales y solo se reenvía cuando cambia) tanto en el DAW como en el host MIDI, y cada instrumento **retiene las notas**
hasta que sueltas el pedal, también si el VST no implementa el sustain por su cuenta. No hay nada que configurar.

Para usar el mismo arreglo en **otro DAW** (Reaper, Cubase, Studio One, FL Studio…) está **JasWave Pedal Fix**
(`JasWavePedalFix.vst3`), un efecto MIDI que se pone **antes del instrumento** en la cadena de la pista. El audio
pasa intacto (con medidores).

| Control | Valores | Por defecto | Qué hace |
|---------|---------|-------------|----------|
| FUENTE | CC64 / CC66 / CC67 / CC69 | CC64 Sustain | Qué pedal se unifica y controla la retención |
| UMBRAL | 1…127 | 64 | Desde qué valor el pedal cuenta como pisado |
| POLARIDAD | Normal / Invertida | Normal | Para pedales que mandan 127 en reposo |
| CANAL | Original / 1…16 | Original | Canal de salida fijo (los note-off salen por el mismo canal y tono que su note-on) |
| TRANSPONER | −24…+24 st | 0 | Transposición de las notas |
| VELOCIDAD | 0…200 % | 100 % | Escala de la velocidad |
| FORZAR | On / Off | Off | Sustain siempre pisado (al quitarlo se liberan las notas retenidas) |
| UNIFICAR | On / Off | On | Unifica el pedal de todos los canales; apagado, cada canal va por su cuenta (se filtran duplicados) |
| REDISPARO | On / Off | On | Al repetir una nota retenida, manda su note-off antes del nuevo note-on |

El panel muestra el pedal efectivo (PISADO / SUELTO y su valor), los 16 canales (anillo = pedal recibido por ese
canal, barra = notas), la traza de los últimos segundos, las notas que llegan al instrumento sobre un teclado de 88
teclas y las estadísticas (eventos recibidos y enviados, pedales duplicados filtrados, último pedal recibido). En
modo **Básico** quedan Fuente, Polaridad, Canal, Forzar, Unificar y Bypass.

## Zonas MIDI y modo Directo

Para tocar en vivo con un solo teclado (p. ej. el PSR-E373) repartiendo el teclado entre varias pistas, apilando
capas o transponiendo sin latencia añadida. Las zonas las aplica el **host nativo en el hilo de audio**: el MIDI
no pasa por la interfaz, así que un split suena con la misma latencia que una pista sola (0 ms añadidos).

**Abrir el panel:** menú **Ver → Herramientas → Zonas MIDI** (se coloca en el panel inferior), o su icono (teclado) si aparece en la barra lateral. Arriba se
dibuja un teclado de 88 teclas con una banda de color por zona; **arrastra los bordes** de la banda para mover sus
límites, o escribe las notas (0–127, C4 = 60) en la lista.

- **Split**: dos zonas con rangos distintos en pistas distintas (bajo A0–B3 a la izquierda, piano C4–C8 a la
  derecha). «Añadir zona» en una pista que ya tiene una crea la segunda a partir de C4.
- **Capa**: dos zonas con el mismo rango en pistas distintas (piano + cuerdas). Todas las pistas con monitor
  encendido y la misma entrada MIDI reciben el teclado a la vez; sin zonas, cada una recibe el teclado completo.
- **Transposición** en semitonos (±60), **curva de velocidad** (lineal, suave, dura o fija con un valor), **escala**
  de velocidad en % y **canales**: filtrar por canal de entrada (p. ej. 1 = mano derecha de un teclado con splits
  propios) y forzar un canal de salida hacia el instrumento.
- **ON/OFF** desactiva una zona sin borrarla. Todo tiene **deshacer** y se guarda con el proyecto (`project.directo`).
- Las zonas también valen para el **thru** del motor web (JasWave Roles / Piano): mismo rango, transposición y curva.

**PANIC** (botón rojo del transporte): apaga todas las notas de todos los instrumentos y descarta el MIDI pendiente.
Úsalo si una nota se queda colgada al cambiar de zona o de pista.

**Directo** (candado del transporte): bloquea borrar, deshacer, rehacer, cortar, pegar y duplicar mientras tocas;
muestra «Modo Directo: edición bloqueada» y avisa del atajo que detuvo. El transporte, la grabación y los campos de
texto (chat, nombres) siguen funcionando. Clic de nuevo para salir; no entra en el historial de deshacer.

**Seguridad del máster** (en el panel «Zonas MIDI»): limitador **true-peak** del máster para monitorizar en directo
(techo −0,5 dBTP por defecto, 4× sobremuestreo, lookahead de ~1,4 ms). Solo actúa en lo que sale por los altavoces
mientras tocas: **no entra en un bounce ni en la exportación**. Con la seguridad activa el candado muestra «TP».

**Para la IA**: `midi.zones.get`, `midi.zones.set` («divide el teclado: bajo hasta B3 una octava abajo, piano desde
C4»), `midi.zones.add/update/remove`, `directo.panic`, `directo.setSafety` y `directo.setLock`.

## Worship Drums: elegir el kit (para principiantes)

Un **kit** es el «juego de batería» que suena: cada kit se grabó con una batería real distinta. En **Worship Drums**
el selector **Drum Kit** (en la sección de controles del editor) elige cuál suena; al lado, **Percussion Level**
sube o baja la percusión auxiliar (palmas, pandereta, shaker, congas…). Según el manifiesto del plugin los kits de
serie son:

| Kit | Estilo |
|-----|--------|
| 1 · muldjord | worship / rock moderno (el de siempre y el predeterminado) |
| 2 · bigrusty | rock y metal vintage |
| 3 · drskit | jazz-rock |
| 4 · naked | rock y pop limpio |
| 5 · swirly | indie, con escobillas |
| 6 · virtuosity | jazz de club |

El selector admite hasta 16 posiciones; las etiquetas muestran el kit realmente instalado (si la lista del editor
dice solo «Kit 7…16», es que esa posición está libre; por verificar en la aplicación). Cambiar de kit con la música
sonando no corta nada. Otros mandos básicos: **Kick Tuning** (afinación del bombo), **Snare Snap** (pegada de la
caja), **Toms Damping** (amortiguación de toms), **Room Blend** (cuánto micrófono de sala se mezcla) y **Room
Compression**.

## Más plugins de JasWave (efectos)

Todos se cargan igual: selecciona la pista, abre **FX Chain** (o **Instrumentos**) y añade el plugin; se edita en
**Editor de plugin**. El conmutador **[ BÁSICO | AVANZADO ]** de la cabecera muestra solo lo esencial o todo (ver más
abajo «Editores: modo Básico / Avanzado»). Los rangos que se citan salen del manifiesto de cada plugin.

### JasWave StompLab · pedalera universal

**Qué es:** una pedalera como las de guitarra, pero válida también para bajo, teclados y voz. Cada «pedal» se activa
o apaga por separado y la señal pasa por ellos en este orden: **Gate → Comp → Drive → Preamp → Cabina → Chorus →
Delay → Shimmer** (el orden exacto interno: por verificar). Sirve para dar carácter (limpio, crunch, distorsión,
ambiental) a un instrumento.

| Bloque | Qué hace | Controles principales |
|--------|----------|-----------------------|
| **Gate** | Silencia el ruido cuando no tocas | Umbral (−80…−20 dB), Release, Rango |
| **Comp** | Compresor: iguala el volumen | Umbral, Ratio (1…20:1), Ataque, Release, Makeup, Blend (mezcla paralela), Rodilla |
| **Drive** | Distorsión de 5 modelos: Clean Boost, Overdrive, Distortion, Fuzz, Metal | Modelo, Cantidad, Tono (corte de agudos), Nivel |
| **Preamp** | Amplificador de válvulas con 3 canales: Clean, Crunch, Lead | Ganancia, Graves, Medios, Agudos, Presencia, Master, Sag (compresión de la fuente), Bright |
| **Cabina** | Simula la caja de altavoces (respuesta de impulso): 1x12 Open, 2x12 Combo, 4x12 Closed, Vintage Bright, British 2x12, DI (señal plana) | Modelo, Corte de graves, Corte de agudos, Mezcla |
| **Chorus** | Engrosa el sonido con una copia que «tiembla» | Velocidad, Profundidad, Mezcla |
| **Delay** | Eco; modos Stereo, Ping-Pong (rebota izq./der.) y Tape (cinta) | Tiempo (20…2000 ms), Realimentación, Tono, Mezcla |
| **Shimmer** | Reverb con una octava arriba (sonido «celestial») | Mezcla, Cola (duración), Octava, Amortiguación de agudos |

Además: **Input Gain / Output Gain** (±24 dB), **Mix** global (seco/procesado) y **Bypass**. Hay medidores de
reducción del Gate y del Comp. En la ventana, la zona **PEDALERA** tiene los mandos principales (Drive, Preamp Gain,
Delay Mix y los interruptores On de cada bloque) y **PARÁMETROS AVANZADOS** el resto.

**Receta rápida (guitarra crunch):** Drive On con modelo Overdrive y Cantidad media → Preamp On en canal Crunch →
Cabina On con 2x12 Combo → un poco de Delay Mix. Si suena opaco, sube el Tono del Drive o el Corte de agudos de la cabina.

### JasWave Ambience · rack worship de espacio

**Qué es:** un efecto de «ambiente» pensado para música de adoración: reverb grande, delay sincronizado al tempo,
shimmer y un *swell*, todo en un solo plugin con **21 presets**. Se coloca en una pista (o mejor en un **bus** al que
mandas varias pistas por envío; ver [14 · Conceptos para principiantes](./14-conceptos-para-principiantes.md)).

| Mando | Qué hace |
|-------|----------|
| **REVERB** | Cantidad de reverb (mezcla, 0…100 %) |
| **DECAY** | Cuánto dura la cola de la reverb (0,4…12 s) |
| **DELAY** | Cantidad de delay (mezcla) |
| **SINCRO** | Valor rítmico del delay respecto al tempo del DAW (Libre, 1/2, 1/4, 1/4., 1/8., 1/8, 1/8T, 1/16) |
| **SHIMMER** | Cantidad de shimmer (reverb con octava; el intervalo por defecto, una octava arriba, es por verificar) |
| **SWELL** | Profundidad del *swell*: envolvente dinámica automática que suaviza los ataques, útil en guitarras |
| **FREEZE** | Congela la reverb: el sonido se sostiene «infinito» |
| **ANCHO** | Anchura estéreo |
| **VOLUMEN** | Nivel de salida (fader), con medidores de entrada y salida |
| **Preset** | Room, Worship Hall, Hillsong Swell, G12 Pad, Grace Galactic, Averly Ambient, Ambient Pad, Barrack Lead, Delay + Verb, Large Hall, Slap Delay, Real Lead, Vintage Clean, Hillsong Modern, Hillsong Ambient, Hillsong Dual A, Hillsong Dual B, Piano · Sala cálida, Pad · Infinito (freeze), Plate brillante, Guitarra · Delay punteado |

El plugin incluye además chorus, saturación, compresión, trémolo, EQ y graves en mono que no tienen mando en la
ventana principal (por verificar cuáles se pueden tocar desde el editor). Un buen primer paso: elige un preset y
ajusta solo REVERB y DECAY hasta que el instrumento «respire» sin tapar a los demás.

### JasWave Audio Doctor · restauración de audio

**Qué es:** un «médico» para grabaciones con problemas. Se usa en pistas de **audio** (voz, guitarra grabada, etc.).
Cada herramienta se activa por separado.

| Herramienta | Para qué sirve | Controles principales |
|-------------|----------------|-----------------------|
| **Gate / Expander** | Baja el volumen cuando no hay señal útil (respiraciones, ruido entre frases). Su detección usa un filtro de **sidechain** (escucha una versión filtrada de la señal) | Umbral, Ratio, Ataque, Release, Hold, Histéresis |
| **De-Noise** | Quita el ruido de fondo constante (soplido, ventilador); puede **aprender** el ruido | Reducción (0…24 dB), Aprender ruido, Modo (Auto, Learned, Continuous), Suavizado |
| **De-Hum** | Quita el zumbido eléctrico de 50 o 60 Hz y sus armónicos | Frecuencia (Auto/50/60 Hz), Armónicos, Q, Profundidad |
| **De-Click** | Quita chasquidos y clics | Sensibilidad, Ancho máximo |
| **De-Clip** | Repara recortes (cuando la grabación «saturó» por ir demasiado fuerte) | Umbral, Fuerza |
| **De-Reverb** | Reduce el eco de la sala en que se grabó | Cantidad, Cola |
| **Aislador de voz** | Resalta la banda de frecuencias de la voz | Frecuencia grave y aguda, Profundidad |
| **Escudo de transitorios** | Protege los golpes (ataques) del procesado | Cantidad |
| **Recuperación de aire** | Devuelve brillo en agudos | Frecuencia, Ganancia (0…6 dB) |

Controles de ayuda:

- **Auto-Fix:** analiza unos 3 segundos de audio y aplica los ajustes recomendados; luego se apaga solo.
- **Learn Noise:** actívalo mientras suena **solo el ruido** (sin voz) para que De-Noise lo aprenda.
- **Delta:** te hace oír **solo lo que se está quitando**. Si oyes voz o música en el Delta, estás quitando demasiado.
- **Live Mic:** modo de latencia mínima (menos de 2 ms) con algo menos de calidad; para monitorizar en vivo.
- **Medidores de diagnóstico:** ruido de fondo, hum detectado, clics por segundo, % de recorte, reverberancia y reducción aplicada.

**Receta:** pon Audio Doctor primero en la cadena de la voz → activa **Auto-Fix** con la voz sonando → escucha con
**Delta** para comprobar que no quita voz → ajusta la **Reducción** de De-Noise al mínimo que limpie.

### Otros efectos de JasWave (resumen)

| Plugin | Para qué sirve |
|--------|----------------|
| **Param EQ** | Ecualizador paramétrico dinámico de hasta 24 bandas (tipo, frecuencia, ganancia, Q) |
| **Bus Compressor** | Compresor de bus: Umbral, Ratio, Ataque, Release, Rodilla, Makeup, Mezcla paralela, filtro de sidechain, detector Peak/RMS |
| **TruePeak Limiter** | Limitador final con lookahead y dither para no pasar un techo true-peak |
| **Smart De-esser** | Suaviza las «eses» ásperas de una voz (banda dividida o completa) |
| **Utility Tool** | Ganancia, fase, canales L/R, ancho M/S, mono en graves |
| **Vocal Tune** | Afinador automático de voz (sección propia, más arriba) |
| **Vocal Choir** | Coro de hasta 4 voces controlado por MIDI |
| **Pedal Fix** | Unifica los mensajes de pedal sustain/sostenuto/soft (sección propia) |
| **Audio Lens** | Análisis descriptivo del audio y conversión de ritmos hechos con la boca (beatbox) a batería MIDI |

Instrumentos propios: **Worship Drums** (batería), **Grand Piano** (piano de cola), **Piano Synth**, **Electric Bass**,
**Electric Guitar**, **Shimmer Pad**, **Ambient Atmos** (atmósferas), **Strings Section** (cuerdas) y **Roles**
(instrumento por rol: batería, bajo, guitarra, piano, pad, cuerdas…). El **Sampler** no tiene manifiesto: por verificar
su descripción.

## Editores: modo Básico / Avanzado

Todos los editores de los VST de JasWave tienen en la cabecera el selector **[ BÁSICO | AVANZADO ]**:

- **Básico**: solo los controles esenciales de cada plugin (p. ej. Vocal Tune: Retune, Humanize, escala, tónica, mezcla y bypass; compresor: umbral, ratio, ataque, release, makeup y mezcla), recolocados para no dejar huecos. Las páginas extra (MIX / FX, PARÁMETROS) se ocultan.
- **Avanzado**: el 100 % de los parámetros. Lo que el editor no dibuja con un control propio aparece en la página **«+N PARÁM.»** (botón en la barra de la sección de controles); **◀ EDITOR** vuelve.

El modo se recuerda por instancia (se guarda con el proyecto en escritorio; en la web, en el navegador). Cambiar de modo no cambia ningún valor: un parámetro oculto en Básico sigue sonando como esté.

## Checklist “¿por qué no suena el VST?”

1. Caption: ¿`host listo` o `MISSING` / error?
2. ¿Bypass activado?
3. ¿Preset cargado (DecentSampler)?
4. ¿MIDI llega a esa pista (entrada / clip)?
5. ¿Fader / mute / solo?
6. ¿Device ASIO correcto y no en otra app?

Siguiente: [08 · Asistente Jas y prompts](./08-asistente-y-prompts.md).
