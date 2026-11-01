/**
 * Canal entre la ventana principal y las ventanas satélite (undock).
 *
 * U7: el satélite no tiene autoridad sobre el proyecto. Solo reenvía lo que el
 * usuario pide (comandos y acciones) y aplica el estado que difunde el
 * primario. Así el archivo `.jaswave` lo guarda siempre la ventana principal,
 * que es la que tiene el estado completo.
 */

export const CANAL_SINCRONIZACION = 'jaswave-daw-sync-v1'

/** Acciones de alto nivel que el satélite reenvía al primario. */
export type AccionSatelite = 'guardar' | 'guardar-como' | 'abrir' | 'deshacer' | 'rehacer'

export type MensajeSincronizacion =
  | { type: 'state'; state: unknown }
  | { type: 'request-state' }
  | { type: 'ping' }
  | { type: 'command'; command: string; payload?: unknown }
  | { type: 'action'; action: AccionSatelite; payload?: unknown }

let canal: BroadcastChannel | null = null

/** Canal de la ventana (se crea una sola vez). */
export function obtenerCanal(): BroadcastChannel | null {
  if (canal) return canal
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    canal = new BroadcastChannel(CANAL_SINCRONIZACION)
    return canal
  } catch {
    return null
  }
}

/** Cierra el canal de la ventana (al desmontar). */
export function cerrarCanal(): void {
  try {
    canal?.close()
  } catch {
    /* ignore */
  }
  canal = null
}

/** ¿El mensaje tiene una forma conocida? */
export function esMensajeSincronizacion(data: unknown): data is MensajeSincronizacion {
  if (!data || typeof data !== 'object') return false
  const type = (data as { type?: unknown }).type
  if (type === 'state' || type === 'request-state' || type === 'ping') return true
  if (type === 'command') {
    return typeof (data as { command?: unknown }).command === 'string'
  }
  if (type === 'action') {
    const action = (data as { action?: unknown }).action
    return (
      action === 'guardar' ||
      action === 'guardar-como' ||
      action === 'abrir' ||
      action === 'deshacer' ||
      action === 'rehacer'
    )
  }
  return false
}

/** Envía un mensaje al resto de ventanas (incluida la principal). */
export function enviarMensaje(mensaje: MensajeSincronizacion): boolean {
  try {
    obtenerCanal()?.postMessage(mensaje)
    return true
  } catch {
    return false
  }
}
