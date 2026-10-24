/**
 * Layouts de los 7 VST de JasWave (copiados de plugins/<id>/ui-layout.json por plugins/scripts/ui-layout.mjs)
 * y búsqueda por el nombre con el que el plugin está insertado en la pista.
 */

import type { UiLayout } from '@jaswave/ui-cyber'
import datos from './generado/layouts.json'

export type EntradaLayout = { nombre: string; layout: UiLayout }

export const LAYOUTS = datos as unknown as EntradaLayout[]

// Nombres históricos de los FX y del instrumento por roles (proyectos anteriores al manifiesto V5)
const ALIAS: Array<[RegExp, string]> = [
  [/\b(eq|ecualizador|equalizer)\b/, 'com.jaswave.plugin.param-eq'],
  [/\b(bus compressor|compresor|compressor)\b/, 'com.jaswave.plugin.bus-compressor'],
  [/\b(limitador|limiter)\b/, 'com.jaswave.plugin.truepeak-limiter'],
  [/\bde-?esser\b/, 'com.jaswave.plugin.smart-deesser'],
  [/\butility\b/, 'com.jaswave.plugin.utility-tool'],
  [/\bpiano\b/, 'com.jaswave.plugin.piano-synth'],
  [/\broles\b/, 'com.jaswave.plugin.roles-vst'],
]

/** Layout del VST de JasWave con ese nombre (o null si no es uno de los nuestros). */
export function layoutPorNombre(nombre: string): UiLayout | null {
  const n = nombre.trim().toLowerCase()
  const exacto = LAYOUTS.find((e) => e.nombre.toLowerCase() === n)
  if (exacto) return exacto.layout
  if (!n.startsWith('jaswave')) return null
  for (const [patron, id] of ALIAS) if (patron.test(n)) return LAYOUTS.find((e) => e.layout.productId === id)?.layout ?? null
  return null
}
