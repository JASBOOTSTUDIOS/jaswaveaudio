/**
 * Probe: buffer health + playhead continuity while playing.
 * Usa samples cortos de buffer para no bloquear el renderer.
 * Exit 0 = healthy, 2 = problems detected.
 */
import fs from 'node:fs'
import process from 'node:process'

const BASE = `http://127.0.0.1:${process.env.JASWAVE_AGENT_PORT || 18787}`

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

const durationSec = Number(process.argv[2] || 8)
const intervalMs = Number(process.argv[3] || 500)
const wantMetro = process.argv.includes('--metro')

console.log(`sync-probe: ${durationSec}s @ ${intervalMs}ms${wantMetro ? ' +metro' : ''}`)

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
await sleep(300)

const arm = await action('audio.armNative', {})
console.log('ARM', arm.message || arm)

const wantEnsure = process.argv.includes('--ensure')
if (wantEnsure) {
  const ensure = await action('audio.ensureBest', {})
  console.log('ENSURE', ensure.message || ensure)
} else {
  console.log('ENSURE skipped (pasa --ensure para forzar; evita re-load VST que tumba el host)')
}

if (wantMetro) {
  // Activar metrónomo vía toggle solo si el caller lo pide (no invertir estado entre runs).
  await action('transport.toggleMetronome', {})
  console.log('METRO toggled (--metro)')
}

await action('transport.seek', { segundos: 0 })
await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
await sleep(400)
// Esperar playhead estable cerca de 0 (evita drift fantasma de sesión previa)
for (let i = 0; i < 12; i++) {
  const a = await req('/audit')
  const t = Number(a.playheadSec || 0)
  if (a.playing && t >= 0 && t < 1.25) break
  if (t > 2) {
    await action('transport.seek', { segundos: 0 })
    await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
  }
  await sleep(150)
}
await sleep(200)

const samples = []
const t0 = Date.now()
while ((Date.now() - t0) / 1000 < durationSec) {
  const wallBefore = Date.now()
  const audit = await req('/audit')
  let timing = { data: {} }
  let buf = { data: { status: 'skipped' } }
  try {
    timing = await action('analysis.timing', {})
  } catch {
    /* no tumbar probe por timing lento */
  }
  try {
    // Timeout corto: analysis.buffer a veces cuelga el host IPC bajo ASIO.
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    try {
      buf = await req('/actions', {
        method: 'POST',
        body: JSON.stringify({
          actions: [{ type: 'analysis.buffer', payload: { sampleMs: 100, reset: samples.length === 0 } }],
        }),
        signal: ac.signal,
      })
      buf = buf.results?.[0] || buf
    } finally {
      clearTimeout(t)
    }
  } catch {
    buf = { data: { status: 'timeout' }, success: false }
  }
  const wallAfter = Date.now()
  const td = timing.data || {}
  const bd = buf.data || {}
  const row = {
    wall: ((wallAfter - t0) / 1000).toFixed(2),
    iterMs: wallAfter - wallBefore,
    playhead: Number(audit.playheadSec || 0),
    playing: Boolean(audit.playing),
    hang: Boolean(audit.hangSuspect),
    master: Number(audit.masterPeak || 0),
    skewMs: Number(td.skewMs || 0),
    aheadMs: Number(td.pathAheadMs || 0),
    bufOk: td.ok !== false,
    status: bd.status || '?',
    underrunDelta: Number(bd.underrunDelta || 0),
    overflowDelta: Number(bd.overflowDelta || 0),
    dropDelta: Number(bd.highFillDropDelta || 0),
    fillRatio: bd.fillRatioVsTarget,
    minFill: bd.ring?.minLiveFill ?? bd.ring?.dawFill,
    target: bd.ring?.targetFill,
    native: Boolean(td.nativeOutput),
  }
  samples.push(row)
  console.log(
    `#${samples.length} t=${row.playhead.toFixed(2)}s master=${row.master.toFixed(3)} skew=${row.skewMs.toFixed(1)} ahead=${row.aheadMs.toFixed(1)} underrun=+${row.underrunDelta} drop=+${row.dropDelta} fill=${row.minFill}/${row.target} ${row.status} (${row.iterMs}ms)`,
  )
  await sleep(intervalMs)
}

await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })

const moving = samples.filter((s) => s.playing && s.playhead > 0.15)
const drifts = []
for (let i = 1; i < moving.length; i++) {
  const dtWall = Number(moving[i].wall) - Number(moving[i - 1].wall)
  const dtHead = moving[i].playhead - moving[i - 1].playhead
  if (dtWall > 0.2) drifts.push({ i, dtWall, dtHead, err: Math.abs(dtHead - dtWall) })
}

const totalUnderrun = samples.reduce((a, s) => a + s.underrunDelta, 0)
const totalDrop = samples.reduce((a, s) => a + s.dropDelta, 0)
const hangHits = samples.filter((s) => s.hang).length
const starving = samples.filter((s) => s.status === 'starving').length
const maxDrift = drifts.length ? Math.max(...drifts.map((d) => d.err)) : 0
const avgMaster = samples.reduce((a, s) => a + s.master, 0) / Math.max(1, samples.length)
const underrunPerSec = totalUnderrun / Math.max(0.5, durationSec)

const verdict = {
  playheadAdvances: moving.length >= Math.max(3, Math.floor(samples.length * 0.5)),
  playheadDriftOk: maxDrift < 0.35,
  noHang: hangHits === 0,
  bufferOk: starving === 0 && underrunPerSec < 8,
  hasAudio: avgMaster > 0.001 || samples.some((s) => s.master > 0.01),
  nativeArmed: samples.some((s) => s.native),
  maxDriftSec: maxDrift,
  totalUnderrun,
  underrunPerSec,
  totalDrop,
  hangHits,
  starving,
  avgMaster,
  sampleCount: samples.length,
}

const outPath = new URL('./_probe-sync-out.json', import.meta.url)
fs.writeFileSync(outPath, JSON.stringify({ verdict, samples, drifts }, null, 2))

console.log('\nVERDICT', JSON.stringify(verdict, null, 2))
console.log('wrote', outPath.pathname)

const ok =
  verdict.playheadAdvances &&
  verdict.playheadDriftOk &&
  verdict.noHang &&
  verdict.bufferOk &&
  verdict.nativeArmed

process.exit(ok ? 0 : 2)
