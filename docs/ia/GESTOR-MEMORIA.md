# Gestor de Memoria

## 1. Propósito

El Gestor de Memoria almacena memorias estructuradas y consultables que la IA puede usar para personalizar interacciones. **No** es un registro de conversación. Las memorias son hechos destilados, preferencias y decisiones.

## 2. Tipos de Memoria

```typescript
type MemoryScope = 'shortTerm' | 'session' | 'longTerm' | 'project';
type MemorySource = 'user' | 'ai' | 'system';
type MemoryCategory = 'preference' | 'decision' | 'fact' | 'correction' | 'habit';
```

### Memoria de Corto Plazo
- **Alcance**: Turno actual de conversación.
- **Vida útil**: Se limpia después de cada ciclo de respuesta de la IA.
- **Caso de uso**: Contexto inmediato que no necesita persistir (ej: "el usuario está preguntando sobre el track vocal").
- **Almacenamiento**: Solo en memoria.

### Memoria de Sesión
- **Alcance**: Sesión actual de la aplicación.
- **Vida útil**: Desde el lanzamiento hasta el cierre de la app.
- **Caso de uso**: Decisiones tomadas durante esta sesión (ej: "el usuario quiere voces a -14 LUFS").
- **Almacenamiento**: En memoria + IndexedDB.

### Memoria de Largo Plazo
- **Alcance**: Nivel de usuario, en todos los proyectos.
- **Vida útil**: Persistente, con expiración y decaimiento.
- **Caso de uso**: Preferencias aprendidas (ej: "el usuario prefiere LA-2A para voces").
- **Almacenamiento**: IndexedDB o SQLite.

### Memoria de Proyecto
- **Alcance**: Proyecto específico.
- **Vida útil**: Hasta que el proyecto se elimine o la memoria se elimine explícitamente.
- **Caso de uso**: Decisiones específicas del proyecto (ej: "este proyecto usa 48kHz para diálogo").
- **Almacenamiento**: Almacenado en el archivo `.jaswave` del proyecto como metadata JSON.

## 3. Schema de Memoria

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  scope: MemoryScope;
  source: MemorySource;
  category: MemoryCategory;
  confidence: number; // 0.0 - 1.0
  relevance: number; // 0.0 - 1.0, dinámico
  timestamp: number;
  expiration?: number; // epoch ms, undefined = nunca expira
  tags: string[];
  relatedEntities?: string[]; // IDs de tracks, plugins, etc.
  supersedes?: string; // ID de memoria que esta reemplaza
  metadata: Record<string, unknown>;
}
```

### Campos de Metadata

| Campo | Descripción |
|-------|-------------|
| `timestamp` | Cuándo se creó la memoria. |
| `source` | Quién/quién la creó: `user`, `ai` o `system`. |
| `confidence` | Qué tan seguro estamos de que esta memoria es precisa. Mayor para declaraciones explícitas del usuario. |
| `relevance` | Qué tan relevante es esta memoria para el contexto actual. Computado dinámicamente. |
| `expiration` | Cuándo se debe reevaluar esta memoria. `null` = permanente. |
| `scope` | Dónde aplica esta memoria. |
| `supersedes` | Si esta memoria reemplaza a otra, vincular con la anterior. |

## 4. Ciclo de Vida de la Memoria

```
Creación → Validación → Almacenamiento → Recuperación → Decaimiento → Consolidación → Expiración
```

### Creación
Las memorias se crean explícitamente, no se infieren de logs:

```typescript
interface MemoryCreationRequest {
  content: string;
  source: MemorySource;
  category: MemoryCategory;
  scope: MemoryScope;
  confidence: number;
  tags?: string[];
  relatedEntities?: string[];
}
```

**Regla**: Los logs operacionales NUNCA se convierten automáticamente en memoria. Las memorias deben crearse mediante:
1. **Instrucción explícita del usuario**: "Recuerda que prefiero..."
2. **Inferencia de la IA con confirmación**: "Parece que prefieres X. ¿Debo recordar esto?"
3. **Observación sistemática de comportamiento consistente**: Después de N acciones consistentes, preguntar al usuario: "Noté que siempre haces X. ¿Recordar esto?"

### Validación
Las nuevas memorias se validan:
- Deduplicación: Verificar si ya existe una memoria similar.
- Resolución de conflictos: Si una nueva memoria contradice una existente, la de mayor confianza gana, o se pide al usuario que aclare.
- Verificación de cordura: El contenido debe ser no vacío, menor a 500 caracteres.

### Almacenamiento
```typescript
interface MemoryStore {
  create(entry: MemoryCreationRequest): Promise<MemoryEntry>;
  get(id: string): Promise<MemoryEntry | null>;
  list(filter: MemoryFilter): Promise<MemoryEntry[]>;
  update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry>;
  delete(id: string): Promise<void>;
  consolidate(): Promise<void>;
}

interface MemoryFilter {
  scope?: MemoryScope;
  category?: MemoryCategory;
  tags?: string[];
  minConfidence?: number;
  minRelevance?: number;
  relatedEntity?: string;
  limit?: number;
}
```

### Decaimiento
La relevancia decae con el tiempo:

```typescript
function decayRelevance(entry: MemoryEntry): number {
  const ageMs = Date.now() - entry.timestamp;
  const halfLifeMs = getHalfLife(entry.scope);
  const decay = Math.pow(0.5, ageMs / halfLifeMs);
  return entry.relevance * decay;
}

// Vidas medias:
// cortoPlazo: 0 (se limpia inmediatamente)
// sesion: 1 hora
// largoPlazo: 30 días
// proyecto: 7 días (después de cerrar el proyecto)
```

### Consolidación
Consolidación periódica (disparada al guardar proyecto o al cerrar sesión):
1. Fusionar memorias duplicadas (mismo contenido, mismo alcance).
2. Resumir grupos de memorias relacionadas.
3. Eliminar memorias expiradas.
4. Aumentar relevancia de memorias accedidas recientemente.

### Expiración
Las memorias con timestamps de `expiration` se reevaluan:
- **Preferencia de usuario**: Preguntar al usuario si la preferencia sigue vigente.
- **Específica de proyecto**: Eliminar cuando se cierra el proyecto (si el alcance es proyecto).

## 5. Memoria vs Log

| | Memoria | Log Operacional |
|---|---|---|
| **Contenido** | Hechos destilados, preferencias, decisiones | Eventos en bruto, comandos, errores |
| **Formato** | JSON estructurado con metadata | JSON estructurado con metadata |
| **Creación** | Explícita o inferida con consentimiento | Automática |
| **Vida útil** | Alcance + decaimiento | Retención configurable (ej: 90 días) |
| **Consumo por IA** | Sí, mediante Gestor de Contexto | No, a menos que se consulte explícitamente |
| **Tamaño** | Cientos de entradas | Millones de entradas |
| **Privacidad** | El usuario puede ver/editar/eliminar | El usuario puede ver/exportar/eliminar |

## 6. Acceso a Memoria desde el Gestor de Contexto

```typescript
interface MemoryManager {
  create(request: MemoryCreationRequest): Promise<MemoryEntry>;
  search(query: string, filter: MemoryFilter): Promise<MemoryEntry[]>;
  getRelevant(context: ImmediateContext, limit: number): Promise<MemoryEntry[]>;
  getAllForScope(scope: MemoryScope): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
  consolidate(): Promise<void>;
}
```

El Gestor de Contexto llama a `getRelevant()` para los Niveles 4 y 5.

## 7. Privacidad y Control

- El usuario tiene visibilidad completa de todas las memorias.
- El usuario puede eliminar cualquier memoria en cualquier momento.
- El usuario puede deshabilitar la recolección de memorias completamente (Modo Privacidad).
- En Modo Privacidad, solo se almacenan memorias de alcance proyecto; las memorias de alcance usuario se deshabilitan.
