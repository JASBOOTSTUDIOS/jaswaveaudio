/**
 * JSON Schemas de herramientas para tool-calling nativo (A2).
 *
 * Fuentes: `schema` de cada comando del registro (ya es JSON Schema) y, para orquestaciones
 * solo-cliente (catálogo del agente), el `examplePayload` del que se infieren tipos.
 * `toolsForRole` filtra por rol de agente (A6) y por modo (A3) usando una clasificación de
 * riesgo inyectada (la política vive en ai-harness, que depende de shared).
 */

export type ToolJsonSchema = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ToolSchemaSource = {
  name: string
  description?: string
  /** JSON Schema del comando (CommandDefinition.schema). */
  schema?: Record<string, unknown>
  /** Payload de ejemplo del catálogo (si no hay schema). */
  examplePayload?: Record<string, unknown>
}

export type ToolRiskClass = 'read' | 'write' | 'destructive' | 'system'
export type ToolAgentRole = 'coproductor' | 'director' | 'productor' | 'mezcla' | 'mastering' | 'qa'
export type ToolAgentMode = 'auto' | 'ask' | 'plan' | 'create' | 'think'

const MAX_DESCRIPTION = 400

function inferType(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) return { type: 'array', items: v.length ? inferType(v[0]) : {} }
  if (v === null) return {}
  switch (typeof v) {
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'string':
      return { type: 'string' }
    case 'object':
      return { type: 'object' }
    default:
      return {}
  }
}

/** Esquema permisivo inferido de un payload de ejemplo (sin `required`). */
export function jsonSchemaFromExample(example: Record<string, unknown> | undefined): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(example ?? {})) properties[k] = inferType(v)
  return { type: 'object', properties, additionalProperties: true }
}

/** Garantiza `type: object` + `properties` (los proveedores lo exigen en el nivel raíz). */
export function normalizeToolParameters(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const out: Record<string, unknown> = { ...schema }
  if (out.type !== 'object') return { type: 'object', properties: { value: schema } }
  if (!out.properties || typeof out.properties !== 'object') out.properties = {}
  return out
}

export function buildToolSchema(src: ToolSchemaSource): ToolJsonSchema {
  const parameters = src.schema ? normalizeToolParameters(src.schema) : jsonSchemaFromExample(src.examplePayload)
  const description = (src.description?.trim() || src.name).slice(0, MAX_DESCRIPTION)
  return { name: src.name, description, parameters }
}

/** Construye schemas sin duplicados; el primer `schema` explícito gana sobre el inferido. */
export function buildToolSchemas(sources: ToolSchemaSource[]): ToolJsonSchema[] {
  const byName = new Map<string, ToolSchemaSource>()
  for (const s of sources) {
    if (!s.name) continue
    const prev = byName.get(s.name)
    if (!prev) byName.set(s.name, s)
    else
      byName.set(s.name, {
        name: s.name,
        description: prev.description || s.description,
        schema: prev.schema ?? s.schema,
        examplePayload: prev.examplePayload ?? s.examplePayload,
      })
  }
  return [...byName.values()].map(buildToolSchema).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Prefijos de escritura por rol (A6). Las lecturas (`read`) están disponibles para todos los roles.
 * `*` = sin restricción de rol (agente único actual).
 */
export const ROLE_WRITE_PREFIXES: Readonly<Record<ToolAgentRole, readonly string[] | '*'>> = Object.freeze({
  coproductor: '*',
  director: ['plan.', 'doc.'],
  productor: ['track.', 'clip.', 'midi.', 'plugin.insert', 'plugin.replace', 'style.', 'daw.musicBuild', 'daw.composeProject', 'daw.generateMidiSong', 'project.setBpm', 'project.setTimeSignature', 'doc.'],
  mezcla: ['plugin.', 'fxChain.', 'send.', 'bus.', 'sidechain.', 'automation.', 'track.update', 'clip.gain', 'master.update', 'doc.'],
  mastering: ['master.', 'plugin.', 'fxChain.', 'daw.masterPass', 'reference.', 'doc.'],
  qa: [],
})

export function roleAllowsTool(role: ToolAgentRole, name: string, cls: ToolRiskClass | undefined): boolean {
  if (cls === undefined) return false
  if (cls === 'read') return true
  const prefixes = ROLE_WRITE_PREFIXES[role] ?? []
  if (prefixes === '*') return true
  return prefixes.some((p) => (p.endsWith('.') ? name.startsWith(p) : name === p))
}

export function modeAllowsToolClass(mode: ToolAgentMode, name: string, cls: ToolRiskClass | undefined): boolean {
  if (cls === undefined) return false
  if (cls === 'read') return true
  if (mode === 'ask' || mode === 'think') return false
  if (mode === 'plan') return cls === 'write' && name.startsWith('plan.')
  return true
}

/** Herramientas visibles para un rol en un modo (fail closed: sin clase → fuera). */
export function toolsForRole(
  tools: ToolJsonSchema[],
  opts: { role: ToolAgentRole; mode: ToolAgentMode; classOf: (name: string) => ToolRiskClass | undefined },
): ToolJsonSchema[] {
  return tools.filter((t) => {
    const cls = opts.classOf(t.name)
    return roleAllowsTool(opts.role, t.name, cls) && modeAllowsToolClass(opts.mode, t.name, cls)
  })
}
