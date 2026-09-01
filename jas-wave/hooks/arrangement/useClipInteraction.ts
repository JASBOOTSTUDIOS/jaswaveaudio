/**
 * Preview local de drag → commit vía clip.move / clip.resize (fase D).
 * La orquestación actual vive en ArrangementView; este módulo fija el contrato.
 */
export type DragMode = 'move' | 'trim-left' | 'trim-right'

export interface ClipDragState {
  mode: DragMode
  clipId: string
  trackId: string
  startMouseX: number
  startMouseY: number
  initialInicio: number
  initialDuracion: number
  previewInicio: number
  previewDuracion: number
  previewTrackId: string
}

export function useClipInteraction() {
  return { /** reserved for extracting clipDrag handlers */ }
}
