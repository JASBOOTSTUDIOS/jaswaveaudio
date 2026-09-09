import { useMemo, useSyncExternalStore } from 'react'
import { RotateCcw } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import type { StoredChatMessage } from '@/src/lib/ai-chat-store'
import { patchMessage } from '@/src/lib/ai-chat-store'
import { canRevertTurn, revertUndoToDepth } from '@/src/lib/agent-turn-undo'
import { cn } from '@/lib/utils'
import { useCallback, useState } from 'react'

type CertifyProps = {
  certify: NonNullable<StoredChatMessage['certify']>
}

export function TurnCertifyBadges({ certify }: CertifyProps) {
  const planLabel =
    certify.planPlanned != null && certify.planPlanned > 0
      ? `Plan ${certify.planDone ?? 0}/${certify.planPlanned}`
      : null
  const issueTitle = certify.issues.length ? certify.issues.join('\n') : undefined
  const gaps = certify.sectionGaps ?? 0
  const audit = certify.auditErrors ?? 0

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.8em] text-muted-foreground/70">
      {certify.healthOk && !certify.shouldRepair ? (
        <span>ok</span>
      ) : (
        <span title={issueTitle} className={certify.shouldRepair ? 'text-destructive/80' : undefined}>
          {certify.shouldRepair ? 'reparar' : 'avisos'}
          {certify.issues.length ? ` · ${certify.issues.length}` : ''}
        </span>
      )}
      {planLabel ? <span>{planLabel.toLowerCase()}</span> : null}
      {gaps > 0 ? <span title="Huecos sección×pista">huecos {gaps}</span> : null}
      {audit > 0 ? <span title="Errores del auditor de producción">audit {audit}</span> : null}
      {certify.issues.length > 0 && !certify.shouldRepair ? (
        <span className="min-w-0 truncate" title={issueTitle}>
          {certify.issues[0]}
        </span>
      ) : null}
    </div>
  )
}

type RevertProps = {
  conversationId: string
  messageId: string
  undoDepthAtStart?: number
  reverted?: boolean
  onDone?: () => void
}

function useUndoDepth(tienda: ReturnType<typeof useDAW>): number {
  return useSyncExternalStore(
    (cb) => tienda.suscribir(cb),
    () => tienda.executor.getUndoDepth(),
    () => 0,
  )
}

export function RevertTurnButton({
  conversationId,
  messageId,
  undoDepthAtStart,
  reverted,
  onDone,
}: RevertProps) {
  const tienda = useDAW()
  const currentDepth = useUndoDepth(tienda)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const enabled = useMemo(
    () => canRevertTurn({ undoDepthAtStart, reverted, currentDepth }),
    [undoDepthAtStart, reverted, currentDepth],
  )

  const onRevert = useCallback(async () => {
    if (undoDepthAtStart == null || !enabled) return
    setBusy(true)
    try {
      const r = await revertUndoToDepth(tienda, undoDepthAtStart)
      setNote(r.message)
      patchMessage(conversationId, messageId, {
        reverted: r.ok,
        actionsSummary: r.ok
          ? `↩ Revertido: ${r.message}`
          : `↩ Revert parcial: ${r.message}`,
      })
      onDone?.()
    } finally {
      setBusy(false)
    }
  }, [conversationId, enabled, messageId, onDone, tienda, undoDepthAtStart])

  if (undoDepthAtStart == null && !reverted) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {reverted ? (
        <span className="text-[10px] text-muted-foreground">↩ Respuesta revertida</span>
      ) : (
        <button
          type="button"
          disabled={!enabled || busy}
          title={
            enabled
              ? 'Deshacer los comandos de esta respuesta'
              : 'No hay mutaciones de este turno en la pila de undo (o ya se deshicieron)'
          }
          onClick={() => void onRevert()}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
            enabled
              ? 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
              : 'cursor-not-allowed text-muted-foreground/40',
          )}
        >
          <RotateCcw className={cn('size-3', busy && 'animate-spin')} />
          Revertir esta respuesta
        </button>
      )}
      {note ? <span className="text-[10px] text-muted-foreground">{note}</span> : null}
    </div>
  )
}
