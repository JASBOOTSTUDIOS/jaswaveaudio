import { useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatDocEdit } from '@/src/lib/chat-doc-edits'
import { openDocFromChat } from '@/src/lib/chat-doc-edits'
import { compactDiffLines, computeLineDiff, diffStats } from '@/src/lib/doc-line-diff'

type Props = {
  edits: ChatDocEdit[]
}

export function DocEditCards({ edits }: Props) {
  if (!edits.length) return null
  return (
    <div className="mt-2 space-y-1.5">
      {edits.map((edit) => (
        <DocEditCard key={`${edit.slug}-${edit.updatedAt}`} edit={edit} />
      ))}
    </div>
  )
}

function DocEditCard({ edit }: { edit: ChatDocEdit }) {
  const [open, setOpen] = useState(false)
  const diffLines = useMemo(
    () => compactDiffLines(computeLineDiff(edit.previousContent, edit.newContent), 2),
    [edit.previousContent, edit.newContent],
  )
  const stats = useMemo(() => diffStats(computeLineDiff(edit.previousContent, edit.newContent)), [edit.previousContent, edit.newContent])
  const actionLabel =
    edit.action === 'create' ? 'creado' : edit.action === 'append' ? 'ampliado' : 'actualizado'

  return (
    <div className="mt-1.5 w-full min-w-0">
      <div className="flex w-full min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-[0.85em] text-muted-foreground/70 hover:text-muted-foreground"
        >
          <FileText className="size-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 truncate font-mono">{edit.slug}</span>
          <span className="shrink-0">· {actionLabel}</span>
          {(stats.added > 0 || stats.removed > 0) && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
              {stats.added > 0 ? `+${stats.added}` : ''}
              {stats.added > 0 && stats.removed > 0 ? ' ' : ''}
              {stats.removed > 0 ? `−${stats.removed}` : ''}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => openDocFromChat(edit.slug, 'preview')}
          className="shrink-0 text-[0.8em] text-muted-foreground/70 hover:text-foreground"
          title="Abrir documento"
        >
          Ver
        </button>
      </div>
      {open ? (
        <div className="max-h-56 overflow-auto pl-4 font-mono text-[10px] leading-relaxed select-text">
          {edit.action === 'create' && !edit.previousContent.trim() ? (
            <div className="py-1 text-muted-foreground">Documento nuevo</div>
          ) : null}
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all py-px',
                line.text === '…' && 'text-muted-foreground/70 italic',
                line.type === 'add' && 'text-foreground/80',
                line.type === 'remove' && 'text-destructive/70 line-through',
                line.type === 'same' && line.text !== '…' && 'text-muted-foreground/70',
              )}
            >
              <span className="mr-2 inline-block w-4 shrink-0 select-none text-muted-foreground/50">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
              </span>
              {line.text || ' '}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
