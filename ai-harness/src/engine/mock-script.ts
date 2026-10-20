/**
 * Intérprete de guiones del proveedor `mock` (A2): respuestas deterministas por turno para
 * tests, e2e y CLI sin LLM. El gateway de Electron (`electron/ai-mock.ts`) implementa la misma
 * semántica (test de paridad en jas-wave).
 *
 * Formato:
 * {
 *   "name": "turno ask",
 *   "responses": [
 *     { "when": { "purpose": "agent", "lastUserIncludes": "tempo" },
 *       "content": "texto", "toolCalls": [{ "name": "track.list", "arguments": {} }] },
 *     { "toolsUnsupported": true },              // simula proveedor sin tools nativas
 *     { "error": "caído", "errorCode": "service_unavailable" }
 *   ],
 *   "fallback": { "content": "Hecho." }
 * }
 * Cada respuesta se consume una vez (salvo `"repeat": true`) en orden; la primera cuyo `when`
 * encaja gana. Sin coincidencia → `fallback`; sin fallback → error `empty_response`.
 */

export type MockToolCall = { id?: string; name: string; arguments?: Record<string, unknown> }

export type MockWhen = {
  purpose?: string
  role?: string
  lastUserIncludes?: string
  systemIncludes?: string
  anyIncludes?: string
  hasTools?: boolean
  /** Solo si el último mensaje es un resultado de herramienta. */
  afterToolResult?: boolean
}

export type MockResponse = {
  when?: MockWhen
  content?: string
  toolCalls?: MockToolCall[]
  toolsUnsupported?: boolean
  error?: string
  errorCode?: string
  repeat?: boolean
}

export type MockScript = {
  name?: string
  responses: MockResponse[]
  fallback?: MockResponse
}

export type MockRequestView = {
  messages: Array<{ role: string; content?: string }>
  hasTools: boolean
  purpose?: string
  role?: string
}

export type MockReply = {
  success: boolean
  content?: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolsUnsupported?: boolean
  error?: string
  errorCode?: string
}

export function parseMockScript(raw: unknown): MockScript {
  const o = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<MockScript> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.responses)) {
    throw new Error('Guion mock inválido: falta "responses" (array)')
  }
  return { name: o.name, responses: o.responses, fallback: o.fallback }
}

function includesCI(hay: string | undefined, needle: string): boolean {
  return String(hay ?? '').toLowerCase().includes(needle.toLowerCase())
}

export function mockWhenMatches(when: MockWhen | undefined, req: MockRequestView): boolean {
  if (!when) return true
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content ?? '').join('\n')
  const last = req.messages[req.messages.length - 1]
  if (when.purpose && when.purpose !== req.purpose) return false
  if (when.role && when.role !== req.role) return false
  if (when.hasTools !== undefined && when.hasTools !== req.hasTools) return false
  if (when.lastUserIncludes && !includesCI(lastUser, when.lastUserIncludes)) return false
  if (when.systemIncludes && !includesCI(system, when.systemIncludes)) return false
  if (when.anyIncludes && !req.messages.some((m) => includesCI(m.content, when.anyIncludes!))) return false
  if (when.afterToolResult !== undefined) {
    const isTool = last?.role === 'tool' || String(last?.content ?? '').startsWith('Resultados de herramientas:')
    if (isTool !== when.afterToolResult) return false
  }
  return true
}

function toReply(r: MockResponse, n: number): MockReply {
  if (r.toolsUnsupported) return { success: false, toolsUnsupported: true, error: 'tools no soportadas (mock)', errorCode: 'bad_request' }
  if (r.error) return { success: false, error: r.error, errorCode: r.errorCode ?? 'provider_error' }
  return {
    success: true,
    content: r.content ?? '',
    toolCalls: r.toolCalls?.map((c, i) => ({ id: c.id ?? `mock_${n}_${i}`, name: c.name, arguments: c.arguments ?? {} })),
  }
}

/** Reproductor con estado (qué respuestas ya se consumieron). */
export function createMockPlayer(script: MockScript) {
  const used = new Set<number>()
  let calls = 0
  return {
    get calls() {
      return calls
    },
    next(req: MockRequestView): MockReply {
      calls += 1
      for (const [i, r] of script.responses.entries()) {
        if (used.has(i)) continue
        if (r.toolsUnsupported && !req.hasTools) continue
        if (!mockWhenMatches(r.when, req)) continue
        if (!r.repeat) used.add(i)
        return toReply(r, calls)
      }
      if (script.fallback) return toReply(script.fallback, calls)
      return { success: false, error: 'Guion mock agotado', errorCode: 'empty_response' }
    },
  }
}
