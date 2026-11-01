import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { AsistenteConfig, rutaConfigValida, slugConfig } from './asistente-config'

describe('carpeta de configuración del asistente', () => {
  let dir: string
  let cfg: AsistenteConfig

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-asistente-'))
    cfg = new AsistenteConfig(dir)
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('solo acepta rutas relativas .md dentro de sus carpetas', () => {
    assert.equal(rutaConfigValida('habilidades/bateria.md'), 'habilidades/bateria.md')
    assert.equal(rutaConfigValida('Prompts\\Intro.md'), 'prompts/intro.md')
    assert.equal(rutaConfigValida('reglas.md'), 'reglas.md')
    for (const mala of ['../x.md', 'habilidades/../../x.md', 'habilidades/x.txt', 'otra/x.md', 'C:/x.md', 'habilidades/.md', '']) {
      assert.equal(rutaConfigValida(mala), null, mala)
    }
    assert.equal(slugConfig('Batería de adoración'), 'bateria-de-adoracion')
  })

  it('crea, lista, edita, elimina a la papelera y restaura', async () => {
    await cfg.escribir('habilidades/bateria.md', '# Batería\n> en temas lentos\nUsa cross-stick.')
    await cfg.escribir('reglas.md', 'Pregúntame antes de cambiar el tempo.')
    let lista = await cfg.listar()
    assert.deepEqual(lista.map((a) => a.ruta), ['reglas.md', 'habilidades/bateria.md'])
    assert.equal(lista[1]!.carpeta, 'habilidades')

    await cfg.escribir('habilidades/bateria.md', '# Batería\nOtra cosa')
    assert.equal(await cfg.leer('habilidades/bateria.md'), '# Batería\nOtra cosa')

    assert.equal(await cfg.eliminar('habilidades/bateria.md'), true)
    assert.equal(await cfg.leer('habilidades/bateria.md'), null)
    assert.equal(await cfg.eliminar('habilidades/bateria.md'), false)
    lista = await cfg.listar()
    assert.deepEqual(lista.map((a) => a.ruta), ['reglas.md'])

    assert.equal(await cfg.restaurar('habilidades/bateria.md'), true)
    assert.equal(await cfg.leer('habilidades/bateria.md'), '# Batería\nOtra cosa')
  })

  it('rechaza rutas fuera de la carpeta y archivos enormes', async () => {
    await assert.rejects(() => cfg.escribir('../fuera.md', 'x'), /no válida/)
    await assert.rejects(() => cfg.escribir('planes/grande.md', 'x'.repeat(70 * 1024)), /demasiado grande/)
  })
})
