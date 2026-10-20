import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createAgentRunStore } from './agent-runs'
import { PathGrants } from './path-grants'

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-runs-'))
  const grants = new PathGrants()
  grants.grant(root, 'readwrite')
  const assertP = (kind: 'read' | 'write') => (p: string) => {
    if (!grants.isAllowed(p, kind)) throw new Error(`denegado ${p}`)
    return p
  }
  const store = createAgentRunStore({ dir: () => path.join(root, 'agent-runs'), assertWrite: assertP('write'), assertRead: assertP('read') })
  return { root, store }
}

test('agent-runs: guarda, carga y lista runs válidos', async () => {
  const { root, store } = setup()
  const run = { id: 'run-1', conversationId: 'c', status: 'waiting-user', updatedAt: 5, userText: 'hola', mode: 'create' }
  assert.deepEqual(await store.save('run-1', JSON.stringify(run)), { ok: true })
  assert.equal(JSON.parse((await store.load('run-1'))!).status, 'waiting-user')
  const list = await store.list(10)
  assert.equal(list.length, 1)
  assert.equal(list[0]!.id, 'run-1')
  assert.equal(await store.remove('run-1'), true)
  assert.equal(await store.load('run-1'), null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('agent-runs: rechaza ids peligrosos, JSON inválido o id que no coincide', async () => {
  const { root, store } = setup()
  assert.equal((await store.save('../evil', '{"id":"../evil"}')).ok, false)
  assert.equal((await store.save('a/b', '{}')).ok, false)
  assert.equal((await store.save('ok', 'no json')).ok, false)
  assert.equal((await store.save('ok', '{"id":"otro"}')).ok, false)
  assert.equal((await store.save('ok', 'x'.repeat(3 * 1024 * 1024))).ok, false)
  assert.equal(await store.load('../../etc'), null)
  assert.equal(fs.existsSync(path.join(root, 'agent-runs', 'ok.json')), false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('agent-runs: fuera de las concesiones no escribe', async () => {
  const grants = new PathGrants()
  const store = createAgentRunStore({
    dir: () => path.join(os.tmpdir(), 'jw-no-grant'),
    assertWrite: (p) => {
      if (!grants.isAllowed(p, 'write')) throw new Error('denegado')
      return p
    },
    assertRead: (p) => p,
  })
  const r = await store.save('x', '{"id":"x"}')
  assert.equal(r.ok, false)
})
