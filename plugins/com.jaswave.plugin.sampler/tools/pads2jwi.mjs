#!/usr/bin/env node
// Convierte los loops de "Motion Pads" (36 WAV: 12 tonalidades x 3 texturas) a un instrumento .jwi.
// Cualquier nota con la misma clase de altura dispara el pad de esa tonalidad (sin transposición),
// con fundido de entrada lento, lazo con crossfade de potencia constante y release largo.
//   node pads2jwi.mjs <carpeta samples> <salida.jwi> [--name X] [--gain dB]
import fs from 'node:fs'
import path from 'node:path'
const [dir, out] = process.argv.slice(2)
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const layers = ['Pad', 'Pad2', 'Pad3']
const name = opt('name', 'Pads · Motion (tonalidad por nota)')
const lines = ['# Generado con pads2jwi.mjs (loops de pad por tonalidad)', `name=${name}`, `gain=${opt('gain', '0')}`, 'velGamma=0.2', 'release=5']
let n = 0
for (let note = 24; note <= 95; note++) {
  const pc = note % 12
  for (const l of layers) {
    const f = path.join(dir, `${KEYS[pc]} ${l}.wav`)
    if (!fs.existsSync(f)) continue
    const b = fs.readFileSync(f).subarray(0, 64)
    const sr = b.readUInt32LE(24)
    // lazo: 5 s .. 26 s (de 30 s), crossfade largo en el motor
    lines.push(['r', path.relative(path.dirname(path.resolve(out)), f).split(String.fromCharCode(92)).join('/'), note, note, note, 1, 127, 0, 0, 0, 2.5, 5, Math.round(5 * sr), Math.round(26 * sr), 0, 0, 0, 0, 0, 0].join('|'))
    n++
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n')
console.log(`${name}: ${n} regiones -> ${out}`)
