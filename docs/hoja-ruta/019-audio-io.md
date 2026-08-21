# Audio I/O

## Objetivo
Implementar la entrada/salida de audio del motor nativo: selección de dispositivos, configuración de sample rate y buffer size, y manejo de flujos de audio en tiempo real.

## Criterios de Aceptación
- [ ] Entrada/salida con selección de dispositivo
- [ ] Se puede grabar y reproducir por la interfaz del sistema
- [ ] Configuración de sample rate y buffer size
- [ ] Manejo de xruns y underruns

## Requerimientos Detallados

### 1. Dispositivos
- Listar dispositivos de entrada y salida disponibles.
- Permitir selección de dispositivo por el usuario.
- Dispositivos por defecto del sistema.
- Manejo de dispositivos que se conectan/desconectan en runtime.

### 2. Configuración
- Sample rates soportados: 44100, 48000, 96000 (configurable).
- Buffer sizes: 64, 128, 256, 512, 1024, 2048 samples.
- El usuario puede cambiar configuración en Settings.
- Validar que la configuración es soportada por el dispositivo.

### 3. Flujos
- Flujo de captura (input): micrófono, interface.
- Flujo de reproducción (output): altavoces, auriculares.
- Flujos duplex (entrada y salida simultánea).
- Los flujos se abren/cierran bajo demanda.

### 4. Buffers
- Buffers de entrada/salida gestionados por el motor.
- Double buffering para evitar bloqueos.
- Alineación de memoria para SIMD (si aplica en C++).

### 5. Xruns y Underruns
- Detectar xruns (buffer underrun/overrun).
- Logging de xruns con timestamp.
- Recuperación automática sin crash.
- Notificar al usuario si los xruns son frecuentes (sugerir aumentar buffer size).

### 6. Pruebas
- Test: stream de entrada captura audio correctamente
- Test: stream de salida reproduce audio sin distorsión
- Test: cambio de dispositivo no crashea
- Test: configuración inválida se rechaza
- Test: xrun se detecta y se recupera
- Test: duplex funciona simultáneamente

## Dependencias
- Motor de Audio
- Native Bridge
- Event Bus

## Documentación Relacionada
- `docs/audio/MOTOR-AUDIO.md`
