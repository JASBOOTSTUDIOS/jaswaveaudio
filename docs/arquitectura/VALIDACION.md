# Capa de Validación

## 1. Propósito

Toda acción — iniciada por el usuario o generada por la IA — debe pasar por una pipeline de validación antes de ejecutarse. La validación previene transiciones de estado inválidas, aplica permisos y protege contra acciones destructivas de la IA.

## 2. Pipeline de Validación

```
Solicitud de Acción
      │
      ▼
┌─────────────────┐
│ 1. Verificación de Schema │  Validar payload contra JSON Schema de Herramienta/Comando
└────────┬────────┘
         │ pasar
         ▼
┌─────────────────┐
│ 2. Verificación de Auth │  Verificar sesión de usuario y nivel de permiso
└────────┬────────┘
         │ pasar
         ▼
┌─────────────────┐
│ 3. Verificación de Permisos │  Verificar si el nivel del usuario permite este NivelDeRiesgo
│    (Permisos)    │
└────────┬────────┘
         │ pasar
         ▼
┌─────────────────┐
│ 4. Pre-Validación │  Validación específica del dominio (ej: unicidad de nombre de track)
│    (Comando)    │
└────────┬────────┘
         │ pasar
         ▼
┌─────────────────┐
│ 5. Verificación de Conflictos │  Verificar conflictos de estado (ej: proyecto no es solo lectura)
│    (Conflictos)    │
└────────┬────────┘
         │ pasar
         ▼
      Ejecutar
```

## 3. Validadores

```typescript
interface Validator {
  validate(request: ActionRequest): ValidationResult;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}
```

### Cadena de Validadores

| Paso | Validador | Alcance |
|------|-----------|---------|
| 1 | `SchemaValidator` | Estructura de payload contra schema de herramienta/comando |
| 2 | `AuthValidator` | Validez de sesión, tokens CSRF |
| 3 | `PermissionValidator` | Nivel de usuario vs. nivel de riesgo de herramienta |
| 4 | `DomainValidator` | Reglas de negocio (nombres únicos, rangos válidos, etc.) |
| 5 | `ConflictValidator` | Conflictos de estado (modo solo lectura, espacio en disco insuficiente, etc.) |

## 4. Reglas de Validación (Ejemplos)

```typescript
// Creación de track: el nombre debe ser único dentro del proyecto
const TrackNameUnique: DomainRule = {
  validate: (state, payload) => {
    const exists = state.project.tracks.some(t => t.name === payload.name);
    return exists ? { valid: false, errors: [{ code: "DUPLICATE_NAME", message: "El nombre del track ya existe" }] } : { valid: true };
  }
};

// Parámetro de volumen: debe estar entre -60dB y +12dB
const VolumeRange: DomainRule = {
  validate: (state, payload) => {
    if (payload.dB < -60 || payload.dB > 12) {
      return { valid: false, errors: [{ code: "OUT_OF_RANGE", message: "El volumen debe estar entre -60 y 12 dB" }] };
    }
    return { valid: true };
  }
};

// Proyecto no es solo lectura
const ProjectNotReadOnly: ConflictRule = {
  validate: (state) => {
    if (state.project.metadata.readOnly) {
      return { valid: false, errors: [{ code: "READ_ONLY", message: "El proyecto es de solo lectura" }] };
    }
    return { valid: true };
  }
};
```

## 5. Validación Específica de IA

Los payloads generados por IA **nunca** son confiables. Pasan por la misma pipeline que las acciones del usuario, con una adición:

```typescript
interface AIPreValidation {
  // Verificar si la IA está intentando encadenar demasiadas operaciones peligrosas
  checkTransactionComplexity(tools: ToolDefinition[]): ValidationResult;
  
  // Verificar que la selección de herramientas coincide con la intención del usuario
  checkToolRelevance(tools: ToolDefinition[], context: AIContext): ValidationWarning[];
  
  // Detectar intentos de inyección de prompt o jailbreak en el contexto
  checkContextIntegrity(context: AIContext): ValidationResult;
}
```

## 6. Sistema de Advertencias

Algunos validadores producen **advertencias** (no errores). Las advertencias se muestran al usuario pero no bloquean la ejecución:

```typescript
// Ejemplo: la IA quiere establecer el volumen a +6dB en un track que ya está recortando
const ClippingWarning: WarningRule = {
  check: (state, payload) => {
    const analysis = state.project.analysis.tracks[payload.trackId];
    if (analysis && analysis.peak > 0) {
      return [{ code: "CLIPPING_RISK", message: "El track ya está recortando", suggestion: "Reduce el volumen o añade un limitador" }];
    }
    return [];
  }
};
```

## 7. Aplicación de Permisos

Ver `PERMISOS.md` para la matriz completa. El PermissionValidator:

```typescript
interface PermissionValidator {
  check(tool: ToolDefinition, userLevel: PermissionLevel): ValidationResult;
}
```

Las comprobaciones de permisos son **opt-out**, no opt-in. Una herramienta está desautorizada por defecto a menos que se permita explícitamente.

## 8. Ejecución Simulada (Dry Run)

El Validador soporta un modo de **ejecución simulada** para que la IA previsualice acciones sin ejecutarlas:

```typescript
const preview = await validator.validateAndPreview(request, { dryRun: true });
// Devuelve: { valid, events: DomainEvent[], stateDiff: StateDiff }
```

Esto permite que la IA muestre al usuario qué sucederá antes de confirmar.
