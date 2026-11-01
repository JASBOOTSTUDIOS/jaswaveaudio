/**
 * npx tsx --test electron/licencias-locales.test.ts
 * (Windows: usa DPAPI real del usuario actual).
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { dpapi, guardarLicenciaLocal, leerLicenciaLocal, leerTokenDispositivo } from './licencias-locales'

const LICENCIA = `jwl1.${'eyJzdWIiOiJ1In0'.padEnd(40, 'A')}.${'f'.repeat(86)}`
const TOKEN = 'tok_dispositivo-ABCDEFGHIJKLMNOP_1234567890'

describe('licencias locales compartidas con los VST', { skip: process.platform !== 'win32' }, () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'jw-lic-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('DPAPI ida y vuelta; el blob no contiene el token en claro', async () => {
    const blob = await dpapi('Protect', Buffer.from(TOKEN, 'utf8'))
    assert.ok(!blob.toString('latin1').includes(TOKEN))
    assert.equal((await dpapi('Unprotect', blob)).toString('utf8'), TOKEN)
  })

  it('guarda license.jwl en claro (firmada) y device.bin cifrado; se releen', async () => {
    await guardarLicenciaLocal({ token: LICENCIA, tokenDispositivo: TOKEN }, dir)
    assert.equal(await readFile(path.join(dir, 'license.jwl'), 'utf8'), LICENCIA)
    assert.ok(!(await readFile(path.join(dir, 'device.bin'))).toString('latin1').includes(TOKEN))
    assert.equal(await leerLicenciaLocal(dir), LICENCIA)
    assert.equal(await leerTokenDispositivo(dir), TOKEN)
  })

  it('rechaza formatos inválidos y devuelve null si no hay archivos', async () => {
    await assert.rejects(() => guardarLicenciaLocal({ token: 'no-es-licencia', tokenDispositivo: TOKEN }, dir))
    await assert.rejects(() => guardarLicenciaLocal({ token: LICENCIA, tokenDispositivo: 'x y' }, dir))
    const vacio = await mkdtemp(path.join(os.tmpdir(), 'jw-lic-vacio-'))
    assert.equal(await leerTokenDispositivo(vacio), null)
    assert.equal(await leerLicenciaLocal(vacio), null)
    await rm(vacio, { recursive: true, force: true })
  })
})
