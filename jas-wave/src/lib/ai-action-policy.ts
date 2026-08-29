/**
 * Política de ejecución de ACTIONS del agente DAW (modos + destructivas + permisos).
 * Lógica pura en @jaswave/ai-harness; permisos UI aquí.
 */

import {
  actionRiskLevel as coreActionRiskLevel,
  batchNeedsDestructiveConfirm,
  ensureMusicBuildForFullProject,
  forcePreviewAplicar,
  isDestructiveAction,
  isDocsWriteAction,
  isMutatingAction,
  isPreviewOnlyAction,
  isReadOnlyAction,
  modeBlocksMutation,
  partitionActions as corePartitionActions,
  payloadOfAction,
  wantsFullProject,
  withAplicarTrue,
  type AgentAction,
  type AgentMode,
} from '@jaswave/ai-harness'
import type { DawAction } from './ai-daw-agent'
import { permissionManager, type AutonomyLevel } from '../../../shared/src/state/permissions'

export {
  batchNeedsDestructiveConfirm,
  ensureMusicBuildForFullProject,
  forcePreviewAplicar,
  isDestructiveAction,
  isDocsWriteAction,
  isMutatingAction,
  isPreviewOnlyAction,
  isReadOnlyAction,
  modeBlocksMutation,
  payloadOfAction,
  wantsFullProject,
  withAplicarTrue,
}

export type { AgentMode } from '@jaswave/ai-harness'

export function autonomyBlocksMutation(level?: AutonomyLevel): boolean {
  const l = level ?? permissionManager.getUserConfig().level
  return l === 'READ_ONLY' || l === 'SUGGEST'
}

export function actionRiskLevel(action: DawAction): 'read' | 'write' | 'dangerous' {
  return coreActionRiskLevel(action as AgentAction)
}

export function needsPermissionConfirm(action: DawAction, level?: AutonomyLevel): boolean {
  const l = level ?? permissionManager.getUserConfig().level
  if (l === 'FULL_AUTONOMY') return false
  if (l === 'AUTO_EXECUTE_SAFE') return actionRiskLevel(action) === 'dangerous'
  if (l === 'CONFIRM') return actionRiskLevel(action) !== 'read'
  return true
}

export function logPermissionForAction(action: DawAction, source: 'ai' | 'user' = 'ai'): void {
  permissionManager.check(
    {
      type: action.type,
      category: 'ai',
      description: action.type,
      risk: actionRiskLevel(action),
      confirmationRequired: needsPermissionConfirm(action),
    },
    source,
  )
}

export type ActionPartition = {
  readonly: DawAction[]
  mutating: DawAction[]
  destructive: DawAction[]
}

export function partitionActions(actions: DawAction[], userText = ''): ActionPartition {
  return corePartitionActions(actions as AgentAction[], userText, (a) =>
    needsPermissionConfirm(a as DawAction),
  ) as ActionPartition
}
