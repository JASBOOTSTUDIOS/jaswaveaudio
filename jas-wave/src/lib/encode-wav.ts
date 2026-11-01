/**
 * WAV PCM 16-bit LE (RIFF). Sin dependencias de Web Audio (testeable en Node).
 */

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

function floatToInt16(sample: number): number {
  const x = sample < -1 ? -1 : sample > 1 ? 1 : sample
  return x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff)
}

export function encodeWavPcm16(channels: ArrayLike<number>[], sampleRate: number): Uint8Array {
  const numCh = Math.max(1, channels.length)
  const frames = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const dataSize = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = channels[c]?.[i] ?? 0
      view.setInt16(o, floatToInt16(Number(s)), true)
      o += 2
    }
  }
  return new Uint8Array(buffer)
}

/** Profundidad de exportación: enteros 16/24 bits o float IEEE de 32 bits. */
export type WavBitDepth = 16 | 24 | 32

export type EncodeWavOptions = {
  bitDepth?: WavBitDepth
  /** Dither TPDF al reducir a 16/24 bits (por defecto sí en 16 bits). Determinista con `seed`. */
  dither?: boolean
  seed?: number
}

/** PRNG pequeño y determinista (mulberry32) para el dither. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** WAV PCM entero (16/24) o float (32) con cabecera de 44 bytes. */
export function encodeWav(channels: ArrayLike<number>[], sampleRate: number, opts: EncodeWavOptions = {}): Uint8Array {
  const bits = opts.bitDepth ?? 16
  const numCh = Math.max(1, channels.length)
  const frames = channels[0]?.length ?? 0
  const bytesPerSample = bits / 8
  const blockAlign = numCh * bytesPerSample
  const dataSize = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, bits === 32 ? 3 : 1, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bits, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  const dither = bits !== 32 && (opts.dither ?? bits === 16)
  const rnd = mulberry32(opts.seed ?? 0x5eed)
  const lsb = bits === 24 ? 1 / 8388608 : 1 / 32768
  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      let x = Number(channels[c]?.[i] ?? 0)
      if (!Number.isFinite(x)) x = 0
      if (bits === 32) {
        view.setFloat32(o, x, true)
        o += 4
        continue
      }
      if (dither) x += (rnd() + rnd() - 1) * lsb
      x = x < -1 ? -1 : x > 1 ? 1 : x
      if (bits === 24) {
        const v = x < 0 ? Math.round(x * 0x800000) : Math.round(x * 0x7fffff)
        view.setUint8(o, v & 0xff)
        view.setUint8(o + 1, (v >> 8) & 0xff)
        view.setUint8(o + 2, (v >> 16) & 0xff)
        o += 3
      } else {
        view.setInt16(o, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true)
        o += 2
      }
    }
  }
  return new Uint8Array(buffer)
}

export type DecodedWav = { channels: Float32Array[]; sampleRate: number; bitDepth: number; isFloat: boolean }

/**
 * Lee un WAV PCM 16/24/32 bits o float 32/64, recorriendo los chunks (no asume cabecera de 44 bytes).
 * Devuelve null si no es un WAV que sepamos leer.
 */
export function decodeWav(bin: Uint8Array): DecodedWav | null {
  if (bin.byteLength < 12) return null
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const tag = (o: number) => String.fromCharCode(bin[o]!, bin[o + 1]!, bin[o + 2]!, bin[o + 3]!)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let fmt: { format: number; numCh: number; sampleRate: number; bits: number } | null = null
  let o = 12
  while (o + 8 <= bin.byteLength) {
    const id = tag(o)
    const size = view.getUint32(o + 4, true)
    const body = o + 8
    if (id === 'fmt ' && size >= 16) {
      let format = view.getUint16(body, true)
      // WAVE_FORMAT_EXTENSIBLE: el formato real está en el GUID (primeros 2 bytes).
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true)
      fmt = {
        format,
        numCh: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      }
    } else if (id === 'data' && fmt) {
      const { format, numCh, sampleRate, bits } = fmt
      const isFloat = format === 3
      if (numCh < 1 || (format !== 1 && !isFloat)) return null
      if (!isFloat && bits !== 16 && bits !== 24 && bits !== 32) return null
      if (isFloat && bits !== 32 && bits !== 64) return null
      const bps = bits / 8
      const avail = Math.min(size, bin.byteLength - body)
      const frames = Math.floor(avail / (bps * numCh))
      const channels = Array.from({ length: numCh }, () => new Float32Array(frames))
      let p = body
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < numCh; c++) {
          let v: number
          if (isFloat) v = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true)
          else if (bits === 16) v = view.getInt16(p, true) / 32768
          else if (bits === 24) v = ((bin[p]! | (bin[p + 1]! << 8) | (bin[p + 2]! << 16)) << 8) / 2147483648
          else v = view.getInt32(p, true) / 2147483648
          channels[c]![i] = v
          p += bps
        }
      }
      return { channels, sampleRate, bitDepth: bits, isFloat }
    }
    o = body + size + (size & 1)
  }
  return null
}

export function encodeWavFromAudioBuffer(buffer: {
  numberOfChannels: number
  length: number
  sampleRate: number
  getChannelData: (channel: number) => Float32Array
}): Uint8Array {
  const chans: Float32Array[] = []
  const n = Math.max(1, buffer.numberOfChannels)
  for (let c = 0; c < n; c++) chans.push(buffer.getChannelData(c))
  return encodeWavPcm16(chans, buffer.sampleRate)
}
