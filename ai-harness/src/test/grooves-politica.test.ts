import { describe, expect, it } from 'vitest'
import { AGENT_ACTION_CLASSES } from '../agent/action-policy'

describe('política de acciones · biblioteca de grooves', () => {
  it('listar es lectura e insertar es escritura (con undo, nunca sistema)', () => {
    expect(AGENT_ACTION_CLASSES['groove.listar']).toBe('read')
    expect(AGENT_ACTION_CLASSES['groove.insertar']).toBe('write')
  })
})
