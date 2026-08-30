import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  GitCompare,
  Hammer,
  Loader2,
  Play,
  Square,
  X,
} from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import {
  executeDawActions,
  formatActionResultsForUser,
  type DawAction,
} from '@/src/lib/ai-daw-agent'
import { actionRiskLevel, withAplicarTrue } from '@/src/lib/ai-action-policy'
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
  actionStatuses?: Record<string, 'pending' | 'accepted' | 'rejected'>
  checklistStepId?: string
  onDone?: () => void
  /** id del contenedor para scroll desde la barra sticky */
  cardId?: string
}

function defaultSelected(
  actions: DawAction[],
  statuses?: Record<string, 'pending' | 'accepted' | 'rejected'>,
): Set<number> {
  const set = new Set<number>()
  actions.forEach((_, i) => {
    const st = statuses?.[String(i)]
    if (st === 'rejected') return
    set.add(i)
  })
  return set
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
    return (
      <span className="shrink-0 rounded bg-destructive/20 px-1 py-0.5 text-[9px] font-medium uppercase text-destructive">
        peligro
      </span>
    )
  }
  if (risk === 'write') {
    return (
      <span className="shrink-0 rounded bg-accent-amber/15 px-1 py-0.5 text-[9px] font-medium uppercase text-accent-amber">
        escribe
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded bg-muted/40 px-1 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
      lectura
    </span>
  )
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
  checklistStepId,
  onDone,
  cardId,
}: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(status)
  const [summary, setSummary] = useState('')
  const [selected, setSelected] = useState(() => defaultSelected(actions, actionStatuses))
  const [auditioning, setAuditioning] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    setLocal(status)
  }, [status])

  useEffect(() => {
    if (local === 'pending') {
      publishMidiProposalFromActions(actions, { messageId })
    }
  }, [actions, local, messageId])

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

  const persistStatuses = useCallback(
    (next: Set<number>, patch: Partial<NonNullable<StoredChatMessage['pendingActions']>> = {}) => {
      const actionStatusesNext: Record<string, 'pending' | 'accepted' | 'rejected'> = {}
      actions.forEach((_, i) => {
        actionStatusesNext[String(i)] = next.has(i) ? 'accepted' : 'rejected'
      })
      patchMessage(conversationId, messageId, {
        pendingActions: {
          status: local === 'pending' ? 'pending' : local,
          actions,
          agentMode,
          previewDiff,
          previewSummary: summaryLine || undefined,
          actionStatuses: actionStatusesNext,
          checklistStepId,
          ...patch,
        },
      })
    },
    [
      actions,
      agentMode,
      checklistStepId,
      conversationId,
      local,
      messageId,
      previewDiff,
      summaryLine,
    ],
  )

  const toggle = useCallback(
    (i: number) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(i)) next.delete(i)
        else next.add(i)
        persistStatuses(next)
        return next
      })
    },
    [persistStatuses],
  )

  const selectAll = useCallback(() => {
    const next = new Set(actions.map((_, i) => i))
    setSelected(next)
    persistStatuses(next)
  }, [actions, persistStatuses])

  const toggleExpand = useCallback((i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [])

  const apply = useCallback(async () => {
    const toApply = actions.filter((_, i) => selected.has(i))
    if (!toApply.length) return
    setBusy(true)
    try {
      const undoDepthAtStart = snapshotUndoDepth(tienda)
      for (const a of toApply) {
        appendAiDawAudit({
          conversationId,
          messageId,
          agentMode,
          source: 'user_build',
          tool: a.type,
          params: { ...(a.payload ?? {}) },
          status: 'proposed',
        })
      }
      const toRun = withAplicarTrue(toApply)
      const results = await executeDawActions(tienda, toRun, {
        agentMode: 'create',
        forceApply: true,
        source: 'user_build',
        conversationId,
        messageId,
        respectModeGate: false,
      })
      const line = formatActionResultsForUser(results)
      setSummary(line)
      setLocal('applied')
      const certifyRaw = await runPostTurnCertifyPipeline(tienda, results, {})
      const certify = toStoredCertify(certifyRaw)
      const actionStatusesNext: Record<string, 'pending' | 'accepted' | 'rejected'> = {}
      actions.forEach((_, i) => {
        actionStatusesNext[String(i)] = selected.has(i) ? 'accepted' : 'rejected'
      })
      const ok = results.every((r) => r.success)
      patchMessage(conversationId, messageId, {
        pendingActions: {
          status: 'applied',
          actions,
          agentMode,
          previewDiff,
          previewSummary: summaryLine || undefined,
          actionStatuses: actionStatusesNext,
          checklistStepId,
        },
        actionsSummary: line,
        undoDepthAtStart,
        appliedDiffSummary: summaryLine || undefined,
        certify,
        reverted: false,
      })
      syncChecklistStep(
        conversationId,
        messageId,
        checklistStepId,
        ok ? 'done' : 'failed',
        ok ? undefined : line.slice(0, 200),
      )
      clearMidiProposalOverlay()
      onDone?.()
    } finally {
      setBusy(false)
    }
  }, [
    actions,
    agentMode,
    checklistStepId,
    conversationId,
    messageId,
    onDone,
    previewDiff,
    selected,
    summaryLine,
    tienda,
  ])

  const discard = useCallback(() => {
    setLocal('discarded')
    for (const a of actions) {
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
    patchMessage(conversationId, messageId, {
      pendingActions: {
        status: 'discarded',
        actions,
        agentMode,
        previewDiff,
        previewSummary: summaryLine || undefined,
        actionStatuses: Object.fromEntries(actions.map((_, i) => [String(i), 'rejected' as const])),
        checklistStepId,
      },
    })
    syncChecklistStep(conversationId, messageId, checklistStepId, 'skipped')
    clearMidiProposalOverlay()
    onDone?.()
  }, [
    actions,
    agentMode,
    checklistStepId,
    conversationId,
    messageId,
    onDone,
    previewDiff,
    summaryLine,
  ])

  const auditionMidi = useCallback(async () => {
    if (!midiPreview?.notes.length) return
    setAuditioning(true)
    try {
      const trackId = midiPreview.trackId
      if (trackId) setPreferredVstPreviewTrack(trackId)
      const bpm = tienda.obtenerEstado().project.bpm?.valor ?? 120
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

  return (
    <div
      id={cardId}
      className="mt-2 overflow-hidden rounded-lg border border-accent-amber/40 bg-background/50 ring-1 ring-accent-amber/20"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <div className="min-w-0 text-[12px] font-semibold text-foreground">
          <GitCompare className="mr-1 inline size-3.5 text-accent-amber" />
          La IA propone {actions.length} cambio{actions.length === 1 ? '' : 's'} — revisa y aplica
        </div>
        {local === 'applied' ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-emerald-400">
            <Check className="size-3" /> Aplicado
          </span>
        ) : local === 'discarded' ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">Descartado</span>
        ) : (
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-accent-amber">
            Sin aplicar
          </span>
        )}
      </div>

      {summaryLine || rows.length ? (
        <div className="border-b border-border/40 bg-black/20 px-2.5 py-1.5">
          {summaryLine ? (
            <div className="text-[11px] font-medium text-accent-amber/90">{summaryLine}</div>
          ) : null}
          {rows.length ? (
            <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[10px] text-muted-foreground">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className={cn(
                    r.startsWith('+') && 'text-emerald-400/90',
                    r.startsWith('−') && 'text-red-400/90',
                  )}
                >
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {midiPreview ? (
        <div className="border-b border-border/40 px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-foreground">
              Preview MIDI · {midiPreview.notes.length} notas · {midiPreview.nombre}
            </span>
            <button
              type="button"
              disabled={auditioning || local !== 'pending'}
              onClick={() => void auditionMidi()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-accent-amber ring-1 ring-accent-amber/40 hover:bg-accent-amber/10 disabled:opacity-40"
            >
              {auditioning ? <Square className="size-3" /> : <Play className="size-3" />}
              Escuchar VST
            </button>
          </div>
          <div className="relative h-14 overflow-hidden rounded bg-black/30">
            {midiPreview.notes.slice(0, 80).map((n, i) => {
              const maxBeat = Math.max(4, ...midiPreview.notes.map((x) => x.inicio + x.duracion))
              const left = `${(n.inicio / maxBeat) * 100}%`
              const width = `${Math.max(1, (n.duracion / maxBeat) * 100)}%`
              const top = `${((127 - n.pitch) / 127) * 100}%`
              return (
                <div
                  key={i}
                  className="absolute h-1 rounded-sm bg-emerald-400/80"
                  style={{ left, width, top }}
                  title={`pitch ${n.pitch}`}
                />
              )
            })}
          </div>
          <p className="mt-1 text-[9px] text-muted-foreground">
            Mini piano-roll de la propuesta. Aplicar confirma los cambios en el proyecto.
          </p>
        </div>
      ) : null}

      <ul className="max-h-52 space-y-0.5 overflow-y-auto px-2.5 py-2 text-[11px]">
        {actions.map((a, i) => {
          const on = selected.has(i)
          const desc = describeActionForUser(a)
          const risk = actionRiskLevel(a)
          const open = expanded.has(i)
          return (
            <li key={`${a.type}-${i}`} className="rounded hover:bg-panel-raised/60">
              <div
                className={cn(
                  'flex items-start gap-2 px-1 py-1',
                  local !== 'pending' && 'opacity-80',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={on}
                  disabled={local !== 'pending' || busy}
                  onChange={() => toggle(i)}
                  aria-label={desc.label}
                />
                <button
                  type="button"
                  className="mt-0.5 shrink-0 text-muted-foreground"
                  onClick={() => toggleExpand(i)}
                  title="Detalle técnico"
                  aria-expanded={open}
                >
                  {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-foreground">{desc.label}</span>
                    {riskBadge(risk)}
                  </div>
                  {open ? (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-1.5 font-mono text-[9px] text-muted-foreground">
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

      {summary ? (
        <div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-emerald-400/90">
          {summary}
        </div>
      ) : null}

      {local === 'pending' ? (
        <div className="flex flex-wrap gap-2 border-t border-border/40 px-2.5 py-2">
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => void apply()}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-accent-amber px-2 py-1.5 text-[11px] font-semibold text-background disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Hammer className="size-3" />}
            Aplicar seleccionadas ({selected.size})
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={selectAll}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            title="Seleccionar todas"
          >
            <CheckCheck className="size-3" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={discard}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            title="Descartar todo"
          >
            <X className="size-3" />
            Descartar todo
          </button>
        </div>
      ) : null}
    </div>
  )
}
