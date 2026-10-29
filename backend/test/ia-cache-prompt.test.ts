import { describe, expect, it } from 'vitest';
import { admiteCachePrompt, buildProviderRequest, type AiChatRequest } from '../src/ia/gateway/ai-gateway.js';

const base = (o: Partial<AiChatRequest>): AiChatRequest => ({
  kind: 'openrouter',
  model: 'anthropic/claude-haiku-5.5',
  baseUrl: 'https://openrouter.ai/api',
  apiKey: 'k',
  messages: [
    { role: 'system', content: 'SISTEMA estable' },
    { role: 'user', content: 'encargo' },
    { role: 'assistant', content: '' },
    { role: 'user', content: 'último' },
  ],
  tools: [{ name: 'track.list', description: 'd', parameters: { type: 'object', properties: {} } }],
  ...o,
});

describe('caché de prompt (cache_control)', () => {
  it('Claude vía OpenRouter marca el sistema y el primer mensaje del usuario, y nada más', () => {
    const { body } = buildProviderRequest(base({}));
    const m = body.messages as Array<{ role: string; content: unknown }>;
    expect(m[0]!.content).toEqual([{ type: 'text', text: 'SISTEMA estable', cache_control: { type: 'ephemeral' } }]);
    expect(m[1]!.content).toEqual([{ type: 'text', text: 'encargo', cache_control: { type: 'ephemeral' } }]);
    expect(m[3]!.content).toBe('último');
  });
  it('otros modelos o peticiones sin herramientas no cambian (DeepSeek cachea el prefijo solo)', () => {
    const r = base({ model: 'deepseek/deepseek-v4.1-flash' });
    expect(admiteCachePrompt(r, 'openai')).toBe(false);
    expect((buildProviderRequest(r).body.messages as Array<{ content: unknown }>)[0]!.content).toBe('SISTEMA estable');
    expect(admiteCachePrompt(base({ tools: undefined }), 'openai')).toBe(false);
  });
  it('Anthropic directo: sistema y última herramienta con cache_control', () => {
    const { body } = buildProviderRequest(base({ kind: 'anthropic', model: 'claude-haiku-5.5', baseUrl: 'https://api.anthropic.com' }));
    expect(body.system).toEqual([{ type: 'text', text: 'SISTEMA estable', cache_control: { type: 'ephemeral' } }]);
    const tools = body.tools as Array<{ cache_control?: unknown }>;
    expect(tools[tools.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
  });
});
