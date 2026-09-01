import { useCallback, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import {
  executeDawActions,
  formatActionResultsForUser,
  type DawAction,
} from '@/src/lib/ai-daw-agent'
import { appendAiDawAudit } from '@/src/lib/ai-daw-audit-store'
import { patchMessage } from '@/src/lib/ai-chat-store'

type Props = {
  conversationId: string
  messageId: string
  actions: DawAction[]
  reason: string
  status?: 'pending' | 'confirmed' | 'rejected'
  onDone?: () => void
}

export function DestructiveConfirmCard({
  conversationId,
  messageId,
  actions,
  reason,
  status = 'pending',
  onDone,
}: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(status)
  const [summary, setSummary] = useState('')

  const confirm = useCallback(async () => {
    setBusy(true)
    try {
      const results = await executeDawActions(tienda, actions, {
        agentMode: 'create',
        forceApply: true,
        source: 'user_confirm',
        conversationId,
        messageId,
        respectModeGate: false,
      })
      const line = formatActionResultsForUser(results)
      setSummary(line)
      setLocal('confirmed')
      patchMessage(conversationId, messageId, {
        confirmActions: { status: 'confirmed', actions, reason },
        actionsSummary: line,
      })
      onDone?.()
    } finally {
      setBusy(false)
    }
  }, [actions, conversationId, messageId, onDone, reason, tienda])

  const reject = useCallback(() => {
    setLocal('rejected')
    for (const a of actions) {
      appendAiDawAudit({
        conversationId,
        messageId,
        agentMode: 'create',
        source: 'user_confirm',
        tool: a.type,
        params: { ...(a.payload ?? {}) },
        status: 'rejected',
        result: { success: false, message: 'Rechazado por el usuario' },
      })
    }
    patchMessage(conversationId, messageId, {
      confirmActions: { status: 'rejected', actions, reason },
    })
    onDone?.()
  }, [actions, conversationId, messageId, onDone, reason])

  if (actions.length === 0) return null

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-destructive/50 bg-destructive/5 ring-1 ring-destructive/20">
      <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-[12px] font-semibold text-destructive">
        <AlertTriangle className="size-3.5 shrink-0" />
        Confirmación requerida
      </div>
      <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">{reason}</p>
      <ul className="max-h-28 space-y-0.5 overflow-y-auto px-2.5 pb-2 font-mono text-[10px] text-muted-foreground">
        {actions.map((a, i) => (
          <li key={`${a.type}-${i}`}>
            {a.type}
            {a.payload ? (
              <span className="text-muted-foreground/80"> {JSON.stringify(a.payload).slice(0, 100)}</span>
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
            onClick={() => void confirm()}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-destructive px-2 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Sí, ejecutar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={reject}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground"
          >
            <X className="size-3" /> No
          </button>
        </div>
      ) : local === 'confirmed' ? (
        <div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-emerald-400">Confirmado</div>
      ) : (
        <div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">Cancelado</div>
      )}
    </div>
  )
}
