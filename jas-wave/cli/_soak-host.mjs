/**
 * Soak / estabilidad del Plugin Host (ASIO reopen + cuarentena).
 *
 * Uso (con la app en marcha y agent bridge en 18787):
 *   node jas-wave/cli/_soak-host.mjs
 *
 * Criterio: N ciclos de clearQuarantine + setDevice + load ligero sin tumbar el DAW.
 * Un soak 4h real se hace dejando Play con VSTs pesados; este script cubre reopen/quarantine UX.
 */

const PORT = Number(process.env.JASWAVE_AGENT_PORT || 18787)
const CYCLES = Number(process.env.SOAK_CYCLES || 12)
const SLEEP_MS = Number(process.env.SOAK_SLEEP_MS || 2500)

async function rpc(type, payload = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || json?.message || `${type} HTTP ${res.status}`)
  }
  return json
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log(`Soak host · port ${PORT} · ${CYCLES} ciclos`)
  for (let i = 1; i <= CYCLES; i++) {
    console.log(`\n[${i}/${CYCLES}] clearQuarantine + ensureBest + buffer`)
    try {
      const q = await rpc('audio.clearQuarantine', {})
      console.log('  quarantine:', q.message || q)
    } catch (e) {
      console.warn('  quarantine warn:', e.message)
    }
    try {
      const d = await rpc('audio.ensureBest', { prefer: 'UMC' })
      console.log('  device:', d.message || d)
    } catch (e) {
      console.warn('  device warn:', e.message)
    }
    try {
      const b = await rpc('analysis.buffer', {})
      console.log(
        '  buffer:',
        b?.fill != null ? `fill=${b.fill} underruns=${b.underruns ?? '?'}` : b,
      )
    } catch (e) {
      console.warn('  buffer warn:', e.message)
    }
    await sleep(SLEEP_MS)
  }
  console.log('\nOK soak corto completado. Para 4h: deja Play con VSTs y revisa cuarentena/ASIO.')
}

main().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
