/**
 * npx tsx --test electron/plugins/protocolo-modulos.test.ts
 * M3: instalación de un módulo (zip con dist/) desde el catálogo firmado y protocolo jaswave-modulo://,
 * que solo sirve archivos instalados cuyo hash coincide.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { instalarPaquete, type EntradaCatalogo } from './instalador'
import { crearManejadorModulos } from './protocolo-modulos'

const ID = 'com.jaswave.modulo.prueba'
const JS = 'export default { id: "com.jaswave.modulo.prueba" }\n'
const manifiesto = {
  id: ID,
  name: 'Prueba',
  version: '1.0.0',
  category: 'ui-extension',
  targetPlatforms: ['win-x64', 'web'],
  entrypoints: { ui: 'dist/modulo.js', uiEstilos: 'dist/modulo.css' },
  permissions: { realtimeAudio: false, fileSystem: 'none', network: false, commands: [] },
}

const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

describe('M3 — módulos instalables y protocolo jaswave-modulo://', { skip: process.platform !== 'win32' ? 'tar.exe de Windows' : false }, () => {
  let tmp: string
  let servidor: http.Server
  let base: string
  let zip: Buffer

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'jw-mod-'))
    const staging = path.join(tmp, 'staging')
    await mkdir(path.join(staging, 'dist'), { recursive: true })
    await writeFile(path.join(staging, 'jaswave-plugin.json'), JSON.stringify(manifiesto))
    await writeFile(path.join(staging, 'dist', 'modulo.js'), JS)
    await writeFile(path.join(staging, 'dist', 'modulo.css'), '.x{color:red}')
    execFileSync(tar, ['-a', '-c', '-f', path.join(tmp, 'm.zip'), '-C', staging, 'jaswave-plugin.json', 'dist'])
    zip = readFileSync(path.join(tmp, 'm.zip'))
    servidor = http.createServer((_req, res) => res.end(zip))
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  after(async () => {
    await new Promise<void>((r) => servidor.close(() => r()))
    await rm(tmp, { recursive: true, force: true })
  })

  const entrada = (): EntradaCatalogo => ({
    id: ID,
    nombre: 'Prueba',
    version: '1.0.0',
    url: `${base}/m.zip`,
    sha256: createHash('sha256').update(zip).digest('hex'),
    sizeBytes: zip.length,
  })
  const pedir = (manejar: (r: Request) => Promise<Response>, ruta: string) => manejar(new Request(`jaswave-modulo://${ID}/${ruta}`))

  it('instala dist/ y registra el hash de cada archivo; el protocolo lo sirve como JS con CORS', async () => {
    const paquetes = path.join(tmp, 'paquetes')
    const dir = await instalarPaquete(entrada(), { carpetaPaquetes: paquetes, carpetaVst3: path.join(tmp, 'vst3'), alProgreso: () => {} })
    assert.equal(dir, path.join(paquetes, ID))
    const registro = JSON.parse(await readFile(path.join(dir, 'instalacion.json'), 'utf8'))
    assert.equal(registro.archivos['dist/modulo.js'], createHash('sha256').update(JS).digest('hex'))
    const manejar = crearManejadorModulos({ raices: () => [paquetes], admitirSinRegistro: () => false })
    const r = await pedir(manejar, 'dist/modulo.js')
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /javascript/)
    assert.equal(r.headers.get('access-control-allow-origin'), '*')
    assert.equal(await r.text(), JS)
    assert.equal((await pedir(manejar, 'dist/modulo.css')).status, 200)
  })

  it('rechaza archivos alterados, fuera de dist/, de tipos no permitidos o de paquetes que no son módulos', async () => {
    const paquetes = path.join(tmp, 'paquetes')
    const manejar = crearManejadorModulos({ raices: () => [paquetes], admitirSinRegistro: () => false })
    assert.equal((await pedir(manejar, 'jaswave-plugin.json')).status, 404)
    assert.equal((await pedir(manejar, 'dist/../instalacion.json')).status, 404)
    assert.equal((await pedir(manejar, 'dist/x.exe')).status, 404)
    assert.equal((await manejar(new Request('jaswave-modulo://com.jaswave.modulo.otro/dist/modulo.js'))).status, 404)
    await appendFile(path.join(paquetes, ID, 'dist', 'modulo.js'), '\nfetch("https://evil")\n')
    const alterado = await pedir(manejar, 'dist/modulo.js')
    assert.equal(alterado.status, 403)
    // Un archivo añadido después de instalar no está en el registro.
    await writeFile(path.join(paquetes, ID, 'dist', 'extra.js'), 'x')
    assert.equal((await pedir(manejar, 'dist/extra.js')).status, 403)
  })

  it('sin registro de instalación solo se sirve donde se admite (desarrollo)', async () => {
    const dev = path.join(tmp, 'dev')
    await mkdir(path.join(dev, ID, 'dist'), { recursive: true })
    await writeFile(path.join(dev, ID, 'jaswave-plugin.json'), JSON.stringify(manifiesto))
    await writeFile(path.join(dev, ID, 'dist', 'modulo.js'), JS)
    const cerrado = crearManejadorModulos({ raices: () => [dev], admitirSinRegistro: () => false })
    assert.equal((await pedir(cerrado, 'dist/modulo.js')).status, 403)
    const desarrollo = crearManejadorModulos({ raices: () => [dev], admitirSinRegistro: (d) => d.startsWith(dev) })
    assert.equal((await pedir(desarrollo, 'dist/modulo.js')).status, 200)
  })

  it('un paquete VST (sin entrypoints.ui) no se sirve por el protocolo', async () => {
    const raiz = path.join(tmp, 'vst')
    await mkdir(path.join(raiz, ID, 'dist'), { recursive: true })
    await writeFile(path.join(raiz, ID, 'jaswave-plugin.json'), JSON.stringify({ ...manifiesto, entrypoints: { dspDesktop: 'bin/x.vst3' } }))
    await writeFile(path.join(raiz, ID, 'dist', 'modulo.js'), JS)
    const manejar = crearManejadorModulos({ raices: () => [raiz], admitirSinRegistro: () => true })
    assert.equal((await pedir(manejar, 'dist/modulo.js')).status, 404)
  })
})
