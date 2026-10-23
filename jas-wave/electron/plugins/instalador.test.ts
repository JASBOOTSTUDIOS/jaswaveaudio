/**
 * npx tsx --test electron/plugins/instalador.test.ts
 * Usa el paquete real plugins/dist/com.jaswave.plugin.utility-tool-*.zip (native/scripts/package-plugins.mjs).
 */
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { escanearPaquetes } from './escaner'
import { instalarPaquete, obtenerCatalogo, verificarCatalogo, type EntradaCatalogo, type ProgresoInstalacion } from './instalador'

const dist = path.resolve(__dirname, '../../../plugins/dist')
const zipNombre = existsSync(dist) ? readdirSync(dist).find((f) => /^com\.jaswave\.plugin\.utility-tool-.*\.zip$/.test(f)) : undefined

function firmar(catalogo: object, privada: string): string {
  const payload = Buffer.from(JSON.stringify(catalogo)).toString('base64url')
  return `jwc1.${payload}.${sign(null, Buffer.from(`jwc1.${payload}`), privada).toString('base64url')}`
}

describe('D1 — instalación bajo demanda', { skip: !zipNombre || process.platform !== 'win32' ? 'falta el paquete (package-plugins.mjs)' : false }, () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privada = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publica = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  let servidor: http.Server
  let base: string
  let tmp: string
  const zip = zipNombre ? readFileSync(path.join(dist, zipNombre)) : Buffer.alloc(0)
  const entrada = (): EntradaCatalogo => ({
    id: 'com.jaswave.plugin.utility-tool',
    nombre: 'JasWave Utility & Phase Tool',
    version: zipNombre!.replace(/^.*-(\d+\.\d+\.\d+[^.]*)\.zip$/, '$1'),
    url: `${base}/${zipNombre}`,
    sha256: createHash('sha256').update(zip).digest('hex'),
    sizeBytes: zip.length,
  })

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'jw-inst-'))
    servidor = http.createServer((req, res) => {
      if (req.url === '/catalogo') {
        const catalogo = { generadoEn: new Date().toISOString(), paquetes: [entrada()] }
        res.end(JSON.stringify({ catalogo, token: firmar(catalogo, privada) }))
        return
      }
      if (req.url === `/${zipNombre}`) {
        res.end(zip)
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  after(async () => {
    await new Promise<void>((r) => servidor.close(() => r()))
    await rm(tmp, { recursive: true, force: true })
  })

  it('obtiene el catálogo firmado y rechaza una firma de otra clave', async () => {
    const c = await obtenerCatalogo(base, publica)
    assert.equal(c.paquetes[0]!.id, 'com.jaswave.plugin.utility-tool')
    const otra = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    await assert.rejects(() => obtenerCatalogo(base, otra), /firma/)
    assert.throws(() => verificarCatalogo('jwc1.abc', publica), /formato/)
  })

  it('instala el bundle en la carpeta VST3 y el escáner lo verifica; una manipulación se detecta', async () => {
    const carpetaPaquetes = path.join(tmp, 'paquetes')
    const carpetaVst3 = path.join(tmp, 'VST3', 'JasWave')
    const fases: ProgresoInstalacion['fase'][] = []
    const ruta = await instalarPaquete(entrada(), { carpetaPaquetes, carpetaVst3, alProgreso: (p) => fases.push(p.fase) })
    assert.equal(ruta, path.join(carpetaVst3, 'JasWaveUtility.vst3'))
    assert.deepEqual([...new Set(fases)], ['descargando', 'verificando', 'instalando', 'listo'])

    let [p] = await escanearPaquetes([carpetaPaquetes], [carpetaVst3], carpetaVst3)
    assert.equal(p!.integridad, 'verificada')
    assert.equal(p!.rutaDsp, ruta)

    // Reinstalar (actualización) funciona sobre una instalación existente.
    await instalarPaquete(entrada(), { carpetaPaquetes, carpetaVst3, alProgreso: () => undefined })

    const binario = path.join(ruta, 'Contents', 'x86_64-win', 'JasWaveUtility.vst3')
    await appendFile(binario, Buffer.from('troyano'))
    ;[p] = await escanearPaquetes([carpetaPaquetes], [carpetaVst3], carpetaVst3)
    assert.equal(p!.integridad, 'alterada')
    assert.ok(p!.discrepancias.some((d) => d.startsWith('vst3/JasWaveUtility.vst3/')))
  })

  it('rechaza un paquete cuyo hash o tamaño no coincide con el catálogo, sin instalar nada', async () => {
    const carpetaVst3 = path.join(tmp, 'otro', 'VST3')
    const opciones = { carpetaPaquetes: path.join(tmp, 'otro', 'paquetes'), carpetaVst3, alProgreso: () => undefined }
    await assert.rejects(() => instalarPaquete({ ...entrada(), sha256: 'a'.repeat(64) }, opciones), /SHA-256/)
    await assert.rejects(() => instalarPaquete({ ...entrada(), sizeBytes: 10 }, opciones), /mayor que el anunciado/)
    assert.equal(existsSync(path.join(carpetaVst3, 'JasWaveUtility.vst3')), false)
  })

  it('rechaza un manifiesto que no corresponde a la entrada del catálogo', async () => {
    const opciones = { carpetaPaquetes: path.join(tmp, 'm', 'p'), carpetaVst3: path.join(tmp, 'm', 'v'), alProgreso: () => undefined }
    await assert.rejects(() => instalarPaquete({ ...entrada(), version: '9.9.9' }, opciones), /no corresponde/)
    assert.equal((await readFile(path.join(dist, zipNombre!))).length, zip.length)
  })
})
