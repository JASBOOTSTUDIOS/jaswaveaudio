// Pruebas del FX Rack web. Ejecutar: node --test plugins/shared-dsp/web
// Mismos criterios que la prueba nativa (plugins/com.jaswave.plugin.shimmer-pad/test/render_test.cpp, seccion 7).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { paramsEstandar } from '../../scripts/fxrack-ids.mjs'

const require = createRequire(import.meta.url)
const { FxRack, FXR_BASE, FXR_OFF, FXR_PARAMS, fxDisenar, fxMagnitudDb, fxRespuestaDb, fxParamsPorDefecto } = require('./fxrack.js')

const SR = 48000
const ID = (off) => FXR_BASE + off
const sine = (n, f, amp, sr = SR) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr); return x }
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)) }
const peak = (x, a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m }
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12))
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s / 4294967296) * 2 - 1 } }
function conf(fx, valores) { for (const [off, v] of Object.entries(valores)) assert.ok(fx.setParam(ID(Number(off)), v), `id ${off}`) }
function procesa(fx, L, R, bloque = 480) { for (let i = 0; i < L.length; i += bloque) fx.process(L, R, Math.min(bloque, L.length - i), i) }
function ganancia(valores, f, sr = SR, dur = 0.5, tempo = 120) {
  const fx = new FxRack(sr); fx.setTempo(tempo)
  conf(fx, valores)
  const n = Math.floor(dur * sr), a = sine(n, f, 0.1, sr), b = Float32Array.from(a), ref = Float32Array.from(a)
  procesa(fx, a, b)
  return db(rms(a, n >> 1, n) / rms(ref, n >> 1, n))
}
const O = FXR_OFF
const eqOn = { [O.EqOn]: 1 }

test('tabla: 58 parametros con los ids, nombres, rangos y defaults estandar (identicos a fxrack-ids.mjs y al C++)', () => {
  const std = paramsEstandar()
  assert.equal(FXR_PARAMS.length, 58)
  assert.equal(std.length, 58)
  for (const e of std) {
    const w = FXR_PARAMS.find((q) => q.id === FXR_BASE + e.off)
    assert.ok(w, `falta ${e.nombre}`)
    assert.equal(w.nombre, e.nombre)
    assert.equal(w.min, e.min, e.nombre); assert.equal(w.max, e.max, e.nombre); assert.equal(w.def, e.defecto, e.nombre)
    assert.equal(w.escala, e.escala === 'toggle' ? 'stepped' : e.escala, e.nombre)
  }
  const d = fxParamsPorDefecto()
  assert.ok(!(d.hpfOn || d.lpfOn || d.eqOn || d.compOn || d.satOn || d.chOn || d.dlOn || d.rvOn || d.outOn), 'todo debe estar apagado')
})

test('neutral: rack apagado (aunque tenga valores extremos) deja el buffer intacto bit a bit', () => {
  const fx = new FxRack(SR)
  conf(fx, { [O.EqBand0 + 1]: 18, [O.CompThresh]: -60, [O.SatDrive]: 100, [O.RvMix]: 100, [O.OutWidth]: 200, [O.OutGain]: 12 })
  const r = rng(5), n = 9600
  const a = Float32Array.from({ length: n }, () => r() * 0.5), b = Float32Array.from(a), a0 = Float32Array.from(a)
  procesa(fx, a, b)
  assert.deepEqual(a, a0); assert.deepEqual(b, a0)
  assert.equal(fx.activo(), false)
})

test('EQ: ganancia medida de cada banda (+-9 dB) a su frecuencia dentro de 0.5 dB; shelves en su plateau', () => {
  let peor = 0
  for (let b = 0; b < 6; b++) {
    for (const g of [-9, 9]) {
      const fDef = FXR_PARAMS.find((q) => q.id === ID(O.EqBand0 + 3 * b)).def
      const meas = ganancia({ ...eqOn, [O.EqBand0 + 3 * b + 1]: g }, fDef)
      const shelf = b === 0 || b === 5
      const q = FXR_PARAMS.find((x) => x.id === ID(O.EqBand0 + 3 * b + 2)).def
      const ana = fxMagnitudDb(fxDisenar(b === 0 ? 'lowShelf' : b === 5 ? 'highShelf' : 'bell', SR, fDef, g, q), fDef, SR)
      const objetivo = shelf ? ana : g
      peor = Math.max(peor, Math.abs(meas - objetivo))
      assert.ok(Math.abs(meas - objetivo) < 0.5, `banda ${b + 1} ${g} dB: ${meas}`)
    }
  }
  assert.ok(peor < 0.5)
  assert.ok(Math.abs(ganancia({ ...eqOn, [O.EqBand0 + 1]: 6 }, 20) - 6) < 1, 'plateau low shelf')
  assert.ok(Math.abs(ganancia({ ...eqOn, [O.EqBand0 + 16]: -6 }, 20000) + 6) < 1.5, 'plateau high shelf')
})

test('EQ: Q coherente (ancho entre puntos de media ganancia ~ f0/Q)', () => {
  for (const Q of [0.7, 2, 6]) {
    const v = { ...eqOn, [O.EqBand0 + 3 * 2]: 1000, [O.EqBand0 + 3 * 2 + 1]: 12, [O.EqBand0 + 3 * 2 + 2]: Q }
    const medio = (arriba) => {
      let lo = arriba ? 1000 : 100, hi = arriba ? 10000 : 1000
      for (let i = 0; i < 16; i++) { const m = Math.sqrt(lo * hi); const g = ganancia(v, m, SR, 0.4); if (arriba ? g > 6 : g <= 6) { if (arriba) lo = m; else lo = m } else { if (arriba) hi = m; else hi = m } }
      return Math.sqrt(lo * hi)
    }
    const fu = medio(true), fd = medio(false)
    const qm = 1000 / (fu - fd)
    assert.ok(Math.abs(qm / Q - 1) < 0.25, `Q=${Q}: medido ${qm}`)
  }
})

test('filtros HPF / LPF 12 y 24 dB/oct', () => {
  const g12 = ganancia({ [O.HpfOn]: 1, [O.HpfFreq]: 1000, [O.HpfSlope]: 0 }, 500), c12 = ganancia({ [O.HpfOn]: 1, [O.HpfFreq]: 1000, [O.HpfSlope]: 0 }, 1000)
  const g24 = ganancia({ [O.HpfOn]: 1, [O.HpfFreq]: 1000, [O.HpfSlope]: 1 }, 500)
  const l24 = ganancia({ [O.LpfOn]: 1, [O.LpfFreq]: 4000, [O.LpfSlope]: 1 }, 4000)
  assert.ok(Math.abs(c12 + 3) < 0.5 && Math.abs(g12 + 12.3) < 1)
  assert.ok(Math.abs(g24 + 24.1) < 1.5)
  assert.ok(Math.abs(l24 + 3) < 0.5)
})

test('EQ con todas las bandas a 0 dB (EQ On) es transparente', () => {
  const fx = new FxRack(SR); conf(fx, eqOn)
  const a = sine(4800, 440, 0.3), b = Float32Array.from(a), a0 = Float32Array.from(a)
  procesa(fx, a, b)
  assert.deepEqual(a, a0)
})

test('compresor: reduccion medida segun umbral / ratio / makeup / mezcla', () => {
  const nivel = (v, ampDb) => {
    const fx = new FxRack(SR); conf(fx, { [O.CompOn]: 1, [O.CompKnee]: 0, [O.CompAttack]: 0.5, [O.CompRelease]: 500, ...v })
    const n = 2 * SR, a = sine(n, 1000, Math.pow(10, ampDb / 20)), b = Float32Array.from(a)
    procesa(fx, a, b, 256)
    return { out: db(peak(a, (n * 3) >> 2, n)), gr: fx.grDb }
  }
  const base = { [O.CompThresh]: -20, [O.CompRatio]: 4 }
  const r1 = nivel(base, -8)
  assert.ok(Math.abs(r1.out + 17) < 0.8, `salida ${r1.out}`)
  assert.ok(Math.abs(r1.gr - 9) < 1, `GR ${r1.gr}`)
  assert.ok(Math.abs(nivel({ ...base, [O.CompRatio]: 10 }, -8).out + 18.8) < 0.8)
  assert.ok(Math.abs(nivel({ ...base, [O.CompThresh]: -10 }, -8).out + 9.5) < 0.6)
  assert.ok(Math.abs(nivel(base, -30).out + 30) < 0.2, 'bajo el umbral intacto')
  assert.ok(Math.abs(nivel({ ...base, [O.CompMakeup]: 6 }, -8).out - (r1.out + 6)) < 0.5)
  assert.ok(Math.abs(nivel({ ...base, [O.CompMix]: 0 }, -8).out + 8) < 0.05)
  const esperado50 = db(0.5 + 0.5 * Math.pow(10, -9 / 20)) - 8
  assert.ok(Math.abs(nivel({ ...base, [O.CompMix]: 50 }, -8).out - esperado50) < 0.8)
})

test('saturacion: THD creciente con el drive; cinta = impares, valvula = pares', () => {
  const N = 1 << 15, bin = 683, f0 = (bin * SR) / N
  function fftMag(x) {
    const re = Float64Array.from(x, (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / x.length))), im = new Float64Array(x.length)
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]] } }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
      for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = i + k + len / 2; const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t } }
    }
    return (k) => { let m = 0; for (let j = -2; j <= 2; j++) m = Math.max(m, Math.hypot(re[k + j], im[k + j])); return m }
  }
  const medir = (tipo, drive) => {
    const fx = new FxRack(SR); conf(fx, { [O.SatOn]: 1, [O.SatType]: tipo, [O.SatDrive]: drive, [O.SatTone]: 20000 })
    const a = sine(N, f0, 0.25), b = Float32Array.from(a)
    procesa(fx, a, b, 512)
    const m = fftMag(a), fund = m(bin)
    let t = 0
    for (let h = 2; h <= 9; h++) t += m(bin * h) ** 2
    return { thd: Math.sqrt(t) / fund, h2: m(bin * 2) / fund, h3: m(bin * 3) / fund }
  }
  let prev = -1
  for (const d of [10, 30, 50, 70, 100]) { const t = medir(0, d).thd; assert.ok(t > prev, `THD ${t} no crece a ${d}`); prev = t }
  const tape = medir(0, 60), tube = medir(1, 60)
  assert.ok(tape.h3 > 10 * tape.h2, 'cinta simetrica')
  assert.ok(tube.h2 > 0.01 && tube.h2 > 3 * tape.h2, 'valvula asimetrica')
  assert.ok(medir(0, 0).thd < 0.01)
})

test('delay: tiempo libre, sincronia al tempo, feedback y ping-pong', () => {
  const ecos = (v, bpm, N = 2 * SR) => {
    const fx = new FxRack(SR); fx.setTempo(bpm); conf(fx, { [O.DlOn]: 1, [O.DlMix]: 100, [O.DlTone]: 16000, ...v })
    const L = new Float32Array(N), R = new Float32Array(N); L[100] = 1
    procesa(fx, L, R, 256)
    return { L, R }
  }
  const pico = (x, desde) => { let bi = desde; for (let i = desde; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[bi])) bi = i; return bi }
  let { L } = ecos({ [O.DlTime]: 300, [O.DlFeedback]: 50 }, 120)
  const e1 = pico(L, 1000)
  assert.ok(Math.abs(e1 - 100 - 14400) <= 2, `eco 1 en ${e1}`)
  const e2 = pico(L, e1 + 2000)
  assert.ok(Math.abs(e2 - e1 - 14400) <= 3)
  const razon = Math.abs(L[e2]) / Math.abs(L[e1])
  assert.ok(razon > 0.35 && razon < 0.55, `feedback ${razon}`)
  const sync = [[1, 500], [2, 250], [3, 375], [4, 125]]
  for (const [s, ms] of sync) { ;({ L } = ecos({ [O.DlSync]: s, [O.DlFeedback]: 0 }, 120, Math.floor(1.5 * SR))); assert.ok(Math.abs((pico(L, 1000) - 100) / SR * 1000 - ms) < 0.1, `sync ${s}`) }
  ;({ L } = ecos({ [O.DlSync]: 1, [O.DlFeedback]: 0 }, 90, Math.floor(1.5 * SR)))
  assert.ok(Math.abs((pico(L, 1000) - 100) / SR * 1000 - 666.667) < 0.1)
  const pp = ecos({ [O.DlPingPong]: 1, [O.DlTime]: 300, [O.DlFeedback]: 60 }, 120)
  const t1 = 100 + 14400, t2 = 100 + 28800
  assert.ok(Math.abs(pp.L[t1]) > 0.2 && Math.abs(pp.R[t1]) < 1e-4 && Math.abs(pp.R[t2]) > 0.05 && Math.abs(pp.L[t2]) < 1e-4)
  const m0 = ecos({ [O.DlTime]: 300, [O.DlMix]: 0 }, 120, 4800)
  assert.equal(m0.L[100], 1); assert.equal(m0.L[2000], 0)
})

test('reverb: RT60 crece con el tamano y ordena room < plate < hall; la cola se extingue', () => {
  const impulso = (tipo, size, damp) => {
    const fx = new FxRack(SR); conf(fx, { [O.RvOn]: 1, [O.RvType]: tipo, [O.RvSize]: size * 100, [O.RvDamping]: damp * 100, [O.RvMix]: 100, [O.RvPreDelay]: 0 })
    const N = 20 * SR, L = new Float32Array(N), R = new Float32Array(N); L[0] = R[0] = 1
    procesa(fx, L, R, 512)
    return Float64Array.from(L, (v, i) => 0.5 * (v + R[i]))
  }
  const rt60 = (h) => {
    const e = new Float64Array(h.length); let acc = 0
    for (let i = h.length - 1; i >= 0; i--) { acc += h[i] * h[i]; e[i] = acc }
    let t5 = -1, t25 = -1
    for (let i = 0; i < e.length; i++) { const d = 10 * Math.log10(e[i] / e[0] + 1e-30); if (t5 < 0 && d <= -5) t5 = i / SR; if (t25 < 0 && d <= -25) { t25 = i / SR; break } }
    return t5 > 0 && t25 > 0 ? 3 * (t25 - t5) : -1
  }
  const r = [0, 1, 2].map((t) => [rt60(impulso(t, 0.2, 0.3)), rt60(impulso(t, 0.8, 0.3))])
  for (const t of r) assert.ok(t[0] > 0 && t[1] > t[0] * 1.3, `RT60 ${t}`)
  assert.ok(r[2][1] < r[0][1] && r[0][1] < r[1][1], `orden ${r.map((x) => x[1])}`)
  const h = impulso(1, 1, 0)
  let cola = 0, cab = 0
  for (let i = 0; i < h.length; i++) { if (i < 5 * SR) cab += h[i] * h[i]; if (i > 15 * SR) cola += h[i] * h[i] }
  assert.ok(10 * Math.log10(cola / cab + 1e-30) < -40)
})

test('reverb estable: ruido continuo durante 60 s sin crecimiento', () => {
  const fx = new FxRack(SR); conf(fx, { [O.RvOn]: 1, [O.RvType]: 1, [O.RvSize]: 100, [O.RvDamping]: 0, [O.RvMix]: 100 })
  const r = rng(77), L = new Float32Array(512), R = new Float32Array(512)
  let e1 = 0, c1 = 0, e2 = 0, c2 = 0, mx = 0, fin = true
  for (let i = 0; i < 60 * SR; i += 512) {
    for (let k = 0; k < 512; k++) { L[k] = 0.1 * r(); R[k] = 0.1 * r() }
    fx.process(L, R, 512, 0)
    for (let k = 0; k < 512; k++) { if (!Number.isFinite(L[k]) || !Number.isFinite(R[k])) fin = false; mx = Math.max(mx, Math.abs(L[k])); const e = L[k] * L[k]; if (i > 10 * SR && i < 20 * SR) { e1 += e; c1++ } if (i > 50 * SR) { e2 += e; c2++ } }
  }
  const d = 10 * Math.log10(e2 / c2 / (e1 / c1))
  assert.ok(fin && Math.abs(d) < 1.5 && mx < 2, `d=${d} pico=${mx}`)
})

test('chorus modula y ensancha; mezcla 0 es transparente', () => {
  const fx = new FxRack(SR); conf(fx, { [O.ChOn]: 1, [O.ChDepth]: 100, [O.ChMix]: 100, [O.ChRate]: 1 })
  const N = 4 * SR, a = sine(N, 2000, 0.2), b = Float32Array.from(a)
  procesa(fx, a, b, 512)
  let mn = 1e9, mx = 0
  for (let i = N >> 2; i + 480 < N; i += 480) { const v = rms(a, i, i + 480); mn = Math.min(mn, v); mx = Math.max(mx, v) }
  assert.ok(db(mx / mn) > 0.5, `ondulacion ${db(mx / mn)}`)
  const r = rng(3), nl = Float32Array.from({ length: N }, () => 0.2 * r()), nr = Float32Array.from(nl)
  fx.reset(); procesa(fx, nl, nr, 512)
  let sl = 0, sr2 = 0, slr = 0
  for (let i = N >> 1; i < N; i++) { sl += nl[i] ** 2; sr2 += nr[i] ** 2; slr += nl[i] * nr[i] }
  assert.ok(slr / Math.sqrt(sl * sr2) < 0.95)
  const f2 = new FxRack(SR); conf(f2, { [O.ChOn]: 1, [O.ChMix]: 0 })
  const c = sine(4800, 1000, 0.3), d = Float32Array.from(c), c0 = Float32Array.from(c)
  procesa(f2, c, d, 512)
  let md = 0; for (let i = 0; i < c.length; i++) md = Math.max(md, Math.abs(c[i] - c0[i]))
  assert.ok(md < 1e-6)
})

test('anchura y ganancia de salida', () => {
  const fx = new FxRack(SR); conf(fx, { [O.OutOn]: 1, [O.OutWidth]: 0, [O.OutGain]: 6 })
  const r = rng(11), a = Float32Array.from({ length: 9600 }, () => 0.3 * r()), b = Float32Array.from({ length: 9600 }, () => 0.3 * r())
  const mid0 = Float32Array.from(a, (v, i) => 0.5 * (v + b[i]))
  procesa(fx, a, b, 480)
  for (let i = 4800; i < 9600; i++) { assert.ok(Math.abs(a[i] - b[i]) < 1e-5); assert.ok(Math.abs(a[i] - mid0[i] * 1.9953) < 1e-3) }
})

test('barrido de estabilidad: 44.1..192 kHz x bloques 1..4096 x parametros extremos automatizados, sin NaN', () => {
  let malas = 0
  for (const sr of [44100, 96000, 192000]) {
    for (const blk of [1, 7, 64, 480, 4096]) {
      const fx = new FxRack(sr); fx.setTempo(90)
      const r = rng(1000 + blk)
      const L = new Float32Array(blk), R = new Float32Array(blk)
      const N = sr * 1, tot = Math.min(N, blk === 1 ? sr / 4 : N)
      let paso = 0
      for (let done = 0; done < tot; done += blk, paso++) {
        const u = (paso % 7) / 6
        for (const off of [O.HpfOn, O.LpfOn, O.EqOn, O.CompOn, O.SatOn, O.ChOn, O.DlOn, O.RvOn, O.OutOn]) fx.setParam(ID(off), 1)
        fx.setParam(ID(O.HpfFreq), 20 + 900 * u); fx.setParam(ID(O.HpfSlope), paso & 1); fx.setParam(ID(O.LpfFreq), 20000 - 18000 * u); fx.setParam(ID(O.LpfSlope), (paso >> 1) & 1)
        for (let b = 0; b < 6; b++) { fx.setParam(ID(O.EqBand0 + 3 * b), (b === 0 ? 30 : 100) * Math.pow(100, (u + b * 0.17) % 1)); fx.setParam(ID(O.EqBand0 + 3 * b + 1), b & 1 ? 18 : -18); fx.setParam(ID(O.EqBand0 + 3 * b + 2), b === 0 || b === 5 ? 2 : u > 0.5 ? 10 : 0.1) }
        fx.setParam(ID(O.CompThresh), -60); fx.setParam(ID(O.CompRatio), 20); fx.setParam(ID(O.CompAttack), 0.1); fx.setParam(ID(O.CompRelease), 10); fx.setParam(ID(O.CompKnee), 24 * u); fx.setParam(ID(O.CompMakeup), 12)
        fx.setParam(ID(O.SatDrive), 100); fx.setParam(ID(O.SatType), paso & 1); fx.setParam(ID(O.ChDepth), 100); fx.setParam(ID(O.ChRate), 5)
        fx.setParam(ID(O.DlSync), paso % 5); fx.setParam(ID(O.DlTime), 20 + 1900 * u); fx.setParam(ID(O.DlFeedback), 90); fx.setParam(ID(O.DlPingPong), (paso & 2) >> 1); fx.setParam(ID(O.DlMix), 100)
        fx.setParam(ID(O.RvType), paso % 3); fx.setParam(ID(O.RvSize), 100 * u); fx.setParam(ID(O.RvDamping), 100 * (1 - u)); fx.setParam(ID(O.RvPreDelay), 200 * u); fx.setParam(ID(O.RvMix), 100)
        fx.setParam(ID(O.OutWidth), 200); fx.setParam(ID(O.OutGain), 12)
        for (let k = 0; k < blk; k++) { L[k] = 0.5 * r(); R[k] = 0.5 * r() }
        fx.process(L, R, blk, 0)
        for (let k = 0; k < blk; k++) if (!Number.isFinite(L[k]) || !Number.isFinite(R[k]) || Math.abs(L[k]) > 3000) malas++
      }
      malas += fx.fallos
    }
  }
  assert.equal(malas, 0)
})

test('sin clics al conectar / desconectar bloques en caliente', () => {
  const fx = new FxRack(SR)
  const n = SR, a = sine(n, 220, 0.5), b = Float32Array.from(a)
  for (let i = 0; i < n; i += 256) {
    if (i === 128 * 256) conf(fx, { [O.EqOn]: 1, [O.EqBand0 + 1]: 12, [O.CompOn]: 1, [O.CompThresh]: -30, [O.CompRatio]: 8 })
    if (i === 160 * 256) conf(fx, { [O.EqOn]: 0, [O.CompOn]: 0 })
    fx.process(a, b, Math.min(256, n - i), i)
  }
  let md = 0, last = 0
  for (let i = 0; i < n; i++) { md = Math.max(md, Math.abs(a[i] - last)); last = a[i] }
  assert.ok(md < ((2 * Math.PI * 220) / SR) * 0.5 * 4, `salto ${md}`)
})

test('CPU: rack completo a 48 kHz (informativo; limite holgado)', () => {
  const fx = new FxRack(SR)
  for (const off of [O.HpfOn, O.LpfOn, O.EqOn, O.CompOn, O.SatOn, O.ChOn, O.DlOn, O.RvOn, O.OutOn]) fx.setParam(ID(off), 1)
  fx.setParam(ID(O.CompThresh), -30); fx.setParam(ID(O.EqBand0 + 1), 4); fx.setParam(ID(O.EqBand0 + 7), -4)
  const r = rng(9), L = new Float32Array(128), R = new Float32Array(128)
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < 5 * SR; i += 128) { for (let k = 0; k < 128; k++) { L[k] = 0.2 * r(); R[k] = 0.2 * r() } fx.process(L, R, 128, 0) }
  const seg = Number(process.hrtime.bigint() - t0) / 1e9
  console.log(`  CPU rack web completo: ${((seg / 5) * 100).toFixed(1)} % de un nucleo (bloques de 128)`)
  assert.ok(seg / 5 < 0.5)
})

test('respuesta analitica: fxRespuestaDb coincide con el filtro real que corre en el hilo de audio', () => {
  const p = fxParamsPorDefecto(); p.eqOn = true
  p.eq[2] = { hz: 1500, gainDb: 8, q: 1.4 }; p.eq[0] = { hz: 120, gainDb: -5, q: 0.8 }
  for (const f of [100, 1500, 6000]) {
    const meas = ganancia({ ...eqOn, [O.EqBand0 + 6]: 1500, [O.EqBand0 + 7]: 8, [O.EqBand0 + 8]: 1.4, [O.EqBand0]: 120, [O.EqBand0 + 1]: -5, [O.EqBand0 + 2]: 0.8 }, f)
    assert.ok(Math.abs(meas - fxRespuestaDb(p, SR, f)) < 0.05, `${f} Hz: ${meas} vs ${fxRespuestaDb(p, SR, f)}`)
  }
})
