# ADR-0006: Sistema de Herramientas para IA

## Contexto

La IA debe poder interactuar con el DAW de forma estructurada y segura. Necesitamos un sistema que:
- Exponga capacidades del DAW como operaciones auto-descritas
- Valide parámetros antes de ejecutar
- Registre quién hizo qué (auditoría)
- Soporte descubrimiento dinámico (plugins pueden agregar herramientas)
- Separe operaciones de lectura, escritura y peligrosas

## Decisión

Implementar un **Sistema de Herramientas** como la única interfaz entre la IA y el DAW:

1. Toda acción del usuario es representable como herramienta.
2. Cada herramienta tiene: nombre, descripción, parámetros, schema, nivel de riesgo.
3. Las herramientas se ejecutan a través del Command System (no directamente en el dominio).
4. El Registro de Herramientas es dinámico: plugins pueden registrar herramientas en runtime.
5. Las herramientas se clasifican en `read`, `write`, `dangerous`.

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  version: string;
  category: ToolCategory;
  risk: RiskLevel;
  parameters: ToolParameter[];
  returns: ToolReturn;
  examples?: ToolExample[];
  requiresConfirmation?: boolean;
  idempotent?: boolean;
}
```

## Consecuencias

### Positivas
- IA puede descubrir capacidades del DAW dinámicamente
- Validación centralizada de parámetros
- Auditoría completa de acciones de IA
- Plugins extienden capacidades de IA automáticamente
- Separación clara entre lectura y escritura

### Negativas
- Overhead de definir herramientas para cada operación
- Complejidad en el registro dinámico
- Los desarrolladores deben recordar registrar herramientas para nuevas funciones

### Riesgos
- Herramientas sin validación de parámetros
- Mitigación: obligar schema en todas las herramientas, linter
- Herramientas peligrosas expuestas sin restricción
- Mitigación: Sistema de Permisos por defecto restrictivo
