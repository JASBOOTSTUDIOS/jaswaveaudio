// =====================================================================================
//  JasWave Ambient Atmos - réplica web (AudioWorklet, autocontenida, sin imports)
//
//  Mismo diseño que el VST3 (plugins/com.jaswave.plugin.ambient-atmos/source/ambient_atmos_dsp.h):
//    generador -> saturación de cinta -> paso-altos -> SVF paso-bajo con LFO en cuadratura -> EQ 4 bandas
//    -> ensemble chorus -> tape delay ping-pong sincronizado al tempo -> reverb FDN plate/hall con shimmer
//    -> compresor suave -> anchura M/S -> volumen -> limitador suave.
//  Mismos IDs de parámetro (kPreset=0 .. kAftertouch=40), mismos rangos y valores planos, mismos 40 presets.
//  `setParam(0, i)` aplica el preset completo (en el VST3 lo hace el controlador), salvo volumen, afinación,
//  bypass, sustain, bend, rueda y aftertouch.
//
//  LIMITACIÓN IMPORTANTE: el VST3 reproduce bancos de muestras (.jws, ~180 MB de texturas congeladas con
//  PaulStretch) que un AudioWorklet no puede leer. Aquí el timbre lo genera un SÍNTESIS ADITIVA/RUIDO FILTRADO
//  ligera que imita la identidad de cada capa (guitarra, pad, textura, sound design): es una APROXIMACIÓN del
//  carácter, no idéntica al VST3 con muestras. Opcionalmente se puede enviar un banco REDUCIDO:
//    port.postMessage({ tipo: 'banco', banco: 'guitar'|'pads'|'textures'|'any', zonas: [ {
//        lokey, hikey, root,        // rango de teclas y nota original (MIDI)
//        capa,                      // grupo/capa del .jws (0..9, como en el VST3)
//        sr,                        // frecuencia de muestreo de los datos
//        bucleIni, bucleFin,        // bucle en muestras (bucleFin <= bucleIni = sin bucle)
//        canales,                   // 1 o 2 (datos entrelazados)
//        datos                      // Float32Array (-1..1) o Int16Array (PCM16) entrelazado
//    }, ... ] })
//  Si hay zona para nota+capa, esa capa se reproduce en bucle (interpolación Hermite, unísono con detune)
//  en lugar del generador aditivo; el resto de la cadena es la misma.
//
//  Mensajes del puerto: {tipo:'param', id, valor} | {tipo:'on', nota, vel, cuando} | {tipo:'off', nota, cuando}
//    | {tipo:'panico'} | {tipo:'bend', valor} | {tipo:'cc', num, valor} | {tipo:'tempo', bpm} | {tipo:'banco', ...}
//  `cuando` = segundos del AudioContext (sample-accurate). vel 0..1.
//
//  Rendimiento: 8 voces máx. (se reduce el unísono con muchas voces), <= 8-10 parciales por componente.
// =====================================================================================
'use strict'

const TAU = Math.PI * 2
const CHUNK = 32          // periodo de control (muestras) = kTick del VST3
const MAX_VOICES = 8
const MAX_GROUPS = 12
const MAX_PART = 16
const FDN = 8
const NPS = 4

const PARAM = {
  preset: 0, attack: 1, release: 2, fxMacro: 3, tune: 4, volume: 5, cutoff: 6, resonance: 7, lfoRate: 8, lfoDepth: 9,
  lowCut: 10, unisonDetune: 11, unisonVoices: 12, chorus: 13, drive: 14, layerBlend: 15, delayMix: 16, delaySync: 17,
  delayTime: 18, delayFb: 19, delayTone: 20, tapeAge: 21, reverbMix: 22, reverbDecay: 23, reverbDamp: 24, reverbMod: 25,
  reverbType: 26, preDelay: 27, shimmer: 28, shimmerInterval: 29, eqLow: 30, eqLowMid: 31, eqHighMid: 32, eqHigh: 33,
  comp: 34, width: 35, bypass: 36, sustain: 37, bend: 38, modWheel: 39, aftertouch: 40,
}
const NP = 41
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
fxRegistrarParametros([], PARAM)   // ids 100.. del FX Rack comun en PARAM (esta réplica no tiene tabla PARAMS)
// [min, max, map] map: 0 lineal, 1 log, 2 escalonado (igual que ambient_atmos_params.h)
const SPEC = []
;(() => {
  const s = (id, mn, mx, map) => { SPEC[id] = [mn, mx, map] }
  s(0, 0, 39, 2); s(1, 0.002, 10, 1); s(2, 0.2, 16, 1); s(3, 0, 100, 0); s(4, -100, 100, 0); s(5, -24, 6, 0)
  s(6, 200, 20000, 1); s(7, 0, 90, 0); s(8, 0.02, 8, 1); s(9, 0, 100, 0); s(10, 20, 400, 1); s(11, 0, 100, 0)
  s(12, 0, 2, 2); s(13, 0, 100, 0); s(14, 0, 100, 0); s(15, 0, 100, 0); s(16, 0, 100, 0); s(17, 0, 5, 2)
  s(18, 80, 1500, 1); s(19, 0, 92, 0); s(20, 800, 9000, 1); s(21, 0, 100, 0); s(22, 0, 100, 0); s(23, 0.5, 30, 1)
  s(24, 0, 100, 0); s(25, 0, 100, 0); s(26, 0, 1, 2); s(27, 0, 150, 0); s(28, 0, 100, 0); s(29, 0, 2, 2)
  s(30, -12, 12, 0); s(31, -12, 12, 0); s(32, -12, 12, 0); s(33, -12, 12, 0); s(34, 0, 100, 0); s(35, 0, 150, 0)
  s(36, 0, 1, 2); s(37, 0, 1, 2); s(38, -2, 2, 0); s(39, 0, 100, 0); s(40, 0, 100, 0)
})()
const SYNC_BEATS = [0, 2, 1.5, 1, 0.75, 0.5]
const NO_PRESET = [0, 4, 5, 36, 37, 38, 39, 40]   // el preset no toca estos parámetros (como Controller::applyPreset)

// 40 presets de fábrica (generados desde source/ambient_atmos_presets.h; p = valores planos indexados por ID de parámetro)
const PRESETS = [
  { name: "Luz de Madrugada", familia: 0, capaA: 1, capaB: -1, p: [0, 1.8, 7, 50, 0, 0, 7500, 8, 0.12, 18, 70, 35, 1, 30, 15, 0, 32, 4, 520, 52, 3600, 25, 40, 9, 60, 40, 1, 25, 24, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Dream Tide", familia: 0, capaA: 0, capaB: -1, p: [0, 0.9, 6, 50, 0, 0, 8000, 8, 0.12, 18, 70, 35, 1, 40, 15, 0, 38, 2, 520, 56, 3600, 25, 36, 6, 60, 40, 0, 25, 10, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Ceniza y Cielo", familia: 0, capaA: 2, capaB: -1, p: [0, 3, 10, 50, 0, 0, 8000, 8, 0.12, 18, 70, 35, 1, 30, 15, 0, 26, 3, 520, 48, 3600, 25, 44, 12, 60, 40, 1, 25, 28, 0, 0, 0, 0, -1.5, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Amber Drift", familia: 0, capaA: 0, capaB: 1, p: [0, 1.4, 6.5, 50, 0, 0, 4200, 8, 0.12, 18, 70, 35, 1, 30, 32, 35, 30, 4, 520, 45, 2600, 55, 32, 8, 60, 40, 1, 25, 8, 0, 0, 1.5, 0, -3, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Marea Alta", familia: 0, capaA: 3, capaB: -1, p: [0, 0.5, 5, 50, 0, 0, 6000, 8, 0.12, 18, 70, 35, 1, 55, 45, 0, 34, 4, 520, 42, 3600, 25, 34, 5.5, 60, 40, 0, 25, 12, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Velvet Horizon", familia: 0, capaA: 1, capaB: -1, p: [0, 0.7, 4.5, 50, 0, 0, 8000, 8, 0.12, 18, 70, 35, 1, 30, 15, 0, 28, 5, 520, 46, 3600, 25, 34, 7, 60, 40, 1, 25, 15, 0, 1, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Eco de Cristal", familia: 0, capaA: 0, capaB: -1, p: [0, 1.2, 8, 50, 0, 0, 10000, 8, 0.12, 18, 70, 35, 1, 30, 15, 0, 40, 4, 520, 58, 3600, 25, 48, 14, 60, 40, 1, 25, 58, 0, 0, 0, 1, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Paper Lanterns", familia: 0, capaA: 0, capaB: 2, p: [0, 0.35, 4, 50, 0, 0, 8000, 8, 0.12, 18, 70, 35, 1, 30, 15, 30, 36, 4, 520, 55, 3600, 25, 32, 6.5, 60, 40, 0, 25, 20, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Tormenta Lenta", familia: 0, capaA: 3, capaB: 2, p: [0, 4.5, 11, 50, 0, 0, 5200, 8, 0.12, 18, 70, 35, 1, 45, 55, 40, 30, 3, 520, 60, 3600, 25, 46, 15, 60, 40, 1, 25, 30, 0, 0, 0, 0, 0, 45, 115, 0, 0, 0, 0, 0] },
  { name: "Oro Tenue", familia: 0, capaA: 2, capaB: -1, p: [0, 2.2, 8, 50, 0, 0, 6500, 8, 0.12, 18, 70, 35, 1, 30, 15, 0, 35, 3, 520, 50, 3600, 25, 42, 10, 60, 40, 1, 25, 22, 0, 0, 1, 0, -1, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Coro de Neblina", familia: 1, capaA: 0, capaB: 4, p: [0, 3, 9, 50, 0, 0, 6500, 8, 0.12, 18, 70, 35, 1, 30, 15, 35, 14, 2, 520, 45, 3600, 25, 46, 11, 60, 40, 1, 25, 26, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Santuario", familia: 1, capaA: 1, capaB: 4, p: [0, 2.5, 9, 50, 0, 0, 5200, 8, 0.12, 18, 70, 35, 1, 38, 15, 40, 12, 2, 520, 45, 3600, 25, 48, 13, 60, 40, 1, 25, 30, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Barrido Boreal", familia: 1, capaA: 2, capaB: -1, p: [0, 3.5, 10, 50, 0, 0, 3200, 24, 0.07, 48, 70, 35, 1, 30, 15, 0, 16, 2, 520, 45, 3600, 25, 44, 12, 60, 40, 1, 25, 28, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Aurora Liquida", familia: 1, capaA: 2, capaB: 0, p: [0, 4, 11, 50, 0, 0, 4200, 8, 0.09, 36, 70, 35, 1, 30, 15, 45, 18, 4, 520, 45, 3600, 25, 50, 14, 60, 40, 1, 25, 34, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Respiro Dorado", familia: 1, capaA: 3, capaB: 1, p: [0, 2.8, 8.5, 50, 0, 0, 4800, 8, 0.12, 18, 70, 35, 1, 30, 20, 42, 10, 2, 520, 45, 3600, 40, 42, 10, 60, 40, 1, 25, 18, 0, 0, 1, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Velo de Seda", familia: 1, capaA: 4, capaB: -1, p: [0, 3.8, 10, 50, 0, 0, 7000, 8, 0.12, 18, 70, 35, 1, 35, 15, 0, 8, 2, 520, 45, 3600, 25, 44, 12, 60, 40, 1, 25, 24, 0, 0, 0, 0, 0, 25, 115, 0, 0, 0, 0, 0] },
  { name: "Nube Calida", familia: 1, capaA: 1, capaB: -1, p: [0, 2, 7, 50, 0, 0, 2600, 8, 0.12, 18, 70, 35, 1, 30, 26, 0, 14, 2, 520, 45, 2400, 45, 36, 8, 60, 40, 1, 25, 10, 0, 0, 0, 0, -3, 42, 115, 0, 0, 0, 0, 0] },
  { name: "Glass Cathedral", familia: 1, capaA: 0, capaB: 2, p: [0, 3.2, 13, 50, 0, 0, 9000, 8, 0.12, 18, 70, 35, 1, 30, 15, 38, 14, 2, 520, 45, 3600, 25, 56, 20, 45, 40, 1, 25, 64, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Bruma del Valle", familia: 1, capaA: 3, capaB: -1, p: [0, 4.2, 12, 50, 0, 0, 3800, 8, 0.06, 28, 70, 35, 1, 30, 15, 0, 12, 2, 520, 45, 3600, 25, 46, 11, 60, 40, 1, 25, 16, 0, 0, 0, 0, 0, 30, 125, 0, 0, 0, 0, 0] },
  { name: "Altar Pad", familia: 1, capaA: 1, capaB: 3, p: [0, 2.4, 8, 50, 0, 0, 5600, 8, 0.12, 18, 70, 35, 1, 30, 15, 45, 20, 3, 520, 42, 3600, 25, 42, 10, 60, 40, 1, 25, 36, 1, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Aire Fino", familia: 2, capaA: 0, capaB: -1, p: [0, 3, 9, 50, 0, 0, 12000, 8, 0.12, 18, 150, 35, 1, 20, 5, 0, 14, 2, 520, 40, 3600, 25, 45, 12, 60, 40, 1, 25, 30, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Viento Alto", familia: 2, capaA: 1, capaB: -1, p: [0, 3.5, 10, 50, 0, 0, 6000, 8, 0.08, 30, 70, 35, 1, 30, 15, 0, 16, 2, 520, 45, 3600, 25, 42, 10, 60, 40, 1, 25, 18, 0, 0, 0, 0, 0, 30, 130, 0, 0, 0, 0, 0] },
  { name: "Presion Profunda", familia: 2, capaA: 2, capaB: -1, p: [0, 4, 12, 50, 0, 0, 2200, 8, 0.12, 18, 28, 35, 1, 30, 22, 0, 8, 2, 520, 45, 3600, 25, 36, 14, 60, 40, 1, 25, 8, 0, 2, 0, 0, 0, 45, 115, 0, 0, 0, 0, 0] },
  { name: "Dron de Cuerdas", familia: 2, capaA: 3, capaB: -1, p: [0, 4.5, 12, 50, 0, 0, 4200, 8, 0.12, 18, 70, 35, 1, 36, 15, 0, 10, 2, 520, 45, 3600, 25, 44, 15, 60, 40, 1, 25, 20, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Olas Lentas", familia: 2, capaA: 4, capaB: -1, p: [0, 2.5, 9, 50, 0, 0, 9000, 8, 0.12, 18, 70, 35, 1, 30, 15, 0, 12, 2, 520, 45, 3600, 25, 36, 7, 60, 40, 0, 25, 12, 0, 0, 0, 0, 0, 30, 135, 0, 0, 0, 0, 0] },
  { name: "Nube Armonica", familia: 2, capaA: 5, capaB: -1, p: [0, 3.5, 11, 50, 0, 0, 9500, 8, 0.12, 18, 70, 35, 1, 40, 15, 0, 18, 4, 520, 45, 3600, 25, 48, 16, 60, 40, 1, 25, 44, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Costa Brumosa", familia: 2, capaA: 4, capaB: 0, p: [0, 3, 10, 50, 0, 0, 8000, 8, 0.12, 18, 70, 35, 1, 30, 15, 40, 16, 2, 520, 45, 3600, 25, 42, 11, 60, 40, 1, 25, 18, 0, 0, 0, 0, 0, 30, 135, 0, 0, 0, 0, 0] },
  { name: "Monte Silente", familia: 2, capaA: 1, capaB: 2, p: [0, 4, 12, 50, 0, 0, 3400, 8, 0.12, 26, 70, 35, 1, 30, 15, 45, 10, 2, 520, 45, 3600, 25, 40, 13, 60, 40, 1, 25, 12, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Cielo de Cristal", familia: 2, capaA: 5, capaB: 0, p: [0, 3.2, 12, 50, 0, 0, 11000, 8, 0.12, 18, 70, 35, 1, 30, 15, 35, 16, 4, 520, 45, 3600, 25, 52, 18, 60, 40, 1, 25, 54, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Hondo Oceano", familia: 2, capaA: 3, capaB: 4, p: [0, 4, 13, 50, 0, 0, 3600, 8, 0.12, 18, 70, 35, 1, 30, 15, 45, 10, 2, 520, 45, 3600, 25, 46, 16, 60, 40, 1, 25, 16, 0, 1.5, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Ascenso", familia: 3, capaA: 6, capaB: -1, p: [0, 0.05, 2, 50, 0, 0, 14000, 8, 0.12, 18, 90, 35, 0, 10, 15, 0, 10, 2, 520, 35, 3600, 25, 30, 6, 60, 40, 1, 25, 20, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Caida Lenta", familia: 3, capaA: 7, capaB: -1, p: [0, 0.05, 3, 50, 0, 0, 12000, 8, 0.12, 18, 70, 35, 0, 30, 15, 0, 12, 2, 520, 45, 3600, 25, 38, 9, 60, 40, 1, 25, 14, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Brillo Infinito", familia: 3, capaA: 8, capaB: -1, p: [0, 2.5, 12, 50, 0, 0, 14000, 8, 0.12, 18, 70, 35, 1, 40, 15, 0, 18, 4, 520, 45, 3600, 25, 55, 22, 60, 40, 1, 25, 70, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Guitarra Inversa", familia: 3, capaA: 9, capaB: -1, p: [0, 0.02, 4, 50, 0, 0, 9000, 8, 0.12, 18, 70, 35, 0, 30, 15, 0, 30, 4, 520, 55, 3600, 25, 42, 10, 60, 40, 1, 25, 24, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Umbral", familia: 3, capaA: 6, capaB: 8, p: [0, 0.05, 6, 50, 0, 0, 13000, 8, 0.12, 18, 70, 35, 1, 30, 15, 40, 14, 2, 520, 45, 3600, 25, 45, 12, 60, 40, 1, 25, 40, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Descenso Celeste", familia: 3, capaA: 7, capaB: 8, p: [0, 0.05, 7, 50, 0, 0, 12000, 8, 0.12, 18, 70, 35, 1, 30, 15, 45, 14, 2, 520, 45, 3600, 25, 48, 14, 60, 40, 1, 25, 36, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Latido de Luz", familia: 3, capaA: 8, capaB: -1, p: [0, 1.2, 8, 50, 0, 0, 6500, 30, 1.6, 55, 70, 35, 1, 30, 15, 0, 34, 5, 520, 55, 3600, 25, 40, 9, 60, 40, 1, 25, 30, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Puerta del Cielo", familia: 3, capaA: 9, capaB: 6, p: [0, 0.03, 5, 50, 0, 0, 10000, 8, 0.12, 18, 70, 35, 1, 30, 15, 35, 26, 4, 520, 50, 3600, 25, 46, 13, 60, 40, 1, 25, 32, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Estela", familia: 3, capaA: 8, capaB: -1, p: [0, 0.6, 10, 55, 0, 0, 9000, 8, 0.12, 18, 70, 35, 1, 30, 15, 0, 52, 2, 520, 72, 3600, 55, 44, 12, 60, 40, 1, 25, 26, 0, 0, 0, 0, 0, 30, 115, 0, 0, 0, 0, 0] },
  { name: "Silencio Antes", familia: 3, capaA: 7, capaB: 9, p: [0, 0.04, 8, 50, 0, 0, 7000, 8, 0.12, 18, 70, 35, 1, 30, 15, 45, 20, 3, 520, 45, 3600, 25, 50, 15, 60, 40, 1, 25, 20, 0, 0, 0, 0, 0, 40, 115, 0, 0, 0, 0, 0] },
]

// ---------------------------------------------------------------- utilidades
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x)
function softClip(x) {
  const a = Math.abs(x)
  if (a < 0.6) return x
  const y = 0.6 + 0.37 * Math.tanh((a - 0.6) / 0.37)
  return x < 0 ? -y : y
}
function fastTanh(x) {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}
const pow2AtLeast = (n) => { let p = 1; while (p < n) p <<= 1; return p }
const gaussLog = (f, fc, bw) => { const z = Math.log2(Math.max(f, 1) / fc) / bw; return Math.exp(-0.5 * z * z) }

class DelayBuf {
  constructor(n) { this.b = new Float64Array(pow2AtLeast(n + 4)); this.mask = this.b.length - 1; this.w = 0 }
  clear() { this.b.fill(0); this.w = 0 }
  push(x) { this.b[this.w] = x; this.w = (this.w + 1) & this.mask }
  read(D) { // D = 1 -> última escrita
    const pos = this.w - D + this.b.length   // D < longitud: pos > 0 (evita Math.floor)
    const fl = pos | 0, fr = pos - fl
    const i0 = fl & this.mask, i1 = (i0 + 1) & this.mask
    return this.b[i0] + (this.b[i1] - this.b[i0]) * fr
  }
}

class HighPass2 {
  constructor() { this.b0 = 1; this.b1 = -2; this.b2 = 1; this.a1 = 0; this.a2 = 0; this.z1 = [0, 0]; this.z2 = [0, 0] }
  design(sr, fc) {
    const w = Math.tan((Math.PI * Math.min(fc, 0.45 * sr)) / sr), n = 1 / (1 + 1.41421356237 * w + w * w)
    this.b0 = n; this.b1 = -2 * n; this.b2 = n
    this.a1 = 2 * (w * w - 1) * n; this.a2 = (1 - 1.41421356237 * w + w * w) * n
  }
  reset() { this.z1[0] = this.z1[1] = this.z2[0] = this.z2[1] = 0 }
  process(c, x) {
    const y = this.b0 * x + this.z1[c]
    this.z1[c] = this.b1 * x - this.a1 * y + this.z2[c]
    this.z2[c] = this.b2 * x - this.a2 * y
    return y
  }
}

// SVF TPT paso bajo estéreo
class SvfLp {
  constructor() { this.ic1 = [0, 0]; this.ic2 = [0, 0]; this.a1 = [1, 1]; this.a2 = [0, 0]; this.a3 = [0, 0] }
  reset() { this.ic1[0] = this.ic1[1] = this.ic2[0] = this.ic2[1] = 0 }
  set(c, fc, sr, k) {
    const g = Math.tan((Math.PI * clamp(fc, 20, 0.45 * sr)) / sr)
    this.a1[c] = 1 / (1 + g * (g + k)); this.a2[c] = g * this.a1[c]; this.a3[c] = g * this.a2[c]
  }
  process(c, x) {
    const v3 = x - this.ic2[c]
    const v1 = this.a1[c] * this.ic1[c] + this.a2[c] * v3
    const v2 = this.ic2[c] + this.a2[c] * this.ic1[c] + this.a3[c] * v3
    this.ic1[c] = 2 * v1 - this.ic1[c]
    this.ic2[c] = 2 * v2 - this.ic2[c]
    return v2
  }
}

// Biquad RBJ (idéntico a BiquadCoefs::design de jw_dsp.h): tipos 'ls', 'bell', 'hs'
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z = new Float64Array(4) }
  design(type, sr, freq, gainDb, q) {
    freq = clamp(freq, 10, sr * 0.499)
    const w0 = (TAU * freq) / sr, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * q)
    const A = Math.pow(10, gainDb / 40)
    let b0, b1, b2, a0, a1, a2
    if (type === 'bell') {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
    } else if (type === 'ls') {
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 - (A - 1) * cw + s2); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s2)
      a0 = A + 1 + (A - 1) * cw + s2; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s2
    } else {
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cw + s2); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s2)
      a0 = A + 1 - (A - 1) * cw + s2; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s2
    }
    const inv = 1 / a0
    this.b0 = b0 * inv; this.b1 = b1 * inv; this.b2 = b2 * inv; this.a1 = a1 * inv; this.a2 = a2 * inv
  }
  reset() { this.z.fill(0) }
  process(c, x) {
    const o = c * 2
    const y = this.b0 * x + this.z[o]
    this.z[o] = this.b1 * x - this.a1 * y + this.z[o + 1]
    this.z[o + 1] = this.b2 * x - this.a2 * y
    return y
  }
}

// ---------------------------------------------------------------- shimmer: pitch shifter granular (4 granos Hann)
class GrainShifter {
  constructor(sr, windowSec, seed) {
    this.W = Math.max(64, windowSec * sr)
    this.buf = new DelayBuf(Math.floor(this.W) + 8)
    this.phi0 = ((seed * 2654435761) >>> 0) / 4294967296
    this.hpA = 1 - Math.exp((-TAU * 110) / sr)
    this.lpA = 1 - Math.exp((-TAU * Math.min(7000, 0.4 * sr)) / sr)
    this.pw = 1 - Math.exp(-1 / (0.03 * sr))
    this.setRatio(2)
    this.reset()
  }
  reset() {
    this.buf.clear(); this.hp = 0; this.lp = 0; this.pin = 0; this.pout = 0; this.gain = 1; this.cnt = 0
    this.phi = this.phi0; this.resync()
  }
  resync() { this.c = Math.cos(TAU * this.phi); this.s = Math.sin(TAU * this.phi) }
  setRatio(r) {
    this.dphi = (1 - r) / this.W
    this.rc = Math.cos(TAU * this.dphi); this.rs = Math.sin(TAU * this.dphi)
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

// ---------------------------------------------------------------- reverb FDN 8 líneas con shimmer (AtmosVerb)
const ROW_L = [1, 1, -1, -1, -1, -1, 1, 1], ROW_R = [1, -1, 1, -1, -1, 1, -1, 1]
const IN_L = [1, 1, -1, -1, 1, 1, -1, -1], IN_R = [1, -1, -1, 1, 1, -1, -1, 1]
const INV_S8 = 0.35355339059327373
class AtmosVerb {
  constructor(sr) {
    this.sr = sr
    const base = [1117, 1301, 1559, 1823, 2111, 2393, 2699, 3067]
    this.baseD = new Float64Array(FDN); this.d = new Float64Array(FDN); this.ghf = new Float64Array(FDN); this.dg = new Float64Array(FDN)
    this.lp = new Float64Array(FDN); this.modC = new Float64Array(FDN); this.modS = new Float64Array(FDN)
    this.modRc = new Float64Array(FDN); this.modRs = new Float64Array(FDN)
    this.line = []
    for (let i = 0; i < FDN; i++) {
      this.baseD[i] = (base[i] * sr) / 48000
      this.line.push(new DelayBuf(Math.floor(this.baseD[i] * 1.35 + 0.0016 * sr + 16)))
      const rate = 0.07 + 0.043 * i
      this.modRc[i] = Math.cos((TAU * rate) / sr); this.modRs[i] = Math.sin((TAU * rate) / sr)
      this.modC[i] = Math.cos(0.7 * i); this.modS[i] = Math.sin(0.7 * i)
    }
    const apL = [142, 107, 379, 277], apR = [157, 113, 403, 293]
    this.apL = apL.map((n) => new Float64Array(Math.max(8, Math.round((n * sr) / 48000))))
    this.apR = apR.map((n) => new Float64Array(Math.max(8, Math.round((n * sr) / 48000))))
    this.apIL = [0, 0, 0, 0]; this.apIR = [0, 0, 0, 0]
    this.ps = []
    for (let k = 0; k < NPS; k++) this.ps.push(new GrainShifter(sr, 0.085 * (1 + 0.11 * k), 0x1234567 + 7919 * k))
    this.pLp = Math.exp((-TAU * 3000) / sr)
    this.z = new Float64Array(FDN); this.w = new Float64Array(FDN)
    this.modCnt = 0; this.lastInterval = -1; this.shimAmt = 0; this.sn = 0; this.cs = 1; this.wetNorm = 1; this.modDepth = 10
    this.outL = 0; this.outR = 0
    this.setParams(1, 6, 0.6, 0.4, 0, 0)
  }
  reset() {
    for (const l of this.line) l.clear()
    this.lp.fill(0)
    for (const b of this.apL) b.fill(0)
    for (const b of this.apR) b.fill(0)
    for (const p of this.ps) p.reset()
  }
  setParams(scale, rt, damping, mod, shimmer, interval) {
    rt = clamp(rt, 0.3, 32); damping = clamp(damping, 0, 1)
    this.shimAmt = clamp(shimmer, 0, 1)
    this.modDepth = (0.00015 + 0.0011 * clamp(mod, 0, 1)) * this.sr
    let sumD = 0
    for (let i = 0; i < FDN; i++) { this.d[i] = this.baseD[i] * scale; sumD += this.d[i] }
    const rtEff = rt * (1.17 + 0.2 / (1 + 2 * rt)) * (1 + 0.2 * this.shimAmt)
    const hfOld = rtEff > 3 ? 0.35 : 0.35 + (0.15 * (3 - rtEff)) / 3
    const hfRatio = clamp(hfOld * Math.pow(2.2, (0.7375 - damping) * 2), 0.08, 0.95)
    for (let i = 0; i < FDN; i++) {
      const glf = Math.min(0.99995, Math.pow(10, (-3 * this.d[i]) / (rtEff * this.sr)))
      const ghf = Math.min(glf, Math.pow(10, (-3 * this.d[i]) / (rtEff * hfRatio * this.sr)))
      this.ghf[i] = ghf; this.dg[i] = glf - ghf
    }
    this.wetNorm = clamp(0.9 * Math.sqrt((13.8 * sumD) / (rtEff * this.sr)), 0.35, 2.5)
    const th = (this.shimAmt * TAU) / 10
    this.sn = Math.sin(th); this.cs = Math.cos(th)
    if (this.shimAmt <= 0.5) { this.sn *= 1.4142 }   // con 2 shifters se compensa la energía de realimentación
    if (interval !== this.lastInterval) {
      const ratio = [2, 1.4983070768766815, 0.5]
      for (const p of this.ps) p.setRatio(ratio[clamp(interval, 0, 2)])
      this.lastInterval = interval
    }
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
  process(inL, inR) {
    if (++this.modCnt >= 1024) {
      this.modCnt = 0
      for (let i = 0; i < FDN; i++) { const m = 1 / Math.sqrt(this.modC[i] ** 2 + this.modS[i] ** 2); this.modC[i] *= m; this.modS[i] *= m }
    }
    let xl = inL, xr = inR
    for (let i = 0; i < 4; i++) { xl = AtmosVerb.allpass(this.apL[i], this.apIL, i, xl); xr = AtmosVerb.allpass(this.apR[i], this.apIR, i, xr) }
    const z = this.z, w = this.w
    for (let i = 0; i < FDN; i++) {
      const D = this.d[i] + this.modDepth * this.modS[i]
      const nc = this.modC[i] * this.modRc[i] - this.modS[i] * this.modRs[i]
      this.modS[i] = this.modS[i] * this.modRc[i] + this.modC[i] * this.modRs[i]
      this.modC[i] = nc
      const y = this.line[i].read(Math.max(2, D))
      this.lp[i] = (1 - this.pLp) * y + this.pLp * this.lp[i]
      z[i] = this.ghf[i] * y + this.dg[i] * this.lp[i]
    }
    let oL = 0, oR = 0
    for (let i = 0; i < FDN; i++) { oL += ROW_L[i] * z[i]; oR += ROW_R[i] * z[i] }
    this.outL = oL * INV_S8 * this.wetNorm
    this.outR = oR * INV_S8 * this.wetNorm
    for (let i = 0; i < FDN; i++) w[i] = z[i]
    for (let h = 1; h < FDN; h <<= 1)
      for (let i = 0; i < FDN; i += 2 * h)
        for (let j = i; j < i + h; j++) { const a = w[j], b = w[j + h]; w[j] = a + b; w[j + h] = a - b }
    for (let i = 0; i < FDN; i++) w[i] *= INV_S8
    if (this.shimAmt > 1e-4) {
      const nps = this.shimAmt > 0.5 ? NPS : 2   // shimmer moderado: 2 pitch shifters (la rotación se reparte en pares 0->4, 1->5)
      for (let k = 0; k < nps; k++) {
        const s = w[k]
        const r = this.ps[k].process(s)
        w[k] = this.cs * s
        w[k + 4] += this.sn * r
      }
    }
    for (let i = 0; i < FDN; i++) { w[i] += (IN_L[i] * xl + IN_R[i] * xr) * INV_S8; this.line[i].push(w[i]) }
  }
}

class Ensemble {
  constructor(sr) {
    this.sr = sr
    this.bl = new DelayBuf(Math.floor(0.06 * sr)); this.br = new DelayBuf(Math.floor(0.06 * sr))
    const rate = [0.17, 0.23, 0.31]
    this.inc = rate.map((r) => (TAU * r) / sr)
    this.phL = [0, TAU / 3, (2 * TAU) / 3]
    this.phR = [0, 1, 2].map((k) => TAU * (k / 3 + 1 / 6))
    this.oL = 0; this.oR = 0
  }
  reset() { this.bl.clear(); this.br.clear() }
  process(inL, inR, mix) {
    this.bl.push(inL); this.br.push(inR)
    let wl = 0, wr = 0
    for (let k = 0; k < 3; k++) {
      wl += this.bl.read((0.0135 + 0.0013 * k + 0.0035 * Math.sin(this.phL[k])) * this.sr)
      wr += this.br.read((0.0135 + 0.0013 * k + 0.0035 * Math.sin(this.phR[k])) * this.sr)
      this.phL[k] += this.inc[k]; if (this.phL[k] > TAU) this.phL[k] -= TAU
      this.phR[k] += this.inc[k] * 1.07; if (this.phR[k] > TAU) this.phR[k] -= TAU
    }
    this.oL = inL * (1 - 0.5 * mix) + (wl / 3) * 0.8 * mix
    this.oR = inR * (1 - 0.5 * mix) + (wr / 3) * 0.8 * mix
  }
}

// Tape delay ping-pong (TapeDelay del VST3)
class TapeDelay {
  constructor(sr) {
    this.sr = sr
    this.bl = new DelayBuf(Math.floor(1.55 * sr) + 64); this.br = new DelayBuf(Math.floor(1.55 * sr) + 64)
    this.hpA = 1 - Math.exp((-TAU * 130) / sr)
    this.tK = 1 - Math.exp(-1 / (0.25 * sr))
    this.wowInc = (TAU * 0.55) / sr; this.flInc = (TAU * 6.3) / sr
    this.setTone(3600)
    this.oL = 0; this.oR = 0
    this.reset()
  }
  reset() { this.bl.clear(); this.br.clear(); this.lpL = this.lpR = this.hpL = this.hpR = 0; this.wow = 0; this.fl = 1.3; this.tCur = -1 }
  setTone(hz) { this.lpA = 1 - Math.exp((-TAU * clamp(hz, 500, 0.4 * this.sr)) / this.sr) }
  process(inL, inR, timeMs, fb, age) {
    const tT = (clamp(timeMs, 20, 1400) * 0.001) * this.sr
    if (this.tCur < 0) this.tCur = tT
    this.tCur += this.tK * (tT - this.tCur)
    this.wow += this.wowInc; if (this.wow > TAU) this.wow -= TAU
    this.fl += this.flInc; if (this.fl > TAU) this.fl -= TAU
    const mod = (0.0008 * Math.sin(this.wow) + 0.00018 * Math.sin(this.fl)) * this.sr * age
    const d = clamp(this.tCur + mod, 8, 1.5 * this.sr)
    this.oL = this.bl.read(d); this.oR = this.br.read(d)
    this.lpL += this.lpA * (this.oL - this.lpL); this.hpL += this.hpA * (this.lpL - this.hpL)
    let y = this.lpL - this.hpL
    const fL = y / (1 + Math.abs(y) * 0.5)
    this.lpR += this.lpA * (this.oR - this.lpR); this.hpR += this.hpA * (this.lpR - this.hpR)
    y = this.lpR - this.hpR
    const fR = y / (1 + Math.abs(y) * 0.5)
    this.bl.push(0.5 * (inL + inR) + fb * fR)
    this.br.push(fL)
  }
  currentMs() { return this.tCur > 0 ? (this.tCur * 1000) / this.sr : 0 }
}

class SoftComp {
  constructor(sr) { this.aA = 1 - Math.exp(-1 / (0.03 * sr)); this.aR = 1 - Math.exp(-1 / (0.45 * sr)); this.env = 0; this.grDb = 0 }
  reset() { this.env = 0; this.grDb = 0 }
  // devuelve la ganancia a aplicar a ambos canales
  gain(l, r, amount) {
    if (amount < 1e-4) { this.env = 0; this.grDb = 0; return 1 }
    const a = Math.max(Math.abs(l), Math.abs(r))
    this.env += (a > this.env ? this.aA : this.aR) * (a - this.env)
    const lev = 20 * Math.log10(this.env + 1e-9)
    const ratio = 1 + 2 * amount, over = lev + 22, knee = 8
    let red
    if (over <= -0.5 * knee) red = 0
    else if (over >= 0.5 * knee) red = over * (1 - 1 / ratio)
    else { const x = over + 0.5 * knee; red = ((1 - 1 / ratio) * x * x) / (2 * knee) }
    this.grDb = red
    return Math.pow(10, (2.5 * amount - red) * 0.05)
  }
}

// ---------------------------------------------------------------- tabla de seno
const SINE = new Float32Array(4097)
for (let i = 0; i < 4096; i++) SINE[i] = Math.sin((TAU * i) / 4096)
SINE[4096] = SINE[0]
// tabla grande para los parciales (lectura sin interpolación: error < -95 dB)
const SINE_N = 16384
const SINE_BIG = new Float32Array(SINE_N)
for (let i = 0; i < SINE_N; i++) SINE_BIG[i] = Math.sin((TAU * i) / SINE_N)

// ---------------------------------------------------------------- capas (identidad tímbrica del generador)
// clave de capa: guitarra 0..3, pads 10..14, texturas 20..25, sound design 26..29
const layerKey = (fam, capa) => (fam === 0 ? capa : fam === 1 ? 10 + capa : fam === 2 ? 20 + capa : 20 + capa)
// componentes: r = razón de frecuencia, g = ganancia, c = cents, np = nº de parciales, ex = exponente de caída
const LAYERS = {
  0: { comps: [{ r: 1, g: 1, c: 0, np: 8, ex: 1.15 }] },
  1: { comps: [{ r: 1, g: 1, c: 0, np: 8, ex: 1.15 }, { r: 2, g: 0.38, c: 0, np: 5, ex: 1.15 }] },
  2: { comps: [{ r: 1, g: 1, c: 0, np: 7, ex: 1.15 }, { r: 1.5, g: 0.26, c: 0, np: 5, ex: 1.15 }, { r: 2, g: 0.24, c: 0, np: 5, ex: 1.15 }] },
  3: { comps: [{ r: 1, g: 1, c: 0, np: 7, ex: 1.3 }, { r: 1.5, g: 0.7, c: 0, np: 5, ex: 1.3 }, { r: 2, g: 0.5, c: 0, np: 4, ex: 1.3 }], sat: 4 },
  10: { comps: [{ r: 1, g: 1, c: 0, np: 14, ex: 1.3 }], mod: 'formant' },
  11: { comps: [{ r: 1, g: 1, c: 0, np: 12, ex: 1.7 }], mod: 'breathe' },
  12: { comps: [{ r: 1, g: 1, c: 0, np: 14, ex: 1.0 }], mod: 'sweep' },
  13: { comps: [{ r: 1, g: 1, c: 0, np: 12, ex: 1.1 }], mod: 'bow' },
  14: { comps: [{ r: 1, g: 1, c: -7, np: 10, ex: 1.4 }, { r: 1, g: 0.8, c: 8, np: 10, ex: 1.4 }, { r: 1, g: 0.6, c: 0, np: 10, ex: 1.4 }], vib: 6 },
  20: { comps: [{ r: 1, g: 0.2, c: 0, np: 6, ex: 1.0 }], noise: 0, nz: 1.0 },
  21: { comps: [{ r: 1, g: 0.2, c: 0, np: 6, ex: 1.0 }], noise: 1, nz: 1.0 },
  22: { comps: [{ r: 1, g: 0.8, c: 0, np: 5, ex: 2 }, { r: 0.5, g: 0.6, c: 0, np: 4, ex: 2 }], noise: 2, nz: 1.0 },
  23: { comps: [{ r: 1, g: 1, c: 0, np: 10, ex: 1.2 }, { r: 0.5, g: 0.5, c: 0, np: 5, ex: 1.2 }, { r: 1, g: 0.6, c: 6, np: 8, ex: 1.2 }] },
  24: { comps: [], noise: 3, nz: 1.0 },
  25: { comps: [{ r: 1, g: 1, c: 0, np: 16, ex: 0.9 }, { r: 1, g: 0.7, c: 3, np: 14, ex: 0.9 }], mod: 'cloud' },
  26: { comps: [], noise: 4, nz: 1.0, tone: 1, oneShot: 8 },
  27: { comps: [], noise: 5, nz: 1.0, tone: 1, oneShot: 8 },
  28: { comps: [{ r: 2, g: 1, c: 0, np: 16, ex: 0.6 }, { r: 2, g: 0.7, c: 4, np: 14, ex: 0.6 }, { r: 3, g: 0.4, c: 0, np: 8, ex: 0.8 }], mod: 'cloud' },
  29: { comps: [{ r: 1, g: 1, c: 0, np: 8, ex: 1.15 }], rev: true, oneShot: 8 },
}
// nivel de cada capa (iguala el RMS de las capas, medido en el test)
const LEVEL = { 0: 1, 1: 1, 2: 1, 3: 0.8, 10: 1, 11: 1, 12: 0.8, 13: 1, 14: 1, 20: 1.6, 21: 1.4, 22: 1.2, 23: 1, 24: 1.5, 25: 1, 26: 2.4, 27: 2.4, 28: 0.9, 29: 1 }
const TARGET_RMS = 0.12

class Group {
  constructor() {
    this.active = false; this.isSample = false
    this.ph = new Float64Array(MAX_PART); this.amp = new Float64Array(MAX_PART); this.base = new Float64Array(MAX_PART)
    this.rate = new Float64Array(MAX_PART); this.apx = new Float64Array(MAX_PART)
    this.r = 1; this.g = 1; this.cents = 0; this.np = 0; this.ex = 1; this.pl = 0.7; this.pr = 0.7; this.inc = 0
    this.zone = null; this.pos = 0; this.ratio = 1
  }
}
class Voice {
  constructor() {
    this.active = false; this.groups = []
    for (let i = 0; i < MAX_GROUPS; i++) this.groups.push(new Group())
    this.ng = 0
    this.nzSt = new Float64Array(24)   // estados SVF del ruido
    this.age = 0; this.keyDown = false; this.releasing = false; this.note = 0; this.env = 0; this.vt = 0
    this.nzLfo = 0
  }
}

// ---------------------------------------------------------------- Motor
class Motor {
  constructor(sampleRate) {
    const sr = (this.sr = sampleRate > 0 ? sampleRate : 48000)
    this.p = new Float64Array(NP)
    this.cur = new Float64Array(NP); this.tgt = new Float64Array(NP); this.coef = new Float64Array(NP)
    this.preset = 0
    this.bpm = 120
    this.fx = new FxRack(this.sr)   // rack de mezcla común (EQ, compresor, saturación, chorus, delay, reverb, anchura): apagado por defecto
    this.voices = []
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice())
    this.queue = []
    this.rngS = 0x9e3779b9
    this.banks = {}
    this.pedal = false
    this.clock = 0
    this.verb = new AtmosVerb(sr); this.chorus = new Ensemble(sr); this.delay = new TapeDelay(sr); this.comp = new SoftComp(sr)
    this.preL = new DelayBuf(Math.floor(0.16 * sr)); this.preR = new DelayBuf(Math.floor(0.16 * sr))
    this.sendHp = new HighPass2(); this.sendHp.design(sr, 170)
    this.lowHp = new HighPass2()
    this.lp = new SvfLp()
    this.eq = [new Biquad(), new Biquad(), new Biquad(), new Biquad()]
    this.eqLast = [1e9, 1e9, 1e9, 1e9]; this.eqActive = false
    this.lowCutLast = -1
    this.mixL = new Float64Array(CHUNK); this.mixR = new Float64Array(CHUNK)
    this.tmpL = new Float64Array(CHUNK); this.tmpR = new Float64Array(CHUNK)
    this.hpDcA = 1 - Math.exp((-TAU * 6) / sr); this.dcDriveA = 1 - Math.exp((-TAU * 18) / sr)
    this.dcOut = [0, 0]; this.dcDr = [0, 0]
    this.lfoPh = 0; this.cutNow = 8000
    this.delayWet = false; this.revWet = false
    this.silent = true; this.quiet = 0; this.quietMax = Math.ceil((3 * sr) / CHUNK)   // 3 s de silencio antes de dormir (el delay retiene hasta 1,5 s sin sacar nada)
    this.sustainHeld = new Uint8Array(MAX_VOICES)
    for (let i = 0; i < NP; i++) {
      const ms = [6, 7, 8, 9, 10, 11, 30].includes(i) ? 90 : i === 23 || i === 24 || i === 26 ? 200 : i === 20 ? 120 : i === 5 ? 30 : i === 39 || i === 40 ? 30 : [3, 16, 22, 28, 13, 14].includes(i) ? 120 : 80
      this.coef[i] = 1 - Math.exp(-CHUNK / ((ms * 0.001) * sr))
    }
    for (const i of [30, 31, 32, 33]) this.coef[i] = 1 - Math.exp(-CHUNK / (0.09 * sr))
    this.applyPresetValues(0)
    this.p[0] = 0
    this.settle()
  }

  // ---- parámetros ----
  applyPresetValues(idx) {
    const pr = PRESETS[idx]
    for (let i = 0; i < NP; i++) if (!NO_PRESET.includes(i)) this.p[i] = pr.p[i]
  }
  setParam(id, v) {
    if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { if (Number.isFinite(v)) this.fx.setParam(id, v); return }   // FX Rack: el preset NO lo toca
    if (!(id >= 0 && id < NP) || !Number.isFinite(v)) return
    const [mn, mx, map] = SPEC[id]
    v = clamp(map === 2 ? Math.round(v) : v, mn, mx)
    if (id === 0) { this.preset = v; this.p[0] = v; this.applyPresetValues(v) }
    else this.p[id] = v
    if (id === 37) this.setPedal(v >= 0.5)
    this.applyTargets(false)
  }
  /** Salta los suavizados al valor actual (pruebas). */
  settle() { this.applyTargets(true) }
  applyTargets(jump) {
    const p = this.p
    for (let i = 0; i < NP; i++) {
      let t = p[i]
      switch (i) {
        case 6: t = Math.log2(clamp(t, 200, 20000)); break
        case 10: t = Math.log2(clamp(t, 20, 400)); break
        case 23: t = Math.log(clamp(t, 0.5, 30)); break
        case 20: t = Math.log2(clamp(t, 800, 9000)); break
        case 8: t = Math.log2(clamp(t, 0.02, 8)); break
        case 36: t = t >= 0.5 ? 0 : 1; break
        case 39: case 40: t = clamp(t / 100, 0, 1); break
      }
      this.tgt[i] = t
      if (jump) this.cur[i] = t
    }
    if (jump) { this.eqLast = [1e9, 1e9, 1e9, 1e9]; this.lowCutLast = -1 }
  }
  pitchBend(st) { this.p[38] = clamp(st, -2, 2); this.tgt[38] = this.p[38] }
  cc(num, val) {
    const v = val > 1 ? val / 127 : val
    if (num === 64) { this.p[37] = v >= 0.5 ? 1 : 0; this.setPedal(v >= 0.5) }
    else if (num === 1) { this.p[39] = v * 100; this.tgt[39] = v }
    else if (num === 128) { this.p[40] = v * 100; this.tgt[40] = v }
    else if (num === 120) this.panic()
    else if (num === 123) this.allNotesOff()
    else if (num === 130) this.setParam(0, Math.round(v * (PRESETS.length - 1)))
  }
  setTempo(bpm) { this.bpm = bpm >= 20 && bpm <= 400 ? bpm : 120; this.fx.setTempo(bpm) }
  setBank(nombre, zonas) { this.banks[nombre || 'any'] = zonas }

  // ---- notas ----
  rnd() { let s = this.rngS; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.rngS = s | 0; return (s >>> 0) / 4294967296 }
  bankZone(fam, note, capa) {
    const name = fam === 0 ? 'guitar' : fam === 1 ? 'pads' : 'textures'
    for (const key of [name, 'any']) {
      const zs = this.banks[key]
      if (!zs) continue
      for (const z of zs) if (note >= z.lokey && note <= z.hikey && z.capa === capa) return z
    }
    return null
  }
  noteOn(note, vel) {
    if (!(note >= 0 && note <= 127)) return
    if (vel > 1) vel /= 127
    if (!(vel > 0)) { this.noteOff(note); return }
    const pr = PRESETS[this.preset], p = this.p
    let v = null
    for (const x of this.voices) if (!x.active) { v = x; break }
    if (!v) { v = this.voices[0]; for (const x of this.voices) if (x.age < v.age) v = x }
    v.active = true; v.keyDown = true; v.releasing = false; v.note = note; v.vel = vel; v.age = ++this.clock
    v.env = 0; v.vt = 0; v.tick = 0; v.f0 = 440 * Math.pow(2, (note - 69) / 12)
    v.velAmp = 0.55 + 0.45 * vel
    v.fam = pr.familia
    v.nzSt.fill(0); v.nzPh = this.rnd() * TAU; v.vibPh = this.rnd() * TAU; v.tonePh = 0
    this.sustainHeld[this.voices.indexOf(v)] = 0
    let used = 0
    for (const x of this.voices) if (x.active) used++
    let nV = clamp(Math.round(p[12]), 0, 2) + 1
    if (used > 6) nV = 1; else if (used > 4) nV = Math.min(nV, 2)
    const spread = (p[11] / 100) * 16
    const hasB = pr.capaB >= 0 && p[15] > 0.5
    const b = clamp(p[15] / 100, 0, 1)
    const gA = hasB ? Math.cos(b * Math.PI * 0.5) : 1, gB = hasB ? Math.sin(b * Math.PI * 0.5) : 0
    // presupuesto de osciladores por voz (CPU): menos parciales cuando suenan muchas voces
    let est = 0
    for (const capa of hasB ? [pr.capaA, pr.capaB] : [pr.capaA]) {
      const Lx = LAYERS[layerKey(pr.familia, capa)]
      if (Lx && !this.bankZone(pr.familia, note, capa)) for (const cm of Lx.comps) est += cm.np * nV
    }
    const budget = used <= 2 ? 44 : used <= 4 ? 26 : 14
    const npScale = est > budget ? budget / est : 1
    v.ng = 0; v.noiseA = null; v.sat = 0; v.rev = false; v.oneShot = 0; v.mods = []
    const addLayer = (capa, gain) => {
      const key = layerKey(pr.familia, capa)
      const L = LAYERS[key]
      if (!L) return
      if (L.sat) v.sat = L.sat
      if (L.rev) v.rev = true
      if (L.oneShot) v.oneShot = L.oneShot
      if (L.noise !== undefined && !v.noiseA) v.noiseA = { kind: L.noise, g: gain * L.nz * (LEVEL[key] || 1) }   // una capa de ruido por voz
      const zone = this.bankZone(pr.familia, note, capa)
      const comps = zone ? [{ r: 1, g: 1, c: 0, np: 0, ex: 1 }] : L.comps
      let tot = 0
      const fresh = []
      for (let k = 0; k < nV; k++) {
        const off = nV === 1 ? 0 : nV === 2 ? (k - 0.5) * 2 * spread : [0, -1, 1][k] * spread
        for (const cm of comps) {
          if (v.ng >= MAX_GROUPS) break
          const g = v.groups[v.ng++]
          g.active = true; g.isSample = !!zone
          g.r = cm.r; g.cents = cm.c + off
          g.g = cm.g * gain / Math.sqrt(nV) * (LEVEL[key] || 1)
          g.mod = L.mod || null; g.vib = L.vib || 0; g.np = cm.np > 0 ? Math.max(3, Math.round(cm.np * npScale)) : 0; g.ex = cm.ex
          const pan = clamp((k - (nV - 1) / 2) * 0.6 + (this.rnd() - 0.5) * 0.2, -1, 1)
          g.pl = Math.cos((pan + 1) * Math.PI * 0.25) * 1.2; g.pr = Math.sin((pan + 1) * Math.PI * 0.25) * 1.2
          if (zone) {
            g.zone = zone; g.ratio = Math.pow(2, (note - zone.root) / 12) * (zone.sr / this.sr)
            const loop = zone.bucleFin > zone.bucleIni
            g.pos = loop ? zone.bucleIni + this.rnd() * 0.6 * (zone.bucleFin - zone.bucleIni) : 0
            g.g *= 2
          } else {
            let e2 = 0
            for (let q = 0; q < g.np; q++) {
              g.base[q] = Math.pow(q + 1, -g.ex); e2 += g.base[q] * g.base[q] * 0.5
              g.ph[q] = this.rnd(); g.rate[q] = 0.05 + 0.25 * this.rnd(); g.apx[q] = this.rnd() * TAU
            }
            tot += g.g * g.g * e2
            fresh.push(g)
          }
        }
      }
      // normaliza el RMS conjunto de los componentes aditivos de esta capa
      if (fresh.length && tot > 0) { const nrm = TARGET_RMS / Math.sqrt(tot); for (const g of fresh) g.g *= nrm * v.velAmp }
    }
    addLayer(pr.capaA, gA)
    if (hasB) addLayer(pr.capaB, gB)
    v.ng = Math.min(v.ng, MAX_GROUPS)
    this.silent = false
  }
  noteOff(note) {
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = this.voices[i]
      if (v.active && v.note === note && v.keyDown) {
        v.keyDown = false
        if (this.pedal) this.sustainHeld[i] = 1; else v.releasing = true
      }
    }
  }
  setPedal(down) {
    if (down === this.pedal) return
    this.pedal = down
    if (!down) for (let i = 0; i < MAX_VOICES; i++) if (this.voices[i].active && !this.voices[i].keyDown) { this.voices[i].releasing = true; this.sustainHeld[i] = 0 }
  }
  allNotesOff() { for (const v of this.voices) if (v.active) { v.keyDown = false; v.releasing = true } }
  panic() {
    for (const v of this.voices) v.active = false
    this.queue.length = 0
    this.resetFx()
    this.fx.reset()
    this.silent = true
  }
  resetFx() {
    this.sendHp.reset(); this.lowHp.reset(); this.lp.reset(); this.verb.reset(); this.chorus.reset(); this.delay.reset(); this.comp.reset()
    this.preL.clear(); this.preR.clear(); this.dcOut[0] = this.dcOut[1] = 0; this.dcDr[0] = this.dcDr[1] = 0
    for (const e of this.eq) e.reset()
  }
  activeVoices() { let n = 0; for (const v of this.voices) if (v.active) n++; return n }

  // ---- generación de voces (segmento de n <= CHUNK muestras) ----
  renderVoice(v, idx, n) {
    const p = this.p
    const sr = this.sr
    const tuneF = Math.pow(2, (this.cur[4] / 100 + this.cur[38]) / 12)
    const tL = this.tmpL, tR = this.tmpR
    const dt = n / sr
    // envolvente A/R exponencial (por muestra)
    const a = Math.max(0.002, p[1]), r = Math.max(0.2, p[2])
    const atkK = 1 - Math.exp(-3.5 / (a * sr)), relK = 1 - Math.exp(-6.9078 / (r * sr))
    tL.fill(0, 0, n); tR.fill(0, 0, n)
    const vib = Math.sin(v.vibPh)
    v.vibPh += TAU * 5.2 * dt
    for (let gi = 0; gi < v.ng; gi++) {
      const g = v.groups[gi]
      if (!g.active) continue
      const cents = g.cents + (g.vib ? g.vib * vib * Math.min(1, v.vt / 0.6) : 0)
      const finc = (v.f0 * tuneF * g.r * Math.pow(2, cents / 1200)) / sr
      if (g.isSample) {
        const z = g.zone, d = z.datos, ch = z.canales === 2 ? 2 : 1
        const scl = d instanceof Int16Array ? 1 / 32768 : 1
        const ratio = g.ratio * (finc * sr) / (v.f0 * g.r) // incluye afinación/unísono
        const loop = z.bucleFin > z.bucleIni
        const last = d.length / ch - 1
        const L = loop ? z.bucleFin - z.bucleIni : 0
        const at = (i, c) => { if (loop && i >= z.bucleFin) i -= L; i = i < 0 ? 0 : i > last ? last : i; return d[i * ch + c] * scl }
        for (let i = 0; i < n; i++) {
          const i0 = g.pos | 0, t = g.pos - i0
          let l, rr
          for (let c = 0; c < ch; c++) {
            const y0 = at(i0 - 1, c), y1 = at(i0, c), y2 = at(i0 + 1, c), y3 = at(i0 + 2, c)
            const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)
            const o = ((c3 * t + c2) * t + c1) * t + y1
            if (c === 0) l = o; else rr = o
          }
          if (ch === 1) rr = l
          tL[i] += l * g.g; tR[i] += rr * g.g
          g.pos += ratio
          if (loop && g.pos >= z.bucleFin) g.pos -= L
          else if (!loop && g.pos >= last) { g.active = false; break }
        }
        continue
      }
      // parciales aditivos: la ganancia de cada parcial se actualiza cada 4 segmentos (128 muestras; son modulaciones < 0,5 Hz)
      if ((v.tick & 3) === 0) for (let q = 0; q < g.np; q++) {
        const fk = v.f0 * tuneF * g.r * (q + 1)
        if (fk > 0.45 * sr) { g.amp[q] = 0; continue }
        let m = 1
        const t = v.vt
        switch (g.mod) {
          case 'formant': {
            const mm = 0.5 + 0.5 * Math.sin(TAU * 0.09 * t)
            const f1 = 420 + 300 * mm, f2 = 800 + 450 * mm
            m = (0.25 + gaussLog(fk, f1, 0.28) + 0.8 * gaussLog(fk, f2, 0.3) + 0.35 * gaussLog(fk, 2600, 0.3)) / 1.4
            break
          }
          case 'breathe': { const s = Math.sin(TAU * 0.08 * t + 0.5); m = Math.pow(0.55 + 0.45 * s * s, clamp(Math.log2(Math.max(fk, 100) / 800), 0, 4)); break }
          case 'sweep': {
            const fc = Math.pow(2, Math.log2(350) + (Math.log2(3200) - Math.log2(350)) * (0.5 + 0.5 * Math.sin(TAU * 0.08 * t)))
            m = 0.35 + 2 * gaussLog(fk, fc, 0.45) + 0.4 * gaussLog(fk, 2 * fc, 0.5)
            break
          }
          case 'bow': m = 0.8 + 0.2 * Math.sin(TAU * 0.4 * t + fk * 0.0008); break
          default: break
        }
        // movimiento lento de cada parcial (AM)
        const am = 1 + (g.mod === 'cloud' ? 0.45 : 0.22) * Math.sin(TAU * g.rate[q] * t + g.apx[q])
        g.amp[q] = g.base[q] * g.g * m * am
      }
      const sat = v.sat
      for (let q = 0; q < g.np; q++) {
        const amp = g.amp[q]
        if (amp < 1e-7) { g.ph[q] += finc * (q + 1) * n; g.ph[q] -= Math.floor(g.ph[q]); continue }
        let ph = g.ph[q]
        const inc = finc * (q + 1), al = amp * g.pl, ar = amp * g.pr
        for (let i = 0; i < n; i++) {
          ph += inc; if (ph >= 1) ph -= 1
          const s = SINE_BIG[(ph * SINE_N) | 0]
          tL[i] += s * al; tR[i] += s * ar
        }
        g.ph[q] = ph
      }
    }
    if (v.sat) {
      const k = v.sat
      for (let i = 0; i < n; i++) { tL[i] = fastTanh(tL[i] * k * 3) / (k * 1.6); tR[i] = fastTanh(tR[i] * k * 3) / (k * 1.6) }
    }
    // ruido filtrado + tono de barrido de las texturas/sound design
    if (v.noiseA) this.renderNoise(v, v.noiseA, n, tuneF)
    // envolvente y suma
    const mL = this.mixL, mR = this.mixR
    let env = v.env
    for (let i = 0; i < n; i++) {
      if (v.releasing) env -= env * relK
      else env += (1 - env) * atkK
      let e = env
      if (v.oneShot) {
        const t = v.vt + i / sr
        if (v.rev) e *= t < 4.4 ? Math.sqrt(t / 4.4) : Math.exp(-(t - 4.4) / 1.6)
        else if (t > v.oneShot - 0.06) e *= clamp((v.oneShot - t) / 0.06, 0, 1)
      }
      mL[i] += tL[i] * e; mR[i] += tR[i] * e
    }
    v.env = env
    v.vt += dt
    v.tick++
    if ((v.releasing && env < 1e-5) || (v.oneShot && v.vt > v.oneShot)) v.active = false
    else if (!v.releasing) {
      let any = false
      for (let gi = 0; gi < v.ng; gi++) if (v.groups[gi].active) { any = true; break }
      if (!any && !v.noiseA) v.active = false
    }
  }

  renderNoise(v, nz, n, tuneF) {
    const sr = this.sr, st = v.nzSt, tL = this.tmpL, tR = this.tmpR
    const kind = nz.kind, t = v.vt, gn = nz.g * v.velAmp * 0.12
    const svf = (o, x, fc, q) => { // TPT: devuelve [lp, bp, hp] en SV
      const g = Math.tan((Math.PI * clamp(fc, 20, 0.45 * sr)) / sr), k = 1 / q
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
      const v3 = x - st[o + 1], v1 = a1 * st[o] + a2 * v3, v2 = st[o + 1] + a2 * st[o] + a3 * v3
      st[o] = 2 * v1 - st[o]; st[o + 1] = 2 * v2 - st[o + 1]
      SV[0] = v2; SV[1] = v1; SV[2] = x - k * v1 - v2
    }
    const f0 = v.f0 * tuneF
    let tt = clamp(t / 8, 0, 1)
    if (kind === 5) tt = 1 - tt
    for (let i = 0; i < n; i++) {
      const w = this.rnd() * 2 - 1
      let y = 0, wl = 0, wr = 0
      const ph = TAU * (t + i / sr)
      if (kind === 0) {   // aire: banda alta + resonancias de los armónicos (soplo afinado)
        svf(0, w, 1500, 0.6); const hp = SV[2]
        svf(2, hp, 11000, 0.6); y = SV[0] * (0.65 + 0.35 * Math.sin(ph * 0.17 + v.nzPh)) * 0.9
        for (let q = 1; q <= 3; q++) { svf(4 + 2 * q, w, f0 * q, 25); y += SV[1] * (0.5 / q) }
      } else if (kind === 1) {   // viento: banda móvil
        const fc = 380 + 1120 * (0.5 + 0.5 * Math.sin(ph * 0.2 + v.nzPh))
        svf(0, w, fc, 1.2); y = SV[1] * 1.6
        for (let q = 1; q <= 2; q++) { svf(4 + 2 * q, w, f0 * q, 25); y += SV[1] * (0.3 / q) }
      } else if (kind === 2) {   // presión grave
        svf(0, w, 160, 0.7); y = SV[0] * 2.2 * (0.6 + 0.4 * Math.pow(Math.sin(ph * 0.33), 2))
      } else if (kind === 3) {   // olas
        const s = Math.pow(0.5 - 0.5 * Math.cos(ph * 0.167), 1.6)
        svf(0, w, 500 + 4500 * s, 0.7); y = SV[0] * 1.6 * (0.25 + 0.75 * s)
      } else {   // riser / downlifter
        const fc = 250 * Math.pow(38, Math.pow(tt, 1.7))
        svf(0, w, fc, 0.8); svf(2, SV[0], fc * 1.1, 2)
        y = SV[0] * 2.5 * (kind === 4 ? Math.pow(tt, 2.2) : Math.pow(tt, 1.8) )
        v.tonePh += (f0 * Math.pow(2, tt)) / sr; v.tonePh -= Math.floor(v.tonePh)
        const x = v.tonePh * 4096, k = x | 0
        y += (SINE[k] + (SINE[k + 1] - SINE[k]) * (x - k)) * 0.5 * (kind === 4 ? Math.pow(tt, 2.2) : Math.pow(tt, 1.8))
      }
      // decorrelación estéreo barata: el canal derecho usa una mezcla distinta de ruido filtrado previo
      wl = y * gn * 1.2; wr = (kind <= 3 ? (y * 0.55 + (st[22] * 0.45)) : y) * gn * 1.2
      st[22] += 0.2 * (y - st[22])
      tL[i] += wl; tR[i] += wr
    }
  }

  // ---- control (cada CHUNK muestras) ----
  controlTick(n) {
    const cur = this.cur, tgt = this.tgt, coef = this.coef
    for (let i = 0; i < NP; i++) cur[i] += (tgt[i] - cur[i]) * coef[i]
    const mw = cur[39], at = cur[40]
    const d = clamp((cur[3] / 100) * 2 + 0.5 * mw + 0.3 * at, 0, 2.3)
    const sr = this.sr
    this.lfoPh += ((TAU / sr) * Math.pow(2, cur[8])) * n
    if (this.lfoPh > TAU) this.lfoPh -= TAU
    const depth = (cur[9] / 100) * 1.6 * (0.6 + 0.4 * d)
    const cutBase = cur[6] + 1.5 * mw
    this.cutNow = Math.pow(2, cutBase)
    const q = 0.6 + (cur[7] / 100) * 4.5, kq = 1 / q
    this.lp.set(0, Math.pow(2, clamp(cutBase + depth * Math.sin(this.lfoPh), 7, 14.28)), sr, kq)
    this.lp.set(1, Math.pow(2, clamp(cutBase + depth * Math.cos(this.lfoPh), 7, 14.28)), sr, kq)
    const lc = cur[10]
    if (Math.abs(lc - this.lowCutLast) > 0.002) { this.lowCutLast = lc; this.lowHp.design(sr, Math.pow(2, lc)) }
    const eqv = [cur[30], cur[31], cur[32], cur[33]]
    let chg = false
    for (let i = 0; i < 4; i++) if (Math.abs(eqv[i] - this.eqLast[i]) > 0.005) chg = true
    if (chg) {
      this.eq[0].design('ls', sr, 120, eqv[0], 0.7); this.eq[1].design('bell', sr, 400, eqv[1], 0.8)
      this.eq[2].design('bell', sr, 3000, eqv[2], 0.8); this.eq[3].design('hs', sr, 9000, eqv[3], 0.7)
      for (let i = 0; i < 4; i++) this.eqLast[i] = eqv[i]
      this.eqActive = eqv.some((x) => Math.abs(x) > 0.01)
    }
    const sync = clamp(Math.round(this.p[17]), 0, 5)
    let ms = cur[18]
    if (sync > 0) { ms = (SYNC_BEATS[sync] * 60000) / this.bpm; while (ms > 1400) ms *= 0.5; while (ms < 40) ms *= 2 }
    this.delayMs = ms
    this.delay.setTone(Math.pow(2, cur[20]))
    this.delayFb = clamp(cur[19] / 100 + 0.12 * (d - 1), 0, 0.92)
    this.delayMix = clamp((cur[16] / 100) * d, 0, 0.95)
    this.tapeAge = clamp((cur[21] / 100) * d, 0, 1.6)
    const type = clamp(cur[26], 0, 1)
    const rt = Math.exp(cur[23]) * (0.85 + 0.15 * d)
    const shim = clamp((cur[28] / 100) * d * (1 + 0.4 * at), 0, 1)
    this.verb.setParams(0.72 + 0.28 * type, rt, cur[24] / 100, clamp((cur[25] / 100) * d, 0, 1), shim, Math.round(cur[29]))
    this.revMix = clamp((cur[22] / 100) * Math.pow(d, 0.85), 0, 1)
    this.preMs = cur[27] * (0.8 + 0.2 * type)
    this.chorusAmt = clamp((cur[13] / 100) * d, 0, 1)
    this.drive = cur[14] / 100
    this.driveG = 1 + 5 * this.drive
    this.compAmt = cur[34] / 100
    this.width = cur[35] / 100
    this.outGain = Math.pow(10, cur[5] * 0.05) * cur[36]
  }

  processFrame(l, r) {
    if (this.drive > 1e-3) {
      const g = this.driveG, dr = this.drive
      let xg = l * g; let y = fastTanh(xg + 0.12 * dr * xg * xg) / g
      this.dcDr[0] += this.dcDriveA * (y - this.dcDr[0]); l = y - this.dcDr[0]
      xg = r * g; y = fastTanh(xg + 0.12 * dr * xg * xg) / g
      this.dcDr[1] += this.dcDriveA * (y - this.dcDr[1]); r = y - this.dcDr[1]
    }
    l = this.lowHp.process(0, l); r = this.lowHp.process(1, r)
    l = this.lp.process(0, l); r = this.lp.process(1, r)
    if (this.eqActive) for (let b = 0; b < 4; b++) { l = this.eq[b].process(0, l); r = this.eq[b].process(1, r) }
    if (this.chorusAmt > 1e-3) { this.chorus.process(l, r, this.chorusAmt); l = this.chorus.oL; r = this.chorus.oR }
    let dl = 0, dr2 = 0
    if (this.delayMix > 1e-3 || this.delayWet) {
      this.delay.process(l, r, this.delayMs, this.delayFb, this.tapeAge)
      dl = this.delay.oL; dr2 = this.delay.oR
      this.delayWet = this.delayMix > 1e-3 || Math.abs(dl) + Math.abs(dr2) > 1e-7
      dl *= this.delayMix * 0.9; dr2 *= this.delayMix * 0.9
    }
    let xl = l + dl, xr = r + dr2
    if (this.revMix > 1e-3 || this.revWet) {
      let sl = this.sendHp.process(0, xl), sr2 = this.sendHp.process(1, xr)
      this.preL.push(sl); this.preR.push(sr2)
      const pd = Math.max(1, this.preMs * 0.001 * this.sr)
      sl = this.preL.read(pd); sr2 = this.preR.read(pd)
      this.verb.process(sl, sr2)
      const vl = this.verb.outL, vr = this.verb.outR
      this.revWet = this.revMix > 1e-3 || Math.abs(vl) + Math.abs(vr) > 1e-7
      xl = xl * (1 - 0.3 * this.revMix) + vl * this.revMix * 0.85
      xr = xr * (1 - 0.3 * this.revMix) + vr * this.revMix * 0.85
    }
    const cg = this.comp.gain(xl, xr, this.compAmt)
    xl *= cg; xr *= cg
    const m = 0.5 * (xl + xr), s = 0.5 * (xl - xr) * this.width
    xl = (m + s) * this.outGain; xr = (m - s) * this.outGain
    this.dcOut[0] += this.hpDcA * (xl - this.dcOut[0]); xl -= this.dcOut[0]
    this.dcOut[1] += this.hpDcA * (xr - this.dcOut[1]); xr -= this.dcOut[1]
    if (!(Math.abs(xl) < 1e4 && Math.abs(xr) < 1e4)) { this.resetFx(); xl = xr = 0 }
    this.oL = softClip(xl); this.oR = softClip(xr)
  }

  /** Renderiza n muestras en outL/outR a partir de `offset` (sin asignaciones). */
  /** Cadena interna + FX Rack común al final (también procesa el silencio para que suenen las colas de delay/reverb). */
  render(outL, outR, n, offset = 0) {
    this.renderCore(outL, outR, n, offset)
    this.fx.process(outL, outR, n, offset)
  }
  renderCore(outL, outR, n, offset = 0) {
    let pos = 0
    while (pos < n) {
      const m = Math.min(CHUNK, n - pos)
      const any = this.activeVoices() > 0
      if (this.silent && !any) { outL.fill(0, offset + pos, offset + pos + m); outR.fill(0, offset + pos, offset + pos + m); pos += m; continue }
      this.controlTick(m)
      this.mixL.fill(0, 0, m); this.mixR.fill(0, 0, m)
      for (let i = 0; i < MAX_VOICES; i++) if (this.voices[i].active) this.renderVoice(this.voices[i], i, m)
      let acc = 0
      for (let i = 0; i < m; i++) {
        this.processFrame(this.mixL[i], this.mixR[i])
        outL[offset + pos + i] = this.oL; outR[offset + pos + i] = this.oR
        acc += this.oL * this.oL + this.oR * this.oR
      }
      if (!any && acc / m < 1e-14) {
        if (++this.quiet >= this.quietMax) { this.silent = true; this.quiet = 0; this.resetFx() }
      } else this.quiet = 0
      pos += m
    }
  }

  // ---- eventos programados al sample (cuando = segundos del AudioContext) ----
  enqueue(ev) {
    const q = this.queue
    let i = q.length
    while (i > 0 && q[i - 1].cuando > ev.cuando) i--
    q.splice(i, 0, ev)
  }
  applyEvent(e) {
    if (e.tipo === 'on') this.noteOn(e.nota, e.vel === undefined ? 0.7 : e.vel)
    else if (e.tipo === 'off') this.noteOff(e.nota)
  }
  /** Como render(), aplicando los eventos en cola con precisión de muestra; t0 = tiempo del primer sample. */
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
const SV = new Float64Array(3)

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('jaswave-ambient-atmos', class extends AudioWorkletProcessor {
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
        else if (m.tipo === 'banco') this.motor.setBank(m.banco, m.zonas)
      }
    }
    process(_inputs, outputs) {
      const out = outputs[0]
      if (!out || !out[0]) return true
      const L = out[0], R = out[1] || this.tmp
      const n = L.length
      if (R === this.tmp && this.tmp.length < n) this.tmp = new Float32Array(n)
      this.motor.renderAt(L, R === this.tmp ? this.tmp : R, n, currentTime)
      return true
    }
  })
}

if (typeof module !== 'undefined') module.exports = { Motor, PARAM, PRESETS, SPEC }
