import { useCallback, useState } from 'react'
import { Check, Hammer, Loader2, X } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import {
  executeDawActions,
  formatActionResultsForUser,
  type DawAction,
} from '@/src/lib/ai-daw-agent'
import { withAplicarTrue } from '@/src/lib/ai-action-policy'
import { appendAiDawAudit } from '@/src/lib/ai-daw-audit-store'
import { patchMessage } from '@/src/lib/ai-chat-store'

type Props = {
  conversationId: string
  messageId: string
  actions: DawAction[]
  agentMode: string
  status?: 'pending' | 'applied' | 'discarded'
  onDone?: () => void
}

export function PendingActionsCard({
  conversationId,
  messageId,
  actions,
  agentMode,
  status = 'pending',
  onDone,
}: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(status)
  const [summary, setSummary] = useState('')

  const apply = useCallback(async () => {
    setBusy(true)
    try {
      for (const a of actions) {
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
      const toRun = withAplicarTrue(actions)
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
      patchMessage(conversationId, messageId, {
        pendingActions: { status: 'applied', actions, agentMode },
        actionsSummary: line,
      })
      onDone?.()
    } finally {
      setBusy(false)
    }
  }, [actions, agentMode, conversationId, messageId, onDone, tienda])

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
      pendingActions: { status: 'discarded', actions, agentMode },
    })
    onDone?.()
  }, [actions, agentMode, conversationId, messageId, onDone])

  if (actions.length === 0) return null

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-accent-amber/40 bg-background/50 ring-1 ring-accent-amber/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <div className="min-w-0 text-[12px] font-semibold text-foreground">
          <Hammer className="mr-1 inline size-3.5 text-accent-amber" />
          Propuesta ({actions.length}) · modo {agentMode}
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
      <ul className="max-h-36 space-y-0.5 overflow-y-auto px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
        {actions.map((a, i) => (
          <li key={`${a.type}-${i}`}>
            {a.type}
            {a.payload ? (
              <span className="text-muted-foreground/80"> {JSON.stringify(a.payload).slice(0, 120)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {summary ? (
        <div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-emerald-400/90">{summary}</div>
      ) : null}
      {local === 'pending' ? (
        <div className="flex gap-2 border-t border-border/40 px-2.5 py-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-accent-amber px-2 py-1.5 text-[11px] font-semibold text-background disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Hammer className="size-3" />}
            Construir
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
