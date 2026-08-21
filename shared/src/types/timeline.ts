/**
 * Estado de la línea de tiempo del proyecto.
 *
 * Propósito:
 *   Modelar la ventana de visualización y navegación de la línea de tiempo
 *   del DAW, incluyendo su duración total, loop, región de punch y zoom.
 *
 * Importancia:
 *   - Centraliza la configuración visual y de navegación del timeline.
 *   - Permite sincronizar la UI con el motor de transporte y grabación.
 *   - Facilita el cálculo de posiciones visibles para el renderizado
 *     eficiente de clips y waveforms.
 *
 * Función:
 *   Exporta TimelineState con duración, loop, punch, zoom, scroll,
 *   playhead, snap, marcadores y escenas.
 */

import type { TimePosition, TimeDuration } from './tiempo';

export interface TimelineState {
  duracion: TimeDuration;
  loop: {
    activo: boolean;
    inicio: TimePosition;
    fin: TimePosition;
  };
  punch: {
    activo: boolean;
    inicio: TimePosition;
    fin: TimePosition;
  };
  zoomHorizontal: number;
  zoomVertical: number;
  scrollX: number;
  scrollY: number;
  playhead: TimePosition;
  snap: boolean;
  snapTipo: 'beat' | 'bar' | 'frame' | 'none';
  snapValor: number;
  marcadores: import('./entidades').Marcador[];
  escenas: import('./entidades').Escena[];
  tracksOrden: string[];
  alturaTrack: number;
  compasInicio: number;
  compasFin: number;
}
