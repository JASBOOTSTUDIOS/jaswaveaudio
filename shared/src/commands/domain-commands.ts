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

import { esNotaMidiValida } from '../project/reparar-notas';
import type { CommandDefinition, StateTransition, ValidationResult, ValidationError } from '../types/command';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { Track } from '../types/tracks';
import type { RoutingMatrix } from '../types/routing';
import type { Bus, ConexionDirecta, Envio, GrupoRuteo, Ruta, Sidechain } from '../types/routing';
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
import { emptyExpression, ensureExpression, setCcLane, setPitchBendPoints } from '../midi/expression';
import type { MidiClipExpression } from '../types/clips';
import { aplicarLegatoWorship, clasificarPistaLegato } from '../music/legato-worship';
import { nombreTrackUnico } from '../state/validacion-dominio';
import { entorno } from '../state/entorno-determinista';

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
  return `${entorno.ahora()}-${entorno.aleatorio().toString(36).slice(2, 7)}`;
}

/**
 * Generador de ids reproducible para redo determinista: entrega primero los ids
 * fijados en el payload (`idsGenerados`) y registra todos los que entrega, para
 * devolverlos en `redoPayload`. Así redo recrea las mismas entidades y un undo
 * posterior apunta a ids que existen.
 */
function crearGeneradorIds(fijados?: readonly string[]): { siguiente: () => string; usados: string[] } {
  const usados: string[] = [];
  let i = 0;
  return {
    siguiente: () => {
      const preset = fijados?.[i];
      i++;
      const id = typeof preset === 'string' && preset.length > 0 ? preset : generarId();
      usados.push(id);
      return id;
    },
    usados,
  };
}

const SCHEMA_IDS_GENERADOS = { type: 'array', items: { type: 'string' } } as const;

export type TrackCreatePayload = {
  nombre?: string;
  tipo?: 'audio' | 'midi' | 'instrumento' | 'bus' | 'carpeta';
  color?: string;
  /** Id a usar para la pista (redo determinista / clientes que fijan el id). */
  id?: string;
  /** Id de la pista creada (solo en result del handler). */
  trackId?: string;
};

export type TrackDeletePayload = {
  trackId: string;
};

export type TrackUpdatePayload = {
  trackId: string;
  datos: Partial<Track>;
};

export type TrackMovePayload = {
  trackId: string;
  toIndex: number;
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
  /** Offset dentro de la fuente de audio (beats); copiar/pegar/duplicar lo conservan. */
  clipInicio?: number;
  /** Id del clip creado (solo en result del handler). */
  clipId?: string;
  /** Id a usar para el clip (redo determinista). */
  id?: string;
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
  /** Alias de pistaId (IA / UI en inglés). Se normaliza antes del handler. */
  trackId?: string;
  nombre?: string;
  inicio?: number;
  duracion?: number;
  color?: string;
  notas: MidiNotePayload[];
  /**
   * Lanes de CC del clip (p. ej. el pedal grabado). `valor` NORMALIZADO 0..1, `tiempo` en beats relativos al clip.
   * Solo se leen `expression.cc`; se normalizan con setCcLane (recorte 0..1, curva conservada).
   */
  expression?: MidiClipExpression;
  /** Id a usar para el clip (redo determinista). */
  id?: string;
  /** Ids fijados para las notas creadas, en orden (redo determinista). */
  idsGenerados?: string[];
};

/**
 * Parche de notas: solo las notas que un comando tocó. Es el inverso (y el redo) de toda operación
 * de notas, de modo que deshacer lo propio no borra notas que otro colaborador añadió al mismo clip.
 * `indice` es la posición de la nota en la lista de destino (conserva el orden en uso individual).
 */
export type MidiNotesPatchPayload = {
  pistaId: string;
  clipId: string;
  upsert: { nota: MidiNote; indice: number }[];
  removeIds: string[];
  /** Duración base del clip; nunca queda por debajo del final de sus notas. */
  duracion?: number;
  /** `null` quita la expresión; ausente = no se toca. */
  expression?: MidiClipExpression | null;
};

function claveEstable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(claveEstable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${claveEstable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Diferencia de `desde` a `hacia` (por id): notas nuevas o cambiadas y notas eliminadas. */
export function parcheNotas(desde: MidiNote[], hacia: MidiNote[]): Pick<MidiNotesPatchPayload, 'upsert' | 'removeIds'> {
  const porId = new Map(desde.map((n) => [n.id, n]));
  const idsHacia = new Set(hacia.map((n) => n.id));
  const upsert: MidiNotesPatchPayload['upsert'] = [];
  hacia.forEach((nota, indice) => {
    const previa = porId.get(nota.id);
    if (!previa || claveEstable(previa) !== claveEstable(nota)) upsert.push({ nota, indice });
  });
  return { upsert, removeIds: desde.filter((n) => !idsHacia.has(n.id)).map((n) => n.id) };
}

export function aplicarParcheNotas(notas: MidiNote[], parche: Pick<MidiNotesPatchPayload, 'upsert' | 'removeIds'>): MidiNote[] {
  const quitar = new Set(parche.removeIds);
  const r = notas.filter((n) => !quitar.has(n.id));
  for (const { nota, indice } of [...parche.upsert].sort((a, b) => a.indice - b.indice)) {
    const i = r.findIndex((n) => n.id === nota.id);
    if (i >= 0) r[i] = nota;
    else r.splice(Math.min(Math.max(0, indice), r.length), 0, nota);
  }
  return r;
}

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
  /** Id a usar para el clip nuevo (rama sin clipId; redo determinista). */
  id?: string;
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
  /** valor NORMALIZADO 0..1 (CC 0..127 = valor*127); curva 'step' para pedales. Tiempo en beats relativos al clip. */
  puntos: { id?: string; tiempo: number; valor: number; curva?: 'step' | 'linear' | 'smooth' }[];
  nombre?: string;
};

export type MidiSetPitchBendPayload = {
  pistaId: string;
  clipId: string;
  puntos: { tiempo: number; valor: number }[];
};

/** Payload de nota utilizable: pitch/inicio/duracion numéricos y finitos (evita NaN en el proyecto). */
function notaPayloadValida(n: MidiNotePayload | undefined): n is MidiNotePayload {
  return esNotaMidiValida(n);
}

/** Aviso visible (toast) cuando un comando descarta notas MIDI inválidas del payload. */
function avisoNotasDescartadas(recibidas: number, validas: number): StateTransition['events'] {
  const descartadas = recibidas - validas;
  if (descartadas <= 0) return [];
  return [
    {
      nombre: 'validacion.advertencia',
      version: 1,
      marcaTiempo: entorno.ahora(),
      fuente: 'domain-commands',
      payload: {
        code: 'MIDI_NOTES_DISCARDED',
        message: `Se descartaron ${descartadas} nota(s) MIDI inválidas (sin inicio, duración o tono válidos)`,
      },
    },
  ];
}

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
  opciones?: { duracion?: number; expression?: MidiClipExpression | null },
): StateTransition<{ pistaId: string; clipId: string }> {
  const pista = estado.project.tracks.find((t) => t.id === pistaId);
  if (!pista) throw new Error(`Pista no encontrada: ${pistaId}`);
  const clips = [...(pista.clips as MidiClip[])];
  const index = clips.findIndex((c) => c.id === clipId);
  if (index < 0) throw new Error(`Clip no encontrado: ${clipId}`);
  const existing = clips[index];
  if (existing.tipo !== 'midi') throw new Error('El clip no es MIDI');

  const prevNotas = existing.notas ?? [];
  // Cualquier operación MIDI (humanize, quantize, timeStretch…) que produzca NaN no llega al proyecto.
  const notas = transform(prevNotas, existing).filter(esNotaMidiValida);
  let duracion = opciones?.duracion ?? existing.duracion;
  if (notas.length > 0) {
    const end = notas.reduce((max, n) => Math.max(max, n.inicio + n.duracion), 0);
    duracion = Math.max(duracion, end);
  }
  const clipNuevo: MidiClip = {
    ...existing,
    notas,
    duracion,
    loop: { ...(existing.loop ?? { activo: false, inicio: 0, fin: duracion }), fin: duracion },
  };
  if (opciones?.expression === null) delete (clipNuevo as { expression?: unknown }).expression;
  else if (opciones?.expression !== undefined) clipNuevo.expression = opciones.expression;
  clips[index] = clipNuevo;
  const expresionCambia = opciones?.expression !== undefined;
  const pistaActualizada = { ...pista, clips, fechaModificacion: entorno.ahora() } as Track;
  const proyecto: ProjectState = {
    ...estado.project,
    tracks: estado.project.tracks.map((t) => (t.id === pistaId ? pistaActualizada : t)),
    modificado: true,
    fechaModificacion: entorno.ahora(),
  };
  return {
    state: { ...estado, project: proyecto },
    events: [
      {
        nombre: EventosClip.cuantizado,
        version: 1,
        marcaTiempo: entorno.ahora(),
        fuente: 'domain-commands',
        payload: { clipId, pistaId, notas: notas.length },
      },
    ],
    result: { pistaId, clipId },
    inverseType: 'midi.notes.patch',
    inversePayload: {
      pistaId,
      clipId,
      ...parcheNotas(notas, prevNotas),
      duracion: existing.duracion,
      ...(expresionCambia ? { expression: existing.expression ?? null } : {}),
    } satisfies MidiNotesPatchPayload as never,
    redoType: 'midi.notes.patch',
    redoPayload: {
      pistaId,
      clipId,
      ...parcheNotas(prevNotas, notas),
      duracion,
      ...(expresionCambia ? { expression: opciones?.expression ?? null } : {}),
    } satisfies MidiNotesPatchPayload as never,
  };
}

export type ClipDeletePayload = {
  pistaId: string;
  clipId: string;
};

export type ClipMergePayload = {
  pistaId: string;
  clipIds: string[];
  /** Ids fijados para las notas del clip unido (redo determinista). */
  idsGenerados?: string[];
};

export type ClipMovePayload = {
  pistaId: string;
  clipId: string;
  inicio: number;
  pistaDestinoId?: string;
};

/** Reapunta el audio de un clip (reenlace de media faltante). */
export type ClipSetSourcePayload = {
  pistaId: string;
  clipId: string;
  /** Nueva clave de fuente: ruta relativa de media (`media/x.wav`) o id de buffer. */
  sourceId: string;
  /** Nombre visible opcional del clip. */
  nombre?: string;
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
  /** Tiempo absoluto en beats del arrange (no relativo al clip). */
  tiempo: number;
  /** Ids fijados para el clip/notas nuevos (redo determinista). */
  idsGenerados?: string[];
};

/** Parte un clip MIDI largo en varios clips por cortes (beats relativos al clip). */
export type MidiClipSplitIntoSectionsPayload = {
  pistaId: string;
  clipId: string;
  /**
   * Cortes relativos al inicio del clip (beats). Ej. [32, 64, 96] → Intro | Verso | Coro | Outro.
   * No incluir 0 ni la duración final.
   */
  cuts: number[];
  /** Nombres opcionales por pieza (mismo orden que las piezas resultantes). */
  names?: string[];
  /** Ids fijados para los clips/notas nuevos (redo determinista). */
  idsGenerados?: string[];
};

export type TransportTogglePayload = {};
export type TransportStopPayload = {};
export type TransportSeekPayload = {
  segundos: number;
  /** Gesto del usuario (clic en la regla, W/Inicio): también fija el punto de inicio al que vuelve Stop. */
  marcarInicio?: boolean;
};
export type TransportToggleLoopPayload = {};
export type TransportToggleMetronomePayload = {};
export type TransportToggleRecordPayload = {};
export type ProjectSetBpmPayload = {
  bpm: number;
};

export function crearPista(nombre: string, tipo: Track['tipo'] = 'audio', color?: string, id?: string): Track {
  const base = {
    id: id && id.length > 0 ? id : generarId(),
    nombre,
    nombreOriginal: nombre,
    color: color || '#3b82f6',
    tipo,
    rol: 'normal' as const,
    estado: 'activo' as const,
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
    fechaCreacion: entorno.ahora(),
    fechaModificacion: entorno.ahora(),
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
        id: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackCreatePayload): StateTransition<TrackCreatePayload> => {
      const nombreSolicitado = (payload.nombre || `Pista ${(estado.project.tracks.length + 1)}`).trim();
      const nombre = nombreTrackUnico(nombreSolicitado, estado.project.tracks);
      const tipo = payload.tipo || 'audio';
      const pista = crearPista(nombre, tipo, payload.color, payload.id);
      if (estado.project.tracks.some((t) => t.id === pista.id)) {
        throw new Error(`Ya existe una pista con id ${pista.id}`);
      }
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: [...estado.project.tracks, pista],
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      const events: StateTransition<TrackCreatePayload>['events'] = [
        {
          nombre: EventosTrack.creada,
          version: 1,
          marcaTiempo: entorno.ahora(),
          fuente: 'domain-commands',
          payload: { trackId: pista.id, nombre, tipo },
        },
      ];
      if (nombre !== nombreSolicitado) {
        events.push({
          nombre: 'validacion.advertencia',
          version: 1,
          marcaTiempo: entorno.ahora(),
          fuente: 'domain-commands',
          payload: {
            code: 'TRACK_NAME_DUPLICATED',
            message: `Ya existía una pista llamada "${nombreSolicitado}"; se creó como "${nombre}"`,
          },
        });
      }

      return {
        state: { ...estado, project: proyecto },
        events,
        // Compat: result conserva los campos del payload y añade trackId.
        result: { ...payload, nombre, tipo, trackId: pista.id },
        inversePayload: { trackId: pista.id },
        // Redo fija nombre e id: recrea exactamente la misma pista.
        redoPayload: { ...payload, nombre, id: pista.id },
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
      if (payload.id && estado.project.tracks.some((t) => t.id === payload.id)) {
        errors.push({ code: 'DUPLICATE_ID', message: `Ya existe una pista con id ${payload.id}`, field: 'id' });
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
  };
}

export function crearComandoTrackMove(): CommandDefinition<TrackMovePayload> {
  return {
    type: 'track.move',
    inverseType: 'track.move',
    description: 'Reordena una pista en el arrange y el mixer',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        toIndex: { type: 'number' },
      },
      required: ['trackId', 'toIndex'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackMovePayload): StateTransition<TrackMovePayload> => {
      const tracks = [...estado.project.tracks];
      const fromIndex = tracks.findIndex((t) => t.id === payload.trackId);
      if (fromIndex < 0) throw new Error(`Pista no encontrada: ${payload.trackId}`);
      const toIndex = Math.max(0, Math.min(Math.floor(payload.toIndex), tracks.length - 1));
      if (fromIndex === toIndex) {
        return {
          state: estado,
          events: [],
          result: payload,
          inversePayload: payload,
        };
      }
      const [item] = tracks.splice(fromIndex, 1);
      tracks.splice(toIndex, 0, item!);
      const withOrden = tracks.map((t, i) => ({ ...t, orden: i }));
      const routing = estado.project.routing
        ? { ...estado.project.routing, ordenTracks: withOrden.map((t) => t.id) }
        : estado.project.routing;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: withOrden,
        routing,
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.ordenCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId, fromIndex, toIndex },
          },
        ],
        result: payload,
        inversePayload: { trackId: payload.trackId, toIndex: fromIndex },
      };
    },
  };
}

/**
 * Elementos de ruteo que se limpian al eliminar una pista.
 * Se guardan en el payload inverso para que el undo los restaure.
 */
export type RuteoEliminado = {
  sends?: Envio[];
  sidechains?: Sidechain[];
  rutas?: Ruta[];
  conexionesDirectas?: ConexionDirecta[];
  buses?: Bus[];
  grupos?: GrupoRuteo[];
  ordenTracks?: string[];
  ordenBuses?: string[];
};

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

      // No se borra una pista armada mientras se está grabando: se perdería la toma.
      const grabando = estado.transport?.grabacion === 'grabando';
      if (grabando && pista.armada) {
        throw new Error(
          `No se puede eliminar "${pista.nombre}" mientras está armada y grabando. Desarma la pista o detén la grabación.`,
        );
      }

      // Limpieza de ruteo: envíos, sidechains, rutas y buses que apuntan a la pista.
      const ruteo = limpiarRuteoDePista(estado.project.routing, payload.trackId);

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.filter(t => t.id !== payload.trackId),
        routing: ruteo.routing ?? estado.project.routing,
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.eliminada,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { trackId: payload.trackId },
          },
        ],
        result: payload,
        inversePayload: { track: pista, index, ruteo: ruteo.eliminados },
      };
    },
  };
}

/**
 * Quita del ruteo todo lo que apunta a la pista eliminada y devuelve lo
 * retirado para poder restaurarlo al deshacer.
 */
export function limpiarRuteoDePista(
  routing: RoutingMatrix | undefined,
  trackId: string,
): { routing: RoutingMatrix | undefined; eliminados: RuteoEliminado } {
  if (!routing) return { routing, eliminados: {} };
  const eliminados: RuteoEliminado = {};

  const sends = routing.sends ?? [];
  const sendsEliminados = sends.filter((s) => s.origenTrackId === trackId || s.destinoBusId === trackId);
  if (sendsEliminados.length > 0) {
    eliminados.sends = sendsEliminados;
    routing = { ...routing, sends: sends.filter((s) => !sendsEliminados.includes(s)) };
  }

  const sidechains = routing.sidechains ?? [];
  const sidechainsEliminados = sidechains.filter(
    (s) => s.origenTrackId === trackId || s.destinoTrackId === trackId,
  );
  if (sidechainsEliminados.length > 0) {
    eliminados.sidechains = sidechainsEliminados;
    routing = { ...routing, sidechains: sidechains.filter((s) => !sidechainsEliminados.includes(s)) };
  }

  const rutas = routing.rutas ?? [];
  const rutasEliminadas = rutas.filter((r) => r.origen === trackId || r.destino === trackId);
  if (rutasEliminadas.length > 0) {
    eliminados.rutas = rutasEliminadas;
    routing = { ...routing, rutas: rutas.filter((r) => !rutasEliminadas.includes(r)) };
  }

  const conexiones = routing.conexionesDirectas ?? [];
  const conexionesEliminadas = conexiones.filter((c) => c.origen === trackId || c.destino === trackId);
  if (conexionesEliminadas.length > 0) {
    eliminados.conexionesDirectas = conexionesEliminadas;
    routing = { ...routing, conexionesDirectas: conexiones.filter((c) => !conexionesEliminadas.includes(c)) };
  }

  const buses = routing.buses ?? [];
  const busesEliminados = buses.filter((b) => b.id === trackId);
  if (busesEliminados.length > 0) {
    eliminados.buses = busesEliminados;
    routing = { ...routing, buses: buses.filter((b) => b.id !== trackId) };
  }

  const grupos = routing.grupos ?? [];
  const gruposEliminados = grupos.filter((g) => g.busId === trackId);
  if (gruposEliminados.length > 0) {
    eliminados.grupos = gruposEliminados;
    routing = { ...routing, grupos: grupos.filter((g) => g.busId !== trackId) };
  }

  if ((routing.ordenTracks ?? []).includes(trackId)) {
    eliminados.ordenTracks = routing.ordenTracks.filter((id) => id !== trackId);
    routing = { ...routing, ordenTracks: routing.ordenTracks.filter((id) => id !== trackId) };
  }
  if ((routing.ordenBuses ?? []).includes(trackId)) {
    eliminados.ordenBuses = routing.ordenBuses.filter((id) => id !== trackId);
    routing = { ...routing, ordenBuses: routing.ordenBuses.filter((id) => id !== trackId) };
  }

  return { routing, eliminados };
}

/** Devuelve al ruteo los elementos que `track.delete` había quitado. */
export function restaurarRuteoDePista(
  routing: RoutingMatrix | undefined,
  eliminados: RuteoEliminado | undefined,
): RoutingMatrix | undefined {
  if (!routing || !eliminados) return routing;
  let out = routing;
  if (eliminados.sends?.length) out = { ...out, sends: [...(out.sends ?? []), ...eliminados.sends] };
  if (eliminados.sidechains?.length) {
    out = { ...out, sidechains: [...(out.sidechains ?? []), ...eliminados.sidechains] };
  }
  if (eliminados.rutas?.length) out = { ...out, rutas: [...(out.rutas ?? []), ...eliminados.rutas] };
  if (eliminados.conexionesDirectas?.length) {
    out = { ...out, conexionesDirectas: [...(out.conexionesDirectas ?? []), ...eliminados.conexionesDirectas] };
  }
  if (eliminados.buses?.length) out = { ...out, buses: [...(out.buses ?? []), ...eliminados.buses] };
  if (eliminados.grupos?.length) out = { ...out, grupos: [...(out.grupos ?? []), ...eliminados.grupos] };
  if (eliminados.ordenTracks?.length) {
    out = { ...out, ordenTracks: [...(out.ordenTracks ?? []), ...eliminados.ordenTracks] };
  }
  if (eliminados.ordenBuses?.length) {
    out = { ...out, ordenBuses: [...(out.ordenBuses ?? []), ...eliminados.ordenBuses] };
  }
  return out;
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

      const datos = { ...payload.datos } as Record<string, unknown>;
      let nombreSolicitado: string | null = null;
      if (typeof datos.nombre === 'string') {
        nombreSolicitado = datos.nombre;
        datos.nombre = nombreTrackUnico(nombreSolicitado, estado.project.tracks, payload.trackId);
      }

      const datosAnteriores: Record<string, unknown> = {};
      for (const clave of Object.keys(datos)) {
        datosAnteriores[clave] = (pista as unknown as Record<string, unknown>)[clave];
      }

      const pistaActualizada = { ...pista, ...datos, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      const events: StateTransition<TrackUpdatePayload>['events'] = [
        {
          nombre: EventosTrack.actualizada,
          version: 1,
          marcaTiempo: entorno.ahora(),
          fuente: 'domain-commands',
          payload: { trackId: payload.trackId, cambios: datos as any },
        },
      ];
      if (nombreSolicitado !== null && datos.nombre !== nombreSolicitado) {
        events.push({
          nombre: 'validacion.advertencia',
          version: 1,
          marcaTiempo: entorno.ahora(),
          fuente: 'domain-commands',
          payload: {
            code: 'TRACK_NAME_DUPLICATED',
            message: `Ya existía una pista llamada "${nombreSolicitado}"; se renombró como "${String(datos.nombre)}"`,
          },
        });
      }

      return {
        state: { ...estado, project: proyecto },
        events,
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
      const pistaActualizada = { ...pista, silenciada, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.silenciada,
            version: 1,
            marcaTiempo: entorno.ahora(),
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
      const pistaActualizada = { ...pista, soloActiva, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.soloActiva,
            version: 1,
            marcaTiempo: entorno.ahora(),
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
      const pistaActualizada = { ...pista, armada, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.armada,
            version: 1,
            marcaTiempo: entorno.ahora(),
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
        fechaModificacion: entorno.ahora(),
      } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.trackId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.monitorizada,
            version: 1,
            marcaTiempo: entorno.ahora(),
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
        clipInicio: { type: 'number', minimum: 0 },
        id: { type: 'string' },
      },
      required: ['pistaId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipCreatePayload): StateTransition<ClipCreatePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }

      const clipIdNuevo = payload.id && payload.id.length > 0 ? payload.id : generarId();
      if ((pista.clips as { id: string }[]).some((c) => c.id === clipIdNuevo)) {
        throw new Error(`Ya existe un clip con id ${clipIdNuevo}`);
      }
      const clipInicio =
        typeof payload.clipInicio === 'number' && Number.isFinite(payload.clipInicio) && payload.clipInicio > 0
          ? payload.clipInicio
          : 0;
      const clip: AudioClip = {
        id: clipIdNuevo,
        trackId: payload.pistaId,
        nombre: payload.nombre || 'Nuevo Clip',
        inicio: payload.inicio ?? 0,
        duracion: payload.duracion ?? 2,
        color: payload.color || '#22c55e',
        seleccionado: false,
        tipo: 'audio',
        clipInicio,
        fadeIn: { id: generarId(), clipId: '', tipo: 'in', duracion: 0, curva: 'lineal' },
        fadeOut: { id: generarId(), clipId: '', tipo: 'out', duracion: 0, curva: 'lineal' },
        warp: false,
        velocidad: 1,
        inverso: false,
        waveform: payload.waveform,
        source: {
          // ruta se usa como clave del buffer de audio en el engine
          ruta: payload.sourceId || '',
          // La fuente cubre al menos el offset más la parte visible del clip.
          duracion: (payload.duracion ?? 2) + clipInicio,
          sampleRate: 44100,
          canales: 2,
          bitDepth: 24,
        },
      } as any;

      const pistaActualizada = {
        ...pista,
        clips: [...(pista.clips as any[]), clip],
        fechaModificacion: entorno.ahora(),
      } as Track;

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { clipId: clip.id, pistaId: payload.pistaId },
          },
        ],
        result: { ...payload, clipId: clip.id },
        inversePayload: { pistaId: payload.pistaId, clipId: clip.id },
        redoPayload: { ...payload, id: clip.id },
      };
    },
  };
}

export function crearComandoMidiClipCreate(): CommandDefinition<MidiClipCreatePayload> {
  return {
    type: 'midi.clip.create',
    inverseType: 'clip.delete',
    description:
      'Crea un clip MIDI con notas en una pista MIDI. OBLIGATORIO: pistaId (id de la pista), inicio y duracion del clip en beats desde el principio de la canción y notas. Ejemplo: {pistaId:"<id>", inicio:0, duracion:16, notas:[{pitch:60,inicio:0,duracion:1,velocidad:90}]}. Si ya hay un clip en ese tramo no crees otro: añade o cambia notas con midi.notes.patch. `notas` es un array JSON de objetos {pitch, inicio, duracion, velocidad} (pitch 0–127, inicio y duracion en beats contados desde el principio del clip, velocidad 1–127), nunca un texto ni una descripción.',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        trackId: { type: 'string' },
        nombre: { type: 'string' },
        inicio: { type: 'number' },
        duracion: { type: 'number' },
        color: { type: 'string' },
        id: { type: 'string' },
        idsGenerados: SCHEMA_IDS_GENERADOS,
        expression: {},
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
            },
            required: ['pitch', 'inicio', 'duracion'],
          },
        },
      },
      // pistaId o trackId (alias); el handler unifica.
      required: ['notas'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: MidiClipCreatePayload): StateTransition<MidiClipCreatePayload> => {
      const pistaId = String(payload.pistaId ?? payload.trackId ?? '').trim()
      if (!pistaId) {
        throw new Error('Falta pistaId/trackId');
      }
      const pista = estado.project.tracks.find(t => t.id === pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${pistaId}`);
      }
      if (pista.tipo !== 'midi' && pista.tipo !== 'instrumento' && pista.tipo !== 'audio') {
        throw new Error(`La pista «${pista.nombre}» no admite clips MIDI (tipo=${pista.tipo}).`);
      }

      const ids = crearGeneradorIds(payload.idsGenerados);
      const notas: MidiNote[] = (payload.notas ?? []).filter(notaPayloadValida).map((n) => ({
        id: ids.siguiente(),
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

      const clipIdNuevo = payload.id && payload.id.length > 0 ? payload.id : generarId();
      if ((pista.clips as { id: string }[]).some((c) => c.id === clipIdNuevo)) {
        throw new Error(`Ya existe un clip con id ${clipIdNuevo}`);
      }
      const clip: MidiClip = {
        id: clipIdNuevo,
        trackId: pistaId,
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
      const lanesCc = payload.expression?.cc ?? [];
      if (lanesCc.length > 0) {
        let expresion = emptyExpression();
        for (const l of lanesCc) expresion = setCcLane(expresion, l.cc, l.puntos, l.nombre);
        clip.expression = expresion;
      }

      const pistaActualizada = {
        ...pista,
        clips: [...(pista.clips as any[]), clip],
        fechaModificacion: entorno.ahora(),
      } as Track;

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { clipId: clip.id, pistaId, tipo: 'midi', notas: notas.length },
          },
          ...avisoNotasDescartadas(payload.notas?.length ?? 0, notas.length),
        ],
        result: { ...payload, pistaId, notas, clipId: clip.id } as MidiClipCreatePayload,
        inversePayload: { pistaId, clipId: clip.id },
        redoPayload: { ...payload, id: clip.id, idsGenerados: ids.usados },
      };
    },
  };
}

/** Aplica un parche de notas (inverso/redo diferencial de las operaciones de notas). */
export function crearComandoMidiNotesPatch(): CommandDefinition<MidiNotesPatchPayload> {
  return {
    type: 'midi.notes.patch',
    description: 'Aplica cambios puntuales a notas de un clip MIDI (sin tocar las demás): upsert = notas nuevas o cambiadas [{pitch,inicio,duracion,velocidad}] (con id para cambiar una existente) y removeIds = ids a quitar (lista vacía si no quitas ninguna). Úsalo para completar compases vacíos dentro de un clip que ya existe.',
    risk: 'write',
    inverseType: 'midi.notes.patch',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        upsert: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, pitch: { type: 'number' }, inicio: { type: 'number' }, duracion: { type: 'number' }, velocidad: { type: 'number' } },
          },
        },
        removeIds: { type: 'array', items: { type: 'string' } },
        duracion: { type: 'number' },
        expression: {},
      },
      required: ['pistaId', 'clipId', 'upsert', 'removeIds'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) => aplicarParcheNotas(notas, payload), {
        ...(payload.duracion !== undefined ? { duracion: payload.duracion } : {}),
        ...(payload.expression !== undefined ? { expression: payload.expression } : {}),
      }) as StateTransition<MidiNotesPatchPayload>,
  };
}

export function crearComandoMidiNotesSet(): CommandDefinition<MidiNotesSetPayload> {
  return {
    type: 'midi.notes.set',
    description: 'Reemplaza TODAS las notas de un clip MIDI (piano roll). Requiere pistaId, clipId y notas [{pitch,inicio,duracion,velocidad}] con la parte completa; una lista vacía no se acepta (para borrar usa midi.notes.patch con removeIds). Para añadir o cambiar unas pocas notas usa midi.notes.patch.',
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

      const notas: MidiNote[] = (payload.notas ?? []).filter(notaPayloadValida).map(mapMidiNotePayload);

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

      const pistaActualizada = { ...pista, clips, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.cuantizado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { clipId: payload.clipId, pistaId: payload.pistaId, notas: notas.length },
          },
          ...avisoNotasDescartadas(payload.notas?.length ?? 0, notas.length),
        ],
        result: payload,
        inverseType: 'midi.notes.patch',
        inversePayload: {
          pistaId: payload.pistaId,
          clipId: payload.clipId,
          ...parcheNotas(notas, prevNotas),
          duracion: existing.duracion,
          ...(payload.expression !== undefined ? { expression: prevExpression ?? null } : {}),
        } satisfies MidiNotesPatchPayload as never,
        redoType: 'midi.notes.patch',
        redoPayload: {
          pistaId: payload.pistaId,
          clipId: payload.clipId,
          ...parcheNotas(prevNotas, notas),
          duracion,
          ...(payload.expression !== undefined ? { expression: payload.expression ?? null } : {}),
        } satisfies MidiNotesPatchPayload as never,
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
    handler: (estado, payload) => {
      const validas = (payload.notas ?? []).filter(notaPayloadValida);
      const t = applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
        appendNotes(
          notas,
          validas.map((n) => ({ ...mapMidiNotePayload(n), source: n.source ?? 'drawn' })),
        ),
      ) as StateTransition<MidiCreateNotesPayload>;
      return { ...t, events: [...t.events, ...avisoNotasDescartadas(payload.notas?.length ?? 0, validas.length)] };
    },

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

export type MidiLegatoWorshipPayload = {
  pistaId: string;
  clipId?: string;
  solapeMs?: number;
  modo?: 'legato' | 'pad' | 'auto';
};

/**
 * Legato worship (ver docs/plans/R-legato-worship.md): cada nota o acorde se sostiene hasta solapeMs (500) después
 * del inicio de la siguiente. Reutiliza applyMidiNotesToClip (undo por parche). Sin clipId vale si la pista tiene
 * un único clip MIDI; con varios, quien llama lanza el comando por clip.
 */
export function crearComandoMidiLegatoWorship(): CommandDefinition<MidiLegatoWorshipPayload> {
  return {
    type: 'midi.notes.legatoWorship',
    inverseType: 'midi.notes.patch',
    description: 'Sostiene las notas hasta 500 ms después de la siguiente (legato worship; pads siempre suenan)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        solapeMs: { type: 'number' },
        modo: { type: 'string', enum: ['legato', 'pad', 'auto'] },
      },
      required: ['pistaId'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const pista = estado.project.tracks.find((t) => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      const tipo = clasificarPistaLegato(pista.nombre, (pista as { plugins?: Array<{ nombre?: string }> }).plugins ?? []);
      if (tipo === 'bateria') throw new Error('El legato worship no se aplica a la bateria ni a la percusion');
      let clipId = payload.clipId;
      if (!clipId) {
        const midis = pista.clips.filter((c) => c.tipo === 'midi');
        if (midis.length !== 1) throw new Error(`Indica clipId: la pista tiene ${midis.length} clips MIDI`);
        clipId = midis[0]!.id;
      }
      const modo = payload.modo && payload.modo !== 'auto' ? payload.modo : tipo === 'pad' ? 'pad' : 'legato';
      return applyMidiNotesToClip(estado, payload.pistaId, clipId, (notas, clip) =>
        aplicarLegatoWorship(notas, { bpm: Number(estado.project.bpm), modo, solapeMs: payload.solapeMs, finClip: clip.duracion }).notas,
      ) as StateTransition<MidiLegatoWorshipPayload>;
    },
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
        id: { type: 'string' },
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
        const transicion = applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) =>
          payload.replace ? generated : appendNotes(notas, generated),
        ) as StateTransition<MidiGeneratePayload>;
        // Sobre un clip existente el inverso es restaurar las notas (parche diferencial que trae
        // applyMidiNotesToClip), no borrar el clip.
        return transicion;
      }

      const pista = estado.project.tracks.find((t) => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      if (pista.tipo !== 'midi' && pista.tipo !== 'instrumento' && pista.tipo !== 'audio') {
        throw new Error('La pista debe admitir MIDI (audio, midi o instrumento)');
      }
      const endBeat = generated.reduce((m, n) => Math.max(m, n.inicio + n.duracion), (payload.bars ?? 8) * 4);
      const duracion = Math.max(4, endBeat);
      const clipIdNuevo = payload.id && payload.id.length > 0 ? payload.id : generarId();
      if ((pista.clips as { id: string }[]).some((c) => c.id === clipIdNuevo)) {
        throw new Error(`Ya existe un clip con id ${clipIdNuevo}`);
      }
      const clip: MidiClip = {
        id: clipIdNuevo,
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
      const pistaActualizada = { ...pista, clips, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map((t) => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { clipId: clip.id, pistaId: payload.pistaId, tipo: 'midi' },
          },
        ],
        result: { ...payload, clipId: clip.id },
        inversePayload: { pistaId: payload.pistaId, clipId: clip.id },
        redoPayload: { ...payload, id: clip.id },
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
  const pistaActualizada = { ...pista, clips, fechaModificacion: entorno.ahora() } as Track;
  const proyecto: ProjectState = {
    ...estado.project,
    tracks: estado.project.tracks.map((t) => (t.id === pistaId ? pistaActualizada : t)),
    modificado: true,
    fechaModificacion: entorno.ahora(),
  };
  return {
    state: { ...estado, project: proyecto },
    events: [
      {
        nombre: EventosClip.cuantizado,
        version: 1,
        marcaTiempo: entorno.ahora(),
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
        fechaModificacion: entorno.ahora(),
      } as Track;

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.eliminado,
            version: 1,
            marcaTiempo: entorno.ahora(),
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

export function crearComandoClipMerge(): CommandDefinition<ClipMergePayload> {
  return {
    type: 'clip.merge',
    inverseType: 'clip.restoreMany',
    description: 'Une varios clips de la misma pista en uno (MIDI o audio)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipIds: { type: 'array', items: { type: 'string' }, minItems: 2 },
        idsGenerados: SCHEMA_IDS_GENERADOS,
      },
      required: ['pistaId', 'clipIds'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipMergePayload): StateTransition<ClipMergePayload> => {
      const pista = estado.project.tracks.find((t) => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      const ids = [...new Set(payload.clipIds)];
      if (ids.length < 2) throw new Error('clip.merge requiere al menos 2 clips');

      const clips = (pista.clips as { id: string; inicio?: number; duracion?: number; tipo?: string; notas?: MidiNote[]; nombre?: string; color?: string; source?: { ruta?: string }; sourceId?: string; waveform?: number[] }[])
        .filter((c) => ids.includes(c.id))
        .sort((a, b) => (a.inicio ?? 0) - (b.inicio ?? 0));
      if (clips.length < 2) throw new Error('Clips no encontrados en la pista');

      const allMidi = clips.every((c) => c.tipo === 'midi');
      const allAudio = clips.every((c) => c.tipo === 'audio' || (!c.tipo && !c.notas?.length));
      if (!allMidi && !allAudio) throw new Error('Solo se pueden unir clips del mismo tipo (MIDI o audio)');

      const minInicio = Math.min(...clips.map((c) => c.inicio ?? 0));
      const maxEnd = Math.max(...clips.map((c) => (c.inicio ?? 0) + (c.duracion ?? 0)));
      const removed = clips.map((c) => ({ clip: c, index: pista.clips.findIndex((x: { id: string }) => x.id === c.id) }));
      // Undo: quitar el clip unido (conserva el id del primero) y reinsertar los originales.
      const inversePayload: ClipRestoreManyPayload = {
        pistaId: payload.pistaId,
        removeClipIds: [clips[0]!.id],
        clips: removed.map((r) => r.clip),
        indices: removed.map((r) => r.index),
      };

      if (allMidi) {
        const genIds = crearGeneradorIds(payload.idsGenerados);
        const mergedNotes: MidiNote[] = [];
        for (const c of clips) {
          const offset = (c.inicio ?? 0) - minInicio;
          for (const n of c.notas ?? []) {
            mergedNotes.push({
              ...n,
              id: genIds.siguiente(),
              inicio: (n.inicio ?? 0) + offset,
            });
          }
        }
        const primary = clips[0]!;
        const merged = {
          ...primary,
          inicio: minInicio,
          duracion: maxEnd - minInicio,
          nombre: primary.nombre || 'Clip unido',
          notas: mergedNotes,
        };
        const remaining = (pista.clips as { id: string }[]).filter((c) => !ids.includes(c.id));
        remaining.push(merged as never);
        remaining.sort((a, b) => (a as { inicio?: number }).inicio! - (b as { inicio?: number }).inicio!);
        const pistaActualizada = { ...pista, clips: remaining, fechaModificacion: entorno.ahora() } as Track;
        const proyecto: ProjectState = {
          ...estado.project,
          tracks: estado.project.tracks.map((t) => (t.id === payload.pistaId ? pistaActualizada : t)),
          modificado: true,
          fechaModificacion: entorno.ahora(),
        };
        return {
          state: { ...estado, project: proyecto },
          events: [
            {
              nombre: EventosClip.unido,
              version: 1,
              marcaTiempo: entorno.ahora(),
              fuente: 'domain-commands',
              payload: { clipId: merged.id, pistaId: payload.pistaId, merged: ids },
            },
          ],
          result: { pistaId: payload.pistaId, clipIds: ids },
          inversePayload,
          redoPayload: { ...payload, idsGenerados: genIds.usados },
        };
      }

      // Audio: extender el primer clip para cubrir el rango (misma fuente recomendada)
      const primary = clips[0]!;
      const merged = {
        ...primary,
        inicio: minInicio,
        duracion: maxEnd - minInicio,
        nombre: primary.nombre || 'Clip unido',
      };
      const remaining = (pista.clips as { id: string }[]).filter((c) => !ids.includes(c.id));
      remaining.push(merged as never);
      remaining.sort((a, b) => (a as { inicio?: number }).inicio! - (b as { inicio?: number }).inicio!);
      const pistaActualizada = { ...pista, clips: remaining, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map((t) => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.unido,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { clipId: merged.id, pistaId: payload.pistaId, merged: ids },
          },
        ],
        result: { pistaId: payload.pistaId, clipIds: ids },
        inversePayload,
      };
    },
  };
}

/**
 * Comprueba que un clip pueda vivir en la pista destino.
 * Devuelve el mensaje de error o null si son compatibles.
 */
export function incompatibilidadPistaClip(
  clip: { tipo?: string },
  pista: { tipo?: string; nombre?: string },
): string | null {
  const tipoClip = clip?.tipo;
  const tipoPista = pista?.tipo;
  if (!tipoClip || !tipoPista) return null;
  const nombre = pista.nombre ? `"${pista.nombre}"` : 'la pista destino';
  if (tipoClip === 'audio' && tipoPista === 'midi') {
    return `No se puede mover un clip de audio a la pista MIDI ${nombre}.`;
  }
  if (tipoClip === 'midi' && tipoPista === 'audio') {
    return `No se puede mover un clip MIDI a la pista de audio ${nombre}.`;
  }
  if (tipoPista === 'carpeta' || tipoPista === 'bus' || tipoPista === 'vca' || tipoPista === 'master') {
    return `No se pueden mover clips a ${nombre} (${tipoPista}).`;
  }
  return null;
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

      // Compatibilidad pista/clip: un clip de audio no puede vivir en una pista
      // MIDI (ni al revés). Un clip de audio solo va a pistas de audio.
      const incompatibilidad = incompatibilidadPistaClip(clipActual, pistaDestino);
      if (incompatibilidad) {
        throw new Error(incompatibilidad);
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
        const pistaActualizada = { ...pistaOrigen, clips, fechaModificacion: entorno.ahora() } as Track;
        tracks = estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t);
      } else {
        const clipsOrigen = (pistaOrigen.clips as any[]).filter(c => c.id !== payload.clipId);
        const clipsDestino = [...(pistaDestino.clips as any[]), clipMovido];
        tracks = estado.project.tracks.map(t => {
          if (t.id === payload.pistaId) {
            return { ...t, clips: clipsOrigen, fechaModificacion: entorno.ahora() } as Track;
          }
          if (t.id === destinoId) {
            return { ...t, clips: clipsDestino, fechaModificacion: entorno.ahora() } as Track;
          }
          return t;
        });
      }

      const proyecto: ProjectState = {
        ...estado.project,
        tracks,
        modificado: true,
        fechaModificacion: entorno.ahora(),
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

export function crearComandoClipSetSource(): CommandDefinition<ClipSetSourcePayload> {
  return {
    type: 'clip.setSource',
    inverseType: 'clip.setSource',
    description: 'Reapunta el audio de un clip (reenlace de media faltante)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        sourceId: { type: 'string' },
        nombre: { type: 'string' },
      },
      required: ['pistaId', 'clipId', 'sourceId'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipSetSourcePayload): StateTransition<ClipSetSourcePayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }
      const clip = (pista.clips as any[]).find(c => c.id === payload.clipId);
      if (!clip) {
        throw new Error(`Clip no encontrado: ${payload.clipId}`);
      }
      if (typeof payload.sourceId !== 'string' || payload.sourceId.trim() === '') {
        throw new Error('La nueva fuente del clip no puede estar vacía');
      }

      const sourceAnterior = clip.source?.ruta ?? '';
      const nombreAnterior = clip.nombre ?? '';

      const clipActualizado = {
        ...clip,
        nombre: payload.nombre ?? clip.nombre,
        sourceId: payload.sourceId,
        source: {
          ...(clip.source ?? {}),
          ruta: payload.sourceId,
        },
      };

      const pistaActualizada = {
        ...pista,
        clips: (pista.clips as any[]).map(c => (c.id === payload.clipId ? clipActualizado : c)),
        fechaModificacion: entorno.ahora(),
      } as Track;

      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [],
        result: { ...payload },
        inversePayload: {
          pistaId: payload.pistaId,
          clipId: payload.clipId,
          sourceId: sourceAnterior,
          nombre: nombreAnterior,
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

      const pistaActualizada = { ...pista, clips, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
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
    inverseType: 'clip.restoreMany',
    description: 'Divide un clip en dos en la posición indicada (MIDI reparte notas)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        tiempo: { type: 'number' },
        idsGenerados: SCHEMA_IDS_GENERADOS,
      },
      required: ['pistaId', 'clipId', 'tiempo'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipSplitPayload): StateTransition<ClipSplitPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }

      const ids = crearGeneradorIds(payload.idsGenerados);
      const indiceOriginal = (pista.clips as any[]).findIndex(c => c.id === payload.clipId);
      const original = indiceOriginal >= 0 ? (pista.clips as any[])[indiceOriginal] : undefined;
      let idDerecho: string | null = null;
      const clips = (pista.clips as any[]).map(c => {
        if (c.id !== payload.clipId) return c;
        if (payload.tiempo <= c.inicio || payload.tiempo >= c.inicio + c.duracion) return c;

        const duracionA = payload.tiempo - c.inicio;
        const duracionB = c.duracion - duracionA;
        const cutRel = duracionA;

        if (c.tipo === 'midi') {
          const notas = (c.notas ?? []) as MidiNote[];
          const leftNotes: MidiNote[] = [];
          const rightNotes: MidiNote[] = [];
          for (const n of notas) {
            const noteEnd = n.inicio + n.duracion;
            if (noteEnd <= cutRel + 1e-9) {
              leftNotes.push({ ...n });
            } else if (n.inicio >= cutRel - 1e-9) {
              rightNotes.push({
                ...n,
                id: ids.siguiente(),
                inicio: Math.max(0, n.inicio - cutRel),
              });
            } else {
              // Nota cruza el corte → trozo a cada lado
              leftNotes.push({
                ...n,
                duracion: Math.max(0.0625, cutRel - n.inicio),
              });
              rightNotes.push({
                ...n,
                id: ids.siguiente(),
                inicio: 0,
                duracion: Math.max(0.0625, noteEnd - cutRel),
              });
            }
          }
          const left: MidiClip = {
            ...(c as MidiClip),
            duracion: duracionA,
            notas: leftNotes,
            loop: { activo: false, inicio: 0, fin: duracionA },
          };
          idDerecho = ids.siguiente();
          const right: MidiClip = {
            ...(c as MidiClip),
            id: idDerecho,
            inicio: payload.tiempo,
            duracion: duracionB,
            notas: rightNotes,
            seleccionado: false,
            loop: { activo: false, inicio: 0, fin: duracionB },
          };
          return [left, right];
        }

        idDerecho = ids.siguiente();
        return [
          { ...c, duracion: duracionA },
          {
            ...c,
            id: idDerecho,
            inicio: payload.tiempo,
            duracion: duracionB,
          },
        ];
      });

      const clipsFlat = clips.flat();
      const pistaActualizada = { ...pista, clips: clipsFlat, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => t.id === payload.pistaId ? pistaActualizada : t),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      // Undo: quitar las dos mitades y reinsertar el clip original en su índice.
      const inversePayload: ClipRestoreManyPayload =
        original && idDerecho
          ? {
              pistaId: payload.pistaId,
              removeClipIds: [original.id, idDerecho],
              clips: [original],
              indices: [indiceOriginal],
            }
          : { pistaId: payload.pistaId, removeClipIds: [], clips: [] };

      return {
        state: { ...estado, project: proyecto },
        events: [],
        result: payload,
        inversePayload,
        redoPayload: { ...payload, idsGenerados: ids.usados },
      };
    },
  };
}

export function crearComandoMidiClipSplitIntoSections(): CommandDefinition<MidiClipSplitIntoSectionsPayload> {
  return {
    type: 'midi.clip.splitIntoSections',
    inverseType: 'clip.restoreMany',
    description:
      'Parte un clip MIDI largo en varios clips por secciones (intro/verso/coro…) sin dejar un solo bloque de toda la canción',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        cuts: { type: 'array', items: { type: 'number' } },
        names: { type: 'array', items: { type: 'string' } },
        idsGenerados: SCHEMA_IDS_GENERADOS,
      },
      required: ['pistaId', 'clipId', 'cuts'],
      additionalProperties: false,
    },
    handler: (
      estado: DAWState,
      payload: MidiClipSplitIntoSectionsPayload,
    ): StateTransition<MidiClipSplitIntoSectionsPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      const clips = [...(pista.clips as MidiClip[])];
      const idx = clips.findIndex(c => c.id === payload.clipId);
      if (idx < 0) throw new Error(`Clip no encontrado: ${payload.clipId}`);
      const clip = clips[idx]!;
      if (clip.tipo !== 'midi') {
        throw new Error('midi.clip.splitIntoSections solo aplica a clips MIDI');
      }

      const dur = Math.max(0, Number(clip.duracion ?? 0));
      const rawCuts = (payload.cuts ?? [])
        .map(Number)
        .filter(c => Number.isFinite(c) && c > 0.25 && c < dur - 0.25);
      const cuts = [...new Set(rawCuts.map(c => Math.round(c * 1000) / 1000))].sort((a, b) => a - b);
      if (!cuts.length) {
        throw new Error('cuts debe tener al menos un corte dentro del clip');
      }

      const bounds = [0, ...cuts, dur];
      const names = payload.names ?? [];
      const ids = crearGeneradorIds(payload.idsGenerados);
      const notas = clip.notas ?? [];
      const pieces: MidiClip[] = [];

      for (let i = 0; i < bounds.length - 1; i++) {
        const start = bounds[i]!;
        const end = bounds[i + 1]!;
        const pieceDur = end - start;
        if (pieceDur < 0.25) continue;
        const pieceNotes: MidiNote[] = [];
        for (const n of notas) {
          const noteEnd = n.inicio + n.duracion;
          if (noteEnd <= start + 1e-9 || n.inicio >= end - 1e-9) continue;
          const newInicio = Math.max(0, n.inicio - start);
          const newEnd = Math.min(pieceDur, noteEnd - start);
          const newDur = newEnd - newInicio;
          if (newDur < 0.05) continue;
          pieceNotes.push({
            ...n,
            id: i === 0 ? n.id : ids.siguiente(),
            inicio: newInicio,
            duracion: newDur,
          });
        }
        const nombre =
          (names[i] && String(names[i]).trim()) ||
          `${clip.nombre || 'Clip'} · ${i + 1}/${bounds.length - 1}`;
        pieces.push({
          ...clip,
          id: i === 0 ? clip.id : ids.siguiente(),
          nombre,
          inicio: clip.inicio + start,
          duracion: pieceDur,
          notas: pieceNotes,
          seleccionado: false,
          loop: { activo: false, inicio: 0, fin: pieceDur },
        });
      }

      if (pieces.length < 2) {
        throw new Error('No se generaron suficientes secciones');
      }

      clips.splice(idx, 1, ...pieces);
      const pistaActualizada = {
        ...pista,
        clips,
        fechaModificacion: entorno.ahora(),
      } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.dividido,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: {
              pistaId: payload.pistaId,
              clipId: payload.clipId,
              sections: pieces.length,
            },
          },
        ],
        result: { ...payload, sections: pieces.length } as never,
        // Undo: quitar las piezas y reinsertar el clip original en su índice.
        inversePayload: {
          pistaId: payload.pistaId,
          removeClipIds: pieces.map((p) => p.id),
          clips: [clip],
          indices: [idx],
        } satisfies ClipRestoreManyPayload,
        redoPayload: { ...payload, idsGenerados: ids.usados },
      };
    },
  };
}

export function crearComandoTransportToggle(): CommandDefinition<TransportTogglePayload> {
  return {
    type: 'transport.toggle',
    replicacion: 'local',
    historialUndo: 'ninguno',
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
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: {},
          },
        ],
        result: {},
      }
    },
  };
}

/** Punto de inicio del transporte en segundos (0 si no se ha fijado o no es válido). */
export function puntoInicioDe(transport: Pick<TransportState, 'puntoInicio'> | undefined): number {
  const p = transport?.puntoInicio
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : 0
}

export function crearComandoTransportStop(): CommandDefinition<TransportStopPayload> {
  return {
    type: 'transport.stop',
    replicacion: 'local',
    historialUndo: 'ninguno',
    description: 'Detiene la reproducción y vuelve al punto de inicio',
    risk: 'write',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportStopPayload> => {
      const bpm = estado.project.bpm?.valor ?? 120
      const transport: TransportState = {
        ...estado.transport,
        reproduciendo: false,
        grabacion: 'inactiva',
        posicion: posicionDesdeSegundos(puntoInicioDe(estado.transport), bpm),
      };

      return {
        state: { ...estado, transport },
        events: [
          {
            nombre: EventosTransporte.detenido,
            version: 1,
            marcaTiempo: entorno.ahora(),
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
    replicacion: 'local',
    historialUndo: 'ninguno',
    description: 'Busca a una posición en segundos',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        segundos: { type: 'number', minimum: 0 },
        marcarInicio: { type: 'boolean' },
      },
      required: ['segundos'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TransportSeekPayload): StateTransition<TransportSeekPayload> => {
      const bpm = estado.project.bpm?.valor ?? 120
      const transport: TransportState = {
        ...estado.transport,
        posicion: posicionDesdeSegundos(payload.segundos, bpm),
        ...(payload.marcarInicio ? { puntoInicio: Math.max(0, payload.segundos) } : {}),
      };

      return {
        state: { ...estado, transport },
        events: [],
        result: payload,
      };
    },
  };
}

export function crearComandoTransportToggleLoop(): CommandDefinition<TransportToggleLoopPayload> {
  return {
    type: 'transport.toggleLoop',
    replicacion: 'local',
    historialUndo: 'ninguno',
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
    replicacion: 'local',
    historialUndo: 'ninguno',
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
    replicacion: 'local',
    historialUndo: 'ninguno',
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

export type TransportTogglePunchPayload = Record<string, never>;

export function crearComandoTransportTogglePunch(): CommandDefinition<TransportTogglePunchPayload> {
  return {
    type: 'transport.togglePunch',
    replicacion: 'local',
    historialUndo: 'ninguno',
    description: 'Activa/desactiva punch in/out (ventana de grabación)',
    risk: 'write',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportTogglePunchPayload> => {
      const punch = estado.transport.punch;
      const activo = !punch.activo;
      // Si se activa sin rango, usar loop o 0→8 compases
      let inicio = punch.inicio;
      let fin = punch.fin;
      if (activo && fin.beats <= inicio.beats) {
        const loop = estado.transport.loop;
        if (loop.activo && loop.fin.beats > loop.inicio.beats) {
          inicio = { ...loop.inicio };
          fin = { ...loop.fin };
        } else {
          const bpm = estado.project.bpm?.valor ?? 120;
          const beats = 8;
          inicio = { ...inicio, beats: 0, segundos: 0 };
          fin = {
            ...fin,
            beats,
            segundos: (beats * 60) / bpm,
          };
        }
      }
      const transport: TransportState = {
        ...estado.transport,
        punch: {
          ...punch,
          activo,
          inicio,
          fin,
          modo: activo ? 'both' : 'none',
        },
        modoGrabacion: activo ? 'punch' : estado.transport.modoGrabacion === 'punch' ? 'normal' : estado.transport.modoGrabacion,
      };
      return { state: { ...estado, transport }, events: [], result: {} };
    },
  };
}

export type TransportToggleCountInPayload = Record<string, never>;

export function crearComandoTransportToggleCountIn(): CommandDefinition<TransportToggleCountInPayload> {
  return {
    type: 'transport.toggleCountIn',
    replicacion: 'local',
    historialUndo: 'ninguno',
    description: 'Activa/desactiva count-in (pre-roll) antes de grabar',
    risk: 'write',
    schema: { type: 'object', additionalProperties: false },
    handler: (estado: DAWState): StateTransition<TransportToggleCountInPayload> => {
      const countIn = estado.transport.countIn;
      const transport: TransportState = {
        ...estado.transport,
        countIn: {
          ...countIn,
          activo: !countIn.activo,
          compases: Math.max(1, countIn.compases || 1),
        },
      };
      return { state: { ...estado, transport }, events: [], result: {} };
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
      const bpm = payload.bpm
      if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
        throw new Error(`BPM inválido: ${String(bpm)} (rango 20–300)`)
      }
      const bpmAnteriorRaw = estado.project.bpm?.valor
      const bpmAnterior =
        typeof bpmAnteriorRaw === 'number' && Number.isFinite(bpmAnteriorRaw) ? bpmAnteriorRaw : 120
      const proyecto: ProjectState = {
        ...estado.project,
        bpm: { ...estado.project.bpm, valor: bpm },
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };

      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosProyecto.modificado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'domain-commands',
            payload: { bpm },
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
  /** Ruteo que `track.delete` limpió (se restaura al deshacer). */
  ruteo?: RuteoEliminado;
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
        ruteo: { type: 'object' },
      },
      required: ['track'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: TrackRestorePayload): StateTransition<TrackRestorePayload> => {
      const tracks = [...estado.project.tracks];
      const index = Math.min(Math.max(payload.index ?? tracks.length, 0), tracks.length);
      tracks.splice(index, 0, payload.track);
      const routing = restaurarRuteoDePista(estado.project.routing, payload.ruteo) ?? estado.project.routing;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks,
        routing,
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.creada,
            version: 1,
            marcaTiempo: entorno.ahora(),
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
      const pistaActualizada = { ...pista, clips, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      const clipId = (payload.clip as { id?: string })?.id ?? '';
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo: entorno.ahora(),
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

export type ClipRestoreManyPayload = {
  pistaId: string;
  /** Clips a quitar antes de reinsertar (p. ej. el clip unido o las piezas de un split). */
  removeClipIds?: string[];
  /** Clips a reinsertar. */
  clips: unknown[];
  /** Índice original de cada clip (mismo orden que `clips`); por defecto, al final. */
  indices?: number[];
};

/**
 * Reemplaza un conjunto de clips por otro en una pista. Es su propio inverso:
 * undo de clip.merge / clip.split / midi.clip.splitIntoSections.
 */
export function crearComandoClipRestoreMany(): CommandDefinition<ClipRestoreManyPayload> {
  return {
    type: 'clip.restoreMany',
    inverseType: 'clip.restoreMany',
    description: 'Restaura varios clips (undo de unir/dividir clips)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        removeClipIds: { type: 'array', items: { type: 'string' } },
        clips: { type: 'array' },
        indices: { type: 'array', items: { type: 'number' } },
      },
      required: ['pistaId', 'clips'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: ClipRestoreManyPayload): StateTransition<ClipRestoreManyPayload> => {
      const pista = estado.project.tracks.find(t => t.id === payload.pistaId);
      if (!pista) {
        throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      }
      const actuales = pista.clips as { id: string }[];
      const quitar = new Set(payload.removeClipIds ?? []);
      const quitados = actuales
        .map((clip, index) => ({ clip, index }))
        .filter((x) => quitar.has(x.clip.id));
      if (quitados.length !== quitar.size) {
        const faltan = [...quitar].filter((id) => !actuales.some((c) => c.id === id));
        throw new Error(`Clips no encontrados: ${faltan.join(', ')}`);
      }
      const clips = actuales.filter((c) => !quitar.has(c.id));
      const aInsertar = (payload.clips ?? [])
        .map((clip, i) => ({ clip: clip as { id: string }, index: payload.indices?.[i] ?? Number.POSITIVE_INFINITY }))
        .sort((a, b) => a.index - b.index);
      for (const { clip } of aInsertar) {
        if (clips.some((c) => c.id === clip.id)) {
          throw new Error(`Ya existe un clip con id ${clip.id}`);
        }
      }
      for (const { clip, index } of aInsertar) {
        clips.splice(Math.min(Math.max(index, 0), clips.length), 0, clip);
      }

      const pistaActualizada = { ...pista, clips, fechaModificacion: entorno.ahora() } as Track;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map(t => (t.id === payload.pistaId ? pistaActualizada : t)),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      const insertadosIds = aInsertar.map((x) => x.clip.id);
      const marcaTiempo = entorno.ahora();
      return {
        state: { ...estado, project: proyecto },
        events: [
          ...quitados
            .filter((x) => !insertadosIds.includes(x.clip.id))
            .map((x) => ({
              nombre: EventosClip.eliminado,
              version: 1,
              marcaTiempo,
              fuente: 'domain-commands',
              payload: { clipId: x.clip.id, pistaId: payload.pistaId },
            })),
          ...insertadosIds.map((clipId) => ({
            nombre: EventosClip.creado,
            version: 1,
            marcaTiempo,
            fuente: 'domain-commands',
            payload: { clipId, pistaId: payload.pistaId, restaurado: true },
          })),
        ],
        result: payload,
        inversePayload: {
          pistaId: payload.pistaId,
          removeClipIds: insertadosIds,
          clips: quitados.map((x) => x.clip),
          indices: quitados.map((x) => x.index),
        } satisfies ClipRestoreManyPayload,
      };
    },
  };
}


// ── G3: mute de clip, fades, ganancia de clip, mute y corte de notas ─────────

export type ClipSetMutePayload = { cambios: { pistaId: string; clipId: string; silenciado: boolean }[] };

/** Clips silenciados (atenuados, sin sonar). Varios clips de varias pistas en un solo paso de undo. */
export function crearComandoClipSetMute(): CommandDefinition<ClipSetMutePayload> {
  return {
    type: 'clip.setMute',
    inverseType: 'clip.setMute',
    description: 'Silencia o activa clips (no suenan en la reproducción ni en el export)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        cambios: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { pistaId: { type: 'string' }, clipId: { type: 'string' }, silenciado: { type: 'boolean' } },
            required: ['pistaId', 'clipId', 'silenciado'],
          },
        },
      },
      required: ['cambios'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const previos: ClipSetMutePayload['cambios'] = [];
      let tracks = estado.project.tracks;
      for (const c of payload.cambios) {
        const pista = tracks.find((t) => t.id === c.pistaId);
        if (!pista) throw new Error(`Pista no encontrada: ${c.pistaId}`);
        const clip = (pista.clips as { id: string; silenciado?: boolean }[]).find((x) => x.id === c.clipId);
        if (!clip) throw new Error(`Clip no encontrado: ${c.clipId}`);
        previos.push({ pistaId: c.pistaId, clipId: c.clipId, silenciado: clip.silenciado === true });
        tracks = tracks.map((t) =>
          t.id === c.pistaId
            ? ({
                ...t,
                clips: (t.clips as { id: string }[]).map((x) => (x.id === c.clipId ? { ...x, silenciado: c.silenciado } : x)),
                fechaModificacion: entorno.ahora(),
              } as Track)
            : t,
        );
      }
      return {
        state: { ...estado, project: { ...estado.project, tracks, modificado: true, fechaModificacion: entorno.ahora() } },
        events: [],
        result: payload,
        inversePayload: { cambios: previos.reverse() },
      };
    },
  };
}

export type CurvaFade = 'lineal' | 'exponencial' | 'logaritmica';
export type ClipSetFadePayload = {
  pistaId: string;
  clipId: string;
  tipo: 'in' | 'out';
  /** Segundos (independiente del tempo). 0 quita el fade. */
  duracion: number;
  curva?: CurvaFade;
};

export function crearComandoClipSetFade(): CommandDefinition<ClipSetFadePayload> {
  return {
    type: 'clip.setFade',
    inverseType: 'clip.setFade',
    description: 'Fundido de entrada o salida de un clip de audio (duración en segundos y curva)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        tipo: { type: 'string', enum: ['in', 'out'] },
        duracion: { type: 'number' },
        curva: { type: 'string', enum: ['lineal', 'exponencial', 'logaritmica'] },
      },
      required: ['pistaId', 'clipId', 'tipo', 'duracion'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const pista = estado.project.tracks.find((t) => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      const clip = (pista.clips as AudioClip[]).find((c) => c.id === payload.clipId);
      if (!clip) throw new Error(`Clip no encontrado: ${payload.clipId}`);
      if (clip.tipo !== 'audio') throw new Error('Los fundidos solo se aplican a clips de audio');
      if (!Number.isFinite(payload.duracion) || payload.duracion < 0) throw new Error('La duración del fundido debe ser ≥ 0 s');
      const bpm = estado.project.bpm?.valor > 0 ? estado.project.bpm.valor : 120;
      const largoSeg = (clip.duracion * 60) / bpm;
      const otro = payload.tipo === 'in' ? clip.fadeOut?.duracion ?? 0 : clip.fadeIn?.duracion ?? 0;
      // Los dos fundidos juntos nunca superan el largo del clip.
      const duracion = Math.min(payload.duracion, Math.max(0, largoSeg - otro));
      const clave = payload.tipo === 'in' ? 'fadeIn' : 'fadeOut';
      const previo = clip[clave];
      const curvaPrevia = (previo?.curva === 'exponencial' || previo?.curva === 'logaritmica' ? previo.curva : 'lineal') as CurvaFade;
      const fade = {
        id: previo?.id ?? `${clip.id}-${clave}`,
        clipId: clip.id,
        tipo: payload.tipo,
        duracion,
        curva: payload.curva ?? curvaPrevia,
      };
      const pistaNueva = {
        ...pista,
        clips: (pista.clips as AudioClip[]).map((c) => (c.id === clip.id ? { ...c, [clave]: fade } : c)),
        fechaModificacion: entorno.ahora(),
      } as Track;
      return {
        state: {
          ...estado,
          project: {
            ...estado.project,
            tracks: estado.project.tracks.map((t) => (t.id === pista.id ? pistaNueva : t)),
            modificado: true,
            fechaModificacion: entorno.ahora(),
          },
        },
        events: [],
        result: { ...payload, duracion },
        inversePayload: { pistaId: pista.id, clipId: clip.id, tipo: payload.tipo, duracion: previo?.duracion ?? 0, curva: curvaPrevia },
      };
    },
  };
}

export type ClipSetGainPayload = { pistaId: string; clipId: string; gananciaDb: number };

export function crearComandoClipSetGain(): CommandDefinition<ClipSetGainPayload> {
  return {
    type: 'clip.setGain',
    inverseType: 'clip.setGain',
    description: 'Ganancia de un clip de audio en dB (−48 a +24), antes del fader de la pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: { pistaId: { type: 'string' }, clipId: { type: 'string' }, gananciaDb: { type: 'number' } },
      required: ['pistaId', 'clipId', 'gananciaDb'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const pista = estado.project.tracks.find((t) => t.id === payload.pistaId);
      if (!pista) throw new Error(`Pista no encontrada: ${payload.pistaId}`);
      const clip = (pista.clips as AudioClip[]).find((c) => c.id === payload.clipId);
      if (!clip) throw new Error(`Clip no encontrado: ${payload.clipId}`);
      if (clip.tipo !== 'audio') throw new Error('La ganancia de clip solo se aplica a clips de audio');
      if (!Number.isFinite(payload.gananciaDb)) throw new Error('Ganancia inválida');
      const gananciaDb = Math.max(-48, Math.min(24, payload.gananciaDb));
      const pistaNueva = {
        ...pista,
        clips: (pista.clips as AudioClip[]).map((c) => (c.id === clip.id ? { ...c, ganancia: gananciaDb } : c)),
        fechaModificacion: entorno.ahora(),
      } as Track;
      return {
        state: {
          ...estado,
          project: {
            ...estado.project,
            tracks: estado.project.tracks.map((t) => (t.id === pista.id ? pistaNueva : t)),
            modificado: true,
            fechaModificacion: entorno.ahora(),
          },
        },
        events: [],
        result: { ...payload, gananciaDb },
        inversePayload: { pistaId: pista.id, clipId: clip.id, gananciaDb: clip.ganancia ?? 0 },
      };
    },
  };
}

export type MidiNotesMutePayload = { pistaId: string; clipId: string; noteIds: string[]; mute?: boolean };

/** Silencia notas concretas. Sin `mute`: alterna (si todas estaban silenciadas, las activa). */
export function crearComandoMidiNotesMute(): CommandDefinition<MidiNotesMutePayload> {
  return {
    type: 'midi.notes.mute',
    inverseType: 'midi.notes.patch',
    description: 'Silencia o activa notas MIDI (se ven atenuadas y no suenan)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        noteIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        mute: { type: 'boolean' },
      },
      required: ['pistaId', 'clipId', 'noteIds'],
      additionalProperties: false,
    },
    handler: (estado, payload) =>
      applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) => {
        const ids = new Set(payload.noteIds);
        const objetivo = notas.filter((n) => ids.has(n.id));
        if (!objetivo.length) throw new Error('Ninguna de esas notas está en el clip');
        const mute = payload.mute ?? !objetivo.every((n) => n.mute === true);
        return notas.map((n) => (ids.has(n.id) ? { ...n, mute } : n));
      }) as StateTransition<MidiNotesMutePayload>,
  };
}

export type MidiNotesSplitPayload = {
  pistaId: string;
  clipId: string;
  /** Beat (relativo al clip) donde se cortan las notas que lo cruzan. */
  beat: number;
  /** Solo estas notas (por defecto, todas las que cruzan el punto). */
  noteIds?: string[];
  idsGenerados?: string[];
};

export function crearComandoMidiNotesSplit(): CommandDefinition<MidiNotesSplitPayload> {
  return {
    type: 'midi.notes.split',
    inverseType: 'midi.notes.patch',
    description: 'Corta en dos las notas que cruzan un beat (tijera del piano roll)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        clipId: { type: 'string' },
        beat: { type: 'number' },
        noteIds: { type: 'array', items: { type: 'string' } },
        idsGenerados: SCHEMA_IDS_GENERADOS,
      },
      required: ['pistaId', 'clipId', 'beat'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const ids = crearGeneradorIds(payload.idsGenerados);
      const limitar = payload.noteIds?.length ? new Set(payload.noteIds) : null;
      const MIN = 1 / 64;
      let cortadas = 0;
      const t = applyMidiNotesToClip(estado, payload.pistaId, payload.clipId, (notas) => {
        const out: MidiNote[] = [];
        for (const n of notas) {
          const fin = n.inicio + n.duracion;
          const cruza = payload.beat > n.inicio + MIN && payload.beat < fin - MIN;
          if (!cruza || (limitar && !limitar.has(n.id))) {
            out.push(n);
            continue;
          }
          cortadas++;
          out.push({ ...n, duracion: payload.beat - n.inicio });
          out.push({ ...n, id: ids.siguiente(), inicio: payload.beat, duracion: fin - payload.beat, seleccionada: false });
        }
        return out;
      });
      if (cortadas === 0) throw new Error('Ninguna nota cruza ese punto: no hay nada que cortar');
      return {
        ...t,
        result: { ...payload, cortadas } as never,
      } as StateTransition<MidiNotesSplitPayload>;
    },
  };
}

export type ClipSetReversePayload = { cambios: { pistaId: string; clipId: string; inverso: boolean }[] };

/** Audio al revés (sin tocar el archivo: el motor lee la región del clip de atrás hacia delante). */
export function crearComandoClipSetReverse(): CommandDefinition<ClipSetReversePayload> {
  return {
    type: 'clip.setReverse',
    inverseType: 'clip.setReverse',
    description: 'Reproduce al revés clips de audio (no modifica el archivo)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        cambios: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { pistaId: { type: 'string' }, clipId: { type: 'string' }, inverso: { type: 'boolean' } },
            required: ['pistaId', 'clipId', 'inverso'],
          },
        },
      },
      required: ['cambios'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const previos: ClipSetReversePayload['cambios'] = [];
      let tracks = estado.project.tracks;
      for (const c of payload.cambios) {
        const pista = tracks.find((t) => t.id === c.pistaId);
        if (!pista) throw new Error(`Pista no encontrada: ${c.pistaId}`);
        const clip = (pista.clips as AudioClip[]).find((x) => x.id === c.clipId);
        if (!clip) throw new Error(`Clip no encontrado: ${c.clipId}`);
        if (clip.tipo !== 'audio') throw new Error('Solo los clips de audio se pueden invertir');
        previos.push({ pistaId: c.pistaId, clipId: c.clipId, inverso: clip.inverso === true });
        tracks = tracks.map((t) =>
          t.id === c.pistaId
            ? ({
                ...t,
                clips: (t.clips as AudioClip[]).map((x) => (x.id === c.clipId ? { ...x, inverso: c.inverso } : x)),
                fechaModificacion: entorno.ahora(),
              } as Track)
            : t,
        );
      }
      return {
        state: { ...estado, project: { ...estado.project, tracks, modificado: true, fechaModificacion: entorno.ahora() } },
        events: [],
        result: payload,
        inversePayload: { cambios: previos.reverse() },
      };
    },
  };
}
