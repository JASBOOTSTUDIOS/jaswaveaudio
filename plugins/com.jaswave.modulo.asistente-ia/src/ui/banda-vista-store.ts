/**
 * Preferencias de vista de la banda virtual: dónde se muestra (dentro del chat o en su propio panel)
 * y si está plegada. Se recuerdan por usuario en este equipo.
 */
import { useSyncExternalStore } from 'react'

export type UbicacionBanda = 'chat' | 'panel'
export type VistaBanda = { ubicacion: UbicacionBanda; plegada: boolean; /** El panel aparte está abierto ahora. */ panelAbierto: boolean }

/** Id de la herramienta del módulo con la banda en panel propio. */
export const HERRAMIENTA_BANDA = 'banda-virtual'

const CLAVE = 'jaswave.asistente.banda-vista'
const POR_DEFECTO: VistaBanda = { ubicacion: 'chat', plegada: false, panelAbierto: false }
const oyentes = new Set<() => void>()

function leer(): VistaBanda {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Partial<VistaBanda> | null
    return { ubicacion: v?.ubicacion === 'panel' ? 'panel' : 'chat', plegada: v?.plegada === true, panelAbierto: false }
  } catch {
    return POR_DEFECTO
  }
}

let actual: VistaBanda = leer()

export function vistaBanda(): VistaBanda {
  return actual
}

export function cambiarVistaBanda(patch: Partial<VistaBanda>): void {
  actual = { ...actual, ...patch }
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ ubicacion: actual.ubicacion, plegada: actual.plegada }))
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  for (const f of oyentes) f()
}

let paneles = 0

/** El panel aparte avisa al montarse y al cerrarse (lo devuelto). */
export function registrarPanelBanda(): () => void {
  paneles++
  cambiarVistaBanda({ panelAbierto: true })
  return () => {
    paneles = Math.max(0, paneles - 1)
    cambiarVistaBanda({ panelAbierto: paneles > 0 })
  }
}

/** ¿El chat debe mostrar la tarjeta? Solo se va del chat si el usuario la llevó al panel y está abierto. */
export function bandaEnChat(v: VistaBanda): boolean {
  return v.ubicacion === 'chat' || !v.panelAbierto
}

/** Abre el panel aparte de la banda (deja traza de quién lo pidió). */
export function abrirPanelBanda(motivo: string, abrir: (id: string) => void): void {
  console.info(`[banda] vista: abrir panel aparte (${motivo})`)
  abrir(HERRAMIENTA_BANDA)
}

function suscribir(f: () => void): () => void {
  oyentes.add(f)
  return () => oyentes.delete(f)
}

export function useVistaBanda(): VistaBanda {
  return useSyncExternalStore(suscribir, vistaBanda, vistaBanda)
}
