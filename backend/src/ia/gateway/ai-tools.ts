/**
 * Copia del gateway de IA de JasWave Desktop (jas-wave/electron/ai-tools.ts).
 * El backend es independiente: no importa código de jas-wave; si se corrige allí, replicar aquí.
 */
/**
 * Tool-calling nativo por proveedor (A2): serialización de mensajes/tools y parsing de respuestas.
 * Módulo puro (sin red) para poder probarlo con snapshots.
 *
 * Nombres: el motor usa nombres canónicos con puntos (`track.create`); los proveedores no los
 * aceptan (OpenAI exige ^[a-zA-Z0-9_-]{1,64}$), así que se codifican `.` → `__`.
 */

export type AiToolSchema = { name: string; description: string; parameters: Record<string, unknown> }
export type AiToolChoice = 'auto' | 'none' | 'required'
export type AiToolCall = { id: string; name: string; arguments: Record<string, unknown> }

export type AiWireMessage = {
  role: string
  content: string
  /** Solo assistant: llamadas emitidas por el modelo. */
  toolCalls?: AiToolCall[]
  /** Solo role 'tool': id de la llamada respondida. */
  toolCallId?: string
  /** Solo role 'tool': nombre canónico de la herramienta. */
  name?: string
}

export type AiToolRequestPart = {
  model: string
  messages: AiWireMessage[]
  tools?: AiToolSchema[]
  toolChoice?: AiToolChoice
  temperature?: number
  maxTokens?: number
  /** Marca el prefijo estable (herramientas + sistema + primer mensaje) como cacheable (`cache_control`), si el proveedor lo admite. */
  cache?: boolean
}

export type ParsedToolResponse = { content: string; toolCalls: AiToolCall[] }

export function encodeToolName(name: string): string {
  const enc = String(name).replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_')
  return enc.slice(0, 64)
}

export function decodeToolName(name: string): string {
  return String(name).replace(/__/g, '.')
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v }
    } catch {
      return { __raw: raw }
    }
  }
  return {}
}

/** Modelos/proveedores con tool-calling nativo conocido. El resto usa marcadores. */
export function providerSupportsTools(opts: {
  kind: string
  apiStyle?: string
  model: string
  supportsTools?: boolean
}): boolean {
  if (typeof opts.supportsTools === 'boolean') return opts.supportsTools
  const style = opts.apiStyle
  if (opts.kind === 'mock') return true
  if (style === 'anthropic' || opts.kind === 'anthropic') return true
  if (style === 'gemini' || opts.kind === 'gemini') return true
  if (style === 'ollama' || opts.kind === 'ollama') {
    // Ollama: solo familias con plantilla de tools.
    return /(llama3\.[1-9]|llama-?3\.[1-9]|qwen2\.5|qwen3|mistral-nemo|mistral-small|command-r|firefunction|hermes3|granite3)/i.test(opts.model)
  }
  if (opts.kind === 'openai' || opts.kind === 'openrouter' || opts.kind === 'kilocode') return true
  // openai-compatible genérico (LM Studio, vLLM…): no asumir.
  return false
}

/** ¿Error HTTP causado por mandar tools a un modelo que no las soporta? */
export function isToolsUnsupportedError(status: number, body: string): boolean {
  if (status < 400 || status >= 500 || status === 401 || status === 403 || status === 429) return false
  return /(does not support tools|tool[_ ]?(use|calls?|choice)?.{0,40}(not|un)\s*(supported|available)|function[_ ]?calling.{0,40}(not|un)\s*(supported|available)|unsupported.{0,20}(tools?|functions?)|unrecognized.{0,20}(tools|tool_choice)|invalid.{0,20}tools)/i.test(
    body,
  )
}

// ── OpenAI-compatible (OpenAI, OpenRouter, Kilo, compat) ─────────────────────

export function buildOpenAiBody(req: AiToolRequestPart, stream = false): Record<string, unknown> {
  const messages = req.messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: encodeToolName(c.name), arguments: JSON.stringify(c.arguments ?? {}) },
        })),
      }
    }
    return { role: m.role, content: m.content }
  })
  // Anthropic vía OpenRouter: sin marca no hay caché de prompt. Se marcan el sistema y el primer mensaje del usuario
  // (estables durante todo el turno de un agente); en Anthropic la caché cubre también las herramientas, que van antes.
  if (req.cache) {
    const marcar = (i: number) => {
      const m = messages[i] as { content?: unknown } | undefined
      if (m && typeof m.content === 'string' && m.content) m.content = [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
    }
    const si = messages.findIndex((m) => (m as { role?: string }).role === 'system')
    if (si >= 0) marcar(si)
    const ui = messages.findIndex((m) => (m as { role?: string }).role === 'user')
    if (ui >= 0) marcar(ui)
  }
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    temperature: req.temperature ?? 0.4,
    max_tokens: req.maxTokens ?? 2048,
    stream,
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: encodeToolName(t.name), description: t.description, parameters: t.parameters },
    }))
    body.tool_choice = req.toolChoice ?? 'auto'
  }
  return body
}

export function parseOpenAiMessage(message: unknown): ParsedToolResponse {
  const m = (message ?? {}) as {
    content?: string | Array<{ type?: string; text?: string }> | null
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>
  }
  let content = ''
  if (typeof m.content === 'string') content = m.content
  else if (Array.isArray(m.content)) content = m.content.map((p) => p.text ?? '').join('')
  const toolCalls = (m.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: c.id || `call_${i}`,
      name: decodeToolName(c.function!.name!),
      arguments: parseArgs(c.function!.arguments),
    }))
  return { content, toolCalls }
}

// ── Anthropic ────────────────────────────────────────────────────────────────

type AnthropicBlock = Record<string, unknown>

export function buildAnthropicBody(req: AiToolRequestPart, stream = false): Record<string, unknown> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content)
  const out: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> = []
  for (const m of req.messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      const block: AnthropicBlock = { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }
      const prev = out[out.length - 1]
      if (prev && prev.role === 'user' && Array.isArray(prev.content) && prev.content.every((b) => b.type === 'tool_result')) {
        prev.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: AnthropicBlock[] = []
      if (m.content?.trim()) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: encodeToolName(c.name), input: c.arguments ?? {} })
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    if (m.role === 'user' || m.role === 'assistant') out.push({ role: m.role, content: m.content })
  }
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.4,
    system: system.length ? (req.cache ? [{ type: 'text', text: system.join('\n\n'), cache_control: { type: 'ephemeral' } }] : system.join('\n\n')) : undefined,
    messages: out,
  }
  if (stream) body.stream = true
  if (req.tools?.length) {
    body.tools = req.tools.map((t, i, todas) => ({ name: encodeToolName(t.name), description: t.description, input_schema: t.parameters, ...(req.cache && i === todas.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }))
    const choice = req.toolChoice ?? 'auto'
    body.tool_choice = { type: choice === 'required' ? 'any' : choice }
  }
  return body
}

export function parseAnthropicContent(content: unknown): ParsedToolResponse {
  const blocks = Array.isArray(content) ? (content as Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>) : []
  const text = blocks
    .filter((b) => b.type === 'text' || (!b.type && b.text))
    .map((b) => b.text ?? '')
    .join('')
  const toolCalls = blocks
    .filter((b) => b.type === 'tool_use' && b.name)
    .map((b, i) => ({ id: b.id || `toolu_${i}`, name: decodeToolName(b.name!), arguments: parseArgs(b.input) }))
  return { content: text, toolCalls }
}

// ── Gemini ───────────────────────────────────────────────────────────────────

const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'properties',
  'required',
  'items',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
])

/** Gemini acepta un subconjunto de OpenAPI: quita additionalProperties, $schema, default… */
export function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_KEYS.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, sanitizeSchemaForGemini(pv)]))
    } else if (k === 'type' && Array.isArray(v)) {
      out.type = v.find((t) => t !== 'null') ?? 'string'
    } else {
      out[k] = sanitizeSchemaForGemini(v)
    }
  }
  if (out.type === 'object' && out.properties && Object.keys(out.properties as object).length === 0) delete out.properties
  return out
}

export function buildGeminiBody(req: AiToolRequestPart): Record<string, unknown> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = []
  for (const m of req.messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      const part = { functionResponse: { name: encodeToolName(m.name ?? 'tool'), response: { content: m.content } } }
      const prev = contents[contents.length - 1]
      if (prev && prev.role === 'user' && prev.parts.every((p) => 'functionResponse' in p)) prev.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
      continue
    }
    if (m.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = []
      if (m.content?.trim()) parts.push({ text: m.content })
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: encodeToolName(c.name), args: c.arguments ?? {} } })
      if (!parts.length) parts.push({ text: '' })
      contents.push({ role: 'model', parts })
      continue
    }
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content }] })
  }
  const body: Record<string, unknown> = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents,
    generationConfig: { temperature: req.temperature ?? 0.4, maxOutputTokens: req.maxTokens ?? 2048 },
  }
  if (req.tools?.length) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: encodeToolName(t.name),
          description: t.description,
          parameters: sanitizeSchemaForGemini(t.parameters),
        })),
      },
    ]
    const choice = req.toolChoice ?? 'auto'
    body.toolConfig = { functionCallingConfig: { mode: choice === 'required' ? 'ANY' : choice === 'none' ? 'NONE' : 'AUTO' } }
  }
  return body
}

export function parseGeminiParts(parts: unknown): ParsedToolResponse {
  const list = Array.isArray(parts) ? (parts as Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }>) : []
  const content = list.map((p) => p.text ?? '').join('')
  const toolCalls = list
    .filter((p) => p.functionCall?.name)
    .map((p, i) => ({ id: `gemini_${i}`, name: decodeToolName(p.functionCall!.name!), arguments: parseArgs(p.functionCall!.args) }))
  return { content, toolCalls }
}

// ── Ollama ───────────────────────────────────────────────────────────────────

export function buildOllamaBody(req: AiToolRequestPart, stream = false): Record<string, unknown> {
  const messages = req.messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: encodeToolName(m.name ?? 'tool') }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ function: { name: encodeToolName(c.name), arguments: c.arguments ?? {} } })),
      }
    }
    return { role: m.role, content: m.content }
  })
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream,
    options: typeof req.temperature === 'number' ? { temperature: req.temperature } : undefined,
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: encodeToolName(t.name), description: t.description, parameters: t.parameters },
    }))
  }
  return body
}

export function parseOllamaMessage(message: unknown): ParsedToolResponse {
  const m = (message ?? {}) as { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> }
  const toolCalls = (m.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({ id: `ollama_${i}`, name: decodeToolName(c.function!.name!), arguments: parseArgs(c.function!.arguments) }))
  return { content: String(m.content ?? ''), toolCalls }
}
