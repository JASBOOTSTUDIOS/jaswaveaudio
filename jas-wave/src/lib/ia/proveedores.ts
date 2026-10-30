/**
 * Tipos del puente de IA (petición, resultado y salud del gateway) y presets de cada tipo de proveedor.
 * Los usa el núcleo (puente de Electron, panel admin) y los publica a los módulos vía @jaswave/host-sdk.
 */

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
