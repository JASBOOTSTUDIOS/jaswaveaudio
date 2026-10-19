import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkBridgeRequest, shouldStartAgentBridge } from './agent-bridge-auth'

const base = {
  method: 'GET',
  pathname: '/state',
  port: 18787,
  token: 'secreto-123',
}

describe('agent-bridge-auth', () => {
  it('rechaza peticiones de navegador (Origin) aunque traigan token', () => {
    const r = checkBridgeRequest({
      ...base,
      headers: { host: '127.0.0.1:18787', origin: 'https://evil.example', authorization: 'Bearer secreto-123' },
    })
    assert.equal(r.ok, false)
    assert.equal(r.ok ? 0 : r.status, 403)
  })

  it('rechaza preflight OPTIONS', () => {
    const r = checkBridgeRequest({ ...base, method: 'OPTIONS', headers: { host: '127.0.0.1:18787' } })
    assert.equal(r.ok, false)
  })

  it('rechaza Host distinto (DNS rebinding)', () => {
    const r = checkBridgeRequest({
      ...base,
      headers: { host: 'attacker.example:18787', authorization: 'Bearer secreto-123' },
    })
    assert.equal(r.ok ? 0 : r.status, 403)
  })

  it('exige token salvo en /health', () => {
    assert.equal(checkBridgeRequest({ ...base, headers: { host: '127.0.0.1:18787' } }).ok, false)
    assert.equal(
      checkBridgeRequest({ ...base, pathname: '/health', headers: { host: 'localhost:18787' } }).ok,
      true,
    )
    assert.equal(
      checkBridgeRequest({
        ...base,
        headers: { host: '127.0.0.1:18787', authorization: 'Bearer otro' },
      }).ok,
      false,
    )
  })

  it('acepta token correcto y exige JSON en POST', () => {
    const headers = { host: '127.0.0.1:18787', authorization: 'Bearer secreto-123' }
    assert.equal(checkBridgeRequest({ ...base, headers }).ok, true)
    const post = checkBridgeRequest({ ...base, method: 'POST', pathname: '/actions', headers })
    assert.equal(post.ok ? 0 : post.status, 415)
    assert.equal(
      checkBridgeRequest({
        ...base,
        method: 'POST',
        pathname: '/actions',
        headers: { ...headers, 'content-type': 'application/json' },
      }).ok,
      true,
    )
  })

  it('no arranca en la app empaquetada salvo opt-in', () => {
    assert.equal(shouldStartAgentBridge({ isPackaged: true, env: {}, settingEnabled: false }), false)
    assert.equal(shouldStartAgentBridge({ isPackaged: true, env: { JASWAVE_AGENT_BRIDGE: '1' }, settingEnabled: false }), true)
    assert.equal(shouldStartAgentBridge({ isPackaged: true, env: {}, settingEnabled: true }), true)
    assert.equal(shouldStartAgentBridge({ isPackaged: false, env: {}, settingEnabled: false }), true)
    assert.equal(shouldStartAgentBridge({ isPackaged: false, env: { JASWAVE_AGENT_BRIDGE: '0' }, settingEnabled: false }), false)
  })
})
