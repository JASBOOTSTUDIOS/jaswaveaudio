import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../src/auth/verificador-jwt.js';
import { crearServicioIAEnMemoria, type PermisosIA, type ProveedorResuelto, type ServicioProveedoresIA } from '../src/ia/proveedores.js';
import { crearEmisorPrueba } from './jwt-local.js';

/** Proveedor falso compatible con OpenAI: responde texto, tool_calls o un stream SSE. */
function proveedorFalso() {
  const recibidas: { auth?: string; cuerpo: Record<string, unknown> }[] = [];
  const servidor = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (d) => (datos += d));
    req.on('end', () => {
      const cuerpo = JSON.parse(datos || '{}');
      recibidas.push({ auth: req.headers.authorization, cuerpo });
      if (!req.url?.endsWith('/chat/completions')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'modelo-a' }] }));
        return;
      }
      if (cuerpo.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const t of ['Hola', ' desde', ' la web']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      const conHerramientas = Array.isArray(cuerpo.tools) && cuerpo.tools.length > 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: conHerramientas
                ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: (cuerpo.tools as { function: { name: string } }[])[0]!.function.name, arguments: '{"bpm":120}' } }] }
                : { role: 'assistant', content: 'Respuesta del modelo' },
            },
          ],
        }),
      );
    });
  });
  return { servidor, recibidas };
}

describe('M1 — IA en la web vía backend', () => {
  let emisor: Awaited<ReturnType<typeof crearEmisorPrueba>>;
  const falso = proveedorFalso();
  let proveedor: ProveedorResuelto & { nombre: string };
  let config: ServicioProveedoresIA;
  let token: string;

  const app = (servicio: ServicioProveedoresIA | null) =>
    crearApp({ verificar: crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [] }), origenesCors: [], ia: servicio });

  beforeAll(async () => {
    emisor = await crearEmisorPrueba();
    token = await emisor.emitir({ sub: 'u1', email: 'a@b.c' });
    await new Promise<void>((r) => falso.servidor.listen(0, '127.0.0.1', () => r()));
    proveedor = {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'principal',
      nombre: 'Principal',
      origen: 'admin',
      peticionesPorMinuto: 5,
      modelos: ['modelo-a'],
      modeloPorDefecto: 'modelo-a',
      maxTokens: 1000,
      herramientas: true,
      redRestringida: false,
      destino: {
        kind: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${(falso.servidor.address() as AddressInfo).port}/v1`,
        apiKey: 'clave-del-servidor',
      },
    };
    config = crearServicioIAEnMemoria([proveedor]);
  });
  afterAll(async () => {
    await new Promise<void>((r) => falso.servidor.close(() => r()));
  });

  const chat = (a: ReturnType<typeof app>, cuerpo: object) => request(a).post('/ia/chat').set('Authorization', `Bearer ${token}`).send(cuerpo);

  it('responde con el modelo del servidor y su clave; ignora host y clave enviados por el cliente', async () => {
    const r = await chat(app(config), { messages: [{ role: 'user', content: 'hola' }], baseUrl: 'http://evil.example', apiKey: 'robada' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, content: 'Respuesta del modelo' });
    const ultima = falso.recibidas.at(-1)!;
    expect(ultima.auth).toBe('Bearer clave-del-servidor');
    expect(ultima.cuerpo.model).toBe('modelo-a');
    expect(ultima.cuerpo.max_tokens ?? ultima.cuerpo.max_completion_tokens).toBeLessThanOrEqual(1000);
  });

  it('pasa herramientas y devuelve las llamadas a herramientas (nombres con puntos)', async () => {
    const r = await chat(app(config), {
      messages: [{ role: 'user', content: 'pon 120 bpm' }],
      tools: [{ name: 'transport.setBpm', description: 'BPM', parameters: { type: 'object', properties: { bpm: { type: 'number' } } } }],
    });
    expect(r.body.toolCalls?.[0]).toMatchObject({ name: 'transport.setBpm', arguments: { bpm: 120 } });
  });

  it('streaming por SSE: deltas y resultado final', async () => {
    const r = await request(app(config))
      .post('/ia/chat/stream')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [{ role: 'user', content: 'hola' }] })
      .buffer(true)
      .parse((res, cb) => {
        let t = '';
        res.on('data', (d: Buffer) => (t += d.toString()));
        res.on('end', () => cb(null, t));
      });
    const eventos = String(r.body)
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    expect(eventos.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('Hola desde la web');
    expect(eventos.at(-1)).toMatchObject({ type: 'done', result: { success: true } });
  });

  it('503 sin configuración, 401 sin sesión, 400 con modelo no permitido y 429 al pasar el límite', async () => {
    expect((await chat(app(null), { messages: [{ role: 'user', content: 'x' }] })).status).toBe(503);
    expect((await request(app(config)).post('/ia/chat').send({ messages: [{ role: 'user', content: 'x' }] })).status).toBe(401);
    const a = app(config);
    expect((await chat(a, { messages: [{ role: 'user', content: 'x' }], model: 'gpt-caro' })).status).toBe(400);
    const estados: number[] = [];
    for (let i = 0; i < 6; i++) estados.push((await chat(a, { messages: [{ role: 'user', content: 'x' }] })).status);
    expect(estados).toContain(429);
  });

  it('/ia/estado informa disponibilidad y modelos', async () => {
    const r = await request(app(config)).get('/ia/estado').set('Authorization', `Bearer ${token}`);
    expect(r.body).toMatchObject({ proveedorId: proveedor.id, proveedor: 'openai-compatible', modelo: 'modelo-a', modelos: ['modelo-a'] });
    const sin = await request(app(null)).get('/ia/estado').set('Authorization', `Bearer ${token}`);
    expect(sin.body).toEqual({ disponible: false, motivo: 'ia_no_configurada' });
  });

  it('permisos: sin ia.usar → 403; proveedor no concedido → 403/404; /ia/proveedores solo lista los permitidos', async () => {
    const sinUso: PermisosIA = { usar: false, modeloPropio: false, proveedores: [] };
    const a = app(crearServicioIAEnMemoria([proveedor], () => sinUso));
    expect((await chat(a, { messages: [{ role: 'user', content: 'x' }] })).status).toBe(403);
    const sinProveedor = app(crearServicioIAEnMemoria([proveedor], () => ({ usar: true, modeloPropio: false, proveedores: [] })));
    expect((await chat(sinProveedor, { messages: [{ role: 'user', content: 'x' }], proveedorId: proveedor.id })).status).toBe(404);
    const lista = await request(sinProveedor).get('/ia/proveedores').set('Authorization', `Bearer ${token}`);
    expect(lista.body.proveedores).toEqual([]);
    const con = await request(app(config)).get('/ia/proveedores').set('Authorization', `Bearer ${token}`);
    expect(con.body.proveedores[0]).toMatchObject({ id: proveedor.id, tieneClave: true });
    expect(JSON.stringify(con.body)).not.toContain('clave-del-servidor');
  });
});
