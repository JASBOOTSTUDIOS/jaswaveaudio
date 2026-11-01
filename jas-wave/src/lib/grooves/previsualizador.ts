/**
 * Vista previa en bucle de un groove (M): manda las notas en vivo al instrumento de la pista elegida con el mismo
 * camino que usan el piano roll y los controladores (`routeMidiToTrack`). No toca el proyecto ni el transporte.
 * Las notas están en beats; el tempo es el del proyecto.
 */

import type { NotaGroove } from '../../../../shared/src/grooves'

export type EventoPrevia = { tMs: number; on: boolean; pitch: number; velocidad: number }

/** Eventos con `tMs` en [desdeMs, hastaMs) para un bucle de `largoBeats` que empieza en 0 ms. Pura. */
export function eventosEnVentana(notas: readonly NotaGroove[], largoBeats: number, bpm: number, desdeMs: number, hastaMs: number): EventoPrevia[] {
  if (!(largoBeats > 0) || !(bpm > 0) || hastaMs <= desdeMs) return []
  const msPorBeat = 60_000 / bpm
  const largoMs = largoBeats * msPorBeat
  const out: EventoPrevia[] = []
  const primera = Math.max(0, Math.floor(desdeMs / largoMs) - 1)
  const ultima = Math.floor(hastaMs / largoMs)
  for (let vuelta = primera; vuelta <= ultima; vuelta++) {
    const base = vuelta * largoMs
    for (const n of notas) {
      const on = base + n.inicio * msPorBeat
      // El note-off nunca pasa del final del bucle (no quedan notas colgadas al reiniciar).
      const off = Math.min(base + (n.inicio + Math.max(0.05, n.duracion)) * msPorBeat, base + largoMs - 1)
      if (on >= desdeMs && on < hastaMs) out.push({ tMs: on, on: true, pitch: n.pitch, velocidad: n.velocidad })
      if (off >= desdeMs && off < hastaMs && off > on) out.push({ tMs: off, on: false, pitch: n.pitch, velocidad: 0 })
    }
  }
  return out.sort((a, b) => a.tMs - b.tMs || Number(a.on) - Number(b.on))
}

export type EnviarNota = (pistaId: string, on: boolean, pitch: number, velocidad: number) => boolean

export class PrevisualizadorGrooves {
  private temporizador: ReturnType<typeof setInterval> | null = null
  private pendientes = new Set<ReturnType<typeof setTimeout>>()
  private sonando = new Map<number, string>()
  private inicio = 0
  private hasta = 0

  constructor(
    private readonly enviar: EnviarNota,
    private readonly ahora: () => number = () => performance.now(),
  ) {}

  get activo(): boolean {
    return this.temporizador !== null
  }

  iniciar(args: { pistaId: string; notas: readonly NotaGroove[]; largoBeats: number; bpm: number }): void {
    this.detener()
    this.inicio = this.ahora() + 30
    this.hasta = 0
    const paso = () => {
      const t = this.ahora() - this.inicio
      const hasta = t + 120
      for (const e of eventosEnVentana(args.notas, args.largoBeats, args.bpm, Math.max(this.hasta, 0), hasta)) {
        const espera = Math.max(0, e.tMs - t)
        const id = setTimeout(() => {
          this.pendientes.delete(id)
          this.enviar(args.pistaId, e.on, e.pitch, e.velocidad)
          if (e.on) this.sonando.set(e.pitch, args.pistaId)
          else this.sonando.delete(e.pitch)
        }, espera)
        this.pendientes.add(id)
      }
      this.hasta = hasta
    }
    paso()
    this.temporizador = setInterval(paso, 40)
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
    for (const id of this.pendientes) clearTimeout(id)
    this.pendientes.clear()
    for (const [pitch, pista] of this.sonando) this.enviar(pista, false, pitch, 0)
    this.sonando.clear()
  }
}
