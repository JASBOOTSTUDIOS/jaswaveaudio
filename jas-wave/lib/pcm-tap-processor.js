/**
 * AudioWorklet: acumula ~512 frames y envía interleaved f32 al renderer.
 * process() corre fuera del hilo de UI (a diferencia de ScriptProcessor).
 */
class JaswavePcmTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._l = new Float32Array(512)
    this._r = new Float32Array(512)
    this._i = new Float32Array(1024)
    this._n = 0
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
        const interleaved = this._i
        for (let f = 0; f < 512; f++) {
          interleaved[f * 2] = this._l[f]
          interleaved[f * 2 + 1] = this._r[f]
        }
        this.port.postMessage(interleaved)
        this._n = 0
      }
    }
    return true
  }
}

registerProcessor('jaswave-pcm-tap', JaswavePcmTapProcessor)
