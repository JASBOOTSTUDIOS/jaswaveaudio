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

export type GenerateMidiSongOptions = {
  keyRoot?: number
  scale?: 'major' | 'minor'
  bpm?: number
  minutes?: number
  velocitySoft?: number
  sections?: MidiSongSection[]
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
  if (/[eé]pico|epic|heroic|cinem[aá]tic|trailer|grand/.test(t)) return 'epic'
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
  { re: /\bc\s*menor|c\s*minor|do\s*menor\b/i, root: 48, scale: 'minor', label: 'C menor' },
  { re: /\bc\s*mayor|c\s*major|do\s*mayor\b/i, root: 48, scale: 'major', label: 'C mayor' },
  { re: /\ba\s*menor|a\s*minor|la\s*menor\b/i, root: 45, scale: 'minor', label: 'A menor' },
  { re: /\ba\s*mayor|la\s*mayor\b/i, root: 57, scale: 'major', label: 'A mayor' },
  { re: /\bg\s*menor|sol\s*menor\b/i, root: 43, scale: 'minor', label: 'G menor' },
  { re: /\bg\s*mayor|sol\s*mayor\b/i, root: 43, scale: 'major', label: 'G mayor' },
  { re: /\bf\s*menor|fa\s*menor\b/i, root: 41, scale: 'minor', label: 'F menor' },
  { re: /\bf\s*mayor|fa\s*mayor\b/i, root: 41, scale: 'major', label: 'F mayor' },
  { re: /\bd\s*menor|d\s*minor|re\s*menor\b/i, root: 50, scale: 'minor', label: 'D menor' },
  { re: /\bd\s*mayor|re\s*mayor\b/i, root: 50, scale: 'major', label: 'D mayor' },
  { re: /\be\s*menor|mi\s*menor\b/i, root: 52, scale: 'minor', label: 'E menor' },
  { re: /\be\s*mayor|mi\s*mayor\b/i, root: 52, scale: 'major', label: 'E mayor' },
  { re: /\bb\s*menor|si\s*menor\b/i, root: 47, scale: 'minor', label: 'B menor' },
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
  return 'arp'
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
  if (hint === 'guitar') return `Guitarra · ${keyLabel}`
  if (hint === 'piano') return `Piano · ${keyLabel}`
  if (/triste/i.test(t)) return `Melodía triste · ${keyLabel}`
  if (/alegre|feliz/i.test(t)) return `Melodía alegre · ${keyLabel}`
  if (/[eé]pic/i.test(t)) return `Tema épico · ${keyLabel}`
  if (/ambient/i.test(t)) return `Ambient · ${keyLabel}`
  if (/melod/i.test(t)) return `Melodía · ${keyLabel}`
  return `MIDI · ${keyLabel}`
}

function defaultProgression(scale: 'major' | 'minor', mood: MusicMood): number[] {
  if (scale === 'minor') {
    if (mood === 'dark') return [1, 6, 3, 7]
    if (mood === 'sad' || mood === 'romantic') return [1, 6, 3, 7]
    return [1, 4, 6, 5]
  }
  if (mood === 'energetic' || mood === 'happy') return [1, 5, 6, 4]
  return [6, 4, 1, 5]
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
    lower.match(/\btempo\s*(?:a|de|=|:)?\s*(\d{2,3})\b/)
  const bpm = bpmHit ? Math.max(20, Math.min(400, Number(bpmHit[1]))) : bpmFallback

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

function chordTones(root: number, degree1: number, scale: 'major' | 'minor', spread = 4): number[] {
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

function styleFromArticulation(a: Articulation): MusicStyle {
  if (a === 'strum') return 'strum'
  if (a === 'arp') return 'arp'
  if (a === 'drums' || a === 'bass') return 'pulse'
  if (a === 'pad' || a === 'block') return 'ballad'
  return 'ballad'
}

export function composeMidiFromBrief(
  brief: MidiBrief,
  opts?: { seed?: number; bpm?: number },
): {
  notes: GeneratedNote[]
  durationBeats: number
  structureLabel: string
  mood: MusicMood
  style: MusicStyle
  seed: number
} {
  const bpm = Math.max(20, Math.min(400, opts?.bpm ?? brief.bpm ?? 120))
  const seedNum = opts?.seed ?? hashSeed(`${brief.keyLabel}|${brief.degrees.join('-')}|${brief.articulation}|${brief.minutes}`)
  const rng = createRng(seedNum)
  const notes: GeneratedNote[] = []
  const targetBeats = Math.max(4, brief.minutes * bpm)
  const barLen = 4
  const degrees = brief.degrees.length ? brief.degrees : [1, 4, 5, 1]
  let beat = 0
  let bar = 0

  const push = (pitch: number, inicio: number, duracion: number, velocidad: number) => {
    notes.push({
      pitch: clamp(Math.round(pitch), 0, 127),
      inicio,
      duracion: Math.max(0.05, duracion),
      velocidad: clamp(Math.round(velocidad), 1, 127),
    })
  }

  const emitBar = (deg: number, start: number) => {
    const tones = chordTones(brief.keyRoot, deg, brief.scale, brief.articulation === 'strum' ? 5 : 4)
    const accentBar = bar % 4 === 0
    const base = brief.velocityBase + (accentBar ? 4 : 0)

    if (brief.articulation === 'drums') {
      const kick = 36
      const snare = 38
      const chh = 42
      const ohh = 46
      const crash = 49
      const ride = 51
      if (bar === 0) push(crash, start, 1.5, base + 12)
      push(kick, start, 0.35, base + 18)
      push(kick, start + 2.5, 0.3, base + 8)
      push(snare, start + 1, 0.3, base + 14)
      push(snare, start + 3, 0.3, base + 12)
      for (let s = 0; s < 8; s++) {
        const hat = s % 2 === 1 && bar % 4 === 3 ? ohh : chh
        push(hat, start + s * 0.5, 0.2, base - 10 + (s === 0 ? 8 : 0) + Math.floor((rng() - 0.5) * 10))
      }
      if (bar % 8 === 7) push(ride, start + 3.5, 0.4, base)
      return
    }

    if (brief.articulation === 'bass') {
      const root = chordTones(brief.keyRoot, deg, brief.scale, 4)[0]!
      push(root, start, 1.6, base + 6)
      push(root, start + 2, 1.4, base)
      if (rng() > 0.45) push(root + 7, start + 3, 0.7, base - 8)
      return
    }

    if (brief.articulation === 'strum') {
      // Rasgueo hacia abajo: cuerdas graves → agudas, 8 corcheas, velocidades independientes.
      for (let s = 0; s < 8; s++) {
        const down = s % 2 === 0
        if (!down && /suave/.test(brief.clipName.toLowerCase())) {
          /* still play, quieter */
        }
        const beatVel =
          base +
          (s === 0 ? brief.velocityAccent - brief.velocityBase : 0) +
          (s === 4 ? 6 : 0) +
          Math.floor((rng() - 0.5) * 10)
        const strum = down ? tones : [...tones].reverse()
        for (let i = 0; i < strum.length; i++) {
          const delay = i * 0.018
          push(
            strum[i]!,
            start + s * 0.5 + delay,
            0.42,
            beatVel - i * 3 + Math.floor((rng() - 0.5) * 6),
          )
        }
      }
      return
    }

    if (brief.articulation === 'arp') {
      const pattern = [0, 1, 2, 3, 2, 1, 0, 2]
      for (let s = 0; s < 8; s++) {
        const idx = pattern[s % pattern.length]! % tones.length
        const vel = base - 8 + (s % 4 === 0 ? 8 : 0) + Math.floor((rng() - 0.5) * 8)
        push(tones[idx]!, start + s * 0.5, 0.46, vel)
      }
      return
    }

    if (brief.articulation === 'pad' || brief.articulation === 'block') {
      for (let i = 0; i < tones.length; i++) {
        push(tones[i]!, start + i * 0.03, 3.7, base - i * 4)
      }
      return
    }

    // melody: motif over the chord
    const motif = [0, 2, 1, 3, 2]
    for (let m = 0; m < motif.length; m++) {
      const idx = motif[m]! % tones.length
      push(tones[idx]!, start + m * 0.75 + rng() * 0.04, 0.65, base - 6 + Math.floor(rng() * 10))
    }
  }

  while (beat < targetBeats && bar < 512) {
    const deg = degrees[bar % degrees.length]!
    emitBar(deg, beat)
    beat += barLen
    bar++
  }

  const lastDeg = degrees[0]!
  if (brief.articulation !== 'drums') {
    const end = chordTones(brief.keyRoot, lastDeg, brief.scale, 4)
    for (let i = 0; i < end.length; i++) {
      push(end[i]!, beat + i * 0.04, 3.2, brief.velocityBase - 8 - i * 3)
    }
  } else {
    push(49, beat, 2, brief.velocityBase + 10)
    push(36, beat, 2, brief.velocityBase + 8)
  }
  beat += 4

  const style = styleFromArticulation(brief.articulation)
  return {
    notes,
    durationBeats: beat,
    structureLabel: `${brief.keyLabel} · ${degrees.join('–')} · ${brief.articulation}`,
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

  return composeMidiFromBrief(brief, { seed: seedNum, bpm: opts.bpm ?? brief.bpm })
}
