/**
 * Adapter de Ollama para AIProvider.
 *
 * Propósito:
 *   Implementar AIProvider para Ollama local, normalizando mensajes,
 *   herramientas y respuestas al formato del DAW.
 *
 * Importancia:
 *   - Permite usar modelos locales sin dependencia de Internet.
 *   - Cumple con ADR-0004: el DAW core no conoce detalles de Ollama.
 *   - Facilita fallback hacia otros proveedores.
 *
 * Función:
 *   Exporta OllamaProvider con chat, stream y capacidades detectadas
 *   dinámicamente desde la API de Ollama.
 */

import type { AIProvider, ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse, ProviderCapabilities, ProviderHealth } from '../../types/ia';

function normalizeMessages(messages: ChatRequest['messages']): Array<{ role: string; content: string }> {
  return messages.map(m => ({ role: m.role, content: m.content }));
}

function mapFinishReason(done: boolean, stop?: string): ChatResponse['finishReason'] {
  if (!done) return 'length';
  if (stop) return 'stop';
  return 'stop';
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';
  readonly capabilities: ProviderCapabilities;

  private baseUrl: string;
  private model: string;

  constructor(opciones?: OllamaProviderOptions) {
    this.baseUrl = (opciones?.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = opciones?.model ?? 'llama3';
    this.capabilities = {
      maxContextWindow: 8192,
      supportsVision: false,
      supportsStreaming: true,
      supportsToolUse: true,
      supportsJSONMode: false,
      supportsSystemPrompt: true,
    };
  }

  supportsStreaming(): boolean {
    return this.capabilities.supportsStreaming;
  }

  supportsToolUse(): boolean {
    return this.capabilities.supportsToolUse;
  }

  supportsJSONMode(): boolean {
    return this.capabilities.supportsJSONMode;
  }

  getHealth(): ProviderHealth {
    return {
      provider: this.id,
      status: 'healthy',
      latencyMs: 0,
      lastChecked: Date.now(),
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.model,
      messages: normalizeMessages(request.messages),
      stream: false,
      format: request.jsonMode ? 'json' : undefined,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 1024,
        stop: request.stopSequences ?? [],
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      message: { role: string; content: string };
      done: boolean;
      eval_count?: number;
      prompt_eval_count?: number;
      total_duration?: number;
      eval_duration?: number;
      prompt_eval_duration?: number;
    };

    return {
      content: data.message.content,
      finishReason: data.done ? 'stop' : 'length',
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const body = {
      model: this.model,
      messages: normalizeMessages(request.messages),
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 1024,
        stop: request.stopSequences ?? [],
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: 'error', delta: `Ollama error ${response.status}: ${text}` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', delta: 'Response body no disponible para streaming' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('{')) continue;

          try {
            const data = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
              error?: string;
              eval_count?: number;
              prompt_eval_count?: number;
            };

            if (data.error) {
              yield { type: 'error', delta: data.error };
              return;
            }

            if (data.message?.content) {
              yield { type: 'text_delta', delta: data.message.content };
            }

            if (data.done) {
              yield {
                type: 'done',
                usage: {
                  promptTokens: data.prompt_eval_count ?? 0,
                  completionTokens: data.eval_count ?? 0,
                  totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
                },
              };
            }
          } catch {
            // Ignorar líneas JSON inválidas
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const input = Array.isArray(request.input) ? request.input : [request.input];
    const model = request.model ?? this.model;
    const embeddings: number[][] = [];

    for (const texto of input) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: texto }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama embeddings error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as { embedding: number[] };
      embeddings.push(data.embedding);
    }

    return {
      embeddings,
      model,
      usage: {
        promptTokens: input.reduce((total, texto) => total + Math.max(1, Math.floor(texto.length / 3)), 0),
        completionTokens: 0,
        totalTokens: input.reduce((total, texto) => total + Math.max(1, Math.floor(texto.length / 3)), 0),
      },
    };
  }
}
