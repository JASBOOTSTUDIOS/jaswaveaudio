/**
 * Stress test: play N segundos midiendo buffer (saturación / underrun / drop / fill).
 * Exit 0 = OK profesional, 2 = saturado o inestable.
 *
 *   node cli/_stress-buffer.mjs [segundos=12] [intervalMs=400]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`
const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function req(p, opts = {}) {
  const res = await fetch(`${BASE}${p}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!res.ok) throw new Error(json.error || res.statusText || `HTTP ${res.status}`)
  return json
}

async function action(type, payload = {}) {
  const r = await req('/actions', {
    method: 'POST',
    body: JSON.stringify({ actions: [{ type, payload }] }),
  })
  return r.results?.[0] || r
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const durationSec = Number(process.argv[2] || 12)
const intervalMs = Number(process.argv[3] || 400)

console.log(`stress-buffer: ${durationSec}s @ ${intervalMs}ms`)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
await sleep(200)
console.log('ARM', (await action('audio.armNative', {})).message)
const wantEnsure = process.argv.includes('--ensure')
if (wantEnsure) {
  console.log('ENSURE', (await action('audio.ensureBest', {})).message)
} else {
  console.log('ENSURE skipped (pasa --ensure para forzar; evita re-load VST que tumba el host)')
}
await action('transport.seek', { segundos: 0 })
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(400)

const samples = []
const t0 = Date.now()
let maxFill = 0
let maxFillRatio = 0
let saturatedHits = 0
let starvingHits = 0

while ((Date.now() - t0) / 1000 < durationSec) {
  const audit = await req('/audit')
  const buf = await action('analysis.buffer', { sampleMs: 100, reset: samples.length === 0 })
  const td = (await action('analysis.timing', {})).data || {}
  const bd = buf.data || {}
  const fill = Number(bd.ring?.maxLiveFill ?? bd.ring?.dawFill ?? 0)
  const target = Number(bd.ring?.targetFill ?? 1)
  const high = Number(bd.ring?.highFill ?? target * 2)
  const ratio = target > 0 ? fill / target : 0
  maxFill = Math.max(maxFill, fill)
  maxFillRatio = Math.max(maxFillRatio, ratio)
  if (bd.status === 'saturated') saturatedHits++
  if (bd.status === 'starving') starvingHits++
  const row = {
    t: Number(audit.playheadSec || 0),
    master: Number(audit.masterPeak || 0),
    status: bd.status || '?',
    fill,
    target,
    high,
    ratio: Number(ratio.toFixed(2)),
    underrun: Number(bd.underrunDelta || 0),
    drop: Number(bd.highFillDropDelta || 0),
    overflow: Number(bd.overflowDelta || 0),
    skewMs: Number(td.skewMs || 0),
  }
  samples.push(row)
  console.log(
    `#${samples.length} t=${row.t.toFixed(2)} master=${row.master.toFixed(3)} ${row.status} fill=${row.fill}/${row.target} (×${row.ratio}) underrun=+${row.underrun} drop=+${row.drop} skew=${row.skewMs.toFixed(1)}`,
  )
  await sleep(intervalMs)
}

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })

const totalUnderrun = samples.reduce((a, s) => a + s.underrun, 0)
const totalDrop = samples.reduce((a, s) => a + s.drop, 0)
const totalOverflow = samples.reduce((a, s) => a + s.overflow, 0)
const avgMaster = samples.reduce((a, s) => a + s.master, 0) / Math.max(1, samples.length)
const playheadOk = samples.filter((s) => s.t > 0.2).length >= Math.floor(samples.length * 0.5)

const verdict = {
  ok:
    playheadOk &&
    saturatedHits === 0 &&
    starvingHits <= 1 &&
    totalUnderrun === 0 &&
    totalDrop === 0 &&
    totalOverflow === 0 &&
    maxFillRatio < 1.85 &&
    avgMaster > 0.001,
  playheadOk,
  saturatedHits,
  starvingHits,
  totalUnderrun,
  totalDrop,
  totalOverflow,
  maxFill,
  maxFillRatio: Number(maxFillRatio.toFixed(2)),
  avgMaster: Number(avgMaster.toFixed(4)),
  sampleCount: samples.length,
  durationSec,
}

const out = path.join(__dirname, '_stress-buffer-out.json')
fs.writeFileSync(out, JSON.stringify({ verdict, samples }, null, 2))
console.log('\nVERDICT', JSON.stringify(verdict, null, 2))
console.log('wrote', out)
process.exit(verdict.ok ? 0 : 2)
