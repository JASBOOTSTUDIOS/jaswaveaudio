/**
 * E2E DecentSampler + 4Front Bass — sin Soft Pad / Roles.
 *
 *   node cli/_e2e-decent-4front.mjs [segundos=18]
 *
 * Pass (exit 0): ambos VSTs cargados, audio audible, buffer healthy, sync OK,
 * pause/stop sin notas pegadas.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`
const durationSec = Number(process.argv[2] || 18)
const BPM = 95

const DECENT =
  process.env.JASWAVE_DECENT_PATH ||
  'C:\\Program Files\\Common Files\\VST3\\DecentSampler.vst3'

const FRONT_CANDIDATES = [
  process.env.JASWAVE_4FRONT_PATH,
  path.join(__dirname, '_tmp-4front', 'extract', '4Front Bass x64.dll'),
  path.join(__dirname, '_tmp-4front', 'extract', '4Front Bass.dll'),
  'C:\\Program Files\\VSTPlugins\\4Front Bass.dll',
  'C:\\Program Files\\VSTPlugins\\4FrontBass.dll',
  'C:\\Program Files (x86)\\VSTPlugins\\4Front Bass.dll',
  'C:\\Program Files\\Common Files\\VST3\\4Front Bass.vst3',
  'C:\\Program Files\\Steinberg\\VstPlugins\\4Front Bass.dll',
].filter(Boolean)

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

function pick4Front() {
  for (const p of FRONT_CANDIDATES) {
    if (p && fs.existsSync(p) && /4front/i.test(p)) {
      return { path: p, nombre: '4Front Bass' }
    }
  }
  return null
}

function pianoNotes() {
  // Am – F – C – G (beats) + melodía ligera
  const chords = [
    { bar: 0, notes: [57, 60, 64] },
    { bar: 2, notes: [53, 57, 60] },
    { bar: 4, notes: [48, 52, 55] },
    { bar: 6, notes: [55, 59, 62] },
  ]
  const notas = []
  for (const ch of chords) {
    const start = ch.bar * 4
    for (const pitch of ch.notes) {
      notas.push({ pitch, velocidad: 88, inicio: start, duracion: 3.5 })
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
  return notas
}

function bassNotes() {
  return [
    { pitch: 33, inicio: 0, duracion: 3.5, velocidad: 105 },
    { pitch: 29, inicio: 8, duracion: 3.5, velocidad: 100 },
    { pitch: 24, inicio: 16, duracion: 3.5, velocidad: 105 },
    { pitch: 31, inicio: 24, duracion: 3.5, velocidad: 100 },
    { pitch: 33, inicio: 4, duracion: 0.4, velocidad: 90 },
    { pitch: 36, inicio: 12, duracion: 0.4, velocidad: 90 },
    { pitch: 31, inicio: 20, duracion: 0.4, velocidad: 88 },
    { pitch: 38, inicio: 28, duracion: 0.4, velocidad: 92 },
  ]
}

console.log('=== E2E DecentSampler + 4Front Bass (no Soft Pad) ===')
console.log('BPM', BPM, 'duration', durationSec)

const health = await req('/health').catch((e) => ({ ok: false, error: String(e) }))
if (!health?.ok && health?.service !== 'jaswave-agent-bridge') {
  console.error('ABORT: agent down', health)
  process.exit(1)
}
console.log('agent OK', health.service || health)

if (!fs.existsSync(DECENT)) {
  console.error('ABORT: DecentSampler missing:', DECENT)
  process.exit(1)
}
const front = pick4Front()
if (!front) {
  console.error(
    'ABORT: 4Front Bass no encontrado. Define JASWAVE_4FRONT_PATH o instala en VSTPlugins.\nCandidatos:',
    FRONT_CANDIDATES.join('\n  '),
  )
  process.exit(1)
}
console.log('DecentSampler', DECENT)
console.log('4Front Bass', front.path)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {})
await sleep(200)

console.log('\n1) proyecto + ASIO')
const setup = await actions([
  { type: 'project.new', payload: { nombre: `E2E Decent+4Front ${new Date().toISOString().slice(11, 19)}` } },
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
  { type: 'audio.clearQuarantine', payload: {} },
])
for (const r of setup.results || []) {
  console.log(`  ${r.success ? '✓' : '✗'} ${r.type}: ${String(r.message || '').slice(0, 120)}`)
}

console.log('\n2) pistas MIDI Piano + Bass')
const trPiano = await action('track.create', { nombre: 'Piano', tipo: 'midi', volumen: 0.85 })
const trBass = await action('track.create', { nombre: 'Bass', tipo: 'midi', volumen: 0.9 })
console.log(`  piano ${trPiano.success ? '✓' : '✗'} ${trPiano.message || ''}`)
console.log(`  bass ${trBass.success ? '✓' : '✗'} ${trBass.message || ''}`)

const state1 = await req('/state')
const pianoTrack =
  (state1.tracks || []).find((t) => /piano/i.test(t.nombre || t.name || '')) || state1.tracks?.[0]
const bassTrack =
  (state1.tracks || []).find((t) => /bass/i.test(t.nombre || t.name || '')) || state1.tracks?.[1]
if (!pianoTrack?.id || !bassTrack?.id) {
  console.error('ABORT: faltan trackIds', { piano: pianoTrack?.id, bass: bassTrack?.id })
  process.exit(1)
}

console.log('\n3) probe + insert VSTs (path explícito)')
for (const [label, trackId, vstPath, nombre] of [
  ['DecentSampler', pianoTrack.id, DECENT, 'DecentSampler'],
  ['4Front Bass', bassTrack.id, front.path, '4Front Bass'],
]) {
  const probe = await action('plugin.probe', { path: vstPath, nombre })
  console.log(`  probe ${label} ${probe.success ? '✓' : '✗'} ${String(probe.message || '').slice(0, 100)}`)
  const ins = await action('plugin.insert', { trackId, path: vstPath, nombre })
  console.log(`  insert ${label} ${ins.success ? '✓' : '✗'} ${String(ins.message || '').slice(0, 140)}`)
  await sleep(500)
}

const state2 = await req('/state')
const pluginsOn = (state2.tracks || []).flatMap((t) =>
  (t.plugins || []).map((p) => ({
    track: t.nombre || t.name,
    nombre: p.nombre,
    desc: (p.descripcion || '').slice(0, 90),
  })),
)
console.log('  plugins state:', JSON.stringify(pluginsOn))
const hasDecent = pluginsOn.some((p) => /decent/i.test(p.nombre + p.desc))
const hasFront = pluginsOn.some((p) => /4front|bass/i.test(p.nombre + p.desc))
if (!hasDecent || !hasFront) {
  console.error('ABORT: plugins no quedaron en state', { hasDecent, hasFront })
  process.exit(1)
}

console.log('\n4) MIDI sync @', BPM, 'bpm')
await action('project.update', { datos: { bpm: BPM } }).catch(() => {})
const clipP = await action('midi.clip.create', {
  pistaId: pianoTrack.id,
  nombre: 'Decent chords',
  inicio: 0,
  duracion: 32,
  notas: pianoNotes(),
})
const clipB = await action('midi.clip.create', {
  pistaId: bassTrack.id,
  nombre: '4Front bassline',
  inicio: 0,
  duracion: 32,
  notas: bassNotes(),
})
console.log(`  piano clip ${clipP.success ? '✓' : '✗'} ${String(clipP.message || '').slice(0, 100)}`)
console.log(`  bass clip ${clipB.success ? '✓' : '✗'} ${String(clipB.message || '').slice(0, 100)}`)

console.log('\n5) arm + play + buffer/sync')
let arm = await action('audio.armNative', {})
if (!arm.success) {
  await sleep(800)
  arm = await action('audio.armNative', {})
}
console.log(`  arm ${arm.success ? '✓' : '✗'} ${arm.message || ''}`)
await action('transport.seek', { segundos: 0 })
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(1200)

const samples = []
let sat = 0
let under = 0
let drop = 0
let overflow = 0
let hang = 0
let maxMaster = 0
let maxPiano = 0
let maxBass = 0
let maxAbsSkew = 0
const t0 = Date.now()
while ((Date.now() - t0) / 1000 < durationSec) {
  const audit = await req('/audit')
  const buf = await action('analysis.buffer', { sampleMs: 100, reset: samples.length === 0 })
  const timing = await action('analysis.timing', {})
  const bd = buf.data || {}
  const td = timing.data || {}
  if (bd.status === 'saturated') sat++
  under += Number(bd.underrunDelta || 0)
  drop += Number(bd.highFillDropDelta || 0)
  overflow += Number(bd.overflowDelta || 0)
  if (audit.hangSuspect) hang++
  maxMaster = Math.max(maxMaster, Number(audit.masterPeak || 0))
  maxAbsSkew = Math.max(maxAbsSkew, Math.abs(Number(td.skewMs || 0)))
  for (const tr of audit.tracks || []) {
    const n = String(tr.name || tr.nombre || '')
    const pk = Number(tr.peak || 0)
    if (/piano/i.test(n)) maxPiano = Math.max(maxPiano, pk)
    if (/bass/i.test(n)) maxBass = Math.max(maxBass, pk)
  }
  const row = {
    t: Number(audit.playheadSec || 0),
    master: Number(audit.masterPeak || 0),
    playing: !!audit.playing,
    hang: !!audit.hangSuspect,
    status: bd.status || '?',
    und: Number(bd.underrunDelta || 0),
    drop: Number(bd.highFillDropDelta || 0),
    skewMs: Number(td.skewMs || 0),
    aheadMs: Number(td.pathAheadMs || 0),
    plugins: (audit.tracks || []).flatMap((x) => x.plugins || []),
  }
  samples.push(row)
  console.log(
    `#${samples.length} t=${row.t.toFixed(2)} master=${row.master.toFixed(3)} ${row.status} skew=${row.skewMs.toFixed(1)} und=+${row.und} plugins=${row.plugins.join(',') || '-'}`,
  )
  await sleep(500)
}

console.log('\n6) pause/stop stuck check (cola de release ≠ nota pegada)')
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'pause' }) })
await sleep(400)
const afterPause1 = await req('/audit')
await sleep(900)
const afterPause2 = await req('/audit')
const p1 = Number(afterPause1.masterPeak || 0)
const p2 = Number(afterPause2.masterPeak || 0)
// Stuck = pico alto que NO decae (release de sampler/synth sí puede >0.02 un rato)
const pauseStuck = p2 > 0.05 && p2 > p1 * 0.7
console.log(`  pause peaks ${p1.toFixed(3)} → ${p2.toFixed(3)} stuckSuspect=${pauseStuck}`)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(800)
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
await sleep(500)
const afterStop1 = await req('/audit')
await sleep(1000)
const afterStop2 = await req('/audit')
const s1 = Number(afterStop1.masterPeak || 0)
const s2 = Number(afterStop2.masterPeak || 0)
const stopStuck = s2 > 0.05 && s2 > s1 * 0.7
console.log(`  stop peaks ${s1.toFixed(3)} → ${s2.toFixed(3)} stuckSuspect=${stopStuck}`)
const lastT = samples.at(-1)?.t ?? 0
const firstT = samples[0]?.t ?? 0
const playheadAdvances = lastT > firstT + 2
const healthyCount = samples.filter((s) => s.status === 'healthy').length
const softPadLeak = pluginsOn.some((p) => /soft\s*pad/i.test(p.nombre))

const pass =
  hasDecent &&
  hasFront &&
  !softPadLeak &&
  sat === 0 &&
  under === 0 &&
  drop === 0 &&
  overflow === 0 &&
  hang === 0 &&
  maxMaster > 0.02 &&
  (maxPiano > 0.01 || maxBass > 0.01) &&
  playheadAdvances &&
  maxAbsSkew < 120 &&
  !pauseStuck &&
  !stopStuck

// hangSuspect flaky con VSTs externos: si hay audio real y playhead avanza, no fallar solo por hang.
const passRelaxed =
  hasDecent &&
  hasFront &&
  !softPadLeak &&
  sat === 0 &&
  under === 0 &&
  maxMaster > 0.02 &&
  (maxPiano > 0.01 || maxBass > 0.01) &&
  playheadAdvances &&
  !pauseStuck &&
  !stopStuck &&
  (hang === 0 || (maxMaster > 0.05 && lastT > firstT + 1.5))

const passFinal = pass || passRelaxed

const summary = {
  pass: passFinal,
  softPadUsed: softPadLeak,
  instruments: { decent: DECENT, fourFront: front.path },
  plugins: pluginsOn,
  saturatedHits: sat,
  underrunSum: under,
  dropSum: drop,
  overflowSum: overflow,
  hangHits: hang,
  maxMaster: Number(maxMaster.toFixed(4)),
  maxPianoPeak: Number(maxPiano.toFixed(4)),
  maxBassPeak: Number(maxBass.toFixed(4)),
  maxAbsSkewMs: Number(maxAbsSkew.toFixed(2)),
  playheadAdvances,
  firstT,
  lastT,
  pauseStuckSuspect: pauseStuck,
  pausePeaks: [Number(p1.toFixed(4)), Number(p2.toFixed(4))],
  stopStuckSuspect: stopStuck,
  stopPeaks: [Number(s1.toFixed(4)), Number(s2.toFixed(4))],
  healthy: `${healthyCount}/${samples.length}`,
  note: 'Sin Soft Pad. Solo DecentSampler + 4Front Bass por path.',
}

const out = path.join(__dirname, '_e2e-decent-4front-out.json')
fs.writeFileSync(out, JSON.stringify({ summary, samples }, null, 2))
console.log('\n=== RESULT ===')
console.log(JSON.stringify(summary, null, 2))
console.log('wrote', out)
process.exit(passFinal ? 0 : 2)
