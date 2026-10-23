/**
 * Aclaraciones del asistente (contrato con el DAW real).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lastCreativeUserText } from '../src/motor/ai-clarify'

describe('ai-clarify', () => {
  it('lastCreativeUserText recupera el pedido de batería, no el hola/estado', () => {
    const brief =
      'creame una pista de bateria worship con crescendo y toms, tiempo sea 72 4/4'
    const got = lastCreativeUserText(
      [
        { role: 'user', content: brief },
        { role: 'assistant', content: 'falló' },
        { role: 'user', content: 'no se creo el clip.' },
        { role: 'user', content: 'hola' },
        { role: 'user', content: 'hola, dame el estado de este proyecto.' },
      ],
      'hazlo',
    )
    assert.equal(got, brief)
  })
})
