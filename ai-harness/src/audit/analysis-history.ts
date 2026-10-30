/**
 * Almacén de mediciones por proyecto (A9) — `analysis-history`.
 *
 * Serie temporal de LUFS, TP, PLR, balance, masking, etc. Se persiste en
 * `{proyecto}/docs/analysis-history.json` (el cliente decide dónde; aquí es puro).
 */

export const ANALYSIS_HISTORY_VERSION = 1

export type AnalysisMetric =
  | 'lufs'
  | 'tp'
  | 'rms'
  | 'plr'
  | 'dynamicRange'
  | 'masking'
  | 'stereoWidth'
  | 'balance'
  | 'otro'

export type AnalysisSample = {
  id: string
  proyectoId: string
  runId?: string
  pasoId?: string
  metrica: AnalysisMetric | string
  valor: number
  unidad?: string
  etiqueta?: string
  source?: 'analysis' | 'render' | 'manual' | 'audit'
  timestamp: number
}

export type AnalysisHistory = {
  version: typeof ANALYSIS_HISTORY_VERSION
  proyectoId: string
  samples: AnalysisSample[]
}

/** Tope de muestras por proyecto (las más antiguas se descartan). */
export const ANALYSIS_HISTORY_MAX = 500

export function createAnalysisHistory(proyectoId: string): AnalysisHistory {
  return { version: ANALYSIS_HISTORY_VERSION, proyectoId, samples: [] }
}

export function appendAnalysisSample(
  history: AnalysisHistory,
  sample: Omit<AnalysisSample, 'id' | 'timestamp' | 'proyectoId'> & { id?: string; timestamp?: number },
): AnalysisSample {
  const s: AnalysisSample = {
    id: sample.id ?? `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    proyectoId: history.proyectoId,
    runId: sample.runId,
    pasoId: sample.pasoId,
    metrica: sample.metrica,
    valor: sample.valor,
    unidad: sample.unidad,
    etiqueta: sample.etiqueta,
    source: sample.source,
    timestamp: sample.timestamp ?? Date.now(),
  }
  history.samples.push(s)
  if (history.samples.length > ANALYSIS_HISTORY_MAX) {
    history.samples.splice(0, history.samples.length - ANALYSIS_HISTORY_MAX)
  }
  return s
}

export function listAnalysisSamples(
  history: AnalysisHistory,
  filtro?: { metrica?: string; runId?: string; pasoId?: string; limite?: number },
): AnalysisSample[] {
  let out = [...history.samples]
  if (filtro?.metrica) out = out.filter((s) => s.metrica === filtro.metrica)
  if (filtro?.runId) out = out.filter((s) => s.runId === filtro.runId)
  if (filtro?.pasoId) out = out.filter((s) => s.pasoId === filtro.pasoId)
  out.sort((a, b) => a.timestamp - b.timestamp)
  if (filtro?.limite && filtro.limite > 0) out = out.slice(-filtro.limite)
  return out
}

export type TendenciaMetrica = {
  metrica: string
  unidad?: string
  muestras: Array<{ timestamp: number; valor: number; etiqueta?: string }>
  primero: number
  ultimo: number
  delta: number
  mejoro?: 'mejor' | 'peor' | 'igual'
}

/**
 * Tendencia de una métrica. «Mejor» depende del objetivo de la métrica:
 * LUFS/TP seek closer to 0 → menor |diff| es mejor; PLR/ masking → mayor es mejor.
 */
export function tendenciaMetrica(history: AnalysisHistory, metrica: string): TendenciaMetrica | null {
  const muestras = listAnalysisSamples(history, { metrica })
  if (!muestras.length) return null
  const primero = muestras[0]!.valor
  const ultimo = muestras[muestras.length - 1]!.valor
  const delta = ultimo - primero
  const menorEsMejor = metrica === 'lufs' || metrica === 'tp' || metrica === 'rms'
  const mejor =
    Math.abs(delta) < 1e-9 ? 'igual' : menorEsMejor ? (Math.abs(ultimo) < Math.abs(primero) ? 'mejor' : 'peor') : delta > 0 ? 'mejor' : 'peor'
  return {
    metrica,
    unidad: muestras[muestras.length - 1]!.unidad,
    muestras: muestras.map((s) => ({ timestamp: s.timestamp, valor: s.valor, etiqueta: s.etiqueta })),
    primero,
    ultimo,
    delta,
    mejoro: mejor,
  }
}

export function serializeAnalysisHistory(history: AnalysisHistory): string {
  return JSON.stringify(history, null, 2)
}

export function parseAnalysisHistory(raw: string | unknown): AnalysisHistory | null {
  let o: unknown = raw
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object') return null
  const h = o as Partial<AnalysisHistory>
  if (h.version !== ANALYSIS_HISTORY_VERSION) return null
  return {
    version: ANALYSIS_HISTORY_VERSION,
    proyectoId: typeof h.proyectoId === 'string' ? h.proyectoId : 'default',
    samples: Array.isArray(h.samples) ? h.samples : [],
  }
}
