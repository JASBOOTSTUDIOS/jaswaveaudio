/**
 * Auditoría de paso (A9) - audit.step
 */

import { evaluateNumericCriterion, parseCriteria, type Criterion, type BooleanCriterion } from '../plan/criteria';
import type { AuditStepInput, AuditStepResultado, AuditEvidence } from './schemas';

function isBooleanCriterion(c: Criterion): c is BooleanCriterion {
  return c.metric === 'masking';
}

export function auditStep(input: AuditStepInput): AuditStepResultado {
  const criteriosTexto = input.criterios ?? [];
  const mediciones = input.mediciones ?? {};
  const evidencia: AuditEvidence[] = [];
  const resultados: AuditStepResultado['criterios'] = [];
  const incidencias: AuditStepResultado['incidencias'] = [];

  for (const ct of criteriosTexto) {
    const parsed = parseCriteria(ct);
    if (parsed.length === 0) {
      resultados.push({ criterio: ct, cumple: false, evidencia: ['No se pudo parsear criterio medible'] });
      incidencias.push({ severidad: 'warning', mensaje: `Criterio no parseable: ${ct}`, codigo: 'CRITERIO_NO_PARSEABLE' });
      evidencia.push({ tipo: 'otro', descripcion: `Criterio sin parsear: ${ct}` });
      continue;
    }

    for (const c of parsed) {
      if (isBooleanCriterion(c)) {
        // Para masking requerimos medición explícita o asumir ok si no hay evidencia de violación
        const val = mediciones['masking'];
        const cumple = typeof val === 'boolean' ? val === c.requires : true; // sin medición -> no falla por defecto pero se registra evidencia
        resultados.push({ criterio: ct, cumple, evidencia: [`masking: ${cumple ? 'ok' : 'violación detectada'}`] });
        evidencia.push({ tipo: 'medicion', descripcion: c.description, valor: val });
        if (!cumple) incidencias.push({ severidad: 'error', mensaje: c.description, codigo: 'MASKING_VIOLACION' });
        continue;
      }

      // numérico
      let measured: number | undefined;
      if (c.metric === 'lufs' && typeof mediciones.lufs === 'number') measured = mediciones.lufs;
      else if (c.metric === 'tp' && (typeof mediciones.tp === 'number' || typeof mediciones.truePeak === 'number')) measured = (mediciones.tp as number) ?? (mediciones.truePeak as number);
      else if (c.metric === 'rms') {
        if (c.track && typeof mediciones[`rms_${c.track}`] === 'number') measured = mediciones[`rms_${c.track}`] as number;
        else if (typeof mediciones.rms === 'number') measured = mediciones.rms as number;
      } else if (typeof mediciones[c.metric] === 'number') measured = mediciones[c.metric] as number;

      if (typeof measured !== 'number') {
        resultados.push({ criterio: ct, cumple: false, evidencia: ['Medición no disponible para criterio'] });
        incidencias.push({ severidad: 'error', mensaje: `Falta medición para ${c.metric}`, codigo: 'MEDICION_FALTANTE' });
        evidencia.push({ tipo: 'medicion', descripcion: `Sin dato para ${c.metric}`, unidad: c.unit });
        continue;
      }

      const res = evaluateNumericCriterion(c, measured);
      resultados.push({ criterio: ct, cumple: res.cumple, diff: res.diff, evidencia: res.evidencia });
      for (const e of res.evidencia) evidencia.push({ tipo: 'medicion', descripcion: e, valor: measured, unidad: c.unit });
      if (!res.cumple) incidencias.push({ severidad: 'error', mensaje: `Criterio no cumplido: ${ct}`, codigo: 'CRITERIO_FALLIDO' });
    }
  }

  const cumple = resultados.length > 0 && resultados.every((r) => r.cumple);
  if (resultados.length === 0) {
    // Sin criterios medibles: requiere evidencia explícita? No forzar fallo, pero registrar
    evidencia.push({ tipo: 'otro', descripcion: 'Sin criterios medibles parseados' });
  }

  return {
    cumple,
    criterios: resultados,
    evidencia,
    incidencias,
    timestamp: Date.now(),
  };
}
