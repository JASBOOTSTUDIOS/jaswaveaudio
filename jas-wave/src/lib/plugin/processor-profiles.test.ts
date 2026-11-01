/**
 * npx tsx --test src/lib/plugin/processor-profiles.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import profiles from './processor-profiles.json'

type ProfilePlugin = {
  name: string
  parameterCount: number
  parameters: Array<{
    id: number
    name: string
    kind: string
    min: number
    max: number
    default: number
    scale?: 'log' | 'linear'
    enumValues?: string[]
    readOnly?: boolean
  }>
}

type Profiles = { plugin: Record<string, ProfilePlugin> }

const P = profiles as unknown as Profiles

describe('processor-profiles.json', () => {
  it('tiene los 5 FX de JasWave', () => {
    const names = Object.keys(P.plugin)
    assert.ok(names.includes('JasWave EQ'))
    assert.ok(names.includes('JasWave Compresor'))
    assert.ok(names.includes('JasWave Limitador'))
    assert.ok(names.includes('JasWave Utility'))
    assert.ok(names.includes('JasWave De-esser'))
    assert.equal(names.length, 5)
  })

  it('EQ: 42 parámetros, ids 0..41, output=41, 8 bandas stride 5', () => {
    const eq = P.plugin['JasWave EQ']
    assert.equal(eq.parameterCount, 42)
    assert.equal(eq.parameters.length, 42)
    assert.equal(eq.parameters[0].name, 'Bypass')
    assert.equal(eq.parameters[0].id, 0)
    assert.equal(eq.parameters[41].name, 'Output')
    assert.equal(eq.parameters[41].id, 41)
    // banda 3: base = 1 + 2*5 = 11
    const b3 = eq.parameters.filter((p) => p.id >= 11 && p.id <= 15)
    assert.equal(b3.length, 5)
    assert.equal(b3[0].name, 'Banda 3 Tipo')
    assert.equal(b3[4].name, 'Banda 3 On')
    // todos los ids 0..41 presentes una sola vez
    const ids = eq.parameters.map((p) => p.id).sort((a, b) => a - b)
    assert.deepEqual(ids, Array.from({ length: 42 }, (_, i) => i))
  })

  it('Compresor: ids {0,1,2,3,4,5,6,7,8,40}', () => {
    const c = P.plugin['JasWave Compresor']
    const ids = c.parameters.map((p) => p.id).sort((a, b) => a - b)
    assert.deepEqual(ids, [0, 1, 2, 3, 4, 5, 6, 7, 8, 40])
    assert.equal(c.parameters.find((p) => p.id === 40)?.name, 'GR')
    assert.equal(c.parameters.find((p) => p.id === 40)?.readOnly, true)
  })

  it('Limitador: ids {0,1,2,3,4,40}', () => {
    const l = P.plugin['JasWave Limitador']
    const ids = l.parameters.map((p) => p.id).sort((a, b) => a - b)
    assert.deepEqual(ids, [0, 1, 2, 3, 4, 40])
    assert.equal(l.parameters.find((p) => p.id === 40)?.readOnly, true)
  })

  it('Utility: ids 0..6', () => {
    const u = P.plugin['JasWave Utility']
    const ids = u.parameters.map((p) => p.id).sort((a, b) => a - b)
    assert.deepEqual(ids, [0, 1, 2, 3, 4, 5, 6])
  })

  it('De-esser: ids 0..4', () => {
    const d = P.plugin['JasWave De-esser']
    const ids = d.parameters.map((p) => p.id).sort((a, b) => a - b)
    assert.deepEqual(ids, [0, 1, 2, 3, 4])
  })

  it('cada parámetro tiene nombre, rango y default válidos', () => {
    for (const plugin of Object.values(P.plugin)) {
      for (const p of plugin.parameters) {
        assert.ok(typeof p.name === 'string' && p.name.length > 0, `${plugin.name}: sin nombre id=${p.id}`)
        assert.ok(Number.isFinite(p.min) && Number.isFinite(p.max), `${plugin.name}: rango id=${p.id}`)
        assert.ok(p.min < p.max, `${plugin.name}: min>=max id=${p.id}`)
        assert.ok(p.default >= p.min && p.default <= p.max, `${plugin.name}: default fuera de rango id=${p.id}`)
        if (p.kind === 'enum') {
          assert.ok(Array.isArray(p.enumValues) && p.enumValues.length > 0, `${plugin.name}: enum vacío id=${p.id}`)
        }
      }
    }
  })
})
