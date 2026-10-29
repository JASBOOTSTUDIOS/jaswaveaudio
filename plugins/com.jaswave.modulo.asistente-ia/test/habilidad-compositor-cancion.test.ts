/** Habilidad «compositor letra → canción» (K4): estructura del Markdown y asignación al productor. */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { habilidadCompositorCancion, RUTA_HABILIDAD_COMPOSITOR } from '../src/motor/habilidad-compositor-cancion'

describe('habilidad compositor de canciones', () => {
  it('lleva ruta, título, destinatario y las herramientas reales', () => {
    const h = habilidadCompositorCancion()
    assert.equal(h.ruta, RUTA_HABILIDAD_COMPOSITOR)
    assert.match(h.contenido, /^# Compositor letra → canción/)
    assert.match(h.contenido, /<!-- agente: productor -->/)
    assert.match(h.contenido, /analysis\.voiceToMelody/)
    assert.match(h.contenido, /com\.jaswave\.plugin\.vocal-choir/)
    assert.match(h.contenido, /\[Audio Ref - Canto Original\]/)
  })
})
