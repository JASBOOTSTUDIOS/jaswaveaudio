import {
  inferClipNameFromText,
  inferKeyFromText,
  inferMinutesFromText,
  inferProgressionFromText,
  parseMidiBriefFromText,
  type MidiSongSection,
} from '../midi-song-generator'
import { draftArrangement } from '../plugin-knowledge'
import { pluginRegistry } from '../plugin/registry'
import type {
  MusicBuildAiPartial,
  MusicBuildSpec,
  MusicBuildTrackSpec,
  MusicSection,
} from './types'

const DEFAULT_FORM: MusicSection[] = [
  { name: 'Intro', bars: 8 },
  { name: 'Verso', bars: 16 },
  { name: 'Estribillo', bars: 16 },
  { name: 'Verso 2', bars: 16 },
  { name: 'Estribillo 2', bars: 16 },
  { name: 'Puente', bars: 8 },
  { name: 'Final', bars: 8 },
]

function clampDegrees(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined
  const degs = raw.map((n) => Math.max(1, Math.min(7, Math.round(Number(n))))).filter((n) => Number.isFinite(n))
  return degs.length >= 2 ? degs : undefined
}

function sectionsFromText(text: string, minutes: number, bpm: number): MusicSection[] {
  const t = text.toLowerCase()
  if (/intro|verso|coro|estribillo|puente|outro|pre-?coro/.test(t)) {
    const parts: MusicSection[] = []
    const push = (name: string, bars: number) => {
      if (!parts.some((p) => p.name === name)) parts.push({ name, bars })
    }
    if (/intro/.test(t)) push('Intro', 8)
    if (/verso|verse/.test(t)) push('Verso', 16)
    if (/pre-?coro|pre-?chorus/.test(t)) push('Pre-coro', 8)
    if (/estribillo|coro|chorus/.test(t)) push('Estribillo', 16)
    if (/puente|bridge/.test(t)) push('Puente', 8)
    if (/outro|final|coda/.test(t)) push('Outro', 8)
    if (parts.length >= 2) return parts
  }
  const totalBars = Math.max(16, Math.round((minutes * bpm) / 4))
  if (totalBars <= 32) {
    return [
      { name: 'Intro', bars: 4 },
      { name: 'Tema', bars: Math.max(8, totalBars - 8) },
      { name: 'Outro', bars: 4 },
    ]
  }
  return DEFAULT_FORM.map((s) => ({ ...s }))
}

export function mapSectionKind(name: string, explicit?: string): MidiSongSection {
  if (
    explicit === 'intro' ||
    explicit === 'verse' ||
    explicit === 'chorus' ||
    explicit === 'bridge' ||
    explicit === 'outro' ||
    explicit === 'breakdown' ||
    explicit === 'build'
  ) {
    return explicit
  }
  const n = name.toLowerCase()
  if (/intro/.test(n)) return 'intro'
  if (/outro|final|coda/.test(n)) return 'outro'
  if (/bridge|puente/.test(n)) return 'bridge'
  if (/break|breakdown/.test(n)) return 'breakdown'
  if (/build|sube|ris|pre-?coro|pre-?chorus/.test(n)) return 'build'
  if (/coro|estribillo|chorus|hook/.test(n)) return 'chorus'
  return 'verse'
}

/** Normaliza secciones del payload IA. */
type AiSectionRaw = NonNullable<MusicBuildAiPartial['secciones']>[number] | MusicSection

export function normalizeAiSections(partial: MusicBuildAiPartial): MusicSection[] | undefined {
  const raw = (partial.sections ?? partial.secciones) as AiSectionRaw[] | undefined
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: MusicSection[] = []
  for (const s of raw) {
    const sa = s as {
      name?: string
      nombre?: string
      bars?: number
      compases?: number
      degrees?: number[]
      progresion?: number[]
      density?: number
      densidad?: number
      kind?: string
    }
    const name = String(sa.name ?? sa.nombre ?? 'Sección').trim() || 'Sección'
    const bars = Math.max(1, Math.min(64, Number(sa.bars ?? sa.compases ?? 8) || 8))
    const degrees = clampDegrees(sa.degrees ?? sa.progresion)
    const densityRaw = sa.density ?? sa.densidad
    const density =
      densityRaw != null && Number.isFinite(Number(densityRaw))
        ? Math.max(0.05, Math.min(1, Number(densityRaw)))
        : undefined
    const kind = mapSectionKind(name, sa.kind ? String(sa.kind) : undefined)
    out.push({ name, bars, degrees, density, kind })
  }
  return out.length ? out : undefined
}

type AiTrackRaw = NonNullable<MusicBuildAiPartial['pistas']>[number] | MusicBuildTrackSpec

function normalizeAiTracks(partial: MusicBuildAiPartial): MusicBuildTrackSpec[] | undefined {
  const raw = (partial.tracks ?? partial.pistas) as AiTrackRaw[] | undefined
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((tr) => {
    const t = tr as {
      nombre?: string
      name?: string
      rol?: string
      tipo?: string
      articulacion?: string
      pluginNombre?: string
      pluginId?: string
      presetId?: string
    }
    const tipoRaw = String(t.tipo ?? 'midi')
    const tipo: MusicBuildTrackSpec['tipo'] =
      tipoRaw === 'audio' ? 'audio' : tipoRaw === 'instrumento' ? 'instrumento' : 'midi'
    return {
      nombre: String(t.nombre ?? t.name ?? 'Pista'),
      rol: String(t.rol ?? 'keys'),
      tipo,
      articulacion: t.articulacion ? String(t.articulacion) : undefined,
      pluginNombre: t.pluginNombre ? String(t.pluginNombre) : undefined,
      pluginId: t.pluginId ? String(t.pluginId) : undefined,
      presetId: t.presetId ? String(t.presetId) : undefined,
    }
  })
}

/**
 * Spec heurístico (fallback). Solo se usa cuando la IA no aporta campos.
 */
export function specFromPrompt(prompt: string, bpmHint?: number): MusicBuildSpec {
  const bpmMatch = prompt.match(/\b(\d{2,3})\s*bpm\b/i) || prompt.match(/\bbpm\s*(?:a|de|=|:)?\s*(\d{2,3})/i)
  const generoHit = prompt.match(
    /\b(bachata|merengue|metal|rock|jazz|salsa|reggaeton|reggaet[oó]n|house|techno|ambient|trap|hip-?hop|funk|blues|classical|worship|gospel|synthwave|edm|pop|cumbia|bossa|flamenco|prince\s*royce)\b/i,
  )
  const g = generoHit?.[1]?.toLowerCase().replace(/\s+/g, ' ')
  let bpm = bpmHint || (bpmMatch ? Number(bpmMatch[1]) : undefined) || undefined
  if (bpm == null) {
    if (g && /bachata|prince/.test(g)) bpm = 125
    else if (g && /reggaeton|reggaetón/.test(g)) bpm = 95
    else if (g && /worship|gospel/.test(g)) bpm = 72
    else bpm = 120
  }
  const brief = parseMidiBriefFromText(prompt, bpm)
  const key = inferKeyFromText(prompt)
  const minutes = inferMinutesFromText(prompt, g && /bachata|prince|merengue/.test(g ?? '') ? 3 : 2)
  const drafts = draftArrangement(prompt, pluginRegistry.list())
  const degrees = inferProgressionFromText(prompt) ?? brief.degrees
  const tracks =
    g && /bachata|prince|merengue/.test(g)
      ? bachataDefaultTracks()
      : drafts.map((d) => ({
          nombre: d.nombre,
          rol: d.rol,
          tipo: d.tipo as MusicBuildTrackSpec['tipo'],
          articulacion: d.articulacion,
          pluginNombre: d.pluginName,
          pluginId: d.pluginId,
        }))
  return {
    nombre: inferClipNameFromText(prompt, key.label),
    prompt,
    bpm,
    keyRoot: key.explicit ? key.root : brief.keyRoot,
    scale: key.explicit ? key.scale : brief.scale,
    keyLabel: key.explicit ? key.label : brief.keyLabel,
    minutes,
    degrees: degrees.length ? degrees : brief.degrees.length ? brief.degrees : [1, 5, 6, 4],
    sections: scaleSectionsToMinutes(sectionsFromText(prompt, minutes, bpm), minutes, bpm),
    tracks,
    genero: g === 'prince royce' ? 'bachata' : g,
    usedHeuristicFallback: true,
  }
}

/** Ajusta barras para aproximar la duración pedida (p. ej. 3 min). */
function scaleSectionsToMinutes(sections: MusicSection[], minutes: number, bpm: number): MusicSection[] {
  const targetBars = Math.max(16, Math.round((minutes * bpm) / 4))
  const current = sections.reduce((n, s) => n + s.bars, 0) || 1
  if (Math.abs(current - targetBars) <= 8) return sections
  const factor = targetBars / current
  const scaled = sections.map((s) => ({
    ...s,
    bars: Math.max(4, Math.round(s.bars * factor / 4) * 4),
  }))
  const sum = scaled.reduce((n, s) => n + s.bars, 0)
  const delta = targetBars - sum
  if (delta !== 0 && scaled.length) {
    const last = scaled[scaled.length - 1]!
    last.bars = Math.max(4, last.bars + delta)
  }
  return scaled
}

/** Plantilla bachata: ritmo + bajo + guitarras típicas. */
function bachataDefaultTracks(): MusicBuildTrackSpec[] {
  return [
    { nombre: 'Bongó / Congas', rol: 'drums', tipo: 'midi', articulacion: 'drums' },
    { nombre: 'Güira', rol: 'percussion', tipo: 'midi', articulacion: 'drums' },
    { nombre: 'Bajo', rol: 'bass', tipo: 'midi', articulacion: 'bass' },
    { nombre: 'Guitarra rítmica', rol: 'guitar', tipo: 'midi', articulacion: 'strum' },
    { nombre: 'Requinto', rol: 'lead', tipo: 'midi', articulacion: 'melody' },
    { nombre: 'Piano', rol: 'keys', tipo: 'midi', articulacion: 'block' },
  ]
}

/**
 * IA gana sobre heurística. Campos omitidos se rellenan del base.
 */
export function mergeMusicBuildSpec(base: MusicBuildSpec, ai?: MusicBuildAiPartial | null): MusicBuildSpec {
  if (!ai || typeof ai !== 'object') {
    return { ...base, usedHeuristicFallback: true }
  }

  let usedHeuristic = false
  const out: MusicBuildSpec = {
    ...base,
    sections: base.sections.map((s) => ({ ...s })),
    tracks: base.tracks.map((t) => ({ ...t })),
  }

  if (ai.nombre) out.nombre = String(ai.nombre)
  if (ai.prompt) out.prompt = String(ai.prompt)
  if (ai.bpm != null && Number.isFinite(Number(ai.bpm))) out.bpm = Math.max(20, Math.min(400, Number(ai.bpm)))
  const mins = ai.minutos ?? ai.minutes
  if (mins != null && Number.isFinite(Number(mins))) out.minutes = Math.max(0.25, Number(mins))

  const genero = ai.genero ?? ai.genre
  if (genero) out.genero = String(genero)

  if (ai.tonalidad) {
    const k = inferKeyFromText(String(ai.tonalidad))
    if (k.explicit) {
      out.keyRoot = k.root
      out.scale = k.scale
      out.keyLabel = k.label
    }
  }
  if (ai.keyRoot != null) out.keyRoot = Number(ai.keyRoot)
  if (ai.scale === 'major' || ai.scale === 'minor') out.scale = ai.scale
  if (ai.keyLabel) out.keyLabel = String(ai.keyLabel)

  const aiDegrees = clampDegrees(ai.degrees ?? ai.progresion ?? ai.progression)
  if (aiDegrees) {
    out.degrees = aiDegrees
  } else {
    usedHeuristic = true
  }

  const aiSections = normalizeAiSections(ai)
  if (aiSections) {
    out.sections = aiSections
  } else {
    usedHeuristic = true
  }

  const aiTracks = normalizeAiTracks(ai)
  if (aiTracks) {
    out.tracks = aiTracks
  } else {
    usedHeuristic = true
  }

  // Si la IA dio secciones sin degrees, hereda progresión global
  out.sections = out.sections.map((s) => ({
    ...s,
    kind: s.kind ?? mapSectionKind(s.name),
    degrees: s.degrees?.length ? s.degrees : out.degrees,
  }))

  applyBachataGuards(out)

  out.usedHeuristicFallback = usedHeuristic
  if (typeof console !== 'undefined' && out.usedHeuristicFallback) {
    console.info(
      '[music-build] Usando fallback heurístico en algún campo (genero/forma/progresión/pistas). Preferir spec completo de la IA.',
    )
  }
  return out
}

/** Evita bachata a 70 BPM / pocas pistas cuando el modelo alucina half-time. */
function applyBachataGuards(spec: MusicBuildSpec): void {
  const blob = `${spec.genero ?? ''} ${spec.prompt ?? ''}`.toLowerCase()
  if (!/bachata|prince\s*royce/.test(blob)) return
  spec.genero = spec.genero || 'bachata'
  if (spec.bpm < 100 || spec.bpm > 160) spec.bpm = 125
  if (spec.tracks.length < 4) spec.tracks = bachataDefaultTracks()
}

export function buildMusicBuildSpec(
  prompt: string,
  opts?: { bpm?: number; nombre?: string; minutos?: number; ai?: MusicBuildAiPartial | null },
): MusicBuildSpec {
  const base = specFromPrompt(prompt, opts?.bpm)
  const merged = mergeMusicBuildSpec(base, opts?.ai)
  if (opts?.nombre) merged.nombre = opts.nombre
  if (opts?.minutos != null && Number.isFinite(opts.minutos)) {
    merged.minutes = Math.max(0.25, Number(opts.minutos))
  }
  if (opts?.bpm != null && Number.isFinite(opts.bpm)) {
    merged.bpm = Math.max(20, Math.min(400, Number(opts.bpm)))
  }
  applyBachataGuards(merged)
  return merged
}
