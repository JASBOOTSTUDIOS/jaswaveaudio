/**
 * G7: aviso sonoro del dictado por voz (estilo Android), generado con Web Audio: un oscilador senoidal con
 * envolvente suave. Sube 600→900 Hz al empezar y baja 800→500 Hz al terminar. Sin archivos de audio.
 *
 * Usa su propio AudioContext (no el del motor del DAW) y falla en silencio si el entorno no tiene audio.
 */

export type TipoChime = 'inicio' | 'fin'

const DURACION_S = 0.16
const VOLUMEN = 0.12

const BARRIDO: Record<TipoChime, readonly [number, number]> = {
  inicio: [600, 900],
  fin: [800, 500],
}

let contexto: AudioContext | null = null

function obtenerContexto(): AudioContext | null {
  if (contexto) return contexto
  const Ctor =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
  if (!Ctor) return null
  try {
    contexto = new Ctor()
  } catch {
    contexto = null
  }
  return contexto
}

export function reproducirChime(tipo: TipoChime): void {
  const ctx = obtenerContexto()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const [desde, hasta] = BARRIDO[tipo]
    const t0 = ctx.currentTime + 0.005
    const osc = ctx.createOscillator()
    const ganancia = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(desde, t0)
    osc.frequency.exponentialRampToValueAtTime(hasta, t0 + DURACION_S * 0.7)
    // Ataque corto y caída exponencial: sin clics al empezar ni al cortar.
    ganancia.gain.setValueAtTime(0.0001, t0)
    ganancia.gain.exponentialRampToValueAtTime(VOLUMEN, t0 + 0.015)
    ganancia.gain.exponentialRampToValueAtTime(0.0001, t0 + DURACION_S)
    osc.connect(ganancia)
    ganancia.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + DURACION_S + 0.02)
    osc.onended = () => {
      osc.disconnect()
      ganancia.disconnect()
    }
  } catch {
    /* sin audio: el dictado funciona igual */
  }
}
