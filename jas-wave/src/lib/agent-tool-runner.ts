/**
 * Tool Runner único: Registry → permisos → handler/Command → ToolResult.
 * Congela el crecimiento del switch executeDawActions para el Agent Loop.
 */

import { getStateRevision, toolRegistry } from '@jaswave/shared'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import {
  isSyntheticReadTool,
  syntheticReadResult,
} from '@jaswave/ai-harness'
import type { AgentLoopToolCall, AgentLoopToolResult } from '@jaswave/ai-harness'
import { executeDawActions, type DawAction, type ExecuteDawOptions } from './ai-daw-agent'

export type RunRegisteredToolOpts = ExecuteDawOptions & {
  /** Si la revisión no coincide, no mutar. */
  expectedRevision?: string
  /** callIds ya ejecutados en este run (idempotencia). */
  executedCallIds?: ReadonlySet<string>
}

function stripInternalArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args }
  delete out.__expectedRevision
  return out
}

export async function runRegisteredTool(
  tienda: TiendaDAW,
  call: AgentLoopToolCall,
  opts: RunRegisteredToolOpts = {},
): Promise<AgentLoopToolResult> {
  const st0 = tienda.obtenerEstado()
  const fp0 = getStateRevision(st0)
  const expected =
    opts.expectedRevision ??
    (typeof call.arguments.__expectedRevision === 'string' ? call.arguments.__expectedRevision : undefined)

  if (opts.executedCallIds?.has(call.id)) {
    return {
      callId: call.id,
      tool: call.tool,
      status: 'success',
      data: { skipped: true, reason: 'idempotent' },
      stateRevision: fp0,
    }
  }

  if (expected && expected !== fp0 && !isSyntheticReadTool(call.tool)) {
    return {
      callId: call.id,
      tool: call.tool,
      status: 'error',
      error: {
        code: 'STATE_CONFLICT',
        message: `Revision esperada ${expected}, actual ${fp0}`,
      },
      stateRevision: fp0,
    }
  }

  const args = stripInternalArgs(call.arguments)

  if (isSyntheticReadTool(call.tool)) {
    const syn = syntheticReadResult(call.tool, args, st0)
    if ('data' in syn) {
      return { callId: call.id, tool: call.tool, status: 'success', data: syn.data, stateRevision: fp0 }
    }
    return { callId: call.id, tool: call.tool, status: 'error', error: syn.error, stateRevision: fp0 }
  }

  toolRegistry.setContext(tienda.executor, tienda.permisos)
  const def = toolRegistry.get(call.tool)
  const health = toolRegistry.getHealth()
  const isBroken = health.brokenHandlers.includes(call.tool)

  // Handler real (no deferred): preferir registry.execute
  if (def && !isBroken) {
    try {
      const tr = await toolRegistry.execute(call.tool, args, 'ai')
      if (tr.error?.code === 'DEFERRED') {
        // caer al switch legacy
      } else if (tr.confirmationRequired && !opts.forceApply) {
        return {
          callId: call.id,
          tool: call.tool,
          status: 'rejected',
          error: { code: 'CONFIRMATION_REQUIRED', message: tr.error?.message ?? 'Requiere confirmación' },
          stateRevision: getStateRevision(tienda.obtenerEstado()),
        }
      } else if (tr.confirmationRequired && opts.forceApply) {
        // Usuario ya confirmó (Aplicar) — ejecutar Command directo
        const cmd = await tienda.executor.execute(call.tool, args, 'ai')
        return {
          callId: call.id,
          tool: call.tool,
          status: cmd.success ? 'success' : 'error',
          data: cmd.result,
          error: cmd.success
            ? undefined
            : { code: 'CMD', message: String((cmd as { error?: { message?: string } }).error?.message ?? 'Error') },
          stateRevision: getStateRevision(tienda.obtenerEstado()),
        }
      } else if (!tr.success) {
        if (tr.error?.code !== 'DEFERRED') {
          return {
            callId: call.id,
            tool: call.tool,
            status: 'error',
            error: { code: tr.error?.code ?? 'TOOL_ERROR', message: tr.error?.message ?? 'Error' },
            stateRevision: getStateRevision(tienda.obtenerEstado()),
          }
        }
      } else {
        return {
          callId: call.id,
          tool: call.tool,
          status: 'success',
          data: tr.data,
          stateRevision: getStateRevision(tienda.obtenerEstado()),
        }
      }
    } catch (e) {
      return {
        callId: call.id,
        tool: call.tool,
        status: 'error',
        error: { code: 'TOOL_THROW', message: e instanceof Error ? e.message : String(e) },
        stateRevision: getStateRevision(tienda.obtenerEstado()),
      }
    }
  }

  // Legacy: switch executeDawActions (congelado — no añadir cases nuevos para el loop)
  let payload = args
  if (
    opts.forceApply &&
    (call.tool === 'daw.musicBuild' ||
      call.tool === 'daw.composeProject' ||
      call.tool === 'daw.generateMidiSong' ||
      call.tool === 'daw.wipeProject')
  ) {
    payload = { ...args, aplicar: true, apply: true }
  }
  const actions: DawAction[] = [{ type: call.tool, payload }]
  const results = await executeDawActions(tienda, actions, {
    agentMode: opts.agentMode,
    forceApply: opts.forceApply ?? true,
    source: opts.source ?? 'model_actions',
    conversationId: opts.conversationId,
    messageId: opts.messageId,
    skipWorkPlan: true,
    respectModeGate: false,
  })
  const r = results[0]
  return {
    callId: call.id,
    tool: call.tool,
    status: r?.success ? 'success' : 'error',
    data: r?.data,
    error: r?.success ? undefined : { code: 'EXECUTE', message: r?.message ?? 'Error' },
    stateRevision: getStateRevision(tienda.obtenerEstado()),
  }
}

export async function runRegisteredTools(
  tienda: TiendaDAW,
  calls: AgentLoopToolCall[],
  opts: RunRegisteredToolOpts = {},
): Promise<AgentLoopToolResult[]> {
  const out: AgentLoopToolResult[] = []
  const done = new Set(opts.executedCallIds ?? [])
  for (const c of calls) {
    const r = await runRegisteredTool(tienda, c, { ...opts, executedCallIds: done })
    out.push(r)
    if (r.status === 'success') done.add(c.id)
  }
  return out
}
