/**
 * Prueba completa DAW: device → arm → build/play → meters → buffer → fxBlame → stop.
 * node cli/_e2e-daw-audio.mjs
 */
import http from 'http'

function req(method, path, body, timeoutMs = 180000) {
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
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') })
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    r.on('error', reject)
    r.on('timeout', () => {
      r.destroy()
      reject(new Error(`timeout ${method} ${path}`))
    })
    if (data) r.write(data)
    r.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const actions = (list) => req('POST', '/actions', { actions: list }).then((x) => x.json)

const report = { steps: [], ok: true }
function step(name, pass, detail) {
  report.steps.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!pass) report.ok = false
}

console.log('=== E2E DAW AUDIO ===\n')

// 0) Health
{
  const h = await req('GET', '/health')
  step('bridge', h.json?.ok === true, JSON.stringify(h.json))
  if (!h.json?.ok) {
    console.error(JSON.stringify(report, null, 2))
    process.exit(1)
  }
}

// 1) Stop + list devices
await req('POST', '/transport', { action: 'stop' })
await sleep(300)
const listed = await actions([{ type: 'audio.listDevices', payload: {} }])
const listData = listed.results?.[0]?.data || listed.results?.[0] || {}
const devices = listData.devices || listData.result?.devices || []
const umc =
  devices.find((d) => /umc/i.test(d.name || d.id || '')) ||
  devices.find((d) => /asio/i.test(d.backend || d.id || ''))
step(
  'listDevices',
  listed.results?.[0]?.success !== false && devices.length > 0,
  `${devices.length} devices · pick=${umc?.id || umc?.name || '?'}`,
)

// 2) ensureBest / setDevice ASIO 48k 1024
{
  const ens = await actions([
    {
      type: 'audio.ensureBest',
      payload: { preferName: 'UMC', sampleRate: 48000, bufferSize: 1024 },
    },
  ])
  const msg = ens.results?.[0]?.message || ''
  const ok = ens.results?.[0]?.success !== false
  step('ensureBest', ok, msg.slice(0, 140))
  if (!ok && umc) {
    const set = await actions([
      {
        type: 'audio.setDevice',
        payload: {
          backend: 'asio',
          deviceId: umc.id,
          sampleRate: 48000,
          bufferSize: 1024,
        },
      },
    ])
    step('setDevice.fallback', set.results?.[0]?.success !== false, set.results?.[0]?.message)
  }
}

await sleep(600)

// 3) getDevice + armNative
{
  const get = await actions([{ type: 'audio.getDevice', payload: {} }])
  const audio = get.results?.[0]?.data?.audio || get.results?.[0]?.data || {}
  step(
    'getDevice',
    Boolean(audio.running || audio.backend),
    `${audio.backend || '?'} · ${audio.deviceName || audio.deviceId || '?'} · ${audio.sampleRate} Hz / ${audio.bufferSize} · running=${audio.running}`,
  )

  let arm = await actions([{ type: 'audio.armNative', payload: {} }])
  if (!arm.results?.[0]?.success) {
    await sleep(800)
    arm = await actions([{ type: 'audio.armNative', payload: {} }])
  }
  const timing = arm.results?.[0]?.data || {}
  step(
    'armNative',
    arm.results?.[0]?.success === true && timing.nativeOutput !== false,
    arm.results?.[0]?.message || JSON.stringify(timing).slice(0, 120),
  )
}

// 4) Proyecto + musicBuild corto si no hay notas
{
  const st = await req('GET', '/state')
  const tracks = st.json?.tracks || st.json?.project?.tracks || []
  const notes = (tracks || []).reduce((n, t) => n + (t.notes || 0), 0)
  console.log(`\n  state tracks=${tracks.length || st.json?.trackCount || '?'} notes≈${notes}`)

  if (notes < 20) {
    const build = await actions([
      { type: 'project.new', payload: { nombre: `E2E Audio ${Date.now()}` } },
      {
        type: 'daw.musicBuild',
        payload: {
          aplicar: true,
          prompt: 'worship soft pad piano bass Am 72bpm short',
          bpm: 72,
          minutos: 0.75,
          genero: 'worship',
          tonalidad: 'Am',
          progresion: [1, 6, 4, 5],
          secciones: [
            { name: 'Intro', bars: 4, kind: 'intro', density: 0.4 },
            { name: 'Verse', bars: 8, kind: 'verse', density: 0.55 },
          ],
          pistas: [
            { nombre: 'Batería', rol: 'drums', tipo: 'midi', articulacion: 'kit' },
            { nombre: 'Bajo', rol: 'bass', tipo: 'midi', articulacion: 'bass' },
            { nombre: 'Piano', rol: 'piano', tipo: 'midi', articulacion: 'block' },
            { nombre: 'Pad', rol: 'pad', tipo: 'midi', articulacion: 'pad' },
          ],
        },
      },
      { type: 'master.update', payload: { datos: { volumen: 0.9 } } },
    ])
    const mb = (build.results || []).find((r) => r.type === 'daw.musicBuild')
    step('musicBuild', mb?.success === true, String(mb?.message || '').slice(0, 140))
    await sleep(500)
    await actions([{ type: 'audio.armNative', payload: {} }])
  } else {
    step('musicBuild', true, 'reuse existing project with notes')
  }
}

// 5) Play + meter samples
await actions([{ type: 'transport.seek', payload: { segundos: 0 } }])
await req('POST', '/transport', { action: 'play' })
await sleep(2000)

const peaks = []
for (let i = 0; i < 5; i++) {
  const audit = await req('GET', '/audit')
  const a = audit.json || {}
  peaks.push({
    t: a.playheadSec,
    playing: a.playing,
    master: a.masterPeak,
    hang: a.hangSuspect,
    hostOk: a.hostOk,
    tracks: (a.tracks || [])
      .filter((t) => t.tipo !== 'bus')
      .map((t) => `${t.name}:${Number(t.peak || 0).toFixed(3)}`)
      .join('|'),
  })
  console.log(
    `  audit[${i}] play=${a.playing} t=${Number(a.playheadSec || 0).toFixed(1)}s master=${Number(a.masterPeak || 0).toFixed(3)} host=${a.hostOk}`,
  )
  await sleep(900)
}

const maxMaster = Math.max(...peaks.map((p) => Number(p.master) || 0))
const anyPlaying = peaks.some((p) => p.playing)
const anyHang = peaks.some((p) => p.hang)
step('transport.play', anyPlaying, `maxMaster=${maxMaster.toFixed(3)} hang=${anyHang}`)
step('audible.meters', maxMaster > 0.005, `maxMaster=${maxMaster.toFixed(4)}`)

// 6) Buffer health while playing
{
  const buf = await actions([{ type: 'analysis.buffer', payload: { sampleMs: 600, reset: true } }])
  const d = buf.results?.[0]?.data || {}
  const pass =
    d.status === 'healthy' ||
    (d.status !== 'disconnected' && (d.highFillDropDelta || 0) < 8000 && (d.underrunDelta || 0) < 80)
  step(
    'analysis.buffer',
    pass,
    `${d.status} und=${d.underrunDelta} drop=${d.highFillDropDelta} pipe=${d.mixPipeConnected} native=${d.nativeOutput}`,
  )
}

// 7) Timing
{
  const t = await actions([{ type: 'analysis.timing', payload: {} }])
  const d = t.results?.[0]?.data || {}
  step(
    'analysis.timing',
    d.nativeOutput === true,
    t.results?.[0]?.message || `native=${d.nativeOutput} ahead=${d.pathAheadMs}`,
  )
}

// 8) fxBlame quick
{
  const b = await actions([
    { type: 'analysis.fxBlame', payload: { sampleMs: 250, settleMs: 80, maxCandidates: 8 } },
  ])
  const d = b.results?.[0]?.data || {}
  step(
    'analysis.fxBlame',
    true,
    `${b.results?.[0]?.message} · suspects=${d.suspects?.length ?? 0}`,
  )
}

// 9) Test tone if silent
if (maxMaster <= 0.005) {
  console.log('\n  meters silenciosos — intentando testTone del host…')
  const tone = await actions([{ type: 'audio.getDevice', payload: {} }])
  // host command via ensure path
  const raw = await req('POST', '/actions', {
    actions: [{ type: 'plugin.lookup', payload: { nombre: 'Soft Pad' } }],
  })
  step('silent.fallback.lookup', raw.json?.ok !== false, 'lookup Soft Pad (no tone API in actions)')
}

await req('POST', '/transport', { action: 'stop' })

console.log('\n=== RESUMEN ===')
console.log(JSON.stringify({ ok: report.ok, steps: report.steps }, null, 2))
process.exit(report.ok ? 0 : 1)
