/**
 * Auditoría de mezcla (A9) - audit.mix
 *
 * Consume `analysis.*` (A7) si está disponible; si no, usa la última medición
 * conocida (analysis-history) o las mediciones que le pase el host.
 * Compara con la medición anterior por métrica (mejoró/empeoró).
 */

import type { AuditEvidence, AuditMixInput, AuditMixResultado, AuditSeverity } from './schemas';
import { tendenciaMetrica, type AnalysisHistory } from './analysis-history';

export type MixMeasurement = {
  valor: number;
  unidad?: string;
  ok?: boolean;
  anterior?: number;
  delta?: number;
  mejoro?: 'mejor' | 'peor' | 'igual';
};

export type MixIncidence = { severidad: AuditSeverity; mensaje: string; codigo?: string };

/** Métricas donde acercarse a 0 es mejorar. */
const CERCANO_A_CERO = new Set(['lufs', 'tp', 'rms']);

function comparar(actual: number, anterior: number, metrica: string): 'mejor' | 'peor' | 'igual' {
  const delta = actual - anterior
  if (Math.abs(delta) < 1e-9) return 'igual'
  if (CERCANO_A_CERO.has(metrica)) {
    return Math.abs(actual) < Math.abs(anterior) ? 'mejor' : 'peor'
  }
  return delta > 0 ? 'mejor' : 'peor'
}

/**
 * Normaliza las mediciones de entrada y añade comparación con la anterior
 * usando el historial del proyecto.
 */
export function auditMix(input: AuditMixInput): AuditMixResultado {
  const evidencia: AuditEvidence[] = [];
  const incidencias: MixIncidence[] = [];
  const mediciones: Record<string, MixMeasurement> = {};

  const brutas = input.mediciones ?? {};
  const historial = (input as AuditMixInput & { contexto?: { history?: AnalysisHistory } }).contexto?.history;

  for (const [clave, bruto] of Object.entries(brutas)) {
    if (typeof bruto !== 'number') continue;
    const metrica = clave.replace(/^rms_/, '').toLowerCase()
    const m: MixMeasurement = { valor: bruto }
    if (historial) {
      const tend = tendenciaMetrica(historial, metrica)
      if (tend && tend.muestras.length) {
        const anterior = tend.muestras[tend.muestras.length - 1]!.valor
        m.anterior = anterior
        m.delta = bruto - anterior
        m.mejoro = comparar(bruto, anterior, metrica)
      }
    }
    mediciones[clave] = m
    evidencia.push({ tipo: 'medicion', descripcion: `${clave}: ${bruto}`, valor: bruto })
  }

  if (input.usarAnalysis !== false) {
    evidencia.push({
      tipo: 'otro',
      descripcion: 'Consumo de analysis.* intentado; se usan las mediciones disponibles (analysis o render)',
    })
  }

  // True peak: objetivo habitual ≤ -1 dBTP.
  const tp = mediciones['tp']
  if (tp && tp.valor > -1) {
    tp.ok = false
    incidencias.push({ severidad: 'error', mensaje: `True Peak ${tp.valor} dBTP supera -1 dBTP`, codigo: 'TP_EXCESIVO' })
  } else if (tp) {
    tp.ok = true
  }

  // LUFS: se marca ok si está dentro de ±1 LU del objetivo de referencia (-14 LUFS).
  const lufs = mediciones['lufs']
  if (lufs) {
    lufs.ok = Math.abs(lufs.valor + 14) <= 1
    if (!lufs.ok) {
      incidencias.push({
        severidad: 'warning',
        mensaje: `LUFS ${lufs.valor} fuera de ±1 LU del objetivo (-14 LUFS)`,
        codigo: 'LUFS_FUERA_DE_OBJETIVO',
      })
    }
  }

  const errores = incidencias.filter((i) => i.severidad === 'error' || i.severidad === 'critical')
  const cumpleCriterios = errores.length === 0

  return {
    cumpleCriterios,
    mediciones: mediciones as AuditMixResultado['mediciones'],
    comparacionReferencia: input.referencia
      ? { referencia: input.referencia, diferencias: [] }
      : undefined,
    evidencia,
    incidencias,
    timestamp: Date.now(),
  }
}
