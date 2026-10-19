/**
 * Configuración multi-proveedor de IA (OpenAI, Anthropic, Gemini, Ollama, KiloCode, etc.).
 * Persistida en localStorage. Las claves API viven solo en el escritorio local.
 *
 * Los presets son plantillas. Cualquier proveedor no listado se integra como
 * `openai-compatible` + `custom` (URL, paths, auth, headers, modelos propios).
 */

export type AiProviderKind =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'kilocode'
  | 'openai-compatible'

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
}

export type AiProviderProfile = {
  id: string
  kind: AiProviderKind
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  selectedModel: string
  /** Config libre para proveedores fuera del catálogo preset. */
  custom?: AiProviderCustom
  /** Último health check (para el catálogo «funcionando»). */
  lastHealth?: 'healthy' | 'disconnected' | 'misconfigured' | 'unknown'
  lastHealthAt?: number
  /** Modelos reportados por el endpoint en el último health OK. */
  discoveredModels?: string[]
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

/** Payload unificado hacia Electron. */
export type AiChatRequest = {
  messages: Array<{ role: string; content: string }>
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

const STORAGE_KEY = 'jaswave-ai-settings-v2'
const LEGACY_KEY = 'jaswave-ai-settings-v1'

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
  opts: { temperature: number; maxTokens: number; model?: string },
): AiChatRequest {
  return {
    messages,
    kind: provider.kind,
    model: opts.model?.trim() || provider.selectedModel,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    custom: provider.custom,
  }
}

export function toAiHealthPayload(provider: AiProviderProfile): AiHealthRequest {
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    custom: provider.custom,
  }
}

export function providerIsReady(provider: AiProviderProfile): boolean {
  if (!String(provider.baseUrl || '').trim()) return false
  if (!String(provider.selectedModel || provider.models[0] || '').trim()) return false
  if (providerNeedsApiKey(provider) && !String(provider.apiKey || '').trim()) return false
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
        [
          p.selectedModel,
          ...(p.discoveredModels ?? []),
          ...p.models,
          ...PROVIDER_PRESETS[p.kind].suggestedModels,
        ].filter(Boolean),
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
  if (result.success && result.content?.trim()) return false
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
      error: 'No hay modelos configurados listos en el catálogo.',
      errorCode: 'missing_model',
      hint: 'Añade un proveedor en Configuración → IA y elige un modelo.',
    }
  }

  let last: AiChatResult = {
    success: false,
    error: 'Sin intentos',
    errorCode: 'unknown',
  }

  for (let i = 0; i < chain.length; i++) {
    if (opts.abort?.aborted) {
      return { success: false, error: 'Abortado', errorCode: 'unknown', attempts: i }
    }
    const attempt = chain[i]!
    opts.onAttempt?.({ label: attempt.label, index: i, total: chain.length })
    const req = toAiChatPayload(attempt.provider, messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      model: attempt.model,
    })
    try {
      last = await chat(req)
    } catch (e) {
      last = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        errorCode: 'connection',
        provider: attempt.provider.kind,
      }
    }
    if (last.success && last.content?.trim()) {
      return {
        ...last,
        usedProviderId: attempt.provider.id,
        usedModel: attempt.model,
        attempts: i + 1,
        fallbackUsed: i > 0,
        model: attempt.model,
        provider: attempt.provider.kind,
      }
    }
    if (!isRetryableAiFailure(last)) {
      return { ...last, usedProviderId: attempt.provider.id, usedModel: attempt.model, attempts: i + 1 }
    }
    // Siguiente del catálogo
  }

  return {
    ...last,
    attempts: chain.length,
    fallbackUsed: chain.length > 1,
    error: last.error || 'Ningún modelo del catálogo respondió.',
    hint:
      last.hint ||
      'Prueba otro modelo en el selector del chat o revisa API keys en Configuración → IA.',
  }
}

function createDefaultSettings(): AiSettings {
  const ollama = createProviderProfile('ollama')
  return {
    version: 2,
    activeProviderId: ollama.id,
    providers: [ollama],
    temperature: 0.4,
    maxTokens: 2048,
    fallbackEnabled: true,
  }
}

function migrateFromV1(raw: string): AiSettings | null {
  try {
    const parsed = JSON.parse(raw) as {
      baseUrl?: string
      selectedModel?: string
      customModels?: string[]
      temperature?: number
    }
    const ollama = createProviderProfile('ollama', {
      baseUrl: parsed.baseUrl,
      selectedModel: parsed.selectedModel,
      models: Array.isArray(parsed.customModels)
        ? [
            ...new Set(
              [...(parsed.customModels ?? []), parsed.selectedModel ?? 'llama3.2'].filter(Boolean) as string[],
            ),
          ]
        : undefined,
    })
    return {
      version: 2,
      activeProviderId: ollama.id,
      providers: [ollama],
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.4,
      maxTokens: 2048,
    }
  } catch {
    return null
  }
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiSettings>
      if (parsed.version === 2 && Array.isArray(parsed.providers) && parsed.providers.length > 0) {
        const providers = parsed.providers.map((p) => ({
          ...createProviderProfile((p.kind as AiProviderKind) || 'ollama', {
            ...p,
            custom: p.custom,
          }),
          id: p.id || newId(),
        }))
        const activeProviderId = providers.some((p) => p.id === parsed.activeProviderId)
          ? (parsed.activeProviderId as string)
          : providers[0]!.id
        return {
          version: 2,
          activeProviderId,
          providers,
          temperature:
            typeof parsed.temperature === 'number' && Number.isFinite(parsed.temperature)
              ? Math.max(0, Math.min(2, parsed.temperature))
              : 0.4,
          maxTokens:
            typeof parsed.maxTokens === 'number' && Number.isFinite(parsed.maxTokens)
              ? Math.max(256, Math.min(128000, parsed.maxTokens))
              : 2048,
          fallbackEnabled: parsed.fallbackEnabled !== false,
        }
      }
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const migrated = migrateFromV1(legacy)
      if (migrated) {
        saveAiSettings(migrated)
        return migrated
      }
    }
  } catch {
    /* fallthrough */
  }
  return createDefaultSettings()
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function getActiveProvider(settings: AiSettings = loadAiSettings()): AiProviderProfile {
  return settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0]!
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
