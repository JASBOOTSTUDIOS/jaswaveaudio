/**
 * Tipos del dominio de IA del DAW.
 *
 * Propósito:
 *   Definir contratos para proveedores de IA, requests, responses,
 *   capacidades y políticas de fallback, manteniendo el DAW core
 *   desacoplado de implementaciones concretas.
 *
 * Importancia:
 *   - Garantiza que el DAW nunca dependa de un proveedor específico.
 *   - Facilita testing con mocks.
 *   - Permite cambiar de proveedor por configuración.
 *
 * Función:
 *   Exporta AIProvider, ProviderCapabilities, ChatRequest, ChatResponse,
 *   StreamChunk, TokenUsage, FallbackPolicy y tipos relacionados.
 */

import type { ToolDefinition } from './command';

export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'openrouter';

export interface ProviderCapabilities {
  maxContextWindow: number;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  supportsJSONMode: boolean;
  supportsSystemPrompt: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  jsonMode?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: TokenUsage;
}

export type StreamChunkType = 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_stop' | 'done' | 'error';

export interface StreamChunk {
  type: StreamChunkType;
  delta?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: TokenUsage;
}

export interface AIProvider {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;

  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
  embeddings?(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  supportsStreaming(): boolean;
  supportsToolUse(): boolean;
  supportsJSONMode(): boolean;
  getHealth(): ProviderHealth;
}

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface FallbackPolicy {
  primary: ProviderConfig;
  secondary?: ProviderConfig;
  fallbackOn: ('timeout' | 'error' | 'rate_limit')[];
}

export interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  latencyMs: number;
  lastChecked: number;
  error?: string;
}
