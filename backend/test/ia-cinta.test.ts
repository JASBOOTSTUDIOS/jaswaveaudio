import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiChatRequest, AiChatResult } from '../src/ia/gateway/ai-gateway.js';
import { cintaDesdeEntorno, claveDePeticion, envolverConCinta, type ChatDirecto } from '../src/ia/gateway/cinta.js';

const carpetas: string[] = [];
const archivo = () => {
  const d = mkdtempSync(join(tmpdir(), 'cinta-'));
  carpetas.push(d);
  return join(d, 'cinta.jsonl');
};
afterEach(() => {
  while (carpetas.length) rmSync(carpetas.pop()!, { recursive: true, force: true });
});

const peticion = (sistema: string, extra: Partial<AiChatRequest> = {}): AiChatRequest => ({
  kind: 'openai',
  model: 'm',
  baseUrl: 'http://x',
  messages: [{ role: 'system', content: sistema }, { role: 'user', content: 'hola' }],
  ...extra,
});

describe('cinta de respuestas del modelo', () => {
  it('graba las respuestas y las repite por agente y orden, sin llamar al proveedor', async () => {
    const f = archivo();
    let llamadas = 0;
    const real: ChatDirecto = async (req) => {
      llamadas++;
      return { success: true, content: `${String(req.messages[0]!.content)}#${llamadas}`, provider: 'secreto' } as AiChatResult;
    };
    const grabador = envolverConCinta(real, { modo: 'grabar', archivo: f });
    const a1 = await grabador(peticion('bajista'));
    const b1 = await grabador(peticion('pianista'));
    const a2 = await grabador(peticion('bajista'));
    expect([a1.content, b1.content, a2.content]).toEqual(['bajista#1', 'pianista#2', 'bajista#3']);

    const sinProveedor: ChatDirecto = async () => {
      throw new Error('no debe llamarse');
    };
    const repetidor = envolverConCinta(sinProveedor, { modo: 'reproducir', archivo: f });
    // El orden global no importa: cada agente recibe SUS respuestas en SU orden.
    expect((await repetidor(peticion('pianista'))).content).toBe('pianista#2');
    expect((await repetidor(peticion('bajista'))).content).toBe('bajista#1');
    expect((await repetidor(peticion('bajista'))).content).toBe('bajista#3');
    const agotada = await repetidor(peticion('bajista'));
    expect(agotada.success).toBe(false);
    expect(agotada.error).toMatch(/Cinta agotada/);
  });

  it('no graba credenciales ni el proveedor y entrega el texto por onDelta', async () => {
    const f = archivo();
    const real: ChatDirecto = async () => ({ success: true, content: 'ok', provider: 'openrouter' });
    await envolverConCinta(real, { modo: 'grabar', archivo: f })(peticion('s', { apiKey: 'sk-secreta' }));
    const crudo = (await import('node:fs')).readFileSync(f, 'utf8');
    expect(crudo).not.toMatch(/sk-secreta|openrouter/);
    const trozos: string[] = [];
    const r = await envolverConCinta(real, { modo: 'reproducir', archivo: f })(peticion('s'), { onDelta: (t) => trozos.push(t) });
    expect(r.content).toBe('ok');
    expect(trozos).toEqual(['ok']);
  });

  it('la clave depende del sistema y del rol, no del resto de mensajes', () => {
    const a = claveDePeticion(peticion('x', { meta: { role: 'musico' } }));
    const b = claveDePeticion({ ...peticion('x', { meta: { role: 'musico' } }), messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'otro' }] });
    expect(a).toBe(b);
    expect(a).not.toBe(claveDePeticion(peticion('y', { meta: { role: 'musico' } })));
  });

  it('sin variables de entorno devuelve el chat original; con reproducir y archivo ausente falla claro', () => {
    const real: ChatDirecto = async () => ({ success: true });
    expect(cintaDesdeEntorno(real, {})).toBe(real);
    expect(() => cintaDesdeEntorno(real, { JASWAVE_IA_CINTA_REPRODUCIR: join(tmpdir(), 'no-existe-cinta.jsonl') })).toThrow(/no existe/);
  });

  it('el estado del proyecto al final del mensaje de sistema no cambia la clave, y un fallo no consume el turno', async () => {
    const f = archivo();
    const identidad = 'Eres el Bajista de la banda. '.repeat(12);
    const real: ChatDirecto = async () => ({ success: true, content: 'respuesta-1' });
    await envolverConCinta(real, { modo: 'grabar', archivo: f })(peticion(identidad + 'ESTADO: 3 pistas'));
    const repetidor = envolverConCinta(async () => { throw new Error('no debe llamarse'); }, { modo: 'reproducir', archivo: f });
    expect(claveDePeticion(peticion(identidad + 'ESTADO A'))).toBe(claveDePeticion(peticion(identidad + 'ESTADO B, distinto')));
    expect((await repetidor(peticion('otro agente distinto'))).success).toBe(false);
    expect((await repetidor(peticion('otro agente distinto'))).success).toBe(false);
    expect((await repetidor(peticion(identidad + 'ESTADO: 9 pistas, otras notas'))).content).toBe('respuesta-1');
  });
});
