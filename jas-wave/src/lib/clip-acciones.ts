/**
 * Acciones de clip sobre la selección (G3): mute, fundido anti-clics, consolidar, invertir y normalizar.
 * Devuelven lotes de comandos (un solo paso de undo) que ejecutan el atajo, el menú contextual y la IA.
 */

type ClipSel = {
  id: string
  tipo?: string
  inicio?: number
  duracion?: number
  silenciado?: boolean
  inverso?: boolean
  clipInicio?: number
  ganancia?: number
  sourceId?: string
  source?: { ruta?: string }
}
type ProyectoSel = { bpm?: { valor?: number } | null; tracks: Array<{ id: string; clips: ClipSel[] }> }
export type ComandoLote = { type: string; payload: Record<string, unknown> }

/** Fundido anti-clics: 10 ms en cada extremo. */
export const AUTO_FADE_SEGUNDOS = 0.01
/** Pico objetivo al normalizar un clip. */
export const NORMALIZAR_PICO_DB = -1

export function clipsSeleccionados(p: ProyectoSel, idsClips: readonly string[]): Array<{ pistaId: string; clip: ClipSel }> {
  const ids = new Set(idsClips)
  const out: Array<{ pistaId: string; clip: ClipSel }> = []
  for (const t of p.tracks) for (const c of t.clips) if (ids.has(c.id)) out.push({ pistaId: t.id, clip: c })
  return out
}

/** Si todos estaban silenciados se activan; si no, se silencian todos. */
export function loteToggleMute(p: ProyectoSel, idsClips: readonly string[]): ComandoLote[] {
  const sel = clipsSeleccionados(p, idsClips)
  if (!sel.length) return []
  const silenciar = !sel.every((s) => s.clip.silenciado === true)
  return [{ type: 'clip.setMute', payload: { cambios: sel.map((s) => ({ pistaId: s.pistaId, clipId: s.clip.id, silenciado: silenciar })) } }]
}

export function loteAutoFade(p: ProyectoSel, idsClips: readonly string[]): ComandoLote[] {
  return clipsSeleccionados(p, idsClips)
    .filter((s) => s.clip.tipo === 'audio')
    .flatMap((s) =>
      (['in', 'out'] as const).map((tipo) => ({
        type: 'clip.setFade',
        payload: { pistaId: s.pistaId, clipId: s.clip.id, tipo, duracion: AUTO_FADE_SEGUNDOS },
      })),
    )
}

/** Un `clip.merge` por pista con al menos dos clips del mismo tipo seleccionados. */
export function loteConsolidar(p: ProyectoSel, idsClips: readonly string[]): ComandoLote[] {
  const porPista = new Map<string, ClipSel[]>()
  for (const s of clipsSeleccionados(p, idsClips)) porPista.set(s.pistaId, [...(porPista.get(s.pistaId) ?? []), s.clip])
  const out: ComandoLote[] = []
  for (const [pistaId, clips] of porPista) {
    for (const tipo of ['midi', 'audio']) {
      const delTipo = clips.filter((c) => (c.tipo === 'midi' ? 'midi' : 'audio') === tipo)
      if (delTipo.length >= 2) out.push({ type: 'clip.merge', payload: { pistaId, clipIds: delTipo.map((c) => c.id) } })
    }
  }
  return out
}

export function loteInvertir(p: ProyectoSel, idsClips: readonly string[]): ComandoLote[] {
  const sel = clipsSeleccionados(p, idsClips).filter((s) => s.clip.tipo === 'audio')
  if (!sel.length) return []
  const invertir = !sel.every((s) => s.clip.inverso === true)
  return [{ type: 'clip.setReverse', payload: { cambios: sel.map((s) => ({ pistaId: s.pistaId, clipId: s.clip.id, inverso: invertir })) } }]
}

/**
 * Ganancia para que el pico de la región visible del clip quede en −1 dBFS.
 * `pico(claves, desdeSec, durSec)` mide el audio original (sin la ganancia actual del clip).
 */
export function loteNormalizar(
  p: ProyectoSel,
  idsClips: readonly string[],
  pico: (claves: string[], desdeSec: number, durSec: number) => number | null,
): { comandos: ComandoLote[]; sinAudio: number } {
  const bpm = Number(p.bpm?.valor) > 0 ? Number(p.bpm!.valor) : 120
  const comandos: ComandoLote[] = []
  let sinAudio = 0
  for (const s of clipsSeleccionados(p, idsClips)) {
    if (s.clip.tipo !== 'audio') continue
    const claves = [s.clip.source?.ruta ?? '', s.clip.sourceId ?? '', s.clip.id]
    const v = pico(claves, ((s.clip.clipInicio ?? 0) * 60) / bpm, ((s.clip.duracion ?? 0) * 60) / bpm)
    if (v == null || v <= 1e-6) {
      sinAudio++
      continue
    }
    const gananciaDb = Math.round((NORMALIZAR_PICO_DB - 20 * Math.log10(v)) * 10) / 10
    comandos.push({ type: 'clip.setGain', payload: { pistaId: s.pistaId, clipId: s.clip.id, gananciaDb } })
  }
  return { comandos, sinAudio }
}
