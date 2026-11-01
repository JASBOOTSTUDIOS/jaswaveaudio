/**
 * Almacén de bitácora para AgentRun (A9).
 * Extiende la bitácora existente de EngineRun con utilidades para persistencia,
 * filtrado y generación de diffs semánticos.
 */

import type { EngineRun, EngineRunLogEntry, EngineRunLogKind } from './run-state'
import { ENGINE_RUN_LOG_MAX } from './run-state'

export type RunLogEntryInput = {
  kind: EngineRunLogKind
  role?: EngineRunLogEntry['role']
  tool?: EngineRunLogEntry['tool']
  callId?: EngineRunLogEntry['callId']
  args?: EngineRunLogEntry['args']
  status?: EngineRunLogEntry['status']
  message?: EngineRunLogEntry['message']
  durationMs?: number
  undoId?: EngineRunLogEntry['undoId']
  stepId?: EngineRunLogEntry['stepId']
}

export function appendRunLogEntry(run: EngineRun, at: number, input: RunLogEntryInput): EngineRunLogEntry {
  const entry: EngineRunLogEntry = {
    at,
    kind: input.kind,
    role: input.role,
    tool: input.tool,
    callId: input.callId,
    args: input.args,
    status: input.status,
    message: input.message,
    durationMs: input.durationMs,
    undoId: input.undoId,
    stepId: input.stepId,
  }
  run.log.push(entry)
  if (run.log.length > ENGINE_RUN_LOG_MAX) {
    run.log.splice(0, run.log.length - ENGINE_RUN_LOG_MAX)
  }
  run.updatedAt = at
  return entry
}

export function filterRunLog(run: EngineRun, filter?: {
  desde?: number
  hasta?: number
  agente?: string
  tool?: string
  kind?: EngineRunLogKind
}): EngineRunLogEntry[] {
  let entries = run.log.slice()
  if (filter?.desde !== undefined) {
    entries = entries.filter((e) => e.at >= filter.desde!)
  }
  if (filter?.hasta !== undefined) {
    entries = entries.filter((e) => e.at <= filter.hasta!)
  }
  if (filter?.agente) {
    entries = entries.filter((e) => e.role === filter.agente)
  }
  if (filter?.tool) {
    entries = entries.filter((e) => e.tool === filter.tool)
  }
  if (filter?.kind) {
    entries = entries.filter((e) => e.kind === filter.kind)
  }
  return entries
}

export function serializeRunLog(run: EngineRun): EngineRunLogEntry[] {
  return run.log.slice()
}
