import { Fragment, type ReactNode } from 'react'

/**
 * Markdown ligero para el chat del Asistente Jas.
 * Soporta: fences ```, `inline`, **negrita**, *cursiva*, listas -, saltos de línea.
 */
export function ChatMarkdown({ text }: { text: string }) {
  if (!text) return null
  const blocks = splitFences(text)
  return (
    <div className="select-text space-y-2 text-[13px] leading-relaxed">
      {blocks.map((block, i) =>
        block.type === 'code' ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md bg-background/80 px-2.5 py-2 font-mono text-[11px] leading-snug text-foreground ring-1 ring-border"
          >
            <code>{block.content}</code>
          </pre>
        ) : (
          <div key={i} className="space-y-1.5">
            {block.content.split(/\n{2,}/).map((para, j) => (
              <div key={j} className="whitespace-pre-wrap break-words">
                {renderInline(para.trim())}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  )
}

type Block = { type: 'text' | 'code'; content: string; lang?: string }

function splitFences(src: string): Block[] {
  const out: Block[] = []
  const re = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) {
      out.push({ type: 'text', content: src.slice(last, m.index) })
    }
    out.push({ type: 'code', content: m[2]!.replace(/\n$/, ''), lang: m[1] || undefined })
    last = m.index + m[0].length
  }
  if (last < src.length) {
    out.push({ type: 'text', content: src.slice(last) })
  }
  // Fences sin cerrar (streaming): tratar resto como código
  if (out.length === 0) {
    const open = src.match(/```([a-zA-Z0-9_-]*)\n?([\s\S]*)$/)
    if (open && open.index != null) {
      if (open.index > 0) out.push({ type: 'text', content: src.slice(0, open.index) })
      out.push({ type: 'code', content: open[2] ?? '', lang: open[1] || undefined })
      return out
    }
    return [{ type: 'text', content: src }]
  }
  return out
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.includes('|', 1)
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function renderInline(text: string): ReactNode[] {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  let listBuf: Array<{ text: string; checked?: boolean }> = []
  let tableBuf: string[] = []

  const flushList = (keyBase: number) => {
    if (listBuf.length === 0) return
    nodes.push(
      <ul key={`ul-${keyBase}`} className="my-1 list-disc space-y-0.5 pl-4">
        {listBuf.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5">
            {item.checked != null ? (
              <span className={`mt-0.5 inline-block size-3 shrink-0 rounded-sm border ${item.checked ? 'border-accent-amber bg-accent-amber/80' : 'border-muted-foreground/50'}`} />
            ) : null}
            <span>{inlineMarks(item.text)}</span>
          </li>
        ))}
      </ul>,
    )
    listBuf = []
  }

  const flushTable = (keyBase: number) => {
    if (tableBuf.length === 0) return
    const rows = tableBuf.filter((l) => !isTableSep(l)).map(splitTableCells)
    tableBuf = []
    if (rows.length === 0) return
    const head = rows[0]!
    const body = rows.slice(1)
    nodes.push(
      <table key={`tbl-${keyBase}`} className="my-1 w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} className="border border-border bg-background/60 px-1.5 py-0.5 text-left font-medium">
                {inlineMarks(c)}
              </th>
            ))}
          </tr>
        </thead>
        {body.length > 0 ? (
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {row.map((c, ci) => (
                  <td key={ci} className="border border-border px-1.5 py-0.5">
                    {inlineMarks(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : null}
      </table>,
    )
  }

  lines.forEach((line, idx) => {
    if (isTableRow(line)) {
      flushList(idx)
      tableBuf.push(line)
      return
    }
    flushTable(idx)

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushList(idx)
      const level = heading[1]!.length
      const cls =
        level === 1
          ? 'text-[13px] font-semibold text-foreground'
          : level === 2
            ? 'text-[12px] font-semibold text-accent-amber'
            : 'text-[11px] font-medium text-muted-foreground'
      nodes.push(
        <div key={`h-${idx}`} className={cls}>
          {inlineMarks(heading[2]!)}
        </div>,
      )
      return
    }

    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/)
    if (task) {
      listBuf.push({ text: task[2]!, checked: task[1] !== ' ' })
      return
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      listBuf.push({ text: bullet[1]! })
      return
    }

    flushList(idx)
    if (line.trim() === '') {
      nodes.push(<br key={`br-${idx}`} />)
      return
    }
    nodes.push(
      <Fragment key={`ln-${idx}`}>
        {inlineMarks(line)}
        {idx < lines.length - 1 ? '\n' : null}
      </Fragment>,
    )
  })
  flushTable(lines.length)
  flushList(lines.length)
  return nodes
}

function inlineMarks(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  // **bold**, *italic*, `code`
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]!
    if (token.startsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('*')) {
      parts.push(
        <em key={key++} className="italic text-foreground/90">
          {token.slice(1, -1)}
        </em>,
      )
    } else if (token.startsWith('`')) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-background/70 px-1 py-0.5 font-mono text-[11px] ring-1 ring-border"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
