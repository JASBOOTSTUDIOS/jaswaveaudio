# Routing

## Objetivo
Implementar el sistema de routing: buses, sends, returns y conexiones entre tracks. El audio debe poder enrutarse correctamente entre tracks, buses y master.

## Criterios de Aceptación
- [ ] Buses, sends, returns
- [ ] El audio se enruta correctamente entre tracks
- [ ] Flexibilidad de routing
- [ ] Sin feedback loops no deseados

## Requerimientos Detallados

### 1. RoutingMatrix
Definir `RoutingMatrix`:
- `buses: Bus[]`
- `sends: Send[]`
- `returns: Return[]`
- `routes: Route[]`

### 2. Bus
Definir `Bus`:
- `id: string`
- `name: string`
- `volume: Decibel`
- `pan: StereoPan`
- `muted: boolean`
- `soloed: boolean`
- `inputs: string[]` — IDs de tracks o buses que envían a este bus.
- `output: 'master' | string` — a dónde se envía la salida del bus.

### 3. Send
Definir `Send`:
- `id: string`
- `sourceTrackId: string`
- `targetBusId: string`
- `amount: Decibel` — cantidad de envío.
- `muted: boolean`
- `preFader: boolean` — si se lee antes o después del fader de volumen.

### 4. Return
Definir `Return`:
- `id: string`
- `busId: string`
- `volume: Decibel`
- `pan: StereoPan`
- `muted: boolean`

### 5. Comandos
- `bus.create`:
  - Payload: `name: string`.
  - Crear bus en routing matrix.
  - Emitir `bus.created`.
- `bus.delete`:
  - Payload: `busId`.
  - Eliminar bus y limpiar sends asociados.
  - Emitir `bus.deleted`.
- `send.create`:
  - Payload: `sourceTrackId`, `targetBusId`, `amount`, `preFader?`.
  - Validar que track y bus existen.
  - Emitir `send.created`.
- `send.delete`:
  - Payload: `sendId`.
  - Emitir `send.deleted`.
- `send.update`:
  - Payload: `sendId`, `amount?`, `muted?`, `preFader?`.
  - Emitir `send.updated`.

### 6. DSP Graph para Routing
- El motor construye el grafo DSP según el routing:
  - Tracks → sends → buses → returns → master.
  - Tracks sin sends van directo a master.
- El grafo se reconstruye cuando cambia el routing.
- Detección de ciclos (feedback loops):
  - No permitir ciclos en el grafo de routing.
  - Validar antes de crear send/bus.

### 7. Validación
- No crear bus con nombre duplicado.
- No crear send a bus inexistente.
- No crear send de track inexistente.
- No permitir ciclos en routing.
- No eliminar bus con sends activos (o reenviar sends a master).

### 8. UI
- En mixer: sección de sends por track.
- Panel de routing: vista gráfica de conexiones.
- Drag & drop para crear conexiones.

### 9. Tests
- Test: crear bus lo agrega a routing matrix
- Test: eliminar bus limpia referencias
- Test: send conecta track a bus correctamente
- Test: DSP graph refleja el routing
- Test: ciclo de routing es detectado y rechazado
- Test: cambios en routing se reflejan en mezcla

## Dependencias
- Motor de Audio
- State Model
- Command System
- Event Bus

## Documentación Relacionada
- `docs/arquitectura/MODELO-ESTADO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
