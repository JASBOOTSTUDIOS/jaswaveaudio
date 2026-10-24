/**
 * npx tsx --test src/lib/plugin/eq-contrato.test.ts
 *
 * El contrato de parámetros del EQ dinámico (shared/src/audio/eq-dinamico.ts) debe coincidir con el
 * manifiesto generado del binario del VST (plugins/com.jaswave.plugin.param-eq/jaswave-plugin.json,
 * a su vez volcado por sync-manifests.mjs desde param_eq_dsp.h). Si alguien cambia el C++ sin tocar TS, falla aquí.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  EQ_MAX_BANDAS,
  eqParamId,
  eqPerfilParametros,
  eqValorANormalizado,
  type CampoBandaEq,
} from '../../../../shared/src/audio/eq-dinamico'

type ParamManifiesto = { id: string; vstParamId: number; min: number; max: number; default: number; scale: string; values?: string[] }
const RUTA = resolve(__dirname, '../../../../plugins/com.jaswave.plugin.param-eq/jaswave-plugin.json')
const manifiesto = JSON.parse(readFileSync(RUTA, 'utf8')) as { ai: { parameters: ParamManifiesto[] } }
const porId = new Map(manifiesto.ai.parameters.map((p) => [p.id, p]))

const SUFIJO: Record<string, CampoBandaEq> = {
  tipo: 'type', freq: 'freq', ganancia: 'gain', q: 'q', activa: 'enabled', usada: 'used', pendiente: 'slope', modo: 'mode', solo: 'solo',
}

describe('EQ dinámico: contrato TS ↔ manifiesto del VST', () => {
  it('los IDs de las 24 bandas coinciden con vstParamId', () => {
    for (let n = 1; n <= EQ_MAX_BANDAS; n++) {
      for (const [suf, campo] of Object.entries(SUFIJO)) {
        const p = porId.get(`b${n}.${suf}`)
        assert.ok(p, `falta b${n}.${suf} en el manifiesto`)
        assert.equal(p.vstParamId, eqParamId(n - 1, campo), `b${n}.${suf}`)
      }
    }
  })

  it('el perfil generado cubre el manifiesto con los mismos rangos y valores por defecto', () => {
    const perfil = new Map(eqPerfilParametros().map((p) => [p.id, p]))
    for (const p of manifiesto.ai.parameters) {
      const q = perfil.get(p.vstParamId)
      assert.ok(q, `el perfil no tiene id ${p.vstParamId} (${p.id})`)
      if (/^b\d+\.(freq|ganancia|q)$/.test(p.id)) {
        assert.equal(q.min, p.min, p.id)
        assert.equal(q.max, p.max, p.id)
      }
      // valores de fábrica por banda: tipo, frecuencia, Q, activa y usada deben coincidir con bandDefault() del C++
      if (/^b\d+\.(tipo|freq|q|usada|activa|solo|pendiente|modo)$/.test(p.id)) {
        assert.ok(Math.abs(q.default - p.default) < 1e-6 * Math.max(1, Math.abs(p.default)), `${p.id}: por defecto ${q.default} ≠ ${p.default}`)
      }
    }
  })

  it('las bandas heredadas 1..8 siguen en los IDs de JasWaveFx y la salida/pendiente/analizador no se movieron', () => {
    assert.equal(porId.get('b1.tipo')!.vstParamId, 1)
    assert.equal(porId.get('b8.activa')!.vstParamId, 40)
    assert.equal(porId.get('salida')!.vstParamId, 41)
    assert.equal(porId.get('pendiente')!.vstParamId, 42)
    assert.equal(porId.get('analizador')!.vstParamId, 43)
  })

  it('el valor por defecto de la frecuencia de una banda es normalizable al del VST', () => {
    const f = porId.get('b3.freq')!
    assert.ok(eqValorANormalizado('freq', f.default) >= 0)
  })
})
