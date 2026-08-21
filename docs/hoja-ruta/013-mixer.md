# Mixer

## Objetivo
Implementar la vista de mezcla del DAW: canales verticales con faders, panorámicos, mute/solo, inserts y sends. El mixer refleja y controla el estado de las tracks.

## Criterios de Aceptación
- [ ] Volumen por track
- [ ] Panorámica por track
- [ ] Mute/Solo por track
- [ ] Inserts (FX chains) visibles
- [ ] Sends visibles
- [ ] Master fader

## Requerimientos Detallados

### 1. Estructura del Mixer
- El mixer es una vista de los `BaseTrack` del proyecto.
- Cada track se representa como un canal vertical.
- El master es un canal especial al final.

### 2. Volumen
- `mixer.setVolume` comando (o `track.volume.set`):
  - Payload: `trackId: string`, `dB: number`
  - Rango: -60 dB a +12 dB.
  - Representación en UI: fader vertical con escala logarítmica.
  - Valor numérico visible en dB.
- El fader debe actualizar en tiempo real si el valor cambia por automatización.

### 3. Panorámica
- `mixer.setPan` comando (o `track.pan.set`):
  - Payload: `trackId: string`, `pan: number` (-1 izquierda, 0 centro, +1 derecha)
  - Representación en UI: knob o potenciómetro horizontal.
- Pan debe aplicar ley de panoreo (ej: -3 dB en centro).

### 4. Mute/Solo
- `mixer.mute` comando:
  - Payload: `trackId: string`, `muted: boolean`
  - UI: botón con indicador visual (rojo cuando activo).
- `mixer.solo` comando:
  - Payload: `trackId: string`, `soloed: boolean`
  - UI: botón con indicador visual (amarillo cuando activo).
- Lógica de solo:
  - Si ningún track está en solo, se escuchan todos (excepto muteados).
  - Si al menos un track está en solo, solo se escuchan los tracks en solo.

### 5. Inserts (FX Chains)
- Cada track tiene `inserts: Insert[]` — cadena de plugins en serie.
- En el mixer, mostrar nombre de cada plugin en la cadena.
- Click en insert abre Plugin Editor.
- El mixer NO debe permitir editar parámetros de plugin directamente (eso va en Inspector/Plugin Editor).

### 6. Sends
- Cada track tiene `sends: Send[]`:
  - `Send`: `targetBusId: string`, `amount: Decibel`, `muted: boolean`
- En el mixer, mostrar cantidad de send y nombre del bus destino.
- UI: knob o fader pequeño por send.

### 7. Master Channel
- El master es un canal especial al final del mixer.
- `master.volume.set` comando:
  - Payload: `dB: number`
- `master.pan.set` comando:
  - Payload: `pan: number`
- El master refleja `ProjectState.master`.

### 8. VU Meters
- Mostrar nivel de señal en cada canal:
  - Peak (pico)
  - RMS (valor promedio)
  - Opcional: LUFS
- Los valores se actualizan mediante eventos `audio.analysis.updated`.
- No hacer polling; suscribirse al Event Bus.

### 9. UI
- Canales verticales con:
  - Nombre de track (editable con doble click)
  - Fader de volumen
  - Valor numérico de volumen
  - Panorámico
  - Botones Mute/Solo
  - Inserts (lista de plugins)
  - Sends (lista de sends)
  - VU meter
- Diseño inspirado en mezcladores tradicionales pero moderno.
- Scroll vertical si hay más tracks que altura visible.

### 10. Accesibilidad
- Navegación por teclado entre canales.
- Atajos: M = mute, S = solo, flechas para volumen.

### 11. Tests
- Test: cambiar volumen emite evento correcto
- Test: mute/solo funcionan
- Test: solo lógico se aplica correctamente
- Test: inserts y sends reflejan el estado
- Test: master refleja ProjectState.master
- Test: VU meters se actualizan con eventos de análisis

## Dependencias
- State Model
- Command System
- Event Bus
- Analysis (para VU meters)

## Documentación Relacionada
- `docs/arquitectura/MODELO-ESTADO.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
- `docs/audio/ANALISIS.md`
