/**
 * JSON Schemas de las herramientas del agente (A2): comandos del registro + catálogo del agente,
 * filtrados por rol y modo (`toolsForRole`, clase de riesgo de la política fail-closed).
 */
import { A9_TOOL_SCHEMAS, AGENT_ONLY_ACTIONS, KNOWN_AGENT_ACTION_TYPES, agentActionClassOfType, buildToolSchemas, capToolSchemas, modeAllowsToolClass, registroComandos, registroHerramientasPlugins, toolsForRole } from '@jaswave/host-sdk'
import type { ToolAgentMode, ToolAgentRole, ToolJsonSchema } from '@jaswave/host-sdk'

let cache: { key: string; tools: ToolJsonSchema[] } | null = null

/** Todas las herramientas conocidas con schema (cacheado por tamaño del registro). */
export function allAgentToolSchemas(commandRegistry: { list(): Array<{ type: string; description: string; schema?: Record<string, unknown> }> } = registroComandos): ToolJsonSchema[] {
  const cmds = commandRegistry.list()
  const key = `${cmds.length}:${KNOWN_AGENT_ACTION_TYPES.length}:${A9_TOOL_SCHEMAS.length}`
  if (cache?.key === key && commandRegistry === registroComandos) return cache.tools
  const byType = new Map(cmds.map((c) => [c.type, c]))
  const meta = new Map(AGENT_ONLY_ACTIONS.map((a) => [a.type, a]))
  const a9 = new Map(A9_TOOL_SCHEMAS.map((s) => [s.name, s]))
  const types = new Set<string>([...KNOWN_AGENT_ACTION_TYPES, ...cmds.map((c) => c.type)])
  const tools = buildToolSchemas(
    [...types]
      .filter((t) => agentActionClassOfType(t) !== undefined)
      .map((t) => {
        const s = a9.get(t)
        return {
          name: t,
          description: s?.description || byType.get(t)?.description || meta.get(t)?.description || t,
          schema: s?.parameters || byType.get(t)?.schema,
          examplePayload: meta.get(t)?.examplePayload,
        }
      }),
  )
  if (commandRegistry === registroComandos) cache = { key, tools }
  return tools
}

/** Herramientas visibles para un rol en un modo (A3/A6), recortadas a `max` (≤128 en OpenAI). */
export function listAgentToolSchemas(opts: { mode: ToolAgentMode; role: ToolAgentRole; max?: number }): ToolJsonSchema[] {
  // Herramientas de plugins activos (P2): el registro filtra por rol y aquí se aplica el modo
  // con la misma regla de clases que al núcleo (en ask/think solo lecturas).
  const plugins = registroHerramientasPlugins
    .listar(opts.role)
    .filter((t) => modeAllowsToolClass(opts.mode, t.name, agentActionClassOfType(t.name)))
  const max = opts.max ?? 120
  const nucleo = capToolSchemas(
    toolsForRole(allAgentToolSchemas(), { mode: opts.mode, role: opts.role, classOf: agentActionClassOfType }),
    Math.max(0, max - plugins.length),
  )
  return [...nucleo, ...plugins.slice(0, max)]
}
