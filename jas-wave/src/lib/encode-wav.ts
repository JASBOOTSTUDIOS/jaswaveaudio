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
