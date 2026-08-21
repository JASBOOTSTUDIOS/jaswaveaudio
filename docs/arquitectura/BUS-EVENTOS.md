# Bus de Eventos

## 1. Propósito

El Bus de Eventos es el sistema nervioso del DAW. Cada cambio de estado emite un evento tipado. Los consumidores se suscriben a los eventos que les interesan. Sin polling, sin acceso directo al estado desde los consumidores.

## 2. Interfaz Core

```typescript
type EventName = string;
type EventPayload = unknown;
type EventHandler<T> = (payload: T) => void;

interface EventBus {
  on<T>(event: EventName, handler: EventHandler<T>): Subscription;
  off(event: EventName, handler: EventHandler<unknown>): void;
  emit<T>(event: EventName, payload: T): void;
  once<T>(event: EventName, handler: EventHandler<T>): Subscription;
  clear(): void;
}
```

## 3. Taxonomía de Eventos

Los eventos se categorizan por dominio. Todos los nombres siguen el patrón `dominio.accion`.

| Categoría | Prefijo | Ejemplos |
|-----------|---------|----------|
| Proyecto | `project.` | `project.created`, `project.loaded`, `project.saved`, `project.closed` |
| Transporte | `transport.` | `transport.started`, `transport.stopped`, `transport.paused`, `transport.positionChanged` |
| Track | `track.` | `track.created`, `track.deleted`, `track.renamed`, `track.muted`, `track.soloed` |
| Clip | `clip.` | `clip.created`, `clip.deleted`, `clip.moved`, `clip.resized`, `clip.split` |
| Plugin | `plugin.` | `plugin.loaded`, `plugin.unloaded`, `plugin.parameter.changed` |
| Automatización | `automation.` | `automation.created`, `automation.pointChanged` |
| MIDI | `midi.` | `midi.noteOn`, `midi.noteOff`, `midi.ccChanged`, `midi.clock` |
| Audio | `audio.` | `audio.analysis.updated`, `audio.clip.rendered` |
| UI | `ui.` | `ui.panelOpened`, `ui.panelClosed`, `ui.tooltipShown` |
| IA | `ai.` | `ai.toolExecuted`, `ai.toolFailed`, `ai.permissionDenied` |
| Sistema | `system.` | `system.initialized`, `system.shuttingDown`, `system.error` |

## 4. Garantías de Ordenamiento

- **Ordenamiento por entidad**: Los eventos que afectan a la misma entidad se entregan en orden causal.
- **Entrega causal**: Si el comando A emite el evento E1 y el comando B (disparado por E1) emite E2, E2 se entrega después de E1.
- **Sin orden total global**: Los eventos de diferentes entidades pueden reordenarse.

## 5. Ciclo de Vida de los Consumidores

Los consumidores deben manejar la duración de las suscripciones. Las suscripciones están ligadas a la **sesión**, no al componente de UI:

```typescript
// Los componentes de UI se suscriben al montar, cancelan al desmontar
// Los servicios de fondo se suscriben por la duración de la sesión
const sub = eventBus.on('track.created', (track) => { ... });
sub.unsubscribe();
```

## 6. Schemas de Eventos

Cada evento tiene un schema estricto. Los eventos están versionados:

```typescript
interface DomainEvent {
  name: string;
  version: number; // se incrementa cuando cambia el schema del payload
  timestamp: number;
  source: string; // ID de comando, componente del sistema, etc.
  payload: JSONValue;
  causationId?: string; // vincula con el evento padre
  correlationId?: string; // agrupa eventos relacionados
}
```

## 7. Pautas para Consumidores

- **UI**: Suscribirse a eventos que afectan a paneles visibles. Re-renderizar solo en eventos relevantes.
- **Undo/Redo**: Suscribirse a todos los eventos `domain.*`. Almacenar comandos inversos.
- **Gestor de Contexto IA**: Suscribirse a todos los eventos para mantener la ventana de contexto viva.
- **Motor de Audio**: Suscribirse a eventos de transporte, track, clip, plugin para actualizar el grafo DSP.
- **Gestor de Memoria**: Suscribirse a eventos `ai.*` y `user.*` para evaluar promoción de memorias.
- **Plugins**: Suscribirse a cambios de parámetros, eventos de automatización.

## 8. Eventos Asíncronos

Algunos eventos se originan desde fuentes asíncronas (análisis de audio, renderizado, IA remota). Estos se emiten en el bus como cualquier otro evento pero pueden llegar después de que el comando origen haya completado.

```typescript
interface AsyncEvent extends DomainEvent {
  async: true;
  correlationId: string;
}
```

## 9. Contrapresión

El bus debe manejar ráfagas de eventos (ej: actualizaciones rápidas de automatización durante la reproducción). Implementar contrapresión mediante:
- Agrupación para eventos de alta frecuencia (`audio.analysis.updated`)
- Eliminación de eventos más antiguos cuando el búfer está lleno
- Colas de prioridad (eventos de transporte > eventos de UI > eventos de analítica)

## 10. Replay / Búfer de Replay

Para depuración y recuperación de contexto de IA, el bus mantiene un búfer de replay acotado:

```typescript
interface ReplayBuffer {
  capacity: number; // eventos máximos retenidos
  getEvents(filter: EventFilter): DomainEvent[];
}
```

Los eventos más antiguos que la capacidad del búfer se descartan. Esto NO es lo mismo que la Memoria de IA.
