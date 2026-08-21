# Event Bus

## Objetivo
Implementar el sistema de comunicación interna del DAW mediante eventos tipados, ordenados y con replay buffer. El Event Bus es el sistema nervioso del DAW: todos los cambios de estado relevantes deben poder ser consultados por cualquier módulo suscriptor sin polling.

## Criterios de Aceptación
- [x] Los eventos se emiten y consumen correctamente
- [x] Schemas versionados (`RegistroSchemasEventos` + versión en emit)
- [x] Subscriptions con unsubscribe
- [x] Replay buffer acotado
- [x] Backpressure implementado (priorización + coalescing de alta frecuencia)

## Requerimientos Detallados

### 1. Interfaz Pública
- [x] Definir la interfaz `EventBus` / `BusEventos` con métodos:
  - [x] `on<T>(eventName, handler): Subscription`
  - [x] `off(eventName, handler): void`
  - [x] `emit<T>(eventName, payload, meta?): void` — meta: `fuente`, `version`, `idCausacion`, `idCorrelacion`, `asincrono`
  - [x] `emitAsincrono<T>(eventName, payload, meta): void` — requiere `idCorrelacion`
  - [x] `once<T>(eventName, handler): Subscription`
  - [x] `clear(): void`
  - [x] La interfaz debe estar en `shared/src/events/event-bus.ts` y ser consumible por UI, scripts, dominio, AI Harness, plugins y extensiones.
- [x] `Subscription` debe exponer al menos `unsubscribe(): void`.

**Estado**: ✅ Completado
**Archivos**: `shared/src/events/event-bus.ts`, `shared/src/events/suscripcion.ts`

---

### 2. Tipado de Eventos
- [x] Definir `EventoDominio` en `shared/src/events/evento-dominio.ts` con campos:
  - [x] `nombre: string` — patrón `dominio.accion`
  - [x] `version: number` — se incrementa cuando cambia el payload schema
  - [x] `marcaTiempo: number` — epoch ms
  - [x] `fuente: string` — comando o componente que lo emite (`meta.fuente` en emit)
  - [x] `payload: ValorJSON` — datos del evento
  - [x] `idCausacion?: string` — vincula con evento padre
  - [x] `idCorrelacion?: string` — agrupa eventos relacionados
- [x] Definir `EventoAsincrono` extendiendo `EventoDominio` para eventos de fuentes asíncronas (análisis, renderizado, IA remota).
- [x] `emitAsincrono()` marca `asincrono: true` y exige `idCorrelacion`.
- [x] `RegistroSchemasEventos` en `shared/src/events/schemas-eventos.ts` con versión por evento y validación opcional (modo estricto configurable).

**Estado**: ✅ Completado
**Archivos**: `shared/src/events/evento-dominio.ts`, `shared/src/events/schemas-eventos.ts`

---

### 3. Taxonomía de Eventos
  - [x] Crear constantes en `shared/src/constants/nombres-eventos.ts` organizadas por dominio:
  - [x] `project.*` — created, loaded, saved, closed
  - [x] `transport.*` — started, stopped, paused, positionChanged
  - [x] `track.*` — created, deleted, renamed, muted, soloed
  - [x] `clip.*` — created, deleted, moved, resized, split
  - [x] `plugin.*` — loaded, unloaded, parameter.changed
  - [x] `automation.*` — created, pointChanged
  - [x] `midi.*` — noteOn, noteOff, ccChanged, clock
  - [x] `audio.*` — analysis.updated, clip.rendered
  - [x] `ui.*` — panelOpened, panelClosed, tooltipShown
  - [x] `ai.*` — toolExecuted, toolFailed, permissionDenied
  - [x] `system.*` — initialized, shuttingDown, error

**Estado**: ✅ Completado
**Archivos**: `shared/src/constants/nombres-eventos.ts`

---

### 4. Orden de Eventos
- [x] Garantizar ordenamiento por entidad: eventos de la misma entidad se entregan en orden causal.
- [x] Si comando A emite E1 y comando B (triggerado por E1) emite E2, entonces E2 se entrega después de E1.
- [x] No se requiere orden total global entre entidades diferentes.

**Estado**: ✅ Completado
**Nota**: Garantizado por timestamp y emisión síncrona en el hilo actual. Cada handler se ejecuta en orden dentro de `emit()`.

---

### 5. Replay Buffer
- [x] Implementar un `BufferReplay` acotado en `shared/src/events/buffer-replay.ts`:
  - [x] `capacidad: number` — eventos máximos retenidos
  - [x] `obtenerEventos(filtro?: FiltroEvento): EventoDominio[]`
- [x] Los eventos más antiguos que la capacidad se descartan automáticamente.
- [x] El buffer es para debugging y recuperación de contexto IA; no es lo mismo que memoria de IA.

**Estado**: ✅ Completado
**Archivos**: `shared/src/events/buffer-replay.ts`

---

### 6. Backpressure
- [x] Manejar ráfagas de eventos de alta frecuencia (ej: actualizaciones de automatización durante playback).
- [x] Implementar batching/coalescing para eventos como `audio.analisis.actualizado` (último payload gana; flush ~50ms a suscriptores).
- [x] Implementar eliminación de eventos más antiguos cuando el buffer está lleno.
- [x] Priorización: eventos de transporte > eventos de UI > eventos de analítica.

**Estado**: ✅ Completado
**Nota**: Priorización por dominio (alta/normal/baja). Coalescing activo por defecto para eventos batchables; `flushBatch()` / `destruir()` para control explícito.

---

### 7. Ciclo de Vida de Suscripciones
- [x] Las suscripciones de UI se atan al montaje/desmontaje del componente (`useEventBus`).
- [x] Las suscripciones de servicios de fondo se atan a la sesión (`ServicioProyectoEventos`, `SessionScope`).
- [x] Documentar el patrón de uso en `docs/hoja-ruta/001-event-bus-lifecycle.md`.
- [x] Helper `useEventBus()` disponible como hook React con cleanup automático.
- [x] Soporte multi-evento: `useEventBus([{ nombre, manejador }])`.
- [x] Soporte `once` para eventos de una sola vez (`bus.once` / `SessionScope.once`).
- [x] Sesión IA: `iniciarSesionContextoIA` / `tienda.iniciarSesionIA()`.
- [x] Plugins: `crearGestorSuscripcionesPlugin`.

**Estado**: ✅ Completado
**Archivos**: `jas-wave/src/context/daw-context.tsx`, `shared/src/events/event-bus.ts`, `shared/src/events/ciclo-vida-suscripciones.ts`, `docs/hoja-ruta/001-event-bus-lifecycle.md`

---

### 8. Tests
- [x] Test: emisión y consumo de eventos
- [x] Test: orden causal garantizado
- [x] Test: unsubscribe efectivo
- [x] Test: replay buffer respeta capacidad
- [x] Test: backpressure no pierde eventos críticos
- [x] Test: eventos async respetan `correlationId`

**Estado**: ✅ Completado
**Archivos**: `shared/src/test/event-bus.test.ts`
**Nota**: Tests en `shared/src/test/event-bus.test.ts` cubriendo priorización, lifecycle, replay, batch/coalescing, schemas versionados, `fuente`/`version` en meta, `emitAsincrono`, backpressure, correlación y `SessionScope`.

---

### 9. Rendimiento
- [x] No hacer allocations innecesarias en el hot path.
- [x] Evaluar `eventemitter2` vs implementación nativa.
- [x] El bus no debe ser bottleneck en operaciones de alta frecuencia.

**Estado**: ✅ Completado
**Nota**: Se evaluó `eventemitter2` v6.4.9 (12M ops/sec vs 3.2M ops/sec de Node nativo, ~4x más rápido en emit puro). Sin embargo, se decidió mantener la implementación nativa con `Map`/`Set` porque:
  1. Nuestra implementación tiene features DAW-específicas que `eventemitter2` no ofrece: replay buffer con filtrado, priorización por dominio (transporte > UI), batch processing con agrupación.
  2. Envolver `eventemitter2` para añadir estas features eliminaría la ventaja de rendimiento.
  3. El rendimiento actual es más que suficiente para el volumen de eventos de un DAW.
  4. Se evita una dependencia externa innecesaria.

---

## Dependencias
- Ninguna (módulo foundation).

## Documentación Relacionada
- `docs/arquitectura/BUS-EVENTOS.md`
- `docs/arquitectura/VISION-GENERAL.md`
- `docs/00-RESUMEN-ARQUITECTURA.md`
