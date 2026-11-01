/**
 * True-peak (ITU-R BS.1770-4, Anexo 2): sobremuestreo 4× con FIR polifásico.
 *
 * El interpolador es un sinc enventanado (Kaiser) de 12 coeficientes por fase (48 taps en total,
 * como el filtro de referencia del Anexo 2). La fase 0 coincide con las muestras originales, de modo
 * que solo se calculan las fases 1–3 (posiciones m + ¼, m + ½, m + ¾). Cada fase se normaliza a
 * ganancia DC unitaria.
 *
 * Optimización exacta: por bloques de muestras se acota |y| ≤ Σ|h|·max|x| y se omiten los bloques que
 * no pueden superar el máximo ya encontrado (sin pérdida de precisión).
 */

export const TRUE_PEAK_SOBREMUESTREO = 4
export const TRUE_PEAK_TAPS_POR_FASE = 12

/** Bessel modificada de primera especie, orden 0 (serie de potencias). */
function besselI0(x: number): number {
  let suma = 1
  let termino = 1
  const y = (x * x) / 4
  for (let k = 1; k < 50; k++) {
    termino *= y / (k * k)
    suma += termino
    if (termino < suma * 1e-16) break
  }
  return suma
}

function sinc(x: number): number {
  if (Math.abs(x) < 1e-12) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}

type FiltroPolifasico = {
  /** Coeficientes por fase: fases[p-1][t] multiplica x[m + t − (T/2 − 1)]. */
  fases: Float64Array[]
  /** max_p Σ|h_p| — cota de ganancia para el descarte por bloques. */
  normaL1Max: number
}

let filtroCacheado: FiltroPolifasico | null = null

/** Diseña (una vez) los coeficientes polifásicos del interpolador 4×. */
export function filtroTruePeak(): FiltroPolifasico {
  if (filtroCacheado) return filtroCacheado
  const T = TRUE_PEAK_TAPS_POR_FASE
  const L = TRUE_PEAK_SOBREMUESTREO
  const beta = 5.5
  const medio = T / 2
  const i0Beta = besselI0(beta)
  const fases: Float64Array[] = []
  let normaL1Max = 0
  for (let p = 1; p < L; p++) {
    const frac = p / L
    const h = new Float64Array(T)
    let suma = 0
    for (let t = 0; t < T; t++) {
      const j = t - (medio - 1)
      const tau = j - frac
      const r = tau / medio
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0Beta
      h[t] = sinc(tau) * w
      suma += h[t]!
    }
    let l1 = 0
    for (let t = 0; t < T; t++) {
      h[t] = h[t]! / suma
      l1 += Math.abs(h[t]!)
    }
    normaL1Max = Math.max(normaL1Max, l1)
    fases.push(h)
  }
  filtroCacheado = { fases, normaL1Max }
  return filtroCacheado
}

const BLOQUE = 256

/**
 * Pico verdadero lineal (máx |x| sobremuestreado 4×) de varios canales.
 * `picoMuestras` (opcional) es el pico de muestra ya conocido; acelera el descarte por bloques.
 */
export function medirTruePeak(canales: ArrayLike<number>[], picoMuestras = 0): number {
  const { fases, normaL1Max } = filtroTruePeak()
  const T = TRUE_PEAK_TAPS_POR_FASE
  const izq = T / 2 - 1
  const der = T / 2
  const [h1, h2, h3] = fases as [Float64Array, Float64Array, Float64Array]
  let tp = picoMuestras
  for (const x of canales) {
    const n = x.length
    if (n === 0) continue
    // Máximo |x| por bloque para la cota.
    const nBloques = Math.ceil(n / BLOQUE)
    const maxBloque = new Float64Array(nBloques)
    for (let b = 0; b < nBloques; b++) {
      let m = 0
      const fin = Math.min(n, (b + 1) * BLOQUE)
      for (let i = b * BLOQUE; i < fin; i++) {
        const a = Math.abs(x[i]!)
        if (a > m) m = a
      }
      maxBloque[b] = m
      if (m > tp) tp = m
    }
    for (let b = 0; b < nBloques; b++) {
      // La ventana del FIR (≤ T/2 muestras a cada lado) cae en los bloques vecinos.
      const cota =
        Math.max(maxBloque[b]!, b > 0 ? maxBloque[b - 1]! : 0, b + 1 < nBloques ? maxBloque[b + 1]! : 0) *
        normaL1Max
      if (cota <= tp) continue
      const ini = b * BLOQUE
      const fin = Math.min(n - 1, (b + 1) * BLOQUE)
      for (let m = ini; m < fin; m++) {
        let y1 = 0
        let y2 = 0
        let y3 = 0
        const base = m - izq
        if (base >= 0 && m + der < n) {
          for (let t = 0; t < T; t++) {
            const v = x[base + t]!
            y1 += h1[t]! * v
            y2 += h2[t]! * v
            y3 += h3[t]! * v
          }
        } else {
          for (let t = 0; t < T; t++) {
            const idx = base + t
            if (idx < 0 || idx >= n) continue
            const v = x[idx]!
            y1 += h1[t]! * v
            y2 += h2[t]! * v
            y3 += h3[t]! * v
          }
        }
        const a1 = Math.abs(y1)
        const a2 = Math.abs(y2)
        const a3 = Math.abs(y3)
        if (a1 > tp) tp = a1
        if (a2 > tp) tp = a2
        if (a3 > tp) tp = a3
      }
    }
  }
  return tp
}
