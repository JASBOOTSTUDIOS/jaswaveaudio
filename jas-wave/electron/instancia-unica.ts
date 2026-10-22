/**
 * Instancia única y apertura de proyectos (U7).
 *
 * Funciones puras (sin Electron) para que se puedan testear aparte de `main.ts`.
 * Cuando JasWave ya está en marcha, la segunda instancia cede el foco y pide a la
 * principal que abra el `.jaswave` recibido en los argumentos.
 */

/** Extensión de los proyectos de JasWave. */
export const EXTENSION_PROYECTO = '.jaswave'

/** ¿La ruta apunta a un proyecto de JasWave? */
export function esRutaProyecto(ruta: unknown): ruta is string {
  return typeof ruta === 'string' && ruta.trim().toLowerCase().endsWith(EXTENSION_PROYECTO)
}

/**
 * Extrae la primera ruta de proyecto válida de los argumentos de la app.
 *
 * En Windows la asociación de archivos añade la ruta al final de `process.argv`;
 * en desarrollo el primer argumento es la carpeta de la app (no es un proyecto).
 *
 * @param argv argumentos de la app
 * @param existe comprueba que el archivo existe (por defecto, siempre true)
 */
export function rutaProyectoDeArgv(
  argv: readonly string[],
  existe: (ruta: string) => boolean = () => true,
): string | null {
  for (const arg of argv) {
    if (!esRutaProyecto(arg)) continue
    const abs = arg.trim()
    if (!abs) continue
    try {
      if (!existe(abs)) continue
    } catch {
      continue
    }
    return abs
  }
  return null
}
