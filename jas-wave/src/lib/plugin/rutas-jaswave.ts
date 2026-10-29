/**
 * Rutas de los plugins PROPIOS de JasWave.
 *
 * El mismo plugin (p. ej. `JasWaveGrandPiano.vst3`) puede existir en varias carpetas: la instalación de usuario que
 * deja el deploy, la copia empaquetada en el instalador y la compilación agregada de desarrollo
 * (`plugins/build/VST3/Release`), que suele estar obsoleta. Esta lógica pura decide cuál usar.
 */

export const normalizarRuta = (p: string): string => p.trim().replace(/\//g, '\\').toLowerCase()

/** Nombre base (sin carpeta ni extensión) de una ruta ya normalizada. */
export const nombreBase = (rutaNormalizada: string): string =>
  rutaNormalizada.replace(/^.*\\/, '').replace(/\.(vst3|dll)$/i, '')

/** ¿Es un plugin propio de JasWave (por el nombre del archivo)? */
export function esRutaJasWave(ruta: string): boolean {
  return nombreBase(normalizarRuta(ruta)).startsWith('jaswave')
}

/**
 * Nombre comercial (el del manifiesto) y tipo de cada bundle propio. El escaneo del host solo devuelve rutas y el
 * catálogo mostraba «JasWaveGrandPiano»; además, por el nombre del archivo no se reconocía como instrumento a
 * Strings Section ni a Ambient Atmos.
 */
const BUNDLES_JASWAVE: Readonly<Record<string, { nombre: string; instrumento: boolean }>> = {
  jaswaveambience: { nombre: 'JasWave Ambience', instrumento: false },
  jaswaveambientatmos: { nombre: 'JasWave Ambient Atmos', instrumento: true },
  jaswaveaudiolens: { nombre: 'JasWave AudioLens', instrumento: false },
  jaswavebuscompressor: { nombre: 'JasWave Bus Compressor', instrumento: false },
  jaswaveelectricbass: { nombre: 'JasWave Electric Bass', instrumento: true },
  jaswaveelectricguitar: { nombre: 'JasWave Electric Guitar', instrumento: true },
  jaswavegrandpiano: { nombre: 'JasWave Grand Piano', instrumento: true },
  jaswaveparameq: { nombre: 'JasWave EQ Parametric Pro', instrumento: false },
  jaswavepiano: { nombre: 'JasWave Piano Synth', instrumento: true },
  jaswaveroles: { nombre: 'JasWave Roles', instrumento: true },
  jaswavesampler: { nombre: 'JasWave Sampler', instrumento: true },
  jaswaveshimmerpad: { nombre: 'JasWave Shimmer Pad', instrumento: true },
  jaswavesmartdeesser: { nombre: 'JasWave Smart De-Esser', instrumento: false },
  jaswavestringssection: { nombre: 'JasWave Strings Section', instrumento: true },
  jaswavetruepeaklimiter: { nombre: 'JasWave True-Peak Limiter Pro', instrumento: false },
  jaswaveutility: { nombre: 'JasWave Utility & Phase Tool', instrumento: false },
  jaswavevocaltune: { nombre: 'JasWave Vocal Tune', instrumento: false },
  jaswaveworshipdrums: { nombre: 'JasWave Worship Drums', instrumento: true },
}

/** Nombre comercial y tipo de un plugin propio por su ruta; null si no es un bundle conocido. */
export function bundleJasWave(ruta: string): { nombre: string; instrumento: boolean } | null {
  return BUNDLES_JASWAVE[nombreBase(normalizarRuta(ruta))] ?? null
}

/**
 * Prioridad de una carpeta para plugins propios (menor = mejor): instalación de usuario, luego empaquetado,
 * luego cualquier otra y, por último, la compilación de desarrollo.
 */
export function prioridadDeRutaJasWave(ruta: string): number {
  const n = normalizarRuta(ruta)
  if (n.includes('\\programs\\common\\vst3\\jaswave\\')) return 0
  if (n.includes('\\resources\\vst3\\jaswave\\')) return 1
  if (n.includes('\\plugins\\build')) return 9
  return 5
}

/**
 * Dada la ruta guardada en un proyecto (o elegida por el catálogo), devuelve la mejor copia del MISMO plugin
 * conocida en el catálogo. Los proyectos guardan la ruta con la que se insertó el plugin; sin esto seguían cargando
 * una compilación vieja de desarrollo aunque ya hubiera una versión nueva instalada.
 */
export function mejorCopiaJasWave(ruta: string, catalogo: ReadonlyArray<{ path?: string }>): string {
  if (!ruta || !esRutaJasWave(ruta)) return ruta
  const base = nombreBase(normalizarRuta(ruta))
  let mejor = ruta
  let prio = prioridadDeRutaJasWave(ruta)
  for (const d of catalogo) {
    const p = d.path
    if (!p || nombreBase(normalizarRuta(p)) !== base) continue
    const q = prioridadDeRutaJasWave(p)
    if (q < prio) {
      mejor = p
      prio = q
    }
  }
  return mejor
}
