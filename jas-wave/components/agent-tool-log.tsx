import { useEffect, useState } from 'react'
import { ChevronRight, Terminal } from 'lucide-react'
import {
  listAiDawAuditForMessage,
  subscribeAiDawAudit,
  type AiDawAuditEntry,
} from '@/src/lib/ai-daw-audit-store'
import { cn } from '@/lib/utils'

function formatBody(e: AiDawAuditEntry): string {
  const bits: string[] = []
  if (Object.keys(e.params ?? {}).length) bits.push(JSON.stringify(e.params, null, 2))
  if (e.result?.message) bits.push(e.result.message)
  if (e.result?.error) bits.push(e.result.error)
  return bits.join('\n') || e.status
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
  const body = formatBody(entry)
  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[0.8em] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn('size-3 shrink-0 transition-transform duration-150', open && 'rotate-90')}
        />
        <Terminal className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate font-mono">{entry.tool}</span>
        <span
          className={cn(
            'shrink-0 text-[10px]',
            failed ? 'text-destructive/80' : running ? 'text-accent-amber/80' : 'text-muted-foreground/50',
          )}
        >
          {failed ? 'fail' : running ? 'pendiente' : 'ok'}
        </span>
      </button>
      {open ? (
        <pre className="mb-1 w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-background/50 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
          {body}
        </pre>
      ) : null}
    </div>
  )
}
