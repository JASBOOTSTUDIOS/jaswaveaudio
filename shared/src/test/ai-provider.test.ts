/**
 * Tests de AI Provider (Ollama adapter, factory y fallback).
 */

import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '../ai/providers/ollama';
import { crearProviderFactory, providerFactory, FallbackProvider } from '../ai/factory';
import type { ChatRequest, AIProvider, ProviderConfig } from '../types/ia';

function mockEmbeddingsSuccess(embeddings: number[][]): void {
  let callIndex = 0;
  globalThis.fetch = vi.fn(() => {
    const currentIndex = Math.min(callIndex, embeddings.length - 1);
    callIndex++;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ embedding: embeddings[currentIndex] }),
      text: () => Promise.resolve(JSON.stringify({ embedding: embeddings[currentIndex] })),
      headers: new Map(),
      body: null,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      clone: () => ({} as Response),
      formData: () => Promise.resolve(new FormData()),
      redirected: false,
      type: 'default',
      url: '',
      signal: new AbortController().signal,
    } as unknown as Response);
  }) as never;
}

function mockFetchSuccess(body: unknown): void {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      headers: new Map(),
      body: null,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      clone: () => ({} as Response),
      formData: () => Promise.resolve(new FormData()),
      redirected: false,
      type: 'default',
      url: '',
      signal: new AbortController().signal,
    } as unknown as Response)
  ) as never;
}

function mockFetchError(status: number, text: string): void {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({ error: text }),
      text: () => Promise.resolve(text),
      headers: new Map(),
      body: null,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      clone: () => ({} as Response),
      formData: () => Promise.resolve(new FormData()),
      redirected: false,
      type: 'default',
      url: '',
      signal: new AbortController().signal,
    } as unknown as Response)
  ) as never;
}

function mockFetchStream(lines: Array<Record<string, unknown>>): void {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
      }
      controller.close();
    },
  });

  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(lines[lines.length - 1]),
      text: () => Promise.resolve(lines.map(l => JSON.stringify(l)).join('\n')),
      headers: new Map(),
      body: stream,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      clone: () => ({} as Response),
      formData: () => Promise.resolve(new FormData()),
      redirected: false,
      type: 'default',
      url: '',
      signal: new AbortController().signal,
    } as unknown as Response)
  ) as never;
}

describe('OllamaProvider', () => {
  it('deberia tener capabilities por defecto', () => {
    const provider = new OllamaProvider();
    expect(provider.id).toBe('ollama');
    expect(provider.name).toBe('Ollama (Local)');
    expect(provider.capabilities.supportsStreaming).toBe(true);
    expect(provider.capabilities.supportsToolUse).toBe(true);
    expect(provider.capabilities.supportsSystemPrompt).toBe(true);
  });

  it('deberia hacer chat correctamente', async () => {
    mockFetchSuccess({
      message: { role: 'assistant', content: 'Hola desde Ollama' },
      done: true,
      prompt_eval_count: 10,
      eval_count: 5,
    });

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'llama3' });
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hola' }],
      temperature: 0.5,
      maxTokens: 100,
    };

    const response = await provider.chat(request);
    expect(response.content).toBe('Hola desde Ollama');
    expect(response.usage.promptTokens).toBe(10);
    expect(response.usage.completionTokens).toBe(5);
    expect(response.finishReason).toBe('stop');
  });

  it('deberia lanzar error cuando Ollama responde con error', async () => {
    mockFetchError(500, 'Internal Server Error');

    const provider = new OllamaProvider();
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hola' }],
    };

    await expect(provider.chat(request)).rejects.toThrow('Ollama error 500');
  });

  it('deberia hacer stream correctamente', async () => {
    mockFetchStream([
      { message: { content: 'Hola' }, done: false },
      { message: { content: ' mundo' }, done: false },
      { message: { content: '!' }, done: true, eval_count: 3, prompt_eval_count: 5 },
    ]);

    const provider = new OllamaProvider();
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hola' }],
    };

    const result: string[] = [];
    for await (const chunk of provider.stream(request)) {
      if (chunk.type === 'text_delta' && chunk.delta) {
        result.push(chunk.delta);
      }
    }

    expect(result.join('')).toBe('Hola mundo!');
  });

  it('deberia calcular embeddings correctamente', async () => {
    mockEmbeddingsSuccess([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'llama3' });
    const response = await provider.embeddings({ input: ['texto uno', 'texto dos'], model: 'llama3' });

    expect(response.embeddings).toHaveLength(2);
    expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    expect(response.embeddings[1]).toEqual([0.4, 0.5, 0.6]);
    expect(response.model).toBe('llama3');
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it('deberia usar el modelo por defecto cuando embeddings no recibe modelo', async () => {
    mockEmbeddingsSuccess([[0.9]]);

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'llama3' });
    const response = await provider.embeddings({ input: 'texto' });

    expect(response.embeddings).toHaveLength(1);
    expect(response.model).toBe('llama3');
  });

  it('deberia lanzar error cuando embeddings falla', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'fail' }),
        text: () => Promise.resolve('fail'),
        headers: new Map(),
        body: null,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        clone: () => ({} as Response),
        formData: () => Promise.resolve(new FormData()),
        redirected: false,
        type: 'default',
        url: '',
        signal: new AbortController().signal,
      } as unknown as Response)
    ) as never;

    const provider = new OllamaProvider();
    await expect(provider.embeddings({ input: 'test' })).rejects.toThrow('Ollama embeddings error 500');
  });
});

describe('ProviderFactory', () => {
  it('deberia registrar y crear proveedores', () => {
    const factory = crearProviderFactory();
    factory.register('ollama', () => new OllamaProvider());

    const provider = factory.create({ provider: 'ollama', model: 'llama3' });
    expect(provider.id).toBe('ollama');
  });

  it('deberia lanzar error para proveedor no registrado', () => {
    const factory = crearProviderFactory();
    expect(() => factory.create({ provider: 'openai', model: 'gpt-4' })).toThrow('Proveedor no registrado');
  });

  it('deberia usar providerFactory global', () => {
    const mockProvider: AIProvider = {
      id: 'test',
      name: 'Test',
      capabilities: { maxContextWindow: 0, supportsVision: false, supportsStreaming: false, supportsToolUse: false, supportsJSONMode: false, supportsSystemPrompt: false },
      chat: async () => ({ content: '', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
      stream: async function* () {},
      supportsStreaming: () => false,
      supportsToolUse: () => false,
      supportsJSONMode: () => false,
      getHealth: () => ({ provider: 'test', status: 'healthy', latencyMs: 0, lastChecked: Date.now() }),
    };
    providerFactory.register('test', () => mockProvider);
    const provider = providerFactory.create({ provider: 'test', model: 'test' } as unknown as ProviderConfig);
    expect(provider.id).toBe('test');
  });
});

describe('FallbackProvider', () => {
  it('deberia usar proveedor primario cuando funciona', async () => {
    mockFetchSuccess({
      message: { role: 'assistant', content: 'ok' },
      done: true,
      prompt_eval_count: 1,
      eval_count: 1,
    });

    const factory = crearProviderFactory();
    factory.register('ollama', () => new OllamaProvider());

    const fallback = new FallbackProvider({
      policy: {
        primary: { provider: 'ollama', model: 'llama3' },
        fallbackOn: ['error'],
      },
      factory,
    });

    const response = await fallback.chat({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.content).toBe('ok');
  });

  it('deberia hacer fallback cuando primario falla', async () => {
    mockFetchError(500, 'fail');

    const factory = crearProviderFactory();
    factory.register('ollama', () => new OllamaProvider());

    const fallback = new FallbackProvider({
      policy: {
        primary: { provider: 'ollama', model: 'llama3' },
        secondary: { provider: 'ollama', model: 'llama3' },
        fallbackOn: ['error'],
      },
      factory,
    });

    await expect(fallback.chat({ messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow('Todos los proveedores fallaron');
  });

  it('deberia lanzar error cuando no hay secundario', async () => {
    mockFetchError(500, 'fail');

    const factory = crearProviderFactory();
    factory.register('ollama', () => new OllamaProvider());

    const fallback = new FallbackProvider({
      policy: {
        primary: { provider: 'ollama', model: 'llama3' },
        fallbackOn: ['error'],
      },
      factory,
    });

    await expect(fallback.chat({ messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow('Fallback falló');
  });
});
