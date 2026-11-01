/**
 * Pegamento de la app para `producirWorship`: ejecución por `executeDawActions` (permisos, auditoría, carga
 * de VST en el host) y medición real con `analysis.mix`. Lo usa el comando `/banda` del chat.
 */
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { executeDawActions, type DawAction } from './ai-daw-agent'
import {
  especDesdePrompt,
  producirWorship,
  sinAudicion,
  type MedicionMezcla,
  type OpcionesProduccion,
  type PasoBuild,
  type ResultadoProduccion,
} from './worship-build'

type ResultadoMix = {
  pistas?: Array<{ trackId: string; integrated: number }>
  master?: { integrated: number; truePeakDb: number }
}

export function medidorMezclaApp(tienda: TiendaDAW): () => Promise<MedicionMezcla | null> {
  return async () => {
    try {
      const r = await tienda.executor.execute('analysis.mix', {})
      const res = r.result as ResultadoMix | undefined
      if (!r.success || !res?.master || !Array.isArray(res.pistas)) return null
      return {
        pistas: res.pistas.map((p) => ({ trackId: p.trackId, integrated: p.integrated })),
        master: { integrated: res.master.integrated, truePeakDb: res.master.truePeakDb },
      }
    } catch {
      return null
    }
  }
}

export type OpcionesBandaApp = {
  semilla?: number
  onPaso?: (p: PasoBuild) => void
  signal?: AbortSignal
  instrumentos?: boolean
  mezcla?: boolean
}

/** Produce un tema de worship a partir de un texto del usuario, con las mismas garantías que la IA. */
export async function producirWorshipEnApp(tienda: TiendaDAW, prompt: string, o: OpcionesBandaApp = {}): Promise<ResultadoProduccion> {
  const spec = especDesdePrompt(prompt, o.semilla)
  const opciones: OpcionesProduccion = {
    ejecutar: async (acciones) => {
      // El usuario pidió explícitamente la producción: cuenta como confirmada (origen user_build).
      const rs = await executeDawActions(tienda, sinAudicion(acciones) as DawAction[], { source: 'user_build', agentMode: 'create', skipWorkPlan: true })
      return rs.map((r) => ({ type: r.type, success: r.success, message: r.message, data: r.data }))
    },
    medir: medidorMezclaApp(tienda),
    leerVolumen: (id) => tienda.obtenerEstado().project.tracks.find((t) => t.id === id)?.volumen ?? 1,
    instrumentos: o.instrumentos,
    mezcla: o.mezcla,
    onPaso: o.onPaso,
    signal: o.signal,
  }
  return producirWorship(spec, opciones)
}
