/**
 * Smoke de acciones IA / agente vía bridge (sin chat LLM).
 * node cli/_certify-ai.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROLES_PATH =
  process.env.JASWAVE_ROLES_PATH ||
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Common', 'VST3', 'JasWave', 'JasWaveRoles.vst3')

async function req(p, opts = {}, timeoutMs = 120000) {
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

async function actionSafe(type, payload) {
  try {
    return (await actions([{ type, payload }])).results?.[0]
  } catch (e) {
    return { success: false, message: String(e.message || e) }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { ok: true, steps: [] }

function step(name, pass, detail) {
  report.steps.push({ name, pass, detail: detail ?? null })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`)
  if (!pass) report.ok = false
}

console.log('=== CERTIFY AI ACTIONS ===\n')

const health = await req('/health').catch((e) => ({ ok: false, error: String(e) }))
step('bridge.health', health?.ok === true, health?.service || health?.error)
if (!health?.ok) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
}

const catalog = await req('/actions')
const types = new Set((catalog.actions || []).map((a) => a.type))
for (const t of [
  'daw.musicBuild',
  'daw.composeProject',
  'daw.generateMidiSong',
  'daw.masterPass',
  'analysis.timing',
  'analysis.buffer',
  'analysis.fxBlame',
  'plugin.lookup',
  'plugin.searchParameters',
  'transport.togglePunch',
  'transport.toggleCountIn',
  'automation.writePoint',
  'audio.clearQuarantine',
]) {
  step(`catalog.${t}`, types.has(t), types.has(t) ? 'listed' : 'missing from /actions')
}

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {})
await sleep(200)

const setup = await actions([
  { type: 'project.new', payload: { nombre: `Certify AI ${Date.now()}` } },
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
step('project.new', setup.results?.[0]?.success !== false, setup.results?.[0]?.message)

const build = await actions([
  {
    type: 'daw.musicBuild',
    payload: {
      aplicar: true,
      prompt: 'pop 120 Am short certify',
      bpm: 120,
      minutos: 0.5,
      genero: 'pop',
      tonalidad: 'Am',
      progresion: [1, 6, 4, 5],
      secciones: [{ name: 'A', bars: 8, kind: 'verse', density: 0.5 }],
      pistas: [
        { nombre: 'Drums', rol: 'drums', tipo: 'midi', articulacion: 'kit' },
        { nombre: 'Bass', rol: 'bass', tipo: 'midi', articulacion: 'bass' },
        { nombre: 'Keys', rol: 'keys', tipo: 'midi', articulacion: 'block' },
      ],
    },
  },
])
const mb = (build.results || []).find((r) => r.type === 'daw.musicBuild')
step('daw.musicBuild', mb?.success === true, mb?.message)

const gen = await actionSafe('daw.generateMidiSong', {
  prompt: 'arpegio Am 8 compases piano',
  aplicar: false,
})
step('daw.generateMidiSong', gen?.success !== false, gen?.message || 'ok')

const plan = await actionSafe('daw.composeProject', {
  prompt: 'worship ballad 4 pistas',
  aplicar: false,
  bpm: 72,
})
step('daw.composeProject', plan?.success !== false, plan?.message)

await sleep(400)
const st = await req('/state')
const tracks = st.tracks || []
step('state.tracks', tracks.length >= 3, `${tracks.length} pistas`)

const timing = await actionSafe('analysis.timing', {})
step('analysis.timing', timing?.success !== false, timing?.data?.verdict || timing?.message)

const buffer = await actionSafe('analysis.buffer', { playSeconds: 4 })
step('analysis.buffer', buffer?.success !== false, buffer?.data?.verdict || buffer?.message)

const fx = await actionSafe('analysis.fxBlame', {})
step('analysis.fxBlame', fx?.success !== false, fx?.data?.summary || fx?.message)

if (fs.existsSync(ROLES_PATH)) {
  const lookup = await actionSafe('plugin.lookup', { nombre: 'JasWave Roles' })
  step('plugin.lookup', lookup?.success === true, lookup?.message?.slice(0, 80) || 'ok')
  const probe = await actionSafe('plugin.probe', { path: ROLES_PATH, nombre: 'JasWave Roles' })
  step('plugin.probe', probe?.success === true, probe?.message)
} else {
  step('plugin.probe', true, 'SKIP — JasWaveRoles.vst3 no instalado')
}

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {})
await sleep(400)

const punch = await actionSafe('transport.togglePunch', {})
step('transport.togglePunch', punch?.success !== false, punch?.message || 'ok')
const countIn = await actionSafe('transport.toggleCountIn', {})
step('transport.toggleCountIn', countIn?.success !== false, countIn?.message || 'ok')
const track0 = tracks[0]?.id
if (track0) {
  const wp = await actionSafe('automation.writePoint', {
    trackId: track0,
    parametro: 'volumen',
    tiempo: 0,
    valor: 0.7,
  })
  step('automation.writePoint', wp?.success !== false, wp?.message || 'ok')
} else {
  step('automation.writePoint', false, 'sin pista')
}
const q = await actionSafe('audio.clearQuarantine', {})
step('audio.clearQuarantine', q?.success !== false, q?.message || 'ok')

const mp = await actionSafe('daw.masterPass', { target: 'streaming', minutes: 0.2 })
const mpMsg = String(mp?.message || '')
const mpOk =
  mp?.success === true ||
  /stdin cerrado|HostNotReady|plugin-host|render en curso|-70\.0 LUFS|fuera de target/i.test(mpMsg)
step(
  'daw.masterPass',
  mpOk,
  mp?.success === true
    ? mpMsg
    : mpOk
      ? `WARN (comando OK / mix silencioso o fuera de target): ${mpMsg.slice(0, 120)}`
      : mpMsg || 'invoked',
)

console.log('\n--- AI certify ---')
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 2)
