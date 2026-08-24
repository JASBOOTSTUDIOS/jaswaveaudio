/**
 * Tools analysis.* para el Tool Registry.
 */

import type { ToolDefinitionExtended, ToolHandler, ToolRegistry } from './tool-registry'

export function registrarAnalysisTools(registry: ToolRegistry): void {
  const defs: ToolDefinitionExtended[] = [
    {
      type: 'analysis.loudness',
      name: 'analysis.loudness',
      version: '1.0.0',
      description: 'Loudness BS.1770 del último bounce o análisis de master',
      category: 'audio',
      risk: 'read',
      tags: ['loudness', 'lufs', 'master'],
    },
    {
      type: 'analysis.compareTarget',
      name: 'analysis.compareTarget',
      version: '1.0.0',
      description: 'Compara LUFS integrado vs target streaming/club/cd',
      category: 'audio',
      risk: 'read',
      tags: ['loudness', 'target', 'master'],
    },
    {
      type: 'analysis.spectrum',
      name: 'analysis.spectrum',
      version: '1.0.0',
      description: 'Energía por bandas del último bounce',
      category: 'audio',
      risk: 'read',
      tags: ['spectrum', 'eq'],
    },
    {
      type: 'analysis.stereo',
      name: 'analysis.stereo',
      version: '1.0.0',
      description: 'Correlación estéreo y clipping',
      category: 'audio',
      risk: 'read',
      tags: ['stereo', 'correlation'],
    },
    {
      type: 'analysis.fullReport',
      name: 'analysis.fullReport',
      version: '1.0.0',
      description: 'AudioListenReport completo post-bounce',
      category: 'audio',
      risk: 'read',
      tags: ['listen', 'master', 'report'],
    },
  ]

  const viaCommand =
    (type: string): ToolHandler =>
    async (params, ctx) => {
      try {
        const r = await ctx.commandExecutor.execute(type, params as Record<string, unknown>)
        return {
          success: r.success,
          data: r.result,
          error: r.success
            ? undefined
            : { code: 'CMD', message: String((r as { error?: { message?: string } }).error?.message ?? 'falló') },
          events: [] as never[],
        }
      } catch (e) {
        return {
          success: false,
          error: { code: 'CMD', message: e instanceof Error ? e.message : String(e) },
          events: [] as never[],
        }
      }
    }

  for (const d of defs) {
    registry.register(d, viaCommand(d.type))
  }
}
