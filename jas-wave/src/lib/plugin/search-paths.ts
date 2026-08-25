/**
 * Rutas de búsqueda de plugins (ADR-0011 §2) — sin hardcodear una sola ruta.
 */

export type PluginSearchPath = {
  id: string
  path: string
  format: 'vst3' | 'vst2' | 'au' | 'lv2' | 'clap' | 'any'
  enabled: boolean
  kind: 'standard' | 'custom'
}

export function defaultVst3SearchPaths(platform: NodeJS.Platform | string = 'win32'): PluginSearchPath[] {
  if (platform === 'darwin') {
    return [
      {
        id: 'mac-system-vst3',
        path: '/Library/Audio/Plug-Ins/VST3',
        format: 'vst3',
        enabled: true,
        kind: 'standard',
      },
      {
        id: 'mac-user-vst3',
        path: '~/Library/Audio/Plug-Ins/VST3',
        format: 'vst3',
        enabled: true,
        kind: 'standard',
      },
    ]
  }
  if (platform === 'linux') {
    return [
      {
        id: 'linux-user-vst3',
        path: '~/.vst3',
        format: 'vst3',
        enabled: true,
        kind: 'standard',
      },
      {
        id: 'linux-usr-vst3',
        path: '/usr/lib/vst3',
        format: 'vst3',
        enabled: true,
        kind: 'standard',
      },
    ]
  }
  return [
    {
      id: 'win-common-vst3',
      path: '%CommonProgramFiles%/VST3',
      format: 'vst3',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-local-vst3',
      path: '%LOCALAPPDATA%/Programs/Common/VST3',
      format: 'vst3',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-program',
      path: '%ProgramFiles%/VSTPlugins',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-program-x86',
      path: '%ProgramFiles(x86)%/VSTPlugins',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-steinberg',
      path: '%ProgramFiles%/Steinberg/VstPlugins',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-common',
      path: '%CommonProgramFiles%/VST2',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-common-vst',
      path: '%CommonProgramFiles%/VST',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-program-vst',
      path: '%ProgramFiles%/VST',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-user',
      path: '%USERPROFILE%/Documents/VST',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-fl-2025',
      path: '%ProgramFiles%/Image-Line/FL Studio 2025/Plugins/VST',
      format: 'vst2',
      enabled: true,
      kind: 'standard',
    },
    {
      id: 'win-vst2-fl-shared',
      path: '%ProgramFiles%/Image-Line/FL Studio 2025/Plugins/Fruity/Generators',
      format: 'vst2',
      enabled: false,
      kind: 'standard',
    },
  ]
}

export function expandPluginSearchPath(raw: string): string {
  let p = raw
  if (typeof process !== 'undefined' && process.platform === 'win32') {
    p = p.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] || `%${name}%`)
  } else {
    p = p.replace(/^~(?=$|\/|\\)/, () => {
      if (typeof process === 'undefined') return '~'
      return process.env.HOME || process.env.USERPROFILE || '~'
    })
  }
  return p
}

export class PluginSearchPathConfig {
  private paths: PluginSearchPath[]

  constructor(initial?: PluginSearchPath[]) {
    this.paths = initial ? [...initial] : defaultVst3SearchPaths()
  }

  list(): PluginSearchPath[] {
    return [...this.paths]
  }

  enabledPaths(): PluginSearchPath[] {
    return this.paths.filter((p) => p.enabled)
  }

  /** Rutas habilitadas con variables de entorno expandidas. */
  enabledExpandedPaths(): string[] {
    return this.enabledPaths().map((p) => expandPluginSearchPath(p.path))
  }

  addCustom(path: string, format: PluginSearchPath['format'] = 'vst3'): PluginSearchPath | null {
    const normalized = path.trim().replace(/[/\\]+$/, '')
    if (!normalized) return null
    const key = normalized.toLowerCase()
    if (this.paths.some((p) => p.path.trim().replace(/[/\\]+$/, '').toLowerCase() === key)) {
      return null
    }
    const entry: PluginSearchPath = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: normalized,
      format,
      enabled: true,
      kind: 'custom',
    }
    this.paths.push(entry)
    return entry
  }

  setEnabled(id: string, enabled: boolean): void {
    const p = this.paths.find((x) => x.id === id)
    if (p) p.enabled = enabled
  }

  remove(id: string): void {
    this.paths = this.paths.filter((p) => !(p.id === id && p.kind === 'custom'))
  }

  replaceAll(paths: PluginSearchPath[]): void {
    this.paths = paths.map((p) => ({ ...p }))
  }
}

export const pluginSearchPaths = new PluginSearchPathConfig()
