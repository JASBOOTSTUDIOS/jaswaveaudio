/**
 * Conversación activa del asistente (si hay un módulo de IA activo). La terminal del DAW la usa para
 * asociar a esa conversación lo que ejecuta; el módulo la fija a través del SDK.
 */

let activa: string | null = null

export function fijarConversacionActiva(id: string | null): void {
  activa = id
}

export function conversacionActiva(): string | null {
  return activa
}
