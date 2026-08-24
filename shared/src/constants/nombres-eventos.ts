/**
 * Catálogo centralizado de nombres de eventos del dominio JasWave.
 *
 * Objetivo:
 *   Proveer una única fuente de verdad para todos los eventos de dominio
 *   emitidos por el BusEventos, evitando strings sueltos y asegurando
 *   consistencia entre módulos.
 *
 * Propósito:
 *   Servir como contrato ligero entre productores y consumidores de eventos
 *   dentro del proceso DAW y el flujo de trabajo asistido por IA. Cada evento
 *   representa un hecho relevante del dominio (cambio de estado, inicio/fin
 *   de operación, error, actualización de UI, etc.) que puede ser auditado,
 *   replayeado o reaccionado en tiempo real.
 *
 * Importancia:
 *   - Facilita el debugging y trazabilidad del flujo de usuario.
 *   - Permite desacoplar módulos (motor de audio, UI, IA, exportación, etc.)
 *     sin dependencias circulares.
 *   - Habilita funcionalidades avanzadas como replay, undo/redo, grabación
 *     de sesiones y respuestas reactivas consistentes.
 */

export const EventosProyecto = {
  creado: 'proyecto.creado',
  cargado: 'proyecto.cargado',
  guardado: 'proyecto.guardado',
  cerrado: 'proyecto.cerrado',
  modificado: 'proyecto.modificado',
  nombreCambiado: 'proyecto.nombreCambiado',
} as const;

export const EventosTransporte = {
  iniciado: 'transporte.iniciado',
  detenido: 'transporte.detenido',
  pausado: 'transporte.pausado',
  posicionCambiada: 'transporte.posicionCambiada',
  modoCambiado: 'transporte.modoCambiado',
  bucleCambiado: 'transporte.bucleCambiado',
} as const;

export const EventosTrack = {
  creada: 'track.creada',
  eliminada: 'track.eliminada',
  actualizada: 'track.actualizada',
  renombrada: 'track.renombrada',
  silenciada: 'track.silenciada',
  soloActiva: 'track.soloActiva',
  armada: 'track.armada',
  monitorizada: 'track.monitorizada',
  volumenCambiado: 'track.volumen.cambiado',
  paneoCambiado: 'track.paneo.cambiado',
  colorCambiado: 'track.colorCambiado',
  ordenCambiado: 'track.ordenCambiado',
  tipoCambiado: 'track.tipoCambiado',
  recibiendoEntrada: 'track.recibiendoEntrada',
} as const;

export const EventosClip = {
  creado: 'clip.creado',
  eliminado: 'clip.eliminado',
  movido: 'clip.movido',
  redimensionado: 'clip.redimensionado',
  dividido: 'clip.dividido',
  unido: 'clip.unido',
  nombreCambiado: 'clip.nombreCambiado',
  colorCambiado: 'clip.colorCambiado',
  silenciado: 'clip.silenciado',
  seleccionado: 'clip.seleccionado',
  waveformListo: 'clip.waveformListo',
  cuantizado: 'clip.cuantizado',
} as const;

export const EventosPlugin = {
  cargado: 'plugin.cargado',
  descargado: 'plugin.descargado',
  parametroCambiado: 'plugin.parametro.cambiado',
  bypassCambiado: 'plugin.bypass.cambiado',
  movido: 'plugin.movido',
  presetCargado: 'plugin.presetCargado',
  presetGuardado: 'plugin.presetGuardado',
  presetCambiado: 'plugin.presetCambiado',
  ventanaAbierta: 'plugin.ventanaAbierta',
  ventanaCerrada: 'plugin.ventanaCerrada',
  error: 'plugin.error',
} as const;

export const EventosAutomatizacion = {
  creada: 'automatizacion.creada',
  puntoAgregado: 'automatizacion.puntoAgregado',
  puntoEliminado: 'automatizacion.puntoEliminado',
  puntoCambiado: 'automatizacion.puntoCambiado',
  grabacionIniciada: 'automatizacion.grabacion.iniciada',
  grabacionDetenida: 'automatizacion.grabacion.detenida',
  modoCambiado: 'automatizacion.modoCambiado',
  todosPuntosEliminados: 'automatizacion.todosPuntosEliminados',
  suavizada: 'automatizacion.suavizada',
  escalaCambiada: 'automatizacion.escalaCambiada',
} as const;

export const EventosMidi = {
  notaIniciada: 'midi.notaIniciada',
  notaDetenida: 'midi.notaDetenida',
  notaPresionada: 'midi.notaPresionada',
  ccCambiado: 'midi.ccCambiado',
  pitchCambiado: 'midi.pitchCambiado',
  reloj: 'midi.reloj',
  start: 'midi.start',
  stop: 'midi.stop',
  continuar: 'midi.continuar',
  programaCambiado: 'midi.programaCambiado',
  sysexRecibido: 'midi.sysexRecibido',
  relojEntrada: 'midi.relojEntrada',
} as const;

export const EventosAudio = {
  analisisActualizado: 'audio.analisis.actualizado',
  clipRenderizado: 'audio.clip.renderizado',
  xrun: 'audio.xrun',
  bufferProcesado: 'audio.bufferProcesado',
  nivelActualizado: 'audio.nivelActualizado',
  espectroActualizado: 'audio.espectroActualizado',
  dispositivoCambiado: 'audio.dispositivoCambiado',
  tasaMuestreoCambiada: 'audio.tasaMuestreoCambiada',
  latenciaCambiada: 'audio.latenciaCambiada',
  clipIniciado: 'audio.clipIniciado',
  clipFinalizado: 'audio.clipFinalizado',
} as const;

export const EventosGrabacion = {
  iniciada: 'grabacion.iniciada',
  detenida: 'grabacion.detenida',
  pausada: 'grabacion.pausada',
  bufferLleno: 'grabacion.bufferLleno',
  error: 'grabacion.error',
  armada: 'grabacion.armada',
  desarmada: 'grabacion.desarmada',
  entradaDetectada: 'grabacion.entradaDetectada',
  archivoGuardado: 'grabacion.archivoGuardado',
} as const;

export const EventosMetronomo = {
  iniciado: 'metronomo.iniciado',
  detenido: 'metronomo.detenido',
  tempoCambiado: 'metronomo.tempoCambiado',
  compasCambiado: 'metronomo.compasCambiado',
  subdivisionCambiada: 'metronomo.subdivisionCambiada',
  tiempoSonando: 'metronomo.tiempoSonando',
  tiempoMarcado: 'metronomo.tiempoMarcado',
} as const;

export const EventosExportacion = {
  iniciada: 'exportacion.iniciada',
  progreso: 'exportacion.progreso',
  completada: 'exportacion.completada',
  error: 'exportacion.error',
  cancelada: 'exportacion.cancelada',
  formatoCambiado: 'exportacion.formatoCambiado',
  bitrateCambiado: 'exportacion.bitrateCambiado',
} as const

/** Eventos de bounce (hoja-ruta 035 / inglés). */
export const EventosRender = {
  started: 'render.started',
  progress: 'render.progress',
  completed: 'render.completed',
  failed: 'render.failed',
  cancelled: 'render.cancelled',
} as const;

export const EventosMedia = {
  importado: 'media.importado',
  eliminado: 'media.eliminado',
  analizado: 'media.analizado',
  waveformListo: 'media.waveformListo',
  duracionDetectada: 'media.duracionDetectada',
  metadatosLeidos: 'media.metadatosLeidos',
  transcodificado: 'media.transcodificado',
  errores: 'media.errores',
} as const;

export const EventosHardware = {
  dispositivoConectado: 'hardware.dispositivoConectado',
  dispositivoDesconectado: 'hardware.dispositivoDesconectado',
  dispositivoCambiado: 'hardware.dispositivoCambiado',
  controladorMIDIConectado: 'hardware.controladorMIDIConectado',
  controladorMIDIDesconectado: 'hardware.controladorMIDIDesconectado',
  interfazAudioConectada: 'hardware.interfazAudioConectada',
  interfazAudioDesconectada: 'hardware.interfazAudioDesconectada',
} as const;

export const EventosMezcla = {
  presetCargado: 'mezcla.presetCargado',
  presetGuardado: 'mezcla.presetGuardado',
  canalAgregado: 'mezcla.canalAgregado',
  canalEliminado: 'mezcla.canalEliminado',
  canalSolado: 'mezcla.canalSolado',
  canalSilenciado: 'mezcla.canalSilenciado',
  eqCambiado: 'mezcla.eqCambiado',
  compresorCambiado: 'mezcla.compresorCambiado',
  envioAgregado: 'mezcla.envioAgregado',
  envioEliminado: 'mezcla.envioEliminado',
  busCreado: 'mezcla.busCreado',
  busEliminado: 'mezcla.busEliminado',
} as const;

export const EventosFade = {
  creado: 'fade.creado',
  eliminado: 'fade.eliminado',
  tipoCambiado: 'fade.tipoCambiado',
  curvaCambiada: 'fade.curvaCambiada',
  duracionCambiada: 'fade.duracionCambiada',
} as const;

export const EventosSesion = {
  iniciada: 'sesion.iniciada',
  finalizada: 'sesion.finalizada',
  restaurada: 'sesion.restaurada',
  autoGuardado: 'sesion.autoGuardado',
  puntoControlCreado: 'sesion.puntoControlCreado',
  puntoControlRestaurado: 'sesion.puntoControlRestaurado',
} as const;

export const EventosUndoRedo = {
  accionRealizada: 'undoRedo.accionRealizada',
  undo: 'undoRedo.undo',
  redo: 'undoRedo.redo',
  limiteAlcanzado: 'undoRedo.limiteAlcanzado',
  pilaVacia: 'undoRedo.pilaVacia',
  pilaLlena: 'undoRedo.pilaLlena',
} as const;

export const EventosRendimiento = {
  cpuActualizado: 'rendimiento.cpuActualizado',
  memoriaActualizada: 'rendimiento.memoriaActualizada',
  discoActualizado: 'rendimiento.discoActualizado',
  bufferSizeCambiado: 'rendimiento.bufferSizeCambiado',
  tasaMuestreoCambiada: 'rendimiento.tasaMuestreoCambiada',
} as const;

export const EventosConfiguracion = {
  ajusteCambiado: 'configuracion.ajusteCambiado',
  temaCambiado: 'configuracion.temaCambiado',
  idiomaCambiado: 'configuracion.idiomaCambiado',
  atajoAgregado: 'configuracion.atajoAgregado',
  atajoEliminado: 'configuracion.atajoEliminado',
  rutaGuardadoCambiada: 'configuracion.rutaGuardadoCambiada',
  rutaTemporalCambiada: 'configuracion.rutaTemporalCambiada',
} as const;

export const EventosUIExt = {
  tooltipMostrado: 'ui.tooltipMostrado',
  tooltipOculto: 'ui.tooltipOculto',
  menuAbierto: 'ui.menuAbierto',
  menuCerrado: 'ui.menuCerrado',
  dialogoAbierto: 'ui.dialogoAbierto',
  dialogoCerrado: 'ui.dialogoCerrado',
  panelAbierto: 'ui.panelAbierto',
  panelCerrado: 'ui.panelCerrado',
  arrastrandoIniciado: 'ui.arrastrandoIniciado',
  arrastrandoFinalizado: 'ui.arrastrandoFinalizado',
  zoomCambiado: 'ui.zoomCambiado',
  scrollCambiado: 'ui.scrollCambiado',
  focoCambiado: 'ui.focoCambiado',
  cargaIniciada: 'ui.cargaIniciada',
  cargaFinalizada: 'ui.cargaFinalizada',
} as const;

export const EventosIAExt = {
  herramientaEjecutada: 'ia.herramientaEjecutada',
  herramientaFallida: 'ia.herramientaFallida',
  permisoDenegado: 'ia.permisoDenegado',
  mensajeEnviado: 'ia.mensajeEnviado',
  mensajeRecibido: 'ia.mensajeRecibido',
  sugerenciaGenerada: 'ia.sugerenciaGenerada',
  sugerenciaAceptada: 'ia.sugerenciaAceptada',
  sugerenciaRechazada: 'ia.sugerenciaRechazada',
  modeloCambiado: 'ia.modeloCambiado',
  contextoAgregado: 'ia.contextoAgregado',
  contextoEliminado: 'ia.contextoEliminado',
} as const;

export const EventosControlMIDI = {
  controladorConectado: 'controlMidi.controladorConectado',
  controladorDesconectado: 'controlMidi.controladorDesconectado',
  mapeoCambiado: 'controlMidi.mapeoCambiado',
  entradaRecibida: 'controlMidi.entradaRecibida',
  salidaEnviada: 'controlMidi.salidaEnviada',
} as const;

export const EventosRutaAudio = {
  conexionCambiada: 'rutaAudio.conexionCambiada',
  envioAgregado: 'rutaAudio.envioAgregado',
  envioEliminado: 'rutaAudio.envioEliminado',
  busCreado: 'rutaAudio.busCreado',
  busEliminado: 'rutaAudio.busEliminado',
  sidechainActivado: 'rutaAudio.sidechainActivado',
  sidechainDesactivado: 'rutaAudio.sidechainDesactivado',
} as const;

export const EventosMuestreo = {
  tasaCambiada: 'muestreo.tasaCambiada',
  profundidadBitsCambiada: 'muestreo.profundidadBitsCambiada',
  formatoCambiado: 'muestreo.formatoCambiado',
  conversionIniciada: 'muestreo.conversionIniciada',
  conversionCompletada: 'muestreo.conversionCompletada',
  conversionError: 'muestreo.conversionError',
} as const;

export const EventosMarcadores = {
  creado: 'marcador.creado',
  eliminado: 'marcador.eliminado',
  renombrado: 'marcador.renombrado',
  posicionCambiada: 'marcador.posicionCambiada',
  colorCambiado: 'marcador.colorCambiado',
  seleccionado: 'marcador.seleccionado',
  regionCreada: 'marcador.regionCreada',
  regionEliminada: 'marcador.regionEliminada',
  regionCambiada: 'marcador.regionCambiada',
  tiempoInicioCambiado: 'marcador.tiempoInicioCambiado',
  tiempoFinCambiado: 'marcador.tiempoFinCambiado',
} as const;

export const EventosVCAGrupo = {
  creado: 'vca.creado',
  eliminado: 'vca.eliminado',
  renombrado: 'vca.renombrado',
  nivelCambiado: 'vca.nivelCambiado',
  soloActivo: 'vca.soloActivo',
  silenciado: 'vca.silenciado',
  paneoCambiado: 'vca.paneoCambiado',
  colorCambiado: 'vca.colorCambiado',
} as const;

export const EventosPlantilla = {
  guardada: 'plantilla.guardada',
  cargada: 'plantilla.cargada',
  eliminada: 'plantilla.eliminada',
  aplicada: 'plantilla.aplicada',
  creada: 'plantilla.creada',
  modificada: 'plantilla.modificada',
} as const;

export const EventosSincronizacion = {
  iniciada: 'sincronizacion.iniciada',
  detenida: 'sincronizacion.detenida',
  relojSincronizado: 'sincronizacion.relojSincronizado',
  dispositivoEncontrado: 'sincronizacion.dispositivoEncontrado',
  error: 'sincronizacion.error',
  maestroCambiado: 'sincronizacion.maestroCambiado',
  seguidorAgregado: 'sincronizacion.seguidorAgregado',
  seguidorEliminado: 'sincronizacion.seguidorEliminado',
} as const;

export const EventosLicencia = {
  activada: 'licencia.activada',
  desactivada: 'licencia.desactivada',
  expirada: 'licencia.expirada',
  validada: 'licencia.validada',
  error: 'licencia.error',
  caracteristicaDesbloqueada: 'licencia.caracteristicaDesbloqueada',
} as const;

export const EventosNube = {
  autoguardadoIniciado: 'nube.autoguardadoIniciado',
  autoguardadoCompletado: 'nube.autoguardadoCompletado',
  sincronizacionIniciada: 'nube.sincronizacionIniciada',
  sincronizacionCompletada: 'nube.sincronizacionCompletada',
  conflictoDetectado: 'nube.conflictoDetectado',
  error: 'nube.error',
  proyectoCompartido: 'nube.proyectoCompartido',
  versionRestaurada: 'nube.versionRestaurada',
} as const;

export const EventosNotacion = {
  partituraCargada: 'notacion.partituraCargada',
  notaAgregada: 'notacion.notaAgregada',
  notaEliminada: 'notacion.notaEliminada',
  notaCambiada: 'notacion.notaCambiada',
  compasAgregado: 'notacion.compasAgregado',
  compasEliminado: 'notacion.compasEliminado',
  claveCambiada: 'notacion.claveCambiada',
  transporteSincronizado: 'notacion.transporteSincronizado',
} as const;

export const EventosLoop = {
  creado: 'loop.creado',
  eliminado: 'loop.eliminado',
  iniciado: 'loop.iniciado',
  detenido: 'loop.detenido',
  sincronizado: 'loop.sincronizado',
  cuantizado: 'loop.cuantizado',
  longitudCambiada: 'loop.longitudCambiada',
  desplazamientoCambiado: 'loop.desplazamientoCambiado',
} as const;

export const EventosEscenas = {
  escenaCreada: 'escenas.escenaCreada',
  escenaEliminada: 'escenas.escenaEliminada',
  escenaSeleccionada: 'escenas.escenaSeleccionada',
  clipDisparado: 'escenas.clipDisparado',
  clipDetenido: 'escenas.clipDetenido',
  modoCambiado: 'escenas.modoCambiado',
} as const;

export const EventosControlSuperficie = {
  superficieConectada: 'controlSuperficie.superficieConectada',
  superficieDesconectada: 'controlSuperficie.superficieDesconectada',
  capaCambiada: 'controlSuperficie.capaCambiada',
  controlMovido: 'controlSuperficie.controlMovido',
  presetCargado: 'controlSuperficie.presetCargado',
} as const;

export const EventosActualizacion = {
  disponible: 'actualizacion.disponible',
  descargando: 'actualizacion.descargando',
  descargada: 'actualizacion.descargada',
  instalada: 'actualizacion.instalada',
  error: 'actualizacion.error',
  omitida: 'actualizacion.omitida',
} as const;

export const EventosSistema = {
  inicializado: 'sistema.inicializado',
  apagando: 'sistema.apagando',
  error: 'sistema.error',
  advertencia: 'sistema.advertencia',
  moduloCargado: 'sistema.moduloCargado',
  moduloDescargado: 'sistema.moduloDescargado',
  configuracionCargada: 'sistema.configuracionCargada',
  configuracionGuardada: 'sistema.configuracionGuardada',
} as const;

export const NombresEventos = {
  ...EventosProyecto,
  ...EventosTransporte,
  ...EventosTrack,
  ...EventosClip,
  ...EventosPlugin,
  ...EventosAutomatizacion,
  ...EventosMidi,
  ...EventosAudio,
  ...EventosGrabacion,
  ...EventosMetronomo,
  ...EventosExportacion,
  ...EventosRender,
  ...EventosMedia,
  ...EventosHardware,
  ...EventosMezcla,
  ...EventosFade,
  ...EventosSesion,
  ...EventosUndoRedo,
  ...EventosRendimiento,
  ...EventosConfiguracion,
  ...EventosUIExt,
  ...EventosIAExt,
  ...EventosControlMIDI,
  ...EventosRutaAudio,
  ...EventosMuestreo,
  ...EventosMarcadores,
  ...EventosVCAGrupo,
  ...EventosPlantilla,
  ...EventosSincronizacion,
  ...EventosLicencia,
  ...EventosNube,
  ...EventosNotacion,
  ...EventosLoop,
  ...EventosEscenas,
  ...EventosControlSuperficie,
  ...EventosActualizacion,
  ...EventosSistema,
} as const;

export type NombreEvento = typeof NombresEventos[keyof typeof NombresEventos];
