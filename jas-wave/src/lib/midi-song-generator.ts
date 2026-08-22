/**
 * Generador MIDI creativo para el agente JasWave.
 * Cada petición produce una pieza distinta (seed + mood + estilo).
 */

export type MidiSongSection = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' | 'breakdown' | 'build'

export type MusicMood =
  | 'sad'
  | 'happy'
  | 'epic'
  | 'ambient'
  | 'dark'
  | 'romantic'
  | 'energetic'
  | 'neutral'

export type MusicStyle = 'ballad' | 'arp' | 'sparse' | 'pulse' | 'waltz' | 'cinematic'

export type GenerateMidiSongOptions = {
  keyRoot?: number
  scale?: 'major' | 'minor'
  bpm?: number
  minutes?: number
  velocitySoft?: number
  sections?: MidiSongSection[]
  /** Semilla: mismo texto → misma pieza; distinto texto → distinta. */
  seed?: number | string
  mood?: MusicMood
  style?: MusicStyle
  nombre?: string
}

export type GeneratedNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

/** PRNG determinista (mulberry32). */
function createRng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!
}

function degreeToPitch(root: number, degree: number, scale: 'major' | 'minor', octaveOffset = 0): number {
  const intervals = scale === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS
  const oct = Math.floor(degree / 7) + octaveOffset
  const d = ((degree % 7) + 7) % 7
  return Math.max(21, Math.min(108, root + intervals[d]! + oct * 12))
}

/** Progresiones alternativas por mood (grados diatónicos). */
const PROGRESSION_BANK: Record<MusicMood, number[][][]> = {
  sad: [
    [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]],
    [[0, 2, 4], [3, 5, 0], [5, 0, 2], [4, 6, 1]],
    [[5, 0, 2], [3, 5, 0], [0, 2, 4], [4, 0, 2]],
  ],
  happy: [
    [[0, 2, 4], [4, 6, 1], [5, 0, 2], [3, 5, 0]],
    [[0, 2, 4], [3, 5, 0], [4, 6, 1], [0, 2, 4]],
  ],
  epic: [
    [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]],
    [[0, 4, 6], [5, 0, 2], [3, 5, 0], [4, 0, 2]],
  ],
  ambient: [
    [[0, 2, 4], [0, 2, 4], [5, 0, 2], [5, 0, 2]],
    [[0, 4], [3, 5], [0, 4], [5, 0]],
  ],
  dark: [
    [[0, 2, 4], [1, 3, 5], [5, 0, 2], [4, 6, 1]],
    [[0, 3, 5], [5, 0, 2], [3, 5, 0], [4, 0, 2]],
  ],
  romantic: [
    [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]],
    [[0, 2, 4], [3, 5, 0], [1, 3, 5], [4, 6, 1]],
  ],
  energetic: [
    [[0, 2, 4], [4, 6, 1], [5, 0, 2], [0, 2, 4]],
    [[0, 4], [5, 0], [3, 5], [4, 6]],
  ],
  neutral: [
    [[0, 2, 4], [3, 5, 0], [0, 2, 4], [4, 6, 1]],
    [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]],
  ],
}

const STRUCTURE_BANK: MidiSongSection[][] = [
  ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro'],
  ['intro', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
  ['verse', 'chorus', 'verse', 'chorus', 'outro'],
  ['intro', 'verse', 'bridge', 'chorus', 'outro'],
  ['intro', 'verse', 'chorus', 'breakdown', 'chorus', 'outro'],
  ['intro', 'build', 'chorus', 'verse', 'chorus', 'outro'],
  ['intro', 'verse', 'chorus', 'verse', 'bridge', 'build', 'chorus', 'outro'],
  ['verse', 'bridge', 'verse', 'outro'],
  ['intro', 'verse', 'outro'],
]

function moodFromText(text: string): MusicMood {
  const t = text.toLowerCase()
  if (/triste|sad|melanc|llor|dolor|nostalg|oscuro\s+triste/.test(t)) return 'sad'
  if (/alegre|happy|feliz|joy|solar|bright|upbeat/.test(t)) return 'happy'
  if (/[eé]pico|epic|heroic|cinem[aá]tic|trailer|grand/.test(t)) return 'epic'
  if (/ambient|espacial|space|pad|atmosf|chill|lounge/.test(t)) return 'ambient'
  if (/oscuro|dark|g[oó]tico|mister|terror|horror/.test(t)) return 'dark'
  if (/rom[aá]ntic|amor|love|ballad|suave\s+amor/.test(t)) return 'romantic'
  if (/energ|rapido|r[aá]pido|dance|groove|funk|beat/.test(t)) return 'energetic'
  return 'neutral'
}

function styleFromMood(mood: MusicMood, rng: () => number): MusicStyle {
  const map: Record<MusicMood, MusicStyle[]> = {
    sad: ['ballad', 'sparse', 'arp'],
    happy: ['pulse', 'arp', 'ballad'],
    epic: ['cinematic', 'pulse', 'arp'],
    ambient: ['sparse', 'ballad', 'arp'],
    dark: ['sparse', 'cinematic', 'arp'],
    romantic: ['ballad', 'waltz', 'arp'],
    energetic: ['pulse', 'arp', 'waltz'],
    neutral: ['ballad', 'arp', 'pulse', 'sparse'],
  }
  return pick(rng, map[mood])
}

function sectionBars(section: MidiSongSection, rng: () => number): number {
  const base: Record<MidiSongSection, number[]> = {
    intro: [4, 8],
    verse: [8, 12, 16],
    chorus: [8, 16],
    bridge: [4, 8],
    outro: [4, 8],
    breakdown: [4, 8],
    build: [4, 8],
  }
  return pick(rng, base[section] ?? [8])
}

export function inferMoodFromText(text: string): MusicMood {
  return moodFromText(text)
}

/**
 * Genera una pieza distinta según seed/mood/estilo.
 */
export function generateSoftPianoSong(opts: GenerateMidiSongOptions = {}): {
  notes: GeneratedNote[]
  durationBeats: number
  structureLabel: string
  mood: MusicMood
  style: MusicStyle
  seed: number
} {
  const seedNum =
    typeof opts.seed === 'number'
      ? opts.seed
      : hashSeed(
          String(opts.seed ?? '') +
            '|' +
            (opts.nombre ?? '') +
            '|' +
            (opts.keyRoot ?? '') +
            '|' +
            (opts.scale ?? '') +
            '|' +
            (opts.minutes ?? '') +
            '|' +
            (opts.mood ?? '') +
            '|' +
            Date.now().toString(36).slice(-4),
        )

  const rng = createRng(seedNum)
  const root = opts.keyRoot ?? 48
  const scale = opts.scale ?? 'minor'
  const mood = opts.mood ?? 'neutral'
  const style = opts.style ?? styleFromMood(mood, rng)

  // BPM sugerido por mood si no viene fijado
  let bpm = opts.bpm ?? 120
  if (opts.bpm == null) {
    if (mood === 'sad' || mood === 'romantic' || mood === 'ambient') bpm = 72 + Math.floor(rng() * 28)
    else if (mood === 'energetic') bpm = 118 + Math.floor(rng() * 30)
    else if (mood === 'epic') bpm = 96 + Math.floor(rng() * 28)
    else if (mood === 'dark') bpm = 80 + Math.floor(rng() * 25)
    else bpm = 100 + Math.floor(rng() * 30)
  }

  const minutes = Math.max(1.2, opts.minutes ?? 3)
  const softBase =
    opts.velocitySoft ??
    (mood === 'sad' || mood === 'ambient' ? 52 : mood === 'energetic' ? 78 : 64)

  const sections =
    opts.sections ??
    (() => {
      let s = [...pick(rng, STRUCTURE_BANK)]
      if (mood === 'ambient') s = ['intro', 'verse', 'bridge', 'verse', 'outro']
      if (mood === 'sad' && rng() > 0.5) s = ['intro', 'verse', 'chorus', 'bridge', 'verse', 'outro']
      if (mood === 'energetic') s = ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro']
      return s
    })()

  const progressions = PROGRESSION_BANK[mood]
  const progression = pick(rng, progressions)
  const targetBeats = minutes * bpm
  const notes: GeneratedNote[] = []
  let beat = 0
  const labels: string[] = []

  const densify = style === 'pulse' || style === 'arp'
  const sparse = style === 'sparse' || mood === 'ambient'

  const emitBar = (section: MidiSongSection, chordDegs: number[], barStart: number) => {
    const bassOct = mood === 'epic' || mood === 'dark' ? -1 : 0
    const chordOct = 1
    const melOct = style === 'arp' ? 2 : mood === 'sad' ? 1 : 2

    // Bajo
    const bassDur = style === 'waltz' ? 2.8 : sparse ? 3.8 : densify ? 1.9 : 3.4
    notes.push({
      pitch: degreeToPitch(root, chordDegs[0]!, scale, bassOct),
      inicio: barStart,
      duracion: bassDur,
      velocidad: Math.max(36, softBase - 14),
    })
    if (style === 'pulse' || mood === 'energetic') {
      notes.push({
        pitch: degreeToPitch(root, chordDegs[0]!, scale, bassOct),
        inicio: barStart + 2,
        duracion: 1.7,
        velocidad: Math.max(32, softBase - 18),
      })
    }

    // Acorde
    const chordSpread = style === 'cinematic' ? 0.08 : 0.04
    for (let i = 0; i < chordDegs.length; i++) {
      notes.push({
        pitch: degreeToPitch(root, chordDegs[i]!, scale, chordOct),
        inicio: barStart + chordSpread * i,
        duracion: sparse ? 3.9 : style === 'waltz' ? 2.6 : 3.5,
        velocidad: Math.max(30, softBase - 4 - i * 4),
      })
    }

    // Melodía / arpegio — patrones distintos
    if (section === 'intro' && sparse) return
    if (section === 'outro' && rng() > 0.4) return

    if (style === 'waltz') {
      const waltzPattern = [0, 1, 2, 1, 0, 2]
      for (let s = 0; s < 6; s++) {
        const deg = chordDegs[waltzPattern[s]! % chordDegs.length]!
        notes.push({
          pitch: degreeToPitch(root, deg, scale, melOct),
          inicio: barStart + s * (2 / 3),
          duracion: 0.55,
          velocidad: Math.max(26, softBase - 16 + Math.floor(rng() * 8)),
        })
      }
    } else if (style === 'arp' || (densify && section !== 'breakdown')) {
      const patterns = [
        [0, 1, 2, 1, 0, 2, 1, 0],
        [0, 2, 1, 2, 0, 1, 2, 1],
        [2, 1, 0, 1, 2, 0, 1, 2],
        [0, 1, 0, 2, 1, 0, 1, 2],
      ]
      const arp = pick(rng, patterns)
      for (let s = 0; s < 8; s++) {
        if (sparse && s % 2 === 1) continue
        const deg = chordDegs[arp[s % arp.length]! % chordDegs.length]!
        notes.push({
          pitch: degreeToPitch(root, deg, scale, melOct),
          inicio: barStart + s * 0.5,
          duracion: 0.42,
          velocidad: Math.max(26, softBase - 16 + Math.floor(rng() * 8)),
        })
      }
    } else if (style === 'ballad' || style === 'cinematic') {
      // Motivo melódico 2–4 notas por compás
      const motifLen = 2 + Math.floor(rng() * 3)
      for (let m = 0; m < motifLen; m++) {
        const deg = chordDegs[Math.floor(rng() * chordDegs.length)]! + (rng() > 0.7 ? 2 : 0)
        notes.push({
          pitch: degreeToPitch(root, deg, scale, melOct),
          inicio: barStart + m * (4 / motifLen) + rng() * 0.08,
          duracion: 0.7 + rng() * 1.2,
          velocidad: Math.max(28, softBase - 10 + Math.floor(rng() * 12)),
        })
      }
    } else if (style === 'sparse') {
      if (rng() > 0.45) {
        notes.push({
          pitch: degreeToPitch(root, chordDegs[2] ?? chordDegs[0]!, scale, melOct),
          inicio: barStart + 1 + rng(),
          duracion: 2 + rng() * 1.5,
          velocidad: Math.max(24, softBase - 20),
        })
      }
    } else {
      // pulse default
      for (let s = 0; s < 4; s++) {
        notes.push({
          pitch: degreeToPitch(root, chordDegs[s % chordDegs.length]!, scale, melOct),
          inicio: barStart + s,
          duracion: 0.85,
          velocidad: Math.max(30, softBase - 12),
        })
      }
    }
  }

  const emitSection = (section: MidiSongSection) => {
    const bars = sectionBars(section, rng)
    labels.push(`${section}(${bars}c)`)
    for (let bar = 0; bar < bars; bar++) {
      const chordDegs = progression[bar % progression.length]!
      emitBar(section, chordDegs, beat)
      beat += style === 'waltz' ? 3 : 4
    }
  }

  let guard = 0
  while (beat < targetBeats && guard < 48) {
    for (const section of sections) {
      emitSection(section)
      if (beat >= targetBeats) break
    }
    guard++
  }

  // Cadencia final (varía)
  const finalSpread = rng() > 0.5
  notes.push({
    pitch: degreeToPitch(root, 0, scale, 0),
    inicio: beat,
    duracion: finalSpread ? 5 : 3.5,
    velocidad: softBase - 6,
  })
  notes.push({
    pitch: degreeToPitch(root, pick(rng, [2, 4]), scale, 1),
    inicio: beat + (finalSpread ? 0.1 : 0),
    duracion: 4,
    velocidad: softBase - 10,
  })
  if (rng() > 0.4) {
    notes.push({
      pitch: degreeToPitch(root, 4, scale, 1),
      inicio: beat + 0.15,
      duracion: 3.8,
      velocidad: softBase - 14,
    })
  }
  beat += 4

  return {
    notes,
    durationBeats: beat,
    structureLabel: `${mood}/${style} · ${labels.join(' → ')}`,
    mood,
    style,
    seed: seedNum,
  }
}

export function inferKeyFromText(text: string): { root: number; scale: 'major' | 'minor'; label: string } {
  const lower = text.toLowerCase()
  const map: Array<{ re: RegExp; root: number; scale: 'major' | 'minor'; label: string }> = [
    { re: /\bc\s*menor|c\s*minor|do\s*menor\b/, root: 48, scale: 'minor', label: 'C menor' },
    { re: /\bc\s*mayor|c\s*major|do\s*mayor\b/, root: 48, scale: 'major', label: 'C mayor' },
    { re: /\ba\s*menor|a\s*minor|la\s*menor\b/, root: 45, scale: 'minor', label: 'A menor' },
    { re: /\bg\s*mayor|sol\s*mayor\b/, root: 43, scale: 'major', label: 'G mayor' },
    { re: /\bf\s*mayor|fa\s*mayor\b/, root: 41, scale: 'major', label: 'F mayor' },
    { re: /\bd\s*menor|d\s*minor|re\s*menor|en\s+d\s+menor\b/, root: 50, scale: 'minor', label: 'D menor' },
    { re: /\bd\s*mayor|re\s*mayor\b/, root: 50, scale: 'major', label: 'D mayor' },
    { re: /\be\s*menor|mi\s*menor\b/, root: 52, scale: 'minor', label: 'E menor' },
    { re: /\bb\s*menor|si\s*menor\b/, root: 47, scale: 'minor', label: 'B menor' },
    { re: /\bf#\s*menor|fa\s*#\s*menor\b/, root: 42, scale: 'minor', label: 'F# menor' },
  ]
  for (const m of map) {
    if (m.re.test(lower)) return { root: m.root, scale: m.scale, label: m.label }
  }
  // Mood implica modo si no hay tonalidad explícita
  const mood = moodFromText(lower)
  if (mood === 'sad' || mood === 'dark' || mood === 'romantic') {
    return pick(createRng(hashSeed(lower)), [
      { root: 50, scale: 'minor' as const, label: 'D menor' },
      { root: 45, scale: 'minor' as const, label: 'A menor' },
      { root: 48, scale: 'minor' as const, label: 'C menor' },
      { root: 52, scale: 'minor' as const, label: 'E menor' },
    ])
  }
  if (mood === 'happy' || mood === 'energetic') {
    return pick(createRng(hashSeed(lower)), [
      { root: 48, scale: 'major' as const, label: 'C mayor' },
      { root: 43, scale: 'major' as const, label: 'G mayor' },
      { root: 41, scale: 'major' as const, label: 'F mayor' },
    ])
  }
  return { root: 48, scale: 'minor', label: 'C menor' }
}

export function inferMinutesFromText(text: string, fallback = 3): number {
  const m =
    text.match(/(\d+(?:[.,]\d+)?)\s*min/) ||
    text.match(/dure\s+(\d+(?:[.,]\d+)?)/i) ||
    text.match(/duraci[oó]n\s+(?:de\s+)?(\d+(?:[.,]\d+)?)/i)
  if (m) return Math.max(1, parseFloat(m[1]!.replace(',', '.')))
  if (/al\s+menos\s+3|3\s*minutos|tres\s+minutos/i.test(text)) return 3
  if (/4\s*minutos|cuatro\s+minutos/i.test(text)) return 4
  return fallback
}

export function wantsDawCreation(text: string): boolean {
  return /genera|crea|haz(lo|me)?|arm[aá]|escribe|pon(me)?|midi|piano|pista|song|canci[oó]n|estrofa|coro|puente|melod/i.test(
    text,
  )
}

/** Nombre de clip a partir del pedido del usuario. */
export function inferClipNameFromText(text: string, keyLabel: string): string {
  const t = text.trim()
  const quoted = t.match(/[«"']([^«"']{2,40})[»"']/)
  if (quoted) return quoted[1]!.trim()
  if (/triste/i.test(t)) return `Melodía triste · ${keyLabel}`
  if (/alegre|feliz/i.test(t)) return `Melodía alegre · ${keyLabel}`
  if (/[eé]pic/i.test(t)) return `Tema épico · ${keyLabel}`
  if (/ambient/i.test(t)) return `Ambient · ${keyLabel}`
  if (/piano/i.test(t)) return `Piano · ${keyLabel}`
  if (/melod/i.test(t)) return `Melodía · ${keyLabel}`
  return `MIDI · ${keyLabel}`
}
