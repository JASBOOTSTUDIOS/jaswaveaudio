/**
 * Operaciones de biblioteca: guardar / aplicar / audicionar presets del proyecto.
 */

import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { PluginDescriptor } from '../plugin/types'
import {
  composeMidiFromBrief,
  hashSeed,
  parseMidiBriefFromText,
  type Articulation,
} from '../midi-song-generator'
import { pluginRegistry } from '../plugin/registry'
import { descriptorToPluginInfo, extractHostPluginPath } from '../plugin/plugin-info-adapter'
import {
  ensureTrackVstPlugin,
  getSlotPluginStateBase64,
  listSlotParameters,
  probePluginLoad,
  slotIdForTrackPlugin,
  type PluginProbeResult,
} from '../plugin/track-vst-runtime'
import {
  getLibraryPreset,
  listLibraryPresets,
  saveLibraryPreset,
  searchLibraryPresets,
  updateLibraryPresetMeta,
  type LibraryPreset,
} from './preset-catalog'

function projectIds(tienda: TiendaDAW): { projectId: string; ruta?: string } {
  const p = tienda.obtenerEstado().project
  return { projectId: p.id || 'default', ruta: p.ruta }
}

export function libraryList(tienda: TiendaDAW): LibraryPreset[] {
  return listLibraryPresets(projectIds(tienda).projectId)
}

export function librarySearch(
  tienda: TiendaDAW,
  opts?: { query?: string; rol?: string; genero?: string },
): LibraryPreset[] {
  return searchLibraryPresets(projectIds(tienda).projectId, opts)
}

export async function librarySaveFromTrack(
  tienda: TiendaDAW,
  opts: {
    trackId: string
    pluginInstanceId?: string
    nombre: string
    rol?: string
    generoTags?: string[]
    notas?: string
  },
): Promise<{ ok: boolean; preset?: LibraryPreset; message: string }> {
  const { projectId, ruta } = projectIds(tienda)
  const st = tienda.obtenerEstado()
  const track = st.project.tracks.find((t) => t.id === opts.trackId)
  if (!track) return { ok: false, message: 'Pista no encontrada' }
  const plugins = track.plugins ?? []
  const plugin =
    (opts.pluginInstanceId ? plugins.find((p) => p.id === opts.pluginInstanceId) : undefined) ??
    plugins.find((p) => extractHostPluginPath(p.descripcion || '')) ??
    plugins[0]
  if (!plugin) return { ok: false, message: 'La pista no tiene plugin VST' }

  const path = extractHostPluginPath(plugin.descripcion || '')
  const slotId = slotIdForTrackPlugin(opts.trackId, plugin.id)
  let chunk = plugin.estadoPluginBase64
  try {
    const live = await getSlotPluginStateBase64(slotId)
    if (live) chunk = live
  } catch {
    /* keep stored */
  }
  let parametros = plugin.parametros?.map((p) => ({
    id: String(p.id),
    nombre: p.nombre || String(p.id),
    valor: Number(p.valor) || 0,
  }))
  try {
    const liveParams = await listSlotParameters(slotId)
    if (liveParams.length) {
      parametros = liveParams.map((rp) => ({
        id: String(rp.parameterId),
        nombre: rp.name || String(rp.parameterId),
        valor: Number(rp.normalizedValue) || 0,
      }))
    }
  } catch {
    /* keep */
  }

  let probeOk: boolean | undefined
  let probedAt: number | undefined
  if (path) {
    const probe = await probePluginLoad({ path, pluginId: plugin.id })
    probeOk = probe.ok
    probedAt = Date.now()
  }

  const preset = await saveLibraryPreset(
    projectId,
    {
      pluginId: plugin.id,
      pluginNombre: plugin.nombre,
      pluginPath: path || undefined,
      nombre: opts.nombre,
      rol: opts.rol,
      generoTags: opts.generoTags ?? [],
      notas: opts.notas,
      estadoPluginBase64: chunk,
      parametros,
      probeOk,
      probedAt,
    },
    ruta,
  )
  return {
    ok: true,
    preset,
    message: `Preset «${preset.nombre}» guardado${probeOk === false ? ' (probe falló)' : ''}`,
  }
}

export async function libraryApplyPreset(
  tienda: TiendaDAW,
  opts: { presetId: string; trackId: string },
): Promise<{ ok: boolean; message: string; probe?: PluginProbeResult }> {
  const { projectId } = projectIds(tienda)
  const preset = getLibraryPreset(projectId, opts.presetId)
  if (!preset) return { ok: false, message: 'Preset no encontrado' }

  let d =
    (preset.pluginPath
      ? pluginRegistry.list().find((x) => x.path === preset.pluginPath)
      : undefined) ??
    pluginRegistry.findById(preset.pluginId) ??
    pluginRegistry.findByName(preset.pluginNombre)[0]

  if (!d && preset.pluginPath) {
    // Descriptor mínimo para insertar por path
    d = {
      pluginId: preset.pluginId || `path:${preset.pluginPath}`,
      name: preset.pluginNombre,
      path: preset.pluginPath,
      format: preset.pluginPath.toLowerCase().endsWith('.dll') ? 'vst2' : 'vst3',
      category: 'instrument',
      isInstrument: true,
      isEffect: false,
      vendor: '',
      version: '',
      hostReady: true,
      scanStatus: 'ok',
      supportsMidiInput: true,
      supportsMidiOutput: false,
      supportsAudioInput: false,
      supportsAudioOutput: true,
      supportsSidechain: false,
      supportsEditor: true,
      parameterCount: 0,
      isolation: 'out-of-process',
    } as PluginDescriptor
    pluginRegistry.register(d)
  }
  if (!d) return { ok: false, message: `Plugin «${preset.pluginNombre}» no está en el catálogo` }

  let probe: PluginProbeResult | undefined
  if (d.path) {
    probe = await probePluginLoad({ path: d.path, pluginId: d.pluginId })
    await updateLibraryPresetMeta(projectId, preset.id, {
      probeOk: probe.ok,
      probedAt: Date.now(),
    })
    if (!probe.ok) {
      return { ok: false, message: `Probe falló: ${probe.message}`, probe }
    }
  }

  const info = descriptorToPluginInfo(d) as PluginInfo
  if (preset.estadoPluginBase64) info.estadoPluginBase64 = preset.estadoPluginBase64
  if (preset.parametros?.length) {
    info.parametros = preset.parametros.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      valor: p.valor,
      minimo: 0,
      maximo: 1,
      paso: 0.001,
      unidad: '',
      etiqueta: p.nombre,
    }))
  }

  const r = await tienda.executor.execute('plugin.insert', {
    trackId: opts.trackId,
    plugin: info,
  })
  if (!r.success) {
    return { ok: false, message: r.error?.message ?? 'plugin.insert falló', probe }
  }
  const inserted =
    tienda.obtenerEstado().project.tracks.find((t) => t.id === opts.trackId)?.plugins?.at(-1) ?? info
  await ensureTrackVstPlugin(opts.trackId, { ...info, id: inserted.id })
  return { ok: true, message: `Preset «${preset.nombre}» aplicado a la pista`, probe }
}

export async function libraryAuditionPreset(
  tienda: TiendaDAW,
  opts: { presetId: string; bars?: number; articulacion?: string },
): Promise<{ ok: boolean; message: string; trackId?: string }> {
  const st = tienda.obtenerEstado()
  const created = await tienda.executor.execute('track.create', {
    nombre: `Audition · ${opts.presetId.slice(0, 8)}`,
    tipo: 'midi',
    color: '#64748b',
  })
  if (!created.success) {
    return { ok: false, message: created.error?.message ?? 'No se pudo crear pista de audition' }
  }
  const trackId = tienda.obtenerEstado().project.tracks.at(-1)?.id
  if (!trackId) return { ok: false, message: 'Sin trackId de audition' }

  const applied = await libraryApplyPreset(tienda, { presetId: opts.presetId, trackId })
  if (!applied.ok) {
    await tienda.executor.execute('track.delete', { trackId })
    return { ok: false, message: applied.message }
  }

  const preset = getLibraryPreset(projectIds(tienda).projectId, opts.presetId)
  const art = (opts.articulacion as Articulation) ||
    (preset?.rol === 'drums' ? 'drums' : preset?.rol === 'bass' ? 'bass' : 'pad')
  const bpm = st.project.bpm?.valor ?? st.transport?.bpm ?? 120
  const bars = Math.max(1, Math.min(8, opts.bars ?? 2))
  const brief = parseMidiBriefFromText(`audition ${preset?.rol ?? 'keys'}`, bpm)
  brief.articulation = art
  brief.minutes = (bars * 4) / Math.max(1, bpm)
  const song = composeMidiFromBrief(brief, {
    bpm,
    seed: hashSeed(`audition|${opts.presetId}`),
    aiDirected: true,
  })
  await tienda.executor.execute('midi.clip.create', {
    pistaId: trackId,
    nombre: 'Audition',
    inicio: 0,
    duracion: song.durationBeats,
    notas: song.notes,
  })
  await tienda.executor.execute('transport.seek', { segundos: 0 })
  await tienda.executor.execute('transport.toggle', {})
  return {
    ok: true,
    trackId,
    message: `Audición «${preset?.nombre ?? opts.presetId}» en pista temporal (${bars}c). Para quedártelo: library.preset.apply en tu pista.`,
  }
}

export async function libraryProbeByRef(
  opts: { pluginId?: string; path?: string; nombre?: string },
): Promise<PluginProbeResult> {
  const d =
    (opts.pluginId ? pluginRegistry.findById(opts.pluginId) : undefined) ??
    (opts.nombre ? pluginRegistry.findByName(opts.nombre)[0] : undefined) ??
    (opts.path
      ? pluginRegistry.list().find((x) => x.path === opts.path)
      : undefined)
  const path = opts.path || d?.path
  if (!path) return { ok: false, message: 'Plugin no encontrado en catálogo (falta path)' }
  return probePluginLoad({ path, pluginId: d?.pluginId ?? opts.pluginId })
}
