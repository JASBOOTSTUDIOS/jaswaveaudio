#!/usr/bin/env node
/**
 * CLI JasWave — mismas acciones que la IA (executeDawActions) + auditoría en vivo.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = Number(process.env.JASWAVE_AGENT_PORT || 18787)
const BASE = `http://127.0.0.1:${DEFAULT_PORT}`

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
  if (!res.ok) {
    const err = new Error(json.error || res.statusText || `HTTP ${res.status}`)
    err.body = json
    throw err
  }
  return json
}

function parseJsonArg(raw) {
  if (raw == null || raw === '') return {}
  let text
  if (raw === '-') {
    text = fs.readFileSync(0, 'utf8') || '{}'
  } else if (raw.startsWith('@')) {
    const rel = raw.slice(1)
    const candidates = [
      rel,
      path.join(process.cwd(), rel),
      path.join(path.dirname(fileURLToPath(import.meta.url)), rel),
      path.join(path.dirname(fileURLToPath(import.meta.url)), path.basename(rel)),
    ]
    const hit = candidates.find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile()
      } catch {
        return false
      }
    })
    if (!hit) throw new Error(`No se encontró archivo ${rel}`)
    text = fs.readFileSync(hit, 'utf8')
  } else {
    text = raw
  }
  text = text.replace(/^\uFEFF/, '').trim()
  return JSON.parse(text)
}

function fmtPeak(p) {
  const n = Number(p) || 0
  const bar = '█'.repeat(Math.min(10, Math.round(n * 10))) + '░'.repeat(Math.max(0, 10 - Math.round(n * 10)))
  return `${bar} ${n.toFixed(3)}`
}

function printSnapshot(s, { compact = false } = {}) {
  if (!s || s.ok === false) {
    console.log(JSON.stringify(s))
    return
  }
  const flag = s.hangSuspect ? ' ⚠ HANG' : s.playing ? ' ▶' : ' ■'
  console.log(
    `[${s.wallClock}]${flag} t=${s.playheadSec.toFixed(3)}s (${s.playheadBars}) bpm=${s.bpm} master=${fmtPeak(s.masterPeak)} host=${s.hostOk}`,
  )
  if (s.issues?.length) for (const i of s.issues) console.log(`  ! ${i}`)
  if (compact) return
  for (const t of s.tracks || []) {
    const marks = [t.muted ? 'M' : '', t.solo ? 'S' : '', t.frozen ? 'F' : ''].filter(Boolean).join('')
    const plug = (t.plugins || []).slice(0, 2).join(',') || '—'
    console.log(
      `  ${marks.padEnd(3)} ${String(t.name).slice(0, 18).padEnd(18)} ${String(t.tipo).padEnd(8)} ${fmtPeak(t.peak)} notes=${t.notes} fx=[${plug}]`,
    )
  }
}

function printActionResults(r) {
  console.log(JSON.stringify(r, null, 2))
  if (r && r.ok === false) process.exitCode = 1
}

function usage() {
  console.log(`JasWave DAW CLI — bridge :${DEFAULT_PORT} (mismas acciones que la IA)

Auditoría
  health                         Bridge + ventana
  audit                          Snapshot meters/playhead
  watch [--play] [-i ms]         Stream en vivo
  sync [segundos] [intervalMs]   Probe underrun/drift/metrónomo (play+buffer)
  state                          Proyecto: pistas, clips, plugins, ids
  certify [--quick|--full] [--skip-vst]  Suite de certificación CLI

Acciones (vía executeDawActions, igual que el chat)
  list [--filter texto]          Catálogo completo
  action <type> [payloadJson]    Una acción
  actions <jsonArray|@file|->    Lote de acciones
  cmd <type> [payloadJson]       Alias de action

Atajos transporte
  play | pause | stop | toggle | seek <sec>

Audio (sale por la tarjeta; se refleja en Ajustes/proyecto)
  audio list | audio get | audio ensure [preferName]
  audio set '{"backend":"asio","deviceId":"…","sampleRate":48000,"bufferSize":512}'

Payload: JSON inline, @archivo.json (cwd o cli/), o "-" (stdin).

Ejemplos
  daw-cli action track.create '{"nombre":"Lead","tipo":"midi"}'
  daw-cli action project.setBpm '{"bpm":128}'
  daw-cli action transport.toggle
  daw-cli action daw.musicBuild '{"aplicar":true,"prompt":"house 124","bpm":124}'
  daw-cli actions '[{"type":"track.create","payload":{"nombre":"Drums","tipo":"midi"}},{"type":"transport.toggle"}]'
  daw-cli sync 10
  daw-cli certify --quick
  daw-cli watch --play

Env: JASWAVE_AGENT_PORT  ·  App: npm run dev`)
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage()
    process.exit(cmd ? 0 : 1)
  }

  try {
    if (cmd === 'certify') {
      const probe = path.join(path.dirname(fileURLToPath(import.meta.url)), '_certify.mjs')
      const { spawnSync } = await import('node:child_process')
      const args = argv.slice(1)
      const r = spawnSync(process.execPath, [probe, ...args], { stdio: 'inherit', env: process.env })
      process.exit(r.status == null ? 1 : r.status)
    }

    if (cmd === 'health') {
      const h = await req('/health')
      console.log(JSON.stringify(h, null, 2))
      process.exit(h.ok && h.window ? 0 : 2)
    }

    if (cmd === 'audit') {
      const s = await req('/audit')
      printSnapshot(s)
      process.exit(s.hangSuspect ? 3 : 0)
    }

    if (cmd === 'sync') {
      const dur = argv[1] || '10'
      const iv = argv[2] || '600'
      const probe = path.join(path.dirname(fileURLToPath(import.meta.url)), '_probe-sync.mjs')
      const { spawnSync } = await import('node:child_process')
      const r = spawnSync(process.execPath, [probe, dur, iv], { stdio: 'inherit', env: process.env })
      process.exit(r.status == null ? 1 : r.status)
    }

    if (cmd === 'state') {
      const s = await req('/state')
      console.log(JSON.stringify(s, null, 2))
      return
    }

    if (cmd === 'list') {
      const listed = await req('/actions')
      let actions = listed.actions || []
      const fi = argv.indexOf('--filter')
      if (fi >= 0 && argv[fi + 1]) {
        const q = argv[fi + 1].toLowerCase()
        actions = actions.filter(
          (a) => a.type.toLowerCase().includes(q) || String(a.description || '').toLowerCase().includes(q),
        )
      }
      if (argv.includes('--json')) {
        console.log(JSON.stringify({ ...listed, actions }, null, 2))
        return
      }
      console.log(`${actions.length} acciones (IA + comandos):\n`)
      for (const a of actions) {
        const kind = a.kind || '?'
        const risk = a.risk ? ` [${a.risk}]` : ''
        console.log(`  ${a.type.padEnd(28)} (${kind})${risk}`)
        if (a.description && a.description !== a.type) console.log(`      ${a.description}`)
      }
      return
    }

    if (cmd === 'watch') {
      let interval = 100
      let doPlay = false
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--play') doPlay = true
        if ((argv[i] === '-i' || argv[i] === '--interval') && argv[i + 1]) {
          interval = Number(argv[++i]) || 100
        }
      }
      if (doPlay) {
        await req('/transport', { method: 'POST', body: JSON.stringify({ action: 'play' }) })
        console.error('(play — el usuario debería oír audio)')
      }
      const res = await fetch(`${BASE}/audit/stream?intervalMs=${interval}`)
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      console.error(`watching … Ctrl+C`)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          try {
            printSnapshot(JSON.parse(line))
          } catch {
            console.log(line)
          }
        }
      }
      return
    }

    if (['play', 'pause', 'stop', 'toggle'].includes(cmd)) {
      console.log(
        JSON.stringify(
          await req('/transport', { method: 'POST', body: JSON.stringify({ action: cmd }) }),
          null,
          2,
        ),
      )
      return
    }

    if (cmd === 'seek') {
      const sec = Number(argv[1])
      if (!Number.isFinite(sec)) throw new Error('seek <segundos>')
      printActionResults(
        await req('/actions', {
          method: 'POST',
          body: JSON.stringify({ type: 'transport.seek', payload: { segundos: sec } }),
        }),
      )
      return
    }

    if (cmd === 'audio') {
      const sub = argv[1]
      if (sub === 'list') {
        printActionResults(
          await req('/actions', { method: 'POST', body: JSON.stringify({ type: 'audio.listDevices', payload: {} }) }),
        )
        return
      }
      if (sub === 'get') {
        printActionResults(
          await req('/actions', { method: 'POST', body: JSON.stringify({ type: 'audio.getDevice', payload: {} }) }),
        )
        return
      }
      if (sub === 'ensure') {
        const preferName = argv[2] || 'UMC'
        printActionResults(
          await req('/actions', {
            method: 'POST',
            body: JSON.stringify({ type: 'audio.ensureBest', payload: { preferName } }),
          }),
        )
        return
      }
      if (sub === 'set') {
        const payload = parseJsonArg(argv[2] ?? '{}')
        printActionResults(
          await req('/actions', {
            method: 'POST',
            body: JSON.stringify({ type: 'audio.setDevice', payload }),
          }),
        )
        return
      }
      throw new Error('audio list|get|ensure [name]|set <json>')
    }

    if (cmd === 'action' || cmd === 'cmd') {
      const type = argv[1]
      if (!type) throw new Error('action <type> [payloadJson]')
      const payload = parseJsonArg(argv[2] ?? '{}')
      printActionResults(
        await req('/actions', {
          method: 'POST',
          body: JSON.stringify({ type, payload }),
        }),
      )
      return
    }

    if (cmd === 'actions') {
      const raw = argv[1]
      if (!raw) throw new Error('actions <jsonArray|@file|->')
      const parsed = parseJsonArg(raw)
      const actions = Array.isArray(parsed) ? parsed : parsed.actions
      if (!Array.isArray(actions)) throw new Error('Se esperaba un array de {type,payload}')
      printActionResults(
        await req('/actions', {
          method: 'POST',
          body: JSON.stringify({ actions }),
        }),
      )
      return
    }

    // Convenience: if first arg looks like action.type, treat as action
    if (cmd.includes('.')) {
      const payload = parseJsonArg(argv[1] ?? '{}')
      printActionResults(
        await req('/actions', {
          method: 'POST',
          body: JSON.stringify({ type: cmd, payload }),
        }),
      )
      return
    }

    usage()
    process.exit(1)
  } catch (e) {
    console.error(`Error: ${e.message}`)
    if (e.body) console.error(JSON.stringify(e.body, null, 2))
    console.error(`¿Está JasWave abierto? Bridge: ${BASE}`)
    process.exit(1)
  }
}

main()
