/**
 * Tests del builder de contenido para bounce offline.
 * Ejecutar: npx tsx --test src/lib/bounce-content.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildBounceContent,
  type BounceSlotResolver,
  type BounceSourceState,
} from './bounce-content'

const BPM = 120 // 1 beat = 0.5 s

function estado(tracks: unknown[], bpm = BPM): BounceSourceState {
  return { project: { bpm: { valor: bpm }, tracks } as BounceSourceState['project'] }
}

const vstResolver: BounceSlotResolver = (trackId) =>
  trackId === 'synth' ? { slotId: `${trackId}:plugin-1` } : {}
const emptyResolver: BounceSlotResolver = () => ({})

describe('buildBounceContent', () => {
  it('convierte beats de notas a segundos absolutos con slot VST', () => {
    const st = estado([
      {
        id: 'synth',
        plugins: [{ id: 'plugin-1' }],
        clips: [
          {
            id: 'c1',
            tipo: 'midi',
            inicio: 4, // 2 s
            duracion: 8, // 4 s
            notas: [
              { pitch: 60, velocidad: 100, inicio: 0, duracion: 1 },
              { pitch: 62, velocidad: 80, inicio: 2, duracion: 0.5 },
            ],
          },
        ],
      },
    ])
    const content = buildBounceContent(st, {}, vstResolver)
    assert.equal(content.bpm, BPM)
    assert.equal(content.tracks.length, 1)
    const trk = content.tracks[0]!
    assert.equal(trk.stemIndex, 0)
    assert.equal(trk.notes.length, 2)
    const [n1, n2] = trk.notes
    assert.equal(n1.slotId, 'synth:plugin-1')
    assert.ok(Math.abs(n1.startSec - 2) < 1e-9)
    assert.ok(Math.abs(n1.durSec - 0.5) < 1e-9)
    assert.equal(n1.velocity, 100)
    assert.ok(Math.abs(n2.startSec - 3) < 1e-9)
  })

  it('filtra notas fuera de la ventana y recorta totalSec a endSec', () => {
    const st = estado([
      {
        id: 'synth',
        clips: [
          {
            id: 'c1',
            tipo: 'midi',
            inicio: 20, // 10 s
            duracion: 8,
            notas: [{ pitch: 60, inicio: 0, duracion: 1 }],
          },
        ],
      },
    ])
    const content = buildBounceContent(st, { startSec: 0, endSec: 5 }, vstResolver)
    assert.equal(content.totalSec, 5)
    assert.equal(content.tracks.length, 0)
  })

  it('MIDI sin slot VST sigue en contenido (slotId undefined)', () => {
    const st = estado([
      {
        id: 'pad',
        clips: [
          {
            id: 'c1',
            tipo: 'midi',
            inicio: 0,
            duracion: 4,
            notas: [{ pitch: 72, inicio: 0, duracion: 1 }],
          },
        ],
      },
    ])
    const content = buildBounceContent(st, {}, emptyResolver)
    const trk = content.tracks[0]!
    assert.equal(trk.notes[0]!.slotId, undefined)
  })

  it('clips de audio: key por ruta o fallback demo, con clipInicio', () => {
    const st = estado([
      {
        id: 'drums',
        clips: [
          {
            id: 'clip-drums-1',
            tipo: 'audio',
            inicio: 2,
            duracion: 8,
            clipInicio: 1.5,
            source: { ruta: 'C:/samples/loop.wav' },
          },
        ],
      },
      {
        id: 'guitar',
        clips: [{ id: 'clip-g-1', tipo: 'audio', inicio: 0, duracion: 4 }],
      },
    ])
    const content = buildBounceContent(st, {}, vstResolver)
    assert.equal(content.tracks.length, 2)
    assert.equal(content.tracks[0]!.audioClips[0]!.sourceKey, 'C:/samples/loop.wav')
    assert.ok(Math.abs(content.tracks[0]!.audioClips[0]!.inicioSec - 1) < 1e-9)
    assert.equal(content.tracks[1]!.audioClips[0]!.sourceKey, 'demo-lead')
  })

  it('expression CC normaliza valor ≤1 a 0..127', () => {
    const st = estado([
      {
        id: 'synth',
        clips: [
          {
            id: 'c1',
            tipo: 'midi',
            inicio: 0,
            duracion: 4,
            expression: { cc: [{ cc: 11, puntos: [{ tiempo: 1, valor: 0.5 }] }] },
          },
        ],
      },
    ])
    const content = buildBounceContent(st, {}, vstResolver)
    const cc = content.tracks[0]!.ccs[0]!
    assert.equal(cc.cc, 11)
    assert.equal(cc.value, 64)
    assert.ok(Math.abs(cc.timeSec - 0.5) < 1e-9)
  })

  it('pistas sin contenido se omiten; stemIndex sigue el orden del proyecto', () => {
    const st = estado([
      { id: 'empty' },
      {
        id: 'pad',
        clips: [
          { id: 'c', tipo: 'midi', inicio: 0, duracion: 2, notas: [{ pitch: 60, inicio: 0, duracion: 1 }] },
        ],
      },
    ])
    const content = buildBounceContent(st, {}, emptyResolver)
    assert.equal(content.tracks.length, 1)
    assert.equal(content.tracks[0]!.trackId, 'pad')
    assert.equal(content.tracks[0]!.stemIndex, 1)
  })
})
