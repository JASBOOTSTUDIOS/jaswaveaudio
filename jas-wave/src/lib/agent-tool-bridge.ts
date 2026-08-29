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
import { mergeActionCatalog } from './agent-action-catalog'

let txManager: ReturnType<typeof crearTransactionManager> | null = null

export function ensureToolRegistryContext(tienda: TiendaDAW): void {
  toolRegistry.setContext(tienda.executor, tienda.permisos)
  if (!txManager) txManager = crearTransactionManager(tienda.executor)
}

export function getToolRegistryPromptFragment(tienda: TiendaDAW): string {
  ensureToolRegistryContext(tienda)
  const registryTypes = tienda.registroComandos.list().map((c) => ({
    type: c.type,
    description: c.description,
    risk: c.risk,
  }))
  const catalog = mergeActionCatalog(registryTypes)
  const lines = catalog.slice(0, 60).map((a) => `- ${a.type}: ${a.description}`)
  const fragment = toolRegistry.generatePromptFragment()
  return ['## Catálogo Tool Registry', fragment, '', '## Acciones agente', lines.join('\n')].join('\n')
}

export function planDawActions(actions: DawAction[], previewDiff?: SemanticStateDiff): ExecutionPlan {
  return planFromActions(
    actions.map((a) => ({ type: a.type, payload: (a.payload ?? {}) as Record<string, unknown> })),
    { previewDiff },
  )
}

export async function dryRunDawActions(
  tienda: TiendaDAW,
  actions: DawAction[],
): Promise<{ ok: boolean; summary: string; diff?: SemanticStateDiff }> {
  ensureToolRegistryContext(tienda)
  if (!txManager) return { ok: true, summary: 'Sin transaction manager' }
  const tx = txManager.begin('preview coproducer')
  for (const a of actions) {
    txManager.addCommand(tx, { type: a.type, payload: a.payload ?? {} })
  }
  const result = await txManager.commit(tx, { dryRun: true, source: 'ai' })
  return {
    ok: result.success,
    summary: result.stateDiff ? formatSemanticDiffSummary(result.stateDiff) : '',
    diff: result.stateDiff,
  }
}

export { extractToolSteps, type ExecutionPlan }
