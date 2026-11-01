/**
 * Estado compartido de la sesión de grabación (U6).
 *
 * Cuando se detiene la grabación, el provider escribe el WAV y crea el clip:
 * es una operación asíncrona que puede tardar. Otras acciones (nuevo/abrir/
 * cerrar proyecto) deben **esperar a que la toma esté escrita** antes de
 * cambiar de proyecto, o la toma se pierde.
 *
 * Sin dependencias de UI: el provider publica el estado y `project-io` espera.
 */

let pendiente: Promise<void> | null = null
let resolver: (() => void) | null = null

/**
 * El provider informa de que empieza una grabación: se abre la espera.
 * La promesa se cierra cuando la toma está escrita (`cerrarFinalizacionGrabacion`).
 */
export function iniciarFinalizacionGrabacion(): void {
  if (pendiente) return
  pendiente = new Promise<void>((r) => {
    resolver = r
  })
}

/** La toma ya está escrita (o se perdió): se cierra la espera. */
export function cerrarFinalizacionGrabacion(): void {
  resolver?.()
  resolver = null
  pendiente = null
}

/** ¿Hay una grabación en curso (toma sin escribir)? */
export function hayGrabacionActiva(): boolean {
  return pendiente !== null
}

/**
 * Espera a que la toma en curso termine de escribirse.
 * Devuelve false si no había grabación o si se agotó el tiempo.
 */
export async function esperarFinalizacionGrabacion(timeoutMs = 10_000): Promise<boolean> {
  const p = pendiente
  if (!p) return false
  let terminada = false
  await Promise.race([
    p.then(() => {
      terminada = true
    }),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ])
  return terminada
}

/** Solo tests: limpia el estado del módulo. */
export function _reiniciarSesionGrabacion(): void {
  pendiente = null
  resolver = null
}
