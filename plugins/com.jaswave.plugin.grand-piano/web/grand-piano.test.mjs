// Pruebas del motor web del Grand Piano (node:test):
//   node --test plugins/com.jaswave.plugin.grand-piano/web
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const { Motor, PARAM_DEFS, PARAM_IDS, NOTA_PROP } = require('./grand-piano-worklet.js')

const SR = 48000
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12)
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9))

/** Renderiza `seg` segundos tras ejecutar `preparar(motor)`; `eventos` = [{t, f}] con t en segundos. */
function render(seg, preparar, eventos = [], sr = SR, bloque = 128) {
  const m = new Motor(sr)
  m.setParam('reverb_send', 0)
  if (preparar) preparar(m)
  const n = Math.floor(seg * sr)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const ev = [...eventos].sort((a, b) => a.t - b.t)
  let ei = 0
  for (let pos = 0; pos < n; ) {
    while (ei < ev.length && Math.floor(ev[ei].t * sr) <= pos) ev[ei++].f(m)
    let fin = Math.min(n, pos + bloque)
    if (ei < ev.length) fin = Math.min(fin, Math.max(pos + 1, Math.floor(ev[ei].t * sr)))
    m.render(L, R, fin - pos, pos)
    pos = fin
  }
  return { L, R, m }
}
const mono = ({ L, R }) => L.map((v, i) => 0.5 * (v + R[i]))
const rms = (x, a, b) => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}
const peak = (x) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0)
const finito = (x) => x.every(Number.isFinite)

/** YIN (de Cheveigne y Kawahara) con interpolacion parabolica. */
function yin(x, ini, W, sr, fmin, fmax) {
  const tauMin = Math.max(2, Math.floor(sr / fmax))
  const tauMax = Math.floor(sr / fmin) + 2
  const d = new Float64Array(tauMax + 2)
  const c = new Float64Array(tauMax + 2).fill(1)
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0
    for (let j = 0; j < W; j++) { const q = x[ini + j] - x[ini + j + tau]; s += q * q }
    d[tau] = s
  }
  let run = 0
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; c[tau] = run > 0 ? (d[tau] * tau) / run : 1 }
  let best = -1
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (c[tau] < 0.15) { while (tau + 1 < tauMax && c[tau + 1] < c[tau]) tau++; best = tau; break }
  }
  if (best < 0) { let mn = 1e9; for (let tau = tauMin; tau < tauMax; tau++) if (c[tau] < mn) { mn = c[tau]; best = tau } }
  const a = c[best - 1], b = c[best], cc = c[best + 1]
  const den = a - 2 * b + cc
  const off = Math.abs(den) > 1e-12 ? (0.5 * (a - cc)) / den : 0
  return sr / (best + off)
}
const centavos = (f, ref) => 1200 * Math.log2(f / ref)

/** Relacion de energia por encima/por debajo de 2 kHz (dB): mide el brillo del timbre. */
function brillo(x, ini, N, sr) {
  let alto = 0, bajo = 0
  for (let f = 100; f < 12000; f *= 1.04) {
    let re = 0, im = 0
    const w = (2 * Math.PI * f) / sr
    for (let i = 0; i < N; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
      re += x[ini + i] * h * Math.cos(w * i); im -= x[ini + i] * h * Math.sin(w * i)
    }
    if (f > 2000) alto += re * re + im * im; else bajo += re * re + im * im
  }
  return 10 * Math.log10(alto / bajo)
}

/** Centroide espectral aproximado por DFT en una rejilla log (suficiente para comparar timbres). */
function centroide(x, ini, N, sr) {
  let num = 0, den = 0
  for (let f = 100; f < 10000; f *= 1.03) {
    let re = 0, im = 0
    const w = (2 * Math.PI * f) / sr
    for (let i = 0; i < N; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
      re += x[ini + i] * h * Math.cos(w * i); im -= x[ini + i] * h * Math.sin(w * i)
    }
    const p = re * re + im * im
    num += p * f; den += p
  }
  return num / den
}

test('f0 por registro con error < 15 cents (44.1, 48 y 96 kHz)', () => {
  for (const sr of [44100, 48000, 96000]) {
    for (const n of [28, 36, 48, 60, 69, 81, 96, 105]) {
      const r = render(1.6, null, [{ t: 0, f: (m) => m.noteOn(n, 0.7) }], sr)
      const f = yin(mono(r), Math.floor(0.3 * sr), 4096, sr, hz(n) * 0.7, hz(n) * 1.4)
      const err = centavos(f, hz(n))
      assert.ok(Math.abs(err) < 15, `nota ${n} @${sr}: ${f.toFixed(2)} Hz (${err.toFixed(1)} cents)`)
    }
  }
})

test('sin NaN/inf, pico < 0.98 y RMS razonable con acorde ff, parametros extremos y bloques 1..4096', () => {
  for (const bloque of [1, 7, 128, 4096]) {
    const ev = []
    ;[36, 43, 48, 52, 55, 60, 64, 67, 72, 76, 79, 84].forEach((n, i) => ev.push({ t: 0.01 * i, f: (m) => m.noteOn(n, 1) }))
    const r = render(bloque === 1 ? 0.6 : 2.5, (m) => { m.setParam('volume', 6); m.setParam('brightness', 100); m.setParam('sustain', 100) }, ev, SR, bloque)
    assert.ok(finito(r.L) && finito(r.R), `NaN/inf (bloque ${bloque})`)
    assert.ok(peak(r.L) < 0.98 && peak(r.R) < 0.98, `pico ${peak(r.L)} (bloque ${bloque})`)
    assert.ok(peak(r.L) > 0.2, 'nivel demasiado bajo')
  }
  const r = render(2, null, [{ t: 0, f: (m) => m.noteOn(60, 0.7) }])
  const nivel = db(rms(mono(r), 4800, 48000))
  assert.ok(nivel > -40 && nivel < -12, `RMS nota mf ${nivel.toFixed(1)} dBFS`)
})

test('decae: bifasico (inicial rapido, final lento) y los agudos mueren antes', () => {
  const r = render(10, null, [{ t: 0, f: (m) => m.noteOn(60, 0.7) }])
  const x = mono(r)
  const a = db(rms(x, 4800, 9600)), b = db(rms(x, 28800, 33600)), c = db(rms(x, 96000, 100800)), d = db(rms(x, 240000, 244800))
  assert.ok(a > b && b > c && c > d, `no decae: ${a.toFixed(1)} ${b.toFixed(1)} ${c.toFixed(1)} ${d.toFixed(1)}`)
  assert.ok((b - a) / 0.5 < (d - c) / 3 - 1, 'decaimiento no bifasico')
  const agudo = mono(render(6, null, [{ t: 0, f: (m) => m.noteOn(96, 0.7) }]))
  assert.ok(db(rms(agudo, 144000, 148800)) < db(rms(agudo, 4800, 9600)) - 25, 'el agudo no decae lo bastante')
})

test('la velocidad cambia nivel y timbre (centroide)', () => {
  const lvl = [], cen = []
  for (const v of [0.12, 0.5, 1]) {
    const x = mono(render(1, null, [{ t: 0, f: (m) => m.noteOn(69, v) }]))
    lvl.push(db(rms(x, 2400, 14400))); cen.push(centroide(x, 1500, 4096, SR))
  }
  assert.ok(lvl[2] - lvl[0] > 15, `rango dinamico ${lvl}`)
  assert.ok(cen[2] > cen[0] * 1.3, `timbre ${cen}`)
})

test('panic: silencio inmediato (voces, simpatica y sala)', () => {
  const m = new Motor(SR)
  m.setParam('sustain', 100)
  m.setParam('reverb_send', 80)
  const L = new Float32Array(4800), R = new Float32Array(4800)
  m.noteOn(60, 1); m.noteOn(72, 1)
  m.render(L, R, 4800, 0)
  assert.ok(peak(L) > 0.01)
  m.panic()
  m.render(L, R, 4800, 0)
  assert.equal(peak(L), 0)
  assert.equal(peak(R), 0)
  assert.equal(m.activeVoices(), 0)
})

test('los parametros actuan: brillo, volumen, curva de velocidad, sala, tune y una corda', () => {
  const nota = (prep, v = 0.8) => render(1.5, prep, [{ t: 0, f: (m) => m.noteOn(64, v) }])
  const oscuro = mono(nota((m) => m.setParam('brightness', 0))), brillante = mono(nota((m) => m.setParam('brightness', 100)))
  assert.ok(brillo(brillante, 1500, 4096, SR) > brillo(oscuro, 1500, 4096, SR) + 8, `brightness ${brillo(oscuro, 1500, 4096, SR)} -> ${brillo(brillante, 1500, 4096, SR)}`)
  const v0 = rms(mono(nota((m) => m.setParam('volume', 0))), 4800, 48000), v1 = rms(mono(nota((m) => m.setParam('volume', -12))), 4800, 48000)
  assert.ok(Math.abs(db(v1) - db(v0) + 12) < 1.5, `volume ${db(v1) - db(v0)}`)
  const suave = rms(mono(nota((m) => m.setParam('velocity_curve', 0), 0.4)), 4800, 48000), duro = rms(mono(nota((m) => m.setParam('velocity_curve', 100), 0.4)), 4800, 48000)
  assert.ok(db(duro) > db(suave) + 3, 'velocity_curve')
  // sala: con envio la cola tras soltar es mayor
  const ev = [{ t: 0, f: (m) => m.noteOn(64, 0.9) }, { t: 0.3, f: (m) => m.noteOff(64) }]
  const seca = mono(render(2, (m) => m.setParam('reverb_send', 0), ev)), humeda = mono(render(2, (m) => m.setParam('reverb_send', 100), ev))
  assert.ok(db(rms(humeda, 40000, 90000)) > db(rms(seca, 40000, 90000)) + 6, 'reverb_send')
  // release: una liberacion larga mantiene el sonido tras soltar
  const corto = mono(render(2, (m) => m.setParam('release', 0.05), ev)), largo = mono(render(2, (m) => m.setParam('release', 4), ev))
  assert.ok(db(rms(largo, 40000, 90000)) > db(rms(corto, 40000, 90000)) + 10, 'release')
  // afinacion A4
  const f430 = yin(mono(render(1.6, (m) => m.setParam('tune', 430), [{ t: 0, f: (m) => m.noteOn(69, 0.7) }])), 14400, 4096, SR, 300, 600)
  const f450 = yin(mono(render(1.6, (m) => m.setParam('tune', 450), [{ t: 0, f: (m) => m.noteOn(69, 0.7) }])), 14400, 4096, SR, 300, 600)
  assert.ok(Math.abs(centavos(f430, 430)) < 15 && Math.abs(centavos(f450, 450)) < 15, `tune ${f430} ${f450}`)
  // una corda: mas suave y mas oscuro
  const tres = mono(nota(null)), una = mono(nota((m) => m.setParam('una_corda', 1)))
  assert.ok(db(rms(una, 4800, 48000)) < db(rms(tres, 4800, 48000)) - 0.5, 'una_corda nivel')
  assert.ok(brillo(una, 1500, 4096, SR) < brillo(tres, 1500, 4096, SR), 'una_corda timbre')
})

test('pedal CC64: sostiene tras soltar; sin pedal el apagador corta; medio pedal intermedio', () => {
  const ev = (cc) => [{ t: 0, f: (m) => { m.cc(64, cc); m.noteOn(48, 0.8); m.noteOn(55, 0.8) } }, { t: 1, f: (m) => { m.noteOff(48); m.noteOff(55) } }]
  const nivel = (cc) => db(rms(mono(render(3, null, ev(cc))), 72000, 120000))
  const sin = nivel(0), medio = nivel(64), pedal = nivel(127)
  assert.ok(pedal > sin + 20, `pedal ${pedal} sin ${sin}`)
  assert.ok(medio > sin + 3 && medio < pedal + 0.5, `medio ${medio}`)
})

test('pitch bend: +2 semitonos sube ~200 cents', () => {
  const r = render(2, null, [{ t: 0, f: (m) => { m.noteOn(60, 0.7); m.pitchBend(2) } }])
  const f = yin(mono(r), 48000, 4096, SR, hz(60), hz(64))
  assert.ok(Math.abs(centavos(f, hz(62))) < 20, `${f} Hz`)
})

test('polifonia y robo de voces: sin NaN, sin saltos y limite respetado', () => {
  const ev = []
  for (let i = 0; i < 150; i++) ev.push({ t: 0.004 * i, f: (m) => m.noteOn(30 + ((i * 7) % 70), 0.9) })
  const r = render(2, (m) => m.setMaxVoices(16), ev)
  assert.ok(finito(r.L) && finito(r.R))
  assert.ok(r.m.activeVoices() <= 16 + 8)
  let dmax = 0
  for (let i = 1; i < r.L.length; i++) dmax = Math.max(dmax, Math.abs(r.L[i] - r.L[i - 1]))
  assert.ok(dmax < 0.7, `derivada max ${dmax}`)
})

test('las voces con energia agotada se liberan solas (sin note-off, con pedal)', () => {
  const r = render(30, (m) => m.setParam('sustain', 100), [{ t: 0, f: (m) => m.noteOn(100, 0.4) }])
  assert.equal(r.m.activeVoices(), 0)
})

test('rendimiento: 16 voces en tiempo real con holgura (informativo)', () => {
  const m = new Motor(SR)
  for (let i = 0; i < 16; i++) m.noteOn(40 + i * 3, 0.8)
  const L = new Float32Array(128), R = new Float32Array(128)
  const t0 = process.hrtime.bigint()
  const bloques = Math.floor((SR * 3) / 128)
  for (let b = 0; b < bloques; b++) m.render(L, R, 128, 0)
  const seg = Number(process.hrtime.bigint() - t0) / 1e9
  const uso = (100 * seg) / 3
  console.log(`  motor web: 16 voces = ${uso.toFixed(1)} % de un nucleo (3 s de audio en ${seg.toFixed(2)} s)`)
  assert.ok(uso < 60, `demasiado lento: ${uso.toFixed(1)} %`)
})

test('manifiesto: ids/rangos de PARAM_DEFS, plataformas web y dspWeb', () => {
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.deepEqual(man.targetPlatforms, ['win-x64', 'web'])
  assert.equal(man.entrypoints.dspWeb, 'web/grand-piano-worklet.js')
  assert.ok(fs.existsSync(path.join(aqui, '..', man.entrypoints.dspWeb)))
  assert.equal(man.ai.parameters.length, PARAM_DEFS.length)
  for (const d of PARAM_DEFS) {
    const p = man.ai.parameters.find((q) => q.vstParamId === d.id)
    assert.ok(p, `falta el parametro ${d.id} en el manifiesto`)
    assert.equal(p.id, d.name)
    assert.equal(p.min, d.min); assert.equal(p.max, d.max); assert.equal(p.default, d.def)
  }
  // y contra paramDefs() del VST3 (fuente: grand_piano_dsp.h + nota_a_nota.h)
  const cpp = fs.readFileSync(path.join(aqui, '..', 'source', 'grand_piano_dsp.h'), 'utf8')
  const ids = {}
  for (const m of cpp.matchAll(/\bk([A-Za-z]+) = (\d+)/g)) ids['k' + m[1]] = Number(m[2])
  let visto = 0
  for (const m of cpp.matchAll(/linearP\((k\w+), "[^"]*", "[^"]*", (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/g)) {
    if (m[1] === 'kNoteCmd') continue // orden interna de edicion del VST3 (oculta): sin réplica web ni parámetro de IA
    const d = PARAM_DEFS.find((q) => q.id === ids[m[1]])
    assert.ok(d, m[1])
    assert.deepEqual([Number(m[2]), Number(m[3]), Number(m[4])], [d.min, d.max, d.def], `rango de ${m[1]} distinto entre C++ y web`)
    visto++
  }
  for (const m of cpp.matchAll(/toggleP\((k\w+), "[^"]*", (\d)/g)) {
    const d = PARAM_DEFS.find((q) => q.id === ids[m[1]])
    assert.ok(d && d.min === 0 && d.max === 1 && d.def === Number(m[2]), m[1])
    visto++
  }
  // editor nota a nota: Note Select (indice 0..87 en el VST3 = MIDI 21..108 aqui), propiedades y preset
  assert.ok(/stepP\(kNoteSelect, "Note Select", kNotas - 1, 60 - kNotaMin,/.test(cpp), 'Note Select (88 pasos, por defecto C4)')
  assert.ok(/stepP\(kNotePreset, "Note Preset", kNotaPresets - 1, 0,/.test(cpp), 'Note Preset')
  assert.equal(ids.kNoteSelect, 12); assert.equal(ids.kNoteGain, 13); assert.equal(ids.kNoteVelCurve, 21); assert.equal(ids.kNotePreset, 22); assert.equal(ids.kNoteCmd, 23)
  const dSel = PARAM_DEFS.find((q) => q.id === 12), dPre = PARAM_DEFS.find((q) => q.id === 22)
  assert.deepEqual([dSel.min, dSel.max, dSel.def], [21, 108, 60]); assert.deepEqual([dPre.min, dPre.max, dPre.def], [0, 4, 0])
  visto += 2
  const nota = fs.readFileSync(path.join(aqui, '..', 'source', 'nota_a_nota.h'), 'utf8')
  const filas = [...nota.matchAll(/\{ "(note_\w+)", "([^"]+)", "([^"]*)", (-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (\d), (true|false) \}/g)]
  assert.equal(filas.length, 9, 'las 9 propiedades por nota de nota_a_nota.h')
  filas.forEach((m, i) => {
    const d = PARAM_DEFS[13 + i]
    assert.equal(d.name, m[1]); assert.equal(d.id, 13 + i)
    assert.deepEqual([Number(m[4]), Number(m[5]), Number(m[6])], [d.min, d.max, d.def], `rango de ${m[1]} distinto entre C++ y web`)
    const p = man.ai.parameters.find((q) => q.vstParamId === d.id)
    assert.equal(p.scale, m[8] === 'true' ? 'log' : 'linear', `escala de ${m[1]} en el manifiesto`)
    visto++
  })
  assert.equal(visto, PARAM_DEFS.filter((q) => q.id < 100).length)
  // el manifiesto explica a la IA como usar Note Select + los parametros de nota
  assert.ok(/note_select/.test(man.ai.summary) && /note_preset/.test(man.ai.summary), 'ai.summary debe explicar note_select y note_preset')
  assert.deepEqual(man.ai.parameters.find((q) => q.id === 'note_preset').values, ['Concierto', 'Cálido worship', 'Íntimo', 'Brillante pop', 'Personalizado'])
})

// ---------------------------------------------------------------------------------------------------
//  Editor nota a nota (motor modelado). Los motores nuevos son deterministas: una nota no afectada sale IDENTICA.
// ---------------------------------------------------------------------------------------------------
function medidas(prep, nota, vel = 0.7) {
  const r = render(3, prep, [{ t: 0, f: (m) => m.noteOn(nota, vel) }, { t: 1.2, f: (m) => m.noteOff(nota) }])
  const x = mono(r)
  const W = (a, b) => db(rms(x, Math.floor(a * SR), Math.floor(b * SR)))
  let pk = 0
  for (let i = 0; i < Math.floor(0.03 * SR); i++) pk = Math.max(pk, Math.abs(x[i]))
  return {
    L: r.L, R: r.R, x,
    lvl: W(0.15, 0.6),
    hz: yin(x, Math.floor(0.3 * SR), 8192, SR, hz(nota) * 0.7, hz(nota) * 1.4),
    caida: W(0.25, 0.45) - W(0.95, 1.15),
    rel: W(1.0, 1.2) - W(1.4, 1.6),
    pk30: db(pk) - W(0.3, 0.5),
    lr: W(0.1, 0.6) && db(rms(r.R, Math.floor(0.1 * SR), Math.floor(0.6 * SR))) - db(rms(r.L, Math.floor(0.1 * SR), Math.floor(0.6 * SR))),
    brillo: brillo(x, Math.floor(0.1 * SR), 8192, SR),
  }
}
const identico = (a, b) => a.L.every((v, i) => v === b.L[i]) && a.R.every((v, i) => v === b.R[i])
const conNota = (nota, prop, valor) => (m) => { m.setParam('note_select', nota); m.setParam(prop, valor) }

test('nota a nota: cada propiedad cambia lo medido solo en la nota elegida', () => {
  const base = medidas(null, 60)
  const otrasBase = [48, 59, 61, 72].map((n) => medidas(null, n))
  const caso = (prop, valor) => {
    const prep = conNota(60, prop, valor)
    ;[48, 59, 61, 72].forEach((n, i) => assert.ok(identico(medidas(prep, n), otrasBase[i]), `${prop}=${valor} altera la nota ${n}`))
    return medidas(prep, 60)
  }
  let a = caso('note_gain', 6), b = caso('note_gain', -6)
  assert.ok(Math.abs(a.lvl - base.lvl - 6) < 0.6 && Math.abs(b.lvl - base.lvl + 6) < 0.6, `ganancia ${a.lvl - base.lvl} / ${b.lvl - base.lvl}`)
  a = caso('note_tune', 30); b = caso('note_tune', -30)
  assert.ok(Math.abs(centavos(a.hz, base.hz) - 30) < 3 && Math.abs(centavos(b.hz, base.hz) + 30) < 3, `afinacion ${centavos(a.hz, base.hz)} / ${centavos(b.hz, base.hz)}`)
  a = caso('note_tone', 80); b = caso('note_tone', -80)
  assert.ok(a.brillo > base.brillo + 4 && b.brillo < base.brillo - 4, `tono ${a.brillo - base.brillo} / ${b.brillo - base.brillo} dB`)
  a = caso('note_decay', 50); b = caso('note_decay', 200)
  assert.ok(a.caida > base.caida + 0.8 && b.caida < base.caida - 0.4, `decay ${a.caida} / ${base.caida} / ${b.caida}`)
  a = caso('note_release', 25); b = caso('note_release', 400)
  assert.ok(a.rel > base.rel + 3 && b.rel < base.rel - 1.5, `release ${a.rel} / ${base.rel} / ${b.rel}`)
  a = caso('note_hammer', 200); b = caso('note_hammer', 0)
  assert.ok(a.pk30 > base.pk30 + 1 && b.pk30 < base.pk30 - 1, `martillo ${a.pk30} / ${base.pk30} / ${b.pk30}`)
  a = caso('note_pan', 100); b = caso('note_pan', -100)
  assert.ok(a.lr > base.lr + 6 && b.lr < base.lr - 6, `pan ${a.lr} / ${base.lr} / ${b.lr}`)
  const v0 = medidas(null, 60, 0.5), va = medidas(conNota(60, 'note_vel_curve', 100), 60, 0.5), vb = medidas(conNota(60, 'note_vel_curve', -100), 60, 0.5)
  assert.ok(va.lvl < v0.lvl - 3 && vb.lvl > v0.lvl + 1.5, `curva de velocidad ${va.lvl - v0.lvl} / ${vb.lvl - v0.lvl}`)
  assert.ok(identico(medidas(conNota(60, 'note_vel_curve', 100), 72), otrasBase[3]), 'la curva de velocidad altera otra nota')
})

test('nota a nota: cuerpo realza la fundamental (+-9 dB) y la tabla neutra es identica a no tener tabla', () => {
  const g = (x, f) => { // modulo de la DFT en f (ventana Hann, 0,15..0,8 s)
    const N = Math.floor(0.65 * SR), ini = Math.floor(0.15 * SR)
    let re = 0, im = 0
    const w = (2 * Math.PI * f) / SR
    for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); re += x[ini + i] * h * Math.cos(w * i); im -= x[ini + i] * h * Math.sin(w * i) }
    return db(Math.hypot(re, im))
  }
  const base = medidas(null, 60), alta = medidas(conNota(60, 'note_body', 100), 60), baja = medidas(conNota(60, 'note_body', -100), 60)
  const f0 = base.hz
  assert.ok(Math.abs(g(alta.x, f0) - g(base.x, f0) - 9) < 1.0 && Math.abs(g(baja.x, f0) - g(base.x, f0) + 9) < 1.0, `cuerpo ${g(alta.x, f0) - g(base.x, f0)} / ${g(baja.x, f0) - g(base.x, f0)}`)
  const neutra = medidas((m) => { m.setParam('note_select', 60); m.setParam('note_gain', 0); m.setParam('note_preset', 0) }, 60)
  assert.ok(identico(neutra, base), 'tabla neutra distinta de no tener tabla')
})

test('nota a nota: select muestra la nota, el preset pisa la tabla y RESET (preset 0) la restaura', () => {
  const m = new Motor(SR)
  m.setParam('note_select', 72); m.setParam('note_gain', 4)
  assert.equal(m.p[22], 4, 'editar marca Personalizado')
  m.setParam('note_select', 60)
  assert.equal(m.p[13], 0, 'C4 muestra su propio valor (neutro)')
  m.setParam('note_select', 72)
  assert.equal(m.p[13], 4, 'volver a C5 muestra +4 dB')
  m.escribirNota(90, 7, -35) // orden directa a otra nota (como Note Edit Cmd): no toca la seleccion
  assert.equal(m.leerNota(90, 7), -35); assert.equal(m.p[12], 72)
  m.setParam('note_preset', 1)
  assert.ok(m.leerNota(24, 3) > 40 && m.leerNota(100, 2) < m.leerNota(60, 2) - 30 && m.leerNota(60, 5) > 110, 'Calido worship')
  assert.equal(m.leerNota(72, 0), 0, 'el preset pisa la edicion anterior (+4 dB) de la nota 72')
  m.setParam('note_preset', 2); assert.ok(m.leerNota(60, 6) < 70 && m.leerNota(72, 2) < -25, 'Intimo')
  m.setParam('note_preset', 3); assert.ok(m.leerNota(72, 2) > 25 && m.leerNota(60, 6) > 110, 'Brillante pop')
  m.setParam('note_gain', 2) // RESET: parametros por defecto en orden de id y por ultimo el preset 0
  m.setParam('note_preset', 0)
  for (let n = 21; n <= 108; n++) for (let q = 0; q < 9; q++) assert.equal(m.leerNota(n, q), NOTA_PROP[q].def, `nota ${n} prop ${q} no restaurada`)
  assert.equal(m.p[13], 0)
})

test('nota a nota: tabla al limite sin NaN (44,1..192 kHz, bloques 1..4096) y sin cambiar de CPU', () => {
  const prep = (m) => {
    for (let n = 21; n <= 108; n++) {
      const a = n & 1 ? 1 : -1
      m.escribirNota(n, 0, 12 * a); m.escribirNota(n, 1, 50 * a); m.escribirNota(n, 2, 100 * a); m.escribirNota(n, 3, 100 * a)
      m.escribirNota(n, 4, a > 0 ? 400 : 25); m.escribirNota(n, 5, a > 0 ? 400 : 25); m.escribirNota(n, 6, a > 0 ? 200 : 0)
      m.escribirNota(n, 7, 100 * a); m.escribirNota(n, 8, 100 * a)
    }
  }
  const ev = []
  ;[21, 33, 48, 60, 72, 84, 96, 108].forEach((n, i) => { ev.push({ t: 0.1 * i, f: (m) => m.noteOn(n + (i & 1), 0.4 + 0.08 * i) }); ev.push({ t: 0.1 * i + 0.9, f: (m) => m.noteOff(n + (i & 1)) }) })
  for (const sr of [44100, 96000, 192000]) {
    for (const bloque of [1, 64, 4096]) {
      if (bloque === 1 && sr > 100000) continue
      const r = render(1.6, prep, ev, sr, bloque)
      assert.ok(finito(r.L) && finito(r.R), `NaN a ${sr} Hz bloque ${bloque}`)
      assert.ok(peak(r.L) < 0.999 && peak(r.L) > 0.005, `nivel ${peak(r.L)} a ${sr} Hz`)
    }
  }
})

// ---------------------------------------------------------------- FX Rack comun (shared-dsp/web/fxrack.js incrustado)
/** Hash FNV-1a (64 bits) de una frase determinista (acorde + notas sueltas, 5 s) renderizada con un motor nuevo. */
function hashFrase(preparar) {
  const m = new Motor(SR)
  if (preparar) preparar(m)
  const N = 5 * SR
  const L = new Float32Array(N), R = new Float32Array(N)
  const ev = [[0, 'on', 48, 0.7], [600, 'on', 55, 0.68], [1200, 'on', 64, 0.72], [2000, 'on', 72, 0.6],
    [SR * 2, 'off', 48], [SR * 2, 'off', 55], [SR * 2, 'off', 64], [SR * 3, 'on', 33, 0.9]]
  let ei = 0
  for (let pos = 0; pos < N; ) {
    while (ei < ev.length && ev[ei][0] <= pos) { const e = ev[ei++]; if (e[1] === 'on') m.noteOn(e[2], e[3]); else m.noteOff(e[2]) }
    let fin = Math.min(N, pos + 128)
    if (ei < ev.length) fin = Math.min(fin, Math.max(pos + 1, ev[ei][0]))
    m.render(L, R, fin - pos, pos)
    pos = fin
  }
  let h = 0xcbf29ce484222325n
  const dv = new DataView(new ArrayBuffer(4))
  for (let i = 0; i < N; i++) for (const x of [L[i], R[i]]) { dv.setFloat32(0, x); h = ((h ^ BigInt(dv.getUint32(0))) * 0x100000001b3n) & 0xffffffffffffffffn }
  return { hash: '0x' + h.toString(16).padStart(16, '0'), L, R, m }
}
// Hash de la salida SIN rack (motor modelado previo a la integracion, medido ANTES de integrar)
const HASH_SIN_RACK = '0x74ffc52cac4225b5'

test('FX Rack: 58 parametros ids 100..230 registrados; ids 0..23 del piano (incl. nota a nota) intactos y el manifiesto coincide', () => {
  const fx = PARAM_DEFS.filter((p) => p.id >= 100)
  assert.equal(fx.length, 58)
  assert.equal(PARAM_IDS.fx_eq_b1_gain, 118)
  assert.equal(PARAM_IDS.fx_out_gain, 230)
  assert.equal(PARAM_IDS.note_preset, 22)
  assert.equal(PARAM_DEFS.filter((p) => p.id < 100).length, 23)
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId >= 100).length, 58)
  assert.ok(man.ai.summary.length <= 1000, `ai.summary ${man.ai.summary.length}`)
  assert.ok(man.ai.parameters.every((p) => p.name.length <= 120))
  assert.match(man.ai.summary, /FX Rack/)
})

test('FX Rack: apagado = bit a bit el hash previo a la integracion (aunque tenga ajustes); encendido si cambia; tempo llega', () => {
  assert.equal(hashFrase().hash, HASH_SIN_RACK)
  const ajustes = hashFrase((m) => {
    m.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m.setParam(PARAM_IDS.fx_comp_threshold, -50); m.setParam(PARAM_IDS.fx_reverb_mix, 100); m.setParam(PARAM_IDS.fx_out_gain, 12)
  })
  assert.equal(ajustes.hash, HASH_SIN_RACK)
  const enc = hashFrase((m) => { m.setParam(PARAM_IDS.fx_eq_on, 1); m.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m.setParam(PARAM_IDS.fx_eq_b3_freq, 600) })
  assert.notEqual(enc.hash, HASH_SIN_RACK)
  for (let i = 0; i < enc.L.length; i++) assert.ok(Number.isFinite(enc.L[i]) && Number.isFinite(enc.R[i]))
  const m = new Motor(SR)
  m.setTempo(90)
  assert.equal(m.fx.bpm, 90)
})

test('FX Rack: todo encendido con el motor completo es finito y acotado; un parametro propio (note_gain) no se confunde con el rack', () => {
  const r = hashFrase((m) => {
    for (const k of ['fx_hpf_on', 'fx_eq_on', 'fx_comp_on', 'fx_sat_on', 'fx_chorus_on', 'fx_delay_on', 'fx_reverb_on', 'fx_out_on']) m.setParam(PARAM_IDS[k], 1)
    m.setTempo(90); m.setParam(PARAM_IDS.fx_delay_sync, 1)
  })
  let pico = 0
  for (let i = 0; i < r.L.length; i++) { assert.ok(Number.isFinite(r.L[i]) && Number.isFinite(r.R[i])); pico = Math.max(pico, Math.abs(r.L[i]), Math.abs(r.R[i])) }
  assert.ok(pico < 4, `pico ${pico}`)
  assert.equal(r.m.fx.fallos, 0)
  // el rack no toca los ajustes del piano
  const m = new Motor(SR)
  m.setParam('note_select', 60); m.setParam('fx_out_gain', 6)
  assert.equal(m.p[12], 60)
})
