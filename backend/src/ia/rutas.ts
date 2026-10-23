/**
 * Gateway de IA (M1/M2): el backend llama al proveedor elegido entre los que el usuario tiene permitidos
 * (proveedores del admin por rol, o propios con `ia.modelo-propio`). Proveedores, modelos y claves viven
 * en la base de datos (ver proveedores.ts); el cliente solo envía mensajes, herramientas, opciones y el id
 * del proveedor. Límite de peticiones por usuario y proveedor, y de tokens por respuesta.
 */

import express, { Router, type Request } from 'express';
import { z } from 'zod';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';
import { exigirAdmin, exigirAutenticacion } from '../http/auth-middleware.js';
import { ErrorApi } from '../http/errores.js';
import { conRedRestringida } from '../seguridad/red-restringida.js';
import { aiChat, aiChatStream, aiHealth, cancelAiChat, type AiChatRequest } from './gateway/ai-gateway.js';
import type { ProveedorResuelto, ServicioAdminIA, ServicioProveedoresIA } from './proveedores.js';

const mensaje = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().max(400_000).nullable().optional(),
  })
  .passthrough();

const idProveedor = z.string().uuid();

const esquemaChat = z.object({
  messages: z.array(mensaje).min(1).max(400),
  proveedorId: idProveedor.optional(),
  model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(64_000).optional(),
  tools: z.array(z.object({ name: z.string().max(120), description: z.string().max(4000), parameters: z.record(z.unknown()) })).max(160).optional(),
  toolChoice: z.enum(['auto', 'none', 'required']).optional(),
  requestId: z.string().regex(/^[\w-]{1,80}$/).optional(),
  meta: z.object({ purpose: z.string().max(60).optional(), role: z.string().max(60).optional(), runId: z.string().max(80).optional() }).optional(),
});

/** Ventana deslizante de 60 s por clave (en memoria; con varias instancias, mover a Redis/BD). */
export function crearLimitador(ahora: () => number = Date.now) {
  const historial = new Map<string, number[]>();
  return (clave: string, porMinuto: number): boolean => {
    const t = ahora();
    const recientes = (historial.get(clave) ?? []).filter((x) => t - x < 60_000);
    if (recientes.length >= porMinuto) {
      historial.set(clave, recientes);
      return false;
    }
    recientes.push(t);
    historial.set(clave, recientes);
    return true;
  };
}

/** Llama al gateway con la red restringida si el destino lo aportó un usuario. */
function ejecutar<T>(p: ProveedorResuelto, fn: () => Promise<T>): Promise<T> {
  return p.redRestringida ? conRedRestringida(fn) : fn();
}

export type OpcionesIA = {
  verificar: VerificadorJwt;
  servicio: ServicioProveedoresIA | null;
  /** Inyectables para pruebas. */
  chat?: typeof aiChat;
  chatStream?: typeof aiChatStream;
  salud?: typeof aiHealth;
  ahora?: () => number;
};

export function rutasIA(o: OpcionesIA): Router {
  const r = Router();
  const chat = o.chat ?? aiChat;
  const chatStream = o.chatStream ?? aiChatStream;
  const salud = o.salud ?? aiHealth;
  const limitar = crearLimitador(o.ahora);
  r.use(express.json({ limit: '4mb' }));
  r.use(exigirAutenticacion(o.verificar));

  const servicio = (): ServicioProveedoresIA => {
    if (!o.servicio) throw new ErrorApi(503, 'ia_no_configurada', 'la IA no está configurada en este servidor');
    return o.servicio;
  };

  const preparar = async (req: Request): Promise<{ proveedor: ProveedorResuelto; peticion: AiChatRequest }> => {
    const d = esquemaChat.parse(req.body);
    const id = req.identidad!;
    const proveedor = await servicio().resolver(id, d.proveedorId);
    if (!limitar(`${id.userId}:${proveedor.id}`, proveedor.peticionesPorMinuto)) {
      throw new ErrorApi(429, 'demasiadas_peticiones', 'límite de peticiones de IA por minuto alcanzado');
    }
    if (d.model && !proveedor.modelos.includes(d.model)) throw new ErrorApi(400, 'modelo_no_permitido', `modelo no permitido: ${d.model}`);
    const custom = { ...(proveedor.destino.custom ?? {}), ...(proveedor.herramientas !== null ? { supportsTools: proveedor.herramientas } : {}) };
    return {
      proveedor,
      peticion: {
        kind: proveedor.destino.kind,
        baseUrl: proveedor.destino.baseUrl,
        ...(proveedor.destino.apiKey ? { apiKey: proveedor.destino.apiKey } : {}),
        model: d.model ?? proveedor.modeloPorDefecto,
        messages: d.messages as AiChatRequest['messages'],
        maxTokens: Math.min(d.maxTokens ?? proveedor.maxTokens, proveedor.maxTokens),
        ...(d.temperature !== undefined ? { temperature: d.temperature } : {}),
        ...(d.tools ? { tools: d.tools } : {}),
        ...(d.toolChoice ? { toolChoice: d.toolChoice } : {}),
        // El id de cancelación se aísla por usuario para que nadie cancele peticiones ajenas.
        ...(d.requestId ? { requestId: `${id.userId}:${d.requestId}` } : {}),
        ...(d.meta ? { meta: d.meta } : {}),
        ...(Object.keys(custom).length ? { custom } : {}),
      },
    };
  };

  /** Proveedores y modelos permitidos para el usuario, con sus permisos de IA. */
  r.get('/proveedores', async (req, res) => {
    res.json(await servicio().disponibles(req.identidad!));
  });

  /** Disponibilidad del proveedor pedido (o el predeterminado del usuario). */
  r.get('/estado', async (req, res) => {
    if (!o.servicio) {
      res.json({ disponible: false, motivo: 'ia_no_configurada' });
      return;
    }
    const pedido = typeof req.query.proveedorId === 'string' ? idProveedor.parse(req.query.proveedorId) : undefined;
    let p: ProveedorResuelto;
    try {
      p = await o.servicio.resolver(req.identidad!, pedido);
    } catch (e) {
      if (e instanceof ErrorApi) {
        res.json({ disponible: false, motivo: e.codigo, mensaje: e.message });
        return;
      }
      throw e;
    }
    const s = await ejecutar(p, () => salud({ ...p.destino })).catch(() => null);
    res.json({
      disponible: s?.status === 'healthy',
      proveedorId: p.id,
      proveedor: p.destino.kind,
      modelo: p.modeloPorDefecto,
      modelos: p.modelos,
      ...(s && s.status !== 'healthy' ? { motivo: s.error ?? s.status } : {}),
    });
  });

  r.post('/chat', async (req, res) => {
    const { proveedor, peticion } = await preparar(req);
    res.json(await ejecutar(proveedor, () => chat(peticion)));
  });

  /** Streaming por SSE: `data: {"type":"delta","text"}` … y al final `data: {"type":"done","result"}`. */
  r.post('/chat/stream', async (req, res) => {
    const { proveedor, peticion } = await preparar(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const enviar = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    req.on('close', () => {
      if (peticion.requestId && !res.writableEnded) cancelAiChat(peticion.requestId);
    });
    try {
      const resultado = await ejecutar(proveedor, () => chatStream(peticion, (text) => enviar({ type: 'delta', text })));
      enviar({ type: 'done', result: resultado });
    } catch (e) {
      enviar({ type: 'done', result: { success: false, error: e instanceof Error ? e.message : String(e) } });
    }
    res.end();
  });

  r.post('/cancelar', (req, res) => {
    const { requestId } = z.object({ requestId: z.string().regex(/^[\w-]{1,80}$/) }).parse(req.body);
    res.json({ cancelada: cancelAiChat(`${req.identidad!.userId}:${requestId}`) });
  });

  // ---------- Modelos propios (requieren ia.modelo-propio) ----------
  const propios = () => {
    const p = servicio().propios;
    if (!p) throw new ErrorApi(503, 'ia_no_configurada', 'modelos propios no disponibles en este servidor');
    return p;
  };
  const claveEsquema = z.object({ apiKey: z.string().min(1).max(4000).nullable() });

  r.get('/mis-proveedores', async (req, res) => {
    res.json({ proveedores: await propios().listar(req.identidad!) });
  });
  r.post('/mis-proveedores', async (req, res) => {
    res.status(201).json({ proveedor: await propios().crear(req.identidad!, req.body) });
  });
  r.put('/mis-proveedores/:id', async (req, res) => {
    res.json({ proveedor: await propios().actualizar(req.identidad!, idProveedor.parse(req.params.id), req.body) });
  });
  r.put('/mis-proveedores/:id/clave', async (req, res) => {
    await propios().fijarClave(req.identidad!, idProveedor.parse(req.params.id), claveEsquema.parse(req.body).apiKey);
    res.json({ ok: true });
  });
  r.delete('/mis-proveedores/:id', async (req, res) => {
    await propios().eliminar(req.identidad!, idProveedor.parse(req.params.id));
    res.status(204).end();
  });
  /** Escritorio: credencial de un modelo propio que se ejecuta en el equipo del usuario. */
  r.get('/mis-proveedores/:id/credencial', async (req, res) => {
    res.json({ proveedor: await propios().credencialLocal(req.identidad!, idProveedor.parse(req.params.id)) });
  });

  return r;
}

/** Administración de proveedores de IA (solo administradores). Las claves son de solo escritura. */
export function rutasAdminIA(o: { verificar: VerificadorJwt; admin: ServicioAdminIA; salud?: typeof aiHealth }): Router {
  const r = Router();
  const salud = o.salud ?? aiHealth;
  r.use(express.json({ limit: '64kb' }));
  r.use(exigirAutenticacion(o.verificar), exigirAdmin);
  const actor = (req: Request) => req.identidad!.userId;

  r.get('/proveedores', async (_req, res) => {
    res.json({ proveedores: await o.admin.listar() });
  });
  r.get('/proveedores-usuario', async (_req, res) => {
    res.json({ proveedores: await o.admin.listarDeUsuarios() });
  });
  r.post('/proveedores', async (req, res) => {
    res.status(201).json({ proveedor: await o.admin.crear(actor(req), req.body) });
  });
  r.put('/proveedores/:id', async (req, res) => {
    res.json({ proveedor: await o.admin.actualizar(actor(req), idProveedor.parse(req.params.id), req.body) });
  });
  r.put('/proveedores/:id/clave', async (req, res) => {
    const { apiKey } = z.object({ apiKey: z.string().min(1).max(4000).nullable() }).parse(req.body);
    await o.admin.fijarClave(actor(req), idProveedor.parse(req.params.id), apiKey);
    res.json({ ok: true });
  });
  r.delete('/proveedores/:id', async (req, res) => {
    await o.admin.eliminar(actor(req), idProveedor.parse(req.params.id));
    res.status(204).end();
  });
  r.post('/proveedores/:id/probar', async (req, res) => {
    const p = await o.admin.resolverPorId(idProveedor.parse(req.params.id));
    const s = await ejecutar(p, () => salud({ ...p.destino }));
    res.json({ estado: s.status, modelos: s.models, ...(s.error ? { error: s.error } : {}), ...(s.hint ? { pista: s.hint } : {}) });
  });

  return r;
}
