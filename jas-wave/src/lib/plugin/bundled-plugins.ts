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
