/**
 * Sistema de archivos del cliente web (W1): los `.jaswave` se guardan en IndexedDB bajo rutas
 * `web://proyectos/<nombre>.jaswave`. Implementa el mismo FileService que usan `project.save` y
 * `project.load`, así guardar/abrir funcionan igual que en escritorio y con el mismo formato.
 */

import type { FileService } from '../../../../shared/src/project/persistencia'

export const PREFIJO_WEB = 'web://proyectos/'

export type RegistroArchivoWeb = { ruta: string; contenido: string; actualizado: number }

/** Almacén clave-valor mínimo (IndexedDB en el navegador; memoria en pruebas). */
export interface AlmacenArchivos {
  obtener(ruta: string): Promise<RegistroArchivoWeb | undefined>
  poner(registro: RegistroArchivoWeb): Promise<void>
  borrar(ruta: string): Promise<void>
  todos(): Promise<RegistroArchivoWeb[]>
}

export function almacenMemoria(): AlmacenArchivos {
  const mapa = new Map<string, RegistroArchivoWeb>()
  return {
    obtener: async (r) => mapa.get(r),
    poner: async (reg) => void mapa.set(reg.ruta, reg),
    borrar: async (r) => void mapa.delete(r),
    todos: async () => [...mapa.values()],
  }
}

/** Almacén sobre IndexedDB (base `jaswave-web`, almacén `archivos`). */
export function almacenIndexedDB(nombreBase = 'jaswave-web'): AlmacenArchivos {
  let base: Promise<IDBDatabase> | null = null
  const abrir = () =>
    (base ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(nombreBase, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('archivos', { keyPath: 'ruta' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB no disponible'))
    }))
  const operar = async <T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await abrir()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('archivos', modo)
      const req = fn(tx.objectStore('archivos'))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('error de IndexedDB'))
      tx.onabort = () => reject(tx.error ?? new Error('transacción abortada (¿sin espacio?)'))
    })
  }
  return {
    obtener: (r) => operar('readonly', (s) => s.get(r) as IDBRequest<RegistroArchivoWeb | undefined>),
    poner: (reg) => operar('readwrite', (s) => s.put(reg)).then(() => undefined),
    borrar: (r) => operar('readwrite', (s) => s.delete(r)).then(() => undefined),
    todos: () => operar('readonly', (s) => s.getAll() as IDBRequest<RegistroArchivoWeb[]>),
  }
}

/** Ruta web segura para un nombre de proyecto. */
export function rutaWebPara(nombre: string | undefined): string {
  const limpio = (nombre || 'Proyecto sin nombre')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  return `${PREFIJO_WEB}${limpio || 'Proyecto'}.jaswave`
}

function comprobarRuta(ruta: string): void {
  if (!ruta.startsWith(PREFIJO_WEB) || ruta.includes('..')) throw new Error(`ruta web no válida: ${ruta}`)
}

export class FileServiceNavegador implements FileService {
  constructor(private readonly almacen: AlmacenArchivos = almacenIndexedDB()) {}

  async guardar(ruta: string, contenido: string): Promise<void> {
    comprobarRuta(ruta)
    await this.almacen.poner({ ruta, contenido, actualizado: Date.now() })
  }

  async leer(ruta: string): Promise<string> {
    comprobarRuta(ruta)
    const r = await this.almacen.obtener(ruta)
    if (!r) throw new Error(`Archivo no encontrado: ${ruta}`)
    return r.contenido
  }

  async existe(ruta: string): Promise<boolean> {
    return ruta.startsWith(PREFIJO_WEB) && !!(await this.almacen.obtener(ruta))
  }

  async obtenerTamano(ruta: string): Promise<number> {
    const r = await this.almacen.obtener(ruta)
    return r ? new TextEncoder().encode(r.contenido).length : 0
  }

  async eliminar(ruta: string): Promise<void> {
    comprobarRuta(ruta)
    await this.almacen.borrar(ruta)
  }

  /** Proyectos guardados en este navegador, más recientes primero (sin copias de respaldo). */
  async listarProyectos(): Promise<{ ruta: string; nombre: string; actualizado: number; bytes: number }[]> {
    return (await this.almacen.todos())
      .filter((r) => r.ruta.endsWith('.jaswave'))
      .map((r) => ({
        ruta: r.ruta,
        nombre: r.ruta.slice(PREFIJO_WEB.length).replace(/\.jaswave$/, ''),
        actualizado: r.actualizado,
        bytes: new TextEncoder().encode(r.contenido).length,
      }))
      .sort((a, b) => b.actualizado - a.actualizado)
  }

  limpiar(): void {
    // noop: los datos viven en IndexedDB
  }
}
