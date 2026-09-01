/**
 * Gateway multi-proveedor de IA para el proceso principal de Electron.
 * OpenAI / Anthropic / Gemini / Ollama / OpenRouter / KiloCode / OpenAI-compatible.
 */

export type AiProviderKind =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'kilocode'
  | 'openai-compatible'

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
  | 'unknown'

export type ChatMessage = { role: string; content: string }

export type AiChatRequest = {
  messages: ChatMessage[]
  kind: AiProviderKind
  model: string
  baseUrl: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  custom?: AiProviderCustom
}

export type AiHealthRequest = {
  kind: AiProviderKind
  baseUrl: string
  apiKey?: string
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
      if (k && typeof v === 'string') headers[k] = v
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
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

function validateRequest(req: AiChatRequest): AiChatResult | null {
  if (!req.kind) return fail('Falta el tipo de proveedor.', 'bad_request', 'openai-compatible')
  if (!normalizeBase(req.baseUrl)) return fail('Falta la URL base del proveedor.', 'missing_base_url', req.kind)
  if (!String(req.model || '').trim()) return fail('Falta el modelo.', 'missing_model', req.kind)
  if (needsKey(req.kind, req.custom) && !String(req.apiKey || '').trim()) {
    return fail(`El proveedor ${req.kind} requiere API key.`, 'missing_api_key', req.kind)
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return fail('No hay mensajes para enviar.', 'bad_request', req.kind)
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

async function chatOpenAiCompatible(req: AiChatRequest): Promise<AiChatResult> {
  const base = openAiBase(req.baseUrl, req.kind, req.custom)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  applyAuthHeaders(headers, req.apiKey, req.kind, req.custom)

  const chatPath = req.custom?.chatPath?.trim() || '/chat/completions'
  let res: Response
  try {
    res = await fetchWithTimeout(joinUrl(base, chatPath), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 2048,
        stream: false,
      }),
    })
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }

  const text = await res.text()
  if (!res.ok) return mapHttpStatus(res.status, text, req.kind)

  let data: {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
    error?: { message?: string; type?: string; statusCode?: number }
  }
  try {
    data = JSON.parse(text)
  } catch {
    return fail('Respuesta no JSON del proveedor.', 'provider_error', req.kind)
  }

  if (data.error?.message) {
    const errType = String(data.error.type ?? '')
    const code: AiErrorCode =
      errType.includes('service_unavailable') || data.error.statusCode === 503
        ? 'service_unavailable'
        : errType.includes('rate_limit') || data.error.statusCode === 429
          ? 'rate_limit'
          : 'provider_error'
    return fail(data.error.message, code, req.kind)
  }

  const raw = data.choices?.[0]?.message?.content
  let content = ''
  if (typeof raw === 'string') content = raw
  else if (Array.isArray(raw)) content = raw.map((p) => p.text ?? '').join('')

  if (!content.trim()) return fail('El modelo devolvió una respuesta vacía.', 'empty_response', req.kind)
  return { success: true, content, model: req.model, provider: req.kind }
}

async function chatAnthropic(req: AiChatRequest): Promise<AiChatResult> {
  const base = normalizeBase(req.baseUrl) || 'https://api.anthropic.com'
  const systemParts = req.messages.filter((m) => m.role === 'system').map((m) => m.content)
  const messages = req.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  if (messages.length === 0) {
    return fail('Anthropic requiere al menos un mensaje user/assistant.', 'bad_request', req.kind)
  }

  let res: Response
  try {
    res = await fetchWithTimeout(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey!.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.4,
        system: systemParts.length ? systemParts.join('\n\n') : undefined,
        messages,
      }),
    })
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }

  const text = await res.text()
  if (!res.ok) return mapHttpStatus(res.status, text, req.kind)

  let data: { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } }
  try {
    data = JSON.parse(text)
  } catch {
    return fail('Respuesta no JSON de Anthropic.', 'provider_error', req.kind)
  }
  if (data.error?.message) return fail(data.error.message, 'provider_error', req.kind)

  const content = (data.content ?? [])
    .filter((b) => b.type === 'text' || !!b.text)
    .map((b) => b.text ?? '')
    .join('')

  if (!content.trim()) return fail('Claude devolvió una respuesta vacía.', 'empty_response', req.kind)
  return { success: true, content, model: req.model, provider: req.kind }
}

async function chatGemini(req: AiChatRequest): Promise<AiChatResult> {
  const base = normalizeBase(req.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta'
  const key = req.apiKey!.trim()
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents = req.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  if (contents.length === 0) {
    return fail('Gemini requiere al menos un mensaje de usuario.', 'bad_request', req.kind)
  }

  const url = `${base}/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(key)}`
  let res: Response
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature: req.temperature ?? 0.4,
          maxOutputTokens: req.maxTokens ?? 2048,
        },
      }),
    })
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }

  const text = await res.text()
  if (!res.ok) return mapHttpStatus(res.status, text, req.kind)

  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message?: string }
  }
  try {
    data = JSON.parse(text)
  } catch {
    return fail('Respuesta no JSON de Gemini.', 'provider_error', req.kind)
  }
  if (data.error?.message) return fail(data.error.message, 'provider_error', req.kind)

  const content = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!content.trim()) return fail('Gemini devolvió una respuesta vacía.', 'empty_response', req.kind)
  return { success: true, content, model: req.model, provider: req.kind }
}

async function chatOllama(req: AiChatRequest): Promise<AiChatResult> {
  const base = normalizeBase(req.baseUrl)
  let res: Response
  try {
    res = await fetchWithTimeout(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: false,
        options: typeof req.temperature === 'number' ? { temperature: req.temperature } : undefined,
      }),
    })
  } catch (err) {
    return classifyFetchError(err, req.kind)
  }

  const text = await res.text()
  if (!res.ok) return mapHttpStatus(res.status, text, req.kind)

  let data: { message?: { content?: string }; response?: string; error?: string }
  try {
    data = JSON.parse(text)
  } catch {
    return fail('Respuesta no JSON de Ollama.', 'provider_error', req.kind)
  }
  if (data.error) return fail(String(data.error), 'provider_error', req.kind)

  const content = data.message?.content ?? data.response ?? ''
  if (!String(content).trim()) return fail('Ollama devolvió una respuesta vacía.', 'empty_response', req.kind)
  return { success: true, content: String(content), model: req.model, provider: req.kind }
}

export async function aiChat(req: AiChatRequest): Promise<AiChatResult> {
  const invalid = validateRequest(req)
  if (invalid) return invalid

  let result!: AiChatResult
  const run = async () => {
    const gap = minGapBetweenChatsMs(req.kind)
    if (gap > 0) {
      const wait = Math.max(0, lastChatFinishedAt + gap - Date.now())
      if (wait > 0) await sleep(wait)
    }
    result = await aiChatWithRetry(req)
    lastChatFinishedAt = Date.now()
  }
  chatQueue = chatQueue.then(run, run)
  await chatQueue
  return result
}

async function aiChatWithRetry(req: AiChatRequest): Promise<AiChatResult> {
  let last: AiChatResult = fail('Sin respuesta del proveedor.', 'unknown', req.kind)
  for (let attempt = 0; attempt <= MAX_CHAT_RETRIES; attempt++) {
    last = await aiChatOnce(req)
    if (last.success) return last
    if (!isRetriableErrorCode(last.errorCode) || attempt === MAX_CHAT_RETRIES) return last
    const delay = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 500)
    await sleep(delay)
  }
  return last
}

async function aiChatOnce(req: AiChatRequest): Promise<AiChatResult> {
  const style = req.custom?.apiStyle
  try {
    if (style === 'ollama' || (!style && req.kind === 'ollama')) return await chatOllama(req)
    if (style === 'anthropic' || (!style && req.kind === 'anthropic')) return await chatAnthropic(req)
    if (style === 'gemini' || (!style && req.kind === 'gemini')) return await chatGemini(req)
    if (style === 'openai' || (!style && isOpenAiCompatible(req.kind))) return await chatOpenAiCompatible(req)
    if (req.kind === 'ollama') return await chatOllama(req)
    if (req.kind === 'anthropic') return await chatAnthropic(req)
    if (req.kind === 'gemini') return await chatGemini(req)
    if (isOpenAiCompatible(req.kind)) return await chatOpenAiCompatible(req)
    return fail(`Proveedor no soportado: ${req.kind}`, 'bad_request', req.kind)
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
  const url = `${base}/models?key=${encodeURIComponent(req.apiKey.trim())}`
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, 20_000)
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
  if (!normalizeBase(req.baseUrl)) {
    return healthFail('Falta la URL base.', 'missing_base_url', req.kind, 'misconfigured')
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
