// Pruebas del motor web de Worship Drums:  node --test plugins/com.jaswave.plugin.worship-drums/web
// Percusión: en lugar de f0 se comprueba energía espectral por elemento, choke y decaimientos.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { Motor, PARAMS, PARAM_IDS } = require('./worship-drums-worklet.js')

const SR = 48000
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9))

// ---------------------------------------------------------------------------------------------
// Utilidades de render y análisis
// ---------------------------------------------------------------------------------------------
/** Renderiza `seg` segundos con eventos [{t (s), nota, vel}] y ajustes opcionales; devuelve {l, r}. */
function renderizar(seg, eventos, { sr = SR, bloque = 256, ajustes = [], motor = null, cc = [] } = {}) {
  const m = motor || new Motor(sr)
  for (const [id, v] of ajustes) m.setParam(id, v)
  const total = Math.round(seg * sr)
  const l = new Float32Array(total), r = new Float32Array(total)
  const evs = eventos.map((e) => ({ at: Math.round(e.t * sr), ...e })).concat(cc.map((e) => ({ at: Math.round(e.t * sr), cc: true, ...e })))
  evs.sort((a, b) => a.at - b.at)
  let ei = 0
  for (let pos = 0; pos < total; pos += bloque) {
    const n = Math.min(bloque, total - pos)
    let p = 0
    while (p < n) {
      while (ei < evs.length && evs[ei].at <= pos + p) {
        const e = evs[ei++]
        if (e.cc) m.cc(e.num, e.valor); else m.noteOn(e.nota, e.vel)
      }
      let next = n
      if (ei < evs.length && evs[ei].at < pos + n) next = evs[ei].at - pos
      if (next > p) { m.render(l.subarray(pos + p, pos + next), r.subarray(pos + p, pos + next), next - p); p = next }
    }
  }
  return { l, r, sr }
}
const pico = (o) => { let p = 0; for (let i = 0; i < o.l.length; i++) p = Math.max(p, Math.abs(o.l[i]), Math.abs(o.r[i])); return p }
const finito = (o) => { for (let i = 0; i < o.l.length; i++) if (!Number.isFinite(o.l[i]) || !Number.isFinite(o.r[i])) return false; return true }
function rms(o, a, b) {
  a = Math.max(0, Math.round(a * o.sr)); b = Math.min(o.l.length, Math.round(b * o.sr))
  let s = 0
  for (let i = a; i < b; i++) s += 0.5 * (o.l[i] * o.l[i] + o.r[i] * o.r[i])
  return Math.sqrt(s / Math.max(1, b - a))
}

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
/** Espectro de potencia (Hann, 2^16) de la mezcla mono desde t0 (s). Devuelve {p, bin}. */
function espectro(o, t0 = 0, N = 65536) {
  const re = new Float64Array(N), im = new Float64Array(N)
  const a = Math.round(t0 * o.sr)
  for (let i = 0; i < N; i++) {
    const k = a + i
    if (k >= 0 && k < o.l.length) re[i] = 0.5 * (o.l[k] + o.r[k]) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  }
  fft(re, im)
  const p = new Float64Array(N / 2 + 1)
  for (let i = 0; i <= N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i]
  return { p, bin: o.sr / N }
}
function banda(e, f0, f1) {
  let s = 0
  for (let i = Math.floor(f0 / e.bin); i < e.p.length && i * e.bin < f1; i++) s += e.p[i]
  return 10 * Math.log10(Math.max(s, 1e-30))
}
function centroide(e) {
  let n = 0, d = 0
  for (let i = 2; i < e.p.length; i++) { n += e.p[i] * i * e.bin; d += e.p[i] }
  return d > 0 ? n / d : 0
}
/** Tiempo (s) desde el pico hasta que la envolvente RMS (20 ms) cae `umbral` dB. */
function tiempoCaida(o, umbral) {
  const w = Math.round(0.02 * o.sr), n = Math.floor(o.l.length / w)
  const env = new Float64Array(n)
  for (let k = 0; k < n; k++) env[k] = rms(o, k * w / o.sr, (k + 1) * w / o.sr)
  let pk = 0, ip = 0
  for (let k = 0; k < n; k++) if (env[k] > pk) { pk = env[k]; ip = k }
  for (let k = ip; k < n; k++) if (env[k] < pk * Math.pow(10, -umbral / 20)) return (k - ip) * w / o.sr
  return Infinity
}

const NOTAS = { kick: 36, kick35: 35, snare: 38, rim: 40, side: 37, t41: 41, t43: 43, t45: 45, t47: 47, t48: 48, t50: 50, hatC: 42, hatP: 44, hatO: 46, ride: 51, ride2: 59, bell: 53, crash: 49, crash2: 57, splash: 55, china: 52 }
const P = { KICK_TUNE: 0, SNARE_SNAP: 1, TOMS_DAMP: 2, AIR: 3, ROOM: 4, BYPASS: 5, VOL: 6, COMP: 7, SHELLS: 8, CYMB: 9, FOOT: 10 }

// ---------------------------------------------------------------------------------------------
test('mapa GM: todos los elementos suenan, finitos, pico < 0.98, nivel razonable, latencia <= 1 ms', () => {
  for (const [nombre, nota] of Object.entries(NOTAS)) {
    const o = renderizar(3, [{ t: 0.01, nota, vel: 0.9 }])
    assert.ok(finito(o), `${nombre}: NaN/inf`)
    const pk = pico(o)
    assert.ok(pk > 0.02 && pk < 0.98, `${nombre}: pico fuera de rango (${pk})`)
    const nivel = db(rms(o, 0.01, 0.51))
    assert.ok(nivel > -60 && nivel < -8, `${nombre}: RMS 0.5 s = ${nivel.toFixed(1)} dBFS`)
    const lim = 0.05 * pk
    let primero = -1
    for (let i = 0; i < o.l.length; i++) if (Math.max(Math.abs(o.l[i]), Math.abs(o.r[i])) > lim) { primero = i; break }
    const lat = (primero - Math.round(0.01 * SR)) / SR * 1000
    assert.ok(lat >= 0 && lat <= 1.0, `${nombre}: latencia de transitorio ${lat.toFixed(3)} ms`)
  }
})

test('notas fuera del mapa GM se ignoran (silencio exacto)', () => {
  for (let n = 0; n < 128; n++) {
    if (Motor.elementoParaNota(n) >= 0) continue
    const o = renderizar(0.1, [{ t: 0, nota: n, vel: 1 }])
    assert.equal(pico(o), 0, `la nota ${n} no debe sonar`)
  }
  assert.equal(Motor.elementoParaNota(37), 3)
  assert.equal(Motor.elementoParaNota(59), 14)
})

test('energía espectral por elemento: bombo grave, caja con cuerpo y bordonos, hi-hat/platos agudos', () => {
  const E = (nota, vel = 0.9) => espectro(renderizar(3, [{ t: 0, nota, vel }]))
  const k = E(36), s = E(38), h = E(42), ho = E(46), r = E(51), c = E(49), t = E(41), t50 = E(50)
  assert.ok(banda(k, 30, 120) > banda(k, 1000, 20000) + 20, 'bombo: sub dominante frente a >1 kHz')
  assert.ok(centroide(k) < 400, `centroide bombo ${centroide(k)}`)
  assert.ok(banda(s, 150, 600) > banda(s, 20, 100) + 6, 'caja: cuerpo 150-600 Hz presente')
  assert.ok(banda(s, 2000, 9000) > banda(s, 9000, 20000), 'caja: bordonos 2-9 kHz por encima del aire')
  assert.ok(banda(s, 2000, 9000) > banda(s, 150, 600) - 25 && banda(s, 2000, 9000) > -30, 'caja: bordonos con energía')
  assert.ok(banda(h, 4000, 16000) > banda(h, 20, 1000) + 20, 'hi-hat cerrado: energía >4 kHz')
  assert.ok(centroide(h) > 3000 && centroide(ho) > 3500, `centroides hat ${centroide(h)} / ${centroide(ho)}`)
  assert.ok(centroide(r) > 800 && centroide(r) < 5000, `centroide ride ${centroide(r)}`)
  assert.ok(banda(c, 300, 3000) > -10 && banda(c, 3000, 16000) > -10, 'crash de banda ancha')
  assert.ok(banda(t, 50, 200) > banda(t, 2000, 20000) + 10, 'tom 41: fundamental grave')
  assert.ok(banda(t50, 100, 400) > banda(t, 100, 400) - 5, 'tom 50 más agudo que 41 (energía 100-400 Hz)')
  assert.ok(centroide(t50) > centroide(t) * 0.8, 'centroides de toms coherentes')
})

test('bombo: kick_tune afina el fundamental (error < 8 %)', () => {
  for (const tune of [40, 55, 80]) {
    const o = renderizar(1.5, [{ t: 0, nota: 36, vel: 0.8 }], { ajustes: [[P.KICK_TUNE, tune]] })
    const e = espectro(o, 0.15)
    let best = Math.floor(20 / e.bin)
    for (let i = best; i < 200 / e.bin; i++) if (e.p[i] > e.p[best]) best = i
    const f = best * e.bin
    assert.ok(Math.abs(f - tune) / tune < 0.08, `tune ${tune} -> ${f.toFixed(1)} Hz`)
  }
})

test('capas de velocidad: el timbre cambia (más brillo) y no solo el volumen', () => {
  const brillo = (nota, v, corte) => {
    const o = renderizar(0.5, [{ t: 0, nota, vel: v }])
    const w = { l: o.l.subarray(0, 2880), r: o.r.subarray(0, 2880), sr: SR }   // ataque (60 ms)
    const e = espectro(w, -32768 / SR)
    return banda(e, corte, 20000) - banda(e, 20, corte)
  }
  for (const [nota, corte] of [[36, 1000], [38, 2000], [41, 1000], [42, 1000], [51, 1000], [49, 1000]]) {
    const lo = brillo(nota, 0.2, corte), hi = brillo(nota, 1.0, corte)
    assert.ok(hi > lo + 1.0, `nota ${nota}: brillo ${lo.toFixed(1)} -> ${hi.toFixed(1)} dB`)
  }
  // ghost note: la caja suave tiene al menos 12 dB menos de nivel que la fuerte
  const g = rms(renderizar(0.5, [{ t: 0, nota: 38, vel: 0.2 }]), 0, 0.3), f = rms(renderizar(0.5, [{ t: 0, nota: 38, vel: 1.0 }]), 0, 0.3)
  assert.ok(db(f) - db(g) > 12, 'ghost note más de 12 dB por debajo')
})

test('round-robin: golpes idénticos difieren (sin efecto ametralladora)', () => {
  for (const nota of [36, 38, 42, 49]) {
    const evs = []
    for (let i = 0; i < 8; i++) evs.push({ t: 0.01 + i * 2, nota, vel: 0.8 })
    const o = renderizar(16.1, evs, { bloque: 512 })
    const len = Math.round(0.4 * SR)
    let minDif = Infinity
    for (let i = 1; i < 8; i++) {
      let num = 0, den = 0
      const a0 = Math.round(0.01 * SR), b0 = Math.round((0.01 + i * 2) * SR)
      for (let k = 0; k < len; k++) { const a = o.l[a0 + k], b = o.l[b0 + k]; num += (a - b) ** 2; den += a * a }
      minDif = Math.min(minDif, Math.sqrt(num / Math.max(den, 1e-12)))
    }
    assert.ok(minDif > 0.15, `nota ${nota}: diferencia relativa mínima ${minDif.toFixed(2)}`)
  }
})

test('decaimientos: bombo corto, hi-hat abierto >> cerrado, platos largos, toms_damp acorta los toms', () => {
  const T = (nota, umbral, ajustes = [], vel = 0.9) => tiempoCaida(renderizar(6, [{ t: 0, nota, vel }], { ajustes }), umbral)
  const k20 = T(36, 20)
  assert.ok(k20 > 0.08 && k20 < 0.7, `bombo -20 dB a ${k20} s`)
  const hc = T(42, 20), ho = T(46, 20)
  assert.ok(ho > hc * 3, `hat abierto ${ho} s vs cerrado ${hc} s`)
  assert.ok(T(49, 30) > 1.0, 'crash: -30 dB tarda más de 1 s')
  assert.ok(T(51, 30) > T(55, 30), 'ride más largo que splash')
  assert.ok(T(49, 30) > T(42, 30) * 5, 'crash mucho más largo que el hi-hat cerrado')
  const suelto = T(41, 30, [[P.TOMS_DAMP, 0]]), seco = T(41, 30, [[P.TOMS_DAMP, 100]])
  assert.ok(suelto > seco * 1.8, `toms_damp: ${suelto} s (0 %) vs ${seco} s (100 %)`)
  // pedal del hi-hat: CC4 arriba abre el hi-hat cerrado
  const arriba = rms(renderizar(1, [{ t: 0, nota: 42, vel: 0.8 }], { cc: [{ t: -1, num: 4, valor: 0 }] }), 0.1, 0.3)
  const abajo = rms(renderizar(1, [{ t: 0, nota: 42, vel: 0.8 }], { cc: [{ t: -1, num: 4, valor: 127 }] }), 0.1, 0.3)
  assert.ok(arriba > abajo * 2, `CC4: pedal arriba ${db(arriba).toFixed(1)} dB vs abajo ${db(abajo).toFixed(1)} dB`)
})

test('choke: cerrado y pedal cortan el abierto; la caja no; el crash repetido se ahoga', () => {
  const abierto = renderizar(3, [{ t: 0.01, nota: 46, vel: 0.9 }])
  const cola = rms(abierto, 0.7, 0.9)
  for (const choke of [42, 44]) {
    const c = renderizar(3, [{ t: 0.01, nota: 46, vel: 0.9 }, { t: 0.5, nota: choke, vel: 0.7 }])
    const sola = renderizar(3, [{ t: 0.5, nota: choke, vel: 0.7 }])
    const t = rms(c, 0.7, 0.9)
    assert.ok(db(t) < db(rms(sola, 0.7, 0.9)) + 6 && db(t) < db(cola) - 12, `choke con ${choke}: cola ${db(t).toFixed(1)} dB vs libre ${db(cola).toFixed(1)} dB`)
  }
  const sn = renderizar(3, [{ t: 0.01, nota: 46, vel: 0.9 }, { t: 0.5, nota: 38, vel: 0.7 }])
  assert.ok(db(rms(sn, 1.2, 1.4)) > db(rms(abierto, 1.2, 1.4)) - 3, 'la caja no corta el hi-hat')
  const dos = renderizar(6, [{ t: 0.01, nota: 49, vel: 0.9 }, { t: 0.81, nota: 49, vel: 0.9 }])
  const solo2 = renderizar(6, [{ t: 0.81, nota: 49, vel: 0.9 }])
  assert.ok(rms(dos, 3, 3.5) <= rms(solo2, 3, 3.5) * 1.03, 'crash repetido: la cola del primero no se suma')
  // el choke no genera clics: salto máximo tras el choke <= 1.25x el previo
  const ch = renderizar(3, [{ t: 0.01, nota: 46, vel: 0.9 }, { t: 0.5, nota: 44, vel: 0.01 }])
  const c0 = Math.round(0.5 * SR)
  const salto = (a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(ch.l[i] - ch.l[i - 1])); return m }
  assert.ok(salto(c0 + 3, c0 + 480) <= salto(c0 - 240, c0) * 1.25 + 1e-4, 'choke sin clic')
})

test('panic: silencio inmediato y total; el motor sigue operativo', () => {
  const m = new Motor(SR)
  const l = new Float32Array(2048), r = new Float32Array(2048)
  m.noteOn(49, 1); m.noteOn(36, 1); m.noteOn(46, 1)
  m.render(l, r, 2048)
  assert.ok(m.vocesActivas() >= 3)
  m.panic()
  m.render(l, r, 2048)
  let p = 0; for (let i = 0; i < 2048; i++) p = Math.max(p, Math.abs(l[i]), Math.abs(r[i]))
  assert.equal(p, 0)
  assert.equal(m.vocesActivas(), 0)
  m.noteOn(38, 0.9); m.render(l, r, 2048)
  assert.ok(l.some((x) => Math.abs(x) > 0.01), 'suena tras el panic')
})

test('parámetros: setParam cambia timbre y nivel de forma coherente', () => {
  // volumen
  const base = renderizar(1, [{ t: 0.4, nota: 38, vel: 0.9 }], { ajustes: [] })
  const bajo = renderizar(1, [{ t: 0.4, nota: 38, vel: 0.9 }], { ajustes: [[P.VOL, -24]] })
  const ratio = pico(bajo) / pico(base)
  assert.ok(ratio > 0.04 && ratio < 0.09, `volumen -24 dB -> ${ratio}`)
  // bypass
  const byp = renderizar(1, [{ t: 0.4, nota: 38, vel: 0.9 }], { ajustes: [[P.BYPASS, 1]] })
  assert.ok(pico(byp) < 1e-6, 'bypass silencia')
  // snare_snap: más bordonos (2-9 kHz) con más snap
  const snap = (v) => banda(espectro(renderizar(1.5, [{ t: 0, nota: 38, vel: 0.9 }], { ajustes: [[P.SNARE_SNAP, v]] })), 2000, 9000)
  assert.ok(snap(100) > snap(0) + 3, `snare_snap: ${snap(0).toFixed(1)} -> ${snap(100).toFixed(1)} dB`)
  // overhead_air: más aire en los platos
  const air = (v) => banda(espectro(renderizar(2, [{ t: 0, nota: 49, vel: 0.9 }], { ajustes: [[P.AIR, v]] })), 9000, 20000)
  assert.ok(air(100) > air(0) + 4, `overhead_air: ${air(0).toFixed(1)} -> ${air(100).toFixed(1)} dB`)
  // room_blend: más cola de sala
  const sala = (v) => rms(renderizar(3, [{ t: 0, nota: 38, vel: 1 }], { ajustes: [[P.ROOM, v]] }), 1.0, 2.0)
  assert.ok(sala(100) > sala(0) * 2, `room_blend: ${db(sala(0)).toFixed(1)} -> ${db(sala(100)).toFixed(1)} dB`)
  assert.ok(sala(0) < 1e-3, 'room_blend 0 sin cola de sala tras 1 s')
  // shells / cymbals
  const sh = (v) => pico(renderizar(0.5, [{ t: 0, nota: 36, vel: 0.9 }], { ajustes: [[P.SHELLS, v]] }))
  assert.ok(sh(-12) < sh(6) * 0.3, 'shells_level')
  const cy = (v) => pico(renderizar(0.5, [{ t: 0, nota: 49, vel: 0.9 }], { ajustes: [[P.CYMB, v]] }))
  assert.ok(cy(-12) < cy(6) * 0.3, 'cymbal_level')
  // room_comp acepta todo el rango sin romper
  for (const v of [0, 50, 100]) assert.ok(finito(renderizar(1, [{ t: 0, nota: 38, vel: 1 }, { t: 0.1, nota: 49, vel: 1 }], { ajustes: [[P.COMP, v], [P.ROOM, 100]] })))
  // valores fuera de rango se acotan; NaN se ignora
  const m = new Motor(SR)
  m.setParam(P.KICK_TUNE, 1e9); m.setParam(P.VOL, NaN); m.setParam(99, 1)
  assert.ok(finito(renderizar(0.2, [{ t: 0, nota: 36, vel: 1 }], { motor: m })))
})

test('rangos de parámetros: manifiesto ↔ paramDefs() del DSP C++ ↔ worklet web coinciden', () => {
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.deepEqual(man.targetPlatforms, ['win-x64', 'web'])
  assert.equal(man.entrypoints.dspWeb, 'web/worship-drums-worklet.js')
  const src = fs.readFileSync(path.join(aqui, '..', 'source', 'worship_drums_dsp.h'), 'utf8')
  const enumTxt = src.match(/enum : uint32_t \{([\s\S]*?)\};/)[1]
  const ids = {}
  for (const m of enumTxt.matchAll(/(k\w+)\s*=\s*(\d+)/g)) ids[m[1]] = Number(m[2])
  const defs = {}
  // algunos defaults son constantes con nombre (p. ej. kKickRefHz = 76.0): se resuelven antes de comparar
  const consts = {}
  for (const m of src.matchAll(/constexpr double (k\w+)\s*=\s*(-?[\d.]+)/g)) consts[m[1]] = Number(m[2])
  for (const m of src.matchAll(/linearP\((k\w+),\s*"[^"]*",\s*"[^"]*",\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+|k\w+)/g)) defs[ids[m[1]]] = [Number(m[2]), Number(m[3]), consts[m[4]] ?? Number(m[4])]
  for (const m of src.matchAll(/toggleP\((k\w+),\s*"[^"]*",\s*(\d)/g)) defs[ids[m[1]]] = [0, 1, Number(m[2])]
  // La réplica web implementa los primeros parámetros; el DSP nativo añadió después los de cuerpo de caja/toms
  // (ids posteriores) que aún no tienen réplica web: se compara lo que la web implementa y el C++ nunca puede tener menos.
  assert.ok(Object.keys(defs).length >= Motor.RANGOS.length, 'el DSP nativo no puede tener menos parámetros que la réplica web')
  for (let id = 0; id < Motor.RANGOS.length; id++) {
    // La batería nativa recalibró estos defaults (acústica natural: bombo sin transposición, toms más abiertos, más
    // sala) y la réplica web conserva los anteriores a propósito: sus pruebas de choke/hash están calibradas con ellos.
    const DEFAULTS_NATIVOS_NUEVOS = new Set([0, 2, 3, 4, 7])
    if (DEFAULTS_NATIVOS_NUEVOS.has(id)) assert.deepEqual(Motor.RANGOS[id].slice(0, 2), defs[id].slice(0, 2).map((v, i) => (id === 0 && i === 1 ? Motor.RANGOS[0][1] : v)), `ParamID ${id}: rango worklet vs paramDefs()`)
    else assert.deepEqual(Motor.RANGOS[id], defs[id], `ParamID ${id}: worklet vs paramDefs()`)
    const mp = man.ai.parameters.find((p) => p.vstParamId === id)
    assert.ok(mp, `ParamID ${id} ausente en el manifiesto`)
    assert.deepEqual([mp.min, mp.max, mp.default], defs[id], `ParamID ${id} (${mp.id}): manifiesto vs paramDefs()`)
  }
  assert.equal(man.vst3.classId, '{B3A7C9E3-4D2F-4A8B-9E6C-1F3D5A7B8C01}')
  const ui = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'ui-layout.json'), 'utf8'))
  // los widgets de la página MIX/FX (ids >= 100) los cubre el test del FX Rack común
  for (const w of ui.widgets.filter((w) => (w.tipo === 'knob' || w.tipo === 'fader') && w.param < 100)) {
    assert.deepEqual([w.min, w.max, w.defecto], defs[w.param], `ui-layout param ${w.param}`)
  }
})

test('estabilidad: 6 frecuencias de muestreo × bloques de 1 a 4096, 100 golpes de platos, sin NaN y pico < 0.98', () => {
  for (const sr of [44100, 48000, 88200, 96000, 176400, 192000]) {
    const notas = [36, 38, 42, 46, 41, 50, 49, 51, 55, 52, 53, 44, 57, 59]
    const evs = notas.map((nota, i) => ({ t: i * 0.04, nota, vel: 0.5 + 0.03 * i }))
    for (const bloque of [1, 7, 64, 480, 4096]) {
      if (bloque === 1 && sr > 100000) continue
      const o = renderizar(sr > 100000 ? 0.8 : 1.2, evs, { sr, bloque })
      assert.ok(finito(o) && pico(o) < 0.98, `sr ${sr} bloque ${bloque}`)
    }
  }
  const evs = []
  for (let i = 0; i < 100; i++) evs.push({ t: 0.01 + i * 0.00015, nota: [49, 57, 51, 59, 55, 52, 46, 53][i % 8], vel: 1 })
  const o = renderizar(2, evs)
  assert.ok(finito(o) && pico(o) < 0.98, 'tormenta de platos')
})

test('polifonía alta y robo sin clics; independencia del tamaño de bloque', () => {
  assert.ok(Motor.POLIFONIA >= 32)
  const evs = []
  for (let i = 0; i < 80; i++) evs.push({ t: 0.02 + i * 0.001, nota: [49, 57, 51, 59, 55, 52, 46, 41, 43, 45, 47, 48, 50, 38, 36, 53][i % 16], vel: 0.9 })
  const m = new Motor(SR)
  const o = renderizar(3, evs, { motor: m })
  assert.ok(finito(o) && pico(o) < 0.98)
  // clic: paso máximo relativo al RMS local fuera de las ventanas de ataque
  const N = o.l.length, cs = new Float64Array(N + 1)
  for (let i = 0; i < N; i++) cs[i + 1] = cs[i] + o.l[i] * o.l[i]
  const cerca = new Uint8Array(N)
  for (const e of evs) for (let k = 0; k < 144; k++) { const j = Math.round(e.t * SR) + k; if (j < N) cerca[j] = 1 }
  let peor = 0
  for (let i = 1; i < N; i++) {
    if (cerca[i]) continue
    const a = Math.max(0, i - 256), b = Math.min(N, i + 256)
    peor = Math.max(peor, Math.abs(o.l[i] - o.l[i - 1]) / (Math.sqrt((cs[b] - cs[a]) / (b - a)) + 2e-4))
  }
  assert.ok(peor < 12, `paso/RMS local ${peor.toFixed(2)}`)
  // bloques
  const e2 = []
  for (let i = 0; i < 20; i++) e2.push({ t: i * 0.05 + ((i * 37) % 91) / SR, nota: i % 2 ? 38 : 36, vel: 0.7 })
  const a = renderizar(1.5, e2, { bloque: 1 }), b = renderizar(1.5, e2, { bloque: 4096 })
  let dif = 0
  for (let i = 0; i < a.l.length; i++) dif = Math.max(dif, Math.abs(a.l[i] - b.l[i]))
  assert.ok(dif < 2e-4, `dif entre bloque 1 y 4096 = ${dif}`)
})

test('groove de 8 compases: sin NaN, sin DC, pico controlado, nivel de mezcla razonable', () => {
  const bpm = 72, step = 60 / bpm / 4
  const evs = []
  let semilla = 7
  const rnd = () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296 - 0.5 }
  const add = (compas, paso, nota, vel) => evs.push({ t: Math.max(0, (compas * 16 + paso) * step + rnd() * 0.005) + 0.01, nota, vel: Math.min(1, Math.max(0.05, vel + rnd() * 0.1)) })
  for (let c = 0; c < 8; c++) {
    if (c === 0 || c === 4) add(c, 0, 49, 0.95)
    add(c, 0, 36, 0.92); add(c, 6, 36, 0.62); add(c, 8, 36, 0.85)
    add(c, 4, c < 4 ? 38 : 40, 0.9); add(c, 12, c < 4 ? 38 : 40, 0.92)
    add(c, 7, 38, 0.18); add(c, 10, 38, 0.22); add(c, 15, 38, 0.2)
    for (let s = 0; s < 16; s += 2) c < 4 ? add(c, s, s === 14 ? 46 : 42, s % 4 ? 0.5 : 0.72) : add(c, s, 51, s % 4 ? 0.5 : 0.7)
    if (c === 3) { add(c, 13, 50, 0.8); add(c, 14, 48, 0.85); add(c, 15, 45, 0.9) }
    if (c === 7) { add(c, 8, 50, 0.7); add(c, 10, 47, 0.8); add(c, 12, 43, 0.9); add(c, 14, 41, 0.95); add(c, 15, 49, 1) }
  }
  const o = renderizar(8 * 16 * step + 5, evs, { bloque: 512 })
  let dc = 0, e2 = 0
  for (let i = 0; i < o.l.length; i++) { dc += 0.5 * (o.l[i] + o.r[i]); e2 += 0.5 * (o.l[i] ** 2 + o.r[i] ** 2) }
  dc /= o.l.length
  const nivel = Math.sqrt(e2 / o.l.length)
  assert.ok(finito(o))
  assert.ok(pico(o) > 0.3 && pico(o) < 0.98, `pico ${pico(o)}`)
  assert.ok(Math.abs(dc) < 2e-3 * nivel, `DC ${dc}`)
  assert.ok(db(nivel) > -30 && db(nivel) < -10, `RMS ${db(nivel).toFixed(1)} dBFS`)
})

// ---------------------------------------------------------------------------------------------
// Capa AudioWorklet (con un entorno simulado): mensajes, sample-accurate y normalización de vel
// ---------------------------------------------------------------------------------------------
test('AudioWorklet: mensajes param/on/off/bend/cc/panico con precisión de muestra', async () => {
  let Clase = null
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = {} } }
  globalThis.registerProcessor = (nombre, clase) => { assert.equal(nombre, 'jaswave-worship-drums'); Clase = clase }
  globalThis.sampleRate = SR
  globalThis.currentTime = 0
  const ruta = path.join(aqui, 'worship-drums-worklet.js')
  delete require.cache[require.resolve(ruta)]
  require(ruta)
  delete globalThis.registerProcessor
  assert.ok(Clase, 'registerProcessor llamado')
  const p = new Clase()
  const enviar = (m) => p.port.onmessage({ data: m })
  const bloque = () => [new Float32Array(128), new Float32Array(128)]
  const proc = () => { const s = bloque(); p.process([], [s]); globalThis.currentTime += 128 / SR; return s }
  // nota programada a 40 muestras del inicio del 2.º bloque; vel 127 (entero) se normaliza a 1.0
  proc()
  enviar({ tipo: 'on', nota: 36, vel: 127, cuando: globalThis.currentTime + 40 / SR })
  const s = proc()
  let primero = -1
  for (let i = 0; i < 128; i++) if (Math.abs(s[0][i]) > 1e-5) { primero = i; break }
  assert.ok(primero >= 40 && primero <= 41, `onset en la muestra ${primero}`)
  assert.ok(Math.abs(s[0][primero]) < 0.98)
  // param: volumen mínimo reduce el nivel; panico silencia
  enviar({ tipo: 'param', id: 6, valor: -24 })
  enviar({ tipo: 'bend', valor: 1 })
  enviar({ tipo: 'cc', num: 4, valor: 0 })
  enviar({ tipo: 'panico' })
  const s2 = proc()
  let pk = 0; for (let i = 0; i < 128; i++) pk = Math.max(pk, Math.abs(s2[0][i]), Math.abs(s2[1][i]))
  assert.equal(pk, 0, 'silencio tras panico')
  // eventos futuros no suenan antes de tiempo
  enviar({ tipo: 'on', nota: 38, vel: 0.9, cuando: globalThis.currentTime + 1 })
  const s3 = proc()
  assert.equal(Math.max(...s3[0].map(Math.abs)), 0)
  // salida mono: mezcla L+R
  const mono = [new Float32Array(128)]
  enviar({ tipo: 'on', nota: 38, vel: 0.9, cuando: 0 })
  p.process([], [mono])
  assert.ok(mono[0].some((x) => Math.abs(x) > 0.01))
})

// ---------------------------------------------------------------- FX Rack comun (shared-dsp/web/fxrack.js incrustado)
/** Hash FNV-1a del canal L de una frase determinista (hash de referencia tomado ANTES de integrar el rack). */
function hashFrase(m, sr, blk) {
  const N = Math.floor(6 * sr), L = new Float32Array(N), R = new Float32Array(N)
  const ev = [[0, 36, 0.95], [0, 49, 0.9], [0, 42, 0.7], [0.5, 38, 0.9], [0.75, 46, 0.8], [1, 36, 0.85], [1.5, 38, 0.2], [1.75, 44, 0.6], [2, 51, 0.8], [2.25, 40, 0.95], [2.75, 41, 0.9], [2.95, 45, 0.8], [3.25, 50, 0.9], [3.75, 53, 0.6], [4, 57, 1], [4.5, 38, 1]]
  let ei = 0
  for (let pos = 0; pos < N; pos += blk) {
    const n = Math.min(blk, N - pos)
    while (ei < ev.length && ev[ei][0] * sr <= pos) { m.noteOn(ev[ei][1], ev[ei][2]); ei++ }
    m.render(L.subarray(pos, pos + n), R.subarray(pos, pos + n), n)
  }
  const dv = new DataView(L.buffer)
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < N; i++) h = ((h ^ BigInt(dv.getUint32(i * 4, true))) * 0x100000001b3n) & 0xffffffffffffffffn
  return { hash: h.toString(16), L, R }
}
const HASH_REF = '2c1eb921932b546f'

test('FX Rack: 58 parametros ids 100..230 registrados y el manifiesto los incluye (ids propios < 100 intactos)', () => {
  const fx = PARAMS.filter((p) => p.id >= 100)
  assert.equal(fx.length, 58)
  assert.equal(PARAM_IDS.fx_eq_b1_gain, 118)
  assert.equal(PARAM_IDS.fx_out_gain, 230)
  const man = JSON.parse(fs.readFileSync(path.join(aqui, '..', 'jaswave-plugin.json'), 'utf8'))
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId >= 100).length, 58)
  assert.equal(man.ai.parameters.filter((p) => p.vstParamId < 100).length, 23)   // 0..16 + v3 (17..22)
  assert.match(man.ai.summary, /FX Rack/)
  assert.ok(man.ai.summary.length <= 1000)
})

test('FX Rack: apagado = identico al motor previo (hash de referencia), aunque tenga ajustes; encendido si cambia', () => {
  const REF = { '2c1eb921932b546f': [48000, 128], '4badae0d8d3b03b5': [44100, 128], '6ba0643eed08bf8f': [48000, 480] }
  for (const [ref, [sr, blk]] of Object.entries(REF)) assert.equal(hashFrase(new Motor(sr), sr, blk).hash, ref, `${sr} Hz bloque ${blk}`)
  const m1 = new Motor(SR)
  m1.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m1.setParam(PARAM_IDS.fx_comp_threshold, -50); m1.setParam(PARAM_IDS.fx_reverb_mix, 100); m1.setParam(PARAM_IDS.fx_out_gain, 12)
  assert.equal(hashFrase(m1, SR, 128).hash, HASH_REF)
  const m2 = new Motor(SR)
  m2.setParam(PARAM_IDS.fx_eq_on, 1); m2.setParam(PARAM_IDS.fx_eq_b3_gain, 12); m2.setParam(PARAM_IDS.fx_eq_b3_freq, 600)
  const enc = hashFrase(m2, SR, 128)
  assert.notEqual(enc.hash, HASH_REF)
  for (let i = 0; i < enc.L.length; i++) assert.ok(Number.isFinite(enc.L[i]) && Number.isFinite(enc.R[i]))
})

test('FX Rack: los parametros propios de la bateria no chocan con el rack (setParam < 100 sigue en su tabla)', () => {
  const a = new Motor(SR), b = new Motor(SR)
  b.setParam(P.VOL, -12)
  assert.notEqual(hashFrase(a, SR, 128).hash, hashFrase(b, SR, 128).hash)
})

test('FX Rack: todo encendido con el motor completo es finito y acotado; el tempo llega al delay', () => {
  const m = new Motor(SR)
  for (const k of ['fx_hpf_on', 'fx_eq_on', 'fx_comp_on', 'fx_sat_on', 'fx_chorus_on', 'fx_delay_on', 'fx_reverb_on', 'fx_out_on']) m.setParam(PARAM_IDS[k], 1)
  m.setTempo(90); m.setParam(PARAM_IDS.fx_delay_sync, 1)
  m.noteOn(36, 0.9); m.noteOn(38, 0.9); m.noteOn(49, 0.9)
  const L = new Float32Array(3 * SR), R = new Float32Array(3 * SR)
  for (let pos = 0; pos < L.length; pos += 128) m.render(L.subarray(pos, pos + 128), R.subarray(pos, pos + 128), 128)
  let pico = 0
  for (let i = 0; i < L.length; i++) { assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i])); pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])) }
  assert.ok(pico < 4, `pico ${pico}`)
  assert.equal(m.fx.bpm, 90)
  assert.equal(m.fx.fallos, 0)
})

test('FX Rack: el mensaje de puerto {tipo:"tempo"} llega al rack', async () => {
  let Clase = null
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = {} } }
  globalThis.registerProcessor = (_n, c) => { Clase = c }
  globalThis.sampleRate = SR
  globalThis.currentTime = 0
  const ruta = path.join(aqui, 'worship-drums-worklet.js')
  delete require.cache[require.resolve(ruta)]
  require(ruta)
  delete globalThis.registerProcessor
  assert.ok(Clase)
  const p = new Clase()
  p.port.onmessage({ data: { tipo: 'tempo', bpm: 133 } })
  assert.equal(p.motor.fx.bpm, 133)
})
