/* =====================================================================================
 *  JasWave Electric Bass – versión web (AudioWorklet). Mismo diseño que el VST3
 *  (plugins/com.jaswave.plugin.electric-bass/source/electric_bass_dsp.h), portado a JS.
 *
 *  Bajo eléctrico Precision / Jazz por guía de ondas de cuerda (Karplus-Strong extendido):
 *   - lazo de retardo con interpolación Lagrange 4 puntos y compensación EXACTA de la fase del
 *     lazo en f0 (filtro de pérdidas + all-pass de dispersión + Lagrange): afinación < 1 cent;
 *   - excitación de dedo (pulso Hann + ruido) o púa/slap según velocidad y ATTACK; posición del pulso;
 *   - pastilla P/J por peine de posición + resonancia; ghost / palm-mute; apagado de cuerda al soltar;
 *     legato (hammer-on / pull-off) con glissando; pitch bend ±2 st;
 *   - cadena: compresor paralelo, saturación valvular asimétrica 2×, tilt EQ, shelving de graves, soft-clip.
 *
 *  Mensajes del puerto: {tipo:'param', id, valor} (id = ParamID VST3, valor plano) · {tipo:'on', nota, vel, cuando}
 *  · {tipo:'off', nota, cuando} · {tipo:'panico'} · {tipo:'bend', valor} (semitonos) · {tipo:'cc', num, valor} · {tipo:'tempo', bpm}.
 *  FX Rack comun (ids 100..230): setParam(id >= 100, valor) lo enruta a `motor.fx` (shared-dsp/web/fxrack.js, incrustado abajo).
 *  Sin asignaciones en render: todo se preasigna en el constructor. Autocontenido, sin imports.
 * ===================================================================================== */

const PI = Math.PI
const BUF_LEN = 16384
const BUF_MASK = BUF_LEN - 1
const NOISE_LEN = 2048
const CHUNK = 16
const HB_TAPS = 31
const MAX_VOICES = 6
const THR = -24.0
const RATIO = 4.0
const KNEE = 10.0

// IDs de parámetro (= ParamID del VST3 y del manifiesto)
const P = {
  tone: 0, finger_attack: 1, drive: 2, low_boost: 3, compressor_mix: 4, bypass: 5, volume: 6,
  pickup: 7, pluck_pos: 8, sustain: 9, mute: 10, legato: 11, glide: 12, bend: 13,
}

// Tablas de parametros SOLO para el FX Rack comun (ids 100..230); los ids propios (0..19) siguen en DEFAULTS / P
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
const DEFAULTS = [50, 60, 12, 2, 40, 0, 0, 30, 45, 50, 0, 1, 40, 0]

const clampT = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const dbToLinear = (db) => Math.pow(10, db * 0.05)

/** PRNG xorshift32 (sin Math.random en el hilo de audio). */
class Rng {
  constructor() { this.s = 0x2545f491 >>> 0 }
  next() {
    let s = this.s
    s = (s ^ (s << 13)) >>> 0
    s = (s ^ (s >>> 17)) >>> 0
    s = (s ^ (s << 5)) >>> 0
    this.s = s
    return s
  }
  bip() { return (this.next() | 0) * (1 / 2147483648) }
}

class Smoother {
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

/** Biquad RBJ en forma transpuesta directa II (idéntico a JasWaveDsp::BiquadCoefs::design). */
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0 }
  design(type, sr, freq, gainDb, q) {
    freq = clampT(freq, 10, sr * 0.499)
    q = clampT(q, 0.05, 40)
    const w0 = (2 * PI * freq) / sr
    const cw = Math.cos(w0), sw = Math.sin(w0)
    const alpha = sw / (2 * q)
    const A = Math.pow(10, gainDb / 40)
    let b0, b1, b2, a0, a1, a2
    if (type === 'bell') {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
    } else if (type === 'lp') {
      b0 = (1 - cw) * 0.5; b1 = 1 - cw; b2 = (1 - cw) * 0.5
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    } else if (type === 'lowshelf') {
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 - (A - 1) * cw + s2)
      b1 = 2 * A * (A - 1 - (A + 1) * cw)
      b2 = A * (A + 1 - (A - 1) * cw - s2)
      a0 = A + 1 + (A - 1) * cw + s2
      a1 = -2 * (A - 1 + (A + 1) * cw)
      a2 = A + 1 + (A - 1) * cw - s2
    } else { // highshelf
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cw + s2)
      b1 = -2 * A * (A - 1 + (A + 1) * cw)
      b2 = A * (A + 1 + (A - 1) * cw - s2)
      a0 = A + 1 - (A - 1) * cw + s2
      a1 = 2 * (A - 1 - (A + 1) * cw)
      a2 = A + 1 - (A - 1) * cw - s2
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

function lagrange4(d, h) {
  h[0] = -(d - 1) * (d - 2) * (d - 3) * (1 / 6)
  h[1] = d * (d - 2) * (d - 3) * 0.5
  h[2] = -d * (d - 1) * (d - 3) * 0.5
  h[3] = d * (d - 1) * (d - 2) * (1 / 6)
}
function hann(t, W) {
  if (t < 0 || t >= W) return 0
  return 0.5 * (1 - Math.cos((2 * PI * t) / W))
}
function hannMag(fCycles, W) {
  const u = fCycles * W
  const sinc = Math.abs(u) < 1e-9 ? 1 : Math.sin(PI * u) / (PI * u)
  const den = 1 - u * u
  if (Math.abs(den) < 1e-6) return 0.25 * W
  return Math.abs((0.5 * W * sinc) / den)
}
function softClip(x) {
  const a = Math.abs(x)
  if (a <= 0.65) return x
  const y = 0.65 + 0.3 * Math.tanh((a - 0.65) / 0.3)
  return x < 0 ? -y : y
}

class Voice {
  constructor() {
    this.active = false; this.keyDown = false; this.released = false; this.killing = false
    this.note = -1; this.stackN = 0; this.pendingNote = -1
    this.stackNote = new Int32Array(4); this.stackVel = new Float64Array(4)
    this.pendingVel = 0
    this.age = 0; this.order = 0
    this.semi = 40; this.semiTarget = 40; this.glideCoef = 0.1; this.fApplied = 0; this.T = 1000
    this.w = 0; this.n0 = 1
    this.h = new Float64Array([1, 0, 0, 0])
    this.lpB = 0.5; this.lp = 0; this.lpG = 0.999; this.dispA = -0.1; this.dispZ = 0; this.dampG = 1; this.dampT = 1
    this.t60 = 3; this.fcStr = 2000; this.fund = 0.3
    this.env = 1; this.killStep = 0; this.lvl = 1
    this.vel = 0.7; this.mute = 0; this.ghost = 0
    this.exI = 0; this.exN = 0; this.nbN = 0
    this.exA = 0; this.exWp = 100; this.exWs = 10; this.exClick = 0; this.exDp = 100; this.exNz = 0
    this.thEnv = 0; this.thDecay = 0.99; this.thAmp = 0; this.thC = 0.1; this.thZ1 = 0; this.thZ2 = 0; this.thNorm = 1
    this.rnLeft = 0; this.rnAmp = 0; this.rnEnv = 0; this.rnDecay = 0.99; this.rnZ = 0; this.rnC = 0.3
    this.rng = new Rng()
    this.nb = new Float64Array(NOISE_LEN)
    this.buf = new Float64Array(BUF_LEN)
    this.yh = new Float32Array(BUF_LEN)
  }
}

class Motor {
  constructor(sampleRate) {
    this.sr = sampleRate > 0 ? sampleRate : 48000
    this.plain = DEFAULTS.slice()
    this.s = {
      tone: 0.28, fingerAttack: 0.25, drive: 0.03, lowBoostDb: 5, compMix: 0.5, volumeDb: 0,
      pickupMix: 0.15, pluckPos: 0.55, sustain: 0.75, mute: 0, glideMs: 40, bendSt: 0, legato: true, bypass: false,
    }
    this.extBend = 0
    this.bendNow = 0
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice())
    this.vol = new Smoother(); this.wet = new Smoother(); this.mixSm = new Smoother()
    this.driveSm = new Smoother(); this.pickSm = new Smoother(); this.bendSm = new Smoother()
    this.pkBody = new Biquad(); this.pkBell = new Biquad(); this.pkLp = new Biquad()
    this.tiltLo = new Biquad(); this.tiltHi = new Biquad(); this.toneLp = new Biquad(); this.sub = new Biquad()
    this.mixBuf = new Float64Array(CHUNK)
    this.hb = new Float64Array(HB_TAPS)
    this.nz = new Int32Array(HB_TAPS); this.nzN = 0
    this.upBuf = new Float64Array(2 * HB_TAPS); this.dnBuf = new Float64Array(2 * HB_TAPS)
    this.upPos = 0; this.dnPos = 0
    this.lagH = new Float64Array(4)
    this.u = new Float64Array(2)
    this.noteCounter = 0; this.order = 0
    this.grS = 0; this.pkEnv = 0
    this.dc1x = 0; this.dc1y = 0; this.dc2x = 0; this.dc2y = 0
    this.fx = new FxRack(this.sr)   // FX Rack comun: se aplica DESPUES de toda la cadena del bajo
    this.designHalfband()
    this.prepare()
  }

  prepare() {
    const sr = this.sr
    this.vol.prepare(sr, 20); this.wet.prepare(sr, 8)
    this.mixSm.prepare(sr, 30); this.driveSm.prepare(sr, 30); this.pickSm.prepare(sr, 30); this.bendSm.prepare(sr, 15)
    this.vol.reset(dbToLinear(this.s.volumeDb)); this.wet.reset(this.s.bypass ? 0 : 1)
    this.mixSm.reset(this.s.compMix); this.driveSm.reset(this.s.drive); this.pickSm.reset(this.s.pickupMix)
    this.bendSm.reset(this.s.bendSt)
    this.killLen = Math.max(16, Math.floor(0.005 * sr))
    this.lvlDecay = 1 - 1 / (0.03 * sr)
    this.slew = 1 - Math.exp(-1 / (0.004 * sr))
    this.compAtk = 1 - Math.exp(-1 / (0.002 * sr))
    this.pkRel = Math.exp(-1 / (0.08 * sr))
    this.compRel = 1 - Math.exp(-1 / (0.15 * sr))
    this.dcR = 1 - (2 * PI * 18) / sr
    this.designChain()
    this.reset()
  }

  reset() {
    for (const v of this.voices) v.active = false
    for (const b of [this.pkBody, this.pkBell, this.pkLp, this.tiltLo, this.tiltHi, this.toneLp, this.sub]) b.reset()
    this.pkEnv = 0; this.grS = 0
    this.dc1x = this.dc1y = this.dc2x = this.dc2y = 0
    this.upBuf.fill(0); this.dnBuf.fill(0); this.upPos = this.dnPos = 0
    this.bendNow = this.s.bendSt
    this.bendSm.reset(this.s.bendSt)
    this.noteCounter = 0; this.order = 0
    this.fx.reset()
  }

  /** Tempo del anfitrion (bpm) para la sincronia del delay del rack. */
  setTempo(bpm) { this.fx.setTempo(bpm) }

  // ------------------------------------------------------------- API pública
  setParam(id, valor) {
    if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { this.fx.setParam(id, valor); return }
    if (!(id >= 0 && id < DEFAULTS.length) || !Number.isFinite(valor)) return
    this.plain[id] = valor
    const p = this.plain, s = this.s
    s.tone = p[P.tone] / 100; s.fingerAttack = p[P.finger_attack] / 100; s.drive = p[P.drive] / 100
    s.lowBoostDb = p[P.low_boost]; s.compMix = p[P.compressor_mix] / 100; s.volumeDb = p[P.volume]
    s.pickupMix = p[P.pickup] / 100; s.pluckPos = p[P.pluck_pos] / 100; s.sustain = p[P.sustain] / 100
    s.mute = p[P.mute] / 100; s.legato = p[P.legato] >= 0.5; s.glideMs = p[P.glide]; s.bendSt = p[P.bend]
    s.bypass = p[P.bypass] >= 0.5
    this.vol.setTarget(dbToLinear(s.volumeDb)); this.wet.setTarget(s.bypass ? 0 : 1)
    this.mixSm.setTarget(s.compMix); this.driveSm.setTarget(s.drive); this.pickSm.setTarget(s.pickupMix)
    this.bendSm.setTarget(clampT(s.bendSt + this.extBend, -2, 2))
    this.designChain()
  }

  noteOn(note, velIn) {
    note = note | 0
    if (note < 12 || note > 96) return
    if (!(velIn > 0)) { this.noteOff(note); return }
    const vel = clampT(velIn, 0, 1)
    const voices = this.voices
    for (const v of voices) if (v.active && !v.killing && v.note === note && v.keyDown) { this.startKill(v, note, vel); return }
    if (this.s.legato) {
      let c = null
      for (const v of voices) {
        if (!v.active || v.killing || !v.keyDown || v.stackN >= 4) continue
        if (v.age < Math.floor(0.03 * this.sr) || Math.abs(v.note - note) > 7 || v.note === note) continue
        if (!c || v.order > c.order) c = v
      }
      if (c) { this.legatoTo(c, note, vel, true); return }
    }
    for (const v of voices) if (!v.active) { this.start(v, note, vel); return }
    let victim = null
    for (const v of voices) if (!v.killing && (!victim || v.order < victim.order)) victim = v
    if (victim) { this.startKill(victim, note, vel); return }
    for (const v of voices) if (v.killing) { v.pendingNote = note; v.pendingVel = vel; return }
  }

  noteOff(note) {
    note = note | 0
    for (const v of this.voices) {
      if (!v.active || v.killing) continue
      if (v.keyDown && v.note === note) {
        if (this.s.legato && v.stackN > 0) {
          const prev = v.stackNote[v.stackN - 1], pv = v.stackVel[v.stackN - 1]
          --v.stackN
          this.legatoTo(v, prev, pv, false)
        } else this.release(v)
      } else {
        for (let i = 0; i < v.stackN; ++i) {
          if (v.stackNote[i] === note) {
            for (let k = i; k + 1 < v.stackN; ++k) { v.stackNote[k] = v.stackNote[k + 1]; v.stackVel[k] = v.stackVel[k + 1] }
            --v.stackN
            break
          }
        }
      }
    }
  }

  allNotesOff() { for (const v of this.voices) if (v.active && !v.killing && v.keyDown) { v.stackN = 0; this.release(v) } }
  panic() { for (const v of this.voices) if (v.active && !v.killing) this.startKill(v, -1, 0) }
  /** Pitch bend en semitonos (±2), se suma al parámetro Pitch Bend. */
  pitchBend(st) {
    this.extBend = clampT(Number.isFinite(st) ? st : 0, -2, 2)
    this.bendSm.setTarget(clampT(this.s.bendSt + this.extBend, -2, 2))
  }
  /** cc(123) = todas las notas off, cc(120) = silencio inmediato, cc(129, 0..16383) = pitch bend de 14 bits. */
  cc(num, valor) {
    if (num === 123) this.allNotesOff()
    else if (num === 120) this.panic()
    else if (num === 129) this.pitchBend(((valor - 8192) * 2) / 8192)
  }
  activeVoices() { let n = 0; for (const v of this.voices) if (v.active) n++; return n }
  static noteHz(note) { return 440 * Math.pow(2, (note - 69) / 12) }

  // ------------------------------------------------------------- render
  /** Escribe n muestras mono→estéreo en outL/outR a partir del índice `off`. */
  render(outL, outR, n, off = 0) {
    const mix = this.mixBuf
    let pos = 0
    while (pos < n) {
      const nb = Math.min(CHUNK, n - pos)
      this.bendNow = this.bendSm.advance(nb)
      const pm = this.pickSm.advance(nb)
      const wP = 1 - pm, wJ = pm
      const v0 = this.vol.cur, v1 = this.vol.advance(nb), w0 = this.wet.cur, w1 = this.wet.advance(nb)
      const cm = this.mixSm.advance(nb), dr = this.driveSm.advance(nb)
      for (let i = 0; i < nb; ++i) mix[i] = 0
      for (const v of this.voices) if (v.active) this.voiceChunk(v, mix, nb, wP, wJ)
      const kDrv = 0.25 + 9 * Math.pow(dr, 1.5), biasDrv = 0.6 * dr
      const mkDrv = 1 / ((1 + 1.1 * Math.pow(dr, 1.3)) * (1 + 1.1 * Math.pow(dr, 2.5)))
      const normDrv = (mkDrv * 0.35) / Math.max(1e-6, Math.tanh(kDrv * 0.35 + biasDrv) - Math.tanh(biasDrv))
      const tb = Math.tanh(biasDrv)
      const u = this.u
      for (let i = 0; i < nb; ++i) {
        const t = (i + 1) / nb
        const g = (v0 + (v1 - v0) * t) * (w0 + (w1 - w0) * t)
        let x = mix[i]
        x = x / Math.sqrt(1 + 0.2 * x * x)
        x = this.pkBody.process(x)
        x = this.pkBell.process(x)
        x = this.pkLp.process(x)
        { const y = x - this.dc1x + this.dcR * this.dc1y; this.dc1x = x; this.dc1y = y; x = y }
        { const a = Math.abs(x); this.pkEnv = a > this.pkEnv ? a : this.pkEnv * this.pkRel }
        const envDb = 20 * Math.log10(this.pkEnv + 1e-9)
        const over = envDb - THR
        let gr = 0
        if (2 * over > KNEE) gr = (1 / RATIO - 1) * over
        else if (2 * over > -KNEE) { const q = over + KNEE * 0.5; gr = ((1 / RATIO - 1) * q * q) / (2 * KNEE) }
        this.grS += (gr - this.grS) * (gr < this.grS ? this.compAtk : this.compRel)
        x *= 1 - cm + cm * Math.exp(this.grS * 0.115129254649702 * 0.6)
        this.upsample(x, u)
        const u0 = (Math.tanh(kDrv * u[0] + biasDrv) - tb) * normDrv
        const u1 = (Math.tanh(kDrv * u[1] + biasDrv) - tb) * normDrv
        x = this.downsample(u0, u1)
        { const y = x - this.dc2x + this.dcR * this.dc2y; this.dc2x = x; this.dc2y = y; x = y }
        x = this.tiltLo.process(x)
        x = this.tiltHi.process(x)
        x = this.toneLp.process(x)
        x = this.sub.process(x)
        x *= g
        x = softClip(x)
        outL[off + pos + i] = x
        outR[off + pos + i] = x
      }
      for (const v of this.voices) {
        if (!v.active) continue
        v.age += nb
        if (v.killing && v.env <= 0) {
          v.active = false
          if (v.pendingNote >= 0) { const pn = v.pendingNote; v.pendingNote = -1; this.start(v, pn, v.pendingVel) }
          continue
        }
        if (v.lvl < 1e-6 && v.exI >= v.exN && v.thEnv * v.thAmp < 1e-6 && v.age > Math.floor(2 * v.T) + 64) v.active = false
      }
      pos += nb
    }
    this.fx.process(outL, outR, n, off)   // rack FX comun al final de la cadena (con todo apagado no toca el buffer)
  }

  // ------------------------------------------------------------- cadena
  designChain() {
    const sr = this.sr, s = this.s
    const pm = s.pickupMix
    this.pkBody.design('lowshelf', sr, 120, 4, 0.7)
    this.pkBell.design('bell', sr, 700, 3 - 5 * pm, 0.9)
    this.pkLp.design('lp', sr, 3000 + 1600 * pm, 0, 0.8 + 0.3 * pm)
    const t = (s.tone - 0.5) * 2
    this.tiltLo.design('lowshelf', sr, 650, -6 * t, 0.6)
    this.tiltHi.design('highshelf', sr, 650, 6 * t, 0.6)
    const fc = s.tone >= 0.5 ? 20000 : 3500 * Math.pow(20000 / 3500, s.tone / 0.5)
    this.toneLp.design('lp', sr, fc, 0, 0.707)
    this.sub.design('lowshelf', sr, 110, s.lowBoostDb, 0.707)
  }

  designHalfband() {
    const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 60; ++k) { t *= (x / (2 * k)) * (x / (2 * k)); s += t } return s }
    const c = (HB_TAPS - 1) >> 1
    let sum = 0
    for (let i = 0; i < HB_TAPS; ++i) {
      const u = (i - c) * 0.5
      const sn = i === c ? 1 : Math.sin(PI * u) / (PI * u)
      const r = (i - c) / c
      this.hb[i] = (0.5 * sn * i0(8 * Math.sqrt(Math.max(0, 1 - r * r)))) / i0(8)
      sum += this.hb[i]
    }
    for (let i = 0; i < HB_TAPS; ++i) this.hb[i] /= sum
    this.nzN = 0
    for (let i = 0; i < HB_TAPS; ++i) {
      if (i === c || (i - c) % 2 !== 0) this.nz[this.nzN++] = i
      else this.hb[i] = 0
    }
  }
  firDot(b, pos) {
    let a = 0
    for (let j = 0; j < this.nzN; ++j) { const k = this.nz[j]; a += this.hb[k] * b[pos + k] }
    return a
  }
  pushUp(x) {
    this.upPos = (this.upPos + HB_TAPS - 1) % HB_TAPS
    this.upBuf[this.upPos] = x
    this.upBuf[this.upPos + HB_TAPS] = x
  }
  upsample(x, out) {
    this.pushUp(2 * x); out[0] = this.firDot(this.upBuf, this.upPos)
    this.pushUp(0); out[1] = this.firDot(this.upBuf, this.upPos)
  }
  downsample(a, b) {
    this.dnPos = (this.dnPos + HB_TAPS - 1) % HB_TAPS
    this.dnBuf[this.dnPos] = a; this.dnBuf[this.dnPos + HB_TAPS] = a
    this.dnPos = (this.dnPos + HB_TAPS - 1) % HB_TAPS
    this.dnBuf[this.dnPos] = b; this.dnBuf[this.dnPos + HB_TAPS] = b
    return this.firDot(this.dnBuf, this.dnPos)
  }

  // ------------------------------------------------------------- voces
  startKill(v, pendingNote, vel) {
    v.killing = true
    v.killStep = Math.max(1e-9, v.env / this.killLen)
    v.pendingNote = pendingNote
    v.pendingVel = vel
  }

  release(v) {
    v.keyDown = false
    v.released = true
    const f = v.fApplied > 1 ? v.fApplied : 100
    const t60 = 0.22 * (1 - 0.6 * Math.max(this.s.mute, v.mute))
    v.dampT = Math.pow(10, -3 / (t60 * f))
    if (v.age > Math.floor(0.06 * this.sr)) {
      v.rnLeft = Math.floor(0.012 * this.sr)
      v.rnEnv = 1
      v.rnDecay = Math.exp(-1 / (0.004 * this.sr))
      v.rnAmp = v.fund * 0.05 * (0.4 + 0.6 * this.s.fingerAttack) * (1 - 0.7 * Math.max(this.s.mute, v.mute))
      v.rnC = 1 - Math.exp((-2 * PI * 2500) / this.sr)
    }
  }

  /** Resuelve el lazo para f: compensación exacta de la fase del lazo en f0. */
  updateLoop(v, f) {
    const sr = this.sr
    f = clampT(f, sr / 16000, sr * 0.2)
    const w0 = (2 * PI * f) / sr
    const T = sr / f
    const b = v.lpB
    const sw = Math.sin(w0), cw = Math.cos(w0)
    const hMag = (1 - b) / Math.sqrt(Math.max(1e-12, 1 - 2 * b * cw + b * b))
    const L0 = Math.pow(10, -3 / (v.t60 * f))
    v.lpG = Math.min(0.99995, L0 / hMag)
    const tauLp = Math.atan2(b * sw, 1 - b * cw) / w0
    v.dispA = -(0.05 + 0.1 * clampT(f / 500, 0, 1))
    const tauD = 1 - (2 * Math.atan2(v.dispA * sw, 1 + v.dispA * cw)) / w0
    let Dbuf = T - tauLp - tauD
    if (Dbuf < 4) Dbuf = 4
    if (Dbuf > BUF_LEN - 8) Dbuf = BUF_LEN - 8
    v.n0 = Math.floor(Dbuf) - 1
    const dt = Dbuf - v.n0
    let d = dt
    const h = this.lagH
    for (let it = 0; it < 4; ++it) {
      lagrange4(d, h)
      let re = 0, im = 0
      for (let k = 0; k < 4; ++k) { re += h[k] * Math.cos(w0 * k); im -= h[k] * Math.sin(w0 * k) }
      const tau = -Math.atan2(im, re) / w0
      d += dt - tau
    }
    lagrange4(d, v.h)
    v.T = T
    v.fApplied = f
  }

  controlUpdate(v) {
    if (v.semi !== v.semiTarget) {
      v.semi += (v.semiTarget - v.semi) * v.glideCoef
      if (Math.abs(v.semiTarget - v.semi) < 1e-4) v.semi = v.semiTarget
    }
    const f = 440 * Math.pow(2, (v.semi + this.bendNow - 69) / 12)
    if (Math.abs(f - v.fApplied) > v.fApplied * 5e-6) this.updateLoop(v, f)
  }

  configureNote(v, vel, f0) {
    const s = this.s
    const att = s.fingerAttack
    v.vel = vel
    v.ghost = clampT((0.26 - vel) / 0.14, 0, 1)
    v.mute = clampT(Math.max(s.mute, 0.85 * v.ghost), 0, 1)
    const v1 = Math.pow(vel, 0.9)
    const hard = clampT(0.55 * v1 + 0.45 * att, 0, 1) * (1 - 0.45 * v.mute) * (1 + 0.04 * v.rng.bip())
    const sb = clampT(0.25 + 0.55 * hard, 0, 1)
    v.t60 = Math.max(0.05, (1.2 + 4.8 * s.sustain) * Math.pow(110 / f0, 0.35) * (1 - 0.85 * v.mute))
    v.fcStr = (500 + 2600 * sb) * (1 - 0.75 * v.mute)
    v.lpB = clampT(Math.exp((-2 * PI * v.fcStr) / this.sr), 0, 0.98)
    return clampT(hard, 0, 1)
  }

  armExcitation(v, hard, f0, ampScale) {
    const s = this.s, sr = this.sr
    const att = s.fingerAttack
    const v1 = Math.pow(v.vel, 0.9)
    const T = sr / f0
    v.exWp = (5.5 * (1 - hard) + 0.6 * hard) * 1e-3 * sr
    v.exWs = 0.25e-3 * sr
    v.exClick = 0.9 * hard * hard
    const pp = (0.1 + 0.4 * s.pluckPos) * (1 + 0.03 * v.rng.bip())
    v.exDp = pp * T
    const F = 0.128 * Math.pow(f0 / 55, 0.3) * (0.1 + 0.9 * Math.pow(v1, 1.3)) * ampScale
    v.fund = F
    const fc = f0 / sr
    const E1 = hannMag(fc, v.exWp) + v.exClick * hannMag(fc, v.exWs)
    const sinF = Math.max(0.35, 2 * Math.sin(PI * pp))
    v.exA = (F * T) / (2 * Math.max(1e-6, E1) * sinF)
    v.nbN = clampT(Math.floor((0.003 + 0.012 * att) * sr), 8, NOISE_LEN - 2)
    const c = 1 - Math.exp((-2 * PI * 2500) / sr)
    const nrm = 1 / Math.sqrt(c * 0.5)
    let z = 0
    for (let i = 0; i < v.nbN; ++i) {
      z += c * (v.rng.bip() - z)
      const e = Math.exp((-4 * i) / v.nbN) * (1 - i / v.nbN)
      v.nb[i] = z * nrm * 0.5 * e
    }
    v.exNz = (0.1 + 0.55 * att) * (0.4 + 0.6 * v1) * (1 + v.ghost)
    v.exI = 0
    v.exN = Math.ceil(Math.max(v.exWp, v.nbN) + v.exDp) + 2
    v.thC = 1 - Math.exp((-2 * PI * (500 + 900 * att)) / sr)
    v.thNorm = 1 / Math.sqrt(v.thC * 0.5)
    v.thDecay = Math.exp(-1 / (sr * (0.004 + 0.01 * att + 0.006 * v.mute)))
    v.thEnv = 1
    v.thAmp = F * 0.9 * (0.15 + 0.5 * att) * (0.3 + 0.7 * v1) * (1 + 1.2 * v.ghost) * (1 - 0.3 * v.mute) * ampScale * 0.6
  }

  start(v, note, vel) {
    v.active = true; v.keyDown = true; v.released = false; v.killing = false
    v.note = note; v.stackN = 0; v.pendingNote = -1; v.pendingVel = 0
    v.age = 0; v.order = ++this.order
    this.noteCounter = (this.noteCounter + 1) >>> 0
    let seed = (0x9e3779b9 ^ Math.imul(note, 2654435761) ^ ((Math.imul(this.noteCounter, 40503) + 1) >>> 0)) >>> 0
    if (seed === 0) seed = 1
    v.rng.s = seed
    v.rng.next(); v.rng.next()
    const detune = 0.012 * v.rng.bip()
    v.semi = v.semiTarget = note + detune
    v.glideCoef = 0.1
    v.buf.fill(0); v.yh.fill(0)
    v.w = 0; v.lp = 0; v.dispZ = 0; v.dampG = 1; v.dampT = 1
    v.env = 1; v.killStep = 0; v.lvl = 1
    v.rnLeft = 0; v.rnEnv = 0; v.rnZ = 0; v.thZ1 = v.thZ2 = 0
    const f0 = 440 * Math.pow(2, (v.semi + this.bendNow - 69) / 12)
    const hard = this.configureNote(v, vel, f0)
    this.updateLoop(v, f0)
    this.armExcitation(v, hard, v.fApplied, 1)
  }

  legatoTo(v, note, vel, push) {
    if (push) { v.stackNote[v.stackN] = v.note; v.stackVel[v.stackN] = v.vel; ++v.stackN }
    const hammer = push
    v.note = note
    v.keyDown = true; v.released = false; v.dampT = 1
    v.order = ++this.order
    v.semiTarget = note + v.semiTarget - Math.floor(v.semiTarget + 0.5)
    const glide = Math.max(3, this.s.glideMs)
    v.glideCoef = 1 - Math.exp(-CHUNK / ((this.sr * glide * 0.001) / 3))
    const f0 = 440 * Math.pow(2, (v.semiTarget + this.bendNow - 69) / 12)
    const hard = this.configureNote(v, vel, f0)
    v.lvl = 1
    this.armExcitation(v, hard * 0.8, f0, hammer ? 0.4 : 0.22)
    v.thAmp *= 0.5
    if (v.fApplied > 0) this.updateLoop(v, 440 * Math.pow(2, (v.semi + this.bendNow - 69) / 12))
  }

  pulseAt(v, t) { return hann(t, v.exWp) + v.exClick * hann(t, v.exWs) }
  nbAt(v, t) {
    if (t < 0 || t >= v.nbN - 1) return 0
    const i = Math.floor(t)
    const fr = t - i
    return v.nb[i] * (1 - fr) + v.nb[i + 1] * fr
  }
  yAt(v, w, dq) {
    if (dq < 1) dq = 1
    const i0 = Math.floor(dq)
    const fr = dq - i0
    return v.yh[(w - i0) & BUF_MASK] * (1 - fr) + v.yh[(w - i0 - 1) & BUF_MASK] * fr
  }

  voiceChunk(v, mix, nb, wP, wJ) {
    this.controlUpdate(v)
    const qP = 0.14 * v.T, qJb = 0.085 * v.T, qJn = 0.2 * v.T
    const lg = v.lpG, bb = v.lpB, ob = 1 - v.lpB, ad = v.dispA
    const buf = v.buf, h = v.h
    for (let i = 0; i < nb; ++i) {
      const w = v.w
      const y = h[0] * buf[(w - v.n0) & BUF_MASK] + h[1] * buf[(w - v.n0 - 1) & BUF_MASK] +
                h[2] * buf[(w - v.n0 - 2) & BUF_MASK] + h[3] * buf[(w - v.n0 - 3) & BUF_MASK]
      v.yh[w] = y
      const d = ad * y + v.dispZ
      v.dispZ = y - ad * d
      v.lp = bb * v.lp + ob * d
      v.dampG += (v.dampT - v.dampG) * this.slew
      let x = v.lp * lg * v.dampG
      if (v.exI < v.exN) {
        const t = v.exI++
        const e = this.pulseAt(v, t) - this.pulseAt(v, t - v.exDp) + v.exNz * (this.nbAt(v, t) - this.nbAt(v, t - v.exDp))
        x += v.exA * e
      }
      buf[w] = x
      v.w = (w + 1) & BUF_MASK
      const a = Math.abs(y)
      v.lvl = a > v.lvl * this.lvlDecay ? a : v.lvl * this.lvlDecay
      let s = 0
      if (wP > 1e-4) s += wP * (y - this.yAt(v, w, qP))
      if (wJ > 1e-4) s += wJ * (0.6 * (y - this.yAt(v, w, qJn)) + 0.4 * (y - this.yAt(v, w, qJb)))
      if (v.thEnv > 1e-4) {
        v.thZ1 += v.thC * (v.rng.bip() - v.thZ1)
        v.thZ2 += v.thC * (v.thZ1 - v.thZ2)
        s += v.thZ2 * v.thNorm * v.thEnv * v.thAmp
        v.thEnv *= v.thDecay
      }
      if (v.rnLeft > 0) {
        const nz = v.rng.bip()
        v.rnZ += v.rnC * (nz - v.rnZ)
        s += (nz - v.rnZ) * 0.5 * v.rnEnv * v.rnAmp
        v.rnEnv *= v.rnDecay
        --v.rnLeft
      }
      if (v.killing) {
        v.env -= v.killStep
        if (v.env <= 0) { v.env = 0; break }
      }
      mix[i] += s * v.env
    }
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('jaswave-electric-bass', class extends AudioWorkletProcessor {
    constructor() {
      super()
      this.motor = new Motor(sampleRate)
      this.eventos = []
      this.port.onmessage = (e) => {
        const m = e.data
        if (!m) return
        if (m.tipo === 'param') this.motor.setParam(m.id, m.valor)
        else if (m.tipo === 'panico') { this.eventos.length = 0; this.motor.panic() }
        else if (m.tipo === 'bend') this.motor.pitchBend(m.valor)
        else if (m.tipo === 'cc') this.motor.cc(m.num, m.valor)
        else if (m.tipo === 'tempo') this.motor.setTempo(m.bpm)
        else if (m.tipo === 'on' || m.tipo === 'off') this.programar(m)
      }
    }
    programar(ev) {
      let i = this.eventos.length
      while (i > 0 && this.eventos[i - 1].cuando > ev.cuando) i--
      this.eventos.splice(i, 0, ev)
    }
    process(_entradas, salidas) {
      const out = salidas[0]
      if (!out || !out[0]) return true
      const L = out[0], R = out[1] || out[0], n = L.length
      const due = (e) => (typeof e.cuando === 'number' ? Math.round((e.cuando - currentTime) * sampleRate) : 0)
      let pos = 0
      while (pos < n) {
        // eventos vencidos en `pos` (precisión de muestra), luego render hasta el siguiente
        while (this.eventos.length && due(this.eventos[0]) <= pos) {
          const e = this.eventos.shift()
          if (e.tipo === 'on') this.motor.noteOn(e.nota, e.vel)
          else this.motor.noteOff(e.nota)
        }
        const next = this.eventos.length ? Math.min(n, due(this.eventos[0])) : n
        this.motor.render(L, R, next - pos, pos)
        pos = next
      }
      return true
    }
  })
}
if (typeof module !== 'undefined') module.exports = { Motor, PARAMS, PARAM_IDS }
