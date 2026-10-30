/**
 * Coordinación vertical de la banda al terminar los músicos (plan S): lee el proyecto, ejecuta `coordinarVoces`
 * (shared: choques de segunda menor entre pistas, pad que sigue al acorde, bajo en el bajo de la barra, registros y
 * duplicados) y devuelve las reescrituras de los clips afectados (`midi.notes.set`, conservando ids y campos de cada
 * nota). Determinista y sin modelo.
 *
 * Orden respecto a la humanización y el legato: estos actúan al ESCRIBIR cada clip (tiempo y dinámica no cambian
 * alturas); la coordinación corre después, con todas las pistas ya escritas, porque necesita ver el conjunto. Solo
 * cambia alturas (a notas del acorde o color), recorta o quita; el recorte del pad en el cambio de acorde deja el
 * solape de legato de R (1 s en pads, 500 ms en cuerdas), así que ambas reglas se respetan.
 */
import { clasificarFamiliaBanda, coordinarVoces } from '@jaswave/host-sdk'
import type { NotaVertical, ResumenCoordinarVoces } from '@jaswave/host-sdk'
import { MAYOR, MENOR, parsearAcorde, parsearTonalidad, type HojaCoherencia } from './coherencia-banda'
import { bpmDeProyecto } from './bpm-proyecto'

type NotaEstado = { pitch: number; inicio: number; duracion: number; velocidad?: number } & Record<string, unknown>
type EstadoCoordinar = {
  project?: {
    bpm?: unknown
    timeSignature?: { numerador?: unknown }
    tracks?: ReadonlyArray<{
      id: string
      nombre: string
      tipo?: string
      plugins?: ReadonlyArray<{ nombre?: string }>
      clips?: ReadonlyArray<{ id: string; inicio: number; duracion: number; notas?: unknown[] }>
    }>
  }
}

export type EscrituraCoordinada = { pistaId: string; clipId: string; notas: NotaEstado[] }
type Marcada = NotaVertical & { clipId: string; orig: NotaEstado; relInicio: number }

export function planCoordinacion(st: EstadoCoordinar, hoja: HojaCoherencia): { escrituras: EscrituraCoordinada[]; resumen: ResumenCoordinarVoces | null } {
  const bpm = bpmDeProyecto(st.project)
  const num = Math.max(1, Math.round(hoja.numerador || Number(st.project?.timeSignature?.numerador ?? 4) || 4))
  const acordes = hoja.secciones.flatMap((s) =>
    Array.from({ length: s.compases }, (_, i) => {
      const a = parsearAcorde(s.acordes[i % Math.max(1, s.acordes.length)] ?? '')
      return a ? { notas: a.notas, raiz: a.raiz, bajo: a.bajo } : null
    }),
  )
  if (!acordes.length || !(bpm > 0)) return { escrituras: [], resumen: null }
  const ton = parsearTonalidad(hoja.tonalidad)
  const escala = ton ? new Set((ton.menor ? MENOR : MAYOR).map((i) => (((ton.raiz + i) % 12) + 12) % 12)) : null
  const pistas = (st.project?.tracks ?? [])
    .filter((t) => t.tipo === 'audio' || t.tipo === 'midi' || t.tipo === 'instrumento' || t.tipo == null)
    .map((t) => ({
      id: t.id,
      familia: clasificarFamiliaBanda(t.nombre, t.plugins ?? []),
      notas: (t.clips ?? []).flatMap((c) =>
        ((c.notas ?? []) as NotaEstado[]).map((n): Marcada => ({ pitch: n.pitch, inicio: c.inicio + n.inicio, duracion: n.duracion, velocidad: n.velocidad, clipId: c.id, orig: n, relInicio: n.inicio })),
      ),
    }))
    .filter((p) => p.notas.length > 0)
  if (pistas.length < 2) return { escrituras: [], resumen: null }
  const r = coordinarVoces(pistas, { acordes, escala, numerador: num, bpm })
  const escrituras: EscrituraCoordinada[] = []
  for (const p of r.pistas) {
    const clips = new Map<string, { quitadas: number; cambiadas: boolean }>()
    const orig = pistas.find((x) => x.id === p.id)!
    // Clips con alguna nota cambiada o quitada.
    for (const n of p.notas) if (n.cambiada) clips.set(n.nota.clipId, { quitadas: 0, cambiadas: true })
    for (const i of p.quitadas) clips.set(orig.notas[i]!.clipId, { quitadas: 1, cambiadas: true })
    for (const clipId of clips.keys()) {
      const clip = (st.project?.tracks ?? []).find((t) => t.id === p.id)?.clips?.find((c) => c.id === clipId)
      if (!clip) continue
      const notas = p.notas
        .filter((n) => n.nota.clipId === clipId)
        .sort((a, b) => a.origen - b.origen)
        .map((n) => ({ ...n.nota.orig, pitch: n.nota.pitch, inicio: Math.round((n.nota.inicio - clip.inicio) * 1e6) / 1e6, duracion: Math.round(n.nota.duracion * 1e6) / 1e6 }))
      escrituras.push({ pistaId: p.id, clipId, notas })
    }
  }
  return { escrituras, resumen: r.resumen }
}

/** Texto para el resumen al usuario (una línea). */
export function textoCoordinacion(r: ResumenCoordinarVoces): string {
  const partes = [
    `choques entre pistas en ${r.porcentajeAntes} % de los tiempos → ${r.porcentajeDespues} %`,
    r.movidas ? `${r.movidas} notas movidas a otra nota del acorde` : '',
    r.bajoCorregido ? `${r.bajoCorregido} del bajo` : '',
    r.cortadas ? `${r.cortadas} recortadas` : '',
    r.quitadas ? `${r.quitadas} quitadas` : '',
  ].filter(Boolean)
  return `Coordinación de voces: ${partes.join(', ')}.`
}

/** Aplica el plan con el ejecutor de herramientas del motor. Devuelve la línea de resumen, o null si no hubo nada que hacer. */
export async function coordinarBanda(
  st: EstadoCoordinar,
  hoja: HojaCoherencia,
  ejecutar: (nombre: string, args: Record<string, unknown>) => Promise<boolean>,
): Promise<string | null> {
  const { escrituras, resumen } = planCoordinacion(st, hoja)
  if (!resumen || !escrituras.length) return resumen && resumen.tiemposMedidos ? `Coordinación de voces: sin choques que resolver (${resumen.porcentajeAntes} % de los tiempos).` : null
  let ok = 0
  for (const e of escrituras) if (await ejecutar('midi.notes.set', { pistaId: e.pistaId, clipId: e.clipId, notas: e.notas })) ok++
  return `${textoCoordinacion(resumen)}${ok < escrituras.length ? ` (${escrituras.length - ok} clips no se pudieron reescribir)` : ''}`
}
