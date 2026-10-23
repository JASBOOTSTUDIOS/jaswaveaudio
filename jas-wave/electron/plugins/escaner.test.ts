/**
 * npx tsx --test electron/plugins/escaner.test.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { escanearPaquetes, rutaDentroDe } from './escaner'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('P1 — escáner de paquetes', () => {
  let raiz: string
  before(async () => {
    raiz = await mkdtemp(path.join(os.tmpdir(), 'jw-plugins-'))
    // Paquete íntegro
    const ok = path.join(raiz, 'com.jaswave.plugin.ok')
    await mkdir(path.join(ok, 'bin'), { recursive: true })
    await writeFile(path.join(ok, 'bin', 'p.vst3'), 'binario-original')
    await writeFile(path.join(ok, 'jaswave-plugin.json'), JSON.stringify({ id: 'com.jaswave.plugin.ok' }))
    await writeFile(path.join(ok, 'instalacion.json'), JSON.stringify({ version: '1.0.0', archivos: { 'bin/p.vst3': sha('binario-original') } }))
    // Paquete con el binario alterado tras instalar
    const mal = path.join(raiz, 'com.jaswave.plugin.alterado')
    await mkdir(path.join(mal, 'bin'), { recursive: true })
    await writeFile(path.join(mal, 'bin', 'p.vst3'), 'binario-troyano')
    await writeFile(path.join(mal, 'jaswave-plugin.json'), JSON.stringify({ id: 'com.jaswave.plugin.alterado' }))
    await writeFile(path.join(mal, 'instalacion.json'), JSON.stringify({ archivos: { 'bin/p.vst3': sha('binario-original') } }))
    // Registro que intenta verificar algo fuera del paquete
    const fuga = path.join(raiz, 'com.jaswave.plugin.fuga')
    await mkdir(fuga, { recursive: true })
    await writeFile(path.join(fuga, 'jaswave-plugin.json'), '{}')
    await writeFile(path.join(fuga, 'instalacion.json'), JSON.stringify({ archivos: { '../com.jaswave.plugin.ok/bin/p.vst3': sha('binario-original') } }))
    // Sin registro (desarrollo) y manifiesto roto
    const dev = path.join(raiz, 'com.jaswave.plugin.dev')
    await mkdir(dev, { recursive: true })
    await writeFile(path.join(dev, 'jaswave-plugin.json'), '{}')
    const roto = path.join(raiz, 'com.jaswave.plugin.roto')
    await mkdir(roto, { recursive: true })
    await writeFile(path.join(roto, 'jaswave-plugin.json'), '{no json')
    // Carpeta sin manifiesto: se ignora
    await mkdir(path.join(raiz, 'otra-cosa'), { recursive: true })
  })
  after(async () => {
    await rm(raiz, { recursive: true, force: true })
  })

  it('clasifica íntegro, alterado, fuga de ruta, sin registro y manifiesto roto', async () => {
    const r = await escanearPaquetes([raiz, path.join(raiz, 'no-existe')])
    const por = Object.fromEntries(r.map((p) => [path.basename(p.dir), p]))
    assert.equal(Object.keys(por).length, 5)
    assert.equal(por['com.jaswave.plugin.ok']!.integridad, 'verificada')
    assert.equal(por['com.jaswave.plugin.alterado']!.integridad, 'alterada')
    assert.deepEqual(por['com.jaswave.plugin.alterado']!.discrepancias, ['bin/p.vst3'])
    assert.equal(por['com.jaswave.plugin.fuga']!.integridad, 'alterada')
    assert.equal(por['com.jaswave.plugin.dev']!.integridad, 'sin-registro')
    assert.match(por['com.jaswave.plugin.roto']!.errores[0]!, /manifiesto ilegible/)
  })

  it('rutaDentroDe rechaza escapes y rutas absolutas', () => {
    const base = path.join(os.tmpdir(), 'paquete')
    assert.equal(rutaDentroDe(base, '../x'), null)
    assert.equal(rutaDentroDe(base, 'C:\\Windows\\x.dll'), null)
    assert.equal(rutaDentroDe(base, '/etc/passwd'), null)
    assert.equal(rutaDentroDe(base, ''), null)
    assert.equal(rutaDentroDe(base, 'bin/a.vst3'), path.join(base, 'bin', 'a.vst3'))
  })
})
