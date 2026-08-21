# State Model

## Objetivo
Crear el modelo de estado centralizado, serializable y lógicamente inmutable del DAW. El estado es la única fuente de verdad; la UI es solo una proyección visual.

## Criterios de Aceptación
- [x] DAWState serializable a JSON sin pérdida
- [x] Inmutabilidad lógica garantizada
- [x] Separación UI/Proyecto
- [x] Tipado estricto TypeScript

## Estado de Implementación

### 1. Estado Centralizado
- [x] `DAWState` como interfaz raíz en `shared/src/types/state.ts`
  - [x] `project: ProjectState`
  - [x] `transport: TransportState`
  - [x] `selection: EstadoSeleccion`
  - [x] `ui: UIState`
  - [x] `atajos: ConfiguracionAtajos`
  - [x] `capabilities: CapabilityRegistry`
  - [x] `commandStack: CommandStack`
  - [x] `busEventos: EventoDominio[]`
  - [x] `contextoIA: ContextoIA`
  - [x] `cache: Cache`
  - [x] `proxies: Proxy[]`
  - [x] `historial: Historial`
  - [x] Campos de metadatos extendidos: `marcaTiempo`, `version`, `esquemaVersion`, `dispositivoId`, `sesionId`, `usuarioId`, `organizacionId`, `modoColaboracion`, `sincronizado`, `ultimaSincronizacion`, `checksum`, `tamanioBytes`, `etiquetas`, `notas`, `plantillaId`, `presetId`, `temaId`, `idioma`, `zonaHoraria`, `marcaTiempoInicio`, `tiempoTotalUsoMs`
  - [x] Objetos anidados: `estadisticasUso`, `rendimiento`, `configuracionAvanzada`, `extensiones`, `logs`, `snapshots`, `migraciones`, `validaciones`, `comparaciones`, `contexto`
- [x] Snapshots y variantes: `DAWStateSnapshot`, `DAWStatePartial`, `DAWStateDiff`
- [x] Ciclo de vida: `DAWStateMigration`, `DAWStateValidation`, `DAWStateMetrics`
- [x] Operaciones: `DAWStateExport`, `DAWStateImport`, `DAWStateClone`, `DAWStateReset`
- [x] Observabilidad: `DAWStateWatch`, `DAWStateChange`
- [x] El estado vive en `shared/src/types/state.ts`; no hay estado disperso en componentes de UI.
- [x] Consultas sin efectos secundarios mediante `DAWQuery` en `shared/src/types/query.ts`

### 2. ProjectState
- [x] `ProjectState` en `shared/src/types/proyecto.ts` con:
  - [x] `id: string` — UUID del proyecto
  - [x] `nombre: string`
  - [x] `ruta?: string` — ruta del archivo del proyecto
  - [x] `sampleRate: number`
  - [x] `bitDepth: number`
  - [x] `bpm: BPM`
  - [x] `timeSignature: TimeSignature`
  - [x] `timeline: TimelineState`
  - [x] `tracks: Track[]`
  - [x] `routing: RoutingMatrix`
  - [x] `master: MasterChannel`
  - [x] `analysis: ProjectAnalysis`
  - [x] `metadata: ProjectMetadata`
- [x] Configuración extendida: `ConfiguracionProyecto`, `ConfiguracionRenderizado`
- [x] Estadísticas: `EstadisticasProyecto`
- [x] Colaboración: `ColaboracionProyecto`
- [x] Versionado: `VersionProyecto`, `ComparacionProyecto`
- [x] Validación: `ValidacionProyecto`
- [x] Referencia a plantilla: `Plantilla` (desde `entidades.ts`)
- [x] Todo serializable a JSON mediante `Serializable` en `shared/src/types/serializable.ts`

### 3. Tipos de Tracks
- [x] Discriminated union `Track` en `shared/src/types/tracks.ts`:
  - [x] `AudioTrack` — clips de audio, input opcional
  - [x] `MidiTrack` — clips MIDI, input/output opcionales
  - [x] `InstrumentTrack` — clips MIDI, instrumento plugin
  - [x] `FolderTrack` — children (IDs de tracks)
  - [x] `BusTrack` — receives (IDs de tracks que envían)
  - [x] `VcaTrack` — tracks vinculadas, modo DCA follower
  - [x] `GroupTrack` — hijos, modo grupo
  - [x] `MasterTrack` — limitador, monitoreo, dither, normalización
- [x] `BaseTrack` con: id, nombre, color, silenciada, soloActiva, armada, volumen, paneo, automatizaciones, plugins, envios, metadatos, configuracion, estadisticas
- [x] Type guards: `esTrackAudio`, `esTrackMidi`, `esTrackInstrumento`, `esTrackCarpeta`, `esTrackBus`, `esTrackVCA`, `esTrackGrupo`, `esTrackMaster`
- [x] Helpers: `puedeGrabar`, `puedeArmar`, `puedeSolo`, `puedeMute`, `puedeFrozen`, `puedeRecibirEnvio`, `puedeEnviar`, `puedeTenerPlugins`, `puedeTenerAutomatizacion`, `puedeTenerClips`, `puedeTenerHijos`, `puedeTenerVinculados`

### 4. Clips
- [x] `AudioClip` en `shared/src/types/clips.ts` — id, trackId, nombre, inicio, duracion, clipInicio, source, fadeIn?, fadeOut?, color, waveform?, tipo, warp, velocidad, inverso, datos
- [x] `MidiClip` — id, trackId, nombre, inicio, duracion, notas[], velocidadGlobal, cuantizacion, loop, datos
- [x] `MidiNote` — id, pitch (0-127), velocidad (0-127), inicio, duracion, canal (0-15), presion, seleccionada
- [x] `Fade` en `shared/src/types/entidades.ts` — id, clipId, tipo, duracion, curva

### 5. Inmutabilidad Lógica
- [x] El estado es lógicamente inmutable dentro de la capa de dominio.
- [x] Las mutaciones producen nuevas referencias de estado mediante structural sharing.
- [x] El Command System es el único responsable de aplicar mutaciones:
  - [x] Tipos en `shared/src/types/command.ts`: `Command`, `CommandDefinition`, `StateTransition`, `CommandResult`, `CommandStack`
  - [x] Implementación runtime en `shared/src/state/ejecutor-comandos.ts`: `CommandExecutor` con pipeline de validación, ejecución y emisión de eventos
  - [x] Undo/Redo stack en `shared/src/state/pila-deshacer-rehacer.ts`
  - [x] Helpers legacy en `shared/src/types/command.ts`: `ejecutarComando`, `deshacerComando`, `rehacerComando`
- [x] La capa de dominio NUNCA muta el estado directamente.

### 6. Serialización
- [x] Interfaz `Serializable` en `shared/src/types/serializable.ts` con `toJSON(): ValorJSON` y `fromJSON(json: ValorJSON): Serializable`
- [x] TODO el estado del proyecto es serializable a JSON.
- [x] Excepciones permitidas (no serializar):
  - Buffers de audio (binarios, referenciados por ruta o clave de cache)
  - Estado DSP interno de plugins (serializado como blob por el host)
  - Waveforms de runtime (recomputados desde datos de audio)
  - Buffers de análisis en vivo (transitorios)
- [x] Helpers: `serializar<T>`, `deserializar<T>`

### 7. Separación UI/Proyecto
- [x] `UIState` en `shared/src/types/ui.ts` forma parte de `DAWState` pero separada de datos del proyecto:
  - [x] Layout: `layout: PanelLayout`, `panelesDesacoplados: PanelPosicion[]`, `panelMinimizados: string[]`
  - [x] Paneles: `vistaSidebar`, `vistaPanelInferior`, `vistaPanelDerecho`, `panelActivo`, `ultimoFoco`
  - [x] Navegación: `scrollX`, `scrollY`, `zoomHorizontal`, `zoomVertical`, `playheadVisible`
  - [x] Herramienta: `herramientaActiva: HerramientaActiva`, `modoEdicion: ModoEdicion`
  - [x] Temas: `tema: Tema`, `idioma: string`
  - [x] Diálogos: `dialogoActivo`, `paletaComandosAbierta`, `tooltip`
  - [x] Carga: `cargaProgreso`, `etiquetaEstado`
  - [x] Búsqueda: `busquedaAbierta`, `busquedaTexto`
  - [x] Atajos: `atajosPersonalizados: Record<string, string>`
  - [x] Drag & Drop: `arrastrando`, `estadoArrastre: EstadoArrastre`
  - [x] Timeline UI: `estadoLineaTiempoUI`, `configuracionCuadricula`, `viewport`
  - [x] Editor DAW: `estadoEditorDAW`, `pestanas: PestanaEditor[]`, `pestanaActivaId`
  - [x] Mezclador UI: `estadoMezcladorUI`
  - [x] Contexto: `estadoMenuContextual`, `estadoPaletaComandos`
  - [x] Accesibilidad: `configuracionAccesibilidad`
  - [x] Visual: `configuracionVisual`
  - [x] Undo/Redo: `puedeDeshacer`, `puedeRehacer`
- [x] Los cambios de UI NO generan entradas de undo/redo a nivel de proyecto.
- [x] Los cambios de UI son eventos transitorios solamente.
- [x] Payloads tipados para eventos UI en `shared/src/types/ui.ts`:
  - [x] `EventoUIPanelAbiertoPayload`, `EventoUIPanelCerradoPayload`
  - [x] `EventoUIZoomCambiadoPayload`, `EventoUIScrollCambiadoPayload`
  - [x] `EventoUIFocoCambiadoPayload`, `EventoUIArrastrandoPayload`
  - [x] `EventoUIDialogoPayload`, `EventoUIMenuPayload`
  - [x] `EventoUITooltipPayload`, `EventoUICargaPayload`
- [x] Helpers UI: `esModoArrange`, `esModoEdit`, `esModoPaint`, `esModoAutomation`, `esModoMix`, `esPanelActivo`, `obtenerPestanaActiva`, `esCargaActiva`, `estaPaletaAbierta`, `estaArrastrando`

### 8. Query API para IA
- [x] `DAWQuery` en `shared/src/types/query.ts` como interfaz de consulta determinista y sin efectos secundarios:
  - [x] `obtenerResumenProyecto(): ResumenProyecto`
  - [x] `obtenerPistas(filtro?: FiltroPista): Track[]`
  - [x] `obtenerElementosSeleccionados(): ElementosSeleccionados`
  - [x] `obtenerClip(id: string): ConsultaClip | null`
  - [x] `obtenerPlugins(): DescriptorPlugin[]`
  - [x] `obtenerParametroPlugin(idPlugin: string, idParametro: string)`
  - [x] `obtenerAnalisisAudio(idPista?: string): ResumenAnalisisAudio | null`
  - [x] `obtenerRuteo(): ConsultaRuteo`
  - [x] `obtenerAutomatizacion(idPista?: string): CarrilAutomatizacion[]`
  - [x] `obtenerEventosRecientes(limite?: number): ResumenEventoDominio[]`
  - [x] `obtenerCapabilidades(): CapabilityDescriptor[]`
  - [x] `obtenerTransporte(): ConsultaTransporte`
  - [x] `obtenerCanalesMezcla()`, `obtenerNivelesMaster()`
  - [x] `obtenerMarcadores()`, `obtenerMedios()`, `obtenerConfiguracion()`
  - [x] `obtenerContextoIA(): ConsultaContextoIA`
  - [x] `buscar()`, `buscarAvanzado()`
  - [x] `exportarEstado()`, `exportarEstadoAvanzado()`
  - [x] `predecirMejora()`, `predecirMejoraAvanzada()`
  - [x] `obtenerDiffs()`, `generarReporte()`, `ejecutarConsultaBatch()`
  - [x] `obtenerEstado(): ConsultaEstado`
  - [x] Duplicados: `duplicarEntidad`, `duplicarPista`, `duplicarClip`, `duplicarPlugin`, `duplicarAutomatizacion`, `duplicarMarcador`, `duplicarRegion`, `duplicarVCA`, `duplicarBus`, `duplicarLoop`, `duplicarEscena`, `duplicarPreset`, `duplicarPlantilla`, `duplicarMedio`, `duplicarToma`
- [x] Consultas específicas: `ConsultaTransporte`, `ConsultaMezcla`, `ConsultaRuteo`, `ConsultaMedios`, `ConsultaConfiguracion`, `ConsultaRendimiento`, `ConsultaExportacion`, `ConsultaSugerenciaIA`, `ConsultaHistorial`, `ConsultaSincronizacion`, `ConsultaControlMIDI`, `ConsultaHardware`, `ConsultaLoop`, `ConsultaEscenas`, `ConsultaNotacion`, `ConsultaVCA`, `ConsultaFades`, `ConsultaMarcadores`, `ConsultaPlantillas`, `ConsultaSesion`, `ConsultaActualizacion`, `ConsultaNube`, `ConsultaLicencia`, `ConsultaCapabilidades`, `ConsultaContextoIA`, `ConsultaEstado`, `ConsultaBusqueda`, `ConsultaExportacionEstado`, `ConsultaPrediccion`, `ConsultaDiffs`, `ConsultaReporte`, `ConsultaBatch`
- [x] Las consultas son deterministas y sin efectos secundarios.

### 9. Integración con Undo/Redo
- [x] La pila de undo/redo NO almacena snapshots del estado.
- [x] Los comandos almacenan su inverso:
  - [x] `inverso: Command | null` — null si es irreversible
- [x] Esto mantiene la memoria proporcional al número de acciones, no al tamaño del estado.
- [x] `NavegacionHistorial` en `shared/src/types/historial.ts` con `puedeDeshacer`, `puedeRehacer`

### 10. Tipos de Dominio
- [x] `shared/src/types/tiempo.ts` — BPM, TimeSignature, TimePosition, TimeDuration, TimeMap, Grid, Cuantizacion, Playhead, LoopTiempo, RangoTiempo, TimeCode, SincronizacionReloj, MTC, Link
- [x] `shared/src/types/timeline.ts` — TimelineState
- [x] `shared/src/types/tracks.ts` — todos los tipos de tracks
- [x] `shared/src/types/clips.ts` — AudioClip, MidiClip, MidiNote
- [x] `shared/src/types/transport.ts` — TransportState, TransportMode, GrabacionEstado, ModoGrabacion, ModoSincronizacion, etc.
- [x] `shared/src/types/entidades.ts` — entidades transversales: Receive, Fade, Marcador, Region, Take, Version, Snapshot, Preset, Theme, Atajo, Cache, Proxy, ContextoIA, ClipAutomation, PluginInfo, AutomatizacionInfo, PuntoAutomatizacion, Plantilla, Medio, Grabacion, Metronomo, Exportacion, Sesion, ControlMIDI, Hardware, RutaAudio, Loop, Escena, Notacion, Licencia, Nube, Actualizacion, Rendimiento, ControlSuperficie
- [x] `shared/src/types/routing.ts` — RoutingMatrix, Bus, Envio, Insercion, Ruta, Sidechain, Puente, CanalRuteo, GrupoRuteo, ConexionDirecta, PresetRuteo
- [x] `shared/src/types/mezcla.ts` — EQParametros, CompresorParametros, ChannelStrip, MasterChannel, MixerChannel
- [x] `shared/src/types/analisis.ts` — AudioAnalysis, SpectrumPoint, LoudnessData, WaveformData, AudioMeter, ProjectAnalysis
- [x] `shared/src/types/metadata.ts` — ProjectMetadata
- [x] `shared/src/types/ui.ts` — UIState, PanelLayout, PanelPosicion, PestanaEditor, ConfiguracionCuadricula, ViewportLineaTiempo, EstadoArrastre, EstadoMenuContextual, EstadoPaletaComandos, EstadoLineaTiempoUI, EstadoEditorDAW, EstadoBarraEstado, EstadoMezcladorUI, ConfiguracionVisualUI, ConfiguracionAccesibilidadUI, EstadoCargaDetallado, EventoUI*Payload, helpers UI
- [x] `shared/src/types/query.ts` — DAWQuery y todas las consultas específicas
- [x] `shared/src/types/command.ts` — Command, CommandDefinition, StateTransition, CommandResult, CommandError, TransactionResult, RiskLevel, CommandPayload, CommandHistoryEntry, CommandRegistry, UndoRedoStack, Macro, CommandLogEntry, ScriptAPI, KeyBinding, CommandStack
- [x] `shared/src/state/ejecutor-comandos.ts` — CommandExecutor (pipeline execute/undo/redo/batch/boundary)
- [x] `shared/src/state/registro-comandos.ts` — CommandRegistry singleton
- [x] `shared/src/state/pila-deshacer-rehacer.ts` — UndoRedoStack
- [x] `shared/src/state/macros.ts` — MacroRegistry
- [x] `shared/src/state/registro-auditoria.ts` — AuditLog
- [x] `shared/src/state/api-scripts.ts` — ScriptAPI sandbox
- [x] `shared/src/types/capabilities.ts` — CapabilityRegistry, CapabilityDescriptor, CapacidadesConocidas
- [x] `shared/src/types/seleccion.ts` — EstadoSeleccion, FiltroSeleccion, SeleccionGuardada, HistorialSeleccion, SeleccionRango, SeleccionConsulta
- [x] `shared/src/types/state.ts` — DAWState, DAWStateSnapshot, DAWStatePartial, DAWStateDiff, DAWStateMigration, DAWStateValidation, DAWStateMetrics, DAWStateExport, DAWStateImport, DAWStateClone, DAWStateReset, DAWStateWatch, DAWStateChange
- [x] `shared/src/types/serializable.ts` — Serializable, serializar, deserializar
- [x] `shared/src/types/historial.ts` — Historial, AccionHistorial, EventoHistorial, VersionHistorial, FiltroHistorial, NavegacionHistorial
- [x] `shared/src/types/duplicado.ts` — OpcionesDuplicado, ResultadoDuplicado, TiposEntidadDuplicable
- [x] `shared/src/types/midi.ts` — DatosMidi, DatosCC, DatosPitchBend, DatosSysex, ConfiguracionMIDI, MapeoMIDI, ControladorMIDI, PresetMIDI, RutaMIDI, AprendizajeMIDI, RetroalimentacionMIDI, GrabacionMIDI
- [x] `shared/src/events/evento-dominio.ts` — EventoDominio, EventoAsincrono, FiltroEvento, ValorJSON, ObjetoJSON, ArregloJSON, EventoError, EventoAdvertencia, EventoInfo, EventoDebug, EventoMetrica, EventoAuditoria, EventoComando, EventoRespuesta, EventoFeedback, EventoNotificacion, EventoAlerta, EventoCambioEstado, EventoInicio, EventoFin, EventoProgreso, EventoInicioSesion, EventoFinSesion
- [x] `shared/src/events/event-bus.ts` — BusEventos, BusEventosMemoria, EventoPriorizado
- [x] `shared/src/constants/nombres-eventos.ts` — Catálogo centralizado de nombres de eventos

### 11. Event Bus
- [x] `BusEventos` en `shared/src/events/event-bus.ts` con `on`, `off`, `emit`, `once`, `clear`, `obtenerBufferReplay`
- [x] `BufferReplay` para replay de eventos
- [x] Priorización de eventos por dominio
- [x] Batch processing con agrupación
- [x] Catálogo centralizado en `shared/src/constants/nombres-eventos.ts`
- [x] Eventos UI tipados: `EventosUIExt`

## Dependencias
- [x] Event Bus (`shared/src/events/event-bus.ts`, `shared/src/events/evento-dominio.ts`)
- [x] Catálogo de eventos (`shared/src/constants/nombres-eventos.ts`)

## Notas
- Los tipos de plugins y automatización están centralizados en `shared/src/types/entidades.ts` como entidades transversales, no en archivos separados.
- `EstadoMezcladorUI` incluye campo `colapsado?: boolean` para estado de vista del mixer.
- La UI consume el store centralizado mediante `useDAW()` y `useDAWState()` (basado en `useSyncExternalStore`).
- El hook `useEventBus()` provee suscripción reactiva a eventos con cleanup automático.
- Estado de viewport (zoom, scroll) y selección de clips viven en `DAWState.ui` y `DAWState.selection` respectivamente, compartidos entre componentes.
- Undo de dominio: comandos con `inverseType` + `StateTransition.inversePayload` (create↔delete vía `track.restore`/`clip.restore`; toggles self-inverse).
- Selección y paleta: `selection.set`/`selection.clear`/`ui.setPalette` (sin undo). Zoom/scroll UI siguen en `establecerEstado`.
- Serialización de estado: `serializarEstado`/`deserializarEstado`; operaciones `exportarEstadoDAW`/`importarEstadoDAW`/`clonarEstadoDAW`/`resetearEstadoDAW`.
- `ConsultaDAW.duplicar*` planifica sin mutar; aplicación vía Command System.
- Cache: `Map`/`ArrayBuffer` se serializan con marcadores (buffers omitidos al revivir).

## Implementación Runtime

### 12. Factory y Tienda de Estado
- [x] `crearEstadoInicial()` en `shared/src/state/estado-inicial.ts` — crea un `DAWState` válido y mínimo para arranque, pruebas y baseline de migraciones.
- [x] `crearTiendaDAW()` en `shared/src/state/tienda.ts` — tienda de estado con `obtenerEstado`, `establecerEstado`, `reemplazarEstado`, `suscribir` y `despachar`.
- [x] Notificación a listeners con aislamiento de errores.
- [x] Estructural sharing básico vía spread en `establecerEstado`.

### 13. Query Concreta
- [x] `ConsultaDAW` en `shared/src/state/consulta.ts` — implementación concreta de `DAWQuery` con 50+ métodos de lectura sobre `DAWState`.
- [x] Consultas sin efectos secundarios.

### 14. Watchers
- [x] `crearObservadorEstado()` en `shared/src/state/watch.ts` — observa cambios en campos específicos con `filtro`, `inmediato`, `debounceMs` y `throttleMs`.

### 15. Migraciones y Validación
- [x] `ejecutarMigraciones()` en `shared/src/state/migraciones.ts` — aplica `DAWStateMigration` secuencialmente con reporte de errores.
- [x] `validarEstado()` en `shared/src/state/validador.ts` — valida invariantes básicos de `DAWState` (ids, BPM, sampleRate, bitDepth, volúmenes, clips).

### 16. Tests
- [x] Tests de factory y round-trip en `shared/src/test/estado-inicial.test.ts`
- [x] Tests de alineación en `shared/src/test/state-model-alignment.test.ts` — undo de dominio, selección, paleta, serialización, export/clone/reset, duplicar, watchers
- [x] Tests de Event Bus en `shared/src/test/event-bus.test.ts`

### 17. Integración UI → Store
- [x] `DAWProvider` en `jas-wave/src/context/daw-context.tsx` consume `crearTiendaDAW()` y la expone vía React Context.
- [x] `useDAWState(selector)` usa `useSyncExternalStore` para re-renders selectivos.
- [x] `useEventBus()` provee suscripción a eventos con cleanup automático y handler estable (ref).
- [x] `TransportBar` lee transport/project vía `useDAWState` selectors (reactivo).
- [x] `CommandPalette` lee atajos, tracks y BPM vía `useDAWState` selectors (reactivo).
- [x] `ArrangeView` lee zoom/scroll de `DAWState.ui.zoomHorizontal`/`scrollX` y selección de `DAWState.selection.idsClips`.
- [x] `Mixer` lee estado colapsado de `UIState.estadoMezcladorUI.colapsado`.
- [x] Componentes mutan estado vía `tienda.executor.execute()` (dominio) o `tienda.establecerEstado()` (UI transitorio).
