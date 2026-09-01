/**
 * Acciones MIDI concretas (notes.set / patch / humanize) cuando el modelo
 * solo emite project.setBpm ante pedidos de suavizar / intro / groove / pads.
 */

import type { DAWState } from '@jaswave/shared'
import type { MidiClip, MidiNote } from '@jaswave/shared'

type ProjectTrack = NonNullable<DAWState['project']>['tracks'][number]

export type MidiEditAction = {
  type: string
  payload: Record<string, unknown>
}

const SNARE = 38
const TOM_LOW = 45
const TOM_MID = 47
const TOM_HIGH = 48
const HAT_OPEN = 46
const RIDE = 51
const CRASH = 49
const KICK = 36

function isDrumish(t: ProjectTrack): boolean {
  return /bater|drum|perc|kit|bfd|powerdrum/i.test(`${t.nombre} ${(t.tags ?? []).join(' ')}`)
}

function isPadish(t: ProjectTrack): boolean {
  return /pad|ambiente|atmos|strings?|cuerda|synth.?pad/i.test(
    `${t.nombre} ${(t.tags ?? []).join(' ')}`,
  )
}

function longestMidi(track: ProjectTrack): MidiClip | undefined {
  const clips = (track.clips ?? []).filter((c) => (c as MidiClip).tipo === 'midi') as MidiClip[]
  if (!clips.length) return undefined
  return [...clips].sort((a, b) => Number(b.duracion ?? 0) - Number(a.duracion ?? 0))[0]
}

function findTrack(
  state: DAWState,
  pred: (t: ProjectTrack) => boolean,
  hint?: string,
): ProjectTrack | undefined {
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
  return tracks.find(pred)
}

function mkNote(
  id: string,
  pitch: number,
  inicio: number,
  velocidad: number,
  duracion: number,
): MidiNote {
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

function inferIntroEndBeats(text: string, clipDur: number): number {
  const bars =
    text.match(/\b(\d{1,2})\s*compas/i) ||
    text.match(/\bcompas(?:es)?\s*(\d{1,2})\b/i) ||
    text.match(/\b(\d{1,2})\s*bars?\b/i)
  if (bars) {
    const n = Number(bars[1])
    if (n >= 2 && n <= 32) return Math.min(clipDur, n * 4)
  }
  // Default worship: intro 8 compases
  return Math.min(clipDur, 32)
}

/** Intro suave: toms + platillos con build → redoblante al final del rango. */
function buildSoftIntroDrumNotes(rangeEnd: number, idPrefix: string): MidiNote[] {
  const notes: MidiNote[] = []
  let seq = 0
  const id = (p: string) => `${p}-${idPrefix}-${seq++}`
  const bars = Math.max(1, Math.floor(rangeEnd / 4))

  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 4
    const intensity = 0.35 + (bar / Math.max(1, bars - 1)) * 0.55
    // Kick suave cada dos compases al principio, luego más presente
    if (bar % 2 === 0 || bar >= bars - 2) {
      notes.push(mkNote(id('k'), KICK, base, Math.round(55 + intensity * 35), 0.4))
    }
    // Toms en semicorcheas suaves (juego)
    const tomPattern = [0.5, 1.0, 1.5, 2.5, 3.0, 3.5]
    for (let i = 0; i < tomPattern.length; i++) {
      if (bar < 2 && i > 2) continue // muy escaso al inicio
      const t = base + tomPattern[i]!
      if (t >= rangeEnd) continue
      const pitch = i % 3 === 0 ? TOM_HIGH : i % 3 === 1 ? TOM_MID : TOM_LOW
      notes.push(
        mkNote(id('tm'), pitch, t, Math.round(40 + intensity * 45 + (i % 2) * 5), 0.15),
      )
    }
    // Ride / hat abierto en offbeats
    notes.push(mkNote(id('rd'), RIDE, base + 0.0, Math.round(45 + intensity * 25), 0.5))
    if (bar >= 2) {
      notes.push(mkNote(id('ho'), HAT_OPEN, base + 1.5, Math.round(50 + intensity * 20), 0.25))
    }
    if (bar >= bars - 3) {
      notes.push(mkNote(id('cr'), CRASH, base, Math.round(70 + intensity * 30), 0.8))
    }
  }

  // Redoblante (caja en semicorcheas) en el último compás
  const rollStart = Math.max(0, rangeEnd - 4)
  for (let i = 0; i < 16; i++) {
    const t = rollStart + i * 0.25
    if (t >= rangeEnd) break
    const vel = Math.round(45 + (i / 15) * 55)
    notes.push(mkNote(id('sn'), SNARE, t, vel, 0.12))
  }
  // Crash al final del build
  notes.push(mkNote(id('cr'), CRASH, rangeEnd - 0.01, 110, 1.0))

  return notes
}

function softenVelocities(notes: MidiNote[], factor: number): MidiNote[] {
  return notes.map((n) => ({
    ...n,
    velocidad: Math.max(18, Math.min(127, Math.round(n.velocidad * factor))),
  }))
}

function buildAmbientPadNotes(
  rangeStart: number,
  rangeEnd: number,
  idPrefix: string,
): MidiNote[] {
  // C major-ish ambient stack (C3 E3 G3 B3 / C4)
  const pitches = [48, 52, 55, 59, 60, 64]
  const notes: MidiNote[] = []
  let seq = 0
  const span = Math.max(4, rangeEnd - rangeStart)
  for (let i = 0; i < pitches.length; i++) {
    const stagger = (i % 3) * 0.5
    notes.push(
      mkNote(
        `pad-${idPrefix}-${seq++}`,
        pitches[i]!,
        rangeStart + stagger,
        38 + i * 4,
        span - stagger,
      ),
    )
  }
  // Segunda capa más aguda a mitad de intro
  const mid = rangeStart + span * 0.45
  for (const p of [67, 71, 72]) {
    notes.push(mkNote(`pad2-${idPrefix}-${seq++}`, p, mid, 32, rangeEnd - mid))
  }
  return notes
}

/**
 * Genera ACTIONS de edición MIDI reales según el pedido del usuario.
 * Nunca incluye solo setBpm: siempre toca notas.
 */
export function buildMidiClipEditActions(
  state: DAWState,
  userText: string,
): MidiEditAction[] {
  const actions: MidiEditAction[] = []
  const lower = userText.toLowerCase()
  const drum = findTrack(state, isDrumish, 'bateria')
  const pad = findTrack(state, isPadish, 'pad')
  const drumClip = drum ? longestMidi(drum) : undefined
  const padClip = pad ? longestMidi(pad) : undefined

  const wantsSoft =
    /\b(suav|soft|menos\s+explos|menos\s+agres|m[aá]s\s+ambiental|dinam|baj(a|ar)\s+la\s+(intens|veloc)|floja)\b/i.test(
      lower,
    )
  const wantsIntro =
    /\bintro\b/i.test(lower) ||
    /\b(toms?|platillos?|redoblant|build|grove|groove)\b/i.test(lower)
  const wantsPads =
    /\b(pads?|agrega(r)?\s+.*pad|a[nñ]ade(r)?\s+.*pad|otros\s+pads?|m[aá]s\s+pads?|capas?\s+ambient)\b/i.test(
      lower,
    )
  const wantsWorshipFeel =
    /\b(worship|aver+y|averill|morillo|ghost|estilo)\b/i.test(lower)

  if (drum && drumClip) {
    const dur = Math.max(0, Number(drumClip.duracion ?? 0))
    const existing = [...(drumClip.notas ?? [])]
    const introEnd = inferIntroEndBeats(userText, dur)
    const longClip = dur >= 64

    if (wantsIntro) {
      const introNotes = buildSoftIntroDrumNotes(introEnd, drumClip.id.slice(-5))
      // Clip largo → partir en secciones; la primera pieza conserva el clipId
      if (longClip) {
        const cuts: number[] = [introEnd]
        for (let b = introEnd + 32; b < dur - 16; b += 32) cuts.push(b)
        const names = ['Intro', 'Verso', 'Coro', 'Verso 2', 'Coro 2', 'Puente', 'Outro']
        actions.push({
          type: 'midi.clip.splitIntoSections',
          payload: {
            pistaId: drum.id,
            clipId: drumClip.id,
            cuts,
            names: names.slice(0, cuts.length + 1),
          },
        })
        actions.push({
          type: 'midi.notes.set',
          payload: { pistaId: drum.id, clipId: drumClip.id, notas: introNotes },
        })
      } else {
        actions.push({
          type: 'midi.notes.patch',
          payload: {
            pistaId: drum.id,
            clipId: drumClip.id,
            rangeStart: 0,
            rangeEnd: introEnd,
            notas: introNotes,
          },
        })
        if (wantsSoft && existing.length) {
          const rest = softenVelocities(
            existing.filter((n) => n.inicio >= introEnd),
            0.78,
          )
          const merged = [
            ...introNotes,
            ...rest.map((n, i) => ({ ...n, id: n.id || `keep-${i}` })),
          ].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
          actions.pop()
          actions.push({
            type: 'midi.notes.set',
            payload: { pistaId: drum.id, clipId: drumClip.id, notas: merged },
          })
        }
      }
    } else if (wantsSoft || wantsWorshipFeel) {
      const softened = softenVelocities(existing, wantsSoft ? 0.7 : 0.85)
      // Reducir densificación leve: quitar algunos hats cerrados en offbeats si hay demasiados
      const thinned =
        softened.length > 400
          ? softened.filter((n, i) => {
              const p = Math.round(n.pitch)
              if (p === 42 || p === 44) return i % 2 === 0 || (n.velocidad ?? 0) > 70
              return true
            })
          : softened
      actions.push({
        type: 'midi.notes.set',
        payload: { pistaId: drum.id, clipId: drumClip.id, notas: thinned },
      })
    }

    if (actions.some((a) => a.type.startsWith('midi.notes.'))) {
      actions.push({
        type: 'midi.humanize',
        payload: {
          pistaId: drum.id,
          clipId: drumClip.id,
          seed: 77,
          timingAmount: 0.014,
          velocityAmount: wantsSoft ? 10 : 7,
        },
      })
    }
  }

  if (wantsPads && pad && padClip) {
    const dur = Math.max(0, Number(padClip.duracion ?? 0))
    const introEnd = inferIntroEndBeats(userText, dur)
    const existing = [...(padClip.notas ?? [])]
    const ambient = buildAmbientPadNotes(0, introEnd, padClip.id.slice(-5))
    // Preferir clip corto de intro en la misma pista (pedazo), sin pisar el resto
    if (dur >= 64 && wantsIntro) {
      actions.push({
        type: 'midi.clip.create',
        payload: {
          pistaId: pad.id,
          nombre: `${pad.nombre} · Intro ambient`,
          inicio: Number(padClip.inicio ?? 0),
          duracion: introEnd,
          notas: ambient.map((n) => ({
            pitch: n.pitch,
            inicio: n.inicio,
            duracion: n.duracion,
            velocidad: n.velocidad,
          })),
        },
      })
      // Vaciar el rango intro del clip largo para no solapar
      const rest = existing.filter((n) => n.inicio >= introEnd)
      actions.push({
        type: 'midi.notes.set',
        payload: {
          pistaId: pad.id,
          clipId: padClip.id,
          notas: rest,
        },
      })
    } else {
      const softenedRest = wantsSoft
        ? softenVelocities(
            existing.filter((n) => n.inicio >= introEnd),
            0.85,
          )
        : existing.filter((n) => n.inicio >= introEnd)
      actions.push({
        type: 'midi.notes.set',
        payload: {
          pistaId: pad.id,
          clipId: padClip.id,
          notas: [...ambient, ...softenedRest].sort(
            (a, b) => a.inicio - b.inicio || a.pitch - b.pitch,
          ),
        },
      })
    }
  } else if (wantsPads && !pad) {
    // Crear pista pad + clip corto ambiental vía musicBuild es demasiado agresivo;
    // dejamos que el modelo lo haga; aquí no inventamos pista.
  }

  return actions
}

/**
 * Parte mega-clips MIDI (> N beats) en secciones de `barsPerSection` compases.
 * Útil cuando el usuario pide “por secciones” / “pedazos” / “intro aparte”.
 */
export function buildSplitLongClipsActions(
  state: DAWState,
  opts?: { barsPerSection?: number; minBeats?: number },
): MidiEditAction[] {
  const bars = Math.max(4, opts?.barsPerSection ?? 8)
  const minBeats = opts?.minBeats ?? 64
  const step = bars * 4
  const actions: MidiEditAction[] = []
  for (const track of state.project?.tracks ?? []) {
    for (const raw of track.clips ?? []) {
      const clip = raw as MidiClip
      if (clip.tipo !== 'midi') continue
      const dur = Number(clip.duracion ?? 0)
      if (dur < minBeats) continue
      const cuts: number[] = []
      for (let t = step; t < dur - step / 2; t += step) cuts.push(t)
      if (!cuts.length) continue
      const names = cuts.map((_, i) => {
        if (i === 0) return 'Intro'
        if (i === 1) return 'Verso'
        if (i === 2) return 'Coro'
        return `Sección ${i + 1}`
      })
      names.push('Outro')
      actions.push({
        type: 'midi.clip.splitIntoSections',
        payload: {
          pistaId: track.id,
          clipId: clip.id,
          cuts,
          names: names.slice(0, cuts.length + 1),
        },
      })
    }
  }
  return actions
}

/** True si las actions solo tocan tempo/UI y no MIDI de verdad. */
export function actionsLackMidiNoteEdits(actions: Array<{ type: string }>): boolean {
  return !actions.some((a) =>
    /^(midi\.notes\.(set|patch)|midi\.humanize|midi\.clip\.md\.apply|midi\.applyGroove)$/i.test(
      a.type,
    ),
  )
}
