/**
 * Factory de proveedores de IA con soporte de fallback.
 *
 * Propósito:
 *   Crear y registrar proveedores de IA desacoplados del DAW core,
 *   permitiendo cambio de proveedor por configuración.
 *
 * Importancia:
 *   - Centraliza la creación de proveedores.
 *   - Implementa fallback automático entre proveedores.
 *   - Cumple ADR-0004: sin acoplamiento a proveedores concretos.
 *
 * Función:
 *   Exporta ProviderFactory y FallbackProvider que envuelve la
 *   política de fallback.
 */

import type { AIProvider, ProviderConfig, FallbackPolicy, ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse, ProviderHealth } from '../types/ia';

export interface ProviderFactory {
  create(config: ProviderConfig): AIProvider;
  register(id: string, factory: () => AIProvider): void;
}

export function crearProviderFactory(): ProviderFactory {
  const factories = new Map<string, () => AIProvider>();

  return {
    create(config: ProviderConfig): AIProvider {
      const factory = factories.get(config.provider);
      if (!factory) {
        throw new Error(`Proveedor no registrado: ${config.provider}`);
      }
      return factory();
    },

    register(id: string, factory: () => AIProvider): void {
      factories.set(id, factory);
    },
  };
}

export const providerFactory = crearProviderFactory();

export interface FallbackProviderOptions {
  policy: FallbackPolicy;
  factory?: ProviderFactory;
}

export class FallbackProvider implements AIProvider {
  readonly id = 'fallback';
  readonly name = 'Fallback Provider';

  private policy: FallbackPolicy;
  private factory: ProviderFactory;
  private primary: AIProvider;
  private secondary?: AIProvider;

  constructor(opciones: FallbackProviderOptions) {
    this.policy = opciones.policy;
    this.factory = opciones.factory ?? providerFactory;
    this.primary = this.factory.create(opciones.policy.primary);
    this.secondary = opciones.policy.secondary ? this.factory.create(opciones.policy.secondary) : undefined;
  }

  get capabilities() {
    return this.primary.capabilities;
  }

  supportsStreaming(): boolean {
    return this.primary.supportsStreaming();
  }

  supportsToolUse(): boolean {
    return this.primary.supportsToolUse();
  }

  supportsJSONMode(): boolean {
    return this.primary.supportsJSONMode();
  }

  getHealth(): ProviderHealth {
    return this.primary.getHealth();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const errores: Array<{ provider: string; error: unknown }> = [];

    try {
      const result = await this.primary.chat(request);
      if (this.shouldFallback(result)) {
        return this.trySecondary(request, errores);
      }
      return result;
    } catch (error) {
      errores.push({ provider: this.primary.id, error });
      return this.trySecondary(request, errores);
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const errores: Array<{ provider: string; error: unknown }> = [];

    try {
      let primera = true;
      for await (const chunk of this.primary.stream(request)) {
        if (primera) {
          primera = false;
          if (chunk.type === 'error') {
            throw new Error(chunk.delta ?? 'Error en stream primario');
          }
        }
        yield chunk;
        if (chunk.type === 'done') return;
      }
      return;
    } catch (error) {
      errores.push({ provider: this.primary.id, error });
    }

    if (!this.secondary) {
      yield { type: 'error', delta: 'Sin proveedor secundario disponible' };
      return;
    }

    try {
      for await (const chunk of this.secondary.stream(request)) {
        yield chunk;
        if (chunk.type === 'done') return;
      }
    } catch (error) {
      errores.push({ provider: this.secondary.id, error });
      yield { type: 'error', delta: 'Fallback también falló' };
    }
  }

  async embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (this.primary.embeddings) {
      return this.primary.embeddings(request);
    }
    if (this.secondary?.embeddings) {
      return this.secondary.embeddings(request);
    }
    throw new Error('Ningún proveedor soporta embeddings');
  }

  private shouldFallback(result: ChatResponse): boolean {
    if (!this.policy.fallbackOn.includes('error')) return false;
    return result.finishReason === 'error';
  }

  private async trySecondary(request: ChatRequest, errores: Array<{ provider: string; error: unknown }>): Promise<ChatResponse> {
    if (!this.secondary) {
      const ultimo = errores[errores.length - 1]?.error ?? new Error('Sin proveedor secundario');
      throw new Error(`Fallback falló: ${JSON.stringify(errores)}. Causa: ${ultimo instanceof Error ? ultimo.message : String(ultimo)}`);
    }

    try {
      return await this.secondary.chat(request);
    } catch (error) {
      errores.push({ provider: this.secondary.id, error });
      throw new Error(`Todos los proveedores fallaron: ${JSON.stringify(errores)}`);
    }
  }
}
