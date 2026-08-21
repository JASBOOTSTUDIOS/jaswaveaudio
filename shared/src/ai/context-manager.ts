/**
 * Gestor de contexto de 5 niveles para el sistema de IA.
 *
 * Propósito:
 *   Ensamblar el contexto optimizado que se envía al proveedor de IA en cada
 *   turno, respetando presupuesto de tokens, comprimiendo información y
 *   manteniendo aislamiento entre turnos.
 *
 * Importancia:
 *   - Evita enviar prompts excesivos que degradan rendimiento y aumentan costo.
 *   - Preserva la información relevante del proyecto, eventos y memorias.
 *   - Aísla turnos para que el modelo no confunda estados de conversaciones previas.
 *
 * Función:
 *   Exporta crearGestorContexto, computeRelevance y helpers de compresión
 *   para construir ContextWindow, AssembledContext y ContextDebugView.
 */

import type {
  ContextWindow,
  ImmediateContext,
  ProjectContext,
  RecentEvent,
  MemoryEntry,
  PersistentMemoryEntry,
  ContextBudget,
  ContextDebugView,
  AssembledContext,
  ContextManagerConfig,
  TurnoConversacion,
  ToolParameterValue,
  ContextLevelMetrics,
} from '../types/contexto';
import type { ToolDefinition } from '../types/command';
import type { MemoryManager } from './memory-manager';
import { DEFAULT_CONTEXT_CONFIG, estimarTokens, clampRelevancia, aplicarDecayPorAntiguedad } from '../types/contexto';

interface ContextoEnsamblado {
  contextWindow: ContextWindow;
  toolDefinitions: ToolDefinition[];
  capabilitiesPrompt: string;
  debugView: ContextDebugView;
}

const DEFAULT_TOOL_TOKENS_OVERHEAD = 500;
const LEVEL1_APPROX_TOKENS = 200;
const LEVEL3_TOKENS_PER_EVENT = 10;
const LEVEL4_TOKENS_PER_ENTRY = 100;
const MAX_RECENT_TURNOS_POR_DEFECTO = 10;

function esReciente(evento: RecentEvent, recentEventMaxAgeMs: number, ahora: number): boolean {
  return ahora - evento.timestamp <= recentEventMaxAgeMs;
}

function filtrarEventosRecientes(eventos: RecentEvent[], recentEventMaxAgeMs: number, recentEventMaxCount: number): RecentEvent[] {
  const ahora = Date.now();
  const recientes = eventos.filter(e => esReciente(e, recentEventMaxAgeMs, ahora));
  const limitados = recientes.slice(-recentEventMaxCount);
  const descartados = eventos.length - limitados.length;
  if (descartados > 0) {
    const origen = recientes.length > 0 ? recientes.slice(0, recientes.length - limitados.length) : eventos;
    const digest = generarEventDigest(origen);
    return [{ nombre: 'event.digest', timestamp: ahora - recentEventMaxAgeMs, source: 'system', summary: digest }, ...limitados];
  }
  return limitados;
}

function generarEventDigest(eventos: RecentEvent[]): string {
  if (eventos.length === 0) return 'Sin eventos previos.';
  const nombres = eventos.map(e => e.summary || e.nombre);
  const unicos = Array.from(new Set(nombres)).slice(0, 20);
  return `${eventos.length} eventos ocurrieron: ${unicos.join(', ')}.`;
}

function comprimirMemoriasSesion(entradas: MemoryEntry[], limite = 20): MemoryEntry[] {
  if (entradas.length <= limite) return entradas;
  const fusionadas = fusionarMemoriasSimilares(entradas);
  const ordenadas = [...fusionadas].sort((a, b) => b.relevance - a.relevance);
  return ordenadas.slice(0, limite);
}

function fusionarMemoriasSimilares(entradas: MemoryEntry[]): MemoryEntry[] {
  const umbral = 0.7;
  const grupos: MemoryEntry[][] = [];

  for (const entrada of entradas) {
    let agrupada = false;
    for (const grupo of grupos) {
      const representante = grupo[0];
      const similitud = calcularSimilitud(entrada.content, representante.content);
      if (similitud >= umbral) {
        grupo.push(entrada);
        agrupada = true;
        break;
      }
    }
    if (!agrupada) {
      grupos.push([entrada]);
    }
  }

  return grupos.map(grupo => {
    if (grupo.length === 1) return grupo[0];
    const ganadora = grupo.reduce((mejor, candidata) => {
      const scoreMejor = mejor.confidence + (mejor.relevance ?? 0);
      const scoreCandidata = candidata.confidence + (candidata.relevance ?? 0);
      return scoreCandidata > scoreMejor ? candidata : mejor;
    });
    return { ...ganadora, content: `${ganadora.content} (consolidado desde ${grupo.length} entradas)` };
  });
}

function calcularSimilitud(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let interseccion = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) interseccion++;
  }
  return interseccion / Math.min(tokensA.size, tokensB.size);
}

function truncarProjectContext(proyecto: ProjectContext, eventosRecientes: RecentEvent[] = []): ProjectContext {
  const maxTracksResumen = 20;
  const nombresModificados = new Set(
    eventosRecientes
      .map(e => e.summary.toLowerCase())
      .join(' ')
      .split(/[^a-zA-Z0-9_]+/)
      .filter(token => token.startsWith('track'))
  );

  const modificados = proyecto.trackSummary.filter(t => nombresModificados.has(t.name.toLowerCase()) || nombresModificados.has(t.id.toLowerCase()));
  const sinModificar = proyecto.trackSummary.filter(t => !modificados.includes(t));
  const trackSummary = [
    ...modificados,
    ...sinModificar.slice(0, maxTracksResumen - modificados.length),
  ];

  return {
    ...proyecto,
    trackSummary,
  };
}

function podarHerramientas(
  herramientas: ToolDefinition[],
  eventos: RecentEvent[],
  presupuestoRestante: number,
  tokensHerramientasActuales: number,
): { herramientas: ToolDefinition[]; tokens: number; eliminadas: number } {
  if (herramientas.length === 0 || tokensHerramientasActuales <= presupuestoRestante) {
    return { herramientas, tokens: tokensHerramientasActuales, eliminadas: 0 };
  }

  const nombresRelevantes = new Set(
    eventos
      .map(e => e.summary.toLowerCase())
      .join(' ')
      .split(/[^a-zA-Z0-9_]+/)
      .filter(Boolean),
  );

  const riesgo = (h: ToolDefinition) => {
    if (h.risk === 'read') return 0;
    if (h.risk === 'write') return 1;
    return 2;
  };

  const puntuacion = (h: ToolDefinition) => {
    const mencionado = nombresRelevantes.has(h.type.toLowerCase());
    return (mencionado ? 1 : 0) - riesgo(h) * 0.5;
  };

  const ordenadas = [...herramientas].sort((a, b) => puntuacion(a) - puntuacion(b));
  const resultado: ToolDefinition[] = [];
  let tokensAcumulados = 0;
  let eliminadas = herramientas.length;

  for (const h of ordenadas) {
    const tokens = estimarTokens(JSON.stringify(h));
    if (tokensAcumulados + tokens <= presupuestoRestante) {
      resultado.push(h);
      tokensAcumulados += tokens;
    }
  }

  eliminadas = herramientas.length - resultado.length;
  return { herramientas: resultado, tokens: tokensAcumulados, eliminadas };
}

function estimarTokensProyecto(proyecto: ProjectContext): number {
  return estimarTokens(JSON.stringify(proyecto));
}

function estimarTokensEventos(eventos: RecentEvent[]): number {
  return eventos.reduce((total, e) => total + LEVEL3_TOKENS_PER_EVENT, 0);
}

function estimarTokensMemorias(entradas: MemoryEntry[]): number {
  return entradas.reduce((total, e) => total + LEVEL4_TOKENS_PER_ENTRY, 0);
}

export function computeRelevance(entry: MemoryEntry, context: ImmediateContext): number {
  let score = entry.confidence;

  if (context.selectedTrackId && entry.content.includes(context.selectedTrackId)) {
    score += 0.2;
  }

  const minutos = Math.max(0, (Date.now() - entry.timestamp) / (60 * 1000));
  score = score * Math.pow(0.99, minutos);

  if (context.scope && entry.scope === context.scope) {
    score += 0.1;
  }

  return clampRelevancia(score);
}

function calcularMetricasNivel(
  tokens: number,
  count: number,
  dropped: number,
): ContextLevelMetrics {
  return { tokens, count, dropped };
}

function comprimirPresupuestoMemorias(
  memoriasSesionOrdenadas: MemoryEntry[],
  memoriasPersistentesOrdenadas: MemoryEntry[],
  presupuestoNiveles: number,
  tokensMemoriasPersistentes: number,
  tokensMemoriasSesion: number,
  tokensProyecto: number,
  tokensEventos: number,
) {
  let tokensMemoriasPersistentesActual = tokensMemoriasPersistentes;
  let tokensMemoriasSesionActual = tokensMemoriasSesion;
  const memoriasPersistentesResultado = [...memoriasPersistentesOrdenadas];
  const memoriasSesionResultado = [...memoriasSesionOrdenadas];

  const tokensBase =
    LEVEL1_APPROX_TOKENS +
    tokensProyecto +
    tokensEventos;

  const excesoInicial = tokensBase + tokensMemoriasSesionActual + tokensMemoriasPersistentesActual - presupuestoNiveles;

  if (excesoInicial > 0 && tokensMemoriasPersistentesActual > 0) {
    const reducir = Math.min(tokensMemoriasPersistentesActual, excesoInicial);
    tokensMemoriasPersistentesActual = Math.max(0, tokensMemoriasPersistentesActual - reducir);
    const eliminar = Math.floor(reducir / LEVEL4_TOKENS_PER_ENTRY);
    if (eliminar > 0) {
      memoriasPersistentesResultado.splice(memoriasPersistentesResultado.length - eliminar, eliminar);
    }
  }

  const excesoSesion =
    tokensBase + tokensMemoriasSesionActual + tokensMemoriasPersistentesActual - presupuestoNiveles;

  if (excesoSesion > 0 && tokensMemoriasSesionActual > 0) {
    const reducir = Math.min(tokensMemoriasSesionActual, excesoSesion);
    tokensMemoriasSesionActual = Math.max(0, tokensMemoriasSesionActual - reducir);
    const eliminar = Math.floor(reducir / LEVEL4_TOKENS_PER_ENTRY);
    if (eliminar > 0) {
      memoriasSesionResultado.splice(memoriasSesionResultado.length - eliminar, eliminar);
    }
  }

  return {
    memoriasSesion: memoriasSesionResultado,
    memoriasPersistentes: memoriasPersistentesResultado,
    tokensMemoriasSesion: tokensMemoriasSesionActual,
    tokensMemoriasPersistentes: tokensMemoriasPersistentesActual,
  };
}

function ensamblar(
  inmediato: ImmediateContext,
  historialTurnos: TurnoConversacion[],
  proyecto: ProjectContext,
  eventos: RecentEvent[],
  memoriasSesion: MemoryEntry[],
  memoriasPersistentes: PersistentMemoryEntry[],
  herramientas: ToolDefinition[],
  maxContextTokens: number,
  recentEventMaxAgeMs: number,
  recentEventMaxCount: number,
  maxRecentTurnos: number,
  memoryManager?: MemoryManager,
): AssembledContext {
  const ahora = Date.now();
  const turnosRecientes = historialTurnos.slice(-maxRecentTurnos);
  const eventosFiltrados = filtrarEventosRecientes(eventos, recentEventMaxAgeMs, recentEventMaxCount);
  const proyectoTruncado = truncarProjectContext(proyecto, eventosFiltrados);

  const memoriasSesionBase = memoryManager ? memoryManager.getSession() : memoriasSesion;
  const memoriasPersistentesBase = memoryManager
    ? memoryManager.getForContext(inmediato.scope).persistent
    : memoriasPersistentes;

  const memoriasSesionOrdenadas = [...memoriasSesionBase]
    .map(m => ({ ...m, relevance: computeRelevance(m, inmediato) }))
    .sort((a, b) => b.relevance - a.relevance);

  const memoriasPersistentesFiltradas = memoriasPersistentesBase.filter(m => {
    if (m.scope === 'user') return true;
    return !!inmediato.scope && m.scope === inmediato.scope;
  });

  const memoriasPersistentesOrdenadas = [...memoriasPersistentesFiltradas]
    .map(m => ({ ...m, relevance: computeRelevance(m, inmediato) }))
    .sort((a, b) => b.relevance - a.relevance);

  const tokensProyecto = estimarTokensProyecto(proyectoTruncado);
  const tokensEventos = estimarTokensEventos(eventosFiltrados);
  const tokensMemoriasSesion = estimarTokensMemorias(memoriasSesionOrdenadas);
  const tokensMemoriasPersistentes = estimarTokensMemorias(memoriasPersistentesOrdenadas);

  const comprimidas = comprimirPresupuestoMemorias(
    memoriasSesionOrdenadas,
    memoriasPersistentesOrdenadas,
    maxContextTokens,
    tokensMemoriasPersistentes,
    tokensMemoriasSesion,
    tokensProyecto,
    tokensEventos,
  );

  const memoriasSesionFinal = comprimidas.memoriasSesion;
  const memoriasPersistentesFinal = comprimidas.memoriasPersistentes;
  const tokensMemoriasSesionFinal = comprimidas.tokensMemoriasSesion;
  const tokensMemoriasPersistentesFinal = comprimidas.tokensMemoriasPersistentes;

  const tokensNivelesFinal =
    LEVEL1_APPROX_TOKENS +
    tokensProyecto +
    tokensEventos +
    tokensMemoriasSesionFinal +
    tokensMemoriasPersistentesFinal;

  let tokensHerramientas = herramientas.reduce((total, h) => total + estimarTokens(JSON.stringify(h)), 0);
  let presupuestoDisponible = Math.max(0, maxContextTokens - tokensNivelesFinal);

  const podado = podarHerramientas(herramientas, eventosFiltrados, presupuestoDisponible, tokensHerramientas);
  tokensHerramientas = podado.tokens;
  const herramientasFinales = podado.herramientas;

  const tokenCount = tokensNivelesFinal + tokensHerramientas;

  const contextWindow: ContextWindow = {
    level1_immediate: inmediato,
    level2_project: proyectoTruncado,
    level3_recentEvents: eventosFiltrados,
    level4_sessionMemory: memoriasSesionFinal,
    level5_persistentMemory: memoriasPersistentesFinal,
  };

  const capabilitiesPrompt =
    'SYSTEM: Estás operando dentro de Jaswave DAW. Herramientas disponibles: ' +
    herramientasFinales.map(h => h.type).join(', ') +
    '. Hardware disponible: ninguno especificado.';

  const budget: ContextBudget = {
    maxTokens: maxContextTokens,
    level1Tokens: LEVEL1_APPROX_TOKENS,
    level2Tokens: tokensProyecto,
    level3Tokens: tokensEventos,
    level4Tokens: tokensMemoriasSesionFinal,
    level5Tokens: tokensMemoriasPersistentesFinal,
    toolsTokens: tokensHerramientas,
    capabilitiesTokens: 0,
  };

  const droppedItems =
    (eventos.length - eventosFiltrados.length) +
    (memoriasSesionBase.length - memoriasSesionFinal.length) +
    (memoriasPersistentesFiltradas.length - memoriasPersistentesFinal.length) +
    podado.eliminadas;

  const debugView: ContextDebugView = {
    tokenCount,
    budget,
    levels: {
      level1: calcularMetricasNivel(LEVEL1_APPROX_TOKENS, 1, 0),
      level2: calcularMetricasNivel(tokensProyecto, 1, 0),
      level3: calcularMetricasNivel(tokensEventos, eventosFiltrados.length, eventos.length - eventosFiltrados.length),
      level4: calcularMetricasNivel(tokensMemoriasSesionFinal, memoriasSesionFinal.length, memoriasSesionBase.length - memoriasSesionFinal.length),
      level5: calcularMetricasNivel(tokensMemoriasPersistentesFinal, memoriasPersistentesFinal.length, memoriasPersistentesFiltradas.length - memoriasPersistentesFinal.length),
      tools: calcularMetricasNivel(tokensHerramientas, herramientasFinales.length, podado.eliminadas),
      capabilities: calcularMetricasNivel(0, 0, 0),
    },
    droppedItems,
  };

  return {
    contextWindow,
    toolDefinitions: herramientasFinales,
    capabilitiesPrompt,
    debugView,
  };
}

export type { ContextManagerConfig } from '../types/contexto';
export function crearGestorContexto(config: ContextManagerConfig = {}) {
  const maxContextTokens = config.maxContextTokens ?? DEFAULT_CONTEXT_CONFIG.maxContextTokens;
  const recentEventMaxAgeMs = config.recentEventMaxAgeMs ?? DEFAULT_CONTEXT_CONFIG.recentEventMaxAgeMs;
  const recentEventMaxCount = config.recentEventMaxCount ?? DEFAULT_CONTEXT_CONFIG.recentEventMaxCount;
  const maxRecentTurnos = config.maxRecentTurnos ?? DEFAULT_CONTEXT_CONFIG.maxRecentTurnos;
  const herramientasDefinidas = config.toolDefinitions ?? [];

  return {
    ensamblarContexto(
      inmediato: ImmediateContext,
      historialTurnos: TurnoConversacion[],
      proyecto: ProjectContext,
      eventos: RecentEvent[],
      memoriasSesion: MemoryEntry[],
      memoriasPersistentes: PersistentMemoryEntry[],
      herramientas: ToolDefinition[],
    ): AssembledContext {
      return ensamblar(inmediato, historialTurnos, proyecto, eventos, memoriasSesion, memoriasPersistentes, herramientas, maxContextTokens, recentEventMaxAgeMs, recentEventMaxCount, maxRecentTurnos);
    },

    getDebugView(
      inmediato: ImmediateContext,
      historialTurnos: TurnoConversacion[],
      proyecto: ProjectContext,
      eventos: RecentEvent[],
      memoriasSesion: MemoryEntry[],
      memoriasPersistentes: PersistentMemoryEntry[],
      herramientas: ToolDefinition[],
    ): ContextDebugView {
      return ensamblar(inmediato, historialTurnos, proyecto, eventos, memoriasSesion, memoriasPersistentes, herramientas, maxContextTokens, recentEventMaxAgeMs, recentEventMaxCount, maxRecentTurnos).debugView;
    },
  };
}
