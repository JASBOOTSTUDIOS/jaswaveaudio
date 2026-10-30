#!/usr/bin/env node
// Salamander Grand Piano V3 (SFZ con includes por capa) -> .jwi. Selecciona N capas de velocidad (memoria).
//   node salamander2jwi.mjs <carpeta Salamander> <salida.jwi> [--layers 6] [--maxSec 14] [--name X] [--gain dB]
import fs from 'node:fs'
import path from 'node:path'
const [dir, out] = process.argv.slice(2)
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const layersN = parseInt(opt('layers', '6'), 10), maxSec = opt('maxSec', '14'), name = opt('name', 'Piano de cola · Salamander')
const read = (f) => fs.readFileSync(path.join(dir, 'Data', f), 'utf8')
const tune = {}
for (const m of read('tune_nat.txt').matchAll(/#define\s+\$(TUNE\d+)\s+(-?[\d.]+)/g)) tune[m[1]] = parseFloat(m[2])
const regions = []
for (const m of read('region.txt').matchAll(/<region>\s+region_label=\d+\s+tune=\$(TUNE\d+).*?lokey=(\d+)\s+hikey=(\d+)\s+pitch_keycenter=(\d+)\s+sample=([A-G]#?\d)\$VEL/g))
  regions.push({ tune: tune[m[1]] ?? 0, lokey: +m[2], hikey: +m[3], center: +m[4], base: m[5] })
const vel = []
for (const m of read('notes.txt').matchAll(/vel_(\d+)\.txt"\s+lovel=(\d+)\s+hivel=(\d+)/g)) vel.push({ n: +m[1], lo: +m[2], hi: +m[3] })
// capas elegidas, repartidas por todo el rango, con rangos de velocidad reasignados para cubrir 1..127
const picks = []
for (let i = 0; i < layersN; i++) picks.push(vel[Math.min(vel.length - 1, Math.round(((i + 0.5) / layersN) * vel.length - 0.5))])
const uniq = [...new Map(picks.map((p) => [p.n, p])).values()].sort((a, b) => a.n - b.n)
const lines = ['# Generado con salamander2jwi.mjs', `name=${name}`, `gain=${opt('gain', '0')}`, 'velGamma=0.35', 'release=0.55']
let count = 0
uniq.forEach((p, i) => {
  const lo = i === 0 ? 1 : Math.floor((uniq[i - 1].hi + p.lo) / 2) + 1
  const hi = i === uniq.length - 1 ? 127 : Math.floor((p.hi + uniq[i + 1].lo) / 2)
  for (const r of regions) {
    const file = `Samples/${r.base}v${p.n}.flac`
    if (!fs.existsSync(path.join(dir, file))) continue
    lines.push(['r', file, r.lokey, r.hikey, r.center, lo, hi, r.tune, 0, 0, 0, 0.55, -1, -1, 0, 0, 0, 0, 0, maxSec].join('|'))
    count++
  }
})
fs.writeFileSync(out, lines.join('\n') + '\n')
console.log(`${name}: ${count} regiones (${uniq.length} capas de ${vel.length}) -> ${out}`)
