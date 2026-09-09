import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, Loader2, Square } from 'lucide-react'
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
  if (st === 'running') return <Loader2 className="size-3 animate-spin text-muted-foreground/70" />
  if (st === 'ready') return <ChevronRight className="size-3 text-muted-foreground/70" />
  if (st === 'failed') return <Square className="size-3 text-destructive/80" />
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
      setHint('Revisa la propuesta abajo: puedes aplicar cada cambio por separado o todas juntas.')
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
  const [open, setOpen] = useState(list.status === 'active')

  return (
    <div className="mt-1.5 w-full min-w-0">
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
          Plan · {doneCount}/{list.items.length}
          {list.status === 'done' ? ' · listo' : list.status === 'stopped' ? ' · detenido' : ''}
        </span>
      </button>
      {open ? (
        <div className="w-full min-w-0 space-y-0.5 overflow-x-hidden pl-4">
          <ul className="space-y-0.5">
            {list.items.map((it, i) => {
              const active = i === list.currentIndex && list.status === 'active'
              return (
                <li key={it.id} className="flex w-full min-w-0 items-start gap-1.5 py-0.5 text-[0.85em]">
                  <span className="mt-0.5 shrink-0">{statusIcon(it.status)}</span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        it.status === 'done' && 'text-muted-foreground/60 line-through',
                        active ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {it.label}
                    </span>
                    {active && it.actions.length ? (
                      <ul className="mt-0.5 space-y-0.5 text-[0.95em] text-muted-foreground/70">
                        {it.actions.map((a, ai) => (
                          <li key={`${a.type}-${ai}`} className="truncate">
                            {describeActionForUser(a).label}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {it.error ? (
                      <div className="mt-0.5 text-destructive/80">
                        {/ReferenceError|TypeError|is not defined/i.test(it.error)
                          ? 'Fallo interno. Reintenta Continuar.'
                          : it.error}
                      </div>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
          {list.status === 'active' && current ? (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void proposeCurrent()}
                className="inline-flex items-center gap-1 text-[0.85em] text-foreground/80 hover:text-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <ChevronRight className="size-3" />}
                Continuar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={skipCurrent}
                className="text-[0.85em] text-muted-foreground/70 hover:text-foreground disabled:opacity-50"
              >
                Saltar
              </button>
            </div>
          ) : null}
          {hint ? <p className="text-[0.8em] text-muted-foreground/70">{hint}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
