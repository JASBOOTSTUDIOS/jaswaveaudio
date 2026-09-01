export interface ConfiguracionProyecto {
  sampleRate: number;
  bitDepth: number;
  bufferSize: number;
  bufferSizeMax: number;
  bufferSizeMin: number;
  dispositivoEntrada: string;
  dispositivoSalida: string;
  /** id Web MIDI o `all`. Vacío = usar el último de la sesión. */
  dispositivoMidiEntrada?: string;
  dispositivosAlternativos: string[];
  latenciaObjetivo: number;
  modoAltaLatencia: boolean;
  ditherActivo: boolean;
  ditherTipo: string;
  oversampling: number;
  antiAliasing: boolean;
  renderizadoOffline: boolean;
  prioridadCPU: string;
  hilosCPU: number;
  memoriaBufferMax: number;
  precargarPlugins: boolean;
  confirmarCierre: boolean;
  autoGuardadoActivo: boolean;
  autoGuardadoIntervalo: number;
  autoGuardadoMaxCopias: number;
  sobreescrituraAutomatica: boolean;
  compresionGuardado: boolean;
  cifradoGuardado: boolean;
  rutaGuardado: string;
  rutaTemporal: string;
  rutaExportacion: string;
  rutaMedios: string;
  rutaPlugins: string;
  rutaPlantillas: string;
  soloLectura: boolean;
}

export interface ConfiguracionAvanzadaProyecto {
  telemetriaActiva: boolean;
  actualizacionesAutomaticas: boolean;
  confirmacionCierre: boolean;
  confirmacionSobrescritura: boolean;
  autoGuardadoActivo: boolean;
  autoGuardadoIntervalo: number;
  maximoUndo: number;
  maximoHistorial: number;
  maximoEventos: number;
  tamanoBufferReplay: number;
  compresionGuardado: boolean;
  cifradoGuardado: boolean;
  proxy?: { host: string; puerto: number; usuario?: string; contrasena?: string };
}

export interface ProjectState {
  id: string;
  nombre: string;
  ruta?: string;
  sampleRate: number;
  bitDepth: number;
  bpm: import('./tiempo').BPM;
  timeSignature: import('./tiempo').TimeSignature;
  timeline: import('./timeline').TimelineState;
  tracks: import('./tracks').Track[];
  routing: import('./routing').RoutingMatrix;
  master: import('./mezcla').MasterChannel;
  analysis: import('./analisis').ProjectAnalysis;
  metadata: import('./metadata').ProjectMetadata;
  capabilities: import('./capabilities').CapabilityRegistry;
  modificado: boolean;
  fechaCreacion: number;
  fechaModificacion: number;
  marcadores: import('./entidades').Marcador[];
  escenas: import('./entidades').Escena[];
  plantillaActual?: import('./entidades').Plantilla;
  historialAcciones: import('./command').Command[];
  version: number;
  configuracion: ConfiguracionProyecto;
  configuracionAvanzada: ConfiguracionAvanzadaProyecto;
  sesion?: SesionProyecto;
  ultimaExportacion?: ExportacionInfo;
  etiquetas: string[];
  archivado: boolean;
  estadisticas: EstadisticasProyecto;
  colaboracion: ColaboracionProyecto;
  versiones: VersionProyecto[];
  validacion: ValidacionProyecto;
  configuracionRenderizado: ConfiguracionRenderizado;
  comparacion?: ComparacionProyecto;
  checksum: string;
  tamanioBytes: number;
  ultimaCompaction: number;
  notasVersion: Record<string, string>;
}

export interface SesionProyecto {
  id: string;
  nombre: string;
  usuarioId: string;
  fechaCreacion: number;
  fechaModificacion: number;
  settings: Record<string, import('../events/evento-dominio').ValorJSON>;
}

export interface ExportacionInfo {
  formato: string;
  ruta: string;
  fecha: number;
  duracionMs: number;
}

export interface ColaboracionProyecto {
  compartido: boolean;
  proyectoId: string;
  usuarioId: string;
  usuarios: ColaboradorProyecto[];
  conflictos: ConflictoProyecto[];
  comentarios: ComentarioProyecto[];
  permisos: PermisosProyecto;
}

export interface ColaboradorProyecto {
  usuarioId: string;
  nombre: string;
  correo: string;
  avatar?: string;
  rol: 'owner' | 'editor' | 'viewer';
  fechaUnion: number;
  ultimaConexion: number;
}

export interface ConflictoProyecto {
  id: string;
  tipo: 'concurrent_edit' | 'delete_conflict' | 'dependency_conflict';
  estado: 'open' | 'resolved' | 'ignored';
  descripcion: string;
  fechaCreacion: number;
  usuarioAfectado: string;
  cambiosConflictivos: CambioConflicto[];
  resolucion?: ResolucionConflicto;
}

export interface CambioConflicto {
  campo: string;
  valorAnterior: import('../events/evento-dominio').ValorJSON;
  valorNuevo: import('../events/evento-dominio').ValorJSON;
  fuente: string;
}

export interface ResolucionConflicto {
  tipo: 'keep_local' | 'keep_remote' | 'merge';
  camposResueltos: string[];
  fechaResolucion: number;
  resueltoPor: string;
}

export interface ComentarioProyecto {
  id: string;
  usuarioId: string;
  texto: string;
  fechaCreacion: number;
  resuelto: boolean;
  resueltoPor?: string;
  fechaResolucion?: number;
  replies: ComentarioProyecto[];
}

export interface PermisosProyecto {
  editar: boolean;
  exportar: boolean;
  compartir: boolean;
  administrar: boolean;
}

export interface VersionProyecto {
  id: string;
  numero: number;
  nombre: string;
  fechaCreacion: number;
  usuarioId: string;
  descripcion: string;
  snapshot: ProjectState;
  checksum: string;
}

export interface ValidacionProyecto {
  errores: import('../types/command').ValidationError[];
  validada: boolean;
  ultimaValidacion: number;
}

export interface ConfiguracionRenderizado {
  formato: 'wav' | 'mp3' | 'ogg' | 'flac' | 'stem';
  bitrate: number;
  sampleRate: number;
  bitDepth: number;
  canales: number;
  rangoInicio: number;
  rangoFin: number;
  normalizar: boolean;
  dither: boolean;
  metadatos: Record<string, string>;
  incluirMarcadores: boolean;
  incluirMetadatos: boolean;
  rebobinadoTiempoReal: boolean;
  renderizarMaster: boolean;
  renderizarStems: boolean;
  stemsPorPista: boolean;
  stemsPorBus: boolean;
  stemsPorGrupo: boolean;
}

export interface ComparacionProyecto {
  versionA: string;
  versionB: string;
  fechaComparacion: number;
  diferencias: DiferenciaProyecto[];
  resumen: ResumenComparacion;
}

export interface DiferenciaProyecto {
  campo: string;
  valorA: import('../events/evento-dominio').ValorJSON;
  valorB: import('../events/evento-dominio').ValorJSON;
  tipo: 'added' | 'removed' | 'modified';
}

export interface ResumenComparacion {
  camposModificados: number;
  pistasAgregadas: number;
  pistasEliminadas: number;
  clipsAgregados: number;
  clipsEliminados: number;
}

export interface EstadisticasProyecto {
  duracionTotal: number;
  pistasTotales: number;
  pistasAudio: number;
  pistasMidi: number;
  pistasBus: number;
  pistasVCA: number;
  pistasCarpeta: number;
  clipsTotales: number;
  clipsAudio: number;
  clipsMidi: number;
  pluginsTotales: number;
  automatizacionesTotales: number;
  puntosAutomatizacion: number;
  marcadoresTotales: number;
  regionesTotales: number;
  escenasTotales: number;
  eventosTotales: number;
  tamanioProyectoBytes: number;
  tamanioMediosBytes: number;
  tamanioPluginsBytes: number;
  tiempoCargaMs: number;
  tiempoGuardadoMs: number;
  tiempoExportacionMs: number;
  usoCPU: number;
  usoMemoriaMB: number;
  usoDiscoMB: number;
  xruns: number;
  ultimoXrun: number;
  ciclosTiempoRealPerdidos: number;
  compasesTotales: number;
}
