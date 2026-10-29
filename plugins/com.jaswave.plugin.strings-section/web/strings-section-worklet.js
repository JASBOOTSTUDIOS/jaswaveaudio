/**
 * JasWave Strings Section – réplica web (AudioWorklet) del VST3 `strings_section_dsp.h`.
 * Mismo algoritmo y mismos parámetros (ids y rangos de `paramDefs()` / jaswave-plugin.json):
 *   0 expression % · 1 vibrato_depth % · 2 attack_time ms · 3 release_time ms · 4 hall_size % · 5 bypass 0/1 ·
 *   6 volume dB · 7 tune Hz · 8 width % · 9 section_size 4..8 · 10 mod_wheel % · 11 sustain 0/1 ·
 *   12 pitch_bend st (±2) · 13 legato 0/1 · 14 glide_time ms · 15 bow_tremolo %
 *
 * Síntesis de cuerda frotada: diente de sierra PolyBLEP por «instrumentista» (4..8 por nota) con desafinación,
 * fase, vibrato (con retardo) y entrada/salida escalonadas; ruido de arco y «chiff»; formantes de caja de
 * contrabajo/chelo/viola/violín con crossfade por registro; expresión (CC11/CC1) = nivel + brillo; legato con
 * portamento; sala FDN de 8 líneas (Hadamard) con difusores, pre-delay, amortiguación y RT60 hasta 4 s.
 *
 * Clase `Motor` pura (sin APIs de AudioWorklet): constructor(sampleRate), setParam(id, plano), noteOn(nota, vel),
 * noteOff(nota), pitchBend(semitonos), cc(num, valor 0..127), panic(), render(outL, outR, n).
 * `vel` es 0..1 (si es > 1 se interpreta como MIDI 0..127). Sin asignaciones en render().
 * FX Rack comun (ids 100..230): setParam(id >= 100, valor) lo enruta a `motor.fx` (shared-dsp/web/fxrack.js, incrustado abajo);
 *   va DESPUES de la sala propia; mensaje {tipo:'tempo', bpm} para el delay sincronizado.
 * Mensajes del puerto: {tipo:'param', id, valor} · {tipo:'on', nota, vel, cuando} · {tipo:'off', nota, cuando}
 *   · {tipo:'panico'} · {tipo:'bend', valor} · {tipo:'cc', num, valor}   (`cuando` en segundos del AudioContext).
 */
'use strict'

const PI = Math.PI
const TAU = Math.PI * 2
const MAX_VOICES = 32
const POOL = MAX_VOICES + 4
const MAX_PLAYERS = 8
const CHUNK = 64
const NOISE_LEN = 8192
const VOICE_GAIN = 0.22
const WET_SCALE = 0.55

const PARAM = {
  expression: 0, vibrato_depth: 1, attack_time: 2, release_time: 3, hall_size: 4, bypass: 5, volume: 6,
  tune: 7, width: 8, section_size: 9, mod_wheel: 10, sustain: 11, pitch_bend: 12, legato: 13, glide_time: 14, bow_tremolo: 15,
}

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
const FX_PARAMS = []
fxRegistrarParametros(FX_PARAMS, PARAM)   // FX Rack comun: 58 parametros FX · (ids 100..230), ver shared-dsp/web/fxrack.js

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const dbToLin = (db) => Math.pow(10, db * 0.05)
const smooth01 = (x) => {
  x = x < 0 ? 0 : x > 1 ? 1 : x
  return x * x * (3 - 2 * x)
}

/** Soft-clip con rodilla (lineal hasta 0.72, luego tanh hacia ±1). */
function softClip(x) {
  const t = 0.72
  const a = Math.abs(x)
  if (a <= t) return x
  const y = t + (1 - t) * Math.tanh((a - t) / (1 - t))
  return x < 0 ? -y : y
}

/** PRNG xorshift32 propio (sin Math.random). */
class Rng {
  constructor(seed) {
    this.s = 0x9e3779b9
    if (seed !== undefined) this.seed(seed)
  }
  seed(v) {
    this.s = v >>> 0 || 0x9e3779b9
    for (let i = 0; i < 4; i++) this.next32()
  }
  next32() {
    let s = this.s
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.s = s >>> 0
    return this.s
  }
  uni() {
    return (this.next32() >>> 8) * (1 / 16777216)
  }
  bip() {
    return this.uni() * 2 - 1
  }
}

/** Coeficientes RBJ (a0 = 1) escritos en c[o..o+4] = b0,b1,b2,a1,a2. type: 'bell' | 'bp'. */
function biquadDesign(c, o, type, sr, freq, gainDb, q) {
  freq = clamp(freq, 10, sr * 0.499)
  q = clamp(q, 0.05, 40)
  const w0 = (TAU * freq) / sr
  const cw = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  let b0, b1, b2, a0, a1, a2
  if (type === 'bell') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
  }
  const inv = 1 / a0
  c[o] = b0 * inv; c[o + 1] = b1 * inv; c[o + 2] = b2 * inv; c[o + 3] = a1 * inv; c[o + 4] = a2 * inv
}

// Formantes de caja: 0 contrabajo, 1 chelo, 2 viola, 3 violín: [f, gainDb, q] × 3 (aire, madera, «bridge hill»)
const BODY = [
  [[62, 4, 3], [118, 3, 4], [700, 4.5, 1.5]],
  [[108, 4.5, 3], [205, 3, 4], [1500, 5, 1.6]],
  [[225, 4.5, 3], [410, 3, 4], [2100, 5.5, 1.6]],
  [[290, 4.5, 3], [520, 3, 4], [2800, 6, 1.6]],
]
const KNOT = [36, 50, 64, 79]
const BODY_TMP = new Float64Array(9)
function bodyFor(note, out) {
  let i0 = 0
  let t = 0
  if (note >= KNOT[3]) { i0 = 2; t = 1 }
  else if (note > KNOT[0]) {
    while (i0 < 2 && note >= KNOT[i0 + 1]) i0++
    t = (note - KNOT[i0]) / (KNOT[i0 + 1] - KNOT[i0])
  }
  for (let k = 0; k < 3; k++) {
    const a = BODY[i0][k]
    const b = BODY[i0 + 1][k]
    out[k * 3] = a[0] * Math.pow(b[0] / a[0], t)
    out[k * 3 + 1] = a[1] + (b[1] - a[1]) * t
    out[k * 3 + 2] = a[2] + (b[2] - a[2]) * t
  }
}

/** Sala: FDN de 8 líneas con Hadamard ortogonal, difusores, pre-delay y amortiguación (|g| < 1 siempre). */
class HallReverb {
  constructor(sr) {
    this.sr = sr
    const sc = sr / 48000
    const base = [1499, 1747, 2053, 2339, 2713, 3119, 3511, 3943]
    this.N = 8
    this.modDepth = 9 * sc
    this.len = new Int32Array(8)
    this.buf = []
    this.sz = new Int32Array(8)
    this.w = new Int32Array(8)
    for (let i = 0; i < 8; i++) {
      this.len[i] = Math.max(64, Math.floor(base[i] * sc))
      this.sz[i] = this.len[i] + 2 * Math.floor(this.modDepth) + 16
      this.buf.push(new Float64Array(this.sz[i]))
    }
    const apBase = [142, 107, 379, 277]
    this.apLen = new Int32Array(4)
    this.apBuf = []
    this.apW = new Int32Array(4)
    for (let i = 0; i < 4; i++) {
      this.apLen[i] = Math.max(8, Math.floor(apBase[i] * sc))
      this.apBuf.push(new Float64Array(this.apLen[i]))
    }
    this.pdBuf = new Float64Array(Math.floor(0.16 * sr) + 8)
    this.pdW = 0
    this.hpA = Math.exp((-TAU * 110) / sr)
    this.dcA = Math.exp((-TAU * 30) / sr)
    this.g = new Float64Array(8)
    this.lp = new Float64Array(8)
    this.modPrev = new Float64Array(8)
    this.modNow = new Float64Array(8)
    this.y = new Float64Array(8)
    this.h = new Float64Array(8)
    this.sign = [1, -1, 1, 1, -1, 1, -1, -1]
    this.hS = 0.65
    this.damp = 0.5
    this.pd = 1000
    this.wet = 0.5
    this.lfoPh = 0
    this.hpX = 0; this.hpY = 0; this.dcL = 0; this.dcR = 0; this.dcXL = 0; this.dcXR = 0
    this.update(0.65, CHUNK, true)
  }
  reset() {
    for (const b of this.buf) b.fill(0)
    for (const b of this.apBuf) b.fill(0)
    this.pdBuf.fill(0)
    this.w.fill(0); this.lp.fill(0); this.apW.fill(0)
    this.pdW = 0
    this.hpX = this.hpY = this.dcL = this.dcR = this.dcXL = this.dcXR = 0
    this.lfoPh = 0
  }
  update(hall, n, immediate) {
    hall = clamp(hall, 0, 1)
    const k = immediate ? 1 : 1 - Math.exp(-n / (0.25 * this.sr))
    this.hS += (hall - this.hS) * k
    const rt60 = 0.4 + 3.6 * Math.pow(this.hS, 1.2)
    for (let i = 0; i < 8; i++) this.g[i] = Math.exp((-6.907755 * this.len[i]) / (this.sr * rt60))
    const fd = 9000 - 5500 * this.hS
    this.damp = Math.exp((-TAU * fd) / this.sr)
    const pdTarget = (0.01 + 0.06 * this.hS) * this.sr
    if (immediate) this.pd = pdTarget
    else this.pd += (pdTarget - this.pd) * k
    this.wet = 0.3 + 0.7 * this.hS
    const dtc = n / this.sr
    for (let i = 0; i < 8; i++) {
      this.modPrev[i] = this.modNow[i]
      const ph = this.lfoPh * (0.17 + 0.037 * i) + i * 0.7853981
      this.modNow[i] = this.modDepth * Math.sin(TAU * ph)
    }
    this.lfoPh += dtc
    if (this.lfoPh > 1e4) this.lfoPh = 0
    if (immediate) for (let i = 0; i < 8; i++) this.modPrev[i] = this.modNow[i]
  }
  process(inL, inR, outL, outR, n) {
    const invN = 1 / n
    const y = this.y
    const h = this.h
    const NRM = 0.35355339059327373
    for (let s = 0; s < n; s++) {
      const t = (s + 1) * invN
      const x = 0.5 * (inL[s] + inR[s])
      this.hpY = this.hpA * (this.hpY + x - this.hpX)
      this.hpX = x
      // pre-delay
      this.pdBuf[this.pdW] = this.hpY
      const pd = Math.max(1, this.pd)
      const pdLen = this.pdBuf.length
      const di = Math.min(Math.floor(pd), pdLen - 2)
      const fr = pd - di
      let r0 = this.pdW - di
      if (r0 < 0) r0 += pdLen
      let r1 = r0 - 1
      if (r1 < 0) r1 += pdLen
      let v = this.pdBuf[r0] * (1 - fr) + this.pdBuf[r1] * fr
      if (++this.pdW >= pdLen) this.pdW = 0
      // difusores Schroeder
      for (let a = 0; a < 4; a++) {
        const b = this.apBuf[a]
        const d = b[this.apW[a]]
        const vv = v + 0.6 * d
        const yy = -0.6 * vv + d
        b[this.apW[a]] = vv
        if (++this.apW[a] >= this.apLen[a]) this.apW[a] = 0
        v = yy
      }
      // líneas con retardo modulado, amortiguación y ganancia
      for (let i = 0; i < 8; i++) {
        const mod = this.modPrev[i] + (this.modNow[i] - this.modPrev[i]) * t
        const d = this.len[i] + mod
        const di2 = Math.floor(d)
        const f2 = d - di2
        const size = this.sz[i]
        let a0 = this.w[i] - di2
        if (a0 < 0) a0 += size
        let a1 = a0 - 1
        if (a1 < 0) a1 += size
        const bf = this.buf[i]
        const xr = bf[a0] * (1 - f2) + bf[a1] * f2
        this.lp[i] = xr * (1 - this.damp) + this.lp[i] * this.damp
        y[i] = this.lp[i] * this.g[i]
      }
      const oL = 0.35 * (y[0] + y[1] - y[2] - y[3] + y[4] + y[5] - y[6] - y[7])
      const oR = 0.35 * (y[0] - y[1] - y[2] + y[3] + y[4] - y[5] - y[6] + y[7])
      for (let i = 0; i < 8; i++) h[i] = y[i]
      for (let len = 1; len < 8; len <<= 1)
        for (let i = 0; i < 8; i += len << 1)
          for (let j = i; j < i + len; j++) {
            const a = h[j]
            const b = h[j + len]
            h[j] = a + b
            h[j + len] = a - b
          }
      for (let i = 0; i < 8; i++) {
        this.buf[i][this.w[i]] = h[i] * NRM + v * 0.3 * this.sign[i]
        if (++this.w[i] >= this.sz[i]) this.w[i] = 0
      }
      const l = oL - this.dcXL + this.dcA * this.dcL
      this.dcXL = oL
      this.dcL = l
      const r = oR - this.dcXR + this.dcA * this.dcR
      this.dcXR = oR
      this.dcR = r
      outL[s] = l
      outR[s] = r
    }
  }
}

class Voice {
  constructor() {
    this.rng = new Rng()
    // por atril
    this.ph = new Float64Array(MAX_PLAYERS)
    this.inc = new Float64Array(MAX_PLAYERS)
    this.det = new Float64Array(MAX_PLAYERS)
    this.vibPh = new Float64Array(MAX_PLAYERS)
    this.vibRate = new Float64Array(MAX_PLAYERS)
    this.vibScale = new Float64Array(MAX_PLAYERS)
    this.jit = new Float64Array(MAX_PLAYERS)
    this.shim = new Float64Array(MAX_PLAYERS)
    this.dOn = new Float64Array(MAX_PLAYERS)
    this.dOff = new Float64Array(MAX_PLAYERS)
    this.pan = new Float64Array(MAX_PLAYERS)
    this.tremPh = new Float64Array(MAX_PLAYERS)
    this.tremRate = new Float64Array(MAX_PLAYERS)
    this.g = new Float64Array(MAX_PLAYERS)
    // filtros
    this.body = new Float64Array(15)
    this.bm = new Float64Array(6)
    this.bs = new Float64Array(6)
    this.chiff = new Float64Array(5)
    this.chiffSt = new Float64Array(2)
    this.permD = new Int32Array(MAX_PLAYERS)
    this.permP = new Int32Array(MAX_PLAYERS)
    this.active = false
    this.released = false
    this.keyUp = false
    this.killing = false
    this.note = -1
    this.nPl = 0
    this.nzIdx = 0
    this.vel = 0.7; this.t = 0; this.tr = 0; this.atkSec = 0.18; this.relSec = 0.5; this.vibDelay = 0.4
    this.glideCents = 0; this.killG = 1; this.gAmp = 0; this.pan0 = 0; this.chiffAmp = 0; this.chiffDec = 0.999
    this.lpM1 = 0; this.lpM2 = 0; this.lpS1 = 0; this.lpS2 = 0; this.gvPrev = 0
    this.order = 0
  }
}

class Motor {
  constructor(sampleRate) {
    this.sr = sampleRate > 0 ? sampleRate : 48000
    // ajustes (valores planos ya convertidos)
    this.s = {
      expression: 0.75, vibrato: 0.35, attackSec: 0.18, releaseSec: 0.5, hall: 0.65, volumeDb: 0, a4: 440,
      width: 0.7, modWheel: 0, bendSemis: 0, glideMs: 80, tremolo: 0, sectionSize: 6, sustain: false, legato: true, bypass: false,
    }
    this.voices = []
    for (let i = 0; i < POOL; i++) this.voices.push(new Voice())
    this.hall = new HallReverb(this.sr)
    this.killLen = Math.max(16, Math.floor(0.005 * this.sr))
    this.vol = dbToLin(0)
    this.volT = this.vol
    this.wet = 1
    this.wetT = 1
    this.eS = 0.75; this.mS = 0; this.bendS = 0; this.polyG = 1
    this.dcXL = 0; this.dcXR = 0; this.dcYL = 0; this.dcYR = 0
    this.pedal = false
    this.clock = 0
    this.lastOnClock = -1e12
    this.order = 0
    this.seedCtr = 1
    this.cl = new Float64Array(CHUNK); this.cr = new Float64Array(CHUNK)
    this.wl = new Float64Array(CHUNK); this.wr = new Float64Array(CHUNK)
    this.gTarget = new Float64Array(MAX_PLAYERS); this.gStep = new Float64Array(MAX_PLAYERS); this.gCur = new Float64Array(MAX_PLAYERS)
    // tablas de ruido (blanco y paso alto) generadas una vez
    this.noiseW = new Float64Array(NOISE_LEN)
    this.noiseH = new Float64Array(NOISE_LEN)
    const nr = new Rng(0xc0ffee)
    let lp = 0
    for (let i = 0; i < NOISE_LEN; i++) {
      const w = nr.bip()
      lp += 0.3 * (w - lp)
      this.noiseW[i] = w
      this.noiseH[i] = w - lp
    }
    this.eS = this.s.expression
    this.fx = new FxRack(this.sr)   // rack de mezcla comun (EQ, compresor, saturacion, chorus, delay, reverb, anchura): apagado por defecto
  }

  setTempo(bpm) { this.fx.setTempo(bpm) }

  /** Valor plano por id numérico del VST3 (o por nombre de manifiesto). */
  setParam(id, v) {
    if (typeof id === 'string') id = PARAM[id]
    if (id === undefined || !Number.isFinite(v)) return
    if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { this.fx.setParam(id, v); return }
    const s = this.s
    switch (id) {
      case 0: s.expression = clamp(v, 0, 100) / 100; break
      case 1: s.vibrato = clamp(v, 0, 100) / 100; break
      case 2: s.attackSec = clamp(v, 20, 1500) / 1000; break
      case 3: s.releaseSec = clamp(v, 50, 3000) / 1000; break
      case 4: s.hall = clamp(v, 0, 100) / 100; break
      case 5: s.bypass = v >= 0.5; this.wetT = s.bypass ? 0 : 1; break
      case 6: s.volumeDb = clamp(v, -24, 6); this.volT = dbToLin(s.volumeDb); break
      case 7: s.a4 = clamp(v, 430, 450); break
      case 8: s.width = clamp(v, 0, 100) / 100; break
      case 9: s.sectionSize = clamp(Math.round(v), 4, 8); break
      case 10: s.modWheel = clamp(v, 0, 100) / 100; break
      case 11: this.setPedal(v >= 0.5); break
      case 12: s.bendSemis = clamp(v, -2, 2); break
      case 13: s.legato = v >= 0.5; break
      case 14: s.glideMs = clamp(v, 0, 300); break
      case 15: s.tremolo = clamp(v, 0, 100) / 100; break
    }
  }

  pitchBend(semitonos) {
    this.s.bendSemis = clamp(semitonos, -2, 2)
  }

  /** CC MIDI: 1 = mod wheel, 11 = expression, 64 = sustain; valor 0..127. */
  cc(num, valor) {
    const n = clamp(valor, 0, 127) / 127
    if (num === 1) this.s.modWheel = n
    else if (num === 11) this.s.expression = n
    else if (num === 64) this.setPedal(valor >= 64)
    else if (num === 123 || num === 120) this.allNotesOff()
  }

  panic() {
    for (const v of this.voices) v.active = false
    this.pedal = false
    this.hall.reset()
    this.fx.reset()
    this.dcXL = this.dcXR = this.dcYL = this.dcYR = 0
  }

  activeVoices() {
    let a = 0
    for (const v of this.voices) if (v.active) a++
    return a
  }

  fundamental(note) {
    return this.s.a4 * Math.pow(2, (note - 69) / 12)
  }

  playersFor(voicesNow) {
    const want = clamp(this.s.sectionSize, 4, MAX_PLAYERS)
    const k = voicesNow <= 6 ? 1 : voicesNow <= 12 ? 0.75 : voicesNow <= 20 ? 0.55 : 0.42
    return clamp(Math.round(want * k), 3, MAX_PLAYERS)
  }

  noteOn(note, velIn) {
    note = note | 0
    if (note < 0 || note > 127) return
    if (velIn > 1) velIn /= 127
    if (!(velIn > 0)) { this.noteOff(note); return }
    const vel = clamp(velIn, 0, 1)
    const s = this.s
    // Legato: exactamente UNA nota sostenida cercana y no parte de un acorde (ataque > 30 ms después)
    if (s.legato && this.clock - this.lastOnClock > Math.floor(0.03 * this.sr)) {
      let held = null
      let heldCount = 0
      for (const v of this.voices) if (v.active && !v.killing && !v.keyUp) { heldCount++; held = v }
      if (heldCount === 1 && held.note !== note && Math.abs(held.note - note) <= 7 && held.t > 0.04) {
        held.glideCents += (held.note - note) * 100
        held.note = note
        held.vel = 0.5 * (held.vel + vel)
        held.order = this.order++
        this.lastOnClock = this.clock
        return
      }
    }
    this.lastOnClock = this.clock
    for (const v of this.voices) if (v.active && !v.killing && v.note === note) v.killing = true
    let used = 0
    for (const v of this.voices) if (v.active && !v.killing) used++
    if (used >= MAX_VOICES) {
      // robo: la más antigua (las ya liberadas primero), con fundido de ~5 ms
      let victim = null
      for (const v of this.voices) {
        if (!v.active || v.killing) continue
        if (!victim || (v.released && !victim.released) || (v.released === victim.released && v.order < victim.order)) victim = v
      }
      if (victim) victim.killing = true
    }
    let slot = null
    for (const v of this.voices) if (!v.active) { slot = v; break }
    if (!slot) {
      let best = 2
      for (const v of this.voices) if (v.killing && v.killG < best) { best = v.killG; slot = v }
    }
    if (slot) this.start(slot, note, vel, Math.max(1, used))
  }

  noteOff(note) {
    for (const v of this.voices) {
      if (!v.active || v.killing || v.note !== note || v.keyUp) continue
      v.keyUp = true
      if (!this.pedal) this.release(v)
    }
  }

  allNotesOff() {
    for (const v of this.voices) if (v.active && !v.killing) v.killing = true
  }

  setPedal(down) {
    this.pedal = down
    this.s.sustain = down
    if (!down) for (const v of this.voices) if (v.active && v.keyUp && !v.released) this.release(v)
  }

  release(v) {
    v.released = true
    v.tr = 0
    v.relSec = Math.max(0.05, this.s.releaseSec)
  }

  start(v, note, vel, voicesNow) {
    const s = this.s
    const sr = this.sr
    v.active = true; v.released = false; v.keyUp = false; v.killing = false
    v.note = note; v.vel = vel; v.t = 0; v.tr = 0; v.glideCents = 0; v.killG = 1; v.gvPrev = 0
    v.lpM1 = v.lpM2 = v.lpS1 = v.lpS2 = 0
    v.bm.fill(0); v.bs.fill(0); v.chiffSt.fill(0); v.g.fill(0)
    v.order = this.order++
    const r = v.rng
    r.seed((0x9e3779b9 ^ (note * 7919) ^ (Math.floor(vel * 1000) << 12) ^ Math.imul(++this.seedCtr, 2654435761)) >>> 0)
    const np = this.playersFor(voicesNow)
    v.nPl = np
    v.atkSec = Math.max(0.02, s.attackSec) * (1.45 - 0.95 * Math.pow(vel, 0.8))
    v.relSec = Math.max(0.05, s.releaseSec)
    v.vibDelay = 0.3 + 0.25 * r.uni()
    v.nzIdx = r.next32() & (NOISE_LEN - 1)
    const permD = v.permD
    const permP = v.permP
    for (let i = 0; i < np; i++) permD[i] = permP[i] = i
    for (let i = np - 1; i > 0; i--) {
      let j = Math.floor(r.uni() * (i + 1))
      let tmp = permD[i]; permD[i] = permD[j]; permD[j] = tmp
      j = Math.floor(r.uni() * (i + 1))
      tmp = permP[i]; permP[i] = permP[j]; permP[j] = tmp
    }
    let meanDet = 0
    for (let i = 0; i < np; i++) {
      const sd = ((permD[i] + 0.5) / np - 0.5) * 2 + (r.bip() * 0.3) / np
      v.det[i] = sd * 8
      meanDet += v.det[i]
      v.pan[i] = clamp(((permP[i] + 0.5) / np - 0.5) * 2 * 0.95, -1, 1)
      v.ph[i] = r.uni()
      v.vibPh[i] = r.uni()
      v.vibRate[i] = 5.2 + 0.9 * r.uni()
      v.vibScale[i] = 0.75 + 0.5 * r.uni()
      v.dOn[i] = i === 0 ? 0 : Math.pow(r.uni(), 1.3) * 0.045
      v.dOff[i] = r.uni() * 0.05
      v.tremRate[i] = 8 + 3 * r.uni()
      v.tremPh[i] = r.uni()
      v.jit[i] = 0
      v.shim[i] = 0
      v.inc[i] = 0
    }
    meanDet /= np
    for (let i = 0; i < np; i++) v.det[i] -= meanDet // media del ensemble exactamente afinada
    bodyFor(note, BODY_TMP)
    for (let k = 0; k < 3; k++) biquadDesign(v.body, k * 5, 'bell', sr, BODY_TMP[k * 3], BODY_TMP[k * 3 + 1], BODY_TMP[k * 3 + 2])
    v.gAmp = (VOICE_GAIN / Math.sqrt(np)) * (0.55 + 0.45 * vel)
    v.pan0 = clamp((58 - note) / 50, -1, 1) * 0.35
    const f0 = this.fundamental(note)
    biquadDesign(v.chiff, 0, 'bp', sr, clamp(2200 + f0 * 1.5, 1500, 6000), 0, 1.2)
    v.chiffAmp = 0.05 * Math.pow(vel, 1.5) * clamp(0.25 / v.atkSec, 0.2, 1)
    v.chiffDec = Math.exp(-1 / (0.035 * sr))
  }

  /** Procesa un sub-bloque de n <= CHUNK muestras hacia cl/cr (mezcla ya con sala, volumen y soft-clip). */
  chunk(n) {
    const s = this.s
    const sr = this.sr
    const cl = this.cl
    const cr = this.cr
    const wl = this.wl
    const wr = this.wr
    const dtc = n / sr
    const kE = 1 - Math.exp(-dtc / 0.03)
    const kB = 1 - Math.exp(-dtc / 0.01)
    this.eS += (s.expression - this.eS) * kE
    this.mS += (s.modWheel - this.mS) * kE
    this.bendS += (s.bendSemis * 100 - this.bendS) * kB
    const gE = dbToLin(-20 * (1 - this.eS))
    // compensación de polifonía: más notas simultáneas -> menos ganancia por nota
    let nAct = 0
    for (let i = 0; i < POOL; i++) if (this.voices[i].active && !this.voices[i].killing) nAct++
    this.polyG += (1 / Math.sqrt(1 + 0.15 * (Math.max(1, nAct) - 1)) - this.polyG) * (1 - Math.exp(-dtc / 0.05))
    const vib = s.vibrato
    const trem = s.tremolo
    const width = s.width
    for (let i = 0; i < n; i++) { cl[i] = 0; cr[i] = 0 }
    const gTarget = this.gTarget
    const gStep = this.gStep
    const gCur = this.gCur
    const noiseW = this.noiseW
    const noiseH = this.noiseH
    for (let vi = 0; vi < POOL; vi++) {
      const v = this.voices[vi]
      if (!v.active) continue
      const t1 = v.t + dtc
      const tr1 = v.released ? v.tr + dtc : 0
      let kg0 = v.killG
      let kg1 = v.killG
      if (v.killing) {
        kg1 = Math.max(0, v.killG - n / this.killLen)
        if (kg0 <= 0) { v.active = false; continue }
      }
      if (v.glideCents !== 0) {
        if (s.glideMs < 1) v.glideCents = 0
        else {
          v.glideCents *= Math.exp(-dtc / ((s.glideMs * 0.001) / 3))
          if (Math.abs(v.glideCents) < 0.01) v.glideCents = 0
        }
      }
      const dyn = clamp(0.62 * this.eS + 0.38 * this.mS + 0.3 * (v.vel - 0.5), 0, 1)
      const fNom = this.fundamental(v.note)
      const fc = clamp(650 + fNom * 1.8 + 8200 * Math.pow(dyn, 1.7), 300, 0.45 * sr)
      const lpA = 1 - Math.exp((-TAU * fc) / sr)
      const gvDyn = dbToLin(-12 * (1 - dyn))
      const gv1 = gE * gvDyn * v.gAmp * this.polyG
      let envMean = 0
      const vibDepthCents = vib * 28
      const vibOn = smooth01((t1 - v.vibDelay) / 0.7)
      const tremDep = trem * 0.8 * smooth01((v.vel - 0.8) / 0.2)
      const np = v.nPl
      const rng = v.rng
      for (let i = 0; i < np; i++) {
        v.vibPh[i] += v.vibRate[i] * dtc
        if (v.vibPh[i] > 1) v.vibPh[i] -= 1
        v.jit[i] += (rng.bip() * 1.6 - v.jit[i]) * 0.1
        v.shim[i] += (rng.bip() * 0.1 - v.shim[i]) * 0.1
        const cents = v.det[i] + v.jit[i] + vibDepthCents * vibOn * v.vibScale[i] * Math.sin(TAU * v.vibPh[i]) + this.bendS + v.glideCents
        v.inc[i] = Math.min(0.45, (s.a4 * Math.pow(2, ((v.note - 69) * 100 + cents) / 1200)) / sr)
        const xa = (t1 - v.dOn[i]) / v.atkSec
        let gg = smooth01(xa)
        if (v.released) gg *= Math.exp((-8.5 * Math.max(0, tr1 - v.dOff[i])) / v.relSec)
        v.tremPh[i] += v.tremRate[i] * dtc
        if (v.tremPh[i] > 1) v.tremPh[i] -= 1
        if (tremDep > 0) gg *= 1 - tremDep * 0.5 * (1 - Math.cos(TAU * v.tremPh[i]))
        gg *= 1 + v.shim[i]
        gTarget[i] = gg
        envMean += gg
        gCur[i] = v.g[i]
        gStep[i] = (gg - v.g[i]) / n
      }
      envMean /= Math.max(1, np)
      const hiss = 0.012 * (0.6 + 0.8 * (1 - dyn)) * envMean
      const pw0 = Math.sqrt(0.5 * (1 - v.pan0 * width))
      const pw1 = Math.sqrt(0.5 * (1 + v.pan0 * width))
      const gvStep = (gv1 - v.gvPrev) / n
      let gv = v.gvPrev
      const kgStep = (kg1 - kg0) / n
      let kg = kg0
      const body = v.body
      const bm = v.bm
      const bs = v.bs
      const ph = v.ph
      const inc = v.inc
      const pan = v.pan
      for (let k = 0; k < n; k++) {
        let mAcc = 0
        let sAcc = 0
        for (let i = 0; i < np; i++) {
          let p = ph[i] + inc[i]
          if (p >= 1) p -= 1
          ph[i] = p
          const dt = inc[i]
          let saw = 2 * p - 1
          if (p < dt) { const x = p / dt; saw -= x + x - x * x - 1 }
          else if (p > 1 - dt) { const x = (p - 1) / dt; saw -= x * x + x + x + 1 }
          gCur[i] += gStep[i]
          const y = saw * gCur[i]
          mAcc += y
          sAcc += y * pan[i]
        }
        const w = noiseW[v.nzIdx]
        const nz = noiseH[v.nzIdx]
        v.nzIdx = (v.nzIdx + 1) & (NOISE_LEN - 1)
        let m = mAcc + nz * hiss
        if (v.chiffAmp > 1e-7) {
          const c = v.chiff
          const cs = v.chiffSt
          const yc = c[0] * w + cs[0]
          cs[0] = c[1] * w - c[3] * yc + cs[1]
          cs[1] = c[2] * w - c[4] * yc
          m += yc * v.chiffAmp
          v.chiffAmp *= v.chiffDec
        }
        let d = sAcc
        for (let b = 0; b < 3; b++) {
          const o = b * 5
          const so = b * 2
          const ym = body[o] * m + bm[so]
          bm[so] = body[o + 1] * m - body[o + 3] * ym + bm[so + 1]
          bm[so + 1] = body[o + 2] * m - body[o + 4] * ym
          m = ym
          const yd = body[o] * d + bs[so]
          bs[so] = body[o + 1] * d - body[o + 3] * yd + bs[so + 1]
          bs[so + 1] = body[o + 2] * d - body[o + 4] * yd
          d = yd
        }
        v.lpM1 += lpA * (m - v.lpM1); v.lpM2 += lpA * (v.lpM1 - v.lpM2)
        v.lpS1 += lpA * (d - v.lpS1); v.lpS2 += lpA * (v.lpS1 - v.lpS2)
        gv += gvStep
        kg += kgStep
        const gk = gv * kg
        const mm = v.lpM2 * gk
        const dd = v.lpS2 * gk * width
        cl[k] += (mm + dd) * pw0
        cr[k] += (mm - dd) * pw1
      }
      for (let i = 0; i < np; i++) v.g[i] = gTarget[i]
      v.gvPrev = gv1
      v.killG = kg1
      v.t = t1
      v.tr = tr1
      if (v.killing && kg1 <= 0) v.active = false
      else if (v.released && tr1 > v.relSec + 0.08) v.active = false
    }
    // sala
    this.hall.update(s.hall, n, false)
    this.hall.process(cl, cr, wl, wr, n)
    const hw = this.hall.wet * WET_SCALE
    // master: volumen + bypass + DC + soft-clip
    const kv = 1 - Math.exp(-n / (0.02 * sr))
    const kw = 1 - Math.exp(-n / (0.01 * sr))
    const vg0 = this.vol
    this.vol += (this.volT - this.vol) * kv
    const vg1 = this.vol
    const w0 = this.wet
    this.wet += (this.wetT - this.wet) * kw
    const w1 = this.wet
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n
      const g = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t)
      const l = (cl[i] + wl[i] * hw) * g
      const r = (cr[i] + wr[i] * hw) * g
      const yl = l - this.dcXL + 0.9995 * this.dcYL
      this.dcXL = l
      this.dcYL = yl
      const yr = r - this.dcXR + 0.9995 * this.dcYR
      this.dcXR = r
      this.dcYR = yr
      cl[i] = softClip(yl)
      cr[i] = softClip(yr)
    }
  }

  /** Escribe n muestras estéreo en outL/outR (sobrescribe). */
  render(outL, outR, n) {
    let pos = 0
    while (pos < n) {
      const m = Math.min(CHUNK, n - pos)
      this.chunk(m)
      for (let i = 0; i < m; i++) { outL[pos + i] = this.cl[i]; outR[pos + i] = this.cr[i] }
      pos += m
    }
    this.clock += n
    this.fx.process(outL, outR, n, 0)   // rack FX comun al final de la cadena (con todo apagado no toca el buffer)
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor(
    'jaswave-strings-section',
    class extends AudioWorkletProcessor {
      constructor() {
        super()
        this.motor = new Motor(sampleRate)
        this.cola = []
        this.port.onmessage = (e) => {
          const m = e.data || {}
          const mo = this.motor
          if (m.tipo === 'param') mo.setParam(m.id, m.valor)
          else if (m.tipo === 'on' || m.tipo === 'off') {
            // inserción ordenada por tiempo (cola corta)
            const ev = { tipo: m.tipo, nota: m.nota, vel: m.vel, cuando: typeof m.cuando === 'number' ? m.cuando : 0 }
            let i = this.cola.length
            while (i > 0 && this.cola[i - 1].cuando > ev.cuando) i--
            this.cola.splice(i, 0, ev)
          } else if (m.tipo === 'panico') { this.cola.length = 0; mo.panic() }
          else if (m.tipo === 'bend') mo.pitchBend(m.valor)
          else if (m.tipo === 'cc') mo.cc(m.num, m.valor)
          else if (m.tipo === 'tempo') mo.setTempo(m.bpm)
        }
      }
      process(_in, outputs) {
        const out = outputs[0]
        if (!out || !out[0]) return true
        const L = out[0]
        const R = out[1] || out[0]
        const n = L.length
        let pos = 0
        const t0 = currentTime
        while (pos < n) {
          // aplica los eventos cuyo instante cae en esta muestra
          while (this.cola.length && Math.round((this.cola[0].cuando - t0) * sampleRate) <= pos) {
            const ev = this.cola.shift()
            if (ev.tipo === 'on') this.motor.noteOn(ev.nota, ev.vel === undefined ? 0.7 : ev.vel)
            else this.motor.noteOff(ev.nota)
          }
          let next = n
          if (this.cola.length) next = Math.min(n, Math.max(pos + 1, Math.round((this.cola[0].cuando - t0) * sampleRate)))
          this.motor.render(L.subarray(pos, next), R === L ? this.scratch(next - pos) : R.subarray(pos, next), next - pos)
          pos = next
        }
        return true
      }
      scratch(n) {
        if (!this._s || this._s.length < n) this._s = new Float32Array(Math.max(n, 128))
        return this._s.subarray(0, n)
      }
    },
  )
}

if (typeof module !== 'undefined') module.exports = { Motor, PARAM }
