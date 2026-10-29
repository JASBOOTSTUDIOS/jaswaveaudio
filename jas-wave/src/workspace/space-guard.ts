/**
 * Blindaje de espacio de los paneles acoplados: por debajo de su tamaño operativo un panel sigue siendo
 * usable (scroll o modo compacto), pero pierde controles. Entonces se ofrece flotarlo, ocultarlo o mantenerlo.
 * El tamaño operativo es mayor que el mínimo de `tamanoMinimoHerramienta` (que solo evita deformaciones).
 */
import type { ToolId } from './types'

export type UmbralOperativo = { w?: number; h?: number }

/** Tamaño (px) por debajo del cual el panel ya no muestra todos sus controles. */
const UMBRAL_OPERATIVO: Record<string, UmbralOperativo> = {
  // Barra (36) + nivel completo de las tiras (umbralesMixer): por debajo se ocultan FX/envíos.
  mixer: { h: 420 },
  'piano-roll': { w: 520, h: 300 },
  // Pestaña Audio: fader de 160 px + lectura + cabecera y pestañas.
  'track-detail': { w: 280, h: 340 },
  'plugin-editor': { w: 520, h: 380 },
  'fx-chain': { w: 280, h: 300 },
}

export function umbralOperativo(toolId: ToolId): UmbralOperativo | null {
  return UMBRAL_OPERATIVO[toolId] ?? null
}

/** true si el visor (medido, > 0) es más pequeño que el umbral en ancho o en alto. */
export function espacioReducido(size: { width: number; height: number }, umbral: UmbralOperativo | null): boolean {
  if (!umbral) return false
  const bajoAncho = umbral.w != null && size.width > 0 && size.width < umbral.w
  const bajoAlto = umbral.h != null && size.height > 0 && size.height < umbral.h
  return bajoAncho || bajoAlto
}

/** Texto del aviso según qué dimensión falta. */
export function mensajeEspacio(titulo: string, size: { width: number; height: number }, umbral: UmbralOperativo): string {
  const faltaAlto = umbral.h != null && size.height > 0 && size.height < umbral.h
  const faltaAncho = umbral.w != null && size.width > 0 && size.width < umbral.w
  const que = faltaAlto && faltaAncho ? 'Poco espacio' : faltaAlto ? 'Poca altura' : 'Poco ancho'
  return `${que} para ${titulo}: algunos controles se ocultan.`
}

const CLAVE = 'jaswave.avisoEspacio.silenciados'

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function almacen(): Almacen | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function leer(s: Almacen | null): Record<string, true> {
  if (!s) return {}
  try {
    const v = JSON.parse(s.getItem(CLAVE) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, true>) : {}
  } catch {
    return {}
  }
}

/** «Recordar preferencia»: no volver a avisar para esta herramienta. */
export function avisoSilenciado(toolId: ToolId, s: Almacen | null = almacen()): boolean {
  return leer(s)[toolId] === true
}

export function silenciarAviso(toolId: ToolId, s: Almacen | null = almacen()): void {
  if (!s) return
  try {
    s.setItem(CLAVE, JSON.stringify({ ...leer(s), [toolId]: true }))
  } catch {
    /* almacenamiento lleno o bloqueado: el aviso volverá a salir */
  }
}

/** Vuelve a activar todos los avisos (p. ej. al restablecer la distribución). */
export function restablecerAvisosEspacio(s: Almacen | null = almacen()): void {
  try {
    s?.removeItem(CLAVE)
  } catch {
    /* ignore */
  }
}
