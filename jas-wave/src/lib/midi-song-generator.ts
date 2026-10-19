/**
 * Compositor MIDI del agente JasWave.
 * Las notas se derivan del brief del usuario (tonalidad, progresión, articulación,
 * duración, velocidades). No hay bancos de plantillas ni tonalidad por defecto en C menor.
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

export type MusicStyle = 'ballad' | 'arp' | 'sparse' | 'pulse' | 'waltz' | 'cinematic' | 'strum'

export type Articulation = 'strum' | 'arp' | 'pad' | 'melody' | 'block' | 'drums' | 'bass'

/** Plan por compás (lo emite Music Build / la IA; el motor solo renderiza). */
export type MidiBarPlan = {
  kind: MidiSongSection
  degree: number
  density: number
}

export type GenerateMidiSongOptions = {
  keyRoot?: number
  scale?: 'major' | 'minor'
  bpm?: number
  minutes?: number
  velocitySoft?: number
  sections?: MidiSongSection[]
  /** Preferido: 1 entrada por compás con grado/densidad de la IA. */
  barPlan?: MidiBarPlan[]
  seed?: number | string
  mood?: MusicMood
  style?: MusicStyle
  nombre?: string
  /** Texto original del usuario — manda sobre mood/plantilla. */
  prompt?: string
  /** Grados Nashville 1–7, p.ej. [6, 4, 1, 3]. */
  progression?: number[]
  articulacion?: Articulation
}

export type GeneratedNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
}

export type MidiBrief = {
  keyRoot: number
  scale: 'major' | 'minor'
  keyLabel: string
  keyExplicit: boolean
  degrees: number[]
  minutes: number
  bpm?: number
  articulation: Articulation
  velocityBase: number
  velocityAccent: number
  clipName: string
  mood: MusicMood
  instrumentHint?: string
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function degreeToPitch(root: number, degree: number, scale: 'major' | 'minor', octaveOffset = 0): number {
  const intervals = scale === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS
  const oct = Math.floor(degree / 7) + octaveOffset
  const d = ((degree % 7) + 7) % 7
  return clamp(root + intervals[d]! + oct * 12, 21, 108)
}

function moodFromText(text: string): MusicMood {
  const t = text.toLowerCase()
  if (/triste|sad|melanc|llor|dolor|nostalg|oscuro\s+triste/.test(t)) return 'sad'
  if (/alegre|happy|feliz|joy|solar|bright|upbeat/.test(t)) return 'happy'
  if (/[eé]pico|epic|heroic|cinem[aá]tic|trailer|grand|cre[cs]end/.test(t)) return 'epic'
  if (/ambient|espacial|space|pad|atmosf|chill|lounge/.test(t)) return 'ambient'
  if (/oscuro|dark|g[oó]tico|mister|terror|horror/.test(t)) return 'dark'
  if (/rom[aá]ntic|amor|love|ballad|suave\s+amor/.test(t)) return 'romantic'
  if (/energ|rapido|r[aá]pido|dance|groove|funk|beat/.test(t)) return 'energetic'
  return 'neutral'
}

export function inferMoodFromText(text: string): MusicMood {
  return moodFromText(text)
}

const KEY_TABLE: Array<{ re: RegExp; root: number; scale: 'major' | 'minor'; label: string }> = [
  { re: /\bf\s*#\s*(?:menor|minor)\b|\bf\s*#m\b|fa\s*#\s*menor|f♯\s*(?:menor|m)\b/i, root: 54, scale: 'minor', label: 'F# menor' },
  { re: /\bf\s*#\s*(?:mayor|major)\b|fa\s*#\s*mayor|f♯\s*mayor/i, root: 54, scale: 'major', label: 'F# mayor' },
  { re: /\b(?:en\s+)?f\s*#|\bfa\s*(?:sostenid[oa]|#|♯)|\bf♯/i, root: 54, scale: 'major', label: 'F# mayor' },
  { re: /\bgb\s*(?:menor|minor)|sol\s*b\s*menor/i, root: 54, scale: 'minor', label: 'Gb menor' },
  { re: /\bgb\b|sol\s*bemol/i, root: 54, scale: 'major', label: 'Gb mayor' },
  { re: /\bc\s*#\s*(?:menor|minor)|do\s*#\s*menor/i, root: 49, scale: 'minor', label: 'C# menor' },
  { re: /\bc\s*#|do\s*(?:sostenid|#)/i, root: 49, scale: 'major', label: 'C# mayor' },
  { re: /\bb\s*b\s*(?:menor|minor)|si\s*b\s*menor/i, root: 46, scale: 'minor', label: 'Bb menor' },
  { re: /\bb\s*b\b|si\s*bemol/i, root: 46, scale: 'major', label: 'Bb mayor' },
  { re: /\be\s*b\s*(?:menor|minor)|mi\s*b\s*menor/i, root: 51, scale: 'minor', label: 'Eb menor' },
  { re: /\be\s*b\b|mi\s*bemol/i, root: 51, scale: 'major', label: 'Eb mayor' },
  { re: /\ba\s*b\s*(?:menor|minor)|la\s*b\s*menor/i, root: 44, scale: 'minor', label: 'Ab menor' },
  { re: /\ba\s*b\b|la\s*bemol/i, root: 44, scale: 'major', label: 'Ab mayor' },
  { re: /\bc\s*menor|c\s*minor|do\s*menor\b|\bcm\b/i, root: 48, scale: 'minor', label: 'C menor' },
  { re: /\bc\s*mayor|c\s*major|do\s*mayor\b/i, root: 48, scale: 'major', label: 'C mayor' },
  { re: /\ba\s*menor|a\s*minor|la\s*menor\b|\bam\b/i, root: 45, scale: 'minor', label: 'A menor' },
  { re: /\ba\s*mayor|la\s*mayor\b|\ba\s*maj\b/i, root: 57, scale: 'major', label: 'A mayor' },
  { re: /\bg\s*menor|sol\s*menor\b|\bgm\b/i, root: 43, scale: 'minor', label: 'G menor' },
  { re: /\bg\s*mayor|sol\s*mayor\b|\bg\s*maj\b/i, root: 43, scale: 'major', label: 'G mayor' },
  { re: /\bf\s*menor|fa\s*menor\b|\bfm\b/i, root: 41, scale: 'minor', label: 'F menor' },
  { re: /\bf\s*mayor|fa\s*mayor\b/i, root: 41, scale: 'major', label: 'F mayor' },
  { re: /\bd\s*menor|d\s*minor|re\s*menor\b|\bdm\b/i, root: 50, scale: 'minor', label: 'D menor' },
  { re: /\bd\s*mayor|re\s*mayor\b/i, root: 50, scale: 'major', label: 'D mayor' },
  { re: /\be\s*menor|mi\s*menor\b|\bem\b/i, root: 52, scale: 'minor', label: 'E menor' },
  { re: /\be\s*mayor|mi\s*mayor\b/i, root: 52, scale: 'major', label: 'E mayor' },
  { re: /\bb\s*menor|si\s*menor\b|\bbm\b/i, root: 47, scale: 'minor', label: 'B menor' },
  { re: /\bb\s*mayor|si\s*mayor\b/i, root: 59, scale: 'major', label: 'B mayor' },
]

export function inferKeyFromText(text: string): {
  root: number
  scale: 'major' | 'minor'
  label: string
  explicit: boolean
} {
  const lower = text.toLowerCase()
  for (const m of KEY_TABLE) {
    if (m.re.test(lower)) {
      return { root: m.root, scale: m.scale, label: m.label, explicit: true }
    }
  }
  return { root: 60, scale: 'major', label: 'C mayor', explicit: false }
}

const ROMAN_TOKEN = /^(vii|vi|iv|iii|ii|i|v)[°o]?$/i

function romanToDegree(tok: string): number | null {
  const t = tok.toLowerCase().replace(/[°o]/g, '')
  const map: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 }
  return map[t] ?? null
}

/** Nashville 1–7 o romanos vi-IV-I-iii. */
export function inferProgressionFromText(text: string): number[] | null {
  const roman = text.match(
    /\b((?:vii|vi|iv|iii|ii|i|v)[°o]?(?:\s*[-–—/]\s*(?:vii|vi|iv|iii|ii|i|v)[°o]?){1,7})\b/i,
  )
  if (roman) {
    const parts = roman[1]!.split(/\s*[-–—/]\s*/)
    const degs = parts.map(romanToDegree).filter((n): n is number => n != null)
    if (degs.length >= 2 && parts.every((p) => ROMAN_TOKEN.test(p.trim()))) return degs
  }

  const nums = text.match(/\b([1-7](?:\s*[-–—,/]\s*[1-7]){1,7})\b/)
  if (nums) {
    const seq = nums[1]!.split(/\s*[-–—,/]\s*/).map((n) => Number(n))
    if (seq.length >= 2 && seq.every((n) => n >= 1 && n <= 7)) return seq
  }
  return null
}

export function inferArticulationFromText(text: string): Articulation {
  const t = text.toLowerCase()
  if (/bater|drum|kit|percusi/.test(t)) return 'drums'
  if (/rasgueo|downstroke|strum|p\u00faa|pua|guitarra/.test(t)) return 'strum'
  if (/bajo|bass line|bassline/.test(t)) return 'bass'
  if (/arpeg/.test(t)) return 'arp'
  if (/\bpad\b|sostenid|block|acordes?\s+larg/.test(t)) return 'pad'
  if (/melod[ií]a|lead|canto/.test(t)) return 'melody'
  if (/bajo|bass/.test(t)) return 'bass'
  // Piano / suave / ballad → bloques con voicing (no arpegio infinito)
  if (/piano|teclado|keys|suave|soft|ballad|acordes?/.test(t)) return 'pad'
  return 'pad'
}

export function inferInstrumentHint(text: string): string | undefined {
  const t = text.toLowerCase()
  if (/guitar|rasgueo/.test(t)) return 'guitar'
  if (/piano|keys|teclado/.test(t)) return 'piano'
  if (/bajo|bass/.test(t)) return 'bass'
  if (/cuerda|string|viol/.test(t)) return 'strings'
  if (/pad|synth|sintet/.test(t)) return 'pad'
  if (/bater|drum/.test(t)) return 'drums'
  return undefined
}

export function inferMinutesFromText(text: string, fallback = 3): number {
  const m =
    text.match(/(\d+(?:[.,]\d+)?)\s*min/) ||
    text.match(/dure\s+(\d+(?:[.,]\d+)?)/i) ||
    text.match(/duraci[oó]n\s+(?:de\s+)?(\d+(?:[.,]\d+)?)/i)
  if (m) return Math.max(0.25, parseFloat(m[1]!.replace(',', '.')))
  const clock = text.match(/\b(\d{1,2}):([0-5]\d)\b/)
  if (clock) return Math.max(0.25, Number(clock[1]) + Number(clock[2]) / 60)
  if (/al\s+menos\s+3|3\s*minutos|tres\s+minutos/i.test(text)) return 3
  if (/4\s*minutos|cuatro\s+minutos/i.test(text)) return 4
  return fallback
}

export function wantsDawCreation(text: string): boolean {
  const t = text.toLowerCase()
  const verb = /genera|crea|haz(lo|me)?|arm[aá]|escribe|pon(me)?|inserta|modifica|reescribe/
  const noun = /midi|clip|piano|pista|song|canci[oó]n|estrofa|coro|acorde|arpeg|melod|rasgueo|proyecto|vst|bater|drum/
  return verb.test(t) && noun.test(t)
}

export function inferClipNameFromText(text: string, keyLabel: string): string {
  const t = text.trim()
  const quoted = t.match(/[«"']([^«"']{2,40})[»"']/)
  if (quoted) return quoted[1]!.trim()
  const hint = inferInstrumentHint(t)
  if (hint === 'drums') return `Batería`
  if (hint === 'bass') return `Bajo · ${keyLabel}`
  if (hint === 'guitar') return `Guitarra · ${keyLabel}`
  if (hint === 'piano') return `Piano · ${keyLabel}`
  if (/triste/i.test(t)) return `Melodía triste · ${keyLabel}`
  if (/alegre|feliz/i.test(t)) return `Melodía alegre · ${keyLabel}`
  if (/[eé]pic/i.test(t)) return `Tema épico · ${keyLabel}`
  if (/ambient/i.test(t)) return `Ambient · ${keyLabel}`
  if (/melod/i.test(t)) return `Melodía · ${keyLabel}`
  return `MIDI · ${keyLabel}`
}

/** Nombre de pista (no del clip) al crear MIDI en un proyecto vacío. */
export function inferTrackNameFromText(text: string): string {
  const hint = inferInstrumentHint(text)
  if (hint === 'drums') return 'Batería'
  if (hint === 'bass') return 'Bajo'
  if (hint === 'guitar') return 'Guitarra'
  if (hint === 'piano') return 'Keys'
  if (hint === 'pad') return 'Pad'
  if (hint === 'strings') return 'Cuerdas'
  return 'MIDI'
}

function defaultProgression(scale: 'major' | 'minor', mood: MusicMood): number[] {
  if (scale === 'minor') {
    if (mood === 'dark') return [1, 7, 6, 5, 1, 4, 6, 7]
    if (mood === 'sad' || mood === 'romantic') return [1, 6, 3, 7, 4, 6, 1, 5]
    if (mood === 'epic') return [1, 5, 6, 4, 1, 7, 6, 5]
    return [1, 4, 6, 5, 1, 6, 4, 5]
  }
  if (mood === 'energetic' || mood === 'happy') return [1, 5, 6, 4, 2, 5, 1, 4]
  if (mood === 'epic') return [6, 4, 1, 5, 6, 5, 1, 4]
  return [6, 4, 1, 5, 2, 4, 6, 5]
}

/** Segunda progresión (puente / contraste) para evitar loop eterno I–V–vi–IV. */
function contrastProgression(scale: 'major' | 'minor', mood: MusicMood, _primary: number[]): number[] {
  if (scale === 'minor') {
    if (mood === 'dark') return [6, 7, 1, 5]
    return [4, 5, 6, 1]
  }
  if (mood === 'energetic') return [4, 5, 3, 6]
  return [2, 5, 1, 6]
}

type SectionKind = MidiSongSection

function sectionAtBar(bar: number, totalBars: number, sections?: SectionKind[]): SectionKind {
  if (sections && sections.length > 0) {
    // Music Build pasa 1 entrada por compás → índice directo. Listas cortas → proporcionales.
    if (sections.length >= Math.max(1, Math.floor(totalBars * 0.75))) {
      return sections[Math.min(sections.length - 1, bar)]!
    }
    return sections[
      Math.min(sections.length - 1, Math.floor((bar / Math.max(1, totalBars)) * sections.length))
    ]!
  }
  const t = bar / Math.max(1, totalBars)
  if (t < 0.12) return 'intro'
  if (t < 0.35) return 'verse'
  if (t < 0.55) return 'chorus'
  if (t < 0.68) return 'verse'
  if (t < 0.82) return 'chorus'
  if (t < 0.92) return 'bridge'
  return 'outro'
}

function densityForSection(sec: SectionKind): number {
  switch (sec) {
    case 'intro':
    case 'outro':
      return 0.45
    case 'verse':
      return 0.7
    case 'breakdown':
      return 0.35
    case 'build':
      return 0.85
    case 'chorus':
      return 1
    case 'bridge':
      return 0.8
    default:
      return 0.75
  }
}

/**
 * Voicing con inversión cercana al voicing previo (voice leading).
 * Incluye 7ª o sus ocasionales.
 */
function chordVoicing(
  root: number,
  degree1: number,
  scale: 'major' | 'minor',
  prev: number[] | null,
  rng: () => number,
  opts?: { seventh?: boolean; sus?: boolean; spread?: boolean },
): number[] {
  const d = degree1 - 1
  const triad = [
    degreeToPitch(root, d, scale, 0),
    degreeToPitch(root, d + 2, scale, 0),
    degreeToPitch(root, d + 4, scale, 0),
  ]
  if (opts?.seventh) triad.push(degreeToPitch(root, d + 6, scale, 0))
  if (opts?.sus) {
    triad[1] = degreeToPitch(root, d + 3, scale, 0) // sus4-ish
  }
  // Probar inversiones: 0 = root, 1 = 1ª inv, 2 = 2ª
  let best = triad.map((p) => p)
  let bestScore = Infinity
  for (let inv = 0; inv < 3; inv++) {
    const cand = [...triad]
    for (let k = 0; k < inv; k++) {
      const low = cand.shift()!
      cand.push(low + 12)
    }
    for (let i = 0; i < cand.length; i++) {
      while (cand[i]! < 48) cand[i]! += 12
      while (cand[i]! > 76) cand[i]! -= 12
      cand[i] = clamp(cand[i]!, 36, 88)
    }
    cand.sort((a, b) => a - b)
    if (opts?.spread && cand.length >= 3) {
      cand[cand.length - 1] = clamp(cand[cand.length - 1]! + 12, 48, 96)
    }
    let score = 0
    if (prev && prev.length) {
      for (let i = 0; i < Math.min(cand.length, prev.length); i++) {
        score += Math.abs(cand[i]! - prev[i]!)
      }
    } else {
      score = Math.abs(cand[0]! - 55) // prefer mid
    }
    score += inv * 0.35
    if (score < bestScore) {
      bestScore = score
      best = cand
    }
  }
  // Micro-variation
  if (rng() > 0.7 && best.length >= 3) {
    best[best.length - 1] = clamp(best[best.length - 1]! + (rng() > 0.5 ? 12 : 0), 48, 96)
  }
  return best
}

function _chordTones(root: number, degree1: number, scale: 'major' | 'minor', spread = 4): number[] {
  const d = degree1 - 1
  const tones = [
    degreeToPitch(root, d, scale, -1),
    degreeToPitch(root, d, scale, 0),
    degreeToPitch(root, d + 2, scale, 0),
    degreeToPitch(root, d + 4, scale, 0),
  ]
  if (spread > 4) tones.push(degreeToPitch(root, d, scale, 1))
  return tones
}

export function parseMidiBriefFromText(text: string, bpmFallback = 120): MidiBrief {
  const key = inferKeyFromText(text)
  const mood = moodFromText(text)
  let scale = key.scale
  const degrees = inferProgressionFromText(text)
  if (!key.explicit && degrees && degrees[0] === 6) {
    scale = 'major'
  }
  const articulation = inferArticulationFromText(text)
  const minutes = inferMinutesFromText(text, 2)
  const soft =
    /suave|soft|delicado/.test(text.toLowerCase()) ||
    mood === 'sad' ||
    mood === 'ambient' ||
    mood === 'romantic'
  const velocityBase = soft ? 54 : mood === 'energetic' ? 82 : 68
  const keyLabel = key.label
  const lower = text.toLowerCase()
  const bpmHit =
    lower.match(/\b(\d{2,3})\s*bpm\b/) ||
    lower.match(/\bbpm\s*(?:a|de|=|:)?\s*(\d{2,3})\b/) ||
    lower.match(/\btempo\s*(?:sea|a|de|=|:)?\s*(\d{2,3})\b/) ||
    lower.match(/\btiempo\s*(?:sea|a|de|=|:)?\s*(\d{2,3})\b/) ||
    lower.match(/\b(\d{2,3})\s*4\s*\/\s*4\b/)
  const parsed = bpmHit ? Number(bpmHit[1]) : NaN
  const bpm =
    Number.isFinite(parsed) && parsed >= 40 && parsed <= 240 ? Math.round(parsed) : bpmFallback

  return {
    keyRoot: key.root,
    scale,
    keyLabel,
    keyExplicit: key.explicit,
    degrees: degrees ?? defaultProgression(scale, mood),
    minutes,
    bpm,
    articulation,
    velocityBase,
    velocityAccent: velocityBase + (soft ? 10 : 16),
    clipName: inferClipNameFromText(text, keyLabel),
    mood,
    instrumentHint: inferInstrumentHint(text),
  }
}

function styleFromArticulation(a: Articulation): MusicStyle {
  if (a === 'strum') return 'strum'
  if (a === 'arp') return 'arp'
  if (a === 'drums' || a === 'bass') return 'pulse'
  if (a === 'pad' || a === 'block') return 'ballad'
  return 'ballad'
}

export function composeMidiFromBrief(
  brief: MidiBrief,
  opts?: {
    seed?: number
    bpm?: number
    sections?: MidiSongSection[]
    barPlan?: MidiBarPlan[]
    /** Si true, no inventar contraste/sustituciones: solo el plan/progresión dados. */
    aiDirected?: boolean
  },
): {
  notes: GeneratedNote[]
  durationBeats: number
  structureLabel: string
  mood: MusicMood
  style: MusicStyle
  seed: number
} {
  const bpm = Math.max(20, Math.min(400, opts?.bpm ?? brief.bpm ?? 120))
  const seedNum =
    opts?.seed ??
    hashSeed(`${brief.keyLabel}|${brief.degrees.join('-')}|${brief.articulation}|${brief.minutes}|v4-ai`)
  const rng = createRng(seedNum)
  const notes: GeneratedNote[] = []
  const barPlan = opts?.barPlan
  const aiDirected = opts?.aiDirected === true || (barPlan != null && barPlan.length > 0)
  const targetBeats = barPlan?.length
    ? barPlan.length * 4
    : Math.max(4, brief.minutes * bpm)
  const barLen = 4
  const primary = brief.degrees.length ? brief.degrees : [1, 4, 5, 1]
  const contrast = aiDirected ? primary : contrastProgression(brief.scale, brief.mood, primary)
  const totalBars = barPlan?.length
    ? barPlan.length
    : Math.max(1, Math.ceil(targetBeats / barLen))
  let beat = 0
  let bar = 0
  let prevVoicing: number[] | null = null

  const push = (pitch: number, inicio: number, duracion: number, velocidad: number) => {
    notes.push({
      pitch: clamp(Math.round(pitch), 0, 127),
      inicio,
      duracion: Math.max(0.05, duracion),
      velocidad: clamp(Math.round(velocidad), 1, 127),
    })
  }

  const planForBar = (b: number): { kind: SectionKind; degree: number; dens: number } => {
    if (barPlan && barPlan[b]) {
      const p = barPlan[b]!
      return {
        kind: p.kind,
        degree: clamp(Math.round(p.degree), 1, 7),
        dens: clamp(p.density, 0.05, 1),
      }
    }
    const sec = sectionAtBar(b, totalBars, opts?.sections)
    const dens = densityForSection(sec)
    const prog = !aiDirected && (sec === 'bridge' || sec === 'breakdown') ? contrast : primary
    let degree = prog[b % prog.length]!
    if (!aiDirected && sec === 'chorus' && b % 4 === 3 && rng() > 0.55) {
      degree = brief.scale === 'major' ? 2 : 5
    }
    return { kind: sec, degree, dens }
  }

  const emitBar = (deg: number, start: number, sec: SectionKind, dens: number) => {
    const use7 = rng() > 0.55 && (sec === 'chorus' || sec === 'bridge' || bar % 4 === 2)
    const useSus = rng() > 0.88 && sec === 'verse'
    const tones = chordVoicing(brief.keyRoot, deg, brief.scale, prevVoicing, rng, {
      seventh: use7,
      sus: useSus,
      spread: dens > 0.85 || brief.articulation === 'strum',
    })
    prevVoicing = tones
    const bassRoot = degreeToPitch(brief.keyRoot, deg - 1, brief.scale, -1)
    const accentBar = bar % 4 === 0 || sec === 'chorus'
    const base =
      brief.velocityBase +
      (accentBar ? 8 : 0) +
      (sec === 'chorus' ? 6 : sec === 'intro' || sec === 'outro' ? -6 : 0) +
      Math.floor((rng() - 0.5) * 6)

    if (brief.articulation === 'drums') {
      const kick = 36
      const snare = 38
      const chh = 42
      const ohh = 46
      const crash = 49
      const ride = 51
      const tomLo = 45
      const tomHi = 47
      const tomMid = 48
      const tomHeavy = brief.mood === 'epic' || dens > 0.55
      if (bar === 0 || (sec === 'chorus' && bar % 8 === 0)) push(crash, start, 1.2, base + 14)
      // Kick patterns by section
      push(kick, start, 0.35, base + 18)
      if (dens > 0.6) push(kick, start + 2.5, 0.28, base + 8)
      if (sec === 'chorus' && rng() > 0.4) push(kick, start + 1.5, 0.2, base + 4)
      if (sec === 'build') {
        push(kick, start + 0.75, 0.2, base + 6)
        push(kick, start + 1.75, 0.2, base + 6)
        push(kick, start + 2.75, 0.2, base + 6)
      }
      push(snare, start + 1, 0.3, base + 14 + Math.floor(rng() * 8))
      push(snare, start + 3, 0.3, base + 12 + Math.floor(rng() * 6))
      if (sec === 'verse' && rng() > 0.7) push(snare, start + 2.75, 0.15, base - 10) // ghost
      const hatStep = dens > 0.75 ? 0.25 : 0.5
      for (let s = 0; s * hatStep < 4; s++) {
        const t = start + s * hatStep
        const open = dens > 0.9 && s % 4 === 3
        push(
          open ? ohh : chh,
          t,
          0.18,
          base - 12 + (s === 0 ? 10 : 0) + Math.floor((rng() - 0.5) * 14),
        )
      }
      // Fills: más toms y más fuertes conforme sube la densidad (crescendo)
      if (bar % 8 === 7 || (sec === 'build' && bar % 2 === 1) || (tomHeavy && bar % 4 === 3)) {
        const vel = base + 4 + Math.round(dens * 18)
        push(tomHi, start + 2, 0.18, vel)
        push(tomMid, start + 2.5, 0.18, vel + 2)
        push(tomLo, start + 3, 0.22, vel + 4)
        push(snare, start + 3.5, 0.25, base + 18)
      }
      if (tomHeavy && dens > 0.7) {
        push(tomHi, start + 0.5, 0.16, base + Math.round(dens * 10))
        push(tomLo, start + 1.5, 0.2, base + 6)
      }
      if (bar % 8 === 7) push(ride, start + 3.75, 0.35, base)
      return
    }

    if (brief.articulation === 'bass') {
      const root = bassRoot
      const fifth = clamp(root + 7, 24, 55)
      const oct = clamp(root + 12, 28, 60)
      // Walking / groove: no dos negras idénticas siempre
      const pattern =
        sec === 'chorus'
          ? [
              [0, 0.9, root],
              [1, 0.4, fifth],
              [1.5, 0.4, root],
              [2, 0.8, root],
              [3, 0.45, rng() > 0.5 ? oct : fifth],
              [3.5, 0.4, root],
            ]
          : dens < 0.5
            ? [
                [0, 1.8, root],
                [2, 1.6, root],
              ]
            : [
                [0, 1.1, root],
                [1.5, 0.4, fifth],
                [2, 1.0, root],
                [3.25, 0.55, rng() > 0.6 ? oct : root],
              ]
      for (const [off, dur, pitch] of pattern) {
        if (rng() > dens + 0.15 && (off as number) > 0) continue
        push(
          pitch as number,
          start + (off as number),
          dur as number,
          base + 4 + Math.floor((rng() - 0.5) * 12),
        )
      }
      return
    }

    if (brief.articulation === 'strum') {
      const strokes = dens > 0.85 ? 8 : dens > 0.55 ? 6 : 4
      const step = 4 / strokes
      for (let s = 0; s < strokes; s++) {
        if (dens < 0.5 && s % 2 === 1 && rng() > 0.4) continue
        const down = s % 2 === 0
        const beatVel =
          base +
          (s === 0 ? brief.velocityAccent - brief.velocityBase : 0) +
          (s === Math.floor(strokes / 2) ? 5 : 0) +
          Math.floor((rng() - 0.5) * 12)
        const strum = down ? tones : [...tones].reverse()
        for (let i = 0; i < strum.length; i++) {
          if (dens < 0.7 && i === 0 && !down) continue // skip lowest on upstroke when sparse
          push(
            strum[i]!,
            start + s * step + i * 0.015,
            Math.min(0.55, step * 0.9),
            beatVel - i * 3 + Math.floor((rng() - 0.5) * 8),
          )
        }
      }
      return
    }

    if (brief.articulation === 'arp') {
      const patterns = [
        [0, 1, 2, 3, 2, 1, 0, 2],
        [0, 2, 1, 3, 1, 2, 0, 3],
        [2, 0, 1, 2, 3, 2, 1, 0],
        [0, 1, 0, 2, 1, 3, 2, 1],
      ]
      const pattern = patterns[bar % patterns.length]!
      const step = dens > 0.8 ? 0.25 : 0.5
      const steps = Math.floor(4 / step)
      for (let s = 0; s < steps; s++) {
        if (dens < 0.5 && s % 2 === 1) continue
        const idx = pattern[s % pattern.length]! % tones.length
        const vel = base - 6 + (s % 4 === 0 ? 10 : 0) + Math.floor((rng() - 0.5) * 12)
        push(tones[idx]!, start + s * step + (rng() - 0.5) * 0.02, step * 0.88, vel)
      }
      return
    }

    if (brief.articulation === 'pad' || brief.articulation === 'block') {
      // No todos los tonos siempre: omitir uno en verso; full en coro
      const use = dens > 0.85 ? tones : tones.filter((_, i) => i !== 1 || rng() > 0.35)
      const hold = dens > 0.7 ? 3.6 : 2.8 + rng() * 0.6
      for (let i = 0; i < use.length; i++) {
        push(
          use[i]!,
          start + i * 0.025,
          hold,
          base - i * 3 + Math.floor((rng() - 0.5) * 10),
        )
      }
      // Anticipación al siguiente acorde (último octavo del compás)
      if (dens > 0.75 && rng() > 0.5) {
        const pick = tones[Math.floor(rng() * tones.length)]!
        push(pick, start + 3.5, 0.45, base - 12)
      }
      return
    }

    // melody: motivos que cambian por sección + saltos
    const motifs = [
      [0, 2, 1, 3, 2],
      [0, 1, 2, 4, 3, 2],
      [2, 1, 0, 1, 3],
      [0, 3, 2, 1, 2, 4],
    ]
    const motif = motifs[(bar + (sec === 'chorus' ? 1 : 0)) % motifs.length]!
    const step = dens > 0.8 ? 0.5 : 0.75
    for (let m = 0; m < motif.length; m++) {
      if (dens < 0.5 && m % 2 === 1) continue
      const idx = motif[m]! % tones.length
      let pitch = tones[idx]!
      if (sec === 'chorus' && m === motif.length - 1) pitch = clamp(pitch + 12, 48, 96)
      push(
        pitch,
        start + m * step + (rng() - 0.5) * 0.05,
        step * 0.85,
        base - 4 + Math.floor(rng() * 14) + (m === 0 ? 6 : 0),
      )
    }
  }

  while (bar < totalBars && bar < 512) {
    const { kind: sec, degree: deg, dens } = planForBar(bar)
    emitBar(deg, beat, sec, dens)
    beat += barLen
    bar++
  }

  // Cadencia final (no repetir el mismo pad plano)
  if (brief.articulation !== 'drums') {
    const endVoices = chordVoicing(brief.keyRoot, primary[0]!, brief.scale, prevVoicing, rng, {
      seventh: true,
      spread: true,
    })
    for (let i = 0; i < endVoices.length; i++) {
      push(endVoices[i]!, beat + i * 0.04, 3.5, brief.velocityBase - 4 - i * 2)
    }
  } else {
    push(49, beat, 2, brief.velocityBase + 12)
    push(36, beat, 2, brief.velocityBase + 10)
  }
  beat += 4

  const style = styleFromArticulation(brief.articulation)
  const formTag = aiDirected ? 'ai-form' : 'fallback-form'
  return {
    notes,
    durationBeats: beat,
    structureLabel: `${brief.keyLabel} · ${primary.join('–')} · ${brief.articulation} · ${formTag}`,
    mood: brief.mood,
    style,
    seed: seedNum,
  }
}

/**
 * Compat: genera desde opciones + prompt. Si hay prompt/progresión, manda el brief.
 */
export function generateSoftPianoSong(opts: GenerateMidiSongOptions = {}): {
  notes: GeneratedNote[]
  durationBeats: number
  structureLabel: string
  mood: MusicMood
  style: MusicStyle
  seed: number
} {
  const prompt = String(opts.prompt ?? opts.nombre ?? '')
  const brief = parseMidiBriefFromText(prompt || `${opts.mood ?? ''} ${opts.style ?? ''}`, opts.bpm ?? 120)

  if (opts.keyRoot != null) brief.keyRoot = opts.keyRoot
  if (opts.scale) brief.scale = opts.scale
  if (opts.minutes != null) brief.minutes = Math.max(0.25, opts.minutes)
  if (opts.mood) brief.mood = opts.mood
  if (opts.progression && opts.progression.length >= 2) {
    brief.degrees = opts.progression.map((n) => clamp(Math.round(n), 1, 7))
  }
  if (opts.articulacion) brief.articulation = opts.articulacion
  else if (opts.style === 'strum') brief.articulation = 'strum'
  else if (opts.style === 'arp') brief.articulation = 'arp'
  if (opts.velocitySoft != null) {
    brief.velocityBase = opts.velocitySoft
    brief.velocityAccent = opts.velocitySoft + 12
  }
  if (opts.nombre) brief.clipName = opts.nombre

  const seedNum =
    typeof opts.seed === 'number'
      ? opts.seed
      : hashSeed(String((opts.seed ?? prompt) || brief.clipName))

  return composeMidiFromBrief(brief, {
    seed: seedNum,
    bpm: opts.bpm ?? brief.bpm,
    sections: opts.sections,
    barPlan: opts.barPlan,
    aiDirected: !!opts.barPlan?.length || !!opts.progression?.length,
  })
}
