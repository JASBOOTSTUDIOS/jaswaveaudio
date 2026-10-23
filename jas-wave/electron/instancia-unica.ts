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

/**
 * Enlace profundo de handover web → escritorio (H1): `jaswave://abrir?token=<token>`.
 * Devuelve el token si el enlace es exactamente ese (esquema, acción y formato del token); cualquier
 * otra cosa se ignora para que un enlace malicioso no pueda pedir acciones arbitrarias a la app.
 */
export function tokenHandoverDeArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string' || !/^jaswave:/i.test(arg)) continue
    let url: URL
    try {
      url = new URL(arg)
    } catch {
      continue
    }
    const accion = (url.hostname || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase()
    if (url.protocol !== 'jaswave:' || accion !== 'abrir') continue
    const token = url.searchParams.get('token') ?? ''
    if (/^[A-Za-z0-9_-]{40,60}$/.test(token)) return token
  }
  return null
}
