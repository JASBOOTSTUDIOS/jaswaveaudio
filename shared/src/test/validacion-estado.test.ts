import { describe, it, expect } from 'vitest';
import { validarEstado } from '../state/validador';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { Track, AudioTrack, MidiTrack } from '../types/tracks';
import type { AudioClip, MidiClip } from '../types/clips';
import type { BPM, TimeSignature, TimePosition } from '../types/tiempo';
import type { RoutingMatrix } from '../types/routing';
import type { MasterChannel } from '../types/mezcla';
import type { ProjectAnalysis } from '../types/analisis';
import type { ProjectMetadata } from '../types/metadata';
import type { UIState } from '../types/ui';
import type { GrabacionEstado } from '../types/transport';
import type { EstadoSeleccion } from '../types/seleccion';
import type { ConfiguracionProyecto } from '../types/proyecto';
import type { Cache } from '../types/entidades';
import type { Historial } from '../types/historial';
import type { CommandStack } from '../types/command';
import type { ContextoIA } from '../types/entidades';
import type { EQParametros } from '../types/mezcla';

const bpm = (): BPM => ({ valor: 120, min: 30, max: 300, texto: '120', modo: 'fijo', cambios: [] });

const timeSignature = (): TimeSignature => ({ numerador: 4, denominador: 4, nombre: '4/4', cambios: [] });

const timePosition = (): TimePosition => ({ beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, tiempoMusical: '0:0:0', porcentaje: 0 });

const routing = (): RoutingMatrix => ({
  buses: [],
  sends: [],
  rutas: [],
  sidechains: [],
  inserts: [],
  conexionesDirectas: [],
  puentes: [],
  grupos: [],
  presetActual: undefined,
  validacion: { errores: [], validado: true, ultimaValidacion: Date.now() },
  estadisticas: { busesTotales: 0, enviosTotales: 0, rutasTotales: 0, sidechainsTotales: 0, insertsTotales: 0, conexionesDirectasTotales: 0, buclesDetectados: 0, latenciaPromedio: 0, gananciaPromedio: 0, usoCPU: 0, usoMemoriaMB: 0 },
  historial: { cambios: [], maximoCambios: 100 },
  ordenTracks: [],
  ordenBuses: [],
  snapshot: undefined,
  comentario: undefined,
  etiquetas: [],
});

const master = (): MasterChannel => ({
  volumen: 0,
  paneo: 0,
  muted: false,
  solo: false,
  eq: { graves: 0, medios: 0, agudos: 0, habilitado: false, gravesFrecuencia: 60, mediosFrecuencia: 1000, agudosFrecuencia: 8000, gravesQ: 1, mediosQ: 1, agudosQ: 1, tipo: 'parametrico' } as EQParametros,
  compresor: { umbral: 0, relacion: 1, ataque: 0.01, liberacion: 0.1, gananciaSalida: 0, habilitado: false, tipo: 'digital', lookahead: false, knee: 'soft' },
  limitador: { habilitado: false, umbral: 0, gananciaSalida: 0, release: 0.1 },
  nivelPico: 0,
  nivelRMS: 0,
  reduccionGain: 0,
  corrupcion: false,
});

const analysis = (): ProjectAnalysis => ({
  tracks: [],
  master: {
    loudness: { integrated: -14, shortTerm: -14, momentary: -14, rangoDinamico: 8, peak: 0, truePeak: 0, lufs: -14 } as any,
    spectrum: [],
    waveform: { samples: [], peaks: [], rms: [], duracion: 0, sampleRate: 44100, canales: 2 },
    nivelPico: 0,
    nivelRMS: 0,
    clipping: false,
    phase: 0,
    stereoCorrelation: 1,
    frecuenciaFundamental: 0,
    notaFundamental: 0,
  },
  resumen: { duracionTotal: 60, pistasActivas: 0, clipsTotales: 0, usoCPU: 0, usoMemoriaMB: 0, xruns: 0, latenciaMs: 0 },
  histograma: { frecuencias: [], magnitudes: [] },
});

const metadata = (): ProjectMetadata => ({
  autor: 'Usuario',
  genero: 'Otro',
  tags: ['demo'],
  notas: '',
  copyright: '',
  fechaCreacion: Date.now(),
  fechaModificacion: Date.now(),
  version: 1,
  readOnly: false,
  customData: {},
});

const ui = (): UIState => ({
  tema: 'oscuro',
  idioma: 'es',
  vistaSidebar: 'explorador',
  vistaPanelInferior: 'terminal',
  vistaPanelDerecho: 'propiedades',
  layout: { anchoBarraLateral: 200, altoPanelInferior: 150, anchoPanelDerecho: 200, barraLateralVisible: true, panelInferiorVisible: true, panelDerechoVisible: true },
  playheadVisible: true,
  scrollX: 0,
  scrollY: 0,
  zoomHorizontal: 1,
  zoomVertical: 1,
  panelActivo: null,
  paletaComandosAbierta: false,
  dialogoActivo: null,
  arrastrando: false,
  cargaProgreso: 0,
  etiquetaEstado: '',
  tooltip: null,
  herramientaActiva: 'select',
  modoEdicion: 'arrange',
  panelesDesacoplados: [],
  panelMinimizados: [],
  atajosPersonalizados: {},
  busquedaAbierta: false,
  busquedaTexto: '',
  ultimoFoco: null,
});

const seleccion = (): EstadoSeleccion => ({
  idsPistas: [],
  idsClips: [],
  idsMarcadores: [],
  idsPuntosAutomatizacion: [],
  idsParametrosPlugin: [],
  idsRegiones: [],
  idsTomas: [],
  idsEscenas: [],
  idsLoops: [],
  idsFades: [],
  idsVCAs: [],
  idsBuses: [],
  idsInserts: [],
  idsEnvios: [],
  idsRutas: [],
  idsSidechains: [],
  idsPuentes: [],
  idsGruposRuteo: [],
  idsTemas: [],
  idsAtajos: [],
  idsPlantillas: [],
  idsPresets: [],
  idsMedios: [],
  idsCarpetas: [],
  idsNotas: [],
  idsEventos: [],
  idPrincipal: null,
  tipoPrincipal: null,
  ultimaSeleccion: null,
  seleccionAnterior: null,
  modoSeleccion: 'reemplazar',
});

const configuracionProyecto = (): ConfiguracionProyecto => ({
  sampleRate: 44100,
  bitDepth: 16,
  bufferSize: 256,
  bufferSizeMax: 2048,
  bufferSizeMin: 32,
  dispositivoEntrada: '',
  dispositivoSalida: '',
  dispositivosAlternativos: [],
  latenciaObjetivo: 5,
  modoAltaLatencia: false,
  ditherActivo: false,
  ditherTipo: 'triangular',
  oversampling: 1,
  antiAliasing: true,
  renderizadoOffline: false,
  prioridadCPU: 'normal',
  hilosCPU: 4,
  memoriaBufferMax: 1024,
  precargarPlugins: false,
  confirmarCierre: true,
  autoGuardadoActivo: true,
  autoGuardadoIntervalo: 5,
  autoGuardadoMaxCopias: 10,
  sobreescrituraAutomatica: false,
  compresionGuardado: false,
  cifradoGuardado: false,
  rutaGuardado: '',
  rutaTemporal: '',
  rutaExportacion: '',
  rutaMedios: '',
  rutaPlugins: '',
  rutaPlantillas: '',
  soloLectura: false,
});

const configuracionAvanzada = (): ProjectState['configuracionAvanzada'] => ({
  telemetriaActiva: false,
  actualizacionesAutomaticas: true,
  confirmacionCierre: true,
  confirmacionSobrescritura: true,
  autoGuardadoActivo: true,
  autoGuardadoIntervalo: 5,
  maximoUndo: 50,
  maximoHistorial: 100,
  maximoEventos: 200,
  tamanoBufferReplay: 1024,
  compresionGuardado: false,
  cifradoGuardado: false,
  proxy: undefined,
});

const cache = (): Cache => ({ archivos: new Map(), maximoBytes: 0, bytesUsados: 0 });

const historial = (): Historial => ({ acciones: [], eventos: [], versiones: [], maximoAcciones: 100, maximoEventos: 100, maximoVersiones: 50, accionActualId: null, indiceActual: 0 });

const commandStack = (): CommandStack => ({ deshacer: [], rehacer: [], limite: 100, grupos: [] });

const contextoIA = (): ContextoIA => ({
  proyectoId: 'project-1',
  usuarioId: 'user-1',
  herramientasDisponibles: [],
  capacidades: [],
  modo: 'manual',
  idioma: 'es',
  sesionId: 'session-1',
  historialReciente: [],
  estadoActual: {},
  permisos: [],
});

const proyectoMinimo = (overrides: Partial<ProjectState> = {}): ProjectState => ({
  id: 'project-1',
  nombre: 'Demo',
  ruta: undefined,
  sampleRate: 44100,
  bitDepth: 16,
  bpm: bpm(),
  timeSignature: timeSignature(),
  timeline: {
    duracion: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, texto: '0', porcentaje: 0 },
    loop: { activo: false, inicio: timePosition(), fin: timePosition() },
    punch: { activo: false, inicio: timePosition(), fin: timePosition() },
    zoomHorizontal: 1,
    zoomVertical: 1,
    scrollX: 0,
    scrollY: 0,
    playhead: timePosition(),
    snap: false,
    snapTipo: 'beat',
    snapValor: 1,
    marcadores: [],
    escenas: [],
    tracksOrden: [],
    alturaTrack: 30,
    compasInicio: 0,
    compasFin: 30,
  },
  tracks: [],
  routing: routing(),
  master: master(),
  analysis: analysis(),
  metadata: metadata(),
  capabilities: { hardwareConectado: [], pluginsDisponibles: [], capacidades: [], licenciaTipo: 'gratuita', licenciaExpiracion: 0 },
  modificado: false,
  fechaCreacion: Date.now(),
  fechaModificacion: Date.now(),
  marcadores: [],
  escenas: [],
  plantillaActual: undefined,
  historialAcciones: [],
  version: 1,
  configuracion: configuracionProyecto(),
  configuracionAvanzada: configuracionAvanzada(),
  sesion: undefined,
  ultimaExportacion: undefined,
  etiquetas: [],
  archivado: false,
  estadisticas: { duracionTotal: 60, pistasTotales: 0, pistasAudio: 0, pistasMidi: 0, pistasBus: 0, pistasVCA: 0, pistasCarpeta: 0, clipsTotales: 0, clipsAudio: 0, clipsMidi: 0, pluginsTotales: 0, automatizacionesTotales: 0, puntosAutomatizacion: 0, marcadoresTotales: 0, regionesTotales: 0, escenasTotales: 0, eventosTotales: 0, tamanioProyectoBytes: 0, tamanioMediosBytes: 0, tamanioPluginsBytes: 0, tiempoCargaMs: 0, tiempoGuardadoMs: 0, tiempoExportacionMs: 0, usoCPU: 0, usoMemoriaMB: 0, usoDiscoMB: 0, xruns: 0, ultimoXrun: 0, ciclosTiempoRealPerdidos: 0, compasesTotales: 30 },
  colaboracion: { compartido: false, proyectoId: 'project-1', usuarioId: '', usuarios: [], conflictos: [], comentarios: [], permisos: { editar: true, exportar: true, compartir: false, administrar: true } },
  versiones: [],
  validacion: { errores: [], validada: true, ultimaValidacion: Date.now() },
  configuracionRenderizado: { formato: 'wav', bitrate: 320, sampleRate: 44100, bitDepth: 16, canales: 2, rangoInicio: 0, rangoFin: 60, normalizar: false, dither: false, metadatos: {}, incluirMarcadores: true, incluirMetadatos: true, rebobinadoTiempoReal: false, renderizarMaster: true, renderizarStems: false, stemsPorPista: false, stemsPorBus: false, stemsPorGrupo: false },
  comparacion: undefined,
  checksum: 'abc',
  tamanioBytes: 1024,
  ultimaCompaction: 0,
  notasVersion: {},
  ...overrides,
});

const audioClip = (overrides: Partial<AudioClip> = {}): AudioClip => ({
  id: 'clip-1',
  trackId: 'track-1',
  nombre: 'Toma 1',
  inicio: 0,
  duracion: 1,
  tipo: 'audio',
  color: '#fff',
  seleccionado: false,
  clipInicio: 0,
  fadeIn: { id: 'fade-1', clipId: 'clip-1', tipo: 'in', inicio: 0, duracion: 0.1, curva: 'lineal' } as any,
  fadeOut: { id: 'fade-2', clipId: 'clip-1', tipo: 'out', inicio: 0.9, duracion: 0.1, curva: 'lineal' } as any,
  warp: false,
  velocidad: 1,
  inverso: false,
  source: { ruta: '', duracion: 1, sampleRate: 44100, canales: 2, bitDepth: 16 } as any,
  ...overrides,
});

const midiClip = (overrides: Partial<MidiClip> = {}): MidiClip => ({
  id: 'clip-2',
  trackId: 'track-2',
  nombre: 'MIDI',
  inicio: 0,
  duracion: 1,
  tipo: 'midi',
  color: '#fff',
  seleccionado: false,
  notas: [],
  velocidadGlobal: 100,
  cuantizacion: 0,
  loop: { activo: false, inicio: 0, fin: 1 } as any,
  ...overrides,
});

const trackAudio = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  id: 'track-1',
  nombre: 'Voz',
  nombreOriginal: 'Voz',
  color: '#fff',
  icono: undefined,
  tipo: 'audio',
  rol: 'normal',
  estado: 'activo',
  volumen: 1,
  volumenOriginal: 0,
  paneo: 0,
  paneoOriginal: 0,
  silenciada: false,
  soloActiva: false,
  armada: false,
  frozen: false,
  soloSeguro: false,
  muteSeguro: false,
  orden: 0,
  profundidad: 0,
  padreId: undefined,
  hijos: [],
  clips: [audioClip()],
  plugins: [],
  automatizaciones: [],
  envios: [],
  receives: [],
  fades: [],
  marcadores: [],
  medios: [],
  tags: [],
  notas: '',
  modificado: false,
  fechaCreacion: Date.now(),
  fechaModificacion: Date.now(),
  estadisticas: { clipsTotales: 1, clipsAudio: 1, clipsMidi: 0, duracionTotal: 1, duracionUtil: 1, pluginsTotales: 0, automatizacionesTotales: 0, puntosAutomatizacion: 0, enviosTotales: 0, receivesTotales: 0, fadesTotales: 0, marcadoresTotales: 0, mediosTotales: 0, eventosTotales: 0 },
  configuracion: { cuantizacion: 0, delayCompensacion: 0, retardoSincronizacion: 0, filtroEntrada: false, filtroSalida: false, monitorizarEntrada: false, grabacionAutomática: false, sobrescrituraAutomatica: false, cuantizarGrabacion: false, loop: false, punchIn: 0, punchOut: 0, metronomo: false, click: false, preRoll: false, postRoll: false },
  colorDefecto: '#fff',
  visible: true,
  bloqueada: false,
  seleccionada: false,
  enRuta: false,
  enSidechain: false,
  enLoop: false,
  enEscena: false,
  controladoresVinculados: [],
  superficiesVinculadas: [],
  metadatos: {},
  entrada: '',
  salida: '',
  formato: 'stereo',
  canales: 2,
  sampleRate: 44100,
  bitDepth: 16,
  latenciaEntrada: 0,
  latenciaSalida: 0,
  bufferSize: 256,
  dispositivoEntrada: '',
  dispositivoSalida: '',
  gainStaging: 0,
  headroom: 0,
  phase: 0,
  stereoCorrelation: 1,
  frecuenciaFundamental: 0,
  notaFundamental: undefined,
  lufs: -14,
  rangoDinamico: 8,
  clipping: false,
  xruns: 0,
  ultimoXrun: 0,
  ...overrides,
});

const trackMidi = (overrides: Partial<MidiTrack> = {}): MidiTrack => ({
  id: 'track-2',
  nombre: 'MIDI',
  nombreOriginal: 'MIDI',
  color: '#fff',
  icono: undefined,
  tipo: 'midi',
  rol: 'normal',
  estado: 'activo',
  volumen: 1,
  volumenOriginal: 0,
  paneo: 0,
  paneoOriginal: 0,
  silenciada: false,
  soloActiva: false,
  armada: false,
  frozen: false,
  soloSeguro: false,
  muteSeguro: false,
  orden: 1,
  profundidad: 0,
  padreId: undefined,
  hijos: [],
  clips: [midiClip()],
  plugins: [],
  automatizaciones: [],
  envios: [],
  receives: [],
  fades: [],
  marcadores: [],
  medios: [],
  tags: [],
  notas: '',
  modificado: false,
  fechaCreacion: Date.now(),
  fechaModificacion: Date.now(),
  estadisticas: { clipsTotales: 1, clipsAudio: 0, clipsMidi: 1, duracionTotal: 1, duracionUtil: 1, pluginsTotales: 0, automatizacionesTotales: 0, puntosAutomatizacion: 0, enviosTotales: 0, receivesTotales: 0, fadesTotales: 0, marcadoresTotales: 0, mediosTotales: 0, eventosTotales: 0 },
  configuracion: { cuantizacion: 0, delayCompensacion: 0, retardoSincronizacion: 0, filtroEntrada: false, filtroSalida: false, monitorizarEntrada: false, grabacionAutomática: false, sobrescrituraAutomatica: false, cuantizarGrabacion: false, loop: false, punchIn: 0, punchOut: 0, metronomo: false, click: false, preRoll: false, postRoll: false },
  colorDefecto: '#fff',
  visible: true,
  bloqueada: false,
  seleccionada: false,
  enRuta: false,
  enSidechain: false,
  enLoop: false,
  enEscena: false,
  controladoresVinculados: [],
  superficiesVinculadas: [],
  metadatos: {},
  entrada: '',
  salida: '',
  canal: 1,
  canalOmni: false,
  cuantizacion: 0,
  filtro: { notasMin: 0, notasMax: 127, ccMin: 0, ccMax: 127, tipos: [] },
  mpe: false,
  mpeZonaInferior: 0,
  mpeZonaSuperior: 0,
  mpeDimensiones: 0,
  retardoSincronizacion: 0,
  modoReloj: 'interno',
  transmitirReloj: false,
  transmitirMTC: false,
  transmitirMidi: false,
  recibirMidi: false,
  filtroReloj: false,
  filtroActiveSense: false,
  filtroSysEx: false,
  ...overrides,
});

const estadoMinimo = (overrides: Partial<DAWState> = {}): DAWState => ({
  project: proyectoMinimo(),
  transport: {
    reproduciendo: false,
    posicion: timePosition(),
    bpm: 120,
    modo: 'normal',
    loop: { activo: false, inicio: timePosition(), fin: timePosition(), duracion: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, texto: '0', porcentaje: 0 } as any, modo: 'loop', contador: 0, nombre: undefined },
    punch: { activo: false, inicio: timePosition(), fin: timePosition(), modo: 'none' },
    metronomo: { activo: true, tempo: 120, compas: 4, subdivision: 4, tiempoSonando: false, tiempoMarcado: 0, sonidoInicio: true, sonidoCompas: true, sonidoSubdivision: false, patronAcento: [], sonido: 'click', volumen: 0.8, preroll: false, postroll: false },
    grabacion: 'inactiva',
    sincronizado: true,
    relojMaestro: 'interno',
    historialPosiciones: [],
    maximoHistorial: 100,
    ultimaPosicionGuardada: null,
    tiempoInicioReproduccion: 0,
    duracionUltimaReproduccion: 0,
    ciclos: 0,
    modoGrabacion: 'normal',
    modoSincronizacion: 'interno',
    shuttle: { activo: false, velocidad: 0, modo: 'linear', direccion: 'adelante' },
    preroll: { activo: false, compases: 1, tipo: 'metronomo' },
    postroll: { activo: false, compases: 1, tipo: 'metronomo' },
    metronomoVisual: { activo: true, color: '#000', tamano: 12, posicion: 'centro' },
    countIn: { activo: false, compases: 1, tipo: 'metronomo' },
    click: { activo: true, volumen: 0.8, pitch: 1 },
    tempoMap: { bpmInicial: bpm(), timeSignatureInicial: timeSignature(), eventos: [], curvaInterpolacion: 'lineal', suavizado: 0 },
    timeCode: { tipo: 'full', fps: 24, dropFrame: false, horas: 0, minutos: 0, segundos: 0, frames: 0 },
    sincronizacionReloj: { fuente: 'interno', modo: 'maestro', bpm: 120, tiempoActual: timePosition(), ultimaSincronizacion: 0, desfaseMs: 0, latenciaMs: 0, estable: true },
    link: { activo: false, bpm: 120, compas: timeSignature(), fase: 0, fuente: '', dispositivos: [], latenciaMs: 0 },
    mtc: { tipo: 'full', fps: 24, dropFrame: false, horas: 0, minutos: 0, segundos: 0, frames: 0, tiempo: timePosition() },
    relojMidi: { activo: false, fuente: 'interno', modo: 'maestro', bpm: 120, ticksPorBeat: 960 },
    master: { activo: true, bpm: 120, timeSignature: timeSignature(), posicion: timePosition() },
    estado: { activo: true, bloqueado: false },
    estadisticas: { reproduccionesTotales: 0, grabacionesTotales: 0, tiempoTotalReproduccionMs: 0, tiempoTotalGrabacionMs: 0, ciclosTotales: 0, punchInTotales: 0, punchOutTotales: 0, erroresTransporte: 0, xrunsDuranteReproduccion: 0, latenciaPromedioMs: 0 },
    historial: { posiciones: [], eventos: [], maximoEntries: 100 },
    configuracion: { autoPlay: false, autoRecord: false, autoReturn: false, returnToStart: false, loopEnabled: false, punchEnabled: false, metronomeEnabled: false, countInEnabled: false, prerollEnabled: false, postrollEnabled: false, shuttleEnabled: false, syncEnabled: false, linkEnabled: false, mtcEnabled: false, midiClockEnabled: false, tiempoLimiteReproduccion: 0, tiempoLimiteGrabacion: 0 },
    tags: [],
    notas: '',
    modificado: false,
    fechaCreacion: Date.now(),
    fechaModificacion: Date.now(),
    marcaTiempoInicio: 0,
    tiempoTotalUsoMs: 0,
  },
  selection: seleccion(),
  ui: ui(),
  atajos: { mapa: {}, porDefecto: {} },
  marcaTiempo: Date.now(),
  esquemaVersion: '1.0',
  dispositivoId: 'device-1',
  sesionId: 'session-1',
  checksum: 'abc',
  tamanioBytes: 1024,
  etiquetas: [],
  notas: 'notas',
  idioma: 'es',
  zonaHoraria: 'America/La_Paz',
  marcaTiempoInicio: Date.now() - 1000,
  tiempoTotalUsoMs: 1000,
  estadisticasUso: { sesionesTotales: 1, tiempoPromedioSesionMs: 1000, comandosEjecutados: 1, eventosProcesados: 1, erroresTotales: 0, advertenciasTotales: 0, exportacionesTotales: 0, importacionesTotales: 0, guardadosTotales: 0, cambiosNoGuardados: 0 },
  rendimiento: { cpuPromedio: 10, memoriaPromedioMB: 200, xrunsTotales: 0, latenciaPromedioMs: 5, buffersDescartados: 0 },
  configuracionAvanzada: configuracionAvanzada(),
  extensiones: { activas: [], desactivadas: [], pendientes: [], errores: [] },
  logs: { errores: [], advertencias: [], eventos: [], maximoEntries: 100 },
  snapshots: [],
  migraciones: [],
  validaciones: [],
  comparaciones: [],
  contexto: {},
  contextoIA: contextoIA(),
  cache: cache(),
  proxies: [],
  historial: historial(),
  busEventos: [],
  modoColaboracion: false,
  sincronizado: true,
  ultimaSincronizacion: 0,
  capabilities: { hardwareConectado: [], pluginsDisponibles: [], capacidades: [], licenciaTipo: 'gratuita', licenciaExpiracion: 0 },
  version: '1.0.0',
  commandStack: commandStack(),
  ...overrides,
});

describe('validarEstado', () => {
  it('marca errores cuando faltan campos obligatorios del proyecto', () => {
    const resultado = validarEstado(estadoMinimo({ project: proyectoMinimo({ id: '', nombre: '' }) } as unknown as DAWState));
    expect(resultado.validado).toBe(false);
    expect(resultado.errores.some(e => e.campo === 'project.id')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.nombre')).toBe(true);
  });

  it('reporta errores de BPM y compases inválidos', () => {
    const resultado = validarEstado(estadoMinimo({ project: proyectoMinimo({ bpm: { ...bpm(), valor: 0 }, timeSignature: { ...timeSignature(), numerador: 0 } }) } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'project.bpm.valor')).toBe(true);
    expect(resultado.errores.some(e => e.campo === 'project.timeSignature.numerador')).toBe(true);
  });

  it('valida tracks con nombres duplicados', () => {
    const trackUno = trackAudio({ id: 'track-audio-1', nombre: 'Voz' });
    const trackDos = trackAudio({ id: 'track-audio-2', nombre: 'Voz' });
    const resultado = validarEstado(estadoMinimo({ project: proyectoMinimo({ tracks: [trackUno, trackDos] }) } as unknown as DAWState));
    expect(resultado.validado).toBe(false);
    expect(resultado.errores.some(e => e.campo === 'track.nombre' && e.mensaje.includes('duplicado'))).toBe(true);
  });

  it('detecta errores en transporte y routing', () => {
    const estado = estadoMinimo({
      transport: { ...estadoMinimo().transport, bpm: -1, reproduciendo: null as any },
      project: proyectoMinimo({ routing: null as any }) as any,
    } as unknown as DAWState);
    const resultado = validarEstado(estado);
    expect(resultado.errores.some(e => e.campo === 'transport.bpm')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'transport.reproduciendo')).toBe(true);
    expect(resultado.errores.some(e => e.campo === 'project.routing')).toBe(true);
  });

  it('agrupa advertencias cuando el estado es parcialmente inválido', () => {
    const resultado = validarEstado(estadoMinimo({ project: proyectoMinimo({ sampleRate: 0, bitDepth: -1 }) } as unknown as DAWState));
    expect(resultado.validado).toBe(false);
    expect(resultado.resumen.camposAfectados).toContain('project.sampleRate');
  });

  it('valida configuracion avanzada, logs y versionado', () => {
    const resultado = validarEstado(estadoMinimo({
      project: proyectoMinimo({
        configuracionAvanzada: { ...configuracionAvanzada(), autoGuardadoIntervalo: -1 },
      }),
      logs: null as any,
      esquemaVersion: '',
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'project.configuracionAvanzada.autoGuardadoIntervalo')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'logs')).toBe(true);
    expect(resultado.errores.some(e => e.campo === 'esquemaVersion')).toBe(true);
  });

  it('valida metadatos, configuración avanzada y logs', () => {
    const resultado = validarEstado(estadoMinimo({
      project: proyectoMinimo({
        metadata: { ...metadata(), autor: null as any },
        configuracionAvanzada: { ...configuracionAvanzada(), autoGuardadoIntervalo: -1 },
      }),
      logs: null as any,
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'project.configuracionAvanzada.autoGuardadoIntervalo')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.metadata.autor')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'logs')).toBe(true);
  });

  it('detecta clips MIDI con notas inválidas', () => {
    const clipInvalido = midiClip({
      id: 'midi-clip-invalido',
      notas: [
        { id: 'n1', pitch: -1, velocidad: 100, inicio: 0, duracion: 1, canal: 0, presion: 0, seleccionada: false },
        { id: 'n2', pitch: 128, velocidad: -5, inicio: -1, duracion: 0, canal: 0, presion: 0, seleccionada: false },
      ],
    });
    const track = trackMidi({ id: 'track-midi-invalido', clips: [clipInvalido] });
    const resultado = validarEstado(estadoMinimo({ project: proyectoMinimo({ tracks: [track] }) } as unknown as DAWState));
    expect(resultado.validado).toBe(false);
    expect(resultado.errores.some(e => e.campo === 'midiClip.nota.pitch' && e.entidadId === 'midi-clip-invalido')).toBe(true);
    expect(resultado.errores.some(e => e.campo === 'midiClip.nota.velocity' && e.entidadId === 'midi-clip-invalido')).toBe(true);
    expect(resultado.errores.some(e => e.campo === 'midiClip.nota.start' && e.entidadId === 'midi-clip-invalido')).toBe(true);
    expect(resultado.errores.some(e => e.campo === 'midiClip.nota.duration' && e.entidadId === 'midi-clip-invalido')).toBe(true);
  });

  it('valida master channel en bordes y campos de compresor', () => {
    const resultado = validarEstado(estadoMinimo({
      project: proyectoMinimo({
        master: {
          ...master(),
          volumen: -61,
          compresor: { ...(master().compresor as any), umbral: null as any, relacion: 0, ataque: -1, liberacion: -1, gananciaSalida: null as any },
        } as any,
      }),
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'project.master.volumen')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.compresor.umbral')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.compresor.relacion')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.compresor.ataque')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.compresor.liberacion')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.compresor.gananciaSalida')).toBe(true);
  });

  it('valida master channel con nivelPico y reduccionGain inválidos', () => {
    const resultado = validarEstado(estadoMinimo({
      project: proyectoMinimo({
        master: {
          ...master(),
          nivelPico: -100,
          nivelRMS: 20,
          reduccionGain: -5,
          corrupcion: 'si' as any,
        } as any,
      }),
    } as unknown as DAWState));
    expect(resultado.advertencias.some(e => e.campo === 'project.master.nivelPico')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.nivelRMS')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.reduccionGain')).toBe(true);
    expect(resultado.advertencias.some(e => e.campo === 'project.master.corrupcion')).toBe(true);
  });

  it('detecta extensiones con entradas inválidas', () => {
    const resultado = validarEstado(estadoMinimo({
      extensiones: {
        activas: [''],
        desactivadas: [],
        pendientes: [],
        errores: [],
      } as any,
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'extensiones.activas')).toBe(true);
  });

  it('detecta errores de extensiones con campos inválidos', () => {
    const resultado = validarEstado(estadoMinimo({
      extensiones: {
        activas: [],
        desactivadas: [],
        pendientes: [],
        errores: [{ extensionId: 123, mensaje: '', marcaTiempo: -1 }] as any,
      },
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'extensiones.errores')).toBe(true);
  });

  it('detecta snapshots corruptos', () => {
    const resultado = validarEstado(estadoMinimo({
      snapshots: ['snapshot-invalida'] as any,
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'snapshot')).toBe(true);
  });

  it('detecta contextoIA nulo', () => {
    const resultado = validarEstado(estadoMinimo({
      contextoIA: null as any,
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'contextoIA')).toBe(true);
  });

  it('detecta cache inválida', () => {
    const resultado = validarEstado(estadoMinimo({
      cache: null as any,
    } as unknown as DAWState));
    expect(resultado.errores.some(e => e.campo === 'cache')).toBe(true);
  });
});
