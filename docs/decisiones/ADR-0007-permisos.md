# ADR-0007: Sistema de Permisos por Niveles

## Contexto

La IA debe poder ejecutar acciones en nombre del usuario, pero el usuario debe tener control total sobre qué puede hacer la IA. Necesitamos un sistema que:
- Sea simple de entender para el usuario
- Permita diferentes niveles de autonomía
- Proteja contra acciones destructivas
- Sea extensible para overrides por herramienta

## Decisión

Implementar un **sistema de permisos por niveles** con la siguiente matriz:

| Nivel | ID | Comportamiento |
|-------|----|----------------|
| Solo Lectura | `READ_ONLY` | Solo herramientas de consulta |
| Sugerir | `SUGGEST` | Propone cambios, usuario ejecuta |
| Confirmar | `CONFIRM` | Ejecuta después de confirmación |
| Auto Ejecutar Seguro | `AUTO_EXECUTE_SAFE` | Ejecuta `read`/`write`; `dangerous` requieren confirmación |
| Autonomía Total | `FULL_AUTONOMY` | Ejecuta todas las herramientas permitidas |

Reglas:
1. Las herramientas se clasifican en `read`, `write`, `dangerous`.
2. Por defecto, `dangerous` siempre requiere confirmación excepto en `FULL_AUTONOMY`.
3. El usuario puede hacer overrides por herramienta específica.
4. Existe una Parada de Emergencia que pone la IA en `READ_ONLY` instantáneamente.
5. Todas las comprobaciones de permisos se registran en el log de auditoría.

```typescript
const defaultPolicy: PermissionPolicy = {
  check(tool, level) {
    if (tool.risk === 'read') {
      return { allowed: true, requiresConfirmation: false };
    }
    if (tool.risk === 'write') {
      switch (level) {
        case 'READ_ONLY': return { allowed: false, reason: 'Modo solo lectura' };
        case 'SUGGEST': return { allowed: false, reason: 'Modo sugerir solo propone' };
        case 'CONFIRM': return { allowed: true, requiresConfirmation: true };
        default: return { allowed: true, requiresConfirmation: false };
      }
    }
    // dangerous
    if (level === 'FULL_AUTONOMY') return { allowed: true, requiresConfirmation: false };
    return { allowed: true, requiresConfirmation: true };
  }
};
```

## Consecuencias

### Positivas
- Control granular del usuario sobre la IA
- Protección contra acciones destructivas
- Overrides por herramienta para casos específicos
- Parada de emergencia accesible rápidamente

### Negativas
- Complejidad en la UI de configuración de permisos
- El usuario puede sentirse abrumado por los niveles
- Overrides pueden crear configuraciones inseguras

### Riesgos
- Usuario confunde niveles y expone demasiada autonomía
- Mitigación: tooltips explicativos, wizard de configuración inicial
- Override que permite herramienta peligrosa sin confirmación
- Mitigación: warnings visuales, confirmación doble para overrides peligrosos
