#!/usr/bin/env node
// Guitarra eléctrica Les Paul (DI, cuerda E aguda, 340 tomas E4..D6) -> .jwi con 3 capas de dinámica por
// nivel RMS y round-robin entre tomas. Fuera del rango se transpone (E4..D6 = MIDI 64..86).
//   node lespaul2jwi.mjs <carpeta wav> <salida.jwi> [--perLayer 3] [--maxSec 7]
import fs from 'node:fs'
import path from 'node:path'
const [dir, out] = process.argv.slice(2)
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const perLayer = parseInt(opt('perLayer', '3'), 10), maxSec = opt('maxSec', '7')
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
function rms(file) {
  const b = fs.readFileSync(file)
  // buscar chunk data
  let o = 12, dataOff = 44, dataLen = 0, ch = 2, bits = 24
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4)
    if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); bits = b.readUInt16LE(o + 22) }
    if (id === 'data') { dataOff = o + 8; dataLen = Math.min(len, b.length - dataOff); break }
    o += 8 + len + (len & 1)
  }
  const bytes = bits / 8, frameBytes = bytes * ch
  const frames = Math.min(Math.floor(dataLen / frameBytes), 22050)
  let s = 0
  for (let i = 0; i < frames; i++) {
    let v
    const p = dataOff + i * frameBytes
    if (bits === 24) v = b.readIntLE(p, 3) / 8388608
    else if (bits === 16) v = b.readInt16LE(p) / 32768
    else v = b.readFloatLE(p)
    s += v * v
  }
  return Math.sqrt(s / Math.max(1, frames))
}
const byNote = new Map()
for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.wav'))) {
  const m = /^([A-G]#?)(\d)-/.exec(f)
  if (!m) continue
  const midi = (parseInt(m[2], 10) + 1) * 12 + NOTE[m[1]]
  if (!byNote.has(midi)) byNote.set(midi, [])
  byNote.get(midi).push({ f, level: rms(path.join(dir, f)) })
}
const midis = [...byNote.keys()].sort((a, b) => a - b)
const lines = ['# Generado con lespaul2jwi.mjs (Les Paul DI, tomas por nota)', 'name=Guitarra eléctrica · Les Paul (DI)', 'gain=0', 'velGamma=0.5', 'release=0.3']
const bands = [[1, 52], [53, 92], [93, 127]]
let n = 0, rr = 1
for (const midi of midis) {
  const takes = byNote.get(midi).sort((a, b) => a.level - b.level)
  const lo = midi === midis[0] ? 50 : midi, hi = midi === midis.at(-1) ? 92 : midi
  for (let L = 0; L < 3; L++) {
    const a = Math.floor((L * takes.length) / 3), b = Math.floor(((L + 1) * takes.length) / 3)
    const group = takes.slice(a, Math.max(b, a + 1))
    const pick = []
    for (let i = 0; i < Math.min(perLayer, group.length); i++) pick.push(group[Math.floor(((i + 0.5) * group.length) / Math.min(perLayer, group.length))])
    const id = pick.length > 1 ? rr++ : 0
    for (const t of pick) {
      lines.push(['r', path.relative(path.dirname(path.resolve(out)), path.join(dir, t.f)).split(String.fromCharCode(92)).join('/'), lo, hi, midi, bands[L][0], bands[L][1], 0, 0, 0, 0.002, 0.3, -1, -1, 0, 0, 0, id, 0, maxSec].join('|'))
      n++
    }
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n')
console.log(`Les Paul: ${n} regiones, ${midis.length} notas (${midis[0]}..${midis.at(-1)}) -> ${out}`)
