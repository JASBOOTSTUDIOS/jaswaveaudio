/**
 * Historial de auditorías A9 - audit.history
 */

import type { AuditHistorialEntrada } from './schemas';

const historial: AuditHistorialEntrada[] = [];

export function registrarAuditHistorial(entrada: Omit<AuditHistorialEntrada, 'id' | 'timestamp'> & Partial<Pick<AuditHistorialEntrada, 'id' | 'timestamp'>>): AuditHistorialEntrada {
  const e: AuditHistorialEntrada = {
    id: entrada.id ?? `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entrada.timestamp ?? Date.now(),
    tipo: entrada.tipo,
    runId: entrada.runId,
    planId: entrada.planId,
    proyectoId: entrada.proyectoId,
    resumen: entrada.resumen,
    cumple: entrada.cumple,
    evidenciaCount: entrada.evidenciaCount,
    datos: entrada.datos,
  };
  historial.push(e);
  return e;
}

export function listarAuditHistorial(filtro?: { runId?: string; planId?: string; tipo?: AuditHistorialEntrada['tipo']; limit?: number }): AuditHistorialEntrada[] {
  let res = [...historial];
  if (filtro?.runId) res = res.filter((e) => e.runId === filtro.runId);
  if (filtro?.planId) res = res.filter((e) => e.planId === filtro.planId);
  if (filtro?.tipo) res = res.filter((e) => e.tipo === filtro.tipo);
  res.sort((a, b) => b.timestamp - a.timestamp);
  if (filtro?.limit && filtro.limit > 0) res = res.slice(0, filtro.limit);
  return res;
}

export function limpiarAuditHistorial(): void {
  historial.length = 0;
}
