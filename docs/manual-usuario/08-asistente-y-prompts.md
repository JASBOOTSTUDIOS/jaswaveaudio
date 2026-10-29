# 08 · Asistente Jas y prompts

El **Asistente Jas** es el copiloto del DAW: lee el proyecto, propone cambios y (según el modo) los aplica con undo.

## Modos

| Modo UI | Cuándo usarlo |
|---------|----------------|
| **Auto** | Dejas que elija por tu texto |
| **Consulta** | Preguntas; **no muta** el proyecto |
| **Plan** | Escribe `plan.md` / preview; tú pulsas **Construir** |
| **Pensar** | Arreglo profundo + preview Music Build (`aplicar: false`) |
| **Crear** | Hace los cambios en tu proyecto (con deshacer por respuesta) |

### Flujo seguro (recomendado al empezar)

1. **Plan** o **Pensar** → revisa diff / tarjeta Music Build.
2. **Construir** (acepta/rechaza acciones si aparecen cards).
3. Escucha → ajusta a mano → pide refinements en **Crear** o **Consulta**.

### Flujo rápido

**Crear** + un prompt claro de Music Build (abajo).

## Cómo piensa Jas (rápido y fiable también con modelos pequeños)

- **Sin «consejo» por defecto.** Antes Jas debatía entre 2 y 10 voces y repasaba lo aplicado (podía tardar minutos).
  Ahora hace un **plan breve** (una llamada, dos si necesita consultar datos o la web) y pasa a actuar.
  El modo de razonamiento profundo sigue disponible para quien lo active (`perfil: 'profundo'`).
- **Habilidades.** Los pedidos frecuentes los resuelve una *habilidad*: el modelo toma solo las decisiones creativas
  en **una** respuesta (forma, progresiones, intensidad, instrumentación…) y el DAW las ejecuta con herramientas
  deterministas. Si el modelo no responde o devuelve algo inválido, la habilidad descarta lo que no sirve y completa con
  criterio propio; nunca inventa pistas ni ids.
- **Selección del piano roll.** La selección anclada solo se usa si el pedido la menciona («estas notas», «esto»,
  «[selección: …]») o si es reciente; un pedido global como «completa la canción» no se sesga por unas notas que
  seleccionaste hace rato.

### Habilidad «Producir o completar canción»

Se activa con pedidos como «completa la canción», «termina el tema con bajo y batería» o «haz una canción worship completa».

- Si ya hay contenido (p. ej. una intro que tocaste), **continúa desde el compás siguiente** con el mismo tempo, compás y
  tonalidad. Si no fijaste la tonalidad, la deduce de tus notas.
- Jas elige una **forma** propia (verso, pre-coro, coro, puente, coro final, outro) y una **progresión distinta por sección**,
  con color jazz-pop diatónico: maj9, m9, 9, m11, 11, maj7#11, 13sus4, add9, sus2/sus4 e inversiones para que el bajo camine.
  También define un **arco de intensidad** con respiro y clímax.
- La banda (piano, pad, cuerdas, bajo, batería, guitarra, melodía) toca con humanización, cada pista con su propio VST3 de JasWave,
  y la mezcla se ajusta midiendo LUFS por pista y en el master.
- En el razonamiento del mensaje verás las decisiones (idea, forma, progresiones e intensidades). Nada se aplica hasta que
  pulses **Aplicar** o **Todas** (en modos que piden confirmación).

## Cómo trabaja el agente

Jas trabaja como los agentes de programación: entiende el pedido, se hace una lista de tareas, consulta el proyecto,
ejecuta los cambios y comprueba el resultado antes de responder.

- **Progreso visible.** Mientras trabaja, el mensaje muestra una tarjeta plegable con sus tareas, los pasos que da
  («Cambiando el tempo», «Escribiendo las notas del piano»…) y, si reparte el trabajo, los **ayudantes en paralelo**
  (por ejemplo, batería y bajo a la vez). Nunca verás nombres internos, ids ni código.
- **Cambios directos y reversibles.** En **Crear**, los cambios se aplican al momento y **Deshacer los cambios de esta
  respuesta** los revierte de una vez. Lo que borra o reemplaza contenido siempre pide confirmación.
  Si en Ajustes del proyecto elegiste que la IA solo **sugiera**, verás la tarjeta **Aplicar** en lugar de cambios directos.
- **Pregunta cuando falta algo.** Si el pedido es ambiguo, te muestra preguntas con opciones antes de actuar.

## Comandos del chat

Escribe **/** en el chat para ver la lista con su explicación.

| Comando | Qué hace |
|---------|----------|
| **/plan** _qué_ | Prepara un plan paso a paso sin tocar el proyecto y lo guarda en el documento del plan |
| **/entrevista** _tema_ (o /grill-me) | Te hace preguntas, una a una y con opciones, hasta tener claras las decisiones; durante la entrevista no cambia nada |
| **/meta** _objetivo_ (o /goal) | Trabaja varios pasos seguidos hasta cumplir el objetivo y sigue con él en los próximos mensajes. «/meta parar» la detiene |
| **/aprender** _preferencia_ (o /learn) | Recuerda una preferencia en este proyecto. «/aprender deshacer» olvida la última |
| **/programar** _cuándo y qué_ (o /schedule) | Hace una tarea más tarde o cada cierto tiempo: «en 10 minutos…», «cada 30 minutos…», «a las 18:30…». «/programar lista» y «/programar cancelar 1» |
| **/banda** _idea_ | Produce un tema completo con la banda virtual |
| **/configurar** _qué_ (o /config, /personalizar) | Te ayuda a crear, editar o eliminar tus habilidades, prompts, planes y reglas con preguntas y recomendaciones. «/configurar salir» vuelve a la música |

También aprende solo cuando se lo pides en el mensaje («a partir de ahora…», «recuerda que prefiero…»).

### Producir con la banda (/banda)

**/banda** _idea_ reparte el tema entre un equipo de agentes, como en un estudio:

1. **Plan**: forma, tempo, tonalidad e instrumentación.
2. **Dirección**: el director asigna a cada músico su pista y su parte.
3. **Músicos**: tocan sus partes por oleadas (primero la base rítmica, luego los demás, que escuchan lo ya grabado),
   cada uno en su pista y siguiendo la misma hoja de ruta (tonalidad, secciones y un acorde por compás). Cada músico
   conoce además el **reparto** de la banda (qué hace cada compañero) para dejarle sitio y completarlo. Tocan **como
   personas, no como una máquina**: el cifrado es el punto de partida y usan toda la escala (notas de paso, bordaduras,
   apoyaturas, anticipaciones) y extensiones (add9, sus, 6, maj7, m7), varían duraciones y velocidades, arpegian,
   adornan y desplazan ligeramente el tiempo (la batería se humaniza con velocidades y ghost notes). Una parte con
   todas las notas iguales la detecta el DAW como «robótica» y vuelve a su músico.
   Cada agente tiene además sus **habilidades** (ver «Habilidades de cada agente», más abajo).
4. **Ensayo**: como en una banda de verdad, cuando todos han grabado se escuchan entre sí. Cada músico dice si está
   conforme con cómo encaja su parte con las demás y propone ajustes concretos (a su parte o a la de un compañero:
   registro, densidad, dejar espacio, doblar o contestar un motivo). El **director arbitra** —acepta lo que mejora el
   conjunto y descarta lo contradictorio— y solo los afectados vuelven a tocar lo acordado. El panel muestra quién
   propone qué y qué se acordó. Con un solo músico no hay ensayo.
5. **Arreglista**: el DAW mide que todo encaje —cada clip en su sección, nada después del final, notas cerca de la
   rejilla (con margen humano: el micro-tiempo no se cuantiza), acordes y tonalidad respetados (las extensiones
   cuentan como del acorde), el bajo en la fundamental y apoyado en el bombo, y ninguna parte «robótica»— y el
   arreglista corrige los compases señalados hasta que la medición aprueba, sin aplanar lo que los músicos tocaron.
6. **Revisión**: un control de calidad escucha el arreglo y devuelve las correcciones al músico que corresponde
   (hasta dos rondas). Después vienen la **mezcla** y el **máster**, cada uno con su propia revisión, que además mide
   el volumen (LUFS) y los picos **con el motor real** (instrumentos, efectos y máster incluidos).

Cada agente es además un **filtro**: si la mezcla o el máster oyen algo que no es de su oficio (una parte mal tocada,
notas que chocan con la armonía, una pista vacía), no lo tapan con el fader ni con el limitador: lo **devuelven** al
músico, al arreglista o a la mezcla, se corrige, se vuelve a comprobar que todo encaje y el agente retoma su etapa.

Mientras la banda trabaja puedes **escucharla** (cada parte que se graba y, en la mezcla, la canción en bucle) y **ver**
lo que toca (los controles que cambia se iluminan). Los dos botones están en el transporte, junto al metrónomo, y se
recuerdan: apaga «Escuchar» para trabajar en silencio y solo mirar. Con «Escuchar» apagado la banda **sigue sonando por
dentro**: el medidor estéreo del transporte muestra la señal del master, pero la salida a los altavoces queda en
silencio (el altavoz del transporte aparece tachado con la marca «IA»). Así ves que hay señal y que no está saliendo.
Ese mismo control —medidor, altavoz y volumen— es la **monitorización**: ajusta lo que oyes sin tocar el master ni lo
que se exporta (ver «Barra de transporte»).

Antes de dar algo por bueno, la banda **revisa que cada pista suene**: que tenga su instrumento cargado (y que el VST
no haya fallado ni esté en bypass), que no esté silenciada ni tapada por un solo, y que su volumen no sea demasiado
bajo frente a las demás. Si algo falla, el músico carga el instrumento o la mezcla corrige el volumen, y se vuelve a
revisar.

El panel de la banda muestra en vivo la etapa, quién trabaja, qué hace y cuántas correcciones hubo. Puedes
**plegarlo** a una sola línea con la flecha de su cabecera, o **llevarlo a un panel aparte** («Banda virtual», en la
zona derecha) para que no ocupe espacio en el chat; desde ese panel, «Mostrar la banda en el chat» lo devuelve. La
elección se recuerda. Ese panel también puede ir a **otra ventana** (botón «Abrir en otra ventana / monitor»): la
producción sigue en la ventana principal y la ventana aparte la refleja en vivo, incluido «Detener». Al terminar,
**Deshacer los cambios de esta respuesta** revierte toda la producción de una vez. Los músicos son tus
**Especialistas**: se respeta lo que cada uno puede cambiar.

**Escríbele a la banda mientras trabaja.** Tú ves y oyes el DAW y los agentes no: si notas algo (el bombo va tarde,
el bajo tapa la voz, la intro sobra), escríbelo con normalidad en el chat o en la caja de texto del panel de la banda.
El agente en turno lo recibe entre dos pasos y lo tiene en cuenta desde ese momento (manda sobre el plan); los que
empiezan después lo ven en su contexto. Para decírselo a **uno en particular**, elígelo en el selector de la caja
(«Toda la banda» o un nombre), pulsa su nombre en la consola de la banda, o escribe en el chat «@Bajista más suave»
o «Bajista: más suave». En la consola aparece tu línea («Tú: …» o «Tú: Para Bajista: …») y, cuando el agente la
recibe, «Tiene en cuenta tu indicación». Funciona igual desde la ventana flotante. Lo que escribas en el chat
mientras la banda trabaja va siempre a la banda; los comandos («/aprender», «/programar») siguen funcionando.

Una producción completa hace muchas consultas al modelo (entre 40 y 120): en el plan Básico puede gastar buena parte
de los créditos del día.

Los músicos trabajan **a la vez** sin pisarse: el director asigna a cada uno su pista en el encargo, y la banda rechaza
cualquier escritura de un músico en una pista que no sea la suya (puede crear otra si la necesita; leer las de los
demás siempre está permitido). Las escrituras de todos pasan por un turno común, así que dos agentes nunca cambian el
proyecto al mismo tiempo.

### Habilidades de cada agente

Cada agente de la banda tiene **habilidades**: conocimiento de oficio escrito paso a paso, como las fichas que un
músico de sesión repasa antes de tocar. El agente ve solo la lista (nombre y cuándo usarla) y **lee** la que necesita
justo antes de la tarea, así no se le mezclan cien instrucciones de golpe.

- **De serie**: vienen con cada rol y, en los músicos, con su instrumento. Por ejemplo, el baterista tiene «Groove de
  batería», «Fills y transiciones» y «Dinámica por sección»; el bajista «Línea de bajo apoyada en el bombo»; el
  pianista «Voicings de piano» y «Patrones rítmicos y arpegios»; todos los músicos «Tocar con vida (nada robótico)»,
  «Grabar la parte por secciones», «Comprobar que la pista suena» y «Corregir una devolución»; la mezcla, el máster, el
  arreglista, el QA, el director y el planificador tienen las suyas (gain staging, EQ, compresión, reverb por envíos,
  máster a −14 LUFS, revisión de partes…). Se ven en **Ajustes → IA → Banda de especialistas → Editar → Habilidades**,
  y se pueden desplegar para leerlas.
- **Tuyas**: un archivo Markdown en la carpeta `habilidades/` de tu configuración, asignado a un agente con
  **@su-nombre** (o su id) en la línea de descripción, o con una línea `<!-- agente: baterista, bajista -->`. Vale
  también el rol (`musicos`, `mezcla`, `master`, `qa`, `arreglista`) o `todos`. El botón **Nueva habilidad para este
  agente** crea el archivo con la plantilla y abre la carpeta; escribe el método y guarda: el agente la tendrá en su
  siguiente intervención. Si tu habilidad se llama igual que una de serie, la tuya manda. Una habilidad con
  `<!-- desactivada -->` no se usa.

El agente principal (Jas) sigue usando tus habilidades generales como hasta ahora; las de los agentes de la banda se
reparten con las menciones de arriba.

### Notas de voz y audio en el chat

Graba una nota de voz o suelta un archivo de audio en el chat. Desde su menú puedes pedir la tonalidad y los acordes,
convertirla en melodía o batería, o **Insertar como clip de audio**: el audio se guarda dentro de la carpeta del proyecto
(`media/grabaciones/`) en una pista «Nota de voz», así suena, se exporta y sigue ahí al reabrir. Si el proyecto aún no
está guardado, el audio se guarda en la carpeta de JasWave: guarda el proyecto antes si quieres que vaya dentro de él.

### La IA puede consultar internet y referencias

Jas puede salir a internet para apoyarse en fuentes verificables y en referencias musicales reales:

- **Buscar y leer** (`web.buscar`, `web.leer`): busca en DuckDuckGo (con Wikipedia de respaldo) y lee el texto legible de
  una página (título, autor, fecha y párrafos; hasta 20 000 caracteres). Pídelo con naturalidad: «busca a qué tempo va la
  bachata y cítame la fuente».
- **YouTube** (`youtube.buscar`, `youtube.ficha`): encuentra vídeos (título, canal, duración) y lee la ficha de uno
  (descripción, capítulos y transcripción si la hay).
- **Escuchar en JasWave** (`referencia.escuchar`): el vídeo se abre en una ventana propia de la app (sin salir al navegador).
- **Analizar referencia** (`referencia.analizar`): descarga el audio del vídeo (hasta 90 s del tramo más denso) y lo mide con
  los analizadores del DAW: tempo, tonalidad, acordes, LUFS, true peak y espectro, con números. Para ello JasWave descarga
  **yt-dlp** bajo demanda desde su publicación oficial (verificado con la huella SHA-256 publicada) a
  `%LOCALAPPDATA%\JasWave\tools\yt-dlp` y usa el ffmpeg de Exportar. El WAV temporal se borra al cerrar la app; es para uso
  personal de referencia.

Cuando la respuesta usa internet, termina con una lista **Fuentes:** y los enlaces aparecen como tarjetas en el chat: los
de YouTube con miniatura y los botones **Escuchar en JasWave** y **Analizar referencia**. Todo lo que llega de internet se
trata como dato (nunca como una orden para la IA), la red sale solo del proceso principal de la app con direcciones
validadas (nada de redes locales) y con un máximo de 30 peticiones por minuto. La preferencia **Permitir a la IA usar
internet** (activada por defecto) se guarda en `jaswave-settings.json` (`permitirInternetIA`); al desactivarla, estas
herramientas responden que el acceso está desactivado.

## Personalizar el asistente

En **Ajustes → IA → Personaliza tu asistente**:

- **Reglas para todos tus proyectos**: cómo quieres que trabaje (p. ej. «pregúntame antes de cambiar el tempo»).
- **Instrucciones de este proyecto**: lo que debe saber de esta canción (tonalidad, estilo, voces…). Se guardan con el
  proyecto (documento `AGENTS.md` del panel Docs).
- **Habilidades**: pasos con nombre que quieres que siga en ciertos pedidos («Batería de adoración»: cuándo usarla y qué
  hacer). Jas las consulta cuando el pedido encaja. Un documento del proyecto llamado `habilidad-<nombre>.md`
  (título, una línea `> cuándo usarla` y los pasos) también cuenta como habilidad.
- **Prompts**: instrucciones que reutilizas («usa mi prompt Intro épica»).
- **Planes**: planes de trabajo que repites en tus proyectos («sigue mi plan Mezcla de adoración»).

### Tu carpeta de configuración

Las reglas, habilidades, prompts y planes se guardan como archivos de texto en tu carpeta de configuración
(`%APPDATA%\JasWave\asistente\`: `reglas.md` y las carpetas `habilidades`, `prompts` y `planes`). **Abrir carpeta** la
abre para que los edites con cualquier editor; el botón de recargar lee tus cambios. Cada archivo empieza con
`# Nombre`, una línea `> cuándo usarlo` y después el contenido.

Si prefieres hacerlo con ayuda, escribe **/configurar** (puedes añadir qué quieres: «/configurar una habilidad para
baterías lentas»). Jas revisa lo que ya tienes, te pregunta paso a paso con opciones y te marca la que recomienda,
te enseña un borrador y lo guarda cuando le dices. También edita o elimina lo que le pidas («borra mi prompt de
intro»); lo eliminado se puede recuperar pidiéndoselo. Mientras configuras no toca tu proyecto. También puedes
pedírselo en un mensaje normal («créame un prompt para intros») sin entrar en el modo.

En **Especialistas** configuras los ayudantes a los que Jas reparte trabajo: sus instrucciones, especialidades y
**qué puede cambiar cada uno** (notas, pistas, mezcla, tempo, plan o exportar). Sin marcar nada, puede usarlo todo.

## Mentions `@`

En el chat puedes `@` pista, plugin o mensaje previo para anclar contexto.

## Docs y plan.md

- Panel **Docs**: edita `plan.md` (Intención, Por implementar, Evaluación…).
- El Asistente actualiza secciones; tú también puedes editar a mano.
- Tras bounce, la evaluación puede incluir el informe de escucha (LUFS / listen).

## Music Build

Orquestador interno (`daw.musicBuild`):

1. Spec (BPM, tonalidad, secciones, roles)
2. Pistas + instrumentos del **catálogo** (o Roles)
3. MIDI validado
4. Mezcla básica (vol/pan, a veces bus reverb)

**No uses** “genera una canción MIDI en una sola pista” si quieres un proyecto multi-pista: pide explícitamente **Music Build** / proyecto completo.

Si un VST no carga en el host, el build **falla con mensaje claro** (no silencio silencioso).

---

## Prompts recomendados

Copia, adapta género/BPM/tonalidad.

### Consulta

```text
Resume el proyecto: BPM, tonalidad si la hay, pistas, qué VSTs están cargados y si hay clips vacíos.
```

```text
¿Qué pista está en solo o mute? ¿Hay algo que explique silencio en el master?
```

### Plan

```text
Haz un plan para una canción indie folk de 2 minutos en G mayor a 96 BPM.
Secciones: Intro 4c, Verso 8c, Estribillo 8c, Outro 4c.
Pistas: guitarra acústica, piano, bajo, pad suave, percusión ligera.
No apliques aún: solo plan.md y lista de tareas.
```

### Pensar / preview

```text
Piensa el arreglo completo (Music Build en preview, sin aplicar):
género reggaeton, 95 BPM, D menor, 90 segundos.
Pistas: drums, bass, piano, pad, lead.
Quiero progresión i–VI–III–VII y estribillo más denso.
```

### Crear — Music Build

```text
Music Build aplicar:
- Género: metal core, 140 BPM, E menor, 2 minutos
- Secciones: Intro 4, Riff 8, Breakdown 4, Chorus 8, Outro 4
- Pistas: Drums (BFD o Roles), Bass, Rhythm guitar, Lead, Pad
- Preferir presets de la Biblioteca si existen; si no, JasWave Roles
- Mezcla inicial con sends a reverb suave
```

```text
Music Build nativo (solo JasWave Piano/Roles), soft pad:
balada 80 BPM, C mayor, 1 minuto, piano + pad + bajo.
Sin VSTs externos.
```

### Instrumentos / DecentSampler

```text
En la pista "Piano", inserta DecentSampler (Descent).
Si no está en catálogo, usa la ruta Common Files VST3.
No digas que está listo hasta que el host confirme el slot.
```

```text
Lista presets globales de la Biblioteca que sirvan para pad cinematográfico y aplícalo a la pista Pad.
```

```text
En la pista "Teclas" añade una capa de Shimmer Pad al piano (track.addVstLayer).
```

```text
Crea una carpeta "Cuerdas", mete dentro violines, violas y chelos, y baja la carpeta 3 dB (track.setParent).
```

### Mezcla

```text
Balancea volúmenes: kick y bajo claros, voces/lead un poco delante, pads atrás.
Panea guitarras L/R. Crea bus Reverb FX y sends 15–30% según rol.
No uses sidechain (no es audible en 1.0).
```

```text
Escribe automatización de volumen en el pad: sube 3 dB en el estribillo y baja en el verso.
```

### Master y entrega

```text
Haz un masterPass target streaming, luego bounce WAV de todo el proyecto con normalize LUFS -14 y listen target streaming.
Si listen falla, dime qué ajustar antes de dar por bueno el master.
```

```text
Exporta stems por pista además del bounce estéreo.
```

### Edición MIDI puntual

Selecciona notas en el piano roll → **Preguntar a Jas** (botón flotante) o **Ctrl+L**. Eso ancla las notas al chat (como Cmd+L en Cursor). Luego:

```text
Reordena esta secuencia (las notas seleccionadas) al revés en el tiempo.
```

```text
Pon estas notas a tiempo (cuantiza a semicorcheas) y sube un poco la velocidad.
```

```text
En el clip del bajo del verso: cuantiza a semicorcheas, humaniza un poco la velocidad, y baja las notas que estén fuera de E menor.
```

```text
Transpone el lead +5 semitonos solo en el estribillo (clip correspondiente).
```

### Canción nota a nota (multi-turno)

```text
Haz Music Build del tema (estructura + VSTs). Luego escribe el MIDI de cada pista en turnos distintos, nota a nota, y escucha cada clip antes de pasar a la siguiente.
```

Music Build por defecto **no** inventa melodías con el generador procedural: deja las pistas listas y la IA completa `notas[]` pista a pista según `plan.md`.

### Freeze / rendimiento

```text
Haz freeze de la pista Kontakt cuando el bounce de esa pista suene bien.
```

---

## Qué pedir (y qué no)

| Pide | Evita |
|------|--------|
| Género, BPM, tonalidad, minutos, roles | “Haz algo bonito” sin datos |
| Nombres de preset / DecentSampler + preset | Asumir que el VST suena sin preset |
| “Confirma host slot” | Creer que insertar = audio garantizado |
| Music Build + turnos MIDI nota a nota | Un solo `generateMidiSong` / procedural para toda la canción |
| Sends / EQ VST | Sidechain “de DAW” en 1.0 |

## Diff, certify y revertir

- Con autonomía «sugerir», las propuestas muestran **diff** (+ verde / − rojo) y **Aplicar** (no se escriben en el DAW hasta que aceptes).
- Si la IA necesita datos: tarjeta de **preguntas** con opciones + campo «escribe tu respuesta».
- Preview MIDI en la propuesta + **Escuchar VST**; en el piano roll las notas propuestas aparecen en verde (y bajas en rojo).
- Tras un turno, badges de **certify** / verificación.
- **Revertir esta respuesta** deshace el bloque de undo de ese turno.

Siguiente: [09 · Mezcla y exportar](./09-mezcla-y-exportar.md).
