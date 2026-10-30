import { useEffect, useState } from 'react'
import { ChevronRight, ClipboardList, Download, Trash2 } from 'lucide-react'
import { clearAiDawAudit, cn, exportAiDawAuditJson, listAiDawAudit, listAiDawAuditForMessage, subscribeAiDawAudit } from '@jaswave/host-sdk'
import type { AiDawAuditEntry } from '@jaswave/host-sdk'
import { describeActionForUser } from '../motor/describe-action'
import { DetallesTecnicos, modoDesarrollador, textoLegible, textoTecnico } from './detalles-tecnicos'
import { BotonVerTodo, useVerTodo } from './lista-expandible'

type Props = {
  messageId?: string
  compact?: boolean
}

const ESTADO: Record<AiDawAuditEntry['status'], string> = {
  proposed: 'propuesto',
  pending_confirm: 'esperando tu confirmación',
  executed: 'hecho',
  rejected: 'descartado',
  skipped_by_mode: 'no permitido en este modo',
  failed: 'no se pudo',
}

const ORIGEN: Record<AiDawAuditEntry['source'], string> = {
  model_actions: 'propuesto por la IA',
  fallback: 'propuesto por la IA',
  harness: 'revisión automática',
  user_build: 'aplicado por ti',
  user_confirm: 'confirmado por ti',
  checklist_step: 'paso de la lista',
  cli: 'línea de comandos',
}

function hora(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function AiAuditPanel({ messageId, compact }: Props) {
  const [entries, setEntries] = useState<AiDawAuditEntry[]>([])
  const [open, setOpen] = useState(!compact)
  const lista = useVerTodo(entries, compact ? 5 : 10)

  useEffect(() => {
    const refresh = () => {
      setEntries(messageId ? listAiDawAuditForMessage(messageId) : listAiDawAudit(120))
    }
    refresh()
    return subscribeAiDawAudit(refresh)
  }, [messageId])

  if (compact && entries.length === 0) return null
  const verTecnico = modoDesarrollador()

  return (
    <div className={compact ? 'mt-1.5 w-full min-w-0' : 'border-t border-border'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          compact
            ? 'flex w-full min-w-0 items-center gap-1 py-0.5 text-left text-[0.85em] text-muted-foreground/70 hover:text-muted-foreground'
            : 'flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground'
        }
      >
        {compact ? (
          <ChevronRight
            className={cn('size-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90')}
          />
        ) : (
          <ClipboardList className="size-3" />
        )}
        {compact ? `Historial de cambios · ${entries.length}` : `Historial de la IA (${entries.length})`}
        {compact ? null : (
          <ChevronRight
            className={cn('ml-auto size-3 transition-transform duration-150', open && 'rotate-90')}
          />
        )}
      </button>
      {open ? (
        <div className={compact ? 'space-y-1 pl-4' : 'space-y-1 px-2.5 pb-2'}>
          {!compact ? (
            <div className="mb-1 flex gap-1">
              <button
                type="button"
                title="Descargar el historial (útil para soporte)"
                aria-label="Descargar el historial"
                onClick={() => {
                  const blob = new Blob([exportAiDawAuditJson()], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `jaswave-historial-ia-${Date.now()}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="rounded border border-border p-1 text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3" />
              </button>
              <button
                type="button"
                title="Borrar el historial"
                aria-label="Borrar el historial"
                onClick={() => clearAiDawAudit()}
                className="rounded border border-border p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ) : null}
          {entries.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Todavía no hay cambios registrados.</p>
          ) : (
            lista.visibles.map((e) => {
              const msg = textoLegible(e.result?.error, 120) || textoLegible(e.result?.message, 120)
              return (
                <div
                  key={e.id}
                  className="rounded border border-border/50 bg-background/40 px-1.5 py-1 text-[10px] leading-snug text-muted-foreground"
                >
                  <div className="text-foreground/90">
                    {describeActionForUser({ type: e.tool, payload: e.params ?? {} }).label}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground/80">
                    <span>{ESTADO[e.status] ?? 'registrado'}</span>
                    <span>{ORIGEN[e.source] ?? ''}</span>
                    {e.ts ? <span>{hora(e.ts)}</span> : null}
                  </div>
                  {msg ? (
                    <div className={e.result?.success ? 'text-emerald-400/80' : 'text-destructive/80'}>{msg}</div>
                  ) : null}
                  {verTecnico ? (
                    <DetallesTecnicos>
                      {[e.tool, e.status, e.source, e.agentMode, textoTecnico(e.params, 400), e.result?.message ?? '', e.result?.error ?? '']
                        .filter(Boolean)
                        .join('\n')}
                    </DetallesTecnicos>
                  ) : null}
                </div>
              )
            })
          )}
          <BotonVerTodo ocultos={lista.ocultos} todo={lista.todo} onClick={lista.alternar} />
        </div>
      ) : null}
    </div>
  )
}
