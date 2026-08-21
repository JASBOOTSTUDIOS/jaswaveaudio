# Timeline

## Objetivo
Implementar la vista de timeline: clips visuales (forma de onda para audio, piano roll para MIDI), playhead, reglas de tiempo, marcadores, regiones, snapping, zoom y scroll.

## Criterios de Aceptación
- [ ] Timeline visual con clips y playhead
- [ ] Reglas de tiempo y snapping
- [ ] Zoom y scroll
- [ ] Playhead se actualiza en tiempo real
- [ ] Selección de clips

## Requerimientos Detallados

### 1. Concepto
- La Timeline es la vista principal de edición.
- Muestra clips organizados por tracks en el eje vertical y por tiempo en el eje horizontal.
- El playhead indica la posición actual de transporte.
- La timeline es una proyección del estado; no contiene estado propio.

### 2. Ejes
- **Eje vertical**: tracks apiladas. Cada track tiene su "lane" (carril) donde se disponen los clips.
- **Eje horizontal**: tiempo. Reglas de tiempo con unidades configurables (segundos, bars+beats, samples).

### 3. Clips Visuales
- **AudioClip**: mostrar forma de onda (`WaveformSummary`).
  - Color del clip.
  - Nombre del clip.
  - Fade in/out visual.
  - Mute indicator.
- **MidiClip**: mostrar piano roll simplificado.
  - Notas como rectángulos en altura (pitch) y ancho (duración).
  - Color por canal o por pitch.

### 4. Playhead
- Línea vertical que indica la posición actual.
- Se actualiza mediante eventos `transport.positionChanged`.
- Se puede arrastrar para seek (con snapping).
- Debe tener prioridad de dibujo alta para parpadear sin ghosting.

### 5. Reglas de Tiempo
- Regla horizontal con marcas de tiempo.
- Marcas principales según zoom level:
  - Zoom out: cada segundo o cada barra.
  - Zoom in: cada beat o cada 10ms.
- Formato configurable: `00:00:00.000` o `1.1.1.000` (bars.beats.units).

### 6. Zoom y Scroll
- **Zoom horizontal**: cambiar escala de tiempo.
  - Acercar: más detalle, menos tiempo visible.
  - Alejar: menos detalle, más tiempo visible.
- **Zoom vertical**: cambiar altura de tracks.
- **Scroll horizontal**: mover ventana de tiempo.
- **Scroll vertical**: mover vista de tracks.
- Zoom con rueda del mouse + Ctrl.
- Scroll con rueda del mouse o arrastre de espacio vacío.

### 7. Snapping
- Snap a:
  - Inicio de proyecto
  - Inicio de clips
  - Fin de clips
  - Grid (beats, bars, seconds)
  - Marcadores
  - Regiones
- Configurable: snap on/off, snap resolution.
- Al mover/redimensionar clip, mostrar guías de snapping.

### 8. Marcadores y Regiones
- `Marker`: `id`, `name`, `position: TimePosition`, `color`
- `Region`: `id`, `name`, `start: TimePosition`, `end: TimePosition`, `color`
- Visualización en timeline:
  - Marcadores: línea vertical con label.
  - Regiones: área sombreada entre start y end.
- Comandos:
  - `marker.create`, `marker.delete`, `marker.move`
  - `region.create`, `region.delete`, `region.move`

### 9. Selección
- Click en clip: seleccionar clip.
- Shift+Click: selección múltiple.
- Click en track header: seleccionar track completa.
- Arrastrar en espacio vacío: rubber band selection.
- La selección se refleja en `SelectionState` del DAWState.

### 10. Interacciones
- **Mover clip**: drag & drop con snapping.
- **Redimensionar clip**: drag en borde izquierdo/derecho.
- **Dividir clip**: herramienta de corte o shortcut (S).
- **Zoom**: rueda mouse + Ctrl, o slider.
- **Seek**: click en regla de tiempo o arrastre de playhead.
- **Context menu**: click derecho en clip/track para acciones rápidas.

### 11. Performance
- Usar Canvas para dibujar waveforms y clips (no DOM).
- Virtualización: solo renderizar clips visibles en el viewport.
- `requestAnimationFrame` para actualizaciones de playhead.
- Memoización de cálculos de posición.

### 12. Tests
- Test: clips se posicionan correctamente según zoom
- Test: snapping funciona en resoluciones configurables
- Test: playhead se actualiza con eventos de transporte
- Test: selección múltiple funciona
- Test: zoom y scroll funcionan correctamente
- Test: marcadores y regiones se renderizan
- Test: dividir clip crea dos clips correctamente

## Dependencias
- State Model
- Event Bus
- Command System
- Analysis (para waveforms)

## Documentación Relacionada
- `docs/arquitectura/MODELO-ESTADO.md`
- `docs/arquitectura/BUS-EVENTOS.md`
- `docs/interfaz/ARQUITECTURA-UI.md`
