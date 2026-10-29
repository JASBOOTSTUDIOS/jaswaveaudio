import { test } from 'node:test'
import assert from 'node:assert/strict'
import { urlAppAdmin } from './abrir'
import { seccionDeHash } from './navegacion'

test('urlAppAdmin: admin.html junto al index actual, sin query ni hash', () => {
  assert.equal(urlAppAdmin('http://localhost:5173/?undock=x#a'), 'http://localhost:5173/admin.html')
  assert.equal(urlAppAdmin('https://app.jaswave.com/studio/index.html?x=1'), 'https://app.jaswave.com/studio/admin.html')
  assert.equal(urlAppAdmin('file:///C:/app/dist/index.html', 'ia/modelos'), 'file:///C:/app/dist/admin.html#/ia/modelos')
})

test('seccionDeHash: rutas conocidas, alias de IA y valor por defecto', () => {
  assert.equal(seccionDeHash('#/ia/conexiones'), 'ia-conexiones')
  assert.equal(seccionDeHash('#/ia'), 'ia-modelos')
  assert.equal(seccionDeHash('#/consumo/'), 'consumo')
  assert.equal(seccionDeHash(''), 'resumen')
  assert.equal(seccionDeHash('#/no-existe'), 'resumen')
})
