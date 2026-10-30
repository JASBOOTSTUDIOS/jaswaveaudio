/**
 * Runtime compartido: el host (JasWave) instala en `globalThis.__JASWAVE_SDK__` su React y su API
 * antes de cargar módulos. Los módulos no empaquetan React ni código del DAW: lo toman de aquí, así
 * comparten instancia (contextos, hooks) y quedan desacoplados del código del host.
 */

export const VERSION_SDK = 1

export type RuntimeJasWave = {
  version: number
  react: Record<string, unknown>
  reactDom: Record<string, unknown>
  reactDomClient: Record<string, unknown>
  jsxRuntime: Record<string, unknown>
  /** API pública del host (funciones, constantes y hooks); ver tipos-host/. */
  api: Record<string, unknown>
}

const CLAVE = '__JASWAVE_SDK__'

export function runtime(): RuntimeJasWave {
  const r = (globalThis as Record<string, unknown>)[CLAVE] as RuntimeJasWave | undefined
  if (!r) throw new Error('Este módulo debe cargarse dentro de JasWave (falta el runtime del host).')
  if (r.version !== VERSION_SDK) throw new Error(`SDK incompatible: el host ofrece v${r.version}, el módulo necesita v${VERSION_SDK}`)
  return r
}

/** Lo llama el host una sola vez al arrancar. */
export function instalarRuntime(r: RuntimeJasWave): void {
  const g = globalThis as Record<string, unknown>
  if (g[CLAVE] && g[CLAVE] !== r) throw new Error('el runtime de JasWave ya estaba instalado')
  g[CLAVE] = r
}

/** API del host: falla con un mensaje claro si el host no ofrece algo (versión antigua). */
export function api<T>(nombre: string): T {
  const v = runtime().api[nombre]
  if (v === undefined) throw new Error(`El DAW no ofrece «${nombre}» en esta versión del SDK.`)
  return v as T
}
