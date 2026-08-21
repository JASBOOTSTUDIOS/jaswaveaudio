/**
 * Extrae picos estéreo (min/max por canal) para dibujar waveform tipo DAW.
 */

export type StereoPeakBucket = {
  minL: number
  maxL: number
  minR: number
  maxR: number
}

/** Empaqueta buckets como number[]: [minL,maxL,minR,maxR, ...] */
export function packStereoPeaks(peaks: StereoPeakBucket[]): number[] {
  const out = new Array(peaks.length * 4)
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i]
    const o = i * 4
    out[o] = p.minL
    out[o + 1] = p.maxL
    out[o + 2] = p.minR
    out[o + 3] = p.maxR
  }
  return out
}

export function unpackStereoPeaks(data: number[] | undefined | null): StereoPeakBucket[] {
  if (!data || data.length < 4) return []
  const peaks: StereoPeakBucket[] = []
  for (let i = 0; i + 3 < data.length; i += 4) {
    peaks.push({
      minL: data[i],
      maxL: data[i + 1],
      minR: data[i + 2],
      maxR: data[i + 3],
    })
  }
  return peaks
}

export function extractStereoPeaks(buffer: AudioBuffer, buckets = 512): StereoPeakBucket[] {
  const channels = Math.max(1, buffer.numberOfChannels)
  const left = buffer.getChannelData(0)
  const right = channels > 1 ? buffer.getChannelData(1) : left
  const length = left.length
  const samplesPerBucket = Math.max(1, Math.floor(length / buckets))
  const peaks: StereoPeakBucket[] = []

  for (let b = 0; b < buckets; b++) {
    const start = b * samplesPerBucket
    const end = b === buckets - 1 ? length : Math.min(length, start + samplesPerBucket)
    let minL = 1
    let maxL = -1
    let minR = 1
    let maxR = -1
    for (let i = start; i < end; i++) {
      const l = left[i]
      const r = right[i]
      if (l < minL) minL = l
      if (l > maxL) maxL = l
      if (r < minR) minR = r
      if (r > maxR) maxR = r
    }
    if (end <= start) {
      minL = maxL = minR = maxR = 0
    }
    peaks.push({ minL, maxL, minR, maxR })
  }
  return peaks
}
