/**
 * FFT compleja radix-2 iterativa (en lugar) con tablas de giro cacheadas por tamaño.
 *
 * Uso interno de los analizadores DSP (espectro Welch, flujo espectral). Opera sobre
 * Float64Array para precisión y velocidad en V8.
 */

type TablaFft = {
  n: number
  inversionBits: Uint32Array
  cos: Float64Array
  sin: Float64Array
}

const cacheTablas = new Map<number, TablaFft>()

export function esPotenciaDeDos(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0
}

function tablaFft(n: number): TablaFft {
  const cacheada = cacheTablas.get(n)
  if (cacheada) return cacheada
  if (!esPotenciaDeDos(n)) throw new Error(`Tamaño de FFT no es potencia de 2: ${n}`)
  let bits = 0
  while (1 << bits < n) bits++
  const inversionBits = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    inversionBits[i] = r
  }
  const mitad = n >> 1
  const cos = new Float64Array(Math.max(1, mitad))
  const sin = new Float64Array(Math.max(1, mitad))
  for (let k = 0; k < mitad; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n)
    sin[k] = Math.sin((2 * Math.PI * k) / n)
  }
  const tabla = { n, inversionBits, cos, sin }
  cacheTablas.set(n, tabla)
  return tabla
}

/**
 * FFT directa en lugar: X[k] = Σ x[n]·e^{−i2πkn/N}. `re` e `im` deben tener la misma longitud (potencia de 2).
 */
export function fftEnLugar(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n <= 1) return
  const { inversionBits, cos, sin } = tablaFft(n)
  for (let i = 0; i < n; i++) {
    const j = inversionBits[i]!
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  // Etapa de tamaño 2 (giro trivial).
  for (let i = 0; i < n; i += 2) {
    const ar = re[i]!
    const ai = im[i]!
    const br = re[i + 1]!
    const bi = im[i + 1]!
    re[i] = ar + br
    im[i] = ai + bi
    re[i + 1] = ar - br
    im[i + 1] = ai - bi
  }
  for (let tam = 4; tam <= n; tam <<= 1) {
    const mitad = tam >> 1
    const paso = n / tam
    for (let j = 0, k = 0; j < mitad; j++, k += paso) {
      const wr = cos[k]!
      const wi = -sin[k]!
      for (let a = j; a < n; a += tam) {
        const b = a + mitad
        const xr = re[b]!
        const xi = im[b]!
        const tr = xr * wr - xi * wi
        const ti = xr * wi + xi * wr
        const ur = re[a]!
        const ui = im[a]!
        re[a] = ur + tr
        im[a] = ui + ti
        re[b] = ur - tr
        im[b] = ui - ti
      }
    }
  }
}

/** FFT inversa en lugar (incluye el factor 1/N). */
export function ifftEnLugar(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 0; i < n; i++) im[i] = -im[i]!
  fftEnLugar(re, im)
  const inv = 1 / n
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! * inv
    im[i] = -im[i]! * inv
  }
}

/** Ventana de Hann periódica (adecuada para análisis espectral con solape). */
export function ventanaHann(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}
