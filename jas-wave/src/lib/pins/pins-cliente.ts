/**
 * Cliente de pins (renderer): refleja la jerarquía que mantiene el proceso main.
 * Índice 0 = el elemento anclado que queda por encima de todos; en la UI se muestra como nivel 1.
 * Sin Electron (navegador/tests) el store queda vacío y las acciones no hacen nada.
 */

export type TipoPin = 'editor' | 'panel'
export type PinInfo = { clave: string; tipo: TipoPin; id: string; etiqueta: string }
export type EstadoPins = { proyecto: string; lista: PinInfo[] }

type ApiPins = {
  estado(): Promise<EstadoPins>
  establecerProyecto(clave: string): Promise<EstadoPins>
  alternar(tipo: TipoPin, id: string, etiqueta?: string): Promise<EstadoPins>
  mover(clave: string, delta: number): Promise<EstadoPins>
  moverA(clave: string, destino: number): Promise<EstadoPins>
  quitar(clave: string): Promise<EstadoPins>
  onCambio(cb: (e: EstadoPins) => void): () => void
}

const VACIO: EstadoPins = { proyecto: '', lista: [] }
let estado: EstadoPins = VACIO
const oyentes = new Set<() => void>()
let desuscribirMain: (() => void) | null = null

function api(): ApiPins | null {
  if (typeof window === 'undefined') return null
  const p = (window as unknown as { electron?: { pins?: ApiPins } }).electron?.pins
  return p ?? null
}

function esEstado(x: unknown): x is EstadoPins {
  return !!x && typeof x === 'object' && Array.isArray((x as EstadoPins).lista)
}

function aplicar(nuevo: unknown) {
  if (!esEstado(nuevo)) return
  estado = nuevo
  for (const l of oyentes) l()
}

export function getEstadoPins(): EstadoPins {
  return estado
}

export function subscribePins(l: () => void): () => void {
  oyentes.add(l)
  if (oyentes.size === 1) {
    const a = api()
    if (a) {
      desuscribirMain = a.onCambio(aplicar)
      void a.estado().then(aplicar).catch(() => undefined)
    }
  }
  return () => {
    oyentes.delete(l)
    if (oyentes.size === 0) {
      desuscribirMain?.()
      desuscribirMain = null
    }
  }
}

export const clavePinEditor = (slotId: string) => `editor:${slotId}`
export const clavePinPanel = (toolId: string) => `panel:${toolId}`

/** Índice (0 = más arriba) de una clave anclada, o -1. */
export function indicePin(lista: readonly PinInfo[], clave: string): number {
  return lista.findIndex((p) => p.clave === clave)
}

async function ejecutar(fn: (a: ApiPins) => Promise<EstadoPins>) {
  const a = api()
  if (!a) return
  try {
    aplicar(await fn(a))
  } catch {
    /* el pin es de mejor esfuerzo */
  }
}

export const alternarPin = (tipo: TipoPin, id: string, etiqueta?: string) => ejecutar((a) => a.alternar(tipo, id, etiqueta))
export const moverPin = (clave: string, delta: number) => ejecutar((a) => a.mover(clave, delta))
export const moverPinA = (clave: string, destino: number) => ejecutar((a) => a.moverA(clave, destino))
export const quitarPin = (clave: string) => ejecutar((a) => a.quitar(clave))
/** Solo la ventana principal: cada proyecto conserva su propia jerarquía de anclados. */
export const establecerProyectoPins = (clave: string) => ejecutar((a) => a.establecerProyecto(clave))
