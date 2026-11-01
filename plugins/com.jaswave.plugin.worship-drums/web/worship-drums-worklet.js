/**
 * JasWave Worship Drums – réplica web (AudioWorklet) del VST3 `com.jaswave.plugin.worship-drums`.
 * Mismo diseño sonoro y mismos parámetros/rangos que `source/worship_drums_dsp.h` (portado a JS, sin muestras):
 *
 *  Mapa GM (el resto de notas se IGNORAN): 35/36 bombo · 37 cross-stick · 38 caja (ghost por velocidad baja,
 *  crack de aro por encima de 0.8) · 40 rimshot · 41/43/45/47/48/50 toms · 42 hi-hat cerrado · 44 pedal ·
 *  46 abierto (42/44 cortan el 46; 44 corta también el 42) · 49/57 crash · 55 splash · 52 china · 51/59 ride ·
 *  53 campana.
 *
 *  - Bombo: oscilador con barrido de tono + saturación por velocidad + resonancia de parche + click de pedal.
 *  - Caja: parche circular (8 modos de Bessel) + tick de baqueta + bordonos que siguen al parche + crack de aro.
 *  - Toms: fundamental con caída de tono + 5 modos; `toms_damp` acorta el T60.
 *  - Platos: 24..40 modos inarmónicos con T60 dependiente de la frecuencia + ruido en bandas con swell;
 *    crash/splash/china se ahogan al repetir; hi-hat con apertura continua (velocidad + CC4).
 *  - Cada golpe es distinto (PRNG por golpe: afinación, fase, ruido, T60, peso de modos).
 *  - Simpatía (toms y bordonos excitados por la señal directa), micrófonos directo + overheads (pan y retardo
 *    por posición, aire) + sala (reflexiones tempranas + FDN de 8 líneas Hadamard + compresión suave).
 *  - Polifonía 40 (+24 huecos para fundidos), robo de la voz más antigua con fundido de 5 ms, soft-clip y sin DC.
 *
 * FX Rack comun (ids 100..230): setParam(id >= 100, valor) lo enruta a `motor.fx` (shared-dsp/web/fxrack.js, incrustado abajo).
 *
 * API de `Motor` (pura, sin APIs de AudioWorklet): constructor(sampleRate), setParam(id, valorPlano),
 * noteOn(nota, vel 0..1), noteOff(nota), pitchBend(semitonos), cc(num, valor 0..127), panic(), render(outL, outR, n).
 * Mensajes del puerto: {tipo:'param', id, valor} · {tipo:'on', nota, vel, cuando} · {tipo:'off', nota, cuando}
 * · {tipo:'panico'} · {tipo:'bend', valor} · {tipo:'cc', num, valor} · {tipo:'tempo', bpm}. `cuando` = segundos del AudioContext
 * (sample-accurate, como jas-wave/lib/web-synth/web-synth-processor.js); `vel` 0..1 o entero 2..127.
 */
'use strict'

// ---------------------------------------------------------------------------------------------
// Parámetros (ParamID numérico del VST3 -> [mín, máx, defecto])
// ---------------------------------------------------------------------------------------------
const P = {
  KICK_TUNE: 0, SNARE_SNAP: 1, TOMS_DAMP: 2, OVERHEAD_AIR: 3, ROOM_BLEND: 4, BYPASS: 5, VOLUME: 6,
  ROOM_COMP: 7, SHELLS_LEVEL: 8, CYMBAL_LEVEL: 9, HAT_FOOT: 10,
}
const RANGOS = [
  [35, 90, 55], [0, 100, 65], [0, 100, 50], [0, 100, 70], [0, 100, 35], [0, 1, 0], [-24, 6, 0],
  [0, 100, 35], [-12, 6, 0], [-12, 6, 0], [0, 100, 100],
]

// Tablas de parametros SOLO para el FX Rack comun (ids 100..230); los ids propios (0..10) siguen en P / RANGOS
const PARAMS = []
const PARAM_IDS = {}

// <<fxrack
'use strict'

const FXR_BASE = 100
const FXR_RANGO = 144
const FXR_SUB = 64
const FXR_BANDAS = 6

/** Offsets respecto a la base (identicos a `enum Off` de jw_fxrack.h). */
const FXR_OFF = {
  HpfOn: 0, HpfFreq: 1, HpfSlope: 2, LpfOn: 3, LpfFreq: 4, LpfSlope: 5,
  EqOn: 16, EqBand0: 17,
  CompOn: 48, CompThresh: 49, CompRatio: 50, CompAttack: 51, CompRelease: 52, CompKnee: 53, CompMakeup: 54, CompMix: 55,
  SatOn: 64, SatType: 65, SatDrive: 66, SatTone: 67, SatMix: 68,
  ChOn: 80, ChDepth: 81, ChRate: 82, ChMix: 83,
  DlOn: 96, DlSync: 97, DlTime: 98, DlFeedback: 99, DlTone: 100, DlMix: 101, DlPingPong: 102,
  RvOn: 112, RvType: 113, RvSize: 114, RvDamping: 115, RvPreDelay: 116, RvMix: 117,
  OutOn: 128, OutWidth: 129, OutGain: 130,
}

/** Los 58 parametros estandar: { id, nombre, min, max, def, escala } (valores planos). */
const FXR_PARAMS = (() => {
  const O = FXR_OFF
  const P = []
  const add = (off, nombre, min, max, def, escala) => P.push({ id: FXR_BASE + off, nombre: `FX · ${nombre}`, min, max, def, escala })
  add(O.HpfOn, 'HPF On', 0, 1, 0, 'stepped'); add(O.HpfFreq, 'HPF Freq', 20, 1000, 80, 'log'); add(O.HpfSlope, 'HPF Slope', 0, 1, 0, 'stepped')
  add(O.LpfOn, 'LPF On', 0, 1, 0, 'stepped'); add(O.LpfFreq, 'LPF Freq', 1000, 20000, 16000, 'log'); add(O.LpfSlope, 'LPF Slope', 0, 1, 0, 'stepped')
  add(O.EqOn, 'EQ On', 0, 1, 0, 'stepped')
  const fDef = [80, 200, 800, 2500, 6000, 10000], fMin = [20, 20, 20, 20, 20, 1000], fMax = [1000, 20000, 20000, 20000, 20000, 20000]
  for (let k = 0; k < FXR_BANDAS; k++) {
    const shelf = k === 0 || k === FXR_BANDAS - 1
    add(O.EqBand0 + 3 * k, `EQ Band ${k + 1} Freq`, fMin[k], fMax[k], fDef[k], 'log')
    add(O.EqBand0 + 3 * k + 1, `EQ Band ${k + 1} Gain`, -18, 18, 0, 'linear')
    add(O.EqBand0 + 3 * k + 2, `EQ Band ${k + 1} Q`, shelf ? 0.3 : 0.1, shelf ? 2 : 10, shelf ? 0.71 : 1, 'log')
  }
  add(O.CompOn, 'Comp On', 0, 1, 0, 'stepped'); add(O.CompThresh, 'Comp Threshold', -60, 0, -18, 'linear'); add(O.CompRatio, 'Comp Ratio', 1, 20, 3, 'log')
  add(O.CompAttack, 'Comp Attack', 0.1, 200, 10, 'log'); add(O.CompRelease, 'Comp Release', 10, 2000, 120, 'log'); add(O.CompKnee, 'Comp Knee', 0, 24, 6, 'linear')
  add(O.CompMakeup, 'Comp Makeup', 0, 24, 0, 'linear'); add(O.CompMix, 'Comp Mix', 0, 100, 100, 'linear')
  add(O.SatOn, 'Sat On', 0, 1, 0, 'stepped'); add(O.SatType, 'Sat Type', 0, 1, 0, 'stepped'); add(O.SatDrive, 'Sat Drive', 0, 100, 30, 'linear')
  add(O.SatTone, 'Sat Tone', 1000, 20000, 12000, 'log'); add(O.SatMix, 'Sat Mix', 0, 100, 100, 'linear')
  add(O.ChOn, 'Chorus On', 0, 1, 0, 'stepped'); add(O.ChDepth, 'Chorus Depth', 0, 100, 40, 'linear'); add(O.ChRate, 'Chorus Rate', 0.05, 5, 0.6, 'log')
  add(O.ChMix, 'Chorus Mix', 0, 100, 35, 'linear')
  add(O.DlOn, 'Delay On', 0, 1, 0, 'stepped'); add(O.DlSync, 'Delay Sync', 0, 4, 0, 'stepped'); add(O.DlTime, 'Delay Time', 20, 2000, 350, 'log')
  add(O.DlFeedback, 'Delay Feedback', 0, 90, 35, 'linear'); add(O.DlTone, 'Delay Tone', 500, 16000, 5000, 'log'); add(O.DlMix, 'Delay Mix', 0, 100, 25, 'linear')
  add(O.DlPingPong, 'Delay Ping-Pong', 0, 1, 0, 'stepped')
  add(O.RvOn, 'Reverb On', 0, 1, 0, 'stepped'); add(O.RvType, 'Reverb Type', 0, 2, 1, 'stepped'); add(O.RvSize, 'Reverb Size', 0, 100, 50, 'linear')
  add(O.RvDamping, 'Reverb Damping', 0, 100, 50, 'linear'); add(O.RvPreDelay, 'Reverb Pre-Delay', 0, 200, 20, 'linear'); add(O.RvMix, 'Reverb Mix', 0, 100, 20, 'linear')
  add(O.OutOn, 'Out On', 0, 1, 0, 'stepped'); add(O.OutWidth, 'Out Width', 0, 200, 100, 'linear'); add(O.OutGain, 'Out Gain', -24, 12, 0, 'linear')
  return P
})()

/** Clave estable de cada parametro (id del manifiesto ai.parameters): offset -> clave. */
const FXR_CLAVES = {
  0: 'fx_hpf_on', 1: 'fx_hpf_freq', 2: 'fx_hpf_slope', 3: 'fx_lpf_on', 4: 'fx_lpf_freq', 5: 'fx_lpf_slope', 16: 'fx_eq_on', 17: 'fx_eq_b1_freq',
  18: 'fx_eq_b1_gain', 19: 'fx_eq_b1_q', 20: 'fx_eq_b2_freq', 21: 'fx_eq_b2_gain', 22: 'fx_eq_b2_q', 23: 'fx_eq_b3_freq', 24: 'fx_eq_b3_gain',
  25: 'fx_eq_b3_q', 26: 'fx_eq_b4_freq', 27: 'fx_eq_b4_gain', 28: 'fx_eq_b4_q', 29: 'fx_eq_b5_freq', 30: 'fx_eq_b5_gain', 31: 'fx_eq_b5_q',
  32: 'fx_eq_b6_freq', 33: 'fx_eq_b6_gain', 34: 'fx_eq_b6_q', 48: 'fx_comp_on', 49: 'fx_comp_threshold', 50: 'fx_comp_ratio', 51: 'fx_comp_attack',
  52: 'fx_comp_release', 53: 'fx_comp_knee', 54: 'fx_comp_makeup', 55: 'fx_comp_mix', 64: 'fx_sat_on', 65: 'fx_sat_type', 66: 'fx_sat_drive',
  67: 'fx_sat_tone', 68: 'fx_sat_mix', 80: 'fx_chorus_on', 81: 'fx_chorus_depth', 82: 'fx_chorus_rate', 83: 'fx_chorus_mix', 96: 'fx_delay_on',
  97: 'fx_delay_sync', 98: 'fx_delay_time', 99: 'fx_delay_feedback', 100: 'fx_delay_tone', 101: 'fx_delay_mix', 102: 'fx_delay_pingpong',
  112: 'fx_reverb_on', 113: 'fx_reverb_type', 114: 'fx_reverb_size', 115: 'fx_reverb_damping', 116: 'fx_reverb_predelay', 117: 'fx_reverb_mix',
  128: 'fx_out_on', 129: 'fx_out_width', 130: 'fx_out_gain',
}

/** Registra el rack en las tablas de un worklet: PARAMS ({id, nombre, min, max, def, escala}) y PARAM_IDS (clave -> id). */
function fxRegistrarParametros(PARAMS, PARAM_IDS) {
  for (const p of FXR_PARAMS) {
    const clave = FXR_CLAVES[p.id - FXR_BASE]
    PARAMS.push({ id: p.id, nombre: clave, min: p.min, max: p.max, def: p.def, escala: p.escala })
    PARAM_IDS[clave] = p.id
  }
}

const fxClamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const fxLg2 = (x) => Math.log2(Math.max(x, 1e-9))

/** Suavizado exponencial (JasWaveDsp::Smoother): se avanza por sub-bloques y termina exactamente en el objetivo. */
class FxSmoother {
  constructor() { this.sr = 48000; this.tau = 0.02; this.cur = 0; this.tgt = 0 }
  prepare(sr, ms) { this.sr = sr > 0 ? sr : 48000; this.tau = Math.max(0.1, ms) * 0.001 }
  reset(v) { this.cur = this.tgt = v }
  setTarget(v) { this.tgt = v }
  advance(n) {
    if (this.cur === this.tgt) return this.cur
    const a = 1 - Math.exp(-n / (this.tau * this.sr))
    this.cur += (this.tgt - this.cur) * a
    if (Math.abs(this.tgt - this.cur) < 1e-6 * Math.max(1, Math.abs(this.tgt))) this.cur = this.tgt
    return this.cur
  }
}

/** Biquad RBJ (BiquadCoefs::design): objeto {b0,b1,b2,a1,a2}. */
function fxDisenar(tipo, sr, freq, gainDb, q) {
  const f = fxClamp(freq, 10, sr * 0.499)
  const Q = fxClamp(q, 0.05, 40)
  const w0 = (2 * Math.PI * f) / sr
  const cw = Math.cos(w0), sw = Math.sin(w0)
  const alpha = sw / (2 * Q)
  const A = Math.pow(10, gainDb / 40)
  let b0, b1, b2, a0, a1, a2
  if (tipo === 'bell') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
  } else if (tipo === 'hp') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
  } else if (tipo === 'lp') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
  } else if (tipo === 'lowShelf') {
    const s2 = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 - (A - 1) * cw + s2); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s2)
    a0 = A + 1 + (A - 1) * cw + s2; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s2
  } else {
    const s2 = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 + (A - 1) * cw + s2); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s2)
    a0 = A + 1 - (A - 1) * cw + s2; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s2
  }
  const inv = 1 / a0
  return { b0: b0 * inv, b1: b1 * inv, b2: b2 * inv, a1: a1 * inv, a2: a2 * inv }
}

/** |H(e^jw)| en dB. */
function fxMagnitudDb(c, f, sr) {
  const w = (2 * Math.PI * f) / sr
  const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = c.b0 + c.b1 * cw + c.b2 * c2, ni = -(c.b1 * sw + c.b2 * s2)
  const dr = 1 + c.a1 * cw + c.a2 * c2, di = -(c.a1 * sw + c.a2 * s2)
  const den = dr * dr + di * di
  return den <= 1e-30 ? 0 : 10 * Math.log10(Math.max((nr * nr + ni * ni) / den, 1e-30))
}

const fxTipoBanda = (b) => (b === 0 ? 'lowShelf' : b === FXR_BANDAS - 1 ? 'highShelf' : 'bell')
const fxButterQ = (orden, k) => 1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * orden)))

/** Respuesta (dB) de EQ + filtros activos a la frecuencia f, con los valores planos de `p` (formato de FxRack.p). */
function fxRespuestaDb(p, sr, f, incluirEq = true) {
  let db = 0
  if (incluirEq) for (let b = 0; b < FXR_BANDAS; b++) if (Math.abs(p.eq[b].gainDb) > 1e-3) db += fxMagnitudDb(fxDisenar(fxTipoBanda(b), sr, p.eq[b].hz, p.eq[b].gainDb, p.eq[b].q), f, sr)
  const filtro = (tipo, hz, pend) => (pend
    ? fxMagnitudDb(fxDisenar(tipo, sr, hz, 0, fxButterQ(4, 0)), f, sr) + fxMagnitudDb(fxDisenar(tipo, sr, hz, 0, fxButterQ(4, 1)), f, sr)
    : fxMagnitudDb(fxDisenar(tipo, sr, hz, 0, Math.SQRT1_2), f, sr))
  if (p.hpfOn) db += filtro('hp', p.hpfHz, p.hpfSlope)
  if (p.lpfOn) db += filtro('lp', p.lpfHz, p.lpfSlope)
  return db
}

const fxLnCosh = (z) => { z = Math.abs(z); return z > 20 ? z - 0.6931471805599453 : z + Math.log1p(Math.exp(-2 * z)) - 0.6931471805599453 }
const fxPow2Min = (n) => { let p = 1; while (p < n) p <<= 1; return p }
const FX_2PI = Math.PI * 2

function fxLeerHermite(b, mask, w, d) {
  const pos = w - d
  const fl = Math.floor(pos)
  const f = pos - fl
  const i1 = fl & mask
  const y0 = b[(i1 - 1) & mask], y1 = b[i1], y2 = b[(i1 + 1) & mask], y3 = b[(i1 + 2) & mask]
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)
  return ((c3 * f + c2) * f + c1) * f + y1
}
function fxLeerLineal(b, mask, w, d) {
  const pos = w - d
  const fl = Math.floor(pos)
  const f = pos - fl
  const i1 = fl & mask
  return b[i1] + f * (b[(i1 + 1) & mask] - b[i1])
}

/** Interruptor con fundido de 3 ms: el bloque solo corre mientras esta vivo. */
class FxGate {
  constructor(sr) { this.s = new FxSmoother(); this.s.prepare(sr, 3); this.s.reset(0); this.cleared = true }
  set(on, snap) { this.s.setTarget(on ? 1 : 0); if (snap) this.s.reset(on ? 1 : 0) }
  live() { return this.s.cur > 0 || this.s.tgt > 0 }
}

class FxFilter {
  constructor(sr, hp) {
    this.sr = sr; this.hp = hp; this.f = new FxSmoother(); this.f.prepare(sr, 25); this.f.reset(fxLg2(hp ? 80 : 16000))
    this.slope = 0; this.lastF = -1
    this.c = [null, null]
    this.z = new Float64Array(8)   // [canal*4 + etapa*2 + {0,1}]
  }
  clear() { this.z.fill(0); this.lastF = -1 }
  setP(hz, sl, snap) {
    const v = fxLg2(fxClamp(hz, 10, this.sr * 0.45))
    this.f.setTarget(v)
    if (snap) { this.f.reset(v); this.lastF = -1 }
    sl = sl ? 1 : 0
    if (sl !== this.slope) { this.slope = sl; this.z[2] = this.z[3] = this.z[6] = this.z[7] = 0; this.lastF = -1 }
  }
  run(l, r, m) {
    const v = this.f.advance(m)
    if (v !== this.lastF) {
      this.lastF = v
      const fh = Math.pow(2, v), t = this.hp ? 'hp' : 'lp'
      if (this.slope) { this.c[0] = fxDisenar(t, this.sr, fh, 0, fxButterQ(4, 0)); this.c[1] = fxDisenar(t, this.sr, fh, 0, fxButterQ(4, 1)) } else this.c[0] = fxDisenar(t, this.sr, fh, 0, Math.SQRT1_2)
    }
    const z = this.z, c0 = this.c[0], c1 = this.c[1], sl = this.slope
    for (let i = 0; i < m; i++) {
      let x = l[i], y = c0.b0 * x + z[0]
      z[0] = c0.b1 * x - c0.a1 * y + z[1]; z[1] = c0.b2 * x - c0.a2 * y
      if (sl) { x = y; y = c1.b0 * x + z[2]; z[2] = c1.b1 * x - c1.a1 * y + z[3]; z[3] = c1.b2 * x - c1.a2 * y }
      l[i] = y
      x = r[i]; y = c0.b0 * x + z[4]
      z[4] = c0.b1 * x - c0.a1 * y + z[5]; z[5] = c0.b2 * x - c0.a2 * y
      if (sl) { x = y; y = c1.b0 * x + z[6]; z[6] = c1.b1 * x - c1.a1 * y + z[7]; z[7] = c1.b2 * x - c1.a2 * y }
      r[i] = y
    }
  }
}

class FxEq {
  constructor(sr) {
    this.sr = sr
    const mk = () => { const s = new FxSmoother(); s.prepare(sr, 25); return s }
    this.fr = []; this.ga = []; this.qq = []
    for (let b = 0; b < FXR_BANDAS; b++) { this.fr.push(mk()); this.ga.push(mk()); this.qq.push(mk()); this.fr[b].reset(fxLg2(1000)); this.ga[b].reset(0); this.qq[b].reset(0) }
    this.c = new Array(FXR_BANDAS).fill(null)
    this.z = new Float64Array(FXR_BANDAS * 4)
    this.lf = new Float64Array(FXR_BANDAS).fill(1e300); this.lg = new Float64Array(FXR_BANDAS).fill(1e300); this.lq = new Float64Array(FXR_BANDAS).fill(1e300)
  }
  clear() { this.z.fill(0); this.lf.fill(1e300); this.lg.fill(1e300); this.lq.fill(1e300) }
  setP(eq, snap) {
    for (let b = 0; b < FXR_BANDAS; b++) {
      const f = fxLg2(fxClamp(eq[b].hz, 10, this.sr * 0.45)), g = fxClamp(eq[b].gainDb, -30, 30), q = fxLg2(fxClamp(eq[b].q, 0.1, 20))
      this.fr[b].setTarget(f); this.ga[b].setTarget(g); this.qq[b].setTarget(q)
      if (snap) { this.fr[b].reset(f); this.ga[b].reset(g); this.qq[b].reset(q); this.lf[b] = this.lg[b] = this.lq[b] = 1e300 }
    }
  }
  run(l, r, m) {
    const z = this.z
    for (let b = 0; b < FXR_BANDAS; b++) {
      const f = this.fr[b].advance(m), g = this.ga[b].advance(m), q = this.qq[b].advance(m)
      const activo = Math.abs(g) > 1e-3 || Math.abs(this.ga[b].tgt) > 1e-3
      const o = b * 4
      if (!activo) { z[o] = z[o + 1] = z[o + 2] = z[o + 3] = 0; this.lf[b] = 1e300; continue }
      if (f !== this.lf[b] || g !== this.lg[b] || q !== this.lq[b]) {
        this.lf[b] = f; this.lg[b] = g; this.lq[b] = q
        this.c[b] = fxDisenar(fxTipoBanda(b), this.sr, Math.pow(2, f), g, Math.pow(2, q))
      }
      const k = this.c[b]
      for (let i = 0; i < m; i++) {
        let x = l[i], y = k.b0 * x + z[o]
        z[o] = k.b1 * x - k.a1 * y + z[o + 1]; z[o + 1] = k.b2 * x - k.a2 * y
        l[i] = y
        x = r[i]; y = k.b0 * x + z[o + 2]
        z[o + 2] = k.b1 * x - k.a1 * y + z[o + 3]; z[o + 3] = k.b2 * x - k.a2 * y
        r[i] = y
      }
    }
  }
}

class FxComp {
  constructor(sr) {
    this.sr = sr
    const mk = (v) => { const s = new FxSmoother(); s.prepare(sr, 20); s.reset(v); return s }
    this.thr = mk(-18); this.ratio = mk(3); this.knee = mk(6); this.makeup = mk(0); this.mix = mk(1); this.atk = mk(fxLg2(10)); this.rel = mk(fxLg2(120))
    this.gr = 0; this.grMax = 0
  }
  clear() { this.gr = 0; this.grMax = 0 }
  setP(p, snap) {
    this.thr.setTarget(p.compThreshDb); this.ratio.setTarget(Math.max(1, p.compRatio)); this.knee.setTarget(Math.max(0, p.compKneeDb)); this.makeup.setTarget(p.compMakeupDb)
    this.mix.setTarget(fxClamp(p.compMix, 0, 1)); this.atk.setTarget(fxLg2(p.compAttackMs)); this.rel.setTarget(fxLg2(p.compReleaseMs))
    if (snap) for (const s of [this.thr, this.ratio, this.knee, this.makeup, this.mix, this.atk, this.rel]) s.reset(s.tgt)
  }
  run(l, r, m) {
    const T = this.thr.advance(m), R = this.ratio.advance(m), K = this.knee.advance(m), MU = this.makeup.advance(m), MX = this.mix.advance(m)
    const aA = Math.exp(-1 / (Math.pow(2, this.atk.advance(m)) * 0.001 * this.sr)), aR = Math.exp(-1 / (Math.pow(2, this.rel.advance(m)) * 0.001 * this.sr))
    const mk = Math.pow(10, MU / 20), slope = 1 / R - 1
    let g = this.gr
    for (let i = 0; i < m; i++) {
      const lin = Math.max(Math.abs(l[i]), Math.abs(r[i]))
      const db = 6.020599913279624 * Math.log2(Math.max(lin, 1e-9))
      const over = db - T
      let target
      if (K > 0.01) {
        if (2 * over < -K) target = 0
        else if (2 * Math.abs(over) <= K) { const x = over + K * 0.5; target = (-slope * x * x) / (2 * K) } else target = -slope * over
      } else target = over > 0 ? -slope * over : 0
      const a = target > g ? aA : aR
      g = a * g + (1 - a) * target
      const gain = Math.pow(2, -g * 0.16609640474436813) * mk
      l[i] = l[i] * (1 - MX) + l[i] * gain * MX
      r[i] = r[i] * (1 - MX) + r[i] * gain * MX
      if (g > this.grMax) this.grMax = g
    }
    this.gr = g
  }
}

class FxSat {
  constructor(sr) {
    this.sr = sr; this.type = 0
    const mk = (ms, v) => { const s = new FxSmoother(); s.prepare(sr, ms); s.reset(v); return s }
    this.drive = mk(30, 0.3); this.tone = mk(30, fxLg2(12000)); this.mix = mk(20, 1)
    this.xp = new Float64Array(2); this.lp = new Float64Array(2); this.dcx = new Float64Array(2); this.dcy = new Float64Array(2)
  }
  clear() { this.xp.fill(0); this.lp.fill(0); this.dcx.fill(0); this.dcy.fill(0) }
  setP(p, snap) {
    this.type = p.satType ? 1 : 0
    this.drive.setTarget(fxClamp(p.satDrive, 0, 1)); this.tone.setTarget(fxLg2(fxClamp(p.satToneHz, 200, this.sr * 0.45))); this.mix.setTarget(fxClamp(p.satMix, 0, 1))
    if (snap) { this.drive.reset(this.drive.tgt); this.tone.reset(this.tone.tgt); this.mix.reset(this.mix.tgt) }
  }
  run(l, r, m) {
    const d = this.drive.advance(m), MX = this.mix.advance(m)
    const k = Math.pow(10, (d * 30) / 20), mk = Math.sqrt(k)
    const bias = this.type ? 0.25 + 0.35 * d : 0, tb = Math.tanh(bias)
    const a = 1 - Math.exp((-FX_2PI * Math.pow(2, this.tone.advance(m))) / this.sr)
    const dcR = Math.exp((-FX_2PI * 15) / this.sr)
    const ch = [l, r]
    for (let c = 0; c < 2; c++) {
      const x = ch[c]
      let xr = this.xp[c], lps = this.lp[c], x1 = this.dcx[c], y1 = this.dcy[c]
      let u0 = k * xr, G0 = fxLnCosh(u0 + bias) - u0 * tb
      for (let i = 0; i < m; i++) {
        const inp = x[i]
        const u1 = k * inp
        const G1 = fxLnCosh(u1 + bias) - u1 * tb
        const du = u1 - u0
        let y = Math.abs(du) > 1e-5 ? (G1 - G0) / du : Math.tanh(0.5 * (u1 + u0) + bias) - tb
        u0 = u1; G0 = G1; xr = inp
        y *= mk / k
        if (this.type) { const o = y - x1 + dcR * y1; x1 = y; y1 = o; y = o }
        lps += a * (y - lps)
        x[i] = inp * (1 - MX) + lps * MX
      }
      this.xp[c] = xr; this.lp[c] = lps; this.dcx[c] = x1; this.dcy[c] = y1
    }
  }
}

class FxChorus {
  constructor(sr) {
    this.sr = sr
    const n = fxPow2Min(Math.floor(0.06 * sr) + 16)
    this.buf = [new Float64Array(n), new Float64Array(n)]
    this.mask = n - 1; this.w = 0
    this.oc = new Float64Array(3); this.os = new Float64Array(3)
    for (let v = 0; v < 3; v++) { this.oc[v] = Math.cos((FX_2PI * v) / 3); this.os[v] = Math.sin((FX_2PI * v) / 3) }
    const mk = (ms, v) => { const s = new FxSmoother(); s.prepare(sr, ms); s.reset(v); return s }
    this.depth = mk(40, 0.4); this.rate = mk(40, fxLg2(0.6)); this.mix = mk(30, 0.35)
  }
  clear() { this.buf[0].fill(0); this.buf[1].fill(0); this.w = 0 }
  setP(p, snap) {
    this.depth.setTarget(fxClamp(p.chDepth, 0, 1)); this.rate.setTarget(fxLg2(fxClamp(p.chRateHz, 0.02, 10))); this.mix.setTarget(fxClamp(p.chMix, 0, 1))
    if (snap) { this.depth.reset(this.depth.tgt); this.rate.reset(this.rate.tgt); this.mix.reset(this.mix.tgt) }
  }
  run(l, r, m) {
    const D = this.depth.advance(m), MX = this.mix.advance(m), th = (FX_2PI * Math.pow(2, this.rate.advance(m))) / this.sr
    const rc = Math.cos(th), rs = Math.sin(th)
    const dBase = 0.014 * this.sr, dDep = (1 + 6 * D) * 0.001 * this.sr
    const dryG = 1 - 0.5 * MX, wetG = 0.7 * MX
    const b0 = this.buf[0], b1 = this.buf[1], mask = this.mask
    let w = this.w
    for (let i = 0; i < m; i++) {
      b0[w] = l[i]; b1[w] = r[i]
      let wl = 0, wr = 0
      for (let v = 0; v < 3; v++) {
        const s = this.os[v]
        wl += fxLeerHermite(b0, mask, w, dBase + dDep * (0.5 + 0.5 * s) + 2)
        wr += fxLeerHermite(b1, mask, w, dBase + dDep * (0.5 - 0.5 * s) + 2)
        const nc = this.oc[v] * rc - this.os[v] * rs, ns = this.os[v] * rc + this.oc[v] * rs
        this.oc[v] = nc; this.os[v] = ns
      }
      l[i] = l[i] * dryG + (wl / 3) * wetG
      r[i] = r[i] * dryG + (wr / 3) * wetG
      w = (w + 1) & mask
    }
    this.w = w
    for (let v = 0; v < 3; v++) { const nrm = 1.5 - 0.5 * (this.oc[v] * this.oc[v] + this.os[v] * this.os[v]); this.oc[v] *= nrm; this.os[v] *= nrm }
  }
}

class FxDelay {
  constructor(sr) {
    this.sr = sr
    const n = fxPow2Min(Math.floor(2.05 * sr) + 8)
    this.buf = [new Float64Array(n), new Float64Array(n)]
    this.mask = n - 1; this.w = 0
    const mk = (ms, v) => { const s = new FxSmoother(); s.prepare(sr, ms); s.reset(v); return s }
    this.time = mk(60, 350); this.fb = mk(30, 0.35); this.tone = mk(30, fxLg2(5000)); this.mix = mk(30, 0.25)
    this.ping = false
    this.st = new Float64Array(6)   // lp[2], hx[2], hy[2]
  }
  clear() { this.buf[0].fill(0); this.buf[1].fill(0); this.w = 0; this.st.fill(0) }
  setTime(ms, snap) { ms = fxClamp(ms, 1, 2000); this.time.setTarget(ms); if (snap) this.time.reset(ms) }
  setP(p, snap) {
    this.ping = !!p.dlPingPong
    this.fb.setTarget(fxClamp(p.dlFeedback, 0, 0.9)); this.tone.setTarget(fxLg2(fxClamp(p.dlToneHz, 200, this.sr * 0.45))); this.mix.setTarget(fxClamp(p.dlMix, 0, 1))
    if (snap) { this.fb.reset(this.fb.tgt); this.tone.reset(this.tone.tgt); this.mix.reset(this.mix.tgt) }
  }
  run(l, r, m) {
    const ms = this.time.advance(m), F = this.fb.advance(m), MX = this.mix.advance(m)
    const d = Math.max(2, ms * 0.001 * this.sr)
    const a = 1 - Math.exp((-FX_2PI * Math.pow(2, this.tone.advance(m))) / this.sr), hr = Math.exp((-FX_2PI * 30) / this.sr)
    const b0 = this.buf[0], b1 = this.buf[1], mask = this.mask, st = this.st
    let w = this.w
    for (let i = 0; i < m; i++) {
      const dl = fxLeerHermite(b0, mask, w, d), dr = fxLeerHermite(b1, mask, w, d)
      st[0] += a * (dl - st[0]); st[1] += a * (dr - st[1])
      let fl = st[0], fr = st[1]
      const ol = fl - st[2] + hr * st[4]; st[2] = fl; st[4] = ol
      const orr = fr - st[3] + hr * st[5]; st[3] = fr; st[5] = orr
      fl = ol; fr = orr
      let wl, wr
      if (this.ping) { wl = 0.5 * (l[i] + r[i]) + F * fr; wr = fl } else { wl = l[i] + F * fl; wr = r[i] + F * fr }
      if (!(Math.abs(wl) < 1e4)) wl = 0
      if (!(Math.abs(wr) < 1e4)) wr = 0
      b0[w] = wl; b1[w] = wr
      w = (w + 1) & mask
      l[i] += MX * dl; r[i] += MX * dr
    }
    this.w = w
  }
}

const FX_RV_MS = [
  [7.9, 11.3, 15.7, 19.1, 23.3, 28.9, 34.1, 41.3],     // plate
  [25.1, 31.7, 39.3, 47.9, 57.1, 67.7, 79.3, 93.1],    // hall
  [5.3, 7.9, 10.7, 13.9, 17.3, 21.1, 25.7, 30.1],      // room
]
const FX_RV_RT = [[0.6, 4.5], [1.5, 10], [0.2, 1.5]]
const FX_RV_SG = [1, 1, -1, 1, -1, -1, 1, -1]

class FxAllpass {
  constructor(n, g) { this.b = new Float64Array(n); this.i = 0; this.g = g }
  clear() { this.b.fill(0); this.i = 0 }
  run(x) { const d = this.b[this.i]; const y = -this.g * x + d; this.b[this.i] = x + this.g * y; if (++this.i >= this.b.length) this.i = 0; return y }
}

class FxReverb {
  constructor(sr) {
    const N = 8
    this.N = N; this.sr = sr
    const n = fxPow2Min(Math.floor(0.2 * sr) + 16)
    this.line = []; this.lw = new Int32Array(N)
    for (let i = 0; i < N; i++) this.line.push(new Float64Array(n))
    this.lmask = n - 1
    const pn = fxPow2Min(Math.floor(0.21 * sr) + 16)
    this.pre = [new Float64Array(pn), new Float64Array(pn)]
    this.pmask = pn - 1; this.pw = 0
    const apMs = [[3.2, 7.9], [3.7, 8.7]]
    this.ap = [0, 1].map((c) => [0, 1].map((s) => new FxAllpass(Math.floor(apMs[c][s] * 0.001 * sr) + 1, 0.62)))
    this.lpS = new Float64Array(N)
    this.oc = new Float64Array(N); this.os = new Float64Array(N); this.ok = new Float64Array(N); this.orr = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const th = (FX_2PI * (0.35 + 0.1 * i)) / sr
      this.ok[i] = Math.cos(th); this.orr[i] = Math.sin(th)
      this.oc[i] = Math.cos((FX_2PI * i) / N); this.os[i] = Math.sin((FX_2PI * i) / N)
    }
    const mk = (ms, v) => { const s = new FxSmoother(); s.prepare(sr, ms); s.reset(v); return s }
    this.size = mk(250, 0.5); this.damp = mk(60, 0.5); this.preMs = mk(60, 20); this.mixS = mk(30, 0.2)
    this.type = 1
    this.len = new Float64Array(N); this.g = new Float64Array(N)
    this.lpa = 0.5; this.inj = 0.3
    this.lastSize = -1; this.lastDamp = -1; this.lastType = -1
    this.modDepth = 0.0003 * sr
    this.o = new Float64Array(N); this.v = new Float64Array(N); this.dOff = new Float64Array(N); this.dStep = new Float64Array(N)
  }
  clear() {
    for (let i = 0; i < this.N; i++) { this.line[i].fill(0); this.lw[i] = 0; this.lpS[i] = 0 }
    this.pre[0].fill(0); this.pre[1].fill(0); this.pw = 0
    for (const a of this.ap) for (const s of a) s.clear()
    this.lastSize = this.lastDamp = -1; this.lastType = -1
  }
  setP(p, snap) {
    const t = fxClamp(p.rvType | 0, 0, 2)
    if (t !== this.type) { this.type = t; this.lastType = -1 }
    this.size.setTarget(fxClamp(p.rvSize, 0, 1)); this.damp.setTarget(fxClamp(p.rvDamping, 0, 1)); this.preMs.setTarget(fxClamp(p.rvPreDelayMs, 0, 200)); this.mixS.setTarget(fxClamp(p.rvMix, 0, 1))
    if (snap) { this.size.reset(this.size.tgt); this.damp.reset(this.damp.tgt); this.preMs.reset(this.preMs.tgt); this.mixS.reset(this.mixS.tgt); this.lastType = -1 }
  }
  tuning(sz, dm) {
    const bm = FX_RV_MS[this.type], [rmn, rmx] = FX_RV_RT[this.type]
    const rt = rmn * Math.pow(rmx / rmn, sz), scale = 0.6 + 0.8 * sz
    let g2 = 0
    for (let i = 0; i < this.N; i++) {
      this.len[i] = Math.max(8, bm[i] * 0.001 * this.sr * scale)
      this.g[i] = Math.pow(10, (-3 * this.len[i]) / (rt * this.sr))
      g2 += this.g[i] * this.g[i]
    }
    g2 /= this.N
    this.inj = fxClamp(Math.sqrt(1 - g2), 0.04, 1) * 0.9
    this.lpa = Math.exp((-FX_2PI * Math.min(16000 * Math.pow(0.08, dm), this.sr * 0.45)) / this.sr)
  }
  run(l, r, m) {
    const N = this.N
    const sz = this.size.advance(m), dm = this.damp.advance(m), pd = this.preMs.advance(m) * 0.001 * this.sr
    if (sz !== this.lastSize || dm !== this.lastDamp || this.type !== this.lastType) { this.lastSize = sz; this.lastDamp = dm; this.lastType = this.type; this.tuning(sz, dm) }
    const mx0 = this.mixS.cur, mx1 = this.mixS.advance(m)
    const invm = 1 / m
    for (let k = 0; k < N; k++) {
      const th = Math.acos(fxClamp(this.ok[k], -1, 1)) * m, cs = Math.cos(th), sn = Math.sin(th)
      const s0 = this.os[k], s1 = s0 * cs + this.oc[k] * sn, c1 = this.oc[k] * cs - s0 * sn
      this.dOff[k] = this.modDepth * s0; this.dStep[k] = this.modDepth * (s1 - s0) * invm
      const nrm = 1.5 - 0.5 * (c1 * c1 + s1 * s1)
      this.oc[k] = c1 * nrm; this.os[k] = s1 * nrm
    }
    const pdl = Math.max(1, pd), o = this.o, v = this.v, lmask = this.lmask, pmask = this.pmask
    for (let i = 0; i < m; i++) {
      this.pre[0][this.pw] = l[i]; this.pre[1][this.pw] = r[i]
      const pl = fxLeerLineal(this.pre[0], pmask, this.pw, pdl), pr = fxLeerLineal(this.pre[1], pmask, this.pw, pdl)
      this.pw = (this.pw + 1) & pmask
      const dl = this.ap[0][1].run(this.ap[0][0].run(pl)), dr = this.ap[1][1].run(this.ap[1][0].run(pr))
      for (let k = 0; k < N; k++) {
        this.dOff[k] += this.dStep[k]
        o[k] = fxLeerLineal(this.line[k], lmask, this.lw[k], Math.max(2, this.len[k] + this.dOff[k]))
        this.lpS[k] = (1 - this.lpa) * o[k] + this.lpa * this.lpS[k]
        v[k] = this.lpS[k] * this.g[k]
      }
      for (let len2 = 1; len2 < N; len2 <<= 1) for (let a = 0; a < N; a += len2 << 1) for (let b = a; b < a + len2; b++) { const x = v[b], y = v[b + len2]; v[b] = x + y; v[b + len2] = x - y }
      for (let k = 0; k < N; k++) {
        let nv = v[k] * 0.35355339059327373 + (k & 1 ? dr : dl) * FX_RV_SG[k] * this.inj
        if (!(Math.abs(nv) < 1e4)) nv = 0
        this.line[k][this.lw[k]] = nv
        this.lw[k] = (this.lw[k] + 1) & lmask
      }
      const wl = 0.5 * (o[0] + o[2] - o[4] + o[6]), wr = 0.5 * (o[1] - o[3] + o[5] + o[7])
      const mo = mx0 + (mx1 - mx0) * ((i + 1) / m)
      l[i] += mo * wl; r[i] += mo * wr
    }
  }
}

class FxOut {
  constructor(sr) {
    this.width = new FxSmoother(); this.gain = new FxSmoother()
    this.width.prepare(sr, 30); this.gain.prepare(sr, 30); this.width.reset(1); this.gain.reset(1)
  }
  clear() {}
  setP(p, snap) {
    this.width.setTarget(fxClamp(p.outWidth, 0, 2)); this.gain.setTarget(Math.pow(10, fxClamp(p.outGainDb, -24, 12) / 20))
    if (snap) { this.width.reset(this.width.tgt); this.gain.reset(this.gain.tgt) }
  }
  run(l, r, m) {
    const w0 = this.width.cur, g0 = this.gain.cur, w1 = this.width.advance(m), g1 = this.gain.advance(m)
    for (let i = 0; i < m; i++) {
      const t = (i + 1) / m, w = w0 + (w1 - w0) * t, g = g0 + (g1 - g0) * t
      const mid = 0.5 * (l[i] + r[i]), side = 0.5 * (l[i] - r[i]) * w
      l[i] = (mid + side) * g; r[i] = (mid - side) * g
    }
  }
}

/** Valores planos por defecto (FxParams de C++: todo apagado). */
function fxParamsPorDefecto() {
  const O = FXR_OFF
  const d = (off) => FXR_PARAMS.find((q) => q.id === FXR_BASE + off).def
  const p = {
    hpfOn: false, hpfHz: d(O.HpfFreq), hpfSlope: 0, lpfOn: false, lpfHz: d(O.LpfFreq), lpfSlope: 0, eqOn: false, eq: [],
    compOn: false, compThreshDb: d(O.CompThresh), compRatio: d(O.CompRatio), compAttackMs: d(O.CompAttack), compReleaseMs: d(O.CompRelease), compKneeDb: d(O.CompKnee), compMakeupDb: 0, compMix: 1,
    satOn: false, satType: 0, satDrive: 0.3, satToneHz: d(O.SatTone), satMix: 1,
    chOn: false, chDepth: 0.4, chRateHz: d(O.ChRate), chMix: 0.35,
    dlOn: false, dlSync: 0, dlTimeMs: d(O.DlTime), dlFeedback: 0.35, dlToneHz: d(O.DlTone), dlMix: 0.25, dlPingPong: false,
    rvOn: false, rvType: 1, rvSize: 0.5, rvDamping: 0.5, rvPreDelayMs: 20, rvMix: 0.2,
    outOn: false, outWidth: 1, outGainDb: 0,
  }
  for (let b = 0; b < FXR_BANDAS; b++) p.eq.push({ hz: d(O.EqBand0 + 3 * b), gainDb: 0, q: d(O.EqBand0 + 3 * b + 2) })
  return p
}

class FxRack {
  constructor(sampleRate) {
    const sr = sampleRate > 0 ? sampleRate : 48000
    this.sr = sr; this.bpm = 120; this.grDb = 0
    this.p = fxParamsPorDefecto()
    this.dirty = true; this.snap = true
    const G = () => new FxGate(sr)
    this.g = { hpf: G(), lpf: G(), eq: G(), comp: G(), sat: G(), ch: G(), dl: G(), rv: G(), out: G() }
    this.hpf = new FxFilter(sr, true); this.lpf = new FxFilter(sr, false); this.eq = new FxEq(sr); this.comp = new FxComp(sr)
    this.sat = new FxSat(sr); this.ch = new FxChorus(sr); this.dl = new FxDelay(sr); this.rv = new FxReverb(sr); this.out = new FxOut(sr)
    this.bl = new Float64Array(FXR_SUB); this.br = new Float64Array(FXR_SUB); this.tl = new Float64Array(FXR_SUB); this.tr = new Float64Array(FXR_SUB)
    this.fallos = 0
    this.apply(true)
    this.snap = true
  }

  /** Limpia estados y colas (los parametros se conservan). */
  reset() {
    for (const b of [this.hpf, this.lpf, this.eq, this.comp, this.sat, this.ch, this.dl, this.rv, this.out]) b.clear()
    for (const k in this.g) this.g[k].s.reset(this.g[k].s.tgt)
    this.snap = true
  }

  setTempo(bpm) { this.bpm = bpm >= 20 && bpm <= 400 ? bpm : 120 }

  /** Valor plano por id absoluto (base + offset). Devuelve true si el id es del rack. */
  setParam(id, v) {
    const off = id - FXR_BASE
    if (!(off >= 0 && off < FXR_RANGO) || !Number.isFinite(v)) return false
    const O = FXR_OFF, p = this.p
    const b = v >= 0.5, i = Math.round(v)
    if (off >= O.EqBand0 && off < O.EqBand0 + 3 * FXR_BANDAS) {
      const k = Math.floor((off - O.EqBand0) / 3), r = (off - O.EqBand0) % 3
      if (r === 0) p.eq[k].hz = v; else if (r === 1) p.eq[k].gainDb = v; else p.eq[k].q = v
    } else {
      switch (off) {
        case O.HpfOn: p.hpfOn = b; break
        case O.HpfFreq: p.hpfHz = v; break
        case O.HpfSlope: p.hpfSlope = i; break
        case O.LpfOn: p.lpfOn = b; break
        case O.LpfFreq: p.lpfHz = v; break
        case O.LpfSlope: p.lpfSlope = i; break
        case O.EqOn: p.eqOn = b; break
        case O.CompOn: p.compOn = b; break
        case O.CompThresh: p.compThreshDb = v; break
        case O.CompRatio: p.compRatio = v; break
        case O.CompAttack: p.compAttackMs = v; break
        case O.CompRelease: p.compReleaseMs = v; break
        case O.CompKnee: p.compKneeDb = v; break
        case O.CompMakeup: p.compMakeupDb = v; break
        case O.CompMix: p.compMix = v / 100; break
        case O.SatOn: p.satOn = b; break
        case O.SatType: p.satType = i; break
        case O.SatDrive: p.satDrive = v / 100; break
        case O.SatTone: p.satToneHz = v; break
        case O.SatMix: p.satMix = v / 100; break
        case O.ChOn: p.chOn = b; break
        case O.ChDepth: p.chDepth = v / 100; break
        case O.ChRate: p.chRateHz = v; break
        case O.ChMix: p.chMix = v / 100; break
        case O.DlOn: p.dlOn = b; break
        case O.DlSync: p.dlSync = i; break
        case O.DlTime: p.dlTimeMs = v; break
        case O.DlFeedback: p.dlFeedback = v / 100; break
        case O.DlTone: p.dlToneHz = v; break
        case O.DlMix: p.dlMix = v / 100; break
        case O.DlPingPong: p.dlPingPong = b; break
        case O.RvOn: p.rvOn = b; break
        case O.RvType: p.rvType = i; break
        case O.RvSize: p.rvSize = v / 100; break
        case O.RvDamping: p.rvDamping = v / 100; break
        case O.RvPreDelay: p.rvPreDelayMs = v; break
        case O.RvMix: p.rvMix = v / 100; break
        case O.OutOn: p.outOn = b; break
        case O.OutWidth: p.outWidth = v / 100; break
        case O.OutGain: p.outGainDb = v; break
        default: return false
      }
    }
    this.dirty = true
    return true
  }

  /** Traslada los valores planos a los bloques (se llama solo cuando hay cambios). */
  apply(forzar) {
    const p = this.p, s = forzar || this.snap, g = this.g
    this.snap = false
    const sn = (gt) => s || !gt.live()
    this.hpf.setP(p.hpfHz, p.hpfSlope, sn(g.hpf)); this.lpf.setP(p.lpfHz, p.lpfSlope, sn(g.lpf))
    this.eq.setP(p.eq, sn(g.eq)); this.comp.setP(p, sn(g.comp)); this.sat.setP(p, sn(g.sat)); this.ch.setP(p, sn(g.ch)); this.dl.setP(p, sn(g.dl))
    this.rv.setP(p, sn(g.rv)); this.out.setP(p, sn(g.out))
    g.hpf.set(p.hpfOn, s); g.lpf.set(p.lpfOn, s); g.eq.set(p.eqOn, s); g.comp.set(p.compOn, s); g.sat.set(p.satOn, s)
    g.ch.set(p.chOn, s); g.dl.set(p.dlOn, s); g.rv.set(p.rvOn, s); g.out.set(p.outOn, s)
    this.dirty = false
    this.updateDelayTime(s)
  }

  updateDelayTime(snap) {
    const fac = [0, 1, 0.5, 0.75, 0.25]
    const sy = fxClamp(this.p.dlSync | 0, 0, 4)
    const ms = sy === 0 ? this.p.dlTimeMs : (60000 / this.bpm) * fac[sy]
    this.dl.setTime(ms, snap || !this.g.dl.live())
  }

  activo() { const g = this.g; return g.hpf.live() || g.lpf.live() || g.eq.live() || g.comp.live() || g.sat.live() || g.ch.live() || g.dl.live() || g.rv.live() || g.out.live() }

  stage(gt, blk, m) {
    const g0 = gt.s.cur, g1 = gt.s.advance(m)
    if (g1 <= 0 && !(gt.s.tgt > 0)) { if (!gt.cleared) { blk.clear(); gt.cleared = true } return }
    gt.cleared = false
    const bl = this.bl, br = this.br
    if (g0 >= 1 && g1 >= 1) { blk.run(bl, br, m); return }
    const tl = this.tl, tr = this.tr
    for (let i = 0; i < m; i++) { tl[i] = bl[i]; tr[i] = br[i] }
    blk.run(tl, tr, m)
    for (let i = 0; i < m; i++) { const t = g0 + (g1 - g0) * ((i + 1) / m); bl[i] += t * (tl[i] - bl[i]); br[i] += t * (tr[i] - br[i]) }
  }

  /** Procesa n muestras estereo in situ a partir de `offset` (sin asignaciones). */
  process(L, R, n, offset = 0) {
    if (n <= 0) return
    if (this.dirty) this.apply(false)
    if (!this.activo()) { this.grDb = 0; return }   // transparente: el buffer no se toca (bit a bit)
    this.updateDelayTime(false)
    this.comp.grMax = 0
    const bl = this.bl, br = this.br, g = this.g
    let pos = 0
    while (pos < n) {
      const m = Math.min(FXR_SUB, n - pos)
      for (let i = 0; i < m; i++) { bl[i] = L[offset + pos + i]; br[i] = R[offset + pos + i] }
      this.stage(g.hpf, this.hpf, m); this.stage(g.lpf, this.lpf, m); this.stage(g.eq, this.eq, m); this.stage(g.comp, this.comp, m); this.stage(g.sat, this.sat, m)
      this.stage(g.ch, this.ch, m); this.stage(g.dl, this.dl, m); this.stage(g.rv, this.rv, m); this.stage(g.out, this.out, m)
      let bad = false
      for (let i = 0; i < m; i++) if (!(Math.abs(bl[i]) < 1e4) || !(Math.abs(br[i]) < 1e4)) { bad = true; break }
      if (bad) { this.fallos++; bl.fill(0, 0, m); br.fill(0, 0, m); for (const b of [this.hpf, this.lpf, this.eq, this.comp, this.sat, this.ch, this.dl, this.rv]) b.clear() }
      for (let i = 0; i < m; i++) { L[offset + pos + i] = bl[i]; R[offset + pos + i] = br[i] }
      pos += m
    }
    this.grDb = this.comp.grMax
  }
}
// fxrack>>
fxRegistrarParametros(PARAMS, PARAM_IDS)   // FX Rack comun: 58 parametros FX · (ids 100..230), ver shared-dsp/web/fxrack.js

const VOCES = 64        // huecos (incluye las que se desvanecen)
const POLIFONIA = 40    // voces simultáneas sin fundido
const MAX_MODOS = 44
const MAX_BANDAS = 4
const CHUNK = 128
const TOPE_ELEMENTO = 6
const PI = Math.PI
const TWO_PI = 2 * Math.PI

// Elementos
const E = {
  KICK: 0, SNARE: 1, RIM: 2, SIDE: 3, TOM0: 4, TOM5: 9, HAT_C: 10, HAT_P: 11, HAT_O: 12, RIDE: 13, RIDE2: 14,
  BELL: 15, CRASH1: 16, CRASH2: 17, SPLASH: 18, CHINA: 19, N: 20,
}
function elementoParaNota(n) {
  switch (n) {
    case 35: case 36: return E.KICK
    case 37: return E.SIDE
    case 38: return E.SNARE
    case 40: return E.RIM
    case 41: return 4; case 43: return 5; case 45: return 6; case 47: return 7; case 48: return 8; case 50: return 9
    case 42: return E.HAT_C
    case 44: return E.HAT_P
    case 46: return E.HAT_O
    case 49: return E.CRASH1
    case 57: return E.CRASH2
    case 55: return E.SPLASH
    case 52: return E.CHINA
    case 51: return E.RIDE
    case 59: return E.RIDE2
    case 53: return E.BELL
    default: return -1
  }
}

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const dbALin = (db) => Math.pow(10, db * 0.05)
const linADb = (l) => (l <= 1e-9 ? -180 : 20 * Math.log10(l))
const velAmp = (v) => Math.max(0.02, Math.pow(v, 1.25))
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x) }

class Rng {
  constructor() { this.s = 0x9E3779B9 | 0 }
  next() { let s = this.s; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.s = s | 0; return s >>> 0 }
  u() { return (this.next() >>> 8) / 16777216 }
  bi() { return (this.next() | 0) / 2147483648 }
  jit(a) { return this.bi() * a }
  seed(a) { this.s = a ? a | 0 : 0x1234567; for (let i = 0; i < 4; i++) this.next() }
}

/** Biquad RBJ (mismos tipos y fórmulas que BiquadCoefs::design de jw_dsp.h). */
function disenar(tipo, sr, freq, gainDb, q, out) {
  freq = clamp(freq, 10, sr * 0.499)
  q = clamp(q, 0.05, 40)
  const w0 = TWO_PI * freq / sr, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * q), A = Math.pow(10, gainDb / 40)
  let b0, b1, b2, a0, a1, a2
  if (tipo === 'hp') { b0 = (1 + cw) * 0.5; b1 = -(1 + cw); b2 = (1 + cw) * 0.5; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha }
  else if (tipo === 'lp') { b0 = (1 - cw) * 0.5; b1 = 1 - cw; b2 = (1 - cw) * 0.5; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha }
  else if (tipo === 'hs') {
    const s2 = 2 * Math.sqrt(A) * alpha
    b0 = A * ((A + 1) + (A - 1) * cw + s2); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s2)
    a0 = (A + 1) - (A - 1) * cw + s2; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s2
  } else { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha }   // 'bp' (0 dB de pico)
  const inv = 1 / a0
  const o = out || {}
  o.b0 = b0 * inv; o.b1 = b1 * inv; o.b2 = b2 * inv; o.a1 = a1 * inv; o.a2 = a2 * inv
  return o
}

class Suavizador {
  constructor() { this.sr = 48000; this.tau = 0.02; this.cur = 0; this.tgt = 0 }
  prepare(sr, ms) { this.sr = sr > 0 ? sr : 48000; this.tau = Math.max(0.1, ms) * 0.001 }
  reset(v) { this.cur = this.tgt = v }
  setTarget(v) { this.tgt = v }
  advance(n) {
    if (this.cur === this.tgt) return this.cur
    const a = 1 - Math.exp(-n / (this.tau * this.sr))
    this.cur += (this.tgt - this.cur) * a
    if (Math.abs(this.tgt - this.cur) < 1e-6 * Math.max(1, Math.abs(this.tgt))) this.cur = this.tgt
    return this.cur
  }
}

// ---------------------------------------------------------------------------------------------
// Platos: especificaciones (idénticas a CymSpec de C++) y tablas de modos
// ---------------------------------------------------------------------------------------------
// n, fmin, fmax, t60lo, t60hi, tilt, pingF, pingA, seed, modeLevel,
// b1type, b1f, b1q, b1a, b1t, b1swell, b2type, b2f, b2q, b2a, b2t, b2swell,
// tickF, tickQ, tickA, tickT, flutterDepth, flutterHz, lowF, lowQ, lowA, lowT, lowSwell
const CYM = [
  { n: 24, fmin: 2400, fmax: 13800, t60lo: 0.14, t60hi: 0.05, tilt: 0.25, pingF: 0, pingA: 0, seed: 11, modeLevel: 0.55, b1type: 1, b1f: 6500, b1q: 0.7, b1a: 0.55, b1t: 0.065, b1swell: 0, b2type: 0, b2f: 9500, b2q: 1.2, b2a: 0.35, b2t: 0.09, b2swell: 0, tickF: 6200, tickQ: 1.0, tickA: 0.45, tickT: 0.0012, flutterDepth: 0, flutterHz: 0, lowF: 3500, lowQ: 0.8, lowA: 0.12, lowT: 0.06, lowSwell: 0 },
  { n: 34, fmin: 400, fmax: 12500, t60lo: 3.6, t60hi: 1.1, tilt: 0.20, pingF: 3300, pingA: 2.0, seed: 23, modeLevel: 0.40, b1type: 0, b1f: 5800, b1q: 0.8, b1a: 0.28, b1t: 1.5, b1swell: 0.004, b2type: 1, b2f: 9000, b2q: 0.7, b2a: 0.14, b2t: 0.9, b2swell: 0, tickF: 5200, tickQ: 1.4, tickA: 0.55, tickT: 0.003, flutterDepth: 0, flutterHz: 0, lowF: 1800, lowQ: 0.9, lowA: 0.22, lowT: 2.2, lowSwell: 0.006 },
  { n: 14, fmin: 620, fmax: 9500, t60lo: 3.0, t60hi: 1.2, tilt: 0.10, pingF: 1900, pingA: 4.0, seed: 31, modeLevel: 0.55, b1type: 0, b1f: 3800, b1q: 1.0, b1a: 0.12, b1t: 0.8, b1swell: 0, b2type: 0, b2f: 3800, b2q: 1.0, b2a: 0.0, b2t: 0.1, b2swell: 0, tickF: 4500, tickQ: 2.0, tickA: 0.50, tickT: 0.002, flutterDepth: 0, flutterHz: 0, lowF: 1500, lowQ: 1.2, lowA: 0.05, lowT: 1.5, lowSwell: 0 },
  { n: 40, fmin: 330, fmax: 14000, t60lo: 3.8, t60hi: 1.6, tilt: 0.18, pingF: 0, pingA: 0, seed: 47, modeLevel: 0.38, b1type: 0, b1f: 3600, b1q: 0.55, b1a: 0.65, b1t: 3.2, b1swell: 0.020, b2type: 1, b2f: 8000, b2q: 0.7, b2a: 0.42, b2t: 2.2, b2swell: 0.012, tickF: 4800, tickQ: 0.8, tickA: 0.50, tickT: 0.004, flutterDepth: 0, flutterHz: 0, lowF: 1300, lowQ: 0.7, lowA: 0.55, lowT: 3.0, lowSwell: 0.030 },
  { n: 36, fmin: 380, fmax: 14500, t60lo: 3.2, t60hi: 1.4, tilt: 0.18, pingF: 0, pingA: 0, seed: 53, modeLevel: 0.38, b1type: 0, b1f: 3900, b1q: 0.55, b1a: 0.65, b1t: 2.6, b1swell: 0.016, b2type: 1, b2f: 8500, b2q: 0.7, b2a: 0.42, b2t: 1.8, b2swell: 0.010, tickF: 5200, tickQ: 0.8, tickA: 0.50, tickT: 0.0035, flutterDepth: 0, flutterHz: 0, lowF: 1500, lowQ: 0.7, lowA: 0.50, lowT: 2.5, lowSwell: 0.025 },
  { n: 26, fmin: 900, fmax: 15000, t60lo: 1.1, t60hi: 0.4, tilt: 0.20, pingF: 0, pingA: 0, seed: 61, modeLevel: 0.45, b1type: 1, b1f: 9000, b1q: 0.7, b1a: 0.50, b1t: 0.6, b1swell: 0.004, b2type: 0, b2f: 6000, b2q: 0.8, b2a: 0.34, b2t: 0.7, b2swell: 0, tickF: 7000, tickQ: 1.0, tickA: 0.50, tickT: 0.002, flutterDepth: 0, flutterHz: 0, lowF: 2600, lowQ: 0.8, lowA: 0.22, lowT: 0.6, lowSwell: 0.004 },
  { n: 38, fmin: 420, fmax: 13500, t60lo: 2.4, t60hi: 1.2, tilt: 0.10, pingF: 0, pingA: 0, seed: 71, modeLevel: 0.40, b1type: 0, b1f: 4200, b1q: 0.6, b1a: 0.70, b1t: 1.9, b1swell: 0.010, b2type: 1, b2f: 7000, b2q: 0.7, b2a: 0.46, b2t: 1.3, b2swell: 0, tickF: 4000, tickQ: 0.8, tickA: 0.60, tickT: 0.004, flutterDepth: 0.28, flutterHz: 13.0, lowF: 1500, lowQ: 0.7, lowA: 0.50, lowT: 1.8, lowSwell: 0.015 },
]
const NOISE_MUL = [1.5, 3.0, 1.0, 2.8, 2.8, 3.6, 2.6]
const TRIM_DB = [0.0, -12.0, -12.6, -3.0, -5.0, -5.5, -4.0, -2.8, -4.9, -4.5, -15.3, -12.9, -16.1, -15.2, -15.7, -15.7, -17.4, -17.4, -19.5, -18.9]
// dry, dryPan, oh, ohPan, room
const RUTA = [
  [0.95, 0.00, 0.22, 0.00, 0.90], [0.90, -0.06, 0.45, -0.10, 0.85], [0.90, -0.06, 0.50, -0.10, 0.90], [0.85, -0.06, 0.40, -0.10, 0.80],
  [0.80, 0.60, 0.50, 0.55, 0.80], [0.80, 0.45, 0.50, 0.40, 0.80], [0.80, 0.20, 0.50, 0.18, 0.80], [0.80, -0.05, 0.50, -0.05, 0.80],
  [0.80, -0.30, 0.50, -0.28, 0.80], [0.80, -0.50, 0.50, -0.45, 0.80],
  [0.28, -0.50, 0.55, -0.55, 0.50], [0.24, -0.50, 0.50, -0.55, 0.45], [0.30, -0.50, 0.60, -0.55, 0.55],
  [0.25, 0.45, 0.80, 0.60, 0.60], [0.25, 0.50, 0.80, 0.65, 0.60], [0.25, 0.45, 0.80, 0.60, 0.60],
  [0.18, -0.40, 0.85, -0.55, 0.70], [0.18, 0.35, 0.85, 0.50, 0.70], [0.18, -0.20, 0.80, -0.25, 0.60], [0.18, 0.65, 0.80, 0.70, 0.65],
]

function construirTablas() {
  const tablas = []
  const r = new Rng()
  for (let s = 0; s < CYM.length; s++) {
    const sp = CYM[s]
    r.seed((Math.imul(sp.seed, 2654435761) + 17) | 0)
    const f = new Float64Array(MAX_MODOS), a = new Float64Array(MAX_MODOS)
    for (let k = 0; k < sp.n; k++) {
      const u = r.u()
      const pos = (k + 0.15 + 0.7 * u) / sp.n
      const fr = sp.fmin * Math.pow(sp.fmax / sp.fmin, pos)
      let am = Math.pow(fr / sp.fmin, -sp.tilt) * (0.35 + 1.2 * r.u())
      if (sp.pingA > 0) { const q = Math.log(fr / sp.pingF) / 0.35; am *= 1 + sp.pingA * Math.exp(-q * q) }
      f[k] = fr; a[k] = am
    }
    tablas.push({ n: sp.n, f, a })
  }
  return tablas
}

// ---------------------------------------------------------------------------------------------
// Voz
// ---------------------------------------------------------------------------------------------
class Banda {
  constructor() { this.reset() }
  reset() {
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0
    this.amp = 0; this.ed = 1; this.dd = 1; this.ea = 0; this.da = 0; this.on = false; this.rng = 1
  }
}

class Voz {
  constructor() {
    this.mc = new Float64Array(MAX_MODOS); this.mr2 = new Float64Array(MAX_MODOS)
    this.my1 = new Float64Array(MAX_MODOS); this.my2 = new Float64Array(MAX_MODOS); this.modeDie = new Float64Array(MAX_MODOS)
    this.b = [new Banda(), new Banda(), new Banda(), new Banda()]
    this.wires = new Banda()
    this.reset()
  }
  reset() {
    this.active = false; this.fading = false; this.el = 0; this.order = 0; this.life = 0; this.age = 0
    this.gain = 1; this.fadeMul = 1
    this.dryL = 0; this.dryR = 0; this.ohL = 0; this.ohR = 0; this.room = 0; this.dL = 0; this.dR = 0
    this.rng = 1
    this.nModes = 0
    this.mc.fill(0); this.mr2.fill(0); this.my1.fill(0); this.my2.fill(0); this.modeDie.fill(0)
    this.osc = false; this.ph = 0; this.fEnd = 50; this.dF = 0; this.pe = 1; this.pDec = 0.999; this.ampO = 0
    this.eO = 1; this.oDec = 0.9999; this.eA = 0; this.aDec = 0.99; this.drive = 0; this.driveNorm = 1
    for (const x of this.b) x.reset()
    this.wiresOn = false; this.wires.reset(); this.fol = 0; this.folGain = 1; this.folA = 0.1; this.folR = 0.001
    this.lfoPh = 0; this.lfoInc = 0; this.lfoDepth = 0
    this.invSr = 1 / 48000
  }
  seedNext() { let s = this.rng; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.rng = s | 0; return (s | 1) | 0 }

  tick() {
    let y = 0
    const n = this.nModes, mc = this.mc, mr2 = this.mr2, my1 = this.my1, my2 = this.my2
    for (let k = 0; k < n; k++) {
      const o = mc[k] * my1[k] - mr2[k] * my2[k]
      my2[k] = my1[k]; my1[k] = o
      y += o
    }
    if (this.osc) {
      const f = this.fEnd + this.dF * this.pe
      this.pe *= this.pDec
      this.ph += f * this.invSr
      if (this.ph >= 1) this.ph -= 1
      let s = Math.sin(TWO_PI * this.ph)
      if (this.drive > 0.01) s = Math.tanh(this.drive * s) * this.driveNorm
      y += s * this.ampO * this.eO * (1 - this.eA)
      this.eO *= this.oDec; this.eA *= this.aDec
    }
    const head = y
    for (let i = 0; i < MAX_BANDAS; i++) {
      const k = this.b[i]
      if (!k.on) continue
      let r = k.rng; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; k.rng = r | 0
      const x = (r | 0) / 2147483648
      const yy = k.b0 * x + k.z1
      k.z1 = k.b1 * x - k.a1 * yy + k.z2
      k.z2 = k.b2 * x - k.a2 * yy
      y += yy * k.amp * k.ed * (1 - k.ea)
      k.ed *= k.dd; k.ea *= k.da
    }
    if (this.wiresOn) {
      const w = this.wires
      const tgt = Math.abs(head) * this.folGain
      this.fol += (tgt - this.fol) * (tgt > this.fol ? this.folA : this.folR)
      const direct = w.amp * w.ed
      w.ed *= w.dd
      let r = w.rng; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; w.rng = r | 0
      const x = (r | 0) / 2147483648
      const yy = w.b0 * x + w.z1
      w.z1 = w.b1 * x - w.a1 * yy + w.z2
      w.z2 = w.b2 * x - w.a2 * yy
      y += yy * (direct + this.fol)
    }
    if (this.lfoDepth > 0) {
      this.lfoPh += this.lfoInc; if (this.lfoPh >= 1) this.lfoPh -= 1
      y *= 1 + this.lfoDepth * Math.sin(TWO_PI * this.lfoPh)
    }
    return y
  }
}

// ---------------------------------------------------------------------------------------------
// Sala: reflexiones tempranas + difusores + FDN de 8 líneas (Hadamard, amortiguación)
// ---------------------------------------------------------------------------------------------
const FDN_MS = [23.3, 29.9, 34.7, 40.3, 47.9, 55.1, 63.7, 71.3]
const AP_MS = [3.2, 2.4, 8.6, 6.3]
const ER_MS = [5.9, 9.4, 13.7, 18.9, 24.6, 31.3, 38.2, 46.1]
const ER_G = [0.60, 0.52, 0.44, 0.38, 0.32, 0.26, 0.2, 0.16]
const IN_SIGN = [1, -1, 1, 1, -1, 1, -1, -1]
class Sala {
  constructor(sr) {
    this.rt60 = 1.9
    this.len = new Int32Array(8); this.p = new Int32Array(8); this.g = new Float64Array(8); this.lp1 = new Float64Array(8)
    this.buf = []
    for (let i = 0; i < 8; i++) {
      this.len[i] = Math.max(8, Math.round(FDN_MS[i] * 0.001 * sr) | 1)
      this.buf.push(new Float64Array(this.len[i]))
      this.g[i] = Math.pow(10, -3 * this.len[i] / (sr * this.rt60))
    }
    this.apLen = new Int32Array(4); this.apP = new Int32Array(4); this.ap = []
    for (let i = 0; i < 4; i++) { this.apLen[i] = Math.max(4, Math.round(AP_MS[i] * 0.001 * sr) | 1); this.ap.push(new Float64Array(this.apLen[i])) }
    this.erLen = Math.floor(0.060 * sr) + 8
    this.er = new Float64Array(this.erLen); this.erP = 0
    this.erD = new Int32Array(8)
    for (let i = 0; i < 8; i++) this.erD[i] = Math.round(ER_MS[i] * 0.001 * sr)
    this.damp = Math.exp(-TWO_PI * 5500 / sr)
    this.hp = disenar('hp', sr, 110, 0, 0.707); this.lpc = disenar('lp', sr, 8500, 0, 0.707)
    this.hz1 = 0; this.hz2 = 0; this.lz1 = 0; this.lz2 = 0
    this.o = new Float64Array(8); this.fb = new Float64Array(8)
    this.outL = 0; this.outR = 0
  }
  maxLoopGain() { let m = 0; for (let i = 0; i < 8; i++) m = Math.max(m, this.g[i]); return m }
  reset() {
    for (const b of this.buf) b.fill(0)
    for (const b of this.ap) b.fill(0)
    this.er.fill(0); this.p.fill(0); this.lp1.fill(0); this.apP.fill(0); this.erP = 0
    this.hz1 = this.hz2 = this.lz1 = this.lz2 = 0
  }
  /** Una muestra mono -> this.outL / this.outR */
  process(inp) {
    const h = this.hp, l = this.lpc
    let yh = h.b0 * inp + this.hz1; this.hz1 = h.b1 * inp - h.a1 * yh + this.hz2; this.hz2 = h.b2 * inp - h.a2 * yh
    let x = l.b0 * yh + this.lz1; this.lz1 = l.b1 * yh - l.a1 * x + this.lz2; this.lz2 = l.b2 * yh - l.a2 * x
    const er = this.er, erLen = this.erLen
    er[this.erP] = x
    let eL = 0, eR = 0
    for (let i = 0; i < 8; i++) {
      let idx = this.erP - this.erD[i]
      if (idx < 0) idx += erLen
      const v = er[idx] * ER_G[i]
      if (i & 1) eR += v; else eL += v
    }
    if (++this.erP >= erLen) this.erP = 0
    for (let i = 0; i < 4; i++) {
      const buf = this.ap[i]
      const d = buf[this.apP[i]]
      const w = x + 0.6 * d
      const y = -0.6 * w + d
      buf[this.apP[i]] = w
      if (++this.apP[i] >= this.apLen[i]) this.apP[i] = 0
      x = y
    }
    const o = this.o, fb = this.fb
    for (let i = 0; i < 8; i++) {
      o[i] = this.buf[i][this.p[i]]
      const dm = (1 - this.damp) * o[i] + this.damp * this.lp1[i]
      this.lp1[i] = dm
      fb[i] = this.g[i] * dm
    }
    for (let hh = 1; hh < 8; hh <<= 1)
      for (let i = 0; i < 8; i += hh << 1)
        for (let j = i; j < i + hh; j++) { const a = fb[j], c = fb[j + hh]; fb[j] = a + c; fb[j + hh] = a - c }
    const kNorm = 0.35355339059327373
    for (let i = 0; i < 8; i++) {
      this.buf[i][this.p[i]] = fb[i] * kNorm + x * IN_SIGN[i] * 0.30
      if (++this.p[i] >= this.len[i]) this.p[i] = 0
    }
    this.outL = eL * 0.5 + 0.32 * (o[0] + o[1] - o[2] - o[3] + o[4] - o[5] + o[6] - o[7])
    this.outR = eR * 0.5 + 0.32 * (o[0] - o[1] + o[2] - o[3] - o[4] + o[5] + o[6] - o[7])
  }
}

// ---------------------------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------------------------
const RING = 256
const OH_MASTER = 0.9
const SYM_TOM = 0.12
const SYM_WIRES = 0.05
const TOM_BASE = [78, 92, 108, 128, 152, 180]
const KICK_RAT = [1.0, 2.03, 4.65], KICK_AMP = [0.16, 0.08, 0.05], KICK_T60 = [0.55, 0.20, 0.07]
const SIDE_F = [410, 780, 1260, 185], SIDE_A = [0.5, 0.35, 0.25, 0.18], SIDE_T = [0.07, 0.05, 0.035, 0.12]
const TOM_RAT = [1.59, 2.14, 2.65, 3.16, 3.65], TOM_AMP = [0.30, 0.20, 0.14, 0.10, 0.07], TOM_TF = [0.55, 0.40, 0.32, 0.26, 0.20]
const SNARE_RATIO = [1.0, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501]

class Motor {
  constructor(sampleRate) {
    this.sr = sampleRate > 0 ? sampleRate : 48000
    const sr = this.sr
    this.tablas = construirTablas()
    this.voces = []
    for (let i = 0; i < VOCES; i++) this.voces.push(new Voz())
    this.p = RANGOS.map((r) => r[2])
    this.s = null
    this.vol = new Suavizador(); this.wet = new Suavizador(); this.air = new Suavizador(); this.roomG = new Suavizador()
    for (const sm of [this.vol, this.wet, this.air, this.roomG]) sm.prepare(sr, 20)
    this.wet.prepare(sr, 8); this.air.prepare(sr, 40); this.roomG.prepare(sr, 30)
    this.ohRingL = new Float64Array(RING); this.ohRingR = new Float64Array(RING)
    this.dryL = new Float64Array(CHUNK); this.dryR = new Float64Array(CHUNK); this.roomIn = new Float64Array(CHUNK)
    this.ohMax = Math.min(100, Math.max(1, Math.round(0.0005 * sr)))
    this.sala = new Sala(sr)
    this.fx = new FxRack(sr)   // FX Rack comun: master de la bateria, DESPUES de toda la cadena propia (sala, compresion, soft-clip)
    this.dcR = 1 - TWO_PI * 15 / sr
    this.symC = new Float64Array(6); this.symG = new Float64Array(6); this.symY1 = new Float64Array(6); this.symY2 = new Float64Array(6)
    this.symR2 = 0; this.symRng = 0xA5A5A5A5 | 0
    this.ohHp = {}; this.ohSh = {}; this.symWc = {}; this._c = {}; this.lastAir = -99
    this._mt = { t: 0 }; this._rng = new Rng(); this._ak = new Float64Array(MAX_MODOS); this._fk = new Float64Array(MAX_MODOS)
    this.bend = 0; this.bendMul = 1
    this.hitCount = 0; this.orderCtr = 0; this.sampleCtr = 0
    this.hatFoot = 1
    this._aplicar()
    this.vol.reset(dbALin(this.s.volumeDb)); this.wet.reset(this.s.bypass ? 0 : 1)
    this.air.reset(this._airDb(this.s.air)); this.roomG.reset(this._roomGain(this.s.roomBlend))
    this._disenarBuses(true)
    this._disenarSimpatia()
    this.panic()
  }

  static get RANGOS() { return RANGOS }
  static get PARAMS() { return P }
  static get POLIFONIA() { return POLIFONIA }
  static elementoParaNota(n) { return elementoParaNota(n) }

  _airDb(a) { return -2 + 8 * a }
  _roomGain(b) { return 1.25 * Math.pow(b, 1.3) }

  /** Aplica los parámetros planos (equivale a updateParams() del VST3). */
  _aplicar() {
    const p = this.p
    const prev = this.s
    const s = {
      kickTuneHz: p[0], snareSnap: p[1] / 100, tomsDamp: p[2] / 100, air: p[3] / 100, roomBlend: p[4] / 100,
      roomComp: p[7] / 100, shellsDb: p[8], cymbalDb: p[9], hatFoot: p[10] / 100, volumeDb: p[6], bypass: p[5] >= 0.5,
    }
    this.s = s
    this.hatFoot = s.hatFoot
    this.vol.setTarget(dbALin(s.volumeDb)); this.wet.setTarget(s.bypass ? 0 : 1)
    this.air.setTarget(this._airDb(s.air)); this.roomG.setTarget(this._roomGain(s.roomBlend))
    this.shellsLin = dbALin(s.shellsDb); this.cymLin = dbALin(s.cymbalDb)
    this.compThr = -30 - 0.18 * s.roomComp * 100
    this.compThrLin = dbALin(this.compThr)
    this.compRatio = 1.5 + 4 * s.roomComp
    this.compMakeup = dbALin(6 * s.roomComp)
    if (prev && Math.abs(prev.tomsDamp - s.tomsDamp) > 1e-9) this._disenarSimpatia()
  }

  /** Tempo del anfitrion (bpm) para la sincronia del delay del rack. */
  setTempo(bpm) { this.fx.setTempo(bpm) }

  setParam(id, valor) {
    id = id | 0
    if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { this.fx.setParam(id, valor); return }
    if (id < 0 || id >= RANGOS.length || !Number.isFinite(valor)) return
    const r = RANGOS[id]
    this.p[id] = id === 5 ? (valor >= 0.5 ? 1 : 0) : clamp(valor, r[0], r[1])
    this._aplicar()
  }
  pitchBend(semitonos) { this.bend = clamp(semitonos, -12, 12); this.bendMul = Math.pow(2, this.bend / 12) }
  cc(num, valor) {
    if (num === 4) { this.hatFoot = clamp(valor / 127, 0, 1); this.s.hatFoot = this.hatFoot }
    else if (num === 120 || num === 123) this.allNotesOff()
  }
  noteOff() {}   // percusión: un golpe no depende del note-off
  panic() {
    for (const v of this.voces) v.active = false
    this.sala.reset()
    this.ohRingL.fill(0); this.ohRingR.fill(0)
    this.ohHpL1 = this.ohHpL2 = this.ohHpR1 = this.ohHpR2 = 0
    this.ohShL1 = this.ohShL2 = this.ohShR1 = this.ohShR2 = 0
    this.symY1.fill(0); this.symY2.fill(0); this.symLp = 0; this.symFol = 0; this.symW1 = 0; this.symW2 = 0
    this.dcX0 = this.dcX1 = this.dcY0 = this.dcY1 = 0
    this.compEnv = 0; this.compGain = 1; this.compGr = 0
    this.ohPos = 0
  }
  allNotesOff() { for (const v of this.voces) if (v.active && !v.fading) this._fade(v, 0.030, 80) }
  vocesActivas() { let n = 0; for (const v of this.voces) if (v.active) n++; return n }

  _fadeMul(sec, db) { return Math.exp(Math.log(Math.pow(10, -db / 20)) / (Math.max(1e-4, sec) * this.sr)) }
  _fade(v, sec, db) {
    const mul = this._fadeMul(sec, db)
    if (!v.fading || mul < v.fadeMul) v.fadeMul = mul
    v.fading = true
  }

  noteOn(nota, vel) {
    const el = elementoParaNota(nota | 0)
    if (el < 0 || !(vel > 0)) return
    vel = clamp(vel, 0, 1)
    const voces = this.voces
    if (el === E.HAT_C || el === E.HAT_P) {
      for (const v of voces) if (v.active && !v.fading) {
        if (v.el === E.HAT_O) this._fade(v, 0.012, 80)
        else if (el === E.HAT_P && v.el === E.HAT_C) this._fade(v, 0.015, 80)
      }
    }
    let chokeRing = 1
    if (el === E.HAT_O || el === E.CRASH1 || el === E.CRASH2 || el === E.SPLASH || el === E.CHINA) {
      const fs = el === E.HAT_O ? 0.090 : el === E.SPLASH ? 0.120 : 0.220
      for (const v of voces) if (v.active && !v.fading && v.el === el) {
        if (el !== E.HAT_O && v.life > 0) chokeRing = 0.78   // plato todavía sonando: golpe "ahogado"
        this._fade(v, fs, 80)
      }
    }
    let perEl = 0, total = 0, oldestEl = null, oldestAll = null
    for (const v of voces) {
      if (!v.active || v.fading) continue
      total++
      if (v.el === el) { perEl++; if (!oldestEl || v.order < oldestEl.order) oldestEl = v }
      if (!oldestAll || v.order < oldestAll.order) oldestAll = v
    }
    if (perEl >= TOPE_ELEMENTO && oldestEl) { this._fade(oldestEl, 0.060, 80); total-- }
    else if (total >= POLIFONIA && oldestAll) { this._fade(oldestAll, 0.005, 80); total-- }
    let slot = null
    for (const v of voces) if (!v.active) { slot = v; break }
    if (!slot) {
      let best = 1e30
      for (const v of voces) if (v.fading && v.gain < best) { best = v.gain; slot = v }
      if (!slot) slot = voces[0]
    }
    this._start(slot, el, nota | 0, vel, chokeRing)
  }

  // ---------------- construcción de voces ----------------
  _setMode(v, f, a, t60, fase) {
    const sr = this.sr
    if (v.nModes >= MAX_MODOS || f >= 0.45 * sr || f <= 5 || Math.abs(a) < 1e-4) return
    t60 = Math.max(1e-3, t60)
    const r = Math.pow(10, -3 / (t60 * sr))
    const w = TWO_PI * f / sr
    const k = v.nModes
    v.mc[k] = 2 * r * Math.cos(w)
    v.mr2[k] = r * r
    v.my1[k] = a * Math.sin(fase - w) / r
    v.my2[k] = a * Math.sin(fase - 2 * w) / (r * r)
    v.modeDie[k] = Math.trunc(Math.log(Math.abs(a) / 1e-4) * t60 * sr / 6.907755278982137) + 1
    v.nModes++
  }
  _sortModes(v) {
    for (let i = 1; i < v.nModes; i++) {
      const c = v.mc[i], r2 = v.mr2[i], y1 = v.my1[i], y2 = v.my2[i], dk = v.modeDie[i]
      let j = i - 1
      while (j >= 0 && v.modeDie[j] < dk) {
        v.mc[j + 1] = v.mc[j]; v.mr2[j + 1] = v.mr2[j]; v.my1[j + 1] = v.my1[j]; v.my2[j + 1] = v.my2[j]; v.modeDie[j + 1] = v.modeDie[j]; j--
      }
      v.mc[j + 1] = c; v.mr2[j + 1] = r2; v.my1[j + 1] = y1; v.my2[j + 1] = y2; v.modeDie[j + 1] = dk
    }
  }
  _setBand(v, i, tipo, f, q, amp, tau, swell) {
    const b = v.b[i], c = disenar(tipo === 1 ? 'hp' : 'bp', this.sr, f, 0, q, this._c)
    b.b0 = c.b0; b.b1 = c.b1; b.b2 = c.b2; b.a1 = c.a1; b.a2 = c.a2; b.z1 = b.z2 = 0
    b.amp = amp; b.ed = 1; b.dd = Math.exp(-1 / (Math.max(1e-4, tau) * this.sr))
    if (swell > 0) { b.ea = 1; b.da = Math.exp(-1 / (swell * this.sr)) } else { b.ea = 0; b.da = 0 }
    b.on = amp > 1e-6
    b.rng = v.seedNext()
  }

  _ruta(v, el, nivel) {
    nivel *= Math.pow(10, TRIM_DB[el] / 20)
    const r = RUTA[el]
    const a = (r[1] + 1) * PI * 0.25
    v.dryL = Math.cos(a) * r[0] * nivel; v.dryR = Math.sin(a) * r[0] * nivel
    const b = (r[3] + 1) * PI * 0.25
    v.ohL = Math.cos(b) * r[2] * nivel; v.ohR = Math.sin(b) * r[2] * nivel
    v.dL = Math.round((1 + r[3]) * 0.5 * this.ohMax)
    v.dR = Math.round((1 - r[3]) * 0.5 * this.ohMax)
    v.room = r[4] * nivel
  }

  _start(v, el, nota, vel, chokeRing) {
    v.reset()
    v.invSr = 1 / this.sr
    v.active = true; v.el = el; v.order = this.orderCtr++
    const r = this._rng
    r.seed((0x9E3779B9 ^ Math.imul(nota, 7919) ^ Math.imul(Math.floor(vel * 1000), 104729) ^ Math.imul(this.hitCount++, 2654435761)) | 0)
    v.rng = (r.next() | 1) | 0
    const mt = this._mt; mt.t = 0.05
    this._ruta(v, el, 1)
    v.gain = el <= E.TOM5 ? this.shellsLin : this.cymLin
    if (el === E.KICK) this._kick(v, r, vel, nota === 35, mt)
    else if (el === E.SNARE || el === E.RIM) this._snare(v, r, vel, el === E.RIM, mt)
    else if (el === E.SIDE) this._side(v, r, vel, mt)
    else if (el <= E.TOM5) this._tom(v, r, vel, el - E.TOM0, mt)
    else this._cymbal(v, r, el, vel, chokeRing, mt)
    this._sortModes(v)
    v.life = Math.trunc(Math.min(10, mt.t) * this.sr)
  }

  _kick(v, r, vel, ac35, mt) {
    const sr = this.sr, va = velAmp(vel)
    const fEnd = this.s.kickTuneHz * this.bendMul * (1 + r.jit(0.004)) * (ac35 ? 0.96 : 1)
    const fStart = fEnd * (1.9 + 1.7 * vel)
    const pTau = (0.020 + 0.008 * (1 - vel)) * (1 + r.jit(0.1))
    const oTau = 0.125 * Math.pow(55 / fEnd, 0.4) * (0.8 + 0.3 * vel) * (1 + r.jit(0.08)) * (ac35 ? 1.1 : 1)
    v.osc = true; v.ph = 0; v.fEnd = fEnd; v.dF = fStart - fEnd; v.pe = 1
    v.pDec = Math.exp(-1 / (pTau * sr))
    v.eO = 1; v.oDec = Math.exp(-1 / (oTau * sr))
    v.eA = 1; v.aDec = Math.exp(-1 / (0.0010 * sr))
    v.ampO = 0.78 * va
    v.drive = 0.4 + 2.2 * vel; v.driveNorm = 1 / Math.tanh(v.drive)
    mt.t = Math.max(mt.t, oTau * 11.5)
    const ratios = KICK_RAT, amps = KICK_AMP, t60 = KICK_T60
    for (let k = 0; k < 3; k++) {
      const t = t60[k] * (1 + r.jit(0.08))
      this._setMode(v, fEnd * ratios[k] * (1 + r.jit(0.003)), amps[k] * va * Math.exp(r.jit(0.12)), t, r.u() * 0.4)
      mt.t = Math.max(mt.t, t * 1.67)
    }
    this._setBand(v, 0, 0, (2200 + 2800 * vel) * (1 + r.jit(0.06)), 1.1, va * (0.02 + 0.45 * Math.pow(vel, 1.6)) * (ac35 ? 0.7 : 1), 0.0028 * (1 + r.jit(0.1)), 0)
    this._setBand(v, 1, 0, 900, 0.9, va * 0.09 * vel, 0.009, 0)
  }

  _snare(v, r, vel, rim, mt) {
    const sr = this.sr, va = velAmp(vel)
    const f0 = 185 * this.bendMul * (1 + r.jit(0.004)) * (1 + 0.012 * vel)
    const ghost = 0.55 + 0.45 * smooth01(vel / 0.4)
    const t601 = (0.16 + 0.12 * vel) * ghost
    const tilt = (1.7 - 1.0 * vel) + r.jit(0.12)
    for (let k = 0; k < 8; k++) {
      const a = Math.pow(SNARE_RATIO[k], -tilt) * Math.exp(r.jit(0.25)) * 0.85 * va
      const t = t601 / (1 + 0.8 * (SNARE_RATIO[k] - 1)) * (1 + r.jit(0.08))
      this._setMode(v, f0 * SNARE_RATIO[k] * (1 + r.jit(0.0025)), a, t, r.u() * 0.5)
      mt.t = Math.max(mt.t, t * 1.67)
    }
    this._setBand(v, 0, 1, (1800 + 4200 * vel) * (1 + r.jit(0.06)), 0.7, va * (0.04 + 0.34 * Math.pow(vel, 1.2)), 0.0022 * (1 + r.jit(0.1)), 0)
    const rimAmt = rim ? 1 : 0.55 * smooth01((vel - 0.80) / 0.20)
    if (rimAmt > 0.01) {
      this._setMode(v, 1020 * (1 + r.jit(0.01)), 0.30 * rimAmt * va, 0.03, r.u() * 0.5)
      this._setMode(v, 2380 * (1 + r.jit(0.01)), 0.20 * rimAmt * va, 0.02, r.u() * 0.5)
      this._setBand(v, 1, 0, 3100 * (1 + r.jit(0.04)), 3.0, 0.5 * rimAmt * va, 0.004, 0)
    }
    const snap = this.s.snareSnap
    const wd = 0.13 + 0.06 * vel
    const c = disenar('bp', sr, 4300 * (1 + r.jit(0.03)), 0, 0.5, this._c)
    v.wiresOn = true
    v.wires.rng = v.seedNext()
    v.wires.b0 = c.b0; v.wires.b1 = c.b1; v.wires.b2 = c.b2; v.wires.a1 = c.a1; v.wires.a2 = c.a2
    v.wires.amp = va * (0.08 + 0.28 * snap) * 0.5; v.wires.ed = 1; v.wires.dd = Math.exp(-1 / (wd * sr))
    v.folGain = (0.15 + 0.55 * snap) * (0.45 + 0.65 * vel)
    v.folA = 1 - Math.exp(-1 / (0.0003 * sr)); v.folR = 1 - Math.exp(-1 / (0.025 * sr))
    mt.t = Math.max(mt.t, t601 * 1.67 + 0.1, wd * 11.5)
  }

  _side(v, r, vel, mt) {
    const va = velAmp(vel) * 0.8
    const fq = SIDE_F, am = SIDE_A, t6 = SIDE_T
    for (let k = 0; k < 4; k++) {
      const t = t6[k] * (1 + r.jit(0.1))
      this._setMode(v, fq[k] * this.bendMul * (1 + r.jit(0.01)), am[k] * va * Math.exp(r.jit(0.15)), t, r.u() * 0.6)
      mt.t = Math.max(mt.t, t * 1.67)
    }
    this._setBand(v, 0, 0, 2000 * (1 + r.jit(0.05)), 2.0, 0.35 * va, 0.0018, 0)
  }

  _tom(v, r, vel, idx, mt) {
    const sr = this.sr, va = velAmp(vel)
    const f = TOM_BASE[idx] * this.bendMul * (1 + r.jit(0.004)) * (1 + 0.02 * vel)
    const t60 = 1.5 * Math.pow(0.12, this.s.tomsDamp) * (0.8 + 0.4 * vel) * (1 + r.jit(0.08))
    v.osc = true; v.ph = 0; v.fEnd = f; v.dF = f * (0.12 + 0.14 * vel); v.pe = 1
    v.pDec = Math.exp(-1 / (0.05 * sr))
    v.eO = 1; v.oDec = Math.exp(-6.907755278982137 / (Math.max(1e-4, t60) * sr))
    v.eA = 1; v.aDec = Math.exp(-1 / (0.0009 * sr))
    v.ampO = 0.7 * va; v.drive = 0.6 * vel; v.driveNorm = v.drive > 0.01 ? 1 / Math.tanh(v.drive) : 1
    mt.t = Math.max(mt.t, t60 * 1.67)
    const rat = TOM_RAT, amp = TOM_AMP, tf = TOM_TF
    for (let k = 0; k < 5; k++)
      this._setMode(v, f * rat[k] * (1 + r.jit(0.003)), amp[k] * va * Math.pow(rat[k], -(0.4 - 0.4 * vel)) * Math.exp(r.jit(0.2)), t60 * tf[k], r.u() * 0.6)
    this._setBand(v, 0, 1, (1400 + 3200 * vel) * (1 + r.jit(0.06)), 0.7, va * (0.02 + 0.30 * Math.pow(vel, 1.5)), 0.0025, 0)
    this._setBand(v, 1, 0, 2.2 * f, 2.0, va * 0.12, 0.02, 0)
  }

  _cymbal(v, r, el, vel, chokeRing, mt) {
    const sr = this.sr, va = velAmp(vel)
    let si = 0, fscale = 1, tscale = 1, amp = 1, openness = 0
    switch (el) {
      case E.HAT_C: case E.HAT_P: case E.HAT_O: si = 0; break
      case E.RIDE: si = 1; break
      case E.RIDE2: si = 1; fscale = 0.93; tscale = 0.85; amp = 0.95; break
      case E.BELL: si = 2; break
      case E.CRASH1: si = 3; break
      case E.CRASH2: si = 4; break
      case E.SPLASH: si = 5; break
      default: si = 6; break
    }
    const sp = CYM[si], tb = this.tablas[si]
    let hatMult = 1
    if (si === 0) {
      if (el === E.HAT_O) openness = 1
      else if (el === E.HAT_C) openness = clamp((1 - this.s.hatFoot) * 0.8 + 0.08 * vel, 0, 0.9)
      else { openness = 0; amp = 0.55 }
      hatMult = 1 + 14 * openness
      tscale = hatMult * (0.85 + 0.3 * vel)
    } else tscale *= (0.8 + 0.4 * vel) * chokeRing
    let sumsq = 0, nk = 0
    const ak = this._ak, fk = this._fk
    for (let k = 0; k < tb.n; k++) {
      const f = tb.f[k] * fscale * (1 + r.jit(0.0025))
      fk[k] = f
      if (f >= 0.45 * sr) { ak[k] = 0; continue }
      const a = tb.a[k] * Math.pow(f / 2000, (si === 0 ? 1.3 : 0.5) * (vel - 0.4)) * Math.exp(r.jit(0.3))
      ak[k] = a; sumsq += a * a; nk = k + 1
    }
    const norm = amp * sp.modeLevel * va / Math.sqrt(Math.max(sumsq, 1e-9)) * 2.2
    for (let k = 0; k < nk; k++) {
      if (ak[k] === 0) continue
      const pos = Math.log(tb.f[k] / sp.fmin) / Math.log(sp.fmax / sp.fmin)
      const t60 = sp.t60lo * Math.pow(sp.t60hi / sp.t60lo, clamp(pos, 0, 1)) * tscale * (1 + r.jit(0.1))
      this._setMode(v, fk[k], ak[k] * norm, t60, r.u() * TWO_PI)
      mt.t = Math.max(mt.t, t60 * 1.67)
    }
    const nm = NOISE_MUL[si]
    const ts = si === 0 ? Math.pow(hatMult, 0.9) : tscale
    const b1t = sp.b1t * ts / 6.9, b2t = sp.b2t * ts / 6.9
    const lv = va * amp * (0.7 + 0.6 * vel)
    this._setBand(v, 0, sp.b1type, sp.b1f * (1 + r.jit(0.03)), sp.b1q, sp.b1a * nm * lv, b1t, sp.b1swell)
    this._setBand(v, 1, sp.b2type, sp.b2f * (1 + r.jit(0.03)), sp.b2q, sp.b2a * nm * lv, b2t, sp.b2swell)
    this._setBand(v, 2, 0, sp.tickF * (1 + r.jit(0.05)), sp.tickQ, sp.tickA * va * amp * (0.4 + 0.8 * vel), sp.tickT * (1 + r.jit(0.1)), 0)
    if (sp.lowA > 0) {
      const lt = sp.lowT * ts / 6.9
      this._setBand(v, 3, 0, sp.lowF * (1 + r.jit(0.04)), sp.lowQ, sp.lowA * nm * lv, lt, sp.lowSwell)
      mt.t = Math.max(mt.t, lt * 11.5 + sp.lowSwell)
    }
    mt.t = Math.max(mt.t, b1t * 11.5 + sp.b1swell, b2t * 11.5 + sp.b2swell)
    if (el === E.HAT_P) this._setBand(v, 2, 0, 700, 1.0, 0.35 * va, 0.012, 0)
    if (sp.flutterDepth > 0) { v.lfoDepth = sp.flutterDepth; v.lfoInc = sp.flutterHz * (1 + r.jit(0.15)) / sr; v.lfoPh = r.u() }
  }

  // ---------------- buses ----------------
  _disenarBuses(force) {
    const a = this.air.cur
    if (!force && Math.abs(a - this.lastAir) < 1e-4) return
    this.lastAir = a
    this.ohHp = disenar('hp', this.sr, 80, 0, 0.707, this.ohHp)
    this.ohSh = disenar('hs', this.sr, 7500, a, 0.6, this.ohSh)
  }
  _disenarSimpatia() {
    const sr = this.sr
    const t60 = 1.2 * Math.pow(0.12, this.s.tomsDamp) + 0.05
    const rr = Math.pow(10, -3 / (t60 * sr))
    for (let i = 0; i < 6; i++) {
      const w = TWO_PI * TOM_BASE[i] / sr
      this.symC[i] = 2 * rr * Math.cos(w); this.symR2 = rr * rr; this.symG[i] = (1 - rr) * 2 * Math.sin(w) * SYM_TOM
    }
    this.symLpA = 1 - Math.exp(-TWO_PI * 300 / sr)
    this.symFolA = 1 - Math.exp(-1 / (0.002 * sr)); this.symFolR = 1 - Math.exp(-1 / (0.150 * sr))
    this.symWc = disenar('bp', sr, 4300, 0, 0.5, this.symWc)
    this.compA = Math.exp(-1 / (0.002 * sr)); this.compR = Math.exp(-1 / (0.140 * sr))
  }

  /** Rellena outL/outR (sobrescribe) con n muestras. */
  render(outL, outR, n) {
    for (let off = 0; off < n; off += CHUNK) this._chunk(outL, outR, off, Math.min(CHUNK, n - off))
    this.fx.process(outL, outR, n, 0)   // rack FX comun al final de la cadena (con todo apagado no toca el buffer)
  }

  _chunk(outL, outR, off, n) {
    const dryL = this.dryL, dryR = this.dryR, roomIn = this.roomIn, ringL = this.ohRingL, ringR = this.ohRingR
    for (let i = 0; i < n; i++) { dryL[i] = 0; dryR[i] = 0; roomIn[i] = 0 }
    const mask = RING - 1, ohPos = this.ohPos
    for (const v of this.voces) {
      if (!v.active) continue
      for (let i = 0; i < n; i++) {
        let s = v.tick()
        if (v.fading) {
          v.gain *= v.fadeMul
          if (v.gain < 1e-5) { v.active = false; break }
        }
        s *= v.gain
        dryL[i] += s * v.dryL; dryR[i] += s * v.dryR
        ringL[(ohPos + i + v.dL) & mask] += s * v.ohL
        ringR[(ohPos + i + v.dR) & mask] += s * v.ohR
        roomIn[i] += s * v.room
      }
      v.life -= n; v.age += n
      while (v.nModes > 0 && v.modeDie[v.nModes - 1] <= v.age) { v.nModes--; v.mc[v.nModes] = v.mr2[v.nModes] = v.my1[v.nModes] = v.my2[v.nModes] = 0 }
      for (let bi = 0; bi < MAX_BANDAS; bi++) { const b = v.b[bi]; if (b.on && b.amp * b.ed < 1e-6) b.on = false }
      if (v.life <= 0) v.active = false
    }
    this.air.advance(n)
    this._disenarBuses(false)
    const rg0 = this.roomG.cur, rg1 = this.roomG.advance(n)
    const vg0 = this.vol.cur, vg1 = this.vol.advance(n), w0 = this.wet.cur, w1 = this.wet.advance(n)
    const hp = this.ohHp, sh = this.ohSh, sala = this.sala, sw = this.symWc
    for (let i = 0; i < n; i++) {
      const ri = (ohPos + i) & mask
      let oL = ringL[ri], oR = ringR[ri]
      ringL[ri] = 0; ringR[ri] = 0
      // overheads: paso alto 80 Hz + shelf de aire
      let y = hp.b0 * oL + this.ohHpL1; this.ohHpL1 = hp.b1 * oL - hp.a1 * y + this.ohHpL2; this.ohHpL2 = hp.b2 * oL - hp.a2 * y; oL = y
      y = sh.b0 * oL + this.ohShL1; this.ohShL1 = sh.b1 * oL - sh.a1 * y + this.ohShL2; this.ohShL2 = sh.b2 * oL - sh.a2 * y; oL = y
      y = hp.b0 * oR + this.ohHpR1; this.ohHpR1 = hp.b1 * oR - hp.a1 * y + this.ohHpR2; this.ohHpR2 = hp.b2 * oR - hp.a2 * y; oR = y
      y = sh.b0 * oR + this.ohShR1; this.ohShR1 = sh.b1 * oR - sh.a1 * y + this.ohShR2; this.ohShR2 = sh.b2 * oR - sh.a2 * y; oR = y
      let dl = dryL[i], dr = dryR[i]
      // simpatía
      const x = 0.5 * (dl + dr)
      let sym = 0
      for (let k = 0; k < 6; k++) {
        const o = this.symC[k] * this.symY1[k] - this.symR2 * this.symY2[k] + this.symG[k] * x
        this.symY2[k] = this.symY1[k]; this.symY1[k] = o
        sym += o
      }
      this.symLp += this.symLpA * (x - this.symLp)
      const ax = Math.abs(this.symLp)
      this.symFol += (ax - this.symFol) * (ax > this.symFol ? this.symFolA : this.symFolR)
      let rg = this.symRng; rg ^= rg << 13; rg ^= rg >>> 17; rg ^= rg << 5; this.symRng = rg | 0
      const nz = (rg | 0) / 2147483648
      const wn = sw.b0 * nz + this.symW1; this.symW1 = sw.b1 * nz - sw.a1 * wn + this.symW2; this.symW2 = sw.b2 * nz - sw.a2 * wn
      sym += wn * this.symFol * SYM_WIRES
      dl += sym; dr += sym
      // sala + compresión suave
      sala.process(roomIn[i] * 0.5)
      const rl = sala.outL, rr = sala.outR
      const det = Math.max(Math.abs(rl), Math.abs(rr))
      this.compEnv = det > this.compEnv ? det + this.compA * (this.compEnv - det) : det + this.compR * (this.compEnv - det)
      if (((this.sampleCtr + i) & 3) === 0) {
        let grDb = 0
        if (this.compEnv > this.compThrLin) grDb = (linADb(this.compEnv) - this.compThr) * (1 - 1 / this.compRatio)
        this.compGr = grDb
        this.compGain = (grDb > 0 ? dbALin(-grDb) : 1) * this.compMakeup
      }
      const t = (i + 1) / n
      const rgain = rg0 + (rg1 - rg0) * t
      const g = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t)
      const L = (dl + oL * OH_MASTER + rl * this.compGain * rgain) * g
      const R = (dr + oR * OH_MASTER + rr * this.compGain * rgain) * g
      const yl = L - this.dcX0 + this.dcR * this.dcY0; this.dcX0 = L; this.dcY0 = yl
      const yr = R - this.dcX1 + this.dcR * this.dcY1; this.dcX1 = R; this.dcY1 = yr
      outL[off + i] = softClip(yl)
      outR[off + i] = softClip(yr)
    }
    this.ohPos = (ohPos + n) & mask
    this.sampleCtr += n
  }
}

function softClip(x) {
  const a = Math.abs(x)
  if (a <= 0.7) return x
  const y = 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28)   // asíntota 0.98
  return x < 0 ? -y : y
}

// ---------------------------------------------------------------------------------------------
// AudioWorklet
// ---------------------------------------------------------------------------------------------
if (typeof registerProcessor !== 'undefined') {
  registerProcessor('jaswave-worship-drums', class extends AudioWorkletProcessor {
    constructor() {
      super()
      this.motor = new Motor(sampleRate)
      this.cola = []   // eventos {tipo, nota, vel, cuando} ordenados por `cuando`
      this.bufL = new Float32Array(128)
      this.bufR = new Float32Array(128)
      this.port.onmessage = (e) => {
        const m = e.data
        if (!m) return
        if (m.tipo === 'param') this.motor.setParam(m.id, m.valor)
        else if (m.tipo === 'panico') { this.cola.length = 0; this.motor.panic() }
        else if (m.tipo === 'bend') this.motor.pitchBend(m.valor)
        else if (m.tipo === 'cc') this.motor.cc(m.num, m.valor)
        else if (m.tipo === 'tempo') this.motor.setTempo(m.bpm)
        else if (m.tipo === 'on' || m.tipo === 'off') {
          const ev = { tipo: m.tipo, nota: m.nota, vel: m.vel > 1 ? m.vel / 127 : m.vel, cuando: typeof m.cuando === 'number' ? m.cuando : 0 }
          let i = this.cola.length
          while (i > 0 && this.cola[i - 1].cuando > ev.cuando) i--
          this.cola.splice(i, 0, ev)
        }
      }
    }
    process(_entradas, salidas) {
      const out = salidas[0]
      if (!out || !out[0]) return true
      const n = out[0].length
      if (this.bufL.length < n) { this.bufL = new Float32Array(n); this.bufR = new Float32Array(n) }
      const L = this.bufL, R = this.bufR
      let pos = 0
      const t0 = currentTime, sr = sampleRate
      while (this.cola.length) {
        const ev = this.cola[0]
        const off = Math.round((ev.cuando - t0) * sr)
        if (off >= n) break
        this.cola.shift()
        const at = off < 0 ? 0 : off
        if (at > pos) { this.motor.render(L.subarray(pos, at), R.subarray(pos, at), at - pos); pos = at }
        if (ev.tipo === 'on') this.motor.noteOn(ev.nota, ev.vel)
        else this.motor.noteOff(ev.nota)
      }
      if (pos < n) this.motor.render(L.subarray(pos, n), R.subarray(pos, n), n - pos)
      if (out.length >= 2) { out[0].set(L.subarray(0, n)); out[1].set(R.subarray(0, n)) }
      else for (let i = 0; i < n; i++) out[0][i] = 0.5 * (L[i] + R[i])
      for (let c = 2; c < out.length; c++) out[c].fill(0)
      return true
    }
  })
}
if (typeof module !== 'undefined') module.exports = { Motor, PARAMS, PARAM_IDS }
