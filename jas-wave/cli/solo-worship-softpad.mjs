import http from 'http'
import fs from 'fs'

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

const st = await req('GET', '/state')
const tracks = st.tracks || []

// Keep only the newest Soft-Pad dual block (last 6 midi with Soft Pad + another plugin)
const softDual = tracks.filter(
  (t) =>
    t.tipo === 'midi' &&
    (t.plugins || []).some((p) => String(p.nombre).includes('Soft Pad')) &&
    (t.plugins || []).length >= 2,
)
const keep = new Set(softDual.slice(-6).map((t) => t.id))
console.log(
  'Keep:',
  softDual.slice(-6).map((t) => t.nombre),
)

const actions = []
for (const t of tracks) {
  if (t.tipo === 'bus') continue
  if (keep.has(t.id)) {
    actions.push({
      type: 'track.update',
      payload: {
        trackId: t.id,
        datos: { silenciada: false, volumen: Math.max(Number(t.volumen) || 0, 0.7) },
      },
    })
  } else {
    actions.push({
      type: 'track.update',
      payload: { trackId: t.id, datos: { silenciada: true } },
    })
  }
}

const out = await req('POST', '/actions', { actions })
console.log(
  JSON.stringify(
    {
      ok: out.ok,
      results: (out.results || []).slice(0, 3),
      n: (out.results || []).length,
    },
    null,
    2,
  ),
)

await req('POST', '/transport', { action: 'stop' })
await req('POST', '/actions', {
  actions: [{ type: 'transport.seek', payload: { segundos: 0 } }],
})
await req('POST', '/transport', { action: 'play' })
await new Promise((r) => setTimeout(r, 4000))
const audit = await req('GET', '/audit')
console.log(
  'audit',
  audit.playing,
  't=',
  audit.playheadSec,
  'master=',
  audit.masterPeak,
  'issues=',
  audit.issues,
)
for (const t of audit.tracks || []) {
  if (!t.muted && t.peak > 0.001) console.log('PEAK', t.name, t.peak)
}
for (const t of (audit.tracks || []).filter((x) => !x.muted).slice(-8)) {
  console.log(t.muted ? 'M' : ' ', t.name, 'peak=', t.peak, t.plugins)
}
