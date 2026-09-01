import { describe, expect, it } from 'vitest'
import {
  adaptiveGridForZoom,
  snapBeatToDivision,
  snapDurationToDivision,
} from '../midi/grid'

/** Mirrors jas-wave/lib/timeline-projection createProjection formulas. */
function beatToPixel(beat: number, pixelsPerBeat: number) {
  return beat * pixelsPerBeat
}
function contentPixelToBeat(contentPixel: number, pixelsPerBeat: number) {
  return contentPixel / pixelsPerBeat
}
function pixelToBeat(pixel: number, scrollX: number, pixelsPerBeat: number) {
  return (pixel + scrollX) / pixelsPerBeat
}

describe('timeline projection beat ↔ pixel', () => {
  it('round-trips beat ↔ content pixel within epsilon', () => {
    const ppb = 20
    for (const beat of [0, 0.25, 1, 4, 16.5, 100]) {
      const px = beatToPixel(beat, ppb)
      const back = contentPixelToBeat(px, ppb)
      expect(Math.abs(back - beat)).toBeLessThan(1e-9)
    }
  })

  it('pixelToBeat accounts for scrollX', () => {
    expect(pixelToBeat(0, 50, 10)).toBeCloseTo(5, 9)
    expect(pixelToBeat(30, 50, 10)).toBeCloseTo(8, 9)
  })
})

describe('adaptive grid + snap', () => {
  it('increases density with pixelsPerBeat', () => {
    const low = adaptiveGridForZoom(4)
    const high = adaptiveGridForZoom(200)
    expect(high.length).toBeGreaterThan(low.length)
    expect(low.some((l) => l.kind === 'bar')).toBe(true)
  })

  it('snaps beats to division', () => {
    expect(snapBeatToDivision(1.1, 0.25, true)).toBe(1)
    expect(snapBeatToDivision(1.2, 0.25, true)).toBe(1.25)
    expect(snapBeatToDivision(1.2, 0.25, false)).toBe(1.2)
  })

  it('snaps duration with minimum division', () => {
    expect(snapDurationToDivision(0.05, 0.25, true)).toBe(0.25)
    expect(snapDurationToDivision(0.6, 0.25, true)).toBe(0.5)
  })
})
