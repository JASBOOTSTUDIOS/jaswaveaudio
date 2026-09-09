import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { type DawAction } from '@/src/lib/ai-daw-agent'
import {
  loadAiSettings,
  getActiveProvider,
  toAiChatPayload,
  aiChatWithFallback,
  providerReasoningPaceMs,
} from '@/src/lib/ai-settings'
import { actionRiskLevel } from '@/src/lib/ai-action-policy'
import { appendAiDawAudit } from '@/src/lib/ai-daw-audit-store'
import { getConversation, patchMessage, type StoredChatMessage } from '@/src/lib/ai-chat-store'
import {
  advanceChecklistAfterStep,
  normalizeChecklist,
} from '@/src/lib/ai-agent-checklist'
import { describeActionForUser } from '@/src/lib/describe-action'
import { snapshotUndoDepth, toStoredCertify } from '@/src/lib/agent-turn-undo'
import { runPostTurnCertifyPipeline } from '@/src/lib/agent-certify-pipeline'
import { formatSemanticDiffSummary, type SemanticStateDiff } from '../../shared/src/state/diff-estado'
import { safeProjectBpm } from '../../shared/src'
import {
  clearMidiProposalOverlay,
  notesFromActionPayload,
  publishMidiProposalFromActions,
} from '@/src/lib/ai-midi-proposal-store'
import { routeMidiToTrack, setPreferredVstPreviewTrack } from '@/src/lib/plugin/vst-voice-router'
import { beatsASegundos } from '@/lib/audio-conversions'
import { cn } from '@/lib/utils'

type Props = {
  conversationId: string
  messageId: string
  actions: DawAction[]
  agentMode: string
  status?: 'pending' | 'applied' | 'discarded'
  previewDiff?: SemanticStateDiff
  previewSummary?: string
  actionStatuses?: Record<string, 'pending' | 'accepted' | 'rejected' | 'applied' | 'skipped'>
  applied?: number[]
  skipped?: number[]
  checklistStepId?: string
  onDone?: () => void
  /** id del contenedor para scroll desde la barra sticky */
  cardId?: string
}

type ItemStatus = 'pending' | 'accepted' | 'rejected'

function initItemStatuses(
  actions: DawAction[],
  cardStatus: 'pending' | 'applied' | 'discarded',
  opts?: {
    actionStatuses?: Record<string, 'pending' | 'accepted' | 'rejected' | 'applied' | 'skipped'>
    applied?: number[]
    skipped?: number[]
  },
): Record<string, ItemStatus> {
  const applied = new Set(opts?.applied ?? [])
  const skipped = new Set(opts?.skipped ?? [])
  const incoming = opts?.actionStatuses
  const out: Record<string, ItemStatus> = {}
  actions.forEach((_, i) => {
    const k = String(i)
    const s = incoming?.[k]
    if (applied.has(i) || s === 'applied') {
      out[k] = 'accepted'
      return
    }
    if (skipped.has(i) || s === 'skipped') {
      out[k] = 'rejected'
      return
    }
    if (cardStatus === 'applied') {
      out[k] = s === 'rejected' ? 'rejected' : 'accepted'
      return
    }
    if (cardStatus === 'discarded') {
      out[k] = 'rejected'
      return
    }
    out[k] = 'pending'
  })
  return out
}

function statusArrays(statuses: Record<string, ItemStatus>, n: number): { applied: number[]; skipped: number[] } {
  const applied: number[] = []
  const skipped: number[] = []
  for (let i = 0; i < n; i++) {
    const s = statuses[String(i)]
    if (s === 'accepted') applied.push(i)
    else if (s === 'rejected') skipped.push(i)
  }
  return { applied, skipped }
}

function pendingIndices(actions: DawAction[], statuses: Record<string, ItemStatus>): number[] {
  return actions.map((_, i) => i).filter((i) => (statuses[String(i)] ?? 'pending') === 'pending')
}

function cardStatusFrom(statuses: Record<string, ItemStatus>, n: number): 'pending' | 'applied' | 'discarded' {
  const vals = Array.from({ length: n }, (_, i) => statuses[String(i)] ?? 'pending')
  if (vals.some((s) => s === 'pending')) return 'pending'
  if (vals.every((s) => s === 'rejected')) return 'discarded'
  return 'applied'
}

function defaultSelected(
  actions: DawAction[],
  statuses?: Record<string, ItemStatus>,
): Set<number> {
  return new Set(pendingIndices(actions, statuses ?? {}))
}

function diffRows(diff?: SemanticStateDiff): string[] {
  if (!diff) return []
  const rows: string[] = []
  for (const n of diff.tracksAdded) rows.push(`+ pista «${n}»`)
  for (const n of diff.tracksRemoved) rows.push(`− pista «${n}»`)
  if (diff.clipsAdded) rows.push(`+${diff.clipsAdded} clip(s)`)
  if (diff.clipsRemoved) rows.push(`−${diff.clipsRemoved} clip(s)`)
  for (const v of diff.volumeChanges.slice(0, 6)) {
    rows.push(`volumen ${v.trackId}: ${v.before.toFixed(2)} → ${v.after.toFixed(2)}`)
  }
  for (const p of diff.pluginsLoaded.slice(0, 6)) rows.push(`+ plugin ${p}`)
  for (const p of diff.pluginsUnloaded.slice(0, 4)) rows.push(`− plugin ${p}`)
  if (diff.sendsAdded) rows.push(`+${diff.sendsAdded} send(s)`)
  if (diff.sidechainsAdded) rows.push(`+${diff.sidechainsAdded} sidechain(s)`)
  return rows
}

function riskBadge(risk: 'read' | 'write' | 'dangerous') {
  if (risk === 'dangerous') {
    return <span className="shrink-0 text-[10px] text-destructive/80">peligro</span>
  }
  if (risk === 'write') {
    return <span className="shrink-0 text-[10px] text-muted-foreground/50">escribe</span>
  }
  return <span className="shrink-0 text-[10px] text-muted-foreground/40">lectura</span>
}

function syncChecklistStep(
  conversationId: string,
  messageId: string,
  checklistStepId: string | undefined,
  outcome: 'done' | 'failed' | 'skipped',
  error?: string,
) {
  if (!checklistStepId) return
  const conv = getConversation(conversationId)
  const msg = conv?.messages.find((m) => m.id === messageId)
  if (!msg?.agentChecklist) return
  const next = advanceChecklistAfterStep(msg.agentChecklist, checklistStepId, outcome, error)
  patchMessage(conversationId, messageId, { agentChecklist: normalizeChecklist(next) })
}

/** Propuesta de mutaciones con diff semántico y aceptar/rechazar por acción. */
export function PendingActionsCard({
  conversationId,
  messageId,
  actions,
  agentMode,
  status = 'pending',
  previewDiff,
  previewSummary,
  actionStatuses,
  applied,
  skipped,
  checklistStepId,
  onDone,
  cardId,
}: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(status)
  const [summary, setSummary] = useState('')
  const [itemStatus, setItemStatus] = useState(() =>
    initItemStatuses(actions, status, { actionStatuses, applied, skipped }),
  )
  const [selected, setSelected] = useState(() =>
    defaultSelected(actions, initItemStatuses(actions, status, { actionStatuses, applied, skipped })),
  )
  const [auditioning, setAuditioning] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [open, setOpen] = useState(status === 'pending')

  useEffect(() => {
    setLocal(status)
    setItemStatus(initItemStatuses(actions, status, { actionStatuses, applied, skipped }))
  }, [actions, actionStatuses, applied, skipped, status])

  useEffect(() => {
    if (local !== 'pending') {
      clearMidiProposalOverlay()
      return
    }
    const leftover = actions.filter((_, i) => (itemStatus[String(i)] ?? 'pending') === 'pending')
    if (leftover.length) publishMidiProposalFromActions(leftover, { messageId })
    else clearMidiProposalOverlay()
  }, [actions, itemStatus, local, messageId])

  const midiPreview = useMemo(() => {
    for (const a of actions) {
      if (
        a.type === 'midi.clip.create' ||
        a.type === 'midi.notes.set' ||
        a.type === 'daw.generateMidiSong'
      ) {
        const notes = notesFromActionPayload(a.payload)
        if (notes.length) {
          return {
            trackId: String(a.payload?.pistaId ?? a.payload?.trackId ?? ''),
            nombre: String(a.payload?.nombre ?? a.type),
            notes,
          }
        }
      }
    }
    return null
  }, [actions])

  const summaryLine = useMemo(
    () => previewSummary || (previewDiff ? formatSemanticDiffSummary(previewDiff) : ''),
    [previewDiff, previewSummary],
  )
  const rows = useMemo(() => diffRows(previewDiff), [previewDiff])

  const persist = useCallback(
    (statuses: Record<string, ItemStatus>, extra: Partial<StoredChatMessage> = {}) => {
      const nextLocal = cardStatusFrom(statuses, actions.length)
      const { applied: appliedNext, skipped: skippedNext } = statusArrays(statuses, actions.length)
      const actionStatusesNext: Record<string, 'pending' | 'applied' | 'skipped'> = {}
      actions.forEach((_, i) => {
        const s = statuses[String(i)] ?? 'pending'
        actionStatusesNext[String(i)] =
          s === 'accepted' ? 'applied' : s === 'rejected' ? 'skipped' : 'pending'
      })
      patchMessage(conversationId, messageId, {
        pendingActions: {
          status: nextLocal,
          actions,
          agentMode,
          previewDiff,
          previewSummary: summaryLine || undefined,
          actionStatuses: actionStatusesNext,
          applied: appliedNext,
          skipped: skippedNext,
          checklistStepId,
        },
        ...extra,
      })
      return nextLocal
    },
    [actions, agentMode, checklistStepId, conversationId, messageId, previewDiff, summaryLine],
  )

  const leftover = useMemo(() => pendingIndices(actions, itemStatus), [actions, itemStatus])

  const toggle = useCallback((i: number) => {
    if ((itemStatus[String(i)] ?? 'pending') !== 'pending') return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [itemStatus])

  const toggleExpand = useCallback((i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [])

  const applyIndices = useCallback(
    async (indices: number[]) => {
      const toIdx = indices.filter((i) => (itemStatus[String(i)] ?? 'pending') === 'pending')
      if (!toIdx.length) return
      setBusy(true)
      try {
        const conv = getConversation(conversationId)
        const msg = conv?.messages.find((m) => m.id === messageId)
        const undoDepthAtStart = msg?.undoDepthAtStart ?? snapshotUndoDepth(tienda)
        const userTextHint =
          [...(conv?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content || ''
        let cfg = loadAiSettings()
        let provider = getActiveProvider(cfg)
        const chatFn = async (body: string) => {
          if (!window.electron?.aiChat) return ''
          cfg = loadAiSettings()
          provider = getActiveProvider(cfg)
          const r = await window.electron.aiChat(
            toAiChatPayload(provider, [{ role: 'user', content: body }], {
              temperature: cfg.temperature,
              maxTokens: Math.min(cfg.maxTokens, 8192),
            }),
          )
          return r.success && r.content ? r.content : ''
        }
        const councilChat = async (
          reasonMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        ) => {
          if (!window.electron?.aiChat) return { success: false as const }
          cfg = loadAiSettings()
          const r = await aiChatWithFallback(
            (req) => window.electron!.aiChat!(req),
            reasonMessages,
            {
              temperature: Math.min(0.9, Math.max(cfg.temperature, 0.55)),
              maxTokens: Math.max(cfg.maxTokens, 16384),
              settings: cfg,
            },
          )
          return { success: Boolean(r.success && r.content), content: r.content }
        }
        const { runApplyPendingFlow } = await import('@/src/lib/pending-apply-flow')
        const out = await runApplyPendingFlow({
          tienda,
          conversationId,
          messageId,
          agentMode,
          actions,
          indices: toIdx,
          chat: chatFn,
          userTextHint,
          councilChat,
          paceBetweenPhasesMs: providerReasoningPaceMs(provider.kind),
          onCouncilPhase: (label) => {
            setSummary((prev) => {
              const base = prev?.split('\n')[0] ?? ''
              return [base, `💬 ${label}`].filter(Boolean).join('\n')
            })
            onDone?.()
          },
          onCouncilStep: (steps) => {
            patchMessage(conversationId, messageId, {
              reasoningSteps: steps.map((s) => ({ ...s, collapsed: false })),
            })
            onDone?.()
          },
        })
        const line = [out.line, out.loopSummary].filter(Boolean).join('\n')
        const reasoningPatch = out.reasoningSteps.length
          ? { reasoningSteps: out.reasoningSteps.map((s) => ({ ...s, collapsed: false })) }
          : {}

        if (out.nextPending.length) {
          const nextActions = out.nextPending
          const nextStatuses: Record<string, ItemStatus> = {}
          nextActions.forEach((_, i) => {
            nextStatuses[String(i)] = 'pending'
          })
          patchMessage(conversationId, messageId, {
            pendingActions: {
              status: 'pending',
              actions: nextActions,
              agentMode,
              previewSummary: out.loopSummary || 'Siguiente paso — pulsa Aplicar para continuar',
              actionStatuses: Object.fromEntries(
                nextActions.map((_, i) => [String(i), 'pending' as const]),
              ),
              applied: [],
              skipped: [],
              checklistStepId,
            },
            actionsSummary: [msg?.actionsSummary, line].filter(Boolean).join('\n'),
            undoDepthAtStart,
            ...reasoningPatch,
            content: out.councilBrief
              ? [msg?.content, out.councilBrief].filter(Boolean).join('\n\n')
              : msg?.content,
          })
          setItemStatus(nextStatuses)
          setSelected(new Set(nextActions.map((_, i) => i)))
          setLocal('pending')
          setSummary((prev) =>
            [prev, line, 'Siguiente paso listo — pulsa Aplicar.'].filter(Boolean).join('\n'),
          )
          onDone?.()
          return
        }

        const nextStatuses = { ...itemStatus }
        for (const i of toIdx) nextStatuses[String(i)] = out.ok ? 'accepted' : 'rejected'
        const certifyRaw = await runPostTurnCertifyPipeline(
          tienda,
          toIdx.map((i) => ({
            type: actions[i]?.type ?? 'action',
            success: out.ok,
            message: out.line,
          })),
          {},
        )
        const certify = toStoredCertify(certifyRaw)
        const nextLocal = persist(nextStatuses, {
          actionsSummary: [msg?.actionsSummary, line].filter(Boolean).join('\n'),
          undoDepthAtStart,
          appliedDiffSummary: summaryLine || undefined,
          certify,
          reverted: false,
          ...reasoningPatch,
          ...(out.councilBrief
            ? {
                content: [msg?.content, out.councilBrief].filter(Boolean).join('\n\n'),
              }
            : {}),
        })
        setItemStatus(nextStatuses)
        setSelected(new Set())
        setLocal(nextLocal)
        setSummary((prev) => [prev, line].filter(Boolean).join('\n'))
        if (nextLocal !== 'pending') {
          syncChecklistStep(
            conversationId,
            messageId,
            checklistStepId,
            out.ok ? 'done' : 'failed',
            out.ok ? undefined : out.line.slice(0, 200),
          )
        }
        onDone?.()
      } finally {
        setBusy(false)
      }
    },
    [
      actions,
      agentMode,
      checklistStepId,
      conversationId,
      itemStatus,
      messageId,
      onDone,
      persist,
      summaryLine,
      tienda,
    ],
  )

  const rejectIndices = useCallback(
    (indices: number[]) => {
      const toIdx = indices.filter((i) => (itemStatus[String(i)] ?? 'pending') === 'pending')
      if (!toIdx.length) return
      const nextStatuses = { ...itemStatus }
      for (const i of toIdx) {
        nextStatuses[String(i)] = 'rejected'
        const a = actions[i]
        if (!a) continue
        appendAiDawAudit({
          conversationId,
          messageId,
          agentMode,
          source: 'user_build',
          tool: a.type,
          params: { ...(a.payload ?? {}) },
          status: 'rejected',
          result: { success: false, message: 'Descartado por el usuario' },
        })
      }
      const nextLocal = persist(nextStatuses)
      setItemStatus(nextStatuses)
      setSelected((prev) => {
        const next = new Set(prev)
        for (const i of toIdx) next.delete(i)
        return next
      })
      setLocal(nextLocal)
      if (nextLocal !== 'pending') {
        syncChecklistStep(conversationId, messageId, checklistStepId, 'skipped')
      }
      onDone?.()
    },
    [actions, agentMode, checklistStepId, conversationId, itemStatus, messageId, onDone, persist],
  )

  const apply = useCallback(async () => {
    const picked = leftover.filter((i) => selected.has(i))
    await applyIndices(picked)
  }, [applyIndices, leftover, selected])

  const discard = useCallback(() => {
    rejectIndices(leftover)
  }, [leftover, rejectIndices])

  const auditionMidi = useCallback(async () => {
    if (!midiPreview?.notes.length) return
    setAuditioning(true)
    try {
      const trackId = midiPreview.trackId
      if (trackId) setPreferredVstPreviewTrack(trackId)
      const bpm = safeProjectBpm(tienda.obtenerEstado())
      const sample = midiPreview.notes.slice(0, 24)
      for (const n of sample) {
        if (trackId) {
          routeMidiToTrack(trackId, true, n.pitch, Math.min(100, n.velocidad))
          await new Promise((r) => setTimeout(r, Math.min(400, beatsASegundos(n.duracion, bpm) * 1000)))
          routeMidiToTrack(trackId, false, n.pitch, 0)
        }
      }
    } finally {
      setAuditioning(false)
    }
  }, [midiPreview, tienda])

  if (actions.length === 0) return null

  const appliedCount = actions.filter((_, i) => itemStatus[String(i)] === 'accepted').length
  const statusLabel =
    local === 'applied'
      ? 'aplicado'
      : local === 'discarded'
        ? 'descartado'
        : leftover.length < actions.length
          ? `${leftover.length} por aplicar`
          : 'pendiente'

  return (
    <div id={cardId} className="mt-1.5 w-full min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-1 py-0.5 text-left text-[0.85em] text-muted-foreground/70 hover:text-muted-foreground"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90')}
        />
        <span className="min-w-0 truncate">
          {actions.length} cambio{actions.length === 1 ? '' : 's'} · {statusLabel}
          {appliedCount && local === 'pending' ? ` · ${appliedCount} ok` : ''}
        </span>
      </button>
      {open ? (
        <div className="w-full min-w-0 space-y-1 overflow-x-hidden pl-4">
          {summaryLine ? (
            <p className="text-[0.8em] text-muted-foreground/70">{summaryLine}</p>
          ) : null}
          {rows.length ? (
            <ul className="max-h-24 space-y-0.5 overflow-y-auto font-mono text-[10px] text-muted-foreground/70">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className={cn(r.startsWith('+') && 'text-foreground/70', r.startsWith('−') && 'text-destructive/70')}
                >
                  {r}
                </li>
              ))}
            </ul>
          ) : null}

          {midiPreview ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.8em] text-muted-foreground">
                  MIDI · {midiPreview.notes.length} notas
                </span>
                <button
                  type="button"
                  disabled={auditioning || local !== 'pending'}
                  onClick={() => void auditionMidi()}
                  className="text-[0.8em] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {auditioning ? '…' : 'Escuchar'}
                </button>
              </div>
              <div className="relative h-10 overflow-hidden">
                {midiPreview.notes.slice(0, 80).map((n, i) => {
                  const maxBeat = Math.max(4, ...midiPreview.notes.map((x) => x.inicio + x.duracion))
                  const left = `${(n.inicio / maxBeat) * 100}%`
                  const width = `${Math.max(1, (n.duracion / maxBeat) * 100)}%`
                  const top = `${((127 - n.pitch) / 127) * 100}%`
                  return (
                    <div
                      key={i}
                      className="absolute h-1 rounded-sm bg-foreground/40"
                      style={{ left, width, top }}
                      title={`pitch ${n.pitch}`}
                    />
                  )
                })}
              </div>
            </div>
          ) : null}

          <ul className="max-h-52 space-y-0.5 overflow-y-auto text-[0.85em]">
            {actions.map((a, i) => {
              const st = itemStatus[String(i)] ?? 'pending'
              const on = selected.has(i)
              const desc = describeActionForUser(a)
              const risk = actionRiskLevel(a)
              const detailOpen = expanded.has(i)
              const pending = st === 'pending' && local === 'pending'
              return (
                <li key={`${a.type}-${i}`}>
                  <div className={cn('flex items-start gap-1.5 py-0.5', st !== 'pending' && 'opacity-60')}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={pending && on}
                      disabled={!pending || busy}
                      onChange={() => toggle(i)}
                      aria-label={desc.label}
                    />
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 text-muted-foreground/60"
                      onClick={() => toggleExpand(i)}
                      title="Detalle"
                      aria-expanded={detailOpen}
                    >
                      {detailOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="min-w-0 flex-1 text-foreground/90">{desc.label}</span>
                        {riskBadge(risk)}
                        {st === 'accepted' ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground/50">ok</span>
                        ) : st === 'rejected' ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground/40">omitido</span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void applyIndices([i])}
                              className="text-[0.85em] text-foreground/80 hover:text-foreground disabled:opacity-50"
                            >
                              Aplicar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => rejectIndices([i])}
                              className="text-[0.85em] text-muted-foreground/70 hover:text-foreground disabled:opacity-50"
                            >
                              Omitir
                            </button>
                          </span>
                        )}
                      </div>
                      {detailOpen ? (
                        <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground/70">
                          {desc.detail ?? a.type}
                          {'\n'}
                          {JSON.stringify(a.payload ?? {}, null, 2).slice(0, 800)}
                        </pre>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {summary ? <p className="text-[0.8em] text-muted-foreground/70">{summary}</p> : null}

          {local === 'pending' ? (
            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              <button
                type="button"
                disabled={busy || leftover.filter((i) => selected.has(i)).length === 0}
                onClick={() => void apply()}
                className="inline-flex items-center gap-1 text-[0.85em] text-foreground/80 hover:text-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <ChevronRight className="size-3" />}
                Aplicar ({leftover.filter((i) => selected.has(i)).length})
              </button>
              <button
                type="button"
                data-apply-remaining=""
                disabled={busy || leftover.length === 0}
                onClick={() => void applyIndices(leftover)}
                className="text-[0.85em] text-muted-foreground/70 hover:text-foreground disabled:opacity-50"
              >
                Todas
              </button>
              <button
                type="button"
                disabled={busy || leftover.length === 0}
                onClick={discard}
                className="text-[0.85em] text-muted-foreground/70 hover:text-foreground disabled:opacity-50"
              >
                Descartar
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
