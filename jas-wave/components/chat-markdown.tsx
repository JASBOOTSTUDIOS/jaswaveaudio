import { Fragment, type ReactNode } from 'react'

/**
 * Markdown ligero para el chat del Asistente Jas.
 * Soporta: fences ```, `inline`, **negrita**, *cursiva*, #–###### títulos,
 * listas -/* / 1., hr ---, tablas |.
 */

/** Quita bloques de protocolo que el modelo a veces filtra al texto visible. */
export function sanitizeAssistantMarkdown(text: string): string {
  let t = text
  t = t.replace(/<<<INTENT\s*[\s\S]*?\s*INTENT>>>/gi, '')
  t = t.replace(/<<<READ\s*[\s\S]*?\s*(?:READ|WEB)>>>\s*/gi, '')
  t = t.replace(/<<<ACTIONS\s*[\s\S]*?\s*ACTIONS>>>/gi, '')
  t = t.replace(/<<<CLARIFY\s*[\s\S]*?\s*CLARIFY>>>/gi, '')
  t = t.replace(/<<<PLAN\s*[\s\S]*?\s*PLAN>>>/gi, '')
  t = t.replace(/<<<DOC\s*[\s\S]*?\s*DOC>>>/gi, '')
  // Marcadores sueltos / truncados
  t = t.replace(/<<<(?:INTENT|READ|ACTIONS|CLARIFY|PLAN|DOC)\b[\s\S]*?(?:>>>|$)/gi, '')
  t = t.replace(/^\s*Consult[eé]:\s*[^\n]*$/gim, '')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  return t
}

export function ChatMarkdown({ text }: { text: string }) {
  if (!text) return null
  const clean = sanitizeAssistantMarkdown(text)
  if (!clean) return null
  const blocks = splitFences(clean)
  return (
    <div className="chat-md select-text space-y-2 text-[1em] leading-relaxed">
      {blocks.map((block, i) =>
        block.type === 'code' ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md bg-background/80 px-2.5 py-2 font-mono text-[0.85em] leading-snug text-foreground ring-1 ring-border"
          >
            <code>{block.content}</code>
          </pre>
        ) : (
          <div key={i} className="space-y-1.5">
            {block.content.split(/\n{2,}/).map((para, j) => (
              <div key={j} className="whitespace-pre-wrap break-words">
                {renderBlock(para.trim())}
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

function renderBlock(text: string): ReactNode[] {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  let listBuf: Array<{ kind: 'ul' | 'ol'; text: string; checked?: boolean; n?: number }> = []
  let tableBuf: string[] = []

  const flushList = (keyBase: number) => {
    if (listBuf.length === 0) return
    const kind = listBuf[0]!.kind
    const Tag = kind === 'ol' ? 'ol' : 'ul'
    nodes.push(
      <Tag
        key={`list-${keyBase}`}
        className={
          kind === 'ol'
            ? 'my-1 list-decimal space-y-1 pl-5 marker:text-muted-foreground'
            : 'my-1 list-disc space-y-0.5 pl-4'
        }
      >
        {listBuf.map((item, i) => (
          <li
            key={i}
            className={
              item.checked != null
                ? 'flex list-none items-start gap-1.5'
                : 'marker:text-muted-foreground'
            }
          >
            {item.checked != null ? (
              <span
                className={`mt-0.5 inline-block size-3 shrink-0 rounded-sm border ${
                  item.checked ? 'border-accent-amber bg-accent-amber/80' : 'border-muted-foreground/50'
                }`}
              />
            ) : null}
            <span className="min-w-0 flex-1">{inlineMarks(item.text)}</span>
          </li>
        ))}
      </Tag>,
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
      <table key={`tbl-${keyBase}`} className="my-1 w-full border-collapse text-[0.85em]">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th
                key={i}
                className="border border-border bg-background/60 px-1.5 py-0.5 text-left font-medium"
              >
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

    if (/^\s*-{3,}\s*$/.test(line)) {
      flushList(idx)
      nodes.push(<hr key={`hr-${idx}`} className="my-2 border-border/60" />)
      return
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushList(idx)
      const level = heading[1]!.length
      const cls =
        level === 1
          ? 'mb-0.5 mt-1 text-[1.15em] font-semibold text-foreground'
          : level === 2
            ? 'mb-0.5 mt-1 text-[1.08em] font-semibold text-accent-amber'
            : level === 3
              ? 'mb-0.5 mt-1 text-[1.02em] font-semibold text-foreground'
              : 'mb-0.5 mt-1 text-[0.95em] font-medium text-muted-foreground'
      nodes.push(
        <div key={`h-${idx}`} className={cls}>
          {inlineMarks(heading[2]!)}
        </div>,
      )
      return
    }

    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/)
    if (task) {
      if (listBuf.length && listBuf[0]!.kind !== 'ul') flushList(idx)
      listBuf.push({ kind: 'ul', text: task[2]!, checked: task[1] !== ' ' })
      return
    }

    const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/)
    if (numbered) {
      if (listBuf.length && listBuf[0]!.kind !== 'ol') flushList(idx)
      listBuf.push({ kind: 'ol', text: numbered[2]!, n: Number(numbered[1]) })
      return
    }

    const bullet = line.match(/^\s*[-*•]\s+(.+)$/)
    if (bullet) {
      if (listBuf.length && listBuf[0]!.kind !== 'ul') flushList(idx)
      listBuf.push({ kind: 'ul', text: bullet[1]! })
      return
    }

    flushList(idx)
    if (line.trim() === '') {
      nodes.push(<br key={`br-${idx}`} />)
      return
    }
    nodes.push(
      <p key={`p-${idx}`} className="m-0">
        {inlineMarks(line)}
      </p>,
    )
  })
  flushTable(lines.length)
  flushList(lines.length)
  return nodes
}

function inlineMarks(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  // **bold**, *italic*, `code` — también __bold__
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]!
    if (token.startsWith('**') || token.startsWith('__')) {
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
  return parts.length ? parts : [<Fragment key="empty">{text}</Fragment>]
}
