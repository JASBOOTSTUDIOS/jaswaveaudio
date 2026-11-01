/**
 * Aclaraciones del asistente (contrato con el DAW real).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatClarificationAnswersForPrompt, ID_PREGUNTA_AGENTE, lastCreativeUserText, RESPUESTA_DECIDE_AGENTE, sinOpcionesEnTexto } from '../src/motor/ai-clarify'
import { separarComando } from '../src/ui/chip-comando'

describe('ai-clarify', () => {
  it('la respuesta a una pregunta del agente es solo lo elegido, sin directivas internas', () => {
    const q = [{ id: ID_PREGUNTA_AGENTE, question: '¿Qué creo?', options: ['Una habilidad (recomendado)', 'Un prompt'] }]
    const r = formatClarificationAnswersForPrompt(q as never, [{ id: ID_PREGUNTA_AGENTE, value: 'Una habilidad (recomendado)' }])
    assert.equal(r, 'Una habilidad')
    assert.equal(formatClarificationAnswersForPrompt(q as never, [], 'mejor un plan'), 'mejor un plan')
    assert.equal(formatClarificationAnswersForPrompt(q as never, []), RESPUESTA_DECIDE_AGENTE)
  })

  it('sinOpcionesEnTexto quita las opciones repetidas del texto de la pregunta', () => {
    const op = ['Que yo aplique tu forma de tocar a nuevas pistas (recomendado)', 'Que yo analice tus clips']
    assert.equal(
      sinOpcionesEnTexto('¿Qué quieres lograr? Elige una opción: 1. (recomendado) Que yo aplique tu forma de tocar a nuevas pistas. 2. Que yo analice tus clips.', op),
      '¿Qué quieres lograr? Elige una opción:',
    )
    assert.equal(sinOpcionesEnTexto('¿Qué quieres crear primero?', op), '¿Qué quieres crear primero?')
  })

  it('separarComando: la etiqueta de modo reconoce alias y solo comandos completos', () => {
    assert.deepEqual(separarComando('/config crea un plan'), { tipo: 'configurar', token: '/config', resto: 'crea un plan' })
    assert.deepEqual(separarComando('/configurar'), { tipo: 'configurar', token: '/configurar', resto: '' })
    assert.equal(separarComando('/configurar', true), null)
    assert.equal(separarComando('/conf'), null)
    assert.equal(separarComando('/planificar algo'), null)
    assert.equal(separarComando('hola /plan'), null)
    assert.equal(separarComando('/aprender deshacer')?.tipo, 'aprender')
    assert.equal(separarComando('/banda Pop rock')?.resto, 'Pop rock')
  })

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
