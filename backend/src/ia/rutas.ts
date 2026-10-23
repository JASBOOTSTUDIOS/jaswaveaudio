/**
 * IA en la web (M1): el backend hace de gateway hacia el proveedor de modelos configurado en el
 * servidor. Las claves nunca salen del servidor y el cliente no puede elegir host (sin SSRF): solo
 * mensajes, herramientas y opciones. Límite de peticiones por usuario y de tokens por respuesta.
 */

import express, { Router, type Request } from 'express';
import { z } from 'zod';
import type { VerificadorJwt } from '../auth/verificador-jwt.js';
import { exigirAutenticacion } from '../http/auth-middleware.js';
import { ErrorApi } from '../http/errores.js';
import { aiChat, aiChatStream, aiHealth, cancelAiChat, type AiChatRequest, type AiProviderKind } from './gateway/ai-gateway.js';

export type ConfigIA = {
  proveedor: AiProviderKind;
  baseUrl: string;
  apiKey?: string;
  /** Modelo por defecto y los que el cliente puede pedir. */
  modelo: string;
  modelosPermitidos: string[];
  maxTokens: number;
  peticionesPorMinuto: number;
  /** Fuerza el uso de herramientas nativas (proveedores compatibles con OpenAI que las soportan). */
  herramientas?: boolean;
};

export function configIADesdeEntorno(env: NodeJS.ProcessEnv = process.env): ConfigIA | null {
  const proveedor = env.IA_PROVEEDOR as AiProviderKind | undefined;
  const baseUrl = env.IA_BASE_URL;
  const modelo = env.IA_MODELO;
  if (!proveedor || !baseUrl || !modelo) return null;
  return {
    proveedor,
    baseUrl,
    ...(env.IA_API_KEY ? { apiKey: env.IA_API_KEY } : {}),
    modelo,
    modelosPermitidos: (env.IA_MODELOS || modelo).split(',').map((m) => m.trim()).filter(Boolean),
    maxTokens: Number(env.IA_MAX_TOKENS) || 4096,
    peticionesPorMinuto: Number(env.IA_PETICIONES_POR_MINUTO) || 30,
    ...(env.IA_HERRAMIENTAS ? { herramientas: env.IA_HERRAMIENTAS === 'true' } : {}),
  };
}

const mensaje = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(400_000).nullable().optional(),
}).passthrough();

const esquemaChat = z.object({
  messages: z.array(mensaje).min(1).max(400),
  model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(64_000).optional(),
  tools: z.array(z.object({ name: z.string().max(120), description: z.string().max(4000), parameters: z.record(z.unknown()) })).max(160).optional(),
  toolChoice: z.enum(['auto', 'none', 'required']).optional(),
  requestId: z.string().regex(/^[\w-]{1,80}$/).optional(),
  meta: z.object({ purpose: z.string().max(60).optional(), role: z.string().max(60).optional(), runId: z.string().max(80).optional() }).optional(),
});

/** Ventana deslizante de 60 s por usuario (en memoria; con varias instancias, mover a Redis/BD). */
export function crearLimitador(porMinuto: number, ahora: () => number = Date.now) {
  const historial = new Map<string, number[]>();
  return (usuario: string): boolean => {
    const t = ahora();
    const recientes = (historial.get(usuario) ?? []).filter((x) => t - x < 60_000);
    if (recientes.length >= porMinuto) {
      historial.set(usuario, recientes);
      return false;
    }
    recientes.push(t);
    historial.set(usuario, recientes);
    return true;
  };
}

export type OpcionesIA = {
  verificar: VerificadorJwt;
  config: ConfigIA | null;
  /** Inyectables para pruebas. */
  chat?: typeof aiChat;
  chatStream?: typeof aiChatStream;
  ahora?: () => number;
};

export function rutasIA(o: OpcionesIA): Router {
  const r = Router();
  const chat = o.chat ?? aiChat;
  const chatStream = o.chatStream ?? aiChatStream;
  const limitar = crearLimitador(o.config?.peticionesPorMinuto ?? 30, o.ahora);
  r.use(express.json({ limit: '4mb' }));
  r.use(exigirAutenticacion(o.verificar));

  const preparar = (req: Request): AiChatRequest => {
    const cfg = o.config;
    if (!cfg) throw new ErrorApi(503, 'ia_no_configurada', 'la IA no está configurada en este servidor');
    if (!limitar(req.identidad!.userId)) throw new ErrorApi(429, 'demasiadas_peticiones', 'límite de peticiones de IA por minuto alcanzado');
    const d = esquemaChat.parse(req.body);
    if (d.model && !cfg.modelosPermitidos.includes(d.model)) throw new ErrorApi(400, 'modelo_no_permitido', `modelo no permitido: ${d.model}`);
    return {
      kind: cfg.proveedor,
      baseUrl: cfg.baseUrl,
      ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      model: d.model ?? cfg.modelo,
      messages: d.messages as AiChatRequest['messages'],
      maxTokens: Math.min(d.maxTokens ?? cfg.maxTokens, cfg.maxTokens),
      ...(d.temperature !== undefined ? { temperature: d.temperature } : {}),
      ...(d.tools ? { tools: d.tools } : {}),
      ...(d.toolChoice ? { toolChoice: d.toolChoice } : {}),
      // El id de cancelación se aísla por usuario para que nadie cancele peticiones ajenas.
      ...(d.requestId ? { requestId: `${req.identidad!.userId}:${d.requestId}` } : {}),
      ...(d.meta ? { meta: d.meta } : {}),
      ...(cfg.herramientas !== undefined ? { custom: { supportsTools: cfg.herramientas } } : {}),
    };
  };

  /** Disponibilidad y modelos (para el panel del asistente en la web). */
  r.get('/estado', async (_req, res) => {
    const cfg = o.config;
    if (!cfg) {
      res.json({ disponible: false, motivo: 'ia_no_configurada' });
      return;
    }
    const salud = await aiHealth({ kind: cfg.proveedor, baseUrl: cfg.baseUrl, ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}) }).catch(() => null);
    res.json({
      disponible: salud?.status === 'healthy',
      proveedor: cfg.proveedor,
      modelo: cfg.modelo,
      modelos: cfg.modelosPermitidos,
      ...(salud && salud.status !== 'healthy' ? { motivo: salud.error ?? salud.status } : {}),
    });
  });

  r.post('/chat', async (req, res) => {
    const resultado = await chat(preparar(req));
    res.json(resultado);
  });

  /** Streaming por SSE: `data: {"type":"delta","text"}` … y al final `data: {"type":"done","result"}`. */
  r.post('/chat/stream', async (req, res) => {
    const peticion = preparar(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const enviar = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    req.on('close', () => {
      if (peticion.requestId && !res.writableEnded) cancelAiChat(peticion.requestId);
    });
    try {
      const resultado = await chatStream(peticion, (text) => enviar({ type: 'delta', text }));
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

  return r;
}
