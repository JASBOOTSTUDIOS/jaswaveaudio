/**
 * JasWave Shimmer Pad - version web (AudioWorklet) del VST3 `com.jaswave.plugin.shimmer-pad`.
 * Mismo algoritmo que source/shimmer_pad_dsp.h (portado a JS con Float64Array/Uint32Array preasignados; el
 * render no asigna memoria):
 *   voces (supersaw 2..7 + wavetable calido<->cristal + sub) -> SVF TPT/ZDF estereo por voz -> ensemble chorus
 *   -> reverb FDN de 8 lineas con pitch shifter granular (Hann x4) en el lazo (shimmer +12/+7/+24, RT60 real).
 *
 * Autocontenido, sin imports. Clase `Motor` pura:
 *   new Motor(sampleRate); setParam(id, valorPlano); noteOn(nota, vel); noteOff(nota); pitchBend(semitonos);
 *   cc(num, valor); panic(); render(outL, outR, n, offset = 0)
 *   (extra) enqueue({tipo:'on'|'off', nota, vel, cuando}) + renderAt(outL, outR, n, t0) para eventos al sample.
 * `id` = ParamID VST3 (0..17, ver PARAM_IDS); `valor` = valor plano (Hz, %, s, dB...). `vel` 0..1 (o 1..127).
 * Mensajes del puerto: {tipo:'param', id, valor} {tipo:'on', nota, vel, cuando} {tipo:'off', nota, cuando}
 *   {tipo:'panico'} {tipo:'bend', valor} {tipo:'cc', num, valor} {tipo:'tempo', bpm}   (`cuando` en segundos del AudioContext).
 * FX Rack comun (ids 100..230): setParam(id >= 100, valor) lo enruta a `motor.fx` (shared-dsp/web/fxrack.js, incrustado abajo).
 */
'use strict'

const TWO_PI = Math.PI * 2
const MAX_VOICES = 16
const MAX_UNISON = 7
const TICK = 32
const CHUNK = 256
const TABLE_N = 4096
const LEVELS = 10
const MORPHS = 9
const SAW_SHAPE = MORPHS
const SHAPES = MORPHS + 1
const FDN = 8
const PS = 4

const PARAM_IDS = {
  cutoff: 0, resonance: 1, shimmer_octave: 2, shimmer_decay: 3, lfo_rate: 4, bypass: 5, volume: 6,
  shimmer: 7, attack: 8, release: 9, reverb: 10, detune: 11, sub: 12, chorus: 13,
  bend: 14, mod_wheel: 15, aftertouch: 16, sustain: 17,
  low_cut: 18, tone: 19, soft_comp: 20, delay_mix: 21, delay_time: 22, delay_feedback: 23, tape_drive: 24, stereo_width: 25, master_tune: 26, reverb_damping: 27,
}

/** Rangos y valores por defecto (identicos a paramDefs() del VST3 y al manifiesto). */
const PARAMS = [
  { id: 0, nombre: 'cutoff', min: 20, max: 20000, def: 2600, escala: 'log' },
  { id: 1, nombre: 'resonance', min: 0, max: 100, def: 10, escala: 'linear' },
  { id: 2, nombre: 'shimmer_octave', min: 0, max: 2, def: 0, escala: 'stepped' },
  { id: 3, nombre: 'shimmer_decay', min: 0.5, max: 20, def: 9, escala: 'log' },
  { id: 4, nombre: 'lfo_rate', min: 0.05, max: 8, def: 0.12, escala: 'log' },
  { id: 5, nombre: 'bypass', min: 0, max: 1, def: 0, escala: 'stepped' },
  { id: 6, nombre: 'volume', min: -24, max: 6, def: 0, escala: 'linear' },
  { id: 7, nombre: 'shimmer', min: 0, max: 100, def: 45, escala: 'linear' },
  { id: 8, nombre: 'attack', min: 0.02, max: 12, def: 1.2, escala: 'log' },
  { id: 9, nombre: 'release', min: 0.1, max: 15, def: 4, escala: 'log' },
  { id: 10, nombre: 'reverb', min: 0, max: 100, def: 55, escala: 'linear' },
  { id: 11, nombre: 'detune', min: 0, max: 100, def: 45, escala: 'linear' },
  { id: 12, nombre: 'sub', min: 0, max: 100, def: 10, escala: 'linear' },
  { id: 13, nombre: 'chorus', min: 0, max: 100, def: 45, escala: 'linear' },
  { id: 14, nombre: 'bend', min: -2, max: 2, def: 0, escala: 'linear' },
  { id: 15, nombre: 'mod_wheel', min: 0, max: 100, def: 0, escala: 'linear' },
  { id: 16, nombre: 'aftertouch', min: 0, max: 100, def: 0, escala: 'linear' },
  { id: 17, nombre: 'sustain', min: 0, max: 1, def: 0, escala: 'stepped' },
  // bloques de mezcla (solo el VST3 nativo los procesa; el motor web acepta y guarda los valores)
  { id: 18, nombre: 'low_cut', min: 20, max: 400, def: 70, escala: 'log' },
  { id: 19, nombre: 'tone', min: 1000, max: 20000, def: 9000, escala: 'log' },
  { id: 20, nombre: 'soft_comp', min: 0, max: 100, def: 35, escala: 'linear' },
  { id: 21, nombre: 'delay_mix', min: 0, max: 100, def: 18, escala: 'linear' },
  { id: 22, nombre: 'delay_time', min: 80, max: 1200, def: 520, escala: 'log' },
  { id: 23, nombre: 'delay_feedback', min: 0, max: 90, def: 40, escala: 'linear' },
  { id: 24, nombre: 'tape_drive', min: 0, max: 100, def: 15, escala: 'linear' },
  { id: 25, nombre: 'stereo_width', min: 0, max: 150, def: 110, escala: 'linear' },
  { id: 26, nombre: 'master_tune', min: -50, max: 50, def: 0, escala: 'linear' },
  { id: 27, nombre: 'reverb_damping', min: 0, max: 100, def: 70, escala: 'linear' },
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
fxRegistrarParametros(PARAMS, PARAM_IDS)   // FX Rack comun: 58 parametros FX · (ids 100..230), ver shared-dsp/web/fxrack.js

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const dbToLinear = (db) => Math.pow(10, db * 0.05)
const centsRatio = (c) => {
  const a = c * (0.6931471805599453 / 1200)
  return 1 + a * (1 + a * (0.5 + a * (1 / 6)))
}
const pow2AtLeast = (n) => { let p = 1; while (p < n) p <<= 1; return p }
const fastTanh = (x) => {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}
const softClip = (x) => {
  const a = Math.abs(x)
  if (a < 0.5) return x
  const y = 0.5 + 0.47 * Math.tanh((a - 0.5) * (1 / 0.47))
  return x < 0 ? -y : y
}

/** PRNG xorshift32 propio (sin Math.random en el audio). */
class Xor {
  constructor() { this.s = 0x2545f491 }
  seed(v) { this.s = (v >>> 0) || 0x9e3779b9; for (let i = 0; i < 4; i++) this.u32() }
  u32() {
    let s = this.s
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.s = s >>> 0
    return this.s
  }
  uni() { return this.u32() * (1 / 4294967296) }
  bi() { return this.uni() * 2 - 1 }
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

/** Linea de retardo con lectura fraccionaria lineal. D=1 -> ultima muestra escrita. */
class DelayBuf {
  constructor(n) { this.b = new Float64Array(pow2AtLeast(n + 4)); this.mask = this.b.length - 1; this.w = 0 }
  clear() { this.b.fill(0); this.w = 0 }
  push(x) { this.b[this.w] = x; this.w = (this.w + 1) & this.mask }
  read(D) {
    const pos = this.w - D
    const fl = Math.floor(pos)
    const fr = pos - fl
    const i0 = fl & this.mask
    const i1 = (i0 + 1) & this.mask
    return this.b[i0] + (this.b[i1] - this.b[i0]) * fr
  }
}

/** Wavetables band-limited por octava (27.5 Hz * 2^k); formas 0..8 = mezcla calido<->cristal, 9 = diente de sierra. */
class WaveTables {
  constructor(sr) {
    const N1 = TABLE_N + 1
    this.sine = new Float32Array(N1)
    const sn = new Float64Array(TABLE_N)
    for (let i = 0; i < TABLE_N; i++) { sn[i] = Math.sin((TWO_PI * i) / TABLE_N); this.sine[i] = sn[i] }
    this.sine[TABLE_N] = this.sine[0]
    this.data = new Float32Array(SHAPES * LEVELS * N1)
    const acc = new Float64Array(TABLE_N)
    const glass = [0, 1.0, 0.35, 0.55, 0.15, 0.4, 0.12, 0.25, 0.08]
    const amp = (morph, k) => {
      const warm = Math.pow(k, -1.35)
      const gl = k <= 8 ? glass[k] : 0.9 * Math.pow(k, -1.25)
      const m = morph / (MORPHS - 1)
      return (1 - m) * warm + m * gl
    }
    for (let s = 0; s < SHAPES; s++) {
      for (let L = 0; L < LEVELS; L++) {
        const fU = 27.5 * Math.pow(2, L + 1)
        let maxH = Math.floor((0.45 * sr) / fU)
        maxH = Math.max(1, Math.min(maxH, s === SAW_SHAPE ? 256 : 64))
        acc.fill(0)
        let e = 0
        for (let k = 1; k <= maxH; k++) {
          let a
          if (s === SAW_SHAPE) { const x = (Math.PI * k) / (maxH + 1); a = (1 / k) * (Math.sin(x) / x) } else a = amp(s, k)
          e += a * a * 0.5
          for (let i = 0; i < TABLE_N; i++) acc[i] += a * sn[(k * i) & (TABLE_N - 1)]
        }
        const norm = 0.3 / Math.sqrt(Math.max(e, 1e-12))
        const off = (s * LEVELS + L) * N1
        for (let i = 0; i < TABLE_N; i++) this.data[off + i] = acc[i] * norm
        this.data[off + TABLE_N] = this.data[off]
      }
    }
  }
  /** Desplazamiento de la tabla (forma, octava de f) dentro de `data`. */
  offset(shape, f) {
    let L = 0
    if (f > 27.5) L = Math.min(LEVELS - 1, Math.floor(Math.log2(f / 27.5)))
    return (shape * LEVELS + L) * (TABLE_N + 1)
  }
}

/** Pitch shifter granular: 4 granos Hann solapados al 75 % (suma de ventanas constante). */
class GrainShifter {
  constructor(sr, windowSec, seed) {
    this.W = Math.max(64, windowSec * sr)
    this.buf = new DelayBuf(Math.floor(this.W) + 8)
    const r = new Xor(); r.seed(seed)
    this.phi0 = r.uni()
    this.hpA = 1 - Math.exp((-TWO_PI * 110) / sr)
    this.lpA = 1 - Math.exp((-TWO_PI * Math.min(7000, 0.4 * sr)) / sr)
    this.pw = 1 - Math.exp(-1 / (0.03 * sr))
    this.setRatio(2)
    this.reset()
  }
  reset() {
    this.buf.clear()
    this.hp = 0; this.lp = 0; this.pin = 0; this.pout = 0; this.gain = 1; this.cnt = 0
    this.phi = this.phi0
    this.resync()
  }
  resync() { this.c = Math.cos(TWO_PI * this.phi); this.s = Math.sin(TWO_PI * this.phi) }
  setRatio(r) {
    this.dphi = (1 - r) / this.W
    this.rc = Math.cos(TWO_PI * this.dphi)
    this.rs = Math.sin(TWO_PI * this.dphi)
  }
  process(x) {
    this.hp += this.hpA * (x - this.hp)
    this.lp += this.lpA * (x - this.hp - this.lp)
    const inp = this.lp
    this.buf.push(inp)
    const c = this.c, s = this.s, W = this.W
    const w0 = 0.5 - 0.5 * c, w1 = 0.5 + 0.5 * s, w2 = 0.5 + 0.5 * c, w3 = 0.5 - 0.5 * s
    let p1 = this.phi + 0.25, p2 = this.phi + 0.5, p3 = this.phi + 0.75
    p1 -= Math.floor(p1); p2 -= Math.floor(p2); p3 -= Math.floor(p3)
    const acc = w0 * this.buf.read(1 + this.phi * W) + w1 * this.buf.read(1 + p1 * W) +
      w2 * this.buf.read(1 + p2 * W) + w3 * this.buf.read(1 + p3 * W)
    this.phi += this.dphi
    this.phi -= Math.floor(this.phi)
    const nc = c * this.rc - s * this.rs
    this.s = s * this.rc + c * this.rs
    this.c = nc
    if (++this.cnt >= 512) { this.cnt = 0; this.resync() }
    const out = acc * 0.5 * 1.55
    this.pin += this.pw * (inp * inp - this.pin)
    this.pout += this.pw * (out * out - this.pout)
    if ((this.cnt & 7) === 0) {
      const target = this.pout > this.pin ? Math.sqrt((this.pin + 1e-18) / (this.pout + 1e-18)) : 1
      this.gain += 0.016 * (target - this.gain)
    }
    return fastTanh(out * Math.min(this.gain, 1))
  }
}

const ROW_L = [1, 1, -1, -1, -1, -1, 1, 1]
const ROW_R = [1, -1, 1, -1, -1, 1, -1, 1]
const IN_L = [1, 1, -1, -1, 1, 1, -1, -1]
const IN_R = [1, -1, -1, 1, 1, -1, -1, 1]
const INV_SQRT8 = 0.35355339059327373
const RATIOS = [2, 1.4983070768766815, 4]

/** Reverb FDN de 8 lineas (Hadamard) con difusores de entrada, amortiguacion HF en estante y shimmer en el lazo. */
class ShimmerVerb {
  constructor(sr) {
    this.sr = sr
    const base = [1117, 1301, 1559, 1823, 2111, 2393, 2699, 3067]
    this.sumD = 0
    this.modDepth = 0.0004 * sr
    this.d = new Float64Array(FDN)
    this.line = []
    this.modC = new Float64Array(FDN); this.modS = new Float64Array(FDN)
    this.modRc = new Float64Array(FDN); this.modRs = new Float64Array(FDN)
    for (let i = 0; i < FDN; i++) {
      this.d[i] = Math.round((base[i] * sr) / 48000)
      this.sumD += this.d[i]
      this.line.push(new DelayBuf(this.d[i] + this.modDepth + 8))
      const rate = 0.07 + 0.043 * i
      this.modRc[i] = Math.cos((TWO_PI * rate) / sr); this.modRs[i] = Math.sin((TWO_PI * rate) / sr)
      this.modC[i] = Math.cos(0.7 * i); this.modS[i] = Math.sin(0.7 * i)
    }
    const apL = [142, 107, 379, 277], apR = [157, 113, 403, 293]
    this.apL = apL.map((n) => new Float64Array(Math.max(8, Math.round((n * sr) / 48000))))
    this.apR = apR.map((n) => new Float64Array(Math.max(8, Math.round((n * sr) / 48000))))
    this.apIL = new Int32Array(4); this.apIR = new Int32Array(4)
    this.ps = []
    for (let k = 0; k < PS; k++) this.ps.push(new GrainShifter(sr, 0.085 * (1 + 0.11 * k), (0x1234567 + 7919 * k) >>> 0))
    this.pLp = Math.exp((-TWO_PI * 3000) / sr)
    this.lp = new Float64Array(FDN)
    this.glf = new Float64Array(FDN); this.ghf = new Float64Array(FDN); this.dg = new Float64Array(FDN)
    this.z = new Float64Array(FDN); this.w = new Float64Array(FDN)
    this.shimAmt = 0; this.rtLast = -1; this.dirty = true; this.modCnt = 0
    this.wetNorm = 1; this.sn = 0; this.cs = 1
    this.outL = 0; this.outR = 0
    this.reset()
    this.setRt60(6)
    this.setShimmer(0, 0)
  }
  reset() {
    for (const l of this.line) l.clear()
    this.lp.fill(0)
    for (const b of this.apL) b.fill(0)
    for (const b of this.apR) b.fill(0)
    for (const p of this.ps) p.reset()
  }
  setRt60(rtParam) {
    rtParam = clamp(rtParam, 0.3, 30)
    if (rtParam === this.rtLast && !this.dirty) return
    this.rtLast = rtParam
    this.dirty = false
    const rt = rtParam * (1.17 + 0.2 / (1 + 2 * rtParam)) * (1 + 0.2 * this.shimAmt)
    const hfRatio = rt > 3 ? 0.35 : 0.35 + (0.15 * (3 - rt)) / 3
    for (let i = 0; i < FDN; i++) {
      const glf = Math.min(0.99995, Math.pow(10, (-3 * this.d[i]) / (rt * this.sr)))
      const ghf = Math.min(glf, Math.pow(10, (-3 * this.d[i]) / (rt * hfRatio * this.sr)))
      this.glf[i] = glf; this.dg[i] = glf - ghf; this.ghf[i] = ghf
    }
    this.wetNorm = clamp(0.9 * Math.sqrt((13.8 * this.sumD) / (rt * this.sr)), 0.35, 2.5)
  }
  setShimmer(amount, interval) {
    const amt = clamp(amount, 0, 1)
    if (amt !== this.shimAmt) { this.shimAmt = amt; this.dirty = true; this.setRt60(this.rtLast) }
    const th = (this.shimAmt * TWO_PI) / 10
    this.sn = Math.sin(th); this.cs = Math.cos(th)
    const r = RATIOS[clamp(interval | 0, 0, 2)]
    for (const p of this.ps) p.setRatio(r)
  }
  static allpass(b, idxArr, i, x) {
    const g = 0.55
    const idx = idxArr[i]
    const d = b[idx]
    const v = x - g * d
    b[idx] = v
    idxArr[i] = idx + 1 >= b.length ? 0 : idx + 1
    return d + g * v
  }
  /** Procesa una muestra estereo; el resultado queda en this.outL / this.outR. */
  process(inL, inR) {
    if (++this.modCnt >= 1024) {
      this.modCnt = 0
      for (let i = 0; i < FDN; i++) {
        const m = 1 / Math.sqrt(this.modC[i] * this.modC[i] + this.modS[i] * this.modS[i])
        this.modC[i] *= m; this.modS[i] *= m
      }
    }
    let xl = inL, xr = inR
    for (let i = 0; i < 4; i++) {
      xl = ShimmerVerb.allpass(this.apL[i], this.apIL, i, xl)
      xr = ShimmerVerb.allpass(this.apR[i], this.apIR, i, xr)
    }
    const z = this.z, w = this.w
    for (let i = 0; i < FDN; i++) {
      const D = this.d[i] + this.modDepth * this.modS[i]
      const nc = this.modC[i] * this.modRc[i] - this.modS[i] * this.modRs[i]
      this.modS[i] = this.modS[i] * this.modRc[i] + this.modC[i] * this.modRs[i]
      this.modC[i] = nc
      const y = this.line[i].read(D)
      this.lp[i] = (1 - this.pLp) * y + this.pLp * this.lp[i]
      z[i] = this.ghf[i] * y + this.dg[i] * this.lp[i]
    }
    let oL = 0, oR = 0
    for (let i = 0; i < FDN; i++) { oL += ROW_L[i] * z[i]; oR += ROW_R[i] * z[i] }
    this.outL = oL * INV_SQRT8 * this.wetNorm
    this.outR = oR * INV_SQRT8 * this.wetNorm
    for (let i = 0; i < FDN; i++) w[i] = z[i]
    for (let h = 1; h < FDN; h <<= 1) {
      for (let i = 0; i < FDN; i += 2 * h) {
        for (let j = i; j < i + h; j++) { const a = w[j], b = w[j + h]; w[j] = a + b; w[j + h] = a - b }
      }
    }
    for (let i = 0; i < FDN; i++) w[i] *= INV_SQRT8
    for (let k = 0; k < PS; k++) {
      const s = w[k]
      const r = this.ps[k].process(s)
      w[k] = this.cs * s
      w[k + 4] += this.sn * r
    }
    for (let i = 0; i < FDN; i++) w[i] += (IN_L[i] * xl + IN_R[i] * xr) * INV_SQRT8
    for (let i = 0; i < FDN; i++) this.line[i].push(w[i])
  }
}

/** Chorus ensemble: 3 taps por canal con LFOs lentos desfasados. */
class Ensemble {
  constructor(sr) {
    this.sr = sr
    this.bl = new DelayBuf(Math.floor(0.06 * sr))
    this.br = new DelayBuf(Math.floor(0.06 * sr))
    const rate = [0.17, 0.23, 0.31]
    this.inc = new Float64Array(3); this.phL = new Float64Array(3); this.phR = new Float64Array(3)
    for (let k = 0; k < 3; k++) {
      this.inc[k] = (TWO_PI * rate[k]) / sr
      this.phL[k] = (TWO_PI * k) / 3
      this.phR[k] = TWO_PI * (k / 3 + 1 / 6)
    }
    this.oL = 0; this.oR = 0
  }
  reset() { this.bl.clear(); this.br.clear() }
  process(inL, inR, mix) {
    this.bl.push(inL); this.br.push(inR)
    let wl = 0, wr = 0
    for (let k = 0; k < 3; k++) {
      const dl = (0.0135 + 0.0013 * k + 0.0035 * Math.sin(this.phL[k])) * this.sr
      const dr = (0.0135 + 0.0013 * k + 0.0035 * Math.sin(this.phR[k])) * this.sr
      wl += this.bl.read(dl); wr += this.br.read(dr)
      this.phL[k] += this.inc[k]; if (this.phL[k] > TWO_PI) this.phL[k] -= TWO_PI
      this.phR[k] += this.inc[k] * 1.07; if (this.phR[k] > TWO_PI) this.phR[k] -= TWO_PI
    }
    wl *= 1 / 3; wr *= 1 / 3
    this.oL = inL * (1 - 0.5 * mix) + wl * 0.8 * mix
    this.oR = inR * (1 - 0.5 * mix) + wr * 0.8 * mix
  }
}

class Voice {
  constructor() {
    this.rng = new Xor()
    this.sawPh = new Uint32Array(MAX_UNISON); this.sawInc = new Uint32Array(MAX_UNISON)
    this.sawPos = new Float64Array(MAX_UNISON); this.sawDr = new Float64Array(MAX_UNISON); this.sawDrT = new Float64Array(MAX_UNISON)
    this.sawGL = new Float64Array(MAX_UNISON); this.sawGR = new Float64Array(MAX_UNISON)
    this.sawTab = new Int32Array(MAX_UNISON)
    this.wtPh = new Uint32Array(2); this.wtInc = new Uint32Array(2)
    this.wtPos = new Float64Array(2); this.wtDr = new Float64Array(2); this.wtDrT = new Float64Array(2)
    this.wtGL = new Float64Array(2); this.wtGR = new Float64Array(2)
    this.tab = new Int32Array(2)
    this.ic1 = new Float64Array(2); this.ic2 = new Float64Array(2)
    this.g = new Float64Array(2); this.dg = new Float64Array(2)
    this.a1 = new Float64Array(2); this.a2 = new Float64Array(2); this.a3 = new Float64Array(2)
    this.active = false
    this.init()
  }
  init() {
    this.keyUp = false; this.released = false; this.killing = false; this.first = true
    this.note = -1; this.pendingNote = -1; this.nSaw = 0; this.nWt = 2; this.ctr = 0; this.driftCnt = 0
    this.pendingVel = 0; this.order = 0
    this.baseF = 440; this.velAmp = 1; this.velOct = 0; this.env = 0; this.killGain = 1; this.killStep = 0; this.flip = 1
    this.subPh = 0; this.subInc = 0; this.subDr = 0; this.subDrT = 0
    this.morphIdx = 0
    this.lfoPh = 0; this.lfoPh2 = 0; this.lfoMul = 1
    this.ic1.fill(0); this.ic2.fill(0); this.g.fill(0); this.dg.fill(0); this.a1.fill(0); this.a2.fill(0); this.a3.fill(0)
    this.k = 1; this.comp = 1; this.sawScale = 1; this.subGain = 0
  }
}

class Motor {
  constructor(sampleRate) {
    this.sr = sampleRate > 0 ? sampleRate : 48000
    this.invSr = 1 / this.sr
    this.tables = new WaveTables(this.sr)
    this.verb = new ShimmerVerb(this.sr)
    this.chorus = new Ensemble(this.sr)
    this.fx = new FxRack(this.sr)   // rack de mezcla comun (EQ, compresor, saturacion, chorus, delay, reverb, anchura): apagado por defecto
    this.voices = []
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice())
    this.mixL = new Float64Array(CHUNK); this.mixR = new Float64Array(CHUNK)
    this.tL = new Float64Array(TICK); this.tR = new Float64Array(TICK)
    this.killLen = Math.max(16, Math.floor(0.005 * this.sr))
    this.driftK = 1 - Math.exp(-TICK / (0.6 * this.sr))
    this.fcMax = Math.min(20000, 0.45 * this.sr)
    this.hpA = 1 - Math.exp((-TWO_PI * 6) / this.sr)
    // ajustes (valores planos del VST3; ver PARAMS). Los campos de prueba no son parametros.
    this.s = {
      cutoffHz: 2600, resonance: 0.1, interval: 0, rt60: 9, lfoHz: 0.12, volumeDb: 0, shimmer: 0.45, attack: 1.2, release: 4,
      reverb: 0.55, detune: 0.45, sub: 0.1, chorus: 0.45, bendSemi: 0, modWheel: 0, aftertouch: 0, sustain: false, bypass: false,
      lfoDepthOct: 0.45, driftScale: 1, wetOnly: false,
    }
    const mk = (ms) => { const s = new Smoother(); s.prepare(this.sr, ms); return s }
    this.vol = mk(20); this.wet = mk(8); this.bend = mk(12); this.mw = mk(25); this.at = mk(40)
    this.cut = mk(30); this.res = mk(30); this.det = mk(80); this.sub = mk(60)
    this.chs = mk(80); this.rvs = mk(80); this.shs = mk(120); this.rts = mk(150)
    this.dcL = 0; this.dcR = 0; this.shimEnv = 0
    this.pedal = false; this.orderCtr = 0; this.seed = 0xc0ffee; this.silent = false; this.quiet = 0
    this.queue = []
    this.P = { bendF: 1, mw: 0, at: 0, cutOct: 0, resK: 1, resComp: 1, detCents: 0, subG: 0, lfoHz: 0.3, lfoDepth: 0.45, aK: 0.001, relCoef: 0.999 }
    this.applyTargets(true)
    this.reset()
  }

  reset() {
    for (const v of this.voices) v.active = false
    this.pedal = false
    this.verb.reset(); this.chorus.reset(); this.fx.reset()
    this.dcL = this.dcR = 0
    this.silent = false; this.quiet = 0
    this.orderCtr = 0
    this.queue.length = 0
  }

  /** Tempo del anfitrion (bpm) para la sincronia del delay del rack. */
  setTempo(bpm) { this.fx.setTempo(bpm) }

  settle() { this.applyTargets(true) }

  applyTargets(jump) {
    const s = this.s
    this.vol.setTarget(dbToLinear(s.volumeDb)); this.wet.setTarget(s.bypass ? 0 : 1)
    this.bend.setTarget(clamp(s.bendSemi, -12, 12)); this.mw.setTarget(clamp(s.modWheel, 0, 1)); this.at.setTarget(clamp(s.aftertouch, 0, 1))
    this.cut.setTarget(Math.log2(clamp(s.cutoffHz, 20, 20000))); this.res.setTarget(clamp(s.resonance, 0, 1))
    this.det.setTarget(clamp(s.detune, 0, 1)); this.sub.setTarget(clamp(s.sub, 0, 1)); this.chs.setTarget(clamp(s.chorus, 0, 1))
    this.rvs.setTarget(clamp(s.reverb, 0, 1)); this.shs.setTarget(clamp(s.shimmer, 0, 1))
    this.rts.setTarget(Math.log(clamp(s.rt60, 0.5, 20)))
    if (jump) for (const sm of [this.vol, this.wet, this.bend, this.mw, this.at, this.cut, this.res, this.det, this.sub, this.chs, this.rvs, this.shs, this.rts]) sm.reset(sm.tgt)
  }

  /** Valor plano -> ajustes. `id` numerico (ParamID VST3) o nombre. */
  setParam(id, v) {
    if (typeof id === 'string') id = PARAM_IDS[id]
    if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { this.fx.setParam(id, v); return }
    const s = this.s
    if (!Number.isFinite(v)) return
    switch (id) {
      case 0: s.cutoffHz = clamp(v, 20, 20000); break
      case 1: s.resonance = clamp(v, 0, 100) / 100; break
      case 2: s.interval = clamp(Math.round(v), 0, 2); break
      case 3: s.rt60 = clamp(v, 0.5, 20); break
      case 4: s.lfoHz = clamp(v, 0.05, 8); break
      case 5: s.bypass = v >= 0.5; break
      case 6: s.volumeDb = clamp(v, -24, 6); break
      case 7: s.shimmer = clamp(v, 0, 100) / 100; break
      case 8: s.attack = clamp(v, 0.02, 12); break
      case 9: s.release = clamp(v, 0.1, 15); break
      case 10: s.reverb = clamp(v, 0, 100) / 100; break
      case 11: s.detune = clamp(v, 0, 100) / 100; break
      case 12: s.sub = clamp(v, 0, 100) / 100; break
      case 13: s.chorus = clamp(v, 0, 100) / 100; break
      case 14: s.bendSemi = clamp(v, -2, 2); break
      case 15: s.modWheel = clamp(v, 0, 100) / 100; break
      case 16: s.aftertouch = clamp(v, 0, 100) / 100; break
      case 17: { const d = v >= 0.5; if (d !== s.sustain) this.setPedal(d); s.sustain = d; break }
      case 18: case 19: case 20: case 21: case 22: case 23: case 24: case 25: case 26: case 27: (this.extra || (this.extra = {}))[id] = v; return
      default: return
    }
    this.applyTargets(false)
  }

  setPedal(down) {
    this.pedal = down
    if (!down) for (const v of this.voices) if (v.active && v.keyUp) v.released = true
  }

  noteOn(note, vel) {
    note = note | 0
    if (note < 0 || note > 127) return
    if (vel > 1) vel = vel / 127
    if (!(vel > 0)) { this.noteOff(note); return }
    vel = Math.min(1, vel)
    let free = null, used = 0
    for (const v of this.voices) {
      if (v.active) { if (!v.killing || v.pendingNote >= 0) used++ } else if (!free) free = v
    }
    if (free) { this.start(free, note, vel, used); return }
    let victim = null
    for (const v of this.voices) {
      if (!v.active || v.killing) continue
      if (!victim) { victim = v; continue }
      if (v.released !== victim.released) { if (v.released) victim = v } else if (v.order < victim.order) victim = v
    }
    if (victim) { this.startKill(victim, note, vel); return }
    for (const v of this.voices) if (v.active && v.killing) { v.pendingNote = note; v.pendingVel = vel; return }
  }

  noteOff(note) {
    note = note | 0
    for (const v of this.voices) {
      if (v.active && v.killing && v.pendingNote === note) { v.pendingNote = -1; continue }
      if (!v.active || v.killing || v.note !== note || v.keyUp) continue
      v.keyUp = true
      if (!this.pedal) v.released = true
    }
  }

  /** Pitch bend en semitonos (-2..2). */
  pitchBend(semitonos) { this.s.bendSemi = clamp(semitonos, -12, 12); this.bend.setTarget(this.s.bendSemi) }

  /** Controladores MIDI: 1 rueda de modulacion, 64 sustain, 123 todas las notas off, 120 sonido off, 128 aftertouch. valor 0..127. */
  cc(num, valor) {
    if (num === 1) { this.s.modWheel = clamp(valor / 127, 0, 1); this.mw.setTarget(this.s.modWheel) }
    else if (num === 64) { const d = valor >= 64; this.s.sustain = d; this.setPedal(d) }
    else if (num === 128) { this.s.aftertouch = clamp(valor / 127, 0, 1); this.at.setTarget(this.s.aftertouch) }
    else if (num === 123) { for (const v of this.voices) if (v.active && !v.killing) { v.keyUp = true; v.released = true } }
    else if (num === 120) this.allSoundOff()
  }

  allSoundOff() { for (const v of this.voices) if (v.active && !v.killing) this.startKill(v, -1, 0) }

  /** Silencio inmediato: voces, efectos y cola de eventos a cero. */
  panic() {
    for (const v of this.voices) v.active = false
    this.pedal = false
    this.queue.length = 0
    this.verb.reset(); this.chorus.reset()
    this.dcL = this.dcR = 0; this.shimEnv = 0
  }

  activeVoices() { let a = 0; for (const v of this.voices) if (v.active) a++; return a }

  startKill(v, pendingNote, vel) {
    v.killing = true
    v.killStep = Math.max(1e-9, v.killGain / this.killLen)
    v.pendingNote = pendingNote
    v.pendingVel = vel
  }

  start(v, note, velIn, used) {
    v.init()
    v.active = true
    v.note = note
    v.baseF = 440 * Math.pow(2, (note - 69) / 12)
    v.order = ++this.orderCtr
    v.rng.seed((this.seed ^ Math.imul(note, 2654435761)) >>> 0)
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223 + Math.floor(velIn * 977)) >>> 0
    const r = v.rng
    const ds = this.s.driftScale
    v.velAmp = 0.45 + 0.55 * velIn
    v.velOct = (velIn - 0.6) * 1.4
    v.flip = r.uni() < 0.5 ? -1 : 1
    v.nSaw = used < 3 ? 7 : used < 6 ? 5 : used < 10 ? 3 : 2
    v.nWt = used < 8 ? 2 : 1
    const n = v.nSaw
    const gSaw = 1.05 / Math.sqrt(n)
    for (let i = 0; i < n; i++) {
      let p = n === 1 ? 0 : (i / (n - 1)) * 2 - 1
      p = clamp(p + 0.08 * r.bi(), -1, 1)
      v.sawPos[i] = p
      v.sawPh[i] = r.u32()
      v.sawDr[i] = v.sawDrT[i] = r.bi() * 3 * ds
      const pan = clamp(p * v.flip * 0.9, -1, 1)
      const a = (pan + 1) * Math.PI * 0.25
      v.sawGL[i] = Math.cos(a) * gSaw
      v.sawGR[i] = Math.sin(a) * gSaw
    }
    for (let j = 0; j < v.nWt; j++) {
      v.wtPos[j] = v.nWt === 1 ? 0 : (j === 0 ? -0.6 : 0.6) + 0.05 * r.bi()
      v.wtPh[j] = r.u32()
      v.wtDr[j] = v.wtDrT[j] = r.bi() * 2 * ds
      const pan = v.wtPos[j] * v.flip * 0.9
      const a = (pan + 1) * Math.PI * 0.25
      const gw = v.nWt === 1 ? 0.62 * 1.35 : 0.62
      v.wtGL[j] = Math.cos(a) * gw
      v.wtGR[j] = Math.sin(a) * gw
    }
    v.subPh = r.u32()
    v.subDr = v.subDrT = r.bi() * 1.5 * ds
    v.morphIdx = Math.min(MORPHS - 1, Math.floor(r.uni() * MORPHS))
    v.lfoPh = r.uni(); v.lfoPh2 = r.uni(); v.lfoMul = 0.93 + 0.14 * r.uni()
    v.driftCnt = Math.floor((0.8 + 1.7 * r.uni()) * this.sr / TICK)
  }

  phaseInc(f) { return Math.floor(Math.min(f * this.invSr, 0.45) * 4294967296) >>> 0 }

  tick(v, P) {
    const f0 = v.baseF * P.bendF
    const s = this.s
    if (--v.driftCnt <= 0) {
      const dm = s.driftScale
      for (let i = 0; i < v.nSaw; i++) v.sawDrT[i] = v.rng.bi() * 3 * dm
      for (let j = 0; j < v.nWt; j++) v.wtDrT[j] = v.rng.bi() * 2 * dm
      v.subDrT = v.rng.bi() * 1.5 * dm
      v.driftCnt = Math.floor((0.8 + 1.7 * v.rng.uni()) * this.sr / TICK)
    }
    for (let i = 0; i < v.nSaw; i++) {
      v.sawDr[i] += (v.sawDrT[i] - v.sawDr[i]) * this.driftK
      const f = f0 * centsRatio(v.sawPos[i] * P.detCents + v.sawDr[i])
      v.sawInc[i] = this.phaseInc(f)
      v.sawTab[i] = this.tables.offset(SAW_SHAPE, f)
    }
    for (let j = 0; j < v.nWt; j++) {
      v.wtDr[j] += (v.wtDrT[j] - v.wtDr[j]) * this.driftK
      const f = f0 * centsRatio(v.wtPos[j] * 0.6 * P.detCents + v.wtDr[j])
      v.wtInc[j] = this.phaseInc(f)
      v.tab[j] = this.tables.offset(v.morphIdx, f)
    }
    v.subDr += (v.subDrT - v.subDr) * this.driftK
    v.subInc = this.phaseInc(0.5 * f0 * centsRatio(v.subDr))
    v.lfoPh += TICK * P.lfoHz * v.lfoMul * this.invSr; v.lfoPh -= Math.floor(v.lfoPh)
    v.lfoPh2 += TICK * P.lfoHz * 0.71 * v.lfoMul * this.invSr; v.lfoPh2 -= Math.floor(v.lfoPh2)
    const lfo = Math.sin(TWO_PI * v.lfoPh), lfoQ = Math.sin(TWO_PI * v.lfoPh2)
    const envC = Math.min(1, v.env)
    const oct = P.cutOct + (0.5 * (v.note - 60)) / 12 + v.velOct + P.lfoDepth * lfo + P.mw * 2.2 + P.at * 1 - 1.4 * (1 - envC)
    for (let c = 0; c < 2; c++) {
      const oc = oct + (c === 0 ? 0.1 : -0.1) * lfoQ
      const fc = clamp(Math.pow(2, oc), 20, this.fcMax)
      const gT = Math.tan(Math.PI * fc * this.invSr)
      if (v.first) {
        v.g[c] = gT; v.dg[c] = 0
        v.a1[c] = 1 / (1 + gT * (gT + P.resK)); v.a2[c] = gT * v.a1[c]; v.a3[c] = gT * v.a2[c]
      } else v.dg[c] = (gT - v.g[c]) * (1 / TICK)
    }
    v.first = false
    v.k = P.resK
    v.comp = P.resComp
    v.sawScale = 1 + 0.8 * P.mw
    v.subGain = P.subG
    v.ctr = TICK
  }

  renderVoice(v, m, P) {
    const mixL = this.mixL, mixR = this.mixR, tL = this.tL, tR = this.tR
    const tab = this.tables.data, sine = this.tables.sine
    let done = 0
    while (done < m && v.active) {
      if (v.ctr <= 0) this.tick(v, P)
      const seg = Math.min(v.ctr, m - done)
      for (let i = 0; i < seg; i++) { tL[i] = 0; tR[i] = 0 }
      for (let u = 0; u < v.nSaw; u++) {
        let ph = v.sawPh[u]
        const inc = v.sawInc[u], off = v.sawTab[u]
        const gl = v.sawGL[u] * v.sawScale, gr = v.sawGR[u] * v.sawScale
        for (let i = 0; i < seg; i++) {
          ph = (ph + inc) >>> 0
          const idx = off + (ph >>> 20)
          const x = tab[idx] + (tab[idx + 1] - tab[idx]) * ((ph & 0xfffff) * (1 / 1048576))
          tL[i] += x * gl; tR[i] += x * gr
        }
        v.sawPh[u] = ph
      }
      for (let j = 0; j < v.nWt; j++) {
        let ph = v.wtPh[j]
        const inc = v.wtInc[j], off = v.tab[j]
        const gl = v.wtGL[j], gr = v.wtGR[j]
        for (let i = 0; i < seg; i++) {
          ph = (ph + inc) >>> 0
          const idx = off + (ph >>> 20)
          const x = tab[idx] + (tab[idx + 1] - tab[idx]) * ((ph & 0xfffff) * (1 / 1048576))
          tL[i] += x * gl; tR[i] += x * gr
        }
        v.wtPh[j] = ph
      }
      if (v.subGain > 1e-4) {
        let ph = v.subPh
        const inc = v.subInc, sg = v.subGain
        for (let i = 0; i < seg; i++) {
          ph = (ph + inc) >>> 0
          const idx = ph >>> 20
          const x = (sine[idx] + (sine[idx + 1] - sine[idx]) * ((ph & 0xfffff) * (1 / 1048576))) * sg
          tL[i] += x; tR[i] += x
        }
        v.subPh = ph
      }
      const c0 = v.ctr
      for (let i = 0; i < seg; i++) {
        // SVF TPT/ZDF (Zavalishin) por canal
        const upd = ((c0 - i - 1) & 3) === 0
        const o0 = this.svf(v, 0, tL[i], upd, P), o1 = this.svf(v, 1, tR[i], upd, P)
        if (v.released) v.env *= P.relCoef
        else if (v.env < 1) { v.env += (1.15 - v.env) * P.aK; if (v.env >= 1) v.env = 1 }
        let amp = v.env * v.velAmp
        if (v.killing) { v.killGain -= v.killStep; if (v.killGain < 0) v.killGain = 0; amp *= v.killGain }
        mixL[done + i] += o0 * amp
        mixR[done + i] += o1 * amp
        if ((v.killing && v.killGain <= 0) || (v.released && v.env < 1e-5)) { v.active = false; break }
      }
      v.ctr -= seg
      done += seg
    }
    if (!v.active && v.killing && v.pendingNote >= 0) {
      const pn = v.pendingNote, pv = v.pendingVel
      let used = 0
      for (const o of this.voices) if (o.active) used++
      this.start(v, pn, pv, used)
    }
  }

  svf(v, c, x, upd, P) {
    v.g[c] += v.dg[c]
    if (upd) { const g = v.g[c]; v.a1[c] = 1 / (1 + g * (g + v.k)); v.a2[c] = g * v.a1[c]; v.a3[c] = g * v.a2[c] }
    const a1 = v.a1[c], a2 = v.a2[c], a3 = v.a3[c]
    const v3 = x - v.ic2[c]
    const v1 = a1 * v.ic1[c] + a2 * v3
    const v2 = v.ic2[c] + a2 * v.ic1[c] + a3 * v3
    v.ic1[c] = 2 * v1 - v.ic1[c]
    v.ic2[c] = 2 * v2 - v.ic2[c]
    return v2 * v.comp
  }

  renderChunk(outL, outR, off, m) {
    const s = this.s, P = this.P
    const vg0 = this.vol.cur, vg1 = this.vol.advance(m)
    const w0 = this.wet.cur, w1 = this.wet.advance(m)
    this.bend.advance(m); this.mw.advance(m); this.at.advance(m); this.cut.advance(m); this.res.advance(m)
    this.det.advance(m); this.sub.advance(m); this.chs.advance(m); this.rvs.advance(m); this.shs.advance(m); this.rts.advance(m)
    P.bendF = Math.pow(2, this.bend.cur / 12)
    P.mw = this.mw.cur; P.at = this.at.cur; P.cutOct = this.cut.cur
    const res = this.res.cur
    P.resK = 2 * Math.pow(0.03, res)
    P.resComp = 1 / Math.sqrt(1 + 3 * res * res)
    P.detCents = this.det.cur * 28
    P.subG = this.sub.cur * 0.55
    P.lfoHz = s.lfoHz; P.lfoDepth = s.lfoDepthOct
    const tau = clamp(s.attack, 0.02, 12) / Math.log(1.15 / 0.15)
    P.aK = 1 - Math.exp(-1 / (tau * this.sr))
    P.relCoef = Math.exp(Math.log(1e-3) / (clamp(s.release, 0.1, 15) * this.sr))
    let anyVoice = false
    for (const v of this.voices) if (v.active) { anyVoice = true; break }
    if (anyVoice) this.silent = false
    if (this.silent) { // sin voces y cola extinguida (< -120 dBFS): no se procesa nada
      outL.fill(0, off, off + m); outR.fill(0, off, off + m)
      this.shimEnv *= 0.8
      return
    }
    this.mixL.fill(0, 0, m); this.mixR.fill(0, 0, m)
    for (const v of this.voices) if (v.active) this.renderVoice(v, m, P)
    this.verb.setRt60(Math.exp(this.rts.cur))
    this.verb.setShimmer(this.shs.cur, s.interval)
    const chMix = this.chs.cur, rvMix = this.rvs.cur
    const wetG = s.wetOnly ? 1 : 0.95 * rvMix, dryG = s.wetOnly ? 0 : 1 - 0.45 * rvMix
    let shimAcc = 0, outAcc = 0
    for (let i = 0; i < m; i++) {
      this.chorus.process(this.mixL[i], this.mixR[i], chMix)
      const cl = this.chorus.oL, cr = this.chorus.oR
      this.verb.process(cl, cr)
      const wl = this.verb.outL, wr = this.verb.outR
      const t = (i + 1) / m
      const g = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t) * 0.35
      let yl = (cl * dryG + wl * wetG) * g
      let yr = (cr * dryG + wr * wetG) * g
      if (!(Math.abs(yl) < 1e4) || !(Math.abs(yr) < 1e4)) { yl = yr = 0; this.verb.reset(); this.chorus.reset() }
      this.dcL += this.hpA * (yl - this.dcL)
      this.dcR += this.hpA * (yr - this.dcR)
      outL[off + i] = softClip(yl - this.dcL)
      outR[off + i] = softClip(yr - this.dcR)
      shimAcc += wl * wl + wr * wr
      outAcc += yl * yl + yr * yr
    }
    if (!anyVoice && outAcc / m < 1e-12) {
      if (++this.quiet >= 4) { this.silent = true; this.quiet = 0; this.verb.reset(); this.chorus.reset(); this.dcL = this.dcR = 0 }
    } else this.quiet = 0
    this.shimEnv += 0.2 * (Math.sqrt(shimAcc / Math.max(1, m)) - this.shimEnv)
  }

  /** Renderiza n muestras en outL/outR a partir de `offset` (sin asignaciones). */
  render(outL, outR, n, offset = 0) {
    let pos = 0
    while (pos < n) {
      const m = Math.min(CHUNK, n - pos)
      this.renderChunk(outL, outR, offset + pos, m)
      pos += m
    }
    this.fx.process(outL, outR, n, offset)   // rack FX comun al final de la cadena (con todo apagado no toca el buffer)
  }

  // ---- eventos programados al sample (cuando = segundos del AudioContext) ----
  enqueue(ev) {
    const q = this.queue
    let i = q.length
    while (i > 0 && q[i - 1].cuando > ev.cuando) i--
    q.splice(i, 0, ev)
  }

  applyEvent(e) {
    if (e.tipo === 'on') this.noteOn(e.nota, e.vel)
    else if (e.tipo === 'off') this.noteOff(e.nota)
  }

  /** Como render(), aplicando los eventos en cola con precision de muestra; t0 = tiempo del primer sample. */
  renderAt(outL, outR, n, t0) {
    const q = this.queue
    let pos = 0
    while (pos < n) {
      while (q.length && Math.ceil((q[0].cuando - t0) * this.sr - 0.5) <= pos) this.applyEvent(q.shift())
      let next = n
      if (q.length) next = Math.min(n, Math.max(pos, Math.ceil((q[0].cuando - t0) * this.sr - 0.5)))
      if (next > pos) { this.render(outL, outR, next - pos, pos); pos = next }
    }
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('jaswave-shimmer-pad', class extends AudioWorkletProcessor {
    constructor() {
      super()
      this.motor = new Motor(sampleRate)
      this.tmp = new Float32Array(128)
      this.port.onmessage = (e) => {
        const m = e.data
        if (!m) return
        if (m.tipo === 'param') this.motor.setParam(m.id, m.valor)
        else if (m.tipo === 'on' || m.tipo === 'off') {
          if (typeof m.cuando === 'number') this.motor.enqueue(m)
          else this.motor.applyEvent(m)
        } else if (m.tipo === 'panico') this.motor.panic()
        else if (m.tipo === 'bend') this.motor.pitchBend(m.valor)
        else if (m.tipo === 'cc') this.motor.cc(m.num, m.valor)
        else if (m.tipo === 'tempo') this.motor.setTempo(m.bpm)
      }
    }
    process(_inputs, outputs) {
      const out = outputs[0]
      if (!out || !out[0]) return true
      const L = out[0]
      let R = out[1]
      if (!R) { if (this.tmp.length < L.length) this.tmp = new Float32Array(L.length); R = this.tmp }
      this.motor.renderAt(L, R, L.length, currentTime)
      for (let c = 2; c < out.length; c++) out[c].set(L)
      return true
    }
  })
}

if (typeof module !== 'undefined') module.exports = { Motor, PARAMS, PARAM_IDS }
