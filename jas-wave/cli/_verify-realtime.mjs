/**
 * Play + sample audit/timing over several seconds to verify real-time sync.
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

await req('POST', '/transport', { action: 'stop' })
await new Promise((r) => setTimeout(r, 400))
let arm = await req('POST', '/actions', {
  actions: [{ type: 'audio.armNative', payload: {} }],
})
if (!arm.results?.[0]?.success) {
  await new Promise((r) => setTimeout(r, 600))
  arm = await req('POST', '/actions', {
    actions: [{ type: 'audio.armNative', payload: {} }],
  })
}
console.log('ARM', JSON.stringify(arm.results?.[0] || arm, null, 2))

await req('POST', '/actions', {
  actions: [{ type: 'transport.seek', payload: { segundos: 0 } }],
})
await req('POST', '/transport', { action: 'play' })

const samples = []
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 1500))
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
const multiPeak = samples.filter((s) => s.peaks >= 3)
const nativeOn = samples.filter((s) => s.nativeOut)
const timingOk = samples.filter((s) => s.ok !== false && !s.hang)
const verdict = {
  playheadAdvances: moved.length >= 3,
  multiTrackAudio: multiPeak.length >= 2,
  nativeArmed: nativeOn.length >= 1,
  timingStable: timingOk.length >= 4,
  maxMaster: Math.max(...samples.map((s) => s.master || 0)),
  samples,
}
console.log('\nVERDICT', JSON.stringify({
  playheadAdvances: verdict.playheadAdvances,
  multiTrackAudio: verdict.multiTrackAudio,
  nativeArmed: verdict.nativeArmed,
  timingStable: verdict.timingStable,
  maxMaster: verdict.maxMaster,
}, null, 2))
process.exit(
  verdict.playheadAdvances && verdict.multiTrackAudio && verdict.timingStable ? 0 : 2,
)
