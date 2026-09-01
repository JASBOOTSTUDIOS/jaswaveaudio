/**
 * Selección de clips en el arrange (marquee con clic derecho).
 */

export type ClipLassoRect = {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type ArrangeClipHit = {
  id: string
  trackId: string
  inicioBeats: number
  duracionBeats: number
}

export function clipsInLassoRect(
  clips: ArrangeClipHit[],
  tracks: { id: string }[],
  rowH: number,
  beatToPixel: (beat: number) => number,
  rect: ClipLassoRect,
): string[] {
  const minX = Math.min(rect.x0, rect.x1)
  const maxX = Math.max(rect.x0, rect.x1)
  const minY = Math.min(rect.y0, rect.y1)
  const maxY = Math.max(rect.y0, rect.y1)
  const ids: string[] = []
  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti]!
    const ty0 = ti * rowH
    const ty1 = ty0 + rowH
    if (ty1 < minY || ty0 > maxY) continue
    for (const clip of clips.filter((c) => c.trackId === track.id)) {
      const cx0 = beatToPixel(clip.inicioBeats)
      const cx1 = beatToPixel(clip.inicioBeats + clip.duracionBeats)
      const cy0 = ty0
      const cy1 = ty1
      // Cualquier intersección con el rectángulo (incluso parcial)
      if (cx1 <= minX || cx0 >= maxX) continue
      if (cy1 <= minY || cy0 >= maxY) continue
      ids.push(clip.id)
    }
  }
  return ids
}
