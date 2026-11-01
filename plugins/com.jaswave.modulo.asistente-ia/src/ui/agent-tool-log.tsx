import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Wrench } from 'lucide-react'
import { cn, listAiDawAuditForMessage, subscribeAiDawAudit } from '@jaswave/host-sdk'
import type { AiDawAuditEntry } from '@jaswave/host-sdk'
import { describeActionForUser, tituloHerramientaParaUsuario } from '../motor/describe-action'
import { colapsarConsecutivos, textoAcciones } from './actividad-agrupada'
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

function haFallado(e: AiDawAuditEntry): boolean {
  const pendiente = e.result?.message === 'Pendiente de Aplicar'
  return e.status === 'failed' || (e.result?.success === false && !pendiente && e.status !== 'proposed')
}

function estaEnCurso(e: AiDawAuditEntry): boolean {
  return e.status === 'proposed' || e.status === 'pending_confirm' || e.result?.message === 'Pendiente de Aplicar'
}

/** Con pocas tarjetas se ven todas; a partir de aquí se agrupan bajo un resumen cerrado. */
const UMBRAL_RESUMEN = 4

/**
 * Registro de herramientas de un mensaje. Las llamadas consecutivas iguales se funden en una con contador
 * («Revisar las notas ×87»); los fallos siempre quedan a la vista; con muchas tarjetas el resto va bajo un
 * resumen cerrado, con el detalle limitado en altura y con desplazamiento.
 */
export function AgentToolLog({ entries }: { entries: AiDawAuditEntry[] }) {
  const [abierto, setAbierto] = useState(false)
  const grupos = useMemo(
    () =>
      colapsarConsecutivos(
        entries,
        (e) => `${tituloEntrada(e)}|${haFallado(e) ? 'x' : estaEnCurso(e) ? 'p' : e.status === 'rejected' ? 'o' : 'ok'}`,
        haFallado,
      ),
    [entries],
  )
  if (!entries.length) return null
  const fallos = grupos.filter((g) => haFallado(g.items[0]!))
  const normales = grupos.filter((g) => !haFallado(g.items[0]!))
  const resumir = grupos.length > UMBRAL_RESUMEN
  const enCurso = entries.filter(estaEnCurso)
  const totalNormales = normales.reduce((n, g) => n + g.veces, 0)
  const fila = (g: (typeof grupos)[number]) => <AgentToolRow key={g.items[0]!.id} entry={g.items[0]!} veces={g.veces} />
  return (
    <div data-testid="agent-tool-log" className="mt-1.5 w-full min-w-0 space-y-0.5">
      {resumir ? (
        <>
          {fallos.map(fila)}
          <button
            type="button"
            aria-expanded={abierto}
            onClick={() => setAbierto((o) => !o)}
            className="flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[0.8em] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-150', abierto && 'rotate-90')} />
            <Wrench className="size-3 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">
              {textoAcciones(totalNormales)}
              {enCurso.length ? ` · ahora: ${tituloEntrada(enCurso.at(-1)!)}` : ''}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground/60">{abierto ? 'ocultar' : 'ver detalle'}</span>
          </button>
          {abierto ? (
            <div className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border border-border/40 bg-panel-base/40 px-1.5 py-1">
              {normales.map(fila)}
            </div>
          ) : null}
        </>
      ) : (
        grupos.map(fila)
      )}
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
  veces = 1,
}: {
  entry: AiDawAuditEntry
  defaultOpen?: boolean
  /** Llamadas consecutivas iguales que esta fila representa. */
  veces?: number
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
        <span className="min-w-0 flex-1 break-words">
          {titulo}
          {veces > 1 ? <span className="ml-1 tabular-nums text-muted-foreground/70">×{veces}</span> : null}
        </span>
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
