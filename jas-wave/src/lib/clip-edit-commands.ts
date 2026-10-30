/**
 * Traduce operaciones de edición de clips (pegar, duplicar, cortar, borrar
 * múltiple) a lotes de comandos. Cada operación se ejecuta con
 * `executor.batch` → una sola entrada de undo por operación del usuario.
 */

import type { CommandPayload } from '../../../shared/src/types/command'
import type { ClipboardClip } from './daw-clipboard'

type ProyectoConPistas = {
  tracks: ReadonlyArray<{ id: string; clips: ReadonlyArray<{ id: string }> }>
}

export type LoteClips = {
  comandos: CommandPayload[]
  /** Ids de los clips que creará el lote (en orden). */
  idsCreados: string[]
}

function nuevoIdClip(): string {
  return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function esClipMidi(clip: ClipboardClip): boolean {
  return clip.tipo === 'midi' || (Array.isArray(clip.notas) && clip.notas.length > 0)
}

/** Comando de creación para un clip del portapapeles en `pistaId` a partir de `inicio`. */
function comandoCrearClip(clip: ClipboardClip, pistaId: string, inicio: number, nombre: string, id: string): CommandPayload {
  if (esClipMidi(clip)) {
    return {
      type: 'midi.clip.create',
      payload: {
        id,
        pistaId,
        nombre,
        inicio,
        duracion: clip.duracion,
        color: clip.color,
        notas: (clip.notas ?? []).map((n) => ({
          pitch: n.pitch,
          inicio: n.inicio,
          duracion: n.duracion,
          velocidad: n.velocidad,
          canal: n.canal,
        })),
      },
    }
  }
  return {
    type: 'clip.create',
    payload: {
      id,
      pistaId,
      nombre,
      inicio,
      duracion: clip.duracion,
      color: clip.color,
      sourceId: clip.sourceId,
      waveform: clip.waveform,
      ...(clip.clipInicio !== undefined && Number.isFinite(clip.clipInicio) && clip.clipInicio > 0
        ? { clipInicio: clip.clipInicio }
        : {}),
    },
  }
}

/** Pegar: los clips conservan su separación relativa a partir de `inicioDestino`. */
export function lotePegarClips(
  clips: ClipboardClip[],
  pistaDestinoId: string,
  inicioDestino: number,
  generarId: () => string = nuevoIdClip,
): LoteClips {
  if (clips.length === 0) return { comandos: [], idsCreados: [] }
  const base = Math.min(...clips.map((c) => c.inicio))
  const idsCreados: string[] = []
  const comandos = clips.map((clip) => {
    const id = generarId()
    idsCreados.push(id)
    return comandoCrearClip(clip, pistaDestinoId, inicioDestino + (clip.inicio - base), clip.nombre, id)
  })
  return { comandos, idsCreados }
}

/** Duplicar: cada clip se copia justo después del original en su misma pista. */
export function loteDuplicarClips(clips: ClipboardClip[], generarId: () => string = nuevoIdClip): LoteClips {
  const idsCreados: string[] = []
  const comandos = clips.map((clip) => {
    const id = generarId()
    idsCreados.push(id)
    return comandoCrearClip(clip, clip.pistaOrigenId, clip.inicio + clip.duracion, `${clip.nombre} (Copia)`, id)
  })
  return { comandos, idsCreados }
}

/** Borrar (o cortar) todos los clips seleccionados en un solo lote. */
export function loteBorrarClips(proyecto: ProyectoConPistas, idsClips: readonly string[]): CommandPayload[] {
  const comandos: CommandPayload[] = []
  const vistos = new Set<string>()
  for (const clipId of idsClips) {
    if (vistos.has(clipId)) continue
    vistos.add(clipId)
    const pista = proyecto.tracks.find((t) => t.clips.some((c) => c.id === clipId))
    if (pista) comandos.push({ type: 'clip.delete', payload: { pistaId: pista.id, clipId } })
  }
  return comandos
}
