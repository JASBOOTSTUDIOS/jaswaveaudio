/**
 * Página «MIX / FX» de la réplica web: ids estándar del FX Rack (plugins/shared-dsp/jw_fxrack.h) y la
 * respuesta en frecuencia del ecualizador de 6 bandas + filtros, calculada con las MISMAS ecuaciones que el VST
 * (biquad RBJ de BiquadCoefs::design y su magnitudeDb). En la web el DSP no corre: la curva se dibuja con estos
 * valores, igual que el editor nativo la dibuja con los parámetros.
 */

import type { WidgetLayout } from './tipos'
import { aPlano } from './valores'

export const BANDAS = 6

/** Offsets fijos respecto a la base del rack (FXR_BASE = 100); idénticos a `enum Off` de jw_fxrack.h. */
export const OFF = {
  HpfOn: 0, HpfFreq: 1, HpfSlope: 2, LpfOn: 3, LpfFreq: 4, LpfSlope: 5,
  EqOn: 16, EqBand0: 17,
  CompOn: 48, CompThresh: 49, CompRatio: 50, CompAttack: 51, CompRelease: 52, CompKnee: 53, CompMakeup: 54, CompMix: 55,
  SatOn: 64, SatType: 65, SatDrive: 66, SatTone: 67, SatMix: 68,
  ChOn: 80, ChDepth: 81, ChRate: 82, ChMix: 83,
  DlOn: 96, DlSync: 97, DlTime: 98, DlFeedback: 99, DlTone: 100, DlMix: 101, DlPingPong: 102,
  RvOn: 112, RvType: 113, RvSize: 114, RvDamping: 115, RvPreDelay: 116, RvMix: 117,
  OutOn: 128, OutWidth: 129, OutGain: 130,
} as const
/** El rack ocupa [base, base + RANGO). */
export const RANGO = 144

export type Rol = 'freq' | 'gain' | 'q'
const ROL_IDX: Record<Rol, number> = { freq: 0, gain: 1, q: 2 }
export const idBanda = (base: number, banda: number, rol: Rol) => base + OFF.EqBand0 + 3 * banda + ROL_IDX[rol]

export type BandaEq = { hz: number; gainDb: number; q: number }
export type ParamsEq = {
  hpfOn: boolean; hpfHz: number; hpfSlope: number
  lpfOn: boolean; lpfHz: number; lpfSlope: number
  eqOn: boolean
  bandas: BandaEq[]
}

type Coefs = { b0: number; b1: number; b2: number; a1: number; a2: number }
type Tipo = 'hp' | 'lp' | 'lowShelf' | 'highShelf' | 'bell'

/** Misma fórmula que JasWaveDsp::BiquadCoefs::design (RBJ, normalizado a a0 = 1). */
export function disenar(tipo: Tipo, sr: number, freq: number, gainDb: number, q: number): Coefs {
  const f = Math.min(Math.max(freq, 10), sr * 0.499)
  const Q = Math.min(Math.max(q, 0.05), 40)
  const w0 = (2 * Math.PI * f) / sr
  const cw = Math.cos(w0), sw = Math.sin(w0)
  const alpha = sw / (2 * Q)
  const A = Math.pow(10, gainDb / 40)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  switch (tipo) {
    case 'bell':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
      break
    case 'hp':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'lp':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'lowShelf': {
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * ((A + 1) - (A - 1) * cw + s2)
      b1 = 2 * A * ((A - 1) - (A + 1) * cw)
      b2 = A * ((A + 1) - (A - 1) * cw - s2)
      a0 = (A + 1) + (A - 1) * cw + s2
      a1 = -2 * ((A - 1) + (A + 1) * cw)
      a2 = (A + 1) + (A - 1) * cw - s2
      break
    }
    default: {
      const s2 = 2 * Math.sqrt(A) * alpha
      b0 = A * ((A + 1) + (A - 1) * cw + s2)
      b1 = -2 * A * ((A - 1) + (A + 1) * cw)
      b2 = A * ((A + 1) + (A - 1) * cw - s2)
      a0 = (A + 1) - (A - 1) * cw + s2
      a1 = 2 * ((A - 1) - (A + 1) * cw)
      a2 = (A + 1) - (A - 1) * cw - s2
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** |H(e^jw)| en dB (BiquadCoefs::magnitudeDb). */
export function magnitudDb(c: Coefs, f: number, sr: number): number {
  const w = (2 * Math.PI * f) / sr
  const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = c.b0 + c.b1 * cw + c.b2 * c2, ni = -(c.b1 * sw + c.b2 * s2)
  const dr = 1 + c.a1 * cw + c.a2 * c2, di = -(c.a1 * sw + c.a2 * s2)
  const den = dr * dr + di * di
  if (den <= 1e-30) return 0
  return 10 * Math.log10(Math.max((nr * nr + ni * ni) / den, 1e-30))
}

const tipoBanda = (b: number): Tipo => (b === 0 ? 'lowShelf' : b === BANDAS - 1 ? 'highShelf' : 'bell')
const butterworthQ = (orden: number, k: number) => 1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * orden)))

/** Respuesta (dB) a la frecuencia f: bandas del EQ (si `incluirEq`) y filtros paso-altos / paso-bajos activos (respuestaDb de jw_fxrack.h). */
export function respuestaDb(p: ParamsEq, sr: number, f: number, incluirEq = true): number {
  let db = 0
  if (incluirEq) {
    for (let b = 0; b < BANDAS; b++) {
      const e = p.bandas[b]!
      if (Math.abs(e.gainDb) > 1e-3) db += magnitudDb(disenar(tipoBanda(b), sr, e.hz, e.gainDb, e.q), f, sr)
    }
  }
  const filtro = (tipo: Tipo, hz: number, pendiente: number) => {
    if (pendiente) return magnitudDb(disenar(tipo, sr, hz, 0, butterworthQ(4, 0)), f, sr) + magnitudDb(disenar(tipo, sr, hz, 0, butterworthQ(4, 1)), f, sr)
    return magnitudDb(disenar(tipo, sr, hz, 0, Math.SQRT1_2), f, sr)
  }
  if (p.hpfOn) db += filtro('hp', p.hpfHz, p.hpfSlope)
  if (p.lpfOn) db += filtro('lp', p.lpfHz, p.lpfSlope)
  return db
}

/** Widget gráfico del ecualizador de la página MIX / FX (o undefined si el layout no tiene la página). */
export const widgetEq = (widgets: WidgetLayout[]) => widgets.find((w) => w.tipo === 'mixfx-eq')

/**
 * Widget con los parámetros de la banda seleccionada: las tres perillas FREQ / GAIN / Q del layout (`bandaRol`)
 * se reasignan a la banda activa con los rangos de esa banda. Cualquier otro widget se devuelve tal cual.
 */
export function resolverWidget(widgets: WidgetLayout[], w: WidgetLayout, banda: number): WidgetLayout {
  if (!w.bandaRol) return w
  const eq = widgetEq(widgets)
  const d = eq?.bandas?.[banda]?.[w.bandaRol]
  if (!d) return w
  return { ...w, param: d.param, min: d.min, max: d.max, defecto: d.defecto, escala: d.escala, decimales: d.decimales, bipolar: d.bipolar, unidad: d.unidad, nombre: d.nombre }
}

/** Lee los parámetros del EQ / filtros desde el layout (rangos) y el valor normalizado de cada parámetro. */
export function leerParamsEq(widgets: WidgetLayout[], valor: (param: number) => number): ParamsEq | null {
  const eq = widgetEq(widgets)
  if (!eq || eq.base === undefined || !eq.bandas) return null
  const base = eq.base
  const def = (id: number) => widgets.find((x) => x.param === id && x.min !== undefined)
  const plano = (id: number, d: { min: number; max: number; escala?: string; pasos?: number }, porDefecto: number) => {
    const n = valor(id)
    return Number.isFinite(n) ? aPlano({ min: d.min, max: d.max, defecto: porDefecto, escala: (d.escala ?? 'linear') as 'linear' | 'log' | 'stepped', pasos: d.pasos }, n) : porDefecto
  }
  const bandas: BandaEq[] = eq.bandas.map((b) => ({
    hz: plano(b.freq.param, b.freq, b.freq.defecto),
    gainDb: plano(b.gain.param, b.gain, b.gain.defecto),
    q: plano(b.q.param, b.q, b.q.defecto),
  }))
  const hf = def(base + OFF.HpfFreq), lf = def(base + OFF.LpfFreq)
  return {
    hpfOn: valor(base + OFF.HpfOn) >= 0.5,
    hpfHz: hf ? plano(base + OFF.HpfFreq, { min: hf.min!, max: hf.max!, escala: hf.escala }, hf.defecto!) : 80,
    hpfSlope: valor(base + OFF.HpfSlope) >= 0.5 ? 1 : 0,
    lpfOn: valor(base + OFF.LpfOn) >= 0.5,
    lpfHz: lf ? plano(base + OFF.LpfFreq, { min: lf.min!, max: lf.max!, escala: lf.escala }, lf.defecto!) : 16000,
    lpfSlope: valor(base + OFF.LpfSlope) >= 0.5 ? 1 : 0,
    eqOn: valor(base + OFF.EqOn) >= 0.5,
    bandas,
  }
}

/** Zonas de cada pestaña de la página en el modo móvil (< 640 px): EQ · DINÁMICA · EFECTOS. */
export const PESTANAS_FX = [
  { id: 'espectro' as const, titulo: 'EQ', zona: [52, 92, 652, 404] as [number, number, number, number] },
  { id: 'controles' as const, titulo: 'DINÁMICA', zona: [666, 92, 1048, 404] as [number, number, number, number] },
  { id: 'medicion' as const, titulo: 'EFECTOS', zona: [52, 418, 1048, 556] as [number, number, number, number] },
]
