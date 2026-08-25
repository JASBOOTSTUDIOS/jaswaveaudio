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
import { pickVstForRole, type InstrumentRole } from '../plugin-knowledge'
import {
  applyJasWaveRolesParameter,
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
  MidiValidationIssue,
  MusicSection,
} from './types'
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
    const compact = q.replace(/\s+/g, '').toLowerCase()
    return pluginRegistry.list().find((d) => d.name.replace(/\s+/g, '').toLowerCase().includes(compact))
  }
  /** Alias locales frecuentes (usuario: Descent=DecentSampler, Font Piano→Kontakt). */
  const KNOWN: Record<string, { name: string; path: string }> = {
    descent: {
      name: 'DecentSampler',
      path: 'C:\\Program Files\\Common Files\\VST3\\DecentSampler.vst3',
    },
    decentsampler: {
      name: 'DecentSampler',
      path: 'C:\\Program Files\\Common Files\\VST3\\DecentSampler.vst3',
    },
    decentsample: {
      name: 'DecentSampler',
      path: 'C:\\Program Files\\Common Files\\VST3\\DecentSampler.vst3',
    },
    font: {
      name: 'Kontakt',
      path: 'C:\\Program Files\\Common Files\\VST3\\Kontakt.vst3',
    },
    fontpiano: {
      name: 'Kontakt',
      path: 'C:\\Program Files\\Common Files\\VST3\\Kontakt.vst3',
    },
    kontakt: {
      name: 'Kontakt',
      path: 'C:\\Program Files\\Common Files\\VST3\\Kontakt.vst3',
    },
    bfd: {
      name: 'BFD Player',
      path: 'C:\\Program Files\\Common Files\\VST3\\BFDPlayer.vst3',
    },
    bfdplayer: {
      name: 'BFD Player',
      path: 'C:\\Program Files\\Common Files\\VST3\\BFDPlayer.vst3',
    },
  }
  const ensureKnown = (key: string) => {
    const k = key.replace(/\s+/g, '').toLowerCase()
    const hit = KNOWN[k]
    if (!hit) return undefined
    const existing =
      pluginRegistry.list().find((d) => d.path === hit.path) ?? pluginRegistry.findByName(hit.name)[0]
    if (existing) return existing
    const d = {
      pluginId: `path:${hit.path}`,
      name: hit.name,
      path: hit.path,
      format: 'vst3' as const,
      category: 'instrument',
      isInstrument: true,
      isEffect: false,
      vendor: '',
      version: '',
      hostReady: true,
      scanStatus: 'ok' as const,
      supportsMidiInput: true,
      supportsMidiOutput: false,
      supportsAudioInput: false,
      supportsAudioOutput: true,
      supportsSidechain: false,
      supportsEditor: true,
      parameterCount: 0,
      isolation: 'out-of-process' as const,
    }
    pluginRegistry.register(d)
    return d
  }
  if (t.pluginId) {
    const byId = pluginRegistry.findById(t.pluginId)
    if (byId) return byId
    const known = ensureKnown(t.pluginId)
    if (known) return known
    const byIdAsName = fuzzy(t.pluginId)
    if (byIdAsName) return byIdAsName
  }
  if (t.pluginNombre) {
    const known = ensureKnown(t.pluginNombre)
    if (known) return known
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
    /** Solo Soft Pad (sin VST). Evita crashes/cuarentena en pruebas de buffer. */
    softPadOnly?: boolean
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
      created.push({ trackId, specIndex: i })
    }
    setStage(stages, 'tracks', created.length ? 'ok' : 'fail', `${created.length} pistas`)
    if (!created.length) failed = true
  } catch (err) {
    failed = true
    setStage(stages, 'tracks', 'fail', err instanceof Error ? err.message : 'Error pistas')
  }

  let instrumentsLoaded = 0
  let rolesPads = 0
  setStage(stages, 'instruments', 'running')
  const instrumentNotes: string[] = []
  const softPadOnly = opts.softPadOnly === true
  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    if (t.tipo === 'audio') continue
    // Preferir BFD Player en drums antes de resolver catálogo (GM: 36/38/42).
    if (!softPadOnly && String(t.rol) === 'drums' && !t.pluginNombre && !t.pluginId) {
      t.pluginNombre = 'BFD Player'
    }

    let loadedVst = false
    if (softPadOnly) {
      // softPadOnly → Piano VST para piano/keys; Roles para el resto
      try {
        const rol = String(t.rol)
        const wantPiano = rol === 'piano' || rol === 'keys'
        ensureJasWavePianoRegistered()
        const pianoInfo = wantPiano ? jasWavePianoPluginInfo() : null
        const info = pianoInfo ?? jasWaveRolesPluginInfo()
        if (info) {
          await tienda.executor.execute('plugin.insert', { trackId: row.trackId, plugin: info })
          const { ensureTrackVstInstrument } = await import('../plugin/track-vst-runtime')
          await ensureTrackVstInstrument(row.trackId, info)
          if (pianoInfo && info.id === pianoInfo.id) {
            instrumentsLoaded += 1
            instrumentNotes.push(`${t.nombre}:piano`)
          } else {
            await applyJasWaveRolesParameter(row.trackId, info, rol)
            rolesPads += 1
            instrumentNotes.push(`${t.nombre}:roles`)
          }
          loadedVst = true
        }
      } catch {
        instrumentNotes.push(`${t.nombre}:roles✗`)
      }
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
          instrumentsLoaded += 1
          loadedVst = true
          instrumentNotes.push(`${t.nombre}:preset`)
        } else {
          instrumentNotes.push(`${t.nombre}:preset✗`)
        }
      } catch {
        instrumentNotes.push(`${t.nombre}:preset✗`)
      }
    }
    if (!loadedVst) {
      let d = resolveCatalogPlugin({
        pluginId: t.pluginId,
        pluginNombre: t.pluginNombre,
        rol: String(t.rol),
      })
      // Piano/keys → JasWave Piano; resto sin catálogo → Roles
      const rol = String(t.rol)
      if (!d || d.format === 'builtin') {
        if (rol === 'piano' || rol === 'keys') {
          ensureJasWavePianoRegistered()
          d = findJasWavePianoDescriptor() ?? findJasWaveRolesDescriptor() ?? d
        } else {
          d = findJasWaveRolesDescriptor() ?? d
        }
      }
      if (d && d.format !== 'builtin') {
        if (d.path) {
          try {
            const { probePluginLoad } = await import('../plugin/track-vst-runtime')
            const probe = await probePluginLoad({ path: d.path, pluginId: d.pluginId })
            if (!probe.ok) {
              instrumentNotes.push(`${t.nombre}:probe✗`)
              const fallback =
                pickVstForRole(
                  pluginRegistry.list().filter((x) => x.pluginId !== d!.pluginId && x.hostReady),
                  (t.rol as InstrumentRole) || 'unknown',
                ) ?? findJasWaveRolesDescriptor()
              if (fallback && fallback.format !== 'builtin') {
                const info = descriptorToPluginInfo(fallback)
                await tienda.executor.execute('plugin.insert', { trackId: row.trackId, plugin: info })
                try {
                  const { ensureTrackVstInstrument } = await import('../plugin/track-vst-runtime')
                  await ensureTrackVstInstrument(row.trackId, info)
                  if (isJasWaveRolesDescriptor(fallback)) {
                    await applyJasWaveRolesParameter(row.trackId, info, String(t.rol))
                    rolesPads += 1
                  }
                } catch {
                  /* host opcional */
                }
                t.pluginNombre = fallback.name
                t.pluginId = fallback.pluginId
                instrumentsLoaded += 1
                loadedVst = true
              }
            } else {
              const info = descriptorToPluginInfo(d)
              await tienda.executor.execute('plugin.insert', { trackId: row.trackId, plugin: info })
              try {
                const { ensureTrackVstInstrument } = await import('../plugin/track-vst-runtime')
                await ensureTrackVstInstrument(row.trackId, info)
                if (isJasWaveRolesDescriptor(d)) {
                  await applyJasWaveRolesParameter(row.trackId, info, String(t.rol))
                  rolesPads += 1
                }
              } catch {
                /* host opcional */
              }
              t.pluginNombre = d.name
              t.pluginId = d.pluginId
              instrumentsLoaded += 1
              loadedVst = true
            }
          } catch {
            /* probe optional — intentar insert igual */
            const info = descriptorToPluginInfo(d)
            await tienda.executor.execute('plugin.insert', { trackId: row.trackId, plugin: info })
            try {
              const { ensureTrackVstInstrument } = await import('../plugin/track-vst-runtime')
              await ensureTrackVstInstrument(row.trackId, info)
              if (isJasWaveRolesDescriptor(d)) {
                await applyJasWaveRolesParameter(row.trackId, info, String(t.rol))
                rolesPads += 1
              }
            } catch {
              /* host opcional */
            }
            t.pluginNombre = d.name
            t.pluginId = d.pluginId
            instrumentsLoaded += 1
            loadedVst = true
          }
        } else {
          const info = descriptorToPluginInfo(d)
          await tienda.executor.execute('plugin.insert', { trackId: row.trackId, plugin: info })
          try {
            const { ensureTrackVstInstrument } = await import('../plugin/track-vst-runtime')
            await ensureTrackVstInstrument(row.trackId, info)
            if (isJasWaveRolesDescriptor(d)) {
              await applyJasWaveRolesParameter(row.trackId, info, String(t.rol))
              rolesPads += 1
            }
          } catch {
            /* host opcional */
          }
          t.pluginNombre = d.name
          t.pluginId = d.pluginId
          instrumentsLoaded += 1
          loadedVst = true
        }
      }
    }
    if (!loadedVst) {
      try {
        const rol = String(t.rol)
        const wantPiano = rol === 'piano' || rol === 'keys'
        ensureJasWavePianoRegistered()
        const pianoInfo = wantPiano ? jasWavePianoPluginInfo() : null
        const info = pianoInfo ?? jasWaveRolesPluginInfo()
        if (info) {
          await tienda.executor.execute('plugin.insert', {
            trackId: row.trackId,
            plugin: info,
          })
          const { ensureTrackVstInstrument } = await import('../plugin/track-vst-runtime')
          await ensureTrackVstInstrument(row.trackId, info)
          if (pianoInfo && info.id === pianoInfo.id) {
            instrumentsLoaded += 1
            instrumentNotes.push(`${t.nombre}:piano`)
          } else {
            await applyJasWaveRolesParameter(row.trackId, info, rol)
            rolesPads += 1
            instrumentNotes.push(`${t.nombre}:roles`)
          }
        } else {
          instrumentNotes.push(`${t.nombre}:roles✗`)
        }
      } catch {
        instrumentNotes.push(`${t.nombre}:roles✗`)
      }
    }
  }
  setStage(
    stages,
    'instruments',
    rolesPads || instrumentsLoaded ? 'ok' : 'skip',
    rolesPads || instrumentsLoaded
      ? `${rolesPads} Roles · ${instrumentsLoaded} VST${instrumentNotes.length ? ` · ${instrumentNotes.slice(0, 4).join(', ')}` : ''}`
      : 'Sin instrumentos',
  )

  const sectionBeats = spec.sections.reduce((n, s) => n + s.bars, 0) * 4
  const midiMinutes = Math.max(spec.minutes, sectionBeats / Math.max(1, spec.bpm))
  const barPlan = expandSectionsToBarPlan(spec.sections, spec.degrees)
  const clipNotes: Array<{ trackName: string; rol: string; notes: ReturnType<typeof composeMidiFromBrief>['notes'] }> =
    []

  setStage(stages, 'midi', 'running')
  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    if (t.tipo === 'audio') continue
    let art = articulationOf(String(t.rol), t.articulacion ? String(t.articulacion) : undefined)
    const g = String(spec.genero ?? '').toLowerCase()
    if ((g === 'worship' || g === 'gospel' || /worship|alabanza/.test(opts.prompt)) && String(t.rol) === 'guitar') {
      art = 'arp' // fingerpicking suave
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
      brief.velocityBase = Math.min(brief.velocityBase, 78)
      brief.velocityAccent = Math.min(brief.velocityAccent ?? 96, 96)
    }
    const song = composeMidiFromBrief(brief, {
      bpm: spec.bpm,
      seed: hashSeed(`${spec.nombre}|${t.nombre}|${art}|${spec.genero ?? ''}|ai-form`),
      barPlan,
      aiDirected: !spec.usedHeuristicFallback || !!aiPartial,
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
  let reverbBusId: string | undefined
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
  for (const row of created) {
    const t = spec.tracks[row.specIndex]!
    const mix = MIX_BY_ROLE[String(t.rol)] ?? { volumen: 0.72, paneo: 0 }
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
  await tienda.executor.execute('master.update', { datos: { volumen: 0.88 } })
  setStage(
    stages,
    'mix',
    'ok',
    reverbBusId
      ? 'Vol/pan por rol · bus Reverb FX + sends'
      : 'Volumen y paneo por rol',
  )

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
