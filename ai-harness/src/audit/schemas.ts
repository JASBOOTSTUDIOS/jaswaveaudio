/**
 * Esquemas y tipos para auditoría A9.
 * Mutaciones solo vía Command/Tool Registry. Datos externos envueltos con untrusted.
 */

import type { MeasurableMetric } from '../plan/criteria';

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

export type AuditEvidence = {
  tipo: 'medicion' | 'snapshot' | 'log' | 'diff' | 'archivo' | 'otro';
  descripcion: string;
  valor?: unknown;
  unidad?: string;
};

export type AuditStepInput = {
  runId: string;
  planId?: string;
  stepId: string;
  fase?: string;
  agente?: string;
  titulo?: string;
  criterios?: string[];
  mediciones?: Record<string, number | string | boolean>;
  contexto?: Record<string, unknown>;
};

export type AuditStepResultado = {
  cumple: boolean;
  criterios: Array<{
    criterio: string;
    cumple: boolean;
    diff?: number;
    evidencia: string[];
  }>;
  evidencia: AuditEvidence[];
  incidencias: Array<{ severidad: AuditSeverity; mensaje: string; codigo?: string }>;
  timestamp: number;
};

export type AuditProjectInput = {
  runId: string;
  planId?: string;
  proyectoId?: string;
  objetivos?: string[];
  medicionesGlobales?: Record<string, number | string | boolean>;
  incluirMix?: boolean;
};

export type AuditProjectResultado = {
  limpio: boolean;
  cumplidos: number;
  fallidos: number;
  items: Array<{
    id: string;
    tipo: 'step' | 'mix' | 'global' | 'integracion';
    titulo: string;
    cumple: boolean;
    evidencia: AuditEvidence[];
    incidencias: Array<{ severidad: AuditSeverity; mensaje: string; codigo?: string }>;
  }>;
  incidenciasAceptadas?: Array<{ id: string; motivo: string; aceptadoPor: string; timestamp: number }>;
  evidencia: AuditEvidence[];
  timestamp: number;
};

export type AuditMixInput = {
  runId: string;
  planId?: string;
  proyectoId?: string;
  usarAnalysis?: boolean;
  mediciones?: Record<string, number | string | boolean>;
  referencia?: string;
};

export type AuditMixResultado = {
  cumpleCriterios: boolean;
  mediciones: Record<string, number | { valor: number; unidad?: string; ok?: boolean }>;
  comparacionReferencia?: { referencia: string; diferencias: Array<{ metric: MeasurableMetric | string; diff: number; unidad?: string; ok: boolean }> };
  evidencia: AuditEvidence[];
  incidencias: Array<{ severidad: AuditSeverity; mensaje: string; codigo?: string }>;
  timestamp: number;
};

export type AuditHistorialEntrada = {
  id: string;
  tipo: 'step' | 'project' | 'mix' | 'diff' | 'session';
  runId: string;
  planId?: string;
  proyectoId?: string;
  resumen: string;
  cumple?: boolean;
  evidenciaCount: number;
  timestamp: number;
  datos?: Record<string, unknown>;
};

export type SessionSummary = {
  runId: string;
  planId?: string;
  proyectoId?: string;
  duracionMs?: number;
  pasosCompletados: number;
  pasosFallidos: number;
  herramientasUsadas: Array<{ nombre: string; count: number }>;
  cambios: import('@jaswave/shared').SemanticStateDiff | Record<string, unknown>;
  auditorias: { steps: number; project?: boolean; mix?: boolean };
  incidenciasAbiertas: number;
  resumen: string;
  timestamp: number;
};
