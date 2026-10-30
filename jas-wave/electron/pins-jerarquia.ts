/**
 * Jerarquía de elementos anclados (pin): editores nativos de plugins y paneles flotantes.
 *
 * Criterio: la lista está ordenada de arriba abajo. El ÍNDICE 0 es el elemento que queda por encima de todos
 * los anclados; el último queda justo por encima de los no anclados. Un anclado nuevo entra al final (no
 * altera lo ya organizado). Lógica pura, sin Electron: se prueba con node:test.
 */

export type TipoPin = 'editor' | 'panel'

export type Pin = {
  /** `editor:<slotId>` | `panel:<toolId>` — identificador estable y único. */
  clave: string
  tipo: TipoPin
  /** slotId (editor) o toolId (panel). */
  id: string
  etiqueta: string
}

export const MAX_PINS = 32
const MAX_PROYECTOS = 200

export function clavePin(tipo: TipoPin, id: string): string {
  return `${tipo}:${id}`
}

export function crearPin(tipo: TipoPin, id: string, etiqueta?: string): Pin {
  return { clave: clavePin(tipo, id), tipo, id, etiqueta: (etiqueta ?? id).slice(0, 120) }
}

export function indiceDe(lista: readonly Pin[], clave: string): number {
  return lista.findIndex((p) => p.clave === clave)
}

/** Ancla al final de la jerarquía. Si ya estaba anclado solo actualiza la etiqueta (conserva su índice). */
export function anclar(lista: readonly Pin[], pin: Pin): Pin[] {
  const i = indiceDe(lista, pin.clave)
  if (i >= 0) return lista.map((p, k) => (k === i ? { ...p, etiqueta: pin.etiqueta || p.etiqueta } : p))
  if (lista.length >= MAX_PINS) return lista.slice()
  return [...lista, pin]
}

export function desanclar(lista: readonly Pin[], clave: string): Pin[] {
  return lista.filter((p) => p.clave !== clave)
}

/** Mueve un elemento a la posición `destino` (se acota al rango válido). */
export function moverA(lista: readonly Pin[], clave: string, destino: number): Pin[] {
  const i = indiceDe(lista, clave)
  if (i < 0) return lista.slice()
  const d = Math.max(0, Math.min(lista.length - 1, Math.trunc(destino)))
  if (d === i) return lista.slice()
  const copia = lista.slice()
  const [p] = copia.splice(i, 1)
  copia.splice(d, 0, p!)
  return copia
}

/** delta < 0 sube (índice menor = más arriba), delta > 0 baja. */
export function mover(lista: readonly Pin[], clave: string, delta: number): Pin[] {
  const i = indiceDe(lista, clave)
  if (i < 0) return lista.slice()
  return moverA(lista, clave, i + Math.trunc(delta))
}

/** Quita los anclados que ya no existen (p. ej. slot descargado). */
export function purgar(lista: readonly Pin[], sigueVivo: (pin: Pin) => boolean): Pin[] {
  return lista.filter(sigueVivo)
}

/** Orden de aplicación al SO: del índice más alto al 0, para que el 0 acabe encima de todos. */
export function ordenDeAplicacion(lista: readonly Pin[]): Pin[] {
  return lista.slice().reverse()
}

// ── Persistencia (por proyecto) ─────────────────────────────────────────────

export type PinsPersistidos = { version: 1; proyectos: Record<string, Pin[]> }

export function persistidoVacio(): PinsPersistidos {
  return { version: 1, proyectos: {} }
}

function pinValido(x: unknown): Pin | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if ((o.tipo !== 'editor' && o.tipo !== 'panel') || typeof o.id !== 'string' || !o.id || o.id.length > 512) return null
  return crearPin(o.tipo, o.id, typeof o.etiqueta === 'string' ? o.etiqueta : o.id)
}

/** Parseo tolerante: JSON corrupto o de otra versión → vacío; descarta entradas inválidas y duplicados. */
export function parsearPersistido(raw: string | null | undefined): PinsPersistidos {
  if (!raw) return persistidoVacio()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return persistidoVacio()
  }
  if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1) return persistidoVacio()
  const proyectos = (data as { proyectos?: unknown }).proyectos
  const out = persistidoVacio()
  if (!proyectos || typeof proyectos !== 'object') return out
  for (const [clave, lista] of Object.entries(proyectos as Record<string, unknown>).slice(0, MAX_PROYECTOS)) {
    if (!Array.isArray(lista)) continue
    let pins: Pin[] = []
    for (const e of lista) {
      const pin = pinValido(e)
      if (pin) pins = anclar(pins, pin)
    }
    if (pins.length) out.proyectos[clave] = pins
  }
  return out
}

export function serializarPersistido(p: PinsPersistidos): string {
  return JSON.stringify(p)
}

/** Devuelve una copia del persistido con la lista de ese proyecto reemplazada (vacía = se borra la entrada). */
export function conProyecto(p: PinsPersistidos, proyecto: string, lista: readonly Pin[]): PinsPersistidos {
  const proyectos = { ...p.proyectos }
  if (lista.length) proyectos[proyecto] = lista.slice()
  else delete proyectos[proyecto]
  return { version: 1, proyectos }
}
