import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { crc32, escribirZip, nombreEntradaSeguro } from './zip-writer'

describe('zip-writer', () => {
  it('crc32 de referencia', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  })

  it('rechaza nombres peligrosos', () => {
    assert.throws(() => nombreEntradaSeguro('../x.wav'))
    assert.throws(() => nombreEntradaSeguro('C:/x.wav'))
    assert.equal(nombreEntradaSeguro('media\\Voz 1.wav'), 'media/Voz 1.wav')
  })

  it('escribe un zip que tar puede extraer con texto y archivo binario', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-zip-'))
    try {
      const audio = path.join(dir, 'a.wav')
      const datos = Buffer.alloc(3 * 1024 * 1024 + 17)
      for (let i = 0; i < datos.length; i++) datos[i] = (i * 31) & 255
      await fs.writeFile(audio, datos)
      const zip = path.join(dir, 'p.jaswave.zip')
      await escribirZip(zip, [
        { nombre: 'Canción.jaswave', texto: JSON.stringify({ hola: 'ñandú' }) },
        { nombre: 'media/a.wav', archivo: audio },
      ])
      const out = path.join(dir, 'x')
      await fs.mkdir(out)
      // En Windows, el bsdtar del sistema (lee zip); el tar GNU de Git Bash toma «C:» por un host remoto.
      const tar =
        process.platform === 'win32'
          ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
          : 'tar'
      execFileSync(tar, ['-xf', zip, '-C', out])
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, 'Canción.jaswave'), 'utf8')), { hola: 'ñandú' })
      assert.ok((await fs.readFile(path.join(out, 'media', 'a.wav'))).equals(datos))
      await assert.rejects(fs.stat(`${zip}.parcial`))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('no deja archivos a medias si una entrada falla', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-zip-'))
    try {
      const zip = path.join(dir, 'p.zip')
      await assert.rejects(escribirZip(zip, [{ nombre: 'media/x.wav', archivo: path.join(dir, 'no-existe.wav') }]))
      await assert.rejects(fs.stat(zip))
      await assert.rejects(fs.stat(`${zip}.parcial`))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
