// node --test plugins/com.jaswave.plugin.strings-section/web
// Ejecuta el archivo real del AudioWorklet fuera del navegador: clase Motor (offline) y, con un mock mínimo de
// AudioWorklet, el procesador registrado (mensajes del puerto y eventos con `cuando` al sample).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { Motor, PARAM } = require('./strings-section-worklet.js')

const SR = 48000
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12)
const cents = (f, ref) => 1200 * Math.log2(f / ref)

function renderizar(m, seg, bloque = 128) {
  const N = Math.round(seg * SR)
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  for (let i = 0; i < N; i += bloque) {
    const n = Math.min(bloque, N - i)
    m.render(L.subarray(i, i + n), R.subarray(i, i + n), n)
  }
  return { L, R }
}

function f0Acf(L, R, i0, i1, esperada) {
  const N = i1 - i0
  const x = new Float64Array(N)
  for (let i = 0; i < N; i++) x[i] = 0.5 * (L[i0 + i] + R[i0 + i])
  const p0 = SR / esperada
  const lo = Math.floor(p0 * 0.94)
  const hi = Math.floor(p0 * 1.06) + 2
  const ac = new Float64Array(hi + 3)
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0, e1 = 0, e2 = 0
    for (let i = 0; i + lag < N; i++) { s += x[i] * x[i + lag]; e1 += x[i] * x[i]; e2 += x[i + lag] * x[i + lag] }
    ac[lag] = s / Math.sqrt(e1 * e2 + 1e-30)
  }
  let best = lo
  for (let lag = lo; lag <= hi; lag++) if (ac[lag] > ac[best]) best = lag
  const a = ac[best - 1], b = ac[best], c = ac[best + 1]
  const den = a - 2 * b + c
  const d = Math.abs(den) > 1e-12 ? (0.5 * (a - c)) / den : 0
  return SR / (best + d)
}

const rms = (L, R, i0, i1) => {
  let s = 0
  for (let i = i0; i < i1; i++) s += L[i] * L[i] + R[i] * R[i]
  return Math.sqrt(s / (2 * Math.max(1, i1 - i0)))
}
const pico = (L, R) => {
  let p = 0
  for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]))
  return p
}
const finito = (L, R) => {
  for (let i = 0; i < L.length; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) return false
  return true
}
const db = (x) => 20 * Math.log10(x + 1e-12)

describe('Strings Section web — Motor', () => {
  it('afinación: f0 media del ensemble con error < 15 cents (graves, medios y agudos)', () => {
    const peor = []
    for (const nota of [28, 36, 43, 50, 57, 62, 69, 74, 81, 86, 93]) {
      const m = new Motor(SR)
      m.noteOn(nota, 0.7)
      const { L, R } = renderizar(m, 2.4)
      assert.ok(finito(L, R), `NaN/inf en nota ${nota}`)
      const f = f0Acf(L, R, Math.round(1.0 * SR), Math.round(2.2 * SR), mtof(nota))
      const c = cents(f, mtof(nota))
      peor.push(Math.abs(c))
      assert.ok(Math.abs(c) < 15, `nota ${nota}: ${c.toFixed(2)} cents`)
    }
    console.log('  peor error de afinación:', Math.max(...peor).toFixed(2), 'cents')
  })

  it('pitch bend +2 st y afinación A4 (tune) desplazan el tono', () => {
    const m = new Motor(SR)
    m.pitchBend(2)
    m.noteOn(57, 0.7)
    const a = renderizar(m, 2)
    const cb = cents(f0Acf(a.L, a.R, Math.round(0.8 * SR), Math.round(1.9 * SR), mtof(59)), mtof(59))
    assert.ok(Math.abs(cb) < 15, `bend: ${cb}`)
    const m2 = new Motor(SR)
    m2.setParam(7, 450)
    m2.noteOn(69, 0.7)
    const b = renderizar(m2, 2)
    const ct = cents(f0Acf(b.L, b.R, Math.round(0.8 * SR), Math.round(1.9 * SR), 450), 450)
    assert.ok(Math.abs(ct) < 15, `tune: ${ct}`)
  })

  it('nivel: pico < 0,98 y RMS razonable con acorde de 6 notas a forte, sin NaN', () => {
    const m = new Motor(SR)
    m.setParam(0, 100); m.setParam(10, 100)
    for (const n of [38, 50, 57, 62, 66, 69]) m.noteOn(n, 0.9)
    const { L, R } = renderizar(m, 4)
    assert.ok(finito(L, R))
    const p = pico(L, R)
    const r = rms(L, R, Math.round(2 * SR), Math.round(4 * SR))
    console.log(`  acorde ff: pico ${p.toFixed(3)} (${db(p).toFixed(1)} dBFS), RMS ${db(r).toFixed(1)} dBFS`)
    assert.ok(p < 0.98, `pico ${p}`)
    assert.ok(db(r) > -40 && db(r) < -3, `RMS ${db(r)}`)
  })

  it('decaimiento tras note-off (release + cola de sala) y silencio exacto tras panic', () => {
    const m = new Motor(SR)
    m.setParam(3, 300)
    m.noteOn(57, 0.7)
    const a = renderizar(m, 1.5)
    const rSost = rms(a.L, a.R, Math.round(1.0 * SR), Math.round(1.5 * SR))
    m.noteOff(57)
    const b = renderizar(m, 8)
    const rCola = rms(b.L, b.R, Math.round(6 * SR), Math.round(8 * SR))
    console.log(`  sostenido ${db(rSost).toFixed(1)} dBFS -> cola a 6..8 s ${db(rCola).toFixed(1)} dBFS`)
    assert.ok(db(rCola) < db(rSost) - 40, 'la cola no decae')
    assert.equal(m.activeVoices(), 0)
    m.noteOn(60, 0.8)
    renderizar(m, 0.3)
    m.panic()
    const c = renderizar(m, 0.5)
    assert.ok(pico(c.L, c.R) < 1e-9, `no silencia tras panic: ${pico(c.L, c.R)}`)
    assert.equal(m.activeVoices(), 0)
  })

  it('setParam cambia nivel y timbre: expression/mod wheel (dinámica pp→ff), hall, anchura, volumen', () => {
    const med = (cfg) => {
      const m = new Motor(SR)
      for (const [id, v] of cfg) m.setParam(id, v)
      m.noteOn(57, 0.7)
      const { L, R } = renderizar(m, 2)
      // brillo equivalente: RMS de la derivada / RMS de la señal
      let e0 = 0, e1 = 0
      for (let i = Math.round(1.0 * SR); i < Math.round(1.8 * SR); i++) { const d = L[i] - L[i - 1]; e0 += L[i] * L[i]; e1 += d * d }
      return { nivel: rms(L, R, Math.round(1 * SR), Math.round(1.8 * SR)), brillo: (Math.sqrt(e1 / (e0 + 1e-30)) * SR) / (2 * Math.PI), L, R }
    }
    const pp = med([[0, 35], [10, 0]])
    const ff = med([[0, 100], [10, 100]])
    console.log(`  pp: ${db(pp.nivel).toFixed(1)} dBFS, brillo ${pp.brillo.toFixed(0)} Hz | ff: ${db(ff.nivel).toFixed(1)} dBFS, brillo ${ff.brillo.toFixed(0)} Hz`)
    assert.ok(ff.nivel > pp.nivel * 2, 'el nivel no sube con la dinámica')
    assert.ok(ff.brillo > pp.brillo * 1.3, 'el timbre no se abre con la dinámica')
    const soloMod = med([[0, 75], [10, 100]])
    const sinMod = med([[0, 75], [10, 0]])
    assert.ok(soloMod.brillo > sinMod.brillo * 1.15, 'el mod wheel no abre el timbre')
    // volumen
    const v0 = med([[6, 0]]), v6 = med([[6, -12]])
    assert.ok(Math.abs(db(v0.nivel) - db(v6.nivel) - 12) < 1.5, 'volumen -12 dB')
    // anchura: correlación L/R
    const corr = (o) => { let a = 0, b = 0, c = 0; for (let i = 0; i < o.L.length; i++) { a += o.L[i] * o.R[i]; b += o.L[i] ** 2; c += o.R[i] ** 2 } return a / Math.sqrt(b * c + 1e-30) }
    const ancho = med([[8, 100]]), estrecho = med([[8, 0]])
    assert.ok(corr(estrecho) > corr(ancho) + 0.05, `anchura: ${corr(estrecho)} vs ${corr(ancho)}`)
    // sala: más cola con hall grande
    const cola = (h) => {
      const m = new Motor(SR)
      m.setParam(4, h); m.setParam(3, 50); m.setParam(2, 20)
      m.noteOn(57, 0.8); m.noteOn(62, 0.8)
      renderizar(m, 0.5)
      m.noteOff(57); m.noteOff(62)
      const { L, R } = renderizar(m, 4)
      return { r1: rms(L, R, Math.round(0.8 * SR), Math.round(1.0 * SR)), r3: rms(L, R, Math.round(2.9 * SR), Math.round(3.1 * SR)) }
    }
    const h0 = cola(0), h1 = cola(100)
    console.log(`  cola de sala: hall 0 % a 3 s ${db(h0.r3).toFixed(1)} dBFS | hall 100 % ${db(h1.r3).toFixed(1)} dBFS`)
    assert.ok(h1.r3 > h0.r3 * 10, 'la sala grande no alarga la cola')
  })

  it('RT60 de la sala al 100 % ≈ 4 s (2.5..5.5 s) y estable con parámetros extremos', () => {
    const m = new Motor(SR)
    m.setParam(4, 100); m.setParam(3, 50); m.setParam(2, 20)
    m.noteOn(57, 0.8); m.noteOn(62, 0.8)
    renderizar(m, 0.5)
    m.noteOff(57); m.noteOff(62)
    const { L, R } = renderizar(m, 6)
    const d1 = db(rms(L, R, Math.round(0.9 * SR), Math.round(1.0 * SR)))
    const d2 = db(rms(L, R, Math.round(2.9 * SR), Math.round(3.0 * SR)))
    const rt = 60 / ((d1 - d2) / 2)
    console.log(`  RT60 medido ~${rt.toFixed(2)} s`)
    assert.ok(rt > 2.5 && rt < 5.5, `RT60 ${rt}`)
    // extremos
    const e = new Motor(SR)
    for (const [id, v] of [[4, 100], [0, 100], [10, 100], [6, 6], [1, 100], [15, 100], [9, 8], [2, 20], [3, 3000], [8, 100], [14, 300], [12, 2]]) e.setParam(id, v)
    for (let i = 0; i < 200; i++) {
      e.noteOn(28 + ((i * 7) % 70), 1)
      const o = renderizar(e, 0.05, 64)
      assert.ok(finito(o.L, o.R), 'NaN/inf con parámetros extremos')
      assert.ok(pico(o.L, o.R) <= 1.0001, 'pico > 1')
    }
    assert.ok(e.activeVoices() <= 36)
  })

  it('legato: sin re-ataque (nivel continuo) y con portamento al nuevo tono', () => {
    const m = new Motor(SR)
    m.setParam(4, 0)
    m.noteOn(62, 0.7)
    const a = renderizar(m, 1.5)
    m.noteOn(64, 0.7) // llega antes de soltar la anterior
    const b = renderizar(m, 0.6)
    m.noteOff(62)
    const c = renderizar(m, 1.2)
    const antes = rms(a.L, a.R, Math.round(1.40 * SR), Math.round(1.49 * SR))
    const despues = rms(b.L, b.R, Math.round(0.06 * SR), Math.round(0.15 * SR))
    const q = despues / antes
    console.log(`  cociente de nivel tras la transición: ${q.toFixed(2)} (voces activas ${m.activeVoices()})`)
    assert.ok(q > 0.6 && q < 1.6, `salto de nivel ${q}`)
    assert.equal(m.activeVoices(), 1, 'legato no debe crear una segunda voz')
    const f = f0Acf(c.L, c.R, Math.round(0.4 * SR), Math.round(1.1 * SR), mtof(64))
    assert.ok(Math.abs(cents(f, mtof(64))) < 15, 'no llega al tono nuevo')
    // sin legato: dos voces
    const n = new Motor(SR)
    n.setParam(13, 0)
    n.noteOn(62, 0.7); renderizar(n, 0.5); n.noteOn(64, 0.7); renderizar(n, 0.1)
    assert.equal(n.activeVoices(), 2)
    // un acorde (ataques casi simultáneos) NO es legato
    const ch = new Motor(SR)
    ch.noteOn(62, 0.7); ch.noteOn(66, 0.7); ch.noteOn(69, 0.7)
    renderizar(ch, 0.2)
    assert.equal(ch.activeVoices(), 3)
  })

  it('CC11 / CC1 / CC64 y robo de voces (máx. 32) sin NaN', () => {
    const m = new Motor(SR)
    m.cc(11, 127); m.cc(1, 127)
    for (let i = 0; i < 50; i++) { m.noteOn(36 + (i % 48), 0.6); renderizar(m, 0.01, 128) }
    const o = renderizar(m, 0.5)
    assert.ok(finito(o.L, o.R))
    let activas = 0
    for (const v of m.voices) if (v.active && !v.killing) activas++
    assert.ok(activas <= 32, `voces ${activas}`)
    const p = new Motor(SR)
    p.cc(64, 127)
    p.noteOn(60, 0.7); renderizar(p, 0.5); p.noteOff(60); renderizar(p, 1.5)
    assert.equal(p.activeVoices(), 1, 'el pedal no sostiene la nota')
    p.cc(64, 0); renderizar(p, 1.5)
    assert.equal(p.activeVoices(), 0, 'el pedal no libera la nota')
  })

  it('robustez: frecuencias de muestreo y bloques de 1 a 4096 muestras', () => {
    for (const sr of [44100, 48000, 88200, 96000, 176400, 192000]) {
      for (const bloque of [1, 7, 128, 4096]) {
        const m = new Motor(sr)
        for (const n of [38, 50, 57, 62, 66]) m.noteOn(n, 0.8)
        m.noteOn(107, 0.9)
        const N = bloque === 1 ? Math.round(0.1 * sr) : Math.round(0.6 * sr)
        const L = new Float32Array(N), R = new Float32Array(N)
        for (let i = 0; i < N; i += bloque) { const k = Math.min(bloque, N - i); m.render(L.subarray(i, i + k), R.subarray(i, i + k), k) }
        assert.ok(finito(L, R), `NaN a ${sr} Hz bloque ${bloque}`)
        assert.ok(pico(L, R) <= 1.0001)
      }
    }
  })

  it('CPU: 16 voces en JS (informativo; < 60 % de un núcleo)', () => {
    const m = new Motor(SR)
    for (let i = 0; i < 16; i++) m.noteOn(40 + i * 3, 0.7)
    const L = new Float32Array(128), R = new Float32Array(128)
    m.render(L, R, 128)
    const t0 = process.hrtime.bigint()
    const bloques = Math.round((3 * SR) / 128)
    for (let b = 0; b < bloques; b++) m.render(L, R, 128)
    const seg = Number(process.hrtime.bigint() - t0) / 1e9
    const cpu = (100 * seg) / 3
    console.log(`  16 voces: ${cpu.toFixed(1)} % de un núcleo (Node, V8)`)
    assert.ok(cpu < 60, `CPU ${cpu}`)
  })
})

describe('Strings Section web — procesador AudioWorklet (mock)', () => {
  function cargar() {
    let Clase = null
    const ctx = {
      Math, Float32Array, Float64Array, Int32Array, Array, Number, Object, console,
      sampleRate: SR, currentTime: 0, module: undefined,
      AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null } } },
      registerProcessor: (nombre, c) => { ctx.nombre = nombre; Clase = c },
    }
    vm.runInNewContext(readFileSync(path.join(aqui, 'strings-section-worklet.js'), 'utf8'), ctx)
    return { Clase, ctx }
  }

  it('registra jaswave-strings-section y respeta `cuando` al sample, params, bend, cc y pánico', () => {
    const { Clase, ctx } = cargar()
    assert.equal(ctx.nombre, 'jaswave-strings-section')
    const p = new Clase()
    const msg = (m) => p.port.onmessage({ data: m })
    msg({ tipo: 'param', id: 4, valor: 0 })
    msg({ tipo: 'on', nota: 57, vel: 100, cuando: 0.1 })
    const N = Math.round(0.3 * SR)
    const salida = new Float32Array(N), salidaR = new Float32Array(N)
    for (let i = 0; i < N; i += 128) {
      ctx.currentTime = i / SR
      p.process([], [[salida.subarray(i, i + 128), salidaR.subarray(i, i + 128)]])
    }
    let primero = -1
    for (let i = 0; i < N; i++) if (Math.abs(salida[i]) > 1e-9) { primero = i; break }
    console.log(`  primer sample no nulo: ${primero} (esperado ${Math.round(0.1 * SR)})`)
    assert.ok(primero >= Math.round(0.1 * SR) && primero <= Math.round(0.1 * SR) + 2, `inicio en ${primero}`)
    msg({ tipo: 'bend', valor: 1 })
    msg({ tipo: 'cc', num: 11, valor: 64 })
    assert.equal(p.motor.s.bendSemis, 1)
    assert.ok(Math.abs(p.motor.s.expression - 64 / 127) < 1e-9)
    msg({ tipo: 'panico' })
    const o = new Float32Array(128), o2 = new Float32Array(128)
    ctx.currentTime = 1
    p.process([], [[o, o2]])
    assert.ok(pico(o, o2) < 1e-9)
    assert.equal(p.cola.length, 0)
  })

  it('FX Rack: el mensaje de puerto `tempo` y los ids >= 100 llegan al rack', () => {
    const { Clase } = cargar()
    const p = new Clase()
    p.port.onmessage({ data: { tipo: 'tempo', bpm: 133 } })
    p.port.onmessage({ data: { tipo: 'param', id: PARAM.fx_delay_on, valor: 1 } })
    assert.equal(p.motor.fx.bpm, 133)
  })
})

// ---------------------------------------------------------------- FX Rack comun (shared-dsp/web/fxrack.js incrustado)
// Hash FNV-1a (bits float32 de L y R) de 2 s con 3 notas, tomado ANTES de integrar el rack (equivale a anular fx.process).
function hashMotor(m) {
  const N = 2 * SR
  const L = new Float32Array(N), R = new Float32Array(N)
  m.noteOn(57, 0.8); m.noteOn(64, 0.7); m.noteOn(40, 0.6)
  for (let i = 0; i < N; i += 128) { const n = Math.min(128, N - i); m.render(L.subarray(i, i + n), R.subarray(i, i + n), n) }
  let h = 0xcbf29ce484222325n
  const f = new Float32Array(1), u = new Uint32Array(f.buffer)
  for (const a of [L, R]) for (let i = 0; i < N; i++) { f[0] = a[i]; h = ((h ^ BigInt(u[0])) * 0x100000001b3n) & 0xffffffffffffffffn }
  return h.toString(16)
}
const HASH_SIN_RACK = 'c43bf0c84b297d71'

describe('Strings Section web — FX Rack comun', () => {
  it('58 parametros ids 100..230 registrados con sus claves; el manifiesto coincide', () => {
    const ids = Object.entries(PARAM).filter(([k, v]) => k.startsWith('fx_') && v >= 100)
    assert.equal(ids.length, 58)
    assert.equal(PARAM.fx_eq_b1_gain, 118)
    assert.equal(PARAM.fx_out_gain, 230)
    const man = JSON.parse(readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
    assert.equal(man.ai.parameters.filter((p) => p.vstParamId >= 100).length, 58)
    assert.match(man.ai.summary, /FX Rack/)
    assert.ok(man.ai.summary.length <= 1000)
    for (const p of man.ai.parameters) assert.ok(p.name.length <= 120, p.name)
  })

  it('apagado por defecto: salida identica bit a bit a la previa al rack, aunque tenga ajustes; encendido si cambia', () => {
    assert.equal(hashMotor(new Motor(SR)), HASH_SIN_RACK)
    const m1 = new Motor(SR)
    m1.setParam(PARAM.fx_eq_b3_gain, 12); m1.setParam(PARAM.fx_comp_threshold, -50); m1.setParam(PARAM.fx_reverb_mix, 100); m1.setParam(PARAM.fx_out_gain, 12)
    assert.equal(hashMotor(m1), HASH_SIN_RACK)
    const m2 = new Motor(SR)
    m2.setParam(PARAM.fx_eq_on, 1); m2.setParam(PARAM.fx_eq_b3_gain, 12); m2.setParam(PARAM.fx_eq_b3_freq, 600)
    assert.notEqual(hashMotor(m2), HASH_SIN_RACK)
  })

  it('todo encendido es finito y acotado; el tempo llega al delay (motor y mensaje del puerto)', () => {
    const m = new Motor(SR)
    for (const k of ['fx_hpf_on', 'fx_eq_on', 'fx_comp_on', 'fx_sat_on', 'fx_chorus_on', 'fx_delay_on', 'fx_reverb_on', 'fx_out_on']) m.setParam(PARAM[k], 1)
    m.setTempo(90); m.setParam(PARAM.fx_delay_sync, 1)
    m.noteOn(60, 0.8)
    const { L, R } = renderizar(m, 3)
    let pico = 0
    for (let i = 0; i < L.length; i++) { assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i])); pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])) }
    assert.ok(pico < 4, `pico ${pico}`)
    assert.equal(m.fx.bpm, 90)
    assert.equal(m.fx.fallos, 0)
  })
})
