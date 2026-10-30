/**
 * JasWave Grand Piano - version web (AudioWorklet) del mismo instrumento que el VST3.
 * Piano de cola de concierto por modelado (sin muestras): 1/2/3 cuerdas por nota microdesafinadas,
 * inarmonicidad de cuerda rigida, decaimiento bifasico y por parcial, martillo (thump + click, timbre por
 * velocidad), apagadores, pedal CC64 continuo con resonancia simpatica, tabla armonica (biquads), imagen
 * estereo por registro, reverb de sala FDN y soft-clip. Mismo algoritmo que source/grand_piano_dsp.h.
 *
 * Autocontenido, sin imports. `Motor` es una clase pura (sin APIs de AudioWorklet) y no asigna memoria
 * en render(). El procesador (al final) solo programa eventos con precision de muestra y llama al motor.
 *
 * Mensajes del puerto (ParamID numerico = vstParamId del manifiesto, valor plano):
 *   {tipo:'param', id, valor} {tipo:'on', nota, vel, cuando} {tipo:'off', nota, cuando}
 *   {tipo:'panico'}  {tipo:'bend', valor} (valor en semitonos)  {tipo:'cc', num, valor} (valor 0..127)  {tipo:'tempo', bpm}
 * `cuando` en segundos del AudioContext (como jas-wave/lib/web-synth/web-synth-processor.js).
 * Velocidad: 0..1 (flotante) o 2..127 (MIDI); 0 = note off.
 */
'use strict'

const TWO_PI = Math.PI * 2
const BLK = 64 // sub-bloque interno (muestras)
const MAX_VOICES = 64
const EXTRA_SLOTS = 8
const SLOTS = MAX_VOICES + EXTRA_SLOTS
const MAX_PARTIALS = 48
const SYM_N = 88
const BODY_N = 10

// ParamIDs estables (= manifiesto.ai.parameters[].vstParamId) y valores por defecto
const PARAM_IDS = {
  attack: 0, decay: 1, release: 2, velocity_curve: 3, brightness: 4, reverb_send: 5,
  bypass: 6, volume: 7, tune: 8, width: 9, sustain: 10, una_corda: 11,
  note_select: 12, note_gain: 13, note_tune: 14, note_tone: 15, note_body: 16, note_decay: 17, note_release: 18,
  note_hammer: 19, note_pan: 20, note_vel_curve: 21, note_preset: 22,
}
const PARAM_DEFS = [
  { id: 0, name: 'attack', min: 0.5, max: 50, def: 2 },
  { id: 1, name: 'decay', min: 0, max: 100, def: 70 },
  { id: 2, name: 'release', min: 0.05, max: 5, def: 0.6 },
  { id: 3, name: 'velocity_curve', min: 0, max: 100, def: 70 },
  { id: 4, name: 'brightness', min: 0, max: 100, def: 60 },
  { id: 5, name: 'reverb_send', min: 0, max: 100, def: 25 },
  { id: 6, name: 'bypass', min: 0, max: 1, def: 0 },
  { id: 7, name: 'volume', min: -24, max: 6, def: 0 },
  { id: 8, name: 'tune', min: 430, max: 450, def: 440 },
  { id: 9, name: 'width', min: 0, max: 100, def: 75 },
  { id: 10, name: 'sustain', min: 0, max: 100, def: 0 },
  { id: 11, name: 'una_corda', min: 0, max: 1, def: 0 },
  // editor nota a nota (idem nota_a_nota.h). Aqui note_select es el numero MIDI (21..108); en el VST3 es el indice 0..87.
  { id: 12, name: 'note_select', min: 21, max: 108, def: 60 },
  { id: 13, name: 'note_gain', min: -12, max: 12, def: 0 },
  { id: 14, name: 'note_tune', min: -50, max: 50, def: 0 },
  { id: 15, name: 'note_tone', min: -100, max: 100, def: 0 },
  { id: 16, name: 'note_body', min: -100, max: 100, def: 0 },
  { id: 17, name: 'note_decay', min: 25, max: 400, def: 100 },
  { id: 18, name: 'note_release', min: 25, max: 400, def: 100 },
  { id: 19, name: 'note_hammer', min: 0, max: 200, def: 100 },
  { id: 20, name: 'note_pan', min: -100, max: 100, def: 0 },
  { id: 21, name: 'note_vel_curve', min: -100, max: 100, def: 0 },
  { id: 22, name: 'note_preset', min: 0, max: 4, def: 0 },
]
const PARAMS = PARAM_DEFS // lista de definiciones: fxRegistrarParametros la amplia con los 58 del rack (ids 100..230)
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
fxRegistrarParametros(PARAMS, PARAM_IDS) // FX Rack comun: 58 parametros FX · (ids 100..230), ver shared-dsp/web/fxrack.js
for (const d of PARAM_DEFS) if (d.name === undefined) d.name = d.nombre // el rack las nombra `nombre`; el piano usa `name`

// ---- tabla de afinacion y timbre por nota (idem nota_a_nota.h): 88 notas x 9 propiedades, en unidades planas ----
const NOTA_MIN = 21, NOTA_MAX = 108, NOTAS = 88, N_PROPS = 9, PRESET_PERSONALIZADO = 4
const NOTA_PROP = PARAM_DEFS.slice(13, 22) // gain, tune, tone, body, decay, release, hammer, pan, vel_curve
const BODY_SHARE = [1.0, 0.6, 0.3] // reparto del realce de cuerpo entre los 3 primeros parciales
function notaTablaNeutra() {
  const t = new Float64Array(NOTAS * N_PROPS)
  for (let i = 0; i < NOTAS; i++) for (let q = 0; q < N_PROPS; q++) t[i * N_PROPS + q] = NOTA_PROP[q].def
  return t
}
function notaAplicarPreset(t, k) {
  const neutro = notaTablaNeutra()
  t.set(neutro)
  if (k <= 0 || k >= PRESET_PERSONALIZADO) return
  const rampa = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)))
  for (let n = NOTA_MIN; n <= NOTA_MAX; n++) {
    const o = (n - NOTA_MIN) * N_PROPS
    const grave = rampa(60, 21, n)
    const agudo = rampa(60, 96, n)
    if (k === 1) { // Calido worship
      t[o + 3] = 10 + 60 * grave
      t[o + 0] = 1.5 * rampa(55, 21, n) - 1.0 * rampa(84, 108, n)
      t[o + 2] = -10 - 55 * agudo
      t[o + 5] = 125 + 25 * grave
      t[o + 4] = 110
      t[o + 6] = 85
    } else if (k === 2) { // Intimo
      t[o + 6] = 55
      t[o + 2] = -35 - 20 * agudo
      t[o + 0] = -1
      t[o + 8] = -25
      t[o + 3] = 15 + 15 * grave
      t[o + 4] = 95
      t[o + 5] = 110
    } else if (k === 3) { // Brillante pop
      t[o + 2] = 30 + 25 * agudo
      t[o + 6] = 135
      t[o + 3] = 10 * grave
      t[o + 4] = 90
      t[o + 5] = 85
      t[o + 8] = 15
    }
    for (let q = 0; q < N_PROPS; q++) t[o + q] = clamp(t[o + q], NOTA_PROP[q].min, NOTA_PROP[q].max)
  }
}
const FORMA_NEUTRA = { gain: 1, cents: 0, tone: 0, body: 0, decay: 1, release: 1, hammer: 1, pan: 0, velGamma: 1, neutra: true }
function notaForma(t, i) {
  const o = i * N_PROPS
  const f = {
    gain: Math.pow(10, t[o] / 20), cents: t[o + 1], tone: t[o + 2] / 100, body: t[o + 3] / 100, decay: t[o + 4] / 100,
    release: t[o + 5] / 100, hammer: t[o + 6] / 100, pan: t[o + 7] / 100, velGamma: Math.pow(2, t[o + 8] / 100), neutra: true,
  }
  for (let q = 0; q < N_PROPS; q++) if (t[o + q] !== NOTA_PROP[q].def) f.neutra = false
  return f
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const dbToLin = (db) => Math.pow(10, db * 0.05)

// xorshift32 por voz (sin Math.random)
function xorshift(s) {
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return s >>> 0
}
const rnd01 = (s) => (s >>> 8) / 16777216

// Saturacion suave: lineal hasta T, despues tanh hacia el techo C (derivada continua; nunca clamp duro)
function softClip(x) {
  const T = 0.72
  const C = 0.97
  const a = Math.abs(x)
  if (a <= T) return x
  const y = T + (C - T) * Math.tanh((a - T) / (C - T))
  return x < 0 ? -y : y
}

// Suavizado exponencial (= Smoother de jw_dsp.h)
class Smoother {
  constructor(sr, ms) { this.sr = sr; this.tau = Math.max(0.1, ms) * 0.001; this.cur = 0; this.tgt = 0 }
  reset(v) { this.cur = this.tgt = v }
  advance(n) {
    if (this.cur === this.tgt) return this.cur
    const a = 1 - Math.exp(-n / (this.tau * this.sr))
    this.cur += (this.tgt - this.cur) * a
    if (Math.abs(this.tgt - this.cur) < 1e-6 * Math.max(1, Math.abs(this.tgt))) this.cur = this.tgt
    return this.cur
  }
}

// Biquad RBJ (HighPass / LowPass / Bell), forma transpuesta II, coeficientes normalizados
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0 }
  design(type, sr, freq, gainDb, q) {
    freq = clamp(freq, 10, sr * 0.499)
    q = clamp(q, 0.05, 40)
    const w0 = (TWO_PI * freq) / sr
    const cw = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * q)
    const A = Math.pow(10, gainDb / 40)
    let b0, b1, b2, a0, a1, a2
    if (type === 'bell') {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
    } else if (type === 'hp') {
      b0 = (1 + cw) * 0.5; b1 = -(1 + cw); b2 = (1 + cw) * 0.5
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    } else {
      b0 = (1 - cw) * 0.5; b1 = 1 - cw; b2 = (1 - cw) * 0.5
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    }
    const inv = 1 / a0
    this.b0 = b0 * inv; this.b1 = b1 * inv; this.b2 = b2 * inv; this.a1 = a1 * inv; this.a2 = a2 * inv
  }
  reset() { this.z1 = this.z2 = 0 }
  process(x) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

// Lista de resonadores de 2 polos (estructura de arrays, relleno a multiplo de 4):
//   y[n] = c y[n-1] - r2 y[n-2],  c = 2 r cos(w)
class OscList {
  constructor(cap) {
    this.cap = cap
    this.n = 0
    this.c = new Float64Array(cap)
    this.r2 = new Float64Array(cap)
    this.y1 = new Float64Array(cap)
    this.y2 = new Float64Array(cap)
    this.w = new Float64Array(cap)
    this.r = new Float64Array(cap)
  }
  clear() { this.n = 0 }
  add(wi, ri, amp, phi, ratio) {
    const n = this.n
    if (n >= this.cap) return
    const wr = wi * ratio
    this.w[n] = wi; this.r[n] = ri; this.r2[n] = ri * ri; this.c[n] = 2 * ri * Math.cos(wr)
    this.y2[n] = amp * Math.sin(phi)
    this.y1[n] = amp * ri * Math.sin(wr + phi)
    this.n = n + 1
  }
  pad() {
    while (this.n & 3) {
      const n = this.n
      this.c[n] = this.r2[n] = this.y1[n] = this.y2[n] = this.w[n] = this.r[n] = 0
      this.n = n + 1
    }
  }
  retune(ratio) {
    for (let i = 0; i < this.n; i++) this.c[i] = 2 * this.r[i] * Math.cos(this.w[i] * ratio)
  }
  // out[i] += suma de los resonadores
  render(out, m) {
    const { c, r2, y1, y2, n } = this
    for (let g = 0; g < n; g += 4) {
      const c0 = c[g], c1 = c[g + 1], c2 = c[g + 2], c3 = c[g + 3]
      const a0 = r2[g], a1 = r2[g + 1], a2 = r2[g + 2], a3 = r2[g + 3]
      let p0 = y1[g], p1 = y1[g + 1], p2 = y1[g + 2], p3 = y1[g + 3]
      let q0 = y2[g], q1 = y2[g + 1], q2 = y2[g + 2], q3 = y2[g + 3]
      for (let i = 0; i < m; i++) {
        out[i] += p0 + p1 + (p2 + p3)
        const n0 = c0 * p0 - a0 * q0, n1 = c1 * p1 - a1 * q1, n2 = c2 * p2 - a2 * q2, n3 = c3 * p3 - a3 * q3
        q0 = p0; q1 = p1; q2 = p2; q3 = p3
        p0 = n0; p1 = n1; p2 = n2; p3 = n3
      }
      y1[g] = p0; y1[g + 1] = p1; y1[g + 2] = p2; y1[g + 3] = p3
      y2[g] = q0; y2[g + 1] = q1; y2[g + 2] = q2; y2[g + 3] = q3
    }
  }
}

// Reverb de sala: FDN de 8 lineas (Householder), difusores, predelay, lineas moduladas, amortiguacion de agudos
class HallReverb {
  constructor(sr) {
    const N = 8
    const base = [1433, 1637, 1877, 2131, 2371, 2647, 2909, 3203]
    this.rate = [0.11, 0.17, 0.23, 0.29, 0.13, 0.19, 0.31, 0.37]
    const scale = sr / 48000
    this.sr = sr
    this.N = N
    this.modDepth = Math.max(2, 0.0005 * sr)
    this.len = new Int32Array(N)
    this.w = new Int32Array(N)
    this.g = new Float64Array(N)
    this.lp = new Float64Array(N)
    this.cur = new Float64Array(N)
    this.nd = new Float64Array(N)
    this.phase = new Float64Array(N)
    this.v = new Float64Array(N)
    this.buf = []
    for (let i = 0; i < N; i++) {
      this.len[i] = Math.max(64, Math.round(base[i] * scale) | 1)
      this.buf.push(new Float64Array(this.len[i] + Math.floor(this.modDepth) + 8))
      this.g[i] = Math.pow(10, (-3 * this.len[i]) / (2.4 * sr))
      this.cur[i] = this.len[i]
      this.phase[i] = i * 0.137 - Math.floor(i * 0.137)
    }
    this.damp = Math.exp((-TWO_PI * Math.min(9500, 0.45 * sr)) / sr)
    this.pdLen = Math.max(1, Math.floor(0.018 * sr))
    this.pdL = new Float64Array(this.pdLen)
    this.pdR = new Float64Array(this.pdLen)
    this.pdW = 0
    const apLen = [142, 107, 163, 127]
    this.apB = apLen.map((l) => new Float64Array(Math.max(8, Math.round(l * scale))))
    this.apW = new Int32Array(4)
  }
  reset() {
    for (let i = 0; i < this.N; i++) { this.buf[i].fill(0); this.lp[i] = 0; this.w[i] = 0; this.cur[i] = this.len[i] }
    this.pdL.fill(0); this.pdR.fill(0); this.pdW = 0
    for (let i = 0; i < 4; i++) { this.apB[i].fill(0); this.apW[i] = 0 }
  }
  maxLoopGain() { let m = 0; for (let i = 0; i < this.N; i++) m = Math.max(m, this.g[i]); return m }
  ap(i, x) {
    const b = this.apB[i]
    const w = this.apW[i]
    const d = b[w]
    const v = x + 0.6 * d
    b[w] = v
    this.apW[i] = w + 1 >= b.length ? 0 : w + 1
    return -0.6 * v + d
  }
  process(inL, inR, oL, oR, m) {
    const N = this.N
    const { nd, cur, len, w, g, lp, v, buf, damp } = this
    for (let i = 0; i < N; i++) {
      this.phase[i] += (this.rate[i] * m) / this.sr
      this.phase[i] -= Math.floor(this.phase[i])
      nd[i] = len[i] + this.modDepth * Math.sin(TWO_PI * this.phase[i])
    }
    for (let s = 0; s < m; s++) {
      let xl = this.pdL[this.pdW]
      let xr = this.pdR[this.pdW]
      this.pdL[this.pdW] = inL[s]
      this.pdR[this.pdW] = inR[s]
      if (++this.pdW >= this.pdLen) this.pdW = 0
      xl = this.ap(1, this.ap(0, xl))
      xr = this.ap(3, this.ap(2, xr))
      const t = (s + 1) / m
      let sum = 0
      for (let i = 0; i < N; i++) {
        const d = cur[i] + (nd[i] - cur[i]) * t
        const di = Math.floor(d)
        const fr = d - di
        const b = buf[i]
        const sz = b.length
        let i1 = w[i] - di
        if (i1 < 0) i1 += sz
        let i2 = i1 - 1
        if (i2 < 0) i2 += sz
        const y = b[i1] * (1 - fr) + b[i2] * fr
        lp[i] = y + damp * (lp[i] - y)
        v[i] = lp[i] * g[i]
        sum += v[i]
      }
      const fb = sum * (2 / N)
      for (let i = 0; i < N; i++) {
        const b = buf[i]
        b[w[i]] = ((i & 1) ? xr : xl) * 0.5 + v[i] - fb
        if (++w[i] >= b.length) w[i] = 0
      }
      oL[s] = 0.5 * (v[0] - v[2] + (v[4] - v[6]) + 0.35 * (v[1] + v[5]))
      oR[s] = 0.5 * (v[1] - v[3] + (v[5] - v[7]) + 0.35 * (v[2] + v[6]))
    }
    for (let i = 0; i < N; i++) cur[i] = nd[i]
  }
}

class Voice {
  constructor() {
    this.active = false; this.keyUp = false; this.killing = false; this.damperFired = false; this.nzOn = false
    this.note = -1; this.order = 0; this.age = 0
    this.s0 = new OscList(16); this.s1 = new OscList(64); this.s2 = new OscList(16)
    this.gl = new Float64Array(3); this.gr = new Float64Array(3); this.gcL = 0.7071; this.gcR = 0.7071
    this.att = 1; this.attCoef = 0.9; this.prm = 1; this.prmCoef = 0.9999; this.prmFrac = 0.4
    this.damp = 1; this.relK = 0; this.killEnv = 1; this.killStep = 0; this.peak = 0
    this.rng = 1
    this.tl = 0; this.tA = 0.1; this.tAmp = 0; this.tDec = 0.999
    this.ch = 0; this.cl = 0; this.chA = 0.5; this.clA = 0.1; this.cAmp = 0; this.cDec = 0.99
    this.rl = 0; this.rA = 0.1; this.rAmp = 0; this.rDec = 0.99
    this.hamA = 0; this.hamE = 1; this.hamK = 0.999
  }
}

class Motor {
  constructor(sampleRate) {
    const sr = sampleRate > 0 ? sampleRate : 48000
    this.sr = sr
    // ajustes (valores planos)
    this.p = {}
    for (const d of PARAM_DEFS) this.p[d.id] = d.def
    this.voices = []
    for (let i = 0; i < SLOTS; i++) this.voices.push(new Voice())
    this.vol = new Smoother(sr, 20)
    this.wet = new Smoother(sr, 8)
    this.width = new Smoother(sr, 30)
    this.vol.reset(dbToLin(this.p[7]))
    this.wet.reset(1)
    this.width.reset(this.p[9] / 75)
    this.killLen = Math.max(16, Math.floor(0.005 * sr))
    this.retrigLen = Math.max(32, Math.floor(0.03 * sr))
    this.order = 0
    this.pedal = 0; this.pedalTarget = 0; this.damperD = 1
    this.bend = 0; this.bendTarget = 0; this.bendApplied = 0
    this.symAmount = 1
    this.maxVoices = MAX_VOICES
    this.nota = notaTablaNeutra()
    this.formas = []
    for (let i = 0; i < NOTAS; i++) this.formas.push(notaForma(this.nota, i))
    this.lastPre = 0
    this.reverb = new HallReverb(sr)
    this.fx = new FxRack(sr) // FX Rack comun (apagado de serie)
    // buffers de trabajo
    const mk = () => new Float64Array(BLK)
    this.t0 = mk(); this.t1 = mk(); this.t2 = mk(); this.dryL = mk(); this.dryR = mk()
    this.wetL = mk(); this.wetR = mk(); this.symDrive = mk(); this.symL = mk(); this.symR = mk()
    this.outL = mk(); this.outR = mk()
    // cuerdas simpaticas
    this.sc = new Float64Array(SYM_N); this.sr2 = new Float64Array(SYM_N); this.sg = new Float64Array(SYM_N)
    this.sgl = new Float64Array(SYM_N); this.sgr = new Float64Array(SYM_N)
    this.sy1 = new Float64Array(SYM_N); this.sy2 = new Float64Array(SYM_N)
    this.symLive = false
    this.designSympathetic()
    // cuerpo
    this.bodyL = []; this.bodyR = []
    for (let i = 0; i < BODY_N; i++) { this.bodyL.push(new Biquad()); this.bodyR.push(new Biquad()) }
    this.designBody()
  }

  // ---- parametros -------------------------------------------------------------------
  setParam(id, value) {
    if (typeof id === 'string') id = PARAM_IDS[id]
    if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { this.fx.setParam(id, value); return } // FX Rack comun (ids >= 100)
    if (id === undefined || !(id in this.p) || !Number.isFinite(value)) return
    const d = PARAM_DEFS[id]
    value = clamp(value, d.min, d.max)
    const prev = this.p[id]
    this.p[id] = value
    if (id === 7) this.vol.tgt = dbToLin(value)
    else if (id === 6) this.wet.tgt = value >= 0.5 ? 0 : 1
    else if (id === 9) this.width.tgt = value / 75
    else if (id === 8 && value !== prev) this.designSympathetic()
    else if (id === 10) this.setPedal(value / 100)
    else if (id === 12) { this.p[12] = Math.round(value); this.notaMostrar() }
    else if (id >= 13 && id <= 21) this.escribirNota(this.p[12], id - 13, value, false)
    else if (id === 22) {
      const k = Math.round(value)
      this.p[22] = k
      if (k !== this.lastPre) {
        this.lastPre = k
        if (k >= 0 && k < PRESET_PERSONALIZADO) {
          notaAplicarPreset(this.nota, k)
          for (let i = 0; i < NOTAS; i++) this.formas[i] = notaForma(this.nota, i)
          this.notaMostrar()
        }
      }
    }
  }
  // ---- editor nota a nota ----
  /** Los parametros note_gain..note_vel_curve pasan a mostrar la entrada de la nota elegida. */
  notaMostrar() {
    const o = (this.p[12] - NOTA_MIN) * N_PROPS
    for (let q = 0; q < N_PROPS; q++) this.p[13 + q] = this.nota[o + q]
  }
  /** Escribe una propiedad de una nota (como la orden de edicion del VST3). `prop` = 0..8 (gain, tune, tone, body, decay, release, hammer, pan, vel_curve). */
  escribirNota(nota, prop, valor, mostrar = true) {
    nota = Math.round(nota)
    if (!(nota >= NOTA_MIN && nota <= NOTA_MAX) || !(prop >= 0 && prop < N_PROPS) || !Number.isFinite(valor)) return
    const d = NOTA_PROP[prop]
    const v = clamp(valor, d.min, d.max)
    const i = (nota - NOTA_MIN) * N_PROPS + prop
    if (this.nota[i] === v) return
    this.nota[i] = v
    this.formas[nota - NOTA_MIN] = notaForma(this.nota, nota - NOTA_MIN)
    this.p[22] = PRESET_PERSONALIZADO
    this.lastPre = PRESET_PERSONALIZADO
    if (mostrar && nota === this.p[12]) this.p[13 + prop] = v
  }
  leerNota(nota, prop) { return this.nota[(Math.round(nota) - NOTA_MIN) * N_PROPS + prop] }
  forma(nota) { return nota >= NOTA_MIN && nota <= NOTA_MAX ? this.formas[nota - NOTA_MIN] : FORMA_NEUTRA }
  setPedal(v01) { this.pedalTarget = clamp(v01, 0, 1) }
  pitchBend(semitonos) { this.bendTarget = clamp(semitonos, -12, 12) }
  setSympathetic(a) { this.symAmount = clamp(a, 0, 1) }
  setMaxVoices(n) { this.maxVoices = clamp(Math.floor(n), 1, MAX_VOICES) }
  cc(num, valor) {
    if (num === 64) this.setPedal(valor / 127)
    else if (num === 123) this.allNotesOff()
    else if (num === 120) this.panic()
  }
  fundamental(note) { return this.p[8] * Math.pow(2, (note - 69) / 12) }
  activeVoices() { let a = 0; for (let i = 0; i < SLOTS; i++) if (this.voices[i].active) a++; return a }

  // Silencio inmediato: voces, cuerdas simpaticas y cola de la sala
  panic() {
    for (const v of this.voices) v.active = false
    this.pedal = this.pedalTarget = 0
    this.bend = this.bendTarget = this.bendApplied = 0
    this.order = 0
    this.sy1.fill(0); this.sy2.fill(0); this.symLive = false
    this.reverb.reset()
    this.fx.reset()
    for (const b of this.bodyL) b.reset()
    for (const b of this.bodyR) b.reset()
    this.updateDamperAmount()
  }
  /** Tempo del anfitrion (bpm) para el delay sincronizado del FX Rack. */
  setTempo(bpm) { this.fx.setTempo(bpm) }

  // ---- notas ------------------------------------------------------------------------
  noteOn(nota, vel) {
    if (!(nota >= 0 && nota <= 127)) return
    nota = Math.floor(nota)
    if (!(vel > 0)) { this.noteOff(nota); return }
    if (vel > 1) vel = Math.min(1, vel / 127)
    const nf = this.forma(nota)
    if (!nf.neutra && nf.velGamma !== 1) vel = Math.pow(clamp(vel, 1 / 127, 1), nf.velGamma) // curva de velocidad de la nota
    for (const v of this.voices) if (v.active && !v.killing && v.note === nota) this.beginKill(v, this.retrigLen)
    let freeV = null
    let used = 0
    for (const v of this.voices) {
      if (v.active) { if (!v.killing) used++ } else if (!freeV) freeV = v
    }
    if (used >= this.maxVoices) {
      // robo: la voz mas antigua (primero entre las ya soltadas), con fundido corto
      let victim = null
      for (let pass = 0; pass < 2 && !victim; pass++) {
        for (const v of this.voices) {
          if (!v.active || v.killing) continue
          if (pass === 0 && !v.keyUp) continue
          if (!victim || v.order < victim.order) victim = v
        }
      }
      if (victim) this.beginKill(victim, this.killLen)
    }
    if (!freeV) {
      for (const v of this.voices) if (v.killing && (!freeV || v.killEnv < freeV.killEnv)) freeV = v
    }
    if (freeV) this.start(freeV, nota, vel)
  }
  noteOff(nota) {
    for (const v of this.voices) {
      if (!v.active || v.killing || v.note !== nota || v.keyUp) continue
      v.keyUp = true
      const t60 = Math.max(0.02, this.p[2]) * this.forma(nota).release * (0.7 + 0.5 * Math.pow(110 / this.fundamental(nota), 0.4))
      v.relK = 6.907755 / (t60 * this.sr)
      if (this.damperD > 0.5) this.fireDamper(v)
    }
  }
  allNotesOff() {
    for (const v of this.voices) {
      if (v.active && !v.killing) { v.keyUp = true; v.relK = 6.907755 / (Math.max(0.02, this.p[2]) * this.sr) }
    }
  }
  beginKill(v, len) { v.killing = true; v.killStep = Math.max(1e-9, v.killEnv / Math.max(1, len)) }
  fireDamper(v) {
    v.damperFired = true
    const amp = Math.min(0.02, 0.05 * v.peak)
    if (amp < 2e-5) return
    v.rA = 1 - Math.exp((-TWO_PI * 650) / this.sr)
    v.rAmp = amp / (0.577 * Math.sqrt(v.rA / (2 - v.rA)))
    v.rDec = Math.exp(-1 / (0.01 * this.sr))
    v.nzOn = true
  }
  updateDamperAmount() { const q = 1 - this.pedal; this.damperD = q * q }

  // ---- inicio de nota (idem start() de grand_piano_dsp.h) -------------------------------
  start(v, note, velIn) {
    const sr = this.sr
    const p = this.p
    const nf = this.forma(note) // afinacion/timbre por nota
    const f0 = nf.cents !== 0 ? this.fundamental(note) * Math.pow(2, nf.cents / 1200) : this.fundamental(note)
    v.active = true; v.keyUp = false; v.killing = false; v.damperFired = false; v.nzOn = false
    v.note = note; v.order = ++this.order; v.age = 0
    v.damp = 1; v.relK = 0; v.killEnv = 1; v.killStep = 0; v.peak = 0
    v.s0.clear(); v.s1.clear(); v.s2.clear()
    let rng = (0x9e3779b9 ^ (note * 7919 + ((this.order * 104729) | 0) + Math.floor(velIn * 1000))) >>> 0
    if (rng === 0) rng = 0x1234567
    for (let i = 0; i < 4; i++) rng = xorshift(rng)

    // velocidad: curva, nivel y timbre
    const gamma = Math.pow(2, (50 - p[3]) / 50)
    const vq = Math.pow(clamp(velIn, 1 / 127, 1), gamma)
    rng = xorshift(rng)
    const jitter = 1 + 0.04 * (rnd01(rng) * 2 - 1)
    const una = p[11] >= 0.5 ? 1 : 0
    const ampV = (0.012 + 0.988 * Math.pow(vq, 1.7)) * jitter * (1 - 0.18 * una) * nf.gain
    const brightMul = 0.25 * Math.pow(12, p[4] / 100)
    let fc = (420 + 9000 * Math.pow(vq, 1.5)) * brightMul * (1 - 0.35 * una)
    fc *= Math.pow(1 + f0 / 800, 0.35) / (1 + p[0] / 25)
    if (nf.tone !== 0) fc *= Math.pow(2, nf.tone * 1.5) // tono por nota: +-1,5 octavas del filtro de fieltro
    fc = clamp(fc, 300, 20000)

    // cuerdas por nota y desafinaciones (cents)
    let nS = note < 36 ? 1 : note < 48 ? 2 : 3
    if (una && nS > 1) nS--
    rng = xorshift(rng); const d1 = 0.25 + 0.85 * rnd01(rng)
    rng = xorshift(rng); const d2 = 0.25 + 0.85 * rnd01(rng)
    const cents = [0, 0, 0]
    const dm = [1, 1, 1]
    if (nS === 2) { cents[0] = d1; cents[2] = -d2; dm[0] = 1.5; dm[2] = 0.7 }
    else if (nS === 3) { cents[0] = -d1; cents[1] = 0; cents[2] = d2; dm[0] = 1.6; dm[1] = 1; dm[2] = 0.65 }
    const kd = nS === 1 ? 0 : nS === 2 ? 6 : 5

    // inarmonicidad B (cuerda rigida) por registro
    const B = note < 48 ? 6e-5 + (48 - note) * 5e-6 : 6e-5 * Math.exp(0.07 * (note - 48))

    // decaimiento base (T60 del 1er parcial) y bifasico
    const decayScale = 0.35 * Math.pow(5.14, p[1] / 100)
    const t60a = clamp(26 * Math.pow(110 / f0, 0.55) * decayScale * nf.decay, 0.4, 120)
    const alpha1 = 6.907755 / t60a

    // espectro del martillo
    const beta = 0.125 - 0.03 * clamp((note - 60) / 48, 0, 1)
    const fmax = Math.min(0.45 * sr, 11000)
    const fk = this._fk, ak = this._ak
    let K = 0
    let s2sum = 0
    for (let k = 1; k <= MAX_PARTIALS; k++) {
      const f = k * f0 * Math.sqrt((1 + B * k * k) / (1 + B))
      if (f >= fmax) break
      const ex = 0.08 + Math.abs(Math.sin(Math.PI * k * beta))
      const rad = 1 / (1 + Math.pow(140 / f, 1.6))
      const lp = 1 / (1 + Math.pow(f / fc, 2.6))
      let a = ex * Math.pow(k, -0.85) * rad * lp
      if (nf.tone !== 0) a *= Math.pow(k, 0.6 * nf.tone) // inclinacion espectral por nota
      fk[K] = f; ak[K] = a; K++
      s2sum += a * a
    }
    if (K === 0) { v.active = false; return }
    // afinacion "estirada": el centro de energia espectral cae en f0
    let num = 0
    for (let k = 0; k < K; k++) num += ak[k] * ak[k] * (fk[k] / ((k + 1) * f0))
    const stretch = clamp(num / s2sum, 1, 1.0145)
    for (let k = 0; k < K; k++) fk[k] /= stretch
    const rms = Math.sqrt(s2sum)
    const voiceRef = ampV * 0.2
    const load = 1 + this.activeVoices() / 20
    const bendRatio = Math.pow(2, this.bendApplied / 12)

    for (let k = 0; k < K; k++) {
      let rel = ak[k] / rms
      if (k < 3 && nf.body !== 0) rel *= Math.pow(10, (nf.body * 9 * BODY_SHARE[k]) / 20) // cuerpo: realce de la fundamental y graves
      if (ampV * rel * load < 8e-4 && k > 0) continue
      const amp = voiceRef * rel * 1.4142
      const fq = fk[k]
      const hfd = 1 + (fq / 2300) * (fq / 2300)
      let ph = 0
      if (k >= 2) { rng = xorshift(rng); ph = 0.7 * (rnd01(rng) * 2 - 1) }
      const wBase = (TWO_PI * fq) / sr
      if (k < kd) {
        const aS = amp / nS
        if (nS === 2) {
          for (let si = 0; si < 3; si += 2) {
            const w = wBase * Math.pow(2, cents[si] / 1200)
            const r = Math.exp((-alpha1 * dm[si] * hfd) / sr)
            if (si === 0) v.s0.add(w, r, aS, ph, bendRatio)
            else v.s2.add(w, r, aS, ph + 0.2, bendRatio)
          }
        } else {
          for (let si = 0; si < 3; si++) {
            const w = wBase * Math.pow(2, cents[si] / 1200)
            const r = Math.exp((-alpha1 * dm[si] * hfd) / sr)
            if (si === 0) v.s0.add(w, r, aS, ph, bendRatio)
            else if (si === 1) v.s1.add(w, r, aS, ph, bendRatio)
            else v.s2.add(w, r, aS, ph + 0.2, bendRatio)
          }
        }
      } else {
        const r = Math.exp((-alpha1 * hfd) / sr)
        v.s1.add(wBase, r, amp, ph, bendRatio)
      }
    }
    v.s0.pad(); v.s1.pad(); v.s2.pad()

    // paneo (vista del pianista: graves a la izquierda) y cuerdas del unisono
    const pv = clamp(clamp((note - 64.5) / 43.5, -1, 1) * 0.7 + nf.pan, -1, 1)
    const pans = [pv - 0.22, pv, pv + 0.22]
    for (let i = 0; i < 3; i++) {
      const pp = clamp(pans[i], -1, 1)
      v.gl[i] = Math.cos((pp + 1) * Math.PI * 0.25)
      v.gr[i] = Math.sin((pp + 1) * Math.PI * 0.25)
    }
    v.gcL = Math.cos((pv + 1) * Math.PI * 0.25)
    v.gcR = Math.sin((pv + 1) * Math.PI * 0.25)

    // envolventes: ataque (contacto del martillo) y prompt bifasico
    const tauA = Math.max(0.0002, (p[0] * 0.001) / 3)
    v.att = 1
    v.attCoef = Math.exp(-1 / (tauA * sr))
    v.prmFrac = (note < 60 ? 0.4 : 0.5) * (0.7 + 0.3 * vq)
    v.prm = 1
    v.prmCoef = Math.exp(-1 / (0.45 * Math.pow(220 / f0, 0.25) * sr))

    // ruido de martillo: thump grave + click de ataque
    const fT = clamp(f0 * 2.2, 90, 520)
    v.tA = 1 - Math.exp((-TWO_PI * fT) / sr)
    const tRms = voiceRef * 0.55 * Math.pow(vq, 1.4) * nf.hammer
    v.tAmp = tRms / (0.577 * Math.sqrt(v.tA / (2 - v.tA)))
    v.tDec = Math.exp(-1 / ((0.012 + 0.018 * (1 - vq)) * sr))
    const fHi = Math.min(0.4 * sr, 5200 * (0.7 + 0.3 * brightMul))
    v.chA = 1 - Math.exp((-TWO_PI * fHi) / sr)
    v.clA = 1 - Math.exp((-TWO_PI * 1200) / sr)
    const cRms = voiceRef * 0.3 * vq * vq * (una ? 0.5 : 1) * nf.hammer
    v.cAmp = cRms / (0.577 * Math.sqrt(v.chA / (2 - v.chA)))
    v.cDec = Math.exp(-1 / (0.0035 * sr))
    v.tl = v.ch = v.cl = v.rl = 0
    v.rAmp = 0
    v.rng = rng
    v.nzOn = true
    // martillo por nota: transitorio de 1 + (h - 1) * exp(-t / 20 ms) sobre la voz entera (0 = ataque suavizado)
    v.hamA = nf.hammer - 1; v.hamE = 1; v.hamK = Math.exp(-1 / (0.02 * sr))
  }

  // ---- una voz, m muestras -------------------------------------------------------------
  renderVoice(v, m) {
    const { t0, t1, t2, dryL, dryR } = this
    t0.fill(0, 0, m); t1.fill(0, 0, m); t2.fill(0, 0, m)
    const n0 = v.s0.n, n1 = v.s1.n, n2 = v.s2.n
    const gl0 = n0 ? v.gl[0] : 0, gr0 = n0 ? v.gr[0] : 0
    const gl1 = n1 ? v.gl[1] : 0, gr1 = n1 ? v.gr[1] : 0
    const gl2 = n2 ? v.gl[2] : 0, gr2 = n2 ? v.gr[2] : 0
    if (n0) v.s0.render(t0, m)
    if (n1) v.s1.render(t1, m)
    if (n2) v.s2.render(t2, m)
    const dm = v.keyUp ? Math.exp(-v.relK * this.damperD) : 1
    let pk = 0
    let ea = v.att, prm = v.prm, damp = v.damp
    let hamE = v.hamE
    const hamA = v.hamA, hamK = v.hamK
    const eaC = v.attCoef, prmC = v.prmCoef, pf = v.prmFrac
    const killing = v.killing
    for (let i = 0; i < m; i++) {
      ea *= eaC
      prm *= prmC
      damp *= dm
      let ke = 1
      if (killing) { v.killEnv -= v.killStep; if (v.killEnv < 0) v.killEnv = 0; ke = v.killEnv }
      const g = (1 - ea) * ((1 - pf) + pf * prm) * damp * ke * (1 + hamA * hamE)
      hamE *= hamK
      const a = t0[i], b = t1[i], c = t2[i]
      const mono = Math.abs((a + b + c) * g)
      if (mono > pk) pk = mono
      let l = g * (a * gl0 + b * gl1 + c * gl2)
      let r = g * (a * gr0 + b * gr1 + c * gr2)
      if (v.nzOn) {
        v.rng = xorshift(v.rng)
        const w = rnd01(v.rng) * 2 - 1
        v.tl += v.tA * (w - v.tl)
        v.ch += v.chA * (w - v.ch)
        v.cl += v.clA * (w - v.cl)
        v.rl += v.rA * (w - v.rl)
        const nz = (v.tl * v.tAmp + (v.ch - v.cl) * v.cAmp + v.rl * v.rAmp) * ke
        v.tAmp *= v.tDec; v.cAmp *= v.cDec; v.rAmp *= v.rDec
        l += nz * v.gcL; r += nz * v.gcR
        if (v.tAmp < 1e-7 && v.cAmp < 1e-7 && v.rAmp < 1e-7) v.nzOn = false
      }
      dryL[i] += l
      dryR[i] += r
    }
    v.att = ea < 1e-9 ? 0 : ea
    v.hamE = hamE
    v.prm = prm
    v.damp = damp
    v.peak = pk
    v.age += m
    if (v.killing && v.killEnv <= 0) v.active = false
    else if (v.damp < 1e-5) v.active = false
    else if (v.age > Math.floor(0.08 * this.sr) && pk < 3e-6 && !v.nzOn) v.active = false // energia agotada
  }

  // ---- cuerdas simpaticas -----------------------------------------------------------------
  designSympathetic() {
    for (let i = 0; i < SYM_N; i++) {
      const note = 21 + i
      const f = this.fundamental(note)
      const w = (TWO_PI * f) / this.sr
      const t60 = clamp(3.5 * Math.pow(110 / f, 0.4), 0.8, 8)
      const r = Math.exp(-6.907755 / (t60 * this.sr))
      this.sc[i] = 2 * r * Math.cos(w)
      this.sr2[i] = r * r
      this.sg[i] = 2 * (1 - r) * Math.sin(w)
      const pp = clamp((note - 64.5) / 43.5, -1, 1) * 0.8
      this.sgl[i] = Math.cos((pp + 1) * Math.PI * 0.25)
      this.sgr[i] = Math.sin((pp + 1) * Math.PI * 0.25)
    }
  }
  symDecay(m) {
    const f = Math.exp(-m / (0.03 * this.sr))
    let mx = 0
    for (let i = 0; i < SYM_N; i++) {
      this.sy1[i] *= f; this.sy2[i] *= f
      mx = Math.max(mx, Math.abs(this.sy1[i]))
    }
    if (mx < 1e-9) { this.sy1.fill(0); this.sy2.fill(0); this.symLive = false }
  }
  symProcess(m, gain) {
    const { dryL, dryR, symDrive, symL, symR, sc, sr2, sg, sgl, sgr, sy1, sy2 } = this
    for (let i = 0; i < m; i++) symDrive[i] = 0.5 * (dryL[i] + dryR[i])
    symL.fill(0, 0, m); symR.fill(0, 0, m)
    for (let g = 0; g < SYM_N; g += 4) {
      const c0 = sc[g], c1 = sc[g + 1], c2 = sc[g + 2], c3 = sc[g + 3]
      const a0 = sr2[g], a1 = sr2[g + 1], a2 = sr2[g + 2], a3 = sr2[g + 3]
      const i0 = sg[g], i1 = sg[g + 1], i2 = sg[g + 2], i3 = sg[g + 3]
      const l0 = sgl[g], l1 = sgl[g + 1], l2 = sgl[g + 2], l3 = sgl[g + 3]
      const rr0 = sgr[g], rr1 = sgr[g + 1], rr2 = sgr[g + 2], rr3 = sgr[g + 3]
      let p0 = sy1[g], p1 = sy1[g + 1], p2 = sy1[g + 2], p3 = sy1[g + 3]
      let q0 = sy2[g], q1 = sy2[g + 1], q2 = sy2[g + 2], q3 = sy2[g + 3]
      for (let i = 0; i < m; i++) {
        const x = symDrive[i]
        const n0 = c0 * p0 - a0 * q0 + i0 * x, n1 = c1 * p1 - a1 * q1 + i1 * x
        const n2 = c2 * p2 - a2 * q2 + i2 * x, n3 = c3 * p3 - a3 * q3 + i3 * x
        q0 = p0; q1 = p1; q2 = p2; q3 = p3
        p0 = n0; p1 = n1; p2 = n2; p3 = n3
        symL[i] += n0 * l0 + n1 * l1 + n2 * l2 + n3 * l3
        symR[i] += n0 * rr0 + n1 * rr1 + n2 * rr2 + n3 * rr3
      }
      sy1[g] = p0; sy1[g + 1] = p1; sy1[g + 2] = p2; sy1[g + 3] = p3
      sy2[g] = q0; sy2[g + 1] = q1; sy2[g + 2] = q2; sy2[g + 3] = q3
    }
    for (let i = 0; i < m; i++) { dryL[i] += symL[i] * gain; dryR[i] += symR[i] * gain }
    this.symLive = true
  }

  // ---- cuerpo (tabla armonica) ---------------------------------------------------------------
  designBody() {
    const defs = [
      ['hp', 24, 0, 0.707],
      ['bell', 62, 2, 3], ['bell', 118, 2.2, 4], ['bell', 187, 1.8, 4], ['bell', 305, 1.5, 4],
      ['bell', 520, 1.2, 4], ['bell', 880, -1, 3], ['bell', 1350, 1.2, 2], ['bell', 2400, 0.8, 1.2],
      ['lp', 15500, 0, 0.6],
    ]
    for (let i = 0; i < BODY_N; i++) {
      const [t, f, g, q] = defs[i]
      this.bodyL[i].design(t, this.sr, f, g, q)
      this.bodyR[i].design(t, this.sr, t === 'bell' ? f * 1.037 : f, g, q)
    }
  }

  // ---- sub-bloque ------------------------------------------------------------------------------
  block(m) {
    const sr = this.sr
    const v0 = this.vol.cur, v1 = this.vol.advance(m)
    const w0 = this.wet.cur, w1 = this.wet.advance(m)
    const d0 = this.width.cur, d1 = this.width.advance(m)
    this.pedal += (this.pedalTarget - this.pedal) * (1 - Math.exp(-m / (0.02 * sr)))
    if (Math.abs(this.pedalTarget - this.pedal) < 1e-5) this.pedal = this.pedalTarget
    this.updateDamperAmount()
    this.bend += (this.bendTarget - this.bend) * (1 - Math.exp(-m / (0.015 * sr)))
    if (Math.abs(this.bend - this.bendApplied) > 0.0015) {
      this.bendApplied = this.bend
      const ratio = Math.pow(2, this.bendApplied / 12)
      for (const v of this.voices) if (v.active) { v.s0.retune(ratio); v.s1.retune(ratio); v.s2.retune(ratio) }
    }
    for (const v of this.voices) {
      if (!v.active || !v.keyUp) continue
      if (this.damperD > 0.5 && !v.damperFired) this.fireDamper(v)
      else if (this.damperD < 0.2) v.damperFired = false
    }

    const { dryL, dryR, wetL, wetR, outL, outR, bodyL, bodyR } = this
    dryL.fill(0, 0, m); dryR.fill(0, 0, m)
    for (let i = 0; i < SLOTS; i++) if (this.voices[i].active) this.renderVoice(this.voices[i], m)

    if (this.pedal > 0.05 && this.symAmount > 0) this.symProcess(m, 0.25 * this.pedal * this.symAmount)
    else if (this.symLive) this.symDecay(m)

    for (let i = 0; i < m; i++) {
      const t = (i + 1) / m
      const wd = d0 + (d1 - d0) * t
      const mid = 0.5 * (dryL[i] + dryR[i])
      const side = 0.5 * (dryL[i] - dryR[i]) * wd
      let l = mid + side
      let r = mid - side
      for (let k = 0; k < BODY_N; k++) { l = bodyL[k].process(l); r = bodyR[k].process(r) }
      dryL[i] = l; dryR[i] = r
    }

    this.reverb.process(dryL, dryR, wetL, wetR, m)
    const wg = clamp(this.p[5], 0, 100) * 0.01
    for (let i = 0; i < m; i++) {
      const t = (i + 1) / m
      const g = (v0 + (v1 - v0) * t) * (w0 + (w1 - w0) * t)
      outL[i] = softClip((dryL[i] + wetL[i] * wg) * g)
      outR[i] = softClip((dryR[i] + wetR[i] * wg) * g)
    }
  }

  /** Genera n muestras estereo en outL/outR a partir del indice `off` (sobrescribe). */
  render(outL, outR, n, off) {
    off = off | 0
    let pos = 0
    while (pos < n) {
      const m = Math.min(BLK, n - pos)
      this.block(m)
      const a = this.outL, b = this.outR
      for (let i = 0; i < m; i++) { outL[off + pos + i] = a[i]; outR[off + pos + i] = b[i] }
      pos += m
    }
    this.fx.process(outL, outR, n, off) // FX Rack comun, tras la salida final (apagado: no toca el buffer)
  }
}
// Buffers de trabajo de start() (compartidos por todas las instancias; start no es reentrante)
Motor.prototype._fk = new Float64Array(MAX_PARTIALS)
Motor.prototype._ak = new Float64Array(MAX_PARTIALS)

if (typeof registerProcessor !== 'undefined') {
  class GrandPianoProcessor extends AudioWorkletProcessor {
    constructor() {
      super()
      this.motor = new Motor(sampleRate)
      this.cola = [] // eventos programados {t, tipo, nota, vel}, ordenados por t
      this.port.onmessage = (e) => {
        const m = e.data
        if (!m) return
        if (m.tipo === 'param') this.motor.setParam(m.id, m.valor)
        else if (m.tipo === 'panico') { this.cola.length = 0; this.motor.panic() }
        else if (m.tipo === 'bend') this.motor.pitchBend(m.valor)
        else if (m.tipo === 'cc') this.motor.cc(m.num, m.valor)
        else if (m.tipo === 'tempo') this.motor.setTempo(m.bpm)
        else if (m.tipo === 'on' || m.tipo === 'off') {
          const ev = { t: typeof m.cuando === 'number' ? m.cuando : 0, tipo: m.tipo, nota: m.nota, vel: m.vel }
          let i = this.cola.length
          while (i > 0 && this.cola[i - 1].t > ev.t) i--
          this.cola.splice(i, 0, ev)
        }
      }
    }
    process(_in, outputs) {
      const out = outputs[0]
      if (!out || !out[0]) return true
      const L = out[0]
      const R = out[1] || out[0]
      const n = L.length
      const sr = sampleRate
      let pos = 0
      while (pos < n) {
        // aplica los eventos ya vencidos (media muestra de margen) y renderiza hasta el siguiente
        while (this.cola.length && this.cola[0].t <= currentTime + (pos + 0.5) / sr) {
          const ev = this.cola.shift()
          if (ev.tipo === 'on') this.motor.noteOn(ev.nota, ev.vel)
          else this.motor.noteOff(ev.nota)
        }
        let next = n
        if (this.cola.length) next = Math.min(n, Math.max(pos + 1, Math.ceil((this.cola[0].t - currentTime) * sr - 0.5)))
        this.motor.render(L, R, next - pos, pos)
        pos = next
      }
      for (let c = 2; c < out.length; c++) out[c].set(L)
      return true
    }
  }
  registerProcessor('jaswave-grand-piano', GrandPianoProcessor)
}
if (typeof module !== 'undefined') module.exports = { Motor, PARAMS: PARAM_IDS, PARAM_IDS, PARAM_DEFS, NOTA_PROP, notaTablaNeutra, notaAplicarPreset }
