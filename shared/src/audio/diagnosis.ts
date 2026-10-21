/**
 * Diagnóstico de mezcla basado en evidencia (A7b).
 *
 * Propósito:
 *   Convertir mediciones (A7a) en problemas de mezcla accionables: barro, aspereza,
 *   falta/exceso de sub, sibilancia, fase/mono, sobre-compresión, falta de dinámica,
 *   enmascaramiento, desequilibrio L/R, clipping y headroom insuficiente.
 *
 * Importancia:
 *   - Es el "oído de ingeniero" del agente: sin esto solo hay números.
 *   - Todo hallazgo lleva evidencia numérica (bandas, dB) para que la IA pueda
 *     justificar la propuesta y el usuario pueda verificarla.
 *
 * Función:
 *   - `medidaDesdeAnalisis`: adapta un `MixAnalysisReport` (A7a) a `MedidaPista`.
 *   - `diagnosticarMezcla`: aplica todas las reglas y devuelve `MixDiagnosis[]`.
 *   - `detectarEnmascaramiento`: matriz de solapamientos por banda de 1/3 de octava.
 *   - `compararConReferencia`: diferencia banda a banda / LUFS / ancho / dinámica.
 */

import type { BandEnergy } from './spectrum'
import type { MixAnalysisReport } from './mix-analysis'
import type { LoudnessResult } from './loudness-bs1770'

export type SeveridadDiagnostico = 'info' | 'aviso' | 'critico'

/** Hallazgo de diagnóstico con evidencia medible. */
export type MixDiagnosis = {
  /** Identificador estable de la regla (p. ej. 'barro'). */
  regla: string
  /** Qué pasa, en lenguaje de mezcla. */
  problema: string
  severidad: SeveridadDiagnostico
  /** Números que sustentan el hallazgo. */
  evidencia: string
  /** Pistas implicadas (ids). */
  pistas: string[]
  /** Qué haría un ingeniero de sonido. */
  sugerencias: string[]
}

/** Medida de una pista (o del master) lista para diagnosticar. */
export type MedidaPista = {
  trackId: string
  nombre: string
  /** Loudness integrado (LUFS). */
  integrated: number
  truePeakDb: number
  peakDb: number
  rmsDb: number
  /** Pico − RMS (dB). */
  crestFactorDb: number
  /** True-peak − integrado (dB). */
  plrDb?: number
  /** Loudness Range (LU). */
  lraDb?: number
  clipping?: boolean
  clippingSamples?: number
  stereo?: {
    correlacion: number
    balanceDb: number
    ancho: number
    energiaMidDb: number
    energiaSideDb: number
    perdidaMonoDb: number
  }
  transientes?: {
    onsets: number
    densidadPorSeg: number
    ataqueMedioMs: number | null
  }
  /** 31 bandas de 1/3 de octava (potencia en dB). */
  bandas: BandEnergy[]
  /** Agregados (sub/low/lowmid/mid/highmid/high). */
  bandasAgregadas?: BandEnergy[]
  /** Resultado BS.1770 completo (para herramientas que piden short-term/momentary). */
  loudness?: LoudnessResult
}

/** Medidas de una mezcla completa (pistas + master + suma). */
export type MedidaMezcla = {
  pistas: MedidaPista[]
  master: MedidaPista
  /** Suma de pistas antes de la cadena master (si se pudo medir). */
  suma?: MedidaPista
}

// ── Utilidades ───────────────────────────────────────────────────────────────

/** Nivel máximo (dB) de las bandas cuyo centro cae en [loHz, hiHz]. */
export function nivelEnRango(bandas: BandEnergy[], loHz: number, hiHz: number): number {
  let max = -140
  for (const b of bandas) {
    const centro = b.hzCenter
    if (centro >= loHz && centro <= hiHz && b.db > max) max = b.db
  }
  return max
}

/** Nivel medio (dB de potencia) de las bandas cuyo centro cae en [loHz, hiHz]. */
export function nivelMedioEnRango(bandas: BandEnergy[], loHz: number, hiHz: number): number {
  const dentro = bandas.filter((b) => b.hzCenter >= loHz && b.hzCenter <= hiHz)
  if (!dentro.length) return -140
  let acc = 0
  for (const b of dentro) acc += Math.pow(10, b.db / 10)
  return 10 * Math.log10(acc / dentro.length)
}

/** Banda de 1/3 de octava más fuerte dentro de [loHz, hiHz]. */
export function bandaPicoEnRango(bandas: BandEnergy[], loHz: number, hiHz: number): BandEnergy | undefined {
  let mejor: BandEnergy | undefined
  for (const b of bandas) {
    if (b.hzCenter < loHz || b.hzCenter > hiHz) continue
    if (!mejor || b.db > mejor.db) mejor = b
  }
  return mejor
}

/** Nivel máximo de todas las bandas (referencia de la pista). */
export function nivelMaximoBanda(bandas: BandEnergy[]): number {
  let max = -140
  for (const b of bandas) max = Math.max(max, b.db)
  return max
}

function redondear(x: number, dec = 1): number {
  const f = Math.pow(10, dec)
  return Math.round(x * f) / f
}

function nombrePista(pistas: MedidaPista[], trackId: string): string {
  return pistas.find((p) => p.trackId === trackId)?.nombre ?? trackId
}

// ── Adaptador A7a → medida ───────────────────────────────────────────────────

/** Convierte un informe de A7a en la medida que consumen las reglas. */
export function medidaDesdeAnalisis(
  trackId: string,
  nombre: string,
  analysis: MixAnalysisReport,
): MedidaPista {
  const loudness = analysis.loudness
  return {
    trackId,
    nombre,
    integrated: loudness.integrated,
    truePeakDb: analysis.truePeakDb,
    peakDb: analysis.peakDb,
    rmsDb: analysis.rmsDb ?? -140,
    crestFactorDb: analysis.crestFactorDb,
    plrDb: analysis.plrDb,
    lraDb: loudness.loudnessRange ?? loudness.rangoDinamico,
    clipping: analysis.clipping,
    clippingSamples: analysis.clippingSamples,
    stereo: analysis.estereo
      ? {
          correlacion: analysis.estereo.correlacion,
          balanceDb: analysis.estereo.balanceDb,
          ancho: analysis.estereo.ancho,
          energiaMidDb: analysis.estereo.energiaMidDb,
          energiaSideDb: analysis.estereo.energiaSideDb,
          perdidaMonoDb: analysis.estereo.perdidaMonoDb,
        }
      : undefined,
    transientes: analysis.transientes
      ? {
          onsets: analysis.transientes.onsets,
          densidadPorSeg: analysis.transientes.densidadPorSeg,
          ataqueMedioMs: analysis.transientes.ataqueMedioMs,
        }
      : undefined,
    bandas: analysis.spectrumBands,
    bandasAgregadas: analysis.bandasAgregadas,
    loudness: loudness,
  }
}

// ── Enmascaramiento ─────────────────────────────────────────────────────────

/** Solapamientos que un ingeniero revisa siempre (kick/bajo, voz/guitarra). */
export const SOLAPAMIENTOS_CRITICOS = [
  { id: 'kick-bajo', loHz: 40, hiHz: 120, etiqueta: 'kick/bajo' },
  { id: 'voz-guitarra', loHz: 1000, hiHz: 4000, etiqueta: 'voz/guitarra' },
] as const

export type SolapamientoBanda = {
  banda: string
  hzCenter: number
  dbA: number
  dbB: number
  /** dB − dBA: cuánto más fuerte es B en esa banda (>0 = B tapa a A). */
  diferenciaDb: number
  critico: boolean
  /** Rango crítico al que pertenece la banda (si aplica). */
  rangoCritico?: string
}

export type ParEnmascaramiento = {
  pistaA: string
  pistaB: string
  bandas: SolapamientoBanda[]
  critico: boolean
  rangoCritico?: string
  /** Diferencia media (dB) de las bandas solapadas. */
  diferenciaMediaDb: number
}

export type MatrizEnmascaramiento = {
  pares: ParEnmascaramiento[]
  /** Pares con solapamiento en rango crítico (kick/bajo, voz/guitarra…). */
  criticos: ParEnmascaramiento[]
}

export type OpcionesEnmascaramiento = {
  /** dB de diferencia a partir de la cual B tapa a A (por defecto 3 dB). */
  umbralDb?: number
  /** Margen (dB) sobre el máximo de la pista para considerarla presente (por defecto −25 dB). */
  margenPresenciaDb?: number
  /** Solo pares explícitos (ids de pista). */
  pares?: Array<[string, string]>
}

function rangoCriticoPorBanda(loHz: number, hiHz: number): string | undefined {
  for (const p of SOLAPAMIENTOS_CRITICOS) {
    if (loHz <= p.hiHz && hiHz >= p.loHz) return p.etiqueta
  }
  return undefined
}

/**
 * Matriz de enmascaramiento: para cada par de pistas, las bandas de 1/3 de octava
 * donde una tapa a la otra (la más fuerte está ≥ `umbralDb` por encima).
 */
export function detectarEnmascaramiento(
  pistas: MedidaPista[],
  opts?: OpcionesEnmascaramiento,
): MatrizEnmascaramiento {
  const umbral = opts?.umbralDb ?? 3
  const margen = opts?.margenPresenciaDb ?? -25
  const pares: ParEnmascaramiento[] = []
  const permitidos = opts?.pares

  for (let i = 0; i < pistas.length; i++) {
    for (let j = i + 1; j < pistas.length; j++) {
      const a = pistas[i]!
      const b = pistas[j]!
      if (permitidos && !permitidos.some(([x, y]) => (x === a.trackId && y === b.trackId) || (x === b.trackId && y === a.trackId))) {
        continue
      }
      const maxA = nivelMaximoBanda(a.bandas)
      const maxB = nivelMaximoBanda(b.bandas)
      if (maxA <= -139 || maxB <= -139) continue
      const solapes: SolapamientoBanda[] = []
      for (const banda of a.bandas) {
        const dbA = banda.db
        const dbB = b.bandas.find((x) => x.label === banda.label)?.db
        if (dbB == null) continue
        const relA = dbA - maxA
        const relB = dbB - maxB
        if (relA < margen && relB < margen) continue
        const diferencia = dbB - dbA
        if (diferencia < umbral) continue
        const rangoCritico = rangoCriticoPorBanda(banda.loHz ?? banda.hzCenter, banda.hiHz ?? banda.hzCenter)
        solapes.push({
          banda: banda.label,
          hzCenter: banda.hzCenter,
          dbA: redondear(dbA),
          dbB: redondear(dbB),
          diferenciaDb: redondear(diferencia),
          critico: Boolean(rangoCritico),
          rangoCritico,
        })
      }
      if (!solapes.length) continue
      const media =
        solapes.reduce((acc, s) => acc + s.diferenciaDb, 0) / solapes.length
      const critico = solapes.some((s) => s.critico)
      pares.push({
        pistaA: a.trackId,
        pistaB: b.trackId,
        bandas: solapes,
        critico,
        rangoCritico: solapes.find((s) => s.rangoCritico)?.rangoCritico,
        diferenciaMediaDb: redondear(media),
      })
    }
  }
  return { pares, criticos: pares.filter((p) => p.critico) }
}

// ── Reglas ───────────────────────────────────────────────────────────────────

/** Barro: energía 200–500 Hz por encima de las bandas vecinas en varias pistas. */
export function detectarBarro(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const zona = nivelMedioEnRango(medida.master.bandas, 250, 500)
  const lados = (nivelMedioEnRango(medida.master.bandas, 125, 250) + nivelMedioEnRango(medida.master.bandas, 500, 1000)) / 2
  const exceso = zona - lados
  if (exceso < 3) return out
  const pistasBarro = medida.pistas.filter((p) => {
    const z = nivelMedioEnRango(p.bandas, 250, 500)
    const l = (nivelMedioEnRango(p.bandas, 125, 250) + nivelMedioEnRango(p.bandas, 500, 1000)) / 2
    return z - l >= 3
  })
  if (!pistasBarro.length) return out
  const severidad: SeveridadDiagnostico = exceso >= 6 ? 'critico' : 'aviso'
  out.push({
    regla: 'barro',
    problema: 'Barro en 200–500 Hz (mezcla embarrada)',
    severidad,
    evidencia:
      `Región 250–500 Hz está ${redondear(exceso)} dB por encima de las vecinas ` +
      `(${redondear(zona)} dB vs ${redondear(lados)} dB); ${pistasBarro.length} pista(s) con el mismo perfil`,
    pistas: pistasBarro.map((p) => p.trackId),
    sugerencias: [
      'Recortar 200–500 Hz en las pistas que más aportan a esa región (caja/guitarra/voz).',
      'Revisar si la resonancia viene de una sala o de un plugin: usar un HPF dinámico en la pista más responsable.',
      'Mover el bajo fundamental (kick/bajo) fuera de 250 Hz en vez de cortar medio.',
    ],
  })
  return out
}

/** Aspereza: pico puntual 2–5 kHz sobre la tendencia local del espectro. */
export function detectarAspereza(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const bandas = medida.master.bandas
  for (let i = 1; i < bandas.length - 1; i++) {
    const b = bandas[i]!
    if (b.hzCenter < 2000 || b.hzCenter > 5000) continue
    const anterior = bandas[i - 1]!
    const siguiente = bandas[i + 1]!
    const vecinos = (anterior.db + siguiente.db) / 2
    const pico = b.db - vecinos
    if (pico < 4) continue
    out.push({
      regla: 'aspereza',
      problema: `Aspereza en ${b.label} Hz (~${b.hzCenter} Hz)`,
      severidad: pico >= 7 ? 'critico' : 'aviso',
      evidencia:
        `Banda ${b.label} a ${redondear(b.db)} dB, ${redondear(pico)} dB por encima de sus vecinas ` +
        `(${redondear(anterior.db)}/${redondear(siguiente.db)} dB)`,
      pistas: medida.pistas
        .filter((p) => {
          const bb = p.bandas.find((x) => x.label === b.label)
          const pa = p.bandas.find((x) => x.label === anterior.label)
          const ps = p.bandas.find((x) => x.label === siguiente.label)
          if (!bb || !pa || !ps) return false
          return bb.db - (pa.db + ps.db) / 2 >= 4
        })
        .map((p) => p.trackId),
      sugerencias: [
        `Cortar ${b.label} Hz con un filtro de banda en la pista que más energía aporta ahí.`,
        'Revisar sibilancia/clipping del micro o del plugin de voz.',
      ],
    })
  }
  return out
}

/** Falta o exceso de sub (20–60 Hz) frente a la banda low (60–250 Hz). */
export function detectarSub(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const m = medida.master
  const sub = nivelMedioEnRango(m.bandas, 20, 60)
  const low = nivelMedioEnRango(m.bandas, 60, 250)
  if (sub <= -139 || low <= -139) return out
  const dif = sub - low
  if (dif < -6) {
    out.push({
      regla: 'falta-sub',
      problema: 'Falta de sub (base débil por debajo de 60 Hz)',
      severidad: dif <= -12 ? 'critico' : 'aviso',
      evidencia:
        `Sub 20–60 Hz a ${redondear(sub)} dB frente a low 60–250 Hz a ${redondear(low)} dB ` +
        `(${redondear(dif)} dB); el kick y el bajo se oyen sin cuerpo en altavoces pequeños`,
      pistas: m.bandas.length ? medida.pistas.map((p) => p.trackId) : [],
      sugerencias: [
        'Comprobar que el kick y el bajo están en la misma octava fundamental (≈40–60 Hz).',
        'Revisar el HPF de las pistas: si corta por encima de 60 Hz no hay sub que reproducir.',
        'Añadir un sinuso o una capa de sub si el kick es muy corto.',
      ],
    })
  } else if (dif > 3) {
    out.push({
      regla: 'exceso-sub',
      problema: 'Exceso de sub (20–60 Hz por encima del resto)',
      severidad: dif >= 8 ? 'critico' : 'aviso',
      evidencia:
        `Sub 20–60 Hz a ${redondear(sub)} dB frente a low 60–250 Hz a ${redondear(low)} dB ` +
        `(${redondear(dif)} dB)`,
      pistas: medida.pistas.map((p) => p.trackId),
      sugerencias: [
        'Cortar sub en las pistas que no lo necesitan (guitarra, voz, percusión).',
        'Revisar que kick y bajo no estén ambos en la misma octava.',
      ],
    })
  }
  return out
}

/** Sibilancia: pico en 5–9 kHz sobre la tendencia local. */
export function detectarSibilancia(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const bandas = medida.master.bandas
  for (let i = 1; i < bandas.length - 1; i++) {
    const b = bandas[i]!
    if (b.hzCenter < 5000 || b.hzCenter > 9000) continue
    const anterior = bandas[i - 1]!
    const siguiente = bandas[i + 1]!
    const pico = b.db - (anterior.db + siguiente.db) / 2
    if (pico < 5) continue
    out.push({
      regla: 'sibilancia',
      problema: `Sibilancia en ${b.label} Hz`,
      severidad: pico >= 8 ? 'critico' : 'aviso',
      evidencia:
        `Banda ${b.label} a ${redondear(b.db)} dB, ${redondear(pico)} dB sobre las vecinas ` +
        `(${redondear(anterior.db)}/${redondear(siguiente.db)} dB)`,
      pistas: medida.pistas
        .filter((p) => {
          const bb = p.bandas.find((x) => x.label === b.label)
          const pa = p.bandas.find((x) => x.label === anterior.label)
          const ps = p.bandas.find((x) => x.label === siguiente.label)
          if (!bb || !pa || !ps) return false
          return bb.db - (pa.db + ps.db) / 2 >= 5
        })
        .map((p) => p.trackId),
      sugerencias: [
        'De-esser o filtro de banda en la pista vocal afectada.',
        'Revisar el brillo de la麦克rofonía y el gain staging antes de la compresión.',
      ],
    })
  }
  return out
}

/** Fase/mono: contrafase, pérdida mono o mezcla esencialmente mono. */
export function detectarFaseMono(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const m = medida.master
  const st = m.stereo
  if (st) {
    if (st.correlacion < -0.2) {
      out.push({
        regla: 'contrafase',
        problema: 'Contrafase en el master (correlación estéreo negativa)',
        severidad: st.correlacion < -0.5 ? 'critico' : 'aviso',
        evidencia: `Correlación L/R ${redondear(st.correlacion, 2)}; el master se cancela al sumar a mono`,
        pistas: [],
        sugerencias: [
          'Revisar el paneo de las pistas y los cables de instrumento.',
          'Invertir la fase de un canal (o de la pista) y volver a medir.',
        ],
      })
    }
    if (st.perdidaMonoDb > 3) {
      out.push({
        regla: 'perdida-mono',
        problema: `Pérdida de ${redondear(st.perdidaMonoDb)} dB al sumar a mono`,
        severidad: st.perdidaMonoDb > 6 ? 'critico' : 'aviso',
        evidencia: `Ancho ${redondear(st.ancho, 2)}, mid ${redondear(st.energiaMidDb)} dB, side ${redondear(st.energiaSideDb)} dB`,
        pistas: [],
        sugerencias: [
          'Reducir el ancho estéreo (HAAS/M/S) en la zona 200–500 Hz.',
          'Comprobar la compatibilidad mono: en móvil y bluetooth se pierde la base.',
        ],
      })
    }
    if (st.ancho < 0.05 && st.energiaSideDb > -80) {
      out.push({
        regla: 'mezcla-mono',
        problema: 'Mezcla prácticamente mono',
        severidad: 'info',
        evidencia: `Ancho ${redondear(st.ancho, 2)} (side ${redondear(st.energiaSideDb)} dB)`,
        pistas: [],
        sugerencias: ['Abrir el paneo de voz/guitarra o doublers para dar imagen estéreo.'],
      })
    }
    if (Math.abs(st.balanceDb) > 1.5) {
      out.push({
        regla: 'desequilibrio-lr',
        problema: `Desequilibrio L/R de ${redondear(st.balanceDb)} dB`,
        severidad: Math.abs(st.balanceDb) > 3 ? 'critico' : 'aviso',
        evidencia: `Balance ${redondear(st.balanceDb)} dB (L ${redondear(st.energiaMidDb - st.balanceDb / 2)} / R ${redondear(st.energiaMidDb + st.balanceDb / 2)} aprox.)`,
        pistas: medida.pistas
          .filter((p) => p.stereo && Math.abs(p.stereo.balanceDb) > 1.5)
          .map((p) => p.trackId),
        sugerencias: [
          'Revisar el paneo de las pistas que más aportan al desequilibrio.',
          'Comprobar que no hay un canal de instrumento mal balanceado.',
        ],
      })
    }
  }
  for (const p of medida.pistas) {
    const bandaSub = p.bandas.find((b) => b.hzCenter === 40 || b.hzCenter === 50)
    if (!bandaSub || bandaSub.db < -60) continue
    if (!p.stereo) continue
    if (p.stereo.correlacion < 0 && Math.abs(p.stereo.balanceDb) < 1.5) {
      out.push({
        regla: 'contrafase-pista',
        problema: `Contrafase en ${p.nombre}`,
        severidad: 'critico',
        evidencia: `Correlación L/R ${redondear(p.stereo.correlacion, 2)} con sub activo (${redondear(bandaSub.db)} dB)`,
        pistas: [p.trackId],
        sugerencias: ['Comprobar cables/paneo de la pista; invertir fase si es un doblaje.'],
      })
    }
  }
  return out
}

/** Sobre-compresión: PLR (o crest) demasiado bajos. */
export function detectarSobreCompresion(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const m = medida.master
  const plr = m.plrDb
  if (plr != null && plr < 8) {
    out.push({
      regla: 'sobre-compresion',
      problema: 'Sobre-compresión / master limitado',
      severidad: plr < 5 ? 'critico' : 'aviso',
      evidencia: `PLR ${redondear(plr)} dB (true-peak ${redondear(m.truePeakDb)} dBTP − integrado ${redondear(m.integrated)} LUFS)`,
      pistas: [],
      sugerencias: [
        'Dejar más transitorio: subir el ratio del bus o el make-up del compresor.',
        'Bajar el ceiling del limitador para ganar PLR (regla: ≥10 dB para streaming).',
      ],
    })
  }
  if (m.crestFactorDb < 5) {
    out.push({
      regla: 'crest-bajo',
      problema: 'Factor de crest muy bajo (poco transitorio)',
      severidad: m.crestFactorDb < 3 ? 'critico' : 'aviso',
      evidencia: `Crest ${redondear(m.crestFactorDb)} dB (pico ${redondear(m.peakDb)} dBFS − RMS ${redondear(m.rmsDb)} dBFS)`,
      pistas: [],
      sugerencias: ['Soltar el compresor del bus o usar compresión más suave (ratio 2:1).'],
    })
  }
  return out
}

/** Falta de dinámica: LRA muy bajo. */
export function detectarFaltaDinamica(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const m = medida.master
  const lra = m.lraDb
  if (lra == null || lra > 4) return out
  out.push({
    regla: 'falta-dinamica',
    problema: 'Falta de dinámica (LRA muy bajo)',
    severidad: lra <= 2 ? 'critico' : 'aviso',
    evidencia: `LRA ${redondear(lra)} LU · crest ${redondear(m.crestFactorDb)} dB · ${redondear(m.integrated)} LUFS integrados`,
    pistas: [],
    sugerencias: [
      'Dejar respirar la mezcla: subir el rango entre secciones (intro más bajo, coro más alto).',
      'Reducir la compresión sostenida en el bus.',
    ],
  })
  return out
}

/** Clipping en el master o en pistas. */
export function detectarClipping(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  if (medida.master.clipping) {
    out.push({
      regla: 'clipping',
      problema: 'Clipping en el master',
      severidad: 'critico',
      evidencia: `${medida.master.clippingSamples ?? 0} muestras al tope`,
      pistas: [],
      sugerencias: ['Bajar el gain del bus o el makeup del limitador hasta que desaparezca el clipping.'],
    })
  }
  for (const p of medida.pistas) {
    if (!p.clipping) continue
    out.push({
      regla: 'clipping-pista',
      problema: `Clipping en ${p.nombre}`,
      severidad: 'critico',
      evidencia: `${p.clippingSamples ?? 0} muestras al tope (true-peak ${redondear(p.truePeakDb)} dBTP)`,
      pistas: [p.trackId],
      sugerencias: ['Bajar el fader o el makeup del insert de la pista.'],
    })
  }
  return out
}

/** Headroom insuficiente (true-peak demasiado cerca del tope). */
export function detectarHeadroom(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const m = medida.master
  if (m.truePeakDb > -1) {
    out.push({
      regla: 'headroom',
      problema: 'Headroom insuficiente (true-peak casi en 0 dBTP)',
      severidad: m.truePeakDb > 0 ? 'critico' : 'aviso',
      evidencia: `True-peak ${redondear(m.truePeakDb)} dBTP · ceiling de streaming −1 dBTP`,
      pistas: [],
      sugerencias: [
        'Bajar el limiter un poco más (ceiling −1 dBTP) y repetir la medición.',
        'Revisar el makeup de los compresores de la cadena master.',
      ],
    })
  }
  return out
}

/** Enmascaramiento → diagnóstico (usa la matriz de bandas). */
export function detectarEnmascaramientoDiagnostico(
  medida: MedidaMezcla,
  matriz?: MatrizEnmascaramiento,
): MixDiagnosis[] {
  const out: MixDiagnosis[] = []
  const m = matriz ?? detectarEnmascaramiento(medida.pistas)
  for (const par of m.criticos) {
    const bandasCriticas = par.bandas.filter((b) => b.critico)
    const max = bandasCriticas.reduce((a, b) => (b.diferenciaDb > a.diferenciaDb ? b : a), bandasCriticas[0]!)
    out.push({
      regla: 'enmascaramiento',
      problema: `Enmascaramiento en ${par.rangoCritico ?? 'rango compartido'} entre ${nombrePista(medida.pistas, par.pistaA)} y ${nombrePista(medida.pistas, par.pistaB)}`,
      severidad: max.diferenciaDb >= 8 ? 'critico' : 'aviso',
      evidencia:
        `${bandasCriticas.length} banda(s) solapadas; peor: ${max.banda} Hz (${max.dbA} dB vs ${max.dbB} dB, ` +
        `${max.diferenciaDb} dB de diferencia)`,
      pistas: [par.pistaA, par.pistaB],
      sugerencias: [
        `Bajar ${max.diferenciaDb >= 8 ? '4–6 dB' : '2–3 dB'} la pista más fuerte en ${max.banda} Hz.`,
        'Alternativa: ducking automático (sidechain) de la pista enmascarada por la otra.',
        'Revisar el orden de compresión: comprimir el enmascarado después del enmascarador.',
      ],
    })
  }
  return out
}

/**
 * Diagnóstico completo de la mezcla: aplica todas las reglas y ordena por severidad.
 */
export function diagnosticarMezcla(medida: MedidaMezcla): MixDiagnosis[] {
  const out: MixDiagnosis[] = [
    ...detectarClipping(medida),
    ...detectarHeadroom(medida),
    ...detectarFaseMono(medida),
    ...detectarSobreCompresion(medida),
    ...detectarFaltaDinamica(medida),
    ...detectarBarro(medida),
    ...detectarAspereza(medida),
    ...detectarSibilancia(medida),
    ...detectarSub(medida),
    ...detectarEnmascaramientoDiagnostico(medida),
  ]
  const orden: Record<SeveridadDiagnostico, number> = { critico: 0, aviso: 1, info: 2 }
  return out.sort((a, b) => orden[a.severidad] - orden[b.severidad])
}

// ── Referencia ───────────────────────────────────────────────────────────────

export type ComparacionReferencia = {
  lufs: { referencia: number; mezcla: number; diferenciaDb: number }
  truePeakDb: { referencia: number; mezcla: number; diferenciaDb: number }
  ancho: { referencia: number; mezcla: number; diferencia: number }
  dinamica: {
    lraReferencia: number | null
    lraMezcla: number | null
    crestReferencia: number
    crestMezcla: number
  }
  /** Diferencia banda a banda (1/3 de octava). */
  bandas: Array<{ label: string; hzCenter: number; dbReferencia: number; dbMezcla: number; diferenciaDb: number }>
  /** Ganancia (dB) a aplicar a la mezcla para igualar el loudness de la referencia. */
  gananciaIgualacionDb: number
  /** Resumen accionable. */
  diferenciasClave: string[]
}

/** Compara una referencia con la mezcla actual banda a banda, loudness, ancho y dinámica. */
export function compararConReferencia(referencia: MedidaPista, mezcla: MedidaPista): ComparacionReferencia {
  const bandas = referencia.bandas.map((b) => {
    const mb = mezcla.bandas.find((x) => x.label === b.label)
    const dbMezcla = mb?.db ?? -140
    return {
      label: b.label,
      hzCenter: b.hzCenter,
      dbReferencia: b.db,
      dbMezcla,
      diferenciaDb: redondear(dbMezcla - b.db),
    }
  })
  const diferenciasClave: string[] = []
  const lufs = {
    referencia: referencia.integrated,
    mezcla: mezcla.integrated,
    diferenciaDb: redondear(mezcla.integrated - referencia.integrated),
  }
  if (Math.abs(lufs.diferenciaDb) >= 1) {
    diferenciasClave.push(
      `Loudness ${lufs.diferenciaDb > 0 ? 'más alto' : 'más bajo'} que la referencia en ${redondear(Math.abs(lufs.diferenciaDb))} dB`,
    )
  }
  const tp = {
    referencia: referencia.truePeakDb,
    mezcla: mezcla.truePeakDb,
    diferenciaDb: redondear(mezcla.truePeakDb - referencia.truePeakDb),
  }
  if (Math.abs(tp.diferenciaDb) >= 1) {
    diferenciasClave.push(`True-peak ${redondear(Math.abs(tp.diferenciaDb))} dB ${tp.diferenciaDb > 0 ? 'por encima' : 'por debajo'} de la referencia`)
  }
  const anchoRef = referencia.stereo?.ancho ?? 0
  const anchoMezcla = mezcla.stereo?.ancho ?? 0
  if (Math.abs(anchoMezcla - anchoRef) >= 0.1) {
    diferenciasClave.push(
      `Ancho estéreo ${anchoMezcla > anchoRef ? 'mayor' : 'menor'} que la referencia (${redondear(anchoMezcla, 2)} vs ${redondear(anchoRef, 2)})`,
    )
  }
  if (referencia.lraDb != null && mezcla.lraDb != null && Math.abs(mezcla.lraDb - referencia.lraDb) >= 2) {
    diferenciasClave.push(`Rango dinámico ${redondear(Math.abs(mezcla.lraDb - referencia.lraDb))} LU ${mezcla.lraDb > referencia.lraDb ? 'mayor' : 'menor'} que la referencia`)
  }
  const bandasInteresantes = bandas
    .filter((b) => b.diferenciaDb <= -3 || b.diferenciaDb >= 3)
    .sort((a, b) => Math.abs(b.diferenciaDb) - Math.abs(a.diferenciaDb))
    .slice(0, 5)
  for (const b of bandasInteresantes) {
    diferenciasClave.push(
      `Banda ${b.label} Hz: ${b.diferenciaDb > 0 ? '+' : ''}${redondear(b.diferenciaDb)} dB respecto a la referencia`,
    )
  }
  return {
    lufs,
    truePeakDb: tp,
    ancho: { referencia: anchoRef, mezcla: anchoMezcla, diferencia: redondear(anchoMezcla - anchoRef, 2) },
    dinamica: {
      lraReferencia: referencia.lraDb ?? null,
      lraMezcla: mezcla.lraDb ?? null,
      crestReferencia: referencia.crestFactorDb,
      crestMezcla: mezcla.crestFactorDb,
    },
    bandas,
    gananciaIgualacionDb: redondear(referencia.integrated - mezcla.integrated),
    diferenciasClave,
  }
}
