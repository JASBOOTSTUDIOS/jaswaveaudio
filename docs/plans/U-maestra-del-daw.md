# U-maestra-del-daw — La IA como maestra del DAW (explicar, mostrar, guiar)

**Depende de:** M3/M4 (módulo asistente), P2 (registro de herramientas), K1 (panel «Mi estilo»), A3 (modos).
**Petición (resumen):** que la IA enseñe a usar el DAW (también a quien nunca lo usó), responda cualquier pregunta del
DAW, abra la pantalla correcta cuando el usuario pregunte «¿dónde lo hago?», y guíe lecciones tocando (primera:
«Enseñarme tu estilo tocando»). Aplica a todas las pantallas, paneles, herramientas y plugins.

Estado de este documento: **plan sin implementar**. Todo lo que se afirma como existente se comprobó en el código
(rutas citadas); lo marcado «no verificado» se debe comprobar al implementar.
## 0. Hallazgos clave (evidencia)
1. **Ya existe una vía programática para abrir paneles:** `requestOpenTool(toolId, {zone})` en
   `jas-wave/src/workspace/types.ts` (despacha `CustomEvent('jaswave-open-tool')`), reexportada al SDK
   (`jas-wave/src/modulos/api-host.ts:18`; `plugins/sdk/host-sdk/src/host-api.generated.ts:300`). El oyente está en
   `jas-wave/src/App.tsx:~308-326` (enfoca la pestaña, la crea en su zona por defecto, o abre la ventana si está
   desacoplada). También `requestToggleTool` (`jaswave-toggle-tool`).
2. **Catálogo único de herramientas:** `TOOL_CATALOG` (`types.ts`) = 20 herramientas del núcleo; los módulos añaden las
   suyas con `registrarHerramienta` (`DefinicionHerramienta` en `plugins/sdk/host-sdk/src/contrato.ts:14`). Tiene `title`
   y `description`, pero **no** «para qué sirve / cómo se usa / qué hay dentro».
3. **Los diálogos y menús NO están en ese catálogo.** Se abren por otros eventos: `jaswave-menu-action` con ids
   `archivo.*`, `ventana.*`, `proyecto.*` (`app-menu-bar.tsx` define ~50; `App.tsx:271` y `hooks/use-shortcut-dispatcher.ts:559`
   escuchan), `open-shortcuts-dialog`, `jaswave-nuevo-proyecto`, `open-project-settings`, `jaswave-focus-terminal`.
4. **Acciones de agente existentes:** `jas-wave/src/lib/agent-action-catalog.ts` (1191 líneas) solo tiene una acción de UI:
   `ui.setZoom`. No hay ninguna que abra/enfoque panel, diálogo o control. Los demás son comandos de proyecto.
5. **Selectores estables escasos:** `data-testid` solo en transporte (13), grooves (20), zonas MIDI (14), mezclador (5),
   timeline (≈17 en `arrangement/`), «Mi estilo» (7), diálogos de cierre/conflicto. **No hay** testids en piano roll,
   inspector, FX chain, biblioteca, instrumentos, ruteo, medidores, icon-rail (solo `aria-label`). `tool-host.tsx:56`
   marca `data-tool-viewport={toolId}`: base para localizar cualquier panel sin testid.
6. **Habilidades (skills) existen pero son por agente de banda:** `ai-harness/src/agente/habilidades.ts`
   (`H_LEER_HABILIDAD`, revelación progresiva, `MAX_LISTADAS=24`) y `motor/habilidades-agentes.ts`. En el chat normal el
   catálogo sale de `turno-agente.ts:290-340`: `herramientasIde` (incluye `leer_habilidad`) + `herramientasConfig` +
   `catalogoAgente`; el prompt de sistema lo arma `sistemaAgente(...)` (`ai-harness/src/agente/prompts.ts:23`) con
   `instruccionesExtra`. **Ese es el punto de inyección de la persona maestra.**
7. **Precedente de conversación guiada multi-turno:** `motor/turno/sesion-agente.ts` (`ModoSesion` meta/entrevista/
   configurar, persistido en localStorage por conversación) + `bloqueModo` en `turno-agente.ts:147` + chips de comando
   (`ui/chip-comando.tsx`, `jas-wave/src/lib/comandos-chat.ts`). Una sesión `leccion` encaja igual.
8. **Preguntas con opciones:** herramienta `preguntar` → `ClarificationCard` (`ui/clarification-card.tsx`,
   tipos en `jas-wave/src/lib/aclaraciones.ts`: `options`, `multi`, `allowCustom`).
9. **Manifiestos de plugin ricos:** cada `plugins/com.jaswave.plugin.*/jaswave-plugin.json` trae `description` y
   `ai: { summary, intents, parameters[] }` (id, name, min/max, unit, scale, `basico`, valores de enum). Ej.: param-eq 220
   parámetros. **El plugin `sampler` no tiene manifiesto** (solo `src/`, `tools/`) y los módulos no tienen `ai`.
10. **Discrepancia ya presente en docs:** el manual dice paleta `Ctrl+Shift+P` (`02-interfaz.md`), el menú dice `Ctrl+K`
    (`app-menu-bar.tsx:113`) y Electron `CmdOrCtrl+Shift+P` (`electron/main.ts:337`). La base de conocimiento debe
    generarse del código, no copiarse del manual, o heredará estas contradicciones.
## 1. Inventario de superficies (id → cómo abrir hoy → qué se hace)

Leyenda «Abrir hoy»: **T** = `requestOpenTool(id)`; **M** = `dispatchEvent('jaswave-menu-action',{detail:{id}})`;
**E** = evento propio; **—** = sin forma programática (solo clic/atajo del usuario). Zona = zona por defecto.
### 1.1 Herramientas del núcleo (`TOOL_CATALOG`, abren con T)

| id | Título / zona | Qué se hace allí |
|---|---|---|
| `arrange` | Arrange / centro | Línea de tiempo: pistas, clips, regla, marcadores, acordes/letra, tomas (`take-lanes-panel`), lazo de clips |
| `mixer` | Mixer / abajo | Faders, pan, M/S, sends, insertos (`channel-fx-bank`), medidores, lanes de automatización |
| `piano-roll` | Piano roll / abajo | Editar notas del clip MIDI (barra, velocity, carriles de expresión, transporte propio) |
| `library` | Biblioteca / izq. | Audio, samples, presets (proyecto/global) |
| `track-detail` | Inspector / der. | Propiedades de pista, canal y clip; entrada de audio/MIDI; añadir plugin |
| `meters` | Medidores / der. | Espectro, estéreo, LUFS, sync de timing; analizador de mezcla (`mix-analyzer-panel`) |
| `routing` | Ruteo / der. | Buses y envíos |
| `instruments` | Instrumentos / izq. | Catálogo de plugins e instrumentos; configuraciones (`instrument-configs-panel`) |
| `fx-chain` | FX Chain / der. | Cadena de efectos de la pista activa o Master; elegir plugin (`plugin-picker`) |
| `automation` | Automatización / — | Curvas vol/pan y write-on-play de la pista activa |
| `plugin-editor` | Editor de plugin / der. | Interfaz del instrumento/efecto activo (nativa o réplica web); barra de ventanas de plugin |
| `midi-map` | MIDI Learn / — | Asignar nota/CC/tecla a funciones del DAW |
| `midi-zones` | Zonas MIDI / — | Splits, capas y transposición del teclado para tocar en directo |
| `grooves` | Grooves / — | Biblioteca de ritmos MIDI de batería por estilo (+ barra de sincronía `grooves-sync-bar`) |
| `terminal` | Terminal / — | CLI del DAW (`ayuda`) y log de lo que ejecuta la IA; evento extra `jaswave-focus-terminal` |
| `settings` | Configuración / der. | Ajustes del proyecto (`project-settings-dialog`: audio, dispositivos, etc.) + páginas de módulos (p. ej. «IA») |
| `project-files` | Archivos / izq. | Explorador del proyecto estilo IDE |
| `cuenta` | Cuenta / der. | Sesión, licencia del equipo, catálogo de plugins, colaboración (`components/cuenta/*`) |
| `admin` | Administración | Abre JasWave Admin (app aparte; solo administradores) |
| `modulos` | Módulos | Activar/desactivar/descargar módulos opcionales (catálogo, instalar .jwx) |
### 1.2 Herramientas aportadas por módulos (también T, si el módulo está activo)

| id | Módulo | Qué se hace allí |
|---|---|---|
| `coproducer` | asistente-ia | Chat del asistente (panel izq., destacado). Contiene: modos, selector de modelo, `@agentes`, `/comandos`, tarjetas |
| `progress` | asistente-ia | Plan, bitácora, diffs y métricas (bajoDemanda) |
| `banda-virtual` (`HERRAMIENTA_BANDA`) | asistente-ia | Panel de la banda en vivo **y «Mi estilo»** (`<MiEstiloPanel/>` embebido en `banda-panel.tsx:18`) |
| `docs`, `docs-explorer` | documentos | Editor/vista de Markdown del proyecto; árbol de `docs/` |
| `midi-md` | midi-md | Clip MIDI como tabla Markdown sincronizada con el piano roll |
| `score-editor` | partitura | Partitura sincronizada al clip; vista previa y exporte PDF |
| (editor web de VST) | editores-vst | Réplica web de editores de plugin (no es herramienta propia; vive dentro de `plugin-editor`) |

«Mi estilo» **no es un panel propio**: no tiene id. Para «abrirlo» hay que abrir `banda-virtual` y resaltar
`[data-testid=mi-estilo-panel]`. Recomendación: dar a «Mi estilo» un id lógico en la ficha (`sub-panel de banda-virtual`).
### 1.3 Diálogos, menús y vistas que NO son herramientas

| id propuesto | Abrir hoy | Qué se hace allí |
|---|---|---|
| `dlg.nuevo-proyecto` | E `jaswave-nuevo-proyecto` / M `proyecto.nuevo` | Crear proyecto (`nuevo-proyecto-dialog`) |
| `dlg.abrir-proyecto` | M `proyecto.abrir` | Abrir proyecto (web: `proyectos-web-dialog`) |
| `dlg.exportar-bounce` | M `archivo.exportarBounce` | Exportar mezcla a audio (`export-bounce-dialog`) |
| `dlg.atajos` | E `open-shortcuts-dialog` / M `ventana.atajos` | Lista y edición de atajos (`shortcuts-dialog`) |
| `dlg.paleta` | M `ventana.paletaComandos` (Ctrl+K o Ctrl+Shift+P, ver §0.10) | Buscar y ejecutar acciones (`command-palette`) |
| `dlg.ajustes-proyecto` | E `open-project-settings` / M `ventana.ajustes` | Equivale a `settings` |
| `dlg.midi-map` | M `ventana.midiMap` | Atajo a MIDI Learn (`midi-map`) |
| `dlg.cierre`, `dlg.conflicto-guardado`, `dlg.media-faltante` | — (reactivos) | Se muestran solos ante cambios sin guardar, conflicto o archivos que faltan |
| `dlg.exportar-partituras` | M `archivo.exportarPartituras` / `...ProyectoConPartituras` | PDF de partitura (módulo partitura) |
| `zona.izq/der/inf` | E `jaswave-toggle-zone` {zone} | Mostrar/ocultar paneles laterales e inferior |
| `menu.archivo/editar/ver/transporte/acciones` | — (barra de menús, `app-menu-bar.tsx`) | Menús; sus ids `M` son la API |
| `barra.transporte` | — (siempre visible, `transport-bar.tsx`, 13 testids) | Play/stop/grabar/bucle/metrónomo/BPM/compás/count-in/punch |
| `barra.edicion` | — (`edit-toolbar.tsx`, montada en `App.tsx`) | Herramientas de edición del arrange |
| `barra.plugins` | — (`plugin-windows-bar.tsx`) | Ventanas de plugin abiertas |
| `rail` | — (`icon-rail.tsx`, `aria-label="Herramientas del workspace"`) | Cambiar de herramienta |
| `banner.*` | — (reactivos: dispositivo de audio, motor ocupado, crash del host, actualización) | Avisos con acción |
| `portal/web/handover` | — (`components/portal`, `web`, `handover`) | Activación, login, continuar en escritorio |

**Sin forma programática de abrirse hoy** (resumen): menús de la barra, barra de transporte/edición/plugins, rail,
diálogos reactivos, y cualquier control interno (botón, fader, menú contextual de clip/pista:
`ClipContextMenu.tsx`, `TrackContextMenu.tsx`, `TrackAddPluginButton.tsx`). Para ellos la «forma de abrir» será
resaltar (§3), no abrir. Los diálogos con evento/menú sí pueden abrirse (M/E) → entran al registro con `via`.
### 1.4 Plugins JasWave (`plugins/com.jaswave.plugin.*`; fuente: su `jaswave-plugin.json`)

Todos se cargan desde `instruments` / `fx-chain` / `track-detail` (botón añadir plugin) y se editan en `plugin-editor`
(también `ui-layout.json` por plugin: título, zonas). Nº de parámetros = `ai.parameters`.

| Plugin (carpeta) | Tipo | Para qué sirve | Parámetros |
|---|---|---|---|
| param-eq | efecto | EQ paramétrico dinámico hasta 24 bandas (tipo, frecuencia, ganancia, Q, activa) | 220 |
| bus-compressor | efecto | Compresor VCA de bus, rodilla suave, Peak/RMS, sidechain | 11 |
| truepeak-limiter | efecto | Limitador true-peak (8x, BS.1770-4), lookahead, dither | 7 |
| smart-deesser | efecto | De-esser de banda dividida o completa | 10 |
| utility-tool | efecto | Ganancia ±24 dB, fase, L/R, DC, ancho M/S, mono bajo | 10 |
| audio-doctor | efecto | Restauración: gate, denoise espectral, etc. | 49 |
| stomplab | efecto | Pedalera universal (gate, comp, overdrive 5 modelos…) | 53 |
| ambience | efecto | Rack worship: reverb FDN, delay, shimmer, swell, chorus | 7 |
| vocal-tune | efecto | Afinador automático (YIN + PSOLA) a escala/tónica | 13 |
| vocal-choir | efecto/instr. MIDI | Coro de hasta 4 voces controlado por MIDI | 19 |
| pedal-fix | efecto MIDI | Unifica pedal sustain/sostenuto/suave | 10 |
| audio-lens | efecto | Análisis descriptivo y beatbox→batería MIDI (puente IA) | 4 |
| roles-vst | instrumento | Instrumento por rol (batería, bajo, guitarra, piano, pad, cuerdas…) | 14 |
| worship-drums | instrumento | Batería con 6 kits reales + síntesis y percusión | 83 |
| grand-piano | instrumento | Piano de cola por modelado | 81 |
| piano-synth | instrumento | Piano de síntesis modal | 10 |
| electric-bass | instrumento | Bajo Precision/Jazz por guía de ondas | 78 |
| electric-guitar | instrumento | Guitarra worship (muestras + FX + cuerda modelada) | 95 |
| shimmer-pad | instrumento | Pad ambiental supersaw/wavetable | 86 |
| ambient-atmos | instrumento | Sostenido infinito, atmósferas y texturas | 99 |
| strings-section | instrumento | Sección de cuerdas legato | 78 |
| sampler | instrumento | **Sin manifiesto**: hay que crearlo (o excluirlo con motivo) | — |

Esta tabla se **regenera** (§2) desde los manifiestos; la de arriba es solo orientativa.
## 2. Conocimiento: qué hay, qué falta, cómo construir la base

**Existe:** `docs/manual-usuario/01..13` (~1800 líneas; interfaz, transporte, mixer, piano roll, VST, asistente, mezcla,
atajos, flujos, solución de problemas, terminal), `docs/GLOSARIO.md` (130 líneas), `docs/ia-comunicacion-daw/`
(interno para la IA, no para enseñar), `docs/ia/*` (arquitectura; **`claves.md` no se toca**), `docs/interfaz/ARQUITECTURA-UI.md`,
manifiestos de plugin con `ai.summary/intents/parameters`, descripciones de `TOOL_CATALOG`, ids y atajos del menú.

**Lagunas medidas** (menciones en manual+glosario): StompLab 0, Ambience 0, Audio Doctor 0, «Mi estilo» 0, Grooves 0,
Vocal Tune 1, Zonas MIDI 1. Faltan también: qué es un bus/envío/sidechain explicado a principiantes (el glosario da una
línea), el flujo de grabar una toma, qué hace cada panel «paso a paso», los módulos, cuenta/licencias, diálogo
de ajustes por secciones, contradicción de atajos (§0.10). El agente hoy no tiene **ninguna** herramienta de ayuda.
### 2.1 Diseño de la base (`kb`) — generada + prosa curada

Ubicación sugerida: nuevo módulo `ai-harness/src/ayuda/` (tipos, índice, búsqueda; sin dependencia de React) y datos en
`plugins/com.jaswave.modulo.asistente-ia/src/ayuda/` (fichas curadas) + generador en `jas-wave/scripts/generar-ayuda.mjs`.

**Ficha (`FichaAyuda`)**: `id` (p. ej. `panel:mixer`, `plugin:param-eq`, `concepto:bus`, `dialogo:exportar-bounce`,
`leccion:mi-estilo`), `tipo` (`panel|dialogo|menu|control|plugin|concepto|flujo|leccion`), `titulo`, `sinonimos[]`
(«mezclador», «consola», «faders»), `resumen` (1–2 frases, nivel principiante), `paraQue`, `comoSeUsa[]` (pasos),
`dondeEsta` (`abrir: {tool|menuAction|evento}`, `resaltar: [{selector,texto}]`), `relacionadas[]`, `docs[]` (ruta del
manual), `nivel` (`basico|intermedio|experto`), `origen` (`generado|curado`).

**Tres fuentes, una sola salida `ayuda.generada.json`:**
1. *Generado del código* (no editable a mano): `TOOL_CATALOG` + `registrarHerramienta` de módulos (id, título,
   descripción, zona), ids de menú de `app-menu-bar.tsx` con su atajo, manifiestos de plugin (resumen, `intents`,
   parámetros con `basico`, unidades, valores de enum), comandos de la paleta/acciones de `shared/src/actions`.
2. *Curado* (editable): `ayuda/curado/*.md` con frontmatter por ficha: explicaciones para principiantes, ejemplos y
   «por qué». Se parte del manual y del glosario (trozos por encabezado) para no empezar de cero.
3. *Manual*: se indexa por secciones (`##`) como fichas `tipo:flujo` de respaldo.

Las fichas curadas **se fusionan** con las generadas por `id`; el generador falla si una curada apunta a un id que ya no
existe. Salida versionada para que los tests sean deterministas.
### 2.2 Herramienta `consultar_ayuda`

`consultar_ayuda({ consulta: string, tipo?: ..., nivel?: ... })` → hasta 5 fichas ordenadas, con `resumen`,
`comoSeUsa`, `dondeEsta`, `relacionadas`. Búsqueda **por palabras, sin embeddings**: normalizar (minúsculas, sin acentos,
reutilizar `normal()` de `habilidades.ts`), sinónimos, puntuación por campo (título×5, sinónimos×4, resumen×2, cuerpo×1),
prefijos y tolerancia a plurales. Sin red; <5 ms. Clase de acción `read` (no pide confirmación). Se registra en
`herramientasIde()` (`motor/turno/herramientas-ide.ts`) junto a `leer_habilidad`, también disponible en modo solo lectura.
Los textos devueltos se tratan como datos no confiables según `ai-harness/src/agent/untrusted.ts` (los manifiestos de
terceros pueden traer texto arbitrario).
### 2.3 Sincronía con el código (que no se pudra)
- **Generación automática**: `npm run ayuda:generar` (script nuevo, invocado también por `verify` en modo
  `--comprobar`: regenera en memoria y compara con el JSON versionado).
- **Test que falla** (node:test en `jas-wave` o Vitest en `ai-harness`, ver §5): (a) cada id de `TOOL_CATALOG` y de
  herramientas de módulos tiene ficha **curada** con `resumen` y `comoSeUsa` no vacíos; (b) cada carpeta
  `plugins/com.jaswave.plugin.*` tiene manifiesto y ficha (el `sampler` hoy rompería el test: decisión explícita:
  crear manifiesto o lista de exclusión con motivo); (c) cada id de menú `M` tiene ficha o está en lista de exclusión;
  (d) cada selector de `resaltar` declarado existe como `data-testid` en el código fuente (grep estático, sin montar UI);
  (e) los atajos citados coinciden con `app-menu-bar.tsx`/`electron/main.ts` (detecta §0.10).
- Un panel/plugin nuevo sin ficha ⇒ `npm test` rojo con mensaje «falta ficha de ayuda para X: crea ayuda/curado/X.md».
## 3. Acción «mostrar» (solo UI, nunca mutan el proyecto)
### 3.1 Herramientas del agente

| Herramienta | Entrada | Efecto |
|---|---|---|
| `abrir_pantalla` | `{ id }` (id de ficha: `panel:*`, `dialogo:*`) | Resuelve `dondeEsta.abrir` y llama a `requestOpenTool` (T), o `jaswave-menu-action` (M), o el evento (E). Devuelve `{abierto, motivo}`. Para ids sin vía programática responde «no puedo abrirla; está en <menú>» y ofrece `resaltar`. |
| `resaltar` | `{ elemento, texto, duracionMs? }` (`elemento` = id lógico de la ficha o `testid`) | Halo + flecha + globo («Aquí haces X») sobre el control; si el panel no está visible, lo abre primero. Se quita al hacer clic, Esc, pasar `duracionMs` (def. 12 s) o nuevo resaltado. |
| `guiar_paso_a_paso` | `{ leccionId? , pasos:[{texto, abrir?, resaltar?, hastaQue?}] }` | Cola de pasos; cada uno abre/resalta y avanza cuando se cumple `hastaQue` (§3.3) o el usuario pulsa «Siguiente». Persistente: se puede pausar y retomar. |

Las tres con clase de acción nueva `ui` (solo UI). **Política** (`ai-harness/src/agent/action-policy.ts`, fail-closed):
`ui` permitida en todos los modos (también solo lectura y «preguntar»), sin confirmación, **no pasan por
`tienda.executor.execute`** (AGENTS.md: mutaciones del proyecto = comandos; esto no muta proyecto) y no escriben
undo/auditoría de proyecto, pero sí quedan en la bitácora de la actividad del chat. Validaciones: `id` debe existir en
la KB (no se aceptan selectores arbitrarios del modelo → evita inyección de selectores y halos fuera de sitio); texto
≤ 140 caracteres; límite de 1 resaltado activo y de 3 aperturas por turno; jamás hacen clic ni escriben por el usuario.
### 3.2 Dónde engancharlo en el host
- **Registro de resaltado en el núcleo** (nuevo `jas-wave/src/lib/guia-ui.ts`): API `resaltarElemento({selector,texto})`,
  `limpiarResaltado()`, estado en un store pequeño; componente `<CapaGuia/>` montado una vez en `App.tsx` (junto a otros
  globales: `useComponentesGlobales`, `contribuciones.ts`). Calcula el `getBoundingClientRect` del destino, reintenta
  hasta 2 s si el panel aún monta, repinta con `ResizeObserver` y desaparece si el nodo se va. Se pinta con `pointer-events:
  none` (no bloquea el uso). Respeta `prefers-reduced-motion`.
- **Exposición al módulo por el SDK:** añadir `abrirPantalla`, `resaltar` a `jas-wave/src/modulos/api-host.ts` (y
  regenerar `host-api.generated.ts`/`tipos-host` con el generador existente del SDK; no editar a mano). `requestOpenTool`
  ya está exportada. Resolver `via M/E` dentro del host (un `abrir-pantalla.ts` con una tabla `id → {tool|menu|evento}`
  generada de la KB), no en el módulo.
- **Selectores estables:** convención `data-ayuda="<id-ficha>"` (o `data-testid`) en cada control que la KB nombre.
  Fase de trabajo: añadir atributos a los controles clave (transporte ya tiene testids; faltan piano roll, inspector,
  FX chain, instrumentos, biblioteca, ruteo, medidores, rail, menú contextual). Fallback para paneles sin testid:
  `[data-tool-viewport="<toolId>"]` (ya existe en `tool-host.tsx:56`) resalta el panel entero.
- **Detección de pasos (`hastaQue`)**: tipos declarativos, no código del modelo:
  `{evento:'tool-abierta', id}` (oyente del propio `jaswave-open-tool`/estado de `workspace-context`),
  `{dominio:'<nombreEvento>'}` (suscripción al `busEventos` de `shared/src/events/event-bus.ts`; los comandos del
  ejecutor emiten eventos de dominio: p. ej. pista creada, nota creada, clip creado), `{estado:'<predicado nombrado>'}`
  (predicados sobre `tienda.obtenerEstado()` vía `tienda.suscribir`: «hay una pista MIDI armada», «hay clip con ≥N notas»,
  «transporte grabando»), `{clic:'<id>'}` (delegación de eventos en el elemento resaltado), `{manual:true}`. Catálogo
  de predicados cerrado y probado (`guia-predicados.ts`); el modelo solo elige nombres.
  Nombres exactos de eventos de dominio: **no verificado**; confirmar en `shared/src/events/schemas-eventos.ts` al
  implementar y escribir un test que enumere los usados.
- **Chat:** el resultado de `guiar_paso_a_paso` se pinta como tarjeta fija (`ui/guia-card.tsx`: «Paso 2/6 · texto ·
  Saltar · Salir · ¿Dónde es?») cerca del input; patrón visual de `agent-checklist-card.tsx`/`clarification-card.tsx`.
- **Web vs escritorio:** `abrir_pantalla` de ventanas desacopladas usa `window.electron.openToolWindow` (ya lo hace el
  oyente de `jaswave-open-tool`); en web no hay desacople: la KB no debe prometerlo.
## 4. Persona y pedagogía: «maestra del DAW»
### 4.1 Cómo se enruta hoy y dónde se inyecta

El chat normal (no banda) corre en `motor/turno/turno-agente.ts`; la banda en `turno-banda.ts` (aparte: no tocar). En
`turno-agente.ts` ~l.290-340 se arman catálogo y `sistemaAgente({... instruccionesExtra})`. Plan:
1. **Detección de intención de enseñanza** (`pideAprenderDaw(texto)`, como `pideConfigurar`/`pideAprender`): preguntas
   «cómo/dónde/qué es/para qué sirve/no sé/enséñame/explícame/guíame/¿dónde lo hago?», o modo de sesión `leccion`.
2. **Bloque de persona** `bloqueMaestra(nivel, sesion)` añadido a `instruccionesExtra` solo cuando aplica (no contaminar
   los turnos de producción) y la habilidad de serie `maestra-del-daw` como habilidad **del chat** (hoy las de serie
   son por rol de banda: `habilidadesBasePorRol`; hace falta un grupo «chat/general» o registrarla en
   `habilidadesDisponibles()`; verificar cuál al implementar).
3. **Herramientas**: `consultar_ayuda`, `abrir_pantalla`, `resaltar`, `guiar_paso_a_paso`, `preguntar` siempre en
   catálogo cuando hay intención de enseñanza (menos tokens que ofrecerlas siempre; `buscar_herramientas` ya las puede
   descubrir).
4. **Memoria de nivel**: preferencia `nivelUsuario` (`principiante|intermedio|experto`) guardada con la vía de `aprender`
   (reglas del proyecto) o `ai-settings`; se pregunta una vez («¿Has usado un DAW antes?» con chips) y se puede
   cambiar con «háblame más técnico».
5. **Comando** `/enseñar [tema]` y `/leccion [id]` en `jas-wave/src/lib/comandos-chat.ts` + chip en `chip-comando.tsx`
   (icono `GraduationCap`, ya usado por «Aprender»; usar otro, p. ej. `BookOpen`), sesión `leccion` en
   `sesion-agente.ts`.
### 4.2 Reglas de la maestra (contenido de `maestra-del-daw`)
- **Responder primero, mostrar después**: contesta la duda en 2–4 frases; luego ofrece «¿Te lo muestro?» con chips
  (Sí, muéstramelo · Guíame paso a paso · Solo explícame más). Nunca abre/resalta sin ofrecerlo, salvo que el usuario
  haya pedido «¿dónde lo hago?» (ahí abre y resalta directamente).
- **Niveles**: *principiante* (nunca usó un DAW): vocabulario cotidiano, analogía (mezclador = consola de sonido de la
  iglesia; bus = «un canal donde mandas varias pistas para subirles/bajarles el volumen juntas»), un concepto por
  mensaje, ejemplo concreto en su proyecto, comprobar comprensión con una pregunta corta. *Intermedio*: pasos y atajos.
  *Experto*: respuesta directa, parámetros y valores, sin analogías.
- **Diagnóstico**: si la pregunta es ambigua o el nivel es desconocido, **una** pregunta con opciones
  (`preguntar` → `ClarificationCard`), nunca varias a la vez; recomendar la opción más útil.
- **Explicar el porqué** (para qué sirve, qué se oye si se cambia) antes del cómo.
- **Honestidad**: si la KB no tiene la respuesta, decirlo y no inventar rutas de menú ni atajos (`feedback`: «reportar
  fallos tal cual»). Si algo no se puede abrir por código, decir dónde está y resaltar.
- Español sencillo, sin ids ni JSON (regla 10 ya existente en `sistemaAgente`).
- **Respeto de los campos del usuario**: la maestra nunca escribe en cajas del usuario ni cambia ajustes; solo muestra.
- Música humana (memoria del usuario): al enseñar a grabar, fomentar tocar de verdad, variar secciones y no «cuadrar».
### 4.3 Lecciones (formato y primeras)

Formato `ayuda/lecciones/<id>.md` con frontmatter (`id`, `titulo`, `nivel`, `duracion`, `requiere`) y pasos con
`texto`, `abrir`, `resaltar`, `hastaQue`, `pregunta` (opcional). Se registran como fichas `tipo:leccion` y el test de §2.3
valida que cada `abrir/resaltar/hastaQue` exista. Primeras: `recorrido-inicial` (rail, transporte, arrange, mixer),
`primera-pista-midi`, `cargar-un-plugin`, `mezclador-y-buses`, `grabar-una-toma`, `exportar-mi-cancion`,
`ensenar-mi-estilo` (siguiente).
### 4.4 Lección «Enseñarme tu estilo tocando» (`ensenar-mi-estilo`)

Contexto real: `ui/mi-estilo-panel.tsx` (dentro de `banda-virtual`) hace: «Analizar mi toque» (`analysis.performance`
con `source:'user_confirm'`, informe de la toma o últimos segundos) → nombre → «Guardar como skill de estilo»
(`style.touch.learn` + `guardarEstiloComoHabilidad` → `habilidades/estilo-<slug>.md`) → lista con activar/desactivar
(`activarEstilo`). La skill la usa la banda al terminar cada músico. Las ayudas de prefijo/slug: `PREFIJO_ESTILO`,
`rutaHabilidadEstilo` (`habilidades-agentes.ts`).

Flujo (cada paso = una tarjeta de aclaración con chips + acción de mostrar; **la lección nunca graba ni guarda por el
usuario**: el usuario toca y pulsa; la maestra solo abre/resalta/explica):
1. **Bienvenida y objetivo** (por qué: «la banda tocará con tus giros, no genérica»). Pregunta de nivel si falta.
2. **Instrumento y manos** — `preguntar` (opciones: Piano/teclado, Sintetizador/pad, Órgano, Otro; Mano derecha, Mano
   izquierda, Ambas). Define dónde se recomienda la pista (zonas MIDI si toca dividido: `midi-zones`).
3. **Qué secciones grabar** — `preguntar` multi (Verso, Coro, Puente, Intro/Interludio, Adornos/llenos, Transiciones).
   Pide **tomas separadas y de ~16–32 compases por sección**, tocando como en la iglesia, con el tempo del proyecto
   (la maestra sugiere activar metrónomo y cuenta previa; explica por qué).
4. **Armar la pista** — `abrir_pantalla('arrange')` + `resaltar` en «Nueva pista MIDI» (menú `acciones` →
   `pista.nuevaMidi`, M) y en armar grabación; `hastaQue: estado 'hay pista MIDI armada'`. Si no hay teclado MIDI
   conectado, explicar `midi-map`/dispositivos (resaltar Ajustes) en vez de seguir.
5. **Instrumento sonando** — `abrir_pantalla('instruments')`, elegir plugin (p. ej. grand-piano) para oírse;
   `hastaQue: dominio plugin insertado` (verificar evento exacto).
6. **Grabar la toma** — resaltar `transport-bar` (grabar/count-in); `hastaQue: estado 'transporte grabando'` y luego
   `'clip MIDI con ≥8 notas'`. Repetir por cada sección elegida (nombrar clip/toma por sección). Mensaje de ánimo +
   recordatorio «toca natural».
7. **Abrir «Mi estilo»** — `abrir_pantalla('banda-virtual')` + `resaltar mi-estilo-analizar`; `hastaQue: clic`.
   Explicar que analiza tempo/duraciones/velocidades/adornos (sin inventar: qué mide es el informe).
8. **Revisar el informe** — leer `mi-estilo-informe` (no se tiene API; opciones: añadir evento de «informe listo»
   desde el panel, o que la maestra ejecute la lectura de `analysis.performance` con herramienta de lectura) y explicar
   en lenguaje llano 3–4 hallazgos (p. ej. «tocas notas largas y pocas en la izquierda»). Preguntar «¿se parece a como
   tocas?»: chips Sí / Algo no cuadra (volver a grabar esa sección) / Quiero comparar.
9. **Guardar** — resaltar `mi-estilo-nombre` (sugerir nombre) y `mi-estilo-guardar`; `hastaQue: ` skill guardada
   (evento `EVENTO_CARPETA_ASISTENTE` ya existe y se dispara al cambiar la carpeta; úsese como señal). Confirmar que
   quedó `habilidades/estilo-<nombre>.md` y activa (`mi-estilo-item data-activo`).
10. **Cierre y siguiente paso** — cómo usarlo («/banda tema …»), cómo desactivarlo, y ofrecer repetir con otra mano o
    sección. Registrar en la memoria del proyecto que el usuario completó la lección.

Lagunas a cubrir para esta lección: varias tomas por sección se analizan hoy como «la toma o los últimos segundos»
(**no verificado** si acumula varias secciones en un solo perfil: revisar `analysis.performance`/`style.touch.learn`
y decidir si el perfil es por sección, o la lección guarda un `estilo-*.md` por sección o pide una única toma
representativa).
## 5. Verificación

**Unitarias (sin UI)** — `ai-harness` (Vitest) y `asistente-ia/test` (tsx):
- KB: índice y búsqueda (sinónimos, acentos, plural; «mezclador», «consola», «bus» → fichas esperadas); fusión
  generado+curado; fallo ante id huérfano; tests de sincronía de §2.3 (a–e).
- Acciones de UI: `abrir_pantalla` resuelve cada id de la KB a T/M/E válido; id desconocido → error claro; `resaltar`
  rechaza selectores que no vienen de la KB; clase `ui` permitida en modos solo lectura y no toca el ejecutor (test
  que verifica que el historial de undo no cambia).
- `guiar_paso_a_paso`: máquina de pasos (avanza al cumplirse `hastaQue`, salta, pausa, reanuda tras recargar).
- Persona: el bloque `bloqueMaestra` aparece solo con intención de enseñanza (prueba de `turno-agente` con motor
  mock, patrón de `chat-agente.test.ts`/`agent-engine-host.test.ts`).

**Lógica de UI en Node (`node:test`)**: `jas-wave/src/lib/guia-ui.test.ts` (cálculo de posición, reintentos, limpieza).

**E2E Playwright** (`jas-wave/e2e/NN-maestra.spec.ts`, lanzar con **`-c e2e/playwright.config.ts`**; sin él hay timeout
de 30 s en silencio): (1) «¿dónde está el mezclador?» → panel `mixer` visible y halo presente
(`[data-ayuda-halo]`); (2) `abrir_pantalla('grooves')` abre el panel; (3) la lección avanza al crear una pista MIDI
real; (4) «Mi estilo»: abrir y resaltar `mi-estilo-analizar`. Con modelo mock (como los e2e existentes) para determinismo,
y una pasada con el **modelo real** (prioridad del usuario) registrando transcripciones. No escribir en el chat del
usuario ni cambiar sus ajustes: usar proyecto temporal y perfil aislado (patrón del e2e 29).

**Medir que la maestra responde bien** — conjunto de evaluación `ai-harness/src/test/fixtures/maestra-preguntas.json`
(~40 preguntas: «¿cómo cargo un plugin?», «¿dónde está el mezclador?», «no sé qué es un bus», «¿qué hace el
compresor?», «¿cómo exporto?», «¿qué es el sidechain?», lagunas de §2). Para cada una: respuesta esperada = fichas que
debe consultar (`consultar_ayuda` llamada con resultado correcto), acción de mostrar esperada (`abrir_pantalla:mixer`),
**términos prohibidos** (ids, JSON, números MIDI), y rúbrica con modelo juez (¿correcta?, ¿al nivel?, ¿honesta si no
sabe?, ¿ofrece mostrar?). Métricas: acierto de ficha (≥90 %), acierto de pantalla (100 % en ids con vía programática),
0 rutas/atajos inventados (cotejar con el menú), tasa de «¿te lo muestro?» en preguntas de «cómo». Principio del
usuario: **la medición manda**; reportar fallos tal cual, sin retocar la rúbrica para que pase.
## 6. Fases, esfuerzo, dependencias y archivos

Esfuerzo relativo: S=1, M=3, L=5.

| Fase | Contenido | Esf. | Depende | Archivos (propios; no se solapan con otras fases) |
|---|---|---|---|---|
| F1 | Esquema de ficha, índice, búsqueda, `consultar_ayuda` + tests | M | — | nuevos: `ai-harness/src/ayuda/*`, `ai-harness/src/test/ayuda-*.test.ts`; edita solo `ai-harness/src/index.ts` (export) |
| F2 | Generador desde `TOOL_CATALOG`, menús, manifiestos, acciones + JSON versionado + test de sincronía | M | F1 (esquema) | nuevos: `jas-wave/scripts/generar-ayuda.mjs`, `plugins/com.jaswave.modulo.asistente-ia/src/ayuda/generada/*`; test en `asistente-ia/test/ayuda-sincronia.test.ts`; `package.json` raíz (script) |
| F3 | Fichas **curadas** (principiante) de las 20+7 herramientas, diálogos, 21 plugins, conceptos (bus, envío, sidechain, compresor, EQ, cuantizar, velocity…); resolver laguna §2; manifiesto de `sampler` | L | F1 esquema | nuevos: `.../src/ayuda/curado/*.md` (muchos archivos, divisibles por zona); `plugins/com.jaswave.plugin.sampler/jaswave-plugin.json` |
| F4 | Capa de guía en el host: `guia-ui.ts`, `<CapaGuia/>`, `abrir-pantalla.ts`, exposición en `api-host.ts` + regeneración de tipos del SDK | M | F1 esquema | `jas-wave/src/lib/guia-ui*.ts`, `jas-wave/components/capa-guia.tsx`, `jas-wave/src/modulos/api-host.ts`, `plugins/sdk/host-sdk/src/host-api.generated.ts` (generado), `jas-wave/src/App.tsx` (1 línea de montaje) |
| F5 | `data-ayuda`/`data-testid` en controles clave (piano roll, inspector, FX chain, instrumentos, biblioteca, ruteo, medidores, rail, diálogos) | M | F3 (lista de controles) | `jas-wave/components/*.tsx` (muchos, solo atributos). **Conflicto potencial con cualquier trabajo de UI en curso**: coordinar por archivo |
| F6 | Herramientas del agente `abrir_pantalla`, `resaltar`, `guiar_paso_a_paso`, clase `ui` en la política, predicados `hastaQue`, tarjeta de guía | L | F2, F4 | `ai-harness/src/agent/action-policy.ts`, `asistente-ia/src/motor/turno/herramientas-ayuda.ts` (nuevo), `.../turno/herramientas-ide.ts` (registro), `.../src/ui/guia-card.tsx`, `.../src/motor/guia-pasos.ts`, `jas-wave/src/lib/guia-predicados.ts` |
| F7 | Persona: `bloqueMaestra`, habilidad `maestra-del-daw`, nivel del usuario, `/enseñar`, sesión `leccion`, chip | M | F2 (herramientas disponibles en F6 para probarla completa) | `.../turno/turno-agente.ts` (**archivo caliente**), `.../turno/sesion-agente.ts`, `.../ui/chip-comando.tsx`, `jas-wave/src/lib/comandos-chat.ts`, `.../src/motor/habilidades-agentes.ts` |
| F8 | Lecciones: formato + `recorrido-inicial`, `primera-pista-midi`, `cargar-un-plugin`, `mezclador-y-buses`, `grabar-una-toma`, `exportar` | M | F5, F6, F7 | `.../src/ayuda/lecciones/*.md` |
| F9 | Lección `ensenar-mi-estilo` (+ eventos/hook mínimos en `mi-estilo-panel.tsx` si se necesitan señales de «informe listo»/«guardado») | M | F8 (formato), F6 | `.../src/ayuda/lecciones/ensenar-mi-estilo.md`, `.../src/ui/mi-estilo-panel.tsx` (añadir atributos/eventos solamente) |
| F10 | Evaluación: fixture de preguntas, juez, e2e Playwright, informe de resultados | M | F6, F7 (F9 para su e2e) | `ai-harness/src/test/fixtures/maestra-preguntas.json`, `jas-wave/e2e/NN-maestra.spec.ts`, script de evaluación |
| F11 | Docs: ampliar manual con lagunas (StompLab, Ambience, Audio Doctor, Mi estilo, Grooves…), glosario, corregir atajos §0.10 | S | F3 | `docs/manual-usuario/*`, `docs/GLOSARIO.md` (nunca `docs/ia/claves.md`) |

**Orden recomendado y paralelismo:**
- Ola 1 (en paralelo, sin pisarse): **F1** (ai-harness) ‖ **F4** (host/SDK) ‖ **F11** (docs).
- Ola 2: **F2** y **F3** (F3 en 3 agentes por zonas: paneles / plugins / conceptos, archivos distintos) ‖ **F5** (UI;
  solo si no hay otro trabajo en `jas-wave/components`).
- Ola 3: **F6** ‖ **F7** — ojo: ambos tocan `herramientas-ide.ts`/`turno-agente.ts`; asignar `turno-agente.ts` solo a
  F7 y que F6 exponga una función `herramientasAyuda()` que F7 consume (un solo punto de integración).
- Ola 4: **F8** → **F9**; **F10** al final y también tras cada ola con el subconjunto disponible.
- **MVP útil** (menor esfuerzo, ya resuelve «¿dónde lo hago?»): F1 + F2 + curado mínimo de paneles + `abrir_pantalla`
  (sin halo) + F7 reducido. `resaltar`/lecciones se añaden después.

Camino crítico: F1 → F2 → F6 → F7 → F8/F9 → F10.
## 7. Riesgos y decisiones abiertas
1. **Selectores inestables / UI cambiante**: la mayoría de controles no tiene testid; sin F5 el resaltado solo llega a
   nivel panel. Mitigación: test estático (§2.3-d) y fallback `data-tool-viewport`.
2. **Alucinación de rutas/atajos**: la KB debe ser la única fuente; prompt prohíbe inventar; el eval cuenta los inventos.
3. **Coste de tokens**: no volcar la KB en el prompt; revelación progresiva (`consultar_ayuda`) y bloque de persona solo
   con intención de enseñanza.
4. **Contradicciones documentales** (atajo de la paleta): resolverlas en F11 o la KB las propagará.
5. **Conflicto de archivos**: `turno-agente.ts` y `jas-wave/components/*` son calientes; hay una prueba e2e larga y
   cambios locales ajenos en curso (`git status`). No usar `git stash`; coordinar por archivo.
6. **Diálogos sin API**: varios solo se abren con menú/evento y su estado vive en `App.tsx` (`setExportOpen`). Aceptable
   vía `jaswave-menu-action`; si se quiere más, exponer un registro `abrirDialogo(id)` (decisión: no ahora).
7. **Lección «mi estilo»**: dudas sobre perfil por sección y falta de señal de «informe listo» (ver §4.4).
8. **Seguridad**: textos de manifiestos/habilidades de terceros son datos no confiables; `resaltar` no acepta selectores
   del modelo; las acciones `ui` jamás mutan proyecto ni pulsan por el usuario.
