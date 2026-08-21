# Context Manager Avanzado

## Objetivo
Implementar los niveles 4 y 5 del Context Manager: memoria de sesión y memoria persistente. La IA debe recordar preferencias y decisiones del usuario a lo largo del tiempo.

## Criterios de Aceptación
- [ ] Niveles 4-5 implementados
- [ ] La IA recuerda preferencias y decisiones
- [ ] Consolidación y decaimiento funcionan
- [ ] Privacidad respetada

## Requerimientos Detallados

### 1. Memoria de Sesión (Nivel 4)
- Alcance: sesión actual de la aplicación.
- Vida útil: desde lanzamiento hasta cierre.
- Contenido:
  - Decisiones tomadas durante la sesión.
  - Preferencias expresadas por el usuario.
  - Acciones realizadas por la IA.
- Retención: toda la sesión.
- Consolidación: entradas redundantes se fusionan; conflictos por recencia y confianza.

### 2. Memoria Persistente (Nivel 5)
- Alcance: usuario o proyecto.
- Vida útil: indefinida con expiración y decaimiento.
- Contenido:
  - Preferencias aprendidas del usuario.
  - Decisiones recurrentes.
  - Conocimientos sobre el flujo de trabajo del usuario.
- Retención: persistente en disco.
- El usuario puede eliminar o corregir memorias.

### 3. MemoryEntry
Definir `MemoryEntry`:
- `id: string`
- `content: string`
- `timestamp: number`
- `source: 'user' | 'ai' | 'system'`
- `category: 'preference' | 'decision' | 'fact' | 'correction' | 'habit'`
- `confidence: number` (0-1)
- `relevance: number` (0-1, dinámico)
- `expiration?: number` — epoch ms, undefined = nunca expira
- `tags: string[]`
- `relatedEntities?: string[]` — IDs de tracks, plugins, etc.
- `supersedes?: string` — ID de memoria reemplazada
- `metadata: Record<string, unknown>`

### 4. MemoryScope
- `shortTerm` — turno actual, se limpia después de cada ciclo.
- `session` — sesión actual, almacenada en memoria + IndexedDB.
- `longTerm` — usuario, almacenada en IndexedDB/SQLite.
- `project` — proyecto específico, almacenada en `.jaswave`.

### 5. Creación de Memorias
Las memorias se crean explícitamente, no se infieren de logs:
1. Instrucción explícita del usuario: "Recuerda que prefiero..."
2. Inferencia de IA con confirmación: "Parece que prefieres X. ¿Debo recordar esto?"
3. Observación sistemática de comportamiento consistente: después de N acciones consistentes, preguntar al usuario.

Regla: los logs operacionales NUNCA se convierten automáticamente en memoria.

### 6. Validación
- Deduplicación: verificar si existe memoria similar.
- Resolución de conflictos: si nueva memoria contradice existente, mayor confianza gana, o se pide aclaración.
- Sanity check: contenido no vacío, < 500 caracteres.

### 7. Decaimiento
- Relevancia decae con el tiempo:
  - `shortTerm`: 0 (se limpia inmediatamente)
  - `session`: vida media 1 hora
  - `longTerm`: vida media 30 días
  - `project`: vida media 7 días (después de cerrar proyecto)

### 8. Consolidación
- Disparada al guardar proyecto o cerrar sesión:
  1. Fusionar memorias duplicadas.
  2. Resumir grupos de memorias relacionadas.
  3. Eliminar memorias expiradas.
  4. Aumentar relevancia de memorias accedidas recientemente.

### 9. Privacidad
- Usuario tiene visibilidad completa de todas las memorias.
- Usuario puede eliminar cualquier memoria.
- Usuario puede deshabilitar recolección (Privacy Mode).
- En Privacy Mode: solo memorias de proyecto; memorias de usuario deshabilitadas.

### 10. Acceso desde Context Manager
- `MemoryManager`:
  - `create(request): Promise<MemoryEntry>`
  - `search(query, filter): Promise<MemoryEntry[]>`
  - `getRelevant(context, limit): Promise<MemoryEntry[]>`
  - `getAllForScope(scope): Promise<MemoryEntry[]>`
  - `delete(id): Promise<void>`
  - `consolidate(): Promise<void>`
- Context Manager llama a `getRelevant()` para Niveles 4 y 5.

### 11. Tests
- Test: crear memoria la almacena correctamente
- Test: búsqueda por query devuelve memorias relevantes
- Test: consolidación fusiona duplicados
- Test: decaimiento reduce relevancia con el tiempo
- Test: expiración marca memorias como expiradas
- Test: privacy mode deshabilita memorias de usuario
- Test: memoria no se crea desde logs automáticamente
- Test: conflicto entre memorias se resuelve por confianza

## Dependencias
- Context Manager
- Event Bus
- State Model

## Documentación Relacionada
- `docs/ia/GESTOR-MEMORIA.md`
- `docs/ia/GESTOR-CONTEXTO.md`
