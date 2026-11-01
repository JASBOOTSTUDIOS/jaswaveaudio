import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createMockPlayer, envMockPlayer, parseMockScript, resetEnvMockPlayer } from './ai-mock'
import { createMockPlayer as harnessPlayer, parseMockScript as harnessParse } from '../../ai-harness/src/engine/mock-script'
import { aiChat, aiHealth } from './ai-gateway'

const FIXTURES = path.join(__dirname, '..', '..', 'ai-harness', 'src', 'test', 'fixtures')

test('paridad: el mock de Electron y el de ai-harness responden igual a los mismos guiones', () => {
  const requests = [
    { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hola' }], hasTools: true, purpose: 'agent' },
    { messages: [{ role: 'user', content: 'hola' }, { role: 'tool', content: 'r' }], hasTools: true, purpose: 'agent' },
    { messages: [{ role: 'user', content: 'Resultados de herramientas: x' }], hasTools: false, purpose: 'agent' },
    { messages: [{ role: 'user', content: 'otra' }], hasTools: false, purpose: 'final' },
  ]
  for (const f of fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.json'))) {
    const raw = fs.readFileSync(path.join(FIXTURES, f), 'utf8')
    const a = createMockPlayer(parseMockScript(raw))
    const b = harnessPlayer(harnessParse(raw))
    for (const r of requests) assert.deepEqual(a.next(r), b.next(r), `${f}`)
  }
})

test('JASWAVE_AI_MOCK: aiChat y aiHealth usan el guion sin red', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-mock-'))
  const file = path.join(dir, 'g.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      responses: [
        { when: { purpose: 'agent' }, content: '', toolCalls: [{ name: 'track.list', arguments: {} }] },
        { toolsUnsupported: true },
      ],
      fallback: { content: 'fin' },
    }),
  )
  const prev = process.env.JASWAVE_AI_MOCK
  process.env.JASWAVE_AI_MOCK = file
  resetEnvMockPlayer()
  try {
    const req = { kind: 'openai' as const, model: 'x', baseUrl: '', messages: [{ role: 'user', content: 'hola' }] }
    const h = await aiHealth({ kind: 'openai', baseUrl: '' })
    assert.equal(h.status, 'healthy')
    const r1 = await aiChat({ ...req, meta: { purpose: 'agent' }, tools: [{ name: 'track.list', description: '', parameters: {} }] })
    assert.equal(r1.success, true)
    assert.equal(r1.toolCalls?.[0]?.name, 'track.list')
    assert.equal(r1.httpAttempts, 1)
    const r2 = await aiChat({ ...req, tools: [{ name: 'track.list', description: '', parameters: {} }] })
    assert.equal(r2.toolsUnsupported, true)
    const r3 = await aiChat(req)
    assert.equal(r3.content, 'fin')
    assert.ok(envMockPlayer())
  } finally {
    if (prev === undefined) delete process.env.JASWAVE_AI_MOCK
    else process.env.JASWAVE_AI_MOCK = prev
    resetEnvMockPlayer()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
