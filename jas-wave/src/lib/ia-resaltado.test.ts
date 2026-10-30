import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { _reiniciarResaltadoIA, DURACION_RESALTADO_MS, estaResaltado, marcarCambioIA } from './ia-resaltado'
import { fijarPreferenciaIA } from './preferencias-ia'

describe('resaltado de lo que toca la IA', () => {
  afterEach(() => _reiniciarResaltadoIA())

  it('ilumina el control tocado y la tira, y se apaga solo', () => {
    const t0 = 1_000_000
    marcarCambioIA('bajo', ['volumen', 'paneo'], t0)
    assert.equal(estaResaltado('bajo', 'volumen', t0 + 10), true)
    assert.equal(estaResaltado('bajo', 'paneo', t0 + 10), true)
    assert.equal(estaResaltado('bajo', '*', t0 + 10), true, 'la tira entera')
    assert.equal(estaResaltado('bajo', 'fx', t0 + 10), false)
    assert.equal(estaResaltado('piano', 'volumen', t0 + 10), false)
    assert.equal(estaResaltado('bajo', 'volumen', t0 + DURACION_RESALTADO_MS + 1), false)
  })

  it('con «Ver a la IA» apagado en el transporte no se ilumina nada', () => {
    fijarPreferenciaIA({ ver: false })
    try {
      marcarCambioIA('bajo', ['volumen'])
      assert.equal(estaResaltado('bajo', 'volumen'), false)
    } finally {
      fijarPreferenciaIA({ ver: true })
    }
    marcarCambioIA('bajo', ['volumen'])
    assert.equal(estaResaltado('bajo', 'volumen'), true)
  })

  it('sin pista o sin campos no marca nada', () => {
    marcarCambioIA('', ['volumen'])
    marcarCambioIA('bajo', [])
    assert.equal(estaResaltado('bajo', '*'), false)
  })
})
