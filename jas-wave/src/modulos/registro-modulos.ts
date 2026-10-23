/**
 * Módulos del DAW (M1): piezas opcionales (asistente IA, partitura, MIDI·MD…) que aportan herramientas
 * al workspace y se activan, desactivan o descargan sin tocar el núcleo. El código de cada módulo se
 * carga con `import()` diferido, así que en la web solo se descarga al activarlo y abrirlo.
 *
 * Un módulo se registra con `registrarModulo`; el núcleo pregunta `herramientaDisponible(toolId)`
 * antes de listar o montar una herramienta. Los módulos esenciales no se pueden desactivar.
 */

import type { ComponentType } from 'react'
import type { ToolId } from '../workspace/types'

export type PanelesModulo = Partial<Record<ToolId, ComponentType>>

export type ModuloDAW = {
  id: string
  nombre: string
  descripcion: string
  version: string
  /** Herramientas del workspace que aporta (deben existir en TOOL_CATALOG). */
  herramientas: ToolId[]
  /** Capacidades que expone (p. ej. 'ia.chat', 'ia.agente'); informativo para la UI y la IA. */
  capacidades?: string[]
  /** Activo si el usuario no lo desactivó (por defecto true). */
  activoPorDefecto?: boolean
  /** Carga el código del módulo (chunk aparte). */
  cargar: () => Promise<PanelesModulo>
}

export type EstadoCarga = 'sin-cargar' | 'descargando' | 'listo' | 'error'

const CLAVE = 'jaswave.modulos.v1'
export const EVENTO_MODULOS = 'jaswave-modulos-cambiados'

type Persistido = { desactivados: string[]; activados: string[] }

type Almacen = { getItem(k: string): string | null; setItem(k: string, v: string): void }

const modulos = new Map<string, ModuloDAW>()
const porHerramienta = new Map<ToolId, string>()
const cargas = new Map<string, { estado: EstadoCarga; promesa?: Promise<PanelesModulo>; paneles?: PanelesModulo; error?: string }>()
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

function guardar(p: Persistido): void {
  try {
    almacen()?.setItem(CLAVE, JSON.stringify(p))
  } catch {
    /* sin almacenamiento: el estado vive en memoria */
  }
}

let persistido: Persistido = leer()

function notificar(): void {
  version++
  for (const o of oyentes) o()
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_MODULOS))
  }
}

export function registrarModulo(m: ModuloDAW): void {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(m.id)) throw new Error(`id de módulo inválido: ${m.id}`)
  for (const h of m.herramientas) {
    const dueño = porHerramienta.get(h)
    if (dueño && dueño !== m.id) throw new Error(`la herramienta ${h} ya pertenece al módulo ${dueño}`)
  }
  modulos.set(m.id, m)
  for (const h of m.herramientas) porHerramienta.set(h, m.id)
  notificar()
}

export function listarModulos(): ModuloDAW[] {
  return [...modulos.values()]
}

export function obtenerModulo(id: string): ModuloDAW | undefined {
  return modulos.get(id)
}

export function moduloDeHerramienta(toolId: ToolId): ModuloDAW | undefined {
  const id = porHerramienta.get(toolId)
  return id ? modulos.get(id) : undefined
}

export function moduloActivo(id: string): boolean {
  const m = modulos.get(id)
  if (!m) return false
  if (persistido.desactivados.includes(id)) return false
  if (persistido.activados.includes(id)) return true
  return m.activoPorDefecto !== false
}

/** Las herramientas del núcleo siempre están disponibles; las de un módulo, si el módulo está activo. */
export function herramientaDisponible(toolId: ToolId): boolean {
  const m = moduloDeHerramienta(toolId)
  return !m || moduloActivo(m.id)
}

export function fijarModuloActivo(id: string, activo: boolean): void {
  if (!modulos.has(id)) throw new Error(`módulo desconocido: ${id}`)
  persistido = {
    desactivados: persistido.desactivados.filter((x) => x !== id).concat(activo ? [] : [id]),
    activados: persistido.activados.filter((x) => x !== id).concat(activo ? [id] : []),
  }
  guardar(persistido)
  notificar()
  // Al activarlo se descarga ya, para que abrir sus paneles sea inmediato.
  if (activo) void cargarModulo(id).catch(() => {})
}

export function estadoCarga(id: string): { estado: EstadoCarga; error?: string } {
  const c = cargas.get(id)
  return c ? { estado: c.estado, ...(c.error ? { error: c.error } : {}) } : { estado: 'sin-cargar' }
}

/** Descarga (una vez) el código del módulo. Un fallo se puede reintentar. */
export function cargarModulo(id: string): Promise<PanelesModulo> {
  const m = modulos.get(id)
  if (!m) return Promise.reject(new Error(`módulo desconocido: ${id}`))
  const previa = cargas.get(id)
  if (previa?.promesa && previa.estado !== 'error') return previa.promesa
  const promesa = m.cargar().then(
    (paneles) => {
      cargas.set(id, { estado: 'listo', promesa, paneles })
      notificar()
      return paneles
    },
    (e: unknown) => {
      cargas.set(id, { estado: 'error', error: e instanceof Error ? e.message : String(e) })
      notificar()
      throw e
    },
  )
  cargas.set(id, { estado: 'descargando', promesa })
  notificar()
  return promesa
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
  modulos.clear()
  porHerramienta.clear()
  cargas.clear()
  persistido = leer()
  notificar()
}
