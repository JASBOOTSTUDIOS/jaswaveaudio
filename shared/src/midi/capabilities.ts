/**
 * ArticulationMap + InstrumentCapabilities (para VI / IA).
 */

export type ArticulationId =
  | 'sustain'
  | 'staccato'
  | 'legato'
  | 'accent'
  | 'mute'
  | 'slide'
  | 'hammer-on'
  | 'pull-off'
  | 'ghost'
  | 'open'
  | 'closed';

export type ArticulationTarget =
  | { tipo: 'keyswitch'; pitch: number; canal?: number }
  | { tipo: 'cc'; cc: number; valor: number }
  | { tipo: 'program'; programa: number; bancoMSB?: number; bancoLSB?: number }
  | { tipo: 'velocity'; escala: number }
  | { tipo: 'channel'; canal: number };

export interface ArticulationMapEntry {
  id: ArticulationId | string;
  nombre: string;
  targets: ArticulationTarget[];
}

export interface ArticulationMap {
  id: string;
  nombre: string;
  instrumento?: string;
  entries: ArticulationMapEntry[];
}

export interface InstrumentCapabilities {
  supportsVelocity: boolean;
  supportsPitchBend: boolean;
  supportsAftertouch: boolean;
  supportsPolyAftertouch: boolean;
  supportsCC: boolean;
  supportsKeyswitches: boolean;
  supportsPolyphony: boolean;
  supportsMPE: boolean;
  pitchBendRangeSemitones: number;
  maxPolyphony: number;
  availableCCs: number[];
  articulationMapId?: string;
}

export const DEFAULT_CAPABILITIES: InstrumentCapabilities = {
  supportsVelocity: true,
  supportsPitchBend: true,
  supportsAftertouch: true,
  supportsPolyAftertouch: false,
  supportsCC: true,
  supportsKeyswitches: false,
  supportsPolyphony: true,
  supportsMPE: false,
  pitchBendRangeSemitones: 2,
  maxPolyphony: 64,
  availableCCs: [1, 7, 10, 11, 64, 74],
};

export const MPE_CAPABILITIES: InstrumentCapabilities = {
  ...DEFAULT_CAPABILITIES,
  supportsMPE: true,
  supportsPolyAftertouch: true,
  pitchBendRangeSemitones: 48,
  maxPolyphony: 15,
  articulationMapId: 'mpe-default',
};

export const DEFAULT_ARTICULATION_MAP: ArticulationMap = {
  id: 'jaswave-default',
  nombre: 'JasWave Default',
  entries: [
    { id: 'sustain', nombre: 'Sustain', targets: [{ tipo: 'velocity', escala: 1 }] },
    { id: 'staccato', nombre: 'Staccato', targets: [{ tipo: 'velocity', escala: 0.9 }] },
    { id: 'legato', nombre: 'Legato', targets: [{ tipo: 'cc', cc: 68, valor: 127 }] },
    { id: 'accent', nombre: 'Accent', targets: [{ tipo: 'velocity', escala: 1.25 }] },
    { id: 'ghost', nombre: 'Ghost', targets: [{ tipo: 'velocity', escala: 0.45 }] },
    { id: 'mute', nombre: 'Mute', targets: [{ tipo: 'cc', cc: 64, valor: 0 }] },
    {
      id: 'open',
      nombre: 'Open hat',
      targets: [{ tipo: 'keyswitch', pitch: 46 }],
    },
    {
      id: 'closed',
      nombre: 'Closed hat',
      targets: [{ tipo: 'keyswitch', pitch: 42 }],
    },
  ],
};

export function resolveArticulation(
  map: ArticulationMap,
  articulationId: string,
): ArticulationMapEntry | undefined {
  return map.entries.find((e) => e.id === articulationId);
}

/** Aplica targets de articulación a una nota (modelo; el motor usa esto en playback). */
export function applyArticulationToNote<
  T extends { velocidad: number; canal: number; articulation?: string; metadata?: Record<string, unknown> },
>(note: T, map: ArticulationMap = DEFAULT_ARTICULATION_MAP): T {
  if (!note.articulation) return note;
  const entry = resolveArticulation(map, note.articulation);
  if (!entry) return note;
  let next = { ...note };
  for (const t of entry.targets) {
    if (t.tipo === 'velocity') {
      next = {
        ...next,
        velocidad: Math.max(1, Math.min(127, Math.round(next.velocidad * t.escala))),
      };
    } else if (t.tipo === 'channel') {
      next = { ...next, canal: t.canal };
    } else {
      next = {
        ...next,
        metadata: { ...(next.metadata ?? {}), articulationTarget: t },
      };
    }
  }
  return next;
}
