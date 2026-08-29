import { useCallback, useMemo, useState } from 'react'
import { Check, CheckCheck, GitCompare, Hammer, Loader2, X } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import {
  executeDawActions,
  formatActionResultsForUser,
  type DawAction,
} from '@/src/lib/ai-daw-agent'
import { withAplicarTrue } from '@/src/lib/ai-action-policy'
import { appendAiDawAudit } from '@/src/lib/ai-daw-audit-store'
import { patchMessage, type StoredChatMessage } from '@/src/lib/ai-chat-store'
import { snapshotUndoDepth, toStoredCertify } from '@/src/lib/agent-turn-undo'
import { runPostTurnCertifyPipeline } from '@/src/lib/agent-certify-pipeline'
import { formatSemanticDiffSummary, type SemanticStateDiff } from '../../shared/src/state/diff-estado'
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
  onDone?: () => void
}

function defaultSelected(actions: DawAction[], statuses?: Record<string, 'pending' | 'accepted' | 'rejected'>): Set<number> {
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
  onDone,
}: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(status)
  const [summary, setSummary] = useState('')
  const [selected, setSelected] = useState(() => defaultSelected(actions, actionStatuses))

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
          ...patch,
        },
      })
    },
    [actions, agentMode, conversationId, local, messageId, previewDiff, summaryLine],
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
      patchMessage(conversationId, messageId, {
        pendingActions: {
          status: 'applied',
          actions,
          agentMode,
          previewDiff,
          previewSummary: summaryLine || undefined,
          actionStatuses: actionStatusesNext,
        },
        actionsSummary: line,
        undoDepthAtStart,
        appliedDiffSummary: summaryLine || undefined,
        certify,
        reverted: false,
      })
      onDone?.()
    } finally {
      setBusy(false)
    }
  }, [
    actions,
    agentMode,
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
      },
    })
    onDone?.()
  }, [actions, agentMode, conversationId, messageId, onDone, previewDiff, summaryLine])

  if (actions.length === 0) return null

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-accent-amber/40 bg-background/50 ring-1 ring-accent-amber/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <div className="min-w-0 text-[12px] font-semibold text-foreground">
          <GitCompare className="mr-1 inline size-3.5 text-accent-amber" />
          Decisión ({actions.length}) · modo {agentMode}
        </div>
        {local === 'applied' ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
            <Check className="size-3" /> Aplicado
          </span>
        ) : local === 'discarded' ? (
          <span className="text-[10px] text-muted-foreground">Descartado</span>
        ) : (
          <span className="text-[9px] uppercase tracking-wide text-accent-amber">Sin aplicar</span>
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

      <ul className="max-h-40 space-y-0.5 overflow-y-auto px-2.5 py-2 text-[11px]">
        {actions.map((a, i) => {
          const on = selected.has(i)
          return (
            <li key={`${a.type}-${i}`}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-panel-raised/60',
                  local !== 'pending' && 'cursor-default opacity-80',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={on}
                  disabled={local !== 'pending' || busy}
                  onChange={() => toggle(i)}
                />
                <span className="min-w-0 flex-1 font-mono text-[10px] text-muted-foreground">
                  <span className="text-foreground">{a.type}</span>
                  {a.payload ? (
                    <span className="text-muted-foreground/80">
                      {' '}
                      {JSON.stringify(a.payload).slice(0, 100)}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {summary ? (
        <div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-emerald-400/90">{summary}</div>
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
            Construir seleccionadas ({selected.size})
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={selectAll}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            title="Seleccionar todas"
          >
            <CheckCheck className="size-3" /> Todas
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={discard}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" /> Descartar
          </button>
        </div>
      ) : null}
    </div>
  )
}
