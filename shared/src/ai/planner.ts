/**
 * Planner — convierte acciones IA en planes de ejecución estructurados (027-planner).
 */

import type { RiskLevel } from '../types/command';
import type { SemanticStateDiff } from '../state/diff-estado';

export type PlanStepKind = 'tool' | 'clarification' | 'confirmation';

export type ToolCallStep = {
  kind: 'tool';
  type: string;
  payload: Record<string, unknown>;
  risk: RiskLevel;
};

export type ClarificationStep = {
  kind: 'clarification';
  question: string;
};

export type ConfirmationStep = {
  kind: 'confirmation';
  summary: string;
  previewDiff?: SemanticStateDiff;
};

export type PlanStep = ToolCallStep | ClarificationStep | ConfirmationStep;

export type ExecutionPlan = {
  steps: PlanStep[];
  requiresConfirmation: boolean;
  estimatedRisk: RiskLevel;
  summary: string;
};

const DESTRUCTIVE = new Set([
  'track.delete',
  'clip.delete',
  'project.clear',
  'plugin.remove',
  'render.start',
  'daw.masterPass',
]);

const HIGH_RISK = new Set(['daw.musicBuild', 'sidechain.connect', 'bus.create', 'track.freeze']);

function riskForAction(type: string): RiskLevel {
  if (DESTRUCTIVE.has(type)) return 'dangerous';
  if (HIGH_RISK.has(type)) return 'write';
  if (type.startsWith('analysis.') || type.startsWith('doc.') || type.startsWith('plugin.lookup')) return 'read';
  return 'write';
}

export function planFromActions(
  actions: Array<{ type: string; payload?: Record<string, unknown> }>,
  opts?: { previewDiff?: SemanticStateDiff },
): ExecutionPlan {
  const steps: PlanStep[] = actions.map((a) => ({
    kind: 'tool' as const,
    type: a.type,
    payload: a.payload ?? {},
    risk: riskForAction(a.type),
  }));

  let estimatedRisk: RiskLevel = 'read';
  for (const s of steps) {
    if (s.kind !== 'tool') continue;
    if (s.risk === 'dangerous') {
      estimatedRisk = 'dangerous';
      break;
    }
    if (s.risk === 'write' && estimatedRisk === 'read') estimatedRisk = 'write';
  }

  const requiresConfirmation = estimatedRisk === 'dangerous';
  if (requiresConfirmation && opts?.previewDiff) {
    steps.push({
      kind: 'confirmation',
      summary: `Confirmar ${steps.length} acción(es) (${estimatedRisk})`,
      previewDiff: opts.previewDiff,
    });
  }

  const summary =
    steps.length === 0
      ? 'Sin acciones'
      : `${steps.filter((s) => s.kind === 'tool').length} paso(s): ${steps
          .filter((s): s is ToolCallStep => s.kind === 'tool')
          .slice(0, 3)
          .map((s) => s.type)
          .join(', ')}${steps.length > 3 ? '…' : ''}`;

  return { steps, requiresConfirmation, estimatedRisk, summary };
}

export function extractToolSteps(plan: ExecutionPlan): ToolCallStep[] {
  return plan.steps.filter((s): s is ToolCallStep => s.kind === 'tool');
}
