/**
 * Detector de crash-loop del motor de audio (U7).
 *
 * Propósito:
 *   Contar las salidas inesperadas del plugin host en una ventana de tiempo y
 *   avisar cuando el motor entra en bucle de fallos, en vez de rendirse en
 *   silencio y obligar a reiniciar JasWave.
 *
 * Importancia:
 *   - La UI puede ofrecer "Reiniciar motor" (limpia el contador y rearranca).
 *   - Un fallo puntual (un VST que tumba el host) no debe contar como bucle.
 *
 * Función:
 *   Lógica pura: `registrarSalidaInesperada`, `hayCrashLoop`, `limpiarSalidas`
 *   y las constantes de ventana y umbral.
 */

/** Ventana en la que se cuentan las salidas (ms). */
export const VENTANA_CRASH_LOOP_MS = 60_000

/** Salidas inesperadas en la ventana a partir de las cuales hay crash-loop. */
export const UMBRAL_CRASH_LOOP = 4

/** Registra una salida inesperada y descarta las que ya están fuera de la ventana. */
export function registrarSalidaInesperada(salidas: number[], ahora: number): number[] {
  const dentro = salidas.filter((t) => ahora - t < VENTANA_CRASH_LOOP_MS)
  dentro.push(ahora)
  return dentro
}

/** ¿Las salidas registradas indican un bucle de fallos? */
export function hayCrashLoop(salidas: number[]): boolean {
  return salidas.length >= UMBRAL_CRASH_LOOP
}

/** Limpia el contador (tras un reinicio manual del motor). */
export function limpiarSalidas(): number[] {
  return []
}
