import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KNOWN_AGENT_ACTION_TYPES } from '../agent-action-catalog'
import { ACCIONES_PLUGIN_EN_UI, esAccionDePlugin } from './plugin-ui-acciones'
import { comandosRestablecer } from './plugin-reset'

describe('paridad IA ↔ UI en los plugins', () => {
  it('toda acción de plugins que puede ejecutar la IA tiene un control en la UI', () => {
    const faltan = [...new Set(KNOWN_AGENT_ACTION_TYPES)].filter(esAccionDePlugin).filter((t) => !ACCIONES_PLUGIN_EN_UI[t])
    assert.deepEqual(faltan, [], `Acciones de la IA sin control para el usuario: ${faltan.join(', ')}`)
  })

  it('la tabla no anuncia acciones que la IA no tiene', () => {
    const conocidas = new Set(KNOWN_AGENT_ACTION_TYPES)
    const sobran = Object.keys(ACCIONES_PLUGIN_EN_UI).filter((t) => !conocidas.has(t))
    assert.deepEqual(sobran, [])
  })
})

describe('comandosRestablecer', () => {
  const base = { name: 'P', normalizedValue: 0.5 }
  it('devuelve al valor por defecto del VST solo los parámetros movidos', () => {
    const cmds = comandosRestablecer('t1', 'p1', [
      { ...base, parameterId: '1', name: 'Cutoff', normalizedValue: 0.9, defaultNormalizedValue: 0.25 },
      { ...base, parameterId: '2', normalizedValue: 0.25, defaultNormalizedValue: 0.25 },
    ])
    assert.deepEqual(cmds, [
      {
        type: 'plugin.setParameter',
        payload: { trackId: 't1', pluginInstanceId: 'p1', parameterId: '1', normalizedValue: 0.25, name: 'Cutoff' },
      },
    ])
  })

  it('salta solo lectura, cambio de programa y parámetros sin valor por defecto', () => {
    const cmds = comandosRestablecer('t1', 'p1', [
      { ...base, parameterId: '1', defaultNormalizedValue: 0, readOnly: true },
      { ...base, parameterId: '2', defaultNormalizedValue: 0, programChange: true },
      { ...base, parameterId: '3' },
    ])
    assert.equal(cmds.length, 0)
  })

  it('con soloIds restablece únicamente esos parámetros', () => {
    const cmds = comandosRestablecer(
      't1',
      'p1',
      [
        { ...base, parameterId: '1', defaultNormalizedValue: 0 },
        { ...base, parameterId: '2', defaultNormalizedValue: 1 },
      ],
      ['2'],
    )
    assert.equal(cmds.length, 1)
    assert.equal((cmds[0]!.payload as { parameterId: string }).parameterId, '2')
    assert.equal((cmds[0]!.payload as { normalizedValue: number }).normalizedValue, 1)
  })
})
