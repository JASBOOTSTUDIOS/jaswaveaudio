# AI Provider

## Objetivo
Definir la abstracción de proveedor de IA y el adapter para Ollama (local). El DAW nunca debe acoplarse a un modelo o proveedor específico; cambiar de proveedor debe ser un cambio de configuración, no de código.

## Criterios de Aceptación
- [x] Interfaz `AIProvider` implementada
- [x] Adapter Ollama funcional (mock para tests)
- [x] Factory de proveedores
- [x] Fallback policy

## Requerimientos Detallados

### 1. Interfaz AIProvider
- Definir interfaz `AIProvider` en `shared/types/ai.ts`:
  - `id: string`
  - `name: string`
  - `capabilities: ProviderCapabilities`
  - `chat(request: ChatRequest): Promise<ChatResponse>`
  - `stream(request: ChatRequest): AsyncIterable<StreamChunk>`
  - `embeddings?(request: EmbeddingRequest): Promise<EmbeddingResponse>` — opcional, futuro
  - `supportsStreaming(): boolean`
  - `supportsToolUse(): boolean`
  - `supportsJSONMode(): boolean`

### 2. Tipos de Request/Response
- `ChatRequest`:
  - `messages: Message[]`
  - `tools?: ToolDefinition[]`
  - `systemPrompt?: string`
  - `temperature?: number`
  - `maxTokens?: number`
  - `stopSequences?: string[]`
- `Message`:
  - `role: 'system' | 'user' | 'assistant' | 'tool'`
  - `content: string`
  - `toolCalls?: ToolCall[]`
  - `toolCallId?: string`
- `ToolCall`:
  - `id: string`
  - `name: string`
  - `arguments: Record<string, unknown>`
- `ChatResponse`:
  - `content: string`
  - `toolCalls?: ToolCall[]`
  - `finishReason: 'stop' | 'tool_calls' | 'length' | 'error'`
  - `usage: TokenUsage`
- `StreamChunk`:
  - `type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_stop' | 'done' | 'error'`
  - `delta?: string`
  - `toolCall?: ToolCall`
  - `usage?: TokenUsage`
- `TokenUsage`: `promptTokens`, `completionTokens`, `totalTokens`

### 3. ProviderCapabilities
- `maxContextWindow: number`
- `supportsVision: boolean`
- `supportsStreaming: boolean`
- `supportsToolUse: boolean`
- `supportsJSONMode: boolean`
- `supportsSystemPrompt: boolean`

### 4. Adapter Ollama (Prioridad Local)
- Implementar `OllamaProvider` en `shared/src/ai/providers/ollama.ts`:
  - `id = 'ollama'`
  - `name = 'Ollama (Local)'`
  - `baseUrl` configurable, default `http://localhost:11434`
  - `chat()` envía POST a `/api/chat` con formato OpenAI-compatible
  - `stream()` usa fetch + ReadableStream para streaming SSE
- Parsear respuesta de Ollama a `ChatResponse`.

### 5. Modelos Locales Recomendados (Documentación)
- `llama3` (8B) — propósito general, buen uso de herramientas
- `qwen2.5-coder` — bueno para tareas estructuradas
- `gemma2` — modelo abierto de Google
- `mistral` — rendimiento equilibrado
- El usuario debe poder elegir modelo, temperatura, max tokens, contexto.

### 6. Provider Factory
- Implementar `ProviderFactory` en `shared/src/ai/factory.ts`:
  - `create(config: ProviderConfig): AIProvider`
  - `register(id: string, factory: () => AIProvider): void`
- `ProviderConfig`:
  - `provider: 'ollama' | 'openai' | 'anthropic' | 'openrouter'`
  - `model: string`
  - `apiKey?: string`
  - `baseUrl?: string`
  - `temperature: number`
  - `maxTokens: number`
  - `systemPrompt?: string`

### 7. Fallback Policy
- Definir `FallbackPolicy`:
  - `primary: ProviderConfig`
  - `secondary?: ProviderConfig`
  - `fallbackOn: ('timeout' | 'error' | 'rate_limit')[]`
- Si el proveedor principal falla, reintentar en el secundario.
- Notificar al usuario del fallback.

### 8. Provider Health
- Definir `ProviderHealth`:
  - `provider: string`
  - `status: 'healthy' | 'degraded' | 'unavailable'`
  - `latencyMs: number`
  - `lastChecked: number`
  - `error?: string`
- Monitorear salud periódicamente.

**Estado**: ✅ Completado

### 10. Token Budget
- Definido en `shared/src/types/contexto.ts` como `ContextBudget` con campos: `maxTokens`, `level1Tokens`, `level2Tokens`, `level3Tokens`, `level4Tokens`, `level5Tokens`, `toolsTokens`, `capabilitiesTokens`.
- El Context Manager usa `maxTokens` y calcula `availableForContext` implícitamente restando niveles y herramientas.
- Nota: no existe clase `TokenBudget` separada; la responsabilidad está en `ContextBudget` + lógica de `ensamblar()`.

**Estado**: ✅ Completado
**Archivos**: `shared/src/types/contexto.ts`, `shared/src/ai/context-manager.ts`

### 11. JSON Mode
- Soportado a nivel de tipos (`supportsJSONMode` en `ProviderCapabilities`).
- Implementado forcing JSON en `OllamaProvider.chat()` mediante `format: 'json'`.

**Estado**: ✅ Completado
**Archivos**: `shared/src/types/ia.ts`, `shared/src/ai/providers/ollama.ts`

### 12. Embeddings
- Tipos definidos: `EmbeddingRequest`, `EmbeddingResponse` en `shared/src/types/ia.ts`.
- `OllamaProvider.embeddings()` implementado contra `/api/embeddings` con soporte de input simple o array.

**Estado**: ✅ Completado
**Archivos**: `shared/src/types/ia.ts`, `shared/src/ai/providers/ollama.ts`, `shared/src/test/ai-provider.test.ts`

### 13. Sin Bloqueo de Proveedor
- Agregar un nuevo proveedor requiere:
  1. Implementar `AIProvider`
  2. Agregar ID a `ProviderConfig`
  3. Registrar en `ProviderFactory`
- No se requieren cambios en Command System, Event Bus o Domain Layer.

**Estado**: ✅ Completado

## Implementación Runtime

### 14. Tipos Base
- [x] `AIProvider`, `ProviderCapabilities`, `ChatRequest`, `ChatResponse`, `StreamChunk`, `TokenUsage`, `FallbackPolicy` en `shared/src/types/ia.ts`
- [x] `ProviderConfig`, `ProviderId`, `EmbeddingRequest`, `EmbeddingResponse`, `Message`, `ToolCall`

### 15. Adapter Ollama
- [x] `OllamaProvider` en `shared/src/ai/providers/ollama.ts` con `chat`, `stream`, `embeddings` y capacidades.
- [x] Normalización de mensajes y parseo de respuestas Ollama.

### 16. Factory y Fallback
- [x] `ProviderFactory` en `shared/src/ai/factory.ts` con `create` y `register`.
- [x] `FallbackProvider` en `shared/src/ai/factory.ts` con política de fallback entre primary y secondary.
- [x] `providerFactory` singleton exportado.

### 17. Tests
- [x] Tests unitarios en `shared/src/test/ai-provider.test.ts` — 11 tests cubriendo OllamaProvider, factory y fallback.

## Dependencias
- Tool Registry (opcional, para tool calling)
- Context Manager

## Documentación Relacionada
- `docs/ia/PROVEEDOR-IA.md`
- `docs/arquitectura/VISION-GENERAL.md`
- `docs/00-RESUMEN-ARQUITECTURA.md`
