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
import type { ProveedorPublico, ProveedorResuelto, ServicioAdminIA, ServicioProveedoresIA } from './proveedores.js';
import { MODELO_AUTO, NOMBRE_SERVICIO, type CatalogoJasWave, type ServicioJasWave } from './jaswave/servicio.js';
import type { GestorModelosGratis } from './jaswave/modelos-gratis.js';

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
  /** JasWave IA (modelos de marca, planes y consumo). Sin él, las peticiones sin proveedor usan el primero permitido. */
  jaswave?: ServicioJasWave | null;
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

  /** Proveedores y modelos permitidos para el usuario, con sus permisos de IA. JasWave IA va primero. */
  r.get('/proveedores', async (req, res) => {
    const disp = await servicio().disponibles(req.identidad!);
    if (!o.jaswave) {
      res.json(disp);
      return;
    }
    const jw = await o.jaswave.catalogo(req.identidad!, disp.permisos);
    res.json({ ...disp, proveedores: [...(jw.modelos.length ? [proveedorJasWave(jw)] : []), ...disp.proveedores], jaswave: jw });
  });

  /** Créditos usados y límites del plan del usuario. */
  r.get('/consumo', async (req, res) => {
    if (!o.jaswave) throw new ErrorApi(503, 'ia_no_configurada', 'la IA no está configurada en este servidor');
    res.json(await o.jaswave.consumo(req.identidad!));
  });

  /** Petición a JasWave IA (sin proveedorId): el servidor elige modelo real, clave y cobertura. */
  const usaJasWave = async (d: z.infer<typeof esquemaChat>) => Boolean(o.jaswave && !d.proveedorId && (await o.jaswave.esModelo(d.model)));
  const baseDe = (req: Request, d: z.infer<typeof esquemaChat>) => ({
    messages: d.messages as AiChatRequest['messages'],
    ...(d.maxTokens !== undefined ? { maxTokens: d.maxTokens } : {}),
    ...(d.temperature !== undefined ? { temperature: d.temperature } : {}),
    ...(d.tools ? { tools: d.tools } : {}),
    ...(d.toolChoice ? { toolChoice: d.toolChoice } : {}),
    ...(d.requestId ? { requestId: `${req.identidad!.userId}:${d.requestId}` } : {}),
    ...(d.meta ? { meta: d.meta } : {}),
  });
  /** Cancelación de peticiones de JasWave IA por requestId (aislado por usuario). */
  const enCurso = new Map<string, AbortController>();
  const conCancelacion = async <T>(clave: string | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const ctl = new AbortController();
    if (clave) enCurso.set(clave, ctl);
    try {
      return await fn(ctl.signal);
    } finally {
      if (clave) enCurso.delete(clave);
    }
  };

  /** Disponibilidad del proveedor pedido (o el predeterminado del usuario). */
  r.get('/estado', async (req, res) => {
    if (!o.servicio) {
      res.json({ disponible: false, motivo: 'ia_no_configurada' });
      return;
    }
    const pedido = typeof req.query.proveedorId === 'string' ? idProveedor.parse(req.query.proveedorId) : undefined;
    if (!pedido && o.jaswave) {
      const jw = await o.jaswave.catalogo(req.identidad!);
      res.json({
        disponible: jw.modelos.length > 0,
        proveedorId: 'jaswave',
        proveedor: 'jaswave',
        modelo: MODELO_AUTO,
        modelos: jw.modelos.map((m) => m.id),
        ...(jw.modelos.length ? {} : { motivo: 'ia_no_configurada', mensaje: `${NOMBRE_SERVICIO} no está disponible para tu cuenta.` }),
      });
      return;
    }
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
    const d = esquemaChat.parse(req.body);
    if (await usaJasWave(d)) {
      const base = baseDe(req, d);
      res.json(await conCancelacion(base.requestId, (signal) => o.jaswave!.chat(req.identidad!, { modelo: d.model, proposito: d.meta?.purpose, base }, { signal })));
      return;
    }
    const { proveedor, peticion } = await preparar(req);
    const t0 = Date.now();
    const resultado = await ejecutar(proveedor, () => chat(peticion));
    void o.jaswave?.registrarDirecto(req.identidad!, { proveedorId: proveedor.id, modeloReal: peticion.model, proposito: d.meta?.purpose, base: peticion, resultado, ms: Date.now() - t0 });
    res.json(resultado);
  });

  /** Streaming por SSE: `data: {"type":"delta","text"}` … y al final `data: {"type":"done","result"}`. */
  r.post('/chat/stream', async (req, res) => {
    const d = esquemaChat.parse(req.body);
    if (await usaJasWave(d)) {
      const base = baseDe(req, d);
      const ctl = new AbortController();
      // Validaciones (permiso, cuota) antes de abrir el stream: así llegan como error HTTP normal.
      await o.jaswave!.consumo(req.identidad!);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const enviar = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      res.on('close', () => {
        if (!res.writableEnded) ctl.abort();
      });
      if (base.requestId) enCurso.set(base.requestId, ctl);
      try {
        const resultado = await o.jaswave!.chat(req.identidad!, { modelo: d.model, proposito: d.meta?.purpose, base }, { signal: ctl.signal, onDelta: (text) => enviar({ type: 'delta', text }) });
        enviar({ type: 'done', result: resultado });
      } catch (e) {
        const err =
          e instanceof ErrorApi
            ? { success: false, error: e.message, errorCode: e.estado === 429 ? 'rate_limit' : e.estado === 403 ? 'forbidden' : 'not_available' }
            : { success: false, error: `${NOMBRE_SERVICIO} no pudo responder.` };
        enviar({ type: 'done', result: err });
      } finally {
        if (base.requestId) enCurso.delete(base.requestId);
      }
      res.end();
      return;
    }
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
    const clave = `${req.identidad!.userId}:${requestId}`;
    const propia = enCurso.get(clave);
    propia?.abort();
    res.json({ cancelada: Boolean(propia) || cancelAiChat(clave) });
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

/** Proveedor sintético con los modelos JasWave (el cliente lo trata como un proveedor más, sin URL ni clave). */
export function proveedorJasWave(jw: CatalogoJasWave): ProveedorPublico & { nombresModelos: Record<string, string>; descripcionesModelos: Record<string, string> } {
  return {
    id: 'jaswave',
    slug: 'jaswave',
    nombre: NOMBRE_SERVICIO,
    tipo: 'jaswave',
    modelos: jw.modelos.map((m) => m.id),
    modeloPorDefecto: MODELO_AUTO,
    maxTokens: 16_000,
    herramientas: true,
    origen: 'admin',
    ejecucion: 'servidor',
    activo: true,
    tieneClave: true,
    nombresModelos: Object.fromEntries(jw.modelos.map((m) => [m.id, m.nombre])),
    descripcionesModelos: Object.fromEntries(jw.modelos.map((m) => [m.id, m.descripcion])),
  };
}

/** Administración de proveedores de IA (solo administradores). Las claves son de solo escritura. */
export function rutasAdminIA(o: { verificar: VerificadorJwt; admin: ServicioAdminIA; jaswave?: ServicioJasWave | null; gestor?: GestorModelosGratis | null; salud?: typeof aiHealth }): Router {
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
    const id = idProveedor.parse(req.params.id);
    const p = await o.admin.resolverPorId(id);
    // Con la principal y, si no basta, con cada clave del grupo (una conexión puede no tener principal).
    const extra = o.jaswave && p.origen === 'admin' ? await o.jaswave.admin.clavesParaProbar(id).catch(() => []) : [];
    const candidatas = [...(p.destino.apiKey ? [p.destino.apiKey] : []), ...extra];
    let s = await ejecutar(p, () => salud({ ...p.destino }));
    for (const apiKey of candidatas.slice(p.destino.apiKey ? 1 : 0)) {
      if (s.status === 'healthy' && s.models?.length) break;
      s = await ejecutar(p, () => salud({ ...p.destino, apiKey }));
    }
    res.json({ estado: s.status, modelos: s.models, ...(s.error ? { error: s.error } : {}), ...(s.hint ? { pista: s.hint } : {}) });
  });

  // ---------- JasWave IA: modelos de marca, planes, consumo y grupo de claves ----------
  const jw = () => {
    if (!o.jaswave) throw new ErrorApi(503, 'ia_no_configurada', 'JasWave IA no está configurada en este servidor');
    return o.jaswave.admin;
  };
  const idPlan = z.string().uuid();
  /** Claves del grupo (uuid) o la principal de la conexión (`<conexión>:principal`). */
  const idClave = z.union([z.string().uuid(), z.string().regex(/^(?:[0-9a-f-]{36}:)?principal$/i)]);
  r.get('/modelos', async (_req, res) => {
    res.json({ modelos: await jw().modelos() });
  });
  r.put('/modelos/:id', async (req, res) => {
    res.json({ modelo: await jw().guardarModelo(actor(req), String(req.params.id), req.body) });
  });
  r.post('/modelos/:id/probar', async (req, res) => {
    res.json({ eslabones: await jw().probarModelo(String(req.params.id)) });
  });
  r.delete('/modelos/:id', async (req, res) => {
    await jw().eliminarModelo(actor(req), String(req.params.id));
    res.status(204).end();
  });
  // ---------- Gestor de modelos gratuitos de OpenRouter ----------
  const gestor = () => {
    if (!o.gestor) throw new ErrorApi(503, 'gestor_no_configurado', 'el gestor de modelos gratuitos no está activo en este servidor');
    return o.gestor;
  };
  const idModeloGratis = z.string().min(3).max(200).regex(/^[\w.\-/:]+$/);
  r.get('/modelos-gratis', async (_req, res) => {
    const g = gestor();
    res.json({ config: await g.config(), ...g.estado(), modelos: await g.listar() });
  });
  r.put('/modelos-gratis/config', async (req, res) => {
    const d = z.object({ auto: z.boolean().optional(), intervaloMin: z.number().int().min(15).max(1440).optional(), maxPruebasPorCiclo: z.number().int().min(1).max(40).optional() }).parse(req.body);
    res.json({ config: await gestor().guardarConfig(d) });
  });
  /** Ciclo completo (descubrir, probar, reconstruir cadenas): tarda minutos, así que se lanza en segundo plano. */
  r.post('/modelos-gratis/ciclo', (req, res) => {
    const { forzar } = z.object({ forzar: z.boolean().default(false) }).parse(req.body ?? {});
    const g = gestor();
    if (g.estado().enCurso) {
      res.status(202).json({ enCurso: true });
      return;
    }
    void g.ciclo({ forzar });
    res.status(202).json({ enCurso: true });
  });
  r.post('/modelos-gratis/probar', async (req, res) => {
    const { modelo } = z.object({ modelo: idModeloGratis }).parse(req.body);
    const g = gestor();
    const resultado = await g.probar(modelo);
    res.json({ resultado });
  });
  r.put('/modelos-gratis/ajustes', async (req, res) => {
    const d = z.object({ modelo: idModeloGratis, excluido: z.boolean().optional(), nivel: z.enum(['rapido', 'creativo', 'profundo']).nullable().optional() }).parse(req.body);
    await gestor().ajustar(d.modelo, { ...(d.excluido !== undefined ? { excluido: d.excluido } : {}), ...(d.nivel !== undefined ? { nivel: d.nivel } : {}) });
    res.json({ ok: true });
  });
  r.post('/modelos-gratis/reconstruir', async (_req, res) => {
    res.json({ cadenas: await gestor().reconstruirCadenas() });
  });

  r.get('/planes', async (_req, res) => {
    res.json({ planes: await jw().planes() });
  });
  r.post('/planes', async (req, res) => {
    res.status(201).json({ plan: await jw().guardarPlan(actor(req), null, req.body) });
  });
  r.put('/planes/:id', async (req, res) => {
    res.json({ plan: await jw().guardarPlan(actor(req), idPlan.parse(req.params.id), req.body) });
  });
  r.delete('/planes/:id', async (req, res) => {
    await jw().eliminarPlan(actor(req), idPlan.parse(req.params.id));
    res.status(204).end();
  });
  r.put('/usuarios/:id/plan', async (req, res) => {
    const { planId } = z.object({ planId: idPlan.nullable() }).parse(req.body);
    await jw().asignarPlan(actor(req), z.string().uuid().parse(req.params.id), planId);
    res.json({ ok: true });
  });
  r.get('/consumo', async (req, res) => {
    const dias = z.coerce.number().int().min(1).max(365).default(30).parse(req.query.dias ?? 30);
    res.json(await jw().consumo(dias));
  });
  r.get('/proveedores/:id/claves', async (req, res) => {
    res.json({ claves: await jw().claves(idProveedor.parse(req.params.id)) });
  });
  r.post('/proveedores/:id/claves', async (req, res) => {
    const d = z.object({ apiKey: z.string().min(1).max(4000), etiqueta: z.string().max(60).default('') }).parse(req.body);
    await jw().agregarClave(actor(req), idProveedor.parse(req.params.id), d.apiKey, d.etiqueta);
    res.status(201).json({ ok: true });
  });
  r.put('/proveedores/:id/claves/:claveId', async (req, res) => {
    const d = z.object({ activa: z.boolean().optional(), etiqueta: z.string().max(60).optional() }).parse(req.body);
    await jw().cambiarClave(actor(req), idProveedor.parse(req.params.id), idClave.parse(req.params.claveId), d);
    res.json({ ok: true });
  });
  r.delete('/proveedores/:id/claves/:claveId', async (req, res) => {
    await jw().quitarClave(actor(req), idProveedor.parse(req.params.id), idClave.parse(req.params.claveId));
    res.status(204).end();
  });

  return r;
}
