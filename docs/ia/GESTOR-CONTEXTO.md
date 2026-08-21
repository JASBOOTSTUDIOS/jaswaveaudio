# Gestor de Contexto

## 1. Propósito

El Gestor de Contexto ensambla el conjunto óptimo de información para enviar al proveedor de IA en cada interacción. Balancea completitud, relevancia y presupuesto de tokens.

## 2. Los 5 Niveles

```typescript
interface ContextWindow {
  level1_immediate: ImmediateContext;
  level2_project: ProjectContext;
  level3_recentEvents: RecentEvent[];
  level4_sessionMemory: MemoryEntry[];
  level5_persistentMemory: MemoryEntry[];
}
```

### Nivel 1 — Contexto Inmediato
Información directamente relevante para la interacción actual.

```typescript
interface ImmediateContext {
  selectedTrackId?: string;
  selectedClipId?: string;
  selectedPluginId?: string;
  playheadPosition?: TimePosition;
  userIntent?: string; // inferido del mensaje
  recentToolCalls?: ToolCall[]; // últimas 3 llamadas de herramientas en esta conversación
  relevantParameters?: ParameterValue[]; // parámetros del plugin seleccionado, si existe
}
```

### Nivel 2 — Contexto del Proyecto
Información estructural sobre el proyecto.

```typescript
interface ProjectContext {
  projectName: string;
  tempo: BPM;
  timeSignature: TimeSignature;
  trackCount: number;
  trackSummary: TrackSummary[]; // id, nombre, tipo, color, muted, soloed, volumen
  busCount: number;
  pluginCount: number;
  routingSummary: RoutingSummary;
  analysisSummary: ProjectAnalysisSummary;
}
```

**Nota**: `trackSummary` es un resumen ligero, no el estado completo del track. Los detalles completos del track se obtienen mediante `track.get` bajo demanda.

### Nivel 3 — Eventos Recientes
Cambios de estado recientes, truncados por tiempo y cantidad.

```typescript
interface RecentEvent {
  name: string;
  timestamp: number;
  source: string;
  summary: string; // resumen legible por humanos para la IA
}
```

- Retención: últimos 5 minutos o últimos 50 eventos, lo que ocurra primero.
- Los eventos más antiguos de 5 minutos se resumen en un solo "resumen de eventos" antes de descartarse.

### Nivel 4 — Memoria de Sesión
Decisiones y preferencias establecidas durante la sesión actual.

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  source: 'user' | 'ai';
  confidence: number; // 0-1
  relevance: number; // 0-1, decae con el tiempo
  scope: 'project' | 'session';
}
```

- Retención: toda la sesión.
- Consolidación: las entradas redundantes se fusionan. Los conflictos se resuelven por recencia y confianza.

### Nivel 5 — Memoria Persistente
Preferencias y comportamientos aprendidos a largo plazo.

```typescript
interface PersistentMemoryEntry extends MemoryEntry {
  scope: 'user' | 'project';
  expiration?: number; // timestamp, después del cual se reevalúa la memoria
  tags: string[];
}
```

- Retención: indefinida, con expiración y decaimiento.
- El usuario puede eliminar o corregir memorias explícitamente.

## 3. Algoritmo de Ensamblado de Contexto

```
1. Determinar presupuesto de tokens (según ventana de contexto del proveedor).
2. Empezar con Nivel 1 (siempre incluido, ~200 tokens).
3. Agregar resumen de Nivel 2 (~500-1000 tokens).
4. Agregar eventos de Nivel 3 hasta alcanzar el presupuesto de tokens (~10 tokens por evento).
5. Agregar memorias de Nivel 4 ordenadas por relevancia (~100 tokens por memoria).
6. Agregar memorias de Nivel 5 ordenadas por relevancia hasta agotar el presupuesto.
7. Si se excede el presupuesto, comprimir: resumir eventos antiguos, truncar memorias.
8. Agregar definiciones de herramientas (~500-2000 tokens, overhead fijo).
9. Si aún se excede, eliminar elementos de menor relevancia de Niveles 3-5.
```

## 4. Estrategias de Compresión

| Estrategia | Cuándo se Aplica | Resultado |
|------------|------------------|-----------|
| **Resumen de Eventos** | Nivel 3 > 50 eventos o > 5 min antiguos | Resumir en "ocurrieron N eventos: track X creado, plugin Y cargado..." |
| **Consolidación de Memorias** | Nivel 4 > 20 entradas | Fusionar entradas similares, conservar mayor confianza |
| **Truncamiento de Resumen de Proyecto** | Nivel 2 > presupuesto de tokens | Conservar solo tracks modificados en los últimos 10 minutos + conteo total |
| **Poda de Definiciones de Herramientas** | Herramientas > presupuesto | Eliminar herramientas de bajo riesgo y baja frecuencia; incluir solo herramientas relevantes a eventos recientes |

## 5. Puntuación de Relevancia

```typescript
function computeRelevance(entry: MemoryEntry, context: ImmediateContext): number {
  let score = entry.confidence;
  
  // Aumentar si está relacionado con el track seleccionado
  if (entry.content.includes(context.selectedTrackId ?? '')) score += 0.2;
  
  // Aumentar si es reciente
  const ageMs = Date.now() - entry.timestamp;
  const ageMinutes = ageMs / 60000;
  score -= ageMinutes * 0.01; // decaer 1% por minuto
  
  // Aumentar si el alcance coincide
  if (entry.scope === context.scope) score += 0.1;
  
  return Math.max(0, Math.min(1, score));
}
```

## 6. Aislamiento de Contexto Entre Turnos

Cada turno de conversación recibe un ensamblado de contexto fresco. El contexto **no** se acumula turno por turno en el prompt. En su lugar:
- El historial completo de conversación se mantiene separado.
- Solo los N turnos más recientes se inyectan en la ventana de contexto (típicamente 5-10).
- Los turnos antiguos se resumen o reemplazan por memoria de sesión.

## 7. Alcance de Proyecto vs Usuario

- **Memoria de alcance proyecto**: Solo activa cuando el proyecto específico está abierto.
- **Memoria de alcance usuario**: Activa en todos los proyectos.

El Gestor de Contexto respeta el proyecto activo al cargar memorias de Nivel 5.

## 8. Contexto Especial: Capacidades

El payload de capacidades se inyecta como una **instrucción de sistema** (no en el conteo de la ventana de contexto):

```
SYSTEM: Estás operando dentro de Jaswave DAW. Herramientas disponibles:
- project.getState
- track.create
- track.volume.set
- ...
Hardware disponible: 2 entradas, 2 salidas, 44.1kHz.
```

Esto lo genera el Registro de Capacidades y el Registro de Herramientas.

## 9. Depuración de Contexto

Para depuración, el Gestor de Contexto expone una vista diagnóstica:

```typescript
interface ContextDebugView {
  tokenCount: number;
  budget: number;
  levels: {
    level1: { tokens: number; included: boolean };
    level2: { tokens: number; included: boolean };
    level3: { tokens: number; count: number };
    level4: { tokens: number; count: number };
    level5: { tokens: number; count: number };
    tools: { tokens: number; count: number };
  };
  droppedItems: ContextItem[];
}
```

Esta vista es accesible desde el panel de Developer Tools. Nunca se envía al proveedor de IA.
