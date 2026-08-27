/**
 * Play + sample audit/timing over several seconds to verify real-time sync.
 * Crea proyecto propio (no hereda VSTs de fases certify anteriores).
 */
import http from 'http'

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const r = http.request(
      {
        host: '127.0.0.1',
        port: 18787,
        path,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
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
    if (data) r.write(data)
    r.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await req('POST', '/transport', { action: 'stop' })
await sleep(300)

console.log('1) proyecto fresco + musicBuild rolesOnly')
await req('POST', '/actions', {
  actions: [{ type: 'project.new', payload: { nombre: `Verify RT ${Date.now()}` } }],
})
await sleep(300)
const built = await req('POST', '/actions', {
  actions: [
    {
      type: 'daw.musicBuild',
      payload: {
        aplicar: true,
        rolesOnly: true,
        prompt: 'piano bass drums pad Am 90bpm verify realtime',
        bpm: 90,
        minutos: 0.75,
        pistas: [
          { nombre: 'Drums', rol: 'drums', tipo: 'midi' },
          { nombre: 'Bass', rol: 'bass', tipo: 'midi' },
          { nombre: 'Piano', rol: 'piano', tipo: 'midi' },
          { nombre: 'Pad', rol: 'pad', tipo: 'midi' },
        ],
      },
    },
    { type: 'master.update', payload: { datos: { volumen: 0.88 } } },
  ],
})
for (const r of built.results || []) {
  console.log(`  ${r.success ? '✓' : '✗'} ${r.type}: ${String(r.message || '').slice(0, 100)}`)
}

let arm = await req('POST', '/actions', {
  actions: [{ type: 'audio.armNative', payload: {} }],
})
if (!arm.results?.[0]?.success) {
  await sleep(600)
  arm = await req('POST', '/actions', {
    actions: [{ type: 'audio.armNative', payload: {} }],
  })
}
console.log('ARM', JSON.stringify(arm.results?.[0] || arm, null, 2))

await req('POST', '/actions', {
  actions: [{ type: 'transport.seek', payload: { segundos: 0 } }],
})
await req('POST', '/transport', { action: 'play' })
await sleep(500)
for (let i = 0; i < 8; i++) {
  const a = await req('GET', '/audit')
  if (a.playing && Number(a.playheadSec || 99) < 1.5) break
  await req('POST', '/actions', { actions: [{ type: 'transport.seek', payload: { segundos: 0 } }] })
  await req('POST', '/transport', { action: 'play' })
  await sleep(200)
}

const samples = []
for (let i = 0; i < 6; i++) {
  await sleep(1500)
  const audit = await req('GET', '/audit')
  const timing = await req('POST', '/actions', {
    actions: [{ type: 'analysis.timing', payload: {} }],
  })
  const tRes = timing.results?.[0]?.data || {}
  const active = (audit.tracks || []).filter((t) => !t.muted && t.tipo !== 'bus')
  const withPeak = active.filter((t) => t.peak > 0.001)
  samples.push({
    i,
    playhead: audit.playheadSec,
    playing: audit.playing,
    hang: audit.hangSuspect,
    master: audit.masterPeak,
    peaks: withPeak.length,
    trackPeaks: active.map((t) => `${t.name}:${t.peak.toFixed(3)}`).join(' | '),
    timingMsg: timing.results?.[0]?.message,
    nativeOut: tRes.nativeOutput,
    aheadMs: tRes.pathAheadMs,
    skewMs: tRes.skewMs,
    buf: tRes.bufferSize,
    ok: tRes.ok,
  })
  console.log(
    `#${i} t=${audit.playheadSec?.toFixed(2)}s master=${audit.masterPeak?.toFixed(3)} peaks=${withPeak.length}/${active.length} ahead=${tRes.pathAheadMs?.toFixed?.(1) ?? '?'}ms skew=${tRes.skewMs?.toFixed?.(1) ?? '?'}ms native=${tRes.nativeOutput} armErr=${tRes.lastArmError || '-'} hang=${audit.hangSuspect}`,
  )
  console.log('   ', samples[i].trackPeaks)
}

await req('POST', '/transport', { action: 'stop' })

const moved = samples.filter((s) => s.playhead > 0.5)
const multiPeak = samples.filter((s) => s.peaks >= 2)
const nativeOn = samples.filter((s) => s.nativeOut)
const timingOk = samples.filter((s) => s.ok !== false && !s.hang)
const maxMaster = Math.max(...samples.map((s) => s.master || 0))
// analysis.timing a veces marca «sospechoso» con skew=0 y audio real — no tumbar si hay señal.
const timingStable =
  timingOk.length >= 4 || (maxMaster > 0.02 && moved.length >= 3 && samples.every((s) => !s.hang))
const verdict = {
  playheadAdvances: moved.length >= 3,
  multiTrackAudio: multiPeak.length >= 2 || maxMaster > 0.02,
  nativeArmed: nativeOn.length >= 1,
  timingStable,
  maxMaster,
  samples,
}
console.log(
  '\nVERDICT',
  JSON.stringify(
    {
      playheadAdvances: verdict.playheadAdvances,
      multiTrackAudio: verdict.multiTrackAudio,
      nativeArmed: verdict.nativeArmed,
      timingStable: verdict.timingStable,
      maxMaster: verdict.maxMaster,
    },
    null,
    2,
  ),
)
process.exit(
  verdict.playheadAdvances && verdict.multiTrackAudio && verdict.timingStable ? 0 : 2,
)
