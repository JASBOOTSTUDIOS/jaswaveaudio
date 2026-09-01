/**
 * Diff de líneas simple para comparar documentos Markdown en el chat.
 */

export type DiffLine = {
  type: 'same' | 'add' | 'remove'
  text: string
  /** Número de línea en el archivo anterior (1-based), si aplica */
  oldLine?: number
  /** Número de línea en el archivo nuevo (1-based), si aplica */
  newLine?: number
}

export type DiffStats = { added: number; removed: number; unchanged: number }

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const l of lines) {
    if (l.type === 'add') added += 1
    else if (l.type === 'remove') removed += 1
    else unchanged += 1
  }
  return { added, removed, unchanged }
}

/** Diff unificado por líneas (LCS). */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = normalizeLines(before)
  const b = normalizeLines(after)
  if (a.length === 0 && b.length === 0) return []
  if (a.length === 0) {
    return b.map((text, i) => ({ type: 'add' as const, text, newLine: i + 1 }))
  }
  if (b.length === 0) {
    return a.map((text, i) => ({ type: 'remove' as const, text, oldLine: i + 1 }))
  }

  const lcs = buildLcsTable(a, b)
  const ops = backtrackLcs(a, b, lcs)
  const out: DiffLine[] = []
  let oldIdx = 0
  let newIdx = 0

  for (const op of ops) {
    if (op === 'same') {
      out.push({ type: 'same', text: a[oldIdx]!, oldLine: oldIdx + 1, newLine: newIdx + 1 })
      oldIdx += 1
      newIdx += 1
    } else if (op === 'remove') {
      out.push({ type: 'remove', text: a[oldIdx]!, oldLine: oldIdx + 1 })
      oldIdx += 1
    } else {
      out.push({ type: 'add', text: b[newIdx]!, newLine: newIdx + 1 })
      newIdx += 1
    }
  }
  return out
}

/** Solo líneas que cambiaron (sin contexto idéntico largo). */
export function compactDiffLines(lines: DiffLine[], context = 2): DiffLine[] {
  const changed = new Set<number>()
  lines.forEach((l, i) => {
    if (l.type !== 'same') changed.add(i)
  })
  if (changed.size === 0) return lines.filter((l) => l.type !== 'same').length ? lines : lines.slice(0, 20)

  const keep = new Set<number>()
  for (const i of changed) {
    for (let c = Math.max(0, i - context); c <= Math.min(lines.length - 1, i + context); c++) {
      keep.add(c)
    }
  }
  const sorted = [...keep].sort((x, y) => x - y)
  const out: DiffLine[] = []
  let prev = -2
  for (const i of sorted) {
    if (i > prev + 1) out.push({ type: 'same', text: '…' })
    out.push(lines[i]!)
    prev = i
  }
  return out
}

function normalizeLines(src: string): string[] {
  return src.replace(/\r\n/g, '\n').split('\n')
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
    }
  }
  return dp
}

type LcsOp = 'same' | 'add' | 'remove'

function backtrackLcs(a: string[], b: string[], dp: number[][]): LcsOp[] {
  const ops: LcsOp[] = []
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push('same')
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push('add')
      j -= 1
    } else {
      ops.push('remove')
      i -= 1
    }
  }
  ops.reverse()
  return ops
}
