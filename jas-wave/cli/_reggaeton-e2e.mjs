/**
 * Reggaetón end-to-end: musicBuild + insert JasWaveRoles por path + buffer stress.
 *   node cli/_reggaeton-e2e.mjs [segundos=14]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`
const ROLES = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'Programs',
  'Common',
  'VST3',
  'JasWave',
  'JasWaveRoles.vst3',
)
const ROLE_NORM = {
  drums: 0 / 12,
  bass: 1 / 12,
  keys: 4 / 12,
  lead: 8 / 12,
  pad: 5 / 12,
  default: 12 / 12,
}

async function req(p, opts = {}, timeoutMs = 60000) {
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
    if (!res.ok) throw new Error(json.error || res.statusText)
    return json
  } finally {
    clearTimeout(t)
  }
}
async function actions(list, timeoutMs = 120000) {
  return req('/actions', { method: 'POST', body: JSON.stringify({ actions: list }) }, timeoutMs)
}
async function action(type, payload = {}, timeoutMs) {
  return (await actions([{ type, payload }], timeoutMs)).results?.[0] || {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function roleOf(name) {
  const n = String(name || '').toLowerCase()
  if (/dembow|drum|bater|kit/.test(n)) return 'drums'
  if (/bass|808|bajo/.test(n)) return 'bass'
  if (/key|piano/.test(n)) return 'keys'
  if (/lead|synth/.test(n)) return 'lead'
  if (/pad/.test(n)) return 'pad'
  return 'default'
}

const durationSec = Number(process.argv[2] || 14)
const stamp = new Date().toISOString().slice(11, 19)
console.log('Roles exists?', fs.existsSync(ROLES), ROLES)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {})
await sleep(200)

console.log('\n1) project + ASIO')
for (const r of (
  await actions([
    { type: 'project.new', payload: { nombre: `Reggaeton E2E ${stamp}` } },
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
).results || []) {
  console.log(`  ${r.success ? '✓' : '✗'} ${r.type}: ${String(r.message || '').slice(0, 100)}`)
}

console.log('\n2) musicBuild rolesOnly (Piano/Roles — sin doble insert)')
const build = await action(
  'daw.musicBuild',
  {
    aplicar: true,
    rolesOnly: true,
    softPadOnly: true,
    prompt: 'reggaeton dembow 95 bpm Am corto',
    bpm: 95,
    nombre: `Reggaeton E2E ${stamp}`,
    minutos: 0.5,
    genero: 'reggaeton',
    tonalidad: 'Am',
    progresion: [1, 5, 6, 4],
    secciones: [
      { name: 'Intro', bars: 2, kind: 'intro', density: 0.4 },
      { name: 'Verse', bars: 4, kind: 'verse', density: 0.55 },
      { name: 'Chorus', bars: 4, kind: 'chorus', density: 0.85 },
    ],
    pistas: [
      { nombre: 'Dembow', rol: 'drums', tipo: 'midi', articulacion: 'kit' },
      { nombre: '808 Bass', rol: 'bass', tipo: 'midi', articulacion: 'bass' },
      { nombre: 'Keys', rol: 'keys', tipo: 'midi', articulacion: 'block' },
      { nombre: 'Lead', rol: 'lead', tipo: 'midi', articulacion: 'melody' },
      { nombre: 'Pad', rol: 'pad', tipo: 'midi', articulacion: 'pad' },
    ],
  },
  240000,
)
console.log(`  ${build.success ? '✓' : '✗'} ${String(build.message || '').slice(0, 180)}`)

await action('master.update', { datos: { volumen: 0.82 } })
await sleep(800)

const st = await req('/state')
const tracks = (st.tracks || []).filter((t) => t.tipo === 'midi' || t.tipo === 'instrumento')
console.log(`\n3) Roles ya en musicBuild — set role params only (${tracks.length} tracks)`)
for (const t of tracks) {
  const role = roleOf(t.nombre)
  const plugs = t.plugins || []
  const hasJas =
    plugs.some((p) => /jaswave\s*(roles|piano)/i.test(p.nombre || p.name || '')) || plugs.length > 0
  if (!hasJas && fs.existsSync(ROLES)) {
    const ins = await action(
      'plugin.insert',
      { trackId: t.id, path: ROLES, nombre: 'JasWave Roles' },
      90000,
    )
    console.log(`  ${t.nombre}: insert ${ins.success ? '✓' : '✗'} ${String(ins.message || '').slice(0, 100)}`)
    await sleep(500)
  } else {
    console.log(`  ${t.nombre}: ya instrumentado (${plugs.map((p) => p.nombre || p.name).join(', ') || plugs.length})`)
  }
  const st2 = await req('/state')
  const tr = (st2.tracks || []).find((x) => x.id === t.id)
  const rolesPlug = (tr?.plugins || []).find((p) => /jaswave\s*roles/i.test(p.nombre || p.name || ''))
  const last = rolesPlug || (tr?.plugins || [])[(tr?.plugins || []).length - 1]
  if (last?.id && /jaswave\s*roles/i.test(last.nombre || last.name || '')) {
    const sp = await action('plugin.setParameter', {
      trackId: t.id,
      pluginInstanceId: last.id,
      parameterId: 0,
      normalizedValue: ROLE_NORM[role] ?? 0.5,
    })
    console.log(`    role=${role} param: ${sp.success ? '✓' : '✗'}`)
  } else {
    console.log(`    role=${role} (piano/native — sin param Roles)`)
  }
}

await action('audio.armNative', {})
await sleep(400)
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {})
await action('transport.seek', { segundos: 0 }).catch(() => {})
await sleep(200)
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) }).catch(() => {})
// Re-seek si el host quedó en playhead residual de la fase anterior.
for (let i = 0; i < 4; i++) {
  await sleep(400)
  let a
  try {
    a = await req('/audit', {}, 15000)
  } catch {
    break
  }
  if (a.playing && Number(a.playheadSec || 99) < 3) break
  await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {})
  await action('transport.seek', { segundos: 0 }).catch(() => {})
  await sleep(150)
  await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) }).catch(() => {})
}
await sleep(500)

console.log('\n4) buffer')
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
  const bd = buf.data || {}
  const fill = Math.max(Number(bd.ring?.dawFill ?? 0), Number(bd.ring?.maxLiveFill ?? 0))
  const target = Number(bd.ring?.targetFill ?? 1) || 1
  const ratio = fill / target
  maxFill = Math.max(maxFill, fill)
  maxFillRatio = Math.max(maxFillRatio, ratio)
  if (bd.status === 'saturated') saturatedHits++
  if (bd.status === 'starving') starvingHits++
  if (audit.hangSuspect) hangHits++
  const row = {
    t: Number(audit.playheadSec || 0),
    master: Number(audit.masterPeak || 0),
    status: bd.status || '?',
    fill,
    target,
    ratio: Number(ratio.toFixed(2)),
    underrun: Number(bd.underrunDelta || 0),
    drop: Number(bd.highFillDropDelta || 0),
    overflow: Number(bd.overflowDelta || 0),
    hang: Boolean(audit.hangSuspect),
    iterMs: Date.now() - iterT0,
  }
  samples.push(row)
  console.log(
    `#${samples.length} t=${row.t.toFixed(2)} master=${row.master.toFixed(3)} ${row.status} fill=${row.fill}/${row.target} (×${row.ratio}) und=+${row.underrun} drop=+${row.drop} iter=${row.iterMs}ms`,
  )
  await sleep(400)
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
const stFinal = await req('/state')
const plugged = (stFinal.tracks || []).map((t) => ({
  name: t.nombre,
  plugins: (t.plugins || []).map((p) => p.nombre || p.name || p.id),
}))

const verdict = {
  ok:
    playheadOk &&
    hangHits <= 2 &&
    saturatedHits === 0 &&
    starvingHits <= 1 &&
    totalUnderrun === 0 &&
    totalDrop === 0 &&
    totalOverflow === 0 &&
    maxFillRatio < 1.85 &&
    avgMaster > 0.001 &&
    maxMaster > 0.02 &&
    // Tras fases pesadas analysis.buffer a veces reporta unknown; priorizar audio real.
    (healthyN >= Math.ceil(samples.length * 0.4) || maxMaster > 0.05) &&
    maxIterMs < 8000 &&
    plugged.some((t) => (t.plugins || []).length > 0),
  playheadOk,
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
  plugged,
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '_reggaeton-e2e-out.json')
fs.writeFileSync(out, JSON.stringify({ verdict, samples }, null, 2))
console.log('\nVERDICT', JSON.stringify(verdict, null, 2))
console.log('wrote', out)
process.exit(verdict.ok ? 0 : 2)
