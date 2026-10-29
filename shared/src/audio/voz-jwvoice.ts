/**
 * Formato `.jwvoice` (K4): huella de una voz (f0 medio/rango, formantes, brillo, aspereza) y banco de voces.
 *
 * - `analizarHuellaVoz` mide la huella a partir de audio mono (YIN existente + envolvente LPC para formantes).
 * - `serializarJwVoice` / `leerJwVoice` convierten a/desde JSON versionado con validación estricta.
 * - El banco (`BancoVoces`) es inmutable: cada operación devuelve un banco nuevo. Los 4 puestos del coro
 *   (lead, 2.ª voz, 3.ª voz, base grave) apuntan a voces del banco por id.
 */
import { estimarFrecuenciaYIN } from './pitch-tracking'

export const JWVOICE_FORMATO = 'jwvoice'
export const JWVOICE_VERSION = 1
export const MAX_PUESTOS_CORO = 4

export type RegistroVoz = 'bajo' | 'baritono' | 'tenor' | 'contralto' | 'mezzo' | 'soprano'

export type HuellaVoz = {
  /** f0 medio de los tramos sonoros (Hz). */
  f0MedioHz: number
  f0MinHz: number
  f0MaxHz: number
  /** F1..F3 en Hz (en orden creciente). */
  formantesHz: [number, number, number]
  /** Brillo 0..1 (energía de agudos relativa). */
  brillo: number
  /** Aspereza 0..1 (jitter y claridad baja). */
  aspereza: number
  /** Proporción de tramos sonoros respecto al total analizado (0..1). */
  sonoridad: number
}

export type VozJwVoice = {
  id: string
  nombre: string
  registro: RegistroVoz
  huella: HuellaVoz
  notas?: string
  /** ISO-8601; opcional para que los tests sean deterministas. */
  creada?: string
}

export type ArchivoJwVoice = {
  formato: typeof JWVOICE_FORMATO
  version: number
  voz: VozJwVoice
}

export type ResultadoLecturaJwVoice = { ok: true; voz: VozJwVoice } | { ok: false; errores: string[] }

const REGISTROS: readonly RegistroVoz[] = ['bajo', 'baritono', 'tenor', 'contralto', 'mezzo', 'soprano']

/** Clasifica una voz por su f0 medio. */
export function clasificarRegistroVoz(f0MedioHz: number): RegistroVoz {
  if (f0MedioHz < 110) return 'bajo'
  if (f0MedioHz < 150) return 'baritono'
  if (f0MedioHz < 210) return 'tenor'
  if (f0MedioHz < 260) return 'contralto'
  if (f0MedioHz < 330) return 'mezzo'
  return 'soprano'
}

const acotar = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

// ---------------------------------------------------------------------------------------------
// Análisis
// ---------------------------------------------------------------------------------------------

/** Coeficientes LPC (autocorrelación + Levinson-Durbin) de un tramo ventaneado. */
function coeficientesLpc(x: Float64Array, orden: number): Float64Array {
  const r = new Float64Array(orden + 1)
  for (let k = 0; k <= orden; k++) {
    let s = 0
    for (let i = k; i < x.length; i++) s += x[i]! * x[i - k]!
    r[k] = s
  }
  r[0] = r[0]! * 1.0001 + 1e-12
  const a = new Float64Array(orden + 1)
  a[0] = 1
  let err = r[0]!
  for (let i = 1; i <= orden; i++) {
    let acc = r[i]!
    for (let j = 1; j < i; j++) acc += a[j]! * r[i - j]!
    const k = -acc / err
    const previo = a.slice()
    for (let j = 1; j < i; j++) a[j] = previo[j]! + k * previo[i - j]!
    a[i] = k
    err *= 1 - k * k
    if (err <= 0) break
  }
  return a
}

/** Magnitud de la envolvente LPC en `hz`. */
function envolventeLpc(a: Float64Array, hz: number, sr: number): number {
  const w = (2 * Math.PI * hz) / sr
  let re = 0
  let im = 0
  for (let k = 0; k < a.length; k++) {
    re += a[k]! * Math.cos(w * k)
    im -= a[k]! * Math.sin(w * k)
  }
  return 1 / Math.sqrt(re * re + im * im + 1e-18)
}

/** Picos de la envolvente LPC entre 200 Hz y 4,5 kHz. */
function formantesDeTramo(tramo: Float64Array, sr: number): number[] {
  const n = tramo.length
  const x = new Float64Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const v = tramo[i]! - 0.97 * prev // preénfasis
    prev = tramo[i]!
    x[i] = v * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)))
  }
  const a = coeficientesLpc(x, Math.round(sr / 1000) + 2)
  const paso = 20
  const picos: number[] = []
  let ant = envolventeLpc(a, 200 - paso, sr)
  let act = envolventeLpc(a, 200, sr)
  for (let f = 200 + paso; f < 4500; f += paso) {
    const sig = envolventeLpc(a, f, sr)
    if (act > ant && act >= sig) picos.push(f - paso)
    ant = act
    act = sig
  }
  return picos
}

const mediana = (v: number[]): number => {
  if (v.length === 0) return 0
  const s = [...v].sort((p, q) => p - q)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export type OpcionesHuella = { minHz?: number; maxHz?: number; umbralYin?: number }

/**
 * Mide la huella de voz de un audio mono. Devuelve `null` si no hay tramos sonoros suficientes
 * (menos de 5 ventanas con voz): no se inventa una huella.
 */
export function analizarHuellaVoz(audio: Float32Array | Float64Array, sampleRate: number, opciones: OpcionesHuella = {}): HuellaVoz | null {
  const ventana = 2048
  const salto = 512
  const minHz = opciones.minHz ?? 60
  const maxHz = opciones.maxHz ?? 1050
  const umbral = opciones.umbralYin ?? 0.15
  const f0s: number[] = []
  const claridades: number[] = []
  const f1s: number[] = []
  const f2s: number[] = []
  const f3s: number[] = []
  const brillos: number[] = []
  let total = 0
  for (let o = 0; o + ventana <= audio.length; o += salto) {
    total++
    let e = 0
    for (let i = 0; i < ventana; i++) e += audio[o + i]! * audio[o + i]!
    if (Math.sqrt(e / ventana) < 0.005) continue
    const { freqHz, confianza } = estimarFrecuenciaYIN(audio, o, ventana, sampleRate, umbral, minHz, maxHz)
    if (freqHz <= 0 || confianza < 0.6) continue
    f0s.push(freqHz)
    claridades.push(confianza)
    const tramo = Float64Array.from(audio.subarray(o, o + ventana))
    const f = formantesDeTramo(tramo, sampleRate)
    // evita confundir el armónico fundamental con F1 en voces agudas: exige F1 por encima de 1,5·f0
    const validos = f.filter((v) => v > 1.5 * freqHz)
    if (validos.length >= 3) {
      f1s.push(validos[0]!)
      f2s.push(validos[1]!)
      f3s.push(validos[2]!)
    }
    // brillo: energía de la diferencia de primer orden (énfasis de agudos) frente a la energía total
    let ed = 0
    for (let i = 1; i < ventana; i++) {
      const d = audio[o + i]! - audio[o + i - 1]!
      ed += d * d
    }
    brillos.push(e > 0 ? ed / e : 0)
  }
  if (f0s.length < 5) return null
  const f0Medio = mediana(f0s)
  const ordenadas = [...f0s].sort((p, q) => p - q)
  const f0Min = ordenadas[Math.floor(ordenadas.length * 0.05)]!
  const f0Max = ordenadas[Math.min(ordenadas.length - 1, Math.ceil(ordenadas.length * 0.95) - 1)]!
  // jitter: variación media entre ventanas contiguas (cents)
  let dif = 0
  for (let i = 1; i < f0s.length; i++) dif += Math.abs(1200 * Math.log2(f0s[i]! / f0s[i - 1]!))
  const jitter = f0s.length > 1 ? dif / (f0s.length - 1) : 0
  const claridadMedia = claridades.reduce((s, v) => s + v, 0) / claridades.length
  const aspereza = acotar(0.5 * acotar(jitter / 60, 0, 1) + 0.5 * (1 - claridadMedia), 0, 1)
  const brillo = acotar(Math.sqrt(mediana(brillos)) / 0.8, 0, 1)
  const f1 = f1s.length ? mediana(f1s) : 500
  const f2 = f2s.length ? mediana(f2s) : 1500
  const f3 = f3s.length ? mediana(f3s) : 2500
  const r2 = (v: number): number => Math.round(v * 100) / 100
  const r3 = (v: number): number => Math.round(v * 1000) / 1000
  return {
    f0MedioHz: r2(f0Medio),
    f0MinHz: r2(Math.min(f0Min, f0Medio)),
    f0MaxHz: r2(Math.max(f0Max, f0Medio)),
    formantesHz: [r2(f1), r2(Math.max(f2, f1 + 1)), r2(Math.max(f3, f2 + 1, f1 + 2))],
    brillo: r3(brillo),
    aspereza: r3(aspereza),
    sonoridad: r3(f0s.length / Math.max(1, total)),
  }
}

// ---------------------------------------------------------------------------------------------
// Serialización y validación
// ---------------------------------------------------------------------------------------------

export function validarHuellaVoz(h: unknown): string[] {
  const e: string[] = []
  if (typeof h !== 'object' || h === null) return ['huella: debe ser un objeto']
  const o = h as Record<string, unknown>
  const num = (k: string, a: number, b: number): number | null => {
    const v = o[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) { e.push(`huella.${k}: debe ser un número finito`); return null }
    if (v < a || v > b) { e.push(`huella.${k}: fuera de rango [${a}, ${b}]`); return null }
    return v
  }
  const medio = num('f0MedioHz', 20, 2000)
  const min = num('f0MinHz', 20, 2000)
  const max = num('f0MaxHz', 20, 2000)
  if (min !== null && max !== null && min > max) e.push('huella: f0MinHz no puede superar f0MaxHz')
  else if (medio !== null && min !== null && max !== null && (medio < min || medio > max)) e.push('huella: f0MedioHz debe estar dentro de [f0MinHz, f0MaxHz]')
  num('brillo', 0, 1)
  num('aspereza', 0, 1)
  num('sonoridad', 0, 1)
  const f = o.formantesHz
  if (!Array.isArray(f) || f.length !== 3 || f.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 50 || v > 8000)) {
    e.push('huella.formantesHz: deben ser 3 frecuencias finitas entre 50 y 8000 Hz')
  } else if (!(f[0] < f[1] && f[1] < f[2])) e.push('huella.formantesHz: deben estar en orden estrictamente creciente')
  return e
}

export function validarVozJwVoice(v: unknown): string[] {
  if (typeof v !== 'object' || v === null) return ['voz: debe ser un objeto']
  const o = v as Record<string, unknown>
  const e: string[] = []
  if (typeof o.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(o.id)) e.push('voz.id: obligatorio (letras, dígitos, . _ -; máx. 64)')
  if (typeof o.nombre !== 'string' || o.nombre.trim() === '' || o.nombre.length > 80) e.push('voz.nombre: obligatorio, máx. 80 caracteres')
  if (typeof o.registro !== 'string' || !REGISTROS.includes(o.registro as RegistroVoz)) e.push(`voz.registro: debe ser uno de ${REGISTROS.join(', ')}`)
  if (o.notas !== undefined && (typeof o.notas !== 'string' || o.notas.length > 500)) e.push('voz.notas: texto de máx. 500 caracteres')
  if (o.creada !== undefined && (typeof o.creada !== 'string' || Number.isNaN(Date.parse(o.creada)))) e.push('voz.creada: fecha ISO-8601 inválida')
  e.push(...validarHuellaVoz(o.huella))
  return e
}

export function crearVozJwVoice(datos: { id: string; nombre: string; huella: HuellaVoz; registro?: RegistroVoz; notas?: string; creada?: string }): VozJwVoice {
  const voz: VozJwVoice = {
    id: datos.id,
    nombre: datos.nombre,
    registro: datos.registro ?? clasificarRegistroVoz(datos.huella.f0MedioHz),
    huella: datos.huella,
  }
  if (datos.notas !== undefined) voz.notas = datos.notas
  if (datos.creada !== undefined) voz.creada = datos.creada
  return voz
}

export function serializarJwVoice(voz: VozJwVoice): string {
  const errores = validarVozJwVoice(voz)
  if (errores.length) throw new Error(`.jwvoice inválido: ${errores.join('; ')}`)
  const archivo: ArchivoJwVoice = { formato: JWVOICE_FORMATO, version: JWVOICE_VERSION, voz }
  return JSON.stringify(archivo, null, 2)
}

export function leerJwVoice(texto: string): ResultadoLecturaJwVoice {
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return { ok: false, errores: ['JSON ilegible'] }
  }
  if (typeof crudo !== 'object' || crudo === null) return { ok: false, errores: ['el archivo debe ser un objeto'] }
  const o = crudo as Record<string, unknown>
  if (o.formato !== JWVOICE_FORMATO) return { ok: false, errores: [`formato debe ser "${JWVOICE_FORMATO}"`] }
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) return { ok: false, errores: ['version inválida'] }
  if (o.version > JWVOICE_VERSION) return { ok: false, errores: [`versión ${o.version} más nueva que la soportada (${JWVOICE_VERSION})`] }
  const errores = validarVozJwVoice(o.voz)
  if (errores.length) return { ok: false, errores }
  return { ok: true, voz: o.voz as VozJwVoice }
}

// ---------------------------------------------------------------------------------------------
// Banco de voces
// ---------------------------------------------------------------------------------------------

export type PuestoCoro = {
  /** id de voz del banco, o null si el puesto queda libre. */
  vozId: string | null
  /** Intervalo en semitonos respecto a la melodía (p. ej. +4 = tercera mayor). */
  intervaloSemitonos: number
  nivelDb: number
  /** -1 (izquierda) .. +1 (derecha). */
  pan: number
}

export type BancoVoces = {
  voces: VozJwVoice[]
  /** Siempre 4 puestos: lead, 2.ª voz, 3.ª voz, base grave. */
  puestos: [PuestoCoro, PuestoCoro, PuestoCoro, PuestoCoro]
}

export function crearBancoVoces(): BancoVoces {
  return {
    voces: [],
    puestos: [
      { vozId: null, intervaloSemitonos: 0, nivelDb: 0, pan: 0 },
      { vozId: null, intervaloSemitonos: 4, nivelDb: -3, pan: -0.35 },
      { vozId: null, intervaloSemitonos: 7, nivelDb: -3, pan: 0.35 },
      { vozId: null, intervaloSemitonos: -12, nivelDb: -4.5, pan: 0 },
    ],
  }
}

export function agregarVozAlBanco(banco: BancoVoces, voz: VozJwVoice): BancoVoces {
  const errores = validarVozJwVoice(voz)
  if (errores.length) throw new Error(`voz inválida: ${errores.join('; ')}`)
  const voces = banco.voces.some((v) => v.id === voz.id) ? banco.voces.map((v) => (v.id === voz.id ? voz : v)) : [...banco.voces, voz]
  return { ...banco, voces }
}

export function quitarVozDelBanco(banco: BancoVoces, id: string): BancoVoces {
  return {
    voces: banco.voces.filter((v) => v.id !== id),
    puestos: banco.puestos.map((p) => (p.vozId === id ? { ...p, vozId: null } : p)) as BancoVoces['puestos'],
  }
}

export function asignarPuestoCoro(banco: BancoVoces, indice: number, cambios: Partial<PuestoCoro>): BancoVoces {
  if (!Number.isInteger(indice) || indice < 0 || indice >= MAX_PUESTOS_CORO) throw new Error(`puesto fuera de rango (0..${MAX_PUESTOS_CORO - 1})`)
  if (cambios.vozId && !banco.voces.some((v) => v.id === cambios.vozId)) throw new Error(`la voz "${cambios.vozId}" no está en el banco`)
  const puestos = banco.puestos.map((p, i) => (i === indice ? { ...p, ...cambios } : p)) as BancoVoces['puestos']
  return { ...banco, puestos }
}

/** Voz del banco más cercana a un f0 objetivo (distancia en semitonos al f0 medio). */
export function vozMasCercana(banco: BancoVoces, f0Hz: number): VozJwVoice | null {
  let mejor: VozJwVoice | null = null
  let d = Infinity
  for (const v of banco.voces) {
    const x = Math.abs(12 * Math.log2(v.huella.f0MedioHz / f0Hz))
    if (x < d) { d = x; mejor = v }
  }
  return mejor
}

export function serializarBancoVoces(banco: BancoVoces): string {
  for (const v of banco.voces) {
    const e = validarVozJwVoice(v)
    if (e.length) throw new Error(`voz "${v.id}" inválida: ${e.join('; ')}`)
  }
  return JSON.stringify({ formato: 'jwvoice-banco', version: JWVOICE_VERSION, voces: banco.voces, puestos: banco.puestos }, null, 2)
}

export function leerBancoVoces(texto: string): { ok: true; banco: BancoVoces } | { ok: false; errores: string[] } {
  let c: unknown
  try { c = JSON.parse(texto) } catch { return { ok: false, errores: ['JSON ilegible'] } }
  if (typeof c !== 'object' || c === null) return { ok: false, errores: ['el banco debe ser un objeto'] }
  const o = c as Record<string, unknown>
  if (o.formato !== 'jwvoice-banco') return { ok: false, errores: ['formato debe ser "jwvoice-banco"'] }
  if (typeof o.version !== 'number' || o.version > JWVOICE_VERSION || o.version < 1) return { ok: false, errores: ['version no soportada'] }
  if (!Array.isArray(o.voces)) return { ok: false, errores: ['voces debe ser una lista'] }
  const errores: string[] = []
  const ids = new Set<string>()
  o.voces.forEach((v, i) => {
    validarVozJwVoice(v).forEach((m) => errores.push(`voces[${i}]: ${m}`))
    const id = (v as { id?: unknown } | null)?.id
    if (typeof id === 'string') {
      if (ids.has(id)) errores.push(`voces[${i}]: id repetido "${id}"`)
      ids.add(id)
    }
  })
  const p = o.puestos
  if (!Array.isArray(p) || p.length !== MAX_PUESTOS_CORO) errores.push(`puestos debe tener ${MAX_PUESTOS_CORO} elementos`)
  else {
    p.forEach((x, i) => {
      const q = x as Partial<PuestoCoro> | null
      if (!q || (q.vozId !== null && (typeof q.vozId !== 'string' || !ids.has(q.vozId)))) errores.push(`puestos[${i}].vozId: debe ser null o un id del banco`)
      if (!q || typeof q.intervaloSemitonos !== 'number' || !Number.isFinite(q.intervaloSemitonos) || Math.abs(q.intervaloSemitonos) > 24) errores.push(`puestos[${i}].intervaloSemitonos: |x| <= 24`)
      if (!q || typeof q.nivelDb !== 'number' || !Number.isFinite(q.nivelDb) || q.nivelDb < -60 || q.nivelDb > 12) errores.push(`puestos[${i}].nivelDb: entre -60 y 12`)
      if (!q || typeof q.pan !== 'number' || !Number.isFinite(q.pan) || q.pan < -1 || q.pan > 1) errores.push(`puestos[${i}].pan: entre -1 y 1`)
    })
  }
  if (errores.length) return { ok: false, errores }
  return { ok: true, banco: { voces: o.voces as VozJwVoice[], puestos: p as BancoVoces['puestos'] } }
}
