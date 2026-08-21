/**
 * Tipos de datos MIDI del dominio JasWave.
 *
 * Propósito:
 *   Definir las estructuras de datos completas para el protocolo MIDI
 *   en todas sus variantes: eventos, clips, controladores, sincronización,
 *   routing y mapeo.
 *
 * Importancia:
 *   - Garantiza tipado fuerte para entrada/salida MIDI, grabación,
 *     automatización, controladores y sincronización externa.
 *   - Permite distinguir entre todos los tipos de mensaje MIDI
 *     (notas, CC, pitch bend, SysEx, MPE, timecode, reloj, etc.)
 *     sin pérdida de información.
 *   - Facilita la consulta de la IA sobre datos musicales estructurados
 *     y la generación de sugerencias basadas en patrones MIDI.
 *   - Soporta features avanzados como MPE, NRPN, MIDI 2.0, routing
 *     virtual y learn.
 *
 * Función:
 *   Exporta interfaces para datos MIDI básicos, eventos extendidos,
 *   controladores, dispositivos, routing, filtros, mapeo, presets,
 *   sincronización y grabación MIDI.
 */

import type { ValorJSON } from '../events/evento-dominio';

export interface DatosMidi {
  nota: number;
  velocidad: number;
  canal: number;
  tiempo: number;
  presion: number;
  tipo: 'nota' | 'cc' | 'pitch' | 'sysex' | 'aftertouch' | 'polyAftertouch' | 'programa' | 'selectiva' | 'clock' | 'start' | 'stop' | 'continuar' | 'activeSensing' | 'reset' | 'tuneRequest';
}

export interface DatosCC {
  controlador: number;
  valor: number;
  canal: number;
  tiempo: number;
  tipo: 'cc' | 'rpn' | 'nrpn';
  entrada?: number;
  salida?: number;
}

export interface DatosPitchBend {
  canal: number;
  valor: number;
  tiempo: number;
}

export interface DatosSysex {
  fabricante: number;
  datos: number[];
  tiempo: number;
  tamanio: number;
  checksum?: number;
}

export interface DatosAftertouch {
  canal: number;
  presion: number;
  tiempo: number;
}

export interface DatosPolyAftertouch {
  nota: number;
  presion: number;
  canal: number;
  tiempo: number;
}

export interface DatosPrograma {
  programa: number;
  canal: number;
  tiempo: number;
}

export interface DatosSelectiva {
  bancoMSB: number;
  bancoLSB: number;
  programa: number;
  canal: number;
  tiempo: number;
}

export interface DatosRPN {
  numero: number;
  valor: number;
  canal: number;
  tiempo: number;
}

export interface DatosNRPN {
  numeroMSB: number;
  numeroLSB: number;
  valorMSB: number;
  valorLSB: number;
  canal: number;
  tiempo: number;
}

export interface DatosMPE {
  canal: number;
  notaInicio: number;
  notaFin: number;
  dimension: number;
  datos: number[];
  tiempo: number;
}

export interface DatosMIDIClock {
  ticks: number;
  bpm: number;
  tiempo: number;
  fuente: 'interno' | 'externo' | 'ableton' | 'mtc';
}

export interface DatosMTC {
  tipo: 'full' | 'half' | 'quarter' | 'drop' | 'up-down';
  fps: 24 | 25 | 29 | 30;
  dropFrame: boolean;
  horas: number;
  minutos: number;
  segundos: number;
  frames: number;
  tiempo: number;
}

export interface MapeoMIDI {
  id: string;
  nombre: string;
  entrada: {
    canal: number | 'cualquiera';
    tipo: 'nota' | 'cc' | 'pitch' | 'sysex' | 'programa';
    numero: number | 'cualquiera';
    rangoMin?: number;
    rangoMax?: number;
  };
  salida: {
    parametroId: string;
    trackId?: string;
    pluginId?: string;
    accion?: string;
    rangoMin: number;
    rangoMax: number;
    curva: 'lineal' | 'exponencial' | 'logaritmica' | 'sine';
    inversa: boolean;
  };
  activo: boolean;
  aprendizaje: boolean;
  modo: 'relativo' | 'absoluto' | 'toggle';
  umbral: number;
}

export interface ControladorMIDI {
  id: string;
  nombre: string;
  fabricante: string;
  modelo: string;
  tipo: 'teclado' | 'superficie' | 'controlador' | 'modulo' | 'interface';
  entradas: number;
  salidas: number;
  canales: number;
  modos: ('note' | 'cc' | 'pitch' | 'sysex' | 'reloj' | 'mtc' | 'mpe')[];
  conectado: boolean;
  entrada: boolean;
  salida: boolean;
  nombreDisplay: string;
  color: string;
  firmware?: string;
  latenciaEntrada: number;
  latenciaSalida: number;
  bufferSize: number;
  ultimaConexion: number;
  controladoresVinculados: string[];
}

export interface PresetMIDI {
  id: string;
  nombre: string;
  dispositivoId: string;
  categoria: string;
  banco: number;
  programa: number;
  datos: ValorJSON;
  autor: string;
  etiquetas: string[];
  creado: number;
  modificado: number;
}

export interface FiltroMIDI {
  canal: number | 'cualquiera';
  tipos: ('nota' | 'cc' | 'pitch' | 'sysex' | 'programa' | 'aftertouch' | 'polyAftertouch' | 'clock' | 'mtc')[];
  notasMin?: number;
  notasMax?: number;
  ccMin?: number;
  ccMax?: number;
  transformar: {
    canal?: number;
    notaTransponer?: number;
    velocidadMin?: number;
    velocidadMax?: number;
    ccRemap?: Record<number, number>;
  };
  activo: boolean;
}

export interface RutaMIDI {
  id: string;
  nombre: string;
  origen: string;
  destino: string;
  canal: number | 'cualquiera';
  filtros: FiltroMIDI[];
  transformaciones: {
    transponer: number;
    velocidad: number;
    canal: number;
    retardar: number;
  };
  activa: boolean;
  virtual: boolean;
}

export interface AprendizajeMIDI {
  activo: boolean;
  parametroId: string;
  callback: (mapeo: MapeoMIDI) => void;
  tiempoLimite: number;
  filtros: FiltroMIDI[];
}

export interface RetroalimentacionMIDI {
  destino: string;
  parametro: string;
  valor: number;
  canal: number;
  tipo: 'cc' | 'nota' | 'pitch';
  numero: number;
}

export interface GrabacionMIDI {
  pistaId: string;
  estado: 'inactiva' | 'armada' | 'grabando' | 'pausada';
  entrada: string;
  cuantizacion: number;
  delayCompensacion: number;
  filtros: FiltroMIDI[];
  sobreescritura: boolean;
  loop: boolean;
  metros: boolean;
  eventos: DatosMidi[];
  takeActualId?: string;
  compasesGrabados: number;
}

export interface ConfiguracionMIDI {
  dispositivoEntrada: string;
  dispositivoSalida: string;
  relojExterno: boolean;
  syncMTC: boolean;
  syncMTCModo: 'full' | 'half' | 'quarter';
  mpeActivo: boolean;
  mpeZonaInferior: number;
  mpeZonaSuperior: number;
  mpeDimensiones: number;
  canalOmni: boolean;
  filtroReloj: boolean;
  filtroActiveSense: boolean;
  filtroSysEx: boolean;
  retardoSincronizacion: number;
  bufferSize: number;
}
