/**
 * Inserta JasWave Roles en pistas MIDI del proyecto actual + stress buffer.
 *   node cli/_reggaeton-arm-roles.mjs [segundos=14]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`
const ROLES_PATH =
  process.env.JASWAVE_ROLES_PATH ||
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Common', 'VST3', 'JasWave', 'JasWaveRoles.vst3')

const ROLE_NORM = {
  drums: 0 / 12,
  bass: 1 / 12,
  guitar: 2 / 12,
  piano: 3 / 12,
  keys: 4 / 12,
  pad: 5 / 12,
  strings: 6 / 12,
  choir: 7 / 12,
  lead: 8 / 12,
  brass: 9 / 12,
  synth: 10 / 12,
  percussion: 11 / 12,
  default: 1,
}

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
    if (!res.ok) throw new Error(json.error || res.statusText)
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

function roleOfTrack(name) {
  const n = String(name || '').toLowerCase()
  if (/dembow|drum|bater|kit|perc/.test(n)) return 'drums'
  if (/bass|808|bajo/.test(n)) return 'bass'
  if (/key|piano/.test(n)) return 'keys'
  if (/lead|synth lead|melody/.test(n)) return 'lead'
  if (/pad/.test(n)) return 'pad'
  return 'default'
}

const durationSec = Number(process.argv[2] || 14)
const intervalMs = 400

console.log('Roles path exists?', fs.existsSync(ROLES_PATH), ROLES_PATH)

console.log('\n1) probe Roles')
const probe = await action('plugin.probe', { path: ROLES_PATH, nombre: 'JasWave Roles' })
console.log(' ', probe.success ? '✓' : '✗', probe.message)

const state = await req('/state')
const tracks = (state.tracks || []).filter((t) => t.tipo === 'midi' || t.tipo === 'instrumento')
console.log(`\n2) insert Roles on ${tracks.length} tracks`)

for (const t of tracks) {
  const role = roleOfTrack(t.nombre)
  const ins = await action('plugin.insert', {
    trackId: t.id,
    path: ROLES_PATH,
    nombre: 'JasWave Roles',
  })
  console.log(`  insert ${t.nombre} (${role}): ${ins.success ? '✓' : '✗'} ${String(ins.message || '').slice(0, 100)}`)
  await sleep(400)
  // set role param on last plugin if we can get instance id from state
  const st2 = await req('/state')
  const tr = (st2.tracks || []).find((x) => x.id === t.id)
  const plugs = tr?.plugins || []
  const last = plugs[plugs.length - 1]
  if (last?.id) {
    const sp = await action('plugin.setParameter', {
      trackId: t.id,
      pluginInstanceId: last.id,
      parameterId: 0,
      normalizedValue: ROLE_NORM[role] ?? 0.5,
    })
    console.log(`    setRole ${role}: ${sp.success ? '✓' : '✗'} ${String(sp.message || '').slice(0, 80)}`)
  }
}

await action('audio.armNative', {})
await sleep(500)
await action('transport.seek', { segundos: 0 })
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(600)

console.log('\n3) buffer stress')
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
  const buf = await action('analysis.buffer', { sampleMs: 120, reset: samples.length === 0 })
  const bd = buf.data || {}
  const fill = Math.max(Number(bd.ring?.dawFill ?? 0), Number(bd.ring?.maxLiveFill ?? 0))
  const target = Number(bd.ring?.targetFill ?? 1)
  const ratio = target > 0 ? fill / target : 0
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
    hostOk: audit.hostOk !== false,
    iterMs: Date.now() - iterT0,
  }
  samples.push(row)
  console.log(
    `#${samples.length} t=${row.t.toFixed(2)} master=${row.master.toFixed(3)} ${row.status} fill=${row.fill}/${row.target} (×${row.ratio}) und=+${row.underrun} drop=+${row.drop} iter=${row.iterMs}ms`,
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

const verdict = {
  ok:
    playheadOk &&
    hangHits === 0 &&
    saturatedHits === 0 &&
    starvingHits <= 1 &&
    totalUnderrun === 0 &&
    totalDrop === 0 &&
    totalOverflow === 0 &&
    maxFillRatio < 1.85 &&
    avgMaster > 0.001 &&
    healthyN >= Math.ceil(samples.length * 0.55) &&
    maxIterMs < 2500,
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
  rolesPath: ROLES_PATH,
  tracks: tracks.length,
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '_reggaeton-roles-out.json')
fs.writeFileSync(out, JSON.stringify({ verdict, samples }, null, 2))
console.log('\nVERDICT', JSON.stringify(verdict, null, 2))
console.log('wrote', out)
process.exit(verdict.ok ? 0 : 2)
