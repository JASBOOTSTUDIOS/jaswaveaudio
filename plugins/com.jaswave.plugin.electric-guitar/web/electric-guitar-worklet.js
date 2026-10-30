/**
 * JasWave Electric Guitar – versión web (AudioWorklet) del VST3 `electric_guitar_dsp.h`.
 * Mismo algoritmo, mismos IDs y rangos de parámetros que el VST3:
 *  - Cuerda: guía de ondas con retardo fraccional Lagrange cúbico, LP + allpass de rigidez en el lazo, compensación
 *    analítica del retardo de fase (afinación < 5 cents), dos polarizaciones, peine de púa y de pastilla, ataque de
 *    púa, ruido de cuerda, palm mute por note-off corto, sustain de lead acotado, pitch bend y vibrato (CC1).
 *  - Amp: puerta suave, preamp, saturador asimétrico de 2 etapas con sobremuestreo 4x/2x (FIR Kaiser), tone stack,
 *    pantalla 4x12 (cadena de biquads) y mezcla DI/cab.
 *  - FX: chorus de línea modulada, delay ping-pong sincronizado al tempo, reverb de plato FDN 8x8.
 * Autocontenido, sin imports. Clase `Motor` pura; el AudioWorklet se registra al final.
 */
'use strict'

const TAU = Math.PI * 2
const MAX_VOICES = 16
const CHUNK = 32
const MIN_NOTE = 28
const MAX_NOTE = 108

// IDs de parámetros (= ParamID VST3)
const P = {
  ampGain: 0, cabSim: 1, tone: 2, delayFeedback: 3, chorusMix: 4, bypass: 5, volume: 6, delayMix: 7, delayDiv: 8,
  delayTime: 9, reverbMix: 10, pickPos: 11, sustain: 12, bendRange: 13, pitchBend: 14, modWheel: 15, pedal: 16, strum: 17,
}

/** Definición de parámetros (rango plano y defecto) = paramDefs() de C++ */
const PARAM_DEFS = [
  { id: 0, name: 'amp_gain', min: 0, max: 100, def: 45 },
  { id: 1, name: 'cab_sim', min: 0, max: 100, def: 60 },
  { id: 2, name: 'tone', min: 0, max: 100, def: 55 },
  { id: 3, name: 'delay_feedback', min: 0, max: 95, def: 30 },
  { id: 4, name: 'chorus_mix', min: 0, max: 100, def: 25 },
  { id: 5, name: 'bypass', min: 0, max: 1, def: 0 },
  { id: 6, name: 'volume', min: -24, max: 6, def: 0 },
  { id: 7, name: 'delay_mix', min: 0, max: 100, def: 25 },
  { id: 8, name: 'delay_div', min: 0, max: 4, def: 0 },
  { id: 9, name: 'delay_time', min: 40, max: 2000, def: 380 },
  { id: 10, name: 'reverb_mix', min: 0, max: 100, def: 18 },
  { id: 11, name: 'pick_pos', min: 0, max: 100, def: 30 },
  { id: 12, name: 'sustain', min: 0, max: 100, def: 0 },
  { id: 13, name: 'bend_range', min: 0, max: 1, def: 0 },
  { id: 14, name: 'pitch_bend', min: -1, max: 1, def: 0 },
  { id: 15, name: 'mod_wheel', min: 0, max: 100, def: 0 },
  { id: 16, name: 'pedal', min: 0, max: 1, def: 0 },
  { id: 17, name: 'strum', min: 0, max: 100, def: 50 },
]

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
const FX_DEFS = []   // FX Rack comun (ids 100..230, `nombre` en vez de `name`); PARAM_DEFS conserva solo los parametros propios
const FX_IDS = {}
fxRegistrarParametros(FX_DEFS, FX_IDS)   // 58 parametros FX · (ids 100..230), ver shared-dsp/web/fxrack.js

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const dbToLin = (db) => Math.pow(10, db * 0.05)
const pow2AtLeast = (n) => { let p = 16; while (p < n) p <<= 1; return p }
const fastFloor = (x) => Math.floor(x)
function fastTanh(x) {
  if (x >= 3) return 1
  if (x <= -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}
function softLimit(x) {
  const a = Math.abs(x)
  if (a <= 0.7) return x
  const y = 0.7 + 0.27 * Math.tanh((a - 0.7) / 0.27)
  return x < 0 ? -y : y
}
function lagrange3(xm1, x0, x1, x2, t) {
  const c0 = -t * (t - 1) * (t - 2) * (1 / 6)
  const c1 = (t + 1) * (t - 1) * (t - 2) * 0.5
  const c2 = -(t + 1) * t * (t - 2) * 0.5
  const c3 = (t + 1) * t * (t - 1) * (1 / 6)
  return c0 * xm1 + c1 * x0 + c2 * x1 + c3 * x2
}
function phaseDelay1(b0, b1, a1, w) {
  const cw = Math.cos(w), sw = Math.sin(w)
  const argN = Math.atan2(-b1 * sw, b0 + b1 * cw), argD = Math.atan2(-a1 * sw, 1 + a1 * cw)
  return -(argN - argD) / w
}
function mag1(b0, b1, a1, w) {
  const cw = Math.cos(w), sw = Math.sin(w)
  const nr = b0 + b1 * cw, ni = -b1 * sw, dr = 1 + a1 * cw, di = -a1 * sw
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di))
}
function midiToHz(n) { return 440 * Math.pow(2, (n - 69) / 12) }

/** PRNG xorshift32 por instancia (sin Math.random en render) */
class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 1 }
  next() { let s = this.s; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; this.s = s; return s }
  r01() { return this.next() / 4294967296 }
  rS() { return this.r01() * 2 - 1 }
}

// ---- Biquad RBJ (idéntico a JasWaveDsp::BiquadCoefs::design) ----
const FT = { HP: 0, LP: 1, LS: 2, HS: 3, BELL: 4 }
function designBiquad(type, sr, freq, gainDb, q) {
  freq = clamp(freq, 10, sr * 0.499)
  q = clamp(q, 0.05, 40)
  const w0 = (TAU * freq) / sr, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  let b0, b1, b2, a0, a1, a2
  switch (type) {
    case FT.BELL:
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
      break
    case FT.HP:
      b0 = (1 + cw) * 0.5; b1 = -(1 + cw); b2 = (1 + cw) * 0.5; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case FT.LP:
      b0 = (1 - cw) * 0.5; b1 = 1 - cw; b2 = (1 - cw) * 0.5; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case FT.LS: {
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 - (A - 1) * cw + s2); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s2)
      a0 = A + 1 + (A - 1) * cw + s2; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s2
      break
    }
    default: {   // HS
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cw + s2); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s2)
      a0 = A + 1 - (A - 1) * cw + s2; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s2
    }
  }
  const inv = 1 / a0
  return { b0: b0 * inv, b1: b1 * inv, b2: b2 * inv, a1: a1 * inv, a2: a2 * inv }
}
function butterworthQ(order, k) { return 1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * order))) }
function magDb(c, f, sr) {
  const w = (TAU * f) / sr
  const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = c.b0 + c.b1 * cw + c.b2 * c2, ni = -(c.b1 * sw + c.b2 * s2)
  const dr = 1 + c.a1 * cw + c.a2 * c2, di = -(c.a1 * sw + c.a2 * s2)
  return 10 * Math.log10(Math.max((nr * nr + ni * ni) / (dr * dr + di * di), 1e-30))
}
class Bq {
  constructor() { this.c = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }; this.z1 = 0; this.z2 = 0 }
  set(c) { this.c = c }
  reset() { this.z1 = 0; this.z2 = 0 }
  proc(x) {
    const c = this.c
    const y = c.b0 * x + this.z1
    this.z1 = c.b1 * x - c.a1 * y + this.z2
    this.z2 = c.b2 * x - c.a2 * y
    return y
  }
}
class Smoother {
  constructor(sr, ms) { this.sr = sr; this.tau = Math.max(0.1, ms) * 0.001; this.cur = 0; this.tgt = 0 }
  reset(v) { this.cur = this.tgt = v }
  set(v) { this.tgt = v }
  advance(n) {
    if (this.cur === this.tgt) return this.cur
    const a = 1 - Math.exp(-n / (this.tau * this.sr))
    this.cur += (this.tgt - this.cur) * a
    if (Math.abs(this.tgt - this.cur) < 1e-6 * Math.max(1, Math.abs(this.tgt))) this.cur = this.tgt
    return this.cur
  }
}

// ---- sobremuestreo FIR Kaiser polifásico ----
class Oversampler {
  constructor(F) {
    this.F = F
    if (F <= 1) { this.F = 1; return }
    const K = 32
    this.K = K
    this.N = K * F
    const N = this.N
    this.h = new Float64Array(N)
    const fc = 0.47 / F, beta = 7.5
    const bessel0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t } return s }
    let sum = 0
    for (let i = 0; i < N; i++) {
      const m = i - (N - 1) * 0.5
      const sinc = Math.abs(m) < 1e-12 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m)
      const r = (2 * i) / (N - 1) - 1
      const win = bessel0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / bessel0(beta)
      this.h[i] = sinc * win
      sum += this.h[i]
    }
    for (let i = 0; i < N; i++) this.h[i] /= sum
    this.upHist = new Float64Array(2 * K)
    this.dnHist = new Float64Array(2 * N)
    this.upPos = 0
    this.dnPos = 0
  }
  reset() { if (this.F > 1) { this.upHist.fill(0); this.dnHist.fill(0); this.upPos = 0; this.dnPos = 0 } }
  up(x, out) {
    const F = this.F
    if (F === 1) { out[0] = x; return }
    const K = this.K
    this.upPos = (this.upPos + K - 1) % K
    this.upHist[this.upPos] = this.upHist[this.upPos + K] = x
    const base = this.upPos
    for (let p = 0; p < F; p++) {
      let acc = 0
      for (let k = 0; k < K; k++) acc += this.h[k * F + p] * this.upHist[base + k]
      out[p] = acc * F
    }
  }
  down(inp) {
    const F = this.F
    if (F === 1) return inp[0]
    const N = this.N
    for (let p = 0; p < F; p++) {
      this.dnPos = (this.dnPos + N - 1) % N
      this.dnHist[this.dnPos] = this.dnHist[this.dnPos + N] = inp[p]
    }
    let acc = 0
    const base = this.dnPos
    for (let k = 0; k < N; k++) acc += this.h[k] * this.dnHist[base + k]
    return acc
  }
}

// ---- chorus real ----
class Chorus {
  constructor(sr) {
    this.sr = sr
    this.size = pow2AtLeast(sr * 0.06 + 8)
    this.mask = this.size - 1
    this.buf = new Float32Array(this.size)
    this.reset()
    this.wl = 0
    this.wr = 0
  }
  reset() { this.buf.fill(0); this.w = 0; this.phase = 0; this.first = true; this.cnt = 0; this.dL0 = this.dL1 = this.dR0 = this.dR1 = this.dL = this.dR = this.stepL = this.stepR = 0 }
  tap(d) {
    const r = this.w - d
    const ip = Math.floor(r)
    const t = r - ip
    const a = this.buf[ip & this.mask], b = this.buf[(ip + 1) & this.mask]
    return a + (b - a) * t
  }
  process(x) {
    this.buf[this.w & this.mask] = x
    const sr = this.sr
    if ((this.cnt++ & 7) === 0) {
      const depth = 0.003 * sr * 0.8
      this.dL0 = this.dL1; this.dR0 = this.dR1
      const ph = this.phase + (8 * 0.62) / sr
      this.dL1 = 0.014 * sr + depth * (Math.sin(TAU * ph) + 0.25 * Math.sin(TAU * ph * 3 + 1.3))
      this.dR1 = 0.0175 * sr + depth * (Math.sin(TAU * ph + 0.5 * Math.PI) + 0.25 * Math.sin(TAU * ph * 3 + 2.9))
      this.stepL = (this.dL1 - this.dL0) * 0.125; this.stepR = (this.dR1 - this.dR0) * 0.125
      this.dL = this.dL0; this.dR = this.dR0
      if (this.first) { this.dL = this.dL1; this.dR = this.dR1; this.first = false }
    }
    this.dL += this.stepL; this.dR += this.stepR
    this.wl = this.tap(this.dL)
    this.wr = this.tap(this.dR)
    this.phase += 0.62 / sr
    if (this.phase >= 1) this.phase -= 1
    this.w++
  }
}

// ---- delay ping-pong ----
const MAX_DELAY_S = 2.0
class PingPongDelay {
  constructor(sr) {
    this.sr = sr
    this.size = pow2AtLeast(sr * (MAX_DELAY_S + 0.1) + 8)
    this.mask = this.size - 1
    this.bl = new Float32Array(this.size)
    this.br = new Float32Array(this.size)
    this.maxDelay = sr * MAX_DELAY_S
    this.glide = 1 / (0.1 * sr)
    this.hpC = Math.exp((-TAU * 170) / sr)
    this.lpC = Math.exp((-TAU * 3800) / sr)
    this.fb = 0.3
    this.reset()
    this.dcur = this.dtar = 0.38 * sr
    this.wl = 0
    this.wr = 0
  }
  reset() { this.bl.fill(0); this.br.fill(0); this.w = 0; this.hpL = this.hpR = this.lpL = this.lpR = this.hxL = this.hxR = 0 }
  setTimeSamples(d) { this.dtar = clamp(d, 16, this.maxDelay) }
  jumpTimeSamples(d) { this.setTimeSamples(d); this.dcur = this.dtar }
  setFeedback(f) { this.fb = clamp(f, 0, 0.95) }
  timeMs() { return (this.dtar / this.sr) * 1000 }
  tap(b, d) {
    const r = this.w - d
    const ip = Math.floor(r)
    const t = r - ip
    const a = b[ip & this.mask], c = b[(ip + 1) & this.mask]
    return a + (c - a) * t
  }
  process(x) {
    this.dcur += (this.dtar - this.dcur) * this.glide
    const tl = this.tap(this.bl, this.dcur), tr = this.tap(this.br, this.dcur)
    // HPF + LPF de un polo en la realimentación cruzada
    this.hpL = this.hpC * this.hpL + 0.5 * (1 + this.hpC) * (tr - this.hxL); this.hxL = tr
    this.lpL = (1 - this.lpC) * this.hpL + this.lpC * this.lpL
    this.hpR = this.hpC * this.hpR + 0.5 * (1 + this.hpC) * (tl - this.hxR); this.hxR = tl
    this.lpR = (1 - this.lpC) * this.hpR + this.lpC * this.lpR
    this.bl[this.w & this.mask] = x + this.fb * this.lpL
    this.br[this.w & this.mask] = this.fb * this.lpR
    this.w++
    this.wl = tl
    this.wr = tr
  }
}

// ---- reverb de plato FDN 8x8 ----
class PlateReverb {
  constructor(sr) {
    const sc = sr / 48000
    const base = [743, 887, 1031, 1187, 1327, 1481, 1619, 1783]
    this.N = 8
    this.len = base.map((b) => Math.max(8, Math.floor(b * sc + 0.5)))
    this.size = pow2AtLeast(Math.max(...this.len) + 8)
    this.mask = this.size - 1
    this.line = base.map(() => new Float32Array(this.size))
    const rt60 = 1.7
    this.g = this.len.map((l) => Math.pow(10, (-3 * l) / (rt60 * sr)))
    this.damp = 1 - Math.exp((-TAU * 5500) / sr)
    const apBase = [142, 107]
    this.apLen = apBase.map((b) => Math.max(4, Math.floor(b * sc + 0.5)))
    this.ap = this.apLen.map((l) => new Float32Array(pow2AtLeast(l + 4)))
    this.apMask = this.ap.map((a) => a.length - 1)
    this.lp = new Float64Array(8)
    this.s = new Float64Array(8)
    this.t = new Float64Array(8)
    this.u = new Float64Array(8)
    this.v = new Float64Array(8)
    this.wl = 0
    this.wr = 0
    this.reset()
  }
  reset() { for (const l of this.line) l.fill(0); for (const a of this.ap) a.fill(0); this.lp.fill(0); this.w = 0; this.apW = [0, 0] }
  process(inp) {
    let x = inp
    for (let a = 0; a < 2; a++) {
      const d = this.ap[a][(this.apW[a] - this.apLen[a]) & this.apMask[a]]
      const v = x - 0.6 * d
      this.ap[a][this.apW[a] & this.apMask[a]] = v
      x = d + 0.6 * v
      this.apW[a]++
    }
    const s = this.s, t = this.t, u = this.u, v = this.v
    for (let i = 0; i < 8; i++) {
      const r = this.line[i][(this.w - this.len[i]) & this.mask]
      this.lp[i] += this.damp * (r - this.lp[i])
      s[i] = this.lp[i] * this.g[i]
    }
    for (let i = 0; i < 8; i += 2) { t[i] = s[i] + s[i + 1]; t[i + 1] = s[i] - s[i + 1] }
    for (let i = 0; i < 8; i += 4) { u[i] = t[i] + t[i + 2]; u[i + 2] = t[i] - t[i + 2]; u[i + 1] = t[i + 1] + t[i + 3]; u[i + 3] = t[i + 1] - t[i + 3] }
    for (let i = 0; i < 4; i++) { v[i] = u[i] + u[i + 4]; v[i + 4] = u[i] - u[i + 4] }
    const k = 0.35355339059327373
    for (let i = 0; i < 8; i++) this.line[i][this.w & this.mask] = v[i] * k + x * 0.5
    this.w++
    let l = 0, r = 0
    for (let i = 0; i < 8; i++) { if (i & 1) r += s[i]; else l += s[i] }
    this.wl = l * 0.5
    this.wr = r * 0.5
  }
}

// =====================================================================================
class Voice {
  constructor(lineSize) {
    this.store = new Float64Array(2 * lineSize)
    this.active = false
    this.w = [0, 0]; this.lp = [0, 0]; this.apx = [0, 0]; this.apy = [0, 0]; this.dcur = [0, 0]; this.Tn = [0, 0]; this.pd = [0, 0]; this.wgt = [1, 0.28]
    this.rng = new Rng(1)
    this.clear()
  }
  clear() {
    this.keyUp = false; this.released = false; this.killing = false; this.palm = false
    this.note = -1; this.pendingNote = -1; this.pendingVel = 0
    this.order = 0; this.held = 0; this.f0 = 110; this.vel = 0.5
    this.c = 0.5; this.apA = -0.05
    this.gBase = 0.99; this.gSust = 0.99; this.gRel = 0.5; this.gCur = 0.99
    this.olC = 1; this.olY = 0; this.env = 0; this.killGain = 1; this.killStep = 0
    this.clickLeft = 0; this.clickLen = 1; this.clickInv = 1; this.clickAmp = 0; this.noiseAmp = 0; this.nz = 0; this.nzHp = 0
  }
}

class Motor {
  constructor(sampleRate) {
    const sr = sampleRate > 0 ? sampleRate : 48000
    this.sr = sr
    this.p = {}
    for (const d of PARAM_DEFS) this.p[d.id] = d.def
    this.s = { ampGain: 0.45, cab: 0.6, tone: 0.55, delayFb: 0.3, chorusMix: 0.25, delayMix: 0.25, reverbMix: 0.18, pickPos: 0.3, sustain: 0, strum: 0.5, volumeDb: 0, delayTimeMs: 380, delayDiv: 0, bendRange: 2, bypass: false }
    this.lineSize = pow2AtLeast(sr / 20 + 16)
    this.lineMask = this.lineSize - 1
    this.voices = []
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(this.lineSize))
    this.scratch = new Float64Array(this.lineSize)
    this.scratch2 = new Float64Array(this.lineSize)
    this.pending = []
    for (let i = 0; i < 32; i++) this.pending.push({ note: 0, vel: 0, left: -1 })
    const F = sr <= 56000 ? 4 : sr <= 112000 ? 2 : 1
    this.osF = F
    this.os = new Oversampler(F)
    this.chorus = new Chorus(sr)
    this.delay = new PingPongDelay(sr)
    this.reverb = new PlateReverb(sr)
    this.vol = new Smoother(sr, 20)
    this.wet = new Smoother(sr, 8)
    this.bend = new Smoother(sr, 6)
    this.mod = new Smoother(sr, 30)
    this.killLen = Math.max(16, Math.floor(0.005 * sr))
    this.noiseLen = Math.floor(0.08 * sr)
    this.invNoiseLen = 1 / this.noiseLen
    this.inHp = designBiquad(FT.HP, sr, 75, 0, 0.7071)
    this.dcHp = designBiquad(FT.HP, sr, 28, 0, 0.7071)
    this.outHp = designBiquad(FT.HP, sr, 12, 0, 0.7071)
    const fos = sr * F
    this.osHpC = Math.exp((-TAU * 140) / fos)
    this.osLpC = Math.exp((-TAU * 6500) / fos)
    this.osFizzC = Math.exp((-TAU * 7800) / fos)
    this.gateAtk = 1 - Math.exp(-1 / (0.004 * sr))
    this.gateRel = 1 - Math.exp(-1 / (0.12 * sr))
    this.envDecay = Math.exp(-1 / (0.05 * sr))
    this.cabDelay = clamp(Math.floor(0.00022 * sr + 0.5), 1, 60)
    this.stIn = new Bq(); this.stDc = new Bq(); this.stOut = [new Bq(), new Bq()]
    this.stTone = [0, 1, 2, 3].map(() => new Bq())
    this.stCab = [0, 1, 2, 3, 4, 5].map(() => new Bq())
    this.toneCoef = [null, null, null, null]
    this.cabCoef = [null, null, null, null, null, null]
    this.cabDl = new Float64Array(64)
    this.vbuf = new Float64Array(CHUNK)
    this.chL = new Float64Array(CHUNK)
    this.chR = new Float64Array(CHUNK)
    this.upBuf = new Float64Array(4)
    this.dnBuf = new Float64Array(4)
    this.tanhBiasB = fastTanh(0.08)
    this.rng = new Rng(0xc0ffee)
    this.bpm = 0
    this.bendNorm = 0
    this.fx = new FxRack(sr)   // rack de mezcla comun tras la cadena propia (EQ, compresor, saturacion, chorus, delay, reverb, anchura): apagado por defecto
    this.reset()
    this.applySettings()
    this.vol.reset(dbToLin(this.s.volumeDb))
    this.wet.reset(this.s.bypass ? 0 : 1)
    this.delay.jumpTimeSamples(this.delay.dtar)
  }

  reset() {
    for (const v of this.voices) v.active = false
    for (const p of this.pending) p.left = -1
    this.os.reset(); this.chorus.reset(); this.delay.reset(); this.reverb.reset(); this.fx.reset()
    this.stIn.reset(); this.stDc.reset(); this.stOut[0].reset(); this.stOut[1].reset()
    for (const b of this.stTone) b.reset()
    for (const b of this.stCab) b.reset()
    this.cabDl.fill(0); this.cabW = 0
    this.osHp = this.osLp = this.osFizz = 0
    this.gateEnv = 0; this.gateG = 0; this.diLp = 0
    this.pedal = false; this.groupCount = 0; this.lastOn = -1e9; this.groupAccum = 0
    this.vibPhase = 0; this.now = 0; this.orderCtr = 0
    this.bend.reset(0); this.mod.reset(0)
    this.bendNorm = 0; this.modV = 0
  }

  panic() { this.reset() }

  // ---- parámetros (valor plano, ParamID VST3) ----
  setParam(id, v) {
    if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { this.fx.setParam(id, v); return }   // FX Rack comun
    if (!(id in this.p) || !Number.isFinite(v)) return
    this.p[id] = v
    const p = this.p, s = this.s
    switch (id) {
      case P.pitchBend: this.setBend(v); return
      case P.modWheel: this.setModWheel(v / 100); return
      case P.pedal: this.setPedal(v >= 0.5); return
      default: break
    }
    s.ampGain = p[P.ampGain] / 100
    s.cab = p[P.cabSim] / 100
    s.tone = p[P.tone] / 100
    s.delayFb = p[P.delayFeedback] / 100
    s.chorusMix = p[P.chorusMix] / 100
    s.delayMix = p[P.delayMix] / 100
    s.reverbMix = p[P.reverbMix] / 100
    s.pickPos = p[P.pickPos] / 100
    s.sustain = p[P.sustain] / 100
    s.strum = p[P.strum] / 100
    s.volumeDb = p[P.volume]
    s.delayTimeMs = p[P.delayTime]
    s.delayDiv = Math.round(p[P.delayDiv])
    s.bendRange = Math.round(p[P.bendRange]) === 1 ? 12 : 2
    s.bypass = p[P.bypass] >= 0.5
    this.applySettings()
  }
  setBend(norm) { this.bendNorm = clamp(norm, -1, 1); this.bend.set(this.bendNorm * this.s.bendRange) }
  setModWheel(v) { this.modV = clamp(v, 0, 1); this.mod.set(this.modV) }
  setPedal(down) {
    this.pedal = down
    if (!down) for (const v of this.voices) if (v.active && v.keyUp && !v.released) this.release(v)
  }
  setTempo(bpm) {
    const b = bpm >= 20 && bpm <= 400 ? bpm : 0
    if (b !== this.bpm) { this.bpm = b; this.updateDelayTime() }
    this.fx.setTempo(b)   // fuera de rango -> 120 bpm
  }
  cc(num, valor) {
    if (num === 1) this.setModWheel(valor > 1 ? valor / 127 : valor)
    else if (num === 64) this.setPedal((valor > 1 ? valor / 127 : valor) >= 0.5)
    else if (num === 123) this.allNotesOff()
  }
  pitchBend(semitonos) {
    // semitonos absolutos respecto al rango configurado
    this.setBend(semitonos / this.s.bendRange)
  }

  applySettings() {
    const s = this.s, sr = this.sr
    this.vol.set(dbToLin(s.volumeDb))
    this.wet.set(s.bypass ? 0 : 1)
    this.bend.set(this.bendNorm * s.bendRange)
    const g = clamp(s.ampGain, 0, 1)
    this.k1 = 0.8 + 18 * g * g
    this.k2 = 1 + 5 * g
    this.biasA = 0.18 + 0.12 * g
    this.tanhBiasA = fastTanh(this.biasA)
    {
      const gx = [0, 0.25, 0.45, 0.7, 0.85, 1.0]
      const nm = [3.0, 1.5, 1.6, 2.1, 2.7, 3.2]
      let i = 0
      while (i < 4 && g > gx[i + 1]) i++
      const t = clamp((g - gx[i]) / (gx[i + 1] - gx[i]), 0, 1)
      this.post = (nm[i] + (nm[i + 1] - nm[i]) * t) / this.k1
    }
    const tilt = (clamp(s.tone, 0, 1) - 0.5) * 2
    const tc = this.toneCoef
    tc[0] = designBiquad(FT.LS, sr, 190, -3 * tilt + 1, 0.7)
    tc[1] = designBiquad(FT.BELL, sr, 680, -1.5 * g, 0.9)
    tc[2] = designBiquad(FT.HS, sr, 2600, 7 * tilt, 0.7)
    tc[3] = designBiquad(FT.BELL, sr, 3500, 2.5 * Math.max(0, tilt) + 1, 1.1)
    for (let i = 0; i < 4; i++) this.stTone[i].set(tc[i])
    const cc = this.cabCoef
    cc[0] = designBiquad(FT.HP, sr, 82, 0, 0.75)
    cc[1] = designBiquad(FT.BELL, sr, 105, 5.5, 1.5)
    cc[2] = designBiquad(FT.BELL, sr, 420, -3.5, 1.0)
    cc[3] = designBiquad(FT.BELL, sr, 2400, 4.0, 1.2)
    cc[4] = designBiquad(FT.LP, sr, 3900, 0, butterworthQ(4, 0))
    cc[5] = designBiquad(FT.LP, sr, 3900, 0, butterworthQ(4, 1))
    for (let i = 0; i < 6; i++) this.stCab[i].set(cc[i])
    this.stIn.set(this.inHp); this.stDc.set(this.dcHp); this.stOut[0].set(this.outHp); this.stOut[1].set(this.outHp)
    this.diC = Math.exp((-TAU * 9500) / sr)
    this.fxChorus = clamp(s.chorusMix, 0, 1)
    this.fxDelay = clamp(s.delayMix, 0, 1)
    this.fxRev = clamp(s.reverbMix, 0, 1)
    this.delay.setFeedback(s.delayFb)
    this.updateDelayTime()
  }
  updateDelayTime() {
    const s = this.s
    let ms = s.delayTimeMs
    if (this.bpm > 0 && s.delayDiv < 4) {
      const beats = [0.75, 1, 0.5, 0.25]
      let T = (beats[s.delayDiv] * 60) / this.bpm
      while (T > MAX_DELAY_S) T *= 0.5
      ms = T * 1000
    }
    this.delay.setTimeSamples(ms * 0.001 * this.sr)
  }
  delayMs() { return this.delay.timeMs() }
  cabResponseDb(f) { let db = 0; for (const c of this.cabCoef) db += magDb(c, f, this.sr); return db }
  activeVoices() { let a = 0; for (const v of this.voices) if (v.active) a++; return a }

  // ---- notas ----
  noteOn(note, velIn) {
    if (note < MIN_NOTE || note > MAX_NOTE) return
    let vel = velIn > 1 ? velIn / 127 : velIn
    if (!(vel > 0)) { this.noteOff(note); return }
    vel = clamp(vel, 0, 1)
    let delay = 0
    const s = this.s
    if (s.strum > 0.02 && this.groupCount > 0 && this.now - this.lastOn < Math.floor(0.03 * this.sr)) {
      const gapMs = 3 + 13 * s.strum
      this.groupAccum += gapMs * 0.001 * this.sr * (0.55 + 0.9 * this.rng.r01())
      this.groupAccum = Math.min(this.groupAccum, 0.16 * this.sr)
      delay = Math.floor(this.groupAccum)
      vel *= clamp(1 + 0.07 * this.rng.rS() - 0.015 * this.groupCount * s.strum, 0.3, 1)
    } else {
      this.groupAccum = 0
      this.groupCount = 0
    }
    this.lastOn = this.now
    this.groupCount++
    if (delay <= 0) { this.startNote(note, vel); return }
    for (const p of this.pending) if (p.left < 0) { p.note = note; p.vel = vel; p.left = delay; return }
    this.startNote(note, vel)
  }
  noteOff(note) {
    for (const p of this.pending) if (p.left >= 0 && p.note === note) p.left = -1
    for (const v of this.voices) {
      if (!v.active || v.killing || v.note !== note || v.keyUp) continue
      v.keyUp = true
      if (!this.pedal) this.release(v)
    }
  }
  allNotesOff() {
    for (const p of this.pending) p.left = -1
    for (const v of this.voices) if (v.active && !v.killing) this.startKill(v, -1, 0)
  }
  release(v) {
    if (v.released) return
    v.released = true
    v.palm = v.held < Math.floor(0.17 * this.sr)
    const tRel = v.palm ? 0.035 : 0.12
    v.gRel = Math.min(v.gBase, Math.pow(10, -3 / (tRel * v.f0)))
    if (v.palm) v.olC = 1 - Math.exp((-TAU * 1100) / this.sr)
  }
  startKill(v, pendNote, pendVel) {
    v.killing = true
    v.killStep = Math.max(1e-9, v.killGain / this.killLen)
    v.pendingNote = pendNote
    v.pendingVel = pendVel
  }
  startNote(note, vel) {
    for (const v of this.voices) if (v.active && !v.killing && v.note === note) this.startKill(v, -1, 0)
    for (const v of this.voices) if (!v.active) { this.initVoice(v, note, vel); return }
    let victim = null
    for (const v of this.voices) {
      if (!v.active || v.killing) continue
      if (!victim || v.order < victim.order) victim = v
    }
    if (victim) { this.startKill(victim, note, vel); return }
    for (const v of this.voices) if (v.active && v.killing && v.pendingNote >= 0) { v.pendingNote = note; v.pendingVel = vel; return }
  }
  firePending() {
    for (const p of this.pending) if (p.left === 0) { this.startNote(p.note, p.vel); p.left = -1 }
  }

  initVoice(v, note, vel) {
    const sr = this.sr, s = this.s
    v.clear()
    v.store.fill(0)
    v.active = true
    v.note = note
    v.vel = vel
    v.order = ++this.orderCtr
    v.rng.s = ((0x9e3779b9 ^ (note * 7919) ^ Math.imul(this.orderCtr, 2654435761)) >>> 0) || 1
    const microCents = 1.2 * v.rng.rS()
    v.f0 = midiToHz(note) * Math.pow(2, microCents / 1200)
    const w0 = (TAU * v.f0) / sr
    const fcLoop = (1900 + 6200 * Math.pow(vel, 1.1)) * Math.pow(Math.max(v.f0, 110) / 220, 0.7)
    v.c = Math.exp((-TAU * Math.min(fcLoop, 0.42 * sr)) / sr)
    const lowF = clamp((note - 40) / 50, 0, 1)
    v.apA = -(0.02 + 0.1 * (1 - lowF))
    const pdLp = phaseDelay1(1 - v.c, 0, -v.c, w0)
    const pdAp = phaseDelay1(v.apA, 1, v.apA, w0)
    const magLp = mag1(1 - v.c, 0, -v.c, w0)
    const detune = [0.9, -0.9]
    for (let p = 0; p < 2; p++) {
      v.Tn[p] = sr / (v.f0 * Math.pow(2, detune[p] / 1200))
      v.pd[p] = pdLp + pdAp
      v.dcur[p] = clamp(v.Tn[p] - v.pd[p], 3.01, this.lineSize - 8)
      v.lp[p] = 0; v.apx[p] = 0; v.apy[p] = 0
    }
    v.wgt[0] = 1; v.wgt[1] = 0.28
    const t60 = clamp(3.4 * Math.pow(110 / v.f0, 0.3), 0.9, 5)
    const gFor = (T60) => Math.min(0.99985, Math.pow(10, -3 / (T60 * v.f0)) / Math.max(magLp, 1e-3))
    v.gBase = gFor(t60)
    v.gSust = gFor(t60 * (1 + 5 * s.sustain))
    v.gCur = v.gSust
    v.gRel = v.gBase
    const beta = 0.08 + 0.42 * s.pickPos
    const ampV = 0.1 + 0.34 * Math.pow(vel, 1.3)
    const kn = 0.1 + 0.8 * vel
    const x = this.scratch, y = this.scratch2
    for (let p = 0; p < 2; p++) {
      const L = Math.min(this.lineSize - 4, Math.ceil(v.Tn[p]) + 4)
      const Ppick = Math.max(1, Math.floor(beta * L + 0.5))
      let nlp = 0
      for (let i = 0; i < L; i++) {
        const tri = i < Ppick ? i / Ppick : (L - 1 - i) / Math.max(1, L - 1 - Ppick)
        nlp += kn * (v.rng.rS() - nlp)
        x[i] = nlp
        y[i] = tri
      }
      let mean = 0
      for (let i = 0; i < L; i++) {
        const nc = x[i] - x[(i - Ppick + L) % L]
        y[i] = 0.55 * y[i] + (0.3 + 0.75 * vel) * nc
        mean += y[i]
      }
      mean /= L
      const Ppu = Math.max(1, Math.floor(0.13 * L + 0.5))
      let peak = 1e-9
      for (let i = 0; i < L; i++) {
        x[i] = y[i] - mean - 0.55 * (y[(i - Ppu + L) % L] - mean)
        peak = Math.max(peak, Math.abs(x[i]))
      }
      const off = p * this.lineSize
      const sc = (ampV * v.wgt[p]) / peak
      for (let i = 0; i < L; i++) v.store[off + (i & this.lineMask)] = x[i] * sc
      v.w[p] = L
    }
    v.clickLen = Math.max(8, Math.floor(0.0028 * sr))
    v.clickLeft = v.clickLen
    v.clickInv = 1 / v.clickLen
    v.clickAmp = 0.035 * Math.pow(vel, 1.5)
    v.noiseAmp = 0.012 * vel
    v.killGain = 1
    v.olC = 1
  }

  renderVoice(v, acc, len, m) {
    const sr = this.sr, mask = this.lineMask, ls = this.lineSize
    const invLen = 1 / len
    const dstep0 = (clamp(v.Tn[0] * m - v.pd[0], 3.01, ls - 8) - v.dcur[0]) * invLen
    const dstep1 = (clamp(v.Tn[1] * m - v.pd[1], 3.01, ls - 8) - v.dcur[1]) * invLen
    const dt0 = clamp(v.Tn[0] * m - v.pd[0], 3.01, ls - 8), dt1 = clamp(v.Tn[1] * m - v.pd[1], 3.01, ls - 8)
    let gT
    if (v.released) gT = v.gRel
    else {
      const heldS = v.held / sr
      const fade = clamp((heldS - 7) / 4, 0, 1)
      gT = v.gSust + (v.gBase - v.gSust) * fade
    }
    const st = v.store
    const o1 = ls
    const c = v.c, c1 = 1 - v.c, aA = v.apA
    let w0 = v.w[0], w1 = v.w[1], d0 = v.dcur[0], d1 = v.dcur[1]
    let lp0 = v.lp[0], lp1 = v.lp[1], x0 = v.apx[0], x1 = v.apx[1], y0 = v.apy[0], y1 = v.apy[1]
    let gC = v.gCur, env = v.env
    for (let i = 0; i < len; i++) {
      gC += (gT - gC) * 0.02
      d0 += dstep0; d1 += dstep1
      const r0 = w0 - d0, r1 = w1 - d1
      const ip0 = Math.floor(r0), ip1 = Math.floor(r1)
      const q0 = lagrange3(st[(ip0 - 1) & mask], st[ip0 & mask], st[(ip0 + 1) & mask], st[(ip0 + 2) & mask], r0 - ip0)
      const q1 = lagrange3(st[o1 + ((ip1 - 1) & mask)], st[o1 + (ip1 & mask)], st[o1 + ((ip1 + 1) & mask)], st[o1 + ((ip1 + 2) & mask)], r1 - ip1)
      lp0 = c1 * q0 + c * lp0; lp1 = c1 * q1 + c * lp1
      const ap0 = aA * lp0 + x0 - aA * y0, ap1 = aA * lp1 + x1 - aA * y1
      x0 = lp0; y0 = ap0; x1 = lp1; y1 = ap1
      const oo0 = ap0 * gC, oo1 = ap1 * gC
      st[w0 & mask] = oo0; st[o1 + (w1 & mask)] = oo1
      w0++; w1++
      let s = oo0 + oo1
      if (v.clickLeft > 0) {
        const e = v.clickLeft * v.clickInv
        const nzr = v.rng.rS()
        v.nzHp = nzr - v.nz
        v.nz += 0.35 * (nzr - v.nz)
        s += v.nzHp * v.clickAmp * e * e
        v.clickLeft--
      }
      if (v.held + i < this.noiseLen) {
        const e = 1 - (v.held + i) * this.invNoiseLen
        s += v.rng.rS() * v.noiseAmp * e * e * 0.5
      }
      v.olY += v.olC * (s - v.olY)
      if (v.olC < 1) s = v.olY
      if (v.killing) {
        v.killGain -= v.killStep
        if (v.killGain <= 0) v.killGain = 0
      }
      s *= v.killGain
      env = Math.max(Math.abs(s), env * this.envDecay)
      acc[i] += s
      if (v.killing && v.killGain <= 0) break
    }
    v.gCur = gC; v.env = env; v.w[0] = w0; v.w[1] = w1
    v.lp[0] = lp0; v.lp[1] = lp1; v.apx[0] = x0; v.apx[1] = x1; v.apy[0] = y0; v.apy[1] = y1
    v.dcur[0] = dt0; v.dcur[1] = dt1
    v.held += len
    if (v.killing && v.killGain <= 0) {
      v.active = false
      if (v.pendingNote >= 0) { const pn = v.pendingNote, pv = v.pendingVel; v.pendingNote = -1; this.initVoice(v, pn, pv) }
      return
    }
    if (v.env < 2e-6 && v.held > Math.floor(0.12 * sr)) v.active = false
    if (v.released && v.env < 1e-5 && v.held > Math.floor(0.05 * sr)) v.active = false
  }

  renderChunk(len) {
    const sr = this.sr, s = this.s
    const bendSt = this.bend.advance(len)
    const modv = this.mod.advance(len)
    this.vibPhase += (TAU * 5.3 * len) / sr
    if (this.vibPhase > TAU) this.vibPhase -= TAU
    const stt = bendSt + modv * 0.45 * Math.sin(this.vibPhase)
    const m = Math.pow(2, -stt / 12)
    const vbuf = this.vbuf
    for (let i = 0; i < len; i++) vbuf[i] = 0
    for (const v of this.voices) if (v.active) this.renderVoice(v, vbuf, len, m)
    const vg0 = this.vol.cur, vg1 = this.vol.advance(len), w0 = this.wet.cur, w1 = this.wet.advance(len)
    const thr = 0.0004 + 0.003 * s.ampGain
    const k1 = this.k1, k2 = this.k2, F = this.osF
    const up = this.upBuf, dn = this.dnBuf
    const cabAmt = clamp(s.cab, 0, 1)
    for (let i = 0; i < len; i++) {
      let x = this.stIn.proc(vbuf[i])
      this.gateEnv = Math.max(Math.abs(x), this.gateEnv * this.envDecay)
      const gt = Math.min(1, this.gateEnv / thr)
      this.gateG += (gt * gt - this.gateG) * (gt * gt > this.gateG ? this.gateAtk : this.gateRel)
      x *= this.gateG
      this.os.up(x, up)
      for (let p = 0; p < F; p++) {
        const a = up[p] * k1
        const yA = fastTanh(a + this.biasA) - this.tanhBiasA
        this.osHp = this.osHpC * this.osHp + (1 - this.osHpC) * yA
        let z = yA - this.osHp
        this.osLp = this.osLpC * this.osLp + (1 - this.osLpC) * z
        z = this.osLp
        const yB = fastTanh(z * k2 + 0.08) - this.tanhBiasB
        this.osFizz = this.osFizzC * this.osFizz + (1 - this.osFizzC) * yB
        dn[p] = this.osFizz
      }
      let y = this.os.down(dn) * this.post
      y = this.stDc.proc(y)
      for (let b = 0; b < 4; b++) y = this.stTone[b].proc(y)
      this.diLp = this.diC * this.diLp + (1 - this.diC) * y
      let cab = y
      for (let b = 0; b < 6; b++) cab = this.stCab[b].proc(cab)
      this.cabDl[this.cabW & 63] = cab
      cab += 0.14 * this.cabDl[(this.cabW - this.cabDelay) & 63]
      const amp = this.diLp * (1 - cabAmt) * 0.8 + cab * cabAmt * 1.55
      this.cabW++
      this.chorus.process(amp)
      const cm = this.fxChorus
      let l = amp * (1 - 0.35 * cm) + this.chorus.wl * 0.78 * cm
      let r = amp * (1 - 0.35 * cm) + this.chorus.wr * 0.78 * cm
      this.delay.process(0.5 * (l + r))
      l += this.delay.wl * this.fxDelay * 0.9
      r += this.delay.wr * this.fxDelay * 0.9
      this.reverb.process(0.5 * (l + r))
      l += this.reverb.wl * this.fxRev * 0.55
      r += this.reverb.wr * this.fxRev * 0.55
      const t = (i + 1) / len
      const gain = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t)
      this.chL[i] = softLimit(this.stOut[0].proc(l) * gain)
      this.chR[i] = softLimit(this.stOut[1].proc(r) * gain)
    }
  }

  /** Renderiza n muestras estéreo en outL/outR (las sobrescribe) */
  render(outL, outR, n) {
    let pos = 0
    while (pos < n) {
      this.firePending()
      let len = Math.min(CHUNK, n - pos)
      for (const p of this.pending) if (p.left > 0) len = Math.min(len, p.left)
      this.renderChunk(len)
      for (let i = 0; i < len; i++) { outL[pos + i] = this.chL[i]; outR[pos + i] = this.chR[i] }
      for (const p of this.pending) if (p.left > 0) p.left -= len
      this.now += len
      pos += len
    }
    this.fx.process(outL, outR, n, 0)   // FX Rack comun al final de la cadena (con todo apagado no toca el buffer)
  }
}

// =====================================================================================
//  AudioWorklet: eventos {tipo:'on'|'off', nota, vel, cuando} con `cuando` en segundos del AudioContext
// =====================================================================================
if (typeof registerProcessor !== 'undefined') {
  registerProcessor('jaswave-electric-guitar', class extends AudioWorkletProcessor {
    constructor() {
      super()
      this.motor = new Motor(sampleRate)
      this.eventos = []
      this.mono = new Float32Array(128)
      this.port.onmessage = (e) => {
        const m = e.data
        if (!m) return
        if (m.tipo === 'param') this.motor.setParam(m.id, m.valor)
        else if (m.tipo === 'panico') { this.eventos.length = 0; this.motor.panic() }
        else if (m.tipo === 'bend') this.motor.pitchBend(m.valor)
        else if (m.tipo === 'cc') this.motor.cc(m.num, m.valor)
        else if (m.tipo === 'tempo') this.motor.setTempo(m.bpm)
        else if (m.tipo === 'on' || m.tipo === 'off') {
          const cuando = typeof m.cuando === 'number' ? m.cuando : currentTime
          let i = this.eventos.length
          while (i > 0 && this.eventos[i - 1].cuando > cuando) i--
          this.eventos.splice(i, 0, { tipo: m.tipo, nota: m.nota, vel: m.vel, cuando })
        }
      }
    }
    process(_in, outputs) {
      const out = outputs[0]
      if (!out || !out[0]) return true
      const L = out[0], R = out[1] || out[0]
      const n = L.length
      const t0 = currentTime
      let done = 0
      while (done < n) {
        let next = n
        while (this.eventos.length) {
          const off = Math.round((this.eventos[0].cuando - t0) * sampleRate)
          if (off <= done) {
            const ev = this.eventos.shift()
            if (ev.tipo === 'on') this.motor.noteOn(ev.nota, ev.vel)
            else this.motor.noteOff(ev.nota)
          } else { next = Math.min(next, off); break }
        }
        this.motor.render(L.subarray(done, next), R === L ? this.mono.subarray(0, next - done) : R.subarray(done, next), next - done)
        done = next
      }
      return true
    }
  })
}

if (typeof module !== 'undefined') module.exports = { Motor, PARAM_DEFS, P, FX_DEFS, FX_IDS }
