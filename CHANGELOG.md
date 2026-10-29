# Changelog

Todos los cambios relevantes de JasWave se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/). La versión de la app está en
`jas-wave/package.json`.

## [Unreleased]

Endurecimiento para producción (rama `hardening/production`).

### Eliminado

- **Soporte de plugins VST2** (ADR-0019, sustituye a ADR-0018): el host solo carga `.vst3` de 64 bits, se retiraron las rutas de búsqueda VST2, la cabecera `aeffect.h` y el código muerto asociado. Los proyectos que referencien un `.dll` VST2 mostrarán un aviso de migración a la edición VST3.

### Añadido

- **Zonas MIDI y modo Directo (K3):** splits, capas y transposición del teclado por pista aplicados en el **host
  nativo** (`setLiveMidiTargets` con `targets`: rango, transposición, curva/escala de velocidad, canal de entrada y
  salida, hasta 32 destinos, seguimiento de note-off por nota original, sin reservas en el hilo de audio), modelo
  `ZonaMidi`/`DirectoState` en `project.directo` con comandos con undo (`midi.zones.set/add/update/remove`,
  `directo.setSafety`, `directo.setLock`), panel «Zonas MIDI» (teclado de 88 teclas con arrastre de límites, lista
  editable, pista destino), botón **PANIC** (host `panic` + motor web) y candado **Directo** (bloquea borrar, deshacer,
  cortar, pegar y duplicar con aviso) en el transporte, limitador **true-peak** del máster (`setMasterSafety`, techo
  −0,5 dBTP, 4×, lookahead 64 muestras, solo monitorización) con selftest determinista (`jaswave-host-selftest`), el
  thru web respeta las zonas, y herramientas IA `midi.zones.get/set/add/update/remove`, `directo.panic`,
  `directo.setSafety`, `directo.setLock`. Manual 07, «Zonas MIDI y modo Directo».
- **La IA puede consultar internet y referencias (K6):** herramientas de lectura `web.buscar` (DuckDuckGo con respaldo
  Wikipedia), `web.leer` (texto legible de una página: título, autor, fecha, párrafos), `youtube.buscar` y
  `youtube.ficha` (descripción, capítulos, transcripción); `referencia.escuchar` abre el vídeo en una ventana de la app
  (sin node, partición propia) y `referencia.analizar` descarga el audio con **yt-dlp bajo demanda** (release oficial
  verificada con `SHA2-256SUMS`, `%LOCALAPPDATA%\JasWave\tools\yt-dlp`) y lo mide con los analizadores del DAW (tempo,
  tonalidad, acordes, LUFS, true peak, espectro). La red sale solo del proceso main (`electron/web-tools.ts`): solo
  http(s), IPs privadas/locales/metadata bloqueadas también tras DNS y en cada redirección, 15 s, 2 MB, 30 peticiones
  por minuto, preferencia «Permitir a la IA usar internet». Los resultados llegan al modelo como datos no confiables con
  la instrucción de citar; la respuesta termina con «Fuentes:» y el chat muestra tarjetas con enlace (YouTube con
  miniatura, «Escuchar en JasWave» y «Analizar referencia»).
- **Acordes y letra en el arreglo (K2):** la cabecera del Arrange es ahora una pila de filas bajo la regla con
  carriles de **Secciones** (marcadores), **Acordes** (insignias por compás) y **Letra** (sílabas), sincronizados
  con el scroll y el zoom; la sílaba que se canta brilla siguiendo el playhead. Doble clic edita, arrastrar mueve
  con imán a la rejilla y el clic derecho quita; las filas se pliegan y solo aparecen si hay datos. Botón «Letra»
  en la barra del arreglo para pegar el texto (se reparte por secciones o por compases, con silabeo automático en
  español). Parser cromático completo de cifrados (`F#m7b5`, `Bb/D`, `C7(b9,#11)`, `G13sus4`, `E7alt`…), nombrador
  de acordes a partir de notas tocadas (inversiones, slash, omisiones, tensiones), voicing y transposición
  (`shared/src/music/acordes.ts`). Comandos con deshacer `lyrics.*`, `chords.*`, `marker.update/remove` y
  herramientas de la IA `chords.set/get`, `lyrics.set/get`; la banda virtual vuelca su hoja de ruta (acorde por
  compás y secciones) al carril.
- **Escribirle a la banda mientras trabaja:** lo que el usuario escribe en el chat o en la caja del panel de la banda
  llega al agente en turno entre dos pasos (y al contexto de los que empiezan después); se puede dirigir a un
  participante concreto desde el selector, pulsando su nombre en la consola o con «@Nombre …» / «Nombre: …». La
  consola muestra la línea «Tú: …» y «Tiene en cuenta tu indicación» cuando el agente la recibe; también desde la
  ventana flotante.
- **JasWave Pedal Fix** (`JasWavePedalFix.vst3`): efecto MIDI para cualquier DAW que unifica el pedal de sustain de
  teclados que lo mandan por varios canales (Yamaha PSR-E373), corrige la polaridad, fuerza el sustain, fija el canal
  de salida, transpone y escala la velocidad; retiene las notas hasta soltar el pedal y las puede redisparar.
- **Revisión de sonido por la IA** (`analysis.trackSound`): detecta pistas sin instrumento, VST que no cargó o está en
  bypass, pistas silenciadas o tapadas por un solo y volúmenes demasiado bajos, con la herramienta que lo corrige. La
  banda virtual la usa antes de aprobar las partes y la mezcla.
- **Panel «Banda virtual»** aparte del chat, plegable; la elección (chat o panel) se recuerda.
- **Blindaje de herramientas de la IA:** se rechazan con explicación las pistas duplicadas, notas MIDI en pistas de
  audio, clips solapados y reemplazos que borrarían notas; los nombres de instrumento aproximados y los tipos de EQ
  en español se resuelven; `mix.eq` ya no apila un EQ nuevo en cada llamada.
- **CI** en GitHub Actions (Windows): lint, typecheck, tests de `shared`, `ai-harness` y
  `jas-wave`, y build. Scripts raíz `install:all`, `typecheck`, `test` y `verify`.
- **Pipeline de permisos real** para el agente: cada comando se evalúa con su riesgo real y
  respeta el nivel de autonomía (solo lectura / sugerir ya no escriben). Las acciones quedan
  auditadas con su origen real (IA, usuario que aprobó, CLI).
- **Cancelación de peticiones de IA:** "Detener" aborta la petición HTTP y sus reintentos en el
  proceso main y libera la cola.
- Documentación legal y de proyecto: `LICENSE`, `docs/legal/EULA.md` (y página de licencia en
  el instalador), `docs/legal/PRIVACIDAD.md`, `THIRD_PARTY_NOTICES.md` (incluido en la app
  instalada) con script `npm run notices`, `SECURITY.md`, `docs/RELEASE.md` y ADR-0018
  (soporte VST2).
- **Release reproducible:** `npm run native:sdk` (VST3 SDK fijado en `v3.8.1_build_84`),
  `npm run native:build` (plugin host + JasWave Piano + JasWave Roles, Release x64) y workflows
  `native.yml` y `release.yml` (al subir `vX.Y.Z`: verifica, compila nativo, empaqueta y publica
  en GitHub Releases como borrador). El instalador incluye JasWave Roles/Piano en
  `resources/vst3/JasWave`, usados si no hay instalación de usuario.
- **Actualización automática** vía GitHub Releases (`electron-updater`): comprobación al
  arrancar y cada 6 h, descarga en segundo plano y aviso "Actualización vX lista — Reiniciar".
  La versión de la app se muestra en la barra de título.
- Firma de código preparada (certificado .pfx o Azure Trusted Signing), activa solo si hay
  credenciales en el entorno.

### Cambiado

- **Electron endurecido:** `sandbox: true` y `webSecurity` en todas las ventanas, preload sin
  dependencias de Node, CSP en el build.
- **IPC:** todos los canales validan que el remitente sea el renderer propio; se eliminan
  canales sin uso.
- **Path grants:** el renderer solo accede a los datos de la app, a carpetas elegidas por el
  usuario y (solo lectura) a las carpetas VST; se bloquean UNC y *path traversal*.
- **Plugin host:** allowlist de comandos y validación de rutas de plugin/render.
- **ffmpeg:** argumentos en allowlist, solo audio y con timeout.
- **`shell.openExternal`** limitado a `http(s)` y `mailto`; `window.open`, navegación y
  `<webview>` bloqueados.
- **Puente del agente (CLI):** apagado por defecto en la app instalada, token Bearer, sin CORS,
  solo loopback y cuerpo ≤ 2 MB.
- **Registro de herramientas fail-closed:** sin PermissionManager se deniega; contexto por
  instancia y nivel derivado del origen.
- **Claves de API cifradas** con `safeStorage`/DPAPI en el proceso main; el renderer ya no las
  guarda en `localStorage` ni puede leerlas (migración automática).
- **Fuentes locales** (Inter, JetBrains Mono, Bravura) en lugar de CDN.
- **Guardado atómico** de proyectos (temporal + fsync + rename, con `.bak`).
- Dependencias de UI movidas a `devDependencies` (Vite las empaqueta). Node ≥ 22.

### Corregido

- **La banda dejaba pistas vacías y canciones a medias** (8.ª pasada de la canción completa con la IA real): el modelo
  gratuito devolvía las notas como texto, JSON laxo o recortado y el DAW las rechazaba (60+ veces); el director creaba
  pistas sin encargo que ningún músico podía llenar; y el QA de mezcla daba vueltas por «+0,03 dBTP y 1 muestra de
  clipping». Ahora las notas se aceptan en texto laxo (JSON sin comillas, recortado, filas «60 0 1 100» o «C4, 1, 0.5»),
  solo se veta escribir en la pista de otro músico (máster y buses siguen vedados; una pista sin encargo la llena
  cualquiera), el director debe repartir todas las pistas que cree, `midi.notes.get` lee una pista entera sin clipId y
  el clipping por pista solo cuenta a partir de +1 dBTP o 50 muestras.
- **La banda en ventana flotante se caía** («Cannot read properties of undefined») si el estado reflejado venía sin
  participantes; el estado recibido por el canal se completa siempre.
- **El pedal de sustain del PSR-E373 no actuaba** aunque la señal MIDI llegaba: el teclado manda cada pisada por tres
  canales a la vez (CC64 = 127, 127 y 0) y, en modo omni, el 0 del tercer canal anulaba el pedal. Los pedales
  conmutados (CC 64, 66, 67 y 69) se unifican por canal (vale el máximo entre canales y solo se reenvía al cambiar) en
  el DAW y en el host MIDI, y cada slot VST3 retiene las notas hasta soltar el pedal, también para plugins que no
  implementan el sustain.
- **Panel de la IA en anchos estrechos** (probado a 298, 240 y 200 px): ya no hay scroll horizontal ni
  controles ocultos. La cabecera pasa los botones a otra fila antes que cortar el título, el selector de
  modelo deja la casilla sin texto, el cuadro de escritura ocupa todo el ancho (con modo, dictado y enviar debajo)
  y crece con su texto, y los pasos y herramientas saltan de línea en vez de cortarse con «…».
  La banda virtual pone sus etapas en dos filas cuando no caben en una.
- **Banda virtual coherente**: el planificador entrega una *hoja de ruta* (tonalidad, compás y, por sección,
  sus compases y un acorde por compás); el orquestador calcula el beat de cada sección y la reparte igual a
  todos. Los músicos graban por oleadas: primero la base rítmica y luego el resto, que recibe un resumen de
  lo que ya tocan los demás (registro, ritmo, intensidad) para responder a ello.
- **Escuchar en vivo** (auriculares en la banda): suena cada parte que se graba y, en mezcla y máster, la
  canción en bucle; se pausa al medir. Se puede apagar para trabajar en silencio.
- **Lo que toca la IA se ilumina**: fader, paneo, M/S, FX y envíos del mixer y la cabecera de la pista en
  el Arrange brillan un momento al cambiarlos la IA.
- **Chat de la banda compacto**: una línea con la etapa y lo último que pasó; el detalle, al pasar el ratón.
- **Botones «Escuchar» y «Ver» a la IA en el transporte**: cada uno se enciende o apaga por separado y se
  recuerda. Con «Ver» apagado nada se ilumina; con «Escuchar» apagado la banda trabaja en silencio.
- **Arreglista (coherencia)**: etapa nueva entre la grabación y la revisión. El DAW mide de forma
  determinista que todas las partes encajen con la hoja de ruta —tiempo (clips en la barra de compás,
  nada tras el final, la base no deja secciones vacías, notas en la rejilla), armonía (tonalidad, acorde
  del compás en el tiempo fuerte, bajo en la fundamental) y ritmo (el bajo se apoya en el bombo)— y, si
  algo no encaja, el arreglista corrige esos compases y se vuelve a medir (hasta dos rondas).
- **La IA mide con el motor real**: `analysis.mix` y `analysis.loudness` renderizan con el host nativo
  (VST3, inserts, envíos y máster) en una carpeta temporal que se vacía; antes solo se oían los clips de
  audio y la mezcla y el máster se aprobaban «sin medir». La caché de análisis también se renueva al cambiar
  parámetros de plugins, envíos o enrutado. Para no renderizar la canción entera en cada medición (la banda
  pasó de 21 a más de 60 min), la IA mide el tramo de 40 s con más notas; la exportación final mide todo.
- Los agentes verifican antes de terminar (releen lo escrito o miden) e informan con fidelidad de lo que
  falló; más pasos para músicos, arreglista y QA, que se quedaban cortos.
- **Historial compacto del agente**: en el historial que vuelve al modelo las listas largas de sus propias
  llamadas (las cien notas de un clip) se resumen a «[N elementos]»; arrastrarlas en cada paso agotaba el
  presupuesto de la banda a mitad de canción y dejaba mezcla y máster sin hacer. Presupuesto del turno de
  banda ampliado (1500 llamadas, 60 M de caracteres).
- **Cada agente es un filtro** (`devolver_trabajo`): si la mezcla, el máster o el arreglista ven algo que no es
  de su oficio (una parte mal tocada o vacía, notas fuera de la armonía, una mezcla imposible de masterizar),
  no lo tapan: lo devuelven al músico, al arreglista o a la mezcla; el orquestador lo atiende, vuelve a medir la
  coherencia y el agente retoma su etapa (una devolución atendida por etapa). El panel lo muestra.
- La coherencia se vuelve a medir si el QA hizo regrabar partes, y sus avisos incluyen el acorde de cada
  compás señalado para que el arreglista lo corrija sin buscarlo.
- **Ensayo: la banda se pone de acuerdo** (etapa `ensayo`, entre la grabación y la coherencia). Cada músico recibe
  el reparto de los demás antes de grabar; al terminar, todos escuchan el conjunto (solo lectura) y opinan con
  `proponer_ajustes` (conforme o ajustes concretos para sí o para un compañero); el director arbitra con
  `acordar_ajustes` y solo los afectados vuelven a tocar lo acordado (sin director se acuerda lo propuesto a
  otros; sin decisión, nadie cambia). Evento `ensayo` en el panel («X propone a Y…», «Acordado…»). Con un solo
  músico o `ensayo: false` no hay ensayo.
- La banda espera cuando el servicio se satura: ante «muy ocupada» (429, claves en pausa) reintenta con esperas
  crecientes de hasta unos 7 min en total (`ESPERAS_REINTENTO_BANDA`) en vez de abandonar la producción a los
  16 s; el chat normal sigue con dos reintentos cortos.
- **Monitorización en el transporte**: medidor estéreo L/R del master, altavoz (mute) y volumen hacia los
  altavoces o la salida configurada. No toca el master ni lo que se exporta: el host aplica la ganancia solo a la
  salida en vivo (`setMonitorMix`, nunca al bounce) y el motor web, tras el analizador del master. Con «Escuchar a
  la IA» apagado la banda sigue sonando por dentro y la app silencia la salida (`jaswave-monitor-ia`, marca «IA»):
  se ve señal en el master y se sabe que no sale. Se recuerda por sesión (`jaswave.monitor`).
- **Habilidades por agente** (skills con revelación progresiva, como las de un agente de código):
  `ai-harness/src/agente/habilidades.ts` (`HabilidadAgente`, `leer_habilidad`, listado en el sistema del agente,
  `habilidadDesdeMarkdown`, `unirHabilidades`), disponibles para subagentes delegados (`PerfilSubagente.habilidades`)
  y para cada participante de la producción (`ConfigProduccion.habilidadesPorRol` + las del participante). En el
  asistente, `motor/habilidades-agentes.ts`: habilidades de serie por rol (planificador, director, músico, arreglista,
  QA, mezcla, máster) y por familia de instrumento (batería, bajo, piano, guitarra, sintes/pads, cuerdas) con las
  herramientas reales del DAW, y habilidades del usuario (`habilidades/*.md`) asignadas por `@slug`, `@id`, rol o
  `todos` (o `<!-- agente: … -->`); la del usuario sustituye a la de serie del mismo nombre. Panel de especialistas:
  sección «Habilidades» (de serie / tuya, desplegables) y «Nueva habilidad para este agente» (plantilla + abrir carpeta).
- **Partes humanas, no robóticas** (petición del usuario: «todo muy cuadrado»): instrucciones del músico, del
  planificador y del arreglista reescritas (toda la escala, extensiones add9/sus/6/maj7/m7, duraciones variadas,
  síncopas, arpegios y adornos, velocidades y micro-tiempo humanos; la batería se humaniza con velocidades y ghost
  notes); la medición de coherencia tolera el micro-tiempo (margen 0,08 beats, mensaje «acércalas» en lugar de
  «cuantízalas»), cuenta la 9.ª y la 6.ª como notas del acorde y detecta partes **robóticas** (todas las notas con la
  misma duración o la misma velocidad) para devolverlas al músico en vez de corregirlas nota a nota.
- **Freno a los bucles de fallos** del agente: al 3.º fallo seguido de una misma herramienta se le pide cambiar de
  enfoque y al 5.º se corta su turno con el motivo (un músico insistió más de 15 veces con la misma llamada en una
  producción real). El panel de la banda muestra el motivo real de cada fallo («No salió bien: …») y el turno banda
  lo deja en consola (`[banda] ✗ …`) para el rastro en vivo; el evento de herramienta lleva el error cuando falla
  (antes llevaba la etiqueta de lo que intentaba y el motivo se perdía).
- **La banda puede reescribir notas**: `midi.notes.set` y `midi.notes.patch` ya no se bloquean como destructivos en
  `/banda` (en la 6.ª pasada real los músicos y el arreglista se quedaban en bucle con «no se borra ni se reemplaza
  contenido» al corregir sus propios clips). Sigue bloqueado borrar pistas, clips o proyectos.
- **Propiedad de pista por músico** (blindaje con varios agentes a la vez): el director asigna `pista` en cada encargo
  (`asignar_encargos`) y el harness rechaza, con la pista correcta en el mensaje, cualquier escritura de un músico en
  una pista que no sea la suya o una que haya creado él (`ConfigProduccion.resolverPista`; en la 6.ª pasada real el
  bajista creó clips en «Cuerdas»). Leer las pistas de los demás sigue permitido. Con el candado común de escrituras
  (una a la vez), la guardia de repeticiones, el tope de 24 escrituras por paso y el freno de 5 fallos seguidos, el
  trabajo paralelo de la banda no se pisa.
- **Guardia de herramientas MIDI más robusta** (fallos vistos en la 7.ª pasada real): `notas` como texto JSON, como
  una sola nota o como mapa se convierten a lista (antes `(t.notas ?? []).filter is not a function`); `midi.notes.patch`
  acepta notas sueltas en `upsert` (o en `notas`) y les genera id, `removeIds` puede faltar (antes «Cannot read
  properties of undefined (reading 'id')»), y la forma por tramo `{pistaId, rangeStart, rangeEnd, notas}` que enseñan
  las guías del asistente se traduce al comando real (quita lo del tramo y pone lo nuevo, relativo al clip; sin clip
  que cubra el tramo, error accionable). El ejecutor heredado también acepta la forma del comando (`upsert`/`removeIds`),
  así ambas rutas aceptan lo mismo. Los ids copiados con comillas («"1793-x"») se limpian.
- **Banda virtual en otra ventana**: el panel flotante (ventana satélite) se veía vacío porque su orquestador es otro
  singleton; ahora la ventana que lleva la producción publica el estado por `BroadcastChannel` (`jaswave-banda-v1`),
  la flotante lo pide al abrirse y lo refleja, y «Detener» desde ella llega a la principal. Tests
  `banda-orchestrator.test.ts` (3) y e2e 31.
- **Medidor del transporte**: la marca de pico retenido se quedaba congelada (su caída dependía de que cambiara la
  lectura) → cae con su propio reloj; la lectura ya no espera al host nativo (si está ocupado cargando un VST, la
  barra no se congela) y una lectura nativa vieja no se repite. e2e 30 comprueba que la marca desaparece en reposo.
- Volumen 0 o en dB desde la IA (máster o pista) se rechaza explicando la escala (1 = 0 dB): la canción
  salía muda. El QA ya no aprueba un máster a 0 o en mute.
- **Banda virtual: canciones incompletas.** El turno de banda tiene presupuesto propio (800 llamadas,
  16 M de caracteres, 90 min); con el de un chat normal los últimos músicos se quedaban sin turno y sus
  pistas vacías.
- **Notas que no sonaban**: la IA escribía las notas en tiempo de la canción dentro de clips que empiezan
  más tarde (quedaban fuera del clip: ni sonaban ni se exportaban al .mid). Ahora se pasan a tiempo del
  clip, y un clip a más de 64 beats del final de lo grabado se rechaza con la cuenta correcta
  (evita renders con minutos de silencio).
- «Piano de cola» / «piano acústico» cargan el **Grand Piano** (antes empataba con el Piano Synth).
- `backend/scripts/conceder-instrumentos.ts --todos` concede también los FX JasWave: sin licencia, un
  instrumento JasWave renderiza en silencio y un FX no procesa. El e2e 24 vuelve a leer bien la licencia
  (`jwl1.<carga>.<firma>`) y avisa de los plugins sin licencia; el e2e 29 falla si la canción o algún
  stem sale en silencio, o si faltan notas en el .mid.
- **Mixer**: dentro del scroll de cada tira solo quedan los FX. M, S, monitor, armar, el selector MIDI y
  la entrada de audio quedan fijos fuera de él, y los envíos también.
- La **app empaquetada abría una ventana en blanco**: ahora carga `dist/index.html` desde la
  ruta de la app; logo e icono con rutas relativas.
- **Escalada de permisos de la IA:** la IA o los scripts ya no pueden subir su nivel de
  autonomía (antes se aprobaba desde READ_ONLY y revertía la parada de emergencia).
- Detección de `STATE_CONFLICT` al aplicar ejecuciones pendientes del agente.
- Clave de Gemini enviada por cabecera en lugar de en la URL.

### Eliminado

- Targets de empaquetado macOS/Linux (el plugin host nativo es solo Windows).
- Ejecutable del plugin host y `.d.ts` generados del control de versiones.
