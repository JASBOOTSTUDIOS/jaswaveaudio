// Pruebas del motor web de Ambient Atmos. Ejecutar: node --test "plugins/com.jaswave.plugin.ambient-atmos/web/*.test.mjs"
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const { Motor, PARAM, PRESETS, SPEC } = require('./ambient-atmos-worklet.js')

const SR = 48000
const P = PARAM
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12))

// ---------------------------------------------------------------- utilidades
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}
function espectro(x, inicio, N) {
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < N; i++) re[i] = (x[inicio + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  fft(re, im)
  const m = new Float64Array(N / 2 + 1)
  for (let k = 0; k < m.length; k++) m[k] = Math.hypot(re[k], im[k])
  return m
}
/** f0 por pico espectral con interpolación parabólica en log cerca de la frecuencia esperada. */
function f0(x, inicio, N, fEsp) {
  const m = espectro(x, inicio, N)
  const bin = SR / N
  const c = Math.floor(fEsp / bin)
  const w = Math.max(3, Math.floor((fEsp * 0.06) / bin))
  let best = c
  for (let k = Math.max(2, c - w); k <= c + w; k++) if (m[k] > m[best]) best = k
  const a = Math.log(m[best - 1] + 1e-30), b = Math.log(m[best] + 1e-30), cc = Math.log(m[best + 1] + 1e-30)
  const d = (0.5 * (a - cc)) / (a - 2 * b + cc)
  return (best + d) * bin
}
const cents = (f, fe) => 1200 * Math.log2(f / fe)
const hz = (nota) => 440 * Math.pow(2, (nota - 69) / 12)
function centroide(x, inicio, N) {
  const m = espectro(x, inicio, N)
  let num = 0, den = 0
  for (let k = 1; k < m.length; k++) { num += m[k] * ((k * SR) / N); den += m[k] }
  return num / den
}
function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)) }
function pico(x, a = 0, b = x.length) { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i])); return p }
function finito(x) { for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false; return true }

function renderiza(m, n, bloque = 128) {
  const L = new Float32Array(n), R = new Float32Array(n)
  for (let i = 0; i < n; i += bloque) m.render(L, R, Math.min(bloque, n - i), i)
  return { L, R }
}
/** Motor con los efectos al mínimo (para medir f0/timbre del generador). */
function neutro(preset = 0) {
  const m = new Motor(SR)
  m.setParam(P.preset, preset)
  for (const [id, v] of [[P.chorus, 0], [P.drive, 0], [P.delayMix, 0], [P.reverbMix, 0], [P.shimmer, 0], [P.comp, 0], [P.lfoDepth, 0],
    [P.unisonDetune, 0], [P.unisonVoices, 0], [P.cutoff, 20000], [P.lowCut, 20], [P.width, 100], [P.attack, 0.05], [P.fxMacro, 50],
    [P.eqLow, 0], [P.eqLowMid, 0], [P.eqHighMid, 0], [P.eqHigh, 0], [P.layerBlend, 0]]) m.setParam(id, v)
  m.settle()
  return m
}

// ---------------------------------------------------------------- tests
test('tabla de parámetros: 41 ids, rangos y 40 presets coherentes con el VST3', () => {
  assert.equal(SPEC.length, 41)
  assert.equal(P.aftertouch, 40)
  assert.equal(PRESETS.length, 40)
  const nombres = new Set(PRESETS.map((p) => p.name))
  assert.equal(nombres.size, 40)
  for (const [i, p] of PRESETS.entries()) {
    assert.equal(p.p.length, 41, p.name)
    assert.equal(p.familia, Math.floor(i / 10), `${p.name}: familia`)
    for (let id = 1; id < 41; id++) {
      const [mn, mx] = SPEC[id]
      assert.ok(p.p[id] >= mn - 1e-9 && p.p[id] <= mx + 1e-9, `${p.name}: parámetro ${id} = ${p.p[id]} fuera de [${mn}, ${mx}]`)
    }
  }
  assert.equal(PRESETS[0].name, 'Luz de Madrugada')
  assert.equal(PRESETS[39].name, 'Silencio Antes')
})

test('setParam(0, i) aplica el preset completo salvo volumen, afinación y controles de interpretación', () => {
  const m = new Motor(SR)
  m.setParam(P.volume, -6); m.setParam(P.tune, 12); m.setParam(P.sustain, 0)
  m.setParam(P.preset, 8)
  assert.equal(m.p[P.attack], PRESETS[8].p[P.attack])
  assert.equal(m.p[P.release], PRESETS[8].p[P.release])
  assert.equal(m.p[P.drive], PRESETS[8].p[P.drive])
  assert.equal(m.p[P.layerBlend], PRESETS[8].p[P.layerBlend])
  assert.equal(m.p[P.volume], -6)
  assert.equal(m.p[P.tune], 12)
  assert.equal(m.p[P.preset], 8)
})

test('f0 por nota (error < 15 cents) en capas con altura: presets 0, 12 y 23', () => {
  for (const preset of [0, 12, 23]) {
    for (const nota of [48, 60, 69]) {
      const m = neutro(preset)
      m.noteOn(nota, 0.7)
      const { L } = renderiza(m, 3 * SR)
      const fm = f0(L, SR, 65536, hz(nota))
      const err = cents(fm, hz(nota))
      assert.ok(Math.abs(err) < 15, `preset ${preset} nota ${nota}: ${fm.toFixed(2)} Hz (${err.toFixed(1)} ct)`)
    }
  }
})

test('afinación maestra y pitch bend mueven la altura', () => {
  const m = neutro(0)
  m.setParam(P.tune, 100); m.pitchBend(1); m.settle()
  m.noteOn(60, 0.7)
  const { L } = renderiza(m, 3 * SR)
  const err = cents(f0(L, SR, 65536, hz(60) * Math.pow(2, 2 / 12)), hz(60) * Math.pow(2, 2 / 12))
  assert.ok(Math.abs(err) < 15, `${err.toFixed(1)} ct`)
})

test('nivel: a vel 0.7 el pico queda entre -30 y -3 dBFS (una nota, preset de cada familia)', () => {
  for (const preset of [0, 10, 20, 32]) {
    const m = new Motor(SR)
    m.setParam(P.preset, preset); m.settle()
    m.noteOn(48, 0.7)
    const { L, R } = renderiza(m, 6 * SR)
    const pk = Math.max(pico(L), pico(R))
    assert.ok(finito(L) && finito(R))
    assert.ok(db(pk) > -30 && db(pk) < -3, `preset ${preset}: pico ${db(pk).toFixed(1)} dBFS`)
  }
})

test('los 40 presets renderizan sin NaN, con nivel sensato y sin pasar de 0 dBFS (acorde de 3 notas)', () => {
  for (let i = 0; i < 40; i++) {
    const m = new Motor(SR)
    m.setParam(P.preset, i); m.settle()
    const L = new Float32Array(3 * SR), R = new Float32Array(3 * SR)
    m.noteOn(43, 0.7); m.noteOn(55, 0.7); m.noteOn(64, 0.6)
    m.render(L, R, Math.round(1.5 * SR), 0)
    m.noteOff(43); m.noteOff(55); m.noteOff(64)
    m.render(L, R, Math.round(1.5 * SR), Math.round(1.5 * SR))
    assert.ok(finito(L) && finito(R), `${PRESETS[i].name}: NaN/inf`)
    const pk = Math.max(pico(L), pico(R))
    assert.ok(pk < 0.98, `${PRESETS[i].name}: pico ${pk}`)
    assert.ok(db(pk) > -48, `${PRESETS[i].name}: demasiado bajo (${db(pk).toFixed(1)} dBFS)`)
  }
})

test('release: la cola es finita y termina en silencio; panic silencia al instante', () => {
  const m = new Motor(SR)
  m.noteOn(52, 0.7)
  renderiza(m, 2 * SR)
  m.noteOff(52)
  const { L, R } = renderiza(m, 60 * SR, 512)
  assert.ok(finito(L) && finito(R))
  assert.ok(db(rms(L, 50 * SR, 60 * SR)) < -90, `RMS final ${db(rms(L, 50 * SR, 60 * SR)).toFixed(1)} dB`)
  assert.equal(m.activeVoices(), 0)
  // panic
  m.noteOn(52, 0.7); m.noteOn(60, 0.7)
  renderiza(m, SR)
  m.panic()
  const o = renderiza(m, 4096)
  assert.ok(pico(o.L) < 1e-9 && pico(o.R) < 1e-9, 'panic no silencia')
  assert.equal(m.activeVoices(), 0)
})

test('envolvente: attack largo sube despacio; release corto corta antes que uno largo', () => {
  const a = neutro(0); a.setParam(P.attack, 4); a.settle(); a.noteOn(60, 0.7)
  const ra = renderiza(a, 5 * SR).L
  assert.ok(rms(ra, 0, SR / 4) < 0.25 * rms(ra, 4 * SR, 5 * SR), 'el swell no es lento')
  const nivelTrasSoltar = (rel) => {
    const m = neutro(0); m.setParam(P.release, rel); m.settle(); m.noteOn(60, 0.7)
    renderiza(m, 2 * SR); m.noteOff(60)
    return rms(renderiza(m, 3 * SR).L, SR, 3 * SR)
  }
  assert.ok(nivelTrasSoltar(0.3) < 0.1 * nivelTrasSoltar(8))
})

test('setParam cambia timbre/nivel: cutoff, reverb mix, delay mix y macro E/FX', () => {
  const cent = (cut) => { const m = neutro(20); m.setParam(P.cutoff, cut); m.settle(); m.noteOn(60, 0.7); return centroide(renderiza(m, 3 * SR).L, SR, 32768) }
  assert.ok(cent(400) < 0.5 * cent(18000), 'el cutoff no oscurece')
  const cola = (id, v, fx = 50) => {
    const m = neutro(0)
    m.setParam(P.release, 0.3); m.setParam(P.reverbDecay, 8); m.setParam(P.delaySync, 0); m.setParam(P.delayTime, 300); m.setParam(P.delayFb, 50)
    m.setParam(P.fxMacro, fx); m.setParam(id, v); m.settle()
    m.noteOn(60, 0.7); renderiza(m, SR); m.noteOff(60)
    return rms(renderiza(m, 4 * SR).L, SR, 4 * SR)
  }
  assert.ok(cola(P.reverbMix, 60) > 10 * cola(P.reverbMix, 0), 'reverb mix sin efecto')
  assert.ok(cola(P.delayMix, 60) > 10 * cola(P.delayMix, 0), 'delay mix sin efecto')
  const conFx = (fx) => { const m = neutro(0); m.setParam(P.release, 0.3); m.setParam(P.reverbMix, 40); m.setParam(P.delayMix, 30); m.setParam(P.fxMacro, fx); m.settle(); m.noteOn(60, 0.7); renderiza(m, SR); m.noteOff(60); return rms(renderiza(m, 4 * SR).L, SR, 4 * SR) }
  assert.ok(conFx(100) > 3 * conFx(0), `macro E/FX: ${conFx(0)} vs ${conFx(100)}`)
})

test('el tape delay sincroniza con el tempo: 1/4 con puntillo a 120 bpm = 750 ms', () => {
  const m = neutro(0)
  m.setTempo(120)
  for (const [id, v] of [[P.delayMix, 100], [P.delaySync, 2], [P.delayFb, 0], [P.tapeAge, 0], [P.delayTone, 9000], [P.release, 0.2], [P.attack, 0.002], [P.fxMacro, 50]]) m.setParam(id, v)
  m.settle()
  m.noteOn(60, 0.8)
  renderiza(m, Math.round(0.05 * SR))
  m.noteOff(60)
  const x = renderiza(m, 2 * SR).L
  // envolvente RMS cada 5 ms y autocorrelación
  const paso = Math.round(0.005 * SR), nb = Math.floor(x.length / paso)
  const env = new Float64Array(nb)
  for (let i = 0; i < nb; i++) env[i] = rms(x, i * paso, (i + 1) * paso)
  // inicio del eco = primera ventana tras 0,4 s que supera el 30 % del máximo de la nota original
  let ref = 0
  for (let i = 0; i < 10; i++) ref = Math.max(ref, env[i])
  let idx = -1
  for (let i = Math.round(0.4 / 0.005); i < nb; i++) if (env[i] > 0.3 * ref) { idx = i; break }
  assert.ok(idx > 0, 'no hay eco')
  const lagMejor = idx
  const ms = lagMejor * 5 + 50   // x empieza 50 ms después del inicio de la nota
  assert.ok(Math.abs(ms - 750) <= 15, `eco a ${ms} ms (esperado 750)`)
})

test('estabilidad 30 s en el peor caso (feedback 92 %, shimmer 100 %, cola 30 s): sin NaN y sin crecimiento', () => {
  const m = new Motor(SR)
  for (const [id, v] of [[P.delayFb, 92], [P.delayMix, 100], [P.shimmer, 100], [P.reverbDecay, 30], [P.reverbMix, 100], [P.fxMacro, 100], [P.reverbDamp, 0], [P.reverbMod, 100], [P.resonance, 90], [P.cutoff, 20000]]) m.setParam(id, v)
  m.settle()
  m.noteOn(48, 0.7); m.noteOn(55, 0.7); m.noteOn(64, 0.6)
  const { L, R } = renderiza(m, 30 * SR, 256)
  assert.ok(finito(L) && finito(R))
  assert.ok(pico(L) < 1 && pico(R) < 1)
  const e = rms(L, 10 * SR, 15 * SR), l = rms(L, 25 * SR, 30 * SR)
  assert.ok(db(l) - db(e) < 3, `crece ${(db(l) - db(e)).toFixed(1)} dB`)
  m.panic()
  const o = renderiza(m, SR)
  assert.ok(pico(o.L) < 1e-9)
})

test('banco opcional reducido: reproduce la zona en bucle con la afinación correcta', () => {
  const m = neutro(0)   // preset 0: familia guitarra, capa A = 1
  // 480 Hz exactos a 48 kHz = periodo de 100 muestras; bucle de 10 periodos
  const datos = new Float32Array(1000)
  for (let i = 0; i < datos.length; i++) datos[i] = 0.5 * Math.sin((2 * Math.PI * i) / 100)
  m.setBank('guitar', [{ lokey: 0, hikey: 127, root: 69, capa: 1, sr: 48000, bucleIni: 0, bucleFin: 1000, canales: 1, datos }])
  m.noteOn(69, 0.7)
  let { L } = renderiza(m, 3 * SR)
  assert.ok(finito(L))
  let e = cents(f0(L, SR, 65536, 480), 480)
  assert.ok(Math.abs(e) < 15, `banco nota 69: ${e.toFixed(1)} ct`)
  m.panic(); m.settle()
  m.noteOn(81, 0.7)   // una octava arriba
  L = renderiza(m, 3 * SR).L
  e = cents(f0(L, SR, 65536, 960), 960)
  assert.ok(Math.abs(e) < 15, `banco nota 81: ${e.toFixed(1)} ct`)
  // sin zona para la capa => vuelve al generador (440 Hz para la nota 69)
  const s = neutro(0)
  s.setBank('guitar', [{ lokey: 0, hikey: 127, root: 69, capa: 3, sr: 48000, bucleIni: 0, bucleFin: 1000, canales: 1, datos }])
  s.noteOn(69, 0.7)
  const g = renderiza(s, 3 * SR).L
  assert.ok(Math.abs(cents(f0(g, SR, 65536, 440), 440)) < 15)
  // Int16 estéreo
  const i16 = new Int16Array(2000)
  for (let i = 0; i < 1000; i++) { i16[2 * i] = Math.round(16000 * Math.sin((2 * Math.PI * i) / 100)); i16[2 * i + 1] = i16[2 * i] }
  const t = neutro(0)
  t.setBank('any', [{ lokey: 0, hikey: 127, root: 69, capa: 1, sr: 48000, bucleIni: 0, bucleFin: 1000, canales: 2, datos: i16 }])
  t.noteOn(69, 0.7)
  const y = renderiza(t, 3 * SR).L
  assert.ok(finito(y) && pico(y) > 0.01)
  assert.ok(Math.abs(cents(f0(y, SR, 65536, 480), 480)) < 15)
})

test('CPU: <= 400 ms por segundo de audio con 6 notas y la cadena completa (presets 0, 10 y 17)', () => {
  for (const preset of [0, 10, 17]) {
    const m = new Motor(SR)
    m.setParam(P.preset, preset); m.settle()
    for (const n of [40, 47, 52, 59, 64, 71]) m.noteOn(n, 0.7)
    renderiza(m, SR)
    let mejor = Infinity
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now()
      renderiza(m, 2 * SR)
      mejor = Math.min(mejor, (performance.now() - t0) / 2)
    }
    console.log(`  render preset ${preset}: ${mejor.toFixed(0)} ms por segundo de audio (6 notas)`)
    assert.ok(mejor < 400, `preset ${preset}: ${mejor} ms/s`)
  }
})

// ---------------------------------------------------------------- procesador AudioWorklet (mock)
test('registra jaswave-ambient-atmos y respeta `cuando` al sample, params, bend, cc, tempo y pánico', () => {
  let Clase = null
  const ctx = {
    Math, Float32Array, Float64Array, Int16Array, Uint8Array, Array, Number, Object, console, performance,
    sampleRate: SR, currentTime: 0, module: undefined,
    AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null } } },
    registerProcessor: (nombre, c) => { ctx.nombre = nombre; Clase = c },
  }
  vm.runInNewContext(fs.readFileSync(path.join(aqui, 'ambient-atmos-worklet.js'), 'utf8'), ctx)
  assert.equal(ctx.nombre, 'jaswave-ambient-atmos')
  const p = new Clase()
  const msg = (m) => p.port.onmessage({ data: m })
  msg({ tipo: 'param', id: P.attack, valor: 0.01 })
  msg({ tipo: 'tempo', bpm: 90 })
  msg({ tipo: 'on', nota: 57, vel: 0.8, cuando: 0.1 })
  const N = Math.round(0.3 * SR)
  const L = new Float32Array(N), R = new Float32Array(N)
  for (let i = 0; i < N; i += 128) {
    ctx.currentTime = i / SR
    p.process([], [[L.subarray(i, i + 128), R.subarray(i, i + 128)]])
  }
  let primero = -1
  for (let i = 0; i < N; i++) if (Math.abs(L[i]) > 1e-9) { primero = i; break }
  console.log(`  primer sample no nulo: ${primero} (esperado ${Math.round(0.1 * SR)})`)
  assert.ok(primero >= Math.round(0.1 * SR) && primero <= Math.round(0.1 * SR) + 2, `inicio en ${primero}`)
  assert.equal(p.motor.bpm, 90)
  msg({ tipo: 'bend', valor: 1 })
  msg({ tipo: 'cc', num: 1, valor: 127 })
  assert.equal(p.motor.p[P.bend], 1)
  assert.ok(Math.abs(p.motor.p[P.modWheel] - 100) < 1e-9)
  msg({ tipo: 'panico' })
  const o = new Float32Array(128), o2 = new Float32Array(128)
  ctx.currentTime = 1
  p.process([], [[o, o2]])
  assert.ok(pico(o) < 1e-9 && pico(o2) < 1e-9)
  assert.equal(p.motor.queue.length, 0)
})

// ---------------------------------------------------------------- FX Rack comun (shared-dsp/web/fxrack.js incrustado)
// Hash FNV-1a de un render determinista (5 notas, bloques de `bloque` muestras, 3 s)
function hashRender(preset, bloque, preparar) {
  const m = new Motor(SR)
  if (preparar) preparar(m)
  m.setParam(0, preset); m.settle()
  const N = 3 * SR, L = new Float32Array(N), R = new Float32Array(N)
  const ev = []
  ;[38, 50, 57, 62, 66].forEach((n, k) => { ev.push([k * 700, 'on', n, 0.6 + 0.05 * k]); ev.push([SR + k * 300, 'off', n]) })
  ev.sort((a, b) => a[0] - b[0])
  let ei = 0, pos = 0
  while (pos < N) {
    const blk = Math.min(bloque, N - pos)
    let p = 0
    while (p < blk) {
      const abs = pos + p
      while (ei < ev.length && ev[ei][0] <= abs) { const e = ev[ei++]; if (e[1] === 'on') m.noteOn(e[2], e[3]); else m.noteOff(e[2]) }
      let next = blk
      if (ei < ev.length && ev[ei][0] < pos + blk) next = ev[ei][0] - pos
      m.render(L, R, next - p, abs); p = next
    }
    pos += blk
  }
  let h = 0xcbf29ce484222325n
  const b = Buffer.from(L.buffer), c = Buffer.from(R.buffer)
  for (let i = 0; i < N; i++) {
    h = ((h ^ BigInt(b.readUInt32LE(i * 4))) * 0x100000001b3n) & 0xffffffffffffffffn
    h = ((h ^ BigInt(c.readUInt32LE(i * 4))) * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return { h, L, R }
}
const hashTotal = (preparar) => {
  let t = 0xcbf29ce484222325n
  for (const p of [0, 10, 17, 28, 39]) t = ((t ^ hashRender(p, 128, preparar).h) * 0x100000001b3n) & 0xffffffffffffffffn
  return '0x' + t.toString(16).padStart(16, '0')
}
const HASH_REF = '0xa1593452b0470c08'          // 5 presets, bloques de 128, medido ANTES de integrar el rack
const HASH_REF_PRESET5 = '0x1a253a3ed685fc78'  // preset 5, bloques de 77

test('FX Rack: 58 parametros ids 100..230 registrados con sus claves y el manifiesto coincide', () => {
  const claves = Object.keys(P).filter((k) => P[k] >= 100)
  assert.equal(claves.length, 58)
  assert.equal(P.fx_eq_b1_gain, 118)
  assert.equal(P.fx_out_gain, 230)
  assert.equal(P.aftertouch, 40)   // ids propios intactos
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId >= 100).length, 58)
  assert.match(man.ai.summary, /FX Rack/)
})

test('FX Rack: apagado = salida identica bit a bit a la previa (5 presets), aunque tenga ajustes; encendido si cambia', () => {
  assert.equal(hashTotal(), HASH_REF)
  assert.equal('0x' + hashRender(5, 77).h.toString(16), HASH_REF_PRESET5)
  const ajustes = (m) => { m.setParam(P.fx_eq_b3_gain, 12); m.setParam(P.fx_comp_threshold, -50); m.setParam(P.fx_reverb_mix, 100); m.setParam(P.fx_out_gain, 12) }
  assert.equal(hashTotal(ajustes), HASH_REF)
  const base = hashRender(0, 128)
  const enc = hashRender(0, 128, (m) => { m.setParam(P.fx_eq_on, 1); m.setParam(P.fx_eq_b3_gain, 12); m.setParam(P.fx_eq_b3_freq, 600) })
  assert.notEqual(enc.h, base.h)
  let dif = 0
  for (let i = 0; i < base.L.length; i++) dif = Math.max(dif, Math.abs(enc.L[i] - base.L[i]))
  assert.ok(dif > 1e-3, `el EQ encendido debe cambiar la salida (${dif})`)
  assert.ok(finito(enc.L) && finito(enc.R))
})

test('FX Rack: cambiar de preset NO toca los ids >= 100 (el rack es del usuario)', () => {
  const m = new Motor(SR)
  m.setParam(P.fx_eq_on, 1); m.setParam(P.fx_eq_b3_gain, 7); m.setParam(P.fx_reverb_on, 1)
  const antes = JSON.stringify(m.fx.p)
  for (const i of [3, 17, 28, 39, 0]) m.setParam(0, i)
  assert.equal(JSON.stringify(m.fx.p), antes)
})

test('FX Rack: todo encendido es finito y acotado; el tempo llega al delay; las colas suenan tras soltar la nota', () => {
  const m = new Motor(SR)
  for (const k of ['fx_hpf_on', 'fx_eq_on', 'fx_comp_on', 'fx_sat_on', 'fx_chorus_on', 'fx_delay_on', 'fx_reverb_on', 'fx_out_on']) m.setParam(P[k], 1)
  m.setTempo(90); m.setParam(P.fx_delay_sync, 1)
  m.noteOn(60, 0.8)
  const { L, R } = renderiza(m, 3 * SR)
  let pk = 0
  for (let i = 0; i < L.length; i++) { assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i])); pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])) }
  assert.ok(pk < 4, `pico ${pk}`)
  assert.equal(m.fx.bpm, 90)
  assert.equal(m.fx.fallos, 0)
  // cola del rack: con el motor ya en silencio (sin voces) el reverb/delay del rack siguen sonando
  const m2 = new Motor(SR)
  m2.setParam(P.reverbMix, 0); m2.setParam(P.delayMix, 0); m2.setParam(P.release, 0.2)
  m2.setParam(P.fx_reverb_on, 1); m2.setParam(P.fx_reverb_mix, 60); m2.setParam(P.fx_reverb_size, 100)
  m2.noteOn(60, 0.9)
  renderiza(m2, SR / 2); m2.noteOff(60)
  for (let t = 0; t < 30 && !m2.silent; t++) renderiza(m2, SR / 2)
  assert.equal(m2.silent, true, 'el motor interno debe estar en silencio')
  const cola = renderiza(m2, SR / 2)
  assert.ok(finito(cola.L) && rms(cola.L, 0, cola.L.length) > 1e-6, `la cola del rack debe sonar (rms ${rms(cola.L, 0, cola.L.length)})`)
})
