/**
 * Modo Directo (K3): PANIC, seguridad del máster hacia el host y bloqueo de atajos destructivos mientras se
 * toca en vivo. El estado (zonas, seguridad, bloqueo) vive en `project.directo` y se cambia con comandos;
 * aquí solo están los efectos (host nativo) y la guarda de teclado.
 */

import type { SeguridadMaster } from '../../../shared/src/types/directo'

type ApiHost = {
  pluginHostMidi?: (cmd: unknown) => unknown
  pluginHostSend?: (cmd: unknown) => Promise<unknown>
}

function api(): ApiHost | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { electron?: ApiHost }).electron : undefined
}

/**
 * PANIC: el host descarta el MIDI pendiente del teclado y apaga todas las notas de todos los instrumentos;
 * la app vacía su cola de notas adelantadas (y reprograma si está reproduciendo).
 */
export function panicDirecto(): void {
  try {
    const a = api()
    const cmd = { type: 'panic' }
    if (typeof a?.pluginHostMidi === 'function') a.pluginHostMidi(cmd)
    else void a?.pluginHostSend?.(cmd)
  } catch {
    /* sin host (web) */
  }
  void import('@/lib/audio-engine')
    .then((m) => m.audioEngine.allNotesOff())
    .catch(() => undefined)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_PANIC))
}

/** Aviso para otros módulos (p. ej. seguimiento de notas del thru) de que todo se apagó. */
export const EVENTO_PANIC = 'jaswave-directo-panic'

/** Limitador true-peak del máster en el host (fire-and-forget, como setMonitorMix). */
export function enviarSeguridadMaster(seguridad: SeguridadMaster | undefined): void {
  const s = seguridad ?? { activa: false, techoDb: -0.5 }
  try {
    void api()?.pluginHostSend?.({ type: 'setMasterSafety', enabled: s.activa === true, ceilingDb: s.techoDb })
  } catch {
    /* sin host (web) */
  }
}

export type TeclaPulsada = {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  /** true si el foco está en un campo de texto: ahí nunca se interfiere. */
  enCampoDeTexto?: boolean
}

/**
 * Atajos que el bloqueo del modo Directo detiene: borrar, deshacer/rehacer, cortar, pegar y duplicar. No toca
 * campos de texto (chat, nombres) ni el transporte (espacio, grabar), que se siguen usando en directo.
 */
export function esAtajoBloqueadoEnDirecto(t: TeclaPulsada): boolean {
  if (t.enCampoDeTexto) return false
  const k = t.key.length === 1 ? t.key.toLowerCase() : t.key
  if (k === 'Delete' || k === 'Backspace') return true
  const mod = Boolean(t.ctrlKey || t.metaKey)
  if (!mod) return false
  return k === 'z' || k === 'y' || k === 'x' || k === 'v' || k === 'd'
}

export function esCampoDeTexto(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const el = target as HTMLElement
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}

/**
 * Instala la guarda de teclado (fase de captura, antes que cualquier panel). Devuelve la función para quitarla.
 */
export function instalarBloqueoDirecto(estaBloqueado: () => boolean): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onKey = (e: KeyboardEvent) => {
    if (!estaBloqueado()) return
    if (!esAtajoBloqueadoEnDirecto({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, enCampoDeTexto: esCampoDeTexto(e.target) })) return
    e.preventDefault()
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(EVENTO_ATAJO_BLOQUEADO, { detail: { key: e.key } }))
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}

export const EVENTO_ATAJO_BLOQUEADO = 'jaswave-directo-atajo-bloqueado'
