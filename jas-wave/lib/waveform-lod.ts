/**
 * Extracción de picos por columna de píxeles (LOD estilo Reaper).
 */

import type { StereoPeakBucket } from './stereo-peaks'

/**
 * Para un rango temporal [startSec, endSec), genera un bucket min/max por píxel.
 * Si hay ≤2 samples por píxel, los min/max reflejan la forma de onda muestra a muestra.
 */
export function extractPeaksForPixelColumns(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  pixelCount: number,
): StereoPeakBucket[] {
  const n = Math.max(1, Math.floor(pixelCount))
  const sr = buffer.sampleRate
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const total = left.length

  const startSample = Math.max(0, Math.floor(startSec * sr))
  const endSample = Math.min(total, Math.ceil(endSec * sr))
  const span = Math.max(1, endSample - startSample)
  const peaks: StereoPeakBucket[] = new Array(n)

  for (let x = 0; x < n; x++) {
    const s0 = startSample + Math.floor((x / n) * span)
    const s1 = startSample + Math.floor(((x + 1) / n) * span)
    const from = Math.min(s0, total - 1)
    const to = Math.max(from + 1, Math.min(s1, total))

    let minL = 1
    let maxL = -1
    let minR = 1
    let maxR = -1

    // Muestreo denso: si el rango es enorme, subsamplear para no bloquear UI
    const range = to - from
    const step = range > 4096 ? Math.ceil(range / 2048) : 1

    for (let i = from; i < to; i += step) {
      const l = left[i]
      const r = right[i]
      if (l < minL) minL = l
      if (l > maxL) maxL = l
      if (r < minR) minR = r
      if (r > maxR) maxR = r
    }

    if (maxL < minL) {
      minL = maxL = left[from] ?? 0
      minR = maxR = right[from] ?? 0
    }
    peaks[x] = { minL, maxL, minR, maxR }
  }
  return peaks
}

/** Reesamplea peaks overview empaquetados a N columnas. */
export function resamplePackedPeaks(
  packed: number[] | undefined,
  columns: number,
): StereoPeakBucket[] {
  if (!packed || packed.length < 4 || columns <= 0) return []
  const srcCount = Math.floor(packed.length / 4)
  const out: StereoPeakBucket[] = []
  for (let x = 0; x < columns; x++) {
    const a = Math.floor((x / columns) * srcCount)
    const b = Math.max(a + 1, Math.floor(((x + 1) / columns) * srcCount))
    let minL = 1
    let maxL = -1
    let minR = 1
    let maxR = -1
    for (let i = a; i < b && i < srcCount; i++) {
      const o = i * 4
      minL = Math.min(minL, packed[o])
      maxL = Math.max(maxL, packed[o + 1])
      minR = Math.min(minR, packed[o + 2])
      maxR = Math.max(maxR, packed[o + 3])
    }
    if (maxL < minL) {
      const o = Math.min(a, srcCount - 1) * 4
      minL = maxL = packed[o] ?? 0
      minR = maxR = packed[o + 2] ?? 0
    }
    out.push({ minL, maxL, minR, maxR })
  }
  return out
}
