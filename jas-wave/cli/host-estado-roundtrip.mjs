/**
 * Roundtrip del estado de plugins VST3 contra el host suelto (sin la app):
 *   cargar -> cambiar un parametro -> getPluginState -> descargar -> cargar -> setPluginState -> comprobar.
 *
 * Uso (desde jas-wave/):
 *   node cli/host-estado-roundtrip.mjs [rutaPlugin.vst3 ...]
 *   node cli/host-estado-roundtrip.mjs --host ruta/al/exe
 *   node cli/host-estado-roundtrip.mjs --reprepare   (ademas fuerza suspend+reprepare por cambio de dispositivo)
 * Sin rutas usa los plugins propios de JasWave (%LOCALAPPDATA%\Programs\Common\VST3\JasWave).
 * Para terceros: node cli/host-estado-roundtrip.mjs "C:\Program Files\Common Files\VST3\BFDPlayer.vst3"
 * Salida: una linea JSON por plugin con { ok, ... } y codigo de salida 1 si alguno falla.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const args = process.argv.slice(2)
let hostPath = path.resolve('..', 'native', 'plugin-host', 'build-release', 'Release', 'jaswave-plugin-host.exe')
const plugins = []
let conReprepare = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--host') hostPath = path.resolve(args[++i])
  else if (args[i] === '--reprepare') conReprepare = true
  else plugins.push(args[i])
}
if (!plugins.length) {
  const dir = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Common', 'VST3', 'JasWave')
  for (const n of ['JasWaveParamEq', 'JasWaveGrandPiano', 'JasWaveUtility']) {
    const p = path.join(dir, `${n}.vst3`)
    if (fs.existsSync(p)) plugins.push(p)
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

function abrirHost() {
  const p = spawn(hostPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  const esperando = []
  p.stdout.on('data', (d) => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const linea = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!linea.startsWith('{')) continue
      try {
        const j = JSON.parse(linea)
        esperando.shift()?.(j)
      } catch { /* ignorar */ }
    }
  })
  p.stderr.on('data', () => {})
  const rpc = (cmd, timeoutMs = 90_000) =>
    new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, code: 'Timeout', message: cmd.type }), timeoutMs)
      esperando.push((j) => { clearTimeout(t); resolve(j) })
      p.stdin.write(JSON.stringify(cmd) + '\n')
    })
  return { p, rpc, cerrar: async () => { try { p.stdin.end() } catch { /* ignore */ } await dormir(500); try { p.kill() } catch { /* ignore */ } } }
}

async function probar(ruta) {
  const r = { plugin: path.basename(ruta), ok: false }
  const h = abrirHost()
  try {
    await dormir(800)
    const l1 = await h.rpc({ type: 'load', slotId: 'a', path: ruta })
    if (!l1.ok) return { ...r, fase: 'load1', detalle: l1.message }
    await dormir(500)
    const ps = await h.rpc({ type: 'listParameters', slotId: 'a', maxCount: 400 })
    const params = (ps.parameters ?? []).filter((x) => !x.readOnly && !x.hidden && !x.bypass && !x.programChange && x.stepCount === 0)
    r.parametros = params.length
    // Cambiar hasta 3 parametros continuos a un valor distinto del actual.
    const cambios = params.slice(0, 3).map((x) => ({ id: x.id, antes: x.normalizedValue, nuevo: x.normalizedValue > 0.5 ? 0.2 : 0.8 }))
    for (const c of cambios) await h.rpc({ type: 'setParameter', slotId: 'a', paramId: c.id, normalizedValue: c.nuevo })
    await dormir(400)
    const g1 = await h.rpc({ type: 'getPluginState', slotId: 'a' })
    if (!g1.ok) return { ...r, fase: 'get1', detalle: `${g1.code}: ${g1.message}`, nota: 'plugin sin estado serializable' }
    r.bytesEstado = Buffer.from(g1.stateBase64, 'base64').length
    await h.rpc({ type: 'unload', slotId: 'a' })
    const l2 = await h.rpc({ type: 'load', slotId: 'b', path: ruta })
    if (!l2.ok) return { ...r, fase: 'load2', detalle: l2.message }
    await dormir(500)
    const ps0 = await h.rpc({ type: 'listParameters', slotId: 'b', maxCount: 400 })
    const antesSet = new Map((ps0.parameters ?? []).map((x) => [x.id, x.normalizedValue]))
    const s = await h.rpc({ type: 'setPluginState', slotId: 'b', stateBase64: g1.stateBase64 })
    if (!s.ok) return { ...r, fase: 'set', detalle: `${s.code}: ${s.message}` }
    await dormir(400)
    const ps2 = await h.rpc({ type: 'listParameters', slotId: 'b', maxCount: 400 })
    const despues = new Map((ps2.parameters ?? []).map((x) => [x.id, x.normalizedValue]))
    r.parametrosRestaurados = cambios.map((c) => ({
      id: c.id, esperado: c.nuevo, trasLoadFabrica: antesSet.get(c.id), trasSet: despues.get(c.id),
      ok: Math.abs((despues.get(c.id) ?? -1) - c.nuevo) < 0.02,
    }))
    if (conReprepare) {
      // Fuerza suspend+reprepare de todos los slots (cambio de driver). Si el dispositivo no abre, el host
      // reactiva igualmente los slots: en ambos casos el estado debe sobrevivir.
      const d = await h.rpc({ type: 'setAudioDevice', backend: 'wasapi_exclusive', exclusive: true, sampleRate: 48000, bufferSize: 512 })
      r.reprepare = { ok: Boolean(d.ok), mensaje: d.ok ? '' : String(d.message ?? '').slice(0, 120) }
      await dormir(800)
      const ps3 = await h.rpc({ type: 'listParameters', slotId: 'b', maxCount: 400 })
      const tras = new Map((ps3.parameters ?? []).map((x) => [x.id, x.normalizedValue]))
      r.parametrosTrasReprepare = cambios.map((c) => ({ id: c.id, esperado: c.nuevo, valor: tras.get(c.id), ok: Math.abs((tras.get(c.id) ?? -1) - c.nuevo) < 0.02 }))
    }
    const g2 = await h.rpc({ type: 'getPluginState', slotId: 'b' })
    r.bytesIgualesTrasRoundtrip = g2.ok && g2.stateBase64 === g1.stateBase64
    r.bytesTrasRoundtrip = g2.ok ? Buffer.from(g2.stateBase64, 'base64').length : 0
    // Plugins propios: los parametros deben volver exactamente. Terceros (BFD/Kontakt): los primeros parametros
    // suelen ser proxies MIDI-CC que no forman parte del estado; ahi se exige set OK + tamano estable (+-1%).
    const propio = /[\\/]JasWave[\\/]/i.test(ruta)
    r.estadoEstable = g2.ok && Math.abs(r.bytesTrasRoundtrip - r.bytesEstado) <= Math.max(16, r.bytesEstado * 0.01)
    r.ok = propio
      ? r.parametrosRestaurados.every((x) => x.ok) && (g2.ok ?? false) &&
        (!conReprepare || r.parametrosTrasReprepare.every((x) => x.ok))
      : Boolean(r.estadoEstable)
    return r
  } finally {
    await h.cerrar()
  }
}

let fallos = 0
for (const ruta of plugins) {
  const res = await probar(ruta)
  if (!res.ok) fallos++
  console.log(JSON.stringify(res))
}
process.exit(fallos ? 1 : 0)
