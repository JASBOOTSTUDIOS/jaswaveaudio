/**
 * npx tsx --test electron/plugins/clave-catalogo.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createPublicKey } from 'node:crypto'
import { CLAVE_PUBLICA_JASWAVE } from './clave-catalogo'

describe('clave pública del catálogo', () => {
  it('es la misma que usan los VST (plugins/shared-license/keys)', () => {
    const pem = readFileSync(path.resolve(__dirname, '../../../plugins/shared-license/keys/licencia_publica.pem'), 'utf8')
    const exportar = (p: string) => createPublicKey(p).export({ type: 'spki', format: 'der' }).toString('hex')
    assert.equal(exportar(CLAVE_PUBLICA_JASWAVE), exportar(pem))
    assert.equal(createPublicKey(CLAVE_PUBLICA_JASWAVE).asymmetricKeyType, 'ed25519')
  })
})
