#!/usr/bin/env node
// Convierte un instrumento SFZ (subconjunto habitual) al formato .jwi del JasWave Sampler.
//   node sfz2jwi.mjs <entrada.sfz> <salida.jwi> --name "Piano" [--gain 0] [--velGamma 0.5] [--release 0.4]
//        [--maxSec 12] [--velLayers 6] [--oneShotAll] [--dropRelease] [--keys 21-108] [--loopAll]
// Soporta: #define, #include, <control> default_path, <global>/<master>/<group>/<region>, notas por nombre,
//          velocidad/teclas, afinación, volumen, pan, ataque/release, lazos, grupos de silenciado (hi-hat),
//          round-robin (seq_* y lorand/hirand). Ignora regiones con condiciones de CC/keyswitch no por defecto.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const [inFile, outFile] = args
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const flag = (k) => args.includes('--' + k)
if (!inFile || !outFile) { console.error('uso: sfz2jwi.mjs <in.sfz> <out.jwi> --name X'); process.exit(1) }

const NOTE = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 }
function key(v) {
  if (v == null) return null
  v = String(v).trim().toLowerCase()
  if (/^-?\d+$/.test(v)) return parseInt(v, 10)
  const m = /^([a-g][#b]?)(-?\d+)$/.exec(v)
  if (!m) return null
  return (parseInt(m[2], 10) + 1) * 12 + NOTE[m[1]]
}

const defines = {}
function readSfz(file, seen = new Set()) {
  let txt = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const dir = path.dirname(file)
  const out = []
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    let m = /^#define\s+(\$\w+)\s+(.*)$/.exec(line)
    if (m) { defines[m[1]] = m[2].trim(); continue }
    m = /^#include\s+"(.+)"/.exec(line)
    if (m) {
      const inc = path.resolve(dir, m[1].replace(/\\/g, '/'))
      if (fs.existsSync(inc) && !seen.has(inc)) { seen.add(inc); out.push(...readSfz(inc, seen)) }
      continue
    }
    out.push(line)
  }
  return out
}
function subst(s) { return s.replace(/\$\w+/g, (k) => defines[k] ?? k) }

const lines = readSfz(inFile)
const text = subst(lines.join('\n'))
// Tokenizar: encabezados <x> y opcodes k=v (v puede contener espacios hasta el siguiente k=)
const tokens = []
{
  const re = /<(\w+)>|([A-Za-z_][\w$]*)=([^=<]*?)(?=\s+[A-Za-z_][\w$]*=|\s*<|\s*$)/gs
  let m
  while ((m = re.exec(text))) {
    if (m[1]) tokens.push({ h: m[1] })
    else tokens.push({ k: m[2], v: m[3].trim() })
  }
}
let control = {}, glob = {}, master = {}, group = {}
const regions = []
let cur = null, level = null
const flat = (...o) => Object.assign({}, ...o)
for (const t of tokens) {
  if (t.h) {
    level = t.h
    if (t.h === 'control') control = {}
    else if (t.h === 'global') { glob = {}; master = {}; group = {} }
    else if (t.h === 'master') { master = {}; group = {} }
    else if (t.h === 'group') group = {}
    else if (t.h === 'region') { cur = {}; regions.push({ cur, ctx: () => flat(glob, master, group) }); regions.at(-1).snap = null }
    continue
  }
  if (level === 'control') control[t.k] = t.v
  else if (level === 'global') glob[t.k] = t.v
  else if (level === 'master') master[t.k] = t.v
  else if (level === 'group') group[t.k] = t.v
  else if (level === 'region' && cur) {
    cur[t.k] = t.v
    // congelar el contexto (global/master/group) en el primer opcode de la región
    const r = regions.at(-1)
    if (!r.snap) r.snap = flat(glob, master, group)
  }
}
function ccDefault(n) {
  if (control['set_cc' + n] != null) return parseFloat(control['set_cc' + n])
  if (control['set_hdcc' + n] != null) return parseFloat(control['set_hdcc' + n]) * 127
  return 0
}
const defaultPath = (control.default_path ?? '').replace(/\\/g, '/')
const baseDir = path.dirname(path.resolve(inFile))
const velLayersMax = parseInt(opt('velLayers', '0'), 10)
const maxSec = parseFloat(opt('maxSec', '0'))
const keysRange = (opt('keys', '') || '').split('-').map(Number)

let out = []
for (const r of regions) {
  const o = flat(r.snap ?? {}, r.cur)
  if (!o.sample) continue
  if ((o.trigger ?? 'attack') === 'release' || o.trigger === 'release_key') { if (flag('dropRelease') || true) continue }
  if (o.trigger === 'first' || o.trigger === 'legato') continue
  // condiciones de CC (según los valores por defecto del <control>) o keyswitch distintos del estado inicial: se omiten
  let skip = false
  for (const k of Object.keys(o)) {
    let m = /^(locc|hicc)(\d+)$/.exec(k)
    if (m) {
      const cc = parseInt(m[2], 10)
      const dv = ccDefault(cc)
      const v = parseFloat(o[k])
      if (m[1] === 'locc' && dv < v) skip = true
      if (m[1] === 'hicc' && dv > v) skip = true
    }
    if (/^sw_(last|down|up|previous)$/.test(k)) {
      const def = key(o.sw_default)
      if (k === 'sw_last' && key(o[k]) !== def) skip = true
      if (k === 'sw_down' || k === 'sw_up' || k === 'sw_previous') skip = true
    }
  }
  if (skip) continue
  const lochan = o.lochan ? parseInt(o.lochan, 10) : 1
  if (lochan > 1) continue
  let lokey = key(o.lokey) ?? 0, hikey = key(o.hikey) ?? 127
  const k0 = key(o.key)
  if (k0 != null) { lokey = k0; hikey = k0 }
  let center = key(o.pitch_keycenter) ?? (k0 != null ? k0 : 60)
  const tune = (parseFloat(o.tune ?? 0) || 0) + (parseFloat(o.transpose ?? 0) || 0) * 100
  const sample = path.join(defaultPath, (o.sample ?? '').replace(/\\/g, '/')).replace(/\\/g, '/')
  const abs = path.resolve(baseDir, sample)
  if (!fs.existsSync(abs)) continue
  out.push({
    file: sample,
    lokey, hikey, center,
    lovel: parseInt(o.lovel ?? 1, 10), hivel: parseInt(o.hivel ?? 127, 10),
    tune: Math.round(tune), vol: parseFloat(o.volume ?? 0) || 0, pan: (parseFloat(o.pan ?? 0) || 0) / 100,
    attack: parseFloat(o.ampeg_attack ?? 0) || 0, release: parseFloat(o.ampeg_release ?? 0) || 0,
    loopStart: o.loop_mode && /loop/.test(o.loop_mode) && o.loop_start != null ? parseInt(o.loop_start, 10) : -1,
    loopEnd: o.loop_mode && /loop/.test(o.loop_mode) && o.loop_end != null ? parseInt(o.loop_end, 10) : -1,
    oneShot: o.loop_mode === 'one_shot' || flag('oneShotAll') ? 1 : 0,
    group: parseInt(o.group ?? 0, 10) || 0, offBy: parseInt(o.off_by ?? 0, 10) || 0,
    seqLen: parseInt(o.seq_length ?? 1, 10) || 1, seqPos: parseInt(o.seq_position ?? 1, 10) || 1,
    lorand: parseFloat(o.lorand ?? 0), hirand: parseFloat(o.hirand ?? 1),
    abs,
  })
}
if (keysRange.length === 2 && !Number.isNaN(keysRange[0])) out = out.filter((r) => r.hikey >= keysRange[0] && r.lokey <= keysRange[1])

// Reducción de capas de velocidad (memoria)
if (velLayersMax > 0) {
  const byKey = new Map()
  for (const r of out) {
    const k = `${r.lokey}-${r.hikey}-${r.center}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(r)
  }
  const kept = []
  for (const arr of byKey.values()) {
    const bands = [...new Set(arr.map((r) => `${r.lovel}-${r.hivel}`))].map((s) => s.split('-').map(Number)).sort((a, b) => a[0] - b[0])
    if (bands.length <= velLayersMax) { kept.push(...arr); continue }
    const pick = []
    for (let i = 0; i < velLayersMax; i++) pick.push(bands[Math.round(((i + 0.5) / velLayersMax) * bands.length - 0.5)])
    const uniq = [...new Set(pick.map((b) => b.join('-')))].map((s) => s.split('-').map(Number)).sort((a, b) => a[0] - b[0])
    // reasignar rangos para cubrir 1..127
    const map = new Map()
    uniq.forEach((b, i) => {
      const lo = i === 0 ? 1 : Math.floor((uniq[i - 1][1] + b[0]) / 2) + 1
      const hi = i === uniq.length - 1 ? 127 : Math.floor((b[1] + uniq[i + 1][0]) / 2)
      map.set(b.join('-'), [lo, hi])
    })
    for (const r of arr) {
      const m = map.get(`${r.lovel}-${r.hivel}`)
      if (!m) continue
      r.lovel = m[0]; r.hivel = m[1]
      kept.push(r)
    }
  }
  out = kept
}

// Round-robin: regiones con el mismo rango de teclas/velocidad y varias posiciones/aleatorios
const rrMap = new Map()
let rrNext = 1
for (const r of out) {
  const k = `${r.lokey}-${r.hikey}-${r.lovel}-${r.hivel}`
  if (!rrMap.has(k)) rrMap.set(k, [])
  rrMap.get(k).push(r)
}
for (const arr of rrMap.values()) {
  const multi = arr.length > 1 && arr.some((r) => r.seqLen > 1 || r.lorand > 0 || r.hirand < 1)
  if (multi) { const id = rrNext++; for (const r of arr) r.rr = id }
  else for (const r of arr) r.rr = 0
}

const name = opt('name', path.basename(inFile, '.sfz'))
const header = [
  `# Generado desde ${path.basename(inFile)} con sfz2jwi.mjs`,
  `name=${name}`,
  `gain=${opt('gain', '0')}`,
  `velGamma=${opt('velGamma', '0.5')}`,
  `release=${opt('release', '0.4')}`,
]
const rel = parseFloat(opt('release', '0.4'))
const lines2 = out.map((r) => {
  const relT = r.release > 0 ? r.release : rel
  const file = path.relative(path.dirname(path.resolve(outFile)), r.abs).replace(/\\/g, '/')
  return ['r', file, r.lokey, r.hikey, r.center, r.lovel, r.hivel, r.tune, r.vol, r.pan, r.attack, relT, r.loopStart, r.loopEnd, r.oneShot, r.group, r.offBy, r.rr, 0, maxSec].join('|')
})
// el formato real: r|archivo|lokey|hikey|center|lovel|hivel|tune|vol|pan|attack|release|loopStart|loopEnd|oneShot|group|offBy|rr|releaseTrigger|maxSec
fs.writeFileSync(outFile, [...header, ...lines2].join('\n') + '\n')
const files = new Set(out.map((r) => r.abs))
let bytes = 0
for (const f of files) bytes += fs.statSync(f).size
console.log(`${name}: ${out.length} regiones, ${files.size} muestras, ${(bytes / 1e6).toFixed(0)} MB en disco -> ${outFile}`)
