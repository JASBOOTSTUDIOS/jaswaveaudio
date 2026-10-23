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


export const JASWAVE_ROLES_BUNDLE = 'JasWaveRoles.vst3'
export const JASWAVE_PIANO_BUNDLE = 'JasWavePiano.vst3'


/**
 * IDs de parámetro de los FX JasWave (EQ, compresor, limitador, utility, de-esser): ParamID VST3 de los
 * plugins independientes de plugins/ (estables; ver vstParamId en cada jaswave-plugin.json).
 */
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

/** Nombres de los FX JasWave (plugins independientes y nombres heredados de JasWaveFx). */
const FX_JASWAVE_POR_NOMBRE =
  /jaswave\s*(eq|compresor|limitador|utility|de-?esser|bus\s*compressor|true-?peak|smart\s*de-?esser)/i
/** Id de catálogo o de manifiesto de los FX (plugins/com.jaswave.plugin.*). */
const FX_JASWAVE_POR_ID = /com\.jaswave\.plugin\.(param-eq|bus-compressor|truepeak-limiter|utility-tool|smart-deesser)/i
const VENDORS_JASWAVE = new Set(['jaswave', 'jaswave audio'])

export function isJasWaveFxDescriptor(d: { name?: string; vendor?: string; path?: string; pluginId?: string; category?: string }): boolean {
  const n = String(d.name ?? '').toLowerCase()
  const v = String(d.vendor ?? '').toLowerCase()
  const c = String(d.category ?? '').toLowerCase()
  const blob = `${n} ${v} ${d.path ?? ''} ${d.pluginId ?? ''}`
  return FX_JASWAVE_POR_NOMBRE.test(n) || FX_JASWAVE_POR_ID.test(blob) || (VENDORS_JASWAVE.has(v) && c === 'efecto')
}

/** PluginInfo (shared) de cualquiera de los 5 FX JasWave (EQ, Compresor, Limitador, Utility, De-esser). */
export function isJasWaveFxPlugin(p: { nombre?: string; vendor?: string; category?: string }): boolean {
  const n = String(p.nombre ?? '').toLowerCase()
  const v = String(p.vendor ?? '').toLowerCase()
  const c = String(p.category ?? '').toLowerCase()
  return FX_JASWAVE_POR_NOMBRE.test(n) || (VENDORS_JASWAVE.has(v) && c === 'efecto')
}
