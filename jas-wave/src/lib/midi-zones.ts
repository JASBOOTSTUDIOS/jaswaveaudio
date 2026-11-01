/**
 * Zonas MIDI en vivo (K3): qué destinos recibe el host nativo por cada pista armada (todas sus capas × sus
 * zonas) y el reparto de una nota del thru web por zonas. Lógica pura; la aplicación de una zona a una nota
 * (rango, transposición con clamp, curva de velocidad) vive en @jaswave/shared (`types/directo`).
 */

import {
  notasDeSalidaParaPista,
  zonasDePista,
  type CurvaVelocidad,
  type ZonaMidi,
} from '../../../shared/src/types/directo'

export { notasDeSalidaParaPista, zonasDePista }

/** Destino tal como lo entiende `setLiveMidiTargets` del host (forma nueva, `targets`). */
export type LiveMidiTarget = {
  slotId: string
  deviceId: string
  lo: number
  hi: number
  transpose: number
  velCurve: CurvaVelocidad
  velScale: number
  velFixed: number
  /** Canal de entrada 0-15 (el host usa base 0); ausente = cualquiera. */
  channel?: number
  /** Canal de salida 0-15; ausente = el de la nota. */
  outChannel?: number
}

/** Máximo de destinos que acepta el host. */
export const MAX_LIVE_MIDI_TARGETS = 32

/**
 * Construye los destinos: por cada pista (en orden) y cada slot cargado de esa pista, una entrada por zona
 * activa; sin zonas, una entrada de teclado completo. Se recorta a 32 (aviso en `recortado`).
 */
export function buildLiveMidiTargets(
  pistas: Array<{ id: string; deviceId: string; slotIds: string[] }>,
  zonas: readonly ZonaMidi[] | undefined,
): { targets: LiveMidiTarget[]; recortado: boolean } {
  const targets: LiveMidiTarget[] = []
  for (const p of pistas) {
    const propias = zonasDePista(zonas, p.id)
    for (const slotId of p.slotIds) {
      if (propias.length === 0) {
        targets.push({ slotId, deviceId: p.deviceId, lo: 0, hi: 127, transpose: 0, velCurve: 'lineal', velScale: 1, velFixed: 100 })
        continue
      }
      for (const z of propias) {
        targets.push({
          slotId,
          deviceId: p.deviceId,
          lo: z.lo,
          hi: z.hi,
          transpose: z.transposicion,
          velCurve: z.curvaVelocidad,
          velScale: z.escalaVelocidad,
          velFixed: z.velocidadFija,
          ...(z.canalEntrada != null ? { channel: z.canalEntrada - 1 } : {}),
          ...(z.canalSalida != null ? { outChannel: z.canalSalida - 1 } : {}),
        })
      }
    }
  }
  const recortado = targets.length > MAX_LIVE_MIDI_TARGETS
  return { targets: recortado ? targets.slice(0, MAX_LIVE_MIDI_TARGETS) : targets, recortado }
}

/** Firma estable de las zonas para saber cuándo volver a publicar destinos. */
export function firmaZonas(zonas: readonly ZonaMidi[] | undefined): string {
  if (!zonas || zonas.length === 0) return ''
  return zonas
    .map(
      (z) =>
        `${z.id}:${z.pistaId}:${z.lo}-${z.hi}:${z.transposicion}:${z.curvaVelocidad}:${z.escalaVelocidad}:${z.velocidadFija}:${z.canalEntrada ?? ''}:${z.canalSalida ?? ''}:${z.activa ? 1 : 0}`,
    )
    .join('|')
}

/**
 * Seguimiento de note-off del thru web por nota original: si la zona cambia mientras la tecla sigue pisada,
 * el note-off va al tono que sonó. Clave: pista + tono original.
 */
export class SeguimientoNotasZona {
  private sonando = new Map<string, number[]>()

  noteOn(pistaId: string, pitchOriginal: number, salidas: number[]): number[] {
    const clave = `${pistaId}:${pitchOriginal}`
    const previas = this.sonando.get(clave) ?? []
    this.sonando.set(clave, salidas)
    return previas
  }

  /** Tonos a apagar; `null` si no había nota en curso (se usa el reparto actual). */
  noteOff(pistaId: string, pitchOriginal: number): number[] | null {
    const clave = `${pistaId}:${pitchOriginal}`
    const previas = this.sonando.get(clave)
    if (!previas) return null
    this.sonando.delete(clave)
    return previas
  }

  reiniciar(): void {
    this.sonando.clear()
  }
}
