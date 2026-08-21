/**
 * Tipos del Context Manager.
 *
 * Propósito:
 *   Definir los contratos de datos para el ensamblado de contexto de 5 niveles
 *   que se envía a los proveedores de IA en cada turno.
 *
 * Importancia:
 *   - Centraliza la representación del contexto inmediato, proyecto, eventos,
 *     memorias y presupuestos.
 *   - Permite mantener el presupuesto de tokens y la depuración de forma
 *     type-safe.
 *
 * Función:
 *   Exporta interfaces de niveles de contexto, entradas de memoria,
 *   presupuesto, vista de debug y helpers de presupuesto/relevancia.
 */

import type { EventoDominio, ValorJSON } from '../events/evento-dominio';
import type { BPM, TimePosition, TimeSignature } from './tiempo';
import type { ToolCall } from './ia';
import type { ToolDefinition } from './command';

export interface ToolParameterValue {
  parametro: string;
  valor: ValorJSON;
}

export interface ContextWindow {
  level1_immediate: ImmediateContext;
  level2_project: ProjectContext;
  level3_recentEvents: RecentEvent[];
  level4_sessionMemory: MemoryEntry[];
  level5_persistentMemory: MemoryEntry[];
}

export interface ImmediateContext {
  selectedTrackId?: string;
  selectedClipId?: string;
  selectedPluginId?: string;
  playheadPosition?: TimePosition;
  userIntent?: string;
  recentToolCalls?: ToolCall[];
  relevantParameters?: ToolParameterValue[];
  scope?: 'project' | 'session';
}

export interface TrackSummary {
  id: string;
  name: string;
  type: string;
  color: string;
  muted: boolean;
  soloed: boolean;
  volume: number;
}

export interface RoutingSummary {
  buses: number;
  sends: number;
  sidechains: number;
}

export interface ProjectAnalysisSummary {
  durationSeconds: number;
  activeClips: number;
  peakLevel?: number;
  rmsLevel?: number;
}

export interface ProjectContext {
  projectName: string;
  tempo: BPM;
  timeSignature: TimeSignature;
  trackCount: number;
  trackSummary: TrackSummary[];
  busCount: number;
  pluginCount: number;
  routingSummary: RoutingSummary;
  analysisSummary: ProjectAnalysisSummary;
}

export interface RecentEvent {
  nombre: string;
  timestamp: number;
  source: string;
  summary: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  source: 'user' | 'ai';
  confidence: number;
  relevance: number;
  scope: 'project' | 'session' | 'user';
}

export interface PersistentMemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  source: 'user' | 'ai';
  confidence: number;
  relevance: number;
  scope: 'project' | 'user';
  expiration?: number;
  tags: string[];
}

export interface ContextBudget {
  maxTokens: number;
  level1Tokens: number;
  level2Tokens: number;
  level3Tokens: number;
  level4Tokens: number;
  level5Tokens: number;
  toolsTokens: number;
  capabilitiesTokens: number;
}

export interface ContextLevelMetrics {
  tokens: number;
  count: number;
  dropped: number;
}

export interface ContextDebugView {
  tokenCount: number;
  budget: ContextBudget;
  levels: {
    level1: ContextLevelMetrics;
    level2: ContextLevelMetrics;
    level3: ContextLevelMetrics;
    level4: ContextLevelMetrics;
    level5: ContextLevelMetrics;
    tools: ContextLevelMetrics;
    capabilities: ContextLevelMetrics;
  };
  droppedItems: number;
}

export interface AssembledContext {
  contextWindow: ContextWindow;
  toolDefinitions: ToolDefinition[];
  capabilitiesPrompt: string;
  debugView: ContextDebugView;
}

export interface ContextManagerConfig {
  maxContextTokens?: number;
  recentEventMaxAgeMs?: number;
  recentEventMaxCount?: number;
  maxRecentTurnos?: number;
  toolDefinitions?: ToolDefinition[];
}

export interface TurnoConversacion {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  marcaTiempo: number;
}

export const DEFAULT_CONTEXT_CONFIG: Required<ContextManagerConfig> = {
  maxContextTokens: 8192,
  recentEventMaxAgeMs: 5 * 60 * 1000,
  recentEventMaxCount: 50,
  maxRecentTurnos: 10,
  toolDefinitions: [],
};

export function estimarTokens(texto: string): number {
  if (!texto) return 0;
  const chars = texto.length;
  const tokens = Math.floor((chars / 3) + 1);
  return Math.max(1, tokens);
}

export function clampRelevancia(valor: number): number {
  if (Number.isNaN(valor)) return 0;
  if (valor < 0) return 0;
  if (valor > 1) return 1;
  return valor;
}

export function aplicarDecayPorAntiguedad(base: number, marcaTiempo: number): number {
  const minutos = Math.max(0, (Date.now() - marcaTiempo) / (60 * 1000));
  return Math.max(0, base * Math.pow(0.99, minutos));
}
