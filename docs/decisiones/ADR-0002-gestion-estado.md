# ADR-0002: Gestión de Estado Centralizado

## Contexto

Necesitamos un modelo de estado que:
- Sea la única fuente de verdad para todo el DAW
- Sea serializable para consultas de IA y persistencia
- Soporte undo/redo eficiente
- Sea inmutable lógicamente para evitar race conditions
- Permita a la UI reaccionar a cambios eficientemente

## Decisión

Implementar un **estado centralizado, serializable y lógicamente inmutable** con las siguientes características:

1. **Árbol de estado único**: `DAWState` contiene todo el estado del DAW.
2. **Inmutabilidad lógica**: Las mutaciones producen nuevas referencias mediante structural sharing.
3. **Serialización JSON**: Todo el estado (excepto buffers de audio) se serializa a JSON.
4. **Separación UI/Proyecto**: El estado de la UI está separado de los datos del proyecto.
5. **Undo/Redo por comandos inversos**: No se almacenan snapshots, sino comandos inversos.

```typescript
interface DAWState {
  project: ProjectState;
  transport: TransportState;
  selection: SelectionState;
  ui: UIState;
  capabilities: CapabilityRegistry;
}
```

## Consecuencias

### Positivas
- UI es una proyección simple del estado
- La IA consulta el estado sin efectos secundarios
- Undo/Redo eficiente en memoria
- Determinismo: mismo estado + mismo comando = mismo resultado
- Facilita debugging: snapshot del estado en cualquier punto

### Negativas
- Overhead de structural sharing en operaciones frecuentes
- Complejidad inicial en la implementación de inmutabilidad
- Los desarrolladores deben acostumbrarse a no mutar estado directamente

### Riesgos
- Performance en proyectos muy grandes (cientos de tracks)
- Mitigación: usar estructuras de datos persistentes (ej: `immer` para desarrollo, persistent maps en producción)
