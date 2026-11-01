/**
 * Propuestas de grooves de los usuarios para el catálogo. Nada llega aquí sin el consentimiento del usuario
 * (se guarda la versión del texto aceptado). Cada propuesta lleva la huella de su contenido MIDI: un duplicado
 * exacto no vuelve a pedir revisión (suma al contador «veces propuesto») y los parecidos se calculan al recibirla
 * y se recalculan cuando cambia el catálogo.
 */

import type { Db } from '../db.js';
import { ErrorApi } from '../http/errores.js';
import { auditar } from '../license/servicio.js';
import { resumirMidi } from './midi.js';
import type { ServicioGroovesCatalogo } from './servicio.js';
import { validarMid } from './servicio.js';
import {
  UMBRALES_SIMILITUD,
  buscarSimilares,
  compararHuellas,
  crearHuella,
  huellaAJson,
  huellaDeJson,
  type CompasHuella,
  type Huella,
} from './similitud.js';
import { esquemaMetadatos, tipoDesdeNombre, type Metadatos } from './validacion.js';
import { createHash } from 'node:crypto';

/** Versiones del texto de consentimiento que el servidor acepta. La app muestra la última. */
export const VERSION_CONSENTIMIENTO = '2026-10-29';
export const VERSIONES_CONSENTIMIENTO = [VERSION_CONSENTIMIENTO];
export const TEXTO_CONSENTIMIENTO = 'Al compartirlo, autorizas a JasWave a incluirlo en el catálogo bajo licencia CC0.';

export const LIMITES_PROPUESTAS = { pendientesPorUsuario: 40, porDia: 30, similaresGuardados: 8 };

export type Estado = 'pendiente' | 'aprobada' | 'rechazada' | 'duplicada';
export type Similar = { tipo: 'groove' | 'propuesta'; id: string; nombre: string; puntuacion: number; nivel: string };

type FilaPropuesta = Metadatos & {
  id: string;
  usuarioId: string;
  usuarios: string[];
  contenido: Uint8Array;
  sha256: string;
  huellaHash: string;
  huella: unknown;
  estado: Estado;
  vecesPropuesto: number;
  similares: unknown;
  notaAdmin: string;
  grooveId: string | null;
  consentimientoVersion: string;
  consentimientoEn: Date;
  creadoEn: Date;
  actualizadoEn: Date;
  resueltaEn: Date | null;
};
export type PropuestaPublica = Omit<FilaPropuesta, 'contenido' | 'similares'> & { similares: Similar[] };

const compasDe = (t: string): CompasHuella => {
  const [n, d] = t.split('/').map(Number);
  return { numerador: n || 4, denominador: d || 4 };
};
const sinBytes = (f: FilaPropuesta): PropuestaPublica => {
  const resto: Partial<FilaPropuesta> = { ...f };
  delete resto.contenido;
  return { ...(resto as Omit<FilaPropuesta, 'contenido'>), similares: Array.isArray(f.similares) ? (f.similares as Similar[]) : [] };
};

export type EntradaPropuesta = Partial<Metadatos> & { nombre: string; estilo: string; contenido: Uint8Array; consentimiento: { aceptado: boolean; version: string } };

export function crearServicioPropuestas({ db, catalogo, ahora = () => new Date() }: { db: Db; catalogo: ServicioGroovesCatalogo; ahora?: () => Date }) {
  /** Huellas del catálogo, en caché por id+sha256 (solo se lee el contenido de lo que cambió). */
  const cacheCatalogo = new Map<string, { sha: string; huella: Huella }>();
  const huellasCatalogo = async (): Promise<Array<{ item: { id: string; nombre: string }; huella: Huella }>> => {
    const { grooves } = await catalogo.listarAdmin();
    const vivos = new Set(grooves.map((g) => g.id));
    for (const k of [...cacheCatalogo.keys()]) if (!vivos.has(k)) cacheCatalogo.delete(k);
    const out: Array<{ item: { id: string; nombre: string }; huella: Huella }> = [];
    for (const g of grooves) {
      let c = cacheCatalogo.get(g.id);
      if (!c || c.sha !== g.sha256) {
        const a = await catalogo.archivo(g.id, false);
        c = { sha: g.sha256, huella: crearHuella(resumirMidi(a.bytes).lista, compasDe(g.compas)) };
        cacheCatalogo.set(g.id, c);
      }
      out.push({ item: { id: g.id, nombre: g.nombre }, huella: c.huella });
    }
    return out;
  };

  const filas = async (donde?: object): Promise<FilaPropuesta[]> =>
    (await db.propuestaGroove.findMany(donde ? { where: donde } : undefined)) as unknown as FilaPropuesta[];

  const huellaDe = (f: FilaPropuesta): Huella => huellaDeJson(f.huella) ?? crearHuella(resumirMidi(f.contenido).lista, compasDe(f.compas));

  async function calcularSimilares(huella: Huella, excluirId: string | null, propuestas: FilaPropuesta[]): Promise<Similar[]> {
    const deCatalogo = buscarSimilares(huella, await huellasCatalogo(), { max: LIMITES_PROPUESTAS.similaresGuardados }).map(
      (c): Similar => ({ tipo: 'groove', id: c.item.id, nombre: c.item.nombre, puntuacion: c.puntuacion, nivel: c.nivel }),
    );
    const deProp = buscarSimilares(
      huella,
      propuestas.filter((p) => p.id !== excluirId && p.estado !== 'rechazada').map((p) => ({ item: { id: p.id, nombre: p.nombre }, huella: huellaDe(p) })),
      { max: LIMITES_PROPUESTAS.similaresGuardados },
    ).map((c): Similar => ({ tipo: 'propuesta', id: c.item.id, nombre: c.item.nombre, puntuacion: c.puntuacion, nivel: c.nivel }));
    return [...deCatalogo, ...deProp].sort((a, b) => b.puntuacion - a.puntuacion).slice(0, LIMITES_PROPUESTAS.similaresGuardados);
  }

  /** Recibe una propuesta de un usuario (ya con su consentimiento). Devuelve lo que ve el usuario. */
  async function proponer(usuarioId: string, e: EntradaPropuesta): Promise<{ propuesta: PropuestaPublica; repetida: boolean; mensaje: string }> {
    if (!e.consentimiento.aceptado) throw new ErrorApi(400, 'sin_consentimiento', 'hace falta tu permiso para compartir el groove con JasWave');
    if (!VERSIONES_CONSENTIMIENTO.includes(e.consentimiento.version)) throw new ErrorApi(400, 'consentimiento_desactualizado', 'el texto de permiso cambió; vuelve a aceptarlo en la app');
    const resumen = validarMid(e.contenido);
    const meta = esquemaMetadatos.parse({
      nombre: e.nombre,
      estilo: e.estilo,
      tipo: e.tipo ?? tipoDesdeNombre(e.nombre),
      compas: e.compas ?? resumen.compas ?? '4/4',
      tempo: e.tempo ?? Math.min(400, Math.max(20, resumen.tempo ?? 100)),
      compases: e.compases ?? resumen.compases,
      intensidad: e.intensidad ?? 3,
      etiquetas: e.etiquetas ?? [],
      autor: e.autor ?? '',
      licencia: 'CC0-1.0',
    });
    const huella = crearHuella(resumen.lista, compasDe(meta.compas));
    const todas = await filas();
    const mias = todas.filter((p) => p.usuarioId === usuarioId);
    const ahoraD = ahora();
    const ayer = ahoraD.getTime() - 86_400_000;

    const existente = todas.find((p) => p.huellaHash === huella.hash);
    if (existente) {
      // Mismo patrón: no se pide otra revisión, solo se acumula.
      if (existente.usuarios.includes(usuarioId) || existente.usuarioId === usuarioId) {
        return { propuesta: sinBytes(existente), repetida: true, mensaje: 'Ya habías propuesto este groove.' };
      }
      const actualizada = (await db.propuestaGroove.update({
        where: { id: existente.id },
        data: { usuarios: [...existente.usuarios, usuarioId], vecesPropuesto: existente.vecesPropuesto + 1 },
      })) as unknown as FilaPropuesta;
      return { propuesta: sinBytes(actualizada), repetida: true, mensaje: 'Ya había una propuesta igual; se sumó tu voto.' };
    }
    if (mias.filter((p) => p.estado === 'pendiente').length >= LIMITES_PROPUESTAS.pendientesPorUsuario)
      throw new ErrorApi(429, 'demasiadas_propuestas', 'tienes muchas propuestas pendientes; espera a que se revisen');
    if (mias.filter((p) => p.creadoEn.getTime() > ayer).length >= LIMITES_PROPUESTAS.porDia)
      throw new ErrorApi(429, 'demasiadas_propuestas', 'has llegado al máximo de propuestas por hoy');

    const similares = await calcularSimilares(huella, null, todas);
    const igualCatalogo = similares.find((s) => s.tipo === 'groove' && s.puntuacion >= 100);
    const fila = (await db.propuestaGroove.create({
      data: {
        usuarioId,
        usuarios: [usuarioId],
        ...meta,
        contenido: Buffer.from(e.contenido),
        sha256: createHash('sha256').update(e.contenido).digest('hex'),
        huellaHash: huella.hash,
        huella: huellaAJson(huella),
        estado: igualCatalogo ? 'duplicada' : 'pendiente',
        similares,
        grooveId: igualCatalogo?.id ?? null,
        notaAdmin: igualCatalogo ? 'Idéntico a un groove que ya está en el catálogo.' : '',
        consentimientoVersion: e.consentimiento.version,
        consentimientoEn: ahoraD,
        ...(igualCatalogo ? { resueltaEn: ahoraD } : {}),
      },
    })) as unknown as FilaPropuesta;
    return {
      propuesta: sinBytes(fila),
      repetida: false,
      mensaje: igualCatalogo ? 'Ese groove ya está en el catálogo.' : 'Gracias: tu groove quedó propuesto y lo revisará un administrador.',
    };
  }

  /** Lo que ve el usuario de sus propias propuestas. */
  async function mias(usuarioId: string): Promise<Array<Pick<PropuestaPublica, 'id' | 'nombre' | 'estilo' | 'estado' | 'vecesPropuesto' | 'creadoEn' | 'notaAdmin' | 'sha256'>>> {
    return (await filas())
      .filter((p) => p.usuarioId === usuarioId || p.usuarios.includes(usuarioId))
      .sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime())
      .map((p) => ({ id: p.id, nombre: p.nombre, estilo: p.estilo, estado: p.estado, vecesPropuesto: p.vecesPropuesto, creadoEn: p.creadoEn, sha256: p.sha256, notaAdmin: p.estado === 'rechazada' || p.estado === 'duplicada' ? p.notaAdmin : '' }));
  }

  /** Bandeja del admin. `vista`: «unicas» (sin parecidos ≥ similar) o «con-similares». Añade grupos casi idénticos. */
  async function listar(o: { estado?: Estado; vista?: 'unicas' | 'con-similares' | 'todas' } = {}): Promise<{ propuestas: PropuestaPublica[]; grupos: string[][] }> {
    const todas = await filas();
    let lista = todas.filter((p) => !o.estado || p.estado === o.estado);
    if (o.vista === 'unicas') lista = lista.filter((p) => sinBytes(p).similares.length === 0);
    if (o.vista === 'con-similares') lista = lista.filter((p) => sinBytes(p).similares.length > 0);
    lista.sort((a, b) => b.vecesPropuesto - a.vecesPropuesto || b.creadoEn.getTime() - a.creadoEn.getTime());
    // Grupos: propuestas casi idénticas entre sí (≥ «muy similar»), por componentes conexos.
    const padre = new Map<string, string>();
    const raiz = (x: string): string => {
      let r = x;
      while ((padre.get(r) ?? r) !== r) r = padre.get(r)!;
      padre.set(x, r);
      return r;
    };
    const ids = new Set(lista.map((p) => p.id));
    for (const p of lista)
      for (const s of sinBytes(p).similares)
        if (s.tipo === 'propuesta' && ids.has(s.id) && s.puntuacion >= UMBRALES_SIMILITUD.muySimilar) padre.set(raiz(p.id), raiz(s.id));
    const grupos = new Map<string, string[]>();
    for (const p of lista) grupos.set(raiz(p.id), [...(grupos.get(raiz(p.id)) ?? []), p.id]);
    return { propuestas: lista.map(sinBytes), grupos: [...grupos.values()].filter((g) => g.length > 1) };
  }

  async function obtener(id: string): Promise<FilaPropuesta> {
    const p = (await db.propuestaGroove.findUnique({ where: { id } })) as unknown as FilaPropuesta | null;
    if (!p) throw new ErrorApi(404, 'propuesta_no_encontrada', 'la propuesta no existe');
    return p;
  }

  async function archivo(id: string): Promise<{ bytes: Uint8Array; sha256: string }> {
    const p = await obtener(id);
    return { bytes: p.contenido, sha256: p.sha256 };
  }

  const exigirPendiente = (p: FilaPropuesta) => {
    if (p.estado !== 'pendiente') throw new ErrorApi(409, 'propuesta_resuelta', `la propuesta ya está ${p.estado}`);
  };

  async function aprobar(actor: string, id: string, o: { cambios?: Partial<Metadatos>; varianteDe?: string; nota?: string }): Promise<{ propuesta: PropuestaPublica; grooveId: string }> {
    const p = await obtener(id);
    exigirPendiente(p);
    let estilo = o.cambios?.estilo ?? p.estilo;
    let etiquetas = o.cambios?.etiquetas ?? p.etiquetas;
    if (o.varianteDe) {
      const otro = (await catalogo.listarAdmin()).grooves.find((g) => g.id === o.varianteDe);
      if (!otro) throw new ErrorApi(404, 'groove_no_encontrado', 'el groove del que es variante no existe');
      if (!o.cambios?.estilo) estilo = otro.estilo;
      if (!etiquetas.includes('variante')) etiquetas = [...etiquetas, 'variante'].slice(0, 20);
    }
    const g = await catalogo.crear(actor, {
      nombre: o.cambios?.nombre ?? p.nombre,
      estilo,
      tipo: o.cambios?.tipo ?? (p.tipo as Metadatos['tipo']),
      compas: o.cambios?.compas ?? p.compas,
      tempo: o.cambios?.tempo ?? p.tempo,
      compases: o.cambios?.compases ?? p.compases,
      intensidad: o.cambios?.intensidad ?? p.intensidad,
      etiquetas,
      autor: o.cambios?.autor ?? p.autor,
      licencia: 'CC0-1.0',
      contenido: p.contenido,
    });
    const nota = [o.nota, o.varianteDe ? `variante de ${o.varianteDe}` : ''].filter(Boolean).join(' · ');
    const act = (await db.propuestaGroove.update({ where: { id }, data: { estado: 'aprobada', grooveId: g.id, notaAdmin: nota, resueltaEn: ahora() } })) as unknown as FilaPropuesta;
    await auditar(db, actor, 'groove.propuesta.aprobar', id, { grooveId: g.id, varianteDe: o.varianteDe ?? null });
    return { propuesta: sinBytes(act), grooveId: g.id };
  }

  async function resolver(actor: string, id: string, estado: 'rechazada' | 'duplicada', nota: string, de?: string): Promise<PropuestaPublica> {
    const p = await obtener(id);
    exigirPendiente(p);
    const act = (await db.propuestaGroove.update({ where: { id }, data: { estado, notaAdmin: nota, grooveId: de ?? null, resueltaEn: ahora() } })) as unknown as FilaPropuesta;
    await auditar(db, actor, estado === 'rechazada' ? 'groove.propuesta.rechazar' : 'groove.propuesta.duplicada', id, { de: de ?? null });
    return sinBytes(act);
  }

  /** Vuelve a calcular los parecidos de las pendientes (p. ej. tras cambiar el catálogo). */
  async function recalcular(): Promise<number> {
    const todas = await filas();
    const pendientes = todas.filter((p) => p.estado === 'pendiente');
    for (const p of pendientes) {
      const similares = await calcularSimilares(huellaDe(p), p.id, todas);
      await db.propuestaGroove.update({ where: { id: p.id }, data: { similares } });
    }
    return pendientes.length;
  }

  /** Datos para comparar lado a lado la propuesta con un groove del catálogo o con otra propuesta. */
  async function comparar(id: string, otro: { tipo: 'groove' | 'propuesta'; id: string }) {
    const p = await obtener(id);
    let otroHuella: Huella;
    let nombre: string;
    if (otro.tipo === 'propuesta') {
      const o = await obtener(otro.id);
      otroHuella = huellaDe(o);
      nombre = o.nombre;
    } else {
      const { grooves } = await catalogo.listarAdmin();
      const g = grooves.find((x) => x.id === otro.id);
      if (!g) throw new ErrorApi(404, 'groove_no_encontrado', 'el groove no existe');
      otroHuella = crearHuella(resumirMidi((await catalogo.archivo(g.id, false)).bytes).lista, compasDe(g.compas));
      nombre = g.nombre;
    }
    const a = huellaDe(p);
    const r = compararHuellas(a, otroHuella);
    return { resultado: r, a: { nombre: p.nombre, huella: huellaAJson(a) }, b: { nombre, huella: huellaAJson(otroHuella) } };
  }

  return { proponer, mias, listar, archivo, aprobar, rechazar: (a: string, id: string, nota: string) => resolver(a, id, 'rechazada', nota), marcarDuplicada: (a: string, id: string, nota: string, de?: string) => resolver(a, id, 'duplicada', nota, de), recalcular, comparar };
}
export type ServicioPropuestasGroove = ReturnType<typeof crearServicioPropuestas>;
