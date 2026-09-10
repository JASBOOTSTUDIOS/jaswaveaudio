/**
 * Abre el panel MIDI · MD vinculado a un clip (ensure + bind + tool).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { requestOpenTool } from '@/src/workspace/types'
import { openMidiClipMdSync } from './midi-clip-md-sync'

export function openMidiClipMdPanel(
  tienda: TiendaDAW,
  clipId: string,
  trackId: string,
): void {
  openMidiClipMdSync(tienda, clipId, trackId)
  requestOpenTool('midi-md', { zone: 'left' })
}
