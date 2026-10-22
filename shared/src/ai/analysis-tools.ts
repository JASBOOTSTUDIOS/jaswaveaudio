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
    {
      type: 'analysis.track',
      name: 'analysis.track',
      version: '1.0.0',
      description: 'Mide una pista: loudness, espectro, dinámica y estéreo',
      category: 'audio',
      risk: 'read',
      tags: ['analysis', 'track', 'loudness', 'spectrum'],
    },
    {
      type: 'analysis.mix',
      name: 'analysis.mix',
      version: '1.0.0',
      description: 'Mide la mezcla completa: cada pista, el master y la suma',
      category: 'audio',
      risk: 'read',
      tags: ['analysis', 'mix', 'master'],
    },
    {
      type: 'analysis.masking',
      name: 'analysis.masking',
      version: '1.0.0',
      description: 'Detecta qué pista tapa a cuál (kick/bajo, voz/guitarra…)',
      category: 'audio',
      risk: 'read',
      tags: ['analysis', 'masking', 'eq'],
    },
    {
      type: 'analysis.dynamics',
      name: 'analysis.dynamics',
      version: '1.0.0',
      description: 'Mide crest, PLR, LRA y transientes de la mezcla o de una pista',
      category: 'audio',
      risk: 'read',
      tags: ['analysis', 'dynamics', 'compression'],
    },
    {
      type: 'analysis.section',
      name: 'analysis.section',
      version: '1.0.0',
      description: 'Analiza una sección (marcador o rango) con su diagnóstico',
      category: 'audio',
      risk: 'read',
      tags: ['analysis', 'section', 'arrangement'],
    },
    {
      type: 'analysis.reference',
      name: 'analysis.reference',
      version: '1.0.0',
      description: 'Compara una pista de referencia con la mezcla actual',
      category: 'audio',
      risk: 'read',
      tags: ['analysis', 'reference', 'ab'],
    },
    {
      type: 'analysis.diagnose',
      name: 'analysis.diagnose',
      version: '1.0.0',
      description: 'Diagnóstico de mezcla con evidencia: barro, aspereza, sub, sibilancia, fase, compresión',
      category: 'audio',
      risk: 'read',
      tags: ['analysis', 'diagnose', 'mix'],
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
