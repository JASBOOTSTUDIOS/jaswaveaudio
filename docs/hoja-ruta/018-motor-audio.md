# Motor de Audio

## Objetivo
Implementar el motor de audio nativo en C++ con audio thread dedicado. El motor debe manejar reproducción, grabación, DSP, mezcla, routing y procesamiento de plugins en tiempo real, sin bloquear el hilo de audio.

## Criterios de Aceptación
- [ ] Motor en C++ con audio thread dedicado
- [ ] Reproducción sin clicks ni glitches
- [ ] Comunicación con Electron mediante Native Bridge
- [ ] Procesamiento determinista

## Requerimientos Detallados

### 1. Arquitectura
- Motor implementado en C++ como librería compartida (`.dll` / `.so` / `.dylib`).
- Cargado dinámicamente por Electron mediante FFI o IPC local.
- Hilo de audio dedicado con máxima prioridad.
- Hilos de trabajo separados para:
  - Procesamiento de plugins
  - Análisis
  - Renderizado offline

### 2. Audio Thread
- Nunca se bloquea.
- Nunca asigna memoria dinámicamente durante el procesamiento.
- Nunca hace llamadas de red o al LLM.
- Usa memoria preasignada (pools).
- Prioridad máxima en el sistema operativo.

### 3. Audio I/O
- Captura de entrada (micrófono, interface).
- Reproducción de salida (altavoces, auriculares).
- Selección de dispositivo por el usuario.
- Configuración de sample rate y buffer size.
- Manejo de xruns y underruns.

### 4. DSP Básico
- Ganancia por track.
- Paneo por track.
- Clip gain.
- Filtros básicos (HPF, LPF) para MVP.
- Todo el DSP se ejecuta en el audio thread.

### 5. Mezcla
- Mezcla de múltiples tracks.
- Aplicación de volúmenes y paneos.
- Suma a bus o master.
- Compensación de latencia de plugins.

### 6. DSP Graph
- Grafo dinámico de procesamiento:
  - Nodos: track, plugin, bus, output.
  - Aristas: conexiones entre nodos.
- El grafo se reconstruye cuando cambia el routing o se cargan/descargan plugins.
- Procesamiento en orden topológico.

### 7. Latencia
- Latencia total = dispositivo + plugins + routing.
- Compensación automática de latencia de plugins.
- Objetivo MVP: < 20ms en configuraciones medias.

### 8. Comunicación con Electron
- Native Bridge como única vía de comunicación.
- Comandos asíncronos: `startPlayback`, `stopPlayback`, `seek`, etc.
- Eventos desde el motor hacia Electron:
  - `transport.positionChanged`
  - `audio.analysis.updated`
  - `audio.xrun`
- La comunicación debe ser no bloqueante.

### 9. Manejo de Errores
- Si el motor crashea, el DAW debe recuperarse gracefully.
- Watchdog para detectar si el hilo de audio deja de responder.
- Reinicio del motor sin perder el proyecto.

### 10. Configuración
- `AudioEngineConfig`:
  - `sampleRate: number`
  - `bufferSize: number`
  - `inputDeviceId?: string`
  - `outputDeviceId?: string`
- El usuario puede cambiar configuración en Settings.

### 11. Tests
- Test: reproducción de buffer de prueba produce salida correcta
- Test: ganancia se aplica correctamente
- Test: paneo distribuye señal correctamente
- Test: manejo de xrun no crashea
- Test: latencia total dentro de presupuesto
- Test: grabar y reproducir round-trip
- Test: cambio de dispositivo no pierde estado

## Dependencias
- Native Bridge
- State Model
- Event Bus
- Command System

## Documentación Relacionada
- `docs/audio/MOTOR-AUDIO.md`
- `docs/arquitectura/VISION-GENERAL.md`
