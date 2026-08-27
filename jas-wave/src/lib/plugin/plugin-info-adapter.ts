/**
 * Convierte descriptores del host a PluginInfo de dominio (pista).
 * ADR-0011 no-engaño: no marcar VST como «cargado» solo porque el catálogo existe.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { PluginDescriptor } from './types'
import { pluginRegistry } from './registry'

const INSTRUMENT_RE =
  /sampler|synth|piano|keys|organ|drum|drums|kit\b|bfd|bfdplayer|player|bass|guitar|violin|pad|lead|kontakt|sforzando|decent|instrument|vsti|analog|arturia|lab\s*v|omnisphere|serum|vital|keyscape|play\b|workstation|engine|addictive|ezdrummer|superior\s*drum|battery|groove\s*agent|studi\s*drummer|4front|jaswave/i

const FX_RE =
  /reverb|delay|compress|eq\b|pro-?q|equaliz|limiter|saturat|gate\b|chorus|flanger|phaser|utility|maximizer|imager|exciter|de-?ess|transient|clipper|valhalla|room\b|plate\b|verb\b/i

/** Mensaje cuando un VST2 no es hosteable (p. ej. DLL 32-bit). */
export const VST2_NOT_HOSTED_MSG =
  'VST2 no hosteable (requiere DLL x64). Usa la edición .vst3 si existe.'

export function isLikelyAudioFx(name: string, path?: string): boolean {
  return FX_RE.test(name) || (!!path && FX_RE.test(path))
}

/**
 * Heurística de instrumento. Si el nombre sugiere FX claro, no es instrumento.
 * Nombres ambiguos (BFDPlayer, kits, etc.) cuentan como instrumento.
 */
export function guessIsInstrument(name: string, path?: string): boolean {
  const hay = `${name} ${path ?? ''}`
  if (isLikelyAudioFx(name, path) && !INSTRUMENT_RE.test(hay)) return false
  return INSTRUMENT_RE.test(hay)
}

/** Ruta de plugin hosteable (.vst3 o .dll VST2) desde `plugin.descripcion` (o id `path:…`). */
export function extractHostPluginPath(descripcion: string, pluginId?: string): string {
  const raw = (descripcion || '').trim()
  if (raw) {
    const cut = raw.split(' · ')[0]?.trim() ?? raw
    const lower = cut.toLowerCase()
    if (lower.endsWith('.vst3') || lower.endsWith('.dll')) return cut
    if (raw.toLowerCase().includes('.vst3') || raw.toLowerCase().includes('.dll')) return cut
  }
  const id = (pluginId || '').trim()
  if (!id) return ''
  // plugin-inst-path:C:\...\x.dll-<suffix>  |  path:C:\...\x.dll
  const fromPathPrefix = id.match(/path:(.+?\.(?:vst3|dll))(?:-|_|$)/i)
  if (fromPathPrefix?.[1]) return fromPathPrefix[1]
  const fromWinPath = id.match(/([A-Za-z]:\\[^:"*?<>|]+\.(?:vst3|dll))/i)
  if (fromWinPath?.[1]) return fromWinPath[1]
  return ''
}

/**
 * Ruta hosteable desde PluginInfo. Si descripcion/id no traen path,
 * busca en el catálogo por pluginId o nombre (inserts viejos sin ruta).
 */
export function resolveHostPluginPath(
  plugin: Pick<PluginInfo, 'descripcion' | 'id' | 'nombre'>,
  catalog?: Array<{ pluginId: string; name: string; path?: string }>,
): string {
  const direct = extractHostPluginPath(plugin.descripcion ?? '', plugin.id)
  if (direct) return direct
  const list = catalog ?? pluginRegistry.list()
  const name = (plugin.nombre || '').trim().toLowerCase()
  const hit = list.find(
    (d) =>
      !!d.path &&
      (d.pluginId === plugin.id ||
        (!!name && d.name.trim().toLowerCase() === name) ||
        (!!name && name.length > 3 && d.name.toLowerCase().includes(name))),
  )
  if (hit?.path) return hit.path
  // Fallback nativo (lazy import evita ciclo con jaswave-piano/roles).
  if (/jaswave\s*piano|jaswavepiano/i.test(name)) {
    try {
      return (
        (
          globalThis as unknown as { __jaswavePianoPath?: () => string }
        ).__jaswavePianoPath?.() || ''
      )
    } catch {
      return ''
    }
  }
  if (/jaswave\s*roles|jaswaveroles/i.test(name)) {
    try {
      return (
        (
          globalThis as unknown as { __jaswaveRolesPath?: () => string }
        ).__jaswaveRolesPath?.() || ''
      )
    } catch {
      return ''
    }
  }
  return ''
}

/** @deprecated Prefer extractHostPluginPath (también acepta .dll). */
export function extractVst3Path(descripcion: string): string {
  return extractHostPluginPath(descripcion)
}

export function isBuiltinPlugin(
  plugin: Pick<PluginInfo, 'licencia' | 'nombre' | 'descripcion' | 'id'>,
): boolean {
  // Solo in-process: JasWave Piano/Roles VST3 también usan fabricante/licencia «JasWave»
  // pero tienen ruta .vst3 — no deben excluirse del track graph (silencio con MIDI+slot).
  if (plugin.licencia !== 'interno' && plugin.licencia !== 'JasWave') return false
  const path = extractHostPluginPath(plugin.descripcion ?? '', plugin.id)
  if (path) return false
  return true
}

/** Caption de runtime para UI — no afirma audio si el host no confirmó el load. */
export function pluginRuntimeCaption(
  plugin: PluginInfo,
  opts?: { audioReady?: boolean },
): string {
  if (plugin.bypass) return 'bypass (dominio; sin DSP de cadena)'
  if (isBuiltinPlugin(plugin) && !extractHostPluginPath(plugin.descripcion ?? '', plugin.id)) {
    return 'in-process · builtin'
  }
  if (plugin.estado === 'error') return 'error · host no confirmó esta instancia'
  if (!resolveHostPluginPath(plugin)) return 'MISSING · sin ruta de plugin (.vst3/.dll)'
  if (opts?.audioReady) return 'host listo · UI+audio misma instancia'
  return 'en proyecto · host no confirmado'
}

export function descriptorToPluginInfo(d: PluginDescriptor): PluginInfo {
  const isInst =
    d.isInstrument || d.format === 'builtin'
      ? d.isInstrument
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
