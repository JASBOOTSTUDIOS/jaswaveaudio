/**
 * Planificador MIDI por ventanas (lookahead) hacia el Plugin Host.
 *
 * Lógica pura y sin dependencias del navegador para poder probarla con `node:test`.
 * El motor (`audio-engine.ts`) le inyecta el reloj (cada `tick(nowTimeline)`) y un
 * "sink" que envía de verdad (IPC al host nativo / WebSynth).
 *
 * Por qué un horizonte largo: el hilo principal del renderer puede quedar bloqueado
 * (re-render pesado al cambiar de panel, piano roll, medidores…). Los `noteOn` /
 * `noteOff` viajan al host con `delaySamples` relativo al instante de envío, así que
 * si el temporizador se retrasa más que el horizonte, el host se queda sin notas y el
 * audio se corta. Con ~3,5 s de margen un bloqueo de varios segundos ya no se oye.
 *
 * Coste de un horizonte largo (y cómo se compensa):
 *  - mute/solo en vivo: lo ya encolado en el host no se puede "desmandar", por eso
 *    `retargetTracks` hace panic del slot afectado y reprograma desde "ahora".
 *  - seek/stop/pause: el motor llama a `allNotesOff` (vacía `midiQueue` del host).
 *  - cola del host (`midiQueue.size() > 8192` descarta): sólo hay en vuelo las notas de
 *    `horizonSec`; ver `MAX_NOTAS_POR_TICK_Y_SLOT`.
 */

export interface MidiLookaheadNote {
  pitch: number
  velocity: number
  /** Inicio absoluto en la timeline (segundos). */
  startSec: number
  durationSec: number
}

export interface MidiLookaheadClip {
  id: string
  trackId: string
  /** Se ordena por (startSec, pitch) en `begin`. */
  notes: MidiLookaheadNote[]
  ccs?: Array<{ cc: number; timeSec: number; value: number }>
}

export interface MidiLookaheadTrack {
  id: string
  silenciada: boolean
  soloActiva: boolean
  vstInstrumentSlotId?: string
  /** Capas: otros instrumentos de la pista que reciben el mismo MIDI (además de `vstInstrumentSlotId`). */
  vstLayerSlotIds?: string[]
}

/** Todos los slots que reciben el MIDI de la pista (principal + capas, sin repetir). */
export function slotsDePista(t: MidiLookaheadTrack | undefined): string[] {
  if (!t?.vstInstrumentSlotId) return []
  const out = [t.vstInstrumentSlotId]
  for (const s of t.vstLayerSlotIds ?? []) if (s && !out.includes(s)) out.push(s)
  return out
}

export interface VoiceKeys {
  has(key: string): boolean
  add(key: string): void
}

export interface MidiLookaheadSink {
  /** Programa una nota completa (noteOn + noteOff) con retardo relativo a `nowTimeline`. */
  note(slotId: string, pitch: number, velocity: number, whenSec: number, durationSec: number, nowTimeline: number): void
  cc(slotId: string, cc: number, value: number, timeSec: number, nowTimeline: number): void
  /** Pistas sin slot VST (WebSynth). Opcional. */
  nonVstClip?(
    clip: MidiLookaheadClip,
    track: MidiLookaheadTrack,
    windowStart: number,
    windowEnd: number,
    nowTimeline: number,
    voices: VoiceKeys,
    playheadStartSec: number,
  ): void
  /** Panic de un slot (vacía la cola del host y corta voces). */
  panicSlot?(slotId: string): void
  warn?(msg: string, err: unknown): void
}

/** Horizonte por defecto hacia el host. */
export const MIDI_HORIZON_SEC = 3.5
/** Cada cuánto corre el temporizador (ms). */
export const MIDI_TICK_MS = 100
/** Holgura antes de considerar que el reloj retrocedió y rebobinar. */
const REWIND_SLACK_SEC = 0.35
/** Tolerancia de notas "ya pasadas" que aún se envían (p. ej. tick tardío). */
const LATE_TOLERANCE_SEC = 0.03
/**
 * Tope de notas enviadas por slot en un solo tick. El host descarta noteOn si su cola
 * supera 8192 eventos (2 por nota); si un tick tiene más, se continúa en el siguiente.
 */
export const MAX_NOTAS_POR_TICK_Y_SLOT = 1500

export function noteVoiceKey(clipId: string, ni: number, pitch: number, startSec: number): string {
  return clipId + ':' + ni + ':' + pitch + ':' + startSec.toFixed(4)
}

export class MidiLookahead {
  readonly horizonSec: number
  private clips: MidiLookaheadClip[] = []
  private tracks = new Map<string, MidiLookaheadTrack>()
  private haySolos = false
  private playheadStartSec = 0
  private scheduledUntil = 0
  private cursor = new Map<string, number>()
  private voices = new Map<string, Set<string>>()

  constructor(
    private readonly sink: MidiLookaheadSink,
    opts: { horizonSec?: number } = {},
  ) {
    this.horizonSec = opts.horizonSec ?? MIDI_HORIZON_SEC
  }

  get scheduledUntilSec(): number {
    return this.scheduledUntil
  }

  get clipCount(): number {
    return this.clips.length
  }

  /** Nuevo play desde `startSec`: reinicia cursores y claves. */
  begin(clips: MidiLookaheadClip[], tracks: MidiLookaheadTrack[], startSec: number): void {
    this.clips = clips.map((c) => ({
      ...c,
      notes: [...c.notes].sort((a, b) => a.startSec - b.startSec || a.pitch - b.pitch),
    }))
    this.setTracks(tracks)
    this.playheadStartSec = startSec
    this.scheduledUntil = startSec
    this.cursor.clear()
    this.voices.clear()
  }

  clear(): void {
    this.clips = []
    this.cursor.clear()
    this.voices.clear()
    this.scheduledUntil = 0
  }

  /** Sustituye la configuración de pistas (no reprograma; usar `retargetTracks`). */
  setTracks(tracks: MidiLookaheadTrack[]): void {
    this.tracks = new Map(tracks.map((t) => [t.id, t]))
    this.haySolos = tracks.some((t) => t.soloActiva)
  }

  getTrack(trackId: string): MidiLookaheadTrack | undefined {
    return this.tracks.get(trackId)
  }

  isAudible(trackId: string): boolean {
    const cfg = this.tracks.get(trackId)
    if (this.haySolos) return Boolean(cfg?.soloActiva)
    return !cfg?.silenciada
  }

  private voicesFor(clipId: string): Set<string> {
    let s = this.voices.get(clipId)
    if (!s) {
      s = new Set()
      this.voices.set(clipId, s)
    }
    return s
  }

  /**
   * Aplica nueva config de pistas en caliente. Para las pistas cuya audibilidad o slot
   * cambió: panic del slot (lo encolado a futuro en el host ya no es válido), borrar sus
   * claves y reprogramar desde `nowTimeline` hasta lo ya cubierto.
   * Devuelve los trackIds reprogramados.
   */
  retargetTracks(next: MidiLookaheadTrack[], nowTimeline: number): string[] {
    const before = new Map<string, { audible: boolean; slots: string[] }>()
    for (const t of this.tracks.keys()) {
      before.set(t, { audible: this.isAudible(t), slots: slotsDePista(this.tracks.get(t)) })
    }
    this.setTracks(next)
    const changed: string[] = []
    for (const t of next) {
      const prev = before.get(t.id)
      const audible = this.isAudible(t.id)
      const slots = slotsDePista(t)
      const slotsCambiaron = !prev || prev.slots.join('|') !== slots.join('|')
      if (!prev || prev.audible !== audible || slotsCambiaron) {
        // Pista sin clips MIDI: nada que reprogramar (pero sí panic si dejó de sonar).
        if (this.clips.some((c) => c.trackId === t.id)) changed.push(t.id)
        if (prev) {
          for (const s of prev.slots) {
            try {
              this.sink.panicSlot?.(s)
            } catch (err) {
              this.sink.warn?.('[midi-lookahead] panic falló', err)
            }
          }
        }
      }
    }
    if (changed.length === 0) return changed
    const set = new Set(changed)
    for (const clip of this.clips) {
      if (!set.has(clip.trackId)) continue
      this.cursor.delete(clip.id)
      this.voices.delete(clip.id)
    }
    const until = Math.max(this.scheduledUntil, nowTimeline)
    if (until > nowTimeline) this.planWindow(nowTimeline, until, nowTimeline, set)
    return changed
  }

  /** Olvida todo lo enviado (p. ej. reinicio del host): se reenvía desde `playheadStart`. */
  rewindAll(): void {
    this.voices.clear()
    this.cursor.clear()
    this.scheduledUntil = this.playheadStartSec
  }

  /** Olvida lo enviado de una pista (slot nuevo tras restart / ensure). */
  rewindTrack(trackId: string): void {
    for (const clip of this.clips) {
      if (clip.trackId !== trackId) continue
      this.cursor.delete(clip.id)
      this.voices.delete(clip.id)
    }
    this.scheduledUntil = this.playheadStartSec
  }

  /** Un panic ajeno (UI/audición) vació la cola de este slot: reenviar sus pistas. */
  rewindSlot(slotId: string): boolean {
    let any = false
    for (const t of this.tracks.values()) {
      if (slotsDePista(t).includes(slotId)) {
        this.rewindTrack(t.id)
        any = true
      }
    }
    return any
  }

  /** Un paso del temporizador. Seguro de llamar tarde: el horizonte absorbe el retraso. */
  tick(nowTimeline: number): void {
    // Lookahead inflado o reloj que retrocedió: rebobinar o no habrá más noteOn.
    if (this.scheduledUntil > nowTimeline + this.horizonSec + REWIND_SLACK_SEC) {
      this.scheduledUntil = Math.max(0, nowTimeline - 0.02)
      this.cursor.clear()
    }
    const windowStart = Math.max(this.scheduledUntil, nowTimeline - 0.05)
    const windowEnd = nowTimeline + this.horizonSec
    if (windowEnd <= windowStart) return
    const capped = this.planWindow(windowStart, windowEnd, nowTimeline, null)
    // Si se alcanzó el tope por slot, la ventana no se da por cubierta: el siguiente tick sigue.
    if (!capped) this.scheduledUntil = windowEnd
  }

  private planWindow(
    windowStart: number,
    windowEnd: number,
    nowTimeline: number,
    onlyTracks: Set<string> | null,
  ): boolean {
    let anyCapped = false
    const sentPerSlot = new Map<string, number>()
    for (const clip of this.clips) {
      if (onlyTracks && !onlyTracks.has(clip.trackId)) continue
      const cfg = this.tracks.get(clip.trackId)
      if (!this.isAudible(clip.trackId)) continue

      const vstSlot = cfg?.vstInstrumentSlotId
      const destinos = slotsDePista(cfg)
      const voices = this.voicesFor(clip.id)
      if (!vstSlot) {
        if (cfg) {
          try {
            this.sink.nonVstClip?.(clip, cfg, windowStart, windowEnd, nowTimeline, voices, this.playheadStartSec)
          } catch (err) {
            this.sink.warn?.('[midi-lookahead] clip sin VST falló', err)
          }
        }
        continue
      }

      let ni = this.cursor.get(clip.id) ?? 0
      while (ni < clip.notes.length) {
        const early = clip.notes[ni]!
        const earlyEnd = early.startSec + Math.max(0.03, early.durationSec)
        if (earlyEnd > windowStart) break
        const earlyKey = noteVoiceKey(clip.id, ni, early.pitch, early.startSec)
        // No descartar notas del inicio si el VST aún no estaba listo al primer lookahead.
        if (!voices.has(earlyKey) && earlyEnd > nowTimeline - LATE_TOLERANCE_SEC) break
        ni += 1
      }
      this.cursor.set(clip.id, ni)

      let sent = sentPerSlot.get(vstSlot) ?? 0
      let capped = false
      for (; ni < clip.notes.length; ni++) {
        const note = clip.notes[ni]!
        const noteStart = note.startSec
        if (noteStart > windowEnd) {
          this.cursor.set(clip.id, ni)
          break
        }
        const durRaw = Math.max(0.03, note.durationSec)
        const noteEnd = noteStart + durRaw
        const key = noteVoiceKey(clip.id, ni, note.pitch, noteStart)
        if (voices.has(key)) continue
        if (noteEnd <= windowStart && noteEnd <= nowTimeline - LATE_TOLERANCE_SEC) continue

        let whenSec = noteStart
        // Nota que arrancó antes del play (seek en medio de una nota): suena desde el cursor.
        if (whenSec < this.playheadStartSec) whenSec = this.playheadStartSec
        // Nota ya empezada (tick tardío / reprogramación): sólo lo que queda.
        if (whenSec < nowTimeline) whenSec = nowTimeline
        const dur = noteEnd - whenSec
        if (dur <= 0.02) continue

        if (sent >= MAX_NOTAS_POR_TICK_Y_SLOT) {
          // Seguir en el siguiente tick desde esta nota: el cursor no avanza.
          this.cursor.set(clip.id, ni)
          capped = true
          anyCapped = true
          break
        }
        try {
          for (const slot of destinos) this.sink.note(slot, note.pitch, note.velocity, whenSec, dur, nowTimeline)
          voices.add(key)
          sent += 1
        } catch (err) {
          this.sink.warn?.('[midi-lookahead] nota falló', err)
        }
      }
      sentPerSlot.set(vstSlot, sent)
      if (!capped && ni >= clip.notes.length) this.cursor.set(clip.id, ni)
      const ccs = clip.ccs ?? []
      for (let ci = 0; ci < ccs.length; ci++) {
        const ev = ccs[ci]!
        if (ev.timeSec < windowStart - 0.02 || ev.timeSec > windowEnd) continue
        const key = clip.id + ':cc:' + ev.cc + ':' + ev.timeSec.toFixed(4)
        if (voices.has(key)) continue
        try {
          for (const slot of destinos) this.sink.cc(slot, ev.cc, ev.value, ev.timeSec, nowTimeline)
          voices.add(key)
        } catch (err) {
          this.sink.warn?.('[midi-lookahead] cc falló', err)
        }
      }
    }
    return anyCapped
  }
}
