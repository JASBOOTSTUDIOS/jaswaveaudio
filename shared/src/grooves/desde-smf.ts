/** Del SMF leído a las notas y datos de un groove (puro). Las notas de todas las pistas se funden en una sola. */

import type { CancionSmf } from '../midi/smf'
import type { DatosMidiGroove } from './indice'
import type { NotaGroove } from './tipos'

export function notasDeCancion(c: CancionSmf): NotaGroove[] {
  const out: NotaGroove[] = []
  for (const p of c.pistas) for (const n of p.notas) out.push({ pitch: n.pitch, velocidad: n.velocidad, inicio: n.inicio, duracion: n.duracion })
  return out.sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
}

export function datosDeCancion(c: CancionSmf): { datos: DatosMidiGroove; notas: NotaGroove[] } {
  const notas = notasDeCancion(c)
  const fin = notas.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 0)
  return { notas, datos: { bpm: c.bpm, compas: c.compas, duracionBeats: fin, notas: notas.length } }
}
