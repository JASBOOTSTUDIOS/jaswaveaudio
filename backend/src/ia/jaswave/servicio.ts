/**
 * JasWave IA: los modelos «de marca» que ven los usuarios, sus planes de uso y el contador de consumo.
 *
 * - Un modelo JasWave (Rápido, Creativo, Profundo) es una cadena de conexión + modelo real que solo
 *   conoce el admin. «JasWave Auto» es virtual: elige el modelo según el propósito de la petición.
 * - El plan se asigna a la licencia del producto «Asistente IA» del usuario (o se usa el plan por
 *   defecto) y limita créditos por día y por mes, peticiones por minuto y qué modelos puede usar.
 * - Cada petición deja una fila de consumo (tokens, créditos, duración y si funcionó).
 * - Al usuario nunca le llegan nombres de conexiones ni de modelos reales.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../db.js';
import type { Identidad } from '../../auth/verificador-jwt.js';
import { ErrorApi } from '../../http/errores.js';
import { auditar, sincronizarUsuario } from '../../license/servicio.js';
import { cifrarSecreto, descifrarSecreto, type ClaveMaestra } from '../../seguridad/cifrado.js';
import type { AiChatResult, AiErrorCode, AiProviderCustom, AiProviderKind } from '../gateway/ai-gateway.js';
import { aadProveedor, PRODUCTO_IA, type PermisosIA } from '../proveedores.js';
import { crearEnrutador, type ChatDirecto, type Enrutador, type Intento, type PeticionBase, type Razonamiento } from './enrutador.js';
import { periodosDe } from './periodos.js';

export const MODELO_AUTO = 'auto';
export const NOMBRE_SERVICIO = 'JasWave IA';

export type EslabonCadena = { proveedorId: string; modelo: string; razonamiento: Razonamiento };

export type ModeloJasWavePublico = { id: string; nombre: string; descripcion: string };

export type ModeloJasWaveAdmin = ModeloJasWavePublico & {
  orden: number;
  activo: boolean;
  cadena: EslabonCadena[];
  creditosPorMil: number;
  maxTokens: number;
};

export type PlanIAApi = {
  id: string;
  nombre: string;
  descripcion: string;
  creditosDia: number | null;
  creditosMes: number | null;
  peticionesMinuto: number;
  modelos: string[];
  porDefecto: boolean;
  usuarios?: number;
};

export type Cupo = { usados: number; limite: number | null; renuevaEn: string };
export type ResumenConsumo = { plan: { id: string; nombre: string } | null; ilimitado: boolean; dia: Cupo; mes: Cupo };

export type CatalogoJasWave = { modelos: ModeloJasWavePublico[]; consumo: ResumenConsumo };

/** «Auto» según el propósito de la petición (el cliente lo manda en `meta.purpose`). */
const PREFERENCIA_POR_PROPOSITO: Record<string, string[]> = {
  creativo: ['creativo', 'rapido', 'profundo'],
  reasoning: ['creativo', 'rapido', 'profundo'],
  council: ['creativo', 'rapido', 'profundo'],
  analisis: ['profundo', 'creativo', 'rapido'],
};
const PREFERENCIA_GENERAL = ['rapido', 'creativo', 'profundo'];

const AUTO: ModeloJasWavePublico = { id: MODELO_AUTO, nombre: 'JasWave Auto', descripcion: 'Elige el mejor modelo para cada tarea (recomendado).' };

const esquemaEslabon = z.object({
  proveedorId: z.string().uuid(),
  modelo: z.string().min(1).max(200),
  razonamiento: z.enum(['off', 'bajo', 'normal']).default('off'),
});
export const esquemaModeloJasWave = z.object({
  nombre: z.string().min(1).max(60),
  descripcion: z.string().max(200).default(''),
  orden: z.number().int().min(0).max(1000).optional(),
  activo: z.boolean().optional(),
  cadena: z.array(esquemaEslabon).max(12).default([]),
  creditosPorMil: z.number().min(0).max(1000).optional(),
  maxTokens: z.number().int().min(256).max(64_000).optional(),
});
const idModelo = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, 'id en minúsculas, números o guiones');

export const esquemaPlan = z.object({
  nombre: z.string().min(1).max(60),
  descripcion: z.string().max(200).default(''),
  creditosDia: z.number().int().positive().nullable().default(null),
  creditosMes: z.number().int().positive().nullable().default(null),
  peticionesMinuto: z.number().int().positive().max(10_000).default(20),
  modelos: z.array(z.string().max(40)).max(50).default([]),
  porDefecto: z.boolean().default(false),
});

/** Modelos y planes que se crean la primera vez (el admin los cambia después). */
const MODELOS_INICIALES: Array<Omit<ModeloJasWaveAdmin, 'cadena' | 'activo'>> = [
  { id: 'rapido', nombre: 'JasWave Rápido', descripcion: 'Respuestas y ediciones al instante.', orden: 1, creditosPorMil: 1, maxTokens: 8192 },
  { id: 'creativo', nombre: 'JasWave Creativo', descripcion: 'Composición y arreglos con más imaginación.', orden: 2, creditosPorMil: 1.5, maxTokens: 12_000 },
  { id: 'profundo', nombre: 'JasWave Profundo', descripcion: 'Análisis detallado; tarda un poco más.', orden: 3, creditosPorMil: 2, maxTokens: 16_000 },
];
const PLANES_INICIALES: Array<z.input<typeof esquemaPlan>> = [
  { nombre: 'Básico', descripcion: 'Para empezar.', creditosDia: 150, creditosMes: 2000, peticionesMinuto: 60, modelos: [], porDefecto: true },
  { nombre: 'Pro', descripcion: 'Producción diaria.', creditosDia: 800, creditosMes: 15_000, peticionesMinuto: 120, modelos: [] },
  { nombre: 'Estudio', descripcion: 'Sin límite de créditos.', creditosDia: null, creditosMes: null, peticionesMinuto: 240, modelos: [] },
];

export async function sembrarJasWaveIA(db: Db): Promise<void> {
  if ((await db.modeloJasWave.count()) === 0) {
    for (const m of MODELOS_INICIALES) {
      await db.modeloJasWave.create({ data: { ...m, cadena: [] } });
    }
  }
  // Fila de «Auto» para que el admin pueda renombrarlo (no tiene cadena: elige el servidor).
  await db.modeloJasWave.upsert({ where: { id: MODELO_AUTO }, create: { id: MODELO_AUTO, nombre: AUTO.nombre, descripcion: AUTO.descripcion, orden: 0 }, update: {} });
  if ((await db.planIA.count()) === 0) {
    for (const p of PLANES_INICIALES) await db.planIA.create({ data: esquemaPlan.parse(p) });
  }
}

type FilaModelo = {
  id: string;
  nombre: string;
  descripcion: string;
  orden: number;
  activo: boolean;
  cadena: unknown;
  creditosPorMil: number;
  maxTokens: number;
};
type FilaPlan = {
  id: string;
  nombre: string;
  descripcion: string;
  creditosDia: number | null;
  creditosMes: number | null;
  peticionesMinuto: number;
  modelos: string[];
  porDefecto: boolean;
};

const cadenaDe = (f: FilaModelo): EslabonCadena[] => {
  const r = z.array(esquemaEslabon).safeParse(f.cadena);
  return r.success ? r.data : [];
};
const modeloAdmin = (f: FilaModelo): ModeloJasWaveAdmin => ({
  id: f.id,
  nombre: f.nombre,
  descripcion: f.descripcion,
  orden: f.orden,
  activo: f.activo,
  cadena: cadenaDe(f),
  creditosPorMil: f.creditosPorMil,
  maxTokens: f.maxTokens,
});
const planApi = (p: FilaPlan, usuarios?: number): PlanIAApi => ({
  id: p.id,
  nombre: p.nombre,
  descripcion: p.descripcion,
  creditosDia: p.creditosDia,
  creditosMes: p.creditosMes,
  peticionesMinuto: p.peticionesMinuto,
  modelos: p.modelos,
  porDefecto: p.porDefecto,
  ...(usuarios !== undefined ? { usuarios } : {}),
});

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Créditos de una petición: tokens totales / 1000 × factor del modelo. */
export function creditosDe(tokens: { entrada: number; salida: number }, porMil: number): number {
  return redondear(((tokens.entrada + tokens.salida) / 1000) * porMil);
}

/** Tokens aproximados cuando el proveedor no informa el consumo (≈ 4 caracteres por token). */
export function estimarTokens(base: PeticionBase, r: AiChatResult): { entrada: number; salida: number } {
  const entrada = base.messages.reduce((n, m) => n + String(m.content ?? '').length, 0) + JSON.stringify(base.tools ?? []).length;
  const salida = String(r.content ?? '').length + JSON.stringify(r.toolCalls ?? []).length;
  return { entrada: Math.ceil(entrada / 4), salida: Math.ceil(salida / 4) };
}

/** Mensaje para el usuario sin nombres de proveedores ni de modelos reales. */
export function falloPublico(r: AiChatResult): AiChatResult {
  const ocupado: AiErrorCode[] = ['rate_limit', 'service_unavailable', 'timeout', 'empty_response', 'provider_error', 'not_available', 'connection', 'unknown', 'model_not_found', 'payment_required', 'unauthorized', 'forbidden'];
  if (r.errorCode === 'cancelled') return { success: false, error: 'Solicitud cancelada.', errorCode: 'cancelled', provider: 'jaswave' };
  if (r.toolsUnsupported) return { success: false, error: 'El modelo no admite herramientas.', errorCode: 'bad_request', toolsUnsupported: true, provider: 'jaswave' };
  if (r.errorCode && ocupado.includes(r.errorCode)) {
    return {
      success: false,
      error: `${NOMBRE_SERVICIO} está muy ocupada ahora mismo.`,
      errorCode: 'service_unavailable',
      hint: 'Vuelve a intentarlo en unos segundos.',
      provider: 'jaswave',
    };
  }
  return { success: false, error: `${NOMBRE_SERVICIO} no pudo procesar la petición.`, errorCode: r.errorCode ?? 'unknown', hint: 'Reformula el pedido o inténtalo de nuevo.', provider: 'jaswave' };
}

export type OpcionesJasWave = {
  db: Db;
  claveMaestra: ClaveMaestra | null;
  permisos: (id: Identidad) => Promise<PermisosIA>;
  chat: ChatDirecto;
  ahora?: () => Date;
  zonaHoraria?: string;
};

export type PeticionJasWave = { modelo?: string; proposito?: string; base: PeticionBase };

export function crearServicioJasWave(o: OpcionesJasWave) {
  const { db } = o;
  const ahora = o.ahora ?? (() => new Date());
  const zona = o.zonaHoraria ?? 'UTC';
  const enrutador: Enrutador = crearEnrutador({ chat: o.chat, ahora: () => ahora().getTime() });
  const minuto = new Map<string, number[]>();

  const claveMaestra = (): ClaveMaestra => {
    if (!o.claveMaestra) throw new ErrorApi(503, 'ia_sin_clave_maestra', 'el servidor no tiene IA_CLAVE_MAESTRA configurada');
    return o.claveMaestra;
  };
  const aadClave = (proveedorId: string, claveId: string) => `ia-clave:${proveedorId}:${claveId}`;
  /** La clave propia de la conexión se lista como `<conexión>:principal` (o solo `principal`). */
  const esPrincipal = (proveedorId: string, claveId: string) => claveId === 'principal' || claveId === `${proveedorId}:principal`;

  // ---------- Caché de intentos (conexiones + claves descifradas), 30 s o hasta un cambio del admin ----------
  let cache: { hasta: number; modelos: FilaModelo[]; conexiones: Map<string, Omit<Intento, 'modelo' | 'razonamiento'>> } | null = null;
  const invalidar = () => {
    cache = null;
  };

  async function cargar() {
    const t = ahora().getTime();
    if (cache && cache.hasta > t) return cache;
    const [modelos, provs] = await Promise.all([
      db.modeloJasWave.findMany({ orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }] }),
      db.proveedorIA.findMany({ where: { propietarioId: null, activo: true }, include: { claves: { where: { activa: true }, orderBy: { creadaEn: 'asc' } } } }),
    ]);
    const conexiones = new Map<string, Omit<Intento, 'modelo' | 'razonamiento'>>();
    for (const p of provs) {
      const claves: Intento['claves'] = [];
      try {
        if (p.claveCifrada?.length) claves.push({ id: `${p.id}:principal`, apiKey: descifrarSecreto(claveMaestra(), p.claveCifrada, aadProveedor(p.id, p.versionClave)) });
        for (const c of p.claves) claves.push({ id: c.id, apiKey: descifrarSecreto(claveMaestra(), c.claveCifrada, aadClave(p.id, c.id)) });
      } catch {
        continue; // clave ilegible (clave maestra cambiada): la conexión queda fuera
      }
      conexiones.set(p.id, {
        conexionId: p.id,
        kind: p.tipo as AiProviderKind,
        baseUrl: p.baseUrl,
        ...(p.custom || p.herramientas !== null
          ? { custom: { ...((p.custom as AiProviderCustom | null) ?? {}), ...(p.herramientas !== null ? { supportsTools: p.herramientas } : {}) } }
          : {}),
        claves,
      });
    }
    cache = { hasta: t + 30_000, modelos: modelos as FilaModelo[], conexiones };
    return cache;
  }

  /** Modelos activos que tienen al menos un eslabón utilizable. */
  async function modelosOperativos(): Promise<FilaModelo[]> {
    const c = await cargar();
    return c.modelos.filter((m) => m.activo && cadenaDe(m).some((e) => c.conexiones.has(e.proveedorId)));
  }

  function intentosDe(m: FilaModelo, c: NonNullable<typeof cache>): Intento[] {
    return cadenaDe(m)
      .map((e) => {
        const cx = c.conexiones.get(e.proveedorId);
        return cx ? { ...cx, modelo: e.modelo, razonamiento: e.razonamiento } : null;
      })
      .filter((x): x is Intento => x !== null);
  }

  // ---------- Planes y consumo ----------
  async function planPorDefecto(): Promise<FilaPlan | null> {
    return (await db.planIA.findFirst({ where: { porDefecto: true }, orderBy: { creadoEn: 'asc' } })) as FilaPlan | null;
  }

  /** Plan del usuario (null = sin límites: administradores o sin ningún plan definido). */
  async function planDe(id: Identidad): Promise<{ usuarioId: string; plan: FilaPlan | null }> {
    const usuario = await sincronizarUsuario(db, id);
    if (id.esAdmin) return { usuarioId: usuario.id, plan: null };
    const lic = await db.licencia.findUnique({ where: { usuarioId_productoId: { usuarioId: usuario.id, productoId: PRODUCTO_IA } }, include: { planIA: true } });
    return { usuarioId: usuario.id, plan: ((lic?.planIA as FilaPlan | null) ?? (await planPorDefecto())) };
  }

  async function sumaCreditos(usuarioId: string, desde: Date): Promise<number> {
    const r = await db.consumoIA.aggregate({ where: { usuarioId, creadoEn: { gte: desde } }, _sum: { creditos: true } });
    return redondear(r._sum.creditos ?? 0);
  }

  async function resumen(usuarioId: string, plan: FilaPlan | null): Promise<ResumenConsumo> {
    const p = periodosDe(ahora(), zona);
    const [dia, mes] = await Promise.all([sumaCreditos(usuarioId, p.inicioDia), sumaCreditos(usuarioId, p.inicioMes)]);
    return {
      plan: plan ? { id: plan.id, nombre: plan.nombre } : null,
      ilimitado: !plan || (plan.creditosDia === null && plan.creditosMes === null),
      dia: { usados: dia, limite: plan?.creditosDia ?? null, renuevaEn: p.finDia.toISOString() },
      mes: { usados: mes, limite: plan?.creditosMes ?? null, renuevaEn: p.finMes.toISOString() },
    };
  }

  function exigirMinuto(usuarioId: string, porMinuto: number) {
    const t = ahora().getTime();
    const recientes = (minuto.get(usuarioId) ?? []).filter((x) => t - x < 60_000);
    if (recientes.length >= porMinuto) {
      minuto.set(usuarioId, recientes);
      throw new ErrorApi(429, 'demasiadas_peticiones', 'Demasiadas peticiones seguidas al asistente: espera unos segundos.');
    }
    recientes.push(t);
    minuto.set(usuarioId, recientes);
  }

  const permitido = (plan: FilaPlan | null, modeloId: string) => !plan || !plan.modelos.length || plan.modelos.includes(modeloId);

  async function registrar(fila: { usuarioId: string; modelo: string; modeloReal?: string; proveedorId?: string; proposito?: string; entrada: number; salida: number; creditos: number; ms: number; ok: boolean }) {
    await db.consumoIA
      .create({
        data: {
          usuarioId: fila.usuarioId,
          modelo: fila.modelo,
          modeloReal: fila.modeloReal ?? '',
          ...(fila.proveedorId ? { proveedorId: fila.proveedorId } : {}),
          proposito: (fila.proposito ?? '').slice(0, 40),
          tokensEntrada: fila.entrada,
          tokensSalida: fila.salida,
          creditos: fila.creditos,
          ms: fila.ms,
          ok: fila.ok,
        },
      })
      .catch(() => undefined); // el contador nunca debe tumbar una respuesta
  }

  return {
    /** Modelos JasWave que el usuario puede usar, con su consumo. */
    async catalogo(id: Identidad, permisos?: PermisosIA): Promise<CatalogoJasWave> {
      const p = permisos ?? (await o.permisos(id));
      const { usuarioId, plan } = await planDe(id);
      const consumo = await resumen(usuarioId, plan);
      if (!p.usar) return { modelos: [], consumo };
      const operativos = (await modelosOperativos()).filter((m) => permitido(plan, m.id));
      const modelos: ModeloJasWavePublico[] = operativos.map((m) => ({ id: m.id, nombre: m.nombre, descripcion: m.descripcion }));
      // «Auto» no tiene cadena propia; su nombre y descripción los fija el admin en su fila.
      const filaAuto = (await cargar()).modelos.find((m) => m.id === MODELO_AUTO);
      const auto = filaAuto ? { id: MODELO_AUTO, nombre: filaAuto.nombre, descripcion: filaAuto.descripcion } : AUTO;
      return { modelos: modelos.length ? [auto, ...modelos] : [], consumo };
    },

    async consumo(id: Identidad): Promise<ResumenConsumo> {
      const { usuarioId, plan } = await planDe(id);
      return resumen(usuarioId, plan);
    },

    /** ¿El id pedido es un modelo JasWave (o «auto»)? */
    async esModelo(modelo: string | undefined): Promise<boolean> {
      if (!modelo || modelo === MODELO_AUTO) return true;
      return (await cargar()).modelos.some((m) => m.id === modelo);
    },

    async chat(id: Identidad, d: PeticionJasWave, opts: { signal?: AbortSignal; onDelta?: (t: string) => void } = {}): Promise<AiChatResult & { creditos?: number }> {
      const permisos = await o.permisos(id);
      if (!permisos.usar) throw new ErrorApi(403, 'sin_permiso', 'tu cuenta no tiene acceso al asistente de IA');
      const { usuarioId, plan } = await planDe(id);
      if (plan) {
        exigirMinuto(usuarioId, plan.peticionesMinuto);
        const r = await resumen(usuarioId, plan);
        if (r.dia.limite !== null && r.dia.usados >= r.dia.limite) {
          throw new ErrorApi(429, 'cuota_agotada', `Has usado los ${r.dia.limite} créditos de IA de hoy. Se renuevan a medianoche.`);
        }
        if (r.mes.limite !== null && r.mes.usados >= r.mes.limite) {
          throw new ErrorApi(429, 'cuota_agotada', `Has usado los ${r.mes.limite} créditos de IA de este mes.`);
        }
      }
      const c = await cargar();
      const operativos = (await modelosOperativos()).filter((m) => permitido(plan, m.id));
      if (!operativos.length) throw new ErrorApi(503, 'ia_no_configurada', `${NOMBRE_SERVICIO} no está disponible para tu cuenta.`);
      const pedido = d.modelo ?? MODELO_AUTO;
      let orden: FilaModelo[];
      if (pedido === MODELO_AUTO) {
        const pref = PREFERENCIA_POR_PROPOSITO[d.proposito ?? ''] ?? PREFERENCIA_GENERAL;
        orden = [...operativos].sort((a, b) => {
          const ia = pref.indexOf(a.id);
          const ib = pref.indexOf(b.id);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
      } else {
        const m = operativos.find((x) => x.id === pedido);
        if (!m) throw new ErrorApi(403, 'modelo_no_permitido', 'tu plan no incluye este modelo');
        // Si el elegido no responde se cubre con los demás modelos permitidos.
        orden = [m, ...operativos.filter((x) => x.id !== m.id)];
      }
      const principal = orden[0]!;
      const vistos = new Set<string>();
      const intentos = orden
        .flatMap((m) => intentosDe(m, c))
        .filter((i) => {
          const k = `${i.conexionId}|${i.modelo}|${i.razonamiento}`;
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        });
      const base: PeticionBase = { ...d.base, maxTokens: Math.min(d.base.maxTokens ?? principal.maxTokens, principal.maxTokens) };
      const conHerramientas = Boolean(base.tools?.length);
      const r = await enrutador.ejecutar(intentos, base, {
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onDelta ? { onDelta: opts.onDelta } : {}),
        // Sin razonamiento oculto los modelos responden en 2–6 s: si uno tarda más, se cubre pronto.
        cubrirTrasMs: opts.onDelta ? 6_000 : conHerramientas ? 10_000 : 14_000,
        maxParalelo: 2,
        timeoutMs: 120_000,
      });
      const usado = r.ganador ? orden.find((m) => intentosDe(m, c).some((i) => i.conexionId === r.ganador!.conexionId && i.modelo === r.ganador!.modelo)) ?? principal : principal;
      const tokens = r.usage ?? (r.resultado.success ? estimarTokens(base, r.resultado) : { entrada: 0, salida: 0 });
      const creditos = r.resultado.success ? creditosDe(tokens, usado.creditosPorMil) : 0;
      await registrar({
        usuarioId,
        modelo: usado.id,
        modeloReal: r.ganador?.modelo ?? '',
        ...(r.ganador ? { proveedorId: r.ganador.conexionId } : {}),
        proposito: d.proposito,
        entrada: tokens.entrada,
        salida: tokens.salida,
        creditos,
        ms: r.ms,
        ok: r.resultado.success,
      });
      if (!r.resultado.success) {
        // El usuario solo ve «muy ocupada»: aquí queda la causa real (códigos por intento, sin claves).
        console.warn(
          `[jaswave-ia] sin respuesta en ${r.ms} ms (${r.resultado.errorCode ?? 'sin código'}): ${r.intentos.map((x) => `${x.modelo}=${x.ok ? 'ok' : x.codigo ?? '?'}/${x.ms}ms`).join(', ') || 'sin intentos'}`,
        );
        return falloPublico(r.resultado);
      }
      return {
        success: true,
        content: r.resultado.content ?? '',
        ...(r.resultado.toolCalls?.length ? { toolCalls: r.resultado.toolCalls } : {}),
        model: usado.id,
        provider: 'jaswave',
        creditos,
      };
    },

    /** Consumo de peticiones a conexiones directas o modelos propios (sin cuota; solo contador). */
    async registrarDirecto(id: Identidad, fila: { proveedorId: string; modeloReal: string; proposito?: string; base: PeticionBase; resultado: AiChatResult; ms: number }) {
      const usuario = await sincronizarUsuario(db, id);
      const tokens = fila.resultado.usage ?? estimarTokens(fila.base, fila.resultado);
      await registrar({
        usuarioId: usuario.id,
        modelo: 'conexion',
        modeloReal: fila.modeloReal,
        proveedorId: fila.proveedorId,
        proposito: fila.proposito,
        entrada: tokens.entrada,
        salida: tokens.salida,
        creditos: 0,
        ms: fila.ms,
        ok: fila.resultado.success,
      });
    },

    async disponible(): Promise<boolean> {
      return (await modelosOperativos()).length > 0;
    },

    admin: {
      invalidar,

      async modelos(): Promise<ModeloJasWaveAdmin[]> {
        const filas = await db.modeloJasWave.findMany({ orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }] });
        return (filas as FilaModelo[]).map(modeloAdmin);
      },

      async guardarModelo(actor: string, modeloId: string, datos: unknown): Promise<ModeloJasWaveAdmin> {
        const mid = idModelo.parse(modeloId);
        const d = esquemaModeloJasWave.parse(datos);
        // «Auto» elige modelo en el servidor: del admin solo toma nombre y descripción.
        if (mid === MODELO_AUTO) d.cadena = [];
        if (d.cadena.length) {
          const provs = await db.proveedorIA.findMany({ where: { id: { in: d.cadena.map((e) => e.proveedorId) }, propietarioId: null } });
          for (const e of d.cadena) {
            const p = provs.find((x) => x.id === e.proveedorId);
            if (!p) throw new ErrorApi(400, 'conexion_invalida', 'una de las conexiones de la cadena no existe');
            if (!p.modelos.includes(e.modelo)) throw new ErrorApi(400, 'modelo_invalido', `el modelo ${e.modelo} no está en la conexión «${p.nombre}»`);
          }
        }
        const data = {
          nombre: d.nombre,
          descripcion: d.descripcion,
          cadena: d.cadena,
          ...(d.orden !== undefined ? { orden: d.orden } : {}),
          ...(d.activo !== undefined ? { activo: d.activo } : {}),
          ...(d.creditosPorMil !== undefined ? { creditosPorMil: d.creditosPorMil } : {}),
          ...(d.maxTokens !== undefined ? { maxTokens: d.maxTokens } : {}),
        };
        const fila = await db.modeloJasWave.upsert({ where: { id: mid }, create: { id: mid, ...data }, update: data });
        await auditar(db, actor, 'ia.modelo.guardar', mid, { eslabones: d.cadena.length });
        invalidar();
        return modeloAdmin(fila as FilaModelo);
      },

      /** Prueba cada eslabón de la cadena por separado (solo admin): latencia y si responde. */
      async probarModelo(modeloId: string) {
        const fila = await db.modeloJasWave.findUnique({ where: { id: idModelo.parse(modeloId) } });
        if (!fila) throw new ErrorApi(404, 'modelo_no_encontrado', 'modelo no encontrado');
        invalidar();
        const c = await cargar();
        const intentos = intentosDe(fila as FilaModelo, c);
        const base: PeticionBase = { messages: [{ role: 'user', content: 'Responde solo con la palabra: listo' }], maxTokens: 400, temperature: 0 };
        return Promise.all(
          intentos.map(async (i) => {
            const r = await enrutador.ejecutar([i], base, { cubrirTrasMs: 60_000, maxParalelo: 1, timeoutMs: 60_000 });
            return { conexionId: i.conexionId, modelo: i.modelo, razonamiento: i.razonamiento, ok: r.resultado.success, ms: r.ms, ...(r.resultado.success ? {} : { error: r.resultado.error ?? r.resultado.errorCode }) };
          }),
        );
      },

      async eliminarModelo(actor: string, modeloId: string): Promise<void> {
        if (modeloId === MODELO_AUTO) throw new ErrorApi(400, 'id_reservado', '«Auto» no se puede eliminar; puedes renombrarlo');
        await db.modeloJasWave.delete({ where: { id: idModelo.parse(modeloId) } }).catch(() => {
          throw new ErrorApi(404, 'modelo_no_encontrado', 'modelo no encontrado');
        });
        await auditar(db, actor, 'ia.modelo.eliminar', modeloId);
        invalidar();
      },

      async planes(): Promise<PlanIAApi[]> {
        const filas = await db.planIA.findMany({ orderBy: { creadoEn: 'asc' }, include: { _count: { select: { licencias: true } } } });
        return filas.map((p) => planApi(p as FilaPlan, p._count.licencias));
      },

      async guardarPlan(actor: string, planId: string | null, datos: unknown): Promise<PlanIAApi> {
        const d = esquemaPlan.parse(datos);
        const fila = await db.$transaction(async (tx) => {
          if (d.porDefecto) await tx.planIA.updateMany({ where: { porDefecto: true, ...(planId ? { id: { not: planId } } : {}) }, data: { porDefecto: false } });
          return planId ? tx.planIA.update({ where: { id: planId }, data: d }) : tx.planIA.create({ data: { id: randomUUID(), ...d } });
        });
        await auditar(db, actor, planId ? 'ia.plan.actualizar' : 'ia.plan.crear', fila.id, { nombre: fila.nombre });
        return planApi(fila as FilaPlan);
      },

      async eliminarPlan(actor: string, planId: string): Promise<void> {
        await db.planIA.delete({ where: { id: planId } }).catch(() => {
          throw new ErrorApi(404, 'plan_no_encontrado', 'plan no encontrado');
        });
        await auditar(db, actor, 'ia.plan.eliminar', planId);
      },

      /** Asigna (o quita) el plan en la licencia del asistente; la crea activa si no existía. */
      async asignarPlan(actor: string, usuarioId: string, planId: string | null): Promise<void> {
        if (planId && !(await db.planIA.findUnique({ where: { id: planId } }))) throw new ErrorApi(404, 'plan_no_encontrado', 'plan no encontrado');
        if (!(await db.usuario.findUnique({ where: { id: usuarioId } }))) throw new ErrorApi(404, 'usuario_no_encontrado', 'usuario no encontrado');
        await db.producto.upsert({ where: { id: PRODUCTO_IA }, create: { id: PRODUCTO_IA, nombre: 'Asistente IA' }, update: {} });
        await db.licencia.upsert({
          where: { usuarioId_productoId: { usuarioId, productoId: PRODUCTO_IA } },
          create: { usuarioId, productoId: PRODUCTO_IA, planIAId: planId },
          update: { planIAId: planId },
        });
        await auditar(db, actor, 'ia.plan.asignar', usuarioId, { planId });
      },

      /** Consumo agregado: por modelo, por usuario (con su plan y cupos) y por día. */
      async consumo(dias = 30) {
        const desde = new Date(ahora().getTime() - dias * 86_400_000);
        const p = periodosDe(ahora(), zona);
        const [porModelo, porUsuarioMes, porUsuarioDia, usuarios, filasDia, defecto] = await Promise.all([
          db.consumoIA.groupBy({
            by: ['modelo', 'ok'],
            where: { creadoEn: { gte: desde } },
            _count: { _all: true },
            _sum: { creditos: true, tokensEntrada: true, tokensSalida: true, ms: true },
          }),
          db.consumoIA.groupBy({ by: ['usuarioId'], where: { creadoEn: { gte: p.inicioMes } }, _sum: { creditos: true }, _count: { _all: true } }),
          db.consumoIA.groupBy({ by: ['usuarioId'], where: { creadoEn: { gte: p.inicioDia } }, _sum: { creditos: true } }),
          db.usuario.findMany({
            select: { id: true, email: true, esAdmin: true, licencias: { where: { productoId: PRODUCTO_IA }, select: { estado: true, planIA: { select: { id: true, nombre: true, creditosDia: true, creditosMes: true } } } } },
            orderBy: { email: 'asc' },
          }),
          db.consumoIA.findMany({ where: { creadoEn: { gte: desde } }, select: { creadoEn: true, creditos: true } }),
          planPorDefecto(),
        ]);
        const modelos = new Map<string, { modelo: string; peticiones: number; fallos: number; creditos: number; tokens: number; msMedio: number }>();
        for (const g of porModelo) {
          const m = modelos.get(g.modelo) ?? { modelo: g.modelo, peticiones: 0, fallos: 0, creditos: 0, tokens: 0, msMedio: 0 };
          const n = g._count._all;
          m.msMedio = Math.round((m.msMedio * m.peticiones + (g._sum.ms ?? 0)) / Math.max(1, m.peticiones + n));
          m.peticiones += n;
          if (!g.ok) m.fallos += n;
          m.creditos = redondear(m.creditos + (g._sum.creditos ?? 0));
          m.tokens += (g._sum.tokensEntrada ?? 0) + (g._sum.tokensSalida ?? 0);
          modelos.set(g.modelo, m);
        }
        const mes = new Map(porUsuarioMes.map((g) => [g.usuarioId, { creditos: redondear(g._sum.creditos ?? 0), peticiones: g._count._all }]));
        const hoy = new Map(porUsuarioDia.map((g) => [g.usuarioId, redondear(g._sum.creditos ?? 0)]));
        const dia = new Map<string, { dia: string; creditos: number; peticiones: number }>();
        for (const f of filasDia) {
          const k = f.creadoEn.toISOString().slice(0, 10);
          const x = dia.get(k) ?? { dia: k, creditos: 0, peticiones: 0 };
          x.creditos = redondear(x.creditos + f.creditos);
          x.peticiones += 1;
          dia.set(k, x);
        }
        return {
          porModelo: [...modelos.values()].sort((a, b) => b.peticiones - a.peticiones),
          porUsuario: usuarios.map((u) => {
            const lic = u.licencias[0];
            const plan = u.esAdmin ? null : (lic?.planIA ?? (defecto ? { id: defecto.id, nombre: defecto.nombre, creditosDia: defecto.creditosDia, creditosMes: defecto.creditosMes } : null));
            return {
              usuarioId: u.id,
              email: u.email,
              esAdmin: u.esAdmin,
              licencia: lic?.estado ?? null,
              plan: plan ? { id: plan.id, nombre: plan.nombre, asignado: Boolean(lic?.planIA) } : null,
              dia: { usados: hoy.get(u.id) ?? 0, limite: plan?.creditosDia ?? null },
              mes: { usados: mes.get(u.id)?.creditos ?? 0, limite: plan?.creditosMes ?? null, peticiones: mes.get(u.id)?.peticiones ?? 0 },
            };
          }),
          porDia: [...dia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
        };
      },

      // ---------- Grupo de claves de una conexión ----------
      async claves(proveedorId: string) {
        const p = await db.proveedorIA.findUnique({ where: { id: proveedorId }, include: { claves: { orderBy: { creadaEn: 'asc' } } } });
        if (!p || p.propietarioId) throw new ErrorApi(404, 'proveedor_no_encontrado', 'conexión no encontrada');
        const est = enrutador.estadoClaves();
        const vista = (id: string, etiqueta: string, activa: boolean, principal: boolean) => ({ id, etiqueta, activa, principal, estado: est[id] ?? null });
        return [
          ...(p.claveCifrada?.length ? [vista(`${p.id}:principal`, 'Principal', true, true)] : []),
          ...p.claves.map((c) => vista(c.id, c.etiqueta, c.activa, false)),
        ];
      },

      async agregarClave(actor: string, proveedorId: string, apiKey: string, etiqueta: string): Promise<void> {
        const p = await db.proveedorIA.findUnique({ where: { id: proveedorId } });
        if (!p || p.propietarioId) throw new ErrorApi(404, 'proveedor_no_encontrado', 'conexión no encontrada');
        const id = randomUUID();
        await db.claveProveedorIA.create({ data: { id, proveedorId, etiqueta: etiqueta.slice(0, 60), claveCifrada: cifrarSecreto(claveMaestra(), apiKey, aadClave(proveedorId, id)) } });
        await auditar(db, actor, 'ia.clave.agregar', proveedorId, { claveId: id });
        invalidar();
      },

      /** Claves activas descifradas de una conexión (principal primero), para probarla con cualquiera. */
      async clavesParaProbar(proveedorId: string): Promise<string[]> {
        const p = await db.proveedorIA.findUnique({ where: { id: proveedorId }, include: { claves: { where: { activa: true }, orderBy: { creadaEn: 'asc' } } } });
        if (!p || p.propietarioId) return [];
        const out: string[] = [];
        for (const c of p.claves) {
          try {
            out.push(descifrarSecreto(claveMaestra(), c.claveCifrada, aadClave(p.id, c.id)));
          } catch {
            /* clave ilegible: se omite */
          }
        }
        return out;
      },

      async cambiarClave(actor: string, proveedorId: string, claveId: string, cambios: { activa?: boolean; etiqueta?: string }): Promise<void> {
        if (esPrincipal(proveedorId, claveId)) {
          throw new ErrorApi(400, 'clave_principal', 'la clave principal no se puede pausar ni renombrar; puedes sustituirla o quitarla');
        }
        const r = await db.claveProveedorIA.updateMany({
          where: { id: claveId, proveedorId },
          data: { ...(cambios.activa !== undefined ? { activa: cambios.activa } : {}), ...(cambios.etiqueta !== undefined ? { etiqueta: cambios.etiqueta.slice(0, 60) } : {}) },
        });
        if (!r.count) throw new ErrorApi(404, 'clave_no_encontrada', 'clave no encontrada');
        await auditar(db, actor, 'ia.clave.cambiar', proveedorId, { claveId, ...cambios });
        invalidar();
      },

      async quitarClave(actor: string, proveedorId: string, claveId: string): Promise<void> {
        if (esPrincipal(proveedorId, claveId)) {
          const p = await db.proveedorIA.findUnique({ where: { id: proveedorId } });
          if (!p || p.propietarioId || !p.claveCifrada?.length) throw new ErrorApi(404, 'clave_no_encontrada', 'clave no encontrada');
          await db.proveedorIA.update({ where: { id: proveedorId }, data: { claveCifrada: null } });
          await auditar(db, actor, 'ia.clave.quitar', proveedorId, { claveId: 'principal' });
          invalidar();
          return;
        }
        const r = await db.claveProveedorIA.deleteMany({ where: { id: claveId, proveedorId } });
        if (!r.count) throw new ErrorApi(404, 'clave_no_encontrada', 'clave no encontrada');
        await auditar(db, actor, 'ia.clave.quitar', proveedorId, { claveId });
        invalidar();
      },
    },
  };
}

export type ServicioJasWave = ReturnType<typeof crearServicioJasWave>;
