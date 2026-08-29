/**
 * Soak / estabilidad del Plugin Host (ASIO reopen + cuarentena).
 *
 * Uso (con la app en marcha y agent bridge en 18787):
 *   node jas-wave/cli/_soak-host.mjs
 *   SOAK_MINUTES=30 node jas-wave/cli/_soak-host.mjs   # soak medio (CI / pre-release)
 *   SOAK_MINUTES=240 node jas-wave/cli/_soak-host.mjs  # soak 4h checklist
 *
 * Criterio corto: N ciclos clearQuarantine + setDevice + buffer.
 * Criterio largo: además deja Play activo y registra health periódico.
 */
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.JASWAVE_AGENT_PORT || 18787)
const CYCLES = Number(process.env.SOAK_CYCLES || 12)
const SLEEP_MS = Number(process.env.SOAK_SLEEP_MS || 2500)
const SOAK_MINUTES = Number(process.env.SOAK_MINUTES || 0)
const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_PATH =
  process.env.SOAK_LOG ||
  join(__dirname, `_soak-out-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)

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

function log(line) {
  const s = typeof line === 'string' ? line : JSON.stringify(line)
  console.log(s)
  try {
    appendFileSync(LOG_PATH, s + '\n')
  } catch {
    /* ignore */
  }
}

async function cycleOnce(i, total) {
  log(`\n[${i}/${total}] clearQuarantine + ensureBest + buffer`)
  try {
    const q = await rpc('audio.clearQuarantine', {})
    log(`  quarantine: ${q.message || JSON.stringify(q)}`)
  } catch (e) {
    log(`  quarantine warn: ${e.message}`)
  }
  try {
    const d = await rpc('audio.ensureBest', { prefer: 'UMC' })
    log(`  device: ${d.message || JSON.stringify(d)}`)
  } catch (e) {
    log(`  device warn: ${e.message}`)
  }
  try {
    const b = await rpc('analysis.buffer', {})
    log(
      `  buffer: ${
        b?.fill != null ? `fill=${b.fill} underruns=${b.underruns ?? '?'}` : JSON.stringify(b)
      }`,
    )
  } catch (e) {
    log(`  buffer warn: ${e.message}`)
  }
  try {
    const h = await rpc('analysis.timing', {})
    log(`  timing: ${h.message || JSON.stringify(h).slice(0, 200)}`)
  } catch {
    /* optional */
  }
}

async function main() {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    writeFileSync(LOG_PATH, `soak start ${new Date().toISOString()}\n`)
  } catch {
    /* ignore */
  }

  if (SOAK_MINUTES > 0) {
    const endAt = Date.now() + SOAK_MINUTES * 60_000
    let i = 0
    log(`Soak largo · ${SOAK_MINUTES} min · port ${PORT} · log ${LOG_PATH}`)
    try {
      await rpc('transport.toggle', {})
      log('  play toggled (best-effort)')
    } catch (e) {
      log(`  play warn: ${e.message}`)
    }
    while (Date.now() < endAt) {
      i += 1
      await cycleOnce(i, Math.ceil((SOAK_MINUTES * 60_000) / SLEEP_MS))
      await sleep(SLEEP_MS)
    }
    try {
      await rpc('transport.stop', {})
    } catch {
      /* ignore */
    }
    log(`\nOK soak largo ${SOAK_MINUTES} min completado · ${LOG_PATH}`)
    return
  }

  log(`Soak host · port ${PORT} · ${CYCLES} ciclos · log ${LOG_PATH}`)
  for (let i = 1; i <= CYCLES; i++) {
    await cycleOnce(i, CYCLES)
    await sleep(SLEEP_MS)
  }
  log(
    '\nOK soak corto completado. Para 30–240 min: SOAK_MINUTES=30|240 node jas-wave/cli/_soak-host.mjs',
  )
}

main().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
