#!/usr/bin/env node
/**
 * Verificación reproducible de `getSlotStats` (V5 §2.4, watchdog de cuarentena):
 * carga un VST3 en el host, renderiza 1 s offline (process() real del slot) y comprueba las estadísticas.
 *   node native/plugin-host/scripts/slot-stats-test.cjs <jaswave-plugin-host.exe> <plugin.vst3>
 */
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const [exe, plugin] = process.argv.slice(2)
if (!exe || !plugin || !fs.existsSync(exe) || !fs.existsSync(plugin)) {
  console.error('uso: slot-stats-test.cjs <jaswave-plugin-host.exe> <plugin.vst3>')
  process.exit(2)
}

const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
let buf = ''
const waiters = []
child.stdout.on('data', (d) => {
  buf += d.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line.startsWith('{')) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    const w = waiters.shift()
    if (w) w(msg)
  }
})
child.stderr.on('data', () => {})
const send = (obj, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando respuesta a ${obj.type}`)), timeoutMs)
    waiters.push((m) => { clearTimeout(t); resolve(m) })
    child.stdin.write(JSON.stringify(obj) + '\n')
  })

let fails = 0
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : '  FALLO'} ${msg}`); if (!ok) fails++ }

;(async () => {
  try {
    const slotId = 'stats-test'
    const loaded = await send({ type: 'load', path: plugin, slotId }, 60000)
    check(loaded.ok === true, `load ${path.basename(plugin)}: ${JSON.stringify(loaded).slice(0, 120)}`)
    const wav = path.join(os.tmpdir(), `jw-slot-stats-${process.pid}.wav`)
    const st = await send({ type: 'renderOfflineStart', outPath: wav, totalFrames: 48000, blockSize: 512, sampleRate: 48000 })
    check(st.ok === true, 'renderOfflineStart')
    for (let i = 0; i < 200; i++) {
      const r = await send({ type: 'renderOfflineStep' })
      if (!r.ok || r.done || (typeof r.progress === 'number' && r.progress >= 1)) break
    }
    await send({ type: 'renderOfflineFinish' })
    const s1 = await send({ type: 'getSlotStats' })
    const slot = (s1.slots || []).find((x) => x.slot === slotId)
    console.log('  getSlotStats →', JSON.stringify(s1))
    check(!!slot, 'el slot aparece en getSlotStats')
    if (slot) {
      check(slot.path === plugin, 'path del plugin')
      check(slot.blocks > 0, `blocks > 0 (${slot.blocks})`)
      check(slot.avgLoad > 0 && slot.maxLoad >= slot.avgLoad, `avgLoad ${slot.avgLoad} ≤ maxLoad ${slot.maxLoad}`)
      check(slot.exceptions === 0, 'sin excepciones')
      check(Number.isInteger(slot.overruns), `overruns ${slot.overruns}`)
    }
    await send({ type: 'getSlotStats', reset: true })
    const s2 = await send({ type: 'getSlotStats' })
    const after = (s2.slots || []).find((x) => x.slot === slotId)
    check(after && after.blocks === 0 && after.maxLoad === 0, 'reset:true pone los contadores a cero')
    fs.rmSync(wav, { force: true })
  } catch (e) {
    console.error(e.message)
    fails++
  }
  child.stdin.end()
  setTimeout(() => child.kill(), 500)
  console.log(fails === 0 ? 'SLOT STATS: OK' : `SLOT STATS: ${fails} FALLO(S)`)
  process.exit(fails === 0 ? 0 : 1)
})()
