# Tracks

## Objetivo
Implementar el CRUD completo de tracks: audio, MIDI, instrumento, bus y folder. Las tracks son los canales individuales del DAW donde se organiza el audio, los instrumentos y el routing.

## Criterios de Aceptación
- [ ] Crear tracks de cualquier tipo
- [ ] Eliminar tracks
- [ ] Renombrar tracks
- [ ] Mute/Solo por track
- [ ] Gestión de volumen y paneo

## Requerimientos Detallados

### 1. Tipos de Tracks
Soporte para 5 tipos:
- **AudioTrack**: contiene `AudioClip[]`, `input?: AudioInput`
- **MidiTrack**: contiene `MidiClip[]`, `input?: MidiInput`, `output?: MidiOutput`
- **InstrumentTrack**: contiene `MidiClip[]`, `instrument: PluginInstance`
- **FolderTrack**: contiene `children: string[]` (IDs de tracks)
- **BusTrack**: contiene `receives: string[]` (IDs de tracks que envían)

Cada tipo comparte `BaseTrack`:
- `id: string`
- `name: string`
- `color: string`
- `muted: boolean`
- `soloed: boolean`
- `armed: boolean`
- `volume: Decibel`
- `pan: StereoPan`
- `automation: AutomationLane[]`
- `plugins: PluginInstance[]`
- `sends: Send[]`
- `inserts: Insert[]`
- `metadata: Record<string, unknown>`

### 2. Creación de Track
- `track.create` comando:
  - Payload: `type: TrackType`, `name: string`, `color?: string`
  - Validar nombre único dentro del proyecto.
  - Asignar color por defecto si no se proporciona.
  - Generar ID único.
  - Insertar en posición por defecto (final del array) o posición especificada.
  - Emitir `track.created`.
- Comandos específicos por tipo:
  - `track.createAudio`
  - `track.createMidi`
  - `track.createInstrument`
  - `track.createFolder`
  - `track.createBus`

### 3. Eliminación de Track
- `track.delete` comando:
  - Payload: `trackId: string`
  - Validar que el track existe.
  - Si es folder, validar que no tiene children (o eliminar children recursivamente?).
  - Eliminar track y limpiar referencias en routing, automation, etc.
  - Emitir `track.deleted`.
- Riesgo: `dangerous` porque es destructivo y no tiene undo automático en todos los casos.

### 4. Renombrar Track
- `track.rename` comando:
  - Payload: `trackId: string`, `name: string`
  - Validar que el nuevo nombre es único.
  - Emitir `track.renamed`.

### 5. Mute/Solo
- `track.mute` comando:
  - Payload: `trackId: string`, `muted: boolean`
  - Emitir `track.muted`.
- `track.solo` comando:
  - Payload: `trackId: string`, `soloed: boolean`
  - Emitir `track.soloed`.
- Lógica de solo: si algún track está en solo, solo se escuchan los tracks en solo.

### 6. Volumen y Paneo
- `track.volume.set` comando:
  - Payload: `trackId: string`, `dB: number`
  - Validar rango: -60 dB a +12 dB.
  - Emitir `track.volume.changed`.
- `track.pan.set` comando:
  - Payload: `trackId: string`, `pan: number` (normalizado -1 a 1)
  - Emitir `track.pan.changed`.

### 7. Armado para Grabación
- `track.arm` comando:
  - Payload: `trackId: string`, `armed: boolean`
  - Solo aplicable a AudioTrack y MidiTrack.
  - Emitir `track.armed`.

### 8. Validación
- Nombre de track único en el proyecto.
- No se puede eliminar un track que tiene clips (o se eliminan clips? definir política).
- Volumen dentro de rango permitido.
- No se puede crear track en proyecto de solo-lectura.

### 9. Integración con Routing
- Al crear BusTrack, debe poder recibir sends de otros tracks.
- Al eliminar track, se deben limpiar sends y receives asociados.
- FolderTrack: children deben ser tracks válidas del mismo proyecto.

### 10. Tests
- Test: crear track de cada tipo produce estado válido
- Test: eliminar track lo remueve del estado
- Test: renombrar con nombre duplicado falla
- Test: mute/solo funcionan correctamente
- Test: volumen dentro de rango es aceptado, fuera es rechazado
- Test: track.arm solo aplica a audio/midi
- Test: eliminar track limpia referencias de routing
- Test: eventos se emiten correctamente

## Dependencias
- State Model
- Command System
- Validation Layer
- Event Bus

## Documentación Relacionada
- `docs/arquitectura/MODELO-ESTADO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
