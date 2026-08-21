/**
 * API de consulta del DAW para el sistema de IA.
 *
 * Propósito:
 *   Proveer una interfaz de consulta determinista y sin efectos secundarios
 *   que la IA utiliza para leer el estado del DAW y emitir sugerencias
 *   o ejecutar herramientas.
 *
 * Importancia:
 *   - Aísla la capa de IA de la implementación interna del estado,
 *     permitiendo evolucionar el modelo sin romper contratos.
 *   - Garantiza que las consultas sean seguras, rápidas y trazables.
 *   - Facilita el debugging y la auditoría de decisiones de la IA.
 *
 * Función:
 *   Exporta DAWQuery, ResumenProyecto, FiltroPista, ElementosSeleccionados,
 *   DescriptorPlugin, ResumenAnalisisAudio, CarrilAutomatizacion,
 *   CapabilityDescriptor, ResumenEventoDominio, ContextoIA,
 *   ResultadoBusquedaProyecto y métodos adicionales para búsqueda,
 *   exportación de estado y análisis predictivo.
 */

import type { EventoDominio, ValorJSON } from '../events/evento-dominio';
import type { ProjectState, ConfiguracionProyecto } from './proyecto';
import type { Track } from './tracks';
import type { Clip } from './clips';
import type { PluginInfo } from './entidades';
import type { AutomatizacionInfo } from './entidades';
import type { RoutingMatrix } from './routing';
import type { AudioAnalysis } from './analisis';
import type { CapabilityDescriptor } from './capabilities';
import type { TransportState } from './transport';
import type { Marcador } from './entidades';
import type { Medio } from './entidades';
import type { ContextoIA } from './entidades';
import type { OpcionesDuplicado, ResultadoDuplicado, ResultadoDuplicadoEspecifico } from './duplicado';

export interface ResumenProyecto {
  nombre: string;
  bpm: number;
  compas: number;
  duracion: number;
  sampleRate: number;
  bitDepth: number;
  pistas: number;
  clips: number;
  plugins: number;
  modificado: boolean;
  marcadores: number;
  escenas: number;
  tomasGrabadas: number;
  tomasSeleccionadas: number;
  estadisticas: {
    usoCPU: number;
    usoMemoriaMB: number;
    xruns: number;
    latenciaMs: number;
  };
}

export interface FiltroPista {
  tipo?: 'audio' | 'midi' | 'instrumento' | 'carpeta' | 'bus';
  nombre?: string;
  soloActiva?: boolean;
  silenciada?: boolean;
  armada?: boolean;
  color?: string;
  pluginId?: string;
  etiqueta?: string;
}

export interface ElementosSeleccionados {
  idsPistas: string[];
  idsClips: string[];
  idsMarcadores: string[];
  idsPuntosAutomatizacion: string[];
  idsParametrosPlugin: { pluginId: string; parametroId: string }[];
}

export interface DescriptorPlugin {
  id: string;
  nombre: string;
  fabricante: string;
  tipo: string;
  parametros: { id: string; nombre: string; valor: number }[];
  bypass: boolean;
  version: string;
  categoria: string;
  autor: string;
  descripcion: string;
  licencia: string;
  icono?: string;
}

export interface ResumenAnalisisAudio {
  idPista?: string;
  nivelPico: number;
  nivelRMS: number;
  recorte: boolean;
  espectro: { frecuencia: number; magnitud: number }[];
  frecuenciaFundamental?: number;
  notaFundamental?: string;
  lufs: number;
  rangoDinamico: number;
  fase: number;
  correlacionEstereo: number;
}

export interface CarrilAutomatizacion {
  idPista: string;
  parametro: string;
  puntos: { tiempo: number; valor: number }[];
  grabando: boolean;
  modo: string;
  color: string;
  escalaMinima: number;
  escalaMaxima: number;
  suavizado: number;
}

export interface ResumenEventoDominio {
  nombre: string;
  marcaTiempo: number;
  fuente: string;
  cargaUtil: Record<string, unknown>;
}

export interface ResultadoBusquedaProyecto {
  tipo: 'pista' | 'clip' | 'marcador' | 'plugin' | 'medio' | 'evento' | 'region' | 'toma';
  id: string;
  nombre: string;
  descripcion: string;
  relevancia: number;
  entidadPadreId?: string;
  metadatos?: Record<string, ValorJSON>;
}

export interface ConsultaTransporte {
  reproduciendo: boolean;
  posicion: number;
  bpm: number;
  modo: string;
  loopActivo: boolean;
  punchIn: number;
  punchOut: number;
  metronomoActivo: boolean;
  grabando: boolean;
  sincronizado: boolean;
  relojMaestro: string | null;
}

export interface ConsultaMezcla {
  canales: {
    idPista: string;
    volumen: number;
    paneo: number;
    silenciado: boolean;
    solo: boolean;
    nivelPico: number;
    nivelRMS: number;
    reduccionGanancia: number;
  }[];
  master: {
    volumen: number;
    paneo: number;
    silenciado: boolean;
    solo: boolean;
    nivelPico: number;
    nivelRMS: number;
    reduccionGanancia: number;
    limitador: {
      activo: boolean;
      umbral: number;
      gananciaSalida: number;
      liberacion: number;
    };
  };
}

export interface ConsultaRuteo {
  buses: {
    id: string;
    nombre: string;
    tipo: string;
    volumen: number;
    paneo: number;
    silenciado: boolean;
    solo: boolean;
    envios: { idBusDestino: string; cantidad: number }[];
  }[];
  envios: {
    id: string;
    idPistaOrigen: string;
    idBusDestino: string;
    cantidad: number;
    pan: number;
    activo: boolean;
    preFader: boolean;
  }[];
  rutas: {
    id: string;
    origen: string;
    destino: string;
    tipo: string;
    activa: boolean;
  }[];
  sidechains: {
    id: string;
    idPistaOrigen: string;
    idPistaDestino: string;
    activo: boolean;
    cantidad: number;
  }[];
}

export interface ConsultaMedios {
  medios: {
    id: string;
    nombre: string;
    tipo: string;
    ruta: string;
    duracion: number;
    tamanoBytes: number;
    sampleRate?: number;
    canales?: number;
    bitDepth?: number;
    favorito: boolean;
    etiquetas: string[];
    ultimoAcceso: number;
  }[];
  totales: {
    cantidad: number;
    tamanoTotalBytes: number;
    porTipo: Record<string, number>;
    porFormato: Record<string, number>;
  };
}

export interface ConsultaConfiguracion {
  audio: {
    sampleRate: number;
    bitDepth: number;
    bufferSize: number;
    dispositivoEntrada: string;
    dispositivoSalida: string;
    ditherActivo: boolean;
    oversampling: number;
    prioridadCPU: string;
  };
  metronomo: {
    activo: boolean;
    tempo: number;
    compas: number;
    subdivision: number;
    sonido: string;
    volumen: number;
  };
  ui: {
    tema: string;
    idioma: string;
    herramientaActiva: string;
    modoEdicion: string;
    zoomHorizontal: number;
    zoomVertical: number;
  };
  grabacion: {
    cuantizacion: number;
    delayCompensacion: number;
    filtrosActivos: boolean;
    sobreescritura: boolean;
    loop: boolean;
  };
  midi: ConfiguracionProyecto;
}

export interface ConsultaRendimiento {
  cpu: {
    uso: number;
    historial: number[];
    hilosUtilizados: number;
    proceso: string;
  };
  memoria: {
    usoMB: number;
    historial: number[];
    buffers: number;
    cache: number;
  };
  disco: {
    usoMB: number;
    lecturaMBs: number;
    escrituraMBs: number;
    espacioLibreGB: number;
  };
  audio: {
    xruns: number;
    historialXruns: number[];
    bufferSize: number;
    sampleRate: number;
    latenciaMs: number;
  };
}

export interface ConsultaSugerenciaIA {
  id: string;
  tipo: 'mejora' | 'error' | 'advertencia' | 'optimizacion' | 'creativa';
  parametro: string;
  sugerencia: string;
  impacto: 'bajo' | 'medio' | 'alto';
  confianza: number;
  pasos?: string[];
  alternativas?: string[];
  eventosRelacionados: string[];
  entidadesAfectadas: string[];
}

export interface ConsultaHistorial {
  acciones: {
    id: string;
    tipo: string;
    nombre: string;
    descripcion: string;
    marcaTiempo: number;
    exito: boolean;
    duracionMs: number;
  }[];
  totales: {
    acciones: number;
    errores: number;
    advertencias: number;
    comandos: number;
    eventos: number;
  };
  ultimaAccion?: {
    id: string;
    nombre: string;
    marcaTiempo: number;
  };
}

export interface ConsultaExportacion {
  estado: string;
  progreso: number;
  formato: string;
  bitrate: number;
  ruta: string;
  error?: string;
  tareasPendientes: number;
  tiempoEstimadoMs: number;
  inicio: number;
  normalizar: boolean;
  dither: boolean;
}

export interface ConsultaHardware {
  dispositivos: {
    id: string;
    tipo: string;
    nombre: string;
    fabricante: string;
    modelo: string;
    conectado: boolean;
    entradas: number;
    salidas: number;
    sampleRate: number;
    bufferSize: number;
    latenciaEntrada: number;
    latenciaSalida: number;
  }[];
  controladoresMIDI: {
    id: string;
    nombre: string;
    fabricante: string;
    modelo: string;
    conectado: boolean;
    entradas: number;
    salidas: number;
    modosSoportados: string[];
  }[];
  superficiesControl: {
    id: string;
    nombre: string;
    fabricante: string;
    modelo: string;
    conectado: boolean;
    capa: number;
    controles: number;
  }[];
}

export interface ConsultaLicencia {
  tipo: string;
  activada: boolean;
  expiracion: number;
  caracteristicas: string[];
  usuario?: string;
  organizacion?: string;
  dispositivosActivos: number;
  dispositivosMaximos: number;
}

export interface ConsultaNube {
  estado: string;
  ultimaSincronizacion: number;
  conflicto: boolean;
  usuarioId?: string;
  proyectoCompartidoId?: string;
  espacioUsadoBytes: number;
  espacioTotalBytes: number;
  servidor: string;
  sincronizacionAutomatica: boolean;
  conflictosResueltos: number;
}

export interface ConsultaActualizacion {
  disponible: boolean;
  version: string;
  progreso: number;
  estado: string;
  criticidad: string;
  fechaLanzamiento: number;
  tamanoBytes?: number;
  notas?: string;
}

export interface ConsultaCapabilidades {
  licenciaTipo: string;
  licenciaExpiracion: number | null;
  capacidades: {
    id: string;
    nombre: string;
    descripcion: string;
    activa: boolean;
    razonInactiva?: string;
  }[];
  hardwareConectado: string[];
  pluginsDisponibles: string[];
}

export interface ConsultaMarcadores {
  marcadores: {
    id: string;
    nombre: string;
    tiempo: number;
    color: string;
    tipo: string;
    regionInicio?: number;
    regionFin?: number;
    comentario?: string;
  }[];
  regiones: {
    id: string;
    nombre: string;
    inicio: number;
    fin: number;
    color: string;
    loop: boolean;
  }[];
}

export interface ConsultaEscenas {
  escenas: {
    id: string;
    nombre: string;
    seleccionada: boolean;
    bucle: boolean;
    transicion: string;
    crossfadeDuracion: number;
    clips: { idClip: string; idPista: string; estado: string }[];
  }[];
  escenaActualId?: string;
}

export interface ConsultaTomas {
  tomas: {
    id: string;
    idPista: string;
    nombre: string;
    estado: string;
    archivo: string;
    formato: string;
    sampleRate: number;
    bitDepth: number;
    canales: number;
    seleccionada: boolean;
    muteada: boolean;
  }[];
  tomaActualId?: string;
}

export interface ConsultaPresets {
  presets: {
    id: string;
    nombre: string;
    categoria: string;
    autor: string;
    etiquetas: string[];
    publico: boolean;
    descargas: number;
    valoracion: number;
  }[];
}

export interface ConsultaTemas {
  temaActual: {
    id: string;
    nombre: string;
    autor: string;
    fondo: string;
    superficie: string;
    borde: string;
    texto: string;
    acento: string;
    fuente: string;
    tamanoFuente: number;
  };
  temasDisponibles: {
    id: string;
    nombre: string;
    autor: string;
    publico: boolean;
    descargas: number;
    valoracion: number;
  }[];
}

export interface ConsultaAtajos {
  atajos: {
    comando: string;
    tecla: string;
    modificadores: string[];
    contexto: string;
    descripcion: string;
    categoria: string;
  }[];
  conflictoConSistema: boolean;
  atajosPersonalizados: number;
}

export interface ConsultaCache {
  archivos: {
    clave: string;
    tamanoBytes: number;
    marcaTiempo: number;
    ultimoAcceso: number;
    tipo: string;
  }[];
  totales: {
    archivos: number;
    bytesUsados: number;
    bytesMaximos: number;
    hitRate: number;
  };
}

export interface ConsultaProxies {
  proxies: {
    id: string;
    nombre: string;
    tipo: string;
    origen: string;
    destino: string;
    activo: boolean;
    parametros: Record<string, ValorJSON>;
  }[];
}

export interface ConsultaContextoIA {
  proyectoId: string;
  usuarioId: string;
  herramientasDisponibles: string[];
  capacidades: string[];
  modo: string;
  idioma: string;
  sesionId: string;
  historialReciente: {
    nombre: string;
    marcaTiempo: number;
    fuente: string;
  }[];
  estadoActual: Record<string, ValorJSON>;
}

export interface ConsultaClip {
  id: string;
  nombre: string;
  idPista: string;
  tipo: string;
  inicio: number;
  duracion: number;
  seleccionado: boolean;
  fadeIn: { duracion: number; curva: string } | null;
  fadeOut: { duracion: number; curva: string } | null;
  warp: boolean;
  velocidad: number;
  inverso: boolean;
  fuente?: {
    ruta: string;
    duracion: number;
    sampleRate: number;
    canales: number;
    bitDepth: number;
  };
}

export interface ConsultaPista {
  id: string;
  nombre: string;
  tipo: string;
  color: string;
  silenciada: boolean;
  soloActiva: boolean;
  armada: boolean;
  volumen: number;
  paneo: number;
  clips: ConsultaClip[];
  plugins: DescriptorPlugin[];
  automatizaciones: CarrilAutomatizacion[];
  envios: { idBus: string; cantidad: number }[];
  receives: { idPistaOrigen: string; cantidad: number }[];
}

export interface ConsultaAutomatizacion {
  carriles: {
    idPista: string;
    parametro: string;
    puntos: { tiempo: number; valor: number }[];
    grabando: boolean;
    modo: string;
    color: string;
  }[];
  totalPuntos: number;
  carrilesActivos: number;
  carrilesGrabando: number;
}

export interface ConsultaRouting {
  buses: {
    id: string;
    nombre: string;
    tipo: string;
    volumen: number;
    paneo: number;
    silenciado: boolean;
    solo: boolean;
    envios: { idBusDestino: string; cantidad: number }[];
  }[];
  envios: {
    id: string;
    idPistaOrigen: string;
    idBusDestino: string;
    cantidad: number;
    pan: number;
    activo: boolean;
    preFader: boolean;
  }[];
  sidechains: {
    id: string;
    idPistaOrigen: string;
    idPistaDestino: string;
    activo: boolean;
    cantidad: number;
  }[];
}

export interface ConsultaAnalisis {
  pistas: ResumenAnalisisAudio[];
  master: ResumenAnalisisAudio;
  resumen: {
    duracionTotal: number;
    pistasActivas: number;
    clipsTotales: number;
    usoCPU: number;
    usoMemoriaMB: number;
    xruns: number;
    latenciaMs: number;
  };
  histograma: {
    frecuencias: number[];
    magnitudes: number[];
  };
}

export interface ConsultaMetronomo {
  activo: boolean;
  tempo: number;
  compas: number;
  subdivision: number;
  tiempoActual: number;
  tiempoMarcado: number;
  sonando: boolean;
  sonidoInicio: boolean;
  sonidoCompas: boolean;
  sonidoSubdivision: boolean;
  sonido: string;
  volumen: number;
}

export interface ConsultaGrabacion {
  estado: string;
  pistaId?: string;
  archivo?: string;
  formato: string;
  sampleRate: number;
  bitDepth: number;
  canales: number;
  entradaDetectada: boolean;
  nivelEntrada: number;
  nivelPico: number;
  punchIn: number;
  punchOut: number;
  loop: boolean;
  metronomo: boolean;
  takes: {
    id: string;
    nombre: string;
    seleccionada: boolean;
    muteada: boolean;
  }[];
  takeActualId?: string;
  compasesGrabados: number;
}

export interface ConsultaSincronizacion {
  estado: string;
  ultimaSincronizacion: number;
  relojSincronizado: boolean;
  relojMaestro: string | null;
  seguidores: string[];
  dispositivoEncontrado?: string;
  error?: string;
}

export interface ConsultaControlMIDI {
  controladores: {
    id: string;
    nombre: string;
    fabricante: string;
    modelo: string;
    conectado: boolean;
    entrada: boolean;
    salida: boolean;
    modosSoportados: string[];
    latenciaEntrada: number;
    latenciaSalida: number;
  }[];
  mapeos: {
    id: string;
    nombre: string;
    activo: boolean;
    aprendizaje: boolean;
    entrada: { canal: number | string; tipo: string; numero: number | string };
    salida: { parametroId: string; accion?: string };
  }[];
}

export interface ConsultaLoop {
  loops: {
    id: string;
    nombre: string;
    idPista: string;
    inicio: number;
    duracion: number;
    sincronizado: boolean;
    cuantizado: boolean;
    estado: string;
    swing: number;
    velocidad: number;
    inverso: boolean;
  }[];
  loopGlobalActivo: boolean;
}

export interface ConsultaNotacion {
  compases: number;
  clave: string;
  transportarSincronizado: boolean;
  tempoVisible: boolean;
  nombresNotas: string;
  mostrarOctava: boolean;
  mostrarCompas: boolean;
  mostrarClave: boolean;
  mostrarSilencios: boolean;
  escala: string;
  modo: string;
  transposicion: number;
}

export interface ConsultaVCA {
  vcas: {
    id: string;
    nombre: string;
    nivel: number;
    solo: boolean;
    silenciado: boolean;
    paneo: number;
    tracksVinculadas: string[];
  }[];
}

export interface ConsultaFades {
  fades: {
    id: string;
    idClip: string;
    tipo: string;
    duracion: number;
    curva: string;
  }[];
}

export interface ConsultaPlantillas {
  plantillas: {
    id: string;
    nombre: string;
    categoria: string;
    autor: string;
    etiquetas: string[];
    publica: boolean;
    descargas: number;
    valoracion: number;
  }[];
}

export interface ConsultaSesion {
  id: string;
  nombre: string;
  estado: string;
  fechaCreacion: number;
  fechaModificacion: number;
  compartida: boolean;
  puntoControlId?: string;
  usuarioId?: string;
}

export interface ConsultaEstado {
  proyecto: ResumenProyecto;
  transporte: ConsultaTransporte;
  seleccion: ElementosSeleccionados;
  ui: {
    tema: string;
    idioma: string;
    herramientaActiva: string;
    modoEdicion: string;
    zoomHorizontal: number;
    zoomVertical: number;
    panelActivo: string | null;
    paletaComandosAbierta: boolean;
  };
  mezcla: ConsultaMezcla;
  ruteo: ConsultaRuteo;
  analisis: ResumenAnalisisAudio[];
  metronomo: ConsultaMetronomo;
  grabacion: ConsultaGrabacion;
  exportacion: ConsultaExportacion;
  sincronizacion: ConsultaSincronizacion;
  controlMIDI: ConsultaControlMIDI;
  hardware: ConsultaHardware;
  loops: ConsultaLoop;
  escenas: ConsultaEscenas;
  notacion: ConsultaNotacion;
  vcas: ConsultaVCA;
  fades: ConsultaFades;
  marcadores: ConsultaMarcadores;
  plantillas: ConsultaPlantillas;
  sesion: ConsultaSesion;
  rendimiento: ConsultaRendimiento;
  actualizacion: ConsultaActualizacion;
  nube: ConsultaNube;
  licencia: ConsultaLicencia;
  capabilidades: ConsultaCapabilidades;
  contextoIA: ConsultaContextoIA;
  historial: ConsultaHistorial;
  cache: ConsultaCache;
  proxies: ConsultaProxies;
}

export interface ConsultaBusqueda {
  termino: string;
  filtros: {
    tipos?: ('pista' | 'clip' | 'marcador' | 'plugin' | 'medio' | 'evento' | 'region' | 'toma')[];
    idPista?: string;
    idPlugin?: string;
    desdeMarcaTiempo?: number;
    hastaMarcaTiempo?: number;
    soloFavoritos?: boolean;
    soloEtiquetas?: string[];
  };
  limite: number;
  ordenarPor: 'relevancia' | 'nombre' | 'marcaTiempo' | 'tipo';
  ordenDir: 'asc' | 'desc';
}

export interface ConsultaExportacionEstado {
  incluirProyecto: boolean;
  incluirTransporte: boolean;
  incluirSeleccion: boolean;
  incluirUI: boolean;
  incluirMezcla: boolean;
  incluirRuteo: boolean;
  incluirAnalisis: boolean;
  incluirMetronomo: boolean;
  incluirGrabacion: boolean;
  incluirExportacion: boolean;
  incluirSincronizacion: boolean;
  incluirControlMIDI: boolean;
  incluirHardware: boolean;
  incluirLoops: boolean;
  incluirEscenas: boolean;
  incluirNotacion: boolean;
  incluirVCAs: boolean;
  incluirFades: boolean;
  incluirMarcadores: boolean;
  incluirPlantillas: boolean;
  incluirSesion: boolean;
  incluirRendimiento: boolean;
  incluirActualizacion: boolean;
  incluirNube: boolean;
  incluirLicencia: boolean;
  incluirCapabilidades: boolean;
  incluirContextoIA: boolean;
  incluirHistorial: boolean;
  incluirCache: boolean;
  incluirProxies: boolean;
}

export interface ConsultaPrediccion {
  tipo: 'mejora' | 'error' | 'advertencia' | 'optimizacion' | 'creativa';
  parametro: string;
  sugerencia: string;
  impacto: 'bajo' | 'medio' | 'alto';
  confianza: number;
  pasos?: string[];
  alternativas?: string[];
  eventosRelacionados: string[];
  entidadesAfectadas: string[];
}

export interface ConsultaDiffs {
  versionA: string;
  versionB: string;
  incluirProyecto: boolean;
  incluirTracks: boolean;
  incluirClips: boolean;
  incluirPlugins: boolean;
  incluirAutomatizacion: boolean;
  incluirMezcla: boolean;
  incluirMetadatos: boolean;
  incluirRouting: boolean;
  incluirMarcadores: boolean;
  incluirEscenas: boolean;
}

export interface ConsultaReporte {
  tipo: 'estado' | 'rendimiento' | 'errores' | 'uso' | 'comparacion' | 'historial';
  formato: 'json' | 'csv' | 'pdf' | 'html';
  incluirGraficas: boolean;
  incluirDetalles: boolean;
  rangoInicio?: number;
  rangoFin?: number;
}

export interface ConsultaBatch {
  consultas: {
    id: string;
    metodo: keyof DAWQuery;
    parametros: Record<string, unknown>;
  }[];
  toleranteFallos: boolean;
  tiempoLimiteMs: number;
}

export interface DAWQuery {
  obtenerResumenProyecto(): ResumenProyecto;
  obtenerPistas(filtro?: FiltroPista): Track[];
  obtenerElementosSeleccionados(): ElementosSeleccionados;
  obtenerClip(id: string): ConsultaClip | null;
  obtenerPlugins(): DescriptorPlugin[];
  obtenerParametroPlugin(idPlugin: string, idParametro: string): { valor: number; minimo: number; maximo: number } | null;
  obtenerAnalisisAudio(idPista?: string): ResumenAnalisisAudio | null;
  obtenerRuteo(): ConsultaRuteo;
  obtenerAutomatizacion(idPista?: string): CarrilAutomatizacion[];
  obtenerEventosRecientes(limite?: number): ResumenEventoDominio[];
  obtenerCapabilidades(): CapabilityDescriptor[];
  obtenerTransporte(): ConsultaTransporte;
  obtenerCanalesMezcla(): { idPista: string; volumen: number; paneo: number; silenciado: boolean; solo: boolean }[];
  obtenerNivelesMaster(): { pico: number; rms: number };
  obtenerMarcadores(): ConsultaMarcadores;
  obtenerMedios(filtro?: { tipo?: string; etiqueta?: string }): ConsultaMedios;
  obtenerConfiguracion(): ConfiguracionProyecto;
  obtenerContextoIA(): ConsultaContextoIA;
  buscar(consulta: string, limite?: number): ResultadoBusquedaProyecto[];
  exportarEstado(): Record<string, ValorJSON>;
  predecirMejora(): ConsultaPrediccion[];
  obtenerEstado(): ConsultaEstado;
  buscarAvanzado(consulta: ConsultaBusqueda): ResultadoBusquedaProyecto[];
  exportarEstadoAvanzado(config: ConsultaExportacionEstado): Record<string, ValorJSON>;
  predecirMejoraAvanzada(filtros?: { tipos?: string[]; impacto?: string[] }): ConsultaPrediccion[];
  obtenerDiffs(consulta: ConsultaDiffs): {
    diferencias: {
      tipo: string;
      entidadId: string;
      campo: string;
      valorA: ValorJSON;
      valorB: ValorJSON;
    }[];
    resumen: {
      cambiosTotales: number;
      cambiosCriticos: number;
      pistasModificadas: number;
      clipsModificados: number;
      pluginsModificados: number;
    };
  };
  generarReporte(consulta: ConsultaReporte): ValorJSON;
  ejecutarConsultaBatch(consulta: ConsultaBatch): ValorJSON[];
  duplicarEntidad(opciones: OpcionesDuplicado): ResultadoDuplicado;
  duplicarPista(idPista: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarClip(idClip: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarPlugin(idPlugin: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarAutomatizacion(idAutomatizacion: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarMarcador(idMarcador: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarRegion(idRegion: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarVCA(idVCA: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarBus(idBus: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarLoop(idLoop: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarEscena(idEscena: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarPreset(idPreset: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarPlantilla(idPlantilla: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarMedio(idMedio: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
  duplicarToma(idToma: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico;
}
