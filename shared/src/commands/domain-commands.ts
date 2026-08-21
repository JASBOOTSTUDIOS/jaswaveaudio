/**
 * Comandos de dominio: tracks, clips y transporte.
 *
 * Propósito:
 *   Centralizar las mutaciones de tracks, clips y estado de transporte
 *   en el Command System, alineadas con `docs/hoja-ruta/003-command-system.md`.
 *
 * Importancia:
 *   - Garantiza que toda modificación del proyecto pase por validación,
 *     auditoría y undo/redo.
 *   - Emite eventos del dominio para UI, IA y análisis.
 *
 * Función:
 *   Expone definiciones de comandos listas para registrar en el registry.
 */

import type { CommandDefinition, StateTransition, ValidationResult, ValidationError } from '../types/command';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { Track } from '../types/tracks';
import type { AudioClip, MidiClip, MidiNote } from '../types/clips';
import type { TransportState } from '../types/transport';
import { NombresEventos, EventosTrack, EventosClip, EventosTransporte, EventosProyecto } from '../constants/nombres-eventos';
import { segundosABeats } from '../types/tiempo';
import {
  transposeNotes,
  quantizeNotes,
  humanizeNotes,
  scaleVelocityRelative,
  setVelocityAbsolute,
  makeStaccato,
  makeLegato,
  deleteNotesById,
  appendNotes,
  repeatSelection,
  reverseInTime,
  invertPitches,
  timeStretchNotes,
  type QuantizeMode,
} from '../midi/note-ops';
import { constrainNotesToScale, type ScaleType } from '../midi/scale';
import { generateMidiPattern, type GeneratePatternKind } from '../midi/generators';
import { applyGroove } from '../midi/groove';
import { ensureExpression, setCcLane, setPitchBendPoints } from '../midi/expression';
import type { MidiClipExpression } from '../types/clips';

function posicionDesdeSegundos(segundos: number, bpm: number) {
  const s = Math.max(0, segundos)
  const beats = segundosABeats(s, bpm)
  const PPQ = 480
  const ticks = beats * PPQ
  const samples = Math.round(s * 44100)
  const frames = Math.round(s * 30)
  const compases = beats / 4
  const porcentaje = 0
  const tiempoMusical = `${Math.floor(compases) + 1}.${Math.floor(beats % 4) + 1}.1.0`
  return { beats, segundos: s, samples, ticks, compases, frames, tiempoMusical, porcentaje }
}

function generarId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export type TrackCreatePayload = {
  nombre?: string;
  tipo?: 'audio' | 'midi' | 'instrumento' | 'bus' | 'carpeta';
  color?: string;
};

export type TrackDeletePayload = {
  trackId: string;
};

export type TrackUpdatePayload = {
  trackId: string;
  datos: Partial<Track>;
};

export type TrackToggleMutePayload = {
  trackId: string;
};

export type TrackToggleSoloPayload = {
  trackId: string;
};

export type ClipCreatePayload = {
  pistaId: string;
  nombre?: string;
  inicio?: number;
  duracion?: number;
  color?: string;
  sourceId?: string;
  /** Picos estéreo empaquetados [minL,maxL,minR,maxR,...] */
  waveform?: number[];
};

export type MidiNotePayload = {
  id?: string;
  pitch: number;
  inicio: number;
  duracion: number;
  velocidad?: number;
  canal?: number;
  releaseVelocity?: number;
  mute?: boolean;
  articulation?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

export type MidiClipCreatePayload = {
  pistaId: string;
  nombre?: string;
  inicio?: number;
  duracion?: number;
  color?: string;
  notas: MidiNotePayload[];
};

export type MidiNotesSetPayload = {
  pistaId: string;
  clipId: string;
  notas: MidiNotePayload[];
  /** Si se omite, se recalcula desde las notas. */
  duracion?: number;
  expression?: MidiClipExpression;
};

export type MidiTransposePayload = {
  pistaId: string;
  clipId: string;
  semitonos: number;
  noteIds?: string[];
};

export type MidiQuantizePayload = {
  pistaId: string;
  clipId: string;
  gridBeats: number;
  strength?: number;
  mode?: QuantizeMode;
  noteIds?: string[];
};

export type MidiHumanizePayload = {
  pistaId: string;
  clipId: string;
  seed: number;
  timingAmount?: number;
  velocityAmount?: number;
  durationAmount?: number;
  noteIds?: string[];
};

export type MidiSetVelocityPayload = {
  pistaId: string;
  clipId: string;
  /** Velocity absoluta 1–127 (si no hay relativeFactor). */
  velocity?: number;
  /** Escala dinámica relativa (1 = sin cambio, 1.15 = +15% spread). */
  relativeFactor?: number;
  noteIds?: string[];
};

export type MidiDeleteNotesPayload = {
  pistaId: string;
  clipId: string;
  noteIds: string[];
};

export type MidiCreateNotesPayload = {
  pistaId: string;
  clipId: string;
  notas: MidiNotePayload[];
};

export type MidiArticulationPayload = {
  pistaId: string;
  clipId: string;
  noteIds?: string[];
  ratio?: number;
};

export type MidiPatternOpPayload = {
  pistaId: string;
  clipId: string;
  noteIds?: string[];
  times?: number;
  factor?: number;
  axis?: number;
};

export type MidiConstrainScalePayload = {
  pistaId: string;
  clipId: string;
  root: string;
  scale: ScaleType;
  noteIds?: string[];
};

export type MidiGeneratePayload = {
  pistaId: string;
  clipId?: string;
  kind: GeneratePatternKind;
  bars?: number;
  root?: string;
  scale?: ScaleType;
  seed?: number;
  replace?: boolean;
  nombre?: string;
  inicio?: number;
};

export type MidiApplyGroovePayload = {
  pistaId: string;
  clipId: string;
  grooveId: string;
  strength?: number;
  seed?: number;
  noteIds?: string[];
};

export type MidiSetCcPayload = {
  pistaId: string;
  clipId: string;
  cc: number;
  puntos: { tiempo: number; valor: number }[];
  nombre?: string;
};

export type MidiSetPitchBendPayload = {
  pistaId: string;
  clipId: string;
  puntos: { tiempo: number; valor: number }[];
};

function mapMidiNotePayload(n: MidiNotePayload): MidiNote {
  return {
    id: n.id && n.id.length > 0 ? n.id : generarId(),
    pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
    velocidad: Math.max(1, Math.min(127, Math.round(n.velocidad ?? 80))),
    inicio: Math.max(0, n.inicio),
    duracion: Math.max(0.03125, n.duracion),
    canal: n.canal ?? 0,
    presion: 0,
    seleccionada: false,
    releaseVelocity: n.releaseVelocity,
    mute: n.mute,
    articulation: n.articulation,
    source: n.source,
    metadata: n.metadata,
  };
}

function applyMidiNotesToClip(
  estado: DAWState,
  pistaId: string,
  clipId: string,
  transform: (notas: MidiNote[], existing: MidiClip) => MidiNote[],
): StateTransition<{ pistaId: string; clipId: string }> {
  const pista = estado.project.tracks.find((t) => t.id === pistaId);
  if (!pista) throw new Error(`Pista no encontrada: ${pistaId}`);
  const clips = [...(pista.clips as MidiClip[])];
  const index = clips.findIndex((c) => c.id === clipId);
  if (index < 0) throw new Error(`Clip no encontrado: ${clipId}`);
  const existing = clips[index];
  if (existing.tipo !== 'midi') throw new Error('El clip no es MIDI');

  const prevNotas = existing.notas ?? [];
  const notas = transform(prevNotas, existing);
  let duracion = existing.duracion;
  if (notas.length > 0) {
    const end = notas.reduce((max, n) => Math.max(max, n.inicio + n.duracion), 0);
    duracion = Math.max(duracion, end);
  }
  clips[index] = {
    ...existing,
    notas,
    duracion,
    loop: { ...(existing.loop ?? { activo: false, inicio: 0, fin: duracion }), fin: duracion },
  };
  const pistaActualizada = { ...pista, clips, fechaModificacion: Date.now() } as Track;
  const proyecto: ProjectState = {
    ...estado.project,
    tracks: estado.project.tracks.map((t) => (t.id === pistaId ? pistaActualizada : t)),
    modificado: true,
    fechaModificacion: Date.now(),
  };
  return {
    state: { ...estado, project: proyecto },
    events: [
      {
        nombre: EventosClip.cuantizado,
        version: 1,
        marcaTiempo: Date.now(),
        fuente: 'domain-commands',
        payload: { clipId, pistaId, notas: notas.length },
      },
    ],
    result: { pistaId, clipId },
    inversePayload: { pistaId, clipId, notas: prevNotas, duracion: existing.duracion } as never,
  };
}

export type ClipDeletePayload = {
  pistaId: string;
  clipId: string;
};

export type ClipMovePayload = {
  pistaId: string;
  clipId: string;
  inicio: number;
  pistaDestinoId?: string;
};

export type ClipResizePayload = {
  pistaId: string;
  clipId: string;
  inicio?: number;
  duracion?: number;
  /** Offset dentro de la fuente de audio (beats). */
  clipInicio?: number;
};

export type ClipSplitPayload = {
  pistaId: string;
  clipId: string;
  tiempo: number;
};

export type TransportTogglePayload = {};
export type TransportStopPayload = {};
export type TransportSeekPayload = {
  segundos: number;
};
export type TransportToggleLoopPayload = {};
export type TransportToggleMetronomePayload = {};
export type TransportToggleRecordPayload = {};
export type ProjectSetBpmPayload = {
  bpm: number;
};

function crearPista(nombre: string, tipo: Track['tipo'] = 'audio', color?: string): Track {
  const base = {
    id: generarId(),
    nombre,
    nombreOriginal: nombre,
    color: color || '#3b82f6',
    tipo,
    rol: 'normal' as const,
    estado: 'activo' as const,
    volumen: 0.8,
    volumenOriginal: -12,
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
    hijos: [],
    clips: [],
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
    estadisticas: {
      clipsTotales: 0,
      clipsAudio: 0,
      clipsMidi: 0,
      duracionTotal: 0,
      duracionUtil: 0,
      pluginsTotales: 0,
      automatizacionesTotales: 0,
      puntosAutomatizacion: 0,
      enviosTotales: 0,
      receivesTotales: 0,
      fadesTotales: 0,
      marcadoresTotales: 0,
      mediosTotales: 0,
      eventosTotales: 0,
    },
    configuracion: {
      cuantizacion: 0,
      delayCompensacion: 0,
      retardoSincronizacion: 0,
      filtroEntrada: false,
      filtroSalida: false,
      monitorizarEntrada: false,
      grabacionAutomática: false,
      sobrescrituraAutomatica: false,
      cuantizarGrabacion: false,
      loop: false,
      punchIn: 0,
      punchOut: 0,
      metronomo: false,
      click: false,
      preRoll: false,
      postRoll: false,
    },
    colorDefecto: color || '#3b82f6',
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
  } as unknown as Track;

  if (tipo === 'audio') {
    return {
      ...base,
      tipo: 'audio',
      clips: [],
      formato: 'stereo',
      canales: 2,
      sampleRate: 44100,
      bitDepth: 24,
      latenciaEntrada: 0,
      latenciaSalida: 0,
      bufferSize: 0,
      dispositivoEntrada: '',
      dispositivoSalida: '',
      gainStaging: 0,
      headroom: 0,
      phase: 0,
      stereoCorrelation: 0,
      lufs: -24,
      rangoDinamico: 12,
      clipping: false,
      xruns: 0,
      ultimoXrun: 0,
    };
  }

  if (tipo === 'midi') {
    return {
      ...base,
      tipo: 'midi',
      clips: [],
      canal: 0,
      canalOmni: true,
      cuantizacion: 0,
      filtro: { notasMin: 0, notasMax: 127, ccMin: 0, ccMax: 127, tipos: [] },
      mpe: false,
      mpeZonaInferior: 0,
      mpeZonaSuperior: 127,
      mpeDimensiones: 1,
      retardoSincronizacion: 0,
      modoReloj: 'interno',
      transmitirReloj: false,
      transmitirMTC: false,
      transmitirMidi: false,
      recibirMidi: false,
      filtroReloj: false,
      filtroActiveSense: false,
      filtroSysEx: false,
    };
  }

  return base;
}

export function crearComandoTrackCreate(): CommandDefinition<TrackCreatePayload> {
  return {
    type: 'track.create',
    inverseType: 'track.delete',
    description: 'Crea una nueva pista en el proyecto',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        tipo: { type: 'string', enum: ['audio', 'midi', 'instrumento', 'bus', 'carpeta'] },
        color: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackCreatePayload): StateTransition<TrackCreatePayload> => {
      const nombre = (payload.nombre || `Pista ${(estado.project.tracks.length + 1)}`).trim();
      const tipo = payload.tipo || 'audio';
      const pista = crearPista(nombre, tipo, payload.color);
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: [...estado.project.tracks, pista],
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.creada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: pista.id, nombre, tipo },
          },
        ],
        result: payload,
        inversePayload: { trackId: pista.id },
      };
    },
    validate: (estado: DAWState, payload: TrackCreatePayload): ValidationResult => {
      const errors: ValidationError[] = [];
      if (payload.nombre && payload.nombre.trim().length > 200) {
        errors.push({ code: 'NAME_TOO_LONG', message: 'El nombre de la pista no puede exceder 200 caracteres', field: 'nombre' });
      }
      if (payload.tipo && !['audio', 'midi', 'instrumento', 'bus', 'carpeta'].includes(payload.tipo)) {
        errors.push({ code: 'INVALID_TYPE', message: `Tipo de pista inválido: ${payload.tipo}`, field: 'tipo' });
      }
      if (estado.project.tracks.length >= 256) {
        errors.push({ code: 'MAX_TRACKS', message: 'Se ha alcanzado el límite máximo de 256 pistas' });
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
  };
}

export function crearComandoTrackDelete(): CommandDefinition<TrackDeletePayload> {
  return {
    type: 'track.delete',
    inverseType: 'track.restore',
    description: 'Elimina una pista del proyecto',
    risk: 'dangerous',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackDeletePayload): StateTransition<TrackDeletePayload> => {
      const index = estado.project.tracks.findIndex(t => t.id === payload.trackId);
      const pista = index >= 0 ? estado.project.tracks[index] : undefined;
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.trackId}`);
      }

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.filter(t => t.id !== payload.trackId),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.eliminada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId },
          },
        ],
        result: payload,
        inversePayload: { track: pista, index },
      };
    },
  };
}

export function crearComandoTrackUpdate(): CommandDefinition<TrackUpdatePayload> {
  return {
    type: 'track.update',
    inverseType: 'track.update',
    description: 'Actualiza propiedades de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        datos: { type: 'object' },
      },
      required: ['trackId', 'datos'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackUpdatePayload): StateTransition<TrackUpdatePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.trackId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.trackId}`);
      }

      const datosAnteriores: Record<string, unknown> = {};
      for (const clave of Object.keys(payload.datos)) {
        datosAnteriores[clave] = (pista as unknown as Record<string, unknown>)[clave];
      }

      const pistaActualizada = { ...pista, ...payload.datos, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.actualizada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId, cambios: payload.datos as any },
          },
        ],
        result: payload,
        inversePayload: { trackId: payload.trackId, datos: datosAnteriores },
      };
    },
  };
}

export function crearComandoTrackToggleMute(): CommandDefinition<TrackToggleMutePayload> {
  return {
    type: 'track.toggleMute',
    inverseType: 'track.toggleMute',
    description: 'Alterna el estado de silencio de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackToggleMutePayload): StateTransition<TrackToggleMutePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.trackId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.trackId}`);
      }

      const silenciada = !pista.silenciada;
      const pistaActualizada = { ...pista, silenciada, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.silenciada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId, silenciada },
          },
        ],
        result: payload,
      };
    },
  };
}

export function crearComandoTrackToggleSolo(): CommandDefinition<TrackToggleSoloPayload> {
  return {
    type: 'track.toggleSolo',
    inverseType: 'track.toggleSolo',
    description: 'Alterna el estado de solo de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackToggleSoloPayload): StateTransition<TrackToggleSoloPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.trackId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.trackId}`);
      }

      const soloActiva = !pista.soloActiva;
      const pistaActualizada = { ...pista, soloActiva, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.soloActiva,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId, soloActiva },
          },
        ],
        result: payload,
      };
    },
  };
}

export type TrackToggleArmPayload = {
  trackId: string;
};

export type TrackToggleMonitorPayload = {
  trackId: string;
};

export function crearComandoTrackToggleArm(): CommandDefinition<TrackToggleArmPayload> {
  return {
    type: 'track.toggleArm',
    inverseType: 'track.toggleArm',
    description: 'Alterna el estado de armado de grabación de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackToggleArmPayload): StateTransition<TrackToggleArmPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.trackId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.trackId}`);
      }

      const armada = !pista.armada;
      const pistaActualizada = { ...pista, armada, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.armada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId, armada },
          },
        ],
        result: payload,
      };
    },
  };
}

export function crearComandoTrackToggleMonitor(): CommandDefinition<TrackToggleMonitorPayload> {
  return {
    type: 'track.toggleMonitor',
    inverseType: 'track.toggleMonitor',
    description: 'Alterna el monitoreo de entrada de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackToggleMonitorPayload): StateTransition<TrackToggleMonitorPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.trackId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.trackId}`);
      }

      const monitorizarEntrada = !pista.configuracion.monitorizarEntrada;
      const pistaActualizada = {
        ...pista,
        configuracion: { ...pista.configuracion, monitorizarEntrada },
        fechaModificacion: Date.now(),
      } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.monitorizada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId, monitorizarEntrada },
          },
        ],
        result: payload,
      };
    },
  };
}

export function crearComandoClipCreate(): CommandDefinition<ClipCreatePayload> {
  return {
    type: 'clip.create',
    inverseType: 'clip.delete',
    description: 'Crea un clip en una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        nombre: { type: 'string' },
        inicio: { type: 'number' },
        duracion: { type: 'number' },
        color: { type: 'string' },
        sourceId: { type: 'string' },
        waveform: { type: 'array', items: { type: 'number' } },
      },
      required: ['pistaId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipCreatePayload): StateTransition<ClipCreatePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }

      const clip: AudioClip = {
        id: generarId(),
        trackId: payload.pistaId,
        nombre: payload.nombre || 'Nuevo Clip',
        inicio: payload.inicio ?? 0,
        duracion: payload.duracion ?? 2,
        color: payload.color || '#22c55e',
        seleccionado: false,
        tipo: 'audio',
        clipInicio: 0,
        fadeIn: { id: generarId(), clipId: '', tipo: 'in', duracion: 0, curva: 'lineal' },
        fadeOut: { id: generarId(), clipId: '', tipo: 'out', duracion: 0, curva: 'lineal' },
        warp: false,
        velocidad: 1,
        inverso: false,
        waveform: payload.waveform,
        source: {
          // ruta se usa como clave del buffer de audio en el engine
          ruta: payload.sourceId || '',
          duracion: payload.duracion ?? 2,
          sampleRate: 44100,
          canales: 2,
          bitDepth: 24,
        },
      } as any;

      const pistaActualizada = {
        ...pista,
        clips: [...(pista.clips as any[]), clip],
        fechaModificacion: Date.now(),
      } as Track;

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { clipId: clip.id, pistaId: payload.pistaId },
          },
        ],
        result: payload,
        inversePayload: { pistaId: payload.pistaId, clipId: clip.id },
      };
    },
  };
}

export function crearComandoMidiClipCreate(): CommandDefinition<MidiClipCreatePayload> {
  return {
    type: 'midi.clip.create',
    inverseType: 'clip.delete',
    description: 'Crea un clip MIDI con notas en una pista MIDI',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        nombre: { type: 'string' },
        inicio: { type: 'number' },
        duracion: { type: 'number' },
        color: { type: 'string' },
        notas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pitch: { type: 'number' },
              inicio: { type: 'number' },
              duracion: { type: 'number' },
              velocidad: { type: 'number' },
              canal: { type: 'number' },
            },
            required: ['pitch', 'inicio', 'duracion'],
          },
        },
      },
      required: ['pistaId', 'notas'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: MidiClipCreatePayload): StateTransition<MidiClipCreatePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }
      if (pista.tipo !== 'midi' && pista.tipo !== 'instrumento') {
        throw new Error(`La pista «${pista.nombre}» no es MIDI (tipo=${pista.tipo}). Crea una pista MIDI primero.`);
      }

      const notas: MidiNote[] = (payload.notas ?? []).map((n) => ({
        id: generarId(),
        pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
        velocidad: Math.max(1, Math.min(127, Math.round(n.velocidad ?? 80))),
        inicio: Math.max(0, n.inicio),
        duracion: Math.max(0.0625, n.duracion),
        canal: n.canal ?? 0,
        presion: 0,
        seleccionada: false,
      }));

      let duracion = payload.duracion;
      if (duracion == null || !Number.isFinite(duracion)) {
        duracion = notas.reduce((max, n) => Math.max(max, n.inicio + n.duracion), 4);
      }

      const clip: MidiClip = {
        id: generarId(),
        trackId: payload.pistaId,
        nombre: payload.nombre || 'Clip MIDI',
        inicio: payload.inicio ?? 0,
        duracion,
        color: payload.color || '#a78bfa',
        seleccionado: false,
        tipo: 'midi',
        notas,
        velocidadGlobal: 1,
        cuantizacion: 0.25,
        loop: { activo: false, inicio: 0, fin: duracion },
      };

      const pistaActualizada = {
        ...pista,
        clips: [...(pista.clips as any[]), clip],
        fechaModificacion: Date.now(),
      } as Track;

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { clipId: clip.id, pistaId: payload.pistaId, tipo: 'midi', notas: notas.length },
          },
        ],
        result: { ...payload, notas },
        inversePayload: { pistaId: payload.pistaId, clipId: clip.id },
      };
    },
  };
}

export function crearComandoMidiNotesSet(): CommandDefinition<MidiNotesSetPayload> {
  return {
    type: 'midi.notes.set',
    description: 'Reemplaza las notas de un clip MIDI (piano roll)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        duracion: { type: 'number' },
        notas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              pitch: { type: 'number' },
              inicio: { type: 'number' },
              duracion: { type: 'number' },
              velocidad: { type: 'number' },
              canal: { type: 'number' },
              articulation: { type: 'string' },
              source: { type: 'string' },
            },
            required: ['pitch', 'inicio', 'duracion'],
          },
        },
      },
      required: ['pistaId', 'clipId', 'notas'],
      additionalProperties: false,
    },
    inverseType: 'midi.notes.set',
    handler: (estado: DAWState, payload: MidiNotesSetPayload): StateTransition<MidiNotesSetPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);

      const clips = [...(pista.clips as any[])];
      const index = clips.findIndex(c => c.id === payload.clipId);
      if (index < 0) throw new Error(`Clip no encontrado: ${payload.clipId}`);
      const existing = clips[index];
      if (existing.tipo !== 'midi') throw new Error('El clip no es MIDI');

      const notas: MidiNote[] = (payload.notas ?? []).map(mapMidiNotePayload);

      let duracion = payload.duracion ?? existing.duracion;
      if (notas.length > 0) {
        const end = notas.reduce((max, n) => Math.max(max, n.inicio + n.duracion), 0);
        duracion = Math.max(duracion, end);
      }

      const prevNotas = existing.notas ?? [];
      const prevExpression = existing.expression;
      clips[index] = {
        ...existing,
        notas,
        duracion,
        ...(payload.expression !== undefined ? { expression: payload.expression } : {}),
        loop: { ...(existing.loop ?? { activo: false, inicio: 0, fin: duracion }), fin: duracion },
      };

      const pistaActualizada = { ...pista, clips, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.cuantizado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { clipId: payload.clipId, pistaId: payload.pistaId, notas: notas.length },
          },
        ],
        result: payload,
        inversePayload: {
          pistaId: payload.pistaId,
          clipId: payload.clipId,
          notas: prevNotas,
          duracion: existing.duracion,
          expression: prevExpression,
        },
      };
    },
  };
}

export function crearComandoMidiTranspose(): CommandDefinition<MidiTransposePayload> {
  return {
    type: 'midi.transpose',
    inverseType: 'midi.notes.set',
    description: 'Transpone notas MIDI por semitonos (preserva IDs)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        semitonos: { type: 'number' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId', 'semitonos'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        transposeNotes(notas, payload.semitonos, payload.noteIds),
      ) as StateTransition<MidiTransposePayload>,
  };
}

export function crearComandoMidiQuantize(): CommandDefinition<MidiQuantizePayload> {
  return {
    type: 'midi.quantize',
    inverseType: 'midi.notes.set',
    description: 'Cuantiza notas MIDI con fuerza 0..1',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        gridBeats: { type: 'number' },
        strength: { type: 'number' },
        mode: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId', 'gridBeats'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        quantizeNotes(notas, {
          gridBeats: payload.gridBeats,
          strength: payload.strength,
          mode: payload.mode,
          noteIds: payload.noteIds,
        }),
      ) as StateTransition<MidiQuantizePayload>,
  };
}

export function crearComandoMidiHumanize(): CommandDefinition<MidiHumanizePayload> {
  return {
    type: 'midi.humanize',
    inverseType: 'midi.notes.set',
    description: 'Humaniza MIDI con seed reproducible',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        seed: { type: 'number' },
        timingAmount: { type: 'number' },
        velocityAmount: { type: 'number' },
        durationAmount: { type: 'number' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId', 'seed'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        humanizeNotes(notas, payload),
      ) as StateTransition<MidiHumanizePayload>,
  };
}

export function crearComandoMidiSetVelocity(): CommandDefinition<MidiSetVelocityPayload> {
  return {
    type: 'midi.setVelocity',
    inverseType: 'midi.notes.set',
    description: 'Velocity absoluta o escala relativa (dinamica)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        velocity: { type: 'number' },
        relativeFactor: { type: 'number' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) => {
        if (payload.relativeFactor !== undefined) {
          return scaleVelocityRelative(notas, payload.relativeFactor, payload.noteIds);
        }
        if (payload.velocity === undefined) {
          throw new Error('Indica velocity o relativeFactor');
        }
        return setVelocityAbsolute(notas, payload.velocity, payload.noteIds);
      }) as StateTransition<MidiSetVelocityPayload>,
  };
}

export function crearComandoMidiDeleteNotes(): CommandDefinition<MidiDeleteNotesPayload> {
  return {
    type: 'midi.deleteNotes',
    inverseType: 'midi.notes.set',
    description: 'Elimina notas por ID',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId', 'noteIds'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        deleteNotesById(notas, payload.noteIds),
      ) as StateTransition<MidiDeleteNotesPayload>,
  };
}

export function crearComandoMidiCreateNotes(): CommandDefinition<MidiCreateNotesPayload> {
  return {
    type: 'midi.createNotes',
    inverseType: 'midi.notes.set',
    description: 'Anade notas a un clip MIDI',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        notas: { type: 'array' },
      },
      required: ['pistaId', 'clipId', 'notas'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        appendNotes(
          notas,
          (payload.notas ?? []).map((n) => ({ ...mapMidiNotePayload(n), source: n.source ?? 'drawn' })),
        ),
      ) as StateTransition<MidiCreateNotesPayload>,
  };
}

export function crearComandoMidiMakeStaccato(): CommandDefinition<MidiArticulationPayload> {
  return {
    type: 'midi.makeStaccato',
    inverseType: 'midi.notes.set',
    description: 'Acorta duraciones (staccato)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
        ratio: { type: 'number' },
      },
      required: ['pistaId', 'clipId'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        makeStaccato(notas, payload.ratio ?? 0.45, payload.noteIds),
      ) as StateTransition<MidiArticulationPayload>,
  };
}

export function crearComandoMidiMakeLegato(): CommandDefinition<MidiArticulationPayload> {
  return {
    type: 'midi.makeLegato',
    inverseType: 'midi.notes.set',
    description: 'Conecta notas del mismo pitch (legato)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        makeLegato(notas, payload.noteIds),
      ) as StateTransition<MidiArticulationPayload>,
  };
}

export function crearComandoMidiRepeat(): CommandDefinition<MidiPatternOpPayload> {
  return {
    type: 'midi.repeatPattern',
    inverseType: 'midi.notes.set',
    description: 'Repite la seleccion de notas N veces',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
        times: { type: 'number' },
      },
      required: ['pistaId', 'clipId', 'noteIds'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        repeatSelection(notas, payload.noteIds ?? [], payload.times ?? 1),
      ) as StateTransition<MidiPatternOpPayload>,
  };
}

export function crearComandoMidiReverse(): CommandDefinition<MidiPatternOpPayload> {
  return {
    type: 'midi.reverse',
    inverseType: 'midi.notes.set',
    description: 'Invierte el orden temporal de notas',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        reverseInTime(notas, payload.noteIds),
      ) as StateTransition<MidiPatternOpPayload>,
  };
}

export function crearComandoMidiInvert(): CommandDefinition<MidiPatternOpPayload> {
  return {
    type: 'midi.invert',
    inverseType: 'midi.notes.set',
    description: 'Inversion de pitch',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
        axis: { type: 'number' },
      },
      required: ['pistaId', 'clipId'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        invertPitches(notas, payload.noteIds, payload.axis),
      ) as StateTransition<MidiPatternOpPayload>,
  };
}

export function crearComandoMidiTimeStretch(): CommandDefinition<MidiPatternOpPayload> {
  return {
    type: 'midi.timeStretch',
    inverseType: 'midi.notes.set',
    description: 'Estira/comprime el tiempo de las notas',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
        factor: { type: 'number' },
      },
      required: ['pistaId', 'clipId', 'factor'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        timeStretchNotes(notas, payload.factor ?? 1, payload.noteIds),
      ) as StateTransition<MidiPatternOpPayload>,
  };
}

export function crearComandoMidiConstrainScale(): CommandDefinition<MidiConstrainScalePayload> {
  return {
    type: 'midi.constrainScale',
    inverseType: 'midi.notes.set',
    description: 'Corrige pitches fuera de escala',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        root: { type: 'string' },
        scale: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId', 'root', 'scale'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) => {
        const set = payload.noteIds?.length ? new Set(payload.noteIds) : null;
        const subset = set ? notas.filter((n) => set.has(n.id)) : notas;
        const fixed = constrainNotesToScale(subset, payload.root, payload.scale);
        const byId = new Map(fixed.map((n) => [n.id, n]));
        return notas.map((n) => byId.get(n.id) ?? n);
      }) as StateTransition<MidiConstrainScalePayload>,
  };
}

export function crearComandoMidiGenerate(): CommandDefinition<MidiGeneratePayload> {
  return {
    type: 'midi.generatePattern',
    inverseType: 'clip.delete',
    description: 'Genera patron MIDI (bass_funk, arp, drums, pad_chords)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        kind: { type: 'string' },
        bars: { type: 'number' },
        root: { type: 'string' },
        scale: { type: 'string' },
        seed: { type: 'number' },
        replace: { type: 'boolean' },
        nombre: { type: 'string' },
        inicio: { type: 'number' },
      },
      required: ['pistaId', 'kind'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<MidiGeneratePayload> => {
      const generated = generateMidiPattern({
        kind: payload.kind,
        bars: payload.bars,
        root: payload.root,
        scale: payload.scale,
        seed: payload.seed,
        startBeat: 0,
      }).map((n) => ({
        ...n,
        presion: 0,
        seleccionada: false,
      })) as MidiNote[];

      if (payload.clipId) {
        return applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
          payload.replace ? generated : appendNotes(notas, generated),
        ) as StateTransition<MidiGeneratePayload>;
      }

      const pista = estado.project.tracks.find((t) => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      if (pista.tipo !== 'midi' && pista.tipo !== 'instrumento') {
        throw new Error('La pista debe ser MIDI');
      }
      const endBeat = generated.reduce((m, n) => Math.max(m, n.inicio + n.duracion), (payload.bars ?? 8) * 4);
      const duracion = Math.max(4, endBeat);
      const clip: MidiClip = {
        id: generarId(),
        trackId: payload.pistaId,
        nombre: payload.nombre || `Pattern ${payload.kind}`,
        inicio: payload.inicio ?? 0,
        duracion,
        color: '#a855f7',
        seleccionado: false,
        tipo: 'midi',
        notas: generated,
        velocidadGlobal: 100,
        cuantizacion: 0.25,
        loop: { activo: false, inicio: 0, fin: duracion },
      };
      const clips = [...(pista.clips as MidiClip[]), clip];
      const pistaActualizada = { ...pista, clips, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map((t) => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: Date.now(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { clipId: clip.id, pistaId: payload.pistaId, tipo: 'midi' },
          },
        ],
        result: { ...payload, clipId: clip.id },
        inversePayload: { pistaId: payload.pistaId, clipId: clip.id },
      };
    },
  };
}

function patchMidiClip(
  estado: DAWState,
  pistaId: string,
  clipId: string,
  patch: (clip: MidiClip) => MidiClip,
): StateTransition<{ pistaId: string; clipId: string }> {
  const pista = estado.project.tracks.find((t) => t.id === pistaId);
  if (!pista) throw new Error(`Pista no encontrada: ${pistaId}`);
  const clips = [...(pista.clips as MidiClip[])];
  const index = clips.findIndex((c) => c.id === clipId);
  if (index < 0) throw new Error(`Clip no encontrado: ${clipId}`);
  const existing = clips[index];
  if (existing.tipo !== 'midi') throw new Error('El clip no es MIDI');
  const prev = existing;
  clips[index] = patch(existing);
  const pistaActualizada = { ...pista, clips, fechaModificacion: Date.now() } as Track;
  const proyecto: ProjectState = {
    ...estado.project,
    tracks: estado.project.tracks.map((t) => (t.id === pistaId ? pistaActualizada : t)),
    modificado: true,
    fechaModificacion: Date.now(),
  };
  return {
    state: { ...estado, project: proyecto },
    events: [
      {
        nombre: EventosClip.cuantizado,
        version: 1,
        marcaTiempo: Date.now(),
        fuente: 'domain-commands',
        payload: { clipId, pistaId },
      },
    ],
    result: { pistaId, clipId },
    inversePayload: {
      pistaId,
      clipId,
      notas: prev.notas,
      duracion: prev.duracion,
      expression: prev.expression,
    } as never,
  };
}

export function crearComandoMidiApplyGroove(): CommandDefinition<MidiApplyGroovePayload> {
  return {
    type: 'midi.applyGroove',
    inverseType: 'midi.notes.set',
    description: 'Aplica groove template (timing/velocity) con strength y seed',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        grooveId: { type: 'string' },
        strength: { type: 'number' },
        seed: { type: 'number' },
        noteIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pistaId', 'clipId', 'grooveId'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        applyGroove(notas, payload.grooveId, {
          strength: payload.strength,
          seed: payload.seed,
          noteIds: payload.noteIds,
        }),
      ) as StateTransition<MidiApplyGroovePayload>,
  };
}

export function crearComandoMidiSetCc(): CommandDefinition<MidiSetCcPayload> {
  return {
    type: 'midi.setCC',
    inverseType: 'midi.notes.set',
    description: 'Define puntos de un CC (0-127) en el clip',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        cc: { type: 'number' },
        puntos: { type: 'array' },
        nombre: { type: 'string' },
      },
      required: ['pistaId', 'clipId', 'cc', 'puntos'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      patchMidiClip(estado, payload.pistaId, payload.clipId, (clip) => ({
        ...clip,
        expression: setCcLane(ensureExpression(clip), payload.cc, payload.puntos, payload.nombre),
      })) as StateTransition<MidiSetCcPayload>,
  };
}

export function crearComandoMidiSetPitchBend(): CommandDefinition<MidiSetPitchBendPayload> {
  return {
    type: 'midi.setPitchBend',
    inverseType: 'midi.notes.set',
    description: 'Define curva de pitch bend (-1..1 normalizado)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        puntos: { type: 'array' },
      },
      required: ['pistaId', 'clipId', 'puntos'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      patchMidiClip(estado, payload.pistaId, payload.clipId, (clip) => ({
        ...clip,
        expression: setPitchBendPoints(ensureExpression(clip), payload.puntos),
      })) as StateTransition<MidiSetPitchBendPayload>,
  };
}

export function crearComandoClipDelete(): CommandDefinition<ClipDeletePayload> {
  return {
    type: 'clip.delete',
    inverseType: 'clip.restore',
    description: 'Elimina un clip de una pista',
    risk: 'dangerous',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
      },
      required: ['pistaId', 'clipId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipDeletePayload): StateTransition<ClipDeletePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }

      const clips = pista.clips as any[];
      const index = clips.findIndex(c => c.id === payload.clipId);
      if (index < 0) {
        throw new Error(`Clip no encontrado: ${payload.clipId}`);
      }
      const clip = clips[index];

      const pistaActualizada = {
        ...pista,
        clips: clips.filter(c => c.id !== payload.clipId),
        fechaModificacion: Date.now(),
      } as Track;

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.eliminado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { clipId: payload.clipId, pistaId: payload.pistaId },
          },
        ],
        result: payload,
        inversePayload: { pistaId: payload.pistaId, clip, index },
      };
    },
  };
}

export function crearComandoClipMove(): CommandDefinition<ClipMovePayload> {
  return {
    type: 'clip.move',
    inverseType: 'clip.move',
    description: 'Mueve un clip en el tiempo y/o a otra pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        inicio: { type: 'number' },
        pistaDestinoId: { type: 'string' },
      },
      required: ['pistaId', 'clipId', 'inicio'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipMovePayload): StateTransition<ClipMovePayload> => {
      const pistaOrigen = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pistaOrigen) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }

      const clipActual = (pistaOrigen.clips as any[]).find(c => c.id === payload.clipId);
      if (!clipActual) {
        throw new Error(`Clip no encontrado: ${payload.clipId}`);
      }

      const destinoId = payload.pistaDestinoId && payload.pistaDestinoId !== payload.pistaId
        ? payload.pistaDestinoId
        : payload.pistaId;
      const pistaDestino = destinoId === payload.pistaId
        ? pistaOrigen
        : estado.project.tracks.find(t => t.id === destinoId);

      if (!pistaDestino) {
        throw new Error(`Pista destino no encontrada: ${destinoId}`);
      }

      const inicioAnterior = clipActual.inicio;
      const clipMovido = {
        ...clipActual,
        inicio: payload.inicio,
        trackId: destinoId,
      };

      let tracks = estado.project.tracks;

      if (destinoId === payload.pistaId) {
        const clips = (pistaOrigen.clips as any[]).map(c =>
          c.id === payload.clipId ? clipMovido : c
        );
        const pistaActualizada = { ...pistaOrigen, clips, fechaModificacion: Date.now() } as Track;
        tracks = estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t);
      } else {
        const clipsOrigen = (pistaOrigen.clips as any[]).filter(c => c.id !== payload.clipId);
        const clipsDestino = [...(pistaDestino.clips as any[]), clipMovido];
        tracks = estado.project.tracks.map(t => {
          if (t.id === payload.pistaId) {
            return { ...t, clips: clipsOrigen, fechaModificacion: Date.now() } as Track;
          }
          if (t.id === destinoId) {
            return { ...t, clips: clipsDestino, fechaModificacion: Date.now() } as Track;
          }
          return t;
        });
      }

      const proyecto: ProjectState = {
        ...estado.project,
        tracks,
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [],
        result: payload,
        inversePayload: {
          pistaId: destinoId,
          clipId: payload.clipId,
          inicio: inicioAnterior,
          pistaDestinoId: payload.pistaId,
        },
      };
    },
  };
}

export function crearComandoClipResize(): CommandDefinition<ClipResizePayload> {
  return {
    type: 'clip.resize',
    inverseType: 'clip.resize',
    description: 'Recorta o redimensiona un clip (trim)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        inicio: { type: 'number' },
        duracion: { type: 'number' },
        clipInicio: { type: 'number' },
      },
      required: ['pistaId', 'clipId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipResizePayload): StateTransition<ClipResizePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }

      const clipActual = (pista.clips as any[]).find(c => c.id === payload.clipId);
      if (!clipActual) {
        throw new Error(`Clip no encontrado: ${payload.clipId}`);
      }

      const inicioAnterior = clipActual.inicio;
      const duracionAnterior = clipActual.duracion;
      const clipInicioAnterior = clipActual.clipInicio ?? 0;

      const nuevoInicio = payload.inicio ?? inicioAnterior;
      const nuevaDuracion = payload.duracion ?? duracionAnterior;
      if (nuevaDuracion <= 0) {
        throw new Error('La duración del clip debe ser > 0');
      }
      if (nuevoInicio < 0) {
        throw new Error('El inicio del clip no puede ser negativo');
      }

      let nuevoClipInicio = payload.clipInicio;
      if (nuevoClipInicio === undefined && payload.inicio !== undefined) {
        const delta = payload.inicio - inicioAnterior;
        nuevoClipInicio = Math.max(0, clipInicioAnterior + delta);
      }
      if (nuevoClipInicio === undefined) {
        nuevoClipInicio = clipInicioAnterior;
      }

      const clips = (pista.clips as any[]).map(c =>
        c.id === payload.clipId
          ? {
              ...c,
              inicio: nuevoInicio,
              duracion: nuevaDuracion,
              clipInicio: nuevoClipInicio,
            }
          : c,
      );

      const pistaActualizada = { ...pista, clips, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [],
        result: payload,
        inversePayload: {
          pistaId: payload.pistaId,
          clipId: payload.clipId,
          inicio: inicioAnterior,
          duracion: duracionAnterior,
          clipInicio: clipInicioAnterior,
        },
      };
    },
  };
}

export function crearComandoClipSplit(): CommandDefinition<ClipSplitPayload> {
  return {
    type: 'clip.split',
    description: 'Divide un clip en dos en la posición indicada',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        tiempo: { type: 'number' },
      },
      required: ['pistaId', 'clipId', 'tiempo'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipSplitPayload): StateTransition<ClipSplitPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }

      const clips = (pista.clips as any[]).map(c => {
        if (c.id !== payload.clipId) return c;
        if (payload.tiempo <= c.inicio || payload.tiempo >= c.inicio + c.duracion) return c;

        const duracionA = payload.tiempo - c.inicio;
        const duracionB = c.duracion - duracionA;

        return [
          { ...c, duracion: duracionA },
          {
            ...c,
            id: generarId(),
            inicio: payload.tiempo,
            duracion: duracionB,
          },
        ];
      });

      const clipsFlat = clips.flat();
      const pistaActualizada = { ...pista, clips: clipsFlat, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [],
        result: payload,
      };
    },
  };
}

export function crearComandoTransportToggle(): CommandDefinition<TransportTogglePayload> {
  return {
    type: 'transport.toggle',
    inverseType: 'transport.toggle',
    description: 'Alterna reproducción / pausa',
    risk: 'write',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportTogglePayload> => {
      const wasPlaying = estado.transport.reproduciendo
      const transport: TransportState = {
        ...estado.transport,
        reproduciendo: !wasPlaying,
      }

      return {
        state: { ...estado, transport },
        events: [
          {
            nombre: transport.reproduciendo ? EventosTransporte.iniciado : EventosTransporte.pausado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: {},
          },
        ],
        result: {},
      }
    },
  };
}

export function crearComandoTransportStop(): CommandDefinition<TransportStopPayload> {
  return {
    type: 'transport.stop',
    description: 'Detiene la reproducción y vuelve al inicio',
    risk: 'write',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportStopPayload> => {
      const bpm = estado.project.bpm?.valor ?? 120
      const transport: TransportState = {
        ...estado.transport,
        reproduciendo: false,
        grabacion: 'inactiva',
        posicion: posicionDesdeSegundos(0, bpm),
      };

      return {
        state: { ...estado, transport },
        events: [
          {
            nombre: EventosTransporte.detenido,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: {},
          },
        ],
        result: {},
      };
    },
  };
}

export function crearComandoTransportSeek(): CommandDefinition<TransportSeekPayload> {
  return {
    type: 'transport.seek',
    inverseType: 'transport.seek',
    description: 'Busca a una posición en segundos',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        segundos: { type: 'number', minimum: 0 },
      },
      required: ['segundos'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TransportSeekPayload): StateTransition<TransportSeekPayload> => {
      const bpm = estado.project.bpm?.valor ?? 120
      const segundosAnteriores = estado.transport.posicion?.segundos ?? 0;
      const transport: TransportState = {
        ...estado.transport,
        posicion: posicionDesdeSegundos(payload.segundos, bpm),
      };

      return {
        state: { ...estado, transport },
        events: [],
        result: payload,
        inversePayload: { segundos: segundosAnteriores },
      };
    },
  };
}

export function crearComandoTransportToggleLoop(): CommandDefinition<TransportToggleLoopPayload> {
  return {
    type: 'transport.toggleLoop',
    inverseType: 'transport.toggleLoop',
    description: 'Alterna el bucle de transporte',
    risk: 'write',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportToggleLoopPayload> => {
      const transport: TransportState = {
        ...estado.transport,
        loop: { ...estado.transport.loop, activo: !estado.transport.loop.activo },
      };

      return {
        state: { ...estado, transport },
        events: [],
        result: {},
      };
    },
  };
}

export function crearComandoTransportToggleMetronome(): CommandDefinition<TransportToggleMetronomePayload> {
  return {
    type: 'transport.toggleMetronome',
    inverseType: 'transport.toggleMetronome',
    description: 'Alterna el metrónomo',
    risk: 'write',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportToggleMetronomePayload> => {
      const transport: TransportState = {
        ...estado.transport,
        metronomo: { ...estado.transport.metronomo, activo: !estado.transport.metronomo.activo },
      };

      return {
        state: { ...estado, transport },
        events: [],
        result: {},
      };
    },
  };
}

export function crearComandoTransportToggleRecord(): CommandDefinition<TransportToggleRecordPayload> {
  return {
    type: 'transport.toggleRecord',
    inverseType: 'transport.toggleRecord',
    description: 'Alterna el estado de grabación',
    risk: 'dangerous',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportToggleRecordPayload> => {
      const transport: TransportState = {
        ...estado.transport,
        grabacion: estado.transport.grabacion === 'grabando' ? 'inactiva' : 'grabando',
      };

      return {
        state: { ...estado, transport },
        events: [],
        result: {},
      };
    },
  };
}

export function crearComandoProjectSetBpm(): CommandDefinition<ProjectSetBpmPayload> {
  return {
    type: 'project.setBpm',
    inverseType: 'project.setBpm',
    description: 'Establece el BPM del proyecto',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        bpm: { type: 'number', minimum: 20, maximum: 300 },
      },
      required: ['bpm'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ProjectSetBpmPayload): StateTransition<ProjectSetBpmPayload> => {
      const bpmAnterior = estado.project.bpm?.valor ?? 120;
      const proyecto: ProjectState = {
        ...estado.project,
        bpm: { ...estado.project.bpm, valor: payload.bpm },
        modificado: true,
        fechaModificacion: Date.now(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosProyecto.modificado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { bpm: payload.bpm },
          },
        ],
        result: payload,
        inversePayload: { bpm: bpmAnterior },
      };
    },
  };
}

export type TrackRestorePayload = {
  track: Track;
  index?: number;
};

export function crearComandoTrackRestore(): CommandDefinition<TrackRestorePayload> {
  return {
    type: 'track.restore',
    inverseType: 'track.delete',
    description: 'Restaura una pista eliminada (undo de track.delete)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        track: { type: 'object' },
        index: { type: 'number' },
      },
      required: ['track'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackRestorePayload): StateTransition<TrackRestorePayload> => {
      const tracks = [...estado.project.tracks];
      const index = Math.min(Math.max(payload.index ?? tracks.length, 0), tracks.length);
      tracks.splice(index, 0, payload.track);
      const proyecto: ProjectState = {
        ...estado.project,
        tracks,
        modificado: true,
        fechaModificacion: Date.now(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.creada,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { trackId: payload.track.id, restaurado: true },
          },
        ],
        result: payload,
        inversePayload: { trackId: payload.track.id },
      };
    },
  };
}

export type ClipRestorePayload = {
  pistaId: string;
  clip: unknown;
  index?: number;
};

export function crearComandoClipRestore(): CommandDefinition<ClipRestorePayload> {
  return {
    type: 'clip.restore',
    inverseType: 'clip.delete',
    description: 'Restaura un clip eliminado (undo de clip.delete)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clip: { type: 'object' },
        index: { type: 'number' },
      },
      required: ['pistaId', 'clip'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipRestorePayload): StateTransition<ClipRestorePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }
      const clips = [...(pista.clips as any[])];
      const index = Math.min(Math.max(payload.index ?? clips.length, 0), clips.length);
      clips.splice(index, 0, payload.clip);
      const pistaActualizada = { ...pista, clips, fechaModificacion: Date.now() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: Date.now(),
      };
      const clipId = (payload.clip as { id?: string })?.id ?? '';
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: Date.now(),
            fuente: 'domain-commands',
            payload: { clipId, pistaId: payload.pistaId, restaurado: true },
          },
        ],
        result: payload,
        inversePayload: { pistaId: payload.pistaId, clipId },
      };
    },
  };
}
