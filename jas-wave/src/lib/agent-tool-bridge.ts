/**
 * Puente Tool Registry + Planner ↔ coproducer (convive con <<<ACTIONS>>>).
 */

import {
  planFromActions,
  extractToolSteps,
  type ExecutionPlan,
  toolRegistry,
  crearTransactionManager,
} from '../../../shared/src'
import { formatSemanticDiffSummary, type SemanticStateDiff } from '../../../shared/src/state/diff-estado'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DawAction } from './ai-daw-agent'
import { registerAgentCatalogOnRegistry } from './agent-action-catalog'

let txManager: ReturnType<typeof crearTransactionManager> | null = null

export function ensureToolRegistryContext(tienda: TiendaDAW): void {
  toolRegistry.setContext(tienda.executor, tienda.permisos)
  if (!txManager) txManager = crearTransactionManager(tienda.executor)
}

export function getToolRegistryPromptFragment(tienda: TiendaDAW): string {
  ensureToolRegistryContext(tienda)
  registerAgentCatalogOnRegistry(toolRegistry)
  return ['## Catálogo Tool Registry', toolRegistry.generatePromptFragment()].join('\n')
}

export function planDawActions(actions: DawAction[], previewDiff?: SemanticStateDiff): ExecutionPlan {
  return planFromActions(
    actions.map((a) => ({ type: a.type, payload: (a.payload ?? {}) as Record<string, unknown> })),
    { previewDiff },
  )
}

const ORCHESTRATOR_TYPES = new Set([
  'daw.musicBuild',
  'daw.composeProject',
  'daw.generateMidiSong',
  'daw.masterPass',
  'daw.wipeProject',
])

export async function dryRunDawActions(
  tienda: TiendaDAW,
  actions: DawAction[],
): Promise<{ ok: boolean; summary: string; diff?: SemanticStateDiff }> {
  ensureToolRegistryContext(tienda)
  if (!actions.length) return { ok: true, summary: 'Sin acciones' }

  const orchestrators = actions.filter((a) => ORCHESTRATOR_TYPES.has(a.type))
  const commands = actions.filter((a) => !ORCHESTRATOR_TYPES.has(a.type))

  const orchSummary = orchestrators
    .map((a) => {
      const p = a.payload ?? {}
      if (a.type === 'daw.musicBuild') {
        const bpm = p.bpm != null ? ` · ${p.bpm} BPM` : ''
        const mins = p.minutos != null || p.minutes != null ? ` · ${p.minutos ?? p.minutes} min` : ''
        return `Music Build (se aplicará al confirmar)${bpm}${mins}`
      }
      if (a.type === 'daw.wipeProject') {
        return 'Wipe proyecto (borra todas las pistas al confirmar)'
      }
      return `${a.type} (orquestador — se aplicará al confirmar)`
    })
    .join('; ')

  if (!commands.length) {
    return { ok: true, summary: orchSummary || 'Orquestador listo' }
  }

  if (!txManager) return { ok: true, summary: orchSummary || 'Sin transaction manager' }
  const tx = txManager.begin('preview coproducer')
  for (const a of commands) {
    txManager.addCommand(tx, { type: a.type, payload: a.payload ?? {} })
  }
  const result = await txManager.commit(tx, { dryRun: true, source: 'ai' })
  const cmdSummary = result.stateDiff ? formatSemanticDiffSummary(result.stateDiff) : ''
  const summary = [orchSummary, cmdSummary].filter(Boolean).join(' · ') || 'Sin cambios de dominio en preview'
  return {
    ok: result.success || orchestrators.length > 0,
    summary,
    diff: result.stateDiff,
  }
}

export { extractToolSteps, type ExecutionPlan }
