import { useEffect, useState } from 'react'
import { ChevronRight, Wrench } from 'lucide-react'
import { cn, listAiDawAuditForMessage, subscribeAiDawAudit } from '@jaswave/host-sdk'
import type { AiDawAuditEntry } from '@jaswave/host-sdk'
import { describeActionForUser, tituloHerramientaParaUsuario } from '../motor/describe-action'
import { DetallesTecnicos, modoDesarrollador, textoLegible, textoTecnico } from './detalles-tecnicos'

function tituloEntrada(e: AiDawAuditEntry): string {
  const label = describeActionForUser({ type: e.tool, payload: e.params ?? {} }).label
  return label || tituloHerramientaParaUsuario(e.tool)
}

function estadoEntrada(e: AiDawAuditEntry, failed: boolean, running: boolean): string {
  if (failed) return 'no se pudo'
  if (e.status === 'rejected') return 'omitido'
  if (running) return 'pendiente'
  return 'hecho'
}

export function AgentToolLog({ entries }: { entries: AiDawAuditEntry[] }) {
  if (!entries.length) return null
  return (
    <div className="mt-1.5 w-full min-w-0 space-y-0.5">
      {entries.map((e) => (
        <AgentToolRow key={e.id} entry={e} />
      ))}
    </div>
  )
}

export function AgentMessageToolLog({ messageId }: { messageId: string }) {
  const [entries, setEntries] = useState<AiDawAuditEntry[]>(() => listAiDawAuditForMessage(messageId))
  useEffect(() => {
    const refresh = () => setEntries(listAiDawAuditForMessage(messageId))
    refresh()
    return subscribeAiDawAudit(refresh)
  }, [messageId])
  return <AgentToolLog entries={entries} />
}

export function AgentToolRow({
  entry,
  defaultOpen,
}: {
  entry: AiDawAuditEntry
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const pendingMsg = entry.result?.message === 'Pendiente de Aplicar'
  const failed =
    entry.status === 'failed' ||
    (entry.result?.success === false && !pendingMsg && entry.status !== 'proposed')
  const running =
    entry.status === 'proposed' || entry.status === 'pending_confirm' || pendingMsg
  const titulo = tituloEntrada(entry)
  const resultado =
    textoLegible(entry.result?.error) ||
    (pendingMsg ? '' : textoLegible(entry.result?.message)) ||
    (failed ? 'No se pudo completar este paso.' : '')
  const verTecnico = modoDesarrollador()
  const expandible = Boolean(resultado) || verTecnico
  const tecnico = [
    entry.tool,
    textoTecnico(entry.params ?? {}, 800),
    entry.result?.message ?? '',
    entry.result?.error ?? '',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => expandible && setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[0.8em] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
            !expandible && 'opacity-0',
          )}
        />
        <Wrench className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 break-words">{titulo}</span>
        <span
          className={cn(
            'shrink-0 text-[10px]',
            failed ? 'text-destructive/80' : running ? 'text-accent-amber/80' : 'text-muted-foreground/50',
          )}
        >
          {estadoEntrada(entry, failed, running)}
        </span>
      </button>
      {open && expandible ? (
        <div className="mb-1 w-full min-w-0 pl-6 text-[11px] leading-snug text-muted-foreground">
          {resultado ? <p className="whitespace-pre-wrap break-words">{resultado}</p> : null}
          <DetallesTecnicos>{tecnico}</DetallesTecnicos>
        </div>
      ) : null}
    </div>
  )
}
