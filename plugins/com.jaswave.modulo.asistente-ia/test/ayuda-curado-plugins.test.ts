import '../../sdk/host-sdk/pruebas/instalar'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatearErrores, validarFichas, type FichaAyuda } from '@jaswave/host-sdk'
import { fichasGeneradas } from '../src/ayuda/cargador'
import { fichasPlugins } from '../src/ayuda/curado/plugins'
import { fichasConceptos } from '../src/ayuda/curado/conceptos'

const curadas: FichaAyuda[] = [...fichasPlugins, ...fichasConceptos]
const todas: FichaAyuda[] = [...fichasGeneradas().filter((g) => !curadas.some((c) => c.id === g.id)), ...curadas]
const raizPlugins = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('las fichas curadas de plugins y conceptos validan y sus relacionadas existen', () => {
  const errores = validarFichas(todas)
  assert.equal(errores.length, 0, formatearErrores(errores))
  assert.ok(curadas.every((f) => f.fuente === 'curada'))
})

test('todo plugin con jaswave-plugin.json tiene ficha curada', () => {
  const slugs = readdirSync(raizPlugins)
    .filter((d) => d.startsWith('com.jaswave.plugin.') && existsSync(join(raizPlugins, d, 'jaswave-plugin.json')))
    .map((d) => d.slice('com.jaswave.plugin.'.length))
  assert.ok(slugs.length >= 19)
  const faltan = slugs.filter((s) => !fichasPlugins.some((f) => f.id === `plugin:${s}`))
  assert.deepEqual(faltan, [])
  assert.ok(fichasPlugins.some((f) => f.id === 'plugin:sampler'))
})

test('cada plugin explica cómo cargarlo, tiene controles y recetas', () => {
  for (const f of fichasPlugins) {
    assert.ok((f.pasos?.length ?? 0) >= 6, `${f.id}: faltan pasos o recetas`)
    assert.ok((f.controles?.length ?? 0) >= 4, `${f.id}: faltan controles`)
    assert.ok(f.pasos?.some((p) => p.startsWith('Receta')), `${f.id}: sin receta`)
  }
})

test('cada concepto tiene resumen suficiente y alguna relacionada', () => {
  for (const f of fichasConceptos) {
    assert.match(f.id, /^concepto:/)
    assert.ok(f.resumen.length >= 40, `${f.id}: resumen corto`)
    assert.ok((f.relacionadas?.length ?? 0) >= 1, `${f.id}: sin relacionadas`)
  }
  assert.ok(fichasConceptos.length >= 26)
})

test('no menciona el atajo inexistente Ctrl+K', () => {
  assert.ok(!JSON.stringify(curadas).includes('Ctrl+K'))
})
