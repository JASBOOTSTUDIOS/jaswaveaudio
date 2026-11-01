/**
 * Vista previa sonora de un groove en el panel de administración, con un sintetizador de batería muy simple
 * (WebAudio): bombo, caja, hi-hat, platos, toms y percusión. Sirve para decidir rápido, no para sonar bonito;
 * el panel Grooves del DAW usa el kit real. Reproduce una vez al tempo del propio groove.
 */

import { datosDeCancion, familiaDePitch, leerSmf } from './shared'

type Nota = { pitch: number; velocidad: number; inicio: number }

let ctx: AudioContext | null = null
let ruido: AudioBuffer | null = null
let parar: (() => void) | null = null

function contexto(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

function bufferRuido(c: AudioContext): AudioBuffer {
  if (ruido) return ruido
  ruido = c.createBuffer(1, c.sampleRate, c.sampleRate)
  const d = ruido.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return ruido
}

function golpe(c: AudioContext, destino: AudioNode, t: number, pitch: number, vel: number): void {
  const g = c.createGain()
  g.connect(destino)
  const v = Math.max(0.05, Math.min(1, vel / 127))
  const familia = familiaDePitch(pitch)
  const tono = (f0: number, f1: number, dur: number) => {
    const o = c.createOscillator()
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    o.connect(g)
    o.start(t)
    o.stop(t + dur + 0.02)
  }
  const sonido = (tipo: BiquadFilterType, freq: number, dur: number) => {
    const s = c.createBufferSource()
    s.buffer = bufferRuido(c)
    const f = c.createBiquadFilter()
    f.type = tipo
    f.frequency.value = freq
    s.connect(f).connect(g)
    s.start(t)
    s.stop(t + dur + 0.02)
  }
  switch (familia) {
    case 0: // bombo
      g.gain.setValueAtTime(v, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
      tono(130, 45, 0.2)
      break
    case 1: // caja, cross-stick, palmas
      g.gain.setValueAtTime(v * 0.8, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + (pitch === 37 ? 0.05 : 0.18))
      sonido('highpass', 1800, 0.18)
      if (pitch !== 39) tono(200, 130, 0.1)
      break
    case 2: // hi-hat
      g.gain.setValueAtTime(v * 0.35, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + (pitch === 46 ? 0.25 : 0.05))
      sonido('highpass', 7000, 0.25)
      break
    case 3: // ride y campana
      g.gain.setValueAtTime(v * 0.3, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
      sonido('bandpass', pitch === 53 ? 4500 : 6500, 0.4)
      break
    case 4: // platos
      g.gain.setValueAtTime(v * 0.45, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
      sonido('highpass', 4000, 0.9)
      break
    case 5: // toms
      g.gain.setValueAtTime(v * 0.9, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      tono(60 + (pitch - 41) * 18 + 90, 70 + (pitch - 41) * 8, 0.28)
      break
    default: // percusión
      g.gain.setValueAtTime(v * 0.4, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      sonido('bandpass', 3000 + (pitch % 12) * 150, 0.12)
  }
}

export function notasDeMid(bytes: Uint8Array): { notas: Nota[]; bpm: number } {
  const d = datosDeCancion(leerSmf(bytes))
  return { notas: d.notas, bpm: d.datos.bpm || 100 }
}

export function detenerPrevia(): void {
  parar?.()
  parar = null
}

/** Reproduce el .mid una vez. Devuelve una promesa que se resuelve al terminar o al detenerla. */
export function reproducirPrevia(bytes: Uint8Array): Promise<void> {
  detenerPrevia()
  const c = contexto()
  void c.resume()
  const { notas, bpm } = notasDeMid(bytes)
  const seg = 60 / Math.max(20, bpm)
  const salida = c.createGain()
  salida.gain.value = 0.8
  salida.connect(c.destination)
  const t0 = c.currentTime + 0.05
  let fin = 0
  for (const n of notas) {
    golpe(c, salida, t0 + n.inicio * seg, n.pitch, n.velocidad)
    fin = Math.max(fin, n.inicio * seg + 0.6)
  }
  return new Promise((resolve) => {
    const h = setTimeout(() => {
      parar = null
      resolve()
    }, fin * 1000 + 100)
    parar = () => {
      clearTimeout(h)
      salida.gain.cancelScheduledValues(c.currentTime)
      salida.gain.setValueAtTime(0, c.currentTime)
      salida.disconnect()
      resolve()
    }
  })
}
