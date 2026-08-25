/**
 * Arma canción completa + play + analysis.buffer / fxBlame para verificar audio limpio.
 * Uso: node cli/_verify-sound-ok.mjs
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function req(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const r = http.request(
      {
        host: '127.0.0.1',
        port: 18787,
        path: pathName,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
        timeout: 300000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'))
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    r.on('error', reject)
    r.on('timeout', () => {
      r.destroy()
      reject(new Error('timeout'))
    })
    if (data) r.write(data)
    r.end()
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function actions(list) {
  return req('POST', '/actions', { actions: list })
}

console.log('=== 1) Proyecto nuevo + ASIO 48k/1024 + Music Build ===')
const buildPath = path.join(__dirname, '_from-scratch.json')
const buildActions = JSON.parse(fs.readFileSync(buildPath, 'utf8'))
// Nombre fresco
buildActions[0].payload.nombre = `Sound OK ${new Date().toISOString().slice(11, 19)}`
buildActions[2].payload.nombre = buildActions[0].payload.nombre

const built = await actions(buildActions)
for (const r of built.results || []) {
  console.log(`  ${r.success ? '✓' : '✗'} ${r.type}: ${String(r.message || '').slice(0, 120)}`)
}
if (!built.ok && !(built.results || []).some((r) => r.type === 'daw.musicBuild' && r.success)) {
  console.error('Music Build falló — abort')
  process.exit(1)
}

console.log('\n=== 2) Armar native + seek 0 ===')
await sleep(800)
let arm = await actions([{ type: 'audio.armNative', payload: {} }])
if (!arm.results?.[0]?.success) {
  await sleep(1000)
  arm = await actions([{ type: 'audio.armNative', payload: {} }])
}
console.log('  ARM', arm.results?.[0]?.message || arm)
await actions([{ type: 'transport.seek', payload: { segundos: 0 } }])

console.log('\n=== 3) Play + muestreo buffer (6 × 1.2s) ===')
await req('POST', '/transport', { action: 'play' })
await sleep(1500)

const bufferSamples = []
for (let i = 0; i < 6; i++) {
  const buf = await actions([
    { type: 'analysis.buffer', payload: { sampleMs: 500, reset: true } },
  ])
  const audit = await req('GET', '/audit')
  const d = buf.results?.[0]?.data || {}
  const row = {
    i,
    playhead: audit.playheadSec,
    playing: audit.playing,
    master: audit.masterPeak,
    hang: audit.hangSuspect,
    status: d.status,
    underrun: d.underrunDelta,
    overflow: d.overflowDelta,
    drops: d.highFillDropDelta,
    fill: d.fillRatioVsTarget,
    queue: d.mixQueueDepth,
    msg: buf.results?.[0]?.message,
  }
  bufferSamples.push(row)
  console.log(
    `  [${i}] t=${row.playhead?.toFixed?.(1) ?? '?'}s peak=${Number(row.master || 0).toFixed(3)} ${row.status} und=${row.underrun} drop=${row.drops} fill=${row.fill != null ? (row.fill * 100).toFixed(0) + '%' : '?'}`,
  )
  await sleep(1200)
}

console.log('\n=== 4) analysis.fxBlame (en play) ===')
const blame = await actions([
  {
    type: 'analysis.fxBlame',
    payload: { sampleMs: 300, settleMs: 100, includeInstruments: true, maxCandidates: 16 },
  },
])
const blameData = blame.results?.[0]?.data || {}
console.log('  ', blame.results?.[0]?.message)
if (blameData.suspects?.length) {
  for (const s of blameData.suspects.slice(0, 5)) {
    console.log(`   · ${s.pluginName} @ ${s.trackName} Δ${s.improvement} (${s.confidence})`)
  }
}
for (const a of blameData.advice || []) console.log('   !', a)

await req('POST', '/transport', { action: 'stop' })

console.log('\n=== VEREDICTO ===')
const mid = bufferSamples.slice(1) // ignora arranque
const healthyN = mid.filter((s) => s.status === 'healthy').length
const badDrops = mid.filter((s) => (s.drops || 0) > 5000).length
const badUnderrun = mid.filter((s) => (s.underrun || 0) > 40).length
const audible = bufferSamples.some((s) => Number(s.master) > 0.01)
const playingOk = bufferSamples.some((s) => s.playing)
const hang = bufferSamples.some((s) => s.hang)

const ok =
  playingOk &&
  audible &&
  !hang &&
  badDrops === 0 &&
  healthyN >= Math.ceil(mid.length * 0.5) &&
  badUnderrun <= 1

console.log(
  JSON.stringify(
    {
      ok,
      playingOk,
      audible,
      hang,
      healthyMid: `${healthyN}/${mid.length}`,
      badDropsSamples: badDrops,
      badUnderrunSamples: badUnderrun,
      softPadPathSuspected: blameData.softPadPathSuspected,
      topSuspect: blameData.suspects?.[0]?.pluginName ?? null,
      baselineBadness: blameData.baselineBadness,
    },
    null,
    2,
  ),
)

if (!ok) {
  console.error('\nFALLO: audio aún inestable o inaudible')
  process.exit(1)
}
console.log('\nOK: proyecto sonando con buffer estable (sin drops masivos)')
process.exit(0)
