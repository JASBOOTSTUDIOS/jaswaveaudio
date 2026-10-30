/**
 * Vigilancia de memoria (plan Q): decide, con medidas del sistema, si hay riesgo de quedarse sin memoria. Pura y sin
 * Electron para poder probarla. El aviso al usuario se redacta en lenguaje llano (nada de megabytes ni procesos).
 */

export type MedidaMemoria = {
  /** Memoria que usa la app entera (renderer + main + GPU), en bytes. */
  appBytes: number
  /** RAM libre del sistema, en bytes. */
  libresBytes: number
  /** RAM total del sistema, en bytes. */
  totalBytes: number
}

export type NivelMemoria = 'ok' | 'alta' | 'critica'

const GB = 1024 ** 3

/**
 * `alta`: queda poca RAM libre respecto al total o la app ya se come la mayor parte de lo disponible, de modo que
 * conviene un punto de control extra y un aviso. `critica`: casi nada libre; además se recomienda cerrar otros programas.
 */
export function evaluarMemoria(m: MedidaMemoria): NivelMemoria {
  const libreRel = m.totalBytes > 0 ? m.libresBytes / m.totalBytes : 1
  const parteApp = m.appBytes / Math.max(1, m.appBytes + m.libresBytes)
  if (m.libresBytes < 0.4 * GB || libreRel < 0.04) return 'critica'
  if (m.libresBytes < 1 * GB || libreRel < 0.1 || (parteApp > 0.8 && m.libresBytes < 2 * GB)) return 'alta'
  return 'ok'
}

export function avisoMemoria(n: NivelMemoria): string | null {
  if (n === 'critica') return 'Al ordenador casi no le queda memoria. He guardado una copia de tu proyecto por seguridad; cierra otros programas para que la producción pueda seguir sin problemas.'
  if (n === 'alta') return 'Al ordenador le queda poca memoria. He guardado una copia de tu proyecto por seguridad; si notas lentitud, cierra otros programas.'
  return null
}
