/**
 * Generador de canciones MIDI (piano suave) para el agente JasWave.
 * Crea notas deterministas a partir de estructura / tonalidad / duración.
 */

export type MidiSongSection = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro'

export type GenerateMidiSongOptions = {
  keyRoot?: number // MIDI pitch of tonic, default 48 (C3) for deep piano
  scale?: 'major' | 'minor'
  bpm?: number
  minutes?: number
  velocitySoft?: number
  sections?: MidiSongSection[]
}

export type GeneratedNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

/** Progresiones por sección (grados 0-based en la escala). */
const PROGRESSIONS: Record<MidiSongSection, number[][]> = {
  intro: [[0, 2, 4], [0, 2, 4]],
  verse: [
    [0, 2, 4],
    [5, 0, 2],
    [3, 5, 0],
    [4, 6, 1],
  ],
  chorus: [
    [0, 2, 4],
    [3, 5, 0],
    [0, 2, 4],
    [4, 6, 1],
  ],
  bridge: [
    [5, 0, 2],
    [3, 5, 0],
    [1, 3, 5],
    [4, 6, 1],
  ],
  outro: [[0, 2, 4], [0, 2, 4], [0, 2, 4]],
}

const SECTION_BARS: Record<MidiSongSection, number> = {
  intro: 8,
  verse: 16,
  chorus: 16,
  bridge: 8,
  outro: 8,
}

function degreeToPitch(root: number, degree: number, scale: 'major' | 'minor', octaveOffset = 0): number {
  const intervals = scale === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS
  const oct = Math.floor(degree / 7) + octaveOffset
  const d = ((degree % 7) + 7) % 7
  return root + intervals[d] + oct * 12
}

/**
 * Genera una pieza de piano suave (>= minutes) con intro/estrofa/coro/puente.
 * Tiempos en beats (negra = 1).
 */
export function generateSoftPianoSong(opts: GenerateMidiSongOptions = {}): {
  notes: GeneratedNote[]
  durationBeats: number
  structureLabel: string
} {
  const root = opts.keyRoot ?? 48 // C3 — profundo
  const scale = opts.scale ?? 'major'
  const bpm = opts.bpm ?? 120
  const minutes = Math.max(1.5, opts.minutes ?? 3)
  const soft = opts.velocitySoft ?? 62
  const sections =
    opts.sections ??
    (['intro', 'verse', 'chorus', 'verse', 'bridge', 'chorus', 'outro'] as MidiSongSection[])

  const targetBeats = minutes * bpm
  const notes: GeneratedNote[] = []
  let beat = 0
  const labels: string[] = []

  const emitSection = (section: MidiSongSection) => {
    const bars = SECTION_BARS[section]
    const progression = PROGRESSIONS[section]
    labels.push(`${section}(${bars}c)`)
    for (let bar = 0; bar < bars; bar++) {
      const chordDegs = progression[bar % progression.length]
      const barStart = beat

      // Bajo suave (negra)
      notes.push({
        pitch: degreeToPitch(root, chordDegs[0], scale, 0),
        inicio: barStart,
        duracion: 3.5,
        velocidad: Math.max(40, soft - 12),
      })

      // Acorde sostenido suave (octava arriba)
      for (let i = 0; i < chordDegs.length; i++) {
        notes.push({
          pitch: degreeToPitch(root, chordDegs[i], scale, 1),
          inicio: barStart + 0.05 * i,
          duracion: 3.6,
          velocidad: Math.max(35, soft - 6 - i * 3),
        })
      }

      // Arpegio ligero en corcheas (textura suave)
      if (section !== 'intro' && section !== 'outro') {
        const arp = [0, 1, 2, 1, 0, 2, 1, 0]
        for (let s = 0; s < 8; s++) {
          const deg = chordDegs[arp[s] % chordDegs.length]
          notes.push({
            pitch: degreeToPitch(root, deg, scale, 2),
            inicio: barStart + s * 0.5,
            duracion: 0.45,
            velocidad: Math.max(28, soft - 18),
          })
        }
      }

      beat += 4 // 4/4
    }
  }

  // Repite el ciclo de secciones hasta cubrir la duración pedida
  let guard = 0
  while (beat < targetBeats && guard < 40) {
    for (const section of sections) {
      emitSection(section)
      if (beat >= targetBeats) break
    }
    guard++
  }

  // Cadencia final en tónica
  notes.push({
    pitch: degreeToPitch(root, 0, scale, 0),
    inicio: beat,
    duracion: 4,
    velocidad: soft - 8,
  })
  notes.push({
    pitch: degreeToPitch(root, 2, scale, 1),
    inicio: beat,
    duracion: 4,
    velocidad: soft - 10,
  })
  notes.push({
    pitch: degreeToPitch(root, 4, scale, 1),
    inicio: beat,
    duracion: 4,
    velocidad: soft - 12,
  })
  beat += 4

  return {
    notes,
    durationBeats: beat,
    structureLabel: labels.join(' → '),
  }
}

/** Extrae tonalidad aproximada del texto del usuario. */
export function inferKeyFromText(text: string): { root: number; scale: 'major' | 'minor'; label: string } {
  const lower = text.toLowerCase()
  const map: Array<{ re: RegExp; root: number; scale: 'major' | 'minor'; label: string }> = [
    { re: /\bc\s*menor|c\s*minor|do\s*menor\b/, root: 48, scale: 'minor', label: 'C menor' },
    { re: /\bc\s*mayor|c\s*major|do\s*mayor|\ben\s*c\b/, root: 48, scale: 'major', label: 'C mayor' },
    { re: /\ba\s*menor|a\s*minor|la\s*menor\b/, root: 45, scale: 'minor', label: 'A menor' },
    { re: /\bg\s*mayor|sol\s*mayor\b/, root: 43, scale: 'major', label: 'G mayor' },
    { re: /\bf\s*mayor|fa\s*mayor\b/, root: 41, scale: 'major', label: 'F mayor' },
    { re: /\bd\s*menor|d\s*minor|re\s*menor|en\s+d\s+menor\b/, root: 50, scale: 'minor', label: 'D menor' },
    { re: /\bd\s*mayor|re\s*mayor\b/, root: 50, scale: 'major', label: 'D mayor' },
    { re: /\be\s*menor|mi\s*menor\b/, root: 52, scale: 'minor', label: 'E menor' },
    { re: /\bb\s*menor|si\s*menor\b/, root: 47, scale: 'minor', label: 'B menor' },
  ]
  for (const m of map) {
    if (m.re.test(lower)) return { root: m.root, scale: m.scale, label: m.label }
  }
  return { root: 48, scale: 'major', label: 'C mayor' }
}

export function inferMinutesFromText(text: string, fallback = 3): number {
  const m =
    text.match(/(\d+(?:[.,]\d+)?)\s*min/) ||
    text.match(/dure\s+(\d+(?:[.,]\d+)?)/i) ||
    text.match(/duraci[oó]n\s+(?:de\s+)?(\d+(?:[.,]\d+)?)/i)
  if (m) return Math.max(1, parseFloat(m[1].replace(',', '.')))
  if (/al\s+menos\s+3|3\s*minutos|tres\s+minutos/i.test(text)) return 3
  if (/4\s*minutos|cuatro\s+minutos/i.test(text)) return 4
  return fallback
}

export function wantsDawCreation(text: string): boolean {
  return /genera|crea|haz(lo|me)?|arm[aá]|escribe|pon(me)?|midi|piano|pista|song|canci[oó]n|estrofa|coro|puente/i.test(
    text,
  )
}
