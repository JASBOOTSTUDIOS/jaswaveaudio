/**
 * npx tsx --test electron/plugins/instalador.test.ts
 * Paquetes sintéticos (VST3 y módulo) comprimidos con el tar.exe de Windows, como los .jwx reales.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { escanearPaquetes } from './escaner'
import { ARCHIVO_FIRMA, firmarPaquete } from './firma-paquete'
import {
  desinstalarPaquete,
  inspeccionarArchivo,
  instalarArchivo,
  instalarPaquete,
  obtenerCatalogo,
  validarListado,
  verificarCatalogo,
  type EntradaCatalogo,
  type ProgresoInstalacion,
} from './instalador'

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

function firmarCatalogo(catalogo: object, privada: string): string {
  const payload = Buffer.from(JSON.stringify(catalogo)).toString('base64url')
  return `jwc1.${payload}.${sign(null, Buffer.from(`jwc1.${payload}`), privada).toString('base64url')}`
}

type Archivos = Record<string, string | Buffer>

/** Crea la carpeta del paquete, la firma (opcional) y la comprime como .jwx/.zip. */
async function crearPaquete(
  dir: string,
  nombre: string,
  archivos: Archivos,
  firma?: { privada: string; manipular?: (a: Record<string, string>) => void; extra?: Archivos },
): Promise<string> {
  const raiz = path.join(dir, `${nombre}-src`)
  await rm(raiz, { recursive: true, force: true })
  for (const [rel, cont] of Object.entries(archivos)) {
    await mkdir(path.dirname(path.join(raiz, rel)), { recursive: true })
    await writeFile(path.join(raiz, rel), cont)
  }
  if (firma) {
    const m = JSON.parse(String(archivos['jaswave-plugin.json'])) as { id: string; version: string }
    const hashes = Object.fromEntries(Object.entries(archivos).map(([k, v]) => [k, sha(Buffer.from(v))]))
    const f = firmarPaquete(m.id, m.version, hashes, firma.privada)
    firma.manipular?.(f.archivos)
    await writeFile(path.join(raiz, ARCHIVO_FIRMA), JSON.stringify(f))
    for (const [rel, cont] of Object.entries(firma.extra ?? {})) await writeFile(path.join(raiz, rel), cont)
  }
  const salida = path.join(dir, `${nombre}.zip`)
  await rm(salida, { force: true })
  execFileSync(tar, ['-a', '-c', '-f', salida, '-C', raiz, '*'], { windowsHide: true, shell: false, cwd: raiz })
  return salida
}

const manifiestoVst = (version = '1.0.0') =>
  JSON.stringify({ id: 'com.jaswave.plugin.prueba-x1', version, name: 'Prueba X1', description: 'VST de prueba', entrypoints: { dspDesktop: 'bin/PruebaX1.vst3' } })
const archivosVst = (version = '1.0.0'): Archivos => ({
  'jaswave-plugin.json': manifiestoVst(version),
  'vst3/PruebaX1.vst3/Contents/x86_64-win/PruebaX1.vst3': Buffer.from('MZ binario de prueba'),
  'vst3/PruebaX1.vst3/Contents/Resources/moduleinfo.json': '{}',
})
const archivosModulo: Archivos = {
  'jaswave-plugin.json': JSON.stringify({ id: 'com.jaswave.modulo.prueba-x1', version: '2.0.0', name: 'Módulo X1', entrypoints: { ui: 'dist/index.js' } }),
  'dist/index.js': 'export default {}',
  'dist/chunks/a.js': 'export const a = 1',
}

describe('X1 / D1 — instalación de paquetes', { skip: process.platform !== 'win32' || !existsSync(tar) ? 'requiere tar.exe de Windows' : false }, () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privada = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publica = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const otraPrivada = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  let tmp: string
  let servidor: http.Server
  let base: string
  let zipCatalogo: Buffer
  const opciones = (sub: string) => ({
    carpetaPaquetes: path.join(tmp, sub, 'paquetes'),
    carpetaVst3: path.join(tmp, sub, 'VST3', 'JasWave'),
    alProgreso: () => undefined,
    clavesPublicas: [publica],
  })
  const entrada = (): EntradaCatalogo => ({
    id: 'com.jaswave.plugin.prueba-x1',
    nombre: 'Prueba X1',
    version: '1.0.0',
    url: `${base}/paquete.zip`,
    sha256: sha(zipCatalogo),
    sizeBytes: zipCatalogo.length,
  })

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'jw-inst-'))
    zipCatalogo = await readFile(await crearPaquete(tmp, 'catalogo', archivosVst()))
    servidor = http.createServer((req, res) => {
      if (req.url === '/catalogo') {
        const catalogo = { generadoEn: new Date().toISOString(), paquetes: [entrada()] }
        res.end(JSON.stringify({ catalogo, token: firmarCatalogo(catalogo, privada) }))
      } else if (req.url === '/paquete.zip') res.end(zipCatalogo)
      else {
        res.statusCode = 404
        res.end()
      }
    })
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  after(async () => {
    await new Promise<void>((r) => servidor.close(() => r()))
    await rm(tmp, { recursive: true, force: true })
  })

  it('catálogo: firma verificada y una de otra clave rechazada', async () => {
    const c = await obtenerCatalogo(base, publica)
    assert.equal(c.paquetes[0]!.id, 'com.jaswave.plugin.prueba-x1')
    const otra = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    await assert.rejects(() => obtenerCatalogo(base, otra), /firma/)
    assert.throws(() => verificarCatalogo('jwc1.abc', publica), /formato/)
  })

  it('catálogo: instala el bundle, el escáner lo verifica (origen catálogo) y detecta una manipulación', async () => {
    const o = opciones('cat')
    const fases: ProgresoInstalacion['fase'][] = []
    const ruta = await instalarPaquete(entrada(), { ...o, alProgreso: (p) => fases.push(p.fase) })
    assert.equal(ruta, path.join(o.carpetaVst3, 'PruebaX1.vst3'))
    assert.deepEqual([...new Set(fases)], ['descargando', 'verificando', 'instalando', 'listo'])
    let [p] = await escanearPaquetes([o.carpetaPaquetes], [o.carpetaVst3], o.carpetaVst3)
    assert.equal(p!.integridad, 'verificada')
    assert.equal(p!.origen, 'catalogo')
    assert.equal(p!.rutaDsp, ruta)
    await instalarPaquete(entrada(), o) // actualización sobre una instalación existente
    await appendFile(path.join(ruta, 'Contents', 'x86_64-win', 'PruebaX1.vst3'), Buffer.from('troyano'))
    ;[p] = await escanearPaquetes([o.carpetaPaquetes], [o.carpetaVst3], o.carpetaVst3)
    assert.equal(p!.integridad, 'alterada')
  })

  it('catálogo: hash, tamaño o manifiesto que no coinciden se rechazan sin instalar nada', async () => {
    const o = opciones('mal')
    await assert.rejects(() => instalarPaquete({ ...entrada(), sha256: 'a'.repeat(64) }, o), /SHA-256/)
    await assert.rejects(() => instalarPaquete({ ...entrada(), sizeBytes: 10 }, o), /mayor que el anunciado/)
    await assert.rejects(() => instalarPaquete({ ...entrada(), version: '9.9.9' }, o), /no corresponde/)
    assert.equal(existsSync(path.join(o.carpetaVst3, 'PruebaX1.vst3')), false)
  })

  it('.jwx firmado por JasWave: se inspecciona y se instala sin preguntar (origen archivo-firmado)', async () => {
    const o = opciones('firmado')
    const zip = await crearPaquete(tmp, 'firmado', archivosVst('1.1.0'), { privada })
    const jwx = zip.replace(/\.zip$/, '.jwx')
    await writeFile(jwx, await readFile(zip))
    const info = await inspeccionarArchivo(jwx, o)
    assert.deepEqual({ id: info.id, version: info.version, tipo: info.tipo, firma: info.firma }, { id: 'com.jaswave.plugin.prueba-x1', version: '1.1.0', tipo: 'vst3', firma: 'valida' })
    const r = await instalarArchivo(jwx, { modoDesarrollador: false, aceptarSinFirma: false }, o)
    assert.equal(r.ok, true)
    const [p] = await escanearPaquetes([o.carpetaPaquetes], [o.carpetaVst3], o.carpetaVst3)
    assert.equal(p!.origen, 'archivo-firmado')
    assert.equal(p!.integridad, 'verificada')
  })

  it('.jwx con firma de otra clave, archivo extra, archivo alterado o sin firma: no se instala sin modo desarrollador', async () => {
    const o = opciones('rechazos')
    const casos: Array<[string, Parameters<typeof crearPaquete>[3], RegExp]> = [
      ['otra-clave', { privada: otraPrivada }, /no es de JasWave/],
      ['extra', { privada, extra: { 'troyano.js': 'x' } }, /no firmado: troyano\.js/],
      ['alterado', { privada, manipular: (a) => (a['vst3/PruebaX1.vst3/Contents/Resources/moduleinfo.json'] = 'b'.repeat(64)) }, /modificado/],
      ['sin-firma', undefined, /no está firmado/],
    ]
    for (const [nombre, firma, motivo] of casos) {
      const zip = await crearPaquete(tmp, nombre, archivosVst(), firma)
      const jwx = zip.replace(/\.zip$/, '.jwx')
      await writeFile(jwx, await readFile(zip))
      const r = await instalarArchivo(jwx, { modoDesarrollador: false, aceptarSinFirma: false }, o)
      assert.equal(r.ok, false, nombre)
      assert.match((r as { error: string }).error, motivo, nombre)
      assert.match((r as { error: string }).error, /Modo desarrollador/, nombre)
    }
    assert.equal(existsSync(path.join(o.carpetaVst3, 'PruebaX1.vst3')), false)
    assert.equal(existsSync(path.join(o.carpetaPaquetes, 'com.jaswave.plugin.prueba-x1')), false)
  })

  it('sin firma con modo desarrollador: pide confirmación y, aceptada, instala marcado como desarrollo', async () => {
    const o = opciones('dev')
    const zip = await crearPaquete(tmp, 'dev', archivosModulo)
    const jwx = zip.replace(/\.zip$/, '.jwx')
    await writeFile(jwx, await readFile(zip))
    const pide = await instalarArchivo(jwx, { modoDesarrollador: true, aceptarSinFirma: false }, o)
    assert.equal(pide.ok, false)
    assert.equal((pide as { requiereConfirmacion?: boolean }).requiereConfirmacion, true)
    assert.equal(existsSync(path.join(o.carpetaPaquetes, 'com.jaswave.modulo.prueba-x1')), false)
    const r = await instalarArchivo(jwx, { modoDesarrollador: true, aceptarSinFirma: true }, o)
    assert.equal(r.ok, true)
    assert.equal((r as { origen: string }).origen, 'desarrollo')
    const [p] = await escanearPaquetes([o.carpetaPaquetes], [], o.carpetaVst3)
    assert.equal(p!.origen, 'desarrollo')
    assert.equal(p!.integridad, 'verificada')
    assert.ok(existsSync(path.join(o.carpetaPaquetes, 'com.jaswave.modulo.prueba-x1', 'dist', 'chunks', 'a.js')))
  })

  it('rechaza lo que no es un .jwx, rutas peligrosas en el listado y manifiestos inválidos', async () => {
    const o = opciones('raros')
    const txt = path.join(tmp, 'nota.jwx')
    await writeFile(txt, 'no soy un zip')
    await assert.rejects(() => inspeccionarArchivo(txt, o), /no es un paquete/)
    await assert.rejects(() => inspeccionarArchivo(path.join(tmp, 'x.zip'), o), /solo se pueden instalar archivos \.jwx/)
    assert.throws(() => validarListado('ok.txt\n../fuera.txt'), /no permitida/)
    assert.throws(() => validarListado('C:/Windows/x.dll'), /no permitida/)
    assert.throws(() => validarListado('/etc/passwd'), /no permitida/)
    assert.throws(() => validarListado(Array.from({ length: 5001 }, (_, i) => `f${i}`).join('\n')), /demasiados/)
    const malo = await crearPaquete(tmp, 'id-malo', { 'jaswave-plugin.json': JSON.stringify({ id: '../../x', version: '1.0.0' }) })
    const jwx = malo.replace(/\.zip$/, '.jwx')
    await writeFile(jwx, await readFile(malo))
    await assert.rejects(() => inspeccionarArchivo(jwx, o), /id de paquete inválido/)
  })

  it('desinstala carpeta y bundle registrados, sin salir de sus raíces', async () => {
    const o = opciones('baja')
    const zip = await crearPaquete(tmp, 'baja', archivosVst(), { privada })
    const jwx = zip.replace(/\.zip$/, '.jwx')
    await writeFile(jwx, await readFile(zip))
    assert.equal((await instalarArchivo(jwx, { modoDesarrollador: false, aceptarSinFirma: false }, o)).ok, true)
    const testigo = path.join(o.carpetaVst3, 'Otro.vst3')
    await mkdir(testigo, { recursive: true })
    assert.deepEqual(await desinstalarPaquete('com.jaswave.plugin.prueba-x1', o), { bundle: 'PruebaX1.vst3' })
    assert.equal(existsSync(path.join(o.carpetaVst3, 'PruebaX1.vst3')), false)
    assert.equal(existsSync(path.join(o.carpetaPaquetes, 'com.jaswave.plugin.prueba-x1')), false)
    assert.ok(existsSync(testigo))
    await assert.rejects(() => desinstalarPaquete('../..', o), /inválido/)
    await assert.rejects(() => desinstalarPaquete('com.jaswave.plugin.no-esta', o), /no está instalado/)
  })
})
