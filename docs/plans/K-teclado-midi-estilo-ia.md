# K — Teclado MIDI, estilo del músico y ecosistema del plan `plan_midi_keyboard_zones_ia.md`

Fuente: `docs/inplementaciones-futuras/plan_midi_keyboard_zones_ia.md` (8 pilares). Objetivo del usuario: que la IA
entienda **con precisión y matiz** lo que toca en su teclado MIDI (micro-tiempos, microdinámica, legato, pedal, rubato)
y lo convierta en **skills de estilo** que los agentes apliquen; además, acordes complejos y letra en el arreglo,
zonas/splits en directo, voz y plugins de restauración/pedalera. Antes de dividir el repo (G9).

## Inventario (2026-10-29)

Ya existe: captura MIDI con sello QPC en ns (`native/plugin-host/src/midi_winmm.cpp` → `JW_MIDI` → `src/lib/midi-controller.ts`
`bufferEscuchaMidi`), `shared/src/music/toque/` (PerfilToque: timing, microdinámica, acordes, articulación),
`src/lib/styles/touch-ops.ts` (`analysis.touch`, `style.touch.learn/apply/list`, `touch-profiles.json`),
habilidades de agentes (`ai-harness/src/agente/habilidades.ts`, `motor/habilidades-agentes.ts`, carpeta del asistente),
armonía diatónica (`shared/src/music/worship/armonia.ts`), `Marcador` + `marker.create` (sin dibujar en el arreglo),
voz→MIDI YIN (`shared/src/audio/pitch-tracking.ts`, `analysis.voiceToMelody`), Vocal Tune (PSOLA con formantes),
FX Rack DSP (`plugins/shared-dsp/jw_fxrack.h`: EQ, compresor, saturación, chorus, delay, reverb), framework VST3
(`jaswave_add_vst3`, `jw_vst3.h`, `jw_ui_plantilla.h`, `sync-manifests.mjs`, `ui-layout.mjs`).

No existe: CC/pedal en la captura ni sesiones de toma; rubato aprendido, offset por voz del acorde y por mano;
skill de estilo enlazada al perfil e inyectada en la banda; parser de acordes cromáticos; tipos de letra;
carriles de marcadores/acordes/letra; zonas/splits/transposición por slot en el host; PANIC/lock/limitador TP del
máster; `.jwvoice`, coro armonizador MIDI, síntesis vocal; noise gate, denoise, de-hum, de-click, de-clip, amp/IR.

## Subworkstreams (en paralelo, carpetas disjuntas)

| ID | Qué | Dónde | Estado |
|---|---|---|---|
| K1 | **ADN de interpretación**: captura con CC (64/66/67/1/11) y tomas; `PerfilToque` v2 (rubato por frase, offset por voz del acorde, mano izq/der, pedal); `analysis.performance` (informe detallado en español); skill de estilo (`estilo-<slug>.md` con perfil JSON) aplicada por la banda (inyección en `sistemaParticipante` + `touchApply` tras cada músico); panel «Mi estilo» | `shared/src/music/toque/`, `jas-wave/src/lib/midi-controller.ts`, `midi-example-analyzer.ts`, `styles/touch-ops.ts`, `ai-harness/src/agente/produccion.ts`, módulo asistente (`habilidades-agentes.ts`, `turno-banda.ts`, UI nueva) | en curso |
| K2 | **Acordes complejos, letra y carriles**: `shared/src/music/acordes.ts` (parser/nombrador/detector cromático), `shared/src/types/lyrics.ts`, comandos `chords.*`/`lyrics.*` con undo, carril de marcadores + acordes + letra en el arreglo (cabecera multi-fila, glow con el playhead, doble clic, arrastre), herramientas IA | `shared/`, `jas-wave/components/arrangement/`, `jas-wave/src/lib/agent-action-catalog.ts` | en curso |
| K3 | **Zonas MIDI y directo**: rango/transposición/curva de velocity/canal por slot en `setLiveMidiTargets` y `applyLiveMidiFromWinmm`; varias capas por pista en vivo; PANIC; limitador true-peak del máster (−0,5 dBFS) conmutable; modo Directo (lock); panel «Zonas MIDI»; herramienta IA `midi.zones.set` | `native/plugin-host/src/main.cpp`, `jas-wave/electron/plugin-host-bridge.ts`, `components/midi-controller-host.tsx`, panel nuevo | hecho (sin commit; falta desplegar el host y correr el e2e 33) |
| K4 | **Voz**: formato `.jwvoice` (huella: f0 medio/rango, formantes, brillo, aspereza), banco de voces; VST3 **JasWave Vocal Choir** (PSOLA de Vocal Tune controlado por MIDI: hasta 4 voces, preservación de formantes, spread estéreo); después: compositor letra→canción (entrevista en chat, voz→melodía con sliders 0–100 %, armonización por LLM, volcado multipista con pista de referencia silenciada) | `plugins/com.jaswave.plugin.vocal-choir/`, `shared/src/audio/`, módulo asistente | hecho en código (sin commit; falta desplegar el VST3 y el e2e 15) |
| K6 | **IA con internet**: herramientas de lectura `web.buscar`, `web.leer` (texto legible), `youtube.buscar`, `youtube.ficha`, `referencia.escuchar` (abre el vídeo en una ventana de la app) y `referencia.analizar` (audio de la referencia vía yt-dlp bajo demanda → tempo, tonalidad, acordes, LUFS, espectro con los análisis existentes); red solo desde el proceso main con allowlist; contenido web como no confiable (`untrusted.ts`); fuentes citadas en la respuesta y tarjetas con enlace en el chat | `jas-wave/electron/web-tools.ts`, `preload.ts`, `src/lib/ai-daw-agent.ts`, catálogo y política de acciones, módulo asistente (tarjetas) | en curso |
| K5 | **Audio Doctor** (gate/expander, denoise espectral, de-hum, de-click, de-clip, de-reverb, aislador de voz, Auto-Fix, delta) y **StompLab** (gate, compresor, overdrive multi-modelo, preamp válvulas, cabina IR, chorus, delay, shimmer) como VST3 universales + manifiestos con `ai.intents` | `plugins/com.jaswave.plugin.audio-doctor/`, `plugins/com.jaswave.plugin.stomplab/` | hecho (sin commit; compilados y validados en `plugins/build_audio-doctor` y `plugins/build_stomplab`, sin desplegar) |

## Criterios de aceptación
- Tocando en el PSR-E373: `analysis.performance` describe acordes (nombres cromáticos), micro-tiempos por voz,
  microdinámica por mano, legato/pedal y rubato con números; «Guardar como skill de estilo» crea la habilidad y la
  banda la usa (se ve en el panel y en las notas: ya no caen en la rejilla).
- Carril de acordes y letra visible, editable y sincronizado con el playhead; la hoja de ruta de la banda lo rellena.
- Split/capa/transposición por zona en vivo a 0 ms de latencia añadida; PANIC corta todo; limitador del máster.
- Plugins nuevos pasan el validator, tienen manifiesto y layout, y la IA puede gobernarlos.
- `npm run verify`, e2e de UI y e2e 29 (canción con la IA real) en verde.

## Notas de traspaso

### K3 — Zonas MIDI y modo Directo (2026-10-29)

**Hecho (sin commit; host compilado, selftest en verde, typecheck y tests unitarios de lo propio en verde):**
- Host (`native/plugin-host/src/main.cpp`): `setLiveMidiTargets` acepta `targets[{slotId, deviceId?, channel?, lo, hi,
  transpose, velCurve (linear|soft|hard|fixed), velScale, velFixed?, outChannel?}]` (hasta 32; `slotIds/deviceIds`
  siguen valiendo); `applyLiveMidiFromWinmm` filtra por puerto/canal/rango, transpone con clamp, aplica curva y canal de
  salida y apaga cada note-off en el tono/canal que realmente sonó (`LiveNoteTrack` por destino, resincronizado por
  `gLiveZoneGen` al cambiar zonas o descargar slots; sin reservas en el hilo de audio). Comandos nuevos sin respuesta:
  `panic` (descarta el ring WinMM, olvida notas y `allNotesOff` en todos los slots) y `setMasterSafety {enabled,
  ceilingDb}` → `master_limiter.h` (`MasterTruePeakLimiter`: TruePeak4x de `jw_dsp.h`, ventana 64, retardo 69
  muestras, release 60 ms, margen 0,1 dB; sustituye al soft-clip solo en monitorización, nunca en bounce).
  `getMixMeters` añade `masterSafety` y `masterLimiterGain`. `Vst3Slot` lleva el canal por evento (note-on/off/CC).
  Selftest `native/plugin-host/tests/master_limiter_test.cpp`: `cmake --build build-release --config Release --target
  jaswave-host-selftest` y ejecutar `build-release/Release/jaswave-host-selftest.exe`.
- App: `shared/src/types/directo.ts` (`ZonaMidi`, `SeguridadMaster`, `DirectoState`, `aplicarZonaANota`,
  `notasDeSalidaParaPista`), `project.directo?` en `ProjectState`, comandos `shared/src/commands/directo-commands.ts`
  (registrados en `comandos-builtin.ts`), `jas-wave/src/lib/midi-zones.ts` (`buildLiveMidiTargets`, `firmaZonas`,
  `SeguimientoNotasZona`), `modo-directo.ts` (`panicDirecto`, `enviarSeguridadMaster`, `instalarBloqueoDirecto`),
  `midi-controller-host.tsx` manda todas las capas con `targets` y reenvía la seguridad al reiniciar el host,
  `vst-voice-router.ts` aplica zonas en el thru web, panel `components/midi-zones-panel.tsx` (herramienta
  `midi-zones`, icono en el rail), `transport-bar.tsx` → `ControlesDirecto` (PANIC, candado, banner, «TP»).
  Allowlist (`plugin-host-guard.ts`) y rutas del bridge (`plugin-host-bridge.ts`) para `panic`/`setMasterSafety`.
- IA: catálogo, política (`midi.zones.get` read; el resto write) y `ai-daw-agent.ts`; `harness.ts READ_ONLY`.
- Tests: `shared/src/test/directo-commands.test.ts`, `jas-wave/src/lib/midi-zones.test.ts`, `modo-directo.test.ts`.
  e2e `jas-wave/e2e/33-zonas-midi.spec.ts` escrito, **no ejecutado**.
- Docs: manual 07 «Zonas MIDI y modo Directo», CHANGELOG.

**Para desplegar / pendiente:**
- Copiar el host nuevo: `native/plugin-host/build-release/Release/jaswave-plugin-host.exe` → `npm run stage:host`
  (no se hizo aquí porque había un e2e largo usando el host actual). Sin él la app sigue funcionando con la ruta
  `slotIds/deviceIds` (sin zonas en el host; el thru web sí las aplica).
- Ejecutar el e2e 33 y ajustar selectores. Probar con el PSR-E373: split bajo/piano, capa, PANIC con nota colgada.
- El thru web no recibe aún el canal de entrada (`routeMidiToTrack` sin `canal`): las zonas con `canalEntrada` solo
  filtran por canal en el host. Cuando K1 cierre `midi-controller.ts`, pasar `MidiParsed.channel` a `routeMidiToTrack`.
- `data-testid`: `zonas-panel`, `zona-item`, `zona-lo`, `zona-hi`, `zona-pista`, `zona-quitar`, `zona-anadir`,
  `boton-panic`, `modo-directo`, `banner-directo`, `directo-seguridad`, `controles-directo`.

### K2 — Acordes complejos, letra y carriles (2026-10-29)

**Hecho (sin commit; typecheck y tests unitarios en verde en lo propio):**
- `shared/src/music/acordes.ts`: `parsearAcordeComplejo` (tríadas, sus, add, 6/m6/6-9, 7/maj7/m7/m7b5/dim7/m(maj7)/7sus4,
  9/11/13 con omisión convencional de la 3.ª en «11» y de la 11.ª en «13», alteraciones b5/#5/b9/#9/#11/b13 múltiples,
  `alt`, omit3/omit5, slash, ♯♭, mayúsculas/minúsculas, paréntesis/comas), `nombrarAcorde(pitches)` (plantillas
  derivadas del propio parser; inversiones → barra, omisiones «(no5)», tensiones), `voicingDeAcorde`,
  `transponerAcorde`, `pitchesDeAcorde`, `normalizarNombreAcorde`. Tests: `shared/src/test/acordes.test.ts`.
- `armonia.ts`: `acordeDesdeToken(token, tonal)` = diatónico por grados y, si falla, cromático (`spec.grado = -1`,
  romano con «b»). `parsearAcorde` no cambia (sus tests siguen igual). `coherencia-banda.ts` (módulo asistente) sigue
  usando su propio parser; puede adoptar `acordeDesdeToken` cuando K1 cierre.
- Tipos `shared/src/types/lyrics.ts` (`SilabaLetra`, `FraseLetra`, `AcordeCarril` —el nombre `EventoAcorde` ya existía
  en `audio-lens`—, `LetraProyecto`), `project.letra?` opcional en `ProjectState` (se serializa con el resto del estado;
  el esquema zod es passthrough). `shared/src/music/letra.ts`: `silabear`, `silabasDeLinea`, `repartirLetra`,
  `temporizarFrase`, `acordesDesdeTexto` («| D | Bm | G A | % |»), `acordesComoTexto`, `silabaEn`.
- Comandos `shared/src/commands/lyrics-commands.ts` (undo por instantánea parcial): `lyrics.setPhrases`,
  `lyrics.alignTiming`, `lyrics.setChords`, `chords.upsert`, `chords.remove`, `chords.move`, `lyrics.clear` (dangerous),
  y herramientas IA `chords.set` (texto | lista | `secciones` → también crea marcadores), `chords.get`, `lyrics.set`,
  `lyrics.get`. Además `marker.update` y `marker.remove` en `auxiliary-commands.ts`. Regla de dominio
  `LetraAcordesValidos` en `validacion-dominio.ts`. Tests: `lyrics-commands.test.ts`, `letra.test.ts`.
- Política (`ai-harness/src/agent/action-policy.ts`) y catálogo (`agent-action-catalog.ts`) con los tipos nuevos.
  Las descripciones/esquemas para el modelo salen del propio registro de comandos (no hay docs aparte).
- UI: `ArrangeBoard` con `headerRows` (pila regla + filas con etiqueta y plegado), `TimelineMarkersLane.tsx`,
  `TimelineLyricChordLane.tsx` (`TimelineChordLane`, `TimelineLyricLane`, `LaneInlineInput`, `LaneContextMenu`),
  `lane-scroll.ts` (RAF que sigue el scroll; arrastre con umbral). Glow por RAF + atributo `data-activa`. Botón
  «Letra» (textarea → `lyrics.setPhrases`). `data-testid`: `carril-marcadores`, `carril-acordes`, `carril-letra`,
  `acorde-insignia`, `letra-silaba`, `marcador-bandera`, `carril-input`, `carril-menu`, `fila-*`, `fila-*-plegar`,
  `boton-pegar-letra`, `textarea-letra`, `aplicar-letra`.
- Banda: `turno-banda.ts` → `volcarHojaAlCarril` dentro del callback `coherencia` (es el único punto donde el harness
  entrega la `HojaDeRuta` completa; los eventos `herramienta` no traen argumentos). Idempotente por firma de la hoja.
- e2e `jas-wave/e2e/32-carril-acordes-letra.spec.ts` escrito, **no ejecutado**.

**Pendiente / avisos:**
- Ejecutar el e2e 32 y ajustar selectores si hace falta (el deshacer se hace con Ctrl+Z sobre la página).
- `npx tsc` en `shared` y `jas-wave` muestra errores ajenos a K2 (`directo-commands.ts`, `midi-zones-panel`, de K3).
- Posible mejora: `nombrarAcorde` en vivo desde `midi-controller` (K1) para pintar el acorde tocado en el carril.
- Los acordes en el carril no se tocan ni se exportan a MIDI todavía (`voicingDeAcorde` está listo para ello).

### K6 — IA con internet (2026-10-29)

**Hecho (código + tests, sin commit):**
- `jas-wave/electron/web-tools.ts` (main): `validarUrlPublica`/`validarUrlResuelta` (solo http(s), sin credenciales,
  bloqueo de localhost/`.local`/`.internal`/metadata e IPs privadas v4/v6 incl. mapeadas, también tras DNS),
  `fetchSeguro` (redirecciones manuales validadas, máx. 3; 15 s; 2 MB con marca `truncado`; `User-Agent` propio;
  allowlist opcional de hosts), `webBuscar` (DDG HTML → `parsearResultadosDdg`, respaldo Wikipedia es),
  `webLeer`/`extraerTextoLegible` (Readability propio: article/main, `#` títulos, listas, autor/fecha/idioma),
  `youtubeBuscar` (`ytInitialData` por emparejado de llaves), `youtubeFicha` (`ytInitialPlayerResponse` + oEmbed +
  capítulos de la descripción + `timedtext` es>en), `youtubeMiniatura` (data: URL; la CSP del renderer no admite
  `i.ytimg.com`), yt-dlp bajo demanda (`instalarYtDlp`: `SHA2-256SUMS` + `yt-dlp.exe` de GitHub con allowlist y
  SHA-256), `extraerReferenciaAudio` (yt-dlp `execFile` con argumentos fijos → ffmpeg WAV mono 22 050 Hz ≤ 15 min →
  `ventanaMasDensa` 90 s → `referencia-<id>.wav`), `GestorTemporalesReferencia` (se borra en `will-quit`),
  `LimitadorPeticiones` (30/min).
- `main.ts`: IPC `web-tools-*` (guardado por `security.ts`), preferencia `permitirInternetIA` en `jaswave-settings.json`
  (por defecto activa; `web-tools-fijar-internet-permitido` solo desde la ventana principal), ventana «Referencia: …»
  (`BrowserWindow` sin preload, `sandbox`, `partition: 'referencia-youtube'` con permisos denegados, embed
  `youtube-nocookie.com`). `preload.ts` → `window.electron.webTools`; tipos en `hooks/use-file-service.ts`.
- Renderer: `src/lib/web-tools-cliente.ts` (envoltorio + respaldo Wikipedia con `fetch` sin Electron +
  `envolverResultadoWeb` con `wrapUntrustedToolResult` e instrucción de citar), `src/lib/fuentes-del-turno.ts`
  (registro de enlaces del turno, `anexarFuentesAlTexto`, `extraerUrls`), `src/lib/referencia-analisis.ts`
  (`analysis.audioLens` con las muestras reales + `measureLoudnessBs1770` + `medirEspectroWelch` → informe en español).
  Acciones en `ai-daw-agent.ts`, catálogo (`agent-action-catalog.ts`) y política (`action-policy.ts`: lecturas `read`,
  `referencia.escuchar` `write`).
- Módulo asistente: `src/ui/tarjeta-fuente.tsx` (tarjetas por enlace de la respuesta; YouTube con miniatura,
  «Escuchar en JasWave» vía `executeDawActions(referencia.escuchar)` y «Analizar referencia» → turno nuevo) montado en
  `coproducer-panel.tsx` bajo cada mensaje del asistente.
- Tests: `electron/web-tools.test.ts` (28 casos con HTML fijo: DDG, ytInitialData, player/oEmbed, timedtext,
  readability, IPs privadas, redirecciones, truncado, allowlist, SHA-256 de yt-dlp, WAV, ventana densa, limitador),
  `src/lib/fuentes-del-turno.test.ts`, `src/lib/web-tools-cliente.test.ts` (envoltorio no confiable + informe).
- Docs: manual 08 («La IA puede consultar internet y referencias»), CHANGELOG. Script manual:
  `node --import tsx cli/web-tools-prueba.mjs <buscar|leer|yt|ficha|referencia> <texto|URL>`.

**Pendiente / decisiones para quien siga:**
- La lista «Fuentes:» automática: el hook está en `fuentes-del-turno.ts` (`anexarFuentesAlTexto(textoFinal)` +
  `limpiarFuentesDelTurno()` al empezar el turno). Falta llamarlo donde el módulo compone la respuesta final
  (`motor/agent-legacy-turn.ts` y `motor/turno/`, zona de otro agente) y exponerlo por el SDK (`src/modulos/api-host.ts`
  + `npm run sdk:generar`). Mientras, las tarjetas se dibujan a partir de los enlaces que ya trae el texto.
- Preferencia «Permitir a la IA usar internet»: hay IPC y `fijarInternetPermitido()` en `web-tools-cliente.ts`; falta
  el interruptor en Ajustes → IA (`plugins/com.jaswave.modulo.asistente-ia/src/ui/ajustes-ia.tsx`, fuera de la zona K6).
- Para que el razonamiento mencione las herramientas nuevas: `ai-harness/src/agent/reasoning-prompts.ts` solo lista
  `web.search`; añadir `web.buscar`/`web.leer`/`youtube.*` allí cuando se toque ese archivo.
- `referencia.analizar` en la app real y la descarga de yt-dlp no se han probado de extremo a extremo (ver informe de
  la prueba manual). Puede añadirse una pantalla de progreso con `webTools.onProgreso` (fases
  `instalando/descargando/extrayendo/listo`).
- `youtubeBuscar` depende del HTML de YouTube (cookie `CONSENT=YES+1`); si cambia el formato, `youtubeFicha` sigue
  funcionando con oEmbed y la búsqueda web puede usarse como alternativa.

**Traspaso K6 (cierre, 2026-10-29):**
- Hecho: «Fuentes:» automática. `fuentes-del-turno.ts` expone `globalThis.__jaswaveFuentesTurno` (`limpiar`/`anexar`);
  el módulo nuevo `plugins/com.jaswave.modulo.asistente-ia/src/motor/turno/fuentes-turno.ts` lo lee de forma defensiva y
  `turno-agente.ts` lo llama al empezar (`iniciarFuentesTurno`) y antes de guardar el texto final (`conFuentesDelTurno`).
  Sin SDK nuevo. No cubre `turno-banda.ts` ni `agent-legacy-turn.ts`.
- Hecho: interruptor «Permitir a la IA usar internet» en Ajustes → IA (`ui/ajustes-ia.tsx`, `InterruptorInternetIA`,
  solo en escritorio vía `window.electron.webTools`).
- Sin `require` en los módulos K6 (verificado). Script manual: `jas-wave/cli/web-tools-prueba.mjs`.
- Verificado: tests node:test de web-tools, web-tools-cliente y fuentes-del-turno en verde; tsc sin errores en los archivos K6.
- Pendiente: probar el interruptor y las fuentes en la app real (sin e2e por ahora); añadir test del módulo para
  `fuentes-turno.ts`; `reasoning-prompts.ts` aún solo lista `web.search`.


### K1 — ADN de interpretación (2026-10-29)

**Hecho (sin commit; typecheck de `shared`, `ai-harness`, `jas-wave` y módulo en verde; tests de lo propio en verde):**
- Captura (`midi-controller.ts` → `bufferEscuchaMidi` de `midi-example-analyzer.ts`): además de notas guarda CC 64/66/67/1/11
  (`CC_ESCUCHADOS`) y pitch bend con `deviceId`; tomas (`Toma`, `resumenToma`, `controlDeEventos`, `notasDeEventos`).
- `PerfilToque` v2 en `shared/src/music/toque/` (`v2.ts`: `medirVoces` offset por voz del acorde, `medirManos`/`estimarSplitManos`,
  `medirRubato` por frase, `medirPedal`; `aprender`/`aplicar` los usan; helpers exportados en `index.ts`). Tests en `toque.test.ts`.
- `styles/touch-ops.ts`: `performanceAnalyze` (informe en español con números) = herramienta `analysis.performance`;
  `style.touch.learn` devuelve ahora también `perfil` en `data` (cambio de una línea en `ai-daw-agent.ts`).
- Skill de estilo (`motor/habilidades-agentes.ts`): `habilidadEstiloMarkdown` (`habilidades/estilo-<slug>.md`, `@musicos`,
  intensidad, id del perfil y bloque ```json estilo-perfil), `estiloDesdeArchivo`, `estilosDelUsuario`, `estiloActivoDelUsuario`,
  `guardarEstiloComoHabilidad`, `activarEstilo` («<!-- desactivada -->»).
- Banda: `ai-harness/src/agente/produccion.ts` → `ConfigProduccion.estiloMusical` inyectado en `sistemaParticipante` solo a
  músicos. `turno-banda.ts`: lee el estilo activo, lo pasa como `estiloMusical` y tras `participante` completado en la etapa
  `musicos` llama `style.touch.apply` (`aplicarEstiloAMusico`; salta batería/pistas sin resolver; cola serializada que se espera al final).
- UI: `src/ui/mi-estilo-panel.tsx` («Analizar mi toque», nombre + «Guardar como skill de estilo», lista con activar/quitar),
  montado arriba de `banda-panel.tsx`. `data-testid`: `mi-estilo-panel`, `mi-estilo-analizar`, `mi-estilo-nombre`,
  `mi-estilo-guardar`, `mi-estilo-aviso`, `mi-estilo-informe`, `mi-estilo-lista`, `mi-estilo-item`.
- Tests nuevos: módulo `test/estilo-usuario.test.ts` (3), `ai-harness/src/test/agente-habilidades.test.ts` (inyección solo a músicos).

**Pendiente / avisos:**
- No probado con el PSR-E373 ni con la app real (sin build/e2e por orden). Falta e2e del panel «Mi estilo».
- El estilo se aplica solo en la etapa `musicos`; lo que se reescribe después (ensayo, correcciones del arreglista) no se
  re-humaniza. Si la medición de coherencia se queja de desvíos, bajar la intensidad (`<!-- estilo-intensidad: 0.7 -->`).
- Si la skill viene de otro equipo y el perfil no está en `touch-profiles.json`, `style.touch.apply` falla (se registra en
  consola); falta reimportar desde el JSON de la skill con `style.touch.learn`.
- Las skills de estilo también salen en la lista de habilidades de los músicos (las carga `habilidadesUsuarioDe`), con el JSON en el cuerpo.
- K3: `MidiParsed.channel` ya llega en `dispatchParsed`; `routeMidiToTrack` sigue sin `canal` (no tocado aquí).

### K4 — Voz: `.jwvoice`, Vocal Choir y compositor (2026-10-29)

**Hecho (sin commit; validator 47/47, `shared`: typecheck y 821 tests en verde):**
- `shared/src/audio/voz-jwvoice.ts` (+ test, exportado en `index.ts`): `HuellaVoz` (f0 medio/min/max, F1–F3, brillo, aspereza,
  sonoridad), `analizarHuellaVoz` (YIN existente + envolvente LPC; devuelve `null` sin tramos sonoros, no inventa),
  `serializarJwVoice`/`leerJwVoice` (JSON `{formato:'jwvoice', version:1, voz}` con validación estricta y versión futura
  rechazada), `BancoVoces` inmutable con 4 puestos (lead, 2.ª, 3.ª, base: voz, intervalo, nivel, pan), `vozMasCercana`,
  `serializarBancoVoces`/`leerBancoVoces` (`jwvoice-banco`).
- **JasWave Vocal Choir** `plugins/com.jaswave.plugin.vocal-choir/` (`src/vocal_choir_dsp.h`, `vocal_choir_plugin.cpp`,
  `test/render_test.cpp`): efecto con audio + eventos MIDI de entrada (`midiFx`; el host ya manda notas a cualquier slot con
  bus de eventos). Hasta 4 voces, cada una es un lector TD-PSOLA propio (mismo esquema que Vocal Tune, YIN copiado y
  simplificado) sobre un anillo mono: tono por nota exacto (0,0 cents medidos), formantes preservados (F1/F3 varían <2 dB
  entre notas) y desplazables (Formant Shift/Throat), spread estéreo por voz (pan de potencia constante según nº de voces),
  vibrato con retardo, humanización, desafinación por voz, timbre propio por puesto, robo de voz con portamento (legato),
  pedal CC64 y CC123. Fuente: `Input` (voz de la pista; usa su f0) o `Internal` (vocal formántica A/E/I/O/U con tesitura
  bajo/tenor/alto/soprano; es la que suena en pistas de instrumento, donde el audio llega en silencio). Latencia fija 10 ms.
  CPU ≈1 % (interna) / 2,4 % (entrada) de un núcleo con 4 voces a 48 kHz. 19 parámetros (ids 0–16, medidores 40–41).
  Editor con 4 filas (nota, nivel, panorama), 3+3 perillas, desplegables FUENTE/VOCAL/TESITURA/VOCES; el resto en la página PARÁMETROS.
- Registrado en `plugins/CMakeLists.txt`, `scripts/sync-manifests.mjs` y `scripts/ui-layout.mjs`; `jaswave-plugin.json` y
  `ui-layout.json` generados (`--check` en verde). Añadido a ENTREGADOS en `jas-wave/e2e/15-plugins-manifiesto.spec.ts`.
- Compositor letra→canción: `shared/src/music/compositor-cancion.ts` (+ test, 13 casos): entrevista (`FichaCancion`,
  `siguientePreguntaEntrevista`, `aplicarRespuestaEntrevista`), `ajustarMelodiaVoz` con sliders 0–100 % (afinación a la
  escala por confianza, cuantización, legato, limpieza), `alinearLetraANotas` (melismas / subdivisión de notas largas, usa
  `silabasDeLinea` de K2), armonización (`construirPromptArmonizacion`, `leerArmonizacionLLM` estricta, `armonizar` con
  respaldo diatónico), `planVolcadoMultipista` (lead, coros → Vocal Choir, `[Audio Ref - Canto Original]` silenciada).
  Habilidad del productor: `plugins/com.jaswave.modulo.asistente-ia/src/motor/habilidad-compositor-cancion.ts` (+ test).

**Binarios (compilados solo en `plugins/build_vocal-choir`, NO desplegados):**
`plugins/build_vocal-choir/VST3/Release/JasWaveVocalChoir.vst3` y `plugins/build_vocal-choir/tools/Release/JasWaveVocalChoir_rendertest.exe`
(`JasWaveVocalChoir_rendertest.exe [coro.wav]` → TODO OK; escribe un WAV con una progresión de acordes).
Rehacer: `cmake -S plugins/com.jaswave.plugin.vocal-choir -B plugins/build_vocal-choir -G "Visual Studio 17 2022" -A x64`,
`cmake --build plugins/build_vocal-choir --config Release`, `plugins/build/bin/Release/validator.exe <.vst3>`.

**Pendiente:**
1. Desplegar (`plugins/deploy_vst3.ps1 -Build plugins/build_vocal-choir`) cuando no haya e2e en curso; el e2e 15 exige el
   binario resuelto en una carpeta VST3 y fallará hasta entonces. Cargarlo en el host real y comprobar a oído (el WAV de
   prueba es la referencia; la medición no sustituye a escucharlo).
2. La habilidad del compositor no está registrada (no se tocó `habilidades-agentes.ts`, de K1): añadir
   `habilidadCompositorCancion()` a las de serie del productor o escribirla en `habilidades/`. No hay herramienta de IA
   dedicada (los archivos de catálogo/runner estaban vetados): el agente usa `analysis.voiceToMelody` + `track.*`/`clip.*`/`plugin.insert`
   siguiendo `planVolcadoMultipista`; falta el comando que lo ejecute de una vez, el panel visual «Voice-to-Melody» y la
   guarda/lectura de `.jwvoice` en disco (permisos vía `path-grants.ts`) y el botón «aprender mi voz» que llame a `analizarHuellaVoz`.
3. Vocal Choir: sin ruta de banco `.jwvoice` dentro del plugin (los puestos del banco aún no cargan huellas en el DSP; la
   huella podría fijar tesitura/formantes por voz); relación de tono extrema (>2 octavas respecto a la fuente) suena fina: elegir
   la tesitura adecuada. `sync-manifests`: la copia web del módulo editores-vst (`layouts.json`) no se regeneró (`--only` no la toca).
4. `compositor-cancion.ts` depende de `silabasDeLinea` de `shared/src/music/letra.ts` (K2, aún sin commit): si K2 renombra, ajustar el import.

### K5 — Audio Doctor y StompLab (2026-10-29)

**Hecho (sin commit; binarios solo en carpetas `build_<slug>`, NO desplegados):**
- **Audio Doctor** (`plugins/com.jaswave.plugin.audio-doctor/`): `src/doctor_dsp.h` (motor sin SDK, sin asignaciones en `process`),
  `src/doctor_plugin.cpp` (procesador, controlador, editor), `tools/doctor_selftest.cpp`, `jaswave-plugin.json` (49 parámetros,
  9 `ai.intents`), `ui-layout.json`. Cadena: De-Clip → De-Click → De-Hum → Gate/Expander → STFT (De-Noise · De-Reverb ·
  Voice Isolator) → Air → Delta. Auto-Fix = disparador: al pulsarlo analiza ~3 s de audio, escribe los ajustes recomendados
  (`recomendar()`) como parámetros normales (también hacia el host con `outputParameterChanges`) y se apaga solo. Diagnóstico
  (ruido de fondo, hum 50/60 Hz y nivel, clics/s, % de recorte, reverberancia) en 7 parámetros de solo lectura (ids 120–126) para
  que la IA lo lea antes de decidir. Live Mic: latencia 92 muestras (1,92 ms a 48 kHz); el controlador llama a
  `restartComponent(kLatencyChanged)` al conmutarlo. Latencia normal 1752 muestras (36,5 ms).
  Estado del agente anterior: solo existían `doctor_dsp.h` y el selftest, con 12 de 25 comprobaciones en rojo. Correcciones
  de fondo hechas aquí: latencia declarada (el retardo real era N de la STFT y L del reparador, no N−salto ni L−1); De-Click
  contaba dos veces cada chasquido y sumaba ambos canales; De-Clip no detectaba topes planos exactamente en el umbral
  (tolerancia 0,5 %); De-Hum pasó de cascada de campanas (desplazaba 0,2 rad la fase a 1 kHz y ensuciaba el delta) a
  sustracción paralela de pasa-bandas con f0 refinada por interpolación parabólica (~0,05 Hz); estimador de ruido por mínimos
  calibrado (B ≈ 1,5·√(tramas/s), antes subestimaba ×8) con tope tonal (un tono sostenido ya no se toma por ruido) y medida
  del ruido de fondo por la mediana espectral (robusta a tonos); medidor de reducción = media por bin (un tono fuerte ya no lo
  oculta); la puerta del aislador de voz usa el mismo tope tonal.
  Selftest: **35/35** (`plugins/build_audio-doctor/tools/Release/JasWaveAudioDoctor_selftest.exe`; transparencia, De-Noise
  aprendido y continuo, De-Hum 50/60, De-Clip, De-Click sin falsos positivos, Gate, Delta, Auto-Fix, De-Reverb, Voice Isolator,
  estrés a 44,1 y 96 kHz con ajustes aleatorios y Live on/off, **cero asignaciones**, sin NaN).
- **StompLab** (`plugins/com.jaswave.plugin.stomplab/`): `src/stomp_dsp.h`, `src/stomp_plugin.cpp`, `tools/stomp_selftest.cpp`,
  `jaswave-plugin.json` (53 parámetros, 10 `ai.intents`), `ui-layout.json`. Cadena fija con fundidos de 10 ms por módulo:
  Gate → Compresor (blend paralelo) → [x2: Drive de 5 modelos → Preamp de válvulas 3 canales + pila de tonos + sag] → Cabina
  (FIR de 512 taps con IR sintéticas de fase mínima por cepstrum, 5 modelos + DI, fundido de 20 ms al cambiar) → Chorus →
  Delay (Stereo / Ping-Pong / Tape, realimentación saturada) → Shimmer (FDN de 8 líneas + octava +12 st en el lazo).
  Sobremuestreo x2 con medio banda de 31 taps, latencia fija de 15 muestras (0,31 ms) con cualquier combinación de módulos.
  Selftest: **43/43** (`plugins/build_stomplab/tools/Release/JasWaveStompLab_selftest.exe`; latencia medida con impulso,
  transparencia, gate, compresor, THD de los 5 modelos y DC, alias (55 dB bajo la fundamental a drive medio; con Fuzz extremo a
  7 kHz solo ~22 dB: límite del x2), EQ del preamp, las 5 IR frente a su respuesta de diseño (±1,5 dB), cambio de cabina en caliente,
  chorus, ecos y ping-pong, octava del shimmer, mix/bypass, estrés a 44,1 y 96 kHz con cola de realimentación máxima, cero asignaciones).
- Ambos: validator del SDK **47/47 sin fallos**; editor con la plantilla V3 (3 perillas + 3 interruptores + 6 celdas; el resto en
  la página PARÁMETROS) y capturas generadas con `<Plugin>_snapshot.exe --out <dir> --name <slug>`. Registrados en
  `plugins/CMakeLists.txt`, `scripts/sync-manifests.mjs` y `scripts/ui-layout.mjs` (`--check` y `--validar` en verde);
  `com.jaswave.modulo.editores-vst/src/generado/layouts.json` regenerado con `ui-layout.mjs --solo-web` (solo añade layouts).
  Añadidos a ENTREGADOS en `jas-wave/e2e/15-plugins-manifiesto.spec.ts`.

**Binarios:**
- `plugins/build_audio-doctor/VST3/Release/JasWaveAudioDoctor.vst3`
- `plugins/build_stomplab/VST3/Release/JasWaveStompLab.vst3`
Rehacer: `cmake -S plugins/com.jaswave.plugin.<slug> -B plugins/build_<slug> -G "Visual Studio 17 2022" -A x64`,
`cmake --build plugins/build_<slug> --config Release`, `plugins/build/bin/Release/validator.exe <.vst3>`.

**Pendiente:**
1. Desplegar con `plugins/deploy_vst3.ps1 -Build plugins/build_audio-doctor` y `-Build plugins/build_stomplab` cuando no haya
   e2e en curso. El e2e 15 exige el binario resuelto en una carpeta VST3 y fallará hasta entonces (mismo caso que Pedal Fix y
   Vocal Choir). Después cargarlos en el host real y **escucharlos**: la medición no sustituye al oído, sobre todo el sonido de
   los 5 drives, las cabinas y el shimmer, y De-Noise con material real (ruido de sala, voz).
2. La IA ya puede gobernarlos por manifiesto (`ai.parameters` con ids legibles, rangos y unidades; `ai.intents`), pero no hay
   habilidad/prompt específico ni recetas («guitarra worship limpia con shimmer», «limpiar voz de móvil»): añadirlas en el
   módulo asistente cuando K1 libere `habilidades-agentes.ts`. Para Auto-Fix la IA debe: activar `doctor.autofix`, reproducir
   ≥3,2 s y releer los parámetros (los ajustes aparecen como cambios de parámetro normales).
3. Limitaciones conocidas: sin carga de IR de usuario en la cabina (las 5 IR son sintéticas); sin sincronía al tempo en el
   delay de StompLab (tiempo libre en ms); el aliasing con saturación extrema es el propio del sobremuestreo x2 (subir a x4 si
   se quiere más margen a costa de CPU); el Auto-Fix escribe parámetros de salida hacia el host, que no todos los DAW aplican al
   controlador (en el host propio hay que comprobarlo); De-Hum con hum muy inestable en frecuencia (>0,5 Hz de deriva)
   atenúa menos.
4. No se actualizó el manual de usuario (`docs/manual-usuario/07-vst-e-instrumentos.md`) ni el catálogo web de plugins.
