# ADR-0005: Interfaz del Motor de Audio

## Estado

Aceptado. Implementación del bridge N-API + C++: ver [ADR-0009](./ADR-0009-native-audio-bridge-napi.md).

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
Native Audio Bridge (N-API / IPC tipado)
        ↓
Native Audio Engine (C++)
```

Reglas:
1. El motor de audio se implementará en **C++** por rendimiento y control.
2. La comunicación se hace mediante FFI (N-API) o IPC local tipado.
3. El hilo de audio es completamente independiente de los hilos de UI e IA.
4. Todas las órdenes al motor son asíncronas y no bloqueantes.
5. El estado del motor se comunica mediante eventos / lecturas ligeras, no polling agresivo del renderer.

Contrato detallado, build y fallback Web Audio: **ADR-0009**.

## Consecuencias

### Positivas
- UI responsiva sin importar la carga de audio
- Motor de audio puede evolucionar independientemente
- Seguridad de memoria en el hilo crítico (C++)
- Facilita portabilidad futura

### Negativas
- Complejidad de comunicación entre procesos / addon
- Overhead de serialización en la interfaz
- Curva de aprendizaje en C++ para el motor

### Riesgos
- Latencia en la comunicación
- Mitigación: interfaz de baja overhead, buffers compartidos cuando sea posible
- Errores en el motor pueden tumbar el proceso
- Mitigación: fallback Web Audio, build opcional, watchdog futuro
