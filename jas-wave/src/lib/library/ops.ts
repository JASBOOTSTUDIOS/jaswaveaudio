/**
 * Operaciones de biblioteca: guardar / aplicar / audicionar presets (proyecto + global).
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
  type LibraryPresetScope,
  type LibraryPresetType,
} from './preset-catalog'
import {
  deleteGlobalPreset,
  getGlobalPreset,
  importGlobalPreset,
  listGlobalPresets,
  promoteProjectPresetToGlobal,
  saveGlobalFxChainPreset,
  saveGlobalPreset,
  searchGlobalPresets,
  updateGlobalPresetMeta,
} from './global-preset-catalog'

export type LibraryListScope = LibraryPresetScope | 'all'

function projectIds(tienda: TiendaDAW): { projectId: string; ruta?: string } {
  const p = tienda.obtenerEstado().project
  return { projectId: p.id || 'default', ruta: p.ruta }
}

export async function resolveLibraryPreset(
  tienda: TiendaDAW,
  presetId: string,
): Promise<LibraryPreset | undefined> {
  const { projectId } = projectIds(tienda)
  const local = getLibraryPreset(projectId, presetId)
  if (local) return local
  return getGlobalPreset(presetId)
}

export async function libraryList(
  tienda: TiendaDAW,
  scope: LibraryListScope = 'project',
): Promise<LibraryPreset[]> {
  const { projectId } = projectIds(tienda)
  if (scope === 'global') return listGlobalPresets()
  if (scope === 'all') {
    const global = await listGlobalPresets()
    const project = listLibraryPresets(projectId).map((p) => ({ ...p, scope: p.scope ?? 'project' }))
    const globalIds = new Set(global.map((p) => p.id))
    return [...global, ...project.filter((p) => !globalIds.has(p.id))]
  }
  return listLibraryPresets(projectId)
}

export async function librarySearch(
  tienda: TiendaDAW,
  opts?: { query?: string; rol?: string; genero?: string; scope?: LibraryListScope; type?: LibraryPresetType },
): Promise<LibraryPreset[]> {
  const scope = opts?.scope ?? 'all'
  const { projectId } = projectIds(tienda)
  const filterLocal = (list: LibraryPreset[]) => {
    const q = (opts?.query ?? '').toLowerCase().trim()
    const rol = (opts?.rol ?? '').toLowerCase().trim()
    const genero = (opts?.genero ?? '').toLowerCase().trim()
    const type = opts?.type
    return list.filter((p) => {
      if (type && (p.type ?? 'plugin') !== type) return false
      if (rol && (p.rol ?? '').toLowerCase() !== rol) return false
      if (genero && !p.generoTags.some((t) => t.toLowerCase().includes(genero))) return false
      if (!q) return true
      const hay = `${p.nombre} ${p.pluginNombre} ${p.rol ?? ''} ${p.notas ?? ''} ${p.generoTags.join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }
  if (scope === 'project') return filterLocal(searchLibraryPresets(projectId, opts))
  if (scope === 'global') return searchGlobalPresets(opts)
  const merged = await libraryList(tienda, 'all')
  return filterLocal(merged)
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
    global?: boolean
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

  const payload = {
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
    type: 'plugin' as const,
  }

  if (opts.global) {
    try {
      const preset = await saveGlobalPreset(payload)
      return {
        ok: true,
        preset,
        message: `Preset global «${preset.nombre}» guardado${probeOk === false ? ' (probe falló)' : ''}`,
      }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'No se pudo guardar preset global',
      }
    }
  }

  const preset = await saveLibraryPreset(projectId, payload, ruta)
  return {
    ok: true,
    preset,
    message: `Preset «${preset.nombre}» guardado${probeOk === false ? ' (probe falló)' : ''}`,
  }
}

export async function librarySaveGlobalFromTrack(
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
  return librarySaveFromTrack(tienda, { ...opts, global: true })
}

export async function libraryPromoteToGlobal(
  tienda: TiendaDAW,
  presetId: string,
): Promise<{ ok: boolean; preset?: LibraryPreset; message: string }> {
  const { projectId } = projectIds(tienda)
  const preset = getLibraryPreset(projectId, presetId)
  if (!preset) return { ok: false, message: 'Preset de proyecto no encontrado' }
  const global = await promoteProjectPresetToGlobal(preset)
  return { ok: true, preset: global, message: `«${preset.nombre}» promovido a biblioteca global` }
}

export async function libraryImportGlobalPreset(
  json: string,
): Promise<{ ok: boolean; preset?: LibraryPreset; message: string }> {
  return importGlobalPreset(json)
}

export async function libraryDeletePreset(
  tienda: TiendaDAW,
  presetId: string,
  scope?: LibraryPresetScope,
): Promise<{ ok: boolean; message: string }> {
  const { projectId, ruta } = projectIds(tienda)
  if (scope === 'global' || (scope === undefined && (await getGlobalPreset(presetId)))) {
    const deleted = await deleteGlobalPreset(presetId)
    return deleted
      ? { ok: true, message: 'Preset global eliminado' }
      : { ok: false, message: 'Preset global no encontrado' }
  }
  const { deleteLibraryPreset } = await import('./preset-catalog')
  const deleted = await deleteLibraryPreset(projectId, presetId, ruta)
  return deleted
    ? { ok: true, message: 'Preset de proyecto eliminado' }
    : { ok: false, message: 'Preset no encontrado' }
}

async function applyPluginPreset(
  tienda: TiendaDAW,
  preset: LibraryPreset,
  trackId: string,
): Promise<{ ok: boolean; message: string; probe?: PluginProbeResult }> {
  const { projectId, ruta } = projectIds(tienda)

  let d =
    (preset.pluginPath
      ? pluginRegistry.list().find((x) => x.path === preset.pluginPath)
      : undefined) ??
    pluginRegistry.findById(preset.pluginId) ??
    pluginRegistry.findByName(preset.pluginNombre)[0]

  if (!d && preset.pluginPath) {
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
    if (preset.scope === 'global') {
      await updateGlobalPresetMeta(preset.id, { probeOk: probe.ok, probedAt: Date.now() })
    } else {
      await updateLibraryPresetMeta(projectId, preset.id, { probeOk: probe.ok, probedAt: Date.now() }, ruta)
    }
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
    trackId,
    plugin: info,
  })
  if (!r.success) {
    return { ok: false, message: r.error?.message ?? 'plugin.insert falló', probe }
  }
  const inserted =
    tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)?.plugins?.at(-1) ?? info
  await ensureTrackVstPlugin(trackId, { ...info, id: inserted.id })
  return { ok: true, message: `Preset «${preset.nombre}» aplicado a la pista`, probe }
}

export async function libraryApplyPreset(
  tienda: TiendaDAW,
  opts: { presetId: string; trackId: string },
): Promise<{ ok: boolean; message: string; probe?: PluginProbeResult }> {
  const preset = await resolveLibraryPreset(tienda, opts.presetId)
  if (!preset) return { ok: false, message: 'Preset no encontrado (proyecto ni global)' }

  if ((preset.type ?? 'plugin') === 'fxChain' && preset.fxChainPlugins?.length) {
    const r = await tienda.executor.execute('fxChain.loadPreset', {
      trackId: opts.trackId,
      presetId: preset.id,
      nombre: preset.nombre,
      plugins: preset.fxChainPlugins,
    })
    if (!r.success) {
      return { ok: false, message: r.error?.message ?? 'fxChain.loadPreset falló' }
    }
    return { ok: true, message: `Cadena FX «${preset.nombre}» cargada (${preset.fxChainPlugins.length} plugins)` }
  }

  return applyPluginPreset(tienda, preset, opts.trackId)
}

export async function libraryAuditionPreset(
  tienda: TiendaDAW,
  opts: { presetId: string; bars?: number; articulacion?: string },
): Promise<{ ok: boolean; message: string; trackId?: string }> {
  const st = tienda.obtenerEstado()
  const preset = await resolveLibraryPreset(tienda, opts.presetId)
  if (!preset) return { ok: false, message: 'Preset no encontrado' }

  if ((preset.type ?? 'plugin') === 'fxChain') {
    return { ok: false, message: 'Audición no disponible para presets de cadena FX' }
  }

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

export async function librarySaveFxChainGlobal(
  tienda: TiendaDAW,
  opts: { trackId: string; nombre: string; rol?: string; generoTags?: string[] },
): Promise<{ ok: boolean; preset?: LibraryPreset; message: string }> {
  const st = tienda.obtenerEstado()
  const track = st.project.tracks.find((t) => t.id === opts.trackId)
  if (!track) return { ok: false, message: 'Pista no encontrada' }
  const plugins = track.plugins ?? []
  if (!plugins.length) return { ok: false, message: 'Cadena FX vacía' }

  const presetId = `fxpreset-${Date.now().toString(36)}`
  const snap = await tienda.executor.execute('fxChain.savePreset', {
    trackId: opts.trackId,
    presetId,
    nombre: opts.nombre,
  })
  const savedPlugins =
    snap.success && snap.result && typeof snap.result === 'object'
      ? ((snap.result as { plugins?: PluginInfo[] }).plugins ?? plugins)
      : plugins

  for (const p of savedPlugins) {
    const path = extractHostPluginPath(p.descripcion || '')
    if (!path) continue
    const slotId = slotIdForTrackPlugin(opts.trackId, p.id)
    try {
      const live = await getSlotPluginStateBase64(slotId)
      if (live) p.estadoPluginBase64 = live
    } catch {
      /* keep stored */
    }
  }

  const preset = await saveGlobalFxChainPreset({
    nombre: opts.nombre,
    trackHint: track.nombre,
    plugins: savedPlugins,
    rol: opts.rol,
    generoTags: opts.generoTags,
  })
  return { ok: true, preset, message: `Cadena FX global «${preset.nombre}» guardada` }
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

/** Resumen corto para contexto IA (top N por rol/género). */
export async function formatLibraryPresetsForContext(
  tienda: TiendaDAW,
  limit = 12,
): Promise<string> {
  const list = await libraryList(tienda, 'all')
  if (!list.length) return '(sin presets en biblioteca)'
  const top = list.slice(0, limit)
  return top
    .map(
      (p) =>
        `- id=${p.id} «${p.nombre}» plugin=${p.pluginNombre}${p.rol ? ` rol=${p.rol}` : ''}${p.scope === 'global' ? ' [global]' : ''}${p.type === 'fxChain' ? ' [fxChain]' : ''}${p.generoTags.length ? ` tags=${p.generoTags.join('/')}` : ''}`,
    )
    .join('\n')
}
