import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import {
  buscarArchivosPorNombre,
  copiarMediaArchivo,
  moverMediaArchivo,
  nombreArchivoSeguro,
  nombreUnicoEnDir,
  traducirErrorDisco,
} from './media-service'

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jaswave-media-'))
}

describe('media-service', () => {
  it('sanitiza nombres de archivo', () => {
    assert.equal(nombreArchivoSeguro('intro.wav'), 'intro.wav')
    assert.equal(nombreArchivoSeguro('a/b\\c.wav'), 'c.wav')
    assert.equal(nombreArchivoSeguro('mal?.wav'), 'mal_.wav')
    assert.equal(nombreArchivoSeguro(''), 'audio')
  })

  it('genera nombres únicos sin pisar los existentes', async () => {
    const dir = await tempDir()
    await fs.writeFile(path.join(dir, 'intro.wav'), 'x')
    assert.equal(await nombreUnicoEnDir(dir, 'intro.wav'), 'intro (2).wav')
    await fs.writeFile(path.join(dir, 'intro (2).wav'), 'x')
    assert.equal(await nombreUnicoEnDir(dir, 'intro.wav'), 'intro (3).wav')
    assert.equal(await nombreUnicoEnDir(dir, 'otro.wav'), 'otro.wav')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('copia el archivo a la carpeta de destino', async () => {
    const dir = await tempDir()
    const origen = path.join(dir, 'origen.wav')
    const destino = path.join(dir, 'media')
    await fs.writeFile(origen, 'datos')
    const res = await copiarMediaArchivo({ src: origen, destDir: destino })
    assert.equal(res.ok, true)
    assert.equal(res.nombre, 'origen.wav')
    assert.equal(await fs.readFile(res.ruta!, 'utf8'), 'datos')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('mueve el archivo en vez de duplicarlo', async () => {
    const dir = await tempDir()
    const origen = path.join(dir, 'pend.wav')
    const destino = path.join(dir, 'media')
    await fs.writeFile(origen, 'datos')
    const res = await moverMediaArchivo({ src: origen, destDir: destino })
    assert.equal(res.ok, true)
    assert.equal(await fs.readFile(res.ruta!, 'utf8'), 'datos')
    await assert.rejects(fs.access(origen))
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('devuelve un error legible si el origen no existe', async () => {
    const dir = await tempDir()
    const res = await copiarMediaArchivo({ src: path.join(dir, 'nope.wav'), destDir: dir })
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /ya no existe/)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('traduce los errores de disco más comunes', () => {
    assert.match(traducirErrorDisco({ code: 'ENOSPC' }), /espacio en disco/i)
    assert.match(traducirErrorDisco({ code: 'EACCES' }), /permiso/i)
    assert.match(traducirErrorDisco({ code: 'EBUSY' }), /en uso/i)
    assert.match(traducirErrorDisco(new Error('otro')), /otro/)
  })

  it('busca archivos por nombre en subcarpetas', async () => {
    const dir = await tempDir()
    await fs.mkdir(path.join(dir, 'sub', 'deep'), { recursive: true })
    await fs.writeFile(path.join(dir, 'sub', 'deep', 'intro.wav'), 'x')
    const encontrados = await buscarArchivosPorNombre(dir, ['intro.wav', 'no-existe.wav'])
    assert.equal(Object.keys(encontrados).length, 1)
    assert.ok(encontrados['intro.wav']?.endsWith('intro.wav'))
    await fs.rm(dir, { recursive: true, force: true })
  })
})
