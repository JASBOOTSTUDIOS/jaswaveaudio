# ADR-0003: Bus de Eventos Tipado

## Contexto

Necesitamos un sistema de comunicación que:
- Notifique a todos los consumidores de cambios de estado
- Evite polling y acceso directo al estado
- Mantenga orden causal de eventos
- Sea extensible para plugins y extensiones
- Soporte replay para depuración y recuperación de contexto IA

## Decisión

Implementar un **Bus de Eventos tipado, ordenado y con replay buffer**:

1. **Eventos tipados**: Cada evento tiene un schema estricto y versión.
2. **Patrón `dominio.accion`**: Nombres de eventos siguen convención estricta.
3. **Orden causal**: Eventos de la misma entidad se entregan en orden causal.
4. **Replay buffer**: Búfer acotado de eventos para depuración y recuperación de contexto.
5. **Backpressure**: Manejo de ráfagas mediante agrupación y priorización.

```typescript
interface DomainEvent {
  name: string;
  version: number;
  timestamp: number;
  source: string;
  payload: JSONValue;
  causationId?: string;
  correlationId?: string;
}
```

## Consecuencias

### Positivas
- Desacoplamiento total entre productores y consumidores
- La IA mantiene contexto vivo sin polling
- Facilita debugging (replay buffer)
- Los plugins pueden reaccionar a cambios sin acoplarse al dominio

### Negativas
- Complejidad en el manejo de ordenamiento y backpressure
- Los desarrolladores deben recordar emitir eventos para cada cambio
- Overhead de memoria por el replay buffer

### Riesgos
- Eventos perdidos en ráfagas extremas
- Mitigación: priorización, agrupación y tamaño de buffer configurable
- Eventos huérfanos sin `causationId`
- Mitigación: linter/regla que requiere `causationId` en eventos derivados
