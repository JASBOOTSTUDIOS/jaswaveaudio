import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStreamAccumulator } from './ai-stream'

/** Trocea el texto en pedazos irregulares para probar el buffer de líneas. */
function feed(style: Parameters<typeof createStreamAccumulator>[0], body: string, size = 7) {
  const acc = createStreamAccumulator(style)
  const deltas: string[] = []
  for (let i = 0; i < body.length; i += size) {
    const d = acc.push(body.slice(i, i + size))
    if (d) deltas.push(d)
  }
  return { ...acc.finish(), deltas }
}

const sse = (objs: unknown[]) => objs.map((o) => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`).join('')

test('stream OpenAI: texto y tool_calls por deltas', () => {
  const out = feed(
    'openai',
    sse([
      { choices: [{ delta: { content: 'Hola ' } }] },
      { choices: [{ delta: { content: 'mundo' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'track__', arguments: '{"no' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'list', arguments: 'mbre":"x"}' } }] } }] },
      '[DONE]',
    ]),
  )
  assert.equal(out.content, 'Hola mundo')
  assert.equal(out.deltas.join(''), 'Hola mundo')
  assert.deepEqual(out.toolCalls, [{ id: 'c1', name: 'track.list', arguments: { nombre: 'x' } }])
})

test('stream Anthropic: text_delta e input_json_delta', () => {
  const out = feed(
    'anthropic',
    sse([
      { type: 'message_start' },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Voy.' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'project__setBpm' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"bpm":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '96}' } },
      { type: 'message_stop' },
    ]),
  )
  assert.equal(out.content, 'Voy.')
  assert.deepEqual(out.toolCalls, [{ id: 'tu1', name: 'project.setBpm', arguments: { bpm: 96 } }])
})

test('stream Gemini (SSE) y Ollama (NDJSON)', () => {
  const g = feed(
    'gemini',
    sse([
      { candidates: [{ content: { parts: [{ text: 'a' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'b' }, { functionCall: { name: 'track__list', args: {} } }] } }] },
    ]),
  )
  assert.equal(g.content, 'ab')
  assert.deepEqual(g.toolCalls, [{ id: 'gemini_0', name: 'track.list', arguments: {} }])

  const o = feed(
    'ollama',
    [
      JSON.stringify({ message: { content: 'x' }, done: false }),
      JSON.stringify({ message: { content: 'y', tool_calls: [{ function: { name: 'track__list', arguments: { a: 1 } } }] }, done: false }),
      JSON.stringify({ done: true }),
    ].join('\n'),
  )
  assert.equal(o.content, 'xy')
  assert.deepEqual(o.toolCalls, [{ id: 'ollama_0', name: 'track.list', arguments: { a: 1 } }])
})

test('stream: error del proveedor se reporta', () => {
  const out = feed('openai', sse([{ error: { message: 'cuota' } }]))
  assert.equal(out.error, 'cuota')
})
