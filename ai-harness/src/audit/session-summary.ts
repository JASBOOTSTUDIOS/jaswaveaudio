/**
 * Resumen de sesión A9 - session.summary
 */

import type { SessionSummary } from './schemas';
import { listarAuditHistorial } from './history';

export function generarSessionSummary(params: {
  runId: string;
  planId?: string;
  proyectoId?: string;
  herramientasUsadas?: Array<{ nombre: string; count: number }>;
  cambios?: Record<string, unknown>;
  pasosCompletados?: number;
  pasosFallidos?: number;
  duracionMs?: number;
}): SessionSummary {
  const hist = listarAuditHistorial({ runId: params.runId, limit: 50 });
  const pasosCompletados = params.pasosCompletados ?? 0;
  const pasosFallidos = params.pasosFallidos ?? 0;
  const herramientasUsadas = params.herramientasUsadas ?? [];
  const auditorias = {
    steps: hist.filter((h) => h.tipo === 'step').length,
    project: hist.some((h) => h.tipo === 'project'),
    mix: hist.some((h) => h.tipo === 'mix'),
  };
  const incidenciasAbiertas = hist.filter((h) => h.cumple === false).length;

  const resumen = `Sesión ${params.runId}: ${pasosCompletados} pasos completados, ${pasosFallidos} fallidos, ${herramientasUsadas.length} herramientas, ${auditorias.steps} auditorías.`;

  return {
    runId: params.runId,
    planId: params.planId,
    proyectoId: params.proyectoId,
    duracionMs: params.duracionMs,
    pasosCompletados,
    pasosFallidos,
    herramientasUsadas,
    cambios: params.cambios ?? {},
    auditorias,
    incidenciasAbiertas,
    resumen,
    timestamp: Date.now(),
  };
}
