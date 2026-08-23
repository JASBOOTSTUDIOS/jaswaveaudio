import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import {
  composeMidiFromBrief,
  hashSeed,
  parseMidiBriefFromText,
  type Articulation,
} from '../midi-song-generator'
import { pluginRegistry } from '../plugin/registry'
import { descriptorToPluginInfo } from '../plugin/plugin-info-adapter'
import { pickVstForRole, type InstrumentRole } from '../plugin-knowledge'
import type { MusicBuildResult, MusicBuildSpec, MusicBuildStage, MidiValidationIssue } from './types'
import { specFromPrompt } from './spec'
import { validateBuildNotes } from './validator'

const STAGE_DEFS: Array<{ id: MusicBuildStage['id']; label: string }> = [
  { id: 'spec', label: 'Especificación' },
  { id: 'setup', label: 'Tempo y métrica' },
  { id: 'structure', label: 'Estructura (marcadores)' },
  { id: 'tracks', label: 'Pistas' },
  { id: 'instruments', label: 'Instrumentos (catálogo)' },
  { id: 'midi', label: 'MIDI validado' },
  { id: 'mix', label: 'Mezcla por rol' },
  { id: 'validate', label: 'Validación' },
]

const MIX_BY_ROLE: Record<string, { volumen: number; paneo: number }> = {
  drums: { volumen: 0.84, paneo: 0 },
  percussion: { volumen: 0.72, paneo: 0.14 },
  bass: { volumen: 0.78, paneo: 0 },
  guitar: { volumen: 0.68, paneo: -0.18 },
  piano: { volumen: 0.7, paneo: -0.08 },
  keys: { volumen: 0.68, paneo: 0.08 },
  pad: { volumen: 0.52, paneo: 0.22 },
  lead: { volumen: 0.74, paneo: 0.05 },
  strings: { volumen: 0.62, paneo: -0.1 },
  brass: { volumen: 0.64, paneo: 0.12 },
  woodwind: { volumen: 0.6, paneo: -0.12 },
  choir: { volumen: 0.58, paneo: 0.1 },
  synth: { volumen: 0.66, paneo: 0 },
  fx: { volumen: 0.4, paneo: 0.25 },
}

function colorForRole(rol: string): string {
  if (rol === 'drums' || rol === 'percussion') return '#f59e0b'
  if (rol === 'bass') return '#38bdf8'
  if (rol === 'lead') return '#f472b6'
  if (rol === 'pad') return '#818cf8'
  if (rol === 'guitar') return '#fb7185'
  if (rol === 'piano' || rol === 'keys') return '#a78bfa'
  return '#94a3b8'
}

function articulationOf(rol: string, explicit?: string): Articulation {
  if (
    explicit === 'drums' ||
    explicit === 'bass' ||
    explicit === 'strum' ||
    explicit === 'arp' ||
    explicit === 'pad' ||
    explicit === 'melody' ||
    explicit === 'block'
  ) {
    return explicit
  }
  if (rol === 'drums' || rol === 'percussion') return 'drums'
  if (rol === 'bass') return 'bass'
  if (rol === 'guitar') return 'strum'
  if (rol === 'pad' || rol === 'strings' || rol === 'choir') return 'pad'
  if (rol === 'lead' || rol === 'brass') return 'melody'
  if (rol === 'piano' || rol === 'keys') return 'block'
  return 'arp'
}

function initStages(): MusicBuildStage[] {
  return STAGE_DEFS.map((s) => ({ ...s, status: 'pending' as const }))
}

function setStage(stages: MusicBuildStage[], id: MusicBuildStage['id'], status: MusicBuildStage['status'], detail?: string) {
  const s = stages.find((x) => x.id === id)
  if (!s) return
  s.status = status
  if (detail) s.detail = detail
}

export function specToProjectPlan(spec: MusicBuildSpec, applied = false) {
  return {
    kind: 'projectPlan' as const,
    nombre: spec.nombre,
    bpm: spec.bpm,
    keyLabel: spec.keyLabel,
    minutes: spec.minutes,
    pensamiento: `Music Build · ${spec.sections.map((s) => `${s.name} ${s.bars}c`).join(' → ')}`,
    tracks: spec.tracks.map((t) => ({
      nombre: t.nombre,
      rol: String(t.rol),
      tipo: t.tipo,
      pluginNombre: t.pluginNombre,
      pluginId: t.pluginId,
      articulacion: t.articulacion ? String(t.articulacion) : undefined,
    })),
    applied,
    status: (applied ? 'applied' : 'pending') as 'applied' | 'pending',
  }
}

export async function executeMusicBuild(
  tienda: TiendaDAW,
  opts: { prompt: string; aplicar: boolean; bpm?: number; nombre?: string; minutos?: number },
): Promise<MusicBuildResult> {
  const spec = specFromPrompt(opts.prompt, opts.bpm)
  if (opts.nombre) spec.nombre = opts.nombre
  if (opts.minutos != null && Number.isFinite(opts.minutos)) spec.minutes = Math.max(0.25, Number(opts.minutos))

  const stages = initStages()
  setStage(
    stages,
    'spec',
    'ok',
    `${spec.keyLabel} · ${spec.bpm} BPM · ${spec.minutes} min · ${spec.sections.length} secciones · ${spec.tracks.length} pistas`,
  )

  if (!opts.aplicar) {
    for (const s of stages) {
      if (s.id !== 'spec') s.status = 'pending'
    }
    return {
      kind: 'musicBuild',
      spec,
      stages,
      issues: [],
      applied: false,
      status: 'planned',
    }
  }

  const issues: MidiValidationIssue[] = []
  let failed = false

  try {
    setStage(stages, 'setup', 'running')
    await tienda.executor.execute('project.setBpm', { bpm: spec.bpm })
    await tienda.executor.execute('project.setTimeSignature', { numerador: 4, denominador: 4 })
    setStage(stages, 'setup', 'ok', `${spec.bpm} BPM · 4/4`)
  } catch (err) {
    failed = true
    setStage(stages, 'setup', 'fail', err instanceof Error ? err.message : 'Error setup')
  }

  try {
    setStage(stages, 'structure', 'running')
    let beat = 0
    for (const section of spec.sections) {
      await tienda.executor.execute('marker.create', {
        nombre: `${section.name} (${section.bars}c)`,
        tiempo: beat,
      })
      beat += section.bars * 4
    }
    setStage(stages, 'structure', 'ok', spec.sections.map((s) => s.name).join(' → '))
  } catch (err) {
    setStage(stages, 'structure', 'fail', err instanceof Error ? err.message : 'Error marcadores')
  }

  const created: Array<{ trackId: string; specIndex: number }> = []
  try {
    setStage(stages, 'tracks', 'running')
    for (let i = 0; i < spec.tracks.length; i++) {
      const t = spec.tracks[i]!
      const createdTrack = await tienda.executor.execute('track.create', {
        nombre: t.nombre,
        tipo: t.tipo === 'audio' ? 'audio' : 'midi',
        color: colorForRole(String(t.rol)),
      })
      if (!createdTrack.success) continue
      const trackId = tienda.obtenerEstado().project.tracks.at(-1)?.id
      if (!trackId) continue
      created.push({ trackId, specIndex: i })
    }
    setStage(stages, 'tracks', created.length ? 'ok' : 'fail', `${created.length} pistas`)
    if (!created.length) failed = true
  } catch (err) {
    failed = true
    setStage(stages, 'tracks', 'fail', err instanceof Error ? err.message : 'Error pistas')
  }

  let instrumentsLoaded = 0
  setStage(stages, 'instruments', 'running')
  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    if (t.tipo === 'audio') continue
    const d =
      (t.pluginId ? pluginRegistry.findById(t.pluginId) : undefined) ??
      (t.pluginNombre ? pluginRegistry.findByName(t.pluginNombre)[0] : undefined) ??
      pickVstForRole(pluginRegistry.list(), (t.rol as InstrumentRole) || 'unknown')
    if (!d) continue
    const info = descriptorToPluginInfo(d)
    await tienda.executor.execute('plugin.insert', { trackId: row.trackId, plugin: info })
    try {
      const { ensureTrackVstInstrument } = await import('../plugin/track-vst-runtime')
      void ensureTrackVstInstrument(row.trackId, info)
    } catch {
      /* host opcional */
    }
    t.pluginNombre = d.name
    t.pluginId = d.pluginId
    instrumentsLoaded += 1
  }
  setStage(
    stages,
    'instruments',
    instrumentsLoaded ? 'ok' : 'skip',
    instrumentsLoaded
      ? `${instrumentsLoaded} VST del catálogo`
      : 'Sin VST de catálogo; se usa el instrumento builtin',
  )

  const sectionBeats = spec.sections.reduce((n, s) => n + s.bars, 0) * 4
  const midiMinutes = Math.max(spec.minutes, sectionBeats / Math.max(1, spec.bpm))
  const clipNotes: Array<{ trackName: string; rol: string; notes: ReturnType<typeof composeMidiFromBrief>['notes'] }> =
    []

  setStage(stages, 'midi', 'running')
  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    if (t.tipo === 'audio') continue
    const art = articulationOf(String(t.rol), t.articulacion ? String(t.articulacion) : undefined)
    const brief = parseMidiBriefFromText(`${opts.prompt} ${t.rol} ${t.nombre}`, spec.bpm)
    brief.articulation = art
    brief.minutes = midiMinutes
    brief.keyRoot = spec.keyRoot
    brief.scale = spec.scale
    brief.keyLabel = spec.keyLabel
    brief.degrees = spec.degrees.length ? spec.degrees : brief.degrees
    const song = composeMidiFromBrief(brief, {
      bpm: spec.bpm,
      seed: hashSeed(`${spec.nombre}|${t.nombre}|${art}`),
    })
    clipNotes.push({ trackName: t.nombre, rol: String(t.rol), notes: song.notes })
    await tienda.executor.execute('midi.clip.create', {
      pistaId: row.trackId,
      nombre: t.nombre,
      inicio: 0,
      duracion: song.durationBeats,
      notas: song.notes,
    })
  }
  const midiIssues = validateBuildNotes(clipNotes, spec.keyRoot, spec.scale)
  issues.push(...midiIssues)
  const midiErrors = midiIssues.filter((i) => i.severity === 'error')
  setStage(
    stages,
    'midi',
    midiErrors.length ? 'fail' : 'ok',
    midiErrors.length
      ? midiErrors.map((i) => i.message).join('; ')
      : `${clipNotes.reduce((n, c) => n + c.notes.length, 0)} notas · ${midiIssues.filter((i) => i.severity === 'warn').length} avisos`,
  )

  setStage(stages, 'mix', 'running')
  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    const mix = MIX_BY_ROLE[String(t.rol)] ?? { volumen: 0.72, paneo: 0 }
    await tienda.executor.execute('track.update', {
      trackId: row.trackId,
      datos: { volumen: mix.volumen, paneo: mix.paneo },
    })
  }
  await tienda.executor.execute('master.update', { datos: { volumen: 0.92 } })
  setStage(stages, 'mix', 'ok', 'Volumen y paneo por rol')

  const blocking = issues.filter((i) => i.severity === 'error')
  setStage(
    stages,
    'validate',
    blocking.length ? 'fail' : 'ok',
    blocking.length ? `${blocking.length} errores` : `${issues.length} avisos, sin errores`,
  )

  return {
    kind: 'musicBuild',
    spec,
    stages,
    issues,
    applied: !failed,
    status: failed ? 'failed' : 'completed',
  }
}
