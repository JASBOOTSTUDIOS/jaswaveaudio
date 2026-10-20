import { describe, it, expect } from 'vitest'
import {
  buildToolSchemas,
  jsonSchemaFromExample,
  normalizeToolParameters,
  toolsForRole,
  type ToolRiskClass,
} from '../ai/tool-schemas'
import { crearRegistroComandos } from '../state/registro-comandos'
import { registrarComandosBuiltin } from '../state/comandos-builtin'

const CLASSES: Record<string, ToolRiskClass> = {
  'track.list': 'read',
  'track.create': 'write',
  'track.delete': 'destructive',
  'plan.updateStep': 'write',
  'plugin.setParameter': 'write',
  'master.update': 'write',
}

describe('tool-schemas', () => {
  it('usa el schema del comando y, si falta, infiere del ejemplo', () => {
    const tools = buildToolSchemas([
      { name: 'track.create', description: 'Crea', schema: { type: 'object', properties: { nombre: { type: 'string' } }, required: ['nombre'] } },
      { name: 'daw.musicBuild', description: 'Orquesta', examplePayload: { aplicar: true, bpm: 120, prompt: 'x', tags: ['a'] } },
      { name: 'track.create', description: 'duplicado', examplePayload: { x: 1 } },
    ])
    expect(tools.map((t) => t.name)).toEqual(['daw.musicBuild', 'track.create'])
    expect(tools[1]!.parameters.required).toEqual(['nombre'])
    expect(tools[0]!.parameters).toEqual({
      type: 'object',
      properties: { aplicar: { type: 'boolean' }, bpm: { type: 'number' }, prompt: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      additionalProperties: true,
    })
  })

  it('normaliza raíces no-objeto', () => {
    expect(normalizeToolParameters(undefined)).toEqual({ type: 'object', properties: {} })
    expect(normalizeToolParameters({ type: 'object' })).toEqual({ type: 'object', properties: {} })
    expect(jsonSchemaFromExample(undefined)).toEqual({ type: 'object', properties: {}, additionalProperties: true })
  })

  it('toolsForRole filtra por modo y rol (fail closed)', () => {
    const tools = buildToolSchemas(Object.keys(CLASSES).concat('sin.clase').map((name) => ({ name })))
    const classOf = (n: string) => CLASSES[n]
    const names = (role: Parameters<typeof toolsForRole>[1]['role'], mode: Parameters<typeof toolsForRole>[1]['mode']) =>
      toolsForRole(tools, { role, mode, classOf }).map((t) => t.name)
    expect(names('coproductor', 'ask')).toEqual(['track.list'])
    expect(names('coproductor', 'plan')).toEqual(['plan.updateStep', 'track.list'])
    expect(names('coproductor', 'create')).not.toContain('sin.clase')
    expect(names('qa', 'create')).toEqual(['track.list'])
    expect(names('mezcla', 'auto')).toEqual(['master.update', 'plugin.setParameter', 'track.list'])
    expect(names('director', 'create')).toEqual(['plan.updateStep', 'track.list'])
  })

  it('los comandos registrados producen schemas válidos de nivel raíz objeto', () => {
    const reg = crearRegistroComandos()
    registrarComandosBuiltin(reg)
    const tools = buildToolSchemas(reg.list().map((c) => ({ name: c.type, description: c.description, schema: c.schema })))
    expect(tools.length).toBeGreaterThan(20)
    for (const t of tools) {
      expect(t.parameters.type).toBe('object')
      expect(typeof t.parameters.properties).toBe('object')
      expect(t.description.length).toBeGreaterThan(0)
    }
  })
})
