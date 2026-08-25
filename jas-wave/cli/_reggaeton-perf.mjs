/**
 * Reggaetón completo + stress de buffer (JasWave Roles nativo).
 *   node cli/_reggaeton-perf.mjs [segundos=16] [intervalMs=400]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`
const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function req(p, opts = {}, timeoutMs = 120000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${p}`, {
      ...opts,
      signal: ac.signal,
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
  } finally {
    clearTimeout(timer)
  }
}

async function actions(list) {
  return req('/actions', { method: 'POST', body: JSON.stringify({ actions: list }) })
}

async function action(type, payload = {}) {
  const r = await actions([{ type, payload }])
  return r.results?.[0] || r
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const durationSec = Number(process.argv[2] || 16)
const intervalMs = Number(process.argv[3] || 400)
const stamp = new Date().toISOString().slice(11, 19)

console.log(`=== REGGAETON PERF ${durationSec}s @ ${intervalMs}ms ===`)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
await sleep(300)

console.log('\n1) project.new + ASIO 48k/1024')
const setup = await actions([
  { type: 'project.new', payload: { nombre: `Reggaeton ${stamp}` } },
  {
    type: 'audio.setDevice',
    payload: {
      backend: 'asio',
      deviceId: 'asio:UMC ASIO Driver',
      sampleRate: 48000,
      bufferSize: 1024,
    },
  },
])
for (const r of setup.results || []) {
  console.log(`  ${r.success ? '✓' : '✗'} ${r.type}: ${String(r.message || '').slice(0, 120)}`)
}

console.log('\n2) Music Build reggaetón (JasWave Roles nativo)')
const build = await action('daw.musicBuild', {
  aplicar: true,
  softPadOnly: true,
  prompt:
    'reggaeton dembow 95 bpm Am urbano latin trap dembow kick snare hats bass 808 piano keys synth lead catchy chorus',
  bpm: 95,
  nombre: `Reggaeton Dembow ${stamp}`,
  minutos: 1.2,
  genero: 'reggaeton',
  tonalidad: 'Am',
  progresion: [1, 5, 6, 4],
  secciones: [
    { name: 'Intro', bars: 4, kind: 'intro', density: 0.4 },
    { name: 'Verse', bars: 8, kind: 'verse', density: 0.55 },
    { name: 'Chorus', bars: 8, kind: 'chorus', density: 0.85 },
    { name: 'Verse 2', bars: 8, kind: 'verse', density: 0.6 },
    { name: 'Chorus 2', bars: 8, kind: 'chorus', density: 0.9 },
    { name: 'Outro', bars: 4, kind: 'outro', density: 0.35 },
  ],
  pistas: [
    { nombre: 'Dembow', rol: 'drums', tipo: 'midi', articulacion: 'kit' },
    { nombre: '808 Bass', rol: 'bass', tipo: 'midi', articulacion: 'bass' },
    { nombre: 'Keys', rol: 'keys', tipo: 'midi', articulacion: 'block' },
    { nombre: 'Synth Lead', rol: 'lead', tipo: 'midi', articulacion: 'melody' },
    { nombre: 'Pad', rol: 'pad', tipo: 'midi', articulacion: 'pad' },
  ],
})
console.log(`  ${build.success ? '✓' : '✗'} ${String(build.message || '').slice(0, 220)}`)
if (!build.success) {
  console.error('ABORT: musicBuild falló')
  process.exit(1)
}

await action('master.update', { datos: { volumen: 0.85 } })
await sleep(2500)

console.log('\n3) armNative')
let arm = await action('audio.armNative', {})
if (!arm.success) {
  await sleep(1000)
  arm = await action('audio.armNative', {})
}
console.log(`  ${arm.success ? '✓' : '✗'} ${arm.message}`)

const state = await req('/state')
const tracks = state.tracks || []
console.log(`\n  tracks=${tracks.length}`)
for (const t of tracks) {
  const plugs = (t.plugins || t.pluginNames || []).join?.(',') || JSON.stringify(t.plugins || []).slice(0, 80)
  console.log(
    `  - ${t.nombre || t.name} mute=${!!(t.silenciada || t.muted)} plugins=${plugs}`,
  )
  if (t.silenciada || t.muted) {
    await action('track.toggleMute', { trackId: t.id })
  }
}

await action('transport.seek', { segundos: 0 })
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(800)

console.log('\n4) Buffer stress')
const samples = []
const t0 = Date.now()
let maxFill = 0
let maxFillRatio = 0
let saturatedHits = 0
let starvingHits = 0
let hangHits = 0

while ((Date.now() - t0) / 1000 < durationSec) {
  const iterT0 = Date.now()
  const audit = await req('/audit')
  const buf = await action('analysis.buffer', { sampleMs: 100, reset: samples.length === 0 })
  const td = (await action('analysis.timing', {})).data || {}
  const bd = buf.data || {}
  const fill = Math.max(Number(bd.ring?.dawFill ?? 0), Number(bd.ring?.maxLiveFill ?? 0))
  const target = Number(bd.ring?.targetFill ?? 1)
  const high = Number(bd.ring?.highFill ?? target * 2)
  const ratio = target > 0 ? fill / target : 0
  maxFill = Math.max(maxFill, fill)
  maxFillRatio = Math.max(maxFillRatio, ratio)
  if (bd.status === 'saturated') saturatedHits++
  if (bd.status === 'starving') starvingHits++
  if (audit.hangSuspect) hangHits++
  const row = {
    t: Number(audit.playheadSec || 0),
    master: Number(audit.masterPeak || 0),
    hang: Boolean(audit.hangSuspect),
    hostOk: audit.hostOk !== false,
    status: bd.status || '?',
    fill,
    dawFill: Number(bd.ring?.dawFill ?? 0),
    maxLive: Number(bd.ring?.maxLiveFill ?? 0),
    target,
    high,
    ratio: Number(ratio.toFixed(2)),
    underrun: Number(bd.underrunDelta || 0),
    drop: Number(bd.highFillDropDelta || 0),
    overflow: Number(bd.overflowDelta || 0),
    queue: Number(bd.mixQueueDepth || 0),
    skewMs: Number(td.skewMs || 0),
    iterMs: Date.now() - iterT0,
  }
  samples.push(row)
  console.log(
    `#${samples.length} t=${row.t.toFixed(2)} master=${row.master.toFixed(3)} ${row.status} fill=${row.fill}/${row.target} (×${row.ratio}) q=${row.queue} und=+${row.underrun} drop=+${row.drop} iter=${row.iterMs}ms${row.hang ? ' HANG' : ''}`,
  )
  await sleep(intervalMs)
}

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })

const totalUnderrun = samples.reduce((a, s) => a + s.underrun, 0)
const totalDrop = samples.reduce((a, s) => a + s.drop, 0)
const totalOverflow = samples.reduce((a, s) => a + s.overflow, 0)
const avgMaster = samples.reduce((a, s) => a + s.master, 0) / Math.max(1, samples.length)
const maxMaster = Math.max(...samples.map((s) => s.master), 0)
const playheadOk = samples.filter((s) => s.t > 0.2).length >= Math.floor(samples.length * 0.5)
const healthyN = samples.filter((s) => s.status === 'healthy').length
const maxIterMs = Math.max(...samples.map((s) => s.iterMs || 0), 0)
const hostOk = samples.every((s) => s.hostOk !== false)

const verdict = {
  ok:
    playheadOk &&
    hostOk &&
    hangHits === 0 &&
    saturatedHits === 0 &&
    starvingHits <= 1 &&
    totalUnderrun === 0 &&
    totalDrop === 0 &&
    totalOverflow === 0 &&
    maxFillRatio < 1.85 &&
    avgMaster > 0.001 &&
    healthyN >= Math.ceil(samples.length * 0.6) &&
    samples.length >= Math.max(8, Math.floor((durationSec / (intervalMs / 1000)) * 0.5)) &&
    maxIterMs < 2500,
  playheadOk,
  hostOk,
  hangHits,
  saturatedHits,
  starvingHits,
  totalUnderrun,
  totalDrop,
  totalOverflow,
  maxFill,
  maxFillRatio: Number(maxFillRatio.toFixed(2)),
  avgMaster: Number(avgMaster.toFixed(4)),
  maxMaster: Number(maxMaster.toFixed(4)),
  maxIterMs,
  healthy: `${healthyN}/${samples.length}`,
  sampleCount: samples.length,
  durationSec,
  tracks: tracks.length,
}

const out = path.join(__dirname, '_reggaeton-perf-out.json')
fs.writeFileSync(out, JSON.stringify({ verdict, samples, tracks: tracks.map((t) => ({ id: t.id, name: t.nombre || t.name, plugins: t.plugins })) }, null, 2))
console.log('\nVERDICT', JSON.stringify(verdict, null, 2))
console.log('wrote', out)
process.exit(verdict.ok ? 0 : 2)
