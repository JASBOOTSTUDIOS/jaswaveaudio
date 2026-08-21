# Validación AI

## Objetivo
Implementar la validación específica para acciones generadas por IA: detección de complejidad excesiva, relevancia de herramientas e integridad del contexto. La IA nunca se ejecuta directamente sin pasar por la pipeline de validación.

## Criterios de Aceptación
- [ ] Detección de complejidad excesiva
- [ ] Relevancia de herramientas verificada
- [ ] Prompt injection detectado
- [ ] La IA no ejecuta secuencias peligrosas sin confirmación

## Requerimientos Detallados

### 1. AIPreValidation
Definir `AIPreValidation`:
- `checkTransactionComplexity(tools: ToolDefinition[]): ValidationResult`
- `checkToolRelevance(tools: ToolDefinition[], context: AIContext): ValidationWarning[]`
- `checkContextIntegrity(context: AIContext): ValidationResult`

### 2. Complejidad de Transacciones
- `checkTransactionComplexity`:
  - Contar herramientas `dangerous` en la secuencia.
  - Si > N (ej: 3) → rechazar o requerir confirmación adicional.
  - Contar herramientas `write` totales.
  - Si > M (ej: 10) → advertir al usuario.
  - Detectar patrones peligrosos:
    - Eliminar track + eliminar proyecto en misma secuencia.
    - Cambiar volumen de master sin antes verificar clipping.

### 3. Relevancia de Herramientas
- `checkToolRelevance`:
  - Comparar herramientas seleccionadas con la intención del usuario.
  - Si el usuario dijo "sube el volumen de la voz" y la IA selecciona `track.delete` → warning de irrelevancia.
  - Usar embeddings o heurísticas de matching.
  - Devolver `ValidationWarning[]` con sugerencias.

### 4. Integridad del Contexto
- `checkContextIntegrity`:
  - Detectar prompt injection en el contexto.
  - Detectar jailbreak attempts.
  - Validar que el contexto no contiene instrucciones ocultas.
  - Validar que las herramientas en el contexto coinciden con el Tool Registry actual.
  - Validar que el system prompt no ha sido modificado.

### 5. Límites de Ejecución
- Número máximo de tool calls por turno: 10.
- Número máximo de comandos en transacción: 20.
- Timeout por tool call: 30 segundos.
- Si se exceden límites, la IA debe pedir aclaración o dividir en múltiples turnos.

### 6. Dry Run
- Soportar modo dry run:
  - `validateAndPreview(request, { dryRun: true })`
  - Devuelve: `{ valid, events?: DomainEvent[], stateDiff?: StateDiff }`
- El dry run simula ejecución sin aplicar cambios.
- La IA puede mostrar al usuario qué hará antes de commitear.

### 7. StateDiff
Definir `StateDiff`:
- `tracksAdded: Track[]`
- `tracksRemoved: string[]`
- `tracksModified: Track[]`
- `clipsAdded: AudioClip[]`
- `clipsRemoved: string[]`
- `pluginsLoaded: PluginInstance[]`
- `pluginsUnloaded: string[]`
- `volumeChanges: { trackId: string, oldDb: number, newDb: number }[]`
- etc.

### 8. UI Feedback
- Mostrar warnings de validación en el chat.
- Mostrar preview de cambios antes de confirmar.
- Resaltar acciones peligrosas en rojo.
- Mostrar número de operaciones que se ejecutarán.

### 9. Tests
- Test: complejidad excesiva es rechazada
- Test: herramienta irrelevante genera warning
- Test: prompt injection es detectado
- Test: jailbreak attempt es detectado
- Test: límite de tool calls se respeta
- Test: dry run no modifica el estado
- Test: state diff muestra cambios correctos
- Test: confirmación requerida para operaciones peligrosas

## Dependencias
- Validation Layer
- Tool Registry
- Permissions
- State Model

## Documentación Relacionada
- `docs/arquitectura/VALIDACION.md`
- `docs/ia/ARQUITECTURA-IA.md`
