/**
 * Acumuladores de streaming por proveedor (A2). Puros: reciben trozos de texto del body HTTP
 * (SSE o NDJSON) y producen deltas de texto + resultado final (texto y tool calls).
 */

import { decodeToolName, type AiToolCall } from './ai-tools'

export type StreamStyle = 'openai' | 'anthropic' | 'gemini' | 'ollama'

export type StreamAccumulator = {
  /** Procesa un trozo crudo; devuelve el texto nuevo (delta) que trajo. */
  push(chunk: string): string
  /** Cierra (procesa el resto del buffer) y devuelve lo acumulado. */
  finish(): { content: string; toolCalls: AiToolCall[]; error?: string }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function parseArgsText(s: string): Record<string, unknown> {
  const v = safeJson(s || '{}')
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : s ? { __raw: s } : {}
}

export function createStreamAccumulator(style: StreamStyle): StreamAccumulator {
  let buf = ''
  let content = ''
  let error: string | undefined
  // openai: por índice; anthropic: por índice de bloque
  const partial = new Map<number, { id: string; name: string; args: string }>()
  const direct: AiToolCall[] = []

  const handlePayload = (data: unknown): string => {
    if (!data || typeof data !== 'object') return ''
    const d = data as Record<string, any>
    if (d.error) {
      error = typeof d.error === 'string' ? d.error : String(d.error?.message ?? 'error de streaming')
      return ''
    }
    let delta = ''
    if (style === 'openai') {
      const ch = d.choices?.[0]?.delta
      if (typeof ch?.content === 'string') delta = ch.content
      for (const tc of ch?.tool_calls ?? []) {
        const idx = Number(tc.index ?? 0)
        const cur = partial.get(idx) ?? { id: '', name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        partial.set(idx, cur)
      }
    } else if (style === 'anthropic') {
      if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
        partial.set(Number(d.index ?? 0), { id: d.content_block.id ?? '', name: d.content_block.name ?? '', args: '' })
      } else if (d.type === 'content_block_delta') {
        if (d.delta?.type === 'text_delta') delta = String(d.delta.text ?? '')
        if (d.delta?.type === 'input_json_delta') {
          const cur = partial.get(Number(d.index ?? 0))
          if (cur) cur.args += String(d.delta.partial_json ?? '')
        }
      }
    } else if (style === 'gemini') {
      for (const p of d.candidates?.[0]?.content?.parts ?? []) {
        if (typeof p.text === 'string') delta += p.text
        if (p.functionCall?.name) {
          direct.push({ id: `gemini_${direct.length}`, name: decodeToolName(p.functionCall.name), arguments: (p.functionCall.args ?? {}) as Record<string, unknown> })
        }
      }
    } else {
      const m = d.message
      if (typeof m?.content === 'string') delta = m.content
      for (const tc of m?.tool_calls ?? []) {
        if (tc.function?.name) {
          const args = tc.function.arguments
          direct.push({
            id: `ollama_${direct.length}`,
            name: decodeToolName(tc.function.name),
            arguments: typeof args === 'string' ? parseArgsText(args) : ((args ?? {}) as Record<string, unknown>),
          })
        }
      }
    }
    content += delta
    return delta
  }

  const handleLine = (line: string): string => {
    const t = line.trim()
    if (!t) return ''
    if (style === 'ollama') return handlePayload(safeJson(t))
    if (!t.startsWith('data:')) return ''
    const payload = t.slice(5).trim()
    if (!payload || payload === '[DONE]') return ''
    return handlePayload(safeJson(payload))
  }

  return {
    push(chunk) {
      buf += chunk
      let out = ''
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        out += handleLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        nl = buf.indexOf('\n')
      }
      return out
    },
    finish() {
      if (buf.trim()) handleLine(buf)
      buf = ''
      const fromPartial = [...partial.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([, c]) => c.name)
        .map(([i, c]) => ({ id: c.id || `call_${i}`, name: decodeToolName(c.name), arguments: parseArgsText(c.args) }))
      return { content, toolCalls: [...fromPartial, ...direct], error }
    },
  }
}
