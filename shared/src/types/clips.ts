/**
 * Tipos de clips y notas MIDI del DAW.
 *
 * Propósito:
 *   Definir las estructuras de clips de audio y MIDI, así como las
 *   notas MIDI individuales que componen un MidiClip.
 *
 * Importancia:
 *   - Permite tipado fuerte para la línea de tiempo, edición y
 *     automatización de clips.
 *   - Facilita la cuantización, warp, fundidos y renderizado de
 *     waveforms.
 *   - Sirve como contrato entre el motor de audio, la UI y el sistema
 *     de eventos.
 *
 * Función:
 *   Exporta BaseClip, AudioClip, MidiClip y MidiNote con todos los
 *   campos necesarios para edición, reproducción y automatización.
 */

import type { Fade } from './entidades';
import type { DatosMidi } from './midi';
import type { ValorJSON } from '../events/evento-dominio';

export interface BaseClip {
  id: string;
  nombre: string;
  trackId: string;
  inicio: number;
  duracion: number;
  color: string;
  seleccionado: boolean;
}

export interface AudioClip extends BaseClip {
  tipo: 'audio';
  clipInicio: number;
  fadeIn: Fade;
  fadeOut: Fade;
  warp: boolean;
  velocidad: number;
  inverso: boolean;
  waveform?: number[];
  source: {
    ruta: string;
    duracion: number;
    sampleRate: number;
    canales: number;
    bitDepth: number;
  };
  datos?: ValorJSON;
}

export interface MidiClip extends BaseClip {
  tipo: 'midi';
  notas: MidiNote[];
  velocidadGlobal: number;
  cuantizacion: number;
  loop: {
    activo: boolean;
    inicio: number;
    fin: number;
  };
  /** Automatización / expresión MIDI (CC, pitch bend, aftertouch). */
  expression?: MidiClipExpression;
  /** Contexto armónico opcional por región (para IA). */
  chordContext?: MidiChordMarker[];
  datos?: ValorJSON;
}

/** Punto de automatización en beats relativos al clip. valor: 0..1 normalizado o específico por lane. */
export interface MidiAutomationPoint {
  id: string;
  tiempo: number;
  valor: number;
  curva?: 'step' | 'linear' | 'smooth';
}

export interface MidiCcLane {
  cc: number;
  nombre?: string;
  puntos: MidiAutomationPoint[];
}

export interface MidiClipExpression {
  cc: MidiCcLane[];
  pitchBend: MidiAutomationPoint[];
  channelPressure: MidiAutomationPoint[];
  /** Poly aftertouch opcional: por pitch */
  polyAftertouch?: { pitch: number; puntos: MidiAutomationPoint[] }[];
}

export interface MidiChordMarker {
  id: string;
  inicio: number;
  duracion: number;
  symbol: string;
  root?: string;
  quality?: string;
}

export interface MidiNote {
  /** Identidad estable — nunca usar índice de array. */
  id: string;
  pitch: number;
  velocidad: number;
  /** Inicio en beats (relativo al clip). Internamente convertir vía PPQ/ticks. */
  inicio: number;
  /** Duración en beats. */
  duracion: number;
  canal: number;
  presion: number;
  seleccionada: boolean;
  /** Campos extensibles (Fase A+): expresión, articulación, MPE-ready. */
  releaseVelocity?: number;
  mute?: boolean;
  articulation?: string;
  noteExpression?: {
    pitchBend?: number;
    pressure?: number;
    slide?: number;
    timbre?: number;
  };
  voice?: number;
  lane?: number;
  probability?: number;
  variation?: number;
  source?: 'drawn' | 'recorded' | 'generated' | 'humanized' | 'imported' | string;
  metadata?: Record<string, unknown>;
}

export type Clip = AudioClip | MidiClip;
