import type { DAWState } from '@jaswave/shared'
import {
  AGENT_READ_ONLY_ACTIONS,
  isDestructiveAction,
  isMutatingAction,
} from '../agent/action-policy'
import type { AgentLoopToolCall } from '../loop/agent-run-types'
import { trackIdExists } from '../context/agent-observer'

const SYNTHETIC_READ = new Set(['selection.get', 'project.getSummary', 'track.list'])

export type ToolCallValidation = {
  ok: boolean
  reason?: string
  needsConfirmation?: boolean
}

export type ValidateToolCallsOpts = {
  knownTools: ReadonlySet<string> | Iterable<string>
  state: DAWState
  maxPerIteration: number
  requireConfirmationForWrites?: boolean
  requireConfirmationForDangerous?: boolean
}

export function isSyntheticReadTool(tool: string): boolean {
  return SYNTHETIC_READ.has(tool)
}

export function isLoopReadTool(tool: string): boolean {
  return SYNTHETIC_READ.has(tool) || AGENT_READ_ONLY_ACTIONS.has(tool)
}

const TOOLS_REQUIRING_TRACK_ID =
  /^(track\.(update|delete|toggleMute|toggleSolo|toggleArm)|plugin\.(insert|update|remove|move|bypass|setParameter)|midi\.(clip\.create|notes\.set|notes\.patch|transpose|quantize|humanize))/i

function isBlankId(v: unknown): boolean {
  const s = String(v ?? '').trim()
  return !s || s === 'undefined' || s === 'null'
}

function findPistaIdForClip(state: DAWState, clipId: string): string | null {
  for (const t of state.project?.tracks ?? []) {
    if ((t.clips ?? []).some((c) => c.id === clipId)) return t.id
  }
  return null
}

export function validateAgentToolCalls(
  calls: AgentLoopToolCall[],
  opts: ValidateToolCallsOpts,
): {
  accepted: AgentLoopToolCall[]
  rejected: Array<AgentLoopToolCall & { reason: string }>
  needsConfirmation: boolean
} {
  const known = opts.knownTools instanceof Set ? opts.knownTools : new Set(opts.knownTools)
  for (const t of SYNTHETIC_READ) known.add(t)

  const accepted: AgentLoopToolCall[] = []
  const rejected: Array<AgentLoopToolCall & { reason: string }> = []
  if (calls.length > opts.maxPerIteration) {
    return {
      accepted: [],
      rejected: calls.map((c) => ({
        ...c,
        reason: `Máximo ${opts.maxPerIteration} tools por iteración (destructivos: 1)`,
      })),
      needsConfirmation: false,
    }
  }

  let needsConfirmation = false
  let acceptedWrites = 0

  for (const c of calls) {
    if (!c.tool || !/^[a-z0-9]+(\.[a-z0-9]+)+$/i.test(c.tool)) {
      rejected.push({ ...c, reason: 'Nombre de herramienta inválido' })
      continue
    }
    if (!known.has(c.tool) && !isSyntheticReadTool(c.tool)) {
      rejected.push({ ...c, reason: `Herramienta no registrada: ${c.tool}` })
      continue
    }

    const isRead = isLoopReadTool(c.tool)
    if (!isRead && acceptedWrites >= 1) {
      rejected.push({
        ...c,
        reason:
          'Solo 1 mutación por iteración. Valida éxito (observe) y continúa con la siguiente (setBpm → musicBuild → un midi.clip.create…).',
      })
      continue
    }

    const args = { ...(c.arguments ?? {}) }
    if (args.pistaId == null && args.trackId != null) args.pistaId = args.trackId
    if (args.trackId == null && args.pistaId != null) args.trackId = args.pistaId

    if (c.tool === 'project.setBpm') {
      const bpm = Number(args.bpm ?? args.valor ?? args.tempo)
      if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
        rejected.push({ ...c, reason: 'Falta bpm válido (20–300) en payload.bpm' })
        continue
      }
      args.bpm = bpm
    }

    if (c.tool === 'clip.delete') {
      if (isBlankId(args.clipId) && !isBlankId(args.id)) args.clipId = args.id
      if (isBlankId(args.pistaId) && !isBlankId(args.clipId)) {
        const resolved = findPistaIdForClip(opts.state, String(args.clipId))
        if (resolved) {
          args.pistaId = resolved
          args.trackId = resolved
        }
      }
      if (isBlankId(args.pistaId) || isBlankId(args.clipId)) {
        rejected.push({
          ...c,
          reason: 'clip.delete exige pistaId+clipId reales (track.list / selection.get)',
        })
        continue
      }
    }

    if (c.tool === 'midi.clip.create') {
      const notas = args.notas ?? args.notes
      if (!Array.isArray(notas) || notas.length === 0) {
        rejected.push({
          ...c,
          reason: 'midi.clip.create exige notas[] no vacío',
        })
        continue
      }
    }

    const trackId = String(args.trackId ?? args.pistaId ?? '').trim()
    if (TOOLS_REQUIRING_TRACK_ID.test(c.tool) && isBlankId(trackId)) {
      rejected.push({
        ...c,
        reason: 'Falta trackId/pistaId — primero selection.get o track.list',
      })
      continue
    }
    if (
      trackId &&
      !isBlankId(trackId) &&
      /^track\.|^plugin\.|^midi\./.test(c.tool) &&
      !trackIdExists(opts.state, trackId)
    ) {
      rejected.push({ ...c, reason: `trackId desconocido: ${trackId}` })
      continue
    }

    const normalized = { ...c, arguments: args }
    const fakeAction = { type: c.tool, payload: args }
    if (opts.requireConfirmationForDangerous && isDestructiveAction(fakeAction)) {
      needsConfirmation = true
    }
    if (opts.requireConfirmationForWrites && isMutatingAction(fakeAction)) {
      needsConfirmation = true
    }
    if (!isRead) acceptedWrites += 1
    accepted.push(normalized)
  }

  return { accepted, rejected, needsConfirmation }
}
