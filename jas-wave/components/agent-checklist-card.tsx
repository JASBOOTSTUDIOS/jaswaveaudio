import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, Loader2, Square, ListChecks } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { appendAiDawAudit } from '@/src/lib/ai-daw-audit-store'
import { patchMessage } from '@/src/lib/ai-chat-store'
import {
  describeActionForUser,
  normalizeChecklist,
  type AgentChecklist,
  type AgentChecklistItem,
} from '@/src/lib/ai-agent-checklist'
import { dryRunDawActions, ensureToolRegistryContext } from '@/src/lib/agent-tool-bridge'
import { cn } from '@/lib/utils'

type Props = {
  conversationId: string
  messageId: string
  checklist: AgentChecklist
  agentMode: string
  onChange?: (next: AgentChecklist) => void
}

function statusIcon(st: AgentChecklistItem['status']) {
  if (st === 'done') return <Check className="size-3 text-emerald-400" />
  if (st === 'running') return <Loader2 className="size-3 animate-spin text-accent-amber" />
  if (st === 'ready') return <ChevronRight className="size-3 text-accent-amber" />
  if (st === 'failed') return <Square className="size-3 text-destructive" />
  return <span className="size-3 rounded-full border border-muted-foreground/40" />
}

/**
 * Checklist paso a paso: «Continuar» publica una PendingActionsCard (dry-run)
 * en lugar de ejecutar a ciegas.
 */
export function AgentChecklistCard({
  conversationId,
  messageId,
  checklist: initial,
  agentMode,
  onChange,
}: Props) {
  const tienda = useDAW()
  const [list, setList] = useState(() => normalizeChecklist(initial))
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  useEffect(() => {
    setList(normalizeChecklist(initial))
  }, [initial])

  const persist = useCallback(
    (next: AgentChecklist) => {
      const norm = normalizeChecklist(next)
      setList(norm)
      patchMessage(conversationId, messageId, { agentChecklist: norm })
      onChange?.(norm)
    },
    [conversationId, messageId, onChange],
  )

  /** Publica propuesta para aprobación; no muta el DAW. */
  const proposeCurrent = useCallback(async () => {
    if (busy || list.status !== 'active') return
    const idx = list.currentIndex
    const item = list.items[idx]
    if (!item || item.status === 'done') return
    if (!item.actions.length) {
      setHint('Este paso no tiene acciones.')
      return
    }

    setBusy(true)
    setHint('')
    try {
      for (const a of item.actions) {
        appendAiDawAudit({
          conversationId,
          messageId,
          agentMode,
          source: 'checklist_step',
          tool: a.type,
          params: { ...(a.payload ?? {}) },
          status: 'proposed',
        })
      }

      ensureToolRegistryContext(tienda)
      const preview = await dryRunDawActions(tienda, item.actions)
      const actionStatuses: Record<string, 'pending' | 'accepted' | 'rejected'> = {}
      item.actions.forEach((_, i) => {
        actionStatuses[String(i)] = 'accepted'
      })

      const nextList: AgentChecklist = {
        ...list,
        items: list.items.map((it, i) =>
          i === idx
            ? {
                ...it,
                status: 'ready',
                detail: 'Propuesta lista — revisa la tarjeta y pulsa Aplicar',
              }
            : it,
        ),
      }
      const norm = normalizeChecklist(nextList)
      setList(norm)

      patchMessage(conversationId, messageId, {
        agentChecklist: norm,
        pendingActions: {
          status: 'pending',
          actions: item.actions,
          agentMode,
          previewDiff: preview.diff,
          previewSummary: preview.summary || undefined,
          actionStatuses,
          checklistStepId: item.id,
        },
      })
      onChange?.(norm)
      setHint('Revisa la propuesta abajo y pulsa «Aplicar seleccionadas».')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setHint(msg)
      persist({
        ...list,
        items: list.items.map((it, i) =>
          i === idx ? { ...it, status: 'failed', error: msg } : it,
        ),
      })
    } finally {
      setBusy(false)
    }
  }, [agentMode, busy, conversationId, list, messageId, onChange, persist, tienda])

  const skipCurrent = useCallback(() => {
    if (busy || list.status !== 'active') return
    const idx = list.currentIndex
    const nextItems = list.items.map((it, i) =>
      i === idx ? { ...it, status: 'skipped' as const } : it,
    )
    const nextIndex = idx + 1
    persist({
      status: nextIndex >= nextItems.length ? 'done' : 'active',
      currentIndex: Math.min(nextIndex, nextItems.length - 1),
      items: nextItems,
    })
    setHint('')
  }, [busy, list, persist])

  const current = list.items[list.currentIndex]
  const doneCount = list.items.filter((i) => i.status === 'done' || i.status === 'skipped').length

  return (
    <div className="mt-2 rounded-md border border-violet-800/40 bg-violet-950/25 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-violet-300/90">
        <ListChecks className="size-3" />
        Plan de ejecución ({doneCount}/{list.items.length})
        {list.status === 'done' ? (
          <span className="ml-auto text-emerald-400 normal-case">Completado</span>
        ) : list.status === 'stopped' ? (
          <span className="ml-auto text-destructive normal-case">Detenido</span>
        ) : null}
      </div>
      <ul className="mb-2 space-y-1">
        {list.items.map((it, i) => (
          <li
            key={it.id}
            className={cn(
              'flex items-start gap-2 rounded px-1.5 py-1 text-[11px]',
              i === list.currentIndex && list.status === 'active'
                ? 'bg-accent-amber/10 text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <span className="mt-0.5 shrink-0">{statusIcon(it.status)}</span>
            <span className="min-w-0 flex-1">
              <span className={it.status === 'done' ? 'line-through opacity-70' : ''}>{it.label}</span>
              {i === list.currentIndex && list.status === 'active' && it.actions.length ? (
                <ul className="mt-1 space-y-0.5 border-l border-border/50 pl-2 text-[10px] text-muted-foreground">
                  {it.actions.map((a, ai) => (
                    <li key={`${a.type}-${ai}`}>{describeActionForUser(a).label}</li>
                  ))}
                </ul>
              ) : null}
              {it.detail && i === list.currentIndex ? (
                <div className="mt-0.5 text-[10px] text-accent-amber/90">{it.detail}</div>
              ) : null}
              {it.error ? <div className="text-[10px] text-destructive/90">{it.error}</div> : null}
            </span>
          </li>
        ))}
      </ul>
      {list.status === 'active' && current ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void proposeCurrent()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ChevronRight className="size-3" />}
            Continuar — preparar este paso
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={skipCurrent}
            className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Saltar
          </button>
        </div>
      ) : null}
      {hint ? <p className="mt-1.5 line-clamp-2 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
