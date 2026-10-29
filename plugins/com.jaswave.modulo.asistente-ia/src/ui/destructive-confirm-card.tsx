import { useCallback, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'

import { patchMessage } from '../motor/ai-chat-store'
import { appendAiDawAudit, executeDawActions, formatActionResultsForUser, useDAW } from '@jaswave/host-sdk'
import type { DAWState, DawAction } from '@jaswave/host-sdk'
import { describeActionForUser } from '../motor/describe-action'
import { DetallesTecnicos, textoTecnico } from './detalles-tecnicos'

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

  let estado: DAWState | null = null
  try {
    estado = tienda.obtenerEstado()
  } catch {
    estado = null
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-destructive/50 bg-destructive/5 ring-1 ring-destructive/20">
      <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-[12px] font-semibold text-destructive">
        <AlertTriangle className="size-3.5 shrink-0" />
        Antes de continuar, confirma
      </div>
      <p className="break-words px-2.5 py-1.5 text-[11px] text-muted-foreground">{reason}</p>
      <ul className="list-disc space-y-0.5 break-words pb-2 pl-6 pr-2.5 text-[11px] text-foreground/85">
        {actions.map((a, i) => (
          <li key={`${a.type}-${i}`}>{describeActionForUser(a, estado).label}</li>
        ))}
      </ul>
      <DetallesTecnicos className="px-2.5 pb-1.5 text-[10px] text-muted-foreground/60">
        {actions.map((a) => `${a.type} ${textoTecnico(a.payload ?? {}, 200)}`).join('\n')}
      </DetallesTecnicos>
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
            Sí, hacerlo
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={reject}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground"
          >
            <X className="size-3" /> No, cancelar
          </button>
        </div>
      ) : local === 'confirmed' ? (
        <div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-emerald-400">Hecho</div>
      ) : (
        <div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">Cancelado</div>
      )}
    </div>
  )
}
