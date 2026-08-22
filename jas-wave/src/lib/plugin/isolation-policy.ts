/**
 * Política de aislamiento (ADR-0011 opción C).
 * Builtin / confianza → in-process.
 * Formatos de terceros → out-of-process.
 */

import type { PluginFormat, PluginIsolationMode } from './types'

export function isolationForFormat(format: PluginFormat): PluginIsolationMode {
  if (format === 'builtin') return 'in-process'
  return 'out-of-process'
}

export function isTrustedBuiltin(pluginId: string): boolean {
  return pluginId.startsWith('jaswave.')
}
