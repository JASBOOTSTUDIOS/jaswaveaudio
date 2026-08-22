/**
 * AudioWorklet: interleave stereo y envía bloques al renderer (fuera del hilo de UI).
 * processorOptions.stemIndex: índice JWST (0..63 o 0xFFFF). -1 = mix crudo sin header.
 */
class JaswavePcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this._l = new Float32Array(512)
    this._r = new Float32Array(512)
    this._n = 0
    this._stem = -1
    const opts = options && options.processorOptions
    if (opts && Number.isFinite(opts.stemIndex)) this._stem = opts.stemIndex | 0
    this.port.onmessage = (ev) => {
      const d = ev.data
      if (d && Number.isFinite(d.stemIndex)) this._stem = d.stemIndex | 0
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (output) {
      for (let c = 0; c < output.length; c++) output[c].fill(0)
    }
    const input = inputs[0]
    if (!input || !input[0] || input[0].length === 0) return true
    const l = input[0]
    const r = input[1] || l
    let i = 0
    const q = l.length
    while (i < q) {
      const room = 512 - this._n
      const take = q - i < room ? q - i : room
      this._l.set(l.subarray(i, i + take), this._n)
      this._r.set(r.subarray(i, i + take), this._n)
      this._n += take
      i += take
      if (this._n >= 512) {
        const interleaved = new Float32Array(1024)
        for (let f = 0; f < 512; f++) {
          interleaved[f * 2] = this._l[f]
          interleaved[f * 2 + 1] = this._r[f]
        }
        // Sin transfer: en Electron el buffer llega detached y el host recibe silencio.
        this.port.postMessage({ pcm: interleaved, stemIndex: this._stem })
        this._n = 0
      }
    }
    return true
  }
}

registerProcessor('jaswave-pcm-tap', JaswavePcmTapProcessor)
