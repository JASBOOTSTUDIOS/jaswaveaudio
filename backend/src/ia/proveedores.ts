/**
 * Proveedores de IA en la base de datos (M2).
 *
 * - Proveedores del admin (`propietarioId` null): se usan con la acción `ia.usar` + `ia.proveedor.<slug>`
 *   del producto `com.jaswave.modulo.asistente-ia` (roles, concesiones y licencia como cualquier VST).
 * - Proveedores propios del usuario: requieren `ia.modelo-propio`. Con `ejecucion=servidor` el backend los
 *   llama con red restringida (sin redes privadas); con `ejecucion=local` solo el escritorio del dueño los usa.
 * - Las claves van cifradas (AES-256-GCM, clave maestra) y nunca se devuelven salvo la credencial propia
 *   de ejecución local a su dueño.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Identidad } from '../auth/verificador-jwt.js';
import { ErrorApi } from '../http/errores.js';
import { accionesEfectivas, auditar, sincronizarUsuario } from '../license/servicio.js';
import { cifrarSecreto, descifrarSecreto, type ClaveMaestra } from '../seguridad/cifrado.js';
import { exigirUrlPublica, UrlNoPermitida, type Resolver } from '../seguridad/url-segura.js';
import type { AiProviderCustom, AiProviderKind } from './gateway/ai-gateway.js';

export const PRODUCTO_IA = 'com.jaswave.modulo.asistente-ia';
export const ACCION_USAR = 'ia.usar';
export const ACCION_MODELO_PROPIO = 'ia.modelo-propio';
export const accionDeProveedor = (slug: string) => `ia.proveedor.${slug}`;
export const MAX_PROVEEDORES_PROPIOS = 10;

export const TIPOS_PROVEEDOR = ['ollama', 'openai', 'anthropic', 'gemini', 'openrouter', 'kilocode', 'openai-compatible'] as const;

const ruta = z.string().max(200).regex(/^\/[\w\-./]*$/, 'ruta relativa que empiece por /');
const cabecera = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
export const esquemaCustom = z
  .object({
    apiStyle: z.enum(['openai', 'anthropic', 'gemini', 'ollama']).optional(),
    chatPath: ruta.optional(),
    modelsPath: ruta.optional(),
    appendV1: z.boolean().optional(),
    authStyle: z.enum(['bearer', 'x-api-key', 'none']).optional(),
    extraHeaders: z.record(cabecera, z.string().max(500)).refine((h) => Object.keys(h).length <= 20, 'máximo 20 cabeceras').optional(),
    needsApiKey: z.boolean().optional(),
  })
  .strict();

const base = {
  nombre: z.string().min(1).max(80),
  tipo: z.enum(TIPOS_PROVEEDOR),
  baseUrl: z.string().url().max(500),
  modelos: z.array(z.string().min(1).max(200)).min(1).max(50),
  modeloPorDefecto: z.string().min(1).max(200).optional(),
  maxTokens: z.number().int().positive().max(64_000).optional(),
  herramientas: z.boolean().nullable().optional(),
  custom: esquemaCustom.nullable().optional(),
  activo: z.boolean().optional(),
  apiKey: z.string().min(1).max(4000).optional(),
};

export const esquemaProveedorAdmin = z.object({
  ...base,
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'slug en minúsculas, números o guiones'),
  peticionesPorMinuto: z.number().int().positive().max(10_000).optional(),
});
export const esquemaProveedorAdminParcial = esquemaProveedorAdmin.omit({ slug: true, apiKey: true }).partial();

export const esquemaProveedorPropio = z.object({ ...base, ejecucion: z.enum(['servidor', 'local']).default('servidor') });
export const esquemaProveedorPropioParcial = esquemaProveedorPropio.omit({ apiKey: true }).partial();

export type PermisosIA = { usar: boolean; modeloPropio: boolean; proveedores: string[] };

export type ProveedorPublico = {
  id: string;
  slug: string;
  nombre: string;
  tipo: string;
  /** Solo en proveedores propios y en el panel admin. */
  baseUrl?: string;
  modelos: string[];
  modeloPorDefecto: string;
  maxTokens: number;
  herramientas: boolean | null;
  origen: 'admin' | 'propio';
  ejecucion: 'servidor' | 'local';
  activo: boolean;
  tieneClave: boolean;
  custom?: AiProviderCustom | null;
  peticionesPorMinuto?: number;
};

/** Proveedor listo para el gateway (con la clave descifrada). Nunca se serializa hacia el cliente. */
export type ProveedorResuelto = {
  id: string;
  slug: string;
  origen: 'admin' | 'propio';
  peticionesPorMinuto: number;
  modelos: string[];
  modeloPorDefecto: string;
  maxTokens: number;
  herramientas: boolean | null;
  /** true = el gateway debe usar la red restringida (URL aportada por un usuario). */
  redRestringida: boolean;
  destino: { kind: AiProviderKind; baseUrl: string; apiKey?: string; custom?: AiProviderCustom };
};

export interface ServicioProveedoresIA {
  permisos(id: Identidad): Promise<PermisosIA>;
  disponibles(id: Identidad): Promise<{ permisos: PermisosIA; proveedores: ProveedorPublico[] }>;
  /** Proveedor a usar en el servidor (el pedido o el primero permitido). Lanza 403/404/409/503. */
  resolver(id: Identidad, proveedorId?: string): Promise<ProveedorResuelto>;
  propios?: ServicioPropios;
  admin?: ServicioAdminIA;
}

export interface ServicioPropios {
  listar(id: Identidad): Promise<ProveedorPublico[]>;
  crear(id: Identidad, datos: unknown): Promise<ProveedorPublico>;
  actualizar(id: Identidad, proveedorId: string, datos: unknown): Promise<ProveedorPublico>;
  fijarClave(id: Identidad, proveedorId: string, clave: string | null): Promise<void>;
  eliminar(id: Identidad, proveedorId: string): Promise<void>;
  /** Credencial de un proveedor propio de ejecución local (solo su dueño). */
  credencialLocal(id: Identidad, proveedorId: string): Promise<ProveedorPublico & { apiKey?: string }>;
}

export interface ServicioAdminIA {
  listar(): Promise<ProveedorPublico[]>;
  listarDeUsuarios(): Promise<(ProveedorPublico & { propietario: string | null })[]>;
  crear(actor: string, datos: unknown): Promise<ProveedorPublico>;
  actualizar(actor: string, proveedorId: string, datos: unknown): Promise<ProveedorPublico>;
  fijarClave(actor: string, proveedorId: string, clave: string | null): Promise<void>;
  eliminar(actor: string, proveedorId: string): Promise<void>;
  /** Proveedor (de admin o de usuario) con su clave, para probar la conexión. */
  resolverPorId(proveedorId: string): Promise<ProveedorResuelto>;
}

type FilaProveedor = {
  id: string;
  slug: string;
  nombre: string;
  tipo: string;
  baseUrl: string;
  claveCifrada: Uint8Array | null;
  versionClave: number;
  custom: unknown;
  modelos: string[];
  modeloPorDefecto: string;
  maxTokens: number;
  peticionesPorMinuto: number;
  herramientas: boolean | null;
  propietarioId: string | null;
  ejecucion: 'servidor' | 'local';
  activo: boolean;
};

const aad = (id: string, version: number) => `ia-proveedor:${id}:${version}`;

function publico(f: FilaProveedor, conDetalle: boolean): ProveedorPublico {
  return {
    id: f.id,
    slug: f.slug,
    nombre: f.nombre,
    tipo: f.tipo,
    ...(conDetalle ? { baseUrl: f.baseUrl, custom: (f.custom as AiProviderCustom | null) ?? null, peticionesPorMinuto: f.peticionesPorMinuto } : {}),
    modelos: f.modelos,
    modeloPorDefecto: f.modeloPorDefecto,
    maxTokens: f.maxTokens,
    herramientas: f.herramientas,
    origen: f.propietarioId ? 'propio' : 'admin',
    ejecucion: f.ejecucion,
    activo: f.activo,
    tieneClave: Boolean(f.claveCifrada?.length),
  };
}

function modeloPorDefecto(modelos: string[], pedido?: string): string {
  if (pedido && !modelos.includes(pedido)) throw new ErrorApi(400, 'modelo_invalido', 'el modelo por defecto debe estar en la lista de modelos');
  return pedido ?? modelos[0]!;
}

export type OpcionesServicioIA = {
  db: Db;
  claveMaestra: ClaveMaestra | null;
  ahora?: () => Date;
  /** Inyectable en pruebas (DNS). */
  resolverDns?: Resolver;
};

export function crearServicioIA(o: OpcionesServicioIA): ServicioProveedoresIA {
  const { db } = o;
  const ahora = o.ahora ?? (() => new Date());
  const clave = (): ClaveMaestra => {
    if (!o.claveMaestra) throw new ErrorApi(503, 'ia_sin_clave_maestra', 'el servidor no tiene IA_CLAVE_MAESTRA configurada');
    return o.claveMaestra;
  };

  async function permisos(id: Identidad): Promise<PermisosIA> {
    const slugsAdmin = async () =>
      (await db.proveedorIA.findMany({ where: { propietarioId: null }, select: { slug: true }, orderBy: { creadoEn: 'asc' } })).map((p) => p.slug);
    if (id.esAdmin) return { usar: true, modeloPropio: true, proveedores: await slugsAdmin() };
    const usuario = await sincronizarUsuario(db, id);
    const acciones = new Set(await accionesEfectivas(db, usuario.id, PRODUCTO_IA, ahora()));
    const usar = acciones.has(ACCION_USAR);
    const proveedores = usar ? (await slugsAdmin()).filter((s) => acciones.has(accionDeProveedor(s))) : [];
    return { usar, modeloPropio: usar && acciones.has(ACCION_MODELO_PROPIO), proveedores };
  }

  function resuelto(f: FilaProveedor): ProveedorResuelto {
    const apiKey = f.claveCifrada?.length ? descifrarSecreto(clave(), f.claveCifrada, aad(f.id, f.versionClave)) : undefined;
    const custom = (f.custom as AiProviderCustom | null) ?? undefined;
    return {
      id: f.id,
      slug: f.slug,
      origen: f.propietarioId ? 'propio' : 'admin',
      peticionesPorMinuto: f.peticionesPorMinuto,
      modelos: f.modelos,
      modeloPorDefecto: f.modeloPorDefecto,
      maxTokens: f.maxTokens,
      herramientas: f.herramientas,
      redRestringida: Boolean(f.propietarioId),
      destino: { kind: f.tipo as AiProviderKind, baseUrl: f.baseUrl, ...(apiKey ? { apiKey } : {}), ...(custom ? { custom } : {}) },
    };
  }

  async function exigirUrlDeUsuario(url: string) {
    try {
      await exigirUrlPublica(url, o.resolverDns);
    } catch (e) {
      if (e instanceof UrlNoPermitida) throw new ErrorApi(400, 'url_no_permitida', e.message);
      throw e;
    }
  }

  async function propioDe(id: Identidad, proveedorId: string, exigirPermiso = true) {
    const usuario = await sincronizarUsuario(db, id);
    const fila = await db.proveedorIA.findUnique({ where: { id: proveedorId } });
    if (!fila || fila.propietarioId !== usuario.id) throw new ErrorApi(404, 'proveedor_no_encontrado', 'proveedor no encontrado');
    if (exigirPermiso && !(await permisos(id)).modeloPropio) {
      throw new ErrorApi(403, 'sin_permiso', 'tu cuenta no tiene permiso para usar modelos propios');
    }
    return { usuario, fila: fila as FilaProveedor };
  }

  const propios: ServicioPropios = {
    async listar(id) {
      const usuario = await sincronizarUsuario(db, id);
      const filas = await db.proveedorIA.findMany({ where: { propietarioId: usuario.id }, orderBy: { creadoEn: 'asc' } });
      return filas.map((f) => publico(f as FilaProveedor, true));
    },
    async crear(id, datos) {
      if (!(await permisos(id)).modeloPropio) throw new ErrorApi(403, 'sin_permiso', 'tu cuenta no tiene permiso para añadir modelos propios');
      const d = esquemaProveedorPropio.parse(datos);
      if (d.ejecucion === 'servidor') await exigirUrlDeUsuario(d.baseUrl);
      const usuario = await sincronizarUsuario(db, id);
      if ((await db.proveedorIA.count({ where: { propietarioId: usuario.id } })) >= MAX_PROVEEDORES_PROPIOS) {
        throw new ErrorApi(409, 'limite_proveedores', `máximo ${MAX_PROVEEDORES_PROPIOS} modelos propios`);
      }
      const nuevoId = randomUUID();
      const fila = await db.proveedorIA.create({
        data: {
          id: nuevoId,
          slug: `u-${randomBytes(6).toString('hex')}`,
          nombre: d.nombre,
          tipo: d.tipo,
          baseUrl: d.baseUrl,
          modelos: d.modelos,
          modeloPorDefecto: modeloPorDefecto(d.modelos, d.modeloPorDefecto),
          ...(d.maxTokens ? { maxTokens: d.maxTokens } : {}),
          herramientas: d.herramientas ?? null,
          ...(d.custom ? { custom: d.custom } : {}),
          activo: d.activo ?? true,
          ejecucion: d.ejecucion,
          propietarioId: usuario.id,
          ...(d.apiKey ? { claveCifrada: cifrarSecreto(clave(), d.apiKey, aad(nuevoId, 1)) } : {}),
        },
      });
      await auditar(db, id.userId, 'ia.propio.crear', fila.id, { nombre: fila.nombre, tipo: fila.tipo, ejecucion: fila.ejecucion });
      return publico(fila as FilaProveedor, true);
    },
    async actualizar(id, proveedorId, datos) {
      const { fila } = await propioDe(id, proveedorId);
      const d = esquemaProveedorPropioParcial.parse(datos);
      const ejecucion = d.ejecucion ?? fila.ejecucion;
      if (ejecucion === 'servidor' && (d.baseUrl || d.ejecucion)) await exigirUrlDeUsuario(d.baseUrl ?? fila.baseUrl);
      const modelos = d.modelos ?? fila.modelos;
      const act = await db.proveedorIA.update({
        where: { id: fila.id },
        data: {
          ...(d.nombre ? { nombre: d.nombre } : {}),
          ...(d.tipo ? { tipo: d.tipo } : {}),
          ...(d.baseUrl ? { baseUrl: d.baseUrl } : {}),
          modelos,
          modeloPorDefecto: modeloPorDefecto(modelos, d.modeloPorDefecto ?? (modelos.includes(fila.modeloPorDefecto) ? fila.modeloPorDefecto : undefined)),
          ...(d.maxTokens ? { maxTokens: d.maxTokens } : {}),
          ...(d.herramientas !== undefined ? { herramientas: d.herramientas } : {}),
          ...(d.custom !== undefined ? { custom: d.custom ?? undefined } : {}),
          ...(d.activo !== undefined ? { activo: d.activo } : {}),
          ejecucion,
        },
      });
      await auditar(db, id.userId, 'ia.propio.actualizar', fila.id, { campos: Object.keys(d) });
      return publico(act as FilaProveedor, true);
    },
    async fijarClave(id, proveedorId, nueva) {
      const { fila } = await propioDe(id, proveedorId);
      const version = fila.versionClave + 1;
      await db.proveedorIA.update({
        where: { id: fila.id },
        data: { versionClave: version, claveCifrada: nueva ? cifrarSecreto(clave(), nueva, aad(fila.id, version)) : null },
      });
      await auditar(db, id.userId, 'ia.propio.clave', fila.id, { tieneClave: Boolean(nueva) });
    },
    async eliminar(id, proveedorId) {
      // Borrar lo propio no exige el permiso: el usuario puede limpiar aunque se lo hayan retirado.
      const { fila } = await propioDe(id, proveedorId, false);
      await db.proveedorIA.delete({ where: { id: fila.id } });
      await auditar(db, id.userId, 'ia.propio.eliminar', fila.id);
    },
    async credencialLocal(id, proveedorId) {
      const { fila } = await propioDe(id, proveedorId);
      if (fila.ejecucion !== 'local') throw new ErrorApi(409, 'no_es_local', 'este proveedor se ejecuta en el servidor');
      if (!fila.activo) throw new ErrorApi(409, 'proveedor_inactivo', 'proveedor desactivado');
      const r = resuelto(fila);
      return { ...publico(fila, true), ...(r.destino.apiKey ? { apiKey: r.destino.apiKey } : {}) };
    },
  };

  async function filaAdmin(proveedorId: string): Promise<FilaProveedor> {
    const fila = await db.proveedorIA.findUnique({ where: { id: proveedorId } });
    if (!fila || fila.propietarioId) throw new ErrorApi(404, 'proveedor_no_encontrado', 'proveedor no encontrado');
    return fila as FilaProveedor;
  }

  const admin: ServicioAdminIA = {
    async listar() {
      const filas = await db.proveedorIA.findMany({ where: { propietarioId: null }, orderBy: { creadoEn: 'asc' } });
      return filas.map((f) => publico(f as FilaProveedor, true));
    },
    async listarDeUsuarios() {
      const filas = await db.proveedorIA.findMany({
        where: { propietarioId: { not: null } },
        include: { propietario: { select: { email: true } } },
        orderBy: { creadoEn: 'asc' },
      });
      return filas.map((f) => ({ ...publico(f as FilaProveedor, true), propietario: f.propietario?.email ?? null }));
    },
    async crear(actor, datos) {
      const d = esquemaProveedorAdmin.parse(datos);
      // Idempotente; el producto pudo borrarse desde el panel (sus roles se recrean al volver a sembrar).
      await sembrarProductoIA(db);
      const nuevoId = randomUUID();
      const fila = await db.$transaction(async (tx) => {
        const creado = await tx.proveedorIA.create({
          data: {
            id: nuevoId,
            slug: d.slug,
            nombre: d.nombre,
            tipo: d.tipo,
            baseUrl: d.baseUrl,
            modelos: d.modelos,
            modeloPorDefecto: modeloPorDefecto(d.modelos, d.modeloPorDefecto),
            ...(d.maxTokens ? { maxTokens: d.maxTokens } : {}),
            ...(d.peticionesPorMinuto ? { peticionesPorMinuto: d.peticionesPorMinuto } : {}),
            herramientas: d.herramientas ?? null,
            ...(d.custom ? { custom: d.custom } : {}),
            activo: d.activo ?? true,
            ...(d.apiKey ? { claveCifrada: cifrarSecreto(clave(), d.apiKey, aad(nuevoId, 1)) } : {}),
          },
        });
        await tx.accion.upsert({
          where: { productoId_clave: { productoId: PRODUCTO_IA, clave: accionDeProveedor(d.slug) } },
          create: { productoId: PRODUCTO_IA, clave: accionDeProveedor(d.slug), descripcion: `Usar el proveedor de IA «${d.nombre}»` },
          update: {},
        });
        return creado;
      });
      await auditar(db, actor, 'ia.proveedor.crear', fila.id, { slug: fila.slug, tipo: fila.tipo, tieneClave: Boolean(d.apiKey) });
      return publico(fila as FilaProveedor, true);
    },
    async actualizar(actor, proveedorId, datos) {
      const fila = await filaAdmin(proveedorId);
      const d = esquemaProveedorAdminParcial.parse(datos);
      const modelos = d.modelos ?? fila.modelos;
      const act = await db.proveedorIA.update({
        where: { id: fila.id },
        data: {
          ...(d.nombre ? { nombre: d.nombre } : {}),
          ...(d.tipo ? { tipo: d.tipo } : {}),
          ...(d.baseUrl ? { baseUrl: d.baseUrl } : {}),
          modelos,
          modeloPorDefecto: modeloPorDefecto(modelos, d.modeloPorDefecto ?? (modelos.includes(fila.modeloPorDefecto) ? fila.modeloPorDefecto : undefined)),
          ...(d.maxTokens ? { maxTokens: d.maxTokens } : {}),
          ...(d.peticionesPorMinuto ? { peticionesPorMinuto: d.peticionesPorMinuto } : {}),
          ...(d.herramientas !== undefined ? { herramientas: d.herramientas } : {}),
          ...(d.custom !== undefined ? { custom: d.custom ?? undefined } : {}),
          ...(d.activo !== undefined ? { activo: d.activo } : {}),
        },
      });
      await auditar(db, actor, 'ia.proveedor.actualizar', fila.id, { campos: Object.keys(d) });
      return publico(act as FilaProveedor, true);
    },
    async fijarClave(actor, proveedorId, nueva) {
      const fila = await filaAdmin(proveedorId);
      const version = fila.versionClave + 1;
      await db.proveedorIA.update({
        where: { id: fila.id },
        data: { versionClave: version, claveCifrada: nueva ? cifrarSecreto(clave(), nueva, aad(fila.id, version)) : null },
      });
      await auditar(db, actor, 'ia.proveedor.clave', fila.id, { tieneClave: Boolean(nueva) });
    },
    async eliminar(actor, proveedorId) {
      const fila = await filaAdmin(proveedorId);
      await db.$transaction([
        db.proveedorIA.delete({ where: { id: fila.id } }),
        db.accion.deleteMany({ where: { productoId: PRODUCTO_IA, clave: accionDeProveedor(fila.slug) } }),
      ]);
      await auditar(db, actor, 'ia.proveedor.eliminar', fila.id, { slug: fila.slug });
    },
    async resolverPorId(proveedorId) {
      const fila = await db.proveedorIA.findUnique({ where: { id: proveedorId } });
      if (!fila) throw new ErrorApi(404, 'proveedor_no_encontrado', 'proveedor no encontrado');
      return resuelto(fila as FilaProveedor);
    },
  };

  return {
    permisos,
    async disponibles(id) {
      const p = await permisos(id);
      const admins = p.proveedores.length
        ? await db.proveedorIA.findMany({ where: { propietarioId: null, slug: { in: p.proveedores }, activo: true }, orderBy: { creadoEn: 'asc' } })
        : [];
      const lista = admins.map((f) => publico(f as FilaProveedor, false));
      if (p.modeloPropio) lista.push(...(await propios.listar(id)).filter((x) => x.activo));
      return { permisos: p, proveedores: lista };
    },
    async resolver(id, proveedorId) {
      const p = await permisos(id);
      if (!p.usar) throw new ErrorApi(403, 'sin_permiso', 'tu cuenta no tiene acceso al asistente de IA');
      if (!proveedorId) {
        const primero = p.proveedores.length
          ? await db.proveedorIA.findFirst({ where: { propietarioId: null, slug: { in: p.proveedores }, activo: true }, orderBy: { creadoEn: 'asc' } })
          : null;
        if (!primero) throw new ErrorApi(503, 'ia_no_configurada', 'no hay proveedores de IA disponibles para tu cuenta');
        return resuelto(primero as FilaProveedor);
      }
      const fila = (await db.proveedorIA.findUnique({ where: { id: proveedorId } })) as FilaProveedor | null;
      if (!fila || !fila.activo) throw new ErrorApi(404, 'proveedor_no_encontrado', 'proveedor no disponible');
      if (!fila.propietarioId) {
        if (!p.proveedores.includes(fila.slug)) throw new ErrorApi(403, 'sin_permiso', 'tu cuenta no tiene acceso a este proveedor');
        return resuelto(fila);
      }
      const usuario = await sincronizarUsuario(db, id);
      if (fila.propietarioId !== usuario.id) throw new ErrorApi(404, 'proveedor_no_encontrado', 'proveedor no disponible');
      if (!p.modeloPropio) throw new ErrorApi(403, 'sin_permiso', 'tu cuenta no tiene permiso para usar modelos propios');
      if (fila.ejecucion === 'local') throw new ErrorApi(409, 'ejecucion_local', 'este modelo se ejecuta en tu equipo (JasWave Desktop)');
      // Se revalida en cada uso: el DNS pudo cambiar desde que se guardó.
      await exigirUrlDeUsuario(fila.baseUrl);
      return resuelto(fila);
    },
    propios,
    admin,
  };
}

/** Producto del asistente y sus acciones base (idempotente). */
export async function sembrarProductoIA(db: Db): Promise<void> {
  await db.producto.upsert({ where: { id: PRODUCTO_IA }, create: { id: PRODUCTO_IA, nombre: 'Asistente IA' }, update: {} });
  for (const [clave, descripcion] of [
    [ACCION_USAR, 'Usar el asistente de IA'],
    [ACCION_MODELO_PROPIO, 'Registrar y usar modelos propios'],
  ] as const) {
    await db.accion.upsert({
      where: { productoId_clave: { productoId: PRODUCTO_IA, clave } },
      create: { productoId: PRODUCTO_IA, clave, descripcion },
      update: {},
    });
  }
}

/** Servicio en memoria (pruebas y entornos sin BD): proveedores fijos y permisos inyectados. */
export function crearServicioIAEnMemoria(
  proveedores: (ProveedorResuelto & { nombre: string; activo?: boolean })[],
  permisosDe: (id: Identidad) => PermisosIA = () => ({ usar: true, modeloPropio: false, proveedores: proveedores.map((p) => p.slug) }),
): ServicioProveedoresIA {
  const vista = (p: (typeof proveedores)[number]): ProveedorPublico => ({
    id: p.id,
    slug: p.slug,
    nombre: p.nombre,
    tipo: p.destino.kind,
    modelos: p.modelos,
    modeloPorDefecto: p.modeloPorDefecto,
    maxTokens: p.maxTokens,
    herramientas: p.herramientas,
    origen: p.origen,
    ejecucion: 'servidor',
    activo: p.activo !== false,
    tieneClave: Boolean(p.destino.apiKey),
  });
  return {
    async permisos(id) {
      return permisosDe(id);
    },
    async disponibles(id) {
      const permisos = permisosDe(id);
      return { permisos, proveedores: proveedores.filter((p) => permisos.proveedores.includes(p.slug)).map(vista) };
    },
    async resolver(id, proveedorId) {
      const permisos = permisosDe(id);
      if (!permisos.usar) throw new ErrorApi(403, 'sin_permiso', 'tu cuenta no tiene acceso al asistente de IA');
      const lista = proveedores.filter((p) => permisos.proveedores.includes(p.slug) && p.activo !== false);
      const p = proveedorId ? lista.find((x) => x.id === proveedorId) : lista[0];
      if (!p) throw new ErrorApi(proveedorId ? 404 : 503, proveedorId ? 'proveedor_no_encontrado' : 'ia_no_configurada', 'proveedor no disponible');
      return p;
    },
  };
}
