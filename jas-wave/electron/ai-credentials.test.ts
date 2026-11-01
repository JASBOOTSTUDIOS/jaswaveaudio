import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { AiCredentialStore, type Cipher } from './ai-credentials'

/** Cifrado de prueba reversible (no es seguridad real, solo verifica que no se guarde en claro). */
const fakeCipher = (available = true): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString('utf8'),
})

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jaswave-cred-')), 'ai-credentials.json')
}

describe('AiCredentialStore', () => {
  it('guarda cifrado y recupera tras recargar', () => {
    const file = tmpFile()
    const a = new AiCredentialStore(file, fakeCipher())
    assert.deepEqual(a.set('kilo-1', ' sk-secreta '), { ok: true })
    assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-secreta'))
    const b = new AiCredentialStore(file, fakeCipher())
    assert.equal(b.get('kilo-1'), 'sk-secreta')
    assert.equal(b.has('otro'), false)
  })

  it('borra con key vacía', () => {
    const file = tmpFile()
    const s = new AiCredentialStore(file, fakeCipher())
    s.set('p', 'k')
    s.set('p', '')
    assert.equal(new AiCredentialStore(file, fakeCipher()).has('p'), false)
  })

  it('no guarda si no hay cifrado del sistema', () => {
    const s = new AiCredentialStore(tmpFile(), fakeCipher(false))
    const r = s.set('p', 'k')
    assert.equal(r.ok, false)
    assert.equal(s.has('p'), false)
  })

  it('rechaza providerId inválido', () => {
    const s = new AiCredentialStore(tmpFile(), fakeCipher())
    assert.equal(s.set('../../x', 'k').ok, false)
  })
})
