import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { crearDb, type Db } from '../../src/db.js';
import { claveDesdeJwksLocal, crearVerificadorJwt } from '../../src/auth/verificador-jwt.js';
import { adjuntarSync } from '../../src/sync/servidor.js';
import { CIERRE } from '../../src/sync/protocolo.js';
import { crearEmisorPrueba } from '../jwt-local.js';

const URL_DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

type Emisor = Awaited<ReturnType<typeof crearEmisorPrueba>>;

/** Cliente con cola de mensajes y espera por condición. */
function conectar(url: string) {
  const ws = new WebSocket(url);
  const mensajes: Record<string, unknown>[] = [];
  const cierres: { codigo: number }[] = [];
  let pings = 0;
  ws.on('message', (d) => mensajes.push(JSON.parse(d.toString())));
  ws.on('ping', () => pings++);
  ws.on('close', (codigo) => cierres.push({ codigo }));
  const abierto = new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  return {
    ws,
    mensajes,
    cierres,
    get pings() {
      return pings;
    },
    abierto,
    enviar: (m: object) => ws.send(JSON.stringify(m)),
    cerrarCon: () => new Promise<number>((res) => ws.once('close', (c) => res(c))),
  };
}

async function esperar(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('S1 — sincronización WebSocket con auth JWT', () => {
  let db: Db;
  let emisor: Emisor;
  let servidor: http.Server;
  let base: string;
  let salaId: string;

  beforeAll(async () => {
    db = crearDb(URL_DB);
    emisor = await crearEmisorPrueba();
    servidor = http.createServer();
    const verificar = crearVerificadorJwt({ claves: claveDesdeJwksLocal(emisor.jwks), adminsIniciales: [] });
    adjuntarSync(servidor, { db, verificar, intervaloLatidoMs: 150 });
    await new Promise<void>((res) => servidor.listen(0, '127.0.0.1', () => res()));
    const { port } = servidor.address() as AddressInfo;
    base = `ws://127.0.0.1:${port}/sync`;
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "ComandoSala","MiembroSala","Sala","Concesion","AsignacionRol","Licencia","Dispositivo","Usuario" RESTART IDENTITY CASCADE',
    );
    const sala = await db.sala.create({ data: { nombre: 'Sesión de prueba' } });
    salaId = sala.id;
    for (const [sub, email, rol] of [
      ['sub-owner', 'owner@t.test', 'owner'],
      ['sub-editor', 'editor@t.test', 'editor'],
      ['sub-editor2', 'editor2@t.test', 'editor'],
      ['sub-viewer', 'viewer@t.test', 'viewer'],
    ] as const) {
      const u = await db.usuario.create({ data: { subAuth: sub, email } });
      await db.miembroSala.create({ data: { salaId, usuarioId: u.id, rol } });
    }
  });

  afterAll(async () => {
    await new Promise<void>((res) => servidor.close(() => res()));
    await db.$disconnect();
  });

  const urlCon = (token: string) => `${base}?token=${encodeURIComponent(token)}`;

  it('sin token la conexión se cierra con 4001', async () => {
    const c = conectar(base);
    await c.abierto;
    expect(await c.cerrarCon()).toBe(CIERRE.NO_AUTENTICADO);
  });

  it('token inválido se cierra con 4001', async () => {
    const c = conectar(urlCon('no-es-un-jwt-valido-xxxxx'));
    await c.abierto;
    expect(await c.cerrarCon()).toBe(CIERRE.NO_AUTENTICADO);
  });

  it('un editor aplica un comando y otro editor de la sala lo recibe con seq', async () => {
    const a = conectar(urlCon(await emisor.emitir({ sub: 'sub-editor', email: 'editor@t.test' })));
    const b = conectar(urlCon(await emisor.emitir({ sub: 'sub-editor2', email: 'editor2@t.test' })));
    await Promise.all([a.abierto, b.abierto]);
    a.enviar({ tipo: 'sala.unirse', salaId });
    b.enviar({ tipo: 'sala.unirse', salaId });
    await esperar(() => a.mensajes.some((m) => m.tipo === 'sala.unido') && b.mensajes.some((m) => m.tipo === 'sala.unido'));

    a.enviar({ tipo: 'comando', salaId, clienteId: 'A', comando: 'nota.insertar', payload: { pitch: 60 }, vclock: { A: 1 }, baseSeq: 0 });
    await esperar(() => b.mensajes.some((m) => m.tipo === 'comando.aplicado'));
    const recibido = b.mensajes.find((m) => m.tipo === 'comando.aplicado')!;
    expect(recibido).toMatchObject({ seq: 1, comando: 'nota.insertar', clienteId: 'A', payload: { pitch: 60 } });
    a.ws.close();
    b.ws.close();
  });

  it('un viewer no puede mutar la sala; el comando no se persiste', async () => {
    const v = conectar(urlCon(await emisor.emitir({ sub: 'sub-viewer', email: 'viewer@t.test' })));
    await v.abierto;
    v.enviar({ tipo: 'sala.unirse', salaId });
    await esperar(() => v.mensajes.some((m) => m.tipo === 'sala.unido'));
    expect(v.mensajes.find((m) => m.tipo === 'sala.unido')).toMatchObject({ rol: 'viewer' });
    v.enviar({ tipo: 'comando', salaId, clienteId: 'V', comando: 'nota.insertar', payload: {}, vclock: {}, baseSeq: 0 });
    await esperar(() => v.mensajes.some((m) => m.tipo === 'error'));
    expect(v.mensajes.find((m) => m.tipo === 'error')).toMatchObject({ codigo: 'sin_permiso' });
    expect(await db.comandoSala.count({ where: { salaId } })).toBe(0);
    v.ws.close();
  });

  it('comandos concurrentes de dos clientes dan seq contiguos y sin duplicados, y ambos ven todo', async () => {
    const a = conectar(urlCon(await emisor.emitir({ sub: 'sub-editor', email: 'editor@t.test' })));
    const b = conectar(urlCon(await emisor.emitir({ sub: 'sub-editor2', email: 'editor2@t.test' })));
    await Promise.all([a.abierto, b.abierto]);
    a.enviar({ tipo: 'sala.unirse', salaId });
    b.enviar({ tipo: 'sala.unirse', salaId });
    await esperar(() => a.mensajes.some((m) => m.tipo === 'sala.unido') && b.mensajes.some((m) => m.tipo === 'sala.unido'));

    const N = 20;
    for (let i = 0; i < N; i++) {
      a.enviar({ tipo: 'comando', salaId, clienteId: 'A', comando: 'nota.insertar', payload: { i }, vclock: { A: i + 1 }, baseSeq: 0 });
      b.enviar({ tipo: 'comando', salaId, clienteId: 'B', comando: 'nota.insertar', payload: { i }, vclock: { B: i + 1 }, baseSeq: 0 });
    }
    await esperar(() => a.mensajes.filter((m) => m.tipo === 'comando.aplicado').length === 2 * N, 10_000);
    await esperar(() => b.mensajes.filter((m) => m.tipo === 'comando.aplicado').length === 2 * N, 10_000);

    const seqs = (c: typeof a) => c.mensajes.filter((m) => m.tipo === 'comando.aplicado').map((m) => m.seq as number).sort((x, y) => x - y);
    const esperado = Array.from({ length: 2 * N }, (_, i) => i + 1);
    expect(seqs(a)).toEqual(esperado);
    expect(seqs(b)).toEqual(esperado);
    const filas = await db.comandoSala.findMany({ where: { salaId }, orderBy: { seq: 'asc' }, select: { seq: true } });
    expect(filas.map((f) => f.seq)).toEqual(esperado);
    a.ws.close();
    b.ws.close();
  });

  it('reconectar con desdeSeq reenvía solo lo que falta', async () => {
    const e = await emisor.emitir({ sub: 'sub-editor', email: 'editor@t.test' });
    const w = conectar(urlCon(e));
    await w.abierto;
    w.enviar({ tipo: 'sala.unirse', salaId });
    await esperar(() => w.mensajes.some((m) => m.tipo === 'sala.unido'));
    for (let i = 0; i < 5; i++) {
      w.enviar({ tipo: 'comando', salaId, clienteId: 'A', comando: 'nota.insertar', payload: { i }, vclock: {}, baseSeq: 0 });
    }
    await esperar(() => w.mensajes.filter((m) => m.tipo === 'comando.aplicado').length === 5);
    w.ws.close();

    const r = conectar(urlCon(await emisor.emitir({ sub: 'sub-editor2', email: 'editor2@t.test' })));
    await r.abierto;
    r.enviar({ tipo: 'sala.unirse', salaId, desdeSeq: 3 });
    await esperar(() => r.mensajes.filter((m) => m.tipo === 'comando.aplicado').length === 2);
    expect(r.mensajes.filter((m) => m.tipo === 'comando.aplicado').map((m) => m.seq)).toEqual([4, 5]);
    r.ws.close();
  });

  it('un token expirado cierra la conexión con 4001 al vencer', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1;
    const c = conectar(urlCon(await emisor.emitir({ sub: 'sub-owner', email: 'owner@t.test', exp })));
    await c.abierto;
    const t0 = Date.now();
    expect(await c.cerrarCon()).toBe(CIERRE.NO_AUTENTICADO);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('auth.refresh mantiene la conexión viva más allá de la expiración original', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1;
    const c = conectar(urlCon(await emisor.emitir({ sub: 'sub-owner', email: 'owner@t.test', exp })));
    await c.abierto;
    c.enviar({ tipo: 'auth.refresh', token: await emisor.emitir({ sub: 'sub-owner', email: 'owner@t.test' }) });
    await esperar(() => c.mensajes.some((m) => m.tipo === 'auth.renovado'));
    await new Promise((r) => setTimeout(r, 1500));
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });

  it('auth.refresh con otra identidad se rechaza con 4001', async () => {
    const c = conectar(urlCon(await emisor.emitir({ sub: 'sub-owner', email: 'owner@t.test' })));
    await c.abierto;
    c.enviar({ tipo: 'auth.refresh', token: await emisor.emitir({ sub: 'sub-otro', email: 'otro@t.test' }) });
    expect(await c.cerrarCon()).toBe(CIERRE.NO_AUTENTICADO);
  });

  it('el servidor envía latidos (ping) periódicos', async () => {
    const c = conectar(urlCon(await emisor.emitir({ sub: 'sub-owner', email: 'owner@t.test' })));
    await c.abierto;
    await new Promise((r) => setTimeout(r, 600));
    expect(c.pings).toBeGreaterThanOrEqual(2);
    c.ws.close();
  });
});
