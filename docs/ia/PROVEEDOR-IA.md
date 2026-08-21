# Abstracción de Proveedor de IA

## 1. Propósito

La abstracción de Proveedor de IA desacopla el AI Harness de cualquier vendedor específico de LLM o runtime local. El núcleo del DAW nunca depende de un modelo específico. Cambiar de proveedor es un cambio de configuración.

## 2. Interfaz Core

```typescript
interface AIProvider {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
  
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
  embeddings?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  
  supportsStreaming(): boolean;
  supportsToolUse(): boolean;
  supportsJSONMode(): boolean;
}

interface ChatRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: TokenUsage;
}

interface StreamChunk {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_stop' | 'done' | 'error';
  delta?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface ProviderCapabilities {
  maxContextWindow: number;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  supportsJSONMode: boolean;
  supportsSystemPrompt: boolean;
}
```

## 3. Adaptadores de Proveedor

### Proveedor Ollama (Local, Prioridad)

Ollama se ejecuta localmente y expone una API compatible con OpenAI. Esto significa que solo necesitamos una implementación de cliente:

```typescript
class OllamaProvider implements AIProvider {
  id = 'ollama';
  name = 'Ollama (Local)';
  capabilities: ProviderCapabilities = {
    maxContextWindow: 8192, // depende del modelo
    supportsVision: false,
    supportsStreaming: true,
    supportsToolUse: true,
    supportsJSONMode: true,
    supportsSystemPrompt: true
  };
  
  private baseUrl: string;
  
  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: 'llama3', // configurable
        messages: this.normalizeMessages(request.messages),
        tools: request.tools?.map(t => this.normalizeTool(t)),
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? 2048
        }
      })
    });
    return this.parseResponse(await response.json());
  }
  
  async stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    // implementación usando fetch + ReadableStream
  }
}
```

**Modelos locales recomendados para MVP:**
- `llama3` (8B) — propósito general, buen uso de herramientas
- `qwen2.5-coder` — bueno para tareas estructuradas
- `gemma2` — modelo abierto de Google
- `mistral` — rendimiento equilibrado

### Adaptadores de Proveedores Remotos

Los proveedores remotos usan la misma interfaz pero con autenticación diferente:

```typescript
class OpenAIProvider implements AIProvider { /* similar, con auth de API key */ }
class AnthropicProvider implements AIProvider { /* similar, con formato de herramientas específico de Claude */ }
class OpenRouterProvider implements AIProvider { /* acceso unificado a muchos modelos */ }
```

## 4. Selección de Proveedor

```typescript
interface ProviderConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'openrouter';
  model: string;
  apiKey?: string; // no necesario para Ollama
  baseUrl?: string; // para Ollama y endpoints personalizados
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
}
```

El usuario selecciona el proveedor en Configuración. El AI Harness instancia el adaptador apropiado.

## 5. Salud del Proveedor

```typescript
interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  latencyMs: number;
  lastChecked: number;
  error?: string;
}
```

El Harness monitorea la salud del proveedor y puede recurrir a un proveedor secundario si el principal no está disponible.

## 6. Estrategia de Fallback

```typescript
interface FallbackPolicy {
  primary: ProviderConfig;
  secondary?: ProviderConfig;
  fallbackOn: ('timeout' | 'error' | 'rate_limit')[];
}
```

Si el proveedor principal falla, la solicitud se reintenta en el proveedor secundario. Se notifica al usuario.

## 7. Gestión de Tokens

```typescript
interface TokenBudget {
  contextWindow: number;
  systemPromptTokens: number;
  toolsTokens: number;
  reservedForResponse: number;
  availableForContext: number;
}
```

El Gestor de Contexto usa `availableForContext` para ensamblar la ventana de contexto.

## 8. Modo JSON

Algunos proveedores soportan un "modo JSON" que fuerza la respuesta a ser JSON válido. El AI Harness usa esto para salidas estructuradas cuando se espera que la IA devuelva llamadas de herramientas o datos estructurados.

## 9. Embeddings (Futuro)

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

Los embeddings se usan para búsqueda semántica sobre memorias e historial de proyectos. No requerido para MVP.

## 10. Sin Bloqueo de Proveedor

Agregar un nuevo proveedor requiere:
1. Implementar `AIProvider`.
2. Agregar un ID de proveedor a `ProviderConfig`.
3. Registrar el proveedor en la Factoría de Proveedores.

No se requieren cambios en el Sistema de Comandos, Bus de Eventos o Capa de Dominio.
