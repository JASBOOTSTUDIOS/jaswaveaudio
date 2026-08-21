# Modelo de Estado

## 1. Principio Fundamental

El estado del DAW es un **árbol centralizado, serializable y lógicamente inmutable**. Las mutaciones de dominio fluyen a través del Sistema de Comandos. La UI es una proyección de este estado; cambios puramente visuales pueden usar `establecerEstado` o comandos UI sin undo.

```typescript
interface DAWState {
  project: ProjectState;
  transport: TransportState;
  selection: EstadoSeleccion;
  ui: UIState;
  atajos: ConfiguracionAtajos;
  capabilities: CapabilityRegistry;
  commandStack: CommandStack;
  busEventos: EventoDominio[];
  contextoIA: ContextoIA;
  cache: Cache;
  proxies: Proxy[];
  historial: Historial;
  // + metadatos: marcaTiempo, version, esquemaVersion, sesionId, …
}
```

## 2. Estado del Proyecto

```typescript
interface ProjectState {
  id: string;
  nombre: string;
  ruta?: string;
  sampleRate: number;
  bitDepth: number;
  bpm: BPM;
  timeSignature: TimeSignature;
  timeline: TimelineState;
  tracks: Track[];
  routing: RoutingMatrix;
  master: MasterChannel;
  analysis: ProjectAnalysis;
  metadata: ProjectMetadata;
}
```

### Tracks

Unión discriminada (español): `audio` | `midi` | `instrumento` | `carpeta` | `bus` | `vca` | `grupo` | `master`.

Campos base: `id`, `nombre`, `color`, `silenciada`, `soloActiva`, `armada`, `volumen`, `paneo`, `automatizaciones`, `plugins`, `envios`, …

- Carpeta / grupo: `hijos: string[]`
- Bus: `tracksEnviando` (+ `receives` en BaseTrack)
- Audio/MIDI: `entrada?` / `salida?`

## 3. Mutaciones e inmutabilidad

- Dominio: solo vía `CommandExecutor.execute` (con `inverseType` + `inversePayload` para undo).
- Selección: comandos `selection.set` / `selection.clear` (sin undo).
- UI transitoria: zoom/scroll/colapso mixer vía `tienda.establecerEstado`; paleta vía `ui.setPalette`.
- La pila de undo **no** guarda snapshots: guarda comandos con inverso.

## 4. Serialización

- Preferir `serializarEstado` / `deserializarEstado` (`shared/src/state/serializar-estado.ts`).
- `Map` de cache se serializa; `ArrayBuffer` se omite (marcador vacío al revivir) — excepción documentada.
- Operaciones: `exportarEstadoDAW`, `importarEstadoDAW`, `clonarEstadoDAW`, `resetearEstadoDAW`.

## 5. Query API (IA)

`ConsultaDAW` implementa `DAWQuery` en lectura pura. `duplicar*` planifica IDs/nombres **sin mutar**; la aplicación va por comandos de dominio.

## 6. UIState (separado del proyecto)

Layout, zoom/scroll, herramienta, diálogos, `paletaComandosAbierta`, mixer UI, etc. Los cambios de UI no generan entradas de undo de proyecto.

## 7. Runtime

| Pieza | Ubicación |
|-------|-----------|
| Factory | `crearEstadoInicial()` |
| Tienda | `crearTiendaDAW()` |
| Query | `ConsultaDAW` |
| Watch | `crearObservadorEstado()` |
| Validación / migraciones | `validarEstado`, `ejecutarMigraciones` |

Ver detalle en `docs/hoja-ruta/002-state-model.md`.
