/**
 * Convierte descriptores del host a PluginInfo de dominio (pista).
 * ADR-0011 no-engaño: no marcar VST como «cargado» solo porque el catálogo existe.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { PluginDescriptor } from './types'

const INSTRUMENT_RE =
  /sampler|synth|piano|keys|organ|drum|bass|guitar|violin|pad|lead|kontakt|sforzando|decent|instrument|vsti/i

export function guessIsInstrument(name: string, path?: string): boolean {
  return INSTRUMENT_RE.test(name) || (!!path && INSTRUMENT_RE.test(path))
}

export function extractVst3Path(descripcion: string): string {
  const raw = (descripcion || '').trim()
  if (!raw) return ''
  const cut = raw.split(' · ')[0]?.trim() ?? raw
  if (cut.toLowerCase().endsWith('.vst3')) return cut
  return raw.toLowerCase().includes('.vst3') ? cut : ''
}

export function isBuiltinPlugin(plugin: Pick<PluginInfo, 'licencia' | 'nombre'>): boolean {
  return (
    plugin.licencia === 'interno' ||
    plugin.licencia === 'JasWave' ||
    plugin.nombre.includes('Soft Pad')
  )
}

/** Caption de runtime para UI — no afirma audio si el host no confirmó el load. */
export function pluginRuntimeCaption(
  plugin: PluginInfo,
  opts?: { audioReady?: boolean },
): string {
  if (plugin.bypass) return 'bypass (dominio; sin DSP de cadena)'
  if (isBuiltinPlugin(plugin)) return 'in-process · audible (Soft Pad / builtin)'
  if (plugin.estado === 'error') return 'error · host no confirmó esta instancia'
  if (!extractVst3Path(plugin.descripcion ?? '')) return 'MISSING · sin ruta .vst3'
  if (opts?.audioReady) return 'host listo · UI+audio misma instancia'
  return 'en proyecto · host no confirmado (sin Soft Pad automático)'
}

export function descriptorToPluginInfo(d: PluginDescriptor): PluginInfo {
  const isInst =
    d.isInstrument || d.format === 'builtin'
      ? d.isInstrument || d.pluginId.includes('softpad')
      : guessIsInstrument(d.name, d.path)

  const builtin = d.format === 'builtin' && d.hostReady && d.scanStatus === 'ok'
  return {
    id: `plugin-inst-${d.pluginId}-${Date.now().toString(36)}`,
    nombre: d.name,
    fabricante: d.vendor || '—',
    tipo: isInst ? 'instrumento' : 'efecto',
    bypass: false,
    parametros: [],
    estado: builtin ? 'cargado' : 'pendiente',
    version: d.version || '—',
    wet: 1,
    latencia: 0,
    categoria: d.category || (isInst ? 'instrumento' : 'efecto'),
    autor: d.vendor || '—',
    licencia: d.format === 'builtin' ? 'JasWave' : d.format.toUpperCase(),
    descripcion: d.path || d.scanError || '',
    ui: { ancho: 400, alto: 300, personalizable: false },
  }
}

export function softPadPluginInfo(): PluginInfo {
  return {
    id: `plugin-softpad-${Date.now().toString(36)}`,
    nombre: 'JasWave Soft Pad',
    fabricante: 'JasWave',
    tipo: 'instrumento',
    bypass: false,
    parametros: [],
    estado: 'cargado',
    version: '1.0.0',
    wet: 1,
    latencia: 0,
    categoria: 'synth',
    autor: 'JasWave',
    licencia: 'interno',
    descripcion: 'Sintetizador suave de prueba para previsualizar MIDI (triangle + lowpass).',
    ui: { ancho: 320, alto: 180, personalizable: false },
  }
}
