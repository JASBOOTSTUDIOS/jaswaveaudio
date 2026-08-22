/**
 * Convierte descriptores del host a PluginInfo de dominio (pista).
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { PluginDescriptor } from './types'

const INSTRUMENT_RE =
  /sampler|synth|piano|keys|organ|drum|bass|guitar|violin|pad|lead|kontakt|sforzando|decent|instrument|vsti/i

export function guessIsInstrument(name: string, path?: string): boolean {
  return INSTRUMENT_RE.test(name) || (!!path && INSTRUMENT_RE.test(path))
}

export function descriptorToPluginInfo(d: PluginDescriptor): PluginInfo {
  const isInst =
    d.isInstrument || d.format === 'builtin'
      ? d.isInstrument || d.pluginId.includes('softpad')
      : guessIsInstrument(d.name, d.path)

  const ready = d.hostReady && d.scanStatus === 'ok'
  return {
    id: `plugin-inst-${d.pluginId}-${Date.now().toString(36)}`,
    nombre: d.name,
    fabricante: d.vendor || '—',
    tipo: isInst ? 'instrumento' : 'efecto',
    bypass: false,
    parametros: [],
    estado: ready ? 'cargado' : 'pendiente',
    version: d.version || '—',
    wet: 1,
    latencia: 0,
    categoria: d.category || (isInst ? 'instrumento' : 'efecto'),
    autor: d.vendor || '—',
    licencia: d.format === 'builtin' ? 'JasWave' : d.format.toUpperCase(),
    // Ruta .vst3 limpia (la UI nativa la usa en openEditor).
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
