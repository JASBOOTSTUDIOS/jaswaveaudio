/**
 * Ajustes de IA del asistente (M2). Los proveedores y modelos NO se configuran aquí: vienen del backend
 * (proveedores del admin permitidos por rol + modelos propios si el admin lo permite; ver
 * ia/catalogo-ia.ts). Localmente solo se guardan preferencias: proveedor y modelo elegidos,
 * temperatura, tokens y si se reintenta con otros modelos.
 *
 * Los presets describen cada tipo de proveedor (etiquetas, URL y modelos sugeridos) para el formulario
 * de modelos propios.
 */

import { transporteIA } from './ia/transporte-ia'
import { catalogoIA } from './ia/catalogo-ia'

export type AiProviderKind =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'kilocode'
  | 'openai-compatible'
  /** Proveedor determinista por guion (tests/e2e/CLI; ver JASWAVE_AI_MOCK). */
  | 'mock'

/** Cómo hablar con el endpoint (para proveedores no registrados). */
export type AiApiStyle = 'openai' | 'anthropic' | 'gemini' | 'ollama'

export type AiAuthStyle = 'bearer' | 'x-api-key' | 'none'

/** Overrides por proveedor personalizado (no hardcodeados en el catálogo). */
export type AiProviderCustom = { 
  apiStyle?: AiApiStyle
  /** Ruta relativa a la base, p.ej. `/chat/completions` */
  chatPath?: string
  /** Ruta para listar modelos, p.ej. `/models` */
  modelsPath?: string
  /** Si true fuerza `/v1`; si false no lo añade (p.ej. Kilo gateway). */
  appendV1?: boolean
  authStyle?: AiAuthStyle
  /** Cabeceras extra (Organization, Referer, etc.) */
  extraHeaders?: Record<string, string>
  /** Si el endpoint exige API key aunque el kind base no lo haga. */
  needsApiKey?: boolean
  /** Fuerza (true) o desactiva (false) el tool-calling nativo; sin valor → detección por proveedor. */
  supportsTools?: boolean
}

export type AiProviderProfile = {
  id: string
  kind: AiProviderKind
  name: string
  baseUrl: string
  /**
   * Solo en memoria mientras el usuario la escribe. En Electron se guarda cifrada en main
   * (ai-credentials) y aquí queda vacía con `hasApiKey: true`.
   */
  apiKey: string
  /** La API key está guardada en el almacén cifrado de Electron. */
  hasApiKey?: boolean
  models: string[]
  selectedModel: string
  /** Config libre para proveedores fuera del catálogo preset. */
  custom?: AiProviderCustom
  /** Último health check (para el catálogo «funcionando»). */
  lastHealth?: 'healthy' | 'disconnected' | 'misconfigured' | 'unknown'
  lastHealthAt?: number
  /** Modelos reportados por el endpoint en el último health OK. */
  discoveredModels?: string[]
  /** Proveedor del admin (lo ejecuta el backend) o propio del usuario. */
  origen?: 'admin' | 'propio'
  /** Solo propios: 'local' = se ejecuta en este equipo (escritorio). */
  ejecucion?: 'servidor' | 'local'
}

export type AiSettings = {
  version: 2
  activeProviderId: string
  providers: AiProviderProfile[]
  temperature: number
  maxTokens: number
  /** Si el modelo activo falla, reintentar con otros del catálogo (mismo contexto). */
  fallbackEnabled?: boolean
}

/** Entrada del catálogo unificado (proveedor + modelo). */
export type CatalogModelEntry = {
  key: string
  providerId: string
  model: string
  label: string
  kind: AiProviderKind
  providerName: string
  /** Tiene credenciales/URL mínimas para intentar. */
  ready: boolean
  /** Health reciente OK (o desconocido si nunca se probó). */
  healthy: boolean
}

/** Herramienta con JSON Schema (nombre canónico con puntos). */
export type AiToolSchema = { name: string; description: string; parameters: Record<string, unknown> }
export type AiToolCall = { id: string; name: string; arguments: Record<string, unknown> }

/** Mensaje hacia el gateway (incluye tool calls y resultados para tool-calling nativo). */
export type AiWireMessage = {
  role: string
  content: string
  toolCalls?: AiToolCall[]
  toolCallId?: string
  name?: string
}

/** Payload unificado hacia Electron. */
export type AiChatRequest = {
  messages: AiWireMessage[]
  kind: AiProviderKind
  model: string
  baseUrl: string
  apiKey?: string
  /** Main resuelve la API key cifrada de este perfil. */
  providerId?: string
  /** Permite cancelar en main (aiChatCancel) también la petición HTTP y sus reintentos. */
  requestId?: string
  temperature?: number
  maxTokens?: number
  custom?: AiProviderCustom
  tools?: AiToolSchema[]
  toolChoice?: 'auto' | 'none' | 'required'
  /** Propósito/rol del chat (el mock lo usa para elegir respuesta). */
  meta?: { purpose?: string; role?: string; runId?: string }
}

export type AiHealthRequest = {
  kind: AiProviderKind
  baseUrl: string
  apiKey?: string
  providerId?: string
  custom?: AiProviderCustom
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

export type AiChatResult = {
  success: boolean
  content?: string
  model?: string
  provider?: string
  error?: string
  errorCode?: AiErrorCode
  hint?: string
  toolCalls?: AiToolCall[]
  /** El modelo no soporta tools nativas: reintentar con marcadores. */
  toolsUnsupported?: boolean
  /** Intentos HTTP del gateway (reintentos incluidos). */
  httpAttempts?: number
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

const STORAGE_KEY = 'jaswave-ai-preferencias-v3'
/** Ajustes antiguos con proveedores locales (antes de M2): se eliminan junto con sus claves del equipo. */
const LEGACY_KEYS = ['jaswave-ai-settings-v2', 'jaswave-ai-settings-v1']

export const PROVIDER_PRESETS: Record<
  AiProviderKind,
  {
    label: string
    defaultBaseUrl: string
    defaultModel: string
    needsApiKey: boolean
    hint: string
    suggestedModels: string[]
  }
> = {
  ollama: {
    label: 'Ollama (local)',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'llama3.2',
    needsApiKey: false,
    hint: 'Ejecuta Ollama en tu máquina. No requiere API key.',
    suggestedModels: ['llama3.2', 'mistral', 'qwen2.5', 'gemma2'],
  },
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    needsApiKey: true,
    hint: 'Usa una API key de platform.openai.com',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    needsApiKey: true,
    hint: 'Usa una API key de console.anthropic.com',
    suggestedModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest'],
  },
  gemini: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    needsApiKey: true,
    hint: 'API key de Google AI Studio (aistudio.google.com)',
    suggestedModels: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'],
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    needsApiKey: true,
    hint: 'Un solo endpoint para muchos modelos (openrouter.ai)',
    suggestedModels: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.0-flash'],
  },
  kilocode: {
    label: 'Kilo Code',
    defaultBaseUrl: 'https://api.kilo.ai/api/gateway',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    needsApiKey: true,
    hint: 'Gateway OpenAI-compatible: https://api.kilo.ai/api/gateway (requiere API key de kilo.ai).',
    suggestedModels: [
      'anthropic/claude-sonnet-4.5',
      'openai/gpt-4o-mini',
      'google/gemini-2.0-flash',
    ],
  },
  'openai-compatible': {
    label: 'Personalizado (cualquier API)',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
    needsApiKey: false,
    hint: 'Proveedor no listado: LM Studio, vLLM, Together, Azure, gateway propio… Define URL, modelo, key y paths.',
    suggestedModels: ['local-model'],
  },
  mock: {
    label: 'Mock (guion de pruebas)',
    defaultBaseUrl: 'http://mock.local',
    defaultModel: 'mock',
    needsApiKey: false,
    hint: 'Respuestas deterministas desde el guion JSON de JASWAVE_AI_MOCK (tests, e2e y CLI).',
    suggestedModels: ['mock'],
  },
}

export const DEFAULT_CUSTOM_OPENAI: AiProviderCustom = {
  apiStyle: 'openai',
  chatPath: '/chat/completions',
  modelsPath: '/models',
  appendV1: false,
  authStyle: 'bearer',
  needsApiKey: true,
  extraHeaders: {},
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeCustom(raw?: AiProviderCustom | null): AiProviderCustom | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const extraHeaders =
    raw.extraHeaders && typeof raw.extraHeaders === 'object'
      ? Object.fromEntries(
          Object.entries(raw.extraHeaders)
            .filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
            .map(([k, v]) => [k, String(v)]),
        )
      : undefined
  return {
    apiStyle: raw.apiStyle,
    chatPath: raw.chatPath?.trim() || undefined,
    modelsPath: raw.modelsPath?.trim() || undefined,
    appendV1: typeof raw.appendV1 === 'boolean' ? raw.appendV1 : undefined,
    authStyle: raw.authStyle,
    needsApiKey: typeof raw.needsApiKey === 'boolean' ? raw.needsApiKey : undefined,
    extraHeaders: extraHeaders && Object.keys(extraHeaders).length ? extraHeaders : undefined,
  }
}

export function createProviderProfile(
  kind: AiProviderKind,
  overrides?: Partial<AiProviderProfile>,
): AiProviderProfile {
  const preset = PROVIDER_PRESETS[kind]
  const custom =
    kind === 'openai-compatible'
      ? normalizeCustom({ ...DEFAULT_CUSTOM_OPENAI, ...overrides?.custom })
      : normalizeCustom(overrides?.custom)
  return {
    id: overrides?.id ?? newId(),
    kind,
    name: overrides?.name ?? preset.label,
    baseUrl: overrides?.baseUrl ?? preset.defaultBaseUrl,
    apiKey: overrides?.apiKey ?? '',
    hasApiKey: overrides?.hasApiKey,
    models: overrides?.models ?? [...preset.suggestedModels],
    selectedModel: overrides?.selectedModel ?? preset.defaultModel,
    custom,
    lastHealth: overrides?.lastHealth,
    lastHealthAt: overrides?.lastHealthAt,
    discoveredModels: overrides?.discoveredModels,
  }
}

export function providerNeedsApiKey(provider: AiProviderProfile): boolean {
  if (provider.custom?.needsApiKey != null) return provider.custom.needsApiKey
  return PROVIDER_PRESETS[provider.kind].needsApiKey
}

export function providerLabel(provider: AiProviderProfile): string {
  if (provider.kind === 'openai-compatible') {
    return provider.name?.trim() || PROVIDER_PRESETS['openai-compatible'].label
  }
  return PROVIDER_PRESETS[provider.kind].label
}

/** Arma el request de chat desde el perfil (modelo opcional override). */
export function toAiChatPayload(
  provider: AiProviderProfile,
  messages: AiChatRequest['messages'],
  opts: {
    temperature: number
    maxTokens: number
    model?: string
    tools?: AiToolSchema[]
    toolChoice?: AiChatRequest['toolChoice']
    meta?: AiChatRequest['meta']
  },
): AiChatRequest {
  return {
    messages,
    kind: provider.kind,
    model: opts.model?.trim() || provider.selectedModel,
    baseUrl: provider.baseUrl,
    ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    providerId: provider.id,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    custom: provider.custom,
    ...(opts.tools?.length ? { tools: opts.tools, toolChoice: opts.toolChoice ?? 'auto' } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  }
}

export function toAiHealthPayload(provider: AiProviderProfile): AiHealthRequest {
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    providerId: provider.id,
    custom: provider.custom,
  }
}

/** El backend ejecuta el proveedor (del admin, o propio con ejecución en servidor). */
export function providerEnServidor(provider: AiProviderProfile): boolean {
  return provider.origen === 'admin' || (provider.origen === 'propio' && provider.ejecucion !== 'local')
}

export function providerIsReady(provider: AiProviderProfile): boolean {
  if (!provider.id) return false
  // El servidor conoce URL y clave; aquí basta con tener modelo.
  if (providerEnServidor(provider)) return Boolean(String(provider.selectedModel || provider.models[0] || '').trim())
  if (!String(provider.baseUrl || '').trim()) return false
  if (!String(provider.selectedModel || provider.models[0] || '').trim()) return false
  if (providerNeedsApiKey(provider) && !String(provider.apiKey || '').trim() && !provider.hasApiKey) return false
  return true
}

export function providerLooksHealthy(provider: AiProviderProfile): boolean {
  if (provider.lastHealth === 'healthy') return true
  if (provider.lastHealth === 'disconnected' || provider.lastHealth === 'misconfigured') return false
  return providerIsReady(provider)
}

/** Catálogo plano: todos los modelos de todos los proveedores configurados. */
export function listCatalogModels(settings: AiSettings = loadAiSettings()): CatalogModelEntry[] {
  const out: CatalogModelEntry[] = []
  const seen = new Set<string>()
  for (const p of settings.providers) {
    const models = Array.from(
      new Set(
        // Solo los modelos que el servidor permite para ese proveedor (sin sugerencias de presets).
        [p.selectedModel, ...p.models].filter(Boolean),
      ),
    )
    const ready = providerIsReady(p)
    const healthy = providerLooksHealthy(p)
    for (const model of models) {
      const key = `${p.id}::${model}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        key,
        providerId: p.id,
        model,
        label: `${p.name} · ${model}`,
        kind: p.kind,
        providerName: p.name,
        ready,
        healthy,
      })
    }
  }
  // Saludables primero, luego ready, luego el resto
  return out.sort((a, b) => {
    const score = (e: CatalogModelEntry) => (e.healthy ? 2 : 0) + (e.ready ? 1 : 0)
    const d = score(b) - score(a)
    if (d !== 0) return d
    return a.label.localeCompare(b.label)
  })
}

export function selectCatalogModel(
  settings: AiSettings,
  providerId: string,
  model: string,
): AiSettings {
  const providers = settings.providers.map((p) =>
    p.id === providerId ? upsertProviderModel(p, model) : p,
  )
  return { ...settings, activeProviderId: providerId, providers }
}

export type FallbackAttempt = {
  provider: AiProviderProfile
  model: string
  label: string
}

/** Cadena de reintento: activo primero, luego otros modelos/proveedores listos. */
export function buildFallbackAttempts(
  settings: AiSettings = loadAiSettings(),
): FallbackAttempt[] {
  const active = getActiveProvider(settings)
  const attempts: FallbackAttempt[] = []
  const seen = new Set<string>()

  const push = (provider: AiProviderProfile, model: string) => {
    const m = model.trim()
    if (!m || !providerIsReady({ ...provider, selectedModel: m })) return
    const key = `${provider.id}::${m}`
    if (seen.has(key)) return
    seen.add(key)
    attempts.push({
      provider,
      model: m,
      label: `${provider.name} · ${m}`,
    })
  }

  push(active, active.selectedModel)
  for (const m of [...(active.discoveredModels ?? []), ...active.models]) {
    push(active, m)
  }

  const others = [...settings.providers].sort((a, b) => {
    const ha = providerLooksHealthy(a) ? 0 : 1
    const hb = providerLooksHealthy(b) ? 0 : 1
    return ha - hb
  })
  for (const p of others) {
    if (p.id === active.id) continue
    push(p, p.selectedModel)
    for (const m of [...(p.discoveredModels ?? []), ...p.models]) push(p, m)
  }

  return attempts.slice(0, 8)
}

const RETRYABLE_CODES = new Set<AiErrorCode>([
  'connection',
  'timeout',
  'rate_limit',
  'service_unavailable',
  'model_not_found',
  'empty_response',
  'provider_error',
  'unknown',
  'not_available',
  'payment_required',
])

export function isRetryableAiFailure(result: AiChatResult): boolean {
  if (result.success && (result.content?.trim() || result.toolCalls?.length)) return false
  if (result.success && !result.content?.trim()) return true
  const code = result.errorCode
  if (!code) return true
  if (code === 'missing_api_key' || code === 'unauthorized' || code === 'forbidden') return true
  if (RETRYABLE_CODES.has(code)) return true
  // Legado: 402 a veces venía como bad_request
  const msg = `${result.error ?? ''} ${result.hint ?? ''}`.toLowerCase()
  return /402|payment.?required|add credits|sin cr[eé]dito/.test(msg)
}

export type AiChatWithFallbackResult = AiChatResult & {
  usedProviderId?: string
  usedModel?: string
  attempts?: number
  fallbackUsed?: boolean
}

/**
 * Llama al proveedor activo; si falla y fallbackEnabled, prueba otros del catálogo
 * con el mismo array de messages (mismo contexto).
 */
export async function aiChatWithFallback(
  chat: (req: AiChatRequest) => Promise<AiChatResult>,
  messages: AiChatRequest['messages'],
  opts: {
    temperature: number
    maxTokens: number
    settings?: AiSettings
    abort?: AbortSignal
    onAttempt?: (info: { label: string; index: number; total: number }) => void
    /**
     * Antes de cada intento (incluidos los fallbacks): false = no intentar (presupuesto agotado).
     * El motor (A1) carga aquí cada intento HTTP al presupuesto del turno.
     */
    beforeAttempt?: (info: { label: string; index: number; total: number }) => boolean
    tools?: AiToolSchema[]
    toolChoice?: AiChatRequest['toolChoice']
    meta?: AiChatRequest['meta']
    /** Streaming de texto: usa `streamChat` (IPC ai-chat-stream) en vez de `chat`. */
    onDelta?: (text: string) => void
    streamChat?: (req: AiChatRequest, onDelta: (text: string) => void) => Promise<AiChatResult>
  },
): Promise<AiChatWithFallbackResult> {
  const settings = opts.settings ?? loadAiSettings()
  const chain =
    settings.fallbackEnabled === false
      ? (() => {
          const a = getActiveProvider(settings)
          return [{ provider: a, model: a.selectedModel, label: `${a.name} · ${a.selectedModel}` }]
        })()
      : buildFallbackAttempts(settings)

  if (!chain.length) {
    return {
      success: false,
      error: 'Tu cuenta no tiene modelos de IA disponibles.',
      errorCode: 'missing_model',
      hint: 'Inicia sesión y pide a tu administrador acceso al asistente (o permiso para añadir tus propios modelos).',
    }
  }

  let last: AiChatResult = {
    success: false,
    error: 'Sin intentos',
    errorCode: 'unknown',
  }
  let httpAttempts = 0

  for (let i = 0; i < chain.length; i++) {
    if (opts.abort?.aborted) {
      return { success: false, error: 'Abortado', errorCode: 'cancelled', attempts: i, httpAttempts }
    }
    const attempt = chain[i]!
    const info = { label: attempt.label, index: i, total: chain.length }
    if (opts.beforeAttempt && !opts.beforeAttempt(info)) {
      return {
        ...last,
        success: false,
        error: last.success ? 'Presupuesto agotado' : last.error || 'Presupuesto agotado',
        attempts: i,
        httpAttempts,
      }
    }
    opts.onAttempt?.(info)
    const req = toAiChatPayload(attempt.provider, messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      model: attempt.model,
      tools: opts.tools,
      toolChoice: opts.toolChoice,
      meta: opts.meta,
    })
    req.requestId = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const cancelInMain = () => {
      void transporteIA()?.cancelar(req.requestId!)
    }
    opts.abort?.addEventListener('abort', cancelInMain, { once: true })
    try {
      last =
        opts.onDelta && opts.streamChat ? await opts.streamChat(req, opts.onDelta) : await chat(req)
    } catch (e) {
      last = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        errorCode: 'connection',
        provider: attempt.provider.kind,
      }
    }
    opts.abort?.removeEventListener('abort', cancelInMain)
    httpAttempts += Math.max(1, Number(last.httpAttempts) || 1)
    const ok = last.success && (Boolean(last.content?.trim()) || Boolean(last.toolCalls?.length))
    if (ok || last.toolsUnsupported) {
      // toolsUnsupported: el llamador reintenta con marcadores en el MISMO modelo.
      return {
        ...last,
        usedProviderId: attempt.provider.id,
        usedModel: attempt.model,
        attempts: i + 1,
        fallbackUsed: i > 0,
        model: attempt.model,
        provider: attempt.provider.kind,
        httpAttempts,
      }
    }
    if (!isRetryableAiFailure(last)) {
      return { ...last, usedProviderId: attempt.provider.id, usedModel: attempt.model, attempts: i + 1, httpAttempts }
    }
    // Siguiente del catálogo
  }

  return {
    ...last,
    attempts: chain.length,
    fallbackUsed: chain.length > 1,
    httpAttempts,
    error: last.error || 'Ningún modelo del catálogo respondió.',
    hint:
      last.hint ||
      'Prueba otro modelo en el selector del chat. Si no tienes modelos, pide acceso a tu administrador.',
  }
}

type Preferencias = {
  activeProviderId?: string
  /** Modelo elegido por proveedor. */
  modelos?: Record<string, string>
  temperature?: number
  maxTokens?: number
  fallbackEnabled?: boolean
}

/** Perfil vacío cuando la cuenta no tiene proveedores (nunca está listo). */
export const SIN_PROVEEDOR: AiProviderProfile = {
  id: '',
  kind: 'openai-compatible',
  name: 'Sin modelos disponibles',
  baseUrl: '',
  apiKey: '',
  models: [],
  selectedModel: '',
}

let limpiezaHecha = false

/** Una vez: borra los ajustes antiguos con proveedores locales y sus claves guardadas en el equipo. */
function limpiarAjustesAntiguos(): void {
  if (limpiezaHecha) return
  limpiezaHecha = true
  try {
    for (const k of LEGACY_KEYS) {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const viejos = (JSON.parse(raw) as { providers?: { id?: string }[] }).providers ?? []
      for (const p of viejos) if (p.id && typeof window !== 'undefined') void window.electron?.aiCredSet?.(p.id, '')
      localStorage.removeItem(k)
    }
  } catch {
    /* nada que limpiar */
  }
}

function leerPreferencias(): Preferencias {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Preferencias) : {}
  } catch {
    return {}
  }
}

/** Ajustes efectivos: proveedores del catálogo del backend + preferencias locales. */
export function loadAiSettings(): AiSettings {
  limpiarAjustesAntiguos()
  const pref = leerPreferencias()
  const providers: AiProviderProfile[] = catalogoIA()
    .proveedores.filter((p) => p.activo)
    .map((p) => {
      const elegido = pref.modelos?.[p.id]
      return {
        id: p.id,
        kind: p.tipo as AiProviderKind,
        name: p.origen === 'propio' ? `${p.nombre} (propio)` : p.nombre,
        baseUrl: p.baseUrl ?? '',
        apiKey: '',
        hasApiKey: p.tieneClave,
        models: p.modelos,
        selectedModel: elegido && p.modelos.includes(elegido) ? elegido : p.modeloPorDefecto,
        ...(p.custom ? { custom: p.custom as AiProviderCustom } : {}),
        origen: p.origen,
        ejecucion: p.ejecucion,
      }
    })
  const activeProviderId = providers.some((p) => p.id === pref.activeProviderId) ? pref.activeProviderId! : (providers[0]?.id ?? '')
  return {
    version: 2,
    activeProviderId,
    providers,
    temperature:
      typeof pref.temperature === 'number' && Number.isFinite(pref.temperature) ? Math.max(0, Math.min(2, pref.temperature)) : 0.4,
    maxTokens: typeof pref.maxTokens === 'number' && Number.isFinite(pref.maxTokens) ? Math.max(256, Math.min(128000, pref.maxTokens)) : 2048,
    fallbackEnabled: pref.fallbackEnabled !== false,
  }
}

/** Guarda solo preferencias (el catálogo lo gestiona el backend). */
export function saveAiSettings(settings: AiSettings): void {
  const previas = leerPreferencias()
  const pref: Preferencias = {
    activeProviderId: settings.activeProviderId,
    modelos: { ...(previas.modelos ?? {}), ...Object.fromEntries(settings.providers.filter((p) => p.id).map((p) => [p.id, p.selectedModel])) },
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    fallbackEnabled: settings.fallbackEnabled !== false,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref))
  } catch {
    /* sin almacenamiento */
  }
}

export function getActiveProvider(settings: AiSettings = loadAiSettings()): AiProviderProfile {
  return settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0] ?? SIN_PROVEEDOR
}

export function upsertProviderModel(provider: AiProviderProfile, model: string): AiProviderProfile {
  const name = model.trim()
  if (!name) return provider
  const models = provider.models.includes(name) ? provider.models : [...provider.models, name]
  return { ...provider, models, selectedModel: name }
}

export function formatAiUserError(result: {
  error?: string
  errorCode?: AiErrorCode
  hint?: string
  provider?: string
}): string {
  let errorLine = result.error || 'Error al contactar el proveedor de IA.'
  if (/ReferenceError|TypeError|SyntaxError/.test(errorLine)) {
    errorLine = 'Fallo interno al procesar el turno. Inténtalo de nuevo.'
  }
  if (errorLine.includes('{"error"') || errorLine.includes('"service_unavailable_error"')) {
    const match = errorLine.match(/"message"\s*:\s*"([^"]+)"/)
    if (match?.[1]) errorLine = match[1]
    else if (result.errorCode === 'service_unavailable') errorLine = 'Servicio temporalmente no disponible.'
    else if (result.errorCode === 'rate_limit') errorLine = 'Límite de peticiones del proveedor.'
  }
  const parts = [
    `⚠️ ${errorLine}`,
    result.provider ? `Proveedor: ${result.provider}` : '',
    result.hint ? `Qué hacer: ${result.hint}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

/** Pausa entre fases de razonamiento profundo (evita 503 en gateways con rate limit). */
export function providerReasoningPaceMs(kind: AiProviderKind): number {
  if (kind === 'ollama') return 0
  if (kind === 'kilocode') return 1500
  return 800
}

/** Mensajes amigables por código (también usados en Electron). */
export function hintForErrorCode(code: AiErrorCode, kind?: AiProviderKind): string {
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
        ? 'El gateway Kilo Code limita peticiones seguidas (JasWave hace varias por mensaje). Espera unos segundos entre mensajes.'
        : 'El proveedor está temporalmente saturado. Espera unos segundos e inténtalo de nuevo.'
    case 'model_not_found':
      return 'El modelo no existe o no está disponible en tu cuenta. Verifica el nombre exacto.'
    case 'bad_request':
      return 'Revisa el nombre del modelo, la URL y los parámetros.'
    case 'payment_required':
      return 'Sin crédito en este modelo. Activa Auto (fallback) o elige un modelo gratuito en el selector.'
    case 'empty_response':
      return 'El proveedor respondió vacío. Prueba otro modelo o sube la temperatura.'
    case 'not_available':
      return 'Abre JasWave como app de escritorio (Electron) para usar proveedores en la nube.'
    default:
      return 'Revisa Configuración → IA y vuelve a probar la conexión.'
  }
}
