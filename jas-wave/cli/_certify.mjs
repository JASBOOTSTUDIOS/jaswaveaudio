#!/usr/bin/env node
/**
 * Certificación completa JasWave vía CLI.
 *   node cli/_certify.mjs [--quick|--full] [--skip-vst]
 *
 * Incluye VSTs externos: DecentSampler + 4Front (+ BFD en three-vst).
 * Env: JASWAVE_4FRONT_PATH, JASWAVE_DECENT_PATH, JASWAVE_AGENT_PORT
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const node = process.execPath
const port = process.env.JASWAVE_AGENT_PORT || '18787'
const BASE = `http://127.0.0.1:${port}`

const argv = process.argv.slice(2)
const quick = argv.includes('--quick')
const full = argv.includes('--full')
const skipVst = argv.includes('--skip-vst')

const report = { ok: true, startedAt: new Date().toISOString(), phases: [] }

function runPhase(name, script, args = [], optional = false) {
  const scriptPath = path.join(__dirname, script)
  console.log(`\n▶ ${name} (${script}${args.length ? ' ' + args.join(' ') : ''})`)
  const r = spawnSync(node, [scriptPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, JASWAVE_AGENT_PORT: port },
    cwd: path.join(__dirname, '..'),
  })
  const code = r.status == null ? 1 : r.status
  const pass = code === 0
  report.phases.push({ name, script, code, pass, optional })
  if (!pass && !optional) report.ok = false
  console.log(`${pass ? '✓ PASS' : optional ? '⚠ SKIP/FAIL (optional)' : '✗ FAIL'} ${name} (exit ${code})`)
  return pass
}

async function waitBridge(maxSec = 90) {
  const deadline = Date.now() + maxSec * 1000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) })
      const j = await res.json()
      if (j?.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000))
    process.stdout.write('.')
  }
  return false
}

console.log('╔══════════════════════════════════════════╗')
console.log('║     JasWave CLI Certification            ║')
console.log(`║     bridge ${BASE.padEnd(26)}║`)
console.log('╚══════════════════════════════════════════╝')
console.log(`mode: ${full ? 'full' : quick ? 'quick' : 'standard'}`)

if (!(await waitBridge(120))) {
  console.error('\nBridge no responde. Ejecuta: cd jas-wave && npm run dev')
  process.exit(1)
}
console.log('\nbridge OK')

// Unit tests (local, no bridge)
console.log('\n▶ unit:shared')
{
  const r = spawnSync('npm', ['test'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..', '..', 'shared'),
  })
  const pass = r.status === 0
  report.phases.push({ name: 'unit:shared', code: r.status ?? 1, pass })
  if (!pass) report.ok = false
}

console.log('\n▶ unit:plugins')
{
  const r = spawnSync('npm', ['run', 'test:plugins'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..'),
  })
  const pass = r.status === 0
  report.phases.push({ name: 'unit:plugins', code: r.status ?? 1, pass })
  if (!pass) report.ok = false
}

runPhase('health', 'daw-cli.mjs', ['health'])
runPhase('ai-actions', '_certify-ai.mjs')
runPhase('e2e-audio', '_e2e-daw-audio.mjs')
runPhase('one-track-piano', '_one-track-piano.mjs', [quick ? '6' : '10'])
runPhase('probe-sync', '_probe-sync.mjs', [quick ? '6' : '10', '800'])

// VSTs externos (DecentSampler, 4Front, BFD) — obligatorio en certificación
runPhase('external-vst-decent', '_e2e-decent-4front.mjs', [quick ? '12' : '16'])
runPhase('external-vst-three', '_test-three-vst.mjs')

if (!quick) {
  runPhase('verify-realtime', '_verify-realtime.mjs')
  runPhase('verify-sound', '_verify-sound-ok.mjs')
}

if (full && !quick) {
  runPhase('pro-perf', '_pro-perf.mjs', ['16'])
  runPhase('reggaeton-e2e', '_reggaeton-e2e.mjs', ['14'])
}

console.log('\n══════════════════════════════════════════')
console.log(report.ok ? '✅ CERTIFICATION PASSED' : '❌ CERTIFICATION FAILED')
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
