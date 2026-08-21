# Ciclo de Vida de Suscripciones

## Objetivo
Patrones de uso del Event Bus según el tipo de consumidor. La API real está en español (`busEventos`, `transporte.*`, `Suscripcion`).

## Helpers disponibles

| Consumidor | Helper | Ubicación |
|------------|--------|-----------|
| UI React | `useEventBus` | `jas-wave/src/context/daw-context.tsx` |
| Agrupar varias subs | `crearGrupoSuscripciones` | `shared/src/events/event-bus.ts` |
| Sesión (IA, playback, etc.) | `crearSessionScope` | `shared/src/events/event-bus.ts` |
| Servicio initialize/shutdown | `ServicioProyectoEventos` | `shared/src/events/ciclo-vida-suscripciones.ts` |
| Sesión IA | `iniciarSesionContextoIA` / `tienda.iniciarSesionIA()` | ciclo-vida + tienda |
| Plugins | `crearGestorSuscripcionesPlugin` | ciclo-vida-suscripciones.ts |

## 1. Tipos de Suscripciones

### 1.1 Suscripciones de UI
- **Alcance**: Componentes React (renderer).
- **Ciclo de vida**: Montaje → desmontaje (cleanup automático).
- **Patrón**: `useEventBus` (preferido). No hace falta `useEffect` manual.

```typescript
import { useEventBus } from '@/src/context/daw-context';
import { EventosTransporte } from '@jaswave/shared';

function Timeline() {
  useEventBus(EventosTransporte.posicionCambiada, (position) => {
    // actualizar playhead
  });

  // Multi-evento:
  useEventBus([
    { nombre: EventosTransporte.iniciado, manejador: () => { /* … */ } },
    { nombre: EventosTransporte.detenido, manejador: () => { /* … */ } },
  ]);
}
```

Equivalente manual (solo si no podés usar el hook):

```typescript
useEffect(() => {
  const sub = busEventos.on(EventosTransporte.posicionCambiada, handler);
  return () => sub.unsubscribe(); // alias de cancelarSuscripcion()
}, []);
```

### 1.2 Suscripciones de Servicios
- **Alcance**: Servicios de fondo / proceso principal.
- **Ciclo de vida**: `initialize()` → `shutdown()`.
- **Patrón**: `ServicioProyectoEventos` o `crearSessionScope`.

```typescript
import { busEventos, ServicioProyectoEventos } from '@jaswave/shared';

const servicio = new ServicioProyectoEventos(busEventos, {
  onProyectoCargado: (project) => { /* … */ },
  onTrackCreada: (track) => { /* … */ },
});

servicio.initialize();
// …
servicio.shutdown(); // cancela todas las suscripciones
```

### 1.3 Suscripciones de AI Harness
- **Alcance**: Context Manager / memorias de sesión.
- **Ciclo de vida**: por sesión de conversación.
- **Patrón**: `tienda.iniciarSesionIA()` / `tienda.finalizarSesionIA()`, o `iniciarSesionContextoIA(bus)`.

```typescript
const scope = tienda.iniciarSesionIA();
// scope escucha proyecto/track/clip y alimenta memorias de sesión
tienda.finalizarSesionIA(); // destruye scope + clearSession de memorias
```

### 1.4 Suscripciones de Plugins
- **Alcance**: instancias en el Plugin Host.
- **Ciclo de vida**: cargar → descargar.
- **Patrón**: un `SessionScope` por plugin vía `crearGestorSuscripcionesPlugin`.

```typescript
import { busEventos, crearGestorSuscripcionesPlugin, EventosTransporte } from '@jaswave/shared';

const host = crearGestorSuscripcionesPlugin(busEventos);

host.alCargar('eq-1', (scope) => {
  scope.on(EventosTransporte.posicionCambiada, (pos) => { /* sync plugin */ });
});

host.alDescargar('eq-1'); // cancela solo ese plugin
host.shutdown();          // descarga todos
```

## 2. Reglas de Lifecycle

### 2.1 Todo `on()` debe tener cleanup
- Preferí `SessionScope.destruir()`, `grupo.cancelarTodas()`, `useEventBus` o `sub.unsubscribe()`.
- Si no podés garantizar limpieza → `once()` / `scope.once()`.

### 2.2 UI: cleanup automático
- `useEventBus` cancela al desmontar o al cambiar nombres de evento.
- Handlers estables vía ref (no re-suscribe al cambiar el callback).

### 2.3 Servicios: `initialize()` / `shutdown()`
- `initialize()`: crear scope y suscribir.
- `shutdown()`: destruir scope (idempotente).

### 2.4 No perder la referencia del manejador
```typescript
// ❌ Mal: no podés off() por identidad si usás anónimas con bus.off
busEventos.on('evento.x', () => { /* … */ });

// ✅ Bien
const manejador = (payload: unknown) => { /* … */ };
const sub = busEventos.on('evento.x', manejador);
sub.unsubscribe();
```

Con `SessionScope` / `ServicioProyectoEventos` no necesitás guardar el handler: `destruir()` limpia todo.

### 2.5 Agrupar suscripciones relacionadas
```typescript
import { crearGrupoSuscripciones, busEventos, EventosTransporte } from '@jaswave/shared';

const grupo = crearGrupoSuscripciones(busEventos);
grupo.agregar(busEventos.on(EventosTransporte.iniciado, onStarted));
grupo.agregar(busEventos.on(EventosTransporte.detenido, onStopped));
grupo.cancelarTodas();
```

## 3. Anti-patterns

### 3.1 Suscripciones fantasma
```typescript
class MalEjemplo {
  constructor(bus: BusEventos) {
    bus.on('sistema.error', this.handle); // nunca se limpia
  }
}
```

### 3.2 Duplicar el mismo handler
El bus deduplica el mismo `manejador` en el mismo evento, pero no uses dos wrappers distintos al mismo propósito.

### 3.3 Suscribir dentro de loops por entidad
Suscribí una vez al dominio (`track.actualizada`) y filtrá por `trackId` en el handler.

## 4. Ejemplo: Servicio de Proyecto

```typescript
import {
  busEventos,
  ServicioProyectoEventos,
  EventosProyecto,
  EventosTrack,
} from '@jaswave/shared';

export function arrancarServicioProyecto() {
  const servicio = new ServicioProyectoEventos(busEventos, {
    onProyectoCargado: (payload) => console.log('cargado', payload),
    onProyectoGuardado: () => console.log('guardado'),
    onProyectoCerrado: () => console.log('cerrado'),
    onTrackCreada: (track) => console.log('track', track),
    onTrackEliminada: (payload) => console.log('deleted', payload),
  });
  servicio.initialize();
  return servicio;
}
```

Nombres de eventos reales: `proyecto.cargado`, `track.creada`, `transporte.posicionCambiada` (ver `nombres-eventos.ts`).

## 5. Verificación

```typescript
it('limpia suscripciones en shutdown', () => {
  const bus = new BusEventosMemoria({ batchHabilitado: false });
  const servicio = new ServicioProyectoEventos(bus, {
    onProyectoCargado: () => {},
    onTrackCreada: () => {},
  });
  servicio.initialize();
  expect(bus.cantidadManejadores()).toBeGreaterThan(0);

  servicio.shutdown();
  expect(bus.cantidadManejadores()).toBe(0);
  expect(servicio.estaActivo()).toBe(false);
  bus.destruir();
});
```

## 6. Relación con Otros Documentos

- `docs/hoja-ruta/001-event-bus.md` — implementación del bus
- `docs/arquitectura/BUS-EVENTOS.md` — arquitectura general
- `docs/arquitectura/SISTEMA-COMANDOS.md` — emisión de eventos desde comandos
- `docs/arquitectura/VISION-GENERAL.md` — visión del DAW
