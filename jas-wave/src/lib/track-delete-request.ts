/**
 * Solicitud de borrado de pista con confirmación.
 *
 * El atajo Ctrl+Delete y el menú contextual comparten el mismo diálogo
 * (`ConfirmDialog` del ArrangementView). La vista registra un manejador; si
 * no hay ninguno montado se usa `window.confirm` como respaldo, de modo que
 * borrar una pista nunca ocurre sin confirmar.
 */

type Manejador = (trackId: string) => void

let manejador: Manejador | null = null

/** Registra el manejador que abre el diálogo; devuelve la función de baja. */
export function registrarConfirmacionBorrarPista(fn: Manejador): () => void {
  manejador = fn
  return () => {
    if (manejador === fn) manejador = null
  }
}

/**
 * Pide borrar una pista. Con diálogo montado lo abre (el borrado lo hace el
 * diálogo al confirmar). Sin diálogo, confirma con `confirmarRespaldo` y
 * ejecuta `borrar` si el usuario acepta.
 */
export function solicitarBorrarPista(
  trackId: string,
  borrar: (trackId: string) => void,
  confirmarRespaldo: (mensaje: string) => boolean = (m) =>
    typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(m) : false,
): void {
  if (manejador) {
    manejador(trackId)
    return
  }
  if (confirmarRespaldo('¿Eliminar esta pista? Puedes deshacerlo con Ctrl+Z.')) borrar(trackId)
}
