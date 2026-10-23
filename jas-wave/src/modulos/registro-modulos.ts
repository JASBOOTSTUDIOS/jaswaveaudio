/**
 * Módulos del DAW (M1/M3): piezas instalables (asistente IA, partitura, MIDI·MD, terceros) que viven
 * fuera del código del DAW. Cada módulo es un paquete independiente (plugins/<id>/) cuyo código se
 * descarga del catálogo firmado y se carga en tiempo de ejecución; exporta `definirModulo` del SDK
 * (@jaswave/host-sdk). El núcleo solo conoce este registro:
 *
 *   registrarModulo(fuente) → (si está activo) cargar() → activar(ctx) → herramientas + contribuciones
 *
 * La activación se guarda por equipo. Desactivar quita sus herramientas y contribuciones sin tocar el
 * proyecto ni el audio.
 */

import type { ContextoModulo, DefinicionModulo, ModuloActivo } from '@jaswave/host-sdk/contrato'
import { VERSION_SDK } from '@jaswave/host-sdk/runtime'
import { quitarHerramientasDeModulo, registrarHerramienta } from '../workspace/types'

/** De dónde sale el código de un módulo. */
export type FuenteModulo = {
  id: string
  nombre: string
  descripcion: string
  version: string
  /** 'instalado' = paquete en el equipo (escritorio); 'catalogo' = servido por el backend (web). */
  origen: 'instalado' | 'catalogo' | 'pruebas'
  /** Activo si el usuario no lo desactivó (por defecto true). */
  activoPorDefecto?: boolean
  /** Descarga y evalúa el código del módulo. */
  cargar: () => Promise<DefinicionModulo>
}

export type EstadoCarga = 'sin-cargar' | 'descargando' | 'listo' | 'error'

type Entrada = {
  fuente: FuenteModulo
  estado: EstadoCarga
  error?: string
  definicion?: DefinicionModulo
  activo?: ModuloActivo
  promesa?: Promise<void>
}

const CLAVE = 'jaswave.modulos.v1'
export const EVENTO_MODULOS = 'jaswave-modulos-cambiados'

type Persistido = { desactivados: string[]; activados: string[] }
type Almacen = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }

const modulos = new Map<string, Entrada>()
const oyentes = new Set<() => void>()
let version = 0

function almacen(): Almacen | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function leer(): Persistido {
  try {
    const raw = almacen()?.getItem(CLAVE)
    const p = raw ? (JSON.parse(raw) as Partial<Persistido>) : {}
    return { desactivados: p.desactivados ?? [], activados: p.activados ?? [] }
  } catch {
    return { desactivados: [], activados: [] }
  }
}

let persistido: Persistido = leer()

function notificar(): void {
  version++
  for (const o of oyentes) o()
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_MODULOS))
}

function plataforma(): 'escritorio' | 'web' {
  return typeof window !== 'undefined' && window.electron ? 'escritorio' : 'web'
}

/** Almacenamiento con espacio de nombres del módulo. */
function almacenDe(id: string): ContextoModulo['almacen'] {
  const k = (c: string) => `jaswave.modulo.${id}.${c}`
  return {
    leer: (c) => almacen()?.getItem(k(c)) ?? null,
    escribir: (c, v) => {
      try {
        almacen()?.setItem(k(c), v)
      } catch {
        /* sin almacenamiento */
      }
    },
    borrar: (c) => almacen()?.removeItem?.(k(c)),
  }
}

export function moduloActivo(id: string): boolean {
  const e = modulos.get(id)
  if (!e) return false
  if (persistido.desactivados.includes(id)) return false
  if (persistido.activados.includes(id)) return true
  return e.fuente.activoPorDefecto !== false
}

/** Carga y activa el módulo (una vez). Un fallo se puede reintentar. */
export function cargarModulo(id: string): Promise<void> {
  const e = modulos.get(id)
  if (!e) return Promise.reject(new Error(`módulo desconocido: ${id}`))
  if (e.estado === 'listo') return Promise.resolve()
  if (e.promesa && e.estado === 'descargando') return e.promesa
  e.estado = 'descargando'
  delete e.error
  notificar()
  e.promesa = (async () => {
    try {
      const def = await e.fuente.cargar()
      if (!def || typeof def.activar !== 'function') throw new Error('el paquete no exporta un módulo de JasWave')
      if (def.id !== id) throw new Error(`el paquete declara el id ${def.id}, se esperaba ${id}`)
      if (def.sdk !== VERSION_SDK) throw new Error(`el módulo usa el SDK v${def.sdk}; este DAW ofrece v${VERSION_SDK}`)
      const activo = await def.activar({ idModulo: id, plataforma: plataforma(), almacen: almacenDe(id) })
      for (const h of def.herramientas) {
        if (!activo.paneles[h.id]) throw new Error(`el módulo no aporta el panel de la herramienta ${h.id}`)
      }
      // Si mientras cargaba se desactivó, no se publica nada.
      if (!moduloActivo(id)) {
        activo.desactivar?.()
        e.estado = 'sin-cargar'
        return
      }
      for (const h of def.herramientas) {
        registrarHerramienta({
          id: h.id,
          title: h.titulo,
          description: h.descripcion,
          defaultZone: h.zona,
          singleton: true,
          ...(h.bajoDemanda ? { bajoDemanda: true } : {}),
          ...(h.icono ? { icono: h.icono } : {}),
          ...(h.destacada ? { destacada: true } : {}),
          moduloId: id,
        })
      }
      e.definicion = def
      e.activo = activo
      e.estado = 'listo'
    } catch (err) {
      quitarHerramientasDeModulo(id)
      e.estado = 'error'
      e.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      notificar()
    }
  })()
  return e.promesa
}

function descargar(id: string): void {
  const e = modulos.get(id)
  if (!e) return
  try {
    e.activo?.desactivar?.()
  } catch {
    /* el módulo no debe impedir su desactivación */
  }
  quitarHerramientasDeModulo(id)
  delete e.activo
  delete e.definicion
  delete e.promesa
  e.estado = 'sin-cargar'
}

/**
 * Registra (o actualiza) un módulo disponible y, si está activo, lo carga. Re-registrar un id con otra
 * versión descarga la anterior.
 */
export function registrarModulo(fuente: FuenteModulo): Promise<void> {
  if (!/^[a-z0-9][a-z0-9.-]{1,120}$/.test(fuente.id)) throw new Error(`id de módulo inválido: ${fuente.id}`)
  const previo = modulos.get(fuente.id)
  if (previo && previo.fuente.version === fuente.version && previo.fuente.origen === fuente.origen) return previo.promesa ?? Promise.resolve()
  if (previo) descargar(fuente.id)
  modulos.set(fuente.id, { fuente, estado: 'sin-cargar' })
  notificar()
  return moduloActivo(fuente.id) ? cargarModulo(fuente.id).catch(() => {}) : Promise.resolve()
}

/** Quita un módulo (desinstalado). */
export function quitarModulo(id: string): void {
  if (!modulos.has(id)) return
  descargar(id)
  modulos.delete(id)
  notificar()
}

export function fijarModuloActivo(id: string, activo: boolean): void {
  if (!modulos.has(id)) throw new Error(`módulo desconocido: ${id}`)
  persistido = {
    desactivados: persistido.desactivados.filter((x) => x !== id).concat(activo ? [] : [id]),
    activados: persistido.activados.filter((x) => x !== id).concat(activo ? [id] : []),
  }
  try {
    almacen()?.setItem(CLAVE, JSON.stringify(persistido))
  } catch {
    /* sin almacenamiento: el estado vive en memoria */
  }
  if (activo) void cargarModulo(id).catch(() => {})
  else descargar(id)
  notificar()
}

export type VistaModulo = { fuente: FuenteModulo; activo: boolean; estado: EstadoCarga; error?: string; herramientas: string[] }

export function listarModulos(): VistaModulo[] {
  return [...modulos.values()].map((e) => ({
    fuente: e.fuente,
    activo: moduloActivo(e.fuente.id),
    estado: e.estado,
    ...(e.error ? { error: e.error } : {}),
    herramientas: e.definicion?.herramientas.map((h) => h.id) ?? [],
  }))
}

/** Panel de una herramienta aportada por un módulo activo y cargado. */
export function panelDeHerramienta(toolId: string): ModuloActivo['paneles'][string] | undefined {
  for (const e of modulos.values()) {
    const p = e.activo?.paneles[toolId]
    if (p) return p
  }
  return undefined
}

/** Contribuciones de todos los módulos activos (menús, ajustes, componentes globales, zoom). */
export function contribuciones(): ModuloActivo[] {
  return [...modulos.values()].flatMap((e) => (e.activo ? [e.activo] : []))
}

/** Suscripción para useSyncExternalStore. */
export function suscribirModulos(o: () => void): () => void {
  oyentes.add(o)
  return () => oyentes.delete(o)
}

export function versionModulos(): number {
  return version
}

/** Solo pruebas. */
export function reiniciarModulosParaPruebas(): void {
  for (const id of [...modulos.keys()]) descargar(id)
  modulos.clear()
  persistido = leer()
  notificar()
}
