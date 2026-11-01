import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anclar,
  conProyecto,
  crearPin,
  desanclar,
  mover,
  moverA,
  ordenDeAplicacion,
  parsearPersistido,
  persistidoVacio,
  purgar,
  serializarPersistido,
} from './pins-jerarquia'

const ed = (id: string) => crearPin('editor', id, `Plugin ${id}`)
const pn = (id: string) => crearPin('panel', id, `Panel ${id}`)
const claves = (l: readonly { clave: string }[]) => l.map((p) => p.clave)

test('anclar añade al final y es idempotente (conserva el índice)', () => {
  let l = anclar([], ed('a'))
  l = anclar(l, pn('mixer'))
  l = anclar(l, ed('c'))
  assert.deepEqual(claves(l), ['editor:a', 'panel:mixer', 'editor:c'])
  const l2 = anclar(l, ed('a'))
  assert.deepEqual(claves(l2), claves(l))
})

test('desanclar quita y compacta los índices', () => {
  const l = [ed('a'), ed('b'), ed('c')]
  const r = desanclar(l, 'editor:b')
  assert.deepEqual(claves(r), ['editor:a', 'editor:c'])
  assert.equal(r.findIndex((p) => p.clave === 'editor:c'), 1)
  assert.deepEqual(claves(desanclar(l, 'editor:zzz')), claves(l))
})

test('mover sube/baja y se acota a los extremos', () => {
  const l = [ed('a'), ed('b'), ed('c')]
  assert.deepEqual(claves(mover(l, 'editor:c', -1)), ['editor:a', 'editor:c', 'editor:b'])
  assert.deepEqual(claves(mover(l, 'editor:a', -1)), ['editor:a', 'editor:b', 'editor:c'])
  assert.deepEqual(claves(mover(l, 'editor:c', 1)), ['editor:a', 'editor:b', 'editor:c'])
  assert.deepEqual(claves(mover(l, 'editor:a', 5)), ['editor:b', 'editor:c', 'editor:a'])
  assert.deepEqual(claves(mover(l, 'editor:nope', 1)), claves(l))
})

test('moverA coloca en un índice concreto y no muta la entrada', () => {
  const l = [ed('a'), ed('b'), ed('c')]
  assert.deepEqual(claves(moverA(l, 'editor:c', 0)), ['editor:c', 'editor:a', 'editor:b'])
  assert.deepEqual(claves(moverA(l, 'editor:a', 99)), ['editor:b', 'editor:c', 'editor:a'])
  assert.deepEqual(claves(l), ['editor:a', 'editor:b', 'editor:c'])
})

test('purgar elimina los anclados cuyo slot ya no existe', () => {
  const l = [ed('a'), pn('mixer'), ed('c')]
  const r = purgar(l, (p) => p.tipo === 'panel' || p.id !== 'a')
  assert.deepEqual(claves(r), ['panel:mixer', 'editor:c'])
})

test('ordenDeAplicacion deja el índice 0 como último (queda encima)', () => {
  const l = [ed('a'), ed('b'), ed('c')]
  assert.deepEqual(claves(ordenDeAplicacion(l)), ['editor:c', 'editor:b', 'editor:a'])
})

test('persistir y restaurar por proyecto conserva el orden', () => {
  let p = persistidoVacio()
  p = conProyecto(p, 'proy-1', [ed('a'), pn('mixer'), ed('c')])
  p = conProyecto(p, 'proy-2', [ed('z')])
  const vuelta = parsearPersistido(serializarPersistido(p))
  assert.deepEqual(claves(vuelta.proyectos['proy-1']!), ['editor:a', 'panel:mixer', 'editor:c'])
  assert.deepEqual(claves(vuelta.proyectos['proy-2']!), ['editor:z'])
  assert.equal(vuelta.proyectos['proy-1']![0]!.etiqueta, 'Plugin a')
  const sin = conProyecto(vuelta, 'proy-2', [])
  assert.equal('proy-2' in sin.proyectos, false)
})

test('parsearPersistido tolera basura, versiones ajenas y duplicados', () => {
  assert.deepEqual(parsearPersistido(null), persistidoVacio())
  assert.deepEqual(parsearPersistido('{no es json'), persistidoVacio())
  assert.deepEqual(parsearPersistido(JSON.stringify({ version: 9, proyectos: {} })), persistidoVacio())
  const raw = JSON.stringify({
    version: 1,
    proyectos: {
      p: [{ tipo: 'editor', id: 'a' }, { tipo: 'editor', id: 'a' }, { tipo: 'raro', id: 'x' }, 7, { tipo: 'panel', id: 'm', etiqueta: 'M' }],
      vacio: [],
      roto: 'no',
    },
  })
  const r = parsearPersistido(raw)
  assert.deepEqual(claves(r.proyectos.p!), ['editor:a', 'panel:m'])
  assert.equal('vacio' in r.proyectos, false)
  assert.equal('roto' in r.proyectos, false)
})
