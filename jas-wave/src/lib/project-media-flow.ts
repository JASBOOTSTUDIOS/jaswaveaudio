/**
 * Flujos de media del proyecto (U4) en el renderer.
 *
 * - Primer guardado: el media pendiente (`media/pending/`) se mueve a
 *   `<proyecto>/media/` y los clips se reapuntan a la ruta definitiva.
 * - "Guardar como": se copia el árbol `media/` del proyecto origen al destino.
 * - Media faltante al abrir: se localizan los archivos y se reenlanan.
 *
 * Toda mutación del proyecto pasa por el Command System (`clip.setSource`).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import {
  MEDIA_REL_DIR,
  esRutaMediaRelativa,
  normalizarRutaRelativa,
} from '../../../shared/src/project/ciclo-vida'
import {
  carpetaDeProyecto,
  carpetaMediaPendiente,
  carpetaMediaProyecto,
  clipsConMediaPendiente,
  rutaRelativaMedia,
  unirCarpeta,
} from './project-media'

export type ResultadoFlujoMedia = {
  ok: boolean
  movidos?: number
  error?: string
}

/**
 * Mueve el media pendiente al `media/` del proyecto y reapunta los clips.
 * Idempotente: si no hay nada pendiente, no hace nada.
 */
export async function moverMediaPendienteAlProyecto(
  tienda: TiendaDAW,
  rutaProyecto: string | null | undefined,
): Promise<ResultadoFlujoMedia> {
  const api = window.electron
  if (!api?.mediaCopy) return { ok: true, movidos: 0 }

  const proyecto = tienda.obtenerEstado().project
  const pendientes = clipsConMediaPendiente(proyecto)
  if (pendientes.length === 0) return { ok: true, movidos: 0 }

  const destino = carpetaMediaProyecto(rutaProyecto)
  const origen = await carpetaMediaPendiente()
  if (!destino || !origen) return { ok: false, movidos: 0, error: 'No se pudo resolver la carpeta de media' }

  let movidos = 0
  for (const clip of pendientes) {
    const relativa = normalizarRutaRelativa(clip.ruta)
    const nombre = relativa.split('/').pop() ?? 'audio'
    const rutaAbsoluta = unirCarpeta(origen, nombre)
    const res = await api.mediaCopy({ src: rutaAbsoluta, destDir: destino, nombre, mover: true })
    if (!res?.ok) continue
    const rutaRelativa = rutaRelativaMedia(res.nombre ?? nombre)
    const set = await tienda.executor.execute('clip.setSource', {
      pistaId: clip.pistaId,
      clipId: clip.clipId,
      sourceId: rutaRelativa,
    })
    if (set.success) movidos++
  }
  return { ok: true, movidos }
}

/**
 * Copia el árbol `media/` del proyecto origen al destino ("Guardar como").
 * Las rutas relativas del proyecto no cambian: solo se copian los archivos.
 */
export async function copiarMediaEntreProyectos(
  rutaOrigen: string | null | undefined,
  rutaDestino: string | null | undefined,
): Promise<ResultadoFlujoMedia> {
  const mediaCopy = window.electron?.mediaCopy
  if (!mediaCopy) return { ok: true }
  const origen = carpetaMediaProyecto(rutaOrigen)
  const destino = carpetaMediaProyecto(rutaDestino)
  if (!origen || !destino) return { ok: false, error: 'No se pudo resolver la carpeta de media' }
  if (origen === destino) return { ok: true }

  const listar = window.electron?.fileListDir
  if (!listar) return { ok: false, error: 'No se pudo listar la carpeta de media' }

  let copiados = 0
  // `dirAbs` es la ruta absoluta de la carpeta; `rel` su equivalente relativo
  // dentro del proyecto (empezando por `media/`).
  const visitar = async (dirAbs: string, rel: string): Promise<void> => {
    const res = await listar(dirAbs)
    if (!res?.success) return
    for (const entrada of res.entries ?? []) {
      const nombre = entrada.name
      if (entrada.isDirectory) {
        await visitar(unirCarpeta(dirAbs, nombre), `${rel}/${nombre}`)
        continue
      }
      if (!entrada.isFile) continue
      const abs = unirCarpeta(dirAbs, nombre)
      const subRel = rel === MEDIA_REL_DIR ? '' : rel.slice(MEDIA_REL_DIR.length + 1)
      const destinoAbs = subRel ? unirCarpeta(destino, subRel) : destino
      const copiado = await mediaCopy({ src: abs, destDir: destinoAbs, nombre })
      if (copiado?.ok) copiados++
    }
  }
  await visitar(origen, MEDIA_REL_DIR)
  return { ok: true, movidos: copiados }
}

export type ResultadoReenlace = {
  ok: boolean
  reenlazados: number
  sinEncontrar: string[]
  error?: string
}

/**
 * Busca los archivos de media faltante en la carpeta indicada y los copia al
 * `media/` del proyecto, re-apuntando los clips correspondientes.
 */
export async function reenlazarMediaFaltante(
  tienda: TiendaDAW,
  opts: {
    carpeta: string
    faltantes: Array<{ id: string; rutaRelativa: string }>
    rutaProyecto: string | null | undefined
  },
): Promise<ResultadoReenlace> {
  const api = window.electron
  if (!api?.mediaCopy || !api.mediaBuscar) {
    return { ok: false, reenlazados: 0, sinEncontrar: opts.faltantes.map((f) => f.rutaRelativa) }
  }
  const destino = carpetaMediaProyecto(opts.rutaProyecto)
  if (!destino) return { ok: false, reenlazados: 0, sinEncontrar: opts.faltantes.map((f) => f.rutaRelativa) }

  const nombres = opts.faltantes.map((f) => f.rutaRelativa.split('/').pop() ?? '')
  const buscados = await api.mediaBuscar({ carpeta: opts.carpeta, nombres })
  if (!buscados?.ok) {
    return {
      ok: false,
      reenlazados: 0,
      sinEncontrar: opts.faltantes.map((f) => f.rutaRelativa),
      error: buscados?.error,
    }
  }
  const encontrados = buscados.encontrados ?? {}

  let reenlazados = 0
  const sinEncontrar: string[] = []
  for (const falta of opts.faltantes) {
    const nombre = falta.rutaRelativa.split('/').pop() ?? ''
    const origen = encontrados[nombre] ?? encontrados[falta.rutaRelativa]
    if (!origen) {
      sinEncontrar.push(falta.rutaRelativa)
      continue
    }
    const copiado = await api.mediaCopy({ src: origen, destDir: destino, nombre })
    if (!copiado?.ok) {
      sinEncontrar.push(falta.rutaRelativa)
      continue
    }
    const clip = buscarClipPorReferencia(tienda.obtenerEstado().project, falta.id, falta.rutaRelativa)
    if (!clip) {
      sinEncontrar.push(falta.rutaRelativa)
      continue
    }
    const set = await tienda.executor.execute('clip.setSource', {
      pistaId: clip.pistaId,
      clipId: clip.clipId,
      sourceId: rutaRelativaMedia(copiado.nombre ?? nombre),
    })
    if (set.success) reenlazados++
    else sinEncontrar.push(falta.rutaRelativa)
  }
  return { ok: true, reenlazados, sinEncontrar }
}

function buscarClipPorReferencia(
  proyecto: { tracks?: Array<{ id: string; clips?: Array<{ id: string; source?: { ruta?: string } }> }> } | null,
  referenciaId: string,
  rutaRelativa: string,
): { pistaId: string; clipId: string } | null {
  for (const pista of proyecto?.tracks ?? []) {
    for (const clip of pista.clips ?? []) {
      const ruta = clip.source?.ruta
      if (!ruta) continue
      if (ruta === rutaRelativa) return { pistaId: pista.id, clipId: clip.id }
      if (esRutaMediaRelativa(ruta) && normalizarRutaRelativa(ruta) === normalizarRutaRelativa(rutaRelativa)) {
        return { pistaId: pista.id, clipId: clip.id }
      }
    }
  }
  return null
}

export { carpetaDeProyecto }
