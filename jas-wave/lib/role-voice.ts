/**
 * Soft Pad por rol — voces Web Audio para timeline cuando no hay VST con preset,
 * o como underlay audibilidad garantizada junto al insert.
 */

export type SoftPadRole =
  | 'drums'
  | 'bass'
  | 'guitar'
  | 'piano'
  | 'keys'
  | 'pad'
  | 'strings'
  | 'choir'
  | 'lead'
  | 'brass'
  | 'synth'
  | 'percussion'
  | 'default'

export function normalizeSoftPadRole(rol: string | undefined | null): SoftPadRole {
  const r = String(rol ?? '')
    .toLowerCase()
    .trim()
  if (!r) return 'default'
  if (r === 'drums' || r === 'drum' || r === 'batería' || r === 'bateria' || r === 'percussion' || /bater|drum|kit/.test(r))
    return 'drums'
  if (r === 'bass' || r === 'bajo' || /bajo|bass/.test(r)) return 'bass'
  if (r === 'guitar' || r === 'guitarra' || /guitar/.test(r)) return 'guitar'
  if (r === 'piano' || /piano/.test(r)) return 'piano'
  if (r === 'keys' || r === 'keys_pad' || r === 'organ' || r === 'keys_fx' || /keys|teclado|organ/.test(r))
    return 'keys'
  if (r === 'pad' || r === 'ambient' || /\bpad\b|ambient/.test(r)) return 'pad'
  if (r === 'strings' || r === 'cuerdas' || /string|cuerda/.test(r)) return 'strings'
  if (r === 'choir' || r === 'coro' || r === 'vocal' || /choir|coro/.test(r)) return 'choir'
  if (r === 'lead' || r === 'melody' || r === 'solo' || /lead|melody/.test(r)) return 'lead'
  if (r === 'brass' || r === 'metales' || /brass|metal/.test(r)) return 'brass'
  if (r === 'synth' || r === 'fx' || /synth|sintet/.test(r)) return 'synth'
  return 'default'
}

export type RoleVoiceHandles = {
  stop: (when: number, releaseSec?: number) => void
}

/**
 * Programa una nota Soft Pad por rol en `dest`.
 */
export function scheduleRoleVoice(
  ctx: AudioContext | OfflineAudioContext,
  dest: AudioNode,
  pitch: number,
  velocity: number,
  when: number,
  dur: number,
  role: SoftPadRole = 'default',
): RoleVoiceHandles {
  const freq = 440 * Math.pow(2, (pitch - 69) / 12)
  const vel = Math.max(0.05, Math.min(1, velocity / 127))
  const attack = Math.min(0.08, Math.max(0.005, dur * 0.08))
  const release = Math.min(0.45, Math.max(0.04, dur * 0.12))
  const peak = when + attack
  const sustainEnd = Math.max(peak + 0.02, when + dur - release)
  const startAt = Math.max(0, when)

  const out = ctx.createGain()
  out.gain.setValueAtTime(0.0001, startAt)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(2400, startAt)
  filter.Q.value = 0.7
  out.connect(filter)
  filter.connect(dest)

  const oscs: OscillatorNode[] = []

  const addOsc = (type: OscillatorType, f: number, gainAmt: number, detune = 0) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(Math.max(20, f), startAt)
    if (detune) osc.detune.setValueAtTime(detune, startAt)
    const g = ctx.createGain()
    g.gain.value = gainAmt
    osc.connect(g)
    g.connect(out)
    osc.start(startAt)
    osc.stop(startAt + dur + release + 0.08)
    oscs.push(osc)
  }

  const addNoiseBurst = (gainAmt: number, filterFreq: number, decay: number) => {
    const len = Math.max(1, Math.floor(ctx.sampleRate * Math.min(decay, 0.35)))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = filterFreq
    bp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(gainAmt, startAt)
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + decay)
    src.connect(bp)
    bp.connect(g)
    g.connect(out)
    src.start(startAt)
    src.stop(startAt + decay + 0.02)
  }

  const stopHandle: RoleVoiceHandles = {
    stop: (t, rel = 0.05) => {
      try {
        out.gain.cancelScheduledValues(t)
        out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t)
        out.gain.exponentialRampToValueAtTime(0.0001, t + rel)
        for (const osc of oscs) {
          try {
            osc.stop(t + rel + 0.02)
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    },
  }

  switch (role) {
    case 'drums':
    case 'percussion': {
      if (pitch <= 40) {
        addOsc('sine', 55 + (pitch - 36) * 2, 0.55 * vel)
        addOsc('triangle', 80, 0.25 * vel)
        out.gain.exponentialRampToValueAtTime(0.55 * vel, startAt + 0.01)
        out.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.min(dur, 0.45))
      } else if (pitch <= 50) {
        addNoiseBurst(0.45 * vel, 1800, 0.18)
        addOsc('triangle', 180, 0.2 * vel)
        out.gain.exponentialRampToValueAtTime(0.5 * vel, startAt + 0.005)
        out.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22)
      } else {
        addNoiseBurst(0.22 * vel, 7000 + (pitch - 42) * 40, 0.06)
        out.gain.exponentialRampToValueAtTime(0.28 * vel, startAt + 0.002)
        out.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.08)
      }
      return stopHandle
    }
    case 'bass': {
      filter.frequency.setValueAtTime(280 + vel * 420, startAt)
      filter.Q.value = 0.9
      addOsc('sawtooth', freq, 0.32 * vel)
      addOsc('sine', freq * 0.5, 0.28 * vel)
      out.gain.exponentialRampToValueAtTime(0.42 * vel, peak)
      out.gain.setValueAtTime(0.32 * vel, sustainEnd)
      out.gain.exponentialRampToValueAtTime(0.0001, startAt + dur)
      break
    }
    case 'guitar': {
      filter.frequency.setValueAtTime(1200 + vel * 1800, startAt)
      filter.Q.value = 0.6
      addOsc('sawtooth', freq, 0.14 * vel, -7)
      addOsc('sawtooth', freq, 0.14 * vel, 7)
      addOsc('triangle', freq * 2, 0.06 * vel)
      out.gain.exponentialRampToValueAtTime(0.28 * vel, peak)
      out.gain.setValueAtTime(0.16 * vel, sustainEnd)
      out.gain.exponentialRampToValueAtTime(0.0001, startAt + dur)
      break
    }
    case 'piano':
    case 'keys': {
      filter.frequency.setValueAtTime(1800 + vel * 2200, startAt)
      addOsc('triangle', freq, 0.22 * vel)
      addOsc('sine', freq * 2, 0.08 * vel)
      addOsc('sine', freq * 3, 0.03 * vel)
      out.gain.exponentialRampToValueAtTime(0.34 * vel, startAt + 0.012)
      out.gain.exponentialRampToValueAtTime(0.14 * vel, startAt + Math.min(0.4, dur * 0.35))
      out.gain.setValueAtTime(0.1 * vel, sustainEnd)
      out.gain.exponentialRampToValueAtTime(0.0001, startAt + dur)
      break
    }
    case 'pad':
    case 'strings':
    case 'choir': {
      filter.frequency.setValueAtTime(role === 'choir' ? 1400 : 900 + vel * 800, startAt)
      filter.Q.value = 0.4
      addOsc('sawtooth', freq, 0.1 * vel, -8)
      addOsc('sawtooth', freq, 0.1 * vel, 8)
      addOsc('triangle', freq * 0.5, 0.08 * vel)
      const slowAtk = Math.min(0.35, Math.max(0.08, dur * 0.15))
      out.gain.exponentialRampToValueAtTime(0.22 * vel, startAt + slowAtk)
      out.gain.setValueAtTime(0.16 * vel, sustainEnd)
      out.gain.exponentialRampToValueAtTime(0.0001, startAt + dur + 0.15)
      break
    }
    case 'lead':
    case 'brass':
    case 'synth': {
      filter.frequency.setValueAtTime(1600 + vel * 2400, startAt)
      addOsc('sawtooth', freq, 0.2 * vel)
      addOsc('square', freq, 0.08 * vel, 3)
      out.gain.exponentialRampToValueAtTime(0.3 * vel, peak)
      out.gain.setValueAtTime(0.2 * vel, sustainEnd)
      out.gain.exponentialRampToValueAtTime(0.0001, startAt + dur)
      break
    }
    default: {
      filter.frequency.setValueAtTime(900 + vel * 2400, startAt)
      addOsc('triangle', freq, 0.2 * vel)
      out.gain.exponentialRampToValueAtTime(0.26 * vel, peak)
      out.gain.setValueAtTime(0.16 * vel, sustainEnd)
      out.gain.exponentialRampToValueAtTime(0.0001, startAt + dur)
    }
  }

  return stopHandle
}
