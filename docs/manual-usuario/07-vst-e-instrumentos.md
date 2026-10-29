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
