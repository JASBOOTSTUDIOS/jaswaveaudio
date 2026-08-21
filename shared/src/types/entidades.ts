/**
 * Entidades auxiliares compartidas del dominio JasWave.
 *
 * Propósito:
 *   Centralizar interfaces de dominio que son utilizadas por múltiples
 *   submódulos de tipos (tracks, clips, routing, mezcla, etc.) sin
 *   generar dependencias circulares.
 *
 * Importancia:
 *   - Evita duplicación de definiciones entre archivos especializados.
 *   - Rompe ciclos de importación entre `index.ts` y los submódulos.
 *   - Facilita el mantenimiento al tener una única fuente de verdad
 *     para entidades compuestas como Fade, Marcador, VCA, etc.
 *
 * Función:
 *   Exporta interfaces de entidades transversales: Receive, Envio,
 *   Fade, Marcador, Region, Take, Version, Snapshot, Preset, Theme,
 *   Atajo, Historial, Cache, Proxy, ContextoIA, ClipAutomation,
 *   ParametroPluginOpciones, PluginInfo, AutomatizacionInfo,
 *   ParametroPlugin, PuntoAutomatizacion, Plantilla, Medio,
 *   Grabacion, Metronomo, Exportacion, Sesion, ControlMIDI,
 *   Hardware, RutaAudio, Loop, Escena, Notacion, Licencia, Nube,
 *   Actualizacion, Rendimiento, ControlSuperficie,
 *   ConfiguracionProyecto.
 */

import type { ValorJSON } from '../events/evento-dominio';

export interface Receive {
  trackOrigenId: string;
  volumen: number;
  paneo: number;
  muted: boolean;
}

export interface Fade {
  id: string;
  clipId: string;
  tipo: 'in' | 'out';
  duracion: number;
  curva: 'lineal' | 'exponencial' | 'logaritmica' | 'sine' | 'cuadratica';
}

export interface Marcador {
  id: string;
  nombre: string;
  tiempo: number;
  color: string;
  regionInicio?: number;
  regionFin?: number;
  seleccionado: boolean;
  tipo: 'marcador' | 'region';
  comentario?: string;
  icono?: string;
}

export interface Region {
  id: string;
  nombre: string;
  inicio: number;
  fin: number;
  color: string;
  trackIds: string[];
  seleccionada: boolean;
  loop: boolean;
  comentario?: string;
}

export interface Take {
  id: string;
  pistaId: string;
  nombre: string;
  inicioGrabacion: number;
  finGrabacion: number;
  archivo: string;
  formato: 'wav' | 'mp3' | 'ogg' | 'flac';
  sampleRate: number;
  bitDepth: number;
  canales: number;
  tamaño: number;
  seleccionado: boolean;
  muteado: boolean;
  notas: string;
}

export interface Version {
  id: string;
  proyectoId: string;
  nombre: string;
  descripcion: string;
  marcaTiempo: number;
  autor: string;
  tamanioBytes: number;
  etiquetas: string[];
  snapshot: Record<string, ValorJSON>;
}

export interface Snapshot {
  id: string;
  nombre: string;
  marcaTiempo: number;
  estado: Record<string, ValorJSON>;
  thumbnail?: string;
  notas: string;
}

export interface Preset {
  id: string;
  nombre: string;
  categoria: 'plugin' | 'mezcla' | 'proyecto' | 'plantilla' | 'control' | 'midi';
  tipo: string;
  datos: ValorJSON;
  autor: string;
  etiquetas: string[];
  creado: number;
  modificado: number;
  publico: boolean;
  descargado: number;
  valoracion: number;
}

export interface Theme {
  id: string;
  nombre: string;
  autor: string;
  fondo: string;
  superficie: string;
  borde: string;
  texto: string;
  textoSuave: string;
  acento: string;
  acentoSuave: string;
  error: string;
  advertencia: string;
  exito: string;
  scrollbar: string;
  seleccion: string;
  translucidez: number;
  fuente: string;
  tamanoFuente: number;
}

export interface Atajo {
  id: string;
  comando: string;
  tecla: string;
  modificadores: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  contexto: string;
  descripcion: string;
  categoria: string;
}

export interface Cache {
  archivos: Map<string, { datos: ArrayBuffer; marcaTiempo: number; ultimoAcceso: number }>;
  maximoBytes: number;
  bytesUsados: number;
}

export interface Proxy {
  id: string;
  nombre: string;
  tipo: 'audio' | 'midi';
  origen: string;
  destino: string;
  activo: boolean;
  parametros: Record<string, ValorJSON>;
}

export interface ContextoIA {
  proyectoId: string;
  usuarioId: string;
  herramientasDisponibles: string[];
  capacidades: string[];
  historialReciente: import('../events/evento-dominio').EventoDominio[];
  estadoActual: Record<string, ValorJSON>;
  sesionId: string;
  idioma: string;
  modo: 'asistido' | 'autonomo' | 'manual';
  permisos: string[];
}

export interface ClipAutomation {
  clipId: string;
  parametro: string;
  puntos: { tiempo: number; valor: number; tipoCurva: string }[];
  habilitada: boolean;
  modo: 'latch' | 'touch' | 'write';
}

export interface ParametroPluginOpciones {
  id: string;
  nombre: string;
  valor: number;
  minimo: number;
  maximo: number;
  paso: number;
  unidad: string;
  etiqueta: string;
  opciones?: { valor: number; etiqueta: string }[];
}

export interface PluginInfo {
  id: string;
  nombre: string;
  fabricante: string;
  tipo: string;
  bypass: boolean;
  parametros: ParametroPluginOpciones[];
  estado: 'cargado' | 'error' | 'pendiente';
  presetActual?: string;
  version: string;
  wet: number;
  entrada?: string;
  salida?: string;
  latencia: number;
  icono?: string;
  categoria: string;
  autor: string;
  licencia: string;
  descripcion: string;
  sitioWeb?: string;
  manualUrl?: string;
  ui: {
    ancho: number;
    alto: number;
    personalizable: boolean;
  };
}

export interface AutomatizacionInfo {
  id: string;
  trackId: string;
  parametro: string;
  puntos: PuntoAutomatizacion[];
  grabando: boolean;
  modo: 'latch' | 'touch' | 'write';
  escalaMinima: number;
  escalaMaxima: number;
  suavizado: number;
  resolucion: number;
  interpolacion: 'lineal' | 'exponencial' | 'logaritmica' | 'sine' | 'cuadratica' | 'sostenido';
  habilitada: boolean;
  color: string;
}

export interface PuntoAutomatizacion {
  tiempo: number;
  valor: number;
  tipoCurva: 'lineal' | 'exponencial' | 'logaritmica' | 'sine' | 'cuadratica' | 'sostenido';
  suavizado: number;
  tension: number;
  seleccionado: boolean;
}

export interface Plantilla {
  id: string;
  nombre: string;
  categoria: string;
  icono?: string;
  datos: ValorJSON;
  autor: string;
  etiquetas: string[];
  creada: number;
  modificada: number;
  descripcion: string;
  version: string;
  publica: boolean;
  descargas: number;
  valoracion: number;
}

export interface Medio {
  id: string;
  nombre: string;
  tipo: 'audio' | 'video' | 'midi';
  ruta: string;
  duracion: number;
  tamanoBytes: number;
  waveform?: number[];
  sampleRate?: number;
  canales?: number;
  bitDepth?: number;
  metadatos: Record<string, ValorJSON>;
  checksum: string;
  importado: number;
  ultimoAcceso: number;
  usado: boolean;
  favorito: boolean;
  etiquetas: string[];
}

export interface Grabacion {
  pistaId: string;
  estado: 'inactiva' | 'armada' | 'grabando' | 'pausada';
  archivo?: string;
  formato: 'wav' | 'mp3' | 'ogg' | 'flac';
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
  takes: Take[];
  takeActualId?: string;
  compasesGrabados: number;
  notas: string;
}

export interface Metronomo {
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
  patronAcento: boolean[];
  sonido: 'click' | 'beep' | 'drum' | 'custom';
  rutaSonido?: string;
  volumen: number;
}

export interface Exportacion {
  formato: 'wav' | 'mp3' | 'ogg' | 'flac' | 'stem';
  bitrate: number;
  ruta: string;
  progreso: number;
  estado: 'inactiva' | 'exportando' | 'completada' | 'error' | 'cancelada';
  error?: string;
  tareasPendientes: number;
  rangoInicio: number;
  rangoFin: number;
  normalizar: boolean;
  dither: boolean;
  metadatos: Record<string, ValorJSON>;
  incluirMarcadores: boolean;
  incluirMetadatos: boolean;
}

export interface Sesion {
  id: string;
  nombre: string;
  proyectoId: string;
  fechaCreacion: number;
  fechaModificacion: number;
  estado: 'activa' | 'guardada' | 'cerrada';
  puntoControlId?: string;
  dispositivoId?: string;
  usuarioId?: string;
  compartida: boolean;
  permisos: string[];
}

export interface ControlMIDI {
  id: string;
  nombre: string;
  dispositivo: string;
  fabricante?: string;
  modelo?: string;
  mapeo: Record<number, { evento: string; parametro: string }>;
  conectado: boolean;
  entrada: boolean;
  salida: boolean;
  canalInicio: number;
  canalFin: number;
  modo: 'note' | 'cc' | 'pitch' | 'sysex' | 'reloj';
  nombreDisplay: string;
  color: string;
  firmware?: string;
  ultimaConexion: number;
}

export interface Hardware {
  id: string;
  tipo: 'interfaz_audio' | 'controlador_midi' | 'superficie' | 'microfono' | 'altavoz';
  nombre: string;
  fabricante: string;
  modelo: string;
  conectado: boolean;
  entradas: number;
  salidas: number;
  sampleRate: number;
  bufferSize: number;
  controladoresVinculados: string[];
  color: string;
  nombreDisplay: string;
  driver: string;
  latenciaEntrada: number;
  latenciaSalida: number;
  firmware?: string;
  ultimoTest: number;
}

export interface RutaAudio {
  id: string;
  nombre: string;
  tipo: 'envio' | 'bus' | 'sidechain';
  origen: string;
  destino: string;
  cantidad: number;
  pan: number;
  activa: boolean;
  color: string;
  comentario?: string;
}

export interface Loop {
  id: string;
  nombre: string;
  pistaId: string;
  inicio: number;
  duracion: number;
  sincronizado: boolean;
  cuantizado: boolean;
  estado: 'detenido' | 'reproduciendo' | 'grabando';
  swing: number;
  velocidad: number;
  inverso: boolean;
}

export interface Escena {
  id: string;
  nombre: string;
  clips: { clipId: string; pistaId: string; estado: 'detenido' | 'reproduciendo' | 'grabando' }[];
  color: string;
  seleccionada: boolean;
  icono?: string;
  bucle: boolean;
  transicion: 'instantanea' | 'crossfade';
  crossfadeDuracion: number;
}

export interface Notacion {
  compases: number;
  clave: 'sol' | 'fa' | 'do';
  transportarSincronizado: boolean;
  tempoVisible: boolean;
  nombresNotas: 'latinos' | 'ingleses' | 'alemanes';
  mostrarOctava: boolean;
  mostrarCompas: boolean;
  mostrarClave: boolean;
  mostrarSilencios: boolean;
  escala: string;
  modo: string;
  transposicion: number;
}

export interface Licencia {
  tipo: 'gratuita' | 'personal' | 'profesional' | 'enterprise';
  activada: boolean;
  expiracion: number;
  caracteristicas: string[];
  email?: string;
  dispositivoId?: string;
  nombreUsuario?: string;
  organizacion?: string;
  telefono?: string;
  direccion?: string;
  facturacion?: Record<string, ValorJSON>;
}

export interface Nube {
  estado: 'desconectado' | 'conectado' | 'sincronizando' | 'error';
  ultimaSincronizacion: number;
  conflicto: boolean;
  proyectoCompartidoId?: string;
  usuarioId?: string;
  espacioUsadoBytes: number;
  espacioTotalBytes: number;
  servidor: string;
  puerto: number;
  ssl: boolean;
  sincronizacionAutomatica: boolean;
  conflictosResueltos: number;
}

export interface Actualizacion {
  version: string;
  disponible: boolean;
  progreso: number;
  estado: 'sin_actualizaciones' | 'disponible' | 'descargando' | 'descargada' | 'instalando' | 'instalada' | 'error' | 'omitida';
  notas?: string;
  tamanoBytes?: number;
  urlDescarga?: string;
  obligatoria: boolean;
  criticidad: 'baja' | 'media' | 'alta' | 'critica';
  fechaLanzamiento: number;
  notasTecnicas?: string;
  hashVerificacion?: string;
}

export interface Rendimiento {
  cpuUso: number;
  memoriaUsoMB: number;
  discoUsoMB: number;
  xruns: number;
  bufferSize: number;
  sampleRate: number;
  hilosUtilizados: number;
  latenciaMs: number;
  historialCPU: number[];
  historialMemoria: number[];
  historialXruns: number[];
  maximoHistorial: number;
}

export interface ControlSuperficie {
  id: string;
  nombre: string;
  fabricante: string;
  modelo: string;
  capa: number;
  controles: { id: number; tipo: 'fader' | 'knob' | 'button' | 'pad'; valor: number; etiqueta?: string }[];
  conectado: boolean;
  color: string;
  nombreDisplay: string;
  firmware?: string;
  ultimaConexion: number;
  controladoresVinculados: string[];
}

