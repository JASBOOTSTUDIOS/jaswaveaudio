/**
 * Plugins propios (JasWave Roles / Piano): se prefiere la instalación de usuario
 * (%LOCALAPPDATA%\Programs\Common\VST3\JasWave, la deja el POST_BUILD de CMake)
 * y, si no existe, los bundles incluidos en el instalador (resources/vst3/JasWave).
 *
 * El renderer no ve process.resourcesPath: las rutas llegan por IPC `known-paths`.
 */

export type KnownPaths = {
  resourcesPath: string
  localAppData: string
  /** Vacío en dev (sin app empaquetada). */
  bundledVst3Dir: string
}

import type { PluginDescriptor } from './types'
import { pluginRegistry } from './registry'
import { descriptorToPluginInfo } from './plugin-info-adapter'
import type { PluginInfo } from '../../../../shared/src/types/entidades'

export const JASWAVE_ROLES_BUNDLE = 'JasWaveRoles.vst3'
export const JASWAVE_PIANO_BUNDLE = 'JasWavePiano.vst3'
export const JASWAVE_FX_BUNDLE = 'JasWaveFx.vst3'

export const JASWAVE_FX_NAME = 'JasWave FX'
export const JASWAVE_FX_VENDOR = 'JasWave'

/** IDs de parámetro fijos de JasWave FX (coinciden con native/jaswave-fx/src/processor.h y processor-profiles.json). */
export const JASWAVE_FX_EQ = {
  bypass: 0,
  output: 41,
  bandBase: 1,
  bandStride: 5,
  numBands: 8,
  bandType: 0,
  bandFreq: 1,
  bandGain: 2,
  bandQ: 3,
  bandOn: 4,
} as const
export const JASWAVE_FX_COMP = {
  bypass: 0,
  threshold: 1,
  ratio: 2,
  attack: 3,
  release: 4,
  knee: 5,
  makeup: 6,
  mix: 7,
  sidechainHp: 8,
  grReadOnly: 40,
} as const
export const JASWAVE_FX_LIMITER = {
  bypass: 0,
  ceiling: 1,
  inputGain: 2,
  release: 3,
  lookahead: 4,
  grReadOnly: 40,
} as const
export const JASWAVE_FX_UTILITY = {
  bypass: 0,
  gain: 1,
  width: 2,
  monoBelow: 3,
  invertL: 4,
  invertR: 5,
  balance: 6,
} as const
export const JASWAVE_FX_DEESSER = {
  bypass: 0,
  freq: 1,
  threshold: 2,
  range: 3,
  mode: 4,
} as const

export function joinWinPath(dir: string, name: string): string {
  return `${dir.replace(/[/\\]+$/, '')}\\${name}`
}

/** True si la ruta apunta a un bundle incluido en resources/vst3/JasWave. */
export function isBundledJasWavePath(p: string | undefined | null): boolean {
  return /[/\\]resources[/\\]vst3[/\\]JasWave[/\\]/i.test(String(p ?? ''))
}

/**
 * Elige la ruta del bundle: la de usuario si existe; si no, la incluida si existe;
 * si ninguna existe, la de usuario (comportamiento previo).
 */
export async function pickJasWavePluginPath(
  bundleName: string,
  userPath: string,
  bundledDir: string | undefined | null,
  exists: (p: string) => Promise<boolean>,
): Promise<{ path: string; source: 'user' | 'bundled' | 'missing' }> {
  const safeExists = async (p: string) => {
    try {
      return Boolean(p) && (await exists(p))
    } catch {
      return false
    }
  }
  if (await safeExists(userPath)) return { path: userPath, source: 'user' }
  if (bundledDir) {
    const bundled = joinWinPath(bundledDir, bundleName)
    if (await safeExists(bundled)) return { path: bundled, source: 'bundled' }
  }
  return { path: userPath, source: 'missing' }
}

export async function fetchKnownPaths(): Promise<KnownPaths | null> {
  try {
    const kp = await window.electron?.knownPaths?.()
    return kp ?? null
  } catch {
    return null
  }
}

/** Ruta instalada por post-build de native/jaswave-fx. */
export function defaultJasWaveFxPath(): string {
  const local = typeof process !== 'undefined' && process.env?.LOCALAPPDATA?.trim()
    ? process.env.LOCALAPPDATA.replace(/[/\\]+$/, '')
    : ''
  if (local) return `${local}\\Programs\\Common\\VST3\\JasWave\\JasWaveFx.vst3`
  return 'C:\\Program Files\\Common Files\\VST3\\JasWave\\JasWaveFx.vst3'
}

export function isJasWaveFxDescriptor(d: { name?: string; vendor?: string; path?: string; pluginId?: string; category?: string }): boolean {
  const n = String(d.name ?? '').toLowerCase()
  const v = String(d.vendor ?? '').toLowerCase()
  const c = String(d.category ?? '').toLowerCase()
  const blob = `${n} ${v} ${d.path ?? ''} ${d.pluginId ?? ''}`
  return (
    /jaswave\s*(eq|compresor|limitador|utility|de-esser|deesser)/i.test(n) ||
    /jaswave\s*fx|jaswavefx/i.test(blob) ||
    (v === 'jaswave' && c === 'efecto')
  )
}

/** PluginInfo (shared) de cualquiera de los 5 FX JasWave (EQ, Compresor, Limitador, Utility, De-esser). */
export function isJasWaveFxPlugin(p: { nombre?: string; vendor?: string; category?: string }): boolean {
  const n = String(p.nombre ?? '').toLowerCase()
  const v = String(p.vendor ?? '').toLowerCase()
  const c = String(p.category ?? '').toLowerCase()
  return (
    /jaswave\s*(eq|compresor|limitador|utility|de-esser|deesser)/i.test(n) ||
    (v === 'jaswave' && c === 'efecto')
  )
}

export function ensureJasWaveFxRegistered(explicitPath?: string): { descriptor: PluginDescriptor; info: PluginInfo } | undefined {
  const path = (explicitPath || defaultJasWaveFxPath()).trim()
  const existing = findJasWaveFxDescriptor()
  if (existing?.path) {
    const replaceWithExplicit =
      !!explicitPath && (existing.path === defaultJasWaveFxPath() || isBundledJasWavePath(existing.path))
    if (path && existing.path !== path && (replaceWithExplicit || /AppData\\Local/i.test(path))) {
      existing.path = path
      pluginRegistry.register(existing)
    }
    return { descriptor: existing, info: descriptorToPluginInfo(existing) }
  }
  if (!path) return undefined
  let hash = 0
  for (let i = 0; i < path.length; i++) hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
  const d: PluginDescriptor = {
    pluginId: `vst3.fx-${(hash >>> 0).toString(16)}`,
    format: 'vst3',
    vendor: JASWAVE_FX_VENDOR,
    name: JASWAVE_FX_NAME,
    version: '1.0.0',
    path,
    category: 'efecto',
    isInstrument: false,
    isEffect: true,
    supportsMidiInput: false,
    supportsMidiOutput: false,
    supportsAudioInput: true,
    supportsAudioOutput: true,
    supportsSidechain: true,
    supportsEditor: true,
    parameterCount: 42,
    scanStatus: 'ok',
    hostReady: true,
    isolation: 'out-of-process',
  }
  pluginRegistry.register(d)
  return { descriptor: d, info: descriptorToPluginInfo(d) }
}

export function findJasWaveFxDescriptor(
  catalog: PluginDescriptor[] = pluginRegistry.list(),
): PluginDescriptor | undefined {
  return catalog.find((d) => isJasWaveFxDescriptor(d) && d.hostReady && !!d.path)
}

export function jasWaveFxPluginInfo(): PluginInfo | null {
  const registered = ensureJasWaveFxRegistered()
  if (registered) return descriptorToPluginInfo(registered.descriptor)
  const found = findJasWaveFxDescriptor()
  if (!found) return null
  return descriptorToPluginInfo(found)
}

try {
  ;(globalThis as unknown as { __jaswaveFxPath?: () => string }).__jaswaveFxPath =
    defaultJasWaveFxPath
} catch {
  /* ignore */
}
