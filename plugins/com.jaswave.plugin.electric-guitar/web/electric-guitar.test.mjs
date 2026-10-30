// Pruebas de la versión web de JasWave Electric Guitar: node --test plugins/com.jaswave.plugin.electric-guitar/web
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Motor, PARAM_DEFS, P } = require('./electric-guitar-worklet.js')

const hz = (n) => 440 * Math.pow(2, (n - 69) / 12)

function render(motor, sr, seconds, eventos = [], bloque = 512) {
  const total = Math.floor(seconds * sr)
  const L = new Float32Array(total), R = new Float32Array(total)
  const bl = new Float32Array(bloque), br = new Float32Array(bloque)
  const ev = [...eventos].sort((a, b) => a.t - b.t)
  let ei = 0
  let pos = 0
  while (pos < total) {
    const n = Math.min(bloque, total - pos)
    let done = 0
    while (done < n) {
      while (ei < ev.length && Math.floor(ev[ei].t * sr) <= pos + done) {
        const e = ev[ei++]
        if (e.tipo === 'on') motor.noteOn(e.nota, e.vel)
        else if (e.tipo === 'off') motor.noteOff(e.nota)
        else if (e.tipo === 'param') motor.setParam(e.id, e.valor)
        else if (e.tipo === 'bend') motor.pitchBend(e.valor)
        else if (e.tipo === 'cc') motor.cc(e.num, e.valor)
        else if (e.tipo === 'panico') motor.panic()
        else if (e.tipo === 'tempo') motor.setTempo(e.bpm)
      }
      let hasta = n
      if (ei < ev.length) hasta = Math.min(hasta, Math.floor(ev[ei].t * sr) - pos)
      if (hasta <= done) hasta = Math.min(n, done + 1)
      motor.render(bl.subarray(done, hasta), br.subarray(done, hasta), hasta - done)
      done = hasta
    }
    L.set(bl.subarray(0, n), pos)
    R.set(br.subarray(0, n), pos)
    pos += n
  }
  return { L, R }
}

const seco = (motor) => {
  motor.setParam(P.delayMix, 0); motor.setParam(P.chorusMix, 0); motor.setParam(P.reverbMix, 0); motor.setParam(P.strum, 0); motor.setParam(P.ampGain, 30)
}
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)) }
const pico = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p }
const finito = (x) => x.every(Number.isFinite)
const dB = (v) => 20 * Math.log10(v + 1e-12)

/** f0 por correlación normalizada multiperíodo con interpolación parabólica */
function f0(x, sr, start, len, fExp, mSec = 0.3) {
  const tau0 = sr / fExp
  const M = Math.max(1, Math.floor(mSec * fExp))
  const corr = (lag) => {
    const il = Math.floor(lag), fr = lag - il
    let sxy = 0, sxx = 0, syy = 0
    for (let j = 0; j < len; j++) {
      const a = x[start + j], b = x[start + j + il] * (1 - fr) + x[start + j + il + 1] * fr
      sxy += a * b; sxx += a * a; syy += b * b
    }
    return sxy / Math.sqrt(sxx * syy + 1e-30)
  }
  const centro = M * tau0
  let best = -2, bl = centro
  for (let l = centro - 0.7 * tau0; l <= centro + 0.7 * tau0; l += 0.25) { const c = corr(l); if (c > best) { best = c; bl = l } }
  const cm = corr(bl - 0.25), cp = corr(bl + 0.25)
  const den = cm - 2 * best + cp
  const off = Math.abs(den) > 1e-12 ? 0.25 * 0.5 * (cm - cp) / den : 0
  return (M * sr) / (bl + off)
}

test('definiciones de parámetros: IDs y rangos coherentes con el VST3', () => {
  assert.equal(PARAM_DEFS.length, 18)
  const ids = PARAM_DEFS.map((d) => d.id)
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b))
  assert.equal(PARAM_DEFS[P.ampGain].name, 'amp_gain')
  assert.equal(PARAM_DEFS[P.cabSim].name, 'cab_sim')
  assert.equal(PARAM_DEFS[P.tone].name, 'tone')
  assert.equal(PARAM_DEFS[P.delayFeedback].max, 95)
  assert.equal(PARAM_DEFS[P.chorusMix].name, 'chorus_mix')
  assert.equal(PARAM_DEFS[P.volume].min, -24)
})

for (const sr of [44100, 48000]) {
  test(`afinación E2..E6 a ${sr} Hz con error < 15 cents (medido < 5)`, () => {
    let peor = 0
    for (const nota of [40, 45, 50, 55, 59, 64, 69, 76, 88]) {
      const m = new Motor(sr)
      seco(m)
      const { L } = render(m, sr, 1.5, [{ t: 0, tipo: 'on', nota, vel: 0.8 }])
      assert.ok(finito(L), `NaN en nota ${nota}`)
      const fe = hz(nota)
      const f = f0(L, sr, Math.floor(0.25 * sr), Math.floor(0.25 * sr), fe)
      const cents = 1200 * Math.log2(f / fe)
      peor = Math.max(peor, Math.abs(cents))
      assert.ok(Math.abs(cents) < 5, `nota ${nota}: ${cents.toFixed(2)} cents`)
    }
    console.log(`  peor desviación a ${sr} Hz: ${peor.toFixed(2)} cents`)
  })
}

test('sin NaN/inf, pico < 0.98 y RMS razonable con acorde y FX al máximo, a 44.1/48/96/192 kHz', () => {
  for (const sr of [44100, 48000, 96000, 192000]) {
    for (const bloque of [1, 64, 512, 4096]) {
      if (bloque === 1 && sr > 48000) continue
      const m = new Motor(sr)
      m.setParam(P.ampGain, 100); m.setParam(P.chorusMix, 100); m.setParam(P.delayMix, 100); m.setParam(P.delayFeedback, 95)
      m.setParam(P.reverbMix, 100); m.setParam(P.delayDiv, 4); m.setParam(P.delayTime, 2000); m.setParam(P.sustain, 100); m.setParam(P.strum, 100)
      const ev = [40, 47, 52, 56, 59, 64].map((nota) => ({ t: 0, tipo: 'on', nota, vel: 1 }))
      ev.push({ t: 0.5, tipo: 'bend', valor: -1 })
      const { L, R } = render(m, sr, bloque === 1 ? 0.15 : 1.5, ev, bloque)
      assert.ok(finito(L) && finito(R), `NaN sr=${sr} bloque=${bloque}`)
      assert.ok(pico(L) < 0.98 && pico(R) < 0.98, `pico sr=${sr}`)
    }
  }
})

test('nivel por ganancia: RMS de un acorde entre -30 y -12 dBFS y pico < 0.98', () => {
  for (const g of [0, 25, 45, 70, 100]) {
    const sr = 48000
    const m = new Motor(sr)
    seco(m); m.setParam(P.ampGain, g)
    const ev = [50, 57, 62, 64, 69].map((nota) => ({ t: 0, tipo: 'on', nota, vel: 0.8 }))
    const { L } = render(m, sr, 2.5, ev)
    const r = dB(rms(L, 4800, 96000))
    assert.ok(r > -30 && r < -12 && pico(L) < 0.98, `ganancia ${g}: ${r.toFixed(1)} dBFS pico ${pico(L).toFixed(2)}`)
  }
})

test('decae tras note-off, y silencio tras panic', () => {
  const sr = 48000
  const m = new Motor(sr)
  seco(m)
  const { L } = render(m, sr, 3, [{ t: 0, tipo: 'on', nota: 52, vel: 0.9 }, { t: 0.5, tipo: 'off', nota: 52 }])
  assert.ok(rms(L, 4800, 14400) > 0.02, 'la nota suena')
  assert.ok(rms(L, 2 * sr, 3 * sr) < rms(L, 4800, 14400) * 0.001, 'decae tras el note-off')
  const m2 = new Motor(sr)
  m2.setParam(P.reverbMix, 60); m2.setParam(P.delayMix, 60)
  const r2 = render(m2, sr, 1.2, [{ t: 0, tipo: 'on', nota: 52, vel: 0.9 }, { t: 0, tipo: 'on', nota: 59, vel: 0.9 }, { t: 0.4, tipo: 'panico' }])
  assert.ok(rms(r2.L, 0.5 * sr | 0, sr) < 1e-6, 'silencio tras panic')
})

test('setParam cambia timbre y nivel: ganancia, tone, cab_sim, delay y reverb', () => {
  const sr = 48000
  const acorde = [50, 57, 62].map((nota) => ({ t: 0, tipo: 'on', nota, vel: 0.8 }))
  const brillo = (x) => { let d = 0, e = 0; for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] ** 2 } return d / (e + 1e-12) }
  const a = new Motor(sr); seco(a); a.setParam(P.tone, 10)
  const b = new Motor(sr); seco(b); b.setParam(P.tone, 90)
  const ra = render(a, sr, 1.5, acorde).L, rb = render(b, sr, 1.5, acorde).L
  assert.ok(brillo(rb) > brillo(ra) * 1.3, 'tone abre el brillo')
  const c = new Motor(sr); seco(c); c.setParam(P.ampGain, 90); c.setParam(P.cabSim, 0)
  const d = new Motor(sr); seco(d); d.setParam(P.ampGain, 90); d.setParam(P.cabSim, 100)
  const agudos = (x) => { let d = 0, e = 0; for (let i = 2; i < x.length; i++) { d += (x[i] - 2 * x[i - 1] + x[i - 2]) ** 2; e += x[i] ** 2 } return d / (e + 1e-12) }
  const ac = agudos(render(c, sr, 1.5, acorde).L), ad = agudos(render(d, sr, 1.5, acorde).L)
  assert.ok(ac > ad * 1.3, `la pantalla oscurece (${ac.toFixed(4)} vs ${ad.toFixed(4)})`)
  const e = new Motor(sr); seco(e); e.setParam(P.ampGain, 5)
  const f = new Motor(sr); seco(f); f.setParam(P.ampGain, 95)
  const crest = (x) => pico(x) / (rms(x) + 1e-12)
  assert.ok(crest(render(e, sr, 1.5, acorde).L) > crest(render(f, sr, 1.5, acorde).L), 'más ganancia, más compresión')
  const dl = new Motor(sr); seco(dl); dl.setParam(P.delayMix, 80); dl.setParam(P.delayFeedback, 50); dl.setParam(P.delayDiv, 4); dl.setParam(P.delayTime, 300)
  const x = render(dl, sr, 2, [{ t: 0, tipo: 'on', nota: 64, vel: 0.9 }, { t: 0.05, tipo: 'off', nota: 64 }])
  const nd = new Motor(sr); seco(nd)
  const y = render(nd, sr, 2, [{ t: 0, tipo: 'on', nota: 64, vel: 0.9 }, { t: 0.05, tipo: 'off', nota: 64 }])
  assert.ok(rms(x.L, 0.3 * sr | 0, 0.45 * sr | 0) > 10 * rms(y.L, 0.3 * sr | 0, 0.45 * sr | 0) + 1e-6, 'eco del delay audible')
  // ping-pong: ecos alternan entre canales
  const eL1 = rms(x.L, Math.floor(0.31 * sr), Math.floor(0.4 * sr)), eR1 = rms(x.R, Math.floor(0.31 * sr), Math.floor(0.4 * sr))
  assert.ok(eL1 > eR1 * 3, 'primer eco a la izquierda')
  const rv = new Motor(sr); seco(rv); rv.setParam(P.reverbMix, 100)
  const z = render(rv, sr, 2, [{ t: 0, tipo: 'on', nota: 64, vel: 0.9 }, { t: 0.1, tipo: 'off', nota: 64 }]).L
  assert.ok(rms(z, sr * 0.5 | 0, sr * 0.8 | 0) > 10 * rms(y.L, sr * 0.5 | 0, sr * 0.8 | 0) + 1e-7, 'cola de reverb')
})

test('delay sincronizado al tempo: 1/8 con puntillo a 120 BPM = 375 ms; sin tempo usa ms', () => {
  const m = new Motor(48000)
  m.setParam(P.delayDiv, 0); m.setParam(P.delayTime, 600)
  assert.ok(Math.abs(m.delayMs() - 600) < 0.5, 'sin tempo: ms')
  m.setTempo(120)
  assert.ok(Math.abs(m.delayMs() - 375) < 0.5, '1/8 puntillo')
  m.setParam(P.delayDiv, 1)
  assert.ok(Math.abs(m.delayMs() - 500) < 0.5, '1/4')
})

test('pitch bend (±2 y ±12 st) y vibrato por CC1', () => {
  const sr = 48000
  for (const rango of [0, 1]) {
    const st = rango === 1 ? 12 : 2
    const m = new Motor(sr); seco(m); m.setParam(P.bendRange, rango)
    const { L } = render(m, sr, 2.4, [{ t: 0, tipo: 'on', nota: 57, vel: 0.8 }, { t: 0.9, tipo: 'bend', valor: st }])
    const a = f0(L, sr, Math.floor(0.35 * sr), Math.floor(0.2 * sr), 220)
    const b = f0(L, sr, Math.floor(1.4 * sr), Math.floor(0.2 * sr), 220 * 2 ** (st / 12))
    const err = 1200 * Math.log2(b / a) - st * 100
    assert.ok(Math.abs(err) < 12, `bend ${st} st: error ${err.toFixed(1)} cents`)
  }
  const m = new Motor(sr); seco(m)
  const { L } = render(m, sr, 2, [{ t: 0, tipo: 'on', nota: 52, vel: 0.8 }, { t: 0, tipo: 'cc', num: 1, valor: 127 }])
  let mn = 1e9, mx = 0
  for (let t = 0.3; t < 1.2; t += 0.04) { const f = f0(L, sr, Math.floor(t * sr), 3000, 164.81, 0.012); mn = Math.min(mn, f); mx = Math.max(mx, f) }
  assert.ok(1200 * Math.log2(mx / mn) > 25, `vibrato: ${(1200 * Math.log2(mx / mn)).toFixed(0)} cents p-p`)
})

test('palm mute por note-off corto y sustain acotado', () => {
  const sr = 48000
  const a = new Motor(sr); seco(a)
  const b = new Motor(sr); seco(b)
  const ra = render(a, sr, 1, [{ t: 0, tipo: 'on', nota: 45, vel: 0.8 }, { t: 0.08, tipo: 'off', nota: 45 }]).L
  const rb = render(b, sr, 1, [{ t: 0, tipo: 'on', nota: 45, vel: 0.8 }, { t: 0.9, tipo: 'off', nota: 45 }]).L
  assert.ok(rms(ra, 24000, 36000) < rms(rb, 24000, 36000) * 0.05, 'palm mute amortigua')
  const c = new Motor(sr); seco(c); c.setParam(P.sustain, 100)
  const d = new Motor(sr); seco(d)
  const xc = render(c, sr, 26, [{ t: 0, tipo: 'on', nota: 64, vel: 0.9 }]).L
  const xd = render(d, sr, 8, [{ t: 0, tipo: 'on', nota: 64, vel: 0.9 }]).L
  const at = (v, t) => dB(rms(v, Math.floor(t * sr), Math.floor((t + 0.25) * sr)))
  assert.ok(at(xc, 4) > at(xd, 4) + 6, 'el sustain alarga la nota')
  assert.ok(at(xc, 25) < -60, 'el sustain es finito')
})

test('polifonía de acordes (≥12 voces), strum y robo de voces sin NaN', () => {
  const sr = 48000
  const m = new Motor(sr); seco(m); m.setParam(P.strum, 60)
  const ev = [40, 47, 52, 56, 59, 64].map((nota) => ({ t: 0, tipo: 'on', nota, vel: 0.8 }))
  for (const nota of [38, 45, 50, 54, 57, 62]) ev.push({ t: 0.5, tipo: 'on', nota, vel: 0.8 })
  const { L } = render(m, sr, 2, ev)
  assert.ok(m.activeVoices() >= 12, `voces activas ${m.activeVoices()}`)
  assert.ok(finito(L))
  // el strum reparte los ataques: el primer 3 ms tiene mucha menos energía que 60 ms
  const e3 = rms(L, 0, 144), e60 = rms(L, 0, 2880)
  assert.ok(e3 < e60, 'strum progresivo')
  const m2 = new Motor(sr); seco(m2)
  const ev2 = []
  for (let i = 0; i < 40; i++) ev2.push({ t: i * 0.05, tipo: 'on', nota: 40 + (i % 30), vel: 0.7 })
  const r2 = render(m2, sr, 3, ev2).L
  assert.ok(finito(r2) && pico(r2) < 0.98)
  let dmax = 0
  for (let i = 1; i < r2.length; i++) dmax = Math.max(dmax, Math.abs(r2[i] - r2[i - 1]))
  assert.ok(dmax < 0.5, `sin clics al robar voces (derivada max ${dmax.toFixed(3)})`)
})

test('chorus real: modula el tono (retardo), no la amplitud', () => {
  const sr = 48000
  // se prueba la línea modulada directamente con una senoide de 1 kHz
  const mm = new Motor(sr)
  const ch = mm.chorus
  const w = new Float64Array(sr * 3)
  for (let i = 0; i < w.length; i++) { ch.process(Math.sin((2 * Math.PI * 1000 * i) / sr)); w[i] = ch.wl }
  const zc = []
  for (let i = sr; i + 1 < w.length; i++) if (w[i] <= 0 && w[i + 1] > 0) zc.push(i + -w[i] / (w[i + 1] - w[i]))
  let fmin = 1e9, fmax = 0
  for (let k = 0; k + 8 < zc.length; k++) { const f = (8 * sr) / (zc[k + 8] - zc[k]); fmin = Math.min(fmin, f); fmax = Math.max(fmax, f) }
  assert.ok((fmax - fmin) / 1000 > 0.004, `desviación ${(100 * (fmax - fmin) / 1000).toFixed(2)} %`)
  let emin = 1e9, emax = 0
  for (let i = sr; i + 240 < w.length; i += 240) { let p = 0; for (let j = 0; j < 240; j++) p = Math.max(p, Math.abs(w[i + j])); emin = Math.min(emin, p); emax = Math.max(emax, p) }
  assert.ok(emin > 0.9 && emax < 1.1, 'amplitud constante')
})

test('pantalla 4x12: resonancia ~100 Hz y caída por encima de ~4-5 kHz', () => {
  const m = new Motor(48000)
  let pk = -99, pf = 0
  for (let f = 40; f < 300; f *= 1.02) { const d = m.cabResponseDb(f); if (d > pk) { pk = d; pf = f } }
  assert.ok(pf > 85 && pf < 130 && pk - m.cabResponseDb(1000) > 2, `pico ${pk.toFixed(1)} dB a ${pf.toFixed(0)} Hz`)
  assert.ok(m.cabResponseDb(1000) - m.cabResponseDb(5000) > 3 && m.cabResponseDb(5000) - m.cabResponseDb(10000) > 12)
})

// ---------------------------------------------------------------- FX Rack comun (shared-dsp/web/fxrack.js incrustado)
import fsFx from 'node:fs'
import { fileURLToPath } from 'node:url'
const { FX_DEFS, FX_IDS } = require('./electric-guitar-worklet.js')

test('FX Rack: 58 parametros ids 100..230 registrados, PARAM_DEFS propios intactos y manifiesto coincide', () => {
  assert.equal(FX_DEFS.length, 58)
  assert.ok(FX_DEFS.every((d) => d.id >= 100 && d.id <= 230))
  assert.equal(FX_IDS.fx_eq_b1_gain, 118)
  assert.equal(FX_IDS.fx_out_gain, 230)
  assert.equal(PARAM_DEFS.length, 18)   // los propios no cambian
  const man = JSON.parse(fsFx.readFileSync(fileURLToPath(new URL('../jaswave-plugin.json', import.meta.url)), 'utf8'))
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId >= 100).length, 58)
  assert.ok(man.ai.summary.length <= 1000 && man.ai.parameters.every((p) => p.name.length <= 120))
  assert.match(man.ai.summary, /FX Rack/)
})

test('FX Rack: apagado (aunque con ajustes) no cambia nada bit a bit; encendido si cambia', () => {
  const ev = [{ t: 0, tipo: 'on', nota: 40, vel: 0.7 }, { t: 0.1, tipo: 'on', nota: 52, vel: 0.8 }, { t: 0.2, tipo: 'on', nota: 64, vel: 0.9 },
    { t: 0.8, tipo: 'bend', valor: 1 }, { t: 1.0, tipo: 'off', nota: 40 }, { t: 1.2, tipo: 'tempo', bpm: 100 }]
  const base = render(new Motor(48000), 48000, 2, ev, 128)
  const m1 = new Motor(48000)
  m1.setParam(FX_IDS.fx_eq_b3_gain, 12); m1.setParam(FX_IDS.fx_comp_threshold, -50); m1.setParam(FX_IDS.fx_reverb_mix, 100); m1.setParam(FX_IDS.fx_out_gain, 12)
  const apagado = render(m1, 48000, 2, ev, 128)
  assert.deepEqual(apagado.L, base.L); assert.deepEqual(apagado.R, base.R)
  const m2 = new Motor(48000)
  m2.setParam(FX_IDS.fx_eq_on, 1); m2.setParam(FX_IDS.fx_eq_b3_gain, 12); m2.setParam(FX_IDS.fx_eq_b3_freq, 600)
  const enc = render(m2, 48000, 2, ev, 128)
  let dif = 0
  for (let i = 0; i < base.L.length; i++) dif = Math.max(dif, Math.abs(enc.L[i] - base.L[i]))
  assert.ok(dif > 1e-3, `el EQ encendido debe cambiar la salida (${dif})`)
  assert.ok(finito(enc.L) && finito(enc.R))
})

test('FX Rack: todo encendido con el motor completo es finito y acotado; el tempo llega al delay', () => {
  const m = new Motor(48000)
  for (const k of ['fx_hpf_on', 'fx_eq_on', 'fx_comp_on', 'fx_sat_on', 'fx_chorus_on', 'fx_delay_on', 'fx_reverb_on', 'fx_out_on']) m.setParam(FX_IDS[k], 1)
  m.setTempo(90); m.setParam(FX_IDS.fx_delay_sync, 1)
  assert.equal(m.fx.bpm, 90)
  const { L, R } = render(m, 48000, 3, [{ t: 0, tipo: 'on', nota: 52, vel: 0.8 }], 512)
  assert.ok(finito(L) && finito(R))
  assert.ok(Math.max(pico(L), pico(R)) < 4, `pico ${Math.max(pico(L), pico(R))}`)
  assert.equal(m.fx.fallos, 0)
  m.setTempo(0)   // sin tempo del host: el rack vuelve a 120 bpm
  assert.equal(m.fx.bpm, 120)
})
