/**
 * Sonda de plugins para `analysis.trackSound`: qué instrumento hace sonar cada pista y si el host
 * lo cargó de verdad (el proyecto solo sabe lo que se insertó, no si el VST arrancó).
 */
import type { PluginInfo, SondaPlugins, Track } from '../../../shared/src'
import { describeVstLoadError, findTrackPlaybackInstrument, getVstSlotLoadError, isPluginAudioReady } from './plugin/track-vst-runtime'
import { pluginRegistry } from './plugin/registry'

/** Instrumentos VST3 instalados y listos en el host (por nombre, como los acepta track.addVstLayer). */
export function instrumentosInstaladosApp(): string[] {
  return pluginRegistry
    .getAvailablePlugins()
    .filter((d) => d.isInstrument && d.format !== 'vst2')
    .map((d) => d.name)
    .sort((a, b) => Number(/jaswave/i.test(b)) - Number(/jaswave/i.test(a)) || a.localeCompare(b))
}

export const sondaPluginsApp: SondaPlugins = (pista: Track) => {
  const propio = (pista as Track & { instrumento?: PluginInfo }).instrumento
  const cadena = propio && !(pista.plugins ?? []).some((p) => p.id === propio.id) ? [propio, ...(pista.plugins ?? [])] : pista.plugins
  const inst = findTrackPlaybackInstrument(cadena)
  if (!inst) return { plugin: null }
  // Los instrumentos internos suenan siempre; los VST dependen del host.
  if (inst.kind === 'builtin') return { plugin: inst.plugin, listo: true }
  const error = getVstSlotLoadError(pista.id, inst.plugin.id) || (inst.plugin.estado === 'error' ? 'El host no pudo cargarlo.' : '')
  if (error) return { plugin: inst.plugin, error: describeVstLoadError(error) || error }
  return { plugin: inst.plugin, listo: isPluginAudioReady(pista.id, inst.plugin.id) }
}
