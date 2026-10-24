// Prueba de humo del host nativo: subida por trozos de un clip largo + carga por ruta con acentos.
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const [exe, minutes = '30'] = process.argv.slice(2)

const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] })
let buf = ''
const waiters = []
child.stdout.on('data', (d) => {
  buf += d.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.startsWith('{')) continue
    try {
      const w = waiters.shift()
      if (w) w(JSON.parse(line))
    } catch {}
  }
})
child.stderr.on('data', () => {})
const rpc = (cmd) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + cmd.type)), 60000)
    waiters.push((r) => {
      clearTimeout(t)
      resolve(r)
    })
    child.stdin.write(JSON.stringify(cmd) + '\n')
  })

function wavFile(file, seconds, sr = 44100) {
  const frames = seconds * sr
  const data = Buffer.alloc(frames * 2 * 2)
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((i / sr) * 440 * 2 * Math.PI) * 12000)
    data.writeInt16LE(v, i * 4)
    data.writeInt16LE(v, i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([h, data]))
}

;(async () => {
  let fails = 0
  const check = (name, ok, extra = '') => {
    console.log((ok ? 'OK   ' : 'FAIL ') + name + ' ' + extra)
    if (!ok) fails++
  }
  const t0 = Date.now()
  const sr = 48000
  const frames = Number(minutes) * 60 * sr
  const CH = 131072
  let r = await rpc({ type: 'clip.loadBegin', clipId: 'big', frames, channels: 2, sampleRate: sr })
  check('loadBegin', r.ok, JSON.stringify(r))
  const chunk = new Float32Array(CH * 2).fill(0.25)
  let off = 0
  let allOk = true
  while (off < frames) {
    const n = Math.min(CH, frames - off)
    const view = n === CH ? chunk : chunk.subarray(0, n * 2)
    r = await rpc({
      type: 'clip.loadChunk', clipId: 'big', offsetFrames: off, frames: n,
      pcmBase64: Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64'),
    })
    if (!r.ok) { allOk = false; console.log(JSON.stringify(r)); break }
    off += n
  }
  check(`chunks (${minutes} min)`, allOk)
  r = await rpc({ type: 'clip.loadEnd', clipId: 'big' })
  check('loadEnd', r.ok, JSON.stringify(r))
  r = await rpc({ type: 'clip.has', clipId: 'big' })
  check('has loaded', r.ok && r.loaded === true, JSON.stringify(r))
  r = await rpc({ type: 'clip.has', clipId: 'nope' })
  check('has missing', r.ok && r.loaded === false)
  // chunk fuera de orden aborta
  await rpc({ type: 'clip.loadBegin', clipId: 'x', frames: 1000, channels: 2, sampleRate: sr })
  r = await rpc({ type: 'clip.loadChunk', clipId: 'x', offsetFrames: 500, frames: 10, pcmBase64: Buffer.alloc(80).toString('base64') })
  check('chunk fuera de orden rechazado', r.ok === false)
  r = await rpc({ type: 'clip.loadEnd', clipId: 'x' })
  check('loadEnd tras abortar rechazado', r.ok === false)
  // ruta con acentos
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-canción-ñ-'))
  const wav = path.join(dir, 'canción ñandú.wav')
  wavFile(wav, 3)
  r = await rpc({ type: 'clip.load', clipId: 'ruta', path: wav })
  check('clip.load ruta con acentos', r.ok, JSON.stringify(r))
  r = await rpc({ type: 'clip.load', clipId: 'ruta2', path: 'media/relativa.wav' })
  check('ruta relativa inexistente falla limpio', r.ok === false)
  console.log(`total ${(Date.now() - t0) / 1000}s`)
  child.kill()
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error('ERROR', e.message)
  child.kill()
  process.exit(2)
})
