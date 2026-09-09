import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import {
  composeMidiFromBrief,
  hashSeed,
  parseMidiBriefFromText,
  type Articulation,
  type MidiBarPlan,
} from '../midi-song-generator'
import { pluginRegistry } from '../plugin/registry'
import { descriptorToPluginInfo } from '../plugin/plugin-info-adapter'
import { ensureKnownVstInRegistry } from '../plugin/ensure-known-vst'
import { pickVstForRole, type InstrumentRole } from '../plugin-knowledge'
import {
  applyJasWaveRolesParameter,
  ensureJasWaveRolesRegistered,
  findJasWaveRolesDescriptor,
  isJasWaveRolesDescriptor,
  jasWaveRolesPluginInfo,
} from '../plugin/jaswave-roles'
import {
  ensureJasWavePianoRegistered,
  findJasWavePianoDescriptor,
  jasWavePianoPluginInfo,
} from '../plugin/jaswave-piano'
import type {
  MusicBuildAiPartial,
  MusicBuildResult,
  MusicBuildSpec,
  MusicBuildStage,
  MusicBuildTrackSpec,
  MidiValidationIssue,
  MusicSection,
} from './types'
import { resolveTrackHint } from '../track-resolve'
import { buildMusicBuildSpec, mapSectionKind } from './spec'
import { validateBuildNotes } from './validator'
import { densityForSectionKind } from './form-density'

/** Expande secciones IA → 1 plan por compás (grado + densidad). */
export function expandSectionsToBarPlan(
  sections: MusicSection[],
  globalDegrees: number[],
): MidiBarPlan[] {
  const primary = globalDegrees.length >= 2 ? globalDegrees : [1, 4, 5, 1]
  const out: MidiBarPlan[] = []
  for (const s of sections) {
    const kind = s.kind ?? mapSectionKind(s.name)
    const prog = s.degrees && s.degrees.length >= 2 ? s.degrees : primary
    const dens =
      s.density != null && Number.isFinite(s.density)
        ? Math.max(0.05, Math.min(1, s.density))
        : densityForSectionKind(kind)
    const n = Math.max(1, Math.min(64, s.bars || 4))
    for (let i = 0; i < n; i++) {
      out.push({
        kind,
        degree: prog[i % prog.length]!,
        density: dens,
      })
    }
  }
  if (!out.length) {
    for (let i = 0; i < 8; i++) {
      out.push({ kind: 'verse', degree: primary[i % primary.length]!, density: 0.75 })
    }
  }
  return out
}

/** Insert + load host obligatorio (1 intento + path LOCALAPPDATA forzado). */
async function insertLoadInstrument(
  tienda: TiendaDAW,
  trackId: string,
  info: import('../../../../shared/src/types/entidades').PluginInfo,
  role?: string,
): Promise<boolean> {
  const { defaultJasWaveRolesPath } = await import('../plugin/jaswave-roles')
  const { defaultJasWavePianoPath } = await import('../plugin/jaswave-piano')
  const { resolveHostPluginPath } = await import('../plugin/plugin-info-adapter')
  const { ensureTrackVstInstrument, getLastVstLoadError } = await import('../plugin/track-vst-runtime')

  let forcedPath = resolveHostPluginPath(info)
  if (/jaswave\s*piano/i.test(info.nombre)) forcedPath = defaultJasWavePianoPath() || forcedPath
  if (/jaswave\s*roles/i.test(info.nombre)) forcedPath = defaultJasWaveRolesPath() || forcedPath
  const toInsert = forcedPath ? { ...info, descripcion: forcedPath } : { ...info }

  await tienda.executor.execute('plugin.insert', { trackId, plugin: toInsert })
  const inserted =
    (tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)?.plugins?.at(-1) as
      | typeof info
      | undefined) ?? toInsert
  const withPath = {
    ...inserted,
    descripcion: forcedPath || resolveHostPluginPath(inserted) || String(inserted.descripcion || ''),
  }

  try {
    await window.electron?.pluginHostEnsure?.()
  } catch {
    /* ignore */
  }
  const ok = await Promise.race([
    ensureTrackVstInstrument(trackId, withPath),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25000)),
  ])
  if (ok) {
    // Persistir ruta vía Command System (no establecerEstado).
    if (withPath.descripcion) {
      try {
        await tienda.executor.execute('plugin.update', {
          trackId,
          pluginInstanceId: withPath.id,
          patch: { descripcion: withPath.descripcion },
        })
      } catch {
        /* best-effort */
      }
    }
    if (role && /jaswave\s*roles/i.test(withPath.nombre)) {
      await applyJasWaveRolesParameter(trackId, withPath, role)
    }
    return true
  }
  console.warn('[music-build] host load falló', withPath.nombre, getLastVstLoadError(), forcedPath)
  return false
}

const STAGE_DEFS: Array<{ id: MusicBuildStage['id']; label: string }> = [
  { id: 'spec', label: 'Especificación' },
  { id: 'setup', label: 'Tempo y métrica' },
  { id: 'structure', label: 'Estructura (marcadores)' },
  { id: 'tracks', label: 'Pistas' },
  { id: 'instruments', label: 'Instrumentos (catálogo)' },
  { id: 'midi', label: 'MIDI validado' },
  { id: 'mix', label: 'Mezcla de producción' },
  { id: 'validate', label: 'Validación' },
]

const MIX_BY_ROLE: Record<string, { volumen: number; paneo: number }> = {
  drums: { volumen: 1, paneo: 0 },
  percussion: { volumen: 0.92, paneo: 0.14 },
  bass: { volumen: 0.98, paneo: 0 },
  guitar: { volumen: 0.9, paneo: -0.18 },
  piano: { volumen: 0.95, paneo: -0.08 },
  keys: { volumen: 0.92, paneo: 0.08 },
  pad: { volumen: 0.82, paneo: 0.22 },
  lead: { volumen: 0.96, paneo: 0.05 },
  strings: { volumen: 0.88, paneo: -0.1 },
  brass: { volumen: 0.9, paneo: 0.12 },
  woodwind: { volumen: 0.86, paneo: -0.12 },
  choir: { volumen: 0.85, paneo: 0.1 },
  synth: { volumen: 0.92, paneo: 0 },
  fx: { volumen: 0.7, paneo: 0.25 },
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

function findExistingTrackForSpec(state: ReturnType<TiendaDAW['obtenerEstado']>, t: MusicBuildTrackSpec): string | undefined {
  const byName = resolveTrackHint(state, { label: t.nombre, raw: t.nombre })
  if (byName.trackId && !byName.ambiguous) return byName.trackId
  const byRole = resolveTrackHint(state, { label: String(t.rol), raw: String(t.rol) })
  if (byRole.trackId && !byRole.ambiguous) return byRole.trackId
  return undefined
}

function articulationOf(rol: string, explicit?: string): Articulation {
  const ex = String(explicit ?? '')
    .toLowerCase()
    .trim()
  if (
    ex === 'drums' ||
    ex === 'bass' ||
    ex === 'strum' ||
    ex === 'arp' ||
    ex === 'pad' ||
    ex === 'melody' ||
    ex === 'block'
  ) {
    return ex
  }
  if (ex === 'kit' || ex === 'percussion' || ex === 'perc') return 'drums'
  if (ex === 'finger' || ex === 'fingerpicking' || ex === 'picking') return 'arp'
  if (rol === 'drums' || rol === 'percussion') return 'drums'
  if (rol === 'bass') return 'bass'
  if (rol === 'guitar') return 'strum'
  if (rol === 'pad' || rol === 'strings' || rol === 'choir') return 'pad'
  if (rol === 'lead' || rol === 'brass') return 'melody'
  if (rol === 'piano' || rol === 'keys') return 'block'
  return 'pad'
}

function resolveCatalogPlugin(t: {
  pluginId?: string
  pluginNombre?: string
  rol: string
}): ReturnType<typeof pluginRegistry.findById> {
  const fuzzy = (q: string) => {
    const hits = pluginRegistry.findByName(q)
    if (hits[0]) return hits[0]
    const known = ensureKnownVstInRegistry(q)
    if (known) return known
    const compact = q.replace(/\s+/g, '').toLowerCase()
    return pluginRegistry.list().find((d) => d.name.replace(/\s+/g, '').toLowerCase().includes(compact))
  }
  if (t.pluginId) {
    const byId = pluginRegistry.findById(t.pluginId)
    if (byId) return byId
    const known = ensureKnownVstInRegistry(t.pluginId)
    if (known) return known
    const byIdAsName = fuzzy(t.pluginId)
    if (byIdAsName) return byIdAsName
  }
  if (t.pluginNombre) {
    const byName = fuzzy(t.pluginNombre)
    if (byName) return byName
  }
  return pickVstForRole(pluginRegistry.list(), (t.rol as InstrumentRole) || 'unknown')
}

const SEND_BY_ROLE: Record<string, number> = {
  drums: 0.18,
  percussion: 0.22,
  bass: 0.08,
  guitar: 0.28,
  piano: 0.32,
  keys: 0.3,
  pad: 0.42,
  lead: 0.26,
  strings: 0.38,
  brass: 0.24,
  choir: 0.4,
  synth: 0.28,
  fx: 0.35,
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
  opts: {
    prompt: string
    aplicar: boolean
    bpm?: number
    nombre?: string
    minutos?: number
    /** Solo instrumentos nativos Piano/Roles (sin forzar BFD/catálogo externo). Alias: softPadOnly, nativeOnly. */
    softPadOnly?: boolean
    rolesOnly?: boolean
    nativeOnly?: boolean
    /**
     * Origen del MIDI:
     * - `ai` (default): estructura + VST + marcadores; las notas las escribe la IA
     *   con midi.clip.create (clips llenos por sección, sin stubs vacíos).
     * - `procedural`: composeMidiFromBrief (legado / preview rápida).
     */
    midiSource?: 'ai' | 'procedural'
    /** Spec / campos parciales de la IA (gana sobre heurística). */
    ai?: MusicBuildAiPartial | null
    spec?: MusicBuildAiPartial | null
  },
): Promise<MusicBuildResult> {
  const aiPartial = opts.ai ?? opts.spec ?? null
  const spec = buildMusicBuildSpec(opts.prompt, {
    bpm: opts.bpm,
    nombre: opts.nombre,
    minutos: opts.minutos,
    ai: aiPartial,
  })

  const stages = initStages()
  const genreBit = spec.genero ? ` · ${spec.genero}` : ''
  const srcBit = spec.usedHeuristicFallback ? ' · +fallback' : ' · IA'
  setStage(
    stages,
    'spec',
    'ok',
    `${spec.keyLabel} · ${spec.bpm} BPM · ${spec.minutes} min · ${spec.sections.length} secciones · ${spec.tracks.length} pistas${genreBit}${srcBit}`,
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

  const created: Array<{ trackId: string; specIndex: number; reused?: boolean }> = []
  try {
    setStage(stages, 'tracks', 'running')
    for (let i = 0; i < spec.tracks.length; i++) {
      const t = spec.tracks[i]!
      let trackId = findExistingTrackForSpec(tienda.obtenerEstado(), t)
      let reused = Boolean(trackId)
      if (!trackId) {
        const createdTrack = await tienda.executor.execute('track.create', {
          nombre: t.nombre,
          tipo: t.tipo === 'audio' ? 'audio' : 'midi',
          color: colorForRole(String(t.rol)),
        })
        if (!createdTrack.success) continue
        trackId = tienda.obtenerEstado().project.tracks.at(-1)?.id
        reused = false
      }
      if (!trackId) continue
      try {
        await tienda.executor.execute('track.update', {
          trackId,
          datos: {
            tags: [`role:${String(t.rol)}`, String(t.rol)],
          },
        })
      } catch {
        /* tags opcionales */
      }
      created.push({ trackId, specIndex: i, reused })
    }
    const reusedN = created.filter((c) => c.reused).length
    const detail =
      reusedN > 0
        ? `${created.length} pistas (${reusedN} reutilizadas)`
        : `${created.length} pistas`
    setStage(stages, 'tracks', created.length ? 'ok' : 'fail', detail)
    if (!created.length) failed = true
  } catch (err) {
    failed = true
    setStage(stages, 'tracks', 'fail', err instanceof Error ? err.message : 'Error pistas')
  }

  let instrumentsLoaded = 0
  let rolesPads = 0
  let instrumentsFailed = 0
  setStage(stages, 'instruments', 'running')
  const instrumentNotes: string[] = []
  // rolesOnly (alias softPadOnly): Piano/Roles nativos sin forzar catálogo externo (BFD, etc.)
  const rolesOnly =
    opts.rolesOnly === true || opts.softPadOnly === true || opts.nativeOnly === true
  ensureJasWavePianoRegistered()
  ensureJasWaveRolesRegistered()
  // Host vivo antes de cargar VSTs (tras masterPass/crash previos).
  try {
    await window.electron?.pluginHostEnsure?.()
    await window.electron?.pluginHostSend?.({ type: 'ensureAudio' })
  } catch {
    /* ignore */
  }

  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    if (t.tipo === 'audio') continue
    if (!rolesOnly && String(t.rol) === 'drums' && !t.pluginNombre && !t.pluginId) {
      t.pluginNombre = 'BFD Player'
    }

    let loadedVst = false
    const rol = String(t.rol)
    const markOk = (tag: string, isRoles: boolean) => {
      loadedVst = true
      if (isRoles) rolesPads += 1
      else instrumentsLoaded += 1
      instrumentNotes.push(`${t.nombre}:${tag}`)
    }
    const markFail = (tag: string) => {
      instrumentsFailed += 1
      instrumentNotes.push(`${t.nombre}:${tag}`)
    }

    if (rolesOnly) {
      const wantPiano = rol === 'piano' || rol === 'keys'
      const pianoInfo = wantPiano ? jasWavePianoPluginInfo() : null
      const info = pianoInfo ?? jasWaveRolesPluginInfo()
      if (!info) {
        markFail('roles✗')
        continue
      }
      const ok = await insertLoadInstrument(tienda, row.trackId, info, wantPiano && pianoInfo ? undefined : rol)
      if (ok) markOk(pianoInfo && info.id === pianoInfo.id ? 'piano' : 'roles', !(pianoInfo && info.id === pianoInfo.id))
      else markFail('host✗')
      await new Promise((r) => setTimeout(r, 350))
      continue
    }

    if (t.presetId) {
      try {
        const { libraryApplyPreset } = await import('../library/ops')
        const applied = await libraryApplyPreset(tienda, {
          presetId: t.presetId,
          trackId: row.trackId,
        })
        if (applied.ok) {
          const { ensureProjectVstInstruments } = await import('../plugin/track-vst-runtime')
          const st = tienda.obtenerEstado()
          await ensureProjectVstInstruments(st.project.tracks, st.project.master?.plugins)
          const { getLoadedInstrumentForTrack } = await import('../plugin/track-vst-runtime')
          if (getLoadedInstrumentForTrack(row.trackId)) markOk('preset', false)
          else markFail('preset✗host')
        } else {
          markFail('preset✗')
        }
      } catch {
        markFail('preset✗')
      }
    }

    if (!loadedVst) {
      let d = resolveCatalogPlugin({
        pluginId: t.pluginId,
        pluginNombre: t.pluginNombre,
        rol,
      })
      if (!d || d.format === 'builtin') {
        if (rol === 'piano' || rol === 'keys') {
          d = findJasWavePianoDescriptor() ?? findJasWaveRolesDescriptor() ?? d
        } else {
          d = findJasWaveRolesDescriptor() ?? d
        }
      }
      if (d && d.format !== 'builtin') {
        if (d.path) {
          const { probePluginLoad } = await import('../plugin/track-vst-runtime')
          const probe = await probePluginLoad({ path: d.path, pluginId: d.pluginId })
          if (!probe.ok) {
            instrumentNotes.push(`${t.nombre}:probe✗`)
            d =
              pickVstForRole(
                pluginRegistry.list().filter((x) => x.pluginId !== d!.pluginId && x.hostReady),
                (t.rol as InstrumentRole) || 'unknown',
              ) ?? findJasWaveRolesDescriptor() ?? d
          }
        }
        if (d && d.format !== 'builtin') {
          const info = descriptorToPluginInfo(d)
          const isRoles = isJasWaveRolesDescriptor(d)
          const ok = await insertLoadInstrument(tienda, row.trackId, info, isRoles ? rol : undefined)
          if (ok) {
            t.pluginNombre = d.name
            t.pluginId = d.pluginId
            markOk(isRoles ? 'roles' : 'vst', isRoles)
          } else {
            markFail('host✗')
          }
        }
      }
    }

    if (!loadedVst) {
      const wantPiano = rol === 'piano' || rol === 'keys'
      const pianoInfo = wantPiano ? jasWavePianoPluginInfo() : null
      const info = pianoInfo ?? jasWaveRolesPluginInfo()
      if (!info) {
        markFail('roles✗')
      } else {
        const ok = await insertLoadInstrument(
          tienda,
          row.trackId,
          info,
          pianoInfo && info.id === pianoInfo.id ? undefined : rol,
        )
        if (ok) markOk(pianoInfo && info.id === pianoInfo.id ? 'piano' : 'roles', !(pianoInfo && info.id === pianoInfo.id))
        else markFail('host✗')
      }
    }
  }

  const instOk = rolesPads + instrumentsLoaded
  const midiTrackCount = created.filter((r) => spec.tracks[r.specIndex]?.tipo !== 'audio').length
  // Si quedaron pistas sin host: último intento ensureProjectVstInstruments sobre el estado
  if (instOk < midiTrackCount && midiTrackCount > 0) {
    try {
      const { ensureProjectVstInstruments, getLoadedInstrumentForTrack } = await import(
        '../plugin/track-vst-runtime'
      )
      const st = tienda.obtenerEstado()
      await ensureProjectVstInstruments(st.project.tracks, st.project.master?.plugins)
      let rescued = 0
      for (const row of created) {
        if (spec.tracks[row.specIndex]?.tipo === 'audio') continue
        if (getLoadedInstrumentForTrack(row.trackId)) rescued += 1
      }
      if (rescued > instOk) {
        instrumentsLoaded = Math.max(instrumentsLoaded, rescued - rolesPads)
        instrumentNotes.push(`rescue:${rescued}`)
      }
    } catch {
      /* ignore */
    }
  }
  const instOkFinal = rolesPads + instrumentsLoaded
  // Host no confirmado: avisar pero no abortar el MIDI (Roles/native suelen sonar igual).
  {
    const { getLoadedInstrumentForTrack } = await import('../plugin/track-vst-runtime')
    let missingHost = 0
    for (const row of created) {
      if (spec.tracks[row.specIndex]?.tipo === 'audio') continue
      if (!getLoadedInstrumentForTrack(row.trackId)) missingHost += 1
    }
    if (instOkFinal === 0 && midiTrackCount > 0) {
      failed = true
      setStage(stages, 'instruments', 'fail', `Ningún instrumento en host · ${instrumentNotes.slice(0, 6).join(', ')}`)
    } else if (missingHost > 0 && midiTrackCount > 0) {
      setStage(
        stages,
        'instruments',
        'ok',
        `parcial · ${instOkFinal} ok · ${missingHost} sin slot host · ${instrumentNotes.slice(0, 4).join(', ')}`,
      )
    } else if (instrumentsFailed > 0 && instOkFinal < midiTrackCount) {
      setStage(
        stages,
        'instruments',
        'ok',
        `${rolesPads} Roles · ${instrumentsLoaded} VST · ${instrumentsFailed} fallos · ${instrumentNotes.slice(0, 4).join(', ')}`,
      )
    } else {
      setStage(
        stages,
        'instruments',
        instOkFinal ? 'ok' : 'skip',
        instOkFinal
          ? `${rolesPads} Roles · ${instrumentsLoaded} VST${instrumentNotes.length ? ` · ${instrumentNotes.slice(0, 4).join(', ')}` : ''}`
          : 'Sin instrumentos',
      )
    }
  }

  setStage(stages, 'midi', 'running')
  const midiSource = opts.midiSource === 'procedural' ? 'procedural' : 'ai'
  const midiMinutes = Math.max(0.25, Number(spec.minutes) || 1)
  let barPlan = expandSectionsToBarPlan(spec.sections, spec.degrees)
  const maxBars = Math.max(4, Math.ceil((midiMinutes * Math.max(1, spec.bpm)) / 4))
  if (barPlan.length > maxBars) {
    barPlan = barPlan.slice(0, maxBars)
  }
  const clipNotes: Array<{ trackName: string; rol: string; notes: ReturnType<typeof composeMidiFromBrief>['notes'] }> =
    []

  if (midiSource === 'ai') {
    // Estructura + VST + marcadores. La IA inserta clips LLENOS por sección (no stubs vacíos).
    const durationBeats = Math.max(4, maxBars * 4)
    const sectionSpans: Array<{ name: string; inicio: number; duracion: number }> = []
    {
      let cursor = 0
      const secs =
        spec.sections?.length > 0
          ? spec.sections
          : [{ name: 'Tema', bars: Math.max(4, maxBars) }]
      for (const s of secs) {
        const bars = Math.max(1, Math.min(64, s.bars || 4))
        const dur = bars * 4
        if (cursor / 4 >= maxBars) break
        const clipped = Math.min(dur, maxBars * 4 - cursor)
        if (clipped < 4) break
        sectionSpans.push({ name: s.name || 'Sección', inicio: cursor, duracion: clipped })
        cursor += clipped
      }
      if (!sectionSpans.length) {
        sectionSpans.push({ name: 'Tema', inicio: 0, duracion: durationBeats })
      }
    }
    const midiTracks = created.filter((row) => spec.tracks[row.specIndex]?.tipo !== 'audio')
    try {
      const { writeAgentDoc, getAgentDoc, PLAN_SLUG, setMarkdownSection } = await import('../agent-docs')
      const projectId = tienda.obtenerEstado().project.id
      const tasks: string[] = []
      for (const row of midiTracks) {
        const t = spec.tracks[row.specIndex]!
        for (const sec of sectionSpans) {
          tasks.push(
            `- [ ] MIDI «${t.nombre}» · sección ${sec.name} (beats ${sec.inicio}–${sec.inicio + sec.duracion}) · ${row.trackId} · rol ${t.rol}`,
          )
        }
      }
      const prev = getAgentDoc(projectId, PLAN_SLUG)?.content ?? '# Plan\n'
      let next = setMarkdownSection(
        prev,
        'Intención',
        `${spec.nombre} · ${spec.keyLabel} · ${spec.bpm} BPM · ${spec.minutes} min · clips por sección (sin stubs vacíos). El harness inserta midi.clip.create con notas en cada hueco.\n`,
      )
      next = setMarkdownSection(
        next,
        'Por implementar',
        `${tasks.join('\n')}\n- [ ] Mezcla / sends\n- [ ] Bounce / compareTarget (streaming)\n`,
      )
      writeAgentDoc(projectId, PLAN_SLUG, next, { origin: 'ai' })
    } catch {
      /* docs opcionales */
    }
    setStage(
      stages,
      'midi',
      'ok',
      `Pendiente IA: ${midiTracks.length} pistas × ${sectionSpans.length} secciones · midi.clip.create con notas (sin clips vacíos)`,
    )
  } else {
    // Procedural: un clip con notas por sección (no un mega-clip de toda la canción)
    const sectionSpans: Array<{ name: string; inicio: number; duracion: number; bars: number }> = []
    {
      let cursor = 0
      const secs =
        spec.sections?.length > 0
          ? spec.sections
          : [{ name: 'Tema', bars: Math.max(4, maxBars) }]
      for (const s of secs) {
        const bars = Math.max(1, Math.min(64, s.bars || 4))
        const dur = bars * 4
        if (cursor / 4 >= maxBars) break
        const clipped = Math.min(dur, maxBars * 4 - cursor)
        if (clipped < 4) break
        sectionSpans.push({
          name: s.name || 'Sección',
          inicio: cursor,
          duracion: clipped,
          bars: Math.max(1, Math.round(clipped / 4)),
        })
        cursor += clipped
      }
      if (!sectionSpans.length) {
        sectionSpans.push({
          name: 'Tema',
          inicio: 0,
          duracion: Math.max(4, maxBars * 4),
          bars: Math.max(4, maxBars),
        })
      }
    }
    for (const row of created) {
      const t = spec.tracks[row.specIndex]!
      if (t.tipo === 'audio') continue
      let art = articulationOf(String(t.rol), t.articulacion ? String(t.articulacion) : undefined)
      const g = String(spec.genero ?? '').toLowerCase()
      if ((g === 'worship' || g === 'gospel' || /worship|alabanza/.test(opts.prompt)) && String(t.rol) === 'guitar') {
        art = 'arp' // fingerpicking suave
      }
      if ((g === 'bachata' || /bachata|prince/.test(opts.prompt)) && String(t.rol) === 'guitar') {
        art = 'strum'
      }
      if ((g === 'bachata' || /bachata/.test(opts.prompt)) && String(t.rol) === 'lead') {
        art = 'melody'
      }
      if ((g === 'worship' || g === 'gospel') && String(t.rol) === 'drums') {
        // kits más abiertos / less busy vía density del plan
      }
      const brief = parseMidiBriefFromText(`${opts.prompt} ${spec.genero ?? ''} ${t.rol} ${t.nombre}`, spec.bpm)
      brief.articulation = art
      brief.minutes = midiMinutes
      brief.keyRoot = spec.keyRoot
      brief.scale = spec.scale
      brief.keyLabel = spec.keyLabel
      brief.degrees = spec.degrees.length ? spec.degrees : brief.degrees
      if (g === 'worship' || g === 'gospel') {
        brief.velocityBase = Math.min(brief.velocityBase, 96)
        brief.velocityAccent = Math.min(brief.velocityAccent ?? 112, 112)
      }
      const song = composeMidiFromBrief(brief, {
        bpm: spec.bpm,
        seed: hashSeed(`${spec.nombre}|${t.nombre}|${art}|${spec.genero ?? ''}|ai-form`),
        barPlan,
        aiDirected: !spec.usedHeuristicFallback || !!aiPartial,
      })
      clipNotes.push({ trackName: t.nombre, rol: String(t.rol), notes: song.notes })
      for (const sec of sectionSpans) {
        const secEnd = sec.inicio + sec.duracion
        const localNotes = (song.notes ?? [])
          .filter((n) => {
            const start = Number(n.inicio) || 0
            return start >= sec.inicio - 1e-6 && start < secEnd - 1e-6
          })
          .map((n) => ({
            ...n,
            inicio: Math.max(0, (Number(n.inicio) || 0) - sec.inicio),
          }))
        await tienda.executor.execute('midi.clip.create', {
          pistaId: row.trackId,
          nombre: `${t.nombre} · ${sec.name}`,
          inicio: sec.inicio,
          duracion: sec.duracion,
          notas: localNotes,
        })
      }
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
        : `${clipNotes.reduce((n, c) => n + c.notes.length, 0)} notas · ${sectionSpans.length} secciones · ${midiIssues.filter((i) => i.severity === 'warn').length} avisos`,
    )
  }

  setStage(stages, 'mix', 'running')
  let reverbBusId: string | undefined
  // rolesOnly corto: sin bus Reverb (menos churn de graph/host; el silence P0 es piano dry).
  const skipFxBus = opts.rolesOnly === true || opts.softPadOnly === true || opts.nativeOnly === true
  if (!skipFxBus) {
    try {
      const busRes = await tienda.executor.execute('bus.create', {
        nombre: 'Reverb FX',
        tipo: 'fx',
      })
      if (busRes.success && busRes.result && typeof busRes.result === 'object') {
        const rid = (busRes.result as { busId?: string }).busId
        if (rid) reverbBusId = rid
      }
    } catch {
      /* routing opcional */
    }
  }
  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    const mix = MIX_BY_ROLE[String(t.rol)] ?? { volumen: 0.95, paneo: 0 }
    await tienda.executor.execute('track.update', {
      trackId: row.trackId,
      datos: { volumen: mix.volumen, paneo: mix.paneo },
    })
    if (reverbBusId && t.tipo !== 'audio') {
      const amount = SEND_BY_ROLE[String(t.rol)] ?? 0.25
      try {
        await tienda.executor.execute('send.set', {
          trackId: row.trackId,
          busId: reverbBusId,
          amount,
          nombre: 'Reverb',
        })
      } catch {
        /* ignore */
      }
    }
  }
  await tienda.executor.execute('master.update', { datos: { volumen: 1 } })
  setStage(
    stages,
    'mix',
    'ok',
    reverbBusId
      ? 'Vol/pan por rol · bus Reverb FX + sends'
      : 'Volumen y paneo por rol',
  )

  // Rescue ligero: una sola pasada ensureProject (sin reintentos largos)
  try {
    const { ensureProjectVstInstruments, getLoadedInstrumentForTrack, getLastVstLoadError } = await import(
      '../plugin/track-vst-runtime'
    )
    const st = tienda.obtenerEstado()
    await Promise.race([
      ensureProjectVstInstruments(st.project.tracks, st.project.master?.plugins),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ensure timeout')), 20000)),
    ])
    // Graph: lo publica playback via registerProjectGraphResync / useEffect (evitar IPC
    // extra aquí — puede colgar el bridge si el host reinició mid-load).
    let loadedN = 0
    for (const row of created) {
      if (spec.tracks[row.specIndex]?.tipo === 'audio') continue
      if (getLoadedInstrumentForTrack(row.trackId)) loadedN += 1
    }
    const midiN = created.filter((r) => spec.tracks[r.specIndex]?.tipo !== 'audio').length
    if (loadedN >= midiN && midiN > 0) {
      setStage(stages, 'instruments', 'ok', `host ${loadedN}/${midiN}`)
    } else if (midiN > 0) {
      failed = true
      setStage(
        stages,
        'instruments',
        'fail',
        `host-slot-unconfirmed · ${loadedN}/${midiN} · ${getLastVstLoadError() || 'sin slot'}`,
      )
    }
  } catch (e) {
    console.warn('[music-build] ensureProject rescue', e)
  }

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
