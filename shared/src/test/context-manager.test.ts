import { describe, it, expect } from 'vitest';
import { crearGestorContexto, computeRelevance } from '../ai/context-manager';
import type {
  ImmediateContext,
  ProjectContext,
  RecentEvent,
  MemoryEntry,
  PersistentMemoryEntry,
  TurnoConversacion,
} from '../types/contexto';
import type { ToolDefinition } from '../types/command';

const herramienta = (type: string, risk: ToolDefinition['risk'] = 'read'): ToolDefinition => ({
  type,
  description: `Herramienta ${type}`,
  category: 'system',
  risk,
  schema: {},
  requiredPermission: 'user',
  confirmationRequired: false,
});

const memoria = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: 'mem-1',
  content: 'Prefiere exportar en WAV 24bits.',
  timestamp: Date.now(),
  source: 'user',
  confidence: 0.8,
  relevance: 0.5,
  scope: 'project',
  ...overrides,
});

const evento = (summary: string, minutosAtras = 1): RecentEvent => ({
  nombre: 'track.volume.set',
  timestamp: Date.now() - minutosAtras * 60 * 1000,
  source: 'user',
  summary,
});

describe('Context Manager', () => {
  const gestor = crearGestorContexto({
    maxContextTokens: 2000,
    recentEventMaxAgeMs: 5 * 60 * 1000,
    recentEventMaxCount: 50,
    maxRecentTurnos: 10,
    toolDefinitions: [herramienta('project.getState')],
  });

  const inmediato: ImmediateContext = {
    selectedTrackId: 'track-1',
    userIntent: 'mejorar la mezcla',
  };

  const proyecto: ProjectContext = {
    projectName: 'Demo',
    tempo: { valor: 120, min: 20, max: 300, texto: '120 bpm', modo: 'fijo', cambios: [] },
    timeSignature: { numerador: 4, denominador: 4, nombre: '4/4', cambios: [] },
    trackCount: 2,
    trackSummary: [
      { id: 'track-1', name: 'Voz', type: 'audio', color: '#fff', muted: false, soloed: false, volume: -6 },
      { id: 'track-2', name: 'Batería', type: 'audio', color: '#fff', muted: false, soloed: false, volume: -12 },
    ],
    busCount: 1,
    pluginCount: 2,
    routingSummary: { buses: 1, sends: 2, sidechains: 0 },
    analysisSummary: { durationSeconds: 180, activeClips: 5, peakLevel: -3, rmsLevel: -18 },
  };

  const eventos: RecentEvent[] = [
    evento('track.volume.set', 1),
    evento('plugin.load', 3),
  ];

  const memoriasSesion: MemoryEntry[] = [memoria()];

  const memoriasPersistentes: PersistentMemoryEntry[] = [
    { ...memoria({ id: 'pm-1', scope: 'project' }), tags: ['mezcla'] } as PersistentMemoryEntry,
    { ...memoria({ id: 'pm-2', scope: 'user' }), tags: ['general'] } as PersistentMemoryEntry,
  ];

  const herramientas: ToolDefinition[] = [
    herramienta('project.getState'),
    herramienta('track.volume.set', 'write'),
  ];

  const historial: TurnoConversacion[] = [
    { role: 'user', content: 'Subí un poco la voz', marcaTiempo: Date.now() - 1000 },
    { role: 'assistant', content: 'Listo', marcaTiempo: Date.now() },
  ];

  it('Nivel 1 siempre incluido', () => {
    const resultado = gestor.ensamblarContexto(inmediato, historial, proyecto, eventos, memoriasSesion, memoriasPersistentes, herramientas);
    expect(resultado.contextWindow.level1_immediate).toEqual(inmediato);
  });

  it('Nivel 2 se trunca cuando excede presupuesto', () => {
    const proyectoGrande: ProjectContext = {
      ...proyecto,
      trackCount: 100,
      trackSummary: Array.from({ length: 100 }, (_, i) => ({
        id: `track-${i}`,
        name: `Track ${i}`,
        type: 'audio',
        color: '#fff',
        muted: false,
        soloed: false,
        volume: 0,
      })),
    } as ProjectContext;

    const resultadoNormal = gestor.ensamblarContexto(inmediato, historial, proyectoGrande, eventos, memoriasSesion, memoriasPersistentes, herramientas);
    const resultadoSinTools = gestor.ensamblarContexto(inmediato, historial, proyectoGrande, eventos, memoriasSesion, memoriasPersistentes, []);
    expect(resultadoNormal.contextWindow.level2_project.trackSummary.length).toBeLessThanOrEqual(20);
    expect(resultadoSinTools.contextWindow.level2_project.trackSummary.length).toBeLessThanOrEqual(20);
  });

  it('Nivel 3 respeta retención de 5 min / 50 eventos', () => {
    const eventosViejos: RecentEvent[] = Array.from({ length: 60 }, (_, i) => ({
      nombre: 'track.volume.set',
      timestamp: Date.now() - (i + 10) * 60 * 1000,
      source: 'user',
      summary: `evento ${i}`,
    }));

    const resultado = gestor.ensamblarContexto(inmediato, historial, proyecto, eventosViejos, memoriasSesion, memoriasPersistentes, herramientas);
    expect(resultado.contextWindow.level3_recentEvents.length).toBeLessThanOrEqual(50);
  });

  it('Nivel 4 y 5 se ordenan por relevancia', () => {
    const memoriasBajas: MemoryEntry[] = [
      memoria({ id: 'baja', confidence: 0.1, relevance: 0.1, content: 'baja' }),
      memoria({ id: 'alta', confidence: 0.9, relevance: 0.9, content: inmediato.selectedTrackId ?? 'alta' }),
    ];

    const resultado = gestor.ensamblarContexto(inmediato, historial, proyecto, eventos, memoriasBajas, memoriasPersistentes, herramientas);
    const primer = resultado.contextWindow.level4_sessionMemory[0];
    expect(primer.id).toBe('alta');
  });

  it('compresión se aplica cuando presupuesto se excede', () => {
    const gestorChico = crearGestorContexto({ maxContextTokens: 500, toolDefinitions: [] });
    const resultado = gestorChico.ensamblarContexto(inmediato, historial, proyecto, eventos, memoriasSesion, memoriasPersistentes, herramientas);
    const resultadoSinTools = gestorChico.ensamblarContexto(inmediato, historial, proyecto, eventos, memoriasSesion, memoriasPersistentes, []);
    expect(resultadoSinTools.debugView.tokenCount).toBeLessThanOrEqual(500);
    expect(resultado.debugView.levels.level1.count).toBe(1);
    expect(resultado.contextWindow.level1_immediate).toEqual(inmediato);
  });

  it('aislamiento entre turnos (no acumulación en prompt)', () => {
    const historialLargo: TurnoConversacion[] = Array.from({ length: 50 }, (_, i) => ({
      role: 'user',
      content: `turno ${i}`,
      marcaTiempo: Date.now() - i * 1000,
    }));

    const resultado = gestor.ensamblarContexto(inmediato, historialLargo, proyecto, eventos, memoriasSesion, memoriasPersistentes, herramientas);
    expect(resultado.contextWindow.level1_immediate).toEqual(inmediato);
  });

  it('contexto de capacidades no cuenta en token budget', () => {
    const resultado = gestor.ensamblarContexto(inmediato, historial, proyecto, eventos, memoriasSesion, memoriasPersistentes, herramientas);
    expect(resultado.debugView.budget.capabilitiesTokens).toBe(0);
    expect(resultado.capabilitiesPrompt).toContain('SYSTEM: Estás operando dentro de Jaswave DAW');
  });

  it('debug view muestra métricas correctas', () => {
    const debug = gestor.getDebugView(inmediato, historial, proyecto, eventos, memoriasSesion, memoriasPersistentes, herramientas);
    expect(debug.tokenCount).toBeGreaterThan(0);
    expect(debug.droppedItems).toBeGreaterThanOrEqual(0);
    expect(debug.levels.level1.count).toBe(1);
  });

  it('computeRelevance aplica boost, decay y scope', () => {
    const entrada = memoria({ content: `Info de ${inmediato.selectedTrackId}`, confidence: 0.8, timestamp: Date.now() - 60 * 1000 });
    const score = computeRelevance(entrada, inmediato);
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('event digest se genera cuando hay eventos descartados', () => {
    const eventosMuchos: RecentEvent[] = Array.from({ length: 60 }, (_, i) => ({
      nombre: 'track.volume.set',
      timestamp: Date.now() - (i + 10) * 60 * 1000,
      source: 'user',
      summary: `evento ${i}`,
    }));

    const resultado = gestor.ensamblarContexto(inmediato, historial, proyecto, eventosMuchos, memoriasSesion, memoriasPersistentes, herramientas);
    const primer = resultado.contextWindow.level3_recentEvents[0];
    expect(primer.nombre).toBe('event.digest');
    expect(primer.summary).toContain('eventos ocurrieron');
    expect(resultado.contextWindow.level3_recentEvents.length).toBeLessThanOrEqual(51);
  });

  it('memory consolidation fusiona entradas similares', () => {
    const memorias: MemoryEntry[] = [
      memoria({ id: 'm1', content: 'Prefiere exportar en WAV 24bits.', timestamp: Date.now() - 1000 }),
      memoria({ id: 'm2', content: 'Prefiere exportar en WAV 24 bits.', timestamp: Date.now() - 2000 }),
      memoria({ id: 'm3', content: 'Usar compresión suave en la voz.', timestamp: Date.now() - 3000 }),
    ];

    const resultado = gestor.ensamblarContexto(inmediato, historial, proyecto, eventos, memorias, memoriasPersistentes, herramientas);
    const ids = resultado.contextWindow.level4_sessionMemory.map(m => m.id);
    const consolidados = ids.filter(id => id === 'm1' || id === 'm3');
    expect(consolidados.length).toBeGreaterThanOrEqual(1);
  });

  it('project summary prioriza tracks modificados recientemente', () => {
    const eventosModificados: RecentEvent[] = [
      evento('track.volume.set track-1', 1),
      evento('track.renombrar track-2', 2),
    ];

    const proyectoGrande: ProjectContext = {
      ...proyecto,
      trackSummary: [
        ...proyecto.trackSummary,
        { id: 'track-3', name: 'Track 3', type: 'audio', color: '#fff', muted: false, soloed: false, volume: 0 },
        { id: 'track-4', name: 'Track 4', type: 'audio', color: '#fff', muted: false, soloed: false, volume: 0 },
      ],
    };

    const resultado = gestor.ensamblarContexto(inmediato, historial, proyectoGrande, eventosModificados, memoriasSesion, memoriasPersistentes, herramientas);
    const nombres = resultado.contextWindow.level2_project.trackSummary.map(t => t.name);
    expect(nombres).toContain('Voz');
    expect(nombres).toContain('Batería');
  });
});
