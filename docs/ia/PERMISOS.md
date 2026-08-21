# Permisos

## 1. Propósito

El Sistema de Permisos aplica lo que la IA puede y no puede hacer basándose en el nivel de autonomía elegido por el usuario. Es la última línea de defensa antes de la ejecución de herramientas.

## 2. Niveles de Permiso

| Nivel | ID | Descripción | Comportamiento de la IA |
|-------|----|-------------|-------------|
| **Solo Lectura** | `READ_ONLY` | La IA puede observar pero no modificar | Solo herramientas de consulta. Sin herramientas write/dangerous. |
| **Sugerir** | `SUGGEST` | La IA propone cambios, el usuario ejecuta | Devuelve llamadas de herramientas propuestas. El usuario hace clic en "Aplicar". |
| **Confirmar** | `CONFIRM` | La IA ejecuta después de confirmación del usuario | Ejecuta después de que el usuario haga clic en "Confirmar" por operación o lote. |
| **Auto Ejecutar Seguro** | `AUTO_EXECUTE_SAFE` | La IA ejecuta herramientas `read` y `write` automáticamente; las herramientas `dangerous` requieren confirmación | Sin prompts para read/write. Confirmación para dangerous. |
| **Autonomía Total** | `FULL_AUTONOMY` | La IA ejecuta todas las herramientas permitidas automáticamente | Sin prompts. Solo bloqueada por denegación explícita de herramienta. |

## 3. Matriz de Permisos

```typescript
interface PermissionPolicy {
  check(tool: ToolDefinition, userLevel: PermissionLevel): PermissionResult;
}

interface PermissionResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

const defaultPolicy: PermissionPolicy = {
  check(tool, level) {
    if (tool.risk === 'read') {
      return { allowed: true, requiresConfirmation: false };
    }
    if (tool.risk === 'write') {
      if (level === 'READ_ONLY') return { allowed: false, reason: 'Modo solo lectura' };
      if (level === 'SUGGEST') return { allowed: false, reason: 'Modo sugerir solo propone' };
      if (level === 'CONFIRM') return { allowed: true, requiresConfirmation: true };
      if (level === 'AUTO_EXECUTE_SAFE') return { allowed: true, requiresConfirmation: false };
      if (level === 'FULL_AUTONOMY') return { allowed: true, requiresConfirmation: false };
    }
    if (tool.risk === 'dangerous') {
      if (level === 'READ_ONLY') return { allowed: false, reason: 'Modo solo lectura' };
      if (level === 'SUGGEST') return { allowed: false, reason: 'Modo sugerir solo propone' };
      if (level === 'CONFIRM') return { allowed: true, requiresConfirmation: true };
      if (level === 'AUTO_EXECUTE_SAFE') return { allowed: true, requiresConfirmation: true }; // override por defecto
      if (level === 'FULL_AUTONOMY') return { allowed: true, requiresConfirmation: false };
    }
    return { allowed: false, reason: 'Nivel de riesgo desconocido' };
  }
};
```

## 4. Overrides por Herramienta

El usuario puede sobreescribir permisos para herramientas específicas:

```typescript
interface ToolPermissionOverride {
  toolName: string;
  allowed: boolean;
  requireConfirmation: boolean;
  reason?: string;
}

interface UserPermissionConfig {
  level: PermissionLevel;
  overrides: ToolPermissionOverride[];
  allowUnsafeTools: boolean;
}
```

Los overrides tienen precedencia sobre la matriz por defecto.

## 5. UI de Confirmación

Cuando `requiresConfirmation` es `true`, el AI Harness no ejecuta la herramienta inmediatamente. Devuelve una solicitud de confirmación a la UI:

```typescript
interface ConfirmationRequest {
  type: 'confirmation';
  summary: string; // descripción legible de lo que sucederá
  toolCalls: ToolCall[];
  risk: RiskLevel;
  preview?: StateDiff; // vista previa opcional de cambios
}
```

La UI muestra un modal con:
- Resumen de cambios
- Lista de tracks/plugins/clips afectados
- Botones "Confirmar" y "Denegar"
- Opción de "Confirmar y no volver a preguntar para esta sesión"

## 6. Alcance de Autonomía

El nivel de autonomía puede tener alcance:

```typescript
interface AutonomyScope {
  level: PermissionLevel;
  appliesTo: ('all' | 'project' | 'session')[];
  expiresAt?: number;
}
```

Por ejemplo: "Autonomía total para esta sesión, luego volver a Confirmar."

## 7. Parada de Emergencia

El usuario puede descender instantáneamente a `READ_ONLY`:

```typescript
interface EmergencyStop {
  trigger(): void; // establece inmediatamente el nivel a READ_ONLY
  isActive(): boolean;
}
```

Esto es accesible mediante un atajo de teclado (ej: `Ctrl+Shift+Space`) y un botón en la barra de estado.

## 8. Registro de Auditoría

Todas las comprobaciones de permisos se registran:

```typescript
interface PermissionLogEntry {
  timestamp: number;
  toolName: string;
  userLevel: PermissionLevel;
  allowed: boolean;
  requiredConfirmation: boolean;
  userConfirmed?: boolean;
  source: 'user' | 'ai' | 'script';
}
```

## 9. Memoria de IA y Permisos

La IA debe recordar la preferencia de permiso del usuario pero nunca sobreescribirla:

```typescript
// Ejemplo de memoria de IA: "El usuario prefiere modo SUGGEST para tareas de mezcla"
// Esto se almacena en memoria pero la aplicación real está en la Política de Permisos.
```

La IA puede sugerir cambiar el nivel de permiso ("¿Te gustaría que cambie a Auto Ejecutar Seguro para esta sesión?"), pero no puede cambiarlo unilateralmente.
