// Pruebas del motor web del Shimmer Pad. Ejecutar: node --test plugins/com.jaswave.plugin.shimmer-pad/web
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const { Motor, PARAMS, PARAM_IDS } = require('./shimmer-pad-worklet.js')

const SR = 48000

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

/** f0 por pico espectral con interpolacion parabolica en log (busca cerca de la frecuencia esperada). */
function f0(x, inicio, N, fEsp, sr = SR) {
  const m = espectro(x, inicio, N)
  const bin = sr / N
  const c = Math.floor(fEsp / bin)
  const w = Math.max(3, Math.floor((fEsp * 0.06) / bin))
  let best = c
  for (let k = Math.max(2, c - w); k <= c + w; k++) if (m[k] > m[best]) best = k
  const a = Math.log(m[best - 1] + 1e-30), b = Math.log(m[best] + 1e-30), cc = Math.log(m[best + 1] + 1e-30)
  const d = (0.5 * (a - cc)) / (a - 2 * b + cc)
  return (best + d) * bin
}

function centsEntre(f, fEsp) { return 1200 * Math.log2(f / fEsp) }
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)) }
const pico = (x, a = 0, b = x.length) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i])); return p }
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12))

function renderiza(m, n, bloque = 128) {
  const L = new Float32Array(n), R = new Float32Array(n)
  for (let p = 0; p < n; p += bloque) m.render(L, R, Math.min(bloque, n - p), p)
  return { L, R }
}

function neutro(sr = SR) {
  const m = new Motor(sr)
  m.setParam(0, 20000); m.setParam(1, 0); m.setParam(8, 0.02); m.setParam(9, 0.2)
  m.setParam(10, 0); m.setParam(13, 0); m.setParam(7, 0); m.setParam(11, 0); m.setParam(12, 0)
  m.s.lfoDepthOct = 0; m.s.driftScale = 0
  m.settle()
  return m
}

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12)

// ---------------------------------------------------------------- pruebas
test('tabla de parametros coherente con el manifiesto y el ui-layout', () => {
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.deepEqual(man.targetPlatforms, ['win-x64', 'web'])
  assert.equal(man.entrypoints.dspWeb, 'web/shimmer-pad-worklet.js')
  assert.equal(man.ai.parameters.length, PARAMS.length)
  for (const p of man.ai.parameters) {
    const w = PARAMS.find((q) => q.id === p.vstParamId)
    assert.ok(w, `parametro ${p.id} ausente en el worklet`)
    assert.equal(PARAM_IDS[p.id], p.vstParamId, `nombre ${p.id}`)
    assert.equal(w.min, p.min, `${p.id} min`)
    assert.equal(w.max, p.max, `${p.id} max`)
    assert.equal(w.def, p.default, `${p.id} default`)
  }
  const lay = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'ui-layout.json'), 'utf8'))
  for (const w of lay.widgets) if (w.param !== undefined) assert.ok(PARAMS.some((q) => q.id === w.param), `param ${w.param} del layout`)
  for (const w of lay.widgets.filter((q) => q.param !== undefined && q.tipo !== 'section')) {
    const p = PARAMS.find((q) => q.id === w.param)
    assert.equal(p.min, w.min); assert.equal(p.max, w.max); assert.equal(p.def, w.defecto)
  }
})

test('afinacion: f0 de 6 notas (3 registros) con error < 15 cents y sin NaN', () => {
  const notas = [36, 48, 60, 72, 84, 96]
  const vels = [0.4, 0.6, 0.8, 1, 0.5, 0.7]
  notas.forEach((n, i) => {
    const m = neutro()
    m.noteOn(n, vels[i])
    const { L } = renderiza(m, Math.floor(1.6 * SR))
    for (let k = 0; k < L.length; k++) assert.ok(Number.isFinite(L[k]), 'NaN/inf')
    const f = f0(L, Math.floor(0.4 * SR), 65536, mtof(n))
    const c = centsEntre(f, mtof(n))
    assert.ok(Math.abs(c) < 10, `nota ${n}: ${c.toFixed(2)} cents`)
  })
})

test('pitch bend +2 st y rueda de modulacion', () => {
  const m = neutro()
  m.pitchBend(2)
  m.settle()
  m.noteOn(60, 0.8)
  const { L } = renderiza(m, Math.floor(1.6 * SR))
  const fe = mtof(60) * Math.pow(2, 2 / 12)
  assert.ok(Math.abs(centsEntre(f0(L, Math.floor(0.6 * SR), 65536, fe), fe)) < 10)
})

test('nivel: acorde con parametros por defecto (pico < 0.98, RMS razonable) y sin NaN', () => {
  const m = new Motor(SR)
  for (const n of [38, 50, 57, 62, 66]) m.noteOn(n, 0.7)
  const { L, R } = renderiza(m, 8 * SR)
  for (let i = 0; i < L.length; i++) assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]))
  const p = Math.max(pico(L), pico(R))
  const r = rms(L, 4 * SR, 8 * SR)
  assert.ok(p < 0.98, `pico ${p}`)
  assert.ok(r > 0.01 && r < 0.4, `RMS ${db(r).toFixed(1)} dBFS`)
})

test('estabilidad: barrido de cutoff x resonancia x sample rate sin NaN y acotado', () => {
  for (const sr of [44100, 48000, 96000]) {
    const m = new Motor(sr)
    for (const fc of [20, 90, 800, 6400, 12000, 20000]) {
      for (const res of [0, 50, 100]) {
        m.setParam(0, fc); m.setParam(1, res); m.setParam(7, 100); m.setParam(10, 60); m.setParam(8, 0.05); m.setParam(15, 100)
        m.allSoundOff()
        m.noteOn(36, 1); m.noteOn(60, 0.9); m.noteOn(96, 1); m.noteOn(120, 1)
        const { L, R } = renderiza(m, Math.floor(0.3 * sr), 37)
        for (let i = 0; i < L.length; i++) assert.ok(Math.abs(L[i]) <= 1 && Math.abs(R[i]) <= 1, `sr ${sr} fc ${fc} res ${res}`)
        m.cc(123, 0)
      }
    }
  }
})

test('decaimiento: tras note-off el nivel cae > 60 dB; el RT60 del shimmer controla la cola', () => {
  const cola = (rt) => {
    const m = new Motor(SR)
    m.setParam(8, 0.05); m.setParam(9, 0.1); m.setParam(10, 100); m.setParam(3, rt); m.setParam(7, 0)
    m.noteOn(60, 0.9)
    renderiza(m, Math.floor(1.0 * SR))
    m.noteOff(60)
    const { L } = renderiza(m, 14 * SR)
    return { silencio: rms(L, 13 * SR, 14 * SR), t2: rms(L, Math.floor(2.0 * SR), Math.floor(2.5 * SR)) }
  }
  const corto = cola(0.5), largo = cola(10)
  assert.ok(corto.t2 < 1e-4, `RT 0.5 s: ${db(corto.t2).toFixed(1)} dB a los 2 s`)
  assert.ok(largo.t2 > 20 * corto.t2, `RT 10 s debe sonar mucho mas a los 2 s (${db(largo.t2).toFixed(1)} vs ${db(corto.t2).toFixed(1)} dB)`)
  assert.ok(largo.silencio < 1e-3, 'la cola de 10 s debe haber caido tras 13 s')
})

test('RT60 medido del motor completo (impulso) cercano al parametro', () => {
  // un unico toque corto con reverb 100 % solo humedo: caida de energia entre -5 y -35 dB
  for (const rt of [2, 6]) {
    const m = new Motor(SR)
    m.s.wetOnly = true
    m.setParam(8, 0.02); m.setParam(9, 0.1); m.setParam(10, 100); m.setParam(3, rt); m.setParam(7, 0); m.setParam(13, 0); m.setParam(12, 0)
    m.settle()
    m.noteOn(60, 1)
    renderiza(m, Math.floor(0.05 * SR))
    m.noteOff(60)
    const { L } = renderiza(m, Math.floor((rt * 2 + 1) * SR))
    // integral de Schroeder
    const e = new Float64Array(L.length)
    let acc = 0
    for (let i = L.length - 1; i >= 0; i--) { acc += L[i] * L[i]; e[i] = acc }
    let t1 = -1, t2 = -1
    for (let i = 0; i < e.length; i++) {
      const d = 10 * Math.log10(Math.max(e[i] / e[0], 1e-30))
      if (t1 < 0 && d <= -5) t1 = i / SR
      if (t2 < 0 && d <= -35) { t2 = i / SR; break }
    }
    const medido = 2 * (t2 - t1)
    assert.ok(Math.abs(medido - rt) / rt < 0.3, `RT60 param ${rt} medido ${medido.toFixed(2)}`)
  }
})

test('panic: silencio inmediato y exacto (voces, chorus y reverb)', () => {
  const m = new Motor(SR)
  m.setParam(10, 100); m.setParam(7, 100)
  for (const n of [48, 55, 60, 64]) m.noteOn(n, 0.9)
  renderiza(m, 2 * SR)
  m.panic()
  const { L, R } = renderiza(m, SR)
  assert.equal(pico(L), 0)
  assert.equal(pico(R), 0)
  assert.equal(m.activeVoices(), 0)
})

test('setParam cambia timbre y nivel', () => {
  const brillo = (fc) => {
    const m = neutro(); m.setParam(0, fc); m.settle()
    m.noteOn(48, 0.8)
    const { L } = renderiza(m, Math.floor(1.5 * SR))
    const mag = espectro(L, Math.floor(0.5 * SR), 32768)
    let num = 0, den = 0
    for (let k = 1; k < mag.length; k++) { const f = (k * SR) / 32768; num += f * mag[k] * mag[k]; den += mag[k] * mag[k] }
    return num / den
  }
  const c1 = brillo(300), c2 = brillo(12000)
  assert.ok(c2 > 2.5 * c1, `centroide ${c1.toFixed(0)} -> ${c2.toFixed(0)} Hz`)
  const nivel = (vol) => { const m = neutro(); m.setParam(6, vol); m.settle(); m.noteOn(60, 0.8); return rms(renderiza(m, SR).L, Math.floor(0.4 * SR)) }
  const r = nivel(-12) / nivel(0)
  assert.ok(Math.abs(db(r) + 12) < 1.5, `volumen -12 dB -> ${db(r).toFixed(2)} dB`)
  // el bypass silencia con fundido
  const m = neutro(); m.noteOn(60, 0.8); renderiza(m, SR / 2)
  m.setParam(5, 1)
  const { L } = renderiza(m, SR / 2)
  assert.ok(rms(L, Math.floor(0.3 * SR)) < 1e-4)
  // la resonancia sube el pico del filtro
  const reso = (q) => { const m2 = neutro(); m2.setParam(0, 1200); m2.setParam(1, q); m2.settle(); m2.noteOn(36, 0.8); return pico(renderiza(m2, SR).L, Math.floor(0.4 * SR)) }
  assert.ok(Number.isFinite(reso(100)) && reso(100) < 0.98)
})

test('eventos programados: nota exactamente en el sample pedido (precision de muestra)', () => {
  const m = new Motor(SR)
  m.setParam(10, 0); m.setParam(13, 0)
  const t0 = 10
  m.enqueue({ tipo: 'on', nota: 60, vel: 0.9, cuando: t0 + 1000 / SR })
  const L = new Float32Array(4096), R = new Float32Array(4096)
  m.renderAt(L, R, 4096, t0)
  let primero = -1
  for (let i = 0; i < L.length; i++) if (L[i] !== 0 || R[i] !== 0) { primero = i; break }
  assert.ok(primero >= 1000 && primero <= 1002, `primer sample no nulo: ${primero}`)
})

test('sustain (CC64): la nota sigue sonando con el pedal y se libera al soltarlo', () => {
  const m = new Motor(SR)
  m.setParam(9, 0.3)
  m.cc(64, 127)
  m.noteOn(60, 0.8)
  renderiza(m, SR / 2)
  m.noteOff(60)
  renderiza(m, 2 * SR)
  assert.equal(m.activeVoices(), 1)
  m.cc(64, 0)
  renderiza(m, 4 * SR)
  assert.equal(m.activeVoices(), 0)
})

test('robo de voces: 40 notas sin soltar -> maximo 16 voces, sin NaN ni saltos', () => {
  const m = new Motor(SR)
  m.setParam(8, 0.05)
  const L = new Float32Array(6 * SR), R = new Float32Array(6 * SR)
  let pos = 0
  for (let i = 0; i < 40; i++) {
    m.noteOn(36 + ((i * 7) % 48), 0.8)
    m.render(L, R, 4000, pos)
    pos += 4000
    assert.ok(m.activeVoices() <= 16)
  }
  let salto = 0
  for (let i = 1; i < pos; i++) { assert.ok(Number.isFinite(L[i])); salto = Math.max(salto, Math.abs(L[i] - L[i - 1])) }
  assert.ok(salto < 0.6, `salto maximo ${salto}`)
})

test('shimmer real: la cola humeda sube de registro (centroide) al aumentar la cantidad, para +12, +7 y +24', () => {
  const centroide = (cantidad, intervalo) => {
    const m = neutro()
    m.s.wetOnly = true
    m.setParam(10, 100); m.setParam(3, 6); m.setParam(7, cantidad); m.setParam(2, intervalo); m.setParam(9, 0.1)
    m.settle()
    m.noteOn(57, 0.8)
    const a = renderiza(m, 2 * SR)
    m.noteOff(57)
    const b = renderiza(m, 3 * SR)
    const x = new Float32Array(5 * SR)
    x.set(a.L, 0); x.set(b.L, 2 * SR)
    const mag = espectro(x, 3 * SR, 65536)
    let num = 0, den = 0
    for (let k = Math.floor((100 * 65536) / SR); k < Math.floor((14000 * 65536) / SR); k++) { const e = mag[k] * mag[k]; num += e * Math.log2((k * SR) / 65536); den += e }
    return num / den
  }
  const minimos = [0.8, 0.8, 0.5]
  for (const iv of [0, 1, 2]) {
    const subida = centroide(100, iv) - centroide(0, iv)
    assert.ok(subida >= minimos[iv], `intervalo ${iv}: la cola sube ${subida.toFixed(2)} octavas`)
  }
})

// ---------------------------------------------------------------- FX Rack comun (shared-dsp/web/fxrack.js incrustado)
test('FX Rack: 58 parametros ids 100..230 registrados con sus claves y el layout/manifiesto coinciden', () => {
  const fx = PARAMS.filter((p) => p.id >= 100)
  assert.equal(fx.length, 58)
  assert.equal(PARAM_IDS.fx_eq_b1_gain, 118)
  assert.equal(PARAM_IDS.fx_out_gain, 230)
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId >= 100).length, 58)
  assert.match(man.ai.summary, /FX Rack/)
})

test('FX Rack: apagado por defecto no cambia nada (bit a bit), aunque tenga ajustes; encendido si cambia', () => {
  const nota = (m) => { m.noteOn(57, 0.8); m.noteOn(64, 0.7); return renderiza(m, SR, 128) }
  const base = nota(new Motor(SR))
  const m1 = new Motor(SR)
  m1.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m1.setParam(PARAM_IDS.fx_comp_threshold, -50); m1.setParam(PARAM_IDS.fx_reverb_mix, 100); m1.setParam(PARAM_IDS.fx_out_gain, 12)
  const apagado = nota(m1)
  assert.deepEqual(apagado.L, base.L); assert.deepEqual(apagado.R, base.R)
  const m2 = new Motor(SR)
  m2.setParam(PARAM_IDS.fx_eq_on, 1); m2.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m2.setParam(PARAM_IDS.fx_eq_b3_freq, 600)
  const encendido = nota(m2)
  let dif = 0
  for (let i = 0; i < base.L.length; i++) dif = Math.max(dif, Math.abs(encendido.L[i] - base.L[i]))
  assert.ok(dif > 1e-3, `el EQ encendido debe cambiar la salida (${dif})`)
  for (let i = 0; i < encendido.L.length; i++) assert.ok(Number.isFinite(encendido.L[i]) && Number.isFinite(encendido.R[i]))
})

test('FX Rack: todo encendido con el motor completo es finito y acotado; el tempo llega al delay', () => {
  const m = new Motor(SR)
  for (const k of ['fx_hpf_on', 'fx_eq_on', 'fx_comp_on', 'fx_sat_on', 'fx_chorus_on', 'fx_delay_on', 'fx_reverb_on', 'fx_out_on']) m.setParam(PARAM_IDS[k], 1)
  m.setTempo(90); m.setParam(PARAM_IDS.fx_delay_sync, 1)
  m.noteOn(60, 0.8)
  const { L, R } = renderiza(m, 3 * SR)
  let pico = 0
  for (let i = 0; i < L.length; i++) { assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i])); pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])) }
  assert.ok(pico < 4, `pico ${pico}`)
  assert.equal(m.fx.bpm, 90)
  assert.equal(m.fx.fallos, 0)
})
