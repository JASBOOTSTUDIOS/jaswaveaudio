/**
 * Prueba básica: 1 pista Piano nativo.
 * Prefiere JasWavePiano.vst3 (Karplus-Strong); fallback JasWave Roles Role=piano.
 *
 *   node cli/_one-track-piano.mjs [segundos=10]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`
const PIANO_PATH =
  process.env.JASWAVE_PIANO_PATH ||
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Common', 'VST3', 'JasWave', 'JasWavePiano.vst3')
const ROLES_PATH =
  process.env.JASWAVE_ROLES_PATH ||
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Common', 'VST3', 'JasWave', 'JasWaveRoles.vst3')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const durationSec = Number(process.argv[2] || 10)

async function req(p, opts = {}, timeoutMs = 90000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
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
    clearTimeout(t)
  }
}

async function actions(list) {
  return req('/actions', { method: 'POST', body: JSON.stringify({ actions: list }) })
}
async function action(type, payload = {}) {
  return (await actions([{ type, payload }])).results?.[0] || {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const usePiano = fs.existsSync(PIANO_PATH)
const pluginPath = usePiano ? PIANO_PATH : ROLES_PATH
const pluginName = usePiano ? 'JasWave Piano Synth' : 'JasWave Roles'

console.log('=== ONE TRACK PIANO (native) ===')
console.log('instrument:', pluginName, pluginPath, 'exists=', fs.existsSync(pluginPath))
if (!fs.existsSync(pluginPath)) {
  console.error('ABORT: ni Piano ni Roles instalados')
  process.exit(1)
}

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {})
await sleep(200)

console.log('\n1) proyecto vacío + ASIO')
const setup = await actions([
  { type: 'project.new', payload: { nombre: `Piano Solo ${new Date().toISOString().slice(11, 19)}` } },
  {
    type: 'audio.setDevice',
    payload: {
      backend: 'asio',
      deviceId: 'asio:UMC ASIO Driver',
      sampleRate: 48000,
      bufferSize: 1024,
    },
  },
  { type: 'master.update', payload: { datos: { volumen: 0.85 } } },
])
for (const r of setup.results || []) {
  console.log(`  ${r.success ? '✓' : '✗'} ${r.type}: ${String(r.message || '').slice(0, 100)}`)
}

console.log('\n2) 1 pista MIDI Piano')
const tr = await action('track.create', { nombre: 'Piano', tipo: 'midi', volumen: 0.85 })
console.log(`  ${tr.success ? '✓' : '✗'} ${tr.message || ''}`)
const state1 = await req('/state')
const track = (state1.tracks || []).find((t) => /piano/i.test(t.nombre || t.name || '')) || state1.tracks?.[0]
if (!track?.id) {
  console.error('ABORT: sin trackId')
  process.exit(1)
}

console.log('\n3) insert', pluginName)
const probe = await action('plugin.probe', { path: pluginPath, nombre: pluginName })
console.log(`  probe ${probe.success ? '✓' : '✗'} ${String(probe.message || '').slice(0, 100)}`)
const ins = await action('plugin.insert', {
  trackId: track.id,
  path: pluginPath,
  nombre: pluginName,
})
console.log(`  insert ${ins.success ? '✓' : '✗'} ${String(ins.message || '').slice(0, 140)}`)
await sleep(700)

if (!usePiano) {
  const state2 = await req('/state')
  const tr2 = (state2.tracks || []).find((t) => t.id === track.id)
  const plug = (tr2?.plugins || []).at(-1)
  if (plug?.id) {
    const sp = await action('plugin.setParameter', {
      trackId: track.id,
      pluginInstanceId: plug.id,
      parameterId: 0,
      normalizedValue: 3 / 12,
    })
    console.log(`  setRole piano ${sp.success ? '✓' : '✗'}`)
  }
}

console.log('\n4) clip MIDI')
const chordBars = [
  { bar: 0, notes: [57, 60, 64] },
  { bar: 2, notes: [53, 57, 60] },
  { bar: 4, notes: [48, 52, 55] },
  { bar: 6, notes: [55, 59, 62] },
]
const notas = []
for (const ch of chordBars) {
  const start = ch.bar * 4
  const dur = 3.5
  for (const pitch of ch.notes) {
    notas.push({ pitch, velocidad: 90, inicio: start, duracion: dur })
  }
}
for (const [pitch, beat, len] of [
  [72, 0, 1],
  [74, 1, 1],
  [76, 2, 2],
  [74, 4, 1],
  [72, 5, 1],
  [71, 6, 2],
]) {
  notas.push({ pitch, velocidad: 100, inicio: beat, duracion: len })
}

const clip = await action('midi.clip.create', {
  pistaId: track.id,
  nombre: 'Piano Phrase',
  inicio: 0,
  duracion: 32,
  notas,
})
console.log(`  clip ${clip.success ? '✓' : '✗'} ${String(clip.message || '').slice(0, 140)}`)

console.log('\n5) arm + play + pause check')
await action('audio.armNative', {})
await action('transport.seek', { segundos: 0 })
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(2500)

const mid = await req('/audit')
const midPeak = Number(mid.masterPeak || 0)
console.log(`  mid peak=${midPeak.toFixed(3)}`)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'pause' }) })
await sleep(400)
const afterPause1 = await req('/audit')
await sleep(600)
const afterPause2 = await req('/audit')
const p1 = Number(afterPause1.masterPeak || 0)
const p2 = Number(afterPause2.masterPeak || 0)
const stuck = p2 > 0.02 && p2 > p1 * 0.5
console.log(`  after pause peaks: ${p1.toFixed(3)} → ${p2.toFixed(3)} stuckSuspect=${stuck}`)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(400)

console.log('\n6) buffer')
const samples = []
const t0 = Date.now()
let sat = 0
let under = 0
let maxMaster = 0
while ((Date.now() - t0) / 1000 < durationSec) {
  const audit = await req('/audit')
  const buf = await action('analysis.buffer', { sampleMs: 80, reset: samples.length === 0 })
  const bd = buf.data || {}
  if (bd.status === 'saturated') sat++
  under += Number(bd.underrunDelta || 0)
  maxMaster = Math.max(maxMaster, Number(audit.masterPeak || 0))
  samples.push({
    t: Number(audit.playheadSec || 0),
    master: Number(audit.masterPeak || 0),
    status: bd.status,
  })
  console.log(
    `#${samples.length} t=${samples.at(-1).t.toFixed(2)} master=${samples.at(-1).master.toFixed(3)} ${bd.status}`,
  )
  await sleep(500)
}

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
await sleep(300)
const afterStop = await req('/audit')
const stopStuck = Number(afterStop.masterPeak || 0) > 0.015

const auditF = await req('/audit')
const plugNames = (auditF.tracks || []).flatMap((t) => t.plugins || [])
const pass =
  sat === 0 &&
  under === 0 &&
  maxMaster > 0.02 &&
  midPeak > 0.02 &&
  !stuck &&
  !stopStuck &&
  plugNames.length > 0

const summary = {
  pass,
  instrument: pluginName,
  usePianoVst: usePiano,
  saturatedHits: sat,
  underrunSum: under,
  maxMaster: Number(maxMaster.toFixed(4)),
  midPeak: Number(midPeak.toFixed(4)),
  pauseStuckSuspect: stuck,
  stopStuckSuspect: stopStuck,
  plugins: plugNames,
}
fs.writeFileSync(path.join(__dirname, '_one-track-piano-out.json'), JSON.stringify({ summary, samples }, null, 2))
console.log('\n=== RESULT ===')
console.log(JSON.stringify(summary, null, 2))
process.exit(pass ? 0 : 2)
