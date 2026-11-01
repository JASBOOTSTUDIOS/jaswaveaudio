/**
 * Métricas estéreo de banda ancha: correlación, balance L/R, energía mid/side, ancho y
 * compatibilidad mono. El detalle por banda viene de las densidades cruzadas de `spectrum.ts`.
 */

import type { BandaEstereo } from './spectrum'

export type MedicionEstereo = {
  /** Correlación de Pearson L/R (−1..1); mono ≈ 1, anti-fase ≈ −1. */
  correlacion: number
  /** Balance de energía L/R en dB (positivo = izquierda más fuerte). */
  balanceDb: number
  /** Energía mid ((L+R)/2) y side ((L−R)/2) en dB (media cuadrática). */
  energiaMidDb: number
  energiaSideDb: number
  /** side / (mid + side): 0 mono, 0.5 descorrelado, 1 anti-fase. */
  ancho: number
  /** Pérdida (dB, ≥ 0) de la suma mono (L+R)/2 frente a la energía media por canal. */
  perdidaMonoDb: number
  porBanda?: BandaEstereo[]
}

function db10(p: number): number {
  return p <= 1e-14 ? -140 : 10 * Math.log10(p)
}

/** Mide estéreo en una pasada. Con R ausente (mono) devuelve valores de señal mono. */
export function medirEstereo(l: ArrayLike<number>, r: ArrayLike<number> = l): MedicionEstereo {
  const n = Math.min(l.length, r.length)
  if (n < 2) {
    return { correlacion: 1, balanceDb: 0, energiaMidDb: -140, energiaSideDb: -140, ancho: 0, perdidaMonoDb: 0 }
  }
  let sl = 0
  let sr = 0
  let sll = 0
  let srr = 0
  let slr = 0
  for (let i = 0; i < n; i++) {
    const a = l[i] as number
    const b = r[i] as number
    sl += a
    sr += b
    sll += a * a
    srr += b * b
    slr += a * b
  }
  const ml = sl / n
  const mr = sr / n
  const varL = sll / n - ml * ml
  const varR = srr / n - mr * mr
  const cov = slr / n - ml * mr
  const den = Math.sqrt(Math.max(0, varL) * Math.max(0, varR))
  const correlacion = den < 1e-14 ? 1 : Math.max(-1, Math.min(1, cov / den))
  const eL = sll / n
  const eR = srr / n
  const eLR = slr / n
  const mid = Math.max(0, (eL + eR + 2 * eLR) / 4)
  const side = Math.max(0, (eL + eR - 2 * eLR) / 4)
  const media = (eL + eR) / 2
  return {
    correlacion,
    balanceDb: eL > 1e-14 && eR > 1e-14 ? 10 * Math.log10(eL / eR) : eL > 1e-14 ? 60 : eR > 1e-14 ? -60 : 0,
    energiaMidDb: db10(mid),
    energiaSideDb: db10(side),
    ancho: mid + side > 1e-14 ? side / (mid + side) : 0,
    perdidaMonoDb: media > 1e-14 ? Math.min(60, Math.max(0, -10 * Math.log10(Math.max(1e-6, mid / media)))) : 0,
  }
}
