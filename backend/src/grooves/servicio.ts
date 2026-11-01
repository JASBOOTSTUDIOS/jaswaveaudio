/**
 * Catálogo de grooves MIDI administrable (M, sincronización). Los .mid viven en la base de datos (pocos KB
 * cada uno); los usuarios descargan el índice y solo lo nuevo o cambiado. Cada cambio sube la revisión del
 * groove y la revisión global del catálogo, y queda en la auditoría.
 */

import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import { ErrorApi } from '../http/errores.js';
import { auditar } from '../license/servicio.js';
import { ErrorMidi, resumirMidi, validarCabeceraMidi } from './midi.js';
import { ErrorZip, leerZip } from './zip.js';
import {
  MAX_BYTES_MID,
  MAX_GROOVES,
  MAX_LOTE,
  MAX_POR_ESTILO,
  MAX_ZIP_BYTES,
  MAX_ZIP_DESCOMPRIMIDO,
  archivoDesdeNombre,
  esquemaEstilo,
  esquemaId,
  esquemaMetadatos,
  nombreLegible,
  slugId,
  tipoDesdeNombre,
  type Metadatos,
} from './validacion.js';

export type FilaGroove = Metadatos & {
  id: string;
  ruta: string;
  revision: number;
  sha256: string;
  tamano: number;
  activo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
};
type FilaConBytes = FilaGroove & { contenido: Uint8Array };

export type EntradaIndice = Omit<FilaGroove, 'activo' | 'creadoEn' | 'actualizadoEn'>;

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const sinContenido = ({ contenido: _c, ...resto }: FilaConBytes): FilaGroove => resto;

/** Valida un .mid: tamaño, cabecera `MThd`, pistas bien formadas y al menos una nota. */
export function validarMid(bytes: Uint8Array): ReturnType<typeof resumirMidi> {
  if (bytes.byteLength === 0) throw new ErrorApi(400, 'midi_vacio', 'el archivo MIDI está vacío');
  if (bytes.byteLength > MAX_BYTES_MID) throw new ErrorApi(413, 'midi_grande', `el archivo MIDI supera ${MAX_BYTES_MID / 1024} KB`);
  try {
    validarCabeceraMidi(bytes);
    const r = resumirMidi(bytes);
    if (r.notas === 0) throw new ErrorMidi('el archivo MIDI no contiene notas');
    return r;
  } catch (e) {
    if (e instanceof ErrorMidi) throw new ErrorApi(400, 'midi_invalido', e.message);
    throw e;
  }
}

export function decodificarBase64(b64: string): Buffer {
  const b = Buffer.from(b64, 'base64');
  if (b.length > MAX_BYTES_MID) throw new ErrorApi(413, 'midi_grande', `el archivo MIDI supera ${MAX_BYTES_MID / 1024} KB`);
  return b;
}

export type NuevoGroove = Partial<Metadatos> & { id?: string; archivo?: string; contenido: Uint8Array };
export type ResultadoLote = { creados: string[]; reemplazados: string[]; sinCambios: string[]; errores: Array<{ archivo: string; error: string }> };

export function crearServicioGrooves({ db, alCambiar }: { db: Db; alCambiar?: () => void }) {
  const filas = async (): Promise<FilaGroove[]> => (await db.grooveCatalogo.findMany({ omit: { contenido: true } })) as unknown as FilaGroove[];

  const subirRevisionGlobal = async (): Promise<number> => {
    const e = await db.grooveCatalogoEstado.upsert({ where: { id: 1 }, update: { revision: { increment: 1 } }, create: { id: 1, revision: 1 } });
    alCambiar?.();
    return e.revision;
  };
  const revisionGlobal = async (): Promise<number> => (await db.grooveCatalogoEstado.findUnique({ where: { id: 1 } }))?.revision ?? 0;

  const rutaDe = (estilo: string, archivo: string) => `${estilo}/${archivo}.mid`;
  const choque = (todas: FilaGroove[], ruta: string, ignorarId?: string) => todas.find((f) => f.id !== ignorarId && f.ruta.toLowerCase() === ruta.toLowerCase());

  const completar = (n: NuevoGroove, resumen: ReturnType<typeof resumirMidi>): Metadatos => {
    const nombre = n.nombre ?? 'Groove';
    return esquemaMetadatos.parse({
      nombre,
      estilo: n.estilo,
      tipo: n.tipo ?? tipoDesdeNombre(nombre),
      compas: n.compas ?? resumen.compas ?? '4/4',
      tempo: n.tempo ?? Math.min(400, Math.max(20, resumen.tempo ?? 100)),
      compases: n.compases ?? resumen.compases,
      intensidad: n.intensidad ?? 3,
      etiquetas: n.etiquetas ?? [],
      autor: n.autor ?? '',
      licencia: n.licencia ?? '',
    });
  };

  async function obtener(id: string, conBytes = false): Promise<FilaConBytes> {
    const f = (await db.grooveCatalogo.findUnique({ where: { id } })) as unknown as FilaConBytes | null;
    if (!f) throw new ErrorApi(404, 'groove_no_encontrado', 'el groove no existe');
    return conBytes ? f : { ...f, contenido: new Uint8Array() };
  }

  async function crear(actor: string, n: NuevoGroove): Promise<FilaGroove> {
    const resumen = validarMid(n.contenido);
    const meta = completar(n, resumen);
    const todas = await filas();
    if (todas.length >= MAX_GROOVES) throw new ErrorApi(409, 'catalogo_lleno', `el catálogo ya tiene ${MAX_GROOVES} grooves`);
    if (todas.filter((f) => f.estilo === meta.estilo).length >= MAX_POR_ESTILO) throw new ErrorApi(409, 'estilo_lleno', `el estilo ya tiene ${MAX_POR_ESTILO} grooves`);
    const archivo = n.archivo ?? archivoDesdeNombre(meta.nombre);
    const ruta = rutaDe(meta.estilo, archivo);
    if (choque(todas, ruta)) throw new ErrorApi(409, 'groove_existente', `ya existe un groove en «${ruta}»`);
    let id = n.id ? esquemaId.parse(n.id) : slugId(meta.estilo, meta.nombre);
    if (n.id) {
      if (todas.some((f) => f.id === id)) throw new ErrorApi(409, 'id_existente', `ya existe el id ${id}`);
    } else {
      const base = id;
      for (let k = 2; todas.some((f) => f.id === id); k++) id = `${base.slice(0, 76)}-${k}`;
    }
    const ahora = new Date();
    const fila = await db.grooveCatalogo.create({
      data: { id, ruta, ...meta, revision: 1, sha256: sha256(n.contenido), tamano: n.contenido.byteLength, contenido: Buffer.from(n.contenido), activo: true, creadoEn: ahora, actualizadoEn: ahora },
    });
    await subirRevisionGlobal();
    await auditar(db, actor, 'groove.crear', id, { ruta, tamano: n.contenido.byteLength });
    return sinContenido(fila as unknown as FilaConBytes);
  }

  /** Cambia metadatos, nombre y/o estilo. Sube la revisión (el archivo se vuelve a bajar con sus datos nuevos). */
  async function editar(actor: string, id: string, cambios: Partial<Metadatos> & { archivo?: string }): Promise<FilaGroove> {
    const f = await obtener(id);
    const meta = esquemaMetadatos.parse({ ...pick(f), ...limpiar(cambios) });
    const todas = await filas();
    const mueve = meta.estilo !== f.estilo || meta.nombre !== f.nombre || cambios.archivo !== undefined;
    const archivoActual = f.ruta.slice(f.estilo.length + 1).replace(/\.mid$/, '');
    const archivo = cambios.archivo ?? (meta.nombre !== f.nombre ? archivoDesdeNombre(meta.nombre) : archivoActual);
    const ruta = mueve ? rutaDe(meta.estilo, archivo) : f.ruta;
    if (mueve && choque(todas, ruta, id)) throw new ErrorApi(409, 'groove_existente', `ya existe un groove en «${ruta}»`);
    const fila = await db.grooveCatalogo.update({ where: { id }, data: { ...meta, ruta, revision: f.revision + 1, actualizadoEn: new Date() } });
    await subirRevisionGlobal();
    await auditar(db, actor, mueve ? 'groove.mover' : 'groove.editar', id, { antes: f.ruta, despues: ruta, campos: Object.keys(cambios) });
    return sinContenido(fila as unknown as FilaConBytes);
  }

  async function reemplazarArchivo(actor: string, id: string, contenido: Uint8Array): Promise<FilaGroove> {
    const f = await obtener(id);
    validarMid(contenido);
    const hash = sha256(contenido);
    if (hash === f.sha256) return sinContenido(f);
    const fila = await db.grooveCatalogo.update({
      where: { id },
      data: { contenido: Buffer.from(contenido), sha256: hash, tamano: contenido.byteLength, revision: f.revision + 1, actualizadoEn: new Date() },
    });
    await subirRevisionGlobal();
    await auditar(db, actor, 'groove.reemplazar', id, { sha256: hash, tamano: contenido.byteLength });
    return sinContenido(fila as unknown as FilaConBytes);
  }

  async function fijarActivo(actor: string, id: string, activo: boolean): Promise<FilaGroove> {
    const f = await obtener(id);
    if (f.activo === activo) return sinContenido(f);
    const fila = await db.grooveCatalogo.update({ where: { id }, data: { activo, actualizadoEn: new Date() } });
    await subirRevisionGlobal();
    await auditar(db, actor, activo ? 'groove.activar' : 'groove.desactivar', id);
    return sinContenido(fila as unknown as FilaConBytes);
  }

  async function borrar(actor: string, id: string): Promise<void> {
    const f = await obtener(id);
    await db.grooveCatalogo.delete({ where: { id } });
    await subirRevisionGlobal();
    await auditar(db, actor, 'groove.borrar', id, { ruta: f.ruta });
  }

  /** Renombra o mueve un estilo entero (todos sus grooves y subestilos). */
  async function renombrarEstilo(actor: string, actual: string, nuevo: string): Promise<{ cambiados: number }> {
    esquemaEstilo.parse(actual);
    esquemaEstilo.parse(nuevo);
    const todas = await filas();
    const afectados = todas.filter((f) => f.estilo === actual || f.estilo.startsWith(`${actual}/`));
    if (!afectados.length) throw new ErrorApi(404, 'estilo_no_encontrado', 'ese estilo no tiene grooves');
    const destinos = afectados.map((f) => {
      const estilo = nuevo + f.estilo.slice(actual.length);
      esquemaEstilo.parse(estilo);
      return { f, estilo, ruta: rutaDe(estilo, f.ruta.slice(f.estilo.length + 1).replace(/\.mid$/, '')) };
    });
    const ids = new Set(afectados.map((f) => f.id));
    const resto = todas.filter((f) => !ids.has(f.id));
    for (const d of destinos) if (choque(resto, d.ruta)) throw new ErrorApi(409, 'groove_existente', `ya existe un groove en «${d.ruta}»`);
    for (const d of destinos) await db.grooveCatalogo.update({ where: { id: d.f.id }, data: { estilo: d.estilo, ruta: d.ruta, revision: d.f.revision + 1, actualizadoEn: new Date() } });
    await subirRevisionGlobal();
    await auditar(db, actor, 'groove.estilo.renombrar', actual, { nuevo, cambiados: destinos.length });
    return { cambiados: destinos.length };
  }

  /**
   * Importación en lote: varios .mid (la carpeta es el estilo) o un zip (`Estilo/[Subestilo/]archivo.mid`).
   * Los errores de un archivo no frenan a los demás. `reemplazar` actualiza los que ya existan en la misma ruta.
   */
  async function importarLote(
    actor: string,
    o: { archivos?: Array<{ nombre: string; carpeta?: string; contenido: Uint8Array }>; zip?: Buffer; estilo?: string; reemplazar?: boolean },
  ): Promise<ResultadoLote> {
    const res: ResultadoLote = { creados: [], reemplazados: [], sinCambios: [], errores: [] };
    let lista: Array<{ nombre: string; carpeta?: string; contenido: Uint8Array }> = o.archivos ?? [];
    if (o.zip) {
      if (o.zip.length > MAX_ZIP_BYTES) throw new ErrorApi(413, 'zip_grande', `el zip supera ${MAX_ZIP_BYTES / 1024 / 1024} MB`);
      try {
        lista = leerZip(o.zip, { maxEntradas: MAX_LOTE, maxBytesEntrada: MAX_BYTES_MID, maxBytesTotal: MAX_ZIP_DESCOMPRIMIDO }).map((e) => {
          const partes = e.nombre.split('/').filter(Boolean);
          const nombre = partes.pop() ?? e.nombre;
          return { nombre, carpeta: partes.join('/'), contenido: e.datos };
        });
      } catch (e) {
        if (e instanceof ErrorZip) throw new ErrorApi(400, 'zip_invalido', e.message);
        throw e;
      }
    }
    if (!lista.length) throw new ErrorApi(400, 'lote_vacio', 'no hay archivos MIDI que importar');
    if (lista.length > MAX_LOTE) throw new ErrorApi(413, 'lote_grande', `máximo ${MAX_LOTE} archivos por importación`);
    const todas = await filas();
    for (const a of lista) {
      try {
        const estilo = esquemaEstilo.parse(a.carpeta || o.estilo || '');
        const archivo = archivoDesdeNombre(a.nombre.replace(/\.(mid|midi)$/i, '').replace(/^\d+[\s._-]*/, ''));
        const previo = choque(todas, rutaDe(estilo, archivo));
        if (previo) {
          if (!o.reemplazar) throw new ErrorApi(409, 'groove_existente', 'ya existe (activa «reemplazar» para actualizarlo)');
          const antes = previo.revision;
          const fila = await reemplazarArchivo(actor, previo.id, a.contenido);
          previo.revision = fila.revision;
          (fila.revision === antes ? res.sinCambios : res.reemplazados).push(previo.id);
          continue;
        }
        const fila = await crear(actor, { nombre: nombreLegible(a.nombre), estilo, archivo, contenido: a.contenido });
        todas.push(fila);
        res.creados.push(fila.id);
      } catch (e) {
        res.errores.push({ archivo: a.carpeta ? `${a.carpeta}/${a.nombre}` : a.nombre, error: mensaje(e) });
      }
    }
    return res;
  }

  async function listarAdmin(): Promise<{ revision: number; grooves: FilaGroove[] }> {
    const todas = await filas();
    todas.sort((a, b) => a.ruta.localeCompare(b.ruta));
    return { revision: await revisionGlobal(), grooves: todas };
  }

  /** Índice para los usuarios: solo grooves activos. Con `desde` igual a la revisión actual no hay nada nuevo. */
  async function indice(desde?: number): Promise<{ revision: number; sinCambios: true } | { revision: number; sinCambios: false; grooves: EntradaIndice[] }> {
    const revision = await revisionGlobal();
    if (desde !== undefined && desde === revision) return { revision, sinCambios: true };
    const grooves = (await filas())
      .filter((f) => f.activo)
      .sort((a, b) => a.ruta.localeCompare(b.ruta))
      .map(({ activo: _a, creadoEn: _c, actualizadoEn: _u, ...e }) => e);
    return { revision, sinCambios: false, grooves };
  }

  async function archivo(id: string, soloActivo: boolean): Promise<{ bytes: Uint8Array; sha256: string }> {
    const f = await obtener(id, true);
    if (soloActivo && !f.activo) throw new ErrorApi(404, 'groove_no_encontrado', 'el groove no existe');
    return { bytes: f.contenido, sha256: f.sha256 };
  }

  return { crear, editar, reemplazarArchivo, fijarActivo, borrar, renombrarEstilo, importarLote, listarAdmin, indice, archivo, revisionGlobal };
}
export type ServicioGroovesCatalogo = ReturnType<typeof crearServicioGrooves>;

function pick(f: FilaGroove): Metadatos {
  return { nombre: f.nombre, estilo: f.estilo, tipo: f.tipo, compas: f.compas, tempo: f.tempo, compases: f.compases, intensidad: f.intensidad, etiquetas: f.etiquetas, autor: f.autor, licencia: f.licencia };
}
function limpiar(c: Partial<Metadatos> & { archivo?: string }): Partial<Metadatos> {
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== 'archivo' && v !== undefined)) as Partial<Metadatos>;
}
function mensaje(e: unknown): string {
  if (e instanceof ErrorApi) return e.message;
  if (e && typeof e === 'object' && 'issues' in e) return (e as { issues: Array<{ message: string }> }).issues.map((i) => i.message).join('; ');
  return e instanceof Error ? e.message : String(e);
}
