# Planner

## Objetivo
Implementar el planificador de la IA: convierte respuestas del modelo en planes de ejecución estructurados. El Planner decide si la IA debe ejecutar herramientas, pedir aclaración o solicitar confirmación.

## Criterios de Aceptación
- [ ] Planificación de secuencias complejas de herramientas
- [ ] La IA ejecuta operaciones multi-paso atómicamente
- [ ] Clarificación y confirmación cuando es necesario
- [ ] Integración con Tool Registry y Permissions

## Requerimientos Detallados

### 1. Entrada/Salida
- Entrada: `AIResponse` del proveedor (texto + tool calls).
- Entrada: `AIContext` (estado actual del proyecto, selección, etc.).
- Salida: `ExecutionPlan`.

### 2. ExecutionPlan
Definir `ExecutionPlan`:
- `steps: PlanStep[]`
- `requiresConfirmation: boolean`
- `estimatedRisk: RiskLevel`
- `summary: string`

### 3. PlanStep
Union type:
- `ToolCall` — llamada a herramienta del registro.
- `Clarification` — pregunta al usuario para aclarar intención.
- `ConfirmationRequest` — solicitud de confirmación antes de ejecutar.

### 4. Lógica del Planner
1. Parsear respuesta de IA:
   - Si hay tool calls, convertirlas a `ToolCall[]`.
   - Si hay texto, interpretarlo como respuesta directa.
2. Validar tool calls:
   - Verificar que las herramientas existen en el Tool Registry.
   - Verificar que los parámetros cumplen schema.
3. Clasificar riesgo:
   - Si todas las herramientas son `read` → riesgo bajo.
   - Si hay `write` → riesgo medio.
   - Si hay `dangerous` → riesgo alto.
4. Decidir modo de ejecución:
   - Si requiere confirmación → marcar `requiresConfirmation: true`.
   - Si es complejo (múltiples pasos) → usar TransactionManager.
   - Si es simple (una sola tool) → ejecutar directamente.
5. Generar resumen legible para el usuario.

### 5. Clarificación
- Si la IA no entiende la intención del usuario, generar `Clarification`:
  - `question: string` — pregunta al usuario.
  - `options?: string[]` — opciones sugeridas.
- Ejemplo: "¿Quieres aplicar la compresión a la track 'Vocals' o a 'Vocals 2'?"

### 6. Confirmation Request
- Si el riesgo es alto o el usuario está en nivel `CONFIRM`:
  - Generar `ConfirmationRequest` con:
    - `summary: string`
    - `toolCalls: ToolCall[]`
    - `risk: RiskLevel`
    - `preview?: StateDiff`
- La UI muestra modal de confirmación.

### 7. Transaction Planning
- Si la tarea requiere múltiples pasos:
  - Agrupar tool calls en `Transaction`.
  - Validar que todas tienen `inverse` definido.
  - Marcar transacción como `undoBoundary: true` si el usuario quiere deshacer todo como una sola acción.

### 8. Manejo de Errores
- Si una tool call es inválida:
  - Generar `Clarification` o error amigable.
  - No ejecutar nada.
- Si el contexto es insuficiente:
  - Pedir aclaración o usar Query API para obtener más datos.

### 9. Tests
- Test: tool calls válidas generan plan de ejecución
- Test: herramienta inexistente genera error
- Test: parámetros inválidos generan clarificación
- Test: riesgo alto genera confirmation request
- Test: secuencia compleja genera transacción
- Test: texto puro se interpreta como respuesta directa
- Test: resumen es legible para el usuario

## Dependencias
- AI Provider
- Tool Registry
- Permissions
- Validation Layer
- Context Manager

## Documentación Relacionada
- `docs/ia/ARQUITECTURA-IA.md`
- `docs/ia/GESTOR-CONTEXTO.md`
