/**
 * Proyección de línea de tiempo en coordenadas de CONTENIDO.
 * El scroll lo aplica el DOM (overflow); beatToPixel NO resta scrollX.
 */

export interface TimelineProjectionOptions {
  pixelsPerBeat: number
  viewportWidth: number
  scrollX: number
  bpm: number
}

export interface TimelineProjection {
  viewportWidth: number
  pixelsPerBeat: number
  scrollX: number
  timeToPixel(seconds: number): number
  pixelToTime(pixel: number): number
  /** Coordenada X en el contenido (sin restar scroll). */
  beatToPixel(beat: number): number
  /** pixel relativo al viewport visible → beat (suma scrollX). */
  pixelToBeat(pixel: number): number
  /** pixel absoluto en contenido → beat. */
  contentPixelToBeat(contentPixel: number): number
  clampPixel(pixel: number): number
  zoomAt(
    currentZoom: number,
    /** Cursor X relativo al viewport (client - rect.left). */
    cursorViewportX: number,
    direction: 'in' | 'out',
    minZoom: number,
    maxZoom: number,
  ): { zoom: number; scrollAdjust: number }
  visibleTimeRange(): { start: number; end: number }
  visibleBeatRange(): { start: number; end: number }
}

export function createProjection(opts: TimelineProjectionOptions): TimelineProjection {
  const { pixelsPerBeat, viewportWidth, scrollX, bpm } = opts
  const beatsPerSecond = bpm / 60

  return {
    viewportWidth,
    pixelsPerBeat,
    scrollX,

    timeToPixel(seconds: number): number {
      return seconds * beatsPerSecond * pixelsPerBeat
    },

    pixelToTime(pixel: number): number {
      return (pixel + scrollX) / pixelsPerBeat / beatsPerSecond
    },

    beatToPixel(beat: number): number {
      return beat * pixelsPerBeat
    },

    pixelToBeat(pixel: number): number {
      return (pixel + scrollX) / pixelsPerBeat
    },

    contentPixelToBeat(contentPixel: number): number {
      return contentPixel / pixelsPerBeat
    },

    clampPixel(pixel: number): number {
      return Math.max(0, Math.min(pixel, viewportWidth))
    },

    zoomAt(
      currentZoom: number,
      cursorViewportX: number,
      direction: 'in' | 'out',
      minZoom: number,
      maxZoom: number,
    ): { zoom: number; scrollAdjust: number } {
      const factor = direction === 'in' ? 1.15 : 1 / 1.15
      const newZoom = Math.min(maxZoom, Math.max(minZoom, currentZoom * factor))
      const ratio = newZoom / currentZoom

      // Beat bajo el cursor (viewport + scroll actual)
      const beatAtCursor = (cursorViewportX + scrollX) / pixelsPerBeat
      const newPixelsPerBeat = pixelsPerBeat * ratio
      const newScrollX = beatAtCursor * newPixelsPerBeat - cursorViewportX

      return {
        zoom: newZoom,
        scrollAdjust: Math.max(0, newScrollX),
      }
    },

    visibleTimeRange(): { start: number; end: number } {
      return {
        start: this.pixelToTime(0),
        end: this.pixelToTime(viewportWidth),
      }
    },

    visibleBeatRange(): { start: number; end: number } {
      return {
        start: scrollX / pixelsPerBeat,
        end: (scrollX + viewportWidth) / pixelsPerBeat,
      }
    },
  }
}
