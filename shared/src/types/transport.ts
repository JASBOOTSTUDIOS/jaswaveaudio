/**
 * Estado del transporte del DAW.
 *
 * Propósito:
 *   Representar el estado global de reproducción, grabación y sincronización
 *   del DAW, incluyendo posición, modo, punch, loop, metrónomo, sincronización,
 *   historial, métricas y configuraciones avanzadas.
 *
 * Importancia:
 *   - Centraliza el control de transporte para UI, motor de audio,
 *     grabación, exportación y sincronización externa.
 *   - Permite reactivar el transporte desde eventos del bus sin perder
 *     el contexto temporal.
 *   - Facilita la consulta determinista de la IA sobre el estado actual.
 *
 * Función:
 *   Exporta TransportState, TransportMode, GrabacionEstado y una completa
 *   colección de interfaces y helpers para el dominio de transporte,
 *   incluyendo sync, reloj, timecode, métricas, historial, configuraciones
 *   y estados especializados.
 */

import type { TimePosition, TimeDuration, BPM, TimeSignature } from './tiempo';
import type { SincronizacionReloj, MTC, Link } from './tiempo';

export type TransportMode = 'normal' | 'loop' | 'punch' | 'stop' | 'pause' | 'record' | 'rewind' | 'fastForward' | 'shuttle';
export type GrabacionEstado = 'inactiva' | 'armada' | 'grabando' | 'pausada';
export type ModoGrabacion = 'normal' | 'loop' | 'punch' | 'comping' | 'sobrescritura' | 'stack';
export type ModoSincronizacion = 'interno' | 'externo' | 'mtc' | 'midiClock' | 'reWire' | 'link' | 'ableton' | 'manual';
export type ShuttleMode = 'linear' | 'logarithmic' | 'exponential';
export type PunchMode = 'in' | 'out' | 'both' | 'none';
export type LoopMode = 'loop' | 'punch' | 'repeat' | 'custom' | 'none';

export interface TransportState {
  reproduciendo: boolean;
  posicion: TimePosition;
  bpm: number;
  modo: TransportMode;
  loop: {
    activo: boolean;
    inicio: TimePosition;
    fin: TimePosition;
    duracion: TimeDuration;
    modo: LoopMode;
    contador: number;
    nombre?: string;
  };
  punch: {
    activo: boolean;
    inicio: TimePosition;
    fin: TimePosition;
    modo: PunchMode;
    nombre?: string;
  };
  metronomo: {
    activo: boolean;
    tempo: number;
    compas: number;
    subdivision: number;
    tiempoSonando: boolean;
    tiempoMarcado: number;
    sonidoInicio: boolean;
    sonidoCompas: boolean;
    sonidoSubdivision: boolean;
    patronAcento: boolean[];
    sonido: 'click' | 'beep' | 'drum' | 'custom';
    rutaSonido?: string;
    volumen: number;
    preroll: boolean;
    postroll: boolean;
  };
  grabacion: GrabacionEstado;
  sincronizado: boolean;
  relojMaestro: string | null;
  historialPosiciones: TimePosition[];
  maximoHistorial: number;
  ultimaPosicionGuardada: TimePosition | null;
  tiempoInicioReproduccion: number;
  duracionUltimaReproduccion: number;
  ciclos: number;
  modoGrabacion: ModoGrabacion;
  modoSincronizacion: ModoSincronizacion;
  shuttle: {
    activo: boolean;
    velocidad: number;
    modo: ShuttleMode;
    direccion: 'adelante' | 'atras';
  };
  preroll: {
    activo: boolean;
    compases: number;
    tipo: 'metronomo' | 'click' | 'silencioso';
  };
  postroll: {
    activo: boolean;
    compases: number;
    tipo: 'metronomo' | 'click' | 'silencioso';
  };
  metronomoVisual: {
    activo: boolean;
    color: string;
    tamano: number;
    posicion: 'arriba' | 'abajo' | 'centro';
  };
  countIn: {
    activo: boolean;
    compases: number;
    tipo: 'metronomo' | 'click' | 'silencioso';
  };
  click: {
    activo: boolean;
    volumen: number;
    pitch: number;
  };
  tempoMap: {
    bpmInicial: BPM;
    timeSignatureInicial: TimeSignature;
    eventos: { tiempo: number; tipo: 'bpm' | 'timeSignature'; valor: number; numerador?: number; denominador?: number }[];
    curvaInterpolacion: 'lineal' | 'exponencial' | 'logaritmica' | 'sine' | 'cuadratica';
    suavizado: number;
  };
  timeCode: {
    tipo: 'full' | 'half' | 'quarter' | 'drop' | 'up-down';
    fps: 24 | 25 | 29 | 30;
    dropFrame: boolean;
    horas: number;
    minutos: number;
    segundos: number;
    frames: number;
  };
  sincronizacionReloj: SincronizacionReloj;
  link: Link;
  mtc: MTC;
  relojMidi: {
    activo: boolean;
    fuente: 'interno' | 'externo';
    modo: 'maestro' | 'seguidor' | 'desconectado';
    bpm: number;
    ticksPorBeat: number;
  };
  master: {
    activo: boolean;
    bpm: number;
    timeSignature: TimeSignature;
    posicion: TimePosition;
  };
  estado: {
    activo: boolean;
    bloqueado: boolean;
    motivoBloqueo?: string;
    usuarioId?: string;
    dispositivoId?: string;
  };
  estadisticas: {
    reproduccionesTotales: number;
    grabacionesTotales: number;
    tiempoTotalReproduccionMs: number;
    tiempoTotalGrabacionMs: number;
    ciclosTotales: number;
    punchInTotales: number;
    punchOutTotales: number;
    erroresTransporte: number;
    xrunsDuranteReproduccion: number;
    latenciaPromedioMs: number;
  };
  historial: {
    posiciones: TimePosition[];
    eventos: { marcaTiempo: number; tipo: string; datos: Record<string, unknown> }[];
    maximoEntries: number;
  };
  configuracion: {
    autoPlay: boolean;
    autoRecord: boolean;
    autoReturn: boolean;
    returnToStart: boolean;
    loopEnabled: boolean;
    punchEnabled: boolean;
    metronomeEnabled: boolean;
    countInEnabled: boolean;
    prerollEnabled: boolean;
    postrollEnabled: boolean;
    shuttleEnabled: boolean;
    syncEnabled: boolean;
    linkEnabled: boolean;
    mtcEnabled: boolean;
    midiClockEnabled: boolean;
    tiempoLimiteReproduccion: number;
    tiempoLimiteGrabacion: number;
  };
  tags: string[];
  notas: string;
  modificado: boolean;
  fechaCreacion: number;
  fechaModificacion: number;
  marcaTiempoInicio: number;
  tiempoTotalUsoMs: number;
}

export interface TransporteConsulta {
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
  countIn: {
    activo: boolean;
    compases: number;
    tipo: string;
  };
  shuttle: {
    activo: boolean;
    velocidad: number;
    modo: string;
    direccion: string;
  };
  timeCode: {
    tipo: string;
    fps: number;
    dropFrame: boolean;
    horas: number;
    minutos: number;
    segundos: number;
    frames: number;
    texto: string;
  };
  link: {
    activo: boolean;
    bpm: number;
    compas: string;
    fase: number;
    fuente: string;
    dispositivos: string[];
    latenciaMs: number;
  };
  metronomo: {
    activo: boolean;
    tempo: number;
    compas: number;
    subdivision: number;
    sonido: string;
    volumen: number;
  };
  estadisticas: {
    reproduccionesTotales: number;
    grabacionesTotales: number;
    tiempoTotalReproduccionMs: number;
    tiempoTotalGrabacionMs: number;
    ciclosTotales: number;
    punchInTotales: number;
    punchOutTotales: number;
    erroresTransporte: number;
    xrunsDuranteReproduccion: number;
    latenciaPromedioMs: number;
  };
}

export interface TransporteComando {
  id: string;
  tipo: 'play' | 'pause' | 'stop' | 'record' | 'rewind' | 'fastForward' | 'shuttle' | 'loop' | 'punch' | 'metronome' | 'countIn' | 'preroll' | 'postroll' | 'return' | 'goto' | 'bpm' | 'timeSignature' | 'sync' | 'link' | 'mtc' | 'midiClock';
  parametros: Record<string, unknown>;
  marcaTiempo: number;
  usuarioId?: string;
  dispositivoId?: string;
}

export interface TransporteEvento {
  id: string;
  tipo: string;
  marcaTiempo: number;
  posicion: TimePosition;
  bpm: number;
  compas: number;
  datos: Record<string, unknown>;
}

export interface TransporteHistorial {
  eventos: TransporteEvento[];
  maximoEventos: number;
  indiceActual: number;
}

export interface TransporteConfiguracion {
  autoPlay: boolean;
  autoRecord: boolean;
  autoReturn: boolean;
  returnToStart: boolean;
  loopEnabled: boolean;
  punchEnabled: boolean;
  metronomeEnabled: boolean;
  countInEnabled: boolean;
  prerollEnabled: boolean;
  postrollEnabled: boolean;
  shuttleEnabled: boolean;
  syncEnabled: boolean;
  linkEnabled: boolean;
  mtcEnabled: boolean;
  midiClockEnabled: boolean;
  tiempoLimiteReproduccion: number;
  tiempoLimiteGrabacion: number;
  metronomo: {
    activo: boolean;
    tempo: number;
    compas: number;
    subdivision: number;
    sonido: string;
    volumen: number;
    preroll: boolean;
    postroll: boolean;
    click: boolean;
  };
  countIn: {
    activo: boolean;
    compases: number;
    tipo: string;
  };
  preroll: {
    activo: boolean;
    compases: number;
    tipo: string;
  };
  postroll: {
    activo: boolean;
    compases: number;
    tipo: string;
  };
  shuttle: {
    activo: boolean;
    modo: string;
    velocidadMaxima: number;
    aceleracion: number;
  };
  sync: {
    fuente: string;
    modo: string;
    bpm: number;
    desfaseMs: number;
    latenciaMs: number;
  };
  timeCode: {
    tipo: string;
    fps: number;
    dropFrame: boolean;
  };
}

export interface TransporteMetricas {
  marcaTiempo: number;
  cpu: number;
  memoriaMB: number;
  xruns: number;
  latenciaMs: number;
  buffersDescartados: number;
  eventosProcesados: number;
  comandosEjecutados: number;
}

export interface TransporteSnapshot {
  id: string;
  nombre: string;
  marcaTiempo: number;
  estado: TransportState;
  thumbnail?: string;
}

export interface TransporteValidacion {
  errores: {
    id: string;
    tipo: 'bpm_invalido' | 'timeSignature_invalida' | 'loop_invalido' | 'punch_invalido' | 'sincronizacion_perdida' | 'metronomo_error' | 'grabacion_error';
    severidad: 'error' | 'advertencia' | 'info';
    mensaje: string;
    solucion?: string;
  }[];
  validado: boolean;
  ultimaValidacion: number;
}

export function obtenerPosicionBeats(estado: TransportState): number {
  return estado.posicion.beats;
}

export function obtenerPosicionSegundos(estado: TransportState): number {
  return estado.posicion.segundos;
}

export function obtenerPosicionSamples(estado: TransportState): number {
  return estado.posicion.samples;
}

export function obtenerPosicionTicks(estado: TransportState): number {
  return estado.posicion.ticks;
}

export function obtenerPosicionCompases(estado: TransportState): number {
  return estado.posicion.compases;
}

export function estaReproduciendo(estado: TransportState): boolean {
  return estado.reproduciendo;
}

export function estaGrabando(estado: TransportState): boolean {
  return estado.grabacion === 'grabando';
}

export function estaArmado(estado: TransportState): boolean {
  return estado.grabacion === 'armada';
}

export function estaSincronizado(estado: TransportState): boolean {
  return estado.sincronizado;
}

export function estaLoopActivo(estado: TransportState): boolean {
  return estado.loop.activo;
}

export function estaPunchActivo(estado: TransportState): boolean {
  return estado.punch.activo;
}

export function estaMetronomoActivo(estado: TransportState): boolean {
  return estado.metronomo.activo;
}

export function estaCountInActivo(estado: TransportState): boolean {
  return estado.countIn.activo;
}

export function estaShuttleActivo(estado: TransportState): boolean {
  return estado.shuttle.activo;
}

export function obtenerDuracionLoop(estado: TransportState): TimeDuration {
  return estado.loop.duracion;
}

export function obtenerDuracionPunch(estado: TransportState): TimeDuration {
  const inicio = estado.punch.inicio;
  const fin = estado.punch.fin;
  return {
    beats: fin.beats - inicio.beats,
    segundos: fin.segundos - inicio.segundos,
    samples: fin.samples - inicio.samples,
    ticks: fin.ticks - inicio.ticks,
    compases: fin.compases - inicio.compases,
    frames: fin.frames - inicio.frames,
    texto: '',
    porcentaje: 0,
  };
}

export function calcularTiempoReproduccion(estado: TransportState): number {
  return Date.now() - estado.tiempoInicioReproduccion;
}

export function calcularTiempoGrabacion(estado: TransportState): number {
  return estado.estadisticas.tiempoTotalGrabacionMs;
}

export function estaEnLoop(estado: TransportState, posicion: TimePosition): boolean {
  if (!estado.loop.activo) return false;
  return posicion.segundos >= estado.loop.inicio.segundos && posicion.segundos < estado.loop.fin.segundos;
}

export function estaEnPunch(estado: TransportState, posicion: TimePosition): boolean {
  if (!estado.punch.activo) return false;
  return posicion.segundos >= estado.punch.inicio.segundos && posicion.segundos < estado.punch.fin.segundos;
}

export function normalizarPosicion(posicion: TimePosition, timeSignature: TimeSignature): TimePosition {
  const compases = Math.floor(posicion.beats / timeSignature.numerador);
  const beatsRestantes = posicion.beats % timeSignature.numerador;
  return {
    ...posicion,
    beats: beatsRestantes,
    compases,
  };
}
