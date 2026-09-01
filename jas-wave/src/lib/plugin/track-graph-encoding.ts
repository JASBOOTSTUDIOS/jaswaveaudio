/** Paquetes PCM multi-pista hacia jaswave-plugin-host (magic JWST). */

export const JASWAVE_MIX_MAGIC = 0x4a575354
export const JASWAVE_MIX_DAW_BUS = 0xffff

/** Header 8 bytes + interleaved f32le stereo. Devuelve bytes listos para IPC. */
export function encodeStemPacket(trackIndex: number, interleaved: Float32Array): Uint8Array {
  const frames = interleaved.length >> 1
  const u8 = new Uint8Array(8 + interleaved.byteLength)
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  view.setUint32(0, JASWAVE_MIX_MAGIC, true)
  view.setUint16(4, trackIndex & 0xffff, true)
  view.setUint16(6, frames & 0xffff, true)
  new Float32Array(u8.buffer, u8.byteOffset + 8, interleaved.length).set(interleaved)
  return u8
}

export type GraphSend = { destStem: number; amount: number; preFader?: boolean }

export type GraphSidechain = { srcStem: number; amount: number }

/**
 * encoding Reaper graph:
 *   `idx~gain~pan~muted|slot:i:0,slot:e:1#dest:amt+dest2:amt2;...||masterSlot:e:0`
 * Sends opcionales tras `#` (post-fader, sample-accurate en renderMix).
 */
export function encodeTrackGraph(params: {
  tracks: Array<{
    stemIndex: number
    gain: number
    pan: number
    muted: boolean
    slots: Array<{ slotId: string; instrument: boolean; bypass: boolean }>
    sends?: GraphSend[]
    sidechains?: GraphSidechain[]
  }>
  master: Array<{ slotId: string; instrument: boolean; bypass: boolean }>
}): string {
  const trackParts = params.tracks.map((t) => {
    const slots = t.slots
      .map((s) => `${s.slotId}:${s.instrument ? 'i' : 'e'}:${s.bypass ? '1' : '0'}`)
      .join(',')
    const sends =
      t.sends && t.sends.length > 0
        ? `#${t.sends
            .filter((s) => s.amount > 0 && Number.isFinite(s.destStem))
            .map((s) => `${s.destStem}:${s.amount}${s.preFader ? ':p' : ''}`)
            .join('+')}`
        : ''
    const sidechains =
      t.sidechains && t.sidechains.length > 0
        ? `$${t.sidechains
            .filter((s) => s.amount > 0 && Number.isFinite(s.srcStem))
            .map((s) => `${s.srcStem}:${s.amount}`)
            .join('+')}`
        : ''
    return `${t.stemIndex}~${t.gain}~${t.pan}~${t.muted ? '1' : '0'}|${slots}${sends}${sidechains}`
  })
  const master = params.master
    .map((s) => `${s.slotId}:${s.instrument ? 'i' : 'e'}:${s.bypass ? '1' : '0'}`)
    .join(',')
  return `${trackParts.join(';')}||${master}`
}
