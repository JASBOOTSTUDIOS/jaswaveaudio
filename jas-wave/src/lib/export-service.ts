/**
 * Exportaciones que no pasan por el motor de audio (G2): MIDI (.mid) y proyecto empaquetado
 * (.jaswave.zip). Las usan el diálogo «Exportar», la IA (`export.midi`, `export.projectBundle`) y la CLI.
 * La mezcla y los stems son `render.start` + `runNativeBounce` (bounce-service).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { escribirSmf, proyectoASmf } from '../../../shared/src/midi/smf'
import { planificarPaquete } from '../../../shared/src/project/paquete'
import { MEDIA_PENDING_REL_DIR, normalizarRutaRelativa } from '../../../shared/src/project/ciclo-vida'
import { saveBinaryOrThrow } from './electron-fs'
import { carpetaDeProyecto, resolverRutaMedia, unirCarpeta } from './project-media'

export type ResultadoExport = { ok: boolean; ruta?: string; mensaje: string; detalle?: Record<string, unknown> }

function conExtension(ruta: string, ext: string): string {
  return new RegExp(`\\.${ext}$`, 'i').test(ruta) ? ruta : `${ruta.replace(/\.[^./\\]+$/, '')}.${ext}`
}

/** Exporta notas MIDI: todo el proyecto (una pista SMF por pista), unas pistas o un solo clip. */
export async function exportarMidi(
  tienda: TiendaDAW,
  opts: { ruta: string; trackIds?: string[]; clipId?: string },
): Promise<ResultadoExport> {
  const ruta = conExtension(opts.ruta, 'mid')
  const proyecto = tienda.obtenerEstado().project
  const smf = proyectoASmf(proyecto as never, {
    trackIds: opts.trackIds,
    clipId: opts.clipId,
    clipDesdeCero: !!opts.clipId,
  })
  if (smf.pistas.length === 0) {
    return {
      ok: false,
      mensaje: opts.clipId
        ? 'Ese clip no tiene notas MIDI que exportar.'
        : 'No hay notas MIDI que exportar (las pistas de audio no se incluyen en un .mid).',
    }
  }
  await saveBinaryOrThrow(ruta, escribirSmf(smf))
  const notas = smf.pistas.reduce((n, p) => n + p.notas.length, 0)
  return {
    ok: true,
    ruta,
    mensaje: `MIDI exportado: ${ruta} (${smf.pistas.length} pistas, ${notas} notas, ${smf.bpm} BPM)`,
    detalle: { pistas: smf.pistas.map((p) => p.nombre), notas },
  }
}

/** Empaqueta el proyecto y todo su audio en un zip que se abre en cualquier equipo. */
export async function exportarPaquete(tienda: TiendaDAW, opts: { ruta: string }): Promise<ResultadoExport> {
  const api = window.electron
  if (!api?.projectExportBundle) return { ok: false, mensaje: 'Exportar proyecto empaquetado solo está disponible en la app de escritorio.' }
  const ruta = conExtension(opts.ruta, 'zip')
  try {
    const { snapshotLoadedPluginsIntoProject } = await import('./plugin/track-vst-runtime')
    await snapshotLoadedPluginsIntoProject(tienda)
  } catch {
    /* sin host: se empaqueta el último estado guardado de los plugins */
  }
  const proyecto = tienda.obtenerEstado().project
  const carpeta = carpetaDeProyecto(proyecto.ruta)
  const userData = (await api.userDataPath?.()) ?? null
  const plan = planificarPaquete(proyecto, (rutaClip) => {
    const norm = normalizarRutaRelativa(rutaClip)
    if (norm.startsWith(`${MEDIA_PENDING_REL_DIR}/`)) return userData ? unirCarpeta(userData, norm) : null
    return resolverRutaMedia(rutaClip, carpeta)
  })
  const r = await api.projectExportBundle(ruta, plan.json, plan.nombreProyecto, plan.archivos)
  if (!r?.ok) return { ok: false, mensaje: `No se pudo empaquetar el proyecto: ${r?.error ?? 'error desconocido'}` }
  const mb = ((r.bytes ?? 0) / 1024 / 1024).toFixed(1)
  const aviso = plan.faltantes.length
    ? ` Atención: ${plan.faltantes.length} audio(s) no se encontraron y no van en el paquete: ${plan.faltantes.slice(0, 3).join(', ')}.`
    : ''
  return {
    ok: true,
    ruta,
    mensaje: `Proyecto empaquetado: ${ruta} (${plan.archivos.length} audios, ${mb} MB).${aviso}`,
    detalle: { archivos: plan.archivos.length, faltantes: plan.faltantes },
  }
}
