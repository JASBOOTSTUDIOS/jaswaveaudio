import { Fragment, type ReactNode } from 'react'

/**
 * Markdown ligero para el chat del Asistente Jas.
 * Soporta: fences ```, `inline`, **negrita**, *cursiva*, listas -, saltos de línea.
 */
export function ChatMarkdown({ text }: { text: string }) {
  if (!text) return null
  const blocks = splitFences(text)
  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
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
              <p key={j} className="whitespace-pre-wrap break-words">
                {renderInline(para.trim())}
              </p>
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

function renderInline(text: string): ReactNode[] {
  // Listas: líneas que empiezan con - o *
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  let listBuf: string[] = []

  const flushList = (keyBase: number) => {
    if (listBuf.length === 0) return
    nodes.push(
      <ul key={`ul-${keyBase}`} className="my-1 list-disc space-y-0.5 pl-4">
        {listBuf.map((item, i) => (
          <li key={i}>{inlineMarks(item)}</li>
        ))}
      </ul>,
    )
    listBuf = []
  }

  lines.forEach((line, idx) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      listBuf.push(bullet[1]!)
      return
    }
    flushList(idx)
    if (line.trim() === '') {
      nodes.push(<br key={`br-${idx}`} />)
      return
    }
    nodes.push(
      <Fragment key={`ln-${idx}`}>
        {idx > 0 && listBuf.length === 0 ? null : null}
        {inlineMarks(line)}
        {idx < lines.length - 1 ? '\n' : null}
      </Fragment>,
    )
  })
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
