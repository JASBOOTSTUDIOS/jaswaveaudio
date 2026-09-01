import { useEffect, useState } from 'react'
import { ClipboardList, Download, Trash2 } from 'lucide-react'
import {
  clearAiDawAudit,
  exportAiDawAuditJson,
  listAiDawAudit,
  listAiDawAuditForMessage,
  subscribeAiDawAudit,
  type AiDawAuditEntry,
} from '@/src/lib/ai-daw-audit-store'

type Props = {
  messageId?: string
  compact?: boolean
}

export function AiAuditPanel({ messageId, compact }: Props) {
  const [entries, setEntries] = useState<AiDawAuditEntry[]>([])
  const [open, setOpen] = useState(!compact)

  useEffect(() => {
    const refresh = () => {
      setEntries(messageId ? listAiDawAuditForMessage(messageId) : listAiDawAudit(120))
    }
    refresh()
    return subscribeAiDawAudit(refresh)
  }, [messageId])

  if (compact && entries.length === 0) return null

  return (
    <div className={compact ? 'mt-2' : 'border-t border-border'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ClipboardList className="size-3" />
        Auditoría IA ({entries.length})
        <span className="ml-auto text-[9px]">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="max-h-48 space-y-1 overflow-y-auto px-2.5 pb-2">
          {!compact ? (
            <div className="mb-1 flex gap-1">
              <button
                type="button"
                title="Exportar JSON"
                onClick={() => {
                  const blob = new Blob([exportAiDawAuditJson()], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `jaswave-ai-audit-${Date.now()}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="rounded border border-border p-1 text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3" />
              </button>
              <button
                type="button"
                title="Limpiar"
                onClick={() => clearAiDawAudit()}
                className="rounded border border-border p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ) : null}
          {entries.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Sin entradas aún.</p>
          ) : (
            entries.map((e) => (
              <div
                key={e.id}
                className="rounded border border-border/50 bg-background/40 px-1.5 py-1 font-mono text-[9px] leading-snug text-muted-foreground"
              >
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <span className="text-foreground">{e.tool}</span>
                  <span>{e.status}</span>
                  <span>{e.source}</span>
                  <span>{e.agentMode}</span>
                </div>
                <div className="truncate text-muted-foreground/80">{JSON.stringify(e.params).slice(0, 180)}</div>
                {e.result?.message ? (
                  <div className={e.result.success ? 'text-emerald-400/80' : 'text-destructive/80'}>
                    {e.result.message.slice(0, 120)}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
