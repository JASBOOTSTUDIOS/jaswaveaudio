/**
 * U-maestra F2: la base de ayuda generada está sincronizada con el código.
 * Si falla, el mensaje dice qué falta. Para regenerar: `npm run ayuda:generar` (desde jas-wave/).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { buscarAyuda, validarFicha, validarFichas, formatearErrores } from '@jaswave/host-sdk'
// @ts-expect-error módulo .mjs sin tipos
import * as gen from '../../../jas-wave/scripts/generar-ayuda.mjs'
import { listarPantallasAbribles, resolverPantalla } from '../../../jas-wave/src/lib/abrir-pantalla'
import { TOOL_CATALOG } from '../../../jas-wave/src/workspace/types'
import { cargarAyuda, construirBaseAyuda, fusionarFichas } from '../src/ayuda/cargador'

const REGENERAR = 'Regenera con: npm run ayuda:generar (desde jas-wave/) y vuelve a ejecutar.'
const ids = () => new Set(cargarAyuda().fichas.map((f) => f.id))

function falta(que: string[]): string {
  return `Faltan fichas de ayuda para:\n  - ${que.join('\n  - ')}\n${REGENERAR}`
}

describe('ayuda generada', () => {
  it('es determinista: dos generaciones dan el mismo JSON', () => {
    assert.equal(gen.serializar(gen.generarAyuda()), gen.serializar(gen.generarAyuda()))
  })

  it('el JSON versionado coincide con lo que se generaría ahora', () => {
    const versionado = readFileSync(gen.RUTA_SALIDA, 'utf8').replace(/\r\n/g, '\n')
    assert.equal(versionado, gen.serializar(gen.generarAyuda()), `El JSON versionado está desactualizado. ${REGENERAR}`)
  })

  it('lleva cabecera de generado y huella de las fuentes', () => {
    const d = JSON.parse(readFileSync(gen.RUTA_SALIDA, 'utf8'))
    assert.match(d._aviso, /NO EDITAR A MANO/)
    assert.match(d.huellaFuentes, /^[0-9a-f]{64}$/)
  })

  it('todas las fichas (generadas + curadas) validan y el índice se construye', () => {
    const b = construirBaseAyuda()
    assert.equal(b.errores.length, 0, formatearErrores(b.errores))
    assert.ok(buscarAyuda(b.indice, 'mixer').length > 0)
  })

  it('comoAbrir.herramienta apunta a ids que abrirPantalla acepta', () => {
    for (const f of cargarAyuda().fichas) {
      const h = f.comoAbrir?.herramienta
      if (h) assert.ok(resolverPantalla(h), `${f.id}: comoAbrir.herramienta «${h}» no lo acepta abrirPantalla`)
    }
  })

  it('no hay ficha generada sin descripción rellenada con suposiciones: se marca «sin descripción»', () => {
    for (const f of cargarAyuda().fichas) assert.ok(f.resumen.trim().length > 0, f.id)
  })

  it('las curadas ganan a las generadas con el mismo id', () => {
    const g = cargarAyuda().fichas.find((f) => f.id === 'panel:mixer')!
    const c = { ...g, resumen: 'curada', fuente: 'curada' as const }
    const r = fusionarFichas([g], [c])
    assert.equal(r.length, 1)
    assert.equal(r[0].resumen, 'curada')
    assert.equal(validarFicha(r[0]).length, 0)
  })
})

describe('sincronía con el código', () => {
  it('toda herramienta del catálogo (núcleo y módulos) tiene ficha panel:<id>', () => {
    const tengo = ids()
    const requeridas = [...Object.keys(TOOL_CATALOG), ...gen.leerHerramientasModulos().map((h: { id: string }) => h.id)]
    const sin = [...new Set<string>(requeridas)].filter((id) => !tengo.has(`panel:${id}`)).map((id) => `panel:${id} (herramienta «${id}» del catálogo)`)
    assert.deepEqual(sin, [], falta(sin))
  })

  it('todo id abrible tiene ficha', () => {
    const tengo = ids()
    const sin = listarPantallasAbribles()
      .map((id) => (id.startsWith('dlg.') ? `pantalla:${id.slice(4)}` : `panel:${id}`))
      .filter((f) => !tengo.has(f))
      .map((f) => `${f} (id abrible en abrir-pantalla.ts)`)
    assert.deepEqual(sin, [], falta(sin))
  })

  it('todo plugin con jaswave-plugin.json tiene ficha plugin:<nombre>', () => {
    const tengo = ids()
    const dir = join(gen.RAIZ, 'plugins')
    const sin = readdirSync(dir)
      .filter((n) => n.startsWith('com.jaswave.plugin.') && existsSync(join(dir, n, 'jaswave-plugin.json')))
      .map((n) => `plugin:${n.slice('com.jaswave.plugin.'.length)}`)
      .filter((f) => !tengo.has(f))
      .map((f) => `${f} (hay jaswave-plugin.json)`)
    assert.deepEqual(sin, [], falta(sin))
  })
})
