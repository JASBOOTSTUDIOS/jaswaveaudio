// Pruebas del motor web del Electric Bass:  node --test plugins/com.jaswave.plugin.electric-bass/web
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const { Motor, PARAMS, PARAM_IDS } = createRequire(import.meta.url)('./electric-bass-worklet.js')

const SR = 48000
const P = { tone: 0, attack: 1, drive: 2, lowBoost: 3, comp: 4, bypass: 5, volume: 6, pickup: 7, pluck: 8, sustain: 9, mute: 10, legato: 11, glide: 12, bend: 13 }
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12)
const cents = (f, ref) => 1200 * Math.log2(f / ref)

/** Autocorrelación normalizada con interpolación parabólica (NSDF, estilo McLeod/YIN). */
function f0Auto(x, start, len, sr, expected) {
  const lagMin = Math.floor(sr / (expected * 1.12)), lagMax = Math.ceil(sr / (expected / 1.12))
  const r = new Float64Array(lagMax + 2)
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let num = 0, e0 = 0, e1 = 0
    for (let i = 0; i < len; i++) {
      const a = x[start + i], b = x[start + i + lag]
      num += a * b; e0 += a * a; e1 += b * b
    }
    r[lag] = num / Math.sqrt(e0 * e1 + 1e-30)
  }
  let best = lagMin
  for (let lag = lagMin; lag <= lagMax; lag++) if (r[lag] > r[best]) best = lag
  const a = r[best - 1], b = r[best], c = r[best + 1]
  const d = 0.5 * (a - c) / (a - 2 * b + c)
  return sr / (best + d)
}

function render(m, n, off = 0, out = null) {
  const L = out || new Float32Array(n), R = new Float32Array(n)
  m.render(L, R, n, off)
  return L
}
function rms(x, a = 0, b = x.length) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)) }
function peak(x) { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p }
function finite(x) { for (const v of x) if (!Number.isFinite(v)) return false; return true }
function noteRender(note, vel, secs, setup, sr = SR) {
  const m = new Motor(sr)
  if (setup) setup(m)
  m.noteOn(note, vel)
  return render(m, Math.floor(secs * sr))
}
/** Energía de altas frecuencias: segunda diferencia (paso alto de 12 dB/oct), sin FFT. */
function hfEnergy(x, a, b) {
  let s = 0
  for (let i = a + 2; i < b; i++) { const d = x[i] - 2 * x[i - 1] + x[i - 2]; s += d * d }
  return Math.sqrt(s / (b - a))
}

test('afinación: error < 15 cents de E1 a G4 (48 kHz)', () => {
  let worst = 0
  for (const note of [28, 31, 33, 36, 40, 43, 45, 50, 52, 57, 60, 64, 67]) {
    const x = noteRender(note, 0.8, 1.5)
    const f = f0Auto(x, Math.floor(0.2 * SR), 16384, SR, hz(note))
    const c = Math.abs(cents(f, hz(note)))
    worst = Math.max(worst, c)
    assert.ok(c < 15, `nota ${note}: ${f.toFixed(3)} Hz, error ${c.toFixed(2)} cents`)
  }
  assert.ok(worst < 5, `error máximo ${worst.toFixed(2)} cents`)
})

test('afinación a otras frecuencias de muestreo (44.1, 96 y 192 kHz)', () => {
  for (const sr of [44100, 96000, 192000]) {
    for (const note of [28, 45, 64]) {
      const x = noteRender(note, 0.8, 1.2, null, sr)
      const f = f0Auto(x, Math.floor(0.2 * sr), 16384, sr, hz(note))
      assert.ok(Math.abs(cents(f, hz(note))) < 15, `${sr} Hz nota ${note}: ${f.toFixed(3)} Hz`)
    }
  }
})

test('sin NaN/inf, pico < 0.98 y RMS razonable en todo el rango y velocidades', () => {
  for (const note of [24, 28, 40, 55, 67, 84]) {
    for (const vel of [0.05, 0.3, 0.8, 1]) {
      const x = noteRender(note, vel, 1.0)
      assert.ok(finite(x), `NaN nota ${note} vel ${vel}`)
      assert.ok(peak(x) < 0.98, `pico ${peak(x)} nota ${note} vel ${vel}`)
    }
  }
  const x = noteRender(40, 0.8, 1.0)
  const r = rms(x, 0, 24000)
  assert.ok(r > 0.02 && r < 0.4, `RMS ${r}`)
})

test('el timbre cambia con la velocidad (no solo el volumen)', () => {
  const soft = noteRender(33, 0.3, 0.5), hard = noteRender(33, 1.0, 0.5)
  const ratioSoft = hfEnergy(soft, 0, 24000) / rms(soft, 0, 24000)
  const ratioHard = hfEnergy(hard, 0, 24000) / rms(hard, 0, 24000)
  assert.ok(ratioHard > ratioSoft * 1.1, `brillo relativo ${ratioSoft.toFixed(4)} -> ${ratioHard.toFixed(4)}`)
})

test('decaimiento: la nota se apaga y el sustain lo alarga', () => {
  const x = noteRender(40, 0.8, 3.0)
  assert.ok(rms(x, 72000, 76000) < rms(x, 4800, 8800) * 0.4, 'no decae')
  const largo = noteRender(40, 0.8, 3.0, (m) => m.setParam(P.sustain, 100))
  const corto = noteRender(40, 0.8, 3.0, (m) => m.setParam(P.sustain, 0))
  assert.ok(rms(largo, 72000, 76000) > rms(corto, 72000, 76000) * 2, 'sustain sin efecto')
})

test('note-off: apagado de cuerda gradual (no corta de golpe) y se extingue', () => {
  const m = new Motor(SR)
  m.noteOn(40, 0.8)
  const a = render(m, 48000)
  m.noteOff(40)
  const b = render(m, 24000)
  const antes = rms(a, 45600, 48000), t50 = rms(b, 2400, 4800), t500 = rms(b, 20000, 24000)
  assert.ok(t50 < antes && t50 > antes * 0.01, `fundido ${antes} -> ${t50}`)
  assert.ok(t500 < antes * 0.02, `cola ${t500}`)
  let maxStep = 0
  for (let i = 1; i < b.length; i++) maxStep = Math.max(maxStep, Math.abs(b[i] - b[i - 1]))
  assert.ok(maxStep < 0.05, `salto ${maxStep}`)
})

test('panic: silencio tras el fundido', () => {
  const m = new Motor(SR)
  m.noteOn(40, 0.9); m.noteOn(47, 0.9); m.noteOn(52, 0.9)
  render(m, 12000)
  m.panic()
  const fade = render(m, 9600)   // 5 ms de fundido + cola de los filtros de la cadena
  const tras = render(m, 4096)
  assert.ok(peak(tras) < 1e-5, `pico tras panic ${peak(tras)}`)
  let maxStep = 0
  for (let i = 1; i < fade.length; i++) maxStep = Math.max(maxStep, Math.abs(fade[i] - fade[i - 1]))
  assert.ok(maxStep < 0.1, `clic en el fundido ${maxStep}`)
  assert.equal(m.activeVoices(), 0)
})

test('setParam cambia nivel y timbre', () => {
  const base = noteRender(40, 0.8, 0.6, (m) => m.setParam(P.comp, 0))
  const quiet = noteRender(40, 0.8, 0.6, (m) => { m.setParam(P.comp, 0); m.setParam(P.volume, -12) })
  const ratio = rms(quiet, 4800, 24000) / rms(base, 4800, 24000)
  assert.ok(Math.abs(20 * Math.log10(ratio) + 12) < 1, `volumen ${20 * Math.log10(ratio)} dB`)
  // tone (tilt + filtro): 0 es más oscuro que 100
  const dark = noteRender(40, 0.8, 0.6, (m) => m.setParam(P.tone, 0)), bright = noteRender(40, 0.8, 0.6, (m) => m.setParam(P.tone, 100))
  assert.ok(hfEnergy(bright, 4800, 24000) / rms(bright, 4800, 24000) > 1.5 * hfEnergy(dark, 4800, 24000) / rms(dark, 4800, 24000), 'tone sin efecto')
  // ataque de dedo: más transitorio
  const sinAtk = noteRender(33, 0.8, 0.3, (m) => m.setParam(P.attack, 0)), conAtk = noteRender(33, 0.8, 0.3, (m) => m.setParam(P.attack, 100))
  assert.ok(hfEnergy(conAtk, 0, 2800) > hfEnergy(sinAtk, 0, 2800), 'finger_attack sin efecto')
  // palm mute acorta
  const normal = noteRender(40, 0.8, 1.5), muted = noteRender(40, 0.8, 1.5, (m) => m.setParam(P.mute, 80))
  assert.ok(rms(muted, 36000, 40000) < rms(normal, 36000, 40000) * 0.1, 'palm mute sin efecto')
  // pastilla P/J cambia el espectro
  const pj0 = noteRender(45, 0.8, 0.5, (m) => m.setParam(P.pickup, 0)), pj1 = noteRender(45, 0.8, 0.5, (m) => m.setParam(P.pickup, 100))
  let diff = 0
  for (let i = 2400; i < 12000; i++) diff += Math.abs(pj0[i] - pj1[i])
  assert.ok(diff > 1, 'pickup sin efecto')
  // bypass silencia con fundido
  const byp = noteRender(40, 0.8, 0.6, (m) => m.setParam(P.bypass, 1))
  assert.ok(peak(byp.subarray(12000)) < 1e-6, 'bypass no silencia')
})

test('low_boost es un shelving real: sube graves sin tocar los medios', () => {
  const lo = (b) => noteRender(28, 0.3, 1.0, (m) => { m.setParam(P.comp, 0); m.setParam(P.drive, 0); m.setParam(P.lowBoost, b) })
  const a = lo(0), b = lo(12)
  const dr = 20 * Math.log10(rms(b, 4800, 40000) / rms(a, 4800, 40000))
  assert.ok(dr > 6 && dr < 13, `realce de graves ${dr.toFixed(2)} dB`)
  const hfA = hfEnergy(a, 0, 20000), hfB = hfEnergy(b, 0, 20000)
  assert.ok(Math.abs(20 * Math.log10(hfB / hfA)) < 3, 'el shelving altera las altas')
})

test('el compresor paralelo reduce el rango dinámico entre notas fuerte y suave', () => {
  const run = (mix) => {
    const m = new Motor(SR)
    m.setParam(P.comp, mix); m.setParam(P.drive, 0)
    m.noteOn(38, 1.0)
    const a = render(m, 24000)
    m.noteOff(38)
    m.noteOn(38, 0.35)
    const b = render(m, 24000)
    return 20 * Math.log10(rms(a, 4800, 12000) / rms(b, 4800, 12000))
  }
  assert.ok(run(100) < run(0) - 3, 'compresión sin efecto')
})

test('legato: hammer-on cambia la altura de la misma cuerda sin nueva voz', () => {
  const m = new Motor(SR)
  m.noteOn(45, 0.8)
  const a = render(m, 24000)
  m.noteOn(50, 0.7)   // A2 sujeta -> D3: hammer-on
  assert.equal(m.activeVoices(), 1)
  const b = render(m, 48000)
  const fa = f0Auto(a, 8000, 12000, SR, hz(45)), fb = f0Auto(b, 12000, 16384, SR, hz(50))
  assert.ok(Math.abs(cents(fa, hz(45))) < 15, `antes ${fa}`)
  assert.ok(Math.abs(cents(fb, hz(50))) < 15, `después ${fb}`)
  // pull-off: soltar D3 con A2 sujeta vuelve a A2
  m.noteOff(50)
  const c = render(m, 48000)
  const fc = f0Auto(c, 12000, 16384, SR, hz(45))
  assert.ok(Math.abs(cents(fc, hz(45))) < 15, `pull-off ${fc}`)
})

test('pitch bend ±2 semitonos', () => {
  for (const st of [2, -2, 1]) {
    const m = new Motor(SR)
    m.noteOn(45, 0.8)
    render(m, 24000)
    m.pitchBend(st)
    render(m, 24000)
    const x = render(m, 32768)
    const f = f0Auto(x, 4000, 16384, SR, hz(45) * Math.pow(2, st / 12))
    assert.ok(Math.abs(cents(f, hz(45) * Math.pow(2, st / 12))) < 15, `bend ${st}: ${f}`)
  }
  const m = new Motor(SR)
  m.noteOn(45, 0.8)
  render(m, 12000)
  m.cc(129, 16383)   // rueda al máximo ≈ +2 st
  render(m, 24000)
  const x = render(m, 32768)
  const f = f0Auto(x, 4000, 16384, SR, hz(45) * Math.pow(2, 2 / 12))
  assert.ok(Math.abs(cents(f, hz(45) * Math.pow(2, 2 / 12))) < 15, `cc129 ${f}`)
})

test('polifonía de 6 voces con robo de la más antigua sin NaN ni clics', () => {
  const m = new Motor(SR)
  let maxStep = 0, prev = 0
  for (let k = 0; k < 14; k++) {
    m.noteOn(28 + k * 3, 0.9)
    const x = render(m, 4800)
    assert.ok(finite(x))
    assert.ok(peak(x) < 0.98)
    for (let i = 0; i < x.length; i++) { maxStep = Math.max(maxStep, Math.abs(x[i] - prev)); prev = x[i] }
  }
  assert.ok(m.activeVoices() <= 6)
  assert.ok(maxStep < 0.5, `salto máx ${maxStep}`)
})

test('el resultado no depende del tamaño de bloque ni de los offsets de render', () => {
  const sc = (block) => {
    const m = new Motor(SR)
    const out = new Float32Array(24000), R = new Float32Array(24000)
    m.noteOn(40, 0.8)
    for (let p = 0; p < out.length; p += block) { const n = Math.min(block, out.length - p); m.render(out, R, n, p) }
    return out
  }
  const a = sc(128), b = sc(1), c = sc(4096)
  for (let i = 0; i < a.length; i += 97) { assert.equal(a[i], b[i]); assert.equal(a[i], c[i]) }
})

// ---------------------------------------------------------------- FX Rack comun (shared-dsp/web/fxrack.js incrustado)
/** Hash FNV-1a del canal L de una frase determinista (hash de referencia tomado ANTES de integrar el rack). */
function hashFrase(m, sr, blk) {
  const N = Math.floor(6 * sr), L = new Float32Array(N), R = new Float32Array(N)
  const ev = [[0, 38, 0.85], [0.5, 38, 0.11], [1, 50, 0.85], [1.5, 45, 0.7], [2, 40, 0.7], [2.4, 41, 0.7], [2.6, 43, 0.7], [3, 33, 0.85], [3, 45, 0.45], [4, 28, 0.85]]
  let ei = 0
  for (let pos = 0; pos < N; pos += blk) {
    const n = Math.min(blk, N - pos)
    while (ei < ev.length && ev[ei][0] * sr <= pos) { m.noteOn(ev[ei][1], ev[ei][2]); ei++ }
    m.render(L, R, n, pos)
  }
  const dv = new DataView(L.buffer)
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < N; i++) h = ((h ^ BigInt(dv.getUint32(i * 4, true))) * 0x100000001b3n) & 0xffffffffffffffffn
  return { hash: h.toString(16), L, R }
}

test('FX Rack: 58 parametros ids 100..230 registrados y el manifiesto los incluye (ids propios < 100 intactos)', () => {
  const fx = PARAMS.filter((p) => p.id >= 100)
  assert.equal(fx.length, 58)
  assert.equal(PARAM_IDS.fx_eq_b1_gain, 118)
  assert.equal(PARAM_IDS.fx_out_gain, 230)
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId >= 100).length, 58)
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId < 100).length, 20)
  assert.match(man.ai.summary, /FX Rack/)
})

test('FX Rack: apagado = identico al motor previo (hash de referencia), aunque tenga ajustes; encendido si cambia', () => {
  const REF = { 'ff80a00b8ecd80c2': [48000, 128], '2b8b9f89338a79a1': [44100, 128], '8f3539bf163a8506': [48000, 480] }
  for (const [ref, [sr, blk]] of Object.entries(REF)) assert.equal(hashFrase(new Motor(sr), sr, blk).hash, ref, `${sr} Hz bloque ${blk}`)
  const m1 = new Motor(SR)
  m1.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m1.setParam(PARAM_IDS.fx_comp_threshold, -50); m1.setParam(PARAM_IDS.fx_reverb_mix, 100); m1.setParam(PARAM_IDS.fx_out_gain, 12)
  assert.equal(hashFrase(m1, SR, 128).hash, 'ff80a00b8ecd80c2')
  const m2 = new Motor(SR)
  m2.setParam(PARAM_IDS.fx_eq_on, 1); m2.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m2.setParam(PARAM_IDS.fx_eq_b3_freq, 600)
  const enc = hashFrase(m2, SR, 128)
  assert.notEqual(enc.hash, 'ff80a00b8ecd80c2')
  for (let i = 0; i < enc.L.length; i++) assert.ok(Number.isFinite(enc.L[i]) && Number.isFinite(enc.R[i]))
})

test('FX Rack: los parametros propios del bajo no chocan con el rack (setParam < 100 sigue en su tabla)', () => {
  const a = new Motor(SR), b = new Motor(SR)
  b.setParam(P.tone, 90)
  assert.notEqual(hashFrase(a, SR, 128).hash, hashFrase(b, SR, 128).hash)
})

test('FX Rack: todo encendido con el motor completo es finito y acotado; el tempo llega al delay', () => {
  const m = new Motor(SR)
  for (const k of ['fx_hpf_on', 'fx_eq_on', 'fx_comp_on', 'fx_sat_on', 'fx_chorus_on', 'fx_delay_on', 'fx_reverb_on', 'fx_out_on']) m.setParam(PARAM_IDS[k], 1)
  m.setTempo(90); m.setParam(PARAM_IDS.fx_delay_sync, 1)
  m.noteOn(40, 0.8)
  const L = new Float32Array(3 * SR), R = new Float32Array(3 * SR)
  for (let pos = 0; pos < L.length; pos += 128) m.render(L, R, 128, pos)
  let pico = 0
  for (let i = 0; i < L.length; i++) { assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i])); pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])) }
  assert.ok(pico < 4, `pico ${pico}`)
  assert.equal(m.fx.bpm, 90)
  assert.equal(m.fx.fallos, 0)
})
