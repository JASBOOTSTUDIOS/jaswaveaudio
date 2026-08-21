/**
 * Registro de herramientas MIDI para la IA (lectura + escritura vía comandos).
 */

import type { ToolDefinitionExtended, ToolHandler, ToolRegistry } from '../ai/tool-registry';
import { getClipSummary, getNotes, musicalSummaryText } from './query';

function ok(data: unknown) {
  return { success: true as const, data, events: [] };
}
function fail(code: string, message: string) {
  return { success: false as const, error: { code, message }, events: [] };
}

const write = (type: string, description: string, required: string[]): ToolDefinitionExtended => ({
  type,
  name: type,
  version: '1.0.0',
  description,
  category: 'midi',
  risk: 'write',
  schema: {
    type: 'object',
    properties: {
      pistaId: { type: 'string' },
      clipId: { type: 'string' },
      noteIds: { type: 'array', items: { type: 'string' } },
      semitonos: { type: 'number' },
      gridBeats: { type: 'number' },
      strength: { type: 'number' },
      seed: { type: 'number' },
      velocity: { type: 'number' },
      relativeFactor: { type: 'number' },
      ratio: { type: 'number' },
      times: { type: 'number' },
      factor: { type: 'number' },
      root: { type: 'string' },
      scale: { type: 'string' },
      kind: { type: 'string' },
      bars: { type: 'number' },
      replace: { type: 'boolean' },
      notas: { type: 'array' },
    },
    required,
  },
  tags: ['midi', 'edit'],
});

export const MIDI_AI_TOOL_DEFS: ToolDefinitionExtended[] = [
  {
    type: 'midi.getClipSummary',
    name: 'midi.getClipSummary',
    version: '1.0.0',
    description: 'Resumen compacto de un clip MIDI.',
    category: 'midi',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { clipId: { type: 'string' }, trackId: { type: 'string' } },
      required: ['clipId'],
    },
    tags: ['midi', 'query'],
    idempotent: true,
  },
  {
    type: 'midi.getNotes',
    name: 'midi.getNotes',
    version: '1.0.0',
    description: 'Consulta filtrada de notas MIDI.',
    category: 'midi',
    risk: 'read',
    schema: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        trackId: { type: 'string' },
        start: { type: 'number' },
        end: { type: 'number' },
        pitchMin: { type: 'number' },
        pitchMax: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['clipId'],
    },
    tags: ['midi', 'query'],
    idempotent: true,
  },
  {
    type: 'midi.getMusicalSummary',
    name: 'midi.getMusicalSummary',
    version: '1.0.0',
    description: 'Texto compacto Tempo/Range/Density para contexto IA.',
    category: 'midi',
    risk: 'read',
    schema: {
      type: 'object',
      properties: { clipId: { type: 'string' }, trackId: { type: 'string' } },
      required: ['clipId'],
    },
    tags: ['midi', 'query'],
    idempotent: true,
  },
  write('midi.transpose', 'Transpone semitonos', ['pistaId', 'clipId', 'semitonos']),
  write('midi.quantize', 'Cuantiza con strength 0..1', ['pistaId', 'clipId', 'gridBeats']),
  write('midi.humanize', 'Humaniza con seed reproducible', ['pistaId', 'clipId', 'seed']),
  write('midi.setVelocity', 'Velocity absoluta o relativeFactor', ['pistaId', 'clipId']),
  write('midi.deleteNotes', 'Borra notas por noteIds', ['pistaId', 'clipId', 'noteIds']),
  write('midi.createNotes', 'Anade notas al clip', ['pistaId', 'clipId', 'notas']),
  write('midi.makeStaccato', 'Staccato (ratio)', ['pistaId', 'clipId']),
  write('midi.makeLegato', 'Legato entre pitches', ['pistaId', 'clipId']),
  write('midi.repeatPattern', 'Repite seleccion', ['pistaId', 'clipId', 'noteIds']),
  write('midi.reverse', 'Invierte en el tiempo', ['pistaId', 'clipId']),
  write('midi.invert', 'Invierte pitches', ['pistaId', 'clipId']),
  write('midi.timeStretch', 'Estira tiempo (factor)', ['pistaId', 'clipId', 'factor']),
  write('midi.constrainScale', 'Snap a escala (root, scale)', ['pistaId', 'clipId', 'root', 'scale']),
  write('midi.generatePattern', 'Genera bass_funk|arp|drums|pad_chords', ['pistaId', 'kind']),
  write('midi.applyGroove', 'Aplica groove template', ['pistaId', 'clipId', 'grooveId']),
  write('midi.setCC', 'Define puntos CC', ['pistaId', 'clipId', 'cc', 'puntos']),
  write('midi.setPitchBend', 'Define pitch bend (-1..1)', ['pistaId', 'clipId', 'puntos']),
];

type GetState = () => import('../types/state').DAWState;

export function registrarMidiAiTools(registry: ToolRegistry, getState: GetState): void {
  const viaCommand =
    (type: string): ToolHandler =>
    async (params, ctx) => {
      try {
        return ok(await ctx.commandExecutor.execute(type, params as never));
      } catch (e) {
        return fail('COMMAND_FAILED', e instanceof Error ? e.message : String(e));
      }
    };

  const handlers: Record<string, ToolHandler> = {
    'midi.getClipSummary': async (params) => {
      const p = params as { clipId: string; trackId?: string };
      const data = getClipSummary(getState(), p.clipId, p.trackId);
      return data ? ok(data) : fail('NOT_FOUND', `Clip ${p.clipId}`);
    },
    'midi.getNotes': async (params) => ok(getNotes(getState(), params as never)),
    'midi.getMusicalSummary': async (params) => {
      const p = params as { clipId: string; trackId?: string };
      return ok({ text: musicalSummaryText(getState(), p.clipId, p.trackId) });
    },
    'midi.transpose': viaCommand('midi.transpose'),
    'midi.quantize': viaCommand('midi.quantize'),
    'midi.humanize': viaCommand('midi.humanize'),
    'midi.setVelocity': viaCommand('midi.setVelocity'),
    'midi.deleteNotes': viaCommand('midi.deleteNotes'),
    'midi.createNotes': viaCommand('midi.createNotes'),
    'midi.makeStaccato': viaCommand('midi.makeStaccato'),
    'midi.makeLegato': viaCommand('midi.makeLegato'),
    'midi.repeatPattern': viaCommand('midi.repeatPattern'),
    'midi.reverse': viaCommand('midi.reverse'),
    'midi.invert': viaCommand('midi.invert'),
    'midi.timeStretch': viaCommand('midi.timeStretch'),
    'midi.constrainScale': viaCommand('midi.constrainScale'),
    'midi.generatePattern': viaCommand('midi.generatePattern'),
    'midi.applyGroove': viaCommand('midi.applyGroove'),
    'midi.setCC': viaCommand('midi.setCC'),
    'midi.setPitchBend': viaCommand('midi.setPitchBend'),
  };

  for (const def of MIDI_AI_TOOL_DEFS) {
    const handler = handlers[def.name];
    if (handler) {
      try {
        registry.register(def, handler);
      } catch {
        /* HMR duplicate */
      }
    }
  }
}
