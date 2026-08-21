/**
 * Tipos base de tiempo musical para el dominio JasWave.
 *
 * Propósito:
 *   Definir las unidades fundamentales de tiempo musical (BPM, compás,
 *   posición y duración) utilizadas en todo el estado del DAW.
 *
 * Importancia:
 *   - Garantiza consistencia en cálculos de transporte, automatización,
 *     cuantización y sincronización.
 *   - Permite tipado fuerte en consultas de la IA y eventos del bus.
 *   - Facilita la serialización JSON del estado sin pérdida de información.
 *
 * Función:
 *   Exporta BPM, TimeSignature, TimePosition, TimeDuration y sus helpers
 *   de conversión entre beats, segundos, samples y ticks, además de
 *   utilidades para cálculos musicales (compases, duración en samples,
 *   tempo maps, marcadores, grids, cuantización, etc.).
 */

export interface BPM {
  valor: number;
  min: number;
  max: number;
  texto: string;
  modo: 'fijo' | 'automatico' | 'seguir' | 'manual';
  curva?: Record<number, number>;
  cambios: { tiempo: number; valor: number }[];
}

export interface TimeSignature {
  numerador: number;
  denominador: number;
  nombre: string;
  cambios: { tiempo: number; numerador: number; denominador: number }[];
}

export interface TimePosition {
  beats: number;
  segundos: number;
  samples: number;
  ticks: number;
  compases: number;
  frames: number;
  tiempoMusical: string;
  porcentaje: number;
}

export interface TimeDuration {
  beats: number;
  segundos: number;
  samples: number;
  ticks: number;
  compases: number;
  frames: number;
  texto: string;
  porcentaje: number;
}

export interface TimePositionMutable {
  beats: number;
  segundos: number;
}

export function beatsASegundos(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

export function segundosABeats(segundos: number, bpm: number): number {
  return (segundos * bpm) / 60;
}

export function duracionEnSamples(duracion: TimeDuration): number {
  return duracion.samples;
}

export function compasesAPosicion(compases: number, timeSignature: TimeSignature): number {
  return compases * timeSignature.numerador;
}

export function posicionACompases(posicionBeats: number, timeSignature: TimeSignature): number {
  return posicionBeats / timeSignature.numerador;
}

export interface TimeMap {
  bpm: BPM;
  timeSignature: TimeSignature;
  puntos: { tiempo: number; beats: number; segundos: number; samples: number; bpm: number; timeSignature: TimeSignature }[];
  duracionTotal: TimeDuration;
  compasesTotales: number;
}

export interface Grid {
  tipo: 'bar' | 'beat' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtysecond' | 'custom';
  valor: number;
  activo: boolean;
  snap: boolean;
  nombre: string;
}

export interface Cuantizacion {
  tipo: 'none' | 'bar' | 'beat' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtysecond' | 'custom';
  valor: number;
  activo: boolean;
  swing: number;
  swingModo: 'triplet' | 'dots' | 'custom';
  humanize: number;
  fuerza: number;
}

export interface MarcadorTiempo {
  id: string;
  nombre: string;
  tiempo: TimePosition;
  tipo: 'marcador' | 'region' | 'punchIn' | 'punchOut' | 'loopIn' | 'loopOut' | 'tempo' | 'timeSignature';
  color: string;
  comentario?: string;
  seleccionado: boolean;
}

export interface TempoMap {
  bpmInicial: BPM;
  timeSignatureInicial: TimeSignature;
  eventos: { tiempo: number; tipo: 'bpm' | 'timeSignature'; valor: number; numerador?: number; denominador?: number }[];
  curvaInterpolacion: 'lineal' | 'exponencial' | 'logaritmica' | 'sine' | 'cuadratica';
  suavizado: number;
}

export interface SincronizacionReloj {
  fuente: 'interno' | 'externo' | 'mtc' | 'midiClock' | 'reWire' | 'link' | 'ableton';
  modo: 'maestro' | 'seguidor' | 'desconectado';
  bpm: number;
  tiempoActual: TimePosition;
  ultimaSincronizacion: number;
  desfaseMs: number;
  latenciaMs: number;
  estable: boolean;
}

export interface MTC {
  tipo: 'full' | 'half' | 'quarter' | 'drop' | 'up-down';
  fps: 24 | 25 | 29 | 30;
  dropFrame: boolean;
  horas: number;
  minutos: number;
  segundos: number;
  frames: number;
  tiempo: TimePosition;
}

export interface Link {
  activo: boolean;
  bpm: number;
  compas: TimeSignature;
  fase: number;
  fuente: string;
  dispositivos: string[];
  latenciaMs: number;
}

export interface TimeStretch {
  algoritmo: 'elastique' | 'rubberBand' | 'soundTouch' | 'phaseVocoder' | 'granular';
  preservarPitch: boolean;
  preservarFormantes: boolean;
  calidad: 'baja' | 'media' | 'alta' | 'estudio';
  velocidad: number;
  duracionOriginal: TimeDuration;
  duracionEstirada: TimeDuration;
}

export interface CuantizacionNota {
  tipo: Cuantizacion['tipo'];
  valor: number;
  swing: number;
  humanize: number;
  fuerza: number;
  retrasoMs: number;
  destino: 'inicio' | 'fin' | 'ambos';
}

export interface Playhead {
  posicion: TimePosition;
  visible: boolean;
  color: string;
  linea: boolean;
  nombre?: string;
}

export interface LoopTiempo {
  activo: boolean;
  inicio: TimePosition;
  fin: TimePosition;
  duracion: TimeDuration;
  modo: 'loop' | 'punch' | 'repeat' | 'custom';
}

export interface RangoTiempo {
  inicio: TimePosition;
  fin: TimePosition;
  duracion: TimeDuration;
  seleccionado: boolean;
}

export interface TimeCode {
  horas: number;
  minutos: number;
  segundos: number;
  frames: number;
  subframes: number;
  fps: number;
  dropFrame: boolean;
  texto: string;
}

export function beatsATicks(beats: number, bpm: number, ticksPorBeat: number = 960): number {
  return beats * ticksPorBeat;
}

export function ticksABeats(ticks: number, bpm: number, ticksPorBeat: number = 960): number {
  return ticks / ticksPorBeat;
}

export function beatsAMuestras(beats: number, bpm: number, sampleRate: number): number {
  return Math.round((beats * 60 * sampleRate) / bpm);
}

export function muestrasABeats(muestras: number, bpm: number, sampleRate: number): number {
  return (muestras * bpm) / (60 * sampleRate);
}

export function segundosAMuestras(segundos: number, sampleRate: number): number {
  return Math.round(segundos * sampleRate);
}

export function muestrasASegundos(muestras: number, sampleRate: number): number {
  return muestras / sampleRate;
}

export function framesASegundos(frames: number, fps: number): number {
  return frames / fps;
}

export function segundosAFrames(segundos: number, fps: number): number {
  return Math.round(segundos * fps);
}

export function tiempoATexto(tiempo: TimePosition, timeSignature: TimeSignature): string {
  const compases = Math.floor(tiempo.compases);
  const beat = Math.floor(tiempo.beats) % timeSignature.numerador;
  const ticks = Math.round(tiempo.ticks % 960);
  return `${compases}:${beat}:${ticks}`;
}

export function textoATiempo(texto: string, bpm: number, timeSignature: TimeSignature): TimePosition {
  const partes = texto.split(':');
  const compases = partes[0] ? parseInt(partes[0]) : 0;
  const beats = partes[1] ? parseInt(partes[1]) : 0;
  const ticks = partes[2] ? parseInt(partes[2]) : 0;
  const beatsTotales = compases * timeSignature.numerador + beats + ticks / 960;
  const segundos = beatsASegundos(beatsTotales, bpm);
  return {
    beats: beatsTotales,
    segundos,
    samples: segundosAMuestras(segundos, 44100),
    ticks: ticks + beatsTotales * 960,
    compases,
    frames: segundosAFrames(segundos, 30),
    tiempoMusical: texto,
    porcentaje: 0,
  };
}

export function normalizarTiempo(tiempo: TimePosition): TimePosition {
  const compases = Math.floor(tiempo.beats / 4);
  const beatsRestantes = tiempo.beats % 4;
  return {
    ...tiempo,
    beats: beatsRestantes,
    compases,
    tiempoMusical: `${compases}:${Math.floor(beatsRestantes)}:${Math.round(tiempo.ticks % 960)}`,
  };
}

export function sumarTiempos(a: TimePosition, b: TimePosition): TimePosition {
  return {
    beats: a.beats + b.beats,
    segundos: a.segundos + b.segundos,
    samples: a.samples + b.samples,
    ticks: a.ticks + b.ticks,
    compases: a.compases + b.compases,
    frames: a.frames + b.frames,
    tiempoMusical: '',
    porcentaje: 0,
  };
}

export function restarTiempos(a: TimePosition, b: TimePosition): TimePosition {
  return {
    beats: a.beats - b.beats,
    segundos: a.segundos - b.segundos,
    samples: a.samples - b.samples,
    ticks: a.ticks - b.ticks,
    compases: a.compases - b.compases,
    frames: a.frames - b.frames,
    tiempoMusical: '',
    porcentaje: 0,
  };
}

export function compararTiempos(a: TimePosition, b: TimePosition): number {
  if (a.segundos < b.segundos) return -1;
  if (a.segundos > b.segundos) return 1;
  if (a.samples < b.samples) return -1;
  if (a.samples > b.samples) return 1;
  return 0;
}
