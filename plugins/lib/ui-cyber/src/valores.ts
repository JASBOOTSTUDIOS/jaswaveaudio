/**
 * Mapeo normalizado ↔ plano y texto de los valores, idénticos a plugins/shared-dsp/jw_params.h
 * (toPlain, toNorm, formatValue): la réplica muestra exactamente lo mismo que el VST.
 */

import type { DefParametro, WidgetLayout } from './tipos'

export const limitar01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function defDe(w: WidgetLayout): DefParametro | null {
  if (w.param === undefined || w.min === undefined || w.max === undefined || w.defecto === undefined || !w.escala) return null
  return {
    min: w.min,
    max: w.max,
    defecto: w.defecto,
    escala: w.escala,
    pasos: w.pasos,
    decimales: w.decimales,
    bipolar: w.bipolar,
    bypass: w.bypass,
    unidad: w.unidad,
    opciones: w.opciones,
    nombre: w.nombre,
  }
}

export function aPlano(d: DefParametro, n: number): number {
  n = limitar01(n)
  if (d.escala === 'stepped') return Math.floor(n * (d.pasos ?? 0) + 0.5)
  if (d.escala === 'log') return d.min * Math.pow(d.max / d.min, n)
  return d.min + (d.max - d.min) * n
}

export function aNormalizado(d: DefParametro, p: number): number {
  if (d.escala === 'stepped') return (d.pasos ?? 0) > 0 ? limitar01(Math.floor(p + 0.5) / (d.pasos ?? 1)) : 0
  if (d.escala === 'log') return limitar01(Math.log(Math.max(p, d.min) / d.min) / Math.log(d.max / d.min))
  return limitar01((p - d.min) / (d.max - d.min))
}

export const normalizadoPorDefecto = (d: DefParametro) => aNormalizado(d, d.defecto)

const fijo = (v: number, dec: number) => v.toFixed(Math.max(0, dec))

export function formatear(d: DefParametro, plano: number, conUnidad = true): string {
  if (d.escala === 'stepped') {
    const i = Math.max(0, Math.min(d.pasos ?? 0, Math.round(plano)))
    return d.opciones?.[i] ?? String(i)
  }
  const hz = d.unidad === 'Hz'
  const ms = d.unidad === 'ms'
  if (!conUnidad && (hz || ms)) return fijo(plano, plano >= 100 ? 1 : 2)
  if (hz) {
    if (plano >= 1000) return `${fijo(plano / 1000, 2)} kHz`
    if (plano >= 100) return `${fijo(plano, 0)} Hz`
    return `${fijo(plano, 1)} Hz`
  }
  if (ms && plano >= 1000) return `${fijo(plano / 1000, 2)} s`
  const signo = d.bipolar && plano > 0.0004 ? '+' : ''
  const num = `${signo}${fijo(plano, d.decimales ?? 1)}`
  return conUnidad && d.unidad ? `${num} ${d.unidad}` : num
}

/** Texto escrito por el usuario (p. ej. "2.5 kHz", "-3,5", "On") → valor normalizado, o null si no vale. */
export function interpretar(d: DefParametro, texto: string): number | null {
  const t = texto.trim()
  if (!t) return null
  if (d.escala === 'stepped') {
    const i = (d.opciones ?? []).findIndex((o) => o.toLowerCase() === t.toLowerCase())
    if (i >= 0) return aNormalizado(d, i)
  }
  const m = t.replace(',', '.').match(/^([+-]?\d+(?:\.\d+)?)\s*(k)?/i)
  if (!m) return null
  let v = Number(m[1])
  if (m[2] && d.unidad === 'Hz') v *= 1000
  if (/\bs$/i.test(t) && !/ms$/i.test(t) && d.unidad === 'ms') v *= 1000
  if (!Number.isFinite(v)) return null
  const lo = Math.min(d.min, d.max), hi = Math.max(d.min, d.max)
  return aNormalizado(d, Math.max(lo, Math.min(hi, v)))
}

/** Paso de rueda/teclado: un paso en los escalonados, 1 % (0.1 % con precisión) en los continuos. */
export function pasoRueda(d: DefParametro, n: number, dir: number, fino = false): number {
  if (d.escala === 'stepped' && (d.pasos ?? 0) > 0) return limitar01((Math.round(n * (d.pasos ?? 1)) + dir) / (d.pasos ?? 1))
  return limitar01(n + dir * (fino ? 0.001 : 0.01))
}
