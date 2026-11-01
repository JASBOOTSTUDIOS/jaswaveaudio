/**
 * Comandos del modo Directo (K3): zonas MIDI, seguridad del máster y bloqueo. Todos con undo por
 * instantánea; el estado vive en `project.directo`.
 */

import type { CommandDefinition, StateTransition, ValidationResult, ValidationError } from '../types/command';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import { directoInicial, normalizarZona, type DirectoState, type ZonaMidi } from '../types/directo';
import { entorno } from '../state/entorno-determinista';

const FUENTE = 'directo-commands';

function directoDe(estado: DAWState): DirectoState {
  const d = estado.project.directo;
  return d ? { ...d, zonas: [...d.zonas], seguridad: { ...d.seguridad } } : directoInicial();
}

function conDirecto(
  estado: DAWState,
  directo: DirectoState,
  evento: string,
  payload: Record<string, string | number | boolean | null>,
): Pick<StateTransition, 'state' | 'events'> {
  const proyecto: ProjectState = {
    ...estado.project,
    directo,
    modificado: true,
    fechaModificacion: entorno.ahora(),
  };
  return {
    state: { ...estado, project: proyecto },
    events: [{ nombre: evento, version: 1, marcaTiempo: entorno.ahora(), fuente: FUENTE, payload }],
  };
}

function pistaExiste(estado: DAWState, pistaId: unknown): boolean {
  return typeof pistaId === 'string' && estado.project.tracks.some((t) => t.id === pistaId);
}

const ok = (): ValidationResult => ({ valid: true, errors: [], warnings: [] });
const fallo = (errors: ValidationError[]): ValidationResult => ({ valid: errors.length === 0, errors, warnings: [] });

const SCHEMA_ZONA_PROPS = {
  id: { type: 'string' },
  pistaId: { type: 'string' },
  lo: { type: 'number' },
  hi: { type: 'number' },
  transposicion: { type: 'number' },
  curvaVelocidad: { type: 'string' },
  escalaVelocidad: { type: 'number' },
  velocidadFija: { type: 'number' },
  canalEntrada: { type: 'number' },
  canalSalida: { type: 'number' },
  activa: { type: 'boolean' },
  nombre: { type: 'string' },
} as const;

// ── midi.zones.set ──────────────────────────────────────────────

export type MidiZonesSetPayload = {
  /** Si se indica, solo se sustituyen las zonas de esa pista; si no, todas. */
  pistaId?: string;
  zonas: Array<Partial<ZonaMidi> & { pistaId?: string }>;
  /** Ids generados (redo determinista). */
  idsGenerados?: string[];
};

export function crearComandoMidiZonesSet(): CommandDefinition<MidiZonesSetPayload, { zonaIds: string[] }> {
  return {
    type: 'midi.zones.set',
    historialUndo: 'instantanea',
    description: 'Sustituye las zonas MIDI (split/capa/transposición) de una pista o de todo el proyecto',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        pistaId: { type: 'string' },
        zonas: { type: 'array', items: { type: 'object', properties: SCHEMA_ZONA_PROPS, additionalProperties: false } },
        idsGenerados: { type: 'array', items: { type: 'string' } },
      },
      required: ['zonas'],
      additionalProperties: false,
    },
    validate: (estado, payload): ValidationResult => {
      const errors: ValidationError[] = [];
      if (payload.pistaId !== undefined && !pistaExiste(estado, payload.pistaId)) {
        errors.push({ code: 'TRACK_NOT_FOUND', message: `No existe la pista ${payload.pistaId}`, field: 'pistaId' });
      }
      payload.zonas.forEach((z, i) => {
        const pista = z.pistaId ?? payload.pistaId;
        if (!pistaExiste(estado, pista)) {
          errors.push({ code: 'TRACK_NOT_FOUND', message: `La zona ${i + 1} apunta a una pista inexistente (${String(pista)})`, field: 'zonas' });
        }
      });
      if (payload.zonas.length > 64) errors.push({ code: 'TOO_MANY_ZONES', message: 'Máximo 64 zonas' });
      return fallo(errors);
    },
    handler: (estado: DAWState, payload: MidiZonesSetPayload): StateTransition<{ zonaIds: string[] }> => {
      const directo = directoDe(estado);
      const usados: string[] = [];
      let n = 0;
      const nuevas = payload.zonas.map((z) => {
        const preset = payload.idsGenerados?.[n];
        n += 1;
        const id = z.id?.trim() || preset || entorno.uuid();
        usados.push(id);
        return normalizarZona({ ...z, id, pistaId: (z.pistaId ?? payload.pistaId) as string });
      });
      const resto = payload.pistaId ? directo.zonas.filter((z) => z.pistaId !== payload.pistaId) : [];
      directo.zonas = [...resto, ...nuevas];
      return {
        ...conDirecto(estado, directo, 'directo.zonas.cambiadas', { pistaId: payload.pistaId ?? null, total: directo.zonas.length }),
        result: { zonaIds: usados },
        redoPayload: { ...payload, idsGenerados: usados },
      };
    },
  };
}

// ── midi.zones.add ──────────────────────────────────────────────

export type MidiZonesAddPayload = Partial<ZonaMidi> & { pistaId: string; idsGenerados?: string[] };

export function crearComandoMidiZonesAdd(): CommandDefinition<MidiZonesAddPayload, { zonaId: string }> {
  return {
    type: 'midi.zones.add',
    historialUndo: 'instantanea',
    description: 'Añade una zona MIDI a una pista (rango de teclas, transposición, curva de velocidad)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: { ...SCHEMA_ZONA_PROPS, idsGenerados: { type: 'array', items: { type: 'string' } } },
      required: ['pistaId'],
      additionalProperties: false,
    },
    validate: (estado, payload): ValidationResult => {
      if (!pistaExiste(estado, payload.pistaId)) {
        return fallo([{ code: 'TRACK_NOT_FOUND', message: `No existe la pista ${payload.pistaId}`, field: 'pistaId' }]);
      }
      if ((estado.project.directo?.zonas.length ?? 0) >= 64) return fallo([{ code: 'TOO_MANY_ZONES', message: 'Máximo 64 zonas' }]);
      return ok();
    },
    handler: (estado: DAWState, payload: MidiZonesAddPayload): StateTransition<{ zonaId: string }> => {
      const directo = directoDe(estado);
      const id = payload.id?.trim() || payload.idsGenerados?.[0] || entorno.uuid();
      const { idsGenerados: _ids, ...datos } = payload;
      void _ids;
      directo.zonas = [...directo.zonas, normalizarZona({ ...datos, id, pistaId: payload.pistaId })];
      return {
        ...conDirecto(estado, directo, 'directo.zona.creada', { zonaId: id, pistaId: payload.pistaId }),
        result: { zonaId: id },
        redoPayload: { ...payload, idsGenerados: [id] },
      };
    },
  };
}

// ── midi.zones.remove ───────────────────────────────────────────

export type MidiZonesRemovePayload = { zonaId: string };

export function crearComandoMidiZonesRemove(): CommandDefinition<MidiZonesRemovePayload> {
  return {
    type: 'midi.zones.remove',
    historialUndo: 'instantanea',
    description: 'Quita una zona MIDI',
    risk: 'write',
    schema: {
      type: 'object',
      properties: { zonaId: { type: 'string' } },
      required: ['zonaId'],
      additionalProperties: false,
    },
    validate: (estado, payload): ValidationResult =>
      estado.project.directo?.zonas.some((z) => z.id === payload.zonaId)
        ? ok()
        : fallo([{ code: 'ZONE_NOT_FOUND', message: `No existe la zona ${payload.zonaId}`, field: 'zonaId' }]),
    handler: (estado: DAWState, payload: MidiZonesRemovePayload): StateTransition<MidiZonesRemovePayload> => {
      const directo = directoDe(estado);
      directo.zonas = directo.zonas.filter((z) => z.id !== payload.zonaId);
      return {
        ...conDirecto(estado, directo, 'directo.zona.eliminada', { zonaId: payload.zonaId }),
        result: payload,
      };
    },
  };
}

// ── midi.zones.update ───────────────────────────────────────────

export type MidiZonesUpdatePayload = { zonaId: string; cambios: Partial<Omit<ZonaMidi, 'id'>> };

export function crearComandoMidiZonesUpdate(): CommandDefinition<MidiZonesUpdatePayload> {
  return {
    type: 'midi.zones.update',
    historialUndo: 'instantanea',
    description: 'Cambia rango, transposición, curva de velocidad, canales o pista de una zona MIDI',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        zonaId: { type: 'string' },
        cambios: { type: 'object', properties: SCHEMA_ZONA_PROPS, additionalProperties: false },
      },
      required: ['zonaId', 'cambios'],
      additionalProperties: false,
    },
    validate: (estado, payload): ValidationResult => {
      const errors: ValidationError[] = [];
      if (!estado.project.directo?.zonas.some((z) => z.id === payload.zonaId)) {
        errors.push({ code: 'ZONE_NOT_FOUND', message: `No existe la zona ${payload.zonaId}`, field: 'zonaId' });
      }
      if (payload.cambios.pistaId !== undefined && !pistaExiste(estado, payload.cambios.pistaId)) {
        errors.push({ code: 'TRACK_NOT_FOUND', message: `No existe la pista ${payload.cambios.pistaId}`, field: 'cambios' });
      }
      return fallo(errors);
    },
    handler: (estado: DAWState, payload: MidiZonesUpdatePayload): StateTransition<MidiZonesUpdatePayload> => {
      const directo = directoDe(estado);
      directo.zonas = directo.zonas.map((z) => {
        if (z.id !== payload.zonaId) return z;
        const base: Partial<ZonaMidi> & { id: string; pistaId: string } = { ...z, ...payload.cambios, id: z.id, pistaId: payload.cambios.pistaId ?? z.pistaId };
        if (payload.cambios.canalEntrada === undefined && 'canalEntrada' in payload.cambios) delete base.canalEntrada;
        if (payload.cambios.canalSalida === undefined && 'canalSalida' in payload.cambios) delete base.canalSalida;
        return normalizarZona(base);
      });
      return {
        ...conDirecto(estado, directo, 'directo.zona.actualizada', { zonaId: payload.zonaId }),
        result: payload,
      };
    },
  };
}

// ── directo.setSafety ───────────────────────────────────────────

export type DirectoSetSafetyPayload = { activa?: boolean; techoDb?: number };

export function crearComandoDirectoSetSafety(): CommandDefinition<DirectoSetSafetyPayload> {
  return {
    type: 'directo.setSafety',
    historialUndo: 'instantanea',
    description: 'Limitador true-peak del máster para tocar en directo (activo y techo en dBTP, por defecto −0,5)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: { activa: { type: 'boolean' }, techoDb: { type: 'number' } },
      additionalProperties: false,
    },
    validate: (_estado, payload): ValidationResult =>
      payload.techoDb !== undefined && (!Number.isFinite(payload.techoDb) || payload.techoDb > 0 || payload.techoDb < -24)
        ? fallo([{ code: 'INVALID_CEILING', message: 'El techo debe estar entre −24 y 0 dBTP', field: 'techoDb' }])
        : ok(),
    handler: (estado: DAWState, payload: DirectoSetSafetyPayload): StateTransition<DirectoSetSafetyPayload> => {
      const directo = directoDe(estado);
      directo.seguridad = {
        activa: payload.activa ?? directo.seguridad.activa,
        techoDb: payload.techoDb ?? directo.seguridad.techoDb,
      };
      return {
        ...conDirecto(estado, directo, 'directo.seguridad.cambiada', { ...directo.seguridad }),
        result: payload,
      };
    },
  };
}

// ── directo.setLock ─────────────────────────────────────────────

export type DirectoSetLockPayload = { bloqueo: boolean };

export function crearComandoDirectoSetLock(): CommandDefinition<DirectoSetLockPayload> {
  return {
    type: 'directo.setLock',
    historialUndo: 'ninguno',
    description: 'Activa o quita el bloqueo del modo Directo (sin atajos destructivos ni edición mientras se toca)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: { bloqueo: { type: 'boolean' } },
      required: ['bloqueo'],
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload: DirectoSetLockPayload): StateTransition<DirectoSetLockPayload> => {
      const directo = directoDe(estado);
      directo.bloqueo = payload.bloqueo === true;
      return {
        ...conDirecto(estado, directo, 'directo.bloqueo.cambiado', { bloqueo: directo.bloqueo }),
        result: payload,
      };
    },
  };
}
