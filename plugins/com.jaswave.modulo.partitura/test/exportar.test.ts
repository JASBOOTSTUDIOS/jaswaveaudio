/**
 * Prueba de contrato: render y exportación de partitura a PDF dentro del DAW real (vía @jaswave/host-sdk).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { instalarHostReal } from '../../sdk/host-sdk/pruebas/host-real'

instalarHostReal()
const { buildScorePdfBytes, isDrumishNotes, scoreFileName } = await import('../src/exportar')

type Nota = { id: string; pitch: number; inicio: number; duracion: number; velocidad: number; canal: number; presion: number; seleccionada: boolean }
const nota = (pitch: number, inicio: number, duracion = 0.25): Nota => ({ id: `n-${pitch}-${inicio}`, pitch, inicio, duracion, velocidad: 90, canal: 0, presion: 0, seleccionada: false })

describe('partitura — exportación a PDF', () => {
  it('detecta batería y produce un PDF válido', async () => {
    const notas = [nota(36, 0), nota(38, 1), nota(42, 0.5), nota(36, 2), nota(38, 3)]
    assert.equal(isDrumishNotes(notas), true)
    const bytes = await buildScorePdfBytes(notas, { bpm: 72, drums: true, title: 'Test Drums' })
    assert.ok(bytes.length > 100)
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), '%PDF')
  })

  it('produce un PDF melódico', async () => {
    const notas = [nota(60, 0, 0.5), nota(62, 0.5), nota(64, 1), nota(65, 1.5), nota(67, 2, 1)]
    const bytes = await buildScorePdfBytes(notas, { bpm: 100, drums: false, title: 'Melody' })
    assert.equal(bytes[0], 0x25)
    assert.equal(bytes[1], 0x50)
  })

  it('nombra el archivo a partir de pista y clip', () => {
    assert.match(scoreFileName('Piano', 'Intro'), /\.pdf$/i)
  })
})
