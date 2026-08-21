/**
 * Configuración multi-proveedor de IA (OpenAI, Anthropic, Gemini, Ollama, KiloCode, etc.).
 * Persistida en localStorage. Las claves API viven solo en el escritorio local.
 */

export type AiProviderKind =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'kilocode'
  | 'openai-compatible'

export type AiProviderProfile = {
  id: string
  kind: AiProviderKind
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  selectedModel: string
}

export type AiSettings = {
  version: 2
  activeProviderId: string
  providers: AiProviderProfile[]
  temperature: number
  maxTokens: number
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
}

export type AiHealthRequest = {
  kind: AiProviderKind
  baseUrl: string
  apiKey?: string
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
  | 'model_not_found'
  | 'bad_request'
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
    defaultBaseUrl: 'https://api.kilo.ai/v1',
    defaultModel: 'kilocode/default',
    needsApiKey: true,
    hint: 'API compatible con OpenAI. Ajusta la URL si tu despliegue es distinto.',
    suggestedModels: ['kilocode/default'],
  },
  'openai-compatible': {
    label: 'Compatible OpenAI (cualquier proveedor)',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
    needsApiKey: false,
    hint: 'LM Studio, vLLM, Together, Fireworks, Azure OpenAI, etc. Endpoint /v1/chat/completions.',
    suggestedModels: ['local-model'],
  },
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createProviderProfile(
  kind: AiProviderKind,
  overrides?: Partial<AiProviderProfile>,
): AiProviderProfile {
  const preset = PROVIDER_PRESETS[kind]
  return {
    id: overrides?.id ?? newId(),
    kind,
    name: overrides?.name ?? preset.label,
    baseUrl: overrides?.baseUrl ?? preset.defaultBaseUrl,
    apiKey: overrides?.apiKey ?? '',
    models: overrides?.models ?? [...preset.suggestedModels],
    selectedModel: overrides?.selectedModel ?? preset.defaultModel,
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
        ? [...new Set([...(parsed.customModels ?? []), parsed.selectedModel ?? 'llama3.2'].filter(Boolean) as string[])]
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
          ...createProviderProfile((p.kind as AiProviderKind) || 'ollama', p),
          id: p.id || newId(),
        }))
        const activeProviderId =
          providers.some((p) => p.id === parsed.activeProviderId)
            ? (parsed.activeProviderId as string)
            : providers[0].id
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
  return settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0]
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
  const parts = [
    `⚠️ ${result.error || 'Error al contactar el proveedor de IA.'}`,
    result.provider ? `Proveedor: ${result.provider}` : '',
    result.hint ? `Qué hacer: ${result.hint}` : '',
  ].filter(Boolean)
  return parts.join('\n')
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
      return 'Límite de peticiones alcanzado. Espera unos segundos e inténtalo de nuevo.'
    case 'model_not_found':
      return 'El modelo no existe o no está disponible en tu cuenta. Verifica el nombre exacto.'
    case 'bad_request':
      return 'Revisa el nombre del modelo, la URL y los parámetros.'
    case 'empty_response':
      return 'El proveedor respondió vacío. Prueba otro modelo o sube la temperatura.'
    case 'not_available':
      return 'Abre JasWave como app de escritorio (Electron) para usar proveedores en la nube.'
    default:
      return 'Revisa Configuración → IA y vuelve a probar la conexión.'
  }
}
