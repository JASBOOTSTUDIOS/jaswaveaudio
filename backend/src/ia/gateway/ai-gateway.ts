/**
 * Copia del gateway de IA de JasWave Desktop (jas-wave/electron/ai-gateway.ts).
 * El backend es independiente: no importa código de jas-wave; si se corrige allí, replicar aquí.
 */
/**
 * Gateway multi-proveedor de IA para el proceso principal de Electron.
 * OpenAI / Anthropic / Gemini / Ollama / OpenRouter / KiloCode / OpenAI-compatible / mock.
 *
 * A2: tool-calling nativo (serialización en ai-tools.ts), streaming (ai-stream.ts) y
 * proveedor mock determinista (ai-mock.ts, JASWAVE_AI_MOCK=<guion.json>).
 */

import {
  buildAnthropicBody,
  buildGeminiBody,
  buildOllamaBody,
  buildOpenAiBody,
  isToolsUnsupportedError,
  parseAnthropicContent,
  parseGeminiParts,
  parseOllamaMessage,
  parseOpenAiMessage,
  providerSupportsTools,
  type AiToolCall,
  type AiToolChoice,
  type AiToolSchema,
  type AiWireMessage,
} from './ai-tools.js'
import { createStreamAccumulator, type StreamStyle } from './ai-stream.js'
import { createMockPlayer, envMockPlayer, mockScriptPathFromEnv } from './ai-mock.js'
import { fetchActual } from '../../seguridad/red-restringida.js'

export type AiProviderKind =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'kilocode'
  | 'openai-compatible'
  | 'mock'

export type AiApiStyle = 'openai' | 'anthropic' | 'gemini' | 'ollama'
export type AiAuthStyle = 'bearer' | 'x-api-key' | 'none'

export type AiProviderCustom = {
  apiStyle?: AiApiStyle
  chatPath?: string
  modelsPath?: string
  appendV1?: boolean
  authStyle?: AiAuthStyle
  extraHeaders?: Record<string, string>
  needsApiKey?: boolean
  /** Fuerza (o desactiva) el tool-calling nativo para este perfil. */
  supportsTools?: boolean
}

export type AiErrorCode =
  | 'missing_api_key'
  | 'missing_model'
  | 'missing_base_url'
  | 'connection'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limit'
  | 'service_unavailable'
  | 'model_not_found'
  | 'bad_request'
  | 'payment_required'
  | 'provider_error'
  | 'empty_response'
  | 'not_available'
  | 'cancelled'
  | 'unknown'

export type ChatMessage = AiWireMessage

export type AiChatRequest = {
  messages: ChatMessage[]
  kind: AiProviderKind
  model: string
  baseUrl: string
  apiKey?: string
  /** Perfil cuyo API key guarda main (ai-credentials); el renderer no la envía. */
  providerId?: string
  /** Id para cancelar con cancelAiChat (botón Detener). */
  requestId?: string
  temperature?: number
  maxTokens?: number
  custom?: AiProviderCustom
  /** Herramientas con JSON Schema (nombres canónicos con puntos). */
  tools?: AiToolSchema[]
  toolChoice?: AiToolChoice
  /** Metadatos del motor (propósito/rol): los usa el mock; los proveedores reales los ignoran. */
  meta?: { purpose?: string; role?: string; runId?: string }
  /** Campos extra del cuerpo OpenAI-compatible (p. ej. `reasoning`); los pone el servidor, nunca el cliente. */
  extra?: Record<string, unknown>
}

export type AiHealthRequest = {
  kind: AiProviderKind
  baseUrl: string
  apiKey?: string
  providerId?: string
  custom?: AiProviderCustom
}

export type AiChatResult = {
  success: boolean
  content?: string
  model?: string
  provider?: string
  error?: string
  errorCode?: AiErrorCode
  hint?: string
  /** Llamadas a herramientas normalizadas (nombres canónicos). */
  toolCalls?: AiToolCall[]
  /** El modelo no soporta tools nativas o las rechazó: el cliente debe usar marcadores. */
  toolsUnsupported?: boolean
  /** Intentos HTTP realizados (incluye reintentos) — para el presupuesto del turno. */
  httpAttempts?: number
  /** Tokens que informó el proveedor (si los informó). */
  usage?: AiUsage
}

export type AiUsage = { entrada: number; salida: number }

/** Lee el consumo de tokens del cuerpo de respuesta de cualquier estilo de API. */
export function usageFrom(data: Record<string, any> | undefined | null): AiUsage | undefined {
  if (!data || typeof data !== 'object') return undefined
  const u = data.usage ?? data.usageMetadata
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (u && typeof u === 'object') {
    const entrada = n(u.prompt_tokens) || n(u.input_tokens) || n(u.promptTokenCount)
    const salida = n(u.completion_tokens) || n(u.output_tokens) || n(u.candidatesTokenCount)
    if (entrada || salida) return { entrada, salida }
  }
  if (typeof data.prompt_eval_count === 'number' || typeof data.eval_count === 'number') {
    return { entrada: n(data.prompt_eval_count), salida: n(data.eval_count) }
  }
  return undefined
}

export type AiHealthResult = {
  status: 'healthy' | 'disconnected' | 'misconfigured'
  models: string[]
  baseUrl?: string
  provider?: string
  error?: string
  errorCode?: AiErrorCode
  hint?: string
}

const DEFAULT_TIMEOUT_MS = 90_000
/** Reintentos ante 429/503 u otros fallos transitorios del gateway. */
const MAX_CHAT_RETRIES = 4
const RETRY_BASE_MS = 1500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Cola global: evita ráfagas concurrentes que saturan gateways (p.ej. Kilo Code). */
let chatQueue: Promise<void> = Promise.resolve()
let lastChatFinishedAt = 0

function minGapBetweenChatsMs(kind: AiProviderKind): number {
  if (kind === 'ollama') return 0
  if (kind === 'kilocode') return 2000
  return 1000
}

function isRetriableErrorCode(code: AiErrorCode | undefined): boolean {
  return (
    code === 'rate_limit' ||
    code === 'service_unavailable' ||
    code === 'timeout' ||
    code === 'connection'
  )
}

function extractProviderMessage(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{')) return body.replace(/\s+/g, ' ').slice(0, 280)
  try {
    const data = JSON.parse(trimmed) as {
      error?: { message?: string; type?: string }
      message?: string
    }
    const msg = data.error?.message ?? data.message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  } catch {
    /* ignore */
  }
  return body.replace(/\s+/g, ' ').slice(0, 280)
}

function hintFor(code: AiErrorCode, kind?: AiProviderKind): string {
  switch (code) {
    case 'missing_api_key':
      return 'Añade la API key en Configuración → IA.'
    case 'missing_model':
      return 'Elige o escribe un nombre de modelo válido.'
    case 'missing_base_url':
      return 'Indica la URL base del proveedor.'
    case 'connection':
      return kind === 'ollama'
        ? 'Comprueba que Ollama esté en marcha (ollama serve).'
        : 'Comprueba internet, la URL y el firewall.'
    case 'timeout':
      return 'El proveedor tardó demasiado. Reintenta o baja max tokens.'
    case 'unauthorized':
      return 'API key inválida o caducada. Regenera la clave en el panel del proveedor.'
    case 'forbidden':
      return 'Tu cuenta no tiene permiso para este modelo o región.'
    case 'rate_limit':
      return 'Límite de peticiones alcanzado. JasWave reintenta automáticamente; si persiste, espera 30 s.'
    case 'service_unavailable':
      return kind === 'kilocode'
        ? 'El gateway Kilo Code limita peticiones seguidas (JasWave hace varias por mensaje). Reintenta en unos segundos o espera entre mensajes.'
        : 'El proveedor está temporalmente saturado. Espera unos segundos e inténtalo de nuevo.'
    case 'model_not_found':
      return 'El modelo no existe o no está disponible. Verifica el nombre exacto.'
    case 'bad_request':
      return 'Revisa el nombre del modelo, la URL y los parámetros.'
    case 'payment_required':
      return 'Sin crédito en este modelo. Activa Auto (fallback) o elige un modelo gratuito en el selector.'
    case 'empty_response':
      return 'El proveedor respondió vacío. Prueba otro modelo.'
    default:
      return 'Revisa Configuración → IA y vuelve a probar la conexión.'
  }
}

function fail(
  error: string,
  errorCode: AiErrorCode,
  kind: AiProviderKind,
  extra?: Partial<AiChatResult>,
): AiChatResult {
  return {
    success: false,
    error,
    errorCode,
    hint: hintFor(errorCode, kind),
    provider: kind,
    ...extra,
  }
}

function healthFail(
  error: string,
  errorCode: AiErrorCode,
  kind: AiProviderKind,
  status: AiHealthResult['status'] = 'disconnected',
): AiHealthResult {
  return {
    status,
    models: [],
    error,
    errorCode,
    hint: hintFor(errorCode, kind),
    provider: kind,
  }
}

function normalizeBase(url: string): string {
  return String(url || '').trim().replace(/\/$/, '')
}

function needsKey(kind: AiProviderKind, custom?: AiProviderCustom): boolean {
  if (custom?.needsApiKey != null) return custom.needsApiKey
  return kind !== 'ollama' && kind !== 'openai-compatible'
}

function joinUrl(base: string, path: string): string {
  const b = normalizeBase(base)
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

/** Cabeceras que un perfil personalizado no puede sobrescribir. */
const FORBIDDEN_EXTRA_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie'])

/** Solo http(s); nada de file:, data:, etc. */
export function isAllowedProviderUrl(raw: string | undefined): boolean {
  try {
    const u = new URL(String(raw || '').trim())
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
  } catch {
    return false
  }
}

function applyAuthHeaders(
  headers: Record<string, string>,
  apiKey: string | undefined,
  kind: AiProviderKind,
  custom?: AiProviderCustom,
): void {
  const style = custom?.authStyle ?? (apiKey?.trim() ? 'bearer' : 'none')
  const key = apiKey?.trim()
  if (style === 'bearer' && key) headers.Authorization = `Bearer ${key}`
  if (style === 'x-api-key' && key) headers['x-api-key'] = key
  if (custom?.extraHeaders) {
    for (const [k, v] of Object.entries(custom.extraHeaders)) {
      if (k && typeof v === 'string' && !FORBIDDEN_EXTRA_HEADERS.has(k.toLowerCase())) headers[k] = v
    }
  }
  if (kind === 'openrouter') {
    headers['HTTP-Referer'] = headers['HTTP-Referer'] || 'https://jaswave.app'
    headers['X-Title'] = headers['X-Title'] || 'JasWave'
  }
}

function mapHttpStatus(status: number, body: string, kind: AiProviderKind): AiChatResult {
  const snippet = extractProviderMessage(body)
  if (status === 402) {
    return fail(
      `Sin crédito / pago requerido (${status}). ${snippet || 'Add credits or switch to a free model.'}`,
      'payment_required',
      kind,
    )
  }
  if (status === 401) return fail(`No autorizado (${status}). ${snippet}`, 'unauthorized', kind)
  if (status === 403) return fail(`Acceso denegado (${status}). ${snippet}`, 'forbidden', kind)
  if (status === 404) return fail(`Recurso no encontrado (${status}). ${snippet}`, 'model_not_found', kind)
  if (status === 429) return fail(`Límite de tasa (${status}). ${snippet}`, 'rate_limit', kind)
  if (status === 502 || status === 503 || status === 504) {
    return fail(`Servicio no disponible (${status}). ${snippet}`, 'service_unavailable', kind)
  }
  if (status >= 400 && status < 500) return fail(`Petición inválida (${status}). ${snippet}`, 'bad_request', kind)
  return fail(`Error del proveedor (${status}). ${snippet}`, 'provider_error', kind)
}

/** Señal de cancelación del chat en curso (la cola es serial: uno a la vez). */
let activeChatSignal: AbortSignal | null = null
const chatControllers = new Map<string, AbortController>()

/** Cancela un chat en cola o en curso (incluye sus reintentos). */
export function cancelAiChat(requestId: string): boolean {
  const c = chatControllers.get(requestId)
  if (!c) return false
  c.abort()
  return true
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  outerSignal: AbortSignal | null = activeChatSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outer = outerSignal
  const onOuterAbort = () => controller.abort()
  outer?.addEventListener('abort', onOuterAbort)
  if (outer?.aborted) controller.abort()
  try {
    // Dentro de conRedRestringida (proveedores de usuario) se usa el fetch que bloquea redes privadas.
    return await fetchActual()(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

function classifyFetchError(err: unknown, kind: AiProviderKind): AiChatResult {
  const msg = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return fail('Tiempo de espera agotado al contactar el proveedor.', 'timeout', kind)
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
    return fail(`No se pudo conectar: ${msg}`, 'connection', kind)
  }
  return fail(msg || 'Error desconocido de red', 'unknown', kind)
}

function isMockRequest(req: { kind: AiProviderKind }): boolean {
  return req.kind === 'mock' || Boolean(mockScriptPathFromEnv())
}

function validateRequest(req: AiChatRequest): AiChatResult | null {
  if (!req.kind) return fail('Falta el tipo de proveedor.', 'bad_request', 'openai-compatible')
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return fail('No hay mensajes para enviar.', 'bad_request', req.kind)
  }
  if (isMockRequest(req)) return null
  if (!normalizeBase(req.baseUrl)) return fail('Falta la URL base del proveedor.', 'missing_base_url', req.kind)
  if (!isAllowedProviderUrl(req.baseUrl)) return fail('La URL base debe ser http(s).', 'missing_base_url', req.kind)
  if (!String(req.model || '').trim()) return fail('Falta el modelo.', 'missing_model', req.kind)
  if (needsKey(req.kind, req.custom) && !String(req.apiKey || '').trim()) {
    return fail(`El proveedor ${req.kind} requiere API key.`, 'missing_api_key', req.kind)
  }
  return null
}

function isOpenAiCompatible(kind: AiProviderKind): boolean {
  return kind === 'openai' || kind === 'openrouter' || kind === 'kilocode' || kind === 'openai-compatible'
}

/**
 * Base URL para clientes OpenAI-compatible.
 * Kilo usa `…/api/gateway` (sin /v1). OpenAI/OpenRouter suelen necesitar /v1.
 * `custom.appendV1` tiene prioridad.
 */
function openAiBase(url: string, kind?: AiProviderKind, custom?: AiProviderCustom): string {
  const base = normalizeBase(url)
  if (custom?.appendV1 === true) return /\/v1$/i.test(base) ? base : `${base}/v1`
  if (custom?.appendV1 === false) return base
  if (kind === 'kilocode') return base
  if (/\/v1$/i.test(base) || /\/gateway$/i.test(base)) return base
  return `${base}/v1`
}

/** Estilo de API efectivo del request. */
export function resolveApiStyle(req: { kind: AiProviderKind; custom?: AiProviderCustom }): StreamStyle | null {
  const style = req.custom?.apiStyle
  if (style) return style
  if (req.kind === 'ollama') return 'ollama'
  if (req.kind === 'anthropic') return 'anthropic'
  if (req.kind === 'gemini') return 'gemini'
  if (isOpenAiCompatible(req.kind)) return 'openai'
  return null
}

/** Modelos que rechazaron tools en esta sesión (no se reintenta con tools). */
const toolsRejectedModels = new Set<string>()

function toolsKey(req: AiChatRequest): string {
  return `${req.kind}|${normalizeBase(req.baseUrl)}|${req.model}`
}

/** ¿Se enviarán tools nativas en este request? */
export function shouldSendTools(req: AiChatRequest): boolean {
  if (!req.tools?.length) return false
  if (toolsRejectedModels.has(toolsKey(req))) return false
  return providerSupportsTools({
    kind: req.kind,
    apiStyle: req.custom?.apiStyle,
    model: req.model,
    supportsTools: req.custom?.supportsTools,
  })
}

function toolsUnsupported(req: AiChatRequest, detail: string): AiChatResult {
  toolsRejectedModels.add(toolsKey(req))
  return fail(`El modelo no admite tool-calling nativo: ${detail}`, 'bad_request', req.kind, { toolsUnsupported: true })
}

type HttpTarget = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

/** Construye URL/cabeceras/cuerpo del proveedor (sin red). Exportado para snapshots. */
export function buildProviderRequest(req: AiChatRequest, opts: { stream?: boolean } = {}): HttpTarget {
  const style = resolveApiStyle(req)
  const stream = opts.stream === true
  const part = {
    model: req.model,
    messages: req.messages,
    tools: shouldSendTools(req) ? req.tools : undefined,
    toolChoice: req.toolChoice,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
  }
  if (style === 'anthropic') {
    const base = normalizeBase(req.baseUrl) || 'https://api.anthropic.com'
    return {
      url: `${base}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': String(req.apiKey ?? '').trim(),
        'anthropic-version': '2023-06-01',
      },
      body: buildAnthropicBody(part, stream),
    }
  }
  if (style === 'gemini') {
    const base = normalizeBase(req.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta'
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
    // API key por cabecera (no en la URL: evita que quede en logs/proxies).
    return {
      url: `${base}/models/${encodeURIComponent(req.model)}:${method}`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(req.apiKey ?? '').trim() },
      body: buildGeminiBody(part),
    }
  }
  if (style === 'ollama') {
    return {
      url: `${normalizeBase(req.baseUrl)}/api/chat`,
      headers: { 'Content-Type': 'application/json' },
      body: buildOllamaBody(part, stream),
    }
  }
  const base = openAiBase(req.baseUrl, req.kind, req.custom)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  applyAuthHeaders(headers, req.apiKey, req.kind, req.custom)
  const chatPath = req.custom?.chatPath?.trim() || '/chat/completions'
  const body: Record<string, unknown> = { ...buildOpenAiBody(part, stream), ...(req.extra ?? {}) }
  // Con streaming, el consumo solo llega si se pide (último trozo con `usage`).
  if (stream && req.extra) body.stream_options = { include_usage: true }
  return { url: joinUrl(base, chatPath), headers, body }
}

function emptyMessage(style: StreamStyle): string {
  if (style === 'anthropic') return 'Claude devolvió una respuesta vacía.'
  if (style === 'gemini') return 'Gemini devolvió una respuesta vacía.'
  if (style === 'ollama') return 'Ollama devolvió una respuesta vacía.'
  return 'El modelo devolvió una respuesta vacía.'
}

/** Interpreta el cuerpo JSON (no streaming) de cada proveedor. Exportado para tests. */
export function parseProviderResponse(style: StreamStyle, kind: AiProviderKind, text: string, model: string): AiChatResult {
  let data: Record<string, any>
  try {
    data = JSON.parse(text)
  } catch {
    return fail('Respuesta no JSON del proveedor.', 'provider_error', kind)
  }
  if (style === 'openai' && data.error?.message) {
    const errType = String(data.error.type ?? '')
    const code: AiErrorCode =
      errType.includes('service_unavailable') || data.error.statusCode === 503
        ? 'service_unavailable'
        : errType.includes('rate_limit') || data.error.statusCode === 429
          ? 'rate_limit'
          : 'provider_error'
    return fail(data.error.message, code, kind)
  }
  if (style !== 'openai' && data.error) {
    return fail(typeof data.error === 'string' ? data.error : String(data.error.message ?? 'Error del proveedor'), 'provider_error', kind)
  }
  const parsed =
    style === 'anthropic'
      ? parseAnthropicContent(data.content)
      : style === 'gemini'
        ? parseGeminiParts(data.candidates?.[0]?.content?.parts)
        : style === 'ollama'
          ? parseOllamaMessage(data.message ?? { content: data.response })
          : parseOpenAiMessage(data.choices?.[0]?.message)
  const usage = usageFrom(data)
  if (!parsed.content.trim() && !parsed.toolCalls.length) return fail(emptyMessage(style), 'empty_response', kind, usage ? { usage } : {})
  return {
    success: true,
    content: parsed.content,
    ...(parsed.toolCalls.length ? { toolCalls: parsed.toolCalls } : {}),
    model,
    provider: kind,
    ...(usage ? { usage } : {}),
  }
}

async function chatHttp(
  req: AiChatRequest,
  onDelta?: (text: string) => void,
  opts: { signal?: AbortSignal | null; timeoutMs?: number } = {},
): Promise<AiChatResult> {
  const style = resolveApiStyle(req)
  if (!style) return fail(`Proveedor no soportado: ${req.kind}`, 'bad_request', req.kind)
  if (style === 'anthropic' && !String(req.apiKey ?? '').trim()) {
    return fail('Anthropic requiere API key.', 'missing_api_key', req.kind)
  }
  if (style === 'anthropic' && !req.messages.some((m) => m.role !== 'system')) {
    return fail('Anthropic requiere al menos un mensaje user/assistant.', 'bad_request', req.kind)
  }
  if (style === 'gemini' && !req.messages.some((m) => m.role !== 'system')) {
    return fail('Gemini requiere al menos un mensaje de usuario.', 'bad_request', req.kind)
  }
  const sentTools = shouldSendTools(req)
  const target = buildProviderRequest(req, { stream: Boolean(onDelta) })
  let res: Response
  try {
    res = await fetchWithTimeout(
      target.url,
      { method: 'POST', headers: target.headers, body: JSON.stringify(target.body) },
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      opts.signal === undefined ? activeChatSignal : opts.signal,
    )
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }
  if (!res.ok) {
    const text = await res.text()
    if (sentTools && isToolsUnsupportedError(res.status, text)) return toolsUnsupported(req, extractProviderMessage(text))
    return mapHttpStatus(res.status, text, req.kind)
  }
  if (!onDelta || !res.body) {
    return parseProviderResponse(style, req.kind, await res.text(), req.model)
  }
  const acc = createStreamAccumulator(style)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const delta = acc.push(decoder.decode(value, { stream: true }))
      if (delta) onDelta(delta)
    }
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }
  const out = acc.finish()
  const usage = out.usage
  if (out.error) return fail(out.error, 'provider_error', req.kind)
  if (!out.content.trim() && !out.toolCalls.length) return fail(emptyMessage(style), 'empty_response', req.kind, usage ? { usage } : {})
  return {
    success: true,
    content: out.content,
    ...(out.toolCalls.length ? { toolCalls: out.toolCalls } : {}),
    model: req.model,
    provider: req.kind,
    ...(usage ? { usage } : {}),
  }
}

/** Mock por perfil (sin guion de entorno): cada perfil tiene su propio reproductor vacío. */
const profileMock = createMockPlayer({ responses: [], fallback: { content: 'Respuesta mock (sin guion: define JASWAVE_AI_MOCK).' } })

function chatMock(req: AiChatRequest, onDelta?: (text: string) => void): AiChatResult {
  let player
  try {
    player = envMockPlayer() ?? profileMock
  } catch (err) {
    return fail(`Guion mock ilegible: ${err instanceof Error ? err.message : String(err)}`, 'bad_request', 'mock')
  }
  const r = player.next({
    messages: req.messages,
    hasTools: Boolean(req.tools?.length),
    purpose: req.meta?.purpose,
    role: req.meta?.role,
  })
  if (r.toolsUnsupported) return fail(r.error ?? 'tools no soportadas', 'bad_request', 'mock', { toolsUnsupported: true })
  if (!r.success) return fail(r.error ?? 'mock', (r.errorCode as AiErrorCode) || 'provider_error', 'mock')
  if (r.content && onDelta) onDelta(r.content)
  return {
    success: true,
    content: r.content ?? '',
    ...(r.toolCalls?.length ? { toolCalls: r.toolCalls } : {}),
    model: req.model || 'mock',
    provider: 'mock',
  }
}

async function runQueued(
  req: AiChatRequest,
  body: (signal: AbortSignal) => Promise<AiChatResult>,
): Promise<AiChatResult> {
  const invalid = validateRequest(req)
  if (invalid) return invalid

  const controller = new AbortController()
  if (req.requestId) chatControllers.set(req.requestId, controller)
  const cancelled = () => fail('Solicitud cancelada.', 'cancelled', req.kind)

  let result!: AiChatResult
  const run = async () => {
    if (controller.signal.aborted) {
      result = cancelled()
      return
    }
    const gap = isMockRequest(req) ? 0 : minGapBetweenChatsMs(req.kind)
    if (gap > 0) {
      const wait = Math.max(0, lastChatFinishedAt + gap - Date.now())
      if (wait > 0) await sleep(wait)
    }
    activeChatSignal = controller.signal
    try {
      result = await body(controller.signal)
      if (controller.signal.aborted) result = cancelled()
    } finally {
      activeChatSignal = null
      lastChatFinishedAt = Date.now()
    }
  }
  try {
    chatQueue = chatQueue.then(run, run)
    await chatQueue
    return result
  } finally {
    if (req.requestId) chatControllers.delete(req.requestId)
  }
}

export async function aiChat(req: AiChatRequest): Promise<AiChatResult> {
  return runQueued(req, (signal) => aiChatWithRetry(req, signal))
}

/**
 * Chat con streaming de texto: `onDelta` recibe cada trozo. Reintenta solo si el fallo ocurrió
 * antes del primer delta (un stream a medias no se repite para no duplicar texto).
 */
export async function aiChatStream(req: AiChatRequest, onDelta: (text: string) => void): Promise<AiChatResult> {
  return runQueued(req, (signal) => {
    let any = false
    return aiChatWithRetry(req, signal, (t) => {
      any = true
      onDelta(t)
    }, () => any)
  })
}

async function aiChatWithRetry(
  req: AiChatRequest,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
  streamedSomething?: () => boolean,
): Promise<AiChatResult> {
  let last: AiChatResult = fail('Sin respuesta del proveedor.', 'unknown', req.kind)
  let attempts = 0
  for (let attempt = 0; attempt <= MAX_CHAT_RETRIES; attempt++) {
    if (signal?.aborted) return { ...last, httpAttempts: attempts }
    attempts += 1
    last = await aiChatOnce(req, onDelta)
    if (last.success || signal?.aborted || last.toolsUnsupported) return { ...last, httpAttempts: attempts }
    if (streamedSomething?.()) return { ...last, httpAttempts: attempts }
    if (!isRetriableErrorCode(last.errorCode) || attempt === MAX_CHAT_RETRIES) return { ...last, httpAttempts: attempts }
    const delay = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 500)
    await sleep(delay)
  }
  return { ...last, httpAttempts: attempts }
}

/**
 * Una petición directa, sin la cola global ni reintentos: la usa el enrutador de JasWave IA, que
 * reparte la carga entre claves y modelos y decide él mismo cuándo reintentar o cubrir.
 */
export async function aiChatDirecto(
  req: AiChatRequest,
  opts: { signal?: AbortSignal; onDelta?: (text: string) => void; timeoutMs?: number } = {},
): Promise<AiChatResult> {
  const invalid = validateRequest(req)
  if (invalid) return invalid
  if (opts.signal?.aborted) return fail('Solicitud cancelada.', 'cancelled', req.kind)
  try {
    if (isMockRequest(req)) return chatMock(req, opts.onDelta)
    if (req.tools?.length && !shouldSendTools(req)) return toolsUnsupported(req, `${req.kind} · ${req.model}`)
    const r = await chatHttp(req, opts.onDelta, { signal: opts.signal ?? null, timeoutMs: opts.timeoutMs })
    return opts.signal?.aborted ? fail('Solicitud cancelada.', 'cancelled', req.kind) : r
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }
}

async function aiChatOnce(req: AiChatRequest, onDelta?: (text: string) => void): Promise<AiChatResult> {
  try {
    if (isMockRequest(req)) return chatMock(req, onDelta)
    if (req.tools?.length && !shouldSendTools(req)) {
      // El modelo no tiene tools nativas: el cliente reintenta con marcadores (sin gastar HTTP).
      return toolsUnsupported(req, `${req.kind} · ${req.model}`)
    }
    return await chatHttp(req, onDelta)
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }
}


async function healthOpenAi(req: AiHealthRequest): Promise<AiHealthResult> {
  if (needsKey(req.kind, req.custom) && !req.apiKey?.trim()) {
    return healthFail(`El proveedor ${req.kind} requiere API key.`, 'missing_api_key', req.kind, 'misconfigured')
  }
  const base = openAiBase(req.baseUrl, req.kind, req.custom)
  const headers: Record<string, string> = {}
  applyAuthHeaders(headers, req.apiKey, req.kind, req.custom)

  const modelsPath = req.custom?.modelsPath?.trim() || '/models'
  try {
    const res = await fetchWithTimeout(joinUrl(base, modelsPath), { method: 'GET', headers }, 20_000)
    const text = await res.text()
    if (!res.ok) {
      const mapped = mapHttpStatus(res.status, text, req.kind)
      return healthFail(mapped.error!, mapped.errorCode!, req.kind)
    }
    const data = JSON.parse(text) as { data?: Array<{ id?: string }> }
    const models = (data.data ?? []).map((m) => m.id).filter(Boolean) as string[]
    return { status: 'healthy', models, baseUrl: base, provider: req.kind }
  } catch (err) {
    const mapped = classifyFetchError(err, req.kind)
    return healthFail(mapped.error!, mapped.errorCode!, req.kind)
  }
}

async function healthAnthropic(req: AiHealthRequest): Promise<AiHealthResult> {
  if (!req.apiKey?.trim()) {
    return healthFail('Anthropic requiere API key.', 'missing_api_key', req.kind, 'misconfigured')
  }
  // Anthropic no tiene list models público estable; validamos la key con un ping ligero fallido controlado
  // usando models endpoint si existe, si no marcamos healthy tras validar formato.
  const base = normalizeBase(req.baseUrl) || 'https://api.anthropic.com'
  try {
    const res = await fetchWithTimeout(
      `${base}/v1/models`,
      {
        method: 'GET',
        headers: {
          'x-api-key': req.apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
      },
      20_000,
    )
    const text = await res.text()
    if (res.ok) {
      const data = JSON.parse(text) as { data?: Array<{ id?: string }> }
      const models = (data.data ?? []).map((m) => m.id).filter(Boolean) as string[]
      return {
        status: 'healthy',
        models: models.length
          ? models
          : ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest'],
        baseUrl: base,
        provider: req.kind,
      }
    }
    if (res.status === 404) {
      // Endpoint no disponible: key presente → OK con modelos sugeridos
      return {
        status: 'healthy',
        models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest'],
        baseUrl: base,
        provider: req.kind,
        hint: 'Conexión lista. Anthropic no listó modelos; usa los sugeridos o añade el tuyo.',
      }
    }
    const mapped = mapHttpStatus(res.status, text, req.kind)
    return healthFail(mapped.error!, mapped.errorCode!, req.kind)
  } catch (err) {
    const mapped = classifyFetchError(err, req.kind)
    return healthFail(mapped.error!, mapped.errorCode!, req.kind)
  }
}

async function healthGemini(req: AiHealthRequest): Promise<AiHealthResult> {
  if (!req.apiKey?.trim()) {
    return healthFail('Gemini requiere API key.', 'missing_api_key', req.kind, 'misconfigured')
  }
  const base = normalizeBase(req.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta'
  const url = `${base}/models`
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers: { 'x-goog-api-key': req.apiKey.trim() } }, 20_000)
    const text = await res.text()
    if (!res.ok) {
      const mapped = mapHttpStatus(res.status, text, req.kind)
      return healthFail(mapped.error!, mapped.errorCode!, req.kind)
    }
    const data = JSON.parse(text) as { models?: Array<{ name?: string }> }
    const models = (data.models ?? [])
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter((n) => n.includes('gemini'))
    return { status: 'healthy', models, baseUrl: base, provider: req.kind }
  } catch (err) {
    const mapped = classifyFetchError(err, req.kind)
    return healthFail(mapped.error!, mapped.errorCode!, req.kind)
  }
}

async function healthOllama(req: AiHealthRequest): Promise<AiHealthResult> {
  const base = normalizeBase(req.baseUrl)
  if (!base) return healthFail('Falta la URL de Ollama.', 'missing_base_url', req.kind, 'misconfigured')
  try {
    const res = await fetchWithTimeout(`${base}/api/tags`, { method: 'GET' }, 15_000)
    const text = await res.text()
    if (!res.ok) {
      const mapped = mapHttpStatus(res.status, text, req.kind)
      return healthFail(mapped.error!, mapped.errorCode!, req.kind)
    }
    const data = JSON.parse(text) as { models?: Array<{ name?: string }> }
    const models = (data.models ?? []).map((m) => m.name).filter(Boolean) as string[]
    return { status: 'healthy', models, baseUrl: base, provider: req.kind }
  } catch (err) {
    const mapped = classifyFetchError(err, req.kind)
    return healthFail(mapped.error!, mapped.errorCode!, req.kind)
  }
}

export async function aiHealth(req: AiHealthRequest): Promise<AiHealthResult> {
  if (!req.kind) return healthFail('Falta el tipo de proveedor.', 'bad_request', 'openai-compatible', 'misconfigured')
  if (isMockRequest(req)) {
    return { status: 'healthy', models: ['mock'], baseUrl: req.baseUrl, provider: 'mock', hint: 'Proveedor mock (guion determinista).' }
  }
  if (!normalizeBase(req.baseUrl)) {
    return healthFail('Falta la URL base.', 'missing_base_url', req.kind, 'misconfigured')
  }
  if (!isAllowedProviderUrl(req.baseUrl)) {
    return healthFail('La URL base debe ser http(s).', 'missing_base_url', req.kind, 'misconfigured')
  }
  const style = req.custom?.apiStyle
  try {
    if (style === 'ollama' || (!style && req.kind === 'ollama')) return await healthOllama(req)
    if (style === 'anthropic' || (!style && req.kind === 'anthropic')) return await healthAnthropic(req)
    if (style === 'gemini' || (!style && req.kind === 'gemini')) return await healthGemini(req)
    if (style === 'openai' || (!style && isOpenAiCompatible(req.kind))) return await healthOpenAi(req)
    if (req.kind === 'ollama') return await healthOllama(req)
    if (req.kind === 'anthropic') return await healthAnthropic(req)
    if (req.kind === 'gemini') return await healthGemini(req)
    if (isOpenAiCompatible(req.kind)) return await healthOpenAi(req)
    return healthFail(`Proveedor no soportado: ${req.kind}`, 'bad_request', req.kind, 'misconfigured')
  } catch (err) {
    const mapped = classifyFetchError(err, req.kind)
    return healthFail(mapped.error!, mapped.errorCode!, req.kind)
  }
}

/** Compat: argumentos antiguos (messages, model, baseUrl, temperature). */
export function legacyChatArgsToRequest(
  messages: unknown[],
  model?: string,
  baseUrl?: string,
  temperature?: number,
): AiChatRequest {
  return {
    messages: (messages as ChatMessage[]) ?? [],
    kind: 'ollama',
    model: model || 'llama3.2',
    baseUrl: baseUrl || 'http://127.0.0.1:11434',
    temperature,
  }
}
