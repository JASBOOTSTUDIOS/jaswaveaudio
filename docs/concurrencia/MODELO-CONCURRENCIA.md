# Modelo de Concurrencia

## 1. Principio Fundamental

Separar claramente los hilos de ejecución para evitar bloqueos y asegurar determinismo. El hilo de audio es innegociable: nunca se bloquea, nunca asigna memoria dinámicamente, nunca llama al LLM.

## 2. Hilos del Sistema

| Hilo | Prioridad | Responsabilidad | Restricciones |
|-------|-----------|-----------------|---------------|
| **Audio Thread** | Máxima | Procesamiento de audio en tiempo real, DSP, mezcla | Nunca bloquea, nunca alloc dinámica, nunca red, nunca LLM |
| **UI Thread** | Alta | Renderizado de interfaz, eventos de usuario | Nunca bloquea > 16ms (60fps) |
| **AI Thread** | Media | Comunicación con proveedor IA, streaming | Puede bloquear (pero con timeout) |
| **Worker Threads** | Baja | Análisis, renderizado, E/S de archivo | Sin restricciones especiales |
| **Plugin Processing** | Alta (por plugin) | Procesamiento de plugins individuales | Aislamiento por plugin |

## 3. Comunicación Entre Hilos

### UI Thread ↔ AI Thread
Mensajes asíncronos mediante colas:

```typescript
interface ThreadSafeQueue<T> {
  send(item: T): void;
  receive(): AsyncIterable<T>;
  drain(): T[];
}
```

### Audio Thread ↔ Worker Threads
Doble buffer sin bloqueo:

```typescript
interface DoubleBuffer<T> {
  write(data: T): void;
  read(): T;
  swap(): void;
}
```

El audio thread lee del buffer A mientras el worker escribe en el buffer B. Después del swap, el audio thread lee del buffer B.

### Audio Thread ↔ Command System
Eventos en el Bus de Eventos:

```typescript
// El audio thread emite eventos, no modifica estado directamente
eventBus.emit('transport.positionChanged', { position: currentPosition });
```

## 4. Pool de Memoria para Audio

El audio thread usa memoria preasignada:

```typescript
interface AudioMemoryPool {
  allocate(size: number): AudioBuffer;
  free(buffer: AudioBuffer): void;
  reset(): void;
}
```

No se permiten asignaciones dinámicas en el hilo de audio. Los pools se dimensionan en la inicialización.

## 5. Backpressure

El sistema maneja ráfagas de eventos sin saturar:

- **Agrupación**: Eventos de alta frecuencia se agrupan (ej: `audio.analysis.updated` cada 100ms)
- **Eliminación**: Si la cola está llena, se eliminan los eventos más antiguos
- **Prioridad**: Eventos de transporte > eventos de UI > eventos de analítica

## 6. Ejemplo de Flujo

```
Usuario presiona Play
        ↓
UI Thread → Command System → Event Bus
        ↓
Audio Thread recibe evento transport.started
        ↓
Audio Thread inicia procesamiento
        ↓
Audio Thread emite transport.positionChanged periódicamente
        ↓
UI Thread actualiza playhead (sin bloquear audio)
```

## 7. Consideraciones

- En Windows, usar `AudioClient` con modo evento o modo pull
- Priorizar el hilo de audio usando `SetThreadPriority` (Win32) o `pthread_setschedparam` (POSIX)
- Afinar los hilos a núcleos de CPU específicos si es necesario
- Evitar garbage collection en el hilo de audio (usar pools, no objetos temporales)
