/**
 * npx tsx --test src/modulos/arranque.test.ts
 * M3 (web): el catálogo firmado se verifica en el navegador (WebCrypto Ed25519) antes de registrar
 * módulos; la clave pública del renderer es la misma que la de los VST y el proceso main.
 */
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { CLAVE_PUBLICA_CATALOGO } from './clave-catalogo'
import { verificarCatalogoWeb } from './arranque'
import { sincronizarModulosCatalogo } from './cargador'
import { listarModulos, reiniciarModulosParaPruebas } from './registro-modulos'

;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publica = publicKey.export({ type: 'spki', format: 'pem' }).toString()
function firmar(catalogo: object, clave = privateKey): string {
  const payload = Buffer.from(JSON.stringify(catalogo)).toString('base64url')
  return `jwc1.${payload}.${sign(null, Buffer.from(`jwc1.${payload}`), clave).toString('base64url')}`
}

const modulo = {
  id: 'com.jaswave.modulo.midi-md',
  nombre: 'MIDI · Markdown',
  version: '1.0.0',
  categoria: 'ui-extension',
  plataformas: ['win-x64', 'web'],
  ui: 'dist/modulo.js',
  uiEstilos: 'dist/modulo.css',
}

describe('M3 — catálogo de módulos en la web', () => {
  beforeEach(() => reiniciarModulosParaPruebas())

  it('la clave del renderer coincide con la de los VST', () => {
    const pem = readFileSync(path.resolve(__dirname, '../../../plugins/shared-license/keys/licencia_publica.pem'), 'utf8')
    const der = (p: string) => createPublicKey(p).export({ type: 'spki', format: 'der' }).toString('hex')
    assert.equal(der(CLAVE_PUBLICA_CATALOGO), der(pem))
  })

  it('acepta un catálogo bien firmado y rechaza otra clave, un payload alterado o un formato inválido', async () => {
    const token = firmar({ paquetes: [modulo] })
    assert.deepEqual((await verificarCatalogoWeb(token, publica)).paquetes, [modulo])
    const otra = generateKeyPairSync('ed25519').privateKey
    await assert.rejects(verificarCatalogoWeb(firmar({ paquetes: [modulo] }, otra), publica), /firma/)
    const [v, , f] = token.split('.')
    const alterado = Buffer.from(JSON.stringify({ paquetes: [{ ...modulo, ui: 'dist/malo.js' }] })).toString('base64url')
    await assert.rejects(verificarCatalogoWeb(`${v}.${alterado}.${f}`, publica), /firma/)
    await assert.rejects(verificarCatalogoWeb('jwt.x.y', publica), /formato/)
  })

  it('registra solo módulos con plataforma web y URLs versionadas del API', () => {
    sincronizarModulosCatalogo('https://api.jaswave.test/', [
      modulo,
      { ...modulo, id: 'com.jaswave.modulo.solo-escritorio', plataformas: ['win-x64'] },
      { id: 'com.jaswave.plugin.param-eq', nombre: 'EQ', version: '1.0.0', categoria: 'audio-effect', plataformas: ['win-x64'] },
    ])
    const ids = listarModulos().map((m) => m.fuente.id)
    assert.deepEqual(ids, ['com.jaswave.modulo.midi-md'])
    assert.equal(listarModulos()[0]!.fuente.origen, 'catalogo')
  })
})
