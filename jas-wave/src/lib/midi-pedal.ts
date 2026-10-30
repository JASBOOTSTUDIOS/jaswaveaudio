/**
 * Pedales conmutados (CC64 sustain, CC66 sostenuto, CC67 suave, CC69 hold 2) unificados por canal.
 *
 * Teclados como el Yamaha PSR-E373 mandan cada pisada del pedal por varios canales a la vez (voz principal,
 * dual y split): `B0 40 7F · B1 40 7F · B2 40 00` en el mismo milisegundo. El canal sin voz dice «suelto»,
 * así que un receptor omni que aplique los mensajes en orden termina con el pedal arriba y el sustain nunca
 * se oye. Aquí el valor efectivo de cada pedal es el máximo entre los 16 canales y solo se reenvía cuando
 * cambia: una pisada → un único 127; soltar → un único 0.
 */

import type { MidiParsed } from './midi-bytes'

export const PEDALES_CONMUTADOS: readonly number[] = [64, 66, 67, 69]

export function esPedalConmutado(cc: number): boolean {
  return PEDALES_CONMUTADOS.includes(cc)
}

export type ResultadoPedal = { reenviar: boolean; valor: number }

type EstadoPedal = { porCanal: number[]; emitido: number }

export class AgregadorPedales {
  private readonly pedales = new Map<number, EstadoPedal>()

  /**
   * Registra el mensaje y dice si hay que reenviarlo (y con qué valor). Los CC que no son pedales
   * conmutados se reenvían tal cual.
   */
  aplicar(msg: { cc: number; value: number; channel: number }): ResultadoPedal {
    if (!esPedalConmutado(msg.cc)) return { reenviar: true, valor: msg.value }
    let p = this.pedales.get(msg.cc)
    if (!p) {
      p = { porCanal: new Array<number>(16).fill(0), emitido: -1 }
      this.pedales.set(msg.cc, p)
    }
    const ch = Math.max(0, Math.min(15, msg.channel | 0))
    p.porCanal[ch] = Math.max(0, Math.min(127, msg.value | 0))
    let maximo = 0
    for (const v of p.porCanal) if (v > maximo) maximo = v
    if (maximo === p.emitido) return { reenviar: false, valor: maximo }
    p.emitido = maximo
    return { reenviar: true, valor: maximo }
  }

  /** Estado efectivo (0..127) de un pedal, o 0 si nunca se ha visto. */
  valor(cc: number): number {
    const p = this.pedales.get(cc)
    return p && p.emitido >= 0 ? p.emitido : 0
  }

  /** Olvida todo (cambio de dispositivo, reinicio del host). */
  reiniciar(): void {
    this.pedales.clear()
  }
}

/**
 * Devuelve el mensaje que debe seguir su camino (con el valor unificado) o `null` si es un duplicado
 * que no cambia el estado del pedal.
 */
export function unificarPedal(agregador: AgregadorPedales, msg: MidiParsed): MidiParsed | null {
  if (msg.kind !== 'cc' || !esPedalConmutado(msg.cc)) return msg
  const r = agregador.aplicar(msg)
  if (!r.reenviar) return null
  return r.valor === msg.value ? msg : { ...msg, value: r.valor }
}
