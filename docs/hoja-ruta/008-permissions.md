# Permissions

## Objetivo
Implementar la matriz de permisos por niveles de autonomía y overrides por herramienta. El usuario debe tener control total sobre qué puede hacer la IA.

## Criterios de Aceptación
- [x] Matriz READ_ONLY / SUGGEST / CONFIRM / AUTO_EXECUTE_SAFE / FULL_AUTONOMY
- [x] Overrides por herramienta
- [x] Emergency stop
- [x] Audit log de permisos

## Requerimientos Detallados

### 1. Niveles de Autonomía
Definir `PermissionLevel`:
- `READ_ONLY` — la IA solo observa. Solo herramientas de consulta.
- `SUGGEST` — la IA propone cambios, el usuario ejecuta.
- `CONFIRM` — la IA ejecuta después de confirmación del usuario.
- `AUTO_EXECUTE_SAFE` — la IA ejecuta `read` y `write` automáticamente; `dangerous` requieren confirmación.
- `FULL_AUTONOMY` — la IA ejecuta todas las herramientas permitidas sin prompts.

### 2. Matriz de Permisos Default
Definir `PermissionPolicy` con lógica:
- `read` → permitido en todos los niveles.
- `write`:
  - `READ_ONLY` → denegado
  - `SUGGEST` → denegado (solo propone)
  - `CONFIRM` → permitido, requiere confirmación
  - `AUTO_EXECUTE_SAFE` → permitido, sin confirmación
  - `FULL_AUTONOMY` → permitido, sin confirmación
- `dangerous`:
  - `READ_ONLY` → denegado
  - `SUGGEST` → denegado
  - `CONFIRM` → permitido, requiere confirmación
  - `AUTO_EXECUTE_SAFE` → permitido, requiere confirmación (override default)
  - `FULL_AUTONOMY` → permitido, sin confirmación

### 3. Overrides por Herramienta
- Definir `ToolPermissionOverride`:
  - `toolName: string`
  - `allowed: boolean`
  - `requireConfirmation: boolean`
  - `reason?: string`
- Definir `UserPermissionConfig`:
  - `level: PermissionLevel`
  - `overrides: ToolPermissionOverride[]`
  - `allowUnsafeTools: boolean`
- Los overrides tienen precedencia sobre la matriz default.
- El usuario puede configurar overrides desde Settings.

### 4. Confirmation Request
- Cuando `requiresConfirmation` es true, el AI Harness no ejecuta inmediatamente.
- Devuelve `ConfirmationRequest` a la UI:
  - `type: 'confirmation'`
  - `summary: string` — descripción legible de qué sucederá
  - `toolCalls: ToolCall[]`
  - `risk: RiskLevel`
  - `preview?: StateDiff` — preview opcional de cambios
- La UI muestra modal con:
  - Resumen de cambios
  - Lista de tracks/plugins/clips afectados
  - Botones Confirmar / Denegar
  - Opción "Confirmar y no volver a preguntar en esta sesión"

### 5. Scope de Autonomía
- Definir `AutonomyScope`:
  - `level: PermissionLevel`
  - `appliesTo: ('all' | 'project' | 'session')[]`
  - `expiresAt?: number`
- Ejemplo: "Full autonomy para esta sesión, luego revertir a CONFIRM."

### 6. Emergency Stop
- Definir `EmergencyStop`:
  - `trigger(): void` — pone inmediatamente en `READ_ONLY`
  - `isActive(): boolean`
- Accesible por:
  - Atajo de teclado: `Ctrl+Shift+Space`
  - Botón en barra de estado
- Debe ser instantáneo, sin confirmación.

### 7. Audit Log de Permisos
- Definir `PermissionLogEntry`:
  - `timestamp: number`
  - `toolName: string`
  - `userLevel: PermissionLevel`
  - `allowed: boolean`
  - `requiredConfirmation: boolean`
  - `userConfirmed?: boolean`
  - `source: 'user' | 'ai' | 'script'`
- Todas las comprobaciones de permisos se registran.
- El log es operacional, no memoria de IA.

### 8. AI Memory y Permisos
- La IA puede recordar preferencias de nivel de autonomía, pero NUNCA puede cambiarlas sin autorización.
- Ejemplo de memoria: "El usuario prefiere SUGGEST para tareas de mezcla."
- La IA puede sugerir cambiar el nivel: "¿Quieres que cambie a Auto Execute Safe para esta sesión?"
- El cambio de nivel requiere confirmación explícita del usuario.

### 9. Tests
- Test: READ_ONLY bloquea herramientas write y dangerous
- Test: SUGGEST no ejecuta, solo propone
- Test: CONFIRM ejecuta después de confirmación
- Test: AUTO_EXECUTE_SAFE ejecuta write sin confirmación, dangerous con confirmación
- Test: FULL_AUTONOMY ejecuta todo sin confirmación
- Test: override por herramienta tiene precedencia
- Test: emergency stop pone en READ_ONLY instantáneamente
- Test: audit log registra todas las comprobaciones
- Test: IA no puede cambiar nivel de autonomía sin confirmación

## Dependencias
- Tool Registry
- Validation Layer

## Documentación Relacionada
- `docs/ia/PERMISOS.md`
- `docs/arquitectura/VISION-GENERAL.md`
- `docs/00-RESUMEN-ARQUITECTURA.md`
