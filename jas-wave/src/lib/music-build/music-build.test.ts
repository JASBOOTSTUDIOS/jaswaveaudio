import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { specFromPrompt } from './spec'
import { validateMidiClip } from './validator'
import type { GeneratedNote } from '../midi-song-generator'

describe('music-build spec', () => {
  it('parsea BPM, tonalidad, duración y forma de un brief de canción', () => {
    const spec = specFromPrompt(
      'Créame una canción de reggaetón moderna, 95 BPM, A menor, 3 minutos, con intro, verso, pre-coro, coro, segundo verso, coro y outro.',
    )
    assert.equal(spec.bpm, 95)
    assert.equal(spec.scale, 'minor')
    assert.match(spec.keyLabel, /A menor|la menor/i)
    assert.ok(spec.minutes >= 2.5)
    assert.ok(spec.sections.some((s) => /intro/i.test(s.name)))
    assert.ok(spec.sections.some((s) => /verso/i.test(s.name)))
    assert.ok(spec.sections.some((s) => /estribillo|coro/i.test(s.name)))
    const roles = spec.tracks.map((t) => t.rol)
    assert.ok(roles.includes('drums'))
    assert.ok(roles.includes('bass'))
  })

  it('entiende 3:30 como minutos', () => {
    const spec = specFromPrompt('Hazme una canción synthwave oscura, 120 BPM, A menor, 3:30.')
    assert.equal(spec.bpm, 120)
    assert.ok(spec.minutes >= 3.4 && spec.minutes <= 3.6)
  })
})

describe('music-build validator', () => {
  it('acepta un bajo en rango y escala de La menor', () => {
    const notes: GeneratedNote[] = [
      { pitch: 45, inicio: 0, duracion: 1, velocidad: 80 },
      { pitch: 48, inicio: 1, duracion: 1, velocidad: 76 },
      { pitch: 52, inicio: 2, duracion: 1, velocidad: 78 },
    ]
    const issues = validateMidiClip({
      notes,
      rol: 'bass',
      keyRoot: 45,
      scale: 'minor',
      trackName: 'Bajo',
    })
    assert.equal(issues.filter((i) => i.severity === 'error').length, 0)
  })

  it('marca vacío como error y registro absurdo como aviso', () => {
    assert.ok(
      validateMidiClip({
        notes: [],
        rol: 'bass',
        keyRoot: 45,
        scale: 'minor',
        trackName: 'Bajo',
      }).some((i) => i.code === 'empty'),
    )
    const crazy: GeneratedNote[] = [
      { pitch: 90, inicio: 0, duracion: 1, velocidad: 80 },
      { pitch: 93, inicio: 1, duracion: 1, velocidad: 80 },
      { pitch: 96, inicio: 2, duracion: 1, velocidad: 80 },
    ]
    assert.ok(
      validateMidiClip({
        notes: crazy,
        rol: 'bass',
        keyRoot: 45,
        scale: 'minor',
        trackName: 'Bajo',
      }).some((i) => i.code === 'range'),
    )
  })
})
