import { describe, expect, it } from 'vitest';
import type { AiChatRequest, AiChatResult } from '../src/ia/gateway/ai-gateway.js';
import { crearEnrutador, extraRazonamiento, type ChatDirecto, type Intento } from '../src/ia/jaswave/enrutador.js';
import { creditosDe, falloPublico } from '../src/ia/jaswave/servicio.js';
import { periodosDe } from '../src/ia/jaswave/periodos.js';

const intento = (modelo: string, claves = ['k1'], razonamiento: Intento['razonamiento'] = 'off'): Intento => ({
  conexionId: 'c1',
  modelo,
  razonamiento,
  kind: 'kilocode',
  baseUrl: 'https://ejemplo.test/api',
  claves: claves.map((id) => ({ id, apiKey: `secreto-${id}` })),
});
const base = { messages: [{ role: 'user' as const, content: 'hola' }] };
const espera = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

type Guion = (req: AiChatRequest, signal?: AbortSignal, onDelta?: (t: string) => void) => Promise<AiChatResult>;
function falso(guion: Record<string, Guion>) {
  const llamadas: AiChatRequest[] = [];
  const chat: ChatDirecto = async (req, o) => {
    llamadas.push(req);
    const g = guion[req.model];
    if (!g) return { success: false, errorCode: 'model_not_found', error: 'no existe' };
    const r = await g(req, o.signal, o.onDelta);
    return o.signal?.aborted ? { success: false, errorCode: 'cancelled', error: 'cancelada' } : r;
  };
  return { chat, llamadas };
}
const ok = (content: string, usage?: { entrada: number; salida: number }): AiChatResult => ({ success: true, content, ...(usage ? { usage } : {}) });

describe('enrutador de JasWave IA', () => {
  it('el primero que responde gana; no se lanzan más intentos', async () => {
    const f = falso({ a: async () => ok('A', { entrada: 10, salida: 5 }), b: async () => ok('B') });
    const r = await crearEnrutador({ chat: f.chat }).ejecutar([intento('a'), intento('b')], base);
    expect(r.resultado.content).toBe('A');
    expect(r.usage).toEqual({ entrada: 10, salida: 5 });
    expect(f.llamadas.map((l) => l.model)).toEqual(['a']);
  });

  it('cubre con el siguiente si el primero tarda, y cancela al lento', async () => {
    let abortadoA = false;
    const f = falso({
      a: async (_r, s) => {
        s?.addEventListener('abort', () => (abortadoA = true));
        await espera(500, s);
        return ok('A');
      },
      b: async () => ok('B'),
    });
    const r = await crearEnrutador({ chat: f.chat }).ejecutar([intento('a'), intento('b')], base, { cubrirTrasMs: 30 });
    expect(r.resultado.content).toBe('B');
    expect(r.ganador?.modelo).toBe('b');
    expect(abortadoA).toBe(true);
  });

  it('si un intento falla, el siguiente arranca en el acto', async () => {
    const f = falso({ a: async () => ({ success: false, errorCode: 'empty_response', error: 'vacío' }), b: async () => ok('B') });
    const t0 = Date.now();
    const r = await crearEnrutador({ chat: f.chat }).ejecutar([intento('a'), intento('b')], base, { cubrirTrasMs: 10_000 });
    expect(r.resultado.content).toBe('B');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('un 429 enfría la clave y reintenta el mismo modelo con otra; la siguiente petición evita la enfriada', async () => {
    const f = falso({
      a: async (req) => (req.apiKey === 'secreto-k1' ? { success: false, errorCode: 'rate_limit', error: '429' } : ok(`con ${req.apiKey}`)),
    });
    const e = crearEnrutador({ chat: f.chat });
    const r = await e.ejecutar([intento('a', ['k1', 'k2'])], base);
    expect(r.resultado.content).toBe('con secreto-k2');
    expect(e.estadoClaves().k1?.enPausaHasta).toBeTruthy();
    f.llamadas.length = 0;
    await e.ejecutar([intento('a', ['k1', 'k2'])], base);
    expect(f.llamadas.map((l) => l.apiKey)).toEqual(['secreto-k2']);
  });

  it('reparte la carga: dos peticiones simultáneas usan claves distintas', async () => {
    const f = falso({ a: async () => (await espera(30), ok('A')) });
    const e = crearEnrutador({ chat: f.chat });
    await Promise.all([e.ejecutar([intento('a', ['k1', 'k2'])], base), e.ejecutar([intento('a', ['k1', 'k2'])], base)]);
    expect(new Set(f.llamadas.map((l) => l.apiKey)).size).toBe(2);
  });

  it('en streaming, el primero que emite texto se queda la salida', async () => {
    const f = falso({
      a: async (_r, s, d) => {
        await espera(200, s);
        d?.('lento');
        return ok('lento');
      },
      b: async (_r, _s, d) => {
        d?.('ho');
        d?.('la');
        return ok('hola');
      },
    });
    const trozos: string[] = [];
    const r = await crearEnrutador({ chat: f.chat }).ejecutar([intento('a'), intento('b')], base, { cubrirTrasMs: 20, onDelta: (t) => trozos.push(t) });
    expect(r.resultado.content).toBe('hola');
    expect(trozos.join('')).toBe('hola');
  });

  it('todos fallan → devuelve el último fallo; cancelar corta en el acto', async () => {
    const f = falso({ a: async () => ({ success: false, errorCode: 'service_unavailable', error: '503' }) });
    const r = await crearEnrutador({ chat: f.chat }).ejecutar([intento('a'), intento('x')], base);
    expect(r.resultado.success).toBe(false);
    const ctl = new AbortController();
    const lento = falso({ a: async (_r, s) => (await espera(5000, s), ok('A')) });
    const p = crearEnrutador({ chat: lento.chat }).ejecutar([intento('a')], base, { signal: ctl.signal });
    ctl.abort();
    expect((await p).resultado.errorCode).toBe('cancelled');
  });

  it('el razonamiento oculto se apaga solo en conexiones que lo entienden', async () => {
    expect(extraRazonamiento('kilocode', 'off')).toEqual({ reasoning: { enabled: false } });
    expect(extraRazonamiento('openrouter', 'bajo')).toEqual({ reasoning: { effort: 'low' } });
    expect(extraRazonamiento('openai', 'off')).toBeUndefined();
    expect(extraRazonamiento('kilocode', 'normal')).toBeUndefined();
    const f = falso({ a: async () => ok('A') });
    await crearEnrutador({ chat: f.chat }).ejecutar([intento('a')], base);
    expect(f.llamadas[0]!.extra).toEqual({ reasoning: { enabled: false } });
  });
});

describe('créditos, mensajes públicos y periodos', () => {
  it('créditos = tokens/1000 × factor', () => {
    expect(creditosDe({ entrada: 3000, salida: 1000 }, 1.5)).toBe(6);
  });
  it('los fallos no exponen nombres de proveedores', () => {
    const r = falloPublico({ success: false, errorCode: 'rate_limit', error: 'Kilo Code gateway 429 nvidia/nemotron' });
    expect(JSON.stringify(r)).not.toMatch(/kilo|nvidia|nemotron/i);
    expect(r.error).toContain('JasWave IA');
  });
  it('periodos en la zona horaria del servicio', () => {
    const p = periodosDe(new Date('2026-10-28T02:00:00Z'), 'America/Santo_Domingo');
    // 02:00 UTC = 22:00 del 27 en Santo Domingo (UTC-4): el día empezó el 27 a las 04:00 UTC.
    expect(p.inicioDia.toISOString()).toBe('2026-10-27T04:00:00.000Z');
    expect(p.finDia.toISOString()).toBe('2026-10-28T04:00:00.000Z');
    expect(p.inicioMes.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(periodosDe(new Date('2026-10-28T02:00:00Z')).inicioDia.toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });
});

describe('cobertura adaptada a la latencia observada', () => {
  it('cubre antes con el siguiente cuando el modelo activo suele ser rápido y esta vez se atasca', async () => {
    let lentas = 0;
    const f = falso({
      a: async (_r, s) => {
        if (lentas > 0) {
          await espera(1500, s);
          return ok('A lento');
        }
        await espera(10, s);
        return ok('A');
      },
      b: async () => ok('B'),
    });
    const e = crearEnrutador({ chat: f.chat, coberturaMinMs: 20 });
    // Sin historial se espera el tope configurado.
    expect(e.latenciaPercentil('a')).toBeNull();
    for (let i = 0; i < 10; i++) await e.ejecutar([intento('a'), intento('b')], base, { cubrirTrasMs: 1200 });
    expect(e.latenciaPercentil('a')).not.toBeNull();
    expect(e.latenciaPercentil('a')!).toBeLessThan(200);
    lentas = 1;
    const t0 = Date.now();
    const r = await e.ejecutar([intento('a'), intento('b')], base, { cubrirTrasMs: 1200 });
    // Gana B mucho antes del tope de 1,2 s: cubrió al pasar el percentil observado de A.
    expect(r.resultado.content).toBe('B');
    expect(Date.now() - t0).toBeLessThan(600);
  });

  it('sin muestras suficientes respeta el tope configurado', async () => {
    const f = falso({
      a: async (_r, s) => {
        await espera(120, s);
        return ok('A');
      },
      b: async () => ok('B'),
    });
    const e = crearEnrutador({ chat: f.chat, coberturaMinMs: 5 });
    for (let i = 0; i < 3; i++) {
      const r = await e.ejecutar([intento('a'), intento('b')], base, { cubrirTrasMs: 400 });
      expect(r.resultado.content).toBe('A');
    }
  });
});
