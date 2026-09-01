import { useMemo, useState } from 'react'
import { ExternalLink, FileText, GitCompare } from 'lucide-react'
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
    <div className="overflow-hidden rounded-md border border-sky-900/40 bg-sky-950/15">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <FileText className="size-3.5 shrink-0 text-sky-400" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left text-[11px] font-medium text-sky-200 hover:text-sky-100"
          title="Ver cambios en el documento"
        >
          <span className="font-mono">{edit.slug}</span>
          <span className="ml-1.5 font-normal text-muted-foreground">· {actionLabel}</span>
          {(stats.added > 0 || stats.removed > 0) && (
            <span className="ml-1.5 font-mono text-[10px]">
              {stats.added > 0 ? <span className="text-emerald-400">+{stats.added}</span> : null}
              {stats.added > 0 && stats.removed > 0 ? ' ' : null}
              {stats.removed > 0 ? <span className="text-red-400">−{stats.removed}</span> : null}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => openDocFromChat(edit.slug, 'edit')}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-900/30 hover:text-sky-100"
          title="Abrir documento en el editor"
        >
          <ExternalLink className="size-3" />
          Ver documento
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded p-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          aria-label={open ? 'Ocultar diff' : 'Mostrar diff'}
        >
          <GitCompare className="size-3" />
        </button>
      </div>
      {open ? (
        <div className="max-h-56 overflow-auto border-t border-sky-900/30 bg-black/30 font-mono text-[10px] leading-relaxed select-text">
          {edit.action === 'create' && !edit.previousContent.trim() ? (
            <div className="px-2 py-1 text-[10px] text-muted-foreground">Documento nuevo</div>
          ) : null}
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all px-2 py-px',
                line.text === '…' && 'text-muted-foreground/70 italic',
                line.type === 'add' && 'bg-emerald-950/50 text-emerald-200',
                line.type === 'remove' && 'bg-red-950/40 text-red-300 line-through decoration-red-400/60',
                line.type === 'same' && line.text !== '…' && 'text-muted-foreground/80',
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
