/**
 * Servicio de análisis de audio por pista (A7b).
 *
 * Propósito:
 *   Convertir el proyecto en mediciones reales (loudness, espectro, dinámica,
 *   estéreo) por pista y de la mezcla, para que las herramientas `analysis.*`
 *   puedan diagnosticar el material en lugar de adivinar.
 *
 * Importancia:
 *   - El render es caro: se cachea por revisión del estado; si el proyecto no
 *     cambia, no se vuelve a renderizar ni a medir.
 *   - El backend es inyectable: la app usa Web Audio (sin plugins) y en el
 *     futuro el host nativo; los tests usan un backend falso.
 *   - El servicio NO muta el proyecto: solo lee el estado.
 *
 * Función:
 *   - `crearServicioAnalisis`: devuelve el `ProveedorAnalisis` que consumen los
 *     comandos `analysis.*` de @jaswave/shared, con caché y limpieza.
 */

import { measureMixAnalysis } from '../../../shared/src/audio/mix-analysis'
import { medidaDesdeAnalisis, type MedidaPista } from '../../../shared/src/audio/diagnosis'
import type {
  AnalisisProyecto,
  MetadatosRenderAnalisis,
  ProveedorAnalisis,
  RangoAnalisis,
  RequerimientoAnalisis,
} from '../../../shared/src/audio/analysis-provider'
import type { DAWState } from '../../../shared/src/types/state'

/** PCM estéreo de un tramo. */
export type SegmentoPcm = { l: Float32Array; r: Float32Array }

/** Petición al backend de render. */
export type PeticionBackendAnalisis = {
  estado: DAWState
  rango: RangoAnalisis
  /** Sample rate del render. */
  sampleRate: number
  /** Ignorar la cadena master. */
  bypassMaster: boolean
}

/** Respuesta del backend: PCM listo para medir. */
export type ResultadoBackendAnalisis = {
  sampleRate: number
  /** PCM por pista (fader y paneo ya aplicados). */
  pistas: Map<string, SegmentoPcm>
  /** Mezcla final (cadena master incluida). */
  mezcla: SegmentoPcm
  /** Suma de pistas antes de la cadena master. */
  suma: SegmentoPcm
  /** Nombre del backend (metadatos). */
  backend: string
  /** true si el backend procesó plugins (VST). */
  pluginsProcesados?: boolean
  /** Ficheros temporales a borrar tras medir. */
  temporales?: string[]
}

/** Backend de render (inyectable para tests y para el futuro host nativo). */
export type BackendAnalisis = (req: PeticionBackendAnalisis) => Promise<ResultadoBackendAnalisis>

export type OpcionesServicioAnalisis = {
  /** Estado actual del DAW (se lee en cada petición). */
  obtenerEstado: () => DAWState
  backend: BackendAnalisis
  /** Sample rate del render (por defecto 48 kHz). */
  sampleRate?: number
  /** Revisiones cacheadas (por defecto 4). */
  maxEntradasCache?: number
  /** Borra los temporales que deja el backend. */
  borrarTemporales?: (rutas: string[]) => void | Promise<void>
}

export type ServicioAnalisis = {
  /** Proveedor para `registrarProveedorAnalisis`. */
  proveedor: ProveedorAnalisis
  /** Vacía la caché (p. ej. al cambiar de proyecto). */
  limpiarCache: () => void
  /** Entradas en caché (diagnóstico). */
  tamanoCache: () => number
}

/** Convierte PCM estéreo interleaved en dos canales. */
export function desintercalar(pcm: Float32Array, frames: number): SegmentoPcm {
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    l[i] = pcm[i * 2] ?? 0
    r[i] = pcm[i * 2 + 1] ?? 0
  }
  return { l, r }
}

/**
 * Crea el servicio de análisis: mide con el DSP de A7a y cachea por revisión.
 */
export function crearServicioAnalisis(opts: OpcionesServicioAnalisis): ServicioAnalisis {
  const sampleRate = opts.sampleRate ?? 48000
  const maxEntradas = opts.maxEntradasCache ?? 4
  const cache = new Map<string, AnalisisProyecto>()

  /**
   * La clave ignora las pistas pedidas: el backend renderiza siempre todas
   * (una sola pasada) y así `analysis.track` y `analysis.mix` comparten caché.
   */
  function clave(req: RequerimientoAnalisis, rango: RangoAnalisis): string {
    return [
      req.revision,
      `${rango.inicioSeg.toFixed(3)}-${rango.finSeg.toFixed(3)}`,
      req.bypassMaster ? 'sin-master' : 'con-master',
      req.tap ?? 'post',
    ].join('|')
  }

  async function medir(req: RequerimientoAnalisis, rango: RangoAnalisis): Promise<AnalisisProyecto> {
    const estado = opts.obtenerEstado()
    const resultado = await opts.backend({
      estado,
      rango,
      sampleRate,
      bypassMaster: req.bypassMaster === true,
    })

    const pistasEstado = estado.project.tracks ?? []
    const orden = new Map(pistasEstado.map((t, i) => [t.id, i]))
    const pistas: MedidaPista[] = []
    const sinAudio: string[] = []
    for (const pista of pistasEstado) {
      const pcm = resultado.pistas.get(pista.id)
      if (!pcm || pcm.l.length === 0) {
        sinAudio.push(pista.id)
        continue
      }
      const analysis = measureMixAnalysis([pcm.l, pcm.r], resultado.sampleRate)
      pistas.push(medidaDesdeAnalisis(pista.id, pista.nombre || pista.id, analysis))
    }
    pistas.sort((a, b) => (orden.get(a.trackId) ?? 0) - (orden.get(b.trackId) ?? 0))

    const analisisMezcla = measureMixAnalysis(
      [resultado.mezcla.l, resultado.mezcla.r],
      resultado.sampleRate,
    )
    const master = medidaDesdeAnalisis('master', 'Master', analisisMezcla)
    const analisisSuma = measureMixAnalysis([resultado.suma.l, resultado.suma.r], resultado.sampleRate)
    const suma = medidaDesdeAnalisis('suma', 'Suma pre-master', analisisSuma)

    const metadatos: MetadatosRenderAnalisis = {
      backend: resultado.backend,
      tap: req.tap ?? 'post',
      bypassMaster: req.bypassMaster === true,
      sampleRate: resultado.sampleRate,
      duracionSeg: Math.max(0, rango.finSeg - rango.inicioSeg),
      pluginsProcesados: resultado.pluginsProcesados === true,
      ...(sinAudio.length ? { pistasSinAudio: sinAudio } : {}),
    }

    if (resultado.temporales?.length) {
      try {
        await opts.borrarTemporales?.(resultado.temporales)
      } catch {
        /* la limpieza de temporales no debe romper el análisis */
      }
    }

    return { revision: req.revision, rango, pistas, master, suma, metadatos }
  }

  const proveedor: ProveedorAnalisis = async (req) => {
    const rango = req.rango ?? { inicioSeg: 0, finSeg: 0 }
    const k = clave(req, rango)
    const hit = cache.get(k)
    if (hit) {
      // Reordena para que el más reciente sea el primero (LRU simple).
      cache.delete(k)
      cache.set(k, hit)
      return { ...hit, metadatos: { ...hit.metadatos, cache: true } }
    }
    const analisis = await medir(req, rango)
    cache.set(k, analisis)
    while (cache.size > maxEntradas) {
      const masViejo = cache.keys().next().value
      if (masViejo === undefined) break
      cache.delete(masViejo)
    }
    return analisis
  }

  return {
    proveedor,
    limpiarCache: () => cache.clear(),
    tamanoCache: () => cache.size,
  }
}
