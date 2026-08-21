# ADR-0005: Interfaz del Motor de Audio

## Contexto

Electron no debe encargarse del procesamiento de audio en tiempo real. Necesitamos un motor nativo separado que:
- Ejecute en un hilo de alta prioridad
- No bloquee nunca
- No asigne memoria dinámicamente durante el procesamiento
- Se comunique eficientemente con Electron

## Decisión

Diseñar una **interfaz clara entre Electron y el motor nativo** mediante un Native Bridge:

```
Electron Application
        ↓
Native Audio Bridge
        ↓
Native Audio Engine (C++ futuro)
```

Reglas:
1. El motor de audio se implementará en C++ por rendimiento y control y rendimiento.
2. La comunicación se hace mediante FFI (Foreign Function Interface) o IPC local.
3. El hilo de audio es completamente independiente de los hilos de UI e IA.
4. Todas las órdenes al motor son asíncronas y no bloqueantes.
5. El estado del motor se comunica mediante eventos, no polling.

```typescript
interface NativeBridgeAPI {
  initialize(config: AudioEngineConfig): Promise<void>;
  startPlayback(): Promise<void>;
  stopPlayback(): Promise<void>;
  seek(position: TimePosition): Promise<void>;
  getAnalysis(trackId: string): Promise<AudioAnalysis>;
  // ... más operaciones
}
```

## Consecuencias

### Positivas
- UI responsiva sin importar la carga de audio
- Motor de audio puede evolucionar independientemente
- Seguridad de memoria en el hilo crítico (C++)
- Facilita portabilidad futura

### Negativas
- Complejidad de comunicación entre procesos
- Overhead de serialización en la interfaz
- Curva de aprendizaje en C++ para el motor

### Riesgos
- Latencia en la comunicación entre procesos
- Mitigación: diseño de interfaz de baja overhead, buffers compartidos cuando sea posible
- Errores en el motor crash todo el DAW
- Mitigación: watchdog, restart graceful del motor, sandboxing
