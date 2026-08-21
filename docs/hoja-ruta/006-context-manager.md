# Context Manager

## Objetivo
Implementar el ensamblado de contexto de 5 niveles para la IA, con presupuesto de tokens, compresión y aislamiento entre turnos. El Context Manager decide qué información es relevante enviar al modelo en cada interacción.

## Criterios de Aceptación
- [x] Niveles 1-5 implementados
- [x] Token budget respetado
- [x] Eventos recientes agregados correctamente
- [x] Compresión aplicada cuando se excede el presupuesto
- [x] Scoring de relevancia implementado
- [x] Aislamiento entre turnos garantizado

## Requerimientos Detallados

### 1. Los 5 Niveles de Contexto
Definir `ContextWindow` con:
- `level1_immediate: ImmediateContext`
- `level2_project: ProjectContext`
- `level3_recentEvents: RecentEvent[]`
- `level4_sessionMemory: MemoryEntry[]`
- `level5_persistentMemory: MemoryEntry[]`

#### Nivel 1 — Contexto Inmediato
- `selectedTrackId?: string`
- `selectedClipId?: string`
- `selectedPluginId?: string`
- `playheadPosition?: TimePosition`
- `userIntent?: string` — inferido del mensaje del usuario
- `recentToolCalls?: ToolCall[]` — últimas 3 llamadas en esta conversación
- `relevantParameters?: ParameterValue[]` — parámetros del plugin seleccionado
- **Siempre incluido**, approx 200 tokens.

#### Nivel 2 — Contexto del Proyecto
- `projectName: string`
- `tempo: BPM`
- `timeSignature: TimeSignature`
- `trackCount: number`
- `trackSummary: TrackSummary[]` — id, name, type, color, muted, soloed, volume (resumen ligero, no estado completo)
- `busCount: number`
- `pluginCount: number`
- `routingSummary: RoutingSummary`
- `analysisSummary: ProjectAnalysisSummary`
- Approx 500-1000 tokens.

#### Nivel 3 — Eventos Recientes
- `RecentEvent`: `name`, `timestamp`, `source`, `summary` (resumen legible por humanos)
- Retención: últimos 5 minutos o últimos 50 eventos, lo que ocurra primero.
- Eventos más antiguos de 5 minutos se resumen en un solo "event digest" antes de descartarse.
- Approx 10 tokens por evento.

#### Nivel 4 — Memoria de Sesión
- `MemoryEntry`: `id`, `content`, `timestamp`, `source ('user' | 'ai')`, `confidence (0-1)`, `relevance (0-1)`, `scope ('project' | 'session')`
- Retención: toda la sesión.
- Consolidación: entradas redundantes se fusionan; conflictos se resuelven por recencia y confianza.
- Approx 100 tokens por memoria.

#### Nivel 5 — Memoria Persistente
- `PersistentMemoryEntry` extiende `MemoryEntry`:
  - `scope: 'user' | 'project'`
  - `expiration?: number`
  - `tags: string[]`
- Retención: indefinida, con expiración y decaimiento.
- El usuario puede eliminar o corregir memorias explícitamente.

### 2. Algoritmo de Ensamblado
1. Determinar token budget según ventana de contexto del proveedor.
2. Incluir Nivel 1 siempre (~200 tokens).
3. Agregar resumen de Nivel 2 (~500-1000 tokens).
4. Agregar eventos de Nivel 3 hasta alcanzar presupuesto (~10 tokens por evento).
5. Agregar memorias de Nivel 4 ordenadas por relevancia (~100 tokens por memoria).
6. Agregar memorias de Nivel 5 ordenadas por relevancia hasta agotar presupuesto.
7. Si se excede el presupuesto:
   - Comprimir: resumir eventos antiguos, truncar memorias.
   - Eliminar ítems de menor relevancia de Niveles 3-5.
8. Agregar definiciones de herramientas (~500-2000 tokens, overhead fijo).
9. Si aún se excede, eliminar más ítems de menor relevancia.

### 3. Compresión Estrategias
- **Event Digest**: Nivel 3 > 50 eventos o > 5 min antiguos → resumir en "N eventos ocurrieron: track X creado, plugin Y cargado...".
- **Memory Consolidation**: Nivel 4 > 20 entradas → fusionar entradas similares, conservar mayor confianza.
- **Project Summary Truncation**: Nivel 2 > presupuesto → conservar solo tracks modificados en últimos 10 minutos + conteo total.
- **Tool Definition Pruning**: herramientas > presupuesto → eliminar herramientas de bajo riesgo y baja frecuencia; incluir solo relevantes a eventos recientes.

**Estado**: ✅ Completado

### 4. Scoring de Relevancia
- Implementar `computeRelevance(entry: MemoryEntry, context: ImmediateContext): number`:
  - Base: `entry.confidence`
  - Boost +0.2 si `entry.content` incluye `selectedTrackId`
  - Decay -1% por minuto de antigüedad
  - Boost +0.1 si `entry.scope` coincide con `context.scope`
  - Clamp entre 0 y 1

### 5. Aislamiento entre Turnos
- Cada turno de conversación recibe un ensamblado de contexto fresco.
- El contexto NO se acumula turno por turno en el prompt.
- Historial completo separado; solo los N turnos más recientes (típicamente 5-10) se inyectan en la ventana.
- Turnos antiguos se resumen o reemplazan por memoria de sesión.

### 6. Alcance Proyecto vs Usuario
- **Project-scoped memory**: activa solo cuando el proyecto específico está abierto.
- **User-scoped memory**: activa en todos los proyectos.
- El Context Manager respeta el proyecto activo al cargar memorias de Nivel 5.

### 7. Contexto de Capacidades
- El payload de capacidades se inyecta como instrucción de sistema (no cuenta en el presupuesto de tokens):
  - "SYSTEM: Estás operando dentro de Jaswave DAW. Herramientas disponibles: ... Hardware disponible: ..."
- Generado por CapabilityRegistry y ToolRegistry.

### 8. Context Debug View
- Exponer vista diagnóstica en Developer Tools:
  - `ContextDebugView`: tokenCount, budget, levels con tokens y counts, droppedItems.
- Esta vista NUNCA se envía al proveedor de IA.

### 9. Tests
- [x] Test: Nivel 1 siempre incluido
- [x] Test: Nivel 2 se trunca correctamente cuando excede presupuesto
- [x] Test: Nivel 3 respeta retención de 5 min / 50 eventos
- [x] Test: Nivel 4 y 5 se ordenan por relevancia
- [x] Test: compresión se aplica cuando presupuesto se excede
- [x] Test: aislamiento entre turnos (no acumulación en prompt)
- [x] Test: contexto de capacidades no cuenta en token budget
- [x] Test: debug view muestra métricas correctas

**Archivos**: `shared/src/test/context-manager.test.ts`
**Cobertura**: 8 tests unitarios cubriendo ensamblado, presupuesto, retención, relevancia, compresión, aislamiento, capacidades y debug view.

## Implementación Runtime

### 10. Tipos Base
- [x] `ContextWindow`, `ImmediateContext`, `ProjectContext`, `RecentEvent`, `MemoryEntry`, `PersistentMemoryEntry` en `shared/src/types/contexto.ts`
- [x] `ContextBudget`, `ContextDebugView`, `AssembledContext`, `ContextManagerConfig`, `TurnoConversacion`

### 11. Gestor de Contexto
- [x] `crearGestorContexto()` en `shared/src/ai/context-manager.ts` con `ensamblarContexto()` y `getDebugView()`
- [x] Filtrado de eventos recientes por edad y cantidad máxima
- [x] Truncado de `trackSummary` a 20 tracks máximo
- [x] Ordenamiento de memorias por relevancia calculada
- [x] Compresión de memorias de sesión cuando excede límite de 20 entradas
- [x] Pruning de herramientas por riesgo y relevancia contextual

### 12. Scoring de Relevancia
- [x] `computeRelevance()` implementada con:
  - Base: `entry.confidence`
  - Boost +0.2 si `entry.content` incluye `selectedTrackId`
  - Decay -1% por minuto de antigüedad
  - Boost +0.1 si `entry.scope` coincide con `context.scope`
  - Clamp entre 0 y 1

### 13. Capacidades
- [x] `capabilitiesPrompt` generado sin contar en presupuesto de tokens
- [x] `capabilitiesTokens: 0` en `ContextBudget`

## Dependencias
- AI Provider
- Event Bus
- Query API
- Memory Manager

## Documentación Relacionada
- `docs/ia/GESTOR-CONTEXTO.md`
- `docs/arquitectura/VISION-GENERAL.md`
- `docs/00-RESUMEN-ARQUITECTURA.md`
