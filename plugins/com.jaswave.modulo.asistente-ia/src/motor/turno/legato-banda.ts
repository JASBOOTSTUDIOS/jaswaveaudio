/**
 * Legato worship al escribir: regla del usuario para arreglos de adoración: «ninguna nota se suelta hasta que el
 * sonido cae, excepto los pads, que siempre suenan; el piano y los instrumentos no dejan caer el sonido: las notas
 * se dejan pisadas con el pedal y se sueltan 500 ms DESPUÉS de la siguiente, para no dejar huecos en las melodías».
 *
 * Determinista y sin modelo, junto a la guardia de armonía (`armonia-banda.ts`): después de validar la armonía y
 * antes de escribir, las notas de una pista afinada pasan por `aplicarLegatoWorship` (shared). La batería y la
 * percusión no se tocan. Solo actúa si el pedido/estilo es worship (o el ajuste dice «siempre»).
 *
 * Límite: la guardia ve solo las notas de ESTA llamada; en `midi.notes.add/patch` parciales no conoce las vecinas
 * que ya hay en el clip (para eso está la herramienta `midi.notes.legatoWorship`, que mira el clip entero).
 */
import { aplicarLegatoWorship, clasificarPistaLegato } from '@jaswave/host-sdk'
import { camposNota, comoListaDeNotas, tonoMidi } from '../agent-tool-runner'
import { bpmDeProyecto } from './bpm-proyecto'

export type ModoLegatoBanda = 'siempre' | 'worship' | 'nunca'
export const CLAVE_LEGATO = 'jaswave-banda-legato'
export const SOLAPE_MS_BANDA = 500

const PALABRAS_WORSHIP = /worship|adoracion|alabanza|baladas?|ballad|congregacion/i

/** Ajuste del usuario en el almacenamiento local (`siempre` | `worship` | `nunca`; por defecto `worship`). */
export function modoLegatoBanda(): ModoLegatoBanda {
  try {
    const v = String(globalThis.localStorage?.getItem(CLAVE_LEGATO) ?? '').replace(/^"|"$/g, '').trim().toLowerCase()
    return v === 'siempre' || v === 'nunca' || v === 'worship' ? v : 'worship'
  } catch {
    return 'worship'
  }
}

/** ¿El pedido o el estilo es worship/adoración/alabanza/balada? */
export function esPedidoWorship(texto: string): boolean {
  return PALABRAS_WORSHIP.test(texto.normalize('NFD').replace(/[̀-ͯ]/g, ''))
}

export function legatoActivo(pedido: string, modo: ModoLegatoBanda = modoLegatoBanda()): boolean {
  return modo === 'siempre' || (modo === 'worship' && esPedidoWorship(pedido))
}

const HERRAMIENTAS = /^midi\.(clip\.create|notes\.set|createNotes|notes\.add|notes\.patch)$/
const ALIAS_DURACION = ['duracion', 'duración', 'duration', 'dur', 'length', 'largo']
const clave = (o: Record<string, unknown>, alias: readonly string[]) => alias.find((k) => o[k] != null)

export type ResultadoLegatoBanda = { args: Record<string, unknown>; avisos: string[] }

/** Aplica el legato a la lista de notas de una escritura MIDI. Sin lista legible o en batería: no toca nada. */
export function guardiaLegato(
  tool: string,
  args: Record<string, unknown>,
  o: { tipo: 'bateria' | 'pad' | 'afinada'; bpm: number; finClip?: number },
): ResultadoLegatoBanda {
  if (!HERRAMIENTAS.test(tool) || o.tipo === 'bateria' || !(o.bpm > 0)) return { args, avisos: [] }
  const k = (['upsert', 'notas', 'notes', 'cambios'] as const).find((x) => args[x] != null)
  if (!k) return { args, avisos: [] }
  const crudo = comoListaDeNotas(args[k])
  if (!crudo?.length) return { args, avisos: [] }
  const items = crudo.map((it) => (it && typeof it === 'object' ? { ...(it as Record<string, unknown>) } : it))
  const idx: number[] = []
  const notas: Array<{ pitch: number; inicio: number; duracion: number; mute?: boolean }> = []
  items.forEach((it, i) => {
    if (!it || typeof it !== 'object') return
    const c = camposNota(it as Record<string, unknown>)
    const pitch = tonoMidi(c.pitchCrudo)
    const inicio = Number(c.inicio)
    const duracion = Number(c.duracion)
    if (pitch == null || !Number.isFinite(inicio) || !Number.isFinite(duracion) || duracion <= 0) return
    idx.push(i)
    notas.push({ pitch, inicio, duracion, mute: (it as Record<string, unknown>).mute === true })
  })
  if (notas.length < 2 && o.tipo !== 'pad') return { args, avisos: [] }
  const { notas: res, resumen } = aplicarLegatoWorship(notas, { bpm: o.bpm, modo: o.tipo === 'pad' ? 'pad' : 'legato', solapeMs: o.tipo === 'pad' ? 1000 : SOLAPE_MS_BANDA, finClip: o.finClip })
  let cambiadas = 0
  res.forEach((r, j) => {
    const it = items[idx[j]!] as Record<string, unknown>
    const kd = clave(it, ALIAS_DURACION) ?? 'duracion'
    if (Math.abs(Number(camposNota(it).duracion) - r.duracion) < 1e-9) return
    it[kd] = Math.round(r.duracion * 1e6) / 1e6
    cambiadas++
  })
  if (!cambiadas) return { args, avisos: [] }
  const cuando = o.tipo === 'pad' ? 'hasta 1 s después de la siguiente (los pads siempre suenan)' : 'hasta 500 ms después de la siguiente'
  return { args: { ...args, [k]: items }, avisos: [`legato worship: ${resumen.alargadas || cambiadas} notas sostenidas ${cuando}`] }
}

type EstadoLegato = {
  project?: {
    bpm?: unknown
    tracks?: Array<{ id: string; nombre: string; plugins?: ReadonlyArray<{ nombre?: string }>; clips?: Array<{ id: string; inicio: number; duracion?: number }> }>
  }
}

/** Guardia sobre el estado del proyecto: localiza pista, clip y bpm. Inactiva si el pedido no es worship. */
export function guardarEscrituraLegato(
  st: EstadoLegato,
  pedido: string,
  llamada: { nombre: string; argumentos?: Record<string, unknown> },
  modo: ModoLegatoBanda = modoLegatoBanda(),
): ResultadoLegatoBanda {
  const args = llamada.argumentos ?? {}
  if (!HERRAMIENTAS.test(llamada.nombre) || !legatoActivo(pedido, modo)) return { args, avisos: [] }
  const pista = (st.project?.tracks ?? []).find((t) => t.id === String(args.pistaId ?? args.trackId ?? ''))
  if (!pista) return { args, avisos: [] }
  const clip = pista.clips?.find((c) => c.id === String(args.clipId ?? ''))
  const durCreate = Number(args.duracion ?? args.duration ?? args.length)
  const finClip = llamada.nombre === 'midi.clip.create' ? (Number.isFinite(durCreate) && durCreate > 0 ? durCreate : undefined) : clip?.duracion
  return guardiaLegato(llamada.nombre, args, { tipo: clasificarPistaLegato(pista.nombre, pista.plugins ?? []), bpm: bpmDeProyecto(st.project), finClip })
}
