/**
 * Control de acceso a disco desde el renderer.
 *
 * El renderer solo puede tocar rutas bajo raíces concedidas:
 * userData, carpetas elegidas por el usuario en diálogos (proyecto, export, plugins),
 * raíces VST estándar (solo lectura) y recursos de la app.
 * Excepción: lectura binaria de archivos de audio por extensión (librerías de samples
 * y media referenciada por proyectos), que no expone datos sensibles.
 */

import * as path from 'node:path'

export type GrantMode = 'read' | 'readwrite'
export type AccessKind = 'read' | 'write'

const AUDIO_EXTENSIONS = new Set([
  '.wav', '.wave', '.aif', '.aiff', '.flac', '.mp3', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.mid', '.midi',
])

export function isAudioFile(p: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(p).toLowerCase())
}

export class PathGrants {
  private readonly roots = new Map<string, GrantMode>()
  private readonly caseInsensitive: boolean
  private readonly pathImpl: typeof path.win32 | typeof path.posix

  constructor(opts: { platform?: NodeJS.Platform } = {}) {
    const platform = opts.platform ?? process.platform
    this.caseInsensitive = platform === 'win32' || platform === 'darwin'
    this.pathImpl = platform === 'win32' ? path.win32 : path.posix
  }

  /** Normaliza o devuelve null si la ruta no es aceptable (relativa, UNC, device, NUL). */
  normalize(p: unknown): string | null {
    if (typeof p !== 'string' || !p || p.includes('\0')) return null
    if (this.pathImpl === path.win32) {
      // UNC (\\server\share), device (\\?\ \\.\) y rutas con "//" inicial.
      if (/^[\\/]{2}/.test(p)) return null
      if (!/^[a-zA-Z]:[\\/]/.test(p)) return null
    } else if (!p.startsWith('/')) {
      return null
    }
    const resolved = this.pathImpl.resolve(p)
    return this.caseInsensitive ? resolved.toLowerCase() : resolved
  }

  grant(dir: unknown, mode: GrantMode): boolean {
    const n = this.normalize(dir)
    if (!n) return false
    const prev = this.roots.get(n)
    if (prev === 'readwrite') return true
    this.roots.set(n, mode)
    return true
  }

  isAllowed(p: unknown, kind: AccessKind): boolean {
    const n = this.normalize(p)
    if (!n) return false
    const sep = this.pathImpl.sep
    for (const [root, mode] of this.roots) {
      if (kind === 'write' && mode !== 'readwrite') continue
      if (n === root) return true
      const prefix = root.endsWith(sep) ? root : root + sep
      if (n.startsWith(prefix)) return true
    }
    return false
  }

  /** Lectura binaria: raíces concedidas o cualquier archivo de audio absoluto. */
  isBinaryReadAllowed(p: unknown): boolean {
    if (this.isAllowed(p, 'read')) return true
    const n = this.normalize(p)
    return n !== null && isAudioFile(n)
  }

  list(): Array<{ root: string; mode: GrantMode }> {
    return [...this.roots].map(([root, mode]) => ({ root, mode }))
  }
}

export class PathAccessError extends Error {
  constructor(p: unknown, kind: AccessKind) {
    super(
      `Acceso denegado (${kind}) a "${String(p)}". Elige la carpeta o el archivo desde un diálogo de JasWave para concederlo.`,
    )
    this.name = 'PathAccessError'
  }
}

/** Raíces VST estándar de Windows (lectura: escaneo y carga de plugins). */
export function defaultVstRoots(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  const add = (base: string | undefined, ...rest: string[]) => {
    if (base) out.push(path.win32.join(base, ...rest))
  }
  add(env.CommonProgramFiles, 'VST3')
  add(env['CommonProgramFiles(x86)'], 'VST3')
  add(env.ProgramFiles, 'VST3')
  add(env.ProgramFiles, 'VSTPlugins')
  add(env.ProgramFiles, 'Steinberg', 'VSTPlugins')
  add(env.ProgramFiles, 'Common Files', 'VST2')
  add(env['ProgramFiles(x86)'], 'VSTPlugins')
  add(env['ProgramFiles(x86)'], 'Steinberg', 'VSTPlugins')
  add(env.LOCALAPPDATA, 'Programs', 'Common', 'VST3')
  add(env.LOCALAPPDATA, 'Programs', 'Common', 'VST2')
  return out
}
