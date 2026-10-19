/**
 * Informe de gap de estilo (p. ej. batería vs el estilo/artista que pida el usuario)
 * en lenguaje de productor — no códigos P1/P2 ni “244.0b”.
 * Neutral: la referencia sale del pedido del usuario o de un StyleProfile; ningún
 * género ni artista tiene trato especial por defecto.
 */

import type { DAWState } from '@jaswave/shared'
import type { MidiClip, MidiNote } from '@jaswave/shared'
import { extractStyleReference } from '../agent/modes'

type ProjectTrack = NonNullable<DAWState['project']>['tracks'][number]

/** GM / kits habituales */
const KICK = new Set([35, 36])
const SNARE = new Set([37, 38, 40])
const HAT_CLOSED = new Set([42, 44])
const HAT_OPEN = new Set([46])
const CRASH = new Set([49, 57])
const RIDE = new Set([51, 59])
const TOM = new Set([41, 43, 45, 47, 48, 50])

function isDrumishTrack(t: ProjectTrack): boolean {
  const n = `${t.nombre} ${(t.tags ?? []).join(' ')}`.toLowerCase()
  return /bater|drum|perc|kit|bfd|powerdrum/i.test(n)
}

function findDrumTrack(state: DAWState, hint?: string): ProjectTrack | undefined {
  const tracks = state.project?.tracks ?? []
  if (hint?.trim()) {
    const h = hint
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
    const hit = tracks.find((t) =>
      t.nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .includes(h),
    )
    if (hit) return hit
  }
  return tracks.find(isDrumishTrack) ?? tracks.find((t) => t.tipo === 'midi' || t.tipo === 'instrumento')
}

function longestMidiClip(track: ProjectTrack): MidiClip | undefined {
  const clips = (track.clips ?? []).filter((c) => (c as MidiClip).tipo === 'midi') as MidiClip[]
  if (!clips.length) return undefined
  return [...clips].sort((a, b) => Number(b.duracion ?? 0) - Number(a.duracion ?? 0))[0]
}

function classify(notes: MidiNote[]) {
  let kick = 0
  let snare = 0
  let snareGhost = 0
  let hatClosed = 0
  let hatOpen = 0
  let crash = 0
  let ride = 0
  let tom = 0
  let other = 0
  let velSum = 0
  for (const n of notes) {
    const p = Math.round(n.pitch)
    const v = n.velocidad ?? 80
    velSum += v
    if (KICK.has(p)) kick += 1
    else if (SNARE.has(p)) {
      snare += 1
      if (v < 55) snareGhost += 1
    } else if (HAT_CLOSED.has(p)) hatClosed += 1
    else if (HAT_OPEN.has(p)) hatOpen += 1
    else if (CRASH.has(p)) crash += 1
    else if (RIDE.has(p)) ride += 1
    else if (TOM.has(p)) tom += 1
    else other += 1
  }
  return {
    kick,
    snare,
    snareGhost,
    hatClosed,
    hatOpen,
    crash,
    ride,
    tom,
    other,
    total: notes.length,
    avgVel: notes.length ? velSum / notes.length : 0,
  }
}

function extractStyleRef(userText: string): string {
  return extractStyleReference(userText) ?? 'el estilo que pediste'
}

/**
 * Criterios genéricos de groove de batería (independientes del género).
 * Si hay bullets de StyleProfile (perfil elegido por el usuario) se usan esos.
 */
export function genericDrumStyleExpectations(fromProfiles?: string[]): string[] {
  if (fromProfiles?.length) return fromProfiles
  return [
    'Tempo y compás coherentes con la referencia (comprueba el BPM real de las canciones de referencia)',
    'Contraste por secciones: intro/verso más contenidos, coro o drop más abierto',
    'Fills cortos hacia el downbeat cada 4–8 compases y crash en entradas de frase',
    'Dinámica variada nota a nota (acentos vs notas suaves), no todo a la misma velocidad',
    'Densidad de hi-hat / ride acorde al feel (corcheas, semicorcheas o half-time según el estilo)',
    'Articulación de la caja: acentos claros y, si el estilo lo usa, ghost notes suaves',
  ]
}

/** @deprecated usar genericDrumStyleExpectations (ya no hay defaults de un género concreto). */
export const worshipModernDrumExpectations = genericDrumStyleExpectations

export function expectationsFromStyleProfileSummaries(summaries: string[]): string[] {
  return summaries.filter(Boolean).slice(0, 6).map((s) => `[perfil] ${s}`)
}

export type StyleGapReportOpts = {
  userText: string
  trackHint?: string
  webSummary?: string
  /** Summaries de StyleProfile (p.ej. de style.profile.search). */
  styleProfileSummaries?: string[]
}

/**
 * Informe listo para el chat, pensado para un productor de DAW (no ingeniero de software).
 */
export function buildStyleGapReport(state: DAWState, opts: StyleGapReportOpts): string {
  const bpm = state.project?.bpm?.valor ?? 120
  const styleRef = extractStyleRef(opts.userText)
  const track = findDrumTrack(state, opts.trackHint ?? 'bateria')
  const lines: string[] = []

  lines.push(`## Qué pediste`)
  lines.push(
    `Revisar la **batería** del proyecto y decirte **qué le falta** para acercarla a **${styleRef}**.`,
  )
  lines.push('')

  if (!track) {
    lines.push('No encontré una pista de batería en el proyecto. Crea o selecciona la pista de kit y vuelve a preguntar.')
    return lines.join('\n')
  }

  const clip = longestMidiClip(track)
  const notes = clip?.notas ?? []
  const bars = clip ? Math.max(1, Math.round(Number(clip.duracion ?? 0) / 4)) : 0
  const stats = classify(notes)
  const plugin = track.plugins?.[0]?.nombre

  lines.push(`## Lo que hay ahora (pista «${track.nombre}»)`)
  lines.push(
    [
      `- Tempo del proyecto: **${bpm} BPM** · 4/4`,
      plugin ? `- Instrumento: **${plugin}**` : '- Instrumento: (sin VST listado en la pista)',
      clip
        ? `- Clip principal «${clip.nombre}»: unos **${bars} compases** · **${stats.total} hits** MIDI`
        : '- No hay clip MIDI en esa pista',
    ].join('\n'),
  )
  if (stats.total) {
    lines.push('')
    lines.push('Desglose rápido del kit (conteo de notas en el clip):')
    lines.push(
      [
        `- Bombo: **${stats.kick}**`,
        `- Caja: **${stats.snare}** (de las cuales ghosts suaves ≈ **${stats.snareGhost}**)`,
        `- Hi-hat cerrado: **${stats.hatClosed}** · abierto: **${stats.hatOpen}**`,
        `- Crash: **${stats.crash}** · Ride: **${stats.ride}** · Toms: **${stats.tom}**`,
      ].join('\n'),
    )
  }
  lines.push('')

  lines.push(`## Qué suele llevar el estilo «${styleRef}»`)
  if (opts.webSummary?.trim() && !/sin resultados/i.test(opts.webSummary)) {
    lines.push('_Según la búsqueda web:_')
    lines.push(opts.webSummary.trim().slice(0, 1200))
    lines.push('')
  } else {
    lines.push(
      '_No hubo resultados útiles de internet en este turno; uso criterios generales de groove (no específicos de un género):_',
    )
  }
  for (const e of genericDrumStyleExpectations(
    opts.styleProfileSummaries?.length
      ? expectationsFromStyleProfileSummaries(opts.styleProfileSummaries)
      : undefined,
  )) {
    lines.push(`- ${e}`)
  }
  lines.push('')

  lines.push(`## Qué le falta a TU batería (priorizado)`)
  const gaps: Array<{ title: string; detail: string }> = []

  if (stats.total === 0) {
    gaps.push({
      title: 'No hay patrón MIDI',
      detail: 'La pista existe pero el clip no tiene notas. Hay que programar o generar el groove antes de comparar estilo.',
    })
  } else {
    const ghostRatio = stats.snare > 0 ? stats.snareGhost / stats.snare : 0
    if (stats.snareGhost < 8 || ghostRatio < 0.15) {
      gaps.push({
        title: 'Casi no hay ghost notes en la caja',
        detail:
          'En muchos estilos con groove la caja “habla” entre los acentos. Ahora suena más a patrón seco. Si la referencia lo usa, añade ghosts suaves (velocidad baja) en semicorcheas.',
      })
    }
    if (stats.hatClosed + stats.hatOpen < stats.kick * 1.5) {
      gaps.push({
        title: 'Poco hi-hat / ride de empuje',
        detail:
          'El groove suele apoyarse en hats o ride constantes. Sube la densidad de hi-hat (cerrado en verso, más abierto en coro) si la referencia lo pide.',
      })
    }
    if (stats.hatOpen < 4 && bars > 8) {
      gaps.push({
        title: 'Pocos hats abiertos',
        detail: 'Los coros o builds suelen abrir el hat. Marca contrastes verso/coro abriendo algunos hats.',
      })
    }
    if (stats.crash < Math.max(2, Math.floor(bars / 16))) {
      gaps.push({
        title: 'Pocos crashes en cambios de sección',
        detail:
          'Con un clip tan largo conviene marcar entradas de coro/puente con crash. Coloca crashes en los “ganchos” de frase.',
      })
    }
    if (stats.tom < 4 && bars > 16) {
      gaps.push({
        title: 'Casi no hay fills / toms',
        detail: 'Cada 4–8 compases conviene un fill corto hacia el downbeat. Evita el mismo loop plano todo el tema.',
      })
    }
    if (bars > 32) {
      gaps.push({
        title: 'Un solo clip muy largo sin contraste',
        detail: `Tienes ~${bars} compases en un bloque. En arrange, parte por secciones (verso / pre / coro) o varía el patrón por tramos para que respire como un tema live.`,
      })
    }
    if (bpm >= 110 && bpm <= 128) {
      gaps.push({
        title: `Revisa el feel a ${bpm} BPM`,
        detail:
          'A este tempo, un tramo en half-time (caja en 3) en coros o builds suele dar contraste. Compáralo con la referencia.',
      })
    }
  }

  if (!gaps.length) {
    lines.push('En números burdos el kit no está vacío; el siguiente paso es **escuchar** y contrastar a oído con una referencia del artista (dinámica y fills).')
  } else {
    gaps.forEach((g, i) => {
      lines.push(`${i + 1}. **${g.title}**`)
      lines.push(`   ${g.detail}`)
    })
  }

  lines.push('')
  lines.push('## Cómo seguir en JasWave')
  lines.push(
    [
      '1. Escucha solo la pista **Batería** (solo) contra una referencia del artista.',
      '2. Pídeme: *“aplica ese estilo al clip de batería (ghost notes, hats, fills), sin tocar el resto”*.',
      '3. Si quieres, después partimos el clip largo por secciones en el arrange.',
    ].join('\n'),
  )

  return lines.join('\n')
}

export type StyleEnhanceAction = {
  type: string
  payload: Record<string, unknown>
}

function noteNear(notes: MidiNote[], t: number, pitch: number, tol = 0.08): boolean {
  return notes.some((n) => Math.round(n.pitch) === pitch && Math.abs(n.inicio - t) < tol)
}

function mkNote(id: string, pitch: number, inicio: number, velocidad: number, duracion = 0.12): MidiNote {
  return {
    id,
    pitch,
    velocidad,
    inicio,
    duracion,
    canal: 0,
    presion: 0,
    seleccionada: false,
  }
}

/**
 * Perfil de realce de batería: qué rasgos aplicar. Lo deriva el pedido del usuario
 * (styleEnhanceProfileFromText) o un StyleProfile elegido por él — sin defaults de género.
 */
export type StyleEnhanceProfile = {
  /** Ghost notes suaves en la caja (offsets dentro de la negra). */
  ghostNotes?: boolean
  ghostOffsets?: number[]
  /** Hats abiertos ocasionales en tramos de “coro”. */
  openHats?: boolean
  /** Crash + fill corto cada `phraseBars` compases. */
  crashFills?: boolean
  phraseBars?: number
  /** Humanize leve de timing/velocidad. */
  humanize?: boolean
}

/** Rasgos neutrales cuando el usuario no especifica: fills/crash de frase + humanize. */
export const DEFAULT_STYLE_ENHANCE_PROFILE: Readonly<StyleEnhanceProfile> = Object.freeze({
  ghostNotes: false,
  openHats: false,
  crashFills: true,
  phraseBars: 8,
  humanize: true,
})

/** Deriva el perfil de realce de lo que pide el usuario (ghost, hats, fills, humaniza…). */
export function styleEnhanceProfileFromText(userText: string): StyleEnhanceProfile {
  const t = userText.toLowerCase()
  const ghost = /\bghost/.test(t)
  const hats = /\b(hats?\s+abiert|open\s*hats?|hi-?hat|hats?)\b/.test(t)
  const fills = /\b(fills?|crash|platillos?|toms?|transici)/.test(t)
  const human = /\b(humaniz|human|vivo|live|natural)/.test(t)
  if (!ghost && !hats && !fills && !human) return { ...DEFAULT_STYLE_ENHANCE_PROFILE }
  return {
    ghostNotes: ghost,
    openHats: hats,
    crashFills: fills || (!ghost && !hats),
    phraseBars: 8,
    // Humanize leve siempre ayuda al realce; explícito si el usuario lo pidió.
    humanize: human || ghost || hats || fills,
  }
}

/**
 * Acciones concretas para acercar la batería al estilo pedido (ghosts, hats, fills, humanize),
 * según el perfil. Usado cuando el usuario pide APLICAR el estilo (no solo analizar).
 */
export function buildStyleEnhanceActions(
  state: DAWState,
  profile: StyleEnhanceProfile = DEFAULT_STYLE_ENHANCE_PROFILE,
): StyleEnhanceAction[] {
  const track = findDrumTrack(state, 'bateria')
  if (!track) return []
  const clip = longestMidiClip(track)
  if (!clip) return []
  const existing = [...(clip.notas ?? [])]
  const dur = Math.max(0, Number(clip.duracion ?? 0))
  if (dur < 4) return []
  const bars = Math.max(1, Math.floor(dur / 4))
  const SNARE = 38
  const CRASH = 49
  const TOM_MID = 47
  const TOM_LOW = 45
  const HAT_OPEN = 46

  const additions: MidiNote[] = []
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${clip.id.slice(-6)}-${seq++}`

  const phrase = Math.max(2, Math.floor(profile.phraseBars ?? 8))
  const ghostOffsets = profile.ghostNotes ? (profile.ghostOffsets ?? [0.25, 1.25, 2.25, 3.25]) : []

  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 4
    // Ghosts suaves en la caja (solo si el perfil los pide)
    for (const off of ghostOffsets) {
      const t = base + off
      if (t >= dur) continue
      if (!noteNear(existing, t, SNARE) && !noteNear(additions, t, SNARE)) {
        additions.push(mkNote(nextId('gh'), SNARE, t, 36 + (bar % 3) * 4, 0.08))
      }
    }
    // Hats abiertos ocasionales en off-beats de “coros” (cada 8–16)
    if (profile.openHats && bar % phrase >= phrase / 2) {
      const t = base + 1.5
      if (t < dur && !noteNear(existing, t, HAT_OPEN) && !noteNear(additions, t, HAT_OPEN)) {
        additions.push(mkNote(nextId('ho'), HAT_OPEN, t, 78, 0.2))
      }
    }
    // Crash + fill corto cada `phrase` compases (transición)
    if (profile.crashFills && bar > 0 && bar % phrase === 0) {
      if (!noteNear(existing, base, CRASH) && !noteNear(additions, base, CRASH)) {
        additions.push(mkNote(nextId('cr'), CRASH, base, 105, 0.8))
      }
      const fillBase = base - 1
      for (let i = 0; i < 4; i++) {
        const t = fillBase + i * 0.25
        if (t < 0 || t >= dur) continue
        const pitch = i < 2 ? TOM_MID : i < 3 ? TOM_LOW : SNARE
        additions.push(mkNote(nextId('fl'), pitch, t, 82 + i * 6, 0.18))
      }
    }
  }

  if (additions.length === 0) return []

  const notas = [...existing, ...additions].sort(
    (a, b) => a.inicio - b.inicio || a.pitch - b.pitch,
  )

  const out: StyleEnhanceAction[] = [
    {
      type: 'midi.notes.set',
      payload: { pistaId: track.id, clipId: clip.id, notas },
    },
  ]
  if (profile.humanize === false) return out
  return [
    ...out,
    {
      type: 'midi.humanize',
      payload: {
        pistaId: track.id,
        clipId: clip.id,
        seed: 42,
        timingAmount: 0.012,
        velocityAmount: 6,
      },
    },
  ]
}

/**
 * @deprecated usar buildStyleEnhanceActions(state, profile). Alias con el realce completo
 * (ghosts + hats + fills + humanize); ya no lo usa ningún flujo por defecto.
 */
export function buildWorshipDrumEnhanceActions(state: DAWState): StyleEnhanceAction[] {
  return buildStyleEnhanceActions(state, {
    ghostNotes: true,
    openHats: true,
    crashFills: true,
    phraseBars: 8,
    humanize: true,
  })
}
